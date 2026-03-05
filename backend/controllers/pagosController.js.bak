// controllers/PagosController.js
const sql = require('mssql');
const { poolPromise } = require('../config/db');
const cache = require('../cache'); // Importa la caché

// Importar el servidor de WebSocket
const { getIO } = require('../socket');

// Controlador para obtener métodos de pago
const obtenerMetodosPago = async (req, res) => {
  try {
    // Verificar si los datos están en la caché
    let metodosPago = cache.get('metodosPagos');
    if (metodosPago) {
      console.log('Métodos de pago servidos desde la caché.');
    } else {
      console.log('Métodos de pago no encontrados en la caché. Consultando la base de datos...');
      const pool = await poolPromise;
      const result = await pool.request().query(`
        SELECT *  
        FROM [User].dbo.MetodosPagos WITH(NOLOCK)
      `);

      // Guardar en la caché
      metodosPago = result.recordset;
      cache.set('metodosPagos', metodosPago);
      console.log('Métodos de pago consultados desde la base de datos y almacenados en la caché.');
    }

    // Filtrar solo los campos necesarios antes de enviar la respuesta
    const filteredMetodosPago = metodosPago.map(metodo => ({
      MPaIdMetodoPago: metodo.MPaIdMetodoPago,
      MPaDescripcionMetodo: metodo.MPaDescripcionMetodo,
    }));

    // Enviar la respuesta
    res.json(filteredMetodosPago);
  } catch (error) {
    console.error('Error al obtener métodos de pago:', error);
    res.status(500).json({ error: 'Error al obtener métodos de pago' });
  }
};

