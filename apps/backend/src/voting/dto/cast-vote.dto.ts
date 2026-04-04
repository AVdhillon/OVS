// dto/cast-vote.dto.ts
import { IsInt, IsOptional, IsString } from 'class-validator';

export class CastVoteDto {
  @IsInt()
  event_id: number;

  @IsInt()
  candidate_id: number;
  /**
   * Optional client-side device fingerprint for fraud detection.
   */
  @IsOptional()
  @IsString()
  device_fingerprint?: string;
}
