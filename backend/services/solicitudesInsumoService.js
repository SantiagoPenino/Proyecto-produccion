/**
 * Solicitudes de insumo del cliente (Spec 39, RN-FLT.09 a RN-FLT.11).
 *
 * Cuando lo dañado es tela o prenda del cliente (o un producto del local), producción no lo
 * puede reponer: no nace ninguna orden de falla. Se abre una Solicitud que ven Atención al
 * Cliente y Administración, el sistema busca stock de ESA tela/prenda de ESE cliente, y la
 * orden de falla recién se crea con la decisión del cliente (usa el stock / trae más → PRE).
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const TIPOS = { TELA_CLIENTE: 'TELA_CLIENTE', PRENDA_CLIENTE: 'PRENDA_CLIENTE', PRODUCTO_LOCAL: 'PRODUCTO_LOCAL' };

/**
 * Origen del insumo de una orden (fila de Ordenes con BobinaTelaID, PrendaClienteID, WmsVarianteId,
 * NoDocERP): PROPIO | TELA_CLIENTE | PRENDA_CLIENTE | PRODUCTO_LOCAL.
 * Producto del local: la orden (o su madre PRO del mismo pedido) tiene una variante de stock.
 */
async function detectarOrigenInsumo(orden, conn) {
    if (!orden) return 'PROPIO';
    if (orden.BobinaTelaID) return TIPOS.TELA_CLIENTE;
    if (orden.PrendaClienteID) return TIPOS.PRENDA_CLIENTE;
    if (orden.WmsVarianteId) return TIPOS.PRODUCTO_LOCAL;
    const pool = conn || await getPool();
    // [VENTA/COMBO] La prenda del local de un pedido "Comprar y personalizar" o de un combo no
    // está en la orden de Bordado/Estampado ni en la PRO del pedido: está en la venta de retiro
    // (ancla VEN-) de SU prenda — mismo pedido (ComboPedidoNoDocERP) y mismo ComboItemID. Sin
    // esto la prenda se detectaba como material PROPIO y la falla creaba una orden -F directa
    // en Bordado, como si hubiera otra prenda para bordar, en vez de abrir la solicitud que
    // saca una prenda nueva del stock (caso BOR-20948 (1/2)-F1366).
    if (orden.OrdenID) {
        const ancla = await new sql.Request(pool).input('id', sql.Int, orden.OrdenID).query(`
            SELECT TOP 1 1 AS X
            FROM Ordenes o
            JOIN Ordenes a ON a.EstadoDependencia = 'VENTA_DIRECTA'
                          AND a.ComboItemID = o.ComboItemID
                          AND LTRIM(RTRIM(a.ComboPedidoNoDocERP)) = LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
                          AND a.WmsVarianteId IS NOT NULL
            WHERE o.OrdenID = @id AND o.ComboItemID IS NOT NULL`);
        if (ancla.recordset.length) return TIPOS.PRODUCTO_LOCAL;
    }
    if (orden.NoDocERP) {
        const r = await new sql.Request(pool).input('doc', sql.NChar, String(orden.NoDocERP).trim())
            .query(`SELECT TOP 1 WmsVarianteId FROM Ordenes WHERE RTRIM(NoDocERP) = RTRIM(@doc) AND AreaID = 'PRO' AND WmsVarianteId IS NOT NULL`);
        if (r.recordset.length) return TIPOS.PRODUCTO_LOCAL;
    }
    return 'PROPIO';
}

/**
 * Stock de ESA tela de ESE cliente: bobinas del mismo cliente y misma tela (DescripcionTela),
 * disponibles, distintas de la bobina de la orden.
 */
async function buscarStockTela(orden, conn) {
    const pool = conn || await getPool();
    const b = await new sql.Request(pool).input('id', sql.Int, orden.BobinaTelaID)
        .query(`SELECT BobinaID, ClienteID, DescripcionTela, InsumoID, CodigoEtiqueta, MetrosRestantes, Estado FROM InventarioBobinas WHERE BobinaID = @id`);
    const bob = b.recordset[0];
    if (!bob) return { bobinaOrden: null, candidatas: [] };
    const cli = String(bob.ClienteID || orden.CliIdCliente || '').trim();
    const tela = String(bob.DescripcionTela || '').trim();
    const r = await new sql.Request(pool)
        .input('cli', sql.NVarChar, cli).input('cli2', sql.NVarChar, String(orden.CliIdCliente || '').trim())
        .input('tela', sql.NVarChar, tela).input('ins', sql.Int, bob.InsumoID).input('self', sql.Int, bob.BobinaID)
        .query(`
            SELECT ib.BobinaID, ib.CodigoEtiqueta, ib.DescripcionTela, ib.MetrosRestantes, ib.Ancho, ib.AnchoReal, ib.AreaID, ib.Ubicacion, ib.FechaIngreso, ib.Referencia, ib.Estado
            FROM InventarioBobinas ib
            WHERE (LTRIM(RTRIM(ib.ClienteID)) = @cli OR (@cli2 <> '' AND LTRIM(RTRIM(ib.ClienteID)) = @cli2))
              AND ib.BobinaID <> @self
              AND ib.Estado IN ('Disponible','En Uso')
              AND ib.MetrosRestantes > 0.5
              AND (
                   (@tela <> '' AND UPPER(LTRIM(RTRIM(ISNULL(ib.DescripcionTela,'')))) = UPPER(@tela))
                OR (@tela = '' AND ib.InsumoID = @ins)
              )
            ORDER BY ib.FechaIngreso ASC`);
    return { bobinaOrden: bob, candidatas: r.recordset };
}

