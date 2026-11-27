import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAdminOverview, getGetAdminOverviewQueryKey, useGetAdminAccounts, getGetAdminAccountsQueryKey,
  useUpdateAdminAccount, useGetAdminContent, getGetAdminContentQueryKey, useUpdateAdminContent,
  useDeleteAdminAccount, useGetAdminAccountDeletion, getGetAdminAccountDeletionQueryKey,
  useGetAdminHistory, getGetAdminHistoryQueryKey, useGetReaderReports, getGetReaderReportsQueryKey, resolveReaderReport,
  useGetAdminPremiumApplications, getGetAdminPremiumApplicationsQueryKey, useDecideAdminPremiumApplication,
  useGetAdminAccountAppeals, getGetAdminAccountAppealsQueryKey, useDecideAdminAccountAppeal,
  useGetAdminStoreOrders, getGetAdminStoreOrdersQueryKey, useDecideAdminStoreOrder,
  useGetAdminStoreSettings, getGetAdminStoreSettingsQueryKey, useUpdateAdminStoreSettings,
  type ReaderReport, type GetReaderReportsStatus,
  type AdminAccount, type AdminContent, type AdminContentKind, type AdminRole, type AdminStoreOrder, type AdminAccountAppeal,
} from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { F, tap } from '@/components/ui';
import { apiError, timeAgo } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, PillTabs, Skeleton, StateCard, TopBar , useKitStyles } from '@/components/profile/kit';
import { AdminGifLibrary } from '@/components/profile/AdminGifLibrary';
import { AdminStoreProducts } from '@/components/profile/AdminStoreProducts';
import { AdminProhibitedImages } from '@/components/profile/AdminProhibitedImages';
import { AdminBookPromotions } from '@/components/profile/AdminBookPromotions';
import { StoreProductImage } from '@/components/store/StoreProductImage';
import { mediaUrl } from '@/components/bulletins/common';
import { actorRequest, go, scoped, useFocusedForeground, useOwnerGuard, withIdentity } from '@/components/profile/hooks';

const PAGE = 25;
type Tab = 'overview' | 'accounts' | 'content' | 'reports' | 'history' | 'gifs' | 'premium' | 'store' | 'promotions' | 'appeals' | 'prohibited';
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
  | { type: 'delete'; account: AdminAccount }
  | { type: 'content'; item: AdminContent; hidden: boolean }
  | { type: 'report'; report: ReaderReport; action: 'dismiss' | 'hide' };

function useQ(userId: string | null, live: boolean) {
  return { staleTime: 15_000, refetchOnMount: 'always' as const, refetchInterval: live ? 30_000 : (false as const) , enabled: !!userId };
}


function Pager({ offset, total, next, onChange, loading, id }: { offset: number; total: number; next: number | null; onChange: (o: number) => void; loading: boolean; id: string }) {
  const st = useStStyles();
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
  const { magazine: P } = useTheme();
  const k = useKitStyles();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [k.round, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <Feather name={icon} size={18} color={P.text} />
    </Pressable>
  );
}

/** Admin lists are not searchable; text search lives only in central Keşfet (public fields only). */
function KesfetShortcut({ testID }: { testID: string }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  return (
    <Pressable testID={testID} accessibilityRole="link" accessibilityLabel="Arama için Keşfet'e git" onPress={() => { tap(); go('/search?tab=people'); }}
      style={({ pressed }) => [st.search, { opacity: pressed ? 0.6 : 1 }]}>
      <Feather name="compass" size={16} color={P.muted} />
      <Text style={[st.searchInput, { color: P.muted }]}>Arama yalnızca Keşfet'te yapılır</Text>
      <Feather name="chevron-right" size={16} color={P.muted} />
    </Pressable>
  );
}

function ListSkeleton() {
  return <View style={{ paddingHorizontal: 18, gap: 10 }} accessibilityLabel="Yükleniyor">{[0, 1, 2, 3].map((i) => <Skeleton key={i} w="100%" h={74} r={16} />)}</View>;
}

function Chip({ text, tone = 'plain' }: { text: string; tone?: 'plain' | 'gold' | 'danger' }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const c = tone === 'danger' ? P.danger : tone === 'gold' ? P.gold : P.muted;
  return <View style={[st.chip, { borderColor: c }]}><Text style={[st.chipText, { color: c }]}>{text}</Text></View>;
}

