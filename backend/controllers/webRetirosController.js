const { getPool, sql } = require('../config/db');
const axios = require('axios');
const moment = require('moment-timezone');

// Importar funciones del controller de órdenes de retiro local
const ordenesRetiroController = require('./ordenesRetiroController');

/**
 * Endpoint nativo para recibir y registrar directamente un retiro web
 * Es posible que quieras llamarlo desde tu webhook o la acción de Finalizar Compra.
 */
exports.crearRetiro = async (req, res) => {
    // OrdIdRetiro puede ser generado localmente si es nuevo o recibido.
    const { OrdIdRetiro, Monto, Moneda, ReferenciaPago } = req.body;

    if (!OrdIdRetiro) {
        return res.status(400).json({ error: "Falta el id de orden de retiro (OrdIdRetiro)" });
    }

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Evaluamos estado inicial:
            // Si tiene RefPago, podemos asumir que es 3 (Abonado), si no es 1 (Ingresado)
            // Esto también podrías pasarlo en el body si prefieres.
            let estadoInicial = 1;
            if (ReferenciaPago || req.body.Estado === 3) {
                estadoInicial = 3;
            } else if (req.body.Estado) {
                estadoInicial = req.body.Estado;
            }

            await new sql.Request(transaction)
                .input('Ord', sql.NVarChar, OrdIdRetiro)
                .input('Monto', sql.Decimal(18, 2), Monto || null)
                .input('Moneda', sql.NVarChar, Moneda || null)
                .input('Ref', sql.NVarChar, ReferenciaPago || null)
                .input('Est', sql.Int, estadoInicial)
                .query(`
                    INSERT INTO RetirosWeb (OrdIdRetiro, Monto, Moneda, ReferenciaPago, Estado)
                    VALUES (@Ord, @Monto, @Moneda, @Ref, @Est)
                `);

            await transaction.commit();
            res.status(201).json({ success: true, message: 'Retiro registrado en la tabla local', id: OrdIdRetiro });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        console.error("Error al registrar retiro web local:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Backend logic to sync retiros from Central API
 */
const runSyncRetirosCore = async () => {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    // Query directa a DB en vez de llamar al legacy API
    const queryResult = await pool.request().query(`
        SELECT 
            r.OReIdOrdenRetiro, r.OReCostoTotalOrden, r.OReFechaAlta, r.OReUsuarioAlta,
            r.OReEstadoActual, r.PagIdPago, r.ORePasarPorCaja,
            lr.LReNombreLugar AS lugarRetiro,
            er.EORNombreEstado AS estado,
            o.OrdIdOrden AS orderId, o.OrdCodigoOrden AS orderNumber,
            o.OrdEstadoActual AS orderEstado, o.OrdCostoFinal as costoFinal,
            monOrden.MonSimbolo AS orderMonedaSimbolo,
            p.MPaIdMetodoPago AS orderIdMetodoPago,
            mp.MPaDescripcionMetodo AS orderMetodoPago,
            monPago.MonSimbolo AS monetPagoSimbolo,
            p.PagMontoPago AS orderMontoPago, p.PagFechaPago AS orderFechaPago,
            p.PagRutaComprobante AS comprobante,
            c.CodigoReact AS CliCodigoCliente, c.Tipo AS TClDescripcion
        FROM OrdenesRetiro r WITH(NOLOCK)
        LEFT JOIN LugaresRetiro lr WITH(NOLOCK) ON lr.LReIdLugarRetiro = r.LReIdLugarRetiro
        LEFT JOIN EstadosOrdenesRetiro er WITH(NOLOCK) ON er.EORIdEstadoOrden = r.OReEstadoActual
        LEFT JOIN OrdenesDeposito o WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
        LEFT JOIN Monedas monOrden WITH(NOLOCK) ON monOrden.MonIdMoneda = o.MonIdMoneda
        LEFT JOIN Pagos p WITH(NOLOCK) ON p.PagIdPago = o.PagIdPago
        LEFT JOIN Monedas monPago WITH(NOLOCK) ON monPago.MonIdMoneda = p.PagIdMonedaPago
        LEFT JOIN MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
        LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
        WHERE r.OReEstadoActual IN (1,3,4,7,8,5,6)
        AND (CAST(DATEADD(d,-7,GETDATE()) AS DATE) <= CAST(r.OReFechaAlta AS DATE) OR r.OReEstadoActual NOT IN (5,6))
    `);

    // Procesar filas igual que ordenesRetiroController
    const map = {};
    for (const row of queryResult.recordset) {
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
                orderNumber: row.orderNumber, orderId: row.orderId,
                orderEstado: row.orderEstado,
                orderCosto: row.orderMonedaSimbolo ? `${row.orderMonedaSimbolo} ${parseFloat(row.costoFinal).toFixed(2)}` : null,
                orderIdMetodoPago: row.orderIdMetodoPago,
                orderMetodoPago: row.orderMetodoPago,
                orderPago: row.monetPagoSimbolo ? `${row.monetPagoSimbolo} ${parseFloat(row.orderMontoPago).toFixed(2)}` : null,
                orderFechaPago: row.orderFechaPago
            });
        }
    }
    const retirosExternos = Object.values(map);

    await transaction.begin();

    try {
        for (const ret of retirosExternos) {
            let estadoNumerico = 1;
            if (ret.estado.includes('Abonado') || ret.estado.includes('Abonado de antemano')) estadoNumerico = 3;
            if (ret.estado.includes('Empaquetado sin abonar')) estadoNumerico = 7;
            if (ret.estado.includes('Empaquetado y abonado')) estadoNumerico = 8;
            if (ret.estado.includes('Entregado')) estadoNumerico = 5;
            if (ret.estado.includes('Cancelar')) estadoNumerico = 6;

            const mergeQuery = `
                MERGE INTO RetirosWeb AS Target
                USING (VALUES (@OrdIdRetiro, @Monto, @Moneda, @Estado, @RefPago, @CodCliente, @BultosJSON)) 
                    AS Source (OrdIdRetiro, Monto, Moneda, Estado, RefPago, CodCliente, BultosJSON)
                ON Target.OrdIdRetiro = Source.OrdIdRetiro
                WHEN MATCHED THEN 
                    UPDATE SET 
                        Target.Estado = Source.Estado,
                        Target.Monto = COALESCE(Target.Monto, Source.Monto),
                        Target.ReferenciaPago = COALESCE(Target.ReferenciaPago, Source.RefPago),
                        Target.CodCliente = COALESCE(Target.CodCliente, Source.CodCliente),
                        Target.BultosJSON = COALESCE(Target.BultosJSON, Source.BultosJSON);
            `;

            let montoLimpio = null;
            let monedaLimpia = null;
            if (ret.montopagorealizado && ret.montopagorealizado !== 'NaN') {
                const partes = ret.montopagorealizado.split(' ');
                if (partes.length === 2) {
                    monedaLimpia = partes[0] === '$' ? 'UYU' : partes[0];
                    montoLimpio = parseFloat(partes[1].replace(/,/g, ''));
                }
            } else if (ret.totalCost && ret.totalCost !== 'NaN') {
                montoLimpio = parseFloat(ret.totalCost);
            }

            await new sql.Request(transaction)
                .input('OrdIdRetiro', sql.NVarChar, ret.ordenDeRetiro)
                .input('Monto', sql.Decimal(18, 2), montoLimpio)
                .input('Moneda', sql.NVarChar, monedaLimpia || 'UYU')
                .input('Estado', sql.Int, estadoNumerico)
                .input('RefPago', sql.NVarChar, ret.comprobante || null)
                .input('CodCliente', sql.VarChar, ret.CliCodigoCliente || null)
                .input('BultosJSON', sql.NVarChar, ret.orders ? JSON.stringify(ret.orders) : null)
                .query(mergeQuery);
        }

        await transaction.commit();
        return { success: true, count: retirosExternos.length, message: `${retirosExternos.length} retiros sincronizados con éxito.` };

    } catch (innerErr) {
        await transaction.rollback();
        throw innerErr;
    }
};

