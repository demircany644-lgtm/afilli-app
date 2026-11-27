import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, timestamp, integer, boolean, primaryKey, index, check, unique } from 'drizzle-orm/pg-core';
import { communityUsers } from './community';

export const storeSettings = pgTable('store_settings', {
  id: boolean('id').primaryKey().default(true),
  active: boolean('active').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  updatedBy: text('updated_by').references(() => communityUsers.id, { onDelete: 'set null' }),
}, (t) => [check('store_settings_singleton', sql`${t.id} = true`)]);

export const storeProducts = pgTable('store_products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  productType: text('product_type').notNull(),
  sizeLabel: text('size_label').notNull(),
  priceKurus: integer('price_kurus').notNull(),
  imageKey: text('image_key').notNull(),
  displayOrder: integer('display_order').notNull().default(1000),
  createdBy: text('created_by').references(() => communityUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('store_products_image_key').on(t.imageKey),
  index('store_products_category_order').on(t.category, t.displayOrder, t.createdAt, t.id),
  check('store_products_category', sql`${t.category} IN ('perfume','accessory','gift','other')`),
  check('store_products_price', sql`${t.priceKurus} BETWEEN 0 AND 100000000`)]);

export const storeProductUploads = pgTable('store_product_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').references(() => communityUsers.id, { onDelete: 'set null' }),
  clientId: uuid('client_id').notNull(),
  objectPath: text('object_path').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  ready: boolean('ready').notNull().default(false),
  width: integer('width').notNull().default(0),
  height: integer('height').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('store_product_upload_owner_client').on(t.ownerId, t.clientId),
  index('store_product_upload_owner_created').on(t.ownerId, t.createdAt, t.id),
  check('store_product_upload_content_type', sql`${t.contentType} IN ('image/jpeg','image/png','image/webp')`),
  check('store_product_upload_size', sql`${t.size} BETWEEN 1 AND 10485760`)]);

export const storeCartItems = pgTable('store_cart_items', {
  userId: text('user_id').notNull().references(() => communityUsers.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  quantity: integer('quantity').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.productId] }),
  index('store_cart_user_updated').on(t.userId, t.updatedAt),
  check('store_cart_quantity', sql`${t.quantity} BETWEEN 1 AND 99`)]);

export const storeOrders = pgTable('store_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => communityUsers.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  totalKurus: integer('total_kurus').notNull(),
  decisionNote: text('decision_note'),
  decision: text('decision'),
  decidedBy: text('decided_by').references(() => communityUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('store_orders_queue').on(t.status, t.createdAt, t.id),
  index('store_orders_user_created').on(t.userId, t.createdAt, t.id),
  check('store_order_status', sql`${t.status} IN ('pending','payment_pending','approved_free','rejected')`),
  check('store_order_total_nonnegative', sql`${t.totalKurus} >= 0`),
  check('store_order_decision', sql`${t.decision} IS NULL OR ${t.decision} IN ('paid','free','reject','pending')`)]);

export const storeOrderItems = pgTable('store_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => storeOrders.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  productType: text('product_type').notNull(),
  sizeLabel: text('size_label').notNull(),
  priceKurus: integer('price_kurus').notNull(),
  imageKey: text('image_key').notNull(),
  quantity: integer('quantity').notNull(),
}, (t) => [index('store_order_items_order').on(t.orderId, t.id),
  check('store_order_item_category', sql`${t.category} IN ('perfume','accessory','gift','other')`),
  check('store_order_item_price', sql`${t.priceKurus} >= 0`),
  check('store_order_item_quantity', sql`${t.quantity} BETWEEN 1 AND 99`)]);
