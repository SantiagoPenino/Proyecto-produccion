const sql = require('mssql');

/**
 * Marca un requisito bloqueante como CUMPLIDO ("no aplica") en el momento de crear la orden,
 * cuando el canal real de esa orden puntual nunca va a generar ese requisito por otra vía
 * (ej. Sublimación con material propio de la empresa: nunca va a llegar tela de cliente a
 * recibir, así que el requisito TELA no debe quedar pendiente para siempre).
 *
 * Mismo patrón que ya usa el caso "parche adhesivo" de PRENDA en Bordado — reusa el propio
 * Estado='CUMPLIDO' que ya leen todas las queries de "esperando requisitos"/bandeja, así que
 * no hace falta tocar ninguna de ellas.
 *
 * Debe llamarse DENTRO de la transacción que crea la orden.
 *
 * @param {sql.Transaction} transaction - transacción activa
 * @param {number} ordenId
 * @param {string} areaId
 * @param {string} codigoRequisito - código exacto, o patrón LIKE si exact=false (ej. 'TELA' matchea '%TELA%')
 * @param {string} observaciones
 * @param {boolean} [exact=true]
 * @returns {Promise<boolean>} true si el área tiene ese requisito configurado (se haya insertado o ya existiera)
 */
async function marcarRequisitoNoAplica(transaction, { ordenId, areaId, codigoRequisito, observaciones, exact = true }) {
    const req = await new sql.Request(transaction)
        .input('Area', sql.VarChar(20), areaId)
        .input('Cod', sql.VarChar(50), exact ? codigoRequisito : `%${codigoRequisito}%`)
        .query(`SELECT RequisitoID FROM ConfigRequisitosProduccion WHERE AreaID = @Area AND CodigoRequisito ${exact ? '=' : 'LIKE'} @Cod`);
    if (!req.recordset.length) return false;

    await new sql.Request(transaction)
        .input('OID', sql.Int, ordenId)
        .input('Area', sql.VarChar(20), areaId)
        .input('RID', sql.Int, req.recordset[0].RequisitoID)
        .input('Obs', sql.NVarChar(300), observaciones)
        .query(`
            IF NOT EXISTS (SELECT 1 FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID)
                INSERT INTO OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                VALUES (@OID, @Area, @RID, 'CUMPLIDO', GETDATE(), @Obs)
        `);
    return true;
}

module.exports = { marcarRequisitoNoAplica };
