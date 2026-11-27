import { pgTable, uuid, text, timestamp, boolean, integer, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { communityUsers } from './community';

// Artwork metadata, not a parallel payment catalog. All access uses existing Premium.
export const visualAssets = pgTable('visual_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  month: text('month').notNull(),
  objectPath: text('object_path').notNull(),
  contentType: text('content_type').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  ready: boolean('ready').notNull().default(false),
  published: boolean('published').notNull().default(false),
  uploadSize: integer('upload_size'),
  uploadedBy: text('uploaded_by').references(() => communityUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('visual_assets_category_month').on(t.category, t.month),
  check('visual_asset_category', sql`${t.category} IN ('frame','background','badge','effect','book_frame','divider','signature','banner','animation')`),
  check('visual_asset_content_type', sql`${t.contentType} IN ('image/png','image/webp','image/gif')`),
]);
export const visualCollectionItems = pgTable('visual_collection_items', {
  userId: text('user_id').notNull().references(() => communityUsers.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').notNull().references(() => visualAssets.id),
  savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.assetId] })]);
export const visualSelections = pgTable('visual_selections', {
  userId: text('user_id').notNull().references(() => communityUsers.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  targetId: text('target_id').notNull().default('profile'),
  assetId: uuid('asset_id').references(() => visualAssets.id),
  caption: text('caption').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.category, t.targetId] })]);
