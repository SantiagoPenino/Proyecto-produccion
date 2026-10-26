# Reversas contables: por qué pasaron los guards y cómo cerrarlas (28/08/2026)

> Investigación multi-agente (5 lectores independientes + verificación adversarial de cada
> afirmación + síntesis). Las citas centrales fueron re-verificadas a mano sobre el código.
> Estado: **solo diagnóstico y diseño — nada aplicado.**

## 1. Veredicto

**RESUELTO POR CÓDIGO. No quedan hipótesis vivas ni es un problema de timing de deploy: los guards del 21/08 nunca cubrieron el camino por el que entra la reversa.** Los movimientos 'SUB-16246-R1' (21/08 18:27) y 'SUB-16419-R1' (26/08 18:54) los escribió `procesarEventoContable`, que asienta el submayor monetario por su cuenta **sin pasar por ningún hook** — y los guards `/-[RF]\d+$/i` viven exclusivamente adentro de los hooks.

Cadena de llamadas, función por función:

1. **`exports.receiveDispatch`** — `backend/controllers/logisticsController.js:936` (ruta: `backend/server.js:102` `app.use('/api/logistics', ...)` + `backend/routes/logisticsRoutes.js:27` `router.post('/receive', logisticsController.receiveDispatch)`). El operario recibe/escanea el bulto de la -R1 en depósito.
2. Bloque "LÓGICA CONTABLE WMS" (`logisticsController.js:1473+`, solo con `areaReceptora === 'DEPOSITO'`): la -R1 entra a `ordenesAContab` **sin ninguna exclusión** y dispara la reversa en :1530-1546:
   ```js
   if (triggerReversal && mContado !== 0 && cliPKReal) {
     ...
     await contabilidadService.procesarEventoContable(revEvento, {
       OrdIdOrden: L_OrdenID, CliIdCliente: cliPKRev,
       Cantidad: -metContado, Importe: -mContado,
       CodigoOrden: oRow.CodigoOrden,
       NombreTrabajo: `[REVERSA AUT.] ${oRow.DescripcionTrabajo}`, ...
   ```
   Es el **único** emisor de `[REVERSA AUT.]` en todo el repo (grep: solo `logisticsController.js:1543`). No pasa `ProIdProducto`.
3. **`procesarEventoContable`** — `backend/services/contabilidadService.js:3892-4130`. **No contiene ningún test sobre `CodigoOrden`** (grep de `-[RF]` en el archivo: solo :434 y :894). No llama jamás a `hookOrdenCreada` (sus únicos call-sites son :985 y :1137, internos a `hookEntregaMetros`). El único hook que puede invocar es `hookEntregaMetros`, gateado en :4067 por `evt.EvtAplicaRecurso && ProIdProducto && Cantidad > 0` — la reversa llega **sin `ProIdProducto`** (default `null` en :3905) y con **`Cantidad = -metContado` ≤ 0** → el guard :894 es inalcanzable. El check `saltarDinero` (:3918) también exige `ProIdProducto` → tampoco corre.
4. **`registrarMovimiento`** — llamado inline en :3955-3963:
   ```js
   resSubmayor = await registrarMovimiento({
     CueIdCuenta: cueId,
     MovTipo: evtCodigo,
     MovConcepto: `${CodigoOrden} ${NombreTrabajo}`.trim() || evtCodigo,
     MovImporte: Math.abs(Importe) * (evt.EvtAfectaSaldo || 1),
   ```
   → ejecuta `dbo.SP_RegistrarMovimiento` (:190). `DocIdDocumento` no se pasa → default `null` (:155).

**Prueba textual de que fue este camino y no otro:** el `MovConcepto` observado (`'SUB-16246-R1 [REVERSA AUT.] Lili remeras'`) es exactamente el template del motor :3958 (código + espacio + nombre, sin prefijo). `hookOrdenCreada` habría escrito `'Orden SUB-16246-R1 — [REVERSA AUT.] ...'` (:588). `DocIdDocumento NULL` cuadra con el default :155. Y el regex del guard SÍ habría matcheado `'SUB-16246-R1'` (verificado ejecutando node) — el valor llegó limpio de `Ordenes.CodigoOrden` (:1484), el guard simplemente no está en ese camino.

