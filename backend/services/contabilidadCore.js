'use strict';
/**
 * contabilidadCore.js
 * ──────────────────────────────────────────────────────────────────
 * Motor Central de Contabilidad Bimonetaria ERP.
 *
 * Las cuentas contables ya NO están hardcodeadas aquí.
 * Se leen desde Cont_EventosContables vía motorContable.js,
 * usando el campo EvtCodigo como clave para cada tipo de operación.
 *
 * Para operaciones que SÍ tienen reglas en el Motor, se usan esas.
 * Para operaciones legacy sin reglas, se usa el fallback de CUENTAS.
 *
 * CUENTAS es ahora solo un fallback de última instancia.
 * La fuente de verdad es la BD.
 */

const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { estamparAreaLineas } = require('./areaLineaService');

// ─── Fallback: cuentas por defecto si el Motor no tiene reglas configuradas ─
// Estos valores son el "último recurso". Lo ideal es que estén en el Motor.
const CUENTAS = {
  CAJA_UYU:    '1.1.1',
  CAJA_USD:    '1.1.2',
  // Un cheque NO es plata en la caja: es un valor a cobrar a futuro. Cobrar con cheque
  // debita esta cuenta, no Caja. Recién al depositarlo pasa a Banco.
  VALORES_DEPOSITAR: '1.1.5',
  CLIENTE_UYU: '1.2.1',
  CLIENTE_USD: '1.2.2',
  IVA_22:      '2.2.1',
  IVA_10:      '2.2.2',
  VENTA_SERV:  '4.1.1',
  VENTA_PROD:  '4.1.2',
  ANTICIPOS:   '2.3.1',
};

/**
 * Obtiene el CueId de una cuenta basándose en su CueCodigo.
 */
const getCuentaId = async (codigo, externalTx = null) => {
  const pool = externalTx ? null : await getPool();
  const request = externalTx ? new sql.Request(externalTx) : pool.request();
  const res = await request.input('Cod', sql.VarChar(20), codigo).query(
    `SELECT CueId FROM dbo.Cont_PlanCuentas WITH(NOLOCK) WHERE CueCodigo = @Cod AND CueImputable = 1`
  );
  if (!res.recordset.length) throw new Error(`La cuenta contable ${codigo} no existe o no es imputable.`);
  return res.recordset[0].CueId;
};

/**
 * Resuelve las líneas de asiento para un evento, usando el Motor.
 * Reemplaza los metavalores META_CLIENTE y META_CAJA con las cuentas reales.
 *
 * @param {string} evtCodigo   Ej: 'PAGO', 'ORDEN', 'ENTRADA', 'ENTREGA'
 * @param {object} ctx         { moneda, clienteId, totalNeto, totalBruto, iva, pagosNorm }
 * @returns {Array} lineas para generarAsientoCompleto, o [] si no hay reglas
 */
const resolverLineasDesdeMotor = async (evtCodigo, ctx = {}) => {
  // Importamos el motor aquí para evitar require circular
  const motor = require('./motorContable');
  const reglas = await motor.getReglasAsiento(evtCodigo);
  if (!reglas || reglas.length === 0) return [];

  const isUSD = ctx.moneda === 'USD';
  const cotiz = ctx.cotizacion || 1;
  const monedaId = isUSD ? 2 : 1;
  const cuentaClienteFallback = isUSD ? CUENTAS.CLIENTE_USD : CUENTAS.CLIENTE_UYU;
  const cuentaCajaFallback    = isUSD ? CUENTAS.CAJA_USD    : CUENTAS.CAJA_UYU;

  const formulaMap = {
    TOTAL:     Math.abs(ctx.totalNeto  || ctx.totalBruto || 0),
    NETO:      Math.abs(ctx.neto       || 0),
    IVA:       Math.abs(ctx.ivaMonto   || ctx.iva || 0),
    DESCUENTO: Math.abs(ctx.descuento  || 0),
  };

  const lineas = reglas.map(r => {
    let cuenta = r.CueCodigo;
    if (cuenta === 'META_CLIENTE') cuenta = cuentaClienteFallback;
    if (cuenta === 'META_CAJA')    cuenta = cuentaCajaFallback;

    const importe = formulaMap[r.RasFormula] ?? formulaMap.TOTAL;
    return {
      codigoCuenta: cuenta,
      debeBase:  r.RasNaturaleza === 'DEBE'  ? importe : 0,
      haberBase: r.RasNaturaleza === 'HABER' ? importe : 0,
      monedaId,
      cotizacion: cotiz,
      entidadId:   ctx.clienteId || null,
      entidadTipo: 'CLIENTE',
    };
  });

  return lineas;
};

/**
 * Función Principal del Motor Contable.
 * Toma un conjunto de operaciones "Lógicas" y las transcribe
 * a Débitos y Créditos con manejo Multi-Moneda obligatoria.
 *
 * @param {Object} params Parámetros del asiento.
 * @param {Object} transaction Contexto transaccional de SQL Server (obligatorio para atomicidad).
 * @returns {Integer} AsiId generado.
 */
const generarAsientoCompleto = async ({
  fecha = new Date(),
  concepto,
  usuarioId,
  tcaIdTransaccion = null,
  origen = 'CAJA',
  lineas = []
}, transaction) => {

  if (!transaction) throw new Error('[CONTABILIDAD] Se requiere un contexto de transacción (pool.transaction()) activo.');
  if (!lineas || lineas.length < 2) throw new Error('[CONTABILIDAD] Un asiento requiere mínimo 2 líneas (Partida Doble).');

  try {
    const request = new sql.Request(transaction);

    // 1. VALIDACIÓN PARTIDA DOBLE
    let sumaDebeUYU = 0;
    let sumaHaberUYU = 0;

    const lineasProcesadas = [];
    for (const l of lineas) {
      const isUSD = (l.monedaId === 2);
      const cotiz = (isUSD && l.cotizacion) ? parseFloat(l.cotizacion) : 1;

      const valDebeLoc  = (parseFloat(l.debeBase)  || 0) * cotiz;
      const valHaberLoc = (parseFloat(l.haberBase) || 0) * cotiz;

      sumaDebeUYU  += valDebeLoc;
      sumaHaberUYU += valHaberLoc;

      lineasProcesadas.push({
        ...l,
        CueId: await getCuentaId(l.codigoCuenta, transaction),
        debeUYU:         valDebeLoc,
        haberUYU:        valHaberLoc,
        importeOriginal: (parseFloat(l.debeBase) || 0) + (parseFloat(l.haberBase) || 0),
        cotizacion:      cotiz,
        monedaId:        l.monedaId || 1
      });
    }

    // Tolerancia técnica por redondeos
    if (Math.abs(sumaDebeUYU - sumaHaberUYU) > 0.02) {
      throw new Error(`[CONTABILIDAD] Error de Cuadre: Debe ($${sumaDebeUYU.toFixed(2)}) != Haber ($${sumaHaberUYU.toFixed(2)})`);
    }

    // 2. CABECERA
    const resCab = await request
      .input('Fecha',   sql.DateTime,    fecha)
      .input('Concepto',sql.NVarChar(200), concepto)
      .input('UsuarioId',sql.Int,         usuarioId)
      .input('TcaId',   sql.Int,          tcaIdTransaccion)
      .input('Origen',  sql.VarChar(50),  origen)
      .query(`
        INSERT INTO dbo.Cont_AsientosCabecera (AsiFecha, AsiConcepto, UsuarioId, TcaIdTransaccion, SysOrigen, AsiEstado)
        OUTPUT INSERTED.AsiId
        VALUES (@Fecha, @Concepto, @UsuarioId, @TcaId, @Origen, 'REGISTRADO')
      `);

    const asiId = resCab.recordset[0].AsiId;

    // 3. DETALLES
    for (const linea of lineasProcesadas) {
      if (linea.debeUYU === 0 && linea.haberUYU === 0) continue;

      const reqDet = new sql.Request(transaction);
      await reqDet
        .input('AsiId',       sql.Int,          asiId)
        .input('CueId',       sql.Int,          linea.CueId)
        .input('Debe',        sql.Decimal(18,2), linea.debeUYU)
        .input('Haber',       sql.Decimal(18,2), linea.haberUYU)
        .input('ImporteOrig', sql.Decimal(18,2), linea.importeOriginal)
        .input('Cotiz',       sql.Decimal(18,4), linea.cotizacion)
        .input('MonedaId',    sql.Int,           linea.monedaId)
        .input('EntId',       sql.Int,           linea.entidadId   || null)
        .input('EntTipo',     sql.VarChar(20),   linea.entidadTipo || null)
        .query(`
          INSERT INTO dbo.Cont_AsientosDetalle
            (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
          VALUES
            (@AsiId, @CueId, @Debe, @Haber, @ImporteOrig, @Cotiz, @MonedaId, @EntId, @EntTipo)
        `);
    }

    logger.info(`[CONTABILIDAD] ✅ Asiento #${asiId} Registrado. Concepto: "${concepto}" (Debe: $${sumaDebeUYU.toFixed(2)})`);
    return asiId;

  } catch (err) {
    logger.error('[CONTABILIDAD] Fallo al generar asiento:', err.message);
    throw err;
  }
};

