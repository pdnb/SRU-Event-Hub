import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQueryDto } from '../common/pagination';
import { VenueType } from '../generated/prisma/client';

const VENUE_TYPES = Object.values(VenueType);

export class BuildingDto {
  @IsString() @MinLength(1) @MaxLength(30) code!: string;
  @IsString() @MinLength(1) @MaxLength(300) nameTh!: string;
  @IsOptional() @IsString() @MaxLength(200) campus?: string | null;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class VenueDto {
  @IsString() @MinLength(1) @MaxLength(30) code!: string;
  @IsString() @MinLength(1) @MaxLength(300) nameTh!: string;
  @IsIn(VENUE_TYPES) venueType!: VenueType;
  @IsOptional() @IsUUID() buildingId?: string | null;
  @IsOptional() @IsUUID() organizationId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(100000) capacity?: number | null;
  @IsOptional() @IsString() @MaxLength(20) floor?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsBoolean() autoApprove?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ResourceDto {
  @IsString() @MinLength(1) @MaxLength(30) code!: string;
  @IsString() @MinLength(1) @MaxLength(300) nameTh!: string;
  @IsString() @MinLength(1) @MaxLength(100) resourceType!: string;
  @IsInt() @Min(1) @Max(100000) quantity!: number;
  @IsOptional() @IsUUID() venueId?: string | null;
  @IsOptional() @IsUUID() organizationId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CatalogQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() buildingId?: string;
  @IsOptional() @IsIn(VENUE_TYPES) venueType?: VenueType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) minCapacity?: number;
  @IsOptional() @IsIn(['true', 'false']) includeInactive?: 'true' | 'false';
}

export class AvailabilityQueryDto {
  @IsISO8601({ strict: true }) from!: string;
  @IsISO8601({ strict: true }) to!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) minCapacity?: number;
  @IsOptional() @IsIn(VENUE_TYPES) venueType?: VenueType;
}

export class BookingQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() venueId?: string;
  @IsOptional() @IsUUID() resourceId?: string;
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']) status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  @ApiPropertyOptional({ description: 'mine = my requests, approve = waiting for my decision' })
  @IsOptional() @IsIn(['mine', 'approve']) view?: 'mine' | 'approve';
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
}

export class VenueBookingDto {
  @IsUUID() venueId!: string;
  @IsISO8601({ strict: true }) startAt!: string;
  @IsISO8601({ strict: true }) endAt!: string;
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsString() @MaxLength(1000) purpose?: string;
}

export class ResourceBookingDto {
  @IsUUID() resourceId!: string;
  @IsInt() @Min(1) @Max(100000) quantity!: number;
  @IsISO8601({ strict: true }) startAt!: string;
  @IsISO8601({ strict: true }) endAt!: string;
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsString() @MaxLength(1000) purpose?: string;
}

export class DecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class RejectDto {
  @IsString() @MinLength(3) @MaxLength(1000) note!: string;
}
