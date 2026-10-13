# Pedidos divididos «(n/m)»: por qué el cargo no coincide con la suma de las partes

Análisis del 30/09/2026 sobre la copia de producción restaurada ese día.

- El código se arregló el mismo 30/09 y está sin deployar (ver punto 4).
- Los datos que ya quedaron mal siguen pendientes (ver punto 5).

## Qué pasa

- **Desde el 23/07/2026, de cada pedido dividido en partes solo se asienta la primera parte que llega a Depósito.**
  - Las otras partes quedan sin cargo en la cuenta y sin descontar sus metros del plan.
  - **Entre el 01/06 y el 22/07:** 1 de 49 pedidos divididos quedó con cargo incompleto (SUB-7786, sin ningún cargo). Ninguno tuvo «una sola parte asentada».
  - **Desde el 23/07:** 209 de 282. En 200 se asentó una sola parte; los otros 9 quedaron sin ningún cargo.
- **La mayor parte de la plata entró igual.** 129 de esos pedidos se cobraron en caja, y la caja cobra todas las partes.
  - Lo que falta es el asiento de las partes. Eso infla el saldo que usa la billetera (ver 1.2).
- **Plata que nunca se facturó:** 9 pedidos de 4 clientes semanales, US$ 328,42.
- **Hay un segundo problema, más viejo:**
  - Una parte cuya línea vale $0 porque la cubre el plan entra a Depósito con el total del pedido, y la caja la cobra.
  - CAPA pagó así US$ 120,46 de más, en 12 pedidos entre el 23/07 y el 31/08.
- **De paso:** la reversa automática del mismo bloque sigue sumando en vez de restar. Es el bug que quedó pendiente el 21/08, y desde entonces generó 7 débitos más.

## 1. Causa principal: se cobra por orden, pero se marca «contabilizado» por pedido

El ingreso a Depósito, en [logisticsController.js](../backend/controllers/logisticsController.js), sigue estos pasos:

1. **Busca el pedido de cobranza** por el `NoDocERP` de la orden (líneas ~1842-1843). Todas las partes comparten ese pedido.
2. **Decide si asentar mirando `PedidosCobranza.MontoContabilizado`** (líneas ~1859-1867). Si vale 0, asienta. Si es igual al total del pedido, no hace nada.
3. **Asienta solo las líneas de ESA orden** (`lineasOrden`, líneas ~2043-2049).
   - Es así desde el commit 518bb1e del 23/07.
   - Antes asentaba el pedido completo en la primera parte, y por eso no fallaba.
4. **Al terminar, marca el pedido entero como contabilizado** (líneas ~2224-2229): `MontoContabilizado = MontoTotal` del pedido.

**Resultado:**

- La primera parte asienta sus líneas y deja el pedido completo marcado.
- Cuando llegan las hermanas, el pedido ya figura contabilizado y se saltean:
  - no se les hace cargo en plata;
  - no se descuentan sus metros del plan (`ENTREGA`);
  - tampoco pasa por ellas la re-cotización del costo (líneas ~2192-2222, ver punto 2).

**Ejemplo: SUB-19087 (Pintos Falero).**

- El pedido es de US$ 113,85: la parte (1/2) vale 101,52 y la (2/2) vale 12,33.
- En la cuenta hay un solo cargo: 12,33, el de la (2/2).
- La caja cobró las dos partes en la FA-1399 del 10/09.

### 1.1 Impacto (23/07 → 30/09, todo en dólares)

| Situación | Pedidos | Clientes | Sin cargar |
|---|---|---|---|
| Cobrados en caja | 129 | 31 | US$ 9.652,68 |
| Semanales, ya entregados | 9 | 4 | US$ 328,42 |
| Entregados sin pago en caja | 37 | 2 | US$ 3.285,17 |
| Sin retirar | 34 | 3 | US$ 2.593,06 |

- **Semanales entregados:**
  - De Zuasnabar US$ 134,88.
  - CAPA US$ 101,10, en 6 pedidos.
  - Rolymajenski US$ 80,50.
  - Emipal US$ 11,94.
  - Las partes sin cargo nunca entraron al ciclo, así que no están en ninguna factura. *Inferido:* el cierre de ciclo factura los movimientos del ciclo, y estas partes no tienen movimiento.
