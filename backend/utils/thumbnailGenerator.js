const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const execFileAsync = promisify(execFile);

// Carpeta donde se guardan los thumbnails en disco. Configurable por entorno (THUMBNAILS_PATH)
// para poder ubicarla fuera del dir de la app (p. ej. /home/thumbnails y que sobreviva a deploys).
// La URL pública sigue siendo /thumbnails/... (server.js la sirve desde esta misma carpeta).
const THUMBNAILS_DIR = process.env.THUMBNAILS_PATH || path.join(__dirname, '..', 'thumbnails');
// Carpeta de imágenes de fallas anotadas (recuadro dibujado en Control). Servida en /fallas.
const FALLAS_DIR = process.env.FALLAS_PATH || path.join(__dirname, '..', 'fallas');

// ¿Ya existe la miniatura en disco? Para que los reprocesos (fileProcessingService,
// backfill) no regeneren lo que ya está.
exports.thumbnailExists = (codigoOrden, archivoId) =>
    fs.existsSync(path.join(THUMBNAILS_DIR, String(codigoOrden), `${archivoId}.jpg`));

/**
 * Genera un thumbnail JPG de la primera página de un PDF.
 * Guarda en: backend/thumbnails/{codigoOrden}/{archivoId}.jpg
 *
 * @param {Buffer} buffer   - Buffer del PDF
 * @param {string} codigoOrden - Ej: "DTF-1072"
 * @param {number} archivoId   - ID del registro en ArchivosOrden
 * @returns {string|null}   - Ruta relativa "/thumbnails/{codigoOrden}/{archivoId}.jpg" o null si falla
 */
exports.generatePdfThumbnail = async (buffer, codigoOrden, archivoId) => {
    let tmpPdf = null;
    let tmpJpg = null;
    try {
        const orderDir = path.join(THUMBNAILS_DIR, String(codigoOrden));
        fs.mkdirSync(orderDir, { recursive: true });
        const outPath = path.join(orderDir, `${archivoId}.jpg`);

        // PDF temporal en la misma carpeta del thumbnail
        tmpPdf = path.join(orderDir, `${archivoId}_tmp.pdf`);
        fs.writeFileSync(tmpPdf, buffer);

        // pdftoppm (poppler-utils) rasteriza la 1ra página a JPG, escalando el lado
        // mayor a ~1500px (headroom para que el thumb final de 1000 quede nítido).
        const prefix = path.join(orderDir, `${archivoId}_tmp`);
        tmpJpg = `${prefix}.jpg`;
        await execFileAsync('pdftoppm', ['-jpeg', '-singlefile', '-f', '1', '-l', '1', '-scale-to', '1500', tmpPdf, prefix]);

        if (!fs.existsSync(tmpJpg)) throw new Error('pdftoppm no produjo salida');

        // Escalar a máx 1000x1000 SIN recortar (mantiene el aspecto completo del archivo)
        await sharp(tmpJpg)
            .resize(1000, 1000, { fit: 'inside' })
            .jpeg({ quality: 80 })
            .toFile(outPath);

        logger.info(`🖼️  [Thumbnail] PDF generado: ${outPath}`);
        return `/thumbnails/${codigoOrden}/${archivoId}.jpg`;

    } catch (err) {
        const hint = err.code === 'ENOENT'
            ? ' (falta poppler-utils → apt install -y poppler-utils)'
            : '';
        logger.warn(`⚠️  [Thumbnail] Error PDF ArchivoID=${archivoId}: ${err.message}${hint}`);
        return null;
    } finally {
        for (const f of [tmpPdf, tmpJpg]) {
            if (f && fs.existsSync(f)) { try { fs.unlinkSync(f); } catch (_) {} }
        }
    }
};

/**
 * Thumbnail para PNG/JPG usando Sharp directo — sin Puppeteer, muy rápido.
 */
exports.generateImageThumbnail = async (buffer, codigoOrden, archivoId) => {
    try {
        const orderDir = path.join(THUMBNAILS_DIR, String(codigoOrden));
        fs.mkdirSync(orderDir, { recursive: true });
        const outPath = path.join(orderDir, `${archivoId}.jpg`);

        // limitInputPixels: false → permitir PNG/JPG de gran formato (DTF/sublimación) que superan
        // el límite por defecto de Sharp (~268 MP). Igual se downscalea a 1000, así que el pico de RAM es acotado.
        await sharp(buffer, { limitInputPixels: false })
            .resize(1000, 1000, { fit: 'inside' })
            .jpeg({ quality: 75 })
            .toFile(outPath);

        logger.info(`🖼️  [Thumbnail] Imagen generada: ${outPath}`);
        return `/thumbnails/${codigoOrden}/${archivoId}.jpg`;
    } catch (err) {
        logger.warn(`⚠️  [Thumbnail] Error imagen ArchivoID=${archivoId}: ${err.message}`);
        return null;
    }
};

/**
 * Detecta el formato REAL por los primeros bytes (magic numbers), no por el nombre.
 * Devuelve 'pdf' | 'image' | null (null = formato sin miniatura posible).
 *
 * El nombre miente en los dos sentidos: las matrices TPU migradas entran como
 * "BOCETO-TP-101" (sin extensión) siendo PDFs, y los cortes de plotter ".plt" no son
 * imágenes de ninguna clase. Con el dispatcher por nombre, los primeros caían en sharp
 * ("Input buffer contains unsupported image format") y se quedaban sin miniatura, y los
 * segundos ensuciaban el log intentando algo imposible.
 */
