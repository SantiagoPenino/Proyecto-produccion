# API externa de pedidos de prenda — plan

**Fecha:** 18/09/2026 · **Actualizado:** 21/09/2026 (decisiones D1–D5 resueltas, §5) · **Estado:** ETAPA A + ETAPA B ESCRITAS EN LOCAL el 21/09 (sin probar creando un pedido real, sin commit) — ver §0.1 y §0.2.

**Alcance de la primera entrega (decidido 21/09):** modo **"Fabricar prendas a la medida"** completo —
*Producto terminado* y *Producto personalizado (cliente)*, con *Facturar por cada área* y *Precio
establecido*, y todas sus características (producción principal, corte, costura, bordado, DTF, TPU,
estampado, tela de cliente, talles, referencias). Segundo: **"Comprar prendas"**. *Combos y Promos* y
*Personalizar prenda del cliente* quedan fuera por ahora (el diseño los contempla, no se construyen).
Archivos **solo por URL**. Key **por `.env`**.

Objetivo: que un sistema externo pueda ingresar, llamando a una API con datos, **el mismo pedido**
que hoy se carga a mano en `/ventas/pedido-prenda` (los 4 modos de "Qué desea" + el servicio
principal + complementarios), y que el resultado en la base sea **indistinguible** del que deja
la página.

Regla de oro del plan: **la página no se toca y `createWebOrder` no se toca.** Todo es aditivo.
El endpoint nuevo es un *adaptador*: valida, mide, arma el mismo payload que arma el formulario
y llama a la misma lógica que ya está probada.

---

## 0. Orden de construcción: una sola entrada, dos puertas (21/09/2026)

Hoy el primer (y único) consumidor es el botón **"Convertir en pedido de producción"** de la
Solicitud del vendedor (Spec 41, `/ventas/solicitudes/:id`). Más adelante los diseños los hará
**otro sistema**, y ese sistema será quien mande el pedido. Para que ese día no haya que rehacer
nada:

> El botón **no** llama a `createWebOrder` ni arma el payload del formulario. Arma el **mismo JSON
> de negocio del §2.3** y se lo entrega al **mismo validador + traductor + procesador**. El sistema
> externo, cuando exista, manda ese mismo JSON por HTTP con su key. **Un contrato, dos puertas.**

```
Puerta 1 (AHORA)   Solicitud → botón "Convertir"  ─┐
                   (usuario interno logueado,       ├─► validador → traductor → procesador → createWebOrder (intacto)
                    sin key, sin HTTP externo)      │
Puerta 2 (DESPUÉS) Sistema externo → POST + x-api-key ┘
```

### 0.1 Qué quedó escrito (21/09/2026) — falta probar creando un pedido real en LOCAL

| Pieza | Archivo |
|---|---|
| SQL (correr en local, después en prod) | `scripts/add_conversion_solicitud_pedido.sql` — columnas Material/CodArticulo/CodStock/Copias en `SolicitudesVendedorArchivos` + tabla `IntegracionPedidos` |
| Catálogo (mismas consultas del nomenclador) | `backend/services/pedidosExternos/catalogo.js` |
| Validador intermedio | `backend/services/pedidosExternos/validador.js` |
| Traductor (función pura, con referencia de línea al formulario) | `backend/services/pedidosExternos/traductor.js` |
| Procesador (idempotencia, invoca `createWebOrder` y `uploadOrderFile` en proceso, pasa archivos en segundo plano, reintento) | `backend/services/pedidosExternos/procesador.js` |
| Armador Solicitud → pedido, tela/copias por archivo, convertir | `backend/services/solicitudesVendedorConversion.js` (+ enganches mínimos en `solicitudesVendedorService.js`, controller y rutas) |
| Pantalla: pestañas + tabla de servicios + tela/copias + botón Convertir con estado | `src/components/pages/ventas/SolicitudVendedorDetalle.jsx` |

Decisiones tomadas el 21/09: la tela la elige el **diseñador** por archivo; **copias = 1** por defecto; archivo **normal** (sin escala ni raport); **más de un archivo en todos los servicios**.

Probado (solo lectura, base local): Solicitud → pedido de negocio → validador → body del creador de pedidos.
**No probado todavía:** la creación real y el pase de archivos por Drive (requiere correr el SQL y hacerlo desde la pantalla).

Limitaciones de esta primera versión: precio establecido solo con 1 producto (P-14); DTF/TPU sin ancho/alto en el ítem **igual que la página** (la página tampoco los manda); no espera la cotización (la dispara sola `createWebOrder`, como siempre); sin mínimos de TPU.

### 0.2 Segunda tanda del 21/09 — lo que faltaba del plan

