const { getPool, sql } = require('../config/db');
const axios = require('axios');
const moment = require('moment-timezone');
const { marcarEntregado, registrarPago } = require('../services/retiroService');

// Importar funciones del controller de órdenes de retiro local
const ordenesRetiroController = require('./ordenesRetiroController');
const logger = require('../utils/logger');

/**
 * Endpoint nativo para recibir y registrar directamente un retiro web.
 * Actualiza OrdenesRetiro con los datos de pago recibidos.
 */
exports.crearRetiro = async (req, res) => {
    const { OrdIdRetiro, Monto, Moneda, ReferenciaPago } = req.body;

    if (!OrdIdRetiro) {
        return res.status(400).json({ error: "Falta el id de orden de retiro (OrdIdRetiro)" });
    }

    try {
        const pool = await getPool();
        const OReId = parseInt(String(OrdIdRetiro).replace(/^[A-Za-z]+-0*/, ''), 10);

        // Actualizar la orden de retiro existente con datos de pago
        await pool.request()
            .input('OReId', sql.Int, OReId)
            .input('Monto', sql.Decimal(18, 2), Monto || null)
            .input('Moneda', sql.VarChar(10), Moneda || null)
            .input('Ref', sql.VarChar(200), ReferenciaPago || null)
            .query(`
                UPDATE OrdenesRetiro SET 
                    OReCostoTotalOrden = COALESCE(@Monto, OReCostoTotalOrden),
                    MonIdMoneda = COALESCE(@Moneda, MonIdMoneda),
                    ReferenciaPagoOnline = COALESCE(@Ref, ReferenciaPagoOnline)
                WHERE OReIdOrdenRetiro = @OReId
            `);

        res.status(201).json({ success: true, message: 'Retiro actualizado en OrdenesRetiro', id: OrdIdRetiro });

    } catch (err) {
        logger.error("Error al registrar retiro web local:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Sincronizar retiros desde la API Central
 */
exports.sincronizarRetirosWeb = async (req, res) => {
    // Sync deshabilitado: la DB es la fuente de verdad
    res.json({ success: true, count: 0, message: 'Sincronización deshabilitada: DB es fuente de verdad.' });
};

/**
 * Reportar un Pago hecho en esta plataforma a la API central
 */
exports.reportarPagoRetiro = async (req, res) => {
    const { ordenRetiro, monto, monedaId, metodoPagoId, orderNumbers } = req.body;

    try {
        const pool = await getPool();
        const ordenRetiroId = parseInt(String(ordenRetiro).replace(/^[A-Za-z]+-0*/, ''), 10);
        if (isNaN(ordenRetiroId)) return res.status(400).json({ error: "ordenRetiro inválido" });

        logger.info(`[REPORTAR PAGO] Procesando pago directo para ${ordenRetiro} (ID: ${ordenRetiroId})`);

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
            const { pagoId } = await registrarPago(transaction, {
                ordenRetiroId, metodoPagoId, monedaId, monto, orderNumbers, usuarioId, nuevoEstado
            });

            await transaction.commit();

            // OrdenesRetiro ya fue actualizada arriba (reportarPago actualiza PagIdPago)

            const io = req.app.get('socketio');
            if (io) {
                io.emit('actualizado', { type: 'actualizacion' });
                io.emit('retiros:update', { type: 'pago_web' }); // Notifica WebRetirosPage del pago web
            }

            res.json({ success: true, message: 'Pago registrado correctamente.', pagoId });

        } catch (txErr) {
            try { await transaction.rollback(); } catch (e) { }
            throw txErr;
        }

    } catch (err) {
        logger.error("Error al reportar pago:", err);
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
            SELECT 
                COALESCE(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR) AS OrdIdRetiro,
                r.OReCostoTotalOrden AS Monto,
                r.MonIdMoneda AS Moneda,
                r.ReferenciaPagoOnline AS ReferenciaPago,
                r.OReEstadoActual AS Estado,
                r.CodCliente,
                r.OReFechaAlta AS fechaAlta,
                r.FormaRetiro,
                c.Nombre AS NombreCliente,
                c.TelefonoTrabajo AS CliTelefono,
                r.ReceptorNombre,
                COALESCE(fe.Nombre, 
                    CASE WHEN LEN(ISNULL(r.DireccionEnvio, '')) > 0 
                           OR r.AgenciaEnvio IS NOT NULL 
                           OR LEN(ISNULL(r.AgenciaOtra, '')) > 0 
                         THEN 'Envío / Encomienda' 
                         ELSE 'Retiro en el Local' 
                    END
                ) AS LugarRetiro,
                COALESCE(ag.Nombre, r.AgenciaOtra) AS AgenciaNombre,
                r.DireccionEnvio,
                r.DepartamentoEnvio,
                r.LocalidadEnvio,
                tc.TClDescripcion,
                (
                    SELECT STRING_AGG(od.OrdCodigoOrden, ',')
                    FROM RelOrdenesRetiroOrdenes rel WITH(NOLOCK)
                    JOIN OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = rel.OrdIdOrden
                    WHERE rel.OReIdOrdenRetiro = r.OReIdOrdenRetiro
                ) AS OrdenesCodigos,
                (
                    SELECT 
                        od.OrdCodigoOrden AS orderNumber,
                        od.OrdCodigoOrden AS orderId,
                        art.Descripcion AS articuloDescripcion,
                        od.OrdCostoFinal AS costoFinal,
                        m.MonSimbolo AS simbolo
                    FROM RelOrdenesRetiroOrdenes rel2 WITH(NOLOCK)
                    JOIN OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = rel2.OrdIdOrden
                    LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = od.MonIdMoneda
                    LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = od.ProIdProducto
                    WHERE rel2.OReIdOrdenRetiro = r.OReIdOrdenRetiro
                    FOR JSON PATH
                ) AS BultosJSON
            FROM OrdenesRetiro r WITH(NOLOCK)
            LEFT JOIN Clientes c WITH(NOLOCK) ON c.CodCliente = r.CodCliente
            LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            LEFT JOIN FormasEnvio fe WITH(NOLOCK) ON fe.ID = r.LReIdLugarRetiro
            LEFT JOIN Agencias ag WITH(NOLOCK) ON ag.ID = r.AgenciaEnvio
            -- Excluir retiros entregados, cancelados o ya empaquetados
            WHERE r.OReEstadoActual NOT IN (5, 6, 7, 8)
            -- Excluir retiros que ya estan asignados a un estante fisico
            AND NOT EXISTS (
                SELECT 1 FROM OcupacionEstantes oe WITH(NOLOCK)
                WHERE oe.OrdenRetiro = COALESCE(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR)
            )
            ORDER BY r.OReFechaAlta DESC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        logger.error("Error get_local_retiros:", err);
        res.status(500).json({ error: err.message });
    }
};


/**
 * GET /web-retiros/:oreId/bultos
 * Bultos FÍSICOS reales por orden del retiro (para los punticos del checklist de empaque).
 * Mapea OrdenesDeposito → Ordenes (por código) → Logistica_Bultos (PROD_TERMINADO vivos).
 * Devuelve { bultos: { 'SUB-5936 (1/2)': ['5936/B7737', ...], ... } }
 */
exports.getBultosRetiro = async (req, res) => {
    const oreId = parseInt(req.params.oreId, 10);
    if (isNaN(oreId)) return res.status(400).json({ error: 'ID de retiro inválido' });
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('R', sql.Int, oreId)
            .query(`
                SELECT od.OrdCodigoOrden, lb.CodigoEtiqueta
                FROM dbo.OrdenesDeposito od WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
                JOIN dbo.Logistica_Bultos lb WITH(NOLOCK) ON lb.OrdenID = o.OrdenID
                     AND lb.Tipocontenido = 'PROD_TERMINADO'
                     AND lb.Estado NOT IN ('PROCESADO', 'PERDIDO')
                WHERE od.OReIdOrdenRetiro = @R
                ORDER BY od.OrdCodigoOrden, lb.BultoID
            `);
        const porOrden = {};
        for (const row of r.recordset) {
            const k = String(row.OrdCodigoOrden || '').trim();
            if (!porOrden[k]) porOrden[k] = [];
            porOrden[k].push(String(row.CodigoEtiqueta || '').trim());
        }
        res.json({ success: true, bultos: porOrden });
    } catch (err) {
        logger.error('Error getBultosRetiro:', err);
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

        // Sync deshabilitado: la DB ya es la fuente de verdad
        // try { await runSyncRetirosCore(); } catch (syncErr) { }

        const pool = await getPool();
        const query = `
            SELECT 
                COALESCE(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR) AS OrdIdRetiro,
                r.OReCostoTotalOrden AS Monto,
                r.MonIdMoneda AS Moneda,
                r.ReferenciaPagoOnline AS ReferenciaPago,
                r.OReEstadoActual AS Estado,
                r.CodCliente,
                r.OReFechaAlta AS Fecha,
                r.FormaRetiro,
                o.OrdCodigoOrden,
                o.OrdNombreTrabajo,
                o.OrdCostoFinal,
                m.MonSimbolo
            FROM OrdenesRetiro r WITH(NOLOCK)
            LEFT JOIN OrdenesDeposito o WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
            LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = o.MonIdMoneda
            WHERE r.CodCliente = @codCliente
              AND r.OReEstadoActual IN (1, 7)
            ORDER BY r.OReFechaAlta DESC
        `;
        const result = await pool.request()
            .input('codCliente', sql.Int, parseInt(codCliente, 10))
            .query(query);

        // Group by retiro and build BultosJSON from joined orders
        const retirosMap = {};
        for (const row of result.recordset) {
            if (!retirosMap[row.OrdIdRetiro]) {
                retirosMap[row.OrdIdRetiro] = {
                    OrdIdRetiro: row.OrdIdRetiro,
                    Monto: row.Monto,
                    Moneda: row.Moneda,
                    ReferenciaPago: row.ReferenciaPago,
                    Estado: row.Estado,
                    CodCliente: row.CodCliente,
                    Fecha: row.Fecha,
                    FormaRetiro: row.FormaRetiro,
                    BultosJSON: '[]'
                };
            }
            if (row.OrdCodigoOrden) {
                const bultos = JSON.parse(retirosMap[row.OrdIdRetiro].BultosJSON);
                bultos.push({
                    orderNumber: row.OrdCodigoOrden,
                    desc: row.OrdNombreTrabajo || row.OrdCodigoOrden,
                    amount: parseFloat(row.OrdCostoFinal) || 0,
                    currency: row.MonSimbolo || '$'
                });
                retirosMap[row.OrdIdRetiro].BultosJSON = JSON.stringify(bultos);
            }
        }

        res.json(Object.values(retirosMap));
    } catch (err) {
        logger.error("Error get_my_retiros_pendientes:", err);
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

        // Por defecto tomamos lo que diga el frontend
        let currencyCode = activeCurrency === 'USD' ? 840 : 858;

        // --- INICIO FIX DE MONEDA ---
        // Verificar la moneda real en la base de datos para no cobrar en pesos lo que es en dólares.
        // Fuente 1: OrdenesRetiro.MonIdMoneda
        // Fuente 2 (fallback): OrdenesDeposito hijas — más confiable porque usan FK entero a Monedas
        try {
            const pool = await getPool();
            const numMatch = String(ordenRetiro).match(/(\d+)$/);
            const OReIdOrdenRetiro = numMatch ? parseInt(numMatch[1], 10) : NaN;
            
            if (!isNaN(OReIdOrdenRetiro)) {
                // --- Fuente 1: cabecera del retiro ---
                const resMon = await pool.request()
                    .input('ID', sql.Int, OReIdOrdenRetiro)
                    .query('SELECT MonIdMoneda FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID');
                
                if (resMon.recordset.length > 0) {
                    const dbMoneda = resMon.recordset[0].MonIdMoneda;
                    // Mapeo defensivo: 2 o 840 suele ser USD; 1 o 858 suele ser UYU
                    if (dbMoneda === 2 || dbMoneda === 840 || dbMoneda === 'USD') {
                        currencyCode = 840; // USD para Handy
                    } else if (dbMoneda === 1 || dbMoneda === 858 || dbMoneda === 'UYU') {
                        currencyCode = 858; // UYU para Handy
                    }
                }

                // --- Fuente 2: órdenes hijas (override si alguna es USD) ---
                // Si la cabecera dice UYU pero las órdenes hijas tienen MonIdMoneda=2 (USD),
                // la cabecera quedó mal guardada → forzar USD.
                if (currencyCode !== 840) {
                    const resOrdenes = await pool.request()
                        .input('ID', sql.Int, OReIdOrdenRetiro)
                        .query(`
                            SELECT COUNT(*) AS totalUSD
                            FROM OrdenesDeposito WITH(NOLOCK)
                            WHERE OReIdOrdenRetiro = @ID AND MonIdMoneda = 2
                        `);
                    const totalUSD = resOrdenes.recordset[0]?.totalUSD || 0;
                    if (totalUSD > 0) {
                        logger.warn(`[HANDY RETIRO] Cabecera decía UYU pero ${totalUSD} orden(es) hija(s) son USD → forzando currencyCode=840 para ${ordenRetiro}`);
                        currencyCode = 840; // USD
                    }
                }
            }
        } catch (dbErr) {
            logger.warn("[HANDY RETIRO] No se pudo verificar la moneda en BD, usando activeCurrency:", dbErr.message);
        }
        // --- FIN FIX DE MONEDA ---

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

        // Actualizar la ReferenciaPagoOnline en OrdenesRetiro
        try {
            const pool = await getPool();
            const OReId = parseInt(String(ordenRetiro).replace(/^[A-Za-z]+-0*/, ''), 10);
            await pool.request()
                .input('OReId', sql.Int, OReId)
                .input('Ref', sql.VarChar(200), result.transactionId)
                .query(`UPDATE OrdenesRetiro SET ReferenciaPagoOnline = @Ref WHERE OReIdOrdenRetiro = @OReId`);
        } catch (dbErr) {
            logger.warn("[HANDY RETIRO] No se pudo actualizar ReferenciaPagoOnline:", dbErr.message);
        }

        return res.json({ success: true, url: result.url, transactionId: result.transactionId });

    } catch (err) {
        logger.error("Error creating Handy link for Retiro:", err.response?.data || err.message);
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
                RTRIM(c.EstanteID) + '-' + CAST(c.Seccion AS VARCHAR) + '-' + CAST(c.Posicion AS VARCHAR) AS UbicacionID,
                c.Activo,
                o.OrdenRetiro,
                o.CodigoCliente,
                cli.Nombre as ClientName,
                cli.TelefonoTrabajo as CliTelefono,
                tc.TClDescripcion,
                orr.ReceptorNombre,
                COALESCE((
                    SELECT 
                        od.OrdCodigoOrden AS orderNumber,
                        od.OrdCodigoOrden AS orderId,
                        art.Descripcion AS articuloDescripcion,
                        od.OrdCostoFinal AS costoFinal,
                        m.MonSimbolo AS simbolo,
                        od.OrdCostoFinal as amount,
                        m.MonSimbolo as currency
                    FROM OrdenesDeposito od WITH(NOLOCK)
                    LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = od.MonIdMoneda
                    LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = od.ProIdProducto
                    WHERE od.OReIdOrdenRetiro = orr.OReIdOrdenRetiro
                    FOR JSON PATH
                ), o.BultosJSON) AS BultosJSON,
                o.Pagado,
                CASE WHEN orr.ReferenciaPagoOnline IS NOT NULL AND orr.ReferenciaPagoOnline <> '' THEN 1 ELSE 0 END AS PagoHandy,
                o.FechaUbicacion,
                -- Órdenes de depósito asociadas al retiro (para el checklist)
                (
                    SELECT STRING_AGG(od.OrdCodigoOrden, ',')
                    FROM OrdenesDeposito od WITH(NOLOCK)
                    WHERE od.OReIdOrdenRetiro = orr.OReIdOrdenRetiro
                ) AS OrdenesCodigos
            FROM ConfiguracionEstantes c
            LEFT JOIN OcupacionEstantes o 
                ON c.EstanteID = o.EstanteID AND c.Seccion = o.Seccion AND c.Posicion = o.Posicion
            LEFT JOIN OrdenesRetiro orr 
                ON o.OrdenRetiro = COALESCE(orr.FormaRetiro, 'R') + '-' + CAST(orr.OReIdOrdenRetiro AS VARCHAR)
            LEFT JOIN Clientes cli 
                ON CAST(cli.CodCliente AS VARCHAR) = CAST(orr.CodCliente AS VARCHAR) 
                OR CAST(cli.CodCliente AS VARCHAR) = CAST(o.CodigoCliente AS VARCHAR)
            LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = cli.TClIdTipoCliente
            WHERE c.Activo = 1
              AND (orr.OReEstadoActual IS NULL OR orr.OReEstadoActual NOT IN (5, 6))
            ORDER BY c.EstanteID, c.Seccion, c.Posicion
        `);
        
        // Traer TODAS las órdenes asignadas a estantes (independiente de ConfiguracionEstantes)
        // para que el frontend pueda excluirlas de empaques incluso si la posición no está configurada
        const allAssigned = await pool.request().query(`
            SELECT OrdenRetiro FROM OcupacionEstantes WITH(NOLOCK) WHERE OrdenRetiro IS NOT NULL
        `);
        const assignedList = allAssigned.recordset.map(r => r.OrdenRetiro);
        
        res.json({ 
            estantes: result.recordset, 
            allAssignedOrders: assignedList 
        });
    } catch (err) {
        logger.error('[obtenerMapaEstantes] Error:', err.message);
        res.status(500).json({ error: 'Error al obtener mapa estantes', details: err.message });
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
            // Check if this order is already assigned to any shelf position
            const dupCheck = await new sql.Request(transaction)
                .input('ord', sql.VarChar, ordenRetiro)
                .query('SELECT COUNT(*) AS cnt FROM OcupacionEstantes WHERE OrdenRetiro = @ord');
            if (dupCheck.recordset[0].cnt > 0) {
                await transaction.rollback();
                return res.status(400).json({ error: `La orden ${ordenRetiro} ya está asignada a un estante.` });
            }

            // Verificar el estado real de pago en la BDD (más confiable que el campo del frontend)
            const numMatchPag = ordenRetiro.match(/(\d+)$/);
            const OReIdPag = numMatchPag ? parseInt(numMatchPag[1], 10) : NaN;
            let pagadoReal = pagado; // fallback al valor del frontend
            if (!isNaN(OReIdPag)) {
                const pagRes = await new sql.Request(transaction)
                    .input('ID', sql.Int, OReIdPag)
                    .query(`SELECT TOP 1 PagIdPago, ReferenciaPagoOnline, OReEstadoActual FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID`);
                if (pagRes.recordset.length > 0) {
                    const row = pagRes.recordset[0];
                    pagadoReal = !!(row.PagIdPago || (row.ReferenciaPagoOnline && row.ReferenciaPagoOnline.trim() !== '') || row.OReEstadoActual === 3 || row.OReEstadoActual === 8);
                }
            }

            await new sql.Request(transaction)
                .input('e', sql.Char, estanteId)
                .input('s', sql.Int, seccion)
                .input('p', sql.Int, posicion)
                .input('o', sql.VarChar, ordenRetiro)
                .input('c', sql.VarChar, codigoCliente)
                .input('b', sql.NVarChar, JSON.stringify(bultos))
                .input('pag', sql.Bit, pagadoReal ? 1 : 0)
                .query(`
                    INSERT INTO OcupacionEstantes (EstanteID, Seccion, Posicion, OrdenRetiro, CodigoCliente, BultosJSON, Pagado)
                    VALUES (@e, @s, @p, @o, @c, @b, @pag)
                `);

            const nuevoEstado = pagadoReal ? 8 : 7;
            const ubicacionString = `${estanteId}-${seccion}-${posicion}`;

            // Extraer ID numérico del retiro: soporta R-, RL-, RT-, RW-, etc.
            // Ej: 'RL-60658' → 60658 | 'RT-60657' → 60657 | 'R-0001' → 1
            const numMatch = ordenRetiro.match(/(\d+)$/);
            const OReIdOrdenRetiro = numMatch ? parseInt(numMatch[1], 10) : NaN;
            const fechaPronto = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
            const UsuarioAlta = req.user?.id || 70;

            if (isNaN(OReIdOrdenRetiro)) {
                throw new Error(`No se pudo extraer el ID numérico del retiro: '${ordenRetiro}'`);
            }

            // Generar lista de códigos de órdenes escaneadas
            const bultosLimpios = (scannedValues || []).filter(val => val && val.trim() !== '');
            if (bultosLimpios.length > 0) {
                const scanReq = new sql.Request(transaction);
                scanReq.input('FecPronto', sql.DateTime, new Date(fechaPronto));
                scanReq.input('UsrAlta', sql.Int, UsuarioAlta);
                bultosLimpios.forEach((v, i) => {
                    scanReq.input(`sv${i}`, sql.VarChar, v.trim());
                });
                const inParams = bultosLimpios.map((_, i) => `@sv${i}`).join(',');

                await scanReq.query(`
                    INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                    SELECT OrdIdOrden, 7, @FecPronto, @UsrAlta
                    FROM OrdenesDeposito WHERE OrdCodigoOrden IN (${inParams});
                    
                    UPDATE OrdenesDeposito SET OrdEstadoActual = 7, OrdFechaEstadoActual = @FecPronto WHERE OrdCodigoOrden IN (${inParams});
                `);
            }

            // Actualizar estado de la orden de retiro
            const retRes = await new sql.Request(transaction)
                .input('ID', sql.Int, OReIdOrdenRetiro)
                .query('SELECT OReEstadoActual FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID');

            if (retRes.recordset.length > 0) {
                const nuevoEstado = retRes.recordset[0].OReEstadoActual === 1 ? 7 : 8;
                await new sql.Request(transaction)
                    .input('ID', sql.Int, OReIdOrdenRetiro)
                    .input('EstID', sql.Int, nuevoEstado)
                    .input('Fec', sql.DateTime, new Date(fechaPronto))
                    .input('Usr', sql.Int, UsuarioAlta)
                    .query(`
                        UPDATE OrdenesRetiro SET OReEstadoActual = CASE WHEN OReEstadoActual = 5 THEN 5 ELSE @EstID END, OReFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;
                        INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@ID, @EstID, @Fec, @Usr);
                    `);
            }

            logger.info(`[PRONTO] OK ${ordenRetiro}`);

            await transaction.commit();

            // EMITIR EVENTO SOCKET.IO
            const io = req.app.get('socketio');
            if (io) io.emit('retiros:update', { type: 'asignado_estante', ordenRetiro });

            res.json({ success: true, message: 'Ubicación asignada y notificada a central', pagadoReal });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

/**
 * DESASIGNAR RETIRO DE ESTANTE
 * Revierte al estado que tenía la orden ANTES del empaquetado (7/8), consultando el historial.
 * DELETE /web-retiros/estantes/desasignar
 * Body: { ordenRetiro: "RT-0018" }
 */
exports.desasignarRetiroDeEstante = async (req, res) => {
    const { ordenRetiro } = req.body;
    if (!ordenRetiro) return res.status(400).json({ error: 'Falta ordenRetiro' });

    try {
        const pool = await getPool();

        // 1. Extraer ID numérico
        const numMatch = (ordenRetiro || '').match(/(\d+)$/);
        const OReId = numMatch ? parseInt(numMatch[1], 10) : NaN;
        if (isNaN(OReId)) return res.status(400).json({ error: `ID inválido: ${ordenRetiro}` });

        // 2. Verificar que existe en el estante
        const check = await pool.request()
            .input('Ord', sql.VarChar(50), ordenRetiro)
            .query('SELECT TOP 1 EstanteID, Seccion, Posicion FROM OcupacionEstantes WHERE OrdenRetiro = @Ord');

        if (check.recordset.length === 0) {
            return res.status(404).json({ error: `La orden ${ordenRetiro} no está asignada a ningún estante` });
        }

        // 3. Leer estado actual + PagIdPago
        const estadoRes = await pool.request()
            .input('ID', sql.Int, OReId)
            .query(`
                SELECT TOP 1 OReEstadoActual, PagIdPago
                FROM OrdenesRetiro WITH(NOLOCK)
                WHERE OReIdOrdenRetiro = @ID
            `);

        const estadoActual = estadoRes.recordset[0]?.OReEstadoActual ?? 7;
        const tienePago    = !!estadoRes.recordset[0]?.PagIdPago;

        // 4. Recuperar el estado previo al empaquetado desde el historial
        //    (el último estado que NO sea 7 ni 8, antes de que se empaquetara)
        const histRes = await pool.request()
            .input('ID', sql.Int, OReId)
            .query(`
                SELECT TOP 1 EORIdEstadoOrden
                FROM HistoricoEstadosOrdenesRetiro WITH(NOLOCK)
                WHERE OReIdOrdenRetiro = @ID
                  AND EORIdEstadoOrden NOT IN (7, 8)
                ORDER BY HEOFechaEstado DESC
            `);

        // Estado previo real (1=Ingresado, 3=Abonado de antemano, 4=Abonado, etc.)
        const estadoPrevio = histRes.recordset[0]?.EORIdEstadoOrden ?? null;

        // Lógica de reversión:
        //  - Si hay historial previo al empaquetado → usar ese estado exacto
        //  - Si no hay historial pero tiene pago (PagIdPago) → estado 3 (Abonado)
        //  - Si no hay historial y sin pago → estado 1 (Ingresado)
        let estadoReversion;
        let descReversion;

        if (estadoPrevio !== null) {
            estadoReversion = estadoPrevio;
            // Describir el estado para el log/respuesta
            const descMap = { 1: 'Ingresado', 3: 'Abonado de antemano', 4: 'Abonado', 5: 'Listo para retirar' };
            descReversion = descMap[estadoReversion] ?? `Estado ${estadoReversion}`;
        } else {
            // Fallback sin historial
            estadoReversion = tienePago ? 3 : 1;
            descReversion   = tienePago ? 'Abonado (sin historial previo)' : 'Ingresado';
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 5. Eliminar de OcupacionEstantes
            await new sql.Request(transaction)
                .input('Ord', sql.VarChar(50), ordenRetiro)
                .query('DELETE FROM OcupacionEstantes WHERE OrdenRetiro = @Ord');

            // 6. Revertir estado + registrar en historial
            const fechaAhora = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
            const UsuarioAlta = req.user?.id || 70;
            await new sql.Request(transaction)
                .input('ID',    sql.Int,      OReId)
                .input('EstID', sql.Int,      estadoReversion)
                .input('Fec',   sql.DateTime, new Date(fechaAhora))
                .input('Usr',   sql.Int,      UsuarioAlta)
                .query(`
                    UPDATE OrdenesRetiro
                    SET OReEstadoActual = @EstID, OReFechaEstadoActual = @Fec
                    WHERE OReIdOrdenRetiro = @ID;
                    INSERT INTO HistoricoEstadosOrdenesRetiro
                        (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                    VALUES (@ID, @EstID, @Fec, @Usr);
                `);

            await transaction.commit();

            const io = req.app.get('socketio');
            if (io) io.emit('retiros:update', { type: 'desasignado', ordenRetiro });

            logger.info(`[DESASIGNAR] ${ordenRetiro} (antes: ${estadoActual}, previo historial: ${estadoPrevio ?? 'N/A'}, pago: ${tienePago}) → revertido a ${estadoReversion} (${descReversion})`);
            res.json({
                success: true,
                message: `${ordenRetiro} desasignado. Estado revertido a: ${descReversion}`,
                estadoReversion
            });

        } catch (innerErr) {
            try { await transaction.rollback(); } catch (_) {}
            throw innerErr;
        }

    } catch (err) {
        logger.error('[DESASIGNAR] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * MOVER RETIRO ENTRE CASILLAS (Drag & Drop)
 * POST /web-retiros/estantes/mover
 * Body: { ordenRetiro, destEstanteId, destSeccion, destPosicion }
 */
exports.moverRetiroEntreEstantes = async (req, res) => {
    const { ordenRetiro, destEstanteId, destSeccion, destPosicion } = req.body;
    if (!ordenRetiro || !destEstanteId || destSeccion == null || destPosicion == null) {
        return res.status(400).json({ error: 'Faltan parámetros: ordenRetiro, destEstanteId, destSeccion, destPosicion' });
    }

    try {
        const pool = await getPool();
        const destUbicacionId = `${destEstanteId}-${destSeccion}-${destPosicion}`;

        // Validar que la casilla destino no tenga órdenes de otro cliente
        const ordEnDest = await pool.request()
            .input('estId', sql.Char, destEstanteId)
            .input('sec',   sql.Int,  parseInt(destSeccion))
            .input('pos',   sql.Int,  parseInt(destPosicion))
            .query('SELECT TOP 1 CodigoCliente FROM OcupacionEstantes WHERE EstanteID = @estId AND Seccion = @sec AND Posicion = @pos');

        if (ordEnDest.recordset.length > 0) {
            // Obtener cliente de la orden a mover
            const ordSrc = await pool.request()
                .input('Ord', sql.VarChar(50), ordenRetiro)
                .query('SELECT TOP 1 CodigoCliente FROM OcupacionEstantes WHERE OrdenRetiro = @Ord');
            const clienteSrc = (ordSrc.recordset[0]?.CodigoCliente || '').trim().toLowerCase();
            const clienteDest = (ordEnDest.recordset[0]?.CodigoCliente || '').trim().toLowerCase();
            if (clienteSrc && clienteDest && clienteSrc !== clienteDest) {
                return res.status(409).json({ error: 'No se puede mover: la casilla destino tiene órdenes de otro cliente.' });
            }
        }

        // Mover: actualizar EstanteID, Seccion, Posicion en OcupacionEstantes
        await pool.request()
            .input('Ord',      sql.VarChar(50), ordenRetiro)
            .input('DestEst',  sql.Char,        destEstanteId)
            .input('DestSec',  sql.Int,          parseInt(destSeccion))
            .input('DestPos',  sql.Int,          parseInt(destPosicion))
            .query(`
                UPDATE OcupacionEstantes SET
                    EstanteID = @DestEst,
                    Seccion   = @DestSec,
                    Posicion  = @DestPos
                WHERE OrdenRetiro = @Ord
            `);

        const io = req.app.get('socketio');
        if (io) io.emit('retiros:update', { type: 'estado', ordenRetiro });

        logger.info(`[MOVER] ${ordenRetiro} → ${destUbicacionId}`);
        res.json({ success: true, message: `${ordenRetiro} movido a ${destUbicacionId}` });

    } catch (err) {
        logger.error('[MOVER] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * ENTREGAR AL CLIENTE
 */
exports.marcarRetiroEntregado = async (req, res) => {
    const { ubicacionId } = req.params;

    try {
        const pool = await getPool();

        // Parsear ubicacionId "A-1-2" → estanteId=A, seccion=1, posicion=2
        const parts = ubicacionId.split('-');
        const estId = parts[0];
        const sec = parseInt(parts[1], 10);
        const pos = parseInt(parts[2], 10);

        // Buscar a qué retiro pertenece antes de borrar
        const ubiRes = await pool.request()
            .input('estId', sql.Char, estId)
            .input('sec', sql.Int, sec)
            .input('pos', sql.Int, pos)
            .query('SELECT OrdenRetiro FROM OcupacionEstantes WHERE EstanteID = @estId AND Seccion = @sec AND Posicion = @pos');

        if (ubiRes.recordset.length === 0) {
            return res.status(404).json({ error: "Ubicación no encontrada" });
        }

        const ordenesDeRetiro = ubiRes.recordset.map(row => row.OrdenRetiro);

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Liberar el Estante Físico (todas las filas de esa posición)
            await new sql.Request(transaction)
                .input('estId', sql.Char, estId)
                .input('sec', sql.Int, sec)
                .input('pos', sql.Int, pos)
                .query('DELETE FROM OcupacionEstantes WHERE EstanteID = @estId AND Seccion = @sec AND Posicion = @pos');

            // 2. OrdenesRetiro se actualiza en el paso 3 abajo (Estado=5)

            // 3. Marcar entregadas en DB directamente
            const fechaEntrega = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
            const UsuarioAlta = req.user?.id || 70;

            for (const ord of ordenesDeRetiro) {
                const OReId = parseInt(String(ord).replace(/^[A-Za-z]+-0*/, ''), 10);
                if (isNaN(OReId)) continue;
                logger.info(`[ENTREGADO MULTIPLE] ${ord} -> ${OReId}`);
                await marcarEntregado(transaction, OReId, new Date(fechaEntrega), UsuarioAlta);
            }

            await transaction.commit();

            // EMITIR EVENTO SOCKET.IO
            const io = req.app.get('socketio');
            if (io) io.emit('retiros:update', { type: 'entregado', ordenesRetiro: (ordenesDeRetiro || ordenesParaEntregar || []) });

            res.json({ success: true, message: 'Orden entregada. Estante liberado exitosamente.' });

        } catch (innerErr) {
            try { await transaction.rollback(); } catch (e) { /* already rolled back */ }
            throw innerErr;
        }

    } catch (err) {
        logger.error("Error al entregar:", err);
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
            const fechaEntrega = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
            const UsuarioAlta = req.user?.id || 70;

            // 1. Marcar entregadas en DB
            // Se ordenan los IDs numéricamente de menor a mayor ANTES de actualizar.
            // Esto es CRÍTICO para evitar Deadlocks (Error 1205) en SQL Server,
            // ya que garantiza que las transacciones bloqueen los recursos siempre en el mismo orden.
            const ordenesOrdenadas = ordenesParaEntregar
                .map(ord => ({ ord, id: parseInt((ord || '').replace(/^[A-Za-z]+-0*/, ''), 10) }))
                .filter(x => !isNaN(x.id))
                .sort((a, b) => a.id - b.id);

            for (const item of ordenesOrdenadas) {
                logger.info(`[ENTREGADO MULTIPLE] ${item.ord} -> OReId ${item.id}`);
                // marcarEntregado actualiza el historial, estados y ya elimina de OcupacionEstantes
                await marcarEntregado(transaction, item.id, new Date(fechaEntrega), UsuarioAlta);
            }

            await transaction.commit();

            // EMITIR EVENTO SOCKET.IO
            const io = req.app.get('socketio');
            if (io) io.emit('retiros:update', { type: 'entregado', ordenesRetiro: ordenesParaEntregar });

            res.json({ success: true, message: 'Órdenes seleccionadas entregadas exitosamente.' });

        } catch (innerErr) {
            try { await transaction.rollback(); } catch (e) { /* already rolled back */ }
            throw innerErr;
        }

    } catch (err) {
        logger.error("Error al entregar selección múltiple:", err);
        res.status(500).json({ error: "Fallo en la entrega múltiple", details: err.message });
    }
};


/**
 * Cuadre diario: retiros entregados con situación de pago
 * Estados entregado: 7 = Entregado sin pago / 8 = Entregado con pago
 */
exports.getCuadreDiario = async (req, res) => {
    try {
        const pool = await getPool();
        const { startDate, endDate, clientFilter, estado } = req.query;
        const request = pool.request();

        // Fecha default: hoy si no se especifica
        const hoy = new Date().toISOString().split('T')[0];
        const desde = startDate || hoy;
        const hasta = endDate || hoy;

        request.input('Desde', sql.Date, desde);
        request.input('Hasta', sql.Date, hasta);

        let whereExtra = '';
        if (clientFilter) {
            whereExtra += ` AND (c.Nombre LIKE '%' + @ClientFilter + '%' OR CAST(c.IDCliente AS VARCHAR) LIKE '%' + @ClientFilter + '%')`;
            request.input('ClientFilter', sql.NVarChar, clientFilter);
        }
        // Filtro por situación de pago
        let estadoFilter = '';
        if (estado === 'pagado')     estadoFilter = `AND p.PagIdPago IS NOT NULL`;
        if (estado === 'deuda')      estadoFilter = `AND p.PagIdPago IS NULL AND rcd.Id IS NOT NULL`;
        if (estado === 'sin_pago')   estadoFilter = `AND p.PagIdPago IS NULL AND rcd.Id IS NULL`;

        const queryStr = `
            SELECT
                ISNULL(orr.FormaRetiro, 'R') + '-' + CAST(orr.OReIdOrdenRetiro AS VARCHAR) AS OrdenRetiro,
                orr.OReIdOrdenRetiro,
                orr.OReEstadoActual AS EstadoRetiro,
                CASE orr.OReEstadoActual
                    WHEN 7 THEN 'Entregado'
                    WHEN 8 THEN 'Entregado (con pago)'
                    ELSE 'Entregado'
                END AS DescEstado,
                orr.OReFechaEstadoActual AS FechaEntrega,
                -- Cliente
                c.Nombre AS NombreCliente,
                c.IDCliente AS CodigoCliente,
                tc.TClDescripcion AS TipoCliente,
                -- Pago
                p.PagIdPago,
                p.PagFechaPago AS FechaPago,
                p.PagMontoPago AS MontoPago,
                mon.MonSimbolo AS MonedaPago,
                mp.MPaDescripcionMetodo AS MetodoPago,
                -- Deuda autorizada
                rcd.Id AS DeudaId,
                rcd.Monto AS MontoDeuda,
                rcd.Explicacion AS DeudaExplicacion,
                rcd.Estado AS DeudaEstado,
                -- Cantidad y detalle de órdenes
                (SELECT COUNT(*) FROM OrdenesDeposito od WITH(NOLOCK) WHERE od.OReIdOrdenRetiro = orr.OReIdOrdenRetiro) AS CantOrdenes,
                (
                    SELECT od.OrdCodigoOrden AS codigo,
                           art.Descripcion AS producto,
                           CAST(od.OrdCantidad AS DECIMAL(10,2)) AS cantidad,
                           CAST(od.OrdCostoFinal AS FLOAT) AS monto,
                           monOd.MonSimbolo AS moneda,
                           mo.MOrNombreModo AS modo
                    FROM OrdenesDeposito od WITH(NOLOCK)
                    LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = od.ProIdProducto
                    LEFT JOIN Monedas monOd WITH(NOLOCK) ON monOd.MonIdMoneda = od.MonIdMoneda
                    LEFT JOIN ModosOrdenes mo WITH(NOLOCK) ON mo.MOrIdModoOrden = od.MOrIdModoOrden
                    WHERE od.OReIdOrdenRetiro = orr.OReIdOrdenRetiro
                    FOR JSON PATH
                ) AS OrdenesJSON
            FROM OrdenesRetiro orr WITH(NOLOCK)
            -- Cliente vía OrdenesDeposito
            OUTER APPLY (
                SELECT TOP 1 od.CliIdCliente
                FROM OrdenesDeposito od WITH(NOLOCK)
                WHERE od.OReIdOrdenRetiro = orr.OReIdOrdenRetiro
                ORDER BY od.OrdIdOrden
            ) od_c
            LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = od_c.CliIdCliente
            LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            -- Pago
            LEFT JOIN Pagos p WITH(NOLOCK) ON p.PagIdPago = orr.PagIdPago
            LEFT JOIN Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = p.PagIdMonedaPago
            LEFT JOIN MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
            -- Deuda autorizada: extrae el número del OrdenRetiro almacenado (puede ser "R-478", "RW-478" o "478")
            LEFT JOIN RetirosConDeuda rcd WITH(NOLOCK)
                ON TRY_CAST(
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        ISNULL(rcd.OrdenRetiro, ''),
                    'RW-',''),'RT-',''),'RL-',''),'PW-',''),'R-','')
                AS INT) = orr.OReIdOrdenRetiro
            WHERE orr.OReEstadoActual IN (7, 8)
              AND CAST(orr.OReFechaEstadoActual AS DATE) >= @Desde
              AND CAST(orr.OReFechaEstadoActual AS DATE) <= @Hasta
              ${whereExtra}
              ${estadoFilter}
            ORDER BY orr.OReFechaEstadoActual DESC
        `;

        const result = await request.query(queryStr);
        const data = result.recordset.map(row => ({
            ...row,
            Ordenes: row.OrdenesJSON ? JSON.parse(row.OrdenesJSON) : [],
            SituacionPago: row.PagIdPago ? 'pagado'
                         : row.DeudaId   ? 'deuda'
                         :                 'sin_pago'
        }));
        res.json(data);
    } catch (err) {
        console.error('[CUADRE DIARIO] Error:', err);
        res.status(500).json({ error: 'Fallo al obtener cuadre diario', details: err.message });
    }
};

/**
 * Historial completo de pagos (todos los métodos)
 */
exports.getHistorialPagos = async (req, res) => {
    try {
        const pool = await getPool();
        const { startDate, endDate, clientFilter, orderFilter, metodoPago, offset } = req.query;
        const offsetVal = parseInt(offset) || 0;
        const request = pool.request();

        let queryStr = `
            SELECT
                p.PagIdPago AS Id,
                p.PagFechaPago AS Fecha,
                p.PagMontoPago AS Monto,
                mon.MonSimbolo AS Moneda,
                mp.MPaDescripcionMetodo AS MetodoPago,
                -- Orden de retiro vinculada
                COALESCE(orr.FormaRetiro, 'R') + '-' + CAST(orr.OReIdOrdenRetiro AS VARCHAR) AS OrdenRetiro,
                -- Cliente
                c.Nombre AS NombreCliente,
                c.IDCliente AS CodigoCliente,
                tc.TClDescripcion AS TipoCliente,
                -- Órdenes que componen el retiro (JSON)
                -- Busca por PagIdPago directo (pagos manuales) O por retiro cuando PagIdPago no está seteado (Handy)
                (
                    SELECT od.OrdCodigoOrden AS codigo,
                           art.Descripcion AS producto,
                           CAST(od.OrdCantidad AS DECIMAL(10,2)) AS cantidad,
                           CAST(od.OrdCostoFinal AS FLOAT) AS monto,
                           monOd.MonSimbolo AS moneda,
                           mo.MOrNombreModo AS modo
                    FROM OrdenesDeposito od WITH(NOLOCK)
                    LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = od.ProIdProducto
                    LEFT JOIN Monedas monOd WITH(NOLOCK) ON monOd.MonIdMoneda = od.MonIdMoneda
                    LEFT JOIN ModosOrdenes mo WITH(NOLOCK) ON mo.MOrIdModoOrden = od.MOrIdModoOrden
                    WHERE od.PagIdPago = p.PagIdPago
                       OR (orr.OReIdOrdenRetiro IS NOT NULL
                           AND od.OReIdOrdenRetiro = orr.OReIdOrdenRetiro
                           AND od.PagIdPago IS NULL)
                    FOR JSON PATH
                ) AS OrdenesJSON,
                -- Cantidad de órdenes (misma lógica dual)
                (SELECT COUNT(*) FROM OrdenesDeposito od WITH(NOLOCK)
                 WHERE od.PagIdPago = p.PagIdPago
                    OR (orr.OReIdOrdenRetiro IS NOT NULL
                        AND od.OReIdOrdenRetiro = orr.OReIdOrdenRetiro
                        AND od.PagIdPago IS NULL)
                ) AS CantOrdenes,
                p.PagRutaComprobante AS Comprobante
            FROM Pagos p WITH(NOLOCK)
            LEFT JOIN Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = p.PagIdMonedaPago
            LEFT JOIN MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
            LEFT JOIN OrdenesRetiro orr WITH(NOLOCK) ON orr.PagIdPago = p.PagIdPago
            OUTER APPLY (
                -- Ruta 1: cliente vía OrdenesDeposito.PagIdPago (pagos manuales)
                SELECT TOP 1 od.CliIdCliente
                FROM OrdenesDeposito od WITH(NOLOCK)
                WHERE od.PagIdPago = p.PagIdPago
                ORDER BY od.OrdIdOrden
            ) od_c1
            OUTER APPLY (
                -- Ruta 2: cliente vía OrdenRetiro→OrdenesDeposito.OReIdOrdenRetiro (pagos Handy)
                SELECT TOP 1 od2.CliIdCliente
                FROM OrdenesDeposito od2 WITH(NOLOCK)
                WHERE od2.OReIdOrdenRetiro = orr.OReIdOrdenRetiro
                ORDER BY od2.OrdIdOrden
            ) od_c2
            LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = COALESCE(od_c1.CliIdCliente, od_c2.CliIdCliente)
            LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            WHERE 1=1
        `;

        if (startDate) {
            queryStr += ` AND CAST(p.PagFechaPago AS DATE) >= @StartDate`;
            request.input('StartDate', sql.Date, startDate);
        }
        if (endDate) {
            queryStr += ` AND CAST(p.PagFechaPago AS DATE) <= @EndDate`;
            request.input('EndDate', sql.Date, endDate);
        }
        if (clientFilter) {
            queryStr += ` AND (c.Nombre LIKE '%' + @ClientFilter + '%' OR CAST(c.IDCliente AS VARCHAR) LIKE '%' + @ClientFilter + '%')`;
            request.input('ClientFilter', sql.NVarChar, clientFilter);
        }
        if (orderFilter) {
            queryStr += ` AND (COALESCE(orr.FormaRetiro, 'R') + '-' + CAST(orr.OReIdOrdenRetiro AS VARCHAR) LIKE '%' + @OrderFilter + '%')`;
            request.input('OrderFilter', sql.NVarChar, orderFilter);
        }
        if (metodoPago) {
            queryStr += ` AND mp.MPaIdMetodoPago = @MetodoPago`;
            request.input('MetodoPago', sql.Int, parseInt(metodoPago));
        }

        request.input('Offset', sql.Int, offsetVal);
        queryStr += ` ORDER BY p.PagFechaPago DESC OFFSET @Offset ROWS FETCH NEXT 50 ROWS ONLY`;
        const result = await request.query(queryStr);

        const data = result.recordset.map(row => ({
            ...row,
            Ordenes: row.OrdenesJSON ? JSON.parse(row.OrdenesJSON) : []
        }));
        res.json(data);
    } catch (err) {
        console.error('[HISTORIAL PAGOS] Error:', err);
        res.status(500).json({ error: 'Fallo al obtener historial de pagos', details: err.message });
    }
};

/**
 * Pagos Online fallidos / no exitosos (Handy)
 */
exports.getPagosOnlineFallidos = async (req, res) => {
    try {
        const pool = await getPool();
        const { startDate, endDate, clientFilter, offset } = req.query;
        const offsetVal = parseInt(offset) || 0;
        const request = pool.request();

        let queryStr = `
            SELECT
                h.Id, h.TransactionId, h.PaymentUrl,
                h.TotalAmount, h.Currency,
                h.OrdersJson, h.CodCliente,
                h.Status, h.IssuerName,
                h.PaidAt, h.WebhookReceivedAt, h.CreatedAt,
                c.Nombre AS NombreCliente,
                -- Orden de retiro con prefijo real de la BD (no hardcodeado)
                CASE
                    WHEN orr_h.OReIdOrdenRetiro IS NOT NULL
                    THEN ISNULL(orr_h.FormaRetiro, 'R') + '-' + CAST(orr_h.OReIdOrdenRetiro AS VARCHAR)
                    ELSE NULL
                END AS OrdenRetiroFormatted
            FROM HandyTransactions h
            LEFT JOIN Clientes c ON CAST(h.CodCliente AS VARCHAR) = CAST(c.CodCliente AS VARCHAR)
            OUTER APPLY (
                -- Extrae el numero del ordenRetiro del JSON y busca el FormaRetiro real
                SELECT TOP 1 orr2.OReIdOrdenRetiro, orr2.FormaRetiro
                FROM OrdenesRetiro orr2 WITH(NOLOCK)
                WHERE orr2.OReIdOrdenRetiro = TRY_CAST(
                    REPLACE(REPLACE(REPLACE(
                        ISNULL(JSON_VALUE(h.OrdersJson, '$.ordenRetiro'), ''),
                    'RW-',''),'R-',''),'PW-','')
                AS INT)
            ) orr_h
            WHERE LOWER(ISNULL(h.Status, '')) NOT IN ('paid', 'pagado', 'success', 'approved')
        `;

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

        request.input('Offset', sql.Int, offsetVal);
        queryStr += ` ORDER BY h.CreatedAt DESC OFFSET @Offset ROWS FETCH NEXT 50 ROWS ONLY`;
        const result = await request.query(queryStr);
        res.json(result.recordset);
    } catch (err) {
        console.error('[PAGOS FALLIDOS] Error:', err);
        res.status(500).json({ error: 'Fallo al obtener pagos fallidos', details: err.message });
    }
};

/**
 * Traer Transacciones de Handy
 */
exports.getPagosOnline = async (req, res) => {
    try {
        const pool = await getPool();
        const { startDate, endDate, clientFilter, orderFilter, offset } = req.query;
        const offsetVal = parseInt(offset) || 0;

        let queryStr = `
            SELECT 
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
                c.Nombre as NombreCliente,
                -- Orden de retiro con prefijo real de la BD (no hardcodeado)
                CASE
                    WHEN orr_h.OReIdOrdenRetiro IS NOT NULL
                    THEN ISNULL(orr_h.FormaRetiro, 'R') + '-' + CAST(orr_h.OReIdOrdenRetiro AS VARCHAR)
                    ELSE NULL
                END AS OrdenRetiroFormatted
            FROM HandyTransactions h
            LEFT JOIN Clientes c ON CAST(h.CodCliente AS VARCHAR) = CAST(c.CodCliente AS VARCHAR)
            OUTER APPLY (
                -- Extrae el numero del ordenRetiro del JSON y busca el FormaRetiro real
                SELECT TOP 1 orr2.OReIdOrdenRetiro, orr2.FormaRetiro
                FROM OrdenesRetiro orr2 WITH(NOLOCK)
                WHERE orr2.OReIdOrdenRetiro = TRY_CAST(
                    REPLACE(REPLACE(REPLACE(
                        ISNULL(JSON_VALUE(h.OrdersJson, '$.ordenRetiro'), ''),
                    'RW-',''),'R-',''),'PW-','')
                AS INT)
            ) orr_h
            WHERE LOWER(ISNULL(h.Status, '')) IN ('paid', 'pagado', 'success', 'approved')
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

        request.input('Offset', sql.Int, offsetVal);
        queryStr += ` ORDER BY h.CreatedAt DESC OFFSET @Offset ROWS FETCH NEXT 50 ROWS ONLY`;

        const result = await request.query(queryStr);
        res.json(result.recordset);
    } catch (err) {
        logger.error("[PAGOS ONLINE] Error fetching Handy Transactions:", err);
        res.status(500).json({ error: "Fallo al traer pagos online", details: err.message });
    }
};


