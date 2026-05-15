USE [BACKUP];
GO

-- ===========================
-- TABLAS FALTANTES
-- ===========================
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='EgresosCaja')
CREATE TABLE dbo.[EgresosCaja] (
    [EgrIdEgreso] int IDENTITY(1,1) NOT NULL,
    [StuIdSesion] int NULL,
    [EgrFecha] datetime NOT NULL,
    [EgrUsuarioId] int NOT NULL,
    [EgrConcepto] nvarchar(200) NOT NULL,
    [EgrProveedor] nvarchar(150) NULL,
    [EgrMonto] decimal NOT NULL,
    [EgrMoneda] varchar(10) NOT NULL,
    [EgrCotizacion] decimal NULL,
    [EgrMontoConvertido] decimal NOT NULL,
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
    [SecIdSecuencia] int IDENTITY(1,1) NOT NULL,
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
    [StuIdSesion] int IDENTITY(1,1) NOT NULL,
    [StuFechaApertura] datetime NOT NULL,
    [StuFechaCierre] datetime NULL,
    [StuUsuarioAbre] int NOT NULL,
    [StuUsuarioCierra] int NULL,
    [StuMontoInicial] decimal NOT NULL,
    [StuMontoFinal] decimal NULL,
    [StuMontoSistema] decimal NULL,
    [StuDiferencia] decimal NULL,
    [StuEstado] varchar(30) NOT NULL,
    [StuObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TransaccionesCaja')
CREATE TABLE dbo.[TransaccionesCaja] (
    [TcaIdTransaccion] int IDENTITY(1,1) NOT NULL,
    [TcaFecha] datetime NOT NULL,
    [TcaUsuarioId] int NOT NULL,
    [TcaClienteId] int NOT NULL,
    [TcaTipoDocumento] varchar(20) NOT NULL,
    [TcaSerieDoc] varchar(5) NULL,
    [TcaNumeroDoc] varchar(20) NULL,
    [TcaTotalBruto] decimal NOT NULL,
    [TcaTotalAjuste] decimal NOT NULL,
    [TcaTotalNeto] decimal NOT NULL,
    [TcaTotalCobrado] decimal NOT NULL,
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
    [Clave] varchar(100) NOT NULL,
    [Valor] varchar(255) NOT NULL,
    [AreaID] varchar(20) NULL,
    [Descripcion] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TesoreriaBancos')
CREATE TABLE dbo.[TesoreriaBancos] (
    [IdBanco] int IDENTITY(1,1) NOT NULL,
    [NombreBanco] varchar(100) NOT NULL,
    [Activo] bit NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TesoreriaCheques')
CREATE TABLE dbo.[TesoreriaCheques] (
    [IdCheque] int IDENTITY(1,1) NOT NULL,
    [Tipo] varchar(20) NOT NULL,
    [NumeroCheque] varchar(50) NOT NULL,
    [IdBanco] int NOT NULL,
    [Monto] decimal NOT NULL,
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
    [CodDocumento] varchar(10) NOT NULL,
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
    [DcdIdDetalle] int IDENTITY(1,1) NOT NULL,
    [DocIdDocumento] int NOT NULL,
    [OrdCodigoOrden] varchar(50) NULL,
    [DcdNomItem] varchar(80) NOT NULL,
    [DcdDscItem] varchar(1000) NULL,
    [DcdCantidad] decimal NOT NULL,
    [DcdPrecioUnitario] decimal NOT NULL,
    [DcdSubtotal] decimal NOT NULL,
    [DcdImpuestos] decimal NOT NULL,
    [DcdTotal] decimal NOT NULL,
    [DcdTotalDescuentos] decimal NULL,
    [DcdDescuentoStr] varchar(100) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Config_CuentasEgreso')
CREATE TABLE dbo.[Config_CuentasEgreso] (
    [CegId] int IDENTITY(1,1) NOT NULL,
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
    [AuzIdAutorizacion] int IDENTITY(1,1) NOT NULL,
    [OReIdOrdenRetiro] int NOT NULL,
    [AuzFecha] datetime NOT NULL,
    [AuzUsuarioId] int NOT NULL,
    [AuzMotivo] nvarchar(300) NOT NULL,
    [AuzMontoDeuda] decimal NOT NULL,
    [AuzFechaVencimiento] date NULL,
    [AuzEstado] varchar(20) NOT NULL,
    [AuzFechaCobro] datetime NULL,
    [TcaIdTransaccion] int NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='CondicionesPago')
CREATE TABLE dbo.[CondicionesPago] (
    [CPaIdCondicion] int IDENTITY(1,1) NOT NULL,
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
    [ImpIdImputacion] int IDENTITY(1,1) NOT NULL,
    [PagIdPago] int NOT NULL,
    [DDeIdDocumento] int NOT NULL,
    [CueIdCuenta] int NOT NULL,
    [ImpImporte] decimal NOT NULL,
    [ImpFecha] datetime NOT NULL,
    [ImpUsuarioAlta] int NOT NULL,
    [ImpObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TiposMovimiento')
CREATE TABLE dbo.[TiposMovimiento] (
    [TmoId] varchar(30) NOT NULL,
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
    [TdeIdDetalle] int IDENTITY(1,1) NOT NULL,
    [TcaIdTransaccion] int NOT NULL,
    [TdeTipoReferencia] varchar(20) NOT NULL,
    [TdeReferenciaId] int NULL,
    [TdeCodigoReferencia] varchar(30) NULL,
    [TdeDescripcion] nvarchar(200) NULL,
    [TdeImporteOriginal] decimal NOT NULL,
    [TdeAjuste] decimal NOT NULL,
    [TdeImporteFinal] decimal NOT NULL,
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
    [CueId] int IDENTITY(1,1) NOT NULL,
    [CueCodigo] varchar(20) NOT NULL,
    [CueNombre] nvarchar(100) NOT NULL,
    [CueNivel] int NOT NULL,
    [CueTipoBase] varchar(20) NOT NULL,
    [CueMoneda] varchar(5) NOT NULL,
    [CueImputable] bit NOT NULL,
    [CueActiva] bit NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_TiposTransaccion')
CREATE TABLE dbo.[Cont_TiposTransaccion] (
    [TrtCodigo] varchar(30) NOT NULL,
    [TrtNombre] nvarchar(100) NOT NULL,
    [TrtDescripcion] nvarchar(500) NULL,
    [TrtUsaEntidad] bit NOT NULL,
    [TrtEstado] bit NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_EventosContables')
CREATE TABLE dbo.[Cont_EventosContables] (
    [EvtCodigo] varchar(30) NOT NULL,
    [EvtNombre] nvarchar(100) NOT NULL,
    [EvtDescripcion] nvarchar(500) NULL,
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
    [RegId] int IDENTITY(1,1) NOT NULL,
    [RegCodigo] varchar(50) NOT NULL,
    [RegNombre] nvarchar(100) NOT NULL,
    [RegCuentaDebe] int NULL,
    [RegCuentaHaber] int NULL,
    [RegObservacion] nvarchar(200) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_ReglasContables')
CREATE TABLE dbo.[Cont_ReglasContables] (
    [RgcId] int IDENTITY(1,1) NOT NULL,
    [TrtCodigo] varchar(30) NOT NULL,
    [CueCodigo] varchar(20) NOT NULL,
    [RgcNaturaleza] varchar(10) NOT NULL,
    [RgcFilaFormula] varchar(50) NOT NULL,
    [RgcOrden] int NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_ReglasAsiento')
CREATE TABLE dbo.[Cont_ReglasAsiento] (
    [RasId] int IDENTITY(1,1) NOT NULL,
    [EvtCodigo] varchar(30) NOT NULL,
    [CueCodigo] varchar(30) NOT NULL,
    [RasNaturaleza] varchar(10) NOT NULL,
    [RasFormula] varchar(50) NOT NULL,
    [RasOrden] int NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Cont_AsientosCabecera')
CREATE TABLE dbo.[Cont_AsientosCabecera] (
    [AsiId] int IDENTITY(1,1) NOT NULL,
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
    [DetId] int IDENTITY(1,1) NOT NULL,
    [AsiId] int NOT NULL,
    [CueId] int NOT NULL,
    [DetDebeUYU] decimal NOT NULL,
    [DetHaberUYU] decimal NOT NULL,
    [DetImporteOriginal] decimal NOT NULL,
    [DetCotizacion] decimal NOT NULL,
    [DetMonedaId] int NOT NULL,
    [DetEntidadId] int NULL,
    [DetEntidadTipo] varchar(20) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='CuentasCliente')
CREATE TABLE dbo.[CuentasCliente] (
    [CueIdCuenta] int IDENTITY(1,1) NOT NULL,
    [CliIdCliente] int NOT NULL,
    [CPaIdCondicion] int NOT NULL,
    [CueTipo] varchar(20) NOT NULL,
    [ProIdProducto] int NULL,
    [MonIdMoneda] int NULL,
    [CueSaldoActual] decimal NOT NULL,
    [CueLimiteCredito] decimal NOT NULL,
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
    [MovIdMovimiento] int IDENTITY(1,1) NOT NULL,
    [CueIdCuenta] int NOT NULL,
    [MovTipo] varchar(30) NOT NULL,
    [MovConcepto] nvarchar(500) NOT NULL,
    [MovImporte] decimal NOT NULL,
    [MovSaldoPosterior] decimal NOT NULL,
    [OrdIdOrden] int NULL,
    [OReIdOrdenRetiro] int NULL,
    [PagIdPago] int NULL,
    [DocIdDocumento] int NULL,
    [MovRefExterna] varchar(100) NULL,
    [MovFecha] datetime NOT NULL,
    [MovUsuarioAlta] int NOT NULL,
    [MovAnulado] bit NOT NULL,
    [MovIdAnula] int NULL,
    [MovObservaciones] nvarchar(500) NULL,
    [CicIdCiclo] int NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='DeudaDocumento')
CREATE TABLE dbo.[DeudaDocumento] (
    [DDeIdDocumento] int IDENTITY(1,1) NOT NULL,
    [CueIdCuenta] int NOT NULL,
    [OrdIdOrden] int NULL,
    [OReIdOrdenRetiro] int NULL,
    [DocIdDocumento] int NULL,
    [DDeImporteOriginal] decimal NOT NULL,
    [DDeImportePendiente] decimal NOT NULL,
    [DDeFechaEmision] date NOT NULL,
    [DDeFechaVencimiento] date NOT NULL,
    [DDeCuotaNumero] int NOT NULL,
    [DDeCuotaTotal] int NOT NULL,
    [DDeEstado] varchar(20) NOT NULL,
    [DDeFechaCobro] datetime NULL,
    [DDeObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='DocumentosContables')
CREATE TABLE dbo.[DocumentosContables] (
    [DocIdDocumento] int IDENTITY(1,1) NOT NULL,
    [CueIdCuenta] int NOT NULL,
    [CliIdCliente] int NOT NULL,
    [DocTipo] varchar(20) NOT NULL,
    [DocNumero] varchar(50) NOT NULL,
    [DocSerie] varchar(10) NOT NULL,
    [DocIdDocumentoRef] int NULL,
    [DocMotivoRef] nvarchar(300) NULL,
    [DocFechaDesde] date NULL,
    [DocFechaHasta] date NULL,
    [DocSubtotal] decimal NOT NULL,
    [MonIdMoneda] int NOT NULL,
    [DocTotalDescuentos] decimal NOT NULL,
    [DocTotalRecargos] decimal NOT NULL,
    [DocTotal] decimal NOT NULL,
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
    [DocImpuestos] decimal NULL,
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
    [AjuIdAjuste] int IDENTITY(1,1) NOT NULL,
    [DocIdDocumento] int NOT NULL,
    [AjuTipo] varchar(15) NOT NULL,
    [AjuConcepto] nvarchar(300) NOT NULL,
    [AjuCategoria] varchar(30) NULL,
    [AjuPorcentaje] decimal NULL,
    [AjuBaseCalculo] decimal NULL,
    [AjuMontoFijo] decimal NULL,
    [AjuImporte] decimal NOT NULL,
    [AjuRequirioPwd] bit NOT NULL,
    [AjuUsuarioAutoriza] int NULL,
    [AjuFecha] datetime NOT NULL,
    [AjuObservaciones] nvarchar(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ColaEstadosCuenta')
CREATE TABLE dbo.[ColaEstadosCuenta] (
    [ColIdCola] int IDENTITY(1,1) NOT NULL,
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
    [CicIdCiclo] int IDENTITY(1,1) NOT NULL,
    [CueIdCuenta] int NOT NULL,
    [CliIdCliente] int NOT NULL,
    [CicFechaInicio] date NOT NULL,
    [CicFechaCierre] datetime NULL,
    [CicDiasAprobados] int NOT NULL,
    [CicTotalOrdenes] decimal NULL,
    [CicTotalPagos] decimal NULL,
    [CicSaldoFacturar] decimal NULL,
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
    [PlaIdPlan] int IDENTITY(1,1) NOT NULL,
    [CliIdCliente] int NOT NULL,
    [CueIdCuenta] int NOT NULL,
    [ProIdProducto] int NOT NULL,
    [PlaDescripcion] nvarchar(200) NULL,
    [PlaCantidadTotal] decimal NOT NULL,
    [PlaCantidadUsada] decimal NOT NULL,
    [PlaPrecioUnitario] decimal NULL,
    [MonIdMoneda] int NULL,
    [PlaFechaInicio] date NOT NULL,
    [PlaFechaVencimiento] date NULL,
    [PlaActivo] bit NOT NULL,
    [PlaObservaciones] nvarchar(500) NULL,
    [PlaFechaAlta] datetime NOT NULL,
    [PlaUsuarioAlta] int NULL
);
GO

-- ===========================
-- COLUMNAS FALTANTES
-- ===========================
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='CliIdCliente')
ALTER TABLE dbo.[Ordenes] ADD [CliIdCliente] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='ProdIdProducto')
ALTER TABLE dbo.[Ordenes] ADD [ProdIdProducto] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='ProIdProducto')
ALTER TABLE dbo.[Ordenes] ADD [ProIdProducto] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='Moneda')
ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [Moneda] varchar(10) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='PerfilAplicado')
ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [PerfilAplicado] nvarchar(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='PricingTrace')
ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [PricingTrace] nvarchar(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='DatoTecnico')
ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [DatoTecnico] decimal NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='MonedaOriginal')
ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [MonedaOriginal] varchar(10) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='PrecioUnitarioOriginal')
ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [PrecioUnitarioOriginal] decimal NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='SubtotalOriginal')
ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [SubtotalOriginal] decimal NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='ProIdProducto')
ALTER TABLE dbo.[PedidosCobranzaDetalle] ADD [ProIdProducto] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspeciales' AND COLUMN_NAME='CliIdCliente')
ALTER TABLE dbo.[PreciosEspeciales] ADD [CliIdCliente] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Pedido')
ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Pedido] nvarchar(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Cliente')
ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Cliente] nvarchar(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Trabajo')
ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Trabajo] nvarchar(255) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Urgencia')
ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Urgencia] nvarchar(10) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Producto')
ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Producto] nvarchar(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Cantidad')
ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Cantidad] nvarchar(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_Importe')
ALTER TABLE dbo.[PedidosCobranza] ADD [QR_Importe] nvarchar(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='QR_String')
ALTER TABLE dbo.[PedidosCobranza] ADD [QR_String] nvarchar(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='DetalleCostos')
ALTER TABLE dbo.[PedidosCobranza] ADD [DetalleCostos] nvarchar(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='PerfilesPrecio')
ALTER TABLE dbo.[PedidosCobranza] ADD [PerfilesPrecio] nvarchar(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='MontoContabilizado')
ALTER TABLE dbo.[PedidosCobranza] ADD [MontoContabilizado] decimal NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranza' AND COLUMN_NAME='MetrosContabilizados')
ALTER TABLE dbo.[PedidosCobranza] ADD [MetrosContabilizados] decimal NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspecialesItems' AND COLUMN_NAME='MonIdMoneda')
ALTER TABLE dbo.[PreciosEspecialesItems] ADD [MonIdMoneda] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspecialesItems' AND COLUMN_NAME='ProIdProducto')
ALTER TABLE dbo.[PreciosEspecialesItems] ADD [ProIdProducto] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspecialesItems' AND COLUMN_NAME='CliIdCliente')
ALTER TABLE dbo.[PreciosEspecialesItems] ADD [CliIdCliente] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosEspecialesItems' AND COLUMN_NAME='CodGrupo')
ALTER TABLE dbo.[PreciosEspecialesItems] ADD [CodGrupo] varchar(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosBase' AND COLUMN_NAME='MonIdMoneda')
ALTER TABLE dbo.[PreciosBase] ADD [MonIdMoneda] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosBase' AND COLUMN_NAME='ProIdProducto')
ALTER TABLE dbo.[PreciosBase] ADD [ProIdProducto] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PreciosListaPublica' AND COLUMN_NAME='FiltroLanding')
ALTER TABLE dbo.[PreciosListaPublica] ADD [FiltroLanding] nvarchar(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PerfilesPrecios' AND COLUMN_NAME='Categoria')
ALTER TABLE dbo.[PerfilesPrecios] ADD [Categoria] varchar(255) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PerfilesItems' AND COLUMN_NAME='MonIdMoneda')
ALTER TABLE dbo.[PerfilesItems] ADD [MonIdMoneda] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PerfilesItems' AND COLUMN_NAME='ProIdProducto')
ALTER TABLE dbo.[PerfilesItems] ADD [ProIdProducto] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PerfilesItems' AND COLUMN_NAME='CodGrupo')
ALTER TABLE dbo.[PerfilesItems] ADD [CodGrupo] varchar(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='MetodosPagos' AND COLUMN_NAME='MPaAfectaCaja')
ALTER TABLE dbo.[MetodosPagos] ADD [MPaAfectaCaja] bit NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='MetodosPagos' AND COLUMN_NAME='MPaTipo')
ALTER TABLE dbo.[MetodosPagos] ADD [MPaTipo] varchar(20) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='MetodosPagos' AND COLUMN_NAME='MPaActivo')
ALTER TABLE dbo.[MetodosPagos] ADD [MPaActivo] bit NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigMapeoERP' AND COLUMN_NAME='Tipo')
ALTER TABLE dbo.[ConfigMapeoERP] ADD [Tipo] varchar(20) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Articulos' AND COLUMN_NAME='UniIdUnidad')
ALTER TABLE dbo.[Articulos] ADD [UniIdUnidad] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Articulos' AND COLUMN_NAME='borrar')
ALTER TABLE dbo.[Articulos] ADD [borrar] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagTcaIdTransaccion')
ALTER TABLE dbo.[Pagos] ADD [PagTcaIdTransaccion] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagCotizacion')
ALTER TABLE dbo.[Pagos] ADD [PagCotizacion] decimal NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagMontoConvertido')
ALTER TABLE dbo.[Pagos] ADD [PagMontoConvertido] decimal NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagTipoMovimiento')
ALTER TABLE dbo.[Pagos] ADD [PagTipoMovimiento] varchar(20) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagSaldoConsumidoId')
ALTER TABLE dbo.[Pagos] ADD [PagSaldoConsumidoId] int NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='OrdenesDeposito' AND COLUMN_NAME='OrdMaterialPlanilla')
ALTER TABLE dbo.[OrdenesDeposito] ADD [OrdMaterialPlanilla] nvarchar(255) NULL;
GO
-- ===========================
-- STORED PROCEDURES
-- ===========================
IF OBJECT_ID('dbo.[sp_GetDetalleOrdenControl]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetDetalleOrdenControl];
GO
CREATE   PROCEDURE [dbo].[sp_GetDetalleOrdenControl]
    @OrdenID INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 
        ArchivoID,
        OrdenID,
        NombreArchivo,
        EstadoArchivo AS EstadoControl, -- Mapeamos tu columna al nombre que espera el Frontend
        Observaciones,
        CodigoArticulo AS SKU, -- Usamos CodigoArticulo como SKU
        UsuarioControl,
        Ancho,
        Alto,
        Copias
    FROM [dbo].[ArchivosOrden]
    WHERE OrdenID = @OrdenID;
END
GO

IF OBJECT_ID('dbo.[sp_GetProductionBoard]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetProductionBoard];
GO
CREATE PROCEDURE dbo.sp_GetProductionBoard
    @Area VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    -- Máquinas
    SELECT
        EquipoID   AS id,
        Nombre     AS name,
        EstadoProceso AS status
    FROM dbo.ConfigEquipos
    WHERE AreaID = @Area AND Activo = 1;

    -- Rollos
    SELECT
        RolloID    AS id,
        RolloID    AS rollCode,
        Nombre     AS name,
        Estado     AS status,
        MaquinaID  AS machineId,
        ISNULL(MetrosTotales, 0)   AS usage,
        ISNULL(CapacidadMaxima, 0) AS capacity,
        ColorHex   AS color,
        ISNULL(TotalOrdenes, 0)    AS ordersCount
    FROM dbo.Rollos
    WHERE AreaID = @Area
      AND Estado NOT IN ('Cerrado', 'Finalizado');
END;

GO

IF OBJECT_ID('dbo.[sp_GenerarCRUD_Faltantes_ULTRA]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GenerarCRUD_Faltantes_ULTRA];
GO

CREATE PROCEDURE dbo.sp_GenerarCRUD_Faltantes_ULTRA
    @SchemaName sysname = N'dbo',
    @Prefix     sysname = N'sp'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE
        @TableName  sysname,
        @FullTable  nvarchar(300),
        @ProcName   nvarchar(300),
        @Sql        nvarchar(max);

    DECLARE @HasAuditTable bit = CASE WHEN OBJECT_ID(QUOTENAME(@SchemaName)+'.[Auditoria]', 'U') IS NOT NULL THEN 1 ELSE 0 END;
    DECLARE @HasAuditSP    bit = CASE WHEN OBJECT_ID(QUOTENAME(@SchemaName)+'.[sp_RegistrarAccion]', 'P') IS NOT NULL THEN 1 ELSE 0 END;

    DECLARE tbl CURSOR FAST_FORWARD FOR
        SELECT t.name
        FROM sys.tables t
        INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = @SchemaName
          AND t.is_ms_shipped = 0
        ORDER BY t.name;

    OPEN tbl;
    FETCH NEXT FROM tbl INTO @TableName;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @FullTable = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName);

        /* =========================
           PK info
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
        INNER JOIN sys.index_columns ic
            ON ic.object_id = kc.parent_object_id
           AND ic.index_id  = kc.unique_index_id
        INNER JOIN sys.columns c
            ON c.object_id = ic.object_id
           AND c.column_id = ic.column_id
        INNER JOIN sys.types ty
            ON ty.user_type_id = c.user_type_id
        WHERE kc.parent_object_id = OBJECT_ID(@FullTable)
          AND kc.[type] = 'PK'
        ORDER BY ic.key_ordinal;

        IF NOT EXISTS (SELECT 1 FROM @PkCols)
        BEGIN
            FETCH NEXT FROM tbl INTO @TableName;
            CONTINUE;
        END

        /* =========================
           Columns info
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
        INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE c.object_id = OBJECT_ID(@FullTable)
        ORDER BY c.column_id;

        /* =========================
           Soft delete detection
           ========================= */
        DECLARE @SoftDeleteCol sysname = NULL;

        ;WITH c AS (
            SELECT ColName, TypeName
            FROM @Cols
        )
        SELECT TOP 1 @SoftDeleteCol = ColName
        FROM c
        WHERE (TypeName='bit' AND ColName IN (N'IsDeleted', N'Eliminado', N'Anulado', N'Deleted', N'Activo'))
           OR (TypeName IN ('varchar','nvarchar') AND ColName IN (N'Estado', N'Status'))
        ORDER BY CASE ColName
            WHEN N'IsDeleted' THEN 1
            WHEN N'Eliminado' THEN 2
            WHEN N'Anulado'   THEN 3
            WHEN N'Deleted'   THEN 4
            WHEN N'Activo'    THEN 5
            WHEN N'Estado'    THEN 6
            WHEN N'Status'    THEN 7
            ELSE 99 END;

        /* =========================
           Builders (tipos, params, where)
           ========================= */
        DECLARE @AuditParams nvarchar(max) = N', @UserID int = NULL, @IPAddress nvarchar(50) = NULL';

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
                        ELSE
                            p.TypeName
                    END
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @PkWhere nvarchar(max) = N'';
        SELECT @PkWhere =
            STUFF((
                SELECT
                    N' AND ' + QUOTENAME(p.ColName) + N' = @' + p.ColName
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 5, N'');

        DECLARE @PkOrderBy nvarchar(max) = N'';
        SELECT @PkOrderBy =
            STUFF((
                SELECT
                    N', ' + QUOTENAME(p.ColName) + N' ASC'
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @PkSelect nvarchar(max) = N'';
        SELECT @PkSelect =
            STUFF((
                SELECT
                    N', ' + QUOTENAME(p.ColName) + N' AS ' + QUOTENAME(p.ColName)
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

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
        DECLARE @UpdateSet nvarchar(max) = N'';

        SELECT
            @InsertCols =
                STUFF((
                    SELECT N', ' + QUOTENAME(ColName)
                    FROM @Cols
                    WHERE IsComputed = 0 AND IsIdentity = 0
                    ORDER BY ColId
                    FOR XML PATH(''), TYPE
                ).value('.', 'nvarchar(max)'), 1, 2, N''),
            @InsertVals =
                STUFF((
                    SELECT N', @' + ColName
                    FROM @Cols
                    WHERE IsComputed = 0 AND IsIdentity = 0
                    ORDER BY ColId
                    FOR XML PATH(''), TYPE
                ).value('.', 'nvarchar(max)'), 1, 2, N'');

        SELECT @UpdateSet =
            STUFF((
                SELECT N', ' + QUOTENAME(ColName) + N' = @' + ColName
                FROM @Cols
                WHERE IsComputed = 0
                  AND IsIdentity = 0
                  AND IsPk = 0
                ORDER BY ColId
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @HasIdentity bit = CASE WHEN EXISTS(SELECT 1 FROM @Cols WHERE IsIdentity=1) THEN 1 ELSE 0 END;
        DECLARE @IdentityCol sysname = (SELECT TOP 1 ColName FROM @Cols WHERE IsIdentity=1 ORDER BY ColId);

        /* =========================
           AUDIT snippets
           ========================= */
        DECLARE @AuditCreate nvarchar(max) = N'';
        DECLARE @AuditUpdate nvarchar(max) = N'';
        DECLARE @AuditDelete nvarchar(max) = N'';

        IF @HasAuditSP = 1
        BEGIN
            SET @AuditCreate = N'
        EXEC ' + QUOTENAME(@SchemaName) + N'.[sp_RegistrarAccion]
            @UserID=@UserID,
            @Action=N''CREATE_' + @TableName + N''',
            @Details=CONCAT(N''PK: '', (SELECT ' + @PkSelect + N' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)),
            @IPAddress=@IPAddress;';
            SET @AuditUpdate = N'
        EXEC ' + QUOTENAME(@SchemaName) + N'.[sp_RegistrarAccion]
            @UserID=@UserID,
            @Action=N''UPDATE_' + @TableName + N''',
            @Details=CONCAT(N''PK: '', (SELECT ' + @PkSelect + N' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)),
            @IPAddress=@IPAddress;';
            SET @AuditDelete = N'
        EXEC ' + QUOTENAME(@SchemaName) + N'.[sp_RegistrarAccion]
            @UserID=@UserID,
            @Action=N''DELETE_' + @TableName + N''',
            @Details=CONCAT(N''PK: '', (SELECT ' + @PkSelect + N' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)),
            @IPAddress=@IPAddress;';
        END
        ELSE IF @HasAuditTable = 1
        BEGIN
            SET @AuditCreate = N'
        INSERT INTO ' + QUOTENAME(@SchemaName) + N'.[Auditoria](IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
        VALUES (@UserID, N''CREATE_' + @TableName + N''', CONCAT(N''PK: '', (SELECT ' + @PkSelect + N' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)), @IPAddress, GETDATE());';
            SET @AuditUpdate = N'
        INSERT INTO ' + QUOTENAME(@SchemaName) + N'.[Auditoria](IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
        VALUES (@UserID, N''UPDATE_' + @TableName + N''', CONCAT(N''PK: '', (SELECT ' + @PkSelect + N' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)), @IPAddress, GETDATE());';
            SET @AuditDelete = N'
        INSERT INTO ' + QUOTENAME(@SchemaName) + N'.[Auditoria](IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
        VALUES (@UserID, N''DELETE_' + @TableName + N''', CONCAT(N''PK: '', (SELECT ' + @PkSelect + N' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)), @IPAddress, GETDATE());';
       END

        /* =========================
           WHERE “activos” en listados
           ========================= */
        DECLARE @ListWhere nvarchar(max) = N'';
        IF @SoftDeleteCol IS NOT NULL
        BEGIN
            IF @SoftDeleteCol = N'Activo'
                SET @ListWhere = N'WHERE [Activo] = 1';
            ELSE IF @SoftDeleteCol IN (N'IsDeleted', N'Eliminado', N'Anulado', N'Deleted')
                SET @ListWhere = N'WHERE ' + QUOTENAME(@SoftDeleteCol) + N' = 0';
            ELSE
                SET @ListWhere = N''; -- Estado/Status no se fuerza, solo se filtra en Buscar si lo pasan
        END

        /* =========================
           1) CREAR
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Crear');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParams + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO ' + @FullTable + N' (' + @InsertCols + N')
        VALUES (' + @InsertVals + N');

        DECLARE @NewIdentity bigint = NULL;
        ' + CASE WHEN @HasIdentity = 1 THEN N'SET @NewIdentity = CAST(SCOPE_IDENTITY() AS bigint);' ELSE N'' END + N'

        IF @NewIdentity IS NOT NULL
        BEGIN
            SELECT ' + @PkSelect + N'
            FROM ' + @FullTable + N'
            WHERE ' + QUOTENAME(@IdentityCol) + N' = @NewIdentity;
        END
        ELSE
        BEGIN
            SELECT ' + @PkSelect + N';
        END

' + @AuditCreate + N'

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @Err nvarchar(4000) = ERROR_MESSAGE();
        RAISERROR(@Err, 16, 1);
        RETURN;
    END CATCH
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* =========================
           2) OBTENER
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Obtener');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @PkParams + @AuditParams + N'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT *
    FROM ' + @FullTable + N'
    WHERE ' + @PkWhere + N';
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* =========================
           3) LISTAR (paginado + total)
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Listar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
    @Page int = 1,
    @PageSize int = 50
' + @AuditParams + N'
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

        /* =========================
           4) BUSCAR (search genérico)
           - busca en columnas string si @Search viene
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Buscar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            DECLARE @SearchPredicate nvarchar(max) = N'';
            SELECT @SearchPredicate =
                STUFF((
                    SELECT
                        N' OR ' + QUOTENAME(ColName) + N' LIKE ''%'' + @Search + ''%'''
                  FROM @Cols
                    WHERE TypeName IN ('varchar','nvarchar','char','nchar','text','ntext')
                      AND IsComputed = 0
                    ORDER BY ColId
                    FOR XML PATH(''), TYPE
                ).value('.', 'nvarchar(max)'), 1, 4, N'');

            IF NULLIF(@SearchPredicate, N'') IS NULL
                SET @SearchPredicate = N'1=0'; -- no hay columnas string

            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
    @Search nvarchar(200) = NULL,
    @Page int = 1,
    @PageSize int = 50
' + @AuditParams + N'
AS
BEGIN
    SET NOCOUNT ON;
    IF @Page < 1 SET @Page = 1;
    IF @PageSize < 1 SET @PageSize = 50;

    DECLARE @Offset int = (@Page - 1) * @PageSize;

    SELECT *
    FROM ' + @FullTable + N'
    ' + CASE WHEN @ListWhere<>'' THEN @ListWhere + N' AND ' ELSE N'WHERE ' END + N'
    (
        @Search IS NULL OR @Search = '''' OR (' + @SearchPredicate + N')
    )
    ORDER BY ' + @PkOrderBy + N'
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT COUNT(1) AS TotalRows
    FROM ' + @FullTable + N'
    ' + CASE WHEN @ListWhere<>'' THEN @ListWhere + N' AND ' ELSE N'WHERE ' END + N'
    (
        @Search IS NULL OR @Search = '''' OR (' + @SearchPredicate + N')
    );
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* =========================
           5) ACTUALIZAR (full)
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Actualizar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParams + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        UPDATE ' + @FullTable + N'
        SET ' + @UpdateSet + N'
        WHERE ' + @PkWhere + N';

        DECLARE @Rows int = @@ROWCOUNT;

        IF @Rows > 0
        BEGIN
' + @AuditUpdate + N'
        END

        COMMIT TRAN;
        SELECT @Rows AS RowsAffected;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @Err nvarchar(4000) = ERROR_MESSAGE();
        RAISERROR(@Err, 16, 1);
        RETURN;
    END CATCH
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* =========================
           6) PATCH (solo columnas no-null)
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Patch');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            DECLARE @PatchSet nvarchar(max) = N'';
            SELECT @PatchSet =
                STUFF((
                    SELECT
                        N', ' + QUOTENAME(ColName) + N' = COALESCE(@' + ColName + N', ' + QUOTENAME(ColName) + N')'
                    FROM @Cols
                    WHERE IsComputed=0 AND IsIdentity=0 AND IsPk=0
                    ORDER BY ColId
                    FOR XML PATH(''), TYPE
                ).value('.', 'nvarchar(max)'), 1, 2, N'');

            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParams + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        UPDATE ' + @FullTable + N'
        SET ' + @PatchSet + N'
        WHERE ' + @PkWhere + N';

        DECLARE @Rows int = @@ROWCOUNT;

        IF @Rows > 0
        BEGIN
' + @AuditUpdate + N'
        END

        COMMIT TRAN;
        SELECT @Rows AS RowsAffected;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @Err nvarchar(4000) = ERROR_MESSAGE();
        RAISERROR(@Err, 16, 1);
        RETURN;
    END CATCH
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* =========================
           7) ELIMINAR (soft si aplica)
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Eliminar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            DECLARE @DeleteBody nvarchar(max);

            IF @SoftDeleteCol IS NOT NULL AND @SoftDeleteCol IN (N'IsDeleted',N'Eliminado',N'Anulado',N'Deleted',N'Activo')
            BEGIN
                IF @SoftDeleteCol = N'Activo'
                    SET @DeleteBody = N'UPDATE ' + @FullTable + N' SET [Activo] = 0 WHERE ' + @PkWhere + N';';
                ELSE
                    SET @DeleteBody = N'UPDATE ' + @FullTable + N' SET ' + QUOTENAME(@SoftDeleteCol) + N' = 1 WHERE ' + @PkWhere + N';';
            END
            ELSE
            BEGIN
                SET @DeleteBody = N'DELETE FROM ' + @FullTable + N' WHERE ' + @PkWhere + N';';
            END

            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @PkParams + @AuditParams + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        ' + @DeleteBody + N'

        DECLARE @Rows int = @@ROWCOUNT;

        IF @Rows > 0
        BEGIN
' + @AuditDelete + N'
        END

        COMMIT TRAN;
        SELECT @Rows AS RowsAffected;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @Err nvarchar(4000) = ERROR_MESSAGE();
        RAISERROR(@Err, 16, 1);
        RETURN;
    END CATCH
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* =========================
           8) CONTAR
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Contar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AuditParams + N'
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

        /* =========================
           9) EXISTE (por PK)
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Existe');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @PkParams + @AuditParams + N'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM ' + @FullTable + N' WHERE ' + @PkWhere + N'
    ) THEN 1 ELSE 0 END AS ExistsFlag;
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* =========================
           10) UPSERT (solo si PK NO es identity)
           ========================= */
        IF NOT EXISTS (SELECT 1 FROM @Cols WHERE IsPk=1 AND IsIdentity=1)
        BEGIN
            SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Upsert');
            IF OBJECT_ID(@ProcName, 'P') IS NULL
            BEGIN
                SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParams + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        IF EXISTS (SELECT 1 FROM ' + @FullTable + N' WHERE ' + @PkWhere + N')
        BEGIN
            UPDATE ' + @FullTable + N'
            SET ' + @UpdateSet + N'
            WHERE ' + @PkWhere + N';

' + @AuditUpdate + N'
        END
        ELSE
        BEGIN
            INSERT INTO ' + @FullTable + N' (' + @InsertCols + N')
            VALUES (' + @InsertVals + N');

' + @AuditCreate + N'
        END

        COMMIT TRAN;

        SELECT ' + @PkSelect + N';
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @Err nvarchar(4000) = ERROR_MESSAGE();
        RAISERROR(@Err, 16, 1);
        RETURN;
    END CATCH
END
';
                EXEC sys.sp_executesql @Sql;
            END
END

        FETCH NEXT FROM tbl INTO @TableName;
    END

    CLOSE tbl;
    DEALLOCATE tbl;

    SELECT 'OK' AS Result, 'CRUD ULTRA generado (solo faltantes).' AS Message;
END

GO

IF OBJECT_ID('dbo.[sp_GenerarCRUD_Faltantes_PROFIX]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GenerarCRUD_Faltantes_PROFIX];
GO

CREATE PROCEDURE dbo.sp_GenerarCRUD_Faltantes_PROFIX
    @SchemaName sysname = N'dbo',
    @Prefix     sysname = N'sp'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE
        @TableName  sysname,
        @FullTable  nvarchar(300),
        @ProcName   nvarchar(300),
        @Sql        nvarchar(max);

    DECLARE @HasAuditTable bit = CASE WHEN OBJECT_ID(QUOTENAME(@SchemaName)+'.[Auditoria]', 'U') IS NOT NULL THEN 1 ELSE 0 END;
    DECLARE @HasAuditSP    bit = CASE WHEN OBJECT_ID(QUOTENAME(@SchemaName)+'.[sp_RegistrarAccion]', 'P') IS NOT NULL THEN 1 ELSE 0 END;

    DECLARE tbl CURSOR FAST_FORWARD FOR
        SELECT t.name
        FROM sys.tables t
        INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = @SchemaName
          AND t.is_ms_shipped = 0
        ORDER BY t.name;

    OPEN tbl;
    FETCH NEXT FROM tbl INTO @TableName;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @FullTable = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName);

        /* =========================
           PK info (reset por tabla)
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
        INNER JOIN sys.index_columns ic
            ON ic.object_id = kc.parent_object_id
           AND ic.index_id  = kc.unique_index_id
        INNER JOIN sys.columns c
            ON c.object_id = ic.object_id
           AND c.column_id = ic.column_id
        INNER JOIN sys.types ty
            ON ty.user_type_id = c.user_type_id
        WHERE kc.parent_object_id = OBJECT_ID(@FullTable)
          AND kc.[type] = 'PK'
        ORDER BY ic.key_ordinal;

        IF NOT EXISTS (SELECT 1 FROM @PkCols)
        BEGIN
            FETCH NEXT FROM tbl INTO @TableName;
            CONTINUE;
        END

        /* =========================
           Columns info
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
        INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE c.object_id = OBJECT_ID(@FullTable)
        ORDER BY c.column_id;

        /* =========================
           Soft delete detection
           ========================= */
        DECLARE @SoftDeleteCol sysname = NULL;

        SELECT TOP 1 @SoftDeleteCol = ColName
        FROM @Cols
        WHERE TypeName='bit'
          AND ColName IN (N'IsDeleted', N'Eliminado', N'Anulado', N'Deleted', N'Activo')
        ORDER BY CASE ColName
            WHEN N'IsDeleted' THEN 1
            WHEN N'Eliminado' THEN 2
            WHEN N'Anulado'   THEN 3
            WHEN N'Deleted'   THEN 4
            WHEN N'Activo'    THEN 5
            ELSE 99 END;

        /* =========================
           Builders
           ========================= */
        DECLARE @AuditParamsWithComma nvarchar(max) = N', @UserID int = NULL, @IPAddress nvarchar(50) = NULL';
        DECLARE @AuditParamsNoComma   nvarchar(max) = N'@UserID int = NULL, @IPAddress nvarchar(50) = NULL';

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

        /* PK detail string SIN FOR JSON (compatibility-safe) */
        DECLARE @PkDetailExpr nvarchar(max) = N'';
        SELECT @PkDetailExpr =
            STUFF((
                SELECT
                    N' + N''; ' + p.ColName + N'='' + CONVERT(nvarchar(4000), @' + p.ColName + N')'
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 3, N'');

        SET @PkDetailExpr = N'N''' + @TableName + N' PK: '' ' + ISNULL(@PkDetailExpr, N'');

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

        DECLARE @PatchSet nvarchar(max) = N'';
        SELECT @PatchSet =
            STUFF((
                SELECT
                    N', ' + QUOTENAME(ColName) + N' = COALESCE(@' + ColName + N', ' + QUOTENAME(ColName) + N')'
                FROM @Cols
                WHERE IsComputed=0 AND IsIdentity=0 AND IsPk=0
                ORDER BY ColId
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @HasIdentity bit = CASE WHEN EXISTS (SELECT 1 FROM @Cols WHERE IsIdentity=1) THEN 1 ELSE 0 END;
        DECLARE @IdentityCol sysname = (SELECT TOP 1 ColName FROM @Cols WHERE IsIdentity=1 ORDER BY ColId);

        /* WHERE de listados si hay soft delete bit */
        DECLARE @ListWhere nvarchar(max) = N'';
        IF @SoftDeleteCol IS NOT NULL
        BEGIN
            IF @SoftDeleteCol = N'Activo'
                SET @ListWhere = N'WHERE [Activo] = 1';
            ELSE
                SET @ListWhere = N'WHERE ' + QUOTENAME(@SoftDeleteCol) + N' = 0';
        END

        /* Audit snippets (sin FOR JSON) */
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

        /* ============================================================
           CREAR
           ============================================================ */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Crear');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParamsWithComma + N'
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
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        RAISERROR(ERROR_MESSAGE(), 16, 1);
        RETURN;
    END CATCH
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
' + @PkParams + @AuditParamsWithComma + N'
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
' + @AuditParamsWithComma + N'
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
' + @AllParams + @AuditParamsWithComma + N'
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
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        RAISERROR(ERROR_MESSAGE(), 16, 1);
        RETURN;
    END CATCH
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
' + @AllParams + @AuditParamsWithComma + N'
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
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        RAISERROR(ERROR_MESSAGE(), 16, 1);
        RETURN;
    END CATCH
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
' + @PkParams + @AuditParamsWithComma + N'
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
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        RAISERROR(ERROR_MESSAGE(), 16, 1);
        RETURN;
    END CATCH
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* CONTAR (OJO: sin coma inicial) */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Contar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AuditParamsNoComma + N'
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

        FETCH NEXT FROM tbl INTO @TableName;
    END

    CLOSE tbl;
    DEALLOCATE tbl;

    SELECT 'OK' AS Result, 'CRUD PROFIX generado correctamente (sin FOR JSON, sin errores de coma).' AS Message;
END

GO

IF OBJECT_ID('dbo.[sp_CalcularFechaEntrega]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CalcularFechaEntrega];
GO

-- =============================================
-- PROCEDURE: sp_CalcularFechaEntrega
-- Descripción: Calcula fecha entrega usando Lógica de Corte y Días Hábiles
-- =============================================
CREATE   PROCEDURE [dbo].[sp_CalcularFechaEntrega]
    @OrdenID INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @AreaID VARCHAR(20);
    DECLARE @Prioridad VARCHAR(20);
    DECLARE @FechaBase DATETIME; -- Fecha de Ingreso original
    DECLARE @FechaInicioCalculo DATETIME; -- Fecha ajustada por corte
    
    DECLARE @DiasASumar INT = 0;
    DECLARE @HorasASumar INT = 0;
    
    DECLARE @HoraCorteStr VARCHAR(50);
    DECLARE @HoraCorteInt INT;
    
    DECLARE @FechaCalculada DATETIME;
    DECLARE @DiasContados INT = 0;

    -- 1. Obtener Datos Orden
    SELECT 
        @AreaID = AreaID, 
        @Prioridad = Prioridad, 
        @FechaBase = ISNULL(FechaIngreso, GETDATE())
    FROM dbo.Ordenes 
    WHERE OrdenID = @OrdenID;

    -- 2. Obtener Hora de Corte (CORTEURGENTE)
    -- Intenta buscar específico del Area, sino usa ADMIN
    SELECT TOP 1 @HoraCorteStr = Valor
    FROM dbo.ConfiguracionGlobal
    WHERE Clave = 'CORTEURGENTE' 
      AND (AreaID = @AreaID OR AreaID = 'ADMIN') -- Busca Area o Default
    ORDER BY CASE WHEN AreaID = @AreaID THEN 1 ELSE 2 END ASC; -- Prioriza Area

    -- Parsear Hora (Asumiendo formato 'HH:mm' o solo entero 'HH')
    SET @HoraCorteStr = ISNULL(@HoraCorteStr, '12:00');
    IF CHARINDEX(':', @HoraCorteStr) > 0
        SET @HoraCorteInt = CAST(SUBSTRING(@HoraCorteStr, 1, CHARINDEX(':', @HoraCorteStr) - 1) AS INT);
    ELSE
        SET @HoraCorteInt = TRY_CAST(@HoraCorteStr AS INT);

    SET @HoraCorteInt = ISNULL(@HoraCorteInt, 12); -- Default fallback 12

    -- 3. Lógica de Corte: Ajustar Fecha Inicio
    IF DATEPART(HOUR, @FechaBase) >= @HoraCorteInt
    BEGIN
        -- Pasó el corte: El día "0" empieza mañana
        SET @FechaInicioCalculo = DATEADD(DAY, 1, @FechaBase);
        -- Resetear hora a inicio de jornada (opcional, aqui mantenemos la hora original o 00:00?
        -- El user sugiere: SET @FechaInicio = CAST(DATEADD(DAY, 1, @FechaOrden) AS DATE); -> Lo cual resetea la hora a 00:00
        SET @FechaInicioCalculo = CAST(@FechaInicioCalculo AS DATE); 
    END
    ELSE
    BEGIN
        -- Antes del corte: Empieza hoy
        SET @FechaInicioCalculo = CAST(@FechaBase AS DATE);
    END

    -- 4. Obtener Días/Horas a Sumar (SLA)
    SELECT TOP 1 
        @DiasASumar = Dias, 
        @HorasASumar = Horas
    FROM dbo.ConfiguracionTiemposEntrega
    WHERE AreaID = @AreaID AND Prioridad = @Prioridad;

    -- Defaults SLA si no config
    IF @@ROWCOUNT = 0
    BEGIN
        IF @Prioridad = 'Urgente' 
            SET @HorasASumar = 24; 
        ELSE 
            SET @DiasASumar = 3;   
    END
    -- Convertir horas a días (simple) si Dias=0
    IF @DiasASumar = 0 AND @HorasASumar > 0
    BEGIN
        SET @DiasASumar = CEILING(@HorasASumar / 24.0);
    END

    -- 5. Bucle Suma Días Hábiles
    SET @FechaCalculada = @FechaInicioCalculo;
    
    WHILE @DiasContados < @DiasASumar
    BEGIN
        -- Avanzar un día
        SET @FechaCalculada = DATEADD(DAY, 1, @FechaCalculada);

        -- Verificar Habilidad (Lunes-Viernes y No Feriado)
        -- Ajuste: (DATEPART(dw, @Date) + @@DATEFIRST - 1) % 7 + 1 -> 1=DOM, 7=SAB
        DECLARE @DiaSemana INT;
        SET @DiaSemana = (DATEPART(dw, @FechaCalculada) + @@DATEFIRST - 1) % 7 + 1;

        -- Loop interno para saltar dias no habiles hasta encontrar uno habil
        WHILE @DiaSemana IN (1, 7) -- Domingo o Sabado
           OR EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = CAST(@FechaCalculada AS DATE))
        BEGIN
             SET @FechaCalculada = DATEADD(DAY, 1, @FechaCalculada);
             SET @DiaSemana = (DATEPART(dw, @FechaCalculada) + @@DATEFIRST - 1) % 7 + 1;
        END

        SET @DiasContados = @DiasContados + 1;
    END

    -- 6. Actualizar
    UPDATE dbo.Ordenes
    SET FechaEstimadaEntrega = @FechaCalculada
    WHERE OrdenID = @OrdenID;
    
    SELECT @FechaCalculada AS NuevaFechaEntrega;
END

GO

IF OBJECT_ID('dbo.[sp_PredecirProximoServicio]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_PredecirProximoServicio];
GO

            CREATE   PROCEDURE [dbo].[sp_PredecirProximoServicio]
                @OrdenID INT
            AS
            BEGIN
                SET NOCOUNT ON;

                DECLARE @NoDocERP VARCHAR(50);
                DECLARE @CodigoOrden VARCHAR(100);
                DECLARE @SecuenciaActual INT;
                DECLARE @TotalPasos INT;
                DECLARE @ProximoServicio VARCHAR(100);

                -- 1. Obtener datos de la orden actual
                SELECT 
                    @NoDocERP = NoDocERP, 
                    @CodigoOrden = CodigoOrden
                FROM dbo.Ordenes 
                WHERE OrdenID = @OrdenID;

                -- 2. Parsear la secuencia (X/Y) del CodigoOrden
                -- Ejemplo: "48 (1/4)" -> SecuenciaActual=1, TotalPasos=4
                BEGIN TRY
                    IF CHARINDEX('(', @CodigoOrden) > 0 AND CHARINDEX(')', @CodigoOrden) > 0
                    BEGIN
                        DECLARE @ParentesisContent VARCHAR(20);
                        SET @ParentesisContent = SUBSTRING(
                            @CodigoOrden, 
                            CHARINDEX('(', @CodigoOrden) + 1, 
                            CHARINDEX(')', @CodigoOrden) - CHARINDEX('(', @CodigoOrden) - 1
                        );
                        
                        -- @ParentesisContent es "1/4"
                        SET @SecuenciaActual = CAST(LEFT(@ParentesisContent, CHARINDEX('/', @ParentesisContent) - 1) AS INT);
                        SET @TotalPasos = CAST(SUBSTRING(@ParentesisContent, CHARINDEX('/', @ParentesisContent) + 1, LEN(@ParentesisContent)) AS INT);
                    END
                END TRY
                BEGIN CATCH
                    -- Si falla el parseo, asumimos que es paso único
                    SET @SecuenciaActual = 1;
                    SET @TotalPasos = 1;
                END CATCH

                -- 3. Determinar Próximo Servicio
                IF @SecuenciaActual < @TotalPasos
                BEGIN
                    -- Buscar la orden que tenga el paso siguiente (SecuenciaActual + 1)
                    DECLARE @SiguienteSecuencia INT = @SecuenciaActual + 1;
                    DECLARE @SufijoBuscado VARCHAR(20) = '(' + CAST(@SiguienteSecuencia AS VARCHAR) + '/' + CAST(@TotalPasos AS VARCHAR) + ')';
                    
                    SELECT TOP 1 @ProximoServicio = AreaID
                    FROM dbo.Ordenes
                    WHERE NoDocERP = @NoDocERP
                      AND CodigoOrden LIKE '%' + @SufijoBuscado
                      AND OrdenID <> @OrdenID; -- Por seguridad
                END

                -- 4. Si no hay siguiente paso o no se encontró la orden, es DEPOSITO
                IF @ProximoServicio IS NULL OR @ProximoServicio = ''
                BEGIN
                    SET @ProximoServicio = 'DEPOSITO';
                END

                -- 5. Actualizar la orden
                UPDATE dbo.Ordenes 
                SET ProximoServicio = @ProximoServicio 
                WHERE OrdenID = @OrdenID;

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

        /* PK detail con CONCAT (robusto) */
        DECLARE @PkDetailArgs nvarchar(max) = N'';
        SELECT @PkDetailArgs =
            STUFF((
                SELECT
                    N', N''' + p.ColName + N'='', CONVERT(nvarchar(4000), @' + p.ColName + N'), N''; '''
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
END

GO

IF OBJECT_ID('dbo.[sp_ArchivosOrden_Obtener]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ArchivosOrden_Obtener];
GO

CREATE PROCEDURE [dbo].[sp_ArchivosOrden_Obtener]
@ArchivoID int, @UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM [dbo].[ArchivosOrden] WHERE [ArchivoID] = @ArchivoID;
END

GO

IF OBJECT_ID('dbo.[sp_ArchivosOrden_Listar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ArchivosOrden_Listar];
GO

CREATE PROCEDURE [dbo].[sp_ArchivosOrden_Listar]
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
    FROM [dbo].[ArchivosOrden]
    
    ORDER BY [ArchivoID] ASC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[ArchivosOrden]
    ;
END

GO

IF OBJECT_ID('dbo.[sp_ArchivosOrden_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ArchivosOrden_Contar];
GO

CREATE PROCEDURE [dbo].[sp_ArchivosOrden_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[ArchivosOrden]
    ;
END

GO

IF OBJECT_ID('dbo.[sp_Areas_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_Areas_Contar];
GO

CREATE PROCEDURE [dbo].[sp_Areas_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[Areas]
    ;
END

GO

IF OBJECT_ID('dbo.[sp_CrearOrdenCompleta]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CrearOrdenCompleta];
GO
-- 2. PROCEDIMIENTOS ALMACENADOS (Adapter Layer for API)
-- =============================================

-- =============================================
-- LOGIC: CREATE ORDER COMPLETE (SP)
-- =============================================
CREATE   PROCEDURE [dbo].[sp_CrearOrdenCompleta]
    @AreaID varchar(20),
    @Cliente nvarchar(200),
    @Descripcion nvarchar(300),
    @Prioridad varchar(20),
    @Material varchar(255) = NULL,
    @Variante varchar(100) = NULL,
    @Magnitud varchar(50) = NULL,
    @Nota nvarchar(MAX) = NULL,
    @FechaEstimada datetime = NULL,
    @ArchivosJson nvarchar(MAX) = NULL -- JSON Array of files
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        DECLARE @NewOrderID int;
        DECLARE @ArchivosCount int = 0;

        -- Parse and count files if any
        IF @ArchivosJson IS NOT NULL
        BEGIN
            SELECT @ArchivosCount = COUNT(*) 
            FROM OPENJSON(@ArchivosJson) 
            WITH (nombre varchar(200), link varchar(500), tipo varchar(50));
        END

        -- 1. Insert Order
        INSERT INTO dbo.Ordenes (
            AreaID, Cliente, DescripcionTrabajo, Prioridad, Material, Variante, 
            Magnitud, Nota, FechaEstimadaEntrega, ArchivosCount, Estado, FechaIngreso
        ) VALUES (
            @AreaID, @Cliente, @Descripcion, @Prioridad, @Material, @Variante,
            @Magnitud, @Nota, @FechaEstimada, @ArchivosCount, 'Pendiente', GETDATE()
        );

        SET @NewOrderID = SCOPE_IDENTITY();

        -- 2. Insert Files (if any) parsing JSON
        IF @ArchivosJson IS NOT NULL AND @ArchivosCount > 0
        BEGIN
            INSERT INTO dbo.ArchivosOrden (
                OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, FechaSubida
            )
            SELECT 
                @NewOrderID, 
                nombre, 
                link, 
                tipo, 
                ISNULL(copias, 1), 
                ISNULL(metros, 0), 
                GETDATE()
            FROM OPENJSON(@ArchivosJson)
            WITH (
                nombre varchar(200) '$.nombre',
                link varchar(500) '$.link',
                tipo varchar(50) '$.tipo',
                copias int '$.copias',
                metros decimal(10,2) '$.metros'
            );
        END

        -- 3. Log Action (Optional but recommended)
        -- EXEC sp_RegistrarAccion @UserID=NULL, @Action='CREATE_ORDER', @Details=@Descripcion;

        COMMIT TRANSACTION;
        
        -- Return results
        SELECT @NewOrderID as OrdenID, 'Orden creada exitosamente' as Message;

    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        SELECT -1 as OrdenID, ERROR_MESSAGE() as Error;
    END CATCH
END
GO

IF OBJECT_ID('dbo.[sp_Auditoria_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_Auditoria_Contar];
GO

CREATE PROCEDURE [dbo].[sp_Auditoria_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[Auditoria]
    ;
END

GO

IF OBJECT_ID('dbo.[sp_BitacoraProduccion_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_BitacoraProduccion_Contar];
GO

CREATE PROCEDURE [dbo].[sp_BitacoraProduccion_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[BitacoraProduccion]
    ;
END

GO

IF OBJECT_ID('dbo.[sp_Cargos_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_Cargos_Contar];
GO

CREATE PROCEDURE [dbo].[sp_Cargos_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[Cargos]
    ;
END

GO

IF OBJECT_ID('dbo.[sp_Clientes_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_Clientes_Contar];
GO

CREATE PROCEDURE [dbo].[sp_Clientes_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[Clientes]
    ;
END

GO

IF OBJECT_ID('dbo.[sp_ComentariosTicket_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ComentariosTicket_Contar];
GO

CREATE PROCEDURE [dbo].[sp_ComentariosTicket_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[ComentariosTicket]
    ;
END

GO

IF OBJECT_ID('dbo.[sp_ConfigColumnas_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ConfigColumnas_Contar];
GO

CREATE PROCEDURE [dbo].[sp_ConfigColumnas_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[ConfigColumnas]
    ;
END

GO

IF OBJECT_ID('dbo.[sp_ConfigEquipos_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ConfigEquipos_Contar];
GO

CREATE PROCEDURE [dbo].[sp_ConfigEquipos_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[ConfigEquipos]
    WHERE [Activo] = 1;
END

GO

IF OBJECT_ID('dbo.[sp_Usuarios_Contar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_Usuarios_Contar];
GO

CREATE PROCEDURE [dbo].[sp_Usuarios_Contar]
@UserID int = NULL, @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM [dbo].[Usuarios]
    WHERE [Activo] = 1;
END

GO

IF OBJECT_ID('dbo.[sp_MoveOrderBetweenRolls]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_MoveOrderBetweenRolls];
GO
CREATE PROCEDURE sp_MoveOrderBetweenRolls
    @OrdenID INT,
    @OldRollID VARCHAR(20),
    @NewRollID VARCHAR(20),
    @NewIndex INT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        -- 1. Actualizar el rollo de la orden
        UPDATE dbo.Ordenes 
        SET RolloID = @NewRollID 
        WHERE OrdenID = @OrdenID;

        -- 2. Recalcular secuencias del rollo destino (Lógica simplificada)
        -- Aquí podrías insertar una lógica de actualización masiva basada en @NewIndex
        
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

IF OBJECT_ID('dbo.[sp_ReorderRollOrders]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ReorderRollOrders];
GO
CREATE PROCEDURE sp_ReorderRollOrders
    @RolloID VARCHAR(20),
    @OrderData NVARCHAR(MAX) -- Recibiremos un JSON con [{id, secuencia}]
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        -- Actualizar secuencias masivamente desde el JSON
        UPDATE O
        SET O.Secuencia = J.secuencia
        FROM dbo.Ordenes O
        INNER JOIN OPENJSON(@OrderData) 
        WITH (id INT, secuencia INT) J ON O.OrdenID = J.id
        WHERE O.RolloID = @RolloID;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

IF OBJECT_ID('dbo.[sp_Production_ReorderOrders]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_Production_ReorderOrders];
GO
CREATE PROCEDURE sp_Production_ReorderOrders
    @RolloID VARCHAR(20),
    @JSONData NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        -- Desglosamos el JSON y actualizamos la tabla
        UPDATE O
        SET O.Secuencia = J.index_pos
        FROM dbo.Ordenes O
        CROSS APPLY OPENJSON(@JSONData)
        WITH (
            id INT '$.id',
            index_pos INT '$.index'
        ) J
        WHERE O.OrdenID = J.id AND O.RolloID = @RolloID;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

IF OBJECT_ID('dbo.[sp_ObtenerDashboardLogistica]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerDashboardLogistica];
GO

    CREATE   PROCEDURE sp_ObtenerDashboardLogistica
        @AreaUsuario NVARCHAR(50)
    AS
    BEGIN
        SET NOCOUNT ON;

        SELECT 
            O.OrdenID, 
            O.CodigoOrden, 
            O.Cliente, 
            O.Estado, 
            O.FechaIngreso, 
            O.ProximoServicio, 
            O.AreaID,
            (SELECT COUNT(*) FROM Etiquetas E WHERE E.OrdenID = O.OrdenID) as Bultos
        FROM Ordenes O
        WHERE O.Estado IN ('FALLA', 'EN_LOGISTICA', 'PRONTO SECTOR', 'INCOMPLETO', 'EN_TRANSITO', 'EN PROCESO', 'TERMINADO')
        AND (
            @AreaUsuario IN ('ADMIN', 'GERENCIA') 
            OR 
            (@AreaUsuario = 'LOGISTICA' AND (O.AreaID = 'LOGISTICA' OR O.Estado = 'EN_LOGISTICA'))
            OR 
            (O.AreaID = @AreaUsuario)
        )
        ORDER BY O.FechaIngreso DESC;
    END
 
GO

IF OBJECT_ID('dbo.[sp_ObtenerResumenActivas]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerResumenActivas];
GO

    CREATE   PROCEDURE sp_ObtenerResumenActivas
        @Role NVARCHAR(50),
        @AreaKey NVARCHAR(50)
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @IsAdmin BIT = 0;
        IF LOWER(@Role) = 'admin' SET @IsAdmin = 1;

        SELECT
            o.AreaID,
            COUNT(*) AS total
        FROM dbo.Ordenes o
        WHERE o.Estado NOT IN ('Cancelado', 'Finalizado')
        AND (@IsAdmin = 1 OR o.AreaID = @AreaKey)
        GROUP BY o.AreaID;
    END
 
GO

IF OBJECT_ID('dbo.[sp_CrearOrden]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CrearOrden];
GO

    CREATE   PROCEDURE sp_CrearOrden
        @AreaID VARCHAR(20),
        @Cliente NVARCHAR(200),
        @Descripcion NVARCHAR(300),
        @Prioridad VARCHAR(20),
        @Material VARCHAR(255),
        @Variante VARCHAR(100),
        @Magnitud VARCHAR(50),
        @Nota NVARCHAR(MAX),
        @FechaEstimada DATETIME,
        @ArchivosJSON NVARCHAR(MAX)
    AS
    BEGIN
        SET NOCOUNT ON;
        BEGIN TRY
            BEGIN TRANSACTION;
                DECLARE @NewOrdenID INT;

                INSERT INTO dbo.Ordenes (AreaID, Cliente, DescripcionTrabajo, Prioridad, Material, Variante, Magnitud, Nota, FechaEstimadaEntrega, ArchivosCount, Estado, FechaIngreso)
                VALUES (@AreaID, @Cliente, @Descripcion, @Prioridad, @Material, @Variante, @Magnitud, @Nota, @FechaEstimada, 0, 'Pendiente', GETDATE());
                
                SET @NewOrdenID = SCOPE_IDENTITY();

                IF @ArchivosJSON IS NOT NULL
                BEGIN
                    INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, FechaSubida)
                    SELECT 
                        @NewOrdenID, 
                        JSON_VALUE(value, '$.nombre'), 
                        JSON_VALUE(value, '$.link'), 
                        JSON_VALUE(value, '$.tipo'), 
                        ISNULL(JSON_VALUE(value, '$.copias'), 1), 
                        ISNULL(JSON_VALUE(value, '$.metros'), 0), 
                        GETDATE()
                    FROM OPENJSON(@ArchivosJSON);

                    UPDATE dbo.Ordenes SET ArchivosCount = (SELECT COUNT(*) FROM dbo.ArchivosOrden WHERE OrdenID = @NewOrdenID) WHERE OrdenID = @NewOrdenID;
                END

            COMMIT TRANSACTION;
            SELECT @NewOrdenID as OrdenID;
        END TRY
        BEGIN CATCH
            ROLLBACK TRANSACTION;
            THROW;
        END CATCH
    END
 
GO

IF OBJECT_ID('dbo.[sp_CrearDespacho]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CrearDespacho];
GO

    CREATE   PROCEDURE sp_CrearDespacho
        @AreaOrigen VARCHAR(20),
        @AreaDestino VARCHAR(20),
        @UsuarioID INT,
        @Observaciones NVARCHAR(255),
        @OrderIdsJSON NVARCHAR(MAX)
    AS
    BEGIN
        SET NOCOUNT ON;
        BEGIN TRY
            BEGIN TRANSACTION;
                DECLARE @DateStr NVARCHAR(20) = FORMAT(GETDATE(), 'yyMMdd');
                DECLARE @Seq INT = (SELECT COUNT(*) FROM Despachos) + 1;
                DECLARE @DispatchCode NVARCHAR(50) = 'DSP-' + @DateStr + '-' + CAST(@Seq AS NVARCHAR);
                DECLARE @DID INT;

                INSERT INTO Despachos (Codigo, AreaOrigenID, AreaDestinoID, UsuarioEmisorID, Estado, Observaciones)
                VALUES (@DispatchCode, @AreaOrigen, @AreaDestino, @UsuarioID, 'EN_TRANSITO', @Observaciones);
                SET @DID = SCOPE_IDENTITY();

                SELECT value as OrderID INTO #OrdersToProcess FROM OPENJSON(@OrderIdsJSON);
                
                INSERT INTO DespachoItems (DespachoID, OrdenID, EtiquetaID, CodigoBulto, EstadoItem)
                SELECT @DID, O.OrderID, E.EtiquetaID, ISNULL(E.CodigoQR, 'BULTO-' + CAST(E.EtiquetaID AS VARCHAR)), 'EN_TRANSITO'
                FROM #OrdersToProcess O JOIN Etiquetas E ON O.OrderID = E.OrdenID;

                INSERT INTO DespachoItems (DespachoID, OrdenID, EstadoItem, CodigoBulto)
                SELECT @DID, O.OrderID, 'EN_TRANSITO', 'GENERICO'
                FROM #OrdersToProcess O LEFT JOIN Etiquetas E ON O.OrderID = E.OrdenID WHERE E.EtiquetaID IS NULL;

                UPDATE dbo.Ordenes SET Estado = 'EN_TRANSITO' WHERE OrdenID IN (SELECT OrderID FROM #OrdersToProcess);

                DROP TABLE #OrdersToProcess;

            COMMIT TRANSACTION;
            SELECT @DID as DispatchId, @DispatchCode as DispatchCode;
        END TRY
        BEGIN CATCH
            ROLLBACK TRANSACTION;
            THROW;
        END CATCH
    END
 
GO

IF OBJECT_ID('dbo.[sp_AsignarRollo]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_AsignarRollo];
GO

    CREATE   PROCEDURE sp_AsignarRollo
        @IsNew BIT,
        @RollId INT = NULL,
        @RollName NVARCHAR(100) = NULL,
        @AreaCode VARCHAR(20) = NULL,
        @UserId INT,
        @OrderIdsJSON NVARCHAR(MAX)
    AS
    BEGIN
        SET NOCOUNT ON;
        BEGIN TRY
            BEGIN TRANSACTION;
                
                DECLARE @TargetRollID INT = @RollId;

                IF @IsNew = 1
                BEGIN
                    IF @AreaCode IS NULL
                        SELECT TOP 1 @AreaCode = AreaID FROM dbo.Ordenes WHERE OrdenID IN (SELECT value FROM OPENJSON(@OrderIdsJSON));
                    
                    SET @AreaCode = ISNULL(@AreaCode, 'GEN');
                    SET @RollName = ISNULL(@RollName, 'Nuevo Lote');

                    SELECT TOP 1 @TargetRollID = RolloID FROM dbo.Rollos WHERE Nombre = @RollName AND AreaID = @AreaCode AND Estado != 'Cerrado';

                    IF @TargetRollID IS NULL
                    BEGIN
                        INSERT INTO dbo.Rollos (Nombre, AreaID, CapacidadMaxima, Estado, FechaCreacion)
                        VALUES (@RollName, @AreaCode, 100, 'Abierto', GETDATE());
                        SET @TargetRollID = SCOPE_IDENTITY();
                        UPDATE dbo.Rollos SET Nombre = CONCAT(@RollName, ' #', CAST(@TargetRollID AS VARCHAR)) WHERE RolloID = @TargetRollID;
                    END
                END
                ELSE
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM dbo.Rollos WHERE RolloID = @TargetRollID) THROW 50001, 'El rollo especificado no existe.', 1;
                END
                
                DECLARE @MaxSeq INT;
                SELECT @MaxSeq = ISNULL(MAX(Secuencia), 0) FROM dbo.Ordenes WHERE RolloID = @TargetRollID;

                MERGE INTO dbo.Ordenes AS Target
                USING (SELECT value AS OrderID, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) + @MaxSeq AS NewSeq FROM OPENJSON(@OrderIdsJSON)) AS Source
                ON Target.OrdenID = Source.OrderID
                WHEN MATCHED THEN
                    UPDATE SET RolloID = @TargetRollID, Estado = 'En Proceso', EstadoenArea = 'En Rollo', Secuencia = Source.NewSeq;

                INSERT INTO dbo.HistorialOrdenes (OrdenID, Estado, FechaInicio, DuracionMinutos, Detalle)
                SELECT value, 'En Proceso', GETDATE(), 0, CONCAT('Asignado a Rollo ', @TargetRollID) FROM OPENJSON(@OrderIdsJSON);

                INSERT INTO dbo.Auditoria (IdUsuario, Accion, Detalles, FechaHora, DireccionIP)
                VALUES (@UserId, 'ASIGNAR_ROLLO', CONCAT('Asignó rollo ', @TargetRollID, ' a órdenes'), GETDATE(), 'SP_INTERNAL');

            COMMIT TRANSACTION;
            SELECT @TargetRollID as RolloID;
        END TRY
        BEGIN CATCH
            ROLLBACK TRANSACTION;
            THROW;
        END CATCH
    END
 
GO

IF OBJECT_ID('dbo.[sp_ObtenerOrdenesArea]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerOrdenesArea];
GO

            CREATE   PROCEDURE sp_ObtenerOrdenesArea
                @Area VARCHAR(20) = NULL,
                @Mode VARCHAR(20) = 'active', 
                @Q NVARCHAR(100) = NULL
            AS
            BEGIN
                SET NOCOUNT ON;

                -- Normalización de estados "Finales"
                DECLARE @EstadosFinales TABLE (Estado VARCHAR(50));
                INSERT INTO @EstadosFinales VALUES ('Entregado'), ('Finalizado'), ('Cancelado');

                SELECT 
                    o.OrdenID, o.CodigoOrden, o.IdCabezalERP, o.Cliente, o.DescripcionTrabajo,
                    o.AreaID, o.Estado, o.EstadoenArea, o.Prioridad, o.FechaIngreso, o.FechaEstimadaEntrega,
                    o.Magnitud, o.Material, o.Variante, o.RolloID, o.Nota, o.Observaciones,
                    o.meta_data, o.ArchivosCount, o.ProximoServicio, o.Tinta, -- << TINTA AGREGADA
                    m.Nombre as NombreMaquina,
                    r.Nombre as NombreRollo,
                    (
                        SELECT ArchivoID, NombreArchivo as nombre, RutaAlmacenamiento as link,
                               TipoArchivo as tipo, Copias as copias, Metros as metros, DetalleLinea
                        FROM dbo.ArchivosOrden 
                        WHERE OrdenID = o.OrdenID 
                        FOR JSON PATH
                    ) as files_data
                FROM dbo.Ordenes o
                LEFT JOIN dbo.ConfigEquipos m ON o.MaquinaID = m.EquipoID
                LEFT JOIN dbo.Rollos r ON o.RolloID = r.RolloID
                WHERE (@Area IS NULL OR o.AreaID = @Area)
                  AND (
                      (@Mode = 'history' AND o.Estado IN (SELECT Estado FROM @EstadosFinales))
                      OR
                      (@Mode != 'history' AND o.Estado NOT IN (SELECT Estado FROM @EstadosFinales))
                  )
                  AND (
                      @Q IS NULL 
                      OR o.Cliente LIKE '%' + @Q + '%' 
                      OR o.CodigoOrden LIKE '%' + @Q + '%' 
                      OR CAST(o.OrdenID AS VARCHAR) LIKE '%' + @Q + '%'
                  )
                ORDER BY o.Prioridad DESC, o.FechaIngreso ASC;
            END
 
GO

IF OBJECT_ID('dbo.[sp_ObtenerDetalleDespacho]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerDetalleDespacho];
GO

    CREATE   PROCEDURE sp_ObtenerDetalleDespacho
        @Codigo VARCHAR(50)
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @DID INT = (SELECT DespachoID FROM Despachos WHERE Codigo = @Codigo);

        IF @DID IS NULL
        BEGIN
            SELECT NULL as Dispatch;
            RETURN;
        END

        -- Result Set 1: Header
        SELECT * FROM Despachos WHERE DespachoID = @DID;

        -- Result Set 2: Items
        SELECT 
            DI.ID as ItemID, DI.OrdenID, DI.EtiquetaID, DI.CodigoBulto, DI.EstadoItem, DI.FechaEscaneo,
            O.CodigoOrden, O.Cliente, O.Material,
            (SELECT COUNT(*) FROM Etiquetas E WHERE E.OrdenID = O.OrdenID) as Bultos
        FROM DespachoItems DI
        INNER JOIN Ordenes O ON DI.OrdenID = O.OrdenID
        WHERE DI.DespachoID = @DID;
    END
 
GO

IF OBJECT_ID('dbo.[sp_RecepcionarItem]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_RecepcionarItem];
GO

    CREATE   PROCEDURE sp_RecepcionarItem
        @DispatchId INT,
        @OrderId INT = NULL,
        @ItemId INT = NULL
    AS
    BEGIN
        SET NOCOUNT ON;
        
        DECLARE @ActualItemID INT;
        DECLARE @ActualOrderID INT;
        DECLARE @EstadoItem VARCHAR(20);
        DECLARE @AreaDestino VARCHAR(20);

        -- 1. Identificar Item
        IF @ItemId IS NOT NULL
        BEGIN
            SELECT @ActualItemID = ID, @ActualOrderID = OrdenID, @EstadoItem = EstadoItem 
            FROM DespachoItems WHERE ID = @ItemId AND DespachoID = @DispatchId;
        END
        ELSE
        BEGIN
            SELECT TOP 1 @ActualItemID = ID, @ActualOrderID = OrdenID, @EstadoItem = EstadoItem
            FROM DespachoItems WHERE DespachoID = @DispatchId AND OrdenID = @OrderId;
        END

        -- 2. Validaciones
        IF @ActualItemID IS NULL
        BEGIN
            THROW 50002, '❌ ALERTA: Este bulto NO pertenece a este despacho.', 1;
        END

        IF @EstadoItem = 'RECIBIDO'
        BEGIN
            SELECT 0 as Success, '⚠️ Ya fue escaneado anteriormente.' as Message;
            RETURN;
        END

        -- 3. Transacción
        BEGIN TRY
            BEGIN TRANSACTION;
                
                -- Update Item
                UPDATE DespachoItems SET EstadoItem = 'RECIBIDO', FechaEscaneo = GETDATE() WHERE ID = @ActualItemID;

                -- Determine New Status
                SELECT @AreaDestino = AreaDestinoID FROM Despachos WHERE DespachoID = @DispatchId;
                
                DECLARE @NewStatus VARCHAR(20) = 'EN PROCESO';
                IF @AreaDestino IN ('LOGISTICA', 'DESPACHO') SET @NewStatus = 'EN_LOGISTICA';

                -- Update Order
                UPDATE Ordenes SET Estado = @NewStatus WHERE OrdenID = @ActualOrderID;

            COMMIT TRANSACTION;
            SELECT 1 as Success, '✅ Bulto recibido correctamente' as Message;
        END TRY
        BEGIN CATCH
            ROLLBACK TRANSACTION;
            THROW;
        END CATCH
    END
 
GO

IF OBJECT_ID('dbo.[sp_UpdateControlArchivo]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_UpdateControlArchivo];
GO
CREATE   PROCEDURE [dbo].[sp_UpdateControlArchivo]
    @ArchivoID INT,
    @Estado NVARCHAR(50),
    @Usuario NVARCHAR(100),
    @Observaciones NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE [dbo].[ArchivosOrden]
    SET 
        EstadoArchivo = @Estado,
        UsuarioControl = @Usuario,
        Observaciones = @Observaciones,
        FechaControl = GETDATE()
    WHERE ArchivoID = @ArchivoID;
END
GO

IF OBJECT_ID('dbo.[sp_ObtenerHistorialOrden]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerHistorialOrden];
GO

    CREATE   PROCEDURE sp_ObtenerHistorialOrden
        @OrdenID INT
    AS
    BEGIN
        SET NOCOUNT ON;
        SELECT Estado, FechaInicio, FechaFin,
               ISNULL(DuracionMinutos, DATEDIFF(MINUTE, FechaInicio, GETDATE())) as DuracionMinutos, 
               Detalle
        FROM dbo.HistorialOrdenes 
        WHERE OrdenID = @OrdenID 
        ORDER BY FechaInicio DESC;
    END
 
GO

IF OBJECT_ID('dbo.[sp_ActualizarEstadoOrden]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ActualizarEstadoOrden];
GO

    CREATE   PROCEDURE sp_ActualizarEstadoOrden
        @OrdenID INT,
        @NuevoEstado VARCHAR(50),
        @Usuario VARCHAR(100) = 'SISTEMA'
    AS
    BEGIN
        SET NOCOUNT ON;
        DECLARE @ProximoServicio VARCHAR(50);
        DECLARE @EstadoLogistica VARCHAR(100) = NULL;
        DECLARE @EstadoEnArea VARCHAR(50) = NULL;
        DECLARE @PrevEstado VARCHAR(50);

        SELECT @PrevEstado = Estado, @ProximoServicio = ProximoServicio 
        FROM dbo.Ordenes WHERE OrdenID = @OrdenID;

        IF @NuevoEstado = 'EN_LOGISTICA'
        BEGIN
            SET @EstadoLogistica = 'HACIA ' + UPPER(ISNULL(@ProximoServicio, 'LOGÍSTICA'));
            SET @EstadoEnArea = 'Enviado';
        END

        UPDATE dbo.Ordenes 
        SET Estado = @NuevoEstado,
            EstadoLogistica = ISNULL(@EstadoLogistica, EstadoLogistica),
            EstadoenArea = ISNULL(@EstadoEnArea, EstadoenArea)
        WHERE OrdenID = @OrdenID;
    END
 
GO

IF OBJECT_ID('dbo.[sp_GetArchivosPorOrden]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetArchivosPorOrden];
GO

-- 2. Obtener Archivos de una Orden (Detalle)
-- Corregido: Se cambió RollID por RolloID y se eliminó la columna inexistente Material
CREATE PROCEDURE sp_GetArchivosPorOrden
@OrdenID INT
AS
BEGIN
SELECT
a.ArchivoID,
a.NombreArchivo,
-- Nota: Si necesitas el material, podrías hacer un JOIN con Ordenes,
-- pero según tu SELECT de ArchivosOrden, esta columna no existe allí.
a.EstadoArchivo,
-- Corregido de RollID a RolloID según esquema
o.RolloID,
r.Estado AS EstadoRollo,
r.Nombre AS NombreRollo,
a.UbicacionControl -- Aquí mapearemos el "Canasto"
FROM [SecureAppDB].[dbo].[ArchivosOrden] a
INNER JOIN [SecureAppDB].[dbo].[Ordenes] o ON a.OrdenID = o.OrdenID
LEFT JOIN [SecureAppDB].[dbo].[Rollos] r ON o.RolloID = r.RolloID
WHERE a.OrdenID = @OrdenID;
END;

GO

IF OBJECT_ID('dbo.[sp_CancelarOrden]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CancelarOrden];
GO

    CREATE   PROCEDURE sp_CancelarOrden
        @OrdenID INT,
        @Motivo NVARCHAR(MAX),
        @Usuario VARCHAR(100)
    AS
    BEGIN
        SET NOCOUNT ON;
        BEGIN TRY
            BEGIN TRANSACTION;

            -- 1. Actualizar Orden
            UPDATE dbo.Ordenes 
            SET Estado = 'CANCELADO', 
                Nota = ISNULL(Nota, '') + ' [CANCELADO: ' + @Motivo + ']'
            WHERE OrdenID = @OrdenID;

            -- 2. Cancelar Archivos
            UPDATE dbo.ArchivosOrden 
            SET EstadoArchivo = 'CANCELADO',
                UsuarioControl = @Usuario,
                FechaControl = GETDATE()
            WHERE OrdenID = @OrdenID;

            -- 3. Historial
            INSERT INTO dbo.HistorialOrdenes (OrdenID, Estado, FechaInicio, DuracionMinutos, Detalle)
            VALUES (@OrdenID, 'CANCELADO', GETDATE(), 0, 'Orden Cancelada por ' + @Usuario + '. Motivo: ' + @Motivo);

            COMMIT TRANSACTION;
            SELECT 1 as Success;
        END TRY
        BEGIN CATCH
            ROLLBACK TRANSACTION;
            THROW;
        END CATCH
    END
 
GO

IF OBJECT_ID('dbo.[sp_DesasignarOrden]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_DesasignarOrden];
GO

    CREATE   PROCEDURE sp_DesasignarOrden
        @OrdenID INT,
        @UsuarioID INT,
        @UsuarioIP VARCHAR(50)
    AS
    BEGIN
        SET NOCOUNT ON;
        DECLARE @PrevRolloID INT;
        
        BEGIN TRY
            BEGIN TRANSACTION;

            SELECT @PrevRolloID = RolloID FROM dbo.Ordenes WHERE OrdenID = @OrdenID;

            -- Actualizar Orden (Remover campos que no existen si aplican)
            -- Asumimos RolloID, Estado, EstadoenArea, MaquinaID existen.
            -- Si Secuencia no existe, la quitamos.
            UPDATE dbo.Ordenes 
            SET RolloID = NULL, 
                Estado = 'Pendiente', 
                EstadoenArea = NULL, 
                MaquinaID = NULL,
                Secuencia = NULL
            WHERE OrdenID = @OrdenID;

            -- Historial
            DECLARE @Detallle VARCHAR(200) = CASE WHEN @PrevRolloID IS NOT NULL THEN 'Desasignado del Rollo ' + CAST(@PrevRolloID AS VARCHAR) ELSE 'Desasignado de Rollo' END;
            
            INSERT INTO dbo.HistorialOrdenes (OrdenID, Estado, FechaInicio, DuracionMinutos, Detalle)
            VALUES (@OrdenID, 'Pendiente', GETDATE(), 0, @Detallle);

            -- Auditoria (Tabla Auditoria usa IdUsuario, no UsuarioID, y DireccionIP)
            INSERT INTO dbo.Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
            VALUES (@UsuarioID, 'DESASIGNAR_ORDEN', 'Orden ' + CAST(@OrdenID AS VARCHAR) + ' sacada del rollo ' + ISNULL(CAST(@PrevRolloID AS VARCHAR), '?'), @UsuarioIP, GETDATE());

            COMMIT TRANSACTION;
            SELECT 1 as Success;
        END TRY
        BEGIN CATCH
            ROLLBACK TRANSACTION;
            THROW;
        END CATCH
    END
 
GO

IF OBJECT_ID('dbo.[sp_ObtenerMenuUsuario]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerMenuUsuario];
GO

CREATE PROCEDURE [dbo].[sp_ObtenerMenuUsuario]
    @IdUsuario INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 
        M.IdModulo,
        M.Titulo AS Nombre,
        M.Ruta,
        M.Icono,
        M.IdPadre,
        M.IndiceOrden,
        A.ui_config,
        A.RenderKey
    FROM [dbo].[Modulos] M
    LEFT JOIN [dbo].[Areas] A ON 
        (M.Ruta LIKE '/area/%' AND REPLACE(M.Ruta, '/area/', '') = A.AreaID)
    -- Quitamos el WHERE M.Activo = 1 porque la columna no existe
    ORDER BY M.IdPadre ASC, M.IndiceOrden ASC;
END
GO

IF OBJECT_ID('dbo.[sp_GetUserMenu]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetUserMenu];
GO

CREATE PROCEDURE [dbo].[sp_GetUserMenu]
    @UserID int
AS
BEGIN
    SET NOCOUNT ON;

    -- Obtenemos el IdRol del usuario
    DECLARE @RolID int;
    SELECT @RolID = IdRol FROM Usuarios WHERE IdUsuario = @UserID;

    -- Traemos solo los módulos que tienen permiso para ese Rol
    SELECT 
        m.IdModulo, 
        m.Titulo, 
        m.IdPadre, 
        m.Ruta, 
        m.Icono, 
        m.IndiceOrden
    FROM dbo.Modulos m
    INNER JOIN dbo.PermisosRoles pr ON m.IdModulo = pr.IdModulo
    WHERE pr.IdRol = @RolID
    ORDER BY m.IdPadre ASC, m.IndiceOrden ASC;
END

GO

IF OBJECT_ID('dbo.[sp_ActualizarUsuario]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ActualizarUsuario];
GO
-- Update User
CREATE   PROCEDURE [dbo].[sp_ActualizarUsuario]
    @UserID int,
    @Username nvarchar(50),
    @RoleID int,
    @Email nvarchar(100) = NULL,
    @IsActive bit
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM Usuarios WHERE Usuario = @Username AND IdUsuario <> @UserID)
    BEGIN
        SELECT -1 AS Result; RETURN;
    END
    UPDATE Usuarios 
    SET Usuario = @Username, IdRol = @RoleID, Email = @Email, Activo = @IsActive
    WHERE IdUsuario = @UserID;
    SELECT 1 AS Result;
END
GO

IF OBJECT_ID('dbo.[sp_EliminarUsuario]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_EliminarUsuario];
GO
-- Delete User
CREATE   PROCEDURE [dbo].[sp_EliminarUsuario]
    @UserID int
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM Usuarios WHERE IdUsuario = @UserID;
END
GO

IF OBJECT_ID('dbo.[sp_ObtenerRoles]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerRoles];
GO
-- Get Roles
CREATE   PROCEDURE [dbo].[sp_ObtenerRoles]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT IdRol as RoleID, NombreRol as RoleName, Descripcion as Description FROM Roles;
END
GO

IF OBJECT_ID('dbo.[sp_GetOrdenesControl]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetOrdenesControl];
GO
CREATE PROCEDURE sp_GetOrdenesControl
    @AreaID INT = NULL,
    @RolloID INT = NULL
AS
BEGIN
    SELECT 
        O.OrdenID, 
        O.CodigoOrden, 
        O.Cliente, 
        O.RolloID, 
        O.Material,
        O.FechaEstimadaEntrega,
        -- Cálculo de avance en tiempo real
        (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = O.OrdenID) as TotalArchivos,
        (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = O.OrdenID AND Estado = 'OK') as ArchivosOK,
        -- Lógica de "En Tiempo" (Si la entrega es menor a 24hs y falta mucho, marcar retraso)
        CASE 
            WHEN O.FechaEstimadaEntrega < GETDATE() THEN 'RETRASADO'
            ELSE 'EN TIEMPO'
        END as SituacionTiempo
    FROM Ordenes O
    WHERE (@AreaID IS NULL OR O.AreaID = @AreaID)
      AND (@RolloID IS NULL OR O.RolloID = @RolloID)
    ORDER BY O.FechaEstimadaEntrega ASC;
END
GO

IF OBJECT_ID('dbo.[sp_CrearRol]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CrearRol];
GO
-- Create Role
CREATE   PROCEDURE [dbo].[sp_CrearRol]
    @RoleName nvarchar(50),
    @Description nvarchar(200)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO Roles (NombreRol, Descripcion) VALUES (@RoleName, @Description);
    SELECT SCOPE_IDENTITY() AS Result;
END
GO

IF OBJECT_ID('dbo.[sp_ActualizarRol]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ActualizarRol];
GO
-- Update Role
CREATE   PROCEDURE [dbo].[sp_ActualizarRol]
    @RoleID int,
    @RoleName nvarchar(50),
    @Description nvarchar(200)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE Roles SET NombreRol = @RoleName, Descripcion = @Description WHERE IdRol = @RoleID;
END
GO

IF OBJECT_ID('dbo.[sp_EliminarRol]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_EliminarRol];
GO
-- Delete Role
CREATE   PROCEDURE [dbo].[sp_EliminarRol]
    @RoleID int
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM Roles WHERE IdRol = @RoleID;
END
GO

IF OBJECT_ID('dbo.[sp_ObtenerAuditoria]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerAuditoria];
GO
-- Get Logs
CREATE   PROCEDURE [dbo].[sp_ObtenerAuditoria]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT 
        l.IdLog as LogID,
        u.Usuario as Username,
        l.Accion as Action,
        l.Detalles as Details,
        l.DireccionIP as IPAddress,
        l.FechaHora as Timestamp
    FROM Auditoria l
    LEFT JOIN Usuarios u ON l.IdUsuario = u.IdUsuario
    ORDER BY l.FechaHora DESC;
END
GO

IF OBJECT_ID('dbo.[sp_ObtenerTodosLosModulos]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerTodosLosModulos];
GO
-- Get All Modules
CREATE   PROCEDURE [dbo].[sp_ObtenerTodosLosModulos]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT IdModulo as ModuleID, Titulo as Title, IdPadre as ParentID 
    FROM Modulos 
    ORDER BY IdPadre, IndiceOrden;
END
GO

IF OBJECT_ID('dbo.[sp_CrearBulto]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CrearBulto];
GO

    -- 1. CREAR BULTO (UNITARIO)
    CREATE   PROCEDURE sp_CrearBulto
        @CodigoEtiqueta NVARCHAR(50), 
        @Tipo NVARCHAR(20), -- 'PROD_TERMINADO', 'INSUMO'
        @OrdenID INT = NULL,
        @Descripcion NVARCHAR(255) = NULL,
        @Ubicacion NVARCHAR(50),
        @UsuarioID INT
    AS
    BEGIN
        SET NOCOUNT ON;
        IF EXISTS (SELECT 1 FROM Logistica_Bultos WHERE CodigoEtiqueta = @CodigoEtiqueta)
            THROW 51000, 'El c&oacute;digo de etiqueta ya existe.', 1;

        INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
        VALUES (@CodigoEtiqueta, @Tipo, @OrdenID, @Descripcion, @Ubicacion, 'CREADO', @UsuarioID);

        SELECT SCOPE_IDENTITY() as BultoID;
    END
 
GO

IF OBJECT_ID('dbo.[sp_ObtenerPermisosRol]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerPermisosRol];
GO
-- Get Role Permissions
CREATE   PROCEDURE [dbo].[sp_ObtenerPermisosRol]
    @RoleID int
AS
BEGIN
    SET NOCOUNT ON;
    SELECT IdModulo as ModuleID FROM PermisosRoles WHERE IdRol = @RoleID;
END
GO

IF OBJECT_ID('dbo.[sp_CrearEnvioLogistico]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CrearEnvioLogistico];
GO

    -- 2. CREAR ENVÍO (HEADER + ITEMS)
    CREATE   PROCEDURE sp_CrearEnvioLogistico
        @CodigoRemito NVARCHAR(50),
        @AreaOrigen NVARCHAR(50),
        @AreaDestino NVARCHAR(50),
        @UsuarioID INT,
        @BultosIdsJSON NVARCHAR(MAX) -- Array de IDs [1, 2, 5]
    AS
    BEGIN
        SET NOCOUNT ON;
        BEGIN TRY
            BEGIN TRANSACTION;

            -- Crear Cabecera
            INSERT INTO Logistica_Envios (CodigoRemito, AreaOrigenID, AreaDestinoID, UsuarioEmisor, Estado, FechaSalida)
            VALUES (@CodigoRemito, @AreaOrigen, @AreaDestino, @UsuarioID, 'EN_TRANSITO', GETDATE());
            
            DECLARE @EnvioID INT = SCOPE_IDENTITY();

            -- Insertar Items y Actualizar Estado Bultos
            INSERT INTO Logistica_EnvioItems (EnvioID, BultoID, EstadoRecepcion)
            SELECT @EnvioID, value, 'PENDIENTE'
            FROM OPENJSON(@BultosIdsJSON);

            UPDATE Logistica_Bultos 
            SET Estado = 'EN_TRANSITO', UbicacionActual = 'TRANSITO'
            WHERE BultoID IN (SELECT value FROM OPENJSON(@BultosIdsJSON));

            COMMIT TRANSACTION;
            SELECT @EnvioID as EnvioID;
        END TRY
        BEGIN CATCH
            ROLLBACK TRANSACTION;
            THROW;
        END CATCH
    END
 
GO

IF OBJECT_ID('dbo.[sp_GuardarPermisosRol]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GuardarPermisosRol];
GO
-- Save Role Permissions (Transactional)
CREATE   PROCEDURE [dbo].[sp_GuardarPermisosRol]
    @RoleID int,
    @ModuleIDs nvarchar(MAX) -- Comma separated list of IDs
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        -- Delete existing permissions
        DELETE FROM PermisosRoles WHERE IdRol = @RoleID;

        -- Insert new permissions using STRING_SPLIT
        INSERT INTO PermisosRoles (IdRol, IdModulo)
        SELECT @RoleID, value 
        FROM STRING_SPLIT(@ModuleIDs, ',');

        COMMIT TRANSACTION;
        SELECT 1 AS Result;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        SELECT -1 AS Result, ERROR_MESSAGE() AS Error;
    END CATCH
END
GO

IF OBJECT_ID('dbo.[sp_RecepcionarBulto]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_RecepcionarBulto];
GO

            CREATE   PROCEDURE sp_RecepcionarBulto
                @EnvioID INT,
                @CodigoEtiqueta NVARCHAR(50),
                @UsuarioID INT
            AS
            BEGIN
                SET NOCOUNT ON;

                -- Limpieza básica del código recibido
                SET @CodigoEtiqueta = LTRIM(RTRIM(@CodigoEtiqueta));

                -- Verificar si el item existe en el despacho (buscando coincidencia directa o con variaciones comunes)
                DECLARE @ItemID INT;

                SELECT TOP 1 @ItemID = ID
                FROM DespachoItems
                WHERE DespachoID = @EnvioID
                  AND (
                      CodigoBulto = @CodigoEtiqueta 
                      OR CodigoBulto = REPLACE(@CodigoEtiqueta, '/', '-') -- Si DB tiene guion y llega barra
                      OR REPLACE(CodigoBulto, '/', '-') = @CodigoEtiqueta -- Si DB tiene barra y llega guion
                  );

                IF @ItemID IS NULL
                BEGIN
                    -- Error 51004 se mapea a 404 Not Found en el backend
                    THROW 51004, 'Bulto no encontrado en este despacho.', 1;
                END

                -- Realizar la recepción
                UPDATE DespachoItems
                SET EstadoItem = 'RECIBIDO',
                    FechaEscaneo = GETDATE()
                WHERE ID = @ItemID;
                
                -- Opcional: Registrar evento en historial global si existiera tabla de auditoría
            END
 
GO

IF OBJECT_ID('dbo.[sp_GenerarBultosAutomaticos]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GenerarBultosAutomaticos];
GO

            CREATE   PROCEDURE sp_GenerarBultosAutomaticos
                @OrdenID INT,
                @UsuarioID INT
            AS
            BEGIN
                SET NOCOUNT ON;

                -- 1. Verificar si ya existen bultos para esta orden
                IF EXISTS (SELECT 1 FROM Logistica_Bultos WHERE OrdenID = @OrdenID)
                BEGIN
                    -- Si ya existen, NO hacemos nada (o podríamos lanzar error si fuera estricto, pero queremos ser idempotentes)
                    RETURN;
                END

                -- 2. Obtener información de la orden
                DECLARE @CodigoOrden NVARCHAR(50);
                DECLARE @Descripcion NVARCHAR(255);
                DECLARE @Ubicacion NVARCHAR(50) = 'PRODUCCION_TERMINADO';
                
                SELECT @CodigoOrden = CodigoOrden, @Descripcion = ISNULL(DescripcionTrabajo, Material)
                FROM Ordenes WHERE OrdenID = @OrdenID;

                -- 3. Determinar cantidad de bultos a generar
                -- Lógica: 1 bulto por defecto. 
                -- (Futuro: se puede leer de una columna 'CantidadBultos' si existiera)
                DECLARE @Cantidad INT = 1;

                -- 4. Generar Bultos
                DECLARE @i INT = 1;
                WHILE @i <= @Cantidad
                BEGIN
                    DECLARE @CodigoEtiqueta NVARCHAR(50);
                    -- Formato: ORDEN-B1, ORDEN-B2...
                    SET @CodigoEtiqueta = @CodigoOrden + '-B' + CAST(@i AS NVARCHAR);

                    -- Insertar
                    INSERT INTO Logistica_Bultos (
                        CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, 
                        UbicacionActual, Estado, UsuarioCreador, FechaCreacion
                    )
                    VALUES (
                        @CodigoEtiqueta, 
                        'PROD_TERMINADO', 
                        @OrdenID, 
                        @Descripcion + ' (Auto ' + CAST(@i AS NVARCHAR) + '/' + CAST(@Cantidad AS NVARCHAR) + ')',
                        @Ubicacion, 
                        'CREADO', 
                        @UsuarioID, 
                        GETDATE()
                    );

                    SET @i = @i + 1;
                END
                
                SELECT @Cantidad as BultosGenerados;
            END
 
GO

IF OBJECT_ID('dbo.[sp_ObtenerDetalleIntegralPedido]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerDetalleIntegralPedido];
GO

CREATE PROCEDURE [dbo].[sp_ObtenerDetalleIntegralPedido]
    @Ref NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    -- 1. IDENTIFICAR RAIZ (Lógica Original Robusta)
    DECLARE @BaseRef NVARCHAR(50) = LTRIM(RTRIM(@Ref));
    DECLARE @Idx INT = CHARINDEX('(', @Ref);
    
    IF @Idx > 0 
        SET @BaseRef = RTRIM(LEFT(@Ref, @Idx - 1));
    
    -- Tabla para guardar IDs de Ordenes afectadas (con campos extra para facilitar joins)
    DECLARE @OrdenesTbl TABLE (OrdenID INT, CodigoOrden NVARCHAR(50), AreaID NVARCHAR(20), Estado NVARCHAR(50));

    INSERT INTO @OrdenesTbl (OrdenID, CodigoOrden, AreaID, Estado)
    SELECT OrdenID, CodigoOrden, AreaID, Estado FROM Ordenes
    WHERE CodigoOrden = @BaseRef 
       OR CodigoOrden LIKE @BaseRef + ' (%'
       OR NoDocERP = @BaseRef; -- Añadido NoDocERP por si acaso
    
    IF NOT EXISTS (SELECT 1 FROM @OrdenesTbl)
    BEGIN
        RETURN; 
    END

    -- RS 1: HEADER (Mantenemos igual)
    SELECT TOP 1
        @BaseRef as PedidoRef,
        O.Cliente,
        O.DescripcionTrabajo as Descripcion,
        O.FechaIngreso,
        (SELECT COUNT(*) FROM @OrdenesTbl) as TotalOrdenes,
        (SELECT COUNT(*) FROM @OrdenesTbl WHERE Estado IN ('ENTREGADA', 'FINALIZADA', 'TERMINADO')) as Terminadas,
        (SELECT COUNT(*) FROM Logistica_Bultos WHERE OrdenID IN (SELECT OrdenID FROM @OrdenesTbl)) as BultosTotal
    FROM Ordenes O
    WHERE O.OrdenID = (SELECT TOP 1 OrdenID FROM @OrdenesTbl);

    -- RS 2: RUTA (CORREGIDO: LISTA DETALLADA CON JOIN)
    -- En vez de agrupar, devolvemos la secuencia de áreas con sus estados reales y nombres
    SELECT 
        O.AreaID AS Area, 
        ISNULL(A.Nombre, O.AreaID) AS Nombre, -- Traemos A.Nombre, si es null usamos ID
        O.Estado,
        O.EstadoenArea,
        O.EstadoLogistica,
        O.ProximoServicio
    FROM Ordenes O
    LEFT JOIN Areas A ON O.AreaID = A.AreaID
    WHERE O.OrdenID IN (SELECT OrdenID FROM @OrdenesTbl)
    ORDER BY O.Secuencia ASC, O.OrdenID ASC;

    -- RS 3: ORDENES (Detalle - Añadimos AreaNombre para la tabla)
    SELECT 
        O.OrdenID, O.CodigoOrden, O.AreaID, O.Material, O.Estado, O.FechaIngreso, O.Magnitud,
        ISNULL(A.Nombre, O.AreaID) as AreaNombre,
        (SELECT COUNT(*) FROM FallasProduccion WHERE OrdenID = O.OrdenID) as FallasCount
    FROM Ordenes O
    LEFT JOIN Areas A ON O.AreaID = A.AreaID
    WHERE O.OrdenID IN (SELECT OrdenID FROM @OrdenesTbl)
    ORDER BY O.CodigoOrden;

    -- RS 4: LOGISTICA (Igual)
    SELECT B.*, O.CodigoOrden 
    FROM Logistica_Bultos B
    JOIN Ordenes O ON B.OrdenID = O.OrdenID
    WHERE B.OrdenID IN (SELECT OrdenID FROM @OrdenesTbl);

    -- RS 5: INCIDENCIAS (Igual)
    SELECT F.*, O.CodigoOrden, TF.Titulo as TipoFalla
    FROM FallasProduccion F
    JOIN Ordenes O ON F.OrdenID = O.OrdenID
    LEFT JOIN TiposFallas TF ON F.FallaID = TF.FallaID
    WHERE F.OrdenID IN (SELECT OrdenID FROM @OrdenesTbl);

    -- RS 6: HISTORIAL (Igual)
    SELECT TOP 50 
        H.OrdenID, 
        H.Estado, 
        H.FechaInicio as Fecha, 
        H.Detalle, 
        O.CodigoOrden
    FROM HistorialOrdenes H
    JOIN Ordenes O ON H.OrdenID = O.OrdenID
    WHERE H.OrdenID IN (SELECT OrdenID FROM @OrdenesTbl)
    ORDER BY H.FechaInicio DESC;
END

GO

IF OBJECT_ID('dbo.[sp_ObtenerDetalleCompletoOrden]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerDetalleCompletoOrden];
GO

        CREATE   PROCEDURE sp_ObtenerDetalleCompletoOrden
            @OrdenID INT
        AS
        BEGIN
            SET NOCOUNT ON;

            -- 1. HEADER
            SELECT O.*, A.Nombre as AreaNombre
            FROM Ordenes O
            LEFT JOIN Areas A ON O.AreaID = A.AreaID
            WHERE O.OrdenID = @OrdenID;

            -- 2. FILES
            SELECT * FROM ArchivosOrden WHERE OrdenID = @OrdenID;

            -- 3. FALLAS
            SELECT F.*, TF.Titulo as TipoFallaTitulo 
            FROM FallasProduccion F
            LEFT JOIN TiposFallas TF ON F.FallaID = TF.FallaID 
            WHERE F.OrdenID = @OrdenID;

            -- 4. HISTORY
            -- Intentamos vincular el Estado con un Area para dar contexto
            SELECT 
                H.OrdenID,
                H.Estado,
                H.FechaInicio as Fecha,  
                H.FechaFin,
                H.Usuario as UsuarioID,
                H.Detalle as Descripcion, 
                'Cambio Estado' as Accion,
                A.Nombre as AreaNombre,
                A.AreaID as AreaCode
            FROM HistorialOrdenes H
            LEFT JOIN ConfigEstados CE ON H.Estado = CE.Nombre
            LEFT JOIN Areas A ON CE.AreaID = A.AreaID
            WHERE H.OrdenID = @OrdenID
            ORDER BY H.FechaInicio DESC;
        END
 
GO

IF OBJECT_ID('dbo.[sp_Modulos_GetAll]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_Modulos_GetAll];
GO
-- =============================================
-- Author:      Gemini System
-- Description: Gestión de Módulos de Menú
-- =============================================

-- 1. Obtener todos los módulos (ordenados)
CREATE PROCEDURE sp_Modulos_GetAll
AS
BEGIN
    SELECT IdModulo, Titulo, IdPadre, Ruta, Icono, IndiceOrden
    FROM Modulos
    ORDER BY IdPadre, IndiceOrden;
END;

GO

IF OBJECT_ID('dbo.[sp_Modulos_Upsert]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_Modulos_Upsert];
GO

-- 2. Insertar o Actualizar Módulo
CREATE PROCEDURE sp_Modulos_Upsert
    @IdModulo INT = NULL,
    @Titulo NVARCHAR(100),
    @IdPadre INT = NULL,
    @Ruta NVARCHAR(255) = NULL,
    @Icono NVARCHAR(100) = NULL,
    @IndiceOrden INT = 0
AS
BEGIN
    IF EXISTS (SELECT 1 FROM Modulos WHERE IdModulo = @IdModulo)
    BEGIN
        UPDATE Modulos
        SET Titulo = @Titulo,
            IdPadre = @IdPadre,
            Ruta = @Ruta,
            Icono = @Icono,
            IndiceOrden = @IndiceOrden
        WHERE IdModulo = @IdModulo;
        SELECT @IdModulo AS Result;
    END
    ELSE
    BEGIN
        INSERT INTO Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
        VALUES (@Titulo, @IdPadre, @Ruta, @Icono, @IndiceOrden);
        SELECT SCOPE_IDENTITY() AS Result;
    END
END;

GO

IF OBJECT_ID('dbo.[sp_Modulos_Delete]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_Modulos_Delete];
GO

-- 3. Eliminar Módulo (y sus hijos en cascada si no hay FK restrictiva)
CREATE PROCEDURE sp_Modulos_Delete
    @IdModulo INT
AS
BEGIN
    -- Nota: En una DB real, podrías querer mover los hijos a la raíz o borrarlos.
    -- Aquí borramos el módulo específico.
    DELETE FROM Modulos WHERE IdModulo = @IdModulo;
END;

GO

IF OBJECT_ID('dbo.[SP_SiguienteNumeroDoc]', 'P') IS NOT NULL DROP PROCEDURE dbo.[SP_SiguienteNumeroDoc];
GO


/*==========================================================================
  SP — SP_SiguienteNumeroDoc
  Devuelve el próximo número de documento de forma atómica (UPDLOCK).
  No se pueden generar duplicados aunque haya concurrencia.
==========================================================================*/
CREATE PROCEDURE dbo.SP_SiguienteNumeroDoc
    @TipoDoc  VARCHAR(20),
    @Serie    VARCHAR(5) = 'A'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE
        @SecIdSecuencia   INT,
        @SecDigitos       INT,
        @SecPrefijo       VARCHAR(10),
        @SecActivo        BIT,
        @NuevoNumero      INT,
        @NumFormato       VARCHAR(30);

    /* Leer la secuencia */
    SELECT
        @SecIdSecuencia = SecIdSecuencia,
        @SecDigitos     = SecDigitos,
        @SecPrefijo     = SecPrefijo,
        @SecActivo      = SecActivo
    FROM dbo.SecuenciaDocumentos WITH(NOLOCK)
    WHERE SecTipoDoc = @TipoDoc AND SecSerie = @Serie;

    IF @SecIdSecuencia IS NULL
    BEGIN
        RAISERROR('No existe secuencia para TipoDoc="%s" Serie="%s". Configure en SecuenciaDocumentos.', 16, 1, @TipoDoc, @Serie);
        RETURN;
    END

    IF @SecActivo = 0
    BEGIN
        RAISERROR('La secuencia TipoDoc="%s" Serie="%s" está inactiva.', 16, 1, @TipoDoc, @Serie);
        RETURN;
    END

    /* UPDATE atómico: incrementa y captura el nuevo valor */
    UPDATE dbo.SecuenciaDocumentos WITH(UPDLOCK, ROWLOCK)
    SET   SecUltimoNumero = SecUltimoNumero + 1
    WHERE SecIdSecuencia  = @SecIdSecuencia;

    SELECT @NuevoNumero = SecUltimoNumero
    FROM   dbo.SecuenciaDocumentos WITH(NOLOCK)
    WHERE  SecIdSecuencia = @SecIdSecuencia;

    /* Formatear: prefijo + ceros a la izquierda */
    SET @NumFormato = ISNULL(@SecPrefijo, '')
                    + RIGHT(REPLICATE('0', @SecDigitos) + CAST(@NuevoNumero AS VARCHAR(10)), @SecDigitos);

    SELECT
        @NuevoNumero      AS NumeroEntero,
        @NumFormato       AS NumeroFormato,
        @TipoDoc          AS TipoDoc,
        @Serie            AS Serie,
        ISNULL(@SecPrefijo, '') AS Prefijo;
END

GO

IF OBJECT_ID('dbo.[sp_AutenticarUsuario]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_AutenticarUsuario];
GO
-- Auth (Devuelve Alias para compatibilidad con Frontend)
CREATE   PROCEDURE [dbo].[sp_AutenticarUsuario]
    @Username nvarchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT 
        u.IdUsuario as UserID, 
        u.Usuario as Username, 
        u.ContrasenaHash as PasswordHash, 
        u.IdRol as RoleID, 
        u.AreaUsuario as AreaUsuario,
        r.NombreRol as RoleName
    FROM Usuarios u INNER JOIN Roles r ON u.IdRol = r.IdRol
    WHERE u.Usuario = @Username AND u.Activo = 1;
END
GO

IF OBJECT_ID('dbo.[SP_AbrirSesionCaja]', 'P') IS NOT NULL DROP PROCEDURE dbo.[SP_AbrirSesionCaja];
GO
CREATE PROCEDURE dbo.SP_AbrirSesionCaja
    @UsuarioId    INT,
    @MontoInicial DECIMAL(18,2) = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1 FROM dbo.SesionesTurno WITH(NOLOCK)
        WHERE StuEstado = 'ABIERTA'
          AND CAST(StuFechaApertura AS DATE) = CAST(GETDATE() AS DATE)
    )
    BEGIN
        RAISERROR('Ya existe una sesión de caja ABIERTA hoy. Ciérrela antes de abrir una nueva.', 16, 1);
        RETURN;
    END
    INSERT INTO dbo.SesionesTurno (StuUsuarioAbre, StuMontoInicial, StuEstado)
    VALUES (@UsuarioId, @MontoInicial, 'ABIERTA');
    SELECT SCOPE_IDENTITY() AS StuIdSesion, GETDATE() AS FechaApertura;
END

GO

IF OBJECT_ID('dbo.[sp_RegistrarAccion]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_RegistrarAccion];
GO
-- Logs
CREATE   PROCEDURE [dbo].[sp_RegistrarAccion]
    @UserID int = NULL,
    @Action nvarchar(100),
    @Details nvarchar(MAX) = NULL,
    @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
    VALUES (@UserID, @Action, @Details, @IPAddress, GETDATE());
END
GO

IF OBJECT_ID('dbo.[SP_CerrarSesionCaja]', 'P') IS NOT NULL DROP PROCEDURE dbo.[SP_CerrarSesionCaja];
GO
CREATE PROCEDURE dbo.SP_CerrarSesionCaja
    @StuIdSesion    INT,
    @UsuarioId      INT,
    @MontoFinal     DECIMAL(18,2),
    @Observaciones  NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalCobros   DECIMAL(18,2) = 0;
    DECLARE @TotalEgresos  DECIMAL(18,2) = 0;

    SELECT @TotalCobros  = ISNULL(SUM(TcaTotalCobrado), 0)
    FROM dbo.TransaccionesCaja WITH(NOLOCK)
    WHERE StuIdSesion = @StuIdSesion AND TcaEstado = 'COMPLETADO';

    SELECT @TotalEgresos = ISNULL(SUM(EgrMontoConvertido), 0)
    FROM dbo.EgresosCaja WITH(NOLOCK)
    WHERE StuIdSesion = @StuIdSesion AND EgrEstado = 'REGISTRADO';

    DECLARE @MontoSistema DECIMAL(18,2) = @TotalCobros - @TotalEgresos;
    DECLARE @Diferencia   DECIMAL(18,2) = @MontoFinal - @MontoSistema;
    DECLARE @NuevoEstado  VARCHAR(30)   = CASE WHEN ABS(@Diferencia) < 1 THEN 'CERRADA' ELSE 'CERRADA_CON_DIFERENCIA' END;

    UPDATE dbo.SesionesTurno
    SET StuFechaCierre   = GETDATE(),
        StuUsuarioCierra = @UsuarioId,
        StuMontoFinal    = @MontoFinal,
        StuMontoSistema  = @MontoSistema,
        StuDiferencia    = @Diferencia,
        StuEstado        = @NuevoEstado,
        StuObservaciones = @Observaciones
    WHERE StuIdSesion = @StuIdSesion AND StuEstado = 'ABIERTA';

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR('No se encontró sesión ABIERTA con ID %d.', 16, 1, @StuIdSesion);
        RETURN;
    END

    SELECT
        @StuIdSesion   AS StuIdSesion,
        @TotalCobros   AS TotalCobros,
        @TotalEgresos  AS TotalEgresos,
        @MontoSistema  AS MontoSistema,
        @MontoFinal    AS MontoFinal,
        @Diferencia    AS Diferencia,
        @NuevoEstado   AS EstadoFinal;
END

GO

IF OBJECT_ID('dbo.[sp_ObtenerUsuarios]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ObtenerUsuarios];
GO
-- Get Users
CREATE   PROCEDURE [dbo].[sp_ObtenerUsuarios]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT 
        u.IdUsuario as UserID, 
        u.Usuario as Username, 
        u.Email, 
        r.NombreRol as RoleName, 
        u.Activo as IsActive, 
        u.FechaCreacion as CreatedAt
    FROM Usuarios u INNER JOIN Roles r ON u.IdRol = r.IdRol
    ORDER BY u.Usuario;
END
GO

IF OBJECT_ID('dbo.[SP_RegistrarMovimiento]', 'P') IS NOT NULL DROP PROCEDURE dbo.[SP_RegistrarMovimiento];
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

                INSERT INTO [dbo].[MovimientosCuenta] (
                    CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
                    OrdIdOrden, OReIdOrdenRetiro, PagIdPago, DocIdDocumento,
                    MovRefExterna, MovFecha, MovUsuarioAlta, MovObservaciones, CicIdCiclo
                )
                VALUES (
                    @CueIdCuenta, @MovTipo, @MovConcepto, @MovImporte, @NuevoSaldo,
                    @OrdIdOrden, @OReIdOrdenRetiro, @PagIdPago, @DocIdDocumento,
                    @MovRefExterna, GETDATE(), @MovUsuarioAlta, @MovObservaciones, @CicIdCiclo
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

IF OBJECT_ID('dbo.[sp_CrearUsuario]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CrearUsuario];
GO
-- Create User
CREATE   PROCEDURE [dbo].[sp_CrearUsuario]
    @Username nvarchar(50),
    @PasswordHash nvarchar(255),
    @RoleID int,
    @Email nvarchar(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM Usuarios WHERE Usuario = @Username)
    BEGIN
        SELECT -1 AS Result; RETURN;
    END
    INSERT INTO Usuarios (Usuario, ContrasenaHash, IdRol, Email)
    VALUES (@Username, @PasswordHash, @RoleID, @Email);
    SELECT SCOPE_IDENTITY() AS Result;
END
GO

IF OBJECT_ID('dbo.[SP_ImputarPagoPEPS]', 'P') IS NOT NULL DROP PROCEDURE dbo.[SP_ImputarPagoPEPS];
GO

CREATE PROCEDURE [dbo].[SP_ImputarPagoPEPS]
    @PagIdPago          INT,
    @MontoDisponible    DECIMAL(18,4),
    @CueIdCuenta        INT,
    @UsuarioAlta        INT,
    @MontoExcedente     DECIMAL(18,4) = NULL OUTPUT  -- saldo que sobró (crédito a favor)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @DDeIdDocumento     INT;
    DECLARE @DDeImportePendiente DECIMAL(18,4);
    DECLARE @Aplicar            DECIMAL(18,4);
    DECLARE @Restante           DECIMAL(18,4) = @MontoDisponible;

    BEGIN TRY
        BEGIN TRANSACTION;

            -- Cursor PEPS: vencimiento más antiguo primero
            DECLARE cur_deudas CURSOR LOCAL FAST_FORWARD FOR
                SELECT DDeIdDocumento, DDeImportePendiente
                FROM   [dbo].[DeudaDocumento]
                WHERE  CueIdCuenta = @CueIdCuenta
                  AND  DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL')
                ORDER BY DDeFechaVencimiento ASC, DDeIdDocumento ASC;

            OPEN cur_deudas;
            FETCH NEXT FROM cur_deudas INTO @DDeIdDocumento, @DDeImportePendiente;

            WHILE @@FETCH_STATUS = 0 AND @Restante > 0
            BEGIN
                SET @Aplicar = CASE
                    WHEN @Restante >= @DDeImportePendiente THEN @DDeImportePendiente
                    ELSE @Restante
                END;

                -- Registrar imputación
                INSERT INTO [dbo].[ImputacionPago]
                    (PagIdPago, DDeIdDocumento, CueIdCuenta, ImpImporte, ImpFecha, ImpUsuarioAlta)
                VALUES
                    (@PagIdPago, @DDeIdDocumento, @CueIdCuenta, @Aplicar, GETDATE(), @UsuarioAlta);

                -- Actualizar deuda
                UPDATE [dbo].[DeudaDocumento]
                SET    DDeImportePendiente = DDeImportePendiente - @Aplicar,
                       DDeEstado = CASE
                           WHEN DDeImportePendiente - @Aplicar = 0 THEN 'COBRADO'
                           ELSE 'PARCIAL'
                       END,
                       DDeFechaCobro = CASE
                           WHEN DDeImportePendiente - @Aplicar = 0 THEN GETDATE()
                           ELSE NULL
                       END
                WHERE  DDeIdDocumento = @DDeIdDocumento;

                SET @Restante = @Restante - @Aplicar;

                FETCH NEXT FROM cur_deudas INTO @DDeIdDocumento, @DDeImportePendiente;
            END;

            CLOSE cur_deudas;
            DEALLOCATE cur_deudas;

            SET @MontoExcedente = @Restante;  -- > 0 significa crédito a favor

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        CLOSE cur_deudas;
        DEALLOCATE cur_deudas;
        THROW;
    END CATCH;
END;

GO

IF OBJECT_ID('dbo.[sp_GetRollosActivosPorArea]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetRollosActivosPorArea];
GO
CREATE PROCEDURE sp_GetRollosActivosPorArea
    @AreaID INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 
        RolloID, 
        Nombre, -- Este es el "CodigoRollo" que vemos en la UI
        Estado,
        ColorHex -- Lo incluimos por si quieres usarlo en la UI
    FROM [dbo].[Rollos]
    WHERE Estado <> 'CERRADO' 
      AND AreaID = @AreaID
    ORDER BY FechaCreacion DESC;
END
GO

IF OBJECT_ID('dbo.[sp_GetOrdenesControl_V2]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetOrdenesControl_V2];
GO

CREATE PROCEDURE [dbo].[sp_GetOrdenesControl_V2]
    @Search NVARCHAR(100) = NULL,
    @RolloID NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 
        O.OrdenID,
        O.NoDocERP AS CodigoPedido,
        O.Cliente AS ClienteNombre,
        O.DescripcionTrabajo,
        ISNULL(R.Nombre, 'SIN ROLLO') AS NombreRollo,
        O.Estado,
        O.Material,
        -- Cálculo de avance
        ISNULL((SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = O.OrdenID AND EstadoArchivo = 'OK') * 100 / 
        NULLIF((SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = O.OrdenID), 0), 0) as Avance
    FROM [dbo].[Ordenes] O
    LEFT JOIN [dbo].[Rollos] R ON O.RolloID = R.RolloID
    WHERE
        -- FILTRO DE ROLLO ACTUALIZADO PARA NVARCHAR
        (@RolloID IS NULL OR @RolloID = '' OR O.RolloID = @RolloID)
        
        -- FILTRO DE BÚSQUEDA (Texto)
        AND (
            @Search IS NULL 
            OR O.NoDocERP LIKE '%' + @Search + '%' 
            OR O.Cliente LIKE '%' + @Search + '%'
        )
        
        -- FILTRO DE ESTADOS
        AND O.Estado NOT IN ('ENTREGADO', 'CANCELADO')
    ORDER BY O.FechaIngreso DESC;
END

GO

-- ===========================
-- DATOS DE TABLAS FALTANTES
-- ===========================
SET IDENTITY_INSERT dbo.[SecuenciaDocumentos] ON;
GO
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (1, 'ETICKET', 'A', NULL, 7, 0, 1, NULL);
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (2, 'FACTURA', 'A', NULL, 6, 0, 1, NULL);
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (3, 'CREDITO', 'A', 'NC-', 6, 0, 1, NULL);
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (4, 'NOTA_CONSUMO', 'A', NULL, 6, 0, 1, NULL);
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (5, 'RECIBO', 'A', 'REC-', 6, 0, 1, NULL);
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (6, 'ORDEN_PAGO', 'A', 'OP-', 6, 0, 1, NULL);
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (7, 'FACTURA_CICLO', 'C', 'FC-', 5, 0, 1, NULL);
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (8, 'VOUCHER_CAJA', 'A', 'VC', 6, 0, 1, NULL);
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (9, 'E-TICKET CREDITO', 'A', 'A-', 5, 0, 1, NULL);
INSERT INTO dbo.[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones]) VALUES (10, 'E-FACTURA CREDITO', 'A', 'A-', 5, 0, 1, NULL);
GO
SET IDENTITY_INSERT dbo.[SecuenciaDocumentos] OFF;
GO

INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('COMUN', '1.1.2.1', 'Dtf Textil                                             ', 247, 'DTF textil COMUN                                                                                    ', 48, 47, 'DTF');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('DORADO BRILLANTE', '1.1.2.1', 'Dtf Textil                                             ', 248, 'DTF textil DORADO                                                                                   ', 49, 48, 'DTF');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('UV (PARA RIGIDOS 0.57)', '1.1.2.2', 'Dtf UV                                                 ', 255, 'DTF para rígidos UV                                                                                 ', 55, 52, 'DTF');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Parche (De hasta 10x8)', '1.1.10.1', 'TPU', 413, 'Parche (De hasta 10x8)', 152, 152, 'TPU');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Parche (Hasta 4x4)', '1.1.10.1', 'TPU', 414, 'Parche (Hasta 4x4)', 153, 153, 'TPU');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Parche con un maximo de 4 estrellas (De hasta 10x8)', '1.1.10.1', 'TPU', 415, 'Parche con un maximo de 4 estrellas (De hasta 10x8)', 154, 154, 'TPU');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Parche (Hasta 7,5 x 4)', '1.1.10.1', 'TPU', 416, 'Parche (Hasta 7,5 x 4)', 155, 155, 'TPU');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Matriz TPU', '1.1.10.1', 'TPU', 417, 'Matriz TPU', 156, 156, 'TPU');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('ESTAMPADO DE TPU EN PESOS', '1.1.5.1', 'Estampado                                              ', 418, 'ESTAMPADO DE TPU ', 157, 157, 'EST');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Tela de bandera (3,10)', '1.1.11.1', 'Impresión Directa 3.20', 9, 'Tela de bandera (3,10)', 1558, 160, 'IMD');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Tela de bandera Mesh (3,17)', '1.1.11.1', 'Impresión Directa 3.20', 420, 'Tela de bandera Mesh (3,17)', 161, 161, 'IMD');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Tela Blackout – Tela Doble Cara (2,9)', '1.1.11.1', 'Impresión Directa 3.20', 32, 'Tela Blackout – Tela Doble Cara (2,9)', 1560, 162, 'IMD');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Balconera', '1.1.6.1', 'Corte Laser                                            ', 85, 'Corte Laser Balconera', 1370, 226, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Bandera de auto', '1.1.6.1', 'Corte Laser                                            ', 80, 'Corte Laser Bandera de auto', 1365, 224, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Bandera x metro cuadrado', '1.1.6.1', 'Corte Laser                                            ', 79, 'Corte Laser Bandera x metro cuadrado', 1364, 240, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Banderas piezas (1 pieza hasta 1,80 m X 4,00 m)', '1.1.6.1', 'Corte Laser                                            ', 78, 'Corte Laser Banderas piezas (1 pieza hasta 1,80 m X 4,00 m)', 1363, 241, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Banderín triangular', '1.1.6.1', 'Corte Laser                                            ', 81, 'Corte Laser Banderín triangular', 1366, 242, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Buzo y buzo con cierre', '1.1.6.1', 'Corte Laser                                            ', 75, 'Corte Laser Buzo y buzo con cierre', 1360, 243, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Camiseta compleja', '1.1.6.1', 'Corte Laser                                            ', 71, 'Corte Laser Camiseta compleja', 1356, 244, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser camiseta con detalles', '1.1.6.1', 'Corte Laser                                            ', 70, 'Corte Laser camiseta con detalles', 1355, 245, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser camiseta simple', '1.1.6.1', 'Corte Laser                                            ', 68, 'Corte Laser camiseta simple', 1353, 246, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Campera', '1.1.6.1', 'Corte Laser                                            ', 74, 'Corte Laser Campera', 1359, 247, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Camperas, buzos y canguros 2 colores', '1.1.6.1', 'Corte Laser                                            ', 76, 'Corte Laser Camperas, buzos y canguros 2 colores', 1361, 223, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Capa barbería', '1.1.6.1', 'Corte Laser                                            ', 91, 'Corte Laser Capa barbería', 1376, 229, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Chaleco', '1.1.6.1', 'Corte Laser                                            ', 86, 'Corte Laser Chaleco', 1371, 227, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Cuellitos / buffs', '1.1.6.1', 'Corte Laser                                            ', 88, 'Corte Laser Cuellitos / buffs', 1373, 233, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Etiquetas para ropa', '1.1.6.1', 'Corte Laser                                            ', 87, 'Corte Laser Etiquetas para ropa', 1372, 234, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Letras y números', '1.1.6.1', 'Corte Laser                                            ', 89, 'Corte Laser Letras y números', 1374, 228, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Pantalón', '1.1.6.1', 'Corte Laser                                            ', 77, 'Corte Laser Pantalón', 1362, 235, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Piezas (1 pieza hasta 0,20 m X 0,20 m)', '1.1.6.1', 'Corte Laser                                            ', 84, 'Corte Laser Piezas (1 pieza hasta 0,20 m X 0,20 m)', 1369, 225, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Piezas (1 pieza hasta 0,6 m X 0.9 m)', '1.1.6.1', 'Corte Laser                                            ', 83, 'Corte Laser Piezas (1 pieza hasta 0,6 m X 0.9 m)', 1368, 236, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Piezas (1 pieza hasta 1,20 m X 1,80 m)', '1.1.6.1', 'Corte Laser                                            ', 82, 'Corte Laser Piezas (1 pieza hasta 1,20 m X 1,80 m)', 1367, 237, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser por prenda', '1.1.6.1', 'Corte Laser                                            ', 90, 'Corte Laser por prenda', 1375, 253, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Pulseras', '1.1.6.1', 'Corte Laser                                            ', 437, 'Corte Laser Pulseras', 1570, 1571, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Short-pollera', '1.1.6.1', 'Corte Laser                                            ', 73, 'Corte Laser Short-pollera', 1358, 222, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte Laser Shorts', '1.1.6.1', 'Corte Laser                                            ', 72, 'Corte Laser Shorts', 1357, 238, 'TWC');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura', '1.1.7.1', 'Costura                                                ', 36, 'Costura', 115, 219, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura camiseta con detalles', '1.1.7.1', 'Costura                                                ', 38, 'Costura camiseta con detalles', 116, 220, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura camiseta compleja', '1.1.7.1', 'Costura                                                ', 40, 'Costura camiseta compleja', 1178, 221, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura shorts', '1.1.7.1', 'Costura                                                ', 41, 'Costura shorts', 1179, 239, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Cosstura de Almohadones con cierre', '1.1.7.1', 'Costura                                                ', 113, 'Cosstura de Almohadones con cierre', 1398, 230, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de short-pollera', '1.1.7.1', 'Costura                                                ', 191, 'Costura de short-pollera', 1475, 191, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de campera', '1.1.7.1', 'Costura                                                ', 192, 'Costura de campera', 1476, 192, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de buzo y buzo con cierre', '1.1.7.1', 'Costura                                                ', 193, 'Costura de buzo y buzo con cierre', 1477, 193, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de camperas, buzos y canguros', '1.1.7.1', 'Costura                                                ', 194, 'Costura de camperas, buzos y canguros', 1478, 194, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de pantalón', '1.1.7.1', 'Costura                                                ', 195, 'Costura de pantalón', 1479, 195, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de bandera piezas (1 pieza hasta 1,80 m x 4,00 m)', '1.1.7.1', 'Costura                                                ', 196, 'Costura de bandera piezas (1 pieza hasta 1,80 m x 4,00 m)', 1480, 196, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de bandera x metro cuadrado', '1.1.7.1', 'Costura                                                ', 197, 'Costura de bandera x metro cuadrado', 1481, 197, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de bandera de auto', '1.1.7.1', 'Costura                                                ', 198, 'Costura de bandera de auto', 1482, 198, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de banderín triangular', '1.1.7.1', 'Costura                                                ', 199, 'Costura de banderín triangular', 1483, 199, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de piezas (1 pieza hasta 1,20 m x 1,80 m)', '1.1.7.1', 'Costura                                                ', 200, 'Costura de piezas (1 pieza hasta 1,20 m x 1,80 m)', 1484, 200, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de piezas (1 pieza hasta 0,6 m x 0.9 m)', '1.1.7.1', 'Costura                                                ', 201, 'Costura de piezas (1 pieza hasta 0,6 m x 0.9 m)', 1485, 201, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de piezas (1 pieza hasta 0,20 m x 0,20 m)', '1.1.7.1', 'Costura                                                ', 202, 'Costura de piezas (1 pieza hasta 0,20 m x 0,20 m)', 1486, 202, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de balconera', '1.1.7.1', 'Costura                                                ', 203, 'Costura de balconera', 1487, 203, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de chaleco', '1.1.7.1', 'Costura                                                ', 204, 'Costura de chaleco', 1488, 204, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de cuellitos / buffs', '1.1.7.1', 'Costura                                                ', 205, 'Costura de cuellitos / buffs', 1489, 205, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de capa barbería', '1.1.7.1', 'Costura                                                ', 206, 'Costura de capa barbería', 1490, 206, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Costura de totebag', '1.1.7.1', 'Costura                                                ', 207, 'Costura de totebag', 1491, 207, 'TWT');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Papel', '1.1.1.2', 'Impresión de Papel                           ', 246, 'Papel', 47, 37, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Adis Elastizado Grueso (1,83)', '1.1.1.1', 'Sublimacion Tela                                       ', 239, 'Adis Elastizado Grueso (1,83)', 40, 103, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Bandera (1,60)', '1.1.1.1', 'Sublimacion Tela                                       ', 44, 'Bandera (1,60)', 12, 56, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Bandera mesh (1,60) (110g)', '1.1.1.1', 'Sublimacion Tela                                       ', 227, 'Bandera mesh (1,60) (110g)', 3, 40, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Delta (1,72 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 56, 'Delta (1,72 m)', 1223, 137, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Deportiva (1,60)', '1.1.1.1', 'Sublimacion Tela                                       ', 214, 'Deportiva (1,60)', 18, 63, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Dry Microporoso 1.83 (lado  liso)', '1.1.1.1', 'Sublimacion Tela                                       ', 277, 'Dry Microporoso 1.83 (lado  liso)', 8, 45, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Dry Microporoso 1.83 (lado  poroso)', '1.1.1.1', 'Sublimacion Tela                                       ', 266, 'Dry Microporoso 1.83 (lado  poroso)', 7, 44, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Dry Polo (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 52, 'Dry Polo (1,80)', 1219, 111, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Dry Poroso (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 217, 'Dry Poroso (1,50)', 20, 2, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Dry Pro (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 28, 'Dry Pro (1,80)', 11, 55, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('ESPECIAL F', '1.1.1.1', 'Sublimacion Tela                                       ', 231, 'ESPECIAL F', 33, 86, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Grid (1,70 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 58, 'Grid (1,70 m)', 1225, 139, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Hexagonal (1,83)', '1.1.1.1', 'Sublimacion Tela                                       ', 258, 'Hexagonal (1,83)', 6, 43, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Interlock feria (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 388, 'Interlock feria (1,80)', 93, 93, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Interlock Fina "Fer" (1,83 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 235, 'Interlock Fina "Fer" (1,83 m)', 37, 158, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Interlock Grueso  (1,83 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 410, 'Interlock Grueso  (1,83 m)', 149, 149, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Jacquard city 1,83', '1.1.1.1', 'Sublimacion Tela                                       ', 208, 'Jacquard city 1,83', 1499, 113, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Jacquard Elite 1,83', '1.1.1.1', 'Sublimacion Tela                                       ', 223, 'Jacquard Elite 1,83', 26, 29, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Lycra (1,60)', '1.1.1.1', 'Sublimacion Tela                                       ', 221, 'Lycra (1,60)', 24, 6, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Lycra Mykonos (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 236, 'Lycra Mykonos (1,80)', 38, 101, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Microfibra RV Waterproof (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 48, 'Microfibra RV Waterproof (1,50)', 1215, 116, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Microfibra Short', '1.1.1.1', 'Sublimacion Tela                                       ', 49, 'Microfibra Short', 1216, 117, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Modal (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 220, 'Modal (1,50)', 23, 5, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Nagasaki (1,80 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 57, 'Nagasaki (1,80 m)', 1224, 138, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('NeoStretch (1,83)', '1.1.1.1', 'Sublimacion Tela                                       ', 53, 'NeoStretch (1,83)', 1220, 112, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Panama (1,60)', '1.1.1.1', 'Sublimacion Tela                                       ', 240, 'Panama (1,60)', 41, 57, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Polar (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 212, 'Polar (1,50)', 16, 60, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Rib 1,70 (Cuellos y vivos tela Elite y Supreme)', '1.1.1.1', 'Sublimacion Tela                                       ', 225, 'Rib 1,70 (Cuellos y vivos tela Elite y Supreme)', 28, 31, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Saten (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 2, 'Saten (1,50)', 10, 54, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Tela Cliente (Minimo 5mts)', '1.1.1.3', 'Sublimacion Tela Cliente                                      ', 1, 'Tela Cliente (Minimo 5mts)', 1, 38, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Toalla (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 216, 'Toalla (1,80)', 2, 39, 'SB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Banner Pet mate (0,91)', '1.1.3.1', 'Impresion Gran Formato                                 ', 317, 'Banner Pet mate (0,91)', 1585, 27, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Canvas Brillo 0,91', '1.1.3.1', 'Impresion Gran Formato                                 ', 338, 'Canvas Brillo 0,91', 1606, 80, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Canvas Brillo 1,27', '1.1.3.1', 'Impresion Gran Formato                                 ', 436, 'Canvas Brillo 1,27', 1569, 231, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Canvas Mate 1,27', '1.1.3.1', 'Impresion Gran Formato                                 ', 346, 'Canvas Mate 1,27', 1614, 24, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Canvas Mate 1,52', '1.1.3.1', 'Impresion Gran Formato                                 ', 347, 'Canvas Mate 1,52', 1615, 25, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Columnera 0,77 x 0,50 + Palo', '1.1.3.1', 'Impresion Gran Formato                                 ', 342, 'Columnera 0,77 x 0,50 + Palo', 1610, 97, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Cuadro canvas 1,10 x 50', '1.1.3.1', 'Impresion Gran Formato                                 ', 358, 'Cuadro canvas 1,10 x 50', 1625, 142, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Cuadro canvas 25 x 25', '1.1.3.1', 'Impresion Gran Formato                                 ', 349, 'Cuadro canvas 25 x 25', 1616, 121, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Cuadro canvas 35 x 15', '1.1.3.1', 'Impresion Gran Formato                                 ', 355, 'Cuadro canvas 35 x 15', 1622, 133, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Cuadro canvas 40 x 40', '1.1.3.1', 'Impresion Gran Formato                                 ', 350, 'Cuadro canvas 40 x 40', 1617, 122, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Cuadro canvas 50 x 30', '1.1.3.1', 'Impresion Gran Formato                                 ', 356, 'Cuadro canvas 50 x 30', 1623, 140, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Cuadro canvas 60 x 60', '1.1.3.1', 'Impresion Gran Formato                                 ', 351, 'Cuadro canvas 60 x 60', 1618, 123, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Cuadro canvas 70 x 50', '1.1.3.1', 'Impresion Gran Formato                                 ', 357, 'Cuadro canvas 70 x 50', 1624, 141, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Cuadro canvas 80 x 80', '1.1.3.1', 'Impresion Gran Formato                                 ', 352, 'Cuadro canvas 80 x 80', 1619, 124, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Frontlight Brillo hasta 3.17', '1.1.3.1', 'Impresion Gran Formato                                 ', 360, 'Frontlight Brillo hasta 3.17', 1627, 8, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Frontlight Mate hasta 3.17', '1.1.3.1', 'Impresion Gran Formato                                 ', 378, 'Frontlight Mate hasta 3.17', 1628, 9, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Lona Backligth hasta 3,17', '1.1.3.1', 'Impresion Gran Formato                                 ', 336, 'Lona Backligth hasta 3,17', 1604, 89, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Lona para Pasacalles 0,80', '1.1.3.1', 'Impresion Gran Formato                                 ', 319, 'Lona para Pasacalles 0,80', 1587, 36, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Papel Fotográfico (0,87)', '1.1.3.1', 'Impresion Gran Formato                                 ', 340, 'Papel Fotográfico (0,87)', 1608, 91, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Pasacalles 0,77 x 1,00 + Palo', '1.1.3.1', 'Impresion Gran Formato                                 ', 343, 'Pasacalles 0,77 x 1,00 + Palo', 1611, 98, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Pasacalles 0,77 x 2,00  + Palo', '1.1.3.1', 'Impresion Gran Formato                                 ', 344, 'Pasacalles 0,77 x 2,00  + Palo', 1612, 99, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Pasacalles 0,77 x 3,00 + Palo', '1.1.3.1', 'Impresion Gran Formato                                 ', 345, 'Pasacalles 0,77 x 3,00 + Palo', 1613, 100, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Roll up aluminio + (Banner Pet mate - 0,78)', '1.1.3.1', 'Impresion Gran Formato                                 ', 334, 'Roll up aluminio + (Banner Pet mate - 0,78)', 1602, 85, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Vinilo brillo  hasta 1,49', '1.1.3.1', 'Impresion Gran Formato                                 ', 339, 'Vinilo brillo  hasta 1,49', 1607, 16, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Vinilo Mate hasta 1,49', '1.1.3.1', 'Impresion Gran Formato                                 ', 308, 'Vinilo Mate hasta 1,49', 1578, 18, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Vinilo Microperforado hasta 1,49 (Reverso Negro)', '1.1.3.1', 'Impresion Gran Formato                                 ', 326, 'Vinilo Microperforado hasta 1,49 (Reverso Negro)', 1594, 73, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Vinilo Vehicular 1,34 (Adhesivo Gris)', '1.1.3.1', 'Impresion Gran Formato                                 ', 329, 'Vinilo Vehicular 1,34 (Adhesivo Gris)', 1597, 76, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Bastidor de hierro', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 428, 'Bastidor de hierro', 1561, 212, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Colocacion de ojales', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 429, 'Colocacion de ojales', 1562, 213, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Corte de vinilo', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 430, 'Corte de vinilo', 1563, 214, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Palos pasacalle', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 431, 'Palos pasacalle', 1564, 215, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Roll up aluminio', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 181, 'Roll up aluminio', 1465, 216, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Roll up plastico', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 406, 'Roll up plastico', 1629, 159, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Roll up PVC', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 432, 'Roll up PVC', 1565, 217, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Soldadura de lona', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 433, 'Soldadura de lona', 1566, 218, 'ECOUV');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Parche adhesivo 100% hilo', '1.1.4.1', 'Bordado                                                ', 424, 'Parche adhesivo 100% hilo', 1630, 232, 'EMB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Parche adhesivo con tafeta', '1.1.4.1', 'Bordado                                                ', 27, 'Parche adhesivo con tafeta', 109, 211, 'EMB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Parche bordado sobre prenda 100% hilo', '1.1.4.1', 'Bordado                                                ', 26, 'Parche bordado sobre prenda 100% hilo', 108, 250, 'EMB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Parche bordado sobre prenda con tafeta', '1.1.4.1', 'Bordado                                                ', 25, 'Parche bordado sobre prenda con tafeta', 107, 249, 'EMB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Bordado', '1.1.4.1', 'Bordado                                                ', 434, 'Bordado', 1567, 65, 'EMB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Estampado', '1.1.5.1', 'Estampado                                              ', 29, 'Estampado', 110, 84, 'EMB');
INSERT INTO dbo.[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES ('Matriz Bordado', '1.1.4.1', 'Bordado                                                ', 435, 'Matriz Bordado', 1568, 248, 'EST');

INSERT INTO dbo.[ConfiguracionPrecios] ([Clave], [Valor], [AreaID], [Descripcion]) VALUES ('BOR_PRECIO_BASE_UYU', '50', 'EMB', 'Precio de las puntadas base');
INSERT INTO dbo.[ConfiguracionPrecios] ([Clave], [Valor], [AreaID], [Descripcion]) VALUES ('BOR_PRECIO_INTERVALO_UYU', '10', 'EMB', 'Precio por cada intervalo extra');
INSERT INTO dbo.[ConfiguracionPrecios] ([Clave], [Valor], [AreaID], [Descripcion]) VALUES ('BOR_PUNTADAS_BASE', '5000', 'EMB', 'Cantidad de puntadas base para bordado');
INSERT INTO dbo.[ConfiguracionPrecios] ([Clave], [Valor], [AreaID], [Descripcion]) VALUES ('BOR_PUNTADAS_INTERVALO', '1000', 'EMB', 'Intervalo de puntadas extras');
INSERT INTO dbo.[ConfiguracionPrecios] ([Clave], [Valor], [AreaID], [Descripcion]) VALUES ('EST_CARGO_FIJO_UYU', '150', 'EST', 'Cargo mínimo fijo si no supera el umbral');
INSERT INTO dbo.[ConfiguracionPrecios] ([Clave], [Valor], [AreaID], [Descripcion]) VALUES ('EST_PRECIO_BAJADA_UYU', '15', 'EST', 'Precio por cada bajada (si supera umbral)');
INSERT INTO dbo.[ConfiguracionPrecios] ([Clave], [Valor], [AreaID], [Descripcion]) VALUES ('EST_UMBRAL_BAJADAS', '10', 'EST', 'Límite de bajadas totales para cargo fijo');

SET IDENTITY_INSERT dbo.[TesoreriaBancos] ON;
GO
INSERT INTO dbo.[TesoreriaBancos] ([IdBanco], [NombreBanco], [Activo]) VALUES (1, 'BROU', 1);
INSERT INTO dbo.[TesoreriaBancos] ([IdBanco], [NombreBanco], [Activo]) VALUES (2, 'Banco Santander', 1);
INSERT INTO dbo.[TesoreriaBancos] ([IdBanco], [NombreBanco], [Activo]) VALUES (3, 'Banco Itaú', 1);
INSERT INTO dbo.[TesoreriaBancos] ([IdBanco], [NombreBanco], [Activo]) VALUES (4, 'Scotiabank', 1);
INSERT INTO dbo.[TesoreriaBancos] ([IdBanco], [NombreBanco], [Activo]) VALUES (5, 'BBVA', 1);
INSERT INTO dbo.[TesoreriaBancos] ([IdBanco], [NombreBanco], [Activo]) VALUES (6, 'HSBC', 1);
INSERT INTO dbo.[TesoreriaBancos] ([IdBanco], [NombreBanco], [Activo]) VALUES (7, 'Bandes', 1);
INSERT INTO dbo.[TesoreriaBancos] ([IdBanco], [NombreBanco], [Activo]) VALUES (8, 'Heritage', 1);
GO
SET IDENTITY_INSERT dbo.[TesoreriaBancos] OFF;
GO

INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('01', 'E-Factura Contado             ', 111, 1, 0, 0, 2, 'VTA_CAJA', 2);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('02', 'E-Factura Credito             ', 111, 1, 1, 0, 2, 'FACTURA', 2);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('03', 'E-Factura Dev.Contado         ', 112, 1, 0, 0, 2, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('04', 'E-Factura Nota De Credito     ', 112, 1, 1, 1, 2, 'NOTA_CREDITO', 3);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('05', 'Recibo                        ', 0, 0, 1, 1, 2, 'RECIBO', 5);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('07', 'E-Ticket Contado              ', 101, 0, 0, 0, 2, 'VTA_CAJA', 1);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('08', 'E-Ticket Credito              ', 101, 0, 1, 0, 2, 'FACTURA', 1);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('09', 'E-Ticket Dev.Contado          ', 102, 0, 0, 0, 2, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('10', 'E-Ticket Nota De Credito      ', 102, 0, 1, 1, 2, 'NOTA_CREDITO', 3);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('100', 'E-Ticket Nota De Credito Admin', 102, 0, 1, 1, 3, 'NOTA_CREDITO', 3);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('101', 'E-Factura Contado Admin       ', 111, 1, 0, 0, 3, 'VTA_CAJA', 2);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('102', 'E-Factura Credito Admin       ', 111, 1, 1, 0, 3, 'FACTURA', 2);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('103', 'E-Factura Dev.Contado Admin   ', 112, 1, 0, 0, 3, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('104', 'E-Factura Nota De Credito Admi', 112, 1, 1, 1, 3, 'NOTA_CREDITO', 3);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('107', 'E-Ticket Contado Admin        ', 101, 0, 0, 0, 3, 'VTA_CAJA', 1);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('108', 'E-Ticket Credito Admin        ', 101, 0, 1, 0, 3, 'FACTURA', 1);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('109', 'E-Ticket Dev.Contado Admin    ', 102, 0, 0, 0, 3, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('11', 'Contado Proveedor             ', 0, 0, 0, 0, 1, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('12', 'Credito Proveedor             ', 0, 0, 1, 0, 1, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('13', 'Recibo Proveedor              ', 0, 0, 1, 1, 1, 'RECIBO', 5);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('14', 'Nota De Credito Proveedor     ', 0, 0, 1, 1, 1, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('15', 'Movimientos De Caja           ', 0, 0, 0, 0, 1, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('15L', 'Movimientos De Caja Local     ', 0, 0, 0, 0, 2, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('16', 'Remitos Clientes              ', 0, 0, 0, 0, 1, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('17', 'Importaciones                 ', 0, 0, 1, 0, 2, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('21', 'Movimientos De Caja Administra', 0, 0, 0, 0, 1, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('30', 'Pedidos                       ', 0, 0, 0, 0, 1, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('31', 'Dev Pedidos                   ', 0, 0, 0, 0, 1, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('40', 'Pedidos Caja                  ', 0, 0, 0, 0, 2, NULL, NULL);
INSERT INTO dbo.[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES ('41', 'Dev Pedidos Caja              ', 0, 0, 0, 0, 2, NULL, NULL);

SET IDENTITY_INSERT dbo.[Config_CuentasEgreso] ON;
GO
INSERT INTO dbo.[Config_CuentasEgreso] ([CegId], [CegTipoEgreso], [CegNombreTipo], [CegCueCodigo], [CegCueNombre], [CegEmoji], [CegOrden], [CegActivo], [CegFechaAlta], [CegUsuarioAlta]) VALUES (1, 'GASTO_OPERATIVO', 'Gasto Operativo', '5.1.03', 'Mantenimiento y Reparaciones', '??', 1, 1, '2026-05-08 09:28:20', NULL);
INSERT INTO dbo.[Config_CuentasEgreso] ([CegId], [CegTipoEgreso], [CegNombreTipo], [CegCueCodigo], [CegCueNombre], [CegEmoji], [CegOrden], [CegActivo], [CegFechaAlta], [CegUsuarioAlta]) VALUES (2, 'SALARIO', 'Salario / Honorarios', '5.1.01', 'Sueldos y Cargas Sociales', '??', 2, 1, '2026-05-08 09:28:20', NULL);
INSERT INTO dbo.[Config_CuentasEgreso] ([CegId], [CegTipoEgreso], [CegNombreTipo], [CegCueCodigo], [CegCueNombre], [CegEmoji], [CegOrden], [CegActivo], [CegFechaAlta], [CegUsuarioAlta]) VALUES (3, 'COMPRA_INSUMO', 'Compra de Insumos', '1.3.1', 'Mercaderías de Reventa', '??', 3, 1, '2026-05-08 09:28:20', NULL);
INSERT INTO dbo.[Config_CuentasEgreso] ([CegId], [CegTipoEgreso], [CegNombreTipo], [CegCueCodigo], [CegCueNombre], [CegEmoji], [CegOrden], [CegActivo], [CegFechaAlta], [CegUsuarioAlta]) VALUES (4, 'PAGO_PROVEEDOR', 'Pago a Proveedor', '2.1.1', 'Acreedores por Compras MN (Proveedores)', '??', 4, 1, '2026-05-08 09:28:20', NULL);
INSERT INTO dbo.[Config_CuentasEgreso] ([CegId], [CegTipoEgreso], [CegNombreTipo], [CegCueCodigo], [CegCueNombre], [CegEmoji], [CegOrden], [CegActivo], [CegFechaAlta], [CegUsuarioAlta]) VALUES (5, 'DEVOLUCION_CLIENTE', 'Devolución a Cliente', '2.3.1', 'Anticipos de Clientes (Prepagos, Rollos)', '??', 5, 1, '2026-05-08 09:28:20', NULL);
INSERT INTO dbo.[Config_CuentasEgreso] ([CegId], [CegTipoEgreso], [CegNombreTipo], [CegCueCodigo], [CegCueNombre], [CegEmoji], [CegOrden], [CegActivo], [CegFechaAlta], [CegUsuarioAlta]) VALUES (6, 'ANTICIPO_EMPLEADO', 'Anticipo / Préstamo', '1.2.2', 'Anticipos al Personal', '??', 6, 1, '2026-05-08 09:28:20', NULL);
INSERT INTO dbo.[Config_CuentasEgreso] ([CegId], [CegTipoEgreso], [CegNombreTipo], [CegCueCodigo], [CegCueNombre], [CegEmoji], [CegOrden], [CegActivo], [CegFechaAlta], [CegUsuarioAlta]) VALUES (7, 'RETIRO_FONDOS', 'Retiro de Fondos', '3.1', 'Capital y Reservas', '??', 7, 1, '2026-05-08 09:28:20', NULL);
GO
SET IDENTITY_INSERT dbo.[Config_CuentasEgreso] OFF;
GO

SET IDENTITY_INSERT dbo.[CondicionesPago] ON;
GO
INSERT INTO dbo.[CondicionesPago] ([CPaIdCondicion], [CPaNombre], [CPaDiasVencimiento], [CPaPermiteCuotas], [CPaCantidadCuotas], [CPaDiasEntreCuotas], [CPaActiva]) VALUES (1, 'Contado', 0, 0, 1, 0, 1);
INSERT INTO dbo.[CondicionesPago] ([CPaIdCondicion], [CPaNombre], [CPaDiasVencimiento], [CPaPermiteCuotas], [CPaCantidadCuotas], [CPaDiasEntreCuotas], [CPaActiva]) VALUES (2, '15 días', 15, 0, 1, 0, 1);
INSERT INTO dbo.[CondicionesPago] ([CPaIdCondicion], [CPaNombre], [CPaDiasVencimiento], [CPaPermiteCuotas], [CPaCantidadCuotas], [CPaDiasEntreCuotas], [CPaActiva]) VALUES (3, '30 días', 30, 0, 1, 0, 1);
INSERT INTO dbo.[CondicionesPago] ([CPaIdCondicion], [CPaNombre], [CPaDiasVencimiento], [CPaPermiteCuotas], [CPaCantidadCuotas], [CPaDiasEntreCuotas], [CPaActiva]) VALUES (4, '30/60 días', 30, 1, 2, 30, 1);
INSERT INTO dbo.[CondicionesPago] ([CPaIdCondicion], [CPaNombre], [CPaDiasVencimiento], [CPaPermiteCuotas], [CPaCantidadCuotas], [CPaDiasEntreCuotas], [CPaActiva]) VALUES (5, '30/60/90 días', 30, 1, 3, 30, 1);
GO
SET IDENTITY_INSERT dbo.[CondicionesPago] OFF;
GO

INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('01', 'E-Factura Contado', 'eFact 111 - Caja 2', 'FC', NULL, -1, 0, 0, 1, 1, 1, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('02', 'E-Factura Credito', 'eFact 111 - Caja 2', 'FC', NULL, -1, 1, 0, 1, 1, 2, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('03', 'E-Factura Dev.Contado', 'eFact 112 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 3, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('04', 'E-Factura Nota De Credito', 'eFact 112 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 4, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('07', 'E-Ticket Contado', 'eFact 101 - Caja 2', 'TK', NULL, -1, 0, 0, 1, 1, 7, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('08', 'E-Ticket Credito', 'eFact 101 - Caja 2', 'TK', NULL, -1, 1, 0, 1, 1, 8, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('09', 'E-Ticket Dev.Contado', 'eFact 102 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 9, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('10', 'E-Ticket Nota De Credito', 'eFact 102 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 10, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('100', 'E-Ticket Nota de Credito Admin', 'eFact 102 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 100, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('101', 'E-Factura Contado Admin', 'eFact 111 - Caja 3', 'FC', NULL, -1, 0, 0, 1, 1, 101, '2026-03-26 13:38:06');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('102', 'E-Factura Credito Admin', 'eFact 111 - Caja 3', 'FC', NULL, -1, 1, 0, 1, 1, 102, '2026-03-26 13:38:06');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('103', 'E-Factura Dev.Contado Admin', 'eFact 112 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 103, '2026-03-26 13:38:06');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('104', 'E-Factura Nota De Credito Admin', 'eFact 112 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 104, '2026-03-26 13:38:06');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('107', 'E-Ticket Contado Admin', 'eFact 101 - Caja 3', 'TK', NULL, -1, 0, 0, 1, 1, 107, '2026-03-26 13:38:06');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('108', 'E-Ticket Credito Admin', 'eFact 101 - Caja 3', 'TK', NULL, -1, 1, 0, 1, 1, 108, '2026-03-26 13:38:06');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('109', 'E-Ticket Dev.Contado Admin', 'eFact 102 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 109, '2026-03-26 13:38:06');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('40', 'Pedidos Caja', 'Interno (0) - Caja 2', 'PE', NULL, -1, 0, 0, 1, 1, 40, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('41', 'Dev Pedidos Caja', 'Interno (0) - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 41, '2026-03-26 13:38:05');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('AJUSTE', 'Ajuste manual', 'Corrección manual de saldo autorizada por administrador.', '', NULL, 0, 0, 0, 0, 1, 60, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('ANTICIPO', 'Anticipo / Pago anticipado', 'Saldo a favor aplicado antes del vencimiento.', '', NULL, 1, 0, 0, 0, 1, 30, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('CIERRE_CICLO', 'Cierre de ciclo semanal', 'Marca de cierre de ciclo. Importe neutro — solo trazabilidad.', '', NULL, 0, 0, 0, 1, 1, 80, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('ENTRADA', 'Entrada de recursos', 'Ingreso al inventario de metros / unidades (compra de plan).', '', NULL, 1, 0, 1, 0, 1, 110, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('ENTREGA', 'Entrega de recursos', 'Salida del inventario al entregar una orden.', '', NULL, -1, 0, 1, 0, 1, 120, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('FACTURA', 'Factura de venta', 'Factura de venta de plan de recursos.', 'FC', 'FACTURA_PLAN', -1, 1, 0, 1, 0, 210, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('FACTURA_CICLO', 'Factura de ciclo semanal', 'Factura emitida al cerrar un ciclo de crédito semanal.', 'FC', 'FACTURA_CICLO', -1, 1, 0, 1, 0, 220, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('NOTA_CREDITO', 'Nota de crédito', 'Crédito a favor por pago en exceso o ajuste.', '', NULL, 1, 0, 0, 0, 1, 50, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('ORDEN', 'Orden ingresada', 'Débito por una orden de plazo. Resta el saldo del cliente.', '', NULL, -1, 1, 0, 0, 1, 10, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('PAGO', 'Pago recibido', 'Acreditación de un pago en efectivo, transferencia, etc.', '', NULL, 1, 0, 0, 0, 1, 20, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('RECIBO', 'Recibo de pago', 'Constancia de cobro inmediato. No genera deuda pendiente.', 'RC', 'RECIBO_PLAN', 1, 0, 0, 1, 0, 230, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('REPOSICION', 'Reposición sin cargo', 'Orden de reposición. No genera débito ni consume recursos.', '', NULL, 0, 0, 0, 0, 1, 70, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('SALDO_INICIAL', 'Saldo inicial', 'Saldo de apertura de una cuenta nueva.', '', NULL, 1, 0, 0, 0, 1, 40, '2026-03-24 22:07:44');
INSERT INTO dbo.[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES ('TICKET', 'Ticket / Comprobante interno', 'Comprobante interno sin efecto contable. Solo trazabilidad.', 'TK', NULL, 0, 0, 0, 0, 0, 240, '2026-03-24 22:07:44');

SET IDENTITY_INSERT dbo.[Cont_PlanCuentas] ON;
GO
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (1, '1', 'ACTIVO', 1, 'ACTIVO', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (2, '1.1', 'Disponibilidades', 2, 'ACTIVO', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (3, '1.1.1', 'Caja Moneda Nacional (UYU)', 3, 'ACTIVO', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (4, '1.1.2', 'Caja Moneda Extranjera (USD)', 3, 'ACTIVO', 'USD', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (5, '1.1.3', 'Bancos Moneda Nacional (UYU)', 3, 'ACTIVO', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (6, '1.1.4', 'Bancos Moneda Extranjera (USD)', 3, 'ACTIVO', 'USD', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (7, '1.2', 'Créditos (Cuentas por Cobrar)', 2, 'ACTIVO', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (8, '1.2.1', 'Deudores por Ventas MN (Clientes)', 3, 'ACTIVO', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (9, '1.2.2', 'Deudores por Ventas ME (Clientes USD)', 3, 'ACTIVO', 'USD', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (10, '1.2.3', 'Tarjetas de Crédito a Cobrar', 3, 'ACTIVO', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (11, '1.2.4', 'IVA Compras (Crédito Fiscal)', 3, 'ACTIVO', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (12, '1.3', 'Inventarios', 2, 'ACTIVO', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (13, '1.3.1', 'Mercaderías de Reventa', 3, 'ACTIVO', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (14, '2', 'PASIVO', 1, 'PASIVO', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (15, '2.1', 'Deudas Comerciales', 2, 'PASIVO', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (16, '2.1.1', 'Acreedores por Compras MN (Proveedores)', 3, 'PASIVO', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (17, '2.1.2', 'Acreedores por Compras ME (Proveedores USD)', 3, 'PASIVO', 'USD', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (18, '2.2', 'Deudas Fiscales y Sociales', 2, 'PASIVO', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (19, '2.2.1', 'IVA Ventas Tasa Básica (22%)', 3, 'PASIVO', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (20, '2.2.2', 'IVA Ventas Tasa Mínima (10%)', 3, 'PASIVO', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (21, '2.3', 'Ingresos Diferidos (Anticipos)', 2, 'PASIVO', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (22, '2.3.1', 'Anticipos de Clientes (Prepagos, Rollos)', 3, 'PASIVO', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (23, '3', 'PATRIMONIO', 1, 'PATRIMONIO', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (24, '3.1', 'Capital y Reservas', 2, 'PATRIMONIO', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (25, '3.2', 'Resultados Acumulados', 2, 'PATRIMONIO', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (26, '4', 'INGRESOS', 1, 'GANANCIA', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (27, '4.1', 'Ingresos Operativos', 2, 'GANANCIA', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (28, '4.1.1', 'Ventas Servicios / Mostrador', 3, 'GANANCIA', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (29, '4.1.2', 'Ventas de Productos', 3, 'GANANCIA', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (30, '4.2', 'Ingresos No Operativos', 2, 'GANANCIA', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (31, '4.2.1', 'Ganancia por Diferencia de Cambio', 3, 'GANANCIA', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (32, '5', 'EGRESOS', 1, 'PERDIDA', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (33, '5.1', 'Gastos Operativos y Administrativos', 2, 'PERDIDA', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (34, '5.1.01', 'Sueldos y Cargas Sociales', 3, 'PERDIDA', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (35, '5.1.02', 'Gastos de Papelería y Oficina', 3, 'PERDIDA', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (36, '5.1.03', 'Mantenimiento y Reparaciones', 3, 'PERDIDA', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (37, '5.1.04', 'Servicios Profesionales', 3, 'PERDIDA', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (38, '5.1.05', 'Consumos Generales (Luz, Agua, Antel)', 3, 'PERDIDA', 'UYU', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (39, '5.2', 'Gastos Financieros', 2, 'PERDIDA', 'AMBAS', 0, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (40, '5.2.01', 'Pérdida por Diferencia de Cambio', 3, 'PERDIDA', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (41, '5.2.02', 'Comisiones y Gastos Bancarios', 3, 'PERDIDA', 'AMBAS', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (42, '1.1.5', 'Valores a Depositar (Cheques)', 3, 'ACTIVO', '1', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (43, '2.1.3', 'Cheques Diferidos a Pagar', 3, 'PASIVO', '1', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (44, '5.1.05.01', 'Agua (OSE)', 4, 'PERDIDA', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (45, '5.1.05.02', 'Luz (UTE)', 4, 'PERDIDA', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (46, '5.1.05.03', 'Internet (Antel)', 4, 'PERDIDA', 'UYU', 1, 1);
INSERT INTO dbo.[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES (47, '1.3.2', 'PEDIDOS EN DEPOSITO', 3, 'ACTIVO', 'AMBAS', 1, 1);
GO
SET IDENTITY_INSERT dbo.[Cont_PlanCuentas] OFF;
GO

INSERT INTO dbo.[Cont_TiposTransaccion] ([TrtCodigo], [TrtNombre], [TrtDescripcion], [TrtUsaEntidad], [TrtEstado]) VALUES ('ASIENTO_MAN', 'Asiento Manual', 'Asiento libre sin estructura fija.', 0, 1);
INSERT INTO dbo.[Cont_TiposTransaccion] ([TrtCodigo], [TrtNombre], [TrtDescripcion], [TrtUsaEntidad], [TrtEstado]) VALUES ('COBRO_CTA', 'Cobro de Cuenta', 'Pago recibido y cargado a favor del cliente.', 1, 1);
INSERT INTO dbo.[Cont_TiposTransaccion] ([TrtCodigo], [TrtNombre], [TrtDescripcion], [TrtUsaEntidad], [TrtEstado]) VALUES ('VTA_CAJA', 'Venta en Caja', 'Venta realizada desde el punto de venta directo.', 1, 1);
INSERT INTO dbo.[Cont_TiposTransaccion] ([TrtCodigo], [TrtNombre], [TrtDescripcion], [TrtUsaEntidad], [TrtEstado]) VALUES ('TES_CHEQUE_REC', 'Recibir Cheque', 'Ingreso Cheque de Tercero (A Cartera)', 1, 1);
INSERT INTO dbo.[Cont_TiposTransaccion] ([TrtCodigo], [TrtNombre], [TrtDescripcion], [TrtUsaEntidad], [TrtEstado]) VALUES ('TES_CHEQUE_DEP', 'Depósito Cheque', 'Depósito Bancario de Cheque', 1, 1);
INSERT INTO dbo.[Cont_TiposTransaccion] ([TrtCodigo], [TrtNombre], [TrtDescripcion], [TrtUsaEntidad], [TrtEstado]) VALUES ('TES_CHEQUE_END', 'Endoso Cheque', 'Endoso de Cheque a Proveedor', 1, 1);
INSERT INTO dbo.[Cont_TiposTransaccion] ([TrtCodigo], [TrtNombre], [TrtDescripcion], [TrtUsaEntidad], [TrtEstado]) VALUES ('TES_CHEQUE_EMI', 'Emitir Cheque', 'Emisión Cheque Propio (A Proveedor)', 1, 1);

INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('01', 'E-Factura Contado', 'E-Factura Contado Caja 2', 'FC', NULL, -1, 0, 0, 1, 1, 1, 1, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('02', 'E-Factura Credito', 'eFact 111 - Caja 2', 'FC', NULL, -1, 1, 0, 1, 1, 1, 2, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('03', 'E-Factura Dev.Contado', 'eFact 112 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 1, 3, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('04', 'E-Factura Nota De Credito', 'eFact 112 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 1, 4, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('07', 'E-Ticket Contado', 'eFact 101 - Caja 2', 'TK', NULL, -1, 0, 0, 1, 1, 1, 7, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('08', 'E-Ticket Credito', 'eFact 101 - Caja 2', 'TK', NULL, -1, 1, 0, 1, 1, 1, 8, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('09', 'E-Ticket Dev.Contado', 'eFact 102 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 1, 9, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('10', 'E-Ticket Nota De Credito', 'eFact 102 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 1, 10, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('100', 'E-Ticket Nota de Credito Admin', 'eFact 102 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 0, 100, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('101', 'E-Factura Contado Admin', 'eFact 111 - Caja 3', 'FC', NULL, -1, 0, 0, 1, 1, 0, 101, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('102', 'E-Factura Credito Admin', 'eFact 111 - Caja 3', 'FC', NULL, -1, 1, 0, 1, 1, 0, 102, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('103', 'E-Factura Dev.Contado Admin', 'eFact 112 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 0, 103, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('104', 'E-Factura Nota De Credito Admin', 'eFact 112 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 0, 104, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('107', 'E-Ticket Contado Admin', 'eFact 101 - Caja 3', 'TK', NULL, -1, 0, 0, 1, 1, 0, 107, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('108', 'E-Ticket Credito Admin', 'eFact 101 - Caja 3', 'TK', NULL, -1, 1, 0, 1, 1, 0, 108, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('109', 'E-Ticket Dev.Contado Admin', 'eFact 102 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 0, 109, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('40', 'Pedidos Caja', 'Interno (0) - Caja 2', 'PE', NULL, -1, 0, 0, 1, 1, 0, 40, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('41', 'Dev Pedidos Caja', 'Interno (0) - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 0, 41, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('AJUSTE', 'Ajuste manual', 'Corrección manual de saldo autorizada por administrador.', '', NULL, 0, 0, 0, 0, 0, 1, 60, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('ANTICIPO', 'Anticipo / Pago anticipado', 'Saldo a favor aplicado antes del vencimiento.', '', NULL, 1, 0, 0, 1, 0, 1, 30, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('ASIENTO_MAN', 'Asiento Manual', 'Asiento libre sin estructura fija.', NULL, NULL, 0, 0, 0, 0, 0, 1, 220, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('CIERRE_CICLO', 'Cierre de ciclo semanal', 'Marca de cierre de ciclo. Importe neutro — solo trazabilidad.', NULL, NULL, 0, 0, 0, 0, 1, 1, 80, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('COBRO_CTA', 'Cobro de Cuenta', 'Pago recibido y cargado a favor del cliente.', NULL, NULL, 1, 0, 0, 1, 0, 1, 210, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('ENTRADA', 'Entrada de recursos', 'Ingreso al inventario de metros / unidades (compra de plan).', '', NULL, 1, 0, 1, 1, 0, 1, 110, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('ENTREGA', 'Entrega de recursos', 'Salida del inventario al entregar una orden.', '', NULL, -1, 0, 1, 1, 0, 1, 120, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('FACTURA', 'Factura de venta', 'Factura de venta de plan de recursos.', 'FC', 'FACTURA_PLAN', -1, 1, 0, 1, 1, 0, 210, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('FACTURA_CICLO', 'Factura de ciclo semanal', 'Factura emitida al cerrar un ciclo de crédito semanal.', 'FC', 'FACTURA_CICLO', -1, 1, 0, 1, 1, 0, 220, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('NOTA_CREDITO', 'Nota de crédito', 'Crédito a favor por pago en exceso o ajuste.', '', NULL, 1, 0, 0, 1, 0, 1, 50, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('ORDEN', 'Orden ingresada', 'Débito por una orden de plazo. Resta el saldo del cliente.', NULL, NULL, -1, 1, 0, 1, 0, 1, 10, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('PAGO', 'Pago recibido', 'Acreditación de un pago en efectivo, transferencia, etc.', '', NULL, 1, 0, 0, 1, 0, 1, 20, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('RECIBO', 'Recibo de pago', 'Constancia de cobro inmediato. No genera deuda pendiente.', 'RC', 'RECIBO_PLAN', 1, 0, 0, 1, 1, 0, 230, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('REPOSICION', 'Reposición sin cargo', 'Orden de reposición. No genera débito ni consume recursos.', '', NULL, 0, 0, 0, 0, 0, 1, 70, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('SALDO_INICIAL', 'Saldo inicial', 'Saldo de apertura de una cuenta nueva.', '', NULL, 1, 0, 0, 1, 0, 1, 40, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('TICKET', 'Ticket / Comprobante interno', 'Comprobante interno sin efecto contable. Solo trazabilidad.', 'TK', NULL, 0, 0, 0, 0, 0, 0, 240, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('VTA_CAJA', 'Venta en Caja', 'Venta realizada desde el punto de venta directo.', NULL, NULL, -1, 1, 0, 1, 0, 1, 200, '2026-03-30 23:29:47');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('TES_CHEQUE_REC', 'Recibir Cheque Tercero', NULL, 'CHQR', 'TESORERIA', 1, 0, 0, 1, 0, 1, 100, '2026-04-23 01:14:27');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('TES_CHEQUE_DEP', 'Depositar Cheque Tercero', NULL, 'CHQD', 'TESORERIA', 0, 0, 0, 1, 0, 1, 100, '2026-04-23 01:14:27');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('TES_CHEQUE_END', 'Endosar Cheque Tercero', NULL, 'CHQE', 'TESORERIA', -1, 0, 0, 1, 0, 1, 100, '2026-04-23 01:14:27');
INSERT INTO dbo.[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES ('TES_CHEQUE_EMI', 'Emitir Cheque Propio', NULL, 'CHQP', 'TESORERIA', -1, 0, 0, 1, 0, 1, 100, '2026-04-23 01:14:27');

SET IDENTITY_INSERT dbo.[Cont_ReglasEventos] ON;
GO
INSERT INTO dbo.[Cont_ReglasEventos] ([RegId], [RegCodigo], [RegNombre], [RegCuentaDebe], [RegCuentaHaber], [RegObservacion]) VALUES (1, 'VENTA_CONTADO_UYU', 'Venta Contado en Efectivo (Pesos)', NULL, NULL, NULL);
INSERT INTO dbo.[Cont_ReglasEventos] ([RegId], [RegCodigo], [RegNombre], [RegCuentaDebe], [RegCuentaHaber], [RegObservacion]) VALUES (2, 'VENTA_CONTADO_USD', 'Venta Contado en Efectivo (Dólares)', NULL, NULL, NULL);
INSERT INTO dbo.[Cont_ReglasEventos] ([RegId], [RegCodigo], [RegNombre], [RegCuentaDebe], [RegCuentaHaber], [RegObservacion]) VALUES (3, 'VENTA_CREDITO_UYU', 'Venta a Crédito en Cuenta Corriente (Pesos)', NULL, NULL, NULL);
INSERT INTO dbo.[Cont_ReglasEventos] ([RegId], [RegCodigo], [RegNombre], [RegCuentaDebe], [RegCuentaHaber], [RegObservacion]) VALUES (4, 'COBRO_DEUDA_UYU', 'Cobro de Deuda Clientes en Efectivo (Pesos)', NULL, NULL, NULL);
INSERT INTO dbo.[Cont_ReglasEventos] ([RegId], [RegCodigo], [RegNombre], [RegCuentaDebe], [RegCuentaHaber], [RegObservacion]) VALUES (5, 'CONSUMO_ANTICIPO', 'Consumo de Rollo Adelantado / Prepago', NULL, NULL, NULL);
INSERT INTO dbo.[Cont_ReglasEventos] ([RegId], [RegCodigo], [RegNombre], [RegCuentaDebe], [RegCuentaHaber], [RegObservacion]) VALUES (6, 'DIFERENCIA_CAMBIO_G', 'Asiento Automático: Ganancia Dif. Cambio', NULL, NULL, NULL);
INSERT INTO dbo.[Cont_ReglasEventos] ([RegId], [RegCodigo], [RegNombre], [RegCuentaDebe], [RegCuentaHaber], [RegObservacion]) VALUES (7, 'DIFERENCIA_CAMBIO_P', 'Asiento Automático: Pérdida Dif. Cambio', NULL, NULL, NULL);
GO
SET IDENTITY_INSERT dbo.[Cont_ReglasEventos] OFF;
GO

SET IDENTITY_INSERT dbo.[Cont_ReglasContables] ON;
GO
INSERT INTO dbo.[Cont_ReglasContables] ([RgcId], [TrtCodigo], [CueCodigo], [RgcNaturaleza], [RgcFilaFormula], [RgcOrden]) VALUES (1, 'VTA_CAJA', 'META_CLIENTE', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasContables] ([RgcId], [TrtCodigo], [CueCodigo], [RgcNaturaleza], [RgcFilaFormula], [RgcOrden]) VALUES (2, 'VTA_CAJA', '4.1.1.01', 'HABER', 'NETO', 20);
INSERT INTO dbo.[Cont_ReglasContables] ([RgcId], [TrtCodigo], [CueCodigo], [RgcNaturaleza], [RgcFilaFormula], [RgcOrden]) VALUES (3, 'VTA_CAJA', '2.1.2.01', 'HABER', 'IVA', 30);
INSERT INTO dbo.[Cont_ReglasContables] ([RgcId], [TrtCodigo], [CueCodigo], [RgcNaturaleza], [RgcFilaFormula], [RgcOrden]) VALUES (4, 'COBRO_CTA', '1.1.1.01', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasContables] ([RgcId], [TrtCodigo], [CueCodigo], [RgcNaturaleza], [RgcFilaFormula], [RgcOrden]) VALUES (5, 'COBRO_CTA', 'META_CLIENTE', 'HABER', 'TOTAL', 20);
GO
SET IDENTITY_INSERT dbo.[Cont_ReglasContables] OFF;
GO

SET IDENTITY_INSERT dbo.[Cont_ReglasAsiento] ON;
GO
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (15, 'ANTICIPO', 'META_CAJA', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (16, 'ANTICIPO', 'META_CLIENTE', 'HABER', 'TOTAL', 20);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (17, 'NOTA_CREDITO', 'META_CLIENTE', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (18, 'NOTA_CREDITO', '4.1.1.01', 'HABER', 'TOTAL', 20);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (19, 'PAGO', 'META_CAJA', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (20, 'PAGO', 'META_CLIENTE', 'HABER', 'TOTAL', 20);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1030, 'ENTRADA', 'META_CAJA', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1031, 'ENTRADA', '2.3.1', 'HABER', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1032, 'ENTREGA', '2.3.1', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1033, 'ENTREGA', '4.1.1', 'HABER', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1088, '01', 'META_CLIENTE', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1089, '01', '4.1.1', 'HABER', 'NETO', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1090, '01', '2.2.1', 'HABER', 'IVA', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1040, '02', 'META_CLIENTE', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1041, '02', '4.1.1', 'HABER', 'NETO', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1042, '02', '2.2.1', 'HABER', 'IVA', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1043, '07', 'META_CLIENTE', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1044, '07', '4.1.1', 'HABER', 'NETO', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1045, '07', '2.2.1', 'HABER', 'IVA', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1046, '08', 'META_CLIENTE', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1047, '08', '4.1.1', 'HABER', 'NETO', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1048, '08', '2.2.1', 'HABER', 'IVA', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1049, 'COBRO_CTA', 'META_CAJA', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1050, 'COBRO_CTA', 'META_CLIENTE', 'HABER', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1051, 'RECIBO', 'META_CAJA', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1052, 'RECIBO', 'META_CLIENTE', 'HABER', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1053, 'FACTURA_CICLO', 'META_CLIENTE', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1054, 'FACTURA_CICLO', '4.1.1', 'HABER', 'NETO', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1055, 'FACTURA_CICLO', '2.2.1', 'HABER', 'IVA', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1056, '03', '5.1.1', 'DEBE', 'NETO', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1057, '03', '2.2.1', 'DEBE', 'IVA', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1058, '03', 'META_CLIENTE', 'HABER', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1059, '09', '5.1.1', 'DEBE', 'NETO', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1060, '09', '2.2.1', 'DEBE', 'IVA', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1061, '09', 'META_CLIENTE', 'HABER', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1071, 'ORDEN', 'META_CLIENTE', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1072, 'ORDEN', '4.1.1', 'HABER', 'NETO', 20);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1073, 'ORDEN', '2.2.1', 'HABER', 'IVA', 30);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1077, 'VTA_CAJA', 'META_CAJA', 'DEBE', 'TOTAL', 10);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1078, 'VTA_CAJA', '4.1.1', 'HABER', 'NETO', 20);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1079, 'VTA_CAJA', '2.2.1', 'HABER', 'IVA', 30);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1080, 'TES_CHEQUE_REC', '1.1.5', 'DEBE', 'TOTAL', 1);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1081, 'TES_CHEQUE_REC', 'META_CLIENTE', 'HABER', 'TOTAL', 2);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1082, 'TES_CHEQUE_DEP', '1.1.3', 'DEBE', 'TOTAL', 1);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1083, 'TES_CHEQUE_DEP', '1.1.5', 'HABER', 'TOTAL', 2);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1084, 'TES_CHEQUE_END', '2.1.1', 'DEBE', 'TOTAL', 1);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1085, 'TES_CHEQUE_END', '1.1.5', 'HABER', 'TOTAL', 2);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1086, 'TES_CHEQUE_EMI', '2.1.1', 'DEBE', 'TOTAL', 1);
INSERT INTO dbo.[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES (1087, 'TES_CHEQUE_EMI', '2.1.3', 'HABER', 'TOTAL', 2);
GO
SET IDENTITY_INSERT dbo.[Cont_ReglasAsiento] OFF;
GO

