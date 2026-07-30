// ─────────────────────────────────────────────────────────────────────────────
// NOMBRE DE LOS ARCHIVOS DE IMPRESIÓN — SOLO SUBLIMACIÓN (área SB)
//
// FORMATO:  {MATERIAL}-{ORDEN}_{CLIENTE}_Arch {i} de {n} (x{copias}).ext
// EJEMPLO:  Bandera (1,60)-SUB-9408_PROP851uy_Arch 1 de 1 (x1).pdf
//
// EL RESTO DE LAS ÁREAS (DTF, DIRECTA, ECOUV, TPU, prendas...) NO cambia: sigue
// saliendo {ORDEN}_{CLIENTE}_{TRABAJO}_Archivo {i} de {n} (x{copias}) como antes.
// Por eso cada lugar que arma un nombre pregunta primero por `usaNombreNuevo(area)`.
//
// TELA DE CLIENTE (solo SB): al material se le agrega a continuación el código PRE
// de la recepción de esa tela (InventarioBobinas.Referencia, vía Ordenes.BobinaTelaID),
// NO la descripción de la tela.
// ─────────────────────────────────────────────────────────────────────────────

// ⏸️ INTERRUPTOR EN LA BASE — ConfiguracionGlobal, clave 'AREAS_NOMBRE_ARCHIVO_NUEVO'
// (mismo mecanismo que AREAS_DESPACHO_PARCIAL). Valor = lista de AreaID separados
// por coma; vacío o clave inexistente = APAGADO, todas las áreas siguen con el
// nombre de siempre. Para prender Sublimación: Valor = 'SB'. No hay que tocar código.
const CLAVE_CONFIG = 'AREAS_NOMBRE_ARCHIVO_NUEVO';
const CACHE_MS = 60 * 1000; // se relee de la base como mucho 1 vez por minuto

let cacheAreas = [];
let cacheVence = 0;

/** Lee la lista de áreas de ConfiguracionGlobal (con cache de 1 minuto). */
async function areasNombreNuevo() {
    if (Date.now() < cacheVence) return cacheAreas;
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const cfg = await pool.request()
            .input('Clave', CLAVE_CONFIG)
            .query('SELECT Valor FROM ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = @Clave');
        cacheAreas = (cfg.recordset[0]?.Valor || '')
            .split(',').map(a => a.trim().toUpperCase()).filter(Boolean);
        cacheVence = Date.now() + CACHE_MS;
    } catch (e) {
        // Si la base no contesta, NO cambiamos nada: se usa el nombre de siempre.
        cacheAreas = [];
        cacheVence = Date.now() + CACHE_MS;
    }
    return cacheAreas;
}

/** ¿El área usa el formato nuevo ({MATERIAL}-{ORDEN}_{CLIENTE}_Arch ...)? */
async function usaNombreNuevo(areaID) {
    const areas = await areasNombreNuevo();
    return areas.includes(String(areaID || '').trim().toUpperCase());
}

/** Saca los caracteres que no se pueden usar en un nombre de archivo. */
const sanitizeParte = (str) => (str || '')
    .replace(/\//g, '-')
    .replace(/[<>:"\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Material que va al principio del nombre.
 * TELA DE CLIENTE: si la orden tiene bobina asignada (Ordenes.BobinaTelaID), se
 * agrega el PRE de esa recepción (Referencia) a continuación del material.
 */
function materialParaNombre(material, preTelaCliente) {
    let mat = sanitizeParte(material);
    const pre = sanitizeParte(preTelaCliente);
    if (pre) mat = mat ? `${mat} ${pre}` : pre;
    if (mat.length > 60) mat = mat.substring(0, 60).trim();
    return mat;
}

/**
 * Arma el nombre final del archivo de impresión (formato de Sublimación).
 * @param {object} p
 * @param {string} p.material   Material/sustrato de la orden (ya resuelto con el PRE si es tela de cliente)
 * @param {string} p.codigoOrden
 * @param {string} p.cliente
 * @param {number} p.idx        Índice del archivo dentro de la orden (1..n)
 * @param {number} p.total      Total de archivos de la orden
 * @param {number} p.copias
 * @param {string} [p.ext]      Extensión con punto ('.pdf'). Vacío = sin extensión.
 * @param {boolean} [p.dorso]   Archivo de DORSO
 */
function construirNombreArchivo({ material, codigoOrden, cliente, idx, total, copias, ext = '', dorso = false }) {
    const pMaterial = sanitizeParte(material);
    const pOrden = sanitizeParte(codigoOrden);
    const pCliente = sanitizeParte(cliente) || 'Cliente';
    const pDorso = dorso ? 'DORSO ' : '';

    const cuerpo = `${pOrden}_${pCliente}_${pDorso}Arch ${idx} de ${total} (x${copias || 1})`;
    return `${pMaterial ? `${pMaterial}-` : ''}${cuerpo}${ext || ''}`;
}

module.exports = { construirNombreArchivo, materialParaNombre, usaNombreNuevo, areasNombreNuevo, sanitizeParte };