**Refuerzo de git:** los guards no existen en NINGÚN commit de ninguna rama (`git log --all -S` vacío; último commit del archivo: 70e46b2, 18/08) — viven solo en el working tree, deployados por copia manual. Y **ni la versión local de HOY bloquearía la reversa**: la región del motor (WT 3868-4131) es byte-idéntica a HEAD, sin guard. La hipótesis "VPS con versión vieja" es innecesaria.

## 2. La cadena completa del bug

1. **La -R1 hereda el `NoDocERP` de la madre.** `createCustomerReplacementOrder` (`backend/controllers/productionFileController.js:1928`) clona la orden: `INSERT INTO dbo.Ordenes(... Nota, NoDocERP, ...) SELECT ... @NotaOrd, NoDocERP, ... FROM dbo.Ordenes WHERE OrdenID = @OldID` (:2026-2045, columna en :2031, valor en :2040). No toca `PedidosCobranza` ni `PedidosCobranzaDetalle` (cero escrituras en el archivo). La -R1 tampoco tiene línea propia en el detalle.
2. **El check-in de la -R1 levanta el pedido de cobranza de la MADRE.** `logisticsController.js:1490-1491`: `SELECT ID, MontoTotal, NoDocERP, MontoContabilizado, MetrosContabilizados, Moneda FROM PedidosCobranza ... WHERE NoDocERP = (SELECT TOP 1 ... NoDocERP FROM Ordenes WHERE OrdenID = @OID)` — misma fila que la madre, con `MontoContabilizado ≠ 0` (estampado cuando ingresó la madre, :1784-1788).
3. **`triggerReversal` se enciende por drift.** :1507-1514: con `mContado ≠ 0`, dispara si `mContado !== currentMonto || metContado !== totalMetros` (comparación **estricta** de floats). Tres escritores inconsistentes de la marca/base de comparación garantizan drift eventual: (i) el re-sync ERP `updatePedidosCobranza` (`erpSyncService.js:910`, :933-939) actualiza `MontoTotal` y borra+reinserta el detalle **sin resetear** `MontoContabilizado/MetrosContabilizados`; (ii) el job de reconciliación suma metros excluyendo `EsHermanaConsolidada=1` (`contabilidadReconciliacionJob.js:69`, stamp :168) mientras receiveDispatch suma TODO el detalle (:1500-1501); (iii) el editor de cotizaciones actualiza `MontoContabilizado` pero **nunca** `MetrosContabilizados` y re-inserta el detalle (`quotationController.js:447,490,584-590`). Cualquier divergencia explota en el siguiente check-in del pedido — que fue el escaneo de la -R1.
4. **La reversa se emite a nombre de la -R1 sin guard** (:1530-1546, ver Veredicto). `revEvento` = `'ENTREGA'` si el cliente tiene **cualquier** fila en `PlanesMetros` (:1533-1535, sin filtro `PlaActivo`), si no `'ORDEN'`.
5. **El motor asienta sin cortar y con el signo dado vuelta.** `contabilidadService.js:3959`: `MovImporte: Math.abs(Importe) * (evt.EvtAfectaSaldo || 1)`. El `Math.abs` **destruye el signo negativo** del `Importe = -mContado`; el signo final lo pone solo `EvtAfectaSaldo` (config en `dbo.Cont_EventosContables`, leída en :3895 vía `motorContable.js:31-33`). Con `EvtAfectaSaldo = -1`: `|−125.40| × (−1) = −125.40` → la reversa, que debía asentar un CRÉDITO, queda como **otro DÉBITO**. Agravante condicional: si `evt.EvtGeneraDeuda` y `SaldoResultante < 0` (:3967), el mismo asiento puede además acumular `+Math.abs(Importe)` en el ciclo activo (:4018-4020, `acumularEnCiclo(..., 'ORDEN', Math.abs(Importe))`) o crear `DeudaDocumento` espuria (:4021-4027).
6. **El forward que sigue no compensa y borra el rastro.** `lineasContab` para la -R1 = `[]` (:1664-1668: filtra el detalle por `OrdenID === L_OrdenID`; la -R1 no tiene línea, y como otras líneas sí traen `OrdenID` no aplica el fallback) → `importeTotalOrden = 0` → no entra a :1766. Luego :1784-1788 **re-estampa** `MontoContabilizado = currentMonto` y `MetrosContabilizados = totalMetros`, curando el drift que disparó todo. Neto: débito de la madre + débito-reversa a nombre de la -R1 = **cobro doble exacto**, y el disparador desaparece de la base. Edge confirmado: en un pedido legacy con TODAS las líneas `OrdenID NULL`, `lineasContab` = pedido entero y la -R1 además re-cobraría el pedido completo.

