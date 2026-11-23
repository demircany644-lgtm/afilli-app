-- Additive, rerunnable migration. Does not rewrite books, comments or users.
-- Apply to the target database before deploying code that uses these tables.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('afilli-reader-interactions-schema'));
CREATE TABLE IF NOT EXISTS reader_paragraphs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES authored_books(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL,
  content_key text NOT NULL,
  quote text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reader_paragraphs_identity UNIQUE(book_id, chapter_id, content_key)
);
CREATE TABLE IF NOT EXISTS reader_comment_targets (
  comment_id uuid PRIMARY KEY REFERENCES writer_comment_nodes(id) ON DELETE CASCADE,
  paragraph_id uuid NOT NULL REFERENCES reader_paragraphs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS reader_comment_targets_paragraph ON reader_comment_targets(paragraph_id, comment_id);
CREATE TABLE IF NOT EXISTS reader_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES authored_books(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL,
  paragraph_id uuid REFERENCES reader_paragraphs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES community_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS reader_chapter_like_once ON reader_likes(book_id, chapter_id, user_id) WHERE paragraph_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reader_paragraph_like_once ON reader_likes(paragraph_id, user_id) WHERE paragraph_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS reader_comment_events (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
  body_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reader_comment_events_owner ON reader_comment_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS reader_comment_events_age ON reader_comment_events(created_at);
CREATE TABLE IF NOT EXISTS reader_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES writer_comment_nodes(id) ON DELETE CASCADE,
  reporter_id text NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
  reason text NOT NULL CONSTRAINT reader_report_reason CHECK (reason IN ('spam','abuse','other')),
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CONSTRAINT reader_report_status CHECK (status IN ('pending','dismissed','hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reader_reports_once UNIQUE(comment_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS reader_reports_inbox ON reader_reports(status, created_at, id);
COMMIT;
