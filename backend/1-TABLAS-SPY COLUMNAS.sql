USE [SecureAppDB];
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


-- ============================================================================
-- 2. ALTERACIÓN DE COLUMNAS (TABLAS EXISTENTES)
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='CliIdCliente') ALTER TABLE dbo.[Ordenes] ADD [CliIdCliente] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='ProdIdProducto') ALTER TABLE dbo.[Ordenes] ADD [ProdIdProducto] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='ProIdProducto') ALTER TABLE dbo.[Ordenes] ADD [ProIdProducto] int NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='Moneda') ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [Moneda] varchar(10) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='PerfilAplicado') ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [PerfilAplicado] nvarchar(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='PricingTrace') ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [PricingTrace] nvarchar(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='DatoTecnico') ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [DatoTecnico] decimal(18,2) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='MonedaOriginal') ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [MonedaOriginal] varchar(10) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='PrecioUnitarioOriginal') ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [PrecioUnitarioOriginal] decimal(18,2) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='SubtotalOriginal') ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [SubtotalOriginal] decimal(18,2) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='ProIdProducto') ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [ProIdProducto] int NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspeciales' AND COLUMN_NAME='CliIdCliente') ALTER TABLE dbo.[PreciosEspeciales] ADD [CliIdCliente] int NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Pedido') ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Pedido] nvarchar(50) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Cliente') ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Cliente] nvarchar(50) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Trabajo') ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Trabajo] nvarchar(255) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Urgencia') ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Urgencia] nvarchar(10) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Producto') ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Producto] nvarchar(50) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Cantidad') ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Cantidad] nvarchar(50) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Importe') ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Importe] nvarchar(50) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_String') ALTER TABLE dbo.[PedidosCobranza] ADD [QR_String] nvarchar(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='DetalleCostos') ALTER TABLE dbo.[PedidosCobranza] ADD [DetalleCostos] nvarchar(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='PerfilesPrecio') ALTER TABLE dbo.[PedidosCobranza] ADD [PerfilesPrecio] nvarchar(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='MontoContabilizado') ALTER TABLE dbo.[PedidosCobranza] ADD [MontoContabilizado] decimal(18,2) NULL DEFAULT (0);
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='MetrosContabilizados') ALTER TABLE dbo.[PedidosCobranza] ADD [MetrosContabilizados] decimal(18,2) NULL DEFAULT (0);

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspecialesItems' AND COLUMN_NAME='MonIdMoneda') ALTER TABLE dbo.[PreciosEspecialesItems] ADD [MonIdMoneda] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspecialesItems' AND COLUMN_NAME='ProIdProducto') ALTER TABLE dbo.[PreciosEspecialesItems] ADD [ProIdProducto] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspecialesItems' AND COLUMN_NAME='CliIdCliente') ALTER TABLE dbo.[PreciosEspecialesItems] ADD [CliIdCliente] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspecialesItems' AND COLUMN_NAME='CodGrupo') ALTER TABLE dbo.[PreciosEspecialesItems] ADD [CodGrupo] varchar(100) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosBase' AND COLUMN_NAME='MonIdMoneda') ALTER TABLE dbo.[PreciosBase] ADD [MonIdMoneda] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosBase' AND COLUMN_NAME='ProIdProducto') ALTER TABLE dbo.[PreciosBase] ADD [ProIdProducto] int NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosListaPublica' AND COLUMN_NAME='FiltroLanding') ALTER TABLE dbo.[PreciosListaPublica] ADD [FiltroLanding] nvarchar(500) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PerfilesPrecios' AND COLUMN_NAME='Categoria') ALTER TABLE dbo.[PerfilesPrecios] ADD [Categoria] varchar(255) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PerfilesItems' AND COLUMN_NAME='MonIdMoneda') ALTER TABLE dbo.[PerfilesItems] ADD [MonIdMoneda] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PerfilesItems' AND COLUMN_NAME='ProIdProducto') ALTER TABLE dbo.[PerfilesItems] ADD [ProIdProducto] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PerfilesItems' AND COLUMN_NAME='CodGrupo') ALTER TABLE dbo.[PerfilesItems] ADD [CodGrupo] varchar(100) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='MetodosPagos' AND COLUMN_NAME='MPaAfectaCaja') ALTER TABLE dbo.[MetodosPagos] ADD [MPaAfectaCaja] bit NOT NULL DEFAULT (1);
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='MetodosPagos' AND COLUMN_NAME='MPaTipo') ALTER TABLE dbo.[MetodosPagos] ADD [MPaTipo] varchar(20) NOT NULL DEFAULT ('ENTRADA');
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='MetodosPagos' AND COLUMN_NAME='MPaActivo') ALTER TABLE dbo.[MetodosPagos] ADD [MPaActivo] bit NOT NULL DEFAULT (1);

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigMapeoERP' AND COLUMN_NAME='Tipo') ALTER TABLE dbo.[ConfigMapeoERP] ADD [Tipo] varchar(20) NULL DEFAULT ('GRUPO');

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Articulos' AND COLUMN_NAME='UniIdUnidad') ALTER TABLE dbo.[Articulos] ADD [UniIdUnidad] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Articulos' AND COLUMN_NAME='borrar') ALTER TABLE dbo.[Articulos] ADD [borrar] int NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagTcaIdTransaccion') ALTER TABLE dbo.[Pagos] ADD [PagTcaIdTransaccion] int NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagCotizacion') ALTER TABLE dbo.[Pagos] ADD [PagCotizacion] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagMontoConvertido') ALTER TABLE dbo.[Pagos] ADD [PagMontoConvertido] decimal(18,2) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagTipoMovimiento') ALTER TABLE dbo.[Pagos] ADD [PagTipoMovimiento] varchar(20) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagSaldoConsumidoId') ALTER TABLE dbo.[Pagos] ADD [PagSaldoConsumidoId] int NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='OrdenesDeposito' AND COLUMN_NAME='OrdMaterialPlanilla') ALTER TABLE dbo.[OrdenesDeposito] ADD [OrdMaterialPlanilla] nvarchar(255) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='MovimientosCuenta' AND COLUMN_NAME='MovAnulado') 
    ALTER TABLE dbo.[MovimientosCuenta] ADD [MovAnulado] bit NOT NULL DEFAULT 0;
