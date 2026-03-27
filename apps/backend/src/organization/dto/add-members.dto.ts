import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ParticipantRowDto } from './register-org.dto';

export class AddMembersDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParticipantRowDto)
  participants?: ParticipantRowDto[];

  @IsOptional()
  @IsString()
  participants_csv?: string;

  /**
   * scope_id to assign to all added members.
   * Defaults to the org's ROOT scope if not provided.
   */
  @IsOptional()
  scope_id?: number;
}
