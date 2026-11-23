import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { authAccounts, authSessions, authCodes } from '../../db/src/schema/auth.ts';
import { assertBookCommunitySchema } from '../src/lib/book-community-schema.ts';
import { readerParagraphs, readerCommentTargets, readerLikes, readerCommentEvents, readerReports } from '../../db/src/schema/reader-interactions.ts';

test('book discussion release refuses a missing custom moderation/deletion trigger', async () => {
  await assert.rejects(assertBookCommunitySchema({ query: async () => ({ rows: [{ ok: false }] }) }), /tools\/book-community.sql.*moderation.*tools\/reader-interactions.sql/);
  await assert.doesNotReject(assertBookCommunitySchema({ query: async () => ({ rows: [{ ok: true }] }) }));
});

test('reader release requires new discussion tables and retains the moderation trigger gate', async () => {
  await assertBookCommunitySchema({ query: async sql => {
    for (const name of ['reader_paragraphs', 'reader_comment_targets', 'reader_likes', 'reader_reports', 'reader_comment_events', 'writer_comment_node_sync'])
      assert.ok(sql.includes(name), `Missing readiness check: ${name}`);
    return { rows: [{ ok: true }] };
  } });
});

test('reader migration is additive, repeatable, and contains no existing-data rewriting', async () => {
  const sql = (await readFile(new URL('../tools/reader-interactions.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  assert.doesNotMatch(sql, /(?:^|;)\s*(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER|INSERT|COPY)\b/i);
  for (const table of ['reader_paragraphs', 'reader_comment_targets', 'reader_likes', 'reader_reports', 'reader_comment_events'])
    assert.match(sql, new RegExp('CREATE TABLE IF NOT EXISTS ' + table));
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS reader_chapter_like_once/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS reader_paragraph_like_once/);
});

test('reader ORM keeps the additive migration constraint names and unique-constraint kinds', () => {
  for (const [table, prefix] of [[readerParagraphs, 'reader_paragraphs'], [readerCommentTargets, 'reader_comment_targets'],
    [readerLikes, 'reader_likes'], [readerCommentEvents, 'reader_comment_events'], [readerReports, 'reader_reports']]) {
    for (const fk of getTableConfig(table).foreignKeys) {
      assert.equal(fk.getName(), prefix + '_' + fk.reference().columns.map(c => c.name).join('_') + '_fkey');
      assert.equal(fk.onDelete, 'cascade');
    }
  }
  assert.ok(getTableConfig(readerParagraphs).uniqueConstraints.some(u => u.name === 'reader_paragraphs_identity'));
  assert.ok(getTableConfig(readerReports).uniqueConstraints.some(u => u.name === 'reader_reports_once'));
});

test('release retains existing account foreign-key identities and deletion behavior', () => {
  for (const [table, expected] of [
    [authAccounts, 'afilli_auth_accounts_user_id_fkey'],
    [authSessions, 'afilli_auth_sessions_user_id_fkey'],
    [authCodes, 'afilli_auth_codes_user_id_fkey'],
  ]) {
    const keys = getTableConfig(table).foreignKeys;
    assert.equal(keys.length, 1);
    assert.equal(keys[0].getName(), expected);
    assert.equal(keys[0].onDelete, 'no action');
    assert.equal(keys[0].onUpdate, 'no action');
    assert.deepEqual(keys[0].reference().columns.map(c => c.name), ['user_id']);
  }
});

test('release retains the existing user-session lookup index', () => {
  const entry = getTableConfig(authSessions).indexes.find(i => i.config.name === 'afilli_auth_sessions_user');
  assert.ok(entry, 'Publishing must not remove the production session index');
  assert.deepEqual(entry.config.columns.map(c => c.name), ['user_id']);
});
