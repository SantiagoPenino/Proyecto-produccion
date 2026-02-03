const { getPool } = require('../config/db');

(async () => {
    try {
        const pool = await getPool();
        console.log("🔌 Conectando a Base de Datos...");

        // 1. Tabla Cabecera (Clientes con perfil especial)
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PreciosEspeciales' AND xtype='U')
            BEGIN
                CREATE TABLE PreciosEspeciales (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    ClienteID INT NOT NULL UNIQUE, -- ID del Cliente (Local o ERP)
                    NombreCliente NVARCHAR(255),
                    FechaCreacion DATETIME DEFAULT GETDATE(),
                    UltimaActualizacion DATETIME DEFAULT GETDATE()
                );
                PRINT '✅ Tabla PreciosEspeciales creada.';
            END
        `);

        // 2. Tabla Items (Reglas por producto)
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PreciosEspecialesItems' AND xtype='U')
            BEGIN
                CREATE TABLE PreciosEspecialesItems (
                    ItemID INT IDENTITY(1,1) PRIMARY KEY,
                    ClienteID INT NOT NULL, -- FK lógica a PreciosEspeciales.ClienteID
                    CodArticulo NVARCHAR(50) NOT NULL, -- 'TOTAL' para global, o CodArticulo
                    TipoRegla NVARCHAR(20) NOT NULL, -- 'percentage', 'fixed', 'subtract'
                    Valor DECIMAL(18, 4) NOT NULL,
                    Moneda NVARCHAR(5) DEFAULT 'UYU',
                    MinCantidad DECIMAL(18, 2) DEFAULT 0, -- Para rangos futuros
                    INDEX IX_PreciosItems_Cliente (ClienteID),
                    INDEX IX_PreciosItems_Articulo (CodArticulo)
                );
                PRINT '✅ Tabla PreciosEspecialesItems creada.';
            END
        `);

        process.exit(0);
    } catch (e) {
        console.error("❌ Error creando tablas:", e);
        process.exit(1);
    }
})();
