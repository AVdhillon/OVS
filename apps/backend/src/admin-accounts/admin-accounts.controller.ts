import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAccountsService } from './admin-accounts.service';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { DeactivateAdminDto } from './dto/deactivate-admin.dto';
import { SiteAdminGuard } from '../auth/guards/site-admin.guard';
import { RequireSuperAdmin } from '../common/decorators/require-super-admin.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/decorators/current-user.decorator';

// ─── Admin account management routes ───────────────────────────────────────
// Prefix 'admin/admins' — a sibling of 'admin/org-requests',
// 'admin/organizations', 'admin/audit', and 'admin/analytics'.
//
// Unlike every one of those, this one is gated by
// `@UseGuards(SiteAdminGuard) @RequireSuperAdmin()` on the whole
// controller, not plain `@UseGuards(SiteAdminGuard)` — managing who else
// can act as a site admin (including who else can become
// a super admin) is exactly the elevated-tier action
// require-super-admin.decorator.ts's own header comment describes. This
// includes the read routes
// (list/getDetail): unlike the other admin surfaces' read-only reasoning
// ("viewing isn't the elevated action, only acting is"), the admin roster
// itself (who exists, who's a super admin, who's inactive) is reserved to
// super admins only here, not just the invite/deactivate
// actions on it.
@UseGuards(SiteAdminGuard)
@RequireSuperAdmin()
@Controller('admin/admins')
export class AdminAccountsController {
  constructor(private adminAccountsService: AdminAccountsService) {}

  /**
   * GET /admin/admins
   * The admin roster. No default filter (see AdminAccountsService.list());
   * `?is_active=true|false` narrows it. Paginated, page_size capped at 100.
   */
  @Get()
  list(
    @Query('is_active') isActive?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.adminAccountsService.list({
      isActive:
        isActive === undefined
          ? undefined
          : isActive.toLowerCase() === 'true',
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    });
  }

  /**
   * GET /admin/admins/:adminId
   * One admin account plus its own ADMIN_INVITED/ADMIN_DEACTIVATED history.
   * See AdminAccountsService.getDetail(). admin_id is a VARCHAR PK, not a
   * BIGSERIAL — no numeric-parse guard is needed here the way org-requests-admin.controller.ts's
   * parseRequestId() needs one for org_requests.request_id; an unknown
   * value simply 404s via findUnique() returning null.
   */
  @Get(':adminId')
  getDetail(@Param('adminId') adminId: string) {
    return this.adminAccountsService.getDetail(adminId);
  }

  /**
   * POST /admin/admins
   * Invites a new admin account. No accept-invite step — see
   * InviteAdminDto's own header comment for why the invited person can
   * sign in immediately via the existing admin-login OTP flow.
   */
  @Post()
  invite(@CurrentUser() admin: JwtUser, @Body() dto: InviteAdminDto) {
    return this.adminAccountsService.inviteAdmin(dto, admin.admin_id!);
  }

  /**
   * POST /admin/admins/:adminId/deactivate
   * Deactivates an admin account. `reason` is required — see
   * DeactivateAdminDto. Rejects deactivating the last active super admin
   * (including via self-deactivation, when you are that last one) — see
   * AdminAccountsService.deactivateAdmin() for why one guard covers both.
   */
  @Post(':adminId/deactivate')
  deactivate(
    @CurrentUser() admin: JwtUser,
    @Param('adminId') adminId: string,
    @Body() dto: DeactivateAdminDto,
  ) {
    return this.adminAccountsService.deactivateAdmin(
      adminId,
      admin.admin_id!,
      dto,
    );
  }
}
