'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/contabilidadController');
const logger = require('../utils/logger');
const { verifyToken } = require('../middleware/authMiddleware');
const upload = require('../middleware/multerConfig');

router.use(verifyToken);

router.get('/grupos-erp', ctrl.getGruposERP);
router.get('/unidades', ctrl.getUnidades);
router.get('/articulos', ctrl.getArticulos);
router.get('/monedas', ctrl.getMonedas);
router.get('/metodos-pago', ctrl.getMetodosPago);
router.get('/condiciones-pago', ctrl.getCondicionesPago);
router.get('/cotizacion-hoy', ctrl.getCotizacionHoy);
router.get('/clientes-activos', ctrl.getClientesActivos);
router.get('/deudas-vivas', ctrl.getTodasLasDeudasVivas);
router.get('/clientes/:CliIdCliente/deudas-vivas', ctrl.getDeudasVivasCliente);
router.get('/clientes/:CliIdCliente/resumen-documentos', ctrl.getResumenDocumentosCliente);
router.get('/clientes/:CliIdCliente/movimientos-ordenes', ctrl.getMovimientosOrdenesCliente);
router.get('/cuentas/:CliIdCliente', ctrl.getCuentasCliente);
router.post('/cuentas', ctrl.crearCuenta);
router.patch('/cuentas/:CueIdCuenta/configuracion', ctrl.actualizarConfigCuenta);
router.patch('/clientes/:CliIdCliente/dgi', ctrl.actualizarClienteDGI);
router.get('/cuentas/:CueIdCuenta/movimientos', ctrl.getMovimientos);
router.post('/movimientos/ajuste', ctrl.registrarAjusteManual);
router.post('/movimientos/pago-anticipado', ctrl.registrarPagoAnticipado);
router.post('/movimientos/saldo-inicial', ctrl.registrarSaldoInicial);
router.post('/movimientos/pago-cruzado', ctrl.registrarPagoCruzado);
router.get('/movimientos/:MovIdMovimiento/recibo/pdf', ctrl.generarReciboPdf);
router.post('/movimientos/:MovIdMovimiento/anular-orden', ctrl.anularOrdenPendiente);
router.post('/movimientos/:MovIdMovimiento/consumir-recurso-adelantado', ctrl.consumirRecursoAdelantado);

router.get('/cuentas/:CueIdCuenta/deudas', ctrl.getDeudas);
router.get('/ciclos/:CliIdCliente', ctrl.getCiclosCliente);
router.get('/ciclos/:CicIdCiclo/movimientos', ctrl.getCicloMovimientos);
router.post('/ciclos', ctrl.abrirCiclo);
router.post('/ciclos/cerrar-vencidos', ctrl.cerrarCiclosVencidos);
router.post('/ciclos/:CicIdCiclo/cerrar', ctrl.cerrarCiclo);
router.post('/ciclos/:CicIdCiclo/guardar-precios', ctrl.guardarPreciosCiclo);
router.post('/guardar-precios', ctrl.guardarPrecios); // General: sin ciclo requerido
router.get('/clientes/:CliIdCliente/ordenes-anticipo', ctrl.getOrdenesAnticipo);
router.post('/clientes/:CliIdCliente/emitir-factura-anticipo', ctrl.emitirFacturaAnticipo);
router.get('/clientes/:CliIdCliente/ordenes-sin-factura', ctrl.getOrdenesPendientesCliente);
router.get('/ordenes/:OrdIdOrden/detalle', ctrl.getOrdenDetalle);
router.post('/ordenes/reasignar-cliente', ctrl.reasignarOrdenesCliente);
router.get('/planes/:CliIdCliente', ctrl.getPlanesCliente);
router.post('/planes', ctrl.crearPlan);
router.post('/planes/:PlaIdPlan/recargar', ctrl.recargarPlan);
router.patch('/planes/:PlaIdPlan/desactivar', ctrl.desactivarPlan);
router.get('/reportes/antiguedad-deuda', ctrl.getAntiguedadDeuda);
router.get('/reportes/estado-cuenta/:CliIdCliente', ctrl.getEstadoCuentaCliente);
router.get('/reportes/deuda-consolidada', ctrl.getDeudaConsolidada);

// ── Reportes de Ventas (página /contabilidad/reportes) ────────────────────────
const reportesVentasCtrl = require('../controllers/contabilidadReportesController');
router.get('/reportes/ventas-filtros',       reportesVentasCtrl.getFiltrosVentas);
router.get('/reportes/ventas-por-area',      reportesVentasCtrl.getVentasPorArea);
router.get('/reportes/ventas-por-documento', reportesVentasCtrl.getVentasPorDocumento);
router.get('/reportes/ingresos',             reportesVentasCtrl.getIngresos);

