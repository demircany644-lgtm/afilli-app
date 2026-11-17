import assert from 'node:assert/strict';
import test from 'node:test';
import { profileSocialUrl } from '../api-server/src/lib/profile-social.ts';

test('personal links preserve valid platform destinations', () => {
  for (const [platform, url] of [
    ['facebook', 'https://www.facebook.com/afilli.test'],
    ['facebook', 'https://facebook.com/profile.php?id=123'],
    ['x', 'https://x.com/writer_test'],
    ['x', 'https://twitter.com/writer_test'],
  ]) assert.equal(profileSocialUrl(url, platform), url);
});

test('empty values remove personal links', () => {
  assert.equal(profileSocialUrl(null, 'facebook'), null);
  assert.equal(profileSocialUrl('  ', 'x'), null);
});

test('unsafe and non-account destinations are rejected', () => {
  for (const [platform, url] of [
    ['facebook', 'https://facebook.com/'],
    ['facebook', 'https://facebook.com.evil.example/writer'],
    ['facebook', 'https://facebook.com/l.php?u=https://evil.example'],
    ['x', 'http://x.com/writer'],
    ['x', 'https://name:password@x.com/writer'],
    ['x', 'https://x.com/writer/status/123'],
    ['x', 'javascript:alert(1)'],
    ['x', 'https://x.com:8080/writer'],
  ]) assert.throws(() => profileSocialUrl(url, platform), undefined, url);
});