/**
 * Utilidad: Desglose Top-Down para precios IVA Incluido (DGI Uruguay).
 */
const desglosarIVA = (totalMonto, tasaIVA = 22) => {
  const monto = parseFloat(totalMonto) || 0;
  if (tasaIVA === 0 || monto === 0) return { neto: monto, ivaMonto: 0 };
  const factor = 1 + (tasaIVA / 100);
  const neto = monto / factor;
  const ivaMonto = monto - (Math.round(neto * 100) / 100);
  return {
    neto:     Math.round(neto     * 100) / 100,
    ivaMonto: Math.round(ivaMonto * 100) / 100
  };
};

/**
 * ¿Existe ya DocumentosContables.DocCotizacion? (script add_DocCotizacion.sql)
 * Se consulta UNA vez por proceso: si el SQL todavía no se corrió en el servidor,
 * la facturación sigue funcionando igual que antes — simplemente no guarda el tipo
 * de cambio — en vez de romperse entera por una columna que falta.
 */
// ¿Existen las columnas del desglose en la línea de factura (DcdTotalRecargos, DcdRecargoPct,
// DcdRecargoStr, DcdDescuentoOrigen; script add_recargos_DocumentosContablesDetalle.sql)?
// Se consulta una vez por proceso; sin las columnas se factura como antes.
let _colsDesglose = null;
const existenColsDesglose = async (nuevoReq) => {
  if (_colsDesglose !== null) return _colsDesglose;
  try {
    const r = await nuevoReq().query(`SELECT COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdTotalRecargos') AS L`);
    _colsDesglose = r.recordset[0]?.L != null;
  } catch {
    _colsDesglose = false;
  }
  if (!_colsDesglose) {
    logger.warn('[CONTABILIDAD] Faltan las columnas de recargo/origen en DocumentosContablesDetalle (correr backend/scripts/add_recargos_DocumentosContablesDetalle.sql): las líneas se guardan sin recargo ni origen.');
  }
  return _colsDesglose;
};

// Redondeos del desglose: importes a 2 decimales, unitarios a 4.
const r2 = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const r4 = n => Math.round((Number(n || 0) + Number.EPSILON) * 10000) / 10000;

// ── Desglose lista / descuento / recargo de una línea de factura, a partir de la línea
// congelada del pedido (specs/09 INV-PRE.03, plan motor-precios-transparencia). ─────────
// `l` = línea de factura { cantidad, total (con IVA, en la moneda del documento) };
// `p` = fila de PedidosCobranzaDetalle. Devuelve los campos a completar, o null cuando el
// pedido no explica el importe cobrado (la línea sale como neto, sin desglose).
// Regla: lista × cant − descuento + recargo = total; el importe del descuento absorbe el
// redondeo (sin descuento, lo absorbe el recargo).
const aplicarDesglosePcd = (l, p, docMon) => {
  const total = Number(l.total) || 0;
  const sub = Number(p.Subtotal) || 0;
  const cant = Number(l.cantidad) || 0;
  if (!(total > 0) || !(sub > 0) || !(cant > 0) || p.PrecioLista == null) return null;
  const monLinea = (p.Moneda || 'UYU').toUpperCase().trim();
  let f = 1;
  if (monLinea !== (docMon || 'UYU').toUpperCase().trim()) f = total / sub;   // cotización implícita ya aplicada
  else if (Math.abs(sub - total) > 0.0101) return null;                        // la factura no cobró lo del pedido
  const lista = r4(Number(p.PrecioLista) * f);
  if (!(lista > 0)) return null;
  const bruto = r2(cant * lista);
  const descImpU = Number(p.DescuentoImporte) || 0;
  const recImpU  = Number(p.RecargoImporte)  || 0;
  let totalRec = r2(recImpU * cant * f);
  let totalDesc = 0;
  if (p.DescuentoTipo && descImpU > 0) {
    totalDesc = r2(bruto + totalRec - total);
    if (totalDesc < 0) return null;
  } else if (recImpU > 0) {
    totalRec = r2(total - bruto);
    if (totalRec < 0) return null;
  } else if (Math.abs(bruto - total) > 0.0101) {
    return null;
  } else {
    totalRec = 0;
  }
  return {
    precioUnitario: lista,
    totalDescuentos: totalDesc,
    descuentoPct: totalDesc > 0 && p.DescuentoPct != null ? Number(p.DescuentoPct) : null,
    descuentoStr: totalDesc > 0 ? (p.DescuentoOrigen || null) : null,
    descuentoOrigen: totalDesc > 0 ? (p.DescuentoOrigen || null) : null,
    totalRecargos: totalRec,
    recargoPct: totalRec > 0 && p.RecargoPct != null ? Number(p.RecargoPct) : null,
    recargoStr: totalRec > 0 ? (p.RecargoOrigen || null) : null,
  };
};

const SQL_PCD_DESGLOSE_COLS = `pcd.ID AS PcdID, pcd.Cantidad, pcd.PrecioUnitario, pcd.Subtotal, pcd.Moneda,
             pcd.PrecioLista, pcd.DescuentoTipo, pcd.DescuentoPct, pcd.DescuentoImporte, pcd.DescuentoOrigen,
             pcd.RecargoPct, pcd.RecargoImporte, pcd.RecargoOrigen`;

// Líneas congeladas del pedido: por ID de línea (cuando la consulta de la factura ya la
// encontró: VEN-/EMB-, NoDocERP = código) y por código de orden vía Ordenes.NoDocERP +
// OrdenID (SUB-/DTF-/EUV-...: el código lleva prefijo y NoDocERP es el número).
const buscarLineasPedido = async (makeReq, { pcdIds = [], codigos = [] }) => {
  const porId = {}, porCodigo = {};
  const ids = pcdIds.map(Number).filter(n => n > 0);
  if (ids.length) {
    const q = await makeReq().query(`SELECT ${SQL_PCD_DESGLOSE_COLS} FROM dbo.PedidosCobranzaDetalle pcd WITH(NOLOCK)
      WHERE pcd.ID IN (${ids.join(',')}) AND pcd.PrecioLista > 0`);
    q.recordset.forEach(r => { porId[r.PcdID] = r; });
  }
  if (codigos.length) {
    const req = makeReq();
    const params = codigos.map((c, i) => { req.input(`c${i}`, sql.VarChar(100), c); return `@c${i}`; });
    const q = await req.query(`
      SELECT LTRIM(RTRIM(o.CodigoOrden)) AS Codigo, ${SQL_PCD_DESGLOSE_COLS}
      FROM dbo.Ordenes o WITH(NOLOCK)
      JOIN dbo.PedidosCobranza pc WITH(NOLOCK)
        ON LTRIM(RTRIM(CAST(pc.NoDocERP AS VARCHAR(100)))) = LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(100))))
      JOIN dbo.PedidosCobranzaDetalle pcd WITH(NOLOCK)
        ON pcd.PedidoCobranzaID = pc.ID AND pcd.OrdenID = o.OrdenID
      WHERE LTRIM(RTRIM(o.CodigoOrden)) IN (${params.join(',')})
        AND ISNULL(pcd.EsHermanaConsolidada, 0) = 0
        AND ISNULL(pcd.EsFacturable, 1) = 1
        AND pcd.PrecioLista > 0`);
    q.recordset.forEach(r => { (porCodigo[r.Codigo] = porCodigo[r.Codigo] || []).push(r); });
  }
  return { porId, porCodigo };
};

