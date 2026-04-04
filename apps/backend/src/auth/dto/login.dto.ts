import { IsIn, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  /**
   * Login type: UNIFIED (mobile/email), ORG (orgid+uid), GOV (epic_id).
   */
  @IsIn(['UNIFIED', 'ORG', 'GOV'])
  type: 'UNIFIED' | 'ORG' | 'GOV';

  /**
   * UNIFIED only — the mobile number or email the account is registered with.
   * OTP will be sent to this address.
   * Not used for ORG or GOV logins; contact is resolved server-side from the
   * identity record (org_members.email/mobile or gov_identity.email/mobile).
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

  // ── GOV-specific ──────────────────────────────────────────────────────────
  /** Voter EPIC ID. Required when type === 'GOV'. */
  @IsOptional()
  @IsString()
  epic_id?: string;
}
