-- PAGOS ONLINE COBRADOS PERO NO REGISTRADOS EN EL SISTEMA — SOLO LECTURA
-- Handy (Pagado) y Mercado Pago (approved) donde la pasarela cobró pero NO quedó:
--   · el cobro en caja      (TransaccionesCaja "Cobro Handy/MercadoPago (Tx: <id>)")
--   · la carga en billetera (MovimientosCuenta "... (Tx: <id>)")
--   · la venta de tienda    (ventaCreada en el JSON)
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @Desde DATE = '2026-08-01';   -- ajustar

-- Tx ids que SÍ quedaron registrados (se extraen una sola vez → join por igualdad, rápido)
IF OBJECT_ID('tempdb..#Reg') IS NOT NULL DROP TABLE #Reg;
SELECT DISTINCT SUBSTRING(x.Obs, CHARINDEX('Tx: ', x.Obs) + 4, 36) AS TxId
INTO #Reg
FROM (
    SELECT TcaObservaciones AS Obs FROM TransaccionesCaja WITH(NOLOCK)
    WHERE TcaFecha >= DATEADD(DAY,-2,@Desde) AND TcaObservaciones LIKE '%Tx: %'
    UNION ALL
    SELECT MovObservaciones FROM MovimientosCuenta WITH(NOLOCK)
    WHERE MovFecha >= DATEADD(DAY,-2,@Desde) AND MovObservaciones LIKE '%Tx: %'
) x;
CREATE INDEX IX_Reg ON #Reg(TxId);

;WITH Tx AS (
    SELECT 'HANDY' AS Pasarela, h.Id, h.TransactionId, h.CodCliente, h.OrdersJson,
           CAST(h.TotalAmount AS DECIMAL(18,2)) AS MontoCobrado,
           CASE h.Currency WHEN 840 THEN 'USD' ELSE 'UYU' END AS MonedaCobro,
           h.PaidAt
    FROM HandyTransactions h
    WHERE LOWER(ISNULL(h.Status,'')) IN ('pagado','paid','success','approved')
      AND h.CreatedAt >= @Desde
    UNION ALL
    SELECT 'MERCADOPAGO', m.Id, m.TransactionId, m.CodCliente, m.OrdersJson,
           TRY_CAST(JSON_VALUE(m.OrdersJson,'$.totalCost') AS DECIMAL(18,2)),
           ISNULL(JSON_VALUE(m.OrdersJson,'$.moneda'),'UYU'),
           m.PaidAt
    FROM MercadoPagoTransactions m
    WHERE LOWER(ISNULL(m.Status,'')) = 'approved'
      AND m.CreatedAt >= @Desde
)
SELECT t.Pasarela, t.Id, t.TransactionId,
       ISNULL(JSON_VALUE(t.OrdersJson,'$.type'),'(legacy)') AS Tipo,
       t.CodCliente, c.Nombre, t.MontoCobrado, t.MonedaCobro, t.PaidAt,
       JSON_VALUE(t.OrdersJson,'$.ordenRetiro') AS Retiro,
       r.OReEstadoActual AS RetiroEstado, r.PagIdPago AS RetiroPagId,
       p.MPaIdMetodoPago AS MetodoPagoDelRetiro,
       CASE
         WHEN JSON_VALUE(t.OrdersJson,'$.type') = 'pickup-deferred'
              AND JSON_VALUE(t.OrdersJson,'$.ordenRetiro') IS NULL THEN '1-COBRADO SIN RETIRO CREADO'
         WHEN ISNULL(r.PagIdPago,0) > 0 THEN '3-EL RETIRO TIENE OTRO PAGO (¿se cobró en caja además?) — revisar'
         ELSE '2-COBRADO SIN REGISTRAR (sin pago ni factura)'
       END AS Diagnostico,
       t.OrdersJson
FROM Tx t
LEFT JOIN #Reg reg        ON reg.TxId = t.TransactionId
LEFT JOIN Clientes c      ON CAST(c.CodCliente AS VARCHAR) = CAST(t.CodCliente AS VARCHAR)
LEFT JOIN OrdenesRetiro r ON r.OReIdOrdenRetiro = TRY_CAST(REPLACE(REPLACE(REPLACE(
                                 ISNULL(JSON_VALUE(t.OrdersJson,'$.ordenRetiro'),''),'RW-',''),'R-',''),'PW-','') AS INT)
LEFT JOIN Pagos p         ON p.PagIdPago = r.PagIdPago
WHERE reg.TxId IS NULL
  AND JSON_VALUE(t.OrdersJson,'$.ventaCreada') IS NULL
  -- registro viejo (sin "Tx:" en caja): el retiro ya tiene el pago Handy (9) / MercadoPago (10)
  AND NOT (ISNULL(r.PagIdPago,0) > 0 AND p.MPaIdMetodoPago IN (9,10))
ORDER BY Diagnostico, t.PaidAt DESC;

DROP TABLE #Reg;