| Pieza | Archivo |
|---|---|
| Tela del cliente: bobina elegida al convertir, ancho de la bobina, metros (Σ alto × copias) | `catalogo.js` (`bobinasDe`), `validador.js`, `traductor.js`, selector en la pantalla |
| Puerta HTTP del sistema externo: `x-api-key` que falla cerrado, apagado por `.env`, límite 60/min, `POST` 202 + `GET` estado + reintento | `backend/controllers/externalPedidosController.js`, `backend/routes/externalPedidosRoutes.js`, montaje en `server.js` (bloque propio) |
| Catálogos de lectura (telas, servicios, productos terminados, bobinas del cliente) | mismo controller |
| Medición en servidor para archivos que llegan sin medida (copia de `medirArteMetros` + rechazo sin DPI y multipágina) | `backend/services/pedidosExternos/medicion.js` |
| Descarga segura de enlaces (solo https, nunca a la red interna, tope de tamaño y tiempo; Drive por la API autenticada) | `backend/services/pedidosExternos/descarga.js` |
| Pruebas del traductor (10, pasan) + enganche para fixtures dorados de la página | `backend/__tests__/pedidosExternos.traductor.test.js` |
| Documentación para el integrador | `backend/docs/API_EXTERNAL_PEDIDOS_PRENDA.md` |

**Garantía de no romper producción (verificado con git el 21/09):** de los archivos que ya existen en
producción, esta tarea modificó **uno solo**: `backend/server.js`, agregando un bloque `try/catch`
propio que monta la ruta nueva. `prendasOrdersController`, `webOrdersController`, `PrendaOrderForm.jsx`,
`fileService.js` y sus rutas están **sin cambios**. Todo lo demás son archivos nuevos. Sin la key en el
`.env` la puerta externa responde 503; la conversión solo corre si alguien aprieta el botón.

**Pendiente (no se puede hacer sin el usuario):** correr el SQL en local → probar convertir un pedido
real → capturar el body de la página para los fixtures dorados → SQL en prod → variables `.env` → deploy.
**Sin construir:** segunda entrega "Comprar prendas" (4.5/4.6), reuso de matriz TPU (4.4), mínimos de TPU,
P-14, F0 (agujeros de seguridad ajenos a esta API) y F8.

### Etapa A — ahora (para que el botón funcione)

| Pieza | Nota |
|---|---|
| Tabla `IntegracionPedidos` (F1) | `Origen='SOLICITUD_VENDEDOR'`, `IdExterno='SOL-{SolicitudID}-P{ProductoSolID}'` → convertir dos veces el mismo producto es imposible. |
| Validador intermedio (F4) | Red de seguridad: catálogo, obligatorios por modo, medidas vs material. La Solicitud ya valida (`faltantesConversion`); esto es la segunda barrera y la que usará el externo. |
| Traductor (F4.1–4.3) | Fabricar a medida: personalizado + terminado, por área + precio establecido. Con fixtures dorados de la página. |
| Procesador (F5) | Crea, pasa los archivos por la misma tubería de `upload-stream`, espera cotización, guarda resultado; escribe `PedidoNoDocERP` en el producto de la Solicitud. |
| Armador en Solicitudes | Función nueva en `solicitudesVendedorService`: Solicitud+producto → JSON de negocio. Endpoint `POST /api/solicitudes-vendedor/:id/productos/:prodId/convertir` + estado en el detalle. |

**Lo que NO hace falta en la Etapa A** (y era lo más pesado del plan):
- **Medidor en servidor (F3):** la Solicitud ya guarda `AnchoM/AltoM` de cada diseño pronto, medidos
  por el navegador con el **mismo** `fileService` que usa la página. El contrato acepta
  `archivo.anchoM/altoM`; si vienen, se usan y el validador los controla contra el material.
- Key, rate limit, ruta HTTP externa, catálogos de lectura (F2), documentación para terceros (F7).

### Etapa B — cuando llegue el sistema externo

Puerta HTTP + `x-api-key` (§2.2), catálogos de lectura (F2), doc (F7) y **decidir la medida**: o el
externo manda `anchoM/altoM` (se confía y se controla contra el material), o se construye el medidor
en servidor (F3). No cambia nada de la Etapa A.

### Archivos: van por enlace, pero pasan por la tubería de siempre

La Solicitud sube el diseño a Drive una vez (`PEDIDOS WEB/SOLICITUDES`, nombre `SOL-{id}_…`). Al
convertir, el procesador **no** le pide nada al usuario: baja el archivo desde ese enlace
(`driveService.getFileStream`) y lo pasa por la misma lógica que `upload-stream` → queda en la
carpeta del área con el **nombre de producción** (`SB-10994_CLI_Trabajo_Archivo 1 de 2 (x5).pdf`),
con miniatura, perfil ICC y preflight, y la orden se activa `Cargando… → Pendiente`. Es lo único que
garantiza "tal cual fuera desde el ingreso del pedido". Apuntar `RutaAlmacenamiento` directo al
enlace de la Solicitud sería más corto pero dejaría el archivo con otro nombre, en otra carpeta y
sin miniatura/ICC/preflight.

### Lo que le falta HOY a la Solicitud para poder armar el pedido completo

La página manda datos que la Solicitud todavía no captura. Hay que cerrarlos antes de construir el
armador (el script `add_solicitudes_vendedor.sql` aún no corrió en prod → se puede ampliar sin migración):

