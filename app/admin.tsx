import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAdminOverview, getGetAdminOverviewQueryKey, useGetAdminAccounts, getGetAdminAccountsQueryKey,
  useUpdateAdminAccount, useGetAdminContent, getGetAdminContentQueryKey, useUpdateAdminContent,
  useGetAdminHistory, getGetAdminHistoryQueryKey,
  type AdminAccount, type AdminContent, type AdminContentKind, type AdminRole,
} from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { F, tap } from '@/components/ui';
import { apiError, timeAgo } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, P, PillTabs, Skeleton, StateCard, TopBar, k } from '@/components/profile/kit';
import { actorRequest, go, scoped, useFocusedForeground, useOwnerGuard, withIdentity } from '@/components/profile/hooks';

const PAGE = 25;
type Tab = 'overview' | 'accounts' | 'content' | 'history';
const ROLE_LABEL: Record<AdminRole, string> = { user: 'Okur', admin: 'Yönetici', superadmin: 'Süper yönetici' };
const KINDS: { key: AdminContentKind; label: string }[] = [
  { key: 'book', label: 'Kitaplar' }, { key: 'bulletin', label: 'Bültenler' },
  { key: 'writer_comment', label: 'Yazar yorumları' }, { key: 'bulletin_comment', label: 'Bülten yorumları' },
];
const KIND_ONE: Record<AdminContentKind, string> = { book: 'Kitap', bulletin: 'Bülten', writer_comment: 'Yazar yorumu', bulletin_comment: 'Bülten yorumu' };

type Pending =
  | { type: 'role'; account: AdminAccount; role: AdminRole }
  | { type: 'disable'; account: AdminAccount; disabled: boolean }
  | { type: 'nickname'; account: AdminAccount }
  | { type: 'content'; item: AdminContent; hidden: boolean };

function useQ(userId: string | null, live: boolean) {
  return { staleTime: 15_000, refetchOnMount: 'always' as const, refetchInterval: live ? 30_000 : (false as const) , enabled: !!userId };
}

function useDebounced(value: string, ms = 350) {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setV(value.trim()), ms);
    return () => { if (t.current) clearTimeout(t.current); };
  }, [value, ms]);
  return v;
}

