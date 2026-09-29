const { sql } = require('../config/db');

// Próximo código VEN-#### dentro de una transacción ya abierta.
// Antes era un MAX()+1 suelto: con READ_COMMITTED_SNAPSHOT activo en la base, dos ventas
// casi simultáneas (doble clic, 18/09 VEN-2431) leían el mismo máximo y salían con el
// MISMO número — la factura después juntaba las líneas de las dos. El applock serializa
// a todos los que numeran VEN hasta que su transacción termina (commit o rollback), y
// READCOMMITTEDLOCK hace que el MAX lea lo último confirmado y no una foto vieja.
async function siguienteCodigoVenta(tx) {
    const lock = await new sql.Request(tx).query(`
        DECLARE @r INT;
        EXEC @r = sp_getapplock @Resource = 'NUMERACION_VEN', @LockMode = 'Exclusive',
                                @LockOwner = 'Transaction', @LockTimeout = 20000;
        SELECT r = @r;
    `);
    if ((lock.recordset[0]?.r ?? -1) < 0) {
        throw new Error('No se pudo reservar el número de venta (VEN), reintente en unos segundos.');
    }
    const res = await new sql.Request(tx).query(`
        SELECT ISNULL(MAX(CAST(SUBSTRING(NoDocERP, 5, LEN(NoDocERP)) AS INT)), 0) + 1 AS NextID
        FROM PedidosCobranza WITH (READCOMMITTEDLOCK)
        WHERE NoDocERP LIKE 'VEN-%'
    `);
    return `VEN-${String(res.recordset[0].NextID).padStart(4, '0')}`;
}

module.exports = { siguienteCodigoVenta };
