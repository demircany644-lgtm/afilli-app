import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { homeCoverLayout } from '../lib/home-cover-layout.ts';

for (const screenWidth of [320, 360, 375, 390, 430, 560, 768]) {
  test(`home covers at ${screenWidth}: taller covers retain shelf and heading positions`, () => {
    const pad = screenWidth < 360 ? 14 : 18;
    const inner = Math.min(screenWidth, 560) - pad;
    const width = Math.round(Math.min(190, (inner - 24) / 2.42));
    const originalHeight = Math.round(width * 1.2);
    const layout = homeCoverLayout(originalHeight);
    const headingGap = 10;
    const topPadding = 2;
    const bottomPadding = 14;
    const nextShelfMargin = 14;

    assert.equal(layout.height - originalHeight, 19);
    const previousShelfFootprint = originalHeight + topPadding + bottomPadding;
    assert.equal(layout.frameHeight + layout.marginTop, previousShelfFootprint);
    const originalNextHeading = headingGap + previousShelfFootprint + nextShelfMargin;
    const nextHeading = headingGap + layout.marginTop + layout.frameHeight + nextShelfMargin;
    assert.equal(nextHeading, originalNextHeading);
    assert.equal(topPadding + layout.height, layout.frameHeight, 'entire touch target fits inside the frame');
    assert.equal(layout.scrollHeight, layout.frameHeight + bottomPadding, 'shadow retains its scroll padding');
    const coverTop = headingGap + layout.marginTop + topPadding;
    const coverBottom = coverTop + layout.height;
    assert.equal(coverTop, 7, 'cover stays below its heading');
    assert.equal(nextHeading - coverBottom, 14, 'cover stays above the next heading');
    assert.equal(headingGap + layout.marginTop + layout.scrollHeight, nextHeading, 'scroller ends before next heading');
  });
}

test('the home retains its original width, snapping, book routes and non-cover states', () => {
  const source = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /const coverW = Math\.round\(Math\.min\(190, \(inner - 24\) \/ 2\.42\)\)/);
  assert.match(source, /const coverH = Math\.round\(coverW \* 1\.2\)/);
  assert.match(source, /snapToInterval=\{w \+ 12\}/);
  assert.match(source, /openBook\(b\.id\)/);
  assert.match(source, /<ShelfCover key=\{b\.id\} b=\{b\} w=\{w\} h=\{cover\.height\}/);
  assert.match(source, /st\.ghost, \{ width: w, height: h \}/);
  assert.match(source, /testID=\{'home-empty-' \+ sec\.id\}/);
  assert.match(source, /testID=\{'home-retry-' \+ sec\.id\}/);
});
