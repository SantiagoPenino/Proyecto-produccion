require('dotenv').config({ path: '../.env' });
require('dotenv').config({ path: '../.env' });
const { sql, getPool } = require('../config/db');

async function createExtraServicesTable() {
    try {
        const pool = await getPool();

        console.log("🛠️ Creando tabla 'ServiciosExtraOrden'...");

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ServiciosExtraOrden' AND xtype='U')
            BEGIN
                CREATE TABLE ServiciosExtraOrden (
                    ServicioID INT IDENTITY(1,1) PRIMARY KEY,
                    OrdenID INT NOT NULL,
                    CodArt VARCHAR(50),
                    CodStock VARCHAR(50),
                    Descripcion NVARCHAR(255),
                    Cantidad DECIMAL(18,2), -- CantidadHaber
                    PrecioUnitario DECIMAL(18,2),
                    TotalLinea DECIMAL(18,2),
                    Observacion NVARCHAR(MAX),
                    FechaRegistro DATETIME DEFAULT GETDATE(),
                    CONSTRAINT FK_ServiciosExtra_Orden FOREIGN KEY (OrdenID) REFERENCES Ordenes(OrdenID)
                );
                PRINT '✅ Tabla ServiciosExtraOrden creada exitosamente.';
            END
            ELSE
            BEGIN
                PRINT '⚠️ La tabla ServiciosExtraOrden ya existe.';
            END
        `);

    } catch (error) {
        console.error("❌ Error creando tabla:", error);
    } finally {
        // Cerrar conexión si fuera necesario, pero el pool suele mantenerse vivo.
        // process.exit(0); 
        console.log("🏁 Proceso finalizado.");
        process.exit();
    }
}

createExtraServicesTable();
