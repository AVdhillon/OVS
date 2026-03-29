import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  Length,
  Matches,
  IsArray,
  ValidateNested,
  IsIn,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Participant row (used in table input) ────────────────────────────────────
export class ParticipantRowDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9]{4,20}$/, {
    message: 'uid must be 4–20 uppercase alphanumeric characters',
  })
  uid: string;

  @IsOptional()
  @Matches(/^[0-9]{10}$/, { message: 'mobile must be 10 digits' })
  mobile?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /**
   * 'v' = voter only (default), 'vo' = voter + organizer
   */
  @IsOptional()
  @IsIn(['v', 'vo'])
  role?: 'v' | 'vo';
}

// ─── Register Org DTO ─────────────────────────────────────────────────────────
export class RegisterOrgDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  org_name: string;

  @IsOptional()
  @IsEmail()
  org_email?: string;

  /**
   * Optional preferred prefix (3 uppercase letters).
   * If not provided, first 3 letters of org_name are used.
   */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'org_prefix must be exactly 3 uppercase letters' })
  org_prefix?: string;

  /**
   * Optional preferred 4-digit suffix.
   * If not provided, a random 4-digit number is generated.
   */
  @IsOptional()
  @Matches(/^[0-9]{4}$/, { message: 'org_suffix must be exactly 4 digits' })
  org_suffix?: string;

  
  @IsOptional()
  @Matches(/^[A-Z]{3}[0-9]{4}$/, {
    message: 'preferred_orgid must be in format ABC1234',
  })
  preferred_orgid?: string;
  /**
   * Participants to seed into org_members.
   * The submitter is always added as voter+organizer at ROOT scope.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParticipantRowDto)
  participants?: ParticipantRowDto[];

  /**
   * Alternatively, paste/import raw CSV text.
   * Header row: uid,mobile,email,role
   * role defaults to 'v' if absent.
   */
  @IsOptional()
  @IsString()
  participants_csv?: string;
}
