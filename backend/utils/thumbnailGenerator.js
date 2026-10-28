const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { bufferAWebp } = require('./imagenWebp');

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

// Tamaño máximo de archivo que se rasteriza (INF-SIS-2026-08). Arriba de esto no se baja ni se lee:
// el cron usa la miniatura de Drive o deja la marca. Configurable sin deploy con THUMB_MAX_MB.
exports.LIMITE_BYTES = (parseInt(process.env.THUMB_MAX_MB, 10) || 1024) * 1024 * 1024;

// pdftoppm sin límite podía quedarse rasterizando un PDF gigante indefinidamente.
const PDFTOPPM_TIMEOUT_MS = 2 * 60 * 1000;

// Marca «sin miniatura»: un archivo que no la pudo dar no se vuelve a intentar en cada corrida del cron
// (antes el banner de 2,7 GB de EUV-38376 se bajaba entero cada 10 minutos, 27/10). Es un texto al lado
// de donde iría el .jpg, con la fecha y el motivo. El cron la ignora con --force o --noDocERP.
const rutaMarca = (codigoOrden, archivoId) => path.join(THUMBNAILS_DIR, String(codigoOrden), `${archivoId}.sin-miniatura`);
exports.tieneMarcaSinMiniatura = (codigoOrden, archivoId) => fs.existsSync(rutaMarca(codigoOrden, archivoId));
exports.marcarSinMiniatura = (codigoOrden, archivoId, motivo) => {
    try {
        fs.mkdirSync(path.join(THUMBNAILS_DIR, String(codigoOrden)), { recursive: true });
        fs.writeFileSync(rutaMarca(codigoOrden, archivoId), `${new Date().toISOString()}\t${motivo}\n`);
    } catch (err) {
        logger.warn(`⚠️  [Thumbnail] No se pudo dejar la marca sin miniatura de ${codigoOrden}/${archivoId}: ${err.message}`);
    }
};
// Si después sí se generó (con --force), la marca sobra.
const borrarMarca = (codigoOrden, archivoId) => {
    const m = rutaMarca(codigoOrden, archivoId);
    if (fs.existsSync(m)) { try { fs.unlinkSync(m); } catch (_) { /* queda; el .jpg igual manda */ } }
};

// Rasteriza la 1ra página de un PDF en disco a {orderDir}/{archivoId}.jpg. pdftoppm (poppler-utils) lee el
// archivo por ruta, sin cargarlo en memoria, y escala el lado mayor a ~1500px (headroom para que el
// thumb final de 1000 quede nítido). Lanza el error si falla.
async function rasterizarPdf(pdfPath, orderDir, archivoId, outPath) {
    const prefix = path.join(orderDir, `${archivoId}_tmp`);
    const tmpJpg = `${prefix}.jpg`;
    try {
        await execFileAsync('pdftoppm', ['-jpeg', '-singlefile', '-f', '1', '-l', '1', '-scale-to', '1500', pdfPath, prefix],
            { timeout: PDFTOPPM_TIMEOUT_MS, killSignal: 'SIGKILL' });
        if (!fs.existsSync(tmpJpg)) throw new Error('pdftoppm no produjo salida');
        // Escalar a máx 1000x1000 SIN recortar (mantiene el aspecto completo del archivo)
        await sharp(tmpJpg)
            .resize(1000, 1000, { fit: 'inside' })
            .jpeg({ quality: 80 })
            .toFile(outPath);
    } catch (err) {
        if (err.killed) throw new Error(`pdftoppm tardó más de ${PDFTOPPM_TIMEOUT_MS / 60000} minutos y se cortó`);
        throw err;
    } finally {
        if (fs.existsSync(tmpJpg)) { try { fs.unlinkSync(tmpJpg); } catch (_) { /* se pisa en la próxima */ } }
    }
}

const pistaPoppler = (err) => (err.code === 'ENOENT' ? ' (falta poppler-utils → apt install -y poppler-utils)' : '');

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
    try {
        const orderDir = path.join(THUMBNAILS_DIR, String(codigoOrden));
        fs.mkdirSync(orderDir, { recursive: true });
        const outPath = path.join(orderDir, `${archivoId}.jpg`);

        // PDF temporal en la misma carpeta del thumbnail
        tmpPdf = path.join(orderDir, `${archivoId}_tmp.pdf`);
        fs.writeFileSync(tmpPdf, buffer);
        await rasterizarPdf(tmpPdf, orderDir, archivoId, outPath);

        borrarMarca(codigoOrden, archivoId);
        logger.info(`🖼️  [Thumbnail] PDF generado: ${outPath}`);
        return `/thumbnails/${codigoOrden}/${archivoId}.jpg`;

    } catch (err) {
        logger.warn(`⚠️  [Thumbnail] Error PDF ArchivoID=${archivoId}: ${err.message}${pistaPoppler(err)}`);
        return null;
    } finally {
        if (tmpPdf && fs.existsSync(tmpPdf)) { try { fs.unlinkSync(tmpPdf); } catch (_) {} }
    }
};

/**
 * Thumbnail para PNG/JPG usando Sharp directo — sin Puppeteer, muy rápido.
 * Acepta un Buffer o la ruta del archivo (sharp lo lee de disco).
 */
