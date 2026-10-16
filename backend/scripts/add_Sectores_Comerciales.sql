/* =====================================================================
   Sectores comerciales (capa de agrupación sobre las áreas productivas)
   ---------------------------------------------------------------------
   POR QUÉ: el negocio no mira las ventas por área productiva sino por
   SECTOR comercial, y no son lo mismo. Un sector agrupa varias áreas:
   CENCO = Corte Láser + Taller Costura, EMBLEMAS = Bordado + Estampado.
   Los nombres de sector los define la administración (confirmados con el
   usuario el 12-ago-2026) y no coinciden con dbo.Areas — está bien que no
   coincidan: el área es dónde se produjo (hecho operativo), el sector es
   cómo lo mira el negocio (agrupación comercial, cambia con el tiempo).

   POR QUÉ MAPEO Y NO UNA COLUMNA CONGELADA EN CADA LÍNEA: si mañana CENCO
   se parte en dos o EMBLEMAS se fusiona, se cambia el mapeo y TODO el
   histórico se reagrupa solo, permitiendo comparar períodos bajo la
   estructura actual. Congelarlo en la línea partiría las series históricas
   en cada reorganización.

   Es 100% aditivo: dos tablas nuevas, no toca datos existentes.
   Ejecutar en PRODUCCIÓN antes (o junto con) el deploy.
   ===================================================================== */

/* ── 1. Catálogo de sectores ───────────────────────────────────────── */
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Sectores')
BEGIN
    CREATE TABLE dbo.Sectores (
        SecId     VARCHAR(30)   NOT NULL PRIMARY KEY,
        SecNombre NVARCHAR(100) NOT NULL,
        SecOrden  INT           NOT NULL DEFAULT 0,
        SecActivo BIT           NOT NULL DEFAULT 1
    );
    PRINT 'Tabla Sectores creada.';
END
ELSE PRINT 'La tabla Sectores ya existe.';
GO

/* ── 2. Mapeo hacia el sector ───────────────────────────────────────
   SmaTipo define de dónde sale la clave:
     'AREA'      → nombre de área que resuelven los reportes (DTF, Sublimacion, ...)
     'GRUPO_ART' → grupo de artículo (para ventas de mostrador sin orden; fase 2)
   Una clave puede mapear a un solo sector (UNIQUE), y se puede desactivar
   sin borrarla para no perder el historial de la decisión.                */
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='SectorMapeo')
BEGIN
    CREATE TABLE dbo.SectorMapeo (
        SmaId     INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SmaTipo   VARCHAR(20)  NOT NULL,
        SmaClave  VARCHAR(100) NOT NULL,
        SecId     VARCHAR(30)  NOT NULL,
        SmaActivo BIT          NOT NULL DEFAULT 1,
        CONSTRAINT UQ_SectorMapeo UNIQUE (SmaTipo, SmaClave),
        CONSTRAINT FK_SectorMapeo_Sectores FOREIGN KEY (SecId) REFERENCES dbo.Sectores(SecId)
    );
    PRINT 'Tabla SectorMapeo creada.';
END
ELSE PRINT 'La tabla SectorMapeo ya existe.';
GO

/* ── 3. Seed de los 9 sectores del negocio ─────────────────────────── */
MERGE dbo.Sectores AS d
USING (VALUES
    ('IMPRITEX',        N'Impritex',              10),
    ('DTF',             N'DTF',                   20),
    ('ECOUV',           N'ECOUV',                 30),
    ('DIRECTA',         N'Impresión Directa',     40),
    ('CENCO',           N'CENCO',                 50),
    ('EMBLEMAS',        N'Emblemas',              60),
    ('TPU',             N'TPU',                   70),
    ('PROD_TERMINADOS', N'Productos Terminados',  80),
    ('PROD_SALON',      N'Productos de Salón',    90)
) AS s (SecId, SecNombre, SecOrden)
ON d.SecId = s.SecId
WHEN NOT MATCHED THEN
    INSERT (SecId, SecNombre, SecOrden, SecActivo) VALUES (s.SecId, s.SecNombre, s.SecOrden, 1);
GO

/* ── 4. Seed del mapeo área → sector (confirmado por administración) ──
   Las claves son los nombres de área que ya resuelven los reportes desde
   el prefijo del código de orden (areaDesdeCodigo en
   contabilidadReportesController.js), no los AreaID de dbo.Areas.
   'Diseño' y 'Sin área' quedan A PROPÓSITO sin mapear: aparecen como
   "Sin sector" en los reportes para que se vean y se decidan, en vez de
   esconderse dentro de un sector equivocado.                            */
MERGE dbo.SectorMapeo AS d
USING (VALUES
    ('AREA', 'DTF',                      'DTF'),
    ('AREA', 'Sublimacion',              'IMPRITEX'),
    ('AREA', 'ECOUV',                    'ECOUV'),
    ('AREA', 'IMPRESION DIRECTA',        'DIRECTA'),
    ('AREA', 'Corte',                    'CENCO'),
    ('AREA', 'Costura',                  'CENCO'),
    ('AREA', 'Bordado',                  'EMBLEMAS'),
    ('AREA', 'Estampado',                'EMBLEMAS'),
    ('AREA', 'TPU',                      'TPU'),
    ('AREA', 'Productos Confeccionados', 'PROD_TERMINADOS'),
    ('AREA', 'Venta Directa',            'PROD_SALON')
) AS s (SmaTipo, SmaClave, SecId)
ON d.SmaTipo = s.SmaTipo AND d.SmaClave = s.SmaClave
WHEN NOT MATCHED THEN
    INSERT (SmaTipo, SmaClave, SecId, SmaActivo) VALUES (s.SmaTipo, s.SmaClave, s.SecId, 1);
GO

/* ── Verificación ──────────────────────────────────────────────────── */
SELECT se.SecOrden, se.SecId, se.SecNombre,
       ISNULL(STUFF((SELECT ', ' + m.SmaClave
                     FROM dbo.SectorMapeo m
                     WHERE m.SecId = se.SecId AND m.SmaActivo = 1 AND m.SmaTipo = 'AREA'
                     ORDER BY m.SmaClave FOR XML PATH('')), 1, 2, ''), '(sin áreas)') AS AreasDelSector
FROM dbo.Sectores se
ORDER BY se.SecOrden;
