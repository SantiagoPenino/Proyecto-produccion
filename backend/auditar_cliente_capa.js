/**
 * auditar_cliente_854.js
 * 
 * Script de Auditoría, Snapshot y Reversión para el cliente CAPA Indumentaria Deportiva (ID 854)
 * 
 * Uso desde la carpeta "backend":
 *   1) Ver estado actual:
 *        node auditar_cliente_854.js --ver
 * 
 *   2) Tomar una "foto" (backup) antes de tocar la interfaz:
 *        node auditar_cliente_854.js --snapshot
 * 
 *   3) Revertir todo si lo que hiciste no te convence:
 *        node auditar_cliente_854.js --revertir <nombre_del_archivo_snapshot.json>
 */

'use strict';
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { getPool, sql } = require('./config/db');

const CLIENTE_ID = 854;

const fmtUY = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function obtenerEstadoActual(pool) {
  // 1. Cliente
  const cliRes = await pool.request()
    .input('CliId', sql.Int, CLIENTE_ID)
    .query(`
      SELECT CliIdCliente, Nombre, CodCliente, CioRuc, Email, TelefonoTrabajo
      FROM dbo.Clientes WITH(NOLOCK)
      WHERE CliIdCliente = @CliId OR CodCliente = @CliId
    `);
  const cliente = cliRes.recordset[0] || null;

  // 2. Cuentas de Dinero y Recursos
  const ctasRes = await pool.request()
    .input('CliId', sql.Int, CLIENTE_ID)
    .query(`
      SELECT CueIdCuenta, CueNombre, CueTipo, MonIdMoneda, CueSaldoActual, CueEsPrincipal, CueActiva, CueFechaAlta
      FROM dbo.CuentasCliente WITH(NOLOCK)
      WHERE CliIdCliente = @CliId
      ORDER BY CueEsPrincipal DESC, CueIdCuenta ASC
    `);

  const cueIds = ctasRes.recordset.map(c => c.CueIdCuenta);
  const cueIdsList = cueIds.length ? cueIds.join(',') : '0';

  // 3. Deudas Vivas (Pendientes / Parciales / Vencidas)
  const deudasRes = await pool.request()
    .input('CliId', sql.Int, CLIENTE_ID)
    .query(`
      SELECT dd.DDeIdDocumento, dd.CueIdCuenta, dd.DocIdDocumento, dd.OrdIdOrden,
             dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeFechaEmision,
             dd.DDeFechaVencimiento, dd.DDeEstado,
             dc.DocTipo, dc.DocSerie, dc.DocNumero,
             od.OrdCodigoOrden, od.OrdNombreTrabajo
      FROM dbo.DeudaDocumento dd WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = dd.CueIdCuenta
      LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = dd.DocIdDocumento
      LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = dd.OrdIdOrden
      WHERE cc.CliIdCliente = @CliId
      ORDER BY dd.DDeIdDocumento DESC
    `);

  // 4. Últimos Movimientos
  const movsRes = await pool.request()
    .query(`
      SELECT TOP 20 m.MovIdMovimiento, m.CueIdCuenta, m.MovFecha, m.MovTipo,
             m.MovImporte, ISNULL(m.MovSaldoPosterior, 0) AS MovSaldoPosterior, m.MovConcepto, m.DocIdDocumento, m.PagIdPago, m.MovAnulado
      FROM dbo.MovimientosCuenta m WITH(NOLOCK)
      WHERE m.CueIdCuenta IN (${cueIdsList})
      ORDER BY m.MovIdMovimiento DESC
    `);

  // 5. Imputaciones de pagos
  const impRes = await pool.request()
    .query(`
      SELECT TOP 20 ip.ImpIdImputacion, ip.PagIdPago, ip.DDeIdDocumento, ip.ImpImporte, ip.ImpFecha
      FROM dbo.ImputacionPago ip WITH(NOLOCK)
      JOIN dbo.DeudaDocumento dd WITH(NOLOCK) ON dd.DDeIdDocumento = ip.DDeIdDocumento
      WHERE dd.CueIdCuenta IN (${cueIdsList})
      ORDER BY ip.ImpIdImputacion DESC
    `);

  // 6. Max IDs en el sistema para detectar adiciones
  const maxMovRes = await pool.request().query(`SELECT ISNULL(MAX(MovIdMovimiento), 0) AS maxMov FROM dbo.MovimientosCuenta WHERE CueIdCuenta IN (${cueIdsList})`);
  const maxPagRes = await pool.request().query(`SELECT ISNULL(MAX(PagIdPago), 0) AS maxPag FROM dbo.Pagos`);
  const maxImpRes = await pool.request().query(`SELECT ISNULL(MAX(ImpIdImputacion), 0) AS maxImp FROM dbo.ImputacionPago ip JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento WHERE dd.CueIdCuenta IN (${cueIdsList})`);
  const maxDocRes = await pool.request().query(`SELECT ISNULL(MAX(DocIdDocumento), 0) AS maxDoc FROM dbo.DocumentosContables WHERE CliIdCliente = ${CLIENTE_ID}`);
  const maxDdeRes = await pool.request().query(`SELECT ISNULL(MAX(DDeIdDocumento), 0) AS maxDde FROM dbo.DeudaDocumento dd JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta WHERE cc.CliIdCliente = ${CLIENTE_ID}`);

  return {
    cliente,
    cuentas: ctasRes.recordset,
    deudas: deudasRes.recordset,
    movimientos: movsRes.recordset,
    imputaciones: impRes.recordset,
    maxIds: {
      maxMov: maxMovRes.recordset[0]?.maxMov || 0,
      maxPag: maxPagRes.recordset[0]?.maxPag || 0,
      maxImp: maxImpRes.recordset[0]?.maxImp || 0,
      maxDoc: maxDocRes.recordset[0]?.maxDoc || 0,
      maxDde: maxDdeRes.recordset[0]?.maxDde || 0,
    }
  };
}

