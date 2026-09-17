// =====================================================================
// CADENA DE ÓRDENES — lo que espera a una orden que se cancela
// =====================================================================
// [PRENDAS] "Comprar y personalizar" encadena órdenes: la de Estampado espera a su DTF
// o a su TPU con `EstadoDependencia = 'ESPERANDO_IMPRESION'` y `LiberaCuandoOrdenID`
// apuntando a la fuente. Esa dependencia se suelta en UN solo lugar: cuando la fuente
// llega a 'Pronto' (productionFileController, completarOrden).
//
// EL BUG: una orden cancelada nunca llega a 'Pronto'. La que la esperaba queda con la
// dependencia puesta para siempre — fuera de la grilla activa, fuera del kanban, fuera
// de la selección para lote. Invisible y esperando algo que no va a pasar nunca.
//
// Existe desde antes que las consultas al cliente, pero la consulta lo dispara seguido
// (el cliente cancela desde el portal), así que se arregla acá. Ver
// docs/consultas-cliente-plan.md §11.
const { sql } = require('../config/db');
const logger = require('./logger');

// Tope de saltos por si algún día los datos quedan con un ciclo (A espera a B, B espera
// a A). Una cadena real tiene 1 o 2 eslabones: con 5 sobra y no se cuelga nunca.
const MAX_PROFUNDIDAD = 5;

/**
 * Cancela, dentro de la MISMA transacción, las órdenes que estaban esperando a la que se
 * está cancelando. Solo toca las que siguen bloqueadas: si la dependencia ya se soltó, esa
 * orden está trabajándose y la decisión de cancelarla es de una persona, no de una regla.
 *
 * @param {object} transaction transacción sql activa
 * @param {number} ordenFuenteId OrdenID de la orden que se está cancelando
 * @param {object} [opts] { userObj, motivo, io } — mismo formato que changeOrderState
 * @returns {Promise<Array<{ordenId:number, codigo:string}>>} las que se cancelaron
 */
async function cancelarOrdenesEncadenadas(transaction, ordenFuenteId, opts = {}, _profundidad = 0) {
    if (_profundidad >= MAX_PROFUNDIDAD) {
        logger.warn(`[CADENA] Corte por profundidad en la orden ${ordenFuenteId}: hay un ciclo de LiberaCuandoOrdenID.`);
        return [];
    }

    const enEsperaRes = await new sql.Request(transaction)
        .input('OID', sql.Int, ordenFuenteId)
        .query(`SELECT OrdenID, LTRIM(RTRIM(CodigoOrden)) AS CodigoOrden
                FROM Ordenes
                WHERE LiberaCuandoOrdenID = @OID
                  AND ISNULL(EstadoDependencia, '') = 'ESPERANDO_IMPRESION'
                  AND Estado NOT IN ('Cancelado', 'CANCELADO', 'Entregado', 'Finalizado')`);
    if (!enEsperaRes.recordset.length) return [];

    const fuenteRes = await new sql.Request(transaction)
        .input('OID', sql.Int, ordenFuenteId)
        .query('SELECT TOP 1 LTRIM(RTRIM(CodigoOrden)) AS CodigoOrden FROM Ordenes WHERE OrdenID = @OID');
    const codigoFuente = fuenteRes.recordset[0]?.CodigoOrden || `#${ordenFuenteId}`;
    const motivo = opts.motivo || `Cancelada en cascada: esperaba a ${codigoFuente}, que se canceló`;

    const { changeOrderState } = require('../services/stateManagerService');
    const canceladas = [];

    for (const o of enEsperaRes.recordset) {
        // La dependencia se limpia: dejarla en 'ESPERANDO_IMPRESION' sobre una orden muerta
        // es exactamente el estado que genera el bug, solo que ahora cancelada.
        await new sql.Request(transaction)
            .input('OID', sql.Int, o.OrdenID)
            .input('Obs', sql.NVarChar, ` [CANCELADO: ${motivo}]`)
            .query(`UPDATE Ordenes
                    SET RolloID = NULL,
                        EstadoDependencia = 'OK',
                        Nota = CONCAT(ISNULL(Nota, ''), @Obs),
                        Observaciones = CONCAT(ISNULL(Observaciones, ''), @Obs)
                    WHERE OrdenID = @OID`);

        await new sql.Request(transaction)
            .input('OID', sql.Int, o.OrdenID)
            .query(`UPDATE ArchivosOrden
                    SET EstadoArchivo = 'CANCELADO',
                        Observaciones = CONCAT(ISNULL(Observaciones, ''), ' [ORDEN CANCELADA EN CASCADA]')
                    WHERE OrdenID = @OID AND ISNULL(EstadoArchivo, '') <> 'CANCELADO'`);

        await changeOrderState(transaction, {
            target : { type: 'ORDER', id: o.OrdenID },
            estado : 'Cancelado',
            userObj: opts.userObj,
            detalle: motivo,
            io     : opts.io,
        });

        canceladas.push({ ordenId: o.OrdenID, codigo: o.CodigoOrden });
        logger.info(`[CADENA] Orden ${o.CodigoOrden} (${o.OrdenID}) cancelada: esperaba a ${codigoFuente}.`);

        // Y lo que esperaba a ésta.
        const nietas = await cancelarOrdenesEncadenadas(transaction, o.OrdenID, opts, _profundidad + 1);
        canceladas.push(...nietas);
    }

    return canceladas;
}

/**
 * Las otras órdenes VIVAS del mismo pedido, sin tocarlas.
 *
 * Un pedido puede tener trabajos independientes (una bandera y unos stickers): cancelar
 * los stickers porque el cliente rechazó la bandera es peor que el problema. El sistema
 * informa y la decisión es de una persona — de ahí que esto solo LEA. Ver plan §11.3/§11.4.
 *
 * @returns {Promise<Array<{ordenId:number, codigo:string, area:string, estado:string}>>}
 */
async function hermanasVivasDelPedido(transaction, ordenId) {
    const r = await new sql.Request(transaction)
        .input('OID', sql.Int, ordenId)
        .query(`
            SELECT o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden,
                   LTRIM(RTRIM(ISNULL(o.AreaID, ''))) AS AreaID, o.Estado
            FROM Ordenes o
            JOIN Ordenes src ON src.OrdenID = @OID
            WHERE o.OrdenID <> @OID
              AND src.NoDocERP IS NOT NULL
              AND LTRIM(RTRIM(o.NoDocERP)) = LTRIM(RTRIM(src.NoDocERP))
              AND o.Estado NOT IN ('Cancelado', 'CANCELADO', 'Entregado', 'Finalizado')
              -- Las -F son internas y efímeras: el operador no decide nada sobre ellas.
              AND UPPER(LTRIM(RTRIM(o.CodigoOrden))) NOT LIKE '%-F%'`);
    return r.recordset.map(o => ({
        ordenId: o.OrdenID, codigo: o.CodigoOrden, area: o.AreaID, estado: o.Estado,
    }));
}

module.exports = { cancelarOrdenesEncadenadas, hermanasVivasDelPedido };
