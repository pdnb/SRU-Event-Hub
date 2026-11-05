import { api } from './api';

/** Downloads an authenticated file response (Content-Disposition filename respected). */
export async function downloadFile(url: string, fallbackName: string, params?: object) {
  const res = await api.http.get(url, { params, responseType: 'blob' });
  const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data as Blob);
  const a = Object.assign(document.createElement('a'), { href, download: decodeURIComponent(name) });
  a.click();
  URL.revokeObjectURL(href);
}

/** Fetches an authenticated file as an object URL (caller must revoke it). */
export async function fetchObjectUrl(url: string): Promise<{ url: string; type: string }> {
  const res = await api.http.get(url, { responseType: 'blob' });
  const blob = res.data as Blob;
  return { url: URL.createObjectURL(blob), type: blob.type };
}
