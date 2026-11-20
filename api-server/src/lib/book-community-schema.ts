import { pool } from '@workspace/db';

// Drizzle can create tables/columns, but cannot install this custom trigger.
// Never accept production traffic with a half-applied comment migration.
export async function assertBookCommunitySchema(db: Pick<typeof pool, 'query'> = pool) {
  const { rows } = await db.query(`SELECT
    to_regclass('writer_comment_nodes') IS NOT NULL AND to_regclass('writer_comment_reactions') IS NOT NULL
    AND to_regclass('book_subscriptions') IS NOT NULL AND to_regclass('notified_book_chapters') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='writer_comments' AND column_name='parent_id')
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='social_notifications' AND column_name='comment_id')
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='social_notifications' AND column_name='chapter_id')
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('writer_comments') AND tgname='writer_comment_node_sync' AND tgenabled<>'D') AS ok`);
  if (!rows[0]?.ok) throw new Error('Book discussion release blocked: the complete tools/book-community.sql migration, including its moderation/deletion trigger, must be applied before release.');
}
