const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { descontarStockWmsExterno } = require('../services/wmsStockService');

// [WMS] Trazabilidad: registra el cambio de estado (o nota) del pedido VEN en
// PedidosCobranzaEventos. Con try/catch: si la tabla no existe todavía (prod sin
// migrar create_pedidos_cobranza_eventos.sql), el flujo del pedido no se corta.
async function logEvento(pool, pedidoId, { estado = null, nota = null, usuario = null }) {
    try {
        await pool.request()
            .input('PID', sql.Int, pedidoId)
            .input('Tipo', sql.VarChar(20), nota ? 'NOTA' : 'ESTADO')
            .input('Estado', sql.VarChar(30), estado)
            .input('Nota', sql.NVarChar(1000), nota)
            .input('Usuario', sql.NVarChar(100), usuario || 'Sistema')
            .query(`
                INSERT INTO PedidosCobranzaEventos (PedidoCobranzaID, Tipo, Estado, Nota, Usuario)
                VALUES (@PID, @Tipo, @Estado, @Nota, @Usuario)
            `);
    } catch (e) {
        logger.warn('[WMS] No se pudo registrar el evento del pedido (¿falta la tabla PedidosCobranzaEventos?):', e.message);
    }
}
exports.logEvento = logEvento;

// [WMS] Suma notasCount a cada pedido de la lista (badge 📝 en Recibir órdenes de
// venta). Query aparte con try/catch: si PedidosCobranzaEventos no existe todavía
// (prod sin migrar), las listas siguen andando sin el contador.
async function attachNotasCount(pool, orders) {
    if (!orders.length) return orders;
    try {
        const ids = orders.map(o => parseInt(o.id)).filter(n => !isNaN(n)).join(',');
        if (!ids) return orders;
        const r = await pool.request().query(`
            SELECT PedidoCobranzaID AS pid, COUNT(*) AS n
            FROM PedidosCobranzaEventos
            WHERE Tipo = 'NOTA' AND PedidoCobranzaID IN (${ids})
            GROUP BY PedidoCobranzaID
        `);
        const map = {};
        r.recordset.forEach(x => { map[x.pid] = x.n; });
        orders.forEach(o => { o.notasCount = map[o.id] || 0; });
    } catch (e) { /* tabla sin migrar: sin contador */ }
    return orders;
}

exports.getPendingOrders = async (req, res) => {
    try {
        const pool = await getPool();
        
        // Load pending and in prep orders
        const result = await pool.request().query(`
            SELECT 
                p.ID as PedidoID, p.NoDocERP, p.ClienteID, p.MontoTotal, p.Moneda, p.FechaGeneracion, p.EstadoCobro,
                c.Nombre as ClienteNombre,
                d.CodArticulo as wms_variante_id, d.Cantidad,
                a.Descripcion as nombre_producto,
                awv.sku, awv.nombre_variante,
                loc.pasillo, loc.estante
            FROM PedidosCobranza p
            LEFT JOIN Clientes c ON p.ClienteID = c.CliIdCliente
            INNER JOIN PedidosCobranzaDetalle d ON p.ID = d.PedidoCobranzaID
            LEFT JOIN Articulos a ON d.ProIdProducto = a.ProIdProducto
            LEFT JOIN Articulos_WMS_Variantes awv ON CAST(awv.wms_variante_id AS VARCHAR(100)) = CAST(d.CodArticulo AS VARCHAR(100))
            LEFT JOIN Articulos_UbicacionLocal loc ON a.ProIdProducto = loc.Idproid
            WHERE p.NoDocERP LIKE 'VEN-%' 
              AND p.EstadoCobro IN ('PENDIENTE', 'EN_PREPARACION')
            ORDER BY p.FechaGeneracion ASC
        `);

        // Group by Order
        const ordersMap = {};
        result.recordset.forEach(row => {
            if (!ordersMap[row.PedidoID]) {
                ordersMap[row.PedidoID] = {
                    id: row.PedidoID,
                    codigo: row.NoDocERP,
                    cliente: row.ClienteNombre || 'Cliente Contado',
                    fecha: row.FechaGeneracion,
                    total: row.MontoTotal,
                    moneda: row.Moneda,
                    estado: row.EstadoCobro,
                    items: []
                };
            }
            
            const fullName = row.nombre_variante ? `${row.nombre_producto} - ${row.nombre_variante}` : (row.nombre_producto || 'Artículo Desconocido');
            
            ordersMap[row.PedidoID].items.push({
                wms_variante_id: row.wms_variante_id,
                sku: row.sku,
                nombre_variante: fullName,
                cantidad: row.Cantidad,
                ubicacion: { pasillo: row.pasillo, estante: row.estante }
            });
        });

        res.json(await attachNotasCount(pool, Object.values(ordersMap)));
    } catch (err) {
        logger.error('Error en getPendingOrders (Logistica):', err);
        res.status(500).json({ error: err.message });
    }
};

