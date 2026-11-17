export type SampleChatLine = { id: string; body: string; createdAt: string };
export const SAMPLE_CHAT_LIMIT = 200;
export const sampleChatKey = (owner: string, thread: string) => 'afilli_sample_chat_v1:' + encodeURIComponent(owner) + ':' + encodeURIComponent(thread);

/** Refuse to overwrite a damaged archive; a failed restore is not an empty chat. */
export function parseSampleChat(raw: string | null): SampleChatLine[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > SAMPLE_CHAT_LIMIT || value.some((item) =>
    !item || typeof item !== 'object' || typeof item.id !== 'string' ||
    typeof item.body !== 'string' || item.body.length > 1000 || !item.body.trim() ||
    typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)))) {
    throw new Error('Örnek sohbetin cihaz kaydı okunamadı. Kayıt silinmedi.');
  }
  return value;
}
