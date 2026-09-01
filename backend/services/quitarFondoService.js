/**
 * quitarFondoService — puente al script python/quitar_fondo.py (rembg / U2-Net).
 *
 * Lo usa el conversor de imágenes del catálogo (uploadArticleImage) cuando marketing
 * tilda "Quitar fondo" al subir una foto: se remueve el fondo y el conversor compone
 * el producto sobre BLANCO PURO — catálogo 100% parejo sin importar cómo vino la foto.
 *
 * · Cola serial: rembg carga una red neuronal (~1GB de RAM en CPU); nunca dos a la vez.
 * · Mismo binario de Python que dtf_blanco (PYTHON_DTF_BIN / venv del server / python3).
 * · Instalación en el server (una vez): pip install rembg onnxruntime
 */
const { execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const SCRIPT = path.join(__dirname, '..', 'python', 'quitar_fondo.py');
const TIMEOUT_MS = 120000; // primera corrida descarga el modelo: darle aire

let pythonBin = null;
function resolverPython() {
    if (pythonBin) return pythonBin;
    const candidatos = [
        process.env.PYTHON_DTF_BIN,
        '/opt/suite_user/venv/bin/python',
        'python3',
        'python',
        'py',
    ].filter(Boolean);
    for (const c of candidatos) {
        try {
            if ((c.includes('/') || c.includes('\\')) && !fs.existsSync(c)) continue;
            // Verificación REAL: en Windows 'python3' suele ser el alias muerto de la
            // Microsoft Store — aceptarlo sin probarlo dejaba el servicio roto en silencio.
            execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 5000 });
            pythonBin = c;
            return c;
        } catch (_) { /* siguiente */ }
    }
    pythonBin = 'python3';
    return pythonBin;
}

let cola = Promise.resolve();

/**
 * Quita el fondo de inPath y escribe un PNG con alfa en outPath.
 * Serializado (de a uno). Rechaza si el script falla — el caller decide el fallback.
 */
function quitarFondo(inPath, outPath) {
    const tarea = () => new Promise((resolve, reject) => {
        execFile(resolverPython(), [SCRIPT, inPath, outPath], { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(`quitar_fondo: ${String(stderr || err.message).trim().substring(0, 300)}`));
            }
            if (!fs.existsSync(outPath)) {
                return reject(new Error('quitar_fondo: el script no generó la salida'));
            }
            resolve(outPath);
        });
    });
    const resultado = cola.then(tarea, tarea);
    // La cola nunca queda rota: el próximo corre aunque este falle.
    cola = resultado.catch(() => {});
    return resultado;
}

module.exports = { quitarFondo };
