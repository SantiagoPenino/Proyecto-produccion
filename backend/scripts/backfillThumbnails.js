/**
 * backfillThumbnails.js
 * Genera thumbnails locales para todos los archivos PDF existentes en ArchivosOrden.
 * Uso: node scripts/backfillThumbnails.js
 *      node scripts/backfillThumbnails.js --concurrency=2
 *      node scripts/backfillThumbnails.js --noDocERP=DTF-1072   (solo una orden)
 *      node scripts/backfillThumbnails.js --force               (REGENERA los que ya existen)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { sql, getPool } = require('../config/db');
const driveService = require('../services/driveService');
const { generateThumbnail } = require('../utils/thumbnailGenerator');
const fs = require('fs');

// ── CLI args ──────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const CONCURRENCY = parseInt(args.concurrency || '1', 10); // Puppeteer es pesado, default 1
const FILTER_DOC  = args.noDocERP || null;
const FORCE       = !!args.force;   // --force = regenerar aunque ya exista el thumbnail

// ── Helpers ───────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Los links de Drive están guardados en DOS formatos según de dónde vino el archivo:
//   · https://drive.google.com/file/d/<ID>/view   (subidas por el sistema)
//   · https://drive.google.com/open?id=<ID>       (sistema viejo — matrices TPU migradas)
// Antes solo se reconocía el primero y, al no matchear, se devolvía la URL CRUDA como fileId:
// Drive respondía 404 "File not found: https://..." y quedaban 748 archivos figurando como
// perdidos cuando en realidad existen y son accesibles. El proxy de archivos del backend usa
// la heurística de abajo (corrida larga de caracteres de ID) y por eso sí los encontraba.
function extractDriveId(raw) {
    if (!raw) return null;
    const s = String(raw);
    const m = s.match(/\/file\/d\/([^/?&]+)/);      // /file/d/<ID>
    if (m) return m[1];
    const q = s.match(/[?&]id=([^&]+)/);            // ?id=<ID> / &id=<ID>
    if (q) return q[1];
    const g = s.match(/[-\w]{25,}/);                // último recurso: el ID suelto
    return g ? g[0] : null;                         // null → el script lo reporta como "Sin Drive ID"
}

const THUMBNAILS_DIR = process.env.THUMBNAILS_PATH || path.join(__dirname, '..', 'thumbnails');

function thumbnailExists(codigoOrden, archivoId) {
    return fs.existsSync(path.join(THUMBNAILS_DIR, String(codigoOrden), `${archivoId}.jpg`));
}

// ── Main ──────────────────────────────────────────────────
async function main() {
    const pool = await getPool();

    console.log('🔍 Consultando archivos PDF en ArchivosOrden...');

    let query = `
        SELECT
            ao.ArchivoID,
            ao.NombreArchivo,
            ao.RutaAlmacenamiento,
            ao.TipoArchivo,
            o.CodigoOrden,
            o.NoDocERP
        FROM ArchivosOrden ao WITH(NOLOCK)
        INNER JOIN Ordenes o WITH(NOLOCK) ON o.OrdenID = ao.OrdenID
        WHERE ao.RutaAlmacenamiento IS NOT NULL
          AND ao.EstadoArchivo != 'Cancelado'
          AND (
              LOWER(ao.NombreArchivo) LIKE '%.pdf'
              OR LOWER(ao.NombreArchivo) LIKE '%.png'
              OR LOWER(ao.TipoArchivo) LIKE '%pdf%'
              OR LOWER(ao.TipoArchivo) LIKE '%png%'
          )
    `;
    if (FILTER_DOC) query += `  AND o.CodigoOrden = '${FILTER_DOC}'\n`;
    query += `  ORDER BY o.CodigoOrden, ao.ArchivoID`;

    const result = await pool.request().query(query);
    const rows = result.recordset;

    const total = rows.length;
    console.log(`📄 ${total} archivos PDF encontrados.\n`);

    if (total === 0) {
        console.log('✅ Nada que procesar.');
        process.exit(0);
    }

    let ok = 0, skip = 0, fail = 0;

    // Procesar en chunks de CONCURRENCY
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const chunk = rows.slice(i, i + CONCURRENCY);

        await Promise.all(chunk.map(async row => {
            const { ArchivoID, NombreArchivo, RutaAlmacenamiento, CodigoOrden } = row;
            const fileId = extractDriveId(RutaAlmacenamiento);
            const label  = `[${CodigoOrden} / ArchivoID=${ArchivoID}] ${NombreArchivo}`;

            // Saltar si ya existe (salvo --force, que regenera)
            if (!FORCE && thumbnailExists(CodigoOrden, ArchivoID)) {
                console.log(`  ⏭️  Ya existe: ${label}`);
                skip++;
                return;
            }

            // Las -F (fallas internas) no llevan miniatura: no se le muestran al cliente y el
            // generador las descarta. Se saltean ACÁ, antes de bajarlas — así no se gastan ~440
            // descargas de Drive por corrida para tirar el resultado, y dejan de contarse como
            // "fallo" (que era lo que inflaba el resumen final).
            if (String(CodigoOrden || '').toUpperCase().includes('-F')) {
                console.log(`  ⏭️  Falla interna (sin miniatura): ${label}`);
                skip++;
                return;
            }

            if (!fileId) {
                console.log(`  ⚠️  Sin Drive ID: ${label}`);
                fail++;
                return;
            }

            try {
                console.log(`  ⬇️  Descargando: ${label}`);
                const { stream } = await driveService.getFileStream(fileId);

                // Convertir stream a buffer
                const chunks = [];
                await new Promise((resolve, reject) => {
                    stream.on('data', d => chunks.push(d));
                    stream.on('end', resolve);
                    stream.on('error', reject);
                });
                const buffer = Buffer.concat(chunks);

                console.log(`  🖼️  Generando thumbnail...`);
                const thumbPath = await generateThumbnail(buffer, CodigoOrden, ArchivoID, NombreArchivo);

                if (thumbPath) {
                    console.log(`  ✅ OK: ${thumbPath}`);
                    ok++;
                } else {
                    console.log(`  ❌ Puppeteer no generó thumbnail: ${label}`);
                    fail++;
                }
            } catch (err) {
                console.log(`  ❌ Error: ${label} — ${err.message}`);
                fail++;
            }
        }));

        // Pausa entre batches para no sobrecargar Puppeteer
        if (i + CONCURRENCY < rows.length) await sleep(500);
    }

    console.log(`\n──────────────────────────────────────`);
    console.log(`✅ OK:      ${ok}`);
    console.log(`⏭️  Skip:   ${skip}`);
    console.log(`❌ Fail:   ${fail}`);
    console.log(`📦 Total:  ${total}`);
    console.log(`──────────────────────────────────────`);
    process.exit(0);
}

main().catch(err => {
    console.error('💥 Error fatal:', err);
    process.exit(1);
});
