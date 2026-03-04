const { getPool, sql } = require('../config/db');
const axios = require('axios');
const REACT_API_URL = process.env.REACT_API_URL;
const REACT_API_KEY = process.env.REACT_API_KEY;

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

    const response = await axios.get(`${REACT_API_URL}/apiordenesRetiro/estados?estados=Ingresado,Abonado,Abonado%20de%20antemano,Empaquetado%20sin%20abonar,Empaquetado%20y%20abonado,Entregado,Cancelar`);
    const retirosExternos = response.data;

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
        console.log(`[REPORTAR PAGO] Solicitando token a la central...`);
        const tokenRes = await axios.post(`${API_BASE_URL}/apilogin/generate-token`, {
            apiKey: "api_key_google_123sadas12513_user"
        });

        const pool = await getPool();

        const payloadPago = {
            metodoPagoId,
            monedaId,
            monto,
            ordenRetiro,
            orderNumbers
        };

        console.log(`[REPORTAR PAGO] Ejecutando apipagos/realizarPago para ${ordenRetiro}`);
        const responseApi = await axios.post(`${REACT_API_URL}/apipagos/realizarPago`, payloadPago, {
            headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
        });

        if (responseApi.status === 200 || responseApi.data?.success || responseApi.data?.exitoso) {
            try {
                // Actualizar DB local (opcional/silencioso si falla)
                await pool.request()
                    .input('Ord', sql.NVarChar, ordenRetiro)
                    .input('Est', sql.Int, 3) // 3 = Abonado
                    .query(`UPDATE RetirosWeb SET Estado = @Est WHERE OrdIdRetiro = @Ord`);
            } catch (errDb) {
                console.error("Aviso: no se pudo actualizar bbdd local:", errDb);
            }

            res.json({ success: true, message: 'Pago registrado correctamente en destino.', data: responseApi.data });
        } else {
            console.error("Respuesta no satisfactoria realizarPago:", responseApi.data);
            throw new Error("Respuesta no satisfactoria de la API de Pagos");
        }

    } catch (err) {
        console.error("Error al reportar pago:", err);
        res.status(500).json({ error: "Fallo al procesar el pago externo", details: err.message });
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
                o.FechaUbicacion
            FROM ConfiguracionEstantes c
            LEFT JOIN OcupacionEstantes o 
                ON c.EstanteID = o.EstanteID AND c.Seccion = o.Seccion AND c.Posicion = o.Posicion
            LEFT JOIN Clientes cli ON CAST(o.CodigoCliente AS VARCHAR) = CAST(cli.CodCliente AS VARCHAR)
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

            // 4. NUEVO: Llamar a la API central "marcarpronto"
            try {
                // Sacamos la R- del ordenRetiro
                const ordenLimpia = ordenRetiro.startsWith('R-') ? ordenRetiro.substring(2) : ordenRetiro;

                console.log(`[PRONTO] ${ordenRetiro} -> ${ordenLimpia}`);
                const tokenRes = await axios.post(`${REACT_API_URL}/apilogin/generate-token`, {
                    apiKey: REACT_API_KEY
                });

                // Generar versiones con padding para lidiar con el tipado CHAR(20) o CHAR(50) 
                // con espacios en blanco a la derecha que la base remota suele retornar.
                const bultosLimpios = (scannedValues || []).filter(val => val && val.trim() !== "");
                const bultosPadded = [];
                bultosLimpios.forEach(b => {
                    const trimmed = b.trim();
                    bultosPadded.push(trimmed);
                    for (let i = 1; i <= 30; i++) {
                        bultosPadded.push(trimmed + " ".repeat(i));
                    }
                });

                const payloadPronto = {
                    ordenDeRetiro: String(ordenLimpia), // Enviar SIEMPRE como string para evitar crash de .replace
                    scannedValues: bultosPadded
                };


                const responsePronto = await axios.post(`${REACT_API_URL}/apiordenesRetiro/marcarpronto`, payloadPronto, {
                    headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
                });
                console.log(`[PRONTO] OK`, responsePronto.data?.message || '');
            } catch (extErr) {
                console.error(`[PRONTO] ERROR ${ordenRetiro}:`, extErr.response?.status || '', extErr.response?.data?.message || extErr.message);
                // No abortamos la transacción local porque ya se guardó correctamente.
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

            // 3. Notificar a tu API externa para cada orden
            try {
                const tokenRes = await axios.post(`${REACT_API_URL}/apilogin/generate-token`, {
                    apiKey: REACT_API_KEY
                });

                for (const ord of ordenesDeRetiro) {
                    const ordenLimpia = ord.startsWith('R-') ? ord.substring(2) : ord;
                    console.log(`[ENTREGADO MULTIPLE] ${ord} -> ${ordenLimpia}`);

                    const payloadEntregado = {
                        ordenDeRetiro: String(ordenLimpia)
                    };

                    await axios.post(`${REACT_API_URL}/apiordenesRetiro/marcarOrdenEntregada`, payloadEntregado, {
                        headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
                    }).catch(err => {
                        console.error(`Error al marcar entregada en central para ${ord}: ${err.message}`);
                    });
                }
            } catch (extErr) {
                console.error(`[MARCAR ENTREGADO] ERROR general de central:`, extErr.message);
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

            // 3. Notificar a tu API externa para cada orden
            try {
                const tokenRes = await axios.post(`${REACT_API_URL}/apilogin/generate-token`, {
                    apiKey: REACT_API_KEY
                });

                for (const ord of ordenesParaEntregar) {
                    const ordenLimpia = ord.startsWith('R-') ? ord.substring(2) : ord;
                    console.log(`[ENTREGADO MULTIPLE SELECCIÓN] ${ord} -> ${ordenLimpia}`);

                    const payloadEntregado = {
                        ordenDeRetiro: String(ordenLimpia)
                    };

                    await axios.post(`${REACT_API_URL}/apiordenesRetiro/marcarOrdenEntregada`, payloadEntregado, {
                        headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
                    }).catch(err => {
                        console.error(`Error al marcar entregada en central para ${ord}: ${err.message}`);
                    });
                }
            } catch (extErr) {
                console.error(`[MARCAR ENTREGADO] ERROR general de central:`, extErr.message);
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
 */
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
};

/**
 * Traer órdenes para Caja
 */
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
};

/**
 * Obtener cotización
 */
exports.getCotizacion = async (req, res) => {
    try {
        const response = await axios.get(`${REACT_API_URL}/apicotizaciones/hoy`);
        res.json(response.data);
    } catch (err) {
        console.error("[COTIZACION] Error al obtener cotización:", err.response?.data || err.message);
        res.status(500).json({ error: "Fallo al obtener cotización", details: err.message });
    }
};

/**
 * Marcar pasar por caja
 */
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
};

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
 */
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
};

/**
 * Guardar retiro excepcional (con deuda) en la tabla local
 */
exports.marcarExcepcional = async (req, res) => {
    try {
        const { ordenRetiro, codigoCliente, monto, password } = req.body;

        if (!password || password.trim() === '') {
            return res.status(401).json({ error: "Contraseña requerida para autorizar este retiro." });
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
            .query(`INSERT INTO RetirosConDeuda (OrdenRetiro, CodigoCliente, Monto, UsuarioAutorizador) VALUES (@orden, @cliente, @monto, @pwd)`);

        res.json({ message: "Retiro registrado como deuda y autorizado exitosamente." });
    } catch (err) {
        console.error("[EXCEPCIONAL] Error al guardar retiro excepcional:", err);
        res.status(500).json({ error: "Fallo al registrar retiro excepcional", details: err.message });
    }
};
