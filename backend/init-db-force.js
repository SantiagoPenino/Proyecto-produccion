const { getPool } = require('./config/db');

const nuclearScript = `
-- 1. Eliminar Foreign Keys que apuntan a Areas (Para poder borrarla)
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id))
    + '.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + 
    ' DROP CONSTRAINT ' + QUOTENAME(name) + ';'
FROM sys.foreign_keys
WHERE referenced_object_id = OBJECT_ID('dbo.Areas');
EXEC sp_executesql @sql;

-- 2. Ahora sí, borrar las tablas sin piedad
IF OBJECT_ID('dbo.Orders', 'U') IS NOT NULL DROP TABLE dbo.Orders;
IF OBJECT_ID('dbo.Machines', 'U') IS NOT NULL DROP TABLE dbo.Machines;
IF OBJECT_ID('dbo.Areas', 'U') IS NOT NULL DROP TABLE dbo.Areas;

-- 3. Crear Tablas Nuevas (Estructura Correcta)
CREATE TABLE dbo.Areas (
    code VARCHAR(20) PRIMARY KEY, 
    name NVARCHAR(100) NOT NULL,
    category NVARCHAR(50),
    ui_config NVARCHAR(MAX) NULL
);

CREATE TABLE dbo.Machines (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    area_code VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'OK',
    FOREIGN KEY (area_code) REFERENCES dbo.Areas(code)
);

CREATE TABLE dbo.Orders (
    id INT IDENTITY(1,1) PRIMARY KEY,
    client_name NVARCHAR(100) NOT NULL,
    job_description NVARCHAR(MAX),
    area_code VARCHAR(20) NOT NULL,
    status NVARCHAR(50) DEFAULT 'Pendiente',
    priority NVARCHAR(20) DEFAULT 'Normal',
    entry_date DATETIME DEFAULT GETDATE(),
    roll_id VARCHAR(50) NULL,
    printer_name NVARCHAR(100) NULL,
    meta_data NVARCHAR(MAX) NULL, 
    files_data NVARCHAR(MAX) NULL,
    is_deleted BIT DEFAULT 0,
    FOREIGN KEY (area_code) REFERENCES dbo.Areas(code)
);

-- 4. Insertar Datos Semilla
INSERT INTO dbo.Areas (code, name, category, ui_config) VALUES
('DTF', 'Impresión DTF', 'Impresión', '{"printers": ["DTF-01", "DTF-02"], "headers": ["#", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Diseños", "Metros", "Variante", "Rollo", "Equipo", "Estado", ""], "gridTemplate": "40px 40px 70px 80px 180px 180px 70px 70px 90px 80px 90px 100px 50px"}'),
('BORD', 'Bordado', 'Procesos', '{"printers": ["Tajima 6", "Brother 4"], "headers": ["#", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Puntadas", "Col.", "Cant.", "Matriz", "Equipo", "Estado", ""], "gridTemplate": "40px 40px 70px 80px 180px 180px 90px 60px 80px 100px 90px 100px 50px"}');
`;

async function forceInit() {
    try {
        console.log("🔥 Ejecutando borrado forzado y recreación...");
        const pool = await getPool();
        await pool.request().query(nuclearScript);
        console.log("✅ ¡Base de datos regenerada con éxito!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Error fatal:", err);
        process.exit(1);
    }
}

forceInit();