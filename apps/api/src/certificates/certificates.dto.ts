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
import { PersonnelRole } from '../generated/prisma/client';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ROLES = Object.values(PersonnelRole);

export class CertFieldDto {
  @IsIn(['TEXT', 'QR']) kind!: 'TEXT' | 'QR';
  @IsOptional() @IsString() @MaxLength(1000) content?: string | null;
  @IsNumber() @Min(0) @Max(500) xMm!: number;
  @IsNumber() @Min(0) @Max(500) yMm!: number;
  @IsNumber() @Min(1) @Max(500) wMm!: number;
  @IsNumber() @Min(1) @Max(500) hMm!: number;
  @IsOptional() @IsNumber() @Min(4) @Max(120) fontSize?: number;
  @IsOptional() @IsBoolean() bold?: boolean;
  @IsOptional() @IsIn(['left', 'center', 'right']) align?: 'left' | 'center' | 'right';
  @IsOptional() @Matches(HEX) color?: string | null;
  /** Ignored (array order decides); accepted so a loaded template can be sent back as-is. */
  @IsOptional() @IsInt() sortOrder?: number;
}

export class CertTemplateDto {
  @IsString() @MinLength(1) @MaxLength(200) nameTh!: string;
  @IsIn(['PARTICIPANT', 'PERSONNEL']) audience!: 'PARTICIPANT' | 'PERSONNEL';
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsIn(ROLES, { each: true }) personnelRoles?: PersonnelRole[];
  @IsNumber() @Min(50) @Max(500) widthMm!: number;
  @IsNumber() @Min(50) @Max(500) heightMm!: number;
  @IsOptional() @Matches(HEX) backgroundColor?: string | null;
  /** Omit on create to start from the default layout. */
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => CertFieldDto) fields?: CertFieldDto[];
  @IsOptional() @IsBoolean() requireAttendance?: boolean;
  @IsOptional() @IsBoolean() countLate?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(100) minSessionPercent?: number | null;
  @IsOptional() @IsBoolean() requireEvaluation?: boolean;
  @IsOptional() @IsBoolean() allowSelfClaim?: boolean;
}

export class CertTemplateUpdateDto extends CertTemplateDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsBoolean() removeBackground?: boolean;
}

export class CertPreviewDto {
  @ValidateNested() @Type(() => CertTemplateDto) template!: CertTemplateDto;
  @IsOptional() @IsUUID() templateId?: string;
}

export class CertCandidateQueryDto extends PageQueryDto {
  @IsUUID() templateId!: string;
  @ApiPropertyOptional({ enum: ['eligible', 'ineligible', 'issued', 'not_issued'] })
  @IsOptional() @IsIn(['eligible', 'ineligible', 'issued', 'not_issued']) filter?: 'eligible' | 'ineligible' | 'issued' | 'not_issued';
}

export class IssueDto {
  @IsUUID() templateId!: string;
  /** Explicit subjects (registrations for PARTICIPANT templates, personnel for PERSONNEL ones). */
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) ids?: string[];
  /** Everyone eligible who has no certificate from this template yet. */
  @IsOptional() @IsBoolean() allEligible?: boolean;
  /** Issue to selected registrants even though they do not meet the rules (needs certificate:update). */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) overrideReason?: string;
}

export class CertListQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsIn(['ISSUED', 'REVOKED']) status?: 'ISSUED' | 'REVOKED';
}

export class RevokeDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class BatchPdfDto {
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids?: string[];
}

export class GuestAccessDto {
  @IsString() @MaxLength(30) referenceNo!: string;
  @IsString() @MinLength(10) @MaxLength(200) token!: string;
}

export class GuestClaimDto extends GuestAccessDto {
  @IsUUID() templateId!: string;
}

export class GuestPdfDto extends GuestAccessDto {
  @IsUUID() certificateId!: string;
}

export class ClaimDto {
  @IsUUID() templateId!: string;
  @IsUUID() registrationId!: string;
}
