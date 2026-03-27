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
// UNIFIED sessions: caller passes uid via x-caller-uid header.
function resolveCallerUid(user: JwtUser, headers: Record<string, any>): string {
  if (user.uid) return user.uid;
  const h = headers['x-caller-uid'];
  if (typeof h === 'string' && h.trim()) return h.trim().toUpperCase();
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
    @Body() dto: RegisterOrgDto & { caller_uid?: string },
  ) {
    const pid = BigInt(user.pid!);
    const callerUid = user.uid ?? dto.caller_uid;
    return this.orgService.registerOrg(pid, callerUid, dto);
  }

  /**
   * GET /org/mine
   * Returns all orgs where the caller has an organizer role.
   * No RolesGuard — just needs a valid session.
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
    @Query('role') role?: string,
    @Query('scope_id') scopeId?: string,
    @Query('search') search?: string,
  ) {
    const callerUid = resolveCallerUid(user, {});
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
  ) {
    const callerUid = resolveCallerUid(user, {});
    return this.orgService.addMembers(BigInt(user.pid!), orgid, callerUid, dto);
  }

  /**
   * PATCH /org/:orgid/members/:uid
   * Organizer-only. Update role or scope of a member.
   */
  @Patch(':orgid/members/:uid')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  updateMember(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('uid') targetUid: string,
    @Body() dto: UpdateMemberDto,
  ) {
    const callerUid = resolveCallerUid(user, {});
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
  ) {
    const callerUid = resolveCallerUid(user, {});
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
  ) {
    const callerUid = resolveCallerUid(user, {});
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
  ) {
    const callerUid = resolveCallerUid(user, {});
    return this.scopeService.createScope(orgid, callerUid, dto);
  }

  /**
   * PATCH /org/:orgid/scope/:scope_id
   * Organizer-only. Rename / reattach a scope node.
   */
  @Patch(':orgid/scope/:scope_id')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  updateScope(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('scope_id', ParseIntPipe) scopeId: number,
    @Body() dto: UpdateScopeDto,
  ) {
    const callerUid = resolveCallerUid(user, {});
    return this.scopeService.updateScope(orgid, callerUid, scopeId, dto);
  }

  /**
   * DELETE /org/:orgid/scope/:scope_id
   * Organizer-only. Delete a scope node (no members/events assigned).
   */
  @Delete(':orgid/scope/:scope_id')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  deleteScope(
    @CurrentUser() user: JwtUser,
    @Param('orgid') orgid: string,
    @Param('scope_id', ParseIntPipe) scopeId: number,
  ) {
    const callerUid = resolveCallerUid(user, {});
    return this.scopeService.deleteScope(orgid, callerUid, scopeId);
  }
}