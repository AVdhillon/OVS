import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  /**
   * Login type: UNIFIED (mobile/email), ORG (orgid+uid), GOV (epic_id)
   */
  @IsIn(['UNIFIED', 'ORG', 'GOV'])
  type: 'UNIFIED' | 'ORG' | 'GOV';

  /**
   * The contact identifier the OTP was sent to.
   * UNIFIED → mobile or email
   * ORG     → the mobile/email on file for that org member
   * GOV     → the mobile/email on file for that EPIC ID
   */
  @IsString()
  @IsNotEmpty()
  identifier: string;

  /**
   * The 6-digit OTP received on the identifier above.
   */
  @IsString()
  @IsNotEmpty()
  otp: string;

  // ── ORG-specific ──────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  orgid?: string;

  @IsOptional()
  @IsString()
  uid?: string;

  // ── GOV-specific ──────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  epic_id?: string;
}
