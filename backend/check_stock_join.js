const { getPool } = require('./config/db');

async function run() {
    try {
        console.log("Connecting...");
        const pool = await getPool();
        // Intentar JOIN con StockArt para ver si trae descripciones de grupo
        const query = `
            SELECT TOP 10 
                A.CodArticulo, 
                A.CodStock, 
                SA.Articulo as NombreStock, 
                A.Descripcion as DescArticulo
            FROM articulos A
            LEFT JOIN StockArt SA ON A.CodStock = SA.CodStock
        `;
        const res = await pool.request().query(query);
        console.log("JOIN DATA:", res.recordset);
    } catch (e) {
        console.error("ERROR:", e.message);
    }
    process.exit();
}

run();
