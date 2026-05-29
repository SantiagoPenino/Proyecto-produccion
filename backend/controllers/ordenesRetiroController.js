const { getPool, sql } = require('../config/db');
const moment = require('moment-timezone');
const { crearRetiro, marcarEntregado } = require('../services/retiroService');
const logger = require('../utils/logger');

const createOrdenRetiro = async (req, res) => {
  const { orders, totalCost, lugarRetiro, direccion, departamento, localidad, agenciaId } = req.body;
  const UsuarioAlta = req.user?.id || 70;

  if (!orders || orders.length === 0) {
    return res.status(400).json({ error: 'No se proporcionaron órdenes válidas.' });
  }

  const pool = await getPool();
  let transaction;

  try {
    // Resolver orderNumbers → ordIds
    const orderReq = pool.request();
    orders.forEach((order, i) => {
      orderReq.input(`code${i}`, sql.VarChar, order.orderNumber);
    });
    const orderIdResults = await orderReq.query(`
      SELECT OrdIdOrden, MonIdMoneda FROM OrdenesDeposito WITH(NOLOCK) 
      WHERE OrdCodigoOrden IN (${orders.map((_, i) => `@code${i}`).join(',')})
    `);

    if (orderIdResults.recordset.length === 0) {
      throw new Error('No se encontraron órdenes para los códigos proporcionados.');
    }

    const ordIds = orderIdResults.recordset.map(r => r.OrdIdOrden);

    // Determinar la moneda: si alguna sub-orden está en dólares (2), todo el retiro queda dolarizado ('USD'), si no en pesos ('UYU').
    let monedaFuerte = 'UYU'; // Default
    if (orderIdResults.recordset.some(r => parseInt(r.MonIdMoneda, 10) === 2)) {
      monedaFuerte = 'USD';
    }

    // Crear retiro usando servicio unificado (el service determina el estado por tipo de cliente)
    transaction = await pool.transaction();
    await transaction.begin();

    const OReIdOrdenRetiro = await crearRetiro(transaction, {
      ordIds, totalCost, lugarRetiro,
      usuarioAlta: UsuarioAlta,
      formaRetiro: 'RL',
      moneda: monedaFuerte,
      direccion, departamento, localidad, agenciaId
    });

    await transaction.commit();

    const io = req.app.get('socketio');
    if (io) {
      io.emit('actualizado', { type: 'actualizacion' });
      io.emit('retiros:update', { type: 'nuevo_retiro', ordenId: OReIdOrdenRetiro, formaRetiro: 'RL' }); // Nuevo retiro creado
    }

    res.status(201).json({
      message: 'Orden de retiro creada correctamente y órdenes actualizadas',
      OReIdOrdenRetiro,
    });
  } catch (err) {
    if (transaction) {
      try { await transaction.rollback(); } catch (e) { }
    }
    logger.error('Error al crear la orden de retiro:', err);
    res.status(500).json({ error: 'Error al crear la orden de retiro' });
  }
};

