/**
 * MIGRACIÓN: Renombrar comprobantes de entrega al nuevo formato
 * ─────────────────────────────────────────────────────────────
 * Formato viejo : 1777547873230-image.jpg  (timestamp + "-image")
 * Formato nuevo : REM-780244-7259.jpg      (remitoCode + número de retiro)
 *
 * MODO SEGURO (vista previa, no toca nada):
 *   node scripts/migrate-comprobante-names.js
 *
 * MODO APLICAR (renombra archivos y actualiza DB):
 *   node scripts/migrate-comprobante-names.js --apply
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const sql  = require('mssql');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DRY_RUN = !process.argv.includes('--apply');

// ─── Carpeta física de los comprobantes ──────────────────────────────────────
const UPLOAD_FOLDER =
  process.env.COMPROBANTES_ENCOMIENDAS_PATH ||
  path.join(__dirname, '../comprobantesEncomiendas');

// ─── Conexión MSSQL (igual que el resto del backend) ─────────────────────────
const dbConfig = {
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server:   process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options:  { encrypt: false, trustServerCertificate: true },
};

// ─── Misma lógica de sufijo que multerEncomiendasConfig.js ───────────────────
function buildSufijo(rawOrden) {
  if (!rawOrden || !rawOrden.trim()) return null;
  return rawOrden
    .trim()
    .replace(/^[A-Za-z]+-?/, '')          // quita prefijo tipo "RW-" o "RL-"
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Detecta el patrón viejo: <timestamp>-image.<ext> ────────────────────────
const OLD_PATTERN = /^\d{10,}-image\.(jpg|jpeg|png|webp|gif|bmp|tiff?)$/i;

function isOldFormat(filename) {
  return OLD_PATTERN.test(filename);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' Migración de nombres de comprobantes');
  console.log(DRY_RUN ? ' MODO: DRY-RUN (solo vista previa)' : ' MODO: APLICAR CAMBIOS');
  console.log('══════════════════════════════════════════════════\n');

  const pool = await sql.connect(dbConfig);

  // ─── PASO 0: Corregir prefijo de carpeta ─────────────────────────────────────
  //   Independientemente del formato del nombre de archivo, todos los registros
  //   de Logistica_Bultos que apunten a /comprobantesPagos/ deben redirigirse a
  //   /comprobantesEncomiendas/ (carpeta correcta para logística).
  const wrongPrefixRes = await pool.request().query(`
    SELECT COUNT(*) AS Total
    FROM Logistica_Bultos
    WHERE ComprobantePath LIKE '/comprobantesPagos/%'
  `);
  const wrongCount = wrongPrefixRes.recordset[0].Total;

  if (wrongCount > 0) {
    console.log(`🔧  Paso 0: ${wrongCount} registro(s) con prefijo /comprobantesPagos/ → corrigiendo a /comprobantesEncomiendas/`);
    if (DRY_RUN) {
      console.log(`  ✏️  [DRY-RUN] Se actualizarían ${wrongCount} fila(s) en DB\n`);
    } else {
      await pool.request().query(`
        UPDATE Logistica_Bultos
        SET ComprobantePath = '/comprobantesEncomiendas/' + SUBSTRING(ComprobantePath, LEN('/comprobantesPagos/') + 1, LEN(ComprobantePath))
        WHERE ComprobantePath LIKE '/comprobantesPagos/%'
      `);
      console.log(`  ✅  DB actualizada (${wrongCount} fila${wrongCount > 1 ? 's' : ''})\n`);
    }
  } else {
    console.log('✅  Paso 0: Sin registros con prefijo erróneo. OK\n');
  }

  // ─── PASO 0.5: Corregir extensión → .webp ────────────────────────────────────
  //   Los archivos físicos fueron convertidos a WebP. Actualizamos la extensión
  //   en DB para que los links del frontend apunten al archivo correcto.
  const wrongExtRes = await pool.request().query(`
    SELECT COUNT(*) AS Total
    FROM Logistica_Bultos
    WHERE ComprobantePath LIKE '/comprobantesEncomiendas/%'
      AND ComprobantePath NOT LIKE '%.webp'
      AND ComprobantePath IS NOT NULL
  `);
  const wrongExtCount = wrongExtRes.recordset[0].Total;

  if (wrongExtCount > 0) {
    console.log(`🔧  Paso 0.5: ${wrongExtCount} registro(s) sin extensión .webp → corrigiendo`);
    if (DRY_RUN) {
      console.log(`  ✏️  [DRY-RUN] Se actualizarían ${wrongExtCount} fila(s) en DB\n`);
    } else {
      // Reemplaza la extensión: recorta hasta el último punto y añade .webp
      await pool.request().query(`
        UPDATE Logistica_Bultos
        SET ComprobantePath =
          LEFT(ComprobantePath, LEN(ComprobantePath) - CHARINDEX('.', REVERSE(ComprobantePath))) + '.webp'
        WHERE ComprobantePath LIKE '/comprobantesEncomiendas/%'
          AND ComprobantePath NOT LIKE '%.webp'
          AND ComprobantePath IS NOT NULL
      `);
      console.log(`  ✅  DB actualizada (${wrongExtCount} fila${wrongExtCount > 1 ? 's' : ''})\n`);
    }
  } else {
    console.log('✅  Paso 0.5: Todas las extensiones ya son .webp. OK\n');
  }


  //    Agrupamos por ComprobantePath para manejar el caso donde
  //    varios bultos comparten el mismo comprobante.
  const result = await pool.request().query(`
    SELECT
      b.BultoID,
      b.ComprobantePath,
      b.CodigoEtiqueta,
      e.CodigoRemito,
      ISNULL(ret.FormaRetiro, 'R') + '-' + CAST(ret.OReIdOrdenRetiro AS VARCHAR) AS RetiroAsociado
    FROM Logistica_Bultos b
    JOIN Logistica_EnvioItems ei ON ei.BultoID = b.BultoID
    JOIN Logistica_Envios     e  ON e.EnvioID  = ei.EnvioID
    LEFT JOIN OrdenesRetiro   ret ON b.OrdenID = ret.OReIdOrdenRetiro
    WHERE b.ComprobantePath IS NOT NULL
    ORDER BY b.ComprobantePath, b.BultoID
  `);

  // Filtrar sólo los que tienen nombre viejo
  const rows = result.recordset.filter(r => {
    const filename = (r.ComprobantePath || '').split('/').pop();
    return isOldFormat(filename);
  });

  if (rows.length === 0) {
    console.log('✅  No se encontraron comprobantes en formato viejo. Nada que hacer.\n');
    await pool.close();
    return;
  }

  console.log(`📋  Comprobantes a migrar: ${rows.length} registro(s)\n`);

  // 2. Agrupar por ComprobantePath (un archivo puede cubrir varios bultos)
  const groups = {};
  for (const row of rows) {
    const key = row.ComprobantePath;
    if (!groups[key]) {
      groups[key] = { rows: [], remitoCode: row.CodigoRemito, retiroAsociado: row.RetiroAsociado || row.CodigoEtiqueta };
    }
    groups[key].rows.push(row);
  }

  let ok = 0, skipped = 0, errors = 0;

  for (const [oldDbPath, group] of Object.entries(groups)) {
    const oldFilename = oldDbPath.split('/').pop();
    const ext         = path.extname(oldFilename); // .jpg, .png, etc.
    const remitoCode  = group.remitoCode || 'SIN-REMITO';
    const sufijo      = buildSufijo(group.retiroAsociado) || `bulto-${group.rows[0].BultoID}`;
    const newFilename = `${remitoCode}-${sufijo}${ext}`;
    const newDbPath   = `/comprobantesEncomiendas/${newFilename}`;

    const oldPhysical = path.join(UPLOAD_FOLDER, oldFilename);
    const newPhysical = path.join(UPLOAD_FOLDER, newFilename);

    const bultoIds = group.rows.map(r => r.BultoID).join(', ');

    console.log(`📁  ${oldFilename}`);
    console.log(`  → ${newFilename}`);
    console.log(`  Bultos: [${bultoIds}]  |  Remito: ${remitoCode}`);

    // Verificar si el archivo físico existe
    const fileExists = fs.existsSync(oldPhysical);
    if (!fileExists) {
      console.log(`  ⚠️  Archivo físico no encontrado en: ${oldPhysical}`);
      console.log(`      (Se actualizará solo el registro en DB si aplica)`);
    }

    // Verificar colisión con nombre nuevo
    if (fs.existsSync(newPhysical) && oldFilename !== newFilename) {
      console.log(`  ❌  Ya existe un archivo con el nombre nuevo → SALTADO\n`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ✏️  [DRY-RUN] Se renombraría el archivo y se actualizaría DB\n`);
      ok++;
      continue;
    }

    // ─── APLICAR ──────────────────────────────────────────────────────────────
    try {
      // Renombrar archivo físico
      if (fileExists && oldFilename !== newFilename) {
        fs.renameSync(oldPhysical, newPhysical);
        console.log(`  ✅  Archivo renombrado en disco`);
      }

      // Actualizar DB: todos los bultos que usaban el path viejo
      const idsList = group.rows.map(r => r.BultoID).join(',');
      await pool.request()
        .input('NewPath', sql.NVarChar, newDbPath)
        .query(`
          UPDATE Logistica_Bultos
          SET    ComprobantePath = @NewPath
          WHERE  BultoID IN (${idsList})
        `);
      console.log(`  ✅  DB actualizada (${group.rows.length} fila${group.rows.length > 1 ? 's' : ''})\n`);
      ok++;
    } catch (err) {
      console.error(`  ❌  Error: ${err.message}\n`);
      errors++;
    }
  }

  // ─── Resumen ────────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════');
  console.log(` Resultado:`);
  console.log(`   ✅  Procesados : ${ok}`);
  console.log(`   ⏭️  Saltados   : ${skipped}`);
  console.log(`   ❌  Errores    : ${errors}`);
  if (DRY_RUN) {
    console.log('\n  Para aplicar los cambios corré:');
    console.log('  node scripts/migrate-comprobante-names.js --apply');
  }
  console.log('══════════════════════════════════════════════════\n');

  await pool.close();
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
