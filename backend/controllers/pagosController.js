const { getPool, sql } = require('../config/db');

// Controlador para obtener métodos de pago
const obtenerMetodosPago = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT MPaIdMetodoPago, MPaDescripcionMetodo FROM MetodosPagos WITH(NOLOCK)');
    res.json(result.recordset);
  } catch (error) {
    console.error('Error al obtener métodos de pago:', error);
    res.status(500).json({ error: 'Error al obtener métodos de pago' });
  }
};

// Controlador para realizar un pago
const realizarPago = async (req, res) => {
  const { metodoPagoId, monedaId, monto, ordenRetiro, orderNumbers } = req.body;
  const usuarioId = req.user?.id || 70; // Hardcode default
  console.log('Cuerpo de la solicitud recibido:', req.body);

  const pool = await getPool();
  let transaction;

  try {
    const ordenRetiroId = parseInt(ordenRetiro.replace(/^R-0*/, ''), 10);
    if (isNaN(ordenRetiroId)) {
      return res.status(400).json({ error: "Invalid ordenRetiroId. Must be a valid number." });
    }

    // Validate orden de retiro first
    const ordRetResult = await pool.request()
      .input('ID', sql.Int, ordenRetiroId)
      .query('SELECT OReEstadoActual FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID');

    if (ordRetResult.recordset.length === 0) {
      throw new Error(`No se encontró la orden de retiro con ID: ${ordenRetiroId}`);
    }

    const estadoActual = ordRetResult.recordset[0].OReEstadoActual;
    const nuevoEstado = estadoActual === 1 ? 3 : 8;

    transaction = await pool.transaction();
    await transaction.begin();

    const pagoResult = await transaction.request()
      .input('metodoPagoId', sql.Int, metodoPagoId)
      .input('monedaId', sql.Int, monedaId)
      .input('monto', sql.Float, monto)
      .input('fecha', sql.DateTime, new Date())
      .input('usuarioId', sql.Int, usuarioId)
      .query(`
        INSERT INTO Pagos (MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago, PagUsuarioAlta)
        OUTPUT INSERTED.PagIdPago
        VALUES (@metodoPagoId, @monedaId, @monto, @fecha, @usuarioId)
      `);

    const pagoId = pagoResult.recordset[0].PagIdPago;

    await transaction.request()
      .input('ordenRetiroId', sql.Int, ordenRetiroId)
      .input('nuevoEstado', sql.Int, nuevoEstado)
      .input('pagoId', sql.Int, pagoId)
      .query(`
        UPDATE OrdenesRetiro 
        SET PagIdPago = @pagoId, 
            OReEstadoActual = @nuevoEstado, 
            OReFechaEstadoActual = GETDATE(),
            ORePasarPorCaja = 0
        WHERE OReIdOrdenRetiro = @ordenRetiroId;
      `);

    await transaction.request()
      .input('ordenRetiroId', sql.Int, ordenRetiroId)
      .input('nuevoEstado', sql.Int, nuevoEstado)
      .input('usuarioId', sql.Int, usuarioId)
      .query(`
        INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
        VALUES (@ordenRetiroId, @nuevoEstado, GETDATE(), @usuarioId);
      `);

    if (orderNumbers && orderNumbers.length > 0) {
      const orderIdsList = orderNumbers.join(', ');

      await transaction.request()
        .input('pagoId', sql.Int, pagoId)
        .query(`
          UPDATE OrdenesDeposito
          SET PagIdPago = @pagoId, OrdEstadoActual = 7, OrdFechaEstadoActual = GETDATE()
          WHERE OrdIdOrden IN (${orderIdsList});
        `);

      const historicoValues = orderNumbers.map(orderId => `(${orderId}, 7, GETDATE(), ${usuarioId})`).join(', ');
      await transaction.request().query(`
        INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
        VALUES ${historicoValues};
      `);
    }

    await transaction.commit();

    const io = req.app.get('socketio');
    if (io) io.emit('actualizado', { type: 'actualizacion' });

    res.status(200).json({ message: 'Pago registrado correctamente', pagoId });
  } catch (error) {
    if (transaction) {
      try { await transaction.rollback(); } catch (e) { }
    }
    console.error('Error al registrar el pago:', error);
    res.status(500).json({ error: error.message });
  }
};

const subirComprobante = async (req, res) => {
  try {
    const { ordenRetiroId } = req.body;
    console.log('ordenRetiroId recibido:', ordenRetiroId);

    if (!ordenRetiroId || !req.file) {
      return res.status(400).send({ error: 'Faltan datos o archivo.' });
    }

    const filePath = req.file.filename;

    const pool = await getPool();
    const result = await pool.request()
      .input('ordenRetiroId', sql.Int, ordenRetiroId)
      .input('filePath', sql.NVarChar, filePath)
      .query(`
        UPDATE Pag
        SET PagRutaComprobante = @filePath
        FROM Pagos Pag WITH(NOLOCK)
        JOIN OrdenesRetiro ORe WITH(NOLOCK) ON ORe.PagIdPago = Pag.PagIdPago
        WHERE ORe.OReIdOrdenRetiro = @ordenRetiroId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).send({ error: 'No se encontró la orden de retiro asociada.' });
    }

    res.status(200).send({ message: 'Archivo subido y ruta guardada correctamente', filePath });
  } catch (error) {
    console.error('Error al subir comprobante:', error);
    res.status(500).send({ error: 'Error al subir el comprobante.' });
  }
};

module.exports = { obtenerMetodosPago, realizarPago, subirComprobante };
