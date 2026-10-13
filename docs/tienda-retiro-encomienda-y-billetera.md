# Tienda del portal: qué pasa con una compra con retiro en el local y con encomienda

**23/09/2026.** Recorrido completo, verificado en el código, de una compra en la tienda (`/portal/tienda`) según la forma de envío. Es el paso previo pedido antes de sumar la **billetera prepago** como forma de pago del retiro en el local (sección 5).

Marcas: **verificado** = leído en el código (archivo:línea); **inferido** = deducido del código, sin datos que lo confirmen; **no sé** = no lo revisé o depende de cómo se trabaja.

---

## 1. Resumen

| | Retiro en el local | Encomienda |
|---|---|---|
| Botón del carrito | "Pagar ahora" → Handy / MercadoPago | "Confirmar pedido" |
| ¿Se paga al comprar? | **Sí, obligatorio** (solo Handy funciona) | **No** |
| ¿Cuándo nace la venta VEN-? | Cuando Handy confirma el pago (webhook) | Al confirmar el pedido |
| Preparación y stock | Igual en los dos: se prepara, se descuenta stock del WMS y se imprime la etiqueta | Igual |
| Al ingresar a Depósito | Deuda + retiro **automático** ya abonado | Deuda; el pedido aparece en Retiro de Pedidos |
| ¿Dónde paga el cliente? | Ya pagó | En Retiro de Pedidos (Handy, MercadoPago, saldo o prepago), y ahí arma el envío |

**Hay dos problemas serios en el camino del retiro que conviene confirmar con datos antes de tocar nada** (sección 4, H1 y H2): el pago con Handy de la tienda no pasa por la caja al llegar a depósito, y un cliente con billetera de descuento automático podría pagar dos veces.

> **Actualización 23/09 (sin deployar):** H1 y H2 arreglados y la billetera prepago implementada en el retiro en el local (sección 7). Probándolo apareció un problema de la **caja**, anterior a todo esto y que afecta a todos los cobros de órdenes: imputa el mismo pago dos veces (sección 8, **verificado en la base local**; en producción, Q3b: **129 cobros**).

---

## 2. Retiro en el local (verificado)

1. **Carrito:** con "Retiro en el local" elegido, el botón dice "Pagar ahora" y abre el selector Handy / MercadoPago ([TiendaView.jsx:718](../src/client-portal/modulos/TiendaView.jsx)). MercadoPago aparece pero no funciona: muestra "MercadoPago está en camino — por ahora pagá con Handy" (TiendaView.jsx:346).
2. **Link de pago:** `POST /web-orders/tienda/init-pago` valida y re-precia el carrito en el servidor y genera el link de Handy. **No crea la venta**: guarda el carrito validado en la transacción de Handy (`type: 'tienda-checkout'`) ([tiendaController.js:729](../backend/controllers/tiendaController.js)).
3. **Pago:** el cliente paga en Handy. Si cancela, no se crea nada y el carrito queda como estaba.
4. **Webhook de Handy:** al confirmarse el pago, crea la venta **ya pagada** con `crearVentaTiendaPagada` ([webOrdersController.js:6374](../backend/controllers/webOrdersController.js)):
   - `PedidosCobranza` VEN- con `Origen = 'TIENDA'`, `ModoRetiro = 'RETIRO'`, `EstadoCobro = 'PENDIENTE'` y la marca de pago online (`FechaPagoOnline`, `PagoOnlineRef`, `MetodoPagoOnline = 'HANDY'`).
   - Detalle de la venta y una orden "ancla" en PRO (`VENTA_DIRECTA`, próximo servicio DEPOSITO) para la etiqueta.
   - Evento de trazabilidad y aviso por socket al panel de ventas.
   - Idempotente ante webhooks repetidos (guarda `ventaCreada` en la transacción).
