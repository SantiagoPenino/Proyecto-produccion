'use strict';
/**
 * fix-plan-articulos-no-cubiertos.js
 * ---------------------------------------------------------------------------
 * Subsana 3 clientes que recibieron un cobro monetario incorrecto porque
 * su orden DTF/UV no estaba en PlanesMetrosArticulosPermitidos, a pesar
 * de que el cliente tenía plan activo con saldo suficiente.
 *
 * Clientes afectados (confirmados — solo prefijo DTF↔UV):
 *   - Florencia Sklofsky  (6844): Plan #1  UV RIGIDOS + DTF-1986  $27.50 USD
 *   - Diseño Basico SRL   (1731): Plan #6  DTF COMUN  + DTF-1781  $6.82  USD
 *   - Valentina Rodríguez (1821): Plan #3  DTF COMUN  + DTF-1562  $12.76 USD
 *
 * Por cada caso el script:
 *   1. Agrega el producto faltante a PlanesMetrosArticulosPermitidos
 *   2. Anula el movimiento ORDEN (cobro monetario incorrecto) en la cuenta DINERO_*
 *   3. Ajusta CueSaldoActual de la cuenta monetaria (+importe revertido)
 *   4. Cancela la DeudaDocumento asociada a esa orden
 *   5. Crea un movimiento ENTREGA en la cuenta de recursos
 *   6. Actualiza PlaCantidadUsada en PlanesMetros
 *
 * Seguridad:
 *   - Dry-run por defecto: muestra qué haría, NO escribe nada.
 *   - Solo aplica con --apply
 *   - Todo dentro de una única transacción; si algo falla → rollback total.
 *   - Idempotente: verifica antes de cada paso para no duplicar.
 *
 * Uso:
 *   node backend/scripts/fix-plan-articulos-no-cubiertos.js           # dry-run
 *   node backend/scripts/fix-plan-articulos-no-cubiertos.js --apply   # aplica
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
const USR   = 1; // Usuario sistema para los movimientos generados

// ── Casos a corregir ──────────────────────────────────────────────────────────
// Los identificamos por código de orden para no hardcodear IDs que pueden variar
// entre entornos. El script resuelve todos los IDs en tiempo de ejecución.
const CASOS = [
  {
    label:        'Florencia Sklofsky',
    codigoOrden:  'DTF-1986',
    planId:       1,
    prodPlanDesc: 'UV (PARA RIGIDOS 0,27)',   // producto principal del plan
    prodOrdenDesc:'DTF textil COMUN',          // producto de la orden (el que falta agregar)
  },
  {
    label:        'Diseño Basico SRL',
    codigoOrden:  'DTF-1781',
    planId:       6,
    prodPlanDesc: 'DTF textil COMUN',
    prodOrdenDesc:'UV (PARA RIGIDOS 0,27)',
  },
  {
    label:        'Valentina Rodríguez',
    codigoOrden:  'DTF-1562',
    planId:       3,
    prodPlanDesc: 'DTF textil COMUN',
    prodOrdenDesc:'UV (PARA RIGIDOS 0,27)',
  },
];

// ─────────────────────────────────────────────────────────────────────────────

async function resolverCaso(pool, caso) {
  // 1. ProIdProducto del producto de la ORDEN (el que faltaba en articulosPermitidos)
  const artRes = await pool.request()
    .input('Desc', sql.NVarChar(500), caso.prodOrdenDesc)
    .query(`SELECT TOP 1 ProIdProducto FROM dbo.Articulos WHERE RTRIM(Descripcion) = @Desc`);
  if (!artRes.recordset.length) throw new Error(`Artículo no encontrado: "${caso.prodOrdenDesc}"`);
  const proIdOrden = artRes.recordset[0].ProIdProducto;

  // 2. Datos de la orden en OrdenesDeposito
  const ordRes = await pool.request()
    .input('Cod', sql.VarChar(50), caso.codigoOrden)
    .query(`
      SELECT OrdIdOrden, CliIdCliente, OrdCantidad, OrdCostoFinal, MonIdMoneda
      FROM   dbo.OrdenesDeposito WITH(NOLOCK)
      WHERE  OrdCodigoOrden = @Cod
    `);
  if (!ordRes.recordset.length) throw new Error(`Orden no encontrada: ${caso.codigoOrden}`);
  const ord = ordRes.recordset[0];

  // 3. Plan y su cuenta de recursos
  const planRes = await pool.request()
    .input('PlaIdPlan', sql.Int, caso.planId)
    .query(`
      SELECT pm.PlaIdPlan, pm.CueIdCuenta, pm.PlaCantidadUsada, pm.PlaCantidadTotal,
             pm.PlaActivo, cc.CliIdCliente
      FROM   dbo.PlanesMetros pm
      JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
      WHERE  pm.PlaIdPlan = @PlaIdPlan
    `);
  if (!planRes.recordset.length) throw new Error(`Plan #${caso.planId} no encontrado`);
  const plan = planRes.recordset[0];

  // 4. Movimiento ORDEN incorrecto en cuenta monetaria (DINERO_USD / DINERO_UYU)
  const movRes = await pool.request()
    .input('OrdId',  sql.Int, ord.OrdIdOrden)
    .input('CliId',  sql.Int, ord.CliIdCliente)
    .query(`
      SELECT mv.MovIdMovimiento, mv.CueIdCuenta, mv.MovImporte, mv.MovAnulado, cc.CueTipo
      FROM   dbo.MovimientosCuenta mv
      JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = mv.CueIdCuenta
      WHERE  mv.OrdIdOrden = @OrdId
        AND  cc.CliIdCliente = @CliId
        AND  cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
        AND  mv.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
        AND  (mv.MovAnulado IS NULL OR mv.MovAnulado = 0)
    `);

  // 5. DeudaDocumento pendiente de esa orden
  const ddRes = await pool.request()
    .input('OrdId', sql.Int, ord.OrdIdOrden)
    .query(`
      SELECT dd.DDeIdDocumento, dd.CueIdCuenta, dd.DDeImportePendiente, dd.DDeEstado
      FROM   dbo.DeudaDocumento dd
      WHERE  dd.OrdIdOrden = @OrdId
        AND  dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
    `);

  // 6. ¿Ya está en articulosPermitidos?
  const yapRes = await pool.request()
    .input('PlaIdPlan',    sql.Int, caso.planId)
    .input('ProIdProducto',sql.Int, proIdOrden)
    .query(`
      SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos
      WHERE PlaIdPlan = @PlaIdPlan AND ProIdProducto = @ProIdProducto
    `);
  const yaPermitido = yapRes.recordset.length > 0;

  // ── Resumen para el log ───────────────────────────────────────────────────
  const importeRevertir = movRes.recordset.length > 0
    ? Math.abs(movRes.recordset[0].MovImporte)
    : Math.abs(ord.OrdCostoFinal || 0);

  return {
    caso,
    proIdOrden,
    ord,
    plan,
    mov:         movRes.recordset[0] || null,
    deudas:      ddRes.recordset,
    yaPermitido,
    importeRevertir,
  };
}

async function main() {
  const pool = await sql.connect({
    server:   process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user:     (process.env.DB_USER || '').trim(),
    password: process.env.DB_PASSWORD,
    options:  { encrypt: false, trustServerCertificate: true },
  });

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  fix-plan-articulos-no-cubiertos — ' + (APPLY ? '⚠️  MODO APPLY' : 'DRY-RUN'));
  console.log('════════════════════════════════════════════════════════════\n');

  // ── Resolver todos los casos antes de tocar nada ──────────────────────────
  const resueltos = [];
  for (const caso of CASOS) {
    try {
      const r = await resolverCaso(pool, caso);
      resueltos.push(r);
    } catch (e) {
      console.error(`❌  ${caso.label}: ${e.message}`);
      process.exitCode = 1;
    }
  }

  // ── Mostrar plan de acción ────────────────────────────────────────────────
  for (const r of resueltos) {
    console.log(`\n── ${r.caso.label}  (Orden: ${r.caso.codigoOrden}) ─────────────────`);
    console.log(`   Plan #${r.caso.planId} · CueRecursos: ${r.plan.CueIdCuenta}`);
    console.log(`   Producto a agregar a articulosPermitidos: "${r.caso.prodOrdenDesc}" (ProId ${r.proIdOrden}) → ${r.yaPermitido ? '✅ ya existe, se omite' : '🔧 agregar'}`);
    if (r.mov) {
      console.log(`   Movimiento ORDEN a anular: MovId ${r.mov.MovIdMovimiento} · Importe: ${r.mov.MovImporte} (${r.mov.CueTipo})`);
    } else {
      console.log(`   ⚠️  No se encontró movimiento ORDEN activo para esta orden`);
    }
    if (r.deudas.length) {
      r.deudas.forEach(d => console.log(`   DeudaDocumento a cancelar: DDeId ${d.DDeIdDocumento} · Pendiente: ${d.DDeImportePendiente}`));
    } else {
      console.log(`   ℹ️  Sin DeudaDocumento pendiente (posiblemente ya cancelada)`);
    }
    console.log(`   Cantidad a descontar del plan: ${r.ord.OrdCantidad} uds`);
    const nuevaUsada = parseFloat(r.plan.PlaCantidadUsada) + parseFloat(r.ord.OrdCantidad);
    console.log(`   PlaCantidadUsada: ${r.plan.PlaCantidadUsada} → ${nuevaUsada}  (total plan: ${r.plan.PlaCantidadTotal})`);
  }

  if (!APPLY) {
    console.log('\n*** DRY-RUN: no se escribió nada. Corré con --apply para aplicar. ***\n');
    await pool.close();
    return;
  }

  // ── Aplicar dentro de una única transacción ───────────────────────────────
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let applied = 0;

  try {
    for (const r of resueltos) {
      const mkReq = () => new sql.Request(tx);
      console.log(`\n→ Aplicando: ${r.caso.label}...`);

      // PASO 1: articulosPermitidos
      if (!r.yaPermitido) {
        await mkReq()
          .input('PlaIdPlan',    sql.Int, r.caso.planId)
          .input('ProIdProducto',sql.Int, r.proIdOrden)
          .query(`
            INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto)
            VALUES (@PlaIdPlan, @ProIdProducto)
          `);
        console.log(`   ✅ Agregado ProId ${r.proIdOrden} a articulosPermitidos del Plan #${r.caso.planId}`);
      }

      // PASO 2: Anular movimiento ORDEN monetario
      if (r.mov) {
        await mkReq()
          .input('MovId', sql.Int, r.mov.MovIdMovimiento)
          .input('Usr',   sql.Int, USR)
          .query(`
            UPDATE dbo.MovimientosCuenta
            SET    MovAnulado        = 1,
                   MovObservaciones  = ISNULL(MovObservaciones,'') +
                     ' [ANULADO por fix-plan-articulos-no-cubiertos — orden cubierta por plan]'
            WHERE  MovIdMovimiento = @MovId
          `);

        // Ajustar CueSaldoActual de la cuenta monetaria (sumar el importe anulado)
        await mkReq()
          .input('CueIdCuenta', sql.Int,          r.mov.CueIdCuenta)
          .input('Importe',     sql.Decimal(18,4), Math.abs(r.mov.MovImporte))
          .query(`
            UPDATE dbo.CuentasCliente
            SET    CueSaldoActual = CueSaldoActual + @Importe
            WHERE  CueIdCuenta = @CueIdCuenta
          `);
        console.log(`   ✅ Movimiento ORDEN ${r.mov.MovIdMovimiento} anulado — saldo monetario ajustado +${Math.abs(r.mov.MovImporte)}`);
      }

      // PASO 3: Cancelar DeudaDocumento
      for (const dd of r.deudas) {
        await mkReq()
          .input('DDeId', sql.Int, dd.DDeIdDocumento)
          .query(`
            UPDATE dbo.DeudaDocumento
            SET    DDeEstado          = 'CANCELADO',
                   DDeImportePendiente = 0
            WHERE  DDeIdDocumento = @DDeId
          `);
        console.log(`   ✅ DeudaDocumento ${dd.DDeIdDocumento} cancelada`);
      }

      // PASO 4: Crear movimiento ENTREGA en cuenta de recursos
      // Verificar que no exista ya un ENTREGA para esta orden en esta cuenta
      const entregaExiste = await mkReq()
        .input('OrdId', sql.Int, r.ord.OrdIdOrden)
        .input('Cue',   sql.Int, r.plan.CueIdCuenta)
        .query(`
          SELECT 1 FROM dbo.MovimientosCuenta
          WHERE OrdIdOrden  = @OrdId
            AND CueIdCuenta = @Cue
            AND MovTipo     = 'ENTREGA'
            AND (MovAnulado IS NULL OR MovAnulado = 0)
        `);

      if (!entregaExiste.recordset.length) {
        await mkReq()
          .input('CueIdCuenta',    sql.Int,           r.plan.CueIdCuenta)
          .input('MovTipo',        sql.VarChar(30),   'ENTREGA')
          .input('MovConcepto',    sql.NVarChar(500),  `${r.caso.codigoOrden} [corregido por fix-plan]`)
          .input('MovImporte',     sql.Decimal(18,4), -Math.abs(r.ord.OrdCantidad))
          .input('MovUsuarioAlta', sql.Int,           USR)
          .input('OrdIdOrden',     sql.Int,           r.ord.OrdIdOrden)
          .input('MovObs',         sql.NVarChar(500),  `Entrega correctiva Plan #${r.caso.planId}`)
          .query(`
            INSERT INTO dbo.MovimientosCuenta
              (CueIdCuenta, MovTipo, MovConcepto, MovImporte,
               MovUsuarioAlta, OrdIdOrden, MovObservaciones, MovFecha)
            VALUES
              (@CueIdCuenta, @MovTipo, @MovConcepto, @MovImporte,
               @MovUsuarioAlta, @OrdIdOrden, @MovObs, GETDATE())
          `);

        // Actualizar CueSaldoActual de la cuenta de recursos
        await mkReq()
          .input('CueIdCuenta', sql.Int,          r.plan.CueIdCuenta)
          .input('Cantidad',    sql.Decimal(18,4), Math.abs(r.ord.OrdCantidad))
          .query(`
            UPDATE dbo.CuentasCliente
            SET    CueSaldoActual = CueSaldoActual - @Cantidad
            WHERE  CueIdCuenta = @CueIdCuenta
          `);
        console.log(`   ✅ Movimiento ENTREGA creado en cuenta recursos (CueId ${r.plan.CueIdCuenta}): -${r.ord.OrdCantidad} uds`);
      } else {
        console.log(`   ℹ️  ENTREGA ya existe para esta orden en cuenta de recursos — se omite`);
      }

      // PASO 5: Actualizar PlaCantidadUsada
      const nuevaUsada = parseFloat(r.plan.PlaCantidadUsada) + parseFloat(r.ord.OrdCantidad);
      const estaAgotado = nuevaUsada >= parseFloat(r.plan.PlaCantidadTotal) ? 0 : 1;
      await mkReq()
        .input('PlaIdPlan',        sql.Int,          r.caso.planId)
        .input('NuevaUsada',       sql.Decimal(18,4), nuevaUsada)
        .input('Activo',           sql.Bit,           estaAgotado)
        .query(`
          UPDATE dbo.PlanesMetros
          SET    PlaCantidadUsada = @NuevaUsada,
                 PlaActivo        = @Activo
          WHERE  PlaIdPlan = @PlaIdPlan
        `);
      console.log(`   ✅ PlaCantidadUsada actualizada: ${r.plan.PlaCantidadUsada} → ${nuevaUsada}`);

      applied++;
    }

    await tx.commit();
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`  ✅ APLICADO: ${applied} caso(s) corregido(s) correctamente.`);
    console.log(`════════════════════════════════════════════════════════════\n`);
  } catch (e) {
    await tx.rollback();
    console.error('\n❌ ERROR — rollback total. No se cambió nada.\n', e.message);
    process.exitCode = 1;
  }

  await pool.close();
}

main().catch(e => { console.error(e); process.exit(1); });
