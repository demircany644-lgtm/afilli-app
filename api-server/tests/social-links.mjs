import assert from 'node:assert/strict';
import { officialInstagramUrl } from '../src/lib/social.ts';

assert.equal(officialInstagramUrl(null), null);
assert.equal(officialInstagramUrl(' '), null);
assert.equal(officialInstagramUrl('https://instagram.com/AFILLI'), 'https://www.instagram.com/afilli/');
assert.equal(officialInstagramUrl('https://www.instagram.com/afilli/'), 'https://www.instagram.com/afilli/');
for (const url of [
  'afilli', '@afilli', 'http://instagram.com/afilli', 'https://instagram.com.evil.test/afilli',
  'https://evil.test/?next=instagram.com/afilli', 'https://instagram.com/afilli/fake',
  'https://instagram.com/afilli?next=evil', 'https://instagram.com/afilli#x',
  'https://user:password@instagram.com/afilli', 'https://instagram.com:444/afilli',
  'https://instagram.com/explore', 'https://instagram.com/p',
]) assert.throws(() => officialInstagramUrl(url), `Accepted invalid Instagram URL: ${url}`);
console.log('PASS only canonical Instagram profile URLs are accepted; empty configuration stays hidden.');
