import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, timestamp, integer, boolean, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { authoredBooks, communityUsers } from './community';

export const bookPromotionSettings = pgTable('book_promotion_settings', {
  id: boolean('id').primaryKey().default(true),
  enabled: boolean('enabled').notNull().default(true),
  allowedDurations: integer('allowed_durations').array().notNull().default(sql`ARRAY[3,7,15,30]::integer[]`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').references(() => communityUsers.id, { onDelete: 'set null' }),
}, (t) => [
  check('book_promotion_settings_id', sql`${t.id}=true`),
  check('book_promotion_duration_values', sql`cardinality(${t.allowedDurations}) BETWEEN 1 AND 4
    AND ${t.allowedDurations} <@ ARRAY[3,7,15,30]::integer[]`),
]);

export const bookPromotionRequests = pgTable('book_promotion_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').references(() => authoredBooks.id, { onDelete: 'set null' }),
  authorId: text('author_id').references(() => communityUsers.id, { onDelete: 'set null' }),
  clientRequestId: uuid('client_request_id').notNull(),
  bookTitle: text('book_title').notNull(),
  coverSnapshot: text('cover_snapshot'),
  authorNickname: text('author_nickname').notNull(),
  authorAvatar: text('author_avatar'),
  durationDays: integer('duration_days').notNull(),
  status: text('status').notNull().default('pending'),
  decision: text('decision'),
  decisionNote: text('decision_note'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: text('decided_by').references(() => communityUsers.id, { onDelete: 'set null' }),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('book_promotion_author_request_id').on(t.authorId, t.clientRequestId),
  uniqueIndex('book_promotion_one_open_per_book').on(t.bookId)
    .where(sql`${t.bookId} IS NOT NULL AND ${t.status} IN ('pending','active')`),
  index('book_promotion_requests_queue').on(t.status, t.requestedAt, t.id),
  index('book_promotion_requests_author').on(t.authorId, t.requestedAt, t.id),
  index('book_promotion_requests_expiry').on(t.status, t.expiresAt),
  check('book_promotion_duration', sql`${t.durationDays} IN (3,7,15,30)`),
  check('book_promotion_status', sql`${t.status} IN ('pending','active','rejected','expired')`),
  check('book_promotion_decision', sql`${t.decision} IS NULL OR ${t.decision} IN ('free','reject')`),
  check('book_promotion_dates', sql`(${t.status} <> 'active') OR (${t.startsAt} IS NOT NULL AND ${t.expiresAt} IS NOT NULL)`),
]);
