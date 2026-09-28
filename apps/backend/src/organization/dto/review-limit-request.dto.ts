import { IsString, IsNotEmpty, Length } from 'class-validator';

// ─── Review Member Limit Request DTO ───────────────────────────────────────
// Input for
// OrgLimitRequestsService.reject() / requestInfo(), both of which take
// a single `reason: string` — unlike ReviewOrgRequestDto (org_requests),
// there is deliberately no separate `internal_note` field here.
//
// See OrgLimitRequestsService.resolveReviewNote()'s own comment for
// why: reject()/requestInfo() take a single `reason` parameter, not a
// requester-facing/internal-note pair, so this DTO mirrors that signature.
// The one string written
// here lands as BOTH org_member_limit_requests.review_note (organizer-
// facing) and admin_audit_log.reason (internal) — same value, two columns.
// If org_requests' public/internal split is ever wanted for this
// table too, both this DTO and the service methods it feeds need to grow a
// second field together, not just one or the other.
export class ReviewLimitRequestDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 2000)
  reason: string;
}