// ────────────────────────────────────────────────────────────────────────────
// RUTAS: COLA DE ESTADOS DE CUENTA
// ────────────────────────────────────────────────────────────────────────────
router.get('/cola', ctrl.getColaEstados);
router.post('/cola/:ColIdCola/estado', ctrl.cambiarEstadoCola);
router.post('/cola/:ColIdCola/enviar', ctrl.enviarEstadoCola);
router.post('/cola/enviar-aprobados', ctrl.enviarAprobados);
router.post('/cola/run-batch', ctrl.generarEstadosManual);
router.delete('/cola/:ColIdCola', ctrl.eliminarItemCola);
router.post('/cola/manual', ctrl.generarColaManual);
router.get('/cola/:ColIdCola/pdf', ctrl.descargarPdfCola);

// ────────────────────────────────────────────────────────────────────────────
// RUTAS: CUENTAS CLIENTE
// ────────────────────────────────────────────────────────────────────────────
const motorCtrl = require('../controllers/motorContableController');
router.get('/motor/transacciones', motorCtrl.getTiposTransaccion);
router.get('/motor/transacciones/:codigo/reglas', motorCtrl.getReglasPorTransaccion);
router.post('/motor/transacciones', motorCtrl.saveReglasTransaccion);
router.delete('/motor/transacciones/:codigo', motorCtrl.deleteTransaccion);

router.get('/tipos-movimiento', ctrl.getTiposMovimiento);
router.post('/tipos-movimiento', ctrl.createTipoMovimiento);
router.patch('/tipos-movimiento/:TmoId', ctrl.updateTipoMovimiento);
router.delete('/tipos-movimiento/:TmoId', ctrl.deleteTipoMovimiento);

// ── Módulo Caja y Pagos ────────────────────────────────────────────────
const caja = require('../controllers/cajaController');
const erp  = require('../controllers/erpContabilidadController'); // NUEVO ERP

// ── Nomencladores y Libro Mayor ERP
router.get('/erp/cuentas',        erp.getPlanCuentas);
router.post('/erp/cuentas',       erp.crearCuenta);
router.put('/erp/cuentas/:id',    erp.actualizarCuenta);
router.get('/erp/cuentas/gastos', erp.getCuentasGastos);
router.get('/erp/libro-mayor',    erp.getLibroMayor);

// Transacciones
router.post('/caja/transaccion',              caja.procesarTransaccion);
router.post('/caja/guardar-comprobante',      caja.guardarComprobante);
router.post('/caja/upload-comprobante-transferencia', upload.single('comprobante'), caja.subirComprobanteTransferencia);
router.post('/caja/venta-directa',            caja.procesarVentaDirecta); // NUEVO
router.post('/caja/pago-deuda',               caja.procesarPagoDeuda);    // Pago de deudas por cuenta corriente
router.get('/caja/productos-venta',           caja.getProductosVenta); // NUEVO
router.post('/caja/transaccion/:id/anular',   caja.anularTransaccion);
router.get('/caja/transaccion/:id',           caja.getTransaccion);
router.get('/caja/historial/:clienteId',      caja.getHistorialCliente);
router.get('/caja/movimientos-turno',         caja.getMovimientosTurno);
router.post('/caja/movimiento/reclasificar',  caja.reclasificarCajaMovimiento); // Mover movimiento Central <-> Administrativa (cuadre)
router.get('/caja/reporte-central-admin',     caja.getReporteCentralAdmin); // Auditoría Central vs Administrativa por fecha
router.get('/caja/cierres',                   caja.getCierresSesiones);     // Sesiones + PDF de cierre disponible
router.get('/caja/cierre-pdf/:sesionId',      caja.getCierrePdf);           // Sirve el PDF de cierre guardado
router.post('/caja/cierre-pdf/:sesionId/generar', caja.regenerarCierrePdf); // (Re)genera el PDF de cierre
router.get('/caja/documentos',                caja.getDocumentosInternos); // Bandeja de recibos/egresos
router.post('/caja/documentos/anular',           caja.anularDocumentoInterno);    // Anular recibo/egreso interno
router.post('/caja/documentos/modificar-monto',  caja.modificarMontoDocumento);   // Modificar monto (anula+recrea)


// Sesión de caja (apertura / cierre)
router.get('/caja/sesion/actual',             caja.getSesionActual);
router.post('/caja/sesion/abrir',             caja.abrirSesion);
router.post('/caja/sesion/:id/cerrar',        caja.cerrarSesion);
router.get('/caja/sesion/:id/resumen',        caja.getResumenSesion);
router.get('/caja/resumen-diario',            caja.getResumenDiario);

// Numeración automática de documentos
router.get('/caja/siguiente-numero',          caja.getSiguienteNumero);

// CRUD Secuencias Documentos
const secCtrl = require('../controllers/secuenciasController');
router.get('/caja/secuencias',                secCtrl.getSecuencias);
router.post('/caja/secuencias',               secCtrl.createSecuencia);
router.put('/caja/secuencias/:id',            secCtrl.updateSecuencia);

// Egresos e Ingresos
router.post('/caja/egreso',                   caja.registrarEgreso);
router.get('/caja/tipos-egreso',              caja.getTiposEgreso);
router.get('/caja/egreso/:id/voucher',        caja.getVoucherEgreso);
router.post('/caja/ingreso-generico',         caja.registrarIngresoGenerico);

