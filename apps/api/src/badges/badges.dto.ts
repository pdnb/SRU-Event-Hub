import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';

const HEX = /^#[0-9a-fA-F]{6}$/;

export class BadgeFieldDto {
  @IsIn(['TEXT', 'QR', 'BAND']) kind!: 'TEXT' | 'QR' | 'BAND';
  @IsOptional() @IsString() @MaxLength(500) content?: string | null;
  @IsNumber() @Min(0) @Max(300) xMm!: number;
  @IsNumber() @Min(0) @Max(300) yMm!: number;
  @IsNumber() @Min(1) @Max(300) wMm!: number;
  @IsNumber() @Min(1) @Max(300) hMm!: number;
  @IsOptional() @IsNumber() @Min(4) @Max(96) fontSize?: number;
  @IsOptional() @IsBoolean() bold?: boolean;
  @IsOptional() @IsIn(['left', 'center', 'right']) align?: 'left' | 'center' | 'right';
  @IsOptional() @Matches(HEX) color?: string | null;
}

export class BadgeColorRuleDto {
  @IsIn(['PARTICIPANT_TYPE', 'PERSONNEL_ROLE', 'ANY']) matchType!: 'PARTICIPANT_TYPE' | 'PERSONNEL_ROLE' | 'ANY';
  @IsOptional() @IsString() @MaxLength(50) matchValue?: string | null;
  @Matches(HEX) color!: string;
  @IsOptional() @IsString() @MaxLength(100) label?: string | null;
}

export class BadgeTemplateDto {
  @IsString() @MinLength(1) @MaxLength(200) nameTh!: string;
  @IsIn(['A4_SHEET', 'LABEL']) paper!: 'A4_SHEET' | 'LABEL';
  @IsNumber() @Min(20) @Max(300) widthMm!: number;
  @IsNumber() @Min(20) @Max(300) heightMm!: number;
  @IsOptional() @Matches(HEX) backgroundColor?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  /** Omit on create to start from the default layout for the size. */
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => BadgeFieldDto) fields?: BadgeFieldDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BadgeColorRuleDto) colorRules?: BadgeColorRuleDto[];
}

export class BadgeTemplateUpdateDto extends BadgeTemplateDto {
  /** Optimistic lock: the version the designer loaded. */
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsBoolean() removeBackground?: boolean;
}

export class BadgePreviewDto {
  /** Draft from the designer (unsaved). */
  @ValidateNested() @Type(() => BadgeTemplateDto) template!: BadgeTemplateDto;
  /** Use this template's saved background image. */
  @IsOptional() @IsUUID() templateId?: string;
}

export class CandidateQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['registration', 'personnel']) kind: 'registration' | 'personnel' = 'registration';
  @IsOptional() @IsUUID() participantTypeId?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @ApiPropertyOptional({ enum: ['yes', 'no'] })
  @IsOptional() @IsIn(['yes', 'no']) printed?: 'yes' | 'no';
}

class PrintFilterDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) participantTypeIds?: string[];
  @IsOptional() @IsUUID() groupId?: string;
  /** Include registrants whose badge was already printed (counts as reprint). */
  @IsOptional() @IsBoolean() includePrinted?: boolean;
  @IsOptional() @IsBoolean() includePersonnel?: boolean;
}

export class PrintJobDto {
  @IsUUID() templateId!: string;
  @IsIn(['BATCH', 'INSTANT', 'REPRINT']) mode!: 'BATCH' | 'INSTANT' | 'REPRINT';
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) registrationIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) personnelIds?: string[];
  @IsOptional() @ValidateNested() @Type(() => PrintFilterDto) filter?: PrintFilterDto;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?: string;
}
