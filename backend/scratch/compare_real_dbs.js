const sql = require('mssql');
const fs = require('fs');

async function run() {
    try {
        const configSource = {
            user: 'sa', password: '2441', server: 'localhost', database: 'SecureAppDB2205',
            options: { encrypt: false, trustServerCertificate: true }
        };
        const configTarget = {
            user: 'sa', password: '2441', server: 'localhost', database: 'SecureAppDB',
            options: { encrypt: false, trustServerCertificate: true }
        };

        console.log("Connecting to databases...");
        const poolSource = await new sql.ConnectionPool(configSource).connect();
        const poolTarget = await new sql.ConnectionPool(configTarget).connect();
        console.log("Connected successfully.\n");

        let report = "";
        
        // 1. Compare Tables
        console.log("Comparing tables...");
        const queryTables = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME";
        const tablesSourceRes = await poolSource.request().query(queryTables);
        const tablesTargetRes = await poolTarget.request().query(queryTables);
        
        const tablesSource = tablesSourceRes.recordset.map(r => r.TABLE_NAME);
        const tablesTarget = tablesTargetRes.recordset.map(r => r.TABLE_NAME);
        
        const setSource = new Set(tablesSource);
        const setTarget = new Set(tablesTarget);
        
        const missingTablesInTarget = tablesSource.filter(t => !setTarget.has(t));
        const extraTablesInTarget = tablesTarget.filter(t => !setSource.has(t));
        
        report += "=== COMPARACIÓN DE TABLAS ===\n";
        if (missingTablesInTarget.length > 0) {
            report += `❌ Tablas faltantes en SecureAppDB (están en SecureAppDB2205):\n`;
            missingTablesInTarget.forEach(t => report += `   - ${t}\n`);
        } else {
            report += `✅ No faltan tablas en SecureAppDB.\n`;
        }
        
        if (extraTablesInTarget.length > 0) {
            report += `⚠️ Tablas extras en SecureAppDB (no están en SecureAppDB2205):\n`;
            extraTablesInTarget.forEach(t => report += `   - ${t}\n`);
        }
        report += "\n";
        
        // 2. Compare Columns
        console.log("Comparing columns...");
        report += "=== COMPARACIÓN DE COLUMNAS ===\n";
        let colDiffsCount = 0;
        
        const commonTables = tablesSource.filter(t => setTarget.has(t));
        for (const table of commonTables) {
            const queryCols = `
                SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = @tableName
                ORDER BY COLUMN_NAME
            `;
            
            const reqSource = poolSource.request();
            reqSource.input('tableName', sql.NVarChar, table);
            const colsSourceRes = await reqSource.query(queryCols);
            
            const reqTarget = poolTarget.request();
            reqTarget.input('tableName', sql.NVarChar, table);
            const colsTargetRes = await reqTarget.query(queryCols);
            
            const colsSourceMap = new Map(colsSourceRes.recordset.map(c => [c.COLUMN_NAME, c]));
            const colsTargetMap = new Map(colsTargetRes.recordset.map(c => [c.COLUMN_NAME, c]));
            
            let tableHeaderPrinted = false;
            const printTableHeader = () => {
                if (!tableHeaderPrinted) {
                    report += `📋 Tabla [${table}]:\n`;
                    tableHeaderPrinted = true;
                }
            };
            
            // Missing columns in Target
            for (const colName of colsSourceMap.keys()) {
                if (!colsTargetMap.has(colName)) {
                    printTableHeader();
                    report += `   ❌ Falta columna [${colName}] en SecureAppDB\n`;
                    colDiffsCount++;
                } else {
                    // Compare details
                    const cs = colsSourceMap.get(colName);
                    const ct = colsTargetMap.get(colName);
                    
                    let diffs = [];
                    if (cs.DATA_TYPE !== ct.DATA_TYPE) {
                        diffs.push(`Tipo: ${ct.DATA_TYPE} (debería ser ${cs.DATA_TYPE})`);
                    }
                    if (cs.CHARACTER_MAXIMUM_LENGTH !== ct.CHARACTER_MAXIMUM_LENGTH) {
                        diffs.push(`Longitud: ${ct.CHARACTER_MAXIMUM_LENGTH} (debería ser ${cs.CHARACTER_MAXIMUM_LENGTH})`);
                    }
                    if (cs.IS_NULLABLE !== ct.IS_NULLABLE) {
                        diffs.push(`Nullability: ${ct.IS_NULLABLE} (debería ser ${cs.IS_NULLABLE})`);
                    }
                    if (cs.NUMERIC_PRECISION !== ct.NUMERIC_PRECISION || cs.NUMERIC_SCALE !== ct.NUMERIC_SCALE) {
                        diffs.push(`Precisión/Escala: (${ct.NUMERIC_PRECISION},${ct.NUMERIC_SCALE}) (debería ser (${cs.NUMERIC_PRECISION},${cs.NUMERIC_SCALE}))`);
                    }
                    
                    if (diffs.length > 0) {
                        printTableHeader();
                        report += `   ⚠️ Columna [${colName}] tiene diferencias:\n`;
                        diffs.forEach(d => report += `      - ${d}\n`);
                        colDiffsCount++;
                    }
                }
            }
            
            // Extra columns in Target
            for (const colName of colsTargetMap.keys()) {
                if (!colsSourceMap.has(colName)) {
                    printTableHeader();
                    report += `   ➕ Columna extra [${colName}] en SecureAppDB\n`;
                    colDiffsCount++;
                }
            }
        }
        
        if (colDiffsCount === 0) {
            report += `✅ Todas las columnas coinciden exactamente.\n`;
        }
        report += "\n";
        
        // 3. Compare Stored Procedures
        console.log("Comparing stored procedures...");
        report += "=== COMPARACIÓN DE PROCEDIMIENTOS ALMACENADOS ===\n";
        
        const queryProcs = `
            SELECT ROUTINE_NAME 
            FROM INFORMATION_SCHEMA.ROUTINES 
            WHERE ROUTINE_TYPE='PROCEDURE' 
            ORDER BY ROUTINE_NAME
        `;
        
        const procsSourceRes = await poolSource.request().query(queryProcs);
        const procsTargetRes = await poolTarget.request().query(queryProcs);
        
        const procsSource = procsSourceRes.recordset.map(r => r.ROUTINE_NAME);
        const procsTarget = procsTargetRes.recordset.map(r => r.ROUTINE_NAME);
        
        const setProcsSource = new Set(procsSource);
        const setProcsTarget = new Set(procsTarget);
        
        const missingProcsInTarget = procsSource.filter(p => !setProcsTarget.has(p));
        const extraProcsInTarget = procsTarget.filter(p => !setProcsSource.has(p));
        
        if (missingProcsInTarget.length > 0) {
            report += `❌ Procedimientos faltantes en SecureAppDB:\n`;
            missingProcsInTarget.forEach(p => report += `   - ${p}\n`);
        } else {
            report += `✅ No faltan procedimientos en SecureAppDB.\n`;
        }
        
        if (extraProcsInTarget.length > 0) {
            report += `⚠️ Procedimientos extras en SecureAppDB:\n`;
            extraProcsInTarget.forEach(p => report += `   - ${p}\n`);
        }
        report += "\n";
        
        // Compare code/definition of common SPs
        console.log("Comparing procedure bodies...");
        report += "=== DIFERENCIAS EN EL CONTENIDO DE PROCEDIMIENTOS ===\n";
        let procContentDiffs = 0;
        
        const commonProcs = procsSource.filter(p => setProcsTarget.has(p));
        for (const proc of commonProcs) {
            const queryDef = `
                SELECT OBJECT_DEFINITION(OBJECT_ID(@procName)) AS Def
            `;
            
            const reqS = poolSource.request();
            reqS.input('procName', sql.NVarChar, proc);
            const defSRes = await reqS.query(queryDef);
            const defS = defSRes.recordset[0]?.Def || "";
            
            const reqT = poolTarget.request();
            reqT.input('procName', sql.NVarChar, proc);
            const defTRes = await reqT.query(queryDef);
            const defT = defTRes.recordset[0]?.Def || "";
            
            // Clean up whitespaces, newlines and comments to check logical equivalence
            const clean = (str) => str.replace(/\s+/g, ' ').replace(/--.*?\n/g, '').trim().toLowerCase();
            
            if (clean(defS) !== clean(defT)) {
                report += `⚠️ Procedimiento [${proc}] difiere en su definición / código.\n`;
                procContentDiffs++;
            }
        }
        
        if (procContentDiffs === 0) {
            report += `✅ Todos los cuerpos de procedimientos coincidentes son lógicamente iguales.\n`;
        }
        
        console.log("Writing report...");
        fs.writeFileSync('C:\\Integracion\\User-Macrosoft\\Proyecto-produccion\\backend\\scratch\\db_compare_report.txt', report);
        console.log("Report generated successfully.\n");
        console.log(report);
        
        await poolSource.close();
        await poolTarget.close();
        process.exit(0);
    } catch (err) {
        console.error("Error executing comparison:", err);
        process.exit(1);
    }
}

run();
