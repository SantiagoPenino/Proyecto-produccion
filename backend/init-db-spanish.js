const { getPool } = require('./config/db');

const migrationScript = `
/* 1. DESACTIVAR Y BORRAR FOREIGN KEYS (Paso crítico para evitar bloqueos) */
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id))
    + '.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + 
    ' DROP CONSTRAINT ' + QUOTENAME(name) + ';' + CHAR(13)
FROM sys.foreign_keys;
EXEC sp_executesql @sql;

/* 2. BORRAR TABLAS VIEJAS Y NUEVAS (Limpieza total) */
IF OBJECT_ID('dbo.Orders', 'U') IS NOT NULL DROP TABLE dbo.Orders;
IF OBJECT_ID('dbo.Machines', 'U') IS NOT NULL DROP TABLE dbo.Machines;
IF OBJECT_ID('dbo.Areas', 'U') IS NOT NULL DROP TABLE dbo.Areas;
IF OBJECT_ID('dbo.Ordenes', 'U') IS NOT NULL DROP TABLE dbo.Ordenes;
IF OBJECT_ID('dbo.Maquinas', 'U') IS NOT NULL DROP TABLE dbo.Maquinas;

/* 3. CREAR TABLAS NUEVAS (Estructura en Español) */

-- Areas
CREATE TABLE dbo.Areas (
    AreaID VARCHAR(20) PRIMARY KEY, 
    Nombre NVARCHAR(100) NOT NULL,
    Categoria NVARCHAR(50),
    ui_config NVARCHAR(MAX) NULL 
);

-- Maquinas
CREATE TABLE dbo.Maquinas (
    MaquinaID INT IDENTITY(1,1) PRIMARY KEY,
    Nombre NVARCHAR(100) NOT NULL,
    AreaID VARCHAR(20) NOT NULL,
    Estado VARCHAR(20) DEFAULT 'OK',
    FOREIGN KEY (AreaID) REFERENCES dbo.Areas(AreaID)
);

-- Ordenes
CREATE TABLE dbo.Ordenes (
    OrdenID INT IDENTITY(1000,1) PRIMARY KEY,
    AreaID VARCHAR(20) NOT NULL,
    Cliente NVARCHAR(200) NOT NULL,
    DescripcionTrabajo NVARCHAR(300),
    Estado VARCHAR(50) DEFAULT 'Pendiente',
    Prioridad VARCHAR(20) DEFAULT 'Normal',
    Variante NVARCHAR(50),
    Magnitud NVARCHAR(50),
    Nota NVARCHAR(MAX),
    FechaIngreso DATETIME DEFAULT GETDATE(),
    FechaEstimadaEntrega DATETIME NULL,
    RolloID VARCHAR(20) NULL,
    meta_data NVARCHAR(MAX) NULL,
    MaquinaID INT NULL,
    FOREIGN KEY (AreaID) REFERENCES dbo.Areas(AreaID),
    FOREIGN KEY (MaquinaID) REFERENCES dbo.Maquinas(MaquinaID)
);

/* 4. INSERTAR DATOS */
INSERT INTO dbo.Areas (AreaID, Nombre, Categoria, ui_config) VALUES
('DTF', 'Impresión DTF', 'Impresión', '{"printers": ["DTF-01", "DTF-02"], "headers": ["#", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Variante", "Magnitud", "Rollo", "Equipo", "Estado", "Nota", ""], "gridTemplate": "40px 40px 70px 80px 180px 180px 90px 80px 80px 100px 100px 50px 50px"}'),
('BORD', 'Bordado', 'Procesos', '{"printers": ["Tajima 6", "Brother 4"], "headers": ["#", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Puntadas", "Col.", "Cant.", "Matriz", "Equipo", "Estado", ""], "gridTemplate": "40px 40px 70px 80px 180px 180px 90px 60px 80px 100px 90px 100px 50px"}');

INSERT INTO dbo.Maquinas (Nombre, AreaID, Estado) VALUES 
('DTF-01', 'DTF', 'OK'), ('Tajima 6', 'BORD', 'OK');

INSERT INTO dbo.Ordenes (AreaID, Cliente, DescripcionTrabajo, Estado, Prioridad, Variante, Magnitud, RolloID, MaquinaID) 
VALUES ('DTF', 'Cliente Test', 'Prueba Migración', 'Pendiente', 'Normal', 'DTF Comun', '10m', 'R-001', 1);
`;

async function runMigration() {
    try {
        console.log("🔥 Ejecutando migración forzada a español...");
        const pool = await getPool();
        await pool.request().query(migrationScript);
        console.log("✅ ¡Base de datos migrada y estructura en ESPAÑOL creada!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Error en migración:", err);
        process.exit(1);
    }
}

runMigration();