async function comandoVer(pool) {
  const data = await obtenerEstadoActual(pool);
  if (!data.cliente) {
    console.log(`❌ No se encontró cliente con ID ${CLIENTE_ID}`);
    return;
  }

  console.log(`\n================================================================`);
  console.log(`📋 AUDITORÍA CONTABLE: ${data.cliente.Nombre} (ID ${data.cliente.CliIdCliente})`);
  console.log(`   RUT/CI: ${data.cliente.CioRuc || '—'} | Tel: ${data.cliente.TelefonoTrabajo || '—'}`);
  console.log(`================================================================`);

  console.log(`\n💳 CUENTAS Y SALDOS:`);
  console.table(data.cuentas.map(c => ({
    CueId: c.CueIdCuenta,
    Tipo: c.CueTipo,
    Moneda: c.MonIdMoneda === 2 ? 'USD' : 'UYU',
    Principal: c.CueEsPrincipal ? 'SÍ' : 'NO',
    'Saldo Actual': `${c.MonIdMoneda === 2 ? 'US$' : '$'} ${fmtUY(c.CueSaldoActual)}`,
    Activa: c.CueActiva ? 'SÍ' : 'NO'
  })));

  console.log(`\n📑 DOCUMENTOS DE DEUDA VIVA:`);
  if (!data.deudas.length) {
    console.log(`   (No hay documentos con deuda registrados)`);
  } else {
    console.table(data.deudas.map(d => ({
      DDeId: d.DDeIdDocumento,
      Comprobante: d.DocTipo ? `${d.DocTipo} ${d.DocSerie}-${d.DocNumero}` : (d.OrdCodigoOrden || `Orden #${d.OrdIdOrden}`),
      Emisión: d.DDeFechaEmision ? d.DDeFechaEmision.toISOString().slice(0, 10) : '—',
      'Importe Orig': fmtUY(d.DDeImporteOriginal),
      'Pendiente': fmtUY(d.DDeImportePendiente),
      Estado: d.DDeEstado
    })));
  }

  console.log(`\n🕒 ÚLTIMOS 10 MOVIMIENTOS CONTABLES:`);
  console.table(data.movimientos.slice(0, 10).map(m => ({
    MovId: m.MovIdMovimiento,
    Fecha: m.MovFecha ? m.MovFecha.toISOString().slice(0, 16).replace('T', ' ') : '—',
    Tipo: m.MovTipo,
    Importe: fmtUY(m.MovImporte),
    Saldo: fmtUY(m.MovSaldoPosterior),
    Concepto: (m.MovConcepto || '').slice(0, 40),
    Anulado: m.MovAnulado ? 'SÍ' : 'NO'
  })));
  console.log(`\n----------------------------------------------------------------`);
}

