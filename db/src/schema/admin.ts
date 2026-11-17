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
