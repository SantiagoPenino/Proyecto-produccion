const { getPool } = require('./config/db');

getPool().then(async pool => {
    // Columnas de OrdenesDeposito que parezcan clave foranea a Articulos
    const od = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'OrdenesDeposito' 
        AND (COLUMN_NAME LIKE '%Pro%' OR COLUMN_NAME LIKE '%Art%' OR COLUMN_NAME LIKE '%Cod%' OR COLUMN_NAME LIKE '%Prod%')
        ORDER BY ORDINAL_POSITION
    `);
    console.log('=== OrdenesDeposito - Columnas relacionadas a Articulos ===');
    console.log(od.recordset);

    // FK reales
    const fk = await pool.request().query(`
        SELECT 
            fk.name AS FK_Name,
            OBJECT_NAME(fk.parent_object_id) AS Tabla_Origen,
            COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS Columna_Origen,
            OBJECT_NAME(fk.referenced_object_id) AS Tabla_Destino,
            COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS Columna_Destino
        FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        WHERE OBJECT_NAME(fk.parent_object_id) = 'OrdenesDeposito'
    `);
    console.log('=== FK reales de OrdenesDeposito ===');
    console.log(fk.recordset);
    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
