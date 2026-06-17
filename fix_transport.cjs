const fs = require('fs');
let content = fs.readFileSync('backend/controllers/logisticsController.js', 'utf8');

const hasFunc = content.includes('exports.getActiveTransports');
console.log('Has getActiveTransports:', hasFunc);

const marker = 'exports.getOrderRequirements';
const idx = content.indexOf(marker);
console.log('Insertion point index:', idx);

const newFunc = [
"exports.getActiveTransports = async (req, res) => {",
"    try {",
"        const pool = await getPool();",
"        const r = await pool.request().query(`",
"            SELECT TOP 200",
"                e.EnvioID,",
"                e.CodigoRemito,",
"                e.Estado,",
"                e.Observaciones,",
"                e.AreaOrigenID,",
"                e.AreaDestinoID,",
"                e.FechaSalida as FechaCreacion,",
"                e.FechaSalida as Fecha,",
"                (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalBultos,",
"                CASE ",
"                    WHEN EXISTS (",
"                        SELECT 1 FROM Logistica_EnvioItems ei",
"                        INNER JOIN Logistica_Bultos b ON ei.BultoID = b.BultoID",
"                        WHERE ei.EnvioID = e.EnvioID AND b.Tipocontenido = 'ENCOMIENDA'",
"                    ) THEN 'ENCOMIENDA'",
"                    ELSE 'PRODUCCION'",
"                END AS TipoEnvio",
"            FROM Logistica_Envios e",
"            ORDER BY e.FechaSalida DESC",
"        `);",
"        res.json(r.recordset);",
"    } catch (err) {",
"        logger.error(err);",
"        res.status(500).json({ error: err.message });",
"    }",
"};",
"",
"// --- REQUISITOS DE PRODUCCION (MANUAL CHECK) ---",
"",
""
].join('\n');

if (!hasFunc && idx !== -1) {
    content = content.slice(0, idx) + newFunc + content.slice(idx);
    fs.writeFileSync('backend/controllers/logisticsController.js', content, 'utf8');
    console.log('SUCCESS: Function inserted');
} else if (hasFunc) {
    console.log('Already exists, no change needed');
} else {
    console.log('ERROR: insertion point not found');
}