// Autorizaciones sin pago
router.post('/caja/autorizar',                          caja.autorizarSinPago);
router.get('/caja/autorizaciones-sin-pago',              caja.getAutorizacionesSinPago);
router.put('/caja/autorizaciones-sin-pago/:id',          caja.gestionarAutorizacionSinPago);

// ── OPERACIONES DEL MOTOR disponibles para elegir en Caja ─────────────────
// Devuelve los eventos contables que tienen prefijo (son documentales) y activos
// El cajero puede seleccionar una operación manual y el sistema aplica sus reglas
router.get('/caja/operaciones', motorCtrl.getOperacionesCaja);
router.post('/caja/operacion-manual', caja.registrarOperacionManual);

// ── OPERACIONES DESDE ESTADO DE CUENTA (Caja Administrativa) ──────────────────
router.post('/caja/nota-credito',      caja.generarNotaCredito);      // Nota de crédito sobre doc existente
router.post('/caja/nota-credito-externa', caja.generarNotaCreditoExterna); // Nota de crédito sobre factura del sistema anterior (solo CFE, sin impacto contable)
router.post('/caja/nota-debito',       caja.generarNotaDebito);       // Nota de débito sobre doc existente (NUEVO)
router.post('/caja/reversar-doc',      caja.reversarDocumento);       // Reverso: contado→egreso/crédito→NC
router.post('/caja/pago-anticipo',     caja.registrarPagoAnticipo);   // Anticipo directo a cuenta (nuevo dinero)
router.post('/caja/anular-factura',    caja.anularFactura);           // Anular factura no enviada a DGI → reabre ciclo
router.post('/caja/imputar-anticipo-deuda', caja.imputarAnticipoADeuda); // Imputar saldo existente a una deuda específica

// ── CFE (Facturación Electrónica) ──────────────────────────────────────────
const cfeCtrl = require('../controllers/cfeController');
router.get('/cfe/nomencladores', cfeCtrl.getNomencladores);
router.get('/cfe/tipos-existentes', cfeCtrl.getTiposDocumentosExistentes);
router.get('/cfe/config-dgi', cfeCtrl.getConfigDGI);
router.put('/cfe/config-dgi', cfeCtrl.updateConfigDGI);
router.get('/cfe/documentos', cfeCtrl.getDocumentosCFE);
router.post('/cfe/documentos/:id/enviar', cfeCtrl.enviarADGI);
router.get('/cfe/documentos/:id/preview-dgi', cfeCtrl.previewDGI);   // Qué CFE se le pediría a DGI (no emite nada)
router.post('/cfe/manual', cfeCtrl.crearFacturaManual);
router.get('/cfe/documentos/:id/detalle', cfeCtrl.getDetalleFactura);
router.put('/cfe/documentos/:id/anular', cfeCtrl.anularFactura);
router.put('/cfe/documentos/:id', cfeCtrl.editarFactura);