| # | Falta | Por qué lo exige el pedido | Propuesta |
|---|---|---|---|
| G1 | **Producción principal: material, variante, copias y modo de impresión POR ARCHIVO**, y qué archivo es dorso de cuál | La página agrupa por `MATERIAL\|VARIANTE` (una orden por grupo) y los metros = alto × copias son la base de facturación | Columnas en `SolicitudesVendedorArchivos` (`CodArticulo`, `Material`, `Variante`, `Copias`, `DorsoDeArchivoID`, `DatosJson` para modo de impresión) — las carga **quien sube el diseño pronto** (pendiente 3 de Spec 41) |
| G2 | **Varios diseños prontos por parte** | DTF/TPU: cada archivo de producción es un ítem; sublimación: N archivos | Hoy `faltantesConversion` pide "al menos uno"; confirmar que la pantalla permite N vigentes por parte |
| G3 | **Bordado: qué archivo es logo/ponchado y cuál boceto** | La página manda `LOGO_BORDADO` + `BOCETO_BORDADO` | Mapear `DISENO_PRONTO`→`LOGO_BORDADO`, `BOCETO`→`BOCETO_BORDADO` |
| G4 | **Estampado (EST)** | La página crea una EST por cada DTF/TPU: cantidad = prendas × estampados por prenda, origen de las prendas | Ya están `CantidadTotal`, `PorPrenda`, `origenPrendas` (TPU). Falta `origenPrendas` en DTF (default `Stock User`) |
| G5 | **TPU: forma y mínimos** | Validación de mínimos TPU + `tpuForma` | Agregar a `Datos` de la parte TPU |
| G6 | **Bobina de tela del cliente** | `bobinaId` + `magnitud` | Se elige en el momento de convertir (ya decidido en Spec 41) → el botón abre un paso previo solo si el corte es con tela del cliente |
| G7 | **Talles** | La página acepta roster o planilla | Planilla adjunta (`PLANILLA`→`INFO_PEDIDO`), ya decidido |
| G8 | **P-14: precio único por Solicitud vs un pedido por producto** | `[PRECIO ESTABLECIDO: …]` va en la PRO madre de **cada** pedido | Sin resolver. Con un solo producto no hay problema → la Etapa A puede salir limitada a "precio establecido solo si la Solicitud tiene 1 producto" hasta que se decida |

---

## 1. Lo que ya existe (verificado en código)

### 1.1 Qué llama la página

| Modo | Llamadas |
|---|---|
| Comprar prendas (sin personalizar) | `POST /api/wms/order` → `wmsController.createOrder` (`VEN-` + orden ancla PRO). |
| Comprar + personalizar · Fabricar a medida · Combos y Promos · Personalizar prenda del cliente | `POST /api/prendas-orders/create` → `prendasOrdersController.createWebOrder:510` → responde `{orderIds, uploadManifest}` → un `POST /api/web-orders/upload-stream` (multipart) por archivo del manifiesto. |
| TPU con matriz reutilizada | `POST /api/web-orders/reuse-matriz` y nada más. |

- Cliente: **no viaja en el body**. Header `X-Cliente-CodCliente` + JWT `userType:'INTERNAL'`
  (`middleware/impersonarClienteInterno.js`).
- Precios: **no viajan**. Todas las líneas nacen en 0; cotiza el servidor post-commit
  (`ERPSyncService.syncFinalOrderIntegration`, `setImmediate`, best-effort).
  Excepción: `POST /wms/order` **sí confía** en `precio`/`total`/`clienteId` del body.
- Las órdenes nacen `Cargando...` y se activan al subir el último archivo. Si no llegan en
  30 min las cancela `jobs/zombieOrdersCleanup.job.js`.
- `createWebOrder` solo usa `req.body`, `req.user` y `req.disenadorId` → se puede invocar
  en proceso sin HTTP.

### 1.2 Lo que vive SOLO en el formulario (y el backend no repite)

1. **Medición de archivos** — `src/client-portal/api/fileService.js:269-455`: DPI real del PNG
   (`pHYs`), tamaño del PDF (`MediaBox/CropBox`, `/Rotate`, `/UserUnit`, multipágina = suma de
   altos). El backend guarda `width/height` en metros tal cual llegan, y **esa es la base de
   facturación**.
2. **Reglas de medida** — `PrendaOrderForm.jsx:1019-1180`: sin DPI se rechaza, ancho imprimible
   (material − 3 cm, tolerancia 2 mm), materiales de medida fija, alto DTF 0,10–2,50 m, largo
   ≤ metros restantes de la bobina, más de 1 página se rechaza.
3. **Validaciones de pedido** — `PrendaOrderForm.jsx:1217-1488`: mínimos TPU, arte obligatorio
   por servicio, cantidad ≤ disponible en prenda del cliente, todo artículo con su servicio, etc.
4. **Armado de `servicios[]`** — `PrendaOrderForm.jsx:1551-2366`: un grupo por `MATERIAL|VARIANTE`,
   PRO madre, una EST por cada DF/TPU, quién es `esPrincipal`, orden del array (la PRO de
   "comprar y personalizar" va al frente), `combosRetiro[]`, códigos fijos (Corte `1375`,
   Estampado `110`, Costura `112`), marcadores en notas (`[PRECIO ESTABLECIDO: …]`,
   `[FACTURA POR AREA]`), `magnitud` de tela cliente.
