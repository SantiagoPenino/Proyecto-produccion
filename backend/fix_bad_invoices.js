require('dotenv').config();
const { getPool, sql } = require('./config/db');

async function fixBadInvoices() {
    try {
        const pool = await getPool();
        
        // 1. Encontrar las facturas malas
        // Facturas donde el DocTotal difiere de la suma de sus líneas
        const resMalas = await pool.request().query(`
            SELECT dc.DocIdDocumento, dc.DocTotal, SUM(dcd.DcdTotal) as SumLines
            FROM dbo.DocumentosContables dc
            JOIN dbo.DocumentosContablesDetalle dcd ON dc.DocIdDocumento = dcd.DocIdDocumento
            GROUP BY dc.DocIdDocumento, dc.DocTotal
            HAVING ABS(dc.DocTotal - SUM(dcd.DcdTotal)) > 0.1
        `);
        
        const facturasMalas = resMalas.recordset;
        console.log(`Se encontraron ${facturasMalas.length} facturas con montos repetidos/descuadrados.`);
        
        let arregladas = 0;
        
        for (const f of facturasMalas) {
            const docId = f.DocIdDocumento;
            const docTotal = Number(f.DocTotal);
            
            // Traer las líneas con sus costos originales
            const resLineas = await pool.request().input('docId', sql.Int, docId).query(`
                SELECT 
                    dcd.DcdIdDetalle, 
                    dcd.DcdCantidad,
                    ISNULL(od.OrdCostoFinal, 0) AS CostoOriginal
                FROM dbo.DocumentosContablesDetalle dcd
                LEFT JOIN dbo.OrdenesDeposito od ON od.OrdCodigoOrden = dcd.OrdCodigoOrden
                WHERE dcd.DocIdDocumento = @docId
            `);
            
            const lineas = resLineas.recordset;
            if (lineas.length === 0) continue;
            
            const sumCostos = lineas.reduce((acc, l) => acc + Number(l.CostoOriginal), 0);
            const countLineas = lineas.length;
            
            let totalAsignado = 0;
            
            for (let i = 0; i < lineas.length; i++) {
                const l = lineas[i];
                let pct = 0;
                
                if (sumCostos > 0) {
                    pct = Number(l.CostoOriginal) / sumCostos;
                } else {
                    pct = 1 / countLineas; // Equitativo si no hay costos
                }
                
                let nuevoTotalLinea = 0;
                if (i === lineas.length - 1) {
                    // Última línea ajusta los centavos restantes
                    nuevoTotalLinea = docTotal - totalAsignado;
                } else {
                    nuevoTotalLinea = Number((docTotal * pct).toFixed(2));
                    totalAsignado += nuevoTotalLinea;
                }
                
                const cant = Number(l.DcdCantidad) || 1;
                const nuevoSub = Number((nuevoTotalLinea / 1.22).toFixed(2));
                const nuevoImp = Number((nuevoTotalLinea - nuevoSub).toFixed(2));
                const nuevoPU = Number((nuevoTotalLinea / cant).toFixed(4));
                
                await pool.request()
                    .input('id', sql.Int, l.DcdIdDetalle)
                    .input('tot', sql.Decimal(18,2), nuevoTotalLinea)
                    .input('sub', sql.Decimal(18,2), nuevoSub)
                    .input('imp', sql.Decimal(18,2), nuevoImp)
                    .input('pu', sql.Decimal(18,4), nuevoPU)
                    .query(`
                        UPDATE dbo.DocumentosContablesDetalle
                        SET DcdTotal = @tot, DcdSubtotal = @sub, DcdImpuestos = @imp, DcdPrecioUnitario = @pu
                        WHERE DcdIdDetalle = @id
                    `);
            }
            arregladas++;
        }
        
        console.log(`¡Script terminado! Se arreglaron ${arregladas} facturas en total.`);
        process.exit(0);
        
    } catch (e) {
        console.error("Error arreglando facturas:", e);
        process.exit(1);
    }
}

fixBadInvoices();
