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
const ESTADOS_LISTA = "('PRONTO', 'EN TRANSITO', 'RECIBIDO EN DESTINO', 'FINALIZADO', 'INGRESADO', 'AVISADO', 'ENTREGADO')";
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
    // [PRENDAS] PRO nunca cuenta como "falta" acá: no es un paso físico (es el pilar que
    // agrupa el pedido para precio/factura), no tiene Bandeja ni botón de terminar, así que
    // nunca llega a Pronto — sin esta exclusión NINGÚN pedido con PRO podría salir jamás a
    // Depósito ni avisarse al cliente (el candado global lo daba por incompleto para siempre).
    let where = `O.NoDocERP = @NoDoc AND ${sqlOrdenNoCancelada('O')} AND UPPER(LTRIM(RTRIM(ISNULL(O.AreaID,'')))) <> 'PRO' AND NOT ${sqlOrdenPronta('O')}`;
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
 * Pedido completo FÍSICAMENTE en un área: a diferencia de isPedidoCompletoEnArea/Global
 * (que miran el ESTADO de la orden, donde "En Tránsito" ya cuenta como pronta), esta mira
 * la UBICACIÓN REAL del bulto — solo cuenta como listo si el bulto de la orden ya está
 * EN_STOCK en esa área. Hace falta cuando una orden puede estar "En Tránsito HACIA" un
 * área intermedia (ej. de vuelta a PRO, ver FASE 5/6 de combos) sin haber llegado
 * todavía: con el criterio de estado, "en tránsito" ya cuenta como pronta y se dispara el
 * siguiente paso antes de tiempo (bug real visto en producción: 2 remitos parciales
 * armados de a uno en vez de esperar a que ambos componentes estuvieran físicamente
 * juntos en PRO).
 *
 * Solo cuenta órdenes cuyo ProximoServicio real ES esta área — no "cualquier orden que
 * no sea PRO". Sin ese filtro, un paso intermedio que legítimamente NUNCA vuelve a PRO
 * (ej. DF/TPU: imprimen el transfer y se consumen en Estampado, jamás viajan a PRO)
 * quedaría contado como "falta" para siempre y el pedido nunca se vería completo (2do
 * bug real, encontrado apenas se probó esta función contra un combo real). Sin órdenes
 * que de verdad deban llegar a esta área, nunca "completo" — evita falsos positivos.
 */
async function isPedidoCompletoFisicamenteEnArea(db, noDocERP, areaId) {
    if (!noDocERP || !areaId) return { completo: false, faltantes: [], totalOrdenes: 0 };

    const totalRes = await makeRequest(db)
        .input('NoDoc', sql.VarChar, String(noDocERP))
        .input('Area', sql.VarChar, areaId)
        .query(`
            SELECT COUNT(*) AS Total FROM Ordenes O
            WHERE O.NoDocERP = @NoDoc AND ${sqlOrdenNoCancelada('O')}
              AND UPPER(LTRIM(RTRIM(ISNULL(O.AreaID,'')))) <> 'PRO'
              AND UPPER(LTRIM(RTRIM(ISNULL(O.ProximoServicio,'')))) = UPPER(@Area)
        `);
    const totalOrdenes = totalRes.recordset[0]?.Total || 0;
    if (totalOrdenes === 0) return { completo: false, faltantes: [], totalOrdenes: 0 };

    const r = await makeRequest(db)
        .input('NoDoc', sql.VarChar, String(noDocERP))
        .input('Area', sql.VarChar, areaId)
        .query(`
            SELECT O.OrdenID, O.CodigoOrden, O.AreaID, O.Estado, O.EstadoenArea
            FROM Ordenes O
            WHERE O.NoDocERP = @NoDoc AND ${sqlOrdenNoCancelada('O')}
              AND UPPER(LTRIM(RTRIM(ISNULL(O.AreaID,'')))) <> 'PRO'
              AND UPPER(LTRIM(RTRIM(ISNULL(O.ProximoServicio,'')))) = UPPER(@Area)
              AND NOT EXISTS (
                  SELECT 1 FROM Logistica_Bultos B
                  WHERE B.OrdenID = O.OrdenID
                    AND B.UbicacionActual = @Area
                    AND B.Estado = 'EN_STOCK'
                    AND ISNULL(B.Tipocontenido, '') <> 'ENCOMIENDA'
              )
            ORDER BY O.OrdenID
        `);
    return { completo: r.recordset.length === 0, faltantes: r.recordset, totalOrdenes };
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
    isPedidoCompletoFisicamenteEnArea,
    sqlExistsHermanaNoPronta,
    sqlOrdenPronta,
    sqlOrdenNoCancelada,
};
