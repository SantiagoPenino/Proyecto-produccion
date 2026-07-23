/* =====================================================================
   VERIFICADOR (SOLO LECTURA) - Qué tipo de CFE se le va a pedir a DGI
   ---------------------------------------------------------------------
   NO envía nada a SISNET ni a DGI, no modifica la base. Solo lee los
   documentos y llama a las MISMAS funciones que usa sisnetService al
   emitir (resolverTipoCFE / resolverTpoDocRef), así lo que ves acá es
   exactamente lo que se manda.

   Uso:
     node backend/scripts/verificar_tipocfe_nc.js            -> todas las NC
     node backend/scripts/verificar_tipocfe_nc.js 4463       -> un documento
     node backend/scripts/verificar_tipocfe_nc.js --todos    -> NC + muestra de ventas

   Tabla de referencia DGI:
     101 e-Ticket    102 NC de e-Ticket    103 ND de e-Ticket
     111 e-Factura   112 NC de e-Factura   113 ND de e-Factura
   ===================================================================== */
require('dotenv').config();
const { getPool, sql } = require('../config/db');
const sisnet = require('../services/sisnetService');

const arg = process.argv[2];
const docId = arg && /^\d+$/.test(arg) ? parseInt(arg, 10) : null;
const todos = arg === '--todos';

const SQL_BASE = `
  SELECT d.DocIdDocumento, d.DocTipo, d.DocSerie, d.DocNumero, d.DocFechaEmision,
         d.CfeEstado, d.CfeNumeroOficial, d.DocTotal, d.MonIdMoneda, d.DocIdDocumentoRef,
         ISNULL(c.CioRuc, d.DocCliDocumento) AS CliDoc,
         ISNULL(c.Nombre,  d.DocCliNombre)   AS CliNombre,
         r.DocTipo AS RefTipo, r.DocSerie AS RefSerie, r.DocNumero AS RefNumero,
         r.CfeNumeroOficial AS RefOficial, r.CfeEstado AS RefCfeEstado, @@COL_TIPO@@ AS RefCfeTipoCFE
  FROM dbo.DocumentosContables d
  LEFT JOIN dbo.Clientes            c ON c.CliIdCliente   = d.CliIdCliente
  LEFT JOIN dbo.DocumentosContables r ON r.DocIdDocumento = d.DocIdDocumentoRef
`;

