const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const config = {
    user: 'sa', password: '2441', server: 'localhost', database: 'SecureAppDB_Vieja',
    options: { encrypt: false, trustServerCertificate: true }
};

function formatValue(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? '1' : '0';
    if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
    if (val instanceof Date) return `'${val.toISOString()}'`;
    return val;
}

async function run() {
    const pool = await new sql.ConnectionPool(config).connect();
    const mp = await pool.request().query(`SELECT MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo FROM MetodosPagos`);

    let out = `USE [SecureAppDB];\nGO\n\n`;
    out += `DELETE FROM [MetodosPagos];\n\n`;
    out += `SET IDENTITY_INSERT [MetodosPagos] ON;\n`;
    for(let r of mp.recordset) {
        out += `INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (${formatValue(r.MPaIdMetodoPago)}, ${formatValue(r.MPaDescripcionMetodo)}, ${formatValue(r.MPaActivo)});\n`;
    }
    out += `SET IDENTITY_INSERT [MetodosPagos] OFF;\n\nPRINT '¡Métodos de pago importados correctamente!';\n`;

    fs.writeFileSync(path.join(__dirname, 'metodos_pago.sql'), out, 'utf8');
    console.log(`Generados ${mp.recordset.length} métodos de pago → metodos_pago.sql`);
    await pool.close();
}

run().catch(console.error);