function Pager({ offset, total, next, onChange, loading, id }: { offset: number; total: number; next: number | null; onChange: (o: number) => void; loading: boolean; id: string }) {
  const from = total === 0 ? 0 : offset + 1; const to = Math.min(offset + PAGE, total);
  return (
    <View style={st.pager}>
      <PagerBtn icon="chevron-left" label="Önceki sayfa" disabled={offset === 0 || loading} onPress={() => onChange(Math.max(0, offset - PAGE))} testID={id + '-prev'} />
      <Text style={st.pagerText} testID={id + '-range'}>{from}–{to} / {total}</Text>
      <PagerBtn icon="chevron-right" label="Sonraki sayfa" disabled={next == null || loading} onPress={() => next != null && onChange(next)} testID={id + '-next'} />
    </View>
  );
}
function PagerBtn({ icon, label, disabled, onPress, testID }: { icon: keyof typeof Feather.glyphMap; label: string; disabled: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [k.round, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <Feather name={icon} size={18} color={P.text} />
    </Pressable>
  );
}

function Search({ value, onChange, placeholder, testID }: { value: string; onChange: (v: string) => void; placeholder: string; testID: string }) {
  return (
    <View style={st.search}>
      <Feather name="search" size={16} color={P.muted} />
      <TextInput testID={testID} accessibilityLabel={placeholder} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={P.muted}
        autoCapitalize="none" autoCorrect={false} maxLength={100} returnKeyType="search" style={st.searchInput} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Aramayı temizle"><Feather name="x" size={16} color={P.muted} /></Pressable> : null}
    </View>
  );
}

function ListSkeleton() {
  return <View style={{ paddingHorizontal: 18, gap: 10 }} accessibilityLabel="Yükleniyor">{[0, 1, 2, 3].map((i) => <Skeleton key={i} w="100%" h={74} r={16} />)}</View>;
}

function Chip({ text, tone = 'plain' }: { text: string; tone?: 'plain' | 'gold' | 'danger' }) {
  const c = tone === 'danger' ? P.danger : tone === 'gold' ? P.gold : P.muted;
  return <View style={[st.chip, { borderColor: c }]}><Text style={[st.chipText, { color: c }]}>{text}</Text></View>;
}

function Overview({ o, onTab }: { o: { role: AdminRole; users: number; disabledUsers: number; books: number; bulletins: number; comments: number; hiddenContent: number }; onTab: (t: Tab) => void }) {
  const cells: { label: string; value: number; icon: keyof typeof Feather.glyphMap; id: string }[] = [
    { label: 'Hesap', value: o.users, icon: 'users', id: 'users' },
    { label: 'Askıdaki hesap', value: o.disabledUsers, icon: 'user-x', id: 'disabled' },
    { label: 'Kitap', value: o.books, icon: 'book', id: 'books' },
    { label: 'Bülten', value: o.bulletins, icon: 'file-text', id: 'bulletins' },
    { label: 'Yorum', value: o.comments, icon: 'message-circle', id: 'comments' },
    { label: 'Gizlenen içerik', value: o.hiddenContent, icon: 'eye-off', id: 'hidden' },
  ];
  return (
    <View style={{ gap: 14 }}>
      <View style={st.grid}>
        {cells.map((c) => (
          <View key={c.id} style={st.cell} testID={'admin-stat-' + c.id} accessible accessibilityLabel={`${c.label}: ${c.value}`}>
            <Feather name={c.icon} size={16} color={P.gold} />
            <Text style={st.cellValue}>{c.value.toLocaleString('tr-TR')}</Text>
            <Text style={st.cellLabel}>{c.label}</Text>
          </View>
        ))}
      </View>
      <View style={k.card}>
        {o.role === 'superadmin' ? <NavRow icon="users" label="Hesap yönetimi" sub="Rol, askı ve takma ad" testID="admin-go-accounts" onPress={() => onTab('accounts')} /> : null}
        <NavRow icon="shield" label="İçerik denetimi" sub="Kitap, bülten ve yorumları gizle ya da geri getir" testID="admin-go-content" onPress={() => onTab('content')} />
        <NavRow icon="clock" label="İşlem geçmişi" sub="Tüm yönetici işlemleri ve gerekçeleri" testID="admin-go-history" onPress={() => onTab('history')} />
        <NavRow icon="instagram" label="Instagram Linki" sub="Tüm profillerde görünen ortak hesap" testID="admin-go-settings" onPress={() => go('/social-admin')} />
      </View>
    </View>
  );
}
function NavRow({ icon, label, sub, onPress, testID }: { icon: keyof typeof Feather.glyphMap; label: string; sub: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [st.navRow, { backgroundColor: pressed ? P.input : 'transparent' }]}>
      <Feather name={icon} size={18} color={P.gold} />
      <View style={{ flex: 1 }}><Text style={st.rowTitle}>{label}</Text><Text style={st.rowSub}>{sub}</Text></View>
      <Feather name="chevron-right" size={18} color={P.muted} />
    </Pressable>
  );
}

