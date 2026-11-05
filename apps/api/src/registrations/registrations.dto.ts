import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  Equals,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RegistrationStatus } from '../generated/prisma/client';
import { PageQueryDto } from '../common/pagination';

export class AnswerDto {
  @Matches(/^[a-z][a-z0-9_]{0,49}$/) key!: string;
  /** string for single-value fields; string[] for MULTISELECT / CHECKBOX. Type-checked per field in the service. */
  @Allow()
  value!: string | string[];
}

export class CreateRegistrationDto {
  @IsString() @MaxLength(50) participantTypeCode!: string;
  @IsOptional() @IsString() @MaxLength(50) prefix?: string;
  @IsString() @MinLength(1) @MaxLength(150) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(150) lastName!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @Matches(/^(0\d{8,9})?$/, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }) phone?: string;
  @IsOptional() @IsString() @MaxLength(30) studentOrStaffCode?: string;
  @IsOptional() @IsString() @MaxLength(300) affiliation?: string;
  @IsOptional() @IsString() @MaxLength(300) program?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AnswerDto)
  answers?: AnswerDto[];
  /** PDPA consent must be explicitly given. */
  @Equals(true, { message: 'กรุณายอมรับนโยบายคุ้มครองข้อมูลส่วนบุคคล' })
  pdpaConsent!: boolean;
}

export class RegistrationQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(RegistrationStatus) status?: RegistrationStatus;
  @IsOptional() @IsUUID() participantTypeId?: string;
}

export class ExportQueryDto {
  @IsOptional() @IsIn(['csv', 'xlsx']) format: 'csv' | 'xlsx' = 'xlsx';
  @IsOptional() @IsEnum(RegistrationStatus) status?: RegistrationStatus;
}

export class TokenLookupDto {
  @Matches(/^REG-\d{4}-\d{6}$/, { message: 'เลขอ้างอิงไม่ถูกต้อง' }) referenceNo!: string;
  @IsString() @MinLength(20) @MaxLength(100) token!: string;
}

export class TokenCancelDto extends TokenLookupDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class CancelDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
