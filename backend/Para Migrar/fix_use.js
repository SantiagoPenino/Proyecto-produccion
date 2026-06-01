const fs = require('fs');
const path = require('path');

const dir = 'c:\\Integracion\\User-Macrosoft\\Proyecto-produccion\\backend\\Para Migrar';
const files = [
    '01-TABLAS_FALTANTES.sql',
    '02-COLUMNAS_NUEVAS.sql',
    '03-STORED_PROCEDURES.sql',
    '04-POBLAR_TABLAS_DIRECTO.sql'
];

const header = "USE [SecureAppDB];\nGO\n\n";

for (const file of files) {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Limpiar cualquier USE anterior
    content = content.replace(/USE \[.*\];\r?\nGO\r?\n\r?\n/i, '');
    content = content.replace(/USE \[.*\];\nGO\n\n/i, '');
    content = content.replace(/USE \[.*\];\s*GO\s*/i, '');
    
    // Si empieza con algo de USE suelto, limpiarlo también por si acaso
    if (content.startsWith('USE')) {
        const firstGoIndex = content.indexOf('GO') + 2;
        content = content.substring(firstGoIndex).trim();
    }
    
    fs.writeFileSync(filePath, header + content);
    console.log(`Actualizado ${file}`);
}
