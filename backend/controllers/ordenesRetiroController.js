const { getPool, sql } = require('../config/db');
const moment = require('moment-timezone');

const createOrdenRetiro = async (req, res) => {
  const { orders, totalCost, lugarRetiro } = req.body;
  const UsuarioAlta = req.user?.id || 70;
  const fechaActual = new Date();

  if (!orders || orders.length === 0) {
    return res.status(400).json({ error: 'No se proporcionaron órdenes válidas.' });
  }

  const pool = await getPool();
  let transaction;

  try {
    const orderCode = orders[0]?.orderNumber;

    // Validar orden y cliente directamente desde la DB
    const clientResult = await pool.request()
      .input('OrderCode', sql.VarChar, orderCode)
      .query(`
          SELECT o.CliIdCliente, c.TClIdTipoCliente 
          FROM OrdenesDeposito o WITH(NOLOCK)
          JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
          WHERE o.OrdCodigoOrden = @OrderCode
        `);

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Orden o cliente no encontrado.' });
    }

    const { TClIdTipoCliente } = clientResult.recordset[0];
    let estadoOrdenRetiro = (TClIdTipoCliente === 2 || TClIdTipoCliente === 3) ? 4 : 1;

    transaction = await pool.transaction();
    await transaction.begin();

    const insertOrdenRetiro = await transaction.request()
      .input('OReCostoTotalOrden', sql.Float, totalCost)
      .input('LReIdLugarRetiro', sql.Int, lugarRetiro)
      .input('OReFechaAlta', sql.DateTime, fechaActual)
      .input('OReUsuarioAlta', sql.Int, UsuarioAlta)
      .input('estadoOrdenRetiro', sql.Int, estadoOrdenRetiro)
      .query(`
        INSERT INTO OrdenesRetiro (
          OReCostoTotalOrden, LReIdLugarRetiro, OReFechaAlta, OReUsuarioAlta, OReEstadoActual, OReFechaEstadoActual
        ) VALUES (
          @OReCostoTotalOrden, @LReIdLugarRetiro, @OReFechaAlta, @OReUsuarioAlta, @estadoOrdenRetiro, GETDATE()
        );
        SELECT SCOPE_IDENTITY() AS OReIdOrdenRetiro;
      `);

    const OReIdOrdenRetiro = insertOrdenRetiro.recordset[0].OReIdOrdenRetiro;

    await transaction.request()
      .input('OReIdOrdenRetiro', sql.Int, OReIdOrdenRetiro)
      .input('estadoOrdenRetiro', sql.Int, estadoOrdenRetiro)
      .input('HEOFechaEstado', sql.DateTime, fechaActual)
      .input('HEOUsuarioAlta', sql.Int, UsuarioAlta)
      .query(`
        INSERT INTO HistoricoEstadosOrdenesRetiro (
          OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta
        ) VALUES (
          @OReIdOrdenRetiro, @estadoOrdenRetiro, @HEOFechaEstado, @HEOUsuarioAlta
        );
      `);

    const orderNumbers = orders.map(order => `'${order.orderNumber}'`).join(',');
    const orderIdResults = await transaction.request().query(`
      SELECT OrdIdOrden, OrdCodigoOrden, OrdEstadoActual, OrdFechaEstadoActual 
      FROM OrdenesDeposito WITH(NOLOCK) 
      WHERE OrdCodigoOrden IN (${orderNumbers})
    `);

    if (orderIdResults.recordset.length === 0) {
      throw new Error('No se encontraron órdenes para los códigos proporcionados.');
    }

    const orderMap = Object.fromEntries(orderIdResults.recordset.map(order => [order.OrdCodigoOrden, order]));

    const relacionesValues = orders.map(order => `(${OReIdOrdenRetiro}, ${orderMap[order.orderNumber].OrdIdOrden})`).join(',');
    await transaction.request().query(`
      INSERT INTO RelOrdenesRetiroOrdenes (OReIdOrdenRetiro, OrdIdOrden)
      VALUES ${relacionesValues};
    `);

    const updateCasesLugar = orders.map(order => `WHEN OrdIdOrden = ${orderMap[order.orderNumber].OrdIdOrden} THEN ${lugarRetiro}`).join(' ');
    const updateCasesOrdenRetiro = orders.map(order => `WHEN OrdIdOrden = ${orderMap[order.orderNumber].OrdIdOrden} THEN ${OReIdOrdenRetiro}`).join(' ');

    await transaction.request().query(`
      UPDATE OrdenesDeposito
      SET 
        LReIdLugarRetiro = CASE ${updateCasesLugar} END,
        OReIdOrdenRetiro = CASE ${updateCasesOrdenRetiro} END,
        OrdEstadoActual = 4,
        OrdFechaEstadoActual = GETDATE()
      WHERE OrdIdOrden IN (${orderIdResults.recordset.map(o => o.OrdIdOrden).join(',')});
    `);

    const historicoValues = orders.map(order => `(${orderMap[order.orderNumber].OrdIdOrden}, 4, GETDATE(), ${UsuarioAlta})`).join(',');
    await transaction.request().query(`
      INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      VALUES ${historicoValues};
    `);

    await transaction.commit();

    const io = req.app.get('socketio');
    if (io) io.emit('actualizado', { type: 'actualizacion' });

    res.status(201).json({
      message: 'Orden de retiro creada correctamente y órdenes actualizadas',
      OReIdOrdenRetiro,
    });
  } catch (err) {
    if (transaction) {
      try { await transaction.rollback(); } catch (e) { }
    }
    console.error('Error al crear la orden de retiro:', err);
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
    lr.LReNombreLugar AS lugarRetiro,
    er.EORNombreEstado AS estado,
    o.OrdIdOrden AS orderId,
    o.OrdCodigoOrden AS orderNumber,
    o.OrdEstadoActual AS orderEstado,
    o.OrdCostoFinal as costoFinal,
    monOrden.MonSimbolo AS orderMonedaSimbolo,
    p.MPaIdMetodoPago AS orderIdMetodoPago,
    mp.MPaDescripcionMetodo AS orderMetodoPago,
    monPago.MonSimbolo AS monetPagoSimbolo,
    p.PagMontoPago AS orderMontoPago,
    p.PagFechaPago AS orderFechaPago,
    p.PagRutaComprobante AS comprobante,
    c.CodigoReact AS CliCodigoCliente,
    c.Tipo AS TClDescripcion
  FROM OrdenesRetiro r WITH(NOLOCK)
  LEFT JOIN LugaresRetiro lr WITH(NOLOCK) ON lr.LReIdLugarRetiro = r.LReIdLugarRetiro
  LEFT JOIN EstadosOrdenesRetiro er WITH(NOLOCK) ON er.EORIdEstadoOrden = r.OReEstadoActual
  LEFT JOIN OrdenesDeposito o WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
  LEFT JOIN Monedas monOrden WITH(NOLOCK) ON monOrden.MonIdMoneda = o.MonIdMoneda
  LEFT JOIN Pagos p WITH(NOLOCK) ON p.PagIdPago = o.PagIdPago
  LEFT JOIN Monedas monPago WITH(NOLOCK) ON monPago.MonIdMoneda = p.PagIdMonedaPago
  LEFT JOIN MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
  LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
`;

const processRetirosRows = (rows) => {
  const map = {};
  for (const row of rows) {
    if (!map[row.OReIdOrdenRetiro]) {
      map[row.OReIdOrdenRetiro] = {
        ordenDeRetiro: `R-${String(row.OReIdOrdenRetiro).padStart(4, '0')}`,
        totalCost: parseFloat(row.OReCostoTotalOrden).toFixed(2),
        lugarRetiro: row.lugarRetiro || 'Desconocido',
        fechaAlta: row.OReFechaAlta,
        usuarioAlta: row.OReUsuarioAlta,
        estado: row.estado || 'Desconocido',
        pagorealizado: row.PagIdPago ? 1 : 0,
        metodoPago: row.orderMetodoPago,
        montopagorealizado: row.PagIdPago ? `${row.monetPagoSimbolo || ''} ${parseFloat(row.orderMontoPago || 0).toFixed(2)}` : null,
        fechapagooden: row.orderFechaPago,
        comprobante: row.comprobante,
        CliCodigoCliente: row.CliCodigoCliente || 'Desconocido',
        TClDescripcion: row.TClDescripcion || 'Desconocido',
        orders: []
      };
    }

    if (row.orderId) {
      map[row.OReIdOrdenRetiro].orders.push({
        orderNumber: row.orderNumber,
        orderId: row.orderId,
        orderEstado: row.orderEstado,
        orderCosto: row.orderMonedaSimbolo ? `${row.orderMonedaSimbolo} ${parseFloat(row.costoFinal).toFixed(2)}` : null,
        orderIdMetodoPago: row.orderIdMetodoPago,
        orderMetodoPago: row.orderMetodoPago,
        orderPago: row.monetPagoSimbolo ? `${row.monetPagoSimbolo} ${parseFloat(row.orderMontoPago).toFixed(2)}` : null,
        orderFechaPago: row.orderFechaPago
      });
    }
  }
  return Object.values(map);
};

const getOrdenesRetiroPorEstados = async (req, res) => {
  const estados = req.query.estados.split(',');
  try {
    const pool = await getPool();
    const request = pool.request();

    estados.forEach((e, i) => request.input(`e${i}`, sql.Int, parseInt(e.trim(), 10)));
    const inClause = estados.map((_, i) => `@e${i}`).join(',');

    const query = `
      ${getOrdenesRetiroQueryBase}
      WHERE r.OReEstadoActual IN (${inClause})
      AND (CAST(DATEADD(d,-7,GETDATE()) AS DATE) <= CAST(r.OReFechaAlta AS DATE) OR r.OReEstadoActual NOT IN (5,6))
    `;

    const result = await request.query(query);
    res.json(processRetirosRows(result.recordset));
  } catch (err) {
    console.error('Error al obtener las órdenes de retiro:', err);
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

    const inClause = scannedValues.map(v => `'${v}'`).join(',');

    await transaction.request().query(`
      INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      SELECT OrdIdOrden, 7, '${fechaActual}', ${UsuarioAlta}
      FROM OrdenesDeposito WHERE OrdCodigoOrden IN (${inClause});
      
      UPDATE OrdenesDeposito SET OrdEstadoActual = 7, OrdFechaEstadoActual = '${fechaActual}' WHERE OrdCodigoOrden IN (${inClause});
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
  } catch (err) {
    if (transaction) try { await transaction.rollback(); } catch (e) { }
    res.status(500).json({ error: err.message });
  }
};