// Controlador para realizar un pago
const realizarPago = async (req, res) => {
  const { metodoPagoId, monedaId, monto, ordenRetiro, orderNumbers } = req.body;
  const usuarioId = req.user.id; // Obtener el ID del usuario autenticado
  console.log('Cuerpo de la solicitud recibido:', req.body);
  
  // Iniciar transacción
  const pool = await poolPromise;
  let transaction;

  try {
    // Extraer solo la parte numérica de `ordenRetiroId` quitando el prefijo "R-"
    const ordenRetiroId = parseInt(ordenRetiro.replace(/^R-0*/, ''), 10);
    if (isNaN(ordenRetiroId)) {
      return res.status(400).json({ error: "Invalid ordenRetiroId. Must be a valid number." });
    }
        
    // Actualizar la caché de órdenes de retiro
    let ordenesRetiroCache = cache.get('ordenesRetiro');
    const ordenRetiroAPagar = ordenesRetiroCache.find(o => o.OReIdOrdenRetiro === ordenRetiroId);

    if (!ordenRetiroAPagar) {
      throw new Error(`No se encontró la orden de retiro con ID: ${ordenRetiroId}`);
    }
    
    // Determinar el nuevo estado basado en el estado actual 
    let nuevoEstado;
    if (ordenRetiroAPagar.OReEstadoActual === 1) {
      nuevoEstado = 3;
    } else {
      nuevoEstado = 8;
    } 

    transaction = await pool.transaction();
    await transaction.begin();

    // Insertar el nuevo pago en la tabla `Pagos`
    const result = await transaction.request()
      .input('metodoPagoId', sql.Int, metodoPagoId)
      .input('monedaId', sql.Int, monedaId)
      .input('monto', sql.Float, monto)
      .input('fecha', sql.DateTime, new Date())
      .input('usuarioId', sql.Int, usuarioId)
      .query(`
        INSERT INTO [User].dbo.Pagos (MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago, PagUsuarioAlta)
        OUTPUT INSERTED.PagIdPago
        VALUES (@metodoPagoId, @monedaId, @monto, @fecha, @usuarioId)
      `);

    const pagoId = result.recordset[0].PagIdPago;

    // Actualizar el estado de la orden de retiro
    await transaction.request()
      .input('ordenRetiroId', sql.Int, ordenRetiroId)
      .input('nuevoEstado', sql.Int, nuevoEstado)
      .input('pagoId', sql.Int, pagoId)
      .query(`
        UPDATE [User].dbo.OrdenesRetiro 
        SET PagIdPago = @pagoId, 
            OReEstadoActual = @nuevoEstado, 
            OReFechaEstadoActual = GETDATE(),
            ORePasarPorCaja = 0
        WHERE OReIdOrdenRetiro = @ordenRetiroId;
      `);

    // Registrar el cambio en el histórico de la orden de retiro
    await transaction.request()
      .input('ordenRetiroId', sql.Int, ordenRetiroId)
      .input('nuevoEstado', sql.Int, nuevoEstado)
      .input('usuarioId', sql.Int, usuarioId)
      .query(`
        INSERT INTO [User].dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
        VALUES (@ordenRetiroId, @nuevoEstado, GETDATE(), @usuarioId);
      `);


    // Actualizar las órdenes asociadas en lote
    const updateOrdersQuery = `
    UPDATE [User].dbo.Ordenes
    SET PagIdPago = @pagoId, OrdEstadoActual = 7, OrdFechaEstadoActual = GETDATE()
    WHERE OrdIdOrden IN (${orderNumbers.join(', ')});
    `;

    await transaction.request()
    .input('pagoId', sql.Int, pagoId)
    .query(updateOrdersQuery);

    // Registrar los cambios en el histórico de las órdenes en lote
    const historicoValues = orderNumbers
    .map(orderId => `(${orderId}, 7, GETDATE(), ${usuarioId})`)
    .join(', ');

    const historicoQuery = `
    INSERT INTO [User].dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
    VALUES ${historicoValues};
    `;

    await transaction.request().query(historicoQuery);

    // Confirmar la transacción
    await transaction.commit();

    if (ordenesRetiroCache) {
      const index = ordenesRetiroCache.findIndex(orden => orden.OReIdOrdenRetiro === ordenRetiroId);
      if (index !== -1) {
        ordenesRetiroCache[index] = {
          ...ordenesRetiroCache[index],
          PagIdPago: pagoId,
          OReEstadoActual: nuevoEstado,
          OReFechaEstadoActual: new Date(),
          ORePasarPorCaja: false
        };
        cache.set('ordenesRetiro', ordenesRetiroCache);
        console.log(`Caché de órdenes de retiro actualizada para OrdenRetiroId ${ordenRetiroId}.`);
      }
    }

    // Actualizar la caché de órdenes
    let ordenesCache = cache.get('ordenes');
    if (ordenesCache) {
      const updatedOrderNumbers = new Set(orderNumbers); // Usamos un Set para mejorar el rendimiento en las búsquedas

      ordenesCache = ordenesCache.map(orden => {
        if (updatedOrderNumbers.has(orden.OrdIdOrden)) {
          return {
            ...orden,
            PagIdPago: pagoId,
            OrdEstadoActual: 7,
            OrdFechaEstadoActual: new Date(),
          };
        }
        return orden; // No se modifica
      });

      console.log(`Caché de órdenes actualizada con las órdenes: ${Array.from(updatedOrderNumbers).join(', ')}`);
      cache.set('ordenes', ordenesCache);
    }

    // Emitir evento de actualización
    const io = getIO();
    io.emit('actualizado', { type: 'actualizacion' });

    res.status(200).json({ message: 'Pago registrado correctamente', pagoId });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
        console.log("🔄 Rollback ejecutado correctamente.");
      } catch (rollbackError) {
        console.error("⚠ Error en rollback:", rollbackError);

        const ordenesRetiroResult = await pool.request().query('SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)');
        cache.set('ordenesRetiro', ordenesRetiroResult.recordset);

        // Emitir el evento de nueva orden a través de WebSocket
        const io = getIO();
        io.emit('actualizado', { type: 'actualizacion' });
      }
    }    
    console.error('Error al registrar el pago:', error);
    res.status(500).json({ error: 'Error al registrar el pago' });
  } finally {
    transaction = null;
  }
};



const subirComprobante = async (req, res) => {
  try {
    const { ordenRetiroId } = req.body;
    console.log('ordenRetiroId recibido:', ordenRetiroId);

    // Validar que se haya enviado un archivo y el ID de la orden
    if (!ordenRetiroId || !req.file) {
      return res.status(400).send({ error: 'Faltan datos o archivo.' });
    }

    console.log('Archivo recibido:', req.file);
    const filePath = req.file.filename; // Ruta del archivo subido

    // Actualizar la ruta del comprobante en la base de datos
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ordenRetiroId', sql.Int, ordenRetiroId)
      .input('filePath', sql.NVarChar, filePath)
      .query(`
        UPDATE Pag
        SET PagRutaComprobante = @filePath
        FROM [User].dbo.Pagos Pag WITH(NOLOCK)
        JOIN [User].dbo.OrdenesRetiro ORe WITH(NOLOCK) ON ORe.PagIdPago = Pag.PagIdPago
        WHERE ORe.OReIdOrdenRetiro = @ordenRetiroId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).send({ error: 'No se encontró la orden de retiro asociada.' });
    }

    // Respuesta exitosa
    console.log('Archivo subido y ruta guardada correctamente');
    res.status(200).send({ message: 'Archivo subido y ruta guardada correctamente', filePath });
  } catch (error) {
    console.error('Error al subir comprobante:', error);
    res.status(500).send({ error: 'Error al subir el comprobante.' });
  }
};


module.exports = { obtenerMetodosPago, realizarPago, subirComprobante };
