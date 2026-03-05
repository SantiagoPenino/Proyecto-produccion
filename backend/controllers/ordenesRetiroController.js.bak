// ordenesRetiroController.js
const sql = require('mssql');
const { poolPromise } = require('../config/db');
const moment = require('moment-timezone');
const cache = require('../cache'); // Importa la caché

// Importar el servidor de WebSocket
const { getIO } = require('../socket');  

// Controlador para crear una Orden de Retiro
const createOrdenRetiro = async (req, res) => {
  const { orders, totalCost, lugarRetiro } = req.body;
  //const UsuarioAlta = req.user.id; // Obtener el ID del usuario autenticado
  const UsuarioAlta = req.user?.id || 70; // Si el token no trae ID, usamos PRODUCCION (70)agregado yoania paa retiro desde fuera
  console.log('Contenido de orders:', orders);
  const fechaActual = new Date();

  // Iniciar transacción
  const pool = await poolPromise;  
  let transaction;
  ;
  try {
    // Verificar y cargar las cachés necesarias
    const requiredCaches = ['clientes','tiposClientes','ordenes', 'ordenesRetiro'];
    for (const cacheName of requiredCaches) {
      let cacheData = cache.get(cacheName);
      if (!cacheData) {
        console.log(`Cargando caché de ${cacheName} desde la base de datos...`);
        const queryMap = {
          clientes: 'SELECT * FROM [User].dbo.Clientes WITH(NOLOCK)',
          tiposClientes: 'SELECT * FROM [User].dbo.TiposClientes WITH(NOLOCK)',
          ordenes: 'SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OrdFechaIngresoOrden as date) OR OrdEstadoActual NOT IN (9,10)',
          ordenesRetiro: 'SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)'
        };

        const result = await pool.request().query(queryMap[cacheName]);
        cacheData = result.recordset;
        cache.set(cacheName, cacheData);
      }
    }

    const clientesCache = cache.get('clientes');
    const tiposClientesCache = cache.get('tiposClientes');
    const updatedOrdenes = cache.get('ordenes') || [];

      // Suponemos que orders contiene un listado de códigos de órdenes (OrdCodigoOrden)
    const orderCode = orders[0]?.orderNumber; // Tomar la primera orden como referencia
    if (!orderCode) {
      console.error('No se proporcionaron órdenes válidas.');
      return null;
    }

    // Buscar la orden en la caché de órdenes
    const orden = updatedOrdenes.find(o => o.OrdCodigoOrden === orderCode);
    if (!orden) {
      console.error(`Orden con código ${orderCode} no encontrada en la caché.`);
      return null;
    }

    // Buscar el cliente asociado a la orden
    const cliente = clientesCache.find(c => c.CliIdCliente === orden.CliIdCliente);
    if (!cliente) {
      console.error(`Cliente con ID ${orden.CliIdCliente} no encontrado en la caché.`);
      return null;
    }

    // Buscar el tipo de cliente en la caché de tipos de clientes
    const tipoCliente = tiposClientesCache.find(tc => tc.TClIdTipoCliente === cliente.TClIdTipoCliente);
    if (!tipoCliente) {
      console.error(`Tipo de cliente con ID ${cliente.TClIdTipoCliente} no encontrado en la caché.`);
      return null;
    }

    let estadoOrdenRetiro = 1;
    if (tipoCliente.TClIdTipoCliente === 2 || tipoCliente.TClIdTipoCliente === 3) {
      estadoOrdenRetiro = 4;
    }

    transaction = await pool.transaction();
    await transaction.begin();

    // Insertar la Orden de Retiro
    const insertOrdenRetiro = await transaction.request()
      .input('OReCostoTotalOrden', sql.Float, totalCost)
      .input('LReIdLugarRetiro', sql.Int, lugarRetiro)
      .input('OReFechaAlta', sql.DateTime, fechaActual)
      .input('OReUsuarioAlta', sql.Int, UsuarioAlta)
      .input('estadoOrdenRetiro', sql.Int, estadoOrdenRetiro)
      .query(`
        INSERT INTO [User].dbo.OrdenesRetiro (
          OReCostoTotalOrden,
          LReIdLugarRetiro,
          OReFechaAlta,
          OReUsuarioAlta,
          OReEstadoActual,
          OReFechaEstadoActual
        ) 
        VALUES (
          @OReCostoTotalOrden, 
          @LReIdLugarRetiro, 
          @OReFechaAlta, 
          @OReUsuarioAlta,
          @estadoOrdenRetiro,
          GETDATE()
        );

        SELECT SCOPE_IDENTITY() AS OReIdOrdenRetiro;
      `);

    const OReIdOrdenRetiro = insertOrdenRetiro.recordset[0].OReIdOrdenRetiro;

    // Insertar el Estado Inicial "Ingresado" de la Orden de Retiro en el Histórico
    await transaction.request()
      .input('OReIdOrdenRetiro', sql.Int, OReIdOrdenRetiro)
      .input('estadoOrdenRetiro', sql.Int, estadoOrdenRetiro)
      .input('HEOFechaEstado', sql.DateTime, fechaActual)
      .input('HEOUsuarioAlta', sql.Int, UsuarioAlta)
      .query(`
        INSERT INTO [User].dbo.HistoricoEstadosOrdenesRetiro (
          OReIdOrdenRetiro,
          EORIdEstadoOrden,
          HEOFechaEstado,
          HEOUsuarioAlta
        )
        VALUES (
          @OReIdOrdenRetiro,
          @estadoOrdenRetiro, 
          @HEOFechaEstado, 
          @HEOUsuarioAlta
        );
      `);

    // Obtener los IDs de las órdenes en un solo paso
    const orderNumbers = orders.map(order => `'${order.orderNumber}'`).join(',');
    const selectQuery = `
      SELECT OrdIdOrden, OrdCodigoOrden, OrdEstadoActual, OrdFechaEstadoActual 
      FROM [User].dbo.Ordenes WITH(NOLOCK) 
      WHERE OrdCodigoOrden IN (${orderNumbers})
    `;

    const orderIdResults = await transaction.request().query(selectQuery);

    if (orderIdResults.recordset.length === 0) {
      throw new Error('No se encontraron órdenes para los códigos proporcionados.');
    }

    // Mapear las órdenes encontradas por código para un acceso rápido
    const orderMap = Object.fromEntries(orderIdResults.recordset.map(order => [order.OrdCodigoOrden, order]));

    // Insertar las relaciones en lote
    const relacionesValues = orders.map(order => {
      const orderId = orderMap[order.orderNumber].OrdIdOrden;
      return `(${OReIdOrdenRetiro}, ${orderId})`;
    }).join(',');

    await transaction.request().query(`
      INSERT INTO [User].dbo.RelOrdenesRetiroOrdenes (OReIdOrdenRetiro, OrdIdOrden)
      VALUES ${relacionesValues};
    `);

    // Actualizar las órdenes en lote
    const updateCasesLugar = orders.map(order => {
      const orderId = orderMap[order.orderNumber].OrdIdOrden;
      return `WHEN OrdIdOrden = ${orderId} THEN ${lugarRetiro}`;
    }).join(' ');

    const updateCasesOrdenRetiro = orders.map(order => {
      const orderId = orderMap[order.orderNumber].OrdIdOrden;
      return `WHEN OrdIdOrden = ${orderId} THEN ${OReIdOrdenRetiro}`;
    }).join(' ');

    await transaction.request().query(`
      UPDATE [User].dbo.Ordenes
      SET 
        LReIdLugarRetiro = CASE ${updateCasesLugar} END,
        OReIdOrdenRetiro = CASE ${updateCasesOrdenRetiro} END,
        OrdEstadoActual = 4,
        OrdFechaEstadoActual = GETDATE()
      WHERE OrdIdOrden IN (${orderIdResults.recordset.map(o => o.OrdIdOrden).join(',')});
    `);

    // Insertar el histórico en lote
    const historicoValues = orders.map(order => {
      const orderId = orderMap[order.orderNumber].OrdIdOrden;
      return `(${orderId}, 4, GETDATE(), ${UsuarioAlta})`;
    }).join(',');

    await transaction.request().query(`
      INSERT INTO [User].dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      VALUES ${historicoValues};
    `);

    // Confirmar la transacción
    await transaction.commit();

    // Actualizar la caché local de órdenes
    orders.forEach(order => {
      const ordenIndex = updatedOrdenes.findIndex(o => o.OrdCodigoOrden === order.orderNumber);
      if (ordenIndex >= 0) {
        updatedOrdenes[ordenIndex] = {
          ...updatedOrdenes[ordenIndex],
          OReIdOrdenRetiro,
          LReIdLugarRetiro: parseInt(lugarRetiro,10),
          OrdEstadoActual: 4,
          OrdFechaEstadoActual: new Date(),
        };
      }
    });
    cache.set('ordenes', updatedOrdenes);

    // Actualizar la caché de órdenes de retiro
    const updatedOrdenesRetiro = cache.get('ordenesRetiro') || [];
    updatedOrdenesRetiro.push({
      OReIdOrdenRetiro,
      OReCostoTotalOrden: totalCost,
      LReIdLugarRetiro: parseInt(lugarRetiro,10),
      OReFechaAlta: fechaActual,
      OReUsuarioAlta: UsuarioAlta,
      OReEstadoActual: estadoOrdenRetiro,
      OReFechaEstadoActual: fechaActual,
    });
    cache.set('ordenesRetiro', updatedOrdenesRetiro);

    // Emitir el evento de nueva orden a través de WebSocket
    const io = getIO();
    io.emit('actualizado', { type: 'actualizacion' });

    res.status(201).json({
      message: 'Orden de retiro creada correctamente y órdenes actualizadas',
      OReIdOrdenRetiro,
    });
  } catch (err) {
    console.error('Error al crear la orden de retiro:', err);
    if (transaction) {
      try {
        await transaction.rollback();
        console.log("🔄 Rollback ejecutado correctamente.");
      } catch (rollbackError) {
        console.error("⚠ Error en rollback:", rollbackError);

        const ordenesResult = await pool.request().query('SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OrdFechaIngresoOrden as date) OR OrdEstadoActual NOT IN (9,10)');
        cache.set('ordenes', ordenesResult.recordset);

        const ordenesRetiroResult = await pool.request().query('SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)');
        cache.set('ordenesRetiro', ordenesRetiroResult.recordset);

        // Emitir el evento de nueva orden a través de WebSocket
        const io = getIO();
        io.emit('actualizado', { type: 'actualizacion' });
      }
    }    
    res.status(500).json({ error: 'Error al crear la orden de retiro' });
    
  } finally {
    transaction = null; // 🔹 Asegurar que no quede abierta la transacción
  } 
};

