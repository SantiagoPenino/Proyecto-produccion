// =====================================================================
// copiaDeTrabajo — una copia propia del temporal de una subida (26/10/2026)
// =====================================================================
// Multer deja el archivo en uploads/tmp y el finally de la subida lo borra apenas contesta. Lo que sigue en
// segundo plano (capa de blanco DTF, miniatura, perfil de color, preflight) necesita su propia copia.
//
// Antes se hacía con fs.copyFileSync, que traba TODO el backend mientras copia: con el banner de 2,7 GB del
// 26/10 (EUV-38376) el sistema quedó quieto para todos los usuarios. Ahora es un enlace duro: instantáneo y
// sin copiar datos; el archivo vive en disco hasta que se borra el último nombre que lo apunta. La carpeta
// está en la misma partición que los temporales de multer, así que el enlace siempre se puede; si igual
// falla (un disco sin enlaces duros), se copia en segundo plano, sin trabar.
// =====================================================================
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { rutaUploads } = require('./rutasUploads');

const DIR = rutaUploads('tmp', 'trabajo');
const VIEJO_MS = 24 * 3600 * 1000;
let barrido = false;

// Lo que quedó de un reinicio en medio de un trabajo: una vez por arranque, lo de más de un día se borra
async function barrerViejos() {
    if (barrido) return;
    barrido = true;
    try {
        const ahora = Date.now();
        for (const nombre of await fs.promises.readdir(DIR)) {
            const ruta = path.join(DIR, nombre);
            const st = await fs.promises.stat(ruta).catch(() => null);
            if (st && st.isFile() && ahora - st.mtimeMs > VIEJO_MS) await borrarCopia(ruta);
        }
    } catch (e) {
        if (e.code !== 'ENOENT') logger.warn(`[copiaDeTrabajo] no se pudo limpiar ${DIR}: ${e.message}`);
    }
}

/** Enlace (o copia) de `origen` en uploads/tmp/trabajo. Devuelve la ruta nueva; si no se puede, lanza. */
async function copiaDeTrabajo(origen, prefijo, extension = path.extname(origen)) {
    await fs.promises.mkdir(DIR, { recursive: true });
    barrerViejos();
    const destino = path.join(DIR, `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${String(extension || '').toLowerCase()}`);
    try {
        await fs.promises.link(origen, destino);
    } catch (e) {
        logger.warn(`[copiaDeTrabajo] sin enlace duro para ${path.basename(origen)} (${e.code || e.message}): se copia`);
        await fs.promises.copyFile(origen, destino);
    }
    return destino;
}

function borrarCopia(ruta) {
    if (!ruta) return Promise.resolve();
    return fs.promises.unlink(ruta).catch(e => {
        if (e.code !== 'ENOENT') logger.warn(`[copiaDeTrabajo] no se pudo borrar ${ruta}: ${e.message}`);
    });
}

module.exports = { copiaDeTrabajo, borrarCopia, DIR };
