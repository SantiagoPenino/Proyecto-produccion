-- ============================================================================
-- WMS PROPIO — DDL v1 (2026-08-26) · APROBADO — listo para correr en prod
-- (decisiones c y d selladas: historial = apertura limpia + Wms_HistoricoExterno
-- de solo consulta; faltantes = Wms_Discrepancias, nunca trabar).
-- Tipos calcados de Ventas_Dev (INFORMATION_SCHEMA 26/08, A_tipos.json).
-- Orden de ejecución: 1) este DDL entero → 2) node scripts/wmsImportSnapshot.js
-- Ids que se CONSERVAN en la migración (todo el sistema ya los referencia):
--   Wms_Variantes.VarId    = Stock_Variantes.id      (PK sin IDENTITY)
--   Wms_Etiquetas.EtiId    = Stock_Etiquetas.id      (códigos de barra impresos)
--   Wms_Depositos.DepId    = Stock_Depositos.id      (el local = 5)
--   Wms_Categorias.CatId   = Stock_Categorias.id     (referenciada por maestros)
--   Wms_ProductosMaestros.PmaId = Stock_Productos_Maestros.id
-- Remitos/solicitudes/compras/proveedores usan IDENTITY: el import los inserta
-- con IDENTITY_INSERT conservando ids y resembra la secuencia al final.
-- ============================================================================

-- ── Catálogo ────────────────────────────────────────────────────────────────
CREATE TABLE dbo.Wms_Depositos (
    DepId           INT NOT NULL PRIMARY KEY,          -- se conserva el id (5 = local)
    Nombre          VARCHAR(100) NOT NULL,
    Tipo            VARCHAR(50) NULL,                  -- propio / tercero
    Ubicacion       VARCHAR(255) NULL,
    Activo          BIT NOT NULL DEFAULT 1
);

CREATE TABLE dbo.Wms_Categorias (
    CatId           INT NOT NULL PRIMARY KEY,          -- se conserva el id (lo referencia PmaId)
    Nombre          NVARCHAR(100) NOT NULL,
    Descripcion     NVARCHAR(255) NULL
);

CREATE TABLE dbo.Wms_ProductosMaestros (
    PmaId           INT NOT NULL PRIMARY KEY,          -- se conserva el id
    Nombre          NVARCHAR(255) NOT NULL,
    Sku             NVARCHAR(100) NULL,
    CatId           INT NULL REFERENCES dbo.Wms_Categorias(CatId),
    UnidadBase      NVARCHAR(50) NOT NULL DEFAULT 'unidad',
    TipoGestion     VARCHAR(50) NOT NULL DEFAULT 'granel',   -- granel / etiquetado / ...
    LlevaPeso       BIT NOT NULL DEFAULT 0,
    AtributosConfig NVARCHAR(MAX) NULL,                -- JSON de ejes (talle/color)
    CostoUnitarioBase DECIMAL(18,2) NOT NULL DEFAULT 0,
    FechaCreacion   DATETIME NOT NULL DEFAULT GETDATE()
);

-- LA entidad variante del sistema (absorbe Articulos_WMS_Variantes — decisión e).
CREATE TABLE dbo.Wms_Variantes (
    VarId           INT NOT NULL PRIMARY KEY,          -- = wms_variante_id histórico (SE CONSERVA)
    PmaId           INT NOT NULL REFERENCES dbo.Wms_ProductosMaestros(PmaId),
    NombreVariante  NVARCHAR(255) NOT NULL,
    CodigoVariante  NVARCHAR(150) NULL,                -- sku de la variante
    Talle           NVARCHAR(50) NULL,                 -- ejes como datos (sección marketing)
    Color           NVARCHAR(50) NULL,
    ProIdProducto   INT NULL,                          -- FK lógico a dbo.Articulos (mapeo ERP)
    Costo           DECIMAL(18,2) NOT NULL DEFAULT 0,
    Moneda          VARCHAR(20) NOT NULL DEFAULT 'UYU',
    MetadataJson    NVARCHAR(MAX) NULL,
    StockMinimo     DECIMAL(18,2) NOT NULL DEFAULT 0,
    CantidadAlerta  INT NOT NULL DEFAULT 0,
    CantidadCritica INT NOT NULL DEFAULT 0,
    CantidadIdeal   INT NOT NULL DEFAULT 0,
    AlertaActivada  BIT NOT NULL DEFAULT 0,
    Activa          BIT NOT NULL DEFAULT 1,
    FechaCreacion   DATETIME NOT NULL DEFAULT GETDATE()
);
CREATE INDEX IX_WmsVariantes_Pma      ON dbo.Wms_Variantes(PmaId);
CREATE INDEX IX_WmsVariantes_Articulo ON dbo.Wms_Variantes(ProIdProducto) WHERE ProIdProducto IS NOT NULL;

