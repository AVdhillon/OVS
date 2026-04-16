import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
  IsNumber,
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
   * Defaults to the caller's first organizer scope if not provided.
   */
  @IsOptional()
  @IsNumber()
  scope_id?: number;
}
