/**
 * vendedorVistaController.js
 *
 * Endpoints SOLO LECTURA para la Vista 360 del Vendedor
 * (frontend: src/components/pages/VendedorCliente360.jsx).
 *
 * La vista reutiliza los endpoints que ya existen para todo lo demás:
 *   - Recursos            → GET /api/contabilidad/planes/:CliIdCliente
 *                           GET /api/contabilidad/cuentas/:CliIdCliente
 *   - Telas del cliente   → GET /api/tela-cliente/:CliIdCliente/saldo
 *   - Precios especiales  → GET /api/special-prices/:CliIdCliente  +  GET /api/prices/base
 *
 * Lo que agrega este controlador (y no existía) es:
 *   - "pendiente de retirar en depósito" por cliente
 *   - la cartera de cada vendedor (Clientes.VendedorID)
 * NO escribe nada en la base.
 */

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Estados de OrdenesDeposito que YA NO están físicamente esperando retiro:
//   9 = Entregado · 10 = Cancelado · 11 = Perdida
const ESTADOS_FUERA_DEPOSITO = [9, 10, 11];

/**
 * GET /api/vendedor-360/clientes/:CliIdCliente/deposito-pendiente
 * Órdenes del cliente que siguen en el depósito (pendientes de retirar).
 */
exports.getDepositoPendiente = async (req, res) => {
  try {
    const { CliIdCliente } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input('CliIdCliente', sql.Int, parseInt(CliIdCliente))
      .query(`
        SELECT
          od.OrdIdOrden,
          LTRIM(RTRIM(od.OrdCodigoOrden))      AS OrdCodigoOrden,
          LTRIM(RTRIM(od.OrdNombreTrabajo))    AS OrdNombreTrabajo,
          od.OrdEstadoActual,
          eo.EOrNombreEstado,
          od.OrdFechaIngresoOrden,
          od.OrdFechaEstadoActual,
          od.OrdCantidad,
          od.OrdCostoFinal,
          ISNULL(mon.MonSimbolo, '$')          AS MonSimbolo,
          od.PagIdPago,
          CAST(CASE WHEN od.PagIdPago IS NULL THEN 0 ELSE 1 END AS BIT) AS Pagada,
          od.BultosEsperados,
          od.BultosRecibidos,
          od.OrdAvisoWsp,
          od.OrdFechaAvisoWsp,
          od.OReIdOrdenRetiro,
          LTRIM(RTRIM(od.OrdMaterialPlanilla)) AS Material,
          DATEDIFF(DAY, od.OrdFechaIngresoOrden, GETDATE()) AS DiasEnDeposito
        FROM dbo.OrdenesDeposito od WITH(NOLOCK)
        LEFT JOIN dbo.EstadosOrdenes eo  WITH(NOLOCK) ON eo.EOrIdEstadoOrden = od.OrdEstadoActual
        LEFT JOIN dbo.Monedas        mon WITH(NOLOCK) ON mon.MonIdMoneda     = od.MonIdMoneda
        WHERE od.CliIdCliente = @CliIdCliente
          AND (od.OrdEstadoActual IS NULL OR od.OrdEstadoActual NOT IN (${ESTADOS_FUERA_DEPOSITO.join(',')}))
        ORDER BY od.OrdFechaIngresoOrden DESC
      `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('[VENDEDOR-360] getDepositoPendiente:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Normaliza un nombre para comparar usuario del sistema contra trabajador
// (saca acentos, espacios de más y mayúsculas).
const normalizarNombre = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * GET /api/vendedor-360/vendedores
 * Lista de vendedores con cuántos clientes tiene cada uno.
 *
 * El vendedor de un cliente es Clientes.VendedorID, que guarda la CÉDULA del
 * trabajador (por eso el join con Trabajadores para sacar el nombre).
 *
 * OJO: hoy NO existe un vínculo formal Usuario ↔ Trabajador. Marcamos `esMio`
 * cuando el nombre del usuario logueado coincide con el del trabajador, que es
 * lo único que hay. Si no coincide, el vendedor elige su cartera a mano y la
 * pantalla se la recuerda.
 */
exports.getVendedores = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        LTRIM(RTRIM(c.VendedorID))            AS VendedorID,
        LTRIM(RTRIM(MAX(t.Nombre)))           AS Nombre,
        COUNT(*)                              AS CantClientes
      FROM dbo.Clientes c WITH(NOLOCK)
      LEFT JOIN dbo.Trabajadores t WITH(NOLOCK)
        ON TRY_CAST(t.Cedula AS NVARCHAR(50)) = c.VendedorID
      WHERE c.VendedorID IS NOT NULL AND LTRIM(RTRIM(c.VendedorID)) <> ''
      GROUP BY LTRIM(RTRIM(c.VendedorID))
      ORDER BY COUNT(*) DESC
    `);

    const yo = normalizarNombre(req.user?.name);
    const data = result.recordset.map(v => ({
      ...v,
      // Nombre a mostrar: el del trabajador si lo hay, si no la cédula/código crudo
      Etiqueta: v.Nombre || v.VendedorID,
      esMio: !!yo && normalizarNombre(v.Nombre) === yo,
    }));

    res.json({ success: true, data });
  } catch (err) {
    logger.error('[VENDEDOR-360] getVendedores:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/vendedor-360/vendedores/:VendedorID/clientes
 * IDs de los clientes de ese vendedor (para filtrar la lista en pantalla).
 */
exports.getClientesDeVendedor = async (req, res) => {
  try {
    const { VendedorID } = req.params;
    const pool = await getPool();
    const result = await pool.request()
      .input('VendedorID', sql.NVarChar(50), String(VendedorID).trim())
      .query(`
        SELECT c.CliIdCliente
        FROM dbo.Clientes c WITH(NOLOCK)
        WHERE LTRIM(RTRIM(c.VendedorID)) = @VendedorID
      `);

    res.json({ success: true, data: result.recordset.map(r => r.CliIdCliente) });
  } catch (err) {
    logger.error('[VENDEDOR-360] getClientesDeVendedor:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
