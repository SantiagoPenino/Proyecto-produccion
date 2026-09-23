const logger = require('./logger');

/**
 * Pasa un stream de origen (Drive, otra URL) a la respuesta de una descarga.
 *
 * Con un `pipe` pelado quedaban dos cabos sueltos (caso archivo 44991, 23/09):
 *  - Si el ORIGEN corta a mitad ("Premature close" de Drive), los encabezados ya salieron y pipe no
 *    cierra la respuesta. Con el socket sin timeout, la descarga quedaba colgada en el navegador
 *    para siempre. Ahora la respuesta se corta y el navegador la da por fallida (o recibe un 502 si
 *    todavía no había salido nada).
 *  - Si el que corta es el NAVEGADOR, el origen quedaba abierto y en pausa hasta que el otro lado
 *    cerraba por inactividad, y eso también terminaba en un "Premature close" en el log. Ahora se
 *    suelta el origen en el momento, y ese corte se registra como info, no como error.
 * Además, sin un listener de 'error' en el origen, un corte podía tirar abajo el proceso.
 *
 * @param {import('stream').Readable} origen
 * @param {import('http').ServerResponse} res
 * @param {string} etiqueta prefijo para el log (ej. "[download-file 44991]")
 */
function enviarDescarga(origen, res, etiqueta) {
    let navegadorCorto = false;

    res.on('close', () => {
        if (res.writableFinished) return;
        navegadorCorto = true;
        origen.destroy();
    });

    origen.on('error', (e) => {
        if (navegadorCorto) {
            logger.info(`${etiqueta} El navegador cortó la descarga (${e.message}).`);
            return;
        }
        logger.error(`${etiqueta} El origen cortó la descarga: ${e.message}`);
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
    });

    origen.pipe(res);
}

module.exports = { enviarDescarga };
