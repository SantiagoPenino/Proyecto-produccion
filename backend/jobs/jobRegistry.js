'use strict';
/**
 * jobRegistry.js
 * Registro centralizado de todos los jobs del scheduler.
 * Permite consultar estado, próxima ejecución y disparar manualmente.
 */

const registry = {};

/**
 * Registra un job en el registro central.
 * @param {string} id         - Identificador único (ej: 'reconciliacion-contable')
 * @param {object} meta       - { nombre, descripcion, schedule }
 */
function registrar(id, meta) {
    registry[id] = {
        id,
        nombre:      meta.nombre      || id,
        descripcion: meta.descripcion || '',
        schedule:    meta.schedule    || 'Manual',
        estado:      'ESPERANDO',     // ESPERANDO | CORRIENDO | OK | ERROR
        proximaEjecucion: null,
        ultimaEjecucion:  null,
        ultimoResultado:  null,
        ultimoError:      null,
        fn: null,                     // función a llamar para ejecutar manualmente
    };
}

/** Asigna la función ejecutora de un job ya registrado */
function setFn(id, fn) {
    if (registry[id]) registry[id].fn = fn;
}

/** Actualiza la próxima ejecución programada */
function setProximaEjecucion(id, date) {
    if (registry[id]) registry[id].proximaEjecucion = date;
}

/** Marca el inicio de una ejecución */
function marcarInicio(id) {
    if (registry[id]) {
        registry[id].estado = 'CORRIENDO';
        registry[id].ultimaEjecucion = new Date();
    }
}

/** Marca el fin exitoso */
function marcarOk(id, resultado = 'Completado') {
    if (registry[id]) {
        registry[id].estado = 'OK';
        registry[id].ultimoResultado = resultado;
        registry[id].ultimoError = null;
    }
}

/** Marca un error */
function marcarError(id, error) {
    if (registry[id]) {
        registry[id].estado = 'ERROR';
        registry[id].ultimoError = typeof error === 'string' ? error : error?.message || String(error);
    }
}

/** Retorna el listado completo del registro */
function getAll() {
    return Object.values(registry).map(j => ({
        ...j,
        fn: undefined, // no serializar la función
    }));
}

/** Ejecuta un job manualmente por su id */
async function ejecutarManual(id) {
    const job = registry[id];
    if (!job) throw new Error(`Job "${id}" no encontrado.`);
    if (!job.fn) throw new Error(`Job "${id}" no tiene función ejecutable.`);
    if (job.estado === 'CORRIENDO') throw new Error(`Job "${id}" ya está en ejecución.`);

    marcarInicio(id);
    try {
        // Si el job devuelve un texto, ese es el resultado que se muestra (ej. el resumen
        // del cuadre de saldos); si no, el genérico.
        const resultado = await job.fn();
        marcarOk(id, typeof resultado === 'string' && resultado.trim() ? resultado : 'Ejecutado manualmente');
    } catch (e) {
        marcarError(id, e);
        throw e;
    }
}

module.exports = { registrar, setFn, setProximaEjecucion, marcarInicio, marcarOk, marcarError, getAll, ejecutarManual };
