import { Injectable } from '@nestjs/common';
import { fiscalYearBE, formatReference } from '@sru/shared-utils';
import { Tx } from '../prisma/prisma.service';

/**
 * Running document numbers per prefix and fiscal year (e.g. PAY-2570-000123).
 * Must be called inside the business transaction: the counter row is locked
 * by the UPSERT until commit, so numbers are gap-free and never duplicated.
 */
@Injectable()
export class SequenceService {
  async next(tx: Tx, prefix: string, at: Date = new Date()): Promise<string> {
    const fy = fiscalYearBE(at);
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO document_sequences (prefix, fiscal_year, last_value)
      VALUES (${prefix}, ${fy}, 1)
      ON CONFLICT (prefix, fiscal_year)
      DO UPDATE SET last_value = document_sequences.last_value + 1
      RETURNING last_value`;
    return formatReference(prefix, fy, Number(rows[0]!.last_value));
  }
}
