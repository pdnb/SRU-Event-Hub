import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
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
import { EventStatus, FieldType } from '../generated/prisma/client';
import { PageQueryDto } from '../common/pagination';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const bool = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : value === true || value === 'true';

export class RegistrationFieldOptionDto {
  @Matches(/^[a-zA-Z0-9_-]{1,100}$/) value!: string;
  @IsString() @MinLength(1) @MaxLength(300) labelTh!: string;
}

export class RegistrationFieldDto {
  @Matches(/^[a-z][a-z0-9_]{0,49}$/, { message: 'key ใช้ a-z, 0-9, _' }) key!: string;
  @IsString() @MinLength(1) @MaxLength(300) labelTh!: string;
  @IsEnum(FieldType) fieldType!: FieldType;
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @IsString() @MaxLength(500) helpText?: string;
  @IsOptional() @IsInt() @Min(1) maxLength?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RegistrationFieldOptionDto)
  options?: RegistrationFieldOptionDto[];
}

export class FeeRateInputDto {
  @IsString() @MinLength(1) @MaxLength(200) nameTh!: string;
  @Matches(MONEY, { message: 'จำนวนเงินไม่ถูกต้อง' }) amount!: string;
  /** null = every participant type. */
  @IsOptional() @IsUUID() participantTypeId?: string | null;
  @IsOptional() @IsDateString() validFrom?: string | null;
  @IsOptional() @IsDateString() validUntil?: string | null;
}

export class CreateEventDto {
  @IsString() @MinLength(3) @MaxLength(300) titleTh!: string;
  @IsOptional() @IsString() @MaxLength(300) titleEn?: string;
  @IsUUID() organizationId!: string;
  @IsOptional() @IsUUID() eventTypeId?: string | null;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @IsOptional() @IsString() @MaxLength(5000) objectives?: string;
  @IsOptional() @IsString() @MaxLength(2000) targetAudience?: string;
  @IsOptional() @IsString() @MaxLength(5000) conditions?: string;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsDateString() registrationOpenAt?: string | null;
  @IsOptional() @IsDateString() registrationCloseAt?: string | null;
  @IsOptional() @IsUUID() venueId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) venueText?: string | null;
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsInt() @Min(0) minParticipants?: number | null;
  @IsOptional() @Matches(MONEY, { message: 'จำนวนเงินไม่ถูกต้อง' }) budget?: string | null;
  @IsOptional() @IsBoolean() allowGuestRegistration?: boolean;
  @IsOptional() @IsBoolean() allowWaitlist?: boolean;
  @IsOptional() @IsBoolean() allowSelfCancel?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  /** Participant type ids allowed to register. Empty = all active types. */
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) participantTypeIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RegistrationFieldDto)
  registrationFields?: RegistrationFieldDto[];
  /** Fee rates. Sending the list replaces all rates; an empty list makes the event free. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => FeeRateInputDto)
  feeRates?: FeeRateInputDto[];
  @IsOptional() @IsInt() @Min(1) @Max(720) paymentWindowHours?: number;
  @IsOptional() @IsUUID() bankAccountId?: string | null;
  @IsOptional() @IsUUID() incomeCodeId?: string | null;
  @IsOptional() @IsInt() version?: number;
}

/** Same shape, all optional. `version` is required for optimistic locking. */
export class UpdateEventDto implements Partial<CreateEventDto> {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(300) titleTh?: string;
  @IsOptional() @IsString() @MaxLength(300) titleEn?: string;
  @IsOptional() @IsUUID() eventTypeId?: string | null;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @IsOptional() @IsString() @MaxLength(5000) objectives?: string;
  @IsOptional() @IsString() @MaxLength(2000) targetAudience?: string;
  @IsOptional() @IsString() @MaxLength(5000) conditions?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsDateString() registrationOpenAt?: string | null;
  @IsOptional() @IsDateString() registrationCloseAt?: string | null;
  @IsOptional() @IsUUID() venueId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) venueText?: string | null;
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsInt() @Min(0) minParticipants?: number | null;
  @IsOptional() @Matches(MONEY) budget?: string | null;
  @IsOptional() @IsBoolean() allowGuestRegistration?: boolean;
  @IsOptional() @IsBoolean() allowWaitlist?: boolean;
  @IsOptional() @IsBoolean() allowSelfCancel?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) participantTypeIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RegistrationFieldDto)
  registrationFields?: RegistrationFieldDto[];
  /** Fee rates. Sending the list replaces all rates; an empty list makes the event free. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => FeeRateInputDto)
  feeRates?: FeeRateInputDto[];
  @IsOptional() @IsInt() @Min(1) @Max(720) paymentWindowHours?: number;
  @IsOptional() @IsUUID() bankAccountId?: string | null;
  @IsOptional() @IsUUID() incomeCodeId?: string | null;
  @IsInt() version!: number;
}

export class RescheduleDto {
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsString() @MaxLength(500) venueText?: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class CommentDto {
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class RequiredCommentDto {
  @IsString() @MinLength(3) @MaxLength(2000) comment!: string;
}

export class AdminEventQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(EventStatus) status?: EventStatus;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class PublicEventQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'open', 'upcoming', 'past'] })
  @IsOptional() @IsIn(['all', 'open', 'upcoming', 'past']) tab: 'all' | 'open' | 'upcoming' | 'past' = 'all';
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() eventTypeId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Transform(bool) @IsBoolean() isPaid?: boolean;
  @IsOptional() @Transform(bool) @IsBoolean() featured?: boolean;
}

/** ขอแก้ไขอัตราค่าลงทะเบียนหลังอนุมัติ → ต้องผ่าน workflow อนุมัติอีกครั้ง (FEE_CHANGE). */
export class FeeChangeDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => FeeRateInputDto)
  feeRates!: FeeRateInputDto[];
  /** Omitted = keep the current receiving account / income code. */
  @IsOptional() @IsUUID() bankAccountId?: string | null;
  @IsOptional() @IsUUID() incomeCodeId?: string | null;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
