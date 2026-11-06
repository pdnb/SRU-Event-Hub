import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { FONT_DIR, layoutLines } from '../payments/documents/pdf';
import { BadgeFieldSpec, BadgeTemplateSpec, fillBadgeText, matchColorRule } from './badge-template';

/**
 * Badge PDF engine (spec §4.8.1). pdfkit + Sarabun, vector QR codes (crisp at any printer DPI).
 *
 *  - LABEL: one badge per page, page size = badge size (card / label printers);
 *  - A4_SHEET: as many badges as fit on A4 (orientation chosen to fit the most), with light cut
 *    marks around each badge.
 * Thai text is wrapped by word (Intl.Segmenter, shared with the finance documents) and shrunk until
 * it fits its box, so long names never overflow onto other fields.
 */

export const MM = 72 / 25.4;
const A4 = { w: 210, h: 297 };
const SHEET_MARGIN = 8;
const SHEET_GAP = 4;
const MIN_FONT = 5;

export interface BadgeSubject {
  vars: Record<string, string | null | undefined>;
  /** QR text (null = no QR, e.g. personnel). */
  qr: string | null;
  participantTypeCode?: string | null;
  personnelRole?: string | null;
  /** 2+ prints a small reprint marker so reissued badges can be told apart. */
  printNo?: number;
}

export interface SheetLayout {
  landscape: boolean;
  cols: number;
  rows: number;
  /** Top-left of the grid (mm), centred on the page. */
  x0: number;
  y0: number;
  perPage: number;
}

/** How many badges of this size fit on A4, choosing the orientation that fits more. */
export function sheetLayout(widthMm: number, heightMm: number): SheetLayout {
  const fit = (pw: number, ph: number) => {
    const cols = Math.max(1, Math.floor((pw - 2 * SHEET_MARGIN + SHEET_GAP) / (widthMm + SHEET_GAP)));
    const rows = Math.max(1, Math.floor((ph - 2 * SHEET_MARGIN + SHEET_GAP) / (heightMm + SHEET_GAP)));
    return { cols, rows, pw, ph };
  };
  const p = fit(A4.w, A4.h);
  const l = fit(A4.h, A4.w);
  const best = l.cols * l.rows > p.cols * p.rows ? { ...l, landscape: true } : { ...p, landscape: false };
  const gridW = best.cols * widthMm + (best.cols - 1) * SHEET_GAP;
  const gridH = best.rows * heightMm + (best.rows - 1) * SHEET_GAP;
  return {
    landscape: best.landscape,
    cols: best.cols,
    rows: best.rows,
    x0: Math.max(0, (best.pw - gridW) / 2),
    y0: Math.max(0, (best.ph - gridH) / 2),
    perPage: best.cols * best.rows,
  };
}