5. **Vuelta al portal:** `/portal/payment-status` limpia el carrito si el pago quedó Pagado ([PaymentResult.jsx:269](../src/components/pages/PaymentResult.jsx)). El backend le manda el código de la venta (`codigoVenta`), pero **la página no lo muestra**: muestra el código de retiro, que en una compra de tienda todavía no existe (PaymentResult.jsx:149, 246, 418).
6. **Preparación** (panel de ventas WMS, [logisticaWmsController.js](../backend/controllers/logisticaWmsController.js)):
   - Aparece en pendientes junto con cualquier VEN (línea 145).
   - "Iniciar" la pasa a `EN_PREPARACION` (línea 209).
   - "Confirmar" **descuenta el stock del WMS**, la pasa a `PREPARADO` y genera el bulto/etiqueta de la ancla (líneas 274–348).
7. **Ingreso a Depósito** (`receivePreparedOrder`, línea 516):
   - Crea la fila en `OrdenesDeposito` con el artículo genérico 386 y el total de la venta (línea 588).
   - La venta pasa a `RECIBIDO_DEPOSITO` y los bultos se mueven de PRO a DEPOSITO.
   - **Registra la deuda** con el evento contable `ORDEN` (línea 647).
   - Como es tienda + retiro + pagada online, **crea el retiro RW solo y lo marca Abonado** con `registrarPago` (Handy, método 9) (líneas 659–706).
8. **Entrega:** el cliente retira en el local con el retiro ya abonado. **No sé** si alguien marca la venta como ENTREGADO: hay un endpoint (`markDelivered`, línea 498), pero no revisé cuándo se usa.

## 3. Encomienda (verificado)

1. **Carrito:** con "Encomienda" el botón dice "Confirmar pedido" y **no pide pago** (TiendaView.jsx:718).
2. **Venta:** `POST /web-orders/tienda/checkout` crea la VEN **impaga**, con `ModoRetiro = 'ENCOMIENDA'` (tiendaController.js:432).
3. **Mensaje al cliente:** "Cuando quieras, pagalo desde Retiro de Pedidos… **recién con el pago lo preparamos**" (TiendaView.jsx:589). **No es cierto:** desde el 21/08 las ventas de la tienda se preparan sin esperar el pago (logisticaWmsController.js:151–155), y el cliente recién puede pagarla cuando llegó a Depósito, porque Retiro de Pedidos solo lista pedidos en depósito.
4. **Preparación:** igual que el retiro (paso 6 de arriba): se prepara, se descuenta stock y se imprime la etiqueta, **esté paga o no**.
5. **Ingreso a Depósito:** igual que el retiro, pero **sin retiro automático**: queda la orden en depósito con su deuda (pasos 7 de arriba, sin el último punto).
6. **Pago y envío:** el pedido aparece en Retiro de Pedidos. El cliente elige encomienda (agencia o dirección), paga y se crea su retiro con los datos de envío ([PickupView.jsx:284](../src/client-portal/modulos/PickupView.jsx)):
   - **Handy / MercadoPago:** el webhook cobra **por la caja** (e-Ticket Contado, método 9, se aplica a la deuda) (webOrdersController.js:6566–6599).
   - **Pagar con mi saldo:** también por la caja, con el medio "Saldo de cuenta" y su e-Ticket (webOrdersController.js:5968).
   - **Cubrir con mi billetera (prepago):** por consumo, sin documento nuevo porque esa plata ya está facturada; el retiro nace abonado (webOrdersController.js:5764).
7. **Despacho:** lo arma logística desde Depósito. No revisé el flujo de encomiendas en sí.
8. **Si nunca paga:** el stock ya se descontó y el pedido queda en depósito con la deuda (es la decisión del 21/08: "el control de 'no sale sin plata' vive en el retiro/caja").

---

## 4. Problemas encontrados

