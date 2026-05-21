const { getPool, sql }   = require('../config/db');
const logger              = require('../utils/logger');
const contabilidadService = require('../services/contabilidadService');
const contabilidadCore    = require('../services/contabilidadCore');
const { generarCFEDesdeOrdenesDirectas } = require('../services/cajaService');

// Controlador para obtener métodos de pago
const obtenerMetodosPago = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT 
        MPaIdMetodoPago, 
        MPaDescripcionMetodo,
        ISNULL(MPaAfectaCaja, 1)  AS MPaAfectaCaja,
        ISNULL(MPaTipo, 'ENTRADA') AS MPaTipo,
        ISNULL(MPaActivo, 1)       AS MPaActivo
      FROM MetodosPagos WITH(NOLOCK)
      WHERE ISNULL(MPaActivo, 1) = 1
      ORDER BY MPaDescripcionMetodo
    `);
    res.json(result.recordset);

  } catch (error) {
    logger.error('Error al obtener métodos de pago:', error);
    res.status(500).json({ error: 'Error al obtener métodos de pago' });
  }
};

// Controlador para realizar un pago
const realizarPago = async (req, res) => {
  const { metodoPagoId, monedaId, monto, ordenRetiro, orderNumbers } = req.body;
  const usuarioId = req.user?.id || 70;
  logger.info('Cuerpo de la solicitud recibido:', req.body);

  const pool = await getPool();
  let transaction;

  try {
    // ── Determinar si hay retiro asociado ─────────────────────────────────────
    const tieneRetiro = ordenRetiro && ordenRetiro.toString().trim() !== '';
    let ordenRetiroId = null;
    let nuevoEstadoRetiro = null;

    if (tieneRetiro) {
      ordenRetiroId = parseInt(ordenRetiro.toString().replace(/^[A-Za-z]+-0*/i, ''), 10);
      if (isNaN(ordenRetiroId)) {
        return res.status(400).json({ error: 'ordenRetiroId inválido.' });
      }

      // Validar que existe la orden de retiro
      const ordRetResult = await pool.request()
        .input('ID', sql.Int, ordenRetiroId)
        .query('SELECT OReEstadoActual FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID');

      if (ordRetResult.recordset.length === 0) {
        return res.status(404).json({ error: `No se encontró la orden de retiro con ID: ${ordenRetiroId}` });
      }

      const estadoActual = ordRetResult.recordset[0].OReEstadoActual;
      nuevoEstadoRetiro = estadoActual === 1 ? 3 : 8;
    }

    transaction = await pool.transaction();
    await transaction.begin();

    // ── 1. Insertar el Pago ───────────────────────────────────────────────────
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

      // ── 2. Actualizar OrdenRetiro (solo si tiene retiro) ──────────────────────
    if (tieneRetiro) {
      await transaction.request()
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .input('nuevoEstado', sql.Int, nuevoEstadoRetiro)
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
        .input('nuevoEstado', sql.Int, nuevoEstadoRetiro)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
          INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          VALUES (@ordenRetiroId, @nuevoEstado, GETDATE(), @usuarioId);
        `);

      // Actualizar OcupacionEstantes.Pagado si el retiro está en un estante
      await transaction.request()
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .query(`
          UPDATE OcupacionEstantes SET Pagado = 1
          WHERE OrdenRetiro IN (
            SELECT COALESCE(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR)
            FROM OrdenesRetiro r WITH(NOLOCK)
            WHERE r.OReIdOrdenRetiro = @ordenRetiroId
          );
        `);
    }

    // ── 3. Actualizar OrdenesDeposito ─────────────────────────────────────────
    if (orderNumbers && orderNumbers.length > 0) {
      const orderIdsList = orderNumbers.join(', ');

      await transaction.request()
        .input('pagoId', sql.Int, pagoId)
        .query(`
          UPDATE OrdenesDeposito
          SET PagIdPago = @pagoId, OrdEstadoActual = 7, OrdFechaEstadoActual = GETDATE()
          WHERE OrdIdOrden IN (${orderIdsList});
        `);

      const historicoValues = orderNumbers.map(id => `(${id}, 7, GETDATE(), ${usuarioId})`).join(', ');
      await transaction.request().query(`
        INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
        VALUES ${historicoValues};
      `);
    }

    // ── 4. AUTO-CIERRE del Retiro si todas sus órdenes están pagas ────────────
    if (tieneRetiro) {
      const todasPagasRes = await transaction.request()
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .query(`
          SELECT 
            COUNT(*) AS total,
            SUM(CASE WHEN od.PagIdPago IS NOT NULL THEN 1 ELSE 0 END) AS pagas
          FROM OrdenesDeposito od WITH(NOLOCK)
          WHERE od.OReIdOrdenRetiro = @ordenRetiroId
            AND od.OrdEstadoActual NOT IN (6, 9)
        `);

      const { total, pagas } = todasPagasRes.recordset[0];

      if (total > 0 && total === pagas) {
        await transaction.request()
          .input('ordenRetiroId', sql.Int, ordenRetiroId)
          .input('pagoId', sql.Int, pagoId)
          .input('usuarioId', sql.Int, usuarioId)
          .query(`
            UPDATE OrdenesRetiro 
            SET PagIdPago = @pagoId,
                OReEstadoActual = 4,
                OReFechaEstadoActual = GETDATE(),
                ORePasarPorCaja = 0
            WHERE OReIdOrdenRetiro = @ordenRetiroId
              AND (PagIdPago IS NULL OR PagIdPago = 0);

            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            VALUES (@ordenRetiroId, 4, GETDATE(), @usuarioId);
          `);

        logger.info(`[AUTO-CIERRE] OrdenRetiro R-${ordenRetiroId} marcada como Abonada.`);
      }
    }

    await transaction.commit();

    const io = req.app.get('socketio');
    if (io) {
      io.emit('actualizado', { type: 'actualizacion' });
      io.emit('retiros:update', { type: 'pago' });
    }

    res.status(200).json({ message: 'Pago registrado correctamente', pagoId });

    // ── MOTOR DE CONTABILIDAD + GENERACIÓN CFE ───────────────────────────────
    // Replicamos el mismo flujo que Caja: contabilidad + E-Ticket (CFE).
    if (orderNumbers && orderNumbers.length > 0) {
       const cliPool = await getPool();
       const cliRes = await cliPool.request()
          .input('O', sql.Int, parseInt(orderNumbers[0]))
          .query('SELECT CliIdCliente FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdIdOrden=@O');
          
       if (cliRes.recordset.length > 0) {
          const { CliIdCliente } = cliRes.recordset[0];

          // 1. Motor contable (movimientos cuenta corriente)
          contabilidadService.procesarEventoContable('PAGO', {
             PagIdPago: pagoId,
             CliIdCliente,
             Importe: monto,
             MonIdMoneda: monedaId,
             UsuarioAlta: usuarioId,
             OReIdOrdenRetiro: ordenRetiroId
          }).catch(e => logger.error(`[CONTABILIDAD] Error motor en pago ${pagoId}: ${e.message}`));

          // 2. Generar CFE (DocumentosContables) — igual que Caja Paso 5.6
          generarCFEDesdeOrdenesDirectas({
             orderIds:  orderNumbers.map(Number),
             clienteId: CliIdCliente,
             monto,
             monedaId,
             pagoId,
             usuarioId
          }).catch(e => logger.error(`[CFE-MOSTRADOR] Error generando CFE para pago ${pagoId}: ${e.message}`));
       }
    }
    // ─────────────────────────────────────────────────────────────────────────

  } catch (error) {
    if (transaction) {
      try { await transaction.rollback(); } catch (e) { }
    }
    logger.error('Error al registrar el pago:', error);
    res.status(500).json({ error: error.message });
  }
};

const subirComprobante = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({ error: 'No se proporcionó archivo.' });
    }

    const filePath = req.file.filename;
    const { ordenRetiroId } = req.body;

    // Si se proporcionó ordenRetiroId, asociar el comprobante en la DB
    if (ordenRetiroId) {
      const pool = await getPool();
      await pool.request()
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .input('filePath', sql.NVarChar, filePath)
        .query(`
          UPDATE Pag
          SET PagRutaComprobante = @filePath
          FROM Pagos Pag WITH(NOLOCK)
          JOIN OrdenesRetiro ORe WITH(NOLOCK) ON ORe.PagIdPago = Pag.PagIdPago
          WHERE ORe.OReIdOrdenRetiro = @ordenRetiroId
        `);
    }

    res.status(200).send({ message: 'Archivo subido correctamente', filename: filePath });
  } catch (error) {
    logger.error('Error al subir comprobante:', error);
    res.status(500).send({ error: 'Error al subir el comprobante.' });
  }
};

module.exports = { obtenerMetodosPago, realizarPago, subirComprobante };
