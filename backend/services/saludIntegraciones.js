'use strict';
// Salud de las integraciones de afuera (23/10/2026), para el monitor del servidor (/admin/monitor). Cada integración
// avisa acá cuando le sale bien o mal (una línea en su punto de éxito y otra en su catch): así se ve cuándo respondió
// bien por última vez y cuántas fallas lleva, y las fallas silenciosas se notan el mismo día y no días después.
// DGI se muestra desde la base, solo informativo: cuándo se aceptó el último CFE. No alerta: muchos e-tickets
// contado quedan PENDIENTE como estado normal (1.425 en la copia local, desde junio), así que «pendientes» no indica
// una falla. POSLink y la cotización BCU ya están en los jobs.
// En memoria: arranca vacío con cada reinicio del backend («sin datos» hasta el primer uso).
const NOMBRES = {
    mercadopago: 'MercadoPago (webhook)',
    handy: 'Handy (links de pago)',
    mail: 'Mail (Resend)',
    drive: 'Google Drive',
    gemini: 'IA (Gemini)',
    whatsapp: 'WhatsApp (Callbell)',
};
const estado = {};            // clave → { ultimoOk, ultimaFalla, ultimoError, oks: [ts], fallas: [ts] }
const HORA = 3600 * 1000;

function registro(clave) {
    if (!estado[clave]) estado[clave] = { ultimoOk: null, ultimaFalla: null, ultimoError: null, oks: [], fallas: [] };
    return estado[clave];
}
const recortar = (arr) => { const desde = Date.now() - HORA; while (arr.length && arr[0] < desde) arr.shift(); };

function ok(clave) {
    try {
        const r = registro(clave);
        r.ultimoOk = Date.now();
        r.oks.push(r.ultimoOk); recortar(r.oks);
    } catch (_) { /* nunca romper al que avisa */ }
}

function falla(clave, error) {
    try {
        const r = registro(clave);
        r.ultimaFalla = Date.now();
        r.ultimoError = String(error?.message || error || 'sin detalle').slice(0, 240);
        r.fallas.push(r.ultimaFalla); recortar(r.fallas);
    } catch (_) { /* nunca romper al que avisa */ }
}

// DGI: hace cuánto se aceptó el último CFE. Lo llama el monitor cada minuto.
let dgiCache = null;
async function medirDgi() {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT DATEDIFF(MINUTE, MAX(CfeFechaDgi), GETDATE()) AS ultimoAceptadoHaceMin
            FROM dbo.DocumentosContables WITH(NOLOCK) WHERE CfeEstado = 'ACEPTADO_DGI'`);
        dgiCache = { ultimoAceptadoHaceMin: r.recordset[0].ultimoAceptadoHaceMin };
    } catch (e) {
        dgiCache = { error: e.message };
    }
    return dgiCache;
}

/** Lo que muestra el monitor: una fila por integración, con su nivel. */
function snapshot() {
    const ahora = Date.now();
    const filas = Object.entries(NOMBRES).map(([clave, nombre]) => {
        const r = estado[clave];
        if (clave === 'whatsapp' && process.env.WSP_ENABLED === 'false') return { clave, nombre, nivel: 'apagado', texto: 'Apagado en el .env (WSP_ENABLED=false)' };
        if (!r) return { clave, nombre, nivel: 'sin-datos', texto: 'Sin uso desde que arrancó el backend' };
        recortar(r.oks); recortar(r.fallas);
        // Mal: la última vez falló y no salió bien en la última hora. Atención: hubo fallas en la última hora.
        const ultimaFallo = r.ultimaFalla && (!r.ultimoOk || r.ultimaFalla > r.ultimoOk);
        const nivel = ultimaFallo && (!r.ultimoOk || ahora - r.ultimoOk > HORA) ? 'mal' : r.fallas.length ? 'atencion' : 'ok';
        return {
            clave, nombre, nivel,
            ultimoOk: r.ultimoOk ? new Date(r.ultimoOk).toISOString() : null,
            ultimaFalla: r.ultimaFalla ? new Date(r.ultimaFalla).toISOString() : null,
            ultimoError: r.ultimoError,
            oksHora: r.oks.length, fallasHora: r.fallas.length,
        };
    });
    if (dgiCache) {
        const d = dgiCache;
        filas.push(d.error
            ? { clave: 'dgi', nombre: 'DGI (CFE)', nivel: 'sin-datos', texto: d.error }
            : { clave: 'dgi', nombre: 'DGI (CFE)', nivel: 'info', ultimoOkHaceMin: d.ultimoAceptadoHaceMin, texto: 'Último CFE aceptado' });
    }
    return filas;
}

module.exports = { ok, falla, snapshot, medirDgi };