**H1 — El pago con Handy de la tienda no pasa por la caja (confirmar con datos).** En el retiro automático del ingreso a depósito, el pago se registra con `registrarPago` ([retiroService.js:699](../backend/services/retiroService.js)): inserta el pago y marca el retiro abonado, pero **no emite el e-Ticket ni aplica el pago a la deuda** en la cuenta corriente. El mismo pago con Handy desde Retiro de Pedidos sí pasa por la caja (`procesarTransaccion`, e-Ticket Contado). El comentario del código dice "misma mecánica que el 'pagar ahora' de pickup", pero hoy son distintas. Consecuencia probable: ventas de tienda cobradas con Handy **sin factura** y con la deuda del ingreso sin cancelar en la cuenta del cliente. Se confirma con la consulta Q1.

**H2 — Posible doble cobro con billetera de descuento automático (inferido, confirmar con datos).** Al ingresar a depósito, el evento `ORDEN` descuenta solo de la billetera si el cliente tiene una cuenta con "descuento automático" (`CueAutoConsumo`) que admita el artículo ([contabilidadService.js:5885](../backend/services/contabilidadService.js)). El evento no sabe que la venta ya se pagó con Handy. Un cliente con billetera automática que compra en la tienda con retiro pagaría **dos veces**: la tarjeta y la billetera. Se confirma con Q1 (aparece un consumo sobre la orden) y Q2 (cuántos clientes podrían estar expuestos).

**H3 — Mensaje falso en la encomienda.** Ver paso 3 de la sección 3: dice "recién con el pago lo preparamos" y es al revés.

**H4 — La página del pago no muestra el código de la compra.** Ver paso 5 de la sección 2.

**H5 — MercadoPago aparece en la tienda pero no funciona.** Ver paso 1 de la sección 2.

**H6 — Cancelar una venta no deshace nada.** `cancelOrder` (logisticaWmsController.js:778) pone `CANCELADO` en **cualquier** estado: no devuelve el stock, no revierte la deuda del depósito ni el pago online. No revisé desde qué estados la pantalla ofrece el botón.

**H7 — Texto que ya no se muestra.** El mensaje de "compra confirmada" para retiro ("pagás al retirarlo en el local… no se te cobró nada todavía", TiendaView.jsx:590) es de antes del pago online: hoy el retiro nunca llega a esa pantalla.

---

## 5. Billetera prepago en el retiro en el local (propuesta; implementada, ver sección 7)

Decisiones de Santiago (23/09): **solo la billetera prepago**; **se cobra al llegar a depósito, con el saldo reservado al comprar**.

1. **Carrito:** en el selector de "Pagar ahora" se suma **"Billetera"**, solo si el cliente tiene la billetera del portal habilitada y el **prepago disponible** (saldo menos reservas) alcanza para el total. Antes de confirmar se muestra de qué cuenta(s) sale, como en "Cubrir con mi billetera".
2. **Al confirmar:** se crea la venta (como hoy con Handy, pero sin pasarela) marcada con `MetodoPagoOnline = 'BILLETERA'`, y **se reserva el importe** en la cuenta prepago elegida.
3. **Al ingresar a depósito:** la orden se **cubre por consumo** desde la cuenta reservada (el mismo motor que "Cubrir con mi billetera": sin documento nuevo, porque el prepago ya está facturado), se libera la reserva y se crea el **retiro automático abonado**, sin registrar un pago de Handy.
4. **Si la venta se cancela** antes de llegar, se libera la reserva.

**Lo que hay que resolver:**
- **Cómo reservar.** Propongo un movimiento de reserva en la propia cuenta prepago, que se anula al cobrar o al cancelar: así el saldo disponible que ya calculan el portal, "Cubrir con mi billetera" y el motor baja solo, sin tocar cada consulta. Hay que revisar que el estado de cuenta y los reportes lo muestren bien, y que no genere asiento.
- **H2 va junto con esto.** La venta pagada con billetera tampoco puede pasar por el descuento automático de otra cuenta, y la pagada con Handy no debería pasar nunca. El cambio en el ingreso a depósito tiene que saltear el descuento automático para toda venta de tienda ya pagada.
- **H1 también toca el mismo lugar** (el retiro automático del ingreso). Conviene decidir si se arregla antes.

