import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useDeleteMyAccount, useGetMyAccountDeletion, getGetMyAccountDeletionQueryKey } from '@workspace/api-client-react';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/context/AuthContext';
import { useCommunity } from '@/context/CommunityContext';
import { F } from '@/components/ui';
import { apiError, useSStyles } from '@/components/bulletins/common';
import { Field, PasswordField } from '@/components/bulletins/Auth';
import { FoilButton, Notice, Skeleton } from './kit';
import { scoped, useOwnerGuard } from './hooks';

function deleteMsg(e: unknown): string {
  const d = (e as { data?: { error?: unknown; message?: unknown } } | null)?.data;
  // Preserve server text verbatim (wrong password, nickname mismatch, last superadmin, etc.).
  if (d && typeof d.error === 'string') return d.error;
  if (d && typeof d.message === 'string') return d.message;
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) return 'Oturumun doğrulanamadı. Hesap durumunu kontrol etmek için yeniden giriş yap.';
  if (status === 403) return 'Şifre doğrulanamadı. Silme işlemi yapılmadı.';
  return 'Silme isteğinin sonucu doğrulanamadı. Hesabın silinmiş olabilir. Yeniden silmeyi denemeden önce oturumunu kontrol et.';
}

/** Self-service permanent account deletion, with reauthentication and exact nickname confirmation. */
export function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { magazine: P } = useTheme();
  const s = useSStyles();
  const st = useStyles();
  const { ready, userId } = useCommunity();
  const { finalizeDeletion, beginDeletion, abortDeletion, retry } = useAuth();
  const alive = useOwnerGuard(userId);
  const counts = useGetMyAccountDeletion({
    query: { enabled: ready && !!userId && visible, queryKey: scoped(getGetMyAccountDeletionQueryKey(), userId), retry: 1 },
    request: { headers: { 'X-Afilli-Actor': userId ?? '' } },
  });
  const del = useDeleteMyAccount({ mutation: { retry: false }, request: { headers: { 'X-Afilli-Actor': userId ?? '' } } });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const lock = useRef(false);
  const [working, setWorking] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const busy = del.isPending || working;
  const nickname = counts.data?.nickname ?? '';
  const matches = !!nickname && confirmation === nickname;
  const canSubmit = matches && password.length > 0 && !busy && !uncertain && !counts.error && !!userId;

  const close = () => { if (busy) return; setPassword(''); setConfirmation(''); setErr(null); setUncertain(false); onClose(); };
  const submit = async () => {
    if (!canSubmit || lock.current || !userId) return;
    const owner = userId;
    lock.current = true; setWorking(true); setErr(null);
    let deleted = false;
    let prepared = false;
    let requestId = '';
    try {
      requestId = await beginDeletion(owner);
      prepared = true;
      if (!alive()) { await abortDeletion(owner, requestId); lock.current = false; return; }
      await del.mutateAsync({ data: { password, confirmation, requestId } });
      deleted = true;
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      const rejected = typeof status === 'number' && status >= 400 && status < 500;
      if (prepared) await abortDeletion(owner, requestId, rejected);
      if (alive()) {
        setUncertain(prepared && !rejected);
        setErr(prepared ? deleteMsg(e) : e instanceof Error ? e.message : 'Silme isteği gönderilmedi.');
      }
    }
    if (deleted) {
      const showSignIn = alive();
      // Server deletion succeeded; only local cleanup remains. Never call logout here.
      // Cleanup is provider-owned even if this sheet unmounted. Its live owner
      // check ensures it cannot clear a different, newer account.
      await finalizeDeletion(owner, requestId).catch(() => false);
      lock.current = false;
      if (showSignIn) router.replace('/sign-in');
      return;
    }
    lock.current = false;
    if (alive()) { setWorking(false); setPassword(''); }
  };

  const items = counts.data ? [
    ['Kitap', counts.data.books], ['Pano gönderisi', counts.data.bulletins], ['Yorum', counts.data.comments],
    ['Sohbet', counts.data.conversations], ['Görsel / dosya', counts.data.media],
  ] as const : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={close} accessibilityLabel="Kapat">
          <Pressable style={[s.sheet, { maxHeight: '92%' }]} onPress={() => {}} testID="settings-delete-account-sheet">
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle} accessibilityRole="header">Hesabı kalıcı olarak sil</Text>
              <Pressable onPress={close} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kapat"><Feather name="x" size={22} color={P.text} /></Pressable>
            </View>
            <KeyboardAwareScrollViewCompat bottomOffset={60} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
              <View style={st.warn} accessibilityRole="alert">
                <Feather name="alert-triangle" size={18} color={P.danger} />
                <Text style={st.warnText}>Bu işlem geri alınamaz. Hesabın, kitapların ve taslakların, gönderilerin, yorumların, sohbetlerin ve yüklediğin görseller sunucudan kalıcı olarak silinir.</Text>
              </View>
              {counts.isLoading ? (
                <View style={{ gap: 8 }}><Skeleton w="100%" h={18} /><Skeleton w="70%" h={18} /><Skeleton w="85%" h={18} /></View>
              ) : counts.error || !items ? (
                <Notice tone="error" text={apiError(counts.error, 'Silinecek içerik sayıları alınamadı.')} action={{ label: 'Tekrar dene', onPress: () => { void counts.refetch(); } }} testID="delete-account-counts-error" />
              ) : (
                <View style={st.counts} testID="delete-account-counts">
                  {items.map(([label, n]) => (
                    <View key={label} style={st.countRow}><Text style={st.countLabel}>{label}</Text><Text style={st.countValue}>{n}</Text></View>
                  ))}
                </View>
              )}
              <PasswordField label="Şifren" value={password} onChangeText={setPassword} autoComplete="current-password"
                maxLength={1024} editable={!busy} testID="delete-account-password" accessibilityLabel="Şifren, kimliğini doğrulamak için" />
              <Field label={nickname ? 'Onaylamak için takma adını aynen yaz: ' + nickname : 'Takma adını aynen yaz'} value={confirmation}
                onChangeText={setConfirmation} autoCapitalize="none" autoCorrect={false} maxLength={40} editable={!busy && !!nickname}
                testID="delete-account-confirmation" accessibilityLabel={'Onay için takma adın' + (nickname ? ': ' + nickname : '')}
                error={confirmation.length > 0 && !matches ? 'Takma ad eşleşmiyor' : null} />
              {err ? <Notice tone="error" text={err} testID="delete-account-error"
                action={uncertain ? { label: 'Oturumu kontrol et', onPress: () => { void retry(); } } : undefined} /> : null}
              <View style={{ gap: 10, marginTop: 4 }}>
                <Pressable testID="delete-account-submit" accessibilityRole="button" accessibilityLabel="Hesabımı kalıcı olarak sil"
                  accessibilityState={{ disabled: !canSubmit, busy }} disabled={!canSubmit} onPress={() => { void submit(); }}
                  style={({ pressed }) => [st.danger, { opacity: !canSubmit ? 0.45 : pressed ? 0.8 : 1 }]}>
                  <Feather name="trash-2" size={16} color={P.card} />
                  <Text style={st.dangerText}>{busy ? 'Siliniyor...' : 'Hesabımı kalıcı olarak sil'}</Text>
                </Pressable>
                <FoilButton variant="outline" label="Vazgeç" testID="delete-account-cancel" disabled={busy} onPress={close} style={{ flex: 0 }} />
              </View>
            </KeyboardAwareScrollViewCompat>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Shown on sign-in if the deleted account's device record could not yet be removed. */
export function DeletionCleanupNotice() {
  const { forgetError, retryForget } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!forgetError) return null;
  return <View style={{ gap: 8 }}>
    <Notice tone="error" text={forgetError} testID="delete-account-cleanup-error" />
    <FoilButton testID="delete-account-cleanup-retry" variant="outline" style={{ flex: 0 }} disabled={busy}
      label={busy ? 'Temizleniyor...' : 'Temizlemeyi yeniden dene'} onPress={() => {
        if (busy) return;
        setBusy(true); void retryForget().finally(() => setBusy(false));
      }} />
  </View>;
}

const useStyles = makeStyles((t) => {
  const { magazine: P } = t;
  return StyleSheet.create({
    warn: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: P.danger, backgroundColor: P.input },
    warnText: { flex: 1, fontFamily: F.body, fontSize: 13.5, lineHeight: 20, color: P.text },
    counts: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: P.border, paddingHorizontal: 12 },
    countRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.border },
    countLabel: { fontFamily: F.body, fontSize: 14, color: P.muted },
    countValue: { fontFamily: F.semi, fontSize: 14, color: P.text },
    danger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 23, backgroundColor: P.danger },
    dangerText: { fontFamily: F.semi, fontSize: 14.5, color: P.card },
  });
});
