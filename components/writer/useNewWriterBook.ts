import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { createWriterBook } from '@/lib/writer-create';

/** One write per explicit click, bound to this focused account and screen. */
export function useNewWriterBook(owner: string, onOpen: (id: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const focused = useRef(false);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const created = useRef<string | null>(null);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    locked.current = false;
    created.current = null;
    setBusy(false);
    return () => { focused.current = false; };
  }, [owner]));

  const create = async () => {
    if (locked.current || !focused.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const alive = () => focused.current && currentOwner.current === owner;
    try {
      const id = created.current ?? await createWriterBook(owner, alive);
      if (!alive()) return;
      created.current = id;
      onOpen(id);
      // Remain locked until navigation finishes or the screen is focused again.
    } catch (e) {
      if (!alive()) return;
      locked.current = false;
      setBusy(false);
      setError('Yeni kitap açılamadı: ' + (e instanceof Error ? e.message : 'Cihaz deposunu kontrol edip tekrar dene.'));
    }
  };
  return { busy, error, create };
}
