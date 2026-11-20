// Pure, device-level appearance preferences (no React / storage imports; unit-testable).
/** Visual effect themes (classic cream, live lava) plus the five colour themes. */
export type EffectThemeId = 'classic' | 'lava';
export type ColorThemeId = 'matSiyah' | 'koyuLila' | 'acikBordo' | 'natural' | 'kirikBeyaz';
export type ThemeId = EffectThemeId | ColorThemeId;

/** Single source of truth for the "Tema Rengi" choices (labels and exact swatch values). */
export const COLOR_THEMES: readonly { id: ColorThemeId; label: string; swatch: string; dark: boolean }[] = [
  { id: 'matSiyah', label: 'Mat Siyah', swatch: '#1A1A1A', dark: true },
  { id: 'koyuLila', label: 'Koyu Lila', swatch: '#6A4C93', dark: true },
  { id: 'acikBordo', label: 'Açık Bordo', swatch: '#8E3B46', dark: true },
  { id: 'natural', label: 'Natural', swatch: '#C9A27E', dark: false },
  { id: 'kirikBeyaz', label: 'Kırık Beyaz', swatch: '#F5F0E6', dark: false },
];
export const THEME_IDS: readonly ThemeId[] = ['classic', 'lava', ...COLOR_THEMES.map((t) => t.id)];
export function isThemeId(v: unknown): v is ThemeId { return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v); }
export function isDarkTheme(id: ThemeId): boolean { return COLOR_THEMES.some((t) => t.id === id && t.dark); }
export type AppearancePrefs = { theme: ThemeId; sound: boolean; volume: number };
export const MAX_VOLUME = 0.15;
export const DEFAULT_PREFS: AppearancePrefs = { theme: 'classic', sound: true, volume: 0.12 };
export const APPEARANCE_KEY = 'afilli.appearance.v1';

export function clampVolume(v: unknown, fallback = DEFAULT_PREFS.volume): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_VOLUME, Math.round(n * 100) / 100));
}

export function normalizePrefs(input: unknown): AppearancePrefs {
  if (!input || typeof input !== 'object') return { ...DEFAULT_PREFS };
  const p = input as Record<string, unknown>;
  return {
    theme: isThemeId(p.theme) ? p.theme : 'classic',
    sound: typeof p.sound === 'boolean' ? p.sound : DEFAULT_PREFS.sound,
    volume: clampVolume(p.volume),
  };
}

/** Parses stored JSON; null/garbage yields defaults without throwing. */
export function parsePrefs(raw: string | null | undefined): AppearancePrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try { return normalizePrefs(JSON.parse(raw)); } catch { return { ...DEFAULT_PREFS }; }
}

export function serializePrefs(p: AppearancePrefs): string {
  return JSON.stringify(normalizePrefs(p));
}

/**
 * Latest-wins serialized writer: at most one write in flight; while busy only the
 * newest pending value is kept, then written next.
 */
export function createLatestWriter<T>(write: (v: T) => Promise<void>, onResult: (err: unknown | null) => void) {
  let busy = false;
  let pending: { v: T } | null = null;
  const pump = async () => {
    if (busy) return;
    busy = true;
    while (pending) {
      const { v } = pending; pending = null;
      try { await write(v); if (!pending) onResult(null); } catch (e) { if (!pending) onResult(e); }
    }
    busy = false;
  };
  return { save(v: T) { pending = { v }; return pump(); } };
}