async function buscarStockPrenda(orden, conn) {
    const pool = conn || await getPool();
    const p = await new sql.Request(pool).input('id', sql.Int, orden.PrendaClienteID)
        .query(`SELECT PrendaClienteID, ClienteID, Descripcion, Talle, Color FROM InventarioPrendasCliente WHERE PrendaClienteID = @id`);
    const pr = p.recordset[0];
    if (!pr) return { prendaOrden: null, candidatas: [] };
    const r = await new sql.Request(pool)
        .input('cli', sql.VarChar, String(pr.ClienteID || '').trim()).input('desc', sql.NVarChar, String(pr.Descripcion || '').trim()).input('self', sql.Int, pr.PrendaClienteID)
        .query(`
            SELECT PrendaClienteID, CodigoRecepcion, Descripcion, Talle, Color, Cantidad, CantidadUsada, CantidadDisponible, FechaIngreso
            FROM vw_PrendasClienteDisponibles
            WHERE LTRIM(RTRIM(ClienteID)) = @cli AND PrendaClienteID <> @self AND CantidadDisponible > 0
              AND UPPER(LTRIM(RTRIM(Descripcion))) = UPPER(@desc)
            ORDER BY FechaIngreso ASC`);
    return { prendaOrden: pr, candidatas: r.recordset };
}

/** Stock según el tipo. Devuelve { tipo, encontrado: [...], resumen } serializable. */
async function buscarStock(tipo, orden, conn) {
    if (tipo === TIPOS.TELA_CLIENTE) {
        const { bobinaOrden, candidatas } = await buscarStockTela(orden, conn);
        const total = candidatas.reduce((s, c) => s + Number(c.MetrosRestantes || 0), 0);
        return { tipo, insumo: bobinaOrden ? { descripcion: bobinaOrden.DescripcionTela, bobina: bobinaOrden.CodigoEtiqueta } : null, encontrado: candidatas, resumen: candidatas.length ? `${candidatas.length} bobina(s) de la misma tela, ${total.toFixed(2)} m disponibles` : 'Sin stock de esta tela del cliente' };
    }
    if (tipo === TIPOS.PRENDA_CLIENTE) {
        const { prendaOrden, candidatas } = await buscarStockPrenda(orden, conn);
        const total = candidatas.reduce((s, c) => s + Number(c.CantidadDisponible || 0), 0);
        return { tipo, insumo: prendaOrden ? { descripcion: [prendaOrden.Descripcion, prendaOrden.Talle, prendaOrden.Color].filter(Boolean).join(' · ') } : null, encontrado: candidatas, resumen: candidatas.length ? `${total} prenda(s) iguales disponibles del cliente` : 'Sin stock de esta prenda del cliente' };
    }
    return { tipo, insumo: null, encontrado: [], resumen: 'Producto del local: ver stock en la tienda' };
}

async function getPlazoDias(conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).query(`SELECT TOP 1 Valor FROM ConfiguracionGlobal WHERE Clave = 'PLAZO_SOLICITUD_INSUMO_DIAS'`);
    const n = parseInt(r.recordset[0]?.Valor, 10);
    return Number.isFinite(n) && n > 0 ? n : 7;
}

/** Crea la Solicitud para una Reposición en ESPERANDO_INSUMO. */
async function crearSolicitud(tx, { reposicionId, tipo, stock, usuarioId }) {
    const plazo = await getPlazoDias(tx);
    const r = await new sql.Request(tx)
        .input('rep', sql.Int, reposicionId).input('tipo', sql.VarChar(20), tipo)
        .input('stock', sql.NVarChar(sql.MAX), JSON.stringify(stock || null))
        .input('plazo', sql.Int, plazo).input('u', sql.Int, usuarioId || null)
        .query(`INSERT INTO SolicitudesInsumo (ReposicionID, Tipo, Estado, StockEncontrado, Vencimiento, UsuarioID)
                OUTPUT INSERTED.SolicitudID
                VALUES (@rep, @tipo, 'NUEVA', @stock, ${tipo === TIPOS.PRODUCTO_LOCAL ? 'NULL' : 'DATEADD(day, @plazo, GETDATE())'}, @u)`);
    // [PRODUCTO_LOCAL] Sin plazo: al cliente no se le pregunta nada, solo se aprueba la reposición.
    return r.recordset[0].SolicitudID;
}

module.exports = { TIPOS, detectarOrigenInsumo, buscarStock, buscarStockTela, buscarStockPrenda, getPlazoDias, crearSolicitud };
