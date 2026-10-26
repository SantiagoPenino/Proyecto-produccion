/**
 * reparar_rebaja_plan_ordenes_sin_linea.js  (25-sep-2026)
 *
 * PROBLEMA: desde el deploy del 23-sep, las órdenes cubiertas por plan de metros (rollo)
 * quedaron SIN línea en PedidosCobranzaDetalle. Igual entraron a depósito (recepción de
 * bultos), pero ese camino calcula los metros con SUM(Cantidad) de esas líneas → 0 → no
 * disparó contabilidad → el plan NO se rebajó (63 órdenes finalizadas al 25-sep).
 *
 * QUÉ HACE: para cada orden que YA ESTÁ EN DEPÓSITO, cuyo cliente tiene plan activo para el
 * artículo y que NO tiene movimiento ENTREGA en sus cuentas de metros, dispara el mismo hook
 * que usa el ingreso normal (contabilidadService.hookEntregaMetros) con la cantidad con la
 * que entró a depósito. Es exactamente lo que hubiera pasado al recibir el bulto.
 *
 * USO (desde la carpeta backend, con el .env apuntando a la base que corresponda):
 *   node scripts/reparar_rebaja_plan_ordenes_sin_linea.js                -> solo lista (no toca nada)
 *   node scripts/reparar_rebaja_plan_ordenes_sin_linea.js --aplicar      -> rebaja TODAS las listadas
 *   node scripts/reparar_rebaja_plan_ordenes_sin_linea.js --aplicar --solo=DTF-27470,DTF-27456
 *   node scripts/reparar_rebaja_plan_ordenes_sin_linea.js --desde=2026-09-23
 */
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));
const contabilidadService = require(path.resolve(__dirname, '../services/contabilidadService.js'));

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const DESDE = (args.find(a => a.startsWith('--desde=')) || '--desde=2026-09-23').split('=')[1];
const SOLO = (args.find(a => a.startsWith('--solo=')) || '').split('=')[1];
const soloCodigos = SOLO ? SOLO.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : null;

const SQL_CANDIDATAS = `
SELECT
    o.OrdenID,
    RTRIM(o.CodigoOrden)                   AS Cod,
    o.Estado,
    o.FechaIngreso,
    o.CliIdCliente,
    od.OrdIdOrden                          AS IdDeposito,
    od.OrdCantidad                         AS CantDeposito,
    od.MonIdMoneda,
    od.OrdNombreTrabajo,
    ISNULL(od.ProIdProducto, o.ProIdProducto) AS ProIdProducto,
    pl.PlaIdPlan
FROM dbo.Ordenes o
CROSS APPLY (SELECT TOP 1 x.OrdIdOrden, x.OrdCantidad, x.MonIdMoneda, x.OrdNombreTrabajo, x.ProIdProducto
             FROM dbo.OrdenesDeposito x
             WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%'
             ORDER BY x.OrdIdOrden DESC) od
OUTER APPLY (SELECT TOP 1 pm.PlaIdPlan
             FROM dbo.PlanesMetros pm
             WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
               AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
               AND (pm.ProIdProducto = ISNULL(od.ProIdProducto, o.ProIdProducto)
                    OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
                               WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = ISNULL(od.ProIdProducto, o.ProIdProducto)))
             ORDER BY pm.PlaFechaAlta) pl
WHERE o.FechaIngreso >= @Desde
  AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
  AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
  AND pl.PlaIdPlan IS NOT NULL
  AND od.OrdCantidad > 0
  -- solo las de ESTE bug: sin línea de cobranza, o con la línea repuesta por el script SQL
  AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d
                  WHERE d.OrdenID = o.OrdenID
                    AND ISNULL(d.LogPrecioAplicado, '') NOT LIKE '%nea repuesta%')
  -- todavía no rebajó: ningún ENTREGA en cuentas de METROS del cliente para esta orden
  AND NOT EXISTS (
        SELECT 1 FROM dbo.MovimientosCuenta m
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
        WHERE cc.CliIdCliente = o.CliIdCliente
          AND cc.CueTipo NOT LIKE 'DINERO%'
          AND m.MovTipo = 'ENTREGA'
          AND ISNULL(m.MovAnulado, 0) = 0
          AND ( m.OrdIdOrden = o.OrdenID OR m.OrdIdOrden = od.OrdIdOrden
                OR m.MovConcepto = RTRIM(o.CodigoOrden)
                OR m.MovConcepto LIKE RTRIM(o.CodigoOrden) + ' %' ))
ORDER BY CASE WHEN o.Estado = 'Finalizado' THEN 0 ELSE 1 END, o.FechaIngreso;
`;

