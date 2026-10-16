/* ============================================================================
   VERIFICAR SQL DE LOS COMMITS DEL 29-09-2026 — SOLO LECTURA (no cambia nada)
   f08e495 (Yoania "29092026")  +  fcf9b31 (Santiago "de todo")
   Los .sql no viajan en git (*.sql en .gitignore): cada fila dice qué script es
   y si su huella está en la base. Correr entero en SSMS sobre SecureAppDB.
   Estado: OK = ya corrido | FALTA = no corrido | REVISAR = mirar el detalle
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @r TABLE (Commit_ VARCHAR(10), Script NVARCHAR(120), Chequeo NVARCHAR(200), Estado VARCHAR(10), Detalle NVARCHAR(300));
DECLARE @n INT, @d NVARCHAR(300);

/* ─────────────── f08e495 (Yoania) — ESQUEMA ─────────────── */
INSERT @r SELECT 'f08e495', 'scripts/add_conversion_solicitud_pedido.sql', 'SolicitudesVendedorArchivos.Material/CodArticulo/CodStock/Copias',
    CASE WHEN COL_LENGTH('dbo.SolicitudesVendedorArchivos','Material') IS NOT NULL AND COL_LENGTH('dbo.SolicitudesVendedorArchivos','Copias') IS NOT NULL THEN 'OK' ELSE 'FALTA' END,
    CASE WHEN OBJECT_ID('dbo.SolicitudesVendedorArchivos','U') IS NULL THEN 'ni siquiera existe SolicitudesVendedorArchivos (falta add_solicitudes_vendedor.sql)' ELSE '' END;
INSERT @r SELECT 'f08e495', 'scripts/add_conversion_solicitud_pedido.sql', 'Tabla IntegracionPedidos',
    CASE WHEN OBJECT_ID('dbo.IntegracionPedidos','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, '';
INSERT @r SELECT 'f08e495', 'scripts/add_conversion_solicitud_pedido.sql', 'SolicitudesVendedor.FichaJson/FechaEntrega/FechaEntregaHasta',
    CASE WHEN COL_LENGTH('dbo.SolicitudesVendedor','FichaJson') IS NOT NULL AND COL_LENGTH('dbo.SolicitudesVendedor','FechaEntregaHasta') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, '';
INSERT @r SELECT 'f08e495', 'scripts/add_conversion_solicitud_pedido.sql', 'CK_SolVenArchivo_Rol acepta COMPROBANTE',
    CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_SolVenArchivo_Rol' AND definition LIKE '%COMPROBANTE%') THEN 'OK'
         WHEN NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_SolVenArchivo_Rol') THEN 'REVISAR' ELSE 'FALTA' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_SolVenArchivo_Rol') THEN N'no existe el CHECK: no frena nada, el script lo saltea' ELSE '' END;
INSERT @r SELECT 'f08e495', 'scripts/add_conversion_solicitud_pedido.sql', 'ConfigTiposArchivoReferencia FICHA_PEDIDO',
    CASE WHEN OBJECT_ID('dbo.ConfigTiposArchivoReferencia','U') IS NULL THEN 'REVISAR' ELSE 'X' END, '';
IF OBJECT_ID('dbo.ConfigTiposArchivoReferencia','U') IS NOT NULL
    UPDATE @r SET Estado = CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfigTiposArchivoReferencia WHERE Codigo='FICHA_PEDIDO') THEN 'OK' ELSE 'FALTA' END
    WHERE Chequeo = 'ConfigTiposArchivoReferencia FICHA_PEDIDO';

