'use strict';

/**
 * fix-entregas-mal-tipadas.js
 * ---------------------------------------------------------------------------
 * Corrige movimientos que son CONSUMOS / ENTREGAS sobre cuentas de RECURSO
 * (MTS / KG, es decir CuentasCliente.ProIdProducto IS NOT NULL) pero que
 * quedaron registrados con MovTipo = 'ORDEN' / 'ORDEN_ANTICIPO'.
 *
 * Origen del bug: la ruta POST /contabilidad/ordenes/insertar-manual
 * ("Nueva orden" del panel de planes) insertaba 'ORDEN' en vez de 'ENTREGA'
 * (corregido en commit afe2d3e). Esos movimientos antiguos descuentan bien el
 * saldo, pero el reporte/PDF los oculta porque trata 'ORDEN' como no visible
 * (se consolida en ciclo). Reclasificarlos a 'ENTREGA' NO cambia ningún saldo;
 * solo los vuelve visibles en el estado de cuenta.
 *
 * Seguridad:
 *   - Dry-run por defecto: muestra qué tocaría y NO escribe nada.
 *   - Solo aplica con la bandera  --apply
 *   - Solo toca movimientos en cuentas de recurso, no anulados, SIN documento
 *     contable (DocIdDocumento NULL) y SIN ciclo (CicIdCiclo NULL) — que es la
 *     firma exacta de los insertados a mano. Así nunca altera órdenes que estén
 *     legítimamente consolidadas en un ciclo/documento.
 *   - Todo dentro de una transacción.
 *
 * Uso:
 *   node backend/scripts/fix-entregas-mal-tipadas.js            # dry-run (preview)
 *   node backend/scripts/fix-entregas-mal-tipadas.js --apply    # aplica los cambios
 *   node backend/scripts/fix-entregas-mal-tipadas.js --apply --cli 709   # limitar a un cliente
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
const cliIdx = process.argv.indexOf('--cli');
const CLI_FILTER = cliIdx !== -1 ? parseInt(process.argv[cliIdx + 1], 10) : null;

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: (process.env.DB_USER || '').trim(),
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  // Condición que define un "ORDEN que en realidad es una ENTREGA de recurso"
  const WHERE = `
        cc.ProIdProducto IS NOT NULL                 -- cuenta de recurso (MTS/KG)
    AND m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND m.DocIdDocumento IS NULL                     -- no atado a documento
    AND m.CicIdCiclo IS NULL                         -- no consolidado en ciclo
    ${CLI_FILTER ? 'AND cc.CliIdCliente = @Cli' : ''}
  `;

  const mkReq = () => {
    const r = pool.request();
    if (CLI_FILTER) r.input('Cli', sql.Int, CLI_FILTER);
    return r;
  };

  // 1. Preview
  const preview = await mkReq().query(`
    SELECT m.MovIdMovimiento AS Id, m.CueIdCuenta AS Cue, cc.CueTipo, cc.CliIdCliente AS Cli,
           m.MovTipo AS TipoActual, m.MovImporte AS Imp,
           CONVERT(varchar(19), m.MovFecha, 120) AS Fecha,
           LEFT(m.MovConcepto, 45) AS Concepto
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE ${WHERE}
    ORDER BY m.MovFecha DESC
  `);

  console.log(`\n=== Candidatos a reclasificar ORDEN -> ENTREGA (${preview.recordset.length}) ===`);
  if (CLI_FILTER) console.log(`(filtrado por cliente ${CLI_FILTER})`);
  if (preview.recordset.length === 0) {
    console.log('No hay movimientos para corregir. Nada que hacer.');
    await pool.close();
    return;
  }
  console.table(preview.recordset);

  if (!APPLY) {
    console.log('\n*** DRY-RUN: no se escribió nada. Volvé a correr con  --apply  para aplicar. ***\n');
    await pool.close();
    return;
  }

  // 2. Aplicar dentro de una transacción
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const upReq = new sql.Request(tx);
    if (CLI_FILTER) upReq.input('Cli', sql.Int, CLI_FILTER);
    const res = await upReq.query(`
      UPDATE m
      SET m.MovTipo = 'ENTREGA'
      FROM dbo.MovimientosCuenta m
      JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
      WHERE ${WHERE}
    `);
    await tx.commit();
    console.log(`\n*** APLICADO: ${res.rowsAffected[0]} movimiento(s) reclasificado(s) a 'ENTREGA'. ***`);
    console.log('Los saldos NO cambian; ahora aparecen en el estado de cuenta / PDF.\n');
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  await pool.close();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
