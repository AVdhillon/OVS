import { IsString } from 'class-validator';

export class SendOtpDto {
  @IsString()
  identifier: string; // mobile or email
}