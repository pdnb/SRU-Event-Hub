import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

export class ReconAccountDto {
  @IsUUID() bankAccountId!: string;
}

export class ReconLineQueryDto extends PageQueryDto {
  @IsUUID() bankAccountId!: string;
  /** MATCHED = AUTO or MANUAL. */
  @ApiPropertyOptional({ enum: ['UNMATCHED', 'MATCHED', 'AUTO', 'MANUAL', 'IGNORED'] })
  @IsOptional()
  @IsIn(['UNMATCHED', 'MATCHED', 'AUTO', 'MANUAL', 'IGNORED'])
  status?: 'UNMATCHED' | 'MATCHED' | 'AUTO' | 'MANUAL' | 'IGNORED';
  @IsOptional() @IsUUID() statementId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class ReconReportQueryDto {
  @IsUUID() bankAccountId!: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class MatchLineDto {
  @IsUUID() paymentId!: string;
}

export class LineReasonDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
