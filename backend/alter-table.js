const { getPool } = require('./config/db');

async function alterTableMoneda() {
    const pool = await getPool();
    try {
        await pool.request().query(`
            IF NOT EXISTS (
                SELECT * FROM sys.columns 
                WHERE object_id = OBJECT_ID('Articulos_WMS_Variantes') AND name = 'moneda_excepcion'
            )
            BEGIN
                ALTER TABLE Articulos_WMS_Variantes
                ADD moneda_excepcion INT NULL;
            END
        `);
        console.log('Column moneda_excepcion added successfully.');
    } catch (err) {
        console.error('Error altering table:', err);
    }
    process.exit(0);
}

alterTableMoneda();
