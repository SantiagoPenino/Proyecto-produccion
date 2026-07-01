const { getPool, sql } = require('./config/db');

async function deleteAllFam2() {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
        console.log('Finding all Fam 2 articles...');
        const result = await transaction.request().query(`
            SELECT ProIdProducto FROM Articulos WHERE SupFlia = '2'
        `);
        
        const ids = result.recordset.map(r => r.ProIdProducto);
        
        if (ids.length > 0) {
            const idList = ids.join(',');
            
            console.log(`Found ${ids.length} articles. Deleting WMS mapping...`);
            
            // Delete variants mapping
            await transaction.request().query(`
                DELETE FROM Articulos_WMS_Variantes WHERE Idproid IN (${idList})
            `);
            
            // Delete master mapping
            await transaction.request().query(`
                DELETE FROM Articulos_Wms WHERE Idproid IN (${idList})
            `);
            
            console.log('Trying physical delete from Articulos...');
            try {
                // Delete from Articulos
                await transaction.request().query(`
                    DELETE FROM Articulos WHERE ProIdProducto IN (${idList})
                `);
                console.log(`Successfully hard-deleted ${ids.length} articles.`);
            } catch (err) {
                console.log('Hard delete failed (likely Foreign Key constraint). Proceeding with soft delete...');
                // Fallback to logical delete
                await transaction.request().query(`
                    UPDATE Articulos 
                    SET borrar = 1, Mostrar = 0 
                    WHERE ProIdProducto IN (${idList})
                `);
                console.log(`Successfully soft-deleted ${ids.length} articles.`);
            }
            
        } else {
            console.log('No articles found in Familia 2.');
        }

        await transaction.commit();
        process.exit(0);
    } catch (err) {
        console.error('Error during deletion:', err);
        await transaction.rollback();
        process.exit(1);
    }
}

deleteAllFam2();
