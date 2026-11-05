/**
 * Neutralise spreadsheet formula injection (CSV/Excel). A cell that starts
 * with = + - @ TAB or CR is prefixed with a single quote (spec §9).
 * Plain numeric strings such as "-150.00" are left untouched.
 */
export function sanitizeSpreadsheetCell(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
