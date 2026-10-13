# WMS propio — plan de réplica interna

**Fecha:** 2026-08-21 · **Estado:** propuesta, sin implementar · **Objetivo:** replicar dentro del sistema el WMS externo ("Johnson" / `stock-amazon` en `administracionuser.uy/stock/`), bien hecho: sin SQL crudo desde el navegador, transaccional, idempotente, con permisos, y sin depender de un EC2/RDS ajeno en AWS.

Referencia de la investigación: el WMS actual es React+Vite sin backend propio — el navegador manda SQL crudo a un proxy HTTP (`3.85.26.173:5005/sql`, sin auth, sin TLS) contra la DB `Ventas_Dev` en un RDS de AWS. Nuestro sistema lo consume en 6 puntos vía `wmsStockService.js` + `Articulos_WMS_Variantes`.

---

## 1. Qué se replica (funcional)

Del WMS actual, ordenado por prioridad de uso real:

| Módulo | Qué hace hoy | Prioridad |
|---|---|---|
| **Stock etiquetado** | `Stock_Etiquetas`: cada bulto físico etiquetado con cantidad, variante, depósito, estado. Stock = suma de etiquetas activas | CORE |
| **Movimientos** | Ledger de ingresos/egresos/bajas con tipo y referencia | CORE |
| **Catálogo** | Productos maestros → variantes (talle/color, sku) → categorías | CORE (ya semi-existe vía mapeo) |
| **Depósitos** | Multi-depósito (el local = id 5) | CORE |
| **Remitos internos** | Traslados entre depósitos con items y recepción | ALTA |
| **Ingresos / Recepción** | Recepción de compras con auditoría, registro de pesos, autorización | ALTA |
| **Inventario operativo** | Escaneo QR/código de barras, conteos, reimpresión de etiquetas | ALTA |
| **Compras + Importaciones** | Órdenes de compra, costos extra, tracking de importaciones, proveedores, pagos | MEDIA (fase posterior) |
| **Inventario gerencial** | Dashboards, capital activo, top movimientos, históricos | MEDIA |
| **Alertas predictivas** | Mínimos por depósito, consumo histórico | BAJA |

## 2. Qué se corrige del diseño actual ("bien hecho")

| Falla actual | Cómo lo hacemos |
|---|---|
| SQL crudo desde el navegador, proxy **sin autenticación ni TLS**, credencial RDS hardcodeada | Endpoints REST en nuestro Express con `verifyToken` + roles; queries parametrizadas; nada de SQL desde el front |
| Venta y descuento de stock en **dos sistemas distintos** (falla a mitad = inconsistencia silenciosa) | El descuento corre **dentro de la misma transacción SQL** que confirma la venta — o entra todo o no entra nada |
| Descuento **no idempotente** (retry del endpoint = doble egreso) | Clave de idempotencia por referencia (`PedidoCobranzaID`/`OrdenID` + tipo) con constraint UNIQUE en el ledger |
| El egreso toma **UNA sola etiqueta** (`TOP 1`) aunque la cantidad se reparta en varias | Consumo FIFO repartido entre etiquetas hasta cubrir la cantidad, con UPDLOCK por variante |
| `cantidad_actual` mantenida por **triggers ocultos** en la DB ajena | Ledger explícito (`Wms_Movimientos`) como fuente de verdad + `CantidadActual` denormalizada mantenida por el servicio en la misma tran (patrón `CueSaldoActual` que ya usamos) |
| Stock parcial no bloquea y descuenta lo que hay (decisión implícita) | Comportamiento **configurable** y explícito (pregunta d) |
| Latencia Brasil↔Virginia en cada carga de tienda/configurador | Todo local en nuestra DB: el stock de la tienda pasa de fetch HTTP a un JOIN |
| Login por `SELECT * FROM usuarios WHERE id='...'` armado en el navegador | Usuarios/roles de nuestro sistema (los que ya existen) |

## 3. Modelo de datos propuesto (nuestra DB)