exports.startPreparation = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pool = await getPool();
        await pool.request()
            .input('PedidoID', sql.Int, pedidoId)
            .query(`
                UPDATE PedidosCobranza
                SET EstadoCobro = 'EN_PREPARACION'
                WHERE ID = @PedidoID AND NoDocERP LIKE 'VEN-%'
            `);
        await logEvento(pool, pedidoId, { estado: 'EN_PREPARACION', usuario: req.user?.usuario });
        res.json({ success: true, message: 'Preparación iniciada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.confirmPreparation = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pool = await getPool();

        // 1. Get items to discount
        const itemsRes = await pool.request()
            .input('PedidoID', sql.Int, pedidoId)
            .query(`SELECT CodArticulo as wms_variante_id, Cantidad FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PedidoID`);
        
        const items = itemsRes.recordset;
        if (items.length === 0) throw new Error('El pedido no tiene items');

        // Guard: verificar que el pedido aún esté en estado que permita descontar
        const estadoRes = await pool.request()
            .input('PedidoID', sql.Int, pedidoId)
            .query(`SELECT EstadoCobro, NoDocERP FROM PedidosCobranza WHERE ID = @PedidoID AND NoDocERP LIKE 'VEN-%'`);
        const estadoActual = estadoRes.recordset[0]?.EstadoCobro;
        const noDocErpVen = estadoRes.recordset[0]?.NoDocERP;
        if (!estadoActual || !['PENDIENTE', 'EN_PREPARACION'].includes(estadoActual)) {
            return res.json({ success: false, message: `Pedido ya fue procesado (estado: ${estadoActual}). No se descuenta stock.` });
        }

        // 2. Descontar stock via POST /sql — mismo endpoint que importa productos
        // (lógica compartida con prendasOrdersController.confirmarRetiroWms, ver
        // backend/services/wmsStockService.js)
        const { wmsDisponible, wmsErrors } = await descontarStockWmsExterno(items);

        // Bloquear solo si el WMS está completamente offline
        if (!wmsDisponible) {
            return res.status(503).json({
                success: false,
                message: 'El WMS no está disponible. Verificá la conexión con el servidor de Johnson.',
                wmsErrors
            });
        }


        // 3. Marcar como PREPARADO
        await pool.request()
            .input('PedidoID', sql.Int, pedidoId)
            .query(`
                UPDATE PedidosCobranza
                SET EstadoCobro = 'PREPARADO'
                WHERE ID = @PedidoID AND NoDocERP LIKE 'VEN-%'
            `);
        await logEvento(pool, pedidoId, { estado: 'PREPARADO', usuario: req.user?.usuario });

        // [WMS] Bulto/etiqueta de cada orden acompañante de este pedido (una por ítem,
        // área PRO, creadas en wmsController.createOrder) — mismo mecanismo que la
        // prenda personalizada: addOneBulto no exige cotización propia, y como
        // ProximoServicio='DEPOSITO' el bulto nace directo PROD_TERMINADO (venta
        // directa, sin pasar por ninguna otra área). El NOT EXISTS salta las anclas
        // que YA tienen etiqueta (generada a demanda con el botón 🖨 de la vista de
        // Inventario, printEtiquetasPedido) — sin él se duplicaría el bulto.
        let bultoOrdenIds = [];
        try {
            if (noDocErpVen) {
                const LabelGenerationService = require('../services/LabelGenerationService');
                const compRes = await pool.request()
                    .input('Doc', sql.VarChar, noDocErpVen)
                    .query("SELECT OrdenID FROM Ordenes O WHERE NoDocERP = @Doc AND AreaID = 'PRO' AND EstadoDependencia = 'VENTA_DIRECTA' AND NOT EXISTS (SELECT 1 FROM Etiquetas E WHERE E.OrdenID = O.OrdenID)");
                for (const c of compRes.recordset) {
                    const lr = await LabelGenerationService.addOneBulto(c.OrdenID, req.user?.id || 1, req.user?.usuario || 'Sistema', {});
                    if (lr.success) bultoOrdenIds.push(c.OrdenID);
                }
            }
        } catch (eLab) {
            logger.warn('[WMS] confirmPreparation: no se pudieron generar los bultos de venta directa:', eLab.message);
        }

        const msg = wmsErrors.length > 0
            ? `Pedido PREPARADO con advertencias: ${wmsErrors.join('; ')}`
            : 'Pedido confirmado, stock descontado y marcado como PREPARADO';

        res.json({ success: true, message: msg, wmsErrors, bultoOrdenIds });

    } catch (err) {
        logger.error('Error en confirmPreparation (Logistica):', err);
        res.status(500).json({ error: err.message });
    }
};


