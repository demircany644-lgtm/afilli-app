import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isFullscreenChatPath } from '../lib/fullscreen-chat.ts';

test('only private conversations and the existing writer room hide the main menu', () => {
  for (const path of ['/chat/123', '/chat/123/', '/chat/123///', '/chat/af-123', '/writer-chat', '/writer-chat/']) {
    assert.equal(isFullscreenChatPath(path), true, path);
  }
});

test('leaving chat restores the menu on all ordinary routes', () => {
  for (const path of ['/', '/messages', '/messages/', '/profile', '/write', '/library', '/saved',
    '/search', '/people/123', '/sign-in', '/chat', '/chat/', '/chatty/123', '/chats/123',
    '/writer-chat-settings', '/writer-chat/other', '/chat/123/other', '/chat/?id=123', '/chat/#123']) {
    assert.equal(isFullscreenChatPath(path), false, path);
  }
});

test('the root keeps provider order and gates the complete menu, not just its contents', () => {
  const source = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(source, /isFullscreenChatPath\(pathname\)/);
  assert.match(source, /!\w+\s*\?\s*<BottomNavigation\s*\/>\s*:\s*null/);
  const auth = source.indexOf('<AuthProvider>');
  const appearance = source.indexOf('<AppearanceProvider>');
  const community = source.indexOf('<CommunityProvider>');
  const direct = source.indexOf('<DirectMessagesProvider>');
  const keyboard = source.indexOf('<KeyboardProvider>');
  assert.ok(auth > 0 && auth < appearance && appearance < community && community < direct && direct < keyboard);
});

test('the chat-specific header has only the back action and centered peer name', () => {
  const source = readFileSync(new URL('../app/chat/[id].tsx', import.meta.url), 'utf8');
  const header = source.slice(source.indexOf('<View style={[st.header'), source.indexOf('<View style={{ flex: 1, minHeight: 0 }}>{body}'));
  assert.equal((header.match(/<Pressable\b/g) ?? []).length, 1);
  assert.match(header, /testID="chat-back"/);
  assert.match(header, /goBack\('\/messages'\)/);
  assert.match(header, /testID="chat-peer-name"/);
  assert.match(header, /peer\.nickname/);
  assert.doesNotMatch(source, /\b(?:Avatar|StatusLine|TopBar)\b/);
  assert.match(source, /headerTitle:\s*\{[^}]*minWidth: 0,[^}]*textAlign: 'center'/);
});

test('one keyboard container retains the inverted transcript and safe-area composer', () => {
  const source = readFileSync(new URL('../app/chat/[id].tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/<KeyboardAvoidingView\b/g) ?? []).length, 1);
  assert.match(source, /<KeyboardAvoidingView behavior="padding"[^>]*keyboardVerticalOffset=\{0\}/);
  assert.match(source, /testID="chat-list" inverted/);
  assert.match(source, /keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"/);
  assert.match(source, /t\.loadOlder\(\)/);
  assert.match(source, /Platform\.OS === 'web' \? 34 : ins\.bottom/);
  assert.match(source, /<ChatComposer[^]*?onQueued=\{t\.deliver\}[^]*?bottomInset=\{bottomPad\}/);
  assert.match(source, /<PhotoMessage\b/);
  assert.match(source, /<GifMessage\b/);
  assert.match(source, /Bu mesaj silindi/);
  assert.match(source, /Bu medya süresi dolduğu için silindi/);
});

test('the composer keeps photo, GIF and durable send controls without extra emoji toolbar', () => {
  const source = readFileSync(new URL('../components/profile/ChatComposer.tsx', import.meta.url), 'utf8');
  const controls = ['chat-photo-pick', 'chat-gif', 'chat-input', 'chat-send'].map(id => source.indexOf(`testID="${id}"`));
  assert.ok(controls.every(index => index > 0));
  assert.deepEqual([...controls].sort((a, b) => a - b), controls);
  assert.doesNotMatch(source, /testID="chat-emoji/);
  assert.match(source, /paddingBottom: 10 \+ bottomInset/);
  assert.match(source, /placeholder="Mesaj yaz\.\.\."/);
  assert.ok(source.indexOf('await queuePromise.current') < source.indexOf('onQueuedRef.current(entry)'));
  assert.match(source, /input\.current\?\.focus\(\)/);
  assert.match(source, /testID="chat-reply-preview"/);
  assert.match(source, /testID="chat-photo-preview"/);
  assert.match(source, /testID="chat-gif-preview"/);
});