- **Entregados sin pago y sin retirar:** casi todo es «Coordinacion user» (67 pedidos) y «User» (2).
  - Los únicos clientes externos son Carlos Oliva (US$ 51,68) y Esteban Bueno (US$ 27,00), y todavía no retiraron. Van a pagar en caja por el costo de depósito.
- **Metros de plan sin descontar de las partes salteadas:** no los medí.

### 1.2 Los cobrados en caja: la plata entró, el asiento no

**Qué cobra la caja.** La caja cobra el costo de depósito de cada parte. Verificado en dos comprobantes:

- ET-2999 (27/07): pago de 36,56 = la suma de las 6 partes.
- FA-1399 (10/09): cobró las dos partes de SUB-19087.

**El saldo oficial no cambia.** Las fórmulas del saldo excluyen `ORDEN`/`ORDEN_ANTICIPO`, y la venta contado asienta `VTA_CAJA` y `PAGO` por el mismo importe.

**El saldo de la billetera sí queda mal.**

- La billetera usa `calcularAdelantoLimpio` ([retiroService.js:211](../backend/services/retiroService.js)). Esa función suma `ORDEN` y `PAGO` y excluye `VTA_CAJA`.
- Sin el débito de las partes que faltan, el adelanto queda inflado exactamente por lo que falta. Ejemplo: Grupo Derecho Indígena tiene hoy +140,70, que es justo el cargo que le falta.
- Hoy ese saldo no se usa:
  - la billetera solo cubre retiros si el cliente tuvo algún `ANTICIPO`;
  - ninguno de los 31 clientes tuvo uno.
- **Riesgo:** si alguno carga un anticipo, ese saldo inflado le pagaría órdenes.
  - 16 de los 31 tienen hoy adelanto limpio positivo.
  - Parte de esos saldos tiene otras causas. Pintos Falero, por ejemplo, tiene +18.852.

## 2. Parte con línea en $0: entra con el total del pedido

Cuando una parte tiene su línea en $0 (porque la cubre el plan, con perfil Prepago), su costo sale del total del pedido. Pasa en tres lugares:

- **La etiqueta.** [LabelGenerationService.js:163-164](../backend/services/LabelGenerationService.js): si el subtotal de la orden es 0, el QR lleva el importe del pedido (fallback del 09/07).
- **El ingreso a Depósito.** `costoParaDeposito`, [ordenesController.js:62-75](../backend/controllers/ordenesController.js): si la línea propia vale 0, usa el importe del QR.
- **La re-cotización al ingresar** (logisticsController.js ~2192-2222, desde el 03/09) deja el costo en lo que se asentó, pero no alcanza por dos motivos:
  - solo corre en la parte que se asienta, que por el punto 1 es solo la primera;
  - al escanear el remito en Depósito, la pantalla de Recepción ([ReceptionView.jsx:338-347](../src/components/logistics/ReceptionView.jsx)) llama primero al ingreso y después a `createOrden`. Esa fila ya existe, así que `createOrden` le pisa el costo con `costoParaDeposito` ([ordenesController.js:469](../backend/controllers/ordenesController.js)), que cae al QR.

**Ejemplo: SUB-8264 (CAPA).**

- El pedido es de 2,42.
- Cada parte entró a depósito con 2,42.
- La ET-2999 cobró 4,84.

**Medido:**

- **CAPA, entre el 23/07 y el 31/08:** 12 pedidos, US$ 120,46 cobrados de más en caja.
- **Setiembre:** 0. CAPA pasó a semanal y ya no paga en caja.
- **El riesgo sigue en el código** para cualquier cliente con plan que pague en caja.
- **A revisar a mano, porque puede ser otra cosa (un pedido editado después del cobro):**
  - SUB-15315: partes 458,64 + 54,70 contra un pedido de 54,70.
  - SUB-5804: partes 486,42 + 244 contra un pedido de 13,40.

## 3. De paso: la reversa automática suma en vez de restar

**El bug:**

