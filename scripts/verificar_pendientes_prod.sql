/* ============================================================================
   verificar_pendientes_prod.sql — SOLO LECTURA (17-sep-2026)
   ----------------------------------------------------------------------------
   Correr en PRODUCCIÓN (SecureAppDB) desde SSMS: File → Open → Ejecutar.
   No modifica nada. Dice, paquete por paquete, qué objeto de base YA ESTÁ y
   cuál FALTA, para saber qué scripts SQL hay que correr antes del deploy.

   Columnas: Paquete | Script que lo crea | Objeto | Estado (OK / FALTA)
   Al final: resumen por script (cuántos objetos faltan de cada uno).
   ============================================================================ */
SET NOCOUNT ON;

DECLARE @c TABLE (Orden INT IDENTITY(1,1), Paquete NVARCHAR(60), Script NVARCHAR(120), Objeto NVARCHAR(200), Existe BIT);

-- ─── helpers inline ─────────────────────────────────────────────────────────
-- columna:  COL_LENGTH('dbo.Tabla','Col') IS NOT NULL
-- tabla/vista/SP: OBJECT_ID('dbo.X','U'|'V'|'P') IS NOT NULL
-- índice: EXISTS (sys.indexes)
-- config: EXISTS (ConfiguracionGlobal)
-- menú:   EXISTS (Modulos)

