# Subidas de archivos: WebP y carpetas en /home

Revisión del 07/10/2026.

> **Implementado el 07/10/2026 (sin deployar).** Decisiones de Santiago: WebP en todos los casos **Sí** de §2, calidad 80, lado mayor ≤ 1080 px manteniendo la proporción, encomiendas se queda en 75.
> - `backend/utils/imagenWebp.js`: `webpEnSubida` (middleware después de multer) y `bufferAWebp` (fallas). Si sharp no puede leer la imagen (p. ej. HEIC), se guarda el original.
> - Conectado en fallas (`thumbnailGenerator.saveFallaImage`), consultas, servicio técnico (dentro de `subirAdjuntos`), tickets (crear y responder), comprobantes de pago y de transferencia, fichas de diseño (dibujo, costura ISO, paso) y CMS.
> - `backend/utils/rutasUploads.js`: `UPLOADS_PATH` para la carpeta `/uploads` (11 lugares). La URL pública no cambia.
> - Carpetas del VPS al 07/10: ya en /home por variable salvo `uploads` (ver la memoria de infra).

Marcas: **[V]** verificado en el código (archivo:línea) · **[I]** inferido · **[?]** no lo sé.

---

## 1. Resumen

- `sharp` ya está instalado (`backend/package.json:37`). Convertir a WebP no requiere instalar nada.
- **Ya convierten a WebP:** artículos (512×512, calidad 80) y encomiendas (1200 px, **calidad 75**, aunque el comentario diga 82).
- **Ya comprimen pero a JPG:** fallas (JPG 85) y thumbnails (JPG 75-80).
- **Todo lo demás se guarda tal cual llega**, incluidas fotos de celular de 3-8 MB.
- **Carpetas:** de las que nombraste, `fallas`, `tickets` y `servicio-tecnico` **ya aceptan variable de entorno** (`FALLAS_PATH`, `TICKETS_SOPORTE_PATH`, `ST_ADJUNTOS_PATH`). **`uploads` no:** está fija en 6 lugares del código.
- En el `.env` local solo están `COMPROBANTES_PATH`, `COMPROBANTES_ENCOMIENDAS_PATH` y `STOCK_COMPRAS_PATH` [V]. **Qué hay en el `.env` del VPS: [?]** (ver §5, primer paso).

---

## 2. Caso por caso: ¿WebP 80?

| # | Qué se sube | Dónde se guarda | Hoy | ¿WebP 80? |
|---|---|---|---|---|
| 1 | **Foto de falla** (canvas anotado en Control y bandejas) | `FALLAS_PATH` o `backend/fallas/<orden>/` | JPG 85 desde base64 (`utils/thumbnailGenerator.js:180-197`) | **Sí.** La URL completa va en `FallasProduccion.ImagenFalla`, así que las viejas `.jpg` siguen andando y las nuevas salen `.webp`. |
| 2 | **Foto de consulta al cliente** (planta → cliente) | `CONSULTAS_FOTOS_PATH` o `backend/consultas/<id>/` | Tal cual (jpeg/png/webp, 5 MB) | **Sí.** Ojo: guarda la **ruta absoluta** en la base (ver §4). |
| 3 | **Adjuntos de servicio técnico** (fotos, PDF, video) | `ST_ADJUNTOS_PATH` o `backend/servicio-tecnico/<entidad>/<id>/` | Tal cual, 25 MB | **Sí, solo imágenes.** PDF y video no. Hay que actualizar también `ST_Adjuntos.Mime`. |
| 4 | **Evidencia de tickets de soporte** | `TICKETS_SOPORTE_PATH` o `backend/tickets/<id>/` | Tal cual, 15 MB, sin filtro | **Sí, solo imágenes.** PDF no. |
| 5 | **Comprobante de pago / transferencia** (foto con cámara o PDF): carga de pagos, entrega de pedidos, caja | `COMPROBANTES_PAGOS_PATH` o `backend/comprobantesPagos/` | Tal cual, sin límite ni filtro | **Sí, solo fotos.** No encontré ninguna ruta que los vuelva a mostrar [V por búsqueda; no es prueba de ausencia]. |
| 6 | **Dibujo de ficha de diseño, imagen de costura ISO, imagen de paso** (Configurar Productos) | `backend/uploads/fichas-diseno/` (fija) | Tal cual, sin límite | **Sí.** El PDF de ficha lo lee como data URI y ya acepta webp (`solicitudesVendedorFichaProducto.js:54-67`). |
| 7 | **Imágenes del CMS del portal** (popup, barra lateral) | `backend/uploads/config_images/` (fija) | Tal cual, sin límite | **Sí.** WebP soporta transparencia. Un GIF animado necesita `animated: true` o se queda en el primer cuadro. |
| 8 | **Foto de entrega de encomienda** | `COMPROBANTES_ENCOMIENDAS_PATH` | **WebP 75**, 1200 px | Ya es WebP. ¿La subo a 80? Decidís vos. |
| 9 | **Imagen de artículo** | `backend/uploads/articulos/` (fija) | **WebP 80**, 512×512 | Ya está. |
| 10 | **Adjuntos de compras del WMS** (facturas, BL, despachos) | `STOCK_COMPRAS_PATH` | Tal cual, 40 MB | **Opcional.** Casi todo son PDF o Excel; convertiría solo las fotos. |
| 11 | **Thumbnails** (generados, no subidos) | `THUMBNAILS_PATH` | JPG 75-80 | **No por ahora.** La extensión `.jpg` está fija en el back y en ~10 pantallas del front (`FactoryView`, `OrderForm`, `FileControlCard`, `EmbBandeja`…). Sería un cambio aparte. |
| 12 | **Archivos de impresión del cliente** (portal, archivo de producción, referencia, solicitudes de vendedor) | `uploads/tmp` → Google Drive | Original | **No.** Se imprimen; además los leen el perfil ICC, la capa blanca DTF y la medición. |
| 13 | **Boceto TPU aprobado** (PNG del visor 3D) | Drive | PNG | **No** [I]: es referencia para producción; mejor sin pérdida. |
| 14 | **PDF de matriz TPU y de moldes TizadaPro** | `uploads/tpu-matriz`, `uploads/moldes-tizadapro` | PDF | **No:** PDF vectoriales que leen Python y pdfjs. |
| 15 | **PDF generados** (recibos, cierres, estados de cuenta) | `COMPROBANTES_PATH` | PDF | No aplica. |

