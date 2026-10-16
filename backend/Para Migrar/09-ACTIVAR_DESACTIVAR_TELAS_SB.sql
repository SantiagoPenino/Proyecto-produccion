USE [SecureAppDB2205];
GO

-- ============================================================================
-- ACTIVAR / DESACTIVAR TELAS SUBLIMACIÓN
-- Generado: 2026-06-29
--
-- Lista activa confirmada (30 telas):
--   01 Adis brillo Rajman (1,58)      ← NUEVA (no existe en DB)
--   02 Deportiva Parisien 1,60        ← RENOMBRAR Deportiva (1,60) ProId=214
--   03 Dry Polo (1,80)                ProId=52
--   04 Dry Poroso (1,50)              ProId=217
--   05 Dry Pro (1,80)                 ProId=28
--   06 Dry Microporoso 1.83 (poroso)  ProId=266
--   07 Dry Microporoso 1.83 (liso)    ProId=277
--   08 Dry milan 1,83                 ← verificar en Articulos (puede existir)
--   09 Delta (1,68 m)                 ProId=56
--   10 Hexagonal (1,83)               ProId=258
--   11 Jacquard city 1,83             ProId=208
--   12 Lycra (1,60)                   ProId=221
--   13 Mykonos Rajchman (1,60)        ← NUEVA (no existe en DB)
--   14 Interlock Grueso (1,83 m)      ProId=410
--   15 Modal (1,80)                   ← verificar (DB tiene Modal 1,50 = 220)
--   16 Bandera mesh (1,60) (110g)     ProId=227
--   17 Bandera (1,60)                 ProId=44
--   18 Panama (1,60)                  ProId=240
--   19 Saten (1,50)                   ProId=2
--   20 Polar (1,50)                   ProId=212
--   21 Microfibra RV Waterproof (1,50) ProId=48
--   22 Microfibra Short (1,50)        ProId=49 (agregar dimensión al nombre)
--   23 Nagasaki (1,80 m)              ProId=57
--   24 NeoStretch (1,83)              ProId=53
--   25 Toalla (1,80)                  ProId=216
--   26 ESPECIAL F                     ProId=231
--   27 Grid (1,70 m)                  ProId=58
--   28 Rib New (1,37)                 ← NUEVA (DB tiene Rib 1,70 = 225, diferente)
--   29 Tela Cliente (Minimo 5mts)     ProId=1
--   30 Interlock Fina "Fer" (1,83 m)  ProId=235
--
-- TELAS SB A DESACTIVAR (estaban activas, no están en la lista):
--   Adis Elastizado Grueso (1,83)     ProId=239
--   Interlock feria (1,80)            ProId=388
--   Jacquard Elite 1,83               ProId=223
--   Lycra Mykonos (1,80)              ProId=236
--   Modal (1,50)                      ProId=220  ← revisar si es reemplazo por Modal (1,80)
--   Papel                             ProId=246
--   Rib 1,70 (Cuellos...)             ProId=225  ← revisar si es reemplazo por Rib New
-- ============================================================================

SET NOCOUNT ON;
BEGIN TRANSACTION;

-- ============================================================================
-- PASO 1: DESACTIVAR telas SB que NO están en la lista activa
-- ============================================================================
PRINT '→ PASO 1: Desactivando telas SB no activas...';

UPDATE Articulos SET borrar = 1
WHERE ProIdProducto IN (
    239,  -- Adis Elastizado Grueso (1,83)
    388,  -- Interlock feria (1,80)
    223,  -- Jacquard Elite 1,83
    236,  -- Lycra Mykonos (1,80)
    220,  -- Modal (1,50)  ← reemplazado por Modal (1,80)
    246,  -- Papel         ← no figura en lista activa de telas
    225   -- Rib 1,70 (Cuellos y vivos tela Elite y Supreme) ← reemplazado por Rib New (1,37)
);

PRINT CONCAT('   Filas afectadas: ', @@ROWCOUNT);

-- También desactivar de SINCRO-ARTICULOS (quitar de sincronización)
DELETE FROM [dbo].[SINCRO-ARTICULOS]
WHERE PROIDPRODUCTO IN (239, 388, 223, 236, 220, 246, 225);

