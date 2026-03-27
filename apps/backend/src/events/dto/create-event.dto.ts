// dto/create-event.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsDateString,
  IsArray,
  ValidateNested,
  MinLength,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CandidateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  candidate_name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateEventDto {
  /** Which org this event belongs to */
  @IsString()
  @IsNotEmpty()
  orgid: string;

  /** The uid the caller is acting as (must be organizer in that org) */
  @IsString()
  @IsNotEmpty()
  uid: string;

  /** Scope node within the org where this event is anchored */
  @IsInt()
  scope_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** ISO 8601 datetime string */
  @IsDateString()
  start_time: string;

  /** ISO 8601 datetime string */
  @IsDateString()
  end_time: string;

  @IsOptional()
  @IsBoolean()
  show_live_results?: boolean;

  /**
   * If true, the event is also visible to scopes ABOVE the event scope
   * (visibility_upward in DB).
   */
  @IsOptional()
  @IsBoolean()
  visible_upward?: boolean;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CandidateDto)
  candidates: CandidateDto[];
}
