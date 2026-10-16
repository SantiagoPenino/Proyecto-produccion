-- =====================================================================
-- Sacar el bulto de la orden DTF-21591 (B23136) del remito REM-231455
-- (DF -> DEPOSITO). El bulto no llegó: se desvincula del remito y vuelve
-- a quedar EN_STOCK en el área de origen del remito (DF), como antes de
-- despacharse. Así el remito queda 27/27 y se puede confirmar.
--
-- Corre en transacción. Si alguna guarda falla, hace ROLLBACK y no toca nada.
-- =====================================================================
SET XACT_ABORT ON;

DECLARE @Remito VARCHAR(50) = 'REM-231455';
DECLARE @Orden  VARCHAR(50) = 'DTF-21591';

-- ---------- DIAGNÓSTICO (antes) ----------
SELECT e.EnvioID, e.CodigoRemito, e.AreaOrigenID, e.AreaDestinoID, e.Estado AS EstadoRemito,
       i.BultoID, i.EstadoRecepcion, b.CodigoEtiqueta, b.Estado AS EstadoBulto, b.UbicacionActual,
       o.OrdenID, o.CodigoOrden, o.Estado AS EstadoOrden, o.UbicacionActual AS UbicacionOrden
FROM Logistica_Envios e
JOIN Logistica_EnvioItems i ON i.EnvioID = e.EnvioID
JOIN Logistica_Bultos b     ON b.BultoID = i.BultoID
JOIN Ordenes o              ON o.OrdenID = b.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
WHERE e.CodigoRemito = @Remito AND o.CodigoOrden = @Orden;

SELECT eo.* FROM Logistica_EnvioOrdenes eo
JOIN Logistica_Envios e ON e.EnvioID = eo.EnvioID
JOIN Ordenes o ON o.OrdenID = eo.OrdenID
WHERE e.CodigoRemito = @Remito AND o.CodigoOrden = @Orden;

-- ---------- FIX ----------
BEGIN TRAN;

DECLARE @EnvioID INT, @Origen VARCHAR(50), @BultoID INT, @Etiqueta VARCHAR(100), @OrdenID INT, @n INT;

SELECT @n = COUNT(*), @EnvioID = MAX(e.EnvioID), @Origen = MAX(e.AreaOrigenID),
       @BultoID = MAX(b.BultoID), @Etiqueta = MAX(b.CodigoEtiqueta), @OrdenID = MAX(o.OrdenID)
FROM Logistica_Envios e
JOIN Logistica_EnvioItems i ON i.EnvioID = e.EnvioID
JOIN Logistica_Bultos b     ON b.BultoID = i.BultoID
JOIN Ordenes o              ON o.OrdenID = b.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
WHERE e.CodigoRemito = @Remito AND o.CodigoOrden = @Orden
  AND i.EstadoRecepcion = 'PENDIENTE';   -- solo si todavía no se recibió

IF @n <> 1
BEGIN
    ROLLBACK;
    RAISERROR('Se esperaba 1 bulto PENDIENTE de %s en %s y hay %d. No se tocó nada.', 16, 1, @Orden, @Remito, @n);
    RETURN;
END

-- 1) Desvincular el bulto del remito
DELETE FROM Logistica_EnvioItems WHERE EnvioID = @EnvioID AND BultoID = @BultoID;

-- 2) Quitar la línea de la orden en el libro del remito (solo si no le quedan otros bultos en él)
IF NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems i JOIN Logistica_Bultos b ON b.BultoID = i.BultoID
               WHERE i.EnvioID = @EnvioID AND b.OrdenID = @OrdenID)
    DELETE FROM Logistica_EnvioOrdenes WHERE EnvioID = @EnvioID AND OrdenID = @OrdenID;

-- 3) El bulto vuelve a stock en el área de origen
UPDATE Logistica_Bultos SET Estado = 'EN_STOCK', UbicacionActual = @Origen WHERE BultoID = @BultoID;

-- 4) Traza
INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
VALUES (@Etiqueta, 'AJUSTE', @Origen, 1, GETDATE(), 'Sacado del remito ' + @Remito + ' por script (no viajó)', 'EN_TRANSITO', 'EN_STOCK', 0);

-- ---------- VERIFICACIÓN ----------
SELECT BultoID, CodigoEtiqueta, Estado, UbicacionActual FROM Logistica_Bultos WHERE BultoID = @BultoID;
SELECT COUNT(*) AS ItemsQuedanEnRemito FROM Logistica_EnvioItems WHERE EnvioID = @EnvioID;  -- debería dar 27

COMMIT;
-- Si algo no cierra en la verificación: cambiar COMMIT por ROLLBACK y volver a correr.
