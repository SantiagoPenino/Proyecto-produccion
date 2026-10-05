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
 * GET /api/vendedor-360/ventas-mensuales?anio=2026&mes=9&dgi=DGI|SIN_DGI
 *
 * Plata vendida, cobrada y sin cobrar del mes por vendedor, sobre DOCUMENTOS (01/10/2026).
 * Antes contaba órdenes del depósito; el usuario pidió verlo como Contabilidad → Reportes →
 * "Ventas por Documento (DGI)": solo plata, en pesos y en dólares.
 *   - UNIVERSO   = el de ese reporte (reglasVentas.condEsVenta: e-tickets, e-facturas y
 *                  Pedidos Caja, sin anulados), con su mismo filtro de DGI. Las notas RESTAN
 *                  (nota de crédito −, nota de débito +), igual que en los reportes de ventas
 *                  de Contabilidad desde el 1-oct-2026: si no, una factura anulada con nota
 *                  de crédito quedaría como vendida y cobrada.
 *                  Recibos y anticipos quedan afuera, igual que en Contabilidad: no son ventas.
 *                  Los rollos (planes de metros) y la billetera prepaga SÍ entran, porque se
 *                  venden con un documento normal.
 *   - MES        = por fecha de emisión del documento, con el mismo corte de día que esos
 *                  reportes (día calendario como texto).
 *   - VENDIDO    = DocTotal con el signo de la nota, en la moneda del documento. No se convierte.
 *   - SIN COBRAR = deuda viva del documento (PENDIENTE/VENCIDO/PARCIAL), solo en documentos a
 *                  crédito y Pedidos Caja: la regla del "pendiente de cobro" de Contabilidad.
 *   - COBRADO    = vendido − sin cobrar.
 *   - VENDEDOR   = el de la cartera del cliente del documento (Clientes.VendedorID = cédula de
 *                  un Trabajador del Área VENTAS). DocumentosContables.DocVendedorId no se usa:
 *                  no se llena nunca. Si el documento salió con una ficha genérica (mostrador /
 *                  USER CF) se busca el cliente real como en Top Clientes: el dueño de la orden
 *                  y, si no, el RUC del receptor.
 *   - Lo que no se puede atribuir va en filas aparte (MOSTRADOR / SIN_VENDEDOR) para que el
 *     total cierre: total vendido = "Ventas por Documento" del mismo mes y filtro.
 */
// Reglas de qué documento es una venta, compartidas con los reportes de Contabilidad.
const { reglasVentas } = require('./contabilidadReportesController');

// Primer mes de Ventas por vendedor: antes de junio 2026 no hay datos, o no son confiables (Santiago,
// 02/10/2026). La pantalla no deja ir más atrás, y los ganadores se cuentan desde acá.
const PRIMER_MES_VENTAS = { anio: 2026, mes: 6 };

/**
 * Plata por vendedor y moneda sobre documentos, entre dos fechas ('AAAA-MM-DDThh:mm:ss', día
 * calendario como texto). La usan ventas-mensuales (un mes) y ganadores (varios meses). Con
 * `porMes` agrega la columna Mes = AAAAMM del mes de emisión.
 * Devuelve filas con Tipo (VENDEDOR / SIN_VENDEDOR / MOSTRADOR), Cedula, MonIdMoneda, Vendido,
 * SinCobrar y Notas (y Mes).
 */
