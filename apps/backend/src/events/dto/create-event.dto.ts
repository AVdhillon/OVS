import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsDateString,
  IsArray,
  ValidateNested,
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

  /**
   * Scope node within the org where this event is anchored.
   * Optional — omit (or send null) to default to the org's ROOT scope;
   * see EventsService.createEvent()'s resolution of the default.
   */
  @IsOptional()
  @IsInt()
  scope_id?: number | null;

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
   * If true, event is also visible to scopes ABOVE the event scope.
   * Maps to visibility_upward in DB.
   * Mutually exclusive with scope_only — both cannot be true simultaneously.
   */
  @IsOptional()
  @IsBoolean()
  visible_upward?: boolean;

  /**
   * If true, event is visible ONLY to members assigned to the exact event scope.
   * No downward propagation.
   * Backed by the events.scope_only column ("restrict visibility to the
   * current scope only").
   * Mutually exclusive with visible_upward.
   */
  @IsOptional()
  @IsBoolean()
  scope_only?: boolean;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CandidateDto)
  candidates: CandidateDto[];
}
