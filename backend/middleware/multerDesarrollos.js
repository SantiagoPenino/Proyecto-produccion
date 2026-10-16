// ─────────────────────────────────────────────────────────────────────────────
// Adjuntos de Desarrollos (fotos, PDF, planillas, documentos, moldes). Mismo esquema que
// multerServicioTecnico: multer guarda en _temp y el controller mueve cada archivo a
// <base>/<entidad>/<id>/. El nombre en disco lo arma el servidor.
//
// Carpeta: DES_ADJUNTOS_PATH (en prod conviene fuera de la carpeta del sistema) o, por defecto,
// backend/desarrollos-adjuntos. En el prototipo la ficha del proyecto aceptaba "fotos, PDF,
// planillas o texto" y los pedidos "fotos o PDF"; acá se acepta lo mismo más moldes (DXF, AI, ZIP).
// ─────────────────────────────────────────────────────────────────────────────
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { webpEnSubida } = require('../utils/imagenWebp');

const BASE_PATH = path.resolve(process.env.DES_ADJUNTOS_PATH || path.join(__dirname, '..', 'desarrollos-adjuntos'));
const TEMP_PATH = path.join(BASE_PATH, '_temp');

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVOS = 8;

const MIME_OK = /^(image\/|video\/(mp4|quicktime|webm|3gpp)$|application\/pdf$|text\/(plain|csv)$|application\/(msword|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.|vnd\.oasis\.opendocument\.|zip$|x-zip-compressed$|postscript$|illustrator$))/i;
// Los moldes y archivos de diseño suelen llegar como application/octet-stream: se aceptan por extensión.
const EXT_OK = new Set(['.dxf', '.ai', '.eps', '.cdr', '.svg', '.zip', '.plt', '.csv', '.txt', '.xlsx', '.xls', '.docx', '.doc', '.ods', '.odt']);

const extDe = (file) => path.extname(nombreOriginal(file)).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.mkdirSync(TEMP_PATH, { recursive: true });
        cb(null, TEMP_PATH);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${extDe(file)}`),
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_BYTES, files: MAX_ARCHIVOS },
    fileFilter: (req, file, cb) => {
        if (MIME_OK.test(String(file.mimetype || '')) || EXT_OK.has(extDe(file))) return cb(null, true);
        cb(Object.assign(new Error(`Ese tipo de archivo no se puede subir: ${nombreOriginal(file)}. Se aceptan fotos, PDF, planillas, documentos y moldes.`),
            { code: 'DES_TIPO_NO_PERMITIDO' }));
    },
});

// Responde 400 con un mensaje claro en vez de tirar el error de multer. Las fotos pasan a WebP
// (como en Servicio Técnico); el resto queda igual.
const subirAdjuntos = (req, res, next) => {
    upload.array('adjuntos', MAX_ARCHIVOS)(req, res, (err) => {
        if (!err) return webpEnSubida(req, res, next);
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `Un archivo supera los ${MAX_BYTES / 1024 / 1024} MB.`
            : err.code === 'LIMIT_FILE_COUNT' ? `Máximo ${MAX_ARCHIVOS} archivos por vez.`
            : err.code === 'DES_TIPO_NO_PERMITIDO' ? err.message
            : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Los archivos tienen que ir en el campo "adjuntos".'
            : (err.message || 'No se pudieron subir los archivos.');
        res.status(400).json({ success: false, error: msg });
    });
};

// multer (busboy) entrega el nombre original en latin1: acentos y ñ llegan rotos.
function nombreOriginal(file) {
    try { return Buffer.from(file.originalname || '', 'latin1').toString('utf8').slice(0, 260); }
    catch (_) { return String(file.originalname || '').slice(0, 260); }
}

// Carpeta final de una entidad (proyecto 12 → <base>/proyecto/12). Solo ids numéricos.
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