(async () => {
  const pool = await getPool();

  // CfeTipoCFE es nueva (add_CfeTipoCFE.sql). Si todavía no se corrió la migración,
  // el script igual funciona: el tipo emitido se reconstruye en vez de leerse.
  const tieneCol = (await pool.request().query(`
    SELECT 1 AS x FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='CfeTipoCFE'`)).recordset.length > 0;
  const SQL = SQL_BASE.replace('@@COL_TIPO@@', tieneCol ? 'r.CfeTipoCFE' : 'CAST(NULL AS INT)');
  if (!tieneCol) console.log('\n  (nota: la columna CfeTipoCFE aún no existe; el tipo emitido se reconstruye)');

  let rows;

  if (docId) {
    rows = (await pool.request().input('Id', sql.Int, docId)
      .query(SQL + " WHERE d.DocIdDocumento = @Id")).recordset;
    if (!rows.length) { console.log(`No existe el documento #${docId}`); process.exit(1); }
  } else if (todos) {
    rows = (await pool.request().query(SQL + `
      WHERE d.DocSerie = 'NC' OR UPPER(d.DocTipo) LIKE '%NOTA DE CR%'
         OR d.DocIdDocumento IN (SELECT TOP 8 DocIdDocumento FROM dbo.DocumentosContables
                                 WHERE CfeEstado='ACEPTADO_DGI' AND DocSerie <> 'NC'
                                 ORDER BY DocIdDocumento DESC)
      ORDER BY d.DocIdDocumento`)).recordset;
  } else {
    rows = (await pool.request().query(SQL + `
      WHERE d.DocSerie = 'NC' OR UPPER(d.DocTipo) LIKE '%NOTA DE CR%'
      ORDER BY d.DocIdDocumento`)).recordset;
  }

  console.log('');
  console.log('  Documento              DocTipo guardado        Origen referenciado      -> CFE que se le pide a DGI');
  console.log('  ' + '-'.repeat(112));

  let problemas = 0;

  for (const d of rows) {
    const cliDoc = String(d.CliDoc || '').replace(/\D/g, '').trim();
    const esRUT  = cliDoc.length === 12;

    // Exactamente lo que hace emitirCFE:
    let tpoDocRef = null, refEsFactura = null, refOrigenDato = null;
    if (d.DocIdDocumentoRef && d.RefTipo != null) {
      const ref = sisnet.resolverReferencia(
        { DocTipo: d.RefTipo, CfeEstado: d.RefCfeEstado, CfeTipoCFE: d.RefCfeTipoCFE }, cliDoc);
      tpoDocRef     = ref.tpoDocRef;
      refEsFactura  = ref.esFactura;
      refOrigenDato = ref.origenDato;
    }
    const res = sisnet.resolverTipoCFE(d.DocTipo, cliDoc, refEsFactura);

    const etiqueta = `${d.DocSerie}-${d.DocNumero}`.padEnd(20);
    const origen = d.DocIdDocumentoRef
      ? `${String(d.RefTipo || '').trim()} ${d.RefSerie || ''}-${d.RefNumero || ''}`
      : '(sin referencia)';

    console.log(`  ${etiqueta}   ${('"' + String(d.DocTipo).trim() + '"').padEnd(24)}${origen.padEnd(26)}-> ${res.tipoCFE}  ${res.nombre}`);
    console.log(`  ${' '.repeat(20)}   cliente: ${String(d.CliNombre || '').trim()} (doc ${cliDoc || 'sin doc'}${esRUT ? ', RUT' : ''})` +
                ` | total ${d.DocTotal} ${d.MonIdMoneda === 2 ? 'USD' : 'UYU'} | estado ${d.CfeEstado}`);
    if (tpoDocRef) {
      console.log(`  ${' '.repeat(20)}   referencia que viaja a DGI: tpoDocRef=${tpoDocRef}` +
                  `${refOrigenDato ? ` (según el tipo realmente emitido, ${refOrigenDato})` : ' (según el DocTipo interno: el original nunca se emitió acá)'}` +
                  `, oficial="${d.RefOficial || '(sin nro oficial, usa ' + d.RefSerie + '-' + d.RefNumero + ')'}"`);
    }

    // Chequeos
    const esNCporSerie = d.DocSerie === 'NC' || String(d.DocTipo).toUpperCase().includes('NOTA DE CR');
    if (esNCporSerie && !res.isDocNC) {
      console.log('  >>> ERROR: es una Nota de Crédito pero se emitiría como VENTA.'); problemas++;
    }
    if (esNCporSerie && !d.DocIdDocumentoRef) {
      console.log('  >>> ERROR: Nota de Crédito sin documento de origen. DGI exige la referencia; la emisión se aborta.'); problemas++;
    }
    if (res.isDocNC && tpoDocRef && res.tipoCFE === 112 && tpoDocRef.endsWith('e_Ticket')) {
      console.log('  >>> ERROR: NC de e-Factura (112) referenciando un e-Ticket. DGI lo rechaza.'); problemas++;
    }
    if (res.isDocNC && tpoDocRef && res.tipoCFE === 102 && tpoDocRef.endsWith('e_Factura')) {
      console.log('  >>> ERROR: NC de e-Ticket (102) referenciando una e-Factura. DGI lo rechaza.'); problemas++;
    }
    if (!esNCporSerie && res.isDocNC) {
      console.log('  >>> ERROR: documento de venta detectado como Nota de Crédito.'); problemas++;
    }
    console.log('');
  }

  console.log('  ' + '-'.repeat(112));
  console.log(`  ${rows.length} documento(s) analizados. ${problemas === 0 ? 'Sin problemas.' : problemas + ' PROBLEMA(S) detectado(s).'}`);
  console.log('');
  process.exit(problemas === 0 ? 0 : 2);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
