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
 *    (/opt/suite_user/venv/bin/python) y se cae a python3/python.
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
let pythonBin = null;
function resolverPython() {
    if (pythonBin) return pythonBin;
    const candidatos = [
        process.env.PYTHON_DTF_BIN,
        '/opt/suite_user/venv/bin/python',
        'python3',
        'python',
    ].filter(Boolean);
    for (const c of candidatos) {
        try {
            if (c.includes('/') || c.includes('\\')) {
                if (!fs.existsSync(c)) continue;
            }
            pythonBin = c;
            return c;
        } catch (_) { /* siguiente */ }
    }
    pythonBin = 'python3';
    return pythonBin;
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
        cola = cola
            .then(() => procesar({ archivoId, copia, nombreArchivo, codigoOrden }))
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

    // 2. Generar el PDF con el spot de blanco
    const salida = copia.replace(/\.(pdf|png)$/i, '-blanco.pdf');
    const t0 = Date.now();
    const resultado = await new Promise((resolve, reject) => {
        execFile(resolverPython(), [SCRIPT, copia, salida], {
            timeout: 10 * 60 * 1000,          // artes de 100MB+ a 300dpi llevan minutos
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
        }, (err, stdout, stderr) => {
            // El script imprime SIEMPRE una línea JSON, incluso al fallar (exit 1).
            const linea = String(stdout || '').trim().split('\n').pop();
            let json = null;
            try { json = JSON.parse(linea); } catch (_) { }
            if (json && json.ok) return resolve(json);
            reject(new Error((json && json.error) || (err && err.message) || String(stderr).slice(0, 300) || 'fallo desconocido'));
        });
    });
    logger.info(`[DTF-Blanco] ${cod}: plancha generada en ${((Date.now() - t0) / 1000).toFixed(1)}s (${resultado.px[0]}x${resultado.px[1]}px, scipy=${resultado.scipy})`);

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

module.exports = { encolarSiCorresponde, _pendientes: () => pendientes };