/* ═══ 1. MOTOR DE PRECIOS — desglose hasta la factura (código sin commitear, 11-sep) ═══ */
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_EtiquetaFactura_PerfilesPrecios.sql','PerfilesPrecios.EtiquetaFactura', IIF(COL_LENGTH('dbo.PerfilesPrecios','EtiquetaFactura') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_recargos_DocumentosContablesDetalle.sql','DocumentosContablesDetalle.DcdDescuentoPct',   IIF(COL_LENGTH('dbo.DocumentosContablesDetalle','DcdDescuentoPct') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_recargos_DocumentosContablesDetalle.sql','DocumentosContablesDetalle.DcdDescuentoOrigen',IIF(COL_LENGTH('dbo.DocumentosContablesDetalle','DcdDescuentoOrigen') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_recargos_DocumentosContablesDetalle.sql','DocumentosContablesDetalle.DcdRecargoPct',     IIF(COL_LENGTH('dbo.DocumentosContablesDetalle','DcdRecargoPct') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_recargos_DocumentosContablesDetalle.sql','DocumentosContablesDetalle.DcdTotalRecargos',  IIF(COL_LENGTH('dbo.DocumentosContablesDetalle','DcdTotalRecargos') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_recargos_DocumentosContablesDetalle.sql','DocumentosContablesDetalle.DcdRecargoStr',     IIF(COL_LENGTH('dbo.DocumentosContablesDetalle','DcdRecargoStr') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_recargos_DocumentosContablesDetalle.sql','DocumentosContablesDetalle.DcdPrecioUnitario DECIMAL(18,4)',
    IIF(EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContablesDetalle' AND COLUMN_NAME='DcdPrecioUnitario' AND NUMERIC_SCALE=4),1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.PrecioLista',     IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','PrecioLista') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.DescuentoTipo',   IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','DescuentoTipo') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.DescuentoPct',    IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','DescuentoPct') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.DescuentoImporte',IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','DescuentoImporte') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.DescuentoOrigen', IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','DescuentoOrigen') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.DescuentoPerfilId',IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','DescuentoPerfilId') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.DescuentoReglaId', IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','DescuentoReglaId') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.RecargoPct',      IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','RecargoPct') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.RecargoImporte',  IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','RecargoImporte') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.RecargoOrigen',   IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','RecargoOrigen') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','PedidosCobranzaDetalle.DesgloseJSON',    IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','DesgloseJSON') IS NOT NULL,1,0));
INSERT @c VALUES ('1 Motor precios','backend/scripts/add_desglose_PedidosCobranzaDetalle.sql','CHECK CK_PedidosCobranzaDetalle_DescuentoTipo', IIF(EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_PedidosCobranzaDetalle_DescuentoTipo'),1,0));

/* ═══ 2. BENEFICIOS PACTADOS (código sin commitear) ═══ */
INSERT @c VALUES ('2 Beneficios','scripts/add_beneficios.sql','PerfilesPrecios.EsBeneficio',              IIF(COL_LENGTH('dbo.PerfilesPrecios','EsBeneficio') IS NOT NULL,1,0));
INSERT @c VALUES ('2 Beneficios','scripts/add_beneficios.sql','tabla Beneficios',                         IIF(OBJECT_ID('dbo.Beneficios','U') IS NOT NULL,1,0));
INSERT @c VALUES ('2 Beneficios','scripts/add_beneficios.sql','tabla BeneficiosCliente',                  IIF(OBJECT_ID('dbo.BeneficiosCliente','U') IS NOT NULL,1,0));
INSERT @c VALUES ('2 Beneficios','scripts/add_beneficios.sql','tabla BeneficiosAprobadores',              IIF(OBJECT_ID('dbo.BeneficiosAprobadores','U') IS NOT NULL,1,0));
INSERT @c VALUES ('2 Beneficios','scripts/add_beneficios.sql','Ordenes.BclIdBeneficioCliente',            IIF(COL_LENGTH('dbo.Ordenes','BclIdBeneficioCliente') IS NOT NULL,1,0));
INSERT @c VALUES ('2 Beneficios','scripts/add_beneficios.sql','PedidosCobranzaDetalle.BclIdBeneficioCliente', IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','BclIdBeneficioCliente') IS NOT NULL,1,0));
INSERT @c VALUES ('2 Beneficios','scripts/add_beneficios.sql','Config BENEFICIOS_ACTIVOS',                IIF(EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave='BENEFICIOS_ACTIVOS'),1,0));
INSERT @c VALUES ('2 Beneficios','scripts/add_beneficios.sql (menú, correr CON el deploy)','Menú /beneficios/predefinidos', IIF(EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta='/beneficios/predefinidos'),1,0));
INSERT @c VALUES ('2 Beneficios','scripts/add_beneficios.sql (menú, correr CON el deploy)','Menú /beneficios/pactos',       IIF(EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta='/beneficios/pactos'),1,0));

/* ═══ 3. FALLAS / FALTANTES / PARCIALES — Spec 39 (código sin commitear) ═══ */
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','tabla Logistica_EnvioOrdenes', IIF(OBJECT_ID('dbo.Logistica_EnvioOrdenes','U') IS NOT NULL,1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','tabla Reposiciones',           IIF(OBJECT_ID('dbo.Reposiciones','U') IS NOT NULL,1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','tabla SolicitudesInsumo',      IIF(OBJECT_ID('dbo.SolicitudesInsumo','U') IS NOT NULL,1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','Ordenes.OrdenOrigenID',        IIF(COL_LENGTH('dbo.Ordenes','OrdenOrigenID') IS NOT NULL,1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','Ordenes.EstadoEnvio',          IIF(COL_LENGTH('dbo.Ordenes','EstadoEnvio') IS NOT NULL,1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','Ordenes.CantidadEsperada',     IIF(COL_LENGTH('dbo.Ordenes','CantidadEsperada') IS NOT NULL,1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','vista vw_LibroEntregas',       IIF(OBJECT_ID('dbo.vw_LibroEntregas','V') IS NOT NULL,1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','Config AREAS_CADENA_REPOSICION',   IIF(EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave='AREAS_CADENA_REPOSICION'),1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','Config PLAZO_SOLICITUD_INSUMO_DIAS',IIF(EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave='PLAZO_SOLICITUD_INSUMO_DIAS'),1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales.sql','Config AREAS_FALLA_BANDEJA',       IIF(EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave='AREAS_FALLA_BANDEJA'),1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_control_parcial.sql','Ordenes.CantidadAprobadaBultos', IIF(COL_LENGTH('dbo.Ordenes','CantidadAprobadaBultos') IS NOT NULL,1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/fallas_faltantes_parciales_menu.sql (correr CON el deploy)','Menú /atencion-cliente/solicitudes-insumo', IIF(EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta='/atencion-cliente/solicitudes-insumo'),1,0));
INSERT @c VALUES ('3 Fallas Spec39','docs/migrations/areas_cadena_reposicion_agregar_pro.sql (DESPUÉS del deploy)','AREAS_CADENA_REPOSICION contiene PRO',
    IIF(EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave='AREAS_CADENA_REPOSICION' AND ','+ISNULL(Valor,'')+',' LIKE '%,PRO,%'),1,0));

/* ═══ 4. MOLDES ESCALADOS + NOMENCLADOR DE PIEZAS (código sin commitear) ═══ */
INSERT @c VALUES ('4 Moldes','docs/migrations/configurador_nomenclador_piezas.sql','tabla PiezasPrenda',       IIF(OBJECT_ID('dbo.PiezasPrenda','U') IS NOT NULL,1,0));
INSERT @c VALUES ('4 Moldes','docs/migrations/moldes_escalados.sql','tabla CurvasTalle',                       IIF(OBJECT_ID('dbo.CurvasTalle','U') IS NOT NULL,1,0));
INSERT @c VALUES ('4 Moldes','docs/migrations/moldes_escalados.sql','tabla CurvaTalleItems',                   IIF(OBJECT_ID('dbo.CurvaTalleItems','U') IS NOT NULL,1,0));
INSERT @c VALUES ('4 Moldes','docs/migrations/moldes_escalados.sql','tabla Moldes',                            IIF(OBJECT_ID('dbo.Moldes','U') IS NOT NULL,1,0));
INSERT @c VALUES ('4 Moldes','docs/migrations/moldes_escalados.sql','tabla MoldePiezas',                       IIF(OBJECT_ID('dbo.MoldePiezas','U') IS NOT NULL,1,0));
INSERT @c VALUES ('4 Moldes','docs/migrations/moldes_escalados.sql','tabla MoldeNidoTalles',                   IIF(OBJECT_ID('dbo.MoldeNidoTalles','U') IS NOT NULL,1,0));
INSERT @c VALUES ('4 Moldes','docs/migrations/moldes_escalados.sql','ProductoVentaConfig.MoldeID',             IIF(COL_LENGTH('dbo.ProductoVentaConfig','MoldeID') IS NOT NULL,1,0));
INSERT @c VALUES ('4 Moldes','backend/scripts/menu_moldes.sql (correr CON el deploy)','Menú /moldes',           IIF(EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta='/moldes'),1,0));

/* ═══ 5. FACTURAR POR ÁREA / VENTA PERSONALIZADA / PRENDAS ═══ */
INSERT @c VALUES ('5 Varios','docs/migrations/pedidoscobranzadetalle_esfacturable.sql','PedidosCobranzaDetalle.EsFacturable', IIF(COL_LENGTH('dbo.PedidosCobranzaDetalle','EsFacturable') IS NOT NULL,1,0));
INSERT @c VALUES ('5 Varios','backend/scripts/create_articulo_prenda_personalizada.sql','Artículo PPERS',        IIF(EXISTS (SELECT 1 FROM dbo.Articulos WHERE CodArticulo='PPERS'),1,0));
INSERT @c VALUES ('5 Varios','docs/migrations/bordado_origen_prendas.sql','tabla InventarioPrendasCliente',     IIF(OBJECT_ID('dbo.InventarioPrendasCliente','U') IS NOT NULL,1,0));
INSERT @c VALUES ('5 Varios','docs/migrations/bordado_origen_prendas.sql','Ordenes.PrendaClienteID',            IIF(COL_LENGTH('dbo.Ordenes','PrendaClienteID') IS NOT NULL,1,0));
INSERT @c VALUES ('5 Varios','docs/migrations/fix_vw_prendas_cliente_usadas.sql (DESPUÉS de fallas_faltantes_parciales.sql)','vw_PrendasClienteDisponibles usa CantidadEsperada',
    IIF(OBJECT_DEFINITION(OBJECT_ID('dbo.vw_PrendasClienteDisponibles','V')) LIKE '%CantidadEsperada%',1,0));
INSERT @c VALUES ('5 Varios','docs/migrations/fix_productos_terminados_portal.sql','Fichas ProductosTerminados del portal (19 códigos)',
    IIF((SELECT COUNT(*) FROM dbo.ProductosTerminados WHERE CodArticulo IN ('1610','1620','1625','500','1626','144','131','1616','127','1617','1623','1618','1624','1619','1611','1612','1613','1602','499')) = 19,1,0));

/* ═══ 6. STORED PROCEDURES — cuidado con el ORDEN ═══ */
INSERT @c VALUES ('6 SPs','scripts/PROD_alter_SP_RegistrarMovimiento_y_recalculo.sql (ya incluye @MovFecha; NO correr después add_MovFecha)','SP_RegistrarMovimiento: ORDEN no toca CueSaldoActual',
    IIF(OBJECT_DEFINITION(OBJECT_ID('dbo.SP_RegistrarMovimiento','P')) LIKE '%ORDEN_ANTICIPO%',1,0));
INSERT @c VALUES ('6 SPs','backend/scripts/add_MovFecha_SP_RegistrarMovimiento.sql (o el de arriba)','SP_RegistrarMovimiento tiene @MovFecha',
    IIF(OBJECT_DEFINITION(OBJECT_ID('dbo.SP_RegistrarMovimiento','P')) LIKE '%@MovFecha%',1,0));
INSERT @c VALUES ('6 SPs','scripts/PROD_alter_SP_RegistrarMovimiento_y_recalculo.sql PASO 2','tabla AuditRecalculoSaldo_20260905 (recalculo hecho)',
    IIF(OBJECT_ID('dbo.AuditRecalculoSaldo_20260905','U') IS NOT NULL,1,0));
INSERT @c VALUES ('6 SPs','backend/scripts/consolidar_capacidad_planta.sql','tabla ConfigHorarioLaboral',       IIF(OBJECT_ID('dbo.ConfigHorarioLaboral','U') IS NOT NULL,1,0));
INSERT @c VALUES ('6 SPs','backend/scripts/fix_sp_calcularfechaentrega_findes.sql (necesita ConfigHorarioLaboral)','sp_CalcularFechaEntrega revisa fin de semana al final',
    IIF(OBJECT_DEFINITION(OBJECT_ID('dbo.sp_CalcularFechaEntrega','P')) LIKE '%DiaSemanaISOFinal%',1,0));
INSERT @c VALUES ('6 SPs','backend/scripts/add_SP_EstamparAreaLineas.sql','SP_EstamparAreaLineasDocumento',       IIF(OBJECT_ID('dbo.SP_EstamparAreaLineasDocumento','P') IS NOT NULL,1,0));

/* ═══ 7. PENDIENTES VIEJOS (código ya commiteado, según mis notas faltaba el SQL en prod) ═══ */
-- Billetera prepaga (DEPLOY_BILLETERA_PREPAGO.md)
INSERT @c VALUES ('7a Billetera','scripts/add_billetera_cuentas.sql','CuentasCliente.CueEsPrincipal',      IIF(COL_LENGTH('dbo.CuentasCliente','CueEsPrincipal') IS NOT NULL,1,0));
INSERT @c VALUES ('7a Billetera','scripts/add_billetera_cuentas.sql','CuentasCliente.CueAutoConsumo',      IIF(COL_LENGTH('dbo.CuentasCliente','CueAutoConsumo') IS NOT NULL,1,0));
INSERT @c VALUES ('7a Billetera','scripts/add_billetera_cuentas.sql','CuentasCliente.CueModalidadFiscal',  IIF(COL_LENGTH('dbo.CuentasCliente','CueModalidadFiscal') IS NOT NULL,1,0));
INSERT @c VALUES ('7a Billetera','scripts/add_billetera_cuentas.sql','índice UX_CuentasCliente_PrincipalPorTipo', IIF(EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_CuentasCliente_PrincipalPorTipo'),1,0));
INSERT @c VALUES ('7a Billetera','scripts/add_billetera_cuentas.sql','tabla CuentasClienteArticulosPermitidos', IIF(OBJECT_ID('dbo.CuentasClienteArticulosPermitidos','U') IS NOT NULL,1,0));
INSERT @c VALUES ('7a Billetera','scripts/add_billetera_cuentas.sql','TipoMovimiento CONSUMO_CUENTA',      IIF(EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId='CONSUMO_CUENTA'),1,0));
INSERT @c VALUES ('7a Billetera','scripts/add_tipo_pago_saldo.sql','TipoMovimiento PAGO_SALDO',            IIF(EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId='PAGO_SALDO'),1,0));
INSERT @c VALUES ('7a Billetera','scripts/add_billetera_portal.sql','Clientes.CliBilleteraPortal',         IIF(COL_LENGTH('dbo.Clientes','CliBilleteraPortal') IS NOT NULL,1,0));
INSERT @c VALUES ('7a Billetera','scripts/crear_billeteras_clientes.sql (PEGADO al deploy)','Billeteras creadas (alguna cuenta "BILLETERA%")',
    IIF(COL_LENGTH('dbo.CuentasCliente','CueNombre') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueNombre LIKE 'BILLETERA%'),1,0));
-- Auditoría de depósito
INSERT @c VALUES ('7b Auditoría dep.','scripts/add_auditoria_deposito.sql','tabla AuditoriaDeposito',           IIF(OBJECT_ID('dbo.AuditoriaDeposito','U') IS NOT NULL,1,0));
INSERT @c VALUES ('7b Auditoría dep.','scripts/add_auditoria_deposito.sql','tabla AuditoriaDepositoCaso',       IIF(OBJECT_ID('dbo.AuditoriaDepositoCaso','U') IS NOT NULL,1,0));
INSERT @c VALUES ('7b Auditoría dep.','scripts/add_auditoria_deposito.sql','Config AUDIT_DEP_TIPOS_ACTIVOS',    IIF(EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave='AUDIT_DEP_TIPOS_ACTIVOS'),1,0));
-- Área en la línea / sectores / clasificación
INSERT @c VALUES ('7c Área en línea','backend/scripts/add_DcdArea.sql','DocumentosContablesDetalle.DcdArea',     IIF(COL_LENGTH('dbo.DocumentosContablesDetalle','DcdArea') IS NOT NULL,1,0));
INSERT @c VALUES ('7c Área en línea','backend/scripts/add_ArticuloClasificacion.sql','tabla ArticuloClasificacion', IIF(OBJECT_ID('dbo.ArticuloClasificacion','U') IS NOT NULL,1,0));
INSERT @c VALUES ('7c Área en línea','backend/scripts/add_Sectores_Comerciales.sql','tabla Sectores',           IIF(OBJECT_ID('dbo.Sectores','U') IS NOT NULL,1,0));
INSERT @c VALUES ('7c Área en línea','backend/scripts/add_Sectores_Comerciales.sql','tabla SectorMapeo',        IIF(OBJECT_ID('dbo.SectorMapeo','U') IS NOT NULL,1,0));
-- Capacidad de planta
INSERT @c VALUES ('7d Capacidad','docs/migrations/capacidad_planta_velocidad_real.sql','ConfigEquipos.CabezalesReal', IIF(COL_LENGTH('dbo.ConfigEquipos','CabezalesReal') IS NOT NULL,1,0));
INSERT @c VALUES ('7d Capacidad','docs/migrations/agregar_fecha_compromiso_emb.sql','Ordenes.FechaCompromiso',   IIF(COL_LENGTH('dbo.Ordenes','FechaCompromiso') IS NOT NULL,1,0));
INSERT @c VALUES ('7d Capacidad','docs/migrations/agregar_fecha_compromiso_emb.sql','Ordenes.MagnitudCapacidad', IIF(COL_LENGTH('dbo.Ordenes','MagnitudCapacidad') IS NOT NULL,1,0));
-- Contabilidad varios
INSERT @c VALUES ('7e Contabilidad','backend/scripts/add_CfeFechaDgi.sql','DocumentosContables.CfeFechaDgi',   IIF(COL_LENGTH('dbo.DocumentosContables','CfeFechaDgi') IS NOT NULL,1,0));
INSERT @c VALUES ('7e Contabilidad','backend/scripts/add_DocCotizacion.sql','DocumentosContables.DocCotizacion', IIF(COL_LENGTH('dbo.DocumentosContables','DocCotizacion') IS NOT NULL,1,0));
INSERT @c VALUES ('7e Contabilidad','backend/scripts/add_EnvioEmail.sql','tabla EnvioEmail',                  IIF(OBJECT_ID('dbo.EnvioEmail','U') IS NOT NULL,1,0));
INSERT @c VALUES ('7e Contabilidad','backend/scripts/add_PlaFechaBaja_PlanesMetros.sql','PlanesMetros.PlaFechaBaja', IIF(COL_LENGTH('dbo.PlanesMetros','PlaFechaBaja') IS NOT NULL,1,0));
INSERT @c VALUES ('7e Contabilidad','backend/scripts/create_ConfigTiposArchivoReferencia.sql','tabla ConfigTiposArchivoReferencia', IIF(OBJECT_ID('dbo.ConfigTiposArchivoReferencia','U') IS NOT NULL,1,0));
-- Índices de performance
INSERT @c VALUES ('7f Índices','backend/scripts/add_indexes_contabilidad_perf.sql','IX_MovimientosCuenta_CueIdCuenta', IIF(EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_MovimientosCuenta_CueIdCuenta'),1,0));
INSERT @c VALUES ('7f Índices','backend/scripts/add_indexes_contabilidad_perf.sql','IX_DeudaDocumento_DocIdDocumento', IIF(EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_DeudaDocumento_DocIdDocumento'),1,0));
INSERT @c VALUES ('7f Índices','backend/scripts/add_indexes_libro_mayor.sql','IX_ContAsiCab_Fecha',             IIF(EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_ContAsiCab_Fecha'),1,0));
INSERT @c VALUES ('7f Índices','scripts/PROD_add_indexes_caja.sql','IX_TransaccionesCaja_Cliente_Fecha',        IIF(EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_TransaccionesCaja_Cliente_Fecha'),1,0));
-- Portal: áreas visibles (DESPUÉS del deploy)
INSERT @c VALUES ('7g Portal (DESPUÉS del deploy)','docs/migrations/activar_directa_portal.sql','ConfigMapeoERP DIR VisibleWeb=1', IIF(EXISTS (SELECT 1 FROM dbo.ConfigMapeoERP WHERE CodOrden='DIR' AND VisibleWeb=1),1,0));
INSERT @c VALUES ('7g Portal (DESPUÉS del deploy)','docs/migrations/activar_corte_portal.sql','ConfigMapeoERP COR VisibleWeb=1',   IIF(EXISTS (SELECT 1 FROM dbo.ConfigMapeoERP WHERE CodOrden='COR' AND VisibleWeb=1),1,0));
INSERT @c VALUES ('7g Portal (DESPUÉS del deploy)','docs/migrations/activar_ecouv_portal.sql','ConfigMapeoERP EUV VisibleWeb=1',   IIF(EXISTS (SELECT 1 FROM dbo.ConfigMapeoERP WHERE CodOrden='EUV' AND VisibleWeb=1),1,0));
-- Menú: rutas con espacio
INSERT @c VALUES ('7h Menú','scripts/PROD_menu_rutas_con_espacio.sql','Modulos sin rutas con espacio', IIF(EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta <> LTRIM(RTRIM(Ruta))),0,1));

/* ═══ RESULTADOS ═══ */
SELECT Paquete, Script, Objeto, Estado = CASE WHEN Existe = 1 THEN 'OK' ELSE 'FALTA' END
FROM @c ORDER BY Orden;

SELECT Script, Faltan = SUM(CASE WHEN Existe = 0 THEN 1 ELSE 0 END), Total = COUNT(*)
FROM @c GROUP BY Script HAVING SUM(CASE WHEN Existe = 0 THEN 1 ELSE 0 END) > 0
ORDER BY MIN(Orden);

-- Valor actual de las claves que los scripts de Spec 39 tocan (para decidir el piloto):
SELECT Clave, AreaID, Valor FROM dbo.ConfiguracionGlobal
WHERE Clave IN ('AREAS_DESPACHO_PARCIAL','AREAS_CADENA_REPOSICION','AREAS_FALLA_BANDEJA','PLAZO_SOLICITUD_INSUMO_DIAS','BENEFICIOS_ACTIVOS');
