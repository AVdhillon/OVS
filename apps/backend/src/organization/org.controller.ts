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
} from '@nestjs/common';
import { OrgService } from './org.service';
import { ScopeService } from './scope.service';
import { RegisterOrgDto } from './dto/register-org.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { CreateScopeDto, UpdateScopeDto } from './dto/scope.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireOrganizer } from '../common/decorators/require-organizer.decorator';
import type { JwtUser } from '../common/decorators/current-user.decorator';

// ─── Helper: resolve caller uid ───────────────────────────────────────────────
// ORG sessions: uid is baked into JWT.
// UNIFIED sessions: caller passes uid via x-caller-uid header or query param.
function resolveCallerUid(user: JwtUser, req: any): string {
  if (user.uid) return user.uid;
  const fromHeader = req.headers?.['x-caller-uid'];
  if (typeof fromHeader === 'string' && fromHeader.trim())
    return fromHeader.trim().toUpperCase();
  const fromQuery = req.query?.uid;
  if (typeof fromQuery === 'string' && fromQuery.trim())
    return fromQuery.trim().toUpperCase();
  return '';
}

@UseGuards(JwtAuthGuard)
@Controller('org')
export class OrgController {
  constructor(
    private orgService: OrgService,
    private scopeService: ScopeService,
  ) {}

  // ─── Organization ───────────────────────────────────────────────────────────

  /**
   * POST /org/register
   * Register a new organization. Caller becomes root organizer.
   * No RolesGuard here — anyone with a UNIFIED session can register an org.
   */
  @Post('register')
  registerOrg(
    @CurrentUser() user: JwtUser,
    // FIX: removed the `& { caller_uid?: string }` intersection type —
    //      caller_uid is now a proper validated field on RegisterOrgDto itself.
    @Body() dto: RegisterOrgDto,
    @Req() req: any,
  ) {
    const pid = BigInt(user.pid!);
    // ORG session → uid from JWT. UNIFIED → from DTO body field (now validated).
    const callerUid = user.uid ?? dto.caller_uid ?? resolveCallerUid(user, req);
    const callerIdentifier = dto.caller_identifier;
    return this.orgService.registerOrg(pid, callerUid, callerIdentifier, dto);
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
    const callerUid = resolveCallerUid(user, req);
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
    const callerUid = resolveCallerUid(user, req);
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
    const callerUid = resolveCallerUid(user, req);

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
    const callerUid = resolveCallerUid(user, req);
    return this.orgService.removeMember(
      BigInt(user.pid!),
      orgid,
      callerUid,
      targetUid.toUpperCase(),
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
    const callerUid = resolveCallerUid(user, req);
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
    const callerUid = resolveCallerUid(user, req);
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
    const callerUid = resolveCallerUid(user, req);
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
    const callerUid = resolveCallerUid(user, req);
    return this.scopeService.deleteScope(orgid, callerUid, scopeId);
  }
}