const getOrdenesRetiroPorEstados = async (req, res) => {
  const estados = req.query.estados.split(','); // Dividir los estados por coma

  try {
    // Verificar y cargar las cachés necesarias
    const requiredCaches = ['ordenesRetiro', 'ordenes', 'lugaresRetiro', 'estadosOrdenesRetiro', 'clientes', 'tiposClientes', 'pagos', 'monedas','metodosPagos'];
    for (const cacheName of requiredCaches) {
      if (!cache.get(cacheName)) {
        console.log(`Cargando caché de ${cacheName} desde la base de datos...`);
        const queryMap = {
          ordenesRetiro: 'SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)',
          ordenes: 'SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OrdFechaIngresoOrden as date) OR OrdEstadoActual NOT IN (9,10)',
          lugaresRetiro: 'SELECT * FROM [User].dbo.LugaresRetiro WITH(NOLOCK)',
          estadosOrdenesRetiro: 'SELECT * FROM [User].dbo.EstadosOrdenesRetiro WITH(NOLOCK)',
          clientes: 'SELECT * FROM [User].dbo.Clientes WITH(NOLOCK)',
          tiposClientes: 'SELECT * FROM [User].dbo.TiposClientes WITH(NOLOCK)',
          pagos: 'SELECT * FROM [User].dbo.Pagos WITH(NOLOCK)',
          monedas: 'SELECT * FROM [User].dbo.Monedas WITH(NOLOCK)',
          metodosPagos: 'SELECT * FROM [User].dbo.MetodosPagos WITH(NOLOCK)'
        };
        const pool = await poolPromise;
        const result = await pool.request().query(queryMap[cacheName]);
        cache.set(cacheName, result.recordset);
      }
    }

    // Obtener datos desde las cachés
    const ordenesRetiroCache = cache.get('ordenesRetiro');
    const ordenesCache = cache.get('ordenes');
    const lugaresRetiroCache = cache.get('lugaresRetiro');
    const estadosOrdenesRetiroCache = cache.get('estadosOrdenesRetiro');
    const clientesCache = cache.get('clientes');
    const tiposClientesCache = cache.get('tiposClientes');
    const pagosCache = cache.get('pagos');
    const monedasCache = cache.get('monedas');
    const metodosPagos = cache.get('metodosPagos');

    // Filtrar las órdenes de retiro por los estados solicitados
    const estadosFiltrados = estadosOrdenesRetiroCache.filter(e => estados.includes(e.EORNombreEstado));
    const estadosIds = estadosFiltrados.map(e => e.EORIdEstadoOrden);

    const filteredOrdenesRetiro = ordenesRetiroCache.filter(o => estadosIds.includes(o.OReEstadoActual));

    // Construir la respuesta uniendo las cachés
    const ordenesRetiro = filteredOrdenesRetiro.map(orderRetiro => {
      const lugarRetiro = lugaresRetiroCache.find(l => l.LReIdLugarRetiro === orderRetiro.LReIdLugarRetiro);
      const estadoOrden = estadosOrdenesRetiroCache.find(e => e.EORIdEstadoOrden === orderRetiro.OReEstadoActual);
      const ordenesAsociadas = ordenesCache.filter(o => o.OReIdOrdenRetiro === orderRetiro.OReIdOrdenRetiro);

      // Enriquecer las órdenes asociadas
      const enrichedOrdenes = ordenesAsociadas.map(order => {
        const cliente = clientesCache.find(c => c.CliIdCliente === order.CliIdCliente);
        const tipoCliente = tiposClientesCache.find(tc => tc.TClIdTipoCliente === cliente?.TClIdTipoCliente);
        const pago = pagosCache.find(p => p.PagIdPago === order.PagIdPago);
        const monedaPago = monedasCache.find(m => m.MonIdMoneda === pago?.PagIdMonedaPago);
        const monedaOrden = monedasCache.find(m => m.MonIdMoneda === order.MonIdMoneda);
        const metodoPago = metodosPagos.find(mp => mp.MPaIdMetodoPago === pago?.MPaIdMetodoPago);

        return {
          orderNumber: order.OrdCodigoOrden,
          orderId: order.OrdIdOrden,
          orderEstado: order.OrdEstadoActual,
          orderCosto: monedaOrden ? `${monedaOrden.MonSimbolo} ${parseFloat(order.OrdCostoFinal).toFixed(2)}` : null,
          orderIdMetodoPago: pago?.MPaIdMetodoPago || null,
          orderMetodoPago: metodoPago?.MPaDescripcionMetodo || null,
          orderPago: monedaPago ? `${monedaPago.MonSimbolo} ${parseFloat(pago.PagMontoPago).toFixed(2)}` : null,
          orderFechaPago: pago?.PagFechaPago || null,
        };
      });

      return {
        ordenDeRetiro: `R-${String(orderRetiro.OReIdOrdenRetiro).padStart(4, '0')}`,
        totalCost: parseFloat(orderRetiro.OReCostoTotalOrden).toFixed(2),
        lugarRetiro: lugarRetiro?.LReNombreLugar || 'Desconocido',
        fechaAlta: orderRetiro.OReFechaAlta,
        usuarioAlta: orderRetiro.OReUsuarioAlta,
        estado: estadoOrden?.EORNombreEstado || 'Desconocido',
        orders: enrichedOrdenes,
        pagorealizado: orderRetiro.PagIdPago ? 1 : 0,
        metodoPago: metodosPagos.find(mp => mp.MPaIdMetodoPago === pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.MPaIdMetodoPago)?.MPaDescripcionMetodo,
        montopagorealizado: orderRetiro.PagIdPago
          ? `${monedasCache.find(m => m.MonIdMoneda === pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagIdMonedaPago)?.MonSimbolo || ''} ${parseFloat(pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagMontoPago || 0).toFixed(2)}`
          : null,
        fechapagooden: pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagFechaPago || null,
        comprobante: pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagRutaComprobante,
        CliCodigoCliente: clientesCache.find(c => c.CliIdCliente === ordenesAsociadas[0]?.CliIdCliente)?.CliCodigoCliente || 'Desconocido',
        TClDescripcion: tiposClientesCache.find(tc => tc.TClIdTipoCliente === clientesCache.find(c => c.CliIdCliente === ordenesAsociadas[0]?.CliIdCliente)?.TClIdTipoCliente)?.TClDescripcion || 'Desconocido',
      };
    });

    console.log('Ordenes de retiro cargadas desde la caché');

    res.json(ordenesRetiro);
  } catch (err) {
    console.error('Error al obtener las órdenes de retiro:', err);
    res.status(500).json({ error: 'Error al obtener las órdenes de retiro' });
  }
};