- Cuando el total del pedido cambió después de asentarse, logisticsController.js (~1898-1914) manda una reversa con `Importe: -mContado`.
- El motor ignora el signo: `MovImporte: Math.abs(Importe) * EvtAfectaSaldo`, en [contabilidadService.js:6149](../backend/services/contabilidadService.js).
- Así, la «reversa» es **otro débito** por el total anterior del pedido.

**El pendiente viejo.** El 21/08 se anotó este bug como pendiente, a raíz de las reposiciones. Las 6 reversas de antes de esa fecha hay que cruzarlas con el reporte de reposiciones que ya tiene administración.

**Las 7 reversas desde el 21/08:**

| Fecha | Cliente | Orden | Tipo | Importe |
|---|---|---|---|---|
| 26/08 | De Zuasnabar (semanal) | SUB-16419-R1 | ORDEN | US$ 65,03 |
| 28/08 | Puntogyf (semanal) | EUV-17006-R1 | ORDEN | US$ 21,89 |
| 03/09 | De Zuasnabar (semanal) | SUB-18951-R1 | ORDEN | US$ 68,88 |
| 03/09 | JTS SPORT | SUB-17805-R1 | ORDEN | $ 177,80 |
| 10/09 | Sport And Fun | SUB-20698 (1/2)-R1 | ORDEN | $ 154,69 |
| 15/09 | CAPA (semanal) | SUB-21098 (1/2)-R1 | ENTREGA en la cuenta de dólares | US$ 466,89 |
| 24/09 | Palmero (semanal) | SUB-26273 | ORDEN | $ 308,24 |

**Qué pasó con esos débitos:**

- **Semanales:** el débito entró al ciclo y quedó en el documento del cierre.
- **Palmero, SUB-26273 (corregido el 01/10):** son dos débitos de más, no uno, y no se le cobraron.
  - La orden ya estaba facturada y cobrada: va en PC-4649, del 22/09, que es una factura en pesos ($ 99.816,20). Su cargo original es de US$ 308,24, en la cuenta de dólares.
  - El 24/09 el ingreso le sumó dos débitos de 308,24 en la cuenta de pesos: la «reversa» (movimiento 60906) y el cargo nuevo (60907).
  - Los dos quedaron enlazados a PC-4957, que está sin pagar, pero no están en su total: PC-4957 es la suma de sus 10 órdenes ($ 104.300,92) y ninguna es SUB-26273.
  - Hay que anularlos igual, para limpiar la cuenta: inflan el total del ciclo (4.657,85 en vez de 4.041,37).
  - No sé por qué fueron a la cuenta de pesos: el pedido figura en dólares. Los cargos de las otras órdenes de ese ciclo también están en la cuenta de pesos, con el importe en dólares del pedido.
- **De Zuasnabar y Puntogyf:** ahí el débito sí entró en la factura. Los dos de De Zuasnabar son líneas de FA-1286 (US$ 65,03 y US$ 68,88), que tiene US$ 412,84 sin pagar. El de Puntogyf es una línea de FA-1230.
- **CAPA:** el `ENTREGA` en la cuenta de dólares sí baja el saldo oficial.
- **Resto:** son reposiciones, que no deberían tener cargo.

## 4. Arreglado en el código (30/09, sin deployar)

1. **«Ya asentado» por orden** (`estadoAsientoOrden` en logisticsController.js).
   - Una orden con movimientos propios de asiento (ORDEN, ORDEN_ANTICIPO, ENTREGA, CONSUMO_CUENTA) ya está asentada y no se toca.
   - Si no tiene, se asientan sus líneas, aunque una hermana de la misma pasada ya haya marcado el pedido.
   - Si el pedido se asentó en una pasada anterior, la orden se asienta solo si lo ya cargado al pedido no llega a su total. Si llega, queda un aviso en el log.
   - Las líneas «Incluido en PRO» no se cobran aparte.
   - Un pedido sin `OrdenID` en ninguna línea lo sigue asentando solo la primera orden. Hoy no hay ninguno así.
2. **Reversa: se sacó.**
   - Los cambios de precio después del ingreso los lleva la cotización, orden por orden (`propagarCotizacionADeposito`).
   - Las reposiciones y fallas (-R/-F) no pasan por el asiento.
   - No se tocó el `Math.abs` del motor: es la única llamada que mandaba importes negativos.
