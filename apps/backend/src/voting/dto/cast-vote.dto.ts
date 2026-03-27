// dto/cast-vote.dto.ts
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CastVoteDto {
  @IsInt()
  event_id: number;

  @IsInt()
  candidate_id: number;

  /**
   * The org + uid the caller is voting as.
   * Required — a user may belong to multiple orgs so must declare context.
   */
  @IsString()
  @IsNotEmpty()
  orgid: string;

  @IsString()
  @IsNotEmpty()
  uid: string;

  /**
   * Optional client-side device fingerprint for fraud detection.
   */
  @IsOptional()
  @IsString()
  device_fingerprint?: string;
}
