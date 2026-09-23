# Braze Test Shop

Tienda web de prueba para el [SDK web de Braze](https://www.braze.com/docs/developer_guide/sdk_integration) (v6.13).
HTML/CSS/JS sin build ni dependencias.

## Estructura

```
index.html        header, menú de categorías, slots de banner globales, diálogos
styles.css
js/config.js      API key, SDK endpoint, placements de banners, moneda
js/catalog.js     categorías, subcategorías y productos (con variantes)
js/braze.js       TODAS las llamadas al SDK de Braze
js/app.js         router (#/...), vistas, carrito, login/registro
```

Páginas: inicio, categoría / subcategoría, ficha de producto, búsqueda, carrito, checkout y confirmación de pedido.

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
- `ecommerce.order_cancelled` / `order_refunded` no aplican (no hay backend de pedidos).

Eventos no‑eCommerce (custom events): `signed_up`, `logged_in`, `logged_out`, `product_searched` (`query`, `results_count`).

## Usuarios

| Estado | Qué hace |
|---|---|
| Anónimo | `initialize` → `openSession` sin `changeUser` |
| Registro | `changeUser(userId)` + nombre, apellidos, email, suscripción email, `signup_date`. La actividad anónima previa se fusiona en el perfil |
| Login | `changeUser(userId)` |
| Logout | `wipeData()` + recarga → nuevo usuario anónimo |
| Compra como invitado | `setEmail` en el perfil anónimo |

Las cuentas se guardan en `localStorage` (email → `user_<uuid>`). Sin contraseñas ni backend: es una demo.

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
impresiones y clics automáticamente. Si un placement no tiene campaña activa se ve un recuadro punteado
(desactivable con `showBannerPlaceholders: false`).

## Puesta en marcha

1. En `js/config.js`, pon en `baseUrl` el **SDK Endpoint** de tu dashboard (Settings → App Settings), p. ej. `sdk.fra-02.braze.eu`.
2. Sirve la carpeta (hace falta un servidor por los módulos ES):

   ```bash
   python3 -m http.server 8080
   ```

3. Abre http://localhost:8080. El botón **Braze log** (abajo a la derecha) muestra cada llamada al SDK y su payload;
   las que el SDK rechaza salen en rojo.

## Comprobar datos en Braze

- **Audience → Search Users**: busca por email o external ID para ver atributos y eventos.
- **Data Settings → Custom Events / eCommerce**: los nombres aparecen tras enviarse la primera vez.
- Con `enableLogging: true` la consola del navegador muestra los logs internos del SDK.
