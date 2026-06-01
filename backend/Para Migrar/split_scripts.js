const fs = require('fs');
const path = require('path');

const dir = 'c:\\Integracion\\User-Macrosoft\\Proyecto-produccion\\backend\\Para Migrar';
const file1 = fs.readFileSync(path.join(dir, '1-TABLAS-SPY COLUMNAS.sql'), 'utf-8');
const file2 = fs.readFileSync(path.join(dir, '2-Poblar y actualizar tablas.sql'), 'utf-8');

// Separar las partes
const parts = file1.split('-- ============================================================================');

let tablasSQL = '-- ============================================================================\n' + parts[1] + '-- ============================================================================\n' + parts[2];
let columnasSQL = '-- ============================================================================\n' + parts[3] + '-- ============================================================================\n' + parts[4] + '-- ============================================================================\n' + parts[5] + '-- ============================================================================\n' + parts[6];
let spSQL = '-- ============================================================================\n' + parts[7] + '-- ============================================================================\n' + parts[8];

// 1. Agregar a Tablas
let tablasFaltantes = `
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Config_CFE')
CREATE TABLE dbo.[Config_CFE] (
    [CfeCfgId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [CfeCfgClave] varchar(50) NOT NULL,
    [CfeCfgValor] varchar(500) NULL,
    [CfeCfgDescripcion] varchar(200) NULL,
    [CfeCfgActivo] bit NOT NULL DEFAULT(1)
);
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='PlanesMetrosArticulosPermitidos')
CREATE TABLE dbo.[PlanesMetrosArticulosPermitidos] (
    [PlaIdPlan] int NOT NULL,
    [ProIdProducto] int NOT NULL,
    PRIMARY KEY ([PlaIdPlan], [ProIdProducto])
);
GO
`;
tablasSQL += tablasFaltantes;

// 2. Agregar a Columnas
let columnasFaltantes = `
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Rollos' AND COLUMN_NAME='UsuarioID') 
    ALTER TABLE dbo.[Rollos] ADD [UsuarioID] int NULL;
GO
`;
columnasSQL += columnasFaltantes;

// Guardar archivos
fs.writeFileSync(path.join(dir, '01-TABLAS_FALTANTES.sql'), tablasSQL);
fs.writeFileSync(path.join(dir, '02-COLUMNAS_NUEVAS.sql'), columnasSQL);
fs.writeFileSync(path.join(dir, '03-STORED_PROCEDURES.sql'), spSQL);
fs.writeFileSync(path.join(dir, '04-POBLAR_TABLAS.sql'), file2);

console.log('Archivos divididos correctamente.');
