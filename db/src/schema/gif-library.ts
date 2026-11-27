import { pgTable, uuid, text, integer, boolean, timestamp, unique, index, foreignKey } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { communityUsers } from './community';

// Official shared assets intentionally survive deletion of their uploader.
export const gifLibrary = pgTable('gif_library', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id'),
  clientId: uuid('client_id').notNull(),
  title: text('title').notNull(),
  objectPath: text('object_path').notNull(),
  size: integer('size').notNull(),
  ready: boolean('ready').notNull().default(false),
  width: integer('width').notNull().default(0),
  height: integer('height').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique('gif_library_owner_client').on(t.ownerId, t.clientId),
  index('gif_library_order').on(t.ready, t.createdAt, t.id),
  foreignKey({ name: 'gif_library_owner_id_fkey', columns: [t.ownerId], foreignColumns: [communityUsers.id] }).onDelete('set null'),
]);
export const insertGifLibrarySchema = createInsertSchema(gifLibrary).omit({ id: true, createdAt: true });
export type LibraryGif = typeof gifLibrary.$inferSelect;