const detectarFormato = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
    // %PDF — puede venir precedido de basura (PDFs con preámbulo), se busca en el arranque
    if (buffer.subarray(0, 1024).includes('%PDF')) return 'pdf';
    const b = buffer;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image'; // PNG
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)                   return 'image'; // JPEG
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)                   return 'image'; // GIF
    if (b[0] === 0x42 && b[1] === 0x4D)                                    return 'image'; // BMP
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A) ||
        (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00))                 return 'image'; // TIFF
    if (b.subarray(0, 4).toString('ascii') === 'RIFF' &&
        b.subarray(8, 12).toString('ascii') === 'WEBP')                    return 'image'; // WEBP
    return null;
};

/**
 * Dispatcher: elige el método según el CONTENIDO del archivo.
 * PDF → pdftoppm + Sharp · PNG/JPG/… → Sharp directo · resto → no se intenta.
 */
exports.generateThumbnail = async (buffer, codigoOrden, archivoId, mimeOrExt = '') => {
    // OJO: las -F (fallas internas) SÍ llevan miniatura. No se muestran al cliente, pero
    // planta las necesita en Control y en el modal de falla para señalar dónde está la
    // falla. (Acá hubo un descarte por código -F que dejaba a Control sin vista previa.)
    const formato = detectarFormato(buffer);
    if (formato === 'pdf')   return exports.generatePdfThumbnail(buffer, codigoOrden, archivoId);
    if (formato === 'image') return exports.generateImageThumbnail(buffer, codigoOrden, archivoId);

    // Formato sin miniatura posible (.plt de corte, vectoriales, etc.): no es un error.
    logger.info(`🖼️  [Thumbnail] ArchivoID=${archivoId} sin miniatura: formato no rasterizable (${mimeOrExt || 's/nombre'}).`);
    return null;
};

/**
 * Copia la miniatura de un archivo a otro ArchivoID, sin bajar nada ni rasterizar de nuevo.
 *
 * Para cuando una fila de ArchivosOrden se CLONA apuntando al MISMO archivo de Drive: la
 * reposición al cliente (-R#) y el reuso de matriz TPU. Sin esto, el ArchivoID nuevo nunca
 * tiene miniatura (nadie sube nada, así que no se dispara la generación) y la orden queda
 * con el ícono genérico en Control y sin vista previa en el modal de falla.
 *
 * Best-effort: si el origen no existe (nunca tuvo miniatura), no hace nada y no rompe el flujo.
 * @returns {boolean} true si copió
 */
exports.copyThumbnail = (codigoOrigen, archivoIdOrigen, codigoDestino, archivoIdDestino) => {
    try {
        const src = path.join(THUMBNAILS_DIR, String(codigoOrigen), `${archivoIdOrigen}.jpg`);
        if (!fs.existsSync(src)) return false;
        const destDir = path.join(THUMBNAILS_DIR, String(codigoDestino));
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, path.join(destDir, `${archivoIdDestino}.jpg`));
        return true;
    } catch (err) {
        logger.warn(`⚠️  [Thumbnail] No se pudo copiar ${codigoOrigen}/${archivoIdOrigen} → ${codigoDestino}/${archivoIdDestino}: ${err.message}`);
        return false;
    }
};

/**
 * Retorna la URL del thumbnail si el archivo ya existe en disco.
 */
exports.getThumbnailUrl = (codigoOrden, archivoId) => {
    const filePath = path.join(THUMBNAILS_DIR, String(codigoOrden), `${archivoId}.jpg`);
    return fs.existsSync(filePath)
        ? `/thumbnails/${codigoOrden}/${archivoId}.jpg`
        : null;
};

/**
 * Guarda una imagen de falla ANOTADA (data URL base64, con el recuadro dibujado)
 * en {FALLAS_DIR}/{codigoOrden}/{archivoId}_{ts}.jpg.
 * @returns {Promise<string|null>} Ruta pública "/fallas/{codigoOrden}/{archivo}.jpg" o null si falla.
 */
exports.saveFallaImage = async (dataUrl, codigoOrden, archivoId) => {
    try {
        if (!dataUrl || typeof dataUrl !== 'string') return null;
        const m = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
        if (!m) return null;
        const buffer = Buffer.from(m[1], 'base64');
        const orderDir = path.join(FALLAS_DIR, String(codigoOrden));
        fs.mkdirSync(orderDir, { recursive: true });
        const fileName = `${archivoId}_${Date.now()}.jpg`;
        const outPath = path.join(orderDir, fileName);
        // Normalizar a JPG (por si viene PNG); conserva el recuadro dibujado.
        await sharp(buffer).jpeg({ quality: 85 }).toFile(outPath);
        logger.info(`🖼️  [FallaImg] Guardada: ${outPath}`);
        return `/fallas/${codigoOrden}/${fileName}`;
    } catch (err) {
        logger.warn(`⚠️  [FallaImg] Error ArchivoID=${archivoId}: ${err.message}`);
        return null;
    }
};
