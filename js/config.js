// Braze configuration — values come from the Braze dashboard:
// Settings > App Settings > (your Web app)
export const config = {
  apiKey: "6c30e0b3-6ded-45c8-9a8d-7eadbb065447",
  // SDK Endpoint from the dashboard
  baseUrl: "sdk.fra-02.braze.eu",
  // Verbose SDK logs in the browser console — turn off for production
  enableLogging: true,
  // Show a dashed placeholder where a banner placement has no active campaign
  showBannerPlaceholders: true,
};

// Banner placements created in Braze (Settings > Banner Placements)
export const PLACEMENTS = {
  global: "my_first_banner", // every page, above the footer
  home: "home_top",
  search: "search_top",
  cart: "cart_banner",
  checkout: "checkout_banner",
};

export const CURRENCY = "EUR";
// "source" property for eCommerce recommended events
export const EVENT_SOURCE = "web";
