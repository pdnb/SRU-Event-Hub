/**
 * Bank statement parsing for reconciliation (กระทบยอด). Pure functions — unit tested.
 *
 * Banks export different layouts, so columns are found by header name (Thai or English aliases,
 * configurable in `finance.statementColumns`). The header row may sit below a preamble; it is the
 * first row that has a date column and an amount/credit column. Only incoming money (credit) is
 * kept. Any unreadable line rejects the whole file: finance data is never imported half-parsed.
 */

export type Cell = string | number | Date | null | undefined;

export interface StatementColumns {
  date: string[];
  time: string[];
  /** Incoming money column. */
  credit: string[];
  /** Outgoing money column (lines with only a debit are skipped). */
  debit: string[];
  /** Single signed amount column (positive = credit), used when there is no credit column. */
  amount: string[];
  description: string[];
  reference: string[];
}

export const DEFAULT_STATEMENT_COLUMNS: StatementColumns = {
  date: ['วันที่', 'วันที่ทำรายการ', 'วันที่รายการ', 'date', 'transaction date', 'txn date', 'value date'],
  time: ['เวลา', 'เวลาทำรายการ', 'time'],
  credit: ['ฝาก', 'เงินฝาก', 'จำนวนเงินฝาก', 'เงินเข้า', 'ยอดเงินเข้า', 'credit', 'deposit', 'deposits', 'cr'],
  debit: ['ถอน', 'เงินถอน', 'จำนวนเงินถอน', 'เงินออก', 'debit', 'withdrawal', 'withdrawals', 'dr'],
  amount: ['จำนวนเงิน', 'amount'],
  description: ['รายละเอียด', 'รายการ', 'คำอธิบาย', 'ชื่อผู้โอน', 'description', 'details', 'narrative'],
  reference: ['เลขอ้างอิง', 'อ้างอิง', 'เลขที่อ้างอิง', 'reference', 'ref', 'ref no', 'reference no'],
};

export function isStatementColumns(v: unknown): v is StatementColumns {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (Object.keys(DEFAULT_STATEMENT_COLUMNS) as (keyof StatementColumns)[]).every(
    (k) => Array.isArray(o[k]) && (o[k] as unknown[]).length <= 30 && (o[k] as unknown[]).every((s) => typeof s === 'string' && s.length <= 100),
  );
}

export interface ParsedLine {
  /** 1-based row number in the file (for error messages and line numbers). */
  row: number;
  txnAt: Date;
  /** "1500.00" */
  amount: string;
  description: string | null;
  reference: string | null;
}

export interface ParseResult {
  lines: ParsedLine[];
  skippedDebit: number;
  skippedBlank: number;
  errors: { row: number; message: string }[];
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Index of the first header cell matching any alias; -1 if none. */
function findCol(header: string[], aliases: string[]): number {
  const wanted = aliases.map(norm);
  return header.findIndex((h) => wanted.includes(h));
}

/** Bangkok wall-clock → UTC instant (Thailand has no DST: UTC+7 all year). */
function bangkok(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;
  const t = Date.UTC(y, m - 1, d, hh - 7, mm, ss);
  const check = new Date(t + 7 * 3600_000);
  return check.getUTCDate() === d && check.getUTCMonth() === m - 1 ? new Date(t) : null;
}

/** 2569 → 2026 ; 26 → 2026 ; 69 → 2026 (2-digit ≥ 50 is read as Buddhist era). */
function year(y: number, digits: number): number {
  if (digits <= 2) return y >= 50 ? 2500 + y - 543 : 2000 + y;
  return y > 2400 ? y - 543 : y;
}

function parseTime(v: Cell): [number, number, number] | null {
  if (v === null || v === undefined || v === '') return [0, 0, 0];
  if (v instanceof Date) return [v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds()];
  if (typeof v === 'number') {
    // Excel time fraction of a day.
    const secs = Math.round((v % 1) * 86400);
    return [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60];
  }
  const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** Date (+ optional time inside the same cell, or from a separate time cell). */
export function parseStatementDate(v: Cell, timeCell?: Cell): Date | null {
  let base: [number, number, number];
  let time: [number, number, number] | null = null;
  if (v instanceof Date) {
    // Spreadsheet dates carry the wall-clock in UTC fields.
    base = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
    time = [v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds()];
  } else if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30).
    const d = new Date(Math.round((v - 25569) * 86400) * 1000);
    base = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    time = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
  } else {
    const s = String(v ?? '').trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}[:.]\d{2}(?:[:.]\d{2})?))?/.exec(s);
    if (m) {
      base = [year(Number(m[1]), 4), Number(m[2]), Number(m[3])];
      if (m[4]) time = parseTime(m[4]);
    } else {
      m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?))?$/.exec(s);
      if (!m) return null;
      base = [year(Number(m[3]), m[3]!.length), Number(m[2]), Number(m[1])];
      if (m[4]) time = parseTime(m[4]);
    }
  }
  if (timeCell !== undefined && timeCell !== null && timeCell !== '') {
    time = parseTime(timeCell);
    if (!time) return null;
  }
  const [hh, mm, ss] = time ?? [0, 0, 0];
  return bangkok(base[0], base[1], base[2], hh, mm, ss);
}

