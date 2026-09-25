-- Braze Test Shop — Delta tables (Unity Catalog).
-- Run inside the target catalog/schema (scripts/setup_databricks.py does this for you).
-- PRIMARY KEY / FOREIGN KEY constraints are informational in Databricks: they document
-- the model (and show up in Catalog Explorer) but are not enforced.

-- ---------- Catalogue ----------
CREATE TABLE IF NOT EXISTS categories (
  category_id STRING NOT NULL,
  name STRING NOT NULL,
  emoji STRING,
  sort_order INT,
  CONSTRAINT categories_pk PRIMARY KEY (category_id)
);

CREATE TABLE IF NOT EXISTS subcategories (
  subcategory_id STRING NOT NULL,
  category_id STRING NOT NULL,
  name STRING NOT NULL,
  sort_order INT,
  CONSTRAINT subcategories_pk PRIMARY KEY (subcategory_id),
  CONSTRAINT subcategories_category_fk FOREIGN KEY (category_id) REFERENCES categories (category_id)
);

CREATE TABLE IF NOT EXISTS products (
  product_id STRING NOT NULL,
  name STRING NOT NULL,
  description STRING,
  category_id STRING NOT NULL,
  subcategory_id STRING NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  currency STRING NOT NULL,
  emoji STRING,
  image_url STRING,
  is_active BOOLEAN NOT NULL,
  sort_order INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  CONSTRAINT products_pk PRIMARY KEY (product_id),
  CONSTRAINT products_category_fk FOREIGN KEY (category_id) REFERENCES categories (category_id),
  CONSTRAINT products_subcategory_fk FOREIGN KEY (subcategory_id) REFERENCES subcategories (subcategory_id)
);

CREATE TABLE IF NOT EXISTS product_variants (
  variant_id STRING NOT NULL,
  product_id STRING NOT NULL,
  variant_code STRING NOT NULL,
  label STRING NOT NULL,
  variant_type STRING,
  sort_order INT,
  is_active BOOLEAN NOT NULL,
  CONSTRAINT product_variants_pk PRIMARY KEY (variant_id),
  CONSTRAINT product_variants_product_fk FOREIGN KEY (product_id) REFERENCES products (product_id)
);

-- ---------- Customers ----------
-- user_id is also the Braze external_id (braze.changeUser(user_id)).
CREATE TABLE IF NOT EXISTS users (
  user_id STRING NOT NULL,
  email STRING NOT NULL,
  first_name STRING,
  last_name STRING,
  email_marketing_opt_in BOOLEAN,
  created_at TIMESTAMP NOT NULL,
  last_login_at TIMESTAMP,
  CONSTRAINT users_pk PRIMARY KEY (user_id)
);

-- ---------- Orders ----------
-- user_id is NULL for guest checkouts.
CREATE TABLE IF NOT EXISTS orders (
  order_id STRING NOT NULL,
  user_id STRING,
  email STRING NOT NULL,
  first_name STRING,
  last_name STRING,
  shipping_address STRING,
  shipping_city STRING,
  shipping_postal_code STRING,
  shipping_method STRING NOT NULL,
  cart_id STRING,
  checkout_id STRING,
  subtotal DECIMAL(10,2) NOT NULL,
  shipping_cost DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  currency STRING NOT NULL,
  status STRING NOT NULL,
  source STRING,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT orders_pk PRIMARY KEY (order_id),
  CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id)
);

-- Product name / label / price are copied at purchase time, so the order stays
-- correct even if the catalogue changes later.
CREATE TABLE IF NOT EXISTS order_items (
  order_id STRING NOT NULL,
  line_number INT NOT NULL,
  product_id STRING NOT NULL,
  variant_id STRING NOT NULL,
  product_name STRING NOT NULL,
  variant_label STRING,
  unit_price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  CONSTRAINT order_items_pk PRIMARY KEY (order_id, line_number),
  CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders (order_id),
  CONSTRAINT order_items_product_fk FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT order_items_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variants (variant_id)
);