const actualizarOrdenRetiroEstado = async (req, res) => {
  const { ordenDeRetiro, nuevoEstado } = req.body;
  const fechaActual = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
  const UsuarioAlta = req.user.id; // Obtener el ID del usuario autenticado
  const pool = await poolPromise;
  let transaction;
  
  try {
    const OReIdOrdenRetiro = parseInt(ordenDeRetiro.replace('R-', ''), 10);

    // Verificar y cargar cachés necesarias
    const requiredCaches = ['estadosOrdenesRetiro','ordenesRetiro'];
    for (const cacheName of requiredCaches) {
      if (!cache.get(cacheName)) {
        console.log(`Cargando caché de ${cacheName} desde la base de datos...`);
        const queryMap = {
          ordenesRetiro: 'SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)',
          estadosOrdenesRetiro: 'SELECT * FROM [User].dbo.EstadosOrdenesRetiro WITH(NOLOCK)',
        };
        const result = await pool.request().query(queryMap[cacheName]);
        cache.set(cacheName, result.recordset);
      }
    }

    // Obtener datos desde las cachés
    const estadosOrdenesRetiroCache = cache.get('estadosOrdenesRetiro');
    const ordenesRetiroCache = cache.get('ordenesRetiro');

    // Obtener el ID del nuevo estado desde la caché
    const estado = estadosOrdenesRetiroCache.find(e => e.EORNombreEstado === nuevoEstado);
    if (!estado) {
      throw new Error(`Estado "${nuevoEstado}" no encontrado`);
    }
    const estadoId = estado.EORIdEstadoOrden;

    // Actualizar el estado de la orden de retiro segun el estado del parametro
    const updateOrdenRetiroQuery = `
      UPDATE [User].dbo.OrdenesRetiro
      SET OReEstadoActual = ${estadoId},
          OReFechaEstadoActual = '${fechaActual}'
      WHERE OReIdOrdenRetiro = ${OReIdOrdenRetiro};

      INSERT INTO [User].dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      VALUES (${OReIdOrdenRetiro}, ${estadoId}, '${fechaActual}', ${UsuarioAlta});
    `;

    transaction = await pool.transaction();
    await transaction.begin();

    await transaction.request().query(updateOrdenRetiroQuery);

    // Confirmar la transacción
    await transaction.commit();

    const updatedOrdenRetiro = ordenesRetiroCache.map(o => {
      if (o.OReIdOrdenRetiro === OReIdOrdenRetiro) {
        return {
          ...o,
          OReEstadoActual: estadoId,
          OReFechaEstadoActual: new Date(fechaActual),
        };
      }
      return o;
    });
    cache.set('ordenesRetiro', updatedOrdenRetiro);

    // Emitir el evento de actualización a través de WebSocket
    const io = getIO();
    io.emit('actualizado', { type: 'actualizacion' });

    res.status(200).json({
      message: 'Órden de retiro actualizada',
    });
  } catch (err) {
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
  } finally {
    transaction = null; // 🔹 Asegurar que no quede abierta la transacción
  }
};


