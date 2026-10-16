-- =====================================================================================
-- Regularización (9-oct-2026): reposiciones -F / -R que nacieron SIN heredar los requisitos
-- ya cumplidos de su orden madre y quedaron para siempre en "Esperando requisitos" de
-- Planificación (en Sublimación eran el 100% de esa lista, por el requisito TELA).
--
-- El código ya hereda al crear la hija (requisitosAutoCumplimiento.heredarRequisitosCumplidos,
-- llamado desde productionFileController y cadenaReposicionService). Este script arregla las
-- que ya existen.
--
-- Qué hace: por cada reposición ABIERTA (sin FechaPronto, no Finalizada/Cancelada) con sufijo
-- -F# o -R#, busca la madre (OrdenOrigenID si está, si no la orden con el código raíz) y copia
-- como CUMPLIDO cada requisito bloqueante que la madre tiene CUMPLIDO y la hija no.
-- Si la madre tampoco lo tiene, NO toca nada (queda en el preview marcado para mirar a mano).
--
-- Uso: 1) correr con @area = 'SB' y ROLLBACK, mirar el preview y los controles
--      2) cambiar a COMMIT
--      3) repetir con @area = NULL (todas las áreas) si se quiere generalizar
-- =====================================================================================

DECLARE @area VARCHAR(20) = 'SB';   -- NULL = todas las áreas

IF OBJECT_ID('tempdb..#Heredados') IS NOT NULL DROP TABLE #Heredados;
CREATE TABLE #Heredados (AreaID VARCHAR(20), HijaID INT, Hija NVARCHAR(100), Madre NVARCHAR(100), CodigoRequisito VARCHAR(50));

-- ---------- PREVIEW: qué se va a heredar y qué queda sin resolver ----------
;WITH Hijas AS (
    SELECT o.OrdenID, o.CodigoOrden, o.AreaID, o.OrdenOrigenID,
           LEFT(o.CodigoOrden, PATINDEX('%-[FR][0-9]%', o.CodigoOrden) - 1) AS CodigoRaiz
    FROM dbo.Ordenes o
    WHERE o.FechaPronto IS NULL
      AND ISNULL(o.Estado, '') NOT IN ('Cancelado', 'Finalizado')
      AND PATINDEX('%-[FR][0-9]%', o.CodigoOrden) > 1
      AND (@area IS NULL OR o.AreaID = @area)
),
Madre AS (
    SELECT h.OrdenID AS HijaID, h.CodigoOrden AS Hija, h.AreaID,
           COALESCE(m1.OrdenID, m2.OrdenID)         AS MadreID,
           COALESCE(m1.CodigoOrden, m2.CodigoOrden) AS Madre
    FROM Hijas h
    LEFT JOIN dbo.Ordenes m1 ON m1.OrdenID = h.OrdenOrigenID
    LEFT JOIN dbo.Ordenes m2 ON m2.CodigoOrden = h.CodigoRaiz AND m2.AreaID = h.AreaID
)
SELECT m.AreaID, m.Hija, m.Madre, req.CodigoRequisito,
       cm.Observaciones AS ObsMadre,
       CASE WHEN m.MadreID IS NULL THEN 'SIN MADRE — revisar a mano'
            WHEN cm.CumplimientoID IS NULL THEN 'madre tampoco lo tiene — revisar a mano'
            ELSE 'se hereda' END AS Accion
FROM Madre m
JOIN dbo.ConfigRequisitosProduccion req ON req.AreaID = m.AreaID AND req.EsBloqueante = 1
LEFT JOIN dbo.OrdenCumplimientoRequisitos ch ON ch.OrdenID = m.HijaID  AND ch.RequisitoID = req.RequisitoID AND ch.Estado = 'CUMPLIDO'
LEFT JOIN dbo.OrdenCumplimientoRequisitos cm ON cm.OrdenID = m.MadreID AND cm.RequisitoID = req.RequisitoID AND cm.Estado = 'CUMPLIDO'
WHERE ch.CumplimientoID IS NULL
ORDER BY m.AreaID, m.Hija, req.CodigoRequisito;

