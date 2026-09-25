-- Databricks-only: descriptions shown in Catalog Explorer.
COMMENT ON TABLE categories IS 'Top-level shop categories (menu).';
COMMENT ON TABLE subcategories IS 'Subcategories within a category.';
COMMENT ON TABLE products IS 'Sellable products. price is the unit price in currency.';
COMMENT ON TABLE product_variants IS 'Size/color/option variants. variant_id = product_id-variant_code; this is the variant_id sent to Braze.';
COMMENT ON TABLE users IS 'Registered customers. user_id is the Braze external_id.';
COMMENT ON TABLE orders IS 'Order header, one row per order. user_id is NULL for guest checkout.';
COMMENT ON TABLE order_items IS 'Order lines with product name/price captured at purchase time.';
