-- =====================================================================
-- ECOUV FASE 1: VARIANTES POR TIPO + MODELO DE TERMINACIONES
-- =====================================================================
-- IDEMPOTENTE: se puede correr varias veces; solo aplica lo que falte.
--
-- Objetivo:
--   1) El form del portal trabaja con variantes como Sublimación:
--      Lonas / Canvas / Vinilos / Papel-PET / Productos Terminados.
--   2) Terminaciones dejan de ser una ORDEN aparte: quedan asociadas a
--      cada archivo de impresión dentro de la MISMA orden (OrdenTerminaciones).
--   3) Cada material define qué terminaciones acepta (MaterialTerminaciones).
--   4) Productos terminados con dimensiones y terminaciones incluidas,
--      precio cerrado del artículo.
--   5) StockArt.TipoStock clasifica el comportamiento de cada variante
--      (MATERIAL | PRODUCTO_TERMINADO | TERMINACION).
--
-- NOTA PROD: StockArt/articulos los mantiene el ERP (la app nunca escribe
-- ahí). Si el alta de los CodStock 1.1.3.3..7 y la reasignación de artículos
-- se hace por Macrosoft, las secciones A y B no insertan nada (ya existen).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) VARIANTES NUEVAS EN StockArt (grupo 1.3) — solo si no existen
-- ---------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.3')
    INSERT INTO StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar)
    VALUES ('1', '1.3', '1.1.3.3', '3', 'Lonas', 0, 'M2', 1);

IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.4')
    INSERT INTO StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar)
    VALUES ('1', '1.3', '1.1.3.4', '4', 'Canvas', 0, 'M2', 1);

IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.5')
    INSERT INTO StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar)
    VALUES ('1', '1.3', '1.1.3.5', '5', 'Vinilos', 0, 'M2', 1);

IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.6')
    INSERT INTO StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar)
    VALUES ('1', '1.3', '1.1.3.6', '6', 'Papel y PET', 0, 'M2', 1);

IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.7')
    INSERT INTO StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar)
    VALUES ('1', '1.3', '1.1.3.7', '7', 'Productos Terminados', 0, 'U', 1);
GO

-- ---------------------------------------------------------------------
-- B) REASIGNACIÓN DE ARTÍCULOS A SU TIPO (articulos.CodStock)
--    Idempotente por naturaleza (re-ejecutar deja el mismo estado).
--    Clasificación propuesta — REVISAR antes de correr.
-- ---------------------------------------------------------------------
-- LONAS (frontlights, backlights, mesh, lona pasacalles por metro)
UPDATE articulos SET CodStock = '1.1.3.3' WHERE LTRIM(RTRIM(CodArticulo)) IN
 ('1576','1574','1591','1575','1573','1592',      -- Frontlight 1,60 (brillo/mate x reversos)
  '1571','1589','1572','1590',                     -- Frontlight 3,20
  '1627','1628',                                   -- Frontlight hasta 3.17
  '1603','1604',                                   -- Lona Backlight 1,60 / hasta 3,17
  '480',                                           -- Lona Mesh 3,17
  '1587');                                         -- Lona para Pasacalles 0,80 (por metro)

-- CANVAS (por metro)
UPDATE articulos SET CodStock = '1.1.3.4' WHERE LTRIM(RTRIM(CodArticulo)) IN
 ('1606','1569','1601','1614','1615');             -- Canvas Brillo/Mate 0,91 / 1,27 / 1,52

-- VINILOS
UPDATE articulos SET CodStock = '1.1.3.5' WHERE LTRIM(RTRIM(CodArticulo)) IN
 ('1607','1599','1582','1581','1579','1598','1580','1595','1609','1577',
  '1600','1596','1578','1586','1593','1594','1583','1597');

-- PAPEL Y PET
UPDATE articulos SET CodStock = '1.1.3.6' WHERE LTRIM(RTRIM(CodArticulo)) IN
 ('1608','1588');                                  -- Papel Fotográfico 0,87 / PET Backlight 0,91

-- PRODUCTOS TERMINADOS (cuadros, columnera, pasacalles con palo, roll ups armados)
UPDATE articulos SET CodStock = '1.1.3.7' WHERE LTRIM(RTRIM(CodArticulo)) IN
 ('1620','1625','1621','1626','144','130','131','132','1616','127',
  '1622','1617','1623','128','1618','1624','1619','129',   -- Cuadros canvas
  '1610',                                                    -- Columnera 0,77x0,50 + Palo
  '1611','1612','1613',                                      -- Pasacalles 0,77 x 1/2/3 + Palo
  '1602','1605');                                            -- Roll up aluminio + Banner (armados)

