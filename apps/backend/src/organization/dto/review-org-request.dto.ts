import { IsString, IsNotEmpty, IsOptional, Length } from 'class-validator';

// ─── Review Org Request DTO ────────────────────────────────────────────────
// EDIT (Phase 2 — org request staging, subphase 2.5): input for
// OrgRequestsService.reject() / requestInfo(). Shared by both — a rejection
// and a needs-info round trip are the same shape of "decision +
// explanation," they just land the request on a different status (one
// terminal, one not).
//
// org_requests carries two separate free-text fields for a reviewed request
// (see the master schema's org_requests header comment):
//   - review_note is REQUESTER-FACING — the question to answer (NEEDS_INFO)
//     or the reason for refusal (REJECTED). NOT NULL for NEEDS_INFO
//     (chk_org_request_needs_info_note).
//   - admin_audit_log.reason is INTERNAL — never surfaced to the requester,
//     and NOT NULL for both ORG_REQUEST_REJECTED and
//     ORG_REQUEST_INFO_REQUESTED (chk_admin_audit_reason_required).
//
// `reason` below is the requester-facing text (maps to review_note) and is
// required — a REJECTED/NEEDS_INFO with no explanation is a bad experience
// for the requester even on a status where the DB itself wouldn't force one
// (REJECTED has no NOT NULL constraint on review_note). `internal_note` is
// optional: most of the time an admin's internal reason for rejecting IS the
// requester-facing one, so when omitted it falls back to `reason` (see
// OrgRequestsService.resolveReviewNotes()) rather than forcing every admin
// to type the same sentence twice — while still satisfying
// admin_audit_log's own NOT NULL requirement on `reason`. Use `internal_note`
// when the real reason shouldn't be shown to the requester verbatim (e.g.
// "matches a known spam pattern" internally vs. a softer note they see).
export class ReviewOrgRequestDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 2000)
  reason: string;

  @IsOptional()
  @IsString()
  @Length(3, 2000)
  internal_note?: string;
}
