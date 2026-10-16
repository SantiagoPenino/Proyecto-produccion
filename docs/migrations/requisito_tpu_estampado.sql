-- =====================================================================================
-- Requisito "TPU a Estampar" en Estampado (EST) — 01-oct-2026
-- Estampado tenía solo dos requisitos: PRENDA ("Prendas a Estampar") y DTF ("DTF a Estampar").
-- Un Estampado que estampa TPU mostraba "DTF a Estampar — No aplica" y nada que dijera TPU
-- (EST-26025 (2/2)). El código ya contemplaba el código de requisito 'TPU' (al crear el pedido
-- marca "no aplica" los canales que no corresponden y la recepción del remito cumple el requisito
-- cuyo código coincide con Areas.Entrega del área de origen: TPU -> 'TPU'); faltaba la fila.
--
-- Reparación: el requisito es bloqueante, así que a las órdenes de Estampado que YA existen se les
-- deja resuelto, salvo al único caso que de verdad lo espera: Estampado ABIERTO, encadenado a una
-- orden TPU cuyo transfer todavía no se recibió en Estampado.
-- De paso corrige el texto "Prendas a Etampar".
--
-- ¡ORDEN DE DEPLOY! Correr este script DESPUÉS de desplegar el backend. Con el backend viejo la
-- llegada del TPU cumple "DTF a Estampar" (lo trataba como DTF) y este requisito nuevo no lo cumpliría
-- nadie: los Estampados de TPU quedarían trabados. El backend nuevo cumple "TPU a Estampar" cuando el
-- requisito existe y, mientras no exista, sigue comportándose como antes.
-- Idempotente.
-- =====================================================================================
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.ConfigRequisitosProduccion WHERE AreaID = 'EST' AND CodigoRequisito = 'TPU')
BEGIN
    INSERT INTO dbo.ConfigRequisitosProduccion (AreaID, CodigoRequisito, Descripcion, EsBloqueante)
    VALUES ('EST', 'TPU', 'TPU a Estampar', 1);
    PRINT 'Requisito EST/TPU creado.';
END
ELSE PRINT 'Requisito EST/TPU ya existía.';

UPDATE dbo.ConfigRequisitosProduccion SET Descripcion = 'Prendas a Estampar'
WHERE AreaID = 'EST' AND CodigoRequisito = 'PRENDA' AND Descripcion = 'Prendas a Etampar';
PRINT CONCAT('Texto "Prendas a Estampar" corregido en: ', @@ROWCOUNT, ' fila(s)');

DECLARE @Req INT = (SELECT TOP 1 RequisitoID FROM dbo.ConfigRequisitosProduccion WHERE AreaID = 'EST' AND CodigoRequisito = 'TPU');

INSERT INTO dbo.OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
SELECT o.OrdenID, 'EST', @Req, 'CUMPLIDO', GETDATE(),
       CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(f.AreaID, '')))) = 'TPU'
                THEN 'TPU ya recibido u orden ya cerrada (reparación requisito_tpu_estampado.sql)'
            WHEN UPPER(LTRIM(RTRIM(ISNULL(f.AreaID, '')))) IN ('DF', 'DTF')
                THEN 'No aplica — el canal real de este Estampado es DTF'
            ELSE 'Orden anterior al requisito TPU (reparación requisito_tpu_estampado.sql)' END
FROM dbo.Ordenes o
LEFT JOIN dbo.Ordenes f ON f.OrdenID = o.LiberaCuandoOrdenID
WHERE LTRIM(RTRIM(o.AreaID)) = 'EST'
  AND NOT EXISTS (SELECT 1 FROM dbo.OrdenCumplimientoRequisitos c WHERE c.OrdenID = o.OrdenID AND c.RequisitoID = @Req)
  -- queda PENDIENTE solo el Estampado abierto cuyo transfer TPU todavía no llegó a Estampado
  AND NOT (
        UPPER(LTRIM(RTRIM(ISNULL(f.AreaID, '')))) = 'TPU'
        AND ISNULL(o.Estado, '') NOT IN ('Cancelado', 'CANCELADO', 'Finalizado', 'Entregado', 'Pronto')
        AND ISNULL(o.EstadoenArea, '') NOT IN ('Pronto', 'Recibido en Destino', 'En transito')
        AND NOT EXISTS (SELECT 1 FROM dbo.Logistica_Bultos lb
                        WHERE lb.OrdenID = f.OrdenID AND lb.UbicacionActual = 'EST' AND lb.Estado = 'EN_STOCK')
  );
PRINT CONCAT('Requisito TPU resuelto en: ', @@ROWCOUNT, ' orden(es) de Estampado ya existentes');
