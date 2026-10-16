-- ============================================================================
-- PRODUCCIÓN — ESTAMPAR EL ÁREA EN LAS LÍNEAS "SIN ÁREA" DE SEPTIEMBRE 2026 (05-10-2026)
-- Origen: lineas_sin_area_sep2026.xlsx completado por Yoania (columna SECTOR).
-- El sector NO se guarda en la línea: se guarda el ÁREA (DcdArea) y el sector sale de SectorMapeo:
--   Impritex / Sublimación  -> 'Sublimacion'               (sector Impritex)
--   DTF                     -> 'DTF'
--   ECOUV                   -> 'ECOUV'
--   Productos Terminados    -> 'Productos Confeccionados'  (sector Productos Terminados)
--   Productos de Salón      -> 'Venta Directa'             (sector Productos de Salón)
-- Cómo se identifica cada línea (el Excel no trae el Id de la línea): documento (Id Y serie-número) + concepto + importe.
-- Si hay dos líneas idénticas en un mismo documento se emparejan por orden.
-- SOLO toca líneas cuyo DcdArea está vacío. No cambia importes ni documentos.
--
-- USO: correrlo primero con @Aplicar = 0 (solo muestra). Revisar que todas las filas digan
--      'OK'. Después cambiar a @Aplicar = 1 y correrlo de nuevo.
-- ============================================================================
SET NOCOUNT ON;
DECLARE @Aplicar BIT = 0;   -- 0 = solo mirar · 1 = actualizar