> Schema completo del WMS actual (31 tablas, reconstruido del código el 26/08): ver `docs/wms-johnson-schema.md` — incluye las 4 queries de confirmación (tipos, volumetría, stock vivo, triggers) a correr antes de congelar el DDL.

Prefijo `Wms_` para no chocar con lo existente:

- **`Wms_Depositos`** — id, nombre, tipo (propio/tercero), activo. Se migran los del WMS actual conservando ids (el 5 = local) para no romper referencias.
- **`Wms_Variantes`** — id, `ProIdProducto` (FK a `Articulos`, nullable para cosas sin artículo ERP), sku, talle, color, unidad, categoría, activo. **Reemplaza a `Articulos_WMS_Variantes`**: deja de ser tabla puente hacia afuera y pasa a ser LA entidad variante. Se migra conservando `wms_variante_id` como id (todo el sistema ya guarda ese id: `PedidosCobranzaDetalle.CodArticulo`, `Ordenes.WmsVarianteId`, `ProductoComboItems.WmsVarianteId`, tienda).
- **`Wms_Etiquetas`** — id, VarianteId, DepositoId, CantidadInicial, CantidadActual, Estado (activo/agotado/anulado), Lote/CompraId (nullable), FechaIngreso, UsuarioIngreso, PesoRegistrado (nullable).
- **`Wms_Movimientos`** — id, EtiquetaId, Tipo (ingreso_compra, egreso_venta_web, baja_consumo, traslado_salida, traslado_entrada, ajuste_conteo, anulacion), Cantidad (signo explícito), DepOrigenId, DepDestinoId, RefTipo + RefId (PedidoCobranza / Orden / Remito / Compra), IdempotencyKey (UNIQUE filtrado), UsuarioId, Fecha. **Índices desde el día uno**: (EtiquetaId, Fecha), (RefTipo, RefId), (Tipo, Fecha).
- **`Wms_RemitosInternos`** + **`Wms_RemitosInternosItems`** — traslados entre depósitos: numeración, origen, destino, estado (BORRADOR/EN_TRANSITO/RECIBIDO/CANCELADO), cantidades enviadas vs recibidas por item.
- Fase posterior: `Wms_Compras` + Detalle + CostosExtra, `Wms_Proveedores`, `Wms_Importaciones`, `Wms_AlertasDeposito`.

Regla de oro: **`CantidadActual` nunca se updatea suelta** — siempre movimiento + update en la misma transacción, vía un único `wmsInternoService`.

## 4. Fases

### F0 — Decisiones (§6) + congelar el modelo
Sin código. Con (a), (b) y (e) respondidas se congela el schema.

### F1 — Núcleo + espejo (sin cutover)
- Crear tablas + `wmsInternoService` (ingreso, egreso FIFO multi-etiqueta, traslado, ajuste; todo transaccional e idempotente).
- **ETL de apertura**: script one-shot que lee del proxy actual (catálogo completo, depósitos, etiquetas activas con sus cantidades) y puebla nuestras tablas. Verificación: conteo por variante×depósito comparado contra el WMS, diferencia = 0.
- **Modo espejo**: `descontarStockWmsExterno` pasa a descontar TAMBIÉN internamente (marcado `espejo=1`). El WMS externo sigue siendo la verdad; corremos días comparando stocks (query de paridad diaria). Detecta todo lo que el ETL o el servicio tengan mal, sin riesgo.

### F2 — Cutover de los 4 consumidores
Feature flag `WMS_INTERNO=true`:
- Tienda ([tiendaController.js:78](../backend/controllers/tiendaController.js)) y configurador: stock por JOIN local en vez de fetch.
- Preparación VEN- ([logisticaWmsController.js:245](../backend/controllers/logisticaWmsController.js)) y prendas ([prendasOrdersController.js:341](../backend/controllers/prendasOrdersController.js)): egreso interno **dentro de la transacción de la venta**. La firma del servicio se mantiene (`{wmsDisponible, wmsErrors}`) para tocar lo mínimo.
- Combos: `explotarCombos` queda igual (ya lee nuestra `ProductoComboItems`).
- Rollback = apagar el flag (el externo sigue vivo y espejado hasta decomisionar).

