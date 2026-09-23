# Braze Test Shop

A tiny web storefront for trying out the [Braze Web SDK](https://www.braze.com/docs/developer_guide/sdk_integration) (v6.13).
Plain HTML/CSS/JS — no build step, no dependencies.

## What it does with Braze

| Feature | Braze SDK calls |
|---|---|
| Anonymous visitor | `braze.initialize` → `braze.openSession` (no `changeUser`, so Braze tracks an anonymous user) |
| Sign up | `changeUser(userId)`, `setFirstName`, `setLastName`, `setEmail`, `setEmailNotificationSubscriptionType`, custom attribute `signup_date`, custom event `signed_up` |
| Log in | `changeUser(userId)`, custom event `logged_in` |
| Log out | custom event `logged_out`, then `wipeData()` + reload → new anonymous user |
| Add / remove from cart | custom events `added_to_cart` / `removed_from_cart` (props: `product_id`, `product_name`, `price`, `currency`), custom attributes `cart_item_count`, `cart_value` |
| Checkout | custom event `checkout_started`, one `logPurchase` per product, custom event `checkout_completed` |
| Banner | `subscribeToBannersUpdates` → `requestBannersRefresh(["my_first_banner"])` → `getBanner` + `insertBanner` |
| In-app messages | `automaticallyShowInAppMessages()` |

When a user signs up, the anonymous activity from before (cart events, etc.) is merged into their new profile.
The page's **Braze activity** panel lists every SDK call as it happens.

> Accounts are stored in the browser's `localStorage` (email → user ID). There's no real backend or password — it's a demo.
> External IDs are random `user_<uuid>` values; Braze recommends not using emails as external IDs.

## Setup

1. Open `config.js` and set `baseUrl` to your **SDK Endpoint** from the Braze dashboard
   (Settings → App Settings → your Web app), e.g. `sdk.iad-01.braze.com`.
2. Serve the folder (any static server works):

   ```bash
   python3 -m http.server 8080
   ```

3. Open http://localhost:8080.

## Showing the banner

1. In Braze, go to **Messaging → Banners** and confirm the placement `my_first_banner` exists
   (Settings → Banner Placements).
2. Create a Banner campaign using that placement, target your users (or everyone), and launch it.
3. Reload the page — the banner renders at the top. Edit the campaign in the dashboard and the page picks it up
   on the next refresh (page load, sign up, or log in), no code changes needed.

Braze logs banner impressions and clicks automatically because the page uses `insertBanner`.

## Checking data in Braze

- **Users → User Search**: look up a user by email or external ID to see attributes, custom events and purchases.
- **Settings → Custom Events / Purchases**: new event names appear after the first time they're logged.
- Open the browser console: `enableLogging: true` in `config.js` prints the SDK's own logs.
