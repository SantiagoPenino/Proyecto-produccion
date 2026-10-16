/* =====================================================================
   Área en la línea del documento: DocumentosContablesDetalle.DcdArea
   ---------------------------------------------------------------------
   EL PROBLEMA: hoy el área de una venta se ADIVINA al leer, parseando el
   prefijo de OrdCodigoOrden (un varchar libre) con un CASE de ~35 opciones
   dentro del reporte. Consecuencias medidas sobre las líneas de venta 2026:
     · 636 líneas (5,5%) no tienen código de orden → caen a "Sin área",
       y pesan $729.714. Son ventas de mostrador de material (telas, DTF)
       que nunca pasaron por una orden de producción.
     · 4.366 de 11.049 líneas con código apuntan a órdenes inexistentes
       ('DTF', 'SUB', 'ven' sueltos): dan área de casualidad, por el prefijo.

   LA SOLUCIÓN: guardar el área EN la línea cuando la línea se crea, con un
   resolvedor único (backend/services/areaLineaService.js) que aplica esta
   cascada:
     1. La ORDEN            → Ordenes.AreaID (la verdad de lo producido)
     2. El ARTÍCULO         → ArticuloClasificacion.AclArea (venta de mostrador)
     3. El PREFIJO del código → compatibilidad con lo viejo
     4. NULL                → queda explícito y auditable, no escondido

   Se guarda también la VARIANTE y el ARTÍCULO resuelto: la línea hoy no sabe
   qué artículo vendió (solo un texto), y por eso los reportes de producto
   tienen que dar la vuelta por PedidosCobranzaDetalle.

   El SECTOR no se guarda: se deriva del área vía dbo.SectorMapeo, así una
   reorganización comercial reagrupa el histórico sin reprocesar nada.

   Aditivo: 3 columnas NULL-ables + backfill. No cambia ningún importe.
   Requiere haber corrido antes add_ArticuloClasificacion.sql.
   Ejecutar en PRODUCCIÓN antes (o junto con) el deploy.
   ===================================================================== */

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='DocumentosContablesDetalle' AND COLUMN_NAME='DcdArea')
BEGIN
    ALTER TABLE dbo.DocumentosContablesDetalle ADD DcdArea NVARCHAR(150) NULL;
    PRINT 'Columna DcdArea agregada.';
END ELSE PRINT 'DcdArea ya existe.';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='DocumentosContablesDetalle' AND COLUMN_NAME='DcdVariante')
BEGIN
    ALTER TABLE dbo.DocumentosContablesDetalle ADD DcdVariante NVARCHAR(200) NULL;
    PRINT 'Columna DcdVariante agregada.';
END ELSE PRINT 'DcdVariante ya existe.';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='DocumentosContablesDetalle' AND COLUMN_NAME='DcdProIdProducto')
BEGIN
    ALTER TABLE dbo.DocumentosContablesDetalle ADD DcdProIdProducto INT NULL;
    PRINT 'Columna DcdProIdProducto agregada.';
END ELSE PRINT 'DcdProIdProducto ya existe.';
GO

/* Índice para los reportes (agrupan y filtran por área) */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DCD_Area' AND object_id = OBJECT_ID('dbo.DocumentosContablesDetalle'))
BEGIN
    CREATE INDEX IX_DCD_Area ON dbo.DocumentosContablesDetalle (DcdArea) INCLUDE (DocIdDocumento, DcdSubtotal);
    PRINT 'Índice IX_DCD_Area creado.';
END ELSE PRINT 'IX_DCD_Area ya existe.';
GO

/* =====================================================================
   BACKFILL — la misma cascada del resolvedor, en orden de confianza.
   Todos los pasos tocan SOLO filas con DcdArea NULL, así que el script es
   re-ejecutable y nunca pisa lo ya resuelto por un paso más confiable.
   ===================================================================== */

