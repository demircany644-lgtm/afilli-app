import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
const sharpModule = await import('sharp');
const sharp = sharpModule.default;
const { imagePerceptualHashes, findProhibitedImageMatch } = await import('../src/lib/prohibited-images.ts');
const { isContactRouteAllowed } = await import('../src/lib/auth-session.ts');

const sourceSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720">
  <rect width="480" height="720" fill="#ece6dc"/>
  <rect x="30" y="45" width="150" height="420" rx="28" fill="#13121a"/>
  <circle cx="335" cy="195" r="112" fill="#b01e45"/>
  <path d="M50 610 L220 500 L420 650 L390 690 L90 680 Z" fill="#d0a749"/>
  <rect x="250" y="420" width="178" height="96" fill="#235274"/>
</svg>`);
const unrelatedSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720">
  <rect width="480" height="720" fill="#071f2c"/>
  <circle cx="90" cy="100" r="35" fill="#f5e9a9"/>
  <circle cx="390" cy="620" r="25" fill="#f5e9a9"/>
  <path d="M0 260 H480 M0 300 H480 M0 340 H480 M0 380 H480" stroke="#6c98ad" stroke-width="20"/>
  <rect x="80" y="480" width="330" height="100" fill="#c5c1b5"/>
</svg>`);

const referenceHashes = await imagePerceptualHashes(sourceSvg);
const dbWithReference = {
  query: async () => ({ rows: [
    { id: 'ref-match', hashes: referenceHashes },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `ref-extra-${i}`, hashes: [] })),
  ] }),
};
const dbWithFourReferences = {
  query: async () => ({ rows: Array.from({ length: 4 }, (_, i) => ({ id: `ref-${i}`, hashes: referenceHashes })) }),
};

test('detector stays off until all five administrator references are ready', async () => {
  assert.equal(await findProhibitedImageMatch(sourceSvg, dbWithFourReferences), null);
});

test('detector matches the original and a recompressed version of a reference', async () => {
  const compressed = await sharp(sourceSvg).jpeg({ quality: 70 }).toBuffer();
  assert.deepEqual(await findProhibitedImageMatch(sourceSvg, dbWithReference), { referenceId: 'ref-match', distance: 0 });
  const match = await findProhibitedImageMatch(compressed, dbWithReference);
  assert.ok(match, 'JPEG recompression should still match its source reference');
  assert.ok(match.distance <= 6, `expected strict 6/64 threshold, got ${match.distance}`);
});

test('detector matches a resized center crop of a reference', async () => {
  const cropped = await sharp(sourceSvg)
    .extract({ left: 48, top: 72, width: 384, height: 576 })
    .resize(300, 450)
    .jpeg({ quality: 82 })
    .toBuffer();
  const match = await findProhibitedImageMatch(cropped, dbWithReference);
  assert.ok(match, 'center crop should overlap one of the administrator reference crops');
  assert.ok(match.distance <= 6, `expected strict 6/64 threshold, got ${match.distance}`);
});

test('unrelated images do not match a prohibited reference', async () => {
  assert.equal(await findProhibitedImageMatch(unrelatedSvg, dbWithReference), null);
});

test('contact-only sessions can access only session, contact, and logout routes', () => {
  assert.equal(isContactRouteAllowed('GET', '/api/auth/session'), true);
  assert.equal(isContactRouteAllowed('GET', '/api/prohibited-image-contact/me'), true);
  assert.equal(isContactRouteAllowed('POST', '/api/prohibited-image-contact/messages'), true);
  assert.equal(isContactRouteAllowed('POST', '/api/auth/logout'), true);
  assert.equal(isContactRouteAllowed('GET', '/api/my-profile'), false);
  assert.equal(isContactRouteAllowed('POST', '/api/bulletins'), false);
});
