-- ============================================================================
-- FIX: Reposiciones (-R#) y Fallas (-F#) cobradas en la cotización
-- Fecha: 31-jul-2026
--
-- CAUSA: erpSyncService solo detectaba reposición si el código EMPEZABA con R
--        (R-12345). Las reposiciones reales llevan sufijo (SUB-9319-R1) y las
--        fallas -F# (SUB-8920-F12979), así que se cotizaban a precio normal.
--        Además el perfil "Reposiciones" (ID 11) no tiene reglas cargadas.
--        El código ya quedó corregido (fuerza precio 0); este script repara
--        las cotizaciones YA generadas con esas líneas cobradas.
--
-- QUÉ HACE:
--   PASO 1 (SELECT): lista las líneas afectadas. CORRER PRIMERO Y REVISAR.
--   PASO 2 (UPDATE): pone en 0 las líneas de órdenes -R#/-F# de pedidos con
--                    EstadoCobro = 'Pendiente' y recalcula el MontoTotal del
--                    pedido. Los pedidos YA COBRADOS no se tocan (revisarlos
--                    a mano: la plata ya entró).
-- ============================================================================

-- ─── PASO 1: AUDITAR (solo lectura) ─────────────────────────────────────────
SELECT pc.ID AS PedidoID, pc.NoDocERP, pc.Moneda AS MonPedido, pc.MontoTotal,
       pc.EstadoCobro, o.CodigoOrden, d.ID AS DetalleID, d.Cantidad,
       d.PrecioUnitario, d.Subtotal, d.Moneda AS MonLinea, d.PerfilAplicado
FROM   dbo.PedidosCobranzaDetalle d
JOIN   dbo.PedidosCobranza pc ON pc.ID = d.PedidoCobranzaID
JOIN   dbo.Ordenes o          ON o.OrdenID = d.OrdenID
WHERE  (o.CodigoOrden LIKE '%-R[0-9]%' OR o.CodigoOrden LIKE '%-F[0-9]%')
  AND  ISNULL(d.Subtotal, 0) > 0
ORDER  BY pc.EstadoCobro, pc.FechaGeneracion DESC;

-- ─── PASO 2: CORREGIR (solo pedidos Pendiente) ──────────────────────────────
/*
BEGIN TRAN;

DECLARE @Afectados TABLE (PedidoID INT PRIMARY KEY);

-- Pedidos Pendiente que tienen líneas de reposición/falla cobradas
INSERT INTO @Afectados (PedidoID)
SELECT DISTINCT pc.ID
FROM   dbo.PedidosCobranzaDetalle d
JOIN   dbo.PedidosCobranza pc ON pc.ID = d.PedidoCobranzaID
JOIN   dbo.Ordenes o          ON o.OrdenID = d.OrdenID
WHERE  (o.CodigoOrden LIKE '%-R[0-9]%' OR o.CodigoOrden LIKE '%-F[0-9]%')
  AND  ISNULL(d.Subtotal, 0) > 0
  AND  LTRIM(RTRIM(ISNULL(pc.EstadoCobro,''))) = 'Pendiente';

-- 2a. Poner en 0 las líneas de reposición/falla de esos pedidos
UPDATE d
SET    d.Subtotal               = 0,
       d.PrecioUnitario         = 0,
       d.SubtotalOriginal       = 0,
       d.PrecioUnitarioOriginal = 0,
       d.PerfilAplicado         = 'Reposición sin cargo',
       d.LogPrecioAplicado      = LEFT(ISNULL(d.LogPrecioAplicado,'')
                                  + ' | Corregido 31-jul-2026: reposición/falla sin cargo', 4000)
FROM   dbo.PedidosCobranzaDetalle d
JOIN   dbo.Ordenes o ON o.OrdenID = d.OrdenID
WHERE  d.PedidoCobranzaID IN (SELECT PedidoID FROM @Afectados)
  AND  (o.CodigoOrden LIKE '%-R[0-9]%' OR o.CodigoOrden LIKE '%-F[0-9]%')
  AND  ISNULL(d.Subtotal, 0) > 0;

-- 2b. Recalcular MontoTotal de los pedidos afectados
--     (misma conversión que usa la app: última cotización del dólar)
DECLARE @TC DECIMAL(18,4) = (SELECT TOP 1 CotDolar FROM dbo.Cotizaciones ORDER BY CotFecha DESC);
IF @TC IS NULL OR @TC <= 0 SET @TC = 40;

UPDATE pc
SET    pc.MontoTotal = x.Total
FROM   dbo.PedidosCobranza pc
CROSS APPLY (
    SELECT ISNULL(SUM(
             CASE WHEN pc.Moneda = 'USD' AND d.Moneda = 'UYU' THEN d.Subtotal / @TC
                  WHEN pc.Moneda = 'UYU' AND d.Moneda = 'USD' THEN d.Subtotal * @TC
                  ELSE d.Subtotal END
           ), 0) AS Total
    FROM dbo.PedidosCobranzaDetalle d
    WHERE d.PedidoCobranzaID = pc.ID
) x
WHERE pc.ID IN (SELECT PedidoID FROM @Afectados);

-- Verificación: líneas corregidas y totales nuevos
SELECT pc.NoDocERP, pc.MontoTotal, o.CodigoOrden, d.Subtotal
FROM   dbo.PedidosCobranzaDetalle d
JOIN   dbo.PedidosCobranza pc ON pc.ID = d.PedidoCobranzaID
JOIN   dbo.Ordenes o          ON o.OrdenID = d.OrdenID
WHERE  pc.ID IN (SELECT PedidoID FROM @Afectados)
ORDER  BY pc.NoDocERP, o.CodigoOrden;

COMMIT;   -- ← si la verificación cierra; si no, ROLLBACK
*/
