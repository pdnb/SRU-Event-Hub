import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { DocumentTemplate, fill } from './templates';

/**
 * Server-side PDF for finance documents (pdfkit + Sarabun, OFL – assets/fonts).
 *
 * Thai has no spaces between words, so pdfkit's own wrapping (spaces only) would overflow cells or
 * cut words. Text is laid out here instead: segmented into words with Intl.Segmenter (ICU Thai
 * dictionary), measured with the current font, and joined with explicit line breaks. (A zero-width
 * space hint cannot be used: Sarabun has no glyph for it and pdfkit would print a box.)
 */

/** src/payments/documents → apps/api/assets ; dist/payments/documents → /app/assets (same depth). */
const FONT_DIR = [join(__dirname, '../../../assets/fonts'), join(process.cwd(), 'assets/fonts')].find((d) => existsSync(d))!;

const words = new Intl.Segmenter('th', { granularity: 'word' });
const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });

/**
 * Greedy word wrap to `width` using `measure` (the document's current font). A word wider than the
 * line is split between grapheme clusters, so Thai vowels/tone marks never detach from their base.
 */
export function layoutLines(text: string, width: number, measure: (s: string) => number): string {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    const push = () => {
      out.push(line.trimEnd());
      line = '';
    };
    for (const segment of breakUnits(para)) {
      if (measure(line + segment) <= width) {
        line += segment;
        continue;
      }
      if (line.trim()) push();
      const seg = line === '' ? segment.trimStart() : segment;
      if (measure(seg) <= width) {
        line = seg;
        continue;
      }
      for (const { segment: g } of graphemes.segment(seg)) {
        if (line && measure(line + g) > width) push();
        line += g;
      }
    }
    out.push(line.trimEnd());
  }
  return out.join('\n');
}

