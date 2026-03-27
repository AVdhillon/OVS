import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsNumber,
} from 'class-validator';

export class UpdateMemberDto {
  @IsOptional()
  @IsBoolean()
  is_voter?: boolean;

  @IsOptional()
  @IsBoolean()
  is_organizer?: boolean;

  /**
   * New scope_id to assign (must be within caller's scope subtree)
   */
  @IsOptional()
  @IsNumber()
  scope_id?: number;
}
