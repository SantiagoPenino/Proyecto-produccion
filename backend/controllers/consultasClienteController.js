// =====================================================================
// CONSULTA AL CLIENTE — endpoints (internos y del portal)
// =====================================================================
// Plan: docs/consultas-cliente-plan.md
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const svc = require('../services/consultasClienteService');
const { moverFotosAConsulta, limpiarFotos, getConsultaFolder } = require('../middleware/multerConsultasConfig');

// =====================================================================
// INTERNO (planta)
// =====================================================================

// GET /api/consultas/motivos
exports.getMotivos = async (req, res) => {
    try {
        res.json({ success: true, data: await svc.getMotivos() });
    } catch (err) {
        logger.error(`[CONSULTAS] getMotivos: ${err.message}`);
        res.status(500).json({ error: 'No se pudieron leer los motivos.' });
    }
};

// GET /api/consultas/orden/:ordenId
exports.getPorOrden = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    if (!ordenId) return res.status(400).json({ error: 'Orden inválida.' });
    try {
        res.json({ success: true, data: await svc.getConsultasDeOrden(ordenId) });
    } catch (err) {
        logger.error(`[CONSULTAS] getPorOrden ${ordenId}: ${err.message}`);
        res.status(500).json({ error: 'No se pudieron leer las consultas de la orden.' });
    }
};

// POST /api/consultas  (multipart: fotos[] + campos)
exports.crear = async (req, res) => {
    const { ordenId, archivoId, motivoId, pregunta, bloquea } = req.body;
    const archivos = req.files || [];
    try {
        const r = await svc.crearConsulta({
            ordenId  : parseInt(ordenId, 10),
            archivoId: archivoId ? parseInt(archivoId, 10) : null,
            motivoId : parseInt(motivoId, 10),
            pregunta,
            // multipart manda strings: 'false' es truthy en JS y dejaría todo frenado.
            bloquea  : !(bloquea === false || bloquea === 'false' || bloquea === '0'),
            usuarioId: req.user?.id || req.user?.UsuarioID || 1,
            io       : req.app.get('socketio'),
        });

        // Las fotos se suben a `temp` porque el id todavía no existía: recién ahora
        // se pueden mudar a su carpeta y registrar.
        if (archivos.length) {
            const movidas = moverFotosAConsulta(archivos, r.consultaId);
            r.fotos = await svc.guardarFotos(r.consultaId, movidas);
        }

        avisarAlCliente(r, archivos.length).catch(e =>
            logger.warn(`[CONSULTAS] Aviso al cliente falló (la consulta ya está creada): ${e.message}`));

        res.status(201).json({ success: true, ...r });
    } catch (err) {
        limpiarFotos(archivos);   // la consulta no se creó: no dejar imágenes huérfanas
        const status = err.status || 500;
        if (status >= 500) logger.error(`[CONSULTAS] crear: ${err.message}`);
        res.status(status).json({ error: err.message });
    }
};

// POST /api/consultas/:id/retirar
exports.retirar = async (req, res) => {
    const consultaId = parseInt(req.params.id, 10);
    if (!consultaId) return res.status(400).json({ error: 'Consulta inválida.' });
    try {
        const r = await svc.retirarConsulta({
            consultaId,
            usuarioId: req.user?.id || req.user?.UsuarioID || 1,
            motivo   : req.body?.motivo,
            io       : req.app.get('socketio'),
        });
        res.json({ success: true, ...r });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) logger.error(`[CONSULTAS] retirar ${consultaId}: ${err.message}`);
        res.status(status).json({ error: err.message });
    }
};

