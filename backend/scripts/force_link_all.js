const { sql, getPool } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        // 1. Get Orphans
        const orphans = await pool.request().query("SELECT BultoID, CodigoEtiqueta FROM Logistica_Bultos WHERE RecepcionID IS NULL AND (CodigoEtiqueta LIKE 'PRE-%' OR CodigoEtiqueta LIKE 'REC-%')");

        console.log(`Huérfanos encontrados: ${orphans.recordset.length}`);
        let linked = 0;

        for (const b of orphans.recordset) {
            let code = b.CodigoEtiqueta.trim();
            // Try clean match
            let r = await pool.request().input('C', sql.VarChar, code).query("SELECT TOP 1 RecepcionID FROM Recepciones WHERE LTRIM(RTRIM(Codigo)) = @C");

            if (r.recordset.length === 0) {
                // Try strip suffix Logic (NodeJS side is easier/safer)
                // e.g. PRE-39-1 -> PRE-39
                if (code.includes('-')) {
                    const lastDash = code.lastIndexOf('-');
                    const suffix = code.substring(lastDash + 1);
                    if (!isNaN(suffix)) { // Is number
                        const base = code.substring(0, lastDash);
                        r = await pool.request().input('C', sql.VarChar, base).query("SELECT TOP 1 RecepcionID FROM Recepciones WHERE LTRIM(RTRIM(Codigo)) = @C");
                    }
                }
            }

            if (r.recordset.length > 0) {
                const rid = r.recordset[0].RecepcionID;
                await pool.request().query(`UPDATE Logistica_Bultos SET RecepcionID = ${rid} WHERE BultoID = ${b.BultoID}`);
                console.log(`Linked Bulto ${code} -> Recep ${rid}`);
                linked++;
            } else {
                console.log(`Failed to link Bulto ${code} (No matching Recepcion found)`);
            }
        }
        console.log(`Total Linked: ${linked}`);
        process.exit(0);
    } catch (e) { console.error(e); process.exit(1); }
}
run();
