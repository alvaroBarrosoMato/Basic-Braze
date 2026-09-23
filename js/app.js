/* Braze Test Shop — UI, state and hash router.
 * All Braze calls go through ./braze.js.
 */
import { PLACEMENTS, CURRENCY } from "./config.js";
import {
  CATEGORIES, PRODUCTS, getProduct, getCategory, getVariant, searchProducts,
} from "./catalog.js";
import * as Braze from "./braze.js";

// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: CURRENCY });
const money = (n) => fmt.format(n);
const round2 = (n) => Math.round(n * 100) / 100;
const uid = (prefix) => `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
const banner = (placement) => `<div class="banner-slot" data-placement="${placement}"></div>`;

// ---------- Local demo storage (stands in for a real backend) ----------
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const newCart = () => ({ id: uid("cart"), items: [] });
let accounts = store.get("demo_accounts", {}); // { [email]: { userId, firstName, lastName } }
let currentUser = store.get("demo_current_user", null);
let cart = store.get("demo_cart", null) || newCart(); // { id, items: [{ productId, variantId, qty }] }
let orders = store.get("demo_orders", {});

// ---------- Cart ----------
const SHIPPING = {
  standard: { label: "Estándar (3–5 días)", price: 0 },
  express: { label: "Exprés (24 h)", price: 5.95 },
};

function totals(items = cart.items, shippingMethod = null) {
  const subtotal = round2(items.reduce((s, l) => s + getProduct(l.productId).price * l.qty, 0));
  const shipping = shippingMethod ? SHIPPING[shippingMethod].price : 0;
  return { subtotal, shipping, total: round2(subtotal + shipping) };
}
const cartCount = () => cart.items.reduce((s, l) => s + l.qty, 0);

function saveCart({ track = true } = {}) {
  store.set("demo_cart", cart);
  if (track) Braze.cartUpdated(cart, totals());
  renderCartBadge();
}

function setQty(productId, variantId, qty) {
  const line = cart.items.find((l) => l.productId === productId && l.variantId === variantId);
  if (line) line.qty = qty;
  else if (qty > 0) cart.items.push({ productId, variantId, qty });
  cart.items = cart.items.filter((l) => l.qty > 0);
  saveCart();
}

function addToCart(productId, variantId, qty = 1) {
  const line = cart.items.find((l) => l.productId === productId && l.variantId === variantId);
  setQty(productId, variantId, (line ? line.qty : 0) + qty);
  const p = getProduct(productId);
  toast(`${p.emoji} ${p.name} añadido al carrito`);
}

// ---------- Auth ----------
function signUp({ firstName, lastName, email, marketing }) {
  email = email.trim().toLowerCase();
  const userId = accounts[email]?.userId || uid("user"); // opaque ID, not the email
  accounts[email] = { userId, firstName, lastName };
  store.set("demo_accounts", accounts);
  currentUser = { userId, email, firstName, lastName };
  store.set("demo_current_user", currentUser);
  Braze.signUp({ userId, firstName, lastName, email, marketing });
  renderHeaderUser();
  toast(`¡Bienvenido/a, ${firstName}!`);
}

function logIn(email) {
  email = email.trim().toLowerCase();
  const account = accounts[email];
  if (!account) return false;
  currentUser = { userId: account.userId, email, firstName: account.firstName, lastName: account.lastName };
  store.set("demo_current_user", currentUser);
  Braze.logIn(account.userId);
  renderHeaderUser();
  toast(`Hola de nuevo, ${account.firstName}`);
  return true;
}

function logOut() {
  Braze.logOut(() => {
    store.remove("demo_current_user");
    store.remove("demo_cart");
    location.hash = "#/";
    location.reload();
  });
}

// ---------- Views ----------
function productCard(p) {
  return `
    <a class="product-card" href="#/product/${p.id}">
      <div class="thumb">${p.emoji}</div>
      <div class="name">${esc(p.name)}</div>
      <div class="muted small">${esc(getCategory(p.category).name)}</div>
      <div class="price">${money(p.price)}</div>
    </a>`;
}
const grid = (products) => products.length
  ? `<div class="grid">${products.map(productCard).join("")}</div>`
  : `<p class="muted">No hay productos.</p>`;

function breadcrumb(parts) {
  return `<nav class="crumbs" aria-label="Ruta">${[["#/", "Inicio"], ...parts]
    .map(([href, label], i, arr) => (i === arr.length - 1 || !href ? `<span>${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`))
    .join(" › ")}</nav>`;
}

const views = {
  home() {
    return `
      ${banner(PLACEMENTS.home)}
      <section class="hero">
        <h1>Merch para gente que envía mensajes relevantes</h1>
        <p class="muted">Tienda de prueba para el SDK web de Braze.</p>
      </section>
      <h2>Categorías</h2>
      <div class="cat-grid">
        ${CATEGORIES.map((c) => `
          <a class="cat-card" href="#/category/${c.slug}">
            <span class="cat-emoji">${c.emoji}</span>
            <span class="name">${c.name}</span>
            <span class="muted small">${c.subs.map((s) => s.name).join(" · ")}</span>
          </a>`).join("")}
      </div>
      <h2>Destacados</h2>
      ${grid(PRODUCTS.filter((_, i) => i % 2 === 0).slice(0, 8))}`;
  },

  category(slug, subSlug) {
    const cat = getCategory(slug);
    if (!cat) return views.notFound();
    const sub = cat.subs.find((s) => s.slug === subSlug);
    const products = PRODUCTS.filter((p) => p.category === slug && (!sub || p.sub === sub.slug));
    return `
      ${breadcrumb(sub ? [[`#/category/${slug}`, cat.name], [null, sub.name]] : [[null, cat.name]])}
      <h1>${cat.emoji} ${esc(sub ? sub.name : cat.name)}</h1>
      <div class="chips">
        <a class="chip ${!sub ? "on" : ""}" href="#/category/${slug}">Todo</a>
        ${cat.subs.map((s) => `<a class="chip ${sub?.slug === s.slug ? "on" : ""}" href="#/category/${slug}/${s.slug}">${s.name}</a>`).join("")}
      </div>
      ${grid(products)}`;
  },

  product(id) {
    const p = getProduct(id);
    if (!p) return views.notFound();
    const cat = getCategory(p.category);
    const sub = cat.subs.find((s) => s.slug === p.sub);
    const related = PRODUCTS.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
    const variantLabel = p.variants[0].label.length <= 3 ? "Talla" : "Opción";
    return `
      ${breadcrumb([[`#/category/${cat.slug}`, cat.name], [`#/category/${cat.slug}/${sub.slug}`, sub.name], [null, p.name]])}
      <article class="pdp">
        <div class="pdp-media">${p.emoji}</div>
        <div class="pdp-info">
          <h1>${esc(p.name)}</h1>
          <div class="pdp-price">${money(p.price)}</div>
          <p>${esc(p.description)}</p>
          <form id="pdp-form" data-product="${p.id}">
            <fieldset class="variants">
              <legend>${variantLabel}</legend>
              ${p.variants.map((v, i) => `
                <label class="variant"><input type="radio" name="variant" value="${v.id}" ${i === 0 ? "checked" : ""} /><span>${esc(v.label)}</span></label>`).join("")}
            </fieldset>
            <label class="qty">Cantidad
              <input type="number" name="qty" value="1" min="1" max="10" />
            </label>
            <button class="btn big" type="submit">Añadir al carrito</button>
          </form>
          <p class="muted small">SKU ${p.id} · Envío estándar gratis</p>
        </div>
      </article>
      ${related.length ? `<h2>También te puede gustar</h2>${grid(related)}` : ""}`;
  },

  search(query) {
    const results = searchProducts(query);
    return `
      ${banner(PLACEMENTS.search)}
      <h1>Buscar</h1>
      <form class="search-page-form" data-search>
        <input type="search" name="q" value="${esc(query)}" placeholder="Busca camisetas, tazas, audio…" aria-label="Buscar" />
        <button class="btn">Buscar</button>
      </form>
      ${query ? `<p class="muted">${results.length} resultado(s) para “${esc(query)}”</p>${grid(results)}` : `<p class="muted">Escribe algo para buscar.</p>`}`;
  },

  cart() {
    const t = totals();
    return `
      ${banner(PLACEMENTS.cart)}
      <h1>Tu carrito</h1>
      ${cart.items.length === 0 ? `<p class="muted">Tu carrito está vacío. <a href="#/">Seguir comprando</a></p>` : `
      <div class="two-col">
        <ul class="cart-lines">
          ${cart.items.map((l) => {
            const p = getProduct(l.productId);
            const v = getVariant(p, l.variantId);
            return `
            <li>
              <a class="line-thumb" href="#/product/${p.id}">${p.emoji}</a>
              <div class="line-info">
                <a href="#/product/${p.id}" class="name">${esc(p.name)}</a>
                <div class="muted small">${esc(v.label)} · ${money(p.price)}</div>
              </div>
              <div class="stepper">
                <button class="btn tiny ghost" data-qty="${l.qty - 1}" data-p="${p.id}" data-v="${v.id}" aria-label="Quitar uno">−</button>
                <span>${l.qty}</span>
                <button class="btn tiny ghost" data-qty="${l.qty + 1}" data-p="${p.id}" data-v="${v.id}" aria-label="Añadir uno">+</button>
              </div>
              <div class="line-total">${money(p.price * l.qty)}</div>
              <button class="link danger" data-qty="0" data-p="${p.id}" data-v="${v.id}">Eliminar</button>
            </li>`;
          }).join("")}
        </ul>
        <aside class="summary card">
          <div class="sum-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
          <div class="sum-row muted"><span>Envío</span><span>Se calcula en el checkout</span></div>
          <a class="btn big full" href="#/checkout">Finalizar compra</a>
        </aside>
      </div>`}`;
  },

  checkout() {
    if (cart.items.length === 0) return `${banner(PLACEMENTS.checkout)}<h1>Checkout</h1><p class="muted">Tu carrito está vacío. <a href="#/">Volver a la tienda</a></p>`;
    const t = totals(cart.items, "standard");
    const u = currentUser || {};
    return `
      ${banner(PLACEMENTS.checkout)}
      <h1>Checkout</h1>
      <div class="two-col">
        <form id="checkout-form" class="card form">
          <h2>Datos de envío</h2>
          ${!currentUser ? `<p class="muted small">Compras como invitado. <button type="button" class="link" data-open="dlg-login">Inicia sesión</button> para asociar el pedido a tu cuenta.</p>` : ""}
          <div class="form-row">
            <label>Nombre <input name="firstName" required value="${esc(u.firstName || "")}" /></label>
            <label>Apellidos <input name="lastName" value="${esc(u.lastName || "")}" /></label>
          </div>
          <label>Email <input name="email" type="email" required value="${esc(u.email || "")}" /></label>
          <label>Dirección <input name="address" required /></label>
          <div class="form-row">
            <label>Ciudad <input name="city" required /></label>
            <label>C.P. <input name="zip" required inputmode="numeric" /></label>
          </div>
          <fieldset class="shipping">
            <legend>Envío</legend>
            ${Object.entries(SHIPPING).map(([k, s], i) => `
              <label class="radio"><input type="radio" name="shipping" value="${k}" ${i === 0 ? "checked" : ""} />
              <span>${s.label}</span><span class="muted">${s.price ? money(s.price) : "Gratis"}</span></label>`).join("")}
          </fieldset>
          <p class="muted small">Demo: no se cobra nada ni se piden datos de pago.</p>
          <button class="btn big full" type="submit">Realizar pedido · <span id="co-total">${money(t.total)}</span></button>
        </form>
        <aside class="summary card">
          <h2>Resumen</h2>
          ${cart.items.map((l) => {
            const p = getProduct(l.productId);
            return `<div class="sum-row"><span>${p.emoji} ${esc(p.name)} (${esc(getVariant(p, l.variantId).label)}) × ${l.qty}</span><span>${money(p.price * l.qty)}</span></div>`;
          }).join("")}
          <hr />
          <div class="sum-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
          <div class="sum-row"><span>Envío</span><span id="co-shipping">${t.shipping ? money(t.shipping) : "Gratis"}</span></div>
          <div class="sum-row total"><span>Total</span><span id="co-total-2">${money(t.total)}</span></div>
        </aside>
      </div>`;
  },

  order(id) {
    const o = orders[id];
    if (!o) return views.notFound();
    return `
      <section class="card confirm">
        <div class="big-emoji">🎉</div>
        <h1>¡Gracias por tu pedido!</h1>
        <p>Pedido <code>${esc(o.id)}</code> · ${new Date(o.date).toLocaleString("es-ES")}</p>
        <p>Total: <strong>${money(o.totals.total)}</strong> · ${esc(SHIPPING[o.shippingMethod].label)}</p>
        <p class="muted small">Se envió <code>ecommerce.order_placed</code> a Braze.</p>
        <a class="btn" href="#/">Seguir comprando</a>
      </section>`;
  },

  notFound() {
    return `<h1>Página no encontrada</h1><p><a href="#/">Volver al inicio</a></p>`;
  },
};

// ---------- Router ----------
let checkoutId = null;

function parseRoute() {
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { parts, params: new URLSearchParams(qs || "") };
}

function route() {
  const { parts, params } = parseRoute();
  const [page, a, b] = parts;
  let html;
  switch (page) {
    case undefined: html = views.home(); break;
    case "category": html = views.category(a, b); break;
    case "product": html = views.product(a); break;
    case "search": html = views.search(params.get("q") || ""); break;
    case "cart": html = views.cart(); break;
    case "checkout": html = views.checkout(); break;
    case "order": html = views.order(a); break;
    default: html = views.notFound();
  }
  $("#view").innerHTML = html;
  closeMenu();
  highlightNav(page === "category" ? a : page === "product" ? getProduct(a)?.category : null);
  $("#header-search [name=q]").value = page === "search" ? params.get("q") || "" : "";
  Braze.renderBanners();
  window.scrollTo(0, 0);

  // Page-level tracking
  if (page === "product" && getProduct(a)) {
    const p = getProduct(a);
    Braze.productViewed(p, p.variants[0]);
  }
  if (page === "search" && params.get("q")) {
    const q = params.get("q");
    Braze.searched(q, searchProducts(q).length);
  }
  if (page === "checkout" && cart.items.length) {
    checkoutId = uid("checkout");
    Braze.checkoutStarted({ checkoutId, cart, totals: totals(cart.items, "standard") });
  }
}

function rerender() {
  // Re-render the current view without re-firing page-view events
  const page = parseRoute().parts[0];
  if (page === "cart" || page === "checkout") {
    $("#view").innerHTML = views[page]();
    Braze.renderBanners($("#view"));
  }
}

// ---------- Header, menu, drawer ----------
function renderMenu() {
  $("#cat-nav").innerHTML = CATEGORIES.map((c) => `
    <li class="nav-item" data-cat="${c.slug}">
      <a class="nav-link" href="#/category/${c.slug}">${c.emoji} ${c.name}</a>
      <div class="mega">
        <div class="mega-col">
          <div class="mega-title">${c.name}</div>
          <a href="#/category/${c.slug}">Ver todo</a>
          ${c.subs.map((s) => `<a href="#/category/${c.slug}/${s.slug}">${s.name}</a>`).join("")}
        </div>
        <div class="mega-feature">
          ${PRODUCTS.filter((p) => p.category === c.slug).slice(0, 2).map((p) => `
            <a class="mini" href="#/product/${p.id}"><span>${p.emoji}</span><span>${esc(p.name)}<br /><span class="muted small">${money(p.price)}</span></span></a>`).join("")}
        </div>
      </div>
    </li>`).join("");
}
function highlightNav(slug) {
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.cat === slug));
}
function closeMenu() {
  $("#menu").classList.remove("open");
  $("#btn-menu").setAttribute("aria-expanded", "false");
}

function renderHeaderUser() {
  const logged = !!currentUser;
  $("#user-status").textContent = logged ? `👤 ${currentUser.firstName}` : "👤 Anónimo";
  $("#user-status").title = logged ? `${currentUser.email} · ${currentUser.userId}` : "Usuario anónimo de Braze";
  $("#user-status").classList.toggle("on", logged);
  $("#btn-open-login").hidden = logged;
  $("#btn-open-signup").hidden = logged;
  $("#btn-logout").hidden = !logged;
}
function renderCartBadge() {
  const n = cartCount();
  $("#cart-count").textContent = n;
  $("#cart-count").hidden = n === 0;
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

let logCount = 0;
Braze.onLog(({ time, call, details, ok }) => {
  const li = document.createElement("li");
  if (!ok) li.className = "bad";
  li.innerHTML = `<span class="muted">${time.toLocaleTimeString("es-ES")}</span> <code>${esc(call)}</code>${ok ? "" : " <strong>✗</strong>"}`;
  if (details !== undefined) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(details, null, 2);
    li.appendChild(pre);
  }
  $("#event-log").prepend(li);
  $("#log-count").textContent = ++logCount;
});

// ---------- Events ----------
document.addEventListener("click", (e) => {
  const qtyBtn = e.target.closest("[data-qty]");
  if (qtyBtn) {
    setQty(qtyBtn.dataset.p, qtyBtn.dataset.v, Number(qtyBtn.dataset.qty));
    return rerender();
  }
  const open = e.target.closest("[data-open]");
  if (open) {
    $("#login-error").hidden = true;
    return $(`#${open.dataset.open}`).showModal();
  }
  const close = e.target.closest("[data-close]");
  if (close) return close.closest("dialog").close();
  // Close the hover mega-menu after picking a link (reopens on next hover)
  const megaLink = e.target.closest(".mega a");
  if (megaLink) megaLink.closest(".nav-item").classList.add("closed");
});
document.addEventListener("mouseout", (e) => {
  const item = e.target.closest?.(".nav-item.closed");
  if (item && !item.contains(e.relatedTarget)) item.classList.remove("closed");
});

