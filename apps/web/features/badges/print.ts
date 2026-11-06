'use client';

import { api } from '@/services/api';

/**
 * Opens the browser print dialog for an authenticated PDF (badges). The PDF is loaded into a hidden
 * iframe and printed from there; if the browser cannot print a PDF inside a frame (some mobile
 * browsers), it is opened in a new tab instead. Printing silently without the dialog needs a local
 * print agent (open question BDG-3).
 */
export async function printPdf(url: string): Promise<'dialog' | 'tab'> {
  const res = await api.http.get(url, { responseType: 'blob' });
  const blob = new Blob([res.data as Blob], { type: 'application/pdf' });
  const href = URL.createObjectURL(blob);
  const revokeLater = () => setTimeout(() => URL.revokeObjectURL(href), 60_000);

  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (!isMobile) {
    try {
      await new Promise<void>((resolve, reject) => {
        const frame = Object.assign(document.createElement('iframe'), { src: href });
        Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0' });
        frame.onload = () => {
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            resolve();
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
          setTimeout(() => frame.remove(), 60_000);
        };
        document.body.appendChild(frame);
      });
      revokeLater();
      return 'dialog';
    } catch {
      /* fall through to a new tab */
    }
  }
  window.open(href, '_blank', 'noopener');
  revokeLater();
  return 'tab';
}

/** Opens a PDF (preview) in a new tab. */
export async function openPdf(request: Promise<{ data: unknown }>) {
  const res = await request;
  const href = URL.createObjectURL(new Blob([res.data as Blob], { type: 'application/pdf' }));
  window.open(href, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(href), 120_000);
}
