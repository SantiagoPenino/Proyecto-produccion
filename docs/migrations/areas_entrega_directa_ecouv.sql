-- =====================================================================================
-- Impresión Directa / Gran formato entregan TELA (30-sep-2026)
-- El auto-cumplimiento del requisito "Tela para Corte" (TWC) al hacer check-in del bulto mira
-- Areas.Entrega del área de origen del remito. SB tiene 'TELA'; DIRECTA y ECOUV estaban en NULL,
-- así que la tela impresa llegaba a Corte y el requisito quedaba "Pendiente" (bloqueante) para
-- siempre. El código además tenía un fallback solo para SB (ya corregido).
-- 1) Configura Entrega = 'TELA' para DIRECTA y ECOUV.
-- 2) Repara lo ya recibido: órdenes de TWC con requisito TELA pendiente cuyo bulto de origen
--    (LiberaCuandoOrdenID, área DIRECTA/ECOUV) ya está EN_STOCK en TWC → CUMPLIDO.
-- Idempotente.
-- =====================================================================================
SET NOCOUNT ON;

UPDATE dbo.Areas SET Entrega = 'TELA'
WHERE LTRIM(RTRIM(AreaID)) IN ('DIRECTA', 'ECOUV') AND (Entrega IS NULL OR LTRIM(RTRIM(Entrega)) = '');
PRINT CONCAT('Areas.Entrega = TELA aplicado a: ', @@ROWCOUNT, ' área(s)');

-- Vista previa de la reparación
SELECT o.OrdenID, o.CodigoOrden, o.AreaID, org.CodigoOrden AS Origen, org.AreaID AS AreaOrigen,
       (SELECT COUNT(*) FROM dbo.Logistica_Bultos lb WHERE lb.OrdenID = org.OrdenID AND lb.UbicacionActual = o.AreaID AND lb.Estado = 'EN_STOCK') AS BultosEnArea
FROM dbo.Ordenes o
JOIN dbo.Ordenes org ON org.OrdenID = o.LiberaCuandoOrdenID
WHERE o.AreaID = 'TWC' AND org.AreaID IN ('DIRECTA', 'ECOUV')
  AND o.Estado NOT IN ('CANCELADO', 'Finalizado', 'Entregado')
  AND EXISTS (SELECT 1 FROM dbo.Logistica_Bultos lb WHERE lb.OrdenID = org.OrdenID AND lb.UbicacionActual = o.AreaID AND lb.Estado = 'EN_STOCK')
  AND NOT EXISTS (SELECT 1 FROM dbo.OrdenCumplimientoRequisitos c
                  JOIN dbo.ConfigRequisitosProduccion r ON r.RequisitoID = c.RequisitoID
                  WHERE c.OrdenID = o.OrdenID AND r.AreaID = 'TWC' AND r.CodigoRequisito = 'TELA' AND c.Estado = 'CUMPLIDO');

MERGE dbo.OrdenCumplimientoRequisitos AS target
USING (
    SELECT o.OrdenID, r.AreaID, r.RequisitoID,
           CONCAT('Recibido en TWC desde ', LTRIM(RTRIM(org.AreaID)), ' (', LTRIM(RTRIM(org.CodigoOrden)), ') — reparación areas_entrega_directa_ecouv.sql') AS Obs
    FROM dbo.Ordenes o
    JOIN dbo.Ordenes org ON org.OrdenID = o.LiberaCuandoOrdenID
    JOIN dbo.ConfigRequisitosProduccion r ON r.AreaID = 'TWC' AND r.CodigoRequisito = 'TELA'
    WHERE o.AreaID = 'TWC' AND org.AreaID IN ('DIRECTA', 'ECOUV')
      AND o.Estado NOT IN ('CANCELADO', 'Finalizado', 'Entregado')
      AND EXISTS (SELECT 1 FROM dbo.Logistica_Bultos lb WHERE lb.OrdenID = org.OrdenID AND lb.UbicacionActual = o.AreaID AND lb.Estado = 'EN_STOCK')
) AS source
ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
WHEN MATCHED AND target.Estado <> 'CUMPLIDO' THEN
    UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE(), Observaciones = source.Obs
WHEN NOT MATCHED THEN
    INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
    VALUES (source.OrdenID, source.AreaID, source.RequisitoID, 'CUMPLIDO', GETDATE(), source.Obs);
PRINT CONCAT('Requisitos TELA de Corte reparados: ', @@ROWCOUNT);