const getOrdenesRetiroQueryBase = `
  SELECT 
    r.OReIdOrdenRetiro,
    r.OReCostoTotalOrden,
    r.OReFechaAlta,
    r.OReUsuarioAlta,
    r.OReEstadoActual,
    r.PagIdPago,
    r.ORePasarPorCaja,
    r.FormaRetiro,
    COALESCE(fe.Nombre, 
        CASE WHEN LEN(ISNULL(r.DireccionEnvio, '')) > 0 
               OR r.AgenciaEnvio IS NOT NULL 
               OR LEN(ISNULL(r.AgenciaOtra, '')) > 0 
             THEN 'Envío / Encomienda' 
             ELSE 'Retiro en el Local' 
        END
    ) AS lugarRetiro,
    er.EORNombreEstado AS estado,
    o.OrdIdOrden AS orderId,
    o.OrdCodigoOrden AS orderNumber,
    o.OrdEstadoActual AS orderEstado,
    eo.EOrNombreEstado AS orderEstadoNombre,
    o.OrdCostoFinal as costoFinal,
    o.OrdCantidad AS orderCantidad,
    o.MonIdMoneda AS orderMonedaId,
    monOrden.MonSimbolo AS orderMonedaSimbolo,
    p.MPaIdMetodoPago AS orderIdMetodoPago,
    mp.MPaDescripcionMetodo AS orderMetodoPago,
    monPago.MonSimbolo AS monetPagoSimbolo,
    p.PagMontoPago AS orderMontoPago,
    p.PagFechaPago AS orderFechaPago,
    p.PagRutaComprobante AS comprobante,
    COALESCE(c.IDCliente, cr.IDCliente) AS CliCodigoCliente,
    COALESCE(LTRIM(RTRIM(c.Nombre)), LTRIM(RTRIM(cr.Nombre))) AS CliNombre,
    COALESCE(LTRIM(RTRIM(c.TelefonoTrabajo)), LTRIM(RTRIM(cr.TelefonoTrabajo))) AS CliTelefono,
    COALESCE(tc.TClDescripcion, tcr.TClDescripcion) AS TClDescripcion,
    COALESCE(tc.TClIdTipoCliente, tcr.TClIdTipoCliente) AS TClIdTipoCliente,
    COALESCE(c.CliIdCliente, cr.CliIdCliente) AS CliIdCliente,
    COALESCE(LTRIM(RTRIM(c.CioRuc)), LTRIM(RTRIM(cr.CioRuc))) AS CliRuc,
    COALESCE(LTRIM(RTRIM(c.Email)), LTRIM(RTRIM(cr.Email))) AS CliEmail,
    COALESCE(LTRIM(RTRIM(c.DireccionTrabajo)), LTRIM(RTRIM(cr.DireccionTrabajo))) AS CliDireccion,
    r.DireccionEnvio,
    r.DepartamentoEnvio,
    r.LocalidadEnvio,
    ag.Nombre AS AgenciaNombre,
    r.AgenciaOtra,
    r.ReceptorNombre,
    r.LReIdLugarRetiro,
    (SELECT TOP 1 b.ComprobantePath FROM Logistica_Bultos b WITH(NOLOCK) WHERE b.OrdenID = r.OReIdOrdenRetiro AND b.ComprobantePath IS NOT NULL ORDER BY b.BultoID DESC) AS comprobanteEntrega,
    art.Descripcion AS articuloDescripcion,
    o.OrdNombreTrabajo AS orderNombreTrabajo
  FROM OrdenesRetiro r WITH(NOLOCK)
  LEFT JOIN FormasEnvio fe WITH(NOLOCK) ON fe.ID = r.LReIdLugarRetiro
  LEFT JOIN EstadosOrdenesRetiro er WITH(NOLOCK) ON er.EORIdEstadoOrden = r.OReEstadoActual
  LEFT JOIN OrdenesDeposito o WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
  LEFT JOIN Monedas monOrden WITH(NOLOCK) ON monOrden.MonIdMoneda = o.MonIdMoneda
  LEFT JOIN Pagos p WITH(NOLOCK) ON p.PagIdPago = o.PagIdPago
  LEFT JOIN Monedas monPago WITH(NOLOCK) ON monPago.MonIdMoneda = p.PagIdMonedaPago
  LEFT JOIN MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
  LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
  LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
  LEFT JOIN Clientes cr WITH(NOLOCK) ON cr.CodCliente = r.CodCliente
  LEFT JOIN TiposClientes tcr WITH(NOLOCK) ON tcr.TClIdTipoCliente = cr.TClIdTipoCliente
  LEFT JOIN Agencias ag WITH(NOLOCK) ON ag.ID = r.AgenciaEnvio
  LEFT JOIN EstadosOrdenes eo WITH(NOLOCK) ON eo.EOrIdEstadoOrden = o.OrdEstadoActual
  LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = o.ProIdProducto
`;

const processRetirosRows = (rows) => {
  const map = {};
  for (const row of rows) {
    if (!map[row.OReIdOrdenRetiro]) {
      map[row.OReIdOrdenRetiro] = {
        ordenDeRetiro: `${row.FormaRetiro || 'R'}-${row.OReIdOrdenRetiro}`,
        totalCost: parseFloat(row.OReCostoTotalOrden).toFixed(2),
        lugarRetiro: row.lugarRetiro || 'Retiro en el Local',
        fechaAlta: row.OReFechaAlta,
        usuarioAlta: row.OReUsuarioAlta,
        estado: row.estado || 'Desconocido',
        OReEstadoActual: row.OReEstadoActual,
        pagorealizado: row.PagIdPago ? 1 : 0,
        metodoPago: row.orderMetodoPago,
        montopagorealizado: row.PagIdPago ? `${row.monetPagoSimbolo || ''} ${parseFloat(row.orderMontoPago || 0).toFixed(2)}` : null,
        fechapagooden: row.orderFechaPago,
        comprobante: row.comprobante,
        CliCodigoCliente: row.CliCodigoCliente || 'Desconocido',
        CliNombre: row.CliNombre || null,
        CliTelefono: row.CliTelefono || null,
        CliRuc: row.CliRuc || null,
        CliEmail: row.CliEmail || null,
        CliDireccion: row.CliDireccion || null,
        TClDescripcion: row.TClDescripcion || 'Desconocido',
        TClIdTipoCliente: row.TClIdTipoCliente,
        CliIdCliente: row.CliIdCliente || null,
        direccionEnvio: row.DireccionEnvio || null,
        departamentoEnvio: row.DepartamentoEnvio || null,
        localidadEnvio: row.LocalidadEnvio || null,
        agenciaNombre: row.AgenciaNombre || row.AgenciaOtra || null,
        receptorNombre: row.ReceptorNombre || null,
        formaEnvioId: row.LReIdLugarRetiro || null,
        comprobanteEntrega: row.comprobanteEntrega || null,
        orders: []
      };
    }

    if (row.orderId) {
      map[row.OReIdOrdenRetiro].orders.push({
        orderNumber: row.orderNumber,
        orderId: row.orderId,
        orderNombreTrabajo: row.orderNombreTrabajo || null,
        orderMaterial: row.articuloDescripcion ? row.articuloDescripcion.trim() : null,
        orderEstado: row.orderEstadoNombre || row.orderEstado,
        orderCosto: row.costoFinal != null ? `${row.orderMonedaId === 2 ? 'US$' : '$'} ${parseFloat(row.costoFinal).toFixed(2)}` : null,
        orderCantidad: row.orderCantidad != null ? parseFloat(row.orderCantidad) : null,
        simbolo: row.orderMonedaId === 2 ? 'US$' : '$',
        monedaId: row.orderMonedaId || 1,
        orderIdMetodoPago: row.orderIdMetodoPago,
        orderMetodoPago: row.orderMetodoPago,
        orderPago: row.monetPagoSimbolo ? `${row.monetPagoSimbolo} ${parseFloat(row.orderMontoPago).toFixed(2)}` : null,
        orderFechaPago: row.orderFechaPago,
        articuloDescripcion: row.articuloDescripcion ? row.articuloDescripcion.trim() : null
      });
    }
  }
  return Object.values(map);
};