**Cómo lo haría:** una sola función `aWebp(buffer|ruta, { calidad: 80, anchoMax })` en `utils/`, siguiendo el modelo de encomiendas: `.rotate()` para respetar la orientación del celular, resize si pasa un ancho máximo, `.webp({ quality: 80 })`. **Si sharp falla, se guarda el original**, como ya hace artículos. Se llama solo en los casos marcados **Sí**, después de mirar el mimetype: `image/*` se convierte y lo demás pasa tal cual. **Falta definir:** ¿ancho máximo? Encomiendas usa 1200. Para fallas, consultas y servicio técnico propongo 1600-2000, para no perder detalle.

---

## 3. Carpetas: estado actual

| Carpeta | Variable | Default si no está | Se sirve por |
|---|---|---|---|
| `fallas` | `FALLAS_PATH` [V] | `backend/fallas` | `server.js:88` |
| `tickets` | `TICKETS_SOPORTE_PATH` [V] | `backend/tickets` | `sendFile` con login (`ticketsRoutes.js:16-26`) |
| `servicio-tecnico` | `ST_ADJUNTOS_PATH` [V] | `backend/servicio-tecnico` | `sendFile` con login (`servicioTecnicoController.js:753-767`) |
| `consultas` | `CONSULTAS_FOTOS_PATH` [V] | `backend/consultas` | `sendFile` con login |
| `thumbnails` | `THUMBNAILS_PATH` [V] | `backend/thumbnails` | `server.js:86` |
| `comprobantesEncomiendas` | `COMPROBANTES_ENCOMIENDAS_PATH` [V] | `backend/comprobantesEncomiendas` | `server.js:90-91` |
| `stock/compras` | `STOCK_COMPRAS_PATH` [V] | `backend/stock/compras` | `server.js:94` |
| `comprobantesPagos` (subidos) | `COMPROBANTES_PAGOS_PATH` [V] | `backend/comprobantesPagos` | — |
| PDF generados | `COMPROBANTES_PATH` [V] | `backend/comprobantesPagos/<sub>` | — |
| `ordenes` (copias de Drive) | `ORDENES_PATH` [V] | `backend/ordenes` | — |
| **`uploads`** y sus subcarpetas (`tmp`, `fichas-diseno`, `articulos`, `config_images`, `tpu-matriz`, `moldes-tizadapro`) | **ninguna** | fija | `server.js:83` |

