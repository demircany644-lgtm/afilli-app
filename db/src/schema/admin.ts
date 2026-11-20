import { pgTable, text, uuid, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

// Immutable through the application: no update/delete routes. Do not put
// passwords, recovery codes, session tokens or private message bodies here.
export const adminAudit = pgTable('admin_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  reason: text('reason').notNull(),
  changes: jsonb('changes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('admin_audit_order').on(t.createdAt, t.id)]);
export const insertAdminAuditSchema = createInsertSchema(adminAudit);
export type AdminAudit = typeof adminAudit.$inferSelect;

// No user FK: the account is already gone when storage removal is retried.
// The delay lets previously issued upload URLs expire before removing bytes.
export const accountMediaDeletions = pgTable('account_media_deletions', {
  kind: text('kind').notNull(),
  mediaId: uuid('media_id').primaryKey(),
  eligibleAt: timestamp('eligible_at', { withTimezone: true }).notNull(),
}, t => [index('account_media_deletions_due').on(t.eligibleAt)]);