5. **Defaults** — variante/material por defecto, `'DTF Textil'`, `estampadoOrigin='Stock User'`.

### 1.3 Lo que NO hay

- Auth de máquina para prendas (solo JWT de persona). La única creación con `x-api-key` es
  `POST /api/web-orders/integration/create` (planilla) y no soporta prendas.
- Idempotencia ni campo de referencia externa.
- Archivos por URL (la planilla los acepta solo como referencia, sin medir).
- Respuesta con `OrdenID`/`NoDocERP`/precio. La cotización es asíncrona y falla en silencio.
- Registro de quién creó el pedido (`req.vendedorId` se calcula y se descarta).
- Documentación (no hay OpenAPI/Postman; solo `backend/docs/API_EXTERNAL_ORDENES.md`, lectura).

---

## 2. Diseño

### 2.1 Arquitectura

```
Sistema externo
   │  x-api-key + Idempotency (origen + idExterno)
   ▼
POST /api/external/pedidos-prenda            ← NUEVO (routes/externalPedidosRoutes.js)
   1. auth + rate limit propio
   2. validar forma del body (contrato de negocio, §2.3)
   3. registrar solicitud en IntegracionPedidos  (UNIQUE origen+idExterno → idempotencia)
   4. responder 202 { solicitudId, estado:'RECIBIDO' }
   ▼
Procesador (en proceso, cola simple sobre la tabla)      ← NUEVO (services/pedidosExternos/)
   5. resolver cliente + catálogos (producto, combo, variantes, materiales, stock, bobina…)
   6. descargar archivos a uploads/tmp  →  MEDIR en servidor (sharp + pdf-lib, ya instalados)
   7. validaciones de negocio (las del formulario, §1.2 puntos 2 y 3)
   8. TRADUCTOR: body de negocio → payload idéntico al del formulario (§1.2 punto 4)
   9. invocar createWebOrder / createOrder EN PROCESO (req/res simulados)   ← lógica actual, intacta
  10. subir cada archivo del uploadManifest por la misma lógica de upload-stream → Drive → activa
  11. esperar cotización y guardar resultado (códigos, NoDocERP, OrdenIDs, total) en la solicitud
   ▼
GET /api/external/pedidos-prenda/:solicitudId   → estado + resultado + errores
```

**Por qué asíncrono:** descargar y medir archivos de producción puede tardar minutos; un POST
síncrono se corta por timeout y el externo reintenta → duplicado. Con 202 + estado, el reintento
es inofensivo.

**Por qué invocar en proceso y no refactorizar:** `createWebOrder` son 2.000 líneas con 9 salidas
`res.status(...)`, es un fork "en poda" y hay sesiones paralelas tocándolo. Un `req`/`res`
simulado (`{ body, user, disenadorId }` + captura de `status/json`) es cero riesgo para la página.
El refactor a servicio queda como F8 opcional.

### 2.2 Autenticación y trazabilidad

- Header `x-api-key`, comparada contra `PEDIDOS_EXTERNOS_API_KEY`. **Sin valor por defecto:**
  si la variable no está, el endpoint responde 503 (falla cerrado). Mismo patrón que
  `externalController`, pero como middleware de router (no por handler).
- Rate limit propio del router (`express-rate-limit`, ya instalado).
- El procesador arma el `req.user` igual que `impersonarClienteInterno` (mismos campos), con
  `impersonadoPorInterno` = usuario de servicio (`PEDIDOS_EXTERNOS_USUARIO_ID`).
- Trazabilidad completa en `IntegracionPedidos`: origen, idExterno, body recibido, payload
  generado, resultado, error, timestamps.

> D1 resuelta: **una sola key por `.env`**. La tabla de integradores queda para cuando haya un segundo.

### 2.3 Contrato de negocio (borrador)

El externo habla en términos de negocio, **nunca** en flags del formulario
(`esPrincipal`, `grupoItemId`, `chainedAfterAreaId`… los pone el traductor).

