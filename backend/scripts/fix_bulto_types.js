const { sql, getPool } = require('../config/db');

async function fix() {
    try {
        const pool = await getPool();
        console.log("Corrigiendo Tipos de Contenido...");

        // Update Tipocontenido from linked Recepcion
        const q = `
            UPDATE b
            SET b.Tipocontenido = r.Tipo
            FROM Logistica_Bultos b
            INNER JOIN Recepciones r ON b.RecepcionID = r.RecepcionID
            -- Solo corregir si difieren (aunque sobrescribir no daña)
            WHERE b.Tipocontenido != r.Tipo
        `;

        const res = await pool.request().query(q);
        console.log(`Tipos corregidos: ${res.rowsAffected}`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
fix();
