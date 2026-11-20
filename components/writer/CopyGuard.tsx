import React, { useEffect, useId, useRef } from 'react';
import { Platform, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

export function CopyProtectionHint() {
  const t = useTheme();
  return <Text testID="copy-protection-note" style={{ color: t.magazine.muted, fontSize: 11, lineHeight: 16, padding: 6 }}>
    Kopyalama/kesme desteklenen yüzeylerde engellenir; bazı cihazların sistem menüleri görünebilir. Klavyeden yapıştırma kullanılabilir. Ekran görüntüsü ve OCR engellenemez.
  </Text>;
}

/** UI-level restriction, not DRM: DOM inspection, screenshots and OCR remain possible. */
export function CopyGuard({ children }: { children: React.ReactNode }) {
  const ref = useRef<React.ElementRef<typeof View>>(null);
  const id = 'afilli-copy-' + useId();
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const candidate = ref.current as unknown as HTMLElement | null;
    const node = candidate?.addEventListener ? candidate : document.getElementById(id);
    if (!node?.addEventListener) return;
    node.setAttribute('data-afilli-copy-guard', '');
    // RN Web can discard unsupported View styles or give nested Text user-select:auto.
    // Apply a scoped DOM rule to the actual text descendants, not just their wrapper.
    const style = document.createElement('style');
    style.textContent = '[data-afilli-copy-guard],[data-afilli-copy-guard] *{user-select:none!important;-webkit-user-select:none!important;-webkit-touch-callout:none!important}';
    document.head.appendChild(style);
    const stop = (event: Event) => event.preventDefault();
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ['c', 'x'].includes(event.key.toLowerCase())) event.preventDefault();
    };
    const names = ['copy', 'cut', 'contextmenu', 'dragstart'];
    for (const name of names) node.addEventListener(name, stop, true);
    node.addEventListener('keydown', keys, true);
    return () => {
      style.remove();
      node.removeAttribute('data-afilli-copy-guard');
      for (const name of names) node.removeEventListener(name, stop, true);
      node.removeEventListener('keydown', keys, true);
    };
  }, [id]);
  return <View ref={ref} nativeID={id} testID="reader-copy-guard">{children}</View>;
}