```jsonc
POST /api/external/pedidos-prenda
{
  "idExterno": "CRM-2026-000123",          // obligatorio, único por origen → idempotencia
  "cliente": { "codCliente": 1234 },        // o { "idReact": 55 } / { "idCliente": "ACME" }
  "nombreTrabajo": "Camisetas Verano 2026",
  "notas": "…",
  "modo": "FABRICAR",                       // COMPRAR | COMPRAR_PERSONALIZAR | FABRICAR | COMBO | PRENDA_CLIENTE
  "servicioPrincipal": "sublimacion",       // el de la página: sublimacion | DF | tpu | bordado | ecouv | directa | corte…

  // Producción principal (impresión): una entrada por archivo
  "impresion": {
    "variante": "Sublimación en tela User",
    "telaCliente": { "bobinaId": 143 },     // solo variante tela de cliente
    "items": [
      { "archivo": { "url": "https://…/frente.pdf", "nombre": "frente.pdf" },
        "dorso":   { "url": "…" },          // opcional
        "material": { "codArticulo": "1558" },   // por código; nombre solo como fallback
        "copias": 10,
        "modoImpresion": { "tipo": "NORMAL" },   // NORMAL | RAPORT{…} — lo que hoy resuelve PrintSettingsPanel
        "terminaciones": [ { "terminacionId": 3, "cantidad": 10 } ],
        "nota": "…" }
    ]
  },

  // Qué se fabrica / compra
  "producto": { "tipoFabricacion": "PERSONALIZADO",                  // TERMINADO | PERSONALIZADO
                "proIdProducto": 474,                                 // solo TERMINADO
                "cantidad": 25,
                "precio": { "modo": "POR_AREA" } },                   // solo PERSONALIZADO; o { "modo":"ESTABLECIDO","monto":1200,"moneda":"UYU" }
  "carrito": [ { "proIdProducto": 440, "wmsVarianteId": 9912, "cantidad": 5 } ],   // COMPRAR*
  "prendasCliente": [ { "prendaClienteId": 77, "cantidad": 12 } ],                  // PRENDA_CLIENTE

  // Servicios complementarios / decoración. "sobre" apunta al componente cuando hay combo/carrito/prenda cliente
  "servicios": [
    { "tipo": "BORDADO", "sobre": { "comboItemId": 31 },
      "variante": "…", "material": { "codArticulo": "…" },
      "logos": [ { "url": "…" } ], "boceto": { "url": "…" } },
    { "tipo": "DTF", "archivos": [ { "url": "…" } ], "boceto": { "url": "…" },
      "estampado": { "prendas": 25, "estampadosPorPrenda": 2, "origen": "Stock User" } },
    { "tipo": "TPU", "reusarMatrizOrdenId": 8812, "cantidad": 100 },
    { "tipo": "CORTE", "moldes": "CLIENTE", "tizadas": [ { "url": "…" } ], "origenTela": "…" },
    { "tipo": "COSTURA", "nota": "…" }
  ],

  "talles": [ { "numero": 10, "jugador": "…", "talle": "M", "categoria": "…" } ],
  "archivosReferencia": [ { "url": "…", "tipo": "REFERENCIA" } ]
}
```

Respuestas:

```jsonc
202 { "solicitudId": 501, "estado": "RECIBIDO" }
200 { "solicitudId": 501, "estado": "CREADO", … }      // mismo idExterno reenviado → devuelve el existente, NO crea otro
409 { "error": "idExterno ya usado con un body distinto" }

GET /api/external/pedidos-prenda/501
{ "estado": "RECIBIDO | PROCESANDO | CREADO | RECHAZADO | ERROR",
  "noDocERP": 10994,
  "ordenes": [ { "ordenId": 55120, "codigo": "SB-10994", "area": "SB", "estado": "Pendiente" } ],
  "ventas":  [ { "codigo": "VEN-3321" } ],
  "cotizacion": { "estado": "OK", "total": 15400.00, "moneda": "UYU" },
  "archivos": [ { "nombre": "frente.pdf", "anchoM": 1.50, "altoM": 2.31, "estado": "SUBIDO" } ],
  "errores": [ { "campo": "impresion.items[0].archivo", "codigo": "ANCHO_EXCEDE_MATERIAL",
                 "mensaje": "El archivo mide 1,85 m de ancho y el material admite 1,80 m." } ] }
```

Los rechazos de negocio llevan **código estable + mensaje claro** (el externo decide por código,
la persona lee el mensaje).

> D2 resuelta: archivos **solo por URL**. No hay subida multipart en esta API.

Reglas del bloque `producto` (copiadas del formulario, `PrendaOrderForm.jsx:2758-2837`):
- `tipoFabricacion: "TERMINADO"` → `proIdProducto` obligatorio (catálogo grupo 2.1); trae sus
  servicios incluidos. **No lleva bloque `precio`** → si llega, 400.
- `tipoFabricacion: "PERSONALIZADO"` → sin `proIdProducto`; `cantidad` de prendas y `precio` obligatorios.
- `precio.modo: "POR_AREA"` (= "Facturar por cada área", `SECTORES` en el form): cada sector cotiza
  con su tarifa.
- `precio.modo: "ESTABLECIDO"` (= "Precio establecido"): `monto` > 0 y `moneda` `UYU|USD`
  obligatorios. Es el precio FINAL en esa moneda, no se convierte ni se le suma nada. Viaja como
  `[PRECIO ESTABLECIDO: …]` en la nota de la PRO madre, igual que hoy.
- D5 resuelta: **las dos opciones quedan habilitadas** para la key, sin permiso aparte.

### 2.4 Tabla nueva (único SQL del plan)

`backend/scripts/add_integracion_pedidos.sql` — se entrega como script, la corre el usuario.

```
IntegracionPedidos
  SolicitudID INT IDENTITY PK
  Origen VARCHAR(50)  · IdExterno VARCHAR(100)      → UNIQUE (Origen, IdExterno)
  BodyHash CHAR(64)                                  → detectar mismo id con body distinto (409)
  BodyRecibido NVARCHAR(MAX) · PayloadGenerado NVARCHAR(MAX)
  Estado VARCHAR(20) · Intentos INT
  CodCliente INT · NoDocERP INT NULL
  Resultado NVARCHAR(MAX) NULL · Errores NVARCHAR(MAX) NULL
  FechaRecibido · FechaInicio · FechaFin DATETIME
```

