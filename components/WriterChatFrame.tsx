import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView as NativeWebView } from 'react-native-webview';
import { WRITER_CHAT_HTML } from '@/lib/writer-chat';
import { useColors } from '@/hooks/useColors';
import { StateCard } from '@/components/profile/kit';

const source = { html: WRITER_CHAT_HTML, baseUrl: 'https://minnit.chat/' };
// Match the package's runtime API; its RN class props resolve to never in this workspace.
const WebView = NativeWebView as unknown as React.ComponentType<{
  source: { html: string; baseUrl: string };
  style: { flex: number; backgroundColor: string };
  javaScriptEnabled: boolean; domStorageEnabled: boolean; startInLoadingState: boolean;
  allowFileAccess: boolean; mixedContentMode: 'never'; setSupportMultipleWindows: boolean;
  originWhitelist: string[]; onError: () => void;
  onHttpError: (event: { nativeEvent: { statusCode: number; url: string } }) => void;
  renderLoading: () => React.ReactElement;
}>;

export function WriterChatFrame() {
  const c = useColors();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) return <View style={{ flex: 1, backgroundColor: c.background }}>
    <StateCard icon="wifi-off" title="Yazar sohbeti açılamadı"
      text="İnternet bağlantını kontrol et. Sohbet Minnit tarafından sağlanıyor."
      action={{ label: 'Tekrar dene', testID: 'writer-chat-retry', onPress: () => { setFailed(false); setAttempt(n => n + 1); } }} />
  </View>;
  return <WebView key={attempt} source={source} style={{ flex: 1, backgroundColor: c.background }}
    javaScriptEnabled domStorageEnabled startInLoadingState allowFileAccess={false}
    mixedContentMode="never" setSupportMultipleWindows={false} originWhitelist={['https://*', 'about:blank']}
    onError={() => setFailed(true)}
    onHttpError={e => { if (e.nativeEvent.statusCode >= 500 && e.nativeEvent.url.includes('organizations.minnit.chat/')) setFailed(true); }}
    renderLoading={() => <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: c.background }]}>
      <ActivityIndicator accessibilityLabel="Yazar sohbeti yükleniyor" color={c.brown} />
    </View>} />;
}
