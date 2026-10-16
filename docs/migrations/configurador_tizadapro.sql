/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR DE PRODUCTOS — integración con TizadaPro y limpieza
   ══════════════════════════════════════════════════════════════════════════
   TizadaPro (base externa del mismo servidor SQL) es el dueño de los moldes:
   piezas, talles, modelos (variantes de piezas), telas permitidas por pieza y
   consumo de tela. Nuestro configurador SOLO vincula cada producto confeccionado
   a su molde de TizadaPro y decide qué modelos y qué telas se venden (y a qué
   precio). Todo lo que duplicaba eso se saca.

   Qué hace (idempotente):
     A. ProductoVentaConfig.TizadaProMoldeRef: el molde de TizadaPro (legacy_id,
        ej. "prod_20260908_144958_f2be" — es la clave estable, el id numérico
        cambia entre restauraciones).
     B. dbo.ProductoModelos: qué modelos del molde se ofrecen (clave de la
        variante de TizadaPro, ej. "v_mowhtr1" = "Cuello V Comun Costadillo Fino").
     C. dbo.ProductoTelas: qué telas se ofrecen para el producto. El precio de la
        tela es el de PreciosBase: acá NO se edita (es competencia de Precios).
     D. LIMPIEZA de lo que TizadaPro reemplaza (todo era configuración/semilla,
        ningún pedido apunta a estas tablas):
          - Moldes escalados: Moldes, MoldePiezas, MoldeNidoTalles, CurvasTalle,
            CurvaTalleItems y la columna ProductoVentaConfig.MoldeID.
          - Componentes de confección: ComponenteOpciones, ComponenteOpcionPiezas,
            ProductoComponentes.
          - Variantes cartesianas: ProductoVariantes y ProductoVentaConfig.CodigoCorto.
          - Nomenclador de piezas: PiezasPrenda (las piezas vienen del molde).
          - Menú /moldes (Modulos + PermisosRoles).
     E. Verificación.

   Requisito en PRODUCCIÓN: el usuario SQL del backend necesita permiso de LECTURA
   sobre la base TizadaPro (ver sección C de scripts/add_solicitudes_tizadapro.sql).
   Orden: correr ANTES del deploy del backend. Correrlo dos veces no cambia nada.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

/* ── A. Vínculo producto → molde de TizadaPro ──────────────────────────── */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD TizadaProMoldeRef NVARCHAR(128) NULL;
    PRINT 'A. Columna ProductoVentaConfig.TizadaProMoldeRef agregada.';
END
ELSE PRINT 'A. ProductoVentaConfig.TizadaProMoldeRef ya existía.';
GO

/* ── B. Modelos ofrecidos ──────────────────────────────────────────────── */
IF OBJECT_ID('dbo.ProductoModelos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoModelos (
        ID            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductoModelos PRIMARY KEY,
        ProIdProducto INT            NOT NULL,
        ModeloClave   NVARCHAR(96)   NOT NULL,   -- TizadaPro variante.clave
        ModeloNombre  NVARCHAR(320)  NULL,       -- copia del label, para mostrar sin ir a TizadaPro
        EsDefault     BIT            NOT NULL CONSTRAINT DF_ProductoModelos_Def DEFAULT (0),
        Orden         INT            NULL,
        CONSTRAINT UQ_ProductoModelos UNIQUE (ProIdProducto, ModeloClave)
    );
    PRINT 'B. Tabla dbo.ProductoModelos creada.';
END
ELSE PRINT 'B. dbo.ProductoModelos ya existía.';
GO

/* ── C. Telas ofrecidas con precio ─────────────────────────────────────── */
IF OBJECT_ID('dbo.ProductoTelas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoTelas (
        ID              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductoTelas PRIMARY KEY,
        ProIdProducto   INT            NOT NULL,
        TelaProIdProducto INT          NOT NULL,   -- Articulos.ProIdProducto de la tela (Sublimación)
        EsDefault       BIT            NOT NULL CONSTRAINT DF_ProductoTelas_Def DEFAULT (0),
        Orden           INT            NULL,
        CONSTRAINT UQ_ProductoTelas UNIQUE (ProIdProducto, TelaProIdProducto)
    );
    PRINT 'C. Tabla dbo.ProductoTelas creada.';