Sin columnas nuevas en `Ordenes`: el vínculo es `IntegracionPedidos.NoDocERP` ↔ `Ordenes.NoDocERP`.

### 2.5 Medición en servidor

`backend/services/pedidosExternos/medicionArchivo.js` — **port literal** del algoritmo de
`fileService.js` (mismos pasos, mismo orden, mismos defaults: DPI 300 si falta, MediaBox desde la
cola del archivo, `/Rotate`, `/UserUnit`, suma de páginas), sobre `Buffer` en vez de `File`.
`sharp` y `pdf-lib`/`pdfjs-dist` ya están en `backend/package.json`. No se inventa otro método:
si el servidor mide distinto que el navegador, factura distinto.

### 2.6 Modo COMPRAR (WMS)

El adaptador **no acepta precios del externo**: toma `proIdProducto + wmsVarianteId + cantidad`,
calcula precio con la misma regla que `wmsController.getCatalog` (`precio_excepcion` de la
variante, si no `PreciosBase`), convierte moneda con `getExchangeRate`, verifica stock, y recién
ahí invoca `createOrder` en proceso con el body ya armado.

---

## 3. Fases

Cada fase queda usable y probada en LOCAL antes de pasar a la siguiente. Sin commits ni
migraciones a prod por mi parte: scripts SQL entregados + checklist de deploy.

### F0 — Cerrar lo abierto (independiente, hacerlo primero)

Hallazgos del relevamiento; no dependen de este proyecto pero no conviene abrir una API nueva
con estos agujeros al lado.

| # | Qué | Dónde | Cuidado |
|---|---|---|---|
| 0.1 | `/api/products-integration` montado **sin auth** (crear/borrar artículos, precios, vitrina) | `server.js:217` | Agregar `verifyToken` al montar. Antes: confirmar que todas las pantallas que lo llaman mandan token (usan `apiClient`, debería). |
| 0.2 | `INTEGRATION_API_KEY` con default `'macrosoft-secret-key'` | `routes/webOrdersRoutes.js:171` | Antes de sacar el default: **confirmar que el `.env` de prod la define** y qué key usa el script de Google Sheets; si usa el default, primero rotar ahí. |
| 0.3 | Tótem deja pasar todo si `TOTEM_TOKEN` está vacío | `middleware/totemAuth.js:26` | Confirmar `.env` prod antes de fallar cerrado. |
| 0.4 | `upload-stream` no verifica que el `dbId` sea del cliente del token | `webOrdersController.uploadOrderFile` | Validar `ArchivoID/RefID → Orden → CodCliente` cuando el rol es cliente; interno pasa. |

### F1 — Infraestructura del endpoint

- `add_integracion_pedidos.sql`.
- `routes/externalPedidosRoutes.js` montado en `/api/external/pedidos-prenda` con middleware
  `verifyPedidosApiKey` (falla cerrado) + rate limit.
- `POST /` (registra + idempotencia + 202) y `GET /:solicitudId`.
- Procesador: toma `RECIBIDO` → `PROCESANDO` con `UPDLOCK, READPAST` (seguro con más de una
  instancia), reintento acotado solo para errores técnicos (nunca tras haber creado el pedido:
  si el paso 9 respondió OK, los reintentos retoman desde el paso 10).
- Prueba: mismo `idExterno` 5 veces en paralelo → 1 sola fila.

### F2 — Catálogos de lectura para el externo

`GET /api/external/pedidos-prenda/catalogo/...` — envoltorios de consultas que ya existen, con
`x-api-key`:

| Endpoint nuevo | Reusa |
|---|---|
| `/servicios` (áreas + variantes + materiales con `codArticulo`, `codStock`, `Ancho`, `Largo`, UM) | `/nomenclators/variants/:area`, `/nomenclators/materials/:area/:variante`, `/web-orders/area-mapping` |
| `/productos` (terminados grupo 2.1 + combos, con componentes, `comboItemId`, `wmsVarianteId`, servicios admitidos) | `/prendas-orders/productos-terminados` + `/:id/servicios` + `personalizacion-admitida` |
| `/stock` (variantes WMS con stock y precio) | `wmsController.getCatalog` |
| `/clientes/:cod/prendas` y `/clientes/:cod/bobinas` | `/inventory/prendas-cliente/disponible`, `/inventory/tela-cliente/disponible` |
| `/clientes/:cod/matrices-tpu` | `/web-orders/mis-matrices` |
| `/terminaciones/:codArt` | `/nomenclators/terminaciones-material/:codArt` |

Clientes ya está: `GET /api/external/clientes`.

### F3 — Descarga y medición

- Descarga por URL a `uploads/tmp` (reusar el patrón de `fileProcessingService.downloadStream`),
  con: solo `https`, bloqueo de IPs privadas/loopback (SSRF), tope de tamaño, timeout, y links de
  Google Drive resueltos como ya se hace hoy.
- `medicionArchivo.js` (§2.5) + detección de tipo por magic bytes + regla JPEG solo sublimación.
- **Prueba de paridad de medida:** script solo-lectura contra LOCAL que toma N archivos reales ya
  subidos (de `ArchivosOrden` con `Ancho/Alto` guardados por el formulario), los mide con el
  servicio nuevo y compara. Criterio: diferencia 0 al cm en el 100% de la muestra.

