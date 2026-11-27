import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authAccounts } from './auth';
import { communityUsers } from './community';

export const accountAppeals = pgTable('account_appeals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => authAccounts.userId, { onDelete: 'cascade' }),
  productIdentifier: text('product_identifier').notNull(),
  packageIdentifier: text('package_identifier').notNull(),
  platform: text('platform').notNull(),
  transactionId: text('transaction_id').notNull(),
  paymentStatus: text('payment_status').notNull().default('verified'),
  paymentVerifiedAt: timestamp('payment_verified_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('pending'),
  blockReason: text('block_reason').notNull(),
  blockedAt: timestamp('blocked_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: text('decided_by').references(() => communityUsers.id, { onDelete: 'set null' }),
  decisionReason: text('decision_reason'),
}, t => [
  uniqueIndex('account_appeals_transaction_unique').on(t.transactionId),
  uniqueIndex('account_appeals_one_pending_per_user').on(t.userId).where(sql`${t.status}='pending'`),
  index('account_appeals_queue').on(t.status, t.createdAt, t.id),
  index('account_appeals_user_created').on(t.userId, t.createdAt),
  check('account_appeals_platform', sql`${t.platform} IN ('ios','android')`),
  check('account_appeals_payment_status', sql`${t.paymentStatus}='verified'`),
  check('account_appeals_status', sql`${t.status} IN ('pending','approved','rejected')`),
]);
