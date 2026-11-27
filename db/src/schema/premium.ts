import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { communityUsers } from './community';

export const premiumApplications = pgTable('premium_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => communityUsers.id, { onDelete: 'cascade' }),
  packageId: text('package_id').notNull(),
  packageIdentifier: text('package_identifier').notNull(),
  productId: text('product_id').notNull(),
  productIdentifier: text('product_identifier').notNull(),
  planName: text('plan_name').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: text('decided_by').references(() => communityUsers.id, { onDelete: 'set null' }),
  decision: text('decision'),
}, (t) => [
  index('premium_applications_user_created').on(t.userId, t.createdAt),
  index('premium_applications_queue').on(t.status, t.createdAt),
  uniqueIndex('premium_application_one_open_per_user').on(t.userId)
    .where(sql`${t.status} IN ('pending','paid_approved')`),
  check('premium_application_status', sql`${t.status} IN ('pending','paid_approved','active','rejected','expired')`),
  check('premium_application_decision', sql`${t.decision} IS NULL OR ${t.decision} IN ('paid','free','reject')`),
]);

export const premiumMemberships = pgTable('premium_memberships', {
  userId: text('user_id').primaryKey().references(() => communityUsers.id, { onDelete: 'cascade' }),
  applicationId: uuid('application_id').notNull().unique().references(() => premiumApplications.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  status: text('status').notNull().default('active'),
  productId: text('product_id'),
  productIdentifier: text('product_identifier'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  grantedBy: text('granted_by').references(() => communityUsers.id, { onDelete: 'set null' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  index('premium_membership_active_expiry').on(t.status, t.expiresAt),
  check('premium_membership_source', sql`${t.source} IN ('free','paid')`),
  check('premium_membership_status', sql`${t.status} IN ('active','revoked','expired')`),
  check('premium_membership_grant', sql`(${t.source}='free' AND ${t.expiresAt} IS NULL) OR (${t.source}='paid' AND ${t.expiresAt} IS NOT NULL)`),
]);

export const premiumStylePreferences = pgTable('premium_style_preferences', {
  userId: text('user_id').primaryKey().references(() => communityUsers.id, { onDelete: 'cascade' }),
  profileFrame: text('profile_frame').notNull().default('classic'),
  profileBackground: text('profile_background').notNull().default('classic'),
  chatEffect: text('chat_effect').notNull().default('none'),
  storeDesign: text('store_design').notNull().default('classic'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('premium_profile_frame', sql`${t.profileFrame} IN ('classic','gold','rose','midnight')`),
  check('premium_profile_background', sql`${t.profileBackground} IN ('classic','linen','wine','starlight')`),
  check('premium_chat_effect', sql`${t.chatEffect} IN ('none','gold','rose','violet')`),
  check('premium_store_design', sql`${t.storeDesign} IN ('classic','gold','wine','night')`),
]);
