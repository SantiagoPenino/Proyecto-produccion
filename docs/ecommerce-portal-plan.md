# E-commerce del portal de clientes — investigación y plan

**Fecha:** 10/08/2026 · **Estado:** DEFINIDO — decisiones de negocio tomadas (ver §4), esperando OK para implementar.

Objetivo: una tienda en el portal de clientes que liste **productos terminados**, **productos
personalizados** y **productos confeccionados**, apoyada en lo que ya existe detrás de
`/ventas/pedido-prenda`.

---

## 1. Lo que ya existe (verificado en código)

Los tres tipos de producto **ya tienen columna vertebral en el sistema**. Hoy toda la venta vive
en la app interna (vendedor/atención al cliente); el portal del cliente no ve nada de esto.

### 1.1 Productos terminados (stock WMS)

- **Catálogo**: `Articulos` con `SupFlia='2'`, mapeados al WMS externo por `Articulos_Wms`
  (maestro) y `Articulos_WMS_Variantes` (variantes talle/color con SKU).
  `wmsController.getCatalog` arma el catálogo completo con:
  - **Stock vivo por variante**: consulta HTTP al WMS de AWS (`WMS_SQL_URL`, `Stock_Etiquetas`
    del depósito `WMS_DEPOSITO_LOCAL_ID=5`).
  - **Precios**: `PreciosBase` por artículo + `precio_excepcion`/`moneda_excepcion` por variante.
  - **Imágenes**: `Articulos_Imagenes` (hoy solo `orden=1`, flag `es_generica`).
  - **Ubicación picking**: `Articulos_UbicacionLocal` (pasillo/estante — dato interno).
- **Checkout** (`wmsController.createOrder`):
  1. `PedidosCobranza` cabecera `VEN-xxxx` + `PedidosCobranzaDetalle` por ítem.
  2. Una **orden ancla** por ítem en área `PRO` con `EstadoDependencia='VENTA_DIRECTA'`
     (existe solo para generar bulto/etiqueta en `confirmPreparation`; no es trabajo).
  3. Evento de trazabilidad (`logisticaWmsController.logEvento`) + socket `wms:pedido` que
     dispara el **remito A4 en la Print Station** (`/wms-remito-station`).
- **UI**: `WmsOrderPage.jsx` — catálogo con búsqueda, modal de variantes, carrito multi-moneda
  (UYU/USD con tipo de cambio de `getExchangeRate`). Soporta `embedded` (dark, dentro del form
  de prendas) y standalone (`/atencion-cliente/pedidos-wms`, theme claro).

### 1.2 Productos personalizados

- **Flujo "COMPRAR + Personalizar esta compra"** en `PrendaOrderForm.jsx`: carrito WMS embebido
  + acordeón opcional de decoración (Bordado/Estampado/DTF/TPU) sobre lo comprado. Si no
  personaliza → venta WMS pura (VEN-). Si personaliza → además nace el pedido de producción
  ligado, con la cantidad precargada desde el carrito.
- **ECOUV Producto Terminado** (ya de cara al cliente en `/portal/order/ecouv`): variantes
  virtuales del nomenclador con `StockArt.TipoStock='PRODUCTO_TERMINado'` → ficha con precio
  cerrado, dimensiones, material y terminaciones incluidas (`isEcouvPT` en OrderForm).

### 1.3 Productos confeccionados

- **Flujo "FABRICAR_A_MEDIDA"** en `PrendaOrderForm.jsx`:
  - Catálogo: `GET /prendas-orders/productos-terminados?categoria=Prendas Confeccionadas`
    (`Articulos` ↔ `StockArt` con `TipoStock='PRODUCTO_TERMINADO'`, precio de `PreciosBase`,
    filtro por categoría = `StockArt.Articulo`).
  - `ProductoTerminadoServicios` define los servicios de decoración incluidos por producto
    (`Obligatorio=1` → se activan solos y no se pueden apagar).
  - Roster de talles (`OrdenTalles`), cadena sublimación → corte (TWC) → costura (TWT) →
    orden madre PRO. Todo por `prendasOrdersController` (fork aislado de web-orders).

### 1.4 Infra del portal reutilizable

- `ClientPortalApp.jsx`: rutas protegidas con `AuthProvider` (token de cliente), `MainLayout`.
- **Mercado Pago ya integrado** (`/payment-status`, `PaymentResult`, Pagos Pendientes).
- Diseñadores e impersonación (`X-Cliente-CodCliente`) ya resueltos si hiciera falta.
- Envío: patrón de ECOUV (Retiro en el Local / Encomienda) ya existe en el form.

---

## 2. El gap (qué falta para que sea una tienda de clientes)

| # | Falta | Detalle |
|---|-------|---------|
| 1 | **Exposición al cliente** | `wmsRoutes` y `prendas-orders` usan `verifyToken` interno. Hace falta un camino con el token del portal (patrón `webOrdersRoutes` + `impersonarCliente`), que además **no** exponga: sync del catálogo, ubicación de picking, edición de precios. |
| 2 | **Datos de vitrina** | Los artículos no tienen descripción de venta, fotos múltiples/por variante ni categorías navegables. Hoy: 1 imagen (`orden=1`), nombre técnico del ERP. |
| 3 | **Publicación** | No hay flag "se muestra en la tienda". Mostrar TODO `SupFlia='2'` expondría el inventario interno completo. |
| 4 | **Checkout de cliente** | `createOrder` fija `ClienteID` del body (o 2089 Consumidor Final) — en el portal debe salir del token. Y no pide forma de envío ni integra MP. |
| 5 | **Front de tienda** | No existe ninguna vista de e-commerce en el portal (grilla, detalle, carrito persistente, "mis compras"). |
| 6 | **Personalizar/confeccionar como cliente** | `PrendaOrderForm` se movió a interno A PROPÓSITO (el vendedor elige cliente). Para el portal hay que decidir: versión simplificada del flujo, o precargar los forms existentes (`/portal/order/:serviceId`) desde la ficha del producto. |

