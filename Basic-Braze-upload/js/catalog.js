// Product catalogue, loaded from Databricks through /api/catalog.
// The tables are categories, subcategories, products and product_variants (see sql/01_tables.sql).
import { api } from "./api.js";

export let CATEGORIES = []; // [{ slug, name, emoji, subs: [{ slug, name }] }]
export let PRODUCTS = []; // [{ id, name, description, category, sub, price, emoji, variants: [{ id, variantId, label, type }] }]

export async function loadCatalog() {
  const data = await api.catalog();
  CATEGORIES = data.categories;
  PRODUCTS = data.products;
}

export const getProduct = (id) => PRODUCTS.find((p) => p.id === id);
export const getCategory = (slug) => CATEGORIES.find((c) => c.slug === slug);
export const getVariant = (product, variantId) => product.variants.find((v) => v.id === variantId) || product.variants[0];
// Variant IDs are unique per product: "SKU-TSH-001-m" (product_variants.variant_id)
export const fullVariantId = (product, variant) => variant.variantId || `${product.id}-${variant.id}`;

export function searchProducts(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return PRODUCTS.filter((p) => {
    const cat = getCategory(p.category);
    const sub = cat?.subs.find((s) => s.slug === p.sub);
    return [p.name, p.description, cat?.name, sub?.name].some((t) => t && t.toLowerCase().includes(q));
  });
}