-- ── Existencias ─────────────────────────────────────────────────────────────
-- Cada etiqueta = un bulto físico etiquetado. Stock = SUM(CantidadActual) activas.
-- REGLA DE ORO: CantidadActual NUNCA se updatea suelta — siempre movimiento +
-- update en la MISMA transacción, únicamente vía wmsInternoService.
CREATE TABLE dbo.Wms_Etiquetas (
    EtiId            INT NOT NULL PRIMARY KEY,         -- se conserva el id (códigos de barra impresos ya lo referencian)
    VarId            INT NOT NULL REFERENCES dbo.Wms_Variantes(VarId),
    DepId            INT NOT NULL REFERENCES dbo.Wms_Depositos(DepId),
    CantidadInicial  DECIMAL(18,4) NOT NULL,
    CantidadActual   DECIMAL(18,4) NOT NULL DEFAULT 0,
    MedidaSecundaria DECIMAL(10,2) NULL,               -- ej. metros cuando la unidad es kg
    Peso             DECIMAL(18,3) NULL,
    CostoUnitarioReal DECIMAL(18,2) NOT NULL DEFAULT 0,
    CodigoBarras     VARCHAR(255) NULL,
    CompraId         INT NULL,                         -- FK a Wms_Compras (GUID viejo mapeado en el ETL)
    Estado           VARCHAR(50) NOT NULL DEFAULT 'activo',  -- activo / consumido / anulado
    FechaIngreso     DATETIME NOT NULL DEFAULT GETDATE(),
    UltimaActualizacion DATETIME NOT NULL DEFAULT GETDATE(),
    UsuarioIngreso   INT NULL
);
CREATE INDEX IX_WmsEtiquetas_Var_Dep_Estado ON dbo.Wms_Etiquetas(VarId, DepId, Estado) INCLUDE (CantidadActual);
CREATE INDEX IX_WmsEtiquetas_Barras         ON dbo.Wms_Etiquetas(CodigoBarras);

-- Ledger: fuente de verdad de todo cambio de stock.
CREATE TABLE dbo.Wms_Movimientos (
    MovId            INT IDENTITY PRIMARY KEY,
    EtiId            INT NOT NULL REFERENCES dbo.Wms_Etiquetas(EtiId),
    Tipo             VARCHAR(50) NOT NULL,             -- ingreso_compra / egreso_venta_web / baja_consumo / traslado_salida / traslado_entrada / ajuste_conteo / anulacion / apertura_migracion
    Cantidad         DECIMAL(18,4) NOT NULL,           -- signo explícito (+entra / -sale)
    MedidaSecundaria DECIMAL(10,2) NULL,
    DepOrigenId      INT NULL,
    DepDestinoId     INT NULL,
    RefTipo          VARCHAR(30) NULL,                 -- PEDIDO_COBRANZA / ORDEN / REMITO / COMPRA / CONTEO
    RefId            INT NULL,
    IdempotencyKey   VARCHAR(120) NULL,                -- p.ej. 'PEDIDO_COBRANZA:1234:VEN' — el retry no duplica
    UsuarioId        INT NULL,
    Fecha            DATETIME NOT NULL DEFAULT GETDATE()
);
CREATE UNIQUE INDEX UX_WmsMov_Idem ON dbo.Wms_Movimientos(IdempotencyKey) WHERE IdempotencyKey IS NOT NULL;
CREATE INDEX IX_WmsMov_Eti   ON dbo.Wms_Movimientos(EtiId, Fecha);
CREATE INDEX IX_WmsMov_Ref   ON dbo.Wms_Movimientos(RefTipo, RefId);
CREATE INDEX IX_WmsMov_Tipo  ON dbo.Wms_Movimientos(Tipo, Fecha);

