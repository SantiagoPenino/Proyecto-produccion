// Hermana contenedora de terminaciones (área TERMINAC).
// La orden ECOUV imprime; sus terminaciones viven en una orden hermana XEUV-{doc}
// que se trabaja en el área TERMINAC (bandeja + planilla). Se crea DESDE EL INGRESO
// del pedido web (pedido negocio 28/07 — antes se creaba al aprobar control; ese
// llamado sigue vivo como red de seguridad para órdenes anteriores al cambio).
const { sql } = require('../config/db');
const logger = require('./logger');

/**
 * Crea (si no existe) la orden hermana TERMINAC de una orden ECOUV y repunta
 * las OrdenTerminaciones hacia ella. Idempotente: si la orden no tiene
 * terminaciones o ya hay hermana viva, no hace nada y devuelve null.
 * @param {object} transaction transacción sql activa
 * @param {number} ecouvId OrdenID de la orden ECOUV
 * @returns {Promise<{hermanaId:number, codigo:string, cantTerm:number}|null>}
 */
async function crearHermanaTerminaciones(transaction, ecouvId) {
    const src = await new sql.Request(transaction)
        .input('OID', sql.Int, ecouvId)
        .query('SELECT TOP 1 * FROM Ordenes WHERE OrdenID = @OID');
    const o = src.recordset[0];
    if (!o) return null;

    // Sin terminaciones no hay hermana
    const cnt = await new sql.Request(transaction)
        .input('OID', sql.Int, ecouvId)
        .query('SELECT COUNT(*) AS C FROM OrdenTerminaciones WHERE OrdenID = @OID');
    const cantTerm = cnt.recordset[0]?.C || 0;
    if (cantTerm === 0) return null;

    // Guard anti-duplicado (reproceso): si ya existe hermana viva de esta orden, no crear otra.
    // OJO: los corchetes del marcador son clase de caracteres en LIKE — van escapados,
    // si no el guard matchea la hermana de CUALQUIER otro pedido y no crea la propia.
    const ya = await new sql.Request(transaction)
        .input('Nota', sql.NVarChar(200), `%![TERMINACIONES DE ${String(o.CodigoOrden || '').trim()}!]%`)
        .query("SELECT TOP 1 OrdenID FROM Ordenes WHERE AreaID = 'TERMINAC' AND Estado NOT IN ('Cancelado') AND Nota LIKE @Nota ESCAPE '!'");
    if (ya.recordset.length > 0) return null;

    // El código de la hermana espeja al de la madre: EUV-10987 (1/2) → XEUV-10987 (1/2).
    // Así se ve de un vistazo a qué orden de impresión pertenece, incluso cuando el
    // pedido tiene varias (multimaterial).
    const codMadre = String(o.CodigoOrden || '').trim();
    const docTrim = String(o.NoDocERP || ecouvId).trim();
    const baseCod = codMadre ? `X${codMadre}` : `XEUV-${docTrim}`;
    const dupCod = await new sql.Request(transaction)
        .input('Cod', sql.VarChar(60), baseCod)
        .query('SELECT COUNT(*) AS C FROM Ordenes WHERE LTRIM(RTRIM(CodigoOrden)) = @Cod');
    const codigoHermana = dupCod.recordset[0].C > 0 ? `${baseCod}(${dupCod.recordset[0].C + 1})` : baseCod;

    const insH = await new sql.Request(transaction)
        .input('Cliente', sql.NVarChar(200), o.Cliente)
        .input('CodCliente', sql.Int, o.CodCliente)
        .input('IdCliR', sql.VarChar(50), o.IdClienteReact != null ? String(o.IdClienteReact) : null)
        .input('Desc', sql.NVarChar(300), o.DescripcionTrabajo)
        .input('Prio', sql.VarChar(20), o.Prioridad || 'Normal')
        .input('FEE', sql.DateTime, o.FechaEstimadaEntrega)
        .input('Mat', sql.VarChar(255), o.Material)
        .input('Var', sql.VarChar(100), o.Variante)
        .input('Cod', sql.VarChar(50), codigoHermana)
        .input('Doc', sql.VarChar(50), o.NoDocERP)
        .input('Nota', sql.NVarChar(sql.MAX), `[TERMINACIONES DE ${String(o.CodigoOrden || '').trim()}]${o.Nota ? ' ' + o.Nota : ''}`)
        .input('Mag', sql.VarChar(50), String(cantTerm))
        .input('CliId', sql.Int, o.CliIdCliente)
        // Forma de envío del pedido: el taller de terminaciones también necesita saber
        // si el trabajo se retira, va por encomienda o a domicilio.
        .input('ModoRet', sql.VarChar(100), o.ModoRetiro || null)
        .query(`
            INSERT INTO Ordenes (
                AreaID, Cliente, CodCliente, IdClienteReact, DescripcionTrabajo, Prioridad,
                FechaIngreso, FechaEstimadaEntrega, Material, Variante,
                CodigoOrden, NoDocERP, Nota, Magnitud, ProximoServicio, UM,
                Estado, EstadoenArea, CliIdCliente, ModoRetiro
            )
            OUTPUT INSERTED.OrdenID
            VALUES (
                'TERMINAC', @Cliente, @CodCliente, @IdCliR, @Desc, @Prio,
                GETDATE(), @FEE, @Mat, @Var,
                @Cod, @Doc, @Nota, @Mag, 'DEPOSITO', 'u',
                'Pendiente', 'Pendiente', @CliId, @ModoRet
            )
        `);
    const hermanaId = insH.recordset[0].OrdenID;

    // Repuntar el detalle de terminaciones a la hermana (ArchivoID sigue
    // apuntando a los archivos de la ECOUV: sirve de referencia visual)
    await new sql.Request(transaction)
        .input('HID', sql.Int, hermanaId)
        .input('OID', sql.Int, ecouvId)
        .query('UPDATE OrdenTerminaciones SET OrdenID = @HID WHERE OrdenID = @OID');

    // La ECOUV viaja al local de terminaciones vía despacho normal
    await new sql.Request(transaction)
        .input('OID', sql.Int, ecouvId)
        .query("UPDATE Ordenes SET ProximoServicio = 'TERMINAC' WHERE OrdenID = @OID");

    logger.info(`[Terminaciones] Hermana ${codigoHermana} (${hermanaId}) creada desde orden ${ecouvId} (${cantTerm} terminaciones)`);
    return { hermanaId, codigo: codigoHermana, cantTerm };
}