const marcarOrdenRetiroPronto = async (req, res) => {
  const { ordenDeRetiro, scannedValues } = req.body;
  const fechaActual = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
  const UsuarioAlta = req.user.id; // Obtener el ID del usuario autenticado
  const pool = await poolPromise;
  let transaction;
  
  try {
    const OReIdOrdenRetiro = parseInt(ordenDeRetiro.replace('R-', ''), 10);

    // Verificar y cargar cachés necesarias
    const requiredCaches = ['ordenes', 'ordenesRetiro'];
    for (const cacheName of requiredCaches) {
      if (!cache.get(cacheName)) {
        console.log(`Cargando caché de ${cacheName} desde la base de datos...`);
        const queryMap = {
          ordenes: 'SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OrdFechaIngresoOrden as date) OR OrdEstadoActual NOT IN (9,10)',
          ordenesRetiro: 'SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)',
        };
        const result = await pool.request().query(queryMap[cacheName]);
        cache.set(cacheName, result.recordset);
      }
    }

    // Obtener datos desde las cachés
    const ordenesCache = cache.get('ordenes');
    const ordenesRetiroCache = cache.get('ordenesRetiro');

    // Filtrar las órdenes escaneadas desde la caché
    const ordenesEscaneadas = ordenesCache.filter(o => scannedValues.includes(o.OrdCodigoOrden));

    if (ordenesEscaneadas.length === 0) {
      throw new Error('No se encontraron órdenes coincidentes en la base de datos.');
    }

    // Preparar actualizaciones para las órdenes escaneadas
    const ordenesIds = ordenesEscaneadas.map(o => o.OrdIdOrden).join(', ');
    const updateOrdenesQuery = `
      UPDATE [User].dbo.Ordenes
      SET OrdEstadoActual = 7,
          OrdFechaEstadoActual = '${fechaActual}'
      WHERE OrdIdOrden IN (${ordenesIds});

      INSERT INTO [User].dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      SELECT OrdIdOrden, 7, '${fechaActual}', ${UsuarioAlta}
      FROM [User].dbo.Ordenes
      WHERE OrdIdOrden IN (${ordenesIds});
    `;

    transaction = await pool.transaction();
    await transaction.begin();

    await transaction.request().query(updateOrdenesQuery);

    // Actualizar el estado de la orden de retiro a "empaquetado" segun corresponda
    // Encontrar la orden de retiro en la caché
    const ordenRetiro = ordenesRetiroCache.find(o => o.OReIdOrdenRetiro === OReIdOrdenRetiro);

    if (!ordenRetiro) {
      throw new Error(`No se encontró la orden de retiro con ID: ${OReIdOrdenRetiro}`);
    }

    // Determinar el nuevo estado basado en el estado actual
    let nuevoEstado;
    if (ordenRetiro.OReEstadoActual === 1) {
      nuevoEstado = 7;
    } else {
      nuevoEstado = 8;
    } 

    // Construir la consulta SQL con el estado nuevo
    const updateOrdenRetiroQuery = `
      UPDATE [User].dbo.OrdenesRetiro
      SET OReEstadoActual = ${nuevoEstado},
          OReFechaEstadoActual = '${fechaActual}'
      WHERE OReIdOrdenRetiro = ${OReIdOrdenRetiro};

      INSERT INTO [User].dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      VALUES (${OReIdOrdenRetiro}, ${nuevoEstado}, '${fechaActual}', ${UsuarioAlta});
    `;

    // Ejecutar la consulta
    await transaction.request().query(updateOrdenRetiroQuery);

    // Confirmar la transacción
    await transaction.commit();

    // Actualizar las cachés
    const updatedOrdenesCache = ordenesCache.map(o => {
      if (scannedValues.includes(o.OrdCodigoOrden)) {
        return {
          ...o,
          OrdEstadoActual: 7,
          OrdFechaEstadoActual: new Date(fechaActual),
        };
      }
      return o;
    });
    cache.set('ordenes', updatedOrdenesCache);

    const updatedOrdenRetiro = ordenesRetiroCache.map(o => {
      if (o.OReIdOrdenRetiro === OReIdOrdenRetiro) {
        return {
          ...o,
          OReEstadoActual: nuevoEstado,
          OReFechaEstadoActual: new Date(fechaActual),
        };
      }
      return o;
    });

    cache.set('ordenesRetiro', updatedOrdenRetiro);

    // Emitir el evento de actualización a través de WebSocket
    const io = getIO();
    io.emit('actualizado', { type: 'actualizacion' });

    res.status(200).json({
      message: 'Órdenes escaneadas marcadas como Pronto y orden de retiro actualizada a estado a Pronto',
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
        console.log("🔄 Rollback ejecutado correctamente.");
      } catch (rollbackError) {
        console.error("⚠ Error en rollback:", rollbackError);

        const ordenesResult = await pool.request().query('SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OrdFechaIngresoOrden as date) OR OrdEstadoActual NOT IN (9,10)');
        cache.set('ordenes', ordenesResult.recordset);

        const ordenesRetiroResult = await pool.request().query('SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)');
        cache.set('ordenesRetiro', ordenesRetiroResult.recordset);

        // Emitir el evento de nueva orden a través de WebSocket
        const io = getIO();
        io.emit('actualizado', { type: 'actualizacion' });
      }
    }
    console.error('Error al marcar las órdenes escaneadas y actualizar la orden de retiro:', err);      
    res.status(500).json({
      error: 'Error al marcar las órdenes escaneadas y actualizar la orden de retiro',
    }); 
  } finally {
    transaction = null;
  }
};