const getOrdenesRetiroPorEstados = async (req, res) => {
  const estados = req.query.estados.split(',');
  const soloPageas = req.query.pagas === 'true';
  const soloNoPageas = req.query.no_pagas === 'true';
  const fechaFiltro = req.query.date || null; // formato YYYY-MM-DD

  try {
    const pool = await getPool();
    const request = pool.request();

    estados.forEach((e, i) => request.input(`e${i}`, sql.Int, parseInt(e.trim(), 10)));
    const inClause = estados.map((_, i) => `@e${i}`).join(',');

    let pagoFiltro = '';
    if (soloPageas) pagoFiltro = 'AND r.PagIdPago IS NOT NULL';
    if (soloNoPageas) pagoFiltro = 'AND r.PagIdPago IS NULL';

    let dateFiltro = '';
    if (fechaFiltro) {
      request.input('FechaFiltro', sql.Date, fechaFiltro);
      dateFiltro = 'AND CAST(r.OReFechaEstadoActual AS DATE) = @FechaFiltro';
    }

    const query = `
      ${getOrdenesRetiroQueryBase}
      WHERE r.OReEstadoActual IN (${inClause})
      AND (CAST(DATEADD(d,-3,GETDATE()) AS DATE) <= CAST(r.OReFechaAlta AS DATE) OR r.OReEstadoActual NOT IN (5,6,8))
      ${pagoFiltro}
      ${dateFiltro}
    `;

    const result = await request.query(query);
    res.json(processRetirosRows(result.recordset));
  } catch (err) {
    logger.error('Error al obtener las órdenes de retiro:', err);
    res.status(500).json({ error: 'Error' });
  }
};


const actualizarOrdenRetiroEstado = async (req, res) => {
  const { ordenDeRetiro, nuevoEstado } = req.body;
  const fechaActual = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
  const UsuarioAlta = req.user?.id || 70;

  let transaction;
  try {
    const OReIdOrdenRetiro = parseInt(ordenDeRetiro.replace('R-', ''), 10);
    const pool = await getPool();

    const estRes = await pool.request().input('Est', sql.VarChar, nuevoEstado).query('SELECT EORIdEstadoOrden FROM EstadosOrdenesRetiro WITH(NOLOCK) WHERE EORNombreEstado = @Est');
    if (estRes.recordset.length === 0) throw new Error('Estado no encontrado');
    const estadoId = estRes.recordset[0].EORIdEstadoOrden;

    transaction = await pool.transaction();
    await transaction.begin();

    await transaction.request()
      .input('ID', sql.Int, OReIdOrdenRetiro).input('EstID', sql.Int, estadoId).input('Fec', sql.DateTime, new Date(fechaActual)).input('Usr', sql.Int, UsuarioAlta)
      .query(`
        UPDATE OrdenesRetiro SET OReEstadoActual = @EstID, OReFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
        INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@ID, @EstID, @Fec, @Usr);
      `);

    await transaction.commit();
    res.status(200).json({ message: 'Órden de retiro actualizada' });
    req.app.get('socketio')?.emit('actualizado', { type: 'actualizacion' });
    req.app.get('socketio')?.emit('retiros:update', { type: 'estado' });
  } catch (err) {
    if (transaction) try { await transaction.rollback(); } catch (e) { }
    res.status(500).json({ error: err.message });
  }
};

const marcarOrdenRetiroPronto = async (req, res) => {
  const { ordenDeRetiro, scannedValues } = req.body;
  const fechaActual = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
  const UsuarioAlta = req.user?.id || 70;

  let transaction;
  try {
    const OReIdOrdenRetiro = parseInt(ordenDeRetiro.replace('R-', ''), 10);
    const pool = await getPool();

    transaction = await pool.transaction();
    await transaction.begin();

    // Parametrizar scannedValues para evitar SQL injection
    const scanReq = transaction.request();
    scanReq.input('Fec', sql.DateTime, new Date(fechaActual));
    scanReq.input('Usr', sql.Int, UsuarioAlta);
    scannedValues.forEach((v, i) => {
      scanReq.input(`sv${i}`, sql.VarChar, v.trim());
    });
    const inParams = scannedValues.map((_, i) => `@sv${i}`).join(',');

    await scanReq.query(`
      INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      SELECT OrdIdOrden, 7, @Fec, @Usr
      FROM OrdenesDeposito WHERE OrdCodigoOrden IN (${inParams});
      
      UPDATE OrdenesDeposito SET OrdEstadoActual = 7, OrdFechaEstadoActual = @Fec WHERE OrdCodigoOrden IN (${inParams});
    `);

    const retRes = await transaction.request().input('ID', sql.Int, OReIdOrdenRetiro).query('SELECT OReEstadoActual FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID');
    if (retRes.recordset.length > 0) {
      const nuevoEstado = retRes.recordset[0].OReEstadoActual === 1 ? 7 : 8;
      await transaction.request()
        .input('ID', sql.Int, OReIdOrdenRetiro).input('EstID', sql.Int, nuevoEstado).input('Fec', sql.DateTime, new Date(fechaActual)).input('Usr', sql.Int, UsuarioAlta)
        .query(`
          UPDATE OrdenesRetiro SET OReEstadoActual = @EstID, OReFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
          INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@ID, @EstID, @Fec, @Usr);
        `);
    }

    await transaction.commit();
    res.status(200).json({ message: 'Órdenes escaneadas marcadas como Pronto y orden de retiro actualizada' });
    req.app.get('socketio')?.emit('actualizado', { type: 'actualizacion' });
    req.app.get('socketio')?.emit('retiros:update', { type: 'estado' });
  } catch (err) {
    if (transaction) try { await transaction.rollback(); } catch (e) { }
    res.status(500).json({ error: err.message });
  }
};

