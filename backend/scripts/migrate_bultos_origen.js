const { sql, getPool } = require('../config/db');

async function migrate() {
    try {
        const pool = await getPool();
        console.log("Conectado a BD. Iniciando migración...");

        // 1. Add Column
        try {
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Logistica_Bultos') AND name = 'RecepcionID')
                BEGIN
                    ALTER TABLE Logistica_Bultos ADD RecepcionID INT NULL;
                    PRINT 'Columna RecepcionID agregada.';
                END
            `);
        } catch (e) {
            console.log("Nota sobre columna:", e.message);
        }

        // 2. Migrate Data (Linking by Code Logic)
        // Logic: Try exact match first, then suffix stripped match.
        console.log("Vinculando bultos existentes (PRE-*) con Recepciones...");

        const updateQuery = `
            UPDATE b
            SET b.RecepcionID = r.RecepcionID
            FROM Logistica_Bultos b
            INNER JOIN Recepciones r ON (
                -- Exact Match
                LTRIM(RTRIM(b.CodigoEtiqueta)) = LTRIM(RTRIM(r.Codigo))
                OR
                -- Suffix Match (Strip -X)
                (
                   CHARINDEX('-', REVERSE(b.CodigoEtiqueta)) > 0 
                   AND 
                   LTRIM(RTRIM(r.Codigo)) = LEFT(b.CodigoEtiqueta, LEN(b.CodigoEtiqueta) - CHARINDEX('-', REVERSE(b.CodigoEtiqueta)))
                )
            )
            WHERE b.RecepcionID IS NULL 
            AND b.OrdenID IS NULL 
            AND (b.CodigoEtiqueta LIKE 'PRE-%' OR b.CodigoEtiqueta LIKE 'REC-%' OR b.CodigoEtiqueta LIKE 'B-%')
        `;

        const res = await pool.request().query(updateQuery);
        console.log(`Registros actualizados: ${res.rowsAffected}`);

        console.log("Migración completada exitosamente.");
        process.exit(0);
    } catch (err) {
        console.error("FATAL ERROR:", err);
        process.exit(1);
    }
}

migrate();
