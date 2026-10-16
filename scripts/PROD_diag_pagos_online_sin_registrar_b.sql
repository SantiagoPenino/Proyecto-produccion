-- PAGOS ONLINE SIN REGISTRAR — parte 2 — SOLO LECTURA
USE [SecureAppDB];
SET NOCOUNT ON;

-- A) El pago 70654 que ahora tiene el RW-29700: quién, cuándo, con qué medio
SELECT 'PAGO_70654' AS Q, p.PagIdPago, p.MPaIdMetodoPago, mp.MPaDescripcionMetodo, p.PagMontoPago, p.PagIdMonedaPago,
       p.PagFechaPago, p.PagUsuarioAlta, t.TcaIdTransaccion, t.TcaFecha, t.TcaUsuarioId, t.TcaTipoDocumento,
       t.TcaSerieDoc, t.TcaNumeroDoc, t.TcaTotalNeto, t.TcaEstado, t.TcaObservaciones
FROM Pagos p
LEFT JOIN MetodosPagos mp ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
LEFT JOIN TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE p.PagIdPago = 70654;

SELECT 'DOCS_RW29700' AS Q, dc.DocIdDocumento, dc.DocTipo, dc.DocSerie, dc.DocNumero, dc.DocTotal, dc.MonIdMoneda,
       dc.DocEstado, dc.CfeEstado, dc.DocFechaEmision, dc.DocUsuarioAlta
FROM DocumentosContables dc
WHERE dc.TcaIdTransaccion IN (SELECT PagTcaIdTransaccion FROM Pagos WHERE PagIdPago = 70654);

-- B) Órdenes de los 7 pagos "cobrados sin retiro": ¿se retiraron igual? ¿se cobraron en caja?
SELECT 'ORDENES' AS Q, o.OrdIdOrden, o.OrdCodigoOrden, o.CliIdCliente, o.OrdCostoFinal, o.MonIdMoneda,
       o.OrdEstadoActual, o.OReIdOrdenRetiro, r.FormaRetiro, r.OReEstadoActual AS RetiroEstado, r.OReFechaAlta AS RetiroAlta,
       COALESCE(NULLIF(r.PagIdPago,0), o.PagIdPago) AS PagIdPago, p.MPaIdMetodoPago, p.PagMontoPago, p.PagFechaPago,
       t.TcaObservaciones
FROM OrdenesDeposito o
LEFT JOIN OrdenesRetiro r     ON r.OReIdOrdenRetiro = o.OReIdOrdenRetiro
LEFT JOIN Pagos p             ON p.PagIdPago = COALESCE(NULLIF(r.PagIdPago,0), o.PagIdPago)
LEFT JOIN TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE o.OrdIdOrden IN (168881,168888,169908,  174421,  161839,161872,  163626,  166339,  165715,  163578,163599)
ORDER BY o.OrdIdOrden;

-- C) Tickets de alerta de pagos online (traen el error exacto de cada falla)
SELECT 'TICKETS' AS Q, t.TicIdTicket, t.CliIdCliente, t.TicAsunto, t.TicEstado, t.TicFechaAlta, m.TMenTexto
FROM Tickets t
LEFT JOIN Tickets_Mensajes m ON m.TicIdTicket = t.TicIdTicket
WHERE t.TicAsunto LIKE 'ALERTA:%'
  AND t.TicFechaAlta >= '2026-08-01'
ORDER BY t.TicFechaAlta DESC;
