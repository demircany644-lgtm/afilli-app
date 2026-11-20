import { useOptionalAppearance } from '@/context/AppearanceContext';
import { getThemeTokens, type ThemeTokens } from '@/lib/themePalettes';
import type { ThemeId } from '@/lib/appearancePrefs';

/** Active theme tokens (immutable, cached per theme). Safe outside AppearanceProvider (classic). */
export function useTheme(): ThemeTokens {
  const theme = useOptionalAppearance()?.theme ?? 'classic';
  return getThemeTokens(theme);
}

/**
 * Per-palette StyleSheet factory. Each theme's sheet is created once and reused,
 * so components re-style on theme change without remounting (drafts stay intact).
 */
export function makeStyles<T>(factory: (t: ThemeTokens) => T): (() => T) & { get: (t: ThemeTokens) => T } {
  const cache = new Map<ThemeId, T>();
  const get = (t: ThemeTokens) => {
    let v = cache.get(t.id);
    if (v === undefined) { v = factory(t); cache.set(t.id, v); }
    return v;
  };
  function useStyles() { return get(useTheme()); }
  return Object.assign(useStyles, { get });
}
