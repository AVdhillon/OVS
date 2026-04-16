import { IsBoolean, IsOptional, IsNumber, IsNotEmpty } from 'class-validator';

export class UpdateMemberDto {
  /**
   * Required. Identifies which scope-role row to update.
   * Corresponds to the scope_id column in member_roles (part of composite PK).
   */
  @IsNumber()
  @IsNotEmpty()
  scope_id: number;

  @IsOptional()
  @IsBoolean()
  is_voter?: boolean;

  @IsOptional()
  @IsBoolean()
  is_organizer?: boolean;
}