const ordenesRetiroCaja = async (req, res) => {
  try {
    const pool = await getPool();
    const request = pool.request();

    // Filtro opcional por tipo de cliente (enviado desde el frontend)
    // Por defecto: SIN filtro de tipo → muestra todos (semanales, rollos, comunes)
    const { tipoCliente } = req.query;
    let filtroTipo = '';
    if (tipoCliente && tipoCliente !== 'todos') {
      request.input('TipoCliente', sql.Int, parseInt(tipoCliente, 10));
      filtroTipo = 'AND COALESCE(tc.TClIdTipoCliente, tcr.TClIdTipoCliente) = @TipoCliente';
    }

    // Solo mostrar retiros que tienen al menos una sub-orden sin pagar
    // y que no estén cancelados (6)
    const query = `
      ${getOrdenesRetiroQueryBase}
      WHERE r.OReEstadoActual NOT IN (6)
      AND r.PagIdPago IS NULL
      AND EXISTS (
        SELECT 1 FROM OrdenesDeposito od2 WITH(NOLOCK)
        WHERE od2.OReIdOrdenRetiro = r.OReIdOrdenRetiro
        AND od2.PagIdPago IS NULL
      )
      ${filtroTipo}
    `;
    const result = await request.query(query);
    res.status(200).json(processRetirosRows(result.recordset));
  } catch (err) {
    logger.error('[CAJA ERROR]', err);
    res.status(500).json({ error: err.message });
  }
};



const marcarOrdenRetiroEntregado = async (req, res) => {
  const { ordenDeRetiro } = req.body;
  const fechaActual = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
  const UsuarioAlta = req.user?.id || 70;

  let transaction;
  try {
    const OReIdOrdenRetiro = parseInt(ordenDeRetiro.replace('R-', ''), 10);
    const pool = await getPool();

    transaction = await pool.transaction();
    await transaction.begin();

    await marcarEntregado(transaction, OReIdOrdenRetiro, new Date(fechaActual), UsuarioAlta);

    await transaction.commit();
    res.status(200).json({ message: 'Entregadas' });
    req.app.get('socketio')?.emit('actualizado', { type: 'actualizacion' });
    req.app.get('socketio')?.emit('retiros:update', { type: 'estado' });
  } catch (err) {
    if (transaction) try { await transaction.rollback(); } catch (e) { }
    res.status(500).json({ error: err.message });
  }
};

const getOrdenesRetiroPasarPorCaja = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`${getOrdenesRetiroQueryBase} WHERE r.ORePasarPorCaja = 1`);
    res.status(200).json(processRetirosRows(result.recordset));
  } catch (err) {
    logger.error('[PASAR CAJA ERROR]', err);
    res.status(500).json({ error: err.message });
  }
};

const ordenesRetiroMarcarPasarPorCaja = async (req, res) => {
  const { ordenDeRetiro } = req.body;
  const pasarPorCaja = req.params.pasar === '1';
  let transaction;
  try {
    const OReIdOrdenRetiro = parseInt(ordenDeRetiro.replace('R-', ''), 10);
    const pool = await getPool();

    transaction = await pool.transaction();
    await transaction.begin();

    await transaction.request()
      .input('ID', sql.Int, OReIdOrdenRetiro).input('Pasar', sql.Bit, pasarPorCaja)
      .query('UPDATE OrdenesRetiro SET ORePasarPorCaja = @Pasar WHERE OReIdOrdenRetiro = @ID');

    await transaction.commit();
    res.status(200).json({ message: 'Exito' });
    req.app.get('socketio')?.emit('actualizado', { type: 'actualizacion' });
    req.app.get('socketio')?.emit('retiros:update', { type: 'estado' });
  } catch (err) {
    if (transaction) try { await transaction.rollback(); } catch (e) { }
    res.status(500).json({ error: err.message });
  }
};