-- Ocultar las filas viejas del selector de variantes. OJO: esto va de la mano
-- del deploy del form nuevo (variantMode 'select'); tras la sección B el form
-- viejo queda sin materiales igual, así que migración + deploy van juntos.
UPDATE StockArt SET Mostrar = 0 WHERE LTRIM(RTRIM(CodStock)) IN ('1.1.3.1', '1.1.3.2');
GO

-- ---------------------------------------------------------------------
-- C) TABLA Terminaciones (catálogo)
--    UnidadCobro: 'U' unidad | 'M' metro lineal | 'M2' metro cuadrado
-- ---------------------------------------------------------------------
IF OBJECT_ID('dbo.Terminaciones', 'U') IS NULL
BEGIN
    CREATE TABLE Terminaciones (
        TerminacionID   INT IDENTITY(1,1) PRIMARY KEY,
        Nombre          NVARCHAR(100) NOT NULL,
        CodArticulo     VARCHAR(50) NULL,      -- artículo (1.1.3.2) para precio/facturación
        UnidadCobro     VARCHAR(5) NOT NULL DEFAULT 'U',
        Activo          BIT NOT NULL DEFAULT 1
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM Terminaciones)
BEGIN
    INSERT INTO Terminaciones (Nombre, CodArticulo, UnidadCobro) VALUES
     (N'Colocación de ojales',        '1562', 'U'),
     (N'Soldadura de lona',           '1566', 'M'),
     (N'Palos pasacalle',             '1564', 'U'),
     (N'Bastidor de hierro',          '1561', 'U'),
     (N'Corte de vinilo',             '1563', 'U'),
     (N'Roll up aluminio',            '1465', 'U'),
     (N'Roll up PVC',                 '1565', 'U'),
     (N'Roll up plástico',            '1629', 'U'),
     (N'Banner Pet semibrillo (0,91)','1584', 'U'),
     (N'Banner Pet mate (0,91)',      '1585', 'U'),
     (N'Back pet',                    '28',   'U');
END
GO

-- ---------------------------------------------------------------------
-- D) MaterialTerminaciones: qué acepta cada material
--    (defaults propuestos — se curan después desde el editor)
-- ---------------------------------------------------------------------
IF OBJECT_ID('dbo.MaterialTerminaciones', 'U') IS NULL
BEGIN
    CREATE TABLE MaterialTerminaciones (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        CodArticulo     VARCHAR(50) NOT NULL,   -- material de impresión (articulos)
        TerminacionID   INT NOT NULL REFERENCES Terminaciones(TerminacionID),
        CONSTRAINT UQ_MaterialTerminacion UNIQUE (CodArticulo, TerminacionID)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM MaterialTerminaciones)
BEGIN
    -- Lonas: ojales + soldadura + palos
    INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID)
    SELECT LTRIM(RTRIM(a.CodArticulo)), t.TerminacionID
    FROM articulos a
    CROSS JOIN Terminaciones t
    WHERE LTRIM(RTRIM(a.CodStock)) = '1.1.3.3'
      AND t.Nombre IN (N'Colocación de ojales', N'Soldadura de lona', N'Palos pasacalle');

    -- Canvas: bastidor de hierro
    INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID)
    SELECT LTRIM(RTRIM(a.CodArticulo)), t.TerminacionID
    FROM articulos a
    CROSS JOIN Terminaciones t
    WHERE LTRIM(RTRIM(a.CodStock)) = '1.1.3.4'
      AND t.Nombre = N'Bastidor de hierro';

    -- Vinilos: corte de vinilo
    INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID)
    SELECT LTRIM(RTRIM(a.CodArticulo)), t.TerminacionID
    FROM articulos a
    CROSS JOIN Terminaciones t
    WHERE LTRIM(RTRIM(a.CodStock)) = '1.1.3.5'
      AND t.Nombre = N'Corte de vinilo';

    -- Papel/PET: roll ups y banners pet (displays que se arman sobre estos soportes)
    INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID)
    SELECT LTRIM(RTRIM(a.CodArticulo)), t.TerminacionID
    FROM articulos a
    CROSS JOIN Terminaciones t
    WHERE LTRIM(RTRIM(a.CodStock)) = '1.1.3.6'
      AND t.Nombre IN (N'Roll up aluminio', N'Roll up PVC', N'Roll up plástico');
