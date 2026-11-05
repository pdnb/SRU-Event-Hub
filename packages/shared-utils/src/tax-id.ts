/**
 * Thai 13-digit identification number (citizen id / juristic-person tax id, FIN-9).
 * Check digit: (11 − Σ dᵢ·(13−i) mod 11) mod 10 over the first 12 digits.
 */
export function normalizeTaxId(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export function isValidThaiTaxId(input: string): boolean {
  const id = normalizeTaxId(input);
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

/** 0-1055-36000-31-5 style grouping for printing. */
export function formatThaiTaxId(input: string): string {
  const id = normalizeTaxId(input);
  return /^\d{13}$/.test(id) ? `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}` : input;
}

/** "สำนักงานใหญ่" / "สาขาที่ 00001" from a stored branch value ("00000" = head office). */
export function formatBranch(branch: string | null | undefined): string {
  if (!branch) return '';
  const b = branch.trim();
  if (/^0{5}$/.test(b) || b === 'สำนักงานใหญ่') return 'สำนักงานใหญ่';
  return /^\d{5}$/.test(b) ? `สาขาที่ ${b}` : b;
}