const consultarPlataPorVendedor = async (pool, { desde, hasta, dgi = 'TODO', porMes = false }) => {
  if (!reglasVentas) {
    throw new Error('Falta la versión nueva de contabilidadReportesController.js (reglasVentas): van juntos.');
  }
  const { condEsVenta, condVentaONota, signoExpr, condDgi, primerToken, CLIENTES_GENERICOS } = reglasVentas;
  const genericos = CLIENTES_GENERICOS.join(', ');
  const sinFicha = (alias) => `(${alias}.CliIdCliente IS NULL OR ${alias}.CliIdCliente IN (${genericos}))`;
  const filtroDgi = condDgi('doc', dgi);
  // Con `porMes`, el mes de emisión pasa por toda la consulta
  const conMes = (expr, alFrente = false) => (!porMes ? '' : alFrente ? `${expr} AS Mes, ` : ` ${expr} AS Mes,`);

  const resultado = await pool.request()
    .input('desde', sql.VarChar(30), desde)
    .input('hasta', sql.VarChar(30), hasta)
    .query(`
        ;WITH Docs AS (
          SELECT doc.DocIdDocumento, doc.CliIdCliente, doc.DocCliDocumento,${conMes('YEAR(doc.DocFechaEmision) * 100 + MONTH(doc.DocFechaEmision)')}
                 ISNULL(doc.MonIdMoneda, 1) AS MonIdMoneda,
                 CASE WHEN ${condEsVenta('doc')} THEN 0 ELSE 1 END AS EsNota,
                 doc.DocTotal * ${signoExpr('doc')} AS Vendido,
                 CASE WHEN ${condEsVenta('doc')}
                           AND (doc.DocTipo LIKE '%Credito%' OR doc.DocTipo LIKE '%CREDITO%' OR RTRIM(doc.DocTipo) = 'Pedidos Caja')
                      THEN ISNULL(dd.Pendiente, 0) ELSE 0 END AS SinCobrar
          FROM dbo.DocumentosContables doc WITH(NOLOCK)
          -- Una fila por documento: puede haber más de una deuda para el mismo documento.
          LEFT JOIN (
            SELECT DocIdDocumento, SUM(DDeImportePendiente) AS Pendiente
            FROM dbo.DeudaDocumento WITH(NOLOCK)
            WHERE DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL')
            GROUP BY DocIdDocumento
          ) dd ON dd.DocIdDocumento = doc.DocIdDocumento
          WHERE ${condVentaONota('doc')}
            AND doc.DocEstado <> 'ANULADO'
            AND doc.DocFechaEmision >= @desde
            AND doc.DocFechaEmision <= @hasta
            ${filtroDgi ? `AND ${filtroDgi}` : ''}
        ),
        -- Documentos con ficha genérica: el dueño de la orden que se facturó...
        Duenos AS (
          SELECT x.DocIdDocumento, MIN(o.CliIdCliente) AS CliOrden
          FROM (
            SELECT DISTINCT dcd.DocIdDocumento, ${primerToken('dcd.OrdCodigoOrden')} AS Tok
            FROM Docs d
            JOIN dbo.DocumentosContablesDetalle dcd WITH(NOLOCK) ON dcd.DocIdDocumento = d.DocIdDocumento
            WHERE ${sinFicha('d')}
              AND dcd.OrdCodigoOrden IS NOT NULL AND LTRIM(dcd.OrdCodigoOrden) <> ''
          ) x
          JOIN dbo.Ordenes o WITH(NOLOCK) ON o.CodigoOrden = x.Tok
          WHERE o.CliIdCliente IS NOT NULL AND o.CliIdCliente NOT IN (${genericos})
          GROUP BY x.DocIdDocumento
        ),
        -- ...o la ficha que tiene el mismo RUC que el receptor del documento.
        PorRuc AS (
          SELECT d.DocIdDocumento, MIN(c.CliIdCliente) AS CliRuc
          FROM Docs d
          JOIN dbo.Clientes c WITH(NOLOCK)
            ON REPLACE(REPLACE(RTRIM(c.CioRuc), '-', ''), '.', '') =
               REPLACE(REPLACE(RTRIM(d.DocCliDocumento), '-', ''), '.', '')
          WHERE ${sinFicha('d')}
            AND RTRIM(ISNULL(d.DocCliDocumento, '')) <> ''
            AND RTRIM(ISNULL(c.CioRuc, '')) <> ''
            AND c.CliIdCliente NOT IN (${genericos})
          GROUP BY d.DocIdDocumento
        ),
        Resueltos AS (
          SELECT ${conMes('d.Mes', true)}d.MonIdMoneda, d.EsNota, d.Vendido, d.SinCobrar,
                 CASE WHEN ${sinFicha('d')} THEN COALESCE(du.CliOrden, pr.CliRuc) ELSE d.CliIdCliente END AS CliResuelto
          FROM Docs d
          LEFT JOIN Duenos du ON du.DocIdDocumento = d.DocIdDocumento
          LEFT JOIN PorRuc pr ON pr.DocIdDocumento = d.DocIdDocumento
        )
        SELECT ${conMes('x.Mes', true)}x.Tipo, x.Cedula, x.MonIdMoneda,
               SUM(x.Vendido)   AS Vendido,
               SUM(x.SinCobrar) AS SinCobrar,
               SUM(CASE WHEN x.EsNota = 1 THEN x.Vendido ELSE 0 END) AS Notas
        FROM (
          SELECT ${conMes('r.Mes', true)}r.MonIdMoneda, r.EsNota, r.Vendido, r.SinCobrar,
                 CASE WHEN r.CliResuelto IS NULL THEN 'MOSTRADOR'
                      WHEN t.Cedula IS NULL      THEN 'SIN_VENDEDOR'
                      ELSE 'VENDEDOR' END AS Tipo,
                 CAST(t.Cedula AS NVARCHAR(50)) AS Cedula
          FROM Resueltos r
          LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = r.CliResuelto
          LEFT JOIN dbo.Trabajadores t WITH(NOLOCK)
            ON CAST(t.Cedula AS NVARCHAR(50)) = LTRIM(RTRIM(c.VendedorID))
           AND LTRIM(RTRIM(UPPER(ISNULL(t.[Área], '')))) = 'VENTAS'
        ) x
        GROUP BY ${porMes ? 'x.Mes, ' : ''}x.Tipo, x.Cedula, x.MonIdMoneda
      `);
  return resultado.recordset;
};

