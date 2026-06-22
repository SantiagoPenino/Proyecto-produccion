# Plan de migración — centralizar `Estado` / `EstadoenArea` en `stateManagerService`

**Objetivo:** que TODO cambio de `Estado` (general) y `EstadoenArea` de la tabla `dbo.Ordenes` pase
por `services/stateManagerService.changeOrderState()`, eliminando los `UPDATE` crudos dispersos.

**Estado al momento de escribir este plan:** migración **a medias**. El servicio existe y 8 archivos lo
importan, pero 6 de ellos todavía conservan `UPDATE` crudos. Hay que terminar y limpiar.

---

## 0. Cómo funciona hoy `changeOrderState` (leer antes de migrar)

Firma:
```js
await changeOrderState(transaction, {
  target   : { type: 'ORDER', id: <OrdenID> } | { type: 'ROLL', id: <RolloID> },
  estado   : 'En Maquina',     // <-- nombre del EstadoenArea
  userObj  : req.user,
  detalle  : 'Asignado a {maquina}',  // {rollo} y {maquina} se resuelven solos
  rolloId  : 120,              // opcional, para token {rollo}
  maquinaId: 7,                // opcional, para token {maquina}
  io       : req.app.get('io') // opcional, emite server:order_updated
});
```

**Comportamiento clave (y sus implicancias para migrar):**

1. **Solo se pasa el `EstadoenArea`.** El `Estado` general (padre) lo **deriva solo** desde
   `dbo.ConfigEstados` (busca el `EstadoPadreID` del estado de área). → Los `UPDATE` que hoy
   setean el par a mano (`Estado='Produccion', EstadoenArea='Control y Calidad'`) deben pasar a
   pasar **solo** `estado:'Control y Calidad'` **y confiar en que ConfigEstados tenga el padre correcto**.
   ⚠️ **Riesgo #1:** si en ConfigEstados el padre de ese estado de área no coincide con el `Estado`
   general hardcodeado actual, el comportamiento cambia. **Validar cada par contra ConfigEstados antes de migrar.**
2. **Inserta `HistorialOrdenes` automáticamente.** → En los call sites que ya insertan historial a mano
   hay que **borrar ese INSERT manual** o se duplica el log. ⚠️ **Riesgo #2.**
3. **Solo toca `Estado` y `EstadoenArea`.** No toca `MaquinaID`, `RolloID`, `Secuencia`,
   `UbicacionActual`, `EstadoLogistica`, `Observaciones`. → Esos seteos deben quedar en su propio
   `UPDATE` dentro de la misma transacción. ⚠️ **Riesgo #3.**
4. **Requiere una transacción activa.** → Los call sites que hoy usan `pool.request()` directo hay
   que envolverlos en `new sql.Transaction(...)`. ⚠️ **Riesgo #4.**
5. **Solo soporta target por `OrdenID` (ORDER) o `RolloID` (ROLL).** Hay updates que filtran por
   `CodigoOrden` → no encajan sin extender el servicio. ⚠️ **Riesgo #5.**
6. **Es EstadoenArea-céntrico.** Updates que setean SOLO el `Estado` general (`Cancelado`,
   `Finalizado`) sin estado de área no tienen un camino limpio hoy → requiere extensión. ⚠️ **Riesgo #6.**

---

## 1. Mapa de migración (17 `UPDATE` crudos pendientes)

### Grupo A — Ya importan el servicio pero quedaron `UPDATE` crudos (terminar)