-- (Decisión d, si se aprueba) Diferencias de inventario: el faltante al confirmar
-- una venta deja de ser un warning invisible y queda acá hasta que alguien lo resuelva.
CREATE TABLE dbo.Wms_Discrepancias (
    DisId       INT IDENTITY PRIMARY KEY,
    VarId       INT NOT NULL REFERENCES dbo.Wms_Variantes(VarId),
    DepId       INT NOT NULL,
    Faltante    DECIMAL(18,4) NOT NULL,
    RefTipo     VARCHAR(30) NULL,
    RefId       INT NULL,
    Estado      VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE / RESUELTA
    Resolucion  NVARCHAR(300) NULL,
    Fecha       DATETIME NOT NULL DEFAULT GETDATE(),
    FechaResolucion DATETIME NULL,
    UsuarioResolucion INT NULL
);

-- ── Logística interna ───────────────────────────────────────────────────────
CREATE TABLE dbo.Wms_RemitosInternos (
    RemId           INT IDENTITY PRIMARY KEY,
    Numeracion      VARCHAR(50) NOT NULL,
    DepOrigenId     INT NOT NULL REFERENCES dbo.Wms_Depositos(DepId),
    DepDestinoId    INT NOT NULL REFERENCES dbo.Wms_Depositos(DepId),
    Estado          VARCHAR(50) NOT NULL DEFAULT 'EN_TRANSITO',  -- BORRADOR/EN_TRANSITO/RECIBIDO/CANCELADO
    Observaciones   NVARCHAR(MAX) NULL,
    CreadoPor       INT NULL,
    FechaCreacion   DATETIME NOT NULL DEFAULT GETDATE(),
    MotivoCancelacion NVARCHAR(500) NULL,
    CanceladoPor    INT NULL,
    FechaCancelacion DATETIME NULL
);
CREATE TABLE dbo.Wms_RemitosInternosItems (
    RemItId          INT IDENTITY PRIMARY KEY,
    RemId            INT NOT NULL REFERENCES dbo.Wms_RemitosInternos(RemId),
    VarId            INT NOT NULL REFERENCES dbo.Wms_Variantes(VarId),
    CantidadEnviada  DECIMAL(18,4) NOT NULL,
    CantidadRecibida DECIMAL(18,4) NULL,
    Estado           VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE',
    EtiGeneradaId    INT NULL                          -- etiqueta que nace al recibir
);
CREATE INDEX IX_WmsRemItems_Rem ON dbo.Wms_RemitosInternosItems(RemId);

CREATE TABLE dbo.Wms_Solicitudes (
    SolId           INT IDENTITY PRIMARY KEY,
    Numeracion      VARCHAR(50) NOT NULL,
    DepSolicitanteId INT NOT NULL,
    Estado          VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE',
    CreadoPor       INT NULL,
    FechaCreacion   DATETIME NOT NULL DEFAULT GETDATE()
);
CREATE TABLE dbo.Wms_SolicitudesItems (
    SolItId         INT IDENTITY PRIMARY KEY,
    SolId           INT NOT NULL REFERENCES dbo.Wms_Solicitudes(SolId),
    VarId           INT NOT NULL,
    CantidadSolicitada DECIMAL(18,4) NOT NULL
);

CREATE TABLE dbo.Wms_EquivalenciasMetricas (
    EqmId           INT IDENTITY PRIMARY KEY,
    PmaId           INT NOT NULL REFERENCES dbo.Wms_ProductosMaestros(PmaId),
    GramosPorMetro  DECIMAL(18,4) NOT NULL
);

