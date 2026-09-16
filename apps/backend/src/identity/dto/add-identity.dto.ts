import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class AddIdentityDto {
  // EDIT (Phase 1 — auth model consolidation, subphase 1.4): GOV retired
  // platform-wide (gov_identity dropped in subphase 1.1) — only ORG
  // identities can be linked into a unified account's wallet now. Matches
  // identity_wallet's chk_identity_type CHECK constraint (subphase 1.1),
  // which likewise only accepts 'ORG'.
  @IsIn(['ORG'])
  identity_type: 'ORG';

  /**
   * orgid — the org this identity belongs to.
   */
  @IsString()
  @IsNotEmpty()
  identity_id: string;

  /**
   * The member's uid within that org. Required — every AddIdentityDto is
   * now an ORG identity (see identity_type above).
   */
  @IsString()
  @IsNotEmpty()
  uid: string;

  /**
   * OTP sent to the contact bound to the target identity (mobile/email)
   */
  @IsString()
  @IsNotEmpty()
  otp: string;

  /**
   * The identifier (mobile or email) the OTP was sent to.
   * This is the contact on file for the org member record being linked.
   */
  @IsString()
  @IsNotEmpty()
  identifier: string;
}