const ordenesRetiroCaja = async (req, res) => {
  try {
    const pool = await poolPromise;

    // Verificar y cargar las cachés necesarias
    const requiredCaches = ['ordenesRetiro', 'lugaresRetiro', 'ordenes', 'clientes', 'monedas', 'estadosOrdenes', 'estadosOrdenesRetiro'];
    for (const cacheName of requiredCaches) {
      if (!cache.get(cacheName)) {
        console.log(`Cargando caché de ${cacheName} desde la base de datos...`);
        const queryMap = {
          ordenesRetiro: 'SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)',
          lugaresRetiro: 'SELECT * FROM [User].dbo.LugaresRetiro WITH(NOLOCK)',
          ordenes: 'SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OrdFechaIngresoOrden as date) OR OrdEstadoActual NOT IN (9,10)',
          clientes: 'SELECT * FROM [User].dbo.Clientes WITH(NOLOCK)',
          monedas: 'SELECT * FROM [User].dbo.Monedas WITH(NOLOCK)',
          estadosOrdenes: 'SELECT * FROM [User].dbo.EstadosOrdenes WITH(NOLOCK)',
          estadosOrdenesRetiro: 'SELECT * FROM [User].dbo.EstadosOrdenesRetiro WITH(NOLOCK)',
        };
        const result = await pool.request().query(queryMap[cacheName]);
        cache.set(cacheName, result.recordset);
      }
    }

    // Obtener datos desde las cachés
    const ordenesRetiroCache = cache.get('ordenesRetiro');
    const lugaresRetiroCache = cache.get('lugaresRetiro');
    const ordenesCache = cache.get('ordenes');
    const clientesCache = cache.get('clientes');
    const monedasCache = cache.get('monedas');
    const estadosOrdenesCache = cache.get('estadosOrdenes');
    const estadosOrdenesRetiroCache = cache.get('estadosOrdenesRetiro');

    // Filtrar órdenes de retiro las cuales cumplan las siguientes condiciones:
    // Que no esten pagas
    // Que sean ordenes de clientes comunes
    // Que sean para retiro en el local

    const ordenesRetiroCaja = ordenesRetiroCache.filter((ordenRetiro) => {
      // Filtrar las órdenes asociadas a esta orden de retiro
      const ordenesAsociadas = ordenesCache.filter((orden) => orden.OReIdOrdenRetiro === ordenRetiro.OReIdOrdenRetiro);
    
      // Verificar si alguna de las órdenes asociadas pertenece a un cliente de tipo 1 (Comun)
      const tieneClienteTipo1 = ordenesAsociadas.some((orden) => {
        const cliente = clientesCache.find((cliente) => cliente.CliIdCliente === orden.CliIdCliente);
        return cliente && cliente.TClIdTipoCliente === 1;
      });

      // Verificar si alguna de las órdenes asociadas no tiene PagIdPago
      const tieneOrdenSinPago = ordenesAsociadas.some((orden) => !orden.PagIdPago);

      // Aplicar las demás condiciones
      return (ordenRetiro.OReEstadoActual === 1 || ordenRetiro.OReEstadoActual === 7 ) && 
             (!ordenRetiro.PagIdPago || 
             tieneOrdenSinPago) &&
             ordenRetiro.LReIdLugarRetiro === 5 && 
             tieneClienteTipo1;
    });    

    // Preparar los datos agrupados
    const ordenesRetiroMap = {};

    ordenesRetiroCaja.forEach((ordenRetiro) => {
      const lugarRetiro = lugaresRetiroCache.find((l) => l.LReIdLugarRetiro === ordenRetiro.LReIdLugarRetiro);
      const estadoOrdenRetiro = estadosOrdenesRetiroCache.find((e) => e.EORIdEstadoOrden === ordenRetiro.OReEstadoActual);

      // Órdenes individuales asociadas
      const ordenes = ordenesCache
        .filter((o) => o.OReIdOrdenRetiro === ordenRetiro.OReIdOrdenRetiro)
        .map((orden) => {
          const cliente = clientesCache.find((c) => c.CliIdCliente === orden.CliIdCliente);
          const moneda = monedasCache.find((m) => m.MonIdMoneda === orden.MonIdMoneda);
          const estadoOrden = estadosOrdenesCache.find((e) => e.EOrIdEstadoOrden === orden.OrdEstadoActual);

          return {
            orderId: orden.OrdIdOrden,
            codigoOrden: orden.OrdCodigoOrden,
            costoFinal: parseFloat(orden.OrdCostoFinal).toFixed(2),
            pagoRealizado: orden.PagIdPago ? 1 : 0,
            fechaIngresoOrden: orden.OrdFechaIngresoOrden,
            estadoOrden: estadoOrden ? estadoOrden.EOrNombreEstado : 'Desconocido',
            moneda: {
              id: moneda ? moneda.MonIdMoneda : null,
              simbolo: moneda ? moneda.MonSimbolo : 'Desconocido',
            },
            cliente: {
              id: cliente ? cliente.CliIdCliente : null,
              codigo: cliente ? cliente.CliCodigoCliente : 'Desconocido',
              nombreApellido: cliente ? cliente.CliNombreApellido : 'Desconocido',
              celular: cliente ? cliente.CliCelular : 'Desconocido',
            },
          };
        });

      // Agregar al mapa de órdenes de retiro
      ordenesRetiroMap[ordenRetiro.OReIdOrdenRetiro] = {
        ordenDeRetiro: `R-${String(ordenRetiro.OReIdOrdenRetiro).padStart(4, '0')}`,
        totalCost: parseFloat(ordenRetiro.OReCostoTotalOrden).toFixed(2),
        lugarRetiro: lugarRetiro ? lugarRetiro.LReNombreLugar : 'Desconocido',
        fechaAlta: ordenRetiro.OReFechaAlta,
        estadoRetiro: estadoOrdenRetiro ? estadoOrdenRetiro.EORNombreEstado : 'Desconocido',
        ordenes,
      };
    });

    // Convertir el mapa a un arreglo para enviar la respuesta
    const ordenesRetiro = Object.values(ordenesRetiroMap);

    res.status(200).json(ordenesRetiro);
  } catch (err) {
    console.error('Error al obtener las órdenes de retiro para caja:', err);
    res.status(500).json({ error: 'Error al obtener las órdenes de retiro para caja' });
  }
};


