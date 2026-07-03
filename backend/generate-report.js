require('dotenv').config();
const fs = require('fs');

async function generateReport() {
    const wmsUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';

    const query = `
        USE Ventas_Dev;
        SELECT 
            m.nombre AS nombre_maestro,
            v.nombre_variante,
            d.nombre AS deposito,
            ISNULL(SUM(e.cantidad_actual), 0) as existencia
        FROM Stock_Etiquetas e
        INNER JOIN Stock_Variantes v ON e.variante_id = v.id
        INNER JOIN Stock_Productos_Maestros m ON v.producto_maestro_id = m.id
        INNER JOIN Stock_Depositos d ON e.deposito_id = d.id
        WHERE e.estado = 'activo' AND e.cantidad_actual > 0
        GROUP BY m.nombre, v.nombre_variante, d.nombre
        ORDER BY m.nombre, v.nombre_variante, d.nombre
    `;

    try {
        const response = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });

        const data = await response.json();
        
        let md = '# Existencias Actuales en WMS (Solo Activos > 0)\n\n';
        md += '| Producto Maestro | Variante | Almacén / Depósito | Existencia |\n';
        md += '|---|---|---|---|\n';
        
        for (const row of data.data) {
            md += `| ${row.nombre_maestro} | ${row.nombre_variante} | ${row.deposito} | **${row.existencia}** |\n`;
        }

        fs.writeFileSync('C:\\Users\\Admin\\.gemini\\antigravity\\brain\\eea80cf8-2812-4616-bd3b-e0a2277327a4\\existencias_wms.md', md);
        console.log('Report generated successfully with deposits.');
    } catch (error) {
        console.error('Error fetching stock:', error);
    }
}

generateReport();
