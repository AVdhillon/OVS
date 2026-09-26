import { IsString, IsNotEmpty, Length } from 'class-validator';

// ─── Review Member Limit Request DTO ───────────────────────────────────────
// EDIT (Phase 7 — Member Limit Increase Requests, subphase 7.3): input for
// OrgLimitRequestsService.reject() / requestInfo(), both of which (7.2) take
// a single `reason: string` — unlike ReviewOrgRequestDto (org_requests),
// there is deliberately no separate `internal_note` field here.
//
// See OrgLimitRequestsService.resolveReviewNote()'s own comment (7.2) for
// why: the plan's 7.2 text gives reject()/requestInfo() a single `reason`
// parameter, not a requester-facing/internal-note pair, so this DTO mirrors
// that signature rather than getting ahead of it. The one string written
// here lands as BOTH org_member_limit_requests.review_note (organizer-
// facing) and admin_audit_log.reason (internal) — same value, two columns.
// If a future subphase wants org_requests' public/internal split for this
// table too, both this DTO and the service methods it feeds need to grow a
// second field together, not just one or the other.
export class ReviewLimitRequestDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 2000)
  reason: string;
}
