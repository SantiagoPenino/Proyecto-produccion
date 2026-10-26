/**
 * [DTF] Capa de tinta blanca automática al subir el arte (área DF).
 *
 * Reemplaza la acción de Photoshop del operario: cuando el cliente sube su arte DTF, acá se
 * genera el PDF con el spot de blanco (python/dtf_blanco.py) y se guarda como ARCHIVO DE
 * REFERENCIA de la orden — `ArchivosOrden` sigue apuntando al original del cliente (decisión
 * 14/08: primero se prueba; cambiar qué baja producción es un paso posterior).
 *
 * Diseño:
 *  - COLA DE A UNO: rasterizar a 300 dpi un arte grande es pesado en RAM; dos subidas
 *    simultáneas no pueden duplicar ese pico en el VPS.
 *  - BEST-EFFORT: nada de esto puede tirar abajo una subida. Si falla, queda el log y el
 *    operario hace la acción de Photoshop como siempre (peor caso = status quo).
 *  - El temporal de la subida se COPIA acá (sincrónico) porque uploadOrderFile lo borra en
 *    su finally; la cola trabaja sobre la copia y la limpia al terminar.
 *
 * Config (env):
 *  - DTF_BLANCO_ENABLED: '0' lo apaga (default: prendido).
 *  - PYTHON_DTF_BIN: binario de Python a usar. Si no está, se prueba el venv del server
 *    (/opt/suite_user/venv/bin/python) y después python3/python, probados con --version
 *    (en Windows, python primero).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

const SCRIPT = path.join(__dirname, '..', 'python', 'dtf_blanco.py');
const WORKDIR = path.join(os.tmpdir(), 'dtf-blanco');

const habilitado = () => process.env.DTF_BLANCO_ENABLED !== '0';

// ── Resolución del binario de Python (se resuelve una vez y queda cacheado) ──
// 23/10: los nombres pelados se prueban con `--version` y en Windows va 'python' primero, como en
// tpuMatrizService. Antes se aceptaba 'python3' sin probarlo: en Windows es el acceso directo de la
// Microsoft Store, sale con código 9009 y la capa fallaba en todas las subidas al backend local.
let pythonBin = null;
function resolverPython() {
    if (pythonBin) return pythonBin;
    const { spawnSync } = require('child_process');
    const pelados = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
    const candidatos = [process.env.PYTHON_DTF_BIN, '/opt/suite_user/venv/bin/python', ...pelados].filter(Boolean);
    for (const c of candidatos) {
        try {
            if (c.includes('/') || c.includes('\\')) {
                if (!fs.existsSync(c)) continue;
            } else {
                const r = spawnSync(c, ['--version'], { windowsHide: true, timeout: 5000 });
                if (r.error || r.status !== 0) continue;
            }
            pythonBin = c;
            return c;
        } catch (_) { /* siguiente */ }
    }
    pythonBin = pelados[0];
    return pythonBin;
}

// ── Freno de memoria (22/10/2026, DTF-37531) ─────────────────────────────────
// Un PNG de más de 268 Mpx hizo que el script llegara a 11,9 GB: el OOM killer del VPS (15 GB, con el
// SQL y TIZADA adentro) lo mató a las 11:58:04 y el backend se reinició 3 s después. Ahora, antes de
// correrlo:
//  - si el arte pasa MAX_MPX, no se intenta (2,5 m × 0,57 m a 300 dpi, el DTF más grande normal, son
//    199 Mpx; algo más grande viene a más dpi o fuera de medida);
//  - si la memoria libre (MemAvailable + swap libre) no alcanza para lo que va a necesitar, tampoco;
//  - y el script corre con un tope (DTF_BLANCO_MAX_MEM_MB): si igual se pasa, falla SOLO él.
// En esos casos la orden suma una línea en la nota para que el operario haga el blanco a mano.
// Consumo medido el 22/10 (privada, PNG RGBA a 300 dpi): 2,13 GB con 40 Mpx y 3,24 GB con 80 Mpx
// → ~1 GB fijo + ~30 B/px. Se estima con 32 B/px.
const MB = 1024 * 1024;
const MAX_MPX = Number(process.env.DTF_BLANCO_MAX_MPX) || 220;
const BYTES_POR_PX = 32;
const BASE_BYTES = 1024 * MB;
const RESERVA_BYTES = 1024 * MB;      // lo que se deja libre para el resto del servidor

