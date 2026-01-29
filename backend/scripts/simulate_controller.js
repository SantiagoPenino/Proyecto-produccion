const { sql, getPool } = require('../config/db');

async function sim() {
    try {
        const pool = await getPool();

        // Esta es la query simplificada con la misma lógica de JOIN (simplificada)
        const query = `
            SELECT 
                b.BultoID, b.CodigoEtiqueta, b.RecepcionID,
                r.RecepcionID as R_ID,
                r.Codigo as R_Codigo,
                r.Cliente,
                r.ProximoServicio
            FROM Logistica_Bultos b
            LEFT JOIN Recepciones r ON (
                b.RecepcionID = r.RecepcionID 
                OR 
                (b.RecepcionID IS NULL AND LTRIM(RTRIM(b.CodigoEtiqueta)) = LTRIM(RTRIM(r.Codigo)))
            )
            WHERE b.CodigoEtiqueta = 'PRE-39'
        `;

        console.log("Ejecutando simulacion...");
        const res = await pool.request().query(query);
        console.log(JSON.stringify(res.recordset, null, 2));
        process.exit(0);
    } catch (e) { console.error(e); process.exit(1); }
}
sim();
