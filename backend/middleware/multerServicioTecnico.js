// ─────────────────────────────────────────────────────────────────────────────
// Adjuntos de Servicio Técnico (fotos, capturas, PDF, videos cortos).
//
// Carpeta: ST_ADJUNTOS_PATH (en prod conviene una ruta fuera de la carpeta del sistema, como las
// de tickets o fallas) o, por defecto, backend/servicio-tecnico. Multer guarda primero en _temp
// y el controller mueve cada archivo a <base>/<entidad>/<id>/ cuando la solicitud ya existe.
// El nombre en disco lo arma el servidor (nunca el del usuario), así que no hay rutas raras.
// ─────────────────────────────────────────────────────────────────────────────
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const BASE_PATH = path.resolve(process.env.ST_ADJUNTOS_PATH || path.join(__dirname, '..', 'servicio-tecnico'));
const TEMP_PATH = path.join(BASE_PATH, '_temp');

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB por archivo (videos cortos del celular)
const MAX_ARCHIVOS = 8;

const MIME_OK = /^(image\/|video\/(mp4|quicktime|webm|3gpp)$|application\/pdf$)/i;

const EXT_POR_MIME = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'image/heic': '.heic', 'image/heif': '.heif', 'application/pdf': '.pdf',
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp',
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.mkdirSync(TEMP_PATH, { recursive: true });
        cb(null, TEMP_PATH);
    },
    filename: (req, file, cb) => {
        const ext = EXT_POR_MIME[String(file.mimetype).toLowerCase()]
            || (path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6));
        cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_BYTES, files: MAX_ARCHIVOS },
    fileFilter: (req, file, cb) => {
        if (MIME_OK.test(String(file.mimetype || ''))) return cb(null, true);
        cb(Object.assign(new Error(`Tipo de archivo no permitido: ${nombreOriginal(file)}. Se aceptan fotos, PDF y videos cortos.`),
            { code: 'ST_TIPO_NO_PERMITIDO' }));
    },
});

// Middleware que responde 400 con un mensaje claro en vez de tirar el error de multer.
const subirAdjuntos = (req, res, next) => {
    upload.array('adjuntos', MAX_ARCHIVOS)(req, res, (err) => {
        if (!err) return next();
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `Un archivo supera los ${MAX_BYTES / 1024 / 1024} MB.`
            : err.code === 'LIMIT_FILE_COUNT' ? `Máximo ${MAX_ARCHIVOS} archivos por vez.`
            : err.code === 'ST_TIPO_NO_PERMITIDO' ? err.message
            : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Los archivos tienen que ir en el campo "adjuntos".'
            : (err.message || 'No se pudieron subir los archivos.');
        res.status(400).json({ success: false, error: msg });
    });
};

// multer (busboy) entrega el nombre original en latin1: acentos y ñ llegan rotos.
function nombreOriginal(file) {
    try { return Buffer.from(file.originalname || '', 'latin1').toString('utf8').slice(0, 260); }
    catch (_) { return String(file.originalname || '').slice(0, 260); }
};

// Carpeta final de una entidad (solicitud 12 → <base>/solicitud/12). Solo ids numéricos.
const carpetaEntidad = (entidad, id) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new Error('Id inválido para la carpeta de adjuntos.');
    return path.join(BASE_PATH, String(entidad).toLowerCase().replace(/[^a-z_]/g, ''), String(n));
};

// Ruta absoluta de un adjunto guardado, verificando que quede dentro de la carpeta base.
const rutaAdjunto = (entidad, id, archivo) => {
    const abs = path.resolve(carpetaEntidad(entidad, id), path.basename(String(archivo || '')));
    if (!abs.startsWith(BASE_PATH + path.sep)) throw new Error('Ruta de adjunto inválida.');
    return abs;
};

// Borra los temporales de una subida que no llegó a guardarse.
const limpiarTemporales = (files) => {
    for (const f of files || []) {
        try { if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) { /* nada */ }
    }
};

module.exports = { subirAdjuntos, nombreOriginal, carpetaEntidad, rutaAdjunto, limpiarTemporales, BASE_PATH };
