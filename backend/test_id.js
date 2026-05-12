const { getPool } = require('./config/db');
getPool().then(pool => pool.request().query("SELECT IDCliente FROM dbo.Clientes WHERE CodCliente LIKE '%5713118%'")).then(res => { console.log(res.recordset); process.exit(0); });
