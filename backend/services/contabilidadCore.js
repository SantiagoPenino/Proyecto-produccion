'use strict';
/**
 * contabilidadCore.js
 * ──────────────────────────────────────────────────────────────────
 * Motor Central de Contabilidad Bimonetaria ERP.
 *
 * Las cuentas contables ya NO están hardcodeadas aquí.
 * Se leen desde Cont_EventosContables vía motorContable.js,
 * usando el campo EvtCodigo como clave para cada tipo de operación.
 *
 * Para operaciones que SÍ tienen reglas en el Motor, se usan esas.
 * Para operaciones legacy sin reglas, se usa el fallback de CUENTAS.
 *
 * CUENTAS es ahora solo un fallback de última instancia.
 * La fuente de verdad es la BD.
 */

const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// ─── Fallback: cuentas por defecto si el Motor no tiene reglas configuradas ─
// Estos valores son el "último recurso". Lo ideal es que estén en el Motor.
const CUENTAS = {
  CAJA_UYU:    '1.1.1',
  CAJA_USD:    '1.1.2',
  CLIENTE_UYU: '1.2.1',
  CLIENTE_USD: '1.2.2',
  IVA_22:      '2.2.1',
  IVA_10:      '2.2.2',
  VENTA_SERV:  '4.1.1',
  VENTA_PROD:  '4.1.2',
  ANTICIPOS:   '2.3.1',
};

/**
 * Obtiene el CueId de una cuenta basándose en su CueCodigo.
 */
const getCuentaId = async (codigo, externalTx = null) => {
  const pool = externalTx ? null : await getPool();
  const request = externalTx ? new sql.Request(externalTx) : pool.request();
  const res = await request.input('Cod', sql.VarChar(20), codigo).query(
    `SELECT CueId FROM dbo.Cont_PlanCuentas WITH(NOLOCK) WHERE CueCodigo = @Cod AND CueImputable = 1`
  );
  if (!res.recordset.length) throw new Error(`La cuenta contable ${codigo} no existe o no es imputable.`);
  return res.recordset[0].CueId;
};

/**
 * Resuelve las líneas de asiento para un evento, usando el Motor.
 * Reemplaza los metavalores META_CLIENTE y META_CAJA con las cuentas reales.
 *
 * @param {string} evtCodigo   Ej: 'PAGO', 'ORDEN', 'ENTRADA', 'ENTREGA'
 * @param {object} ctx         { moneda, clienteId, totalNeto, totalBruto, iva, pagosNorm }
 * @returns {Array} lineas para generarAsientoCompleto, o [] si no hay reglas
 */
const resolverLineasDesdeMotor = async (evtCodigo, ctx = {}) => {
  // Importamos el motor aquí para evitar require circular
  const motor = require('./motorContable');
  const reglas = await motor.getReglasAsiento(evtCodigo);
  if (!reglas || reglas.length === 0) return [];

  const isUSD = ctx.moneda === 'USD';
  const cotiz = ctx.cotizacion || 1;
  const monedaId = isUSD ? 2 : 1;
  const cuentaClienteFallback = isUSD ? CUENTAS.CLIENTE_USD : CUENTAS.CLIENTE_UYU;
  const cuentaCajaFallback    = isUSD ? CUENTAS.CAJA_USD    : CUENTAS.CAJA_UYU;

  const formulaMap = {
    TOTAL:     Math.abs(ctx.totalNeto  || ctx.totalBruto || 0),
    NETO:      Math.abs(ctx.neto       || 0),
    IVA:       Math.abs(ctx.ivaMonto   || ctx.iva || 0),
    DESCUENTO: Math.abs(ctx.descuento  || 0),
  };

  const lineas = reglas.map(r => {
    let cuenta = r.CueCodigo;
    if (cuenta === 'META_CLIENTE') cuenta = cuentaClienteFallback;
    if (cuenta === 'META_CAJA')    cuenta = cuentaCajaFallback;

    const importe = formulaMap[r.RasFormula] ?? formulaMap.TOTAL;
    return {
      codigoCuenta: cuenta,
      debeBase:  r.RasNaturaleza === 'DEBE'  ? importe : 0,
      haberBase: r.RasNaturaleza === 'HABER' ? importe : 0,
      monedaId,
      cotizacion: cotiz,
      entidadId:   ctx.clienteId || null,
      entidadTipo: 'CLIENTE',
    };
  });

  return lineas;
};

/**
 * Función Principal del Motor Contable.
 * Toma un conjunto de operaciones "Lógicas" y las transcribe
 * a Débitos y Créditos con manejo Multi-Moneda obligatoria.
 *
 * @param {Object} params Parámetros del asiento.
 * @param {Object} transaction Contexto transaccional de SQL Server (obligatorio para atomicidad).
 * @returns {Integer} AsiId generado.
 */
