/**
 * Reposiciones (Spec 39): vínculo explícito madre ↔ orden de falla ↔ área que produce ↔ área que
 * reportó, y su ciclo de vida.
 *
 *   ESPERANDO_INSUMO → (decisión del cliente) → PENDIENTE
 *   BLOQUEADA        → (llega la reposición anterior de la cadena) → PENDIENTE
 *   PENDIENTE        → EN_PRODUCCION → ENVIADA (viaja como complemento) → CERRADA
 *   CANCELADA
 *
 * Este servicio NO toca la creación de fallas del control de impresión (postControlArchivo):
 * esas siguen igual y el libro las ve como reposiciones "implícitas" por el linaje.
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { changeOrderState } = require('./stateManagerService');

const ABIERTAS = ['ESPERANDO_INSUMO', 'BLOQUEADA', 'PENDIENTE', 'EN_PRODUCCION', 'ENVIADA'];

async function getReposicion(reposicionId, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('id', sql.Int, reposicionId).query(`
        SELECT r.*, f.CodigoOrden AS CodigoFalla, f.AreaID AS AreaFalla, f.Estado AS EstadoFalla, f.EstadoenArea AS EstadoEnAreaFalla,
               m.CodigoOrden AS CodigoMadre, m.ProximoServicio AS ProximoServicioMadre, m.EstadoEnvio AS EstadoEnvioMadre,
               rep.CodigoOrden AS CodigoReporta, rep.AreaID AS AreaOrdenReporta
        FROM Reposiciones r
        LEFT JOIN Ordenes f ON f.OrdenID = r.OrdenFallaID
        LEFT JOIN Ordenes m ON m.OrdenID = r.OrdenMadreID
        LEFT JOIN Ordenes rep ON rep.OrdenID = r.OrdenReportaID
        WHERE r.ReposicionID = @id`);
    return r.recordset[0] || null;
}

async function siguienteEslabon(reposicionId, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('id', sql.Int, reposicionId)
        .query(`SELECT TOP 1 * FROM Reposiciones WHERE ReposicionAnteriorID = @id AND Estado NOT IN ('CERRADA','CANCELADA') ORDER BY ReposicionID`);
    return r.recordset[0] || null;
}

async function setEstado(tx, reposicionId, estado, extra = {}) {
    const req = new sql.Request(tx).input('id', sql.Int, reposicionId).input('e', sql.VarChar(20), estado);
    const sets = ['Estado = @e'];
    if (estado === 'CERRADA') sets.push('FechaCierre = GETDATE()');
    if (extra.cantidad != null) { sets.push('Cantidad = @c'); req.input('c', sql.Decimal(12, 2), Number(extra.cantidad)); }
    await req.query(`UPDATE Reposiciones SET ${sets.join(', ')} WHERE ReposicionID = @id`);
}

/**
 * ¿A qué área tiene que llegar el material de esta reposición para darla por cerrada?
 *  - si tiene un eslabón siguiente en la cadena: al área que produce ese eslabón;
 *  - si no: al área que reportó (o, si produce y reporta la misma área, a la siguiente de la madre).
 */
async function areaDestinoCierre(rep, conn) {
    const next = await siguienteEslabon(rep.ReposicionID, conn);
    if (next) return String(next.AreaProduce || '').trim().toUpperCase();
    // [VEN INTERNA] Producto del local repuesto por venta interna: cierra al llegar al área que reportó.
    if (rep.VenOrdenID) return String(rep.AreaReporta || '').trim().toUpperCase();
    if (String(rep.AreaProduce).trim().toUpperCase() !== String(rep.AreaReporta).trim().toUpperCase()) return String(rep.AreaReporta).trim().toUpperCase();
    return String(rep.ProximoServicioMadre || '').trim().toUpperCase();
}

/**
 * Libera la orden que reportó cuando no le queda ninguna reposición abierta:
 * Retenido → Pendiente (solo si sigue retenida) y sale de "Esperando Reposición".
 */
