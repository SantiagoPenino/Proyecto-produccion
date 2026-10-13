-- ============================================================================
-- WMS PROPIO — DDL de COMPRAS (2026-08-27) · complemento de DDL-wms-propio.sql
-- Corre DESPUÉS del DDL principal. Idempotente: se puede re-ejecutar.
-- Modelo calcado del sistema anterior: el "progreso" de una compra/importación es
-- la CLAVE de un paso de una plantilla configurable (ej. plantilla Importaciones =
-- 9 etapas Realizada→Recibida; plantilla Compra en Plaza = 3 etapas).
-- ============================================================================

-- Catálogos ------------------------------------------------------------------
IF OBJECT_ID('dbo.Wms_Monedas') IS NULL
CREATE TABLE dbo.Wms_Monedas (
    MonId    INT NOT NULL PRIMARY KEY,      -- id conservado (1=USD, 2=UYU en el origen)
    Codigo   VARCHAR(10) NOT NULL,
    Simbolo  VARCHAR(10) NULL,
    Nombre   NVARCHAR(100) NULL
);

IF OBJECT_ID('dbo.Wms_TiposFactura') IS NULL
CREATE TABLE dbo.Wms_TiposFactura (
    TfaId    INT NOT NULL PRIMARY KEY,
    Nombre   NVARCHAR(100) NOT NULL
);

IF OBJECT_ID('dbo.Wms_PagosMotivos') IS NULL
CREATE TABLE dbo.Wms_PagosMotivos (
    PmoId    INT NOT NULL PRIMARY KEY,
    Nombre   NVARCHAR(100) NOT NULL,
    Activo   BIT NOT NULL DEFAULT 1
);

-- Plantillas de progreso (workflow configurable de compras/importaciones) -----
IF OBJECT_ID('dbo.Wms_PlantillasProgreso') IS NULL
CREATE TABLE dbo.Wms_PlantillasProgreso (
    PlaId       INT NOT NULL PRIMARY KEY,   -- id conservado
    Nombre      NVARCHAR(150) NOT NULL,
    Descripcion NVARCHAR(500) NULL
);

