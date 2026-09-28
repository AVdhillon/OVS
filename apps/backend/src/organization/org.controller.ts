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
// SubmitOrgRequestDto is POST 'request''s input (it replaced the old
// direct-registration DTO).
import { SubmitOrgRequestDto } from './dto/submit-org-request.dto';
// Input for the send-domain-otp route below.
import { SendOrgDomainOtpDto } from './dto/send-org-domain-otp.dto';
// Input for the finalize route below.
import { FinalizeOrgRequestDto } from './dto/finalize-org-request.dto';
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
// The requester-facing (organizer's-own-org) side of OrgLimitRequestsService —
// submit a request and view this org's own history. The admin-facing side
// (approve/reject/needs-info/queue) lives on its own controller,
// member-limit-requests-admin.controller.ts, same "separate controller per
// audience" split org-requests-admin.controller.ts's own header comment
// establishes for org_requests.
import { OrgLimitRequestsService } from './org-limit-requests.service';
import { SubmitLimitRequestDto } from './dto/submit-limit-request.dto';

// Same shape/reasoning as
// auth.controller.ts's own OTP_SEND_THROTTLE — every OTP-sending route
// carries a send-rate cap so it can't be used to spam an address. Not shared with auth.controller.ts's own constant
// (module-local there, not exported) — same value, kept local here.
const ORG_DOMAIN_OTP_SEND_THROTTLE = { default: { ttl: 60_000, limit: 3 } }; // 3/min/IP

@UseGuards(JwtAuthGuard)
@Controller('org')
export class OrgController {
  constructor(
    private orgService: OrgService,
    private scopeService: ScopeService,
    // OrgRequestsService is already a provider in this module, so this is
    // the same "inject the existing instance" reasoning org.module.ts's own
    // comments give.
    private orgRequestsService: OrgRequestsService,
    // OrgLimitRequestsService is already a provider in this module, same
    // "inject the existing instance" wiring as orgRequestsService above.
    private orgLimitRequestsService: OrgLimitRequestsService,
  ) {}

  // ─── Organization ───────────────────────────────────────────────────────────

  /**
   * POST /org/request
   * There is deliberately no direct-registration route: an
   * instant-registration path would bypass the admin review this route
   * exists to enforce.
   *
   * Registering an organization is not instant: this submits a request
   * (OrgRequestsService.submit()) that a site admin reviews and decides
   * on via the admin portal — approval is what moves the request forward
   * (OrgRequestsService.approve()), not this endpoint. No RolesGuard here, any
   * UNIFIED (or ORG) session can submit a request.
   *
   * Unlike registerOrg(), submit() takes no caller_uid/caller_identifier
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
   * Sends the domain-ownership OTP
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
   * The "My requests" view's data
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
   * The edit-and-resubmit half of a
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
   * POST /org/request/:requestId/finalize
   * The
   * requester-triggered completion of an APPROVED_PENDING_SETUP request —
   * see OrgRequestsService.finalizeSetup() for the full flow. This is what
   * actually creates the `organization` row (approve() does not). Uses the
   * singular 'request/' path like every other requester-facing org-request
   * route on this controller (resubmit above, 'request/mine', etc.) — a
   * plural '/org/requests/:id/finalize' would break that convention. No RolesGuard: ownership of the request
   * itself is enforced inside finalizeSetup() (a request_id belonging to
   * another pid is reported as not found, same as resubmit()), not here.
   */
  @Post('request/:requestId/finalize')
  finalizeOrgRequest(
    @CurrentUser() user: JwtUser,
    @Param('requestId') requestId: string,
    @Body() dto: FinalizeOrgRequestDto,
  ) {
    const pid = BigInt(user.pid!);
    return this.orgRequestsService.finalizeSetup(
      this.parseRequestId(requestId),
      pid,
      dto,
    );
  }

  /**
   * GET /org/mine
   * Returns all orgs where the caller has an organizer role.
   *
   * The pid-based lookup only applies to UNIFIED sessions. For an ORG
   * session, org_members.pid can be NULL (a member never linked to a
   * unified account is still valid — chk_member_identity only requires pid
   * OR mobile OR email), and BigInt(null) throws. An ORG session already
   * knows its own (orgid, uid) from the JWT, so it's routed to
   * getMyOrgForOrgSession(), which resolves organizer status directly from
   * that instead of via pid.
   */
  @Get('mine')
  getMyOrgs(@CurrentUser() user: JwtUser) {
    if (user.type === 'ORG') {
      return this.orgService.getMyOrgForOrgSession(user.orgid!, user.uid!);
    }
    return this.orgService.getMyOrgs(BigInt(user.pid!));
  }

  /**
   * GET /org/self
   * The frontend's Account page shows a
   * plain ORG member their own uid/orgid/org name/contact. /org/mine can't
   * be reused for this — it's organizer-gated (getMyOrgForOrgSession
   * returns [] for a non-organizer) — so this is a deliberately
   * organizer-free sibling: no RequireOrganizer/RolesGuard, just "is this
   * an active member of the org their own session says they're in".
   * UNIFIED/SITEADMIN sessions have no (orgid, uid) to resolve here.
   */
  @Get('self')
  getOrgSelfInfo(@CurrentUser() user: JwtUser) {
    if (user.type !== 'ORG') {
      throw new BadRequestException('Only available for ORG sessions');
    }
    return this.orgService.getOrgSelfInfo(user.orgid!, user.uid!);
  }

