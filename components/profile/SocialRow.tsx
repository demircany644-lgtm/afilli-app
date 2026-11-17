import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useGetSocialSettings, getGetSocialSettingsQueryKey } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { P, S } from './kit';

/** One shared setting for every profile; refresh when the app comes back and periodically. */
export function useSocialSettings() {
  return useGetSocialSettings({ query: {
    queryKey: getGetSocialSettingsQueryKey(), staleTime: 0,
    refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: 30_000, retry: 1,
  } });
}

export function OfficialInstagramIcon() {
  const { data } = useSocialSettings();
  const [error, setError] = useState(false);
  const url = data?.instagramUrl;
  // A stale or legacy handle must not become a visible "official" link.
  if (!url || !/^https:\/\/www\.instagram\.com\/[a-z0-9_.]{1,30}\/$/.test(url)) return null;
  return (
    <View style={st.container}>
      <Pressable testID="profile-social-instagram" accessibilityRole="link" accessibilityLabel="Afilli Instagram hesabını aç"
        onPress={() => { tap(); setError(false); Linking.openURL(url).catch(() => setError(true)); }}
        hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        <LinearGradient colors={[S.igOrange, S.igPink, S.igPurple]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={st.icon}>
          <MaterialCommunityIcons name="instagram" size={20} color={S.onBrand} />
        </LinearGradient>
      </Pressable>
      {error ? <Text testID="profile-social-error" accessibilityLiveRegion="polite" style={st.error}>Instagram açılamadı. Tekrar dene.</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  container: { alignItems: 'center', marginTop: 6 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  error: { fontFamily: F.med, fontSize: 12, color: P.danger, textAlign: 'center', marginTop: 6 },
});
