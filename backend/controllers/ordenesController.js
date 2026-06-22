const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const contabilidadService = require('../services/contabilidadService');
const ordenesExternasSvc = require('../services/ordenesExternasService');

// Controlador para obtener las órdenes
const getOrdenesByFilter = async (req, res) => {
  try {
    const pool = await getPool();
    const {
      codigoCliente,
      estado,
      fechaDesde,
      fechaHasta,
      codigoOrden,
      subMarca,
      tipoCliente,
      numeroRetiro
    } = req.query;

    let query = `
      SELECT
        o.OrdIdOrden AS IdOrden,
        o.OrdCodigoOrden AS CodigoOrden,
        o.OReIdOrdenRetiro AS OrdenRetiro,
        eore.EORNombreEstado AS EstadoOrdenRetiro,
        c.IDCliente AS IdCliente,
        c.TelefonoTrabajo AS Celular,
        tc.TClDescripcion AS TipoCliente,
        o.OrdNombreTrabajo AS NombreTrabajo,
        CONCAT(p.Descripcion, '') AS Producto,
        ISNULL(p.CodArticulo, '') AS CodigoOdoo,
        ISNULL(p.ProCodigoOdooProducto, '') AS ProCodigoOdooProducto,
        o.OrdExportadoOdoo AS ExportadoOdoo,
        eo.EOrNombreEstado AS Estado,
        o.OrdFechaEstadoActual AS FechaEstado,
        CAST(o.OrdCantidad AS NVARCHAR(50)) AS Cantidad,
        mon.MonSimbolo AS MonSimbolo,
        CAST(0 AS DECIMAL(10,2)) AS PrecioUnitario,
        CAST(o.OrdCostoFinal AS DECIMAL(10,2)) AS CostoFinal,
        CONCAT(CAST(o.OrdDescuentoAplicado * 100 AS INT), '%') AS DescuentoAplicado,
        mo.MOrNombreModo AS Modo,
        fe.Nombre AS LugarRetiro,
        o.OrdFechaIngresoOrden AS FechaIngresoOrden,
        o.OrdNotaCliente AS OrdNotaCliente
      FROM OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
      LEFT JOIN TiposClientes tc WITH(NOLOCK) ON c.TClIdTipoCliente = tc.TClIdTipoCliente
      LEFT JOIN Articulos p WITH(NOLOCK) ON o.ProIdProducto = p.ProIdProducto
      LEFT JOIN Monedas mon WITH(NOLOCK) ON o.MonIdMoneda = mon.MonIdMoneda
      LEFT JOIN EstadosOrdenes eo WITH(NOLOCK) ON o.OrdEstadoActual = eo.EOrIdEstadoOrden
      LEFT JOIN OrdenesRetiro ore WITH(NOLOCK) ON o.OReIdOrdenRetiro = ore.OReIdOrdenRetiro
      LEFT JOIN EstadosOrdenesRetiro eore WITH(NOLOCK) ON ore.OReEstadoActual = eore.EORIdEstadoOrden
      LEFT JOIN ModosOrdenes mo WITH(NOLOCK) ON o.MOrIdModoOrden = mo.MOrIdModoOrden
      LEFT JOIN FormasEnvio fe WITH(NOLOCK) ON fe.ID = o.LReIdLugarRetiro
      WHERE 1 = 1
    `;

    const request = pool.request();

    if (codigoCliente) {
      query += ` AND (c.IDCliente LIKE '%' + @codigoCliente + '%' OR c.Nombre LIKE '%' + @codigoCliente + '%' OR CAST(c.IDReact AS VARCHAR) = @codigoCliente)`;
      request.input("codigoCliente", sql.NVarChar, codigoCliente);
    }
    if (codigoOrden) {
      query += ` AND o.OrdCodigoOrden LIKE '%' + @codigoOrden + '%'`;
      request.input("codigoOrden", codigoOrden);
    }
    if (fechaDesde) {
      query += ` AND CONVERT(DATE, o.OrdFechaIngresoOrden) >= @fechaDesde`;
      request.input("fechaDesde", sql.Date, new Date(fechaDesde));
    }
    if (fechaHasta) {
      query += ` AND CONVERT(DATE, o.OrdFechaIngresoOrden) <= @fechaHasta`;
      request.input("fechaHasta", sql.Date, new Date(fechaHasta));
    }
    if (estado) {
      if (Array.isArray(estado)) {
        query += ` AND eo.EOrNombreEstado IN (${estado.map((_, i) => `@estado${i}`).join(',')})`;
        estado.forEach((est, i) => request.input(`estado${i}`, est));
      } else {
        query += ` AND eo.EOrNombreEstado = @estado`;
        request.input("estado", estado);
      }
    }
    if (tipoCliente) {
      if (Array.isArray(tipoCliente)) {
        query += ` AND c.TClIdTipoCliente IN (${tipoCliente.map((_, i) => `@tipoCliente${i}`).join(',')})`;
        tipoCliente.forEach((tc, i) => request.input(`tipoCliente${i}`, tc));
      } else {
        query += ` AND c.TClIdTipoCliente = @tipoCliente`;
        request.input("tipoCliente", tipoCliente);
      }
    }
    if (numeroRetiro) {
      // Extraer solo la parte numérica si viene con prefijo tipo RL-123, R-123, RT-123, etc.
      const soloNumero = String(numeroRetiro).replace(/^[A-Za-z\-]+/, '').trim();
      if (soloNumero && !isNaN(soloNumero)) {
        query += ` AND o.OReIdOrdenRetiro = @numeroRetiro`;
        request.input("numeroRetiro", parseInt(soloNumero, 10));
      } else {
        // Búsqueda por texto en el código si no es numérico puro
        query += ` AND CAST(o.OReIdOrdenRetiro AS NVARCHAR) LIKE '%' + @numeroRetiro + '%'`;
        request.input("numeroRetiro", String(numeroRetiro).trim());
      }
    }
    if (subMarca) {
      // SubMarca is no longer supported with the new Articulos structure because it does not exist there
      logger.info("SubMarca filter ignored as it is no longer supported with Articulos.");
    }

    query += ` ORDER BY o.OrdIdOrden DESC`;

    const result = await request.query(query);

    const orders = result.recordset.map(order => {
      order.FechaIngresoOrden = new Date(order.FechaIngresoOrden).toLocaleString('en-US', {
        timeZone: 'America/Montevideo',
      });
      return order;
    });

    res.json(orders);
  } catch (err) {
    logger.error('Error al obtener los datos:', err);
    res.status(500).json({ error: 'Error al obtener los datos', msg: err?.message, stack: err?.stack });
  }
};


const getOrdenByCodigo = async (req, res) => {
  const { orderNumber } = req.params;

  try {
    const pool = await getPool();

    const query = `
      SELECT TOP 1
        o.OrdIdOrden,
        o.OrdCodigoOrden,
        o.OrdCantidad,
        CASE WHEN o.PagIdPago IS NOT NULL THEN 1 ELSE 0 END AS OrdPagoRealizado,
        eo.EOrNombreEstado,
        c.IDCliente,
        c.TelefonoTrabajo,
        tc.TClDescripcion,
        mon.MonSimbolo,
        CAST(o.OrdCostoFinal AS DECIMAL(10,2)) AS CostoFinal,
        o.OrdFechaIngresoOrden AS FechaIngresoOrden
      FROM OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
      LEFT JOIN TiposClientes tc WITH(NOLOCK) ON c.TClIdTipoCliente = tc.TClIdTipoCliente
      LEFT JOIN EstadosOrdenes eo WITH(NOLOCK) ON o.OrdEstadoActual = eo.EOrIdEstadoOrden
      LEFT JOIN Monedas mon WITH(NOLOCK) ON o.MonIdMoneda = mon.MonIdMoneda
      WHERE o.OrdCodigoOrden = @OrderNumber
    `;

    const result = await pool.request()
      .input('OrderNumber', sql.VarChar, orderNumber)
      .query(query);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    logger.error('Error al obtener la orden:', err);
    res.status(500).json({ error: 'Error al obtener la orden' });
  }
};