INSERT @r SELECT 'f08e495', 'scripts/add_solicitudes_tizadapro.sql', 'Tabla SolicitudesVendedorTizadas',
    CASE WHEN OBJECT_ID('dbo.SolicitudesVendedorTizadas','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, '';
INSERT @r SELECT 'f08e495', 'scripts/add_solicitudes_tizadapro.sql', 'SolicitudesVendedorArchivos.TizadaID/TizadaHoja',
    CASE WHEN COL_LENGTH('dbo.SolicitudesVendedorArchivos','TizadaID') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, '';
INSERT @r SELECT 'f08e495', 'scripts/add_solicitudes_tizadapro.sql', 'Base TizadaPro en el servidor (lectura del backend)',
    CASE WHEN DB_ID('TizadaPro') IS NOT NULL THEN 'OK' ELSE 'REVISAR' END,
    CASE WHEN DB_ID('TizadaPro') IS NULL THEN 'no hay base TizadaPro en esta instancia (o TIZADAPRO_DB apunta a otra)' ELSE '' END;

INSERT @r SELECT 'f08e495', 'docs/migrations/configurador_etiquetas.sql', 'Tabla ProductoEtiqueta + ProductoVentaConfig.EtiquetaID',
    CASE WHEN OBJECT_ID('dbo.ProductoEtiqueta','U') IS NOT NULL AND COL_LENGTH('dbo.ProductoVentaConfig','EtiquetaID') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, '';
INSERT @r SELECT 'f08e495', 'docs/migrations/configurador_tizadapro.sql', 'ProductoVentaConfig.TizadaProMoldeRef + ProductoModelos + ProductoTelas',
    CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig','TizadaProMoldeRef') IS NOT NULL AND OBJECT_ID('dbo.ProductoModelos','U') IS NOT NULL AND OBJECT_ID('dbo.ProductoTelas','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, '';
INSERT @r SELECT 'f08e495', 'docs/migrations/configurador_tizadapro.sql', 'ProductoAvios + TizadaProMoldePiezas + CatalogoAvios',
    CASE WHEN OBJECT_ID('dbo.ProductoAvios','U') IS NOT NULL AND OBJECT_ID('dbo.TizadaProMoldePiezas','U') IS NOT NULL AND OBJECT_ID('dbo.CatalogoAvios','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, '';
INSERT @r SELECT 'f08e495', 'docs/migrations/configurador_tizadapro.sql', 'Limpieza: Moldes/ComponenteOpciones/ProductoVariantes/PiezasPrenda borradas',
    CASE WHEN OBJECT_ID('dbo.Moldes','U') IS NULL AND OBJECT_ID('dbo.ComponenteOpciones','U') IS NULL AND OBJECT_ID('dbo.ProductoVariantes','U') IS NULL AND OBJECT_ID('dbo.PiezasPrenda','U') IS NULL THEN 'OK' ELSE 'FALTA' END,
    N'ojo: este script BORRA tablas (Moldes etc.); ver si en prod tienen datos antes de correrlo';

INSERT @r SELECT 'f08e495', 'scripts/add_ventas_historicas.sql', 'Tabla VentasHistoricas',
    CASE WHEN OBJECT_ID('dbo.VentasHistoricas','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, '';

/* ─────────────── f08e495 (Yoania) — REPARACIONES DE DATOS ───────────────
   Cuenta los casos que el script arreglaría. 0 = ya corrido. Si el deploy todavía no
   se hizo, pueden aparecer casos NUEVOS aunque el script se haya corrido. */
SELECT @n = COUNT(*) FROM dbo.DocumentosContables d JOIN dbo.CuentasCliente c ON c.CueIdCuenta = d.CueIdCuenta WHERE c.CliIdCliente <> d.CliIdCliente;
INSERT @r SELECT 'f08e495', 'scripts/PROD_fix_DocumentosContables_cuenta_ajena.sql', 'Documentos con cuenta de otro cliente en el encabezado',
    CASE WHEN @n = 0 THEN 'OK' WHEN @n < 50 THEN 'REVISAR' ELSE 'FALTA' END, CONCAT(@n, ' documentos (local antes del fix: 12.842)');

SELECT @n = COUNT(*) FROM dbo.DeudaDocumento d
CROSS APPLY (SELECT TOP 1 mf.DocIdDocumento FROM dbo.MovimientosCuenta mf
             JOIN dbo.DocumentosContables df ON df.DocIdDocumento = mf.DocIdDocumento AND df.DocEstado <> 'ANULADO'
             WHERE mf.MovTipo = 'ORDEN' AND mf.OrdIdOrden = d.OrdIdOrden AND mf.CueIdCuenta = d.CueIdCuenta
               AND ISNULL(mf.MovAnulado,0) = 0 AND mf.DocIdDocumento IS NOT NULL) mv
WHERE d.DocIdDocumento IS NULL AND d.OrdIdOrden IS NOT NULL AND d.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL');
INSERT @r SELECT 'f08e495', 'scripts/PROD_cerrar_deudas_orden_ya_facturada.sql', 'Deudas por orden abiertas con la orden ya facturada',
    CASE WHEN @n = 0 THEN 'OK' WHEN @n < 50 THEN 'REVISAR' ELSE 'FALTA' END, CONCAT(@n, ' deudas (local antes del fix: ~1.700)');

SELECT @n = COUNT(*) FROM dbo.OrdenesDeposito od JOIN dbo.Ordenes o ON o.CodigoOrden = od.OrdCodigoOrden
WHERE (od.ProIdProducto = 349 AND o.ProIdProducto = 567) OR (od.ProIdProducto = 429 AND o.ProIdProducto = 564) OR (od.ProIdProducto = 226 AND o.ProIdProducto = 565);
INSERT @r SELECT 'f08e495', 'scripts/PROD_reparar_articulo_deposito_idprodreact_repetido.sql', 'SUB en depósito con artículo equivocado (Canvas/Ojales/Dry)',
    CASE WHEN @n = 0 THEN 'OK' ELSE 'FALTA' END, CONCAT(@n, ' órdenes (prod 25-sep: 18)');

SELECT @n = COUNT(*) FROM dbo.OrdenesDeposito od
WHERE od.OrdEstadoActual = 7 AND ISNULL(od.OrdAvisoWsp,0) = 0 AND od.PagIdPago IS NULL AND od.OReIdOrdenRetiro IS NULL
  AND od.OrdFechaIngresoOrden >= DATEADD(DAY,-60,GETDATE())
  AND NOT EXISTS (SELECT 1 FROM dbo.HistoricoEstadosOrdenes h WHERE h.OrdIdOrden = od.OrdIdOrden AND h.EOrIdEstadoOrden = 7);
INSERT @r SELECT 'f08e495', 'scripts/PROD_devolver_a_ingresado_pagas_sin_aviso.sql', 'Órdenes pagas en "Pronto" (7) sin aviso WSP',
    CASE WHEN @n = 0 THEN 'OK' ELSE 'FALTA' END, CONCAT(@n, ' órdenes (siguen apareciendo hasta el deploy)');

SELECT @n = COUNT(*) FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = 62334 AND CueIdCuenta = 381 AND ISNULL(MovAnulado,0) = 0;
SELECT @d = CONCAT('mov 62334 (excedente fantasma) vivo=', @n, '; PC-4852 pendiente=',
    (SELECT TOP 1 CONCAT(dd.DDeImportePendiente, ' ', dd.DDeEstado) FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = 16158 AND dd.DDeEstado <> 'CANCELADA' ORDER BY dd.DDeIdDocumento DESC),
    ' (esperado tras el script: 265.08 PARCIAL)');
INSERT @r SELECT 'f08e495', 'scripts/PROD_mazzoni_pc4851_excedente_pc4852_credito.sql', 'Mazzoni cta 381: excedente PC-4851 anulado',
    CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = 62334 AND CueIdCuenta = 381) THEN 'REVISAR'
         WHEN @n = 0 THEN 'OK' ELSE 'FALTA' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = 62334 AND CueIdCuenta = 381) THEN N'el movimiento 62334 no está en esta base' ELSE @d END;

/* ─────────────── fcf9b31 (Santiago) — sus .sql están en SU máquina ─────────────── */
SELECT @n = COUNT(*) FROM sys.tables WHERE name IN ('ST_Solicitudes','ST_Trabajos','ST_Historial','ST_Adjuntos','ST_CambiosEquipo','ST_Planes','ST_Procedimientos','ST_ProcedimientoPasos','ST_TrabajoTareas','ST_Proyectos','ST_InsumosUso','ST_TiposFalla');
INSERT @r SELECT 'fcf9b31', 'docs/servicio-tecnico/st-etapa1..4.sql (Santiago)', 'Tablas ST_* (12 que usa el código)',
    CASE WHEN @n = 12 THEN 'OK' WHEN @n = 0 THEN 'FALTA' ELSE 'REVISAR' END, CONCAT(@n, ' de 12 (etapa 2 = CambiosEquipo, 3 = Planes/Procedimientos/Trabajos, 4 = Proyectos/InsumosUso)');
INSERT @r SELECT 'fcf9b31', 'docs/servicio-tecnico/st-etapa*.sql (Santiago)', 'NotificacionesUsuario + PushSuscripcionesInternas',
    CASE WHEN OBJECT_ID('dbo.NotificacionesUsuario','U') IS NOT NULL AND OBJECT_ID('dbo.PushSuscripcionesInternas','U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END, N'sin esto la campanita queda vacía';
INSERT @r SELECT 'fcf9b31', 'docs/servicio-tecnico/st-etapa*.sql (Santiago)', 'Menú /servicio-tecnico',
    CASE WHEN EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta = '/servicio-tecnico') THEN 'OK' ELSE 'FALTA' END, '';

SELECT @n = COUNT(*) FROM dbo.Modulos WHERE Ruta IN ('/stock/panel','/stock/inventario','/stock/mi-sector','/stock/compras','/stock/sistema');
INSERT @r SELECT 'fcf9b31', 'backend/scripts/sql/menu_stock_secciones_2026-09-28.sql (Santiago)', 'Menú Stock en 5 entradas',
    CASE WHEN @n = 5 THEN 'OK' WHEN @n = 0 THEN 'FALTA' ELSE 'REVISAR' END, CONCAT(@n, ' de 5 — correr DESPUÉS del build');

SELECT @n = COUNT(*) FROM dbo.Logistica_Bultos b JOIN dbo.Ordenes o ON o.OrdenID = b.OrdenID
JOIN dbo.OrdenesDeposito od ON od.OrdCodigoOrden = o.CodigoOrden
WHERE b.Estado = 'EN_STOCK' AND b.UbicacionActual IN ('DEPOSITO','LOGISTICA') AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA' AND od.OrdEstadoActual = 9;
INSERT @r SELECT 'fcf9b31', 'backend/scripts/sql/cierre_bultos_entregados_2026-09-25.sql (Santiago)', 'Bultos "en stock" de órdenes ya entregadas (estado 9)',
    CASE WHEN @n = 0 THEN 'OK' WHEN @n < 100 THEN 'REVISAR' ELSE 'FALTA' END, CONCAT(@n, ' bultos (prod 25-sep: 24.494) — correr DESPUÉS del reinicio');

SELECT @n = COUNT(*) FROM dbo.Logistica_Bultos b JOIN dbo.Ordenes o ON o.OrdenID = b.OrdenID
WHERE b.Estado IN ('EN_STOCK','EN_TRANSITO') AND b.Tipocontenido IN ('PROD_TERMINADO','EN_PROCESO') AND o.Estado = 'CANCELADO';
INSERT @r SELECT 'fcf9b31', 'backend/scripts/sql/cierre_bultos_ordenes_canceladas_2026-09-25.sql (Santiago)', 'Bultos en stock/tránsito de órdenes canceladas',
    CASE WHEN @n = 0 THEN 'OK' ELSE 'FALTA' END, CONCAT(@n, ' bultos — correr DESPUÉS del de entregados');

SELECT Commit_ AS [Commit], Estado, Script, Chequeo, Detalle FROM @r
ORDER BY Commit_ DESC, CASE Estado WHEN 'FALTA' THEN 0 WHEN 'REVISAR' THEN 1 ELSE 2 END, Script;
