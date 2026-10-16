-- =====================================================================================
-- Línea fantasma de Impresión Directa / Gran formato en pedidos de producto terminado (30-sep-2026)
-- Al crear un pedido "Fabricar a medida" con producto del catálogo cuya producción principal es
-- DIRECTA o ECOUV, el creador (prendasOrdersController) insertaba en ServiciosExtraOrden una línea
-- "Impresión Directa 3.20 - Tela…" con el MISMO artículo que el archivo de impresión. Esa línea:
--   · en Control aparecía como un segundo ítem a controlar (progreso 2/2, copias contadas dos veces)
--   · en la cotización por área duplicaba el cobro de la impresión (el archivo ya se cotiza solo).
-- Sublimación ya estaba excluida; el código ahora excluye también DIRECTA y ECOUV.
-- Este script borra las líneas ya creadas. Idempotente: solo borra lo que cumple la condición.
-- Vista previa primero; el DELETE está al final.
-- =====================================================================================
SET NOCOUNT ON;

SELECT O.OrdenID, O.CodigoOrden, O.AreaID, S.ServicioID, S.Descripcion, S.Cantidad, S.PrecioUnitario, S.Estado, S.Observacion
FROM dbo.ServiciosExtraOrden S
JOIN dbo.Ordenes O ON O.OrdenID = S.OrdenID
WHERE O.AreaID IN ('DIRECTA', 'ECOUV')
  AND S.Observacion = 'Generado desde WebOrder'
  AND EXISTS (SELECT 1 FROM dbo.ArchivosOrden A
              WHERE A.OrdenID = O.OrdenID AND LTRIM(RTRIM(A.CodigoArticulo)) = LTRIM(RTRIM(S.CodArt)))
ORDER BY O.OrdenID;

DELETE S
FROM dbo.ServiciosExtraOrden S
JOIN dbo.Ordenes O ON O.OrdenID = S.OrdenID
WHERE O.AreaID IN ('DIRECTA', 'ECOUV')
  AND S.Observacion = 'Generado desde WebOrder'
  AND EXISTS (SELECT 1 FROM dbo.ArchivosOrden A
              WHERE A.OrdenID = O.OrdenID AND LTRIM(RTRIM(A.CodigoArticulo)) = LTRIM(RTRIM(S.CodArt)));

PRINT CONCAT('Líneas fantasma borradas: ', @@ROWCOUNT);