| Archivo:línea | Campos | Target | Dificultad | Notas |
|---|---|---|---|---|
| ordersController.js:893 | EstadoenArea | OrdenID | 🟢 Fácil | Calza directo en el servicio. |
| ordersController.js:821 | Estado (gral) | OrdenID | 🔴 Difícil | Estado general directo, sin área → ver Fase 2 (extensión). |
| ordersController.js:2367 | Estado+Área | OrdenID | 🟡 Media | Par `Pendiente/Pendiente`. Verificar ConfigEstados. |
| productionController.js:337 | Estado+Área | ROLL | 🟠 Media-alta | Lleva además `MaquinaID` (Riesgo #3). |
| productionController.js:401 | Estado+Área | ROLL | 🟠 Media-alta | Lleva `MaquinaID=NULL`. |
| productionFileController.js:642 | Estado+Área | OrdenID | 🟡 Media | `Produccion/Control y Calidad`. |
| productionFileController.js:803 | Estado+Área | **CodigoOrden** | 🔴 Difícil | WHERE por CodigoOrden + EstadoLogistica (Riesgos #3 y #5). |
| logisticsController.js:189 | Estado (gral) | **CodigoOrden** | 🔴 Difícil | + UbicacionActual (Riesgos #3, #5, #6). |
| logisticsController.js:2529 | Estado (gral) | OrdenID | 🔴 Difícil | `Finalizado` + EstadoLogistica + UbicacionActual. |

### Grupo B — No importan el servicio (migrar de cero)

| Archivo:línea | Campos | Target | Dificultad | Notas |
|---|---|---|---|---|
| ecoUvFinishingController.js:128 | EstadoenArea | OrdenID | 🟢 Fácil | Verificar que corra en transacción (Riesgo #4). |
| rollsController.js:333 | Estado+Área | OrdenID | 🟠 Media-alta | CASE complejo + RolloID/Secuencia/MaquinaID. |
| rollsController.js:764 | Estado+Área | OrdenID | 🟡 Media | `Pendiente/Pendiente`. |
| rollsController.js:870 | Estado+Área | OrdenID | 🟠 Media-alta | `Pendiente/En Lote` + RolloID. |
| rollsController.js:888 | Estado (gral) | RolloID | 🔴 Difícil | `Finalizado` general por rollo (Riesgo #6). |
| webOrdersController.js:1113 | Estado+Área | OrdenID | 🟡 Media | `Pendiente/Pendiente`, guard `WHERE Estado='Cargando...'`. |
| webOrdersController.js:1228 | Estado+Área | OrdenID | 🟡 Media | **Duplicado exacto del 1113** → unificar. |
| webOrdersController.js:1436 | Estado (gral) | OrdenID | 🔴 Difícil | `Cancelado` general (Riesgo #6). |

---

## 2. Extensiones necesarias al servicio (hacer ANTES de migrar los 🔴)

Para que los casos difíciles encajen sin perder funcionalidad, extender `changeOrderState`:

1. **Target por código:** agregar `target.type === 'CODE'` (filtra por `CodigoOrden`), resolviendo
   primero `CodigoOrden → OrdenID` para historial. Cubre logistics:189 y productionFile:803.
2. **Estado general explícito sin área:** soportar `opts.estadoGeneral` (o un modo `{ general: true }`)
   para `Cancelado`/`Finalizado` que no derivan de un estado de área. Cubre ordersController:821,
   logistics:2529, rolls:888, webOrders:1436.
3. **Columnas extra opcionales:** aceptar `opts.extraColumns` (ej. `{ UbicacionActual, EstadoLogistica }`)
   que se agreguen al mismo `UPDATE`, o documentar el patrón de hacerlas en un `UPDATE` aparte dentro
   de la misma transacción. Cubre los Riesgos #3.

> Mantener retrocompatible: las firmas actuales (`ORDER`/`ROLL`, solo `estado`) deben seguir funcionando.

---

## 3. Orden de ejecución recomendado

**Fase 0 — Auditar lo que ya se migró (PRIMERO).**
- Revisar los 8 archivos que ya importan el servicio y confirmar, en cada llamada existente a
  `changeOrderState`, que: (a) no quedó un INSERT manual a `HistorialOrdenes` al lado (Riesgo #2);
  (b) corre dentro de una transacción; (c) el `estado` que se pasa existe en `ConfigEstados`.
- Listar las llamadas ya hechas: ordenes(853,1276), ordersController, productionController,
  productionKanban(usa extractUser), productionFile(477), logistics(4), auditDeposito(177), retiroService(364).
- **Entregable:** confirmar que el código actual compila y las rutas afectadas no están rotas
  (los archivos están modificados sin commitear; correr la app y probar un cambio de estado simple).

**Fase 1 — Migrar los 🟢 Fáciles (2).** ordersController:893, ecoUv:128. Bajo riesgo, sirven de plantilla.

**Fase 2 — Extender el servicio** (sección 2). Sin tocar call sites todavía.

**Fase 3 — Migrar los 🟡 Medios (5).** Pares hardcodeados simples. Verificar ConfigEstados de cada par.
Unificar el duplicado webOrders:1113/1228.

**Fase 4 — Migrar los 🟠 Media-alta (4).** Mantener los seteos de MaquinaID/RolloID/Secuencia como
`UPDATE` separado en la misma transacción.

**Fase 5 — Migrar los 🔴 Difíciles (6).** Usando las extensiones de la Fase 2.

**Fase 6 — Verificación final.**
- `grep` de control: no debe quedar ningún `UPDATE ... Ordenes ... (Estado|EstadoenArea) =` fuera de
  `stateManagerService.js`.
- Probar cada flujo: asignar a máquina, mover de lote, cancelar, finalizar, reposición, retiro.
- Confirmar que `HistorialOrdenes` registra **una sola** fila por cambio (no duplicados).

---

## 4. Patrón de migración (antes / después)

**Antes** (productionFile:642, ejemplo del par hardcodeado):
```js
await pool.request()
  .input('OID', sql.Int, ordenId)
  .query("UPDATE Ordenes SET Estado='Produccion', EstadoenArea='Control y Calidad' WHERE OrdenID = @OID");
```

**Después** (dentro de transacción; la general la deriva ConfigEstados):
```js
await changeOrderState(transaction, {
  target : { type: 'ORDER', id: ordenId },
  estado : 'Control y Calidad',
  userObj: req.user,
  detalle: 'Pasa a Control y Calidad',
  io     : req.app.get('io'),
});
// ⚠️ Si había un INSERT manual a HistorialOrdenes acá al lado → borrarlo.
// ⚠️ Verificar en ConfigEstados que el padre de 'Control y Calidad' sea 'Produccion'.
```

---

## 4-bis. RESULTADOS DE AUDITORÍA (verificado contra la BD — 2026-06-18)

### Mapa real `ConfigEstados` (EstadoenArea → Estado general padre)
```
Cancelado          -> Cancelado      Control y Calidad  -> Produccion
Avisado            -> Finalizado     En Lote            -> Produccion
Entregado          -> Finalizado     En Maquina         -> Produccion
Finalizado         -> Finalizado     En transito        -> Produccion
Pendiente          -> Pendiente      Pronto             -> Produccion
                                      Con Falla          -> Produccion
```
**Confirmado:** existen `EstadoenArea` llamados `Cancelado` y `Finalizado` con padre `Cancelado`/`Finalizado`.
→ Los UPDATE de estado-general-puro `Cancelado`/`Finalizado` SÍ se pueden migrar pasando
`estado:'Cancelado'` / `estado:'Finalizado'`. Aplica a: **logistics:2529, rolls:888, webOrders:1436**.

### Validación de pares hardcodeados (¿el general coincide con el padre de ConfigEstados?)
| Call site | Estado (hardcoded) | EstadoenArea | Padre real | Veredicto |
|---|---|---|---|---|
| productionFile:642 | Produccion | Control y Calidad | Produccion | ✓ migra sin cambio |
| productionController:401 | Produccion | En Lote | Produccion | ✓ migra sin cambio |
| productionController:337 | Produccion | @StatusArea | Produccion* | ✓ (verificar StatusArea) |
| ordersController:2367 | Pendiente | Pendiente | Pendiente | ✓ migra sin cambio |
| webOrders:1113 / 1228 | Pendiente | Pendiente | Pendiente | ✓ migra sin cambio |
| rolls:764 | Pendiente | Pendiente | Pendiente | ✓ migra sin cambio |
| **productionFile:803** | **Pronto** | Pronto | **Produccion** | ⚠️ MISMATCH (cambia general) |
| **rolls:870** | **Pendiente** | En Lote | **Produccion** | ⚠️ MISMATCH |
| **ecoUv:128** | **Pronto** | Pronto | **Produccion** | ⚠️ MISMATCH (decisión de negocio: comentario dice "Pronto para que Logística lo vea") |
| rolls:333 | CASE(Pendiente/**Imprimiendo**/En Lote) | CASE(Pendiente/En Lote) | varios; 'Imprimiendo' NO existe como general | ⚠️ complejo |

### Lo que dejó la migración previa (a corregir)
- **3 doble-escrituras (código muerto):** `ordersController.updateStatus:821`, `updateAreaStatus:893`,
  `reactivateOrder:2367` — tienen el `UPDATE` crudo **Y** una llamada a `changeOrderState` en la misma
  función. El crudo sobra → **borrar el UPDATE crudo** (no migrar). Bonus: `io: req.app.get('socketio')`
  está **duplicado** en 831/837 y 904/905.
- **2 sin transacción:** `ecoUv:128` y `webOrders.finalizeUpload:1228` usan `pool.request()` directo →
  envolver en transacción antes de migrar.

### Historial — ¿hay duplicados?
- Los 6 INSERT manuales a `HistorialOrdenes` en `ordersController` (682, 752, 1627, 1800, 1960, 2198)
  son **TODOS snapshots** (`SNAPSHOT_PRE_CANCEL` o registro descriptivo `ISNULL(EstadoenArea,...)`) →
  **NO son duplicados** del historial que escribe el `stateManager`. **No tocar.**
- ⚠️ **Riesgo abierto:** `services/trackingService.js:77` también inserta en `HistorialOrdenes` y se usa
  en 5 controllers (productionController, productionKanbanController, clientOrdersController,
  ordenesRetiroController, measurementController). 2 de ellos también usan el `stateManager`.
  **Verificar función por función** que no se llame a `trackingService` y a `changeOrderState` para el
  mismo cambio (eso sí duplicaría el historial).

---

## 4-ter. PROGRESO Y HALLAZGOS DE EJECUCIÓN

### Aplicado
- ✅ `ordersController.updateAreaStatus`: eliminado el `UPDATE` crudo muerto de `EstadoenArea`.
- ✅ Quitados los `io:` duplicados en `ordersController` (3) y `productionFileController`.
- ✅ **`productionController.unassignRoll` MIGRADO** a `changeOrderState` (`estado:'En Lote'`).
  `MaquinaID = NULL` quedó en UPDATE separado. Sintaxis verificada.

- ✅ **`productionFileController` rama B (ex-660) MIGRADA** (`estado:'Control y Calidad'`, value-preserving).
- ✅ **`ordersController` reactivate (ex-2367):** quitadas las 2 líneas redundantes de `Estado`/`EstadoenArea`
  (ya las setea `changeOrderState` debajo); se conservan `Nota`/`Observaciones`/`Motivo`/`Detalles`.
- ✅ **`webOrders` createWebOrder (ex-1113) MIGRADA** con pre-check que preserva la guarda `Estado='Cargando...'`.

### ⚠️ Nuevo gap del servicio: GUARDAS de estado
Varios `UPDATE` traen condición en el WHERE que `changeOrderState` NO replica (actualiza incondicional):
- `webOrders:1113/1228` → `AND Estado = 'Cargando...'`  (1113 resuelto con pre-check SELECT)
- `rolls:764` → `AND Estado != 'Finalizado'` (multi-orden por rollo)
**Diferidos por esto:** `webOrders:1228` (además sin transacción) y `rolls:764` (necesita manejo por-orden
o que el servicio acepte un filtro/exclusión). No migrar a ciegas: se perdería la guarda.

### ESTRATEGIA (revisada): clasificar por impacto en el VALOR del `Estado` general
**Hallazgo de fondo:** el `Estado` general es un enum acoplado en backend (queries) **y en el frontend**
(badges/filtros en CanastosView, LabelGenerationPage, Dashboard, etc.). → Migrar es seguro SOLO si NO
cambia el valor del `Estado` general.

- 🟢 **Value-preserving (migrar libremente):** el padre derivado == general hardcodeado actual.
  - `productionFile:642` (Control y Calidad→Produccion) ✅, `unassignRoll` ✅
  - `webOrders:1113/1228`, `rolls:764`, `ordersController:2367` (Pendiente→Pendiente)
- 🟡 **Value-changing (requiere actualizar lecturas backend+frontend EN CONJUNTO):**
  - Pronto: `productionFile:803`, `ecoUv:128` → lecturas: backend `:89/:91`, frontend `CanastosView:240`, `LabelGenerationPage:452`
  - `rolls:870`, `rolls:333` (Pendiente→Produccion) → frontend `CanastosView:239`
  - `En falla`→`Con Falla`: escrito en `480`, `647`, `681`; además `En Curso` (644) tampoco está en catálogo

### ✅ Cambio de tabla APLICADO (2026-06-18)
Insertados en `dbo.ConfigEstados` como `ESTADOENAREA` con padre `Produccion` (ID 1):
- **Retenido** (EstadoID 35) — confirmado por el usuario: una orden retenida sigue en Producción.
- **En Cola** (EstadoID 36) — desbloquea `assignRoll`.

El viejo `Retenido` general (ESTADO, ID 6) se deja por ahora; se podrá quitar al terminar de migrar lecturas.
**"Retenido" pasa a tratarse como "Pronto":** detalle de Producción. Misma migración (lecturas→EstadoenArea,
escrituras→servicio). Sitios Retenido: productionFile 89✅, 96✅, 563, 577, 768, 772, 825, 686(w), 1653-1654(w), 1697; pedidosController:48.

### Bloqueante (resuelto en parte): faltan `EstadoenArea` en `ConfigEstados`
El `Estado` general es **load-bearing**: `productionFileController.js:91` filtra por `O.Estado IN ('Pronto')`
y `:96` por `Estado IN ('Retenido')`. Y varios estados de área usados en el código **no existen** en
`ConfigEstados`, por lo que el servicio no puede derivar su padre:

| EstadoenArea usado en código | ¿Existe en ConfigEstados? | Acción |
|---|---|---|
| `En Cola` (assignRoll:340) | ❌ NO | **Agregar con padre `Produccion`** (como Retenido) → desbloquea assignRoll |
| `En falla` (reportFailure:478, YA migrado) | ❌ NO (existe `Con Falla`) | Revisar: ¿typo? unificar a `Con Falla` o agregar `En falla` |
| `Imprimiendo` (rolls:333 CASE, como general) | ❌ NO | Definir: ¿estado general nuevo o usar `Produccion`? |
| `Pronto` | ✅ sí (padre Produccion) | Pero se filtra como general → decidir si el padre debe ser `Pronto` |
| `En Lote`, `Pendiente`, `Control y Calidad`, `Cancelado`, `Finalizado` | ✅ sí | OK migrar |

**Recomendación:** antes de seguir migrando, reconciliar el set de literales de estado del código
contra `ConfigEstados` y agregar los faltantes con su padre correcto (INSERT a `ConfigEstados`,
patrón de `areasController.crearEstado`). Es un cambio en la BD de producción → confirmar antes de aplicar.

---

## 4-quater. MIGRACIÓN "PRONTO" (camino B: Pronto = detalle de Producción)

**Regla de negocio (confirmada):** una orden "Pronto" terminó el trabajo de producción pero sigue en la
bolsa **Producción** hasta que llega a Logística (ahí pasa a Finalizada). → `Estado='Produccion'`,
`EstadoenArea='Pronto'`. La tabla `ConfigEstados` ya lo modela así; se corrige el código.

**Orden seguro:** (1) lecturas → `EstadoenArea`, (2) escrituras → vía servicio, (3) opcional limpieza de datos.
**Cuidado clave:** manejar NULL con `ISNULL(...,'')` en los `NOT IN`/`!=` para no ocultar órdenes con área vacía.

### Lecturas backend (Estado='Pronto'/'Retenido' → EstadoenArea) — ✅ COMPLETAS (con ISNULL)
- ✅ `productionFileController`: Pronto 89, 91, 100, 107, 399, 852, 1271 | Retenido 96, 563, 577, 768, 772
- ✅ `ordersController`: 139, 145
- ✅ `productionFileController_extensions`: 20
- ✅ `rollsController`: 99, 952, 1175
- ⏸️ DEJADAS A PROPÓSITO (display de ruta/tracking, resultado ambiguo, requieren EstadoenArea en la query):
  `ordersController:1276`, `pedidosController:46-48/92-95`, `webOrdersController:1325` → pasada dedicada aparte.
- ❌ FUERA DE SCOPE: `etiquetasController:440` (es `srv.Estado` de un Servicio, no de la orden).

### Escrituras backend — ✅ COMPLETAS
- ✅ `productionFileController:1663` (control completo): ya pasaba por el servicio → correcto automáticamente al
  agregar Pronto/Retenido a la tabla (deriva Produccion). Igual branch A (653) y branch C.
- ✅ "En falla" → "Con Falla" (decisión del usuario): `reportFailure:480`, branch A (647), branch C (687).
- ✅ `ecoUvFinishingController`: `Estado='Pronto'`→`'Produccion'` (lecturas ya usan EstadoenArea).
- ✅ `productionFileController` libera-madre (818): `SET Estado='Produccion'` + guard `WHERE ... ISNULL(EstadoenArea,'')='Retenido'`.
- ✅ `productionController.assignRoll` (En Cola): migrado a `changeOrderState(estado: machineStatus)` ('En Cola'→Produccion).
- Nota: `ecoUv` y libera-madre quedaron con valor correcto pero UPDATE crudo (sin historial vía servicio);
  enrutarlos por el servicio es una mejora opcional posterior.

### Frontend — ✅ regresiones cerradas
- ✅ `CanastosView:240`, `LabelGenerationPage:452`, `FilePrintControl` (266,267,898): patrón defensivo
  `(Estado==='Pronto' || EstadoenArea/areaStatus==='Pronto')` → nunca rompe, funciona con dato viejo y nuevo.
- ✅ COHERENTES sin tocar (no son regresión): `OrderRouteTracker:59` + `FilePrintControl:905` (display de ruta;
  el backend de ruta también lee Estado → consistente), `labelPrinter:60` (estado de Servicio),
  `AreaView:356`/`PlaneacionTrabajo:390` (solo orden de listado).
- ⚠️ Cosmético opcional: en `CanastosView` el TEXTO del badge muestra `{o.Estado}` → orden nueva dirá
  "Produccion"; si se quiere "Pronto", mostrar `o.EstadoenArea` cuando sea detalle. (No es regresión funcional.)
- ⏸️ Display de ruta (ordersController:1276, pedidos, webOrders:1325): pasada dedicada (ambiguo).
- ⬜ **Opcional:** limpieza de datos `Estado IN ('Pronto','Retenido') → 'Produccion'`.

### ESTADO FINAL (resumen)
- **Tabla ConfigEstados:** ✅ Pronto/Retenido/En Cola = detalles de Produccion.
- **Backend lecturas:** ✅ completas (Pronto+Retenido → EstadoenArea, con ISNULL).
- **Backend escrituras:** ✅ completas (servicio + En falla→Con Falla + valores consistentes).
- **Frontend:** 🟡 2 badges hechos; faltan ~4 (mismo patrón defensivo) + display de ruta.
- **Pendiente original de la migración stateManager:** webOrders:1228 (sin tx), rolls:764 (guarda multi-orden),
  logistics/productionFile:803 (target CODE) — requieren extender el servicio o manejo por-orden.

### Lecturas frontend (order.Estado === 'Pronto' → EstadoenArea / areaStatus)
- ⬜ `CanastosView:240`, `LabelGenerationPage:452`, `AreaView` (356 + feature "ver órdenes prontas"),
  `PlaneacionTrabajo:390`, `FilePrintControl` (266,267,898,905), `OrderRouteTracker:59`, `labelPrinter:60`
- ⚠️ Verificar que la API entregue `EstadoenArea`/`areaStatus` a esos componentes.

### NO tocar (otros "Pronto" ajenos al de producción)
- "Pronto para entregar" / `OrdEstadoActual=7` (depósito), "Pronto Sector", textos/emails.

---

## 5. Checklist por cada call site migrado

- [ ] Corre dentro de una transacción activa.
- [ ] Se pasa el `EstadoenArea` correcto (no el general) salvo casos de Estado-general explícito.
- [ ] El padre en `ConfigEstados` coincide con el `Estado` general que se seteaba antes.
- [ ] Se eliminó cualquier `INSERT HistorialOrdenes` manual adyacente.
- [ ] Las columnas extra (MaquinaID, RolloID, EstadoLogistica, UbicacionActual…) se preservan.
- [ ] Se pasó `io` si el flujo necesita refresco en tiempo real.
- [ ] Probado el endpoint end-to-end.