IF OBJECT_ID('dbo.Wms_PlantillasProgresoPasos') IS NULL
CREATE TABLE dbo.Wms_PlantillasProgresoPasos (
    PasId    INT NOT NULL PRIMARY KEY,      -- id conservado
    PlaId    INT NOT NULL,
    Clave    VARCHAR(50) NOT NULL,          -- lo que se guarda en Compras.Progreso
    Etiqueta NVARCHAR(150) NOT NULL,
    Icono    VARCHAR(50) NULL,
    Orden    INT NOT NULL DEFAULT 0
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WmsPasos_Pla')
    CREATE INDEX IX_WmsPasos_Pla ON dbo.Wms_PlantillasProgresoPasos(PlaId, Orden);

-- Pagos de compras/importaciones (señas, saldos, fletes, aduana) --------------
IF OBJECT_ID('dbo.Wms_Pagos') IS NULL
CREATE TABLE dbo.Wms_Pagos (
    PagId     INT IDENTITY PRIMARY KEY,
    CompId    INT NULL,                     -- una de las dos, no ambas
    ImpId     INT NULL,
    Monto     DECIMAL(18,2) NOT NULL,
    TipoPago  NVARCHAR(100) NULL,           -- texto del motivo elegido
    Motivo    NVARCHAR(300) NULL,           -- nota libre
    Fecha     DATETIME NOT NULL DEFAULT GETDATE(),
    UsuarioId INT NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WmsPagos_Comp')
    CREATE INDEX IX_WmsPagos_Comp ON dbo.Wms_Pagos(CompId);

-- Columnas que faltaban en compras/importaciones ------------------------------
IF COL_LENGTH('dbo.Wms_Compras', 'PlaId') IS NULL
    ALTER TABLE dbo.Wms_Compras ADD PlaId INT NULL;          -- plantilla de progreso
IF COL_LENGTH('dbo.Wms_Compras', 'TfaId') IS NULL
    ALTER TABLE dbo.Wms_Compras ADD TfaId INT NULL;          -- tipo de factura
IF COL_LENGTH('dbo.Wms_Compras', 'DepRecepcionId') IS NULL
    ALTER TABLE dbo.Wms_Compras ADD DepRecepcionId INT NULL; -- a qué depósito entra
IF COL_LENGTH('dbo.Wms_Importaciones', 'PlaId') IS NULL
    ALTER TABLE dbo.Wms_Importaciones ADD PlaId INT NULL;
-- Bultos/cajas físicas declaradas en la línea: al recibir se abre una etiqueta por bulto
-- (el sistema anterior las pre-creaba en 'pendiente_recepcion' con la misma cuenta).
IF COL_LENGTH('dbo.Wms_ComprasDetalle', 'Bultos') IS NULL
    ALTER TABLE dbo.Wms_ComprasDetalle ADD Bultos INT NOT NULL DEFAULT 1;

-- Responsable del remito: en el sistema anterior es texto libre (el nombre que
-- escribió el operario), no un id de usuario — CreadoPor es INT y lo perdía.
IF COL_LENGTH('dbo.Wms_RemitosInternos', 'Responsable') IS NULL
    ALTER TABLE dbo.Wms_RemitosInternos ADD Responsable NVARCHAR(120) NULL;

-- Datos logísticos del embarque (no existen en el sistema anterior).
IF COL_LENGTH('dbo.Wms_Compras', 'FechaEstimadaArribo') IS NULL
    ALTER TABLE dbo.Wms_Compras ADD FechaEstimadaArribo DATE NULL;
IF COL_LENGTH('dbo.Wms_Compras', 'VolumenM3') IS NULL
    ALTER TABLE dbo.Wms_Compras ADD VolumenM3 DECIMAL(18,3) NULL;
IF COL_LENGTH('dbo.Wms_Compras', 'PesoKg') IS NULL
    ALTER TABLE dbo.Wms_Compras ADD PesoKg DECIMAL(18,3) NULL;
IF COL_LENGTH('dbo.Wms_Compras', 'Incoterm') IS NULL
    ALTER TABLE dbo.Wms_Compras ADD Incoterm VARCHAR(10) NULL;   -- Incoterms 2020

-- Ficha textil de la variante (1/09): gramaje en g/m² y ancho del rollo en metros.
-- Con los dos, metros por kg = 1000 / (gramaje x ancho) — conversión kg <-> metros
-- de los rollos comprados por peso. NULL en artículos que no son tela.
IF COL_LENGTH('dbo.Wms_Variantes', 'GramajeGsm') IS NULL
    ALTER TABLE dbo.Wms_Variantes ADD GramajeGsm DECIMAL(8,2) NULL;
IF COL_LENGTH('dbo.Wms_Variantes', 'AnchoMetros') IS NULL
    ALTER TABLE dbo.Wms_Variantes ADD AnchoMetros DECIMAL(6,3) NULL;
-- (22/09) Composición de la tela ("100% Polyester", "96% Polyester, 4% Spandex"). Texto libre de
-- la variante, junto al ancho y el gramaje. El sistema también la crea solo si falta
-- (wmsInternoService.asegurarColumnasTela), así que correr esto a mano es opcional.
IF COL_LENGTH('dbo.Wms_Variantes', 'Composicion') IS NULL
    ALTER TABLE dbo.Wms_Variantes ADD Composicion NVARCHAR(200) NULL;

-- Archivos adjuntos de la compra (facturas, bills of lading, packing lists, despachos...).
-- Los PDF/imágenes viven en disco: <STOCK_COMPRAS_PATH>/<CompId>/<archivo>; acá va el índice.
IF OBJECT_ID('dbo.Wms_ComprasArchivos') IS NULL
CREATE TABLE dbo.Wms_ComprasArchivos (
    CarId          INT IDENTITY PRIMARY KEY,
    CompId         INT NOT NULL,
    NombreOriginal NVARCHAR(255) NOT NULL,
    Archivo        NVARCHAR(255) NOT NULL,      -- nombre en disco (único)
    MimeType       VARCHAR(100) NULL,
    Tamano         INT NULL,                    -- bytes
    Descripcion    NVARCHAR(200) NULL,          -- "Factura", "BL", "Despacho"...
    FechaSubida    DATETIME NOT NULL DEFAULT GETDATE(),
    UsuarioId      INT NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WmsCompArch_Comp')
    CREATE INDEX IX_WmsCompArch_Comp ON dbo.Wms_ComprasArchivos(CompId);

-- Umbrales POR DEPÓSITO (los globales viven en la variante). Sin fila acá, un depósito
-- no tiene mínimo propio: no se inventan quiebres locales — mismo criterio que el
-- sistema anterior, donde esta tabla está vacía y el panel dice "distribución sana".
IF OBJECT_ID('dbo.Wms_AlertasDepositos') IS NULL
CREATE TABLE dbo.Wms_AlertasDepositos (
    AlDId           INT IDENTITY PRIMARY KEY,
    VarId           INT NOT NULL,
    DepId           INT NOT NULL,
    CantidadCritica DECIMAL(18,4) NOT NULL DEFAULT 0,
    CantidadAlerta  DECIMAL(18,4) NOT NULL DEFAULT 0,
    CantidadIdeal   DECIMAL(18,4) NOT NULL DEFAULT 0
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WmsAlertasDep')
    CREATE UNIQUE INDEX UX_WmsAlertasDep ON dbo.Wms_AlertasDepositos(VarId, DepId);

-- Recepción por línea: cuánto de cada línea ya entró como etiqueta ------------
IF COL_LENGTH('dbo.Wms_ComprasDetalle', 'CantidadRecibida') IS NULL
    ALTER TABLE dbo.Wms_ComprasDetalle ADD CantidadRecibida DECIMAL(18,4) NOT NULL CONSTRAINT DF_WmsCDet_Recibida DEFAULT 0;
