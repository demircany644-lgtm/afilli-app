import { pgTable, text, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { authoredBooks, communityUsers } from './community';
export const bookReadingPositions = pgTable('book_reading_positions', {
  readerId: text('reader_id').notNull().references(() => communityUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  chapterId: uuid('chapter_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.readerId, t.bookId] })]);
