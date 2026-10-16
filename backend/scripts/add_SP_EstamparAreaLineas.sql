/* =====================================================================
   SP_EstamparAreaLineasDocumento — pone el área en las líneas de un documento
   ---------------------------------------------------------------------
   POR QUÉ UN SP Y NO TOCAR CADA INSERT: las líneas de documentos nacen en
   ~11 lugares distintos del backend (cajaController ×8, cajaService,
   contabilidadCore, cfeController), cada uno con su forma de INSERT (VALUES,
   SELECT masivo, dentro de bucles, con y sin transacción). Meter la
   resolución de área en cada uno multiplicaría el riesgo y las variantes a
   mantener. En cambio esto se llama UNA vez, después de que las líneas ya
   están escritas, y resuelve todas las que falten.

   Aplica la MISMA cascada que el backfill de add_DcdArea.sql:
     1. La ORDEN   → Ordenes.AreaID (+ variante + artículo)
     2. El ARTÍCULO → ArticuloClasificacion (por texto del ítem)
     3. El PREFIJO  → compatibilidad con códigos sueltos
   Solo toca filas con DcdArea NULL: es idempotente y no pisa nada resuelto.

   @DocIdDocumento NULL = procesa TODAS las líneas sin área (uso de
   mantenimiento/backfill). Con un id = solo ese documento (uso normal).

   Ejecutar en PRODUCCIÓN junto con add_DcdArea.sql, antes del deploy.
   ===================================================================== */

IF OBJECT_ID('dbo.SP_EstamparAreaLineasDocumento', 'P') IS NOT NULL
    DROP PROCEDURE dbo.SP_EstamparAreaLineasDocumento;
GO

