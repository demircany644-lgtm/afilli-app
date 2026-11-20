-- Additive rollout: apply before serving the new profile/message queries.
-- Independent of automatic foreground heartbeats; no accounts/content removed.
ALTER TABLE community_users ADD COLUMN IF NOT EXISTS online_visible boolean NOT NULL DEFAULT true;
