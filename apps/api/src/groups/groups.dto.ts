import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';
import { ParticipantOrgType, RegistrationGroupStatus } from '../generated/prisma/client';
import { BillingInputDto } from '../payments/billing';
import { AnswerDto } from '../registrations/registrations.dto';

const PHONE = /^(0\d{8,9})?$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ───────────── Participant organizations ─────────────

export class ParticipantOrgDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(300) nameTh!: string;
  @IsEnum(ParticipantOrgType) orgType!: ParticipantOrgType;
  @IsOptional() @IsString() @MaxLength(20) taxId?: string;
  @IsOptional() @IsString() @MaxLength(100) branch?: string;
  @IsOptional() @IsString() @MaxLength(1000) address?: string;
  @IsOptional() @IsString() @MaxLength(100) province?: string;
  @IsOptional() @Matches(PHONE, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }) phone?: string;
  @IsOptional() @ValidateIf((o: ParticipantOrgDto) => !!o.email) @IsEmail() @MaxLength(254) email?: string;
  /** The creating coordinator's position in the organization (e.g. ครูที่ปรึกษา). */
  @IsOptional() @IsString() @MaxLength(200) position?: string;
}

export class AddCoordinatorDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @IsString() @MaxLength(200) position?: string;
}

export class ParticipantOrgQueryDto extends PageQueryDto {
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() verified?: boolean;
}

// ───────────── Event group settings ─────────────

export class GroupSettingDto {
  @IsBoolean() isEnabled!: boolean;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000) minMembers!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000) maxMembers!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) maxGroupsPerOrganization?: number | null;
  @IsBoolean() allowImport!: boolean;
  @IsBoolean() allowInviteLinks!: boolean;
  @IsOptional() @IsISO8601() memberChangeCloseAt?: string | null;
}

// ───────────── Groups ─────────────

export class CreateGroupDto {
  @IsUUID() participantOrganizationId!: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(300) name!: string;
  @IsOptional() @Matches(PHONE, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class UpdateGroupDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(300) name?: string;
  @IsOptional() @Matches(PHONE, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class MemberDto {
  @IsString() @MaxLength(50) participantTypeCode!: string;
  @IsOptional() @IsString() @MaxLength(50) prefix?: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) firstName!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) lastName!: string;
  @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @Matches(PHONE, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }) phone?: string;
  @IsOptional() @IsString() @MaxLength(30) studentOrStaffCode?: string;
  @IsOptional() @IsString() @MaxLength(300) affiliation?: string;
  @IsOptional() @IsString() @MaxLength(300) program?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AnswerDto)
  answers?: AnswerDto[];
}

export class ReasonDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class RequiredReasonDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class UpdateMemberDto extends MemberDto {
  /** Required once the group has been submitted (recorded in the change log). */
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class SubmitGroupDto {
  /** The coordinator attests that every member agreed to the privacy notice. */
  @Equals(true, { message: 'กรุณายืนยันว่าได้รับความยินยอมจากสมาชิกทุกคนตามนโยบายคุ้มครองข้อมูลส่วนบุคคล' })
  pdpaAttestation!: boolean;
  /** FIN-9/10: receipt addressee for the combined order (defaults to the organization when it has a tax id). */
  @IsOptional() @ValidateNested() @Type(() => BillingInputDto) billing?: BillingInputDto;
}

export class GroupBillingDto {
  @ValidateNested() @Type(() => BillingInputDto) billing!: BillingInputDto;
}

export class GroupQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(RegistrationGroupStatus) status?: RegistrationGroupStatus;
}

// ───────────── Invitations ─────────────

export class CreateInvitationDto {
  /** Member who completes their own details. Omit for an open link that adds new members. */
  @IsOptional() @IsUUID() registrationId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) maxUses?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) expiresInDays?: number;
}

export class InvitationTokenDto {
  @IsString() @MinLength(20) @MaxLength(100) token!: string;
}

export class AcceptInvitationDto extends MemberDto {
  @IsString() @MinLength(20) @MaxLength(100) token!: string;
  @Equals(true, { message: 'กรุณายอมรับนโยบายคุ้มครองข้อมูลส่วนบุคคล' })
  pdpaConsent!: boolean;
}