const THAI = /[฀-๿]/;
const OPENING = /[([{"'“‘]$/;
const CLOSING = /^[)\]}.,:;!?%"'”’]/;

/**
 * Word segments merged into unbreakable units: a run of non-Thai characters without spaces stays
 * whole ("14:30", "1,500.00") except after "-" or "/" (so "PAY-2570-000001" can wrap at the dash),
 * and nothing breaks after an opening or before a closing punctuation mark.
 */
function breakUnits(text: string): string[] {
  const units: string[] = [];
  for (const { segment } of words.segment(text)) {
    const prev = units[units.length - 1];
    const glue =
      prev !== undefined &&
      !/\s$/.test(prev) &&
      !/^\s/.test(segment) &&
      (OPENING.test(prev) || CLOSING.test(segment) || (!THAI.test(prev.slice(-1)) && !THAI.test(segment[0]!) && !/[-/]$/.test(prev)));
    if (glue) units[units.length - 1] = prev + segment;
    else units.push(segment);
  }
  return units;
}

export interface TableDocInput<K extends string> {
  template: DocumentTemplate<K>;
  vars: Record<string, string | number | null | undefined>;
  rows: Record<K, string>[];
  /** Printed in the total row under the `amount` column. */
  total: string;
  /** Diagonal watermark (e.g. "ฉบับร่าง") for documents that are not final. */
  watermark?: string;
  /** PDF metadata title. */
  title: string;
}

const MARGIN = 36;
const FONT_SIZE = 12;
const CELL_PAD = 3;

export function renderTablePdf<K extends string>(input: TableDocInput<K>): Promise<Buffer> {
  const { template: t, vars } = input;
  const doc = new PDFDocument({
    size: 'A4',
    layout: t.orientation,
    margins: { top: MARGIN, bottom: MARGIN + 14, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: input.title, Producer: 'SRU Event Hub', Creator: 'SRU Event Hub' },
  });
  doc.registerFont('th', join(FONT_DIR, 'Sarabun-Regular.ttf'));
  doc.registerFont('th-bold', join(FONT_DIR, 'Sarabun-Bold.ttf'));

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = MARGIN;
  const usable = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const totalWeight = t.columns.reduce((a, c) => a + c.width, 0);
  const widths = t.columns.map((c) => (c.width / totalWeight) * usable);

  /** Wraps with the font currently selected on `doc`; pdfkit then only breaks at our newlines. */
  const fit = (text: string, width: number) => layoutLines(text, width, (s) => doc.widthOfString(s));
  const para = (text: string, x: number, width: number, align: 'left' | 'center' = 'left', y?: number) =>
    doc.text(fit(text, width), x, y, { width, align, lineBreak: true });

  // ── header text ──
  doc.font('th-bold').fontSize(16);
  for (const line of t.titleLines) para(fill(line, vars), left, usable, 'center');
  doc.moveDown(0.4).font('th').fontSize(FONT_SIZE);
  for (const line of t.infoLines) para(fill(line, vars), left, usable);
  doc.moveDown(0.5);

  // ── table ──
  const fitCells = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'th-bold' : 'th').fontSize(FONT_SIZE);
    return cells.map((c, i) => fit(c, widths[i]! - CELL_PAD * 2));
  };
  const rowHeight = (cells: string[], bold = false) =>
    Math.max(...fitCells(cells, bold).map((c, i) => doc.heightOfString(c || ' ', { width: widths[i]! - CELL_PAD * 2 }))) + CELL_PAD * 2;
  const drawRow = (raw: string[], opts: { bold?: boolean; fill?: string; aligns?: ('left' | 'center' | 'right')[] } = {}) => {
    const h = rowHeight(raw, opts.bold);
    const cells = fitCells(raw, !!opts.bold);
    const y = doc.y;
    let x = left;
    cells.forEach((c, i) => {
      const w = widths[i]!;
      if (opts.fill) doc.save().rect(x, y, w, h).fill(opts.fill).restore();
      doc.save().lineWidth(0.5).rect(x, y, w, h).stroke('#333333').restore();
      doc.fillColor('black').font(opts.bold ? 'th-bold' : 'th').fontSize(FONT_SIZE);
      doc.text(c, x + CELL_PAD, y + CELL_PAD, { width: w - CELL_PAD * 2, align: opts.aligns?.[i] ?? 'left' });
      x += w;
    });
    doc.x = left;
    doc.y = y + h;
  };

  const headerCells = t.columns.map((c) => c.label);
  const headerAligns = t.columns.map(() => 'center' as const);
  const drawHeader = () => drawRow(headerCells, { bold: true, fill: '#eeeeee', aligns: headerAligns });
  drawHeader();

  const aligns = t.columns.map((c) => c.align ?? 'left');
  for (const row of input.rows) {
    const cells = t.columns.map((c) => row[c.key] ?? '');
    if (doc.y + rowHeight(cells) > bottom()) {
      doc.addPage();
      drawHeader();
    }
    drawRow(cells, { aligns });
  }

  // Total row: label spans every column before `amount`.
  const amountIdx = t.columns.findIndex((c) => c.key === 'amount');
  const totalCells = t.columns.map((_, i) => (amountIdx >= 0 && i === amountIdx ? input.total : amountIdx > 0 && i === amountIdx - 1 ? t.totalLabel : ''));
  if (amountIdx < 0) totalCells[totalCells.length - 1] = `${t.totalLabel} ${input.total}`;
  if (doc.y + rowHeight(totalCells, true) > bottom()) doc.addPage();
  drawRow(totalCells, { bold: true, aligns: t.columns.map(() => 'right' as const) });

  // ── footer notes + signatures ──
  doc.moveDown(0.5).font('th').fontSize(FONT_SIZE);
  for (const line of t.footerNotes) para(fill(line, vars), left, usable);
  if (t.signatures.length) {
    const blockH = 70;
    if (doc.y + blockH + 20 > bottom()) doc.addPage();
    doc.moveDown(2);
    const y = doc.y;
    const w = usable / t.signatures.length;
    t.signatures.forEach((label, i) => {
      const x = left + i * w;
      doc.text('ลงชื่อ ......................................................', x, y, { width: w, align: 'center' });
      doc.text('(......................................................)', x, y + 20, { width: w, align: 'center' });
      para(fill(label, vars), x, w, 'center', y + 40);
      doc.text('วันที่ ......../......../........', x, y + 58, { width: w, align: 'center' });
    });
  }

  // ── page footer + watermark on every page ──
  const range = doc.bufferedPageRange();
  const printed = String(vars.printedAt ?? '');
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (input.watermark) {
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('th-bold').fontSize(90).fillColor('#cc0000', 0.12);
      doc.text(input.watermark, 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore();
    }
    const y = doc.page.height - MARGIN;
    // Writing below the bottom margin must not trigger an automatic page break.
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('th').fontSize(9).fillColor('#555555');
    doc.text(`${input.title} · พิมพ์เมื่อ ${printed}`, left, y, { width: usable / 2, lineBreak: false });
    doc.text(`หน้า ${i - range.start + 1}/${range.count}`, left + usable / 2, y, { width: usable / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
    doc.fillColor('black');
  }
  doc.end();
  return done;
}
