import colors from '@/constants/colors';
import { useOptionalAppearance } from '@/context/AppearanceContext';
import { getThemeTokens } from '@/lib/themePalettes';

/**
 * Design tokens for the active palette (cream classic, lava, or one of the five
 * colour themes). Lava keeps cream reading surfaces and only adds `chrome` tokens
 * for frames that sit on the exposed lava. Safe outside AppearanceProvider.
 */
export function useColors() {
  const appearance = useOptionalAppearance();
  const t = getThemeTokens(appearance?.theme ?? 'classic');
  const isLava = t.id === 'lava';
  const palette = t.light;
  const chrome = isLava
    ? { bg: colors.lava.bg, text: colors.lava.headline, link: colors.lava.link, border: 'rgba(255,255,255,0.14)', panel: palette.background }
    : { bg: palette.background, text: palette.brown, link: palette.gold, border: palette.border, panel: palette.background };
  return { ...palette, radius: colors.radius, isLava, isDark: t.isDark, chrome };
}