function Accounts({ userId, live, onAct }: { userId: string; live: boolean; onAct: (p: Pending) => void }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [dq]);
  const params = { q: dq || undefined, offset };
  const list = useGetAdminAccounts(params, { request: actorRequest(userId), query: { ...useQ(userId, live), queryKey: scoped(getGetAdminAccountsQueryKey(params), userId) } });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={{ gap: 12 }}>
      <Search value={q} onChange={setQ} placeholder="Takma ad veya e-posta ara" testID="admin-accounts-search" />
      {list.isLoading && !list.data ? <ListSkeleton /> : list.isError && !list.data ? (
        <StateCard icon="wifi-off" title="Hesaplar yüklenemedi" text={apiError(list.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-accounts-retry', onPress: () => list.refetch() }} />
      ) : list.data && list.data.items.length === 0 ? (
        <StateCard icon="user" title={dq ? 'Eşleşen hesap yok' : 'Henüz hesap yok'} text={dq ? `"${dq}" için sonuç bulunamadı.` : 'Kayıt olan hesaplar burada listelenir.'} testID="admin-accounts-empty" />
      ) : list.data ? (<>
        <View style={k.card}>
          {list.data.items.map((a) => {
            const self = a.id === userId; const expanded = open === a.id;
            return (
              <View key={a.id} style={st.item} testID={'admin-account-' + a.id}>
                <Pressable onPress={() => { tap(); setOpen(expanded ? null : a.id); }} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${a.nickname} hesabı işlemleri`} style={{ gap: 4 }}>
                  <View style={st.itemHead}>
                    <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>{a.nickname}{self ? ' (sen)' : ''}</Text>
                    <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={P.muted} />
                  </View>
                  <Text style={st.rowSub} numberOfLines={1}>{a.email}</Text>
                  <View style={st.chips}>
                    <Chip text={ROLE_LABEL[a.role]} tone={a.role === 'user' ? 'plain' : 'gold'} />
                    {a.disabled ? <Chip text="Askıda" tone="danger" /> : null}
                    <Chip text={a.emailVerified ? 'E-posta doğrulandı' : 'E-posta doğrulanmadı'} />
                    <Text style={st.meta}>{new Date(a.createdAt).toLocaleDateString('tr-TR')}</Text>
                  </View>
                </Pressable>
                {expanded ? (
                  <View style={st.actions}>
                    {self ? <Text style={st.rowSub}>Kendi rolünü değiştiremez, hesabını askıya alamazsın.</Text> : null}
                    {(['user', 'admin', 'superadmin'] as AdminRole[]).filter((r) => r !== a.role).map((r) => {
                      const blocked = self || (a.disabled && r !== 'user');
                      return <SmallBtn key={r} icon="award" label={`${ROLE_LABEL[r]} yap`} disabled={blocked} testID={`admin-role-${r}-${a.id}`} onPress={() => onAct({ type: 'role', account: a, role: r })} />;
                    })}
                    {a.disabled && a.role === 'user' ? null : a.disabled ? <Text style={st.rowSub}>Askıdaki hesaplara yetki verilemez.</Text> : null}
                    <SmallBtn icon={a.disabled ? 'user-check' : 'user-x'} label={a.disabled ? 'Askıyı kaldır' : 'Askıya al'} danger={!a.disabled} disabled={self} testID={'admin-disable-' + a.id} onPress={() => onAct({ type: 'disable', account: a, disabled: !a.disabled })} />
                    <SmallBtn icon="edit-2" label="Takma adı değiştir" testID={'admin-nickname-' + a.id} onPress={() => onAct({ type: 'nickname', account: a })} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
        <Pager id="admin-accounts" offset={offset} total={list.data.total} next={list.data.nextOffset} onChange={setOffset} loading={list.isFetching} />
      </>) : null}
    </View>
  );
}

function SmallBtn({ icon, label, onPress, disabled, danger, testID }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; disabled?: boolean; danger?: boolean; testID: string }) {
  const c = danger ? P.danger : P.text;
  return (
    <Pressable testID={testID} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [st.small, { borderColor: danger ? P.danger : P.border, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <Feather name={icon} size={14} color={c} /><Text style={[st.smallText, { color: c }]}>{label}</Text>
    </Pressable>
  );
}

function Content({ userId, live, onAct }: { userId: string; live: boolean; onAct: (p: Pending) => void }) {
  const [kind, setKind] = useState<AdminContentKind>('book');
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [dq, kind]);
  const params = { kind, q: dq || undefined, offset };
  const list = useGetAdminContent(params, { request: actorRequest(userId), query: { ...useQ(userId, live), queryKey: scoped(getGetAdminContentQueryKey(params), userId) } });
  return (
    <View style={{ gap: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
        {KINDS.map((x) => {
          const on = x.key === kind;
          return (
            <Pressable key={x.key} testID={'admin-kind-' + x.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { tap(); setKind(x.key); }}
              style={[st.kind, on && { backgroundColor: P.text, borderColor: P.text }]}>
              <Text style={[st.kindText, on && { color: P.card }]}>{x.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Search value={q} onChange={setQ} placeholder="Başlık, metin veya yazar ara" testID="admin-content-search" />
      {kind === 'book' ? <Notice text="Taslak kitaplarda yalnızca künye bilgisi görünür; özel metinler yönetici panelinde açılmaz veya düzenlenmez." /> : null}
      {list.isLoading && !list.data ? <ListSkeleton /> : list.isError && !list.data ? (
        <StateCard icon="wifi-off" title="İçerik yüklenemedi" text={apiError(list.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-content-retry', onPress: () => list.refetch() }} />
      ) : list.data && list.data.items.length === 0 ? (
        <StateCard icon="inbox" title={dq ? 'Eşleşen içerik yok' : 'Burada içerik yok'} text={dq ? `"${dq}" için sonuç bulunamadı.` : 'Bu türde denetlenecek içerik henüz yok.'} testID="admin-content-empty" />
      ) : list.data ? (<>
        <View style={k.card}>
          {list.data.items.map((c) => (
            <View key={c.id} style={[st.item, c.hidden && { backgroundColor: P.input }]} testID={'admin-content-' + c.id}>
              <View style={st.itemHead}>
                <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={2}>{c.title || KIND_ONE[c.kind]}</Text>
                {c.hidden ? <Chip text="Gizli" tone="danger" /> : null}
              </View>
              <Text style={st.rowSub} numberOfLines={1}>{c.author} · {timeAgo(c.createdAt)}{c.publication ? ' · ' + (c.publication === 'draft' ? 'Taslak' : c.publication === 'published' ? 'Yayında' : c.publication) : ''}</Text>
              {c.body ? <Text style={st.body} numberOfLines={3}>{c.body}</Text> : null}
              <View style={st.actions}>
                <SmallBtn icon={c.hidden ? 'eye' : 'eye-off'} label={c.hidden ? 'Geri getir' : 'Gizle'} danger={!c.hidden} testID={'admin-moderate-' + c.id} onPress={() => onAct({ type: 'content', item: c, hidden: !c.hidden })} />
              </View>
            </View>
          ))}
        </View>
        <Pager id="admin-content" offset={offset} total={list.data.total} next={list.data.nextOffset} onChange={setOffset} loading={list.isFetching} />
      </>) : null}
    </View>
  );
}

function History({ userId, live }: { userId: string; live: boolean }) {
  const [offset, setOffset] = useState(0);
  const params = { offset };
  const list = useGetAdminHistory(params, { request: actorRequest(userId), query: { ...useQ(userId, live), queryKey: scoped(getGetAdminHistoryQueryKey(params), userId) } });
  if (list.isLoading && !list.data) return <ListSkeleton />;
  if (list.isError && !list.data) return <StateCard icon="wifi-off" title="Geçmiş yüklenemedi" text={apiError(list.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-history-retry', onPress: () => list.refetch() }} />;
  if (!list.data) return null;
  if (list.data.items.length === 0) return <StateCard icon="clock" title="Henüz işlem yok" text="Yönetici işlemleri gerekçeleriyle birlikte burada kayıt altına alınır." testID="admin-history-empty" />;
  return (
    <View style={{ gap: 12 }}>
      <View style={k.card}>
        {list.data.items.map((h) => (
          <View key={h.id} style={st.item} testID={'admin-history-' + h.id}>
            <View style={st.itemHead}>
              <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>{h.action}</Text>
              <Text style={st.meta}>{new Date(h.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</Text>
            </View>
            <Text style={st.rowSub} numberOfLines={1}>{h.actor} · {h.targetType} · {h.targetId}</Text>
            <Text style={st.body}>"{h.reason}"</Text>
          </View>
        ))}
      </View>
      <Pager id="admin-history" offset={offset} total={list.data.total} next={list.data.nextOffset} onChange={setOffset} loading={list.isFetching} />
    </View>
  );
}

function ConfirmSheet({ pending, userId, onClose, onDone }: { pending: Pending | null; userId: string; onClose: () => void; onDone: (text: string) => void }) {
  const qc = useQueryClient();
  const alive = useOwnerGuard(userId);
  const acc = useUpdateAdminAccount({ request: actorRequest(userId) });
  const mod = useUpdateAdminContent({ request: actorRequest(userId) });
  const [reason, setReason] = useState(''); const [nick, setNick] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => { setReason(''); setErr(null); setNick(pending?.type === 'nickname' ? pending.account.nickname : ''); }, [pending]);
  if (!pending) return null;
  const r = reason.trim(); const n = nick.trim();
  const reasonBad = r.length < 3 || r.length > 300;
  const nickBad = pending.type === 'nickname' && (n.length < 3 || n.length > 15 || n === pending.account.nickname);
  const self = pending.type !== 'content' && pending.account.id === userId;
  const blocked = (pending.type === 'role' && (self || (pending.account.disabled && pending.role !== 'user'))) || (pending.type === 'disable' && self);
  const title = pending.type === 'role' ? 'Rolü değiştir' : pending.type === 'disable' ? (pending.disabled ? 'Hesabı askıya al' : 'Askıyı kaldır') : pending.type === 'nickname' ? 'Takma adı değiştir' : pending.hidden ? 'İçeriği gizle' : 'İçeriği geri getir';
  const desc = pending.type === 'role' ? `${pending.account.nickname} hesabının rolü "${ROLE_LABEL[pending.account.role]}" yerine "${ROLE_LABEL[pending.role]}" olacak.`
    : pending.type === 'disable' ? (pending.disabled ? `${pending.account.nickname} giriş yapamayacak ve paylaşım yapamayacak. Bu işlem geri alınabilir.` : `${pending.account.nickname} yeniden giriş yapabilecek.`)
    : pending.type === 'nickname' ? `${pending.account.nickname} için yeni takma ad gir (3-15 karakter).`
    : `${KIND_ONE[pending.item.kind]} "${pending.item.title || pending.item.body.slice(0, 40)}" ${pending.hidden ? 'herkesten gizlenecek. Silinmez; daha sonra geri getirilebilir.' : 'yeniden görünür olacak.'}`;

  const submit = async () => {
    if (lock.current || reasonBad || nickBad || blocked) return;
    lock.current = true; setBusy(true); setErr(null);
    try {
      if (pending.type === 'content') await mod.mutateAsync({ kind: pending.item.kind, id: pending.item.id, data: { hidden: pending.hidden, reason: r } });
      else await acc.mutateAsync({ id: pending.account.id, data: pending.type === 'role' ? { role: pending.role, reason: r } : pending.type === 'disable' ? { disabled: pending.disabled, reason: r } : { nickname: n, reason: r } });
      await qc.invalidateQueries();
      if (alive()) onDone(pending.type === 'content' ? (pending.hidden ? 'İçerik gizlendi.' : 'İçerik geri getirildi.') : 'Hesap güncellendi.');
    } catch (e) { if (alive()) setErr(apiError(e, 'İşlem tamamlanamadı. Tekrar dene.')); }
    finally { lock.current = false; if (alive()) setBusy(false); }
  };
  const close = () => { if (!lock.current) onClose(); };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable style={st.backdrop} onPress={close} accessibilityLabel="Kapat">
          <Pressable style={st.sheet} onPress={() => {}} testID="admin-confirm-sheet">
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 12 }}>
              <Text style={st.sheetTitle} accessibilityRole="header">{title}</Text>
              <Text style={st.rowSub}>{desc}</Text>
              {blocked ? <Notice tone="error" text={self ? 'Kendi rolünü değiştiremez veya kendini askıya alamazsın.' : 'Askıdaki hesaplara yetki verilemez.'} /> : null}
              {pending.type === 'nickname' ? (
                <View>
                  <Text style={k.label}>Yeni takma ad</Text>
                  <TextInput testID="admin-confirm-nickname" accessibilityLabel="Yeni takma ad" value={nick} onChangeText={setNick} maxLength={15} autoCorrect={false} style={k.input} />
                </View>
              ) : null}
              <View>
                <Text style={k.label}>Gerekçe</Text>
                <TextInput testID="admin-confirm-reason" accessibilityLabel="Gerekçe" value={reason} onChangeText={(v) => { setReason(v); setErr(null); }} multiline maxLength={300}
                  placeholder="Bu işlemi neden yaptığını kısaca yaz" placeholderTextColor={P.muted} style={[k.input, { minHeight: 90, textAlignVertical: 'top' }]} />
                <Text style={reason && reasonBad ? k.err : k.hint}>{r.length}/300 · en az 3 karakter. İşlem geçmişine kaydedilir.</Text>
              </View>
              {err ? <Notice tone="error" text={err} testID="admin-confirm-error" /> : null}
              <FoilButton label="Onayla" icon="check" testID="admin-confirm-submit" busy={busy} disabled={reasonBad || nickBad || blocked} onPress={submit} style={{ flex: 0, minHeight: 48, flexShrink: 0 }} />
              <FoilButton variant="outline" label="Vazgeç" testID="admin-confirm-cancel" disabled={busy} onPress={close} style={{ flex: 0, minHeight: 48, flexShrink: 0 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AdminPanel() {
  const { ready, userId } = useCommunity();
  const live = useFocusedForeground();
  const [tab, setTab] = useState<Tab>('overview');
  const [pending, setPending] = useState<Pending | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const ov = useGetAdminOverview({ request: actorRequest(userId), query: { ...useQ(ready ? userId : null, live), retry: 1, queryKey: scoped(getGetAdminOverviewQueryKey(), userId) } });
  const o = ov.data;
  const status = (ov.error as { status?: number } | null)?.status;
  const superadmin = o?.role === 'superadmin';
  const act = (p: Pending) => { setMsg(null); setPending(p); };

  let body: React.ReactNode;
  if (!ready || (userId && ov.isLoading)) body = <ListSkeleton />;
  else if (!userId) body = <StateCard testID="admin-login" icon="log-in" title="Giriş yapman gerekiyor" text="Yönetim paneli için yönetici hesabınla giriş yap." action={{ label: 'Giriş yap', testID: 'admin-sign-in', onPress: () => go('/sign-in') }} />;
  else if (ov.isError && (status === 401 || status === 403)) body = <StateCard testID="admin-forbidden" icon="lock" title="Bu sayfa yöneticilere özel" text="Hesabının yönetim yetkisi yok." action={{ label: 'Profile dön', testID: 'admin-back', onPress: () => go('/profile') }} />;
  else if (!o) body = <StateCard testID="admin-error" icon="wifi-off" title="Panel yüklenemedi" text={apiError(ov.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-retry', onPress: () => ov.refetch() }} />;
  else if (o.role === 'user') body = <StateCard testID="admin-forbidden" icon="lock" title="Bu sayfa yöneticilere özel" text="Hesabının yönetim yetkisi yok." action={{ label: 'Profile dön', testID: 'admin-back', onPress: () => go('/profile') }} />;
  else {
    const tabs: { key: Tab; label: string }[] = [{ key: 'overview', label: 'Genel' }, ...(superadmin ? [{ key: 'accounts' as Tab, label: 'Hesaplar' }] : []), { key: 'content', label: 'İçerik' }, { key: 'history', label: 'Geçmiş' }];
    const t = tab === 'accounts' && !superadmin ? 'overview' : tab;
    body = (
      <View style={{ gap: 14 }}>
        <View style={st.roleLine}>
          <Chip text={ROLE_LABEL[o.role]} tone="gold" />
          <Pressable testID="admin-refresh" accessibilityRole="button" accessibilityLabel="Yenile" onPress={() => { tap(); setMsg(null); void ov.refetch(); }} hitSlop={8} style={st.refresh}>
            {ov.isFetching ? <ActivityIndicator size="small" color={P.gold} /> : <Feather name="refresh-cw" size={15} color={P.gold} />}
            <Text style={st.refreshText}>Yenile</Text>
          </Pressable>
        </View>
        <PillTabs tabs={tabs} value={t} onChange={setTab} />
        {msg ? <Notice text={msg} testID="admin-message" /> : null}
        {t === 'overview' ? <View style={{ paddingHorizontal: 18 }}><Overview o={o} onTab={setTab} /></View>
          : t === 'accounts' ? <Accounts userId={userId} live={live} onAct={act} />
          : t === 'content' ? <Content userId={userId} live={live} onAct={act} />
          : <History userId={userId} live={live} />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <TopBar back title="Yönetim paneli" />
        {body}
      </ScrollView>
      {userId && o && o.role !== 'user' && status !== 401 && status !== 403 ? <ConfirmSheet pending={pending} userId={userId} onClose={() => setPending(null)} onDone={(text) => { setPending(null); setMsg(text); }} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: '31%', flexGrow: 1, minWidth: 96, padding: 12, gap: 4, borderRadius: 16, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
  cellValue: { fontFamily: F.serifBold, fontSize: 22, color: P.text },
  cellLabel: { fontFamily: F.body, fontSize: 12, color: P.muted },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border },
  rowTitle: { fontFamily: F.semi, fontSize: 15, color: P.text },
  rowSub: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: P.muted },
  body: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: P.text },
  meta: { fontFamily: F.body, fontSize: 12, color: P.muted },
  item: { paddingHorizontal: 16, paddingVertical: 12, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontFamily: F.semi, fontSize: 11 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  small: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, backgroundColor: P.card },
  smallText: { fontFamily: F.semi, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  pagerText: { fontFamily: F.med, fontSize: 13, color: P.text, minWidth: 90, textAlign: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, paddingHorizontal: 14, minHeight: 46, borderRadius: 23, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
  searchInput: { flex: 1, fontFamily: F.body, fontSize: 15, color: P.text, paddingVertical: 10 },
  kind: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, justifyContent: 'center' },
  kindText: { fontFamily: F.semi, fontSize: 13, color: P.text },
  roleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  refresh: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  refreshText: { fontFamily: F.semi, fontSize: 13, color: P.gold },
  backdrop: { flex: 1, backgroundColor: 'rgba(62,42,26,0.42)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', backgroundColor: P.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: Platform.OS === 'web' ? 34 : 20 },
  sheetTitle: { fontFamily: F.serifBold, fontSize: 20, color: P.text },
});

export default withIdentity(AdminPanel);
