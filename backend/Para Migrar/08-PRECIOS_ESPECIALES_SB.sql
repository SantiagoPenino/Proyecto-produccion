USE [SecureAppDB2205];
GO

-- ============================================================================
-- PRECIOS ESPECIALES SUBLIMACION - Carga masiva desde planilla
-- Generado: 2026-06-29
--
-- ESTRUCTURA:
--   Parte A: Mapeo de productos (nombre → ProIdProducto)
--   Parte B: Clientes con precios FIJOS específicos (no porcentaje)
--   Parte C: Clientes con descuento global 10% o 20%
--
-- IMPORTANTE: El campo CliIdCliente se resuelve por IDCliente en tabla Clientes.
--   Si un cliente no existe en Clientes, la fila queda sin insertar.
--   Revisar la sección "CLIENTES NO ENCONTRADOS" al final.
-- ============================================================================

SET NOCOUNT ON;

-- ============================================================================
-- PARTE A: TABLA TEMPORAL DE MAPEO DE PRODUCTOS
-- ============================================================================
IF OBJECT_ID('tempdb..#ProdMap') IS NOT NULL DROP TABLE #ProdMap;

CREATE TABLE #ProdMap (
    NombrePlanilla  NVARCHAR(200) PRIMARY KEY,
    ProIdProducto   INT,
    CodArticulo     INT
);

-- Insertar desde SINCRO-ARTICULOS (productos ya catalogados)
INSERT INTO #ProdMap (NombrePlanilla, ProIdProducto, CodArticulo)
SELECT PRODUCTO, PROIDPRODUCTO, codArticulo FROM [dbo].[SINCRO-ARTICULOS]
WHERE PRODUCTO IN (
    'Papel','Tela Cliente (Minimo 5mts)','Toalla (1,80)',
    'Bandera mesh (1,60) (110g)','Bandera (1,60)','Deportiva (1,60)',
    'Dry Microporoso 1.83 (lado  liso)','Dry Microporoso 1.83 (lado  poroso)',
    'Dry Polo (1,80)','Dry Poroso (1,50)','Dry Pro (1,80)','ESPECIAL F',
    'Grid (1,70 m)','Hexagonal (1,83)','Interlock feria (1,80)',
    'Interlock Fina "Fer" (1,83 m)','Interlock Grueso  (1,83 m)',
    'Jacquard city 1,83','Jacquard Elite 1,83','Lycra (1,60)',
    'Lycra Mykonos (1,80)','Microfibra RV Waterproof (1,50)','Microfibra Short',
    'Modal (1,50)','Nagasaki (1,80 m)','NeoStretch (1,83)','Panama (1,60)',
    'Polar (1,50)','Rib 1,70 (Cuellos y vivos tela Elite y Supreme)','Saten (1,50)',
    'Adis Elastizado Grueso (1,83)','Tela de bandera (3,10)',
    'Tela de bandera Mesh (3,17)','Delta (1,68 m)'
);

-- Alias / variantes que usan nombre diferente en la planilla
-- Ajustar ProIdProducto/CodArticulo si en la BD real existen con otro ID
INSERT INTO #ProdMap VALUES ('TC Tela cliente',           1,    1);    -- alias de "Tela Cliente"
INSERT INTO #ProdMap VALUES ('Toalla (1,83)',             216,  2);    -- usar Toalla(1,80); ajustar si existe ID propio
INSERT INTO #ProdMap VALUES ('Toalla (1,60)',             216,  2);    -- idem
INSERT INTO #ProdMap VALUES ('Toalla (1,50)',             216,  2);    -- idem
INSERT INTO #ProdMap VALUES ('Bandera fina (1,60) (68g)', NULL, NULL); -- PENDIENTE: buscar en Articulos
INSERT INTO #ProdMap VALUES ('Dry Rajchman (1,83)',        NULL, NULL);
INSERT INTO #ProdMap VALUES ('Adis Elastizado (1,83)',    239,  40);   -- Adis Elastizado Grueso
INSERT INTO #ProdMap VALUES ('Adis Elastizado fino (1,83)', NULL, NULL);
INSERT INTO #ProdMap VALUES ('Adis Elastizado grueso (1,83)', 239, 40);
INSERT INTO #ProdMap VALUES ('Adis Elastizado (1,50)',    NULL, NULL);
INSERT INTO #ProdMap VALUES ('Adis (1,60)',               NULL, NULL);
INSERT INTO #ProdMap VALUES ('Panama (1,50)',             240,  41);   -- usar Panama(1,60); ajustar si existe
INSERT INTO #ProdMap VALUES ('Micro fibra (1,50)',        NULL, NULL);
INSERT INTO #ProdMap VALUES ('Mykonos (1,60)',            NULL, NULL);
INSERT INTO #ProdMap VALUES ('Mykonos (1,80)',            NULL, NULL);
INSERT INTO #ProdMap VALUES ('Micropolar (1,50)',         NULL, NULL);
INSERT INTO #ProdMap VALUES ('Jacquard Supreme 1,83',    NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry Exclusive (1,83)',      NULL, NULL);
INSERT INTO #ProdMap VALUES ('Scuba 1,80',               NULL, NULL);
INSERT INTO #ProdMap VALUES ('Scuba (1,60)',              NULL, NULL);
INSERT INTO #ProdMap VALUES ('scuba (1,55)',              NULL, NULL);
INSERT INTO #ProdMap VALUES ('Jacquard 1,83 (Lado poroso)', NULL, NULL);
INSERT INTO #ProdMap VALUES ('Jacquard 1,83 (lado liso)',   NULL, NULL);
INSERT INTO #ProdMap VALUES ('Vinilo Microperforado 1,50',  NULL, NULL);
INSERT INTO #ProdMap VALUES ('Bandera Confeccionada (1,50x0,85)', NULL, NULL);
INSERT INTO #ProdMap VALUES ('Bandera Confeccionada (1,50x0,90)', NULL, NULL);
INSERT INTO #ProdMap VALUES ('Bandera Confeccionada (1,50x0,85) con diseño', NULL, NULL);
INSERT INTO #ProdMap VALUES ('Jacquard Charrúa (1,83)',   NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry Liso (1,83)',           NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry pique grueso (1,80)',   NULL, NULL);
INSERT INTO #ProdMap VALUES ('Modal Brillo (1,80)',        NULL, NULL);
INSERT INTO #ProdMap VALUES ('Hexagonal (1,80)',          NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry Microporoso 1.77 (lado  poroso)', NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry Microporoso 1.77 (lado  liso)',   NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry Microporoso new 1.73 (lado  poroso)', NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry Microporoso new 1.73 (lado  liso)',   NULL, NULL);
INSERT INTO #ProdMap VALUES ('Docena de cuellos polares sublimados', NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry Pro New (1,80)',        NULL, NULL);
INSERT INTO #ProdMap VALUES ('Microfibra RV Waterproof',  48,   1215); -- alias sin ancho
INSERT INTO #ProdMap VALUES ('UrbanFit',                  NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry milan 1,83',            NULL, NULL);
INSERT INTO #ProdMap VALUES ('Dry liso milan 1,83',       NULL, NULL);
INSERT INTO #ProdMap VALUES ('Delta (1,75 m)',            56,   1223); -- usar Delta(1,68m); ajustar
INSERT INTO #ProdMap VALUES ('Delta (1,72 m)',            56,   1223);
INSERT INTO #ProdMap VALUES ('Nagasaki (1,85 m)',         57,   1224); -- usar Nagasaki(1,80m); ajustar
INSERT INTO #ProdMap VALUES ('Lycra Mykonos (1,60)',      NULL, NULL);
INSERT INTO #ProdMap VALUES ('Tela de bandera Mesh (3,10)', 420, 161);
INSERT INTO #ProdMap VALUES ('Tela TwoFace – Tela Doble Cara (2,9)', 32, 1560);
INSERT INTO #ProdMap VALUES ('Modal (1,80)',              NULL, NULL);

-- Intentar resolver los NULL buscando en Articulos por descripcion
UPDATE PM SET PM.ProIdProducto = A.ProIdProducto, PM.CodArticulo = A.codArticulo
FROM #ProdMap PM
JOIN Articulos A ON A.descripcion LIKE '%' + PM.NombrePlanilla + '%' AND A.borrar = 0
WHERE PM.ProIdProducto IS NULL;