// GET /api/consultas/foto/:consultaId/:fotoId          — la imagen para la planta
// GET /api/web-orders/consultas/:consultaId/foto/:fotoId — la misma, para el cliente
exports.getFoto = async (req, res) => {
    try {
        const consultaId = parseInt(req.params.consultaId, 10);
        const fotoId = parseInt(req.params.fotoId, 10);
        if (!consultaId || !fotoId) return res.status(400).end();

        const { sql, getPool } = require('../config/db');
        const pool = await getPool();
        const r = await pool.request()
            .input('CID', sql.Int, consultaId)
            .input('FID', sql.Int, fotoId)
            .query(`SELECT TOP 1 f.CFoRutaArchivo,
                           LTRIM(RTRIM(ISNULL(o.CodCliente, ''))) AS CodCliente
                    FROM dbo.ConsultasClienteFotos f WITH(NOLOCK)
                    JOIN dbo.ConsultasCliente c WITH(NOLOCK) ON c.ConIdConsulta = f.ConIdConsulta
                    JOIN dbo.Ordenes         o WITH(NOLOCK) ON o.OrdenID       = c.OrdIdOrden
                    WHERE f.ConIdConsulta = @CID AND f.CFoIdFoto = @FID`);
        const fila = r.recordset[0];
        const ruta = fila?.CFoRutaArchivo;
        if (!ruta) return res.status(404).end();

        // Si quien pide es un cliente (o un diseñador impersonando), la foto tiene que ser
        // de SU pedido. `verifyToken` acepta cualquier JWT válido, así que sin este chequeo
        // un cliente logueado podía leer las fotos de las consultas de otro probando ids.
        // Los usuarios internos no tienen codCliente en el token: para ellos no aplica.
        const codCliente = req.user?.codCliente;
        if (codCliente != null && String(fila.CodCliente).trim() !== String(codCliente).trim()) {
            return res.status(404).end();
        }

        // La ruta sale de la base, pero igual se ancla a la carpeta de la consulta:
        // una fila manipulada no puede servir un archivo de otro lado del disco.
        const esperado = path.resolve(getConsultaFolder(consultaId));
        const real = path.resolve(ruta);
        if (!real.startsWith(esperado) || !fs.existsSync(real)) return res.status(404).end();

        res.sendFile(real);
    } catch (err) {
        logger.error(`[CONSULTAS] getFoto: ${err.message}`);
        res.status(500).end();
    }
};

// =====================================================================
// PORTAL DEL CLIENTE
// =====================================================================

// GET /api/web-orders/consultas
exports.misConsultas = async (req, res) => {
    try {
        const codCliente = req.user?.codCliente;
        if (!codCliente) return res.status(403).json({ error: 'Solo para clientes.' });
        res.json({ success: true, data: await svc.getConsultasPendientesCliente(codCliente) });
    } catch (err) {
        logger.error(`[CONSULTAS] misConsultas: ${err.message}`);
        res.status(500).json({ error: 'No se pudieron leer tus consultas.' });
    }
};

// POST /api/web-orders/consultas/:id/responder  { respuesta, comentario }
exports.responder = async (req, res) => {
    const consultaId = parseInt(req.params.id, 10);
    if (!consultaId) return res.status(400).json({ error: 'Consulta inválida.' });
    try {
        const codCliente = req.user?.codCliente;
        if (!codCliente) return res.status(403).json({ error: 'Solo para clientes.' });

        const { consulta, cancelar } = await svc.responderConsulta({
            consultaId,
            respuesta : req.body?.respuesta,
            comentario: req.body?.comentario,
            codCliente,
            io: req.app.get('socketio'),
        });

        // El cliente pidió cancelar. NO se reimplementa la cancelación: se invoca la
        // que ya existe, que sabe auto-cancelar la orden cuando no quedan archivos,
        // arrastrar la hermana de terminaciones, escribir el historial y resincronizar
        // el ERP. Ver docs/consultas-cliente-plan.md §7.
        let resultadoCancelacion = null;
        if (cancelar) {
            resultadoCancelacion = await ejecutarCancelacion(cancelar, consulta, req);
        }

        res.json({ success: true, respuesta: consulta.ConRespuesta, cancelacion: resultadoCancelacion });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) logger.error(`[CONSULTAS] responder ${consultaId}: ${err.message}`);
        res.status(status).json({ error: err.message });
    }
};

// =====================================================================
// AUXILIARES
// =====================================================================

