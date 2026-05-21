const { getPool } = require('../config/db');

async function run() {
    const pool = await getPool();

    // Ver configuración del evento COBRO_CTA en el motor contable
    const evts = await pool.request().query(`
        SELECT EvtCodigo, EvtNombre, EvtAfectaSaldo, EvtGeneraDeuda, EvtAplicaRecurso, EvtActivo
        FROM Cont_EventosContables
        WHERE EvtCodigo IN ('COBRO_CTA', 'ORDEN', 'PAGO', 'ENTREGA')
        ORDER BY EvtCodigo
    `);
    console.log('\n=== EVENTOS CONTABLES ===');
    evts.recordset.forEach(r => console.log(JSON.stringify(r)));

    // Ver las reglas de asiento para COBRO_CTA
    const reglas = await pool.request().query(`
        SELECT ra.EvtCodigo, ra.RAsOrden, ra.RAsDebeHaber, ra.RAsImporte, ra.RAsEsIVA,
               cp.CueNombre, cp.CueCodigo
        FROM Cont_ReglasAsiento ra
        LEFT JOIN Cont_PlanCuentas cp ON cp.CueCodigo = ra.CueCodigo
        WHERE ra.EvtCodigo IN ('COBRO_CTA', 'ORDEN')
        ORDER BY ra.EvtCodigo, ra.RAsOrden
    `);
    console.log('\n=== REGLAS DE ASIENTO ===');
    reglas.recordset.forEach(r => console.log(JSON.stringify(r)));

    process.exit(0);
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
