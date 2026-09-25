// Client for the shop API (api/_shop.py). Data lives in Databricks.
import { config } from "./config.js";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${config.apiBase}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "No se pudo conectar con el servidor.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  catalog: () => request("GET", "/api/catalog"),
  signUp: (user) => request("POST", "/api/users/signup", user),
  logIn: (email) => request("POST", "/api/users/login", { email }),
  userOrders: (userId) => request("GET", `/api/users/${encodeURIComponent(userId)}/orders`),
  placeOrder: (order) => request("POST", "/api/orders", order),
  getOrder: (orderId) => request("GET", `/api/orders/${encodeURIComponent(orderId)}`),
};