exports.markDelivered = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pool = await getPool();
        await pool.request()
            .input('PedidoID', sql.Int, pedidoId)
            .query(`
                UPDATE PedidosCobranza
                SET EstadoCobro = 'ENTREGADO'
                WHERE ID = @PedidoID AND NoDocERP LIKE 'VEN-%'
            `);
        await logEvento(pool, pedidoId, { estado: 'ENTREGADO', usuario: req.user?.usuario });
        res.json({ success: true, message: 'Pedido ENTREGADO' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.receivePreparedOrder = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pool = await getPool();
        const orderRes = await pool.request().input('PedidoID', sql.Int, pedidoId).query(`SELECT ID, NoDocERP, ClienteID, Moneda, MontoTotal, EstadoCobro FROM PedidosCobranza WHERE ID = @PedidoID`);
        if (orderRes.recordset.length === 0) throw new Error('Pedido no encontrado');
        const order = orderRes.recordset[0];

        // Guard: solo un pedido PREPARADO puede ingresar a Depósito — evita el doble
        // ingreso/cargo contable si se aprieta dos veces (ya quedó RECIBIDO_DEPOSITO)
        // y el ingreso directo de pedidos sin stock descontado.
        if (order.EstadoCobro !== 'PREPARADO') {
            return res.json({ success: false, message: `El pedido no está PREPARADO (estado: ${order.EstadoCobro}). No se ingresa a Depósito.` });
        }

        // Nombre del trabajo FIJO — el detalle de los productos va solo en la hoja A4
        // (remito-print); acá se mantiene genérico para no cambiar el aviso WSP.
        const nombreTrabajo = 'VENTAS DE PRODUCTOS USER';
        const proIdProducto = order.Moneda === 'USD' ? 411 : 386;
        const insertRes = await pool.request()
            .input('Cod', sql.VarChar(100), order.NoDocERP)
            .input('Cli', sql.Int, order.ClienteID)
            .input('Prod', sql.Int, proIdProducto)
            .input('Mon', sql.Int, order.Moneda === 'USD' ? 2 : 1)
            .input('Monto', sql.Decimal(18,2), order.MontoTotal)
            .input('NombreTrab', sql.NVarChar(200), nombreTrabajo)
            .query(`
                INSERT INTO OrdenesDeposito (OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo, MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal, OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual, LReIdLugarRetiro, OrdAvisoWsp, OrdMaterialPlanilla)
                OUTPUT INSERTED.OrdIdOrden
                VALUES (@Cod, 1, @Cli, @NombreTrab, 1, @Prod, @Mon, @Monto, GETDATE(), 1, 1, GETDATE(), 1, 0, 'WMS')
            `);
            
        const insertedOrdId = insertRes.recordset[0]?.OrdIdOrden;

        await pool.request().input('PedidoID', sql.Int, pedidoId).query(`UPDATE PedidosCobranza SET EstadoCobro = 'RECIBIDO_DEPOSITO' WHERE ID = @PedidoID`);
        await logEvento(pool, pedidoId, { estado: 'RECIBIDO_DEPOSITO', usuario: req.user?.usuario });

        // Registrar en deuda contable
        const contabilidadService = require('../services/contabilidadService');
        await contabilidadService.procesarEventoContable('ORDEN', {
            OrdIdOrden: insertedOrdId || null,
            CliIdCliente: order.ClienteID,
            ProIdProducto: proIdProducto,
            Cantidad: 1,
            CodigoOrden: order.NoDocERP,
            NombreTrabajo: nombreTrabajo,
            UsuarioAlta: req.user?.usuarioId || 1,
            Importe: order.MontoTotal,
            MonIdMoneda: order.Moneda === 'USD' ? 2 : 1
        });

        res.json({ success: true, message: 'Orden recibida en depósito, ingresada a deuda y aviso programado.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getPreparedOrders = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                p.ID as PedidoID, p.NoDocERP, p.ClienteID, p.MontoTotal, p.Moneda, p.FechaGeneracion, p.EstadoCobro, 
                c.Nombre as ClienteNombre, 
                d.CodArticulo as wms_variante_id, d.Cantidad, 
                a.Descripcion as nombre_producto,
                awv.sku, awv.nombre_variante, 
                loc.pasillo, loc.estante 
            FROM PedidosCobranza p 
            LEFT JOIN Clientes c ON p.ClienteID = c.CliIdCliente 
            INNER JOIN PedidosCobranzaDetalle d ON p.ID = d.PedidoCobranzaID 
            LEFT JOIN Articulos a ON d.ProIdProducto = a.ProIdProducto
            LEFT JOIN Articulos_WMS_Variantes awv ON CAST(awv.wms_variante_id AS VARCHAR(100)) = CAST(d.CodArticulo AS VARCHAR(100)) 
            LEFT JOIN Articulos_UbicacionLocal loc ON a.ProIdProducto = loc.Idproid 
            WHERE p.NoDocERP LIKE 'VEN-%' AND p.EstadoCobro = 'PREPARADO' 
            ORDER BY p.FechaGeneracion ASC
        `);
        const ordersMap = {};
        result.recordset.forEach(row => {
            if (!ordersMap[row.PedidoID]) {
                ordersMap[row.PedidoID] = { id: row.PedidoID, codigo: row.NoDocERP, cliente: row.ClienteNombre || 'Cliente Contado', fecha: row.FechaGeneracion, total: row.MontoTotal, moneda: row.Moneda, estado: row.EstadoCobro, items: [] };
            }
            const fullName = row.nombre_variante ? `${row.nombre_producto} - ${row.nombre_variante}` : (row.nombre_producto || 'Artículo Desconocido');
            ordersMap[row.PedidoID].items.push({ wms_variante_id: row.wms_variante_id, sku: row.sku, nombre_variante: fullName, cantidad: row.Cantidad, ubicacion: { pasillo: row.pasillo, estante: row.estante } });
        });
        res.json(await attachNotasCount(pool, Object.values(ordersMap)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateItemQuantity = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const { wms_variante_id, nuevaCantidad } = req.body;
        if (nuevaCantidad == null || nuevaCantidad < 0) throw new Error('Cantidad inválida');
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            await transaction.request().input('PedidoID', sql.Int, pedidoId).input('VarID', sql.NVarChar(50), wms_variante_id).input('Cant', sql.Decimal(18,2), nuevaCantidad).query(`UPDATE PedidosCobranzaDetalle SET Cantidad = @Cant, Subtotal = @Cant * PrecioUnitario WHERE PedidoCobranzaID = @PedidoID AND CodArticulo = @VarID`);
            // "Comprar y personalizar": no sumar las líneas hermanas EMB/DF/TPU/EST, ya
            // incluidas en el subtotal de PRO (este endpoint es de pedidos VEN-xxx puros,
            // que nunca tienen hermanas, pero el filtro no cuesta nada y evita sorpresas).
            await transaction.request().input('PedidoID', sql.Int, pedidoId).query(`UPDATE PedidosCobranza SET MontoTotal = (SELECT ISNULL(SUM(Subtotal), 0) FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PedidoID AND ISNULL(EsHermanaConsolidada,0) = 0) WHERE ID = @PedidoID`);
            await transaction.commit();
            res.json({ success: true, message: 'Cantidad actualizada' });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.cancelOrder = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pool = await getPool();
        await pool.request().input('PedidoID', sql.Int, pedidoId).query(`UPDATE PedidosCobranza SET EstadoCobro = 'CANCELADO' WHERE ID = @PedidoID AND NoDocERP LIKE 'VEN-%'`);
        await logEvento(pool, pedidoId, { estado: 'CANCELADO', usuario: req.user?.usuario });
        res.json({ success: true, message: 'Pedido cancelado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// [WMS] Historial de pedidos VEN ya terminados (ingresados a depósito, entregados o
// cancelados), con búsqueda por código o cliente — para la pestaña "Historial" de
// Recibir órdenes de venta. TOP 50 más recientes.
exports.getHistorialPedidos = async (req, res) => {
    try {
        const search = (req.query.search || '').trim();
        const pool = await getPool();
        const result = await pool.request()
            .input('Search', sql.NVarChar(100), search ? `%${search}%` : null)
            .query(`
                SELECT
                    p.ID as PedidoID, p.NoDocERP, p.ClienteID, p.MontoTotal, p.Moneda, p.FechaGeneracion, p.EstadoCobro,
                    c.Nombre as ClienteNombre,
                    d.CodArticulo as wms_variante_id, d.Cantidad,
                    a.Descripcion as nombre_producto,
                    awv.sku, awv.nombre_variante,
                    loc.pasillo, loc.estante
                FROM PedidosCobranza p
                LEFT JOIN Clientes c ON p.ClienteID = c.CliIdCliente
                INNER JOIN PedidosCobranzaDetalle d ON p.ID = d.PedidoCobranzaID
                LEFT JOIN Articulos a ON d.ProIdProducto = a.ProIdProducto
                LEFT JOIN Articulos_WMS_Variantes awv ON CAST(awv.wms_variante_id AS VARCHAR(100)) = CAST(d.CodArticulo AS VARCHAR(100))
                LEFT JOIN Articulos_UbicacionLocal loc ON a.ProIdProducto = loc.Idproid
                WHERE p.ID IN (
                    SELECT TOP 50 p2.ID FROM PedidosCobranza p2
                    LEFT JOIN Clientes c2 ON p2.ClienteID = c2.CliIdCliente
                    WHERE p2.NoDocERP LIKE 'VEN-%'
                      AND p2.EstadoCobro IN ('RECIBIDO_DEPOSITO', 'ENTREGADO', 'CANCELADO')
                      AND (@Search IS NULL OR p2.NoDocERP LIKE @Search OR c2.Nombre LIKE @Search)
                    ORDER BY p2.FechaGeneracion DESC
                )
                ORDER BY p.FechaGeneracion DESC
            `);

        const ordersMap = {};
        result.recordset.forEach(row => {
            if (!ordersMap[row.PedidoID]) {
                ordersMap[row.PedidoID] = { id: row.PedidoID, codigo: row.NoDocERP, cliente: row.ClienteNombre || 'Cliente Contado', fecha: row.FechaGeneracion, total: row.MontoTotal, moneda: row.Moneda, estado: row.EstadoCobro, items: [] };
            }
            const fullName = row.nombre_variante ? `${row.nombre_producto} - ${row.nombre_variante}` : (row.nombre_producto || 'Artículo Desconocido');
            ordersMap[row.PedidoID].items.push({ wms_variante_id: row.wms_variante_id, sku: row.sku, nombre_variante: fullName, cantidad: row.Cantidad, ubicacion: { pasillo: row.pasillo, estante: row.estante } });
        });
        res.json(await attachNotasCount(pool, Object.values(ordersMap)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// [WMS] Imprimir la(s) etiqueta(s) del pedido: resuelve las órdenes ancla (VENTA_DIRECTA)
// del VEN y redirige a la vista de impresión de etiquetas existente. Si el pedido todavía
// no tiene etiqueta (no se finalizó), la GENERA acá a demanda — confirmPreparation tiene
// un NOT EXISTS que evita duplicar el bulto después. Sin verifyToken en la ruta: se abre
// con window.open (mismo criterio que los otros prints).
exports.printEtiquetasPedido = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pool = await getPool();
        const ANCHORS_QUERY = `
                SELECT O.OrdenID,
                       (SELECT COUNT(*) FROM Etiquetas E WHERE E.OrdenID = O.OrdenID) AS CantEtiquetas
                FROM Ordenes O
                JOIN PedidosCobranza P ON LTRIM(RTRIM(P.NoDocERP)) = LTRIM(RTRIM(O.NoDocERP))
                WHERE P.ID = @PID AND O.AreaID = 'PRO' AND O.EstadoDependencia = 'VENTA_DIRECTA'
            `;
        let r = await pool.request()
            .input('PID', sql.Int, parseInt(pedidoId))
            .query(ANCHORS_QUERY);

        // [WMS] Pedido creado ANTES de que existieran las órdenes ancla: crearlas acá al
        // vuelo desde las líneas del pedido — mismos campos que wmsController.createOrder,
        // así el botón 🖨 funciona para cualquier VEN, viejo o nuevo.
        if (r.recordset.length === 0) {
            const pedRes = await pool.request()
                .input('PID', sql.Int, parseInt(pedidoId))
                .query(`
                    SELECT LTRIM(RTRIM(p.NoDocERP)) AS NoDocERP, p.ClienteID,
                           ISNULL(NULLIF(LTRIM(RTRIM(c.IDCliente)), ''), ISNULL(LTRIM(RTRIM(c.Nombre)), 'Consumidor Final')) AS ClienteNombre,
                           d.Cantidad, d.ProIdProducto, d.CodArticulo,
                           a.Descripcion AS nombre_producto, awv.nombre_variante
                    FROM PedidosCobranza p
                    LEFT JOIN Clientes c ON p.ClienteID = c.CliIdCliente
                    INNER JOIN PedidosCobranzaDetalle d ON p.ID = d.PedidoCobranzaID
                    LEFT JOIN Articulos a ON d.ProIdProducto = a.ProIdProducto
                    LEFT JOIN Articulos_WMS_Variantes awv ON CAST(awv.wms_variante_id AS VARCHAR(100)) = CAST(d.CodArticulo AS VARCHAR(100))
                    WHERE p.ID = @PID AND p.NoDocERP LIKE 'VEN-%'
                `);
            if (pedRes.recordset.length === 0) {
                return res.send('<div style="font-family: Arial; padding: 40px; text-align: center;"><h2>Pedido no encontrado</h2><p>No es un pedido de venta WMS (VEN) o no tiene líneas.</p></div>');
            }
            for (const it of pedRes.recordset) {
                const nombre = it.nombre_variante
                    ? `${(it.nombre_producto || '').trim()} - ${it.nombre_variante}`
                    : ((it.nombre_producto || '').trim() || 'Producto WMS');
                await pool.request()
                    .input('Cliente', sql.NVarChar(200), it.ClienteNombre)
                    .input('CliId', sql.Int, it.ClienteID || 2089)
                    .input('Desc', sql.NVarChar(300), nombre)
                    .input('Mat', sql.VarChar(255), nombre)
                    .input('Cod', sql.VarChar(50), it.NoDocERP)
                    .input('Doc', sql.VarChar(50), it.NoDocERP)
                    .input('Mag', sql.VarChar(50), String(it.Cantidad))
                    .input('Prod', sql.Int, it.ProIdProducto || null)
                    .input('Wms', sql.Int, parseInt(it.CodArticulo) || null)
                    .query(`
                        INSERT INTO Ordenes (
                            AreaID, Cliente, CliIdCliente, DescripcionTrabajo, Prioridad,
                            FechaIngreso, FechaEstimadaEntrega, Material, CodigoOrden, NoDocERP,
                            Magnitud, ProximoServicio, UM, Estado, EstadoenArea,
                            ProIdProducto, WmsVarianteId, EstadoDependencia
                        )
                        VALUES (
                            'PRO', @Cliente, @CliId, @Desc, 'Normal',
                            GETDATE(), DATEADD(day, 3, GETDATE()), @Mat, @Cod, @Doc,
                            @Mag, 'DEPOSITO', 'u', 'Pendiente', 'Pendiente',
                            @Prod, @Wms, 'VENTA_DIRECTA'
                        )
                    `);
            }
            r = await pool.request()
                .input('PID', sql.Int, parseInt(pedidoId))
                .query(ANCHORS_QUERY);
        }

        // Generar el bulto/etiqueta de las anclas que aún no lo tengan (impresión a demanda)
        const LabelGenerationService = require('../services/LabelGenerationService');
        for (const a of r.recordset) {
            if (a.CantEtiquetas === 0) {
                try {
                    await LabelGenerationService.addOneBulto(a.OrdenID, 1, 'Impresión WMS', {});
                } catch (eLab) {
                    logger.warn(`[WMS] printEtiquetasPedido: no se pudo generar el bulto de la orden ${a.OrdenID}:`, eLab.message);
                }
            }
        }

        const ids = r.recordset.map(x => x.OrdenID);
        return res.redirect(ids.length === 1
            ? `/api/production-file-control/orden/${ids[0]}/etiquetas/print`
            : `/api/production-file-control/orden/batch/etiquetas/print?ids=${ids.join(',')}`);
    } catch (err) {
        res.status(500).send('Error buscando las etiquetas del pedido');
    }
};

// [WMS] Historial del pedido: cambios de estado con fecha/usuario + notas manuales.
// Siempre incluye la creación (FechaGeneracion) como primer evento, así los pedidos
// anteriores a la tabla de eventos no quedan con el historial vacío.
exports.getEventos = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pool = await getPool();

        const cabRes = await pool.request()
            .input('PID', sql.Int, pedidoId)
            .query(`SELECT FechaGeneracion FROM PedidosCobranza WHERE ID = @PID`);
        if (cabRes.recordset.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });

        let eventos = [];
        try {
            const evRes = await pool.request()
                .input('PID', sql.Int, pedidoId)
                .query(`
                    SELECT EventoID, Tipo, Estado, Nota, Usuario, Fecha
                    FROM PedidosCobranzaEventos
                    WHERE PedidoCobranzaID = @PID
                    ORDER BY Fecha ASC, EventoID ASC
                `);
            eventos = evRes.recordset;
        } catch (e) { /* tabla sin migrar: solo se muestra la creación */ }

        // El evento PENDIENTE ya representa la creación (lo escribe createOrder con el
        // usuario vendedor); el CREADO sintético es solo para pedidos viejos sin eventos.
        const tieneCreacion = eventos.some(e => (e.Estado || '').trim() === 'PENDIENTE');
        res.json({
            success: true,
            eventos: [
                ...(tieneCreacion ? [] : [{ Tipo: 'ESTADO', Estado: 'CREADO', Nota: null, Usuario: null, Fecha: cabRes.recordset[0].FechaGeneracion }]),
                ...eventos
            ]
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.addNota = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const nota = (req.body?.nota || '').trim();
        if (!nota) return res.status(400).json({ error: 'La nota no puede estar vacía' });
        const pool = await getPool();
        await pool.request()
            .input('PID', sql.Int, pedidoId)
            .input('Nota', sql.NVarChar(1000), nota.substring(0, 1000))
            .input('Usuario', sql.NVarChar(100), req.user?.usuario || 'Sistema')
            .query(`
                INSERT INTO PedidosCobranzaEventos (PedidoCobranzaID, Tipo, Estado, Nota, Usuario)
                VALUES (@PID, 'NOTA', NULL, @Nota, @Usuario)
            `);
        res.json({ success: true, message: 'Nota agregada' });
    } catch (err) {
        // Mensaje claro si falta la migración de la tabla
        if (/PedidosCobranzaEventos/i.test(err.message || '')) {
            return res.status(500).json({ error: 'Falta crear la tabla PedidosCobranzaEventos (script create_pedidos_cobranza_eventos.sql)' });
        }
        res.status(500).json({ error: err.message });
    }
};

exports.deleteItem = async (req, res) => {
    try {
        const { pedidoId, wms_variante_id } = req.params;
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            await transaction.request().input('PedidoID', sql.Int, pedidoId).input('VarID', sql.NVarChar(50), wms_variante_id).query(`DELETE FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PedidoID AND CodArticulo = @VarID`);
            await transaction.request().input('PedidoID', sql.Int, pedidoId).query(`UPDATE PedidosCobranza SET MontoTotal = (SELECT ISNULL(SUM(Subtotal), 0) FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PedidoID AND ISNULL(EsHermanaConsolidada,0) = 0) WHERE ID = @PedidoID`);
            await transaction.commit();
            res.json({ success: true, message: 'Artículo eliminado del pedido' });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