---

## 6. Consultas para producción (solo lectura)

**Resultado del 23/09:**
- **Q1 salió vacía:** ninguna venta de tienda con retiro pagada online llegó todavía a depósito. H1 y H2 no ocurrieron aún, pero van a ocurrir con la primera.
- **Q2 = 1.620 clientes** con billetera en descuento automático. A los que tengan saldo, esa primera compra con retiro pagada con Handy también les descontaría de la billetera.

```sql
-- Q1. Ventas de tienda con retiro pagadas online que ya ingresaron a depósito:
--     ¿qué pago tienen, qué movimientos hay en la cuenta y si tienen e-Ticket?
SELECT p.NoDocERP, p.MontoTotal, p.Moneda, p.MetodoPagoOnline, p.FechaPagoOnline, p.EstadoCobro,
       od.OrdIdOrden, od.OReIdOrdenRetiro, od.PagIdPago, pg.MPaIdMetodoPago,
       mv.Movimientos, doc.Documentos
FROM dbo.PedidosCobranza p
JOIN dbo.OrdenesDeposito od ON od.OrdCodigoOrden = p.NoDocERP
LEFT JOIN dbo.Pagos pg ON pg.PagIdPago = od.PagIdPago
OUTER APPLY (
    SELECT STRING_AGG(CONCAT(m.MovTipo, ' ', m.MovImporte,
                             CASE WHEN m.DocIdDocumento IS NULL THEN ' (sin doc)' ELSE CONCAT(' (doc ', m.DocIdDocumento, ')') END), ' | ') AS Movimientos
    FROM dbo.MovimientosCuenta m
    WHERE m.OrdIdOrden = od.OrdIdOrden AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
) mv
OUTER APPLY (
    SELECT STRING_AGG(CONCAT(RTRIM(d.DocTipo), ' ', d.DocSerie, '-', d.DocNumero), ', ') AS Documentos
    FROM dbo.DocumentosContables d
    WHERE EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle dd
                  WHERE dd.DocIdDocumento = d.DocIdDocumento AND dd.OrdCodigoOrden = p.NoDocERP)
) doc
WHERE p.Origen = 'TIENDA' AND p.ModoRetiro = 'RETIRO' AND p.FechaPagoOnline IS NOT NULL
ORDER BY p.FechaGeneracion DESC;
```

- **H1 confirmado** si `Documentos` sale vacío y en `Movimientos` el ORDEN aparece "(sin doc)".
- **H2 confirmado** si en `Movimientos` aparece un consumo (`CONSUMO_CUENTA`) sobre una venta que ya tenía pago con Handy.

```sql
-- Q2. ¿Cuántos clientes tienen una billetera con descuento automático activa?
SELECT COUNT(DISTINCT CliIdCliente) AS Clientes
FROM dbo.CuentasCliente
WHERE CueActiva = 1 AND CueAutoConsumo = 1 AND CueEsPrincipal = 0 AND CueTipo LIKE 'DINERO%';
```

---

## 7. Implementación (23/09, sin deployar)

Pedido de Santiago: "H1 al llegar a depósito, y anda con H2 y billetera".

**Compra con billetera** (`POST /web-orders/tienda/pagar-con-billetera`, `tiendaController.pagarTiendaConBilletera`):
- Solo cliente logueado con `CliBilleteraPortal = 1`, retiro en el local, y nunca un diseñador operando en nombre del cliente (las demás rutas de billetera tampoco lo admiten).
- Cuentas: prepago (`PREPAGO_FACTURADO`) activas, no principales, sin las bolsas de beneficio. Orden de preferencia, igual que "Cubrir con mi billetera": restringida que permita el artículo 386 (con el que la venta entra a depósito) → libre en la moneda del pedido → libre en la otra moneda, a la cotización del día. Si ninguna sola alcanza, se reparte entre las libres (`planPartesConsumoBilletera`). Nunca deja una cuenta en negativo.
- `preview: true` devuelve el plan sin comprar; el carrito lo pide al abrir el selector de pago y muestra "Billetera" solo si alcanza.
- Al comprar: la VEN nace pagada (`MetodoPagoOnline = 'BILLETERA'`, `PagoOnlineRef = RES#<ids>`) y, **en la misma transacción**, una reserva por cuenta: movimiento `RESERVA_TIENDA` negativo, `MovRefExterna` = código de la venta, fuera de cualquier ciclo. Antes de reservar se bloquea la cuenta y se vuelve a mirar el saldo. La observación guarda el total de la compra y la cotización usada.

