const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');
const { entornoConTope, describirFallo } = require('./topeMemoriaPython');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, '..', 'scripts', 'preflight', 'user_preflight.py');
const PYTHON = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

// Área del sistema → servicio de reglas del preflight (reglas_user.json).
// Las áreas sin reglas definidas (corte, bordado, costura, etc.) no se analizan.
const SERVICIO_POR_AREA = {
    DF: 'dtf', DTF: 'dtf',
    SB: 'sublimacion', SUB: 'sublimacion',
    GF: 'gran_formato', ECO: 'gran_formato', UV: 'gran_formato', ECOUV: 'gran_formato',
};

function servicioPorArea(area) {
    return SERVICIO_POR_AREA[String(area || '').toUpperCase()] || null;
}

// "Dry Liso (1,83)" → 183 cm. Mismo criterio que resolveMaterialWidth del portal:
// número entre paréntesis; si es chico se asume metros, si no centímetros.
function anchoCmDesdeMaterial(material) {
    const m = String(material || '').match(/\((\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    const val = parseFloat(m[1].replace(',', '.'));
    if (!isFinite(val) || val <= 0) return null;
    return val <= 10 ? Math.round(val * 100) : Math.round(val);
}

/**
 * Corre el motor de preflight (Python: PyMuPDF/pikepdf/Pillow) sobre un buffer.
 * Deps en el server: pip install pymupdf pikepdf pillow
 *
 * @returns {Promise<{veredicto, reporte, mensajeCliente}|null>} null si falla (fail-open:
 *          el preflight es informativo, nunca debe bloquear una subida).
 */
async function runPreflight(buffer, filename, { servicio, anchoTelaCm = null, prensa = null } = {}) {
    if (!servicio || !buffer) return null;
    const ext = path.extname(filename || '').toLowerCase() || '.pdf';
    const tmp = path.join(os.tmpdir(), `preflight_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    // Tope de memoria (23/10/2026, ./topeMemoriaPython): si lo pasa, falla solo el script (sin JSON)
    const env = entornoConTope();
    try {
        fs.writeFileSync(tmp, buffer);
        const args = [SCRIPT, tmp, '--servicio', servicio, '--json'];
        if (anchoTelaCm) {
            args.push(servicio === 'gran_formato' ? '--ancho-material' : '--ancho-tela', String(anchoTelaCm));
        }
        if (prensa) args.push('--prensa', prensa);

        // exit code 1 = RECHAZADO (el script igual imprime el JSON completo por stdout)
        const { stdout } = await execFileAsync(PYTHON, args, {
            timeout: 60000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
            env,
        }).catch(err => {
            if (err && err.stdout) return { stdout: err.stdout };
            throw err;
        });

        const out = JSON.parse(stdout);
        return {
            veredicto: out.reporte?.veredicto || null,
            reporte: out.reporte || null,
            mensajeCliente: out.mensaje_cliente || '',
        };
    } catch (err) {
        // El script falló sin JSON (memoria, timeout, traceback): en una línea. Si no, el error tal cual.
        const motivo = err && (err.code !== undefined || err.signal) ? describirFallo(err, err.stderr, env) : err.message;
        logger.warn(`[Preflight] Error analizando ${filename}: ${motivo}`);
        return null;
    } finally {
        try { fs.unlinkSync(tmp); } catch (_) { }
    }
}

module.exports = { runPreflight, servicioPorArea, anchoCmDesdeMaterial };
