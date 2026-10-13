# Doble cobro a clientes "Rollo por adelantado": metros descontados del plan y cobro en caja al retirar

Fecha: 2026-09-03. Caso detectado: DTF-19364 (Panda Soluciones Empresariales). Verificado en código y con datos de producción.

## 1. Resumen

Desde el 23/07 toda orden de un cliente **tipo 3 "Rollo por adelantado"** que fue cubierta por un plan de metros se cobra **igual** en el retiro: los metros se descuentan de la cuenta de recursos al ingresar y, dos días después, caja cobra el precio completo de la misma orden.

Barrido en producción (01/08 al 03/09): **8 órdenes, 5 clientes, US$ 892,99 cobrados de más**. Ninguno de esos pagos fue anulado ni devuelto.

## 2. Cómo se produce

Son dos decisiones independientes que no se miran entre sí.

**a) Ingreso a depósito por QR** — `backend/controllers/ordenesController.js` (~632-692)

1. Se inserta la fila en `OrdenesDeposito` con `OrdCostoFinal` = precio del pedido (`costoParaDeposito`). El costo se guarda **siempre**, haya plan o no.
2. Si el cliente tiene plan activo para el artículo (`PlanesMetros` + `PlanesMetrosArticulosPermitidos`), se dispara `procesarEventoContable('ENTREGA', …)` → `hookEntregaMetros` descuenta los metros de la cuenta MTS (movimiento `ENTREGA`, obs `Plan #N`) y **no** genera deuda en dinero. Correcto.
3. **Ningún camino del backend pone `OrdCostoFinal = 0` cuando el plan cubre la orden.** Las únicas escrituras de esa columna son: el insert del ingreso, `erpSyncService.js:740`, `quotationController.js:241` (recotización) y `ordenesRetiroController.js:1131` (editar costo a mano en caja).

**b) Creación del retiro** — `backend/services/retiroService.js` (~366-441, `crearRetiro`)

```js
if (esRollo) {
    const costoOrden = parseFloat(orden.OrdCostoFinal) || 0;
    if (costoOrden <= 0) { /* cubierta por rollo → pasa */ continue; }
    /* costo > 0 → "fuera del rollo" → requiere pago o crédito */
    ordenesQueNecesitanCredito.push(orden);
    continue;
}
```

Para el cliente rollo la cobertura se decide **solo por el costo**. El comentario de ese bloque dice que "el motor de check-in deja `OrdCostoFinal = 0` cuando el plan cubrió la orden"; ese comportamiento no existe (ver a.3). Como el costo nunca es 0, la orden cae en `ordenesQueNecesitanCredito`; sin ciclo semanal ni anticipo, el retiro nace en estado 1 (FRENA) y caja cobra `OrdCostoFinal`.

Los clientes que **no** son rollo pasan por `verificarRecursoCliente` (plan activo hoy) y no tienen este problema, salvo que el plan se haya agotado o vencido entre el ingreso y el retiro (el chequeo tampoco mira el movimiento ENTREGA).

**Desde cuándo:** commit `cb2fd37` (2026-07-23) introdujo la regla por costo. Antes, `tienePlanHistorico` dejaba pasar toda orden de un cliente rollo.

## 3. Caso testigo: DTF-19364 (Panda, CliIdCliente 423)

| Hora (01/09 → 03/09) | Evento |
|---|---|
| 01/09 13:12 | Compra de 100 m (VTA_CAJA 1.540 US$). Se crea el plan 153 (artículos 247, 255, 479). |
| 01/09 14:22:13 | Ingresa DTF-19364: 0,10 m, `OrdCostoFinal` 2,20 US$, `ProIdProducto` 255. |
| 01/09 14:22:15 | Movimiento 43828 en cuenta 941 (MTS): ENTREGA −0,10 "Plan #153". Sin ORDEN en dinero. |
| 03/09 14:36 | Retiro 25850: `esRollo` → costo 2,20 > 0 → "fuera del rollo" → caja. |
| 03/09 15:05 | Pago 62687 de 2,20 US$ (ticket ET-0007286). |

Mismo día y mismo cliente: DTF-19329 (33,58 m) entró a las 13:25 con el plan recién comprado, se descontaron 33,58 m y a las 13:47 se cobraron US$ 627,95 a precio de lista.

## 4. Afectados

