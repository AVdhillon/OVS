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

// ─── Org admin routes (Phase 3 — admin portal core, subphase 3.3) ─────────
// EDIT: new controller. The plan describes this subphase as adding "the
// GET /admin/organizations directory endpoint" — the directory (list())
// route below is that. **Deviation, flagged rather than silent, same shape
// as 3.1's own list()/getDetail() addition:** the plan's own dependency
// note says 3.6 ("org directory page + org detail page (suspend/
// reinstate)") depends on *both* 3.2 and 3.3, and 3.2 explicitly deferred
// all controller wiring to "later" — there is no other subphase in the
// plan that adds routes for OrgLifecycleService's suspend()/reinstate()/
// archive(). Rather than leave 3.6 with no way to actually call them, this
// controller also gets: a GET detail route (OrgDirectoryService.getDetail(),
// added alongside this controller for the same reason 3.1's getDetail()
// was — a detail page needs a detail endpoint) and the three POST
// lifecycle-action routes. If a future subphase was meant to own these
// specifically, this is where to look for them instead.
//
// Route prefix is 'admin/organizations' — sibling to
// OrgRequestsAdminController's 'admin/org-requests', not nested under it;
// same SiteAdminGuard, same "ordinary site-admin work, no
// @RequireSuperAdmin()" reasoning that controller's own header comment
// gives (suspending/archiving an org is consequential, but it isn't the
// admin-account-management tier Phase 5.3 reserves for @RequireSuperAdmin()).
@UseGuards(SiteAdminGuard)
@Controller('admin/organizations')
export class OrgAdminController {
  constructor(
    private orgDirectoryService: OrgDirectoryService,
    private orgLifecycleService: OrgLifecycleService,
  ) {}

  /**
   * GET /admin/organizations
   * The org directory (3.6's directory page). See
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
   * Org detail (3.6's suspend/reinstate screen): the org row, its
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
   * required. See OrgLifecycleService.suspend() (3.2).
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
   * See OrgLifecycleService.reinstate() (3.2).
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
   * `reason` required. See OrgLifecycleService.archive() (3.2).
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
