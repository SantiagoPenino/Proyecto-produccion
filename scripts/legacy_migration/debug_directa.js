import { sql, poolPromise } from './src/db.js';

async function debugDirectaVariants() {
    try {
        const pool = await poolPromise;
        console.log("Conectado a la BD para debug DIRECTA...");

        // 1. Listar todas las variantes (Artículos) en el área DIRECTA o grupos relacionados
        // Asumiendo que AreaID_Interno es DIRECTA
        const query = `
            SELECT DISTINCT 
                s.Articulo AS VarianteNombre,
                s.CodStock AS VarianteCodigo,
                s.Grupo AS GrupoID
            FROM StockArt s
            JOIN ConfigMapeoERP c ON s.Grupo = c.GrupoID
            WHERE c.AreaID_Interno = 'DIRECTA' OR c.AreaID_Interno = 'IMD'
            ORDER BY s.CodStock;
        `;

        const result = await pool.request().query(query);
        console.log("Variantes encontradas en DIRECTA/IMD:");
        console.table(result.recordset);

        // 2. Buscar específicamente los códigos que dio el usuario
        const specificQuery = `
            SELECT Articulo, CodStock, Grupo 
            FROM StockArt 
            WHERE CodStock IN ('1.1.11.1', '1.1.12.1')
        `;
        const resultSpecific = await pool.request().query(specificQuery);
        console.log("\nBusqueda específica por códigos 1.1.11.1 y 1.1.12.1:");
        console.table(resultSpecific.recordset);

    } catch (err) {
        console.error("Error en debug:", err);
    } finally {
        process.exit();
    }
}

debugDirectaVariants();
