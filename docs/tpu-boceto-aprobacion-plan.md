# TPU — Boceto del cliente + aprobación de arte (plan)

Estado: **IMPLEMENTADO (4 fases)**. A probar de punta a punta. Requiere restart backend + `poppler-utils` (thumbnails PDF) + build/deploy frontend.

## Operativa objetivo (lo que pidió el usuario)

1. El cliente sube un **boceto** de lo que quiere.
2. Internamente se **diseñan los archivos** en base al boceto → se suben **5 PDFs**.
3. El cliente ve un **thumbnail del archivo cuyo nombre contenga `cmyk`**.
4. El cliente **aprueba** si está conforme → recién ahí se libera a producción.

### Cambio de flujo (29/07/2026) — se aprueba el BOCETO, no el arte

El punto 2 dejó de ser condición para el punto 4. El operario que agarra el pedido sube **un solo PDF
con la palabra `boceto` en el nombre** (aparece en *Archivos de Referencia*, igual que antes) y **eso**
es lo que el cliente ve para aprobar. Las otras capas del arte se suben **después** de la aprobación,
ya en producción. Antes había que terminar el arte completo (6 capas) para recién ahí preguntarle al
cliente si le gustaba.

Qué cambió en el código:
- `enviarAprobacionTPU` ([ordersController.js](../backend/controllers/ordersController.js)): el chequeo de
  "exactamente 6 archivos" quedó **solo** para el reuso de matriz (`[REUSO-REGEN]`, que va directo a
  producción sin pasar por el cliente). El camino normal exige **≥1 archivo con `boceto` en el nombre**.
- `OrderDetailModal`: misma validación del lado del front, y el texto de confirmación dice *boceto*
  (antes decía "archivo CMYK"). Si solo está el boceto, la pestaña de impresión avisa que el archivo
  está en Referencias en vez de quedar aparentemente vacía.
- **Visor 3D a partir del boceto**: `Tpu3DViewer` usa `capas.boceto || capas.cmyk` como capa de arte
  (el cmyk queda de fallback para pedidos viejos). Sin `corte`, la silueta sale de la tinta del propio
  boceto — camino que ya existía para cuando faltaba el corte. `getClientOrders` expone `TieneArte3D`
  (¿hay un PDF `boceto`/`cmyk`?) y `FactoryView` muestra **"Ver 3D"** solo cuando vale 1.
- Sin cambios en `getOrderFiles` ni en el thumbnail del portal: ya priorizaban `boceto` con fallback a `cmyk`.

---

## Lo que YA existe y se reutiliza (buena noticia: ~70% está)

| Pieza | Dónde |
|---|---|
| Servicio TPU en el portal (form, dropdown "Tipo de TPU") | `src/client-portal/constants/services.js:198-230` |
| Submit del pedido → crea orden en área TPU | `OrderForm.jsx:975` → `POST /web-orders/create` → `webOrdersController.js:205` |
| Área de producción `/area/TPU` (AreaView genérico) | `AreaView.jsx:80`; órdenes vía `getOrdersByArea` (`ordersController.js:84`, `WHERE AreaID='TPU'`) |
| **Thumbnails de PDF automáticos al subir** (pdftoppm 1ª página + sharp) | `backend/utils/thumbnailGenerator.js:26`; se disparan en `uploadOrderFile` (`webOrdersController.js:1301`) |
| Servido de thumbnails `/thumbnails/{cod}/{archivoId}.jpg` | `server.js:66` |
| Cliente ve archivos de su orden con miniaturas (Mi Fábrica) | `FactoryView.jsx:717`; `getOrderFiles` (`webOrdersController.js:1726`) |
| **Flujo de aprobación completo** (hold + endpoint + UI) | `AprobacionPendiente` + `POST /web-orders/aprobar-pedido` (`webOrdersController.js:1654`) + badge "ESPERA TU APROBACIÓN" y botón "Aprobar" (`FactoryView.jsx:547-556`) |
| Subida interna de archivos (impersonando cliente) | `POST /web-orders/upload-stream` (`webOrdersController.js:1256`) |

**Requisito operativo del server:** para thumbnails de PDF hace falta `poppler-utils` instalado (`pdftoppm`). Si no está, cae al proxy de Drive.

---

## Lo que falta / hay que adaptar

