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
        const pool = await getPool();

        const payloadPago = {
            metodoPagoId,
            monedaId,
            monto,
            ordenRetiro,
            orderNumbers
        };

        const responseApi = await axios.post(`${REACT_API_URL}/apipagos/realizarPago`, payloadPago);

        if (responseApi.status === 200 || responseApi.data.success || responseApi.data.exitoso) {
            await pool.request()
                .input('Ord', sql.NVarChar, ordenRetiro)
                .input('Est', sql.Int, 3) // 3 = Abonado
                .query(`UPDATE RetirosWeb SET Estado = @Est WHERE OrdIdRetiro = @Ord`);

            res.json({ success: true, message: 'Pago registrado correctamente en destino y local.' });
        } else {
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

        const { v4: uuidv4 } = require('uuid');
        const transactionId = uuidv4();
        const invoiceNumber = Math.floor(Math.random() * 90000) + 10000;

        const handyPayload = {
            cart: {
                currency: currencyCode,
                totalAmount: Number(Number(totalAmount).toFixed(2)),
                taxedAmount: 0,
                products: products,
                invoiceNumber: invoiceNumber,
                transactionExternalId: `RETIRO-${ordenRetiro}-${transactionId}`
            },
            client: {
                commerceName: "USER - Retiros",
                siteUrl: "http://localhost:5173"
            },
            callbackUrl: "https://webhook.site/72ee5914-012a-478d-a2fd-3801d3561230",
            responseType: "Json"
        };

        const handySecret = 'c80c2dca-ee4f-4cec-ace0-850747a5dcfa'; // Testing
        const handyUrl = 'https://api.payments.arriba.uy/api/v2/payments';

        console.log("[HANDY RETIRO] Creando link...", JSON.stringify(handyPayload));

        const response = await axios.post(handyUrl, handyPayload, {
            headers: { 'merchant-secret-key': handySecret }
        });

        if (response.data && response.data.url) {

            // Actualizar la ReferenciaPago en la Base de Datos para guardarlo como intento de pago
            const pool = await getPool();
            await pool.request()
                .input('Ord', sql.VarChar, ordenRetiro)
                .input('Ref', sql.VarChar, `RETIRO-${ordenRetiro}-${transactionId}`)
                .query(`UPDATE RetirosWeb SET ReferenciaPago = @Ref WHERE OrdIdRetiro = @Ord`);

            return res.json({ success: true, url: response.data.url });
        } else {
            return res.status(500).json({ error: "La pasarela no devolvió una URL válida." });
        }

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
            const checkQuery = await new sql.Request(transaction)
                .input('e', sql.Char, estanteId)
                .input('s', sql.Int, seccion)
                .input('p', sql.Int, posicion)
                .query('SELECT 1 FROM OcupacionEstantes WHERE EstanteID = @e AND Seccion = @s AND Posicion = @p');

            if (checkQuery.recordset.length > 0) {
                throw new Error('La ubicación ya se encuentra ocupada por otro pedido.');
            }

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
                    UPDATE RetirosWeb 
                    SET Estado = @Est, UbicacionEstante = @Ubi 
                    WHERE OrdIdRetiro = @Ord
                `);

            await transaction.commit();

            // 4. NUEVO: Llamar a la API central "marcarpronto"
            try {
                // Sacamos la R- del ordenRetiro
                const ordenLimpia = ordenRetiro.startsWith('R-') ? ordenRetiro.substring(2) : ordenRetiro;

                console.log(`[MARCAR PRONTO] Preparando llamado para orden: ${ordenRetiro} (limpia: ${ordenLimpia})`);
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
                console.log(`[MARCAR PRONTO] Payload a enviar:`, JSON.stringify(payloadPronto, null, 2));

                const responsePronto = await axios.post(`${REACT_API_URL}/apiordenesRetiro/marcarpronto`, payloadPronto, {
                    headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
                });
                console.log(`[MARCAR PRONTO] Respuesta de central exitosa:`, responsePronto.data);
            } catch (extErr) {
                console.error(`[MARCAR PRONTO] ERROR de central para orden ${ordenRetiro}:`);
                if (extErr.response) {
                    console.error("Status:", extErr.response.status);
                    console.error("Data:", JSON.stringify(extErr.response.data, null, 2));
                } else {
                    console.error("Mensaje:", extErr.message);
                }
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

        const ordenDeRetiro = ubiRes.recordset[0].OrdenRetiro;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Liberar el Estante Físico
            await new sql.Request(transaction)
                .input('id', sql.VarChar, ubicacionId)
                .query('DELETE FROM OcupacionEstantes WHERE UbicacionID = @id');

            // 2. Marcar RetirosWeb como Entregada (Estado 5)
            await new sql.Request(transaction)
                .input('Ord', sql.VarChar, ordenDeRetiro)
                .query('UPDATE RetirosWeb SET Estado = 5 WHERE OrdIdRetiro = @Ord');

            // 3. Notificar a tu API externa 
            try {
                // Removemos la "R-" si la API central lo necesita sin prefijo
                const ordenLimpia = ordenDeRetiro.startsWith('R-') ? ordenDeRetiro.substring(2) : ordenDeRetiro;

                console.log(`[MARCAR ENTREGADO] Preparando llamado para orden: ${ordenDeRetiro} (limpia: ${ordenLimpia})`);
                const tokenRes = await axios.post(`${REACT_API_URL}/apilogin/generate-token`, {
                    apiKey: REACT_API_KEY
                });

                const payloadEntregado = {
                    ordenDeRetiro: String(ordenLimpia) // MANDAMOS LA LIMPIA SIN R- Y COMO STRING
                };
                console.log(`[MARCAR ENTREGADO] Payload a enviar:`, JSON.stringify(payloadEntregado, null, 2));

                const responseEntregada = await axios.post(`${REACT_API_URL}/apiordenesRetiro/marcarOrdenEntregada`, payloadEntregado, {
                    headers: { 'Authorization': `Bearer ${tokenRes.data.token}` }
                });
                console.log(`[MARCAR ENTREGADO] Respuesta de central exitosa:`, responseEntregada.data);
            } catch (extErr) {
                console.error(`[MARCAR ENTREGADO] ERROR de central para orden ${ordenDeRetiro}:`);
                if (extErr.response) {
                    console.error("Status:", extErr.response.status);
                    console.error("Data:", JSON.stringify(extErr.response.data, null, 2));
                } else {
                    console.error("Mensaje:", extErr.message);
                }
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