GO

-- ============================================================================
-- 3. PARCHES DE ESTRUCTURA Y MODIFICACIONES ADICIONALES
-- ============================================================================

-- Tabla ConfigEstados
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigEstados' AND COLUMN_NAME='TipoEstado')
    ALTER TABLE dbo.ConfigEstados ALTER COLUMN TipoEstado NVARCHAR(50);
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigEstados' AND COLUMN_NAME='AreaID')
    ALTER TABLE dbo.ConfigEstados ALTER COLUMN AreaID NVARCHAR(255);

-- Restricción por defecto para SesionesTurno.StuFechaApertura si la tabla ya existe
IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints 
    WHERE parent_object_id = OBJECT_ID('SesionesTurno') 
      AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('SesionesTurno'), 'StuFechaApertura', 'ColumnId')
)
BEGIN
    ALTER TABLE [dbo].[SesionesTurno] 
    ADD CONSTRAINT DF_SesionesTurno_FechaApertura 
    DEFAULT (GETDATE()) FOR [StuFechaApertura];
END
GO

-- ============================================================================
-- 4. CREACIÓN Y ACTUALIZACIÓN DE STORED PROCEDURES
-- ============================================================================

IF OBJECT_ID('dbo.[sp_GetDetalleOrdenControl]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetDetalleOrdenControl];
GO
CREATE PROCEDURE [dbo].[sp_GetDetalleOrdenControl] @OrdenID INT AS
BEGIN
    SET NOCOUNT ON;
    SELECT ArchivoID, OrdenID, NombreArchivo, EstadoArchivo AS EstadoControl, Observaciones, CodigoArticulo AS SKU, UsuarioControl, Ancho, Alto, Copias FROM [dbo].[ArchivosOrden] WHERE OrdenID = @OrdenID;
END
GO

IF OBJECT_ID('dbo.[sp_GetProductionBoard]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetProductionBoard];
GO
CREATE PROCEDURE dbo.sp_GetProductionBoard @Area VARCHAR(50) AS
BEGIN
    SET NOCOUNT ON;
    SELECT EquipoID AS id, Nombre AS name, EstadoProceso AS status FROM dbo.ConfigEquipos WHERE AreaID = @Area AND Activo = 1;
    SELECT RolloID AS id, RolloID AS rollCode, Nombre AS name, Estado AS status, MaquinaID AS machineId, ISNULL(MetrosTotales, 0) AS usage, ISNULL(CapacidadMaxima, 0) AS capacity, ColorHex AS color, ISNULL(TotalOrdenes, 0) AS ordersCount FROM dbo.Rollos WHERE AreaID = @Area AND Estado NOT IN ('Cerrado', 'Finalizado');
END;
GO

IF OBJECT_ID('dbo.[sp_GenerarCRUD_Faltantes_ULTRA]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GenerarCRUD_Faltantes_ULTRA];
GO
CREATE PROCEDURE dbo.sp_GenerarCRUD_Faltantes_ULTRA @SchemaName sysname = N'dbo', @Prefix sysname = N'sp' AS
BEGIN
    SET NOCOUNT ON;
    SELECT 'OK' AS Result, 'CRUD ULTRA Generador.' AS Message;
END
GO

IF OBJECT_ID('dbo.[sp_GenerarCRUD_Faltantes_PROFIX]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GenerarCRUD_Faltantes_PROFIX];
GO
CREATE PROCEDURE dbo.sp_GenerarCRUD_Faltantes_PROFIX @SchemaName sysname = N'dbo', @Prefix sysname = N'sp' AS
BEGIN
    SET NOCOUNT ON;
    SELECT 'OK' AS Result, 'CRUD PROFIX Generador.' AS Message;
END;
GO

IF OBJECT_ID('dbo.[sp_CalcularFechaEntrega]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CalcularFechaEntrega];
GO
CREATE PROCEDURE [dbo].[sp_CalcularFechaEntrega] @OrdenID INT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @AreaID VARCHAR(20), @Prioridad VARCHAR(20), @FechaBase DATETIME, @FechaInicioCalculo DATETIME;
    DECLARE @DiasASumar INT = 0, @HorasASumar INT = 0, @HoraCorteStr VARCHAR(50), @HoraCorteInt INT, @FechaCalculada DATETIME, @DiasContados INT = 0;

    SELECT @AreaID = AreaID, @Prioridad = Prioridad, @FechaBase = ISNULL(FechaIngreso, GETDATE()) FROM dbo.Ordenes WHERE OrdenID = @OrdenID;

    SELECT TOP 1 @HoraCorteStr = Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'CORTEURGENTE' AND (AreaID = @AreaID OR AreaID = 'ADMIN') ORDER BY CASE WHEN AreaID = @AreaID THEN 1 ELSE 2 END ASC;

    SET @HoraCorteStr = ISNULL(@HoraCorteStr, '12:00');
    IF CHARINDEX(':', @HoraCorteStr) > 0 SET @HoraCorteInt = CAST(SUBSTRING(@HoraCorteStr, 1, CHARINDEX(':', @HoraCorteStr) - 1) AS INT); ELSE SET @HoraCorteInt = TRY_CAST(@HoraCorteStr AS INT);
    SET @HoraCorteInt = ISNULL(@HoraCorteInt, 12);

    IF DATEPART(HOUR, @FechaBase) >= @HoraCorteInt SET @FechaInicioCalculo = CAST(DATEADD(DAY, 1, @FechaBase) AS DATE); ELSE SET @FechaInicioCalculo = CAST(@FechaBase AS DATE);

    SELECT TOP 1 @DiasASumar = Dias, @HorasASumar = Horas FROM dbo.ConfiguracionTiemposEntrega WHERE AreaID = @AreaID AND Prioridad = @Prioridad;
    IF @@ROWCOUNT = 0 BEGIN IF @Prioridad = 'Urgente' SET @HorasASumar = 24; ELSE SET @DiasASumar = 3; END
    IF @DiasASumar = 0 AND @HorasASumar > 0 SET @DiasASumar = CEILING(@HorasASumar / 24.0);

    SET @FechaCalculada = @FechaInicioCalculo;
    WHILE @DiasContados < @DiasASumar BEGIN
        SET @FechaCalculada = DATEADD(DAY, 1, @FechaCalculada);
        DECLARE @DiaSemana INT = (DATEPART(dw, @FechaCalculada) + @@DATEFIRST - 1) % 7 + 1;
        WHILE @DiaSemana IN (1, 7) OR EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = CAST(@FechaCalculada AS DATE)) BEGIN
             SET @FechaCalculada = DATEADD(DAY, 1, @FechaCalculada);
             SET @DiaSemana = (DATEPART(dw, @FechaCalculada) + @@DATEFIRST - 1) % 7 + 1;
        END
        SET @DiasContados = @DiasContados + 1;
    END

    UPDATE dbo.Ordenes SET FechaEstimadaEntrega = @FechaCalculada WHERE OrdenID = @OrdenID;
    SELECT @FechaCalculada AS NuevaFechaEntrega;
END
GO

IF OBJECT_ID('dbo.[sp_PredecirProximoServicio]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_PredecirProximoServicio];
GO
CREATE PROCEDURE [dbo].[sp_PredecirProximoServicio] @OrdenID INT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NoDocERP VARCHAR(50), @CodigoOrden VARCHAR(100), @SecuenciaActual INT, @TotalPasos INT, @ProximoServicio VARCHAR(100);
    SELECT @NoDocERP = NoDocERP, @CodigoOrden = CodigoOrden FROM dbo.Ordenes WHERE OrdenID = @OrdenID;

    BEGIN TRY
        IF CHARINDEX('(', @CodigoOrden) > 0 AND CHARINDEX(')', @CodigoOrden) > 0 BEGIN
            DECLARE @ParentesisContent VARCHAR(20) = SUBSTRING(@CodigoOrden, CHARINDEX('(', @CodigoOrden) + 1, CHARINDEX(')', @CodigoOrden) - CHARINDEX('(', @CodigoOrden) - 1);
            SET @SecuenciaActual = CAST(LEFT(@ParentesisContent, CHARINDEX('/', @ParentesisContent) - 1) AS INT);
            SET @TotalPasos = CAST(SUBSTRING(@ParentesisContent, CHARINDEX('/', @ParentesisContent) + 1, LEN(@ParentesisContent)) AS INT);
        END
    END TRY
    BEGIN CATCH SET @SecuenciaActual = 1; SET @TotalPasos = 1; END CATCH

    IF @SecuenciaActual < @TotalPasos BEGIN
        DECLARE @SiguienteSecuencia INT = @SecuenciaActual + 1;
        DECLARE @SufijoBuscado VARCHAR(20) = '(' + CAST(@SiguienteSecuencia AS VARCHAR) + '/' + CAST(@TotalPasos AS VARCHAR) + ')';
        SELECT TOP 1 @ProximoServicio = AreaID FROM dbo.Ordenes WHERE NoDocERP = @NoDocERP AND CodigoOrden LIKE '%' + @SufijoBuscado AND OrdenID <> @OrdenID;
    END

    IF @ProximoServicio IS NULL OR @ProximoServicio = '' SET @ProximoServicio = 'DEPOSITO';
    UPDATE dbo.Ordenes SET ProximoServicio = @ProximoServicio WHERE OrdenID = @OrdenID;
    SELECT @ProximoServicio AS Prediccion;
END
GO

IF OBJECT_ID('dbo.[sp_GenerarCRUD_Faltantes_PROFIX2]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GenerarCRUD_Faltantes_PROFIX2];
GO
CREATE PROCEDURE dbo.sp_GenerarCRUD_Faltantes_PROFIX2
    @SchemaName sysname = N'dbo',
    @Prefix     sysname = N'sp'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @HasAuditTable bit = CASE WHEN OBJECT_ID(QUOTENAME(@SchemaName)+'.[Auditoria]', 'U') IS NOT NULL THEN 1 ELSE 0 END;
    DECLARE @HasAuditSP    bit = CASE WHEN OBJECT_ID(QUOTENAME(@SchemaName)+'.[sp_RegistrarAccion]', 'P') IS NOT NULL THEN 1 ELSE 0 END;

    DECLARE @ObjId int, @TableName sysname, @FullTable nvarchar(300), @ProcName nvarchar(300), @Sql nvarchar(max);

    DECLARE tbl CURSOR FAST_FORWARD FOR
        SELECT t.object_id, t.name
        FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = @SchemaName AND t.is_ms_shipped = 0
        ORDER BY t.name;

    OPEN tbl;
    FETCH NEXT FROM tbl INTO @ObjId, @TableName;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @FullTable = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName);

        /* =========================
           PK columns (por object_id)
           ========================= */
        DECLARE @PkCols TABLE (
            Ord int NOT NULL,
            ColName sysname NOT NULL,
            TypeName sysname NOT NULL,
            MaxLen smallint NULL,
            Precision tinyint NULL,
            Scale tinyint NULL,
            IsNullable bit NOT NULL
        );

        INSERT INTO @PkCols (Ord, ColName, TypeName, MaxLen, Precision, Scale, IsNullable)
        SELECT
            ic.key_ordinal,
            c.name,
            ty.name,
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable
        FROM sys.key_constraints kc
        JOIN sys.index_columns ic
            ON ic.object_id = kc.parent_object_id
           AND ic.index_id  = kc.unique_index_id
        JOIN sys.columns c
            ON c.object_id = ic.object_id
           AND c.column_id = ic.column_id
        JOIN sys.types ty
            ON ty.user_type_id = c.user_type_id
        WHERE kc.parent_object_id = @ObjId
          AND kc.[type] = 'PK'
        ORDER BY ic.key_ordinal;

        IF NOT EXISTS (SELECT 1 FROM @PkCols)
        BEGIN
            FETCH NEXT FROM tbl INTO @ObjId, @TableName;
            CONTINUE;
        END

        /* =========================
           All columns
           ========================= */
        DECLARE @Cols TABLE(
            ColId int NOT NULL,
            ColName sysname NOT NULL,
            TypeName sysname NOT NULL,
            MaxLen smallint NULL,
            Precision tinyint NULL,
            Scale tinyint NULL,
            IsNullable bit NOT NULL,
            IsIdentity bit NOT NULL,
            IsComputed bit NOT NULL,
            IsPk bit NOT NULL
        );

        INSERT INTO @Cols
        SELECT
            c.column_id,
            c.name,
            ty.name,
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable,
            c.is_identity,
            c.is_computed,
            CASE WHEN EXISTS (SELECT 1 FROM @PkCols pk WHERE pk.ColName = c.name) THEN 1 ELSE 0 END
        FROM sys.columns c
        JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE c.object_id = @ObjId
        ORDER BY c.column_id;

        /* Soft delete */
        DECLARE @SoftDeleteCol sysname = NULL;
        SELECT TOP 1 @SoftDeleteCol = ColName
        FROM @Cols
        WHERE TypeName='bit' AND ColName IN (N'IsDeleted', N'Eliminado', N'Anulado', N'Deleted', N'Activo')
        ORDER BY CASE ColName
            WHEN N'IsDeleted' THEN 1 WHEN N'Eliminado' THEN 2 WHEN N'Anulado' THEN 3 WHEN N'Deleted' THEN 4 WHEN N'Activo' THEN 5 ELSE 99 END;

        /* =========================
           Helpers builders
           ========================= */
        DECLARE @AuditParamsCreate nvarchar(max) = N'@UserID int = NULL, @IPAddress nvarchar(50) = NULL';
        DECLARE @AuditParamsAppend nvarchar(max) = N', @UserID int = NULL, @IPAddress nvarchar(50) = NULL';

        DECLARE @PkParams nvarchar(max) = N'';
        SELECT @PkParams =
            STUFF((
                SELECT
                    N', @' + p.ColName + N' ' +
                    CASE
                        WHEN p.TypeName IN ('varchar','char','nvarchar','nchar','binary','varbinary') THEN
                            p.TypeName + N'(' +
                            CASE
                                WHEN p.MaxLen = -1 THEN N'max'
                                WHEN p.TypeName IN ('nvarchar','nchar') THEN CAST(p.MaxLen/2 AS nvarchar(10))
                                ELSE CAST(p.MaxLen AS nvarchar(10))
                            END + N')'
                        WHEN p.TypeName IN ('decimal','numeric') THEN
                            p.TypeName + N'(' + CAST(p.Precision AS nvarchar(10)) + N',' + CAST(p.Scale AS nvarchar(10)) + N')'
                        WHEN p.TypeName IN ('datetime2','time','datetimeoffset') THEN
                            p.TypeName + N'(' + CAST(p.Scale AS nvarchar(10)) + N')'
                        ELSE p.TypeName
                    END
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @PkWhere nvarchar(max) = N'';
        SELECT @PkWhere =
            STUFF((
                SELECT N' AND ' + QUOTENAME(p.ColName) + N' = @' + p.ColName
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 5, N'');

        DECLARE @PkOrderBy nvarchar(max) = N'';
        SELECT @PkOrderBy =
            STUFF((
                SELECT N', ' + QUOTENAME(p.ColName) + N' ASC'
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @PkReturnSelect nvarchar(max) = N'';
        SELECT @PkReturnSelect =
            STUFF((
                SELECT N', ' + QUOTENAME(p.ColName) + N' AS ' + QUOTENAME(p.ColName)
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        /* PK detail con CONCAT (robusto) - CORREGIDO: quitada la comilla de escape extra al final de N''; '' */
        DECLARE @PkDetailArgs nvarchar(max) = N'';
        SELECT @PkDetailArgs =
            STUFF((
                SELECT
                    N', N''' + p.ColName + N'='', CONVERT(nvarchar(4000), @' + p.ColName + N'), N''; '
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @PkDetailExpr nvarchar(max) =
            N'CONCAT(N''' + REPLACE(@TableName,'''','''''') + N' PK: '', ' + @PkDetailArgs + N')';

        /* Params de todas las cols */
        DECLARE @AllParams nvarchar(max) = N'';
        SELECT @AllParams =
            STUFF((
                SELECT
                    N', @' + ColName + N' ' +
                    CASE
                        WHEN TypeName IN ('varchar','char','nvarchar','nchar','binary','varbinary') THEN
                            TypeName + N'(' +
                            CASE
                                WHEN MaxLen = -1 THEN N'max'
                                WHEN TypeName IN ('nvarchar','nchar') THEN CAST(MaxLen/2 AS nvarchar(10))
                                ELSE CAST(MaxLen AS nvarchar(10))
                            END + N')'
                        WHEN TypeName IN ('decimal','numeric') THEN
                            TypeName + N'(' + CAST([Precision] AS nvarchar(10)) + N',' + CAST([Scale] AS nvarchar(10)) + N')'
                        WHEN TypeName IN ('datetime2','time','datetimeoffset') THEN
                            TypeName + N'(' + CAST([Scale] AS nvarchar(10)) + N')'
                        ELSE TypeName
                    END +
                    CASE WHEN IsNullable = 1 THEN N' = NULL' ELSE N'' END
                FROM @Cols
                WHERE IsComputed = 0
                ORDER BY ColId
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @InsertCols nvarchar(max) = N'';
        DECLARE @InsertVals nvarchar(max) = N'';
        DECLARE @UpdateSet  nvarchar(max) = N'';
        DECLARE @PatchSet   nvarchar(max) = N'';

        SELECT
            @InsertCols =
                STUFF((
                    SELECT N', ' + QUOTENAME(ColName)
                    FROM @Cols
                    WHERE IsComputed=0 AND IsIdentity=0
                    ORDER BY ColId
                    FOR XML PATH(''), TYPE
                ).value('.', 'nvarchar(max)'), 1, 2, N''),
            @InsertVals =
                STUFF((
                    SELECT N', @' + ColName
                    FROM @Cols
                    WHERE IsComputed=0 AND IsIdentity=0
                    ORDER BY ColId
                    FOR XML PATH(''), TYPE
                ).value('.', 'nvarchar(max)'), 1, 2, N'');

        SELECT @UpdateSet =
            STUFF((
                SELECT N', ' + QUOTENAME(ColName) + N' = @' + ColName
                FROM @Cols
                WHERE IsComputed=0 AND IsIdentity=0 AND IsPk=0
                ORDER BY ColId
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        SELECT @PatchSet =
            STUFF((
                SELECT N', ' + QUOTENAME(ColName) + N' = COALESCE(@' + ColName + N', ' + QUOTENAME(ColName) + N')'
                FROM @Cols
                WHERE IsComputed=0 AND IsIdentity=0 AND IsPk=0
                ORDER BY ColId
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @HasIdentity bit = CASE WHEN EXISTS (SELECT 1 FROM @Cols WHERE IsIdentity=1) THEN 1 ELSE 0 END;
        DECLARE @IdentityCol sysname = (SELECT TOP 1 ColName FROM @Cols WHERE IsIdentity=1 ORDER BY ColId);

        DECLARE @ListWhere nvarchar(max) = N'';
        IF @SoftDeleteCol IS NOT NULL
        BEGIN
            IF @SoftDeleteCol = N'Activo' SET @ListWhere = N'WHERE [Activo] = 1';
            ELSE SET @ListWhere = N'WHERE ' + QUOTENAME(@SoftDeleteCol) + N' = 0';
        END

        /* Audit snippets */
        DECLARE @AuditCreate nvarchar(max) = N'';
        DECLARE @AuditUpdate nvarchar(max) = N'';
        DECLARE @AuditDelete nvarchar(max) = N'';

        IF @HasAuditSP = 1
        BEGIN
            SET @AuditCreate = N'
        EXEC ' + QUOTENAME(@SchemaName) + N'.[sp_RegistrarAccion]
            @UserID=@UserID,
            @Action=N''CREATE_' + @TableName + N''',
            @Details=' + @PkDetailExpr + N',
            @IPAddress=@IPAddress;';
            SET @AuditUpdate = N'
        EXEC ' + QUOTENAME(@SchemaName) + N'.[sp_RegistrarAccion]
            @UserID=@UserID,
            @Action=N''UPDATE_' + @TableName + N''',
            @Details=' + @PkDetailExpr + N',
            @IPAddress=@IPAddress;';
            SET @AuditDelete = N'
        EXEC ' + QUOTENAME(@SchemaName) + N'.[sp_RegistrarAccion]
            @UserID=@UserID,
            @Action=N''DELETE_' + @TableName + N''',
            @Details=' + @PkDetailExpr + N',
            @IPAddress=@IPAddress;';
        END
        ELSE IF @HasAuditTable = 1
        BEGIN
            SET @AuditCreate = N'
        INSERT INTO ' + QUOTENAME(@SchemaName) + N'.[Auditoria](IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
        VALUES (@UserID, N''CREATE_' + @TableName + N''', ' + @PkDetailExpr + N', @IPAddress, GETDATE());';
            SET @AuditUpdate = N'
        INSERT INTO ' + QUOTENAME(@SchemaName) + N'.[Auditoria](IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
        VALUES (@UserID, N''UPDATE_' + @TableName + N''', ' + @PkDetailExpr + N', @IPAddress, GETDATE());';
            SET @AuditDelete = N'
        INSERT INTO ' + QUOTENAME(@SchemaName) + N'.[Auditoria](IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
        VALUES (@UserID, N''DELETE_' + @TableName + N''', ' + @PkDetailExpr + N', @IPAddress, GETDATE());';
        END

        /* Error pattern seguro */
        DECLARE @CatchBlock nvarchar(max) = N'
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @Err nvarchar(4000) = ERROR_MESSAGE();
        RAISERROR(@Err, 16, 1);
        RETURN;
    END CATCH';

        /* =========================
           CREAR
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Crear');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO ' + @FullTable + N' (' + @InsertCols + N')
        VALUES (' + @InsertVals + N');

        DECLARE @NewIdentity bigint = NULL;
        ' + CASE WHEN @HasIdentity=1 THEN N'SET @NewIdentity = CAST(SCOPE_IDENTITY() AS bigint);' ELSE N'' END + N'

        IF @NewIdentity IS NOT NULL
        BEGIN
            SELECT ' + @PkReturnSelect + N'
            FROM ' + @FullTable + N'
            WHERE ' + QUOTENAME(@IdentityCol) + N' = @NewIdentity;
        END
        ELSE
        BEGIN
            SELECT ' + @PkReturnSelect + N';
        END
' + @AuditCreate + N'
        COMMIT TRAN;
    END TRY' + @CatchBlock + N'
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* OBTENER */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Obtener');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @PkParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM ' + @FullTable + N' WHERE ' + @PkWhere + N';
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* LISTAR */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Listar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
    @Page int = 1,
    @PageSize int = 50
,   @UserID int = NULL,
    @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @Page < 1 SET @Page = 1;
    IF @PageSize < 1 SET @PageSize = 50;

    DECLARE @Offset int = (@Page - 1) * @PageSize;

    SELECT *
    FROM ' + @FullTable + N'
    ' + @ListWhere + N'
    ORDER BY ' + @PkOrderBy + N'
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT COUNT(1) AS TotalRows
    FROM ' + @FullTable + N'
    ' + @ListWhere + N';
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* ACTUALIZAR */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Actualizar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        UPDATE ' + @FullTable + N'
        SET ' + @UpdateSet + N'
        WHERE ' + @PkWhere + N';

        DECLARE @Rows int = @@ROWCOUNT;
        IF @Rows > 0 BEGIN ' + @AuditUpdate + N' END

        COMMIT TRAN;
        SELECT @Rows AS RowsAffected;
    END TRY' + @CatchBlock + N'
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* PATCH */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Patch');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        UPDATE ' + @FullTable + N'
        SET ' + @PatchSet + N'
        WHERE ' + @PkWhere + N';

        DECLARE @Rows int = @@ROWCOUNT;
        IF @Rows > 0 BEGIN ' + @AuditUpdate + N' END

        COMMIT TRAN;
        SELECT @Rows AS RowsAffected;
    END TRY' + @CatchBlock + N'
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* ELIMINAR */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Eliminar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            DECLARE @DeleteBody nvarchar(max);
            IF @SoftDeleteCol IS NOT NULL
            BEGIN
                IF @SoftDeleteCol = N'Activo'
                    SET @DeleteBody = N'UPDATE ' + @FullTable + N' SET [Activo] = 0 WHERE ' + @PkWhere + N';';
                ELSE
                    SET @DeleteBody = N'UPDATE ' + @FullTable + N' SET ' + QUOTENAME(@SoftDeleteCol) + N' = 1 WHERE ' + @PkWhere + N';';
            END
            ELSE
                SET @DeleteBody = N'DELETE FROM ' + @FullTable + N' WHERE ' + @PkWhere + N';';

            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @PkParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        ' + @DeleteBody + N'

        DECLARE @Rows int = @@ROWCOUNT;
        IF @Rows > 0 BEGIN ' + @AuditDelete + N' END

        COMMIT TRAN;
        SELECT @Rows AS RowsAffected;
    END TRY' + @CatchBlock + N'
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* CONTAR (sin coma inicial) */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Contar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AuditParamsCreate + N'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM ' + @FullTable + N'
    ' + @ListWhere + N';
END
';
            EXEC sys.sp_executesql @Sql;
        END

        FETCH NEXT FROM tbl INTO @ObjId, @TableName;
    END

    CLOSE tbl;
    DEALLOCATE tbl;

    SELECT 'OK' AS Result, 'CRUD PROFIX2 generado sin errores.' AS Message;
END;
GO

IF OBJECT_ID('dbo.[sp_ArchivosOrden_Obtener]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ArchivosOrden_Obtener];
GO
CREATE PROCEDURE [dbo].[sp_ArchivosOrden_Obtener] @ArchivoID int, @UserID int = NULL, @IPAddress nvarchar(50) = NULL AS
BEGIN
    SET NOCOUNT ON; SELECT * FROM [dbo].[ArchivosOrden] WHERE [ArchivoID] = @ArchivoID;
END
GO

IF OBJECT_ID('dbo.[sp_ArchivosOrden_Listar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ArchivosOrden_Listar];
GO
CREATE PROCEDURE [dbo].[sp_ArchivosOrden_Listar] @Page int = 1, @PageSize int = 50, @UserID int = NULL, @IPAddress nvarchar(50) = NULL AS
BEGIN
    SET NOCOUNT ON; IF @Page < 1 SET @Page = 1; IF @PageSize < 1 SET @PageSize = 50;
    DECLARE @Offset int = (@Page - 1) * @PageSize;
    SELECT * FROM [dbo].[ArchivosOrden] ORDER BY [ArchivoID] ASC OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
    SELECT COUNT(1) AS TotalRows FROM [dbo].[ArchivosOrden];
END
GO

IF OBJECT_ID('dbo.SP_AbrirSesionCaja', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_AbrirSesionCaja;
GO
CREATE PROCEDURE dbo.SP_AbrirSesionCaja @UsuarioId INT, @MontoInicial DECIMAL(18,2) = 0 AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.SesionesTurno WITH(NOLOCK) WHERE StuEstado = 'ABIERTA' AND CAST(StuFechaApertura AS DATE) = CAST(GETDATE() AS DATE)) BEGIN
        RAISERROR('Ya existe una sesion de caja ABIERTA hoy. Cierrela antes de abrir una nueva.', 16, 1); RETURN;
    END
    INSERT INTO dbo.SesionesTurno (StuUsuarioAbre, StuMontoInicial, StuEstado) VALUES (@UsuarioId, @MontoInicial, 'ABIERTA');
    SELECT SCOPE_IDENTITY() AS StuIdSesion, GETDATE() AS FechaApertura;
END
GO

IF OBJECT_ID('dbo.SP_CerrarSesionCaja', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_CerrarSesionCaja;
GO
CREATE PROCEDURE dbo.SP_CerrarSesionCaja @StuIdSesion INT, @UsuarioId INT, @MontoFinal DECIMAL(18,2), @Observaciones NVARCHAR(500) = NULL AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalCobros DECIMAL(18,2), @TotalEgresos DECIMAL(18,2), @MontoSistema DECIMAL(18,2), @Diferencia DECIMAL(18,2);
    SELECT @TotalCobros = ISNULL(SUM(TcaTotalNeto), 0) FROM dbo.TransaccionesCaja WHERE StuIdSesion = @StuIdSesion AND TcaEstado = 'COMPLETADO';
    SELECT @TotalEgresos = ISNULL(SUM(EgrMonto), 0) FROM dbo.EgresosCaja WHERE StuIdSesion = @StuIdSesion AND EgrEstado = 'REGISTRADO';

    SET @MontoSistema = (SELECT ISNULL(StuMontoInicial,0) FROM dbo.SesionesTurno WHERE StuIdSesion = @StuIdSesion) + @TotalCobros - @TotalEgresos;
    SET @Diferencia   = @MontoFinal - @MontoSistema;

    DECLARE @NuevoEstado VARCHAR(30) = CASE WHEN ABS(@Diferencia) < 1 THEN 'CERRADA' ELSE 'CERRADA_CON_DIFERENCIA' END;
    UPDATE dbo.SesionesTurno SET StuFechaCierre = GETDATE(), StuUsuarioCierra = @UsuarioId, StuMontoFinal = @MontoFinal, StuMontoSistema = @MontoSistema, StuDiferencia = @Diferencia, StuEstado = @NuevoEstado, StuObservaciones = @Observaciones WHERE StuIdSesion = @StuIdSesion AND StuEstado = 'ABIERTA';

    IF @@ROWCOUNT = 0 BEGIN RAISERROR('No se encontro sesion ABIERTA con ID %d.', 16, 1, @StuIdSesion); RETURN; END
    SELECT @StuIdSesion AS StuIdSesion, @TotalCobros AS TotalCobros, @TotalEgresos AS TotalEgresos, @MontoSistema AS MontoSistema, @MontoFinal AS MontoFinal, @Diferencia AS Diferencia, @NuevoEstado AS EstadoFinal;
END
GO

IF OBJECT_ID('dbo.SP_ImputarPagoPEPS', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_ImputarPagoPEPS;
GO
CREATE PROCEDURE dbo.SP_ImputarPagoPEPS @PagIdPago INT, @MontoDisponible DECIMAL(18,4), @CueIdCuenta INT, @UsuarioAlta INT, @MontoExcedente DECIMAL(18,4) = NULL OUTPUT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @DDeIdDocumento INT, @DDeImportePendiente DECIMAL(18,4), @Aplicar DECIMAL(18,4), @Restante DECIMAL(18,4) = @MontoDisponible;

    BEGIN TRY
        BEGIN TRANSACTION;
            DECLARE cur_deudas CURSOR FOR SELECT DDeIdDocumento, DDeImportePendiente FROM dbo.DeudaDocumento WHERE CueIdCuenta = @CueIdCuenta AND DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL') ORDER BY DDeFechaVencimiento ASC, DDeIdDocumento ASC;
            OPEN cur_deudas; FETCH NEXT FROM cur_deudas INTO @DDeIdDocumento, @DDeImportePendiente;
            WHILE @@FETCH_STATUS = 0 AND @Restante > 0 BEGIN
                SET @Aplicar = CASE WHEN @Restante >= @DDeImportePendiente THEN @DDeImportePendiente ELSE @Restante END;
                INSERT INTO dbo.ImputacionPago (PagIdPago, DDeIdDocumento, CueIdCuenta, ImpImporte, ImpFecha, ImpUsuarioAlta) VALUES (@PagIdPago, @DDeIdDocumento, @CueIdCuenta, @Aplicar, GETDATE(), @UsuarioAlta);
                UPDATE dbo.DeudaDocumento SET DDeImportePendiente = DDeImportePendiente - @Aplicar, DDeEstado = CASE WHEN DDeImportePendiente - @Aplicar = 0 THEN 'COBRADO' ELSE 'PARCIAL' END, DDeFechaCobro = CASE WHEN DDeImportePendiente - @Aplicar = 0 THEN GETDATE() ELSE NULL END WHERE DDeIdDocumento = @DDeIdDocumento;
                SET @Restante = @Restante - @Aplicar;
                FETCH NEXT FROM cur_deudas INTO @DDeIdDocumento, @DDeImportePendiente;
            END;
            CLOSE cur_deudas; DEALLOCATE cur_deudas;
            SET @MontoExcedente = @Restante;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        IF CURSOR_STATUS('global','cur_deudas') >= -1 OR CURSOR_STATUS('local','cur_deudas') >= -1 BEGIN CLOSE cur_deudas; DEALLOCATE cur_deudas; END;
        THROW;
    END CATCH;
END;
GO

IF OBJECT_ID('dbo.SP_RegistrarMovimiento', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_RegistrarMovimiento;
GO
CREATE PROCEDURE [dbo].[SP_RegistrarMovimiento]
    @CueIdCuenta        INT,
    @MovTipo            VARCHAR(30),
    @MovConcepto        NVARCHAR(500),
    @MovImporte         DECIMAL(18,4),
    @MovUsuarioAlta     INT,
    @OrdIdOrden         INT          = NULL,
    @OReIdOrdenRetiro   INT          = NULL,
    @PagIdPago          INT          = NULL,
    @DocIdDocumento     INT          = NULL,
    @MovRefExterna      VARCHAR(100) = NULL,
    @MovObservaciones   NVARCHAR(500)= NULL,
    @CicIdCiclo         INT          = NULL,
    @MovIdGenerado      INT          = NULL OUTPUT,
    @SaldoResultante    DECIMAL(18,4)= NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NuevoSaldo DECIMAL(18,4);
    BEGIN TRY
        BEGIN TRANSACTION;
            UPDATE [dbo].[CuentasCliente] WITH (UPDLOCK)
            SET    CueSaldoActual = CueSaldoActual + @MovImporte
            WHERE  CueIdCuenta = @CueIdCuenta;

            SELECT @NuevoSaldo = CueSaldoActual
            FROM   [dbo].[CuentasCliente]
            WHERE  CueIdCuenta = @CueIdCuenta;

            -- CORREGIDO: Se especifica explícitamente la columna MovAnulado con valor 0
            INSERT INTO [dbo].[MovimientosCuenta] (
                CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
                OrdIdOrden, OReIdOrdenRetiro, PagIdPago, DocIdDocumento,
                MovRefExterna, MovFecha, MovUsuarioAlta, MovObservaciones, CicIdCiclo, MovAnulado
            )
            VALUES (
                @CueIdCuenta, @MovTipo, @MovConcepto, @MovImporte, @NuevoSaldo,
                @OrdIdOrden, @OReIdOrdenRetiro, @PagIdPago, @DocIdDocumento,
                @MovRefExterna, GETDATE(), @MovUsuarioAlta, @MovObservaciones, @CicIdCiclo, 0
            );

            SET @MovIdGenerado   = SCOPE_IDENTITY();
            SET @SaldoResultante = @NuevoSaldo;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

IF OBJECT_ID('dbo.SP_SiguienteNumeroDoc', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_SiguienteNumeroDoc;
GO
CREATE PROCEDURE dbo.SP_SiguienteNumeroDoc @TipoDoc VARCHAR(20), @Serie VARCHAR(5) = 'A' AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @SecIdSecuencia INT, @SecDigitos INT, @SecPrefijo VARCHAR(10), @SecActivo BIT, @NuevoNumero INT, @NumFormato VARCHAR(30);

    SELECT @SecIdSecuencia = SecIdSecuencia, @SecDigitos = SecDigitos, @SecPrefijo = SecPrefijo, @SecActivo = SecActivo FROM dbo.SecuenciaDocumentos WITH(NOLOCK) WHERE SecTipoDoc = @TipoDoc AND SecSerie = @Serie;
    IF @SecIdSecuencia IS NULL BEGIN RAISERROR('No existe secuencia para TipoDoc="%s" Serie="%s".', 16, 1, @TipoDoc, @Serie); RETURN; END
    IF @SecActivo = 0 BEGIN RAISERROR('La secuencia TipoDoc="%s" Serie="%s" esta inactiva.', 16, 1, @TipoDoc, @Serie); RETURN; END

    UPDATE dbo.SecuenciaDocumentos WITH(UPDLOCK, ROWLOCK) SET SecUltimoNumero = SecUltimoNumero + 1 WHERE SecIdSecuencia  = @SecIdSecuencia;
    SELECT @NuevoNumero = SecUltimoNumero FROM dbo.SecuenciaDocumentos WITH(NOLOCK) WHERE SecIdSecuencia = @SecIdSecuencia;
    SET @NumFormato = ISNULL(@SecPrefijo, '') + RIGHT(REPLICATE('0', @SecDigitos) + CAST(@NuevoNumero AS VARCHAR(10)), @SecDigitos);
    SELECT @NuevoNumero AS NumeroEntero, @NumFormato AS NumeroFormato, @TipoDoc AS TipoDoc, @Serie AS Serie, ISNULL(@SecPrefijo, '') AS Prefijo;
END
GO

PRINT '=========================================================';
PRINT '== MIGRACION ESTRUCTURAL Y SPs COMPLETADA CON EXITO    ==';
PRINT '=========================================================';
GO