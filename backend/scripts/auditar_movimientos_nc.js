/* =====================================================================
   AUDITORÍA (SOLO LECTURA) - ¿Casan los movimientos de las Notas de Crédito?
   ---------------------------------------------------------------------
   Por cada NC verifica las 4 patas que deberían moverse juntas:
     1) MovimientosCuenta   -> el crédito al cliente (MovTipo NOTA_CREDITO)
     2) DeudaDocumento      -> la deuda del documento original bajó
     3) Asiento contable    -> existe y está balanceado (debe = haber)
     4) DGI                 -> el CFE emitido es realmente una NC
   No modifica nada.
   ===================================================================== */
require('dotenv').config();
const { getPool, sql } = require('../config/db');
const sisnet = require('../services/sisnetService');

const money = (n) => Number(n || 0).toFixed(2);

(async () => {
  const pool = await getPool();

  const ncs = (await pool.request().query(`
    SELECT d.DocIdDocumento, d.DocTipo, d.DocSerie, d.DocNumero, d.DocFechaEmision, d.DocEstado, d.AsiIdAsiento,
           d.CfeEstado, d.CfeNumeroOficial, d.DocTotal, d.MonIdMoneda, d.DocIdDocumentoRef,
           d.CliIdCliente, d.CueIdCuenta,
           ISNULL(c.Nombre, d.DocCliNombre) AS CliNombre, c.CioRuc AS CliRUT,
           r.DocTipo AS RefTipo, r.DocSerie AS RefSerie, r.DocNumero AS RefNumero,
           r.DocTotal AS RefTotal, r.MonIdMoneda AS RefMoneda, r.DocEstado AS RefEstado, r.CfeEstado AS RefCfeEstado
    FROM dbo.DocumentosContables d
    LEFT JOIN dbo.Clientes            c ON c.CliIdCliente   = d.CliIdCliente
    LEFT JOIN dbo.DocumentosContables r ON r.DocIdDocumento = d.DocIdDocumentoRef
    WHERE d.DocSerie = 'NC' OR UPPER(d.DocTipo) LIKE '%NOTA DE CR%'
    ORDER BY d.DocIdDocumento`)).recordset;

  let problemas = 0;
  const avisar = (txt) => { console.log('     >>> ' + txt); problemas++; };

  for (const nc of ncs) {
    const etiqueta = `${nc.DocSerie}-${nc.DocNumero}`;
    console.log(`\n${etiqueta}  ${String(nc.CliNombre || '').trim()}  ${money(nc.DocTotal)} ${nc.MonIdMoneda === 2 ? 'USD' : 'UYU'}  [${nc.CfeEstado} / ${nc.DocEstado}]`);
    console.log(`     origen: ${nc.DocIdDocumentoRef ? `${String(nc.RefTipo||'').trim()} ${nc.RefSerie}-${nc.RefNumero} por ${money(nc.RefTotal)}` : 'SIN REFERENCIA'}`);

    // ---- 1) Movimiento en cuenta corriente
    const movs = (await pool.request().input('Doc', sql.Int, nc.DocIdDocumento).query(`
      SELECT MovIdMovimiento, MovTipo, MovImporte, MovConcepto, CueIdCuenta, MovSaldoPosterior, MovAnulado
      FROM dbo.MovimientosCuenta WHERE DocIdDocumento = @Doc`)).recordset;

    // Las NC "externas" (sobre facturas del sistema anterior) por diseño NO tocan la cuenta
    // corriente: la factura original y su deuda viven en el sistema viejo. No es un error.
    const esExterna = String(nc.RefTipo || '').toUpperCase().includes('EXTERN');

    if (movs.length === 0) {
      if (esExterna) {
        console.log('     movimiento: ninguno (NC externa: por diseño no toca la cuenta corriente)');
      } else {
        avisar('sin movimiento en cuenta corriente: la NC no le devolvió el crédito al cliente.');
      }
    } else {
      for (const m of movs) {
        console.log(`     movimiento: ${m.MovTipo} ${money(m.MovImporte)} (cuenta ${m.CueIdCuenta}, saldo posterior ${money(m.MovSaldoPosterior)})${m.MovAnulado ? ' [ANULADO]' : ''} "${String(m.MovConcepto || '').trim()}"`);
      }
      const suma = movs.filter(m => !m.MovAnulado).reduce((a, m) => a + Number(m.MovImporte || 0), 0);
      if (Math.abs(Math.abs(suma) - Number(nc.DocTotal)) > 0.01) {
        avisar(`el movimiento (${money(suma)}) no coincide con el total de la NC (${money(nc.DocTotal)}).`);
      }
      if (movs.length > 1) avisar(`${movs.length} movimientos para una sola NC: posible duplicado.`);
    }

    // ---- 2) Deuda del documento original
    if (nc.DocIdDocumentoRef) {
      const deu = (await pool.request().input('Doc', sql.Int, nc.DocIdDocumentoRef).query(`
        SELECT DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado
        FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc`)).recordset;
      if (deu.length === 0) {
        console.log('     deuda del original: no existe (documento de contado, sin deuda que bajar)');
      } else {
        for (const d of deu) {
          console.log(`     deuda del original: original ${money(d.DeuImporteOriginal)} / pendiente ${money(d.DeuSaldoPendiente)} [${d.DeuEstado}]`);
        }
        if (deu.length > 1) avisar(`el documento original tiene ${deu.length} filas de deuda (duplicada).`);
      }
    }

    // ---- 3) Asiento contable
    // El asiento de la NC se identifica por su concepto ("Nota de Crédito NC-000001 - ...").
    // No se busca por AsiIdAsiento porque el documento no lo guarda para las NC.
    const asi = (await pool.request()
      .input('Concepto', sql.NVarChar(80), `%Nota de Crédito ${etiqueta}%`)
      .query(`
      SELECT TOP 5 a.AsiId, a.AsiConcepto, a.AsiFecha, a.AsiEstado,
             (SELECT SUM(ISNULL(x.DetDebeUYU,0))  FROM dbo.Cont_AsientosDetalle x WHERE x.AsiId = a.AsiId) AS Debe,
             (SELECT SUM(ISNULL(x.DetHaberUYU,0)) FROM dbo.Cont_AsientosDetalle x WHERE x.AsiId = a.AsiId) AS Haber
      FROM dbo.Cont_AsientosCabecera a
      WHERE a.AsiConcepto LIKE @Concepto
      ORDER BY a.AsiId DESC`)).recordset;

    if (asi.length === 0) {
      avisar('sin asiento contable: la NC no quedó registrada en la contabilidad.');
    } else {
      for (const a of asi) {
        const dif = Number(a.Debe || 0) - Number(a.Haber || 0);
        console.log(`     asiento #${a.AsiId}: debe ${money(a.Debe)} / haber ${money(a.Haber)} "${String(a.AsiConcepto || '').trim()}"`);
        if (Math.abs(dif) > 0.01) avisar(`asiento #${a.AsiId} DESBALANCEADO por ${money(dif)}.`);
      }
    }

    // ---- 4) Lo que se emitió / se emitiría ante DGI
    const cliDoc = String(nc.CliRUT || '').replace(/\D/g, '');
    // La familia del referenciado sale de lo que DGI tiene realmente, no del DocTipo interno
    const ref = nc.RefTipo
      ? sisnet.resolverReferencia({ DocTipo: nc.RefTipo, CfeEstado: nc.RefCfeEstado, CfeTipoCFE: null }, cliDoc)
      : null;
    const res = sisnet.resolverTipoCFE(nc.DocTipo, cliDoc, ref ? ref.esFactura : null);
    console.log(`     DGI: se emitirá como ${res.tipoCFE} ${res.nombre}` +
                (ref ? ` (referencia ${ref.tpoDocRef})` : ''));
    if (nc.CfeEstado === 'ACEPTADO_DGI') {
      const oficial = nc.CfeNumeroOficial || '';
      console.log(`     DGI: ya aceptado como "${oficial}"`);
      avisar('esta NC YA fue aceptada por DGI con el código viejo (venta): hay que regularizarla ante DGI.');
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`${ncs.length} nota(s) de crédito auditadas. ${problemas === 0 ? 'Todo casa.' : problemas + ' punto(s) a revisar.'}`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
