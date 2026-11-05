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