// --- Funciones Helper para Integración Mapeada ---

// Helper: Buscar Cliente Local por IDReact que llega en QR
const getClientePorIDReact = async (pool, idReactQR) => {
  // Si el valor no puede ser un entero válido, no hay match posible
  const idNum = parseInt(String(idReactQR).replace(',', '.'), 10);
  if (isNaN(idNum)) return null;

  const result = await pool.request()
    .input('IDReactQR', sql.Int, idNum)
    .query(`
      SELECT TOP 1 c.CliIdCliente, c.Nombre, c.IDReact, c.IDCliente, c.FormaEnvioID, tc.TClDescripcion AS TipoCliente
      FROM Clientes c WITH(NOLOCK)
      LEFT JOIN TiposClientes tc WITH(NOLOCK) ON c.TClIdTipoCliente = tc.TClIdTipoCliente
      WHERE c.IDReact = @IDReactQR
    `);
  return result.recordset.length > 0 ? result.recordset[0] : null;
};


// Helper: Buscar Producto Local por IDProdReact que llega en QR
const getProductoPorIDReact = async (pool, idProdReactQR) => {
  const idNum = parseInt(String(idProdReactQR), 10);
  if (isNaN(idNum)) return null;
  const result = await pool.request()
    .input('IDProdReact', sql.Int, idNum)
    .query(`
      SELECT TOP 1 a.ProIdProducto,
        LTRIM(RTRIM(a.Descripcion)) AS ProductoNombre,
        ISNULL(a.MonIdMoneda, 1) AS MonIdMoneda,
        CASE ISNULL(a.MonIdMoneda, 1) WHEN 2 THEN 'USD' ELSE '$U' END AS MonSimbolo
      FROM Articulos a WITH(NOLOCK)
      WHERE a.IDProdReact = @IDProdReact
    `);
  return result.recordset.length > 0 ? result.recordset[0] : null;
};


/**
 * parsearDatosOrden
 * ──────────────────────────────────────────────────────────────────────────
 * Extrae la cantidad y el producto de un string QR de orden.
 *
 * ► Órdenes NORMALES (no XSB/XDF):
 *     Lee cantidad de la posición [5] del string.
 *     No sobreescribe el producto (usa el del QR).
 *
 * ► Órdenes EXTERNAS (XSB, XDF, ...):
 *     Consulta la API de Google Sheets para obtener la cantidad REAL
 *     de material consumido y el producto correcto.
 *     El string QR trae el dato del último sector → NO es confiable.
 *
 * @param {string} ordenString  String completo del QR
 * @param {string} codigoOrden  Código ya parseado (partes[0])
 * @returns {Promise<{
 *   cantidad:         number,   siempre un decimal
 *   idProdReactExt:  number|null  null = usar el producto del QR
 * }>}
 */
async function parsearDatosOrden(ordenString, codigoOrden) {

  // 1. Verificar si ya existe en PedidosCobranza (Escenarios 2 y 3: Checking o Pedido Web)
  try {
    const pool = await getPool();
    const pCob = await pool.request()
      .input('Codigo', sql.NVarChar, codigoOrden)
      .query('SELECT TOP 1 ID, MontoTotal, Moneda, QR_Cantidad, QR_Producto FROM PedidosCobranza WITH(NOLOCK) WHERE LTRIM(RTRIM(NoDocERP)) = @Codigo');

    if (pCob.recordset.length > 0) {
      const pCobData = pCob.recordset[0];
      const rawCantidad = ordenString.trim().split('$*')[5] ?? '0';
      const fallbackCant = parseFloat(rawCantidad.toString().replace(',', '.'));
      const cantidadCob = parseFloat(pCobData.QR_Cantidad) || fallbackCant;

      return {
        cantidad: isNaN(cantidadCob) ? 0 : cantidadCob,
        idProdReactExt: pCobData.QR_Producto ? parseInt(pCobData.QR_Producto, 10) : null,
        importeCorteUYU: 0,
        importeCosturaUYU: 0,
        importeBordadoUYU: 0,
        importeTotal: pCobData.MontoTotal,
        detalleCostos: 'Desde PedidosCobranza',
        material: null,
        yaCobrado: true,
        montoCobrado: pCobData.MontoTotal,
        monedaCobrada: pCobData.Moneda
      };
    }
  } catch (e) {
    logger.warn(`[PARSE-QR] Error consultando PedidosCobranza para ${codigoOrden}: ${e.message}`);
  }

  // ── Orden externa (XSB / XDF / ...) → fuente: Google Sheets ──────────
  if (ordenesExternasSvc.esOrdenExterna(codigoOrden)) {
    try {
      const datos = await ordenesExternasSvc.getDatosDesdeSheets(codigoOrden);
      return {
        cantidad: datos.cantidad,
        idProdReactExt: datos.idProdReact,
        // Costos individuales en UYU desde Sheets (NO usar como precio directo)
        importeCorteUYU: datos.importeCorte || 0,
        importeCosturaUYU: datos.importeCostura || 0,
        importeBordadoUYU: datos.importeBordado || 0,
        importeTotal: datos.importeTotal,   // solo referencia/log
        detalleCostos: datos.detalleCostos,
        material: datos.material || null,
        yaCobrado: false
      };
    } catch (err) {
      // Si Sheets falla, loguear y caer al valor del QR (degradación elegante)
      logger.warn(`[EXTERNAS] No se pudo obtener datos de Sheets para ${codigoOrden}: ${err.message}. Usando valor del QR como fallback.`);
    }
  }

  // ── Orden normal (o fallback) → fuente: string QR posición [5] ──────────
  const parts = ordenString.trim().split('$*');
  const rawCantidad = parts[5] ?? '0';
  const cantidad = parseFloat(rawCantidad.toString().replace(',', '.'));

  return {
    cantidad: isNaN(cantidad) ? 0 : cantidad,
    idProdReactExt: null,
    importeCorteUYU: 0,
    importeCosturaUYU: 0,
    importeBordadoUYU: 0,
    importeTotal: 0,
    detalleCostos: '',
    material: null,
    yaCobrado: false
  };
}


