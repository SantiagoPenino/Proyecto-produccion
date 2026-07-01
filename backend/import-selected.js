const { getPool, sql } = require('./config/db');

async function importSelectedMasters() {
    const wmsUrl = process.env.WMS_API_URL || 'https://administracionuser.uy/api';
    
    // Lista de productos autorizados por el usuario
    const allowedNames = [
        'Cuellos Polares',
        'FILM COMUN',
        'FILM HOT',
        'Gorro de Lana',
        'Gorro de Visera Curva',
        'Liquido de limpieza de impresion directa',
        'Liquido de Limpieza DTF',
        'liquido de limpieza sublimacion',
        'SHORT',
        'TINTA DTF',
        'TINTA DTF UV',
        'TINTA ECOSOLVENTE'
    ].map(n => n.toLowerCase().trim());

    try {
        // Fetch WMS Masters
        const resMaestros = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'USE Ventas_Dev; SELECT id, nombre FROM Stock_Productos_Maestros' })
        });
        const wmsMaestros = (await resMaestros.json()).data || [];

        // Filter authorized masters
        const authorizedMaestros = wmsMaestros.filter(m => 
            allowedNames.includes(m.nombre.toLowerCase().trim())
        );

        console.log(`Found ${authorizedMaestros.length} matching masters in WMS.`);

        // Fetch WMS Variantes
        const resVariantes = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'USE Ventas_Dev; SELECT id, producto_maestro_id, nombre_variante, codigo_variante FROM Stock_Variantes' })
        });
        const wmsVariantes = (await resVariantes.json()).data || [];

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        let newArticles = 0;
        let mappedMasters = 0;
        let syncedVariants = 0;

        try {
            for (const master of authorizedMaestros) {
                // 1. Check if already mapped in Articulos_Wms
                const checkMapping = await transaction.request()
                    .input('WmsMasterId', sql.Int, master.id)
                    .query(`SELECT Idproid FROM Articulos_Wms WHERE producto_maestro_id = @WmsMasterId`);
                
                let localId = null;

                if (checkMapping.recordset.length > 0) {
                    localId = checkMapping.recordset[0].Idproid;
                } else {
                    // 2. Not mapped. Check if exists by exact name in Articulos
                    const checkName = await transaction.request()
                        .input('Nombre', sql.VarChar, master.nombre)
                        .query(`SELECT TOP 1 ProIdProducto FROM Articulos WHERE Descripcion = @Nombre AND SupFlia = '2'`);
                    
                    if (checkName.recordset.length > 0) {
                        localId = checkName.recordset[0].ProIdProducto;
                    } else {
                        // 3. Doesn't exist locally, insert it
                        const insertArt = await transaction.request()
                            .input('Nombre', sql.VarChar, master.nombre)
                            .input('CodArticulo', sql.VarChar, `WMS-${master.id}`)
                            .query(`
                                INSERT INTO Articulos (CodArticulo, Descripcion, SupFlia, Grupo, Mostrar, MonIdMoneda, borrar)
                                OUTPUT INSERTED.ProIdProducto
                                VALUES (@CodArticulo, @Nombre, '2', '2.1', 1, 2, 0)
                            `);
                        localId = insertArt.recordset[0].ProIdProducto;
                        newArticles++;
                    }

                    // 4. Create mapping in Articulos_Wms
                    await transaction.request()
                        .input('Idproid', sql.Int, localId)
                        .input('WmsMasterId', sql.Int, master.id)
                        .input('NombreWms', sql.VarChar, master.nombre)
                        .query(`
                            IF NOT EXISTS (SELECT 1 FROM Articulos_Wms WHERE Idproid = @Idproid)
                            BEGIN
                                INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms, fecha_sync)
                                VALUES (@Idproid, @WmsMasterId, @NombreWms, GETDATE())
                            END
                            ELSE
                            BEGIN
                                UPDATE Articulos_Wms 
                                SET producto_maestro_id = @WmsMasterId, nombre_wms = @NombreWms
                                WHERE Idproid = @Idproid
                            END
                        `);
                    mappedMasters++;
                }

                // 5. Sync variants for this master
                const masterVariants = wmsVariantes.filter(v => v.producto_maestro_id === master.id);
                for (const variant of masterVariants) {
                    const checkVar = await transaction.request()
                        .input('WmsVarianteId', sql.Int, variant.id)
                        .query(`SELECT 1 FROM Articulos_WMS_Variantes WHERE wms_variante_id = @WmsVarianteId`);
                    
                    if (checkVar.recordset.length === 0) {
                        await transaction.request()
                            .input('Idproid', sql.Int, localId)
                            .input('WmsVarianteId', sql.Int, variant.id)
                            .input('Sku', sql.VarChar, variant.codigo_variante || '')
                            .input('NombreVariante', sql.VarChar, variant.nombre_variante || '')
                            .query(`
                                INSERT INTO Articulos_WMS_Variantes (Idproid, wms_variante_id, sku, nombre_variante)
                                VALUES (@Idproid, @WmsVarianteId, @Sku, @NombreVariante)
                            `);
                    } else {
                        await transaction.request()
                            .input('Idproid', sql.Int, localId)
                            .input('WmsVarianteId', sql.Int, variant.id)
                            .input('Sku', sql.VarChar, variant.codigo_variante || '')
                            .input('NombreVariante', sql.VarChar, variant.nombre_variante || '')
                            .query(`
                                UPDATE Articulos_WMS_Variantes
                                SET Idproid = @Idproid, sku = @Sku, nombre_variante = @NombreVariante
                                WHERE wms_variante_id = @WmsVarianteId
                            `);
                    }
                    syncedVariants++;
                }
            }

            await transaction.commit();
            console.log(`Success! New local articles created: ${newArticles}`);
            console.log(`New master mappings created: ${mappedMasters}`);
            console.log(`Variants synced: ${syncedVariants}`);

        } catch (dbErr) {
            await transaction.rollback();
            throw dbErr;
        }

    } catch (err) {
        console.error('Error during import:', err);
    }
    process.exit(0);
}

importSelectedMasters();