**Ingreso a depósito** (`logisticaWmsController.receivePreparedOrder` → `cobrarVentaTiendaPagada`):
- Toda venta de tienda pagada online entra con `SinCoberturaAutomatica` (`contabilidadService.procesarEventoContable`): sin plan de metros, sin billetera automática y fuera del ciclo semanal (`registrarMovimiento` con `SinCiclo`). Queda como deuda PENDIENTE por el total → **H2 arreglado**.
- **Handy:** se cobra por la caja administrativa (`procesarTransaccion`, `ORDEN_DEPOSITO`, E-Ticket Contado, método 9) y después se crea el retiro, que nace Abonado con ese pago → **H1 arreglado**. Antes de ir a la caja se verifica que exista la deuda del ingreso por el total; si no, la caja imputaría el pago a otras deudas del cliente. Si la caja falla o esa deuda no está, se vuelve al camino anterior (pago anotado en el retiro, sin E-Ticket) y se abre un ticket a Finanzas.
- **Billetera:** la reserva se aplica como consumo con `consumirOrdenDesdeSaldoEnPartes`, que ahora anula las reservas **dentro de su transacción** justo antes de consumir. Si el total de la venta no cambió desde la compra, se consume exactamente lo reservado; si cambió en la preparación, se recalcula sobre lo reservado y, si no alcanza, con el saldo libre de esas cuentas. Después se crea el retiro, que nace Abonado (para clientes ROLLO se fuerza Abonado, porque `crearRetiro` no mira el consumo de billetera en ese tipo). Si la reserva no se puede aplicar, **no se crea el retiro**, la orden queda con su deuda y se abre un ticket a Finanzas.
- **Cancelar** la venta desde Recibir órdenes de venta devuelve las reservas activas a la billetera.

**Pruebas (base local de desarrollo, datos de prueba borrados al final):** 38 verificaciones OK. Vista previa, encomienda y diseñador rechazados, compra con reserva, segunda compra sin saldo, cancelación con devolución, reserva perdida al ingresar (sin retiro + ticket), ingreso con billetera (un solo consumo, ORDEN marcada, deuda cancelada, retiro Abonado), ingreso con Handy de un cliente Semanal con ciclo activo y billetera automática (ORDEN fuera del ciclo, sin consumo automático, E-Ticket con detalle, deuda COBRADA, retiro Abonado con el pago) y caja caída (pago anotado + ticket). No probado en el navegador: el portal pide login de cliente.

**Sigue abierto:** H3, H4, H5 y H6 (cancelar una venta ya ingresada o pagada con Handy sigue sin deshacer nada).

---

## 8. Hallazgo: la caja imputa dos veces el mismo pago (anterior a este cambio)

**Verificado en la base local** con un cobro Handy de tienda de 99 a un cliente que tenía otra deuda pendiente de 50 en la misma cuenta:
1. La caja aplica el pago a la deuda exacta de la orden (paso 3.5 de `cajaService.procesarTransaccion`): deuda de 99 → COBRADO.
2. Después del commit, `_lanzarHooksContables` llama a `hookPagoRegistrado` con el total, que corre `SP_ImputarPagoPEPS` sobre **todas** las deudas pendientes de la cuenta: la deuda ajena de 50 también quedó **COBRADO**, con una imputación del mismo pago, sin que nadie la pagara.
3. Como el cliente era Semanal, el "excedente" de 49 se sumó además a los pagos del ciclo abierto (`acumularEnCiclo`). Ese total (`CicTotalPagos`) se muestra en Antigüedad de deuda y se recalcula desde los movimientos; el cierre factura por las ORDEN del ciclo, no por ese total (verificado en `cerrarCicloCompleto`), así que no cambia lo facturado.

