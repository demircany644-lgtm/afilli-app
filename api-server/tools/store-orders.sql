-- Additive, rerunnable store schema. Existing accounts, books, and user data are unchanged.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('afilli-store-orders-schema'));

CREATE TABLE IF NOT EXISTS store_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id=true),
  active boolean NOT NULL DEFAULT false,
  updated_at timestamptz,
  updated_by text REFERENCES community_users(id) ON DELETE SET NULL
);
INSERT INTO store_settings(id,active) VALUES(true,false) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS store_cart_items (
  user_id text NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,product_id)
);
CREATE INDEX IF NOT EXISTS store_cart_user_updated ON store_cart_items(user_id,updated_at);

CREATE TABLE IF NOT EXISTS store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','payment_pending','approved_free','rejected')),
  total_kurus integer NOT NULL CHECK (total_kurus >= 0),
  decision_note text,
  decision text CHECK (decision IS NULL OR decision IN ('paid','free','reject','pending')),
  decided_by text REFERENCES community_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_orders_queue ON store_orders(status,created_at,id);
CREATE INDEX IF NOT EXISTS store_orders_user_created ON store_orders(user_id,created_at,id);

CREATE TABLE IF NOT EXISTS store_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('perfume','accessory','gift','other')),
  product_type text NOT NULL,
  size_label text NOT NULL,
  price_kurus integer NOT NULL CHECK (price_kurus >= 0),
  image_key text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99)
);
CREATE INDEX IF NOT EXISTS store_order_items_order ON store_order_items(order_id,id);

CREATE TABLE IF NOT EXISTS store_products (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  category text NOT NULL CHECK (category IN ('perfume','accessory','gift','other')),
  product_type text NOT NULL CHECK (length(product_type) BETWEEN 1 AND 80),
  size_label text NOT NULL CHECK (length(size_label) BETWEEN 1 AND 60),
  price_kurus integer NOT NULL CHECK (price_kurus BETWEEN 0 AND 100000000),
  image_key text NOT NULL UNIQUE,
  display_order integer NOT NULL DEFAULT 1000,
  created_by text REFERENCES community_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_products_category_order ON store_products(category,display_order,created_at,id);

CREATE TABLE IF NOT EXISTS store_product_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text REFERENCES community_users(id) ON DELETE SET NULL,
  client_id uuid NOT NULL,
  object_path text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  size integer NOT NULL CHECK (size BETWEEN 1 AND 10485760),
  ready boolean NOT NULL DEFAULT false,
  width integer NOT NULL DEFAULT 0,
  height integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_product_upload_owner_client UNIQUE(owner_id,client_id)
);
CREATE INDEX IF NOT EXISTS store_product_upload_owner_created ON store_product_uploads(owner_id,created_at,id);

INSERT INTO store_products(id,name,category,product_type,size_label,price_kurus,image_key,display_order)
VALUES
  ('bleu-de-chanel','Chanel Bleu De Chanel','perfume','Eau de Parfum','100 ml',249900,'bleu-de-chanel',10),
  ('dior-sauvage','Dior Sauvage','perfume','Eau de Parfum','100 ml',279900,'dior-sauvage',20),
  ('miss-dior','Miss Dior','perfume','Eau de Parfum','100 ml',269900,'miss-dior',30),
  ('ysl-libre','Yves Saint Laurent Libre','perfume','Eau de Parfum','90 ml',299900,'ysl-libre',40)
ON CONFLICT(id) DO NOTHING;
COMMIT;
