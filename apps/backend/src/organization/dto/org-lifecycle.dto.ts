import { IsString, IsOptional, Length } from 'class-validator';

// ─── Org Lifecycle Action DTO ─────────────────────────────────────────────
// Input for
// OrgLifecycleService.suspend() / reinstate() / archive().
//
// Unlike ReviewOrgRequestDto (org_requests), an organization row has no
// requester-facing note column to split a reason across — admin_audit_log
// is the only place a lifecycle reason is ever written, and it is
// internal-facing by definition (never surfaced to the org itself). One
// field is enough here; ReviewOrgRequestDto's two-field split doesn't apply
// to this table.
//
// `reason` is deliberately optional at the DTO/validation level even though
// the master schema's chk_admin_audit_reason_required makes it NOT NULL for
// ORG_SUSPENDED and ORG_ARCHIVED specifically (ORG_REINSTATED is not in
// that CHECK's list — see the schema's own comment on the constraint).
// Whether a given action actually requires it is therefore an OrgLifecycle-
// Service-level decision, not a DTO-level one: a single shared class lets
// suspend()/reinstate()/archive() all bind the same request body shape and
// each enforce (or not) the requirement itself — same reasoning
// OrgRequestsService.resolveReviewNotes() already uses for its own
// required/optional split.
export class OrgLifecycleReasonDto {
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  reason?: string;
}
