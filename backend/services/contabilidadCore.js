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

const crearDocumentoContable = async ({ header, lineas }, transaction = null) => {
  const requiredFields = { cueIdCuenta: header.cueIdCuenta, clienteId: header.clienteId, monedaId: header.monedaId, tipo: header.tipo, numero: header.numero, serie: header.serie, usuarioId: header.usuarioId };
  const missing = Object.entries(requiredFields).filter(([,v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`[crearDocumentoContable] Faltan parámetros obligatorios: ${missing.join(', ')}. Valores: ${JSON.stringify(requiredFields)}`);
  }

  const pool = transaction ? null : await getPool();
  const request = transaction ? new sql.Request(transaction) : pool.request();
  
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
    .input('CliNombre', sql.NVarChar(200), docCliNombre)
    .input('CliDoc', sql.NVarChar(20), docCliDocumento)
    .input('CliDir', sql.NVarChar(200), docCliDireccion)
    .input('CliCiu', sql.NVarChar(100), docCliCiudad)
    .input('Emp', sql.Int, empresaId || null)
    .query(`
      INSERT INTO dbo.DocumentosContables
        (CueIdCuenta, CliIdCliente, MonIdMoneda, DocTipo, DocNumero, DocSerie,
         DocSubtotal, DocImpuestos, DocTotalDescuentos, DocTotalRecargos, DocTotal,
         DocEstado, CfeEstado, DocFechaEmision, DocUsuarioAlta, TcaIdTransaccion, AsiIdAsiento,
         DocObservaciones, DocPagado, DocIdDocumentoRef, DocMotivoRef, CicIdCiclo, DocFechaDesde, DocFechaHasta,
         DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad, EmpIdEmpresa)
      OUTPUT INSERTED.DocIdDocumento
      VALUES
        (@Cue, @Cli, @MonId, @Tipo, @Num, @Serie,
         @Sub, @Imp, @TotalDesc, @TotalRec, @Tot,
         @Estado, @CfeEstado, ISNULL(@FEmis, GETDATE()), @Usr, @TcaId, @AsiId,
         @Obs, @Pagado, @DocRef, @MotRef, @CicId, @FDesde, @FHasta,
         @CliNombre, @CliDoc, @CliDir, @CliCiu, ISNULL(@Emp, (SELECT TOP 1 EmpIdEmpresa FROM dbo.Empresas WHERE EmpPorDefecto=1)))
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

      await reqLine
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
        .input('DescPct', sql.Decimal(9, 4), lineDescuentoPct)
        .query(`
          INSERT INTO dbo.DocumentosContablesDetalle
            (DocIdDocumento, OrdCodigoOrden, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr, DcdDescuentoPct)
          VALUES
            (@DocId, @OrdCod, @Nom, @Dsc, @Cant, @Precio, @Sub, @Imp, @Tot, @TotalDesc, @DescStr, @DescPct)
        `);
    }
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

  // Convierte cada línea a la moneda del documento usando la cotización del día.
  // Documento UYU: líneas USD → ×cot (USD→UYU). Documento USD: líneas UYU → ÷cot (UYU→USD).
  const aplicarCotizacion = async (recordset) => {
    const docMon = (monedaFactura || 'UYU').toUpperCase().trim();
    const hayDistintas = recordset.some(r => {
      const lineMon = (r.MonedaPC || 'UYU').toUpperCase().trim();
      return lineMon !== docMon && (lineMon === 'USD' || lineMon === 'UYU');
    });
    if (!hayDistintas) return recordset;
    const cotRes = await makeReq()
      .query("SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC");
    const cot = parseFloat(cotRes.recordset[0]?.CotDolar) || 40;
    return recordset.map(r => {
      const lineMon = (r.MonedaPC || 'UYU').toUpperCase().trim();
      if (lineMon === docMon) return r;
      if (docMon === 'UYU' && lineMon === 'USD') return { ...r, _factor: cot };       // USD → UYU
      if (docMon === 'USD' && lineMon === 'UYU') return { ...r, _factor: 1 / cot };    // UYU → USD
      return r;
    });
  };

  const mapLinea = (r) => {
    const f = r._factor || 1;
    return {
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

  // ── MODO 1: desde TransaccionDetalle ──────────────────────────────────────
  if (tcaIdTransaccion) {
    const res = await makeReq()
      .input('tcaId', sql.Int, tcaIdTransaccion)
      .query(`
        SELECT
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
        LEFT JOIN dbo.PedidosCobranzaDetalle pcd ON pcd.PedidoCobranzaID = pc.ID
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
      `);

    const withCot = await aplicarCotizacion(res.recordset);
    return withCot.map(mapLinea);
  }

  // ── MODO 2: desde array de OrdIdOrden (generarCFEDesdeOrdenesDirectas) ────
  if (orderIds && orderIds.length > 0) {
    const idList = orderIds.map(Number).filter(n => !isNaN(n)).join(',');
    if (!idList) return [];

    const res = await makeReq().query(`
      SELECT
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
      LEFT JOIN dbo.PedidosCobranzaDetalle pcd  ON pcd.PedidoCobranzaID = pc.ID
      LEFT JOIN dbo.Articulos art               ON art.ProIdProducto    = od.ProIdProducto
      LEFT JOIN dbo.Articulos art_pcd           ON art_pcd.ProIdProducto = pcd.ProIdProducto
      WHERE od.OrdIdOrden IN (${idList})
        -- Excluir reposiciones sin cargo (ver nota en MODO 1): -R# sin precio propio.
        AND NOT (
              od.OrdCodigoOrden LIKE '%-R[0-9]%'
          AND ISNULL(pcd.Subtotal, 0)     = 0
          AND ISNULL(od.OrdCostoFinal, 0) = 0
        )
    `);

    const withCot = await aplicarCotizacion(res.recordset);
    return withCot.map(mapLinea);
  }

  return [];
};

const actualizarFirmaCFE = async (docId, { cae, numeroOficial, urlQR }, transaction = null) => {
  const pool = transaction ? null : await getPool();
  const request = transaction ? new sql.Request(transaction) : pool.request();
  
  await request
    .input('Id', sql.Int, docId)
    .input('CAE', sql.VarChar(255), cae)
    .input('Oficial', sql.VarChar(100), numeroOficial)
    .input('Url', sql.NVarChar(sql.MAX), urlQR)
    .query(`
      UPDATE dbo.DocumentosContables 
      SET CfeEstado = 'ACEPTADO_DGI', 
          CfeCAE = @CAE, 
          CfeNumeroOficial = @Oficial, 
          CfeUrlImpresion = @Url
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
  desglosarIVA,
  getCuentaId,
  crearDocumentoContable,
  actualizarFirmaCFE,
  anularDocumentoContable,
  marcarDocumentoComoPagado
};
