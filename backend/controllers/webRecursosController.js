'use strict';

/**
 * webRecursosController.js
 * ────────────────────────────────────────────────────────────────────────────
 * "Mis Recursos" del PORTAL DEL CLIENTE (solo lectura).
 *
 * El cliente logueado ve sus propios planes de metros (comprado / usado /
 * restante) igual que los ve la gestión en la pestaña Recursos del 360
 * (VendedorCliente360.jsx → GET /api/contabilidad/planes/:CliIdCliente).
 *
 * Seguridad: el cliente NUNCA elige a quién mirar — el CliIdCliente sale del
 * token del portal (req.user.codCliente, rol WEB_CLIENT), mismo criterio que
 * webRetirosController.getMyRetirosPendientes. El endpoint de movimientos
 * verifica además que la cuenta pedida pertenezca a ese cliente.
 */

const svc      = require('../services/contabilidadService');
const telaCtrl = require('./telaClienteController');
const logger   = require('../utils/logger');
const { getPool, sql } = require('../config/db');

// Resuelve el CliIdCliente (CuentasCliente) del cliente logueado en el portal.
// Devuelve null si la sesión no es de un cliente web (p.ej. sesión interna).
async function resolverCliIdCliente(req) {
  if (req.user?.role !== 'WEB_CLIENT') return null;
  const codCliente = parseInt(req.user.codCliente || req.user.id, 10);
  if (!codCliente) return null;

  const pool = await getPool();
  const r = await pool.request()
    .input('Cod', sql.Int, codCliente)
    .query(`SELECT CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CodCliente = @Cod`);

  return r.recordset.length ? r.recordset[0].CliIdCliente : null;
}

/**
 * GET /api/web-recursos/mis-recursos
 * Planes de recursos del cliente logueado. Misma consulta que
 * contabilidadController.getPlanesCliente, con el cliente fijado por el token.
 */
exports.getMisRecursos = async (req, res) => {
  try {
    const CliIdCliente = await resolverCliIdCliente(req);
    if (CliIdCliente == null)
      return res.status(403).json({ success: false, error: 'Disponible solo para clientes del portal.' });

    const pool = await getPool();
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
          pm.PlaFechaInicio,
          pm.PlaFechaVencimiento,
          pm.PlaActivo,
          pm.PlaDescripcion,
          pm.PlaFechaAlta,
          CASE WHEN pm.PlaFechaVencimiento IS NOT NULL
               THEN DATEDIFF(DAY, CAST(GETDATE() AS DATE), pm.PlaFechaVencimiento)
               ELSE NULL END                         AS DiasParaVencer,
          cc.CueTipo
        FROM      dbo.PlanesMetros    pm WITH(NOLOCK)
        JOIN      dbo.CuentasCliente  cc   WITH(NOLOCK) ON cc.CueIdCuenta   = pm.CueIdCuenta
        LEFT JOIN dbo.Articulos       art  WITH(NOLOCK) ON art.ProIdProducto = pm.ProIdProducto
        LEFT JOIN dbo.Unidades        u    WITH(NOLOCK) ON u.UniIdUnidad     = art.UniIdUnidad
        WHERE cc.CliIdCliente = @CliIdCliente
        ORDER BY pm.PlaActivo DESC, pm.PlaFechaInicio DESC
      `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[WEB-RECURSOS] getMisRecursos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/web-recursos/mis-recursos/cuentas/:CueIdCuenta/movimientos?top=500
 * Estado de cuenta de un recurso ("Ver consumo"). Solo si la cuenta pertenece
 * al cliente logueado; después delega en el mismo servicio que usa la gestión.
 */
exports.getMovimientosMiRecurso = async (req, res) => {
  try {
    const CliIdCliente = await resolverCliIdCliente(req);
    if (CliIdCliente == null)
      return res.status(403).json({ success: false, error: 'Disponible solo para clientes del portal.' });

    const cueId = parseInt(req.params.CueIdCuenta, 10);
    if (!cueId)
      return res.status(400).json({ success: false, error: 'Cuenta inválida.' });

    // Candado de pertenencia: la cuenta pedida tiene que ser de ESTE cliente.
    const pool = await getPool();
    const duenio = await pool.request()
      .input('Cue', sql.Int, cueId)
      .query(`SELECT CliIdCliente FROM dbo.CuentasCliente WITH(NOLOCK) WHERE CueIdCuenta = @Cue`);

    if (!duenio.recordset.length || String(duenio.recordset[0].CliIdCliente) !== String(CliIdCliente))
      return res.status(403).json({ success: false, error: 'Esa cuenta no pertenece a tu usuario.' });

    const top = parseInt(req.query.top, 10) || 500;
    const { data, saldoArrastre } = await svc.getMovimientos(cueId, null, null, top);

    res.json({ success: true, data, saldoArrastre });
  } catch (err) {
    logger.error('[WEB-RECURSOS] getMovimientosMiRecurso:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// TELAS DEL CLIENTE (metros físicos del cliente en el depósito)
// Delegan en telaClienteController con el cliente fijado por el
// token: InventarioBobinas.ClienteID guarda el CliIdCliente
// numérico como texto (verificado: '376' = Emipal, 6 bobinas).
// ============================================================

/**
 * GET /api/web-recursos/mis-telas
 * Saldo de telas propias por tipo — misma consulta que la pestaña
 * "Telas del cliente" del 360 (GET /api/tela-cliente/:clienteId/saldo).
 */
exports.getMisTelas = async (req, res) => {
  try {
    const CliIdCliente = await resolverCliIdCliente(req);
    if (CliIdCliente == null)
      return res.status(403).json({ success: false, error: 'Disponible solo para clientes del portal.' });

    req.params.clienteId = String(CliIdCliente);
    return telaCtrl.getSaldo(req, res);
  } catch (err) {
    logger.error('[WEB-RECURSOS] getMisTelas:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/web-recursos/mis-telas/estado-cuenta?insumoId=N
 * Estado de cuenta de las telas ("Ver consumo", bulto por bulto) —
 * mismo endpoint que usa el 360, con el cliente fijado por el token.
 */
exports.getEstadoCuentaMisTelas = async (req, res) => {
  try {
    const CliIdCliente = await resolverCliIdCliente(req);
    if (CliIdCliente == null)
      return res.status(403).json({ success: false, error: 'Disponible solo para clientes del portal.' });

    req.params.clienteId = String(CliIdCliente);
    return telaCtrl.getEstadoCuenta(req, res);
  } catch (err) {
    logger.error('[WEB-RECURSOS] getEstadoCuentaMisTelas:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
