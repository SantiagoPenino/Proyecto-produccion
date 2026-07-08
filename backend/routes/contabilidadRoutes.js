'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/contabilidadController');
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
  const { MovIdMovimiento } = req.body;
  if (!MovIdMovimiento) return res.status(400).json({ error: 'Falta MovIdMovimiento' });

  let transaction;
  try {
    const pool = await getPoolOrd();
    const movRes = await pool.request()
      .input('Mid', sqlOrd.Int, MovIdMovimiento)
      .query('SELECT MovImporte, CueIdCuenta, MovConcepto, MovObservaciones FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @Mid');
    if (!movRes.recordset.length) return res.status(404).json({ error: 'Movimiento no encontrado' });

    const importeAbs  = Math.abs(Number(movRes.recordset[0].MovImporte));
    const CueIdCuenta = movRes.recordset[0].CueIdCuenta;
    const MovConcepto = movRes.recordset[0].MovConcepto;
    const MovObservaciones = movRes.recordset[0].MovObservaciones;

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

    await transaction.commit();
    res.json({ success: true, message: 'Movimiento eliminado y saldo restaurado' });
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



