import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class AddIdentityDto {
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
