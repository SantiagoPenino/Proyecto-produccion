-- Cierre retroactivo de bultos que quedaron "en stock" en Depósito o Logística aunque su retiro ya se
-- entregó (25/09/2026). Hasta ese día la entrega de un retiro (retiroService.marcarEntregado) no tocaba
-- los bultos: 24.494 bultos de 24.374 órdenes entregadas entre el 12/06 y el 25/09 seguían figurando en
-- Stock Depósito.
--
-- Cada bulto queda ENTREGADO en CLIENTE_FINAL, igual que hace la entrega desde el deploy del 25/09, con
-- un movimiento de salida fechado el día REAL de la entrega del retiro. Incluye las reposiciones y fallas
-- de cada orden (DTF-22306 → DTF-22306-R1…) cuyo bulto ya existía cuando se entregó la madre: esas
-- salieron con ella. Las que se hicieron DESPUÉS (reclamo del cliente, caso REM-916042) son mercadería
-- nueva que todavía hay que entregarle, y no se tocan. No toca encomiendas (su OrdenID es el número de
-- retiro, no una orden).
--
-- Correrlo DESPUÉS de subir backend/services/retiroService.js, así no quedan afuera las entregas de
-- mientras tanto. Va por tandas de 2.000 con una pausa de 1 segundo: se puede cortar y volver a correr,
-- sigue donde quedó.

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- 1) Órdenes de retiros entregados (madres por CodigoOrden o NoDocERP, más sus reposiciones y fallas),
--    con el retiro y la fecha de su última entrega
IF OBJECT_ID('tempdb..#ent') IS NOT NULL DROP TABLE #ent;
CREATE TABLE #ent (OrdenID INT PRIMARY KEY, Retiro VARCHAR(30) COLLATE DATABASE_DEFAULT, Entregado DATETIME, EsHija BIT);

WITH madres AS (
    SELECT o.OrdenID, o.CodigoOrden, r.OReIdOrdenRetiro, r.FormaRetiro, r.OReFechaEstadoActual
    FROM OrdenesRetiro r
    JOIN OrdenesDeposito od ON od.OReIdOrdenRetiro = r.OReIdOrdenRetiro
    JOIN Ordenes o ON o.CodigoOrden = od.OrdCodigoOrden
    WHERE r.OReEstadoActual = 5
    UNION
    SELECT o.OrdenID, o.CodigoOrden, r.OReIdOrdenRetiro, r.FormaRetiro, r.OReFechaEstadoActual
    FROM OrdenesRetiro r
    JOIN OrdenesDeposito od ON od.OReIdOrdenRetiro = r.OReIdOrdenRetiro
    JOIN Ordenes o ON o.NoDocERP = od.OrdCodigoOrden
    WHERE r.OReEstadoActual = 5
), todas AS (
    SELECT OrdenID, OReIdOrdenRetiro, FormaRetiro, OReFechaEstadoActual, CAST(0 AS BIT) AS EsHija FROM madres
    UNION
    SELECT h.OrdenID, m.OReIdOrdenRetiro, m.FormaRetiro, m.OReFechaEstadoActual, CAST(1 AS BIT)
    FROM madres m
    JOIN Ordenes h ON h.CodigoOrden LIKE REPLACE(REPLACE(REPLACE(m.CodigoOrden, '[', '[[]'), '%', '[%]'), '_', '[_]') + '-%'
)
INSERT INTO #ent (OrdenID, Retiro, Entregado, EsHija)
SELECT OrdenID, Retiro, Entregado, EsHija FROM (
    SELECT OrdenID,
           ISNULL(RTRIM(FormaRetiro), 'R') + '-' + CAST(OReIdOrdenRetiro AS VARCHAR) AS Retiro,
           OReFechaEstadoActual AS Entregado, EsHija,
           ROW_NUMBER() OVER (PARTITION BY OrdenID ORDER BY EsHija, OReFechaEstadoActual DESC) AS n
    FROM todas
) x WHERE n = 1;

-- Cuántos se van a cerrar (antes de tocar nada)
SELECT COUNT(*) AS BultosACerrar, COUNT(DISTINCT b.OrdenID) AS Ordenes
FROM Logistica_Bultos b JOIN #ent e ON e.OrdenID = b.OrdenID
WHERE ISNULL(b.Tipocontenido, '') <> 'ENCOMIENDA'
  AND b.Estado = 'EN_STOCK' AND b.UbicacionActual IN ('DEPOSITO', 'LOGISTICA')
  AND (e.EsHija = 0 OR b.FechaCreacion <= e.Entregado);

-- 2) Cierre por tandas de 2.000, cada una en su transacción
DECLARE @salen TABLE (CodigoEtiqueta NVARCHAR(100) COLLATE DATABASE_DEFAULT, Ubicacion NVARCHAR(100) COLLATE DATABASE_DEFAULT,
                      Retiro VARCHAR(30) COLLATE DATABASE_DEFAULT, Entregado DATETIME);
DECLARE @n INT = 1, @total INT = 0;
WHILE @n > 0
BEGIN
    BEGIN TRAN;

    UPDATE TOP (2000) b SET b.Estado = 'ENTREGADO', b.UbicacionActual = 'CLIENTE_FINAL'
    OUTPUT INSERTED.CodigoEtiqueta, DELETED.UbicacionActual, e.Retiro, e.Entregado INTO @salen
    FROM Logistica_Bultos b
    JOIN #ent e ON e.OrdenID = b.OrdenID
    WHERE ISNULL(b.Tipocontenido, '') <> 'ENCOMIENDA'
      AND b.Estado = 'EN_STOCK' AND b.UbicacionActual IN ('DEPOSITO', 'LOGISTICA')
      AND (e.EsHija = 0 OR b.FechaCreacion <= e.Entregado);
    SET @n = @@ROWCOUNT;

    INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
    SELECT CodigoEtiqueta, 'SALIDA', Ubicacion, NULL, Entregado,
           'Entregado al cliente con el retiro ' + Retiro + ' (cierre retroactivo del 25/09/2026)', 'EN_STOCK', 'ENTREGADO', 0
    FROM @salen;

    COMMIT;

    SET @total += @n;
    DELETE FROM @salen;
    IF @n > 0 WAITFOR DELAY '00:00:01';
END

SELECT @total AS BultosCerrados;
DROP TABLE #ent;