## 3. Diseño del fix (NO aplicar, solo diseño)

**(a) Fix del signo en el motor** — `backend/services/contabilidadService.js`, función `procesarEventoContable`, línea 3959. Cambiar:
```js
MovImporte: Math.abs(Importe) * (evt.EvtAfectaSaldo || 1),
```
por algo que preserve el signo del importe entrante, p.ej.:
```js
MovImporte: (Importe < 0 ? -1 : 1) * Math.abs(Importe) * (evt.EvtAfectaSaldo || 1),
```
(equivalente a `Importe * (evt.EvtAfectaSaldo || 1)` con la misma semántica de `|| 1`). Con `EvtAfectaSaldo=-1`: cargo (`Importe>0`) → débito, igual que hoy; reversa (`Importe<0`) → crédito, que es lo correcto. **NO tocar:** los `PAGO_CRUZADO` de :3994-4011 (`-Math.abs`/`+Math.abs` correctos para su lógica), el `-Math.abs` de `hookOrdenCreada:590` y :557 (otro camino, el mismo vicio pero fuera de este incidente — arreglarlo por separado si se decide), ni el bloque de deuda :3967+ (con reversa positiva `SaldoResultante` mejora y no genera deuda: se corrige solo). **Riesgo:** cualquier caller actual del motor que ya mande `Importe` negativo *esperando* que quede débito cambiaría de comportamiento. Callers conocidos de `procesarEventoContable`: `logisticsController.js:1537/1721/1742/1769`, `ordenesController.js:600-654`, `logisticaWmsController.js:512`, `contabilidadReconciliacionJob.js:130-159` — el único que manda negativo es la reversa (:1537). Riesgo bajo, revisable con ese censo.

**(b) Guard `-[RF]` en el emisor y en el motor.**
- *Emisor* (`logisticsController.js`): dentro del loop `for (const L_OrdenID of ordenesAContab)` (:1480), inmediatamente después de obtener `oRow` (:1484-1486) y **antes** del lookup de PedidosCobranza (:1490), saltear el bloque contable entero si `/-[RF]\d+$/i.test(String(oRow.CodigoOrden || '').trim())` — eso cubre la reversa (:1530) Y los tres forwards (:1721, :1742, :1769) de una vez. Ojo: dejar que el flujo siga hacia OrdenesDeposito (:1560+), que ya tiene su propio tratamiento -R/-F.
- *Motor* (cinturón): el mismo guard al inicio de `procesarEventoContable` (tras el destructure :3904-3905), con `return null` como el `if (!evt)` de :3897-3900. Cierra también el hueco de `ordenesController.js` (ver c).
- **Riesgo:** al saltear, la -R1 tampoco re-estampa la marca (:1784-1788), así que un drift preexistente queda vivo y disparará reversa+forward en el próximo check-in de una orden *normal* del pedido — comportamiento correcto (el episodio pasa por el par reversa/forward completo, no por una reversa huérfana), pero conviene saberlo. El guard en el motor bloquearía cualquier futuro caller que quisiera asentar algo con código -R/-F a propósito (hoy no existe ninguno).

