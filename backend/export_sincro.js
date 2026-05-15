const sql = require('mssql');
const fs = require('fs');

const cfg = {
    server: 'localhost',
    database: 'SecureAppDB',
    user: 'sa',
    password: '2441',
    options: { trustServerCertificate: true, encrypt: false }
};

function escVal(x) {
    if (x === null || x === undefined) return 'NULL';
    if (typeof x === 'number') return x;
    return "N'" + String(x).replace(/'/g, "''") + "'";
}

async function run() {
    await sql.connect(cfg);
    let out = '';
    out += '-- ============================================\n';
    out += '-- Script portable con datos SINCRO\n';
    out += '-- Ejecutar en servidor/base destino\n';
    out += '-- ============================================\n\n';
    out += '-- Ajusta el nombre de la base si es diferente\n';
    out += '-- USE [PRODUCCION ACTUAL];\n';
    out += '-- GO\n\n';

    // SINCRO-ARTICULOS
    const r1 = await sql.query('SELECT PRODUCTO,codStock,VARIANTE,PROIDPRODUCTO,Material,codArticulo,IDREACT,AREA FROM [SINCRO-ARTICULOS]');
    out += 'IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=\'SINCRO-ARTICULOS\')\n';
    out += 'CREATE TABLE dbo.[SINCRO-ARTICULOS] (PRODUCTO nvarchar(100) NULL, codStock nvarchar(100) NULL, VARIANTE nvarchar(100) NULL, PROIDPRODUCTO smallint NULL, Material nvarchar(150) NULL, codArticulo smallint NULL, IDREACT smallint NULL, AREA nvarchar(50) NULL);\n';
    out += 'GO\n';
    out += 'DELETE FROM dbo.[SINCRO-ARTICULOS];\n';
    for (const r of r1.recordset) {
        out += `INSERT INTO dbo.[SINCRO-ARTICULOS] (PRODUCTO,codStock,VARIANTE,PROIDPRODUCTO,Material,codArticulo,IDREACT,AREA) VALUES (${escVal(r.PRODUCTO)},${escVal(r.codStock)},${escVal(r.VARIANTE)},${escVal(r.PROIDPRODUCTO)},${escVal(r.Material)},${escVal(r.codArticulo)},${escVal(r.IDREACT)},${escVal(r.AREA)});\n`;
    }
    out += `GO\nPRINT 'SINCRO-ARTICULOS: ${r1.recordset.length} filas';\nGO\n\n`;

    // SINCRO-ARTICULOSVIEJA
    const r2 = await sql.query('SELECT DESCRIPCION,codStock,VARIANTE,PROIDPRODUCTO,Material,codArticulo,IDREACT,AREA FROM [SINCRO-ARTICULOSVIEJA]');
    out += 'IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=\'SINCRO-ARTICULOSVIEJA\')\n';
    out += 'CREATE TABLE dbo.[SINCRO-ARTICULOSVIEJA] (DESCRIPCION nvarchar(100) NOT NULL, codStock nvarchar(50) NOT NULL, VARIANTE nvarchar(100) NOT NULL, PROIDPRODUCTO int NULL, Material nvarchar(150) NOT NULL, codArticulo smallint NULL, IDREACT varchar(50) NULL, AREA nvarchar(50) NOT NULL);\n';
    out += 'GO\n';
    out += 'DELETE FROM dbo.[SINCRO-ARTICULOSVIEJA];\n';
    for (const r of r2.recordset) {
        out += `INSERT INTO dbo.[SINCRO-ARTICULOSVIEJA] (DESCRIPCION,codStock,VARIANTE,PROIDPRODUCTO,Material,codArticulo,IDREACT,AREA) VALUES (${escVal(r.DESCRIPCION)},${escVal(r.codStock)},${escVal(r.VARIANTE)},${escVal(r.PROIDPRODUCTO)},${escVal(r.Material)},${escVal(r.codArticulo)},${escVal(r.IDREACT)},${escVal(r.AREA)});\n`;
    }
    out += `GO\nPRINT 'SINCRO-ARTICULOSVIEJA: ${r2.recordset.length} filas';\nGO\n\n`;

    // SINCRONIZAR DATOS SISTEMAS - SINCRO
    const r3 = await sql.query('SELECT N_A,codStock,VARIANTE,PROIDPRODUCTO,Material,codArticulo,IDREACT,AREA FROM [SINCRONIZAR DATOS SISTEMAS - SINCRO]');
    out += 'IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=\'SINCRONIZAR DATOS SISTEMAS - SINCRO\')\n';
    out += 'CREATE TABLE dbo.[SINCRONIZAR DATOS SISTEMAS - SINCRO] (N_A nvarchar(100) NOT NULL, codStock nvarchar(50) NOT NULL, VARIANTE nvarchar(100) NOT NULL, PROIDPRODUCTO smallint NULL, Material nvarchar(150) NOT NULL, codArticulo smallint NULL, IDREACT tinyint NULL, AREA nvarchar(50) NOT NULL);\n';
    out += 'GO\n';
    out += 'DELETE FROM dbo.[SINCRONIZAR DATOS SISTEMAS - SINCRO];\n';
    for (const r of r3.recordset) {
        out += `INSERT INTO dbo.[SINCRONIZAR DATOS SISTEMAS - SINCRO] (N_A,codStock,VARIANTE,PROIDPRODUCTO,Material,codArticulo,IDREACT,AREA) VALUES (${escVal(r.N_A)},${escVal(r.codStock)},${escVal(r.VARIANTE)},${escVal(r.PROIDPRODUCTO)},${escVal(r.Material)},${escVal(r.codArticulo)},${escVal(r.IDREACT)},${escVal(r.AREA)});\n`;
    }
    out += `GO\nPRINT 'SINCRONIZAR DATOS SISTEMAS: ${r3.recordset.length} filas';\nGO\n`;

    const total = r1.recordset.length + r2.recordset.length + r3.recordset.length;
    out += `\nPRINT '== TOTAL: ${total} filas migradas ==';\nGO\n`;

    fs.writeFileSync('C:/Integracion/User-Macrosoft/Proyecto-produccion/migrate_sincro_data.sql', out, 'utf8');
    console.log('OK - Script generado con ' + total + ' filas totales');
    await sql.close();
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
