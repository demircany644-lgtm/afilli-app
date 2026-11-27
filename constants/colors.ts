// Static classic (cream) defaults. Themed UI reads live tokens via useTheme()/useColors()
// (lib/themePalettes.ts); only brand, lava and semantic values are used directly.
const colors = {
  light: {
    text: '#3B2416', tint: '#B8893A',
    background: '#FFF8E7', foreground: '#3B2416',
    card: '#FFFBF3', cardForeground: '#3B2416',
    primary: '#B8893A', primaryForeground: '#3B2416',
    secondary: '#EFE3CC', secondaryForeground: '#4A2E1C',
    muted: '#EDE3D1', mutedForeground: '#8A7362',
    accent: '#D9B56A', accentForeground: '#3B2416',
    destructive: '#C2382B', destructiveForeground: '#FFF8EE',
    writerChatLabel: '#1877F2',
    border: '#E6D6B8', input: '#E6D6B8',
    gold: '#B8893A', goldSoft: '#E9CF8E', brown: '#4A2E1C', paper: '#FFFCF5',
  },
  home: {
    bg: '#FFF8E7', card: '#FFFFFF', ink: '#2B211B', muted: '#6B5444',
    border: '#D9C3A0', link: '#8A6A3E', disc: '#000000', discRing: '#FFFFFF', navIcon: '#5A3B26', heart: '#B98A62', badge: '#B3412E', badgeText: '#FFF8EE',
  },
  magazine: {
    background: '#F5EFE6', card: '#FFF8EC', text: '#3E2A1A', gold: '#C9A24B',
    muted: '#8C7660', input: '#EFE4D5', border: '#C4AA80',
    danger: '#A6392D', white: '#FFFFFF',
  },
  // Profile/social tokens. Brand colors are the platforms' own, used only on their marks.
  social: {
    igYellow: '#FEDA75', igOrange: '#F58529', igPink: '#DD2A7B', igPurple: '#8134AF', igBlue: '#515BD4',
    fbBlue: '#1877F2', xBlack: '#0F1419',
    onBrand: '#FFFFFF', online: '#3F9A5B', offline: '#9C9187', typing: '#E07A1F',
    foilLight: '#F3DE9F', foilMid: '#C9A24B', foilDeep: '#9A7430', vein: '#C9A24B', ink: '#3E2A1A',
    bubbleMine: '#4A2E1C', bubbleMineText: '#FFF8EC', scrim: 'rgba(62,42,26,0.42)',
  },
  // Alev / Lav theme (opt-in, device appearance only).
  lava: {
    bg: '#0D0806', ember: '#7A1A06', flame: '#F0571A', core: '#FFC15A', spark: '#FFB35C',
    scrim: 'rgba(10,6,4,0.18)', headline: '#FBF4EA', link: '#E9C27A', pill: '#F4ECDC', pillText: '#2B211B',
    card: '#FFFCF7', cardBorder: 'rgba(255,255,255,0.7)', track: 'rgba(255,255,255,0.22)',
  },
  store: {
    bg: '#100807', card: '#1D0D0C', raised: '#2B1111', text: '#FFF4E6', muted: '#D5BE9D',
    border: '#6F3A20', gold: '#E5BC62', goldLight: '#F5D991', danger: '#D96B5C',
  },
  radius: 14,
};
export default colors;
