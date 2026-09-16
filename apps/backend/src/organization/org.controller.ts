import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrgService } from './org.service';
import { ScopeService } from './scope.service';
// EDIT (Phase 4 — cutover, subphase 4.1): RegisterOrgDto was only ever used
// by registerOrg()/POST 'register' below, both removed in this subphase —
// SubmitOrgRequestDto (2.3) is POST 'request''s input instead.
import { SubmitOrgRequestDto } from './dto/submit-org-request.dto';
// EDIT (Phase 4 — cutover, subphase 4.3): input for the new
// send-domain-otp route below.
import { SendOrgDomainOtpDto } from './dto/send-org-domain-otp.dto';
import { OrgRequestsService } from './org-requests.service';
import { AddMembersDto } from './dto/add-members.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { CreateScopeDto, UpdateScopeDto } from './dto/scope.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireOrganizer } from '../common/decorators/require-organizer.decorator';
import type { JwtUser } from '../common/decorators/current-user.decorator';
import { AddMemberRoleDto, MoveMemberRoleDto } from './dto/member-role.dto';

// EDIT (Phase 4 — cutover, subphase 4.3): same shape/reasoning as
// auth.controller.ts's own OTP_SEND_THROTTLE — a fresh OTP-sending route
// gets a send-rate cap from the day it's introduced, same as every other
// one in this codebase, rather than being throttle-less until a later
// subphase notices. Not shared with auth.controller.ts's own constant
// (module-local there, not exported) — same value, kept local here.
const ORG_DOMAIN_OTP_SEND_THROTTLE = { default: { ttl: 60_000, limit: 3 } }; // 3/min/IP

@UseGuards(JwtAuthGuard)
@Controller('org')
export class OrgController {
  constructor(
    private orgService: OrgService,
    private scopeService: ScopeService,
    // EDIT (Phase 4 — cutover, subphase 4.1): OrgRequestsService is already
    // a provider in this module (registered for 2.3, exported for 3.1's
    // controller), so this is the same "inject the existing instance"
    // reasoning org.module.ts's own comments already give — no module
    // change needed for this specific wiring.
    private orgRequestsService: OrgRequestsService,
  ) {}

  // ─── Organization ───────────────────────────────────────────────────────────

  /**
   * POST /org/request
   * EDIT (Phase 4 — cutover, subphase 4.1): replaces the old POST /org/register
   * (removed below, not deprecated-and-kept — this is the actual cutover the
   * plan's own Phase 4 description calls for, not an additive change).
   *
   * Registering an organization is no longer instant: this submits a request
   * (OrgRequestsService.submit(), 2.3) that a site admin reviews and decides
   * on via the admin portal (3.1's routes / 3.5's UI) — approval is what
   * actually creates the `organization` row (OrgRequestsService.approve(),
   * 2.4), not this endpoint. No RolesGuard here, same as the old route: any
   * UNIFIED (or ORG) session can submit a request.
   *
   * Unlike the old registerOrg(), submit() takes no caller_uid/caller_identifier
   * — there is nothing to be a member of yet (see SubmitOrgRequestDto's own
   * comment on why those fields don't exist here), so pid is all this route
   * needs to pass through.
   */
  @Post('request')
  requestOrg(@CurrentUser() user: JwtUser, @Body() dto: SubmitOrgRequestDto) {
    const pid = BigInt(user.pid!);
    return this.orgRequestsService.submit(pid, dto);
  }

