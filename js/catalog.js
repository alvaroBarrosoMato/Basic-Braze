// Demo product catalog. In a real shop this would come from your backend / PIM.

const SIZES = [
  { id: "s", label: "S" },
  { id: "m", label: "M" },
  { id: "l", label: "L" },
  { id: "xl", label: "XL" },
];
const colors = (...names) => names.map((label) => ({ id: label.toLowerCase().replace(/\s+/g, "-"), label }));

export const CATEGORIES = [
  {
    slug: "ropa", name: "Ropa", emoji: "👕",
    subs: [
      { slug: "camisetas", name: "Camisetas" },
      { slug: "sudaderas", name: "Sudaderas" },
      { slug: "gorras", name: "Gorras" },
    ],
  },
  {
    slug: "accesorios", name: "Accesorios", emoji: "🎒",
    subs: [
      { slug: "bolsas", name: "Bolsas y mochilas" },
      { slug: "botellas", name: "Botellas" },
      { slug: "stickers", name: "Stickers" },
    ],
  },
  {
    slug: "hogar", name: "Hogar", emoji: "🏠",
    subs: [
      { slug: "tazas", name: "Tazas" },
      { slug: "decoracion", name: "Decoración" },
    ],
  },
  {
    slug: "tecnologia", name: "Tecnología", emoji: "🎧",
    subs: [
      { slug: "audio", name: "Audio" },
      { slug: "fundas", name: "Fundas" },
    ],
  },
];

export const PRODUCTS = [
  { id: "SKU-TSH-001", name: "Camiseta Logo", category: "ropa", sub: "camisetas", price: 25, emoji: "👕",
    description: "Camiseta de algodón orgánico con el logo bordado en el pecho. Corte regular.", variants: SIZES },
  { id: "SKU-TSH-002", name: "Camiseta Rayas", category: "ropa", sub: "camisetas", price: 29, emoji: "🎽",
    description: "Camiseta a rayas estilo marinero, tejido ligero y transpirable.", variants: SIZES },
  { id: "SKU-HOD-001", name: "Sudadera con capucha", category: "ropa", sub: "sudaderas", price: 55, emoji: "🧥",
    description: "Sudadera gruesa con capucha y bolsillo canguro. Perfecta para el invierno.", variants: SIZES },
  { id: "SKU-HOD-002", name: "Sudadera Cremallera", category: "ropa", sub: "sudaderas", price: 60, emoji: "🥼",
    description: "Sudadera con cremallera completa y puños elásticos.", variants: SIZES },
  { id: "SKU-CAP-001", name: "Gorra Béisbol", category: "ropa", sub: "gorras", price: 18, emoji: "🧢",
    description: "Gorra de seis paneles con cierre ajustable.", variants: colors("Negro", "Azul", "Blanco") },
  { id: "SKU-BAG-001", name: "Tote Bag", category: "accesorios", sub: "bolsas", price: 15, emoji: "👜",
    description: "Bolsa de tela resistente para la compra diaria.", variants: colors("Natural", "Negro") },
  { id: "SKU-BAG-002", name: "Mochila Urbana", category: "accesorios", sub: "bolsas", price: 70, emoji: "🎒",
    description: "Mochila con compartimento acolchado para portátil de 15\".", variants: colors("Gris", "Negro") },
  { id: "SKU-BOT-001", name: "Botella Térmica", category: "accesorios", sub: "botellas", price: 22, emoji: "🥤",
    description: "Mantiene el frío 24 h y el calor 12 h. 500 ml.", variants: colors("Morado", "Verde", "Negro") },
  { id: "SKU-STK-001", name: "Pack de Stickers", category: "accesorios", sub: "stickers", price: 5, emoji: "✨",
    description: "10 stickers de vinilo resistentes al agua.", variants: [{ id: "pack-10", label: "Pack de 10" }] },
  { id: "SKU-MUG-001", name: "Taza de Café", category: "hogar", sub: "tazas", price: 12, emoji: "☕",
    description: "Taza de cerámica de 350 ml, apta para lavavajillas.", variants: colors("Blanco", "Negro") },
  { id: "SKU-MUG-002", name: "Taza Viaje", category: "hogar", sub: "tazas", price: 19, emoji: "🧋",
    description: "Taza de viaje con tapa antigoteo.", variants: colors("Morado", "Gris") },
  { id: "SKU-DEC-001", name: "Póster Edición Limitada", category: "hogar", sub: "decoracion", price: 30, emoji: "🖼️",
    description: "Póster impreso en papel mate de 250 g. 50×70 cm.", variants: [{ id: "50x70", label: "50×70 cm" }] },
  { id: "SKU-DEC-002", name: "Planta de Escritorio", category: "hogar", sub: "decoracion", price: 16, emoji: "🪴",
    description: "Pequeña suculenta en maceta de cerámica.", variants: colors("Terracota", "Blanco") },
  { id: "SKU-AUD-001", name: "Auriculares Bluetooth", category: "tecnologia", sub: "audio", price: 89, emoji: "🎧",
    description: "Cancelación de ruido y 30 h de batería.", variants: colors("Negro", "Blanco") },
  { id: "SKU-AUD-002", name: "Altavoz Portátil", category: "tecnologia", sub: "audio", price: 45, emoji: "🔊",
    description: "Resistente al agua IPX7, sonido 360°.", variants: colors("Azul", "Negro") },
  { id: "SKU-CAS-001", name: "Funda de Móvil", category: "tecnologia", sub: "fundas", price: 20, emoji: "📱",
    description: "Funda de silicona con tacto suave.", variants: colors("Morado", "Negro", "Transparente") },
];

export const getProduct = (id) => PRODUCTS.find((p) => p.id === id);
export const getCategory = (slug) => CATEGORIES.find((c) => c.slug === slug);
export const getVariant = (product, variantId) => product.variants.find((v) => v.id === variantId) || product.variants[0];
// Variant IDs are unique per product: "SKU-TSH-001-m"
export const fullVariantId = (product, variant) => `${product.id}-${variant.id}`;

export function searchProducts(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return PRODUCTS.filter((p) => {
    const cat = getCategory(p.category);
    const sub = cat.subs.find((s) => s.slug === p.sub);
    return [p.name, p.description, cat.name, sub.name].some((t) => t.toLowerCase().includes(q));
  });
}