const generarAsientoCompleto = async ({
  fecha = new Date(),
  concepto,
  usuarioId,
  tcaIdTransaccion = null,
  origen = 'CAJA',
  lineas = []
}, transaction) => {

  if (!transaction) throw new Error('[CONTABILIDAD] Se requiere un contexto de transacción (pool.transaction()) activo.');
  if (!lineas || lineas.length < 2) throw new Error('[CONTABILIDAD] Un asiento requiere mínimo 2 líneas (Partida Doble).');

  try {
    const request = new sql.Request(transaction);

    // 1. VALIDACIÓN PARTIDA DOBLE
    let sumaDebeUYU = 0;
    let sumaHaberUYU = 0;

    const lineasProcesadas = [];
    for (const l of lineas) {
      const isUSD = (l.monedaId === 2);
      const cotiz = (isUSD && l.cotizacion) ? parseFloat(l.cotizacion) : 1;

      const valDebeLoc  = (parseFloat(l.debeBase)  || 0) * cotiz;
      const valHaberLoc = (parseFloat(l.haberBase) || 0) * cotiz;

      sumaDebeUYU  += valDebeLoc;
      sumaHaberUYU += valHaberLoc;

      lineasProcesadas.push({
        ...l,
        CueId: await getCuentaId(l.codigoCuenta, transaction),
        debeUYU:         valDebeLoc,
        haberUYU:        valHaberLoc,
        importeOriginal: (parseFloat(l.debeBase) || 0) + (parseFloat(l.haberBase) || 0),
        cotizacion:      cotiz,
        monedaId:        l.monedaId || 1
      });
    }

    // Tolerancia técnica por redondeos
    if (Math.abs(sumaDebeUYU - sumaHaberUYU) > 0.02) {
      throw new Error(`[CONTABILIDAD] Error de Cuadre: Debe ($${sumaDebeUYU.toFixed(2)}) != Haber ($${sumaHaberUYU.toFixed(2)})`);
    }

    // 2. CABECERA
    const resCab = await request
      .input('Fecha',   sql.DateTime,    fecha)
      .input('Concepto',sql.NVarChar(200), concepto)
      .input('UsuarioId',sql.Int,         usuarioId)
      .input('TcaId',   sql.Int,          tcaIdTransaccion)
      .input('Origen',  sql.VarChar(50),  origen)
      .query(`
        INSERT INTO dbo.Cont_AsientosCabecera (AsiFecha, AsiConcepto, UsuarioId, TcaIdTransaccion, SysOrigen, AsiEstado)
        OUTPUT INSERTED.AsiId
        VALUES (@Fecha, @Concepto, @UsuarioId, @TcaId, @Origen, 'REGISTRADO')
      `);

    const asiId = resCab.recordset[0].AsiId;

    // 3. DETALLES
    for (const linea of lineasProcesadas) {
      if (linea.debeUYU === 0 && linea.haberUYU === 0) continue;

      const reqDet = new sql.Request(transaction);
      await reqDet
        .input('AsiId',       sql.Int,          asiId)
        .input('CueId',       sql.Int,          linea.CueId)
        .input('Debe',        sql.Decimal(18,2), linea.debeUYU)
        .input('Haber',       sql.Decimal(18,2), linea.haberUYU)
        .input('ImporteOrig', sql.Decimal(18,2), linea.importeOriginal)
        .input('Cotiz',       sql.Decimal(18,4), linea.cotizacion)
        .input('MonedaId',    sql.Int,           linea.monedaId)
        .input('EntId',       sql.Int,           linea.entidadId   || null)
        .input('EntTipo',     sql.VarChar(20),   linea.entidadTipo || null)
        .query(`
          INSERT INTO dbo.Cont_AsientosDetalle
            (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
          VALUES
            (@AsiId, @CueId, @Debe, @Haber, @ImporteOrig, @Cotiz, @MonedaId, @EntId, @EntTipo)
        `);
    }

    logger.info(`[CONTABILIDAD] ✅ Asiento #${asiId} Registrado. Concepto: "${concepto}" (Debe: $${sumaDebeUYU.toFixed(2)})`);
    return asiId;

  } catch (err) {
    logger.error('[CONTABILIDAD] Fallo al generar asiento:', err.message);
    throw err;
  }
};

/**
 * Utilidad: Desglose Top-Down para precios IVA Incluido (DGI Uruguay).
 */
const desglosarIVA = (totalMonto, tasaIVA = 22) => {
  const monto = parseFloat(totalMonto) || 0;
  if (tasaIVA === 0 || monto === 0) return { neto: monto, ivaMonto: 0 };
  const factor = 1 + (tasaIVA / 100);
  const neto = monto / factor;
  const ivaMonto = monto - (Math.round(neto * 100) / 100);
  return {
    neto:     Math.round(neto     * 100) / 100,
    ivaMonto: Math.round(ivaMonto * 100) / 100
  };
};

module.exports = {
  CUENTAS,              // Fallback — usar solo si Motor no tiene reglas
  generarAsientoCompleto,
  resolverLineasDesdeMotor, // NUEVO: construye líneas desde Motor
  desglosarIVA,
  getCuentaId
};