/**
 * Sincronizar retiros desde la API Central
 */
exports.sincronizarRetirosWeb = async (req, res) => {
    try {
        const result = await runSyncRetirosCore();
        res.json(result);
    } catch (err) {
        console.error("Error al sincronizar retiros:", err);
        res.status(500).json({ error: "Error de sincronización", details: err.message });
    }
};

/**
 * Reportar un Pago hecho en esta plataforma a la API central
 */
exports.reportarPagoRetiro = async (req, res) => {
    const { ordenRetiro, monto, monedaId, metodoPagoId, orderNumbers } = req.body;

    try {
        const pool = await getPool();
        const ordenRetiroId = parseInt(ordenRetiro.replace(/^R-0*/, ''), 10);
        if (isNaN(ordenRetiroId)) return res.status(400).json({ error: "ordenRetiro inválido" });

        console.log(`[REPORTAR PAGO] Procesando pago directo para ${ordenRetiro} (ID: ${ordenRetiroId})`);

        // Validar que exista la orden
        const ordRetResult = await pool.request()
            .input('ID', sql.Int, ordenRetiroId)
            .query('SELECT OReEstadoActual FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID');

        if (ordRetResult.recordset.length === 0) throw new Error(`Orden de retiro ${ordenRetiroId} no encontrada`);

        const estadoActual = ordRetResult.recordset[0].OReEstadoActual;
        const nuevoEstado = estadoActual === 1 ? 3 : 8;
        const usuarioId = req.user?.id || 70;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Insertar pago
            const pagoResult = await new sql.Request(transaction)
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

            // Actualizar orden de retiro
            await new sql.Request(transaction)
                .input('ordenRetiroId', sql.Int, ordenRetiroId)
                .input('nuevoEstado', sql.Int, nuevoEstado)
                .input('pagoId', sql.Int, pagoId)
                .query(`
                    UPDATE OrdenesRetiro 
                    SET PagIdPago = @pagoId, OReEstadoActual = @nuevoEstado, OReFechaEstadoActual = GETDATE(), ORePasarPorCaja = 0
                    WHERE OReIdOrdenRetiro = @ordenRetiroId;
                `);

            // Histórico
            await new sql.Request(transaction)
                .input('ordenRetiroId', sql.Int, ordenRetiroId)
                .input('nuevoEstado', sql.Int, nuevoEstado)
                .input('usuarioId', sql.Int, usuarioId)
                .query(`
                    INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                    VALUES (@ordenRetiroId, @nuevoEstado, GETDATE(), @usuarioId);
                `);

            // Actualizar órdenes individuales si hay orderNumbers
            if (orderNumbers && orderNumbers.length > 0) {
                const orderIdsList = orderNumbers.join(', ');
                await new sql.Request(transaction)
                    .input('pagoId', sql.Int, pagoId)
                    .query(`
                        UPDATE OrdenesDeposito SET PagIdPago = @pagoId, OrdEstadoActual = 7, OrdFechaEstadoActual = GETDATE()
                        WHERE OrdIdOrden IN (${orderIdsList});
                    `);

                const historicoValues = orderNumbers.map(oid => `(${oid}, 7, GETDATE(), ${usuarioId})`).join(', ');
                await new sql.Request(transaction).query(`
                    INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                    VALUES ${historicoValues};
                `);
            }

            await transaction.commit();

            // Actualizar RetirosWeb local
            try {
                await pool.request()
                    .input('Ord', sql.NVarChar, ordenRetiro)
                    .input('Est', sql.Int, 3)
                    .query(`UPDATE RetirosWeb SET Estado = @Est WHERE OrdIdRetiro = @Ord`);
            } catch (errDb) {
                console.error("Aviso: no se pudo actualizar RetirosWeb:", errDb.message);
            }

            const io = req.app.get('socketio');
            if (io) io.emit('actualizado', { type: 'actualizacion' });

            res.json({ success: true, message: 'Pago registrado correctamente.', pagoId });

        } catch (txErr) {
            try { await transaction.rollback(); } catch (e) { }
            throw txErr;
        }

    } catch (err) {
        console.error("Error al reportar pago:", err);
        res.status(500).json({ error: "Fallo al procesar el pago", details: err.message });
    }
};

