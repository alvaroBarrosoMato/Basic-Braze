/* Every Braze SDK call in the app lives in this file.
 *
 * - Session + users: initialize, openSession, changeUser, profile attributes
 * - eCommerce recommended events (braze.logEcommerceEvent, Web SDK 6.8+):
 *     ecommerce.product_viewed, ecommerce.cart_updated,
 *     ecommerce.checkout_started, ecommerce.order_placed
 *   https://www.braze.com/docs/user_guide/data/activation/events/recommended_events
 * - Banners: one refresh for all placements, rendered into [data-placement] slots
 */
import { config, PLACEMENTS, CURRENCY, EVENT_SOURCE } from "./config.js";
import { getProduct, getVariant, getCategory, fullVariantId } from "./catalog.js";

const sdk = window.braze;
export const ready = !!sdk && !!config.baseUrl && !config.baseUrl.includes("YOUR-");

// ---------- Activity log (feeds the "Braze log" drawer) ----------
const listeners = [];
export const onLog = (fn) => listeners.push(fn);
function log(call, details, ok = true) {
  const entry = { time: new Date(), call, details, ok };
  listeners.forEach((fn) => fn(entry));
  console.log("[braze]", call, details ?? "", ok ? "" : "(rejected by SDK)");
}

// ---------- Session & users ----------
export function init(userId) {
  if (!ready) {
    log("SDK no inicializado", { reason: sdk ? "baseUrl sin configurar en js/config.js" : "no cargó el script del SDK" }, false);
    return;
  }
  sdk.initialize(config.apiKey, {
    baseUrl: config.baseUrl,
    enableLogging: config.enableLogging,
    // Required for Banners (and HTML in-app messages): lets HTML/JS authored in
    // the Braze dashboard run on this site. Only dashboard users can author it.
    allowUserSuppliedJavascript: true,
  });
  log("braze.initialize", { baseUrl: config.baseUrl });

  sdk.automaticallyShowInAppMessages();

  // No changeUser = anonymous user for this browser
  if (userId) {
    sdk.changeUser(userId);
    log("braze.changeUser", { userId });
  }

  // Subscribe before refreshing so dashboard changes are rendered as they arrive
  sdk.subscribeToBannersUpdates(() => renderBanners());
  refreshBanners();

  sdk.openSession(); // always last
  log("braze.openSession", { user: userId || "anonymous" });
}

export function signUp({ userId, firstName, lastName, email, marketing }) {
  if (!ready) return;
  // Anonymous activity so far is merged into this new profile
  sdk.changeUser(userId);
  const user = sdk.getUser();
  user.setFirstName(firstName);
  if (lastName) user.setLastName(lastName);
  user.setEmail(email);
  const types = sdk.User.NotificationSubscriptionTypes;
  user.setEmailNotificationSubscriptionType(marketing ? types.OPTED_IN : types.SUBSCRIBED);
  user.setCustomUserAttribute("signup_date", new Date());
  const ok = sdk.logCustomEvent("signed_up", { method: "email" });
  sdk.requestImmediateDataFlush();
  log("braze.changeUser + atributos de perfil", { userId, firstName, lastName, email, marketing });
  log("braze.logCustomEvent · signed_up", { method: "email" }, ok);
  refreshBanners(); // banners are targeted per user
}

export function logIn(userId) {
  if (!ready) return;
  sdk.changeUser(userId);
  const ok = sdk.logCustomEvent("logged_in");
  sdk.requestImmediateDataFlush();
  log("braze.changeUser", { userId });
  log("braze.logCustomEvent · logged_in", undefined, ok);
  refreshBanners();
}

// Braze can't turn an identified user back into an anonymous one: flush, wipe
// the SDK's local data, and reload so a fresh anonymous user starts.
export function logOut(onDone) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (ready) sdk.wipeData();
    onDone();
  };
  if (!ready) return finish();
  const ok = sdk.logCustomEvent("logged_out");
  log("braze.logCustomEvent · logged_out", undefined, ok);
  sdk.requestImmediateDataFlush(finish);
  setTimeout(finish, 1500); // in case the flush callback never fires
}

// Guest checkout: attach the email to the current (possibly anonymous) profile
export function setEmail(email) {
  if (!ready || !email) return;
  sdk.getUser().setEmail(email);
  log("braze.getUser().setEmail", { email });
}

// ---------- eCommerce recommended events ----------
const productUrl = (id) => `${location.origin}${location.pathname}#/product/${encodeURIComponent(id)}`;