### F3 — UI operativa (depósito)
Nueva sección en nuestro admin (rol propio, como marketing):
- **Ingresos**: alta de etiquetas (con o sin compra), impresión (reusar `LabelGenerationService` + impresoras existentes), registro de pesos.
- **Inventario operativo**: buscador jerárquico producto→variante→etiquetas, escaneo QR (la infra de escáner ya existe en planta), ajustes por conteo con motivo.
- **Remitos internos**: crear/enviar/recibir con validación por escaneo (misma UX que la recepción de logística nuestra, que ya conocemos — incluida la lección del remito zombi: **el escaneo del último item cierra el remito solo**).
- Modo tablet aplicable (`is-tablet` ya existe).

### F4 — Gerencial y abastecimiento (parte firme del roadmap — decisión b)
Compras + recepción auditada + costos de importación, dashboards (capital activo, consumo), alertas de mínimos. Cada uno con su sub-plan chico al llegar, pero dentro del alcance comprometido.

### F5 — Decomisionar
Congelar el WMS externo (solo lectura) → export final de históricos → apagar EC2/RDS (pregunta f). Borrar `wmsStockService` externo y la carpeta del escritorio.

## 5. Migración y convivencia

- Los **ids de variante se conservan** — es lo que hace que el cutover sea un flag y no una migración de datos de ventas.
- Historial de movimientos del WMS viejo: NO se migra al ledger (arrancamos con apertura); si se quiere consultar, export a tabla `Wms_HistoricoExterno` de solo lectura (pregunta c).
- Durante F1–F2 el WMS externo sigue operable por la gente del depósito; los movimientos que ELLOS hagan allá (ingresos, traslados) hay que re-sincronizarlos al espejo — el ETL de apertura se hace re-ejecutable (upsert por etiqueta) y se corre a demanda hasta el cutover. Después del cutover, la operación de ellos pasa a nuestro sistema (pregunta a).

## 6. Decisiones (F0)

Resueltas el 26/08:

- **(a) Operación: queda en manos propias.** ✅ Sin usuarios externos ni permisos por depósito para terceros; la UI operativa de F3 es para personal propio, con los roles que ya existen.
- **(b) Alcance: TODO.** ✅ Se replica la operación completa del WMS (todos los depósitos, remitos, compras, importaciones, alertas) — el orden de entrega sigue siendo por fases (núcleo primero), pero compras/importaciones dejan de ser opcionales: F4 es parte firme del roadmap.
- **(e) Variantes: se unifican.** ✅ `Wms_Variantes` pasa a ser LA entidad variante del sistema: absorbe `Articulos_WMS_Variantes` (con sus columnas Talle/Color de la sección marketing) y la tienda/configurador referencian esa única tabla. Ojo migración: conservar los ids actuales Y los ejes Talle/Color corregidos a mano.

Pendientes (opciones desarrolladas abajo, elegir una por punto):

- **(c) Historial** — recomendación: apertura limpia + export crudo de consulta (opción 3).
- **(d) Stock parcial/cero** — recomendación: permitir con discrepancia registrada (opción 3).
- **(f) AWS** — decisión en dos tiempos: inventariar primero, apagar después.

### (c) Historial de movimientos — opciones

