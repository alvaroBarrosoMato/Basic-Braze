/* Braze Test Shop — minimal Braze Web SDK integration.
 *
 * Covers:
 *  - SDK init + session for anonymous users
 *  - Sign up / log in (braze.changeUser + profile attributes) / log out
 *  - Cart events (add / remove / checkout) and purchases (braze.logPurchase)
 *  - A Banner placement ("my_first_banner") that updates from the Braze dashboard
 */

const cfg = window.BRAZE_CONFIG;
const CURRENCY = "USD";

const PRODUCTS = [
  { id: "sku_tshirt", name: "Logo T-Shirt", price: 25, emoji: "👕" },
  { id: "sku_mug", name: "Coffee Mug", price: 12, emoji: "☕" },
  { id: "sku_cap", name: "Baseball Cap", price: 18, emoji: "🧢" },
  { id: "sku_hoodie", name: "Hoodie", price: 55, emoji: "🧥" },
  { id: "sku_stickers", name: "Sticker Pack", price: 5, emoji: "✨" },
  { id: "sku_bottle", name: "Water Bottle", price: 20, emoji: "🥤" },
];

// ---------- Local demo storage (stands in for a real backend) ----------
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// accounts: { [email]: { userId, firstName, lastName } }
let accounts = store.get("demo_accounts", {});
let currentUser = store.get("demo_current_user", null); // { userId, email, firstName, lastName }
let cart = store.get("demo_cart", []); // [{ id, qty }]

// ---------- Activity log (shows what we sent to Braze) ----------
function log(call, details) {
  const li = document.createElement("li");
  const time = new Date().toLocaleTimeString();
  li.innerHTML = `<span class="muted">${time}</span> <code>${call}</code>`;
  if (details !== undefined) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(details, null, 1);
    li.appendChild(pre);
  }
  const list = document.getElementById("event-log");
  list.prepend(li);
  console.log("[braze]", call, details ?? "");
}

// ---------- Braze setup ----------
const brazeReady = typeof window.braze !== "undefined" && cfg.baseUrl && !cfg.baseUrl.includes("YOUR-");

function initBraze() {
  if (!brazeReady) {
    document.getElementById("config-warning").hidden = false;
    log("SDK not initialized", { reason: typeof window.braze === "undefined" ? "SDK script failed to load" : "baseUrl not set in config.js" });
    return;
  }

  braze.initialize(cfg.apiKey, {
    baseUrl: cfg.baseUrl,
    enableLogging: cfg.enableLogging,
    allowUserSuppliedJavascript: false,
  });
  log("braze.initialize", { baseUrl: cfg.baseUrl });

  // Show in-app messages created in the dashboard (optional, but free to enable)
  braze.automaticallyShowInAppMessages();

  // If someone was logged in before the page reload, keep them identified.
  // With no changeUser call, Braze tracks an anonymous user for this browser.
  if (currentUser) {
    braze.changeUser(currentUser.userId);
    log("braze.changeUser", { userId: currentUser.userId });
  }

  setupBanners();

  // openSession goes last, after changeUser
  braze.openSession();
  log("braze.openSession", { user: currentUser ? currentUser.userId : "anonymous" });
}

// ---------- Banners ----------
function setupBanners() {
  // 1) Subscribe first, so we render whatever the SDK receives — including
  //    changes you publish from the Braze dashboard later.
  braze.subscribeToBannersUpdates(() => {
    renderBanner();
  });
  // 2) Then ask Braze for the latest banner for our placement.
  refreshBanners();
}

function refreshBanners() {
  if (!brazeReady) return;
  braze.requestBannersRefresh([cfg.bannerPlacementId]);
  log("braze.requestBannersRefresh", [cfg.bannerPlacementId]);
}

function renderBanner() {
  const container = document.getElementById("banner-container");
  const empty = document.getElementById("banner-empty");
  const banner = braze.getBanner(cfg.bannerPlacementId);

  container.innerHTML = "";
  if (!banner || banner.isControl) {
    // No active campaign for this user, or user is in the control group
    container.style.display = "none";
    empty.hidden = !!(banner && banner.isControl);
    if (banner && banner.isControl) log("banner is control variant (hidden)");
    return;
  }

  container.style.display = "block";
  empty.hidden = true;
  // insertBanner renders the HTML from the dashboard and automatically
  // logs impressions (when visible) and clicks.
  braze.insertBanner(banner, container);
  log("braze.insertBanner", { placement: cfg.bannerPlacementId });
}

