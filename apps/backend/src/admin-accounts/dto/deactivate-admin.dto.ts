import { IsString, IsNotEmpty, Length } from 'class-validator';

// ─── Deactivate Admin DTO ───────────────────────────────────────────────────
// EDIT (Phase 5 — platform maturity, subphase 5.3): input for
// AdminAccountsService.deactivateAdmin() /
// POST /admin/admins/:adminId/deactivate.
//
// `reason` is required — chk_admin_audit_reason_required lists
// ADMIN_DEACTIVATED among the actions admin_audit_log.reason must be NOT
// NULL for (the same list ORG_SUSPENDED/ORG_ARCHIVED are on), and
// deactivating someone's admin access without saying why is exactly the
// kind of adverse action that constraint exists to force a justification
// for. @IsNotEmpty() only rejects the literal empty string, not a
// whitespace-only one — same gap ReviewOrgRequestDto/OrgLifecycleReasonDto
// already carry — so AdminAccountsService.requireReason() re-trims and
// re-checks before this ever reaches the database, same precedent
// OrgRequestsService.resolveReviewNotes() established.
export class DeactivateAdminDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 2000)
  reason: string;
}
