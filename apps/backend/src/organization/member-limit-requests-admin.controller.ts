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
import { OrgLimitRequestsService } from './org-limit-requests.service';
import { ReviewLimitRequestDto } from './dto/review-limit-request.dto';
import { SiteAdminGuard } from '../auth/guards/site-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/decorators/current-user.decorator';

// ─── Member limit request admin routes (Phase 7 — Member Limit Increase
// Requests, subphase 7.3) ──────────────────────────────────────────────────
// EDIT (subphase 7.3): new controller — the admin-facing counterpart to
// org.controller.ts's submitLimitRequest()/listLimitRequestsForOrg() routes.
// A separate controller from OrgRequestsAdminController rather than new
// routes bolted onto it, per the plan's own 7.3 text ("new controller keeps
// the 'requests about orgs that don't exist yet' vs. 'requests about
// existing orgs' split clean") — same reasoning
// org-requests.service.ts/org-limit-requests.service.ts already used to stay
// two services instead of one.
//
// Route prefix is 'admin/member-limit-requests', a sibling top-level prefix
// to 'admin/org-requests' rather than nested under it — same flat-prefix-
// per-request-kind convention, and it mirrors 7.1b's own
// 'admin/review-queue' prefix choice for the unified queue view.
//
// SiteAdminGuard only, no elevated tier — reviewing a member-limit request
// is ordinary site-admin work, same treatment as every route on
// OrgRequestsAdminController.
@UseGuards(SiteAdminGuard)
@Controller('admin/member-limit-requests')
export class MemberLimitRequestsAdminController {
  constructor(private limitRequestsService: OrgLimitRequestsService) {}

  /**
   * GET /admin/member-limit-requests
   * The review queue for this table specifically — see
   * OrgLimitRequestsService.list() for default/filter/paging behaviour.
   * ?status= accepts a comma-separated list, same convention as
   * OrgRequestsAdminController.list(). For the *combined* queue (both
   * org_requests and org_member_limit_requests together), see 7.1b's
   * GET /admin/review-queue instead — that view is what the queue-landing
   * UI reads from; this route is for drilling into this table alone, or for
   * a UI that never adopts the unified view.
   */
  @Get()
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.limitRequestsService.list({
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
   * GET /admin/member-limit-requests/:requestId
   * Request detail — the request row, the org's name, the requesting
   * member's identity, the reviewing admin if reviewed, and the full
   * admin_audit_log trail. See OrgLimitRequestsService.getDetail().
   */
  @Get(':requestId')
  getDetail(@Param('requestId') requestId: string) {
    return this.limitRequestsService.getDetail(this.parseRequestId(requestId));
  }

  /**
   * POST /admin/member-limit-requests/:requestId/approve
   * Raises organization.member_limit to the requested value — see
   * OrgLimitRequestsService.approve(). No body: unlike
   * OrgRequestsAdminController's approve() (which needs an admin-chosen
   * member_limit, since org_requests has no requested number of its own),
   * this table already carries requested_limit on the row itself — there is
   * nothing left for the admin to supply.
   */
  @Post(':requestId/approve')
  approve(@CurrentUser() admin: JwtUser, @Param('requestId') requestId: string) {
    return this.limitRequestsService.approve(
      this.parseRequestId(requestId),
      admin.admin_id!,
    );
  }

  /**
   * POST /admin/member-limit-requests/:requestId/reject
   * Terminal, no member_limit change. Body is a ReviewLimitRequestDto (a
   * single required `reason` — see that DTO's own header comment for why
   * there's no separate internal_note field here, unlike
   * ReviewOrgRequestDto). See OrgLimitRequestsService.reject().
   */
  @Post(':requestId/reject')
  reject(
    @CurrentUser() admin: JwtUser,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewLimitRequestDto,
  ) {
    return this.limitRequestsService.reject(
      this.parseRequestId(requestId),
      admin.admin_id!,
      dto.reason,
    );
  }

  /**
   * POST /admin/member-limit-requests/:requestId/needs-info
   * EDIT (subphase 7.3): route segment is 'needs-info', matching the plan's
   * own literal 7.3 text ("[/:id/approve|reject|needs-info]") — note this
   * diverges from OrgRequestsAdminController's equivalent route, which is
   * named 'request-info'. Flagging the inconsistency rather than silently
   * picking one: kept as the plan wrote it for this controller instead of
   * forcing consistency with the other one unasked. Non-terminal — the
   * request goes back to NEEDS_INFO for the organizer to address. Same
   * ReviewLimitRequestDto body as reject(). See
   * OrgLimitRequestsService.requestInfo().
   */
  @Post(':requestId/needs-info')
  requestInfo(
    @CurrentUser() admin: JwtUser,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewLimitRequestDto,
  ) {
    return this.limitRequestsService.requestInfo(
      this.parseRequestId(requestId),
      admin.admin_id!,
      dto.reason,
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Same guard, same reasoning, as
   * OrgRequestsAdminController.parseRequestId() — org_member_limit_requests.
   * request_id is BIGSERIAL, so the service layer works in `bigint`, but a
   * route param is unvalidated raw text; a bare `BigInt(requestId)` on a
   * non-numeric segment throws a raw SyntaxError instead of a clean 400.
   */
  private parseRequestId(requestId: string): bigint {
    if (!/^\d+$/.test(requestId)) {
      throw new BadRequestException(`Invalid request id: ${requestId}`);
    }
    return BigInt(requestId);
  }
}