/** "1,500.00" / "฿1,500" / "(200.00)" / 1500 → "1500.00" (signed). null = blank, undefined = invalid. */
export function parseStatementAmount(v: Cell): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : undefined;
  let s = String(v).replace(/[\s,฿]|THB|บาท/gi, '');
  if (!s || s === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return undefined;
  const [i, f = ''] = s.split('.');
  const out = `${BigInt(i!).toString()}.${f.padEnd(2, '0')}`;
  return neg && out !== '0.00' ? `-${out}` : out;
}

export function parseStatementRows(rows: Cell[][], cols: StatementColumns = DEFAULT_STATEMENT_COLUMNS): ParseResult {
  const result: ParseResult = { lines: [], skippedDebit: 0, skippedBlank: 0, errors: [] };
  let h = -1;
  let idx = { date: -1, time: -1, credit: -1, debit: -1, amount: -1, description: -1, reference: -1 };
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const header = (rows[r] ?? []).map(norm);
    const date = findCol(header, cols.date);
    const credit = findCol(header, cols.credit);
    const amount = findCol(header, cols.amount);
    if (date >= 0 && (credit >= 0 || amount >= 0)) {
      h = r;
      idx = { date, time: findCol(header, cols.time), credit, debit: findCol(header, cols.debit), amount, description: findCol(header, cols.description), reference: findCol(header, cols.reference) };
      break;
    }
  }
  if (h < 0) {
    result.errors.push({ row: 0, message: 'ไม่พบแถวหัวตาราง (ต้องมีคอลัมน์วันที่ และคอลัมน์ยอดเงินฝาก/จำนวนเงิน)' });
    return result;
  }
  const cell = (row: Cell[], i: number) => (i >= 0 ? row[i] : undefined);
  const text = (v: Cell, max: number) => {
    const s = v instanceof Date ? v.toISOString() : String(v ?? '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, max) : null;
  };
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const rowNo = r + 1;
    if (row.every((c) => c === null || c === undefined || String(c).trim() === '')) {
      result.skippedBlank++;
      continue;
    }
    const rawDate = cell(row, idx.date);
    // Summary rows ("ยอดยกมา", "รวม") have no date – skip them quietly.
    if (rawDate === null || rawDate === undefined || String(rawDate).trim() === '') {
      result.skippedBlank++;
      continue;
    }
    let amount: string | null | undefined;
    if (idx.credit >= 0) {
      amount = parseStatementAmount(cell(row, idx.credit));
      if (amount === null) {
        const debit = idx.debit >= 0 ? parseStatementAmount(cell(row, idx.debit)) : null;
        if (debit === undefined) {
          result.errors.push({ row: rowNo, message: 'ยอดเงินถอนอ่านไม่ได้' });
          continue;
        }
        if (debit !== null) result.skippedDebit++;
        else result.skippedBlank++;
        continue;
      }
    } else {
      amount = parseStatementAmount(cell(row, idx.amount));
      if (amount === null) {
        result.skippedBlank++;
        continue;
      }
    }
    if (amount === undefined) {
      result.errors.push({ row: rowNo, message: `ยอดเงิน "${String(cell(row, idx.credit >= 0 ? idx.credit : idx.amount))}" อ่านไม่ได้` });
      continue;
    }
    if (amount.startsWith('-') || amount === '0.00') {
      result.skippedDebit++;
      continue;
    }
    const txnAt = parseStatementDate(rawDate, idx.time >= 0 ? cell(row, idx.time) : undefined);
    if (!txnAt) {
      result.errors.push({ row: rowNo, message: `วันที่/เวลา "${String(rawDate)}" อ่านไม่ได้` });
      continue;
    }
    result.lines.push({ row: rowNo, txnAt, amount, description: text(cell(row, idx.description), 500), reference: text(cell(row, idx.reference), 100) });
  }
  return result;
}

