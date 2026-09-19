import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { SiteAdminGuard } from '../auth/guards/site-admin.guard';

// ─── Analytics routes (Phase 5 — platform maturity, subphase 5.2) ──────────
// EDIT: new controller. Prefix 'admin/analytics' — a fourth sibling
// alongside 3.1's 'admin/org-requests', 3.3's 'admin/organizations' and
// 5.1's 'admin/audit', behind the same plain @UseGuards(SiteAdminGuard) for
// the same reason all three give: ordinary site-admin work, not the tier
// Phase 5.3 reserves @RequireSuperAdmin() for. Aggregate counts are, if
// anything, the least sensitive thing any admin route here returns — no
// individual row survives either query.
//
// Both routes are GETs, and this module has no write path at all.
@UseGuards(SiteAdminGuard)
@Controller('admin/analytics')
export class AnalyticsAdminController {
  constructor(private analyticsService: AnalyticsService) {}

  /**
   * GET /admin/analytics/summary
   * Current-state headline counts: organizations and events by status,
   * org requests by status (plus a derived `open`), total ballots cast,
   * accounts, memberships, and active site admins. No parameters — this is
   * "right now" by definition. See AnalyticsService.getSummary().
   */
  @Get('summary')
  getSummary() {
    return this.analyticsService.getSummary();
  }

  /**
   * GET /admin/analytics/series
   * One time-bucketed series.
   *   ?metric=organizations|org_requests|events|ballots|accounts
   *                                          (default: organizations)
   *   ?interval=day|week|month               (default: month)
   *   ?from=&to=                             (ISO-8601; default: last 12
   *                                           months ending now)
   * Buckets are zero-filled, so `points` is dense across the whole range.
   * See AnalyticsService.getSeries() — in particular its note on what
   * "orgs-by-status over time" does and does not mean, since the status
   * shown is each row's *current* one, not its status during that bucket.
   */
  @Get('series')
  getSeries(
    @Query('metric') metric?: string,
    @Query('interval') interval?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getSeries({ metric, interval, from, to });
  }
}