const createOrden = async (req, res) => {
  const { ordenString, skipAccounting } = req.body;
  const UsuarioAlta = req.user ? req.user.id : 70;

  try {
    const parts = ordenString.trim().split('$*');

    // Validación de que sean exactamente 7 fragmentos y ninguno esté vacío
    if (parts.length !== 7 || parts.some(p => p.trim() === '')) {
      return res.status(400).json({ error: 'Código malformado. Faltan datos o no contiene las 7 partes exactas.' });
    }

    const [CodigoOrden, CodigoClienteQR, NombreTrabajo, IdModo, IdProductoQR, , CostoFinal] = parts;

    // Parsear cantidad y producto (puede consultar Sheets si es XSB/XDF)
    const { cantidad: cantidadDecimal, idProdReactExt,
      importeCorteUYU, importeCosturaUYU, importeBordadoUYU,
      importeTotal, detalleCostos, material: materialPlanilla,
      yaCobrado, montoCobrado, monedaCobrada } = await parsearDatosOrden(ordenString, CodigoOrden);

    // Si la orden ya estaba guardada en PedidosCobranza, el costo es ese MontoTotal.
    const costoOriginalQR = yaCobrado ? montoCobrado : parseFloat(CostoFinal.toString().replace(',', '.'));

    let trabajoFinal = NombreTrabajo;
    // Eliminado: no alteraremos el NombreTrabajo escaneado con textos extras.

    const pool = await getPool();

    const existingResult = await pool.request()
      .input('CodigoOrden', sql.VarChar(100), CodigoOrden)
      .query('SELECT o.*, r.OReIdOrdenRetiro as checkRetiro, r.OReIdOrdenRetiro as oReId, r.OReFechaEstadoActual as rEstadoActual FROM OrdenesDeposito o WITH(UPDLOCK, HOLDLOCK) LEFT JOIN OrdenesRetiro r WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro WHERE o.OrdCodigoOrden = @CodigoOrden');

    if (existingResult.recordset.length > 0) {
      const existingOrden = existingResult.recordset[0];
      const estadoActual = existingOrden.OrdEstadoActual;

      if (!existingOrden.checkRetiro) {

        const clienteMapeado = await getClientePorIDReact(pool, CodigoClienteQR);
        if (!clienteMapeado) return res.status(404).json({ error: 'Cliente no mapeado o inexistente vía IDReact.' });

        const productoMapeado = await getProductoPorIDReact(pool, IdProductoQR);
        if (!productoMapeado) return res.status(405).json({ error: 'Producto no mapeado o inexistente vía IDProdReact.' });

        // Para XSB/XDF: guardar el producto de Sheets (tela real), no el del QR
        let productoParaDBUpdate = productoMapeado;
        if (idProdReactExt !== null) {
          const productoSheets = await getProductoPorIDReact(pool, idProdReactExt);
          if (productoSheets) productoParaDBUpdate = productoSheets;
        }

        // NO TIENE ORDEN DE RETIRO, SE ACTUALIZA
        await pool.request()
          .input('CodigoOrden', sql.VarChar(100), CodigoOrden)
          .input('CodigoCliente', sql.Int, clienteMapeado.CliIdCliente)
          .input('NombreTrabajo', sql.VarChar(255), trabajoFinal)
          .input('IdModo', sql.Int, parseInt(IdModo, 10) || null)
          .input('IdProducto', sql.Int, productoParaDBUpdate.ProIdProducto)  // ← Sheets para XSB
          .input('Cantidad', sql.Float, cantidadDecimal)
          .input('CostoFinal', sql.Float, costoOriginalQR)
          .input('UsuarioAlta', sql.Int, UsuarioAlta)
          .input('MaterialPlanilla', sql.NVarChar(255), materialPlanilla || null)
          .query(`
            UPDATE OrdenesDeposito
            SET 
              CliIdCliente = @CodigoCliente,
              OrdNombreTrabajo = @NombreTrabajo,
              MOrIdModoOrden = @IdModo,
              ProIdProducto = @IdProducto,
              OrdCantidad = @Cantidad,
              OrdCostoFinal = @CostoFinal,
              OrdFechaEstadoActual = GETDATE(),
              OrdUsuarioAlta = @UsuarioAlta,
              OrdMaterialPlanilla = COALESCE(@MaterialPlanilla, OrdMaterialPlanilla)
            WHERE OrdCodigoOrden = @CodigoOrden
          `);

        return res.status(200).json({ message: 'Orden actualizada correctamente' });
      } else {
        const isNotFoundInDeposito =
          estadoActual !== 9 &&
          existingOrden.oReId === 5 &&
          new Date(existingOrden.OrdFechaEstadoActual) < new Date(existingOrden.rEstadoActual);

        if (isNotFoundInDeposito) {
          await pool.request()
            .input('CodigoOrden', sql.VarChar(100), CodigoOrden)
            .query(`
              UPDATE OrdenesDeposito
              SET OrdEstadoActual = 1,
                  OrdFechaEstadoActual = GETDATE()
              WHERE OrdCodigoOrden = @CodigoOrden
            `);

          await pool.request()
            .input('OrdIdOrden', sql.Int, existingOrden.OrdIdOrden)
            .input('EOrIdEstadoOrden', sql.Int, 1) // Estado: Ingresado
            .input('HEOFechaEstado', sql.DateTime, new Date())
            .input('UsuarioAlta', sql.Int, UsuarioAlta)
            .query(`
              INSERT INTO HistoricoEstadosOrdenes (
                OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta
              ) VALUES (
                @OrdIdOrden, @EOrIdEstadoOrden, @HEOFechaEstado, @UsuarioAlta
              )
            `);

          return res.status(202).json({ message: 'Se actualiza el estado de la orden pues ya habia sido ingresada pero no se encontraba en depósito.' });
        } else {
          return res.status(400).json({ error: 'ESTA ORDEN YA FUE MARCADA COMO ENTREGADA.' });
        }
      }
    }

    if (!CodigoClienteQR || CodigoClienteQR === '') {
      return res.status(403).json({ error: 'Falta campo de cliente en la etiqueta.' });
    }

    const clienteMapeado = await getClientePorIDReact(pool, CodigoClienteQR);
    if (!clienteMapeado) {
      return res.status(404).json({ error: 'Cliente no encontrado asociando IDReact.' });
    }
    const reqClientId = clienteMapeado.CliIdCliente;

    const productoMapeado = await getProductoPorIDReact(pool, IdProductoQR);
    if (!productoMapeado) {
      return res.status(405).json({ error: 'Producto no encontrado asociando IDProdReact.' });
    }

    // ── Producto para la DB: Sheets si es XSB/XDF, QR si es orden normal ──────
    const monIdMoneda = productoMapeado.MonIdMoneda || 1;
    const cantidadQR = parseFloat((ordenString.trim().split('$*')[5] ?? '0').replace(',', '.')) || cantidadDecimal;

    // ── Producto para hooks de contabilidad Y para la DB en órdenes externas ───
    let productoContabilidad = productoMapeado;
    if (idProdReactExt !== null && idProdReactExt !== productoMapeado.ProIdProducto) {
      const productoSheets = await getProductoPorIDReact(pool, idProdReactExt);
      if (productoSheets) {
        logger.info(`[EXTERNAS] ${CodigoOrden}: contabilidad usa producto Sheets (IDProdReact ${IdProductoQR} → ${idProdReactExt}). DB conserva el original.`);
        productoContabilidad = productoSheets;
      } else {
        logger.warn(`[EXTERNAS] ${CodigoOrden}: IDProdReact ${idProdReactExt} de Sheets no existe en BD. Contabilidad usará el del QR.`);
      }
    }

    // Para XSB/XDF: la DB guarda el producto real de la tela (Sheets), no el del QR
    const productoParaDB = idProdReactExt !== null ? productoContabilidad : productoMapeado;
    if (idProdReactExt !== null && productoParaDB.ProIdProducto !== productoMapeado.ProIdProducto) {
      logger.info(`[EXTERNAS] ${CodigoOrden}: DB guardará producto Sheets (ProId=${productoParaDB.ProIdProducto} "${productoParaDB.ProductoNombre}") en lugar del QR (ProId=${productoMapeado.ProIdProducto}).`);
    }

    const result = await pool.request()
      .input('CodigoOrden', sql.VarChar(100), CodigoOrden)
      .input('Cantidad', sql.Float, cantidadDecimal)               // ← cantidad de Sheets (real)
      .input('CodigoCliente', sql.Int, reqClientId)
      .input('NombreTrabajo', sql.VarChar(255), trabajoFinal)
      .input('IdModo', sql.Int, parseInt(IdModo, 10) || null)
      .input('IdProducto', sql.Int, productoParaDB.ProIdProducto)  // ← Sheets para XSB, QR para normal

      .input('CostoFinal', sql.Float, costoOriginalQR)
      .input('FechaIngresoOrden', sql.DateTime, new Date())
      .input('UsuarioAlta', sql.Int, UsuarioAlta)
      .input('OrdEstadoActual', sql.Int, 1)
      .input('OrdFechaEstadoActual', sql.DateTime, new Date())
      .input('MonIdMoneda', sql.Int, monIdMoneda)
      .input('LugarRetiro', sql.Int, clienteMapeado.FormaEnvioID ? parseInt(clienteMapeado.FormaEnvioID, 10) : null)
      .input('MaterialPlanilla', sql.NVarChar(255), materialPlanilla || null)
      .query(`
        DECLARE @newOrdIdOrden TABLE (Codigo INT);

        INSERT INTO OrdenesDeposito (
          OrdCodigoOrden,
          OrdCantidad,
          CliIdCliente,
          OrdNombreTrabajo,
          MOrIdModoOrden,
          ProIdProducto,
          MonIdMoneda,
          OrdCostoFinal,
          OrdFechaIngresoOrden,
          OrdUsuarioAlta,
          OrdEstadoActual,
          OrdFechaEstadoActual,
          LReIdLugarRetiro,
          OrdMaterialPlanilla
        )
        OUTPUT INSERTED.OrdIdOrden INTO @newOrdIdOrden
        VALUES (
          @CodigoOrden, @Cantidad, @CodigoCliente,
          @NombreTrabajo, @IdModo, @IdProducto,
          @MonIdMoneda,
          @CostoFinal, @FechaIngresoOrden,
          @UsuarioAlta, @OrdEstadoActual, @OrdFechaEstadoActual, @LugarRetiro,
          @MaterialPlanilla
        );

        SELECT Codigo AS NewOrderId FROM @newOrdIdOrden;
      `);

    const newOrderId = result.recordset[0].NewOrderId;

    await pool.request()
      .input('NewOrderId', sql.Int, newOrderId)
      .input('EOrIdEstadoOrden', sql.Int, 1)
      .input('HEOFechaEstado', sql.DateTime, new Date())
      .input('UsuarioAlta', sql.Int, UsuarioAlta)
      .query(`
        INSERT INTO HistoricoEstadosOrdenes(
          OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta
        ) VALUES(
          @NewOrderId, @EOrIdEstadoOrden, @HEOFechaEstado, @UsuarioAlta
        )
      `);

    const io = req.app.get('socketio');
    if (io) io.emit('actualizado', { type: 'actualizacion' });

    res.status(201).json({ message: 'Orden creada correctamente', idOrden: newOrderId });

    // ── REGLA DE PRICING ───────────────────────────────────────────────────────────────
    // Para XSB/XDF: el precio del QR (costoOriginalQR) es SIEMPRE la deuda base (USD).
    // Los costos de Sheets (corte/costura/bordado) están en UYU y solo se usan cuando
    // hay plan activo: se convierten a USD y se registran como deuda de servicios.
    // NUNCA usar importeTotal de Sheets directamente como precio en USD.
    const deudaReal = yaCobrado ? montoCobrado : costoOriginalQR;
    const finalMonId = yaCobrado ? (monedaCobrada === 'USD' ? 2 : 1) : monIdMoneda;

    logger.info(`[CTRL:ORDEN] Post-commit Contabilidad — Orden=${CodigoOrden} CliId=${reqClientId} ProIdProducto_contabilidad=${productoContabilidad.ProIdProducto} cantidadDecimal=${cantidadDecimal} costoQR=${costoOriginalQR} deudaReal=${deudaReal} MonId=${finalMonId} yaCobrado=${yaCobrado}`);


    let tienePlan = false;
    if (cantidadDecimal > 0 && productoContabilidad.ProIdProducto) {
      const pool = await require('../config/db.js').getPool();
      const planCheck = await pool.request()
        .input('c', sql.Int, reqClientId)
        .input('p', sql.Int, productoContabilidad.ProIdProducto)
        .query(`
          SELECT TOP 1 pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada 
          FROM dbo.PlanesMetros pm WITH(NOLOCK)
          WHERE pm.CliIdCliente = @c 
            AND pm.PlaActivo = 1 
            AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
            AND (
              pm.ProIdProducto = @p
              OR EXISTS (
                SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                WHERE pap.PlaIdPlan = pm.PlaIdPlan
                  AND pap.ProIdProducto = @p
              )
            )
        `);

      tienePlan = planCheck.recordset.length > 0;
      logger.info(`[CTRL:ORDEN] Plan check en controller: CliId=${reqClientId} ProId=${productoContabilidad.ProIdProducto} tienePlan=${tienePlan} Detalle=${JSON.stringify(planCheck.recordset[0] || null)}`);
    } else {
      logger.info(`[CTRL:ORDEN] No se verifica plan: cantidadDecimal=${cantidadDecimal} ProIdProducto=${productoContabilidad.ProIdProducto}`);
    }

    // 1. Calcular serviciosUSD si aplica (viene de Sheets en UYU)
    let serviciosUSD = 0;
    if (!yaCobrado) {
      const serviciosUYU = (importeCorteUYU || 0) + (importeCosturaUYU || 0) + (importeBordadoUYU || 0);
      if (serviciosUYU > 0.01) {
        try {
          const poolC = await require('../config/db.js').getPool();
          const cotRes = await poolC.request().query(`SELECT TOP 1 CotDolar FROM dbo.Cotizaciones ORDER BY CotIdCotizacion DESC`);
          const cotizacion = cotRes.recordset[0]?.CotDolar || 40;
          serviciosUSD = Math.round((serviciosUYU / cotizacion) * 100) / 100;
          logger.info(`[CTRL:ORDEN] ${CodigoOrden}: servicios UYU=${serviciosUYU} ÷ cotiz=${cotizacion} = USD=${serviciosUSD}`);
        } catch (e) {
          logger.error(`[CTRL:ORDEN] Error convirtiendo servicios UYU a USD para ${CodigoOrden}: ${e.message}`);
        }
      }
    }

    // 2. Procesar eventos contables
    if (!skipAccounting) {
      if (tienePlan) {
        // EVENTO ENTREGA: descuenta metros del plan
        logger.info(`[CTRL:ORDEN] Disparando evento ENTREGA para ${CodigoOrden} (tiene plan activo)`);
        contabilidadService.procesarEventoContable('ENTREGA', {
          OrdIdOrden: newOrderId,
          CliIdCliente: reqClientId,
          ProIdProducto: productoContabilidad.ProIdProducto,
          Cantidad: cantidadDecimal,
          CodigoOrden,
          NombreTrabajo: trabajoFinal,
          UsuarioAlta,
          Importe: deudaReal, // se usa como ref, pero el asiento toma el costo del plan
          MonIdMoneda: finalMonId
        }).catch(e => logger.error(`[CONTABILIDAD] Error en ENTREGA para ${CodigoOrden}: ${e.message}`));

        if (yaCobrado) {
          if (deudaReal > 0) {
            logger.info(`[CTRL:ORDEN] Disparando evento ORDEN para ${CodigoOrden} (servicios pre-calculados)`);
            contabilidadService.procesarEventoContable('ORDEN', {
              OrdIdOrden: newOrderId,
              CliIdCliente: reqClientId,
              Importe: deudaReal,
              MonIdMoneda: finalMonId,
              CodigoOrden,
              NombreTrabajo: `${trabajoFinal} [Servicios]`,
              UsuarioAlta
            }).catch(e => logger.error(`[CONTABILIDAD] Error en ORDEN-SERVICIOS (ya cobrado) para ${CodigoOrden}: ${e.message}`));
          }
        } else {
          if (serviciosUSD > 0) {
            logger.info(`[CTRL:ORDEN] Disparando evento ORDEN para ${CodigoOrden} (solo servicios USD=${serviciosUSD})`);
            contabilidadService.procesarEventoContable('ORDEN', {
              OrdIdOrden: newOrderId,
              CliIdCliente: reqClientId,
              Importe: serviciosUSD,
              MonIdMoneda: 2,   // USD
              CodigoOrden,
              NombreTrabajo: `${trabajoFinal} [Servicios]`,
              UsuarioAlta
            }).catch(e => logger.error(`[CONTABILIDAD] Error en ORDEN-SERVICIOS para ${CodigoOrden}: ${e.message}`));
          }
        }

      } else {
        // Sin plan → el cliente paga el costo del QR (producto).
        // ATENCIÓN: El costo del QR (deudaReal) YA INCLUYE el total de servicios extra cobrados en la orden (XSB).
        const importeTotal = deudaReal;
        if (importeTotal > 0) {
          logger.info(`[CTRL:ORDEN] Disparando evento ORDEN para ${CodigoOrden} (sin plan, importeTotal=${importeTotal})`);
          contabilidadService.procesarEventoContable('ORDEN', {
            OrdIdOrden: newOrderId,
            CliIdCliente: reqClientId,
            Importe: importeTotal,
            MonIdMoneda: finalMonId, // Si es pistoleo nuevo sin cobrar, finalMonId es la moneda del QR. Ojo si el QR es en pesos! Asumimos USD para simplificar.
            CodigoOrden,
            NombreTrabajo: trabajoFinal,
            UsuarioAlta
          }).catch(e => logger.error(`[CONTABILIDAD] Error en ORDEN para ${CodigoOrden}: ${e.message}`));
        }
      }
    } else {
      logger.info(`[CTRL:ORDEN] skipAccounting=true para ${CodigoOrden}, saltando contabilidad nativa para delegar a Logistica.`);
    }

    // --- NUEVO: BACKUP EN TABLAS DE COBRANZA ---
    if (!yaCobrado) {
      try {
        const ERPSyncService = require('../services/erpSyncService');
        const poolSync = await getPool();
        const targetCurrency = finalMonId === 2 ? 'USD' : 'UYU';

        // Si no está cubierto por un plan, el subtotal base es el Total del QR MENOS los servicios extra
        const baseSubtotal = tienePlan ? deudaReal : Math.max(0, deudaReal - serviciosUSD);
        const baseSubtotalOriginal = tienePlan ? costoOriginalQR : Math.max(0, costoOriginalQR - serviciosUSD);

        const detallesCobranza = [{
          OrdenID: newOrderId,
          CodArticulo: productoContabilidad.CodArticulo || '',
          ProIdProducto: productoContabilidad.ProIdProducto,
          Cantidad: cantidadDecimal,
          PrecioUnitario: cantidadDecimal > 0 ? (baseSubtotal / cantidadDecimal) : 0,
          Subtotal: baseSubtotal,
          PrecioUnitarioOriginal: cantidadDecimal > 0 ? (baseSubtotalOriginal / cantidadDecimal) : 0,
          SubtotalOriginal: baseSubtotalOriginal,
          Moneda: targetCurrency,
          MonedaOriginal: targetCurrency,
          LogPrecioAplicado: tienePlan ? 'Cubierto por Plan' : 'Ingreso Depósito',
          Perfiles: tienePlan ? 'Prepago' : 'Precio Base'
        }];

        // --- NUEVO: Inyectar líneas de servicios externos (Corte, Costura, Bordado) al detalle visual ---
        if (!yaCobrado && (importeCorteUYU > 0 || importeCosturaUYU > 0 || importeBordadoUYU > 0)) {
          try {
            const poolC = await require('../config/db.js').getPool();
            const cotRes = await poolC.request().query(`SELECT TOP 1 CotDolar FROM dbo.Cotizaciones ORDER BY CotIdCotizacion DESC`);
            const cotizacion = cotRes.recordset[0]?.CotDolar || 40;

            const agregarServicio = (importeUYU, nombre, codArticulo, proIdProducto) => {
              if (importeUYU && importeUYU > 0.01) {
                const importeUSD = Math.round((importeUYU / cotizacion) * 100) / 100;
                // Insertamos en el detalle en la moneda destino de la orden principal o forzado a USD
                const monedaServicio = targetCurrency === 'USD' ? 'USD' : 'USD';

                detallesCobranza.push({
                  OrdenID: newOrderId,
                  CodArticulo: codArticulo,
                  ProIdProducto: proIdProducto,
                  Cantidad: 1,
                  PrecioUnitario: importeUSD,
                  Subtotal: importeUSD,
                  PrecioUnitarioOriginal: importeUYU,
                  SubtotalOriginal: importeUYU,
                  Moneda: monedaServicio,
                  MonedaOriginal: 'UYU',
                  LogPrecioAplicado: `Servicio de ${nombre} (Planilla)`,
                  Perfiles: 'Servicio Adicional'
                });
              }
            };

            agregarServicio(importeCorteUYU, 'Corte', '1375', 90);
            agregarServicio(importeCosturaUYU, 'Costura', '115', 36);
            agregarServicio(importeBordadoUYU, 'Bordado', '1567', 434);
          } catch (eServicios) {
            logger.error(`[ERPSync] Error al agregar detalles de servicios a cobranza: ${eServicios.message}`);
          }
        }
        // -----------------------------------------------------------------------------------------------

        const qrData = {
          qrPedido: CodigoOrden, qrCliente: CodigoClienteQR, qrTrabajo: trabajoFinal,
          qrUrgencia: '1', qrProducto: IdProductoQR, qrCantidad: cantidadQR,
          qrImporte: costoOriginalQR, qrString: ordenString
        };

        // Fire and forget - Se guarda como Snapshot paralelo
        ERPSyncService.updatePedidosCobranza(
          poolSync, CodigoOrden, reqClientId, deudaReal, targetCurrency, detallesCobranza, '', qrData
        ).catch(e => logger.error(`[ERPSync] Error respaldando PedidosCobranza desde Ingreso: ${e.message}`));
      } catch (ePed) {
        logger.error(`[ERPSync] Error preparando backup de cobranza: ${ePed.message}`);
      }
    } else {
      logger.info(`[ERPSync] Omitiendo backup a PedidosCobranza porque ya existía registro previo (yaCobrado) para ${CodigoOrden}`);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

  } catch (err) {
    logger.error('Error al crear la orden:', err);
    res.status(500).json({ error: 'Error al crear la orden: ' + err.message });
  }
};


const getOrdenesEstado = async (req, res) => {
  const estados = req.query.estados.split(',').map(e => e.trim());

  try {
    const pool = await getPool();
    const request = pool.request();
    estados.forEach((est, index) => {
      request.input(`estado${index} `, sql.VarChar, est);
    });

    const inClause = estados.map((_, i) => `@estado${i} `).join(',');

    const query = `
SELECT
o.OrdIdOrden AS IdOrden,
  o.OrdCodigoOrden AS CodigoOrden,
    sm.SMaNombreSubMarca AS SubMarca,
      c.IDCliente AS IdCliente,
        c.TelefonoTrabajo AS Celular,
          tc.TClDescripcion AS TipoCliente,
            o.OrdNombreTrabajo AS NombreTrabajo,
              LTRIM(RTRIM(CONCAT(p.ProNombreProducto, ' ', ISNULL(p.ProDetalleProducto, '')))) AS Producto,
                eo.EOrNombreEstado AS Estado,
                  o.OrdFechaEstadoActual AS FechaEstado,
                    LTRIM(RTRIM(CONCAT(CAST(o.OrdCantidad AS NVARCHAR(50)), ' ', ISNULL(uni.UniNotación, '')))) AS Cantidad,
                      mon.MonSimbolo AS MonSimbolo,
                        CAST(ISNULL(p.ProPrecioActual, 0) AS DECIMAL(10, 2)) AS PrecioUnitario,
                          CAST(ISNULL(o.OrdCostoFinal, 0) AS DECIMAL(10, 2)) AS CostoFinal,
                            CONCAT(CAST(ISNULL(o.OrdDescuentoAplicado, 0) * 100 AS INT), '%') AS DescuentoAplicado,
                              mo.MOrNombreModo AS Modo,
                                lr.Nombre AS LugarRetiro,
                                  o.OrdFechaIngresoOrden AS FechaIngresoOrden,
                                    c.CliBloqueadoBy
      FROM OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
      LEFT JOIN TiposClientes tc WITH(NOLOCK) ON c.TClIdTipoCliente = tc.TClIdTipoCliente
      LEFT JOIN [Productos viejo react] p WITH(NOLOCK) ON o.ProIdProducto = p.ProIdProducto
      LEFT JOIN SubMarcas sm WITH(NOLOCK) ON p.SMaIdSubMarca = sm.SMaIdSubMarca
      LEFT JOIN EstadosOrdenes eo WITH(NOLOCK) ON o.OrdEstadoActual = eo.EOrIdEstadoOrden
      LEFT JOIN Monedas mon WITH(NOLOCK) ON p.MonIdMoneda = mon.MonIdMoneda
      LEFT JOIN Unidades uni WITH(NOLOCK) ON p.UniIdUnidad = uni.UniIdUnidad
      LEFT JOIN ModosOrdenes mo WITH(NOLOCK) ON o.MOrIdModoOrden = mo.MOrIdModoOrden
      LEFT JOIN FormasEnvio lr WITH(NOLOCK) ON o.LReIdLugarRetiro = lr.ID
      WHERE eo.EOrNombreEstado IN(${inClause})
    `;

    const result = await request.query(query);

    res.json(result.recordset);
  } catch (err) {
    logger.error('Error al obtener las órdenes por estados:', err);
    res.status(500).json({ error: 'Error al obtener las órdenes por estados' });
  }
};


const updateOrdenEstado = async (req, res) => {
  const { orderIds, nuevoEstado } = req.body;
  const UsuarioAlta = req.user ? req.user.id : 70;

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ error: 'No se enviaron id de ordenes.' });
  }

  let transaction;

  try {
    const pool = await getPool();

    const estadoQuery = await pool.request()
      .input('NuevoEstado', sql.NVarChar, nuevoEstado)
      .query('SELECT EOrIdEstadoOrden FROM EstadosOrdenes WITH(NOLOCK) WHERE EOrNombreEstado = @NuevoEstado');

    if (estadoQuery.recordset.length === 0) throw new Error(`Estado "${nuevoEstado}" no encontrado`);
    const estadoId = estadoQuery.recordset[0].EOrIdEstadoOrden;

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const fechaActual = new Date();

    for (const orderId of orderIds) {
      await transaction.request()
        .input('orderId', sql.Int, orderId)
        .input('estadoId', sql.Int, estadoId)
        .input('fecha', sql.DateTime, fechaActual)
        .input('usuario', sql.Int, UsuarioAlta)
        .query(`
          UPDATE OrdenesDeposito
          SET OrdEstadoActual = @estadoId,
  OrdFechaEstadoActual = @fecha
          WHERE OrdIdOrden = @orderId;

          INSERT INTO HistoricoEstadosOrdenes(OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
VALUES(@orderId, @estadoId, @fecha, @usuario);
`);

      // --- Sincronizar EstadoenArea a nivel global si pasa a Avisado (6) o Entregado (9) ---
      if (estadoId === 6 || estadoId === 9) {
          try {
              const mainOrderRes = await transaction.request()
                  .input('orderId', sql.Int, orderId)
                  .query(`
                      SELECT TOP 1 o.OrdenID 
                      FROM OrdenesDeposito od WITH(NOLOCK)
                      INNER JOIN Ordenes o WITH(NOLOCK) ON (od.OrdCodigoOrden = o.NoDocERP OR od.OrdCodigoOrden = o.CodigoOrden)
                      WHERE od.OrdIdOrden = @orderId
                  `);

              if (mainOrderRes.recordset.length > 0) {
                  const mainOrdenId = mainOrderRes.recordset[0].OrdenID;
                  const estadoStr = estadoId === 6 ? 'Avisado' : 'Entregado';
                  
                  // Requerir aquí si no estuviera al inicio, aunque está importado arriba
                  const { changeOrderState } = require('../services/stateManagerService');
                  
                  await changeOrderState(transaction, {
                      target: { type: 'ORDER', id: mainOrdenId },
                      estado: estadoStr,
                      userObj: req.user || 'Sistema',
                      detalle: `Estado sincronizado (${estadoStr})`,
                      io: req.app.get('socketio')
                  });
              }
          } catch (syncErr) {
              logger.error(`Error al sincronizar estado global para OrdenesDeposito ${orderId}:`, syncErr);
          }
      }
    }

    await transaction.commit();

    const io = req.app.get('socketio');
    if (io) io.emit('actualizado', { type: 'actualizacion' });

    // --- PUSH NOTIFICATION WEB INTEGRATION (BULK) ---
    try {
      const pushService = require('../services/pushNotificationService');
      const estadoStr = String(nuevoEstado).trim().toLowerCase();
      let pushMsg = null;

      if (estadoStr.includes('finalizado') || estadoStr.includes('pronto') || estadoStr.includes('terminado') || estadoStr === '4' || estadoStr === '7') {
        pushMsg = { title: '¡Tu pedido está listo!', body: `El pedido {code} está pronto. Ya podés crear una orden de retiro.`, url: '/portal/pickup' };
      } else if (estadoStr.includes('en camino') || estadoStr === '8') {
        pushMsg = { title: 'Pedido en camino', body: `Tu pedido {code} fue despachado y está en camino.`, url: '/portal/pickup' };
      } else if (estadoStr.includes('cancelado') || estadoStr === '10') {
        pushMsg = { title: 'Pedido cancelado', body: `Tu pedido {code} fue cancelado.`, url: '/portal/pickup' };
      }

      if (pushMsg) {
        const pool2 = await getPool();
        const orderIdsList = orderIds.map(id => `'${id}'`).join(',');
        const resPush = await pool2.request().query(`
                SELECT c.CodCliente, o.OrdCodigoOrden AS CodigoOrden
                FROM OrdenesDeposito o 
                INNER JOIN Clientes c ON o.CliIdCliente = c.CliIdCliente
                WHERE o.OrdIdOrden IN (${orderIdsList})
            `);

        for (const row of resPush.recordset) {
          if (row.CodCliente) {
            const code = row.CodigoOrden || '';
            const finalTitle = pushMsg.title.replace(/\{code\}/g, code);
            const finalBody = pushMsg.body.replace(/\{code\}/g, code);
            pushService.sendToClient(row.CodCliente, {
              title: finalTitle, body: finalBody, url: pushMsg.url
            }).catch(e => logger.error('[WebPush] Error envío push:', e.message));
          }
        }
      }
    } catch (pushErr) {
      logger.error('[WebPush] Hubo un error procesando notificaciones masivas:', pushErr.message);
    }
    // ------------------------------------------

    res.status(200).json({ message: 'Órdenes actualizadas al nuevo estado' });
  } catch (err) {
    logger.error('Error al actualizar el estado de las órdenes:', err);

    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) { }
    }

    res.status(500).json({ error: 'Error al actualizar el estado de las órdenes' });
  }
};


