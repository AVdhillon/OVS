import { IsString, IsOptional } from 'class-validator';

export class LoginDto {
  @IsString()
  type: 'UNIFIED' | 'ORG' | 'GOV';

  @IsOptional()
  identifier?: string; // mobile/email

  @IsOptional()
  orgid?: string;

  @IsOptional()
  uid?: string;

  @IsOptional()
  epic_id?: string;
}