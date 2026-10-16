-- =====================================================================================
-- Estampado: la orden hermana SIN bulto propio acompaña a la que lleva el bulto — 01-oct-2026
-- Dos Estampados del mismo pedido (DTF y TPU) trabajan la misma prenda y salen en UN solo bulto,
-- el de la última en aprobarse. La otra quedaba "Pronto" en Estampado para siempre aunque el bulto
-- ya hubiera viajado o llegado (EST-26025 (2/2)), y PRO la seguía esperando.
-- El backend nuevo ya la arrastra al despachar y al recibir; este script regulariza las que
-- quedaron atrás: les pone el mismo estado que la hermana que llevó el bulto.
-- Idempotente (solo toca órdenes de Estampado en "Pronto", sin bultos, con hermana ya despachada).
-- =====================================================================================
SET NOCOUNT ON;

DECLARE @t TABLE (OrdenID INT, EstadoNuevo VARCHAR(50), EstadoGeneral VARCHAR(50), Portadora VARCHAR(60));

INSERT INTO @t (OrdenID, EstadoNuevo, EstadoGeneral, Portadora)
SELECT h.OrdenID, LTRIM(RTRIM(p.EstadoenArea)), LTRIM(RTRIM(p.Estado)), LTRIM(RTRIM(p.CodigoOrden))
FROM dbo.Ordenes h
CROSS APPLY (
    SELECT TOP 1 p.OrdenID, p.EstadoenArea, p.Estado, p.CodigoOrden
    FROM dbo.Ordenes p
    WHERE p.NoDocERP = h.NoDocERP AND p.AreaID = h.AreaID AND p.OrdenID <> h.OrdenID
      AND UPPER(LTRIM(RTRIM(ISNULL(p.Estado, '')))) <> 'CANCELADO'
      AND UPPER(LTRIM(RTRIM(ISNULL(p.EstadoenArea, '')))) IN ('EN TRANSITO', 'RECIBIDO EN DESTINO')
      AND EXISTS (SELECT 1 FROM dbo.Logistica_Bultos b WHERE b.OrdenID = p.OrdenID AND ISNULL(b.Estado, '') <> 'CANCELADO')
    ORDER BY p.OrdenID
) p
WHERE UPPER(LTRIM(RTRIM(h.AreaID))) = 'EST'
  AND h.NoDocERP IS NOT NULL AND LTRIM(RTRIM(CAST(h.NoDocERP AS VARCHAR(50)))) <> ''
  AND UPPER(LTRIM(RTRIM(ISNULL(h.Estado, '')))) <> 'CANCELADO'
  AND UPPER(LTRIM(RTRIM(ISNULL(h.EstadoenArea, '')))) = 'PRONTO'
  AND (h.CodigoOrden IS NULL OR h.CodigoOrden NOT LIKE '%-F%')
  AND NOT EXISTS (SELECT 1 FROM dbo.Logistica_Bultos b WHERE b.OrdenID = h.OrdenID AND ISNULL(b.Estado, '') <> 'CANCELADO');

UPDATE o SET o.EstadoenArea = t.EstadoNuevo, o.Estado = ISNULL(NULLIF(t.EstadoGeneral, ''), o.Estado)
FROM dbo.Ordenes o JOIN @t t ON t.OrdenID = o.OrdenID;

INSERT INTO dbo.HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
SELECT t.OrdenID, t.EstadoNuevo, GETDATE(), GETDATE(), 'Sistema',
       CONCAT('Viajó en el bulto de ', t.Portadora, ' (reparación reparar_estampado_hermana_sin_bulto.sql)')
FROM @t t;

SELECT o.CodigoOrden, t.EstadoNuevo AS EstadoenArea, t.Portadora FROM @t t JOIN dbo.Ordenes o ON o.OrdenID = t.OrdenID;
DECLARE @n INT = (SELECT COUNT(*) FROM @t);
PRINT CONCAT('Estampados sin bulto propio regularizados: ', @n);
