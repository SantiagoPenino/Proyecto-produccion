-- Bultos de órdenes que se cancelaron ANTES del cambio del 25/09/2026 y siguen "en stock" o en un
-- remito sin recibir. Hasta ese día cancelar una orden no tocaba sus bultos: se podían despachar y
-- trababan remitos (DTF-21591: cancelada el 08/09, su bulto salió igual en REM-231455 y en
-- REM-998757). Desde el deploy, cancelar ya lo hace solo (bultosCancelacionService); esto limpia lo
-- que quedó de antes, con el mismo criterio:
--   - Solo el producto de la orden (PROD_TERMINADO / EN_PROCESO). La tela del cliente no se toca.
--   - El bulto pasa a CANCELADO, con un movimiento CANCELACION que guarda el área donde estaba
--     (si la orden se reactiva, vuelve ahí).
--   - Si estaba en un remito sin recibir, sale del remito y el remito se recalcula (sin bultos →
--     CANCELADO; recibido parcial sin nada pendiente → RECIBIDO_TOTAL), con una observación.
--
-- Correrlo DESPUÉS de subir el backend y DESPUÉS de cierre_bultos_entregados_2026-09-25.sql.
-- Antes corré SOLO el paso 1 (seleccionalo y F5) para ver cuántos son: si "EnDeposito" no es 0, son
-- bultos de órdenes canceladas que figuran en Stock Depósito y van a dejar de figurar. Después, el
-- script entero (todo en una transacción).

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- 1) Qué se va a tocar (antes de tocar nada)
SELECT COUNT(*) AS Bultos, COUNT(DISTINCT b.OrdenID) AS Ordenes,
       SUM(CASE WHEN b.Estado = 'EN_TRANSITO' THEN 1 ELSE 0 END) AS EnTransito,
       SUM(CASE WHEN b.Estado = 'EN_STOCK' AND b.UbicacionActual = 'DEPOSITO' THEN 1 ELSE 0 END) AS EnDeposito
FROM Logistica_Bultos b
JOIN Ordenes o ON o.OrdenID = b.OrdenID
WHERE b.Tipocontenido IN ('PROD_TERMINADO', 'EN_PROCESO')
  AND b.Estado IN ('EN_STOCK', 'EN_TRANSITO')
  AND UPPER(LTRIM(RTRIM(o.Estado))) = 'CANCELADO';

BEGIN TRAN;

DECLARE @b TABLE (BultoID INT PRIMARY KEY, CodigoEtiqueta NVARCHAR(50) COLLATE DATABASE_DEFAULT,
                  EstadoAnt NVARCHAR(20) COLLATE DATABASE_DEFAULT, Area NVARCHAR(50) COLLATE DATABASE_DEFAULT,
                  CodigoOrden NVARCHAR(60) COLLATE DATABASE_DEFAULT, Cancelada VARCHAR(10) COLLATE DATABASE_DEFAULT);
INSERT INTO @b (BultoID, CodigoEtiqueta, EstadoAnt, Area, CodigoOrden, Cancelada)
SELECT b.BultoID, b.CodigoEtiqueta, b.Estado, b.UbicacionActual,
       ISNULL(LTRIM(RTRIM(o.CodigoOrden)), CAST(o.OrdenID AS NVARCHAR(20))),
       CONVERT(VARCHAR(10), h.Fecha, 103)
FROM Logistica_Bultos b
JOIN Ordenes o ON o.OrdenID = b.OrdenID
OUTER APPLY (SELECT MAX(hh.FechaInicio) AS Fecha FROM HistorialOrdenes hh
             WHERE hh.OrdenID = o.OrdenID AND hh.Estado IN ('Cancelado', 'CANCELADO')) h
WHERE b.Tipocontenido IN ('PROD_TERMINADO', 'EN_PROCESO')
  AND b.Estado IN ('EN_STOCK', 'EN_TRANSITO')
  AND UPPER(LTRIM(RTRIM(o.Estado))) = 'CANCELADO';

DECLARE @it TABLE (ItemID INT PRIMARY KEY, EnvioID INT, BultoID INT);
INSERT INTO @it (ItemID, EnvioID, BultoID)
SELECT i.ItemID, i.EnvioID, i.BultoID
FROM Logistica_EnvioItems i
JOIN @b x ON x.BultoID = i.BultoID
WHERE i.EstadoRecepcion = 'PENDIENTE';

