/**
 * Avisos de órdenes para el portal de clientes: cada cliente se entera solo de SUS órdenes.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * `server:order_updated` y `server:ordersUpdated` se emiten a TODOS los sockets, desde unos 50 lugares,
 * cada vez que cambia una orden cualquiera. "Mi Fábrica" del portal recargaba con cada uno (lista,
 * contadores y consultas) aunque la orden no fuera del cliente: con pocos clientes conectados, las dos
 * consultas de esa pantalla sumaban el 24 % de la CPU de SQL (docs/analisis-cpu-sql-2026-09-23.md).
 *
 * Se corta acá, en un solo lugar, sin tocar a los que emiten:
 *  - El portal se suscribe con su token (`portal:suscribir`): el socket entra a la sala `portal` y a la
 *    de su cliente. Solo tokens de cliente: diseñadores e internos no se suscriben y siguen recibiendo
 *    todo, como antes.
 *  - Esos dos eventos ya no llegan a la sala `portal`; la planta los sigue recibiendo igual.
 *  - Si el evento trae `orderId` u `orderIds`, se busca de qué cliente son esas órdenes y a su sala va
 *    `portal:mis_ordenes`, sin datos: el portal vuelve a pedir su lista con su propio token. Las
 *    ráfagas (un cambio masivo emite una vez por orden) se juntan en una sola consulta cada 500 ms.
 */
const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../config/db');
const logger = require('./logger');

const SALA_PORTAL = 'portal';
const EVENTOS_ORDENES = new Set(['server:order_updated', 'server:ordersUpdated']);
const VENTANA_MS = 500;

const salaCliente = (cod) => `cliente:${String(cod).trim()}`;
const hayPortalConectado = (io) => (io.sockets.adapter.rooms.get(SALA_PORTAL)?.size || 0) > 0;

function instalar(io) {
    const emitirATodos = io.emit.bind(io);
    let pendientes = new Set();
    let timer = null;

    const avisarDuenos = async () => {
        timer = null;
        const ids = [...pendientes];
        pendientes = new Set();
        if (!ids.length || !hayPortalConectado(io)) return;
        try {
            const pool = await getPool();
            const r = await pool.request()
                .input('Ids', sql.VarChar(sql.MAX), ids.join(','))
                .query(`SELECT DISTINCT LTRIM(RTRIM(o.CodCliente)) AS Cod
                        FROM dbo.Ordenes o WITH(NOLOCK)
                        WHERE o.OrdenID IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@Ids, ','))
                          AND o.CodCliente IS NOT NULL`);
            for (const { Cod } of r.recordset) {
                const sala = salaCliente(Cod);
                if (Cod && io.sockets.adapter.rooms.has(sala)) io.to(sala).emit('portal:mis_ordenes');
            }
        } catch (e) {
            logger.warn(`[avisos portal] No se pudo avisar a los clientes: ${e.message}`);
        }
    };

    io.emit = (evento, ...args) => {
        if (!EVENTOS_ORDENES.has(evento)) return emitirATodos(evento, ...args);
        io.except(SALA_PORTAL).emit(evento, ...args);
        const datos = args[0] || {};
        const ids = [datos.orderId, ...(Array.isArray(datos.orderIds) ? datos.orderIds : [])]
            .map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (ids.length && hayPortalConectado(io)) {
            ids.forEach(id => pendientes.add(id));
            if (!timer) timer = setTimeout(avisarDuenos, VENTANA_MS);
        }
        return true;
    };
}

// `portal:suscribir` { token }: solo un token de cliente vigente entra a las salas. Cualquier otro caso
// (diseñador, interno, vencido) deja el socket fuera del portal, recibiendo los avisos de siempre.
function suscribir(socket, datos, ack) {
    let cod = null;
    try {
        const u = jwt.verify(String(datos?.token || ''), process.env.JWT_SECRET);
        const esCliente = u?.userType === 'CLIENT' || u?.role === 'WEB_CLIENT';
        if (esCliente && u.codCliente != null && String(u.codCliente).trim()) cod = String(u.codCliente).trim();
    } catch (_) { /* token inválido o vencido: sin suscripción */ }

    // Otro cliente en la misma pestaña (cerró sesión y entró otro): se va de la sala anterior.
    for (const sala of socket.rooms) {
        if (sala.startsWith('cliente:') && (!cod || sala !== salaCliente(cod))) socket.leave(sala);
    }
    if (cod) {
        socket.join(SALA_PORTAL);
        socket.join(salaCliente(cod));
    } else {
        socket.leave(SALA_PORTAL);
    }
    if (typeof ack === 'function') ack({ ok: !!cod });
}

module.exports = { instalar, suscribir, SALA_PORTAL };
