/* =====================================================================
   CONFIGURADOR DE PRODUCTOS — F1 modelo de datos (Etapa A)
   ---------------------------------------------------------------------
   Idempotente: se puede correr varias veces sin duplicar.
   Correr ANTES del deploy del backend que lo consume.

   Ruta nueva /configurar-productos: productos vendibles con origen
   (producto del local / prenda del cliente / confeccionado), técnicas
   de personalización con opciones concretas, precio base sin servicios
   y política de cantidad (mínima o paquete fijo tipo combo).

   Decisiones del negocio (11-ago-2026):
   - Paquete/combo permite surtido de variantes: específicas (filas en
     ProductoOrigenVariantes) o todas (sin filas).
   - En el combo se define qué se cobra y qué no (columna Cobro por
     técnica). La matriz de bordado funciona como la de TPU: se cobra la
     primera vez (trabajo nuevo); eso es lógica de flujo, no columna.
   - El stock del local se descuenta AL RETIRAR en depósito (flujo WMS
     existente); acá no se agrega nada de stock.
   - "Producto del local" = automático (tiene stock WMS), con bypass
     ValidarStock para no frenar la venta si se cae el sistema de stock.

   Secciones:
     A. ProductoTerminadoServicios (crea si falta) + Modo + Cobro
     B. TecnicaOpciones            (catálogo de opciones por técnica)
     C. ProductoTecnicaOpciones    (opciones permitidas por producto)
     D. ProductoVentaConfig        (origen + cantidades + estado)
     E. ProductoOrigenVariantes    (surtido del paquete: variantes WMS)
     F. Seeds de TecnicaOpciones   (artículos reales EMB / TPU / DF)
     H. ComponenteOpciones         (nomenclador de cuellos/mangas/puños/
                                    costados de camiseta_USER3.pdf) + seed
     I. ProductoComponentes        (opciones permitidas + default por producto)
     J. ProductoApliques           (posición + técnica + cantidad, formato
                                    fichas Defensor × Lotto)
     G. Verificación
   ===================================================================== */

-- ── A. ProductoTerminadoServicios: base (si falta) + Modo + Cobro ────
-- La tabla la define docs/migrations/agregar_producto_terminado_servicios.sql;
-- se recrea acá por si ese script no corrió en este entorno.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoTerminadoServicios')
BEGIN
    CREATE TABLE dbo.ProductoTerminadoServicios (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto   INT NOT NULL,
        AreaID          VARCHAR(10) NOT NULL,   -- 'EMB' | 'DF' | 'TPU'
        Obligatorio     BIT NOT NULL DEFAULT 1, -- 1 = viene incluido y no se puede apagar
        CONSTRAINT UQ_ProductoTerminadoServicios UNIQUE (ProIdProducto, AreaID)
    );
END
GO

-- Modo: cómo elige el cliente las opciones de la técnica en este producto.
--   'LIBRE'       = todas las opciones activas del catálogo
--   'RESTRINGIDO' = solo las marcadas en ProductoTecnicaOpciones
--   'FIJA'        = se aplica siempre la marcada, sin elección
IF COL_LENGTH('dbo.ProductoTerminadoServicios', 'Modo') IS NULL
    ALTER TABLE dbo.ProductoTerminadoServicios
        ADD Modo VARCHAR(15) NOT NULL CONSTRAINT DF_PTS_Modo DEFAULT 'LIBRE';
GO

-- Cobro: 'APARTE' (línea de servicio propia, como hoy) | 'INCLUIDA'
-- (dentro del precio cerrado del producto/combo, sin línea de cobro).
IF COL_LENGTH('dbo.ProductoTerminadoServicios', 'Cobro') IS NULL
    ALTER TABLE dbo.ProductoTerminadoServicios
        ADD Cobro VARCHAR(10) NOT NULL CONSTRAINT DF_PTS_Cobro DEFAULT 'APARTE';
GO

-- ── B. TecnicaOpciones: catálogo general de opciones por técnica ─────
-- Una fila por especificación concreta ("Parche hasta 4x4", "Bordado con
-- tafeta"...). CodArticulo = artículo real que cotiza esa opción (su
-- precio vive en PreciosBase, como siempre). Las medidas dejan de ser
-- texto del nombre y pasan a AnchoCm/AltoCm.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TecnicaOpciones')
BEGIN
    CREATE TABLE dbo.TecnicaOpciones (
        TecnicaOpcionID INT IDENTITY(1,1) PRIMARY KEY,
        AreaID          VARCHAR(10) NOT NULL,      -- 'EMB' | 'DF' | 'TPU'
        Nombre          NVARCHAR(100) NOT NULL,
        CodArticulo     VARCHAR(50) NULL,          -- artículo que cotiza la opción
        AnchoCm         DECIMAL(9,2) NULL,
        AltoCm          DECIMAL(9,2) NULL,
        Activo          BIT NOT NULL DEFAULT 1,
        Orden           INT NULL,
        CONSTRAINT UQ_TecnicaOpciones UNIQUE (AreaID, Nombre)
    );
END
GO

-- ── C. ProductoTecnicaOpciones: permitidas por producto ──────────────
-- Solo aplica cuando ProductoTerminadoServicios.Modo = 'RESTRINGIDO'
-- (las marcadas) o 'FIJA' (una sola marcada).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoTecnicaOpciones')
BEGIN
    CREATE TABLE dbo.ProductoTecnicaOpciones (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto   INT NOT NULL,
        TecnicaOpcionID INT NOT NULL,
        CONSTRAINT FK_PTO_Opcion FOREIGN KEY (TecnicaOpcionID)
            REFERENCES dbo.TecnicaOpciones (TecnicaOpcionID),
        CONSTRAINT UQ_ProductoTecnicaOpciones UNIQUE (ProIdProducto, TecnicaOpcionID)
    );
END
GO

