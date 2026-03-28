import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  first_name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  middle_name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  last_name?: string;

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

  @ValidateIf((o) => o.email !== undefined)
  @IsString()
  @Length(6, 6, { message: 'email_otp must be 6 digits' })
  email_otp?: string;

  @ValidateIf((o) => o.mobile !== undefined)
  @IsString()
  @Length(6, 6, { message: 'mobile_otp must be 6 digits' })
  mobile_otp?: string;
}