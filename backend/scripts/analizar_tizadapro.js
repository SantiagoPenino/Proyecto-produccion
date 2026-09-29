/**
 * ANÁLISIS ESTRUCTURAL DE TizadaPro
 * ------------------------------------
 * Conecta a la BD TizadaPro y muestra:
 *   1. Todas las tablas con sus columnas y tipos
 *   2. Relaciones (FK) entre tablas
 *   3. Datos completos de un molde (primer registro encontrado)
 *
 * Uso: node scripts/analizar_tizadapro.js [id_molde]
 */

require('dotenv').config();
const sql = require('mssql');

const cfg = {
  server: 'localhost',
  user:   'sa',
  password: '2441',
  database: 'TizadaPro',
  options: {
    trustServerCertificate: true,
    encrypt: false,
  },
  connectionTimeout: 15000,
};

const ID_MOLDE = process.argv[2] || null; // opcional: pasar ID por arg

async function main() {
  let pool;
  try {
    pool = await sql.connect(cfg);
    console.log('\n✅  Conectado a TizadaPro en localhost\n');
    console.log('═'.repeat(70));

    // ── 1. TABLAS Y COLUMNAS ───────────────────────────────────────────────
    const tablas = await pool.request().query(`
      SELECT
        t.TABLE_NAME,
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.CHARACTER_MAXIMUM_LENGTH,
        c.NUMERIC_PRECISION,
        c.NUMERIC_SCALE,
        c.IS_NULLABLE,
        c.COLUMN_DEFAULT,
        CASE WHEN kcu.COLUMN_NAME IS NOT NULL THEN 'PK' ELSE '' END AS IS_PK
      FROM INFORMATION_SCHEMA.TABLES t
      JOIN INFORMATION_SCHEMA.COLUMNS c
        ON c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_SCHEMA = t.TABLE_SCHEMA
      LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        ON tc.TABLE_NAME = t.TABLE_NAME AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
       AND kcu.COLUMN_NAME = c.COLUMN_NAME
      WHERE t.TABLE_TYPE = 'BASE TABLE'
      ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
    `);

    // Agrupar por tabla
    const tablasMap = {};
    for (const row of tablas.recordset) {
      if (!tablasMap[row.TABLE_NAME]) tablasMap[row.TABLE_NAME] = [];
      tablasMap[row.TABLE_NAME].push(row);
    }

    console.log(`\n📋  TABLAS ENCONTRADAS: ${Object.keys(tablasMap).length}\n`);

    for (const [tabla, cols] of Object.entries(tablasMap)) {
      console.log(`\n┌─ 📦 ${tabla}`);
      for (const col of cols) {
        const tipo = col.CHARACTER_MAXIMUM_LENGTH
          ? `${col.DATA_TYPE}(${col.CHARACTER_MAXIMUM_LENGTH === -1 ? 'MAX' : col.CHARACTER_MAXIMUM_LENGTH})`
          : col.NUMERIC_PRECISION
          ? `${col.DATA_TYPE}(${col.NUMERIC_PRECISION},${col.NUMERIC_SCALE})`
          : col.DATA_TYPE;
        const nullable = col.IS_NULLABLE === 'YES' ? '?' : ' ';
        const pk = col.IS_PK ? ' 🔑' : '';
        const def = col.COLUMN_DEFAULT ? ` = ${col.COLUMN_DEFAULT}` : '';
        console.log(`│  ${col.IS_PK ? '►' : ' '} ${col.COLUMN_NAME.padEnd(35)} ${tipo.padEnd(25)} ${nullable}${pk}${def}`);
      }
      console.log('└' + '─'.repeat(69));
    }

    // ── 2. RELACIONES (FK) ─────────────────────────────────────────────────
    const fks = await pool.request().query(`
      SELECT
        fk.name AS FK_NAME,
        tp.name AS TABLA_PADRE,
        cp.name AS COLUMNA_PADRE,
        tr.name AS TABLA_REF,
        cr.name AS COLUMNA_REF
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      JOIN sys.tables tp ON tp.object_id = fk.parent_object_id
      JOIN sys.columns cp ON cp.object_id = tp.object_id AND cp.column_id = fkc.parent_column_id
      JOIN sys.tables tr ON tr.object_id = fk.referenced_object_id
      JOIN sys.columns cr ON cr.object_id = tr.object_id AND cr.column_id = fkc.referenced_column_id
      ORDER BY tp.name, fk.name
    `);

    console.log('\n\n🔗  RELACIONES (Foreign Keys)\n');
    if (fks.recordset.length === 0) {
      console.log('  (Sin FK definidas)');
    } else {
      for (const fk of fks.recordset) {
        console.log(`  ${fk.TABLA_PADRE}.${fk.COLUMNA_PADRE}  →  ${fk.TABLA_REF}.${fk.COLUMNA_REF}   [${fk.FK_NAME}]`);
      }
    }

    // ── 3. BUSCAR TABLA DE MOLDES ──────────────────────────────────────────
    console.log('\n\n═'.repeat(70));
    console.log('🧩  BUSCANDO TABLA DE MOLDES...\n');

    // Detectar tabla que contenga "molde" en el nombre
    const tablaMolde = Object.keys(tablasMap).find(t =>
      t.toLowerCase().includes('molde') || t.toLowerCase().includes('mold')
    );

    if (!tablaMolde) {
      console.log('⚠️  No se encontró ninguna tabla con "molde" en el nombre.');
      console.log('    Tablas disponibles:', Object.keys(tablasMap).join(', '));
      return;
    }

    console.log(`✅  Tabla de moldes: ${tablaMolde}\n`);

    // Obtener un molde (con ID si se pasó como arg, o el primero)
    let qMolde;
    if (ID_MOLDE) {
      const pkCol = tablasMap[tablaMolde].find(c => c.IS_PK === 'PK')?.COLUMN_NAME;
      qMolde = await pool.request()
        .input('id', sql.Int, parseInt(ID_MOLDE))
        .query(`SELECT TOP 1 * FROM [${tablaMolde}] WHERE [${pkCol}] = @id`);
    } else {
      qMolde = await pool.request()
        .query(`SELECT TOP 1 * FROM [${tablaMolde}]`);
    }

    if (qMolde.recordset.length === 0) {
      console.log('⚠️  No hay moldes cargados en la tabla.');
      return;
    }

    const molde = qMolde.recordset[0];
    const pkCol = tablasMap[tablaMolde].find(c => c.IS_PK === 'PK')?.COLUMN_NAME;
    const moldeId = pkCol ? molde[pkCol] : '(sin PK detectada)';

    console.log(`\n🔍  MOLDE #${moldeId} — datos directos:\n`);
    for (const [campo, valor] of Object.entries(molde)) {
      console.log(`  ${campo.padEnd(40)} ${valor !== null ? valor : '(null)'}`);
    }

    // ── 4. TABLAS RELACIONADAS AL MOLDE ────────────────────────────────────
    console.log('\n\n📎  DATOS RELACIONADOS AL MOLDE\n');

    const fksMolde = fks.recordset.filter(fk =>
      fk.TABLA_REF.toLowerCase() === tablaMolde.toLowerCase() ||
      fk.TABLA_PADRE.toLowerCase() === tablaMolde.toLowerCase()
    );

    if (fksMolde.length === 0) {
      console.log('  (Sin relaciones FK con otras tablas detectadas)');
    }

    for (const fk of fksMolde) {
      // Si la tabla padre tiene FK hacia moldes → buscar registros hijos
      if (fk.TABLA_REF.toLowerCase() === tablaMolde.toLowerCase() && pkCol) {
        const rel = await pool.request()
          .input('moldeId', molde[pkCol])
          .query(`SELECT TOP 20 * FROM [${fk.TABLA_PADRE}] WHERE [${fk.COLUMNA_PADRE}] = @moldeId`);
        console.log(`\n  ↳ ${fk.TABLA_PADRE} (${rel.recordset.length} registros relacionados):`);
        if (rel.recordset.length > 0) {
          // Mostrar headers
          const headers = Object.keys(rel.recordset[0]);
          console.log('    ' + headers.join(' | '));
          console.log('    ' + '─'.repeat(80));
          for (const row of rel.recordset) {
            console.log('    ' + headers.map(h => String(row[h] ?? '').substring(0, 20)).join(' | '));
          }
        }
      }
    }

    // ── 5. ROWCOUNTS POR TABLA ─────────────────────────────────────────────
    console.log('\n\n📊  CONTEO DE FILAS POR TABLA\n');
    for (const tabla of Object.keys(tablasMap)) {
      try {
        const cnt = await pool.request()
          .query(`SELECT COUNT(*) AS total FROM [${tabla}]`);
        const total = cnt.recordset[0].total;
        console.log(`  ${tabla.padEnd(45)} ${total} filas`);
      } catch {
        console.log(`  ${tabla.padEnd(45)} (error al contar)`);
      }
    }

    console.log('\n\n✅  Análisis completado.\n');

  } catch (err) {
    console.error('\n❌  Error:', err.message);
    if (err.message.includes('Login failed')) {
      console.error('   → Verificá usuario/contraseña o que SQL Server esté corriendo.');
    }
    if (err.message.includes('Cannot open database')) {
      console.error('   → La base de datos "TizadaPro" no existe o el usuario no tiene acceso.');
    }
  } finally {
    if (pool) await sql.close();
  }
}

main();