-- ── D. ProductoVentaConfig: origen + cantidades + publicación ────────
-- Una fila por producto configurable (ProIdProducto de Articulos, grupo
-- 2.1 Prendas o el artículo del combo). El precio NO va acá: sigue en
-- PreciosBase (precio base sin servicios, o precio cerrado del paquete).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoVentaConfig')
BEGIN
    CREATE TABLE dbo.ProductoVentaConfig (
        ProIdProducto       INT NOT NULL PRIMARY KEY,
        OrigenTipo          VARCHAR(15) NOT NULL DEFAULT 'LOCAL',
            -- 'LOCAL' | 'CLIENTE' | 'CONFECCIONADO' | 'AMBOS' (local o cliente, elige al pedir)
        OrigenProIdProducto INT NULL,          -- producto del local del que sale (Articulos.ProIdProducto)
        CantidadMinima      INT NULL,          -- NULL = sin mínimo
        CantidadFija        INT NULL,          -- paquete/combo: cantidad bloqueada (NULL = no es paquete)
        ValidarStock        BIT NOT NULL DEFAULT 1,
            -- 0 = no valida stock del local al pedir (modo contingencia si se cae el WMS)
        Estado              VARCHAR(12) NOT NULL DEFAULT 'BORRADOR',  -- 'BORRADOR' | 'PUBLICADO'
        FechaRegistro       DATETIME NOT NULL DEFAULT GETDATE(),
        FechaModif          DATETIME NULL
    );
END
GO

-- ── E. ProductoOrigenVariantes: surtido del paquete ──────────────────
-- Variantes WMS (talle/color) del producto de origen admitidas en el
-- paquete. SIN filas = todas las variantes. Con filas = solo esas
-- ("específicos o todos", decisión 11-ago).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoOrigenVariantes')
BEGIN
    CREATE TABLE dbo.ProductoOrigenVariantes (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto   INT NOT NULL,              -- el producto configurable (combo o suelto)
        WmsVarianteId   INT NOT NULL,              -- Articulos_WMS_Variantes.wms_variante_id
        CONSTRAINT UQ_ProductoOrigenVariantes UNIQUE (ProIdProducto, WmsVarianteId)
    );
END
GO

-- ── F. Seeds de TecnicaOpciones (artículos reales de la base) ────────
-- Solo inserta si el artículo existe en este entorno (guard EXISTS).
-- EMB: los 4 del eje "dónde × de qué" + relieve 3D como recargo.
-- TPU: los tamaños reales de parche (hoy texto en la descripción).
-- DF : film textil común y dorado.
DECLARE @Seeds TABLE (AreaID VARCHAR(10), Nombre NVARCHAR(100), Cod VARCHAR(50), AnchoCm DECIMAL(9,2), AltoCm DECIMAL(9,2), Orden INT);
INSERT INTO @Seeds (AreaID, Nombre, Cod, AnchoCm, AltoCm, Orden) VALUES
 ('EMB', N'Bordado sobre prenda con tafeta',              '107',  NULL, NULL, 1),
 ('EMB', N'Bordado sobre prenda 100% hilo',               '108',  NULL, NULL, 2),
 ('EMB', N'Parche adhesivo con tafeta',                   '109',  NULL, NULL, 3),
 ('EMB', N'Parche adhesivo 100% hilo',                    '1630', NULL, NULL, 4),
 ('EMB', N'Relieve 3D (recargo)',                         '1631', NULL, NULL, 5),
 ('TPU', N'Parche hasta 4x4',                             '153',  4,    4,    1),
 ('TPU', N'Parche hasta 7,5x4',                           '155',  7.5,  4,    2),
 ('TPU', N'Parche hasta 10x8',                            '152',  10,   8,    3),
 ('TPU', N'Parche hasta 10x8 con estrellas (máx. 4)',     '154',  10,   8,    4),
 ('DF',  N'DTF textil común',                             '48',   NULL, NULL, 1),
 ('DF',  N'DTF textil dorado',                            '49',   NULL, NULL, 2);

INSERT INTO dbo.TecnicaOpciones (AreaID, Nombre, CodArticulo, AnchoCm, AltoCm, Orden)
SELECT s.AreaID, s.Nombre, s.Cod, s.AnchoCm, s.AltoCm, s.Orden
FROM @Seeds s
WHERE EXISTS (SELECT 1 FROM dbo.Articulos a
              WHERE LTRIM(RTRIM(a.CodArticulo)) = s.Cod AND ISNULL(a.borrar, 0) = 0)
  AND NOT EXISTS (SELECT 1 FROM dbo.TecnicaOpciones t
                  WHERE t.AreaID = s.AreaID AND t.Nombre = s.Nombre);
GO

-- ── H. ComponenteOpciones: nomenclador de componentes de la prenda ───
-- Catálogo de opciones constructivas (camiseta_USER3.pdf: cuellos CR/CV/
-- CP/CS/CM, mangas MG, puños TM, costados CT). Decisión 11-ago: son
-- constructivas — PrecioExtra queda previsto (NULL = no cotiza) para
-- poder ver/armar la manera del precio más adelante.
-- Notas generales del nomenclador: tapacostura en todas; no se aplica en
-- el costado cuando lleva faja lateral. Anchos de referencia a confirmar
-- contra moldería.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ComponenteOpciones')
BEGIN
    CREATE TABLE dbo.ComponenteOpciones (
        OpcionID            INT IDENTITY(1,1) PRIMARY KEY,
        Tipo                VARCHAR(15) NOT NULL,   -- 'CUELLO' | 'MANGA' | 'PUNO' | 'COSTADO'
        SubTipo             VARCHAR(20) NULL,       -- cuellos: 'REDONDO' | 'EN V' | 'POLO' | 'CAMISA' | 'MAO'
        Codigo              VARCHAR(10) NOT NULL,   -- 'CR-01', 'MG-02', ...
        Nombre              NVARCHAR(100) NOT NULL,
        NotaMolde           NVARCHAR(200) NULL,     -- molde propio / compartido / construido sobre boceto
        NotaTallesFemeninos NVARCHAR(200) NULL,     -- cruce invertido / cartera invertida
        AnchoRefMm          DECIMAL(9,2) NULL,      -- vivo 10 / vivo ancho 20 / faja fina 13 / faja ancha 26
        PrecioExtra         DECIMAL(18,2) NULL,     -- NULL = constructiva, no cotiza (previsto a futuro)
        Activo              BIT NOT NULL DEFAULT 1,
        Orden               INT NULL,
        CONSTRAINT UQ_ComponenteOpciones UNIQUE (Codigo)
    );