/**
 * Traer lista completa de retiros actuales que existen localmente en la base
 */
exports.getAllLocalRetiros = async (req, res) => {
    try {
        const pool = await getPool();
        const query = `
            SELECT r.*, c.Nombre as NombreCliente 
            FROM RetirosWeb r
            LEFT JOIN Clientes c ON CAST(r.CodCliente AS VARCHAR) = CAST(c.CodCliente AS VARCHAR)
            ORDER BY r.Fecha DESC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error("Error get_local_retiros:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Traer lista de retiros de un cliente específico que estén pendientes de pago (Estado 1)
 */
exports.getMyRetirosPendientes = async (req, res) => {
    try {
        const codCliente = req.user?.codCliente || req.user?.id;
        if (!codCliente) return res.status(401).json({ error: "Usuario sin código de cliente" });

        // Sincronizar en background para asegurarnos de que la base local tiene el estado fresco
        // Así los retiros que acaban de ser abonados en otra ventana desaparecen de la tabla de pagos pendientes
        try {
            await runSyncRetirosCore();
        } catch (syncErr) {
            console.error("Warning: Podría no estar súper fresco el dato (falló sync interno):", syncErr.message);
        }

        const pool = await getPool();
        const query = `
            SELECT r.*
            FROM RetirosWeb r
            WHERE CAST(r.CodCliente AS VARCHAR) = CAST(@codCliente AS VARCHAR)
              AND r.Estado IN (1, 7)
            ORDER BY r.Fecha DESC
        `;
        const result = await pool.request()
            .input('codCliente', sql.VarChar, String(codCliente))
            .query(query);

        res.json(result.recordset);
    } catch (err) {
        console.error("Error get_my_retiros_pendientes:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GENERAR LINK DE PAGO PARA UN RETIRO (HANDY)
 */
exports.createHandyPaymentLinkForRetiro = async (req, res) => {
    try {
        const { ordenRetiro, totalAmount, activeCurrency, bultosJSON } = req.body;

        if (!ordenRetiro) {
            return res.status(400).json({ error: "No se proporcionó orden de retiro." });
        }

        let currencyCode = activeCurrency === 'USD' ? 840 : 858;

        // Determinar description
        let products = [];
        try {
            const parsedBultos = JSON.parse(bultosJSON || "[]");
            products = parsedBultos.map(b => ({
                name: (b.orderNumber || b.id || 'Pedido').substring(0, 50),
                quantity: 1,
                amount: b.amount ? Number(Number(b.amount).toFixed(2)) : 0,
                taxedAmount: 0
            }));
        } catch (e) {
            products = [{
                name: "Orden " + ordenRetiro,
                quantity: 1,
                amount: Number(Number(totalAmount).toFixed(2)),
                taxedAmount: 0
            }];
        }

        // Si el parsing dio un total de 0
        if (products.reduce((acc, p) => acc + p.amount, 0) === 0) {
            products = [{
                name: "Orden " + ordenRetiro,
                quantity: 1,
                amount: Number(Number(totalAmount).toFixed(2)),
                taxedAmount: 0
            }];
        }

        const { createPaymentLink } = require('../services/handyService');

        // Construir ordersData para guardar en HandyTransactions
        let parsedBultos = [];
        try { parsedBultos = JSON.parse(bultosJSON || '[]'); } catch (e) { }

        const result = await createPaymentLink({
            products: products.map(p => ({
                Name: (p.name || 'Pedido').substring(0, 50),
                Quantity: p.quantity || 1,
                Amount: p.amount || 0,
                TaxedAmount: p.taxedAmount || 0
            })),
            totalAmount,
            currencyCode,
            commerceName: 'USER - Retiros',
            ordersData: {
                orders: parsedBultos.map(b => ({
                    id: b.orderNumber || b.id || ordenRetiro,
                    desc: b.desc || b.orderNumber || 'Pedido',
                    amount: b.amount || 0
                })),
                ordenRetiro: ordenRetiro,
                reactOrderNumbers: parsedBultos.map(b => b.orderId || b.id).filter(Boolean)
            },
            codCliente: req.user?.codCliente || 0,
            logPrefix: '[HANDY RETIRO]'
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        // Actualizar la ReferenciaPago en RetirosWeb (específico de retiros)
        try {
            const pool = await getPool();
            await pool.request()
                .input('Ord', sql.VarChar, String(ordenRetiro))
                .input('Ref', sql.VarChar, result.transactionId)
                .query(`UPDATE RetirosWeb SET ReferenciaPago = @Ref WHERE OrdIdRetiro = @Ord`);
        } catch (dbErr) {
            console.warn("[HANDY RETIRO] No se pudo actualizar ReferenciaPago:", dbErr.message);
        }

        return res.json({ success: true, url: result.url, transactionId: result.transactionId });

    } catch (err) {
        console.error("Error creating Handy link for Retiro:", err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data?.message || err.message });
    }
};

/**
 * OBTENER ESTADO DE TODOS LOS ESTANTES 
 */
exports.obtenerMapaEstantes = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                c.EstanteID, 
                c.Seccion, 
                c.Posicion, 
                c.EstanteID + '-' + CAST(c.Seccion AS VARCHAR) + '-' + CAST(c.Posicion AS VARCHAR) AS UbicacionID,
                c.Activo,
                o.OrdenRetiro,
                o.CodigoCliente,
                cli.Nombre as ClientName,
                o.BultosJSON,
                o.Pagado,
                CASE WHEN rw.ReferenciaPago IS NOT NULL AND rw.ReferenciaPago <> '' THEN 1 ELSE 0 END AS PagoHandy,
                o.FechaUbicacion
            FROM ConfiguracionEstantes c
            LEFT JOIN OcupacionEstantes o 
                ON c.EstanteID = o.EstanteID AND c.Seccion = o.Seccion AND c.Posicion = o.Posicion
            LEFT JOIN Clientes cli ON CAST(o.CodigoCliente AS VARCHAR) = CAST(cli.CodCliente AS VARCHAR)
            LEFT JOIN RetirosWeb rw ON o.OrdenRetiro = rw.OrdIdRetiro
            WHERE c.Activo = 1
            ORDER BY c.EstanteID, c.Seccion, c.Posicion
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: "Error al obtener mapa estantes", details: err.message });
    }
};

/**
 * EMPAQUETAR Y ASIGNAR A ESTANTE
 */
exports.asignarRetiroAEstante = async (req, res) => {
    const { estanteId, seccion, posicion, ordenRetiro, codigoCliente, bultos, pagado, scannedValues } = req.body;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Eliminamos la comprobación de ocupación única para permitir múltiple
            // const checkQuery = ...

            await new sql.Request(transaction)
                .input('e', sql.Char, estanteId)
                .input('s', sql.Int, seccion)
                .input('p', sql.Int, posicion)
                .input('o', sql.VarChar, ordenRetiro)
                .input('c', sql.VarChar, codigoCliente)
                .input('b', sql.NVarChar, JSON.stringify(bultos))
                .input('pag', sql.Bit, pagado ? 1 : 0)
                .query(`
                    INSERT INTO OcupacionEstantes (EstanteID, Seccion, Posicion, OrdenRetiro, CodigoCliente, BultosJSON, Pagado)
                    VALUES (@e, @s, @p, @o, @c, @b, @pag)
                `);

            const nuevoEstado = pagado ? 8 : 7;
            const ubicacionString = `${estanteId}-${seccion}-${posicion}`;

            await new sql.Request(transaction)
                .input('Ord', sql.VarChar, ordenRetiro)
                .input('Est', sql.Int, nuevoEstado)
                .input('Ubi', sql.VarChar, ubicacionString)
                .query(`
                    IF EXISTS (SELECT 1 FROM RetirosWeb WHERE OrdIdRetiro = @Ord)
                    BEGIN
                        UPDATE RetirosWeb 
                        SET Estado = @Est, UbicacionEstante = @Ubi 
                        WHERE OrdIdRetiro = @Ord
                    END
                `);

            await transaction.commit();

            // 4. Marcar pronto en DB directamente (reemplaza llamada a API central)
            try {
                const OReIdOrdenRetiro = parseInt(ordenRetiro.replace(/^R-0*/, ''), 10);
                const fechaPronto = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
                const UsuarioAlta = req.user?.id || 70;

                // Generar lista de códigos de órdenes escaneadas
                const bultosLimpios = (scannedValues || []).filter(val => val && val.trim() !== '');
                if (bultosLimpios.length > 0) {
                    const inClause = bultosLimpios.map(v => `'${v.trim()}'`).join(',');

                    await pool.request().query(`
                        INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                        SELECT OrdIdOrden, 7, '${fechaPronto}', ${UsuarioAlta}
                        FROM OrdenesDeposito WHERE OrdCodigoOrden IN (${inClause});
                        
                        UPDATE OrdenesDeposito SET OrdEstadoActual = 7, OrdFechaEstadoActual = '${fechaPronto}' WHERE OrdCodigoOrden IN (${inClause});
                    `);
                }

                // Actualizar estado de la orden de retiro
                const retRes = await pool.request()
                    .input('ID', sql.Int, OReIdOrdenRetiro)
                    .query('SELECT OReEstadoActual FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID');

                if (retRes.recordset.length > 0) {
                    const nuevoEstado = retRes.recordset[0].OReEstadoActual === 1 ? 7 : 8;
                    await pool.request()
                        .input('ID', sql.Int, OReIdOrdenRetiro)
                        .input('EstID', sql.Int, nuevoEstado)
                        .input('Fec', sql.DateTime, new Date(fechaPronto))
                        .input('Usr', sql.Int, UsuarioAlta)
                        .query(`
                            UPDATE OrdenesRetiro SET OReEstadoActual = @EstID, OReFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
                            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@ID, @EstID, @Fec, @Usr);
                        `);
                }

                console.log(`[PRONTO] OK ${ordenRetiro}`);
            } catch (extErr) {
                console.error(`[PRONTO] ERROR ${ordenRetiro}:`, extErr.message);
            }

            // EMITIR EVENTO SOCKET.IO
            const io = req.app.get('socketio');
            if (io) io.emit('retiros:update');

            res.json({ success: true, message: 'Ubicación asignada y notificada a central' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

/**
 * ENTREGAR AL CLIENTE
 */
exports.marcarRetiroEntregado = async (req, res) => {
    const { ubicacionId } = req.params;

    try {
        const pool = await getPool();

        // Buscar a qué retiro pertenece antes de borrar
        const ubiRes = await pool.request()
            .input('id', sql.VarChar, ubicacionId)
            .query('SELECT OrdenRetiro FROM OcupacionEstantes WHERE UbicacionID = @id');

        if (ubiRes.recordset.length === 0) {
            return res.status(404).json({ error: "Ubicación no encontrada" });
        }

        const ordenesDeRetiro = ubiRes.recordset.map(row => row.OrdenRetiro);

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Liberar el Estante Físico (eliminará todas las filas con ese UbicacionID)
            await new sql.Request(transaction)
                .input('id', sql.VarChar, ubicacionId)
                .query('DELETE FROM OcupacionEstantes WHERE UbicacionID = @id');

            // 2. Marcar RetirosWeb como Entregada (Estado 5)
            for (const ord of ordenesDeRetiro) {
                await new sql.Request(transaction)
                    .input('Ord', sql.VarChar, ord)
                    .query('UPDATE RetirosWeb SET Estado = 5 WHERE OrdIdRetiro = @Ord');
            }

            // 3. Marcar entregadas en DB directamente
            try {
                const fechaEntrega = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
                const UsuarioAlta = req.user?.id || 70;

                for (const ord of ordenesDeRetiro) {
                    const OReId = parseInt(ord.replace(/^R-0*/, ''), 10);
                    if (isNaN(OReId)) continue;
                    console.log(`[ENTREGADO MULTIPLE] ${ord} -> ${OReId}`);

                    await new sql.Request(transaction)
                        .input('ID', sql.Int, OReId)
                        .input('Fec', sql.DateTime, new Date(fechaEntrega))
                        .input('Usr', sql.Int, UsuarioAlta)
                        .query(`
                            INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                            SELECT OrdIdOrden, 9, @Fec, @Usr FROM OrdenesDeposito WHERE OReIdOrdenRetiro = @ID;
                            UPDATE OrdenesDeposito SET OrdEstadoActual = 9, OrdFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
                            UPDATE OrdenesRetiro SET OReEstadoActual = 5, ORePasarPorCaja = 0, OReFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
                            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@ID, 5, @Fec, @Usr);
                        `);
                }
            } catch (extErr) {
                console.error(`[MARCAR ENTREGADO] ERROR:`, extErr.message);
            }

            await transaction.commit();

            // EMITIR EVENTO SOCKET.IO
            const io = req.app.get('socketio');
            if (io) io.emit('retiros:update');

            res.json({ success: true, message: 'Orden entregada. Estante liberado exitosamente.' });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error("Error al entregar:", err);
        res.status(500).json({ error: "Fallo en la entrega general", details: err.message });
    }
};

/**
 * ENTREGAR AL CLIENTE MULTIPLES SELECCIONES DE UN CASILLERO
 */
exports.marcarRetiroEntregadoMultiple = async (req, res) => {
    const { ubicacionId, ordenesParaEntregar } = req.body;

    if (!ubicacionId || !Array.isArray(ordenesParaEntregar) || ordenesParaEntregar.length === 0) {
        return res.status(400).json({ error: 'Faltan parámetros o no se seleccionó ninguna orden.' });
    }

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Liberar del Estante Físico SÓLO las especificadas
            for (const ord of ordenesParaEntregar) {
                await new sql.Request(transaction)
                    .input('id', sql.VarChar, ubicacionId)
                    .input('Ord', sql.VarChar, ord)
                    .query('DELETE FROM OcupacionEstantes WHERE UbicacionID = @id AND OrdenRetiro = @Ord');

                // 2. Marcar RetirosWeb como Entregada (Estado 5) solamente si existe (es web)
                await new sql.Request(transaction)
                    .input('Ord', sql.VarChar, ord)
                    .query(`
                        IF EXISTS (SELECT 1 FROM RetirosWeb WHERE OrdIdRetiro = @Ord)
                        BEGIN
                            UPDATE RetirosWeb SET Estado = 5 WHERE OrdIdRetiro = @Ord
                        END
                    `);
            }

            // 3. Marcar entregadas en DB directamente
            try {
                const fechaEntrega = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
                const UsuarioAlta = req.user?.id || 70;

                for (const ord of ordenesParaEntregar) {
                    const OReId = parseInt(ord.replace(/^R-0*/, ''), 10);
                    if (isNaN(OReId)) continue;
                    console.log(`[ENTREGADO MULTIPLE SELECCIÓN] ${ord} -> ${OReId}`);

                    await new sql.Request(transaction)
                        .input('ID', sql.Int, OReId)
                        .input('Fec', sql.DateTime, new Date(fechaEntrega))
                        .input('Usr', sql.Int, UsuarioAlta)
                        .query(`
                            INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                            SELECT OrdIdOrden, 9, @Fec, @Usr FROM OrdenesDeposito WHERE OReIdOrdenRetiro = @ID;
                            UPDATE OrdenesDeposito SET OrdEstadoActual = 9, OrdFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
                            UPDATE OrdenesRetiro SET OReEstadoActual = 5, ORePasarPorCaja = 0, OReFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
                            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@ID, 5, @Fec, @Usr);
                        `);
                }
            } catch (extErr) {
                console.error(`[MARCAR ENTREGADO] ERROR:`, extErr.message);
            }

            await transaction.commit();

            // EMITIR EVENTO SOCKET.IO
            const io = req.app.get('socketio');
            if (io) io.emit('retiros:update');

            res.json({ success: true, message: 'Órdenes seleccionadas entregadas exitosamente.' });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error("Error al entregar selección múltiple:", err);
        res.status(500).json({ error: "Fallo en la entrega múltiple", details: err.message });
    }
};

/**
 * Traer lista de métodos de pago desde la API central
 
exports.getPaymentMethods = async (req, res) => {
    try {
        console.log(`[PAYMENT METHODS] Solicitando token a la central...`);
        const tokenRes = await axios.post(`${REACT_API_URL}/apilogin/generate-token`, {
            apiKey: "api_key_google_123sadas12513_user"
        });

        console.log(`[PAYMENT METHODS] Solicitando métodos de pago a la central...`);
        const response = await axios.get(`${REACT_API_URL}/apipagos/metodos`, {
            headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
        });

        res.json(response.data);
    } catch (err) {
        console.error("[PAYMENT METHODS] Error al obtener métodos de pago:", err.response?.data || err.message);
        res.status(500).json({ error: "Fallo al obtener métodos de pago desde la API central", details: err.message });
    }
};*/

/**
 * Traer órdenes para Caja
 
exports.getCajaOrdenes = async (req, res) => {
    try {
        const tokenRes = await axios.post(`${REACT_API_URL}/apilogin/generate-token`, {
            apiKey: "api_key_google_123sadas12513_user"
        });

        const response = await axios.get(`${REACT_API_URL}/apiordenesretiro/caja`, {
            headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
        });
        res.json(response.data);
    } catch (err) {
        console.error("[CAJA ORDENES] Error al obtener órdenes de caja:", err.response?.data || err.message);
        res.status(500).json({ error: "Fallo al obtener órdenes de caja", details: err.message });
    }
};*/

/**
 * Obtener cotización
 
exports.getCotizacion = async (req, res) => {
    try {
        const response = await axios.get(`${REACT_API_URL}/apicotizaciones/hoy`);
        res.json(response.data);
    } catch (err) {
        console.error("[COTIZACION] Error al obtener cotización:", err.response?.data || err.message);
        res.status(500).json({ error: "Fallo al obtener cotización", details: err.message });
    }
};*/

/**
 * Marcar pasar por caja
 
exports.marcarPasarPorCaja = async (req, res) => {
    try {
        const { ordenDeRetiro } = req.body;
        if (!ordenDeRetiro) return res.status(400).json({ error: "No se proporcionó orden de retiro" });

        const tokenRes = await axios.post(`${REACT_API_URL}/apilogin/generate-token`, {
            apiKey: "api_key_google_123sadas12513_user"
        });

        const payload = { ordenDeRetiro };

        // Asumiendo que el ID de usuario es 1 para Caja en la URL
        // o quizás el endpoint no exige un ID dinámico (el usuario dijo /marcarpasarporcaja/1)
        const response = await axios.post(`${REACT_API_URL}/apiordenesretiro/marcarpasarporcaja/1`, payload, {
            headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
        });

        res.json({ success: true, data: response.data });
    } catch (err) {
        console.error("[MARCAR CAJA] Error al marcar por caja:", err.response?.data || err.message);
        res.status(500).json({ error: "Fallo al marcar pasar por caja", details: err.message });
    }
};*/

/**
 * Traer Transacciones de Handy
 */
exports.getPagosOnline = async (req, res) => {
    try {
        const pool = await getPool();
        const { startDate, endDate, clientFilter, orderFilter } = req.query;

        let queryStr = `
            SELECT TOP (1000) 
                h.Id,
                h.TransactionId,
                h.PaymentUrl,
                h.TotalAmount,
                h.Currency,
                h.OrdersJson,
                h.CodCliente,
                h.Status,
                h.IssuerName,
                h.PaidAt,
                h.WebhookReceivedAt,
                h.CreatedAt,
                c.Nombre as NombreCliente
            FROM HandyTransactions h
            LEFT JOIN Clientes c ON CAST(h.CodCliente AS VARCHAR) = CAST(c.CodCliente AS VARCHAR)
            WHERE 1=1
        `;

        const request = pool.request();

        if (startDate) {
            queryStr += ` AND CAST(h.CreatedAt AS DATE) >= @StartDate`;
            request.input('StartDate', sql.Date, startDate);
        }

        if (endDate) {
            queryStr += ` AND CAST(h.CreatedAt AS DATE) <= @EndDate`;
            request.input('EndDate', sql.Date, endDate);
        }

        if (clientFilter) {
            queryStr += ` AND (c.Nombre LIKE '%' + @ClientFilter + '%' OR CAST(h.CodCliente AS VARCHAR) LIKE '%' + @ClientFilter + '%')`;
            request.input('ClientFilter', sql.NVarChar, clientFilter);
        }

        if (orderFilter) {
            let cleanFilter = orderFilter.trim();
            // Si el usuario busca "R-60174", limpiamos el "R-" para buscar "60174" dentro del JSON.
            let numFilter = cleanFilter.toUpperCase().startsWith('R-') ? cleanFilter.substring(2) : cleanFilter;

            queryStr += ` AND (h.OrdersJson LIKE '%' + @OrderFilter + '%' OR h.OrdersJson LIKE '%' + @NumFilter + '%' OR h.TransactionId LIKE '%' + @OrderFilter + '%')`;
            request.input('OrderFilter', sql.NVarChar, cleanFilter);
            request.input('NumFilter', sql.NVarChar, numFilter);
        }

        queryStr += ` ORDER BY h.CreatedAt DESC`;

        const result = await request.query(queryStr);
        res.json(result.recordset);
    } catch (err) {
        console.error("[PAGOS ONLINE] Error fetching Handy Transactions:", err);
        res.status(500).json({ error: "Fallo al traer pagos online", details: err.message });
    }
};

/**
 * Traer otras OTs (Semanales, Rollos por adelantado, etc) para Caja
 
exports.getCajaOtros = async (req, res) => {
    try {
        const tokenRes = await axios.post(`${REACT_API_URL}/apilogin/generate-token`, {
            apiKey: "api_key_google_123sadas12513_user"
        });

        const url = `${REACT_API_URL}/apiordenesRetiro/estados?estados=Ingresado,Abonado,Abonado%20de%20antemano,Empaquetado%20sin%20abonar`;
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
        });
        res.json(response.data);
    } catch (err) {
        console.error("[CAJA OTROS] Error al obtener órdenes de caja (otros):", err.response?.data || err.message);
        res.status(500).json({ error: "Fallo al obtener otras órdenes de caja", details: err.message });
    }
};*/

/**
 * Guardar retiro excepcional (con deuda) en la tabla local
 */
exports.marcarExcepcional = async (req, res) => {
    try {
        const { ordenRetiro, codigoCliente, monto, password, explicacion } = req.body;

        if (!password || password.trim() === '') {
            return res.status(401).json({ error: "Contraseña requerida para autorizar este retiro." });
        }

        if (!explicacion || explicacion.trim() === '') {
            return res.status(400).json({ error: "Debe ingresar una justificación/explicación obligatoria." });
        }

        if (password !== process.env.CONTRAAUTORIZO) {
            return res.status(403).json({ error: "Contraseña incorrecta." });
        }

        const pool = await sql.connect();
        await pool.request()
            .input('orden', sql.VarChar, ordenRetiro)
            .input('cliente', sql.VarChar, codigoCliente)
            .input('monto', sql.VarChar, String(monto))
            .input('pwd', sql.VarChar, password)
            .input('expl', sql.NVarChar, explicacion)
            .query(`INSERT INTO RetirosConDeuda (OrdenRetiro, CodigoCliente, Monto, UsuarioAutorizador, Explicacion) VALUES (@orden, @cliente, @monto, @pwd, @expl)`);

        res.json({ message: "Retiro registrado como deuda y autorizado exitosamente." });
    } catch (err) {
        console.error("[EXCEPCIONAL] Error al guardar retiro excepcional:", err);
        res.status(500).json({ error: "Fallo al registrar retiro excepcional", details: err.message });
    }
};

/**
 * Obtener todos los retiros excepcionales con deuda
 */
exports.getExcepciones = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT e.*, c.Nombre as NombreCliente 
            FROM RetirosConDeuda e
            LEFT JOIN Clientes c ON CAST(e.CodigoCliente AS VARCHAR) = CAST(c.CodCliente AS VARCHAR)
            ORDER BY e.Fecha DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error("[EXCEPCIONES] Error al obtener excepciones de deuda:", err);
        res.status(500).json({ error: "Fallo al obtener retiros excepcionales", details: err.message });
    }
};

/**
 * Marcar una excepcion de deuda como gestionada/pagada
 */
exports.gestionarExcepcion = async (req, res) => {
    try {
        const { id } = req.params;
        const { gestionado } = req.body;

        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .input('gestionado', sql.Bit, gestionado ? 1 : 0)
            .query(`
                UPDATE RetirosConDeuda 
                SET Gestionado = @gestionado, FechaGestion = GETDATE()
                WHERE Id = @id
            `);

        res.json({ success: true, message: "Actualizado exitosamente." });
    } catch (err) {
        console.error("[EXCEPCION GESTION] Error al actualizar estado:", err);
        res.status(500).json({ error: "Fallo al actualizar la excepción", details: err.message });
    }
};
