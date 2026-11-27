import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import {
  getGetProhibitedImageContactMeQueryKey, useGetProhibitedImageContactMe,
  useSendProhibitedImageContactMessage,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { apiError, timeAgo } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, StateCard, TopBar, useKitStyles } from '@/components/profile/kit';
import { actorRequest, scoped, useFocusedForeground, useOwnerGuard } from '@/components/profile/hooks';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/context/AuthContext';

const AREA: Record<string, string> = {
  profile: 'Profil fotoğrafı',
  bulletin: 'Bülten fotoğrafı',
  book: 'Kitap içeriği veya kapağı',
  private_message: 'Özel mesaj fotoğrafı',
};

export default function ProhibitedImageContact() {
  const { magazine: P } = useTheme();
  const st = useStyles();
  const k = useKitStyles();
  const qc = useQueryClient();
  const { userId, accessMode, retry } = useAuth();
  const alive = useOwnerGuard(userId);
  const live = useFocusedForeground();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const caseKey = scoped(getGetProhibitedImageContactMeQueryKey(), userId);
  const current = useGetProhibitedImageContactMe({
    request: actorRequest(userId),
    query: { queryKey: caseKey, enabled: !!userId, refetchOnMount: 'always', refetchInterval: live ? 30_000 : false },
  });
  const send = useSendProhibitedImageContactMessage({ request: actorRequest(userId) });

  useEffect(() => {
    if (accessMode !== 'contact' || !live) return;
    const timer = setInterval(() => { void retry(); }, 30_000);
    return () => clearInterval(timer);
  }, [accessMode, live, retry]);

  const submit = async () => {
    const text = body.trim();
    if (!text || text.length > 2000 || send.isPending) return;
    setError(''); setNotice('');
    try {
      await send.mutateAsync({ data: { body: text } });
      if (!alive()) return;
      setBody('');
      await qc.invalidateQueries({ queryKey: getGetProhibitedImageContactMeQueryKey() });
      if (alive()) setNotice('Mesajın yönetici incelemesine iletildi.');
    } catch (cause) {
      if (alive()) setError(apiError(cause, 'Mesaj gönderilemedi. Bağlantıyı kontrol edip tekrar dene.'));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: P.background }} testID="prohibited-image-contact-page">
      <MarbleBackground />
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TopBar back title="İletişim" backFallback="/account-restricted" />
        <View style={[k.card, st.card]}>
          <View style={st.head}>
            <View style={st.icon}><Feather name="message-circle" size={19} color={P.gold} /></View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text accessibilityRole="header" style={st.title}>Yöneticiyle iletişim</Text>
              <Text style={st.sub}>Hesabın inceleme tamamlanana kadar yalnızca bu bölümü kullanabilir.</Text>
            </View>
          </View>
          {current.isLoading && !current.data ? <ActivityIndicator color={P.gold} style={{ padding: 20 }} /> :
            current.isError && !current.data
              ? <StateCard icon="wifi-off" title="İnceleme bilgisi yüklenemedi" text={apiError(current.error, 'Bağlantıyı kontrol edip tekrar dene.')} action={{ label: 'Yeniden dene', testID: 'prohibited-contact-retry', onPress: () => void current.refetch() }} />
              : current.data ? (
                <>
                  <View style={[st.caseInfo, { borderColor: P.border, backgroundColor: P.input }]}>
                    <Text style={st.caseTitle}>İnceleme kaydı</Text>
                    <Text style={st.sub}>Alan: {AREA[current.data.area] ?? 'Fotoğraf paylaşımı'}</Text>
                    <Text style={st.sub}>Durum: {current.data.status === 'pending' ? 'Yönetici incelemesi bekleniyor' : 'Kısıtlama yönetici tarafından sürdürülüyor'}</Text>
                    <Text style={st.sub}>Tarih: {timeAgo(current.data.createdAt)}</Text>
                    {current.data.decisionReason ? <Text style={st.body}>Yönetici notu: {current.data.decisionReason}</Text> : null}
                  </View>
                  <Text style={st.section}>Gönderdiğin mesajlar</Text>
                  {current.data.messages.length ? current.data.messages.map(message => (
                    <View key={message.id} style={[st.message, { borderColor: P.border }]}>
                      <Text style={st.sub}>{timeAgo(message.createdAt)}</Text>
                      <Text style={st.body}>{message.body}</Text>
                    </View>
                  )) : <Text style={st.sub}>Henüz mesaj göndermedin.</Text>}
                  {error ? <Notice tone="error" text={error} testID="prohibited-contact-error" /> : null}
                  {notice ? <Notice text={notice} testID="prohibited-contact-notice" /> : null}
                  <View style={{ gap: 7 }}>
                    <Text style={st.label}>Yöneticiye mesaj</Text>
                    <TextInput testID="prohibited-contact-message" accessibilityLabel="Yöneticiye mesaj"
                      value={body} onChangeText={value => { setBody(value); setError(''); }}
                      placeholder="Durumu açıklayan mesajını yaz" placeholderTextColor={P.muted}
                      multiline maxLength={2000} textAlignVertical="top" style={[st.input, { color: P.text, borderColor: P.border }]} />
                    <Text style={st.sub}>{body.length}/2000 · son 24 saatte en fazla 10 mesaj.</Text>
                    <FoilButton icon="send" label={send.isPending ? 'Gönderiliyor…' : 'Mesajı gönder'}
                      testID="prohibited-contact-send" busy={send.isPending} disabled={!body.trim() || body.trim().length > 2000}
                      onPress={() => { tap(); void submit(); }} />
                  </View>
                </>
              ) : <StateCard icon="shield" title="Etkin inceleme bulunamadı" text="Yönetici inceleme kaydını güncellediyse oturumunu kapatıp yeniden giriş yap." testID="prohibited-contact-empty" />}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(t => {
  const { magazine: P } = t;
  return StyleSheet.create({
    content: { paddingBottom: 40 },
    card: { marginHorizontal: 16, marginTop: 10, padding: 16, gap: 14 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: P.input },
    title: { fontFamily: F.serifBold, fontSize: 20, lineHeight: 25, color: P.text },
    sub: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: P.muted },
    body: { fontFamily: F.body, fontSize: 14, lineHeight: 21, color: P.text },
    caseInfo: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 5 },
    caseTitle: { fontFamily: F.semi, fontSize: 14, color: P.text, marginBottom: 2 },
    section: { fontFamily: F.semi, fontSize: 15, color: P.text, marginBottom: -7 },
    message: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 5, backgroundColor: P.card },
    label: { fontFamily: F.semi, fontSize: 13, color: P.text },
    input: { minHeight: 110, maxHeight: 220, borderWidth: 1, borderRadius: 13, padding: 12, fontFamily: F.body, fontSize: 14, lineHeight: 21, backgroundColor: P.card },
  });
});
