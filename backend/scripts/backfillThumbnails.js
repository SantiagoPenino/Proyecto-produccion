/**
 * backfillThumbnails.js
 * Genera thumbnails locales para todos los archivos PDF existentes en ArchivosOrden.
 * Uso: node scripts/backfillThumbnails.js
 *      node scripts/backfillThumbnails.js --concurrency=2
 *      node scripts/backfillThumbnails.js --noDocERP=DTF-1072   (solo una orden)
 *      node scripts/backfillThumbnails.js --force               (REGENERA los que ya existen)
 *
 * Modo cron (las órdenes del sync ERP no generan miniatura al crearse — este script
 * pasa cada tanto y tapa el hueco):
 *      node scripts/backfillThumbnails.js --dias=3 --lock --quiet
 *   --dias=N  solo archivos subidos en los últimos N días (incremental)
 *   --lock    no arranca si ya hay otra corrida viva (lockfile con PID)
 *   --quiet   no lista los que ya existen, solo lo que hace
 *
 * Archivos grandes (INF-SIS-2026-08, 27/10): antes bajaba el archivo entero a la memoria y, si fallaba,
 * lo reintentaba cada 10 minutos (el banner de 2,7 GB de EUV-38376 dejaba al proceso en 2,9 GB). Ahora:
 *   · mira el tamaño en Drive sin bajarlo;
 *   · hasta THUMB_MAX_MB (1 GB por defecto) lo baja a un temporal EN DISCO y hace la miniatura por ruta;
 *   · arriba de eso no lo baja: usa la miniatura de Drive (Drive tarda en generarla: las primeras 2 horas
 *     se espera a la corrida siguiente);
 *   · lo que no da miniatura queda con la marca {ArchivoID}.sin-miniatura y no se vuelve a intentar
 *     (--force y --noDocERP la ignoran, para reintentar a mano).
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { sql, getPool } = require('../config/db');
const driveService = require('../services/driveService');
const {
    generateThumbnailFromPath, generateImageThumbnail, tieneMarcaSinMiniatura, marcarSinMiniatura, LIMITE_BYTES,
} = require('../utils/thumbnailGenerator');
const fs = require('fs');
const os = require('os');
const { pipeline } = require('stream/promises');

// ── CLI args ──────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const CONCURRENCY = parseInt(args.concurrency || '1', 10); // Puppeteer es pesado, default 1
const FILTER_DOC  = args.noDocERP || null;
const FORCE       = !!args.force;   // --force = regenerar aunque ya exista el thumbnail
const DIAS        = args.dias ? parseInt(args.dias, 10) : null; // solo archivos de los últimos N días
const LOCK        = !!args.lock;    // lockfile: no correr dos a la vez (para cron)
const QUIET       = !!args.quiet;   // sin ruido de "ya existe" (para cron)

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

// Temporales de descarga (fuera de la carpeta de miniaturas). Si una corrida muere a mitad de camino,
// el temporal queda: la corrida siguiente borra los de más de un día.
const TMP_DIR = path.join(os.tmpdir(), 'backfill-thumbnails');
function limpiarTemporalesViejos() {
    try {
        fs.mkdirSync(TMP_DIR, { recursive: true });
        const limite = Date.now() - 24 * 3600 * 1000;
        for (const f of fs.readdirSync(TMP_DIR)) {
            const p = path.join(TMP_DIR, f);
            try { if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p); } catch (e) { console.log(`  ⚠️  No se pudo borrar el temporal viejo ${p}: ${e.message}`); }
        }
    } catch (e) {
        console.log(`  ⚠️  No se pudo revisar ${TMP_DIR}: ${e.message}`);
    }
}

const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toLocaleString('es-UY', { maximumFractionDigits: 0 })} MB`;
// Drive genera su miniatura un rato después de la subida: hasta 2 horas, se espera a la corrida siguiente.
const ESPERA_MINIATURA_DRIVE_MS = 2 * 3600 * 1000;

// ── Lock (para cron): si otra corrida sigue viva, salir sin hacer nada ────
const LOCK_FILE = path.join(require('os').tmpdir(), 'backfill-thumbnails.lock');
function tomarLock() {
    if (fs.existsSync(LOCK_FILE)) {
        const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
        let viva = false;
        if (pid) { try { process.kill(pid, 0); viva = true; } catch (e) { /* proceso muerto: lock huérfano */ } }
        if (viva) {
            console.log(`⏭️  Otra corrida en curso (PID ${pid}) — salgo.`);
            process.exit(0);
        }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch (e) { /* ya no está */ } });
    process.on('SIGINT',  () => process.exit(1));
    process.on('SIGTERM', () => process.exit(1));
}