-- En tránsito, el área que cuenta es la de origen del remito
UPDATE x SET x.Area = e.AreaOrigenID
FROM @b x
JOIN @it t ON t.BultoID = x.BultoID
JOIN Logistica_Envios e ON e.EnvioID = t.EnvioID
WHERE x.EstadoAnt = 'EN_TRANSITO';

-- Remitos afectados, para mostrarlos al final
DECLARE @rem TABLE (EnvioID INT PRIMARY KEY, CodigoRemito NVARCHAR(50) COLLATE DATABASE_DEFAULT,
                    EstadoAntes NVARCHAR(20) COLLATE DATABASE_DEFAULT);
INSERT INTO @rem (EnvioID, CodigoRemito, EstadoAntes)
SELECT DISTINCT e.EnvioID, e.CodigoRemito, e.Estado
FROM Logistica_Envios e JOIN @it t ON t.EnvioID = e.EnvioID;

DELETE i FROM Logistica_EnvioItems i JOIN @it t ON t.ItemID = i.ItemID;

UPDATE e SET
    e.Estado = CASE
        WHEN NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems i WHERE i.EnvioID = e.EnvioID) THEN 'CANCELADO'
        WHEN e.Estado = 'RECIBIDO_PARCIAL'
             AND NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems i WHERE i.EnvioID = e.EnvioID AND i.EstadoRecepcion = 'PENDIENTE')
            THEN 'RECIBIDO_TOTAL'
        ELSE e.Estado END,
    e.Observaciones = ISNULL(e.Observaciones, '') + ' | Sale del remito por orden cancelada: ' + q.Bultos
        + CASE WHEN NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems i WHERE i.EnvioID = e.EnvioID)
               THEN ' (el remito quedó sin bultos)' ELSE '' END
        + ' (cierre retroactivo del 25/09/2026)'
FROM Logistica_Envios e
JOIN (SELECT t.EnvioID, STRING_AGG(CAST(x.CodigoEtiqueta + ' (' + x.CodigoOrden + ')' AS NVARCHAR(MAX)), ', ') AS Bultos
      FROM @it t JOIN @b x ON x.BultoID = t.BultoID
      GROUP BY t.EnvioID) q ON q.EnvioID = e.EnvioID;

UPDATE b SET b.Estado = 'CANCELADO', b.UbicacionActual = 'CANCELADO'
FROM Logistica_Bultos b JOIN @b x ON x.BultoID = b.BultoID;

INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
SELECT x.CodigoEtiqueta, 'CANCELACION', ISNULL(x.Area, 'TRANSITO'), NULL, GETDATE(),
       'Orden ' + x.CodigoOrden + ' cancelada' + ISNULL(' el ' + x.Cancelada, '')
           + ISNULL(': sale del remito ' + rm.Remitos, '') + ' (cierre retroactivo del 25/09/2026)',
       x.EstadoAnt, 'CANCELADO', 0
FROM @b x
OUTER APPLY (SELECT STRING_AGG(CAST(e.CodigoRemito AS NVARCHAR(MAX)), ', ') AS Remitos
             FROM @it t JOIN Logistica_Envios e ON e.EnvioID = t.EnvioID
             WHERE t.BultoID = x.BultoID) rm;

-- Los dos cerrados a mano el 25/09 (REM-916042 y REM-998757) quedaron CANCELADO en TRANSITO:
-- misma ubicación que el resto
UPDATE Logistica_Bultos SET UbicacionActual = 'CANCELADO'
WHERE Estado = 'CANCELADO' AND UbicacionActual <> 'CANCELADO';

COMMIT;

-- 2) Resultado
SELECT (SELECT COUNT(*) FROM @b) AS BultosCancelados, (SELECT COUNT(*) FROM @rem) AS RemitosTocados;
SELECT r.CodigoRemito, r.EstadoAntes, e.Estado AS EstadoAhora,
       (SELECT COUNT(*) FROM Logistica_EnvioItems i WHERE i.EnvioID = e.EnvioID) AS BultosQueQuedan
FROM @rem r JOIN Logistica_Envios e ON e.EnvioID = r.EnvioID
ORDER BY r.CodigoRemito;
