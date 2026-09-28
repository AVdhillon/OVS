// organization/dto/member-role.dto.ts
// DTOs for the addMemberRole and moveMemberRole endpoints.

import { IsBoolean, IsNumber, IsNotEmpty, IsOptional } from 'class-validator';

export class AddMemberRoleDto {
  /**
   * The scope to assign the member to.
   */
  @IsNumber()
  @IsNotEmpty()
  scope_id: number;

  @IsBoolean()
  is_voter: boolean;

  @IsBoolean()
  is_organizer: boolean;
}

export class MoveMemberRoleDto {
  /**
   * The scope assignment to move away from.
   */
  @IsNumber()
  @IsNotEmpty()
  from_scope_id: number;

  /**
   * The scope assignment to move to.
   * Must not already have an assignment for this member.
   */
  @IsNumber()
  @IsNotEmpty()
  to_scope_id: number;

  /**
   * Override voter role at the new scope.
   * If omitted, the existing is_voter value is carried over.
   */
  @IsOptional()
  @IsBoolean()
  is_voter?: boolean;

  /**
   * Override organizer role at the new scope.
   * If omitted, the existing is_organizer value is carried over.
   */
  @IsOptional()
  @IsBoolean()
  is_organizer?: boolean;
}