END
GO

-- Seed del nomenclador (22 opciones, tal cual el PDF)
DECLARE @Comp TABLE (Tipo VARCHAR(15), SubTipo VARCHAR(20), Codigo VARCHAR(10), Nombre NVARCHAR(100),
                     NotaMolde NVARCHAR(200), NotaFem NVARCHAR(200), AnchoMm DECIMAL(9,2), Orden INT);
INSERT INTO @Comp VALUES
 ('CUELLO','REDONDO','CR-01', N'Cuello redondo',                    NULL,                                   NULL,                    NULL, 1),
 ('CUELLO','REDONDO','CR-02', N'Cuello redondo cruzado',            NULL,                                   N'Cruce invertido',      NULL, 2),
 ('CUELLO','REDONDO','CR-03', N'Cuello redondo dobladillo',         NULL,                                   NULL,                    NULL, 3),
 ('CUELLO','EN V',   'CV-01', N'Cuello V común',                    N'Molde de frente base en V',           NULL,                    NULL, 4),
 ('CUELLO','EN V',   'CV-02', N'Cuello V cruzado',                  N'Mismo molde de frente que CV-01',     N'Cruce invertido',      NULL, 5),
 ('CUELLO','EN V',   'CV-03', N'Cuello V dobladillo',               N'Molde de frente propio',              NULL,                    NULL, 6),
 ('CUELLO','EN V',   'CV-04', N'Cuello V con base',                 N'Molde de frente propio',              NULL,                    NULL, 7),
 ('CUELLO','EN V',   'CV-05', N'Cuello V cruzado con base',         N'Molde de frente propio',              N'Cruce invertido',      NULL, 8),
 ('CUELLO','POLO',   'CP-01', N'Cuello polo V',                     N'Mismo molde de frente que CV-01',     NULL,                    NULL, 9),
 ('CUELLO','POLO',   'CP-02', N'Cuello polo cruzado',               NULL,                                   N'Cruce invertido',      NULL, 10),
 ('CUELLO','POLO',   'CP-03', N'Cuello polo',                       NULL,                                   N'Cartera invertida',    NULL, 11),
 ('CUELLO','POLO',   'CP-04', N'Cuello polo V cruzado con base',    N'Molde de frente propio',              N'Cruce invertido',      NULL, 12),
 ('CUELLO','CAMISA', 'CS-01', N'Cuello camisa',                     N'Pie de cuello mao + solapa reducida', N'Cartera invertida',    NULL, 13),
 ('CUELLO','MAO',    'CM-01', N'Cuello mao / henley',               NULL,                                   N'Cartera invertida',    NULL, 14),
 ('MANGA', NULL,     'MG-01', N'Manga pegada (clásica)',            N'Del archivo original',                NULL,                    NULL, 1),
 ('MANGA', NULL,     'MG-02', N'Manga raglán',                      N'Del archivo original',                NULL,                    NULL, 2),
 ('PUNO',  NULL,     'TM-01', N'Dobladillo en collareta',           N'Del archivo original',                NULL,                    NULL, 1),
 ('PUNO',  NULL,     'TM-02', N'Terminación con vivo',              N'Construido sobre el boceto',          NULL,                    10,   2),
 ('PUNO',  NULL,     'TM-03', N'Terminación con vivo ancho',        N'Construido sobre el boceto',          NULL,                    20,   3),
 ('COSTADO',NULL,    'CT-01', N'Costado simple',                    NULL,                                   NULL,                    NULL, 1),
 ('COSTADO',NULL,    'CT-02', N'Faja lateral fina',                 N'Construido sobre el boceto',          NULL,                    13,   2),
 ('COSTADO',NULL,    'CT-03', N'Faja lateral ancha',                N'Construido sobre el boceto',          NULL,                    26,   3);

INSERT INTO dbo.ComponenteOpciones (Tipo, SubTipo, Codigo, Nombre, NotaMolde, NotaTallesFemeninos, AnchoRefMm, Orden)
SELECT c.Tipo, c.SubTipo, c.Codigo, c.Nombre, c.NotaMolde, c.NotaFem, c.AnchoMm, c.Orden
FROM @Comp c
WHERE NOT EXISTS (SELECT 1 FROM dbo.ComponenteOpciones x WHERE x.Codigo = c.Codigo);
GO

-- ── I. ProductoComponentes: qué ofrece cada producto confeccionado ───
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoComponentes')
BEGIN
    CREATE TABLE dbo.ProductoComponentes (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto   INT NOT NULL,
        OpcionID        INT NOT NULL,
        EsDefault       BIT NOT NULL DEFAULT 0,   -- la opción que sale si el cliente no elige
        CONSTRAINT FK_ProdComp_Opcion FOREIGN KEY (OpcionID)
            REFERENCES dbo.ComponenteOpciones (OpcionID),
        CONSTRAINT UQ_ProductoComponentes UNIQUE (ProIdProducto, OpcionID)
    );
END
GO

-- ── J. ProductoApliques: posición + técnica + cantidad + cobro ───────
-- La tabla de specs de las fichas Defensor × Lotto como dato: escudo
-- bordado, sponsors DTF, grifa etiqueta o DTF. AreaID usa los códigos de
-- servicio ('EMB' | 'DF' | 'TPU') más 'ETIQUETA' para grifa tejida cosida.
-- TecnicaOpcionID (opcional) fija la opción concreta (ej. parche 4x4).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoApliques')
BEGIN
    CREATE TABLE dbo.ProductoApliques (
        ApliqueID       INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto   INT NOT NULL,
        Posicion        NVARCHAR(100) NOT NULL,   -- 'Escudo — pecho izq.', 'Sponsor — frente', ...
        AreaID          VARCHAR(10) NOT NULL,     -- 'EMB' | 'DF' | 'TPU' | 'ETIQUETA'
        TecnicaOpcionID INT NULL,
        Cantidad        INT NOT NULL DEFAULT 1,
        Incluido        BIT NOT NULL DEFAULT 1,   -- 1 = en el precio del producto; 0 = se cobra aparte
        Orden           INT NULL,
        CONSTRAINT FK_ProdApl_Opcion FOREIGN KEY (TecnicaOpcionID)
            REFERENCES dbo.TecnicaOpciones (TecnicaOpcionID)
    );