// ───────────── CSV ─────────────

/** UTF-8 (with or without BOM) or Windows-874/TIS-620, which Thai bank exports often use. */
export function decodeText(buf: Buffer): string {
  try {
    // TextDecoder already drops a leading BOM (ignoreBOM defaults to false).
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-874').decode(buf);
  }
}

/** RFC 4180 CSV (quotes, escaped quotes, CRLF). Delimiter: comma, semicolon or tab (detected). */
export function parseCsv(text: string): string[][] {
  const firstLines = text.split(/\r?\n/, 5).join('\n');
  const delim = [',', ';', '\t'].map((d) => [d, firstLines.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ───────────── auto-matching ─────────────

export interface MatchLine {
  id: string;
  txnAt: Date;
  amount: string;
}

export interface MatchPayment {
  id: string;
  amount: string;
  /** Transfer time stated by the payer; null → only the slip upload time is known. */
  transferredAt: Date | null;
  submittedAt: Date;
}

/**
 * Pairs statement lines with payments of the same amount whose transfer time is within
 * `toleranceMs`. When the payer gave no transfer time, the bank line must fall in the 24 h before
 * the slip upload (plus the tolerance after it). Pairs are taken closest-first and one-to-one; a
 * tie (two equally close candidates) is left for an officer rather than guessed.
 */
export function planAutoMatches(lines: MatchLine[], payments: MatchPayment[], toleranceMs: number): { lineId: string; paymentId: string }[] {
  const pairs: { l: string; p: string; d: number }[] = [];
  const byAmount = new Map<string, MatchPayment[]>();
  for (const p of payments) byAmount.set(p.amount, [...(byAmount.get(p.amount) ?? []), p]);
  for (const l of lines) {
    for (const p of byAmount.get(l.amount) ?? []) {
      const t = l.txnAt.getTime();
      let d: number;
      if (p.transferredAt) {
        d = Math.abs(p.transferredAt.getTime() - t);
        if (d > toleranceMs) continue;
      } else {
        const s = p.submittedAt.getTime();
        if (t > s + toleranceMs || s - t > 24 * 3600_000) continue;
        d = Math.abs(s - t);
      }
      pairs.push({ l: l.id, p: p.id, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedL = new Set<string>();
  const usedP = new Set<string>();
  const out: { lineId: string; paymentId: string }[] = [];
  for (const pair of pairs) {
    if (usedL.has(pair.l) || usedP.has(pair.p)) continue;
    const tie = pairs.some(
      (o) => o !== pair && o.d === pair.d && ((o.l === pair.l && !usedP.has(o.p)) || (o.p === pair.p && !usedL.has(o.l))),
    );
    if (tie) {
      // Ambiguous: block both sides so a later, worse pair cannot grab one of them either.
      usedL.add(pair.l);
      usedP.add(pair.p);
      continue;
    }
    usedL.add(pair.l);
    usedP.add(pair.p);
    out.push({ lineId: pair.l, paymentId: pair.p });
  }
  return out;
}
