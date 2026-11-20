import type { DirectMessage } from '@workspace/api-client-react';

/** Decimal int64 strings: no precision loss and no lexicographic 9 > 10 mistake. */
export function compareSequence(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}
export function mergeMessages(previous: DirectMessage[], incoming: DirectMessage[]): DirectMessage[] {
  const map = new Map(previous.map(m => [m.id, m]));
  for (const m of incoming) {
    const old = map.get(m.id);
    const latest = old && compareSequence(old.changeSequence ?? '0', m.changeSequence ?? '0') > 0 ? old : m;
    const deletedAt = old?.deletedAt ?? m.deletedAt ?? null;
    const mediaExpired = !!(old?.mediaExpired || m.mediaExpired);
    let reply = old?.reply?.available === false ? old.reply : m.reply?.available === false ? m.reply : latest.reply;
    if (reply && (old?.reply?.mediaExpired || m.reply?.mediaExpired)) reply = { ...reply, mediaExpired: true, gif: null, photo: null };
    map.set(m.id, { ...latest, deletedAt, mediaExpired,
      body: deletedAt ? '' : latest.body, gif: deletedAt || mediaExpired ? null : latest.gif,
      photo: deletedAt || mediaExpired ? null : latest.photo, readAt: m.readAt ?? old?.readAt ?? null,
      reply: deletedAt ? null : reply });
  }
  return [...map.values()].sort((a, b) => compareSequence(b.sequence, a.sequence));
}
export function acknowledged(messages: DirectMessage[], owner: string, clientId: string) {
  return messages.some(m => m.sender.id === owner && m.clientId === clientId);
}

/** Chunk-safe SSE parser; transport frames may split anywhere, including inside UTF-8. */
export function eventParser(receive: (event: { kind: string; threadId?: string }) => void) {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 65536) throw new Error('Mesaj bağlantısı yanıtı geçersiz.');
    let end: number;
    while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const frame = buffer.slice(0, end);
      const delimiter = buffer.slice(end).match(/^\r?\n\r?\n/)![0];
      buffer = buffer.slice(end + delimiter.length);
      const raw = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!raw) continue;
      const value = JSON.parse(raw);
      if (value && ['ready', 'revoked', 'sync', 'message', 'read', 'typing'].includes(value.kind)) receive(value);
    }
  };
}