3. **Cotización** (`sincronizarCargosDelPedido` en quotationController.js).
   - Cada cargo va a lo que valen las líneas de su orden. En un pedido «por área», la madre PRO va al total.
   - Si una orden con importe no tiene asiento propio, su importe va en el cargo de la primera orden.
   - Antes se pisaban todos los cargos del pedido con el total. Con el punto 1 eso habría cobrado cada parte por el total.
4. **Línea propia en $0 a propósito** (plan, prepago o reposición).
   - La parte entra en 0: se cambió `costoParaDeposito` y la etiqueta, y `totalesCobranzaDeOrden` ahora devuelve `CeroIntencional`.
   - Sin línea propia, sigue el respaldo del QR.

**Pruebas.** 38 pruebas en una copia aparte de la base local (`SecureAppDB_prueba`), llamando al ingreso real (`receiveDispatch` forzado), a la cotización, a `costoParaDeposito` y a la generación de etiquetas. Sin fallas.
- Script: `test_pedidos_divididos.js`, en el scratchpad de la sesión.
- Casos:
  - SUB-19737: dos partes con plata, más un re-escaneo.
  - SUB-19737 simulando el asiento viejo.
  - SUB-19484 con el bug.
  - SUB-17447 de CAPA: 3 partes del plan y 1 con plata.
  - SUB-19087 con la cotización.
  - SUB-17805-R1.
  - SUB-29254: una orden normal, y la misma con el total del pedido cambiado.

## 5. Datos: pendiente (con las queries de producción, no a mano)

El deploy no corrige lo que ya quedó mal.

- **Semanales (9 pedidos, US$ 328,42).** Cargar la parte que falta, en el ciclo abierto del cliente o con una factura aparte. Decide Administración.
- **Cobrados en caja (129 pedidos).**
  - Completar el asiento de las partes, para que el adelanto limpio vuelva a su valor real.
  - No mueve plata ni genera deuda: la venta ya está cobrada.
  - Hay que asentarlo sin disparar deuda ni ciclo.
- **CAPA (US$ 120,46).** Devolverlo con una nota de crédito o como saldo a favor. Decide Administración.
- **Reversas.** Anular los 7 débitos de la tabla. En los semanales ya facturados, sacarlos con una nota de crédito.

## Query para producción: débitos de la reversa automática

Hasta el deploy siguen apareciendo. En la copia del 30/09 eran 13: 6 antes del 21/08 y 7 después.

```sql
SELECT m.MovIdMovimiento, LTRIM(RTRIM(c.Nombre)) AS Cliente, c.TClIdTipoCliente AS TipoCliente, cc.CueTipo, m.MovTipo,
       CAST(m.MovImporte AS DECIMAL(18,2)) AS Importe, m.CicIdCiclo, m.DocIdDocumento,
       CONVERT(VARCHAR(10), m.MovFecha, 120) AS Fecha, m.MovConcepto
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE m.MovConcepto LIKE '%[[]REVERSA AUT.]%'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY m.MovFecha;
```

- Con `DocIdDocumento` ya está facturado. Se saca con una nota de crédito.
- Sin documento, se anula el movimiento. Si está en un ciclo abierto, sale de la próxima factura.

## Query para producción: pedidos divididos con cargo incompleto

Da un renglón por pedido desde el 23/07, con el total del pedido, lo cargado, lo que falta y la situación: cobrado en caja, semanal, entregado o sin retirar.

Sobre la copia del 30/09 da los mismos 209 pedidos del cuadro 1.1, en 150 ms.

