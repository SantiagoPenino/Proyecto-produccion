const axios = require('axios');
const { getPool, sql } = require('../config/db');

async function forceImport(nroFactura) {
    console.log(`🧨 FORZANDO IMPORTACIÓN DE FACTURA: ${nroFactura}`);

    try {
        const pool = await getPool();
        const API_BASE = 'http://localhost:6061';

        // 1. Fetch Detalle Directamente
        console.log(`🌐 Consultando API: ${API_BASE}/api/pedidos/${nroFactura}/con_sublineas`);
        const res = await axios.get(`${API_BASE}/api/pedidos/${nroFactura}/con_sublineas`);

        if (!res.data || !res.data.data) {
            throw new Error("❌ La API no devolvió datos para esta factura.");
        }

        const d = res.data.data;
        const lineas = d.Lineas || [];
        console.log(`📦 Lineas encontradas: ${lineas.length}`);

        // 2. Simular Proceso
        for (const l of lineas) {
            console.log(`   🔸 Procesando Item: ${l.Descripcion}`);
            const grupo = (l.Grupo || '').trim();
            const codStock = (l.CodStock || '').trim();

            // Check Mapeo
            const mapRes = await pool.request()
                .input('g', sql.VarChar, grupo)
                .input('c', sql.VarChar, codStock)
                .query("SELECT TOP 1 AreaID_Interno FROM ConfigMapeoERP WHERE LTRIM(RTRIM(CodigoERP)) = @g");

            if (!mapRes.recordset[0]) {
                console.log(`      ⚠️  NO MAPEO para Grupo '${grupo}'`);
                continue;
            }
            console.log(`      ✅ Mapeo OK -> Area: ${mapRes.recordset[0].AreaID_Interno}`);

            // Check Sublineas
            const sub = l.Sublineas || [];
            if (sub.length === 0) {
                console.log(`      🛠️  Es SERVICIO EXTRA (0 sublineas)`);
            } else {
                sub.forEach((s, idx) => {
                    const cant = Number(s.CantCopias) || 0;
                    const link = s.Archivo || "";
                    const notas = (s.Notas || "").toLowerCase();

                    const esRef = notas.includes('boceto') || notas.includes('logo') || notas.includes('bordado');
                    const esExtra = !link && cant > 0;

                    console.log(`      📝 Sublinea ${idx + 1}: Ref=${esRef}, Extra=${esExtra}, Prod=${!esRef && !esExtra}`);
                    if (esRef) console.log(`         -> A ArchivosReferencia`);
                    else if (esExtra) console.log(`         -> A ServiciosExtraOrden`);
                    else console.log(`         -> A ArchivosOrden`);
                });
            }
        }
        console.log("🏁 Simulación terminada.");
        process.exit(0);

    } catch (e) {
        console.error("❌ ERROR FATAL:", e.message);
        if (e.response) console.error("   Datos API:", e.response.data);
        process.exit(1);
    }
}

// Cambia el número 48 por el que quieras probar
forceImport(48);
