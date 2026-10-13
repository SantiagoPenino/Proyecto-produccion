-- Compras migradas del sistema viejo: lo recibido de cada línea y el progreso "recibido" (30/09).
--
-- 1) El sistema viejo no anotaba lo recibido en las líneas de la compra: creaba las etiquetas y
--    al recibir las activaba. Las compras que se recibieron allá quedaron acá con 0 recibido en
--    todas sus líneas, y "Recibir e imprimir etiquetas" las volvería a cargar: stock duplicado.
--    Caso: compra #42 Dalian, 691 etiquetas activas y 0 recibido en sus 13 líneas.
--    Lo recibido se calcula con las etiquetas de la compra (activas o consumidas; las
--    'pendiente_recepcion' del viejo no son stock), con tope en lo pedido. Solo compras migradas
--    sin nada recibido en el sistema nuevo: si alguna ya se recibió acá, no se toca (sale en el
--    control del final).
-- 2) El viejo dejó 'recibido' como progreso de compras con plantilla, donde ese paso tiene su
--    propia clave (en Importaciones "Recibido" es '9'): la línea de tiempo no marcaba ningún paso.
--    Pasa al último paso de su plantilla.
--
-- Se puede correr más de una vez: la segunda no cambia nada.

USE SecureAppDB;
GO

-- ── Antes: qué va a cambiar ─────────────────────────────────────────────────
SELECT
    (SELECT COUNT(*) FROM dbo.Wms_Compras c
      WHERE c.GuidViejo IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM dbo.Wms_ComprasDetalle d WHERE d.CompId = c.CompId AND d.CantidadRecibida > 0)
        AND EXISTS (SELECT 1 FROM dbo.Wms_Etiquetas e WHERE e.CompraId = c.CompId AND e.Estado IN ('activo', 'consumido'))) AS ComprasARecibir,
    (SELECT COUNT(*) FROM dbo.Wms_Compras c
      WHERE c.Progreso = 'recibido'
        AND EXISTS (SELECT 1 FROM dbo.Wms_PlantillasProgresoPasos pp WHERE pp.PlaId = c.PlaId)) AS ProgresosANormalizar;
GO

SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRAN;

    -- 1) Lo recibido de cada línea, repartido en orden si la compra repite la variante
    WITH eti AS (
        SELECT e.CompraId AS CompId, e.VarId, SUM(e.CantidadInicial) AS Recibido
        FROM dbo.Wms_Etiquetas e
        WHERE e.CompraId IS NOT NULL AND e.Estado IN ('activo', 'consumido')
        GROUP BY e.CompraId, e.VarId
    ), lin AS (
        SELECT d.CDetId, d.CompId, d.VarId, d.Cantidad,
               SUM(d.Cantidad) OVER (PARTITION BY d.CompId, d.VarId ORDER BY d.CDetId ROWS UNBOUNDED PRECEDING) - d.Cantidad AS Antes
        FROM dbo.Wms_ComprasDetalle d
        JOIN dbo.Wms_Compras c ON c.CompId = d.CompId
        WHERE c.GuidViejo IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM dbo.Wms_ComprasDetalle x WHERE x.CompId = c.CompId AND x.CantidadRecibida > 0)
    )
    UPDATE d
    SET CantidadRecibida = CASE WHEN eti.Recibido - lin.Antes >= lin.Cantidad THEN lin.Cantidad
                                ELSE eti.Recibido - lin.Antes END
    FROM dbo.Wms_ComprasDetalle d
    JOIN lin ON lin.CDetId = d.CDetId
    JOIN eti ON eti.CompId = lin.CompId AND eti.VarId = lin.VarId
    WHERE eti.Recibido - lin.Antes > 0;

    PRINT CONCAT('Líneas con lo recibido cargado: ', @@ROWCOUNT);

    -- 2) 'recibido' → último paso de su plantilla
    UPDATE c
    SET Progreso = ult.Clave
    FROM dbo.Wms_Compras c
    CROSS APPLY (SELECT TOP 1 pp.Clave FROM dbo.Wms_PlantillasProgresoPasos pp
                 WHERE pp.PlaId = c.PlaId ORDER BY pp.Orden DESC) ult
    WHERE c.Progreso = 'recibido';

    PRINT CONCAT('Compras con el progreso pasado al último paso: ', @@ROWCOUNT);

    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
GO

-- ── Después: cada compra migrada ────────────────────────────────────────────
SELECT c.CompId, pr.Nombre AS Proveedor, c.ReferenciaFactura, c.Progreso, pas.Etiqueta AS PasoActual,
       (SELECT COUNT(*) FROM dbo.Wms_ComprasDetalle d WHERE d.CompId = c.CompId) AS Lineas,
       (SELECT COUNT(*) FROM dbo.Wms_ComprasDetalle d WHERE d.CompId = c.CompId AND d.CantidadRecibida < d.Cantidad - 0.0001) AS LineasPendientes,
       (SELECT COUNT(*) FROM dbo.Wms_Etiquetas e WHERE e.CompraId = c.CompId AND e.Estado = 'pendiente_recepcion') AS EtiquetasViejasSinRecibir
FROM dbo.Wms_Compras c
LEFT JOIN dbo.Wms_Proveedores pr ON pr.PrvId = c.PrvId
LEFT JOIN dbo.Wms_PlantillasProgresoPasos pas ON pas.PlaId = c.PlaId AND pas.Clave = c.Progreso
WHERE c.GuidViejo IS NOT NULL
ORDER BY c.CompId;
GO

-- ── Control: compras migradas que además se recibieron en el sistema nuevo ──
-- Si sale alguna, se cargó dos veces: lo que entró allá y lo que entró acá. Va vacío si nadie
-- tocó "Recibir" en una compra que ya estaba recibida en el viejo.
SELECT x.CompId, x.Proveedor, x.ReferenciaFactura, x.RecibidoEnViejo, x.RecibidoEnNuevo
FROM (
    SELECT c.CompId, pr.Nombre AS Proveedor, c.ReferenciaFactura,
           (SELECT SUM(e.CantidadInicial) FROM dbo.Wms_Etiquetas e
             WHERE e.CompraId = c.CompId AND e.Estado IN ('activo', 'consumido')
               AND NOT EXISTS (SELECT 1 FROM dbo.Wms_Movimientos m WHERE m.EtiId = e.EtiId AND m.Tipo IN ('ingreso_compra', 'ingreso'))) AS RecibidoEnViejo,
           (SELECT SUM(e.CantidadInicial) FROM dbo.Wms_Etiquetas e
             WHERE e.CompraId = c.CompId
               AND EXISTS (SELECT 1 FROM dbo.Wms_Movimientos m WHERE m.EtiId = e.EtiId AND m.Tipo IN ('ingreso_compra', 'ingreso'))) AS RecibidoEnNuevo
    FROM dbo.Wms_Compras c
    LEFT JOIN dbo.Wms_Proveedores pr ON pr.PrvId = c.PrvId
    WHERE c.GuidViejo IS NOT NULL
) x
WHERE x.RecibidoEnViejo > 0 AND x.RecibidoEnNuevo > 0;
GO