**Dónde está fija `uploads` (hay que cambiarla en todos):**
- `server.js:83` (el mount `/uploads`)
- `routes/webOrdersRoutes.js:208-218` (tmp) y `:256-269` (config_images)
- `routes/ordersRoutes.js:62-73` (tmp)
- `middleware/multerSolicitudesConfig.js` (tmp)
- `middleware/multerFichaDisenoConfig.js`, `multerArticulosConfig.js`, `multerMoldeTizadaConfig.js`
- `services/tpuMatrizService.js:35`
- **El que lee:** `services/solicitudesVendedorFichaProducto.js:54-67`, que arma la ruta como `backend/` + URL

---

## 4. Trampas al mover carpetas

1. **Consultas guardan la ruta absoluta.** `ConsultasClienteFotos.CFoRutaArchivo = f.path` (`consultasClienteService.js:459`), y `getFoto` exige que esté bajo la carpeta actual (`consultasClienteController.js:139-143`). Si se mueve la carpeta, **todas las fotos viejas dan 404** hasta correr un UPDATE que reemplace el prefijo.
2. **Otras rutas absolutas en la base:** `ColRutaPDF` (`contabilidadController.js:5814`) y `ArchivosOrden.RutaLocal`. Mismo problema si se mueven `COMPROBANTES_PATH` u `ORDENES_PATH`.
3. **Comprobantes de pago:**
   - **Variable:** el `.env` local define `COMPROBANTES_PATH`, pero lo subido lee `COMPROBANTES_PAGOS_PATH`. Los subidos y los generados pueden estar en carpetas distintas.
   - **Mayúsculas:** en disco existe `ComprobantesPagos` (con C mayúscula) y el código dice `comprobantesPagos`. En Linux son dos carpetas distintas.
   - **En el VPS: [?].**
4. **Moldes TizadaPro:** multer escribe en `uploads/moldes-tizadapro` (fija), pero el lector por lote usa `TIZADAPRO_MOLDES_DIR` (`tizadaProService.js:271`).
5. **Las fotos de encomiendas ya están repartidas en dos carpetas en el VPS** (las nuevas dentro del deploy, las viejas en /home; nota de la memoria del 23/09). Conviene unificarlas en la misma movida.
6. **Lo que queda dentro de `/var/www/sistema-produccion` se pierde o se duplica en cada deploy** si el deploy reemplaza la carpeta [I]. Es el motivo de fondo para sacarlo a /home.

---

## 5. Propuesta (para decidir)

**Variable base única:** `ARCHIVOS_BASE_PATH=/home/archivos`. Cada carpeta sale de ahí por defecto, por ejemplo `${ARCHIVOS_BASE_PATH}/fallas` o `${ARCHIVOS_BASE_PATH}/uploads/fichas-diseno`. **Las variables específicas que ya existen se respetan si están definidas**, así que no se rompe nada en el VPS ni en local. Un solo helper `utils/rutasArchivos.js` centraliza los defaults, y los 15 lugares lo usan en vez de `path.join(__dirname, …)`.

**Pasos:**
1. **Ver qué hay hoy en el VPS** (lo corrés vos):
   ```bash
   grep -E '^[A-Z_]*(PATH|DIR)=' /var/www/sistema-produccion/.env
   ```
   ```bash
   du -sh /var/www/sistema-produccion/{uploads,fallas,tickets,servicio-tecnico,consultas,thumbnails,comprobantes*,ComprobantesPagos,stock,ordenes} 2>/dev/null
   ```
2. Código: helper de rutas + `uploads` configurable + WebP en los casos **Sí**.
3. En el VPS: crear `/home/archivos`, mover las carpetas (`mv`, no copiar), definir la variable y reiniciar pm2.
4. UPDATE del prefijo en `ConsultasClienteFotos.CFoRutaArchivo`. Lo armo cuando sepamos la ruta vieja exacta.

**Decisiones pendientes:**
- ¿WebP en todos los **Sí** o solo en algunos?
- ¿Ancho máximo?
- ¿Encomiendas de 75 a 80?
- ¿Nombre de la carpeta base?
- ¿Convertir también lo ya subido, o solo lo nuevo? Propongo solo lo nuevo: lo viejo sigue andando porque la URL está en la base o en el nombre.

