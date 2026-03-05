const { getPool, sql } = require('../config/db');

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
      subMarca
    } = req.query;

    let query = `
      SELECT
        o.OrdIdOrden AS IdOrden,
        o.OrdCodigoOrden AS CodigoOrden,
        sm.SMaNombreSubMarca AS SubMarca,
        c.CodigoReact AS IdCliente,
        c.CliCelular AS Celular,
        tc.TClDescripcion AS TipoCliente,
        o.OrdNombreTrabajo AS NombreTrabajo,
        CONCAT(p.ProNombreProducto, 
          CASE WHEN p.ProDetalleProducto IS NOT NULL THEN ' ' + p.ProDetalleProducto ELSE '' END
        ) AS Producto,
        ISNULL(p.ProCodigoOdooProducto, '') AS CodigoOdoo,
        o.OrdExportadoOdoo AS ExportadoOdoo,
        eo.EOrNombreEstado AS Estado,
        o.OrdFechaEstadoActual AS FechaEstado,
        CONCAT(CAST(o.OrdCantidad AS NVARCHAR(50)), ' ', uni.UniNotación) AS Cantidad,
        mon.MonSimbolo AS MonSimbolo,
        CAST(p.ProPrecioActual AS DECIMAL(10,2)) AS PrecioUnitario,
        CAST(o.OrdCostoFinal AS DECIMAL(10,2)) AS CostoFinal,
        CONCAT(CAST(o.OrdDescuentoAplicado * 100 AS INT), '%') AS DescuentoAplicado,
        mo.MOrNombreModo AS Modo,
        lr.LReNombreLugar AS LugarRetiro,
        o.OrdFechaIngresoOrden AS FechaIngresoOrden,
        o.OrdNotaCliente AS OrdNotaCliente
      FROM OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
      LEFT JOIN TiposClientes tc WITH(NOLOCK) ON c.TClIdTipoCliente = tc.TClIdTipoCliente
      LEFT JOIN Articulos p WITH(NOLOCK) ON o.ProIdProducto = p.ProIdProducto
      LEFT JOIN SubMarcas sm WITH(NOLOCK) ON p.SMaIdSubMarca = sm.SMaIdSubMarca
      LEFT JOIN EstadosOrdenes eo WITH(NOLOCK) ON o.OrdEstadoActual = eo.EOrIdEstadoOrden
      LEFT JOIN Unidades uni WITH(NOLOCK) ON p.UniIdUnidad = uni.UniIdUnidad
      LEFT JOIN Monedas mon WITH(NOLOCK) ON p.MonIdMoneda = mon.MonIdMoneda
      LEFT JOIN ModosOrdenes mo WITH(NOLOCK) ON o.MOrIdModoOrden = mo.MOrIdModoOrden
      LEFT JOIN LugaresRetiro lr WITH(NOLOCK) ON o.LReIdLugarRetiro = lr.LReIdLugarRetiro
      WHERE 1 = 1
    `;

    const request = pool.request();

    if (codigoCliente) {
      query += ` AND c.CodigoReact = @codigoCliente`;
      request.input("codigoCliente", codigoCliente);
    }
    if (codigoOrden) {
      query += ` AND o.OrdCodigoOrden LIKE '%' + @codigoOrden + '%'`;
      request.input("codigoOrden", codigoOrden);
    }
    if (fechaDesde) {
      query += ` AND o.OrdFechaIngresoOrden >= @fechaDesde`;
      request.input("fechaDesde", fechaDesde);
    }
    if (fechaHasta) {
      query += ` AND o.OrdFechaIngresoOrden <= @fechaHasta`;
      request.input("fechaHasta", fechaHasta);
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
    if (subMarca) {
      if (Array.isArray(subMarca)) {
        query += ` AND sm.SMaIdSubMarca IN (${subMarca.map((_, i) => `@subMarca${i}`).join(',')})`;
        subMarca.forEach((marca, i) => request.input(`subMarca${i}`, marca));
      } else {
        query += ` AND sm.SMaIdSubMarca = @subMarca`;
        request.input("subMarca", subMarca);
      }
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
    console.error('Error al obtener los datos:', err);
    res.status(500).json({ error: 'Error al obtener los datos' });
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
        c.CodigoReact,
        c.CliCelular,
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
    console.error('Error al obtener la orden:', err);
    res.status(500).json({ error: 'Error al obtener la orden' });
  }
};