// ── Main ──────────────────────────────────────────────────
async function main() {
    if (LOCK) tomarLock();
    limpiarTemporalesViejos();
    const pool = await getPool();

    console.log('🔍 Consultando archivos PDF en ArchivosOrden...');

    let query = `
        SELECT
            ao.ArchivoID,
            ao.NombreArchivo,
            ao.RutaAlmacenamiento,
            ao.TipoArchivo,
            DATEDIFF(minute, ao.FechaSubida, GETDATE()) AS MinutosDesdeSubida,
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
    if (DIAS) query += `  AND ao.FechaSubida >= DATEADD(day, -${DIAS}, GETDATE())\n`;
    query += `  ORDER BY o.CodigoOrden, ao.ArchivoID`;

    const result = await pool.request().query(query);
    const rows = result.recordset;

    const total = rows.length;
    console.log(`📄 ${total} archivos PDF encontrados.\n`);

    if (total === 0) {
        console.log('✅ Nada que procesar.');
        process.exit(0);
    }

    let ok = 0, skip = 0, fail = 0, marcados = 0, esperando = 0;
    // Con --force o --noDocERP se reintenta lo marcado (es a mano: la marca es para el cron)
    const respetarMarca = !FORCE && !FILTER_DOC;

    const marcar = (CodigoOrden, ArchivoID, label, motivo) => {
        marcarSinMiniatura(CodigoOrden, ArchivoID, motivo);
        console.log(`  🚫 Sin miniatura, no se reintenta: ${label} — ${motivo}`);
        marcados++;
    };

    // Procesar en chunks de CONCURRENCY
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const chunk = rows.slice(i, i + CONCURRENCY);
        const trabajoAntes = ok + fail + marcados; // para saltear la pausa si el chunk fue puro skip

        await Promise.all(chunk.map(async row => {
            const { ArchivoID, NombreArchivo, RutaAlmacenamiento, CodigoOrden, MinutosDesdeSubida } = row;
            const fileId = extractDriveId(RutaAlmacenamiento);
            const label  = `[${CodigoOrden} / ArchivoID=${ArchivoID}] ${NombreArchivo}`;

            // Saltar si ya existe (salvo --force, que regenera)
            if (!FORCE && thumbnailExists(CodigoOrden, ArchivoID)) {
                if (!QUIET) console.log(`  ⏭️  Ya existe: ${label}`);
                skip++;
                return;
            }
            // Ya se intentó y no dio miniatura: no se baja de nuevo
            if (respetarMarca && tieneMarcaSinMiniatura(CodigoOrden, ArchivoID)) {
                if (!QUIET) console.log(`  ⏭️  Marcado sin miniatura: ${label}`);
                skip++;
                return;
            }

            // Las -F (fallas internas) también llevan miniatura: planta la necesita en Control
            // y en el modal de falla. (Antes se salteaban acá y el generador las descartaba —
            // eso dejaba a Control sin vista previa al reportar fallas sobre una -F.)

            if (!fileId) {
                console.log(`  ⚠️  Sin Drive ID: ${label}`);
                fail++;
                return;
            }

            // Errores de Drive o de red no dejan marca: pueden ser pasajeros y se reintentan en la corrida
            // siguiente (no cuestan memoria: lo que no se baja no ocupa).
            let tmp = null;
            try {
                const meta = await driveService.getFileMeta(fileId);

                if (meta.size > LIMITE_BYTES) {
                    // Demasiado grande para rasterizar acá: la miniatura de Drive, sin bajar el archivo
                    const img = await driveService.getThumbnailImage(fileId, 1000, meta.thumbnailLink)
                        .catch(e => { console.log(`  ⚠️  No se pudo traer la miniatura de Drive: ${label} — ${e.message}`); return null; });
                    const thumbPath = img && await generateImageThumbnail(img, CodigoOrden, ArchivoID);
                    if (thumbPath) {
                        console.log(`  ✅ OK con la miniatura de Drive (${fmtMB(meta.size)}): ${thumbPath}`);
                        ok++;
                    } else if ((MinutosDesdeSubida ?? Infinity) * 60000 < ESPERA_MINIATURA_DRIVE_MS) {
                        console.log(`  ⏳ ${fmtMB(meta.size)}, Drive todavía no tiene miniatura: ${label} — se espera a la corrida siguiente`);
                        esperando++;
                    } else {
                        marcar(CodigoOrden, ArchivoID, label, `${fmtMB(meta.size)}: más que el límite de ${fmtMB(LIMITE_BYTES)} y Drive no tiene miniatura`);
                    }
                    return;
                }

                // Hasta el límite: a un temporal en disco (stream, no memoria) y miniatura por ruta
                console.log(`  ⬇️  Descargando (${fmtMB(meta.size)}): ${label}`);
                fs.mkdirSync(TMP_DIR, { recursive: true });
                tmp = path.join(TMP_DIR, `${ArchivoID}_${process.pid}.tmp`);
                const { stream } = await driveService.getFileStream(fileId);
                await pipeline(stream, fs.createWriteStream(tmp));

                console.log(`  🖼️  Generando thumbnail...`);
                const r = await generateThumbnailFromPath(tmp, CodigoOrden, ArchivoID, NombreArchivo);
                if (r.url) {
                    console.log(`  ✅ OK: ${r.url}`);
                    ok++;
                } else if (r.reintentar) {
                    console.log(`  ❌ ${r.motivo}: ${label} — se reintenta en la corrida siguiente`);
                    fail++;
                } else {
                    marcar(CodigoOrden, ArchivoID, label, r.motivo);
                }
            } catch (err) {
                console.log(`  ❌ Error: ${label} — ${err.message}`);
                fail++;
            } finally {
                if (tmp && fs.existsSync(tmp)) {
                    try { fs.unlinkSync(tmp); } catch (e) { console.log(`  ⚠️  No se pudo borrar el temporal ${tmp}: ${e.message}`); }
                }
            }
        }));

        // Pausa entre batches para no sobrecargar el rasterizado — SOLO si el batch hizo
        // trabajo real (descargó/generó). Los salteos por "ya existe" son instantáneos:
        // sin esta condición, una corrida sin nada que hacer dormía 500ms por archivo
        // (~12 min para 3 días de archivos) y el cron vivía ocupado al pedo.
        if (i + CONCURRENCY < rows.length && (ok + fail + marcados) > trabajoAntes) await sleep(500);
    }

    if (QUIET && ok === 0 && fail === 0 && marcados === 0 && esperando === 0) {
        console.log(`✅ ${new Date().toISOString()} — nada nuevo (${skip} al día).`);
    } else {
        console.log(`\n──────────────────────────────────────`);
        console.log(`✅ OK:        ${ok}`);
        console.log(`⏭️  Skip:     ${skip}`);
        console.log(`🚫 Marcados: ${marcados}`);
        console.log(`⏳ Esperando a Drive: ${esperando}`);
        console.log(`❌ Fail:     ${fail}`);
        console.log(`📦 Total:    ${total}`);
        console.log(`──────────────────────────────────────`);
    }
    process.exit(0);
}

main().catch(err => {
    console.error('💥 Error fatal:', err);
    process.exit(1);
});