/**
 * Traer Transacciones de MercadoPago (todas)
 */
exports.getPagosMp = async (req, res) => {
    try {
        const pool = await getPool();
        const { startDate, endDate, clientFilter, orderFilter, offset } = req.query;
        const offsetVal = parseInt(offset) || 0;

        let queryStr = `
            SELECT
                m.Id,
                m.TransactionId,
                m.PreferenceId,
                m.PaymentUrl,
                TRY_CAST(JSON_VALUE(m.OrdersJson, '$.totalCost') AS DECIMAL(18,2)) AS TotalAmount,
                ISNULL(JSON_VALUE(m.OrdersJson, '$.moneda'), 'UYU')               AS Currency,
                m.OrdersJson,
                m.CodCliente,
                m.Status,
                m.PaymentId,
                m.PaidAt,
                m.WebhookReceivedAt,
                m.CreatedAt,
                c.Nombre AS NombreCliente,
                -- Orden de retiro con prefijo real de la BD (no hardcodeado)
                CASE
                    WHEN orr_m.OReIdOrdenRetiro IS NOT NULL
                    THEN ISNULL(orr_m.FormaRetiro, 'R') + '-' + CAST(orr_m.OReIdOrdenRetiro AS VARCHAR)
                    ELSE NULL
                END AS OrdenRetiroFormatted
            FROM MercadoPagoTransactions m
            LEFT JOIN Clientes c ON CAST(m.CodCliente AS VARCHAR) = CAST(c.CodCliente AS VARCHAR)
            OUTER APPLY (
                SELECT TOP 1 orr2.OReIdOrdenRetiro, orr2.FormaRetiro
                FROM OrdenesRetiro orr2 WITH(NOLOCK)
                WHERE orr2.OReIdOrdenRetiro = TRY_CAST(
                    REPLACE(REPLACE(REPLACE(
                        ISNULL(JSON_VALUE(m.OrdersJson, '$.ordenRetiro'), ''),
                    'RW-',''),'R-',''),'PW-','')
                AS INT)
            ) orr_m
            WHERE LOWER(ISNULL(m.Status, '')) = 'approved'
        `;

        const request = pool.request();

        if (startDate) {
            queryStr += ` AND CAST(m.CreatedAt AS DATE) >= @StartDate`;
            request.input('StartDate', sql.Date, startDate);
        }
        if (endDate) {
            queryStr += ` AND CAST(m.CreatedAt AS DATE) <= @EndDate`;
            request.input('EndDate', sql.Date, endDate);
        }
        if (clientFilter) {
            queryStr += ` AND (c.Nombre LIKE '%' + @ClientFilter + '%' OR CAST(m.CodCliente AS VARCHAR) LIKE '%' + @ClientFilter + '%')`;
            request.input('ClientFilter', sql.NVarChar, clientFilter);
        }
        if (orderFilter) {
            let cleanFilter = orderFilter.trim();
            let numFilter = cleanFilter.toUpperCase().replace(/^[A-Z]+-/, '');
            queryStr += ` AND (m.OrdersJson LIKE '%' + @OrderFilter + '%' OR m.OrdersJson LIKE '%' + @NumFilter + '%' OR m.TransactionId LIKE '%' + @OrderFilter + '%')`;
            request.input('OrderFilter', sql.NVarChar, cleanFilter);
            request.input('NumFilter', sql.NVarChar, numFilter);
        }

        request.input('Offset', sql.Int, offsetVal);
        queryStr += ` ORDER BY m.CreatedAt DESC OFFSET @Offset ROWS FETCH NEXT 50 ROWS ONLY`;

        const result = await request.query(queryStr);
        res.json(result.recordset);
    } catch (err) {
        logger.error("[PAGOS MP] Error fetching MercadoPago Transactions:", err);
        res.status(500).json({ error: "Fallo al traer pagos de MercadoPago", details: err.message });
    }
};

