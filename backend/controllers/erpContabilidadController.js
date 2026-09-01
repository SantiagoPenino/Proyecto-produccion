'use strict';
/**
 * erpContabilidadController.js
 * ────────────────────────────────────────────────────────────────────────────
 * Controlador de las interfaces administrativas del Plan de Cuentas y Libro Mayor.
 */

const { getPool } = require('../config/db');
const logger = require('../utils/logger');

/** GET /api/contabilidad/erp/cuentas */
exports.getPlanCuentas = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CueId, CueCodigo, CueNombre, CueNivel, CueTipoBase, CueMoneda, CueImputable, CueActiva
      FROM dbo.Cont_PlanCuentas WITH(NOLOCK)
      ORDER BY CueCodigo
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD-ERP] getPlanCuentas:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/contabilidad/erp/cuentas/gastos */
exports.getCuentasGastos = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CueId, CueCodigo, CueNombre, CueMoneda
      FROM dbo.Cont_PlanCuentas WITH(NOLOCK)
      WHERE CueTipoBase = 'PERDIDA' AND CueImputable = 1 AND CueActiva = 1
      ORDER BY CueNombre
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD-ERP] getCuentasGastos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/** ─────────────────────────────────────────────────────────────────────────
 *  LIBRO DIARIO / MAYOR — listado paginado
 *  GET /api/contabilidad/erp/libro-mayor
 *      ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&origen=MOTOR&q=texto&page=1&pageSize=50
 *
 *  Devuelve SOLO las cabeceras de la página pedida, con sus totales Debe/Haber
 *  ya sumados. Las líneas del asiento se piden aparte al expandirlo
 *  (getLibroMayorLineas), porque la tarjeta colapsada no las usa: mandarlas
 *  todas era lo que hacía un JSON de ~10 MB y colgaba el navegador.
 *  ──────────────────────────────────────────────────────────────────────── */