PRINT CONCAT('   Eliminadas de SINCRO-ARTICULOS: ', @@ROWCOUNT);

-- ============================================================================
-- PASO 2: ACTIVAR las 26 telas con ProIdProducto conocido
-- ============================================================================
PRINT '→ PASO 2: Asegurando borrar=0 en telas activas conocidas...';

UPDATE Articulos SET borrar = 0
WHERE ProIdProducto IN (
    52,   -- Dry Polo (1,80)
    217,  -- Dry Poroso (1,50)
    28,   -- Dry Pro (1,80)
    266,  -- Dry Microporoso 1.83 (lado poroso)
    277,  -- Dry Microporoso 1.83 (lado liso)
    56,   -- Delta (1,68 m)
    258,  -- Hexagonal (1,83)
    208,  -- Jacquard city 1,83
    221,  -- Lycra (1,60)
    410,  -- Interlock Grueso (1,83 m)
    227,  -- Bandera mesh (1,60) (110g)
    44,   -- Bandera (1,60)
    240,  -- Panama (1,60)
    2,    -- Saten (1,50)
    212,  -- Polar (1,50)
    48,   -- Microfibra RV Waterproof (1,50)
    49,   -- Microfibra Short
    57,   -- Nagasaki (1,80 m)
    53,   -- NeoStretch (1,83)
    216,  -- Toalla (1,80)
    231,  -- ESPECIAL F
    58,   -- Grid (1,70 m)
    1,    -- Tela Cliente (Minimo 5mts)
    235,  -- Interlock Fina "Fer" (1,83 m)
    214   -- Deportiva (va a ser renombrada en el siguiente paso)
);

PRINT CONCAT('   Filas afectadas: ', @@ROWCOUNT);

-- ============================================================================
-- PASO 3: RENOMBRAR telas que cambiaron de nombre
-- ============================================================================
PRINT '→ PASO 3: Actualizando nombres en SINCRO-ARTICULOS...';

-- Deportiva (1,60) → Deportiva Parisien 1,60
UPDATE [dbo].[SINCRO-ARTICULOS]
SET PRODUCTO = 'Deportiva Parisien 1,60', Material = 'Deportiva Parisien 1,60'
WHERE PROIDPRODUCTO = 214;

-- Microfibra Short → Microfibra Short (1,50)
UPDATE [dbo].[SINCRO-ARTICULOS]
SET PRODUCTO = 'Microfibra Short (1,50)', Material = 'Microfibra Short (1,50)'
WHERE PROIDPRODUCTO = 49;

PRINT CONCAT('   Filas actualizadas: ', @@ROWCOUNT);

-- También actualizar el campo descripción/nombre en Articulos si corresponde
-- (ajustar el nombre de columna según la estructura real de Articulos)
UPDATE Articulos SET descripcion = 'Deportiva Parisien 1,60' WHERE ProIdProducto = 214;
UPDATE Articulos SET descripcion = 'Microfibra Short (1,50)'  WHERE ProIdProducto = 49;

-- ============================================================================
-- PASO 4: NUEVAS TELAS — requieren INSERT manual con ProIdProducto nuevo
-- ============================================================================
-- Las siguientes telas NO existen en la BD y deben crearse.
-- Verificar primero si hay un ProIdProducto en Articulos por nombre similar.
-- ============================================================================
PRINT '';
PRINT '=== TELAS NUEVAS QUE REQUIEREN ALTA MANUAL ===';
PRINT '';

-- Verificar si "Dry milan 1,83" ya existe en Articulos
PRINT '→ Buscando "Dry milan" en Articulos...';
SELECT ProIdProducto, descripcion, codArticulo
FROM Articulos
WHERE descripcion LIKE '%milan%' OR descripcion LIKE '%Dry milan%'
ORDER BY ProIdProducto;

-- Verificar si "Adis brillo Rajman" ya existe en Articulos
PRINT '→ Buscando "Adis brillo" o "Rajman" en Articulos...';
SELECT ProIdProducto, descripcion, codArticulo
FROM Articulos
WHERE descripcion LIKE '%Rajman%' OR descripcion LIKE '%brillo%'
  AND descripcion LIKE '%Adis%'
