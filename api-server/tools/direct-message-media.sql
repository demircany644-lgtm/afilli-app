BEGIN;
LOCK TABLE direct_messages IN SHARE ROW EXCLUSIVE MODE;
CREATE SEQUENCE IF NOT EXISTS direct_message_change_seq;
CREATE TABLE IF NOT EXISTS direct_message_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  owner_id text REFERENCES community_users(id) ON DELETE SET NULL,
  client_id uuid NOT NULL,
  size integer NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  ready boolean NOT NULL DEFAULT false,
  width integer,height integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  attached_at timestamptz,delete_requested_at timestamptz,purged_at timestamptz,
  source_put_until timestamptz NOT NULL DEFAULT now()+interval '16 minutes'
);
ALTER TABLE direct_message_uploads ADD COLUMN IF NOT EXISTS source_put_until timestamptz NOT NULL DEFAULT now()+interval '16 minutes';
CREATE UNIQUE INDEX IF NOT EXISTS direct_upload_retry ON direct_message_uploads(thread_id,owner_id,client_id);
CREATE INDEX IF NOT EXISTS direct_upload_cleanup ON direct_message_uploads(delete_requested_at,purged_at);
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS photo_id uuid REFERENCES direct_message_uploads(id);
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS change_sequence bigint NOT NULL DEFAULT nextval('direct_message_change_seq');
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS media_expired_at timestamptz;
ALTER TABLE direct_messages DROP CONSTRAINT IF EXISTS message_nonempty_limit;
ALTER TABLE direct_messages ADD CONSTRAINT message_nonempty_limit CHECK(length(trim(body))<=4000 AND
  (length(trim(body))>0 OR gif IS NOT NULL OR photo_id IS NOT NULL OR deleted_at IS NOT NULL OR media_expired_at IS NOT NULL));
CREATE INDEX IF NOT EXISTS message_thread_changes ON direct_messages(thread_id,change_sequence);
CREATE INDEX IF NOT EXISTS message_quote_target ON direct_messages(reply_to_id);
CREATE UNIQUE INDEX IF NOT EXISTS message_photo_once ON direct_messages(photo_id);
COMMIT;