### F4 — Traductor + validaciones, modo por modo

`services/pedidosExternos/traductor.js`: función **pura** `(bodyNegocio, catalogos, medidas) →
payload del formulario`. Se entrega por modo, de menor a mayor riesgo:

**Primera entrega — "Fabricar prendas a la medida"**

| Sub-fase | Qué | Genera |
|---|---|---|
| 4.1 | Producción principal + complementarios (impresión + corte/costura/bordado/DTF/TPU/estampado, tela de cliente, talles, referencias) | grupos `MATERIAL\|VARIANTE`, EST por cada DF/TPU, `magnitud` tela cliente |
| 4.2 | Producto **personalizado (cliente)** — por área y precio establecido | PRO madre `FABRICA PRODUCTO PERSONALIZADO` + marcador `[FACTURA POR AREA]` / `[PRECIO ESTABLECIDO: …]`; `esPrincipal` apagado en la impresión |
| 4.3 | Producto **terminado** (catálogo, grupo 2.1) | PRO `FABRICA PRODUCTO TERMINADO` + servicios obligatorios heredados del producto (`/productos-terminados/:id/servicios`) |
| 4.4 | TPU con matriz reutilizada | llamada a `reuseMatrizTPU` |

**Segunda entrega — "Comprar prendas"**

| Sub-fase | Qué | Genera |
|---|---|---|
| 4.5 | Comprar (sin personalizar) | body de `/wms/order` con precio calculado en servidor (§2.6) |
| 4.6 | Comprar + "Personalizar esta compra" | PRO al frente con `articulosVenta[]` + `combosRetiro[]` por artículo |

**Fuera de alcance por ahora** (contrato previsto, sin construir): Combos y Promos (PRO "de precio" +
servicios por componente + `combosRetiro[]`) y Personalizar prenda del cliente (`prendaClienteId`).
Si llega `modo: "COMBO"` o `"PRENDA_CLIENTE"` → 400 `MODO_NO_HABILITADO`.

`services/pedidosExternos/validaciones.js`: las reglas de §1.2 (2) y (3), una función por regla,
cada una con su código de error estable. Copiadas del formulario con la referencia de línea en
el comentario, para poder re-sincronizar.

**Prueba de paridad del traductor (la más importante del plan):** para cada modo, cargar un
pedido real en la página en LOCAL, copiar el body del `POST /prendas-orders/create` desde la
pestaña Red del navegador → fixture "dorado" en `backend/tests/fixtures/pedidosExternos/`.
El test arma el body de negocio equivalente y exige que el traductor produzca **el mismo payload**
(ignorando `fileKey`). Mínimo 2 fixtures por modo.

### F5 — Procesador completo

- Invocación en proceso de `createWebOrder` / `createOrder` / `reuseMatrizTPU` con `req/res`
  simulados.
- Subida de cada ítem del `uploadManifest` desde `uploads/tmp` por la misma función que usa
  `upload-stream` (Drive, thumbnail, ICC, preflight, activación `Cargando… → Pendiente`).
  Como el archivo ya está en disco, la ventana de 30 min del job de zombies sobra.
- Cotización: tras activar, ejecutar `syncFinalOrderIntegration` **esperando** el resultado y
  guardarlo en la solicitud (`cotizacion.estado = OK | FALLO`). Hoy falla en silencio; acá el
  externo se entera.
- Limpieza de `uploads/tmp` al terminar (ok o error).

### F6 — Prueba integral en LOCAL

Por cada modo: crear por la página y por la API el "mismo" pedido y comparar con un script
solo-lectura (vía `backend/config/db.js`) las filas de `Ordenes`, `ServiciosExtraOrden`,
`ArchivosOrden`, `ArchivosReferencia`, `OrdenTerminaciones`, `OrdenTalles`, `PedidosCobranza(+Detalle)`,
`MovimientosInsumos` — ignorando IDs, fechas y correlativo. Más los casos de borde:

- reintento con mismo `idExterno` (no duplica, no quema correlativo);
- URL caída / archivo sin DPI / ancho excedido / PDF multipágina → `RECHAZADO`, **sin** correlativo gastado;
- cliente BLOQUEADO; bobina sin metros; variante WMS sin stock; combo sin `wmsVarianteId`;
- caída del proceso entre paso 9 y 10 → al reiniciar retoma la subida, no recrea.

### F7 — Documentación y deploy

- `backend/docs/API_EXTERNAL_PEDIDOS_PRENDA.md` con el formato de `API_EXTERNAL_ORDENES.md`:
  auth, contrato, un ejemplo cURL por modo, tabla de códigos de error, flujo de estados.
- Checklist de deploy: `add_integracion_pedidos.sql` en prod → variables `.env`
  (`PEDIDOS_EXTERNOS_API_KEY`, `PEDIDOS_EXTERNOS_USUARIO_ID`) → deploy backend → smoke test con
  un cliente de prueba → piloto con el integrador real sobre 4.1 + 4.2 (personalizado por área) antes de abrir el resto.

