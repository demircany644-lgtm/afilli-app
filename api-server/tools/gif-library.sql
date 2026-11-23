-- Additive development schema. Managed production changes go through Publish.
CREATE TABLE IF NOT EXISTS gif_library (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text,
 client_id uuid NOT NULL,
 title text NOT NULL,
 object_path text NOT NULL,
 size integer NOT NULL,
 ready boolean NOT NULL DEFAULT false,
 width integer NOT NULL DEFAULT 0,
 height integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT gif_library_owner_id_fkey FOREIGN KEY(owner_id) REFERENCES community_users(id) ON DELETE SET NULL,
 CONSTRAINT gif_library_owner_client UNIQUE(owner_id,client_id)
);
CREATE INDEX IF NOT EXISTS gif_library_order ON gif_library(ready,created_at,id);