  /**
   * POST /org/request/send-domain-otp
   * EDIT (Phase 4 — cutover, subphase 4.3): sends the domain-ownership OTP
   * to a prospective org_email — the requester calls this first, then
   * supplies the code back as org_email_otp in POST /org/request above.
   *
   * Placed under 'request/' (rather than its own top-level route) since
   * it's conceptually a step of submitting a request, not a standalone org
   * action — same reasoning as nesting members/scope routes under
   * ':orgid/'. No RolesGuard, same as POST /org/request itself: any
   * authenticated UNIFIED/ORG session can call this, since submitting a
   * request itself requires no organizer role.
   */
  @Throttle(ORG_DOMAIN_OTP_SEND_THROTTLE)
  @Post('request/send-domain-otp')
  sendOrgDomainOtp(@Body() dto: SendOrgDomainOtpDto) {
    return this.orgRequestsService.sendDomainOtp(dto);
  }

  /**
   * GET /org/request/mine
   * EDIT (Phase 4 — cutover, subphase 4.7): the "My requests" view's data
   * source — every org_requests row this pid has ever submitted, newest
   * first. No RolesGuard, same as POST /org/request itself: any
   * authenticated UNIFIED/ORG session can see their own requests.
   */
  @Get('request/mine')
  listMyOrgRequests(@CurrentUser() user: JwtUser) {
    const pid = BigInt(user.pid!);
    return this.orgRequestsService.listMine(pid);
  }

  /**
   * POST /org/request/:requestId/resubmit
   * EDIT (Phase 4 — cutover, subphase 4.7): the edit-and-resubmit half of a
   * NEEDS_INFO round trip — OrgRequestsService.resubmit() edits the request
   * in place and sends it back to PENDING, rather than creating a new row
   * via submit(). Same SubmitOrgRequestDto body as POST /org/request.
   * Ownership is enforced inside resubmit() itself (a request_id belonging
   * to another pid is reported as not found, not forbidden — see that
   * method's own comment), not here, so this route needs nothing beyond
   * pulling pid off the JWT the same way requestOrg() above does.
   */
  @Post('request/:requestId/resubmit')
  resubmitOrgRequest(
    @CurrentUser() user: JwtUser,
    @Param('requestId') requestId: string,
    @Body() dto: SubmitOrgRequestDto,
  ) {
    const pid = BigInt(user.pid!);
    return this.orgRequestsService.resubmit(
      pid,
      this.parseRequestId(requestId),
      dto,
    );
  }

  /**
   * GET /org/mine
   * Returns all orgs where the caller has an organizer role.
   */
  @Get('mine')
  getMyOrgs(@CurrentUser() user: JwtUser) {
    return this.orgService.getMyOrgs(BigInt(user.pid!));
  }

  // ─── Members ────────────────────────────────────────────────────────────────

  /**
   * GET /org/:orgid/members
   * Organizer-only. Lists members within caller's scope.
   */
  @Get(':orgid/members')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  getMembers(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Req() req: any,
    @Query('role') role?: string,
    @Query('scope_id') scopeId?: string,
    @Query('search') search?: string,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.getMembers(BigInt(user.pid!), orgid, callerUid, {
      role,
      scope_id: scopeId ? Number(scopeId) : undefined,
      search,
    });
  }

  /**
   * POST /org/:orgid/members
   * Organizer-only. Add members via table or CSV.
   */
  @Post(':orgid/members')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  addMembers(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Body() dto: AddMembersDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.addMembers(BigInt(user.pid!), orgid, callerUid, dto);
  }

  /**
   * PATCH /org/:orgid/members/:uid
   * Organizer-only. Update role or scope of a member.
   */
  @Patch(':orgid/members/:targetUid')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  updateMember(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('targetUid') targetUid: string,
    @Body() dto: UpdateMemberDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;

    return this.orgService.updateMember(
      BigInt(user.pid!),
      orgid,
      callerUid,
      targetUid.toUpperCase(),
      dto,
    );
  }