END
GO

-- ---------------------------------------------------------------------
-- E) OrdenTerminaciones: la terminación pegada al ARCHIVO de la orden
--    (reemplaza a la orden-extra; NO se crea orden nueva)
-- ---------------------------------------------------------------------
IF OBJECT_ID('dbo.OrdenTerminaciones', 'U') IS NULL
BEGIN
    CREATE TABLE OrdenTerminaciones (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        OrdenID         INT NOT NULL,
        ArchivoID       INT NULL,               -- ArchivosOrden.ArchivoID (NULL = general de la orden)
        TerminacionID   INT NOT NULL REFERENCES Terminaciones(TerminacionID),
        Cantidad        DECIMAL(18,2) NOT NULL DEFAULT 1,
        PrecioUnitario  DECIMAL(18,2) NOT NULL DEFAULT 0,
        TotalLinea      DECIMAL(18,2) NOT NULL DEFAULT 0,
        Estado          VARCHAR(20) NOT NULL DEFAULT 'Pendiente',  -- Pendiente | Hecha
        FechaRegistro   DATETIME NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX IX_OrdenTerminaciones_Orden ON OrdenTerminaciones(OrdenID);
END
GO

-- ---------------------------------------------------------------------
-- F) ProductosTerminados: dimensiones + terminaciones incluidas
-- ---------------------------------------------------------------------
IF OBJECT_ID('dbo.ProductosTerminados', 'U') IS NULL
BEGIN
    CREATE TABLE ProductosTerminados (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        CodArticulo     VARCHAR(50) NOT NULL UNIQUE,   -- artículo de 1.1.3.7
        AnchoM          DECIMAL(9,3) NULL,
        AltoM           DECIMAL(9,3) NULL,
        Activo          BIT NOT NULL DEFAULT 1
    );
END
GO

IF OBJECT_ID('dbo.ProductoTerminadoTerminaciones', 'U') IS NULL
BEGIN
    CREATE TABLE ProductoTerminadoTerminaciones (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        ProductoID      INT NOT NULL REFERENCES ProductosTerminados(ID),
        TerminacionID   INT NOT NULL REFERENCES Terminaciones(TerminacionID),
        Cantidad        DECIMAL(18,2) NOT NULL DEFAULT 1,
        CONSTRAINT UQ_ProdTerm UNIQUE (ProductoID, TerminacionID)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM ProductosTerminados)
BEGIN
    -- Seed: dimensiones parseadas del nombre (REVISAR)
    INSERT INTO ProductosTerminados (CodArticulo, AnchoM, AltoM) VALUES
     ('1620', 1.00, 1.00),  -- Cuadro canvas 1,00 x 1,00
     ('1625', 1.10, 0.50),  -- Cuadro canvas 1,10 x 50
     ('1621', 1.20, 1.20),  -- Cuadro canvas 1,20 x 1,20
     ('1626', 1.20, 0.80),  -- Cuadro canvas 1,20 x 80
     ('144',  1.40, 1.00),  -- Cuadro canvas 1,40 x 1,00
     ('130',  1.20, 0.40),  -- Cuadro canvas 1.20 x 40
     ('131',  1.40, 0.60),  -- Cuadro canvas 1.40 x 60
     ('132',  1.60, 0.80),  -- Cuadro canvas 1.60 x 80
     ('1616', 0.25, 0.25),  -- Cuadro canvas 25 x 25
     ('127',  0.35, 0.15),  -- Cuadro canvas 35 x 15
     ('1622', 0.35, 0.15),  -- Cuadro canvas 35 x 15 (duplicado en artículos, revisar)
     ('1617', 0.40, 0.40),  -- Cuadro canvas 40 x 40
     ('1623', 0.50, 0.30),  -- Cuadro canvas 50 x 30
     ('128',  0.60, 0.20),  -- Cuadro canvas 60 x 20
     ('1618', 0.60, 0.60),  -- Cuadro canvas 60 x 60
     ('1624', 0.70, 0.50),  -- Cuadro canvas 70 x 50
     ('1619', 0.80, 0.80),  -- Cuadro canvas 80 x 80
     ('129',  0.90, 0.30),  -- Cuadro canvas 90 x 30
     ('1610', 0.77, 0.50),  -- Columnera 0,77 x 0,50 + Palo
     ('1611', 0.77, 1.00),  -- Pasacalles 0,77 x 1,00 + Palo
     ('1612', 0.77, 2.00),  -- Pasacalles 0,77 x 2,00 + Palo
     ('1613', 0.77, 3.00),  -- Pasacalles 0,77 x 3,00 + Palo
     ('1602', 0.78, NULL),  -- Roll up aluminio + Banner Pet mate 0,78
     ('1605', 0.91, NULL);  -- Roll up aluminio + Banner Pet mate 0,91 ARMADO
