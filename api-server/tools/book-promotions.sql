-- Additive schema for free book promotion requests. Existing books and account data are unchanged.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('afilli-book-promotions-schema'));

CREATE TABLE IF NOT EXISTS book_promotion_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id=true),
  enabled boolean NOT NULL DEFAULT true,
  allowed_durations integer[] NOT NULL DEFAULT ARRAY[3,7,15,30],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES community_users(id) ON DELETE SET NULL,
  CONSTRAINT book_promotion_duration_values CHECK (
    cardinality(allowed_durations) BETWEEN 1 AND 4
    AND allowed_durations <@ ARRAY[3,7,15,30]::integer[]
  )
);
INSERT INTO book_promotion_settings(id,enabled,allowed_durations)
VALUES(true,true,ARRAY[3,7,15,30]) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS book_promotion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid REFERENCES authored_books(id) ON DELETE SET NULL,
  author_id text REFERENCES community_users(id) ON DELETE SET NULL,
  client_request_id uuid NOT NULL,
  book_title text NOT NULL,
  cover_snapshot text,
  author_nickname text NOT NULL,
  author_avatar text,
  duration_days integer NOT NULL CHECK (duration_days IN (3,7,15,30)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','expired')),
  decision text CHECK (decision IS NULL OR decision IN ('free','reject')),
  decision_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text REFERENCES community_users(id) ON DELETE SET NULL,
  starts_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT book_promotion_active_dates CHECK (
    status <> 'active' OR (starts_at IS NOT NULL AND expires_at IS NOT NULL)
  ),
  CONSTRAINT book_promotion_author_request_id UNIQUE(author_id,client_request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS book_promotion_one_open_per_book
  ON book_promotion_requests(book_id)
  WHERE book_id IS NOT NULL AND status IN ('pending','active');
CREATE INDEX IF NOT EXISTS book_promotion_requests_queue ON book_promotion_requests(status,requested_at,id);
CREATE INDEX IF NOT EXISTS book_promotion_requests_author ON book_promotion_requests(author_id,requested_at,id);
CREATE INDEX IF NOT EXISTS book_promotion_requests_expiry ON book_promotion_requests(status,expires_at);
COMMIT;
