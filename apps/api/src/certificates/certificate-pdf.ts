import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { drawFittedText, drawQr, MM } from '../badges/badge-pdf';
import { FONT_DIR } from '../payments/documents/pdf';
import { CertTemplateSpec, fillCertText } from './certificate-template';

export interface CertSubject {
  spec: CertTemplateSpec;
  background: Buffer | null;
  vars: Record<string, string | null | undefined>;
  /** QR text — the public verification URL. */
  qr: string;
  /** Watermark for revoked / preview copies. */
  watermark?: string | null;
}

/**
 * Certificate PDF engine: one certificate per page, page = that certificate's template size (a batch
 * may mix template versions — each certificate renders from its own snapshot). Same text fitting
 * (Thai word wrap + shrink) and vector QR as the badge engine.
 */
export function renderCertificatesPdf(subjects: CertSubject[], opts: { title: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: opts.title, Producer: 'SRU Event Hub', Creator: 'SRU Event Hub' } });
  doc.registerFont('th', join(FONT_DIR, 'Sarabun-Regular.ttf'));
  doc.registerFont('th-bold', join(FONT_DIR, 'Sarabun-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (const s of subjects) {
    const t = s.spec;
    const [W, H] = [t.widthMm * MM, t.heightMm * MM];
    doc.addPage({ size: [W, H], margin: 0 });
    if (t.backgroundColor) doc.rect(0, 0, W, H).fill(t.backgroundColor);
    if (s.background) {
      try {
        doc.image(s.background, 0, 0, { width: W, height: H });
      } catch {
        /* corrupt image: render without it */
      }
    }
    for (const f of [...t.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const [x, y, w, h] = [f.xMm * MM, f.yMm * MM, f.wMm * MM, f.hMm * MM];
      if (f.kind === 'QR') {
        drawQr(doc, s.qr, x, y, w, h);
        continue;
      }
      // An explicit "\n" in the template is a line break (kept by the word wrapper).
      const text = fillCertText(f.content ?? '', s.vars);
      if (text) drawFittedText(doc, text, x, y, w, h, f, f.color ?? '#000000');
    }
    if (s.watermark) {
      const big = Math.min(W, H) / 5;
      doc.save();
      doc.rotate(-25, { origin: [W / 2, H / 2] });
      doc.font('th-bold').fontSize(big).fillColor('#dc2626').fillOpacity(0.22);
      doc.text(s.watermark, 0, H / 2 - big * 0.7, { width: W, align: 'center', lineBreak: false });
      doc.restore();
    }
  }
  if (!subjects.length) doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
  doc.end();
  return done;
}