const createOrden = async (req, res) => {
  const { ordenString } = req.body;
  const UsuarioAlta = req.user ? req.user.id : 70; // Hardcoded default to 70 as mentioned locally

  try {
    const [
      CodigoOrden,
      CodigoCliente,
      NombreTrabajo,
      IdModo,
      IdProducto,
      Cantidad,
      CostoFinal,
    ] = ordenString.split('$*');

    let cantidadDecimal = parseFloat(Cantidad.toString().replace(',', '.'));
    let costoFinalDecimal = parseFloat(CostoFinal.toString().replace(',', '.'));

    const pool = await getPool();

    const existingResult = await pool.request()
      .input('CodigoOrden', sql.VarChar(100), CodigoOrden)
      .query('SELECT o.*, r.OReIdOrdenRetiro as checkRetiro, r.OReIdOrdenRetiro as oReId, r.OReFechaEstadoActual as rEstadoActual FROM OrdenesDeposito o WITH(NOLOCK) LEFT JOIN OrdenesRetiro r WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro WHERE o.OrdCodigoOrden = @CodigoOrden');

    if (existingResult.recordset.length > 0) {
      const existingOrden = existingResult.recordset[0];
      const estadoActual = existingOrden.OrdEstadoActual;

      if (!existingOrden.checkRetiro) {
        // NO TIENE ORDEN DE RETIRO, SE ACTUALIZA 
        await pool.request()
          .input('CodigoOrden', sql.VarChar(100), CodigoOrden)
          .input('CodigoCliente', sql.Int, CodigoCliente)
          .input('NombreTrabajo', sql.VarChar(255), NombreTrabajo)
          .input('IdModo', sql.Int, IdModo)
          .input('IdProducto', sql.Int, IdProducto)
          .input('Cantidad', sql.Float, cantidadDecimal)
          .input('CostoFinal', sql.Float, costoFinalDecimal)
          .input('UsuarioAlta', sql.Int, UsuarioAlta)
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
              OrdUsuarioAlta = @UsuarioAlta
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

          return res.status(202).json({ message: 'Se actualiza el estado de la orden pues ya habia sido ingresada pero no se encontraba en depósito. ' });
        } else {
          return res.status(400).json({ error: 'ESTA ORDEN YA FUE MARCADA COMO ENTREGADA.' });
        }
      }
    }

    if (!CodigoCliente || CodigoCliente === '') {
      return res.status(403).json({ error: 'Falta campo de cliente en la etiqueta.' });
    }

    const clientQuery = await pool.request()
      .input('CodigoCliente', sql.Int, parseInt(CodigoCliente, 10))
      .input('CodigoClienteString', sql.VarChar(100), CodigoCliente)
      .query('SELECT TOP 1 CliIdCliente FROM Clientes WITH(NOLOCK) WHERE CliIdCliente = @CodigoCliente OR CodigoReact = @CodigoClienteString');

    if (clientQuery.recordset.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }
    const reqClientId = clientQuery.recordset[0].CliIdCliente;

    const productoQuery = await pool.request()
      .input('IdProducto', sql.Int, parseInt(IdProducto, 10))
      .query('SELECT TOP 1 ProIdProducto FROM Articulos WITH(NOLOCK) WHERE ProIdProducto = @IdProducto');

    if (productoQuery.recordset.length === 0) {
      return res.status(405).json({ error: 'Producto no encontrado en Articulos.' });
    }
    const monIdMoneda = 1; // Default UYU

    const result = await pool.request()
      .input('CodigoOrden', sql.VarChar(100), CodigoOrden)
      .input('Cantidad', sql.Float, cantidadDecimal)
      .input('CodigoCliente', sql.Int, reqClientId)
      .input('NombreTrabajo', sql.VarChar(100), NombreTrabajo)
      .input('IdModo', sql.Int, IdModo)
      .input('IdProducto', sql.Int, IdProducto)
      .input('CostoFinal', sql.Float, costoFinalDecimal)
      .input('FechaIngresoOrden', sql.DateTime, new Date())
      .input('UsuarioAlta', sql.Int, UsuarioAlta)
      .input('OrdEstadoActual', sql.Int, 1)
      .input('OrdFechaEstadoActual', sql.DateTime, new Date())
      .input('MonIdMoneda', sql.Int, monIdMoneda)
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
          OrdFechaEstadoActual
        )
        OUTPUT INSERTED.OrdIdOrden INTO @newOrdIdOrden
        VALUES (
          @CodigoOrden, @Cantidad, @CodigoCliente,
          @NombreTrabajo, @IdModo, @IdProducto,
          @MonIdMoneda,
          @CostoFinal, @FechaIngresoOrden, @UsuarioAlta, @OrdEstadoActual, @OrdFechaEstadoActual
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
        INSERT INTO HistoricoEstadosOrdenes (
          OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta
        ) VALUES (
          @NewOrderId, @EOrIdEstadoOrden, @HEOFechaEstado, @UsuarioAlta
        )
      `);

    const io = req.app.get('socketio');
    if (io) io.emit('actualizado', { type: 'actualizacion' });

    res.status(201).json({ message: 'Orden creada correctamente' });
  } catch (err) {
    console.error('Error al crear la orden:', err);
    res.status(500).json({ error: 'Error al crear la orden' });
  }
};


const getOrdenesEstado = async (req, res) => {
  const estados = req.query.estados.split(',').map(e => e.trim());

  try {
    const pool = await getPool();
    const request = pool.request();
    estados.forEach((est, index) => {
      request.input(`estado${index}`, sql.VarChar, est);
    });

    const inClause = estados.map((_, i) => `@estado${i}`).join(',');

    const query = `
      SELECT 
        o.OrdIdOrden AS IdOrden,
        o.OrdCodigoOrden AS CodigoOrden,
        sm.SMaNombreSubMarca AS SubMarca,
        c.CodigoReact AS IdCliente,
        c.CliCelular AS Celular,
        tc.TClDescripcion AS TipoCliente,
        o.OrdNombreTrabajo AS NombreTrabajo,
        LTRIM(RTRIM(CONCAT(p.ProNombreProducto, ' ', ISNULL(p.ProDetalleProducto, '')))) AS Producto,
        eo.EOrNombreEstado AS Estado,
        o.OrdFechaEstadoActual AS FechaEstado,
        LTRIM(RTRIM(CONCAT(CAST(o.OrdCantidad AS NVARCHAR(50)), ' ', ISNULL(uni.UniNotación, '')))) AS Cantidad,
        mon.MonSimbolo AS MonSimbolo,
        CAST(ISNULL(p.ProPrecioActual, 0) AS DECIMAL(10,2)) AS PrecioUnitario,
        CAST(ISNULL(o.OrdCostoFinal, 0) AS DECIMAL(10,2)) AS CostoFinal,
        CONCAT(CAST(ISNULL(o.OrdDescuentoAplicado, 0) * 100 AS INT), '%') AS DescuentoAplicado,
        mo.MOrNombreModo AS Modo,
        lr.LReNombreLugar AS LugarRetiro,
        o.OrdFechaIngresoOrden AS FechaIngresoOrden,
        c.CliBloqueadoBy
      FROM OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
      LEFT JOIN TiposClientes tc WITH(NOLOCK) ON c.TClIdTipoCliente = tc.TClIdTipoCliente
      LEFT JOIN Articulos p WITH(NOLOCK) ON o.ProIdProducto = p.ProIdProducto
      LEFT JOIN SubMarcas sm WITH(NOLOCK) ON p.SMaIdSubMarca = sm.SMaIdSubMarca
      LEFT JOIN EstadosOrdenes eo WITH(NOLOCK) ON o.OrdEstadoActual = eo.EOrIdEstadoOrden
      LEFT JOIN Monedas mon WITH(NOLOCK) ON p.MonIdMoneda = mon.MonIdMoneda
      LEFT JOIN Unidades uni WITH(NOLOCK) ON p.UniIdUnidad = uni.UniIdUnidad
      LEFT JOIN ModosOrdenes mo WITH(NOLOCK) ON o.MOrIdModoOrden = mo.MOrIdModoOrden
      LEFT JOIN LugaresRetiro lr WITH(NOLOCK) ON o.LReIdLugarRetiro = lr.LReIdLugarRetiro
      WHERE eo.EOrNombreEstado IN (${inClause})
    `;

    const result = await request.query(query);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener las órdenes por estados:', err);
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

          INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          VALUES (@orderId, @estadoId, @fecha, @usuario);
        `);
    }

    await transaction.commit();

    const io = req.app.get('socketio');
    if (io) io.emit('actualizado', { type: 'actualizacion' });

    res.status(200).json({ message: 'Órdenes actualizadas al nuevo estado' });
  } catch (err) {
    console.error('Error al actualizar el estado de las órdenes:', err);

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
        c.CodigoReact,
        c.CliCelular,
        c.CliNombreApellido,
        c.CliLocalidad,
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
      LEFT JOIN Articulos p ON o.ProIdProducto = p.ProIdProducto
      LEFT JOIN SubMarcas sm ON p.SMaIdSubMarca = sm.SMaIdSubMarca
      WHERE o.CliIdCliente = @CliIdCliente AND (o.OrdEstadoActual = 1 OR o.OrdEstadoActual = 6)
    `;

    const result = await pool.request()
      .input('CliIdCliente', sql.Int, cliIdCliente)
      .query(query);

    res.json(result.recordset);

  } catch (err) {
    console.error('Error al obtener las órdenes por cliente:', err);
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
    console.error('Error al obtener estados de órdenes:', err);
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
      WHERE OrdIdOrden IN (${orderIds.join(',')})
    `);

    const io = req.app.get('socketio');
    if (io) io.emit('actualizado', { type: 'actualizacion' });

    res.json({ message: 'Órdenes actualizadas correctamente.' });
  } catch (error) {
    console.error('Error al actualizar las órdenes exportadas:', error);
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
      .query(`DELETE FROM RelOrdenesRetiroOrdenes WHERE OrdIdOrden IN (${orderIdsList})`);

    await transaction.request()
      .query(`DELETE FROM OrdenesDeposito WHERE OrdIdOrden IN (${orderIdsList})`);

    await transaction.commit();

    const io = req.app.get('socketio');
    if (io) io.emit("actualizado", { type: "eliminacion" });

    res.status(200).json({ message: "Órdenes eliminadas correctamente" });
  } catch (err) {
    console.error("Error al eliminar órdenes:", err);

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
    console.error('Error al obtener los modos de órdenes:', err);
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
    if (parts.length < 2) {
      return res.status(400).json({ valid: false, error: 'Código inválido o malformado.' });
    }

    const [CodigoOrden, CodigoCliente, NombreTrabajo, IdModo, IdProducto, Cantidad, CostoFinal] = parts;

    if (!CodigoCliente || CodigoCliente === '') {
      return res.status(400).json({ valid: false, error: 'El campo cliente está vacío en la base.' });
    }

    const pool = await getPool();

    // Buscar Cliente y Tipo
    const clientQuery = await pool.request()
      .input('CodigoCliente', sql.Int, parseInt(CodigoCliente, 10))
      .input('CodigoClienteString', sql.VarChar(100), CodigoCliente)
      .query(`
        SELECT TOP 1 c.CliIdCliente, tc.TClDescripcion AS TipoCliente
        FROM Clientes c WITH(NOLOCK)
        LEFT JOIN TiposClientes tc WITH(NOLOCK) ON c.TClIdTipoCliente = tc.TClIdTipoCliente
        WHERE c.CliIdCliente = @CodigoCliente OR c.CodigoReact = @CodigoClienteString
      `);

    if (clientQuery.recordset.length === 0) {
      return res.status(404).json({ valid: false, error: 'Cliente no encontrado en el sistema.' });
    }
    const clienteData = clientQuery.recordset[0];

    // Buscar Producto Comercial
    const productoQuery = await pool.request()
      .input('IdProducto', sql.Int, parseInt(IdProducto, 10))
      .query(`
        SELECT TOP 1 
          LTRIM(RTRIM(CONCAT(p.ProNombreProducto, ' ', ISNULL(p.ProDetalleProducto, '')))) AS ProductoNombre,
          m.MonSimbolo
        FROM Productos p WITH(NOLOCK)
        LEFT JOIN Monedas m WITH(NOLOCK) ON p.MonIdMoneda = m.MonIdMoneda
        WHERE p.ProIdProducto = @IdProducto
      `);

    let productoNombre = 'Desconocido/Migrado';
    let moneda = '$U';

    if (productoQuery.recordset.length > 0) {
      productoNombre = productoQuery.recordset[0].ProductoNombre || 'Sin nombre';
      moneda = productoQuery.recordset[0].MonSimbolo || '$U';
    }

    return res.json({
      valid: true,
      data: {
        CodigoOrden,
        CodigoCliente,
        TipoCliente: clienteData.TipoCliente || 'N/A',
        NombreTrabajo,
        IdModo,
        IdProducto,
        ProductoNombre: productoNombre,
        Cantidad: parseFloat(Cantidad?.toString()?.replace(',', '.') || 0),
        CostoFinal: parseFloat(CostoFinal?.toString()?.replace(',', '.') || 0),
        Moneda: moneda
      }
    });

  } catch (err) {
    console.error('Error en parseQROrden:', err);
    return res.status(500).json({ valid: false, error: 'Error interno validando.' });
  }
};

module.exports = { getOrdenesByFilter, createOrden, getOrdenByCodigo, getOrdenesClienteByOrden, getOrdenesEstado, updateOrdenEstado, getEstadosOrdenes, updateExportacion, eliminarOrdenes, getModosOrdenes, parseQROrden };
