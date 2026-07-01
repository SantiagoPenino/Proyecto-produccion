const { getPool } = require('./config/db');
getPool().then(async p => {
    // Ver el último pedido y sus items
    const r = await p.request().query(`
        SELECT TOP 1 pc.ID, pc.NoDocERP, pc.EstadoCobro
        FROM PedidosCobranza pc
        WHERE pc.NoDocERP LIKE 'VEN-%'
        ORDER BY pc.FechaGeneracion DESC
    `);
    const pedido = r.recordset[0];
    console.log('Último pedido:', pedido);

    const items = await p.request().input('pid', pedido.ID).query(`
        SELECT CodArticulo as variante_id, Cantidad, PrecioUnitario, Subtotal
        FROM PedidosCobranzaDetalle
        WHERE PedidoCobranzaID = @pid
    `);
    console.log('Items (¿hay duplicados?):', JSON.stringify(items.recordset, null, 2));
    console.log('Total filas:', items.recordset.length);

    // Agrupar por variante para detectar duplicados
    const grouped = {};
    items.recordset.forEach(i => {
        if (!grouped[i.variante_id]) grouped[i.variante_id] = 0;
        grouped[i.variante_id] += parseFloat(i.Cantidad);
    });
    console.log('Cantidad total por variante:', grouped);
    process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
