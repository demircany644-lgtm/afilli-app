-- Additive, rerunnable migration for owner-authorized copy idempotency.
-- This records only copy requests; it does not copy or rewrite book interactions.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('afilli-writer-book-copies-schema'));
CREATE TABLE IF NOT EXISTS writer_book_copies (
  owner_id text NOT NULL,
  source_book_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  copy_book_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT writer_book_copies_pkey PRIMARY KEY(owner_id, source_book_id, client_request_id),
  CONSTRAINT writer_book_copies_owner_id_fkey FOREIGN KEY(owner_id) REFERENCES community_users(id) ON DELETE CASCADE,
  CONSTRAINT writer_book_copies_source_book_id_fkey FOREIGN KEY(source_book_id) REFERENCES authored_books(id) ON DELETE CASCADE,
  CONSTRAINT writer_book_copies_copy_book_id_fkey FOREIGN KEY(copy_book_id) REFERENCES authored_books(id) ON DELETE SET NULL
);
COMMIT;
