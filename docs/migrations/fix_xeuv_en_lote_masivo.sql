-- ============================================================================
-- FIX PROD MASIVO: hermanas XEUV asignadas a lotes en TERMINAC
--
-- El boton "Asignar a Lote" de la planilla se mostraba tambien en Terminaciones
-- y varias XEUV quedaron 'En Lote'. En ese estado el check-in del material
-- impreso NO las toma (solo mueve hermanas 'Pendiente') y quedan clavadas.
--
-- QUE HACE con cada XEUV de TERMINAC que este 'En Lote' (o 'En Maquina'):
--   - La saca del lote (RolloID/Secuencia/Maquina en NULL)
--   - Si el material impreso YA se recibio (hay bulto del pedido con
--     UbicacionActual='TERMINAC')  -> 'Material Recibido' (lista en la bandeja)
--   - Si todavia NO se recibio     -> 'Pendiente' (el check-in la va a tomar
--     solo cuando llegue el remito, como corresponde)
--   - Deja fila de historial en ambos casos
--
-- Idempotente: se puede correr de nuevo; sin filas 'En Lote' no hace nada.
-- El fix de codigo (ocultar el boton en TERMINAC) va en el proximo deploy.
-- ============================================================================

-- ---------- 1) DIAGNOSTICO (solo lectura, correr primero) ----------
SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.EstadoenArea, o.RolloID,
       CASE WHEN EXISTS (
            SELECT 1
            FROM Logistica_Bultos b
            JOIN Ordenes m ON m.OrdenID = b.OrdenID
            WHERE m.NoDocERP = o.NoDocERP
              AND b.UbicacionActual = 'TERMINAC'
              AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
       ) THEN 'SI' ELSE 'NO' END AS MaterialYaRecibido
FROM Ordenes o
WHERE o.AreaID = 'TERMINAC'
  AND o.Estado NOT IN ('Cancelado','CANCELADO')
  AND o.EstadoenArea IN ('En Lote','En Maquina');

-- ---------- 2) CORRECCION ----------
BEGIN TRAN;

-- Objetivos, con su flag de material recibido (misma logica que el check-in:
-- bulto del mismo pedido, no encomienda, parado en TERMINAC)
SELECT o.OrdenID,
       CASE WHEN EXISTS (
            SELECT 1
            FROM Logistica_Bultos b
            JOIN Ordenes m ON m.OrdenID = b.OrdenID
            WHERE m.NoDocERP = o.NoDocERP
              AND b.UbicacionActual = 'TERMINAC'
              AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
       ) THEN 1 ELSE 0 END AS Recibido
INTO #xeuv
FROM Ordenes o
WHERE o.AreaID = 'TERMINAC'
  AND o.Estado NOT IN ('Cancelado','CANCELADO')
  AND o.EstadoenArea IN ('En Lote','En Maquina');

-- Fuera del lote + estado segun corresponda
UPDATE o
SET o.RolloID = NULL, o.Secuencia = NULL, o.MaquinaID = NULL,
    o.Estado       = CASE WHEN x.Recibido = 1 THEN 'Produccion' ELSE 'Pendiente' END,
    o.EstadoenArea = CASE WHEN x.Recibido = 1 THEN 'Material Recibido' ELSE 'Pendiente' END
FROM Ordenes o
JOIN #xeuv x ON x.OrdenID = o.OrdenID;

-- Historial
INSERT INTO dbo.HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
SELECT x.OrdenID,
       CASE WHEN x.Recibido = 1 THEN 'Material Recibido' ELSE 'Pendiente' END,
       GETDATE(), GETDATE(), 'Sistema',
       CASE WHEN x.Recibido = 1
            THEN 'Material impreso recibido en Terminaciones (ajuste: estaba En Lote y el check-in no la tomo)'
            ELSE 'Retirada del lote (ajuste: las XEUV no van en lotes; queda Pendiente para que el check-in la tome al recibir el material)'
       END
FROM #xeuv x;

SELECT @@ROWCOUNT AS FilasHistorial;
DROP TABLE #xeuv;

COMMIT;

-- ---------- 3) VERIFICACION ----------
SELECT CodigoOrden, EstadoenArea, RolloID
FROM Ordenes
WHERE AreaID = 'TERMINAC' AND Estado NOT IN ('Cancelado','CANCELADO')
ORDER BY FechaIngreso DESC;