DECLARE @L TABLE (Fila INT, DocId INT, Nro NVARCHAR(30), Concepto NVARCHAR(500), Total DECIMAL(18,4), Sector NVARCHAR(50), Area VARCHAR(50));
INSERT INTO @L (Fila, DocId, Nro, Concepto, Total, Sector, Area) VALUES
    (2, 14317, N'FA-1549', N'718', 7.2, N'Sublimación', N'Sublimacion'),
    (3, 14641, N'FA-1600', N'Frontlight Brillo hasta 3.17 Orden: EUV-22895 (Lonas gomeria)', 352.25, N'ECOUV', N'ECOUV'),
    (4, 15257, N'FA-1722', N'Tela Hexabonal', 103.32, N'Impritex', N'Sublimacion'),
    (5, 15490, N'FA-1791', N'Pago Dtf', 1442, N'DTF', N'DTF'),
    (6, 15939, N'FA-1909', N'Pago de Saldo negativo', 2814.05, N'Sublimación', N'Sublimacion'),
    (7, 15985, N'FA-1925', N'Trabajos de sublimación cuenta telas', 389.1, N'Impritex', N'Sublimacion'),
    (8, 15990, N'FA-1926', N'Estructura Roll Up de Aluminio', 35, N'ECOUV', N'ECOUV'),
    (9, 16410, N'FA-2035', N'Lona Frontlight Brillo_Reverso Gris 3,20mx50m', 4575, N'ECOUV', N'ECOUV'),
    (10, 16410, N'FA-2035', N'Vinilo Brillo_R - Gris - 1,52 - 100 Micrones', 3074.4, N'ECOUV', N'ECOUV'),
    (11, 16410, N'FA-2035', N'Lona Frontlight Matte_Reverso Gris 3,20mx50m', 1525, N'ECOUV', N'ECOUV'),
    (12, 16410, N'FA-2035', N'Vinilo Mate_R - Gris - 1,52 - 100 Micrones', 341.6, N'ECOUV', N'ECOUV'),
    (13, 16519, N'PC-5040', N'Telas', 70.25, N'Impritex', N'Sublimacion'),
    (14, 11224, N'ET-7757', N'stikert UV', 200, N'Productos de Salón', N'Venta Directa'),
    (15, 11309, N'ET-7819', N'Stikers UV', 200, N'Productos de Salón', N'Venta Directa'),
    (16, 11325, N'ET-7836', N'stickers uv', 200, N'Productos de Salón', N'Venta Directa'),
    (17, 11394, N'ET-7880', N'STIKERS UV', 200, N'Productos de Salón', N'Venta Directa'),
    (18, 11715, N'ET-8151', N'Short Confeccionados', 198, N'Productos Terminados', N'Productos Confeccionados'),
    (19, 11738, N'ET-8179', N'Stikers UV', 200, N'Productos de Salón', N'Venta Directa'),
    (20, 14305, N'ET-8658', N'DTF rigido', 200, N'DTF', N'DTF'),
    (21, 14306, N'ET-8659', N'Short', 99, N'Productos Terminados', N'Productos Confeccionados'),
    (22, 14449, N'ET-8759', N'short', 99, N'Productos Terminados', N'Productos Confeccionados'),
    (23, 14547, N'ET-8840', N'ajuste', 45.66, N'Sublimación', N'Sublimacion'),
    (24, 14693, N'ET-8968', N'DTF plancha de Stikers', 400, N'Productos de Salón', N'Venta Directa'),
    (25, 14884, N'ET-9151', N'gorro de lana', 99, N'Productos de Salón', N'Venta Directa'),
    (26, 14585, N'ET-9566', N'Ajuste', 9.04, N'Sublimación', N'Sublimacion'),
    (27, 15479, N'ET-9574', N'Conjunto Local', 620, N'Productos Terminados', N'Productos Confeccionados'),
    (28, 16030, N'ET-10011', N'Deuda AyP', 930, N'Sublimación', N'Sublimacion'),
    (29, 16124, N'ET-10092', N'EUV-25118', 2500.02, N'ECOUV', N'ECOUV'),
    (30, 10887, N'FA-1267', N'Prendas Fila', 46835, N'Productos Terminados', N'Productos Confeccionados'),
    (31, 11068, N'FA-1293', N'short', 211, N'Productos Terminados', N'Productos Confeccionados'),
    (32, 11215, N'FA-1312', N'vinilo Impreso 230x42 cm,Desploteo de vidriera y pegado', 2000, N'ECOUV', N'ECOUV'),
    (33, 11215, N'FA-1312', N'Lona Front impresa 120x50', 1050, N'ECOUV', N'ECOUV'),
    (34, 11225, N'FA-1324', N'Equipos de fútbol', 7030, N'Productos Terminados', N'Productos Confeccionados'),
    (35, 11237, N'FA-1326', N'Equipos largos primer pedido', 71604, N'Productos Terminados', N'Productos Confeccionados'),
    (36, 11237, N'FA-1326', N'Equipos largos agregados segundo pedido', 36720, N'Productos Terminados', N'Productos Confeccionados'),
    (37, 11237, N'FA-1326', N'Agregados equipos cortos', 15540, N'Productos Terminados', N'Productos Confeccionados'),
    (38, 11613, N'FA-1408', N'Sublimacion en tela Dry Microporoso 1.83 (lado  liso)', 32050, N'Impritex', N'Sublimacion'),
    (39, 13105, N'FA-1485', N'DTF', 50000, N'DTF', N'DTF'),
    (40, 14424, N'FA-1575', N'Sublimacion en tela Dry Microporoso', 19440, N'Impritex', N'Sublimacion'),
    (41, 15149, N'FA-1692', N'Tela Cliente', 2605, N'Impritex', N'Sublimacion'),
    (42, 15228, N'FA-1714', N'DTF-23538', 2694, N'DTF', N'DTF'),
    (43, 15557, N'FA-1799', N'DTF textil COMUN DTF-22581', 156, N'DTF', N'DTF'),
    (44, 15560, N'FA-1800', N'DTF textil COMUN DTF-23939', 200.03, N'DTF', N'DTF'),
    (45, 15728, N'FA-1839', N'Remeras Negras de algodón manga corta', 27600, N'Productos Terminados', N'Productos Confeccionados'),
    (46, 15728, N'FA-1839', N'Sublimación en tela Voile 1.40 x 2.50', 4920, N'Impritex', N'Sublimacion'),
    (47, 15934, N'FA-1907', N'shorts', 8811, N'Productos Terminados', N'Productos Confeccionados'),
    (48, 16122, N'FA-1943', N'EUV-24773', 890.01, N'ECOUV', N'ECOUV'),
    (49, 16634, N'FA-2093', N'Trabajos en Dtf', 25960, N'DTF', N'DTF'),
    (50, 16824, N'FA-2132', N'SUB-27365', 1707, N'Impritex', N'Sublimacion'),
    (51, 16824, N'FA-2132', N'DTF-26734', 884, N'DTF', N'DTF'),
    (52, 16824, N'FA-2132', N'EUV-26616', 690, N'ECOUV', N'ECOUV'),
    (53, 17049, N'FA-2161', N'EUV-22215 LAURA MICROPERFORADO', 2336, N'ECOUV', N'ECOUV'),
    (54, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 7954.23, N'Impritex', N'Sublimacion'),
    (55, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 5487.64, N'Impritex', N'Sublimacion'),
    (56, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 5377.56, N'Impritex', N'Sublimacion'),
    (57, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 4191.16, N'Impritex', N'Sublimacion'),
    (58, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 4174.85, N'Impritex', N'Sublimacion'),
    (59, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 3918, N'Impritex', N'Sublimacion'),
    (60, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 3567.38, N'Impritex', N'Sublimacion'),
    (61, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 3477.68, N'Impritex', N'Sublimacion'),
    (62, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 3359.45, N'Impritex', N'Sublimacion'),
    (63, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 3021.06, N'Impritex', N'Sublimacion'),
    (64, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 2360.58, N'Impritex', N'Sublimacion'),
    (65, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 1691.96, N'Impritex', N'Sublimacion'),
    (66, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 1667.49, N'Impritex', N'Sublimacion'),
    (67, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 1618.57, N'Impritex', N'Sublimacion'),
    (68, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 1373.95, N'Impritex', N'Sublimacion'),
    (69, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 1361.72, N'Impritex', N'Sublimacion'),
    (70, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 1353.56, N'Impritex', N'Sublimacion'),
    (71, 11710, N'PC-4131', N'Dry Microporoso 1.83 (lado poroso)', 786.86, N'Impritex', N'Sublimacion'),
    (72, 11884, N'PC-4170', N'Encomienda', 300, N'ECOUV', N'ECOUV'),
    (73, 14443, N'PC-4343', N'sublimacion en tela', 1000, N'Impritex', N'Sublimacion'),
    (74, 14447, N'PC-4345', N'Sublimacion en tela', 1000, N'Impritex', N'Sublimacion'),
    (75, 12015, N'PC-4580', N'sublimacion  en tela', 160, N'Impritex', N'Sublimacion'),
    (76, 15141, N'PC-4581', N'Sublimacion en tela', 1000, N'Impritex', N'Sublimacion'),
    (77, 14302, N'PC-4594', N'deuda julio jts', 1000, N'Sublimación', N'Sublimacion'),
    (78, 15793, N'PC-4760', N'Sublimacion en tela', 1000, N'Impritex', N'Sublimacion');

