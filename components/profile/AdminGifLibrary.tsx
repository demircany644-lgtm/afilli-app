import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useGetGifLibrary, getGetGifLibraryQueryKey } from '@workspace/api-client-react';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { F, tap } from '@/components/ui';
import { apiError } from '@/components/bulletins/common';
import { FoilButton, Notice, Skeleton, StateCard, useKitStyles } from './kit';
import { actorRequest, scoped, useOwnerGuard } from './hooks';
import { LibraryGifImage } from './LibraryGifImage';
import { chooseLibraryGifs, releaseLibraryGif, uploadLibraryGif, type PickedLibraryGif } from '@/lib/library-gif-uploads';

type RowState = 'pending' | 'uploading' | 'done' | 'error';
type Row = { item: PickedLibraryGif; state: RowState; message?: string };
const STATE_LABEL: Record<RowState, string> = { pending: 'Sırada', uploading: 'Yükleniyor', done: 'Yüklendi', error: 'Hata' };

export function AdminGifLibrary({ userId }: { userId: string }) {
  const { magazine: P } = useTheme();
  const st = useStyles();
  const k = useKitStyles();
  const qc = useQueryClient();
  const alive = useOwnerGuard(userId);
  const [rows, setRows] = useState<Row[]>([]);
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickErr, setPickErr] = useState<string | null>(null);
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);

  const [offsets, setOffsets] = useState<number[]>([0]);
  const offset = offsets[offsets.length - 1];
  const params = { offset };
  const list = useGetGifLibrary(params, { request: actorRequest(userId), query: { queryKey: scoped(getGetGifLibraryQueryKey(params), userId), enabled: !!userId } });

  // Abort inflight upload on unmount or owner change; clean up local copies.
  useEffect(() => () => {
    abort.current?.abort();
    for (const r of rowsRef.current) void releaseLibraryGif(r.item).catch(() => {});
  }, [userId]);

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => r.item.clientId === id ? { ...r, ...p } : r));

  const pick = async () => {
    if (lock.current) return;
    lock.current = true; setPicking(true); setPickErr(null);
    try {
      const picked = await chooseLibraryGifs();
      if (!alive()) { for (const p of picked) void releaseLibraryGif(p).catch(() => {}); return; }
      const known = new Set(rowsRef.current.map((r) => r.item.clientId));
      const add = picked.filter((p) => !known.has(p.clientId)).map<Row>((p) => p.error ? { item: p, state: 'error', message: p.error } : { item: p, state: 'pending' });
      setRows((rs) => [...rs, ...add]);
    } catch (e) {
      if (alive()) setPickErr(e instanceof Error && e.message ? 'GIF seçilemedi: ' + e.message : 'GIF seçilemedi. Galeri iznini kontrol edip tekrar dene.');
    } finally { lock.current = false; if (alive()) setPicking(false); }
  };

  const run = async (ids: string[]) => {
    if (lock.current || ids.length === 0) return;
    lock.current = true; setBusy(true);
    const ctrl = new AbortController(); abort.current = ctrl;
    let ok = 0;
    try {
      for (const id of ids) {
        if (!alive() || ctrl.signal.aborted) break;
        const row = rowsRef.current.find((r) => r.item.clientId === id);
        if (!row || row.state === 'done' || row.item.error) continue;
        patch(id, { state: 'uploading', message: undefined });
        try {
          await uploadLibraryGif(row.item, { ...actorRequest(userId), signal: ctrl.signal }, alive);
          if (!alive()) break;
          ok++;
          patch(id, { state: 'done' });
          void releaseLibraryGif(row.item).catch(() => {});
        } catch (e) {
          if (!alive() || ctrl.signal.aborted) break;
          patch(id, { state: 'error', message: apiError(e, 'GIF yüklenemedi. Aynı dosyada tekrar dene.') });
        }
      }
      if (ok > 0 && alive()) await qc.invalidateQueries({ queryKey: getGetGifLibraryQueryKey() });
    } finally {
      if (abort.current === ctrl) abort.current = null;
      lock.current = false;
      if (alive()) setBusy(false);
    }
  };

  const uploadAll = () => run(rows.filter((r) => r.state === 'pending' && !r.item.error).map((r) => r.item.clientId));
  const remove = (id: string) => {
    if (busy) return;
    const r = rowsRef.current.find((x) => x.item.clientId === id);
    if (r) void releaseLibraryGif(r.item).catch(() => {});
    setRows((rs) => rs.filter((x) => x.item.clientId !== id));
  };
  const clearDone = () => { if (!busy) setRows((rs) => rs.filter((r) => r.state !== 'done')); };

  const count = (s: RowState) => rows.filter((r) => r.state === s).length;
  const done = count('done'), errs = count('error'), waiting = count('pending'), active = count('uploading');

  return (
    <View style={{ gap: 14 }}>
      <View style={[k.card, { padding: 16, gap: 12 }]}>
        <Text style={st.title} accessibilityRole="header">Afilli GIF kitaplığı</Text>
        <Text style={st.sub}>Yüklenen GIF'ler tüm okurların sohbet seçicisinde görünür. Yalnızca süper yöneticiler yükleyebilir.</Text>
        <View style={st.rules}>
          {['En fazla 5 MB', 'En fazla 2000×2000 piksel', 'En fazla 200 kare'].map((t) => (
            <View key={t} style={st.rule}><Feather name="check" size={12} color={P.gold} /><Text style={st.ruleText}>{t}</Text></View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <FoilButton variant="outline" icon="image" label="GIF seç" testID="admin-gif-pick" busy={picking} disabled={busy} onPress={pick} />
          <FoilButton icon="upload" label={waiting ? `Yükle (${waiting})` : 'Yükle'} testID="admin-gif-upload" busy={busy} disabled={picking || waiting === 0} onPress={uploadAll} />
        </View>
        {pickErr ? <Notice tone="error" text={pickErr} testID="admin-gif-pick-error" /> : null}
        {rows.length > 0 ? (
          <View style={st.summary} testID="admin-gif-summary" accessibilityLiveRegion="polite">
            <Text style={st.summaryText}>{done}/{rows.length} yüklendi{active ? ' · 1 yükleniyor' : ''}{waiting ? ` · ${waiting} sırada` : ''}{errs ? ` · ${errs} hatalı` : ''}</Text>
            <View style={st.bar}><View style={[st.barFill, { width: `${(done / rows.length) * 100}%` }]} /></View>
            {done > 0 && !busy ? <Pressable onPress={() => { tap(); clearDone(); }} accessibilityRole="button" testID="admin-gif-clear-done"><Text style={st.link}>Yüklenenleri listeden kaldır</Text></Pressable> : null}
          </View>
        ) : null}
      </View>

      {rows.length > 0 ? (
        <View style={k.card}>
          {rows.map((r) => {
            const id = r.item.clientId; const invalid = !!r.item.error;
            const tone = r.state === 'error' ? P.danger : r.state === 'done' ? P.gold : P.muted;
            return (
              <View key={id} style={st.row} testID={'admin-gif-row-' + id}>
                {invalid || r.state === 'done' ? <View style={[st.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Feather name={r.state === 'done' ? 'check-circle' : 'alert-circle'} size={23} color={tone} />
                </View> : <Image source={{ uri: r.item.uri }} style={st.thumb} contentFit="cover" autoplay accessibilityLabel={r.item.title} />}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{r.item.title}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {r.state === 'uploading' ? <ActivityIndicator size="small" color={P.gold} /> : <Feather name={r.state === 'done' ? 'check-circle' : r.state === 'error' ? 'alert-circle' : 'clock'} size={13} color={tone} />}
                    <Text style={[st.meta, { color: tone }]}>{STATE_LABEL[r.state]}{r.item.size ? ' · ' + (r.item.size / 1024 / 1024).toFixed(2).replace('.', ',') + ' MB' : ''}</Text>
                  </View>
                  {r.message ? <Text style={st.err} testID={'admin-gif-error-' + id}>{r.message}</Text> : null}
                </View>
                <View style={{ gap: 6 }}>
                  {r.state === 'error' && !invalid ? (
                    <IconBtn icon="rotate-cw" label="Tekrar dene" disabled={busy} testID={'admin-gif-retry-' + id} onPress={() => run([id])} />
                  ) : null}
                  {r.state !== 'done' && r.state !== 'uploading' ? (
                    <IconBtn icon="x" label="Listeden kaldır" disabled={busy} testID={'admin-gif-remove-' + id} onPress={() => remove(id)} />
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <Text style={st.section} accessibilityRole="header">Yayındaki GIF'ler</Text>
      {list.isLoading && !list.data ? (
        <View style={st.grid}>{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} w="31%" h={104} r={14} />)}</View>
      ) : list.isError && !list.data ? (
        <StateCard icon="wifi-off" title="GIF kitaplığı yüklenemedi" text={apiError(list.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-gif-list-retry', onPress: () => { void list.refetch(); } }} />
      ) : list.data && list.data.items.length === 0 ? (
        <StateCard icon="film" title="Kitaplık henüz boş" text="Yüklediğin ilk GIF burada ve sohbet seçicisinde görünür." testID="admin-gif-empty" />
      ) : list.data ? (<>
        <View style={st.grid}>
          {list.data.items.map((g) => (
            <PublishedGifTile key={g.provider + g.id} id={g.id} title={g.title} />
          ))}
        </View>
        <View style={st.pager}>
          <IconBtn icon="chevron-left" label="Önceki sayfa" disabled={offsets.length <= 1 || list.isFetching} testID="admin-gif-prev" onPress={() => setOffsets((o) => o.slice(0, -1))} />
          <Text style={st.pagerText}>Sayfa {offsets.length}</Text>
          <IconBtn icon="chevron-right" label="Sonraki sayfa" disabled={list.data.nextOffset == null || list.isFetching} testID="admin-gif-next" onPress={() => { const n = list.data?.nextOffset; if (n != null) setOffsets((o) => [...o, n]); }} />
        </View>
      </>) : null}
    </View>
  );
}

function PublishedGifTile({ id, title }: { id: string; title: string }) {
  const st = useStyles();
  const [size, setSize] = useState(96);
  return <View style={st.tile} testID={'admin-gif-item-' + id}>
    <View style={st.tileMedia} onLayout={e => setSize(Math.max(1, Math.floor(e.nativeEvent.layout.width) - 2))}>
      <LibraryGifImage id={id} width={size} height={size} label={title} />
    </View>
    <Text style={st.tileText} numberOfLines={1}>{title}</Text>
  </View>;
}

function IconBtn({ icon, label, onPress, disabled, testID }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const { magazine: P } = useTheme();
  const st = useStyles();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} hitSlop={6}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [st.iconBtn, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <Feather name={icon} size={16} color={P.text} />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => {
  const { magazine: P } = t;
  return StyleSheet.create({
    title: { fontFamily: F.serifBold, fontSize: 19, color: P.text },
    sub: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: P.muted },
    rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    rule: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: P.border, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: P.input },
    ruleText: { fontFamily: F.semi, fontSize: 11, color: P.text },
    summary: { gap: 6 },
    summaryText: { fontFamily: F.med, fontSize: 13, color: P.text },
    bar: { height: 4, borderRadius: 2, backgroundColor: P.input, overflow: 'hidden' },
    barFill: { height: 4, backgroundColor: P.gold },
    link: { fontFamily: F.semi, fontSize: 13, color: P.gold },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border },
    thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: P.input },
    rowTitle: { fontFamily: F.semi, fontSize: 14, color: P.text },
    meta: { fontFamily: F.med, fontSize: 12 },
    err: { fontFamily: F.med, fontSize: 12, lineHeight: 17, color: P.danger },
    iconBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, alignItems: 'center', justifyContent: 'center' },
    section: { fontFamily: F.serifBold, fontSize: 18, color: P.text, marginHorizontal: 20 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 18 },
    tile: { width: '31%', flexGrow: 0, gap: 4 },
    tileMedia: { aspectRatio: 1, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: P.border, backgroundColor: P.input, alignItems: 'center', justifyContent: 'center' },
    tileText: { fontFamily: F.body, fontSize: 11, color: P.muted },
    pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
    pagerText: { fontFamily: F.med, fontSize: 13, color: P.text, minWidth: 90, textAlign: 'center' },
  });
});

export default AdminGifLibrary;
