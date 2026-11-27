import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { F, tap } from '@/components/ui';
import { Btn } from '@/components/bulletins/common';
import { useWriterPalette, writerPalette } from '@/components/writer/parts';
import { cropProfileImage, type PickedImage, type ProfilePurpose } from '@/lib/profile-media';
import { profileCropRect, type ProfileCropSpec } from '@/lib/profile-crop';

const initialCrop: ProfileCropSpec = { rotation: 0, zoom: 1, dx: 0, dy: 0 };
const webTouchActionStyle = Platform.OS === 'web'
  ? ({ touchAction: 'none' } as unknown as ViewStyle)
  : undefined;

export function ProfileCropSheet({ source, purpose, onCancel, onDone }: {
  source: PickedImage | null;
  purpose: ProfilePurpose;
  onCancel: () => void;
  onDone: (image: PickedImage) => void;
}) {
  const st = useStyles();
  const W = useWriterPalette();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [spec, setSpec] = useState<ProfileCropSpec>(initialCrop);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameWidth = Math.max(180, Math.min(purpose === 'avatar' ? 260 : 330, screenWidth - 72));
  const frameHeight = purpose === 'avatar' ? frameWidth : Math.round(frameWidth / 3);
  const crop = source ? profileCropRect(source.width, source.height, purpose, spec) : null;
  const scale = crop ? frameWidth / crop.width : 1;
  const imageCenterX = crop ? frameWidth / 2 + (crop.rotatedWidth / 2 - crop.x - crop.width / 2) * scale : 0;
  const imageCenterY = crop ? frameHeight / 2 + (crop.rotatedHeight / 2 - crop.y - crop.height / 2) * scale : 0;
  const gestureSize = useRef({ width: frameWidth, height: frameHeight });
  gestureSize.current = { width: frameWidth, height: frameHeight };
  const currentSpec = useRef(spec);
  currentSpec.current = spec;
  const startSpec = useRef(spec);

  useEffect(() => {
    setSpec(initialCrop);
    setError(null);
  }, [source?.uri, purpose]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
    onPanResponderGrant: () => { startSpec.current = currentSpec.current; },
    onPanResponderMove: (_, gesture) => {
      const clamp = (n: number) => Math.max(-1, Math.min(1, n));
      setSpec({
        ...startSpec.current,
        dx: clamp(startSpec.current.dx - gesture.dx / Math.max(100, gestureSize.current.width * 0.75)),
        dy: clamp(startSpec.current.dy - gesture.dy / Math.max(80, gestureSize.current.height * 0.75)),
      });
    },
  }), []);

  const change = (patch: Partial<ProfileCropSpec>) => {
    tap();
    setSpec((current) => ({ ...current, ...patch }));
  };
  const rotate = (amount: 90 | -90) => {
    change({ rotation: (((spec.rotation + amount) % 360 + 360) % 360) as ProfileCropSpec['rotation'], dx: 0, dy: 0 });
  };
  const apply = async () => {
    if (!source || busy) return;
    setBusy(true); setError(null);
    try { onDone(await cropProfileImage(source, purpose, spec)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Fotoğraf kırpılamadı.'); }
    finally { setBusy(false); }
  };
  const top = Platform.OS === 'web' ? 67 : insets.top;
  const bottom = Platform.OS === 'web' ? 34 : insets.bottom;
  if (!source) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[st.backdrop, { paddingTop: top + 10, paddingBottom: bottom + 10 }]}>
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <View style={st.card} testID="profile-crop">
            <View style={st.grip} />
            <Text style={st.title} accessibilityRole="header">{purpose === 'avatar' ? 'Profil fotoğrafını kırp' : 'Kapak fotoğrafını kırp'}</Text>
            <Text style={st.hint}>Fotoğrafı parmağınla sürükleyerek konumlandır; yakınlaştırma düğmeleriyle çerçeveyi ayarla.</Text>
            <View {...pan.panHandlers} testID="profile-crop-frame" accessibilityLabel="Kırpma alanı, sürükleyerek konumlandır"
              style={[st.frame, webTouchActionStyle, { width: frameWidth, height: frameHeight, borderRadius: purpose === 'avatar' ? frameWidth / 2 : 14 }]}>
              <Image source={{ uri: source.uri }} resizeMode="stretch"
                style={{ position: 'absolute', width: source.width * scale, height: source.height * scale,
                  left: imageCenterX - source.width * scale / 2, top: imageCenterY - source.height * scale / 2,
                  transform: [{ rotate: spec.rotation + 'deg' }] }} />
              <View pointerEvents="none" style={st.thirdsVertical} />
              <View pointerEvents="none" style={st.thirdsHorizontal} />
            </View>
            <View style={st.tools}>
              <Tool icon="rotate-ccw" label="Sola döndür" onPress={() => rotate(-90)} disabled={busy} />
              <Tool icon="rotate-cw" label="Sağa döndür" onPress={() => rotate(90)} disabled={busy} />
              <Tool icon="minus" label="Uzaklaştır" onPress={() => change({ zoom: Math.max(1, spec.zoom - 0.2) })} disabled={busy || spec.zoom <= 1} />
              <Tool icon="plus" label="Yakınlaştır" onPress={() => change({ zoom: Math.min(3, spec.zoom + 0.2) })} disabled={busy || spec.zoom >= 3} />
              <Tool icon="refresh-ccw" label="Konumu sıfırla" onPress={() => change({ zoom: 1, dx: 0, dy: 0 })} disabled={busy} />
            </View>
            <Text style={st.meta}>{purpose === 'avatar' ? 'Kare profil fotoğrafı' : '3:1 profil kapağı'} · {crop?.width ?? 0} × {crop?.height ?? 0} px</Text>
            {error ? <Text style={st.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            <View style={st.actions}>
              <Btn label="Vazgeç" ghost testID="profile-crop-cancel" disabled={busy} onPress={onCancel} style={{ flex: 1 }} />
              <Btn label="Önizlemeyi kullan" icon="check" testID="profile-crop-apply" busy={busy} onPress={() => void apply()} style={{ flex: 1 }} />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Tool({ icon, label, onPress, disabled }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; disabled: boolean }) {
  const st = useStyles();
  const { magazine: P } = useTheme();
  return (
    <View style={st.toolWrap}>
      <Text style={st.toolLabel}>{label}</Text>
      <Pressable testID={'profile-crop-tool-' + icon} accessibilityRole="button" accessibilityLabel={label}
        disabled={disabled} onPress={onPress} style={({ pressed }) => [st.tool, { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
        <Feather name={icon} size={18} color={P.text} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.62)', justifyContent: 'center' },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8 },
    card: { width: '100%', maxWidth: 430, alignSelf: 'center', alignItems: 'center', gap: 12, padding: 18, borderRadius: 24, borderWidth: 1, borderColor: W.line, backgroundColor: W.paper },
    grip: { width: 42, height: 4, borderRadius: 2, backgroundColor: W.line, marginBottom: 2 },
    title: { fontFamily: F.serifBold, fontSize: 21, color: W.ink, textAlign: 'center' },
    hint: { maxWidth: 330, fontFamily: F.body, fontSize: 13, lineHeight: 19, color: W.muted, textAlign: 'center' },
    frame: { overflow: 'hidden', backgroundColor: W.deep, borderWidth: 2, borderColor: W.gold, alignSelf: 'center' },
    thirdsVertical: { position: 'absolute', left: '33.333%', right: '33.333%', top: 0, bottom: 0, borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,248,236,0.42)' },
    thirdsHorizontal: { position: 'absolute', top: '33.333%', bottom: '33.333%', left: 0, right: 0, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,248,236,0.42)' },
    tools: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, width: '100%' },
    toolWrap: { alignItems: 'center', gap: 2 },
    toolLabel: { fontFamily: F.body, fontSize: 10, color: W.muted, textAlign: 'center' },
    tool: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
    meta: { fontFamily: F.body, fontSize: 11, color: W.muted, textAlign: 'center' },
    error: { fontFamily: F.med, fontSize: 13, lineHeight: 18, color: W.danger, textAlign: 'center' },
    actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 2 },
  });
});
