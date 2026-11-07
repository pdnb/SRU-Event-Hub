/**
 * Human-readable running references, e.g. PAY-2570-000123.
 * The running number itself must come from a DB sequence/counter row
 * (see DocumentSequence model); this only formats it.
 */
export function formatReference(prefix: string, fiscalYearBE: number, running: number): string {
  if (!/^[A-Z]{2,6}$/.test(prefix)) throw new Error('Invalid reference prefix');
  if (!Number.isInteger(running) || running <= 0) throw new Error('Invalid running number');
  return `${prefix}-${fiscalYearBE}-${running.toString().padStart(6, '0')}`;
}

/**
 * Official receipt numbers (FIN-2): "<ปีงบประมาณ>/<เลขที่>" e.g. 2569/0001 — no book number,
 * running number restarts every fiscal year. Stored as the zero-padded running part only.
 * Returns null when the input is not a positive integer.
 */
export function normalizeReceiptNo(input: string): string | null {
  const s = input.trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n.toString().padStart(4, '0');
}

export function formatReceiptNo(fiscalYearBE: number, receiptNo: string): string {
  return `${fiscalYearBE}/${receiptNo}`;
}
