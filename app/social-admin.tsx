import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMyProfile, getGetMyProfileQueryKey, getGetSocialSettingsQueryKey, useUpdateAdminSettings } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useCommunity } from '@/context/CommunityContext';
import { apiError } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, P, ProfileSkeleton, StateCard, TopBar, k } from '@/components/profile/kit';
import { useSocialSettings } from '@/components/profile/SocialRow';
import { actorRequest, go, scoped, useOwnerGuard, withIdentity } from '@/components/profile/hooks';

function SocialAdmin() {
  const { ready, userId } = useCommunity();
  const qc = useQueryClient();
  const me = useGetMyProfile({ query: { enabled: ready && !!userId, queryKey: scoped(getGetMyProfileQueryKey(), userId) } });
  const settings = useSocialSettings();
  const update = useUpdateAdminSettings({ request: actorRequest(userId) });
  const alive = useOwnerGuard(userId);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (!settings.data || initialized.current) return;
    initialized.current = true;
    setLink(settings.data.instagramUrl ?? '');
  }, [settings.data]);

  const value = link.trim();
  let valid = !value;
  if (value) {
    try {
      const u = new URL(value);
      valid = u.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(u.hostname)
        && !u.username && !u.password && !u.port && !u.search && !u.hash
        && /^\/[a-z0-9_.]{1,30}\/?$/i.test(u.pathname)
        && !/^\/(explore|accounts|direct|p|reel|stories)\/?$/i.test(u.pathname);
    } catch { valid = false; }
  }
  const save = () => {
    if (!valid || !userId) return;
    update.mutate({ data: { instagramUrl: value || null } }, {
      onSuccess: (saved) => {
        if (!alive()) return;
        setLink(saved.instagramUrl ?? '');
        qc.setQueryData(getGetSocialSettingsQueryKey(), saved);
        void qc.invalidateQueries({ queryKey: getGetSocialSettingsQueryKey() });
        setMessage({ tone: 'info', text: saved.instagramUrl ? 'Instagram bağlantısı kaydedildi. Tüm profillerde güncellenecek.' : 'Bağlantı kaldırıldı. Profil simgesi gizlendi.' });
      },
      onError: (e) => { if (alive()) setMessage({ tone: 'error', text: apiError(e, 'Instagram bağlantısı kaydedilemedi.') }); },
    });
  };

  let body: React.ReactNode;
  if (!ready || (!!userId && me.isLoading) || (settings.isLoading && !settings.data)) body = <ProfileSkeleton />;
  else if (!userId || !me.data?.isAdmin || me.data.id !== userId) {
    body = <StateCard testID="admin-forbidden" icon="lock" title="Bu sayfa yöneticilere özel" text="Instagram bağlantısını yalnızca yöneticiler değiştirebilir."
      action={{ label: 'Profile dön', testID: 'admin-back', onPress: () => go('/profile') }} />;
  } else if (!settings.data) {
    body = <StateCard icon="wifi-off" title="Ayarlar yüklenemedi" text="İnternet bağlantısını kontrol et."
      action={{ label: 'Tekrar dene', testID: 'admin-retry', onPress: () => settings.refetch() }} />;
  } else body = (
    <View style={{ paddingHorizontal: 18, gap: 16 }}>
      <View>
        <Text style={k.label}>Instagram Linki</Text>
        <TextInput testID="admin-instagram-link" accessibilityLabel="Instagram Linki" value={link}
          onChangeText={(text) => { setLink(text); setMessage(null); }} autoCapitalize="none" autoCorrect={false}
          keyboardType="url" placeholder="https://www.instagram.com/afilli" placeholderTextColor={P.muted}
          style={[k.input, !valid && { borderColor: P.danger }]} />
        <Text style={!valid ? k.err : k.hint}>{valid ? 'Boş bırakırsan profillerde simge görünmez.' : 'Instagram profilinin https:// bağlantısını yaz.'}</Text>
      </View>
      {message ? <Notice tone={message.tone} text={message.text} testID="admin-message" /> : null}
      <FoilButton label="Kaydet" icon="check" testID="admin-save" busy={update.isPending} disabled={!valid}
        onPress={save} style={{ flex: 0, minHeight: 48 }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" bottomOffset={60}>
        <TopBar back title="Instagram Linki" />
        {body}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

export default withIdentity(SocialAdmin);
