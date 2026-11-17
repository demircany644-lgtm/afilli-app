import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { communityUsers } from './community';

export const authAccounts = pgTable('afilli_auth_accounts', {
  userId: text('user_id').primaryKey().references(() => communityUsers.id),
  email: text('email').notNull().unique('afilli_auth_accounts_email_key'), passwordHash: text('password_hash'),
  emailVerified: boolean('email_verified').notNull().default(false),
  role: text('role').notNull().default('user'), disabled: boolean('disabled').notNull().default(false),
  migrated: boolean('migrated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check('afilli_auth_accounts_supported_role', sql`${t.role} IN ('user','admin','superadmin')`),
  check('afilli_auth_accounts_email_check', sql`${t.email} = lower(trim(${t.email}))`),
]);
export const authSessions = pgTable('afilli_auth_sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => authAccounts.userId),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const authCodes = pgTable('afilli_auth_codes', {
  id: uuid('id').primaryKey(), userId: text('user_id').notNull().references(() => authAccounts.userId),
  codeHash: text('code_hash').notNull(), attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});
export const authLimits = pgTable('afilli_auth_limits', {
  key: text('key').primaryKey(), count: integer('count').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const authMigrationState = pgTable('afilli_auth_migration', {
  id: text('id').primaryKey(), complete: boolean('complete').notNull().default(false),
});
export const insertAuthAccountSchema = createInsertSchema(authAccounts);
export type AuthAccount = typeof authAccounts.$inferSelect;
