// =====================================================================
// FOTOS DE LAS CONSULTAS AL CLIENTE
// =====================================================================
// Mismo patrón que los adjuntos de tickets (multerTicketsConfig): carpeta por
// entidad, subida a `temp` y mudanza cuando ya existe el id. Es una copia
// deliberada, no un reuso: la consulta NO es un ticket (no hay hilo) y no tiene
// por qué compartirle la carpeta ni la tabla. Ver docs/consultas-cliente-plan.md §1.
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const BASE_PATH = process.env.CONSULTAS_FOTOS_PATH || path.join(__dirname, '../consultas');

const MAX_FOTOS = 5;                       // regla del CEREBRO §3
const MAX_BYTES = 5 * 1024 * 1024;         // 5 MB por foto (las del celular pesan)

/** Carpeta de una consulta (o `temp` si todavía no tiene id). La crea si no existe. */
const getConsultaFolder = (consultaId) => {
    const folder = consultaId
        ? path.join(BASE_PATH, String(consultaId))
        : path.join(BASE_PATH, 'temp');
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    return folder;
};

/** Mueve lo subido a `temp` hacia la carpeta definitiva, ya con el id de la consulta. */
const moverFotosAConsulta = (files, consultaId) => {
    if (!files || files.length === 0) return [];
    const destFolder = getConsultaFolder(consultaId);
    const movidos = [];
    for (const file of files) {
        const destino = path.join(destFolder, file.filename);
        try {
            fs.renameSync(file.path, destino);
            movidos.push({ ...file, path: destino });
        } catch (err) {
            // Una foto que no se pudo mover no puede tumbar la consulta: se pierde
            // la imagen, no la pregunta. Queda el warn para poder rastrearlo.
            require('../utils/logger').warn(`[CONSULTAS] No se pudo mover la foto ${file.filename}: ${err.message}`);
        }
    }
    return movidos;
};

/** Borra la carpeta de una consulta (se usa si la creación falla después de subir). */
const limpiarFotos = (files) => {
    for (const f of files || []) {
        try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) {}
    }
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, getConsultaFolder(null)),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const uploadConsultas = multer({
    storage,
    limits: { fileSize: MAX_BYTES, files: MAX_FOTOS },
    // Solo imágenes: una consulta se responde mirando una foto, no abriendo un PDF.
    fileFilter: (req, file, cb) => {
        if (/^image\/(jpe?g|png|webp)$/i.test(file.mimetype)) return cb(null, true);
        cb(new Error('Solo se pueden adjuntar imágenes (JPG, PNG o WEBP).'));
    },
});

module.exports = { uploadConsultas, getConsultaFolder, moverFotosAConsulta, limpiarFotos, MAX_FOTOS };