### F8 — Opcional, después del piloto

- Extraer el cuerpo de `createWebOrder` a un servicio (`{user, body} → {status, json}`) y sacar
  el `req/res` simulado.
- Que `upload-stream` re-mida con `medicionArchivo.js` y **alerte** si lo que declaró el
  navegador no coincide (cierra el agujero de facturación también para la página).
- Persistir el usuario interno que carga el pedido desde la página (hoy se pierde).

---

## 4. Riesgos

| Riesgo | Mitigación |
|---|---|
| **Deriva:** cambia el formulario y el traductor queda viejo → la API crea pedidos distintos a los de la página. | Fixtures dorados (F4): al cambiar el form se regenera el fixture y el test del traductor falla hasta ajustarlo. Validaciones con referencia de línea al original. A futuro (F8+), un único armador compartido. |
| Medición distinta navegador vs servidor → factura distinta. | Port literal + prueba de paridad sobre archivos reales (F3). |
| Pedido creado pero archivos sin subir (caída a mitad). | Estado por pasos en `IntegracionPedidos`; retoma desde el paso 10; archivos ya en disco local. |
| Correlativo `ULTIMOPEDIDOWEB` quemado por rechazos. | Todas las validaciones y descargas ocurren **antes** de invocar `createWebOrder`. |
| SSRF por URLs de archivos. | Solo https, bloqueo de rangos privados, tope de tamaño y timeout. |
| Sesiones paralelas editando `prendasOrdersController`/`PrendaOrderForm`. | Plan 100% aditivo: archivos nuevos + 1 línea de montaje en `server.js`. Releer antes de editar. |

---

## 5. Decisiones (resueltas el 21/09/2026)

| # | Decisión | Resuelto |
|---|---|---|
| D1 | API key por env vs tabla de integradores | **Por `.env`** (`PEDIDOS_EXTERNOS_API_KEY`, sin default, falla cerrado). |
| D2 | Archivos por URL vs multipart | **Solo URL.** |
| D3 | ¿Cómo se entera el externo de que el pedido terminó de procesarse? | **El externo pregunta** (`GET /:solicitudId`). Sin aviso automático por ahora — ver nota. |
| D4 | Modos | **Fabricar a la medida completo** (terminado + personalizado) primero; **Comprar prendas** después. Combos y Prenda del cliente, fuera. |
| D5 | ¿El externo puede fijar Precio establecido? | **Sí, las dos opciones** (por área y establecido), sin permiso aparte. |

**Nota D3, en criollo.** El pedido no se crea en el instante del POST: hay que bajar los archivos,
medirlos, crear, subir a Drive y cotizar; eso puede llevar minutos. El POST contesta enseguida
"recibido, tu número de solicitud es 501". Para saber cómo terminó hay dos formas:
1. **El externo pregunta** cada tanto: `GET /api/external/pedidos-prenda/501` → "procesando…" y
   después "creado, órdenes SB-10994 y PRO-10994, total $15.400" o "rechazado: el archivo X mide
   1,85 m y el material admite 1,80 m". **Es lo que se construye.**
2. **Nuestro servidor le avisa al externo** llamando a una dirección que él nos dé, apenas termina
   (eso es un "webhook"). Más cómodo para el externo, pero le exige tener una dirección pública
   escuchando, y a nosotros reintentos y firma. Se agrega después solo si hace falta.

## 5 bis. Relación con Spec 41 (Solicitudes de vendedores)

La conversión Solicitud → Pedido (F3 de `docs/solicitudes-vendedor-plan.md`) es el **primer
consumidor** de este adaptador y coincide en alcance: solo "Fabricar prendas a la medida", archivos
por enlace, precio pactado. No pasa por HTTP ni por la API key: llama al mismo
`procesador`/`traductor` en proceso, con `Origen='SOLICITUD_VENDEDOR'` e `IdExterno` = id de la
Solicitud + producto (la idempotencia evita convertir dos veces). Pendientes de esa spec que este
contrato obliga a cerrar: quién elige el **material de cada archivo** de sublimación y la
**configuración de impresión / copias** (acá son campos obligatorios de `impresion.items[]`), y P-14
(precio único por Solicitud vs un pedido por producto).

---

## 6. Archivos que toca el plan

Nuevos:
`backend/routes/externalPedidosRoutes.js` · `backend/controllers/externalPedidosController.js` ·
`backend/services/pedidosExternos/{procesador,traductor,validaciones,medicionArchivo,descarga,catalogos,invocar}.js` ·
`backend/scripts/add_integracion_pedidos.sql` · `backend/tests/fixtures/pedidosExternos/*` ·
`backend/docs/API_EXTERNAL_PEDIDOS_PRENDA.md`

Modificados: `backend/server.js` (1 línea de montaje + arranque del procesador). F0 aparte:
`server.js:217`, `routes/webOrdersRoutes.js:171`, `middleware/totemAuth.js`, `webOrdersController.uploadOrderFile`.

No se toca: `PrendaOrderForm.jsx`, `usePrendaOrderForm.js`, `fileService.js`,
`prendasOrdersController.createWebOrder`, `wmsController.createOrder`, `webOrdersController.createWebOrder`.
