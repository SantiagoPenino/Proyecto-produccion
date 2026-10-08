// =====================================================================
// imagenWebp — fotos subidas → WebP calidad 80, lado mayor ≤ 1080 px
// =====================================================================
// Criterio (07/10/2026, docs/subidas-webp-y-carpetas.md §2): se convierten las
// FOTOS que solo se miran en pantalla (fallas, consultas, servicio técnico,
// tickets, comprobantes de pago, fichas de diseño, imágenes del CMS). NUNCA los
// archivos de impresión de los clientes, ni PDF ni videos: esos pasan tal cual.
//
// Reglas:
//   - Mantiene la proporción: entra en un cuadro de 1080×1080 y nunca agranda.
//   - Respeta la orientación del celular (EXIF) antes de achicar.
//   - GIF animado sigue animado (WebP animado).
//   - Si sharp no puede leerla (p. ej. HEIC de iPhone, que el binario de sharp no
//     decodifica) se guarda el ORIGINAL: nunca se pierde una subida por esto.
// =====================================================================
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CALIDAD = 80;
const LADO_MAX = 1080;

// Lo que sharp puede leer. Lo demás (PDF, video, Office…) no se toca.
const MIME_CONVERTIBLE = /^image\/(jpe?g|pjpeg|png|webp|gif|bmp|tiff|avif|heic|heif)$/i;

const esConvertible = (mimetype) => MIME_CONVERTIBLE.test(String(mimetype || ''));

/**
 * Convierte una imagen (Buffer) a WebP. Devuelve null si ya es un WebP que no
 * hace falta achicar (recomprimirlo solo perdería calidad).
 */
async function bufferAWebp(buffer, mimetype = '') {
    const esGif = /gif/i.test(mimetype);
    const opts = { failOn: 'none', ...(esGif ? { animated: true } : {}) };

    if (/webp/i.test(mimetype)) {
        const meta = await sharp(buffer, opts).metadata();
        const alto = meta.pageHeight || meta.height;
        if (meta.width <= LADO_MAX && alto <= LADO_MAX) return null;
    }

    let img = sharp(buffer, opts);
    if (!esGif) img = img.rotate(); // orientación EXIF del celular
    return img
        .resize({ width: LADO_MAX, height: LADO_MAX, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: CALIDAD })
        .toBuffer();
}

const conExtWebp = (nombre) => {
    const s = String(nombre || '');
    return /\.[^./\\]+$/.test(s) ? s.replace(/\.[^./\\]+$/, '.webp') : `${s}.webp`;
};

/**
 * Convierte en el lugar un archivo que multer (diskStorage) ya dejó en disco y
 * actualiza el objeto `file` (path, filename, mimetype, size, originalname) para
 * que el resto del flujo (mover de carpeta, guardar en la base) siga igual.
 * Nunca lanza: si falla, deja el original y lo avisa en el log.
 */
async function convertirArchivoSubido(file) {
    if (!file?.path || !esConvertible(file.mimetype)) return file;
    try {
        // Se lee a memoria primero: en Windows sharp puede retener el archivo y el unlink fallaría.
        const original = await fs.promises.readFile(file.path);
        const webp = await bufferAWebp(original, file.mimetype);
        if (!webp) return file;

        const nuevoNombre = conExtWebp(file.filename || path.basename(file.path));
        const nuevoPath = path.join(path.dirname(file.path), nuevoNombre);
        await fs.promises.writeFile(nuevoPath, webp);
        if (path.resolve(nuevoPath) !== path.resolve(file.path)) {
            await fs.promises.unlink(file.path).catch(() => {});
        }

        logger.info(`[WEBP] ${file.filename}: ${Math.round(original.length / 1024)} KB → ${Math.round(webp.length / 1024)} KB`);
        Object.assign(file, {
            path: nuevoPath,
            filename: nuevoNombre,
            mimetype: 'image/webp',
            size: webp.length,
            originalname: conExtWebp(file.originalname),
        });
    } catch (err) {
        logger.warn(`[WEBP] No se pudo convertir ${file.filename || file.path} (${file.mimetype}): ${err.message} — se guarda el original.`);
    }
    return file;
}

/**
 * Middleware para poner DESPUÉS de multer (diskStorage). Convierte las imágenes
 * de req.file / req.files y deja pasar todo lo demás. Nunca corta la subida.
 */
async function webpEnSubida(req, res, next) {
    const files = req.file ? [req.file]
        : Array.isArray(req.files) ? req.files
        : req.files && typeof req.files === 'object' ? Object.values(req.files).flat()
        : [];
    for (const f of files) await convertirArchivoSubido(f);
    next();
}

module.exports = { bufferAWebp, convertirArchivoSubido, webpEnSubida, esConvertible, CALIDAD, LADO_MAX };
