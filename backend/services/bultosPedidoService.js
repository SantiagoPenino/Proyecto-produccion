const sql = require('mssql');

/**
 * Bultos que el depósito espera de un pedido (o de una orden sin pedido) y cuántos ya llegaron.
 * Es LA regla: la usan la recepción de remitos en DEPOSITO (el candado "esperar todos los
 * bultos" de receiveDispatch) y la bandeja "Esperando Bultos", así las dos cuentan igual.
 *
 *  - Cuenta los bultos PROD_TERMINADO de las órdenes del pedido (mismo NoDocERP) no canceladas.
 *    Las fallas internas (-F) no aportan bultos: por diseño no viajan a depósito.
 *  - No espera bultos que ya no van a llegar: PROCESADO (quedó en un área intermedia al
 *    transformarse la orden), CONSUMIDO (su contenido pasó a otro bulto), PERDIDO (declarado
 *    perdido al recibir) y DESPACHADO (ya salió). Mismo criterio que la reimpresión de
 *    etiquetas (etiquetasController) para saber qué paquetes existen.
 *  - Reposiciones (-R): si una orden tiene una reposición posterior del mismo trabajo en el
 *    pedido, sus bultos que no están en depósito dejan de esperarse — la reposición los
 *    reemplaza. Caso DTF-21969-R1 (22/09): el paquete de la original faltó en el remito y el
 *    pedido quedaba en "Esperando Bultos" para siempre.
 *  - Recibido = EN_STOCK en DEPOSITO.
 */

const ESTADOS_QUE_NO_LLEGAN = ['PROCESADO', 'CONSUMIDO', 'PERDIDO', 'DESPACHADO'];
const ES_REPOSICION = /-R\d+$/i;
const ES_FALLA = /-F/i;

// Código sin los sufijos de reposición: DTF-21969-R2 → DTF-21969 (las -R se crean sobre la raíz).
const raizCodigo = (codigo) => String(codigo || '').trim().toUpperCase().replace(/(-R\d+)+$/i, '');

// Órdenes reemplazadas por una reposición posterior del mismo trabajo (misma raíz, OrdenID mayor).
function ordenesReemplazadas(ordenes) {
    const reemplazadas = new Set();
    for (const o of ordenes) {
        const raiz = raizCodigo(o.CodigoOrden);
        const reemplazo = ordenes.some(r =>
            r.OrdenID > o.OrdenID &&
            ES_REPOSICION.test(String(r.CodigoOrden || '').trim()) &&
            raizCodigo(r.CodigoOrden) === raiz);
        if (reemplazo) reemplazadas.add(o.OrdenID);
    }
    return reemplazadas;
}

const enDeposito = (b) => b.Estado === 'EN_STOCK' && String(b.UbicacionActual || '').trim().toUpperCase() === 'DEPOSITO';

/**
 * @param db  pool o transacción
 * @param {object} alcance
 * @param {string[]} [alcance.noDocs]    pedidos (NoDocERP): se cuentan todas sus órdenes no canceladas
 * @param {number[]} [alcance.ordenIds]  órdenes SIN pedido: cada una se cuenta sola
 * @param {boolean}  [alcance.conFaltantes]  además, detalle de los bultos que faltan y su último remito
 * @returns {Promise<Map<string, {esperados:number, recibidos:number, ordenIds:number[], faltantes:object[]}>>}
 *          clave 'P:<NoDoc>' por pedido y 'O:<OrdenID>' por orden sin pedido
 */