END
ELSE PRINT 'C. dbo.ProductoTelas ya existía.';
-- C2. Si quedó de una versión anterior con precio por tela (solo local): se quita, el precio no se edita acá
IF COL_LENGTH('dbo.ProductoTelas', 'Precio') IS NOT NULL ALTER TABLE dbo.ProductoTelas DROP COLUMN Precio, MonIdMoneda;
GO

/* ── D. Limpieza de lo que TizadaPro reemplaza ─────────────────────────── */
-- D1. Moldes escalados
IF COL_LENGTH('dbo.ProductoVentaConfig', 'MoldeID') IS NOT NULL
BEGIN
    DECLARE @fk SYSNAME;
    SELECT @fk = f.name FROM sys.foreign_keys f JOIN sys.foreign_key_columns c ON c.constraint_object_id = f.object_id
    WHERE f.parent_object_id = OBJECT_ID('dbo.ProductoVentaConfig') AND COL_NAME(c.parent_object_id, c.parent_column_id) = 'MoldeID';
    IF @fk IS NOT NULL EXEC('ALTER TABLE dbo.ProductoVentaConfig DROP CONSTRAINT [' + @fk + ']');
    ALTER TABLE dbo.ProductoVentaConfig DROP COLUMN MoldeID;
    PRINT 'D1. Columna ProductoVentaConfig.MoldeID quitada.';
END
IF OBJECT_ID('dbo.MoldeNidoTalles', 'U') IS NOT NULL DROP TABLE dbo.MoldeNidoTalles;
IF OBJECT_ID('dbo.MoldePiezas', 'U')     IS NOT NULL DROP TABLE dbo.MoldePiezas;
IF OBJECT_ID('dbo.Moldes', 'U')          IS NOT NULL DROP TABLE dbo.Moldes;
IF OBJECT_ID('dbo.CurvaTalleItems', 'U') IS NOT NULL DROP TABLE dbo.CurvaTalleItems;
IF OBJECT_ID('dbo.CurvasTalle', 'U')     IS NOT NULL DROP TABLE dbo.CurvasTalle;
PRINT 'D1. Tablas de moldes escalados quitadas (si existían).';
GO
-- D2. Componentes de confección y variantes cartesianas
IF OBJECT_ID('dbo.ProductoComponentes', 'U')    IS NOT NULL DROP TABLE dbo.ProductoComponentes;
IF OBJECT_ID('dbo.ComponenteOpcionPiezas', 'U') IS NOT NULL DROP TABLE dbo.ComponenteOpcionPiezas;
IF OBJECT_ID('dbo.ComponenteOpciones', 'U')     IS NOT NULL DROP TABLE dbo.ComponenteOpciones;
IF OBJECT_ID('dbo.ProductoVariantes', 'U')      IS NOT NULL DROP TABLE dbo.ProductoVariantes;
IF COL_LENGTH('dbo.ProductoVentaConfig', 'CodigoCorto') IS NOT NULL
    ALTER TABLE dbo.ProductoVentaConfig DROP COLUMN CodigoCorto;
PRINT 'D2. Componentes, variantes cartesianas y CodigoCorto quitados (si existían).';
GO
-- D3. Nomenclador de piezas (las piezas vienen del molde de TizadaPro)
IF OBJECT_ID('dbo.PiezasPrenda', 'U') IS NOT NULL DROP TABLE dbo.PiezasPrenda;
PRINT 'D3. PiezasPrenda quitada (si existía).';
GO
-- D4. Menú /moldes
DELETE pr FROM dbo.PermisosRoles pr JOIN dbo.Modulos m ON m.IdModulo = pr.IdModulo WHERE m.Ruta = '/moldes';
DELETE FROM dbo.Modulos WHERE Ruta = '/moldes';
PRINT CONCAT('D4. Menú /moldes quitado: ', @@ROWCOUNT, ' fila(s).');
GO

