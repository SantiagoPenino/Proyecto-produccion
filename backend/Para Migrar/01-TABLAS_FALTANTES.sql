USE [SecureAppDB2205];
GO

-- ============================================================================

-- 1. CREACIÓN DE TABLAS FALTANTES (CON PK, DEFAULT Y DECIMALES CORREGIDOS)
-- ============================================================================


IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='EgresosCaja')
CREATE TABLE dbo.[EgresosCaja] (
    [EgrIdEgreso] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [StuIdSesion] int NULL,
    [EgrFecha] datetime NOT NULL,
    [EgrUsuarioId] int NOT NULL,
    [EgrConcepto] nvarchar(200) NOT NULL,
    [EgrProveedor] nvarchar(150) NULL,
    [EgrMonto] decimal(18,2) NOT NULL,
    [EgrMoneda] varchar(10) NOT NULL,
    [EgrCotizacion] decimal(18,6) NULL,
    [EgrMontoConvertido] decimal(18,2) NOT NULL,
    [MPaIdMetodoPago] int NULL,
    [EgrTipoDocumento] varchar(20) NULL,
    [EgrSerieDoc] varchar(5) NULL,
    [EgrNumeroDoc] varchar(20) NULL,
    [EgrEstado] varchar(20) NOT NULL,
    [EgrComprobante] nvarchar(500) NULL,
    [EgrObservaciones] nvarchar(300) NULL,
    [DocIdDocumento] int NULL,
    [EgrTipoEgreso] varchar(30) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SecuenciaDocumentos')
CREATE TABLE dbo.[SecuenciaDocumentos] (
    [SecIdSecuencia] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [SecTipoDoc] varchar(20) NOT NULL,
    [SecSerie] varchar(5) NOT NULL,
    [SecPrefijo] varchar(10) NULL,
    [SecDigitos] int NOT NULL,
    [SecUltimoNumero] int NOT NULL,
    [SecActivo] bit NOT NULL,
    [SecObservaciones] nvarchar(200) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SesionesTurno')
CREATE TABLE dbo.[SesionesTurno] (
    [StuIdSesion] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [StuFechaApertura] datetime NOT NULL DEFAULT (GETDATE()),
    [StuFechaCierre] datetime NULL,
    [StuUsuarioAbre] int NOT NULL,
    [StuUsuarioCierra] int NULL,
    [StuMontoInicial] decimal(18,2) NOT NULL,
    [StuMontoFinal] decimal(18,2) NULL,
    [StuMontoSistema] decimal(18,2) NULL,
    [StuDiferencia] decimal(18,2) NULL,
    [StuEstado] varchar(30) NOT NULL,
    [StuObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TransaccionesCaja')
CREATE TABLE dbo.[TransaccionesCaja] (
    [TcaIdTransaccion] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [TcaFecha] datetime NOT NULL,
    [TcaUsuarioId] int NOT NULL,
    [TcaClienteId] int NOT NULL,
    [TcaTipoDocumento] varchar(20) NOT NULL,
    [TcaSerieDoc] varchar(5) NULL,
    [TcaNumeroDoc] varchar(20) NULL,
    [TcaTotalBruto] decimal(18,2) NOT NULL,
    [TcaTotalAjuste] decimal(18,2) NOT NULL,
    [TcaTotalNeto] decimal(18,2) NOT NULL,
    [TcaTotalCobrado] decimal(18,2) NOT NULL,
    [TcaMonedaBase] varchar(10) NOT NULL,
    [TcaEstado] varchar(20) NOT NULL,
    [TcaObservaciones] nvarchar(500) NULL,
    [TcaFechaAnulacion] datetime NULL,
    [TcaUsuarioAnula] int NULL,
    [StuIdSesion] int NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SINCRONIZAR DATOS SISTEMAS - SINCRO')
CREATE TABLE dbo.[SINCRONIZAR DATOS SISTEMAS - SINCRO] (
    [N_A] nvarchar(100) NOT NULL,
    [codStock] nvarchar(50) NOT NULL,
    [VARIANTE] nvarchar(100) NOT NULL,
    [PROIDPRODUCTO] smallint NULL,
    [Material] nvarchar(150) NOT NULL,
    [codArticulo] smallint NULL,
    [IDREACT] tinyint NULL,
    [AREA] nvarchar(50) NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SINCRO-ARTICULOS')
CREATE TABLE dbo.[SINCRO-ARTICULOS] (
    [PRODUCTO] nvarchar(100) NULL,
    [codStock] nvarchar(100) NULL,
    [VARIANTE] nvarchar(100) NULL,
    [PROIDPRODUCTO] smallint NULL,
    [Material] nvarchar(150) NULL,
    [codArticulo] smallint NULL,
    [IDREACT] smallint NULL,
    [AREA] nvarchar(50) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ConfiguracionPrecios')
CREATE TABLE dbo.[ConfiguracionPrecios] (
    [Clave] varchar(100) NOT NULL PRIMARY KEY,
    [Valor] varchar(255) NOT NULL,
    [AreaID] varchar(20) NULL,
    [Descripcion] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TesoreriaBancos')
CREATE TABLE dbo.[TesoreriaBancos] (
    [IdBanco] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [NombreBanco] varchar(100) NOT NULL,
    [Activo] bit NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TesoreriaCheques')
CREATE TABLE dbo.[TesoreriaCheques] (
    [IdCheque] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [Tipo] varchar(20) NOT NULL,
    [NumeroCheque] varchar(50) NOT NULL,
    [IdBanco] int NOT NULL,
    [Monto] decimal(18,2) NOT NULL,
    [IdMoneda] int NOT NULL,
    [FechaEmision] date NOT NULL,
    [FechaVencimiento] date NOT NULL,
    [Estado] varchar(20) NOT NULL,
    [IdClienteOrigen] int NULL,
    [IdProveedorDestino] int NULL,
    [Notas] varchar(MAX) NULL,
    [FechaRegistro] datetime NULL,
    [UsuarioRegistro] varchar(50) NULL,
    [Agencia] varchar(255) NULL,
    [EmitidoPor] varchar(255) NULL,
    [EndosadoPor] varchar(255) NULL,
    [EsPagoParcial] bit NULL,
    [CategoriaPropiedad] varchar(50) NULL,
    [ClasificacionPlazo] varchar(50) NULL,
    [RubroContableId] int NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Config_TiposDocumento')
CREATE TABLE dbo.[Config_TiposDocumento] (
    [CodDocumento] varchar(10) NOT NULL PRIMARY KEY,
    [Detalle] varchar(100) NULL,
    [Codigo_Efact] int NULL,
    [RutObligatorio] bit NULL,
    [AfectaCtaCte] bit NULL,
    [Referenciado] bit NULL,
    [NroCaja] int NULL,
    [EvtCodigo] varchar(50) NULL,
    [SecIdSecuencia] int NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='DocumentosContablesDetalle')
CREATE TABLE dbo.[DocumentosContablesDetalle] (
    [DcdIdDetalle] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [DocIdDocumento] int NOT NULL,
    [OrdCodigoOrden] varchar(50) NULL,
    [DcdNomItem] varchar(80) NOT NULL,
    [DcdDscItem] varchar(1000) NULL,
    [DcdCantidad] decimal(18,4) NOT NULL,
    [DcdPrecioUnitario] decimal(18,2) NULL,
    [DcdSubtotal] decimal(18,2) NULL,
    [DcdImpuestos] decimal(18,2) NULL,
    [DcdTotal] decimal(18,2) NULL,
    [DcdTotalDescuentos] decimal(18,2) NULL,
    [DcdDescuentoStr] varchar(100) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Config_CuentasEgreso')
CREATE TABLE dbo.[Config_CuentasEgreso] (
    [CegId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CegTipoEgreso] varchar(30) NOT NULL,
    [CegNombreTipo] nvarchar(80) NOT NULL,
    [CegCueCodigo] varchar(20) NOT NULL,
    [CegCueNombre] nvarchar(100) NOT NULL,
    [CegEmoji] varchar(10) NULL,
    [CegOrden] int NOT NULL,
    [CegActivo] bit NOT NULL,
    [CegFechaAlta] datetime NOT NULL,
    [CegUsuarioAlta] int NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='AutorizacionesSinPago')
CREATE TABLE dbo.[AutorizacionesSinPago] (
    [AuzIdAutorizacion] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [OReIdOrdenRetiro] int NOT NULL,
    [AuzFecha] datetime NOT NULL,
    [AuzUsuarioId] int NOT NULL,
    [AuzMotivo] nvarchar(300) NOT NULL,
    [AuzMontoDeuda] decimal(18,2) NOT NULL,
    [AuzFechaVencimiento] date NULL,
    [AuzEstado] varchar(20) NOT NULL,
    [AuzFechaCobro] datetime NULL,
    [TcaIdTransaccion] int NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='CondicionesPago')
CREATE TABLE dbo.[CondicionesPago] (
    [CPaIdCondicion] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CPaNombre] nvarchar(100) NOT NULL,
    [CPaDiasVencimiento] int NOT NULL,
    [CPaPermiteCuotas] bit NOT NULL,
    [CPaCantidadCuotas] int NOT NULL,
    [CPaDiasEntreCuotas] int NOT NULL,
    [CPaActiva] bit NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ImputacionPago')
CREATE TABLE dbo.[ImputacionPago] (
    [ImpIdImputacion] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [PagIdPago] int NOT NULL,
    [DDeIdDocumento] int NOT NULL,
    [CueIdCuenta] int NOT NULL,
    [ImpImporte] decimal(18,4) NOT NULL,
    [ImpFecha] datetime NOT NULL,
    [ImpUsuarioAlta] int NOT NULL,
    [ImpObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TiposMovimiento')
CREATE TABLE dbo.[TiposMovimiento] (
    [TmoId] varchar(30) NOT NULL PRIMARY KEY,
    [TmoNombre] nvarchar(100) NOT NULL,
    [TmoDescripcion] nvarchar(500) NULL,
    [TmoPrefijo] varchar(5) NOT NULL,
    [TmoSecuencia] varchar(30) NULL,
    [TmoAfectaSaldo] smallint NOT NULL,
    [TmoGeneraDeuda] bit NOT NULL,
    [TmoAplicaRecurso] bit NOT NULL,
    [TmoRequiereDoc] bit NOT NULL,
    [TmoActivo] bit NOT NULL,
    [TmoOrden] int NOT NULL,
    [TmoFechaAlta] datetime NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TransaccionDetalle')
CREATE TABLE dbo.[TransaccionDetalle] (
    [TdeIdDetalle] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [TcaIdTransaccion] int NOT NULL,
    [TdeTipoReferencia] varchar(20) NOT NULL,
    [TdeReferenciaId] int NULL,
    [TdeCodigoReferencia] varchar(30) NULL,
    [TdeDescripcion] nvarchar(200) NULL,
    [TdeImporteOriginal] decimal(18,2) NOT NULL,
    [TdeAjuste] decimal(18,2) NOT NULL,
    [TdeImporteFinal] decimal(18,2) NOT NULL,
    [TdeTipoAjuste] varchar(20) NULL,
    [TdePagado] bit NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SINCRO-ARTICULOSVIEJA')
CREATE TABLE dbo.[SINCRO-ARTICULOSVIEJA] (
    [DESCRIPCION] nvarchar(100) NOT NULL,
    [codStock] nvarchar(50) NOT NULL,
    [VARIANTE] nvarchar(100) NOT NULL,
    [PROIDPRODUCTO] int NULL,
    [Material] nvarchar(150) NOT NULL,
    [codArticulo] smallint NULL,
    [IDREACT] varchar(50) NULL,
    [AREA] nvarchar(50) NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_PlanCuentas')
CREATE TABLE dbo.[Cont_PlanCuentas] (
    [CueId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CueCodigo] varchar(30) NOT NULL,
    [CueNombre] nvarchar(200) NOT NULL,
    [CueNivel] int NOT NULL,
    [CueTipoBase] varchar(50) NOT NULL,
    [CueMoneda] varchar(10) NOT NULL,
    [CueImputable] bit NOT NULL,
    [CueActiva] bit NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_TiposTransaccion')
CREATE TABLE dbo.[Cont_TiposTransaccion] (
    [TrtCodigo] varchar(30) NOT NULL PRIMARY KEY,
    [TrtNombre] nvarchar(100) NOT NULL,
    [TrtDescripcion] nvarchar(500) NULL,
    [TrtUsaEntidad] bit NOT NULL,
    [TrtEstado] bit NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_EventosContables')
CREATE TABLE dbo.[Cont_EventosContables] (
    [EvtCodigo] varchar(30) NOT NULL PRIMARY KEY,
    [EvtNombre] nvarchar(200) NOT NULL,
    [EvtDescripcion] nvarchar(1000) NULL,
    [EvtPrefijo] varchar(5) NULL,
    [EvtSubtipo] varchar(30) NULL,
    [EvtAfectaSaldo] smallint NOT NULL,
    [EvtGeneraDeuda] bit NOT NULL,
    [EvtAplicaRecurso] bit NOT NULL,
    [EvtUsaEntidad] bit NOT NULL,
    [EvtRequiereDoc] bit NOT NULL,
    [EvtActivo] bit NOT NULL,
    [EvtOrden] int NOT NULL,
    [EvtFechaAlta] datetime NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_ReglasEventos')
CREATE TABLE dbo.[Cont_ReglasEventos] (
    [RegId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [RegCodigo] varchar(50) NOT NULL,
    [RegNombre] nvarchar(100) NOT NULL,
    [RegCuentaDebe] int NULL,
    [RegCuentaHaber] int NULL,
    [RegObservacion] nvarchar(200) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_ReglasContables')
CREATE TABLE dbo.[Cont_ReglasContables] (
    [RgcId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [TrtCodigo] varchar(30) NOT NULL,
    [CueCodigo] varchar(20) NOT NULL,
    [RgcNaturaleza] varchar(10) NOT NULL,
    [RgcFilaFormula] varchar(50) NOT NULL,
    [RgcOrden] int NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_ReglasAsiento')
CREATE TABLE dbo.[Cont_ReglasAsiento] (
    [RasId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [EvtCodigo] varchar(30) NOT NULL,
    [CueCodigo] varchar(30) NOT NULL,
    [RasNaturaleza] varchar(10) NOT NULL,
    [RasFormula] varchar(50) NOT NULL,
    [RasOrden] int NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_AsientosCabecera')
CREATE TABLE dbo.[Cont_AsientosCabecera] (
    [AsiId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [AsiFecha] datetime NOT NULL,
    [AsiConcepto] nvarchar(200) NOT NULL,
    [AsiEstado] varchar(20) NOT NULL,
    [UsuarioId] int NOT NULL,
    [TcaIdTransaccion] int NULL,
    [SysOrigen] varchar(50) NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_AsientosDetalle')
CREATE TABLE dbo.[Cont_AsientosDetalle] (
    [DetId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [AsiId] int NOT NULL,
    [CueId] int NOT NULL,
    [DetDebeUYU] decimal(18,2) NOT NULL,
    [DetHaberUYU] decimal(18,2) NOT NULL,
    [DetImporteOriginal] decimal(18,4) NOT NULL,
    [DetCotizacion] decimal(18,6) NOT NULL,
    [DetMonedaId] int NOT NULL,
    [DetEntidadId] int NULL,
    [DetEntidadTipo] varchar(20) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='CuentasCliente')
CREATE TABLE dbo.[CuentasCliente] (
    [CueIdCuenta] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CliIdCliente] int NOT NULL,
    [CPaIdCondicion] int NOT NULL,
    [CueTipo] varchar(20) NOT NULL,
    [ProIdProducto] int NULL,
    [MonIdMoneda] int NULL,
    [CueSaldoActual] decimal(18,4) NOT NULL,
    [CueLimiteCredito] decimal(18,4) NOT NULL,
    [CuePuedeNegativo] bit NOT NULL,
    [CueDiasCiclo] int NULL,
    [CueCicloActivo] bit NOT NULL,
    [CueActiva] bit NOT NULL,
    [CueFechaAlta] datetime NOT NULL,
    [CueUsuarioAlta] int NULL,
    [CueObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='MovimientosCuenta')
CREATE TABLE dbo.[MovimientosCuenta] (
    [MovIdMovimiento] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CueIdCuenta] int NOT NULL,
    [MovTipo] varchar(30) NOT NULL,
    [MovConcepto] nvarchar(500) NOT NULL,
    [MovImporte] decimal(18,4) NOT NULL,
    [MovSaldoPosterior] decimal(18,4) NOT NULL,
    [OrdIdOrden] int NULL,
    [OReIdOrdenRetiro] int NULL,
    [PagIdPago] int NULL,
    [DocIdDocumento] int NULL,
    [MovRefExterna] varchar(100) NULL,
    [MovFecha] datetime NOT NULL DEFAULT GETDATE(),
    [MovUsuarioAlta] int NOT NULL,
    [MovAnulado] bit NOT NULL DEFAULT 0,
    [MovIdAnula] int NULL,
    [MovObservaciones] nvarchar(500) NULL,
    [CicIdCiclo] int NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='DeudaDocumento')
CREATE TABLE dbo.[DeudaDocumento] (
    [DDeIdDocumento] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CueIdCuenta] int NOT NULL,
    [OrdIdOrden] int NULL,
    [OReIdOrdenRetiro] int NULL,
    [DocIdDocumento] int NULL,
    [DDeImporteOriginal] decimal(18,4) NOT NULL,
    [DDeImportePendiente] decimal(18,4) NOT NULL,
    [DDeFechaEmision] date NOT NULL,
    [DDeFechaVencimiento] date NOT NULL,
    [DDeCuotaNumero] int NOT NULL DEFAULT 1,
    [DDeCuotaTotal] int NOT NULL DEFAULT 1,
    [DDeEstado] varchar(20) NOT NULL,
    [DDeFechaCobro] datetime NULL,
    [DDeObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='DocumentosContables')
CREATE TABLE dbo.[DocumentosContables] (
    [DocIdDocumento] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CueIdCuenta] int NOT NULL,
    [CliIdCliente] int NOT NULL,
    [DocTipo] varchar(20) NOT NULL,
    [DocNumero] varchar(50) NOT NULL,
    [DocSerie] varchar(10) NOT NULL,
    [DocIdDocumentoRef] int NULL,
    [DocMotivoRef] nvarchar(300) NULL,
    [DocFechaDesde] date NULL,
    [DocFechaHasta] date NULL,
    [DocSubtotal] decimal(18,2) NOT NULL,
    [MonIdMoneda] int NOT NULL,
    [DocTotalDescuentos] decimal(18,2) NOT NULL,
    [DocTotalRecargos] decimal(18,2) NOT NULL,
    [DocTotal] decimal(18,2) NOT NULL,
    [DocEstado] varchar(20) NOT NULL,
    [DocFechaEmision] datetime NOT NULL,
    [DocFechaVencimiento] date NULL,
    [DocUsuarioAlta] int NOT NULL,
    [DocObservaciones] nvarchar(500) NULL,
    [CicIdCiclo] int NULL,
    [CfeEstado] varchar(50) NULL,
    [CfeNumeroOficial] varchar(100) NULL,
    [CfeCAE] varchar(255) NULL,
    [CfeUrlImpresion] nvarchar(MAX) NULL,
    [DocImpuestos] decimal(18,2) NULL,
    [AsiIdAsiento] int NULL,
    [TcaIdTransaccion] int NULL,
    [DocPagado] bit NOT NULL,
    [DocCliNombre] nvarchar(255) NULL,
    [DocCliDocumento] nvarchar(50) NULL,
    [DocCliDireccion] nvarchar(255) NULL,
    [DocCliCiudad] nvarchar(100) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='AjustesDocumento')
CREATE TABLE dbo.[AjustesDocumento] (
    [AjuIdAjuste] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [DocIdDocumento] int NOT NULL,
    [AjuTipo] varchar(15) NOT NULL,
    [AjuConcepto] nvarchar(300) NOT NULL,
    [AjuCategoria] varchar(30) NULL,
    [AjuPorcentaje] decimal(5,2) NULL,
    [AjuBaseCalculo] decimal(18,2) NULL,
    [AjuMontoFijo] decimal(18,2) NULL,
    [AjuImporte] decimal(18,4) NOT NULL,
    [AjuRequirioPwd] bit NOT NULL,
    [AjuUsuarioAutoriza] int NULL,
    [AjuFecha] datetime NOT NULL,
    [AjuObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ColaEstadosCuenta')
CREATE TABLE dbo.[ColaEstadosCuenta] (
    [ColIdCola] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CliIdCliente] int NOT NULL,
    [CueIdCuenta] int NOT NULL,
    [CicIdCiclo] int NULL,
    [ColContenidoJSON] nvarchar(MAX) NOT NULL,
    [ColAsunto] nvarchar(300) NOT NULL,
    [ColEmailDestino] nvarchar(300) NOT NULL,
    [ColFechaDesde] date NOT NULL,
    [ColFechaHasta] date NOT NULL,
    [ColEstado] varchar(20) NOT NULL,
    [ColUsuarioRevision] int NULL,
    [ColFechaRevision] datetime NULL,
    [ColNotaRevision] nvarchar(500) NULL,
    [ColFechaEnvio] datetime NULL,
    [ColUsuarioEnvio] int NULL,
    [ColErrorEnvio] nvarchar(500) NULL,
    [ColFechaGeneracion] datetime NOT NULL,
    [ColTipoDisparo] varchar(20) NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='CiclosCredito')
CREATE TABLE dbo.[CiclosCredito] (
    [CicIdCiclo] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CueIdCuenta] int NOT NULL,
    [CliIdCliente] int NOT NULL,
    [CicFechaInicio] date NOT NULL,
    [CicFechaCierre] datetime NULL,
    [CicDiasAprobados] int NOT NULL,
    [CicTotalOrdenes] decimal(18,4) NULL,
    [CicTotalPagos] decimal(18,4) NULL,
    [CicSaldoFacturar] decimal(18,4) NULL,
    [CicEstado] varchar(20) NOT NULL,
    [CicNumeroFactura] varchar(100) NULL,
    [CicFechaFactura] datetime NULL,
    [CicFechaCobro] datetime NULL,
    [CicUsuarioApertura] int NOT NULL,
    [CicUsuarioCierre] int NULL,
    [CicObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='PlanesMetros')
CREATE TABLE dbo.[PlanesMetros] (
    [PlaIdPlan] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CliIdCliente] int NOT NULL,
    [CueIdCuenta] int NOT NULL,
    [ProIdProducto] int NOT NULL,
    [PlaDescripcion] nvarchar(200) NULL,
    [PlaCantidadTotal] decimal(18,4) NOT NULL,
    [PlaCantidadUsada] decimal(18,4) NOT NULL,
    [PlaPrecioUnitario] decimal(18,2) NULL,
    [MonIdMoneda] int NULL,
    [PlaFechaInicio] date NOT NULL,
    [PlaFechaVencimiento] date NULL,
    [PlaActivo] bit NOT NULL,
    [PlaObservaciones] nvarchar(500) NULL,
    [PlaFechaAlta] datetime NOT NULL,
    [PlaUsuarioAlta] int NULL
);
GO



IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Config_CFE')
CREATE TABLE dbo.[Config_CFE] (
    [CfeCfgId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CfeCfgClave] varchar(50) NOT NULL,
    [CfeCfgValor] varchar(500) NULL,
    [CfeCfgDescripcion] varchar(200) NULL,
    [CfeCfgActivo] bit NOT NULL DEFAULT(1)
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='PlanesMetrosArticulosPermitidos')
CREATE TABLE dbo.[PlanesMetrosArticulosPermitidos] (
    [PlaIdPlan] int NOT NULL,
    [ProIdProducto] int NOT NULL,
    PRIMARY KEY ([PlaIdPlan], [ProIdProducto])
);
GO