PRINT '=== Productos con mapeo pendiente (ProIdProducto IS NULL) ===';
SELECT NombrePlanilla FROM #ProdMap WHERE ProIdProducto IS NULL ORDER BY NombrePlanilla;

GO

-- ============================================================================
-- PARTE B: CLIENTES CON PRECIOS FIJOS ESPECÍFICOS
-- ============================================================================
-- Helper: obtener CliIdCliente por código de cliente (IDCliente o NombreFantasia)
-- Patrón reutilizable en cada bloque:
--   DECLARE @CID INT = dbo.fn_GetCliId('CODIGO')
-- Como no existe la función, usamos subquery inline.
-- ============================================================================

IF OBJECT_ID('tempdb..#PreciosNuevos') IS NOT NULL DROP TABLE #PreciosNuevos;

CREATE TABLE #PreciosNuevos (
    CodigoCliente   NVARCHAR(100),
    NombreProd      NVARCHAR(200),
    TipoRegla       NVARCHAR(50),   -- 'fixed_price' o 'percentage_discount'
    Valor           DECIMAL(18,4),
    MonIdMoneda     INT DEFAULT 1   -- 1=UYU
);

-- -------------------------------------------------------
-- MGR
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('MGR','Papel','fixed_price',5,1),
('MGR','TC Tela cliente','fixed_price',5,1),
('MGR','Bandera fina (1,60) (68g)','fixed_price',8,1),
('MGR','Hexagonal (1,83)','fixed_price',9.5,1),
('MGR','Dry Microporoso 1.83 (lado  poroso)','fixed_price',7,1),
('MGR','Dry Microporoso 1.83 (lado  liso)','fixed_price',7,1),
('MGR','Dry Pro (1,80)','fixed_price',8.5,1),
('MGR','Mykonos (1,60)','fixed_price',9,1),
('MGR','TC Tela cliente','fixed_price',5,1),
('MGR','Dry Poroso (1,50)','fixed_price',8,1),
('MGR','Adis Elastizado (1,50)','fixed_price',7.65,1),
('MGR','Modal (1,50)','fixed_price',9,1),
('MGR','Jacquard Elite 1,83','fixed_price',14,1),
('MGR','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- ELEA
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('ELEA','Papel','fixed_price',6,1),
('ELEA','TC Tela cliente','fixed_price',6,1),
('ELEA','Bandera fina (1,60) (68g)','fixed_price',8,1),
('ELEA','Hexagonal (1,83)','fixed_price',9.5,1),
('ELEA','Dry Pro (1,80)','fixed_price',8.5,1),
('ELEA','Mykonos (1,60)','fixed_price',10,1),
('ELEA','Dry Poroso (1,50)','fixed_price',8,1),
('ELEA','Adis Elastizado (1,50)','fixed_price',7.65,1),
('ELEA','Modal (1,50)','fixed_price',9,1),
('ELEA','Jacquard Elite 1,83','fixed_price',14,1),
('ELEA','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- HINCHAS
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('HINCHAS','Papel','fixed_price',6,1),
('HINCHAS','TC Tela cliente','fixed_price',6,1),
('HINCHAS','Bandera fina (1,60) (68g)','fixed_price',8,1),
('HINCHAS','Hexagonal (1,83)','fixed_price',9.5,1),
('HINCHAS','Dry Microporoso 1.83 (lado  poroso)','fixed_price',9,1),
('HINCHAS','Dry Microporoso 1.83 (lado  liso)','fixed_price',9,1),
('HINCHAS','Dry Pro (1,80)','fixed_price',8.5,1),
('HINCHAS','Bandera (1,60)','fixed_price',11,1),
('HINCHAS','Mykonos (1,60)','fixed_price',10,1),
('HINCHAS','Dry Poroso (1,50)','fixed_price',8,1),
('HINCHAS','Adis Elastizado (1,50)','fixed_price',7.65,1),
('HINCHAS','Modal (1,50)','fixed_price',9,1),
('HINCHAS','Jacquard Elite 1,83','fixed_price',14,1),
('HINCHAS','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- Jim Texeira 893  /  Jim Texeira  /  Texeira
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Jim Texeira 893','TC Tela cliente','fixed_price',7,1),
('Jim Texeira 893','Bandera fina (1,60) (68g)','fixed_price',8,1),
('Jim Texeira 893','Bandera (1,60)','fixed_price',10,1),
('Jim Texeira 893','Dry Poroso (1,50)','fixed_price',8,1),
('Jim Texeira 893','Adis Elastizado (1,50)','fixed_price',7.65,1),
('Jim Texeira 893','Modal (1,50)','fixed_price',9,1),
('Jim Texeira 893','Jacquard Elite 1,83','fixed_price',14,1),
('Jim Texeira 893','Dry Exclusive (1,83)','fixed_price',12,1);

INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'Jim Texeira 893','Jim Texeira'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='Jim Texeira 893';
INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'Jim Texeira 893','Texeira'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='Jim Texeira 893';

-- -------------------------------------------------------
-- GONZALO LALIN
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('GONZALO LALIN','Papel','fixed_price',5,1),
('GONZALO LALIN','TC Tela cliente','fixed_price',5,1),
('GONZALO LALIN','Bandera fina (1,60) (68g)','fixed_price',8,1),
('GONZALO LALIN','Hexagonal (1,83)','fixed_price',8.5,1),
('GONZALO LALIN','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8.5,1),
('GONZALO LALIN','Dry Microporoso 1.83 (lado  liso)','fixed_price',8.5,1),
('GONZALO LALIN','Adis Elastizado (1,83)','fixed_price',8.5,1),
('GONZALO LALIN','Dry Pro (1,80)','fixed_price',7.5,1),
('GONZALO LALIN','Mykonos (1,60)','fixed_price',9,1),
('GONZALO LALIN','Dry Poroso (1,50)','fixed_price',8,1),
('GONZALO LALIN','Adis Elastizado (1,50)','fixed_price',7.65,1),
('GONZALO LALIN','Modal (1,50)','fixed_price',9,1),
('GONZALO LALIN','Jacquard Elite 1,83','fixed_price',14,1),
('GONZALO LALIN','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- CAMILO-7008
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('CAMILO-7008','TC Tela cliente','fixed_price',7,1),
('CAMILO-7008','Bandera fina (1,60) (68g)','fixed_price',8,1),
('CAMILO-7008','Hexagonal (1,83)','fixed_price',9.5,1),
('CAMILO-7008','Dry Microporoso 1.83 (lado  poroso)','fixed_price',9,1),
('CAMILO-7008','Dry Microporoso 1.83 (lado  liso)','fixed_price',9,1),
('CAMILO-7008','Dry Pro (1,80)','fixed_price',8.5,1),
('CAMILO-7008','Bandera (1,60)','fixed_price',10,1),
('CAMILO-7008','Mykonos (1,60)','fixed_price',10,1),
('CAMILO-7008','Dry Poroso (1,50)','fixed_price',8,1),
('CAMILO-7008','Adis Elastizado (1,50)','fixed_price',7.65,1),
('CAMILO-7008','Modal (1,50)','fixed_price',9,1),
('CAMILO-7008','Jacquard Elite 1,83','fixed_price',14,1),
('CAMILO-7008','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- MP-1899 (aparece dos veces en la planilla, mismo precio)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('MP-1899','TC Tela cliente','fixed_price',7,1),
('MP-1899','Bandera fina (1,60) (68g)','fixed_price',8,1),
('MP-1899','Dry Poroso (1,50)','fixed_price',8,1),
('MP-1899','Adis Elastizado (1,50)','fixed_price',7.65,1),
('MP-1899','Modal (1,50)','fixed_price',9,1),
('MP-1899','Jacquard Elite 1,83','fixed_price',14,1),
('MP-1899','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- nperez
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('nperez','TC Tela cliente','fixed_price',7,1),
('nperez','Bandera fina (1,60) (68g)','fixed_price',8,1),
('nperez','Hexagonal (1,83)','fixed_price',9,1),
('nperez','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8,1),
('nperez','Dry Microporoso 1.83 (lado  liso)','fixed_price',8,1),
('nperez','Dry Pro (1,80)','fixed_price',8,1),
('nperez','Dry Poroso (1,50)','fixed_price',8,1),
('nperez','Adis Elastizado (1,50)','fixed_price',7.65,1),
('nperez','Modal (1,50)','fixed_price',9,1),
('nperez','Jacquard Elite 1,83','fixed_price',14,1),
('nperez','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- FVR
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('FVR','TC Tela cliente','fixed_price',7,1),
('FVR','Bandera fina (1,60) (68g)','fixed_price',8,1),
('FVR','Dry Poroso (1,50)','fixed_price',8,1),
('FVR','Adis Elastizado (1,50)','fixed_price',7.65,1),
('FVR','Modal (1,50)','fixed_price',9,1),
('FVR','Jacquard Elite 1,83','fixed_price',14,1),
('FVR','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- 98545436
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('98545436','TC Tela cliente','fixed_price',7,1),
('98545436','Bandera fina (1,60) (68g)','fixed_price',8,1),
('98545436','Hexagonal (1,83)','fixed_price',12,1),
('98545436','Dry Microporoso 1.83 (lado  poroso)','fixed_price',12,1),
('98545436','Dry Microporoso 1.83 (lado  liso)','fixed_price',12,1),
('98545436','Dry Poroso (1,50)','fixed_price',8,1),
('98545436','Adis Elastizado (1,50)','fixed_price',7.65,1),
('98545436','Modal (1,50)','fixed_price',9,1),
('98545436','Jacquard Elite 1,83','fixed_price',14,1),
('98545436','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- colortext
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('colortext','Bandera fina (1,60) (68g)','fixed_price',8,1),
('colortext','Bandera (1,60)','fixed_price',10,1),
('colortext','Dry Poroso (1,50)','fixed_price',8,1),
('colortext','Adis Elastizado (1,50)','fixed_price',7.65,1),
('colortext','Modal (1,50)','fixed_price',9,1),
('colortext','Jacquard Elite 1,83','fixed_price',14,1),
('colortext','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- Kova
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Kova','TC Tela cliente','fixed_price',7,1),
('Kova','Bandera fina (1,60) (68g)','fixed_price',8,1),
('Kova','Dry Rajchman (1,83)','fixed_price',8,1),
('Kova','Hexagonal (1,83)','fixed_price',8,1),
('Kova','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8,1),
('Kova','Dry Microporoso 1.83 (lado  liso)','fixed_price',8,1),
('Kova','Dry Pro (1,80)','fixed_price',8,1),
('Kova','Dry Poroso (1,50)','fixed_price',8,1),
('Kova','Adis Elastizado (1,50)','fixed_price',7.65,1),
('Kova','Modal (1,50)','fixed_price',9,1),
('Kova','Jacquard Elite 1,83','fixed_price',14,1),
('Kova','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- 99487358
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('99487358','TC Tela cliente','fixed_price',7,1),
('99487358','Bandera fina (1,60) (68g)','fixed_price',8,1),
('99487358','Hexagonal (1,83)','fixed_price',9.5,1),
('99487358','Dry Microporoso 1.83 (lado  poroso)','fixed_price',7,1),
('99487358','Dry Microporoso 1.83 (lado  liso)','fixed_price',7,1),
('99487358','Dry Pro (1,80)','fixed_price',8.5,1),
('99487358','Bandera (1,60)','fixed_price',11,1),
('99487358','Dry Poroso (1,50)','fixed_price',8,1),
('99487358','Adis Elastizado (1,50)','fixed_price',7.65,1),
('99487358','Modal (1,50)','fixed_price',9,1),
('99487358','Jacquard Elite 1,83','fixed_price',14,1),
('99487358','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- KIME
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('KIME','Papel','fixed_price',5.25,1),
('KIME','TC Tela cliente','fixed_price',7,1),
('KIME','Bandera fina (1,60) (68g)','fixed_price',8,1),
('KIME','Dry Poroso (1,50)','fixed_price',8,1),
('KIME','Adis Elastizado (1,50)','fixed_price',7.65,1),
('KIME','Modal (1,50)','fixed_price',9,1),
('KIME','Jacquard Elite 1,83','fixed_price',14,1),
('KIME','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- CEMA / POYOTE / FVR / MP-1899 (misma tarifa base)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('CEMA','TC Tela cliente','fixed_price',7,1),
('CEMA','Bandera fina (1,60) (68g)','fixed_price',8,1),
('CEMA','Dry Poroso (1,50)','fixed_price',8,1),
('CEMA','Adis Elastizado (1,50)','fixed_price',7.65,1),
('CEMA','Modal (1,50)','fixed_price',9,1),
('CEMA','Jacquard Elite 1,83','fixed_price',14,1),
('CEMA','Dry Exclusive (1,83)','fixed_price',12,1);

INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'CEMA','POYOTE'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='CEMA';

-- -------------------------------------------------------
-- BREU  (TC Tela y Tela Cliente en 0 = gratis)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('BREU','TC Tela cliente','fixed_price',0,1),
('BREU','Bandera fina (1,60) (68g)','fixed_price',8,1),
('BREU','Dry Poroso (1,50)','fixed_price',8,1),
('BREU','Adis Elastizado (1,50)','fixed_price',7.65,1),
('BREU','Modal (1,50)','fixed_price',9,1),
('BREU','Jacquard Elite 1,83','fixed_price',14,1),
('BREU','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- 98246456
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('98246456','TC Tela cliente','fixed_price',7,1),
('98246456','Bandera fina (1,60) (68g)','fixed_price',8,1),
('98246456','Bandera (1,60)','fixed_price',7,1),
('98246456','Dry Poroso (1,50)','fixed_price',8,1),
('98246456','Adis Elastizado (1,50)','fixed_price',7.65,1),
('98246456','Modal (1,50)','fixed_price',9,1),
('98246456','Jacquard Elite 1,83','fixed_price',14,1),
('98246456','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- Burgos
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Burgos','Papel','fixed_price',6,1),
('Burgos','TC Tela cliente','fixed_price',5,1),
('Burgos','Bandera fina (1,60) (68g)','fixed_price',8,1),
('Burgos','Dry Poroso (1,50)','fixed_price',8,1),
('Burgos','Adis Elastizado (1,50)','fixed_price',7.65,1),
('Burgos','Modal (1,50)','fixed_price',9,1),
('Burgos','Jacquard Elite 1,83','fixed_price',14,1),
('Burgos','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- juangarcia
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('juangarcia','Papel','fixed_price',5,1),
('juangarcia','TC Tela cliente','fixed_price',5,1),
('juangarcia','Bandera fina (1,60) (68g)','fixed_price',8,1),
('juangarcia','Dry Poroso (1,50)','fixed_price',8,1),
('juangarcia','Adis Elastizado (1,50)','fixed_price',7.65,1),
('juangarcia','Modal (1,50)','fixed_price',9,1),
('juangarcia','Jacquard Elite 1,83','fixed_price',14,1),
('juangarcia','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- Yesusport  (descuento ~10% sobre lista: precios específicos)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Yesusport','Papel','fixed_price',5.95,1),
('Yesusport','TC Tela cliente','fixed_price',6.8,1),
('Yesusport','Toalla (1,83)','fixed_price',8.5,1),
('Yesusport','Bandera mesh (1,60) (110g)','fixed_price',8.5,1),
('Yesusport','Bandera fina (1,60) (68g)','fixed_price',7.65,1),
('Yesusport','Dry Rajchman (1,83)','fixed_price',8.5,1),
('Yesusport','Hexagonal (1,83)','fixed_price',8.93,1),
('Yesusport','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8.5,1),
('Yesusport','Dry Microporoso 1.83 (lado  liso)','fixed_price',8.5,1),
('Yesusport','Adis Elastizado (1,83)','fixed_price',10.2,1),
('Yesusport','Saten (1,50)','fixed_price',8.5,1),
('Yesusport','Dry Pro (1,80)','fixed_price',8.5,1),
('Yesusport','Bandera (1,60)','fixed_price',8.5,1),
('Yesusport','Panama (1,50)','fixed_price',7.65,1),
('Yesusport','Adis (1,60)','fixed_price',7.65,1),
('Yesusport','Micro fibra (1,50)','fixed_price',7.65,1),
('Yesusport','Polar (1,50)','fixed_price',8.5,1),
('Yesusport','Mykonos (1,60)','fixed_price',10.2,1),
('Yesusport','Deportiva (1,60)','fixed_price',9.35,1),
('Yesusport','Dry Poroso (1,50)','fixed_price',7.65,1),
('Yesusport','Bandera Confeccionada (1,50x0,85)','fixed_price',255,1),
('Yesusport','Adis Elastizado (1,50)','fixed_price',7.65,1),
('Yesusport','Modal (1,50)','fixed_price',6.8,1),
('Yesusport','Lycra (1,60)','fixed_price',10.2,1),
('Yesusport','Micropolar (1,50)','fixed_price',8.5,1),
('Yesusport','Jacquard Elite 1,83','fixed_price',11.05,1),
('Yesusport','Jacquard Supreme 1,83','fixed_price',11.05,1),
('Yesusport','Rib 1,70 (Cuellos y vivos tela Elite y Supreme)','fixed_price',10.2,1),
('Yesusport','Dry Exclusive (1,83)','fixed_price',10.2,1),
('Yesusport','Scuba 1,80','fixed_price',11.05,1),
('Yesusport','Jacquard 1,83 (Lado poroso)','fixed_price',8.5,1),
('Yesusport','Jacquard 1,83 (lado liso)','fixed_price',8.5,1),
('Yesusport','Vinilo Microperforado 1,50','fixed_price',8.5,1),
('Yesusport','Bandera Confeccionada (1,50x0,90)','fixed_price',255,1),
('Yesusport','ESPECIAL F','fixed_price',170,1),
('Yesusport','Jacquard Charrúa (1,83)','fixed_price',11.05,1),
('Yesusport','Dry Liso (1,83)','fixed_price',8.5,1),
('Yesusport','Dry pique grueso (1,80)','fixed_price',7.65,1),
('Yesusport','Interlock feria (1,80)','fixed_price',6.8,1),
('Yesusport','Mykonos (1,80)','fixed_price',10.2,1),
('Yesusport','Adis Elastizado fino (1,83)','fixed_price',8.5,1),
('Yesusport','Adis Elastizado grueso (1,83)','fixed_price',10.2,1),
('Yesusport','Panama (1,60)','fixed_price',7.65,1),
('Yesusport','Toalla (1,60)','fixed_price',6.8,1),
('Yesusport','Modal Brillo (1,80)','fixed_price',7.65,1);

-- -------------------------------------------------------
-- ventas@apcabezas.com  /  Con Nacional a todos lados  (mismos precios)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('ventas@apcabezas.com','Papel','fixed_price',6.3,1),
('ventas@apcabezas.com','TC Tela cliente','fixed_price',7.2,1),
('ventas@apcabezas.com','Toalla (1,83)','fixed_price',9,1),
('ventas@apcabezas.com','Bandera mesh (1,60) (110g)','fixed_price',9,1),
('ventas@apcabezas.com','Bandera fina (1,60) (68g)','fixed_price',8.1,1),
('ventas@apcabezas.com','Dry Rajchman (1,83)','fixed_price',9,1),
('ventas@apcabezas.com','Hexagonal (1,83)','fixed_price',9.45,1),
('ventas@apcabezas.com','Dry Microporoso 1.83 (lado  poroso)','fixed_price',9,1),
('ventas@apcabezas.com','Dry Microporoso 1.83 (lado  liso)','fixed_price',9,1),
('ventas@apcabezas.com','Adis Elastizado (1,83)','fixed_price',10.8,1),
('ventas@apcabezas.com','Saten (1,50)','fixed_price',9,1),
('ventas@apcabezas.com','Dry Pro (1,80)','fixed_price',9,1),
('ventas@apcabezas.com','Bandera (1,60)','fixed_price',9,1),
('ventas@apcabezas.com','Panama (1,50)','fixed_price',8.1,1),
('ventas@apcabezas.com','Adis (1,60)','fixed_price',8.1,1),
('ventas@apcabezas.com','Micro fibra (1,50)','fixed_price',8.1,1),
('ventas@apcabezas.com','Polar (1,50)','fixed_price',9,1),
('ventas@apcabezas.com','Mykonos (1,60)','fixed_price',10.8,1),
('ventas@apcabezas.com','Deportiva (1,60)','fixed_price',9.9,1),
('ventas@apcabezas.com','Dry Poroso (1,50)','fixed_price',8.1,1),
('ventas@apcabezas.com','Bandera Confeccionada (1,50x0,85)','fixed_price',270,1),
('ventas@apcabezas.com','Adis Elastizado (1,50)','fixed_price',8.1,1),
('ventas@apcabezas.com','Modal (1,50)','fixed_price',7.2,1),
('ventas@apcabezas.com','Lycra (1,60)','fixed_price',10.8,1),
('ventas@apcabezas.com','Micropolar (1,50)','fixed_price',9,1),
('ventas@apcabezas.com','Jacquard Elite 1,83','fixed_price',11.7,1),
('ventas@apcabezas.com','Jacquard Supreme 1,83','fixed_price',11.7,1),
('ventas@apcabezas.com','Rib 1,70 (Cuellos y vivos tela Elite y Supreme)','fixed_price',10.8,1),
('ventas@apcabezas.com','Dry Exclusive (1,83)','fixed_price',10.8,1),
('ventas@apcabezas.com','Scuba 1,80','fixed_price',11.7,1),
('ventas@apcabezas.com','Jacquard 1,83 (Lado poroso)','fixed_price',9,1),
('ventas@apcabezas.com','Jacquard 1,83 (lado liso)','fixed_price',9,1),
('ventas@apcabezas.com','Vinilo Microperforado 1,50','fixed_price',9,1),
('ventas@apcabezas.com','Bandera Confeccionada (1,50x0,90)','fixed_price',270,1),
('ventas@apcabezas.com','ESPECIAL F','fixed_price',180,1),
('ventas@apcabezas.com','Jacquard Charrúa (1,83)','fixed_price',11.7,1),
('ventas@apcabezas.com','Dry Liso (1,83)','fixed_price',9,1),
('ventas@apcabezas.com','Dry pique grueso (1,80)','fixed_price',8.1,1),
('ventas@apcabezas.com','Interlock feria (1,80)','fixed_price',7.2,1),
('ventas@apcabezas.com','Mykonos (1,80)','fixed_price',10.8,1),
('ventas@apcabezas.com','Adis Elastizado fino (1,83)','fixed_price',9,1),
('ventas@apcabezas.com','Adis Elastizado grueso (1,83)','fixed_price',10.8,1),
('ventas@apcabezas.com','Panama (1,60)','fixed_price',8.1,1),
('ventas@apcabezas.com','Toalla (1,60)','fixed_price',7.2,1),
('ventas@apcabezas.com','Modal Brillo (1,80)','fixed_price',8.1,1);

-- Con Nacional a todos lados tiene exactamente los mismos precios
INSERT INTO #PreciosNuevos
SELECT REPLACE(CodigoCliente,'ventas@apcabezas.com','Con Nacional a todos lados'),NombreProd,TipoRegla,Valor,MonIdMoneda
FROM #PreciosNuevos WHERE CodigoCliente='ventas@apcabezas.com';

-- -------------------------------------------------------
-- CR-755 / 3p3 / Agusviviani (tarifa mínima común)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('CR-755','Bandera fina (1,60) (68g)','fixed_price',8,1),
('CR-755','Dry Poroso (1,50)','fixed_price',8,1),
('CR-755','Adis Elastizado (1,50)','fixed_price',7.65,1),
('CR-755','Modal (1,50)','fixed_price',9,1),
('CR-755','Jacquard Elite 1,83','fixed_price',14,1),
('CR-755','Dry Exclusive (1,83)','fixed_price',12,1);

INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'CR-755','3p3'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='CR-755';
INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'CR-755','GANDINI-979'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='CR-755';

-- Agusviviani agrega Toalla (1,50) = 8
INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'CR-755','Agusviviani'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='CR-755';
INSERT INTO #PreciosNuevos VALUES('Agusviviani','Toalla (1,50)','fixed_price',8,1);
-- GANDINI agrega Hexagonal=9
INSERT INTO #PreciosNuevos VALUES('GANDINI-979','Hexagonal (1,83)','fixed_price',9,1);

-- -------------------------------------------------------
-- boracsport  /  RED SPORT  /  German Rodriguez  /  Imprenta Rojo Srl
-- (misma grilla de precios)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('boracsport','Papel','fixed_price',5.6,1),
('boracsport','TC Tela cliente','fixed_price',6.4,1),
('boracsport','Toalla (1,83)','fixed_price',6.4,1),
('boracsport','Bandera mesh (1,60) (110g)','fixed_price',9.6,1),
('boracsport','Bandera fina (1,60) (68g)','fixed_price',6.4,1),
('boracsport','Dry Rajchman (1,83)','fixed_price',8,1),
('boracsport','Hexagonal (1,83)','fixed_price',8.4,1),
('boracsport','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8,1),
('boracsport','Dry Microporoso 1.83 (lado  liso)','fixed_price',8,1),
('boracsport','Adis Elastizado (1,83)','fixed_price',7.2,1),
('boracsport','Saten (1,50)','fixed_price',8,1),
('boracsport','Bandera (1,60)','fixed_price',9.6,1),
('boracsport','Panama (1,50)','fixed_price',7.2,1),
('boracsport','Adis (1,60)','fixed_price',7.2,1),
('boracsport','Micro fibra (1,50)','fixed_price',8,1),
('boracsport','Polar (1,50)','fixed_price',8,1),
('boracsport','Mykonos (1,60)','fixed_price',8.8,1),
('boracsport','Deportiva (1,60)','fixed_price',9.6,1),
('boracsport','Dry Poroso (1,50)','fixed_price',6.4,1),
('boracsport','Adis Elastizado (1,50)','fixed_price',7.65,1),
('boracsport','Modal (1,50)','fixed_price',7.2,1),
('boracsport','Lycra (1,60)','fixed_price',9.6,1),
('boracsport','Micropolar (1,50)','fixed_price',8,1),
('boracsport','Jacquard Elite 1,83','fixed_price',14,1),
('boracsport','Dry Exclusive (1,83)','fixed_price',12,1);

INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'boracsport','RED SPORT'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='boracsport';

-- German Rodriguez / Imprenta Rojo Srl (misma grilla que boracsport + extras)
INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'boracsport','German Rodriguez'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='boracsport';
INSERT INTO #PreciosNuevos VALUES
('German Rodriguez','Bandera Confeccionada (1,50x0,85)','fixed_price',240,1),
('German Rodriguez','Adis Elastizado (1,50)','fixed_price',6.12,1),  -- overrides boracsport value
('German Rodriguez','Lycra (1,60)','fixed_price',9.6,1),
('German Rodriguez','Jacquard Elite 1,83','fixed_price',11.2,1),
('German Rodriguez','Jacquard Supreme 1,83','fixed_price',11.2,1),
('German Rodriguez','Rib 1,70 (Cuellos y vivos tela Elite y Supreme)','fixed_price',11.2,1),
('German Rodriguez','Dry Exclusive (1,83)','fixed_price',9.6,1),
('German Rodriguez','Scuba 1,80','fixed_price',9.6,1),
('German Rodriguez','Jacquard 1,83 (Lado poroso)','fixed_price',8,1);

INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'German Rodriguez','Imprenta Rojo Srl'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='German Rodriguez';

-- -------------------------------------------------------
-- GERARDO  /  94378692  (misma grilla)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('GERARDO','Papel','fixed_price',5.25,1),
('GERARDO','TC Tela cliente','fixed_price',6,1),
('GERARDO','Toalla (1,83)','fixed_price',6,1),
('GERARDO','Bandera mesh (1,60) (110g)','fixed_price',9,1),
('GERARDO','Bandera fina (1,60) (68g)','fixed_price',6,1),
('GERARDO','Dry Rajchman (1,83)','fixed_price',7.5,1),
('GERARDO','Hexagonal (1,83)','fixed_price',7.88,1),
('GERARDO','Dry Microporoso 1.83 (lado  poroso)','fixed_price',7.5,1),
('GERARDO','Dry Microporoso 1.83 (lado  liso)','fixed_price',7.5,1),
('GERARDO','Adis Elastizado (1,83)','fixed_price',6.75,1),
('GERARDO','Dry Pro (1,80)','fixed_price',7.13,1),
('GERARDO','Bandera (1,60)','fixed_price',9,1),
('GERARDO','Panama (1,50)','fixed_price',6.75,1),
('GERARDO','Adis (1,60)','fixed_price',6.75,1),
('GERARDO','Dry Poroso (1,50)','fixed_price',7.5,1),
('GERARDO','Adis Elastizado (1,50)','fixed_price',7.65,1),
('GERARDO','Modal (1,50)','fixed_price',9,1),
('GERARDO','Jacquard Elite 1,83','fixed_price',14,1),
('GERARDO','Dry Exclusive (1,83)','fixed_price',12,1);

INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'GERARDO','94378692'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='GERARDO';

-- -------------------------------------------------------
-- Simple-Inc
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Simple-Inc','Papel','fixed_price',5.95,1),
('Simple-Inc','TC Tela cliente','fixed_price',6.8,1),
('Simple-Inc','Toalla (1,83)','fixed_price',6.8,1),
('Simple-Inc','Bandera mesh (1,60) (110g)','fixed_price',10.2,1),
('Simple-Inc','Bandera fina (1,60) (68g)','fixed_price',6.8,1),
('Simple-Inc','Dry Rajchman (1,83)','fixed_price',8.5,1),
('Simple-Inc','Hexagonal (1,83)','fixed_price',8.93,1),
('Simple-Inc','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8.5,1),
('Simple-Inc','Dry Microporoso 1.83 (lado  liso)','fixed_price',8.5,1),
('Simple-Inc','Adis Elastizado (1,83)','fixed_price',7.65,1),
('Simple-Inc','Dry Pro (1,80)','fixed_price',8.08,1),
('Simple-Inc','Bandera (1,60)','fixed_price',10.2,1),
('Simple-Inc','Panama (1,50)','fixed_price',7.65,1),
('Simple-Inc','Adis (1,60)','fixed_price',7.65,1),
('Simple-Inc','Dry Poroso (1,50)','fixed_price',8.5,1),
('Simple-Inc','Adis Elastizado (1,50)','fixed_price',7.65,1),
('Simple-Inc','Modal (1,50)','fixed_price',9,1),
('Simple-Inc','Jacquard Elite 1,83','fixed_price',14,1),
('Simple-Inc','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- 70195700016
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('70195700016','Bandera fina (1,60) (68g)','fixed_price',8,1),
('70195700016','Dry Rajchman (1,83)','fixed_price',8,1),
('70195700016','Hexagonal (1,83)','fixed_price',9.5,1),
('70195700016','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8,1),
('70195700016','Dry Microporoso 1.83 (lado  liso)','fixed_price',8,1),
('70195700016','Bandera (1,60)','fixed_price',9,1),
('70195700016','Dry Poroso (1,50)','fixed_price',8,1),
('70195700016','Adis Elastizado (1,50)','fixed_price',7.65,1),
('70195700016','Modal (1,50)','fixed_price',9,1),
('70195700016','Jacquard Elite 1,83','fixed_price',14,1),
('70195700016','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- costadeportesmercado (formato diferente: los campos son el nombre directamente)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('costadeportesmercado','Dry Rajchman (1,83)','fixed_price',8,1),
('costadeportesmercado','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8,1),
('costadeportesmercado','Dry Microporoso 1.83 (lado  liso)','fixed_price',8,1),
('costadeportesmercado','Dry Pro (1,80)','fixed_price',9,1),
('costadeportesmercado','Mykonos (1,60)','fixed_price',9,1),
('costadeportesmercado','Dry Liso (1,83)','fixed_price',8,1),
('costadeportesmercado','Jacquard city 1,83','fixed_price',10,1),
('costadeportesmercado','Dry Microporoso 1.77 (lado  poroso)','fixed_price',7,1),
('costadeportesmercado','Dry Microporoso 1.77 (lado  liso)','fixed_price',7,1),
('costadeportesmercado','Dry liso milan 1,83','fixed_price',7,1),
('costadeportesmercado','Hexagonal (1,83)','fixed_price',8.5,1),
('costadeportesmercado','Delta (1,72 m)','fixed_price',10,1);

-- -------------------------------------------------------
-- Claudia Figueroa
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Claudia Figueroa','Papel','fixed_price',5,1),
('Claudia Figueroa','Bandera fina (1,60) (68g)','fixed_price',8,1),
('Claudia Figueroa','Dry Rajchman (1,83)','fixed_price',9,1),
('Claudia Figueroa','Hexagonal (1,83)','fixed_price',9.5,1),
('Claudia Figueroa','Dry Microporoso 1.83 (lado  poroso)','fixed_price',9,1),
('Claudia Figueroa','Dry Microporoso 1.83 (lado  liso)','fixed_price',9,1),
('Claudia Figueroa','Dry Poroso (1,50)','fixed_price',8,1),
('Claudia Figueroa','Adis Elastizado (1,50)','fixed_price',7.65,1),
('Claudia Figueroa','Modal (1,50)','fixed_price',9,1),
('Claudia Figueroa','Jacquard Elite 1,83','fixed_price',14,1),
('Claudia Figueroa','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- AUGE SPORTS
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('AUGE SPORTS','Papel','fixed_price',6,1),
('AUGE SPORTS','TC Tela cliente','fixed_price',7,1),
('AUGE SPORTS','Toalla (1,83)','fixed_price',7,1),
('AUGE SPORTS','Bandera mesh (1,60) (110g)','fixed_price',11,1),
('AUGE SPORTS','Bandera fina (1,60) (68g)','fixed_price',8,1),
('AUGE SPORTS','Dry Rajchman (1,83)','fixed_price',9,1),
('AUGE SPORTS','Hexagonal (1,83)','fixed_price',9.5,1),
('AUGE SPORTS','Dry Microporoso 1.83 (lado  poroso)','fixed_price',9,1),
('AUGE SPORTS','Dry Microporoso 1.83 (lado  liso)','fixed_price',9,1),
('AUGE SPORTS','Adis Elastizado (1,83)','fixed_price',11,1),
('AUGE SPORTS','Saten (1,50)','fixed_price',9,1),
('AUGE SPORTS','Dry Pro (1,80)','fixed_price',8,1),
('AUGE SPORTS','Bandera (1,60)','fixed_price',11,1),
('AUGE SPORTS','Panama (1,50)','fixed_price',8,1),
('AUGE SPORTS','Adis (1,60)','fixed_price',8,1),
('AUGE SPORTS','Micro fibra (1,50)','fixed_price',8,1),
('AUGE SPORTS','Polar (1,50)','fixed_price',9,1),
('AUGE SPORTS','Mykonos (1,60)','fixed_price',10,1),
('AUGE SPORTS','Deportiva (1,60)','fixed_price',11,1),
('AUGE SPORTS','Dry Poroso (1,50)','fixed_price',9,1),
('AUGE SPORTS','Bandera Confeccionada (1,50x0,85)','fixed_price',299,1),
('AUGE SPORTS','Adis Elastizado (1,50)','fixed_price',8,1),
('AUGE SPORTS','Modal (1,50)','fixed_price',4,1),
('AUGE SPORTS','Lycra (1,60)','fixed_price',11,1),
('AUGE SPORTS','Micropolar (1,50)','fixed_price',9,1),
('AUGE SPORTS','Jacquard Elite 1,83','fixed_price',9.5,1),
('AUGE SPORTS','Jacquard Supreme 1,83','fixed_price',9.5,1),
('AUGE SPORTS','Rib 1,70 (Cuellos y vivos tela Elite y Supreme)','fixed_price',9.5,1),
('AUGE SPORTS','Dry Exclusive (1,83)','fixed_price',9.5,1),
('AUGE SPORTS','Scuba 1,80','fixed_price',11,1),
('AUGE SPORTS','Jacquard 1,83 (Lado poroso)','fixed_price',9,1),
('AUGE SPORTS','Jacquard 1,83 (lado liso)','fixed_price',9,1),
('AUGE SPORTS','Bandera Confeccionada (1,50x0,90)','fixed_price',299,1),
('AUGE SPORTS','ESPECIAL F','fixed_price',199,1),
('AUGE SPORTS','Dry Liso (1,83)','fixed_price',9.5,1);

-- -------------------------------------------------------
-- capa
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('capa','Toalla (1,83)','fixed_price',10,1),
('capa','Dry Rajchman (1,83)','fixed_price',9,1),
('capa','Hexagonal (1,83)','fixed_price',9.5,1),
('capa','Dry Microporoso 1.83 (lado  poroso)','fixed_price',9,1),
('capa','Dry Microporoso 1.83 (lado  liso)','fixed_price',9,1),
('capa','Adis Elastizado (1,83)','fixed_price',11,1),
('capa','Adis (1,60)','fixed_price',7,1),
('capa','Mykonos (1,60)','fixed_price',10.5,1),
('capa','Bandera Confeccionada (1,50x0,85)','fixed_price',250,1),
('capa','Adis Elastizado (1,50)','fixed_price',7.65,1),
('capa','Modal (1,50)','fixed_price',9,1),
('capa','Jacquard Elite 1,83','fixed_price',14,1),
('capa','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- ChaRo
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('ChaRo','TC Tela cliente','fixed_price',6,1),
('ChaRo','Bandera fina (1,60) (68g)','fixed_price',8,1),
('ChaRo','Dry Microporoso 1.83 (lado  poroso)','fixed_price',12,1),
('ChaRo','Dry Poroso (1,50)','fixed_price',8,1),
('ChaRo','Adis Elastizado (1,50)','fixed_price',7.65,1),
('ChaRo','Modal (1,50)','fixed_price',9,1),
('ChaRo','Jacquard Elite 1,83','fixed_price',14,1),
('ChaRo','Dry Exclusive (1,83)','fixed_price',12,1);

-- -------------------------------------------------------
-- Matgeor
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Matgeor','Toalla (1,83)','fixed_price',10,1),
('Matgeor','Bandera mesh (1,60) (110g)','fixed_price',10,1),
('Matgeor','Bandera fina (1,60) (68g)','fixed_price',8,1),
('Matgeor','Dry Rajchman (1,83)','fixed_price',7,1),
('Matgeor','Hexagonal (1,83)','fixed_price',7,1),
('Matgeor','Dry Microporoso 1.83 (lado  poroso)','fixed_price',7,1),
('Matgeor','Dry Microporoso 1.83 (lado  liso)','fixed_price',7,1),
('Matgeor','Dry Pro (1,80)','fixed_price',7,1),
('Matgeor','Bandera (1,60)','fixed_price',9,1),
('Matgeor','Mykonos (1,60)','fixed_price',9,1),
('Matgeor','Bandera Confeccionada (1,50x0,85)','fixed_price',250,1),
('Matgeor','Adis Elastizado (1,50)','fixed_price',7.65,1),
('Matgeor','Modal (1,50)','fixed_price',7,1),
('Matgeor','Lycra (1,60)','fixed_price',9,1),
('Matgeor','Jacquard Elite 1,83','fixed_price',9,1),
('Matgeor','Jacquard Supreme 1,83','fixed_price',9,1),
('Matgeor','Rib 1,70 (Cuellos y vivos tela Elite y Supreme)','fixed_price',9,1),
('Matgeor','Dry Exclusive (1,83)','fixed_price',9,1),
('Matgeor','Scuba 1,80','fixed_price',9,1),
('Matgeor','Jacquard 1,83 (Lado poroso)','fixed_price',7,1),
('Matgeor','Jacquard 1,83 (lado liso)','fixed_price',7,1);

-- -------------------------------------------------------
-- PODIUM2024
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('PODIUM2024','Papel','fixed_price',5,1),
('PODIUM2024','TC Tela cliente','fixed_price',6,1),
('PODIUM2024','Toalla (1,83)','fixed_price',6,1),
('PODIUM2024','Bandera mesh (1,60) (110g)','fixed_price',9,1),
('PODIUM2024','Bandera fina (1,60) (68g)','fixed_price',6,1),
('PODIUM2024','Dry Rajchman (1,83)','fixed_price',8,1),
('PODIUM2024','Hexagonal (1,83)','fixed_price',8,1),
('PODIUM2024','Dry Microporoso 1.83 (lado  poroso)','fixed_price',9,1),
('PODIUM2024','Dry Microporoso 1.83 (lado  liso)','fixed_price',9,1),
('PODIUM2024','Adis Elastizado (1,83)','fixed_price',7,1),
('PODIUM2024','Saten (1,50)','fixed_price',8,1),
('PODIUM2024','Bandera (1,60)','fixed_price',9,1),
('PODIUM2024','Panama (1,50)','fixed_price',7,1),
('PODIUM2024','Adis (1,60)','fixed_price',7,1),
('PODIUM2024','Micro fibra (1,50)','fixed_price',8,1),
('PODIUM2024','Polar (1,50)','fixed_price',8,1),
('PODIUM2024','Mykonos (1,60)','fixed_price',8,1),
('PODIUM2024','Deportiva (1,60)','fixed_price',9,1),
('PODIUM2024','Dry Poroso (1,50)','fixed_price',6,1),
('PODIUM2024','Bandera Confeccionada (1,50x0,85)','fixed_price',240,1),
('PODIUM2024','Adis Elastizado (1,50)','fixed_price',6,1),
('PODIUM2024','Modal (1,50)','fixed_price',7,1),
('PODIUM2024','Lycra (1,60)','fixed_price',9,1),
('PODIUM2024','Micropolar (1,50)','fixed_price',8,1),
('PODIUM2024','Jacquard Elite 1,83','fixed_price',11,1),
('PODIUM2024','Jacquard Supreme 1,83','fixed_price',11,1),
('PODIUM2024','Rib 1,70 (Cuellos y vivos tela Elite y Supreme)','fixed_price',11,1),
('PODIUM2024','Dry Exclusive (1,83)','fixed_price',9,1),
('PODIUM2024','Scuba 1,80','fixed_price',9,1),
('PODIUM2024','Jacquard 1,83 (Lado poroso)','fixed_price',8,1);

-- -------------------------------------------------------
-- CAVERA  /  Emprenda  (misma grilla)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('CAVERA','Papel','fixed_price',5.6,1),
('CAVERA','TC Tela cliente','fixed_price',6.4,1),
('CAVERA','Toalla (1,83)','fixed_price',8,1),
('CAVERA','Bandera mesh (1,60) (110g)','fixed_price',8,1),
('CAVERA','Bandera fina (1,60) (68g)','fixed_price',7.2,1),
('CAVERA','Dry Rajchman (1,83)','fixed_price',8,1),
('CAVERA','Hexagonal (1,83)','fixed_price',8.4,1),
('CAVERA','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8,1),
('CAVERA','Dry Microporoso 1.83 (lado  liso)','fixed_price',8,1),
('CAVERA','Adis Elastizado (1,83)','fixed_price',9.6,1),
('CAVERA','Saten (1,50)','fixed_price',8,1),
('CAVERA','Dry Pro (1,80)','fixed_price',8,1),
('CAVERA','Bandera (1,60)','fixed_price',8,1),
('CAVERA','Panama (1,50)','fixed_price',7.2,1),
('CAVERA','Adis (1,60)','fixed_price',7.2,1),
('CAVERA','Micro fibra (1,50)','fixed_price',7.2,1),
('CAVERA','Polar (1,50)','fixed_price',8,1),
('CAVERA','Mykonos (1,60)','fixed_price',9.6,1),
('CAVERA','Deportiva (1,60)','fixed_price',8.8,1),
('CAVERA','Dry Poroso (1,50)','fixed_price',7.2,1),
('CAVERA','Bandera Confeccionada (1,50x0,85)','fixed_price',240,1),
('CAVERA','Adis Elastizado (1,50)','fixed_price',7.2,1),
('CAVERA','Modal (1,50)','fixed_price',6.4,1),
('CAVERA','Lycra (1,60)','fixed_price',9.6,1),
('CAVERA','Micropolar (1,50)','fixed_price',8,1),
('CAVERA','Jacquard Elite 1,83','fixed_price',10.4,1),
('CAVERA','Jacquard Supreme 1,83','fixed_price',10.4,1),
('CAVERA','Rib 1,70 (Cuellos y vivos tela Elite y Supreme)','fixed_price',9.6,1),
('CAVERA','Dry Exclusive (1,83)','fixed_price',9.6,1),
('CAVERA','Scuba 1,80','fixed_price',10.4,1),
('CAVERA','Jacquard 1,83 (Lado poroso)','fixed_price',8,1),
('CAVERA','Jacquard 1,83 (lado liso)','fixed_price',8,1),
('CAVERA','Vinilo Microperforado 1,50','fixed_price',8,1),
('CAVERA','Bandera Confeccionada (1,50x0,90)','fixed_price',240,1),
('CAVERA','ESPECIAL F','fixed_price',160,1),
('CAVERA','Jacquard Charrúa (1,83)','fixed_price',10.4,1),
('CAVERA','Dry Liso (1,83)','fixed_price',8,1),
('CAVERA','Dry pique grueso (1,80)','fixed_price',7.2,1),
('CAVERA','Interlock feria (1,80)','fixed_price',6.4,1),
('CAVERA','Mykonos (1,80)','fixed_price',9.6,1),
('CAVERA','Adis Elastizado fino (1,83)','fixed_price',8,1),
('CAVERA','Adis Elastizado grueso (1,83)','fixed_price',9.6,1),
('CAVERA','Panama (1,60)','fixed_price',7.2,1),
('CAVERA','Toalla (1,60)','fixed_price',6.4,1),
('CAVERA','Modal Brillo (1,80)','fixed_price',7.2,1);

INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'CAVERA','Emprenda'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='CAVERA';

-- -------------------------------------------------------
-- GEEK-423
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('GEEK-423','Bandera Confeccionada (1,50x0,85)','fixed_price',250,1);

-- -------------------------------------------------------
-- ByF
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('ByF','Bandera fina (1,60) (68g)','fixed_price',8,1),
('ByF','Dry Rajchman (1,83)','fixed_price',7,1),
('ByF','Hexagonal (1,83)','fixed_price',9,1),
('ByF','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8,1),
('ByF','Dry Microporoso 1.83 (lado  liso)','fixed_price',8,1),
('ByF','Adis Elastizado (1,83)','fixed_price',12,1),
('ByF','Dry Poroso (1,50)','fixed_price',8,1),
('ByF','Adis Elastizado (1,50)','fixed_price',7,1),
('ByF','Modal (1,50)','fixed_price',9,1),
('ByF','Jacquard Elite 1,83','fixed_price',14,1),
('ByF','Dry Exclusive (1,83)','fixed_price',12,1),
('ByF','Dry Liso (1,83)','fixed_price',7,1);

-- -------------------------------------------------------
-- Nicolas Marichal
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Nicolas Marichal','Dry Rajchman (1,83)','fixed_price',8,1),
('Nicolas Marichal','Hexagonal (1,83)','fixed_price',8,1),
('Nicolas Marichal','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8,1),
('Nicolas Marichal','Dry Microporoso 1.83 (lado  liso)','fixed_price',8,1),
('Nicolas Marichal','Bandera (1,60)','fixed_price',10,1),
('Nicolas Marichal','Jacquard 1,83 (Lado poroso)','fixed_price',8,1),
('Nicolas Marichal','Jacquard 1,83 (lado liso)','fixed_price',8,1),
('Nicolas Marichal','Dry Liso (1,83)','fixed_price',8,1);

-- -------------------------------------------------------
-- Talagorra  /  Lucia  (misma grilla)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Talagorra','Bandera Confeccionada (1,50x0,85)','fixed_price',7.09,1),
('Talagorra','Modal (1,50)','fixed_price',9,1),
('Talagorra','Dry Exclusive (1,83)','fixed_price',12,1);

INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'Talagorra','Lucia'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='Talagorra';

-- -------------------------------------------------------
-- 46011306  /  MaryBrites  (misma grilla)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('46011306','Bandera Confeccionada (1,50x0,85)','fixed_price',200,1),
('46011306','Bandera Confeccionada (1,50x0,90)','fixed_price',200,1);

INSERT INTO #PreciosNuevos SELECT REPLACE(CodigoCliente,'46011306','MaryBrites'),NombreProd,TipoRegla,Valor,MonIdMoneda FROM #PreciosNuevos WHERE CodigoCliente='46011306';

-- -------------------------------------------------------
-- 18902284  (solo productos Adis)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('18902284','Adis Elastizado (1,83)','fixed_price',9.6,1),
('18902284','Adis (1,60)','fixed_price',7.2,1),
('18902284','Adis Elastizado (1,50)','fixed_price',7.2,1),
('18902284','Adis Elastizado fino (1,83)','fixed_price',8,1),
('18902284','Adis Elastizado grueso (1,83)','fixed_price',9.6,1);

-- -------------------------------------------------------
-- Juliocamisetas
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Juliocamisetas','Modal Brillo (1,80)','fixed_price',7,1);

-- -------------------------------------------------------
-- 46661751
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('46661751','Hexagonal (1,83)','fixed_price',8,1),
('46661751','Dry Pro (1,80)','fixed_price',8,1),
('46661751','Dry Pro New (1,80)','fixed_price',8,1);

-- -------------------------------------------------------
-- JBC
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('JBC','Dry Microporoso 1.83 (lado  poroso)','fixed_price',8,1),
('JBC','Dry Microporoso 1.83 (lado  liso)','fixed_price',8,1),
('JBC','Dry Microporoso 1.77 (lado  poroso)','fixed_price',8,1),
('JBC','Dry Microporoso 1.77 (lado  liso)','fixed_price',8,1);

-- -------------------------------------------------------
-- LAP93
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('LAP93','TC Tela cliente','fixed_price',5,1),
('LAP93','Lycra (1,60)','fixed_price',9,1);

-- -------------------------------------------------------
-- pierró  (TC Tela = 9 → precio fijo, no descuento)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('pierró','TC Tela cliente','fixed_price',9,1);

-- -------------------------------------------------------
-- Macrosoft
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Macrosoft','Dry Microporoso 1.83 (lado  poroso)','fixed_price',7,1),
('Macrosoft','Dry Microporoso 1.83 (lado  liso)','fixed_price',7,1),
('Macrosoft','Dry Microporoso 1.77 (lado  poroso)','fixed_price',7,1),
('Macrosoft','Dry Microporoso 1.77 (lado  liso)','fixed_price',7,1),
('Macrosoft','Dry Microporoso new 1.73 (lado  poroso)','fixed_price',7,1),
('Macrosoft','Dry Microporoso new 1.73 (lado  liso)','fixed_price',7,1),
('Macrosoft','Hexagonal (1,83)','fixed_price',8,1),
('Macrosoft','Dry Poroso (1,50)','fixed_price',8,1),
('Macrosoft','Hexagonal (1,80)','fixed_price',8,1);

-- -------------------------------------------------------
-- 54093150  (mayormente 10% pero Hexagonal(1,83) = 8 fijo)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('54093150','Hexagonal (1,83)','fixed_price',8,1);

-- -------------------------------------------------------
-- nathordeix  (TC Tela = 10%)
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('nathordeix','TC Tela cliente','percentage_discount',10,1);

-- -------------------------------------------------------
-- Victoriavarela / 42499588 / NT0707 / 25042001 / VicenteFierro
-- BACKOFF-899 / Upaquiero / Florencia Nanni / MartinaBaez
-- AGUSTINA3 / MBQC26-  → TC Tela cliente = 6 fijo
-- -------------------------------------------------------
INSERT INTO #PreciosNuevos VALUES
('Victoriavarela','TC Tela cliente','fixed_price',6,1),
('42499588','TC Tela cliente','fixed_price',6,1),
('NT0707','TC Tela cliente','fixed_price',6,1),
('25042001','TC Tela cliente','fixed_price',6,1),
('VicenteFierro','TC Tela cliente','fixed_price',6,1),
('BACKOFF-899','TC Tela cliente','fixed_price',6,1),
('Upaquiero','TC Tela cliente','fixed_price',6,1),
('Florencia Nanni','TC Tela cliente','fixed_price',6,1),
('MartinaBaez','TC Tela cliente','fixed_price',6,1),
('AGUSTINA3','TC Tela cliente','fixed_price',6,1),
('MBQC26-','TC Tela cliente','fixed_price',6,1);

-- -------------------------------------------------------
-- Verificación de datos cargados
-- -------------------------------------------------------
PRINT '';
PRINT '=== Resumen de #PreciosNuevos ===';
SELECT CodigoCliente, COUNT(*) AS Reglas FROM #PreciosNuevos GROUP BY CodigoCliente ORDER BY CodigoCliente;

GO

-- ============================================================================
-- PARTE C: CLIENTES CON DESCUENTO GLOBAL 10% (para gestión por perfil)
-- ============================================================================
-- Estos clientes tienen "10%" en TODOS los productos de la planilla.
-- En lugar de insertar N filas por cliente, se recomienda asignarles
-- un PerfilPrecios con TipoRegla='percentage_discount' y Valor=10.
-- La siguiente tabla lista los clientes pendientes de asignación de perfil.
-- ============================================================================
PRINT '';
PRINT '=== Clientes con descuento 10% global (asignar perfil en PerfilesPrecios) ===';
PRINT 'MoreggiT-07, IQUI, DGV, Checha, Rgbcreaciones, Voidnexus';
PRINT '63645889, Dgt, Blass, FloR, TF SPORT, Mia1922';
PRINT 'Belen2917, Alejandro2025, Sebafra33, AMANDO1725';
PRINT 'fplbdm, BDU-494, MATHI1916, DAHIANA2018';
PRINT 'AMANDA 1605, 23juanafaustino24, Fuentesjv, e, Yoa1973';
PRINT 'TheBearKing23 (Maylo Confecciones) → también tienen productos adicionales';
PRINT '';
PRINT 'Clientes con descuento 20% global: ZEUS';

GO

-- ============================================================================
-- PARTE D: INSERCION REAL EN PreciosEspeciales + PreciosEspecialesItems
-- ============================================================================
-- ADVERTENCIA: Ejecutar Partes A-C primero y revisar resultados.
-- Quitar comentarios de la siguiente sección para ejecutar la carga.
-- ============================================================================

/*
BEGIN TRANSACTION;

-- 1. Insertar/actualizar cabecera PreciosEspeciales
MERGE PreciosEspeciales AS T
USING (
    SELECT DISTINCT
        C.CliIdCliente,
        C.CliIdCliente AS ClienteID,
        COALESCE(C.NombreFantasia, C.Nombre) AS NombreCliente
    FROM #PreciosNuevos PN
    JOIN Clientes C ON C.IDCliente = PN.CodigoCliente
                    OR C.NombreFantasia = PN.CodigoCliente
                    OR C.Nombre = PN.CodigoCliente
) AS S ON T.CliIdCliente = S.CliIdCliente
WHEN NOT MATCHED THEN
    INSERT (CliIdCliente, ClienteID, NombreCliente, FechaCreacion, UltimaActualizacion)
    VALUES (S.CliIdCliente, S.ClienteID, S.NombreCliente, GETDATE(), GETDATE())
WHEN MATCHED THEN
    UPDATE SET UltimaActualizacion = GETDATE();

-- 2. Borrar items previos de estos clientes (para recarga limpia)
DELETE PEI
FROM PreciosEspecialesItems PEI
JOIN Clientes C ON C.CliIdCliente = PEI.CliIdCliente
JOIN (SELECT DISTINCT CodigoCliente FROM #PreciosNuevos) PN
  ON C.IDCliente = PN.CodigoCliente
  OR C.NombreFantasia = PN.CodigoCliente
  OR C.Nombre = PN.CodigoCliente;

-- 3. Insertar nuevos items
INSERT INTO PreciosEspecialesItems
    (CliIdCliente, ClienteID, ProIdProducto, CodArticulo, TipoRegla, Valor, MonIdMoneda, MinCantidad)
SELECT
    C.CliIdCliente,
    C.CliIdCliente,
    PM.ProIdProducto,
    PM.CodArticulo,
    PN.TipoRegla,
    PN.Valor,
    PN.MonIdMoneda,
    0  -- sin mínimo de cantidad
FROM #PreciosNuevos PN
JOIN Clientes C ON C.IDCliente = PN.CodigoCliente
                OR C.NombreFantasia = PN.CodigoCliente
                OR C.Nombre = PN.CodigoCliente
JOIN #ProdMap PM ON PM.NombrePlanilla = PN.NombreProd
WHERE PM.ProIdProducto IS NOT NULL;  -- solo productos resueltos

-- 4. Reporte de filas no insertadas (productos sin mapeo)
SELECT PN.CodigoCliente, PN.NombreProd, PN.Valor
FROM #PreciosNuevos PN
JOIN #ProdMap PM ON PM.NombrePlanilla = PN.NombreProd
WHERE PM.ProIdProducto IS NULL
ORDER BY PN.CodigoCliente, PN.NombreProd;

-- 5. Reporte de clientes no encontrados en Clientes
SELECT DISTINCT PN.CodigoCliente
FROM #PreciosNuevos PN
WHERE NOT EXISTS (
    SELECT 1 FROM Clientes C
    WHERE C.IDCliente = PN.CodigoCliente
       OR C.NombreFantasia = PN.CodigoCliente
       OR C.Nombre = PN.CodigoCliente
);

-- COMMIT o ROLLBACK según revisión
-- COMMIT TRANSACTION;
-- ROLLBACK TRANSACTION;
*/

GO
PRINT 'Script cargado correctamente. Revisar resultados y ejecutar Parte D.';
