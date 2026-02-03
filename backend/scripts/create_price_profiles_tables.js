const { getPool, sql } = require('../config/db');

(async () => {
    try {
        const pool = await getPool();

        // 1. Tabla de Perfiles (Cabecera)
        // Ej: Nombre='Mayorista', Descripcion='Descuento 20% general'
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PerfilesPrecios' AND xtype='U')
            BEGIN
                CREATE TABLE PerfilesPrecios (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    Nombre NVARCHAR(100) NOT NULL UNIQUE,
                    Descripcion NVARCHAR(255),
                    Activo BIT DEFAULT 1
                );
                PRINT '✅ Tabla PerfilesPrecios creada.';
            END
        `);

        // 2. Tabla de Items del Perfil (Reglas del perfil)
        // Ej: PerfilMayorista -> ProductoX -> Precio Fijo $100
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PerfilesItems' AND xtype='U')
            BEGIN
                CREATE TABLE PerfilesItems (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    PerfilID INT NOT NULL, -- FK a PerfilesPrecios
                    CodArticulo NVARCHAR(50) NOT NULL,
                    TipoRegla NVARCHAR(20) DEFAULT 'fixed', -- fixed, percentage
                    Valor DECIMAL(18, 4) NOT NULL,
                    Moneda NVARCHAR(5) DEFAULT 'UYU',
                    INDEX IX_PerfilesItems_Perfil (PerfilID)
                );
                PRINT '✅ Tabla PerfilesItems creada.';
            END
        `);

        // 3. Vincular Clientes con Perfiles
        // Agregamos columna PerfilID a la tabla PreciosEspeciales que ya vincula al cliente
        // Si el cliente no existe en PreciosEspeciales, es "Default" (Precio Base).
        // Si existe en PreciosEspeciales y PerfilID es NULL, es "Solo Reglas Manuales".
        // Si PerfilID tiene valor, aplica ese perfil (+ reglas manuales si las hubiere).
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'PerfilID' AND Object_ID = Object_ID('PreciosEspeciales'))
            BEGIN
                ALTER TABLE PreciosEspeciales ADD PerfilID INT NULL;
                PRINT '✅ Columna PerfilID agregada a PreciosEspeciales.';
            END
        `);

        process.exit(0);
    } catch (e) {
        console.error("❌ Error creando tablas de perfiles:", e);
        process.exit(1);
    }
})();
