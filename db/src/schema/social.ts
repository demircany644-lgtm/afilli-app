import { sql } from 'drizzle-orm';
import { pgTable, pgSequence, text, uuid, timestamp, date, integer, bigint, jsonb, boolean, primaryKey, uniqueIndex, index, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { communityUsers, authoredBooks } from './community';
import { writerCommentNodes } from './writer';
import { premiumApplications } from './premium';

export const socialSettings = pgTable('social_settings', {
  id: boolean('id').primaryKey().default(true),
  // Historical column name retained to preserve existing rows. Only the
  // centrally configured, canonical Instagram URL is written here now.
  instagramHandle: text('instagram_handle'),
  facebookUrl: text('facebook_url'), xUrl: text('x_url'),
  popularDays: integer('popular_days').notNull().default(30),
  popularLimit: integer('popular_limit').notNull().default(10),
}, (t) => [check('social_settings_singleton', sql`${t.id} = true`)]);
export const adminBootstrapGrants = pgTable('admin_bootstrap_grants', {
  identifierHash: text('identifier_hash').primaryKey(),
  userId: text('user_id').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
});
export const profileFollows = pgTable('profile_follows', {
  followerId: text('follower_id').notNull().references(() => communityUsers.id),
  followedId: text('followed_id').notNull().references(() => communityUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.followerId, t.followedId] }),
  index('profile_followed_index').on(t.followedId, t.followerId),
  check('profile_follow_no_self', sql`${t.followerId} <> ${t.followedId}`)]);
export const profileUploads = pgTable('profile_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().references(() => communityUsers.id),
  purpose: text('purpose').notNull(), contentType: text('content_type').notNull(), size: integer('size').notNull(),
  sourceUpload: boolean('source_upload').notNull().default(false), sealed: boolean('sealed').notNull().default(false),
  attached: boolean('attached').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('profile_upload_purpose', sql`${t.purpose} IN ('avatar','cover')`)]);
export const bookReads = pgTable('book_reads', {
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  readerId: text('reader_id').notNull().references(() => communityUsers.id),
  day: date('day').notNull().default(sql`CURRENT_DATE`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.bookId, t.readerId, t.day] }), index('book_reads_recent').on(t.createdAt)]);
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userLow: text('user_low').notNull().references(() => communityUsers.id),
  userHigh: text('user_high').notNull().references(() => communityUsers.id),
  lowTypingUntil: timestamp('low_typing_until', { withTimezone: true }),
  highTypingUntil: timestamp('high_typing_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('conversation_pair_unique').on(t.userLow, t.userHigh),
  check('conversation_pair_order', sql`${t.userLow} < ${t.userHigh}`)]);
export const directMessageChangeSequence = pgSequence('direct_message_change_seq');
export const directMessageUploads = pgTable('direct_message_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').references(() => conversations.id, { onDelete: 'set null' }),
  ownerId: text('owner_id').references(() => communityUsers.id, { onDelete: 'set null' }),
  clientId: uuid('client_id').notNull(), size: integer('size').notNull(),
  ready: boolean('ready').notNull().default(false),
  width: integer('width'), height: integer('height'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sourcePutUntil: timestamp('source_put_until', { withTimezone: true }).notNull().default(sql`now()+interval '16 minutes'`),
  attachedAt: timestamp('attached_at', { withTimezone: true }),
  deleteRequestedAt: timestamp('delete_requested_at', { withTimezone: true }),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
}, t => [uniqueIndex('direct_upload_retry').on(t.threadId, t.ownerId, t.clientId),
  index('direct_upload_cleanup').on(t.deleteRequestedAt, t.purgedAt),
  check('direct_upload_size', sql`${t.size} BETWEEN 1 AND 2097152`)]);
export const directMessages = pgTable('direct_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderId: text('sender_id').notNull().references(() => communityUsers.id),
  clientId: uuid('client_id').notNull(), body: text('body').notNull(),
  sequence: bigint('sequence', { mode: 'bigint' }).generatedByDefaultAsIdentity().notNull(),
  payloadHash: text('payload_hash'),
  replyToId: uuid('reply_to_id').references((): AnyPgColumn => directMessages.id, { onDelete: 'set null' }),
  hasReply: boolean('has_reply').notNull().default(false),
  gif: jsonb('gif'),
  photoId: uuid('photo_id').references(() => directMessageUploads.id),
  changeSequence: bigint('change_sequence', { mode: 'bigint' }).notNull().default(sql`nextval('direct_message_change_seq')`),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  mediaExpiredAt: timestamp('media_expired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [uniqueIndex('message_idempotency').on(t.threadId, t.senderId, t.clientId),
  index('message_thread_order').on(t.threadId, t.createdAt, t.id),
  uniqueIndex('message_sequence_unique').on(t.sequence),
  index('message_thread_sequence').on(t.threadId, t.sequence),
  index('message_thread_changes').on(t.threadId, t.changeSequence),
  index('message_quote_target').on(t.replyToId),
  uniqueIndex('message_photo_once').on(t.photoId),
  check('message_nonempty_limit', sql`length(trim(${t.body})) <= 4000 AND (length(trim(${t.body})) > 0 OR ${t.gif} IS NOT NULL OR ${t.photoId} IS NOT NULL OR ${t.deletedAt} IS NOT NULL OR ${t.mediaExpiredAt} IS NOT NULL)`)]);
export const socialNotifications = pgTable('social_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: text('recipient_id').notNull().references(() => communityUsers.id),
  actorId: text('actor_id').notNull().references(() => communityUsers.id),
  kind: text('kind').notNull(), eventKey: text('event_key').notNull(),
  threadId: uuid('thread_id').references(() => conversations.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').references(() => authoredBooks.id, { onDelete: 'cascade' }),
  commentId: uuid('comment_id').references(() => writerCommentNodes.id, { onDelete: 'cascade' }),
  chapterId: uuid('chapter_id'),
  applicationId: uuid('application_id').references(() => premiumApplications.id, { onDelete: 'cascade' }),
  notificationBody: text('notification_body'),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('social_notification_event').on(t.recipientId, t.eventKey)]);