// Cart line { productId, variantId, qty } -> products[] item of the Braze schema
function toEcomProduct(line) {
  const product = getProduct(line.productId);
  const variant = getVariant(product, line.variantId);
  return {
    product_id: product.id,
    product_name: product.name,
    variant_id: fullVariantId(product, variant),
    quantity: line.qty,
    price: product.price,
    product_url: productUrl(product.id),
    metadata: { category: getCategory(product.category).name, variant: variant.label },
  };
}

function ecommerce(name, properties) {
  const ok = ready ? sdk.logEcommerceEvent({ name, properties }) : false;
  log(`braze.logEcommerceEvent · ${name}`, properties, ready ? ok : false);
  return ok;
}

export function productViewed(product, variant) {
  return ecommerce("ecommerce.product_viewed", {
    product_id: product.id,
    product_name: product.name,
    variant_id: fullVariantId(product, variant),
    product_url: productUrl(product.id),
    price: product.price,
    currency: CURRENCY,
    source: EVENT_SOURCE,
    metadata: { category: getCategory(product.category).name, variant: variant.label },
  });
}

// Full-replacement mode (no "action"): always send the whole cart with absolute quantities
export function cartUpdated(cart, totals) {
  return ecommerce("ecommerce.cart_updated", {
    cart_id: cart.id,
    total_value: totals.total,
    subtotal_value: totals.subtotal,
    currency: CURRENCY,
    products: cart.items.map(toEcomProduct),
    source: EVENT_SOURCE,
  });
}

export function checkoutStarted({ checkoutId, cart, totals }) {
  return ecommerce("ecommerce.checkout_started", {
    checkout_id: checkoutId,
    cart_id: cart.id,
    total_value: totals.total,
    subtotal_value: totals.subtotal,
    shipping: totals.shipping,
    currency: CURRENCY,
    products: cart.items.map(toEcomProduct),
    source: EVENT_SOURCE,
    metadata: { checkout_url: `${location.origin}${location.pathname}#/checkout` },
  });
}

// order_placed is the revenue event: it updates total_revenue / total_orders on the
// profile, so we don't also call the legacy braze.logPurchase (it would double count).
export function orderPlaced({ order, cart }) {
  const ok = ecommerce("ecommerce.order_placed", {
    order_id: order.id,
    cart_id: cart.id,
    total_value: order.totals.total,
    subtotal_value: order.totals.subtotal,
    shipping: order.totals.shipping,
    currency: CURRENCY,
    products: order.items.map(toEcomProduct),
    source: EVENT_SOURCE,
    metadata: {
      checkout_id: order.checkoutId,
      shipping_method: order.shippingMethod,
      order_status_url: `${location.origin}${location.pathname}#/order/${order.id}`,
    },
  });
  if (ready) sdk.requestImmediateDataFlush();
  return ok;
}

// Search isn't part of the eCommerce spec, so it stays a custom event
export function searched(query, resultsCount) {
  const props = { query, results_count: resultsCount };
  const ok = ready ? sdk.logCustomEvent("product_searched", props) : false;
  log("braze.logCustomEvent · product_searched", props, ok);
}

// Exit intent with items in the cart. Use it as the "Perform Custom Event"
// trigger of an in-app message campaign (triggers are evaluated in the browser,
// so the message can show right away without waiting for a flush).
export function exitIntentWithCart(cart, totals, itemCount) {
  const props = {
    cart_item_count: itemCount,
    cart_value: totals.total,
    currency: CURRENCY,
    cart_id: cart.id,
    page: location.hash || "#/",
  };
  const ok = ready ? sdk.logCustomEvent("exit_intent_with_cart", props) : false;
  log("braze.logCustomEvent · exit_intent_with_cart", props, ok);
}

// ---------- Banners ----------
const ALL_PLACEMENTS = Object.values(PLACEMENTS);

export function refreshBanners() {
  if (!ready) return;
  sdk.requestBannersRefresh(ALL_PLACEMENTS);
  log("braze.requestBannersRefresh", ALL_PLACEMENTS);
}

// Fill every [data-placement] slot currently on the page. Called after each
// route render and whenever Braze pushes new banner content.
export function renderBanners(root = document) {
  root.querySelectorAll("[data-placement]").forEach((slot) => {
    const id = slot.dataset.placement;
    const banner = ready ? sdk.getBanner(id) : null;
    slot.innerHTML = "";
    slot.classList.remove("has-banner", "placeholder");

    if (banner && !banner.isControl) {
      slot.classList.add("has-banner");
      // Renders the dashboard HTML; logs impressions (when visible) and clicks
      sdk.insertBanner(banner, slot);
      return;
    }
    // No campaign for this user, or user is in the control group
    if (config.showBannerPlaceholders && !(banner && banner.isControl)) {
      slot.classList.add("placeholder");
      slot.textContent = `Banner · ${id} (sin campaña activa)`;
    }
  });
}