// Llave: ConfiguracionGlobal PRECIOS_DESGLOSE_EN_FACTURA = '0' apaga el desglose en
// factura (ausente = encendido).
const leerFlagDesglose = async (makeReq) => {
  try {
    const fr = await makeReq().query("SELECT TOP 1 Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = 'PRECIOS_DESGLOSE_EN_FACTURA'");
    return !(fr.recordset.length && String(fr.recordset[0].Valor || '').trim() === '0');
  } catch { return true; }
};

// Descripción sin la cola que pegaba el fallback (nombre del cliente del carrito o texto
// del motor): queda "Orden: X (trabajo) - Retiro RW-n" y, si hay, la línea "Tecnico: ...".
const limpiarDscDesglose = (s) => {
  const ls = String(s || '').split(/\r?\n/);
  if (ls.length <= 1) return s;
  return [ls[0], ...ls.slice(1).filter(x => /^\s*Tecnico:/i.test(x))].join('\r\n');
};

// [POR ÁREA] "Comprar y personalizar" / prenda del cliente cobrado por área: lo único que pasa
// por Depósito es la PRO madre, así que la factura sale con UNA línea genérica por el total del
// pedido. La línea se deja así (importe, cantidad y producto no cambian: cuadra contra lo cobrado
// y DGI), pero a la descripción se le agrega el detalle de lo facturado: una fila por cada línea
// facturable de la cotización ("Bordado sobre prenda 100% hilo: 3 × 100,00 = 300,00").
const fmtNum = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const agregarDetallePorArea = async (makeReq, lineas) => {
  const codigos = [...new Set(lineas.map(l => String(l.ordCodigoOrden || '').trim()).filter(Boolean))];
  if (!codigos.length) return lineas;
  try {
    const req = makeReq();
    const params = codigos.map((c, i) => { req.input(`pa${i}`, sql.VarChar(100), c); return `@pa${i}`; });
    const q = await req.query(`
      SELECT LTRIM(RTRIM(o.CodigoOrden)) AS Codigo, pcd.ID, pcd.Cantidad, pcd.PrecioUnitario, pcd.Subtotal, pcd.Moneda,
             LTRIM(RTRIM(ISNULL(a.Descripcion, pcd.CodArticulo))) AS Articulo, LTRIM(RTRIM(ISNULL(ar.Nombre, ol.AreaID))) AS Area
      FROM dbo.Ordenes o WITH(NOLOCK)
      JOIN dbo.PedidosCobranza pc WITH(NOLOCK)
        ON LTRIM(RTRIM(CAST(pc.NoDocERP AS VARCHAR(100)))) = LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(100))))
      JOIN dbo.PedidosCobranzaDetalle pcd WITH(NOLOCK) ON pcd.PedidoCobranzaID = pc.ID
      LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = pcd.ProIdProducto
      LEFT JOIN dbo.Ordenes ol WITH(NOLOCK) ON ol.OrdenID = pcd.OrdenID
      LEFT JOIN dbo.Areas ar WITH(NOLOCK) ON LTRIM(RTRIM(ar.AreaID)) = LTRIM(RTRIM(ol.AreaID))
      WHERE LTRIM(RTRIM(o.CodigoOrden)) IN (${params.join(',')})
        AND o.AreaID = 'PRO' AND o.ComboItemID IS NULL AND ISNULL(o.EstadoDependencia, '') <> 'VENTA_DIRECTA'
        AND o.Nota LIKE '%[[]FACTURA POR AREA]%'
        AND ISNULL(pcd.EsHermanaConsolidada, 0) = 0
        AND ISNULL(pcd.EsFacturable, 1) = 1
        AND ISNULL(pcd.Subtotal, 0) > 0
      ORDER BY pc.ID DESC, pcd.ID`);
    if (!q.recordset.length) return lineas;
    const porCodigo = {};
    q.recordset.forEach(r => { (porCodigo[r.Codigo] = porCodigo[r.Codigo] || []).push(r); });
    return lineas.map(l => {
      const det = porCodigo[String(l.ordCodigoOrden || '').trim()];
      if (!det || !det.length) return l;
      const filas = det.map(d => `- ${d.Area ? d.Area + ': ' : ''}${d.Articulo || 'Servicio'}: ${Number(d.Cantidad) % 1 === 0 ? Number(d.Cantidad) : fmtNum(d.Cantidad)} × ${fmtNum(d.PrecioUnitario)} = ${String(d.Moneda || '').trim()} ${fmtNum(d.Subtotal)}`);
      const extra = `\r\nDetalle facturado:\r\n${filas.join('\r\n')}`;
      return { ...l, dscItem: (String(l.dscItem || '') + extra).substring(0, 1000) };
    });
  } catch (e) {
    logger.warn('[resolverLineasDetalle] Detalle por área no disponible: ' + e.message);
    return lineas;
  }
};

/**
 * Completa el desglose (lista / descuento / recargo) en las líneas YA insertadas de un
 * documento, buscando la línea congelada del pedido por código de orden. Para los flujos
 * que insertan sus líneas con SQL propio (Pedido Caja por pago de deuda). Solo toca líneas
 * sin descuento ni recargo; nunca cambia DcdTotal. Devuelve cuántas líneas completó.
 */
const enriquecerLineasDocumento = async (docId, transaction = null) => {
  const pool = transaction ? null : await getPool();
  const makeReq = () => (transaction ? new sql.Request(transaction) : pool.request());
  if (!(await existenColsDesglose(makeReq))) return 0;
  if (!(await leerFlagDesglose(makeReq))) return 0;
  const cab = await makeReq().input('id', sql.Int, docId).query('SELECT MonIdMoneda FROM dbo.DocumentosContables WHERE DocIdDocumento = @id');
  if (!cab.recordset.length) return 0;
  const docMon = cab.recordset[0].MonIdMoneda === 2 ? 'USD' : 'UYU';
  const lin = await makeReq().input('id', sql.Int, docId).query(`
    SELECT DcdIdDetalle, OrdCodigoOrden, DcdCantidad, DcdTotal, DcdDscItem
    FROM dbo.DocumentosContablesDetalle
    WHERE DocIdDocumento = @id AND OrdCodigoOrden IS NOT NULL
      AND ISNULL(DcdTotalDescuentos, 0) = 0 AND ISNULL(DcdTotalRecargos, 0) = 0`);
  const codigos = [...new Set(lin.recordset.map(r => String(r.OrdCodigoOrden || '').trim()).filter(Boolean))];
  if (!codigos.length) return 0;
  const idx = await buscarLineasPedido(makeReq, { codigos });
  let n = 0;
  for (const r of lin.recordset) {
    const cands = idx.porCodigo[String(r.OrdCodigoOrden || '').trim()];
    if (!cands || cands.length !== 1) continue;
    const dz = aplicarDesglosePcd({ cantidad: Number(r.DcdCantidad), total: Number(r.DcdTotal) }, cands[0], docMon);
    if (!dz) continue;
    await makeReq()
      .input('id', sql.Int, r.DcdIdDetalle)
      .input('pu', sql.Decimal(18, 4), dz.precioUnitario)
      .input('desc', sql.Decimal(18, 4), dz.totalDescuentos)
      .input('descPct', sql.Decimal(9, 4), dz.descuentoPct)
      .input('descStr', sql.VarChar(100), dz.descuentoStr ? String(dz.descuentoStr).substring(0, 100) : null)
      .input('descOrig', sql.NVarChar(150), dz.descuentoOrigen ? String(dz.descuentoOrigen).substring(0, 150) : null)
      .input('rec', sql.Decimal(18, 2), dz.totalRecargos)
      .input('recPct', sql.Decimal(9, 4), dz.recargoPct)
      .input('recStr', sql.VarChar(200), dz.recargoStr ? String(dz.recargoStr).substring(0, 200) : null)
      .input('dsc', sql.NVarChar(1000), limpiarDscDesglose(r.DcdDscItem) || null)
      .query(`UPDATE dbo.DocumentosContablesDetalle
              SET DcdPrecioUnitario = @pu, DcdTotalDescuentos = @desc, DcdDescuentoPct = @descPct, DcdDescuentoStr = @descStr,
                  DcdDescuentoOrigen = @descOrig, DcdTotalRecargos = @rec, DcdRecargoPct = @recPct, DcdRecargoStr = @recStr,
                  DcdDscItem = @dsc
              WHERE DcdIdDetalle = @id`);
    n++;
  }
  return n;
};