exports.generateImageThumbnail = async (bufferOrPath, codigoOrden, archivoId) => {
    try {
        const orderDir = path.join(THUMBNAILS_DIR, String(codigoOrden));
        fs.mkdirSync(orderDir, { recursive: true });
        const outPath = path.join(orderDir, `${archivoId}.jpg`);

        // limitInputPixels: false → permitir PNG/JPG de gran formato (DTF/sublimación) que superan
        // el límite por defecto de Sharp (~268 MP). Igual se downscalea a 1000, así que el pico de RAM es acotado.
        await sharp(bufferOrPath, { limitInputPixels: false })
            .resize(1000, 1000, { fit: 'inside' })
            .jpeg({ quality: 75 })
            .toFile(outPath);

        borrarMarca(codigoOrden, archivoId);
        logger.info(`🖼️  [Thumbnail] Imagen generada: ${outPath}`);
        return `/thumbnails/${codigoOrden}/${archivoId}.jpg`;
    } catch (err) {
        logger.warn(`⚠️  [Thumbnail] Error imagen ArchivoID=${archivoId}: ${err.message}`);
        return null;
    }
};

/**
 * Miniatura desde un archivo EN DISCO, sin cargarlo en memoria (INF-SIS-2026-08). Para el cron, que baja
 * a un temporal, y la subida, que ya tiene la copia de trabajo. Lee solo los primeros bytes para saber
 * el formato. Devuelve { url, motivo }: url si salió; si no, motivo dice por qué (para la marca).
 */
exports.generateThumbnailFromPath = async (filePath, codigoOrden, archivoId, nombre = '') => {
    let cabecera;
    try {
        const fh = await fs.promises.open(filePath, 'r');
        try {
            const { buffer, bytesRead } = await fh.read(Buffer.alloc(1024), 0, 1024, 0);
            cabecera = buffer.subarray(0, bytesRead);
        } finally { await fh.close(); }
    } catch (err) {
        logger.warn(`⚠️  [Thumbnail] ArchivoID=${archivoId}: no se pudo leer ${filePath}: ${err.message}`);
        return { url: null, motivo: `no se pudo leer el archivo: ${err.message}` };
    }

    const formato = detectarFormato(cabecera);
    if (formato === 'image') {
        const url = await exports.generateImageThumbnail(filePath, codigoOrden, archivoId);
        return url ? { url, motivo: null } : { url: null, motivo: 'la imagen no se pudo leer (ver el log)' };
    }
    if (formato !== 'pdf') {
        logger.info(`🖼️  [Thumbnail] ArchivoID=${archivoId} sin miniatura: formato no rasterizable (${nombre || 's/nombre'}).`);
        return { url: null, motivo: `formato no rasterizable (${nombre || 's/nombre'})` };
    }
    try {
        const orderDir = path.join(THUMBNAILS_DIR, String(codigoOrden));
        fs.mkdirSync(orderDir, { recursive: true });
        const outPath = path.join(orderDir, `${archivoId}.jpg`);
        await rasterizarPdf(filePath, orderDir, archivoId, outPath);
        borrarMarca(codigoOrden, archivoId);
        logger.info(`🖼️  [Thumbnail] PDF generado: ${outPath}`);
        return { url: `/thumbnails/${codigoOrden}/${archivoId}.jpg`, motivo: null };
    } catch (err) {
        logger.warn(`⚠️  [Thumbnail] Error PDF ArchivoID=${archivoId}: ${err.message}${pistaPoppler(err)}`);
        // Sin pdftoppm instalado es un problema del servidor, no del archivo: no se marca (si no, quedarían
        // marcados para siempre todos los PDF), se reintenta en la corrida siguiente.
        return { url: null, motivo: `el PDF no se pudo rasterizar: ${err.message}${pistaPoppler(err)}`, reintentar: err.code === 'ENOENT' };
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
 * en {FALLAS_DIR}/{codigoOrden}/{archivoId}_{ts}.webp (hasta el 07/10/2026 era .jpg:
 * las viejas siguen andando porque la URL completa queda en FallasProduccion.ImagenFalla).
 * @returns {Promise<string|null>} Ruta pública "/fallas/{codigoOrden}/{archivo}.webp" o null si falla.
 */
exports.saveFallaImage = async (dataUrl, codigoOrden, archivoId) => {
    try {
        if (!dataUrl || typeof dataUrl !== 'string') return null;
        const m = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
        if (!m) return null;
        const buffer = Buffer.from(m[1], 'base64');
        const orderDir = path.join(FALLAS_DIR, String(codigoOrden));
        fs.mkdirSync(orderDir, { recursive: true });
        const fileName = `${archivoId}_${Date.now()}.webp`;
        const outPath = path.join(orderDir, fileName);
        // WebP 80, lado mayor ≤ 1080 (criterio común de fotos, utils/imagenWebp.js); conserva el recuadro dibujado.
        const webp = await bufferAWebp(buffer, 'image/png');
        await fs.promises.writeFile(outPath, webp);
        logger.info(`🖼️  [FallaImg] Guardada: ${outPath}`);
        return `/fallas/${codigoOrden}/${fileName}`;
    } catch (err) {
        logger.warn(`⚠️  [FallaImg] Error ArchivoID=${archivoId}: ${err.message}`);
        return null;
    }
};