function Overview({ o, onTab }: { o: { role: AdminRole; users: number; disabledUsers: number; books: number; bulletins: number; comments: number; hiddenContent: number }; onTab: (t: Tab) => void }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
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
        {o.role === 'superadmin' ? <NavRow icon="shield" label="Engel Kaldırma Talepleri" sub="Ücretli itirazları incele, hesabı aç veya reddet" testID="admin-go-account-appeals" onPress={() => onTab('appeals')} /> : null}
        {o.role === 'superadmin' ? <NavRow icon="film" label="GIF kitaplığı" sub="Sohbetlerde kullanılacak GIF'leri yükle" testID="admin-go-gifs" onPress={() => onTab('gifs')} /> : null}
        <NavRow icon="shield" label="İçerik denetimi" sub="Kitap, bülten ve yorumları gizle ya da geri getir" testID="admin-go-content" onPress={() => onTab('content')} />
        <NavRow icon="award" label="Premium başvuruları" sub="Başvuruları incele ve kararını kaydet" testID="admin-go-premium" onPress={() => onTab('premium')} />
        <NavRow icon="book-open" label="Kitap tanıtım talepleri" sub="Ücretsiz tanıtım süresi ve yayın onayı" testID="admin-go-promotions" onPress={() => onTab('promotions')} />
        <NavRow icon="shopping-bag" label="Mağaza ve ürün kataloğu" sub="Ürün ekle, talepleri ve mağaza durumunu yönet" testID="admin-go-store" onPress={() => onTab('store')} />
        <NavRow icon="flag" label="Yorum şikâyetleri" sub="Şikâyet edilen yorumları incele, kapat ya da gizle" testID="admin-go-reports" onPress={() => onTab('reports')} />
        <NavRow icon="clock" label="İşlem geçmişi" sub="Tüm yönetici işlemleri ve gerekçeleri" testID="admin-go-history" onPress={() => onTab('history')} />
        <NavRow icon="instagram" label="Instagram Linki" sub="Tüm profillerde görünen ortak hesap" testID="admin-go-settings" onPress={() => go('/social-admin')} />
      </View>
    </View>
  );
}
function NavRow({ icon, label, sub, onPress, testID }: { icon: keyof typeof Feather.glyphMap; label: string; sub: string; onPress: () => void; testID: string }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
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
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
  const [offset, setOffset] = useState(0);
  const params = { offset };
  const list = useGetAdminAccounts(params, { request: actorRequest(userId), query: { ...useQ(userId, live), queryKey: scoped(getGetAdminAccountsQueryKey(params), userId) } });
  useEffect(() => {
    if (list.data && offset > 0 && offset >= list.data.total) {
      setOffset(Math.max(0, Math.floor((list.data.total - 1) / PAGE) * PAGE));
    }
  }, [list.data?.total, offset]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={{ gap: 12 }}>
      <KesfetShortcut testID="admin-accounts-kesfet" />
      {list.isLoading && !list.data ? <ListSkeleton /> : list.isError && !list.data ? (
        <StateCard icon="wifi-off" title="Hesaplar yüklenemedi" text={apiError(list.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-accounts-retry', onPress: () => list.refetch() }} />
      ) : list.data && list.data.items.length === 0 ? (
        <StateCard icon="user" title="Henüz hesap yok" text="Kayıt olan hesaplar burada listelenir." testID="admin-accounts-empty" />
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
                    {self ? <Text style={st.rowSub}>Kendi rolünü değiştiremez, hesabını askıya alamaz veya silemezsin.</Text> : null}
                    {(['user', 'admin', 'superadmin'] as AdminRole[]).filter((r) => r !== a.role).map((r) => {
                      const blocked = self || (a.disabled && r !== 'user');
                      return <SmallBtn key={r} icon="award" label={`${ROLE_LABEL[r]} yap`} disabled={blocked} testID={`admin-role-${r}-${a.id}`} onPress={() => onAct({ type: 'role', account: a, role: r })} />;
                    })}
                    {a.disabled && a.role === 'user' ? null : a.disabled ? <Text style={st.rowSub}>Askıdaki hesaplara yetki verilemez.</Text> : null}
                    <SmallBtn icon={a.disabled ? 'user-check' : 'user-x'} label={a.disabled ? 'Askıyı kaldır' : 'Askıya al'} danger={!a.disabled} disabled={self} testID={'admin-disable-' + a.id} onPress={() => onAct({ type: 'disable', account: a, disabled: !a.disabled })} />
                    <SmallBtn icon="edit-2" label="Takma adı değiştir" testID={'admin-nickname-' + a.id} onPress={() => onAct({ type: 'nickname', account: a })} />
                    <SmallBtn icon="trash-2" label="Hesabı ve içeriklerini sil" danger disabled={self} testID={'admin-delete-' + a.id} onPress={() => onAct({ type: 'delete', account: a })} />
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
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const c = danger ? P.danger : P.text;
  return (
    <Pressable testID={testID} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [st.small, { borderColor: danger ? P.danger : P.border, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <Feather name={icon} size={14} color={c} /><Text style={[st.smallText, { color: c }]}>{label}</Text>
    </Pressable>
  );
}

function Content({ userId, live, onAct }: { userId: string; live: boolean; onAct: (p: Pending) => void }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
  const [kind, setKind] = useState<AdminContentKind>('book');
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [kind]);
  const params = { kind, offset };
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
      <KesfetShortcut testID="admin-content-kesfet" />
      {kind === 'book' ? <Notice text="Taslak kitaplarda yalnızca künye bilgisi görünür; özel metinler yönetici panelinde açılmaz veya düzenlenmez." /> : null}
      {list.isLoading && !list.data ? <ListSkeleton /> : list.isError && !list.data ? (
        <StateCard icon="wifi-off" title="İçerik yüklenemedi" text={apiError(list.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-content-retry', onPress: () => list.refetch() }} />
      ) : list.data && list.data.items.length === 0 ? (
        <StateCard icon="inbox" title="Burada içerik yok" text="Bu türde denetlenecek içerik henüz yok." testID="admin-content-empty" />
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

const REASON_LABEL: Record<ReaderReport['reason'], string> = { spam: 'Spam', abuse: 'Hakaret / taciz', other: 'Diğer' };
const STATUS_LABEL: Record<ReaderReport['status'], string> = { pending: 'Bekliyor', dismissed: 'Kapatıldı', hidden: 'Gizlendi' };
const REPORT_FILTERS: { key: GetReaderReportsStatus; label: string }[] = [
  { key: 'pending', label: 'Bekleyenler' }, { key: 'dismissed', label: 'Kapatılanlar' }, { key: 'hidden', label: 'Gizlenenler' },
];

function Reports({ userId, live, onAct }: { userId: string; live: boolean; onAct: (p: Pending) => void }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
  const [status, setStatus] = useState<GetReaderReportsStatus>('pending');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  useEffect(() => setCursors([undefined]), [status]);
  const cursor = cursors[cursors.length - 1];
  const params = cursor ? { status, cursor } : { status };
  const list = useGetReaderReports(params, { request: actorRequest(userId), query: { ...useQ(userId, live), queryKey: scoped(getGetReaderReportsQueryKey(params), userId) } });
  return (
    <View style={{ gap: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
        {REPORT_FILTERS.map((x) => {
          const on = x.key === status;
          return (
            <Pressable key={x.key} testID={'admin-reports-' + x.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { tap(); setStatus(x.key); }}
              style={[st.kind, on && { backgroundColor: P.text, borderColor: P.text }]}>
              <Text style={[st.kindText, on && { color: P.card }]}>{x.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {list.isLoading && !list.data ? <ListSkeleton /> : list.isError && !list.data ? (
        <StateCard icon="wifi-off" title="Şikâyetler yüklenemedi" text={apiError(list.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-reports-retry', onPress: () => list.refetch() }} />
      ) : list.data && list.data.items.length === 0 ? (
        <StateCard icon="flag" title={status === 'pending' ? 'Bekleyen şikâyet yok' : 'Burada kayıt yok'} text="Okurların şikâyet ettiği yorumlar burada incelenir." testID="admin-reports-empty" />
      ) : list.data ? (<>
        <View style={k.card}>
          {list.data.items.map((r) => (
            <View key={r.id} style={st.item} testID={'admin-report-' + r.id}>
              <View style={st.itemHead}>
                <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>{r.author.nickname} yorumu</Text>
                <Chip text={STATUS_LABEL[r.status]} tone={r.status === 'pending' ? 'gold' : r.status === 'hidden' ? 'danger' : 'plain'} />
              </View>
              <Text style={st.body} numberOfLines={5}>"{r.body}"</Text>
              <View style={st.chips}>
                <Chip text={REASON_LABEL[r.reason]} tone="danger" />
                <Chip text={r.paragraphId ? 'Paragraf yorumu' : r.chapterId ? 'Bölüm yorumu' : 'Genel kitap yorumu'} />
                <Text style={st.meta}>{timeAgo(r.createdAt)}</Text>
              </View>
              <Text style={st.rowSub}>Şikâyet eden: {r.reporter.nickname}{r.details ? ' · ' + r.details : ''}</Text>
              <View style={st.actions}>
                <SmallBtn icon="book-open" label="Kitapta aç" testID={'admin-report-open-' + r.id}
                  onPress={() => go(('/authored-book/' + r.bookId + '?focusComment=' + r.commentId + (r.chapterId ? '&chapter=' + r.chapterId : '')) as string)} />
                {r.status === 'pending' ? <>
                  <SmallBtn icon="check" label="Şikâyeti kapat" testID={'admin-report-dismiss-' + r.id} onPress={() => onAct({ type: 'report', report: r, action: 'dismiss' })} />
                  <SmallBtn icon="eye-off" label="Yorumu gizle" danger testID={'admin-report-hide-' + r.id} onPress={() => onAct({ type: 'report', report: r, action: 'hide' })} />
                </> : null}
              </View>
            </View>
          ))}
        </View>
        <View style={st.pager}>
          <PagerBtn icon="chevron-left" label="Önceki sayfa" disabled={cursors.length <= 1 || list.isFetching} onPress={() => setCursors(c => c.slice(0, -1))} testID="admin-reports-prev" />
          <Text style={st.pagerText}>Sayfa {cursors.length}</Text>
          <PagerBtn icon="chevron-right" label="Sonraki sayfa" disabled={!list.data.nextCursor || list.isFetching} onPress={() => { const n = list.data?.nextCursor; if (n) setCursors(c => [...c, n]); }} testID="admin-reports-next" />
        </View>
      </>) : null}
    </View>
  );
}

function History({ userId, live }: { userId: string; live: boolean }) {
  const st = useStStyles();
  const k = useKitStyles();
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
              <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>{h.action === 'account.delete' ? 'Hesap ve içerikleri silindi' : h.action}</Text>
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

function PremiumApplications({ userId, live }: { userId: string; live: boolean }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const params = { offset };
  const list = useGetAdminPremiumApplications(params, { request: actorRequest(userId), query: { ...useQ(userId, live), queryKey: scoped(getGetAdminPremiumApplicationsQueryKey(params), userId) } });
  const decision = useDecideAdminPremiumApplication({ request: actorRequest(userId) });
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const decide = async (id: string, choice: 'paid' | 'free' | 'reject') => {
    if (reason.trim().length < 3 || busyId) { setError('Gerekçe en az 3 karakter olmalı.'); return; }
    setBusyId(id); setError(''); setNotice('');
    try {
      await decision.mutateAsync({ id, data: { decision: choice, reason: reason.trim() } });
      await qc.invalidateQueries({ queryKey: scoped(getGetAdminPremiumApplicationsQueryKey(params), userId) });
      setReason('');
      setNotice(choice === 'paid' ? 'Başvuru ücretli plan için onaylandı.' : choice === 'free' ? 'Başvuru ücretsiz olarak onaylandı.' : 'Başvuru reddedildi.');
    } catch (e) { setError(apiError(e, 'Karar kaydedilemedi. Yeniden dene.')); }
    finally { setBusyId(null); }
  };
  if (list.isLoading && !list.data) return <ListSkeleton />;
  if (list.isError && !list.data) return <StateCard icon="wifi-off" title="Premium başvuruları yüklenemedi" text={apiError(list.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-premium-retry', onPress: () => void list.refetch() }} />;
  if (!list.data) return null;
  if (!list.data.items.length) return <StateCard icon="award" title="Başvuru yok" text="Yeni Premium başvuruları burada görünür." testID="admin-premium-empty" />;
  return <View style={{ gap: 10, paddingHorizontal: 18 }}>
    {error ? <Notice tone="error" text={error} /> : null}
    {notice ? <Notice text={notice} /> : null}
    <TextInput testID="admin-premium-reason" value={reason} onChangeText={setReason} placeholder="Karar gerekçesi (en az 3 karakter)" placeholderTextColor={P.muted} style={[st.searchInput, { borderWidth: 1, borderColor: P.border, borderRadius: 12, paddingHorizontal: 12, backgroundColor: P.card }]} />
    <View style={k.card}>
      {list.data.items.map((app) => <View key={app.id} testID={'admin-premium-' + app.id} style={st.item}>
        <View style={st.itemHead}><Text style={[st.rowTitle, { flex: 1 }]}>{app.nickname}</Text><Chip text={app.status === 'paid_approved' ? 'Kullanıcıdan ödeme bekleniyor' : app.status === 'pending' ? 'Bekliyor' : app.status} tone={app.status === 'pending' ? 'gold' : 'plain'} /></View>
        <Text style={st.rowSub}>{app.email} · Hesap: {app.userId}</Text>
        <Text style={st.rowSub}>Plan: {app.planName} · {app.packageIdentifier}</Text>
        <Text style={st.meta}>Başvuru: {new Date(app.createdAt).toLocaleString('tr-TR')}</Text>
        {app.status === 'pending' ? <View style={st.actions}>
          <SmallBtn icon="credit-card" label={busyId === app.id ? 'Kaydediliyor…' : 'Ücretli onayla'} disabled={!!busyId} testID={'admin-premium-paid-' + app.id} onPress={() => void decide(app.id, 'paid')} />
          <SmallBtn icon="check" label="Ücretsiz onayla" disabled={!!busyId} testID={'admin-premium-free-' + app.id} onPress={() => void decide(app.id, 'free')} />
          <SmallBtn icon="x" label="Reddet" danger disabled={!!busyId} testID={'admin-premium-reject-' + app.id} onPress={() => void decide(app.id, 'reject')} />
        </View> : app.status === 'paid_approved' ? <Text style={st.rowSub}>Onaylandı; satın alma için kullanıcı bekleniyor.</Text> : null}
      </View>)}
    </View>
    <Pager id="admin-premium" offset={offset} total={list.data.total} next={list.data.nextOffset} onChange={setOffset} loading={list.isFetching} />
  </View>;
}

const APPEAL_STATUS = { pending: 'Beklemede', approved: 'Onaylandı', rejected: 'Reddedildi' } as const;

function AccountAppeals({ userId, live }: { userId: string; live: boolean }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const params = { offset };
  const list = useGetAdminAccountAppeals(params, {
    request: actorRequest(userId),
    query: { ...useQ(userId, live), queryKey: scoped(getGetAdminAccountAppealsQueryKey(params), userId) },
  });
  const decide = useDecideAdminAccountAppeal({ request: actorRequest(userId) });
  useEffect(() => {
    if (list.data && offset > 0 && offset >= list.data.total) setOffset(Math.max(0, Math.floor((list.data.total - 1) / PAGE) * PAGE));
  }, [list.data?.total, offset]);

  const submit = async (appeal: AdminAccountAppeal, choice: 'approve' | 'reject') => {
    const reason = (reasons[appeal.id] ?? '').trim();
    if (reason.length < 3 || busyId) { setError('Yönetici gerekçesi en az 3 karakter olmalı.'); return; }
    setBusyId(appeal.id); setError(''); setNotice('');
    try {
      await decide.mutateAsync({ id: appeal.id, data: { decision: choice, reason } });
      await qc.invalidateQueries({ queryKey: scoped(getGetAdminAccountAppealsQueryKey(params), userId) });
      setNotice(choice === 'approve' ? 'Engel kaldırıldı. Kullanıcının oturumu yeniden etkinleştirildi.' : 'Başvuru reddedildi; hesap kısıtlı kaldı.');
    } catch (e) { setError(apiError(e, 'Başvuru kararı kaydedilemedi. Yeniden dene.')); }
    finally { setBusyId(null); }
  };

  if (list.isLoading && !list.data) return <ListSkeleton />;
  if (list.isError && !list.data) return <StateCard icon="wifi-off" title="Engel kaldırma talepleri yüklenemedi" text={apiError(list.error, 'Bağlantı yok, tekrar dene.')} action={{ label: 'Tekrar dene', testID: 'admin-appeals-retry', onPress: () => void list.refetch() }} />;
  if (!list.data) return null;
  if (!list.data.items.length) return <StateCard icon="shield" title="Henüz talep yok" text="RevenueCat ödemesi doğrulanan engel kaldırma talepleri burada görünür." testID="admin-appeals-empty" />;

  return (
    <View style={{ gap: 10, paddingHorizontal: 18 }}>
      {error ? <Notice tone="error" text={error} /> : null}
      {notice ? <Notice text={notice} /> : null}
      <View style={k.card}>
        {list.data.items.map(appeal => {
          const pending = appeal.status === 'pending';
          return (
            <View key={appeal.id} testID={`admin-account-appeal-${appeal.id}`} style={st.item}>
              <View style={[st.itemHead, { alignItems: 'flex-start' }]}>
                {appeal.avatar
                  ? <Image source={{ uri: mediaUrl(appeal.avatar) }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: P.input }} />
                  : <View style={[st.avatarPlaceholder, { backgroundColor: P.input }]}><Feather name="user" size={18} color={P.muted} /></View>}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={st.rowTitle}>{appeal.nickname}</Text>
                  <Text style={st.rowSub}>{appeal.email}</Text>
                  <Text style={st.meta}>Hesap: {appeal.userId}</Text>
                </View>
                <Chip text={APPEAL_STATUS[appeal.status]} tone={appeal.status === 'pending' ? 'gold' : appeal.status === 'rejected' ? 'danger' : 'plain'} />
              </View>
              <Text style={st.meta}>Talep: {new Date(appeal.createdAt).toLocaleString('tr-TR')} · Ödeme: {new Date(appeal.paymentVerifiedAt).toLocaleString('tr-TR')}</Text>
              <Text style={st.meta}>Engel: {new Date(appeal.blockedAt).toLocaleString('tr-TR')}</Text>
              <Text style={st.body}>Gerekçe: {appeal.blockReason}</Text>
              <Text style={st.meta}>Ödeme doğrulandı · {appeal.platform === 'ios' ? 'iOS' : 'Android'} · {appeal.productIdentifier}</Text>
              {appeal.transactionId ? <Text style={st.meta}>İşlem: {appeal.transactionId}</Text> : null}
              {appeal.decisionReason ? <Text style={st.meta}>Yönetici notu: {appeal.decisionReason}</Text> : null}
              {pending ? <>
                <TextInput testID={`admin-appeal-reason-${appeal.id}`} value={reasons[appeal.id] ?? ''}
                  onChangeText={value => setReasons(previous => ({ ...previous, [appeal.id]: value }))}
                  placeholder="Karar gerekçesi (en az 3 karakter)" placeholderTextColor={P.muted}
                  maxLength={300} style={[st.searchInput, { borderWidth: 1, borderColor: P.border, borderRadius: 12, paddingHorizontal: 12, backgroundColor: P.card }]} />
                <View style={st.actions}>
                  <SmallBtn icon="user-check" label="Engeli kaldır" disabled={!!busyId || (reasons[appeal.id] ?? '').trim().length < 3}
                    testID={`admin-appeal-approve-${appeal.id}`} onPress={() => void submit(appeal, 'approve')} />
                  <SmallBtn icon="x" label="Reddet" danger disabled={!!busyId || (reasons[appeal.id] ?? '').trim().length < 3}
                    testID={`admin-appeal-reject-${appeal.id}`} onPress={() => void submit(appeal, 'reject')} />
                </View>
              </> : null}
            </View>
          );
        })}
      </View>
      <Pager id="admin-account-appeals" offset={offset} total={list.data.total} next={list.data.nextOffset}
        onChange={setOffset} loading={list.isFetching} />
    </View>
  );
}

const STORE_STATUS: Record<AdminStoreOrder['status'], string> = {
  pending: 'Beklemede', payment_pending: 'Ödeme bekleniyor',
  approved_free: 'Ücretsiz onaylandı', rejected: 'Reddedildi',
};
const storeMoney = (amount: number) => `₺${Math.floor(amount / 100).toLocaleString('tr-TR')}`;

function StoreOrderCard({ order, live, onDecision }: {
  order: AdminStoreOrder; live: boolean;
  onDecision: (id: string, decision: 'paid' | 'free' | 'reject' | 'pending') => Promise<void>;
}) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'paid' | 'free' | 'reject' | 'pending') => {
    setBusy(true);
    try { await onDecision(order.id, decision); } finally { setBusy(false); }
  };
  return (
    <View testID={'admin-store-order-' + order.id} style={st.item}>
      <View style={st.itemHead}>
        {order.avatar ? <Image source={{ uri: mediaUrl(order.avatar) }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: P.input }} /> :
          <View style={[st.avatarPlaceholder, { backgroundColor: P.input }]}><Feather name="user" size={17} color={P.muted} /></View>}
        <View style={{ flex: 1 }}>
          <Text style={st.rowTitle}>{order.nickname}</Text>
          <Text style={st.rowSub}>Talep: {new Date(order.createdAt).toLocaleString('tr-TR')}</Text>
        </View>
        <Chip text={STORE_STATUS[order.status]} tone={order.status === 'pending' ? 'gold' : order.status === 'rejected' ? 'danger' : 'plain'} />
      </View>
      <View style={{ gap: 8, marginTop: 6 }}>
        {order.items.map((item) => (
          <View key={item.productId} style={st.storeItem}>
            <View style={st.storeThumb}><StoreProductImage imageKey={item.imageKey} /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.rowTitle} numberOfLines={2}>{item.name}</Text>
              <Text style={st.rowSub}>{item.quantity} adet · {item.sizeLabel} · {storeMoney(item.priceKurus)}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={st.itemHead}>
        <Text style={st.rowTitle}>Toplam</Text>
        <Text style={[st.rowTitle, { color: P.gold }]}>{storeMoney(order.totalKurus)}</Text>
      </View>
      {order.decisionNote ? <Text style={st.rowSub}>Yönetici notu: {order.decisionNote}</Text> : null}
      {order.status === 'pending' ? <View style={st.actions}>
        <SmallBtn icon="credit-card" label="Ücretli onayla" disabled={busy || !live} testID={'admin-store-paid-' + order.id} onPress={() => void decide('paid')} />
        <SmallBtn icon="check" label="Ücretsiz onayla" disabled={busy || !live} testID={'admin-store-free-' + order.id} onPress={() => void decide('free')} />
        <SmallBtn icon="x" label="Reddet" danger disabled={busy || !live} testID={'admin-store-reject-' + order.id} onPress={() => void decide('reject')} />
        <SmallBtn icon="clock" label="Beklemede bırak" disabled={busy || !live} testID={'admin-store-pending-' + order.id} onPress={() => void decide('pending')} />
      </View> : order.status === 'payment_pending' ? <Text style={st.rowSub}>Ödeme sağlayıcısı bağlı değil; bu onay ödeme almadı ve tamamlanmış satış değildir.</Text> : null}
    </View>
  );
}

function StoreOrders({ userId, live }: { userId: string; live: boolean }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const params = { offset };
  const list = useGetAdminStoreOrders(params, { request: actorRequest(userId), query: { ...useQ(userId, live), queryKey: scoped(getGetAdminStoreOrdersQueryKey(params), userId) } });
  const settings = useGetAdminStoreSettings({ request: actorRequest(userId), query: { ...useQ(userId, live), queryKey: scoped(getGetAdminStoreSettingsQueryKey(), userId) } });
  const updateSettings = useUpdateAdminStoreSettings({ request: actorRequest(userId) });
  const decideMutation = useDecideAdminStoreOrder({ request: actorRequest(userId) });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const toggle = async () => {
    if (reason.trim().length < 3 || saving || settings.data === undefined) { setError('İşlem gerekçesi en az 3 karakter olmalı.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await updateSettings.mutateAsync({ data: { active: !settings.data.active, reason: reason.trim() } });
      await qc.invalidateQueries({ queryKey: scoped(getGetAdminStoreSettingsQueryKey(), userId) });
      setReason(''); setNotice(settings.data.active ? 'Mağaza talepleri kapatıldı.' : 'Mağaza talepleri açıldı. Ödeme sistemi hâlâ bağlı değil.');
    } catch (e) { setError(apiError(e, 'Mağaza durumu güncellenemedi.')); }
    finally { setSaving(false); }
  };
  const decide = async (id: string, decision: 'paid' | 'free' | 'reject' | 'pending') => {
    if (reason.trim().length < 3) { setError('Karar gerekçesi en az 3 karakter olmalı.'); return; }
    await decideMutation.mutateAsync({ id, data: { decision, reason: reason.trim() } });
    await qc.invalidateQueries({ queryKey: scoped(getGetAdminStoreOrdersQueryKey(params), userId) });
    setReason('');
  };
  if (list.isLoading && !list.data) return <ListSkeleton />;
  if (list.isError && !list.data) return <StateCard icon="wifi-off" title="Mağaza talepleri yüklenemedi" text={apiError(list.error, 'Bağlantıyı kontrol edip yeniden dene.')} action={{ label: 'Tekrar dene', testID: 'admin-store-retry', onPress: () => void list.refetch() }} />;
  return (
    <View style={{ gap: 12, paddingHorizontal: 18 }}>
      <AdminStoreProducts userId={userId} />
      {error ? <Notice tone="error" text={error} /> : null}
      {notice ? <Notice text={notice} /> : null}
      <View style={k.card}>
        <View style={st.item}>
          <View style={st.itemHead}><Feather name="shopping-bag" size={18} color={P.gold} /><Text style={[st.rowTitle, { flex: 1 }]}>Sipariş taleplerini kabul et</Text><Chip text={settings.data?.active ? 'Açık' : 'Kapalı'} tone={settings.data?.active ? 'gold' : 'plain'} /></View>
          <Text style={st.rowSub}>Mağaza kapalıyken ürün inceleme ve talep oluşturma ödeme içermez. Açmak yalnızca talep alınmasını sağlar.</Text>
          <Text style={st.rowSub}>Şu anda gerçek ödeme sağlayıcısı bağlı değil; ücretli onay, ödeme alındığı anlamına gelmez.</Text>
          <TextInput testID="admin-store-reason" value={reason} onChangeText={(value) => { setReason(value); setError(''); }} placeholder="Karar veya mağaza durumu gerekçesi" placeholderTextColor={P.muted} style={[st.searchInput, { borderWidth: 1, borderColor: P.border, borderRadius: 12, paddingHorizontal: 12, backgroundColor: P.card }]} />
          <SmallBtn icon={settings.data?.active ? 'pause-circle' : 'play-circle'} label={saving ? 'Kaydediliyor…' : settings.data?.active ? 'Mağazayı kapat' : 'Mağaza taleplerini aç'} disabled={saving || !settings.data || reason.trim().length < 3} testID="admin-store-toggle" onPress={() => void toggle()} />
        </View>
      </View>
      {list.data?.items.length ? <View style={k.card}>
        {list.data.items.map((order) => <StoreOrderCard key={order.id} order={order} live={live} onDecision={decide} />)}
      </View> : <StateCard icon="shopping-bag" title="Sipariş talebi yok" text="Kullanıcıların gönderdiği ürün talepleri burada listelenir." testID="admin-store-empty" />}
      {list.data ? <Pager id="admin-store-orders" offset={offset} total={list.data.total} next={list.data.nextOffset} onChange={setOffset} loading={list.isFetching} /> : null}
    </View>
  );
}

function ConfirmSheet({ pending, userId, onClose, onDone }: { pending: Pending | null; userId: string; onClose: () => void; onDone: (text: string) => void }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
  const qc = useQueryClient();
  const alive = useOwnerGuard(userId);
  const acc = useUpdateAdminAccount({ request: actorRequest(userId) });
  const del = useDeleteAdminAccount({ request: actorRequest(userId) });
  const deletionId = pending?.type === 'delete' ? pending.account.id : '';
  const deletion = useGetAdminAccountDeletion(deletionId, { request: actorRequest(userId), query: {
    queryKey: scoped(getGetAdminAccountDeletionQueryKey(deletionId), userId),
    enabled: !!deletionId, staleTime: 0, refetchOnMount: 'always',
  } });
  const mod = useUpdateAdminContent({ request: actorRequest(userId) });
  const [reason, setReason] = useState(''); const [nick, setNick] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => { setReason(''); setErr(null); setNick(pending?.type === 'nickname' ? pending.account.nickname : ''); }, [pending]);
  if (!pending) return null;
  const r = reason.trim(); const n = nick.trim();
  const isReport = pending.type === 'report';
  const reasonBad = !isReport && (r.length < 3 || r.length > 300);
  const nickBad = pending.type === 'nickname' && (n.length < 3 || n.length > 15 || n === pending.account.nickname);
  const self = pending.type !== 'content' && pending.type !== 'report' && pending.account.id === userId;
  const deleteBad = pending.type === 'delete' && (!deletion.data || deletion.isError || deletion.isFetching || nick !== deletion.data.nickname);
  const blocked = (pending.type === 'role' && (self || (pending.account.disabled && pending.role !== 'user'))) || ((pending.type === 'disable' || pending.type === 'delete') && self);
  const title = pending.type === 'report' ? (pending.action === 'hide' ? 'Yorumu gizle' : 'Şikâyeti kapat') : pending.type === 'delete' ? 'Hesabı kalıcı sil' : pending.type === 'role' ? 'Rolü değiştir' : pending.type === 'disable' ? (pending.disabled ? 'Hesabı askıya al' : 'Askıyı kaldır') : pending.type === 'nickname' ? 'Takma adı değiştir' : pending.hidden ? 'İçeriği gizle' : 'İçeriği geri getir';
  const desc = pending.type === 'report' ? (pending.action === 'hide'
      ? `${pending.report.author.nickname} kişisinin yorumu ve altındaki konuşma dalı herkesten gizlenecek. Bu bir denetim gizlemesidir: kimsenin yanıtı silinmez, gizleme İçerik sekmesinden geri alınabilir.`
      : 'Şikâyet kapatılacak. Yorum olduğu gibi yayında kalır.')
    : pending.type === 'role' ? `${pending.account.nickname} hesabının rolü "${ROLE_LABEL[pending.account.role]}" yerine "${ROLE_LABEL[pending.role]}" olacak.`
    : pending.type === 'disable' ? (pending.disabled ? `${pending.account.nickname} giriş yapamayacak ve paylaşım yapamayacak. Bu işlem geri alınabilir.` : `${pending.account.nickname} yeniden giriş yapabilecek.`)
    : pending.type === 'nickname' ? `${pending.account.nickname} için yeni takma ad gir (3-15 karakter).`
    : pending.type === 'delete' ? `${pending.account.nickname} hesabı, kitapları, taslakları, yorumları, bültenleri, beğenileri ve özel sohbetleri kalıcı silinecek. Bu içeriklere bağlı yanıtlar da kaldırılabilir. Oturumları kapanacak. Bu işlem geri alınamaz.`
    : `${KIND_ONE[pending.item.kind]} "${pending.item.title || pending.item.body.slice(0, 40)}" ${pending.hidden ? 'herkesten gizlenecek. Silinmez; daha sonra geri getirilebilir.' : 'yeniden görünür olacak.'}`;

  const submit = async () => {
    if (lock.current || reasonBad || nickBad || deleteBad || blocked) return;
    lock.current = true; setBusy(true); setErr(null);
    try {
      if (pending.type === 'report') await resolveReaderReport(pending.report.id, { action: pending.action }, actorRequest(userId));
      else if (pending.type === 'content') await mod.mutateAsync({ kind: pending.item.kind, id: pending.item.id, data: { hidden: pending.hidden, reason: r } });
      else if (pending.type === 'delete') await del.mutateAsync({ id: pending.account.id, data: { confirmation: nick, reason: r } });
      else await acc.mutateAsync({ id: pending.account.id, data: pending.type === 'role' ? { role: pending.role, reason: r } : pending.type === 'disable' ? { disabled: pending.disabled, reason: r } : { nickname: n, reason: r } });
      await qc.invalidateQueries();
      if (alive()) onDone(pending.type === 'report' ? (pending.action === 'hide' ? 'Yorum gizlendi, şikâyet kapatıldı.' : 'Şikâyet kapatıldı.') : pending.type === 'delete' ? 'Hesap ve içerikleri silindi. Görsel dosyaları temizlik sırasına alındı.' : pending.type === 'content' ? (pending.hidden ? 'İçerik gizlendi.' : 'İçerik geri getirildi.') : 'Hesap güncellendi.');
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
              {pending.type === 'delete' ? (
                <>
                  {deletion.isFetching ? <ActivityIndicator color={P.gold} /> : deletion.isError ? (
                    <Notice tone="error" text={apiError(deletion.error, 'Silme kapsamı yüklenemedi.')} />
                  ) : deletion.data ? <Notice tone="error" text={`${deletion.data.books} kitap/taslak · ${deletion.data.bulletins} bülten · ${deletion.data.comments} yorum · ${deletion.data.conversations} özel sohbet · ${deletion.data.media} görsel. Bağlı kayıtlar da silinir. Yeni eklenen içerikler de silmeye dahildir. Görsellere erişim kapanır; dosyalar yükleme bağlantıları sona erdikten sonra temizlenir. Yönetici işlem kaydı korunur. Cihazdaki çevrimdışı kopyalar uzaktan silinemez.`} /> : null}
                  {deletion.isError ? <FoilButton variant="outline" label="Tekrar dene" testID="admin-delete-retry" onPress={() => { void deletion.refetch(); }} /> : null}
                  <Text style={k.label}>Onay için takma adı aynen yaz: {deletion.data?.nickname ?? pending.account.nickname}</Text>
                  <TextInput testID="admin-delete-confirmation" accessibilityLabel="Silinecek hesabın takma adı" value={nick} onChangeText={setNick} autoCapitalize="none" autoCorrect={false} style={k.input} />
                </>
              ) : null}
              {blocked ? <Notice tone="error" text={self ? 'Kendi rolünü değiştiremez veya kendini askıya alamazsın.' : 'Askıdaki hesaplara yetki verilemez.'} /> : null}
              {pending.type === 'nickname' ? (
                <View>
                  <Text style={k.label}>Yeni takma ad</Text>
                  <TextInput testID="admin-confirm-nickname" accessibilityLabel="Yeni takma ad" value={nick} onChangeText={setNick} maxLength={15} autoCorrect={false} style={k.input} />
                </View>
              ) : null}
              {isReport ? null : <View>
                <Text style={k.label}>Gerekçe</Text>
                <TextInput testID="admin-confirm-reason" accessibilityLabel="Gerekçe" value={reason} onChangeText={(v) => { setReason(v); setErr(null); }} multiline maxLength={300}
                  placeholder="Bu işlemi neden yaptığını kısaca yaz" placeholderTextColor={P.muted} style={[k.input, { minHeight: 90, textAlignVertical: 'top' }]} />
                <Text style={reason && reasonBad ? k.err : k.hint}>{r.length}/300 · en az 3 karakter. İşlem geçmişine kaydedilir.</Text>
              </View>}
              {err ? <Notice tone="error" text={err} testID="admin-confirm-error" /> : null}
              <FoilButton label={pending.type === 'delete' ? 'Kalıcı olarak sil' : 'Onayla'} icon={pending.type === 'delete' ? 'trash-2' : 'check'} testID="admin-confirm-submit" busy={busy} disabled={reasonBad || nickBad || deleteBad || blocked} onPress={submit} style={{ flex: 0, minHeight: 48, flexShrink: 0 }} />
              <FoilButton variant="outline" label="Vazgeç" testID="admin-confirm-cancel" disabled={busy} onPress={close} style={{ flex: 0, minHeight: 48, flexShrink: 0 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AdminPanel() {
  const { magazine: P } = useTheme();
  const st = useStStyles();
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
     const tabs: { key: Tab; label: string }[] = [{ key: 'overview', label: 'Genel' }, { key: 'premium', label: 'Premium' }, { key: 'promotions', label: 'Kitap tanıtımı' }, { key: 'store', label: 'Mağaza' }, ...(superadmin ? [{ key: 'accounts' as Tab, label: 'Hesaplar' }, { key: 'appeals' as Tab, label: 'Engel itirazları' }, { key: 'prohibited' as Tab, label: 'Yasaklı Paylaşımlar' }] : []), { key: 'content', label: 'İçerik' }, { key: 'reports', label: 'Şikâyetler' }, { key: 'history', label: 'Geçmiş' }];
     const t = (tab === 'accounts' || tab === 'gifs' || tab === 'appeals' || tab === 'prohibited') && !superadmin ? 'overview' : tab;
    body = (
      <View style={{ gap: 14 }}>
        <View style={st.roleLine}>
          <Chip text={ROLE_LABEL[o.role]} tone="gold" />
          <Pressable testID="admin-refresh" accessibilityRole="button" accessibilityLabel="Yenile" onPress={() => { tap(); setMsg(null); void ov.refetch(); }} hitSlop={8} style={st.refresh}>
            {ov.isFetching ? <ActivityIndicator size="small" color={P.gold} /> : <Feather name="refresh-cw" size={15} color={P.gold} />}
            <Text style={st.refreshText}>Yenile</Text>
          </Pressable>
        </View>
        <PillTabs tabs={tabs} value={t === 'gifs' ? 'overview' : t} onChange={setTab} />
        {msg ? <Notice text={msg} testID="admin-message" /> : null}
        {t === 'overview' ? <View style={{ paddingHorizontal: 18 }}><Overview o={o} onTab={setTab} /></View>
          : t === 'accounts' ? <Accounts userId={userId} live={live} onAct={act} />
          : t === 'gifs' ? <AdminGifLibrary userId={userId} />
          : t === 'premium' ? <PremiumApplications userId={userId} live={live} />
          : t === 'appeals' ? <AccountAppeals userId={userId} live={live} />
          : t === 'promotions' ? <AdminBookPromotions userId={userId} live={live} />
          : t === 'store' ? <StoreOrders userId={userId} live={live} />
          : t === 'prohibited' ? <AdminProhibitedImages userId={userId} />
          : t === 'content' ? <Content userId={userId} live={live} onAct={act} />
          : t === 'reports' ? <Reports userId={userId} live={live} onAct={act} />
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

const useStStyles = makeStyles((t) => {
  const { magazine: P } = t;
  return StyleSheet.create({
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
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  storeItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, backgroundColor: P.input },
  storeThumb: { width: 56, height: 48, borderRadius: 7, overflow: 'hidden' },
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
});

export default withIdentity(AdminPanel);
