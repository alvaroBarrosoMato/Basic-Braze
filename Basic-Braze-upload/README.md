# Braze Test Shop

Tienda web de prueba para el [SDK web de Braze](https://www.braze.com/docs/developer_guide/sdk_integration) (v6.13),
con catálogo, usuarios y pedidos guardados en **Databricks** (tablas Delta en Unity Catalog).
Frontend HTML/CSS/JS sin build; API en Python (solo librería estándar) desplegada como función de Vercel.

## Arquitectura

```
Navegador ──(Braze Web SDK)──────────────────────────▶ Braze
    │
    └── fetch /api/* ──▶ Vercel Function (api/index.py) ──(SQL Statement Execution API)──▶ SQL warehouse ──▶ Delta tables
                         token de Databricks en variables de entorno, nunca en el navegador
```

- El **catálogo** se lee de Databricks (`GET /api/catalog`) y el CDN de Vercel lo cachea 5 min, así que casi
  ninguna visita toca el warehouse.
- **Registro / login / pedidos** van siempre a Databricks.
- El **carrito** vive en el navegador (`localStorage`) hasta el checkout: es lo habitual y evita una escritura por clic.
- Los **precios los calcula el servidor** a partir de Databricks; lo que mande el navegador se ignora.

## Estructura

```
index.html              header, menú de categorías, slots de banner globales, diálogos
styles.css
js/config.js            API key, SDK endpoint, placements de banners, moneda, apiBase
js/api.js               cliente de la API de la tienda
js/catalog.js           carga el catálogo desde /api/catalog + helpers
js/braze.js             TODAS las llamadas al SDK de Braze
js/app.js               router (#/...), vistas, carrito, login/registro, checkout
api/index.py            función de Vercel (entrada de todas las rutas /api/*)
api/_shop.py            lógica: catálogo, usuarios, pedidos
api/_databricks.py      cliente de la SQL Statement Execution API
sql/01_tables.sql       definición de las tablas
sql/02_seed_catalog.sql catálogo inicial (16 productos, 41 variantes)
sql/03_comments.sql     descripciones de tablas (Catalog Explorer)
scripts/setup_databricks.py  crea esquema + tablas y carga el catálogo
dev_server.py           servidor local: web + la misma API
vercel.json             rewrite /api/* → api/index.py
```

Páginas: inicio, categoría / subcategoría, ficha de producto, búsqueda, carrito, checkout, confirmación de pedido
y **Mis pedidos** (`#/account`, clic en tu nombre).

## Modelo de datos (Databricks)

| Tabla | Clave | Contenido |
|---|---|---|
| `categories` | `category_id` | Categorías del menú |
| `subcategories` | `subcategory_id` → `categories` | Subcategorías |
| `products` | `product_id` → `categories`, `subcategories` | Nombre, descripción, `price DECIMAL(10,2)`, `currency`, `is_active` |
| `product_variants` | `variant_id` → `products` | Tallas/colores. `variant_id` = `product_id-variant_code`, el mismo que se envía a Braze |
| `users` | `user_id` | Clientes registrados. **`user_id` es el `external_id` de Braze** |
| `orders` | `order_id` → `users` | Cabecera: datos de envío, totales, `status`, `cart_id`, `checkout_id`. `user_id` NULL = invitado |
| `order_items` | (`order_id`, `line_number`) → `orders`, `products`, `product_variants` | Líneas con nombre y precio copiados en el momento de la compra |

Las PRIMARY/FOREIGN KEY son informativas en Databricks (documentan el modelo, no se imponen).
Para cambiar el catálogo, edita las tablas en Databricks: la web lo refleja en ≤ 5 min (caché del CDN).

## Eventos (eCommerce recommended events)

Siguen el esquema de [Braze eCommerce recommended events](https://www.braze.com/docs/user_guide/data/activation/events/recommended_events#ecommerce-recommended-events)
y se envían con `braze.logEcommerceEvent({ name, properties })` (Web SDK ≥ 6.8).

| Acción | Evento | Notas |
|---|---|---|
| Ver ficha de producto (o cambiar de variante) | `ecommerce.product_viewed` | `product_id`, `product_name`, `variant_id`, `price`, `currency`, `source`, `product_url` |
| Añadir / quitar / cambiar cantidad / eliminar | `ecommerce.cart_updated` | Modo *full replacement*: siempre se envía el carrito completo con cantidades absolutas (sin `action`) |
| Entrar al checkout | `ecommerce.checkout_started` | `checkout_id`, `cart_id`, `total_value`, `subtotal_value`, `shipping`, `metadata.checkout_url` |
| Realizar pedido | `ecommerce.order_placed` | `order_id`, `cart_id`, totales, `products[]`, `metadata.order_status_url` |

- Se usa el mismo `cart_id` en cart → checkout → order. Tras un pedido se crea un carrito nuevo.
- `source` es `"web"` y la moneda `EUR` (se cambian en `js/config.js`).
- **No** se llama a `braze.logPurchase`: es el evento legacy (en modo mantenimiento) y `ecommerce.order_placed`
  ya actualiza `total_revenue` / `total_orders`; usar ambos duplicaría ingresos.
- `ecommerce.order_placed` usa el `order_id` y los totales que devuelve la API (los mismos que quedan en `orders`).
- `ecommerce.order_cancelled` / `order_refunded` no se envían (la tienda no tiene cancelaciones ni devoluciones).

Eventos no‑eCommerce (custom events): `signed_up`, `logged_in`, `logged_out`, `product_searched` (`query`, `results_count`).

### Exit intent con carrito

`exit_intent_with_cart` se envía cuando el ratón sale de la página por el borde superior (hacia las
pestañas o la barra de direcciones) **y** el carrito tiene al menos un producto. Propiedades:
`cart_item_count`, `cart_value`, `currency`, `cart_id`, `page`.

- Solo en escritorio (dispositivos con ratón); en móvil no existe ese gesto.
- Como máximo una vez por minuto por pestaña.
- Para mostrar un mensaje: campaña de in-app message → *Schedule Delivery* → *Action-Based* →
  *Perform Custom Event* → `exit_intent_with_cart`. Tras lanzar la campaña, recarga la web para que el SDK
  descargue el nuevo trigger.

## Usuarios

| Estado | Qué hace |
|---|---|
| Anónimo | `initialize` → `openSession` sin `changeUser` |
| Registro | `changeUser(userId)` + nombre, apellidos, email, suscripción email, `signup_date`. La actividad anónima previa se fusiona en el perfil |
| Login | `changeUser(userId)` |
| Logout | `wipeData()` + recarga → nuevo usuario anónimo |
| Compra como invitado | `setEmail` en el perfil anónimo |

Las cuentas se guardan en la tabla `users` de Databricks; el `user_id` (`user_<uuid>`) lo genera la API.
Login solo con email (sin contraseña): cualquiera que conozca un email puede entrar como ese usuario,
así que no uses datos reales.

## Banners

| Placement ID | Dónde aparece |
|---|---|
| `home_top` | Arriba en la página de inicio |
| `search_top` | Arriba en la página de búsqueda |
| `cart_banner` | Arriba en el carrito |
| `checkout_banner` | Arriba en el checkout |
| `my_first_banner` | En todas las páginas, encima del footer |

La app se suscribe con `subscribeToBannersUpdates`, pide los 5 placements con un solo `requestBannersRefresh`
(al cargar, al registrarse y al hacer login) y pinta cada slot `[data-placement]` con `insertBanner`, que registra
impresiones y clics automáticamente.

> Los banners **requieren** `allowUserSuppliedJavascript: true` en `braze.initialize` (está en `js/braze.js`).
> Sin esa opción el SDK descarga el banner pero no lo pinta y muestra *"Banners are disabled"* en la consola.

Si un placement no tiene campaña activa se ve un recuadro punteado
(desactivable con `showBannerPlaceholders: false`).

## Puesta en marcha

### 1. Databricks

Necesitas un workspace con **Unity Catalog** y un **SQL warehouse** (vale uno serverless pequeño).

1. **Warehouse ID**: SQL Warehouses → tu warehouse → *Connection details*. El *HTTP path* termina en
   `/sql/1.0/warehouses/<ID>`.
2. **Credenciales** (elige una):
   - *Service principal* (recomendado): Settings → Identity and access → Service principals → crea uno →
     *Secrets* → genera un OAuth secret. Te da `client_id` + `secret`.
   - *Personal access token* (más rápido para probar): Settings → Developer → Access tokens.
3. **Permisos** para esa identidad: `CAN USE` en el warehouse, y en Unity Catalog `USE CATALOG` en el catálogo y
   `USE SCHEMA`, `CREATE TABLE`, `SELECT`, `MODIFY` en el esquema (si el esquema aún no existe, también
   `CREATE SCHEMA` en el catálogo para el primer setup).
4. Copia `.env.example` a `.env` y rellénalo. No subas `.env` a GitHub (ya está en `.gitignore`).
5. Crea las tablas y carga el catálogo:

   ```bash
   python3 scripts/setup_databricks.py
   ```

   Se puede volver a ejecutar sin peligro; `--reseed` recarga el catálogo (no toca usuarios ni pedidos).
   Si prefieres hacerlo a mano, ejecuta `sql/01_tables.sql`, `02_seed_catalog.sql` y `03_comments.sql`
   en el SQL editor dentro de tu catálogo/esquema.

### 2. Local

```bash
python3 dev_server.py
```

Abre http://localhost:8080. Sin credenciales de Databricks puedes probarlo todo con una base de datos local en
memoria (SQLite creada con los mismos `.sql`; se borra al parar el servidor):

```bash
FAKE_DATABRICKS=1 python3 dev_server.py
```

### 3. Vercel

1. Project Settings → **Environment Variables**: añade las mismas variables que en `.env`
   (`DATABRICKS_HOST`, `DATABRICKS_WAREHOUSE_ID`, `DATABRICKS_CATALOG`, `DATABRICKS_SCHEMA` y
   `DATABRICKS_CLIENT_ID` + `DATABRICKS_CLIENT_SECRET` o `DATABRICKS_TOKEN`).
2. Haz push; Vercel despliega la web y la función `api/index.py` (no hay que instalar nada).
3. Comprueba la conexión en `https://<tu-app>.vercel.app/api/health` → `{"ok": true, "products": 16, …}`.

La versión de GitHub Pages ya no funciona completa: no puede ejecutar la API.

El botón **Braze log** (abajo a la derecha) muestra cada llamada al SDK y su payload; las que el SDK rechaza salen en rojo.

## Siguiente paso: de Databricks a Braze

Braze **Cloud Data Ingestion (CDI)** puede leer directamente de Databricks. Con una vista sobre `users` + `orders`
(p. ej. `total_orders`, `lifetime_value`, `last_order_at` por `user_id`) puedes sincronizar esos atributos a los perfiles
de Braze sin tocar la web, y con `products` alimentar un **Braze Catalog** para personalizar mensajes.

## Comprobar datos en Braze

- **Audience → Search Users**: busca por email o external ID para ver atributos y eventos.
- **Data Settings → Custom Events / eCommerce**: los nombres aparecen tras enviarse la primera vez.
- Con `enableLogging: true` la consola del navegador muestra los logs internos del SDK.
