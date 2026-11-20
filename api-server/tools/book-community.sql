BEGIN;
CREATE TABLE IF NOT EXISTS writer_comment_nodes(
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES authored_books(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES writer_comment_nodes(id) ON DELETE CASCADE,
  chapter_id uuid,
  moderation_hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE writer_comments ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES writer_comment_nodes(id);
INSERT INTO writer_comment_nodes(id,book_id,chapter_id,moderation_hidden,created_at)
  SELECT id,book_id,chapter_id,moderation_hidden,created_at FROM writer_comments ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='writer_comments'::regclass AND conname='writer_comments_node_fk') THEN
    ALTER TABLE writer_comments ADD CONSTRAINT writer_comments_node_fk FOREIGN KEY(id) REFERENCES writer_comment_nodes(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS writer_comment_nodes_page ON writer_comment_nodes(book_id,parent_id,created_at,id);
-- Covers old clients/test fixtures too; moderation state remains after the
-- author's content row is erased, so deletion cannot unhide a hidden subtree.
CREATE OR REPLACE FUNCTION sync_writer_comment_node() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO writer_comment_nodes(id,book_id,parent_id,chapter_id,moderation_hidden,created_at)
      VALUES(NEW.id,NEW.book_id,NEW.parent_id,NEW.chapter_id,NEW.moderation_hidden,NEW.created_at)
      ON CONFLICT DO NOTHING;
  ELSE
    UPDATE writer_comment_nodes SET moderation_hidden=NEW.moderation_hidden WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS writer_comment_node_sync ON writer_comments;
CREATE TRIGGER writer_comment_node_sync BEFORE INSERT OR UPDATE OF moderation_hidden ON writer_comments
  FOR EACH ROW EXECUTE FUNCTION sync_writer_comment_node();
CREATE TABLE IF NOT EXISTS writer_comment_reactions(
  comment_id uuid NOT NULL REFERENCES writer_comments(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
  reaction text NOT NULL CONSTRAINT writer_comment_reaction_kind CHECK(reaction IN ('like','love')),
  PRIMARY KEY(comment_id,user_id)
);
CREATE TABLE IF NOT EXISTS book_subscriptions(
  book_id uuid NOT NULL REFERENCES authored_books(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(book_id,user_id)
);
CREATE TABLE IF NOT EXISTS notified_book_chapters(
  book_id uuid NOT NULL REFERENCES authored_books(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL,
  PRIMARY KEY(book_id,chapter_id)
);
-- Existing released chapters are a baseline, not newly published chapters.
INSERT INTO notified_book_chapters(book_id,chapter_id)
  SELECT b.id,(c->>'id')::uuid FROM authored_books b,
  jsonb_array_elements(coalesce(b.published_data->'chapters','[]'::jsonb)) c
  ON CONFLICT DO NOTHING;
ALTER TABLE social_notifications ADD COLUMN IF NOT EXISTS comment_id uuid REFERENCES writer_comment_nodes(id) ON DELETE CASCADE;
ALTER TABLE social_notifications ADD COLUMN IF NOT EXISTS chapter_id uuid;
COMMIT;
