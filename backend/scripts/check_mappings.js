const { getPool } = require('../config/db');

async function checkMappings() {
    try {
        const pool = await getPool();
        console.log("🔍 Verificando Mapeos para Grupos del JSON...");

        const gruposBuscados = ['1.1', '1.3', '1.4', '1.6', '1.7'];

        const result = await pool.request().query(`
            SELECT CodigoERP, AreaID_Interno 
            FROM ConfigMapeoERP 
            WHERE CodigoERP IN ('1.1', '1.3', '1.4', '1.6', '1.7')
        `);

        const encontrados = result.recordset;
        console.log("📊 Mapeos Existentes en DB:");
        console.table(encontrados);

        const encontradosCodigos = encontrados.map(x => x.CodigoERP.toString().trim());

        const faltantes = gruposBuscados.filter(g => !encontradosCodigos.includes(g));

        if (faltantes.length > 0) {
            console.error("❌ TE FALTAN ESTOS MAPEOS IMPORTANTES:");
            console.error(faltantes.join(', '));
            console.log("⚠️ La importación ignorará cualquier pedido de estos grupos hasta que los agregues en ConfigMapeoERP.");
        } else {
            console.log("✅ Todos los grupos necesarios están mapeados.");
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkMappings();
