// dto/add-candidate.dto.ts
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class AddCandidateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  candidate_name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
