-- DIAGNÓSTICO RW-29700 — parte 2 — SOLO LECTURA
USE [SecureAppDB];
SET NOCOUNT ON;

-- A) Ticket de alerta que deja el webhook de MP cuando falla el registro del pago (trae el error exacto)
SELECT 'TICKET' AS Q, t.TicIdTicket, t.TicAsunto, t.TicEstado, t.TicFechaAlta, m.TMenTexto
FROM Tickets t
LEFT JOIN Tickets_Mensajes m ON m.TicIdTicket = t.TicIdTicket
WHERE t.TicAsunto LIKE '%362f49f8-3611-403c-9b01-8700d1765c70%'
   OR (t.CliIdCliente = 370901 AND t.TicFechaAlta >= '2026-09-25')
ORDER BY t.TicFechaAlta;

-- B) Transacción MP completa (moneda del cobro vs moneda del retiro)
SELECT 'MP_FULL' AS Q, m.Id, m.PaymentId, m.Status, m.PaidAt,
       JSON_VALUE(m.OrdersJson,'$.totalCost') AS totalCost,
       JSON_VALUE(m.OrdersJson,'$.moneda')    AS moneda,
       JSON_VALUE(m.OrdersJson,'$.ordenRetiro') AS ordenRetiro,
       m.OrdersJson
FROM MercadoPagoTransactions m WHERE m.Id = 5544;

-- C) Historial de estados del retiro (quién lo pasó a 7 y cuándo)
SELECT 'HIST_RETIRO' AS Q, h.*
FROM HistoricoEstadosOrdenesRetiro h WHERE h.OReIdOrdenRetiro = 29700 ORDER BY h.HEOFechaEstado;

-- D) ¿Alguna transacción de caja creada ese día para el cliente (quedó a medias)?
SELECT 'TCA' AS Q, t.TcaIdTransaccion, t.TcaFecha, t.TcaUsuarioId, t.TcaTipoDocumento, t.TcaTotalNeto,
       t.TcaMonedaBase, t.TcaEstado, t.TcaObservaciones
FROM TransaccionesCaja t
WHERE t.TcaClienteId = 2109 AND t.TcaFecha >= '2026-09-25'
ORDER BY t.TcaFecha;

-- E) Por qué la cuenta USD 49 está en -222,32: últimos 30 movimientos
SELECT TOP 30 'MOVS_49' AS Q, mv.MovIdMovimiento, mv.MovTipo, mv.MovConcepto, mv.MovImporte, mv.MovSaldoPosterior,
       mv.OrdIdOrden, mv.OReIdOrdenRetiro, mv.PagIdPago, mv.DocIdDocumento, mv.MovFecha, mv.MovAnulado
FROM MovimientosCuenta mv WHERE mv.CueIdCuenta = 49 ORDER BY mv.MovIdMovimiento DESC;