$("#btn-menu").addEventListener("click", () => {
  const open = $("#menu").classList.toggle("open");
  $("#btn-menu").setAttribute("aria-expanded", String(open));
});
$("#btn-logout").addEventListener("click", logOut);
$("#btn-log").addEventListener("click", () => $("#log-drawer").classList.toggle("open"));

document.addEventListener("submit", (e) => {
  const form = e.target;

  if (form.matches("[data-search]")) {
    e.preventDefault();
    const q = new FormData(form).get("q").trim();
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
    return;
  }

  if (form.id === "pdp-form") {
    e.preventDefault();
    const f = new FormData(form);
    const qty = Math.max(1, Math.min(10, Number(f.get("qty")) || 1));
    addToCart(form.dataset.product, f.get("variant"), qty);
    return;
  }

  if (form.id === "checkout-form") {
    e.preventDefault();
    const f = new FormData(form);
    const shippingMethod = f.get("shipping");
    if (!currentUser) Braze.setEmail(f.get("email").trim().toLowerCase());
    const order = {
      id: `ORD-${Date.now()}`,
      date: new Date().toISOString(),
      checkoutId,
      shippingMethod,
      items: cart.items.map((l) => ({ ...l })),
      totals: totals(cart.items, shippingMethod),
    };
    Braze.orderPlaced({ order, cart });
    orders[order.id] = order;
    store.set("demo_orders", orders);
    cart = newCart(); // next purchase gets a new cart_id
    saveCart({ track: false });
    location.hash = `#/order/${order.id}`;
    return;
  }

  if (form.id === "form-signup") {
    const f = new FormData(form);
    signUp({
      firstName: f.get("firstName").trim(),
      lastName: f.get("lastName").trim(),
      email: f.get("email"),
      marketing: f.get("marketing") === "on",
    });
    form.reset();
    rerender(); // prefill checkout with the user's data
    return;
  }

  if (form.id === "form-login") {
    if (!logIn(new FormData(form).get("email"))) {
      e.preventDefault(); // keep the dialog open
      $("#login-error").textContent = "No hay ninguna cuenta con ese email en este navegador. Regístrate primero.";
      $("#login-error").hidden = false;
    } else {
      form.reset();
      rerender(); // prefill checkout with the user's data
    }
  }
});

// Live-update checkout totals when the shipping method changes
document.addEventListener("change", (e) => {
  if (e.target.name === "variant" && e.target.form?.id === "pdp-form") {
    const p = getProduct(e.target.form.dataset.product);
    Braze.productViewed(p, getVariant(p, e.target.value)); // viewing a different variant
  }
  if (e.target.name === "shipping") {
    const t = totals(cart.items, e.target.value);
    $("#co-total").textContent = money(t.total);
    $("#co-total-2").textContent = money(t.total);
    $("#co-shipping").textContent = t.shipping ? money(t.shipping) : "Gratis";
  }
});

// ---------- Boot ----------
if (!Braze.ready) $("#config-warning").hidden = false;
renderMenu();
renderHeaderUser();
renderCartBadge();
Braze.init(currentUser?.userId);
window.addEventListener("hashchange", route);
route();