async function liberarOrdenReportaSiCorresponde(tx, ordenReportaId, userObj, io) {
    const abiertas = await new sql.Request(tx).input('id', sql.Int, ordenReportaId).query(`
        SELECT COUNT(*) AS n FROM Reposiciones WHERE OrdenReportaID = @id AND Estado IN (${ABIERTAS.map(s => `'${s}'`).join(',')})`);
    if ((abiertas.recordset[0]?.n || 0) > 0) return false;
    // [CONTROL] Una orden que reportó desde Control nunca pasó a "Retenido" (sigue en Control y
    // Calidad): el cambio de estado de abajo no la toca por el guard, así que acá solo se le saca
    // la marca de espera.
    try {
        await new sql.Request(tx).input('id', sql.Int, ordenReportaId).query(`
            UPDATE Ordenes SET EstadoLogistica = 'Canasto Produccion'
            WHERE OrdenID = @id AND EstadoLogistica = 'Esperando Reposición'
              AND ISNULL(EstadoenArea, '') NOT IN ('Retenido', 'Con Falla')`);
    } catch (e) { logger.warn('[Reposiciones] liberarOrdenReporta (control): ' + e.message); }
    try {
        await changeOrderState(tx, {
            target: { type: 'ORDER', id: ordenReportaId },
            estado: 'Pendiente',
            userObj: userObj || 'Sistema',
            detalle: 'Reposición recibida: la orden vuelve a estar operable',
            guard: "EstadoenArea IN ('Retenido','Con Falla')",
            extraSet: { EstadoLogistica: 'Canasto Produccion' },
            io,
        });
    } catch (e) { logger.warn('[Reposiciones] liberarOrdenReporta:', e.message); }
    return true;
}

/**
 * Hook de RECEPCIÓN de un remito (receiveDispatch): por cada línea del remito que mueve una
 * reposición, si llegó al área que la cierra → CERRADA, se libera el eslabón siguiente de la
 * cadena y, si ya no queda nada abierto, la orden que reportó vuelve a estar operable.
 */
async function alRecibirEnvio(tx, envioId, areaReceptora, userObj, io) {
    const area = String(areaReceptora || '').trim().toUpperCase();
    const lineas = await new sql.Request(tx).input('e', sql.Int, envioId)
        .query(`SELECT DISTINCT ReposicionID FROM Logistica_EnvioOrdenes WHERE EnvioID = @e AND ReposicionID IS NOT NULL`);
    const cerradas = [];
    for (const l of lineas.recordset) {
        const rep = await getReposicion(l.ReposicionID, tx);
        if (!rep || ['CERRADA', 'CANCELADA'].includes(rep.Estado)) continue;
        const destino = await areaDestinoCierre(rep, tx);
        if (destino && destino !== area) { logger.info(`[Reposiciones] ${rep.CodigoFalla} recibida en ${area}, cierra en ${destino}: sigue ENVIADA`); continue; }
        await setEstado(tx, rep.ReposicionID, 'CERRADA');
        cerradas.push(rep);
        // Eslabón siguiente de la cadena: deja de estar bloqueado
        const next = await siguienteEslabon(rep.ReposicionID, tx);
        if (next && next.Estado === 'BLOQUEADA') {
            await setEstado(tx, next.ReposicionID, 'PENDIENTE');
            if (next.OrdenFallaID) {
                await new sql.Request(tx).input('id', sql.Int, next.OrdenFallaID)
                    .query(`UPDATE Ordenes SET EstadoDependencia = 'OK' WHERE OrdenID = @id AND EstadoDependencia = 'ESPERANDO_REPOSICION'`);
            }
        }
        await liberarOrdenReportaSiCorresponde(tx, rep.OrdenReportaID, userObj, io);
    }
    return cerradas;
}

/**
 * Hook al TERMINAR una orden de falla con registro (bandejas / control): si produce y reporta la
 * misma área y la madre todavía no salió en parcial, el material se incorpora a la madre como hoy
 * (CERRADA). Si no, queda EN_PRODUCCION lista para viajar como complemento.
 */
async function alTerminarOrdenFalla(tx, ordenFallaId, userObj, io) {
    const r = await new sql.Request(tx).input('id', sql.Int, ordenFallaId)
        .query(`SELECT TOP 1 ReposicionID FROM Reposiciones WHERE OrdenFallaID = @id AND Estado NOT IN ('CERRADA','CANCELADA') ORDER BY ReposicionID DESC`);
    const row = r.recordset[0];
    if (!row) return null;
    const rep = await getReposicion(row.ReposicionID, tx);
    const mismaArea = String(rep.AreaProduce).trim().toUpperCase() === String(rep.AreaReporta).trim().toUpperCase();
    const next = await siguienteEslabon(rep.ReposicionID, tx);
    if (mismaArea && !next && (rep.EstadoEnvioMadre || 'SIN_ENVIAR') !== 'PARCIAL') {
        await setEstado(tx, rep.ReposicionID, 'CERRADA');
        await liberarOrdenReportaSiCorresponde(tx, rep.OrdenReportaID, userObj, io);
        return { ...rep, Estado: 'CERRADA', viaja: false };
    }
    await setEstado(tx, rep.ReposicionID, 'EN_PRODUCCION');
    return { ...rep, Estado: 'EN_PRODUCCION', viaja: true };
}

module.exports = { ABIERTAS, getReposicion, siguienteEslabon, setEstado, areaDestinoCierre, alRecibirEnvio, alTerminarOrdenFalla, liberarOrdenReportaSiCorresponde };