/**
 * Traer Transacciones FALLIDAS de MercadoPago
 */
exports.getPagosMpFallidos = async (req, res) => {
    try {
        const pool = await getPool();
        const { startDate, endDate, clientFilter, offset } = req.query;
        const offsetVal = parseInt(offset) || 0;
        const request = pool.request();

        let queryStr = `
            SELECT
                m.Id,
                m.TransactionId,
                m.PreferenceId,
                m.PaymentUrl,
                TRY_CAST(JSON_VALUE(m.OrdersJson, '$.totalCost') AS DECIMAL(18,2)) AS TotalAmount,
                ISNULL(JSON_VALUE(m.OrdersJson, '$.moneda'), 'UYU')               AS Currency,
                m.OrdersJson,
                m.CodCliente,
                m.Status,
                m.PaymentId,
                m.PaidAt,
                m.WebhookReceivedAt,
                m.CreatedAt,
                c.Nombre AS NombreCliente,
                CASE
                    WHEN orr_m.OReIdOrdenRetiro IS NOT NULL
                    THEN ISNULL(orr_m.FormaRetiro, 'R') + '-' + CAST(orr_m.OReIdOrdenRetiro AS VARCHAR)
                    ELSE NULL
                END AS OrdenRetiroFormatted
            FROM MercadoPagoTransactions m
            LEFT JOIN Clientes c ON CAST(m.CodCliente AS VARCHAR) = CAST(c.CodCliente AS VARCHAR)
            OUTER APPLY (
                SELECT TOP 1 orr2.OReIdOrdenRetiro, orr2.FormaRetiro
                FROM OrdenesRetiro orr2 WITH(NOLOCK)
                WHERE orr2.OReIdOrdenRetiro = TRY_CAST(
                    REPLACE(REPLACE(REPLACE(
                        ISNULL(JSON_VALUE(m.OrdersJson, '$.ordenRetiro'), ''),
                    'RW-',''),'R-',''),'PW-','')
                AS INT)
            ) orr_m
            WHERE LOWER(ISNULL(m.Status, '')) NOT IN ('approved')
        `;

        if (startDate) {
            queryStr += ` AND CAST(m.CreatedAt AS DATE) >= @StartDate`;
            request.input('StartDate', sql.Date, startDate);
        }
        if (endDate) {
            queryStr += ` AND CAST(m.CreatedAt AS DATE) <= @EndDate`;
            request.input('EndDate', sql.Date, endDate);
        }
        if (clientFilter) {
            queryStr += ` AND (c.Nombre LIKE '%' + @ClientFilter + '%' OR CAST(m.CodCliente AS VARCHAR) LIKE '%' + @ClientFilter + '%')`;
            request.input('ClientFilter', sql.NVarChar, clientFilter);
        }

        request.input('Offset', sql.Int, offsetVal);
        queryStr += ` ORDER BY m.CreatedAt DESC OFFSET @Offset ROWS FETCH NEXT 50 ROWS ONLY`;
        const result = await request.query(queryStr);
        res.json(result.recordset);
    } catch (err) {
        logger.error('[PAGOS MP FALLIDOS] Error:', err);
        res.status(500).json({ error: 'Fallo al obtener pagos MP fallidos', details: err.message });
    }
};