END
GO

IF NOT EXISTS (SELECT 1 FROM ProductoTerminadoTerminaciones)
BEGIN
    -- Cuadros canvas → bastidor de hierro
    INSERT INTO ProductoTerminadoTerminaciones (ProductoID, TerminacionID, Cantidad)
    SELECT p.ID, t.TerminacionID, 1
    FROM ProductosTerminados p
    JOIN articulos a ON LTRIM(RTRIM(a.CodArticulo)) = p.CodArticulo
    CROSS JOIN Terminaciones t
    WHERE a.Descripcion LIKE 'Cuadro canvas%' AND t.Nombre = N'Bastidor de hierro';

    -- Pasacalles y columnera → palos + soldadura
    INSERT INTO ProductoTerminadoTerminaciones (ProductoID, TerminacionID, Cantidad)
    SELECT p.ID, t.TerminacionID, CASE WHEN t.Nombre = N'Palos pasacalle' THEN 2 ELSE 1 END
    FROM ProductosTerminados p
    CROSS JOIN Terminaciones t
    WHERE p.CodArticulo IN ('1610','1611','1612','1613')
      AND t.Nombre IN (N'Palos pasacalle', N'Soldadura de lona');

    -- Roll ups armados → estructura roll up aluminio
    INSERT INTO ProductoTerminadoTerminaciones (ProductoID, TerminacionID, Cantidad)
    SELECT p.ID, t.TerminacionID, 1
    FROM ProductosTerminados p
    CROSS JOIN Terminaciones t
    WHERE p.CodArticulo IN ('1602','1605') AND t.Nombre = N'Roll up aluminio';
END
GO

-- ---------------------------------------------------------------------
-- G) TipoStock en StockArt: clasifica el COMPORTAMIENTO de cada variante
--    (MATERIAL | PRODUCTO_TERMINADO | TERMINACION). El form decide por
--    TipoStock, no por CodStock — permite separar 'Productos Terminados'
--    en varias variantes (Cuadros Canvas, Pasacalles...) sin tocar código.
-- ---------------------------------------------------------------------
IF COL_LENGTH('dbo.StockArt', 'TipoStock') IS NULL
    ALTER TABLE StockArt ADD TipoStock VARCHAR(20) NOT NULL DEFAULT 'MATERIAL';
GO

-- OJO PROD: la columna puede PREEXISTIR con valores NULL (ahí `TipoStock <> 'X'`
-- nunca pega porque NULL no compara). Completar el default del grupo primero:
UPDATE StockArt SET TipoStock = 'MATERIAL'
WHERE TipoStock IS NULL AND LTRIM(RTRIM(Grupo)) = '1.3';

UPDATE StockArt SET TipoStock = 'TERMINACION'
WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.2' AND ISNULL(TipoStock, '') <> 'TERMINACION';

UPDATE StockArt SET TipoStock = 'PRODUCTO_TERMINADO'
WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.7' AND ISNULL(TipoStock, '') <> 'PRODUCTO_TERMINADO';
GO

-- ---------------------------------------------------------------------
-- H) SPLIT DE PRODUCTOS TERMINADOS EN VARIANTES ESPECÍFICAS
--    Cuadros Canvas / Pasacalles / Columneras (TipoStock=PRODUCTO_TERMINADO).
--    Los roll ups armados (1602, 1605) quedan en 1.1.3.7 genérica.
-- ---------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.8')
    INSERT INTO StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar, TipoStock)
    VALUES ('1', '1.3', '1.1.3.8', '8', 'Cuadros Canvas', 0, 'U', 1, 'PRODUCTO_TERMINADO');

IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.9')
    INSERT INTO StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar, TipoStock)
    VALUES ('1', '1.3', '1.1.3.9', '9', 'Pasacalles', 0, 'U', 1, 'PRODUCTO_TERMINADO');

IF NOT EXISTS (SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.10')
    INSERT INTO StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar, TipoStock)
    VALUES ('1', '1.3', '1.1.3.10', '10', 'Columneras', 0, 'U', 1, 'PRODUCTO_TERMINADO');
GO

-- Cuadros canvas → 1.1.3.8
UPDATE articulos SET CodStock = '1.1.3.8' WHERE LTRIM(RTRIM(CodArticulo)) IN
 ('1620','1625','1621','1626','144','130','131','132','1616','127',
  '1622','1617','1623','128','1618','1624','1619','129');

-- Pasacalles con palo → 1.1.3.9
UPDATE articulos SET CodStock = '1.1.3.9' WHERE LTRIM(RTRIM(CodArticulo)) IN
 ('1611','1612','1613');

-- Columnera → 1.1.3.10
UPDATE articulos SET CodStock = '1.1.3.10' WHERE LTRIM(RTRIM(CodArticulo)) IN
 ('1610');
GO

-- ---------------------------------------------------------------------
-- I) MATERIAL DE IMPRESIÓN DEL PRODUCTO TERMINADO
--    Un producto terminado se imprime sobre un material concreto
--    (ej. Cuadro canvas brillo 20x20 → Canvas Brillo 0,91). Producción
--    y el costo de impresión salen de este artículo.
-- ---------------------------------------------------------------------
IF COL_LENGTH('dbo.ProductosTerminados', 'MaterialCodArticulo') IS NULL
    ALTER TABLE ProductosTerminados ADD MaterialCodArticulo VARCHAR(50) NULL;
GO

-- ---------------------------------------------------------------------
-- J) ESTADO 'En Terminaciones' (EstadoenArea, padre Produccion)
--    Al salir de control de calidad, una orden ECOUV con terminaciones
--    PENDIENTES pasa a este estado (y EstadoLogistica='En Terminaciones')
--    en vez de ir a 'Pronto'/'Canasto Produccion'. La bandeja de
--    Terminaciones ECOUV la libera con "Finalizar Tarea".
-- ---------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM ConfigEstados WHERE Nombre = 'En Terminaciones' AND TipoEstado = 'ESTADOENAREA')
    INSERT INTO ConfigEstados (EstadoID, AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado, EstadoPadreID)
    SELECT (SELECT MAX(EstadoID) + 1 FROM ConfigEstados),
           'ADMIN', 'En Terminaciones', '#f59e0b', 90, 0, 'ESTADOENAREA', EstadoID
    FROM ConfigEstados WHERE Nombre = 'Produccion' AND TipoEstado = 'ESTADO' AND EstadoPadreID IS NULL;
GO

-- ---------------------------------------------------------------------
-- K) TINTA PREDEFINIDA DEL PRODUCTO TERMINADO
--    El cliente no elige tinta para productos terminados: viene de la
--    ficha (Ecosolvente/UV) y rutea el lote igual que en materiales.
-- ---------------------------------------------------------------------
IF COL_LENGTH('dbo.ProductosTerminados', 'Tinta') IS NULL
    ALTER TABLE ProductosTerminados ADD Tinta VARCHAR(50) NULL;
GO

-- ---------------------------------------------------------------------
-- L) MANERAS DE APLICACIÓN DE TERMINACIONES + UBICACIÓN + BORDE
--    La terminación define DÓNDE va (lados) y CÓMO se sugiere la cantidad;
--    la cantidad final siempre es visible/editable. La ubicación elegida
--    viaja con la orden y con la ficha del producto terminado.
--    Ubicaciones: ARRIBA | ABAJO | ARRIBA_ABAJO | COSTADOS | PERIMETRO
--    ReglaCantidad: FIJA (ParamCantidad=N) | CADA_X_CM (1 cada X cm del
--    tramo) | METROS_TRAMO (cantidad = metros del tramo elegido)
-- ---------------------------------------------------------------------
IF COL_LENGTH('dbo.Terminaciones', 'Ubicaciones') IS NULL
    ALTER TABLE Terminaciones ADD Ubicaciones VARCHAR(200) NULL;
IF COL_LENGTH('dbo.Terminaciones', 'ReglaCantidad') IS NULL
    ALTER TABLE Terminaciones ADD ReglaCantidad VARCHAR(20) NULL;