// ---------- Auth ----------
function newUserId() {
  // Opaque, stable external ID. Avoid using emails as external IDs.
  return "user_" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

function signUp({ firstName, lastName, email, marketing }) {
  email = email.trim().toLowerCase();
  const existing = accounts[email];
  const userId = existing ? existing.userId : newUserId();
  accounts[email] = { userId, firstName, lastName };
  store.set("demo_accounts", accounts);

  currentUser = { userId, email, firstName, lastName };
  store.set("demo_current_user", currentUser);

  if (brazeReady) {
    // Identify: anonymous activity so far is merged into this new profile
    braze.changeUser(userId);
    const user = braze.getUser();
    user.setFirstName(firstName);
    if (lastName) user.setLastName(lastName);
    user.setEmail(email);
    user.setEmailNotificationSubscriptionType(
      marketing ? braze.User.NotificationSubscriptionTypes.OPTED_IN : braze.User.NotificationSubscriptionTypes.SUBSCRIBED
    );
    user.setCustomUserAttribute("signup_date", new Date());
    braze.logCustomEvent("signed_up", { method: "email" });
    braze.requestImmediateDataFlush();
    log("braze.changeUser + profile", { userId, firstName, lastName, email, marketing });
    log("braze.logCustomEvent", { name: "signed_up" });
    refreshBanners(); // banners are targeted per user
  }
  renderUser();
}

function logIn(email) {
  email = email.trim().toLowerCase();
  const account = accounts[email];
  if (!account) return false;

  currentUser = { userId: account.userId, email, firstName: account.firstName, lastName: account.lastName };
  store.set("demo_current_user", currentUser);

  if (brazeReady) {
    braze.changeUser(account.userId);
    braze.logCustomEvent("logged_in");
    braze.requestImmediateDataFlush();
    log("braze.changeUser", { userId: account.userId });
    log("braze.logCustomEvent", { name: "logged_in" });
    refreshBanners();
  }
  renderUser();
  return true;
}

function logOut() {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    // Braze can't switch an identified user back to anonymous. wipeData()
    // clears the SDK's local data; after reload a fresh anonymous user starts.
    if (brazeReady) braze.wipeData();
    currentUser = null;
    store.remove("demo_current_user");
    cart = [];
    store.remove("demo_cart");
    location.reload();
  };

  if (brazeReady) {
    braze.logCustomEvent("logged_out");
    log("braze.logCustomEvent", { name: "logged_out" });
    braze.requestImmediateDataFlush(() => finish());
    setTimeout(finish, 1500); // safety net if the flush callback never fires
  } else {
    finish();
  }
}

function renderUser() {
  const status = document.getElementById("user-status");
  const loggedIn = !!currentUser;
  status.textContent = loggedIn ? `${currentUser.firstName} (${currentUser.email})` : "Anonymous";
  status.classList.toggle("on", loggedIn);
  document.getElementById("btn-open-login").hidden = loggedIn;
  document.getElementById("btn-open-signup").hidden = loggedIn;
  document.getElementById("btn-logout").hidden = !loggedIn;
}

// ---------- Cart ----------
const product = (id) => PRODUCTS.find((p) => p.id === id);
const money = (n) => `$${n.toFixed(2)}`;
const cartTotal = () => cart.reduce((sum, i) => sum + product(i.id).price * i.qty, 0);
const cartCount = () => cart.reduce((sum, i) => sum + i.qty, 0);

function saveCart() {
  store.set("demo_cart", cart);
  if (brazeReady) {
    // Handy for segmentation / abandoned-cart campaigns
    braze.getUser().setCustomUserAttribute("cart_item_count", cartCount());
    braze.getUser().setCustomUserAttribute("cart_value", cartTotal());
  }
  renderCart();
}

function addToCart(id) {
  const p = product(id);
  const line = cart.find((i) => i.id === id);
  if (line) line.qty += 1; else cart.push({ id, qty: 1 });
  const props = { product_id: p.id, product_name: p.name, price: p.price, currency: CURRENCY };
  if (brazeReady) braze.logCustomEvent("added_to_cart", props);
  log("braze.logCustomEvent", { name: "added_to_cart", ...props });
  saveCart();
}

