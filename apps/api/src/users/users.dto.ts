import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { DataScope, UserStatus, UserType } from '../generated/prisma/client';
import { PageQueryDto } from '../common/pagination';

export class UserQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsEnum(UserType) userType?: UserType;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CreateUserDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @Matches(/^[a-zA-Z0-9._-]{3,100}$/) username?: string;
  @IsString() @MinLength(2) @MaxLength(300) displayName!: string;
  @IsEnum(UserType) userType!: UserType;
  /** Optional local password (min 10 chars). Omit for Google-only accounts. */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200) password?: string;
  @IsOptional() @IsString() @MaxLength(30) staffCode?: string;
  @IsOptional() @IsString() @MaxLength(30) studentCode?: string;
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus) status!: UserStatus;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class GrantRoleDto {
  @IsString() roleCode!: string;
  @IsOptional() @IsUUID() organizationId?: string | null;
  @IsEnum(DataScope) scope!: DataScope;
}