```sql
-- Fechas en UTC (el reloj de SQL de producción está en UTC): 2026-07-23 03:00 UTC = 23/07 00:00 de Uruguay.
DROP TABLE IF EXISTS #PartesDivididas;

SELECT od.OrdIdOrden, od.CliIdCliente, od.OrdCodigoOrden,
       LEFT(od.OrdCodigoOrden, CHARINDEX(' (', od.OrdCodigoOrden) - 1) AS Base,
       CAST(ISNULL(od.OrdCostoFinal, 0) AS DECIMAL(18,2)) AS CostoDeposito,
       od.PagIdPago, od.OrdEstadoActual, erp.OrdenID, pid.PedId
INTO #PartesDivididas
FROM dbo.OrdenesDeposito od WITH(NOLOCK)
OUTER APPLY (SELECT TOP 1 o.OrdenID FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.CodigoOrden = od.OrdCodigoOrden ORDER BY o.OrdenID) erp
OUTER APPLY (SELECT MAX(d.PedidoCobranzaID) AS PedId FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK) WHERE d.OrdenID = erp.OrdenID) pid
WHERE od.OrdFechaIngresoOrden >= '2026-07-23T03:00:00'
  AND od.OrdCodigoOrden LIKE '% (%/%)'
  AND (od.OrdEstadoActual IS NULL OR od.OrdEstadoActual NOT IN (10, 11));

SELECT x.Base, x.Cliente, x.TipoCliente, x.Partes, x.Moneda, x.TotalPedido, x.Cargado,
       CAST(x.TotalPedido - x.Cargado AS DECIMAL(18,2)) AS SinCargar, x.CostoDeposito,
       CASE WHEN x.CobradaEnCaja = 1 THEN 'cobrada en caja'
            WHEN x.TipoCliente = 2 THEN CASE WHEN x.TodasEntregadas = 1 THEN 'semanal, entregada' ELSE 'semanal, sin retirar' END
            WHEN x.TodasEntregadas = 1 THEN 'entregada sin pago en caja'
            ELSE 'sin retirar' END AS Situacion
FROM (
    SELECT g.CliIdCliente, g.Base, LTRIM(RTRIM(c.Nombre)) AS Cliente, c.TClIdTipoCliente AS TipoCliente,
           g.Partes, g.CostoDeposito, g.CobradaEnCaja, g.TodasEntregadas,
           (SELECT MAX(pc.Moneda) FROM dbo.PedidosCobranza pc WITH(NOLOCK)
             WHERE pc.ID IN (SELECT p.PedId FROM #PartesDivididas p WHERE p.CliIdCliente = g.CliIdCliente AND p.Base = g.Base)) AS Moneda,
           (SELECT CAST(ISNULL(SUM(pc.MontoTotal), 0) AS DECIMAL(18,2)) FROM dbo.PedidosCobranza pc WITH(NOLOCK)
             WHERE pc.ID IN (SELECT p.PedId FROM #PartesDivididas p WHERE p.CliIdCliente = g.CliIdCliente AND p.Base = g.Base)) AS TotalPedido,
           (SELECT CAST(ISNULL(SUM(ABS(m.MovImporte)), 0) AS DECIMAL(18,2))
              FROM dbo.MovimientosCuenta m WITH(NOLOCK)
              JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = g.CliIdCliente
             WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO') AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               AND m.OrdIdOrden IN (SELECT p.OrdIdOrden FROM #PartesDivididas p WHERE p.CliIdCliente = g.CliIdCliente AND p.Base = g.Base
                                    UNION
                                    SELECT p.OrdenID FROM #PartesDivididas p WHERE p.CliIdCliente = g.CliIdCliente AND p.Base = g.Base AND p.OrdenID IS NOT NULL)) AS Cargado
    FROM (SELECT CliIdCliente, Base, COUNT(*) AS Partes, SUM(CostoDeposito) AS CostoDeposito,
                 MAX(CASE WHEN PagIdPago > 0 THEN 1 ELSE 0 END) AS CobradaEnCaja,
                 MIN(CASE WHEN OrdEstadoActual = 9 THEN 1 ELSE 0 END) AS TodasEntregadas
          FROM #PartesDivididas WHERE PedId IS NOT NULL
          GROUP BY CliIdCliente, Base) g
    JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = g.CliIdCliente
) x
WHERE x.Cargado < x.TotalPedido - 0.05
ORDER BY Situacion, x.Cliente, x.Base;
```

Notas sobre la query:

- `Cargado` suma en valor absoluto. Si alguna parte tiene una «reversa» (punto 3), aparece como cargo de más y el pedido no sale en la lista.
- Todo lo de este análisis es en dólares. Los pedidos divididos de la copia del 30/09 son todos en USD.
