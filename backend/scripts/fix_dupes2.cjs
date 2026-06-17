const { getPool, sql } = require('../config/db');
getPool().then(async p => {
  // Eliminar las 2 ENTREGAs duplicadas de DF-195 (2654 y 2655)
  // Mantener la primera: 2648
  const toDelete = [2654, 2655];
  const metrosARevertir = 0.30 * 2; // 0.60 metros

  // Saldo actual MTS cuenta 524
  const sRes = await p.request().query('SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = 524');
  const saldoActual = Number(sRes.recordset[0].CueSaldoActual);
  const saldoNuevo = Math.round((saldoActual + metrosARevertir) * 10000) / 10000;
  console.log('Saldo MTS actual:', saldoActual, '-> nuevo:', saldoNuevo);

  for (const id of toDelete) {
    await p.request().input('Id', sql.Int, id).query('DELETE FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @Id');
    console.log('Eliminado:', id);
  }

  await p.request()
    .input('S', sql.Decimal(18,4), saldoNuevo)
    .query('UPDATE dbo.CuentasCliente SET CueSaldoActual = @S WHERE CueIdCuenta = 524');
  console.log('Saldo MTS actualizado OK');

  // Actualizar PlaCantidadUsada
  const planRes = await p.request().query('SELECT PlaCantidadUsada FROM dbo.PlanesMetros WHERE PlaIdPlan = 1');
  const usadaActual = Number(planRes.recordset[0].PlaCantidadUsada);
  const usadaNueva = Math.round((usadaActual - metrosARevertir) * 10000) / 10000;
  console.log('PlaCantidadUsada:', usadaActual, '-> nueva:', usadaNueva);

  await p.request()
    .input('U', sql.Decimal(18,4), usadaNueva)
    .query('UPDATE dbo.PlanesMetros SET PlaCantidadUsada = @U WHERE PlaIdPlan = 1');
  console.log('Plan actualizado OK');

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
