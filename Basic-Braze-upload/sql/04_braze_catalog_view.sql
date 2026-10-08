-- Source for the Braze Catalog via Cloud Data Ingestion (CDI): one row per product.
-- Braze reads ID, UPDATED_AT, PAYLOAD (JSON) and DELETED. Only rows with a newer
-- UPDATED_AT are synced, so bump products.updated_at whenever you edit a product.
CREATE OR REPLACE VIEW braze_catalog_products
COMMENT 'Source for the Braze Catalog (Cloud Data Ingestion): one row per product.'
AS
SELECT
  p.product_id                          AS ID,
  COALESCE(p.updated_at, p.created_at)  AS UPDATED_AT,
  NOT p.is_active                       AS DELETED,
  to_json(named_struct(
    'name',        p.name,
    'description', p.description,
    'category',    c.name,
    'subcategory', s.name,
    'price',       CAST(p.price AS DOUBLE),
    'currency',    p.currency,
    'emoji',       p.emoji,
    'image_url',   p.image_url,
    'product_url', concat('https://basic-braze.vercel.app/#/product/', p.product_id),
    'variants',    array_join(transform(array_sort(collect_list(struct(v.sort_order, v.label))), x -> x.label), ', ')
  ))                                    AS PAYLOAD
FROM products p
JOIN categories c    ON c.category_id = p.category_id
JOIN subcategories s ON s.subcategory_id = p.subcategory_id
LEFT JOIN product_variants v ON v.product_id = p.product_id AND v.is_active
GROUP BY p.product_id, p.updated_at, p.created_at, p.is_active, p.name, p.description,
         c.name, s.name, p.price, p.currency, p.emoji, p.image_url;
