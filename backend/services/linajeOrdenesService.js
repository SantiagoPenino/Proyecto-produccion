/**
 * Linaje de órdenes: madre ↔ reposiciones (-F) y reposiciones de cliente (-R).
 *
 * Único punto que interpreta el sufijo del código. Con la columna Ordenes.OrdenOrigenID
 * (Spec 39, fase 0) el vínculo es explícito; el parseo del código queda como respaldo
 * para órdenes que todavía no lo tengan relleno.
 */
const { getPool, sql } = require('../config/db');

const RE_SUFIJO = /-[FR]\d/;

/** Raíz del código: todo lo que está antes del primer "-F<n>" o "-R<n>". */
function raizCodigo(codigo) {
    if (!codigo) return codigo;
    const m = RE_SUFIJO.exec(codigo);
    return m ? codigo.slice(0, m.index) : codigo;
}

function esReposicion(codigo) { return RE_SUFIJO.test(codigo || ''); }
function esFallaInterna(codigo) { return /-F\d/.test(codigo || ''); }
function esReposicionCliente(codigo) { return /-R\d/.test(codigo || ''); }

/**
 * Orden madre de una orden (la raíz del linaje). Devuelve null si la orden no desciende de otra.
 * @param {number} ordenId
 * @param {sql.Transaction|sql.ConnectionPool} [conn]
 */
async function getMadre(ordenId, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('id', sql.Int, ordenId).query(`
        SELECT o.OrdenID, o.CodigoOrden, o.OrdenOrigenID,
               m.OrdenID AS MadreID, m.CodigoOrden AS MadreCodigo, m.AreaID AS MadreArea, m.NoDocERP AS MadreNoDocERP
        FROM Ordenes o
        LEFT JOIN Ordenes m ON m.OrdenID = o.OrdenOrigenID
        WHERE o.OrdenID = @id`);
    const row = r.recordset[0];
    if (!row) return null;
    if (row.MadreID) return { OrdenID: row.MadreID, CodigoOrden: row.MadreCodigo, AreaID: row.MadreArea, NoDocERP: row.MadreNoDocERP };
    if (!esReposicion(row.CodigoOrden)) return null;
    // Respaldo: buscar por código raíz
    const raiz = raizCodigo(row.CodigoOrden);
    const r2 = await new sql.Request(pool).input('cod', sql.VarChar, raiz).query(`
        SELECT TOP 1 OrdenID, CodigoOrden, AreaID, NoDocERP FROM Ordenes WHERE CodigoOrden = @cod ORDER BY OrdenID`);
    return r2.recordset[0] || null;
}

/** Hijas directas o de todo el linaje (todas las -F/-R que descienden de la madre). */
async function getHijas(ordenMadreId, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('id', sql.Int, ordenMadreId).query(`
        SELECT h.OrdenID, h.CodigoOrden, h.AreaID, h.Estado, h.EstadoenArea, h.EstadoLogistica, h.Magnitud, h.UM, h.Prioridad
        FROM Ordenes h WHERE h.OrdenOrigenID = @id
        UNION
        SELECT h.OrdenID, h.CodigoOrden, h.AreaID, h.Estado, h.EstadoenArea, h.EstadoLogistica, h.Magnitud, h.UM, h.Prioridad
        FROM Ordenes m JOIN Ordenes h ON h.CodigoOrden LIKE m.CodigoOrden + '-[FR][0-9]%' AND h.OrdenOrigenID IS NULL
        WHERE m.OrdenID = @id`);
    return r.recordset;
}

/**
 * Registro de Reposiciones asociado a una orden de falla, si existe.
 * Sirve para distinguir "falla en la misma área" (como hoy) de "reposición hacia atrás"
 * (nació en otra área por un faltante y su material tiene que viajar como complemento).
 */
async function getReposicionDeFalla(ordenFallaId, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('id', sql.Int, ordenFallaId).query(`
        SELECT TOP 1 * FROM Reposiciones WHERE OrdenFallaID = @id ORDER BY ReposicionID DESC`);
    return r.recordset[0] || null;
}

async function esReposicionHaciaAtras(ordenFallaId, conn) {
    const rep = await getReposicionDeFalla(ordenFallaId, conn);
    return !!(rep && rep.AreaProduce !== rep.AreaReporta);
}

module.exports = { raizCodigo, esReposicion, esFallaInterna, esReposicionCliente, getMadre, getHijas, getReposicionDeFalla, esReposicionHaciaAtras };
