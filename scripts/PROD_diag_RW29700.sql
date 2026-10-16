-- DIAGNÓSTICO RW-29700 (DTF-27052 / DTF-27714) — SOLO LECTURA
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @RID INT = 29700;

-- 1) El retiro: estado, pago asignado, cómo se creó
SELECT 'RETIRO' AS Q, r.OReIdOrdenRetiro, r.FormaRetiro, r.CodCliente, r.OReCostoTotalOrden, r.MonIdMoneda,
       r.OReEstadoActual, r.OReFechaAlta, r.OReUsuarioAlta, r.PagIdPago, r.ORePasarPorCaja,
       r.IdOrigenCreaOrdenRe, r.ReferenciaPagoOnline
FROM OrdenesRetiro r WHERE r.OReIdOrdenRetiro = @RID;

-- 2) Las órdenes (por código y por relación con el retiro)
SELECT 'ORDENES' AS Q, o.OrdIdOrden, o.OrdCodigoOrden, o.CliIdCliente, o.OrdCostoFinal, o.MonIdMoneda,
       o.OrdEstadoActual, o.PagIdPago, o.OReIdOrdenRetiro, o.OrdFechaIngresoOrden
FROM OrdenesDeposito o
WHERE o.OrdCodigoOrden IN ('DTF-27052','DTF-27714')
   OR o.OrdIdOrden IN (SELECT OrdIdOrden FROM RelOrdenesRetiroOrdenes WHERE OReIdOrdenRetiro = @RID);

-- 3) Tipo de cuenta del cliente (Común / Semanal / Rollo) y saldos
SELECT 'CUENTAS' AS Q, cc.CueIdCuenta, cc.CueNombre, cc.CueTipo, cc.CPaIdCondicion, cc.MonIdMoneda,
       cc.CueSaldoActual, cc.CueEsPrincipal, cc.CueRestringida, cc.CueCicloActivo, cc.CuePuedeNegativo
FROM CuentasCliente cc
WHERE cc.CliIdCliente IN (SELECT CliIdCliente FROM OrdenesDeposito WHERE OrdCodigoOrden IN ('DTF-27052','DTF-27714'));

-- 4) ¿Hubo intento de pago online? (Handy y Mercado Pago, cualquier estado)
SELECT 'HANDY' AS Q, h.Id, h.TransactionId, h.Status, h.TotalAmount, h.Currency, h.CreatedAt,
       h.PaidAt, h.WebhookReceivedAt, h.OrdenRetiroCreada, h.OrdersJson
FROM HandyTransactions h
WHERE h.OrdersJson LIKE '%29700%' OR h.OrdenRetiroCreada = 'RW-29700'
   OR h.OrdersJson LIKE '%DTF-27052%' OR h.OrdersJson LIKE '%DTF-27714%'
ORDER BY h.CreatedAt;

SELECT 'MP' AS Q, m.Id, m.TransactionId, m.Status, m.CreatedAt, m.PaidAt, m.WebhookReceivedAt, m.OrdersJson
FROM MercadoPagoTransactions m
WHERE m.OrdersJson LIKE '%29700%' OR m.OrdersJson LIKE '%DTF-27052%' OR m.OrdersJson LIKE '%DTF-27714%'
ORDER BY m.CreatedAt;

-- 5) Movimientos de cuenta ligados al retiro o a las órdenes
SELECT 'MOVS' AS Q, mv.MovIdMovimiento, mv.CueIdCuenta, mv.MovTipo, mv.MovConcepto, mv.MovImporte,
       mv.MovSaldoPosterior, mv.OrdIdOrden, mv.OReIdOrdenRetiro, mv.PagIdPago, mv.DocIdDocumento,
       mv.MovFecha, mv.MovAnulado, mv.MovUsuarioAlta
FROM MovimientosCuenta mv
WHERE mv.OReIdOrdenRetiro = @RID
   OR mv.OrdIdOrden IN (SELECT OrdIdOrden FROM OrdenesDeposito WHERE OrdCodigoOrden IN ('DTF-27052','DTF-27714'))
ORDER BY mv.MovFecha;

-- 6) Deuda y documentos generados
SELECT 'DEUDA' AS Q, d.*
FROM DeudaDocumento d
WHERE d.OReIdOrdenRetiro = @RID
   OR d.OrdIdOrden IN (SELECT OrdIdOrden FROM OrdenesDeposito WHERE OrdCodigoOrden IN ('DTF-27052','DTF-27714'));

SELECT 'DOCS' AS Q, dc.DocIdDocumento, dc.DocTipo, dc.DocSerie, dc.DocNumero, dc.DocTotal, dc.MonIdMoneda,
       dc.DocEstado, dc.CfeEstado, dc.DocFechaEmision, dc.TcaIdTransaccion, dc.CicIdCiclo
FROM DocumentosContables dc
WHERE dc.DocIdDocumento IN (
        SELECT DocIdDocumento FROM MovimientosCuenta WHERE OReIdOrdenRetiro = @RID AND DocIdDocumento IS NOT NULL
        UNION SELECT DocIdDocumento FROM DeudaDocumento WHERE OReIdOrdenRetiro = @RID AND DocIdDocumento IS NOT NULL)
   OR dc.TcaIdTransaccion IN (SELECT PagTcaIdTransaccion FROM Pagos
                              WHERE PagIdPago IN (SELECT PagIdPago FROM OrdenesRetiro WHERE OReIdOrdenRetiro = @RID));

-- 7) El pago (si existe) y su transacción de caja
SELECT 'PAGO' AS Q, p.PagIdPago, p.MPaIdMetodoPago, p.PagMontoPago, p.PagIdMonedaPago, p.PagFechaPago,
       p.PagUsuarioAlta, t.TcaIdTransaccion, t.TcaTipoDocumento, t.TcaSerieDoc, t.TcaNumeroDoc,
       t.TcaTotalNeto, t.TcaEstado, t.TcaObservaciones
FROM Pagos p
LEFT JOIN TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE p.PagIdPago IN (SELECT PagIdPago FROM OrdenesRetiro WHERE OReIdOrdenRetiro = @RID
                      UNION SELECT PagIdPago FROM OrdenesDeposito WHERE OrdCodigoOrden IN ('DTF-27052','DTF-27714'));
