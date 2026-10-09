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

/**
 * Copia a una orden hija (reposición -F / -R) los requisitos que su madre ya tiene CUMPLIDOS.
 *
 * Una reposición se produce con la MISMA tela / prenda / matriz / aprobación que la madre: lo que
 * ya se resolvió una vez no vuelve a esperarse. Sin esto la hija nacía con todos los requisitos
 * bloqueantes pendientes y caía para siempre en "Esperando requisitos" de Planificación
 * (bug real 9-oct-2026: en Sublimación la lista eran 15 órdenes, TODAS -F/-R, por el requisito
 * TELA que la madre ya tenía "Asignado: bobina X" o "No aplica — material propio").
 *
 * Idempotente (NOT EXISTS por OrdenID+RequisitoID) y protegida por OBJECT_ID: en un entorno sin
 * la tabla no hace nada. Debe llamarse DENTRO de la transacción que crea la hija.
 *
 * @param {sql.Transaction} transaction
 * @param {number} madreId
 * @param {number} hijaId
 * @param {string} [etiqueta='orden de reposición'] - texto para la observación ("Heredado de X (etiqueta)")
 * @returns {Promise<number>} cantidad de requisitos copiados
 */
async function heredarRequisitosCumplidos(transaction, madreId, hijaId, etiqueta = 'orden de reposición') {
    if (!madreId || !hijaId || madreId === hijaId) return 0;
    const r = await new sql.Request(transaction)
        .input('Old', sql.Int, madreId)
        .input('New', sql.Int, hijaId)
        .input('Etq', sql.NVarChar(60), etiqueta)
        .query(`
            IF OBJECT_ID('dbo.OrdenCumplimientoRequisitos', 'U') IS NOT NULL
            BEGIN
                DECLARE @Cod NVARCHAR(100) = (SELECT LTRIM(RTRIM(CodigoOrden)) FROM dbo.Ordenes WHERE OrdenID = @Old);
                INSERT INTO dbo.OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                SELECT @New, c.AreaID, c.RequisitoID, 'CUMPLIDO', GETDATE(),
                       LEFT(N'Heredado de ' + ISNULL(@Cod, '') + N' (' + @Etq + N')', 300)
                FROM dbo.OrdenCumplimientoRequisitos c
                WHERE c.OrdenID = @Old AND c.Estado = 'CUMPLIDO'
                  AND NOT EXISTS (SELECT 1 FROM dbo.OrdenCumplimientoRequisitos x
                                  WHERE x.OrdenID = @New AND x.RequisitoID = c.RequisitoID);
                SELECT @@ROWCOUNT AS Copiados;
            END
            ELSE SELECT 0 AS Copiados;
        `);
    return r.recordset?.[0]?.Copiados || 0;
}

module.exports = { marcarRequisitoNoAplica, heredarRequisitosCumplidos };
