import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { F } from '@/components/ui';
import { MarbleBackground, TopBar } from '@/components/profile/kit';
import { FoilButton } from '@/components/profile/kit';
import { go } from '@/components/profile/hooks';
import { useAuth } from '@/context/AuthContext';

const RULES = [
  {
    key: 'A',
    title: 'Uygulama Kullanım Kuralları',
    items: [
      'Kullanıcılar birbirine saygılı davranmalıdır.',
      'Spam, reklam amaçlı kötüye kullanım ve rahatsız edici davranışlar yasaktır.',
      'Başka kullanıcıların kişisel bilgileri izinsiz paylaşılmamalıdır.',
      'Uygulama özellikleri kötüye kullanılmamalıdır.',
    ],
  },
  {
    key: 'B',
    title: 'Kullanıcılara Karşı Davranış Kuralları',
    items: [
      'Hakaret, tehdit, taciz, zorbalık ve hedef gösterme yasaktır.',
      'Ayrımcılık ve nefret söylemine izin verilmez.',
      'Kullanıcıların kişisel sınırlarına ve özel hayatına saygı gösterilmelidir.',
    ],
  },
  {
    key: 'C',
    title: 'Kitaplara ve Yazarlara Karşı Davranış Kuralları',
    items: [
      'Yazarların eserlerine ve emeklerine saygı gösterilmelidir.',
      'Kitap yorumları yapıcı ve saygılı olmalıdır.',
      'Spam, hakaret ve aşağılayıcı yorumlar yasaktır.',
      'Başka yazarlara ait eserler izinsiz kopyalanarak yayımlanmamalıdır.',
    ],
  },
  {
    key: 'D',
    title: 'Telif Hakları Kuralları',
    items: [
      'Başkasına ait eserler izinsiz yayımlanmamalı veya sahiplenilmemelidir.',
      'Telif hakkı ihlalleri bildirim üzerine incelenmelidir.',
      'Kullanıcılar özgün eser üretmeye teşvik edilmelidir.',
    ],
  },
  {
    key: 'E',
    title: 'İçerik ve Paylaşım Kuralları',
    items: [
      'Yasa dışı, zararlı, yanıltıcı veya diğer kullanıcıları tehlikeye atan içerikler paylaşılmamalıdır.',
      'Bülten, mesaj ve yorum alanları kötüye kullanılmamalıdır.',
    ],
  },
  {
    key: 'F',
    title: 'Yönetim ve Yaptırımlar',
    items: [
      'Kural ihlalleri incelenebilir.',
      'Kullanıcıya uyarı verilebilir.',
      'Tekrarlanan veya ağır ihlallerde özellik kısıtlaması, geçici uzaklaştırma veya hesap kapatma uygulanabilir.',
    ],
  },
] as const;

export default function AfilliRules() {
  const { magazine: P } = useTheme();
  const st = useStyles();
  const { accessMode } = useAuth();
  return (
    <View style={{ flex: 1, backgroundColor: P.background }} testID="afilli-rules-page">
      <MarbleBackground />
      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
        <TopBar back title="Afilli Kuralları" />
        {accessMode === 'appeal' ? (
          <FoilButton label="İletişim" icon="message-circle" testID="blocked-rules-contact"
            onPress={() => go('/account-appeal')} style={{ marginHorizontal: 18, marginTop: 6, marginBottom: 8, flex: 0 }} />
        ) : null}
        <Text style={st.intro}>Afilli’de güvenli ve saygılı bir topluluk için aşağıdaki kurallara uy.</Text>
        {RULES.map((section) => (
          <View key={section.key} style={st.card} testID={'afilli-rules-' + section.key.toLowerCase()}>
            <View style={st.heading}>
              <View style={st.badge}><Text style={st.badgeText}>{section.key}</Text></View>
              <Text style={st.title} accessibilityRole="header">{section.title}</Text>
            </View>
            <View style={st.list}>
              {section.items.map((rule, index) => (
                <View key={index} style={st.item}>
                  <View style={st.dot} />
                  <Text style={st.ruleText}>{rule}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const { magazine: P, social: S } = t;
  return StyleSheet.create({
    content: { paddingBottom: 40 },
    intro: { marginHorizontal: 20, marginTop: 6, marginBottom: 16, fontFamily: F.body, fontSize: 14, lineHeight: 21, color: P.muted },
    card: { marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 12 },
    badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: S.foilLight },
    badgeText: { fontFamily: F.semi, fontSize: 14, color: P.text },
    title: { flex: 1, fontFamily: F.serifBold, fontSize: 17, lineHeight: 23, color: P.text },
    list: { gap: 10, paddingLeft: 3 },
    item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: S.foilMid },
    ruleText: { flex: 1, fontFamily: F.body, fontSize: 14, lineHeight: 21, color: P.text },
  });
});
