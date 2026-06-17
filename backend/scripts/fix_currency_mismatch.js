const { getPool } = require('../config/db');
const sql = require('mssql');

async function fixCurrencyMismatch() {
    let pool;
    try {
        pool = await getPool();
        console.log('🔍 Buscando documentos con diferencia de moneda en sus renglones...');

        // Buscamos documentos donde el Total del documento difiera de la suma de sus renglones
        // por un factor mayor a 10 o menor a 0.1 (típico de conversiones USD/UYU ~40)
        const docsConProblema = await pool.request().query(`
            SELECT 
                c.DocIdDocumento,
                c.DocTotal,
                c.MonIdMoneda,
                SUM(d.DcdTotal) as SumaRenglones,
                c.DocTotal / NULLIF(SUM(d.DcdTotal), 0) as FactorConversion
            FROM dbo.DocumentosContables c
            JOIN dbo.DocumentosContablesDetalle d ON c.DocIdDocumento = d.DocIdDocumento
            GROUP BY c.DocIdDocumento, c.DocTotal, c.MonIdMoneda
            HAVING ABS(c.DocTotal - SUM(d.DcdTotal)) > 10
               AND (c.DocTotal / NULLIF(SUM(d.DcdTotal), 0) > 20 
                    OR c.DocTotal / NULLIF(SUM(d.DcdTotal), 0) < 0.05)
        `);

        if (docsConProblema.recordset.length === 0) {
            console.log('✅ No se encontraron documentos desfasados en la base de datos.');
            process.exit(0);
            return;
        }

        console.log(`⚠️ Se encontraron ${docsConProblema.recordset.length} documentos desfasados. Procediendo a corregir...`);

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            let corregidos = 0;
            for (const doc of docsConProblema.recordset) {
                const factor = parseFloat(doc.FactorConversion);
                if (!factor || factor <= 0) continue;

                // Actualizamos todos los renglones de este documento multiplicándolos por el factor
                const updateQuery = await new sql.Request(transaction)
                    .input('DocId', sql.Int, doc.DocIdDocumento)
                    .input('Factor', sql.Decimal(18, 6), factor)
                    .query(`
                        UPDATE dbo.DocumentosContablesDetalle
                        SET 
                            DcdPrecioUnitario = ROUND(DcdPrecioUnitario * @Factor, 4),
                            DcdSubtotal = ROUND(DcdSubtotal * @Factor, 4),
                            DcdImpuestos = ROUND(DcdImpuestos * @Factor, 4),
                            DcdTotal = ROUND(DcdTotal * @Factor, 4)
                        WHERE DocIdDocumento = @DocId
                    `);
                
                corregidos++;
                console.log(`Corregido Doc ID: ${doc.DocIdDocumento} | Factor aplicado: ${factor.toFixed(2)} | Filas afectadas: ${updateQuery.rowsAffected[0]}`);
            }

            await transaction.commit();
            console.log(`🎉 Proceso completado exitosamente. Se corrigieron ${corregidos} documentos.`);
        } catch (error) {
            await transaction.rollback();
            console.error('❌ Error durante la corrección, se revirtieron los cambios:', error);
        }
    } catch (e) {
        console.error('SQL Error', e);
    } finally {
        process.exit();
    }
}

fixCurrencyMismatch();