/* ── Paso 1: por la ORDEN (Ordenes.AreaID + Variante + artículo) ───────
   La fuente más confiable: es lo que realmente se produjo.               */
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
  AND dcd.OrdCodigoOrden IS NOT NULL AND LTRIM(RTRIM(dcd.OrdCodigoOrden)) <> '';

PRINT CONCAT('Backfill 1 (por la orden): ', @@ROWCOUNT, ' líneas.');
GO

/* ── Paso 2: por el ARTÍCULO ───────────────────────────────────────────
   Para las ventas de mostrador que nunca tuvieron orden. El artículo se
   busca por el texto del ítem, que es lo único que guarda la línea:
   match exacto contra Articulos.Descripcion, y si el ítem viene con
   prefijo de categoría ('Sublimacion Tela - Hexagonal (1,83)') se prueba
   también con lo que va después del primer ' - '.                        */
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
SET dcd.DcdArea = m.AclArea,
    dcd.DcdVariante = ISNULL(dcd.DcdVariante, m.AclVariante),
    dcd.DcdProIdProducto = ISNULL(dcd.DcdProIdProducto, m.ProIdProducto)
FROM dbo.DocumentosContablesDetalle dcd
JOIN Match m ON m.DcdIdDetalle = dcd.DcdIdDetalle AND m.rn = 1
WHERE dcd.DcdArea IS NULL;

PRINT CONCAT('Backfill 2 (por el artículo): ', @@ROWCOUNT, ' líneas.');
GO

/* ── Paso 3: por el PREFIJO del código de orden ────────────────────────
   Compatibilidad con lo viejo: códigos sueltos ('DTF', 'SUB', 'ven') que
   no matchean ninguna orden real pero cuyo prefijo sí identifica el área.  */
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
  AND dcd.OrdCodigoOrden IS NOT NULL AND LTRIM(RTRIM(dcd.OrdCodigoOrden)) <> '';

PRINT CONCAT('Backfill 3 (por el prefijo): ', @@ROWCOUNT, ' líneas.');
GO

/* ── Verificación: cobertura sobre las líneas de VENTA ─────────────────── */
SELECT
    COUNT(*)                                                      AS LineasVenta,
    SUM(CASE WHEN dcd.DcdArea IS NOT NULL THEN 1 ELSE 0 END)      AS ConArea,
    SUM(CASE WHEN dcd.DcdArea IS NULL THEN 1 ELSE 0 END)          AS SinArea,
    CAST(100.0 * SUM(CASE WHEN dcd.DcdArea IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,2)) AS PctCubierto,
    SUM(CASE WHEN dcd.DcdArea IS NULL THEN ISNULL(dcd.DcdSubtotal, 0) ELSE 0 END) AS SubtotalSinArea
FROM dbo.DocumentosContablesDetalle dcd
JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.DocIdDocumento = dcd.DocIdDocumento
WHERE (((doc.DocTipo LIKE '%Factura%' OR doc.DocTipo LIKE '%Ticket%') AND doc.DocTipo NOT LIKE '%Nota%')
        OR RTRIM(doc.DocTipo) = 'Pedidos Caja')
  AND doc.DocEstado <> 'ANULADO';

/* Qué quedó sin área, para auditar */
SELECT TOP 20 LEFT(ISNULL(dcd.DcdNomItem, '(sin nombre)'), 50) AS Item,
       COUNT(*) AS Lineas, SUM(ISNULL(dcd.DcdSubtotal, 0)) AS Subtotal
FROM dbo.DocumentosContablesDetalle dcd
JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.DocIdDocumento = dcd.DocIdDocumento
WHERE dcd.DcdArea IS NULL
  AND (((doc.DocTipo LIKE '%Factura%' OR doc.DocTipo LIKE '%Ticket%') AND doc.DocTipo NOT LIKE '%Nota%')
        OR RTRIM(doc.DocTipo) = 'Pedidos Caja')
  AND doc.DocEstado <> 'ANULADO'
GROUP BY LEFT(ISNULL(dcd.DcdNomItem, '(sin nombre)'), 50)
ORDER BY Lineas DESC;
