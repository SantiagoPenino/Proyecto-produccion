'use strict';
// Colas de procesos pesados (23/10/2026), para el monitor del servidor: la capa de blanco DTF, la matriz TPU y
// quitar fondo corren de a uno, y son los python que pueden llenar la RAM. Cada servicio avisa acá cuando encola,
// cuando empieza y cuando termina, y el monitor muestra qué está corriendo, desde hace cuánto y cuántos esperan.
// En memoria: arranca vacío con cada reinicio del backend.
const NOMBRES = { 'dtf-blanco': 'Capa de blanco DTF', 'tpu-matriz': 'Matriz TPU', 'quitar-fondo': 'Quitar fondo' };
const HORA = 3600 * 1000;
const colas = {};

const cola = (clave) => (colas[clave] = colas[clave] || { esperando: 0, actual: null, hechas: [] });

function encolado(clave) {
    try { cola(clave).esperando++; } catch (_) { /* nunca romper al que avisa */ }
}

function empezo(clave, detalle) {
    try {
        const c = cola(clave);
        c.esperando = Math.max(0, c.esperando - 1);
        c.actual = { detalle: String(detalle || '').slice(0, 80), desde: Date.now() };
    } catch (_) { /* nunca romper al que avisa */ }
}

function termino(clave, ok = true) {
    try {
        const c = cola(clave);
        const ms = c.actual ? Date.now() - c.actual.desde : null;
        c.actual = null;
        c.hechas.push({ t: Date.now(), ok, ms });
        const desde = Date.now() - HORA;
        while (c.hechas.length && c.hechas[0].t < desde) c.hechas.shift();
    } catch (_) { /* nunca romper al que avisa */ }
}

function snapshot() {
    const ahora = Date.now();
    return Object.entries(NOMBRES).map(([clave, nombre]) => {
        const c = colas[clave] || { esperando: 0, actual: null, hechas: [] };
        const hechas = c.hechas.filter(h => h.t >= ahora - HORA);
        const conMs = hechas.filter(h => h.ms != null);
        return {
            clave, nombre,
            esperando: c.esperando,
            actual: c.actual ? { detalle: c.actual.detalle, segundos: Math.round((ahora - c.actual.desde) / 1000) } : null,
            hechasHora: hechas.length,
            fallasHora: hechas.filter(h => !h.ok).length,
            promedioSeg: conMs.length ? Math.round(conMs.reduce((s, h) => s + h.ms, 0) / conMs.length / 1000) : null,
        };
    });
}

module.exports = { encolado, empezo, termino, snapshot };
