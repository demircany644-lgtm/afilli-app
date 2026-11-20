// Pure palette tables per theme (no React / '@/' imports; unit-testable).
import type { ThemeId } from './appearancePrefs';

export type LightTokens = {
  text: string; tint: string; background: string; foreground: string; card: string; cardForeground: string;
  primary: string; primaryForeground: string; secondary: string; secondaryForeground: string;
  muted: string; mutedForeground: string; accent: string; accentForeground: string;
  destructive: string; destructiveForeground: string; writerChatLabel: string;
  border: string; input: string; gold: string; goldSoft: string; brown: string; paper: string;
};
export type HomeTokens = {
  bg: string; card: string; ink: string; muted: string; border: string; link: string; disc: string; discRing: string;
  navIcon: string; navBar: string; heart: string; badge: string; badgeText: string;
};
export type MagazineTokens = {
  background: string; card: string; text: string; gold: string; muted: string; input: string; border: string;
  danger: string; white: string; onAccent: string;
};
export type SocialTokens = {
  igYellow: string; igOrange: string; igPink: string; igPurple: string; igBlue: string; fbBlue: string; xBlack: string;
  onBrand: string; online: string; offline: string; typing: string;
  foilLight: string; foilMid: string; foilDeep: string; vein: string; ink: string;
  bubbleMine: string; bubbleMineText: string; scrim: string;
};
export type ThemeTokens = { id: ThemeId; isDark: boolean; light: LightTokens; home: HomeTokens; magazine: MagazineTokens; social: SocialTokens };

/** Brand + semantic colours never tinted by the theme. */
const BRAND = {
  igYellow: '#FEDA75', igOrange: '#F58529', igPink: '#DD2A7B', igPurple: '#8134AF', igBlue: '#515BD4',
  fbBlue: '#1877F2', xBlack: '#0F1419', onBrand: '#FFFFFF', online: '#3F9A5B', offline: '#9C9187', typing: '#E07A1F',
};

type Seed = {
  isDark: boolean; bg: string; card: string; input: string; border: string; text: string; muted: string;
  gold: string; goldSoft: string; danger: string; foil: [string, string, string]; onAccent: string;
  bubble: string; bubbleText: string; scrim: string; navBar: string; link: string;
};

function build(id: ThemeId, s: Seed): ThemeTokens {
  return {
    id, isDark: s.isDark,
    light: {
      text: s.text, tint: s.gold, background: s.bg, foreground: s.text, card: s.card, cardForeground: s.text,
      primary: s.gold, primaryForeground: s.onAccent, secondary: s.input, secondaryForeground: s.text,
      muted: s.input, mutedForeground: s.muted, accent: s.goldSoft, accentForeground: s.text,
      destructive: s.danger, destructiveForeground: s.isDark ? '#1A1210' : '#FFF8EE', writerChatLabel: '#1877F2',
      border: s.border, input: s.border, gold: s.gold, goldSoft: s.goldSoft, brown: s.text, paper: s.card,
    },
    home: {
      bg: s.bg, card: s.card, ink: s.text, muted: s.muted, border: s.border, link: s.link,
      disc: '#141210', discRing: s.foil[1], navIcon: s.text, navBar: s.navBar, heart: s.gold,
      badge: '#B3412E', badgeText: '#FFF8EE',
    },
    magazine: {
      background: s.bg, card: s.card, text: s.text, gold: s.gold, muted: s.muted, input: s.input, border: s.border,
      danger: s.danger, white: '#FFFFFF', onAccent: s.onAccent,
    },
    social: {
      ...BRAND, foilLight: s.foil[0], foilMid: s.foil[1], foilDeep: s.foil[2], vein: s.foil[1], ink: s.text,
      bubbleMine: s.bubble, bubbleMineText: s.bubbleText, scrim: s.scrim,
    },
  };
}