CREATE PROCEDURE dbo.SP_EstamparAreaLineasDocumento
    @DocIdDocumento INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    /* ── 1. Por la ORDEN ───────────────────────────────────────────── */
    UPDATE dcd
    SET dcd.DcdArea = CASE UPPER(LTRIM(RTRIM(o.AreaID)))
            WHEN 'DF'              THEN 'DTF'
            WHEN 'SB'              THEN 'Sublimacion'
            WHEN 'ECOUV'           THEN 'ECOUV'
            WHEN 'TERMINAC'        THEN 'ECOUV'
            WHEN 'DIRECTA'         THEN 'IMPRESION DIRECTA'
            WHEN 'DIRECTA-ALGODON' THEN 'IMPRESION DIRECTA'
            WHEN 'EMB'             THEN 'Bordado'
            WHEN 'EST'             THEN 'Estampado'
            WHEN 'TWC'             THEN 'Corte'
            WHEN 'TWT'             THEN 'Costura'
            WHEN 'TPU'             THEN 'TPU'
            WHEN 'PRO'             THEN 'Productos Confeccionados'
            ELSE NULL END,
        dcd.DcdVariante      = NULLIF(LTRIM(RTRIM(CAST(o.Variante AS NVARCHAR(200)))), ''),
        dcd.DcdProIdProducto = o.ProIdProducto
    FROM dbo.DocumentosContablesDetalle dcd
    JOIN dbo.Ordenes o WITH(NOLOCK)
      ON o.CodigoOrden = LEFT(dcd.OrdCodigoOrden,
           CASE WHEN CHARINDEX(' ', dcd.OrdCodigoOrden) > 0 THEN CHARINDEX(' ', dcd.OrdCodigoOrden) - 1
                ELSE LEN(dcd.OrdCodigoOrden) END)
    WHERE dcd.DcdArea IS NULL
      AND dcd.OrdCodigoOrden IS NOT NULL AND LTRIM(RTRIM(dcd.OrdCodigoOrden)) <> ''
      AND (@DocIdDocumento IS NULL OR dcd.DocIdDocumento = @DocIdDocumento);

    /* ── 2. Por el ARTÍCULO (ventas de mostrador, sin orden) ───────── */
    ;WITH LineasSinArea AS (
        SELECT dcd.DcdIdDetalle,
               LTRIM(RTRIM(dcd.DcdNomItem)) AS Item,
               LTRIM(RTRIM(
                   CASE WHEN CHARINDEX(' - ', dcd.DcdNomItem) > 0
                        THEN SUBSTRING(dcd.DcdNomItem, CHARINDEX(' - ', dcd.DcdNomItem) + 3, 400)
                        ELSE dcd.DcdNomItem END
               )) AS ItemSinPrefijo
        FROM dbo.DocumentosContablesDetalle dcd
        WHERE dcd.DcdArea IS NULL AND dcd.DcdNomItem IS NOT NULL
          AND (@DocIdDocumento IS NULL OR dcd.DocIdDocumento = @DocIdDocumento)
    ),
    Match AS (
        SELECT l.DcdIdDetalle, a.ProIdProducto, c.AclArea, c.AclVariante,
               ROW_NUMBER() OVER (PARTITION BY l.DcdIdDetalle ORDER BY a.ProIdProducto) AS rn
        FROM LineasSinArea l
        JOIN dbo.Articulos a WITH(NOLOCK)
          ON LTRIM(RTRIM(a.Descripcion)) = l.Item
          OR LTRIM(RTRIM(a.Descripcion)) = l.ItemSinPrefijo
        JOIN dbo.ArticuloClasificacion c WITH(NOLOCK) ON c.ProIdProducto = a.ProIdProducto
        WHERE c.AclArea IS NOT NULL
    )
    UPDATE dcd
    SET dcd.DcdArea          = m.AclArea,
        dcd.DcdVariante      = ISNULL(dcd.DcdVariante, m.AclVariante),
        dcd.DcdProIdProducto = ISNULL(dcd.DcdProIdProducto, m.ProIdProducto)
    FROM dbo.DocumentosContablesDetalle dcd
    JOIN Match m ON m.DcdIdDetalle = dcd.DcdIdDetalle AND m.rn = 1
    WHERE dcd.DcdArea IS NULL;

    /* ── 3. Por el PREFIJO del código ──────────────────────────────── */
    UPDATE dcd
    SET dcd.DcdArea = CASE UPPER(LTRIM(RTRIM(
            LEFT(dcd.OrdCodigoOrden,
                 CASE WHEN CHARINDEX('-', dcd.OrdCodigoOrden) > 0 THEN CHARINDEX('-', dcd.OrdCodigoOrden) - 1
                      ELSE LEN(dcd.OrdCodigoOrden) END))))
        WHEN 'DF' THEN 'DTF' WHEN 'DTF' THEN 'DTF' WHEN 'UVDF' THEN 'DTF' WHEN 'RDF' THEN 'DTF'
        WHEN 'RUVDF' THEN 'DTF' WHEN 'RRDF' THEN 'DTF' WHEN 'RRUVDF' THEN 'DTF'
        WHEN 'SB' THEN 'Sublimacion' WHEN 'SUB' THEN 'Sublimacion' WHEN 'XSB' THEN 'Sublimacion'
        WHEN 'RSB' THEN 'Sublimacion' WHEN 'RXSB' THEN 'Sublimacion'
        WHEN 'ECOUV' THEN 'ECOUV' WHEN 'EUV' THEN 'ECOUV' WHEN 'XECOUV' THEN 'ECOUV'
        WHEN 'RECOUV' THEN 'ECOUV' WHEN 'RXECOUV' THEN 'ECOUV'
        WHEN 'DIR' THEN 'IMPRESION DIRECTA' WHEN 'DIRECTA' THEN 'IMPRESION DIRECTA'
        WHEN 'IMD' THEN 'IMPRESION DIRECTA' WHEN 'XIMD' THEN 'IMPRESION DIRECTA'
        WHEN 'RIMD' THEN 'IMPRESION DIRECTA' WHEN 'RXIMD' THEN 'IMPRESION DIRECTA'
        WHEN 'EMB' THEN 'Bordado' WHEN 'BOR' THEN 'Bordado'
        WHEN 'TWC' THEN 'Corte' WHEN 'COR' THEN 'Corte'
        WHEN 'COS' THEN 'Costura' WHEN 'TWT' THEN 'Costura'
        WHEN 'DIS' THEN 'Diseño' WHEN 'TWD' THEN 'Diseño'
        WHEN 'TPU' THEN 'TPU' WHEN 'TP' THEN 'TPU'
        WHEN 'EST' THEN 'Estampado'
        WHEN 'PRO' THEN 'Productos Confeccionados'
        WHEN 'VEN' THEN 'Venta Directa'
        ELSE NULL END
    FROM dbo.DocumentosContablesDetalle dcd
    WHERE dcd.DcdArea IS NULL
      AND dcd.OrdCodigoOrden IS NOT NULL AND LTRIM(RTRIM(dcd.OrdCodigoOrden)) <> ''
      AND (@DocIdDocumento IS NULL OR dcd.DocIdDocumento = @DocIdDocumento);
END
GO

PRINT 'SP_EstamparAreaLineasDocumento creado.';
