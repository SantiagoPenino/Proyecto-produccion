-- ============================================================================
-- BENEFICIOS PACTADOS SOBRE LA BILLETERA — modelo de datos (F0)
-- Spec de negocio: specs/40-beneficios-pactados.md · Plan: docs/beneficios-billetera-plan.md
--
-- IDEMPOTENTE: se puede correr las veces que haga falta.
-- CORRER EN PRODUCCIÓN ANTES DEL DEPLOY DEL CÓDIGO: el motor de billetera y el de
-- precios referencian estas tablas/columnas. Todo es ADITIVO (tablas nuevas y
-- columnas NULL): no cambia ningún dato ni comportamiento existente.
--
-- Interruptor general: ConfiguracionGlobal.BENEFICIOS_ACTIVOS ('0' apagado, '1' encendido).
-- Nace en 0: con el interruptor apagado el catálogo, los pactos y la aprobación
-- funcionan, pero NO se activan beneficios, el motor de precios no aplica precios
-- pactados y el motor contable no consume bolsas.
-- ============================================================================
SET NOCOUNT ON;

-- 1) Perfil de precios marcado como beneficio (sus reglas no se asignan por PreciosEspeciales)
IF COL_LENGTH('dbo.PerfilesPrecios', 'EsBeneficio') IS NULL
BEGIN
  ALTER TABLE dbo.PerfilesPrecios ADD EsBeneficio bit NOT NULL CONSTRAINT DF_PerfilesPrecios_EsBeneficio DEFAULT 0;
  PRINT 'PerfilesPrecios.EsBeneficio agregada';
END

-- 2) Beneficios: plantillas (de la empresa) y pactos (por cliente) comparten la definición
IF OBJECT_ID('dbo.Beneficios', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Beneficios (
    BenIdBeneficio      int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Beneficios PRIMARY KEY,
    BenTipo             varchar(10)   NOT NULL,   -- PLANTILLA | PACTO
    BenNombre           nvarchar(120) NOT NULL,
    BenDescripcion      nvarchar(500) NULL,
    PerfilID            int           NOT NULL,   -- PerfilesPrecios.ID con EsBeneficio = 1 (las reglas de precio)
    MonIdMoneda         int           NOT NULL CONSTRAINT DF_Beneficios_Mon DEFAULT 1,  -- 1 $ | 2 US$ (una sola moneda por beneficio)
    BenCargaImporte     decimal(18,2) NOT NULL,   -- carga que lo activa
    BenCargaEsMinimo    bit           NOT NULL CONSTRAINT DF_Beneficios_Min DEFAULT 0,  -- 0 = monto fijo, 1 = mínimo (puede cargar más)
    BenVigenciaDias     int           NULL,       -- días desde la activación (NULL = no aplica)
    BenVigenciaHasta    date          NULL,       -- fecha fija (NULL = no aplica). Ambos NULL = hasta agotar
    BenPublico          bit           NOT NULL CONSTRAINT DF_Beneficios_Pub DEFAULT 0,  -- plantilla activable por todos desde el portal
    BenEstado           varchar(20)   NOT NULL,   -- plantilla: BORRADOR|PENDIENTE|PUBLICADA|PAUSADA · pacto: PENDIENTE|APROBADO|ACTIVADO|RECHAZADO|CANCELADO
    CliIdCliente        int           NULL,       -- solo pactos
    BenIdPlantillaBase  int           NULL,       -- pacto armado a partir de una plantilla
    BenVendedorId       int           NULL,       -- Usuarios.IdUsuario que propuso
    BenNota             nvarchar(1000) NULL,      -- nota del vendedor para quien aprueba
    BenAlertas          nvarchar(max) NULL,       -- JSON: precios peores que los actuales del cliente, calculados al proponer
    BenAprobadorId      int           NULL,
    BenFechaAprobacion  datetime      NULL,
    BenNotaAprobador    nvarchar(1000) NULL,
    BenMotivoRechazo    nvarchar(1000) NULL,
    BenFechaAlta        datetime      NOT NULL CONSTRAINT DF_Beneficios_Alta DEFAULT GETDATE(),
    BenUsuarioAlta      int           NULL,
    BenFechaModif       datetime      NULL,
    BenUsuarioModif     int           NULL
  );
  CREATE INDEX IX_Beneficios_Cliente ON dbo.Beneficios (CliIdCliente, BenEstado);
  CREATE INDEX IX_Beneficios_Tipo    ON dbo.Beneficios (BenTipo, BenEstado);
  PRINT 'Tabla Beneficios creada';
END

-- 3) BeneficiosCliente: un beneficio ACTIVADO = una bolsa (cuenta de billetera propia)
IF OBJECT_ID('dbo.BeneficiosCliente', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.BeneficiosCliente (
    BclIdBeneficioCliente     int IDENTITY(1,1) NOT NULL CONSTRAINT PK_BeneficiosCliente PRIMARY KEY,
    BenIdBeneficio            int           NOT NULL,
    CliIdCliente              int           NOT NULL,
    CueIdCuenta               int           NOT NULL,   -- la bolsa: CuentasCliente restringida, prepago facturada, auto
    DocIdDocumento            int           NULL,       -- factura de la carga que lo activó
    BclImporteCarga           decimal(18,2) NOT NULL,
    BclFechaActivacion        datetime      NOT NULL CONSTRAINT DF_BeneficiosCliente_Act DEFAULT GETDATE(),
    BclFechaVencimiento       date          NULL,       -- NULL = hasta agotar el saldo
    BclEstado                 varchar(20)   NOT NULL,   -- ACTIVO | PAUSADO | AGOTADO | VENCIDO | CERRADO
    BclOrigen                 varchar(20)   NULL,       -- CAJA | PORTAL
    BclPausadoPor             int           NULL,
    BclFechaPausa             datetime      NULL,
    BclCerradoPor             int           NULL,
    BclFechaCierre            datetime      NULL,
    MovIdTransferenciaCierre  int           NULL,       -- transferencia del saldo remanente a la billetera común
    BclUsuarioAlta            int           NULL
  );
  CREATE UNIQUE INDEX UX_BeneficiosCliente_Cuenta ON dbo.BeneficiosCliente (CueIdCuenta);
  CREATE INDEX IX_BeneficiosCliente_Cliente ON dbo.BeneficiosCliente (CliIdCliente, BclEstado);
  PRINT 'Tabla BeneficiosCliente creada';
END

-- 4) Marca "esta orden se cotizó con el beneficio N" (la cotización decide, el consumo obedece)
IF COL_LENGTH('dbo.Ordenes', 'BclIdBeneficioCliente') IS NULL
BEGIN
  ALTER TABLE dbo.Ordenes ADD BclIdBeneficioCliente int NULL;
  PRINT 'Ordenes.BclIdBeneficioCliente agregada';
