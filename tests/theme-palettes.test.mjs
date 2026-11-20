import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_THEMES, THEME_IDS, parsePrefs, serializePrefs, normalizePrefs } from '../lib/appearancePrefs.ts';
import { getThemeTokens } from '../lib/themePalettes.ts';

const expected = [
  ['matSiyah', 'Mat Siyah', '#1A1A1A'],
  ['koyuLila', 'Koyu Lila', '#6A4C93'],
  ['acikBordo', 'Açık Bordo', '#8E3B46'],
  ['natural', 'Natural', '#C9A27E'],
  ['kirikBeyaz', 'Kırık Beyaz', '#F5F0E6'],
];
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function readable(ink, background, role) {
  assert.ok(contrast(ink, background) >= 4.5, `${role}: ${ink} on ${background}`);
}

test('five color choices preserve the exact requested names and swatches', () => {
  assert.deepEqual(COLOR_THEMES.map(({ id, label, swatch }) => [id, label, swatch]), expected);
});
test('every selectable color survives persistence with sound preferences intact', () => {
  for (const [theme] of expected) {
    const prefs = { theme, sound: false, volume: 0.09 };
    assert.deepEqual(parsePrefs(serializePrefs(prefs)), prefs);
  }
});
test('classic and lava remain compatible; unknown themes cannot unlock ocean', () => {
  for (const theme of ['classic', 'lava']) assert.equal(parsePrefs(`{"theme":"${theme}"}`).theme, theme);
  for (const theme of ['ocean', 'toString', '__proto__', null]) {
    assert.equal(normalizePrefs({ theme }).theme, 'classic');
    assert.equal(getThemeTokens(theme).id, 'classic');
  }
});
test('theme selection reaches every shared background token family', () => {
  for (const [id, , swatch] of expected) {
    const tokens = getThemeTokens(id);
    assert.equal(tokens.light.background, swatch);
    assert.equal(tokens.home.bg, swatch);
    assert.equal(tokens.magazine.background, swatch);
    assert.notEqual(tokens.light.primary, getThemeTokens('classic').light.primary);
    assert.equal(getThemeTokens(id), tokens, 'stable cached palettes');
  }
});
test('small text, links and filled buttons stay readable in every palette', () => {
  for (const id of THEME_IDS) {
    const { light: l, home: h, magazine: p, social: s } = getThemeTokens(id);
    readable(l.foreground, l.background, `${id} body`);
    readable(l.cardForeground, l.card, `${id} card`);
    readable(l.mutedForeground, l.card, `${id} secondary text`);
    readable(l.primaryForeground, l.primary, `${id} filled button`);
    readable(h.link, h.bg, `${id} home links`);
    readable(p.text, p.background, `${id} profile text`);
    readable(p.muted, p.card, `${id} profile secondary text`);
    for (const color of [s.foilLight, s.foilMid, s.foilDeep]) {
      readable(p.onAccent, color, `${id} gradient button`);
    }
  }
});
test('switching palettes cannot change social brands or account presence colors', () => {
  const original = getThemeTokens('classic').social;
  for (const id of THEME_IDS) {
    const current = getThemeTokens(id).social;
    for (const key of ['igYellow', 'igOrange', 'igPink', 'igPurple', 'igBlue', 'online', 'offline', 'typing']) {
      assert.equal(current[key], original[key]);
    }
  }
});