END
GO

-- ── K. ProductoComboItems: composición de paquetes multi-producto ────
-- "Short verde M + medias azules + short estampado": el combo (artículo
-- con precio cerrado) lista QUÉ trae. WmsVarianteId fija la variante
-- exacta (verde talle M); NULL = el cliente elige talle/color al pedir.
-- Si un combo NO tiene filas acá, sigue siendo el paquete simple de
-- CantidadFija unidades del producto de origen (12 gorros).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoComboItems')
BEGIN
    CREATE TABLE dbo.ProductoComboItems (
        ID                INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto     INT NOT NULL,      -- el combo (Articulos.ProIdProducto)
        ItemProIdProducto INT NOT NULL,      -- qué producto trae
        WmsVarianteId     INT NULL,          -- variante fija; NULL = elige el cliente
        Cantidad          INT NOT NULL DEFAULT 1,
        Orden             INT NULL,
        INDEX IX_ProductoComboItems_Combo (ProIdProducto)
    );
END
GO

-- ── L. Combos como categoría propia + servicios por ítem del combo ───
-- Pedido 11-ago: al crear se elige "Combo" (categoría de artículos propia,
-- StockArt 2.2.1.4), se agregan productos y a CADA producto se le agregan
-- servicios (short estampado = short + DTF; gorro bordado = gorro + EMB).
IF COL_LENGTH('dbo.ProductoVentaConfig', 'EsCombo') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig
        ADD EsCombo BIT NOT NULL CONSTRAINT DF_PVC_EsCombo DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoComboItemServicios')
BEGIN
    CREATE TABLE dbo.ProductoComboItemServicios (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        ComboItemID     INT NOT NULL,          -- fila de ProductoComboItems
        AreaID          VARCHAR(10) NOT NULL,  -- 'EMB' | 'DF' | 'TPU'
        TecnicaOpcionID INT NULL,              -- opción concreta (parche 4x4...); NULL = libre
        Incluido        BIT NOT NULL DEFAULT 1,-- 1 = en el precio del combo; 0 = se cobra aparte
        CONSTRAINT FK_PCIS_Item FOREIGN KEY (ComboItemID) REFERENCES dbo.ProductoComboItems (ID),
        CONSTRAINT FK_PCIS_Opcion FOREIGN KEY (TecnicaOpcionID) REFERENCES dbo.TecnicaOpciones (TecnicaOpcionID)
    );
END
GO

-- Variante StockArt "Combos" (2.2.1.4): los combos nuevos nacen acá, así
-- son una categoría de artículos propia (misma familia SupFlia 2 / grupo 2.1).
IF NOT EXISTS (SELECT 1 FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.4')
BEGIN
    INSERT INTO dbo.StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar, TipoStock)
    VALUES ('2', '2.1', '2.2.1.4', '4', 'Combos', 0, 'U', 1, 'PRODUCTO_TERMINADO');
END
GO

-- ── M. Familia: clasificación REAL y editable (reemplaza la agrupación
-- adivinada por nombre que hacía el front) ───────────────────────────
-- Pedido 12-ago: "esa agrupación ¿en qué tabla está? ayudame a organizar".
-- No estaba en ninguna tabla — el front adivinaba por texto del nombre en
-- cada carga. Ahora es una columna guardada y editable desde la pantalla.
IF COL_LENGTH('dbo.ProductoVentaConfig', 'Familia') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD Familia VARCHAR(30) NULL;
GO

-- Backfill UNA VEZ: crea la fila de config (si no existía) para las prendas
-- que nunca se tocaron en la pantalla, con la Familia adivinada por nombre
-- como punto de partida — quedan en BORRADOR (no se publica nada solo) y
-- el usuario corrige la Familia que esté mal desde el editor.
INSERT INTO dbo.ProductoVentaConfig (ProIdProducto, OrigenTipo, Estado, Familia)
SELECT a.ProIdProducto, 'LOCAL', 'BORRADOR',
    CASE
        WHEN LOWER(a.Descripcion) LIKE '%gorro%'                          THEN 'Gorros'
        WHEN LOWER(a.Descripcion) LIKE '%camiseta%'                       THEN 'Camisetas'
        WHEN LOWER(a.Descripcion) LIKE '%remera%' OR LOWER(a.Descripcion) LIKE '%polo%' THEN 'Remeras'
        WHEN LOWER(a.Descripcion) LIKE '%short%'                          THEN 'Shorts'
        WHEN LOWER(a.Descripcion) LIKE '%canguro%' OR LOWER(a.Descripcion) LIKE '%buzo%' THEN 'Canguros y Buzos'
        WHEN LOWER(a.Descripcion) LIKE '%bandera%'                        THEN 'Banderas'
        WHEN LOWER(a.Descripcion) LIKE '%media%'                          THEN 'Medias'
        ELSE 'Otros'
    END
FROM dbo.Articulos a
WHERE LTRIM(RTRIM(a.CodStock)) = '2.2.1.3'
  AND ISNULL(a.borrar, 0) = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = a.ProIdProducto);
GO

-- Completa Familia en config que YA existía antes de esta columna (ej. productos
-- que el usuario configuró a mano antes del 12-ago) — solo toca filas con
-- Familia todavía NULL, nunca pisa una Familia que el usuario ya haya elegido.
UPDATE vc SET Familia =
    CASE
        WHEN LOWER(a.Descripcion) LIKE '%gorro%'                          THEN 'Gorros'
        WHEN LOWER(a.Descripcion) LIKE '%camiseta%'                       THEN 'Camisetas'
        WHEN LOWER(a.Descripcion) LIKE '%remera%' OR LOWER(a.Descripcion) LIKE '%polo%' THEN 'Remeras'
        WHEN LOWER(a.Descripcion) LIKE '%short%'                          THEN 'Shorts'
        WHEN LOWER(a.Descripcion) LIKE '%canguro%' OR LOWER(a.Descripcion) LIKE '%buzo%' THEN 'Canguros y Buzos'
        WHEN LOWER(a.Descripcion) LIKE '%bandera%'                        THEN 'Banderas'
        WHEN LOWER(a.Descripcion) LIKE '%media%'                          THEN 'Medias'
        ELSE 'Otros'
    END
