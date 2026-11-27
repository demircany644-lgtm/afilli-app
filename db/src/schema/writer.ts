import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, integer, boolean, timestamp, date, primaryKey, uniqueIndex, index, check, foreignKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { authoredBooks, communityUsers } from './community';

export const writerUploads = pgTable('writer_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().references(() => communityUsers.id),
  contentType: text('content_type').notNull(), size: integer('size').notNull(),
  ready: boolean('ready').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // NULL is an indefinite initial offline reservation, including pre-existing uploads.
  releasedAt: timestamp('released_at', { withTimezone: true }),
  orphanedAt: timestamp('orphaned_at', { withTimezone: true }),
  deletingAt: timestamp('deleting_at', { withTimezone: true }),
});
export const writerMediaReservations = pgTable('writer_media_reservations', {
  mediaId: uuid('media_id').notNull().references(() => writerUploads.id, { onDelete: 'cascade' }),
  reservationId: uuid('reservation_id').notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
}, t => [primaryKey({ columns: [t.mediaId, t.reservationId] })]);
export const writerMediaRefs = pgTable('writer_media_refs', {
  mediaId: uuid('media_id').notNull().references(() => writerUploads.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
}, t => [primaryKey({ columns: [t.mediaId, t.bookId, t.version] }),
  check('writer_media_version', sql`${t.version} IN ('draft','published')`)]);
export const writerLikes = pgTable('writer_likes', {
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => communityUsers.id),
}, t => [primaryKey({ columns: [t.bookId, t.userId] })]);
export const writerBookCopies = pgTable('writer_book_copies', {
  ownerId: text('owner_id').notNull(),
  sourceBookId: uuid('source_book_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  copyBookId: uuid('copy_book_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.ownerId, t.sourceBookId, t.clientRequestId] }),
  foreignKey({ name: 'writer_book_copies_owner_id_fkey', columns: [t.ownerId], foreignColumns: [communityUsers.id] }).onDelete('cascade'),
  foreignKey({ name: 'writer_book_copies_source_book_id_fkey', columns: [t.sourceBookId], foreignColumns: [authoredBooks.id] }).onDelete('cascade'),
  foreignKey({ name: 'writer_book_copies_copy_book_id_fkey', columns: [t.copyBookId], foreignColumns: [authoredBooks.id] }).onDelete('set null'),
]);
// Thread structure survives content/account deletion, without keeping author,
// body or client id. A deleted parent must not delete another reader's replies.
export const writerCommentNodes = pgTable('writer_comment_nodes', {
  id: uuid('id').primaryKey(),
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => writerCommentNodes.id, { onDelete: 'cascade' }),
  chapterId: uuid('chapter_id'),
  moderationHidden: boolean('moderation_hidden').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('writer_comment_nodes_page').on(t.bookId, t.parentId, t.createdAt, t.id)]);
export const writerComments = pgTable('writer_comments', {
  id: uuid('id').primaryKey().defaultRandom().references(() => writerCommentNodes.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => communityUsers.id),
  clientId: uuid('client_id').notNull(), chapterId: uuid('chapter_id'),
  parentId: uuid('parent_id').references(() => writerCommentNodes.id),
  body: text('body').notNull(),
  moderationHidden: boolean('moderation_hidden').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('writer_comment_idempotency').on(t.bookId, t.authorId, t.clientId)]);
export const writerCommentReactions = pgTable('writer_comment_reactions', {
  commentId: uuid('comment_id').notNull().references(() => writerComments.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => communityUsers.id, { onDelete: 'cascade' }),
  reaction: text('reaction').notNull(),
}, t => [primaryKey({ columns: [t.commentId, t.userId] }),
  check('writer_comment_reaction_kind', sql`${t.reaction} IN ('like','love')`)]);
export const bookSubscriptions = pgTable('book_subscriptions', {
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => communityUsers.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.bookId, t.userId] })]);
export const notifiedBookChapters = pgTable('notified_book_chapters', {
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  chapterId: uuid('chapter_id').notNull(),
}, t => [primaryKey({ columns: [t.bookId, t.chapterId] })]);
export const writerVoiceUsage = pgTable('writer_voice_usage', {
  userId: text('user_id').notNull().references(() => communityUsers.id),
  day: date('day').notNull().default(sql`CURRENT_DATE`),
  seconds: integer('seconds').notNull().default(0),
}, t => [primaryKey({ columns: [t.userId, t.day] })]);
export const writerVoiceRequests = pgTable('writer_voice_requests', {
  id: uuid('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => communityUsers.id),
  audioHash: text('audio_hash'), status: text('status').notNull(),
  text: text('text'), seconds: integer('seconds').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resultExpiresAt: timestamp('result_expires_at', { withTimezone: true }),
});
export const writerBookDeletions = pgTable('writer_book_deletions', {
  bookId: uuid('book_id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => communityUsers.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
});