const getOrdenesRetiroPorFecha = async (req, res) => {
  try {
    const pool = await getPool();
    const request = pool.request();
    let queryCond = [];

    if (req.query.date) {
      request.input('Fecha', sql.Date, req.query.date);
      queryCond.push('CAST(r.OReFechaAlta AS DATE) = @Fecha');
    }
    if (req.query.codigo) {
      request.input('Codigo', sql.Int, req.query.codigo);
      queryCond.push('r.OReIdOrdenRetiro = @Codigo');
    }

    const whereClause = queryCond.length > 0 ? 'WHERE ' + queryCond.join(' AND ') : '';
    const query = `${getOrdenesRetiroQueryBase} ${whereClause}`;

    const result = await request.query(query);
    res.json(processRetirosRows(result.recordset));
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
};

const getOrdenesRetiroPorLugar = async (req, res) => {
  const { lugarId } = req.params;
  const { pagas, no_pagas } = req.query; // Filtros opcionales
  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('LugarId', sql.Int, parseInt(lugarId, 10));

    let query = `
      ${getOrdenesRetiroQueryBase}
      WHERE r.LReIdLugarRetiro = @LugarId
      AND r.OReEstadoActual NOT IN (5, 6, 10)
    `;

    // FIX: filtro no_pagas usa NOT EXISTS para evitar falsos positivos con LEFT JOIN
    if (pagas === 'true') {
      // Retiro con pago registrado a nivel de cabecera o pagado por plan (PagIdPago = 0)
      query += ` AND (r.PagIdPago = 0 OR EXISTS (SELECT 1 FROM Pagos px WHERE px.PagIdPago = r.PagIdPago))`;
    } else if (no_pagas === 'true') {
      // Retiro SIN ningún pago en cabecera ni en ninguna de sus hijas
      query += `
        AND (r.PagIdPago IS NULL OR (r.PagIdPago != 0 AND NOT EXISTS (SELECT 1 FROM Pagos px WHERE px.PagIdPago = r.PagIdPago)))
        AND NOT EXISTS (
          SELECT 1 FROM OrdenesDeposito od
          INNER JOIN Pagos px2 ON px2.PagIdPago = od.PagIdPago
          WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro
        )
      `;
    }

    const result = await request.query(query);
    res.json(processRetirosRows(result.recordset));
  } catch (err) {
    logger.error('[DESPACHOS LUGAR] Error:', err);
    res.status(500).json({ error: 'Error al cargar despachos' });
  }
};

const marcarDespachoEntregadoAutorizado = async (req, res) => {
  const { ordenesParaEntregar, password, observacion } = req.body;
  const fechaActual = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
  const UsuarioAlta = req.user?.id || 70;

  if (!Array.isArray(ordenesParaEntregar) || ordenesParaEntregar.length === 0) {
    return res.status(400).json({ error: 'No se seleccionaron órdenes.' });
  }

  let transaction;
  try {
    const pool = await getPool();
    transaction = await pool.transaction();
    await transaction.begin();

    for (const ordenDeRetiro of ordenesParaEntregar) {
      // Soporta todos los prefijos: R-, RL-, RW-, RT-, etc.
      const OReIdOrdenRetiro = parseInt((ordenDeRetiro || '').replace(/^[A-Za-z]+-0*/, ''), 10);
      if (isNaN(OReIdOrdenRetiro)) {
        logger.warn(`[ENTREGA] ID inválido para: ${ordenDeRetiro}`);
        continue;
      }

      // Chequear estado de pago y tipo de cliente
      const checkRes = await transaction.request()
        .input('ID', sql.Int, OReIdOrdenRetiro)
        .query(`
          SELECT r.PagIdPago, r.OReEstadoActual, o.PagIdPago as O_PagIdPago, c.TClIdTipoCliente,
                 r.CodCliente, r.OReCostoTotalOrden
          FROM OrdenesRetiro r WITH(NOLOCK)
          LEFT JOIN OrdenesDeposito o WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
          LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
          WHERE r.OReIdOrdenRetiro = @ID
        `);

      if (checkRes.recordset.length === 0) continue;

      // Una ORDEN está "impaga" si NI el retiro principal NI las órdenes hijas tienen PagIdPago.
      const isImpaga = checkRes.recordset.some(row => !row.PagIdPago && !row.O_PagIdPago);
      const isSemanalOAdelantado = checkRes.recordset.some(row => row.TClIdTipoCliente === 2 || row.TClIdTipoCliente === 3);
      // Estado 9 = Autorizado en Caja → no requiere contraseña aunque esté impaga
      const yaAutorizada = checkRes.recordset[0]?.OReEstadoActual === 9;

      if (isImpaga && !isSemanalOAdelantado && !yaAutorizada) {
        if (!password || password !== process.env.CONTRAAUTORIZO) {
          throw new Error(`La orden de retiro ${ordenDeRetiro} no está paga y requiere autorización. Contraseña incorrecta.`);
        }
        // Guardar excepción en RetirosConDeuda para el historial
        const codCliente = checkRes.recordset[0]?.CodCliente || null;
        const monto = checkRes.recordset.reduce((acc, r) => acc + (parseFloat(r.OReCostoTotalOrden) || 0), 0);

        // Obtener nombre del cliente
        let nombreCliente = null;
        if (codCliente) {
          const cliRes = await transaction.request()
            .input('cod', sql.VarChar, String(codCliente || ''))
            .query(`SELECT TOP 1 LTRIM(RTRIM(Nombre)) AS Nombre FROM Clientes WITH(NOLOCK) WHERE IDCliente = @cod`);
          nombreCliente = cliRes.recordset[0]?.Nombre || null;
        }

        await transaction.request()
          .input('orden', sql.VarChar, ordenDeRetiro)
          .input('cli', sql.VarChar, String(codCliente || ''))
          .input('nomCli', sql.NVarChar, nombreCliente)
          .input('monto', sql.Decimal, monto)
          .input('usr', sql.Int, UsuarioAlta)
          .input('obs', sql.NVarChar, observacion || 'Sin observación')
          .query(`INSERT INTO RetirosConDeuda (OrdenRetiro, CodigoCliente, NombreCliente, Monto, UsuarioAutorizador, Explicacion, Estado, Gestionado)
                  VALUES (@orden, @cli, @nomCli, @monto, @usr, @obs, 'Pendiente', 0)`);
      }

      await marcarEntregado(transaction, OReIdOrdenRetiro, new Date(fechaActual), UsuarioAlta);
    }

    await transaction.commit();
    res.status(200).json({ message: 'Órdenes entregadas correctamente.' });
    const io = req.app.get('socketio');
    if (io) {
      io.emit('retiros:update', { type: 'entregado', ordenesRetiro: ordenesParaEntregar });
      io.emit('actualizado', { type: 'actualizacion' });
    }
  } catch (err) {
    if (transaction) try { await transaction.rollback(); } catch (e) { }
    logger.error("Error al marcar despacho entregado:", err);
    res.status(500).json({ error: err.message });
  }
};


