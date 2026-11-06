import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
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
import { AttendanceStatus, PersonnelRole } from '../generated/prisma/client';

const CLIENT_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export class CheckinSettingsDto {
  @ApiProperty({ description: 'เปิดเช็กอินก่อนเวลาเริ่มกี่นาที', minimum: 0, maximum: 10080 })
  @IsInt() @Min(0) @Max(10080) opensBeforeMinutes!: number;

  @ApiPropertyOptional({ description: 'เช็กอินหลังเวลาเริ่มเกินกี่นาทีนับเป็น "มาสาย" (null = ไม่นับสาย)', nullable: true })
  @IsOptional() @IsInt() @Min(0) @Max(1440) lateAfterMinutes?: number | null;
}

export class LocationDto {
  @IsString() @MinLength(1) @MaxLength(200) nameTh!: string;
  @IsOptional() @IsUUID() scheduleId?: string | null;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class LocationUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nameTh?: string;
  @IsOptional() @IsUUID() scheduleId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

/** A session (agenda item) people can be checked into separately. */
export class ScheduleDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsISO8601({ strict: true }) startAt!: string;
  @IsISO8601({ strict: true }) endAt!: string;
  @IsOptional() @IsString() @MaxLength(300) venueText?: string;
  @IsOptional() @IsString() @MaxLength(300) speaker?: string;
}

/** Where / for which session the desk is checking people in. */
class PointDto {
  @IsOptional() @IsUUID() locationId?: string;
  /** Overrides the location's session; omit to use the location's (or the whole event). */
  @IsOptional() @IsUUID() scheduleId?: string;
  @IsOptional() @IsIn(['CHECK_IN', 'CHECK_OUT']) action?: 'CHECK_IN' | 'CHECK_OUT';
  @IsOptional() @Matches(CLIENT_KEY) clientKey?: string;
}

export class ScanDto extends PointDto {
  @ApiProperty({ description: 'ข้อความจาก QR (SRU1.…) หรือรหัสที่พิมพ์' })
  @IsString() @MinLength(1) @MaxLength(200) code!: string;
}

export class ManualCheckinDto extends PointDto {
  @IsUUID() registrationId!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class GroupCheckinDto extends PointDto {
  @IsUUID() groupId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) registrationIds!: string[];
}

export class UndoDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class SyncItemDto {
  @Matches(CLIENT_KEY) clientKey!: string;
  @IsUUID() registrationId!: string;
  @IsISO8601({ strict: true }) occurredAt!: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() scheduleId?: string;
  @IsOptional() @IsIn(['CHECK_IN', 'CHECK_OUT']) action?: 'CHECK_IN' | 'CHECK_OUT';
}

export class SyncDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => SyncItemDto) items!: SyncItemDto[];
}

export class CheckinSearchDto {
  @IsString() @MinLength(1) @MaxLength(100) q!: string;
}

export class RecordQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() registrationId?: string;
}

export class ReissueDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class TokenQrDto {
  @IsString() @MaxLength(30) referenceNo!: string;
  @IsString() @MaxLength(100) token!: string;
}

// ───────────── Attendance ─────────────

export class AttendanceQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() scheduleId?: string;
  @IsOptional() @IsEnum(AttendanceStatus) status?: AttendanceStatus;
  @IsOptional() @IsUUID() participantTypeId?: string;
}

export class AttendanceExportDto {
  @IsOptional() @IsUUID() scheduleId?: string;
}

export class AttendanceSetDto {
  @IsOptional() @IsUUID() scheduleId?: string;
  @IsEnum(AttendanceStatus) status!: AttendanceStatus;
  @IsString() @MinLength(3) @MaxLength(500) note!: string;
}

// ───────────── Personnel ─────────────

export class PersonnelDto {
  @IsEnum(PersonnelRole) role!: PersonnelRole;
  @IsOptional() @IsUUID() userId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) prefix?: string;
  @IsString() @MinLength(1) @MaxLength(150) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(150) lastName!: string;
  @IsOptional() @IsString() @MaxLength(300) position?: string;
  @IsOptional() @IsString() @MaxLength(300) affiliation?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsBoolean() canCheckin?: boolean;
}

export class PersonnelUpdateDto {
  @IsOptional() @IsEnum(PersonnelRole) role?: PersonnelRole;
  @IsOptional() @IsUUID() userId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) prefix?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(150) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(150) lastName?: string;
  @IsOptional() @IsString() @MaxLength(300) position?: string;
  @IsOptional() @IsString() @MaxLength(300) affiliation?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsBoolean() canCheckin?: boolean;
}
