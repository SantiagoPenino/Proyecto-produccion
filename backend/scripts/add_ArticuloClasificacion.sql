/* =====================================================================
   Clasificación del catálogo de artículos: Sector → Área → Variante → Artículo
   ---------------------------------------------------------------------
   POR QUÉ: hoy el área de una venta se adivina del código de orden, y las
   ventas de mostrador (sin orden) caen a "Sin área" — 636 líneas y $729.714
   solo en 2026. Si el ARTÍCULO sabe a qué área y variante pertenece, esas
   ventas heredan su clasificación aunque nunca hayan pasado por producción.

   Se guarda Área + Variante; el SECTOR se deriva del área vía dbo.SectorMapeo
   (add_Sectores_Comerciales.sql), así una reorganización comercial no obliga a
   reclasificar el catálogo.

   Área usa la nomenclatura de los reportes ('DTF', 'Sublimacion', 'Corte'...),
   la misma clave que SectorMapeo, no los AreaID de dbo.Areas.

   El seed automático sale de la EVIDENCIA de uso: la rama (área, variante) en
   la que más veces se usó cada artículo en órdenes reales. Verificado sobre la
   base: de los 71 artículos con uso, 69 aparecen siempre en la misma rama.
   Los que no tienen uso quedan sin clasificar y se cargan desde la pantalla.

   Aditivo: una tabla nueva. Ejecutar en PRODUCCIÓN antes (o junto con) el deploy.
   ===================================================================== */

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='ArticuloClasificacion')
BEGIN
    CREATE TABLE dbo.ArticuloClasificacion (
        ProIdProducto  INT           NOT NULL PRIMARY KEY,
        AclArea        NVARCHAR(150) NULL,   -- 'DTF', 'Sublimacion', ... (clave de SectorMapeo)
        AclVariante    NVARCHAR(200) NULL,   -- 'DTF Textil', 'Sublimacion Tela', ...
        AclOrigen      VARCHAR(20)   NOT NULL DEFAULT 'MANUAL', -- 'USO' (sembrado) | 'MANUAL'
        AclFecha       DATETIME      NOT NULL DEFAULT GETDATE(),
        AclUsuarioId   INT           NULL
    );
    PRINT 'Tabla ArticuloClasificacion creada.';
END
ELSE PRINT 'La tabla ArticuloClasificacion ya existe.';
GO

/* ── Seed por evidencia de uso ──────────────────────────────────────────
   Para cada artículo, la rama (AreaID + Variante) donde más órdenes tuvo.
   Solo inserta los que todavía no están clasificados → re-ejecutable y NO
   pisa lo que se haya corregido a mano.
   El AreaID de dbo.Ordenes se traduce a la nomenclatura de los reportes.  */
;WITH UsoPorRama AS (
    SELECT o.ProIdProducto,
           o.AreaID,
           LTRIM(RTRIM(ISNULL(CAST(o.Variante AS NVARCHAR(200)), ''))) AS Variante,
           COUNT(*) AS N,
           ROW_NUMBER() OVER (
               PARTITION BY o.ProIdProducto
               ORDER BY COUNT(*) DESC, MAX(o.OrdenID) DESC
           ) AS rn
    FROM dbo.Ordenes AS o WITH(NOLOCK)
    WHERE o.ProIdProducto IS NOT NULL
    GROUP BY o.ProIdProducto, o.AreaID, LTRIM(RTRIM(ISNULL(CAST(o.Variante AS NVARCHAR(200)), '')))
)
INSERT INTO dbo.ArticuloClasificacion (ProIdProducto, AclArea, AclVariante, AclOrigen)
SELECT u.ProIdProducto,
       CASE UPPER(LTRIM(RTRIM(u.AreaID)))
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
           ELSE NULL
       END,
       NULLIF(u.Variante, ''),
       'USO'
FROM UsoPorRama u
WHERE u.rn = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.ArticuloClasificacion c WHERE c.ProIdProducto = u.ProIdProducto);

PRINT CONCAT('Seed 1 (por uso real): ', @@ROWCOUNT, ' artículos clasificados.');
GO

