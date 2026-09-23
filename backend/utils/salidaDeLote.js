// Qué pasa cuando una orden SALE de un lote. Lo comparten los caminos que sacan órdenes:
// "Sacar del Rollo" (ordersController.unassignOrder), mover/arrastrar (rollsController.moveOrder)
// y desarmar (rollsController.dismantleRoll). Cada uno lo resolvía a su manera y los tres dejaban
// basura: marcas de impreso de un lote que ya no es el suyo, y lotes arrancados borrados con la
// bitácora de la máquina abierta. Ver docs/consulta-en-lote-o-maquina.md §6.
const { sql } = require('../config/db');
const logger = require('./logger');

/**
 * Limpia lo que una orden trae del lote del que sale.
 *  - GrupoManual SIEMPRE: el número de grupo es del lote (MAX+1 dentro del lote). Llevado a otro
 *    lote, la orden quedaba agrupada con las que casualmente tuvieran el mismo número.
 *  - Si vuelve a PENDIENTES, también la marca de impreso/calandrado (Impreso, FechaImpreso,
 *    Calandrado): volver a pendientes es volver a producirse. Con la marca vieja, en el próximo
 *    lote aparecía entre las impresas y el lote se podía finalizar sin imprimirla.
 *    EXCEPCIÓN: las órdenes con avance por contador (TPU, DIRECTA, lote en MIMAKI) conservan todo,
 *    porque vuelven a la mesa con su saldo a propósito (docs/impresion-parcial-plan.md).
 *  - Si pasa a OTRO lote, la marca se conserva (ej.: juntar órdenes ya impresas antes de la calandra).
 * @param {object} transaction transacción sql activa
 * @param {number[]} ordenIds órdenes que salieron del lote
 * @param {{ vuelveAPendientes: boolean }} opts
 */
async function limpiarMarcasDeLote(transaction, ordenIds, { vuelveAPendientes }) {
    const ids = (ordenIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (!ids.length) return;
    const conAvance = 'ISNULL(CantidadImpresa, 0) > 0 OR ISNULL(CantidadCortada, 0) > 0';
    await new sql.Request(transaction).query(`
        UPDATE dbo.Ordenes
        SET GrupoManual = NULL${vuelveAPendientes ? `,
            Impreso      = CASE WHEN ${conAvance} THEN Impreso      ELSE 0    END,
            FechaImpreso = CASE WHEN ${conAvance} THEN FechaImpreso ELSE NULL END,
            Calandrado   = CASE WHEN ${conAvance} THEN Calandrado   ELSE 0    END` : ''}
        WHERE OrdenID IN (${ids.join(',')})`);
}

/**
 * Resuelve un lote al que se le sacaron órdenes, por si quedó vacío.
 *  - Todavía tiene órdenes → nada.
 *  - Nunca arrancó (sin FechaInicioProduccion y sin bitácora) → se borra, como siempre. Solo si
 *    `borrarSiNoArranco`: moveOrder se lo deja a su barrido, que tiene la guarda de los 10 minutos.
 *  - Ya arrancó (imprimiendo, en pausa, o devuelto a la cola) → se CIERRA como en la impresión
 *    parcial (productionController): Finalizado, sin máquina y con la bitácora cerrada. Borrarlo
 *    dejaba la bitácora de la máquina abierta para siempre y el lote desaparecía del historial.
 * @param {object} transaction transacción sql activa
 * @param {number|string} rolloId lote del que salieron las órdenes
 * @returns {Promise<'borrado'|'cerrado'|null>}
 */
async function resolverLoteVacio(transaction, rolloId, { borrarSiNoArranco = true } = {}) {
    if (rolloId == null || String(rolloId).trim() === '') return null;
    const rid = String(rolloId).trim();

    // READCOMMITTEDLOCK en el conteo, igual que el barrido de moveOrder: con RCSI el conteo lee
    // un snapshot y no ve las órdenes que otro request está agregando sin commitear.
    const res = await new sql.Request(transaction)
        .input('RID', sql.VarChar(50), rid)
        .query(`
            SELECT r.FechaInicioProduccion,
                   (SELECT COUNT(*) FROM dbo.Ordenes o WITH (READCOMMITTEDLOCK) WHERE o.RolloID = @RID) AS Ordenes,
                   CASE WHEN EXISTS (SELECT 1 FROM dbo.BitacoraProduccion b WHERE b.RolloID = @RID)
                        THEN 1 ELSE 0 END AS TieneBitacora
            FROM dbo.Rollos r
            WHERE r.RolloID = TRY_CONVERT(INT, @RID)`);
    const lote = res.recordset[0];
    if (!lote || lote.Ordenes > 0) return null;

    const arranco = lote.FechaInicioProduccion != null || lote.TieneBitacora === 1;
    if (!arranco) {
        if (!borrarSiNoArranco) return null;
        await new sql.Request(transaction)
            .input('RID', sql.VarChar(50), rid)
            .query('DELETE FROM dbo.Rollos WHERE RolloID = TRY_CONVERT(INT, @RID)');
        logger.info(`[Lote] ${rid} quedó vacío sin haber arrancado: borrado.`);
        return 'borrado';
    }

    await new sql.Request(transaction)
        .input('RID', sql.VarChar(50), rid)
        .query(`UPDATE dbo.BitacoraProduccion SET FechaFin = GETDATE() WHERE RolloID = @RID AND FechaFin IS NULL;
                UPDATE dbo.Rollos SET Estado = 'Finalizado', MaquinaID = NULL WHERE RolloID = TRY_CONVERT(INT, @RID);`);
    logger.info(`[Lote] ${rid} quedó vacío después de arrancar: cerrado como Finalizado, con la bitácora cerrada.`);
    return 'cerrado';
}

module.exports = { limpiarMarcasDeLote, resolverLoteVacio };
