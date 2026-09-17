// =====================================================================
// REINTENTO ANTE DEADLOCK (error 1205)
// =====================================================================
// Ser víctima de un deadlock es normal y esperable en un sistema con varias
// operaciones escribiendo a la vez sobre las mismas tablas. SQL Server elige a una,
// la revierte ENTERA por su cuenta y pide textualmente "Rerun the transaction".
// Lo que no es normal es que el usuario vea un error 500 y pierda lo que estaba
// haciendo, que es lo que pasaba al editar una factura (07 y 10/09/2026).
//
// Reintentar es seguro porque el motor ya revirtió todo: no queda nada a medias.
// Solo se reintenta el 1205. Cualquier otro error se deja pasar tal cual.
//
// CÓMO SE USA (dos partes, las dos hacen falta):
//
//   1. En el handler, dentro del catch, DESPUÉS del rollback:
//          if (esDeadlock(err)) throw err;      // no respondas: que lo reintenten
//
//   2. En la ruta, envolviendo el handler:
//          router.put('/x', conReintentoDeadlock(ctrl.editar));
//
// Sin el paso 1 el handler responde 500 él mismo y ya no hay nada que reintentar.
// =====================================================================
const logger = require('./logger');

const NUMERO_DEADLOCK = 1205;

/** ¿Este error es "fuiste la víctima de un deadlock"? */
const esDeadlock = (err) =>
    err?.number === NUMERO_DEADLOCK ||
    err?.originalError?.info?.number === NUMERO_DEADLOCK;

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Envuelve un handler de Express y lo reintenta si murió por deadlock.
 *
 * @param {Function} handler            el handler (req, res) original
 * @param {object}   [opciones]
 * @param {number}   [opciones.intentos=3]   intentos totales, incluido el primero
 * @param {number}   [opciones.esperaMs=120] espera base entre intentos
 * @returns {Function} handler listo para la ruta
 */
function conReintentoDeadlock(handler, { intentos = 3, esperaMs = 120 } = {}) {
    return async function (req, res, next) {
        const etiqueta = `${req.method} ${req.originalUrl || req.url}`;

        for (let intento = 1; intento <= intentos; intento++) {
            try {
                return await handler(req, res, next);
            } catch (err) {
                if (!esDeadlock(err)) throw err;   // otro error: no es asunto nuestro

                // Si el handler ya contestó, no se puede reintentar sin mandar dos
                // respuestas. Se avisa fuerte porque significa que le falta el
                // `if (esDeadlock(err)) throw err;` antes de responder.
                if (res.headersSent) {
                    logger.error(`[DEADLOCK] ${etiqueta}: víctima de deadlock pero la respuesta ya salió — no se puede reintentar.`);
                    throw err;
                }

                if (intento === intentos) {
                    logger.error(`[DEADLOCK] ${etiqueta}: víctima ${intentos} veces seguidas. Se abandona.`);
                    return res.status(409).json({
                        error: 'La operación chocó con otra que estaba corriendo al mismo tiempo y no se pudo completar. ' +
                               'No se guardó nada: probá de nuevo en unos segundos.',
                        deadlock: true,
                    });
                }

                // Espera creciente con un poco de azar: si las dos transacciones que
                // chocaron reintentan al mismo tiempo, vuelven a chocar.
                const espera = esperaMs * intento + Math.floor(Math.random() * esperaMs);
                logger.warn(`[DEADLOCK] ${etiqueta}: víctima (intento ${intento}/${intentos}). Reintentando en ${espera} ms.`);
                await esperar(espera);
            }
        }
    };
}

module.exports = { conReintentoDeadlock, esDeadlock, NUMERO_DEADLOCK };