/* ── Seed 2: por el GRUPO del artículo (dbo.ConfigMapeoERP) ────────────
   El sistema YA tiene esta clasificación: ConfigMapeoERP mapea el grupo del
   artículo (1.1, 1.2, ...) a un nombre de área, y usa exactamente la misma
   nomenclatura que los reportes ('Sublimacion', 'DTF', 'ECOUV', 'Bordado',
   'Estampado', 'Corte', 'Costura', 'TPU', 'IMPRESION DIRECTA', 'Diseño',
   'Productos Confeccionados'). Es la fuente de la pantalla Catálogo y WMS.

   Cubre los artículos que nunca se usaron en una orden (los que el seed 1 no
   puede alcanzar). Sin variante: el grupo no la conoce, se completa a mano o
   la hereda del uso cuando el artículo se empiece a usar.
   Solo toca artículos sin área asignada → no pisa el seed 1 ni lo manual.   */
INSERT INTO dbo.ArticuloClasificacion (ProIdProducto, AclArea, AclVariante, AclOrigen)
SELECT a.ProIdProducto, LTRIM(RTRIM(m.NombreReferencia)), NULL, 'GRUPO'
FROM dbo.Articulos a WITH(NOLOCK)
JOIN dbo.ConfigMapeoERP m WITH(NOLOCK) ON m.CodigoERP = a.Grupo COLLATE Database_Default
WHERE LTRIM(RTRIM(ISNULL(m.NombreReferencia, ''))) <> ''
  AND NOT EXISTS (SELECT 1 FROM dbo.ArticuloClasificacion c WHERE c.ProIdProducto = a.ProIdProducto);

PRINT CONCAT('Seed 2 (por grupo ConfigMapeoERP): ', @@ROWCOUNT, ' artículos clasificados.');

/* Completa el área de los que ya existían sin área (ej. quedaron de un seed 1
   con AreaID no mapeable) usando el grupo. */
UPDATE c
SET c.AclArea = LTRIM(RTRIM(m.NombreReferencia)), c.AclOrigen = 'GRUPO'
FROM dbo.ArticuloClasificacion c
JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = c.ProIdProducto
JOIN dbo.ConfigMapeoERP m WITH(NOLOCK) ON m.CodigoERP = a.Grupo COLLATE Database_Default
WHERE c.AclArea IS NULL AND LTRIM(RTRIM(ISNULL(m.NombreReferencia, ''))) <> '';

PRINT CONCAT('Seed 2b (completó área faltante): ', @@ROWCOUNT, ' artículos.');
GO

/* ── Seed 3: grupo 2.1 ("Familia 2") → Venta Directa ───────────────────
   Es el único grupo que no está en ConfigMapeoERP: son productos de reventa y
   terminados (auriculares, backing pop up, banderas confeccionadas). Van al
   área 'Venta Directa', que es la que el mapeo lleva al sector PRODUCTOS DE
   SALÓN (confirmado por el usuario el 12-ago-2026).                        */
INSERT INTO dbo.ArticuloClasificacion (ProIdProducto, AclArea, AclVariante, AclOrigen)
SELECT a.ProIdProducto, 'Venta Directa', NULL, 'GRUPO'
FROM dbo.Articulos a WITH(NOLOCK)
WHERE RTRIM(LTRIM(CAST(a.Grupo AS VARCHAR(20)))) = '2.1'
  AND NOT EXISTS (SELECT 1 FROM dbo.ArticuloClasificacion c WHERE c.ProIdProducto = a.ProIdProducto);

PRINT CONCAT('Seed 3 (grupo 2.1 → Venta Directa): ', @@ROWCOUNT, ' artículos.');
GO

/* ── Verificación ──────────────────────────────────────────────────────── */
SELECT
    (SELECT COUNT(*) FROM dbo.Articulos)                                        AS ArticulosTotal,
    (SELECT COUNT(*) FROM dbo.ArticuloClasificacion WHERE AclArea IS NOT NULL)  AS Clasificados,
    (SELECT COUNT(*) FROM dbo.Articulos a
      WHERE NOT EXISTS (SELECT 1 FROM dbo.ArticuloClasificacion c
                        WHERE c.ProIdProducto = a.ProIdProducto AND c.AclArea IS NOT NULL)) AS SinClasificar;

SELECT c.AclArea AS Area, ISNULL(c.AclVariante, '(sin variante)') AS Variante, COUNT(*) AS Articulos
FROM dbo.ArticuloClasificacion c
WHERE c.AclArea IS NOT NULL
GROUP BY c.AclArea, c.AclVariante
ORDER BY Area, Variante;