/** Píxeles de un PNG leyendo solo su cabecera (IHDR). null si no es un PNG legible. */
function pixelesPng(ruta) {
    let fd = null;
    try {
        fd = fs.openSync(ruta, 'r');
        const b = Buffer.alloc(24);
        fs.readSync(fd, b, 0, 24, 0);
        if (b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
        return b.readUInt32BE(16) * b.readUInt32BE(20);
    } catch (e) {
        logger.warn(`[DTF-Blanco] no se pudo leer la cabecera del PNG (${path.basename(ruta)}): ${e.message}`);
        return null;
    } finally {
        if (fd !== null) try { fs.closeSync(fd); } catch (_) { /* ya cerrado */ }
    }
}

/** Píxeles que va a procesar el script: los del PNG, o la medida del archivo a 300 dpi (PDF). */
async function pixelesDelArte(pool, archivoId, copia) {
    if (/\.png$/i.test(copia)) {
        const px = pixelesPng(copia);
        if (px) return px;
    }
    const r = await pool.request().input('AID', sql.Int, archivoId)
        .query('SELECT Ancho, Alto FROM ArchivosOrden WITH (NOLOCK) WHERE ArchivoID = @AID');
    const ancho = Number(r.recordset[0]?.Ancho), alto = Number(r.recordset[0]?.Alto);   // metros
    return (ancho > 0 && alto > 0) ? Math.round((ancho / 0.0254 * 300) * (alto / 0.0254 * 300)) : null;
}

/** Memoria que puede usar el script ahora (bytes): MemAvailable + swap libre. null fuera de Linux. */
function memoriaDisponible() {
    let t;
    try { t = fs.readFileSync('/proc/meminfo', 'utf8'); }
    catch (_) { return null; }   // sin /proc/meminfo (Windows, copia local): sin freno de memoria
    const kb = (clave) => Number((t.match(new RegExp(`^${clave}:\\s+(\\d+)`, 'm')) || [])[1] || 0) * 1024;
    const total = kb('MemAvailable') + kb('SwapFree');
    return total > 0 ? total : null;
}

const gb = (b) => (b / 1024 / MB).toFixed(1).replace('.', ',');

/** La capa automática no salió: línea en la nota de la orden para que el operario la haga a mano. */
async function avisarSinBlanco(pool, ordenId, cod, nombreArchivo, motivo) {
    const texto = `[TINTA BLANCA] Hacer la capa de blanco a mano para ${nombreArchivo || 'el archivo'}: ${motivo}.`;
    logger.warn(`[DTF-Blanco] ${cod}: ${texto}`);
    try {
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Add', sql.NVarChar(sql.MAX), ` || ${texto}`)
            .query('UPDATE Ordenes SET Nota = ISNULL(Nota, \'\') + @Add WHERE OrdenID = @OID');
    } catch (e) {
        logger.warn(`[DTF-Blanco] ${cod}: no se pudo anotar en la orden: ${e.message}`);
    }
}

// ── Cola serial ──────────────────────────────────────────────────────────────
let cola = Promise.resolve();
let pendientes = 0;

/**
 * Punto de entrada desde uploadOrderFile. COPIA el tmp de la subida (sincrónico, antes de
 * que el finally lo borre) y encola el procesamiento. Nunca lanza.
 */
function encolarSiCorresponde({ archivoId, tmpPath, nombreArchivo, codigoOrden }) {
    try {
        if (!habilitado()) return;
        if (!archivoId || !tmpPath || !fs.existsSync(tmpPath)) return;
        const ext = String(nombreArchivo || tmpPath).toLowerCase();
        if (!ext.endsWith('.pdf') && !ext.endsWith('.png')) return;

        // Copia propia del archivo, ya: el tmp de multer muere con la respuesta HTTP.
        fs.mkdirSync(WORKDIR, { recursive: true });
        const copia = path.join(WORKDIR, `${archivoId}-${Date.now()}${ext.endsWith('.png') ? '.png' : '.pdf'}`);
        fs.copyFileSync(tmpPath, copia);

        pendientes++;
        const monitor = require('./colaProcesos');   // cola de procesos pesados del monitor
        monitor.encolado('dtf-blanco');
        cola = cola
            .then(async () => {
                monitor.empezo('dtf-blanco', codigoOrden || `archivo ${archivoId}`);
                try { await procesar({ archivoId, copia, nombreArchivo, codigoOrden }); monitor.termino('dtf-blanco', true); }
                catch (e) { monitor.termino('dtf-blanco', false); throw e; }
            })
            .catch(e => logger.error(`[DTF-Blanco] ${codigoOrden || archivoId}: ${e.message}`))
            .finally(() => {
                pendientes--;
                try { fs.unlinkSync(copia); } catch (_) { }
            });
    } catch (e) {
        logger.warn('[DTF-Blanco] no se pudo encolar: ' + e.message);
    }
}

async function procesar({ archivoId, copia, nombreArchivo, codigoOrden }) {
    // 1. ¿Es un arte del área DF? (la subida no sabe el área con certeza: se mira la orden)
    const pool = await getPool();
    const q = await pool.request()
        .input('AID', sql.Int, archivoId)
        .query(`SELECT o.OrdenID, LTRIM(RTRIM(o.AreaID)) AS AreaID, o.CodigoOrden
                FROM ArchivosOrden ao JOIN Ordenes o ON o.OrdenID = ao.OrdenID
                WHERE ao.ArchivoID = @AID`);
    if (!q.recordset.length) return;
    const { OrdenID, AreaID, CodigoOrden } = q.recordset[0];
    if (String(AreaID).toUpperCase() !== 'DF') return;
    const cod = (CodigoOrden || codigoOrden || '').trim();

    // 2. Freno de memoria (ver MAX_MPX / memoriaDisponible): si no da, no se intenta.
    let px = null;
    try { px = await pixelesDelArte(pool, archivoId, copia); }
    catch (e) { logger.warn(`[DTF-Blanco] ${cod}: no se pudo medir el arte: ${e.message}`); }
    if (px && px / 1e6 > MAX_MPX) {
        return avisarSinBlanco(pool, OrdenID, cod, nombreArchivo,
            `el archivo tiene ${Math.round(px / 1e6)} megapíxeles y la capa automática llega hasta ${MAX_MPX} (más grande que un DTF de 2,5 m a 300 dpi)`);
    }
    const disponible = memoriaDisponible();
    let topeMb = null;
    if (disponible != null) {
        const necesita = px ? BASE_BYTES + px * BYTES_POR_PX : null;
        if (necesita && necesita > disponible - RESERVA_BYTES) {
            return avisarSinBlanco(pool, OrdenID, cod, nombreArchivo,
                `no había memoria libre suficiente en el servidor (necesitaba unos ${gb(necesita)} GB y había ${gb(disponible)} GB)`);
        }
        topeMb = Math.floor((disponible - RESERVA_BYTES / 2) / MB);
    }

    // 3. Generar el PDF con el spot de blanco
    const salida = copia.replace(/\.(pdf|png)$/i, '-blanco.pdf');
    const t0 = Date.now();
    const resultado = await new Promise((resolve, reject) => {
        execFile(resolverPython(), [SCRIPT, copia, salida], {
            timeout: 10 * 60 * 1000,          // artes de 100MB+ a 300dpi llevan minutos
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
            env: topeMb ? { ...process.env, DTF_BLANCO_MAX_MEM_MB: String(topeMb) } : process.env,
        }, (err, stdout, stderr) => {
            // El script imprime SIEMPRE una línea JSON, incluso al fallar (exit 1).
            const linea = String(stdout || '').trim().split('\n').pop();
            let json = null;
            try { json = JSON.parse(linea); } catch (_) { }
            if (json && json.ok) return resolve(json);
            if (json && json.error) return reject(new Error(json.error));
            // El script murió sin su línea JSON (22/10, DTF-37531: el log decía solo "Command failed: …"
            // y no por qué). En una sola línea: si lo cortaron (timeout o el sistema por memoria) y lo
            // último que dijo Python (el traceback), que antes no quedaba en el log.
            const cola = String(stderr || '').split('\n').map(l => l.trim()).filter(Boolean).slice(-3).join(' | ').slice(0, 500);
            const corte = err && err.killed ? `cortado (${err.signal || 'timeout'})`
                : (err && err.signal ? `terminado por ${err.signal}` : (err ? `salió con código ${err.code}` : ''));
            reject(new Error([corte, cola].filter(Boolean).join(' — ') || 'fallo desconocido'));
        });
    }).catch(async (e) => {
        // Falló (también si llegó al tope de memoria): que el operario sepa que hay que hacerlo a mano
        await avisarSinBlanco(pool, OrdenID, cod, nombreArchivo, `la capa automática falló (${String(e.message).slice(0, 160)})`);
        throw e;
    });
    logger.info(`[DTF-Blanco] ${cod}: plancha generada en ${((Date.now() - t0) / 1000).toFixed(1)}s (${resultado.px[0]}x${resultado.px[1]}px, scipy=${resultado.scipy})`);
    if (resultado.sinTransparencia) {
        logger.warn(`[DTF-Blanco] ${cod}: ${nombreArchivo || `archivo ${archivoId}`} no tiene transparencia: el fondo es parte del arte y se imprime el rectángulo entero.`);
    }

    try {
        // 3. Subir a Drive y registrar como REFERENCIA de la orden
        const driveService = require('./driveService');
        const nombreTB = `TB-${(nombreArchivo || `archivo-${archivoId}`).replace(/\.(pdf|png)$/i, '')}.pdf`;
        const url = await driveService.uploadToDrive(fs.createReadStream(salida), nombreTB, 'DF');

        await pool.request()
            .input('OID', sql.Int, OrdenID)
            .input('Nom', sql.VarChar(200), nombreTB.substring(0, 200))
            .input('Ruta', sql.NVarChar(sql.MAX), url)
            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage)
                    VALUES (@OID, 'TINTA BLANCA', @Nom, GETDATE(), @Ruta)`);

        logger.info(`[DTF-Blanco] ${cod}: ${nombreTB} agregado a referencias.`);
    } finally {
        try { fs.unlinkSync(salida); } catch (_) { }
    }
}

/**
 * Reposición (-R) o falla (-F) de DTF: el archivo se CLONA de la orden original (mismo arte, mismo
 * nombre, misma URL de Drive), así que su plancha de blanco es la misma que ya se generó. Se copia la
 * referencia «TINTA BLANCA» de cada archivo repuesto. Antes no se copiaba y las -R/-F de DTF quedaban
 * sin capa blanca: 27 de 27 y 12 de 12 en producción (20/10/2026).
 *
 * La plancha se busca por NOMBRE (`TB-<archivo sin extensión>.pdf`, como la nombra procesar) en la
 * orden del archivo y, si no está ahí, en las otras órdenes del mismo pedido (una -R2 copiada de la
 * -R1 encuentra la de la original). Idempotente: no duplica si la referencia ya está.
 * @param {sql.Transaction|sql.ConnectionPool} cx
 * @param {number} nuevaOrdenId  la -R / -F
 * @param {number[]} archivoIdsOrigen  ArchivoID de los archivos de origen que se clonaron
 * @returns {Promise<number>} referencias copiadas
 */
async function copiarTintaBlanca(cx, nuevaOrdenId, archivoIdsOrigen) {
    const ids = (archivoIdsOrigen || []).map(n => parseInt(n, 10)).filter(Number.isFinite);
    if (!nuevaOrdenId || !ids.length) return 0;
    const r = await new sql.Request(cx)
        .input('Nueva', sql.Int, nuevaOrdenId)
        .query(`
            INSERT INTO dbo.ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage)
            SELECT DISTINCT @Nueva, 'TINTA BLANCA', tb.NombreOriginal, GETDATE(), tb.UbicacionStorage
            FROM dbo.ArchivosOrden src
            JOIN dbo.Ordenes os ON os.OrdenID = src.OrdenID
            CROSS APPLY (
                SELECT TOP 1 ar.NombreOriginal, ar.UbicacionStorage
                FROM dbo.ArchivosReferencia ar
                JOIN dbo.Ordenes o2 ON o2.OrdenID = ar.OrdenID
                WHERE ar.TipoArchivo = 'TINTA BLANCA'
                  AND ar.NombreOriginal = LEFT('TB-' + CASE WHEN LOWER(RIGHT(src.NombreArchivo, 4)) IN ('.pdf', '.png')
                                                            THEN LEFT(src.NombreArchivo, LEN(src.NombreArchivo) - 4)
                                                            ELSE src.NombreArchivo END + '.pdf', 200)
                  AND (o2.OrdenID = os.OrdenID
                       OR (os.NoDocERP IS NOT NULL AND LTRIM(RTRIM(o2.NoDocERP)) = LTRIM(RTRIM(os.NoDocERP))))
                ORDER BY CASE WHEN o2.OrdenID = os.OrdenID THEN 0 ELSE 1 END, ar.RefID DESC
            ) tb
            WHERE src.ArchivoID IN (${ids.join(',')})
              AND UPPER(LTRIM(RTRIM(os.AreaID))) = 'DF'
              AND NOT EXISTS (SELECT 1 FROM dbo.ArchivosReferencia x
                              WHERE x.OrdenID = @Nueva AND x.TipoArchivo = 'TINTA BLANCA' AND x.NombreOriginal = tb.NombreOriginal)`);
    return r.rowsAffected[0] || 0;
}

module.exports = { encolarSiCorresponde, copiarTintaBlanca, _pendientes: () => pendientes, _freno: { pixelesPng, memoriaDisponible, MAX_MPX, BYTES_POR_PX, BASE_BYTES, RESERVA_BYTES } };
