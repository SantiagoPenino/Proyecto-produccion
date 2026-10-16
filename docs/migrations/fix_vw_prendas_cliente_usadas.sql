-- vw_PrendasClienteDisponibles: las prendas del cliente usadas por un pedido seguían apareciendo
-- "sin usar" en el portal.
--
-- Antes: usadas = SUMA de ArchivosOrden.Piezas de las órdenes vivas. Fallaba en:
--   · "Comprar y personalizar" con prendas del cliente: la orden de Bordado no carga Piezas
--     (la cantidad va en la nota "[DATOS TÉCNICOS] Prendas: N") → contaba 0 (PRE-191: 30 sin usar
--     aunque BOR-20950 las bordó).
--   · Varios diseños sobre las mismas prendas (logo adelante + espalda): sumaba las prendas dos veces.
--
-- Ahora, por orden viva (no cancelada) que tomó la línea de prendas, la cantidad es la primera que haya:
--   1. el mayor Piezas de sus diseños (las mismas prendas llevan varios diseños)
--   2. CantidadEsperada
--   3. Magnitud (ej. la orden de falla -F que repone N prendas)
--   4. "Prendas: N" de la nota
-- Mismas columnas que antes: no cambia nada para quien la lee.

CREATE OR ALTER VIEW vw_PrendasClienteDisponibles AS
WITH UsoPorOrden AS (
    SELECT o.PrendaClienteID,
           COALESCE(
               NULLIF((SELECT MAX(ISNULL(ao.Piezas, 0)) FROM ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID), 0),
               NULLIF(o.CantidadEsperada, 0),
               NULLIF(TRY_CAST(o.Magnitud AS FLOAT), 0),
               NULLIF(CASE WHEN CHARINDEX('Prendas: ', CAST(o.Nota AS NVARCHAR(MAX))) > 0
                    THEN TRY_CAST(LEFT(SUBSTRING(CAST(o.Nota AS NVARCHAR(MAX)), CHARINDEX('Prendas: ', CAST(o.Nota AS NVARCHAR(MAX))) + 9, 12),
                                       PATINDEX('%[^0-9]%', SUBSTRING(CAST(o.Nota AS NVARCHAR(MAX)), CHARINDEX('Prendas: ', CAST(o.Nota AS NVARCHAR(MAX))) + 9, 12) + 'x') - 1) AS FLOAT)
                    END, 0),
               0) AS Usada
    FROM Ordenes o
    WHERE o.PrendaClienteID IS NOT NULL
      AND ISNULL(o.Estado, '') NOT IN ('Cancelado')
),
Uso AS (
    SELECT PrendaClienteID, SUM(Usada) AS Usada FROM UsoPorOrden GROUP BY PrendaClienteID
)
SELECT
    p.PrendaClienteID,
    p.RecepcionID,
    r.Codigo            AS CodigoRecepcion,
    p.ClienteID,
    p.Descripcion,
    p.Talle,
    p.Color,
    p.Cantidad,
    p.Estado,
    p.FechaIngreso,
    ISNULL(u.Usada, 0)              AS CantidadUsada,
    p.Cantidad - ISNULL(u.Usada, 0) AS CantidadDisponible
FROM InventarioPrendasCliente p
LEFT JOIN Recepciones r ON r.RecepcionID = p.RecepcionID
LEFT JOIN Uso u ON u.PrendaClienteID = p.PrendaClienteID;
GO