/**
 * Guardar retiro excepcional (con deuda) en la tabla local
 */
exports.marcarExcepcional = async (req, res) => {
    try {
        const { ordenRetiro, codigoCliente, monto, password, explicacion } = req.body;
        const usuarioId = req.user?.id || 70;

        if (!password || password.trim() === '') {
            return res.status(401).json({ error: "Contraseña requerida para autorizar este retiro." });
        }

        if (!explicacion || explicacion.trim() === '') {
            return res.status(400).json({ error: "Debe ingresar una justificación/explicación obligatoria." });
        }

        if (password !== process.env.BYPASS) {
            return res.status(403).json({ error: "Contraseña incorrecta." });
        }

        const pool = await getPool();
        await pool.request()
            .input('orden', sql.VarChar, ordenRetiro)
            .input('cliente', sql.VarChar, codigoCliente)
            .input('monto', sql.Float, parseFloat(monto) || 0)
            .input('usr', sql.Int, usuarioId)
            .input('expl', sql.NVarChar, explicacion)
            .query(`INSERT INTO RetirosConDeuda (OrdenRetiro, CodigoCliente, Monto, UsuarioAutorizador, Explicacion, Estado, Gestionado)
                    VALUES (@orden, @cliente, @monto, @usr, @expl, 'Pendiente', 0)`);

        res.json({ message: "Retiro registrado como deuda y autorizado exitosamente." });
    } catch (err) {
        logger.error("[EXCEPCIONAL] Error al guardar retiro excepcional:", err);
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
            SELECT 
                e.Id, e.OrdenRetiro, e.CodigoCliente, 
                COALESCE(e.NombreCliente, c.Nombre) AS NombreCliente,
                e.Monto,
                orr.OReCostoTotalOrden AS MontoOrden,
                orr.MonIdMoneda AS Moneda,
                e.UsuarioAutorizador, e.Explicacion,
                e.Estado, e.Gestionado, e.Fecha, e.FechaGestion,
                e.UsuarioGestion, e.NotaGestion,
                u.Nombre AS NombreAutorizador,
                tc.TClDescripcion AS TipoCliente,
                -- Detalle de órdenes como JSON
                (
                    SELECT od.OrdCodigoOrden AS codigo,
                           art.Descripcion AS producto,
                           CAST(od.OrdCantidad AS DECIMAL(10,2)) AS cantidad,
                           CAST(od.OrdCostoFinal AS FLOAT) AS monto,
                           mon.MonSimbolo AS moneda,
                           mo.MOrNombreModo AS modo,
                           od.OrdEstadoActual AS estado,
                           eo.EOrNombreEstado AS estadoNombre
                    FROM RelOrdenesRetiroOrdenes rel WITH(NOLOCK)
                    JOIN OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = rel.OrdIdOrden
                    LEFT JOIN Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = od.MonIdMoneda
                    LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = od.ProIdProducto
                    LEFT JOIN ModosOrdenes mo WITH(NOLOCK) ON mo.MOrIdModoOrden = od.MOrIdModoOrden
                    LEFT JOIN EstadosOrdenes eo WITH(NOLOCK) ON eo.EOrIdEstadoOrden = od.OrdEstadoActual
                    WHERE rel.OReIdOrdenRetiro = orr.OReIdOrdenRetiro
                    FOR JSON PATH
                ) AS OrdenesJSON,
                -- Cantidad de órdenes
                (
                    SELECT COUNT(*)
                    FROM RelOrdenesRetiroOrdenes rel WITH(NOLOCK)
                    WHERE rel.OReIdOrdenRetiro = orr.OReIdOrdenRetiro
                ) AS CantOrdenes
            FROM RetirosConDeuda e
            LEFT JOIN Clientes c ON CAST(e.CodigoCliente AS VARCHAR) = CAST(c.IDCliente AS VARCHAR)
            LEFT JOIN Usuarios u ON u.IdUsuario = e.UsuarioAutorizador
            LEFT JOIN OrdenesRetiro orr ON COALESCE(orr.FormaRetiro, 'R') + '-' + CAST(orr.OReIdOrdenRetiro AS VARCHAR) = e.OrdenRetiro
            LEFT JOIN TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            ORDER BY e.Fecha DESC
        `);
        // Parsear OrdenesJSON de string a array
        const data = result.recordset.map(row => ({
            ...row,
            Ordenes: row.OrdenesJSON ? JSON.parse(row.OrdenesJSON) : []
        }));
        res.json(data);
    } catch (err) {
        logger.error("[EXCEPCIONES] Error al obtener excepciones de deuda:", err);
        res.status(500).json({ error: "Fallo al obtener retiros excepcionales", details: err.message });
    }
};

/**
 * Marcar una excepcion de deuda como gestionada/pagada
 */
exports.gestionarExcepcion = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, nota } = req.body;  // estado: 'Pendiente' | 'Cobrado' | 'Condonado'
        const usuarioId = req.user?.id || 70;

        if (!['Pendiente', 'Cobrado', 'Condonado'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido. Valores: Pendiente, Cobrado, Condonado' });
        }

        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .input('estado', sql.VarChar, estado)
            .input('gestionado', sql.Bit, estado !== 'Pendiente' ? 1 : 0)
            .input('nota', sql.NVarChar, nota || null)
            .input('usr', sql.Int, usuarioId)
            .query(`
                UPDATE RetirosConDeuda 
                SET Estado = @estado,
                    Gestionado = @gestionado,
                    NotaGestion = @nota,
                    UsuarioGestion = @usr,
                    FechaGestion = CASE WHEN @estado <> 'Pendiente' THEN GETDATE() ELSE NULL END
                WHERE Id = @id
            `);

        res.json({ success: true, message: 'Estado actualizado correctamente.' });
    } catch (err) {
        logger.error("[EXCEPCION GESTION] Error al actualizar estado:", err);
        res.status(500).json({ error: "Fallo al actualizar la excepción", details: err.message });
    }
};

/**
 * SEED: Recrear ConfiguracionEstantes
 * POST /web-retiros/estantes/config/seed
 * Body: { estantes: ['A','B','C'], secciones: 4, posiciones: 10 }
 */
exports.seedConfigEstantes = async (req, res) => {
    const {
        estantes = ['A', 'B', 'C', 'D'],
        secciones = 4,
        posiciones = 10
    } = req.body;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Borrar configuración existente (NO toca OcupacionEstantes)
            await new sql.Request(transaction).query('DELETE FROM ConfiguracionEstantes');

            // 2. Insertar nueva configuración
            let inserted = 0;
            for (const est of estantes) {
                for (let s = 1; s <= secciones; s++) {
                    for (let p = 1; p <= posiciones; p++) {
                        await new sql.Request(transaction)
                            .input('e', sql.Char(1), est)
                            .input('s', sql.Int, s)
                            .input('p', sql.Int, p)
                            .query(`
                                INSERT INTO ConfiguracionEstantes (EstanteID, Seccion, Posicion, Activo)
                                VALUES (@e, @s, @p, 1)
                            `);
                        inserted++;
                    }
                }
            }

            await transaction.commit();

            const io = req.app.get('socketio');
            if (io) io.emit('retiros:update', { type: 'entregado', ordenesRetiro: (ordenesDeRetiro || ordenesParaEntregar || []) });

            res.json({
                success: true,
                message: `Configuración cargada: ${estantes.length} estante(s) × ${secciones} secciones × ${posiciones} posiciones = ${inserted} casilleros.`,
                inserted
            });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        logger.error('[SEED ESTANTES] Error:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Historial completo de retiros de un cliente (todos los estados)
 */
exports.getMyRetirosHistorial = async (req, res) => {
    try {
        const codCliente = req.user?.codCliente || req.user?.id;
        if (!codCliente) return res.status(401).json({ error: "Usuario sin código de cliente" });

        const pool = await getPool();
        const query = `
            SELECT 
                COALESCE(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR) AS OrdIdRetiro,
                r.OReCostoTotalOrden AS Monto,
                r.MonIdMoneda AS Moneda,
                r.OReEstadoActual AS Estado,
                r.CodCliente,
                r.OReFechaAlta AS Fecha,
                r.FormaRetiro,
                COALESCE(fe.Nombre, 
                    CASE WHEN LEN(ISNULL(r.DireccionEnvio, '')) > 0 
                           OR r.AgenciaEnvio IS NOT NULL 
                           OR LEN(ISNULL(r.AgenciaOtra, '')) > 0 
                         THEN 'Envío / Encomienda' 
                         ELSE 'Retiro en el Local' 
                    END
                ) AS LugarRetiro,
                COALESCE(ag.Nombre, r.AgenciaOtra) AS AgenciaNombre,
                r.DireccionEnvio,
                r.LocalidadEnvio,
                r.DepartamentoEnvio,
                r.ReceptorNombre,
                o.OrdCodigoOrden,
                o.OrdNombreTrabajo,
                o.OrdCostoFinal,
                o.OrdCantidad,
                m.MonSimbolo,
                LTRIM(RTRIM(art.Descripcion)) AS Producto,
                (SELECT TOP 1 b.ComprobantePath FROM Logistica_Bultos b WITH(NOLOCK) WHERE b.OrdenID = r.OReIdOrdenRetiro AND b.ComprobantePath IS NOT NULL ORDER BY b.BultoID DESC) AS comprobanteEntrega
            FROM OrdenesRetiro r WITH(NOLOCK)
            LEFT JOIN FormasEnvio fe WITH(NOLOCK) ON fe.ID = r.LReIdLugarRetiro
            LEFT JOIN Agencias ag WITH(NOLOCK) ON ag.ID = r.AgenciaEnvio
            LEFT JOIN OrdenesDeposito o WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
            LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = o.MonIdMoneda
            LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = o.ProIdProducto
            WHERE r.CodCliente = @codCliente
            ORDER BY r.OReFechaAlta DESC
        `;
        const result = await pool.request()
            .input('codCliente', sql.Int, parseInt(codCliente, 10))
            .query(query);

        // Group by retiro
        const retirosMap = {};
        for (const row of result.recordset) {
            if (!retirosMap[row.OrdIdRetiro]) {
                retirosMap[row.OrdIdRetiro] = {
                    OrdIdRetiro: row.OrdIdRetiro,
                    Monto: row.Monto,
                    Moneda: row.Moneda,
                    Estado: row.Estado,
                    Fecha: row.Fecha,
                    FormaRetiro: row.FormaRetiro,
                    LugarRetiro: row.LugarRetiro,
                    AgenciaNombre: row.AgenciaNombre,
                    DireccionEnvio: row.DireccionEnvio,
                    LocalidadEnvio: row.LocalidadEnvio,
                    DepartamentoEnvio: row.DepartamentoEnvio,
                    ReceptorNombre: row.ReceptorNombre,
                    comprobanteEntrega: row.comprobanteEntrega,
                    Ordenes: []
                };
            }
            if (row.OrdCodigoOrden) {
                retirosMap[row.OrdIdRetiro].Ordenes.push({
                    codigo: row.OrdCodigoOrden,
                    nombre: row.OrdNombreTrabajo || row.OrdCodigoOrden,
                    costo: parseFloat(row.OrdCostoFinal) || 0,
                    moneda: row.MonSimbolo || '$',
                    producto: row.Producto || null,
                    cantidad: row.OrdCantidad || null
                });
            }
        }

        res.json(Object.values(retirosMap));
    } catch (err) {
        logger.error("Error get_my_retiros_historial:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * AUTORIZAR RETIRO SIN PAGO — Estado 9
 * POST /web-retiros/autorizar
 * Body: { ordenRetiro: "RT-0018", nota?: "..." }
 */
exports.autorizarRetiro = async (req, res) => {
    const { ordenRetiro, nota } = req.body;
    if (!ordenRetiro) return res.status(400).json({ error: 'Falta ordenRetiro' });
    if (!nota || !nota.trim()) return res.status(400).json({ error: 'La observación/nota es obligatoria para autorizar sin pago' });

    try {
        const pool = await getPool();
        const numMatch = (ordenRetiro || '').match(/(\d+)$/);
        const OReId = numMatch ? parseInt(numMatch[1], 10) : NaN;
        if (isNaN(OReId)) return res.status(400).json({ error: `ID inválido: ${ordenRetiro}` });

        // Traer datos del retiro para RetirosConDeuda
        const check = await pool.request()
            .input('ID', sql.Int, OReId)
            .query(`
                SELECT TOP 1
                    r.OReEstadoActual,
                    r.OReCostoTotalOrden,
                    r.CodCliente,
                    COALESCE(LTRIM(RTRIM(c.Nombre)), LTRIM(RTRIM(cr.Nombre))) AS NombreCli,
                    COALESCE(c.IDCliente, cr.IDCliente) AS CodigoCli
                FROM OrdenesRetiro r WITH(NOLOCK)
                LEFT JOIN OrdenesDeposito od WITH(NOLOCK) ON od.OReIdOrdenRetiro = r.OReIdOrdenRetiro
                LEFT JOIN Clientes c  WITH(NOLOCK) ON c.CliIdCliente = od.CliIdCliente
                LEFT JOIN Clientes cr WITH(NOLOCK) ON cr.CodCliente  = r.CodCliente
                WHERE r.OReIdOrdenRetiro = @ID
            `);

        if (check.recordset.length === 0) return res.status(404).json({ error: `Orden ${ordenRetiro} no encontrada` });

        const estadoActual = check.recordset[0].OReEstadoActual;
        if (estadoActual === 5) return res.status(409).json({ error: 'La orden ya fue entregada' });
        if (estadoActual === 9) return res.status(409).json({ error: 'La orden ya está autorizada (estado 9)' });

        const UsuarioAlta  = req.user?.id || 70;
        const fecha        = moment().tz('America/Montevideo').format('YYYY-MM-DD HH:mm:ss');
        const monto        = parseFloat(check.recordset[0].OReCostoTotalOrden) || 0;
        const codCliente   = check.recordset[0].CodigoCli || check.recordset[0].CodCliente || null;
        const nomCliente   = check.recordset[0].NombreCli || null;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Cambiar estado a 9 (Autorizado) + historial
            await new sql.Request(transaction)
                .input('ID',  sql.Int,      OReId)
                .input('Fec', sql.DateTime, new Date(fecha))
                .input('Usr', sql.Int,      UsuarioAlta)
                .query(`
                    UPDATE OrdenesRetiro
                    SET OReEstadoActual = 9, OReFechaEstadoActual = @Fec
                    WHERE OReIdOrdenRetiro = @ID;
                    INSERT INTO HistoricoEstadosOrdenesRetiro
                        (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                    VALUES (@ID, 9, @Fec, @Usr);
                `);

            // 2. Registrar en RetirosConDeuda (misma tabla del modal viejo)
            await new sql.Request(transaction)
                .input('orden',  sql.VarChar,        ordenRetiro)
                .input('cli',    sql.VarChar,        codCliente)
                .input('nomCli', sql.NVarChar(200),  nomCliente)
                .input('monto',  sql.Float,          monto)
                .input('usr',    sql.Int,            UsuarioAlta)
                .input('expl',   sql.NVarChar(500),  nota.trim())
                .query(`
                    INSERT INTO RetirosConDeuda
                        (OrdenRetiro, CodigoCliente, NombreCliente, Monto, UsuarioAutorizador, Explicacion, Estado, Gestionado)
                    VALUES (@orden, @cli, @nomCli, @monto, @usr, @expl, 'Pendiente', 0)
                `);

            await transaction.commit();
            const io = req.app.get('socketio');
            if (io) io.emit('retiros:update', { type: 'autorizado', ordenRetiro });
            logger.info(`[AUTORIZAR] ${ordenRetiro} → Estado 9. User: ${UsuarioAlta}. Nota: ${nota}`);
            res.json({ success: true, message: `${ordenRetiro} autorizado para entrega sin pago` });

        } catch (innerErr) {
            try { await transaction.rollback(); } catch (_) {}
            throw innerErr;
        }
    } catch (err) {
        logger.error('[AUTORIZAR] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * ANULAR ORDEN DE RETIRO
 * Reversiona estados, desvincula órdenes y libera estantes.
 * POST /api/web-retiros/anular/:id
 */
exports.anularRetiro = async (req, res) => {
    const { id } = req.params;
    const { motivo } = req.body;
    const usuarioId = req.user?.id || 70;

    if (!id) return res.status(400).json({ error: "Falta ID de retiro" });
    if (!motivo) return res.status(400).json({ error: "Debe proporcionar un motivo breve de anulación" });

    let transaction;
    try {
        const pool = await getPool();
        const OReId = parseInt(String(id).replace(/^[A-Za-z]+-0*/, ''), 10);
        if (isNaN(OReId)) return res.status(400).json({ error: "ID de retiro inválido" });

        // 1. Validaciones previas
        const checkRes = await pool.request()
            .input('ID', sql.Int, OReId)
            .query('SELECT OReEstadoActual, PagIdPago, FormaRetiro FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID');

        if (checkRes.recordset.length === 0) {
            return res.status(404).json({ error: "Orden de retiro no encontrada" });
        }

        const { OReEstadoActual, PagIdPago, FormaRetiro } = checkRes.recordset[0];

        if (OReEstadoActual === 5) {
            return res.status(400).json({ error: "No se puede anular esta orden (ya fue entregada), diríjase a sistemas" });
        }
        if (PagIdPago) {
            return res.status(400).json({ error: "No se puede anular esta orden (ya posee un pago registrado), diríjase a sistemas" });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        await transaction.request()
            .input('ID', sql.Int, OReId)
            .input('Usr', sql.Int, usuarioId)
            .query(`
                UPDATE OrdenesRetiro 
                SET OReEstadoActual = 6, 
                    OReFechaEstadoActual = GETDATE()
                WHERE OReIdOrdenRetiro = @ID;

                INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                VALUES (@ID, 6, GETDATE(), @Usr);
            `);

        // 3. Desvincular y Revertir Órdenes de Depósito (Estado 1)
        await transaction.request()
            .input('ID', sql.Int, OReId)
            .input('Usr', sql.Int, usuarioId)
            .query(`
                INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                SELECT OrdIdOrden, 1, GETDATE(), @Usr 
                FROM OrdenesDeposito 
                WHERE OReIdOrdenRetiro = @ID;

                UPDATE OrdenesDeposito 
                SET OReIdOrdenRetiro = NULL,
                    OrdEstadoActual = 1,
                    OrdFechaEstadoActual = GETDATE()
                WHERE OReIdOrdenRetiro = @ID;
            `);

        // 4. Liberar Estantes Físicos
        const codigoRetiro = (FormaRetiro || 'R') + '-' + OReId;
        await transaction.request()
            .input('Cod', sql.VarChar(50), codigoRetiro)
            .query('DELETE FROM OcupacionEstantes WHERE OrdenRetiro = @Cod');

        await transaction.commit();

        // Notificar por sockets
        const io = req.app.get('socketio');
        if (io) {
            io.emit('actualizado', { type: 'actualizacion' });
            io.emit('retiros:update', { type: 'anulado', id: codigoRetiro });
        }

        logger.info(`[ANULACION] Retiro ${codigoRetiro} anulado por usuario ${usuarioId}. Motivo: ${motivo}`);
        res.json({ success: true, message: "Orden de retiro anulada correctamente" });

    } catch (err) {
        logger.error("[ANULACION] Error al anular retiro:", err);
        if (transaction) {
            try { await transaction.rollback(); } catch (e) { /* ignore */ }
        }
        res.status(500).json({ error: "Error interno al procesar la anulación", details: err.message });
    }
};


