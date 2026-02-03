const { getPool } = require('../config/db');

(async () => {
    try {
        const pool = await getPool();

        // 1. Tabla PreciosBase (Lista General)
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PreciosBase' AND xtype='U')
            BEGIN
                CREATE TABLE PreciosBase (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    CodArticulo NVARCHAR(50) NOT NULL UNIQUE, -- Vincula con Articulos.CodArticulo
                    Precio DECIMAL(18, 4) NOT NULL DEFAULT 0,
                    Moneda NVARCHAR(5) DEFAULT 'UYU',
                    UltimaActualizacion DATETIME DEFAULT GETDATE()
                );
                PRINT '✅ Tabla PreciosBase creada.';
            END
        `);

        // 2. Tabla DescuentosVolumen (Rangos)
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DescuentosVolumen' AND xtype='U')
            BEGIN
                CREATE TABLE DescuentosVolumen (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    CodArticulo NVARCHAR(50), -- NULL = Global para todos los productos (si aplica)
                    MinCantidad DECIMAL(18, 2) NOT NULL,
                    TipoDescuento NVARCHAR(20) DEFAULT 'percentage', -- percentage, fixed_amount (restar $$)
                    Valor DECIMAL(18, 4) NOT NULL,
                    Activo BIT DEFAULT 1
                );
                PRINT '✅ Tabla DescuentosVolumen creada.';
            END
        `);

        process.exit(0);
    } catch (e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
})();
