// SOLO LECTURA — diagnóstico completo del desfasaje de UN cliente (para corregir de a uno).
// Uso:  node scripts/diagnostico_cliente.js <IDCliente>
//   ej: node scripts/diagnostico_cliente.js capa
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));
const ID = process.argv[2];
if (!ID) { console.error('Falta el IDCliente. Uso: node scripts/diagnostico_cliente.js <IDCliente>'); process.exit(1); }
const m = n => Number(n||0).toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2});

(async () => {
  try {
    const pool = await getPool();
    const cliR = await pool.request().input('id', sql.VarChar(50), ID).query(
      `SELECT TOP 1 CliIdCliente, RTRIM(IDCliente) AS IDCliente, RTRIM(NombreFantasia) AS Nombre FROM dbo.Clientes WHERE RTRIM(IDCliente)=@id`);
    if (!cliR.recordset.length) { console.error('Cliente no encontrado: '+ID); process.exit(1); }
    const cli = cliR.recordset[0];
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`  DIAGNÓSTICO — ${cli.IDCliente} (CliId ${cli.CliIdCliente})  ${cli.Nombre}`);
    console.log('══════════════════════════════════════════════════════════════');

    // 1) Cuentas: saldo actual (ledger) vs saldo si-la-factura-manda
    console.log('\n1) CUENTAS — saldo actual (ledger) vs saldo corregido (la factura manda)');
    const cu = await pool.request().input('c', sql.Int, cli.CliIdCliente).query(`
      SELECT cc.CueIdCuenta, RTRIM(cc.CueTipo) AS Tipo,
        CAST(ISNULL((SELECT SUM(mm.MovImporte) FROM dbo.MovimientosCuenta mm
             WHERE mm.CueIdCuenta=cc.CueIdCuenta AND (mm.MovAnulado IS NULL OR mm.MovAnulado=0)
               AND mm.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),0) AS DECIMAL(18,2)) AS SaldoActual,
        CAST(ISNULL((SELECT SUM(CASE
               WHEN mm.MovTipo IN ('CIERRE_CICLO','VTA_CAJA') AND mm.MovImporte<>0 AND dc.DocIdDocumento IS NOT NULL
                    AND ISNULL(dc.MonIdMoneda,cc2.MonIdMoneda)=cc2.MonIdMoneda
                    AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
                    AND ABS(ABS(mm.MovImporte)-dc.DocTotal)>0.01
               THEN -dc.DocTotal
               ELSE mm.MovImporte END)
             FROM dbo.MovimientosCuenta mm
             LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento=mm.DocIdDocumento
             JOIN dbo.CuentasCliente cc2 ON cc2.CueIdCuenta=mm.CueIdCuenta
             WHERE mm.CueIdCuenta=cc.CueIdCuenta AND (mm.MovAnulado IS NULL OR mm.MovAnulado=0)
               AND mm.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),0) AS DECIMAL(18,2)) AS SaldoCorregido
      FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente=@c AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD') ORDER BY Tipo`);
    console.table(cu.recordset);

    // 2) Desfasajes (ledger vs factura) por documento
    console.log('\n2) DESFASAJES — línea de facturación (ledger) vs factura (DocTotal)');
    const desf = await pool.request().input('c', sql.Int, cli.CliIdCliente).query(`
      SELECT RTRIM(doc.DocSerie)+'-'+RTRIM(CAST(doc.DocNumero AS VARCHAR)) AS Comprobante, m.MovTipo, m.MovIdMovimiento AS MovId,
             CAST(m.MovImporte AS DECIMAL(18,2)) AS LedgerAhora, CAST(-doc.DocTotal AS DECIMAL(18,2)) AS Correccion,
             CAST(doc.DocTotal AS DECIMAL(18,2)) AS DocTotal,
             CAST(ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=doc.DocIdDocumento),0) AS DECIMAL(18,2)) AS SumaLineas,
             CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=doc.DocIdDocumento)
                    OR ABS(doc.DocTotal-ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento=doc.DocIdDocumento),0))>0.05
                  THEN 'C' WHEN ABS(m.MovImporte)-doc.DocTotal>0 THEN 'A' ELSE 'B' END AS Variante,
             (SELECT COUNT(*) FROM dbo.MovimientosCuenta m2 WHERE m2.DocIdDocumento=doc.DocIdDocumento
                AND m2.MovTipo IN ('CIERRE_CICLO','VTA_CAJA') AND (m2.MovAnulado IS NULL OR m2.MovAnulado=0) AND m2.MovImporte<>0) AS NLineas
      FROM dbo.MovimientosCuenta m
      JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento=m.DocIdDocumento
      JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta=m.CueIdCuenta
      WHERE cc.CliIdCliente=@c AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
        AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovImporte<>0
        AND (doc.DocEstado IS NULL OR doc.DocEstado NOT LIKE '%ANULAD%')
        AND ISNULL(doc.MonIdMoneda,cc.MonIdMoneda)=cc.MonIdMoneda
        AND ABS(ABS(m.MovImporte)-doc.DocTotal)>0.01
      ORDER BY Variante, Comprobante`);
    console.table(desf.recordset);
    const hayC = desf.recordset.some(x=>x.Variante==='C');
    const hayMulti = desf.recordset.some(x=>x.NLineas>1);

    // 3) DeudaDocumento duplicadas (afecta el cobro)
    console.log('\n3) DeudaDocumento DUPLICADAS (una fila por documento con >1 viva)');
    const dd = await pool.request().input('c', sql.Int, cli.CliIdCliente).query(`
      WITH dup AS (SELECT d.DocIdDocumento FROM dbo.DeudaDocumento d
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta=d.CueIdCuenta
        WHERE cc.CliIdCliente=@c AND d.DocIdDocumento IS NOT NULL
          AND d.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND d.DDeImportePendiente>0.01
        GROUP BY d.DocIdDocumento HAVING COUNT(*)>1)
      SELECT RTRIM(doc.DocSerie)+'-'+RTRIM(CAST(doc.DocNumero AS VARCHAR)) AS Comprobante,
             d.DDeIdDocumento AS DDeId, d.DDeEstado,
             CAST(d.DDeImporteOriginal AS DECIMAL(18,2)) AS Orig, CAST(d.DDeImportePendiente AS DECIMAL(18,2)) AS Pend,
             CAST(doc.DocTotal AS DECIMAL(18,2)) AS DocTotal,
             CASE WHEN ABS(d.DDeImporteOriginal-doc.DocTotal)<=2 THEN 'CONSERVA (=factura)' ELSE 'CANCELAR (fantasma)' END AS Accion
      FROM dbo.DeudaDocumento d JOIN dup ON dup.DocIdDocumento=d.DocIdDocumento
      JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento=d.DocIdDocumento
      WHERE d.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND d.DDeImportePendiente>0.01
      ORDER BY Comprobante, d.DDeIdDocumento`);
    if (dd.recordset.length) console.table(dd.recordset); else console.log('   (ninguna)');

    // 4) Órdenes en limbo (anuladas/huérfanas)
    console.log('\n4) ÓRDENES EN LIMBO (anuladas, sin documento)');
    const lim = await pool.request().input('c', sql.Int, cli.CliIdCliente).query(`
      SELECT m.MovIdMovimiento AS MovId, ISNULL(mo.MonSimbolo,'?') AS Mon, CAST(ABS(m.MovImporte) AS DECIMAL(18,2)) AS Importe,
             m.CicIdCiclo AS Ciclo, CONVERT(varchar(10),m.MovFecha,23) AS Fecha, LEFT(LTRIM(RTRIM(m.MovConcepto)),34) AS Concepto
      FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta=m.CueIdCuenta
      LEFT JOIN dbo.Monedas mo ON mo.MonIdMoneda=cc.MonIdMoneda
      WHERE cc.CliIdCliente=@c AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.MovAnulado=1
      ORDER BY m.MovIdMovimiento DESC`);
    if (lim.recordset.length) console.table(lim.recordset); else console.log('   (ninguna)');

    // 5) Recomendación
    console.log('\n5) RECOMENDACIÓN');
    if (hayMulti) console.log('   ⚠ Hay documentos con >1 línea de facturación → el fix por-cliente los SALTEA. Revisar a mano.');
    if (hayC) console.log('   ⚠ Hay variante C (factura inconsistente: DocTotal ≠ suma de líneas) → DECIDIR/RE-FACTURAR antes. -DocTotal puede estar mal.');
    if (!hayC) console.log(`   ✓ Solo A/B (factura consistente) → seguro: fix_saldo_por_cliente.sql con @IDCliente = '${cli.IDCliente}'`);
    console.log(`\n   Pasos: 1) fix_saldo_por_cliente.sql @IDCliente='${cli.IDCliente}' (ROLLBACK→revisar→COMMIT).`);
    console.log('          2) (opcional) cancelar la fila DeudaDocumento marcada CANCELAR arriba.');
    console.log('══════════════════════════════════════════════════════════════\n');
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