const SQL_REBAJADO = `
SELECT ISNULL(SUM(-m.MovImporte), 0) AS Metros, MAX(m.MovObservaciones) AS Obs
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo NOT LIKE 'DINERO%'
  AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado, 0) = 0
  AND ( m.OrdIdOrden = @Ord OR m.OrdIdOrden = @Dep OR m.MovConcepto = @Cod OR m.MovConcepto LIKE @Cod + ' %' );
`;

(async () => {
  const pool = await getPool();
  const dbName = (await pool.request().query('SELECT DB_NAME() AS db')).recordset[0].db;
  console.log(`\nBase: ${dbName} | desde: ${DESDE} | modo: ${APLICAR ? 'APLICAR (rebaja de verdad)' : 'SOLO LISTAR'}${soloCodigos ? ' | solo: ' + soloCodigos.join(',') : ''}\n`);

  const cand = (await pool.request().input('Desde', sql.Date, DESDE).query(SQL_CANDIDATAS)).recordset
    .filter(r => !soloCodigos || soloCodigos.includes(r.Cod.toUpperCase()));

  if (!cand.length) { console.log('No hay órdenes en depósito con plan y sin rebaja. Nada que hacer.'); process.exit(0); }

  console.log(`Órdenes en depósito con plan activo y SIN rebaja: ${cand.length}`);
  console.table(cand.map(r => ({ Cod: r.Cod, Estado: r.Estado, Plan: r.PlaIdPlan, Cant: Number(r.CantDeposito), Deposito: r.IdDeposito, Cli: r.CliIdCliente, Prod: r.ProIdProducto })));

  if (!APLICAR) { console.log('\nSolo listado. Para rebajar: --aplicar'); process.exit(0); }

  let ok = 0, fallas = 0;
  for (const r of cand) {
    const cant = Number(r.CantDeposito);
    process.stdout.write(`→ ${r.Cod} (${cant} m, plan #${r.PlaIdPlan}) ... `);
    try {
      await contabilidadService.hookEntregaMetros({
        OrdIdOrden:    r.IdDeposito,            // el ingreso normal pasa el id de OrdenesDeposito
        CliIdCliente:  r.CliIdCliente,
        ProIdProducto: r.ProIdProducto,
        Cantidad:      cant,
        Importe:       0,                       // cubierta por plan: sin importe monetario
        MonIdMoneda:   Number(r.MonIdMoneda) === 1 ? 1 : 2,
        CodigoOrden:   r.Cod,
        NombreTrabajo: r.OrdNombreTrabajo || '',
        UsuarioAlta:   1,
      });
      const chk = (await pool.request()
        .input('Cli', sql.Int, r.CliIdCliente).input('Ord', sql.Int, r.OrdenID)
        .input('Dep', sql.Int, r.IdDeposito).input('Cod', sql.VarChar(100), r.Cod)
        .query(SQL_REBAJADO)).recordset[0];
      const metros = Number(chk.Metros);
      if (metros > 0) { ok++; console.log(`OK: rebajó ${metros} m (${chk.Obs || ''})`); }
      else { fallas++; console.log('SIN MOVIMIENTO después del hook — revisar log del servicio'); }
    } catch (e) {
      fallas++; console.log(`ERROR: ${e.message}`);
    }
  }
  console.log(`\nListo. Rebajadas: ${ok} | Con problema: ${fallas}`);
  process.exit(fallas ? 2 : 0);
})().catch(e => { console.error('ERROR general:', e.message); process.exit(1); });
