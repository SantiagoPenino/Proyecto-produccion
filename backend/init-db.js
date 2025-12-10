const { getPool } = require('./config/db');

const createTablesScript = `
/* 1. LIMPIEZA TOTAL (En orden específico para evitar errores de Foreign Key) */
/* Primero borramos las tablas que dependen de otras */
DROP TABLE IF EXISTS dbo.Orders;
DROP TABLE IF EXISTS dbo.Machines;
/* Al final borramos la tabla maestra */
DROP TABLE IF EXISTS dbo.Areas;

/* 2. CREAR TABLA AREAS (Maestra) */
CREATE TABLE dbo.Areas (
    code VARCHAR(20) PRIMARY KEY, 
    name NVARCHAR(100) NOT NULL,
    category NVARCHAR(50),
    ui_config NVARCHAR(MAX) NULL
);

/* 3. INSERTAR DATOS SEMILLA EN AREAS */
INSERT INTO dbo.Areas (code, name, category, ui_config) VALUES
('DTF', 'Impresión DTF', 'Impresión', '{"printers": ["DTF-01", "DTF-02"], "headers": ["#", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Diseños", "Metros", "Variante", "Rollo", "Equipo", "Estado", ""], "gridTemplate": "40px 40px 70px 80px 180px 180px 70px 70px 90px 80px 90px 100px 50px"}'),
('BORD', 'Bordado', 'Procesos', '{"printers": ["Tajima 6", "Brother 4"], "headers": ["#", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Puntadas", "Col.", "Cant.", "Matriz", "Equipo", "Estado", ""], "gridTemplate": "40px 40px 70px 80px 180px 180px 90px 60px 80px 100px 90px 100px 50px"}'),
('SUB', 'Sublimación', 'Impresión', '{"printers": ["Epson F9470", "Calandra"], "headers": ["#", "Pos", "ID", "Ingreso", "Cliente", "Trabajo", "Tela", "Metros", "Papel", "Equipo", "Estado", ""], "gridTemplate": "40px 40px 70px 80px 180px 180px 100px 70px 90px 100px 100px 50px"}');

/* 4. CREAR TABLA MAQUINAS */
CREATE TABLE dbo.Machines (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    area_code VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'OK',
    FOREIGN KEY (area_code) REFERENCES dbo.Areas(code)
);

/* 5. CREAR TABLA ORDENES */
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
`;

async function initDB() {
    try {
        console.log("⏳ Conectando a AWS...");
        const pool = await getPool();
        
        console.log("🧹 Borrando tablas antiguas y creando nueva estructura...");
        await pool.request().query(createTablesScript);
        
        console.log("✅ ¡BASE DE DATOS INICIALIZADA CORRECTAMENTE!");
        console.log("   - Tablas creadas: Areas, Machines, Orders");
        console.log("   - Datos de configuración UI insertados.");
        process.exit(0);
    } catch (err) {
        console.error("❌ Error FATAL al inicializar BD:", err);
        process.exit(1);
    }
}

initDB();