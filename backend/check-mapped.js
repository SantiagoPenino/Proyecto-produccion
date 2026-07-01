const { getPool } = require('./config/db');

async function checkMapped() {
    const pool = await getPool();
    try {
        const result = await pool.request().query(`
            SELECT a.ProIdProducto, a.Descripcion, w.nombre_wms, w.producto_maestro_id
            FROM Articulos_Wms w
            INNER JOIN Articulos a ON w.Idproid = a.ProIdProducto
        `);
        console.log(result.recordset);
    } catch (err) {
        console.error('Error fetching mapped articles:', err);
    }
    process.exit(0);
}

checkMapped();
