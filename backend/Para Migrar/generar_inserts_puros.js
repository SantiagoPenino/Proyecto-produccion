const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const config = {
    user: 'sa', 
    password: '2441', 
    server: 'localhost', 
    database: 'SecureAppDB',
    options: { encrypt: false, trustServerCertificate: true }
};

function formatValue(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? '1' : '0';
    if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
    if (val instanceof Date) return `'${val.toISOString()}'`;
    if (typeof val === 'number') return val.toString();
    return `'${val}'`;
}

const tablas = [
    "SecuenciaDocumentos", "SINCRO-ARTICULOS", "ConfiguracionPrecios", "TesoreriaBancos",
    "Config_TiposDocumento", "Config_CuentasEgreso", "CondicionesPago", "TiposMovimiento",
    "Cont_PlanCuentas", "Cont_TiposTransaccion", "Cont_EventosContables", "Cont_ReglasEventos",
    "Cont_ReglasContables", "Cont_ReglasAsiento", "Articulos", "PreciosBase",
    "PerfilesPrecios", "PreciosEspeciales", "PreciosEspecialesItems", "ConfigEstados",
    "Modulos", "Config_CFE", "PlanesMetrosArticulosPermitidos"
];

async function generateScript() {
    let pool;
    try {
        pool = await new sql.ConnectionPool(config).connect();
        let out = `USE [SecureAppDB];\nGO\n\n`;
        out += `-- ============================================================================\n`;
        out += `-- SCRIPT DE INSERCION DIRECTA (POBLAR TABLAS MAESTRAS Y DE CONFIGURACION)\n`;
        out += `-- ============================================================================\n\n`;
        
        out += `PRINT '=== INICIANDO DESHABILITACION DE CONSTRAINTS ===';\n`;
        out += `EXEC sp_msforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL';\nGO\n\n`;
        
        for (let i = 0; i < tablas.length; i++) {
            const tabla = tablas[i];
            console.log(`Exportando tabla ${i + 1}/${tablas.length}: ${tabla}...`);
            
            // Vaciar la tabla primero para evitar conflictos de claves
            out += `-- --------------------------------------------------\n`;
            out += `-- TABLA: ${tabla}\n`;
            out += `-- --------------------------------------------------\n`;
            out += `PRINT '-> Procesando tabla ${tabla} (${i+1}/${tablas.length})';\n`;
            out += `DELETE FROM [dbo].[${tabla}];\n\n`;

            // Chequear si tiene identity
            const identCheck = await pool.request().query(`
                SELECT 1 AS HasIdentity 
                FROM sys.columns 
                WHERE object_id = object_id('dbo.[${tabla}]') AND is_identity = 1
            `);
            const hasIdentity = identCheck.recordset.length > 0;

            // Obtener columnas en orden
            const colCheck = await pool.request().query(`
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = '${tabla}' 
                ORDER BY ORDINAL_POSITION
            `);
            const columnasArr = colCheck.recordset.map(r => `[${r.COLUMN_NAME}]`);
            const colString = columnasArr.join(', ');

            // Obtener datos
            const datos = await pool.request().query(`SELECT * FROM [dbo].[${tabla}]`);
            
            if (datos.recordset.length > 0) {
                if (hasIdentity) {
                    out += `SET IDENTITY_INSERT [dbo].[${tabla}] ON;\n`;
                }

                // Generar los INSERTS en lotes para no hacer un script tan largo
                let insertBase = `INSERT INTO [dbo].[${tabla}] (${colString}) VALUES \n`;
                
                // Dividimos en bloques de 100
                const CHUNK_SIZE = 100;
                for (let j = 0; j < datos.recordset.length; j += CHUNK_SIZE) {
                    const chunk = datos.recordset.slice(j, j + CHUNK_SIZE);
                    const rowStrings = chunk.map(row => {
                        const vals = colCheck.recordset.map(col => formatValue(row[col.COLUMN_NAME]));
                        return `(${vals.join(', ')})`;
                    });
                    
                    out += insertBase + rowStrings.join(',\n') + ';\n';
                }

                if (hasIdentity) {
                    out += `SET IDENTITY_INSERT [dbo].[${tabla}] OFF;\n`;
                }
                out += `PRINT '   [OK] ${datos.recordset.length} filas insertadas en ${tabla}';\n`;
            } else {
                out += `PRINT '   [INFO] La tabla ${tabla} no tiene registros en origen.';\n`;
            }
            out += `GO\n\n`;
        }

        out += `PRINT '=== HABILITANDO CONSTRAINTS ===';\n`;
        out += `EXEC sp_msforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL';\nGO\n`;
        out += `PRINT '=== INSERCION DE DATOS COMPLETADA EXITOSAMENTE ===';\nGO\n`;

        fs.writeFileSync(path.join(__dirname, '04-POBLAR_TABLAS_DIRECTO.sql'), out, 'utf8');
        console.log('SCRIPT GENERADO CORRECTAMENTE: 04-POBLAR_TABLAS_DIRECTO.sql');
        
    } catch(err) {
        console.error('Error:', err);
    } finally {
        if (pool) await pool.close();
    }
}

generateScript();