1. **Apertura limpia, sin histórico**: se migran catálogo + depósitos + etiquetas vivas con sus cantidades (como movimientos de apertura). El ledger nace consistente y la migración se valida con un solo número por variante×depósito. Contra: se pierde la consulta histórica ("cuánto consumimos de X en mayo", trazabilidad de etiquetas viejas) y las alertas predictivas de F4 arrancan ciegas hasta acumular meses de datos propios.
2. **Migrar el histórico AL ledger nuevo**: NO recomendado — obliga a mapear cada tipo de movimiento y cada referencia del sistema viejo (usuarios, compras); cualquier inconsistencia histórica pasa a ser nuestra; no aporta nada operativo.
3. **Apertura limpia + export crudo a `Wms_HistoricoExterno` (recomendado)**: el ledger arranca limpio (opción 1) y ADEMÁS se copia `Stock_Movimientos` + compras del sistema viejo, tal cual, a una tabla de solo consulta con su pestaña "Histórico (sistema anterior)". No se integra al ledger — es un archivo muerto consultable. Beneficios: las estadísticas/alertas pueden leer de ahí durante el primer año, y el AWS se puede apagar sin miedo a perder nada. Costo: solo el ETL de copia.

### (d) Stock parcial o cero al confirmar una venta — opciones

Hoy: si falta stock, descuenta lo que haya, loguea un warning que no lee nadie y la venta sigue; el faltante **desaparece** de la contabilidad de stock. Solo bloquea si el WMS está caído entero.

1. **Permitir con aviso (statu quo)**: la operación nunca se traba, pero se sigue vendiendo lo que no hay y el faltante no deja rastro operativo.
2. **Bloquear**: no se confirma preparación sin stock suficiente. Obliga a resolver antes — pero cuando el error es del SISTEMA (conteo viejo) y el operario tiene la prenda en la mano, se traba la entrega real; necesitaría un "forzar" con permiso.
3. **Permitir con discrepancia registrada (recomendado)**: la confirmación no se traba nunca, pero el faltante deja de ser un warning invisible: se registra como **discrepancia de inventario** (movimiento de ajuste pendiente, visible en una bandeja "Diferencias") que alguien tiene que resolver — contar la variante, ajustar, o detectar el faltante real. La tienda sigue sin gate de stock para comprar (decisión previa del plan e-commerce); esto aplica a la preparación física. Un flag global permite ponerse estrictos (opción 2) más adelante sin tocar código.

### (f) EC2/RDS de AWS — decisión en dos tiempos

Lo que sabemos: la infra son un EC2 (el proxy `:5005`, y presumiblemente el hosting detrás de `administracionuser.uy`) y un RDS SQL Server que además de `Ventas_Dev` tiene al menos otra base (`OESTE_PROD`, de origen desconocido — los scripts de la carpeta se conectan a ella por default). Un RDS de SQL Server en us-east-1 no es barato — el ahorro por apagarlo es real, pero el monto exacto depende de la instancia y quién la paga.

1. **Antes de decidir (tarea de F5): inventariar.** Qué corre en ese EC2 además del proxy, qué DBs tiene el RDS y de quién son, y si `administracionuser.uy` hostea algo más que el `/stock/`. Si `OESTE_PROD` u otra cosa es de terceros, el server no es nuestro para apagar — solo se avisa que dejamos de usarlo.
2. **Al cutover**: el WMS viejo queda en **solo lectura** unas semanas (ventana de seguridad para consultar algo olvidado), con el export de (c) ya hecho.
3. **Cierre**: si el inventario confirma que nada más vive ahí → apagar EC2 + RDS. Si hay terceros → se retira nuestro uso y queda en manos de quien lo pague.

## 7. Riesgos

- **Paridad de stock**: el mayor riesgo es cortar con stocks distintos al real → por eso modo espejo + query de paridad ANTES del flag, y conteo físico de validación en el cutover si hay dudas.
- **Movimientos "de ellos" durante la transición**: si el depósito sigue operando el WMS viejo mientras espejamos, cada re-sync es una ventana de drift — minimizar el período F1→F2.
- **El nombre `Ventas_Dev` engaña**: todo lo que se toque allá durante el ETL es stock físico real — el ETL es SOLO lectura.
- Performance: las tablas nacen con índices y el patrón de locking ya probado (UPDLOCK por variante, lección de los rollos y las lecciones de bloqueos que ya pagamos).
