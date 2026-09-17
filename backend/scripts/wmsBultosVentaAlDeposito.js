/**
 * wmsBultosVentaAlDeposito.js — acomoda los bultos de ventas VEN que quedaron trabados
 * en la grilla "Crear Remito" del área PRO.
 *
 * QUÉ PASÓ: cada venta VEN crea una orden ancla en PRO cuyo único fin es imprimir la
 * etiqueta, y el bulto nace ahí. El ingreso a Depósito nunca tocaba ese bulto, así que
 * quedaba EN_STOCK en PRO para siempre, incluso con el pedido ya entregado al cliente.
 * Desde el fix de logisticaWmsController.receivePreparedOrder, las ventas nuevas mueven
 * el bulto a Depósito solas. Este script es para las que quedaron de antes.
 *
 * QUÉ HACE, según dónde terminó cada pedido:
 *   - Pedido ENTREGADO al cliente  → cierra el bulto (ENTREGADO / CLIENTE_FINAL). La
 *                                    mercadería ya no está en ningún lado nuestro.
 *   - Pedido esperando en Depósito → mueve el bulto a DEPOSITO, que es donde está.
 *   - Pedido cancelado             → no lo toca, lo lista aparte.
 *   - Pedido sin ingresar todavía  → no lo toca, sigue en PRO porque todavía está en PRO.
 *
 * Cada cambio queda asentado en MovimientosLogistica, igual que un movimiento normal.
 *
 * Uso:
 *   node backend/scripts/wmsBultosVentaAlDeposito.js            → SIMULACIÓN, no escribe
 *   node backend/scripts/wmsBultosVentaAlDeposito.js --aplicar   → ejecuta
 */
const path = require('path');
const { getPool, sql } = require(path.join(__dirname, '..', 'config', 'db'));

const APLICAR = process.argv.includes('--aplicar');
const USUARIO = 1; // usuario "sistema" para el historial de movimientos

// Estados de OrdenesDeposito (tabla EstadosOrdenes): 9 = Entregado, 10 = Cancelado.
const ENTREGADO = 9;
const CANCELADO = 10;

async function relevar(pool) {
    const r = await pool.request().query(`
        SELECT b.BultoID, b.CodigoEtiqueta, o.NoDocERP,
               d.OrdEstadoActual AS EstadoDeposito,
               ISNULL(eo.EOrNombreEstado, '(sin orden de depósito)') AS NombreEstado
        FROM Logistica_Bultos b
        INNER JOIN Ordenes o ON o.OrdenID = b.OrdenID
        LEFT JOIN OrdenesDeposito d ON LTRIM(RTRIM(d.OrdCodigoOrden)) = LTRIM(RTRIM(o.NoDocERP))
        LEFT JOIN EstadosOrdenes eo ON eo.EOrIdEstadoOrden = d.OrdEstadoActual
        WHERE b.Estado = 'EN_STOCK' AND b.UbicacionActual = 'PRO'
          AND o.AreaID = 'PRO' AND o.EstadoDependencia = 'VENTA_DIRECTA'
        ORDER BY b.BultoID`);

    const cerrar = [], mover = [], dejar = [];
    for (const b of r.recordset) {
        if (b.EstadoDeposito === ENTREGADO) cerrar.push(b);
        else if (b.EstadoDeposito === null || b.EstadoDeposito === CANCELADO) dejar.push(b);
        else mover.push(b);
    }
    return { cerrar, mover, dejar };
}

async function escribir(pool, bulto, { ubicacion, estado, obs }) {
    await pool.request()
        .input('BID', sql.Int, bulto.BultoID)
        .input('Ubi', sql.VarChar, ubicacion)
        .input('Est', sql.VarChar, estado)
        .query(`UPDATE Logistica_Bultos SET UbicacionActual = @Ubi, Estado = @Est WHERE BultoID = @BID`);
    await pool.request()
        .input('Cod', sql.VarChar, bulto.CodigoEtiqueta)
        .input('Ubi', sql.VarChar, ubicacion)
        .input('Est', sql.VarChar, estado)
        .input('Obs', sql.NVarChar, obs)
        .input('User', sql.Int, USUARIO)
        .query(`
            INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
            VALUES (@Cod, 'INGRESO', @Ubi, @User, GETDATE(), @Obs, 'EN_STOCK', @Est, 1)`);
}

(async () => {
    try {
        console.log(APLICAR
            ? '\n*** MODO APLICAR: esto escribe en la base ***\n'
            : '\n=== SIMULACIÓN: no se escribe nada. Agregá --aplicar para ejecutar ===\n');

        const pool = await getPool();
        const { cerrar, mover, dejar } = await relevar(pool);

        console.log(`── Pedidos ya entregados al cliente: se cierra el bulto (${cerrar.length})`);
        cerrar.slice(0, 5).forEach(b => console.log(`     ${b.CodigoEtiqueta} — ${b.NoDocERP.trim()}`));
        if (cerrar.length > 5) console.log(`     ... y ${cerrar.length - 5} más`);

        console.log(`\n── Pedidos esperando en Depósito: el bulto se mueve a DEPOSITO (${mover.length})`);
        mover.forEach(b => console.log(`     ${b.CodigoEtiqueta} — ${b.NoDocERP.trim()} (${b.NombreEstado})`));

        console.log(`\n── No se tocan (${dejar.length})`);
        dejar.forEach(b => console.log(`     ${b.CodigoEtiqueta} — ${b.NoDocERP.trim()} (${b.NombreEstado})`));

        if (!APLICAR) { console.log('\nSimulación terminada. Nada se escribió.'); process.exit(0); }

        for (const b of cerrar) {
            await escribir(pool, b, { ubicacion: 'CLIENTE_FINAL', estado: 'ENTREGADO', obs: 'Regularización: venta ya entregada al cliente' });
        }
        for (const b of mover) {
            await escribir(pool, b, { ubicacion: 'DEPOSITO', estado: 'EN_STOCK', obs: 'Regularización: venta ingresada a Depósito (sin remito: entrega en mano)' });
        }
        console.log(`\n✔ ${cerrar.length} bulto(s) cerrados, ${mover.length} movidos a Depósito, ${dejar.length} sin tocar.`);

        const despues = await relevar(pool);
        console.log(`Quedan en la grilla de PRO: ${despues.cerrar.length + despues.mover.length + despues.dejar.length} bulto(s) de venta.`);
        process.exit(0);
    } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
