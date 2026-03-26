import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  first_name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  middle_name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  last_name?: string;

  @IsOptional()
  @Matches(/^[0-9]{10}$/, { message: 'mobile must be a 10-digit number' })
  mobile?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 32)
  country?: string;

  @IsOptional()
  @IsString()
  @Length(0, 32)
  state?: string;
}