1. **El form TPU hoy pide "Archivos para Producción" (hasta 15), no un boceto.** Hay que cambiarlo para que el cliente suba **1 boceto** (imagen/PDF) → tabla `ArchivosReferencia` (tipo BOCETO), y que TPU **no exija** archivos de producción del cliente. (TPU no tiene hoy zona de boceto: solo Corte/Sublimación/Directa la tienen vía `hasCuttingWorkflow`.)

2. **No hay UI interna clara para que la fábrica suba los 5 PDFs de arte** a una orden ya creada. Hay que definir DÓNDE (ver decisión #2). Los 5 PDFs → `ArchivosOrden` (producción); los thumbnails se generan solos al subir.

3. **El cliente hoy vería los 5 PDFs.** `getOrderFiles` devuelve todos los `ArchivosOrden`. Para TPU hay que mostrar **solo el que tiene `cmyk` en el nombre** (los otros 4 son internos: separaciones, etc.).

4. **Disparar el hold de aprobación al subir el arte** (no al crear el pedido, como es hoy con diseñadores). Al quedar el arte cargado, la orden pasa a `AprobacionPendiente=1` y espera al cliente.

---

## Flujo propuesto (con defaults; a confirmar)

1. **Portal — crear pedido TPU:** cliente elige Tipo de TPU + nombre + prioridad y sube **1 boceto** (reemplaza el uploader de "Archivos para Producción"). Se crea la orden en área TPU con el boceto en `ArchivosReferencia`. Entra a producción para que la fábrica la trabaje.
2. **Interno — diseño:** la fábrica ve la orden TPU con el boceto del cliente, diseña y sube **5 PDFs** (arte) → `ArchivosOrden`. Uno se llama con `cmyk` en el nombre.
3. **Hold de aprobación:** al terminar de subir el arte (o al apretar "enviar a aprobación"), la orden → `AprobacionPendiente=1` (retenida, no avanza).
4. **Portal — aprobación:** en Mi Fábrica el cliente ve la orden TPU con el **thumbnail del PDF `cmyk`** y el botón **"Aprobar"** (solo ve el CMYK).
5. **Aprobación → producción:** al aprobar, se limpia el hold y la orden avanza a la producción real de TPU (reutiliza `aprobarPedido`).

---

## Decisiones tomadas ✅

1. **Boceto:** obligatorio, **1 solo archivo**, formatos **PNG / JPG / PDF**. TPU deja de pedir "archivos de producción" al cliente.
2. **Los 5 PDFs** se suben internamente en el **detalle de la orden** (`OrderDetailModal`).
3. **Al terminar de subir los 5 PDFs** → mostrar un **modal "Enviar a cliente para aprobación"**.
4. **Solo aprobar** por ahora (sin "pedir cambios").
5. **Todo aplica SOLO a TPU** — tanto interno (`/area/TPU`) como cliente (`/portal/order/tpu`). El resto de los servicios no cambia.

## Plan de implementación por fases

**Fase 1 — Portal: boceto obligatorio (solo TPU)** · lado cliente · ✅ HECHA
- `services.js` config TPU: `requiresProductionFiles:false`, `bocetoMode:true`, `minCopies:15`.
- `OrderForm.jsx`: bloque TPU con uploader de **boceto** (PNG/JPG/PDF) + input de **cantidad** (mín 15); oculta "Archivos para Producción". Efecto garantiza 1 item (lleva la cantidad). Validación: boceto obligatorio + cantidad ≥ 15. El boceto ya se sube a `ArchivosReferencia` (tipo BOCETO) por la lógica existente.

**Fase 2 — Detalle de orden: subir 5 PDFs (solo TPU)** · interno · ✅ HECHA
- Backend: `POST /orders/:ordenId/production-file` (`ordersController.uploadProductionFile`) → INSERT `ArchivosOrden` (TipoArchivo 'Impresion') + sube a Drive + genera thumbnail (PDF). Multer en `ordersRoutes.js`.
- Frontend: `ordersService.uploadProductionFile` + uploader "Subir arte (PDF)" en la pestaña Archivos de Producción de `OrderDetailModal`, visible solo si `isTPU`. Sube múltiples PDFs y refresca la lista.

**Fase 3 — "Enviar a aprobación" (solo TPU)** · interno · ✅ HECHA
- Backend: `POST /orders/:ordenId/enviar-aprobacion` (`ordersController.enviarAprobacionTPU`) → valida TPU + arte cargado, y hace `AprobacionPendiente=1, Estado='Cargando...', EstadoenArea='Cargando...'` (inverso exacto de `aprobarPedido`). Emite `server:ordersUpdated`.
- Frontend: botón "Enviar a cliente para aprobación" en la pestaña Archivos de Producción de `OrderDetailModal` (solo TPU, con arte). Modal de confirmación (Swal). Si ya se envió, muestra badge "Esperando aprobación del cliente".

**Fase 4 — Portal: ver CMYK + aprobar (solo TPU)** · lado cliente · ✅ HECHA
- `getOrderFiles` ([webOrdersController.js](../backend/controllers/webOrdersController.js)): para TPU filtra `NombreArchivo LIKE '%cmyk%'` (los otros PDFs son internos). Mismo filtro en `PrimerArchivoID`/`DriveFileId` de `getClientOrders` para que el preview de la card también sea el CMYK.
- `FactoryView`: **sin cambios** — el badge "ESPERA TU APROBACIÓN" + botón "Aprobar" y el expand ("VER ETAPAS" → thumbnail 500px) ya funcionan porque `getClientOrders` no filtra por estado y expone `AprobacionPendiente`. Aprobar → `POST /web-orders/aprobar-pedido` reactiva a 'Pendiente'.

## Extensión: Mis matrices (reuso sin re-cobro)

**Contexto:** el portal TPU **reemplaza el flujo de Sheets**, así que el cobro de la matriz (artículo `156`, precio en Productos/Precios) ahora **lo maneja el portal**. En el form, antes del boceto, el cliente elige:
- **Trabajo nuevo** → boceto + los 5 archivos se diseñan → se cobra la matriz (`156`) + producción. (Es el flujo F1–F4.)
- **Usar una matriz** → grilla **"Mis matrices"** (thumbnails de sus pedidos TPU **finalizados** con arte CMYK) → elige una + cantidad → **entra directo a producción** (sin boceto ni aprobación) → **NO** se cobra el `156`, solo la producción.

Decisiones tomadas ✅: matrices = pedidos TPU **finalizados**; reuso entra directo a producción; cliente elige cantidad; el pedido reusado no lleva la línea `156` (sí producción).

**Sub-fases:**
- **F5a — Selector + "Mis matrices"** (visual) · ✅ HECHA: `GET /web-orders/mis-matrices` (`getMisMatrices`) lista órdenes TPU con `Estado` finalizado + arte CMYK; en `OrderForm` (solo TPU) el selector "Trabajo nuevo / Usar una matriz" + grilla de thumbnails (reusa `/thumbnails/...`) + cantidad. El submit en modo matriz está bloqueado con aviso hasta F5b/F5c.
- **F5b — Reuso** · ✅ HECHA: `POST /web-orders/reuse-matriz` (`reuseMatrizTPU`) valida la matriz del cliente, crea la orden TPU nueva (Estado 'Pendiente' = directo a producción), **copia el arte** (filas `ArchivosOrden` con las mismas rutas de Drive) + copia los thumbnails a disco, y dispara la auto-cotización. Frontend: el submit en modo matriz llama a ese endpoint y muestra el modal de éxito.
- **F5c — Cobro de la matriz** (`156`) · ✅ HECHA: matriz TPU = `CodArticulo '156'`, **US$15 USD**; producción = artículos parche (`152`–`155`, con precio). En `createWebOrder`, para la orden TPU principal (trabajo nuevo) se inserta un `ServiciosExtraOrden` con `CodArt '156'` → la auto-cotización lo cobra. El reuso va por `/reuse-matriz` (no pasa por ahí) → matriz gratis. La producción se cobra sola por el `CodArticulo` del parche elegido.
- **Nota config:** se ocultaron del dropdown "Tipo de TPU" los artículos `156` (matriz) y `312` (gorros, sin precio) con `UPDATE articulos SET mostrar=0`.

## Notas técnicas
- Reutilizar `AprobacionPendiente` + `aprobarPedido` evita inventar estados nuevos; solo cambia el *disparador* (al subir arte TPU en vez de al completar un pedido de diseñador).
- El filtro `cmyk` en el cliente: agregar en `getOrderFiles` (o en un endpoint/param específico de TPU) un `WHERE NombreArchivo LIKE '%cmyk%'` cuando `AreaID='TPU'`.
- No hay columna "visible cliente" en `ArchivosOrden`; el filtro por nombre es la vía más simple, sin migración de schema.