  /**
   * DELETE /org/:orgid/members/:uid
   * Organizer-only. Soft-delete a member.
   */
  @Delete(':orgid/members/:uid')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  removeMember(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('uid') targetUid: string,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.removeMember(
      BigInt(user.pid!),
      orgid,
      callerUid,
      targetUid.toUpperCase(),
    );
  }
  /*
   * POST /org/:orgid/members/:targetUid/roles
   * Add a new scope assignment to an existing member.
   */
  @Post(':orgid/members/:targetUid/roles')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  addMemberRole(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('targetUid') targetUid: string,
    @Body() dto: AddMemberRoleDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.addMemberRole(
      BigInt(user.pid!),
      orgid,
      callerUid,
      targetUid.toUpperCase(),
      dto,
    );
  }

  /**
   * DELETE /org/:orgid/members/:targetUid/roles/:scopeId
   * Remove one scope assignment from a member.
   * If it is their last assignment, org_members is soft-deleted too.
   */
  @Delete(':orgid/members/:targetUid/roles/:scopeId')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  removeMemberRole(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('targetUid') targetUid: string,
    @Param('scopeId', ParseIntPipe) scopeId: number,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.removeMemberRole(
      BigInt(user.pid!),
      orgid,
      callerUid,
      targetUid.toUpperCase(),
      scopeId,
    );
  }

  /**
   * POST /org/:orgid/members/:targetUid/roles/move
   * Atomically move a member's scope assignment from one scope to another.
   * NOTE: this route must be declared BEFORE :scopeId routes to avoid NestJS
   * routing the literal string "move" as a ParseIntPipe param.
   */
  @Post(':orgid/members/:targetUid/roles/move')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  moveMemberRole(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('targetUid') targetUid: string,
    @Body() dto: MoveMemberRoleDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.moveMemberRole(
      BigInt(user.pid!),
      orgid,
      callerUid,
      targetUid.toUpperCase(),
      dto,
    );
  }
  // ─── Scope Tree ─────────────────────────────────────────────────────────────

  /**
   * GET /org/:orgid/scope
   * Organizer-only. Returns scope tree from caller's node downward.
   */
  @Get(':orgid/scope')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  getScopeTree(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.scopeService.getScopeTree(orgid, callerUid);
  }

  /**
   * POST /org/:orgid/scope
   * Organizer-only. Add a new scope node.
   */
  @Post(':orgid/scope')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  createScope(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Body() dto: CreateScopeDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.scopeService.createScope(orgid, callerUid, dto);
  }

  /**
   * PATCH /org/:orgid/scope/:scope_id
   * Organizer-only. Rename a scope node.
   * FIX: was documented as "rename / reattach" — reattachment removed per design.
   */
  @Patch(':orgid/scope/:scope_id')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  updateScope(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('scope_id', ParseIntPipe) scopeId: number,
    @Body() dto: UpdateScopeDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.scopeService.updateScope(orgid, callerUid, scopeId, dto);
  }

  /**
   * DELETE /org/:orgid/scope/:scope_id
   * Organizer-only. Delete a leaf scope node (no members/children assigned).
   */
  @Delete(':orgid/scope/:scope_id')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  deleteScope(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('scope_id', ParseIntPipe) scopeId: number,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.scopeService.deleteScope(orgid, callerUid, scopeId);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * org_requests.request_id is BIGSERIAL, so the service layer works in
   * `bigint` (matches OrgRequestsService.resubmit()'s own signature) — but
   * unlike the JWT-derived `pid` conversions elsewhere in this controller, a
   * route param comes straight from the URL with nothing having validated
   * it first. A bare `BigInt(requestId)` on a non-numeric segment throws a
   * raw SyntaxError with no HTTP status, surfacing as an unhandled 500
   * instead of a clean 400. Same guard, same reasoning, as
   * org-requests-admin.controller.ts's own parseRequestId() (3.1) — not
   * shared/imported from there since that file has no shared-helpers module
   * to pull it from and it's two lines long.
   */
  private parseRequestId(requestId: string): bigint {
    if (!/^\d+$/.test(requestId)) {
      throw new BadRequestException(`Invalid request id: ${requestId}`);
    }
    return BigInt(requestId);
  }
}