**Pendientes que quedaban, revisados el 07/10:**
- **`prendasOrdersController.uploadOrderFile` (L2697) no lo usa nadie [V].** Ninguna ruta lo referencia. El único que llama a un `uploadOrderFile` es `pedidosExternos/procesador.js:281`, y usa el de `webOrdersController`. El portal sube por `/web-orders/upload-stream`. Es código sin uso: marcarlo y confirmar con quien lo escribió antes de borrarlo.
- **URLs de las imágenes del CMS [V]:**
  - `ContenidoWeb.ImagenUrl` (`webContentController.js:39`) guarda la URL relativa `/uploads/config_images/…`.
  - `ConfigMapeoERP.ImagenWeb` (`webOrdersController.js:4086`) guarda la URL **absoluta**: `ConfigWebServicesModal.jsx:134-143` le antepone el servidor. Si alguien la sube desde el sistema local, queda guardado `http://localhost:5000/…` y en producción no se ve. No pasa nada por mover la carpeta, porque la URL no cambia.
  - En producción no existía `uploads/config_images` (según el `du` del 07/10), así que hasta hoy no se subió ninguna imagen del CMS desde el sistema [I].
- **`uploads/moldes`: no la lee ni la escribe nada** (búsqueda recursiva en backend, front y scripts) [V]. Está vacía. Santiago decidió dejarla (07/10).
- `prendasOrdersController.uploadOrderFile` quedó marcado `SIN USO (07/10/2026)` y sigue en el código.
- **Adjuntos de compras del WMS:** ahora también pasan a WebP (`routes/wmsInternoRoutes.js`), solo las fotos. El front los abre con un link en otra pestaña (`StockGestionPage.jsx:3977`).

---

## 6. Plan: thumbnails a WebP (para decidir, no implementado)

**El problema.** La URL `/thumbnails/<orden>/<archivoId>.jpg` no se guarda en la base: se **arma** en 9 lugares del front y en 3 del back [V]:
- **Front:** `FactoryView.jsx:837,906,1014`, `OrderForm.jsx:2804`, `PrendaOrderForm.jsx:3461`, `EmbBandeja.jsx:81`, `FileControlCard.jsx:166,171`, `FilePrintControl.jsx:1591`.
- **Back:** `embBoardController.js:202,530`, `thumbnailGenerator.getThumbnailUrl` (que usa `ecoUvFinishingController.js:206`).

El disco se consulta en `thumbnailExists`, `copyThumbnail`, las copias directas (`webOrdersController.js:3198-3207`, `prendasOrdersController.js:3319-3328`) y `scripts/backfillThumbnails.js:61-62`, que es el cron de 10 minutos.

**Propuesta en 3 fases (cada una se puede deployar sola):**

1. **Generar en WebP sin tocar el front.**
   - `thumbnailGenerator` escribe `<id>.webp` (calidad 80, lado mayor 1080).
   - En `server.js`, **antes** del `express.static('/thumbnails')`, un middleware chico: si piden `<id>.jpg`, el `.jpg` no existe y el `.webp` sí, se sirve el `.webp` con `Content-Type: image/webp`. Las 12 URL que arman `.jpg` siguen andando y los `.jpg` viejos también.
   - `thumbnailExists`, `copyThumbnail`, las 2 copias directas y el backfill aceptan cualquiera de las dos extensiones. Si no, el cron regeneraría todo cada 10 minutos, porque buscaría un `.jpg` que ya no existe.
2. **Convertir lo existente (opcional).** Script con modo simulación: `.jpg` → `.webp` y se borra el `.jpg`. Antes hay que medir cuánto se ahorra.
3. **Limpieza (opcional).** El front pide `.webp` directo, o mejor, el back devuelve la URL armada y el front deja de construirla. El paso 1 ya funciona sin esto.

**A revisar antes de arrancar:**
- **Tamaño actual:** `du -sh /home/thumbnails` y `find /home/thumbnails -name '*.jpg' | wc -l`, para saber si vale la pena.
- **nginx:** si tiene una regla propia para `/thumbnails` (que sirva la carpeta sin pasar por Express), el middleware de la fase 1 no se ejecuta. Revisar con `grep -Rn thumbnails /etc/nginx/`. Según la memoria hay un solo proxy, `location /` [I].
- **Navegadores viejos:** WebP necesita Safari 14 o más nuevo (iOS/macOS 2020). En la memoria hay usuarios con Safari viejo, por eso pdf.js va en su versión legacy [I]. Si quedan iPads o tótems con iOS 13 o anterior, no verían ninguna imagen WebP. Esto vale también para lo que se convirtió hoy. El log HTTP no guarda el navegador, así que habría que preguntar qué equipos usan.
- El service worker no cachea `/thumbnails/` (`public/sw.js:67`), así que no hay riesgo de caché vieja.