ORDER BY ProIdProducto;

-- Verificar si "Mykonos Rajchman" ya existe en Articulos
PRINT '→ Buscando "Mykonos Rajchman" en Articulos...';
SELECT ProIdProducto, descripcion, codArticulo
FROM Articulos
WHERE descripcion LIKE '%Mykonos%' AND (descripcion LIKE '%Rajchman%' OR descripcion LIKE '%1,60%')
ORDER BY ProIdProducto;

-- Verificar si "Modal (1,80)" ya existe (distinto del Modal 1,50 = 220)
PRINT '→ Buscando "Modal (1,80)" en Articulos...';
SELECT ProIdProducto, descripcion, codArticulo
FROM Articulos
WHERE descripcion LIKE '%Modal%' AND descripcion LIKE '%1,80%'
ORDER BY ProIdProducto;

-- Verificar si "Rib New (1,37)" ya existe
PRINT '→ Buscando "Rib New" o "Rib (1,37)" en Articulos...';
SELECT ProIdProducto, descripcion, codArticulo
FROM Articulos
WHERE descripcion LIKE '%Rib%' AND (descripcion LIKE '%1,37%' OR descripcion LIKE '%New%')
ORDER BY ProIdProducto;

GO

-- ============================================================================
-- PASO 5: Si los SELECT del PASO 4 devuelven ProIdProducto,
--          activar esas filas y agregarlas a SINCRO-ARTICULOS
-- ============================================================================
-- Descomentar y completar con los ProIdProducto encontrados:
--
-- UPDATE Articulos SET borrar = 0 WHERE ProIdProducto = ???; -- Dry milan
-- UPDATE Articulos SET borrar = 0 WHERE ProIdProducto = ???; -- Mykonos Rajchman
-- UPDATE Articulos SET borrar = 0 WHERE ProIdProducto = ???; -- Modal (1,80)
-- UPDATE Articulos SET borrar = 0 WHERE ProIdProducto = ???; -- Rib New (1,37)
-- UPDATE Articulos SET borrar = 0 WHERE ProIdProducto = ???; -- Adis brillo Rajman (1,58)
--
-- INSERT INTO [dbo].[SINCRO-ARTICULOS]
--   ([PRODUCTO],[codStock],[VARIANTE],[PROIDPRODUCTO],[Material],[codArticulo],[IDREACT],[AREA])
-- VALUES
--   ('Dry milan 1,83',        '1.1.1.1','Sublimacion Tela', ???, 'Dry milan 1,83',        ???, ???, 'SB'),
--   ('Mykonos Rajchman (1,60)','1.1.1.1','Sublimacion Tela', ???, 'Mykonos Rajchman (1,60)',???, ???, 'SB'),
--   ('Modal (1,80)',           '1.1.1.1','Sublimacion Tela', ???, 'Modal (1,80)',           ???, ???, 'SB'),
--   ('Rib New (1,37)',         '1.1.1.1','Sublimacion Tela', ???, 'Rib New (1,37)',         ???, ???, 'SB'),
--   ('Adis brillo Rajman (1,58)','1.1.1.1','Sublimacion Tela',???,'Adis brillo Rajman (1,58)',???,???,'SB');

-- ============================================================================
-- VERIFICACIÓN FINAL: estado de todas las telas SB
-- ============================================================================
PRINT '';
PRINT '=== ESTADO FINAL TELAS SB ===';

SELECT
    SA.PRODUCTO,
    SA.PROIDPRODUCTO,
    SA.codArticulo,
    A.borrar,
    CASE A.borrar WHEN 0 THEN 'ACTIVA' WHEN 1 THEN 'INACTIVA' ELSE '?' END AS Estado
FROM [dbo].[SINCRO-ARTICULOS] SA
LEFT JOIN Articulos A ON A.ProIdProducto = SA.PROIDPRODUCTO
WHERE SA.AREA = 'SB'
ORDER BY SA.PRODUCTO;

-- Descomentar para aplicar:
-- COMMIT TRANSACTION;
-- ROLLBACK TRANSACTION;