async function contarBultos(db, { noDocs = [], ordenIds = [], conFaltantes = false } = {}) {
    const docs = [...new Set(noDocs.map(d => String(d || '').trim()).filter(Boolean))];
    const sueltas = [...new Set(ordenIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];
    const grupos = new Map();   // clave → [{ OrdenID, CodigoOrden }]

    // 1. Órdenes del alcance
    if (docs.length) {
        const req = new sql.Request(db);
        docs.forEach((d, i) => req.input(`d${i}`, sql.NChar(30), d));
        const r = await req.query(`
            SELECT o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden,
                   LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) AS NoDoc
            FROM Ordenes o
            WHERE o.NoDocERP IN (${docs.map((_, i) => `@d${i}`).join(',')})
              AND (o.Estado IS NULL OR UPPER(LTRIM(RTRIM(o.Estado))) <> 'CANCELADO')
        `);
        for (const o of r.recordset) {
            const clave = `P:${o.NoDoc}`;
            if (!grupos.has(clave)) grupos.set(clave, []);
            grupos.get(clave).push(o);
        }
        for (const d of docs) if (!grupos.has(`P:${d}`)) grupos.set(`P:${d}`, []);
    }
    if (sueltas.length) {
        const req = new sql.Request(db);
        sueltas.forEach((id, i) => req.input(`o${i}`, sql.Int, id));
        const r = await req.query(`
            SELECT o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden
            FROM Ordenes o
            WHERE o.OrdenID IN (${sueltas.map((_, i) => `@o${i}`).join(',')})
        `);
        for (const id of sueltas) grupos.set(`O:${id}`, r.recordset.filter(o => o.OrdenID === id));
    }

    // 2. Bultos de esas órdenes que todavía pueden llegar
    const todasLasOrdenes = [...grupos.values()].flat();
    const bultosPorOrden = new Map();
    if (todasLasOrdenes.length) {
        const ids = [...new Set(todasLasOrdenes.map(o => o.OrdenID))];
        const req = new sql.Request(db);
        ids.forEach((id, i) => req.input(`b${i}`, sql.Int, id));
        const r = await req.query(`
            SELECT b.BultoID, b.OrdenID, b.CodigoEtiqueta, b.Estado, b.UbicacionActual
            FROM Logistica_Bultos b
            WHERE b.OrdenID IN (${ids.map((_, i) => `@b${i}`).join(',')})
              AND b.Tipocontenido = 'PROD_TERMINADO'
              AND b.Estado NOT IN (${ESTADOS_QUE_NO_LLEGAN.map(e => `'${e}'`).join(',')})
        `);
        for (const b of r.recordset) {
            if (!bultosPorOrden.has(b.OrdenID)) bultosPorOrden.set(b.OrdenID, []);
            bultosPorOrden.get(b.OrdenID).push(b);
        }
    }

    // 3. Conteo por grupo
    const resultado = new Map();
    const faltantesTodos = [];
    for (const [clave, ordenes] of grupos) {
        const reemplazadas = ordenesReemplazadas(ordenes.filter(o => !ES_FALLA.test(o.CodigoOrden)));
        let esperados = 0, recibidos = 0;
        const faltantes = [];
        for (const o of ordenes) {
            if (ES_FALLA.test(o.CodigoOrden)) continue;
            for (const b of bultosPorOrden.get(o.OrdenID) || []) {
                const llego = enDeposito(b);
                if (!llego && reemplazadas.has(o.OrdenID)) continue;
                esperados++;
                if (llego) recibidos++;
                else faltantes.push({ BultoID: b.BultoID, CodigoEtiqueta: b.CodigoEtiqueta, CodigoOrden: o.CodigoOrden, Estado: b.Estado, Ubicacion: b.UbicacionActual });
            }
        }
        resultado.set(clave, { esperados, recibidos, ordenIds: ordenes.map(o => o.OrdenID), faltantes });
        faltantesTodos.push(...faltantes);
    }

    // 4. Último remito de cada bulto que falta (para decir dónde buscarlo)
    if (conFaltantes && faltantesTodos.length) {
        const ids = [...new Set(faltantesTodos.map(f => f.BultoID))];
        const req = new sql.Request(db);
        ids.forEach((id, i) => req.input(`f${i}`, sql.Int, id));
        const r = await req.query(`
            SELECT i.BultoID, e.EnvioID, e.CodigoRemito, e.Estado
            FROM Logistica_EnvioItems i
            JOIN Logistica_Envios e ON e.EnvioID = i.EnvioID
            WHERE i.BultoID IN (${ids.map((_, i) => `@f${i}`).join(',')})
        `);
        const ultimo = new Map();
        for (const row of r.recordset) {
            const prev = ultimo.get(row.BultoID);
            if (!prev || row.EnvioID > prev.EnvioID) ultimo.set(row.BultoID, row);
        }
        for (const f of faltantesTodos) {
            const rem = ultimo.get(f.BultoID);
            f.Remito = rem?.CodigoRemito || null;
            f.EstadoRemito = rem?.Estado || null;
        }
    }

    return resultado;
}

module.exports = { contarBultos, raizCodigo, ordenesReemplazadas, ESTADOS_QUE_NO_LLEGAN };
