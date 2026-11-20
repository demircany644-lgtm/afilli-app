CREATE TABLE IF NOT EXISTS book_reading_positions (
  reader_id text NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES authored_books(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(reader_id, book_id)
);
