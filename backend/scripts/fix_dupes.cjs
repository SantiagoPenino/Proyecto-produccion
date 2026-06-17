const { getPool, sql } = require('../config/db');
getPool().then(async p => {
  // Eliminar ENTREGAs duplicadas — mantener solo la primera de cada orden (menor MovIdMovimiento)
  // DF-195: 4 registros, mantener el más viejo
  const deleteIds = [2649, 2650, 2651, 2652, 2653]; // los duplicados (dejar los originales que son los más antiguos)
  
  // Primero ver qué ENTREGAs son legítimas (las más antiguas de cada grupo)
  // DF-195 legítimo: primero de los 4 = no lo tenemos, hay que ver cuál es el original
  // 2648, 2649, 2650, 2651 = DF-195 (4 copias, dejar solo la PRIMERA creada = 2648)
  // 2652, 2653 = DTF-439 (2 copias, dejar solo la PRIMERA = 2652)
  
  // Por lo tanto eliminar: 2649, 2650, 2651 (DF-195 extras) y 2653 (DTF-439 extra)
  const toDelete = [2649, 2650, 2651, 2653];
  
  // Calcular impacto total en saldo a revertir
  // Cada DF-195 extra = -0.30 MTS x3 = -0.90
  // DTF-439 extra = -0.57 MTS x1 = -0.57
  // Total metros a revertir: +1.47 en cuenta MTS 524
  const totalRevertir = (0.30 * 3) + 0.57;
  console.log('Metros a revertir:', totalRevertir);
  
  // Obtener saldo actual cuenta MTS 524
  const sRes = await p.request().query('SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = 524');
  const saldoActual = Number(sRes.recordset[0].CueSaldoActual);
  const saldoNuevo = Math.round((saldoActual + totalRevertir) * 10000) / 10000;
  console.log('Saldo MTS actual:', saldoActual, '-> nuevo:', saldoNuevo);
  
  // Eliminar duplicados
  for (const id of toDelete) {
    await p.request().input('Id', sql.Int, id).query('DELETE FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @Id');
    console.log('Eliminado MovId:', id);
  }
  
  // Revertir saldo
  await p.request()
    .input('S', sql.Decimal(18,4), saldoNuevo)
    .query('UPDATE dbo.CuentasCliente SET CueSaldoActual = @S WHERE CueIdCuenta = 524');
  console.log('Saldo revertido OK');
  
  // También actualizar PlaCantidadUsada del plan 1 (restar los metros duplicados)
  const planRes = await p.request().query('SELECT PlaCantidadUsada FROM dbo.PlanesMetros WHERE PlaIdPlan = 1');
  const usadaActual = Number(planRes.recordset[0].PlaCantidadUsada);
  const usadaNueva = Math.round((usadaActual - totalRevertir) * 10000) / 10000;
  console.log('PlaCantidadUsada:', usadaActual, '-> nueva:', usadaNueva);
  
  await p.request()
    .input('U', sql.Decimal(18,4), usadaNueva)
    .query('UPDATE dbo.PlanesMetros SET PlaCantidadUsada = @U, PlaActivo = 1 WHERE PlaIdPlan = 1');
  console.log('Plan actualizado OK');
  
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