const marcarOrdenRetiroEntregado = async (req, res) => {
  const { ordenDeRetiro } = req.body;
  const fechaActual = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
  const UsuarioAlta = req.user.id; // Obtener el ID del usuario autenticado
  const pool = await poolPromise;
  let transaction;
  
  try {
    const OReIdOrdenRetiro = parseInt(ordenDeRetiro.replace('R-', ''), 10);

    // Verificar y cargar cachés necesarias
    const requiredCaches = ['ordenes', 'ordenesRetiro'];
    for (const cacheName of requiredCaches) {
      if (!cache.get(cacheName)) {
        console.log(`Cargando caché de ${cacheName} desde la base de datos...`);
        const queryMap = {
          ordenes: 'SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OrdFechaIngresoOrden as date) OR OrdEstadoActual NOT IN (9,10)',
          ordenesRetiro: 'SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)',
        };
        const result = await pool.request().query(queryMap[cacheName]);
        cache.set(cacheName, result.recordset);
      }
    }

    // Obtener datos desde las cachés
    const ordenesCache = cache.get('ordenes');
    const ordenesRetiroCache = cache.get('ordenesRetiro');

    // Preparar actualizaciones para las órdenes escaneadas
    const updateOrdenesQuery = `
      UPDATE [User].dbo.Ordenes
      SET OrdEstadoActual = 9,
          OrdFechaEstadoActual = '${fechaActual}'
      WHERE OReIdOrdenRetiro = ${OReIdOrdenRetiro};

      INSERT INTO [User].dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      SELECT OrdIdOrden, 9, '${fechaActual}', ${UsuarioAlta}
      FROM [User].dbo.Ordenes
      WHERE OReIdOrdenRetiro = ${OReIdOrdenRetiro};
    `;

    transaction = await pool.transaction();
    await transaction.begin();

    await transaction.request().query(updateOrdenesQuery);

    // Actualizar el estado de la orden de retiro a "Entregado"
    const updateOrdenRetiroQuery = `
      UPDATE [User].dbo.OrdenesRetiro
      SET OReEstadoActual = 5,
          ORePasarPorCaja = 0,
          OReFechaEstadoActual = '${fechaActual}'
      WHERE OReIdOrdenRetiro = ${OReIdOrdenRetiro};

      INSERT INTO [User].dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      VALUES (${OReIdOrdenRetiro}, 5, '${fechaActual}', ${UsuarioAlta});
    `;
    await transaction.request().query(updateOrdenRetiroQuery);

    // Confirmar la transacción
    await transaction.commit();

    // Actualizar las cachés
    const updatedOrdenesCache = ordenesCache.map(o => {
      if (o.OReIdOrdenRetiro === ordenDeRetiro) {
        return {
          ...o,
          OrdEstadoActual: 9,
          OrdFechaEstadoActual: new Date(fechaActual),
        };
      }
      return o;
    });
    cache.set('ordenes', updatedOrdenesCache);

    const updatedOrdenRetiro = ordenesRetiroCache.map(o => {
      if (o.OReIdOrdenRetiro === OReIdOrdenRetiro) {
        return {
          ...o,
          OReEstadoActual: 5,
          ORePasarPorCaja: false,
          OReFechaEstadoActual: new Date(fechaActual),
        };
      }
      return o;
    });
    cache.set('ordenesRetiro', updatedOrdenRetiro);

    // Emitir el evento de actualización a través de WebSocket
    const io = getIO();
    io.emit('actualizado', { type: 'actualizacion' });

    res.status(200).json({
      message: 'Órdenes escaneadas marcadas como Entregadas y orden de retiro actualizada a estado a Entregado',
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
        console.log("🔄 Rollback ejecutado correctamente.");
      } catch (rollbackError) {
        console.error("⚠ Error en rollback:", rollbackError);

        const ordenesResult = await pool.request().query('SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OrdFechaIngresoOrden as date) OR OrdEstadoActual NOT IN (9,10)');
        cache.set('ordenes', ordenesResult.recordset);

        const ordenesRetiroResult = await pool.request().query('SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)');
        cache.set('ordenesRetiro', ordenesRetiroResult.recordset);

        // Emitir el evento de nueva orden a través de WebSocket
        const io = getIO();
        io.emit('actualizado', { type: 'actualizacion' });
      }
    }
    console.error('Error al marcar las órdenes escaneadas y actualizar la orden de retiro:', err);    
    res.status(500).json({
      error: 'Error al marcar las órdenes escaneadas y actualizar la orden de retiro',
    });    
  } finally {
    transaction = null; // 🔹 Asegurar que no quede abierta la transacción
  }
};