async function comandoSnapshot(pool) {
  const data = await obtenerEstadoActual(pool);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const filename = `snapshot_cliente_${CLIENTE_ID}_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
  const filePath = path.join(__dirname, filename);

  const snapshotData = {
    generadoEl: now.toISOString(),
    clienteId: CLIENTE_ID,
    clienteNombre: data.cliente?.Nombre,
    maxIds: data.maxIds,
    cuentas: data.cuentas.map(c => ({
      CueIdCuenta: c.CueIdCuenta,
      CueSaldoActual: Number(c.CueSaldoActual)
    })),
    deudas: data.deudas.map(d => ({
      DDeIdDocumento: d.DDeIdDocumento,
      DDeImporteOriginal: Number(d.DDeImporteOriginal),
      DDeImportePendiente: Number(d.DDeImportePendiente),
      DDeEstado: d.DDeEstado
    }))
  };

  fs.writeFileSync(filePath, JSON.stringify(snapshotData, null, 2), 'utf8');

  console.log(`\n================================================================`);
  console.log(`📸 SNAPSHOT CREADO CON ÉXITO`);
  console.log(`   Archivo guardado: ${filename}`);
  console.log(`   Ruta completa:    ${filePath}`);
  console.log(`\n   Saldos respaldados:`);
  data.cuentas.forEach(c => {
    console.log(`     - Cuenta #${c.CueIdCuenta} (${c.CueTipo}): $ ${fmtUY(c.CueSaldoActual)}`);
  });
  console.log(`   Deudas vivas respaldadas: ${data.deudas.length}`);
  console.log(`================================================================\n`);
  console.log(`💡 Si hacés cualquier prueba en la pantalla y querés volver atrás, ejecutá:`);
  console.log(`   node auditar_cliente_854.js --revertir ${filename}\n`);
}

