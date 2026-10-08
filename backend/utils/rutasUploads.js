// =====================================================================
// rutasUploads — dónde vive en disco la carpeta /uploads
// =====================================================================
// UPLOADS_PATH (07/10/2026): en producción va fuera del deploy (/home/uploads),
// igual que THUMBNAILS_PATH, FALLAS_PATH, TICKETS_SOPORTE_PATH, etc. Si no está
// definida queda donde estuvo siempre: backend/uploads.
//
// Solo cambia la ruta en DISCO. Las URLs públicas siguen siendo /uploads/...
// (server.js monta /uploads sobre esta misma carpeta), así que lo guardado en la
// base (Articulos_Imagenes.url_imagen, ProductoFichaDiseno.DibujoUrl, …) no se toca.
//
// Subcarpetas: tmp (subidas que van a Drive), articulos, fichas-diseno,
// config_images (CMS), tpu-matriz, moldes-tizadapro.
// =====================================================================
const path = require('path');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_PATH || path.join(__dirname, '..', 'uploads'));

/** Ruta en disco de una subcarpeta/archivo dentro de uploads. */
const rutaUploads = (...partes) => path.join(UPLOADS_DIR, ...partes);

/**
 * URL pública "/uploads/…" → ruta en disco. null si no es de /uploads o si
 * intenta salirse de la carpeta (../).
 */
const urlUploadsADisco = (url) => {
    const s = String(url || '');
    if (!s.startsWith('/uploads/')) return null;
    const abs = path.resolve(UPLOADS_DIR, s.slice('/uploads/'.length));
    return abs.startsWith(UPLOADS_DIR + path.sep) ? abs : null;
};

module.exports = { UPLOADS_DIR, rutaUploads, urlUploadsADisco };
