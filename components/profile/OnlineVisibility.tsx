import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateMyVisibility, getGetMyProfileQueryKey, type ReaderProfile } from '@workspace/api-client-react';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { useCommunity } from '@/context/CommunityContext';
import { F, tap } from '@/components/ui';
import { apiError } from '@/components/bulletins/common';
import { Notice, useKitStyles } from './kit';
import { scoped, useOwnerGuard } from './hooks';

/** Admin-only "show me online" preference. Separate from the automatic foreground presence heartbeat. */
export function OnlineVisibility({ profile }: { profile: ReaderProfile }) {
  const { magazine: P } = useTheme();
  const st = useStyles();
  const k = useKitStyles();
  const qc = useQueryClient();
  const { userId, refreshProfile } = useCommunity();
  const alive = useOwnerGuard(userId);
  const mutation = useUpdateMyVisibility({ mutation: { retry: false }, request: { headers: { 'X-Afilli-Actor': userId ?? '' } } });
  const [err, setErr] = useState<string | null>(null);
  if (!profile.isAdmin || profile.id !== userId) return null;
  const loading = profile.onlineVisible === undefined || profile.onlineVisible === null;
  const on = profile.onlineVisible === true;
  const busy = mutation.isPending;
  const toggle = () => {
    if (loading || busy || !userId) return;
    const owner = userId, key = scoped(getGetMyProfileQueryKey(), owner);
    setErr(null);
    mutation.mutate({ data: { visible: !on } }, {
      onSuccess: (next) => {
        if (!alive() || next.id !== owner) return;
        qc.setQueryData<ReaderProfile>(key, (old) => old && old.id === owner ? { ...old, ...next } : old);
        void qc.invalidateQueries({ queryKey: key });
        refreshProfile().catch(() => {});
      },
      onError: (e) => { if (alive()) setErr(apiError(e, 'Görünürlük ayarı kaydedilemedi. Tekrar dene.')); },
    });
  };
  const label = 'Çevrimiçi görün: ' + (loading ? 'yükleniyor' : on ? 'Açık' : 'Kapalı');
  return (
    <View style={{ marginTop: 10 }}>
      <View style={k.card}>
        <Pressable testID="profile-online-visibility" accessibilityRole="switch" accessibilityLabel={label}
          accessibilityHint="Yalnızca yönetici hesapları için. Diğer okurların seni çevrimiçi görüp görmeyeceğini belirler."
          accessibilityState={{ checked: on, disabled: loading || busy, busy }} aria-checked={on}
          disabled={loading || busy} onPress={() => { tap(); toggle(); }}
          style={({ pressed }) => [st.row, { opacity: loading || busy ? 0.6 : 1, backgroundColor: pressed ? P.input : 'transparent' }]}>
          <Feather name={on ? 'eye' : 'eye-off'} size={18} color={P.gold} />
          <View style={{ flex: 1 }}>
            <Text style={st.label}>Çevrimiçi görün</Text>
            <Text style={st.sub}>{loading ? 'Tercih yükleniyor...' : busy ? 'Kaydediliyor...' : on ? 'Okurlar seni çevrimiçi görebilir.' : 'Uygulamadayken bile çevrimdışı görünürsün.'}</Text>
          </View>
          <View style={[st.sw, on && { backgroundColor: P.gold }]}><View style={[st.knob, on && { alignSelf: 'flex-end' }]} /></View>
        </Pressable>
      </View>
      {err ? <Notice tone="error" text={err} action={{ label: 'Tekrar dene', onPress: toggle }} testID="profile-online-visibility-error" /> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const { magazine: P } = t;
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 16, paddingVertical: 8 },
    label: { fontFamily: F.semi, fontSize: 15, color: P.text },
    sub: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: P.muted, marginTop: 2 },
    sw: { width: 44, height: 26, borderRadius: 13, backgroundColor: P.input, padding: 3, justifyContent: 'center' },
    knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: P.card },
  });
});
