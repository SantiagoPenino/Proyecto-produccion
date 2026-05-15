const sql = require('mssql');
const fs = require('fs');

async function run() {
    try {
        const configSecure = {
            user: 'sa', password: '2441', server: 'localhost', database: 'SecureAppDB',
            options: { encrypt: false, trustServerCertificate: true }
        };
        const configBackup = {
            user: 'sa', password: '2441', server: 'localhost', database: 'BACKUP',
            options: { encrypt: false, trustServerCertificate: true }
        };

        const poolS = await new sql.ConnectionPool(configSecure).connect();
        const poolB = await new sql.ConnectionPool(configBackup).connect();

        let output = "USE [BACKUP];\nGO\n\n";

        // 1. Missing Tables
        const tablesS = await poolS.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'");
        const tablesB = await poolB.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'");
        
        const setB = new Set(tablesB.recordset.map(t => t.TABLE_NAME));
        const missingTables = tablesS.recordset.filter(t => !setB.has(t.TABLE_NAME)).map(t => t.TABLE_NAME);

        output += "-- ===========================\n-- TABLAS FALTANTES\n-- ===========================\n";
        for (const t of missingTables) {
            const columns = await poolS.request().query(`
                SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.IS_NULLABLE,
                COLUMNPROPERTY(OBJECT_ID('[${t}]'), c.COLUMN_NAME, 'IsIdentity') as is_identity
                FROM INFORMATION_SCHEMA.COLUMNS c WHERE TABLE_NAME='${t}'
            `);
            output += `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='${t}')\n`;
            output += `CREATE TABLE dbo.[${t}] (\n`;
            const cols = columns.recordset.map(c => {
                let def = `    [${c.COLUMN_NAME}] ${c.DATA_TYPE}`;
                if (c.CHARACTER_MAXIMUM_LENGTH) {
                    def += c.CHARACTER_MAXIMUM_LENGTH === -1 ? '(MAX)' : `(${c.CHARACTER_MAXIMUM_LENGTH})`;
                }
                if (c.is_identity) def += ' IDENTITY(1,1)';
                def += c.IS_NULLABLE === 'NO' ? ' NOT NULL' : ' NULL';
                return def;
            });
            output += cols.join(',\n') + '\n);\nGO\n\n';
        }

        // 2. Missing Columns
        output += "-- ===========================\n-- COLUMNAS FALTANTES\n-- ===========================\n";
        for (const t of tablesS.recordset.map(x=>x.TABLE_NAME)) {
            if (missingTables.includes(t)) continue;
            const colsS = await poolS.request().query(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}'`);
            const colsB = await poolB.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}'`);
            const setColsB = new Set(colsB.recordset.map(c => c.COLUMN_NAME));
            
            for (const cs of colsS.recordset) {
                if (!setColsB.has(cs.COLUMN_NAME)) {
                    let type = cs.DATA_TYPE;
                    if (cs.CHARACTER_MAXIMUM_LENGTH) type += cs.CHARACTER_MAXIMUM_LENGTH === -1 ? '(MAX)' : `(${cs.CHARACTER_MAXIMUM_LENGTH})`;
                    const nullability = cs.IS_NULLABLE === 'NO' ? 'NOT NULL DEFAULT 0' : 'NULL'; 
                    output += `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}' AND COLUMN_NAME='${cs.COLUMN_NAME}')\n`;
                    output += `ALTER TABLE dbo.[${t}] ADD [${cs.COLUMN_NAME}] ${type} ${nullability};\nGO\n`;
                }
            }
        }

        // 3. Stored Procedures
        output += "-- ===========================\n-- STORED PROCEDURES\n-- ===========================\n";
        const sps = await poolS.request().query(`
            SELECT ROUTINE_NAME, ROUTINE_DEFINITION 
            FROM INFORMATION_SCHEMA.ROUTINES 
            WHERE ROUTINE_TYPE='PROCEDURE' AND ROUTINE_NAME LIKE 'SP_%'
        `);
        for (const sp of sps.recordset) {
            output += `IF OBJECT_ID('dbo.[${sp.ROUTINE_NAME}]', 'P') IS NOT NULL DROP PROCEDURE dbo.[${sp.ROUTINE_NAME}];\nGO\n`;
            const def = await poolS.request().query(`EXEC sp_helptext '${sp.ROUTINE_NAME}'`);
            let spText = def.recordset.map(r => r.Text).join('');
            output += spText + "\nGO\n\n";
        }

        // 4. DATA INSERTIONS FOR MISSING TABLES
        output += "-- ===========================\n-- DATOS DE TABLAS FALTANTES\n-- ===========================\n";
        const skipTables = ['SINCRONIZAR DATOS SISTEMAS - SINCRO', 'SINCRO-ARTICULOSVIEJA'];
        
        for (const t of missingTables) {
            if (skipTables.includes(t)) continue;
            
            const result = await poolS.request().query(`SELECT * FROM dbo.[${t}]`);
            if (result.recordset.length === 0) continue; // no data

            const identRes = await poolS.request().query(`
                SELECT name FROM sys.columns 
                WHERE object_id = OBJECT_ID('dbo.[${t}]') AND is_identity = 1
            `);
            const hasIdentity = identRes.recordset.length > 0;
            
            if (hasIdentity) output += `SET IDENTITY_INSERT dbo.[${t}] ON;\nGO\n`;
            
            for (const row of result.recordset) {
                const keys = Object.keys(row);
                const values = keys.map(k => {
                    const val = row[k];
                    if (val === null) return 'NULL';
                    if (typeof val === 'number') return val;
                    if (typeof val === 'boolean') return val ? 1 : 0;
                    if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
                    return `'${String(val).replace(/'/g, "''")}'`;
                });
                output += `INSERT INTO dbo.[${t}] ([${keys.join('], [')}]) VALUES (${values.join(', ')});\n`;
            }
            
            if (hasIdentity) output += `GO\nSET IDENTITY_INSERT dbo.[${t}] OFF;\nGO\n`;
            output += '\n';
        }

        fs.writeFileSync('C:\\Integracion\\User-Macrosoft\\Proyecto-produccion\\update_backup_from_secureapp.sql', output);
        console.log("Done");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();