/**
 * Marca como canceladas las líneas de OrdenTerminaciones de una orden.
 * `Estado` solo tomaba 'Pendiente' y 'Hecha': 'Cancelado' es un valor NUEVO, así que los
 * filtros que ya existen (= 'Pendiente' / = 'Hecha') lo excluyen solos.
 * Las 'Hecha' NO se tocan: ese trabajo se hizo de verdad y reescribirlo mentiría sobre
 * lo que pasó en el taller (mismo criterio que las XEUV ya finalizadas).
 * @param {object} transaction transacción sql activa
 * @param {number} ordenId orden dueña de las líneas (la ECOUV o su hermana)
 */
async function marcarTerminacionesCanceladas(transaction, ordenId) {
    const r = await new sql.Request(transaction)
        .input('OID', sql.Int, ordenId)
        .query(`UPDATE OrdenTerminaciones
                SET Estado = 'Cancelado'
                WHERE OrdenID = @OID AND ISNULL(Estado, '') NOT IN ('Cancelado', 'Hecha')`);
    return r.rowsAffected[0] || 0;
}

/**
 * Cancela la orden hermana TERMINAC (XEUV-*) cuando se cancela su orden ECOUV madre:
 * sin la impresión no hay material que terminar. Idempotente: si la orden no es ECOUV
 * o no tiene hermana viva, no hace nada y devuelve null.
 * @param {object} transaction transacción sql activa
 * @param {number} ecouvId OrdenID de la orden ECOUV que se está cancelando
 * @param {object} [opts] { userObj, motivo, io } — mismo formato que changeOrderState
 * @returns {Promise<{hermanaId:number, codigo:string}|null>}
 */
