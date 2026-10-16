const { sql } = require('../config/db');

// Próximo TcaNumeroDoc de un tipo de transacción de caja, dentro de una transacción ya abierta.
// Mismo molde que codigoVenta.js. Antes era un MAX()+1 suelto con dos fallas:
//  - TcaNumeroDoc es VARCHAR: el MAX comparaba texto, "9" > "10", y desde el décimo comprobante
//    todos salían con el MISMO número (36 anticipos "A-10" entre el 23/06 y el 09/10).
//  - Sin candado, dos operaciones casi simultáneas leían el mismo máximo (como VEN-2431, 18/09).
// El applock serializa a todos los que numeran ESE tipo hasta que su transacción termina
// (commit o rollback), y READCOMMITTEDLOCK hace que el MAX lea lo último confirmado.
async function siguienteNumeroTransaccion(tx, tipoDocumento) {
    const lock = await new sql.Request(tx)
        .input('Recurso', sql.NVarChar(255), `NUMERACION_TCA_${tipoDocumento}`)
        .query(`
            DECLARE @r INT;
            EXEC @r = sp_getapplock @Resource = @Recurso, @LockMode = 'Exclusive',
                                    @LockOwner = 'Transaction', @LockTimeout = 20000;
            SELECT r = @r;
        `);
    if ((lock.recordset[0]?.r ?? -1) < 0) {
        throw new Error(`No se pudo reservar el número de comprobante (${tipoDocumento}), reintente en unos segundos.`);
    }
    const res = await new sql.Request(tx)
        .input('Tipo', sql.VarChar(50), tipoDocumento)
        .query(`
            SELECT ISNULL(MAX(TRY_CAST(TcaNumeroDoc AS INT)), 0) + 1 AS NextID
            FROM dbo.TransaccionesCaja WITH (READCOMMITTEDLOCK)
            WHERE TcaTipoDocumento = @Tipo
        `);
    return res.recordset[0].NextID;
}

module.exports = { siguienteNumeroTransaccion };
