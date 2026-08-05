const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { descontarStockWmsExterno } = require('../services/wmsStockService');

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

        res.json(Object.values(ordersMap));
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

        // [WMS] Bulto/etiqueta de cada orden acompañante de este pedido (una por ítem,
        // área PRO, creadas en wmsController.createOrder) — mismo mecanismo que la
        // prenda personalizada: addOneBulto no exige cotización propia, y como
        // ProximoServicio='DEPOSITO' el bulto nace directo PROD_TERMINADO (venta
        // directa, sin pasar por ninguna otra área).
        let bultoOrdenIds = [];
        try {
            if (noDocErpVen) {
                const LabelGenerationService = require('../services/LabelGenerationService');
                const compRes = await pool.request()
                    .input('Doc', sql.VarChar, noDocErpVen)
                    .query("SELECT OrdenID FROM Ordenes WHERE NoDocERP = @Doc AND AreaID = 'PRO' AND EstadoDependencia = 'VENTA_DIRECTA'");
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
        res.json({ success: true, message: 'Pedido ENTREGADO' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.receivePreparedOrder = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pool = await getPool();
        const orderRes = await pool.request().input('PedidoID', sql.Int, pedidoId).query(`SELECT ID, NoDocERP, ClienteID, Moneda, MontoTotal FROM PedidosCobranza WHERE ID = @PedidoID`);
        if (orderRes.recordset.length === 0) throw new Error('Pedido no encontrado');
        const order = orderRes.recordset[0];
        const proIdProducto = order.Moneda === 'USD' ? 411 : 386;
        const insertRes = await pool.request()
            .input('Cod', sql.VarChar(100), order.NoDocERP)
            .input('Cli', sql.Int, order.ClienteID)
            .input('Prod', sql.Int, proIdProducto)
            .input('Mon', sql.Int, order.Moneda === 'USD' ? 2 : 1)
            .input('Monto', sql.Decimal(18,2), order.MontoTotal)
            .query(`
                INSERT INTO OrdenesDeposito (OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo, MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal, OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual, LReIdLugarRetiro, OrdAvisoWsp, OrdMaterialPlanilla) 
                OUTPUT INSERTED.OrdIdOrden
                VALUES (@Cod, 1, @Cli, 'PEDIDO ECOMMERCE WMS', 1, @Prod, @Mon, @Monto, GETDATE(), 1, 1, GETDATE(), 1, 0, 'WMS')
            `);
            
        const insertedOrdId = insertRes.recordset[0]?.OrdIdOrden;

        await pool.request().input('PedidoID', sql.Int, pedidoId).query(`UPDATE PedidosCobranza SET EstadoCobro = 'RECIBIDO_DEPOSITO' WHERE ID = @PedidoID`);

        // Registrar en deuda contable
        const contabilidadService = require('../services/contabilidadService');
        await contabilidadService.procesarEventoContable('ORDEN', {
            OrdIdOrden: insertedOrdId || null,
            CliIdCliente: order.ClienteID,
            ProIdProducto: proIdProducto,
            Cantidad: 1,
            CodigoOrden: order.NoDocERP,
            NombreTrabajo: 'PEDIDO ECOMMERCE WMS',
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
        res.json(Object.values(ordersMap));
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
        res.json({ success: true, message: 'Pedido cancelado' });
    } catch (err) {
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
