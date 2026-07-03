const { getPool } = require('./config/db');
getPool().then(async p => {
    await p.request().query(`UPDATE PedidosCobranza SET EstadoCobro = 'PENDIENTE' WHERE ID = 7897`);
    const r = await p.request().query(`SELECT ID, NoDocERP, EstadoCobro FROM PedidosCobranza WHERE ID = 7897`);
    console.log('✅ Reseteado:', r.recordset[0]);
    process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