/**
 * Llama a un handler de Express desde adentro, sin dar la vuelta por HTTP.
 *
 * Por qué existe: la cancelación por consulta tiene que ser LA MISMA que la del botón
 * de cancelar. Esa lógica vive entera dentro de los handlers (cancelFile / cancelOrder)
 * y sabe auto-cancelar la orden cuando no quedan archivos, arrastrar la hermana de
 * terminaciones, escribir historial y auditoría y resincronizar el ERP. Reescribirla
 * sería la tercera ruta de cancelación, que es el bug que el plan marca como más probable.
 *
 * El precio: este adaptador queda acoplado a lo que los handlers usan de `req`/`res`.
 * Hoy usan `body`, `user`, `ip` y `app.get('socketio')` de req, y `status`/`json` de res
 * (verificado sobre ordersController). Si alguien agrega ahí un `req.headers` o un
 * `res.setHeader`, esto se rompe en runtime y no en el build — por eso el mock incluye
 * de más y por eso hay pruebas de las DOS ramas (archivo y orden) en scratchpad.
 *
 * La alternativa limpia es extraer esa lógica a un service y que el handler y esto la
 * llamen. Es el refactor correcto, pero toca el camino más sensible del sistema y va
 * aparte, no colgado de esta feature.
 */
const invocarHandler = (handler, { body, user, io, ip }) => new Promise((resolve, reject) => {
    const req = {
        body: body || {},
        params: {},
        query: {},
        headers: {},
        user: user || null,
        ip: ip || 'consulta-cliente',   // queda así en Auditoria: se ve de dónde salió
        get: () => undefined,
        app: { get: (clave) => (clave === 'socketio' ? io : null) },
    };
    const res = {
        statusCode: 200,
        headersSent: false,
        locals: {},
        status(codigo) { this.statusCode = codigo; return this; },
        set() { return this; },
        setHeader() { return this; },
        json(payload) {
            this.headersSent = true;
            if (this.statusCode >= 400) {
                reject(Object.assign(new Error(payload?.error || 'Error en la cancelación'), { status: this.statusCode }));
            } else {
                resolve(payload);
            }
        },
        send(payload) { this.json(payload); },
        end() { this.headersSent = true; resolve(null); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
});

async function ejecutarCancelacion(cancelar, consulta, req) {
    const ordersController = require('./ordersController');
    const io = req.app.get('socketio');
    const motivo = `Cancelado por el cliente (consulta #${cancelar.consultaId})` +
        (consulta.ConComentarioCli ? `: "${consulta.ConComentarioCli}"` : '');

    // usuario 70 = el sistema, igual que en el resto de las acciones disparadas por
    // el portal (webhooks de pago, aprobación de boceto).
    const comun = { reason: motivo, motivoId: null, detalles: consulta.ConComentarioCli || null, usuario: 70 };
    const quien = { user: { id: 70, nombre: 'Cliente (consulta)' }, io, ip: `consulta-${cancelar.consultaId}` };

    if (cancelar.tipo === 'FILE') {
        const r = await invocarHandler(ordersController.cancelFile, {
            body: { ...comun, fileId: cancelar.archivoId }, ...quien,
        });
        logger.info(`[CONSULTA] #${cancelar.consultaId}: archivo ${cancelar.archivoId} cancelado por el cliente. Orden cancelada: ${!!r?.orderCancelled}`);
        return { tipo: 'FILE', ...r };
    }

    const r = await invocarHandler(ordersController.cancelOrder, {
        body: { ...comun, orderId: cancelar.ordenId }, ...quien,
    });
    logger.info(`[CONSULTA] #${cancelar.consultaId}: orden ${cancelar.ordenId} cancelada por el cliente.`);
    return { tipo: 'ORDER', ...r };
}

/** Push al cliente. Best-effort: si falla, la consulta ya está creada igual. */
async function avisarAlCliente(consulta, cantFotos) {
    const push = require('../services/pushNotificationService');
    const cuerpo = cantFotos
        ? `Mirá la consulta sobre ${consulta.codigoOrden} (${cantFotos} foto${cantFotos > 1 ? 's' : ''}) y decidinos si seguimos.`
        : `Tenemos una consulta sobre ${consulta.codigoOrden}. Entrá y decidinos si seguimos.`;
    await push.sendToOrderClient(consulta.ordenId, {
        title: 'Necesitamos que revises algo',
        body : cuerpo,
        url  : '/portal/factory',
        tag  : `consulta-${consulta.consultaId}`,
    });
}
