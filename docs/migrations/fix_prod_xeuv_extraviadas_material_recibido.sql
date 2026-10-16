-- ============================================================================
-- FIX PROD: XEUV recuperadas de EXTRAVIADOS -> habilitarlas para trabajar
--
-- El flujo de recuperar un bulto extraviado NO dispara el gancho del check-in
-- de Terminaciones (solo lo dispara el check-in de un remito), asi que las
-- hermanas quedaron 'Pendiente' y la bandeja no las deja trabajar.
-- Este script las pasa a 'Material Recibido' = exactamente lo que hubiera
-- hecho el check-in. Idempotente: si ya avanzaron, no las toca.
--
-- EDITA LA LISTA si falta/sobra alguna orden.
-- ============================================================================

-- ---------- 1) DIAGNOSTICO (solo lectura) ----------
-- Todas las XEUV en Pendiente, con la ubicacion de los bultos del pedido
SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.EstadoenArea,
       (SELECT TOP 1 b.UbicacionActual + ' (' + b.Estado + ')'
        FROM Logistica_Bultos b
        JOIN Ordenes m ON m.OrdenID = b.OrdenID
        WHERE m.NoDocERP = o.NoDocERP
          AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
        ORDER BY b.BultoID DESC) AS UltimoBultoPedido
FROM Ordenes o
WHERE o.AreaID = 'TERMINAC'
  AND o.Estado NOT IN ('Cancelado','CANCELADO')
  AND ISNULL(o.EstadoenArea,'Pendiente') = 'Pendiente';

-- ---------- 2) CORRECCION ----------
BEGIN TRAN;

SELECT OrdenID
INTO #objetivo
FROM Ordenes
WHERE AreaID = 'TERMINAC'
  AND Estado NOT IN ('Cancelado','CANCELADO')
  AND ISNULL(EstadoenArea,'Pendiente') = 'Pendiente'
  AND CodigoOrden IN (
      'XEUV-11794','XEUV-11846','XEUV-11896','XEUV-11982',
      'XEUV-11986','XEUV-12265','XEUV-12267'
  );

UPDATE o
SET o.Estado = 'Produccion',              -- padre de 'Material Recibido'
    o.EstadoenArea = 'Material Recibido',
    o.RolloID = NULL, o.Secuencia = NULL, o.MaquinaID = NULL
FROM Ordenes o JOIN #objetivo x ON x.OrdenID = o.OrdenID;

INSERT INTO dbo.HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
SELECT OrdenID, 'Material Recibido', GETDATE(), GETDATE(), 'Sistema',
       'Material impreso recibido en Terminaciones (ajuste: bulto recuperado de extraviados, el check-in no corre en ese flujo)'
FROM #objetivo;

SELECT @@ROWCOUNT AS OrdenesHabilitadas;
DROP TABLE #objetivo;

COMMIT;

-- ---------- 3) VERIFICACION ----------
SELECT CodigoOrden, Estado, EstadoenArea
FROM Ordenes
WHERE AreaID = 'TERMINAC' AND Estado NOT IN ('Cancelado','CANCELADO')
ORDER BY FechaIngreso DESC;