// Método para obtener las órdenes de retiro que deben pasar por caja
const getOrdenesRetiroPasarPorCaja = async (req, res) => {
  try {
    // Verificar y cargar las cachés necesarias
    const requiredCaches = ['ordenesRetiro', 'ordenes', 'lugaresRetiro', 'estadosOrdenesRetiro', 'clientes', 'tiposClientes', 'pagos', 'monedas', 'metodosPagos'];
    for (const cacheName of requiredCaches) {
      if (!cache.get(cacheName)) {
        console.log(`Cargando caché de ${cacheName} desde la base de datos...`);
        const queryMap = {
          ordenesRetiro: 'SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OReFechaAlta as date) OR OreEstadoActual NOT IN (5,6)',
          ordenes: 'SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK) WHERE cast(dateadd(d,-7,getdate()) as date) <= cast(OrdFechaIngresoOrden as date) OR OrdEstadoActual NOT IN (9,10)',
          lugaresRetiro: 'SELECT * FROM [User].dbo.LugaresRetiro WITH(NOLOCK)',
          estadosOrdenesRetiro: 'SELECT * FROM [User].dbo.EstadosOrdenesRetiro WITH(NOLOCK)',
          clientes: 'SELECT * FROM [User].dbo.Clientes WITH(NOLOCK)',
          tiposClientes: 'SELECT * FROM [User].dbo.TiposClientes WITH(NOLOCK)',
          pagos: 'SELECT * FROM [User].dbo.Pagos WITH(NOLOCK)',
          monedas: 'SELECT * FROM [User].dbo.Monedas WITH(NOLOCK)',
          metodosPagos: 'SELECT * FROM [User].dbo.MetodosPagos WITH(NOLOCK)',
        };
        const pool = await poolPromise;
        const result = await pool.request().query(queryMap[cacheName]);
        cache.set(cacheName, result.recordset);
      }
    }

    // Obtener datos desde las cachés
    const ordenesRetiroCache = cache.get('ordenesRetiro');
    const ordenesCache = cache.get('ordenes');
    const lugaresRetiroCache = cache.get('lugaresRetiro');
    const estadosOrdenesRetiroCache = cache.get('estadosOrdenesRetiro');
    const clientesCache = cache.get('clientes');
    const tiposClientesCache = cache.get('tiposClientes');
    const pagosCache = cache.get('pagos');
    const monedasCache = cache.get('monedas');
    const metodosPagos = cache.get('metodosPagos');

    // Filtrar órdenes de retiro que deben pasar por caja
    const filteredOrdenesRetiro = ordenesRetiroCache.filter(o => o.ORePasarPorCaja === true);

    // Construir la respuesta uniendo las cachés
    const ordenesRetiro = filteredOrdenesRetiro.map(orderRetiro => {
      const lugarRetiro = lugaresRetiroCache.find(l => l.LReIdLugarRetiro === orderRetiro.LReIdLugarRetiro);
      const estadoOrden = estadosOrdenesRetiroCache.find(e => e.EORIdEstadoOrden === orderRetiro.OReEstadoActual);
      const ordenesAsociadas = ordenesCache.filter(o => o.OReIdOrdenRetiro === orderRetiro.OReIdOrdenRetiro);

      // Enriquecer las órdenes asociadas
      const enrichedOrdenes = ordenesAsociadas.map(order => {
        const cliente = clientesCache.find(c => c.CliIdCliente === order.CliIdCliente);
        const tipoCliente = tiposClientesCache.find(tc => tc.TClIdTipoCliente === cliente?.TClIdTipoCliente);
        const pago = pagosCache.find(p => p.PagIdPago === order.PagIdPago);
        const monedaPago = monedasCache.find(m => m.MonIdMoneda === pago?.PagIdMonedaPago);
        const monedaOrden = monedasCache.find(m => m.MonIdMoneda === order.MonIdMoneda);
        const metodoPago = metodosPagos.find(mp => mp.MPaIdMetodoPago === pago?.MPaIdMetodoPago);

        return {
          orderNumber: order.OrdCodigoOrden,
          orderId: order.OrdIdOrden,
          orderEstado: order.OrdEstadoActual,
          orderCosto: monedaOrden ? `${monedaOrden.MonSimbolo} ${parseFloat(order.OrdCostoFinal).toFixed(2)}` : null,
          orderIdMetodoPago: pago?.MPaIdMetodoPago || null,
          orderMetodoPago: metodoPago?.MPaDescripcionMetodo || null,
          orderPago: monedaPago ? `${monedaPago.MonSimbolo} ${parseFloat(pago.PagMontoPago).toFixed(2)}` : null,
          orderFechaPago: pago?.PagFechaPago || null,
        };
      });

      return {
        ordenDeRetiro: `R-${String(orderRetiro.OReIdOrdenRetiro).padStart(4, '0')}`,
        totalCost: parseFloat(orderRetiro.OReCostoTotalOrden).toFixed(2),
        lugarRetiro: lugarRetiro?.LReNombreLugar || 'Desconocido',
        fechaAlta: orderRetiro.OReFechaAlta,
        usuarioAlta: orderRetiro.OReUsuarioAlta,
        estado: estadoOrden?.EORNombreEstado || 'Desconocido',
        orders: enrichedOrdenes,
        pagorealizado: orderRetiro.PagIdPago ? 1 : 0,
        metodoPago: metodosPagos.find(mp => mp.MPaIdMetodoPago === pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.MPaIdMetodoPago)?.MPaDescripcionMetodo,
        montopagorealizado: orderRetiro.PagIdPago
          ? `${monedasCache.find(m => m.MonIdMoneda === pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagIdMonedaPago)?.MonSimbolo || ''} ${parseFloat(pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagMontoPago || 0).toFixed(2)}`
          : null,
        fechapagooden: pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagFechaPago || null,
        comprobante: pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagRutaComprobante,
        CliCodigoCliente: clientesCache.find(c => c.CliIdCliente === ordenesAsociadas[0]?.CliIdCliente)?.CliCodigoCliente || 'Desconocido',
        TClDescripcion: tiposClientesCache.find(tc => tc.TClIdTipoCliente === clientesCache.find(c => c.CliIdCliente === ordenesAsociadas[0]?.CliIdCliente)?.TClIdTipoCliente)?.TClDescripcion || 'Desconocido',
      };
    });

    console.log('Órdenes de retiro que deben pasar por caja cargadas desde la caché');

    res.status(200).json(ordenesRetiro);
  } catch (err) {
    console.error('Error al obtener las órdenes de retiro para pasar por caja:', err);
    res.status(500).json({ error: 'Error al obtener las órdenes de retiro para pasar por caja' });
  }
};


// Método para marcar una orden de retiro como que debe o no pasar por caja
const ordenesRetiroMarcarPasarPorCaja = async (req, res) => {
  const { ordenDeRetiro } = req.body;
  const { pasar } = req.params; // Recibir el parámetro (1 o 0)

  const pasarPorCaja = pasar === '1'; // Convertir a booleano

  const pool = await poolPromise;
  let transaction;

  try {
    const OReIdOrdenRetiro = parseInt(ordenDeRetiro.replace('R-', ''), 10);

    transaction = await pool.transaction();
    await transaction.begin();

    // Actualizar la base de datos
    const updateQuery = `
      UPDATE [User].dbo.OrdenesRetiro
      SET ORePasarPorCaja = @pasarPorCaja
      WHERE OReIdOrdenRetiro = @OReIdOrdenRetiro;
    `;

    const result = await transaction.request()
      .input('OReIdOrdenRetiro', sql.Int, OReIdOrdenRetiro)
      .input('pasarPorCaja', sql.Bit, pasarPorCaja)
      .query(updateQuery);

    if (result.rowsAffected[0] === 0) {
      throw new Error(`No se encontró la orden de retiro con ID: ${OReIdOrdenRetiro}`);
    }

    await transaction.commit();

    // Actualizar la caché
    const ordenesRetiroCache = cache.get('ordenesRetiro') || [];
    const updatedCache = ordenesRetiroCache.map(o => {
      if (o.OReIdOrdenRetiro === OReIdOrdenRetiro) {
        console.log(`Actualizando orden ${OReIdOrdenRetiro} en la caché`);
        return { ...o, ORePasarPorCaja: pasarPorCaja };
      }
      return o;
    });

    cache.set('ordenesRetiro', updatedCache);

    // Emitir evento de actualización
    const io = getIO();
    io.emit('actualizado', { type: 'actualizacion' });
    
    res.status(200).json({ message: 'Orden de retiro actualizada correctamente.' });
  } catch (err) {
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
    console.error('Error al marcar la orden de retiro para pasar por caja:', err);
    res.status(500).json({ error: 'Error al marcar la orden de retiro para pasar por caja' });
  } finally {
    transaction = null;
  }
};