FROM dbo.ProductoVentaConfig vc
INNER JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto
WHERE vc.Familia IS NULL AND ISNULL(vc.EsCombo, 0) = 0;
GO

-- ── N. Familia → StockArt real (pedido 12-ago: "ya no tenemos Macrosoft,
-- pudiera ser mi nomenclador de familia") ─────────────────────────────
-- Reemplaza ProductoVentaConfig.Familia (tag de la app) por el mecanismo
-- real de StockArt, mismo patrón que EcoUV: cada familia con productos hoy
-- pasa a ser su propia variante bajo Grupo 2.1, y los artículos migran su
-- CodStock. De acá en más se administra con las mismas herramientas de
-- siempre: Editor StockArt (crear variante nueva) y "mover artículo"
-- (PUT /stockart/articulos/:cod/mover) — el configurador los reusa tal cual.
-- 'Otros'/sin clasificar queda en la variante genérica '2.2.1.3 Prendas'.
;WITH NuevasFamilias AS (
    SELECT DISTINCT vc.Familia AS Nombre
    FROM dbo.ProductoVentaConfig vc
    WHERE vc.Familia IS NOT NULL AND ISNULL(vc.EsCombo, 0) = 0 AND vc.Familia <> 'Otros'
      -- Por SupFlia, no por Grupo: si la familia ya se movió a otro Grupo (ej.
      -- sección R con Productos del Local) este guard no debe re-crearla ahí.
      -- BUG real detectado 12-ago: con Grupo='2.1' el 2º run duplicó la fila.
      AND NOT EXISTS (SELECT 1 FROM dbo.StockArt sa
                       WHERE LTRIM(RTRIM(sa.SupFlia)) = '2' AND LTRIM(RTRIM(sa.Articulo)) = vc.Familia)
),
Numeradas AS (
    SELECT Nombre,
           (SELECT ISNULL(MAX(TRY_CAST(LTRIM(RTRIM(Ref)) AS INT)), 4) FROM dbo.StockArt WHERE LTRIM(RTRIM(Grupo)) = '2.1')
             + ROW_NUMBER() OVER (ORDER BY Nombre) AS Ref
    FROM NuevasFamilias
)
INSERT INTO dbo.StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar, TipoStock)
SELECT '2', '2.1', '2.2.1.' + CAST(Ref AS VARCHAR(10)), CAST(Ref AS VARCHAR(10)), Nombre, 0, 'U', 1, 'PRODUCTO_TERMINADO'
FROM Numeradas;
GO

-- Mueve cada artículo a la variante de su familia (una sola vez: el WHERE
-- exige que siga en la variante genérica '2.2.1.3', así no repite en re-runs).
UPDATE a
   SET a.CodStock = sa.CodStock
FROM dbo.Articulos a
INNER JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
INNER JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.Grupo)) = '2.1' AND LTRIM(RTRIM(sa.Articulo)) = vc.Familia
WHERE ISNULL(vc.EsCombo, 0) = 0
  AND vc.Familia IS NOT NULL AND vc.Familia <> 'Otros'
  AND LTRIM(RTRIM(a.CodStock)) = '2.2.1.3';
GO

-- ── O. Subcategorías del nomenclador Studio, creadas SIN esperar productos
-- (pedido 12-ago: "aunque no tengan productos asociados") ────────────
-- De la lámina Categorías del USER Studio (Indumentaria deportiva > Camiseta/
-- Short/Calza/Campera/Buzo; Promocional > Remera/Chomba/Gorro/Bandera; Medias
-- > Media deportiva/Media de compresión). Camiseta/Short/Buzo/Remera/Gorro/
-- Bandera ya existen (sección N, con productos reales). Acá solo las que
-- faltaban: Calza, Campera, Chomba, Media deportiva, Media de compresión.
-- Queda PENDIENTE de decisión del usuario: si esto pasa a 2 niveles (categoría
-- madre → subcategoría, como la lámina) o sigue plano como está; y si
-- Bolso/Mochila/Toalla (accesorios, no son prendas) entran acá o son otra área.
;WITH FamiliasNuevas AS (
    SELECT * FROM (VALUES ('Calza'), ('Campera'), ('Chomba'), ('Media deportiva'), ('Media de compresión')) v(Nombre)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.StockArt sa WHERE LTRIM(RTRIM(sa.SupFlia)) = '2' AND LTRIM(RTRIM(sa.Articulo)) = v.Nombre)
),
Numeradas AS (
    SELECT Nombre,
           (SELECT ISNULL(MAX(TRY_CAST(LTRIM(RTRIM(Ref)) AS INT)), 4) FROM dbo.StockArt WHERE LTRIM(RTRIM(Grupo)) = '2.1')
             + ROW_NUMBER() OVER (ORDER BY Nombre) AS Ref
    FROM FamiliasNuevas
)
INSERT INTO dbo.StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar, TipoStock)
SELECT '2', '2.1', '2.2.1.' + CAST(Ref AS VARCHAR(10)), CAST(Ref AS VARCHAR(10)), Nombre, 0, 'U', 1, 'PRODUCTO_TERMINADO'
FROM Numeradas;
GO