Query de barrido (órdenes de clientes tipo 3, con consumo de plan, pagadas en caja, costo > 0, desde el 23/07, sin reposiciones):

```sql
SELECT od.OrdCodigoOrden, RTRIM(c.IDCliente) AS Cliente, od.OrdCantidad AS Metros, od.OrdCostoFinal AS Cobrado,
       CASE od.MonIdMoneda WHEN 2 THEN 'USD' ELSE 'UYU' END AS Mon,
       od.OrdFechaIngresoOrden AS Ingreso, od.OReIdOrdenRetiro AS Retiro, od.PagIdPago, p.PagFechaPago,
       ent.Obs AS PlanUsado
FROM dbo.OrdenesDeposito od
JOIN dbo.Clientes c ON c.CliIdCliente = od.CliIdCliente AND c.TClIdTipoCliente = 3
JOIN dbo.Pagos p ON p.PagIdPago = od.PagIdPago
CROSS APPLY (
    SELECT TOP 1 mm.MovObservaciones AS Obs
    FROM dbo.MovimientosCuenta mm
    WHERE mm.MovTipo = 'ENTREGA' AND ISNULL(mm.MovAnulado,0) = 0
      AND (mm.OrdIdOrden = od.OrdIdOrden
           OR mm.OrdIdOrden IN (SELECT o.OrdenID FROM dbo.Ordenes o WHERE o.CodigoOrden = od.OrdCodigoOrden))
) ent
WHERE od.OrdCostoFinal > 0
  AND od.PagIdPago > 0
  AND od.OrdFechaIngresoOrden >= '2026-07-23'
  AND od.OrdCodigoOrden NOT LIKE '%-[RF][0-9]%'
ORDER BY p.PagFechaPago DESC;
```

Resultado (03/09):

| Orden | Cliente (IDCliente) | Metros | Cobrado | Plan | Retiro | Pago | Fecha pago |
|---|---|---|---|---|---|---|---|
| DTF-19364 | Panda Soluciones Empresariales | 0,10 | US$ 2,20 | 153 | 25850 | 62687 | 03/09 |
| DTF-19329 | Panda Soluciones Empresariales | 33,58 | US$ 627,95 | 153 | 25376 | 61943 | 01/09 |
| DTF-19344 | Panda Soluciones Empresariales | 0,15 | US$ 3,30 | 153 | 25376 | 61943 | 01/09 |
| DTF-18472 | Panda Soluciones Empresariales | 1,60 | US$ 8,14 | 26 | 25376 | 61943 | 01/09 |
| DTF-18380 | 218761690013 | 4,65 | US$ 17,38 | 27 | 24802 | 61224 | 28/08 |
| SUB-13620 | 46661751 | 31,68 | US$ 147,63 | 51 | 23376 | 59363 | 18/08 |
| SUB-14319 | Noelia artigas | 16,32 | US$ 67,25 | 47 | 22785 | 58219 | 13/08 |
| DTF-11624 | 95582723 | 2,69 | US$ 19,14 | 30 | 21316 | 56231 | 04/08 |

Totales por cliente:

| Cliente | Órdenes | Metros | A compensar |
|---|---|---|---|
| Panda Soluciones Empresariales | 4 | 35,43 m | US$ 641,59 |
| 46661751 | 1 | 31,68 m | US$ 147,63 |
| Noelia artigas | 1 | 16,32 m | US$ 67,25 |
| 95582723 | 1 | 2,69 m | US$ 19,14 |
| 218761690013 | 1 | 4,65 m | US$ 17,38 |
| **Total** | **8** | **90,77 m** | **US$ 892,99** |

Los seis pagos siguen vivos (`PagTipoMovimiento = 'PAGO'`, sin anulación). El pago 58219 (1.980 US$) es el retiro 22785 completo de Noelia artigas; de ahí solo 67,25 corresponden a SUB-14319.

### Compensación

Dos caminos, excluyentes por orden:

- **Devolver la plata (o nota de crédito)** y dejar el consumo del plan como está. Es la opción correcta: el cliente compró el rollo a precio de plan y en caja pagó precio de lista.
- Devolver los metros al plan (anular el ENTREGA y bajar `PlaCantidadUsada`) y dejar el pago. Deja al cliente pagando más caro de lo que compró.

## 5. Fix propuesto (retiroService.js)