**(c) Otros agujeros confirmados.**
- `ordenesController.js` (ingreso QR / escaneo universal con `skipAccounting=false`): el fix del 21/08 (`esRepoIngreso`, :465-466) solo puso en cero `@CostoFinal` del INSERT; `deudaReal` (:544) y los eventos contables (:596-649, `procesarEventoContable('ORDEN'/'ENTREGA', { Importe: importeTotal, ...})`) siguen sin gate -[RF] → escanear una etiqueta -R en modo universal puede asentar débito. El guard del motor (b) lo cubre; si no, gatear :643-655.
- Comparación estricta :1511 + tres estampadores inconsistentes (§2 paso 3): mientras no se unifique el cálculo de metros (mismo filtro `EsHermanaConsolidada` en las tres rutas, y que `quotationController` estampe también `MetrosContabilizados`), el par reversa/forward va a seguir disparándose espuriamente en órdenes normales — con el fix (a) el neto es 0, pero ensucia el submayor. Riesgo del fix: bajo, es consolidación de una misma fórmula.
- `revEvento` :1533-1535 consulta `PlanesMetros` sin filtro `PlaActivo` — un plan viejo inactivo manda la reversa por 'ENTREGA'. Con (a)+(b) es cosmético; anotarlo.
- Edge legacy :1664-1668 (todas las líneas con `OrdenID NULL` → la -R1 cobraría el pedido entero): el guard (b) lo elimina para -R/-F; para órdenes normales el fallback queda como está.

## 4. Queries de remediación

Las 9 reversas mal asentadas: 4 con `DocIdDocumento` facturado y pagado (Claudia 13,63 / Gonzalo 118,43 / De Zuasnabar 86,48 / Hoki 32,75) y 5 con `DocIdDocumento NULL`. Nota: el camino del motor no pasa `DocIdDocumento` (:155/:3955-3963) — cómo los 4 obtuvieron doc es dato de prod (probablemente asociación posterior por cierre de ciclo/facturación): lo dicen las queries de diagnóstico.

**DIAGNÓSTICO — correr primero, en este orden:**

```sql
-- D1: las 9 reversas, completas
SELECT MovIdMovimiento, CueIdCuenta, CicIdCiclo, MovTipo, MovConcepto, MovImporte,
       MovFecha, MovAnulado, DocIdDocumento, OrdIdOrden, MovObservaciones
FROM dbo.MovimientosCuenta
WHERE MovConcepto LIKE '%[[]REVERSA AUT.]%'
  AND (MovAnulado IS NULL OR MovAnulado = 0)
ORDER BY MovFecha;

-- D2: cuenta y saldo actual de cada una (CueSaldoActual es el saldo materializado
-- que mantiene SP_RegistrarMovimiento y que anularMovimiento revierte — contabilidadService.js:3303-3308)
SELECT m.MovIdMovimiento, m.MovImporte, m.MovFecha,
       c.CueIdCuenta, c.CliIdCliente, c.CueTipo, c.CueSaldoActual
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente c ON c.CueIdCuenta = m.CueIdCuenta
WHERE m.MovConcepto LIKE '%[[]REVERSA AUT.]%' AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

-- D3: los 4 con documento — estado de la deuda asociada
SELECT m.MovIdMovimiento, m.MovImporte, m.DocIdDocumento,
       d.DDeIdDocumento, d.DDeImporteOriginal, d.DDeImportePendiente, d.DDeEstado
FROM dbo.MovimientosCuenta m
LEFT JOIN dbo.DeudaDocumento d ON d.DocIdDocumento = m.DocIdDocumento
WHERE m.MovConcepto LIKE '%[[]REVERSA AUT.]%' AND m.DocIdDocumento IS NOT NULL;

-- D4: ¿la reversa contaminó un ciclo? (acumularEnCiclo :4019 suma +abs(Importe) a CicTotalOrdenes)
SELECT CicIdCiclo, CicTotalOrdenes
FROM dbo.CiclosCredito
WHERE CicIdCiclo IN (SELECT CicIdCiclo FROM dbo.MovimientosCuenta
                     WHERE MovConcepto LIKE '%[[]REVERSA AUT.]%' AND CicIdCiclo IS NOT NULL);
-- (demás columnas de CiclosCredito: A VERIFICAR con sp_help)

-- D5: ¿creó DeudaDocumento espuria por su propia orden? (:4023)
SELECT d.DDeIdDocumento, d.CueIdCuenta, d.OrdIdOrden, d.DocIdDocumento,
       d.DDeImporteOriginal, d.DDeImportePendiente, d.DDeEstado, d.DDeFechaEmision
FROM dbo.DeudaDocumento d
WHERE d.OrdIdOrden IN (SELECT OrdIdOrden FROM dbo.MovimientosCuenta
                       WHERE MovConcepto LIKE '%[[]REVERSA AUT.]%' AND OrdIdOrden IS NOT NULL);
```

