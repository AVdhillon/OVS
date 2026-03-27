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
   * Parent scope node. If null, attaches to ROOT.
   */
  @IsOptional()
  @IsNumber()
  parent_scope_id?: number;
}

export class UpdateScopeDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  scope_name?: string;

  /**
   * Reattach: provide new parent_scope_id.
   * Pass null explicitly to make it a top-level child of ROOT.
   */
  @IsOptional()
  @IsNumber()
  parent_scope_id?: number | null;
}
