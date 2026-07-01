const { getPool, sql } = require('./config/db');

async function rollbackWMS() {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
        // 1. Find all newly inserted WMS articles
        const newArticles = await transaction.request().query(`
            SELECT ProIdProducto FROM Articulos WHERE CodArticulo LIKE 'WMS-%'
        `);
        
        const idsToDelete = newArticles.recordset.map(r => r.ProIdProducto);
        
        if (idsToDelete.length > 0) {
            const idList = idsToDelete.join(',');
            
            // 2. Delete variants mapping
            await transaction.request().query(`
                DELETE FROM Articulos_WMS_Variantes WHERE Idproid IN (${idList})
            `);
            
            // 3. Delete master mapping
            await transaction.request().query(`
                DELETE FROM Articulos_Wms WHERE Idproid IN (${idList})
            `);
            
            // 4. Delete from Articulos
            await transaction.request().query(`
                DELETE FROM Articulos WHERE ProIdProducto IN (${idList})
            `);
            
            console.log(`Rolled back ${idsToDelete.length} WMS products successfully.`);
        } else {
            console.log('No recently imported WMS products found.');
        }

        await transaction.commit();
        process.exit(0);
    } catch (err) {
        console.error('Error during rollback:', err);
        await transaction.rollback();
        process.exit(1);
    }
}

rollbackWMS();