let _colDocCotizacion = null;
const existeColDocCotizacion = async (nuevoReq) => {
  if (_colDocCotizacion !== null) return _colDocCotizacion;
  try {
    const r = await nuevoReq().query(`SELECT COL_LENGTH('dbo.DocumentosContables', 'DocCotizacion') AS L`);
    _colDocCotizacion = r.recordset[0]?.L != null;
  } catch {
    _colDocCotizacion = false;
  }
  if (!_colDocCotizacion) {
    logger.warn('[CONTABILIDAD] Falta la columna DocumentosContables.DocCotizacion (correr backend/scripts/add_DocCotizacion.sql): los documentos se emiten sin guardar el tipo de cambio.');
  }
  return _colDocCotizacion;
};

/**
 * Tipo de cambio a estampar en el documento:
 *   · el que informó quien emite (el realmente aplicado en la conversión), o
 *   · si no informó, la última cotización registrada (referencia del día).
 */
const resolverCotizacionDoc = async (nuevoReq, valor) => {
  const informada = Number(valor);
  if (informada > 0) return informada;
  try {
    const r = await nuevoReq().query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC');
    const c = Number(r.recordset[0]?.CotDolar);
    return c > 0 ? c : null;
  } catch {
    return null;
  }
};

const crearDocumentoContable = async ({ header, lineas }, transaction = null) => {
  const requiredFields = { cueIdCuenta: header.cueIdCuenta, clienteId: header.clienteId, monedaId: header.monedaId, tipo: header.tipo, numero: header.numero, serie: header.serie, usuarioId: header.usuarioId };
  const missing = Object.entries(requiredFields).filter(([,v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`[crearDocumentoContable] Faltan parámetros obligatorios: ${missing.join(', ')}. Valores: ${JSON.stringify(requiredFields)}`);
  }

  const pool = transaction ? null : await getPool();
  const nuevoReq = () => (transaction ? new sql.Request(transaction) : pool.request());
  const request = nuevoReq();

  // Tipo de cambio con el que se emite este documento (columna opcional DocCotizacion).
  const guardaCotizacion = await existeColDocCotizacion(nuevoReq);
  const docCotizacion = guardaCotizacion
    ? await resolverCotizacionDoc(nuevoReq, header.docCotizacion)
    : null;

  const totalDescuentos = header.totalDescuentos !== undefined ? header.totalDescuentos : 0;
  const totalRecargos = header.totalRecargos !== undefined ? header.totalRecargos : 0;
  let estado = header.estado !== undefined ? String(header.estado).toUpperCase().trim() : 'PAGADO';
  if (estado === 'COBRADO' || estado === '1' || estado === 'PAGADO') {
    estado = 'PAGADO';
  } else if (estado === '0' || estado === 'ANULADO') {
    estado = 'ANULADO';
  }
  const cfeEstado = header.cfeEstado !== undefined && header.cfeEstado !== null ? String(header.cfeEstado) : null;
  const tcaIdTransaccion = header.tcaIdTransaccion !== undefined ? header.tcaIdTransaccion : null;
  const asiIdAsiento = header.asiIdAsiento !== undefined ? header.asiIdAsiento : null;
  const observaciones = header.observaciones !== undefined && header.observaciones !== null ? String(header.observaciones) : null;
  const docPagado = header.docPagado !== undefined ? (header.docPagado ? 1 : 0) : 0;
  const docIdDocumentoRef = header.docIdDocumentoRef !== undefined ? header.docIdDocumentoRef : null;
  const docMotivoRef = header.docMotivoRef !== undefined && header.docMotivoRef !== null ? String(header.docMotivoRef) : null;
  const cicIdCiclo = header.cicIdCiclo !== undefined ? header.cicIdCiclo : null;
  const docFechaDesde = header.docFechaDesde !== undefined ? header.docFechaDesde : null;
  const docFechaHasta = header.docFechaHasta !== undefined ? header.docFechaHasta : null;
  // Fecha de emisión editable: si no viene, la BD aplica GETDATE() (comportamiento actual)
  const docFechaEmision = header.docFechaEmision !== undefined && header.docFechaEmision !== null ? header.docFechaEmision : null;
  const docCliNombre = header.docCliNombre !== undefined && header.docCliNombre !== null ? String(header.docCliNombre) : null;
  const docCliDocumento = header.docCliDocumento !== undefined && header.docCliDocumento !== null ? String(header.docCliDocumento) : null;
  // Nombre de fantasía DEL COMPROBANTE (no de la ficha del cliente): al facturar a un
  // tercero se imprime lo que se escribió acá; vacío => el PDF no dibuja esa línea.
  const docCliNombreFantasia = header.docCliNombreFantasia !== undefined && header.docCliNombreFantasia !== null ? String(header.docCliNombreFantasia) : null;
  const docCliDireccion = header.docCliDireccion !== undefined && header.docCliDireccion !== null ? String(header.docCliDireccion) : null;
  const docCliCiudad = header.docCliCiudad !== undefined && header.docCliCiudad !== null ? String(header.docCliCiudad) : null;
  // Multiempresa: se acepta empresaId; cuando es null la BD aplica el DEFAULT (empresa primaria)
  const empresaId = header.empresaId !== undefined ? header.empresaId : null;

  const resCab = await request
    .input('Cue', sql.Int, header.cueIdCuenta)
    .input('Cli', sql.Int, header.clienteId)
    .input('MonId', sql.Int, header.monedaId)
    .input('Tipo', sql.VarChar(50), String(header.tipo))
    .input('Num', sql.VarChar(50), String(header.numero))
    .input('Serie', sql.VarChar(10), String(header.serie))
    .input('Sub', sql.Decimal(18, 4), header.subtotal)
    .input('Imp', sql.Decimal(18, 4), header.impuestos)
    .input('TotalDesc', sql.Decimal(18, 4), totalDescuentos)
    .input('TotalRec', sql.Decimal(18, 4), totalRecargos)
    .input('Tot', sql.Decimal(18, 4), header.total)
    .input('Estado', sql.VarChar(20), estado)
    .input('CfeEstado', sql.VarChar(20), cfeEstado)
    .input('Usr', sql.Int, header.usuarioId)
    .input('TcaId', sql.Int, tcaIdTransaccion)
    .input('AsiId', sql.Int, asiIdAsiento)
    .input('Obs', sql.NVarChar(500), observaciones)
    .input('Pagado', sql.Bit, docPagado)
    .input('DocRef', sql.Int, docIdDocumentoRef)
    .input('MotRef', sql.NVarChar(300), docMotivoRef)
    .input('CicId', sql.Int, cicIdCiclo)
    .input('FDesde', sql.DateTime, docFechaDesde ? new Date(docFechaDesde) : null)
    .input('FHasta', sql.DateTime, docFechaHasta ? new Date(docFechaHasta) : null)
    .input('FEmis', sql.DateTime, docFechaEmision ? new Date(docFechaEmision) : null)
    // Largos al tamaño real de columna (Nombre/Direccion 255, Documento 50): declararlos
    // más cortos hacía fallar el request con "invalid data length" ante un valor largo.
    .input('CliNombre', sql.NVarChar(255), docCliNombre != null ? String(docCliNombre).substring(0, 255) : null)
    .input('CliDoc', sql.NVarChar(50), docCliDocumento != null ? String(docCliDocumento).substring(0, 50) : null)
    .input('CliFant', sql.NVarChar(200), docCliNombreFantasia != null ? String(docCliNombreFantasia).substring(0, 200) : null)
    .input('CliDir', sql.NVarChar(255), docCliDireccion != null ? String(docCliDireccion).substring(0, 255) : null)
    .input('CliCiu', sql.NVarChar(100), docCliCiudad != null ? String(docCliCiudad).substring(0, 100) : null)
    .input('Emp', sql.Int, empresaId || null)
    .input('Cotiz', sql.Decimal(18, 4), docCotizacion)
    .query(`
      INSERT INTO dbo.DocumentosContables
        (CueIdCuenta, CliIdCliente, MonIdMoneda, DocTipo, DocNumero, DocSerie,
         DocSubtotal, DocImpuestos, DocTotalDescuentos, DocTotalRecargos, DocTotal,
         DocEstado, CfeEstado, DocFechaEmision, DocUsuarioAlta, TcaIdTransaccion, AsiIdAsiento,
         DocObservaciones, DocPagado, DocIdDocumentoRef, DocMotivoRef, CicIdCiclo, DocFechaDesde, DocFechaHasta,
         DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad, DocCliNombreFantasia, EmpIdEmpresa${guardaCotizacion ? ', DocCotizacion' : ''})
      OUTPUT INSERTED.DocIdDocumento
      VALUES
        (@Cue, @Cli, @MonId, @Tipo, @Num, @Serie,
         @Sub, @Imp, @TotalDesc, @TotalRec, @Tot,
         @Estado, @CfeEstado, ISNULL(@FEmis, GETDATE()), @Usr, @TcaId, @AsiId,
         @Obs, @Pagado, @DocRef, @MotRef, @CicId, @FDesde, @FHasta,
         @CliNombre, @CliDoc, @CliDir, @CliCiu, @CliFant, ISNULL(@Emp, (SELECT TOP 1 EmpIdEmpresa FROM dbo.Empresas WHERE EmpPorDefecto=1))${guardaCotizacion ? ', @Cotiz' : ''})
    `);

  const docId = resCab.recordset[0].DocIdDocumento;

  if (Array.isArray(lineas) && lineas.length > 0) {
    for (const linea of lineas) {
      if (!linea.nomItem || linea.cantidad === undefined || linea.precioUnitario === undefined || linea.subtotal === undefined || linea.total === undefined) {
        throw new Error('[crearDocumentoContable] Falta algún parámetro obligatorio en una línea de detalle.');
      }
      
      const reqLine = transaction ? new sql.Request(transaction) : pool.request();
      const dscItem = linea.dscItem !== undefined ? linea.dscItem : null;
      const lineImpuestos = linea.impuestos !== undefined ? linea.impuestos : 0;
      const ordCodigoOrden = linea.ordCodigoOrden !== undefined ? linea.ordCodigoOrden : null;
      const lineTotalDescuentos = linea.totalDescuentos !== undefined ? linea.totalDescuentos : 0;
      const lineDescuentoStr = linea.descuentoStr !== undefined ? linea.descuentoStr : null;
      // % de descuento tal cual lo tipeó el usuario. Se guarda aparte porque
      // recalcularlo desde los importes (que van redondeados a 2 decimales) devuelve
      // valores como 10,03% donde el usuario había puesto 10%.
      const lineDescuentoPct = (linea.descuentoPct !== undefined && linea.descuentoPct !== null && Number(linea.descuentoPct) > 0)
        ? Number(linea.descuentoPct)
        : null;
      // Recargo por línea (urgencia, tinta, manual) y origen del descuento. Convención de la
      // línea (todo con IVA): DcdCantidad × DcdPrecioUnitario(lista) − DcdTotalDescuentos +
      // DcdTotalRecargos = DcdTotal. Columnas del script add_recargos_DocumentosContablesDetalle.sql.
      const conDesglose = await existenColsDesglose(nuevoReq);
      const lineTotalRecargos = (linea.totalRecargos !== undefined && linea.totalRecargos !== null) ? Number(linea.totalRecargos) : 0;
      const lineRecargoPct = (linea.recargoPct !== undefined && linea.recargoPct !== null && Number(linea.recargoPct) > 0) ? Number(linea.recargoPct) : null;
      const lineRecargoStr = linea.recargoStr !== undefined && linea.recargoStr !== null ? String(linea.recargoStr).substring(0, 200) : null;
      const lineDescuentoOrigen = linea.descuentoOrigen !== undefined && linea.descuentoOrigen !== null ? String(linea.descuentoOrigen).substring(0, 150) : null;

      reqLine
        .input('DocId', sql.Int, docId)
        .input('OrdCod', sql.VarChar(100), ordCodigoOrden)
        .input('Nom', sql.NVarChar(255), linea.nomItem.substring(0, 255))
        .input('Dsc', sql.NVarChar(1000), dscItem ? dscItem.substring(0, 1000) : null)
        .input('Cant', sql.Decimal(18, 4), linea.cantidad)
        .input('Precio', sql.Decimal(18, 4), linea.precioUnitario)
        .input('Sub', sql.Decimal(18, 2), linea.subtotal)
        .input('Imp', sql.Decimal(18, 2), lineImpuestos)
        .input('Tot', sql.Decimal(18, 2), linea.total)
        .input('TotalDesc', sql.Decimal(18, 4), lineTotalDescuentos)
        .input('DescStr', sql.VarChar(100), lineDescuentoStr)
        .input('DescPct', sql.Decimal(9, 4), lineDescuentoPct);
      if (conDesglose) {
        reqLine
          .input('TotalRec', sql.Decimal(18, 2), lineTotalRecargos)
          .input('RecPct', sql.Decimal(9, 4), lineRecargoPct)
          .input('RecStr', sql.VarChar(200), lineRecargoStr)
          .input('DescOrig', sql.NVarChar(150), lineDescuentoOrigen);
      }
      await reqLine.query(`
          INSERT INTO dbo.DocumentosContablesDetalle
            (DocIdDocumento, OrdCodigoOrden, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr, DcdDescuentoPct${conDesglose ? ', DcdTotalRecargos, DcdRecargoPct, DcdRecargoStr, DcdDescuentoOrigen' : ''})
          VALUES
            (@DocId, @OrdCod, @Nom, @Dsc, @Cant, @Precio, @Sub, @Imp, @Tot, @TotalDesc, @DescStr, @DescPct${conDesglose ? ', @TotalRec, @RecPct, @RecStr, @DescOrig' : ''})
        `);
    }

    // Área/variante/artículo de cada línea, para que la venta sepa a qué área y
    // sector pertenece sin adivinarlo después al leer (ver areaLineaService).
    // No corta el alta si falla: el área es un dato de reporte, recuperable.
    await estamparAreaLineas(docId, transaction);
  }

  return docId;
};

/**
 * resolverLineasDetalle
 * ─────────────────────────────────────────────────────────────────────────────
 * Lógica intermedia centralizada para construir el array `lineas` que se
 * pasa a crearDocumentoContable.
 *
 * Soporta dos modos (mutuamente excluyentes):
 *  - { tcaIdTransaccion }  → lee TransaccionDetalle y resuelve órdenes:
 *       Modo moderno: via RelOrdenesRetiroOrdenes → OrdenesDeposito
 *       Fallback legacy: od.OReIdOrdenRetiro = td.TdeReferenciaId (órdenes viejas sin Rel)
 *       Si la referencia es ORDEN_DEPOSITO directa también la resuelve.
 *       Si hay PedidosCobranzaDetalle lo usa; sino fallback a campos de OrdenesDeposito.
 *
 *  - { orderIds: number[] } → resuelve directamente desde OrdenesDeposito por OrdIdOrden
 *       Usado por generarCFEDesdeOrdenesDirectas.
 *
 * @param {object}  opts
 * @param {number}  [opts.tcaIdTransaccion]
 * @param {number[]}[opts.orderIds]
 * @param {object}  transaction  - Transacción mssql activa (o null para usar pool)
 * @returns {Promise<object[]>}  Array de líneas formateadas para crearDocumentoContable
 */
const resolverLineasDetalle = async ({ tcaIdTransaccion, orderIds, monedaFactura = 'UYU' } = {}, transaction = null) => {
  const pool = transaction ? null : await getPool();
  const makeReq = () => transaction ? new sql.Request(transaction) : pool.request();

  // Convierte cada línea a la moneda del documento.
  // PRIORIDAD: la cotización IMPLÍCITA del cobro (totalCobrado ÷ suma de las líneas en la
  // otra moneda) — la tasa a la que la plata entró DE VERDAD. Motivo: MercadoPago cobra
  // los pedidos USD en pesos con SU cotización (verificado: 40,41 fija jun–ago mientras
  // la nuestra iba 40,7–40,9); convertir con la cotización del día dejaba las líneas ~1%
  // arriba de lo cobrado y el documento descuadrado contra DGI. Con la implícita, las
  // líneas suman exactamente lo cobrado, venga de MP, Handy o cajero con cotización BCU.
  // FALLBACK a la cotización del día (comportamiento histórico): sin transacción (MODO 2,
  // todavía no hay cobro), sin líneas en otra moneda, o implícita fuera de ±25% de la del
  // día — dato roto: mejor la línea "de mercado" y que el cuadre pre-DGI frene el envío,
  // a fabricar una línea absurda que lo disimule.
  const aplicarCotizacion = async (recordset, totalCobrado = null) => {
    const docMon = (monedaFactura || 'UYU').toUpperCase().trim();
    const esForanea = (r) => {
      const lineMon = (r.MonedaPC || 'UYU').toUpperCase().trim();
      return lineMon !== docMon && (lineMon === 'USD' || lineMon === 'UYU');
    };
    if (!recordset.some(esForanea)) return recordset;
    const cotRes = await makeReq()
      .query("SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC");
    const cot = parseFloat(cotRes.recordset[0]?.CotDolar) || 40;
    const factorDia = docMon === 'USD' ? 1 / cot : cot;

    let factor = factorDia;
    if (Number.isFinite(totalCobrado) && totalCobrado > 0) {
      const sumaPropia  = recordset.filter(r => !esForanea(r)).reduce((a, r) => a + (parseFloat(r.Total) || 0), 0);
      const sumaForanea = recordset.filter(esForanea).reduce((a, r) => a + (parseFloat(r.Total) || 0), 0);
      const restante = totalCobrado - sumaPropia;
      if (sumaForanea > 0 && restante > 0) {
        const factorImplicito = restante / sumaForanea;
        if (factorImplicito >= factorDia * 0.75 && factorImplicito <= factorDia * 1.25) {
          factor = factorImplicito;
        } else {
          logger.warn(`[resolverLineasDetalle] Cotización implícita del cobro fuera de rango ` +
            `(implícita ${factorImplicito.toFixed(4)} vs día ${factorDia.toFixed(4)}): se usa la del día. ` +
            `El cuadre pre-DGI va a frenar este documento si no cierra.`);
        }
      }
    }
    return recordset.map(r => (esForanea(r) ? { ...r, _factor: factor } : r));
  };

  const mapLinea = (r) => {
    const f = r._factor || 1;
    return {
      _pcdId:         r.PcdID || null,      // línea del pedido ya encontrada por la consulta (VEN-/EMB-)
      ordCodigoOrden: r.OrdCodigoOrden  || null,
      nomItem:        (r.NomItem        || 'Servicio').substring(0, 80),
      dscItem:        (r.DscItem        || '').substring(0, 1000),
      cantidad:       parseFloat(r.Cantidad)       || 1,
      precioUnitario: parseFloat((parseFloat(r.PrecioUnitario || 0) * f).toFixed(4)),
      subtotal:       parseFloat((parseFloat(r.Subtotal        || 0) * f).toFixed(2)),
      impuestos:      parseFloat((parseFloat(r.Impuestos       || 0) * f).toFixed(2)),
      total:          parseFloat((parseFloat(r.Total           || 0) * f).toFixed(2)),
    };
  };

  // ── DESGLOSE lista / descuento / recargo (specs/09 §5, plan motor-precios-transparencia) ──
  // Las consultas de arriba NO cambian (importes, cantidad y total siguen siendo los de
  // siempre: es lo que cuadra contra lo cobrado y contra DGI). Acá, a posteriori, se busca
  // la línea congelada del pedido de cada orden por Ordenes.NoDocERP + OrdenID (el cruce
  // por código con prefijo nunca la encontraba) y, SOLO si esa línea explica exactamente el
  // importe de la factura, se completa: unitario = LISTA, descuento (importe, %, origen) y
  // recargo (importe, %, texto). El importe del descuento absorbe el redondeo. Si la orden
  // tiene varias líneas (material + servicios), o el pedido no cierra contra el importe,
  // la línea sale como hoy (neto, sin desglose). Llave: ConfiguracionGlobal
  // PRECIOS_DESGLOSE_EN_FACTURA = '0' lo apaga (ausente = encendido).
  const docMonDesglose = (monedaFactura || 'UYU').toUpperCase().trim();
  const enriquecerConDesglose = async (lineas) => {
    if (!lineas.length) return lineas;
    const sinId = (l) => { const { _pcdId, ...resto } = l; return resto; };
    if (!(await leerFlagDesglose(makeReq))) return lineas.map(sinId);
    const pcdIds = [...new Set(lineas.map(l => l._pcdId).filter(Boolean))];
    const codigos = [...new Set(lineas.filter(l => !l._pcdId).map(l => String(l.ordCodigoOrden || '').trim()).filter(Boolean))];
    if (!pcdIds.length && !codigos.length) return lineas.map(sinId);
    let idx;
    try {
      idx = await buscarLineasPedido(makeReq, { pcdIds, codigos });
    } catch (e) {
      logger.warn('[resolverLineasDetalle] Desglose no disponible (¿faltan columnas de add_desglose_PedidosCobranzaDetalle.sql?): ' + e.message);
      return lineas.map(sinId);
    }
    return lineas.map(l => {
      let p = null;
      if (l._pcdId) {
        p = idx.porId[l._pcdId] || null;
      } else {
        const cands = idx.porCodigo[String(l.ordCodigoOrden || '').trim()];
        if (cands && cands.length === 1) p = cands[0];       // varias líneas (material + servicios): sin desglose
      }
      const dz = p ? aplicarDesglosePcd(l, p, docMonDesglose) : null;
      if (!dz) return sinId(l);
      return { ...sinId(l), dscItem: limpiarDscDesglose(l.dscItem), ...dz };
    });
  };

  // ── MODO 1: desde TransaccionDetalle ──────────────────────────────────────
  if (tcaIdTransaccion) {
    const res = await makeReq()
      .input('tcaId', sql.Int, tcaIdTransaccion)
      .query(`
        SELECT
          pcd.ID AS PcdID,
          ISNULL(od.OrdCodigoOrden, td.TdeCodigoReferencia) AS OrdCodigoOrden,
          LEFT(COALESCE(
               NULLIF(NULLIF(LTRIM(RTRIM(art.Descripcion)), 'Articulos User'), 'Articulos User USD'),
               NULLIF(NULLIF(LTRIM(RTRIM(artod.Descripcion)), 'Articulos User'), 'Articulos User USD'),
               NULLIF(LTRIM(RTRIM(od.OrdMaterialPlanilla)), ''),
               od.OrdNombreTrabajo,
               td.TdeDescripcion,
               'Servicios de Produccion'
           ), 80) AS NomItem,
          LEFT(
              'Orden: ' + ISNULL(od.OrdCodigoOrden, td.TdeCodigoReferencia)
              + ISNULL(' (' + od.OrdNombreTrabajo + ')', '')
              -- Nº de retiro SIEMPRE en la línea: los webhooks (Handy/MP) lo mandan en
              -- TdeDescripcion ("Retiro diferido RW-x") pero caja manda otro texto y el
              -- RW se perdía. Solo se agrega si ningún texto de la línea ya trae "RW-".
              + CASE WHEN td.TdeTipoReferencia = 'ORDEN_RETIRO'
                          AND ISNULL(od.OrdCodigoOrden, td.TdeCodigoReferencia) NOT LIKE '%RW-%'
                          AND COALESCE(CAST(pcd.LogPrecioAplicado AS VARCHAR(1000)), CAST(td.TdeDescripcion AS VARCHAR(1000)), '') NOT LIKE '%RW-%'
                     THEN ' - Retiro RW-' + CAST(td.TdeReferenciaId AS VARCHAR(20)) ELSE '' END
              + CHAR(13)+CHAR(10)
              + ISNULL('Tecnico: ' + CAST(pcd.DatoTecnico AS VARCHAR(1000)) + CHAR(13)+CHAR(10), '')
              + ISNULL(CAST(pcd.LogPrecioAplicado AS VARCHAR(1000)), ISNULL(CAST(td.TdeDescripcion AS VARCHAR(1000)), '')),
          1000) AS DscItem,
          CAST(ISNULL(pcd.Cantidad, ISNULL(od.OrdCantidad, 1.0)) AS DECIMAL(18,4)) AS Cantidad,
          ROUND(COALESCE(pcd.Subtotal, NULLIF(od.OrdCostoFinal, 0), td.TdeImporteFinal, 0)
                / NULLIF(ISNULL(pcd.Cantidad, ISNULL(od.OrdCantidad, 1.0)), 0), 4) AS PrecioUnitario,
          ROUND(COALESCE(pcd.Subtotal, NULLIF(od.OrdCostoFinal, 0), td.TdeImporteFinal, 0) / 1.22, 2) AS Subtotal,
          ROUND(COALESCE(pcd.Subtotal, NULLIF(od.OrdCostoFinal, 0), td.TdeImporteFinal, 0)
                - COALESCE(pcd.Subtotal, NULLIF(od.OrdCostoFinal, 0), td.TdeImporteFinal, 0) / 1.22, 2) AS Impuestos,
          COALESCE(pcd.Subtotal, NULLIF(od.OrdCostoFinal, 0), td.TdeImporteFinal, 0) AS Total,
          CASE WHEN od.MonIdMoneda = 2 THEN 'USD'
               WHEN od.MonIdMoneda = 1 THEN 'UYU'
               ELSE ISNULL(pc.Moneda, ISNULL(pcd.Moneda, 'UYU')) END AS MonedaPC
        FROM dbo.TransaccionDetalle td
        -- Intento 1: relacion moderna por tabla intermedia
        LEFT JOIN dbo.RelOrdenesRetiroOrdenes rel
          ON rel.OReIdOrdenRetiro = td.TdeReferenciaId
          AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
        -- OrdenesDeposito: moderno via rel | LEGACY FALLBACK via OReIdOrdenRetiro | directo si ORDEN_DEPOSITO
        LEFT JOIN dbo.OrdenesDeposito od ON (
            (td.TdeTipoReferencia = 'ORDEN_RETIRO'   AND rel.OrdIdOrden IS NOT NULL AND od.OrdIdOrden = rel.OrdIdOrden)
         OR (td.TdeTipoReferencia = 'ORDEN_RETIRO'   AND rel.OrdIdOrden IS NULL     AND od.OReIdOrdenRetiro = td.TdeReferenciaId)
         OR (td.TdeTipoReferencia = 'ORDEN_DEPOSITO' AND od.OrdIdOrden = td.TdeReferenciaId)
        )
        LEFT JOIN dbo.PedidosCobranza pc ON CAST(pc.NoDocERP AS VARCHAR(100)) =
            LEFT(ISNULL(od.OrdCodigoOrden, CAST(td.TdeCodigoReferencia AS VARCHAR(100))),
                 CASE WHEN CHARINDEX(' ', ISNULL(od.OrdCodigoOrden, CAST(td.TdeCodigoReferencia AS VARCHAR(100)))) > 0
                      THEN CHARINDEX(' ', ISNULL(od.OrdCodigoOrden, CAST(td.TdeCodigoReferencia AS VARCHAR(100)))) - 1
                      ELSE LEN(ISNULL(od.OrdCodigoOrden, CAST(td.TdeCodigoReferencia AS VARCHAR(100)))) END)
        -- "Comprar y personalizar": PedidosCobranzaDetalle puede tener, para el mismo
        -- pedido, la línea de PRO (ya consolidada, lo que se factura) MÁS las líneas de
        -- sus hermanas EMB/DF/TPU/EST (guardadas para detalle futuro, EsHermanaConsolidada=1,
        -- ya sumadas DENTRO del subtotal de PRO). Sin este filtro, el join fanea a una fila
        -- por cada línea del pedido y duplica el ítem de la factura.
        LEFT JOIN dbo.PedidosCobranzaDetalle pcd ON pcd.PedidoCobranzaID = pc.ID AND ISNULL(pcd.EsHermanaConsolidada, 0) = 0 AND ISNULL(pcd.EsFacturable, 1) = 1
        LEFT JOIN dbo.Articulos art    ON art.ProIdProducto   = ISNULL(pcd.ProIdProducto, od.ProIdProducto)
        LEFT JOIN dbo.Articulos artod  ON artod.ProIdProducto = od.ProIdProducto
        WHERE td.TcaIdTransaccion = @tcaId
          AND td.TdeTipoReferencia IN ('ORDEN_RETIRO', 'ORDEN_DEPOSITO')
          -- Excluir REPOSICIONES sin cargo (código -R# y sin precio propio): son
          -- re-trabajos gratis (OrdCostoFinal = 0). Si se dejaran, el COALESCE de
          -- arriba cae a td.TdeImporteFinal (el total del pedido ENTERO) e infla la
          -- factura; y una línea en 0 la rechaza DGI. Un 0 en una orden que NO es
          -- reposición SÍ se deja pasar (señal de error, no se oculta).
          AND NOT (
                ISNULL(od.OrdCodigoOrden, CAST(td.TdeCodigoReferencia AS VARCHAR(100))) LIKE '%-R[0-9]%'
            AND ISNULL(pcd.Subtotal, 0)     = 0
            AND ISNULL(od.OrdCostoFinal, 0) = 0
          )
          -- Excluir órdenes CUBIERTAS POR ROLLO/PLAN (sin cargo): OrdCostoFinal = 0
          -- (el motor de check-in deja 0 cuando el plan de metros cubrió la orden,
          -- misma señal que usa crearRetiro) y sin precio propio en PedidosCobranza.
          -- Si se dejaran, el COALESCE cae a td.TdeImporteFinal (total de la
          -- transacción) y cada orden cubierta sale facturada por el TOTAL del
          -- retiro (factura inflada N×). Solo aplica cuando la orden existe: las
          -- líneas legacy sin orden (od NULL) siguen usando td.TdeImporteFinal.
          AND NOT (
                od.OrdIdOrden IS NOT NULL
            AND ISNULL(od.OrdCostoFinal, 0) = 0
            AND ISNULL(pcd.Subtotal, 0)     = 0
          )
      `);

    // Lo COBRADO por estas referencias, en la moneda del documento: es la base de la
    // cotización implícita de aplicarCotizacion (las líneas deben sumar esta plata).
    const totRes = await makeReq()
      .input('tcaId', sql.Int, tcaIdTransaccion)
      .query(`SELECT SUM(TdeImporteFinal) AS Total FROM dbo.TransaccionDetalle WITH(NOLOCK)
              WHERE TcaIdTransaccion = @tcaId
                AND TdeTipoReferencia IN ('ORDEN_RETIRO', 'ORDEN_DEPOSITO')`);
    const totalCobrado = parseFloat(totRes.recordset[0]?.Total);

    const withCot = await aplicarCotizacion(res.recordset, totalCobrado);
    return await agregarDetallePorArea(makeReq, await enriquecerConDesglose(withCot.map(mapLinea)));
  }

  // ── MODO 2: desde array de OrdIdOrden (generarCFEDesdeOrdenesDirectas) ────
  if (orderIds && orderIds.length > 0) {
    const idList = orderIds.map(Number).filter(n => !isNaN(n)).join(',');
    if (!idList) return [];

    const res = await makeReq().query(`
      SELECT
        pcd.ID AS PcdID,
        od.OrdCodigoOrden,
        LEFT(COALESCE(
            NULLIF(NULLIF(LTRIM(RTRIM(art_pcd.Descripcion)), 'Articulos User'), 'Articulos User USD'),
            NULLIF(NULLIF(LTRIM(RTRIM(art.Descripcion)),     'Articulos User'), 'Articulos User USD'),
            NULLIF(LTRIM(RTRIM(od.OrdMaterialPlanilla)), ''),
            od.OrdNombreTrabajo,
            'Servicios de Produccion'
        ), 80) AS NomItem,
        LEFT('Orden: ' + ISNULL(od.OrdCodigoOrden,'')
             + ISNULL(' (' + od.OrdNombreTrabajo + ')','')
             + ISNULL(CHAR(13)+CHAR(10) + 'Servicio: ' + CAST(pcd.LogPrecioAplicado AS VARCHAR(1000)), ''), 500) AS DscItem,
        CAST(COALESCE(
          CASE WHEN pcd.Cantidad IS NOT NULL AND pcd.Cantidad != FLOOR(pcd.Cantidad) THEN pcd.Cantidad ELSE NULL END,
          CASE WHEN od.OrdCantidad  IS NOT NULL AND od.OrdCantidad  != FLOOR(od.OrdCantidad)  THEN od.OrdCantidad  ELSE NULL END,
          pcd.Cantidad,
          od.OrdCantidad,
          1.0
        ) AS DECIMAL(18,4)) AS Cantidad,
        ROUND(ISNULL(pcd.Subtotal, ISNULL(od.OrdCostoFinal, 0)) / NULLIF(COALESCE(
          CASE WHEN pcd.Cantidad IS NOT NULL AND pcd.Cantidad != FLOOR(pcd.Cantidad) THEN pcd.Cantidad ELSE NULL END,
          CASE WHEN od.OrdCantidad IS NOT NULL AND od.OrdCantidad != FLOOR(od.OrdCantidad) THEN od.OrdCantidad ELSE NULL END,
          pcd.Cantidad, od.OrdCantidad, 1.0
        ), 0), 4) AS PrecioUnitario,
        ROUND(ISNULL(pcd.Subtotal, ISNULL(od.OrdCostoFinal, 0)) / 1.22, 2) AS Subtotal,
        ROUND(ISNULL(pcd.Subtotal, ISNULL(od.OrdCostoFinal, 0))
              - ISNULL(pcd.Subtotal, ISNULL(od.OrdCostoFinal, 0)) / 1.22, 2) AS Impuestos,
        ISNULL(pcd.Subtotal, ISNULL(od.OrdCostoFinal, 0)) AS Total,
        CASE WHEN od.MonIdMoneda = 2 THEN 'USD'
             WHEN od.MonIdMoneda = 1 THEN 'UYU'
             ELSE ISNULL(pc.Moneda, ISNULL(pcd.Moneda, 'UYU')) END AS MonedaPC
      FROM dbo.OrdenesDeposito od
      LEFT JOIN dbo.PedidosCobranza pc          ON LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden
      -- Ver nota de MODO 1: excluir hermanas consolidadas (EMB/DF/TPU/EST de "Comprar y
      -- personalizar") para que el join no faneé a más de una fila por pedido.
      LEFT JOIN dbo.PedidosCobranzaDetalle pcd  ON pcd.PedidoCobranzaID = pc.ID AND ISNULL(pcd.EsHermanaConsolidada, 0) = 0 AND ISNULL(pcd.EsFacturable, 1) = 1
      LEFT JOIN dbo.Articulos art               ON art.ProIdProducto    = od.ProIdProducto
      LEFT JOIN dbo.Articulos art_pcd           ON art_pcd.ProIdProducto = pcd.ProIdProducto
      WHERE od.OrdIdOrden IN (${idList})
        -- Excluir reposiciones sin cargo (ver nota en MODO 1): -R# sin precio propio.
        AND NOT (
              od.OrdCodigoOrden LIKE '%-R[0-9]%'
          AND ISNULL(pcd.Subtotal, 0)     = 0
          AND ISNULL(od.OrdCostoFinal, 0) = 0
        )
        -- Excluir órdenes cubiertas por rollo/plan (ver nota en MODO 1): costo 0 y
        -- sin precio propio → acá saldrían como línea en 0 y DGI rechaza líneas en 0.
        AND NOT (
              ISNULL(od.OrdCostoFinal, 0) = 0
          AND ISNULL(pcd.Subtotal, 0)     = 0
        )
    `);

    const withCot = await aplicarCotizacion(res.recordset);
    return await agregarDetallePorArea(makeReq, await enriquecerConDesglose(withCot.map(mapLinea)));
  }

  return [];
};

const actualizarFirmaCFE = async (docId, { cae, numeroOficial, urlQR }, transaction = null) => {
  const pool = transaction ? null : await getPool();
  const request = transaction ? new sql.Request(transaction) : pool.request();

  // Fecha con la que el CFE quedó emitido ante DGI: viene dentro de la URL del QR
  // (campo 6: ...cfe?RUC,tipo,serie,numero,monto,AAAAMMDD,hash). Si no se puede
  // parsear, se usa la fecha de hoy (la emisión y la aceptación son el mismo momento).
  const mFecha = String(urlQR || '').match(/cfe\?[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(\d{8}),/);
  const fechaDgi = mFecha
    ? `${mFecha[1].slice(0, 4)}-${mFecha[1].slice(4, 6)}-${mFecha[1].slice(6, 8)}`
    : null;

  await request
    .input('Id', sql.Int, docId)
    .input('CAE', sql.VarChar(255), cae)
    .input('Oficial', sql.VarChar(100), numeroOficial)
    .input('Url', sql.NVarChar(sql.MAX), urlQR)
    .input('FechaDgi', sql.Date, fechaDgi)
    .query(`
      UPDATE dbo.DocumentosContables
      SET CfeEstado = 'ACEPTADO_DGI',
          CfeCAE = @CAE,
          CfeNumeroOficial = @Oficial,
          CfeUrlImpresion = @Url,
          CfeFechaDgi = ISNULL(@FechaDgi, CAST(GETDATE() AS DATE))
      WHERE DocIdDocumento = @Id
    `);
};

const anularDocumentoContable = async (docId, transaction = null) => {
  const pool = transaction ? null : await getPool();
  const request = transaction ? new sql.Request(transaction) : pool.request();
  
  await request
    .input('Id', sql.Int, docId)
    .query(`
      UPDATE dbo.DocumentosContables 
      SET DocEstado = 'ANULADO', 
          CfeEstado = 'ANULADO' 
      WHERE DocIdDocumento = @Id
    `);
};

const marcarDocumentoComoPagado = async (docId, transaction = null) => {
  const pool = transaction ? null : await getPool();
  const request = transaction ? new sql.Request(transaction) : pool.request();
  
  await request
    .input('Id', sql.Int, docId)
    .query(`
      UPDATE dbo.DocumentosContables 
      SET DocPagado = 1 
      WHERE DocIdDocumento = @Id
    `);
};

module.exports = {
  CUENTAS,
  generarAsientoCompleto,
  resolverLineasDesdeMotor,
  resolverLineasDetalle,
  enriquecerLineasDocumento,
  aplicarDesglosePcd,
  desglosarIVA,
  getCuentaId,
  crearDocumentoContable,
  actualizarFirmaCFE,
  anularDocumentoContable,
  marcarDocumentoComoPagado
};
