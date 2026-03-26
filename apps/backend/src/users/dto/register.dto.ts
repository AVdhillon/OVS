import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  first_name: string;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  middle_name?: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  last_name: string;

  /**
   * At least one of mobile or email must be supplied.
   * Validation at service level since class-validator can't cross-field easily.
   */
  @IsOptional()
  @Matches(/^[0-9]{10}$/, { message: 'mobile must be a 10-digit number' })
  mobile?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 32)
  country?: string;

  @IsOptional()
  @IsString()
  @Length(0, 32)
  state?: string;

  /**
   * OTP sent to the supplied mobile/email to confirm ownership
   */
  @IsString()
  @IsNotEmpty()
  otp: string;
}
