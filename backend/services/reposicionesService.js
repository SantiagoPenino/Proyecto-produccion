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
// Áreas que imprimen el transfer de Estampado (mismo valor que libroEntregasService.AREAS_TRANSFER;
// copiado acá para no crear un require circular).
const AREAS_TRANSFER = ['DF', 'TPU'];

async function getReposicion(reposicionId, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('id', sql.Int, reposicionId).query(`
        SELECT r.*, f.CodigoOrden AS CodigoFalla, f.AreaID AS AreaFalla, f.Estado AS EstadoFalla, f.EstadoenArea AS EstadoEnAreaFalla,
               f.ProximoServicio AS ProximoServicioFalla,
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
    // [FALLA EST/PRO] Rama TRANSFER (DTF/TPU nuevo, sin eslabón anterior ni siguiente): cierra donde
    // se aplica el transfer — el ProximoServicio con que nació su orden de falla (Estampado), que no
    // siempre es el área que reportó (ej. reporta PRO).
    if (AREAS_TRANSFER.includes(String(rep.AreaProduce || '').trim().toUpperCase()) && !rep.ReposicionAnteriorID && rep.ProximoServicioFalla) {
        return String(rep.ProximoServicioFalla).trim().toUpperCase();
    }
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
 * [FALLA EST/PRO] ¿A este eslabón bloqueado todavía le falta algo que llegue? Lo alimentan:
 *  - su eslabón anterior en la cadena de la prenda (ReposicionAnteriorID);
 *  - los transfers nuevos (DTF/TPU) de la misma falla cuya orden va a su área.
 * Si cualquiera de ellos sigue abierto, no se libera.
 */
async function faltaAlimentar(tx, eslabon) {
    const r = await new sql.Request(tx)
        .input('id', sql.Int, eslabon.ReposicionID)
        .input('ant', sql.Int, eslabon.ReposicionAnteriorID || null)
        .input('f', sql.Int, eslabon.FallaID || null)
        .input('a', sql.VarChar(20), String(eslabon.AreaProduce || '').trim().toUpperCase())
        .query(`
            SELECT COUNT(*) AS n
            FROM Reposiciones r
            LEFT JOIN Ordenes f ON f.OrdenID = r.OrdenFallaID
            WHERE r.ReposicionID <> @id
              AND r.Estado IN (${ABIERTAS.map(s => `'${s}'`).join(',')})
              AND (
                    r.ReposicionID = @ant
                 OR (@f IS NOT NULL AND r.FallaID = @f AND r.ReposicionAnteriorID IS NULL
                     AND UPPER(LTRIM(RTRIM(r.AreaProduce))) IN (${AREAS_TRANSFER.map(s => `'${s}'`).join(',')})
                     AND UPPER(LTRIM(RTRIM(ISNULL(f.ProximoServicio, '')))) = @a)
              )`);
    return (r.recordset[0]?.n || 0) > 0;
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
        // Eslabón siguiente de la cadena: deja de estar bloqueado.
        // [FALLA EST/PRO] Además, los eslabones bloqueados de la MISMA falla que producen en el área
        // donde cerró esta (ej. el Estampado nuevo, que espera la prenda Y el transfer DTF/TPU). Cada
        // uno se libera recién cuando no le queda nada abierto que lo alimente.
        const candidatos = [];
        const next = await siguienteEslabon(rep.ReposicionID, tx);
        if (next && next.Estado === 'BLOQUEADA') candidatos.push(next);
        if (rep.FallaID && destino) {
            const conv = await new sql.Request(tx).input('f', sql.Int, rep.FallaID).input('id', sql.Int, rep.ReposicionID).input('a', sql.VarChar(20), destino)
                .query(`SELECT * FROM Reposiciones WHERE FallaID = @f AND ReposicionID <> @id AND Estado = 'BLOQUEADA'
                          AND UPPER(LTRIM(RTRIM(AreaProduce))) = @a`);
            conv.recordset.forEach(c => { if (!candidatos.some(x => x.ReposicionID === c.ReposicionID)) candidatos.push(c); });
        }
        for (const c of candidatos) {
            if (await faltaAlimentar(tx, c)) {
                logger.info(`[Reposiciones] Reposición ${c.ReposicionID} (${c.AreaProduce}) sigue BLOQUEADA: todavía espera otra rama (prenda o transfer).`);
                continue;
            }
            await setEstado(tx, c.ReposicionID, 'PENDIENTE');
            if (c.OrdenFallaID) {
                await new sql.Request(tx).input('id', sql.Int, c.OrdenFallaID)
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