exports.getVentasMensuales = async (req, res) => {
  try {
    const hoy = new Date();
    const anio = parseInt(req.query.anio, 10) || hoy.getFullYear();
    const mes = parseInt(req.query.mes, 10) || (hoy.getMonth() + 1);
    if (mes < 1 || mes > 12) {
      return res.status(400).json({ success: false, error: 'Mes inválido' });
    }
    const dgiPedido = String(req.query.dgi || '').toUpperCase();
    const dgi = ['DGI', 'SIN_DGI'].includes(dgiPedido) ? dgiPedido : 'TODO';
    // Día calendario como texto, igual que los reportes de Contabilidad: no depende del reloj
    // ni de la zona horaria del proceso.
    const mm = String(mes).padStart(2, '0');
    const ultimoDia = String(new Date(anio, mes, 0).getDate()).padStart(2, '0');

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

    // 2. Plata del mes por vendedor y moneda
    const filasPlata = await consultarPlataPorVendedor(pool, {
      desde: `${anio}-${mm}-01T00:00:00`,
      hasta: `${anio}-${mm}-${ultimoDia}T23:59:59.997`,
      dgi,
    });

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

    // 4. Armado: una fila por vendedor del área, más las filas de lo que no se puede atribuir
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const monedaKey = (monId) => (parseInt(monId, 10) === 2 ? 'USD' : 'UYU');
    const armarMonedas = (filas) => {
      const monedas = { UYU: { vendido: 0, sinCobrar: 0 }, USD: { vendido: 0, sinCobrar: 0 } };
      filas.forEach(f => {
        const m = monedas[monedaKey(f.MonIdMoneda)];
        m.vendido += Number(f.Vendido) || 0;
        m.sinCobrar += Number(f.SinCobrar) || 0;
      });
      for (const k of ['UYU', 'USD']) {
        const m = monedas[k];
        m.vendido = r2(m.vendido);
        m.sinCobrar = r2(m.sinCobrar);
        m.cobrado = r2(m.vendido - m.sinCobrar);
      }
      return monedas;
    };
    const filasDe = (tipo, cedula = null) => filasPlata.filter(f =>
      f.Tipo === tipo && (cedula === null || String(f.Cedula || '').trim() === cedula));
    const tienePlata = (monedas) => ['UYU', 'USD'].some(k =>
      Math.abs(monedas[k].vendido) >= 0.005 || Math.abs(monedas[k].sinCobrar) >= 0.005);

    const data = vendRes.recordset.map(v => {
      const ced = String(v.Cedula || '').trim();
      return {
        tipo: 'VENDEDOR',
        cedula: ced,
        nombre: v.Nombre,
        puesto: v.Puesto,
        esMio: (!!miCedula && miCedula.trim() === ced) || (!miCedula && !!yo && normalizarNombre(v.Nombre) === yo),
        monedas: armarMonedas(filasDe('VENDEDOR', ced)),
      };
    });
    // Sin estas filas el total no cerraría con Contabilidad. Solo aparecen si tienen plata.
    for (const [tipo, nombre] of [
      ['SIN_VENDEDOR', 'Clientes sin vendedor del área'],
      ['MOSTRADOR', 'Mostrador / sin identificar'],
    ]) {
      const monedas = armarMonedas(filasDe(tipo));
      if (tienePlata(monedas)) data.push({ tipo, cedula: null, nombre, puesto: '', esMio: false, monedas });
    }

    // Notas del mes ya restadas del vendido (con su signo): la pantalla lo dice al pie.
    const notas = { UYU: 0, USD: 0 };
    filasPlata.forEach(f => { notas[monedaKey(f.MonIdMoneda)] += Number(f.Notas) || 0; });
    notas.UYU = r2(notas.UYU);
    notas.USD = r2(notas.USD);

    res.json({
      success: true,
      periodo: { anio, mes },
      dgi,
      data,
      notas,
    });
  } catch (err) {
    logger.error('[VENDEDOR-360] getVentasMensuales:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/vendedor-360/ganadores
 *
 * El ganador de cada mes, de junio 2026 al mes en curso: el vendedor del área con más total
 * unificado en US$ (US$ vendido + $ vendido ÷ cotización), con las reglas de ventas-mensuales y
 * sin filtro de DGI. La cotización de cada mes es la última cargada hasta su último día: en un mes
 * cerrado, la última de ese mes; en el mes en curso, la del día. Es la misma que usa la pantalla,
 * así que el ganador es la primera fila de su tabla. Trae también el segundo, para la ventaja.
 * La racha (meses seguidos) la cuenta la pantalla con esta lista.
 */
exports.getGanadores = async (req, res) => {
  try {
    const hoy = new Date();
    const meses = [];
    for (let a = PRIMER_MES_VENTAS.anio, m = PRIMER_MES_VENTAS.mes;
      a < hoy.getFullYear() || (a === hoy.getFullYear() && m <= hoy.getMonth() + 1);) {
      meses.push({ anio: a, mes: m });
      if (m === 12) { a += 1; m = 1; } else { m += 1; }
    }
    if (meses.length === 0) return res.json({ success: true, meses: [] });
    const finDe = ({ anio, mes }) =>
      `${anio}-${String(mes).padStart(2, '0')}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
    const primero = meses[0];
    const ultimo = meses[meses.length - 1];

    const pool = await getPool();

    // 1. Vendedores del área, para el nombre
    const vendRes = await pool.request().query(`
      SELECT CAST(Cedula AS NVARCHAR(50)) AS Cedula, LTRIM(RTRIM(Nombre)) AS Nombre
      FROM dbo.Trabajadores WITH(NOLOCK)
      WHERE LTRIM(RTRIM(UPPER(ISNULL([Área], '')))) = 'VENTAS'
    `);
    const nombres = new Map(vendRes.recordset.map(v => [String(v.Cedula || '').trim(), v.Nombre]));

    // 2. Plata por mes, vendedor y moneda
    const filas = await consultarPlataPorVendedor(pool, {
      desde: `${primero.anio}-${String(primero.mes).padStart(2, '0')}-01T00:00:00`,
      hasta: `${finDe(ultimo)}T23:59:59.997`,
      porMes: true,
    });

    // 3. La cotización de cada mes: la última cargada hasta su último día. Los valores de la lista
    //    salen de los meses armados acá, no de nada que mande el usuario.
    const lista = meses.map(x => `(${x.anio * 100 + x.mes}, '${finDe(x)}')`).join(', ');
    const cotRes = await pool.request().query(`
      SELECT v.Mes, c.CotDolar, CONVERT(VARCHAR(10), c.CotFecha, 23) AS CotFecha
      FROM (VALUES ${lista}) v(Mes, Hasta)
      OUTER APPLY (
        SELECT TOP 1 CotDolar, CotFecha
        FROM dbo.Cotizaciones WITH(NOLOCK)
        WHERE CotDolar > 0 AND CotFecha < DATEADD(DAY, 1, CAST(v.Hasta AS date))
        ORDER BY CotFecha DESC
      ) c
    `);
    const cotizacionDe = new Map(cotRes.recordset.map(c => [Number(c.Mes),
      Number(c.CotDolar) > 0 ? { valor: Number(c.CotDolar), fecha: c.CotFecha } : null]));

    // 4. Por mes, el total unificado de cada vendedor, de mayor a menor. Cada moneda se redondea al
    //    centavo antes de unificar, como en la pantalla.
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const resultado = meses.map(({ anio, mes }) => {
      const clave = anio * 100 + mes;
      const cotizacion = cotizacionDe.get(clave) || null;
      const enCurso = anio === hoy.getFullYear() && mes === hoy.getMonth() + 1;
      const base = { anio, mes, enCurso, cotizacion, ganador: null, segundo: null };
      if (!cotizacion) return base;
      const porVendedor = new Map();   // cédula → { UYU, USD }
      filas.filter(f => Number(f.Mes) === clave && f.Tipo === 'VENDEDOR').forEach(f => {
        const ced = String(f.Cedula || '').trim();
        const plata = porVendedor.get(ced) || { UYU: 0, USD: 0 };
        plata[parseInt(f.MonIdMoneda, 10) === 2 ? 'USD' : 'UYU'] += Number(f.Vendido) || 0;
        porVendedor.set(ced, plata);
      });
      const ranking = [...porVendedor.entries()]
        .map(([cedula, p]) => ({ cedula, nombre: nombres.get(cedula) || cedula, total: r2(r2(p.USD) + r2(p.UYU) / cotizacion.valor) }))
        .filter(x => x.total > 0)
        .sort((x, y) => y.total - x.total);
      return { ...base, ganador: ranking[0] || null, segundo: ranking[1] || null };
    });

    res.json({ success: true, meses: resultado });
  } catch (err) {
    logger.error('[VENDEDOR-360] getGanadores:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
