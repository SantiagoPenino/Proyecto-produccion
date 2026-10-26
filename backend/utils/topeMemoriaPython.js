/**
 * Tope de memoria para los Python que lanza el backend (23/10/2026).
 *
 * El 21 y el 22/10 un python llegó a 12–13,6 GB y el OOM killer del VPS (15 GB + 4 de swap, con el
 * SQL y TIZADA adentro) lo mató; el backend se cayó con él. La capa de blanco DTF ya tiene su freno
 * propio (dtfBlancoService + DTF_BLANCO_MAX_MEM_MB, que no usa esto); acá está el de los demás
 * scripts: antes de lanzarlos se calcula cuánto pueden usar y se les pasa en PY_MAX_MEM_MB.
 * python/_tope_memoria.py lo aplica con RLIMIT_DATA: si el script lo necesita, falla SOLO él con
 * MemoryError (y lo devuelve como su error de siempre) en vez de que el sistema mate a otro proceso.
 *
 * Tope = memoria libre (MemAvailable + swap libre) − 1 GB de reserva para el resto del servidor,
 * como mucho PYTHON_MAX_MEM_MB y como poco 256 MB (que un script chico arranque igual).
 * Sin /proc/meminfo (Windows, copia local) no hay tope y todo corre como antes.
 *
 * Uso:
 *   const env = entornoConTope();                          // process.env + PY_MAX_MEM_MB
 *   execFile(python, args, { env, ... }, (err, stdout, stderr) => {
 *       ... if (err) logger.warn(describirFallo(err, stderr, env));
 *   });
 *
 * Config (env): PYTHON_MAX_MEM_MB (default 6144).
 */
const fs = require('fs');

const VARIABLE = 'PY_MAX_MEM_MB';
const MAX_DEFAULT_MB = 6144;
const MIN_MB = 256;
const RESERVA_MB = 1024;      // lo que se deja libre para el resto del servidor

/** Memoria que puede usar un proceso ahora (MB): MemAvailable + swap libre. null fuera de Linux. */
function memoriaLibreMb() {
    let t;
    try { t = fs.readFileSync('/proc/meminfo', 'utf8'); }
    catch (_) { return null; }   // sin /proc/meminfo (Windows, copia local): sin tope
    const kb = (clave) => Number((t.match(new RegExp(`^${clave}:\\s+(\\d+)`, 'm')) || [])[1] || 0);
    const total = (kb('MemAvailable') + kb('SwapFree')) / 1024;
    return total > 0 ? Math.floor(total) : null;
}

/** Tope en MB para el próximo Python, o null si no se puede calcular (sin tope). */
function topeMb() {
    const libre = memoriaLibreMb();
    if (libre == null) return null;
    const max = Number(process.env.PYTHON_MAX_MEM_MB) || MAX_DEFAULT_MB;
    return Math.max(MIN_MB, Math.min(max, libre - RESERVA_MB));
}

/** Entorno para el proceso hijo: el de `base` + PY_MAX_MEM_MB si hay tope (si no, `base` tal cual). */
function entornoConTope(base = process.env) {
    const tope = topeMb();
    return tope ? { ...base, [VARIABLE]: String(tope) } : base;
}

// Lo que dejan en stderr un MemoryError de Python, un bad_alloc de C++ (onnxruntime: «Failed to allocate»)
// o un mmap que no consiguió memoria
const RE_SIN_MEMORIA = /MemoryError|sin memoria suficiente|bad_alloc|Failed to allocate|Cannot allocate memory|Unable to allocate|out of memory/i;

/** Si el error que devolvió el script es por memoria, le agrega el tope que tenía (para el log). */
function anotarTope(mensaje, env) {
    const tope = env && env[VARIABLE];
    return tope && RE_SIN_MEMORIA.test(mensaje) ? `${mensaje} (tope de ${tope} MB)` : mensaje;
}

/**
 * Por qué falló un Python que no dejó su respuesta, en una sola línea para el log: si se quedó sin
 * memoria (con el tope que tenía), si lo cortaron (timeout o el sistema) o con qué código salió, y lo
 * último que dijo (el traceback). Sirve con el error de execFile o con { code, signal } de spawn.
 */
function describirFallo(err, stderr, env) {
    // Las últimas 3 líneas con texto (sin las de ^^^^ con que Python subraya la línea del traceback)
    const cola = String(stderr || '').split('\n').map(l => l.trim()).filter(l => l && !/^[\^~ ]+$/.test(l))
        .slice(-3).join(' | ').slice(0, 500);
    let corte = '';
    if (err && err.killed) corte = `cortado (${err.signal || 'timeout'})`;
    else if (err && err.signal) corte = `terminado por ${err.signal}`;
    else if (err && typeof err.code === 'number') corte = `salió con código ${err.code}`;
    else if (err && err.message) corte = err.message;        // ENOENT y otros: no llegó a correr
    const tope = env && env[VARIABLE];
    const memoria = RE_SIN_MEMORIA.test(cola) ? `sin memoria suficiente para procesarlo${tope ? ` (tope de ${tope} MB)` : ''}` : '';
    return [memoria, corte, cola].filter(Boolean).join(' — ') || 'fallo desconocido';
}

module.exports = { entornoConTope, describirFallo, anotarTope, topeMb, memoriaLibreMb, VARIABLE };
