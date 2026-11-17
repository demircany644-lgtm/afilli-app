-- Additive only. Existing account IDs, books, drafts and roles are not deleted.
CREATE TABLE IF NOT EXISTS afilli_auth_accounts (
  user_id text PRIMARY KEY REFERENCES community_users(id),
  email text NOT NULL UNIQUE CHECK (email=lower(trim(email))),
  password_hash text,
  email_verified boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  disabled boolean NOT NULL DEFAULT false,
  migrated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS afilli_auth_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES afilli_auth_accounts(user_id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS afilli_auth_sessions_user ON afilli_auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS afilli_auth_codes (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES afilli_auth_accounts(user_id),
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS afilli_auth_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS afilli_auth_migration (
  id text PRIMARY KEY,
  complete boolean NOT NULL DEFAULT false
);
