import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Length,
} from 'class-validator';

export class CreateScopeDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  scope_name: string;

  /**
   * Parent scope node. If null/omitted, attaches as child of caller's scope node.
   */
  @IsOptional()
  @IsNumber()
  parent_scope_id?: number;
}

// Removed parent_scope_id entirely.
// Project design: "Scope is a fixed tree — nodes are not moved."
// Node reattachment is explicitly not supported to keep the tree stable
// and avoid expensive subtree restructuring. Only renaming is allowed.
export class UpdateScopeDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  scope_name?: string;
}
