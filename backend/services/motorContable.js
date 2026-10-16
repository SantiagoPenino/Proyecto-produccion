'use strict';
/**
 * motorContable.js
 * ──────────────────────────────────────────────────────────────────────
 * Motor de Reglas Contables Unificado.
 *
 * Lee Cont_EventosContables + Cont_ReglasAsiento para determinar:
 *   1. Comportamiento en Submayor (EvtAfectaSaldo, EvtGeneraDeuda, EvtAplicaRecurso)
 *   2. Asiento en Libro Mayor (líneas Debe/Haber de Cont_ReglasAsiento)
 *
 * Uso:
 *   const motor = require('./motorContable');
 *   const evt = await motor.getEvento('ORDEN');
 *   const reglas = await motor.getReglasAsiento('ORDEN');
 * ──────────────────────────────────────────────────────────────────────
 */

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Cache en memoria para evitar consultas repetidas
let _cache = {};
let _cacheTs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

async function _cargarCache() {
    const ahora = Date.now();
    if (_cacheTs && (ahora - _cacheTs) < CACHE_TTL_MS) return;

    const pool = await getPool();
    const evts = await pool.request().query(
        'SELECT * FROM dbo.Cont_EventosContables WHERE EvtActivo = 1'
    );
    const reglas = await pool.request().query(
        'SELECT * FROM dbo.Cont_ReglasAsiento ORDER BY EvtCodigo, RasOrden'
    );

    _cache = {};
    for (const evt of evts.recordset) {
        _cache[evt.EvtCodigo] = {
            ...evt,
            reglas: reglas.recordset.filter(r => r.EvtCodigo === evt.EvtCodigo)
        };
    }
    _cacheTs = ahora;
    logger.info(`[MOTOR_CONTABLE] Cache cargada: ${Object.keys(_cache).length} eventos`);
}

/**
 * Invalida el cache (llamar cuando se modifiquen las reglas desde el ABM)
 */
function invalidarCache() {
    _cacheTs = 0;
    logger.info('[MOTOR_CONTABLE] Cache invalidada');
}

/**
 * Obtiene un evento contable con sus reglas de asiento.
 * @param {string} codigo - EvtCodigo (ej: 'ORDEN', 'PAGO')
 * @returns {object|null}
 */
async function getEvento(codigo) {
    await _cargarCache();
    return _cache[codigo] || null;
}

/**
 * Obtiene solo las reglas de asiento de un evento.
 * @param {string} codigo
 * @returns {Array}
 */
async function getReglasAsiento(codigo) {
    const evt = await getEvento(codigo);
    return evt ? evt.reglas : [];
}

/**
 * Verifica si un tipo de movimiento genera deuda.
 * @param {string} codigo
 * @returns {boolean}
 */
async function generaDeuda(codigo) {
    const evt = await getEvento(codigo);
    return evt ? !!evt.EvtGeneraDeuda : false;
}

module.exports = {
    getEvento,
    getReglasAsiento,
    generaDeuda,
    invalidarCache,
};
