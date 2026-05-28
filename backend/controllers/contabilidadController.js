'use strict';

/**
 * contabilidadController.js
 * ────────────────────────────────────────────────────────────────────────────
 * Controlador del módulo de Contabilidad de Clientes.
 * Todas las operaciones delegan en contabilidadService.js.
 * ────────────────────────────────────────────────────────────────────────────
 */

const svc    = require('../services/contabilidadService');
const logger = require('../utils/logger');
const { getPool, sql } = require('../config/db');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// ============================================================
// SECCIÓN 1: CUENTAS DE CLIENTE
// ============================================================

/**
 * GET /api/contabilidad/cuentas/:CliIdCliente
 * Devuelve todas las cuentas activas de un cliente con saldo actual.
 */
exports.getCuentasCliente = async (req, res) => {
  try {
    const { CliIdCliente } = req.params;
    const cuentas = await svc.getSaldoCliente(parseInt(CliIdCliente));
    res.json({ success: true, data: cuentas });
  } catch (err) {
    logger.error('[CONTABILIDAD] getCuentasCliente:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/contabilidad/grupos-erp
 * Devuelve los grupos de artículos desde ConfigMapeoERP.
 * Columnas: CodigoERP, NombreReferencia, AreaID_Interno
 */
exports.getGruposERP = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        CodigoERP,
        NombreReferencia,
        AreaID_Interno
      FROM   dbo.ConfigMapeoERP WITH(NOLOCK)
      ORDER  BY CodigoERP
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getGruposERP:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Columnas reales de la tabla Unidades (verificado con INFORMATION_SCHEMA):
//   UniIdUnidad (int PK), UniDescripcionUnidad (varchar), UniNotación (varchar), UniFechaAlta (datetime)
const UNI_NOMBRE = 'UniDescripcionUnidad';
const UNI_SIMBOL = '[UniNotación]';  // corchetes por la tilde en el nombre

/**
 * GET /api/contabilidad/monedas
 */
exports.getMonedas = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        MonIdMoneda,
        MonDescripcionMoneda  AS MonNombre,
        MonSimbolo
      FROM   dbo.Monedas WITH(NOLOCK)
      ORDER  BY MonIdMoneda
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getMonedas:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};


/**
 * GET /api/contabilidad/metodos-pago
 */
exports.getMetodosPago = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        MPaIdMetodoPago,
        MPaDescripcionMetodo,
        MPaIdMetodoPago       AS MetodoPagoId,
        MPaDescripcionMetodo  AS MetNombre
      FROM   dbo.MetodosPagos WITH(NOLOCK)
      ORDER  BY MPaIdMetodoPago
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getMetodosPago:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};


/**
 * GET /api/contabilidad/unidades
 */
exports.getUnidades = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        UniIdUnidad,
        ${UNI_NOMBRE}   AS UniNombre,
        ${UNI_SIMBOL}   AS UniSimbolo
      FROM   dbo.Unidades WITH(NOLOCK)
      ORDER  BY ${UNI_NOMBRE}
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getUnidades:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * PATCH /api/contabilidad/clientes/:CliIdCliente/dgi
 */
exports.actualizarClienteDGI = async (req, res) => {
  try {
    const { CliIdCliente } = req.params;
    const { Nombre, Documento, Direccion, Ciudad } = req.body;
    
    if (!Nombre || !Documento || !Direccion || !Ciudad) {
      return res.status(400).json({ success: false, error: "Todos los campos (Nombre, Documento, Dirección, Ciudad) son obligatorios." });
    }

    const pool = await getPool();
    await pool.request()
      .input('CliIdCliente', sql.Int, CliIdCliente)
      .input('CioRuc', sql.VarChar, Documento)
      .input('Direccion', sql.VarChar, Direccion)
      .input('Ciudad', sql.Int, Number(Ciudad))
      .input('Nombre', sql.VarChar, Nombre)
      .query(`
        UPDATE dbo.Clientes
        SET CioRuc = @CioRuc,
            DireccionTrabajo = @Direccion,
            DepartamentoID = @Ciudad,
            Nombre = @Nombre,
            NombreFantasia = @Nombre
        WHERE CliIdCliente = @CliIdCliente
      `);

    res.json({ success: true, message: "Datos de cliente actualizados correctamente." });
  } catch (err) {
    logger.error('[CONTABILIDAD] actualizarClienteDGI:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/contabilidad/articulos
 * Filtra por grupo (CodigoERP) y texto opcional.
 * Grupo está guardado como CHAR con padding → usa RTRIM para comparar.
 */
exports.getArticulos = async (req, res) => {
  try {
    const { q = '', grupo = '' } = req.query;
    const pool = await getPool();

    const req2   = pool.request();
    const where  = [];

    if (grupo.trim()) {
      req2.input('grupo', grupo.trim());
      where.push(`RTRIM(LTRIM(CAST(a.Grupo AS VARCHAR(20)))) = @grupo`);
    }
    if (q.trim()) {
      req2.input('q', `%${q.trim()}%`);
      where.push(`(a.Descripcion LIKE @q OR a.CodArticulo LIKE @q OR a.CodStock LIKE @q)`);
    }

    const whereSQL = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const result = await req2.query(`
      SELECT TOP 200
        a.ProIdProducto              AS IDArticulo,
        RTRIM(a.CodArticulo)         AS CodigoArticulo,
        RTRIM(a.Descripcion)         AS NombreArticulo,
        RTRIM(a.CodStock)            AS CodStock,
        RTRIM(CAST(a.Grupo AS VARCHAR(20))) AS Grupo,
        a.UniIdUnidad,
        u.${UNI_NOMBRE}              AS UniNombre,
        ISNULL(u.${UNI_SIMBOL}, u.${UNI_NOMBRE}) AS UnidadMedida
      FROM   dbo.Articulos a WITH(NOLOCK)
      LEFT JOIN dbo.Unidades u WITH(NOLOCK) ON u.UniIdUnidad = a.UniIdUnidad
      ${whereSQL}
      ORDER  BY a.Descripcion
    `);

    logger.info(`[CONTABILIDAD] getArticulos grupo='${grupo}' → ${result.recordset.length} filas`);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getArticulos ERROR:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};


/**
 * POST /api/contabilidad/cuentas
 * Crea manualmente una cuenta para un cliente.
 * Body: { CliIdCliente, CueTipo, ProIdProducto?, MonIdMoneda?, CPaIdCondicion? }
 */
exports.crearCuenta = async (req, res) => {
  try {
    const {
      CliIdCliente, CueTipo,
      ProIdProducto  = null,
      MonIdMoneda    = null,
      CPaIdCondicion = 1,
    } = req.body;

    if (!CliIdCliente || !CueTipo) {
      return res.status(400).json({ success: false, error: 'CliIdCliente y CueTipo son obligatorios.' });
    }

    const UsuarioAlta = req.user?.id ?? 1;
    const CueIdCuenta = await svc.obtenerOCrearCuenta(CliIdCliente, CueTipo, {
      ProIdProducto, MonIdMoneda, CPaIdCondicion, UsuarioAlta,
    });

    res.status(201).json({ success: true, data: { CueIdCuenta } });
  } catch (err) {
    logger.error('[CONTABILIDAD] crearCuenta:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * PATCH /api/contabilidad/cuentas/:CueIdCuenta/configuracion
 * Actualiza configuración de la cuenta: límite, días de ciclo, condición de pago.
 * Body: { CueLimiteCredito?, CuePuedeNegativo?, CueDiasCiclo?, CPaIdCondicion? }
 */
exports.actualizarConfigCuenta = async (req, res) => {
  try {
    const { CueIdCuenta } = req.params;
    const {
      CueLimiteCredito,
      CuePuedeNegativo,
      CueDiasCiclo,
      CPaIdCondicion,
      CueObservaciones,
    } = req.body;

    const pool = await getPool();
    const request = pool.request().input('CueIdCuenta', sql.Int, parseInt(CueIdCuenta));

    const sets = [];
    if (CueLimiteCredito   !== undefined) { sets.push('CueLimiteCredito   = @CueLimiteCredito');   request.input('CueLimiteCredito',   sql.Decimal(18,4), CueLimiteCredito); }
    if (CuePuedeNegativo   !== undefined) { sets.push('CuePuedeNegativo   = @CuePuedeNegativo');   request.input('CuePuedeNegativo',   sql.Bit,          CuePuedeNegativo ? 1 : 0); }
    if (CueDiasCiclo       !== undefined) { sets.push('CueDiasCiclo       = @CueDiasCiclo');       request.input('CueDiasCiclo',       sql.Int,          CueDiasCiclo); }
    if (CPaIdCondicion     !== undefined) { sets.push('CPaIdCondicion     = @CPaIdCondicion');     request.input('CPaIdCondicion',     sql.Int,          CPaIdCondicion); }
    if (CueObservaciones   !== undefined) { sets.push('CueObservaciones   = @CueObservaciones');   request.input('CueObservaciones',   sql.NVarChar(500), CueObservaciones); }

    if (sets.length === 0) return res.status(400).json({ success: false, error: 'No se enviaron campos a actualizar.' });

    await request.query(`UPDATE dbo.CuentasCliente SET ${sets.join(', ')} WHERE CueIdCuenta = @CueIdCuenta`);
    res.json({ success: true, message: 'Cuenta actualizada correctamente.' });
  } catch (err) {
    logger.error('[CONTABILIDAD] actualizarConfigCuenta:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SECCIÓN 2: LIBRO MAYOR — MOVIMIENTOS
// ============================================================

/**
 * GET /api/contabilidad/cuentas/:CueIdCuenta/movimientos
 * Query params: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&top=100
 */
exports.getMovimientos = async (req, res) => {
  try {
    const { CueIdCuenta } = req.params;
    const { desde, hasta, top = 100 } = req.query;

    const { data, saldoArrastre } = await svc.getMovimientos(
      parseInt(CueIdCuenta),
      desde ? new Date(desde) : null,
      hasta ? new Date(hasta) : null,
      parseInt(top),
    );

    res.json({ success: true, data, saldoArrastre });
  } catch (err) {
    logger.error('[CONTABILIDAD] getMovimientos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/movimientos/ajuste
 * Registra un ajuste manual (corrección de saldo).
 * Body: { CueIdCuenta, MovTipo: 'AJUSTE_POS'|'AJUSTE_NEG', MovConcepto, MovImporte }
 * Requiere autorización — el importe positivo/negativo ya viene definido desde el frontend.
 */
exports.registrarAjusteManual = async (req, res) => {
  try {
    const { CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovObservaciones } = req.body;
    const UsuarioAlta = req.user?.id ?? 1;

    if (!['AJUSTE_POS', 'AJUSTE_NEG'].includes(MovTipo)) {
      return res.status(400).json({ success: false, error: 'MovTipo debe ser AJUSTE_POS o AJUSTE_NEG.' });
    }
    if (!CueIdCuenta || !MovConcepto || MovImporte === undefined) {
      return res.status(400).json({ success: false, error: 'CueIdCuenta, MovConcepto y MovImporte son obligatorios.' });
    }

    // Forzar signo según tipo
    const importe = MovTipo === 'AJUSTE_NEG' ? -Math.abs(MovImporte) : Math.abs(MovImporte);

    const resultado = await svc.registrarMovimiento({
      CueIdCuenta: parseInt(CueIdCuenta),
      MovTipo,
      MovConcepto,
      MovImporte: importe,
      MovUsuarioAlta: UsuarioAlta,
      MovObservaciones,
    });

    res.json({ success: true, data: resultado });
  } catch (err) {
    logger.error('[CONTABILIDAD] registrarAjusteManual:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/movimientos/pago-anticipado
 * Registra un pago/anticipo/saldo inicial manual desde la UI.
 * → MovimientosCuenta (libro mayor)
 * → Imputa contra DeudaDocumento pendientes (PEPS)
 * → Si sobra → NOTA_CREDITO en MovimientosCuenta
 */
exports.registrarPagoAnticipado = async (req, res) => {
  try {
    const {
      CueIdCuenta,
      MovImporte,
      MovConcepto  = 'Pago anticipado',
      MovTipo      = 'ANTICIPO',
      Referencia   = null,
    } = req.body;
    const UsuarioAlta = req.user?.id ?? 1;

    if (!CueIdCuenta || !MovImporte || Number(MovImporte) <= 0)
      return res.status(400).json({ success: false, error: 'CueIdCuenta e importe positivo son obligatorios.' });

    const tiposValidos = ['ANTICIPO', 'SALDO_INICIAL', 'PAGO'];
    if (!tiposValidos.includes(MovTipo))
      return res.status(400).json({ success: false, error: `MovTipo debe ser: ${tiposValidos.join(', ')}.` });

    const importe = parseFloat(MovImporte);
    const cueId   = parseInt(CueIdCuenta);

    // 1. ACREDITAR en libro mayor (MovimientosCuenta + actualiza CueSaldoActual)
    const { MovIdGenerado, SaldoResultante } = await svc.registrarMovimiento({
      CueIdCuenta:     cueId,
      MovTipo,
      MovConcepto:     MovConcepto || MovTipo,
      MovImporte:      importe,           // positivo = crédito
      MovUsuarioAlta:  UsuarioAlta,
      MovRefExterna:   Referencia,
    });

    // 2. IMPUTAR contra deudas pendientes PEPS (DeudaDocumento)
    const { MontoExcedente } = await svc.imputarPago({
      PagIdPago:       MovIdGenerado,     // usamos el MovId como referencia
      MontoDisponible: importe,
      CueIdCuenta:     cueId,
      UsuarioAlta,
    });

    const imputado = importe - MontoExcedente;
    res.json({
      success: true,
      data: { MovIdGenerado, SaldoResultante, imputado, credito: MontoExcedente },
      message: `✅ ${MovTipo}: ${fmt(importe)} registrado. Imputado: ${fmt(imputado)}. Crédito a favor: ${fmt(MontoExcedente)}.`,
    });
  } catch (err) {
    logger.error('[CONTABILIDAD] registrarPagoAnticipado:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// helper fmt local (sin símbolo)
function fmt(n) { return new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2 }).format(Number(n ?? 0)); }

// ============================================================
// SECCIÓN 3: DEUDAS
// ============================================================

/**
 * GET /api/contabilidad/cuentas/:CueIdCuenta/deudas
 * Query params: ?estado=PENDIENTE|VENCIDO|PARCIAL (sin filtro = todos los activos)
 */
exports.getDeudas = async (req, res) => {
  try {
    const { CueIdCuenta } = req.params;
    const { estado = null } = req.query;

    const deudas = await svc.getDeudas(parseInt(CueIdCuenta), estado);
    res.json({ success: true, data: deudas });
  } catch (err) {
    logger.error('[CONTABILIDAD] getDeudas:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/contabilidad/clientes/:CliIdCliente/deudas-vivas
 * Devuelve todos los documentos con saldo pendiente para el cliente (unificado).
 */
exports.getDeudasVivasCliente = async (req, res) => {
  try {
    const { CliIdCliente } = req.params;
    const { modo } = req.query;
    const deudas = await svc.getDeudasPorCliente(parseInt(CliIdCliente), modo);
    res.json({ success: true, data: deudas });
  } catch (err) {
    logger.error('[CONTABILIDAD] getDeudasVivasCliente:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/contabilidad/deudas-vivas
 * Devuelve todos los documentos con saldo pendiente de TODOS los clientes.
 */
exports.getTodasLasDeudasVivas = async (req, res) => {
  try {
    const deudas = await svc.getTodasLasDeudasVivas();
    res.json({ success: true, data: deudas });
  } catch (err) {
    logger.error('[CONTABILIDAD] getTodasLasDeudasVivas:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SECCIÓN 4: CONDICIONES DE PAGO
// ============================================================

/**
 * GET /api/contabilidad/condiciones-pago
 * Lista todas las condiciones de pago activas.
 */
exports.getCondicionesPago = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT CPaIdCondicion, CPaNombre, CPaDiasVencimiento,
              CPaPermiteCuotas, CPaCantidadCuotas, CPaDiasEntreCuotas
       FROM   dbo.CondicionesPago
       WHERE  CPaActiva = 1
       ORDER  BY CPaDiasVencimiento`
    );
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getCondicionesPago:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SECCIÓN 4b: PLANES DE RECURSOS (METROS / KG / UNIDADES)
// ============================================================

/**
 * GET /api/contabilidad/planes/:CliIdCliente
 * Lista todos los planes de recursos de un cliente.
 * Query: ?solo_activos=true (default false = todos)
 */
exports.getPlanesCliente = async (req, res) => {
  try {
    const { CliIdCliente } = req.params;
    const { solo_activos = 'false' } = req.query;
    const pool = await getPool();
    const filtro = solo_activos === 'true' ? `AND pm.PlaActivo = 1` : '';

    const result = await pool.request()
      .input('CliIdCliente', sql.Int, parseInt(CliIdCliente))
      .query(`
        SELECT
          pm.PlaIdPlan,
          pm.CueIdCuenta,
          pm.ProIdProducto,
          RTRIM(art.Descripcion)           AS NombreArticulo,
          pm.PlaCantidadTotal,
          pm.PlaCantidadUsada,
          pm.PlaCantidadTotal - pm.PlaCantidadUsada  AS PlaCantidadRestante,
          CAST(
            CASE WHEN pm.PlaCantidadTotal > 0
                 THEN (pm.PlaCantidadUsada / pm.PlaCantidadTotal) * 100
                 ELSE 0 END AS DECIMAL(5,1))         AS PorcentajeUsado,
          -- Unidad normalizada desde Unidades
          u.UniDescripcionUnidad                     AS PlaUnidad,
          u.[UniNotación]                            AS UniSimbolo,
          ISNULL(u.UniDescripcionUnidad, cc.CueTipo) AS UnidadLabel,
          -- Precio / pago del plan
          pm.PlaPrecioUnitario                       AS PlaImportePagado,
          pm.MonIdMoneda,
          mon2.MonSimbolo                            AS MonPagoSimbolo,
          pm.PlaFechaInicio,
          pm.PlaFechaVencimiento,
          pm.PlaActivo,
          pm.PlaDescripcion,
          pm.PlaObservaciones,
          pm.PlaFechaAlta,
          CASE WHEN pm.PlaFechaVencimiento IS NOT NULL
               THEN DATEDIFF(DAY, CAST(GETDATE() AS DATE), pm.PlaFechaVencimiento)
               ELSE NULL END                         AS DiasParaVencer,
          cc.CueTipo,
          mon.MonSimbolo
        FROM      dbo.PlanesMetros    pm WITH(NOLOCK)
        JOIN      dbo.CuentasCliente  cc   WITH(NOLOCK) ON cc.CueIdCuenta   = pm.CueIdCuenta
        LEFT JOIN dbo.Articulos       art  WITH(NOLOCK) ON art.ProIdProducto = pm.ProIdProducto
        LEFT JOIN dbo.Unidades        u    WITH(NOLOCK) ON u.UniIdUnidad     = art.UniIdUnidad
        LEFT JOIN dbo.Monedas         mon  WITH(NOLOCK) ON mon.MonIdMoneda   = cc.MonIdMoneda
        LEFT JOIN dbo.Monedas         mon2 WITH(NOLOCK) ON mon2.MonIdMoneda  = pm.MonIdMoneda
        WHERE cc.CliIdCliente = @CliIdCliente
          ${filtro}
        ORDER BY pm.PlaActivo DESC, pm.PlaFechaInicio DESC
      `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getPlanesCliente:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/planes
 * Crea un nuevo plan de recursos para una cuenta.
 * Body: { CueIdCuenta, PlaCantidadTotal, PlaDescripcion?, PlaFechaVencimiento?,
 *         PlaImportePagado?, MonedaPagoId?, MetodoPagoId? }
 */
exports.crearPlan = async (req, res) => {
  try {
    const {
      CueIdCuenta, ProIdProducto,
      PlaCantidadTotal,
      PlaDescripcion      = null,
      PlaFechaVencimiento = null,
      PlaImportePagado    = null,
      MonedaPagoId        = null,
      MetodoPagoId        = null,
      DocTipo             = 'FACTURA',   // 'FACTURA' | 'RECIBO' | 'TICKET'
    } = req.body;
    const UsuarioAlta = req.user?.id ?? 1;

    if (!CueIdCuenta || !PlaCantidadTotal || PlaCantidadTotal <= 0)
      return res.status(400).json({ success: false, error: 'CueIdCuenta y PlaCantidadTotal son obligatorios.' });

    const pool = await getPool();

    // Obtener datos de la cuenta
    const cuentaRes = await pool.request()
      .input('CueIdCuenta', sql.Int, parseInt(CueIdCuenta))
      .query(`SELECT CueTipo, CliIdCliente, ProIdProducto AS ProIdProductoCuenta FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueIdCuenta`);

    if (!cuentaRes.recordset.length)
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada.' });

    const { CueTipo, CliIdCliente, ProIdProductoCuenta } = cuentaRes.recordset[0];
    const ProIdFinal = ProIdProducto || ProIdProductoCuenta;

    // Rechazar cuentas monetarias
    const TIPOS_MONETARIOS = ['USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU'];
    if (TIPOS_MONETARIOS.includes(CueTipo?.toUpperCase()))
      return res.status(400).json({ success: false, error: `La cuenta "${CueTipo}" no es una cuenta de recursos.` });

    // Insertar plan con columnas reales de PlanesMetros
    const insert = await pool.request()
      .input('CliIdCliente',        sql.Int,           parseInt(CliIdCliente))
      .input('CueIdCuenta',         sql.Int,           parseInt(CueIdCuenta))
      .input('ProIdProducto',       sql.Int,           ProIdFinal ? parseInt(ProIdFinal) : null)
      .input('PlaCantidadTotal',    sql.Decimal(18,4), parseFloat(PlaCantidadTotal))
      .input('PlaPrecioUnitario',   sql.Decimal(18,4), PlaImportePagado ? parseFloat(PlaImportePagado) : null)
      .input('MonIdMoneda',         sql.Int,           MonedaPagoId  ? parseInt(MonedaPagoId)  : null)
      .input('PlaFechaVencimiento', sql.Date,          PlaFechaVencimiento || null)
      .input('PlaDescripcion',      sql.NVarChar(500), PlaDescripcion || null)
      .input('PlaObservaciones',    sql.NVarChar(500), null)
      .input('UsuarioAlta',         sql.Int,           UsuarioAlta)
      .query(`
        INSERT INTO dbo.PlanesMetros
          (CliIdCliente, CueIdCuenta, ProIdProducto,
           PlaCantidadTotal, PlaCantidadUsada,
           PlaPrecioUnitario, MonIdMoneda,
           PlaFechaInicio, PlaFechaVencimiento,
           PlaDescripcion, PlaObservaciones,
           PlaActivo, PlaFechaAlta, PlaUsuarioAlta)
        OUTPUT INSERTED.PlaIdPlan
        VALUES
          (@CliIdCliente, @CueIdCuenta, @ProIdProducto,
           @PlaCantidadTotal, 0,
           @PlaPrecioUnitario, @MonIdMoneda,
           CAST(GETDATE() AS DATE), @PlaFechaVencimiento,
           @PlaDescripcion, @PlaObservaciones,
           1, GETDATE(), @UsuarioAlta)
      `);

    const PlaIdPlan = insert.recordset[0].PlaIdPlan;

    // Registrar los artículos permitidos en la tabla PlanesMetrosArticulosPermitidos
    const artsPermitidos = Array.isArray(req.body.articulosPermitidos) && req.body.articulosPermitidos.length > 0 
        ? req.body.articulosPermitidos 
        : [ProIdFinal];
    
    for (const artPermId of artsPermitidos) {
        if (artPermId) {
            await pool.request()
                .input('PlaId', sql.Int, PlaIdPlan)
                .input('ProId', sql.Int, artPermId)
                .query(`
                    INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto)
                    VALUES (@PlaId, @ProId)
                `);
        }
    }

    // ── 1. ENTRADA en inventario de recursos (siempre) ─────────────────────
    await svc.registrarMovimiento({
      CueIdCuenta:     parseInt(CueIdCuenta),
      MovTipo:         'ENTRADA',
      MovConcepto:     `Saldo inicial plan #${PlaIdPlan}${PlaDescripcion ? ' — ' + PlaDescripcion : ''}`,
      MovImporte:      parseFloat(PlaCantidadTotal),
      MovUsuarioAlta:  UsuarioAlta,
    });

    // ── 2. Documento contable según DocTipo ────────────────────────────────
    let docNumero = null;
    let DocIdDocumento = null;

    if (DocTipo !== 'TICKET') {
      // Generar número correlativo con prefijo según tipo
      const prefijo    = DocTipo === 'RECIBO' ? 'RC' : 'FC';
      const secTipo    = DocTipo === 'RECIBO' ? 'RECIBO_PLAN' : 'FACTURA_PLAN';
      const anio       = new Date().getFullYear();
      const seqRes     = await pool.request()
        .input('Tipo', sql.VarChar(30), secTipo)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.SecuenciaDocumentos WHERE SecTipoDoc = @Tipo AND SecSerie = 'C')
            INSERT INTO dbo.SecuenciaDocumentos (SecTipoDoc, SecSerie, SecPrefijo, SecDigitos, SecUltimoNumero, SecActivo) 
            VALUES (@Tipo, 'C', 'FC-', 5, 0, 1);
          UPDATE dbo.SecuenciaDocumentos
          SET SecUltimoNumero = SecUltimoNumero + 1
          OUTPUT INSERTED.SecUltimoNumero
          WHERE SecTipoDoc = @Tipo AND SecSerie = 'C';
        `);
      const numero  = seqRes.recordset[0].SecUltimoNumero;
      docNumero = `${prefijo}-${anio}-${String(numero).padStart(5, '0')}`;
      const importe = PlaImportePagado ? parseFloat(PlaImportePagado) : 0;

      // Insertar DocumentoContable
      const docEstado = (DocTipo === 'FACTURA' && importe <= 0) ? 'EMITIDO' : 'COBRADO';
      const docRes = await pool.request()
        .input('CueIdCuenta',  sql.Int,           parseInt(CueIdCuenta))
        .input('CliIdCliente', sql.Int,           parseInt(CliIdCliente))
        .input('DocTipo',      sql.VarChar(20),  DocTipo)
        .input('DocNumero',    sql.VarChar(50),  docNumero)
        .input('DocTotal',     sql.Decimal(18,4), importe)
        .input('DocSubtotal',  sql.Decimal(18,4), importe)
        .input('MonIdMoneda',  sql.Int,           MonedaPagoId ? parseInt(MonedaPagoId) : 1)
        .input('DocEstado',    sql.VarChar(20),  docEstado)
        .input('UsuarioAlta',  sql.Int,           UsuarioAlta)
        .query(`
          INSERT INTO dbo.DocumentosContables
            (CueIdCuenta, CliIdCliente, DocTipo, DocNumero, DocSerie,
             DocSubtotal, DocTotal, MonIdMoneda, DocEstado,
             DocFechaEmision, DocUsuarioAlta)
          OUTPUT INSERTED.DocIdDocumento
          VALUES
            (@CueIdCuenta, @CliIdCliente, @DocTipo, @DocNumero, 'A',
             @DocSubtotal, @DocTotal, @MonIdMoneda, @DocEstado,
             GETDATE(), @UsuarioAlta)
        `);
      DocIdDocumento = docRes.recordset[0].DocIdDocumento;

      // Insertar en DocumentosContablesDetalle
      await pool.request()
        .input('DocId',    sql.Int,           DocIdDocumento)
        .input('Nom',      sql.VarChar(200),  `Adquisición de Plan de Recursos #${PlaIdPlan}`.substring(0, 200))
        .input('Desc',     sql.VarChar(500),  `${PlaDescripcion || ''}`.substring(0, 500))
        .input('Cant',     sql.Decimal(18,4), parseFloat(PlaCantidadTotal) || 1.0)
        .input('PUnit',    sql.Decimal(18,4), PlaPrecioUnitario ? parseFloat(PlaPrecioUnitario) : (PlaImportePagado ? parseFloat(PlaImportePagado)/parseFloat(PlaCantidadTotal) : 0.0))
        .input('Monto',    sql.Decimal(18,2), importe)
        .query(`
          INSERT INTO dbo.DocumentosContablesDetalle
            (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal)
          VALUES
            (@DocId, @Nom, @Desc, @Cant, @PUnit, @Monto, 0.0, @Monto)
        `);


      if (DocTipo === 'FACTURA') {
        if (importe > 0) {
          // Pago al contado con factura: registrar cobro en cuenta monetaria
          const cueTipoDin = (MonedaPagoId === 2 || MonedaPagoId === '2') ? 'DINERO_USD' : 'DINERO_UYU';
          const cuentaDinRes = await pool.request()
            .input('CliIdCliente', sql.Int,      parseInt(CliIdCliente))
            .input('CueTipo',      sql.VarChar(20), cueTipoDin)
            .query(`SELECT TOP 1 CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente=@CliIdCliente AND CueTipo=@CueTipo AND CueActiva=1`);
          if (cuentaDinRes.recordset.length > 0) {
            await svc.registrarMovimiento({
              CueIdCuenta:    cuentaDinRes.recordset[0].CueIdCuenta,
              MovTipo:        'PAGO',
              MovConcepto:    `Pago plan #${PlaIdPlan} (${docNumero})`,
              MovImporte:     importe,
              MovUsuarioAlta: UsuarioAlta,
              DocIdDocumento,
            });
          }
        } else {
          // Factura sin pago inmediato → crear DeudaDocumento
          // No se crea deuda sin importe — el importe es obligatorio si DocTipo=FACTURA sin pago
          // (deja pendiente para cuando el cliente pague)
          logger.info(`[CONTABILIDAD] Plan #${PlaIdPlan}: Factura ${docNumero} emitida sin pago inmediato. Sin DeudaDocumento (se registrará al cobrar).`);
        }
      } else if (DocTipo === 'RECIBO' && importe > 0) {
        // Recibo: solo registrar cobro, sin deuda
        const cueTipoDin = (MonedaPagoId === 2 || MonedaPagoId === '2') ? 'DINERO_USD' : 'DINERO_UYU';
        const cuentaDinRes = await pool.request()
          .input('CliIdCliente', sql.Int,      parseInt(CliIdCliente))
          .input('CueTipo',      sql.VarChar(20), cueTipoDin)
          .query(`SELECT TOP 1 CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente=@CliIdCliente AND CueTipo=@CueTipo AND CueActiva=1`);
        if (cuentaDinRes.recordset.length > 0) {
          await svc.registrarMovimiento({
            CueIdCuenta:    cuentaDinRes.recordset[0].CueIdCuenta,
            MovTipo:        'PAGO',
            MovConcepto:    `Cobro plan #${PlaIdPlan} (${docNumero})`,
            MovImporte:     importe,
            MovUsuarioAlta: UsuarioAlta,
            DocIdDocumento,
          });
        }
      }
    }
    // TICKET: solo inventario, sin documento contable

    logger.info(`[CONTABILIDAD] Plan #${PlaIdPlan} creado: ${PlaCantidadTotal} uds | DocTipo=${DocTipo}${docNumero ? ' | ' + docNumero : ''}`);
    res.json({
      success: true,
      data: { PlaIdPlan, DocIdDocumento, docNumero, DocTipo },
      message: `Plan creado: ${PlaCantidadTotal} unidades${docNumero ? ` — ${DocTipo} ${docNumero}` : ''}.`,
    });
  } catch (err) {
    logger.error('[CONTABILIDAD] crearPlan:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/planes/:PlaIdPlan/recargar
 * Agrega más cantidad a un plan existente (recarga).
 * Body: { CantidadAdicional, ImportePagado? }
 */
exports.recargarPlan = async (req, res) => {
  try {
    const { PlaIdPlan } = req.params;
    const { CantidadAdicional, ImportePagado = null } = req.body;
    const UsuarioAlta = req.user?.id ?? 1;

    if (!CantidadAdicional || parseFloat(CantidadAdicional) <= 0)
      return res.status(400).json({ success: false, error: 'CantidadAdicional debe ser mayor a 0.' });

    const pool = await getPool();
    const planRes = await pool.request()
      .input('PlaIdPlan', sql.Int, parseInt(PlaIdPlan))
      .query(`
        SELECT pm.*, cc.CliIdCliente, cc.CueTipo
        FROM dbo.PlanesMetros pm
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = pm.CueIdCuenta
        WHERE pm.PlaIdPlan = @PlaIdPlan
      `);

    if (!planRes.recordset.length)
      return res.status(404).json({ success: false, error: 'Plan no encontrado.' });

    const plan = planRes.recordset[0];

    await pool.request()
      .input('PlaIdPlan',         sql.Int,           parseInt(PlaIdPlan))
      .input('CantidadAdicional', sql.Decimal(18,4), parseFloat(CantidadAdicional))
      .query(`UPDATE dbo.PlanesMetros SET PlaCantidadTotal = PlaCantidadTotal + @CantidadAdicional, PlaActivo = 1 WHERE PlaIdPlan = @PlaIdPlan`);

    await svc.registrarMovimiento({
      CueIdCuenta:     plan.CueIdCuenta,
      MovTipo:         'RECARGA',
      MovConcepto:     `Recarga plan #${PlaIdPlan} (+${CantidadAdicional} ${plan.PlaUnidad || ''})`,
      MovImporte:      parseFloat(CantidadAdicional),
      MovUsuarioAlta:  UsuarioAlta,
      MovObservaciones: `Plan #${PlaIdPlan}`
    });

    if (ImportePagado && parseFloat(ImportePagado) > 0) {
      const monRes = await pool.request()
        .input('CliIdCliente', sql.Int, plan.CliIdCliente)
        .query(`SELECT TOP 1 CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @CliIdCliente AND CueTipo LIKE 'DINERO%' AND CueActiva = 1 ORDER BY CueIdCuenta`);
      if (monRes.recordset.length > 0) {
        const monCta = monRes.recordset[0].CueIdCuenta;
        
        // 1. Generar la deuda por la recarga
        await svc.registrarMovimiento({
          CueIdCuenta:    monCta,
          MovTipo:        'ORDEN',
          MovConcepto:    `Cargo por recarga plan #${PlaIdPlan} (+${CantidadAdicional} ${plan.PlaUnidad || ''})`,
          MovImporte:     -Math.abs(parseFloat(ImportePagado)),
          MovUsuarioAlta: UsuarioAlta,
        });

        // 2. Registrar el pago de esa recarga
        await svc.registrarMovimiento({
          CueIdCuenta:    monCta,
          MovTipo:        'PAGO',
          MovConcepto:    `Pago recarga plan #${PlaIdPlan}`,
          MovImporte:     Math.abs(parseFloat(ImportePagado)),
          MovUsuarioAlta: UsuarioAlta,
        });
      }
    }

    res.json({ success: true, message: `Plan #${PlaIdPlan} recargado con ${CantidadAdicional} ${plan.PlaUnidad}.` });
  } catch (err) {
    logger.error('[CONTABILIDAD] recargarPlan:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * PATCH /api/contabilidad/planes/:PlaIdPlan/desactivar
 * Desactiva un plan (lo cierra).
 */
exports.desactivarPlan = async (req, res) => {
  try {
    const PlaIdPlan = parseInt(req.params.PlaIdPlan);
    const UsuarioBaja = req.user?.id ?? 1;
    const pool = await getPool();
    
    // 1. Obtener datos del plan para ver si sobra algo
    const planRes = await pool.request()
      .input('P', sql.Int, PlaIdPlan)
      .query(`SELECT CueIdCuenta, PlaCantidadTotal, PlaCantidadUsada FROM dbo.PlanesMetros WHERE PlaIdPlan = @P AND PlaActivo = 1`);
      
    if (planRes.recordset.length > 0) {
      const p = planRes.recordset[0];
      const restante = p.PlaCantidadTotal - p.PlaCantidadUsada;

      // 2. Desactivar
      await pool.request()
        .input('PlaIdPlan',    sql.Int, PlaIdPlan)
        .input('UsuarioBaja',  sql.Int, UsuarioBaja)
        .query(`UPDATE dbo.PlanesMetros SET PlaActivo = 0, PlaFechaBaja = GETDATE(), PlaUsuarioBaja = @UsuarioBaja WHERE PlaIdPlan = @PlaIdPlan`);

      // 3. Ajuste negativo por lo que se pierde al cerrar
      if (restante > 0) {
        await svc.registrarMovimiento({
          CueIdCuenta: p.CueIdCuenta,
          MovTipo: 'AJUSTE_NEG',
          MovConcepto: `Cierre Plan #${PlaIdPlan} (Pérdida de saldo restante)`,
          MovImporte: -restante,
          MovUsuarioAlta: UsuarioBaja,
          MovObservaciones: 'Cierre manual de plan'
        });
      }
    }
    
    res.json({ success: true, message: 'Plan desactivado correctamente.' });
  } catch (err) {
    logger.error('[CONTABILIDAD] desactivarPlan:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};


/**
 * GET /api/contabilidad/ciclos/:CliIdCliente
 * Devuelve los ciclos de crédito de un cliente.
 */
exports.getCiclosCliente = async (req, res) => {
  try {
    const pool = await getPool();
    const cliId = parseInt(req.params.CliIdCliente);

    // Recalcular dinámicamente los totales de los ciclos abiertos para este cliente para asegurar consistencia
    await pool.request()
      .input('CliIdCliente', sql.Int, cliId)
      .query(`
        UPDATE c
        SET 
          c.CicTotalOrdenes = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta WHERE CicIdCiclo = c.CicIdCiclo AND MovTipo IN ('ORDEN', 'ENTREGA', 'ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado = 0)), 0),
          c.CicTotalPagos   = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta WHERE CicIdCiclo = c.CicIdCiclo AND MovTipo IN ('PAGO', 'PAGO_CRUZADO', 'ANTICIPO', 'COBRO', 'SALDO_A_FAVOR') AND (MovAnulado IS NULL OR MovAnulado = 0)), 0)
        FROM dbo.CiclosCredito c
        WHERE c.CliIdCliente = @CliIdCliente
          AND c.CicEstado = 'ABIERTO'
      `);

    const result = await pool.request()
      .input('CliIdCliente', sql.Int, cliId)
      .query(`
        SELECT
          cc.CicIdCiclo, cc.CueIdCuenta,
          cc.CicFechaInicio, cc.CicFechaCierre, cc.CicDiasAprobados,
          cc.CicTotalOrdenes, cc.CicTotalPagos, cc.CicSaldoFacturar,
          cc.CicEstado, cc.CicNumeroFactura,
          cc.CicFechaFactura, cc.CicFechaCobro
        FROM dbo.CiclosCredito cc
        WHERE cc.CliIdCliente = @CliIdCliente
          ORDER BY cc.CicFechaInicio DESC
      `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getCiclosCliente:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/ciclos
 * Abre un nuevo ciclo de crédito para una cuenta.
 * Body: { CueIdCuenta, CliIdCliente, FechaInicio? }
 */
exports.abrirCiclo = async (req, res) => {
  try {
    const { CueIdCuenta, CliIdCliente, FechaInicio = null } = req.body;
    const UsuarioAlta = req.user?.id ?? 1;
    if (!CueIdCuenta || !CliIdCliente)
      return res.status(400).json({ success: false, error: 'CueIdCuenta y CliIdCliente son obligatorios.' });

    const result = await svc.abrirCicloPorCuenta({
      CueIdCuenta: parseInt(CueIdCuenta),
      CliIdCliente: parseInt(CliIdCliente),
      UsuarioAlta,
      FechaInicio: FechaInicio ? new Date(FechaInicio) : null,
    });

    const status = result.esNuevo ? 201 : 200;
    res.status(status).json({
      success: true,
      data: result,
      message: result.esNuevo ? 'Ciclo abierto correctamente.' : 'Ya existe un ciclo abierto para esta cuenta.',
    });
  } catch (err) {
    logger.error('[CONTABILIDAD] abrirCiclo:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/ciclos/:CicIdCiclo/cerrar
 * Cierra un ciclo, genera factura y abre el siguiente ciclo automáticamente.
 */
exports.cerrarCiclo = async (req, res) => {
  try {
    const { CicIdCiclo } = req.params;
    const UsuarioAlta = req.user?.id ?? 1;

    const { 
      excluidos,
      monedaFactura,
      cotDolar,
      descuentoTipo,
      descuentoValorBase,
      montoDescuentoCalculado,
      detallesEditados,
      detallesParaPDF,
      tipoDocumento,
      observaciones,
      cliDgiNombre,
      cliDgiDocumento,
      cliDgiDireccion,
      cliDgiCiudad
    } = req.body || {};

    const result = await svc.cerrarCicloCompleto({
      CicIdCiclo: parseInt(CicIdCiclo),
      UsuarioAlta,
      excluidos: Array.isArray(excluidos) ? excluidos : [],
      monedaFactura,
      cotDolar,
      descuentoTipo,
      descuentoValorBase,
      montoDescuentoCalculado,
      detallesEditados: Array.isArray(detallesEditados) ? detallesEditados : [],
      detallesParaPDF: Array.isArray(detallesParaPDF) ? detallesParaPDF : [],
      tipoDocumento,
      observaciones,
      cliDgiNombre,
      cliDgiDocumento,
      cliDgiDireccion,
      cliDgiCiudad
    });

    res.json({
      success: true,
      data: result,
      message: `Ciclo cerrado. Factura: ${result.docNumero}. Nuevo ciclo: ${result.nuevoCiclo.CicIdCiclo}.`,
    });
  } catch (err) {
    logger.error('[CONTABILIDAD] cerrarCiclo:', err);
    res.status(500).json({ success: false, error: err.message || err.toString() });
  }
};

/**
 * GET /api/contabilidad/ciclos/:CicIdCiclo/movimientos
 * Obtiene los movimientos asociados a un ciclo.
 */
exports.getCicloMovimientos = async (req, res) => {
  try {
    const { CicIdCiclo } = req.params;
    const movimientos = await svc.getCicloMovimientos(parseInt(CicIdCiclo));
    res.json({ success: true, data: movimientos });
  } catch (err) {
    logger.error('[CONTABILIDAD] getCicloMovimientos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/ciclos/cerrar-vencidos
 * Cierra masivamente todos los ciclos cuya fecha ya pasó.
 * Útil para disparar manualmente o desde el CRON.
 */
exports.cerrarCiclosVencidos = async (req, res) => {
  try {
    const result = await svc.cerrarCiclosVencidos();
    res.json({
      success: true,
      data: result,
      message: `Ciclos cerrados: ${result.procesados}. Errores: ${result.errores}.`,
    });
  } catch (err) {
    logger.error('[CONTABILIDAD] cerrarCiclosVencidos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SECCIÓN 6: PLANES DE METROS
// ============================================================

/**
 * GET /api/contabilidad/planes/:CliIdCliente
 * Devuelve los planes de metros activos e históricos del cliente.
 */
exports.getPlanesMetros = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('CliIdCliente', sql.Int, parseInt(req.params.CliIdCliente))
      .query(`
        SELECT
          p.PlaIdPlan, p.CueIdCuenta, p.ProIdProducto,
          art.Descripcion AS NombreArticulo,
          p.PlaDescripcion,
          p.PlaCantidadTotal,
          p.PlaCantidadUsada,
          p.PlaCantidadTotal - p.PlaCantidadUsada AS PlaCantidadPendiente,
          CASE WHEN p.PlaCantidadTotal > 0
               THEN CAST(p.PlaCantidadUsada * 100.0 / p.PlaCantidadTotal AS DECIMAL(5,2))
               ELSE 0
          END AS PorcentajeUsado,
          p.PlaPrecioUnitario, mon.MonSimbolo,
          p.PlaFechaInicio, p.PlaFechaVencimiento,
          p.PlaActivo
        FROM      dbo.PlanesMetros p
        LEFT JOIN dbo.Articulos a   ON a.ProIdProducto = p.ProIdProducto
        LEFT JOIN dbo.Monedas   mon ON mon.MonIdMoneda  = p.MonIdMoneda
        CROSS APPLY (SELECT LTRIM(RTRIM(a.Descripcion)) AS Descripcion) art
        WHERE p.CliIdCliente = @CliIdCliente
        ORDER BY p.PlaActivo DESC, p.PlaFechaInicio DESC
      `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getPlanesMetros:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/planes
 * Crea un nuevo plan de metros/kg prepago.
 * Body: { CliIdCliente, CueIdCuenta, ProIdProducto, PlaCantidadTotal,
 *          PlaPrecioUnitario?, MonIdMoneda?, PlaFechaInicio, PlaFechaVencimiento?, PlaDescripcion? }
 */
exports.crearPlanMetros = async (req, res) => {
  try {
    const {
      CliIdCliente, CueIdCuenta, ProIdProducto,
      PlaCantidadTotal, PlaPrecioUnitario = null,
      MonIdMoneda = null, PlaFechaInicio, PlaFechaVencimiento = null,
      PlaDescripcion = null,
    } = req.body;

    const UsuarioAlta = req.user?.id ?? 1;

    if (!CliIdCliente || !CueIdCuenta || !ProIdProducto || !PlaCantidadTotal || !PlaFechaInicio) {
      return res.status(400).json({ success: false, error: 'Faltan campos obligatorios.' });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('CliIdCliente',      sql.Int,          CliIdCliente)
      .input('CueIdCuenta',       sql.Int,          CueIdCuenta)
      .input('ProIdProducto',     sql.Int,          ProIdProducto)
      .input('PlaCantidadTotal',  sql.Decimal(18,4), PlaCantidadTotal)
      .input('PlaPrecioUnitario', sql.Decimal(18,4), PlaPrecioUnitario)
      .input('MonIdMoneda',       sql.Int,          MonIdMoneda)
      .input('PlaFechaInicio',    sql.Date,         new Date(PlaFechaInicio))
      .input('PlaFechaVencimiento', sql.Date,       PlaFechaVencimiento ? new Date(PlaFechaVencimiento) : null)
      .input('PlaDescripcion',    sql.NVarChar(200), PlaDescripcion)
      .input('UsuarioAlta',       sql.Int,          UsuarioAlta)
      .query(`
        INSERT INTO dbo.PlanesMetros
          (CliIdCliente, CueIdCuenta, ProIdProducto, PlaCantidadTotal, PlaCantidadUsada,
           PlaPrecioUnitario, MonIdMoneda, PlaFechaInicio, PlaFechaVencimiento,
           PlaDescripcion, PlaActivo, PlaFechaAlta, PlaUsuarioAlta)
        OUTPUT INSERTED.PlaIdPlan
        VALUES
          (@CliIdCliente, @CueIdCuenta, @ProIdProducto, @PlaCantidadTotal, 0,
           @PlaPrecioUnitario, @MonIdMoneda, @PlaFechaInicio, @PlaFechaVencimiento,
           @PlaDescripcion, 1, GETDATE(), @UsuarioAlta)
      `);

    res.status(201).json({ success: true, data: { PlaIdPlan: result.recordset[0].PlaIdPlan } });
  } catch (err) {
    logger.error('[CONTABILIDAD] crearPlanMetros:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SECCIÓN 7: REPORTES
// ============================================================

/**
 * GET /api/contabilidad/reportes/antiguedad-deuda
 * Tabla de antigüedad de deuda de todos los clientes con saldo.
 * Tramos: Al día / 1-30 / 31-60 / 61-90 / +90 días.
 */
exports.getAntiguedadDeuda = async (req, res) => {
  try {
    const { modo } = req.query;
    const datos = await svc.getAntiguedadDeuda(modo);
    res.json({ success: true, data: datos });
  } catch (err) {
    logger.error('[CONTABILIDAD] getAntiguedadDeuda:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/contabilidad/reportes/estado-cuenta/:CliIdCliente
 * Estado de cuenta completo de un cliente (todas sus cuentas + movimientos + deudas).
 * Query: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 */
exports.getEstadoCuentaCliente = async (req, res) => {
  try {
    const { CliIdCliente } = req.params;
    const { desde = null, hasta = null } = req.query;

    // 1. Datos del cliente
    const pool = await getPool();
    const cliRes = await pool.request()
      .input('CliIdCliente', sql.Int, parseInt(CliIdCliente))
      .query(`
        SELECT CliIdCliente, Nombre, NombreFantasia, Email, TelefonoTrabajo, CioRuc
        FROM   dbo.Clientes
        WHERE  CliIdCliente = @CliIdCliente
      `);

    if (cliRes.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
    }

    const cliente = cliRes.recordset[0];

    // 2. Cuentas + saldo
    const cuentas = await svc.getSaldoCliente(parseInt(CliIdCliente));

    // 3. Para cada cuenta: movimientos y deudas
    const cuentasDetalle = await Promise.all(
      cuentas.map(async (cuenta) => {
        const [movimientos, deudas] = await Promise.all([
          svc.getMovimientos(
            cuenta.CueIdCuenta,
            desde ? new Date(desde) : null,
            hasta ? new Date(hasta) : null,
            200,
          ),
          svc.getDeudas(cuenta.CueIdCuenta),
        ]);
        return { ...cuenta, movimientos, deudas };
      })
    );

    res.json({
      success: true,
      data: {
        cliente,
        cuentas: cuentasDetalle,
        generadoEn: new Date().toISOString(),
      }
    });
  } catch (err) {
    logger.error('[CONTABILIDAD] getEstadoCuentaCliente:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SECCIÓN 8: COLA DE ESTADOS DE CUENTA
// ============================================================

const emailSvc = require('../services/contabilidadEmailService');
let _batchFns = null;
const getBatch = () => {
  if (!_batchFns) _batchFns = require('../jobs/estadosCuenta.job');
  return _batchFns;
};

/** GET /api/contabilidad/cola/:ColIdCola/preview — devuelve HTML renderizado */
exports.previewEstadoCola = async (req, res) => {
  try {
    const pool    = await getPool();
    const itemRes = await pool.request()
      .input('ColIdCola', sql.Int, parseInt(req.params.ColIdCola))
      .query(`SELECT ColContenidoJSON, ColAsunto, ColEmailDestino FROM dbo.ColaEstadosCuenta WHERE ColIdCola = @ColIdCola`);

    if (!itemRes.recordset.length)
      return res.status(404).json({ success: false, error: 'No encontrado.' });

    const item = itemRes.recordset[0];
    let datos;
    try { datos = JSON.parse(item.ColContenidoJSON); } catch { datos = {}; }

    const { generarHTMLEstadoCuenta, obtenerDatosEmpresa } = require('../services/contabilidadEmailService');
    const empresa = await obtenerDatosEmpresa();
    const html = generarHTMLEstadoCuenta(datos, empresa);

    // Devolver como HTML directamente (para iframe) o como JSON según Accept header
    if (req.headers.accept?.includes('text/html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    res.json({ success: true, html, asunto: item.ColAsunto, email: item.ColEmailDestino });
  } catch (err) {
    logger.error('[CONTABILIDAD] previewEstadoCola:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/contabilidad/cola  — lista la cola con filtros */

exports.getColaEstados = async (req, res) => {
  try {
    const { estado = null, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pool   = await getPool();
    const req2   = pool.request()
      .input('Limit',  sql.Int, parseInt(limit))
      .input('Offset', sql.Int, offset);
    const where = estado ? `AND ColEstado = @Estado` : '';
    if (estado) req2.input('Estado', sql.VarChar(20), estado);

    const result = await req2.query(`
      SELECT c.ColIdCola, c.CliIdCliente, cl.Nombre AS NombreCliente,
             c.ColAsunto, c.ColEmailDestino, c.ColEstado,
             c.ColFechaGeneracion, c.ColFechaEnvio, c.ColErrorEnvio,
             c.ColTipoDisparo, c.ColFechaDesde, c.ColFechaHasta
      FROM   dbo.ColaEstadosCuenta c WITH (NOLOCK)
      JOIN   dbo.Clientes cl        WITH (NOLOCK) ON cl.CliIdCliente = c.CliIdCliente
      WHERE  1=1 ${where}
      ORDER  BY c.ColFechaGeneracion DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY
    `);
    const countRes = await pool.request()
      .input('EstadoF', sql.VarChar(20), estado || '')
      .query(`SELECT COUNT(*) AS total FROM dbo.ColaEstadosCuenta ${estado ? `WHERE ColEstado = @EstadoF` : ''}`);

    res.json({ success: true, data: result.recordset, total: countRes.recordset[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error('[CONTABILIDAD] getColaEstados:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/** PATCH /api/contabilidad/cola/:ColIdCola/estado — aprobar/rechazar */
exports.cambiarEstadoCola = async (req, res) => {
  try {
    const { ColIdCola } = req.params;
    const { estado }    = req.body;
    if (!['PENDIENTE','APROBADO','RECHAZADO'].includes(estado))
      return res.status(400).json({ success: false, error: 'Estado inválido.' });
    const pool = await getPool();
    await pool.request()
      .input('ColIdCola', sql.Int,        parseInt(ColIdCola))
      .input('Estado',    sql.VarChar(20), estado)
      .query(`UPDATE dbo.ColaEstadosCuenta SET ColEstado = @Estado WHERE ColIdCola = @ColIdCola`);
    res.json({ success: true, message: `Estado actualizado a ${estado}` });
  } catch (err) {
    logger.error('[CONTABILIDAD] cambiarEstadoCola:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/contabilidad/cola/:ColIdCola/enviar — envía un registro */
exports.enviarEstadoCola = async (req, res) => {
  try {
    const pool    = await getPool();
    const itemRes = await pool.request()
      .input('ColIdCola', sql.Int, parseInt(req.params.ColIdCola))
      .query(`SELECT ColIdCola, ColContenidoJSON, ColAsunto, ColEmailDestino FROM dbo.ColaEstadosCuenta WHERE ColIdCola = @ColIdCola`);
    if (!itemRes.recordset.length) return res.status(404).json({ success: false, error: 'No encontrado.' });
    const item  = itemRes.recordset[0];
    let datos;
    try { datos = JSON.parse(item.ColContenidoJSON); } catch { datos = {}; }
    const result = await emailSvc.enviarDesdeCola({ ColIdCola: item.ColIdCola, destinatario: item.ColEmailDestino, asunto: item.ColAsunto, datos, pool, sql });
    res.json({ success: result.ok, data: result });
  } catch (err) {
    logger.error('[CONTABILIDAD] enviarEstadoCola:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/contabilidad/cola/enviar-aprobados — envía todos los APROBADOS (o IDs pasados) */
exports.enviarAprobados = async (req, res) => {
  try {
    const { ids = null } = req.body;
    const pool   = await getPool();
    const result = await getBatch().enviarColaAprobados(pool, ids?.length ? ids : null);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('[CONTABILIDAD] enviarAprobados:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/contabilidad/cola/generar — dispara la generación manual */
exports.generarEstadosManual = async (req, res) => {
  try {
    logger.info(`[CONTABILIDAD] Generación manual por usuario ${req.user?.id}`);
    getBatch().runEstadosCuentaBatch().catch(e => logger.error('[CONTABILIDAD] Error batch manual:', e.message));
    res.json({ success: true, message: 'Generación iniciada en segundo plano. Revisá la cola en unos segundos.' });
  } catch (err) {
    logger.error('[CONTABILIDAD] generarEstadosManual:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/contabilidad/clientes-activos
 * Lista clientes con saldo ≠ 0 o deuda/ciclo pendiente.
 * Query: ?q=texto (filtro opcional por nombre)
 */
exports.getClientesActivos = async (req, res) => {
  try {
    const { q = '', tipo = '', todos = 'false' } = req.query;
    const pool = await getPool();
    const request = pool.request();

    const filtroNombre = q.trim()
      ? `AND (
          c.Nombre LIKE @Q 
          OR c.NombreFantasia LIKE @Q 
          OR c.Email LIKE @Q 
          OR c.TelefonoTrabajo LIKE @Q 
          OR c.CioRuc LIKE @Q 
          OR CAST(c.CliIdCliente AS VARCHAR) = @Qexact
          OR CAST(c.CodCliente AS VARCHAR) = @Qexact
         )`
      : '';
    if (q.trim()) {
      request.input('Q',      sql.NVarChar(200), `%${q.trim()}%`);
      request.input('Qexact', sql.NVarChar(50),   q.trim());
    }

    // ── Modo RECURSOS: clientes con al menos 1 cuenta no monetaria ──────────
    if (tipo.toUpperCase() === 'RECURSOS') {
      const result = await request.query(`
        SELECT DISTINCT
          c.CliIdCliente,
          RTRIM(LTRIM(c.Nombre)) AS Nombre,
          RTRIM(LTRIM(c.NombreFantasia)) AS NombreFantasia,
          RTRIM(LTRIM(c.Email)) AS Email,
          c.CodCliente,
          RTRIM(LTRIM(c.IDCliente)) AS IDCliente,
          c.TClIdTipoCliente,
          RTRIM(LTRIM(c.CioRuc)) AS CioRuc,
          RTRIM(LTRIM(c.DireccionTrabajo)) AS DireccionTrabajo,
          c.DepartamentoID,
          RTRIM(LTRIM(c.TelefonoTrabajo)) AS TelefonoTrabajo,
          COUNT(DISTINCT cc.CueIdCuenta) AS TotalCuentas
        FROM      dbo.CuentasCliente cc WITH(NOLOCK)
        JOIN      dbo.Clientes        c  WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
        WHERE cc.CueActiva = 1
          AND cc.CueTipo NOT IN ('USD','UYU','ARS','EUR','PYG','BRL')
          ${filtroNombre}
        GROUP BY c.CliIdCliente, c.Nombre, c.NombreFantasia, c.Email, c.CodCliente, c.IDCliente, c.TClIdTipoCliente, c.CioRuc, c.DireccionTrabajo, c.DepartamentoID, c.TelefonoTrabajo
        ORDER BY RTRIM(LTRIM(c.Nombre))
      `);
      return res.json({ success: true, data: result.recordset });
    }

    // ── Modo TODOS: todos los clientes sin importar si tienen cuentas ───────
    if (tipo.toUpperCase() === 'TODOS') {
      const result = await request.query(`
        SELECT TOP 50
          c.CliIdCliente,
          RTRIM(LTRIM(c.Nombre)) AS Nombre,
          RTRIM(LTRIM(c.NombreFantasia)) AS NombreFantasia,
          RTRIM(LTRIM(c.Email)) AS Email,
          c.CodCliente,
          RTRIM(LTRIM(c.IDCliente)) AS IDCliente,
          c.TClIdTipoCliente,
          RTRIM(LTRIM(c.CioRuc)) AS CioRuc,
          RTRIM(LTRIM(c.DireccionTrabajo)) AS DireccionTrabajo,
          c.DepartamentoID,
          RTRIM(LTRIM(c.TelefonoTrabajo)) AS TelefonoTrabajo
        FROM dbo.Clientes c WITH(NOLOCK)
        WHERE 1=1 ${filtroNombre}
        ORDER BY RTRIM(LTRIM(c.Nombre))
      `);
      return res.json({ success: true, data: result.recordset });
    }

    // ── Modo normal: clientes con deuda / saldo / ciclo ─────────────────────
    const result = await request.query(`
      DECLARE @TC DECIMAL(18,4) = ISNULL((SELECT TOP 1 CotDolar FROM dbo.Cotizaciones ORDER BY CotFecha DESC), 40.0);

      SELECT
        c.CliIdCliente,
        RTRIM(LTRIM(c.Nombre)) AS Nombre,
        RTRIM(LTRIM(c.NombreFantasia)) AS NombreFantasia,
        RTRIM(LTRIM(c.Email)) AS Email,
        c.CodCliente,
        RTRIM(LTRIM(c.IDCliente)) AS IDCliente,
        c.TClIdTipoCliente,
        RTRIM(LTRIM(c.CioRuc)) AS CioRuc,
        RTRIM(LTRIM(c.DireccionTrabajo)) AS DireccionTrabajo,
        c.DepartamentoID,
        RTRIM(LTRIM(c.TelefonoTrabajo)) AS TelefonoTrabajo,
        COUNT(DISTINCT cc.CueIdCuenta)                                                           AS TotalCuentas,
        ISNULL(SUM(CASE WHEN cc.MonIdMoneda = 2 THEN cc.CueSaldoActual * @TC ELSE cc.CueSaldoActual END), 0) AS SaldoTotal,
        ISNULL(SUM(CASE WHEN cc.MonIdMoneda = 2 THEN dd.DDeImportePendiente * @TC ELSE dd.DDeImportePendiente END), 0) AS DeudaTotal,
        SUM(CASE WHEN dd.DDeFechaVencimiento < GETDATE()
                  AND dd.DDeEstado IN ('PENDIENTE','VENCIDO') THEN 1 ELSE 0 END)                 AS DocsVencidos,
        MAX(CASE WHEN cc.CueDiasCiclo > 0 THEN 1 ELSE 0 END)                                    AS EsSemanal,
        MAX(CASE WHEN cic.CicEstado = 'ABIERTO' THEN 1 ELSE 0 END)                              AS TieneCicloAbierto
      FROM      dbo.CuentasCliente cc WITH(NOLOCK)
      JOIN      dbo.Clientes        c  WITH(NOLOCK) ON c.CliIdCliente  = cc.CliIdCliente
      LEFT JOIN dbo.DeudaDocumento  dd WITH(NOLOCK) ON dd.CueIdCuenta  = cc.CueIdCuenta
                                                    AND dd.DDeEstado   IN ('PENDIENTE','VENCIDO','PARCIAL')
      LEFT JOIN dbo.CiclosCredito  cic WITH(NOLOCK) ON cic.CueIdCuenta = cc.CueIdCuenta
                                                    AND cic.CicEstado  = 'ABIERTO'
      WHERE cc.CueActiva = 1
        AND (
            cc.CueSaldoActual <> 0 
            OR dd.DDeIdDocumento IS NOT NULL 
            OR cic.CicIdCiclo IS NOT NULL
            ${(q.trim() || todos === 'true') ? "OR 1=1" : ""}
        )
        ${filtroNombre}
      GROUP BY c.CliIdCliente, c.Nombre, c.NombreFantasia, c.Email, c.CodCliente, c.IDCliente, c.TClIdTipoCliente, c.CioRuc, c.DireccionTrabajo, c.DepartamentoID, c.TelefonoTrabajo
      ORDER BY ABS(SUM(cc.CueSaldoActual)) DESC, RTRIM(LTRIM(c.Nombre))
    `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getClientesActivos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SECCIÓN 7b: DEUDAS CONSOLIDADAS GLOBAL
// ============================================================

/**
 * GET /api/contabilidad/reportes/deuda-consolidada
 * Lista todos los clientes con deuda pendiente, ordenados por antigüedad.
 * Query: ?moneda=UYU|USD&estado=VENCIDO|PENDIENTE|PARCIAL&dias_min=0&dias_max=999
 */
exports.getDeudaConsolidada = async (req, res) => {
  try {
    const {
      moneda   = null,
      estado   = null,
      dias_min = 0,
      dias_max = 9999,
    } = req.query;
    const pool = await getPool();

    const filtros = [];
    if (moneda)  filtros.push(`mon.MonDescripcionMoneda LIKE '%${moneda === 'USD' ? 'Dólar' : 'Peso'}%'`);
    if (estado)  filtros.push(`dd.DDeEstado = '${estado}'`);
    filtros.push(`DATEDIFF(DAY, dd.DDeFechaVencimiento, GETDATE()) >= ${parseInt(dias_min)}`);
    filtros.push(`DATEDIFF(DAY, dd.DDeFechaVencimiento, GETDATE()) <= ${parseInt(dias_max)}`);

    const where = filtros.length ? `AND ${filtros.join(' AND ')}` : '';

    const result = await pool.request().query(`
      SELECT
        c.CliIdCliente,
        c.Nombre                                                  AS NombreCliente,
        c.CodCliente,
        cc.CueIdCuenta,
        cc.CueTipo,
        mon.MonSimbolo,
        dd.DDeIdDocumento,
        dd.DDeEstado,
        dd.DDeFechaEmision,
        dd.DDeFechaVencimiento,
        dd.DDeImporteOriginal,
        dd.DDeImportePendiente,
        DATEDIFF(DAY, dd.DDeFechaVencimiento, GETDATE())          AS DiasVencido,
        COALESCE(
          od.OrdCodigoOrden, 
          ordERP.CodigoOrden,
          (SELECT TOP 1 ISNULL(od2.OrdCodigoOrden, td.TdeCodigoReferencia)
           FROM dbo.TransaccionDetalle td WITH(NOLOCK)
           JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.TcaIdTransaccion = td.TcaIdTransaccion
           LEFT JOIN dbo.OrdenesRetiro ordRet WITH(NOLOCK) ON ordRet.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
           LEFT JOIN dbo.OrdenesDeposito od2 WITH(NOLOCK) ON od2.OReIdOrdenRetiro = ordRet.OReIdOrdenRetiro
           WHERE doc.DocIdDocumento = dd.DocIdDocumento),
          'VTA-DIR'
        ) AS NroOrden,
        COALESCE(
          od.OrdNombreTrabajo, 
          ordERP.DescripcionTrabajo,
          (SELECT TOP 1 od2.OrdNombreTrabajo
           FROM dbo.TransaccionDetalle td WITH(NOLOCK)
           JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.TcaIdTransaccion = td.TcaIdTransaccion
           LEFT JOIN dbo.OrdenesRetiro ordRet WITH(NOLOCK) ON ordRet.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
           LEFT JOIN dbo.OrdenesDeposito od2 WITH(NOLOCK) ON od2.OReIdOrdenRetiro = ordRet.OReIdOrdenRetiro
           WHERE doc.DocIdDocumento = dd.DocIdDocumento
           AND od2.OrdNombreTrabajo IS NOT NULL AND od2.OrdNombreTrabajo != 'S/N'
          ),
          'Venta Directa'
        ) AS NombreTrabajo
      FROM      dbo.DeudaDocumento   dd WITH(NOLOCK)
      JOIN      dbo.CuentasCliente   cc  WITH(NOLOCK) ON cc.CueIdCuenta  = dd.CueIdCuenta
      JOIN      dbo.Clientes         c   WITH(NOLOCK) ON c.CliIdCliente  = cc.CliIdCliente
      LEFT JOIN dbo.Monedas          mon WITH(NOLOCK) ON mon.MonIdMoneda = cc.MonIdMoneda
      LEFT JOIN dbo.OrdenesDeposito  od  WITH(NOLOCK) ON od.OrdIdOrden   = dd.OrdIdOrden
      LEFT JOIN dbo.Ordenes          ordERP WITH(NOLOCK) ON ordERP.OrdenID = dd.OrdIdOrden
      WHERE dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
        ${where}
      ORDER BY DATEDIFF(DAY, dd.DDeFechaVencimiento, GETDATE()) DESC, c.Nombre
    `);

    // Agrupar por cliente y tipo de cuenta para no mezclar monedas
    const mapa = {};
    for (const row of result.recordset) {
      const key = `${row.CliIdCliente}-${row.CueTipo}`;
      if (!mapa[key]) {
        mapa[key] = {
          CliIdCliente:    row.CliIdCliente,
          NombreCliente:   row.NombreCliente,
          CodCliente:      row.CodCliente,
          MonSimbolo:      row.MonSimbolo,
          CueTipo:         row.CueTipo,
          TotalPendiente:  0,
          DocsTotal:       0,
          DocsVencidos:    0,
          DiasMaxVencido:  0,
          docs:            [],
        };
      }
      const cl = mapa[key];
      cl.TotalPendiente  += Number(row.DDeImportePendiente);
      cl.DocsTotal++;
      if (row.DiasVencido > 0) cl.DocsVencidos++;
      if (row.DiasVencido > cl.DiasMaxVencido) cl.DiasMaxVencido = row.DiasVencido;
      cl.docs.push(row);
    }

    res.json({
      success: true,
      data: Object.values(mapa),
      totalClientes: Object.keys(mapa).length,
      totalDocs: result.recordset.length,
    });
  } catch (err) {
    logger.error('[CONTABILIDAD] getDeudaConsolidada:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SECCIÓN 8: DUALIDAD DE MONEDA — MONEDAS, COTIZACIÓN, CONVERSIÓN
// ============================================================

// (getMonedas ya está definido al inicio del archivo — no duplicar)


/**
 * GET /api/contabilidad/cotizacion-hoy
 * Devuelve la cotización vigente del día (USD → UYU).
 * Usa la última cotización registrada si hoy no tiene entrada.
 */
exports.getCotizacionHoy = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 1
        CotFecha,
        CotDolar AS CotCompra,
        CotDolar AS CotVenta,
        CotDolar AS CotPromedio
      FROM   dbo.Cotizaciones
      ORDER  BY CotFecha DESC
    `);

    if (!result.recordset.length)
      return res.status(404).json({ success: false, error: 'Sin cotizaciones registradas.' });

    const cot = result.recordset[0];
    res.json({
      success: true,
      data: {
        fecha:    cot.CotFecha,
        compra:   Number(cot.CotCompra),
        venta:    Number(cot.CotVenta),
        promedio: Number(cot.CotPromedio),
      },
    });
  } catch (err) {
    logger.error('[CONTABILIDAD] getCotizacionHoy:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/movimientos/pago-cruzado
 * Registra un pago en una moneda diferente a la cuenta del cliente.
 * Ej: cliente debe en UYU → paga en USD → se convierte y se imputa en la cuenta UYU.
 *
 * Body: {
 *   CueIdCuenta,          // la cuenta donde se imputa (la de la deuda)
 *   ImporteOriginal,      // importe pagado en la moneda del pago
 *   MonedaPago,           // 'USD' o 'UYU' (moneda con la que paga el cliente)
 *   TipoCambio?,          // si se quiere fijar manualmente (default: cotización del día)
 *   MovConcepto?,
 *   Referencia?,
 * }
 */
exports.registrarPagoCruzado = async (req, res) => {
  try {
    const {
      CueIdCuenta,
      ImporteOriginal,
      MonedaPago,
      TipoCambio     = null,
      MovConcepto    = 'Pago cross-currency',
      Referencia     = null,
    } = req.body;
    const UsuarioAlta = req.user?.id ?? 1;

    if (!CueIdCuenta || !ImporteOriginal || Number(ImporteOriginal) <= 0 || !MonedaPago)
      return res.status(400).json({ success: false, error: 'CueIdCuenta, ImporteOriginal y MonedaPago son obligatorios.' });

    const pool = await getPool();

    // Obtener moneda de la cuenta destino
    const cuentaRes = await pool.request()
      .input('CueIdCuenta', sql.Int, parseInt(CueIdCuenta))
      .query(`
        SELECT cc.CueTipo, cc.MonIdMoneda,
               ISNULL(mon.MonSimbolo, CASE WHEN cc.CueTipo LIKE '%USD%' THEN 'US' ELSE '$U' END) AS MonSimbolo,
               ISNULL(mon.MonDescripcionMoneda, cc.CueTipo) AS MonNombre
        FROM dbo.CuentasCliente cc
        LEFT JOIN dbo.Monedas mon ON mon.MonIdMoneda = cc.MonIdMoneda
        WHERE cc.CueIdCuenta = @CueIdCuenta
      `);

    if (!cuentaRes.recordset.length)
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada.' });

    const { CueTipo, MonSimbolo, MonNombre, MonIdMoneda } = cuentaRes.recordset[0];

    // Determinar si hay conversión necesaria
    // Derive moneda de la cuenta desde CueTipo (más fiable que MonIdMoneda)
    const monedaCuenta  = CueTipo?.toUpperCase().includes('USD') ? 'USD' : 'UYU';
    const esConversion  = monedaCuenta !== MonedaPago;

    let importeConvertido = parseFloat(ImporteOriginal);
    let tcUsado = null;

    if (esConversion) {
      // Obtener cotización vigente
      let tc = TipoCambio ? parseFloat(TipoCambio) : null;
      if (!tc) {
        const cotRes = await pool.request().query(`SELECT TOP 1 CotDolar AS tc FROM dbo.Cotizaciones ORDER BY CotFecha DESC`);
        if (!cotRes.recordset.length)
          return res.status(400).json({ success: false, error: 'Sin cotización disponible. Ingresá el tipo de cambio manualmente.' });
        tc = Number(cotRes.recordset[0].tc);
      }
      tcUsado = tc;

      // Convertir: si paga en USD y debe en UYU → multiplica; inverso → divide
      importeConvertido = MonedaPago === 'USD' && monedaCuenta === 'UYU'
        ? parseFloat(ImporteOriginal) * tc
        : parseFloat(ImporteOriginal) / tc;
    }

    // Acreditar en cuenta destino
    const { MovIdGenerado, SaldoResultante } = await svc.registrarMovimiento({
      CueIdCuenta:    parseInt(CueIdCuenta),
      MovTipo:        'PAGO',
      MovConcepto:    `${MovConcepto} (${MonedaPago} -> ${monedaCuenta}${tcUsado ? ` TC:${tcUsado}` : ''})`,
      MovImporte:     importeConvertido,
      MovUsuarioAlta: UsuarioAlta,
      MovRefExterna:  Referencia,
      MovObservaciones: esConversion
        ? `Importe original: ${ImporteOriginal} ${MonedaPago}. TC: ${tcUsado}. Convertido: ${importeConvertido.toFixed(2)} ${monedaCuenta}`
        : null,
    });

    // Imputar contra deudas PEPS
    const { MontoExcedente } = await svc.imputarPago({
      PagIdPago:       MovIdGenerado,
      MontoDisponible: importeConvertido,
      CueIdCuenta:     parseInt(CueIdCuenta),
      UsuarioAlta,
    });

    if (MontoExcedente > 0) {
      await svc.registrarMovimiento({
        CueIdCuenta:    parseInt(CueIdCuenta),
        MovTipo:        'NOTA_CREDITO',
        MovConcepto:    `Crédito a favor por pago cruzado (excedente)`,
        MovImporte:     MontoExcedente,
        MovUsuarioAlta: UsuarioAlta,
      });
    }

    res.json({
      success: true,
      data: {
        MovIdGenerado,
        SaldoResultante,
        importeOriginal:   parseFloat(ImporteOriginal),
        monedaPago:        MonedaPago,
        tipoCambio:        tcUsado,
        importeConvertido: importeConvertido.toFixed(4),
        monedaCuenta,
        imputado:          (importeConvertido - MontoExcedente).toFixed(2),
        credito:           MontoExcedente,
      },
      message: esConversion
        ? `✅ Pago ${ImporteOriginal} ${MonedaPago} convertido a ${importeConvertido.toFixed(2)} ${monedaCuenta} (TC: ${tcUsado}). Imputado: ${(importeConvertido - MontoExcedente).toFixed(2)}.`
        : `✅ Pago ${ImporteOriginal} ${MonedaPago} imputado. Excedente: ${fmt(MontoExcedente)}.`,
    });
  } catch (err) {
    logger.error('[CONTABILIDAD] registrarPagoCruzado:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/contabilidad/movimientos/:MovIdMovimiento/recibo/pdf
 * Genera un PDF de recibo de cobro formal.
 */
exports.generarReciboPdf = async (req, res) => {
  try {
    const { MovIdMovimiento } = req.params;
    const pool = await getPool();

    // Consultar información del movimiento, cuenta, cliente y moneda
    const query = `
      SELECT 
        m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovConcepto, m.MovImporte, m.MovObservaciones,
        c.CliIdCliente, cli.Nombre, cli.IDCliente, cli.CioRuc, cli.DireccionTrabajo,
        mon.MonSimbolo, ISNULL(mon.MonDescripcionMoneda, '') AS MonNombre
      FROM MovimientosCuenta m
      JOIN CuentasCliente c ON m.CueIdCuenta = c.CueIdCuenta
      JOIN Clientes cli ON c.CliIdCliente = cli.CliIdCliente
      LEFT JOIN Monedas mon ON c.MonIdMoneda = mon.MonIdMoneda
      WHERE m.MovIdMovimiento = @MovIdMovimiento
    `;
    const result = await pool.request()
      .input('MovIdMovimiento', sql.Int, MovIdMovimiento)
      .query(query);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'Movimiento no encontrado' });
    }

    const mov = result.recordset[0];
    const importe = Math.abs(parseFloat(mov.MovImporte));
    const isPayment = (mov.MovTipo === 'PAGO' || mov.MovTipo === 'ANTICIPO' || mov.MovTipo === 'COBRO' || mov.MovTipo === 'SALDO_INICIAL' || mov.MovImporte > 0);

    // Formateadores
    const fmtNum = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    const dateStr = new Date(mov.MovFecha).toLocaleDateString('es-UY', { year: 'numeric', month: 'long', day: 'numeric' });
    const receiptNum = `REC-${mov.MovIdMovimiento.toString().padStart(6, '0')}`;

    // Generar PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 420.94]); // Formato A5 apaisado (aproximadamente la mitad de A4)
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    const drawText = (text, x, y, size = 10, f = font, color = rgb(0, 0, 0)) => {
      page.drawText(text, { x, y, size, font: f, color });
    };

    // Rectángulo del recibo
    page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 1 });
    page.drawRectangle({ x: 20, y: height - 80, width: width - 40, height: 60, color: rgb(0.9, 0.9, 0.9), borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 1 });

    // Cabecera
    drawText('RECIBO OFICIAL DE COBRO', 40, height - 50, 16, fontBold, rgb(0.1, 0.1, 0.4));
    drawText(`N°: ${receiptNum}`, width - 150, height - 45, 14, fontBold, rgb(0.7, 0.1, 0.1));
    drawText(`Fecha: ${dateStr}`, width - 150, height - 65, 10, font);

    // Monto principal
    drawText('POR LA SUMA DE:', 40, height - 110, 10, fontBold);
    const montoText = `${mov.MonSimbolo || '$'} ${fmtNum(importe)}`;
    drawText(montoText, 40, height - 140, 20, fontBold, rgb(0.1, 0.4, 0.1));

    // Datos del Cliente
    drawText('RECIBIMOS DE:', width / 2, height - 110, 10, fontBold);
    drawText(mov.Nombre || 'Cliente Consumidor', width / 2, height - 130, 12, font);
    drawText(`ID / RUC: ${mov.IDCliente || mov.CioRuc || '-'}`, width / 2, height - 145, 10, font);

    // Línea separadora
    page.drawLine({ start: { x: 40, y: height - 170 }, end: { x: width - 40, y: height - 170 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });

    // Concepto
    drawText('EN CONCEPTO DE:', 40, height - 195, 10, fontBold);
    let concepto = mov.MovConcepto || (mov.MovTipo === 'ANTICIPO' ? 'Pago a cuenta / Anticipo' : 'Cancelación de saldos');
    concepto = concepto.replace(/→/g, '->').replace(/[\u2013\u2014]/g, '-');
    drawText(concepto, 40, height - 215, 11, font);

    if (mov.MovObservaciones) {
      drawText('OBSERVACIONES:', 40, height - 245, 9, fontBold, rgb(0.4, 0.4, 0.4));
      // Truncate observaciones if too long
      let obs = mov.MovObservaciones.length > 80 ? mov.MovObservaciones.substring(0, 80) + '...' : mov.MovObservaciones;
      obs = obs.replace(/→/g, '->').replace(/[\u2013\u2014]/g, '-');
      drawText(obs, 40, height - 260, 9, font, rgb(0.4, 0.4, 0.4));
    }

    // Pie (Firmas)
    page.drawLine({ start: { x: width - 200, y: 70 }, end: { x: width - 40, y: 70 }, thickness: 1, color: rgb(0, 0, 0) });
    drawText('Firma / Sello de la Empresa', width - 180, 55, 9, font);

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Recibo-${receiptNum}.pdf`);
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    logger.error('[CONTABILIDAD] generarReciboPdf:', err);
    res.status(500).json({ success: false, error: 'Error generando PDF: ' + (err.message || err.toString()) });
  }
};

// ============================================================
// SECCIÓN: CATÁLOGO DE TIPOS DE MOVIMIENTO
// ============================================================

/**
 * GET /api/contabilidad/tipos-movimiento
 */
exports.getTiposMovimiento = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TmoId, TmoNombre, TmoDescripcion,
             TmoPrefijo, TmoSecuencia,
             TmoAfectaSaldo, TmoGeneraDeuda,
             TmoAplicaRecurso, TmoRequiereDoc,
             TmoActivo, TmoOrden
      FROM dbo.TiposMovimiento
      ORDER BY TmoOrden ASC, TmoId ASC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD] getTiposMovimiento:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * PATCH /api/contabilidad/tipos-movimiento/:TmoId
 * Body: campos editables (solo los que se envíen se modifican)
 */
exports.updateTipoMovimiento = async (req, res) => {
  try {
    const { TmoId } = req.params;
    const { TmoNombre, TmoDescripcion, TmoPrefijo,
            TmoAfectaSaldo, TmoGeneraDeuda,
            TmoAplicaRecurso, TmoRequiereDoc,
            TmoActivo, TmoOrden } = req.body;

    const pool = await getPool();
    const existe = await pool.request()
      .input('TmoId', sql.VarChar(30), TmoId)
      .query(`SELECT TmoId FROM dbo.TiposMovimiento WHERE TmoId = @TmoId`);
    if (!existe.recordset.length)
      return res.status(404).json({ success: false, error: `Tipo '${TmoId}' no encontrado.` });

    await pool.request()
      .input('TmoId',            sql.VarChar(30),  TmoId)
      .input('TmoNombre',        sql.NVarChar(100), TmoNombre        ?? null)
      .input('TmoDescripcion',   sql.NVarChar(500), TmoDescripcion   ?? null)
      .input('TmoPrefijo',       sql.VarChar(5),    TmoPrefijo       ?? null)
      .input('TmoAfectaSaldo',   sql.SmallInt,      TmoAfectaSaldo   != null ? parseInt(TmoAfectaSaldo) : null)
      .input('TmoGeneraDeuda',   sql.Bit,           TmoGeneraDeuda   ?? null)
      .input('TmoAplicaRecurso', sql.Bit,           TmoAplicaRecurso ?? null)
      .input('TmoRequiereDoc',   sql.Bit,           TmoRequiereDoc   ?? null)
      .input('TmoActivo',        sql.Bit,           TmoActivo        ?? null)
      .input('TmoOrden',         sql.Int,           TmoOrden         ?? null)
      .query(`
        UPDATE dbo.TiposMovimiento SET
          TmoNombre        = ISNULL(@TmoNombre,        TmoNombre),
          TmoDescripcion   = ISNULL(@TmoDescripcion,   TmoDescripcion),
          TmoPrefijo       = ISNULL(@TmoPrefijo,       TmoPrefijo),
          TmoAfectaSaldo   = ISNULL(@TmoAfectaSaldo,   TmoAfectaSaldo),
          TmoGeneraDeuda   = ISNULL(@TmoGeneraDeuda,   TmoGeneraDeuda),
          TmoAplicaRecurso = ISNULL(@TmoAplicaRecurso, TmoAplicaRecurso),
          TmoRequiereDoc   = ISNULL(@TmoRequiereDoc,   TmoRequiereDoc),
          TmoActivo        = ISNULL(@TmoActivo,        TmoActivo),
          TmoOrden         = ISNULL(@TmoOrden,         TmoOrden)
        WHERE TmoId = @TmoId
      `);

    logger.info(`[CONTABILIDAD] TipoMovimiento '${TmoId}' actualizado.`);
    res.json({ success: true, message: `Tipo '${TmoId}' actualizado correctamente.` });
  } catch (err) {
    logger.error('[CONTABILIDAD] updateTipoMovimiento:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/tipos-movimiento
 */
exports.createTipoMovimiento = async (req, res) => {
  try {
    const { TmoId, TmoNombre, TmoDescripcion, TmoPrefijo, TmoAfectaSaldo, TmoGeneraDeuda, TmoAplicaRecurso, TmoRequiereDoc, TmoActivo, TmoOrden } = req.body;
    if (!TmoId || !TmoNombre) return res.status(400).json({ success: false, error: "TmoId y TmoNombre son obligatorios." });
    
    const pool = await getPool();
    const existe = await pool.request().input('Id', sql.VarChar(30), TmoId).query(`SELECT TmoId FROM dbo.TiposMovimiento WHERE TmoId = @Id`);
    if (existe.recordset.length > 0) return res.status(400).json({ success: false, error: "El TmoId (ID) ya existe." });

    await pool.request()
      .input('TmoId',            sql.VarChar(30),  TmoId)
      .input('TmoNombre',        sql.NVarChar(100), TmoNombre)
      .input('TmoDescripcion',   sql.NVarChar(500), TmoDescripcion || null)
      .input('TmoPrefijo',       sql.VarChar(5),    TmoPrefijo     || null)
      .input('TmoAfectaSaldo',   sql.SmallInt,      TmoAfectaSaldo ?? 0)
      .input('TmoGeneraDeuda',   sql.Bit,           TmoGeneraDeuda ?? 0)
      .input('TmoAplicaRecurso', sql.Bit,           TmoAplicaRecurso ?? 0)
      .input('TmoRequiereDoc',   sql.Bit,           TmoRequiereDoc ?? 0)
      .input('TmoActivo',        sql.Bit,           TmoActivo ?? 1)
      .input('TmoOrden',         sql.Int,           TmoOrden ?? 100)
      .query(`
        INSERT INTO dbo.TiposMovimiento (TmoId, TmoNombre, TmoDescripcion, TmoPrefijo, TmoAfectaSaldo, TmoGeneraDeuda, TmoAplicaRecurso, TmoRequiereDoc, TmoActivo, TmoOrden)
        VALUES (@TmoId, @TmoNombre, @TmoDescripcion, @TmoPrefijo, @TmoAfectaSaldo, @TmoGeneraDeuda, @TmoAplicaRecurso, @TmoRequiereDoc, @TmoActivo, @TmoOrden)
      `);
    res.json({ success: true, message: "Tipo de movimiento creado." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * DELETE /api/contabilidad/tipos-movimiento/:TmoId
 */
exports.deleteTipoMovimiento = async (req, res) => {
  try {
    const { TmoId } = req.params;
    const pool = await getPool();
    await pool.request()
      .input('TmoId', sql.VarChar(30), TmoId)
      .query(`DELETE FROM dbo.TiposMovimiento WHERE TmoId = @TmoId`);
    res.json({ success: true, message: "Tipo de movimiento eliminado." });
  } catch (err) {
    if (err.number === 547) return res.status(400).json({ success: false, error: "No se puede eliminar porque está en uso (tiene registros asociados)." });
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/movimientos/:MovIdMovimiento/anular-orden
 * Cancela una orden no facturada: la marca como anulada, revierte el saldo
 * de la cuenta y actualiza los totales del ciclo si corresponde.
 */
exports.anularOrdenPendiente = async (req, res) => {
  try {
    const pool = await getPool();
    const movId = parseInt(req.params.MovIdMovimiento);
    const UsuarioAlta = req.user?.id || 1;

    // 1. Verificar que el movimiento existe, es ORDEN, no está facturado y no está ya anulado
    const movRes = await pool.request()
      .input('MovId', sql.Int, movId)
      .query(`
        SELECT m.*, cc.CueSaldoActual, cc.MonIdMoneda
        FROM dbo.MovimientosCuenta m
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
        WHERE m.MovIdMovimiento = @MovId
      `);
    if (!movRes.recordset.length)
      return res.status(404).json({ success: false, error: 'Movimiento no encontrado.' });

    const mov = movRes.recordset[0];
    if (!['ORDEN', 'ORDEN_ANTICIPO', 'ENTREGA'].includes(mov.MovTipo))
      return res.status(400).json({ success: false, error: 'Solo se pueden cancelar movimientos de tipo ORDEN.' });
    if (mov.DocIdDocumento)
      return res.status(400).json({ success: false, error: 'Esta orden ya fue facturada. No se puede cancelar.' });
    if (mov.MovAnulado)
      return res.status(400).json({ success: false, error: 'Esta orden ya está cancelada.' });

    // 2. Marcar como anulada
    await pool.request()
      .input('MovId', sql.Int, movId)
      .query(`UPDATE dbo.MovimientosCuenta SET MovAnulado = 1 WHERE MovIdMovimiento = @MovId`);

    // 3. Revertir el saldo de la cuenta (la orden era negativa, sumamos el absoluto)
    const revertir = Math.abs(Number(mov.MovImporte));
    await pool.request()
      .input('Cue', sql.Int, mov.CueIdCuenta)
      .input('Imp', sql.Decimal(18, 4), revertir)
      .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Imp WHERE CueIdCuenta = @Cue`);

    // 4. Registrar movimiento de ajuste compensatorio
    const saldoRes = await pool.request()
      .input('Cue', sql.Int, mov.CueIdCuenta)
      .query(`SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue`);
    const nuevoSaldo = saldoRes.recordset[0].CueSaldoActual;

    await pool.request()
      .input('Cue', sql.Int, mov.CueIdCuenta)
      .input('Imp', sql.Decimal(18, 4), revertir)
      .input('SP', sql.Decimal(18, 4), nuevoSaldo)
      .input('Usr', sql.Int, UsuarioAlta)
      .input('Concepto', sql.NVarChar(300), `Cancelación orden: ${mov.MovConcepto || ''}`)
      .input('MovIdAnula', sql.Int, movId)
      .input('OrdIdOrden', sql.Int, mov.OrdIdOrden || null)
      .query(`
        INSERT INTO dbo.MovimientosCuenta(CueIdCuenta, MovTipo, MovImporte, MovConcepto, MovSaldoPosterior, MovFecha, MovUsuarioAlta, MovIdAnula, OrdIdOrden, MovAnulado)
        VALUES (@Cue, 'AJUSTE', @Imp, @Concepto, @SP, GETDATE(), @Usr, @MovIdAnula, @OrdIdOrden, 0)
      `);

    // 5. Anular DeudaDocumento asociada si existe
    if (mov.OrdIdOrden) {
      await pool.request()
        .input('OrdId', sql.Int, mov.OrdIdOrden)
        .input('Cue', sql.Int, mov.CueIdCuenta)
        .query(`
          UPDATE dbo.DeudaDocumento
          SET DDeEstado = 'CANCELADO', DDeImportePendiente = 0
          WHERE OrdIdOrden = @OrdId AND CueIdCuenta = @Cue AND DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')
        `);
    }

    // 6. Recalcular totales del ciclo si la orden pertenecía a uno
    if (mov.CicIdCiclo) {
      await pool.request()
        .input('CicId', sql.Int, mov.CicIdCiclo)
        .query(`
          UPDATE c SET
            c.CicTotalOrdenes = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta WHERE CicIdCiclo=c.CicIdCiclo AND MovTipo IN ('ORDEN','ENTREGA','ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado=0)), 0),
            c.CicTotalPagos   = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta WHERE CicIdCiclo=c.CicIdCiclo AND MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO','COBRO','SALDO_A_FAVOR') AND (MovAnulado IS NULL OR MovAnulado=0)), 0)
          FROM dbo.CiclosCredito c WHERE c.CicIdCiclo = @CicId
        `);
    }

    logger.info(`[ANULAR-ORDEN] Mov #${movId} (${mov.MovConcepto}) CANCELADO. Saldo revertido: +${revertir}`);
    res.json({ success: true, message: `Orden cancelada correctamente. Saldo revertido.` });
  } catch (err) {
    logger.error('[ANULAR-ORDEN]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/contabilidad/clientes/:CliIdCliente/ordenes-anticipo
 */
exports.getOrdenesAnticipo = async (req, res) => {
  try {
    const { CliIdCliente } = req.params;
    const pool = await getPool();

      const result = await pool.request()
      .input('Cli', sql.Int, CliIdCliente)
      .query(`
        SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovConcepto, m.MovImporte, m.MovFecha,
               m.OrdIdOrden, m.OReIdOrdenRetiro, m.PagIdPago, m.MovObservaciones, m.DocIdDocumento,
               COALESCE(od.OrdCodigoOrden, erp.CodigoOrden) AS OrdCodigoOrden,
               COALESCE(od.OrdNombreTrabajo, erp.DescripcionTrabajo) AS OrdNombreTrabajo,
               ISNULL(od.OrdCantidad, 1) AS OrdCantidad,
               ISNULL(od.OrdDescuentoAplicado, 0) AS OrdDescuentoAplicado,
               od.OrdMaterialPlanilla,
               p.Descripcion AS ProNombre,
               s.Articulo AS ProSubFamilia,
               s.CodStock AS ProCodStock,
                (
                   SELECT d.ID AS DetalleID, a.CodArticulo, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.LogPrecioAplicado, a.Descripcion, pc.Moneda, a.CodStock, sa.Articulo AS ArticuloNombre
                   FROM dbo.PedidosCobranza pc WITH(NOLOCK)
                   JOIN dbo.PedidosCobranzaDetalle d WITH(NOLOCK) ON pc.ID = d.PedidoCobranzaID
                   LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = d.ProIdProducto
                   LEFT JOIN dbo.StockArt sa WITH(NOLOCK) ON a.CodStock = sa.CodStock
                   WHERE LTRIM(RTRIM(pc.NoDocERP)) = COALESCE(od.OrdCodigoOrden, erp.CodigoOrden)
                   FOR JSON PATH
                ) AS DetallesJSON
        FROM dbo.MovimientosCuenta m WITH(NOLOCK)
        LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON m.OrdIdOrden = od.OrdIdOrden
        LEFT JOIN dbo.Ordenes erp WITH(NOLOCK) ON erp.OrdenID = m.OrdIdOrden
        LEFT JOIN dbo.Articulos p WITH(NOLOCK) ON od.ProIdProducto = p.ProIdProducto
        LEFT JOIN dbo.StockArt s WITH(NOLOCK) ON p.CodStock = s.CodStock
        WHERE m.CueIdCuenta IN (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli)
          AND m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
          AND m.DocIdDocumento IS NULL
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('Error getOrdenesAnticipo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/contabilidad/clientes/:CliIdCliente/emitir-factura-anticipo
 */
exports.emitirFacturaAnticipo = async (req, res) => {
  try {
    const { CliIdCliente } = req.params;
    const UsuarioAlta = req.user?.id || 1;
    const pool = await getPool();

    const { 
      ordenesIds, 
      monedaFactura, cotDolar, descuentoTipo, descuentoValorBase, montoDescuentoCalculado,
      detallesEditados, detallesParaPDF, tipoDocumento, observaciones,
      cliDgiNombre, cliDgiDocumento, cliDgiDireccion, cliDgiCiudad, actualizarCliente 
    } = req.body;

    if (!ordenesIds || !ordenesIds.length) {
      return res.status(400).json({ success: false, error: "No se seleccionaron órdenes." });
    }

    const targetCueTipo = (monedaFactura === 'USD') ? 'DINERO_USD' : 'DINERO_UYU';
    const cueRes = await pool.request()
      .input('Cli', sql.Int, CliIdCliente)
      .input('Tipo', sql.VarChar, targetCueTipo)
      .query(`SELECT TOP 1 CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = @Tipo`);
    if (!cueRes.recordset.length) throw new Error(`Cliente no tiene cuenta en ${monedaFactura === 'USD' ? 'USD' : 'UYU'}`);
    const CueIdCuenta = cueRes.recordset[0].CueIdCuenta;

    let cicRes = await pool.request()
      .input('Cue', sql.Int, CueIdCuenta)
      .query(`SELECT TOP 1 CicIdCiclo FROM dbo.CiclosCredito WHERE CueIdCuenta = @Cue AND CicEstado = 'ABIERTO'`);
    
    let CicIdCiclo;
    const svc = require('../services/contabilidadService');
    if (cicRes.recordset.length) {
      CicIdCiclo = cicRes.recordset[0].CicIdCiclo;
    } else {
      const nuevoCiclo = await svc.abrirCicloPorCuenta({ CueIdCuenta, CliIdCliente, UsuarioAlta });
      CicIdCiclo = nuevoCiclo.CicIdCiclo;
    }

    const inClause = ordenesIds.map(id => parseInt(id, 10)).join(',');
    await pool.request()
      .input('Cic', sql.Int, CicIdCiclo)
      .query(`
        UPDATE dbo.MovimientosCuenta
        SET CicIdCiclo = @Cic
        WHERE OrdIdOrden IN (${inClause})
          AND MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
          AND DocIdDocumento IS NULL
      `);

    const saldo = await pool.request().input('Cic', sql.Int, CicIdCiclo).query(`
      SELECT ISNULL(SUM(ABS(MovImporte)), 0) as Tot
      FROM dbo.MovimientosCuenta WHERE CicIdCiclo = @Cic AND MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado = 0)
    `);
    const totOrd = saldo.recordset[0].Tot;

    await pool.request().input('Cic', sql.Int, CicIdCiclo).input('Tot', sql.Decimal(18,2), totOrd).query(`
      UPDATE dbo.CiclosCredito SET CicTotalOrdenes = @Tot WHERE CicIdCiclo = @Cic
    `);

    const result = await svc.cerrarCicloCompleto({ 
      CicIdCiclo, 
      UsuarioAlta,
      monedaFactura, cotDolar, descuentoTipo, descuentoValorBase, montoDescuentoCalculado,
      detallesEditados, detallesParaPDF, tipoDocumento, observaciones,
      cliDgiNombre, cliDgiDocumento, cliDgiDireccion, cliDgiCiudad, actualizarCliente
    });
    
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Error emitirFacturaAnticipo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SECCIÓN: CONSUMIR RECURSO ADELANTADO
// ============================================================

/**
 * POST /api/contabilidad/movimientos/:MovIdMovimiento/consumir-recurso-adelantado
 *
 * Aplica retroactivamente un plan de recursos para cancelar una deuda monetaria
 * pendiente generada antes de que el cliente comprara el plan.
 *
 * Escenario A - Cliente común o ciclo ya cerrado:
 *   Existe DeudaDocumento → se cancela/reduce + crédito en cuenta monetaria.
 *
 * Escenario B - Cliente semanal con ciclo ABIERTO:
 *   No hay DeudaDocumento aún → se inserta crédito COBERTURA_RETROACTIVA
 *   dentro del ciclo para que el cierre semanal lo descuente naturalmente.
 */
exports.consumirRecursoAdelantado = async (req, res) => {
  const pool = await getPool();
  let transaction = null;

  try {
    const movId       = parseInt(req.params.MovIdMovimiento);
    const UsuarioAlta = req.user?.id || 1;

    if (!movId) return res.status(400).json({ success: false, error: 'MovIdMovimiento requerido.' });

    // 1. Cargar el movimiento original
    const movRes = await pool.request()
      .input('MovId', sql.Int, movId)
      .query(`
        SELECT
          m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte,
          m.MovConcepto, m.MovFecha, m.OrdIdOrden, m.CicIdCiclo,
          m.DocIdDocumento, m.MovAnulado,
          cc.CliIdCliente, cc.MonIdMoneda, cc.CueTipo,
          cc.CueSaldoActual, cc.CueDiasCiclo,
          COALESCE(od.OrdCodigoOrden, erp.CodigoOrden) AS OrdCodigoOrden,
          COALESCE(od.OrdNombreTrabajo, erp.DescripcionTrabajo) AS OrdNombreTrabajo,
          COALESCE(od.OrdCantidad, TRY_CAST(erp.Magnitud AS FLOAT), 1.0) AS OrdCantidad,
          COALESCE(od.ProIdProducto, erp.ProIdProducto) AS ProIdProducto,
          art.Descripcion AS NombreProducto
        FROM dbo.MovimientosCuenta m WITH(NOLOCK)
        JOIN  dbo.CuentasCliente   cc  WITH(NOLOCK) ON cc.CueIdCuenta  = m.CueIdCuenta
        LEFT JOIN dbo.OrdenesDeposito od  WITH(NOLOCK) ON od.OrdIdOrden = m.OrdIdOrden
        LEFT JOIN dbo.Ordenes         erp WITH(NOLOCK) ON erp.OrdenID   = m.OrdIdOrden
        LEFT JOIN dbo.Articulos       art WITH(NOLOCK) ON art.ProIdProducto = COALESCE(od.ProIdProducto, erp.ProIdProducto)
        WHERE m.MovIdMovimiento = @MovId
      `);

    if (!movRes.recordset.length)
      return res.status(404).json({ success: false, error: 'Movimiento no encontrado.' });

    const mov = movRes.recordset[0];

    if (!['ORDEN', 'ORDEN_ANTICIPO'].includes(mov.MovTipo))
      return res.status(400).json({ success: false, error: 'Solo aplicable sobre movimientos tipo ORDEN.' });
    if (mov.MovAnulado)
      return res.status(400).json({ success: false, error: 'Este movimiento ya está anulado.' });
    if (mov.DocIdDocumento)
      return res.status(400).json({ success: false, error: 'La orden ya fue facturada. No se puede aplicar recurso retroactivo.' });
    if (!mov.ProIdProducto)
      return res.status(400).json({ success: false, error: 'La orden no tiene producto asociado. No se puede aplicar recurso.' });

    // Evitar duplicados de cobertura retroactiva
    const cruzRes = await pool.request()
      .input('MovId', sql.Int, movId)
      .query(`SELECT TOP 1 MovIdMovimiento FROM dbo.MovimientosCuenta WHERE MovIdAnula = @MovId AND MovTipo = 'COBERTURA_RETROACTIVA'`);
    if (cruzRes.recordset.length)
      return res.status(400).json({ success: false, error: 'Esta orden ya tiene cobertura retroactiva aplicada.' });

    const importeOrden     = Math.abs(Number(mov.MovImporte));
    const cantidadMetros   = Number(mov.OrdCantidad) || 0;
    const ProIdProducto    = mov.ProIdProducto;
    const CliIdCliente     = mov.CliIdCliente;
    const CodigoOrden      = mov.OrdCodigoOrden || ('ORD-' + mov.OrdIdOrden);
    const esClienteSemanal = (mov.CueDiasCiclo || 0) > 0;

    if (cantidadMetros <= 0)
      return res.status(400).json({ success: false, error: 'La orden no tiene cantidad de metros (OrdCantidad = 0).' });

    // 2. Detectar escenario: DeudaDocumento vs Ciclo Abierto
    const deudaRes = await pool.request()
      .input('OrdId', sql.Int, mov.OrdIdOrden)
      .input('CueId', sql.Int, mov.CueIdCuenta)
      .query(`
        SELECT TOP 1 DDeIdDocumento, DDeImportePendiente, DDeEstado
        FROM dbo.DeudaDocumento WITH(NOLOCK)
        WHERE OrdIdOrden  = @OrdId
          AND CueIdCuenta = @CueId
          AND DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL')
      `);
    const deudaDoc     = deudaRes.recordset[0] || null;
    const importeDeuda = deudaDoc ? Number(deudaDoc.DDeImportePendiente) : importeOrden;

    let cicloAbierto = null;
    if (!deudaDoc && mov.CicIdCiclo) {
      const cicloRes = await pool.request()
        .input('CicId', sql.Int, mov.CicIdCiclo)
        .query(`SELECT CicIdCiclo, CicEstado, CicTotalOrdenes, CicTotalPagos FROM dbo.CiclosCredito WITH(NOLOCK) WHERE CicIdCiclo = @CicId`);
      const c = cicloRes.recordset[0];
      if (c && c.CicEstado === 'ABIERTO') cicloAbierto = c;
    }

    if (!deudaDoc && !cicloAbierto) {
      return res.status(400).json({ success: false, error: 'No hay deuda pendiente ni ciclo abierto para esta orden.' });
    }

    // 3. Buscar plan activo (preview sin TX)
    const planPreviewRes = await pool.request()
      .input('CliId', sql.Int, CliIdCliente)
      .input('ProId', sql.Int, ProIdProducto)
      .query(`
        SELECT TOP 1
          pm.PlaIdPlan,
          pm.CueIdCuenta  AS CueMTS,
          pm.PlaCantidadTotal,
          pm.PlaCantidadUsada,
          pm.PlaCantidadTotal - pm.PlaCantidadUsada AS SaldoDisponible,
          art.Descripcion AS NombreArticulo
        FROM dbo.PlanesMetros pm WITH(NOLOCK)
        LEFT JOIN dbo.Articulos art WITH(NOLOCK) ON art.ProIdProducto = pm.ProIdProducto
        WHERE pm.CliIdCliente = @CliId
          AND pm.PlaActivo    = 1
          AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
          AND (
            pm.ProIdProducto = @ProId
            OR EXISTS (
              SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
              WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = @ProId
            )
          )
        ORDER BY pm.PlaFechaAlta ASC
      `);

    if (!planPreviewRes.recordset.length)
      return res.status(422).json({
        success: false,
        error: 'Sin plan activo para el producto de la orden. Compre metros primero.'
      });

    const plan      = planPreviewRes.recordset[0];
    const saldoDisp = Number(plan.SaldoDisponible);

    // ── REGLA: cobertura total o rechazo. Sin coberturas parciales. ──
    if (saldoDisp <= 0)
      return res.status(422).json({
        success: false,
        error: ('Plan #' + plan.PlaIdPlan + ' (' + (plan.NombreArticulo || 'sin nombre') + ') no tiene saldo disponible.')
      });

    if (saldoDisp < cantidadMetros)
      return res.status(422).json({
        success: false,
        error:
          'Saldo insuficiente en Plan #' + plan.PlaIdPlan +
          ' (' + (plan.NombreArticulo || 'sin nombre') + '). ' +
          'Disponible: ' + Number(saldoDisp).toFixed(2) + ' mts. ' +
          'Se necesitan: ' + Number(cantidadMetros).toFixed(2) + ' mts. ' +
          'Recargue el plan antes de aplicar.'
      });

    // Siempre cobertura total: metros = OrdCantidad, importe = deuda completa
    const importeACancelar = importeDeuda;

    // 4. Transacción atómica
    transaction = await pool.transaction();
    await transaction.begin();

    try {
      // 4a. UPDLOCK en el plan
      const planTxRes = await new sql.Request(transaction)
        .input('PlaId', sql.Int, plan.PlaIdPlan)
        .query(`
          SELECT PlaIdPlan, PlaCantidadTotal, PlaCantidadUsada,
                 PlaCantidadTotal - PlaCantidadUsada AS SaldoReal,
                 CueIdCuenta AS CueMTS
          FROM dbo.PlanesMetros WITH(UPDLOCK, ROWLOCK)
          WHERE PlaIdPlan = @PlaId
        `);

      const planTx      = planTxRes.recordset[0];
      const saldoReal   = Number(planTx.SaldoReal);
      const CueMTS      = planTx.CueMTS;

      // Verificación de seguridad dentro de TX (condición de carrera)
      if (saldoReal < cantidadMetros)
        throw new Error(
          'El plan quedó sin saldo suficiente (condición de carrera). ' +
          'Disponible: ' + saldoReal.toFixed(2) + ' mts. Reintente.'
        );

      const metrosFinal = cantidadMetros; // siempre cobertura total

      // 4b. Actualizar plan
      const nuevaUsada  = Number(planTx.PlaCantidadUsada) + metrosFinal;
      const nuevoActivo = nuevaUsada >= Number(planTx.PlaCantidadTotal) ? 0 : 1;

      await new sql.Request(transaction)
        .input('PlaId',  sql.Int,          planTx.PlaIdPlan)
        .input('Usada',  sql.Decimal(18,4), nuevaUsada)
        .input('Activo', sql.Bit,           nuevoActivo)
        .query('UPDATE dbo.PlanesMetros SET PlaCantidadUsada = @Usada, PlaActivo = @Activo WHERE PlaIdPlan = @PlaId');

      // 4c. Movimiento ENTREGA en cuenta MTS
      const smtsRes = await new sql.Request(transaction)
        .input('C', sql.Int, CueMTS)
        .query('SELECT CueSaldoActual FROM dbo.CuentasCliente WITH(UPDLOCK) WHERE CueIdCuenta = @C');

      const saldoMTSActual = Number(smtsRes.recordset[0].CueSaldoActual);
      const nuevoSaldoMTS  = Math.round((saldoMTSActual - metrosFinal) * 10000) / 10000;

      await new sql.Request(transaction)
        .input('C', sql.Int, CueMTS).input('S', sql.Decimal(18,4), nuevoSaldoMTS)
        .query('UPDATE dbo.CuentasCliente SET CueSaldoActual = @S WHERE CueIdCuenta = @C');

      await new sql.Request(transaction)
        .input('C',  sql.Int,           CueMTS)
        .input('Imp',sql.Decimal(18,4), -metrosFinal)
        .input('SP', sql.Decimal(18,4),  nuevoSaldoMTS)
        .input('Usr',sql.Int,            UsuarioAlta)
        .input('Con',sql.NVarChar(300),  'Cobertura retroactiva: ' + CodigoOrden)
        .input('Ord',sql.Int,            mov.OrdIdOrden || null)
        .input('Ref',sql.Int,            movId)
        .input('PlaIdPlan', sql.Int,     planTx.PlaIdPlan)
        .query(`
          INSERT INTO dbo.MovimientosCuenta
            (CueIdCuenta,MovTipo,MovImporte,MovConcepto,MovSaldoPosterior,
             MovFecha,MovUsuarioAlta,OrdIdOrden,MovObservaciones)
          VALUES (@C,'ENTREGA',@Imp,@Con,@SP,GETDATE(),@Usr,@Ord,
                  CONCAT('Cobertura retroactiva Ref#',@Ref, ' — Plan #',@PlaIdPlan))
        `);

      // 4d. Crédito COBERTURA_RETROACTIVA en cuenta monetaria
      //     Semanal: lleva CicIdCiclo para que el cierre del ciclo lo descuente.
      const smonRes = await new sql.Request(transaction)
        .input('C', sql.Int, mov.CueIdCuenta)
        .query('SELECT CueSaldoActual FROM dbo.CuentasCliente WITH(UPDLOCK) WHERE CueIdCuenta = @C');

      const saldoMonActual = Number(smonRes.recordset[0].CueSaldoActual);
      const nuevoSaldoMon  = Math.round((saldoMonActual + importeACancelar) * 100) / 100;

      await new sql.Request(transaction)
        .input('C', sql.Int, mov.CueIdCuenta).input('S', sql.Decimal(18,4), nuevoSaldoMon)
        .query('UPDATE dbo.CuentasCliente SET CueSaldoActual = @S WHERE CueIdCuenta = @C');

      const conceptoCob     = 'Cobertura retroactiva Plan #' + planTx.PlaIdPlan + ' \u2014 ' + CodigoOrden + (mov.OrdNombreTrabajo ? ' \u2014 ' + mov.OrdNombreTrabajo : '');
      const cicloIdInsertar = (esClienteSemanal && mov.CicIdCiclo) ? mov.CicIdCiclo : null;

      await new sql.Request(transaction)
        .input('C',   sql.Int,          mov.CueIdCuenta)
        .input('Imp', sql.Decimal(18,4), importeACancelar)
        .input('SP',  sql.Decimal(18,4), nuevoSaldoMon)
        .input('Usr', sql.Int,           UsuarioAlta)
        .input('Con', sql.NVarChar(300),  conceptoCob)
        .input('Ord', sql.Int,            mov.OrdIdOrden || null)
        .input('Mid', sql.Int,            movId)
        .input('Cic', sql.Int,            cicloIdInsertar)
        .query(`
          INSERT INTO dbo.MovimientosCuenta
            (CueIdCuenta,MovTipo,MovImporte,MovConcepto,MovSaldoPosterior,
             MovFecha,MovUsuarioAlta,OrdIdOrden,MovIdAnula,CicIdCiclo)
          VALUES (@C,'COBERTURA_RETROACTIVA',@Imp,@Con,@SP,GETDATE(),@Usr,@Ord,@Mid,@Cic)
        `);

      // 4e. Escenario A: cancelar DeudaDocumento completo (cobertura total garantizada)
      if (deudaDoc) {
        await new sql.Request(transaction)
          .input('Id', sql.Int, deudaDoc.DDeIdDocumento)
          .query("UPDATE dbo.DeudaDocumento SET DDeEstado='CANCELADO', DDeImportePendiente=0 WHERE DDeIdDocumento=@Id");
      }

      // 4f. Escenario B: actualizar acumulados del ciclo abierto (semanal)
      if (cicloAbierto) {
        await new sql.Request(transaction)
          .input('CicId', sql.Int,          cicloAbierto.CicIdCiclo)
          .input('Imp',   sql.Decimal(18,4), importeACancelar)
          .query(`
            UPDATE dbo.CiclosCredito
            SET CicTotalPagos    = CicTotalPagos + @Imp,
                CicSaldoFacturar = CicSaldoFacturar - @Imp
            WHERE CicIdCiclo = @CicId
          `);
      }

      await transaction.commit();

      logger.info(
        '[COBERTURA_RETROACTIVA] MovId=' + movId + ' Orden=' + CodigoOrden +
        ' Plan#' + planTx.PlaIdPlan + ' -> ' + metrosFinal + ' mts / $' + importeACancelar +
        ' | Escenario: ' + (deudaDoc ? 'DEUDA_DOC' : 'CICLO_ABIERTO') +
        ' | Cliente: ' + (esClienteSemanal ? 'SEMANAL' : 'COMUN')
      );

      return res.json({
        success:          true,
        metrosConsumidos: metrosFinal,
        importeCancelado: importeACancelar,
        deudaRestante:    0,
        planRestante:     Math.max(0, saldoReal - metrosFinal),
        esCoberturaTotal: true,
        escenario:        deudaDoc ? 'DEUDA_DOCUMENTO' : 'CICLO_ABIERTO',
        tipoCliente:      esClienteSemanal ? 'SEMANAL' : 'COMUN',
        mensaje:
          'Orden ' + CodigoOrden + ' cubierta por Plan #' + planTx.PlaIdPlan + ' \u2014 ' +
          metrosFinal + ' mts consumidos. Deuda cancelada completamente.'
      });

    } catch (txErr) {
      await transaction.rollback().catch(() => {});
      throw txErr;
    }

  } catch (err) {
    logger.error('[COBERTURA_RETROACTIVA] Error:', err.message, err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
