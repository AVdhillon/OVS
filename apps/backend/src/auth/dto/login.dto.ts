import { IsIn, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  /**
   * Login type: UNIFIED (mobile/email) or ORG (orgid+uid).
   *
   * EDIT (Phase 1 — auth model consolidation, subphase 1.2): GOV retired
   * platform-wide (see prisma/migrations/manual/gov-removal-schema-changes.sql,
   * subphase 1.1) — `epic_id` and the 'GOV' branch are gone from this DTO.
   * Site-admin login is intentionally NOT a third value of this `type`
   * union — see SiteAdminLoginDto below for why it's a separate class.
   */
  @IsIn(['UNIFIED', 'ORG'])
  type: 'UNIFIED' | 'ORG';

  /**
   * UNIFIED only — the mobile number or email the account is registered with.
   * OTP will be sent to this address.
   * Not used for ORG login; contact is resolved server-side from the
   * identity record (org_members.email/mobile).
   */
  @IsOptional()
  @IsString()
  identifier?: string;

  /**
   * The 6-digit OTP received at the resolved contact address.
   * Omit when calling /auth/send-login-otp (OTP not yet issued).
   */
  @IsOptional()
  @IsString()
  otp?: string;

  // ── ORG-specific ──────────────────────────────────────────────────────────
  /** Organization ID (e.g. ABC1234). Required when type === 'ORG'. */
  @IsOptional()
  @IsString()
  orgid?: string;

  /** Member's personal ID within the org. Required when type === 'ORG'. */
  @IsOptional()
  @IsString()
  uid?: string;
}

/**
 * Login DTO for the standalone admin app (SITEADMIN session type).
 *
 * EDIT (Phase 1 — auth model consolidation, subphase 1.2): new, backing the
 * `site_admins` table added in subphase 1.1. Deliberately a SEPARATE class
 * from LoginDto rather than a third `type: 'SITEADMIN'` value on it:
 *   - Site-admin login has its own shape (admin_id — no identifier/orgid/uid
 *     ambiguity to validate against) and its own endpoint on the admin
 *     subdomain (wired in subphase 1.3), so there's no client that would
 *     ever need to submit the two shapes interchangeably.
 *   - Keeping it separate means LoginDto's `type` union — and every switch
 *     over it in auth.service.ts — stays exhaustive over the two identities
 *     an ordinary user can log in as, without a SITEADMIN case that would
 *     be unreachable from the public-facing login endpoint anyway.
 *
 * Same OTP pattern as ORG login: the client supplies the identity
 * (admin_id), and the OTP is sent to the contact already on file
 * (site_admins.email/mobile) — never a client-supplied address. See
 * AuthService.resolveSiteAdminOtpIdentifier().
 */
export class SiteAdminLoginDto {
  /** Admin ID (e.g. SA0001). Always required. */
  @IsString()
  admin_id: string;

  /**
   * The 6-digit OTP received at the resolved contact address.
   * Omit when calling the send-otp counterpart (OTP not yet issued).
   */
  @IsOptional()
  @IsString()
  otp?: string;
}
