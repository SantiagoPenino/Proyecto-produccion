const sql = require('mssql');

/**
 * Servicio de completitud de pedidos (NoDocERP).
 *
 * Un pedido puede generar varias órdenes hermanas (ej. SUB-154 (1/2) y SUB-154 (2/2)
 * por tela en SB, más órdenes en otras áreas como DTF-154). Reglas de negocio:
 *  - Pedido completo EN ÁREA  : todas las órdenes del pedido en esa área están prontas
 *                               → habilita enviar de un área a otra.
 *  - Pedido completo GLOBAL   : todas las órdenes de todas las áreas están prontas
 *                               → habilita enviar a / recibir en DEPOSITO y avisar al cliente.
 *
 * "Pronta o más allá": EstadoenArea IN (Pronto, En Transito) o Estado IN
 * (Finalizado, Ingresado, Avisado, Entregado). Retenido (falla) NO es pronta.
 * Las canceladas no cuentan. NoDocERP NULL → sin hermanas → siempre completo.
 */

// Fragmento SQL reutilizable: la orden con alias dado está "pronta o más allá".
// Se chequean ambas columnas porque Estado (general) se deriva de ConfigEstados
// y su mapeo es configurable; EstadoenArea guarda el estado específico.
const ESTADOS_LISTA = "('PRONTO', 'EN TRANSITO', 'FINALIZADO', 'INGRESADO', 'AVISADO', 'ENTREGADO')";
const sqlOrdenPronta = (alias) => `(
    UPPER(LTRIM(RTRIM(ISNULL(${alias}.EstadoenArea, '')))) IN ${ESTADOS_LISTA}
    OR UPPER(LTRIM(RTRIM(ISNULL(${alias}.Estado, '')))) IN ${ESTADOS_LISTA}
)`;

const sqlOrdenNoCancelada = (alias) =>
    `(${alias}.Estado IS NULL OR UPPER(LTRIM(RTRIM(${alias}.Estado))) <> 'CANCELADO')`;

// db puede ser un pool o una transacción activa
const makeRequest = (db) => new sql.Request(db);

/**
 * Todos los archivos y servicios extra (no cancelados) de la orden están en OK/FINALIZADO
 * y ninguno en FALLA. Misma regla que usa completarOrden.
 */
async function isOrdenCompleta(db, ordenId) {
    const r = await makeRequest(db)
        .input('OID', sql.Int, ordenId)
        .query(`
            SELECT
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo != 'CANCELADO') +
                (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado != 'CANCELADO') as Total,
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo IN ('OK', 'FINALIZADO')) +
                (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado IN ('OK', 'FINALIZADO')) as Completed,
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo = 'FALLA') as Fallas
        `);
    const { Total, Completed, Fallas } = r.recordset[0];
    return Total > 0 && Total === Completed && Fallas === 0;
}

/**
 * Órdenes hermanas del pedido (no canceladas), opcionalmente filtradas por área.
 */
async function getOrdenesPedido(db, noDocERP, { areaId } = {}) {
    if (!noDocERP) return [];
    const req = makeRequest(db).input('NoDoc', sql.VarChar, String(noDocERP));
    let where = `O.NoDocERP = @NoDoc AND ${sqlOrdenNoCancelada('O')}`;
    if (areaId) {
        where += ' AND O.AreaID = @Area';
        req.input('Area', sql.VarChar, areaId);
    }
    const r = await req.query(`
        SELECT O.OrdenID, O.CodigoOrden, O.AreaID, O.Estado, O.EstadoenArea, O.EstadoLogistica
        FROM Ordenes O
        WHERE ${where}
        ORDER BY O.OrdenID
    `);
    return r.recordset;
}

/**
 * Núcleo: devuelve { completo, faltantes } donde faltantes son las hermanas
 * que aún no están prontas. asumirProntaOrdenId permite evaluar "¿quedaría
 * completo si esta orden pasa a Pronto?" dentro de una transacción abierta.
 */
async function checkPedidoCompleto(db, noDocERP, { areaId = null, asumirProntaOrdenId = null } = {}) {
    if (!noDocERP) return { completo: true, faltantes: [] };

    const req = makeRequest(db).input('NoDoc', sql.VarChar, String(noDocERP));
    let where = `O.NoDocERP = @NoDoc AND ${sqlOrdenNoCancelada('O')} AND NOT ${sqlOrdenPronta('O')}`;
    if (areaId) {
        where += ' AND O.AreaID = @Area';
        req.input('Area', sql.VarChar, areaId);
    }
    if (asumirProntaOrdenId) {
        where += ' AND O.OrdenID != @AsumirOID';
        req.input('AsumirOID', sql.Int, asumirProntaOrdenId);
    }

    const r = await req.query(`
        SELECT O.OrdenID, O.CodigoOrden, O.AreaID, O.Estado, O.EstadoenArea
        FROM Ordenes O
        WHERE ${where}
        ORDER BY O.OrdenID
    `);
    return { completo: r.recordset.length === 0, faltantes: r.recordset };
}

/**
 * Pedido completo EN ÁREA: todas las órdenes del pedido en esa área están prontas.
 */
function isPedidoCompletoEnArea(db, noDocERP, areaId, opts = {}) {
    return checkPedidoCompleto(db, noDocERP, { ...opts, areaId });
}

/**
 * Pedido completo GLOBAL: todas las órdenes del pedido en todas las áreas están prontas.
 */
function isPedidoCompletoGlobal(db, noDocERP, opts = {}) {
    return checkPedidoCompleto(db, noDocERP, { ...opts, areaId: null });
}

/**
 * Fragmento SQL para filtros inline (ej. getAreaStock): existe alguna hermana
 * de la orden con alias `ordenAlias` (misma área) que aún no está pronta.
 * Devuelve una condición EXISTS(...) lista para usar en un WHERE.
 */
function sqlExistsHermanaNoPronta(ordenAlias) {
    return `EXISTS (
        SELECT 1 FROM Ordenes oh
        WHERE oh.NoDocERP = ${ordenAlias}.NoDocERP
          AND ${ordenAlias}.NoDocERP IS NOT NULL
          AND oh.AreaID = ${ordenAlias}.AreaID
          AND ${sqlOrdenNoCancelada('oh')}
          AND NOT ${sqlOrdenPronta('oh')}
    )`;
}

module.exports = {
    isOrdenCompleta,
    getOrdenesPedido,
    isPedidoCompletoEnArea,
    isPedidoCompletoGlobal,
    sqlExistsHermanaNoPronta,
    sqlOrdenPronta,
    sqlOrdenNoCancelada,
};
