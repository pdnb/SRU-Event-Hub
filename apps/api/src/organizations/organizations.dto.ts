import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OrganizationType, OrgMemberRole } from '../generated/prisma/client';

export class CreateOrganizationDto {
  @Matches(/^[A-Z0-9_-]{2,30}$/, { message: 'รหัสหน่วยงานใช้ A-Z, 0-9, _ หรือ - (2–30 ตัว)' })
  code!: string;

  @IsString() @MinLength(2) @MaxLength(300)
  nameTh!: string;

  @IsOptional() @IsString() @MaxLength(300)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(50)
  shortName?: string;

  @IsEnum(OrganizationType)
  type!: OrganizationType;

  @IsOptional() @IsUUID()
  parentId?: string | null;

  @IsOptional() @IsUUID()
  headUserId?: string | null;

  @IsOptional() @IsBoolean()
  isFinanceDivision?: boolean;

  @IsOptional() @IsInt()
  sortOrder?: number;
}

export class UpdateOrganizationDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) nameTh?: string;
  @IsOptional() @IsString() @MaxLength(300) nameEn?: string | null;
  @IsOptional() @IsString() @MaxLength(50) shortName?: string | null;
  @IsOptional() @IsEnum(OrganizationType) type?: OrganizationType;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsUUID() headUserId?: string | null;
  @IsOptional() @IsBoolean() isFinanceDivision?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class OrganizationQueryDto {
  @ApiPropertyOptional({ description: 'tree = nested result' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  tree?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;

  @IsOptional() @IsEnum(OrganizationType) type?: OrganizationType;
}

export class AddMemberDto {
  @IsUUID() userId!: string;
  @IsEnum(OrgMemberRole) memberRole!: OrgMemberRole;
  @IsOptional() @IsString() @MaxLength(200) position?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}
