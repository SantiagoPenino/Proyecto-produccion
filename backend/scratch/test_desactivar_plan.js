const { getPool, sql } = require('../config/db');

async function main() {
  let pool;
  try {
    pool = await getPool();
    console.log('Inserting a dummy plan to test deactivation...');

    // 1. Create a dummy client account of type meters or resources if needed,
    // or just insert a plan with random values since we don't enforce foreign keys on client for this check
    // Wait, let's find an existing CueIdCuenta and CliIdCliente from CuentasCliente or use dummy ones
    const accountsRes = await pool.request().query('SELECT TOP 1 CueIdCuenta, CliIdCliente, ProIdProducto FROM dbo.CuentasCliente');
    if (accountsRes.recordset.length === 0) {
      console.log('No client accounts found, cannot test.');
      process.exit(1);
    }
    const acc = accountsRes.recordset[0];

    const insertRes = await pool.request()
      .input('Cli', sql.Int, acc.CliIdCliente)
      .input('Cue', sql.Int, acc.CueIdCuenta)
      .input('Pro', sql.Int, acc.ProIdProducto || 1)
      .query(`
        INSERT INTO dbo.PlanesMetros (
          CliIdCliente, CueIdCuenta, ProIdProducto, PlaDescripcion,
          PlaCantidadTotal, PlaCantidadUsada, PlaPrecioUnitario, MonIdMoneda,
          PlaFechaInicio, PlaFechaVencimiento, PlaActivo, PlaObservaciones,
          PlaFechaAlta, PlaUsuarioAlta
        ) VALUES (
          @Cli, @Cue, @Pro, 'Dummy Test Plan',
          100.0, 10.0, 1.5, 1,
          GETDATE(), NULL, 1, 'Dummy observaciones',
          GETDATE(), 1
        );
        SELECT SCOPE_IDENTITY() AS PlaIdPlan;
      `);

    const plaId = insertRes.recordset[0].PlaIdPlan;
    console.log(`Dummy plan created with PlaIdPlan = ${plaId}. Testing UPDATE...`);

    // 2. Run the update query that previously crashed
    await pool.request()
      .input('PlaIdPlan',    sql.Int, plaId)
      .input('UsuarioBaja',  sql.Int, 999)
      .query(`
        UPDATE dbo.PlanesMetros 
        SET PlaActivo = 0, PlaFechaBaja = GETDATE(), PlaUsuarioBaja = @UsuarioBaja 
        WHERE PlaIdPlan = @PlaIdPlan
      `);

    console.log('Update query succeeded!');

    // 3. Verify values were updated
    const verifyRes = await pool.request()
      .input('PlaIdPlan', sql.Int, plaId)
      .query('SELECT PlaActivo, PlaFechaBaja, PlaUsuarioBaja FROM dbo.PlanesMetros WHERE PlaIdPlan = @PlaIdPlan');
    
    const row = verifyRes.recordset[0];
    console.log('Plan data after update:', row);

    if (row.PlaActivo === false && row.PlaFechaBaja && row.PlaUsuarioBaja === 999) {
      console.log('✅ Plan deactivation verification PASSED!');
    } else {
      console.error('❌ Plan deactivation verification FAILED: values mismatched');
    }

    // 4. Clean up
    await pool.request().input('PlaIdPlan', sql.Int, plaId).query('DELETE FROM dbo.PlanesMetros WHERE PlaIdPlan = @PlaIdPlan');
    console.log('Dummy plan cleaned up.');
    process.exit(0);
  } catch (err) {
    console.error('Error running test:', err);
    process.exit(1);
  }
}

main();
