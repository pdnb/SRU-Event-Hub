import { sanitizeSpreadsheetCell } from '@sru/shared-utils';
import ExcelJS from 'exceljs';
import { DocumentTemplate, fill } from './templates';

export interface TableXlsxInput<K extends string> {
  template: DocumentTemplate<K>;
  vars: Record<string, string | number | null | undefined>;
  /** Cell values; `amount` should be a number so Excel can sum it. */
  rows: Record<K, string | number>[];
  total: number;
  sheetName: string;
}

/** Excel rendering of the same template as the PDF (TH Sarabun New, A4, borders, signature line). */
export async function renderTableXlsx<K extends string>(input: TableXlsxInput<K>): Promise<Buffer> {
  const { template: t, vars } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SRU Event Hub';
  const ws = wb.addWorksheet(input.sheetName, {
    pageSetup: { paperSize: 9, orientation: t.orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const n = t.columns.length;
  const font = { name: 'TH Sarabun New', size: 14 };
  const line = (text: string, bold = false, align: 'left' | 'center' = 'left') => {
    const row = ws.addRow([sanitizeSpreadsheetCell(fill(text, vars))]);
    row.font = { ...font, bold, size: bold ? 16 : 14 };
    if (n > 1) ws.mergeCells(row.number, 1, row.number, n);
    row.alignment = { horizontal: align, wrapText: true };
  };
  t.titleLines.forEach((l) => line(l, true, 'center'));
  t.infoLines.forEach((l) => line(l));
  ws.addRow([]);

  const thin = { style: 'thin' as const };
  const header = ws.addRow(t.columns.map((c) => c.label));
  header.font = { ...font, bold: true };
  header.eachCell((c) => {
    c.border = { top: thin, bottom: thin, left: thin, right: thin };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
  });
  for (const r of input.rows) {
    const row = ws.addRow(t.columns.map((c) => (typeof r[c.key] === 'string' ? sanitizeSpreadsheetCell(r[c.key] as string) : r[c.key])));
    row.font = font;
    t.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.border = { left: thin, right: thin, bottom: { style: 'hair' } };
      cell.alignment = { horizontal: c.align ?? 'left', vertical: 'top', wrapText: true };
      if (c.key === 'amount') cell.numFmt = '#,##0.00';
    });
  }
  const amountIdx = t.columns.findIndex((c) => c.key === 'amount');
  const totals: (string | number)[] = t.columns.map(() => '');
  if (amountIdx >= 0) {
    totals[amountIdx] = input.total;
    totals[Math.max(0, amountIdx - 1)] = amountIdx > 0 ? t.totalLabel : totals[0]!;
  } else {
    totals[n - 1] = `${t.totalLabel} ${input.total.toFixed(2)}`;
  }
  const totalRow = ws.addRow(totals);
  totalRow.font = { ...font, bold: true };
  totalRow.eachCell((c) => (c.border = { top: thin, bottom: { style: 'double' }, left: thin, right: thin }));
  if (amountIdx >= 0) totalRow.getCell(amountIdx + 1).numFmt = '#,##0.00';

  t.footerNotes.forEach((l) => line(l));
  if (t.signatures.length) {
    ws.addRow([]);
    ws.addRow([]);
    line(t.signatures.map((s) => `ลงชื่อ .............................. ${fill(s, vars)}`).join('      '));
  }
  t.columns.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(6, Math.round(c.width * 1.3))));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