// ── Búsqueda de documento por serie+numero ───────────────────────────────────
router.get('/documentos/buscar', async (req, res) => {
  try {
    const { getPool, sql } = require('../config/db');
    const { serie, numero } = req.query;
    if (!serie || !numero) return res.status(400).json({ error: 'Parámetros serie y numero requeridos' });
    const pool = await getPool();
    const r = await pool.request()
      .input('Serie',  require('mssql').VarChar(10), serie)
      .input('Numero', require('mssql').VarChar(50),  numero)
      .query(`SELECT TOP 1 DocIdDocumento, DocTipo, DocSerie, DocNumero, DocTotal, DocEstado, CfeEstado, DocPagado
              FROM dbo.DocumentosContables
              WHERE DocSerie = @Serie AND DocNumero = @Numero
              ORDER BY DocFechaEmision DESC`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Documento no encontrado' });
    return res.json(r.recordset[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── RECONCILIACIÓN CONTABLE MANUAL ───────────────────────────────────────────
// GET  /contabilidad/reconciliacion/audit   → Solo muestra inconsistencias, no toca nada
// POST /contabilidad/reconciliacion/ejecutar → Detecta y repara (igual que el job automático)
const reconciliacionJob = require('../jobs/contabilidadReconciliacionJob');
const { getPool, sql: sqlRec } = require('../config/db');

router.get('/reconciliacion/audit', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                od.OrdCodigoOrden       AS CodigoOrden,
                od.OrdFechaIngresoOrden AS FechaDeposito,
                pc.ID                   AS PCId,
                pc.MontoTotal,
                pc.MontoContabilizado,
                pc.MetrosContabilizados
            FROM OrdenesDeposito od
            INNER JOIN PedidosCobranza pc 
                ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(od.OrdCodigoOrden))
            WHERE od.OrdEstadoActual = 1
              AND pc.MontoContabilizado IS NULL
            ORDER BY od.OrdFechaIngresoOrden ASC
        `);
        res.json({
            inconsistencias: result.recordset.length,
            detalle: result.recordset
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/reconciliacion/ejecutar', async (req, res) => {
    try {
        // Corre el job en background y responde de inmediato
        reconciliacionJob.run()
            .then(() => {})
            .catch(e => console.error('[ReconciliacionCtb-Manual] Error:', e.message));
        res.json({ success: true, message: 'Reconciliación iniciada en background. Revisá los logs del servidor.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ── OPERACIONES MANUALES EN CUENTAS MTS (Metros) ──────────────────────────────
const { getPool: getPoolOrd, sql: sqlOrd } = require('../config/db');

// POST /contabilidad/ordenes/editar-metros
// Modifica la cantidad de metros de un movimiento existente y ajusta el saldo de la cuenta
router.post('/ordenes/editar-metros', async (req, res) => {
  const { MovIdMovimiento, metros } = req.body;
  if (!MovIdMovimiento || metros === undefined) {
    return res.status(400).json({ error: 'Faltan datos: MovIdMovimiento, metros' });
  }
  const nuevosMetros = parseFloat(metros);
  let transaction;
  try {
    const pool = await getPoolOrd();
    const movRes = await pool.request()
      .input('Mid', sqlOrd.Int, MovIdMovimiento)
      .query('SELECT MovImporte, CueIdCuenta, MovConcepto, MovObservaciones FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @Mid');
    if (!movRes.recordset.length) return res.status(404).json({ error: 'Movimiento no encontrado' });

    const importeActual = Math.abs(Number(movRes.recordset[0].MovImporte));
    const CueIdCuenta   = movRes.recordset[0].CueIdCuenta;
    const MovConcepto   = movRes.recordset[0].MovConcepto;
    const MovObservaciones = movRes.recordset[0].MovObservaciones;
    const delta         = nuevosMetros - importeActual; // positivo = más consumo

    transaction = pool.transaction();
    await transaction.begin();

    // Actualizar movimiento (siempre negativo = consumo)
    await transaction.request()
      .input('Mid',    sqlOrd.Int,          MovIdMovimiento)
      .input('Importe', sqlOrd.Decimal(18,4), -nuevosMetros)
      .query('UPDATE dbo.MovimientosCuenta SET MovImporte = @Importe WHERE MovIdMovimiento = @Mid');

    // Ajustar saldo de la cuenta
    await transaction.request()
      .input('CueId', sqlOrd.Int,          CueIdCuenta)
      .input('Delta', sqlOrd.Decimal(18,4), -delta)
      .query('UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Delta WHERE CueIdCuenta = @CueId');

    // Actualizar cantidad usada en el plan
    let targetPlanId = null;
    const matchObs = MovObservaciones && MovObservaciones.match(/Plan\s*#?\s*(\d+)/i);
    if (matchObs) targetPlanId = parseInt(matchObs[1]);
    else {
      const matchCon = MovConcepto && MovConcepto.match(/Plan\s*#?\s*(\d+)/i);
      if (matchCon) targetPlanId = parseInt(matchCon[1]);
    }

    if (!targetPlanId) {
      const activePlanRes = await transaction.request()
        .input('CueId', sqlOrd.Int, CueIdCuenta)
        .query('SELECT TOP 1 PlaIdPlan FROM dbo.PlanesMetros WHERE CueIdCuenta = @CueId AND PlaActivo = 1');
      if (activePlanRes.recordset.length) {
        targetPlanId = activePlanRes.recordset[0].PlaIdPlan;
      }
    }

    if (targetPlanId) {
      await transaction.request()
        .input('PlanId', sqlOrd.Int,          targetPlanId)
        .input('Delta',  sqlOrd.Decimal(18,4), delta)
        .query(`
          UPDATE dbo.PlanesMetros 
          SET PlaCantidadUsada = PlaCantidadUsada + @Delta 
          WHERE PlaIdPlan = @PlanId;
          
          UPDATE dbo.PlanesMetros
          SET PlaActivo = CASE WHEN PlaCantidadUsada < PlaCantidadTotal THEN 1 ELSE 0 END
          WHERE PlaIdPlan = @PlanId;
        `);
    }

    await transaction.commit();
    res.json({ success: true, message: 'Metros actualizados correctamente' });
  } catch (err) {
    if (transaction) try { await transaction.rollback(); } catch(_){}
    res.status(500).json({ error: err.message });
  }
});

// POST /contabilidad/ordenes/eliminar-metros
// Elimina un movimiento de consumo y restaura el saldo de la cuenta
router.post('/ordenes/eliminar-metros', async (req, res) => {
  const { MovIdMovimiento, reactivarOrden } = req.body;
  if (!MovIdMovimiento) return res.status(400).json({ error: 'Falta MovIdMovimiento' });

  let transaction;
  try {
    const pool = await getPoolOrd();
    const movRes = await pool.request()
      .input('Mid', sqlOrd.Int, MovIdMovimiento)
      .query('SELECT MovImporte, CueIdCuenta, MovConcepto, MovObservaciones, OrdIdOrden FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @Mid');
    if (!movRes.recordset.length) return res.status(404).json({ error: 'Movimiento no encontrado' });

    const importeAbs  = Math.abs(Number(movRes.recordset[0].MovImporte));
    const CueIdCuenta = movRes.recordset[0].CueIdCuenta;
    const MovConcepto = movRes.recordset[0].MovConcepto;
    const MovObservaciones = movRes.recordset[0].MovObservaciones;
    const OrdIdOrden  = movRes.recordset[0].OrdIdOrden;

    logger.info(`[REVERTIR] INICIO Mov=${MovIdMovimiento} reactivarOrden=${!!reactivarOrden} metros=${importeAbs} Cue=${CueIdCuenta} OrdIdOrden=${OrdIdOrden || 'NULL'} concepto="${MovConcepto || ''}" obs="${MovObservaciones || ''}"`);

    // BLOQUEO: no se puede revertir el consumo de una orden YA FACTURADA. Devolver los
    // metros dejaría el plan con saldo de vuelta pero la orden ya emitida en un documento
    // (inconsistente). Primero hay que anular la factura.
    if (reactivarOrden && OrdIdOrden) {
      const chk = await pool.request().input('Ord', sqlOrd.Int, OrdIdOrden).query(`
        SELECT TOP 1 m.DocIdDocumento,
               LTRIM(RTRIM(ISNULL(dc.DocSerie,''))) + '-' + LTRIM(RTRIM(CAST(ISNULL(dc.DocNumero,'') AS VARCHAR(50)))) AS Doc
        FROM dbo.MovimientosCuenta m
        LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento
        WHERE m.OrdIdOrden = @Ord AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.DocIdDocumento IS NOT NULL`);
      if (chk.recordset.length) {
        const docRef = (chk.recordset[0].Doc || '').replace(/^-|-$/g, '') || ('Doc #' + chk.recordset[0].DocIdDocumento);
        logger.warn(`[REVERTIR] BLOQUEADO: la orden ya está facturada en ${docRef} (OrdIdOrden=${OrdIdOrden}) — no se devuelven los metros`);
        return res.status(400).json({
          error: `No se puede revertir el consumo: la orden ya fue facturada en ${docRef}. Anulá esa factura primero.`
        });
      }
    }

    transaction = pool.transaction();
    await transaction.begin();

    // Eliminar movimiento
    await transaction.request()
      .input('Mid', sqlOrd.Int, MovIdMovimiento)
      .query('DELETE FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @Mid');

    // Restaurar saldo (era consumo negativo → sumar de vuelta)
    await transaction.request()
      .input('CueId', sqlOrd.Int,          CueIdCuenta)
      .input('Imp',   sqlOrd.Decimal(18,4), importeAbs)
      .query('UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Imp WHERE CueIdCuenta = @CueId');

    // Actualizar cantidad usada en el plan
    let targetPlanId = null;
    const matchObs = MovObservaciones && MovObservaciones.match(/Plan\s*#?\s*(\d+)/i);
    if (matchObs) targetPlanId = parseInt(matchObs[1]);
    else {
      const matchCon = MovConcepto && MovConcepto.match(/Plan\s*#?\s*(\d+)/i);
      if (matchCon) targetPlanId = parseInt(matchCon[1]);
    }

    if (!targetPlanId) {
      const activePlanRes = await transaction.request()
        .input('CueId', sqlOrd.Int, CueIdCuenta)
        .query('SELECT TOP 1 PlaIdPlan FROM dbo.PlanesMetros WHERE CueIdCuenta = @CueId');
      if (activePlanRes.recordset.length) {
        targetPlanId = activePlanRes.recordset[0].PlaIdPlan;
      }
    }

    if (targetPlanId) {
      await transaction.request()
        .input('PlanId', sqlOrd.Int,          targetPlanId)
        .input('Metros', sqlOrd.Decimal(18,4), importeAbs)
        .query(`
          UPDATE dbo.PlanesMetros 
          SET PlaCantidadUsada = CASE WHEN PlaCantidadUsada - @Metros < 0 THEN 0 ELSE PlaCantidadUsada - @Metros END
          WHERE PlaIdPlan = @PlanId;
          
          UPDATE dbo.PlanesMetros
          SET PlaActivo = CASE WHEN PlaCantidadUsada < PlaCantidadTotal THEN 1 ELSE 0 END
          WHERE PlaIdPlan = @PlanId;
        `);
    }

    // Solo "Revertir consumo" (reactivarOrden=true) toca la orden. "Eliminar movimiento"
    // deja la orden como está. Si era una COBERTURA, la deja de nuevo PENDIENTE DE FACTURAR:
    // revierte servicios (CREDITO_PLAN), restaura el importe original de la orden, su deuda y el ciclo.
    let ordenReactivada = false;
    if (reactivarOrden && OrdIdOrden) {
      const ordRes = await transaction.request().input('Ord', sqlOrd.Int, OrdIdOrden).query(`
        SELECT TOP 1 MovIdMovimiento, MovImporte, MovObservaciones, CicIdCiclo, DocIdDocumento
        FROM dbo.MovimientosCuenta
        WHERE OrdIdOrden = @Ord AND MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
          AND (MovAnulado IS NULL OR MovAnulado = 0)`);
      if (!ordRes.recordset.length) {
        // La orden se pagó con METROS desde el inicio → nunca existió movimiento ORDEN (deuda en dinero).
        // Al devolver los metros, el cliente pasa a deber la plata: creamos la deuda para que
        // la orden aparezca en "Órdenes Pendientes de Facturar".
        // OJO: m.OrdIdOrden puede apuntar a Ordenes(ERP).OrdenID O a OrdenesDeposito.OrdIdOrden
        // (son espacios de IDs distintos). Resolvemos por ambos caminos.
        const odRes = await transaction.request().input('Ord', sqlOrd.Int, OrdIdOrden).query(`
          SELECT TOP 1 od.OrdCodigoOrden, od.OrdNombreTrabajo, od.OrdCostoFinal, od.MonIdMoneda
          FROM dbo.OrdenesDeposito od
          WHERE od.OrdIdOrden = @Ord
             OR od.OrdCodigoOrden = (SELECT TOP 1 CodigoOrden FROM dbo.Ordenes WHERE OrdenID = @Ord)`);
        const cliRes = await transaction.request().input('Cue', sqlOrd.Int, CueIdCuenta).query(`
          SELECT TOP 1 CliIdCliente FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue`);
        const od  = odRes.recordset[0];
        const cli = cliRes.recordset[0]?.CliIdCliente;
        let costo = Math.round(Number(od?.OrdCostoFinal || 0) * 100) / 100;
        let origenCosto = 'OrdCostoFinal';

        // Si la orden no tiene costo cargado, valorizamos los metros devueltos con el
        // precio por unidad del plan (PlaPrecioUnitario = precio total del plan).
        if (costo <= 0 && targetPlanId) {
          const plRes = await transaction.request().input('Pla', sqlOrd.Int, targetPlanId)
            .query('SELECT PlaPrecioUnitario, PlaCantidadTotal FROM dbo.PlanesMetros WHERE PlaIdPlan = @Pla');
          const totalPlan  = Number(plRes.recordset[0]?.PlaCantidadTotal || 0);
          const precioPlan = Number(plRes.recordset[0]?.PlaPrecioUnitario || 0);
          if (totalPlan > 0 && precioPlan > 0) {
            costo = Math.round((precioPlan / totalPlan) * importeAbs * 100) / 100;
            origenCosto = `plan #${targetPlanId} (${(precioPlan / totalPlan).toFixed(4)}/u x ${importeAbs} u)`;
          }
        }

        // Si la orden no tiene precio en ningún lado (fue cubierta 100% por el plan, que es
        // lo normal), igual se crea el movimiento ORDEN con importe 0: así aparece en
        // "Pendientes de Facturar" y se le pone el precio al facturar (editar costo de la orden).
        if (!od || !cli) {
          logger.warn(`[REVERTIR] No se pudo crear la deuda: falta la orden o el cliente (OrdIdOrden=${OrdIdOrden} ordEncontrada=${!!od} cli=${cli || 'NULL'})`);
        } else {
          const cueTipo = (od.MonIdMoneda === 2) ? 'DINERO_USD' : 'DINERO_UYU';
          const ctaRes = await transaction.request()
            .input('Cli', sqlOrd.Int, cli).input('T', sqlOrd.VarChar(20), cueTipo)
            .query(`SELECT TOP 1 CueIdCuenta, CueSaldoActual FROM dbo.CuentasCliente WITH(UPDLOCK)
                    WHERE CliIdCliente=@Cli AND CueTipo=@T AND CueActiva=1 ORDER BY CueIdCuenta`);
          if (!ctaRes.recordset.length) {
            logger.warn(`[REVERTIR] El cliente ${cli} no tiene cuenta ${cueTipo} → no se pudo crear la deuda`);
          } else {
            const cta        = ctaRes.recordset[0];
            const nuevoSaldo = Math.round((Number(cta.CueSaldoActual) - costo) * 100) / 100;
            const concepto   = ((od.OrdCodigoOrden || '').trim() + ' ' + (od.OrdNombreTrabajo || '').trim()).trim();

            await transaction.request().input('C', sqlOrd.Int, cta.CueIdCuenta).input('S', sqlOrd.Decimal(18,4), nuevoSaldo)
              .query('UPDATE dbo.CuentasCliente SET CueSaldoActual = @S WHERE CueIdCuenta = @C');

            await transaction.request()
              .input('C',   sqlOrd.Int,           cta.CueIdCuenta)
              .input('Imp', sqlOrd.Decimal(18,4), -costo)
              .input('SP',  sqlOrd.Decimal(18,4), nuevoSaldo)
              .input('Con', sqlOrd.NVarChar(300), concepto)
              .input('Ord', sqlOrd.Int,           OrdIdOrden)
              .input('Usr', sqlOrd.Int,           req.user?.id || 1)
              .query(`INSERT INTO dbo.MovimientosCuenta
                        (CueIdCuenta, MovTipo, MovImporte, MovConcepto, MovSaldoPosterior,
                         MovFecha, MovUsuarioAlta, OrdIdOrden, MovAnulado)
                      VALUES (@C, 'ORDEN', @Imp, @Con, @SP, GETDATE(), @Usr, @Ord, 0)`);

            ordenReactivada = true;
            logger.info(costo > 0
              ? `[REVERTIR] Orden ${concepto} SIN movimiento ORDEN previo → creada en ${cueTipo} (Cue=${cta.CueIdCuenta}) por ${costo} [costo desde ${origenCosto}]. Ya aparece en Pendientes de Facturar.`
              : `[REVERTIR] Orden ${concepto} SIN movimiento ORDEN previo y SIN precio (cubierta 100% por plan) → creada en ${cueTipo} (Cue=${cta.CueIdCuenta}) con importe 0. Aparece en Pendientes de Facturar; ponerle el precio al facturar.`);
          }
        }
      }
      if (ordRes.recordset.length) {
        const orden = ordRes.recordset[0];
        const obsO  = orden.MovObservaciones || '';
        const cubierta = /^CUBIERTO/i.test(obsO) || /^MATERIAL_CUBIERTO/i.test(obsO);
        logger.info(`[REVERTIR] ORDEN hallada Mov=${orden.MovIdMovimiento} importe=${orden.MovImporte} obs="${obsO}" cubierta=${cubierta} facturada=${!!orden.DocIdDocumento}`);
        if (!cubierta) logger.warn(`[REVERTIR] La ORDEN no está marcada CUBIERTO → no hay nada que reactivar (obs="${obsO}")`);
        if (orden.DocIdDocumento) logger.warn(`[REVERTIR] La ORDEN ya está FACTURADA (DocId=${orden.DocIdDocumento}) → no se reactiva`);
        if (cubierta && !orden.DocIdDocumento) {
          // Revertir CREDITO_PLAN (servicios) — restaura el importe original de la orden
          const credRes = await transaction.request().input('Ord', sqlOrd.Int, OrdIdOrden).query(`
            SELECT MovIdMovimiento, CueIdCuenta, MovImporte FROM dbo.MovimientosCuenta
            WHERE OrdIdOrden = @Ord AND MovTipo = 'CREDITO_PLAN' AND (MovAnulado IS NULL OR MovAnulado = 0)`);
          let creditoRestaurar = 0;
          for (const c of credRes.recordset) {
            creditoRestaurar += Number(c.MovImporte);
            await transaction.request().input('C', sqlOrd.Int, c.CueIdCuenta).input('Imp', sqlOrd.Decimal(18,4), Number(c.MovImporte))
              .query('UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Imp WHERE CueIdCuenta = @C');
            await transaction.request().input('M', sqlOrd.Int, c.MovIdMovimiento)
              .query("UPDATE dbo.MovimientosCuenta SET MovAnulado = 1, MovObservaciones = CONCAT(ISNULL(MovObservaciones,''),' [REVERTIDO]') WHERE MovIdMovimiento = @M");
          }
          const importeOriginal = Math.round((Math.abs(Number(orden.MovImporte)) + creditoRestaurar) * 100) / 100;
          // Restaurar la ORDEN: importe original + quitar la marca CUBIERTO
          await transaction.request().input('M', sqlOrd.Int, orden.MovIdMovimiento).input('Imp', sqlOrd.Decimal(18,4), -importeOriginal)
            .query('UPDATE dbo.MovimientosCuenta SET MovImporte = @Imp, MovObservaciones = NULL WHERE MovIdMovimiento = @M');
          // Restaurar la deuda de la orden → PENDIENTE
          await transaction.request().input('Ord', sqlOrd.Int, OrdIdOrden).input('Imp', sqlOrd.Decimal(18,4), importeOriginal)
            .query("UPDATE dbo.DeudaDocumento SET DDeImportePendiente = @Imp, DDeEstado = 'PENDIENTE' WHERE OrdIdOrden = @Ord AND DDeEstado IN ('CANCELADO','CANCELADA','PARCIAL')");
          // Revertir el ciclo (si estaba en un ciclo abierto)
          if (orden.CicIdCiclo) {
            await transaction.request().input('Cic', sqlOrd.Int, orden.CicIdCiclo).input('Imp', sqlOrd.Decimal(18,4), importeOriginal)
              .query('UPDATE dbo.CiclosCredito SET CicTotalPagos = CicTotalPagos - @Imp, CicSaldoFacturar = CicSaldoFacturar + @Imp WHERE CicIdCiclo = @Cic');
          }
          ordenReactivada = true;
          logger.info(`[REVERTIR] ORDEN Mov=${orden.MovIdMovimiento} REACTIVADA → obs=NULL, importe=${importeOriginal}, deuda→PENDIENTE. Ya debería aparecer en Pendientes de Facturar.`);
        }
      }
    }

    logger.info(`[REVERTIR] FIN Mov=${MovIdMovimiento} metrosDevueltos=${importeAbs} plan=${targetPlanId || 'NULL'} ordenReactivada=${ordenReactivada}`);
    await transaction.commit();
    const msg = reactivarOrden
      ? 'Consumo revertido. Metros devueltos al plan' + (ordenReactivada ? ' y la orden vuelve a pendiente de facturar.' : '.')
      : 'Movimiento eliminado y saldo restaurado.';
    res.json({ success: true, message: msg });
  } catch (err) {
    if (transaction) try { await transaction.rollback(); } catch(_){}
    res.status(500).json({ error: err.message });
  }
});

