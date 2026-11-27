import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { communityUsers } from './community';

export const authAccounts = pgTable('afilli_auth_accounts', {
  userId: text('user_id').primaryKey(),
  email: text('email').notNull().unique('afilli_auth_accounts_email_key'), passwordHash: text('password_hash'),
  emailVerified: boolean('email_verified').notNull().default(false),
  role: text('role').notNull().default('user'), disabled: boolean('disabled').notNull().default(false),
  migrated: boolean('migrated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ name: 'afilli_auth_accounts_user_id_fkey', columns: [t.userId], foreignColumns: [communityUsers.id] }),
  check('afilli_auth_accounts_supported_role', sql`${t.role} IN ('user','admin','superadmin')`),
  check('afilli_auth_accounts_email_check', sql`${t.email} = lower(trim(${t.email}))`),
]);
export const authSessions = pgTable('afilli_auth_sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull(),
  accessMode: text('access_mode').notNull().default('normal'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ name: 'afilli_auth_sessions_user_id_fkey', columns: [t.userId], foreignColumns: [authAccounts.userId] }),
  index('afilli_auth_sessions_user').on(t.userId),
  // The constraint was broadened after disabled-account appeals already used
  // the earlier normal/appeal check; a new name makes Drizzle replace it.
  check('afilli_auth_sessions_access_mode_contact', sql`${t.accessMode} IN ('normal','appeal','contact')`),
]);
export const authCodes = pgTable('afilli_auth_codes', {
  id: uuid('id').primaryKey(), userId: text('user_id').notNull(),
  codeHash: text('code_hash').notNull(), attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, t => [
  foreignKey({ name: 'afilli_auth_codes_user_id_fkey', columns: [t.userId], foreignColumns: [authAccounts.userId] }),
]);
export const authLimits = pgTable('afilli_auth_limits', {
  key: text('key').primaryKey(), count: integer('count').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const authMigrationState = pgTable('afilli_auth_migration', {
  id: text('id').primaryKey(), complete: boolean('complete').notNull().default(false),
});
export const insertAuthAccountSchema = createInsertSchema(authAccounts);
export type AuthAccount = typeof authAccounts.$inferSelect;
