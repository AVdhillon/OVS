import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class AddIdentityDto {
  @IsIn(['ORG', 'GOV'])
  identity_type: 'ORG' | 'GOV';

  /**
   * orgid for ORG type, epic_id for GOV type
   */
  @IsString()
  @IsNotEmpty()
  identity_id: string;

  /**
   * Required only for ORG type — the member's uid within that org
   */
  @ValidateIf((o) => o.identity_type === 'ORG')
  @IsString()
  @IsNotEmpty()
  uid?: string;

  /**
   * OTP sent to the contact bound to the target identity (mobile/email)
   */
  @IsString()
  @IsNotEmpty()
  otp: string;

  /**
   * The identifier (mobile or email) the OTP was sent to.
   * For ORG/GOV logins this is the contact on file for that identity.
   */
  @IsString()
  @IsNotEmpty()
  identifier: string;
}
