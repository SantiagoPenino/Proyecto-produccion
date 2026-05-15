const sql = require('mssql');
const fs = require('fs');

async function run() {
    try {
        const config = {
            user: 'sa',
            password: '2441',
            server: 'localhost',
            database: 'SecureAppDBMIANO BORRAR',
            options: {
                encrypt: false,
                trustServerCertificate: true
            }
        };
        const pool = await sql.connect(config);
        
        let output = "USE [PRODUCCION ACTUAL];\nGO\n";
        
        // Deletion order (child first)
        const deleteTables = [
            'Cont_ReglasAsiento',
            'Cont_EventosContables',
            'Cont_PlanCuentas'
        ];
        
        // Insertion order (parent first)
        const insertTables = [
            'Cont_PlanCuentas',
            'Cont_EventosContables',
            'Cont_ReglasAsiento'
        ];
        
        for (const table of deleteTables) {
            output += `DELETE FROM dbo.${table};\n`;
        }
        output += "GO\n\n";
        
        for (const table of insertTables) {
            const result = await pool.request().query(`SELECT * FROM dbo.${table}`);
            
            // check identity
            const identRes = await pool.request().query(`
                SELECT name FROM sys.columns 
                WHERE object_id = OBJECT_ID('dbo.${table}') AND is_identity = 1
            `);
            const hasIdentity = identRes.recordset.length > 0;
            
            if (hasIdentity) output += `SET IDENTITY_INSERT dbo.${table} ON;\nGO\n`;
            
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
                output += `INSERT INTO dbo.${table} (${keys.join(', ')}) VALUES (${values.join(', ')});\n`;
            }
            
            if (hasIdentity) output += `GO\nSET IDENTITY_INSERT dbo.${table} OFF;\nGO\n`;
        }
        
        fs.writeFileSync('migrate_contabilidad_miano_a_produccion.sql', output);
        console.log("Script generado: migrate_contabilidad_miano_a_produccion.sql");
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