-- ── P. Origen vía TipoStock (pedido 12-ago: "por el campo TipoStock lo puedes
-- identificar") ────────────────────────────────────────────────────────
-- Nuevo valor 'PRODUCTO_LOCAL' en StockArt.TipoStock (sin CHECK constraint en
-- la base, validado en código — TIPOS_VALIDOS de stockArtController.js).
-- Distingue "sale del stock del local" de "se confecciona a pedido"
-- (PRODUCTO_TERMINADO) SIN duplicar las 13 familias — es un bucket propio,
-- no cruzado por tipo de prenda. Dispara el MISMO precio cerrado por unidad y
-- el MISMO freno de retiro WMS antes de decorar que ya dispara PRODUCTO_TERMINADO
-- (webOrdersController.js y prendasOrdersController.js, sección "PRODUCTO
-- TERMINADO o PRODUCTO_LOCAL" — confirmado por el usuario, mismo tratamiento).
IF NOT EXISTS (SELECT 1 FROM dbo.StockArt WHERE LTRIM(RTRIM(SupFlia)) = '2' AND LTRIM(RTRIM(Articulo)) = 'Productos del Local')
BEGIN
    DECLARE @RefLocal INT = (SELECT ISNULL(MAX(TRY_CAST(LTRIM(RTRIM(Ref)) AS INT)), 4) FROM dbo.StockArt WHERE LTRIM(RTRIM(Grupo)) = '2.1') + 1;
    INSERT INTO dbo.StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar, TipoStock)
    VALUES ('2', '2.1', '2.2.1.' + CAST(@RefLocal AS VARCHAR(10)), CAST(@RefLocal AS VARCHAR(10)), 'Productos del Local', 0, 'U', 1, 'PRODUCTO_LOCAL');
END
GO

-- "Combos" -> "Combos y Promos" (mismo CodStock '2.2.1.4', solo cambia el
-- nombre — nada que referencie el CodStock se rompe).
UPDATE dbo.StockArt SET Articulo = 'Combos y Promos'
WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.4' AND LTRIM(RTRIM(Articulo)) <> 'Combos y Promos';
GO

-- ── Q. "Combos y Promos" a su propio Grupo (pedido 12-ago: "puede ser 2.2")
-- ────────────────────────────────────────────────────────────────────
-- Deja de ser una variante MÁS dentro de Prendas (Grupo 2.1, mezclada con
-- Camisetas/Shorts/...) y pasa a ser su propio Grupo (2.2), hermano de
-- Prendas — el primer paso real hacia los "2 niveles" de la lámina Studio.
-- CodStock NO cambia (sigue '2.2.1.4'): solo se mueve el Grupo, así no hay
-- que tocar Articulos (los combos ya creados siguen apuntando bien) ni los
-- 2 lugares del código que usan ese CodStock como default (crearProducto en
-- configuradorController.js, CODSTOCK_COMBOS en el front) — ninguno asume
-- Grupo, resuelven Grupo/SupFlia consultando StockArt por CodStock.
UPDATE dbo.StockArt SET Grupo = '2.2'
WHERE LTRIM(RTRIM(CodStock)) = '2.2.1.4' AND LTRIM(RTRIM(Grupo)) <> '2.2';
GO

-- ── R. "Productos del Local" a su propio Grupo (pedido 12-ago: "2, 2.3,
-- 2.2.3.1 ¿no crees?") ──────────────────────────────────────────────
-- A diferencia de Combos (sección Q), acá SÍ se renumera el CodStock
-- completo, no solo el Grupo. FIX 13-ago (detectado corriendo el
-- diagnóstico de prod): el guard original buscaba el CodStock FIJO
-- '2.2.1.16' que salió en LOCAL — pero ese código lo asigna dinámicamente
-- la sección P (MAX(Ref)+1 según cuántas familias existan en ese momento),
-- así que en otro entorno con distinto historial "Productos del Local"
-- puede nacer en cualquier código (en prod nació en '2.2.1.10' porque las
-- secciones M/N todavía no habían corrido con efecto ahí). Buscar por
-- SupFlia+Articulo (mismo criterio ya usado en M/N/O/P) en vez de por
-- código fijo — si no, la sección se saltea en silencio en cualquier
-- entorno donde el código no haya sido exactamente '2.2.1.16'.
IF EXISTS (SELECT 1 FROM dbo.StockArt
           WHERE LTRIM(RTRIM(SupFlia)) = '2' AND LTRIM(RTRIM(Articulo)) = 'Productos del Local'
             AND LTRIM(RTRIM(Grupo)) <> '2.3')
   AND NOT EXISTS (SELECT 1 FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = '2.2.3.1')
BEGIN
    UPDATE dbo.StockArt SET Grupo = '2.3', CodStock = '2.2.3.1', Ref = '1'
    WHERE LTRIM(RTRIM(SupFlia)) = '2' AND LTRIM(RTRIM(Articulo)) = 'Productos del Local'
      AND LTRIM(RTRIM(Grupo)) <> '2.3';
END
GO

-- ── S. Corrige el Origen por defecto: son confeccionados, no del local
-- (pedido 12-ago: "todos los productos son confeccionados en user y no
-- admiten otro origen") ─────────────────────────────────────────────
-- La sección M backfileó Familia con OrigenTipo='LOCAL' por default (el
-- default de la tabla) — para el catálogo de prendas confeccionadas
-- (Camisetas, Shorts, Banderas...) eso está mal: nunca salen del stock
-- del local, siempre se fabrican a pedido. Corrige a 'CONFECCIONADO' TODO
-- lo que hoy esté en 'LOCAL' salvo lo que ya vive en la variante
-- "Productos del Local" (esa sí es, por definición, origen local de
-- verdad) y salvo los combos (EsCombo=1, no tienen un solo origen).
UPDATE vc SET OrigenTipo = 'CONFECCIONADO'
FROM dbo.ProductoVentaConfig vc
INNER JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto
INNER JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
WHERE vc.OrigenTipo = 'LOCAL' AND ISNULL(vc.EsCombo, 0) = 0
  AND LTRIM(RTRIM(sa.Articulo)) <> 'Productos del Local';
GO

-- ── T. Sublimación + Corte + Costura activas en todo el catálogo actual
-- (pedido 12-ago: "acá creo debe llevar además sublimación, corte y costura
-- y todos los que hay hoy en el catálogo ponerle estos 3 servicios activos")
-- ────────────────────────────────────────────────────────────────────
-- Son construcción, no decoración: casi siempre obligatorias (Obligatorio=1),
-- sin opciones restringidas (Modo='LIBRE', no hay TecnicaOpciones para
-- SB/TWC/TWT todavía). Mismo alcance que la sección S: confeccionados
-- actuales, sin combos, sin "Productos del Local" (no se fabrican).
DECLARE @AreasBase TABLE (AreaID VARCHAR(10));
INSERT INTO @AreasBase (AreaID) VALUES ('SB'), ('TWC'), ('TWT');

INSERT INTO dbo.ProductoTerminadoServicios (ProIdProducto, AreaID, Obligatorio, Modo, Cobro)
SELECT vc.ProIdProducto, ab.AreaID, 1, 'LIBRE', 'APARTE'
FROM dbo.ProductoVentaConfig vc
INNER JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto
INNER JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
CROSS JOIN @AreasBase ab
WHERE ISNULL(vc.EsCombo, 0) = 0
  AND LTRIM(RTRIM(sa.Articulo)) <> 'Productos del Local'
  AND NOT EXISTS (SELECT 1 FROM dbo.ProductoTerminadoServicios s
                  WHERE s.ProIdProducto = vc.ProIdProducto AND s.AreaID = ab.AreaID);
GO

-- ── U. Piezas por opción de componente (pedido 12-ago: "que se tenga en
-- cuenta todo lo que tiene el HTML" — despiece real, como opciones_lib[].piezas
-- del USER Studio) ───────────────────────────────────────────────────
-- Cada opción de componente (ej. "Cuello redondo") aporta N piezas al
-- despiece de la prenda (ej. 1 pieza "Cuello redondo", zona contraste,
-- forma cuello). El PrecioExtra de ComponenteOpciones YA existía pero
-- "prevista sin cotizar" (12-ago sección H) — sigue igual acá, pasa a
-- tener input real en pantalla, la decisión de cotizar con eso queda para
-- cuando se integre con el pedido (F4).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ComponenteOpcionPiezas')
BEGIN
    CREATE TABLE dbo.ComponenteOpcionPiezas (
        ID          INT IDENTITY(1,1) PRIMARY KEY,
        OpcionID    INT NOT NULL,
        NombrePieza NVARCHAR(100) NOT NULL,
        Cantidad    INT NOT NULL DEFAULT 1,
        Zona        VARCHAR(20) NULL,   -- 'base' | 'contraste' (libre)
        Forma       VARCHAR(30) NULL,   -- silueta para hoja de corte (libre)
        CONSTRAINT FK_ComponenteOpcionPiezas_Opcion FOREIGN KEY (OpcionID)
            REFERENCES dbo.ComponenteOpciones (OpcionID)
    );
END
GO

-- ── V. Variantes del producto confeccionado (12-ago, "las variantes
-- pudieran ser" — motor cartesiano del USER Studio, sin Consumo/Estadísticas
-- que el usuario descartó por ser dato real de producción, no configuración)
-- ────────────────────────────────────────────────────────────────────
-- CodigoCorto = 3 letras que prefijan el código de cada variante (equivale
-- a cod_producto del HTML). No obligatorio: sin código, la variante usa
-- el ProIdProducto como prefijo (igual sirve, menos legible).
IF COL_LENGTH('dbo.ProductoVentaConfig', 'CodigoCorto') IS NULL
    ALTER TABLE dbo.ProductoVentaConfig ADD CodigoCorto VARCHAR(3) NULL;
GO

-- Selecciones = JSON { "CUELLO": OpcionID, "MANGA": OpcionID, ... } — la
-- combinación exacta de esta variante. ClaveNatural = Selecciones
-- normalizado (Tipo:OpcionID ordenado, unido con '|') para poder hacer
-- upsert al regenerar sin perder Activa/PrecioManual de las que ya existían.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoVariantes')
BEGIN
    CREATE TABLE dbo.ProductoVariantes (
        VarianteID      INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto   INT NOT NULL,
        Codigo          VARCHAR(20) NOT NULL,
        CodigoLegible   VARCHAR(150) NULL,
        Selecciones     NVARCHAR(MAX) NOT NULL,
        ClaveNatural    VARCHAR(400) NOT NULL,
        PrecioCalculado DECIMAL(18, 2) NULL,
        PrecioManual    DECIMAL(18, 2) NULL,  -- override; si está, manda sobre el calculado
        Activa          BIT NOT NULL DEFAULT 1,
        FechaCreacion   DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_ProductoVariantes_Clave UNIQUE (ProIdProducto, ClaveNatural),
        CONSTRAINT UQ_ProductoVariantes_Codigo UNIQUE (ProIdProducto, Codigo)
    );
END
GO

-- ── W. Ficha de diseño imprimible (12-ago, "esa sí" — el otro ítem que
-- el usuario confirmó de la Etapa B del USER Studio, junto con Variantes;
-- Consumo de tela y Estadísticas del ERP quedaron afuera por pedido suyo)
-- ────────────────────────────────────────────────────────────────────
-- CosturasISO = catálogo chico de clasificaciones ISO 4915 (puntada/
-- costura), NO el catálogo completo de operaciones de confección con
-- máquina+SAM+tiempo del HTML (biblioteca_operaciones/OPS) — eso es un
-- subsistema de producción aparte que el usuario no pidió. Acá alcanza
-- con código+nombre para el selector de la ficha. Seed = las 5
-- clasificaciones ISO reales que aparecen en el HTML del jefe (dedupeadas
-- de sus ~19 operaciones de ejemplo, que repiten la misma ISO varias
-- veces con nombres de operación distintos).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CosturasISO')
BEGIN
    CREATE TABLE dbo.CosturasISO (
        CosturaISOID INT IDENTITY(1,1) PRIMARY KEY,
        CodigoISO    VARCHAR(20) NOT NULL,
        Nombre       VARCHAR(150) NOT NULL,
        Activo       BIT NOT NULL DEFAULT 1,
        CONSTRAINT UQ_CosturasISO_Codigo UNIQUE (CodigoISO)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.CosturasISO)
BEGIN
    INSERT INTO dbo.CosturasISO (CodigoISO, Nombre) VALUES
        ('ISO 301', 'Pespunte recto (lockstitch)'),
        ('ISO 304', 'Zigzag'),
        ('ISO 406', 'Recubridora (coverstitch)'),
        ('ISO 504', 'Overlock 3 hilos'),
        ('ISO 602', 'Recubridora 2 agujas');
END
GO

-- ProductoFichaDiseno = encabezado + campos del pie, 1 fila por producto
-- (mismo patrón 1:1 que ProductoVentaConfig, sin FK a Articulos como el
-- resto de las tablas del configurador).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoFichaDiseno')
BEGIN
    CREATE TABLE dbo.ProductoFichaDiseno (
        ProIdProducto INT NOT NULL PRIMARY KEY,
        Ref           VARCHAR(50) NULL,       -- default = CodArticulo si vacío (resuelto en app)
        Marca         VARCHAR(50) NULL DEFAULT 'USER',
        Material      VARCHAR(200) NULL,      -- placeholder sugerido = tela del cliente si hay (telaDe)
        Tallas        VARCHAR(200) NULL,      -- placeholder sugerido = talles del producto
        Marcacion     VARCHAR(500) NULL,
        Colores       VARCHAR(200) NULL,
        Proveedor     VARCHAR(200) NULL,
        DibujoUrl     VARCHAR(500) NULL,      -- /uploads/fichas-diseno/<archivo> — dibujo técnico, NO la foto de catálogo (Articulos_Imagenes)
        FechaModif    DATETIME NOT NULL DEFAULT GETDATE()
    );
END
GO

-- Anotaciones = puntos con flecha sobre el dibujo (posición en % para que
-- sobreviva a cualquier tamaño de imagen/pantalla, igual que el HTML).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoFichaDisenoAnotaciones')
BEGIN
    CREATE TABLE dbo.ProductoFichaDisenoAnotaciones (
        AnotacionID   INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto INT NOT NULL,
        PosX          DECIMAL(5,2) NOT NULL,  -- % desde la izquierda (0-100)
        PosY          DECIMAL(5,2) NOT NULL,  -- % desde arriba (0-100)
        Texto         VARCHAR(300) NOT NULL,
        Orden         INT NOT NULL DEFAULT 0
    );
END
GO

-- Campos extra = pares libres label/valor que el usuario agrega a mano
-- (ej. "Peso" / "180g").
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoFichaDisenoExtra')
BEGIN
    CREATE TABLE dbo.ProductoFichaDisenoExtra (
        ExtraID       INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto INT NOT NULL,
        Etiqueta      VARCHAR(100) NOT NULL,
        Valor         VARCHAR(300) NULL,
        Orden         INT NOT NULL DEFAULT 0
    );
END
GO

-- Costuras elegidas para ESTE producto (unión + código ISO). UnionNombre
-- es texto libre (ej. "Hombros"), igual que el HTML — no se guarda el
-- nombre de la operación, solo la clasificación ISO elegida.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductoFichaDisenoCosturas')
BEGIN
    CREATE TABLE dbo.ProductoFichaDisenoCosturas (
        ID            INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto INT NOT NULL,
        UnionNombre   VARCHAR(100) NOT NULL,
        CodigoISO     VARCHAR(20) NOT NULL,
        Orden         INT NOT NULL DEFAULT 0
    );
END
GO

-- ── G. Verificación ──────────────────────────────────────────────────
SELECT 'ProductoTerminadoServicios' AS Tabla,
       COL_LENGTH('dbo.ProductoTerminadoServicios','Modo')  AS TieneModo,
       COL_LENGTH('dbo.ProductoTerminadoServicios','Cobro') AS TieneCobro,
       (SELECT COUNT(*) FROM dbo.ProductoTerminadoServicios) AS Filas
UNION ALL SELECT 'TecnicaOpciones', NULL, NULL, (SELECT COUNT(*) FROM dbo.TecnicaOpciones)
UNION ALL SELECT 'ProductoTecnicaOpciones', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoTecnicaOpciones)
UNION ALL SELECT 'ProductoVentaConfig', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoVentaConfig)
UNION ALL SELECT 'ProductoOrigenVariantes', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoOrigenVariantes)
UNION ALL SELECT 'ProductoComboItems', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoComboItems)
UNION ALL SELECT 'ProductoComboItemServicios', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoComboItemServicios)
UNION ALL SELECT 'ProductoVentaConfig con Familia (legacy)', COL_LENGTH('dbo.ProductoVentaConfig','Familia'), NULL, (SELECT COUNT(*) FROM dbo.ProductoVentaConfig WHERE Familia IS NOT NULL)
UNION ALL SELECT 'StockArt Grupo 2.1 (familias reales)', NULL, NULL, (SELECT COUNT(*) FROM dbo.StockArt WHERE LTRIM(RTRIM(Grupo)) = '2.1')
UNION ALL SELECT 'ProductoTerminadoServicios SB/TWC/TWT', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoTerminadoServicios WHERE AreaID IN ('SB','TWC','TWT'))
UNION ALL SELECT 'ComponenteOpcionPiezas', NULL, NULL, (SELECT COUNT(*) FROM dbo.ComponenteOpcionPiezas)
UNION ALL SELECT 'ProductoVariantes', COL_LENGTH('dbo.ProductoVentaConfig','CodigoCorto'), NULL, (SELECT COUNT(*) FROM dbo.ProductoVariantes)
UNION ALL SELECT 'ComponenteOpciones', NULL, NULL, (SELECT COUNT(*) FROM dbo.ComponenteOpciones)
UNION ALL SELECT 'ProductoComponentes', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoComponentes)
UNION ALL SELECT 'ProductoApliques', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoApliques)
UNION ALL SELECT 'CosturasISO', NULL, NULL, (SELECT COUNT(*) FROM dbo.CosturasISO)
UNION ALL SELECT 'ProductoFichaDiseno', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoFichaDiseno)
UNION ALL SELECT 'ProductoFichaDisenoAnotaciones', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoFichaDisenoAnotaciones)
UNION ALL SELECT 'ProductoFichaDisenoExtra', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoFichaDisenoExtra)
UNION ALL SELECT 'ProductoFichaDisenoCosturas', NULL, NULL, (SELECT COUNT(*) FROM dbo.ProductoFichaDisenoCosturas);

SELECT AreaID, Nombre, CodArticulo, AnchoCm, AltoCm, Activo
FROM dbo.TecnicaOpciones ORDER BY AreaID, Orden;

SELECT Tipo, ISNULL(SubTipo,'') AS SubTipo, Codigo, Nombre
FROM dbo.ComponenteOpciones ORDER BY Tipo, Orden;
GO