// ─── MOSTRADOR: Buscar órdenes sin pagar por retiro / orden / cliente ───────
const buscarParaMostrador = async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'Ingresá al menos 2 caracteres.' });

  try {
    const pool = await getPool();
    const termClean = q.trim();

    // Detectar si es un código de RETIRO (R-XXXX, RT-XXXX, RL-XXXX, RW-XXXX)
    const esRetiro = /^R[A-Za-z]*-?\d+$/i.test(termClean);

    // ── Query completa para mostrar situación de un retiro (SIN filtrar por pago)
    // Sirve para "Situación de Pago" — muestra el estado real independientemente de si está pagado
    const retiroCompletoQuery = (extraWhere) => `
      SELECT DISTINCT
        r.OReIdOrdenRetiro,
        r.FormaRetiro,
        r.OReCostoTotalOrden,
        r.OReFechaAlta,
        r.OReEstadoActual,
        fe.Nombre           AS lugarRetiro,
        er.EORNombreEstado  AS estadoRetiro,
        o.OrdIdOrden,
        o.OrdCodigoOrden,
        o.OrdCostoFinal,
        eo.EOrNombreEstado  AS estadoOrden,
        mon.MonSimbolo,
        LTRIM(RTRIM(c.Nombre))           AS CliNombre,
        c.IDCliente                      AS CliCodigo,
        LTRIM(RTRIM(c.TelefonoTrabajo))  AS CliTelefono,
        LTRIM(RTRIM(c.CioRuc))           AS CliRuc,
        LTRIM(RTRIM(c.Email))            AS CliEmail,
        LTRIM(RTRIM(c.DireccionTrabajo)) AS CliDireccion,
        tc.TClDescripcion,
        CASE WHEN o.PagIdPago IS NOT NULL THEN 1 ELSE 0 END AS Pagada
      FROM OrdenesRetiro r WITH(NOLOCK)
      LEFT JOIN FormasEnvio fe          WITH(NOLOCK) ON fe.ID  = r.LReIdLugarRetiro
      LEFT JOIN EstadosOrdenesRetiro er WITH(NOLOCK) ON er.EORIdEstadoOrden = r.OReEstadoActual
      LEFT JOIN OrdenesDeposito o       WITH(NOLOCK) ON o.OReIdOrdenRetiro  = r.OReIdOrdenRetiro
      LEFT JOIN Monedas mon              WITH(NOLOCK) ON mon.MonIdMoneda     = o.MonIdMoneda
      LEFT JOIN Clientes c               WITH(NOLOCK) ON c.CliIdCliente      = o.CliIdCliente
      LEFT JOIN TiposClientes tc         WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
      LEFT JOIN EstadosOrdenes eo        WITH(NOLOCK) ON eo.EOrIdEstadoOrden = o.OrdEstadoActual
      WHERE 1=1
        ${extraWhere}
      ORDER BY r.OReIdOrdenRetiro DESC, o.OrdIdOrden
    `;

    // ── Query de sub-órdenes sueltas (sin retiro) — sin filtro de pago
    const ordenSueltaQuery = (extraWhere) => `
      SELECT o.OrdIdOrden, o.OrdCodigoOrden, o.OrdCostoFinal,
             eo.EOrNombreEstado AS estadoOrden, mon.MonSimbolo,
             LTRIM(RTRIM(c.Nombre)) AS CliNombre, c.IDCliente AS CliCodigo,
             LTRIM(RTRIM(c.TelefonoTrabajo)) AS CliTelefono,
             LTRIM(RTRIM(c.CioRuc)) AS CliRuc,
             LTRIM(RTRIM(c.Email)) AS CliEmail,
             LTRIM(RTRIM(c.DireccionTrabajo)) AS CliDireccion,
             tc.TClDescripcion,
             CASE WHEN o.PagIdPago IS NOT NULL THEN 1 ELSE 0 END AS Pagada
      FROM OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN Monedas mon         WITH(NOLOCK) ON mon.MonIdMoneda      = o.MonIdMoneda
      LEFT JOIN Clientes c           WITH(NOLOCK) ON c.CliIdCliente       = o.CliIdCliente
      LEFT JOIN TiposClientes tc     WITH(NOLOCK) ON tc.TClIdTipoCliente  = c.TClIdTipoCliente
      LEFT JOIN EstadosOrdenes eo    WITH(NOLOCK) ON eo.EOrIdEstadoOrden  = o.OrdEstadoActual
      WHERE 1=1 ${extraWhere}
      ORDER BY o.OrdIdOrden DESC
    `;

    let retiroRows = [];
    let sinRetiro = [];

    if (esRetiro) {
      // ── Búsqueda por código de retiro (R-XXXX / RT-XXXX / etc.) ─────────────
      const idRetiro = parseInt(termClean.replace(/^[A-Za-z]+-?0*/i, ''), 10);
      if (!isNaN(idRetiro)) {
        const result = await pool.request()
          .input('idRetiro', sql.Int, idRetiro)
          .query(retiroCompletoQuery('AND r.OReIdOrdenRetiro = @idRetiro'));
        retiroRows = result.recordset;
      }

    } else {
      // ── Búsqueda por código de orden (ej: DF-86551) ──────────────────────────
      const lookup = await pool.request()
        .input('cod', sql.NVarChar, termClean)
        .query(`SELECT TOP 1 OrdIdOrden, OReIdOrdenRetiro, PagIdPago, OrdEstadoActual
                FROM OrdenesDeposito WITH(NOLOCK)
                WHERE OrdCodigoOrden = @cod`);

      if (lookup.recordset.length > 0) {
        const row = lookup.recordset[0];

        if (row.OReIdOrdenRetiro) {
          // Tiene retiro → mostrar el retiro completo con TODAS sus órdenes (pagas y no pagas)
          const result = await pool.request()
            .input('idRetiro', sql.Int, row.OReIdOrdenRetiro)
            .query(retiroCompletoQuery('AND r.OReIdOrdenRetiro = @idRetiro'));
          retiroRows = result.recordset;
        } else {
          // Sin retiro → mostrar la orden sola
          const r = await pool.request()
            .input('cod', sql.NVarChar, termClean)
            .query(ordenSueltaQuery('AND o.OrdCodigoOrden = @cod'));
          sinRetiro = r.recordset;
        }

      } else {
        // No encontrado por código → buscar por cliente (IDCliente o Nombre)
        const patron = `%${termClean.toUpperCase()}%`;

        const result = await pool.request()
          .input('codCli', sql.NVarChar, patron)
          .query(retiroCompletoQuery(`
            AND r.OReEstadoActual NOT IN (5, 6)
            AND o.PagIdPago IS NULL
            AND (UPPER(c.IDCliente) LIKE @codCli OR UPPER(c.Nombre) LIKE @codCli)
          `));
        retiroRows = result.recordset;

        const r6 = await pool.request()
          .input('codCli', sql.NVarChar, patron)
          .query(ordenSueltaQuery(`
            AND o.OReIdOrdenRetiro IS NULL
            AND o.OrdEstadoActual NOT IN (9, 10)
            AND (UPPER(c.IDCliente) LIKE @codCli OR UPPER(c.Nombre) LIKE @codCli)
          `));
        sinRetiro = r6.recordset;
      }
    }

    return res.json({ retiroRows, sinRetiro });
  } catch (err) {
    logger.error('[MOSTRADOR] Error búsqueda:', err);
    res.status(500).json({ error: err.message });
  }
};