  /**
   * GET /org/orgid-available?orgid=XYZ1234
   * Thin,
   * read-only wrapper around orgid.utilities.ts's isOrgIdAvailable() — lets the finalize-setup wizard's "choose my own ID"
   * step check as the requester types, without running the full
   * allocate-and-retry path finalizeSetup() itself uses. No RolesGuard:
   * anyone authenticated can check whether an orgid string is taken, same
   * as every other requester-facing route on this controller — nothing
   * here is scoped to an org the caller belongs to (there isn't one yet).
   */
  @Get('orgid-available')
  checkOrgIdAvailable(@Query('orgid') orgid: string) {
    return this.orgService.checkOrgIdAvailable(orgid);
  }

  // ─── Member limit requests  ───────────────────────

  /**
   * POST /org/:orgid/member-limit-requests
   * Submits a request to raise this org's
   * member_limit — see OrgLimitRequestsService.submit(). Organizer-only,
   * same @RequireOrganizer('orgid')/RolesGuard gating as every other
   * ':orgid/...' route on this controller — trg_check_limit_request_organizer
   * (dbschema.sql) backstops this at the DB level regardless, but the
   * guard gives a clean 403 before the service is even called, same
   * "friendly guard in front of a DB-level backstop" reasoning as those
   * routes' own comments. `uid` comes from RolesGuard's resolved
   * req.orgContext.uid, never trusted from the body — see
   * SubmitLimitRequestDto's own header comment for why it isn't a field
   * there.
   */
  @Post(':orgid/member-limit-requests')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  submitLimitRequest(
    @Param('orgid') orgid: string,
    @Body() dto: SubmitLimitRequestDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgLimitRequestsService.submit(
      orgid,
      callerUid,
      dto.requested_limit,
      dto.justification,
    );
  }

  /**
   * PATCH /org/:orgid/member-limit-requests/:requestId
   * Edits and resubmits a request that's sitting in NEEDS_INFO — see
   * OrgLimitRequestsService.resubmit(). Same organizer-only gating as
   * submitLimitRequest() above. resubmit() itself is the one that enforces
   * "only NEEDS_INFO, only your own request" — this route is just the
   * plumbing, same "friendly guard here, real check in the service" split
   * as every other route on this controller.
   */
  @Patch(':orgid/member-limit-requests/:requestId')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  resubmitLimitRequest(
    @Param('orgid') orgid: string,
    @Param('requestId') requestId: string,
    @Body() dto: SubmitLimitRequestDto,
    @Req() req: any,
  ) {
    if (!/^\d+$/.test(requestId)) {
      throw new BadRequestException(`Invalid request id: ${requestId}`);
    }
    const callerUid = req.orgContext.uid;
    return this.orgLimitRequestsService.resubmit(
      orgid,
      callerUid,
      BigInt(requestId),
      dto.requested_limit,
      dto.justification,
    );
  }

  /**
   * GET /org/:orgid/member-limit-requests
   * This org's own member-limit-request
   * history, newest first — see OrgLimitRequestsService.listForOrg(). Gated
   * the same organizer-only way as submitLimitRequest() above: this is part
   * of the *org admin* dashboard, not something every member sees, so it's
   * organizer-only rather than open to any member — an assumption to
   * revisit if product wants it looser.
   */
  @Get(':orgid/member-limit-requests')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  listLimitRequestsForOrg(@Param('orgid') orgid: string) {
    return this.orgLimitRequestsService.listForOrg(orgid);
  }

  // ─── Members ────────────────────────────────────────────────────────────────

  /**
   * GET /org/:orgid/members
   * Organizer-only. Lists members within caller's scope.
   */
  // No pid is passed to the service: org_members.pid is legitimately NULL
  // for a member added directly by an org owner who was never linked to a
  // unified account (chk_member_identity only requires pid OR mobile OR
  // email), so an ORG session can have user.pid === null and
  // BigInt(user.pid!) would throw. Scoping runs off callerUid (resolved by
  // RolesGuard) instead, so members-management routes never need the pid.
  @Get(':orgid/members')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  getMembers(
    @Param('orgid') orgid: string,
    @Req() req: any,
    @Query('role') role?: string,
    @Query('scope_id') scopeId?: string,
    @Query('search') search?: string,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.getMembers(orgid, callerUid, {
      role,
      scope_id: scopeId ? Number(scopeId) : undefined,
      search,
    });
  }

  /**
   * POST /org/:orgid/members
   * Organizer-only. Add members via table or CSV.
   *
   * No BigInt(user.pid!) here (unlike routes that need the pid): ORG
   * sessions have no pid, and OrgService.addMembers() never reads one, so
   * none is passed.
   */
  @Post(':orgid/members')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  addMembers(
    @Param('orgid') orgid: string,
    @Body() dto: AddMembersDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.addMembers(orgid, callerUid, dto);
  }

  /**
   * PATCH /org/:orgid/members/:uid
   * Organizer-only. Update role or scope of a member.
   */
  @Patch(':orgid/members/:targetUid')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  updateMember(
    @Param('orgid') orgid: string,
    @Param('targetUid') targetUid: string,
    @Body() dto: UpdateMemberDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;

    return this.orgService.updateMember(
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
    @Param('orgid') orgid: string,
    @Param('uid') targetUid: string,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.removeMember(
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
    @Param('orgid') orgid: string,
    @Param('targetUid') targetUid: string,
    @Body() dto: AddMemberRoleDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.addMemberRole(
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
    @Param('orgid') orgid: string,
    @Param('targetUid') targetUid: string,
    @Param('scopeId', ParseIntPipe) scopeId: number,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.removeMemberRole(
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
    @Param('orgid') orgid: string,
    @Param('targetUid') targetUid: string,
    @Body() dto: MoveMemberRoleDto,
    @Req() req: any,
  ) {
    const callerUid = req.orgContext.uid;
    return this.orgService.moveMemberRole(
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
   * Was documented as "rename / reattach" — reattachment removed per design.
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
   * org-requests-admin.controller.ts's own parseRequestId() — not
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