/* ── E. Verificación ───────────────────────────────────────────────────── */
SELECT
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS MoldeRef,
    CASE WHEN OBJECT_ID('dbo.ProductoModelos', 'U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS Modelos,
    CASE WHEN OBJECT_ID('dbo.ProductoTelas', 'U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS Telas,
    CASE WHEN OBJECT_ID('dbo.Moldes', 'U') IS NULL AND OBJECT_ID('dbo.ComponenteOpciones', 'U') IS NULL
          AND OBJECT_ID('dbo.ProductoVariantes', 'U') IS NULL AND OBJECT_ID('dbo.PiezasPrenda', 'U') IS NULL THEN 'OK' ELSE 'QUEDÓ ALGO' END AS Limpieza,
    CASE WHEN DB_ID('TizadaPro') IS NOT NULL THEN 'OK' ELSE 'NO ESTÁ EN ESTE SERVIDOR' END AS BaseTizadaPro;
GO

/* ── F. Avíos del producto (ficha de producción) ───────────────────────────
   Insumos que no son tela: cierres, botones, elásticos, etiquetas. Se cargan
   en el paso "Ficha de diseño" y salen impresos en la ficha técnica para
   producción. Nombre libre; opcionalmente apunta a un artículo nuestro. */
IF OBJECT_ID('dbo.ProductoAvios', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoAvios (
        ID             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductoAvios PRIMARY KEY,
        ProIdProducto  INT            NOT NULL,
        Nombre         NVARCHAR(200)  NOT NULL,           -- ej. "Cierre frontal 60 cm"
        ArtProIdProducto INT          NULL,               -- Articulos.ProIdProducto del insumo, si existe
        Cantidad       DECIMAL(10,2)  NOT NULL CONSTRAINT DF_ProductoAvios_Cant DEFAULT (1),  -- por prenda
        Unidad         NVARCHAR(20)   NULL,               -- u, m, cm, par…
        Medida         NVARCHAR(200)  NULL,               -- ej. "S–M 55 cm · L–XXL 60 cm"
        Nota           NVARCHAR(400)  NULL,
        Orden          INT            NULL
    );
    PRINT 'F. Tabla dbo.ProductoAvios creada.';
END
ELSE PRINT 'F. dbo.ProductoAvios ya existía.';
GO

/* ── G. Siluetas de las piezas del molde (contornos leídos del PDF) ───────
   Se sube el PDF del molde una vez por molde; se cruzan sus contornos con las
   cajas por pieza/talle de TizadaPro y queda un dibujo (SVG) por pieza y talle. */
IF OBJECT_ID('dbo.TizadaProMoldePiezas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TizadaProMoldePiezas (
        ID         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TizadaProMoldePiezas PRIMARY KEY,
        MoldeRef   NVARCHAR(128)  NOT NULL,    -- TizadaPro producto.legacy_id
        Pieza      NVARCHAR(320)  NOT NULL,    -- nombre de la pieza en TizadaPro
        Talle      NVARCHAR(96)   NOT NULL,
        SvgPath    NVARCHAR(MAX)  NOT NULL,    -- contorno normalizado a viewBox 0 0 100 100
        AnchoCm    DECIMAL(8,2)   NULL,
        AltoCm     DECIMAL(8,2)   NULL,
        ArchivoPdf NVARCHAR(400)  NULL,        -- PDF del que salió (uploads/moldes-tizadapro)
        FechaAlta  DATETIME       NOT NULL CONSTRAINT DF_TizadaProMoldePiezas_Fecha DEFAULT (GETDATE()),
        CONSTRAINT UQ_TizadaProMoldePiezas UNIQUE (MoldeRef, Pieza, Talle)
    );
    PRINT 'G. Tabla dbo.TizadaProMoldePiezas creada.';
END
ELSE PRINT 'G. dbo.TizadaProMoldePiezas ya existía.';
GO

/* ── H. Catálogo de avíos + vínculo desde el producto ──────────────────── */
IF OBJECT_ID('dbo.CatalogoAvios', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CatalogoAvios (
        AvioID           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CatalogoAvios PRIMARY KEY,
        Nombre           NVARCHAR(200)  NOT NULL,
        Unidad           NVARCHAR(20)   NOT NULL CONSTRAINT DF_CatalogoAvios_Unidad DEFAULT ('u'),   -- u, par, m, cm
        ArtProIdProducto INT            NULL,      -- Articulos.ProIdProducto del insumo, si existe
        Activo           BIT            NOT NULL CONSTRAINT DF_CatalogoAvios_Activo DEFAULT (1),
        Orden            INT            NULL,
        CONSTRAINT UQ_CatalogoAvios_Nombre UNIQUE (Nombre)
    );
    INSERT INTO dbo.CatalogoAvios (Nombre, Unidad) VALUES
        (N'Cierre frontal', 'u'), (N'Cierre de bolsillo', 'u'), (N'Botón', 'u'), (N'Elástico de cintura', 'm'),
        (N'Cordón', 'm'), (N'Etiqueta de marca', 'u'), (N'Etiqueta de talle', 'u'), (N'Etiqueta de composición', 'u');
    PRINT 'H. Tabla dbo.CatalogoAvios creada con 8 avíos de arranque.';
END
ELSE PRINT 'H. dbo.CatalogoAvios ya existía.';
IF COL_LENGTH('dbo.ProductoAvios', 'AvioID') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoAvios ADD AvioID INT NULL CONSTRAINT FK_ProductoAvios_Catalogo REFERENCES dbo.CatalogoAvios (AvioID);
    PRINT 'H. Columna ProductoAvios.AvioID agregada.';
END
ELSE PRINT 'H. ProductoAvios.AvioID ya existía.';
GO

/* ── H2. Nomenclador de arranque: avíos y costuras (solo agrega lo que falte) ── */
INSERT INTO dbo.CatalogoAvios (Nombre, Unidad, Orden)
SELECT v.Nombre, v.Unidad, v.Orden FROM (VALUES
    (N'Cierre frontal', 'u', 10), (N'Cierre de bolsillo', 'u', 11), (N'Cierre invisible', 'u', 12), (N'Cierre de cuello (medio cierre)', 'u', 13),
    (N'Botón', 'u', 20), (N'Botón a presión', 'u', 21), (N'Velcro', 'cm', 22), (N'Ojalillo metálico', 'u', 23),
    (N'Elástico de cintura', 'm', 30), (N'Elástico de puño', 'm', 31), (N'Elástico de pierna', 'm', 32),
    (N'Cordón', 'm', 40), (N'Tanca (traba de cordón)', 'u', 41), (N'Terminal de cordón', 'u', 42),
    (N'Cinta tapacostura', 'm', 50), (N'Cinta al bies', 'm', 51), (N'Cinta reflectiva', 'm', 52), (N'Hombrera', 'par', 53),
    (N'Etiqueta de marca', 'u', 60), (N'Etiqueta de talle', 'u', 61), (N'Etiqueta de composición y lavado', 'u', 62), (N'Etiqueta bandera', 'u', 63)
) v(Nombre, Unidad, Orden)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CatalogoAvios a WHERE a.Nombre = v.Nombre);
PRINT CONCAT('H2. Avíos agregados: ', @@ROWCOUNT);

INSERT INTO dbo.CosturasISO (CodigoISO, Nombre, Activo)
SELECT v.Codigo, v.Nombre, 1 FROM (VALUES
    ('ISO 301', 'Pespunte recto (lockstitch)'), ('ISO 304', 'Zigzag'), ('ISO 401', 'Cadeneta 2 hilos'),
    ('ISO 406', 'Recubridora 2 agujas (coverstitch)'), ('ISO 407', 'Recubridora 3 agujas'),
    ('ISO 503', 'Overlock 2 hilos'), ('ISO 504', 'Overlock 3 hilos'), ('ISO 505', 'Overlock 3 hilos ancho'),
    ('ISO 512', 'Safety 4 hilos (falso safety)'), ('ISO 514', 'Overlock 4 hilos'), ('ISO 516', 'Safety 5 hilos'),
    ('ISO 602', 'Recubridora 2 agujas con recubierto superior'), ('ISO 605', 'Recubridora 3 agujas con recubierto superior'),
    ('ISO 607', 'Flatlock 4 agujas'), ('ISO 101', 'Cadeneta 1 hilo (hilván)'), ('ISO 103', 'Puntada invisible (dobladillo)')
) v(Codigo, Nombre)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CosturasISO c WHERE c.CodigoISO = v.Codigo);
PRINT CONCAT('H2. Costuras agregadas: ', @@ROWCOUNT);
GO

/* ── I. Toda técnica de todo producto queda "incluida en el precio" (decisión 28-sep) ──
   Las 3 de construcción se habían sembrado en agosto como "aparte". Quien quiera cobrar una
   técnica como servicio independiente la desmarca a mano en el configurador. Idempotente. */
UPDATE dbo.ProductoTerminadoServicios SET Cobro = 'INCLUIDA' WHERE Cobro <> 'INCLUIDA';
PRINT CONCAT('I. Técnicas pasadas a incluida en el precio: ', @@ROWCOUNT);
GO