**LIMPIEZA — esquema propuesto (replica exactamente lo que hace `anularMovimiento`, contabilidadService.js:3282-3311: marcar `MovAnulado=1` y revertir `CueSaldoActual`). Por cada `MovIdMovimiento` de D1, con los valores de D1/D2 a la vista:**

```sql
BEGIN TRAN;

-- 1. Anular el movimiento (idéntico a :3301)
UPDATE dbo.MovimientosCuenta
SET MovAnulado = 1,
    MovObservaciones = ISNULL(MovObservaciones + ' | ', '')
      + 'Anulado 28/08/2026: reversa asentada como débito por bug de signo/guard (procesarEventoContable)'
WHERE MovIdMovimiento = @MovId AND (MovAnulado IS NULL OR MovAnulado = 0);

-- 2. Revertir el saldo materializado (idéntico a :3308; MovImporte es NEGATIVO,
--    restar un negativo DEVUELVE el importe al saldo del cliente)
UPDATE dbo.CuentasCliente
SET CueSaldoActual = CueSaldoActual - @MovImporte
WHERE CueIdCuenta = @CueId;

COMMIT;
```

Casos con extra según diagnóstico:
- **Los 4 con doc facturado y PAGADO:** anular el movimiento devuelve el saldo, pero si el cliente ya pagó el documento que absorbió el débito espurio, el resultado neto es saldo a favor — verificar en D3 si `DDeImportePendiente`/`DDeEstado` reflejan el importe inflado. Si la deuda sigue viva e inflada: `UPDATE dbo.DeudaDocumento SET DDeImportePendiente = DDeImportePendiente - @X WHERE DDeIdDocumento = @Id` (con `@X` = importe espurio). Si ya está `PAGADO`, no tocar la deuda: el crédito queda en `CueSaldoActual` por el paso 2 y es decisión de negocio (devolver / dejar a favor).
- **Ciclos contaminados (D4):** si el ciclo sigue abierto, `UPDATE dbo.CiclosCredito SET CicTotalOrdenes = CicTotalOrdenes - @X WHERE CicIdCiclo = @Id`. Si ya cerró, el cierre pudo facturar de más — cruzar con D3.
- **DeudaDocumento espuria (D5):** anularla según el mecanismo del sistema (columna de anulación de DeudaDocumento: A VERIFICAR; si no existe, `DDeEstado` es el candidato — verificar valores posibles antes).

Advertencia: el cuerpo de `SP_RegistrarMovimiento` no está versionado en el repo — si además de `CueSaldoActual` mantiene otro agregado, el esquema de arriba no lo revierte (ver §5, punto 6).

## 5. Qué quedó INDETERMINABLE por código

1. **Config real de los eventos** (`EvtAfectaSaldo`/`EvtGeneraDeuda`/`EvtAplicaRecurso` de 'ORDEN' y 'ENTREGA'; el -1 está inferido del signo observado):
   `SELECT EvtCodigo, EvtActivo, EvtAfectaSaldo, EvtGeneraDeuda, EvtAplicaRecurso FROM dbo.Cont_EventosContables WHERE EvtCodigo IN ('ORDEN','ENTREGA');`
