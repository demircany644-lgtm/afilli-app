import type { MessageGif } from '@workspace/api-client-react';

// Public, client-side application key by provider design. Never log request URLs or this value.
const key = process.env.EXPO_PUBLIC_KLIPY_APP_KEY;
const mediaHosts = ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'];
function endpoint(path: string) {
  if (!key) throw new Error('KLIPY uygulama anahtarı bu derlemeye eklenmemiş.');
  return `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${path}`;
}
function mapGif(item: any): MessageGif {
  // Never drop/reorder an unhandled ad or malformed result and pretend the feed is complete.
  if (item?.type !== 'gif') throw new Error('KLIPY reklam/içerik ayarı bu GIF görünümüyle uyumlu değil. Partner Panelini kontrol et.');
  const file = item.file?.sm?.gif ?? item.file?.md?.gif ?? item.file?.hd?.gif;
  const slug = item.slug;
  if (!file || typeof slug !== 'string' || !slug || slug.length > 250) throw new Error('KLIPY geçerli GIF bilgisi döndürmedi.');
  let url: URL;
  try { url = new URL(file.url); } catch { throw new Error('KLIPY medya bağlantısı geçersiz.'); }
  if (url.protocol !== 'https:' || !mediaHosts.includes(url.hostname) || url.username || url.password || url.port
    || !Number.isInteger(file.width) || !Number.isInteger(file.height) || file.width < 1 || file.height < 1 || file.width > 4000 || file.height > 4000) throw new Error('KLIPY medya biçimi desteklenmiyor.');
  return { provider: 'klipy', id: slug, title: String(item.title ?? 'GIF').slice(0, 250),
    url: file.url, width: file.width, height: file.height, sourceUrl: `https://klipy.com/gifs/${encodeURIComponent(slug)}`,
    attribution: 'Powered by KLIPY', license: null };
}
export async function searchGifs(query: string, page: number, signal: AbortSignal, customerId: string): Promise<{ items: MessageGif[]; hasMore: boolean }> {
  const params = new URLSearchParams({ page: String(page), per_page: '18', customer_id: customerId, locale: 'tr', format_filter: 'gif', content_filter: 'high' });
  if (query.trim()) params.set('q', query.trim());
  let response: Response;
  try { response = await fetch(endpoint(query.trim() ? 'search' : 'trending') + '?' + params, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
  catch (e) { if (signal.aborted) throw e; throw new Error('KLIPY’ye bağlanılamadı. İnternetini kontrol edip tekrar dene.'); }
  if (!response.ok) throw new Error(response.status === 429 ? 'KLIPY deneme kotası doldu. Daha sonra dene veya üretim erişimini etkinleştir.' : 'KLIPY isteği kabul etmedi. Anahtarı ve erişim izinlerini kontrol et.');
  const payload = await response.json();
  if (!payload.result || !Array.isArray(payload.data?.data)) throw new Error('KLIPY yanıtı okunamadı.');
  return { items: payload.data.data.map(mapGif), hasMore: payload.data.has_next === true };
}
export async function notifyGifShared(gif: MessageGif, query: string, customerId: string, signal?: AbortSignal): Promise<void> {
  if (gif.provider !== 'klipy') return;
  let response: Response;
  try { response = await fetch(endpoint('share/' + encodeURIComponent(gif.id)), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_id: customerId, q: query }), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal }); }
  catch { throw new Error('KLIPY paylaşım kaydı iletilemedi.'); }
  if (!response.ok || !(await response.json()).result) throw new Error('KLIPY paylaşım kaydı iletilemedi.');
}
