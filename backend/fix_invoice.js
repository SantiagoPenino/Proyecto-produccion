require('dotenv').config();
const { sql, getPool } = require('./config/db');

async function fixClaudiaInvoice() {
    try {
        const pool = await getPool();
        
        // 1. Encontrar el DocIdDocumento de ET-4
        const resDoc = await pool.request().query(`
            SELECT DocIdDocumento, DocTotal 
            FROM dbo.DocumentosContables 
            WHERE DocSerie = 'ET' AND DocNumero = '4'
        `);
        
        if (resDoc.recordset.length === 0) {
            console.log("No se encontró la factura ET-4.");
            process.exit(1);
        }
        
        const docId = resDoc.recordset[0].DocIdDocumento;
        const totalFactura = resDoc.recordset[0].DocTotal; // 858.31
        console.log(`Factura encontrada. DocId: ${docId}, Total: ${totalFactura}`);
        
        // 2. Obtener las líneas
        const resLineas = await pool.request()
            .input('DocId', sql.Int, docId)
            .query(`
                SELECT DcdIdDetalle, DcdNomItem, DcdDscItem, DcdCantidad, OrdCodigoOrden, DcdTotal
                FROM dbo.DocumentosContablesDetalle
                WHERE DocIdDocumento = @DocId
            `);
            
        const lineas = resLineas.recordset;
        console.log("Líneas actuales:", lineas);
        
        // Si ya está arreglado o no tiene 2 líneas
        if (lineas.length !== 2) {
            console.log(`Se esperaban 2 líneas, pero hay ${lineas.length}. No se hace nada.`);
            process.exit(0);
        }
        
        // Asumimos costos en USD: UVDF-102227 = 19.14, SB-64135 = 2.10
        let idUVDF = null;
        let idSB = null;
        let cantUVDF = 1;
        let cantSB = 1;
        
        for (const l of lineas) {
            if (l.DcdDscItem.includes('102227')) {
                idUVDF = l.DcdIdDetalle;
                cantUVDF = l.DcdCantidad || 1;
            } else if (l.DcdDscItem.includes('64135')) {
                idSB = l.DcdIdDetalle;
                cantSB = l.DcdCantidad || 1;
            }
        }
        
        if (!idUVDF || !idSB) {
            console.log("No se pudieron identificar las líneas correctamente.");
            process.exit(1);
        }
        
        const usdUVDF = 19.14;
        const usdSB = 2.10;
        const usdTotal = usdUVDF + usdSB;
        
        const pctUVDF = usdUVDF / usdTotal;
        const pctSB = usdSB / usdTotal;
        
        // Calculamos los nuevos totales en UYU
        const nuevoTotalUVDF = Number((totalFactura * pctUVDF).toFixed(2));
        const nuevoTotalSB = Number((totalFactura - nuevoTotalUVDF).toFixed(2)); // para asegurar que sumen exacto
        
        console.log(`Nuevo Total UVDF-102227: ${nuevoTotalUVDF} UYU`);
        console.log(`Nuevo Total SB-64135: ${nuevoTotalSB} UYU`);
        
        // UVDF-102227
        const subUVDF = Number((nuevoTotalUVDF / 1.22).toFixed(2));
        const impUVDF = Number((nuevoTotalUVDF - subUVDF).toFixed(2));
        const puUVDF = Number((nuevoTotalUVDF / cantUVDF).toFixed(4));
        
        // SB-64135
        const subSB = Number((nuevoTotalSB / 1.22).toFixed(2));
        const impSB = Number((nuevoTotalSB - subSB).toFixed(2));
        const puSB = Number((nuevoTotalSB / cantSB).toFixed(4));
        
        // 3. Actualizar la base de datos
        await pool.request()
            .input('IdUVDF', sql.Int, idUVDF)
            .input('TotUVDF', sql.Decimal(18,2), nuevoTotalUVDF)
            .input('SubUVDF', sql.Decimal(18,2), subUVDF)
            .input('ImpUVDF', sql.Decimal(18,2), impUVDF)
            .input('PuUVDF', sql.Decimal(18,4), puUVDF)
            
            .input('IdSB', sql.Int, idSB)
            .input('TotSB', sql.Decimal(18,2), nuevoTotalSB)
            .input('SubSB', sql.Decimal(18,2), subSB)
            .input('ImpSB', sql.Decimal(18,2), impSB)
            .input('PuSB', sql.Decimal(18,4), puSB)
            .query(`
                UPDATE dbo.DocumentosContablesDetalle
                SET DcdTotal = @TotUVDF, DcdSubtotal = @SubUVDF, DcdImpuestos = @ImpUVDF, DcdPrecioUnitario = @PuUVDF
                WHERE DcdIdDetalle = @IdUVDF;
                
                UPDATE dbo.DocumentosContablesDetalle
                SET DcdTotal = @TotSB, DcdSubtotal = @SubSB, DcdImpuestos = @ImpSB, DcdPrecioUnitario = @PuSB
                WHERE DcdIdDetalle = @IdSB;
            `);
            
        console.log("¡Factura ET-4 arreglada con éxito!");
        process.exit(0);
        
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

fixClaudiaInvoice();
