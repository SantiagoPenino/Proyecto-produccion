-- DIAGNÓSTICO CECILIA ALTMANN (CodCliente 5715682) — MP 4022, USD 624, 30-sep 18:15 — SOLO LECTURA
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @Cod INT = 5715682;
DECLARE @Cli INT = (SELECT CliIdCliente FROM Clientes WHERE CodCliente = @Cod);

-- 1) Las 3 órdenes que pagó: ¿ya estaban en otro retiro? ¿pagadas por otro lado?
SELECT '1_ORDENES' AS Q, o.OrdIdOrden, o.OrdCodigoOrden, o.OrdCostoFinal, o.MonIdMoneda, o.OrdEstadoActual,
       o.OrdFechaEstadoActual, o.PagIdPago AS OrdPagId, o.OReIdOrdenRetiro,
       r.FormaRetiro, r.OReEstadoActual AS RetiroEstado, r.OReFechaAlta AS RetiroAlta, r.OReUsuarioAlta,
       r.PagIdPago AS RetiroPagId, r.ReferenciaPagoOnline, r.OReCostoTotalOrden
FROM OrdenesDeposito o
LEFT JOIN OrdenesRetiro r ON r.OReIdOrdenRetiro = o.OReIdOrdenRetiro
WHERE o.OrdIdOrden IN (168881, 168888, 169908);

-- 2) Todos sus intentos de pago online de los últimos 10 días (¿pagó dos links?)
SELECT '2_MP' AS Q, m.Id, m.TransactionId, m.PaymentId, m.Status, m.CreatedAt, m.PaidAt, m.WebhookReceivedAt,
       JSON_VALUE(m.OrdersJson,'$.totalCost') AS totalCost, JSON_VALUE(m.OrdersJson,'$.ordenRetiro') AS ordenRetiro,
       m.OrdersJson
FROM MercadoPagoTransactions m
WHERE CAST(m.CodCliente AS VARCHAR) = CAST(@Cod AS VARCHAR) AND m.CreatedAt >= DATEADD(DAY,-10,GETDATE())
ORDER BY m.CreatedAt;

SELECT '2_HANDY' AS Q, h.Id, h.TransactionId, h.Status, h.TotalAmount, h.Currency, h.CreatedAt, h.PaidAt,
       h.OrdenRetiroCreada, h.OrdersJson
FROM HandyTransactions h
WHERE CAST(h.CodCliente AS VARCHAR) = CAST(@Cod AS VARCHAR) AND h.CreatedAt >= DATEADD(DAY,-10,GETDATE())
ORDER BY h.CreatedAt;

-- 3) Sus retiros de los últimos 10 días con el pago de cada uno
SELECT '3_RETIROS' AS Q, r.OReIdOrdenRetiro, r.FormaRetiro, r.OReEstadoActual, r.OReFechaAlta, r.OReUsuarioAlta,
       r.OReCostoTotalOrden, r.MonIdMoneda, r.PagIdPago, p.MPaIdMetodoPago, p.PagMontoPago, p.PagFechaPago,
       r.ReferenciaPagoOnline,
       (SELECT STRING_AGG(o.OrdCodigoOrden, ', ') FROM OrdenesDeposito o WHERE o.OReIdOrdenRetiro = r.OReIdOrdenRetiro) AS Ordenes
FROM OrdenesRetiro r
LEFT JOIN Pagos p ON p.PagIdPago = NULLIF(r.PagIdPago,0)
WHERE CAST(r.CodCliente AS VARCHAR) = CAST(@Cod AS VARCHAR) AND r.OReFechaAlta >= DATEADD(DAY,-10,GETDATE())
ORDER BY r.OReFechaAlta;

-- 4) Cobros en caja de hoy/ayer para ella
SELECT '4_CAJA' AS Q, t.TcaIdTransaccion, t.TcaFecha, t.TcaUsuarioId, t.TcaTipoDocumento, t.TcaSerieDoc, t.TcaNumeroDoc,
       t.TcaTotalNeto, t.TcaMonedaBase, t.TcaEstado, t.TcaObservaciones
FROM TransaccionesCaja t
WHERE t.TcaClienteId = @Cli AND t.TcaFecha >= DATEADD(DAY,-2,GETDATE())
ORDER BY t.TcaFecha;

-- 5) Cuentas y últimos movimientos
SELECT '5_CUENTAS' AS Q, cc.CueIdCuenta, cc.CueNombre, cc.CueTipo, cc.MonIdMoneda, cc.CueSaldoActual, cc.CueEsPrincipal
FROM CuentasCliente cc WHERE cc.CliIdCliente = @Cli;

SELECT TOP 20 '5_MOVS' AS Q, mv.MovIdMovimiento, mv.CueIdCuenta, mv.MovTipo, mv.MovConcepto, mv.MovImporte,
       mv.MovSaldoPosterior, mv.OrdIdOrden, mv.OReIdOrdenRetiro, mv.PagIdPago, mv.DocIdDocumento, mv.MovFecha, mv.MovObservaciones
FROM MovimientosCuenta mv
WHERE mv.CueIdCuenta IN (SELECT CueIdCuenta FROM CuentasCliente WHERE CliIdCliente = @Cli)
ORDER BY mv.MovIdMovimiento DESC;

-- 6) Ticket de alerta (error exacto)
SELECT '6_TICKET' AS Q, t.TicIdTicket, t.TicAsunto, t.TicEstado, t.TicFechaAlta, m.TMenTexto
FROM Tickets t
LEFT JOIN Tickets_Mensajes m ON m.TicIdTicket = t.TicIdTicket
WHERE (t.CliIdCliente = @Cod OR t.TicAsunto LIKE '%fa9f6e8d-4556-4c8d-8593-9819a9037010%')
  AND t.TicFechaAlta >= DATEADD(DAY,-2,GETDATE())
ORDER BY t.TicFechaAlta;
