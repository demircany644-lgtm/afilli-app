import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { authAccounts, authSessions, authCodes } from '../../db/src/schema/auth.ts';

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