function removeFromCart(id) {
  const p = product(id);
  const line = cart.find((i) => i.id === id);
  if (!line) return;
  line.qty -= 1;
  if (line.qty <= 0) cart = cart.filter((i) => i.id !== id);
  const props = { product_id: p.id, product_name: p.name, price: p.price, currency: CURRENCY };
  if (brazeReady) braze.logCustomEvent("removed_from_cart", props);
  log("braze.logCustomEvent", { name: "removed_from_cart", ...props });
  saveCart();
}

function checkout() {
  if (!cart.length) return;
  const orderId = "order_" + Date.now();
  const total = cartTotal();
  const items = cart.map((i) => ({ product_id: i.id, quantity: i.qty }));

  if (brazeReady) {
    braze.logCustomEvent("checkout_started", { order_id: orderId, total, item_count: cartCount() });
    // One purchase per product line — this is what powers Braze revenue reporting
    for (const i of cart) {
      const p = product(i.id);
      braze.logPurchase(p.id, p.price, CURRENCY, i.qty, { order_id: orderId, product_name: p.name });
    }
    braze.logCustomEvent("checkout_completed", { order_id: orderId, total, item_count: cartCount() });
    braze.requestImmediateDataFlush();
  }
  log("braze.logCustomEvent", { name: "checkout_started", order_id: orderId });
  for (const i of cart) log("braze.logPurchase", { productId: i.id, price: product(i.id).price, currency: CURRENCY, quantity: i.qty });
  log("braze.logCustomEvent", { name: "checkout_completed", order_id: orderId, total, items });

  document.getElementById("thanks-text").textContent = `Order ${orderId} — ${money(total)}. Purchases were logged to Braze.`;
  cart = [];
  saveCart();
  document.getElementById("dlg-thanks").showModal();
}

function renderProducts() {
  document.getElementById("products").innerHTML = PRODUCTS.map((p) => `
    <div class="product">
      <div class="emoji">${p.emoji}</div>
      <div class="name">${p.name}</div>
      <div class="price">${money(p.price)}</div>
      <button class="btn full" data-add="${p.id}">Add to cart</button>
    </div>`).join("");
}

function renderCart() {
  const list = document.getElementById("cart-items");
  list.innerHTML = cart.map((i) => {
    const p = product(i.id);
    return `<li>
      <span>${p.emoji} ${p.name} × ${i.qty}</span>
      <span class="line-actions">
        ${money(p.price * i.qty)}
        <button class="btn tiny ghost" data-remove="${p.id}" aria-label="Remove one ${p.name}">−</button>
        <button class="btn tiny ghost" data-add="${p.id}" aria-label="Add one ${p.name}">+</button>
      </span>
    </li>`;
  }).join("");
  document.getElementById("cart-empty").hidden = cart.length > 0;
  document.getElementById("cart-total").textContent = money(cartTotal());
  document.getElementById("btn-checkout").disabled = cart.length === 0;
}

// ---------- Wire up UI ----------
document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) return addToCart(add.dataset.add);
  const remove = e.target.closest("[data-remove]");
  if (remove) return removeFromCart(remove.dataset.remove);
  const close = e.target.closest("[data-close]");
  if (close) close.closest("dialog").close();
});

document.getElementById("btn-open-signup").onclick = () => document.getElementById("dlg-signup").showModal();
document.getElementById("btn-open-login").onclick = () => {
  document.getElementById("login-error").hidden = true;
  document.getElementById("dlg-login").showModal();
};
document.getElementById("btn-logout").onclick = logOut;
document.getElementById("btn-checkout").onclick = checkout;

document.getElementById("form-signup").addEventListener("submit", (e) => {
  const f = new FormData(e.target);
  signUp({
    firstName: f.get("firstName").trim(),
    lastName: f.get("lastName").trim(),
    email: f.get("email"),
    marketing: f.get("marketing") === "on",
  });
  e.target.reset();
});

document.getElementById("form-login").addEventListener("submit", (e) => {
  const email = new FormData(e.target).get("email");
  if (!logIn(email)) {
    e.preventDefault(); // keep dialog open
    const err = document.getElementById("login-error");
    err.textContent = "No account with that email in this browser. Sign up first.";
    err.hidden = false;
  } else {
    e.target.reset();
  }
});

renderProducts();
renderCart();
renderUser();
initBraze();