-- ── Abastecimiento (F4 — las tablas nacen ya para recibir el ETL) ───────────
CREATE TABLE dbo.Wms_Proveedores (
    PrvId       INT IDENTITY PRIMARY KEY,
    Nombre      NVARCHAR(200) NOT NULL,
    RazonSocial NVARCHAR(200) NULL,
    Documento   VARCHAR(50) NULL,
    Contacto    NVARCHAR(200) NULL,
    Ciudad      NVARCHAR(100) NULL
);
CREATE TABLE dbo.Wms_Compras (
    CompId          INT IDENTITY PRIMARY KEY,
    GuidViejo       UNIQUEIDENTIFIER NULL,             -- id del sistema anterior (trazabilidad ETL)
    PrvId           INT NULL REFERENCES dbo.Wms_Proveedores(PrvId),
    ImportacionId   INT NULL,
    ReferenciaFactura NVARCHAR(200) NULL,
    TipoFactura     VARCHAR(50) NULL,
    MonedaId        INT NULL,
    TotalCompra     DECIMAL(18,2) NOT NULL DEFAULT 0,
    GastosExtras    DECIMAL(18,2) NOT NULL DEFAULT 0,
    Estado          NVARCHAR(50) NOT NULL DEFAULT 'completada',
    Progreso        VARCHAR(50) NULL,
    AutorizadoRecepcion BIT NOT NULL DEFAULT 0,
    CreadoPor       INT NULL,
    FechaCreacion   DATETIME NOT NULL DEFAULT GETDATE()
);
CREATE TABLE dbo.Wms_ComprasDetalle (
    CDetId          INT IDENTITY PRIMARY KEY,
    CompId          INT NOT NULL REFERENCES dbo.Wms_Compras(CompId),
    VarId           INT NOT NULL,
    Cantidad        DECIMAL(18,4) NOT NULL,
    PrecioUnitario  DECIMAL(18,2) NOT NULL,
    CostoPuestoLocal DECIMAL(18,2) NULL
);
CREATE TABLE dbo.Wms_ComprasCostosExtra (
    CceId       INT IDENTITY PRIMARY KEY,
    CompId      INT NOT NULL REFERENCES dbo.Wms_Compras(CompId),
    Descripcion NVARCHAR(300) NOT NULL,
    Monto       DECIMAL(18,2) NOT NULL
);
CREATE TABLE dbo.Wms_Importaciones (
    ImpId           INT IDENTITY PRIMARY KEY,
    GuidViejo       UNIQUEIDENTIFIER NULL,
    Origen          NVARCHAR(200) NULL,
    EmpresaImportadora NVARCHAR(200) NULL,
    ContactoImportadora NVARCHAR(200) NULL,
    EmpresaTransporteLocal NVARCHAR(200) NULL,
    ContactoTransporteLocal NVARCHAR(200) NULL,
    Estado          VARCHAR(50) NULL,
    Progreso        VARCHAR(50) NULL,
    CreadoPor       INT NULL,
    FechaCreacion   DATETIME NOT NULL DEFAULT GETDATE()
);

-- (Decisión c — APROBADA) Histórico del sistema viejo, SOLO consulta. Copia cruda de
-- Stock_Movimientos: sin FKs, ids GUID como texto, usuario como venía. El import lo
-- recarga entero en cada corrida (TRUNCATE + INSERT).
CREATE TABLE dbo.Wms_HistoricoExterno (
    HexId            INT IDENTITY PRIMARY KEY,
    GuidViejo        UNIQUEIDENTIFIER NULL,
    NumeroSecuencial INT NULL,
    EtiquetaId       INT NULL,
    VarianteId       INT NULL,              -- derivado de la etiqueta en el import
    Tipo             NVARCHAR(100) NULL,
    Cantidad         DECIMAL(18,4) NULL,
    MedidaSecundaria DECIMAL(10,2) NULL,
    DepOrigenId      INT NULL,
    DepDestinoId     INT NULL,
    RemitoId         INT NULL,
    CompraGuid       UNIQUEIDENTIFIER NULL,
    Usuario          VARCHAR(50) NULL,
    Fecha            DATETIME NULL
);
CREATE INDEX IX_WmsHex_Eti   ON dbo.Wms_HistoricoExterno(EtiquetaId, Fecha);
CREATE INDEX IX_WmsHex_Var   ON dbo.Wms_HistoricoExterno(VarianteId, Fecha);

-- NOTAS DE DISEÑO (vs. el sistema viejo):
-- 1. Sus movimientos usan GUID + numero_secuencial; acá INT IDENTITY + IdempotencyKey UNIQUE.
-- 2. Su "seguridad" era el trigger PreventDirectDiscount + la tabla-firma #WmsSecureTx_v17
--    (cualquiera con la firma pasaba). Acá NO hay triggers: el único que escribe es
--    wmsInternoService dentro de transacción, y los permisos son los del sistema.
-- 3. Su único trigger de mantenimiento automático cubría SOLO egreso_venta_web; el resto
--    de su app actualizaba cantidad_actual a mano. Acá TODA vía pasa por el servicio.
-- 4. compra_id GUID → CompraId INT: el ETL mapea GuidViejo→CompId al migrar etiquetas.