const getOrdenesClienteByOrden = async (req, res) => {
  const { idOrden } = req.params;

  try {
    const pool = await getPool();

    // First find the client for this order
    const clientOrder = await pool.request()
      .input('OrderCode', sql.VarChar, idOrden)
      .query('SELECT CliIdCliente FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdCodigoOrden = @OrderCode');

    if (clientOrder.recordset.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    const cliIdCliente = clientOrder.recordset[0].CliIdCliente;

    // Then find orders for this client which are in state 1 or 6
    const query = `
SELECT
o.OrdIdOrden,
  o.OrdCodigoOrden,
  o.OrdNombreTrabajo,
  o.OrdCantidad,
  CASE WHEN o.PagIdPago IS NOT NULL THEN 1 ELSE 0 END AS OrdPagoRealizado,
    eo.EOrNombreEstado,
    c.IDCliente,
    c.TelefonoTrabajo,
    c.CliNombreApellido,
    c.LocalidadID,
    c.CliDireccion,
    c.CliAgencia,
    tc.TClDescripcion AS TipoCliente,
      mon.MonSimbolo,
      o.OrdCostoFinal,
      o.OrdFechaIngresoOrden,
      LTRIM(RTRIM(CONCAT(p.ProNombreProducto, ' ', ISNULL(p.ProDetalleProducto, '')))) AS Producto,
        sm.SMaNombreSubMarca AS SubMarca
      FROM OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN Clientes c ON o.CliIdCliente = c.CliIdCliente
      LEFT JOIN EstadosOrdenes eo ON o.OrdEstadoActual = eo.EOrIdEstadoOrden
      LEFT JOIN Monedas mon ON o.MonIdMoneda = mon.MonIdMoneda
      LEFT JOIN TiposClientes tc ON c.TClIdTipoCliente = tc.TClIdTipoCliente
      LEFT JOIN [Productos viejo react] p ON o.ProIdProducto = p.ProIdProducto
      LEFT JOIN SubMarcas sm ON p.SMaIdSubMarca = sm.SMaIdSubMarca
      WHERE o.CliIdCliente = @CliIdCliente AND(o.OrdEstadoActual = 1 OR o.OrdEstadoActual = 6)
  `;

    const result = await pool.request()
      .input('CliIdCliente', sql.Int, cliIdCliente)
      .query(query);

    res.json(result.recordset);

  } catch (err) {
    logger.error('Error al obtener las órdenes por cliente:', err);
    res.status(500).json({ error: 'Error al obtener las órdenes por cliente' });
  }
};


const getEstadosOrdenes = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
        SELECT EOrIdEstadoOrden, EOrNombreEstado
        FROM EstadosOrdenes WITH(NOLOCK)
        ORDER BY EOrIdEstadoOrden
  `);

    res.json(result.recordset);
  } catch (err) {
    logger.error('Error al obtener estados de órdenes:', err);
    res.status(500).json({ error: 'Error al obtener estados de órdenes' });
  }
};


const updateExportacion = async (req, res) => {
  const { orderIds } = req.body;

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ message: 'No se enviaron órdenes para actualizar.' });
  }

  try {
    const pool = await getPool();
    await pool.request().query(`
      UPDATE OrdenesDeposito
      SET OrdExportadoOdoo = 1
      WHERE OrdIdOrden IN(${orderIds.join(',')})
    `);

    const io = req.app.get('socketio');
    if (io) io.emit('actualizado', { type: 'actualizacion' });

    res.json({ message: 'Órdenes actualizadas correctamente.' });
  } catch (error) {
    logger.error('Error al actualizar las órdenes exportadas:', error);
    res.status(500).json({ message: 'Error al actualizar las órdenes exportadas.' });
  }
};


const eliminarOrdenes = async (req, res) => {
  const { orderIds } = req.body;
  let transaction;

  try {
    if (!orderIds || orderIds.length === 0) {
      return res.status(400).json({ message: "No se proporcionaron órdenes para eliminar." });
    }

    const orderIdsList = orderIds.map(id => `'${id}'`).join(',');
    const pool = await getPool();

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    await transaction.request()
      .query(`DELETE FROM RelOrdenesRetiroOrdenes WHERE OrdIdOrden IN(${orderIdsList})`);

    await transaction.request()
      .query(`DELETE FROM OrdenesDeposito WHERE OrdIdOrden IN(${orderIdsList})`);

    await transaction.commit();

    const io = req.app.get('socketio');
    if (io) io.emit("actualizado", { type: "eliminacion" });

    res.status(200).json({ message: "Órdenes eliminadas correctamente" });
  } catch (err) {
    logger.error("Error al eliminar órdenes:", err);

    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) { }
    }

    res.status(500).json({ error: "Error al eliminar las órdenes" });
  }
};

const getModosOrdenes = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT MOrIdModoOrden, MOrNombreModo FROM ModosOrdenes WITH(NOLOCK)');
    res.json(result.recordset);
  } catch (err) {
    logger.error('Error al obtener los modos de órdenes:', err);
    res.status(500).json({ error: 'Error al obtener los modos de órdenes' });
  }
};

const parseQROrden = async (req, res) => {
  const { ordenString } = req.body;

  if (!ordenString) {
    return res.status(400).json({ valid: false, error: 'Código vacío.' });
  }

  try {
    const parts = ordenString.trim().split('$*');
    if (parts.length !== 7 || parts.some(p => p.trim() === '')) {
      return res.status(400).json({ valid: false, error: 'Código inválido o malformado. Faltan datos o campos vacíos (Se esperan 7).' });
    }

    const [CodigoOrden, CodigoClienteQR, NombreTrabajo, IdModo, IdProductoQR, Cantidad, CostoFinal] = parts;

    const pool = await getPool();

    // Buscar Cliente Validado por su Helper
    const clienteData = await getClientePorIDReact(pool, CodigoClienteQR);

    if (!clienteData) {
      return res.status(404).json({ valid: false, error: 'Cliente Web (IDReact) no encontrado en base local.' });
    }

    // Buscar Producto Validado por su Helper
    const productoData = await getProductoPorIDReact(pool, IdProductoQR);

    if (!productoData) {
      return res.status(404).json({ valid: false, error: 'Producto Web (IDProdReact) no encontrado en base local.' });
    }

    // Para órdenes externas (XSB, XDF, XMD, XIMD, IMD): consultar Sheets para obtener el material real
    let materialSheets = null;
    let cantidadSheets = null;
    const esOrdenExterna = ordenesExternasSvc.esOrdenExterna(CodigoOrden);
    if (esOrdenExterna) {
      try {
        const datosSheets = await ordenesExternasSvc.getDatosDesdeSheets(CodigoOrden);
        if (datosSheets) {
          materialSheets = datosSheets.material || null;   // ej: "Jacquard Elite 1,83"
          cantidadSheets = datosSheets.cantidad || null;   // cantidad real desde Sheets
        }
      } catch (errSheets) {
        logger.warn(`[PARSE-QR] No se pudo obtener material de Sheets para ${CodigoOrden}: ${errSheets.message}`);
      }
    }

    return res.json({
      valid: true,
      data: {
        CodigoOrden,
        CodigoCliente: clienteData.Nombre ? String(clienteData.Nombre).trim() : clienteData.CliIdCliente,
        IDCliente: clienteData.IDCliente ? String(clienteData.IDCliente).trim() : 'N/A',
        TipoCliente: clienteData.TipoCliente ? String(clienteData.TipoCliente).trim() : 'N/A',
        NombreTrabajo,
        IdModo,
        IdProducto: productoData.ProIdProducto,
        ProductoNombre: productoData.ProductoNombre || 'Sin nombre',
        Cantidad: parseFloat(Cantidad?.toString()?.replace(',', '.') || 0),
        CostoFinal: parseFloat(CostoFinal?.toString()?.replace(',', '.') || 0),
        Moneda: productoData.MonSimbolo || '$U',
        // Datos de Sheets (para órdenes externas: XSB, XDF, XMD, XIMD, IMD)
        MaterialSheets: materialSheets,    // nombre de la tela desde la planilla
        CantidadSheets: cantidadSheets,    // metros reales desde la planilla
        EsOrdenExterna: esOrdenExterna,
      }
    });

  } catch (err) {
    logger.error('Error en parseQROrden:', err);
    return res.status(500).json({ valid: false, error: 'Error interno validando: ' + err.message });
  }
};


const updatePhoneAndResendWsp = async (req, res) => {
  const { ordId, nuevoTelefono } = req.body;
  if (!ordId || !nuevoTelefono) return res.status(400).json({ error: 'Faltan parámetros' });
  try {
    const pool = await getPool();
    // 1. Obtener cliente de la orden
    const ordCheck = await pool.request().input('id', sql.Int, ordId).query('SELECT CliIdCliente FROM OrdenesDeposito WHERE OrdIdOrden = @id');
    if (ordCheck.recordset.length === 0) return res.status(404).json({ error: 'Orden no encontrada' });
    const cliId = ordCheck.recordset[0].CliIdCliente;

    // 2. Actualizar el teléfono del cliente a nivel global
    await pool.request()
      .input('CliIdCliente', sql.Int, cliId)
      .input('NuevoTelefono', sql.VarChar(50), String(nuevoTelefono).trim().substring(0, 50))
      .query('UPDATE Clientes SET TelefonoTrabajo = @NuevoTelefono WHERE CliIdCliente = @CliIdCliente');

    // 3. Resetear el flag de la orden para que el CronJob la recoja nuevamente
    // NOTA: ESTADO_POR_AVISAR normalmente es 1. Lo pasamos a 1 para asegurar que el cron lo levante.
    await pool.request()
      .input('id', sql.Int, ordId)
      .query('UPDATE OrdenesDeposito SET OrdAvisoWsp = 0, OrdFechaAvisoWsp = NULL, OrdEstadoActual = 1 WHERE OrdIdOrden = @id');

    res.json({ success: true, message: 'Teléfono actualizado. La orden fue reenviada a la cola de avisos.' });
  } catch (err) {
    logger.error('Error en updatePhoneAndResendWsp:', err);
    res.status(500).json({ error: 'Falla interna del servidor.' });
  }
};

const getPendingWspOrders = async (req, res) => {
  try {
    const pool = await getPool();
    const query = `
      SELECT
        Ord.OrdIdOrden AS idOrden,
        Ord.OrdCodigoOrden AS CodigoOrden,
        Cli.Nombre AS NombreCliente,
        Cli.CliIdCliente,
        Cli.IDCliente,
        Cli.TelefonoTrabajo,
        Tc.TClDescripcion AS TipoCliente,
        Ord.OrdNombreTrabajo AS NombreTrabajo,
        LTRIM(RTRIM(Pro.Descripcion)) AS ProductoNombre,
        Pro.ProIdProducto,
        Ord.OrdCantidad AS Cantidad,
        Ord.MOrIdModoOrden AS IdModo,
        Mon.MonSimbolo AS Moneda,
        Ord.OrdCostoFinal AS CostoFinal
      FROM OrdenesDeposito Ord WITH (NOLOCK)
      LEFT JOIN Clientes Cli WITH (NOLOCK) ON Cli.CliIdCliente = Ord.CliIdCliente
      LEFT JOIN TiposClientes Tc WITH (NOLOCK) ON Tc.TClIdTipoCliente = Cli.TClIdTipoCliente
      LEFT JOIN Articulos Pro WITH (NOLOCK) ON Pro.ProIdProducto = Ord.ProIdProducto
      LEFT JOIN Monedas Mon WITH (NOLOCK) ON Mon.MonIdMoneda = Ord.MonIdMoneda
      WHERE (Ord.OrdEstadoActual IN (1, 6, 12))
        AND ISNULL(Ord.OrdAvisoWsp, 0) = 0
      ORDER BY Ord.OrdIdOrden DESC
    `;
    const result = await pool.request().query(query);

    const { normalizePhone } = require('../jobs/wspAvisos.job');

    // Map rows to match the frontend expectations for pending items
    const parsedData = result.recordset.map(r => {
      const ph = normalizePhone(r.TelefonoTrabajo);
      const hasPhoneError = !ph;

      return {
        idOrden: r.idOrden,
        CodigoOrden: r.CodigoOrden,
        CodigoCliente: r.NombreCliente ? String(r.NombreCliente).trim() : r.CliIdCliente,
        IDCliente: r.IDCliente ? String(r.IDCliente).trim() : 'N/A',
        TipoCliente: r.TipoCliente ? String(r.TipoCliente).trim() : 'N/A',
        NombreTrabajo: r.NombreTrabajo,
        IdModo: r.IdModo,
        IdProducto: r.ProIdProducto,
        ProductoNombre: r.ProductoNombre || 'Sin nombre',
        Cantidad: r.Cantidad,
        CostoFinal: r.CostoFinal,
        Moneda: r.Moneda || '$U',
        hasPhoneError: hasPhoneError
      };
    });

    res.json(parsedData);
  } catch (err) {
    logger.error('Error en getPendingWspOrders:', err);
    res.status(500).json({ error: 'Falla interna del servidor.' });
  }
};


const omitirWsp = async (req, res) => {
  const { ordId } = req.body;
  if (!ordId) return res.status(400).json({ error: 'Falta ordId.' });
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, ordId)
      .query(`
        UPDATE OrdenesDeposito
        SET OrdAvisoWsp = 1,
            OrdFechaAvisoWsp = GETDATE(),
            OrdEstadoActual = 6
        WHERE OrdIdOrden = @id
      `);

    try {
        const mainOrderRes = await pool.request()
            .input('id', sql.Int, ordId)
            .query(`
                SELECT TOP 1 o.OrdenID 
                FROM OrdenesDeposito od WITH(NOLOCK)
                INNER JOIN Ordenes o WITH(NOLOCK) ON (od.OrdCodigoOrden = o.NoDocERP OR od.OrdCodigoOrden = o.CodigoOrden)
                WHERE od.OrdIdOrden = @id
            `);
            
        if (mainOrderRes.recordset.length > 0) {
            const mainOrdenId = mainOrderRes.recordset[0].OrdenID;
            const { changeOrderState } = require('../services/stateManagerService');
            
            // Note: omitirWsp doesn't use a transaction, so we pass pool instead of transaction.
            await changeOrderState(pool, {
                target: { type: 'ORDER', id: mainOrdenId },
                estado: 'Avisado',
                userObj: req.user || 'Sistema',
                detalle: 'Estado global sincronizado (Omitir envío WSP)',
                io: req.app.get('socketio')
            });
        }
    } catch (syncErr) {
        logger.error(`Error al sincronizar estado global a Avisado en omitirWsp para OrdId ${ordId}:`, syncErr);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Error en omitirWsp:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getOrdenesByFilter, createOrden, getOrdenByCodigo, getOrdenesClienteByOrden, getOrdenesEstado, updateOrdenEstado, getEstadosOrdenes, updateExportacion, eliminarOrdenes, getModosOrdenes, parseQROrden, updatePhoneAndResendWsp, getPendingWspOrders, omitirWsp };