const CLASSIC: Seed = {
  isDark: false, bg: '#FFF8E7', card: '#FFFDF6', input: '#F1E6D2', border: '#D9C3A0', text: '#2B211B', muted: '#7A6350',
  gold: '#B8893A', goldSoft: '#E9CF8E', danger: '#A6392D', foil: ['#F3DE9F', '#C9A24B', '#B08B40'], onAccent: '#2B211B',
  bubble: '#4A2E1C', bubbleText: '#FFF8EC', scrim: 'rgba(62,42,26,0.42)', navBar: 'rgba(255,251,240,0.94)', link: '#876020',
};

const SEEDS: Record<ThemeId, Seed> = {
  classic: CLASSIC,
  lava: CLASSIC, // reading surfaces stay cream; lava only adds chrome/backdrop
  matSiyah: {
    isDark: true, bg: '#1A1A1A', card: '#252321', input: '#302D2A', border: '#4A433B', text: '#F4ECDF', muted: '#B9AD9C',
    gold: '#D9B66A', goldSoft: '#6E5A33', danger: '#EC8A7D', foil: ['#F3DE9F', '#D4AF5F', '#A7803A'], onAccent: '#1A1A1A',
    bubble: '#D4AF5F', bubbleText: '#1A1A1A', scrim: 'rgba(0,0,0,0.55)', navBar: 'rgba(37,35,33,0.96)', link: '#D9B66A',
  },
  koyuLila: {
    isDark: true, bg: '#6A4C93', card: '#5A3F80', input: '#4E366F', border: '#9479BA', text: '#FBF6EE', muted: '#E6DBF3',
    gold: '#F2D28C', goldSoft: '#8C6FB4', danger: '#FFC2B8', foil: ['#FBF1DA', '#F0D394', '#D2AD62'], onAccent: '#2E1F45',
    bubble: '#F0D394', bubbleText: '#2E1F45', scrim: 'rgba(30,18,48,0.55)', navBar: 'rgba(90,63,128,0.96)', link: '#F2D28C',
  },
  acikBordo: {
    isDark: true, bg: '#8E3B46', card: '#7A313B', input: '#6B2A33', border: '#B66B75', text: '#FFF5EC', muted: '#F4D6D1',
    gold: '#F4D18E', goldSoft: '#A9545F', danger: '#FFD0C4', foil: ['#FCEFE2', '#F1CFA5', '#D3A56E'], onAccent: '#3E141B',
    bubble: '#F1CFA5', bubbleText: '#3E141B', scrim: 'rgba(40,10,15,0.55)', navBar: 'rgba(122,49,59,0.96)', link: '#F4D18E',
  },
  natural: {
    isDark: false, bg: '#C9A27E', card: '#E6CEB2', input: '#D9B995', border: '#8E6A48', text: '#24180F', muted: '#47301F',
    gold: '#5E3E17', goldSoft: '#B48E66', danger: '#7E1D12', foil: ['#7A5634', '#5E3F22', '#432C16'], onAccent: '#FFF3E3',
    bubble: '#4E3420', bubbleText: '#FFF3E3', scrim: 'rgba(36,24,15,0.45)', navBar: 'rgba(230,206,178,0.96)', link: '#4E3010',
  },
  kirikBeyaz: {
    isDark: false, bg: '#F5F0E6', card: '#FCF9F3', input: '#EAE2D3', border: '#D3C5AB', text: '#2E2620', muted: '#6B5F51',
    gold: '#9A7835', goldSoft: '#E4D3AC', danger: '#A6392D', foil: ['#EFE0BA', '#C9A962', '#987737'], onAccent: '#080603',
    bubble: '#3B302A', bubbleText: '#F5F0E6', scrim: 'rgba(46,38,32,0.42)', navBar: 'rgba(252,249,243,0.95)', link: '#806027',
  },
};

const CACHE = new Map<ThemeId, ThemeTokens>();
/** Immutable, cached token set for a theme; unknown ids fall back to classic. */
export function getThemeTokens(id: ThemeId): ThemeTokens {
  const key: ThemeId = Object.prototype.hasOwnProperty.call(SEEDS, id) ? id : 'classic';
  let t = CACHE.get(key);
  if (!t) { t = build(key, SEEDS[key]); CACHE.set(key, t); }
  return t;
}
