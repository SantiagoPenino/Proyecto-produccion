const { getPool } = require('../config/db');
require('dotenv').config();

(async () => {
    try {
        const pool = await getPool();
        console.log("🔌 Conectando a Base de Datos...");

        // 1. Verificar si la tabla ya existe
        const check = await pool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'IntegrationLogs'
        `);

        if (check.recordset.length > 0) {
            console.log("✅ La tabla 'IntegrationLogs' ya existe.");
        } else {
            console.log("🛠️ Creando tabla 'IntegrationLogs'...");

            await pool.request().query(`
                CREATE TABLE IntegrationLogs (
                    LogID INT IDENTITY(1,1) PRIMARY KEY,
                    Fecha DATETIME DEFAULT GETDATE(),
                    Nivel VARCHAR(20) NOT NULL, -- 'INFO', 'WARN', 'ERROR'
                    TipoEntidad VARCHAR(50) NOT NULL, -- 'PRODUCTO', 'ORDEN', 'CLIENTE'
                    Mensaje NVARCHAR(MAX) NOT NULL,
                    DatosJson NVARCHAR(MAX), -- Contexto en JSON
                    Estado VARCHAR(20) DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'RESUELTO', 'IGNORADO'
                    ReferenciaID VARCHAR(100) -- ID interno opcional (ej: CodArticulo)
                );
            `);
            console.log("✅ Tabla 'IntegrationLogs' creada exitosamente.");
        }

        process.exit(0);
    } catch (e) {
        console.error("❌ Error al crear tabla:", e);
        process.exit(1);
    }
})();
