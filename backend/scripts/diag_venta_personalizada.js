/**
 * diag_venta_personalizada.js — SOLO LECTURA
 * ---------------------------------------------------------------------------
 * Muestra cómo quedó armado un pedido de "Comprar y personalizar": qué órdenes
 * nacieron, a dónde va cada una, cuáles esperan un retiro de stock y qué ventas
 * VEN- de retiro se generaron.
 *
 * Uso:   node backend/scripts/diag_venta_personalizada.js 20946
 *        (el número es el NoDocERP del pedido, el que va después de PRO-)
 *
 * Qué mirar:
 *   · Una fila PRO por artículo del carrito = su línea de precio.
 *   · El artículo que NO se personaliza es el único PRO con WmsVarianteId, y
 *     tiene que estar en ESPERANDO_RETIRO_WMS (aparece en Logística WMS →
 *     "Retiros de prendas"). Si está sin candado, su stock no lo descuenta nadie.
 *   · Los artículos que SÍ se personalizan tienen una VEN- de retiro cada uno,
 *     y sus servicios (EMB/DF/TPU) esperan en ESPERANDO_RETIRO_WMS hasta que se
 *     confirme ESA venta.
 *   · ProximoServicio de cada ancla = el área a la que va ese artículo
 *     (EMB / EST / DEPOSITO si no se personaliza).
 */
const { getPool } = require('../config/db');

const doc = String(process.argv[2] || '').trim();
if (!doc) {
    console.error('Falta el número de pedido. Ej: node backend/scripts/diag_venta_personalizada.js 20946');
    process.exit(1);
}

const tabla = (filas) => {
    if (!filas.length) { console.log('   (sin filas)'); return; }
    console.table(filas.map(f => Object.fromEntries(
        Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    )));
};

(async () => {
    const pool = await getPool();

    console.log(`\n=== ÓRDENES DEL PEDIDO ${doc} ===`);
    const ordenes = await pool.request().input('Doc', doc).query(`
        SELECT OrdenID, LTRIM(RTRIM(CodigoOrden)) AS Orden, LTRIM(RTRIM(AreaID)) AS Area,
               LTRIM(RTRIM(Material)) AS Articulo, Magnitud, LTRIM(RTRIM(UM)) AS UM,
               LTRIM(RTRIM(ProximoServicio)) AS VaHacia,
               ISNULL(EstadoDependencia, '—') AS Candado,
               WmsVarianteId AS Retira, ComboItemID AS Grupo, LiberaCuandoOrdenID AS EsperaA
        FROM Ordenes WITH(NOLOCK)
        WHERE LTRIM(RTRIM(NoDocERP)) = @Doc
        ORDER BY OrdenID`);
    tabla(ordenes.recordset);

    console.log(`\n=== VENTAS VEN- DE RETIRO GENERADAS POR ESTE PEDIDO ===`);
    const anclas = await pool.request().input('Doc', doc).query(`
        SELECT pc.NoDocERP AS Venta, pc.EstadoCobro AS Estado, pc.MontoTotal AS Monto,
               o.OrdenID, LTRIM(RTRIM(o.DescripcionTrabajo)) AS Detalle,
               LTRIM(RTRIM(o.ProximoServicio)) AS VaHacia,
               o.WmsVarianteId AS Retira, o.ComboItemID AS Grupo, o.Magnitud AS Cantidad
        FROM Ordenes o WITH(NOLOCK)
        LEFT JOIN PedidosCobranza pc WITH(NOLOCK) ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(o.NoDocERP))
        WHERE LTRIM(RTRIM(o.ComboPedidoNoDocERP)) = @Doc AND o.EstadoDependencia = 'VENTA_DIRECTA'
        ORDER BY o.OrdenID`);
    tabla(anclas.recordset);

    console.log(`\n=== CHEQUEOS ===`);
    const proSinCandadoNiAncla = ordenes.recordset.filter(o =>
        String(o.Area).trim() === 'PRO' && !o.Retira && String(o.Candado) === '—'
        && !anclas.recordset.some(a => String(a.Cantidad).trim() && String(a.Detalle || '').includes(String(o.Articulo).trim()))
    );
    console.log(`Artículos del carrito (PRO): ${ordenes.recordset.filter(o => String(o.Area).trim() === 'PRO').length}`);
    console.log(`Con retiro propio (sin personalizar): ${ordenes.recordset.filter(o => o.Retira).length}`);
    console.log(`Ventas VEN- de retiro (personalizados): ${anclas.recordset.length}`);
    const sinDescontar = ordenes.recordset.filter(o => o.Retira && String(o.Candado) === '—');
    if (sinDescontar.length) {
        console.log(`⚠️  ${sinDescontar.length} orden(es) con artículo de WMS y SIN candado de retiro — su stock no lo va a descontar nadie:`);
        tabla(sinDescontar);
    } else {
        console.log('✔  No hay artículos de WMS sin candado de retiro.');
    }
    if (proSinCandadoNiAncla.length) {
        console.log(`ℹ  ${proSinCandadoNiAncla.length} PRO sin retiro propio — deberían tener su ancla VEN- arriba.`);
    }
    console.log('');
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
