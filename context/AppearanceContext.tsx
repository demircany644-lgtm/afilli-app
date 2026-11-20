import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { APPEARANCE_KEY, COLOR_THEMES, type ColorThemeId, DEFAULT_PREFS, MAX_VOLUME, clampVolume, createLatestWriter, parsePrefs, serializePrefs, type AppearancePrefs, type ThemeId } from '@/lib/appearancePrefs';

// Device-level appearance only. Never mixed into AppContext (account-bound data).
export { MAX_VOLUME };
export type { ThemeId };
export { COLOR_THEMES };
export const THEME_NAMES: Record<ThemeId, string> = {
  classic: 'Klasik Krem', lava: 'Alev / Lav - 3D Canlı',
  ...(Object.fromEntries(COLOR_THEMES.map((t) => [t.id, t.label])) as Record<ColorThemeId, string>),
};

export type SoundState = 'off' | 'loading' | 'playing' | 'blocked' | 'error';

type Ctx = AppearancePrefs & {
  isLava: boolean;
  ready: boolean;              // stored prefs hydrated (or read failed)
  loadError: string | null;
  saveError: string | null;
  retrySave: () => void;
  setTheme: (t: ThemeId) => void;
  setSound: (on: boolean) => void;
  setVolume: (v: number) => void;
  active: boolean;             // app foregrounded / tab visible
  reduceMotion: boolean;
  lowPower: boolean | null;    // null = cannot detect on this device/build
  soundState: SoundState;
  soundError: string | null;
  retrySound: () => void;
};
const AppearanceContext = createContext<Ctx | null>(null);

// Optional native module: a stale dev binary without expo-battery must not crash.
type BatteryMod = typeof import('expo-battery');
function loadBattery(): BatteryMod | null {
  if (Platform.OS === 'web') return null;
  try { return require('expo-battery') as BatteryMod; } catch { return null; }
}

const CRACKLE = require('@/assets/sounds/flame-crackle.wav');

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<AppearancePrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const touched = useRef(false);     // user changed something before hydration finished
  const latest = useRef(prefs);
  latest.current = prefs;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const writer = useRef(createLatestWriter<AppearancePrefs>(
    (p) => AsyncStorage.setItem(APPEARANCE_KEY, serializePrefs(p)),
    (e) => { if (mounted.current) setSaveError(e ? 'Görünüm ayarı kaydedilemedi.' : null); },
  )).current;

  useEffect(() => {
    AsyncStorage.getItem(APPEARANCE_KEY).then((raw) => {
      if (!mounted.current) return;
      if (!touched.current) setPrefs(parsePrefs(raw));
    }).catch(() => {
      // Keep defaults in memory; nothing is written back so stored values are not overwritten.
      if (mounted.current) setLoadError('Kayıtlı görünüm ayarı okunamadı.');
    }).finally(() => { if (mounted.current) setReady(true); });
  }, []);

  const update = useCallback((patch: Partial<AppearancePrefs>) => {
    touched.current = true;
    const next = { ...latest.current, ...patch, volume: clampVolume(patch.volume ?? latest.current.volume) };
    latest.current = next;
    setPrefs(next);           // pure state update; IO happens outside the updater
    void writer.save(next);
  }, [writer]);
  const retrySave = useCallback(() => { void writer.save(latest.current); }, [writer]);

  const [active, setActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    let onVis: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      onVis = () => setActive(document.visibilityState !== 'hidden');
      document.addEventListener('visibilitychange', onVis);
    }
    return () => { sub.remove(); if (onVis) document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const [reduceMotion, setReduce] = useState(false);
  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (on) setReduce(v); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { if (on) setReduce(v); });
    return () => { on = false; sub.remove(); };
  }, []);

  const [lowPower, setLowPower] = useState<boolean | null>(null);
  useEffect(() => {
    const B = loadBattery();
    if (!B) return;
    let on = true;
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        if (!(await B.isAvailableAsync()) || !on) return;
        const v = await B.isLowPowerModeEnabledAsync();
        if (!on) return;
        setLowPower(v);
        const s = B.addLowPowerModeListener(({ lowPowerMode }) => { if (on) setLowPower(lowPowerMode); });
        if (on) sub = s; else s.remove();
      } catch { /* native module missing in this binary: stays undetected (null) */ }
    })();
    return () => { on = false; sub?.remove(); };
  }, []);

  // Sound: one quiet looping player. No global audio-mode changes, so other
  // features (e.g. recording) keep their own session configuration.
  const player = useAudioPlayer(CRACKLE);
  const status = useAudioPlayerStatus(player);
  const isLava = prefs.theme === 'lava';
  const wantSound = isLava && prefs.sound && active;
  const [rejected, setRejected] = useState<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tryPlay = useCallback(() => {
    setRejected(null);
    try {
      player.loop = true;
      player.volume = clampVolume(latest.current.volume);
      const r = player.play() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch((e: unknown) => { if (mounted.current) setRejected(String((e as Error)?.name ?? 'blocked')); });
      }
      if (Platform.OS === 'web') {
        // Fallback for builds whose play() swallows the autoplay rejection.
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          try { if (mounted.current && !player.playing) setRejected('blocked'); } catch { /* ignore */ }
        }, 1500);
      }
    } catch (e) { setRejected(String((e as Error)?.message ?? 'error')); }
  }, [player]);

  useEffect(() => {
    if (wantSound) tryPlay();
    else {
      try { player.pause(); } catch { /* ignore */ }
      setRejected(null);
    }
    return () => { if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; } };
  }, [wantSound, player, tryPlay]);
  useEffect(() => { try { player.volume = clampVolume(prefs.volume); } catch { /* ignore */ } }, [prefs.volume, player]);

  const statusError = (status as { error?: string | null }).error ?? null;
  const soundState: SoundState = !wantSound ? 'off'
    : status.playing ? 'playing'
    : statusError ? 'error'
    : rejected ? 'blocked'
    : 'loading';

  const value = useMemo<Ctx>(() => ({
    ...prefs, isLava, ready, loadError, saveError, retrySave, active, reduceMotion, lowPower,
    soundState, soundError: soundState === 'error' ? statusError : null,
    setTheme: (t) => update({ theme: t }),
    setSound: (s) => update({ sound: s }),
    setVolume: (v) => update({ volume: v }),
    retrySound: tryPlay,
  }), [prefs, isLava, ready, loadError, saveError, retrySave, active, reduceMotion, lowPower, soundState, statusError, update, tryPlay]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const c = useContext(AppearanceContext);
  if (!c) throw new Error('useAppearance must be used inside AppearanceProvider');
  return c;
}

/** Safe outside the provider (e.g. startup ErrorFallback): returns null. */
export function useOptionalAppearance() {
  return useContext(AppearanceContext);
}