const ordenesRetiroCaja = async (req, res) => {
  try {
    const pool = await getPool();
    const query = `
      ${getOrdenesRetiroQueryBase}
      WHERE (r.OReEstadoActual = 1 OR r.OReEstadoActual = 7)
      AND c.Tipo = 'C'
      AND r.LReIdLugarRetiro = 5
      AND (r.PagIdPago IS NULL OR o.PagIdPago IS NULL)
    `;
    const result = await pool.request().query(query);
    res.status(200).json(processRetirosRows(result.recordset));
  } catch (err) {
    console.error('[CAJA ERROR]', err);
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

    await transaction.request()
      .input('ID', sql.Int, OReIdOrdenRetiro).input('Fec', sql.DateTime, new Date(fechaActual)).input('Usr', sql.Int, UsuarioAlta)
      .query(`
        INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
        SELECT OrdIdOrden, 9, @Fec, @Usr FROM OrdenesDeposito WHERE OReIdOrdenRetiro = @ID;

        UPDATE OrdenesDeposito SET OrdEstadoActual = 9, OrdFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
        
        UPDATE OrdenesRetiro SET OReEstadoActual = 5, ORePasarPorCaja = 0, OReFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
        INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@ID, 5, @Fec, @Usr);
      `);

    await transaction.commit();
    res.status(200).json({ message: 'Entregadas' });
    req.app.get('socketio')?.emit('actualizado', { type: 'actualizacion' });
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
    console.error('[PASAR CAJA ERROR]', err);
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

module.exports = {
  createOrdenRetiro, getOrdenesRetiroPorEstados, actualizarOrdenRetiroEstado, marcarOrdenRetiroPronto,
  marcarOrdenRetiroEntregado, ordenesRetiroCaja, getOrdenesRetiroPasarPorCaja, ordenesRetiroMarcarPasarPorCaja, getOrdenesRetiroPorFecha
};
