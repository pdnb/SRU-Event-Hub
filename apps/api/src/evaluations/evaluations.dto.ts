import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { GuestAccessDto } from '../certificates/certificates.dto';

export const QUESTION_KINDS = ['SECTION', 'RATING', 'SINGLE', 'MULTI', 'TEXT', 'TEXTAREA'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export class QuestionDto {
  @IsIn(QUESTION_KINDS) kind!: QuestionKind;
  @IsString() @MinLength(1) @MaxLength(500) labelTh!: string;
  @IsOptional() @IsString() @MaxLength(1000) helpText?: string | null;
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @IsInt() @Min(2) @Max(10) scaleMax?: number;
  /** SINGLE / MULTI choices. */
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(300, { each: true }) options?: string[];
}

export class FormDto {
  @IsString() @MinLength(1) @MaxLength(300) titleTh!: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string | null;
  @IsOptional() @IsBoolean() isAnonymous?: boolean;
  @IsOptional() @IsBoolean() requireAttendance?: boolean;
  @IsOptional() @IsBoolean() requiredForCertificate?: boolean;
  @IsOptional() @IsDateString() opensAt?: string | null;
  @IsOptional() @IsDateString() closesAt?: string | null;
  /** Omit on create to start from the standard satisfaction questions. */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions?: QuestionDto[];
}

export class FormUpdateDto extends FormDto {
  @IsInt() @Min(1) version!: number;
}

export class FormStatusDto {
  @IsIn(['PUBLISHED', 'CLOSED']) status!: 'PUBLISHED' | 'CLOSED';
}

export class AnswerDto {
  @IsUUID() questionId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) value?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID('all', { each: true }) optionIds?: string[];
  @IsOptional() @IsString() @MaxLength(5000) text?: string;
}

export class SubmitDto {
  @IsUUID() registrationId!: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AnswerDto) answers!: AnswerDto[];
}

export class GuestSubmitDto extends GuestAccessDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AnswerDto) answers!: AnswerDto[];
}

export class RespondQueryDto {
  @IsUUID() registrationId!: string;
}
