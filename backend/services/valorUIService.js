'use strict';
// Valor de la Unidad Indexada para el tope del e-Ticket (ConfiguracionGlobal.DGI_VALOR_UI),
// traído del BCU con el mismo web service de la cotización del dólar (moneda 9800).
//
// Fecha: la UI del 31/12 del año anterior. SISNET rechazó el 26/10/2026 un e-Ticket por
// «venta mayor a 5000.0 U.I. ($32117.0)»: 32.117 ÷ 5.000 = 6,4234, que es la UI del 31/12/2025
// según el BCU (la del día era 6,6780). Si un rechazo futuro trae otro monto, la UI que usa
// SISNET es ese monto ÷ 5.000: revisar esta fecha.
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { fetchUnidadIndexadaBCU } = require('../jobs/cotizacionBCU.job');

const CLAVE_VALOR = 'DGI_VALOR_UI';
const CLAVE_FECHA = 'DGI_VALOR_UI_FECHA';             // de qué día es la UI guardada (AAAA-MM-DD)
const CLAVE_ACTUALIZADO = 'DGI_VALOR_UI_ACTUALIZADO'; // cuándo se trajo del BCU (ISO)

// Uruguay no tiene horario de verano: UTC−3 fijo.
function fechaReferenciaUI(ahora = new Date()) {
    const anio = new Date(ahora.getTime() - 3 * 3600 * 1000).getUTCFullYear();
    return `${anio - 1}-12-31`;
}

async function guardarClave(pool, clave, valor) {
    await pool.request()
        .input('K', sql.VarChar(50), clave)
        .input('V', sql.VarChar(100), String(valor))
        .query(`UPDATE dbo.ConfiguracionGlobal SET Valor = @V WHERE Clave = @K;
                IF @@ROWCOUNT = 0 INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES (@K, 'ADMIN', @V);`);
}

async function leerValorUI(pool) {
    const r = await pool.request().query(`
        SELECT Clave, Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK)
        WHERE Clave IN ('${CLAVE_VALOR}', '${CLAVE_FECHA}', '${CLAVE_ACTUALIZADO}')`);
    const map = {};
    r.recordset.forEach(x => { map[x.Clave] = x.Valor; });
    return {
        valorUI: parseFloat(String(map[CLAVE_VALOR] || '').replace(',', '.')) || null,
        fechaUI: map[CLAVE_FECHA] || null,
        actualizadoUI: map[CLAVE_ACTUALIZADO] || null,
    };
}

// Trae del BCU la UI de la fecha de referencia y la guarda. La UI del 31/12 cambia una vez por
// año: sin `forzar`, si ya está guardada la de esa fecha no se consulta al BCU.
// Si el BCU no contesta, lanza el error y queda el valor anterior.
async function actualizarValorUI({ forzar = false } = {}) {
    const pool = await getPool();
    const fecha = fechaReferenciaUI();
    const actual = await leerValorUI(pool);
    if (!forzar && actual.fechaUI === fecha && actual.valorUI > 0) return actual;

    const valorUI = await fetchUnidadIndexadaBCU(fecha);
    const actualizadoUI = new Date().toISOString();
    await guardarClave(pool, CLAVE_VALOR, valorUI);
    await guardarClave(pool, CLAVE_FECHA, fecha);
    await guardarClave(pool, CLAVE_ACTUALIZADO, actualizadoUI);
    if (valorUI !== actual.valorUI) {
        logger.info(`[VALOR UI] UI del ${fecha} según el BCU: ${valorUI} (antes: ${actual.valorUI ?? 'sin valor'}${actual.fechaUI ? `, del ${actual.fechaUI}` : ''}).`);
    }
    return { valorUI, fechaUI: fecha, actualizadoUI };
}

module.exports = { actualizarValorUI, leerValorUI, fechaReferenciaUI };
