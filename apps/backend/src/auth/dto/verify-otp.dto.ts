import { IsString } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  identifier: string;

  @IsString()
  otp: string;
}