const getOrdenesRetiroPorFecha = async (req, res) => {
  const { date, codigo } = req.query; // Obtener la fecha desde query params

  try {
    // Verificar y cargar las cachés necesarias
    const requiredCaches = ['ordenesRetiroCompletas', 'ordenesCompletas', 'lugaresRetiro', 'estadosOrdenesRetiro', 'clientes', 'tiposClientes', 'pagos', 'monedas', 'metodosPagos'];
    for (const cacheName of requiredCaches) {
      if (!cache.get(cacheName)) {
        console.log(`Cargando caché de ${cacheName} desde la base de datos...`);
        const queryMap = {
          ordenesRetiroCompletas: 'SELECT * FROM [User].dbo.OrdenesRetiro WITH(NOLOCK)',
          ordenesCompletas: 'SELECT * FROM [User].dbo.Ordenes WITH(NOLOCK)',
          lugaresRetiro: 'SELECT * FROM [User].dbo.LugaresRetiro WITH(NOLOCK)',
          estadosOrdenesRetiro: 'SELECT * FROM [User].dbo.EstadosOrdenesRetiro WITH(NOLOCK)',
          clientes: 'SELECT * FROM [User].dbo.Clientes WITH(NOLOCK)',
          tiposClientes: 'SELECT * FROM [User].dbo.TiposClientes WITH(NOLOCK)',
          pagos: 'SELECT * FROM [User].dbo.Pagos WITH(NOLOCK)',
          monedas: 'SELECT * FROM [User].dbo.Monedas WITH(NOLOCK)',
          metodosPagos: 'SELECT * FROM [User].dbo.MetodosPagos WITH(NOLOCK)'
        };
        const pool = await poolPromise;
        const result = await pool.request().query(queryMap[cacheName]);
        cache.set(cacheName, result.recordset);
      }
    }

    // Obtener datos desde las cachés
    const ordenesRetiroCache = cache.get('ordenesRetiroCompletas');
    const ordenesCache = cache.get('ordenesCompletas');
    const lugaresRetiroCache = cache.get('lugaresRetiro');
    const estadosOrdenesRetiroCache = cache.get('estadosOrdenesRetiro');
    const clientesCache = cache.get('clientes');
    const tiposClientesCache = cache.get('tiposClientes');
    const pagosCache = cache.get('pagos');
    const monedasCache = cache.get('monedas');
    const metodosPagos = cache.get('metodosPagos');

    // Filtrar las órdenes de retiro por fecha y codigo si se proporciona

    const filteredOrdenesRetiro = ordenesRetiroCache.filter(o => {
      if (!o.OReFechaAlta) return false; // Evita errores si es null

      const fechaAlta = new Date(o.OReFechaAlta).toISOString().split('T')[0];
  
      // Condiciones dinámicas según los parámetros recibidos
      const filtrarPorFecha = req.query.date ? fechaAlta === req.query.date : true;
      const filtrarPorCodigo = req.query.codigo ? o.OReIdOrdenRetiro == req.query.codigo : true;

      return filtrarPorFecha && filtrarPorCodigo;
      
    });

    // Construcción de respuesta con datos enriquecidos
    const ordenesRetiro = filteredOrdenesRetiro.map(orderRetiro => {
      const lugarRetiro = lugaresRetiroCache.find(l => l.LReIdLugarRetiro === orderRetiro.LReIdLugarRetiro);
      const estadoOrden = estadosOrdenesRetiroCache.find(e => e.EORIdEstadoOrden === orderRetiro.OReEstadoActual);
      const ordenesAsociadas = ordenesCache.filter(o => o.OReIdOrdenRetiro === orderRetiro.OReIdOrdenRetiro);

      // Enriquecer las órdenes asociadas
      const enrichedOrdenes = ordenesAsociadas.map(order => {
        const cliente = clientesCache.find(c => c.CliIdCliente === order.CliIdCliente);
        const tipoCliente = tiposClientesCache.find(tc => tc.TClIdTipoCliente === cliente?.TClIdTipoCliente);
        const pago = pagosCache.find(p => p.PagIdPago === order.PagIdPago);
        const monedaPago = monedasCache.find(m => m.MonIdMoneda === pago?.PagIdMonedaPago);
        const monedaOrden = monedasCache.find(m => m.MonIdMoneda === order.MonIdMoneda);
        const metodoPago = metodosPagos.find(mp => mp.MPaIdMetodoPago === pago?.MPaIdMetodoPago);

        return {
          orderNumber: order.OrdCodigoOrden,
          orderId: order.OrdIdOrden,
          orderEstado: order.OrdEstadoActual,
          orderCosto: monedaOrden ? `${monedaOrden.MonSimbolo} ${parseFloat(order.OrdCostoFinal).toFixed(2)}` : null,
          orderIdMetodoPago: pago?.MPaIdMetodoPago || null,
          orderMetodoPago: metodoPago?.MPaDescripcionMetodo || null,
          orderPago: monedaPago ? `${monedaPago.MonSimbolo} ${parseFloat(pago.PagMontoPago).toFixed(2)}` : null,
          orderFechaPago: pago?.PagFechaPago || null,
        };
      });

      return {
        ordenDeRetiro: `R-${String(orderRetiro.OReIdOrdenRetiro).padStart(4, '0')}`,
        totalCost: parseFloat(orderRetiro.OReCostoTotalOrden).toFixed(2),
        lugarRetiro: lugarRetiro?.LReNombreLugar || 'Desconocido',
        fechaAlta: orderRetiro.OReFechaAlta,
        usuarioAlta: orderRetiro.OReUsuarioAlta,
        estado: estadoOrden?.EORNombreEstado || 'Desconocido',
        orders: enrichedOrdenes,
        pagorealizado: orderRetiro.PagIdPago ? 1 : 0,
        metodoPago: metodosPagos.find(mp => mp.MPaIdMetodoPago === pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.MPaIdMetodoPago)?.MPaDescripcionMetodo,
        montopagorealizado: orderRetiro.PagIdPago
          ? `${monedasCache.find(m => m.MonIdMoneda === pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagIdMonedaPago)?.MonSimbolo || ''} ${parseFloat(pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagMontoPago || 0).toFixed(2)}`
          : null,
        fechapagooden: pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagFechaPago || null,
        comprobante: pagosCache.find(p => p.PagIdPago === orderRetiro.PagIdPago)?.PagRutaComprobante,
        CliCodigoCliente: clientesCache.find(c => c.CliIdCliente === ordenesAsociadas[0]?.CliIdCliente)?.CliCodigoCliente || 'Desconocido',
        TClDescripcion: tiposClientesCache.find(tc => tc.TClIdTipoCliente === clientesCache.find(c => c.CliIdCliente === ordenesAsociadas[0]?.CliIdCliente)?.TClIdTipoCliente)?.TClDescripcion || 'Desconocido',
      };
    });

    console.log('Órdenes de retiro cargadas desde la caché');

    res.json(ordenesRetiro);
  } catch (err) {
    console.error('Error al obtener las órdenes de retiro:', err);
    res.status(500).json({ error: 'Error al obtener las órdenes de retiro' });
  }
};


module.exports = { 
  createOrdenRetiro, 
  getOrdenesRetiroPorEstados, 
  actualizarOrdenRetiroEstado, 
  marcarOrdenRetiroPronto,
  marcarOrdenRetiroEntregado, 
  ordenesRetiroCaja,
  getOrdenesRetiroPasarPorCaja,
  ordenesRetiroMarcarPasarPorCaja,
  getOrdenesRetiroPorFecha
};
