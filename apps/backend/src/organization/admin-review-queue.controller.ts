import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminReviewQueueService } from './admin-review-queue.service';
import { SiteAdminGuard } from '../auth/guards/site-admin.guard';

// ─── Unified admin review queue  ─────────────────
// Uses a separate top-level
// 'admin/review-queue' prefix, not a route nested under
// OrgRequestsAdminController's 'admin/org-requests' — this queue is a view
// over both org_requests AND org_member_limit_requests, so nesting it under
// either table's own admin route prefix would misrepresent it as belonging
// to just one. Same SiteAdminGuard-only gating as
// OrgRequestsAdminController — reading the queue is ordinary site-admin
// work, not the elevated tier admin-account-management endpoints require.
@UseGuards(SiteAdminGuard)
@Controller('admin/review-queue')
export class AdminReviewQueueController {
  constructor(private adminReviewQueueService: AdminReviewQueueService) {}

  /**
   * GET /admin/review-queue
   * The merged queue (the queue-with-badges list): every open org-creation
   * request (org_requests) and every open member-limit-increase request
   * (org_member_limit_requests) in one page of results, each row tagged
   * with `request_type` so the frontend knows which detail/approve/reject
   * screen a click-through should land on (the two review screens stay
   * separate components; only this list is unified).
   * Defaults to open requests only; see
   * AdminReviewQueueService.list()/resolveStatusFilter() for the
   * default/filter/paging behaviour. ?status= and ?request_type= each accept
   * a comma-separated list.
   */
  @Get()
  list(
    @Query('status') status?: string,
    @Query('request_type') requestType?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.adminReviewQueueService.list({
      status: this.splitParam(status),
      requestType: this.splitParam(requestType),
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    });
  }

  // Same comma-split shape as OrgRequestsAdminController.list()'s own
  // ?status= handling.
  private splitParam(value?: string): string[] | undefined {
    return value
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  }
}
