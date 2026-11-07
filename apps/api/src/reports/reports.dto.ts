import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** Period + scope filters shared by every report. Period defaults to the current fiscal year (Oct–Sep). */
export class ReportFilterDto {
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
  /** Fiscal year in B.E. (e.g. 2570 = 1 Oct 2026 – 30 Sep 2027); ignored when from/to are given. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(2560) @Max(2700) fiscalYear?: number;
  /** Includes the organization's sub-units. */
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() eventTypeId?: string;
}

export class EventReportQueryDto extends ReportFilterDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(200) perPage = 20;
  @IsOptional() @IsIn(['startAt', 'confirmed', 'attendanceRate', 'revenue', 'satisfaction']) sort: 'startAt' | 'confirmed' | 'attendanceRate' | 'revenue' | 'satisfaction' = 'startAt';
  @IsOptional() @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'desc';
  @IsOptional() @IsString() @MaxLength(200) search?: string;

  get skip() {
    return (this.page - 1) * this.perPage;
  }
}

