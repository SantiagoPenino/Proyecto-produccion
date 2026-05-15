const { getPool } = require('./config/db');

getPool().then(async pool => {
    // Verificar datos en la tabla
    const count = await pool.request().query('SELECT COUNT(*) as c FROM MetodosPagos');
    console.log('Registros en MetodosPagos:', count.recordset[0].c);

    // Ver qué columnas tiene la tabla
    const cols = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'MetodosPagos'
    `);
    console.log('Columnas:', cols.recordset);

    // Simular exactamente la query del endpoint
    const data = await pool.request().query(`
        SELECT MPaIdMetodoPago, MPaDescripcionMetodo, 
               MPaIdMetodoPago AS MetodoPagoId, 
               MPaDescripcionMetodo AS MetNombre
        FROM dbo.MetodosPagos WITH(NOLOCK)
        ORDER BY MPaDescripcionMetodo
    `);
    console.log('Datos del endpoint:', data.recordset);
    process.exit(0);
}).catch(err => { console.error('ERROR:', err.message); process.exit(1); });