export function renderBadgesPdf(t: BadgeTemplateSpec, subjects: BadgeSubject[], opts: { title: string; background?: Buffer | null }): Promise<Buffer> {
  const label = t.paper === 'LABEL';
  const layout = label ? null : sheetLayout(t.widthMm, t.heightMm);
  const pageSize: [number, number] = label ? [t.widthMm * MM, t.heightMm * MM] : layout!.landscape ? [A4.h * MM, A4.w * MM] : [A4.w * MM, A4.h * MM];
  const doc = new PDFDocument({ size: pageSize, margin: 0, autoFirstPage: false, info: { Title: opts.title, Producer: 'SRU Event Hub', Creator: 'SRU Event Hub' } });
  doc.registerFont('th', join(FONT_DIR, 'Sarabun-Regular.ttf'));
  doc.registerFont('th-bold', join(FONT_DIR, 'Sarabun-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const fields = [...t.fields].sort((a, b) => a.sortOrder - b.sortOrder);
  subjects.forEach((s, i) => {
    let ox = 0;
    let oy = 0;
    if (label) doc.addPage({ size: pageSize, margin: 0 });
    else {
      const slot = i % layout!.perPage;
      if (slot === 0) doc.addPage({ size: pageSize, margin: 0 });
      ox = layout!.x0 + (slot % layout!.cols) * (t.widthMm + SHEET_GAP);
      oy = layout!.y0 + Math.floor(slot / layout!.cols) * (t.heightMm + SHEET_GAP);
    }
    drawBadge(doc, t, fields, s, ox * MM, oy * MM, opts.background ?? null, !label);
  });
  if (!subjects.length) doc.addPage({ size: pageSize, margin: 0 });
  doc.end();
  return done;
}

function drawBadge(doc: PDFKit.PDFDocument, t: BadgeTemplateSpec, fields: BadgeFieldSpec[], s: BadgeSubject, ox: number, oy: number, background: Buffer | null, cutMarks: boolean) {
  const W = t.widthMm * MM;
  const H = t.heightMm * MM;
  doc.save();
  doc.rect(ox, oy, W, H).clip();
  if (t.backgroundColor) doc.rect(ox, oy, W, H).fill(t.backgroundColor);
  if (background) {
    try {
      doc.image(background, ox, oy, { width: W, height: H });
    } catch {
      /* corrupt image: print the badge without it rather than failing the whole batch */
    }
  }
  const rule = matchColorRule(t.colorRules, { participantTypeCode: s.participantTypeCode, personnelRole: s.personnelRole });
  const vars = { ...s.vars, label: rule?.label ? fillBadgeText(rule.label, s.vars) : (s.vars.participantType ?? '') };

  for (const f of fields) {
    const x = ox + f.xMm * MM;
    const y = oy + f.yMm * MM;
    const w = f.wMm * MM;
    const h = f.hMm * MM;
    if (f.kind === 'QR') {
      if (s.qr) drawQr(doc, s.qr, x, y, w, h);
      continue;
    }
    let color = f.color ?? '#000000';
    if (f.kind === 'BAND') {
      const fill = rule?.color ?? f.color;
      if (!fill) continue;
      doc.rect(x, y, w, h).fill(fill);
      color = contrastText(fill);
    }
    const text = fillBadgeText(f.content ?? '', vars);
    if (text) drawFittedText(doc, text, x, y, w, h, f, color);
  }
  if ((s.printNo ?? 1) > 1) {
    doc.font('th').fontSize(5).fillColor('#777777');
    doc.text(`พิมพ์ซ้ำ #${s.printNo}`, ox, oy + H - 8, { width: W - 3, align: 'right', lineBreak: false });
  }
  doc.restore();
  if (cutMarks) doc.save().lineWidth(0.3).dash(2, { space: 2 }).rect(ox, oy, W, H).stroke('#bbbbbb').undash().restore();
}

/**
 * Fits text into its box. A single line is preferred (names read better unbroken), shrinking the
 * font down to 75 % for it; otherwise wraps by Thai word, shrinking until the lines fit. The last
 * resort is an ellipsis.
 */
export function drawFittedText(doc: PDFKit.PDFDocument, text: string, x: number, y: number, w: number, h: number, f: Pick<BadgeFieldSpec, 'fontSize' | 'bold' | 'align'>, color: string) {
  const font = f.bold ? 'th-bold' : 'th';
  const pad = Math.min(1.2, w * 0.02);
  const width = Math.max(1, w - pad * 2);
  let size = f.fontSize;
  let lines: string;
  if (!text.includes('\n')) {
    doc.font(font);
    const oneLine = Math.min(f.fontSize, (f.fontSize * width) / Math.max(1, doc.fontSize(f.fontSize).widthOfString(text)));
    if (oneLine >= f.fontSize * 0.75 && oneLine >= MIN_FONT) size = Math.floor(oneLine * 2) / 2;
  }
  for (;;) {
    doc.font(font).fontSize(size);
    lines = layoutLines(text, width, (str) => doc.widthOfString(str));
    const height = doc.heightOfString(lines, { width, lineGap: -size * 0.06 });
    if (height <= h + 0.5 || size <= MIN_FONT) break;
    size = Math.max(MIN_FONT, size - 0.5);
  }
  doc.font(font).fontSize(size);
  const lineH = doc.heightOfString('ก', { width, lineGap: -size * 0.06 });
  const maxLines = Math.max(1, Math.floor((h + 0.5) / lineH));
  let parts = lines.split('\n');
  if (parts.length > maxLines) {
    parts = parts.slice(0, maxLines);
    parts[maxLines - 1] = `${parts[maxLines - 1]!.replace(/\s+$/, '')}…`;
  }
  const out = parts.join('\n');
  const used = doc.heightOfString(out, { width, lineGap: -size * 0.06 });
  doc.fillColor(color).text(out, x + pad, y + Math.max(0, (h - used) / 2), { width, align: f.align, lineGap: -size * 0.06, lineBreak: true, height: h + lineH });
}

/** Vector QR: one rectangle per horizontal run of dark modules, centred in the box with a 2-module quiet zone. */
export function drawQr(doc: PDFKit.PDFDocument, text: string, x: number, y: number, w: number, h: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2;
  const side = Math.min(w, h);
  const cell = side / (n + quiet * 2);
  const left = x + (w - side) / 2 + quiet * cell;
  const top = y + (h - side) / 2 + quiet * cell;
  doc.save();
  doc.rect(x + (w - side) / 2, y + (h - side) / 2, side, side).fill('#ffffff');
  doc.fillColor('#000000');
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.data[r * n + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && qr.modules.data[r * n + c]) c++;
      // Slight overdraw avoids hairline gaps between modules in some PDF viewers.
      doc.rect(left + start * cell, top + r * cell, (c - start) * cell + 0.05, cell + 0.05);
    }
  }
  doc.fill('#000000');
  doc.restore();
}

/** White text on dark bands, black on light ones (WCAG relative luminance). */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.4 ? '#000000' : '#ffffff';
}
