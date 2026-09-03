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

/**
 * GET /api/vendedor-360/ventas-mensuales?anio=2026&mes=9
 *
 * Ventas del mes por vendedor. Definiciones acordadas con el usuario (02/09/2026):
 *   - VENTA        = orden en OrdenesDeposito de un cliente de su cartera
 *                    (Clientes.VendedorID = cédula del trabajador).
 *   - VENDEDOR     = Trabajadores con Área = 'VENTAS' (incluye al encargado).
 *   - COBRADA      = OrdenesDeposito.PagIdPago NO nulo. El 0 ("cubierto sin pago":
 *                    cuenta corriente o plan prepago) cuenta como cobrada.
 *   - MES          = por OrdFechaIngresoOrden, la fecha en que entró al depósito
 *                    (no la de entrega: esa se mueve y parte el mes).
 *   - Se excluyen reposiciones (-R) y fallas (-F): son re-trabajo sin cargo, no ventas.
 *   - Se excluyen canceladas (10) y perdidas (11).
 *   - Los importes NO se convierten: cada moneda va por separado.
 */
exports.getVentasMensuales = async (req, res) => {
  try {
    const hoy = new Date();
    const anio = parseInt(req.query.anio, 10) || hoy.getFullYear();
    const mes = parseInt(req.query.mes, 10) || (hoy.getMonth() + 1);
    if (mes < 1 || mes > 12) {
      return res.status(400).json({ success: false, error: 'Mes inválido' });
    }
    // Rango semiabierto [desde, hasta): evita perder las órdenes del último día por la hora.
    const desde = new Date(anio, mes - 1, 1);
    const hasta = new Date(anio, mes, 1);

    const pool = await getPool();

    // 1. Vendedores del área (aunque no tengan ventas en el mes: van con ceros)
    const vendRes = await pool.request().query(`
      SELECT CAST(Cedula AS NVARCHAR(50))   AS Cedula,
             LTRIM(RTRIM(Nombre))           AS Nombre,
             LTRIM(RTRIM(ISNULL(Puesto,''))) AS Puesto
      FROM dbo.Trabajadores WITH(NOLOCK)
      WHERE LTRIM(RTRIM(UPPER(ISNULL([Área], '')))) = 'VENTAS'
      ORDER BY Nombre
    `);

    // 2. Totales del mes por vendedor y moneda
    const totRes = await pool.request()
      .input('Desde', sql.DateTime, desde)
      .input('Hasta', sql.DateTime, hasta)
      .query(`
        SELECT
          LTRIM(RTRIM(c.VendedorID))                    AS Cedula,
          ISNULL(od.MonIdMoneda, 1)                     AS MonIdMoneda,
          COUNT(*)                                      AS Cant,
          SUM(ISNULL(od.OrdCostoFinal, 0))              AS Monto,
          SUM(CASE WHEN od.PagIdPago IS NOT NULL THEN 1 ELSE 0 END)                         AS CantCobrada,
          SUM(CASE WHEN od.PagIdPago IS NOT NULL THEN ISNULL(od.OrdCostoFinal, 0) ELSE 0 END) AS MontoCobrado
        FROM dbo.OrdenesDeposito od WITH(NOLOCK)
        JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = od.CliIdCliente
        WHERE od.OrdFechaIngresoOrden >= @Desde
          AND od.OrdFechaIngresoOrden <  @Hasta
          AND LTRIM(RTRIM(ISNULL(c.VendedorID, ''))) <> ''
          -- Re-trabajo sin cargo: no son ventas
          AND od.OrdCodigoOrden NOT LIKE '%-R%'
          AND od.OrdCodigoOrden NOT LIKE '%-F%'
          AND (od.OrdEstadoActual IS NULL OR od.OrdEstadoActual NOT IN (10, 11))
        GROUP BY LTRIM(RTRIM(c.VendedorID)), ISNULL(od.MonIdMoneda, 1)
      `);

    // 3. ¿Cuál de los vendedores es el usuario logueado? Primero por la cédula
    //    cargada en su ficha (Usuarios.Cedula); si no la tiene, por nombre — que es
    //    lo único que había hasta ahora y falla cuando el usuario se llama distinto
    //    que el trabajador (caso real: la usuaria "Maria Ferreri" es Soledad Ferreri).
    let miCedula = null;
    try {
      const uid = parseInt(req.user?.id, 10);
      // La columna es opcional: mientras no exista (o esté vacía) se cae al match por nombre.
      const colRes = await pool.request().query("SELECT COL_LENGTH('dbo.Usuarios', 'Cedula') AS L");
      if (uid > 0 && colRes.recordset[0]?.L) {
        const uRes = await pool.request()
          .input('uid', sql.Int, uid)
          .query('SELECT CAST(Cedula AS NVARCHAR(50)) AS Cedula FROM dbo.Usuarios WHERE IdUsuario = @uid');
        miCedula = uRes.recordset[0]?.Cedula || null;
      }
    } catch (e) {
      logger.warn('[VENDEDOR-360] No se pudo leer Usuarios.Cedula: ' + e.message);
    }

    const yo = normalizarNombre(req.user?.name);
    const porCedula = {};
    totRes.recordset.forEach(r => {
      const ced = String(r.Cedula || '').trim();
      if (!porCedula[ced]) porCedula[ced] = [];
      porCedula[ced].push(r);
    });

    const monedaKey = (monId) => (parseInt(monId, 10) === 2 ? 'USD' : 'UYU');
    const vacio = () => ({ cant: 0, monto: 0, cantCobrada: 0, montoCobrado: 0 });

    const data = vendRes.recordset.map(v => {
      const ced = String(v.Cedula || '').trim();
      const filas = porCedula[ced] || [];
      const monedas = { UYU: vacio(), USD: vacio() };
      filas.forEach(f => {
        const k = monedaKey(f.MonIdMoneda);
        monedas[k].cant += f.Cant || 0;
        monedas[k].monto += parseFloat(f.Monto) || 0;
        monedas[k].cantCobrada += f.CantCobrada || 0;
        monedas[k].montoCobrado += parseFloat(f.MontoCobrado) || 0;
      });
      const cantTotal = monedas.UYU.cant + monedas.USD.cant;
      const cobradasTotal = monedas.UYU.cantCobrada + monedas.USD.cantCobrada;
      return {
        cedula: ced,
        nombre: v.Nombre,
        puesto: v.Puesto,
        esMio: (!!miCedula && miCedula.trim() === ced) || (!miCedula && !!yo && normalizarNombre(v.Nombre) === yo),
        cantTotal,
        cobradasTotal,
        sinCobrarTotal: cantTotal - cobradasTotal,
        monedas,
      };
    });

    // Las ventas de carteras que ya no corresponden a un vendedor del área (alguien que
    // se fue y cuyos clientes todavía no se reasignaron) no se pierden: van aparte.
    const cedulasArea = new Set(vendRes.recordset.map(v => String(v.Cedula || '').trim()));
    const huerfanas = Object.keys(porCedula)
      .filter(ced => !cedulasArea.has(ced))
      .reduce((acc, ced) => {
        porCedula[ced].forEach(f => {
          acc.cant += f.Cant || 0;
          acc.cobradas += f.CantCobrada || 0;
        });
        return acc;
      }, { cant: 0, cobradas: 0 });

    res.json({
      success: true,
      periodo: { anio, mes },
      data,
      sinVendedorDelArea: huerfanas,
    });
  } catch (err) {
    logger.error('[VENDEDOR-360] getVentasMensuales:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