async function cancelarHermanaTerminaciones(transaction, ecouvId, opts = {}) {
    const src = await new sql.Request(transaction)
        .input('OID', sql.Int, ecouvId)
        .query('SELECT TOP 1 CodigoOrden, AreaID FROM Ordenes WHERE OrdenID = @OID');
    const o = src.recordset[0];
    if (!o || String(o.AreaID || '').trim().toUpperCase() !== 'ECOUV') return null;

    // El detalle también queda cancelado EXPLÍCITAMENTE, no derivado del estado de la
    // orden padre: cualquier consulta que se olvide del join mostraría trabajo que no
    // existe. Se marcan las de la propia ECOUV por si nunca se creó la hermana (órdenes
    // anteriores al 28/07, o creación fallida): en ese caso el detalle sigue colgando acá.
    await marcarTerminacionesCanceladas(transaction, ecouvId);

    // Misma búsqueda que el guard anti-duplicado de crearHermanaTerminaciones:
    // corchetes escapados para no matchear la hermana de otro pedido.
    const ya = await new sql.Request(transaction)
        .input('Nota', sql.NVarChar(200), `%![TERMINACIONES DE ${String(o.CodigoOrden || '').trim()}!]%`)
        .query(`SELECT TOP 1 OrdenID, CodigoOrden FROM Ordenes
                WHERE AreaID = 'TERMINAC' AND Estado NOT IN ('Cancelado','CANCELADO')
                  AND Nota LIKE @Nota ESCAPE '!'`);
    const hermana = ya.recordset[0];
    if (!hermana) return null;

    const motivo = opts.motivo || `Cancelada junto a su orden de impresión ${String(o.CodigoOrden || '').trim()}`;
    await new sql.Request(transaction)
        .input('HID', sql.Int, hermana.OrdenID)
        .input('Obs', sql.NVarChar, ` [CANCELADO: ${motivo}]`)
        .query(`UPDATE Ordenes
                SET RolloID = NULL,
                    Nota = CONCAT(ISNULL(Nota, ''), @Obs),
                    Observaciones = CONCAT(ISNULL(Observaciones, ''), @Obs)
                WHERE OrdenID = @HID`);

    await marcarTerminacionesCanceladas(transaction, hermana.OrdenID);

    // Estado + historial + socket por el servicio central, igual que la orden madre
    const { changeOrderState } = require('../services/stateManagerService');
    await changeOrderState(transaction, {
        target  : { type: 'ORDER', id: hermana.OrdenID },
        estado  : 'Cancelado',
        userObj : opts.userObj,
        detalle : motivo,
        io      : opts.io
    });

    logger.info(`[Terminaciones] Hermana ${String(hermana.CodigoOrden || '').trim()} (${hermana.OrdenID}) cancelada en cascada por cancelación de la ECOUV ${ecouvId}`);
    return { hermanaId: hermana.OrdenID, codigo: String(hermana.CodigoOrden || '').trim() };
}

/**
 * Borra la hermana TERMINAC y el detalle de terminaciones de una orden ECOUV que se está
 * BORRANDO físicamente (no cancelando): el portal hace hard-delete de los pedidos que
 * quedaron a medio subir. Sin esto la hermana sobrevive a su madre y queda una orden viva
 * en el taller que ya no referencia a nada.
 * @param {object} transaction transacción sql activa
 * @param {number} ecouvId OrdenID de la orden ECOUV que se borra
 * @returns {Promise<{hermanaId:number, codigo:string}|null>}
 */
async function eliminarHermanaTerminaciones(transaction, ecouvId) {
    const src = await new sql.Request(transaction)
        .input('OID', sql.Int, ecouvId)
        .query('SELECT TOP 1 CodigoOrden, AreaID FROM Ordenes WHERE OrdenID = @OID');
    const o = src.recordset[0];
    if (!o || String(o.AreaID || '').trim().toUpperCase() !== 'ECOUV') return null;

    // Detalle de la propia orden (si nunca se creó la hermana, cuelga acá)
    await new sql.Request(transaction)
        .input('OID', sql.Int, ecouvId)
        .query('DELETE FROM OrdenTerminaciones WHERE OrdenID = @OID');

    // Misma búsqueda por Nota que el resto del módulo (corchetes escapados). Acá NO se
    // filtra por estado: se borra la hermana exista como exista, porque su madre deja de existir.
    const ya = await new sql.Request(transaction)
        .input('Nota', sql.NVarChar(200), `%![TERMINACIONES DE ${String(o.CodigoOrden || '').trim()}!]%`)
        .query(`SELECT TOP 1 OrdenID, CodigoOrden FROM Ordenes
                WHERE AreaID = 'TERMINAC' AND Nota LIKE @Nota ESCAPE '!'`);
    const hermana = ya.recordset[0];
    if (!hermana) return null;

    await new sql.Request(transaction)
        .input('HID', sql.Int, hermana.OrdenID)
        .query(`DELETE FROM OrdenTerminaciones WHERE OrdenID = @HID;
                DELETE FROM Ordenes WHERE OrdenID = @HID;`);

    logger.info(`[Terminaciones] Hermana ${String(hermana.CodigoOrden || '').trim()} (${hermana.OrdenID}) eliminada junto con su ECOUV ${ecouvId}`);
    return { hermanaId: hermana.OrdenID, codigo: String(hermana.CodigoOrden || '').trim() };
}

module.exports = {
    crearHermanaTerminaciones,
    cancelarHermanaTerminaciones,
    eliminarHermanaTerminaciones,
    marcarTerminacionesCanceladas,
};
