import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrgDirectoryService } from './org-directory.service';
import { OrgLifecycleService } from './org-lifecycle.service';
import { OrgLifecycleReasonDto } from './dto/org-lifecycle.dto';
import { SiteAdminGuard } from '../auth/guards/site-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/decorators/current-user.decorator';

// ─── Org admin routes ───────────────────────────────────────────────────────
// The directory (list()) route is the GET /admin/organizations endpoint.
// This controller also carries the GET detail route
// (OrgDirectoryService.getDetail()) and the three POST lifecycle-action
// routes (suspend/reinstate/archive), because OrgLifecycleService is
// service-only and this is the only controller that fronts it — an org
// detail page needs both a detail endpoint and a way to act on the org.
//
// Route prefix is 'admin/organizations' — sibling to
// OrgRequestsAdminController's 'admin/org-requests', not nested under it;
// same SiteAdminGuard, same "ordinary site-admin work, no
// @RequireSuperAdmin()" reasoning that controller's own header comment
// gives (suspending/archiving an org is consequential, but it isn't the
// admin-account-management tier reserved for @RequireSuperAdmin()).
@UseGuards(SiteAdminGuard)
@Controller('admin/organizations')
export class OrgAdminController {
  constructor(
    private orgDirectoryService: OrgDirectoryService,
    private orgLifecycleService: OrgLifecycleService,
  ) {}

  /**
   * GET /admin/organizations
   * The org directory (the directory page). See
   * OrgDirectoryService.list() for the default-shows-everything behaviour,
   * filtering, and pagination. `?status=` accepts a comma-separated list
   * (e.g. "ACTIVE" or "SUSPENDED,ARCHIVED"); `?search=` matches org_name
   * (case-insensitive substring) or orgid.
   */
  @Get()
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.orgDirectoryService.list({
      status: status
        ? status
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      search,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    });
  }

  /**
   * GET /admin/organizations/:orgid
   * Org detail (the suspend/reinstate screen): the org row, its
   * member/scope/event counts, and the full admin_audit_log trail. See
   * OrgDirectoryService.getDetail().
   */
  @Get(':orgid')
  getDetail(@Param('orgid') orgid: string) {
    return this.orgDirectoryService.getDetail(orgid);
  }

  /**
   * POST /admin/organizations/:orgid/suspend
   * ACTIVE -> SUSPENDED, reversible. Body: OrgLifecycleReasonDto, `reason`
   * required. See OrgLifecycleService.suspend().
   */
  @Post(':orgid/suspend')
  suspend(
    @CurrentUser() admin: JwtUser,
    @Param('orgid') orgid: string,
    @Body() dto: OrgLifecycleReasonDto,
  ) {
    return this.orgLifecycleService.suspend(orgid, admin.admin_id!, dto);
  }

  /**
   * POST /admin/organizations/:orgid/reinstate
   * SUSPENDED -> ACTIVE. Body: OrgLifecycleReasonDto, `reason` optional.
   * See OrgLifecycleService.reinstate().
   */
  @Post(':orgid/reinstate')
  reinstate(
    @CurrentUser() admin: JwtUser,
    @Param('orgid') orgid: string,
    @Body() dto: OrgLifecycleReasonDto,
  ) {
    return this.orgLifecycleService.reinstate(orgid, admin.admin_id!, dto);
  }

  /**
   * POST /admin/organizations/:orgid/archive
   * ACTIVE or SUSPENDED -> ARCHIVED, terminal. Body: OrgLifecycleReasonDto,
   * `reason` required. See OrgLifecycleService.archive().
   */
  @Post(':orgid/archive')
  archive(
    @CurrentUser() admin: JwtUser,
    @Param('orgid') orgid: string,
    @Body() dto: OrgLifecycleReasonDto,
  ) {
    return this.orgLifecycleService.archive(orgid, admin.admin_id!, dto);
  }
}