---

## 3. Fases

- **F0 — Modelo de publicación + catálogo del portal** ✅ **IMPLEMENTADA 10/08/2026**
  (`backend/controllers/tiendaController.js` + ruta en `webOrdersRoutes.js`; tabla
  auto-creada al primer uso; probada local con producto publicado, precio base USD,
  cotización y stock WMS vivo)
  - Tabla `TiendaProductos`: `ProIdProducto`, `Publicado`, `TipoVitrina`
    ('TERMINADO'|'PERSONALIZADO'|'CONFECCIONADO'), `TituloVenta`, `DescripcionVenta`,
    `CategoriaVitrina`, `Orden`, `PagoOnline` (bit, default 0 — hoy no se usa, deja la puerta
    abierta al cobro inmediato futuro).
  - Fotos: reusar `Articulos_Imagenes` con `orden > 1` (galería), la `orden=1` sigue siendo
    la miniatura del catálogo interno.
  - `GET /web-orders/tienda/catalogo` (token del portal + `impersonarCliente`): solo
    publicados, con precio de `PreciosBase` (+ `precio_excepcion` por variante), stock
    informativo del WMS, fotos y ficha. **Sin** ubicación de picking, sin sync, sin edición.
- **F1 — Vitrina + carrito de terminados** ✅ **IMPLEMENTADA 10/08/2026**
  (`src/client-portal/modulos/TiendaView.jsx` + ruta `/portal/tienda` + entrada en el
  sidebar del portal y en el dropdown MI PORTAL del navbar; carrito en localStorage,
  checkout deshabilitado hasta F2): `/portal/tienda` — grilla filtrable por las 3
  solapas/categorías y ficha de producto para los 3 tipos, pero **al carrito solo entran los
  TERMINADOS** (precio conocido de `PreciosBase`):
  - ficha TERMINADO: variante + cantidad → "Agregar al carrito";
  - ficha PERSONALIZADO / CONFECCIONADO: **sin precio de venta cerrado** (dependen de
    decoración, medidas, talles… imposible cotizar al momento) → botón "Iniciar pedido"
    que lleva al flujo de pedido correspondiente con el producto precargado
    (`location.state`); el precio lo pone la cotización de siempre (auto-cotización
    ERP/vendedor), igual que cualquier pedido de producción de hoy.
- **F2 — Checkout de terminados**: `POST /web-orders/tienda/checkout` — solo stock:
  - lógica VEN- de `wmsController.createOrder` (PedidosCobranza + detalle + ancla PRO
    `VENTA_DIRECTA` + remito Print Station), con cliente del token;
  - forma de envío Retiro en el Local / Encomienda (patrón ECOUV);
  - cobro: **pagar al retirar** — `EstadoCobro='PENDIENTE'` → cae solo en Pagos
    Pendientes/caja como cualquier retiro. MP queda para después vía flag `PagoOnline`.
  - **Sin gate de stock**: se vende también sin stock (el número del WMS es informativo,
    con leyenda "a pedido" si está en 0).
- **F3 — Flujos de personalizados/confeccionados**: la precarga desde la ficha.
  Personalizados → deep-link al form del servicio (`/portal/order/:serviceId`) con el
  producto/cantidad precargados. Confeccionados → definir la variante cliente del flujo
  "Fabricar a Medida" (el PrendaOrderForm es interno a propósito): mínimo viable, la ficha
  genera la solicitud con producto + talles y la termina de armar ventas.
- **F4 — Admin interno de la tienda**: pantalla en la app interna (`/admin/tienda`):
  publicar/despublicar, título/descripción, fotos (subida a `Articulos_Imagenes`), categoría,
  orden, y a futuro el flag de pago online. Curaduría 100% interna.
- **F5 — Post-venta**: las compras aparecen en Mis Pedidos/Retiros del portal (nacen como
  VEN- + órdenes de producción normales), push existente.

---

## 4. Definiciones de negocio (10/08/2026)

1. **Compradores**: solo clientes logueados del portal. Sin guest checkout.
2. **Precios**: precio base (`PreciosBase`) igual para todos; la excepción por variante
   (`precio_excepcion`) sigue valiendo. Sin listas por cliente.
3. **Stock**: se vende también sin stock (backorder). El stock del WMS se muestra como
   dato informativo, nunca bloquea.
4. **Cobro**: pagar al retirar (flujo PENDIENTE → caja, como todo lo demás). Más adelante,
   algunas cosas se cobrarán en el momento → flag `PagoOnline` por producto desde el día 1,
   sin usar.
5. **Carrito**: SOLO terminados. ~~Unificado~~ — revisado el 10/08: personalizados y
   confeccionados dependen de demasiadas variables como para cotizarlos al momento, así que
   no pueden ir a un carrito con precio; desde su ficha se inicia el pedido por su flujo
   propio y el precio sale de la cotización de siempre.
6. **Curaduría**: interna (pantalla de administración en la app productiva).
