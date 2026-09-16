import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { OrgRequestsService } from './org-requests.service';
import { ReviewOrgRequestDto } from './dto/review-org-request.dto';
import { SiteAdminGuard } from '../auth/guards/site-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/decorators/current-user.decorator';

// ─── Org request admin routes (Phase 3 — admin portal core) ──────────────────
// EDIT (Phase 3 — admin portal core, subphase 3.1): new controller.
//
// Wiring only, as the plan calls for — every route here is a thin
// pass-through to OrgRequestsService: submit() (2.3) has its own route in
// 4.1 on the requester-facing side, and approve()/reject()/requestInfo()
// (2.4/2.5) plus the new list()/getDetail() read methods (added in this
// subphase, alongside this controller, since Phase 2 was write-path-only)
// are wired up here.
//
// Every route is gated by SiteAdminGuard only — no @RequireSuperAdmin().
// Reviewing org requests is ordinary site-admin work, not the elevated
// tier Phase 5.3's admin-account-management endpoints (inviting/
// deactivating other admins) will require.
//
// Route prefix is 'admin/org-requests', a new top-level prefix rather than
// nesting under OrgController's existing 'org' routes: this is the admin
// app's surface (served from its own origin — 1.3's ADMIN_ALLOWED_ORIGINS —
// and calling in with the ovp_admin_token/ovp_admin_csrf cookie pair, not
// ovp_token/ovp_csrf), and OrgController is gated by JwtAuthGuard for
// UNIFIED/ORG sessions specifically, not SITEADMIN ones.
@UseGuards(SiteAdminGuard)
@Controller('admin/org-requests')
export class OrgRequestsAdminController {
  constructor(private orgRequestsService: OrgRequestsService) {}

  /**
   * GET /admin/org-requests
   * The review queue (3.5's request-queue page). Defaults to open requests
   * only; see OrgRequestsService.list() for the default/filter/paging
   * behaviour. ?status= accepts a comma-separated list, e.g.
   * "PENDING,NEEDS_INFO" (already the default) or "APPROVED,REJECTED" for a
   * closed-request history view.
   */
  @Get()
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.orgRequestsService.list({
      status: status
        ? status
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    });
  }

  /**
   * GET /admin/org-requests/:requestId
   * Request detail (3.5's detail page): the request, requester contact
   * info, reviewing admin, and the full admin_audit_log trail. See
   * OrgRequestsService.getDetail().
   */
  @Get(':requestId')
  getDetail(@Param('requestId') requestId: string) {
    return this.orgRequestsService.getDetail(this.parseRequestId(requestId));
  }

  /**
   * POST /admin/org-requests/:requestId/approve
   * Creates the organization. See OrgRequestsService.approve() (2.4). No
   * request body — approve() takes no reviewer-supplied text, unlike
   * reject()/requestInfo() below (the request row itself is the
   * justification, per admin_audit_log's own chk_admin_audit_reason_required
   * — approve isn't in that CHECK's required-reason list).
   */
  @Post(':requestId/approve')
  approve(
    @CurrentUser() admin: JwtUser,
    @Param('requestId') requestId: string,
  ) {
    return this.orgRequestsService.approve(
      this.parseRequestId(requestId),
      admin.admin_id!,
    );
  }

  /**
   * POST /admin/org-requests/:requestId/reject
   * Terminal, no organization created. Body is a ReviewOrgRequestDto — see
   * that file for why `reason` (requester-facing) and `internal_note`
   * (audit-log-only) are separate fields. See OrgRequestsService.reject()
   * (2.5).
   */
  @Post(':requestId/reject')
  reject(
    @CurrentUser() admin: JwtUser,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewOrgRequestDto,
  ) {
    return this.orgRequestsService.reject(
      this.parseRequestId(requestId),
      admin.admin_id!,
      dto,
    );
  }

  /**
   * POST /admin/org-requests/:requestId/request-info
   * Non-terminal — the request goes back to NEEDS_INFO for the requester to
   * edit and resubmit (4.7). Same ReviewOrgRequestDto body as reject(). See
   * OrgRequestsService.requestInfo() (2.5).
   */
  @Post(':requestId/request-info')
  requestInfo(
    @CurrentUser() admin: JwtUser,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewOrgRequestDto,
  ) {
    return this.orgRequestsService.requestInfo(
      this.parseRequestId(requestId),
      admin.admin_id!,
      dto,
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * org_requests.request_id is BIGSERIAL, so the service layer works in
   * `bigint` throughout (matches approve()/reject()/requestInfo()'s own
   * signatures) — but unlike the JWT-derived `pid` conversions elsewhere in
   * this codebase (auth.service.ts, org.controller.ts), a route param comes
   * straight from the URL with nothing having validated it first. A bare
   * `BigInt(requestId)` on a non-numeric segment throws a raw SyntaxError,
   * which has no NestJS HttpException status and would surface as an
   * unhandled 500 instead of a 400. Guarded here rather than left to that.
   */
  private parseRequestId(requestId: string): bigint {
    if (!/^\d+$/.test(requestId)) {
      throw new BadRequestException(`Invalid request id: ${requestId}`);
    }
    return BigInt(requestId);
  }
}
