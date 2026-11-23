import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, bigserial, foreignKey, unique, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { authoredBooks, communityUsers } from './community';
import { writerCommentNodes } from './writer';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod/v4';

export const readerParagraphs = pgTable('reader_paragraphs', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id').notNull(), contentKey: text('content_key').notNull(), quote: text('quote').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('reader_paragraphs_identity').on(t.bookId, t.chapterId, t.contentKey),
  foreignKey({ name: 'reader_paragraphs_book_id_fkey', columns: [t.bookId], foreignColumns: [authoredBooks.id] }).onDelete('cascade')]);
export const readerCommentTargets = pgTable('reader_comment_targets', {
  commentId: uuid('comment_id').primaryKey(),
  paragraphId: uuid('paragraph_id').notNull(),
}, t => [index('reader_comment_targets_paragraph').on(t.paragraphId, t.commentId),
  foreignKey({ name: 'reader_comment_targets_comment_id_fkey', columns: [t.commentId], foreignColumns: [writerCommentNodes.id] }).onDelete('cascade'),
  foreignKey({ name: 'reader_comment_targets_paragraph_id_fkey', columns: [t.paragraphId], foreignColumns: [readerParagraphs.id] }).onDelete('cascade')]);
export const readerLikes = pgTable('reader_likes', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id').notNull(),
  paragraphId: uuid('paragraph_id'),
  userId: text('user_id').notNull(),
}, t => [
  uniqueIndex('reader_chapter_like_once').on(t.bookId, t.chapterId, t.userId).where(sql`${t.paragraphId} IS NULL`),
  uniqueIndex('reader_paragraph_like_once').on(t.paragraphId, t.userId).where(sql`${t.paragraphId} IS NOT NULL`),
  foreignKey({ name: 'reader_likes_book_id_fkey', columns: [t.bookId], foreignColumns: [authoredBooks.id] }).onDelete('cascade'),
  foreignKey({ name: 'reader_likes_paragraph_id_fkey', columns: [t.paragraphId], foreignColumns: [readerParagraphs.id] }).onDelete('cascade'),
  foreignKey({ name: 'reader_likes_user_id_fkey', columns: [t.userId], foreignColumns: [communityUsers.id] }).onDelete('cascade'),
]);
export const readerCommentEvents = pgTable('reader_comment_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: text('user_id').notNull(),
  bodyHash: text('body_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('reader_comment_events_owner').on(t.userId, t.createdAt), index('reader_comment_events_age').on(t.createdAt),
  foreignKey({ name: 'reader_comment_events_user_id_fkey', columns: [t.userId], foreignColumns: [communityUsers.id] }).onDelete('cascade')]);
export const readerReports = pgTable('reader_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  commentId: uuid('comment_id').notNull(),
  reporterId: text('reporter_id').notNull(),
  reason: text('reason').notNull(), details: text('details').notNull().default(''), status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('reader_reports_once').on(t.commentId, t.reporterId),
  foreignKey({ name: 'reader_reports_comment_id_fkey', columns: [t.commentId], foreignColumns: [writerCommentNodes.id] }).onDelete('cascade'),
  foreignKey({ name: 'reader_reports_reporter_id_fkey', columns: [t.reporterId], foreignColumns: [communityUsers.id] }).onDelete('cascade'),
  index('reader_reports_inbox').on(t.status, t.createdAt, t.id),
  check('reader_report_reason', sql`${t.reason} IN ('spam','abuse','other')`),
  check('reader_report_status', sql`${t.status} IN ('pending','dismissed','hidden')`)]);

export const insertReaderParagraphSchema = createInsertSchema(readerParagraphs).omit({ id: true, createdAt: true });
export const insertReaderCommentTargetSchema = createInsertSchema(readerCommentTargets);
export const insertReaderLikeSchema = createInsertSchema(readerLikes).omit({ id: true });
export const insertReaderCommentEventSchema = createInsertSchema(readerCommentEvents).omit({ id: true, createdAt: true });
export const insertReaderReportSchema = createInsertSchema(readerReports).omit({ id: true, createdAt: true });
export type InsertReaderParagraph = z.infer<typeof insertReaderParagraphSchema>;
export type InsertReaderCommentTarget = z.infer<typeof insertReaderCommentTargetSchema>;
export type InsertReaderLike = z.infer<typeof insertReaderLikeSchema>;
export type InsertReaderCommentEvent = z.infer<typeof insertReaderCommentEventSchema>;
export type InsertReaderReport = z.infer<typeof insertReaderReportSchema>;
