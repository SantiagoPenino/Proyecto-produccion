-- =====================================================================
-- FIX: Magnitud contaminada con cantidades de servicios (29/07/2026)
--
-- PROBLEMA: al recalcular la magnitud de una orden se sumaban los METROS
-- de impresión + la CANTIDAD de los servicios extra (terminaciones:
-- ojales, soldaduras...). Ej. EUV-8101: 3,32 m² + 11 ojales = "14,32 m²".
-- El motor de precios cotiza el material por esa cifra → el material se
-- cobraba 4× de más. Los servicios YA se cobran en su propia línea.
--
-- Código corregido (van en el mismo deploy):
--   backend/controllers/ordersController.js      (recalculateOrderMagnitude)
--   backend/services/fileProcessingService.js    (recálculo tras medir)
--   backend/controllers/ecoUvFinishingController.js (updateExtraItem)
--   backend/services/erpSyncService.js           (blindaje al cotizar)
--
-- Este script NO cambia esquema: solo repara datos ya guardados.
-- Correr los PASOS 1 y 3 (diagnóstico) antes y después del PASO 2.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — DIAGNÓSTICO: órdenes cuya Magnitud supera los metros reales
-- ---------------------------------------------------------------------
SELECT O.OrdenID, LTRIM(RTRIM(O.CodigoOrden)) AS CodigoOrden, O.AreaID,
       LTRIM(RTRIM(O.UM)) AS UM,
       O.Magnitud                        AS MagnitudGuardada,
       A.Metros                          AS MetrosReales,
       S.Cant                            AS CantidadServicios,
       O.Estado, O.FechaIngreso
FROM Ordenes O
CROSS APPLY (SELECT ISNULL(SUM(ISNULL(Metros,0) * ISNULL(Copias,1)), 0) AS Metros
             FROM ArchivosOrden
             WHERE OrdenID = O.OrdenID AND ISNULL(EstadoArchivo,'') <> 'CANCELADO') A
CROSS APPLY (SELECT ISNULL(SUM(Cantidad), 0) AS Cant
             FROM ServiciosExtraOrden WHERE OrdenID = O.OrdenID) S
WHERE LEFT(LOWER(LTRIM(RTRIM(ISNULL(O.UM,'u')))), 1) = 'm'   -- solo órdenes por metros/m²
  AND S.Cant > 0                                              -- que tienen servicios
  AND A.Metros > 0                                            -- y archivos de impresión
  AND TRY_CAST(O.Magnitud AS FLOAT) > A.Metros + 0.01         -- magnitud inflada
ORDER BY O.FechaIngreso DESC;
GO

-- ---------------------------------------------------------------------
-- PASO 2 — CORRECCIÓN de la Magnitud (deja los metros reales)
-- Reversible: la magnitud correcta siempre se puede recalcular de los archivos.
-- ---------------------------------------------------------------------
UPDATE O
SET Magnitud = CAST(FORMAT(A.Metros, '0.##') AS NVARCHAR(20))
FROM Ordenes O
CROSS APPLY (SELECT ISNULL(SUM(ISNULL(Metros,0) * ISNULL(Copias,1)), 0) AS Metros
             FROM ArchivosOrden
             WHERE OrdenID = O.OrdenID AND ISNULL(EstadoArchivo,'') <> 'CANCELADO') A
CROSS APPLY (SELECT ISNULL(SUM(Cantidad), 0) AS Cant
             FROM ServiciosExtraOrden WHERE OrdenID = O.OrdenID) S
WHERE LEFT(LOWER(LTRIM(RTRIM(ISNULL(O.UM,'u')))), 1) = 'm'
  AND S.Cant > 0
  AND A.Metros > 0
  AND TRY_CAST(O.Magnitud AS FLOAT) > A.Metros + 0.01;

PRINT CONCAT('Ordenes con magnitud corregida: ', @@ROWCOUNT);
GO

-- ---------------------------------------------------------------------
-- PASO 3 — REVISIÓN MANUAL: líneas de cotización que quedaron con la
-- cantidad inflada. NO se tocan automáticamente: si el documento ya se
-- facturó, corregir la línea desincroniza la factura emitida.
-- Revisar una por una: si NO está facturada, recotizar desde
-- "Cotizar Productos" (Recargar Precios) regenera la línea correcta.
-- ---------------------------------------------------------------------
SELECT PC.NoDocERP, LTRIM(RTRIM(O.CodigoOrden)) AS CodigoOrden,
       PCD.CodArticulo, PCD.Cantidad AS CantidadCotizada,
       A.Metros AS MetrosReales,
       PCD.PrecioUnitario, PCD.Subtotal, PCD.Moneda,
       PC.EstadoCobro
FROM PedidosCobranzaDetalle PCD
JOIN PedidosCobranza PC ON PC.ID = PCD.PedidoCobranzaID
JOIN Ordenes O ON O.OrdenID = PCD.OrdenID
CROSS APPLY (SELECT ISNULL(SUM(ISNULL(Metros,0) * ISNULL(Copias,1)), 0) AS Metros
             FROM ArchivosOrden
             WHERE OrdenID = O.OrdenID AND ISNULL(EstadoArchivo,'') <> 'CANCELADO') A
WHERE LEFT(LOWER(LTRIM(RTRIM(ISNULL(O.UM,'u')))), 1) = 'm'
  AND A.Metros > 0
  AND PCD.Cantidad > A.Metros + 0.01
  AND EXISTS (SELECT 1 FROM ServiciosExtraOrden S WHERE S.OrdenID = O.OrdenID)
  -- Excluir las líneas que SON servicios (ojales, soldaduras): esas se cobran por
  -- unidad y su cantidad mayor a los metros es correcta. Solo interesa la línea
  -- del MATERIAL impreso, que debe ir por los metros.
  AND NOT EXISTS (
      SELECT 1 FROM ServiciosExtraOrden S2
      WHERE S2.OrdenID = O.OrdenID
        AND LTRIM(RTRIM(S2.CodArt)) = LTRIM(RTRIM(PCD.CodArticulo))
  )
ORDER BY PC.NoDocERP DESC;
GO
