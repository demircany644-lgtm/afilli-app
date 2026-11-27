import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { communityUsers } from './community';

export const prohibitedImageReferences = pgTable('prohibited_image_references', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdBy: text('created_by').references(() => communityUsers.id, { onDelete: 'set null' }),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  hashes: text('hashes').array().notNull().default(sql`'{}'::text[]`),
  ready: boolean('ready').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('prohibited_image_references_created').on(t.createdAt, t.id),
  check('prohibited_image_reference_size', sql`${t.size} BETWEEN 1 AND 10485760`),
]);

export const prohibitedImageAttempts = pgTable('prohibited_image_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => communityUsers.id, { onDelete: 'set null' }),
  referenceId: uuid('reference_id').references(() => prohibitedImageReferences.id, { onDelete: 'set null' }),
  area: text('area').notNull(),
  evidencePath: text('evidence_path').notNull(),
  distance: integer('distance').notNull(),
  threshold: integer('threshold').notNull(),
  autoBlockApplied: boolean('auto_block_applied').notNull().default(false),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: text('decided_by').references(() => communityUsers.id, { onDelete: 'set null' }),
  decisionReason: text('decision_reason'),
}, (t) => [
  index('prohibited_image_attempts_status_created').on(t.status, t.createdAt, t.id),
  index('prohibited_image_attempts_user').on(t.userId, t.createdAt),
  check('prohibited_image_attempt_area', sql`${t.area} IN ('profile','bulletin','book','private_message')`),
  check('prohibited_image_attempt_status', sql`${t.status} IN ('pending','confirmed','released')`),
  check('prohibited_image_attempt_distance', sql`${t.distance} BETWEEN 0 AND 64 AND ${t.threshold} BETWEEN 0 AND 64`),
]);

export const prohibitedImageContactMessages = pgTable('prohibited_image_contact_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  attemptId: uuid('attempt_id').notNull().references(() => prohibitedImageAttempts.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => communityUsers.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [
  index('prohibited_image_contact_attempt_created').on(t.attemptId, t.createdAt, t.id),
  check('prohibited_image_contact_body_length', sql`length(trim(${t.body})) BETWEEN 1 AND 2000`),
]);