// ── Backfill: actualizar LReIdLugarRetiro NULL desde FormaEnvioID del cliente ──
const backfillLugarRetiro = async (req, res) => {
  const dry = req.query.dry === 'true'; // ?dry=true para solo ver qué se actualizaría
  try {
    const pool = await getPool();

    if (dry) {
      // Preview: qué órdenes se van a actualizar
      const preview = await pool.request().query(`
        SELECT od.OrdIdOrden, od.OrdCodigoOrden, c.FormaEnvioID,
               fe.Nombre AS LugarRetiroNombre,
               LTRIM(RTRIM(c.Nombre)) AS CliNombre
        FROM OrdenesDeposito od WITH(NOLOCK)
        INNER JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = od.CliIdCliente
        LEFT JOIN FormasEnvio fe WITH(NOLOCK) ON fe.ID = c.FormaEnvioID
        WHERE od.LReIdLugarRetiro IS NULL
          AND c.FormaEnvioID IS NOT NULL
        ORDER BY od.OrdIdOrden DESC
      `);
      return res.json({ dryRun: true, count: preview.recordset.length, rows: preview.recordset });
    }

    // Ejecución real
    const result = await pool.request().query(`
      UPDATE od
      SET od.LReIdLugarRetiro = c.FormaEnvioID
      FROM OrdenesDeposito od
      INNER JOIN Clientes c ON c.CliIdCliente = od.CliIdCliente
      WHERE od.LReIdLugarRetiro IS NULL
        AND c.FormaEnvioID IS NOT NULL
    `);

    return res.json({
      success: true,
      rowsAffected: result.rowsAffected[0],
      message: `Se actualizaron ${result.rowsAffected[0]} órdenes con su lugar de retiro.`
    });
  } catch (err) {
    logger.error('[BACKFILL LugarRetiro] Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── Listar TODAS las órdenes sin RetiroAsignado (con filtro opcional por lugar) ──
const getTodasSinRetiro = async (req, res) => {
  const { lugar } = req.query; // optional: LReIdLugarRetiro ID
  try {
    const pool = await getPool();
    const request = pool.request();
    let whereExtra = '';
    if (lugar && lugar !== '') {
      request.input('Lugar', sql.Int, parseInt(lugar, 10));
      whereExtra = 'AND o.LReIdLugarRetiro = @Lugar';
    }

    const result = await request.query(`
      SELECT
        o.OrdIdOrden,
        o.OrdCodigoOrden,
        o.OrdCostoFinal,
        o.LReIdLugarRetiro,
        fe.Nombre AS LugarRetiroNombre,
        eo.EOrNombreEstado AS estadoOrden,
        mon.MonSimbolo,
        LTRIM(RTRIM(c.Nombre)) AS CliNombre,
        c.IDCliente AS CliCodigo,
        LTRIM(RTRIM(c.TelefonoTrabajo)) AS CliTelefono,
        tc.TClDescripcion,
        o.CliIdCliente AS CliIdClienteFK,
        o.OrdNombreTrabajo,
        CASE WHEN o.PagIdPago IS NOT NULL THEN 1 ELSE 0 END AS Pagada

      FROM OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = o.MonIdMoneda
      LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
      LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
      LEFT JOIN EstadosOrdenes eo WITH(NOLOCK) ON eo.EOrIdEstadoOrden = o.OrdEstadoActual
      LEFT JOIN FormasEnvio fe WITH(NOLOCK) ON fe.ID = o.LReIdLugarRetiro
      WHERE o.OReIdOrdenRetiro IS NULL
        AND o.OrdEstadoActual NOT IN (9, 10)
        ${whereExtra}
      ORDER BY o.OrdIdOrden DESC
    `);

    return res.json({ sinRetiro: result.recordset });
  } catch (err) {
    logger.error('[SIN RETIRO] Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── NUEVO: Obtener datos de envío de un cliente (DireccionesEnvioCliente) ──
const getClienteEnvioDatos = async (req, res) => {
  const { cliId } = req.params;
  try {
    const pool = await getPool();

    const [dirs, cliData] = await Promise.all([
      pool.request()
        .input('cliId', sql.Int, parseInt(cliId, 10))
        .query('SELECT ID, Alias, Direccion, AgenciaID, Ciudad, Localidad FROM DireccionesEnvioCliente WHERE CliIdCliente = @cliId ORDER BY FechaCreacion DESC'),
      pool.request()
        .input('cliId', sql.Int, parseInt(cliId, 10))
        .query('SELECT ISNULL(DireccionTrabajo, \'\') AS CliDireccion, LocalidadID AS Localidad, LocalidadID, AgenciaID, DepartamentoID FROM Clientes WHERE CliIdCliente = @cliId')
    ]);

    res.json({
      direcciones: dirs.recordset,
      defaultDir: cliData.recordset[0]?.CliDireccion || '',
      defaultLocalidad: cliData.recordset[0]?.Localidad || '',
      defaultLocalidadId: cliData.recordset[0]?.LocalidadID || null,
      defaultDepartamentoId: cliData.recordset[0]?.DepartamentoID || null,
      defaultAgenciaId: cliData.recordset[0]?.AgenciaID || null
    });
  } catch (err) {
    logger.error('[ENVIO CLIENTE] Error:', err);
    res.status(500).json({ error: err.message });
  }
};


const getOrdenesRetiroPorRemito = async (req, res) => {
  const { remitoCode } = req.params;
  try {
    const pool = await getPool();
    const query = `
      ${getOrdenesRetiroQueryBase}
      INNER JOIN Logistica_Bultos b WITH(NOLOCK) ON b.OrdenID = r.OReIdOrdenRetiro AND b.Tipocontenido = 'ENCOMIENDA'
      INNER JOIN Logistica_EnvioItems ei WITH(NOLOCK) ON ei.BultoID = b.BultoID
      INNER JOIN Logistica_Envios e WITH(NOLOCK) ON e.EnvioID = ei.EnvioID
      WHERE e.CodigoRemito = @RemitoCode
    `;
    const result = await pool.request().input('RemitoCode', sql.VarChar, remitoCode).query(query);
    res.json(processRetirosRows(result.recordset));
  } catch (err) {
    logger.error('Error al obtener retiros por remito:', err);
    res.status(500).json({ error: 'Error' });
  }
};

module.exports = {
  createOrdenRetiro, getOrdenesRetiroPorEstados, actualizarOrdenRetiroEstado, marcarOrdenRetiroPronto,
  marcarOrdenRetiroEntregado, ordenesRetiroCaja, getOrdenesRetiroPasarPorCaja, ordenesRetiroMarcarPasarPorCaja, getOrdenesRetiroPorFecha,
  getOrdenesRetiroPorLugar, marcarDespachoEntregadoAutorizado, buscarParaMostrador, getClienteEnvioDatos, getTodasSinRetiro, backfillLugarRetiro, getOrdenesRetiroPorRemito
};