exports.getLibroMayor = async (req, res) => {
  try {
    const { desde, hasta, origen, q } = req.query;

    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const offset   = (page - 1) * pageSize;

    const pool = await getPool();
    const request = pool.request();

    // Los filtros se arman sobre la CABECERA para que el paginado pueda usar
    // el índice IX_ContAsiCab_Fecha (AsiFecha DESC, AsiId DESC).
    // OJO: nada de CAST(cab.AsiFecha AS DATE) — eso anula el índice. El CONVERT
    // va del lado del parámetro, que sí es sargable.
    let where = '';
    if (desde)  { request.input('Desde',  desde);  where += ' AND cab.AsiFecha >= CONVERT(DATE, @Desde, 23)'; }
    if (hasta)  { request.input('Hasta',  hasta);  where += ' AND cab.AsiFecha < DATEADD(DAY, 1, CONVERT(DATE, @Hasta, 23))'; }
    if (origen) { request.input('Origen', origen); where += ' AND cab.SysOrigen = @Origen'; }

    // Búsqueda libre: N° de asiento, N° de OP, concepto o cuenta contable.
    // Las cuentas que matchean se resuelven ANTES, contra el plan de cuentas
    // (tabla de ~100 filas), y quedan como una lista de CueId. Así el EXISTS
    // sobre el detalle es un seek por AsiId y no arrastra un JOIN al plan de
    // cuentas por cada asiento; y si el término no es ninguna cuenta —el caso
    // típico: un N° de asiento, un N° de OP, un PC— el EXISTS ni se agrega.
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      request.input('Q', like);

      const cuentas = await pool.request()
        .input('Q', like)
        .query(`
          SELECT CueId FROM dbo.Cont_PlanCuentas WITH(NOLOCK)
          WHERE CueNombre LIKE @Q OR CueCodigo LIKE @Q
        `);
      const cueIds = cuentas.recordset.map(r => Number(r.CueId)).filter(Number.isInteger);

      where += `
        AND (
              CAST(cab.AsiId AS VARCHAR(20)) LIKE @Q
           OR CAST(ISNULL(cab.TcaIdTransaccion, 0) AS VARCHAR(20)) LIKE @Q
           OR cab.AsiConcepto LIKE @Q
           ${cueIds.length ? `OR EXISTS (
                SELECT 1 FROM dbo.Cont_AsientosDetalle d WITH(NOLOCK)
                WHERE d.AsiId = cab.AsiId AND d.CueId IN (${cueIds.join(',')})
              )` : ''}
        )`;
    }

    request.input('Offset',   offset);
    request.input('PageSize', pageSize);

    const result = await request.query(`
      -- 1) Página de asientos (cabecera + totales del asiento)
      ;WITH pg AS (
        SELECT cab.AsiId
        FROM dbo.Cont_AsientosCabecera cab WITH(NOLOCK)
        WHERE 1=1 ${where}
        ORDER BY cab.AsiFecha DESC, cab.AsiId DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
      )
      SELECT
        cab.AsiId, cab.AsiFecha, cab.AsiConcepto, cab.TcaIdTransaccion,
        cab.SysOrigen AS AsiOrigen,
        ISNULL(t.TotalDebe,  0) AS TotalDebe,
        ISNULL(t.TotalHaber, 0) AS TotalHaber,
        ISNULL(t.Lineas,     0) AS Lineas
      FROM pg
      JOIN dbo.Cont_AsientosCabecera cab WITH(NOLOCK) ON cab.AsiId = pg.AsiId
      OUTER APPLY (
        SELECT SUM(det.DetDebeUYU) AS TotalDebe, SUM(det.DetHaberUYU) AS TotalHaber, COUNT(*) AS Lineas
        FROM dbo.Cont_AsientosDetalle det WITH(NOLOCK)
        WHERE det.AsiId = cab.AsiId
      ) t
      ORDER BY cab.AsiFecha DESC, cab.AsiId DESC;

      -- 2) Totales de TODO el filtro (no sólo de la página), para el encabezado.
      --    Un JOIN + agregado, no un subselect por asiento.
      SELECT
        (SELECT COUNT(*) FROM dbo.Cont_AsientosCabecera cab WITH(NOLOCK) WHERE 1=1 ${where}) AS Total,
        ISNULL(SUM(det.DetDebeUYU),  0) AS TotalDebeFiltro,
        ISNULL(SUM(det.DetHaberUYU), 0) AS TotalHaberFiltro
      FROM dbo.Cont_AsientosCabecera cab WITH(NOLOCK)
      JOIN dbo.Cont_AsientosDetalle det WITH(NOLOCK) ON det.AsiId = cab.AsiId
      WHERE 1=1 ${where};
    `);

    const asientos = result.recordsets[0] || [];
    const tot      = (result.recordsets[1] || [])[0] || { Total: 0, TotalDebeFiltro: 0, TotalHaberFiltro: 0 };

    res.json({
      success: true,
      data: asientos,
      page,
      pageSize,
      total: tot.Total,
      totalDebeFiltro:  tot.TotalDebeFiltro,
      totalHaberFiltro: tot.TotalHaberFiltro,
      hayMas: offset + asientos.length < tot.Total
    });
  } catch (err) {
    logger.error('[CONTABILIDAD-ERP] getLibroMayor:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/contabilidad/erp/libro-mayor/:asiId/lineas
 *  Detalle de UN asiento. Se pide recién cuando el usuario lo expande. */
exports.getLibroMayorLineas = async (req, res) => {
  try {
    const { asiId } = req.params;
    const pool = await getPool();
    const result = await pool.request()
      .input('AsiId', asiId)
      .query(`
        SELECT
          det.DetId, det.DetDebeUYU AS DebeUYU, det.DetHaberUYU AS HaberUYU,
          det.DetImporteOriginal AS ImporteOriginal, det.DetMonedaId AS MonedaId,
          det.DetCotizacion AS Cotizacion,
          cue.CueCodigo, cue.CueNombre
        FROM dbo.Cont_AsientosDetalle det WITH(NOLOCK)
        JOIN dbo.Cont_PlanCuentas cue WITH(NOLOCK) ON cue.CueId = det.CueId
        WHERE det.AsiId = @AsiId
        ORDER BY det.DetId ASC
      `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD-ERP] getLibroMayorLineas:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/contabilidad/erp/libro-mayor/origenes
 *  Valores del combo "Origen". Antes salían de recorrer todos los asientos
 *  cargados en el navegador, que era parte de por qué había que traerlos todos. */
exports.getLibroMayorOrigenes = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT SysOrigen AS Origen, COUNT(*) AS Asientos
      FROM dbo.Cont_AsientosCabecera WITH(NOLOCK)
      WHERE SysOrigen IS NOT NULL
      GROUP BY SysOrigen
      ORDER BY COUNT(*) DESC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[CONTABILIDAD-ERP] getLibroMayorOrigenes:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};


/** POST /api/contabilidad/erp/cuentas */
exports.crearCuenta = async (req, res) => {
  try {
    const { codigo, nombre, nivel, tipoBase, moneda, imputable } = req.body;
    const pool = await getPool();
    await pool.request()
      .input('codigo', `${codigo}`)
      .input('nombre', nombre)
      .input('nivel', nivel)
      .input('tipoBase', tipoBase)
      .input('moneda', moneda || 'AMBAS')
      .input('imputable', imputable ? 1 : 0)
      .query(`
        INSERT INTO dbo.Cont_PlanCuentas (CueCodigo, CueNombre, CueNivel, CueTipoBase, CueMoneda, CueImputable, CueActiva)
        VALUES (@codigo, @nombre, @nivel, @tipoBase, @moneda, @imputable, 1)
      `);
    res.json({ success: true, message: 'Cuenta contable creada' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** PUT /api/contabilidad/erp/cuentas/:id */
exports.actualizarCuenta = async (req, res) => {
  try {
    const { id } = req.params;
    const { codigo, nombre, nivel, tipoBase, moneda, imputable, activa } = req.body;
    const isImputable = imputable ? 1 : 0;

    const pool = await getPool();

    // Validar si intenta hacerla NO imputable, que no tenga asientos
    if (isImputable === 0) {
      const checkRes = await pool.request()
        .input('id', id)
        .query(`SELECT TOP 1 1 FROM dbo.Cont_AsientosDetalle WHERE CueId = @id`);
      
      if (checkRes.recordset.length > 0) {
        return res.status(400).json({ success: false, error: 'No se puede desmarcar como Imputable porque esta cuenta ya tiene asientos contables registrados.' });
      }
    }

    await pool.request()
      .input('id', id)
      .input('codigo', `${codigo}`)
      .input('nombre', nombre)
      .input('nivel', nivel)
      .input('tipoBase', tipoBase)
      .input('moneda', moneda || 'AMBAS')
      .input('imputable', isImputable)
      .input('activa', activa ? 1 : 0)
      .query(`
        UPDATE dbo.Cont_PlanCuentas
        SET CueCodigo=@codigo, CueNombre=@nombre, CueNivel=@nivel, CueTipoBase=@tipoBase,
            CueMoneda=@moneda, CueImputable=@imputable, CueActiva=@activa
        WHERE CueId=@id
      `);
    res.json({ success: true, message: 'Cuenta actualizada' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
