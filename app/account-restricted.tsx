import React from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { F } from '@/components/ui';
import { FoilButton, MarbleBackground, TopBar } from '@/components/profile/kit';
import { useAuth } from '@/context/AuthContext';

export default function AccountRestricted() {
  const { magazine: P } = useTheme();
  const auth = useAuth();
  const contentOnly = auth.accessMode === 'contact';
  return (
    <View style={[s.page, { backgroundColor: P.background }]} testID="account-restricted-screen">
      <MarbleBackground />
      <TopBar title="Erişim kısıtlandı" />
      <View style={s.content}>
        <View style={[s.mark, { borderColor: P.gold, backgroundColor: P.card }]}>
          <Feather name="shield" size={30} color={P.gold} />
        </View>
        <Text style={[s.title, { color: P.text }]}>{contentOnly ? 'Fotoğraf paylaşımı nedeniyle erişim kısıtlandı' : 'Hesabın yönetici tarafından kısıtlandı'}</Text>
        <Text style={[s.copy, { color: P.muted }]}>
          {contentOnly
            ? 'Bir fotoğraf yasaklı görsel denetiminde eşleşti. Yükleme engellendi ve hesabın yönetici incelemesine kadar yalnızca İletişim bölümüne açık.'
            : 'Bu oturumda yalnızca Afilli Kuralları, bildirimler ve ücretli engel kaldırma başvurusu kullanılabilir.'}
        </Text>
        <FoilButton label={contentOnly ? 'İletişim' : 'Afilli Kuralları ve İletişim'} icon={contentOnly ? 'message-circle' : 'book-open'} testID="restricted-rules"
          onPress={() => router.push(contentOnly ? '/prohibited-image-contact' : '/afilli-rules')} style={{ flex: 0 }} />
        <FoilButton variant="outline" label="Çıkış yap" icon="log-out" testID="restricted-signout" onPress={() => {
          void auth.signOut().then(() => router.replace('/sign-in')).catch(() => {});
        }} style={{ flex: 0 }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 14 },
  mark: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: F.serifBold, fontSize: 24, lineHeight: 31, textAlign: 'center', maxWidth: 340 },
  copy: { fontFamily: F.body, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 360, marginBottom: 6 },
});