// POST /contabilidad/ordenes/insertar-manual
// Inserta una orden manual (movimiento tipo ORDEN) en una cuenta MTS
router.post('/ordenes/insertar-manual', async (req, res) => {
  const { CueIdCuenta, CliIdCliente, codigoOrden, nombreTrabajo, metros, planId } = req.body;
  if (!CueIdCuenta || !codigoOrden || metros === undefined) {
    return res.status(400).json({ error: 'Faltan datos: CueIdCuenta, codigoOrden, metros' });
  }
  const metrosNum = parseFloat(metros);
  let transaction;
  try {
    const pool = await getPoolOrd();

    // Verificar saldo actual
    const cueRes = await pool.request()
      .input('CueId', sqlOrd.Int, CueIdCuenta)
      .query('SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueId');
    if (!cueRes.recordset.length) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const saldoActual   = Number(cueRes.recordset[0].CueSaldoActual);
    const saldoPosterior = saldoActual - metrosNum;

    // Si hay planId, incluirlo en el concepto para que aparezca en la tabla de entregas del plan
    let concepto = nombreTrabajo
      ? `${codigoOrden} - ${nombreTrabajo}`
      : codigoOrden;
    if (planId) concepto += ` (Plan ${planId})`;

    transaction = pool.transaction();
    await transaction.begin();

    // Insertar movimiento
    await transaction.request()
      .input('CueId',     sqlOrd.Int,           CueIdCuenta)
      .input('Concepto',  sqlOrd.NVarChar(500),  concepto)
      .input('Importe',   sqlOrd.Decimal(18,4),  -metrosNum)
      .input('SaldoPost', sqlOrd.Decimal(18,4),  saldoPosterior)
      .input('Usr',       sqlOrd.Int,            req.user?.id || 1)
      .query(`
        INSERT INTO dbo.MovimientosCuenta
          (CueIdCuenta, MovTipo, MovImporte, MovConcepto, MovSaldoPosterior, MovFecha, MovUsuarioAlta)
        VALUES
          (@CueId, 'ENTREGA', @Importe, @Concepto, @SaldoPost, GETDATE(), @Usr)
      `);

    // Descontar saldo
    await transaction.request()
      .input('CueId',   sqlOrd.Int,          CueIdCuenta)
      .input('Metros',  sqlOrd.Decimal(18,4), metrosNum)
      .query('UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Metros WHERE CueIdCuenta = @CueId');

    // Actualizar cantidad usada en el plan
    // OJO: PlaIdPlan puede ser 0 (válido). No usar chequeos "truthy" que lo descarten.
    let targetPlanId = (planId !== undefined && planId !== null && String(planId).trim() !== '') ? parseInt(planId) : null;
    if (targetPlanId === null || Number.isNaN(targetPlanId)) {
      const activePlanRes = await transaction.request()
        .input('CueId', sqlOrd.Int, CueIdCuenta)
        .query('SELECT TOP 1 PlaIdPlan FROM dbo.PlanesMetros WHERE CueIdCuenta = @CueId AND PlaActivo = 1');
      if (activePlanRes.recordset.length) {
        targetPlanId = activePlanRes.recordset[0].PlaIdPlan;
      }
    }

    if (targetPlanId !== null && !Number.isNaN(targetPlanId)) {
      await transaction.request()
        .input('PlanId', sqlOrd.Int,          targetPlanId)
        .input('Metros', sqlOrd.Decimal(18,4), metrosNum)
        .query(`
          UPDATE dbo.PlanesMetros
          SET PlaCantidadUsada = PlaCantidadUsada + @Metros
          WHERE PlaIdPlan = @PlanId;
          
          UPDATE dbo.PlanesMetros
          SET PlaActivo = CASE WHEN PlaCantidadUsada < PlaCantidadTotal THEN 1 ELSE 0 END
          WHERE PlaIdPlan = @PlanId;
        `);
    }

    await transaction.commit();
    res.json({ success: true, message: `Orden ${codigoOrden} insertada correctamente` });
  } catch (err) {
    if (transaction) try { await transaction.rollback(); } catch(_){}
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