IF COL_LENGTH('dbo.Terminaciones', 'ParamCantidad') IS NULL
    ALTER TABLE Terminaciones ADD ParamCantidad DECIMAL(9,2) NULL;
IF COL_LENGTH('dbo.Terminaciones', 'ClienteElige') IS NULL
    ALTER TABLE Terminaciones ADD ClienteElige BIT NOT NULL DEFAULT 1;
IF COL_LENGTH('dbo.OrdenTerminaciones', 'Ubicacion') IS NULL
    ALTER TABLE OrdenTerminaciones ADD Ubicacion VARCHAR(30) NULL;
IF COL_LENGTH('dbo.ProductoTerminadoTerminaciones', 'Ubicacion') IS NULL
    ALTER TABLE ProductoTerminadoTerminaciones ADD Ubicacion VARCHAR(30) NULL;
IF COL_LENGTH('dbo.ProductosTerminados', 'BordeCm') IS NULL
    ALTER TABLE ProductosTerminados ADD BordeCm DECIMAL(9,2) NULL;
GO

-- Defaults de manera para las sembradas (solo si aún no tienen regla):
UPDATE Terminaciones SET ReglaCantidad = 'CADA_X_CM', ParamCantidad = 50,
       Ubicaciones = 'ARRIBA,ABAJO,ARRIBA_ABAJO,COSTADOS,PERIMETRO'
WHERE ReglaCantidad IS NULL AND LTRIM(RTRIM(ISNULL(CodArticulo,''))) = '1562';  -- Ojales

UPDATE Terminaciones SET ReglaCantidad = 'METROS_TRAMO', ParamCantidad = NULL,
       Ubicaciones = 'ARRIBA,ABAJO,ARRIBA_ABAJO,COSTADOS,PERIMETRO'
WHERE ReglaCantidad IS NULL AND LTRIM(RTRIM(ISNULL(CodArticulo,''))) = '1566';  -- Soldadura

UPDATE Terminaciones SET ReglaCantidad = 'FIJA', ParamCantidad = 1
WHERE ReglaCantidad IS NULL;  -- resto: cantidad fija 1, sin ubicaciones (libre)
GO

-- ---------------------------------------------------------------------
-- M) ÁREA 'TERMINAC' (Terminaciones ECOUV como área física propia)
--    Decisión de negocio 21/07: orden hermana contenedora (patrón Corte/
--    Costura). Al aprobar control de impresión, la orden ECOUV con
--    terminaciones pendientes genera UNA hermana TERMINAC (remito/candado/
--    etiqueta entre locales gratis) y las OrdenTerminaciones se repuntan
--    a la hermana. Reemplaza al sub-estado 'En Terminaciones'.
-- ---------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM Areas WHERE AreaID = 'TERMINAC')
    INSERT INTO Areas (AreaID, Nombre, Categoria, ui_config, EsEstandar, RenderKey, UM, Requerimientos, Inicial, Productiva, EsProductivo, TieneLogisticaBultos, Entrega)
    VALUES ('TERMINAC', 'Terminaciones ECOUV', 'Procesos', '{}', 1, 'UNIVERSAL_TABLE', 'u', 0, NULL, 1, 1, 1, NULL);
GO

-- ---------------------------------------------------------------------
-- VERIFICACIÓN
-- ---------------------------------------------------------------------
SELECT LTRIM(RTRIM(CodStock)) CodStock, LTRIM(RTRIM(Articulo)) Articulo,
       LTRIM(RTRIM(UM)) UM, Mostrar, TipoStock
FROM StockArt WHERE LTRIM(RTRIM(Grupo)) = '1.3' ORDER BY CodStock;

SELECT LTRIM(RTRIM(CodStock)) AS Tipo, COUNT(*) AS Articulos FROM articulos
WHERE LTRIM(RTRIM(CodStock)) LIKE '1.1.3.%' GROUP BY LTRIM(RTRIM(CodStock)) ORDER BY Tipo;

SELECT (SELECT COUNT(*) FROM Terminaciones)                  AS Terminaciones,
       (SELECT COUNT(*) FROM MaterialTerminaciones)          AS RelacionesMaterialTerm,
       (SELECT COUNT(*) FROM ProductosTerminados)            AS ProductosTerminados,
       (SELECT COUNT(*) FROM ProductoTerminadoTerminaciones) AS TerminacionesIncluidas;
