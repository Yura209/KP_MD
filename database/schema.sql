-- СтройМаркет: идемпотентная транзакционная миграция для новой и черновой схемы.
-- Старые заказы сохраняются в таблицах legacy_*; их строки не удаляются.
CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,full_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
DO $fix$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name='role_id') THEN
  EXECUTE 'ALTER TABLE users ALTER COLUMN role_id DROP NOT NULL';
 END IF;
END $fix$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name='role_id') AND to_regclass('roles') IS NOT NULL THEN
  EXECUTE $q$UPDATE users u SET role=CASE lower(r.name) WHEN 'buyer' THEN 'customer' WHEN 'guest' THEN 'customer' WHEN 'seller' THEN 'seller' WHEN 'administrator' THEN 'admin' ELSE 'customer' END FROM roles r WHERE u.role_id=r.id AND (u.role IS NULL OR u.role='')$q$;
 END IF;
END $$;
UPDATE users SET role='customer' WHERE role IS NULL OR role NOT IN ('customer','seller','admin');
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'customer';
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('customer','seller','admin'));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users(lower(email));

CREATE TABLE IF NOT EXISTS stores(id BIGSERIAL PRIMARY KEY,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',logo_url TEXT,address TEXT,phone TEXT,is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE stores ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE stores SET slug=CASE id WHEN 1 THEN 'aqua' WHEN 2 THEN 'master' WHEN 3 THEN 'svet' ELSE 'store-'||id::text END WHERE slug IS NULL;
ALTER TABLE stores ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stores_slug_uq ON stores(slug);
CREATE TABLE IF NOT EXISTS seller_stores(user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,PRIMARY KEY(user_id,store_id));

CREATE TABLE IF NOT EXISTS categories(id BIGSERIAL PRIMARY KEY,parent_id BIGINT REFERENCES categories(id) ON DELETE RESTRICT,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT '',is_active BOOLEAN NOT NULL DEFAULT TRUE);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE categories SET slug=CASE name WHEN 'Строительные материалы' THEN 'building-materials' WHEN 'Отделочные материалы' THEN 'finishing' WHEN 'Инструменты и оборудование' THEN 'tools' WHEN 'Сантехника' THEN 'plumbing' WHEN 'Электрика и освещение' THEN 'electrical' WHEN 'Двери и окна' THEN 'doors-windows' WHEN 'Кровля и фасад' THEN 'roofing' WHEN 'Товары для дома и участка' THEN 'home-garden' WHEN 'Другое' THEN 'other' ELSE 'category-'||id::text END WHERE slug IS NULL;
ALTER TABLE categories ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS categories_slug_uq ON categories(slug);
CREATE TABLE IF NOT EXISTS units(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,short_name TEXT NOT NULL UNIQUE);
INSERT INTO units(name,short_name) VALUES('штука','шт.'),('упаковка','уп.'),('метр','м'),('килограмм','кг'),('литр','л'),('мешок','меш.'),('упаковка старая','упак.'),('метр старый','м.') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS products(id BIGSERIAL PRIMARY KEY,store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,unit_id BIGINT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,sku TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',brand TEXT,price NUMERIC(12,2) NOT NULL CHECK(price>=0),stock NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK(stock>=0),image_url TEXT,characteristics JSONB NOT NULL DEFAULT '{}'::jsonb,coverage_per_package NUMERIC(12,3) CHECK(coverage_per_package>0),waste_factor NUMERIC(5,3) NOT NULL DEFAULT 1.000 CHECK(waste_factor>=1),weight_kg NUMERIC(12,3) CHECK(weight_kg>=0),length_cm NUMERIC(12,2) CHECK(length_cm>=0),width_cm NUMERIC(12,2) CHECK(width_cm>=0),height_cm NUMERIC(12,2) CHECK(height_cm>=0),is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(store_id,sku));
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_id BIGINT REFERENCES units(id) ON DELETE RESTRICT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock NUMERIC(12,3) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS characteristics JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS coverage_per_package NUMERIC(12,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS waste_factor NUMERIC(5,3) NOT NULL DEFAULT 1.000;
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(12,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_cm NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS width_cm NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS height_cm NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='stock_quantity') THEN EXECUTE 'UPDATE products SET stock=stock_quantity WHERE stock IS NULL OR stock=0'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='unit') THEN
  EXECUTE 'INSERT INTO units(name,short_name) SELECT DISTINCT unit,unit FROM products WHERE unit IS NOT NULL ON CONFLICT DO NOTHING';
  EXECUTE 'UPDATE products p SET unit_id=u.id FROM units u WHERE p.unit_id IS NULL AND u.short_name=p.unit';
 END IF;
END $$;
UPDATE products SET unit_id=(SELECT id FROM units ORDER BY id LIMIT 1) WHERE unit_id IS NULL;
ALTER TABLE products ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN stock SET DEFAULT 0;
ALTER TABLE products ALTER COLUMN stock SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='products_stock_nonnegative' AND conrelid='products'::regclass) THEN ALTER TABLE products ADD CONSTRAINT products_stock_nonnegative CHECK(stock>=0); END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS products_store_sku_uq ON products(store_id,sku);
CREATE INDEX IF NOT EXISTS products_store_active_idx ON products(store_id,is_active,category_id);
CREATE INDEX IF NOT EXISTS products_search_idx ON products USING GIN(to_tsvector('russian',coalesce(name,'')||' '||coalesce(sku,'')||' '||coalesce(brand,'')));
CREATE INDEX IF NOT EXISTS products_characteristics_idx ON products USING GIN(characteristics);

CREATE TABLE IF NOT EXISTS carts(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS cart_items(cart_id BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0),added_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(cart_id,product_id));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='orders' AND column_name='buyer_id') AND to_regclass('legacy_orders') IS NULL THEN ALTER TABLE orders RENAME TO legacy_orders; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='store_orders' AND column_name='order_id') AND to_regclass('legacy_store_orders') IS NULL THEN ALTER TABLE store_orders RENAME TO legacy_store_orders; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='order_items' AND column_name='store_order_id') AND to_regclass('legacy_order_items') IS NULL THEN ALTER TABLE order_items RENAME TO legacy_order_items; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='payments' AND column_name='payment_method') AND to_regclass('legacy_payments') IS NULL THEN ALTER TABLE payments RENAME TO legacy_payments; END IF;
END $$;
CREATE TABLE IF NOT EXISTS orders(id BIGSERIAL PRIMARY KEY,number TEXT NOT NULL UNIQUE,customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,status TEXT NOT NULL DEFAULT 'awaiting_sellers',payment_method TEXT NOT NULL CHECK(payment_method IN('online_demo','cash_on_delivery')),payment_status TEXT NOT NULL DEFAULT 'not_paid',address TEXT NOT NULL,contact_phone TEXT NOT NULL,delivery_zone TEXT NOT NULL DEFAULT 'city',items_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(items_total>=0),shipping_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(shipping_total>=0),total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(total>=0),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone TEXT NOT NULL DEFAULT 'city';
CREATE TABLE IF NOT EXISTS order_parts(id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,status TEXT NOT NULL DEFAULT 'pending_seller',items_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(items_total>=0),cancel_reason TEXT,cancel_comment TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(order_id,store_id));
CREATE TABLE IF NOT EXISTS order_items(id BIGSERIAL PRIMARY KEY,part_id BIGINT NOT NULL REFERENCES order_parts(id) ON DELETE RESTRICT,product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,product_name TEXT NOT NULL,sku TEXT NOT NULL,unit_name TEXT NOT NULL,unit_price NUMERIC(12,2) NOT NULL CHECK(unit_price>=0),quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0),line_total NUMERIC(12,2) NOT NULL CHECK(line_total>=0),reserved BOOLEAN NOT NULL DEFAULT FALSE,reservation_released BOOLEAN NOT NULL DEFAULT FALSE);
CREATE INDEX IF NOT EXISTS order_items_part_idx ON order_items(part_id);
CREATE TABLE IF NOT EXISTS order_status_history(id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,part_id BIGINT REFERENCES order_parts(id) ON DELETE RESTRICT,old_status TEXT,new_status TEXT NOT NULL,changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,comment TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payments(id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,operation TEXT NOT NULL CHECK(operation IN('payment','refund')),method TEXT NOT NULL,status TEXT NOT NULL,amount NUMERIC(12,2) NOT NULL CHECK(amount>=0),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS delivery_events(id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,event_type TEXT NOT NULL,store_id BIGINT REFERENCES stores(id) ON DELETE RESTRICT,details JSONB NOT NULL DEFAULT '{}'::jsonb,comment TEXT,created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reviews(id BIGSERIAL PRIMARY KEY,order_item_id BIGINT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,rating SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5),body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 2000),seller_reply TEXT,replied_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS return_requests(id BIGSERIAL PRIMARY KEY,order_item_id BIGINT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,reason TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',admin_comment TEXT,refund_recorded BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS return_requests_order_item_uq ON return_requests(order_item_id);
CREATE TABLE IF NOT EXISTS favorites(user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,product_id));
CREATE TABLE IF NOT EXISTS comparisons(user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,product_id));
CREATE TABLE IF NOT EXISTS notifications(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,body TEXT NOT NULL,is_read BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log(id BIGSERIAL PRIMARY KEY,actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,object_type TEXT NOT NULL,object_id BIGINT,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value JSONB NOT NULL);
INSERT INTO app_settings(key,value) VALUES('shipping','{"base_fee":450,"per_kg":15,"max_weight_kg":200,"zones":{"city":0,"region":350},"max_dimension_cm":300,"max_volume_m3":2}'::jsonb) ON CONFLICT(key) DO NOTHING;
UPDATE app_settings SET value=value||'{"zones":{"city":0,"region":350},"max_dimension_cm":300,"max_volume_m3":2}'::jsonb WHERE key='shipping' AND NOT(value ? 'zones');