async function comandoRevertir(pool, snapshotFile) {
  if (!snapshotFile) {
    console.error(`❌ Debe especificar el archivo de snapshot a restaurar.`);
    console.log(`   Ejemplo: node auditar_cliente_854.js --revertir snapshot_cliente_854_2026...json`);
    return;
  }

  const filePath = path.isAbsolute(snapshotFile) ? snapshotFile : path.join(__dirname, snapshotFile);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ El archivo de snapshot no existe: ${filePath}`);
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const snapshot = JSON.parse(raw);

  console.log(`\n================================================================`);
  console.log(`⚠️  INICIANDO REVERSIÓN A SNAPSHOT DEL: ${snapshot.generadoEl}`);
  console.log(`   Cliente: ${snapshot.clienteNombre} (ID ${snapshot.clienteId})`);
  console.log(`================================================================`);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const cueIds = snapshot.cuentas.map(c => c.CueIdCuenta).join(',');

    // 1. Anular / eliminar movimientos posteriores al snapshot en las cuentas del cliente
    const delMovs = await new sql.Request(transaction)
      .query(`
        DELETE FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta IN (${cueIds})
          AND MovIdMovimiento > ${snapshot.maxIds.maxMov}
      `);
    console.log(`   ✓ Movimientos posteriores eliminados: ${delMovs.rowsAffected[0] || 0}`);

    // 2. Eliminar imputaciones posteriores
    const delImp = await new sql.Request(transaction)
      .query(`
        DELETE FROM dbo.ImputacionPago
        WHERE ImpIdImputacion > ${snapshot.maxIds.maxImp}
      `);
    console.log(`   ✓ Imputaciones posteriores eliminadas: ${delImp.rowsAffected[0] || 0}`);

    // 3. Eliminar pagos posteriores del cliente si se crearon en la prueba
    const delPag = await new sql.Request(transaction)
      .query(`
        DELETE FROM dbo.Pagos
        WHERE PagIdPago > ${snapshot.maxIds.maxPag}
          AND CliIdCliente = ${CLIENTE_ID}
      `);
    console.log(`   ✓ Pagos de prueba eliminados: ${delPag.rowsAffected[0] || 0}`);

    // 4. Eliminar deudas vivas nuevas creadas después del snapshot
    const delDde = await new sql.Request(transaction)
      .query(`
        DELETE FROM dbo.DeudaDocumento
        WHERE DDeIdDocumento > ${snapshot.maxIds.maxDde}
          AND CueIdCuenta IN (${cueIds})
      `);
    console.log(`   ✓ Deudas nuevas creadas en la prueba eliminadas: ${delDde.rowsAffected[0] || 0}`);

    // 5. Restaurar saldos exactos de CuentasCliente
    for (const cta of snapshot.cuentas) {
      await new sql.Request(transaction)
        .input('CueId', sql.Int, cta.CueIdCuenta)
        .input('Saldo', sql.Decimal(18, 4), cta.CueSaldoActual)
        .query(`
          UPDATE dbo.CuentasCliente
          SET CueSaldoActual = @Saldo
          WHERE CueIdCuenta = @CueId
        `);
      console.log(`   ✓ Saldo Cuenta #${cta.CueIdCuenta} restaurado a: $ ${fmtUY(cta.CueSaldoActual)}`);
    }

    // 6. Restaurar deudas vivas a su importe pendiente y estado previo
    for (const dde of snapshot.deudas) {
      await new sql.Request(transaction)
        .input('DDeId', sql.Int, dde.DDeIdDocumento)
        .input('Pend', sql.Decimal(18, 4), dde.DDeImportePendiente)
        .input('Estado', sql.VarChar(20), dde.DDeEstado)
        .query(`
          UPDATE dbo.DeudaDocumento
          SET DDeImportePendiente = @Pend,
              DDeEstado = @Estado
          WHERE DDeIdDocumento = @DDeId
        `);
      console.log(`   ✓ Deuda #${dde.DDeIdDocumento} restaurada a pendiente: $ ${fmtUY(dde.DDeImportePendiente)} (${dde.DDeEstado})`);
    }

    await transaction.commit();
    console.log(`\n🎉 REVERSIÓN COMPLETADA EXITOSAMENTE.`);
    console.log(`   El cliente volvió exactamente al estado que tenía cuando tomaste el snapshot.`);
    console.log(`================================================================\n`);
  } catch (err) {
    await transaction.rollback();
    console.error(`\n❌ ERROR DURANTE LA REVERSIÓN (se cancelaron todos los cambios):`, err.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const pool = await getPool();

  try {
    if (args.includes('--snapshot')) {
      await comandoSnapshot(pool);
    } else if (args.includes('--revertir')) {
      const idx = args.indexOf('--revertir');
      const snapFile = args[idx + 1];
      await comandoRevertir(pool, snapFile);
    } else {
      await comandoVer(pool);
    }
  } catch (err) {
    console.error('Error ejecutando script:', err);
  } finally {
    process.exit(0);
  }
}

main();