END
IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'BclIdBeneficioCliente') IS NULL
BEGIN
  ALTER TABLE dbo.PedidosCobranzaDetalle ADD BclIdBeneficioCliente int NULL;
  PRINT 'PedidosCobranzaDetalle.BclIdBeneficioCliente agregada';
END

-- 5) Interruptor general (nace APAGADO)
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'BENEFICIOS_ACTIVOS')
BEGIN
  INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('BENEFICIOS_ACTIVOS', 'ADMIN', '0');
  PRINT 'ConfiguracionGlobal.BENEFICIOS_ACTIVOS = 0';
END

-- 6) Menú: dos entradas bajo "Ventas" (donde vive la Vista 360 del Cliente de vendedores)
DECLARE @padre int = (SELECT TOP 1 IdPadre FROM dbo.Modulos WHERE Ruta = '/vendedores/cliente-360');
IF @padre IS NULL SET @padre = (SELECT TOP 1 IdModulo FROM dbo.Modulos WHERE Titulo = 'Ventas' AND IdPadre IS NULL);

IF NOT EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta = '/beneficios/predefinidos')
BEGIN
  INSERT INTO dbo.Modulos (Titulo, Ruta, Icono, IdPadre, IndiceOrden)
  VALUES ('Beneficios predefinidos', '/beneficios/predefinidos', NULL, @padre, 91);
  PRINT 'Módulo /beneficios/predefinidos creado';
END
IF NOT EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta = '/beneficios/pactos')
BEGIN
  INSERT INTO dbo.Modulos (Titulo, Ruta, Icono, IdPadre, IndiceOrden)
  VALUES ('Beneficios pactados', '/beneficios/pactos', NULL, @padre, 92);
  PRINT 'Módulo /beneficios/pactos creado';
END

-- Permisos: Admin (1), VENTAS (7), Administracion (8), Atención al Cliente (12) — los mismos que ven la Vista 360 de vendedores, más Administración
DECLARE @mPre int = (SELECT IdModulo FROM dbo.Modulos WHERE Ruta = '/beneficios/predefinidos');
DECLARE @mPac int = (SELECT IdModulo FROM dbo.Modulos WHERE Ruta = '/beneficios/pactos');
INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT r.IdRol, m.IdModulo
FROM (VALUES (1), (7), (8), (12)) AS r(IdRol)
CROSS JOIN (VALUES (@mPre), (@mPac)) AS m(IdModulo)
WHERE m.IdModulo IS NOT NULL
  AND EXISTS (SELECT 1 FROM dbo.Roles ro WHERE ro.IdRol = r.IdRol)
  AND NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles pr WHERE pr.IdRol = r.IdRol AND pr.IdModulo = m.IdModulo);

-- 7) Aprobadores autorizados (además del rol Admin/Administracion): usuarios puntuales
-- que pueden aprobar/rechazar pactos y plantillas, pausar/reanudar/cerrar beneficios y
-- prender/apagar el interruptor general, aunque su rol de sistema no sea Admin ni
-- Administracion (specs/40: "no siempre es la Administración quien aprueba").
IF OBJECT_ID('dbo.BeneficiosAprobadores', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.BeneficiosAprobadores (
    IdUsuario      INT NOT NULL PRIMARY KEY,
    BapFechaAlta   DATETIME NOT NULL DEFAULT GETDATE(),
    BapUsuarioAlta INT NULL
  );
  PRINT 'Tabla BeneficiosAprobadores creada';
END

PRINT 'add_beneficios.sql: OK';
