-- Additive only: retain all accounts, sessions, audit events, and content.
ALTER TABLE afilli_auth_sessions
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='afilli_auth_sessions_access_mode'
      AND conrelid='afilli_auth_sessions'::regclass
  ) THEN
    ALTER TABLE afilli_auth_sessions
      ADD CONSTRAINT afilli_auth_sessions_access_mode CHECK (access_mode IN ('normal','appeal'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS account_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  product_identifier text NOT NULL,
  package_identifier text NOT NULL,
  platform text NOT NULL,
  transaction_id text NOT NULL,
  payment_status text NOT NULL DEFAULT 'verified',
  payment_verified_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  block_reason text NOT NULL,
  blocked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text,
  decision_reason text,
  CONSTRAINT account_appeals_user_id_afilli_auth_accounts_user_id_fk
    FOREIGN KEY (user_id) REFERENCES afilli_auth_accounts(user_id) ON DELETE CASCADE,
  CONSTRAINT account_appeals_decided_by_community_users_id_fk
    FOREIGN KEY (decided_by) REFERENCES community_users(id) ON DELETE SET NULL,
  CONSTRAINT account_appeals_platform CHECK (platform IN ('ios','android')),
  CONSTRAINT account_appeals_payment_status CHECK (payment_status='verified'),
  CONSTRAINT account_appeals_status CHECK (status IN ('pending','approved','rejected'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(i.indkey)
    WHERE t.relname='account_appeals' AND i.indisunique AND i.indnkeyatts=1
      AND a.attname='transaction_id'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS account_appeals_transaction_unique
      ON account_appeals(transaction_id);
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS account_appeals_one_pending_per_user
  ON account_appeals(user_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS account_appeals_queue
  ON account_appeals(status, created_at, id);
CREATE INDEX IF NOT EXISTS account_appeals_user_created
  ON account_appeals(user_id, created_at);