-- ---------- CAMBIO ----------
BEGIN TRAN;

;WITH Hijas AS (
    SELECT o.OrdenID, o.CodigoOrden, o.AreaID, o.OrdenOrigenID,
           LEFT(o.CodigoOrden, PATINDEX('%-[FR][0-9]%', o.CodigoOrden) - 1) AS CodigoRaiz
    FROM dbo.Ordenes o
    WHERE o.FechaPronto IS NULL
      AND ISNULL(o.Estado, '') NOT IN ('Cancelado', 'Finalizado')
      AND PATINDEX('%-[FR][0-9]%', o.CodigoOrden) > 1
      AND (@area IS NULL OR o.AreaID = @area)
),
Madre AS (
    SELECT h.OrdenID AS HijaID, h.CodigoOrden AS Hija, h.AreaID,
           COALESCE(m1.OrdenID, m2.OrdenID)         AS MadreID,
           COALESCE(m1.CodigoOrden, m2.CodigoOrden) AS Madre
    FROM Hijas h
    LEFT JOIN dbo.Ordenes m1 ON m1.OrdenID = h.OrdenOrigenID
    LEFT JOIN dbo.Ordenes m2 ON m2.CodigoOrden = h.CodigoRaiz AND m2.AreaID = h.AreaID
)
INSERT INTO dbo.OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
OUTPUT inserted.AreaID, inserted.OrdenID, NULL, NULL, NULL INTO #Heredados (AreaID, HijaID, Hija, Madre, CodigoRequisito)
SELECT m.HijaID, m.AreaID, req.RequisitoID, 'CUMPLIDO', GETDATE(),
       LEFT(N'Heredado de ' + m.Madre + N' (regularización 9-oct-2026: ' + ISNULL(cm.Observaciones, N'') + N')', 300)
FROM Madre m
JOIN dbo.ConfigRequisitosProduccion req ON req.AreaID = m.AreaID AND req.EsBloqueante = 1
LEFT JOIN dbo.OrdenCumplimientoRequisitos ch ON ch.OrdenID = m.HijaID  AND ch.RequisitoID = req.RequisitoID AND ch.Estado = 'CUMPLIDO'
JOIN      dbo.OrdenCumplimientoRequisitos cm ON cm.OrdenID = m.MadreID AND cm.RequisitoID = req.RequisitoID AND cm.Estado = 'CUMPLIDO'
WHERE ch.CumplimientoID IS NULL;

-- Control 1: cuántos requisitos se heredaron, por área
SELECT AreaID, COUNT(*) AS RequisitosHeredados, COUNT(DISTINCT HijaID) AS OrdenesDestrabadas
FROM #Heredados GROUP BY AreaID ORDER BY AreaID;

-- Control 2: qué queda todavía en "Esperando requisitos" en el área (debería ser 0 o solo
--            las marcadas "revisar a mano" en el preview)
SELECT o.AreaID, COUNT(DISTINCT o.OrdenID) AS SiguenBloqueadas
FROM dbo.Ordenes o
JOIN dbo.ConfigRequisitosProduccion req ON req.AreaID = o.AreaID AND req.EsBloqueante = 1
LEFT JOIN dbo.OrdenCumplimientoRequisitos c ON c.OrdenID = o.OrdenID AND c.RequisitoID = req.RequisitoID AND c.Estado = 'CUMPLIDO'
WHERE o.FechaPronto IS NULL AND ISNULL(o.Estado, '') NOT IN ('Cancelado', 'Finalizado')
  AND (@area IS NULL OR o.AreaID = @area)
  AND c.CumplimientoID IS NULL
GROUP BY o.AreaID ORDER BY o.AreaID;

ROLLBACK;   -- primera pasada: mirar preview y controles
-- COMMIT;  -- segunda pasada

DROP TABLE #Heredados;