-- Emparejar cada fila del Excel con su línea (mismo documento, concepto e importe; duplicados por orden)
DECLARE @M TABLE (Fila INT, DcdIdDetalle INT NULL, AreaHoy VARCHAR(100) NULL);
;WITH lx AS (
    SELECT l.*, ROW_NUMBER() OVER (PARTITION BY l.DocId, LTRIM(RTRIM(l.Concepto)), ROUND(l.Total, 2) ORDER BY l.Fila) AS rn
    FROM @L l
), dx AS (
    SELECT d.DcdIdDetalle, d.DocIdDocumento, d.DcdArea, LTRIM(RTRIM(d.DcdNomItem)) AS Concepto, ROUND(d.DcdTotal, 2) AS Total,
           RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR(20)) AS Nro,
           ROW_NUMBER() OVER (PARTITION BY d.DocIdDocumento, LTRIM(RTRIM(d.DcdNomItem)), ROUND(d.DcdTotal, 2) ORDER BY d.DcdIdDetalle) AS rn
    FROM dbo.DocumentosContablesDetalle d
    JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = d.DocIdDocumento
    WHERE d.DocIdDocumento IN (SELECT DocId FROM @L)
)
INSERT INTO @M (Fila, DcdIdDetalle, AreaHoy)
SELECT lx.Fila, dx.DcdIdDetalle, dx.DcdArea
FROM lx
LEFT JOIN dx ON dx.DocIdDocumento = lx.DocId AND dx.Nro = lx.Nro AND dx.Concepto = LTRIM(RTRIM(lx.Concepto)) AND dx.Total = ROUND(lx.Total, 2) AND dx.rn = lx.rn;

-- 1) Vista previa: una fila por línea del Excel
SELECT l.Fila, l.Nro, l.Concepto, l.Total, l.Sector, l.Area AS AreaQueSeGuarda, m.DcdIdDetalle, m.AreaHoy,
       CASE WHEN m.DcdIdDetalle IS NULL THEN 'NO ENCONTRADA'
            WHEN NULLIF(LTRIM(RTRIM(m.AreaHoy)), '') IS NOT NULL THEN 'YA TIENE ÁREA (no se toca)'
            ELSE 'OK' END AS Resultado
FROM @L l JOIN @M m ON m.Fila = l.Fila
ORDER BY CASE WHEN m.DcdIdDetalle IS NULL THEN 0 WHEN NULLIF(LTRIM(RTRIM(m.AreaHoy)), '') IS NOT NULL THEN 1 ELSE 2 END, l.Fila;

-- 2) Resumen por área
SELECT l.Area, l.Sector, COUNT(*) AS Lineas,
       SUM(CASE WHEN m.DcdIdDetalle IS NOT NULL AND NULLIF(LTRIM(RTRIM(m.AreaHoy)), '') IS NULL THEN 1 ELSE 0 END) AS SeVanAActualizar
FROM @L l JOIN @M m ON m.Fila = l.Fila
GROUP BY l.Area, l.Sector ORDER BY l.Area;

-- 3) Actualizar (solo con @Aplicar = 1)
IF @Aplicar = 1
BEGIN
    BEGIN TRAN;
    UPDATE d SET d.DcdArea = l.Area
    FROM dbo.DocumentosContablesDetalle d
    JOIN @M m ON m.DcdIdDetalle = d.DcdIdDetalle
    JOIN @L l ON l.Fila = m.Fila
    WHERE NULLIF(LTRIM(RTRIM(d.DcdArea)), '') IS NULL;
    DECLARE @n INT = @@ROWCOUNT;
    COMMIT;
    DECLARE @tot INT = (SELECT COUNT(*) FROM @L);
    PRINT CONCAT('Líneas actualizadas: ', @n, ' de ', @tot, '.');
END
ELSE
    PRINT 'Solo vista previa (@Aplicar = 0). No se cambió nada.';
