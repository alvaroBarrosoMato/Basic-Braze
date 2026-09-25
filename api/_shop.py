"""Shop API: catalogue, users and orders stored in Databricks Delta tables.

Framework-agnostic: handle(method, path, body) -> (status, headers, body_bytes).
Used by api/index.py on Vercel and by dev_server.py locally.

Routes
  GET  /api/health                 checks the Databricks connection
  GET  /api/catalog                categories, subcategories, products + variants
  POST /api/users/signup           {email, firstName, lastName, marketing}
  POST /api/users/login            {email}
  GET  /api/users/<user_id>/orders order history
  POST /api/orders                 {userId?, email, firstName, lastName, address, city, zip,
                                    shippingMethod, cartId, checkoutId, items: [{productId, variantId, qty}]}
  GET  /api/orders/<order_id>      one order with its items
"""
import json
import re
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

import _databricks as db

CURRENCY = "EUR"
SOURCE = "web"
SHIPPING = {"standard": Decimal("0.00"), "express": Decimal("5.95")}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_LINES, MAX_QTY = 50, 99


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


# ---------- helpers ----------
def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def _money(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _bool(value):
    return str(value).lower() in ("true", "1")


def _text(body, key, max_len=200, required=False):
    value = str(body.get(key) or "").strip()[:max_len]
    if required and not value:
        raise ApiError(400, f"'{key}' is required")
    return value


def _email(body):
    email = _text(body, "email", 254, required=True).lower()
    if not EMAIL_RE.match(email):
        raise ApiError(400, "Invalid email")
    return email


def _iso(ts):
    # Databricks returns "2026-09-24T10:00:00.000Z" / "2026-09-24 10:00:00"
    return ts.replace(" ", "T") if ts else None


def _user_json(row):
    return {
        "userId": row["user_id"],
        "email": row["email"],
        "firstName": row["first_name"] or "",
        "lastName": row["last_name"] or "",
        "marketing": _bool(row["email_marketing_opt_in"]),
        "createdAt": _iso(row["created_at"]),
    }


USER_COLS = "user_id, email, first_name, last_name, email_marketing_opt_in, created_at"


# ---------- catalogue ----------
def get_catalog():
    queries = {
        "categories": "SELECT category_id, name, emoji FROM categories ORDER BY sort_order",
        "subcategories": "SELECT subcategory_id, category_id, name FROM subcategories ORDER BY sort_order",
        "products": """SELECT product_id, name, description, category_id, subcategory_id, price, currency, emoji, image_url
                       FROM products WHERE is_active ORDER BY sort_order""",
        "variants": """SELECT variant_id, product_id, variant_code, label, variant_type
                       FROM product_variants WHERE is_active ORDER BY product_id, sort_order""",
    }
    # 4 small queries in parallel: one warehouse round trip instead of four
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {k: pool.submit(db.execute, q) for k, q in queries.items()}
        data = {k: f.result() for k, f in futures.items()}

    subs_by_cat = {}
    for s in data["subcategories"]:
        subs_by_cat.setdefault(s["category_id"], []).append({"slug": s["subcategory_id"], "name": s["name"]})
    variants_by_product = {}
    for v in data["variants"]:
        variants_by_product.setdefault(v["product_id"], []).append(
            {"id": v["variant_code"], "variantId": v["variant_id"], "label": v["label"], "type": v["variant_type"]}
        )
    return {
        "categories": [
            {"slug": c["category_id"], "name": c["name"], "emoji": c["emoji"] or "", "subs": subs_by_cat.get(c["category_id"], [])}
            for c in data["categories"]
        ],
        "products": [
            {
                "id": p["product_id"],
                "name": p["name"],
                "description": p["description"] or "",
                "category": p["category_id"],
                "sub": p["subcategory_id"],
                "price": float(p["price"]),
                "currency": p["currency"],
                "emoji": p["emoji"] or "🛍️",
                "imageUrl": p["image_url"],
                "variants": variants_by_product[p["product_id"]],
            }
            for p in data["products"]
            if p["product_id"] in variants_by_product  # a product needs at least one variant to be sold
        ],
    }


# ---------- users ----------
def _find_user(email):
    rows = db.execute(f"SELECT {USER_COLS} FROM users WHERE email = :email LIMIT 1", {"email": email})
    return rows[0] if rows else None


def signup(body):
    email = _email(body)
    if _find_user(email):
        raise ApiError(409, "Ya existe una cuenta con ese email. Inicia sesión.")
    now = _now()
    row = {
        "user_id": f"user_{uuid.uuid4()}",  # opaque ID, also used as the Braze external_id
        "email": email,
        "first_name": _text(body, "firstName", 100, required=True),
        "last_name": _text(body, "lastName", 100),
        "email_marketing_opt_in": bool(body.get("marketing")),
        "created_at": now,
    }
    db.execute(
        """INSERT INTO users (user_id, email, first_name, last_name, email_marketing_opt_in, created_at, last_login_at)
           VALUES (:user_id, :email, :first_name, :last_name, :email_marketing_opt_in, :created_at, :created_at)""",
        row,
    )
    return _user_json({**row, "created_at": now.isoformat()})


def login(body):
    user = _find_user(_email(body))
    if not user:
        raise ApiError(404, "No hay ninguna cuenta con ese email. Regístrate primero.")
    db.execute("UPDATE users SET last_login_at = :now WHERE user_id = :user_id", {"now": _now(), "user_id": user["user_id"]})
    return _user_json(user)


def _user_exists(user_id):
    return bool(db.execute("SELECT user_id FROM users WHERE user_id = :user_id LIMIT 1", {"user_id": user_id}))


def list_user_orders(user_id):
    rows = db.execute(
        """SELECT o.order_id, o.created_at, o.total, o.currency, o.status, SUM(i.quantity) AS item_count
           FROM orders o LEFT JOIN order_items i ON i.order_id = o.order_id
           WHERE o.user_id = :user_id
           GROUP BY o.order_id, o.created_at, o.total, o.currency, o.status
           ORDER BY o.created_at DESC
           LIMIT 50""",
        {"user_id": user_id},
    )
    return {
        "orders": [
            {
                "orderId": r["order_id"],
                "createdAt": _iso(r["created_at"]),
                "total": float(r["total"]),
                "currency": r["currency"],
                "status": r["status"],
                "itemCount": int(float(r["item_count"] or 0)),
            }
            for r in rows
        ]
    }


# ---------- orders ----------
def create_order(body):
    items = body.get("items")
    if not isinstance(items, list) or not items:
        raise ApiError(400, "The order has no items")
    if len(items) > MAX_LINES:
        raise ApiError(400, "Too many lines")

    shipping_method = body.get("shippingMethod")
    if shipping_method not in SHIPPING:
        raise ApiError(400, "Invalid shipping method")

    user_id = _text(body, "userId", 100) or None
    if user_id and not _user_exists(user_id):
        raise ApiError(400, "Unknown user")

    # Merge duplicate lines and validate quantities
    wanted = {}
    for it in items:
        try:
            qty = int(it.get("qty"))
        except (TypeError, ValueError):
            raise ApiError(400, "Invalid quantity") from None
        if not 1 <= qty <= MAX_QTY:
            raise ApiError(400, "Invalid quantity")
        variant_id = f"{it.get('productId')}-{it.get('variantId')}"
        wanted[variant_id] = wanted.get(variant_id, 0) + qty

    # Prices and names always come from Databricks, never from the browser
    placeholders = ", ".join(f":v{i}" for i in range(len(wanted)))
    rows = db.execute(
        f"""SELECT v.variant_id, v.label, p.product_id, p.name, p.price
            FROM product_variants v JOIN products p ON p.product_id = v.product_id
            WHERE v.is_active AND p.is_active AND v.variant_id IN ({placeholders})""",
        {f"v{i}": vid for i, vid in enumerate(wanted)},
    )
    found = {r["variant_id"]: r for r in rows}
    missing = [vid for vid in wanted if vid not in found]
    if missing:
        raise ApiError(409, f"Productos no disponibles: {', '.join(missing)}")

    lines = []
    for n, (variant_id, qty) in enumerate(wanted.items(), start=1):
        r = found[variant_id]
        price = _money(r["price"])
        lines.append({
            "line_number": n, "product_id": r["product_id"], "variant_id": variant_id,
            "product_name": r["name"], "variant_label": r["label"],
            "unit_price": price, "quantity": qty, "line_total": _money(price * qty),
        })

    subtotal = _money(sum(l["line_total"] for l in lines))
    shipping = SHIPPING[shipping_method]
    order = {
        "order_id": f"ORD-{uuid.uuid4().hex[:12].upper()}",
        "user_id": user_id,
        "email": _email(body),
        "first_name": _text(body, "firstName", 100, required=True),
        "last_name": _text(body, "lastName", 100),
        "shipping_address": _text(body, "address", 300, required=True),
        "shipping_city": _text(body, "city", 100, required=True),
        "shipping_postal_code": _text(body, "zip", 20, required=True),
        "shipping_method": shipping_method,
        "cart_id": _text(body, "cartId", 100) or None,
        "checkout_id": _text(body, "checkoutId", 100) or None,
        "subtotal": subtotal,
        "shipping_cost": shipping,
        "total": _money(subtotal + shipping),
        "currency": CURRENCY,
        "status": "placed",
        "source": SOURCE,
        "created_at": _now(),
    }

    db.execute(
        f"INSERT INTO orders ({', '.join(order)}) VALUES ({', '.join(':' + k for k in order)})",
        order,
    )
    # All lines in one INSERT
    values, params = [], {"order_id": order["order_id"]}
    for i, l in enumerate(lines):
        values.append(f"(:order_id, :ln{i}, :pid{i}, :vid{i}, :name{i}, :label{i}, :price{i}, :qty{i}, :total{i})")
        params.update({
            f"ln{i}": l["line_number"], f"pid{i}": l["product_id"], f"vid{i}": l["variant_id"],
            f"name{i}": l["product_name"], f"label{i}": l["variant_label"], f"price{i}": l["unit_price"],
            f"qty{i}": l["quantity"], f"total{i}": l["line_total"],
        })
    db.execute(
        f"""INSERT INTO order_items (order_id, line_number, product_id, variant_id, product_name,
                                     variant_label, unit_price, quantity, line_total)
            VALUES {', '.join(values)}""",
        params,
    )
    return _order_json(order, lines)


def _order_json(o, lines):
    return {
        "orderId": o["order_id"],
        "userId": o["user_id"],
        "email": o["email"],
        "createdAt": _iso(o["created_at"].isoformat() if isinstance(o["created_at"], datetime) else o["created_at"]),
        "status": o["status"],
        "shippingMethod": o["shipping_method"],
        "cartId": o["cart_id"],
        "checkoutId": o["checkout_id"],
        "currency": o["currency"],
        "subtotal": float(o["subtotal"]),
        "shipping": float(o["shipping_cost"]),
        "total": float(o["total"]),
        "items": [
            {
                "productId": l["product_id"],
                "variantId": l["variant_id"],
                "productName": l["product_name"],
                "variantLabel": l["variant_label"],
                "unitPrice": float(l["unit_price"]),
                "quantity": int(float(l["quantity"])),
                "lineTotal": float(l["line_total"]),
            }
            for l in lines
        ],
    }


def get_order(order_id):
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_order = pool.submit(db.execute, "SELECT * FROM orders WHERE order_id = :id LIMIT 1", {"id": order_id})
        f_lines = pool.submit(db.execute, "SELECT * FROM order_items WHERE order_id = :id ORDER BY line_number", {"id": order_id})
        orders, lines = f_order.result(), f_lines.result()
    if not orders:
        raise ApiError(404, "Order not found")
    return _order_json(orders[0], lines)


def health():
    catalog, schema = db.target()
    rows = db.execute("SELECT COUNT(*) AS n FROM products")
    return {"ok": True, "catalog": catalog, "schema": schema, "products": int(rows[0]["n"])}


# ---------- router ----------
ROUTES = [
    ("GET", r"/api/health", lambda m, b: health()),
    ("GET", r"/api/catalog", lambda m, b: get_catalog()),
    ("POST", r"/api/users/signup", lambda m, b: signup(b)),
    ("POST", r"/api/users/login", lambda m, b: login(b)),
    ("GET", r"/api/users/(?P<id>[\w-]{1,100})/orders", lambda m, b: list_user_orders(m["id"])),
    ("POST", r"/api/orders", lambda m, b: create_order(b)),
    ("GET", r"/api/orders/(?P<id>[\w-]{1,100})", lambda m, b: get_order(m["id"])),
]

# The catalogue changes rarely: let Vercel's CDN cache it so most page loads
# don't hit the SQL warehouse at all.
CACHE = {r"/api/catalog": "public, s-maxage=300, stale-while-revalidate=86400"}


def _response(status, payload, cache=None):
    headers = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": cache or "no-store"}
    return status, headers, json.dumps(payload, ensure_ascii=False).encode()


def handle(method, path, body_bytes=b""):
    path = "/" + path.strip("/")
    for route_method, pattern, fn in ROUTES:
        match = re.fullmatch(pattern, path)
        if not match:
            continue
        if method != route_method:
            continue
        try:
            body = json.loads(body_bytes or b"{}") if method == "POST" else {}
            if not isinstance(body, dict):
                raise ApiError(400, "JSON object expected")
            return _response(200, fn(match.groupdict(), body), CACHE.get(pattern))
        except json.JSONDecodeError:
            return _response(400, {"error": "Invalid JSON"})
        except ApiError as e:
            return _response(e.status, {"error": str(e)})
        except db.DatabricksError as e:
            print(f"[databricks] {e}")
            return _response(502, {"error": "Database error", "detail": str(e)})
        except Exception:
            traceback.print_exc()
            return _response(500, {"error": "Internal error"})
    if any(re.fullmatch(p, path) for _, p, _ in ROUTES):
        return _response(405, {"error": "Method not allowed"})
    return _response(404, {"error": "Not found"})