**Regla nueva:** para el cliente rollo, si la orden tiene un movimiento `ENTREGA` no anulado, está cubierta en metros y pasa, con el costo que tenga. Es el mismo criterio que ya usa la billetera con su `CONSUMO_CUENTA` (`verificarCuentaRestringida`). Se mantiene el "costo 0 → pasa" para los ajustes a mano.

Vale también el ENTREGA de "Exceso s/ Plan" (rollo sin plan activo): por diseño esos metros quedan en negativo y se regularizan con el próximo rollo, sin deuda en dinero (`hookOrdenCreada`, ~513-547). Las órdenes de un artículo que no entra en ningún plan no tienen ENTREGA (generan ORDEN en dinero) y siguen cobrándose como hoy.

Reemplazar el bloque `if (esRollo) { … }` (~389-398) por:

```js
if (esRollo) {
    const costoOrden = parseFloat(orden.OrdCostoFinal) || 0;
    if (costoOrden <= 0) {
        logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} cubierta por rollo (costo 0) → pasa.`);
        continue;
    }
    // Metros ya descontados al ingreso (plan o exceso s/ plan): cubierta, aunque
    // OrdCostoFinal conserve el precio del pedido (el check-in NUNCA lo pone en 0).
    const entrega = await transaction.request()
        .input('Ord', sql.Int, orden.OrdIdOrden)
        .input('Cod', sql.VarChar(100), orden.OrdCodigoOrden || '')
        .query(`
            SELECT TOP 1 m.MovIdMovimiento, m.MovObservaciones
            FROM   dbo.MovimientosCuenta m WITH(NOLOCK)
            WHERE  m.MovTipo = 'ENTREGA'
              AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
              AND  (m.OrdIdOrden = @Ord
                    OR m.OrdIdOrden IN (SELECT o.OrdenID FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.CodigoOrden = @Cod))
        `);
    if (entrega.recordset.length) {
        const obs = entrega.recordset[0].MovObservaciones;
        logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} cubierta por metros (${obs}) → pasa.`);
        continue;
    }
    logger.warn(`[RETIRO] Orden ${orden.OrdIdOrden} de rollo con costo ${costoOrden} ` +
                `y sin ENTREGA → requiere pago o crédito.`);
    ordenesQueNecesitanCredito.push(orden);
    continue;
}
```

Notas:

- `ordenesData` hoy NO trae el código: agregar `OrdCodigoOrden` al SELECT de `OrdenesDeposito` que arma ese array (`retiroService.js:330`: `SELECT OrdIdOrden, ProIdProducto, OrdCantidad, PagIdPago, MonIdMoneda, OrdCostoFinal`).
- Corregir el comentario del bloque (~382-388): el check-in no deja el costo en 0.
- Alternativa descartada: poner `OrdCostoFinal = 0` en el ingreso cuando hay plan. Cambia lo que muestran caja, reportes y "editar costo", y al revertir una cobertura (`contabilidadRoutes.js` ~599-617) habría que restaurar también el costo. El fix en el retiro es autocontenido.
- Los clientes no rollo con plan agotado o vencido entre ingreso y retiro tienen la misma falla por otro camino; si se quiere cerrar también, mover el chequeo del ENTREGA **antes** del `if (esRollo)` para que aplique a todos.

**Prueba:** cliente tipo 3 con plan activo, ingresar una orden del artículo del plan (queda el ENTREGA) y crear el retiro. Esperado: `OReEstadoActual = 3` (Abonado) y `PagIdPago = 0` en la orden (centinela "cubierto sin efectivo"), sin pasar por caja. Una orden del mismo cliente con un artículo fuera del plan debe seguir frenando (estado 1).

## 6. Hallazgo relacionado (aparte de este problema)

`CuentasCliente.CueSaldoActual` acumula los movimientos `ORDEN` que nunca se neutralizan al vender contado (bug conocido, comentado en `contabilidadService.js:266-272` y `626-631`; el doc `project_bug_saldoactual_duplica_orden.md` que citan no está en el repo). Panda muestra −451,82 US$ en la cuenta 158 con saldo real 0 y sin deudas vivas. El listado de clientes suma esa columna (`contabilidadController.js:2511`). Recalcular por cuenta:

```sql
UPDATE dbo.CuentasCliente
SET CueSaldoActual = ISNULL((SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
                             WHERE CueIdCuenta = 158 AND ISNULL(MovAnulado,0) = 0
                               AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
WHERE CueIdCuenta = 158;
```