2. **Qué evento usó cada caso** (el `MovTipo` grabado = `evtCodigo`, :3957):
   `SELECT MovIdMovimiento, MovTipo, MovImporte, MovFecha FROM dbo.MovimientosCuenta WHERE MovConcepto LIKE 'SUB-16246-R1%' OR MovConcepto LIKE 'SUB-16419-R1%';`
   más la validación de la rama: `SELECT PlaIdPlan, PlaActivo, CliIdCliente FROM dbo.PlanesMetros WHERE CliIdCliente IN (<Palmero>, <De Zuasnabar>);`
3. **Cuál drift disparó cada episodio** (monto vs metros; re-sync ERP vs job vs cotizador vs decimales) — la marca ya fue re-estampada (:1784-1788), pero si el drift es estructural se ve hoy mismo:
   ```sql
   SELECT pc.ID, pc.NoDocERP, pc.MontoTotal, pc.MontoContabilizado, pc.MetrosContabilizados, pc.FechaGeneracion,
     (SELECT SUM(ISNULL(d.Cantidad,0)) FROM PedidosCobranzaDetalle d WHERE d.PedidoCobranzaID = pc.ID) AS SumTodas,
     (SELECT SUM(ISNULL(d.Cantidad,0)) FROM PedidosCobranzaDetalle d WHERE d.PedidoCobranzaID = pc.ID AND ISNULL(d.EsHermanaConsolidada,0)=0) AS SumSinHermanas,
     (SELECT COUNT(*) FROM PedidosCobranzaDetalle d WHERE d.PedidoCobranzaID = pc.ID AND d.OrdenID IS NULL) AS LineasSinOrdenID
   FROM PedidosCobranza pc
   WHERE LTRIM(RTRIM(pc.NoDocERP)) IN (SELECT LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) FROM Ordenes WHERE CodigoOrden IN ('SUB-16246-R1','SUB-16419-R1'));
   ```
   `SumTodas ≠ SumSinHermanas` → ruta job; `FechaGeneracion` posterior a la contabilización de la madre → hubo re-sync ERP; monto igualado con metros distintos → cotizador o decimales. Los valores exactos del momento están en el `console.log` de `logisticsController.js:1517` — buscar `[CONTABILIDAD-WMS]` con `SUB-16246`/`SUB-16419` en `/home/logs`.
4. **Escala real de las columnas decimales** (para la hipótesis Decimal(18,2) vs SUM crudo):
   `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME IN ('PedidosCobranza','PedidosCobranzaDetalle') AND COLUMN_NAME IN ('MontoTotal','MontoContabilizado','MetrosContabilizados','Cantidad');`
5. **Qué bytes corren en el VPS** (los guards no están en ningún commit; el árbol local de hoy es posterior al deploy — el snapshot del 21/08 es irreconstruible). No es SQL, es shell en el VPS:
   `grep -n '\-\[RF\]' /var/www/sistema-produccion/services/contabilidadService.js` + `ls -l --time-style=full-iso` del archivo + `pm2 describe sistema-produccion`. (Aclaración: aun con guards presentes en el VPS, el camino del motor no los pasa — esto solo confirma qué versión corre.)
6. **Cuerpo de `SP_RegistrarMovimiento`** (si mantiene algo más que el INSERT + `CueSaldoActual`):
   `EXEC sp_helptext 'dbo.SP_RegistrarMovimiento';`
7. **Cómo los 4 movimientos con `DocIdDocumento` obtuvieron el doc** (el motor no lo pasa): sale de D1/D3 de §4 cruzado con el documento (tabla/columnas del documento: A VERIFICAR según el resultado).
8. **Si las reversas contaminaron ciclos o crearon deuda espuria** (condicional a `EvtGeneraDeuda` y `SaldoResultante<0`): queries D4/D5 de §4.