El paso 3.5 guarda `header._imputadoDeuda` justo para esto ("para que _lanzarHooksContables no duplique el débito"), pero **nada lo lee** (cajaService.js:1242). El paso 3.5 existe desde el 09/06/2026 (commit 98ddb29) y el hook desde abril; `cajaService.js` no cambió desde el 07/09.

**Alcance (inferido del código):** todo cobro de órdenes por `procesarTransaccion` a un cliente con otras deudas pendientes en la misma cuenta y moneda: el pago Handy de Retiro de Pedidos, "Pagar con mi saldo" y los cobros de caja que pasan por esa función. Con este cambio se suma el cobro Handy de la tienda.

**Producción, 23/09 (verificado, Q3b corrida por Santiago): 129 cobros** con el pago aplicado de más. Cada uno dejó una o más deudas de clientes como COBRADAS sin pago: no aparecen en Documentos con deuda ni en Antigüedad de deuda.

**No lo arreglé** (no era parte del pedido). El arreglo que propongo: que el hook impute solo lo que la caja no aplicó ya (`totalNeto - _imputadoDeuda`), y un barrido para devolver a PENDIENTE las deudas cobradas por imputaciones duplicadas, que se decide después de ver Q3.

```sql
-- Q3. Cobros de caja cuyo pago quedó imputado por MÁS de lo cobrado
--     (la misma plata aplicada a la deuda de la orden y otra vez a deudas ajenas).
WITH x AS (
    SELECT t.TcaIdTransaccion, t.TcaFecha, t.TcaClienteId, t.TcaTotalNeto, t.TcaObservaciones,
           ip.PagIdPago, SUM(ip.ImpImporte) AS TotalImputado, COUNT(*) AS DeudasTocadas
    FROM dbo.TransaccionesCaja t
    JOIN dbo.Pagos p ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
    JOIN dbo.ImputacionPago ip ON ip.PagIdPago = p.PagIdPago
    WHERE ISNULL(t.TcaEstado, '') <> 'ANULADO'
    GROUP BY t.TcaIdTransaccion, t.TcaFecha, t.TcaClienteId, t.TcaTotalNeto, t.TcaObservaciones, ip.PagIdPago
    HAVING SUM(ip.ImpImporte) > t.TcaTotalNeto + 0.01
)
SELECT * FROM x ORDER BY TcaFecha DESC;

-- Q3b. Resumen: cuántos cobros, cuántos clientes y cuánto se imputó de más.
WITH x AS (
    SELECT t.TcaIdTransaccion, t.TcaFecha, t.TcaClienteId, t.TcaTotalNeto, SUM(ip.ImpImporte) AS TotalImputado
    FROM dbo.TransaccionesCaja t
    JOIN dbo.Pagos p ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
    JOIN dbo.ImputacionPago ip ON ip.PagIdPago = p.PagIdPago
    WHERE ISNULL(t.TcaEstado, '') <> 'ANULADO'
    GROUP BY t.TcaIdTransaccion, t.TcaFecha, t.TcaClienteId, t.TcaTotalNeto, ip.PagIdPago
    HAVING SUM(ip.ImpImporte) > t.TcaTotalNeto + 0.01
)
SELECT COUNT(*) AS Cobros, COUNT(DISTINCT TcaClienteId) AS Clientes,
       SUM(TotalImputado - TcaTotalNeto) AS ImputadoDeMas, MIN(TcaFecha) AS Primero
FROM x;
```
