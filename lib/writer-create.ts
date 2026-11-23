import { randomUUID } from 'expo-crypto';
import { newRecord, updateRecord } from './writer-store';
import { emptyDocument } from './writer-text';

/** Explicit creation only. Never reuse or overwrite an existing manuscript. */
export async function createWriterBook(owner: string, isCurrent: () => boolean): Promise<string> {
  if (!owner || !isCurrent()) throw new Error('Hesap değişti; yeni kitap oluşturulmadı.');
  const id = randomUUID();
  const saved = await updateRecord(owner, id, current => {
    if (!isCurrent()) throw new Error('Hesap değişti; yeni kitap oluşturulmadı.');
    if (current) throw new Error('Kitap kimliği çakıştı; mevcut kitaba dokunulmadı.');
    return newRecord(owner, id, randomUUID(), emptyDocument());
  });
  if (!saved) throw new Error('Yeni kitap cihaza kaydedilemedi.');
  return id;
}
