const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

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

        // 2. Descontar stock via API WMS externa
        const wmsUrl = process.env.WMS_API_URL;
        const wmsErrors = [];
        
        if (wmsUrl) {
            for (const item of items) {
                try {
                    const decrementQuery = `
                        USE Ventas_Dev;
                        UPDATE Stock_Etiquetas
                        SET cantidad_actual = cantidad_actual - ${parseFloat(item.Cantidad)}
                        WHERE variante_id = ${parseInt(item.wms_variante_id)}
                          AND estado = 'activo'
                          AND cantidad_actual >= ${parseFloat(item.Cantidad)};
                        SELECT @@ROWCOUNT AS filas_afectadas;
                    `;
                    const response = await fetch(`${wmsUrl}/sql`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: decrementQuery })
                    });
                    const result = await response.json();
                    if (!response.ok || !result.success) {
                        wmsErrors.push(`variante ${item.wms_variante_id}: ${result.error || 'error desconocido'}`);
                    } else {
                        logger.info(`✅ Stock WMS descontado: variante ${item.wms_variante_id} x ${item.Cantidad}`);
                    }
                } catch (e) {
                    wmsErrors.push(`variante ${item.wms_variante_id}: ${e.message}`);
                }
            }
        } else {
            logger.warn('WMS_API_URL no configurada — stock NO descontado del WMS');
        }

        // 3. Update Order State
        await pool.request()
            .input('PedidoID', sql.Int, pedidoId)
            .query(`
                UPDATE PedidosCobranza 
                SET EstadoCobro = 'PREPARADO' 
                WHERE ID = @PedidoID AND NoDocERP LIKE 'VEN-%'
            `);

        const msg = wmsErrors.length > 0
            ? `Pedido PREPARADO con advertencias en stock WMS: ${wmsErrors.join('; ')}`
            : 'Pedido confirmado, stock WMS descontado y marcado como PREPARADO';

        res.json({ success: true, message: msg, wmsErrors });
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
            await transaction.request().input('PedidoID', sql.Int, pedidoId).query(`UPDATE PedidosCobranza SET MontoTotal = (SELECT ISNULL(SUM(Subtotal), 0) FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PedidoID) WHERE ID = @PedidoID`);
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
            await transaction.request().input('PedidoID', sql.Int, pedidoId).query(`UPDATE PedidosCobranza SET MontoTotal = (SELECT ISNULL(SUM(Subtotal), 0) FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PedidoID) WHERE ID = @PedidoID`);
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
