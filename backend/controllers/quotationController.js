const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// Separador del QR
const SEP = '$*';

/**
 * Reconstruye el QR_String a partir de los campos individuales
 */
function buildQrString(qr) {
    return [qr.QR_Pedido, qr.QR_Cliente, qr.QR_Trabajo, qr.QR_Urgencia, qr.QR_Producto, qr.QR_Cantidad, qr.QR_Importe].join(SEP);
}

/**
 * GET /api/quotation/list?q=XXXX
 * Lista PedidosCobranza para mostrar en la grilla de QuotationView.
 */
exports.listQuotations = async (req, res) => {
    const { q, areaId } = req.query;
    try {
        const pool = await getPool();
        let whereClause = 'WHERE 1=1';
        const request = pool.request();
        if (q) {
            request.input('q', sql.NVarChar, `%${q}%`);
            whereClause += ` AND (LTRIM(RTRIM(PC.NoDocERP)) LIKE @q OR PC.QR_Trabajo LIKE @q)`;
        }
        
        let joinClause = '';
        if (areaId && areaId.toUpperCase() !== 'TODOS') {
            request.input('areaId', sql.NVarChar, areaId);
            joinClause = `
                INNER JOIN (
                    SELECT DISTINCT PCD.PedidoCobranzaID 
                    FROM PedidosCobranzaDetalle PCD
                    LEFT JOIN Ordenes O ON PCD.OrdenID = O.OrdenID
                    WHERE ISNULL(LTRIM(RTRIM(O.AreaID)), '') = LTRIM(RTRIM(@areaId))
                ) FILTER ON FILTER.PedidoCobranzaID = PC.ID
            `;
        }

        const result = await request.query(`
            SELECT TOP 100 PC.ID, PC.NoDocERP, PC.ClienteID, PC.MontoTotal, PC.Moneda,
                   PC.QR_Pedido, PC.QR_Trabajo, PC.QR_String, PC.FechaGeneracion, PC.EstadoCobro
            FROM PedidosCobranza PC
            ${joinClause}
            ${whereClause}
            ORDER BY PC.FechaGeneracion DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        logger.error('[Quotation] Error al listar cotizaciones:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/quotation/:noDocERP
 * Carga PedidosCobranza + detalle con área de cada línea.
 */
exports.getQuotation = async (req, res) => {
    const { noDocERP } = req.params;
    try {
        const pool = await getPool();

        // Búsqueda directa por NoDocERP
        let cabRes = await pool.request()
            .input('Doc', sql.NVarChar, noDocERP)
            .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc))`);

        // Fallback 1: strip 3-letter prefix (portal orders saved as plain number e.g. '194')
        if (cabRes.recordset.length === 0) {
            const stripped = noDocERP.replace(/^[a-zA-Z]{3}-/i, '').trim();
            if (stripped && stripped !== noDocERP.trim()) {
                cabRes = await pool.request()
                    .input('Doc2', sql.NVarChar, stripped)
                    .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc2))`);
            }
        }

        // Fallback 2: look up via Ordenes.CodigoOrden → NoDocERP → PedidosCobranza
        if (cabRes.recordset.length === 0) {
            const ordRes = await pool.request()
                .input('Cod', sql.NVarChar, noDocERP)
                .query(`SELECT TOP 1 NoDocERP FROM Ordenes WITH(NOLOCK)
                        WHERE LTRIM(RTRIM(CodigoOrden)) = LTRIM(RTRIM(@Cod))
                           OR LTRIM(RTRIM(CodigoOrden)) LIKE LTRIM(RTRIM(@Cod)) + ' %'`);
            if (ordRes.recordset.length > 0 && ordRes.recordset[0].NoDocERP) {
                const realDoc = ordRes.recordset[0].NoDocERP.trim();
                cabRes = await pool.request()
                    .input('Doc3', sql.NVarChar, realDoc)
                    .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc3))`);
            }
        }

        if (cabRes.recordset.length === 0) {
            return res.status(404).json({ error: `No se encontró cotización para ${noDocERP}` });
        }
        const cabecera = cabRes.recordset[0];

        // Detalle con área de cada línea (via Ordenes.AreaID y ConfigMapeoERP.AreaID_Interno)
        const detRes = await pool.request()
            .input('PID', sql.Int, cabecera.ID)
            .query(`
                SELECT 
                    PCD.ID,
                    PCD.OrdenID,
                    A.CodArticulo as CodArticulo,
                    PCD.Cantidad,
                    PCD.DatoTecnico,
                    PCD.PrecioUnitario,
                    PCD.Subtotal,
                    PCD.LogPrecioAplicado,
                    PCD.Moneda,
                    PCD.PerfilAplicado,
                    PCD.PricingTrace,
                    PCD.MonedaOriginal,
                    PCD.PrecioUnitarioOriginal,
                    PCD.SubtotalOriginal,
                    PCD.ProIdProducto,
                    O.CodigoOrden,
                    O.DescripcionTrabajo,
                    O.AreaID,
                    O.Prioridad,
                    ISNULL(CME.AreaID_Interno, O.AreaID) as AreaIDInterna,
                    ISNULL(A.Descripcion, A.CodArticulo) as NombreArticulo
                FROM PedidosCobranzaDetalle PCD
                LEFT JOIN Ordenes O WITH(NOLOCK) ON PCD.OrdenID = O.OrdenID
                LEFT JOIN Articulos A WITH(NOLOCK) ON A.ProIdProducto = PCD.ProIdProducto
                LEFT JOIN ConfigMapeoERP CME WITH(NOLOCK) ON LTRIM(RTRIM(CME.AreaID_Interno)) = LTRIM(RTRIM(O.AreaID))
                WHERE PCD.PedidoCobranzaID = @PID
                ORDER BY PCD.ID ASC
            `);

        res.json({ cabecera, detalle: detRes.recordset });
    } catch (err) {
        logger.error('[Quotation] Error al cargar cotización:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─── Detecta si alguna de las órdenes ya avanzó de estado (entregada/facturada/
// cobrada), para pedir confirmación antes de tocar su cotización sin avisar.
async function detectarEstadosSensibles(pool, ordenIds) {
    const advertencias = [];
    if (!ordenIds.length) return advertencias;

    const request = pool.request();
    const placeholders = ordenIds.map((id, i) => { request.input(`id${i}`, sql.Int, id); return `@id${i}`; }).join(',');
    const result = await request.query(`
        SELECT o.OrdenID, o.CodigoOrden,
               od.OrdEstadoActual,
               CASE WHEN od.PagIdPago IS NOT NULL THEN 1 ELSE 0 END AS Pagada,
               (SELECT TOP 1 CASE WHEN mc.DocIdDocumento IS NOT NULL THEN 1 ELSE 0 END
                FROM dbo.MovimientosCuenta mc WITH(NOLOCK)
                WHERE mc.OrdIdOrden = od.OrdIdOrden AND mc.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                  AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
                ORDER BY mc.MovIdMovimiento DESC) AS Facturada,
               (SELECT TOP 1 dd.DDeEstado FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                WHERE dd.OrdIdOrden = od.OrdIdOrden ORDER BY dd.DDeIdDeuda DESC) AS EstadoDeuda
        FROM dbo.Ordenes o WITH(NOLOCK)
        LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdCodigoOrden = o.CodigoOrden
        WHERE o.OrdenID IN (${placeholders})
    `);

    for (const row of result.recordset) {
        const codigo = row.CodigoOrden || `Orden ${row.OrdenID}`;
        if (row.OrdEstadoActual === 9) {
            advertencias.push({ ordenID: row.OrdenID, codigo, tipo: 'ENTREGADA', mensaje: `${codigo} ya fue entregada en depósito.` });
        }
        if (row.Facturada === 1) {
            advertencias.push({ ordenID: row.OrdenID, codigo, tipo: 'FACTURADA', mensaje: `${codigo} ya fue facturada/enviada a DGI.` });
        }
        if (row.EstadoDeuda === 'COBRADO' || row.Pagada === 1) {
            advertencias.push({ ordenID: row.OrdenID, codigo, tipo: 'COBRADA', mensaje: `${codigo} ya fue cobrada.` });
        }
    }
    return advertencias;
}

// ─── Propaga el nuevo total de cotización a OrdenesDeposito y, si corresponde,
// a MovimientosCuenta/CuentasCliente/DeudaDocumento/CiclosCredito/OrdenesRetiro —
// mismo patrón que editarCostoOrden en ordenesRetiroController.js. Sólo actúa
// sobre órdenes que YA tienen fila en OrdenesDeposito (las que no, se resuelven
// solas cuando lleguen a depósito).
async function propagarCotizacionADeposito(pool, { pedidoId, monedaFinal, cotizacion }) {
    const nuevaMonedaId = monedaFinal === 'USD' ? 2 : 1;

    const detRes = await pool.request()
        .input('PID', sql.Int, pedidoId)
        .input('MFinal', sql.VarChar(10), monedaFinal)
        .input('Cotiz', sql.Decimal(18, 4), parseFloat(cotizacion) || 40)
        .query(`
            SELECT OrdenID,
                   SUM(CASE
                        WHEN @MFinal = 'USD' AND Moneda = 'UYU' THEN Subtotal / @Cotiz
                        WHEN @MFinal = 'UYU' AND Moneda = 'USD' THEN Subtotal * @Cotiz
                        ELSE Subtotal
                   END) AS TotalOrden,
                   SUM(Cantidad) AS CantidadOrden
            FROM dbo.PedidosCobranzaDetalle
            WHERE PedidoCobranzaID = @PID AND OrdenID IS NOT NULL
            GROUP BY OrdenID
        `);

    for (const fila of detRes.recordset) {
        const ordenIdErp = fila.OrdenID;
        const nuevoCosto = parseFloat(fila.TotalOrden) || 0;
        const nuevaCantidad = parseFloat(fila.CantidadOrden) || 0;

        const transaction = new sql.Transaction(pool);
        try {
            await transaction.begin();

            const codRes = await new sql.Request(transaction)
                .input('OID', sql.Int, ordenIdErp)
                .query(`SELECT CodigoOrden FROM dbo.Ordenes WHERE OrdenID = @OID`);
            const codigoOrden = codRes.recordset[0]?.CodigoOrden;
            if (!codigoOrden) { await transaction.rollback(); continue; }

            const depRes = await new sql.Request(transaction)
                .input('Cod', sql.NVarChar, codigoOrden)
                .query(`SELECT OrdIdOrden, OrdCostoFinal, OReIdOrdenRetiro FROM dbo.OrdenesDeposito WHERE OrdCodigoOrden = @Cod`);
            if (!depRes.recordset.length) { await transaction.rollback(); continue; } // aún no llegó a depósito

            const dep = depRes.recordset[0];
            const orderId = dep.OrdIdOrden;
            const costoAnterior = parseFloat(dep.OrdCostoFinal) || 0;
            const delta = nuevoCosto - costoAnterior;

            await new sql.Request(transaction)
                .input('OrderId', sql.Int, orderId)
                .input('Costo', sql.Decimal(18, 2), nuevoCosto)
                .input('Cantidad', sql.Decimal(18, 4), nuevaCantidad || 1)
                .input('Moneda', sql.Int, nuevaMonedaId)
                .query(`UPDATE dbo.OrdenesDeposito SET OrdCostoFinal=@Costo, OrdCantidad=@Cantidad, MonIdMoneda=@Moneda WHERE OrdIdOrden=@OrderId`);

            const movRes = await new sql.Request(transaction)
                .input('OrdId', sql.Int, orderId)
                .query(`
                    SELECT TOP 1 MovIdMovimiento, CueIdCuenta, CicIdCiclo FROM dbo.MovimientosCuenta
                    WHERE OrdIdOrden=@OrdId AND MovTipo='ORDEN' AND (MovAnulado IS NULL OR MovAnulado=0) AND DocIdDocumento IS NULL
                `);
            if (movRes.recordset.length) {
                const mov = movRes.recordset[0];
                await new sql.Request(transaction)
                    .input('MovId', sql.Int, mov.MovIdMovimiento).input('Imp', sql.Decimal(18, 4), -nuevoCosto)
                    .query(`UPDATE dbo.MovimientosCuenta SET MovImporte=@Imp WHERE MovIdMovimiento=@MovId`);
                await new sql.Request(transaction)
                    .input('CueId', sql.Int, mov.CueIdCuenta).input('Delta', sql.Decimal(18, 4), delta)
                    .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Delta WHERE CueIdCuenta=@CueId`);
                await new sql.Request(transaction)
                    .input('OrdId', sql.Int, orderId).input('Delta', sql.Decimal(18, 4), delta)
                    .query(`
                        UPDATE dbo.DeudaDocumento
                        SET DDeImportePendiente = CASE WHEN DDeImportePendiente+@Delta<=0 THEN 0 ELSE DDeImportePendiente+@Delta END,
                            DDeEstado = CASE WHEN DDeImportePendiente+@Delta<=0 THEN 'COBRADO' ELSE DDeEstado END
                        WHERE OrdIdOrden=@OrdId AND DDeEstado NOT IN ('CANCELADA','COBRADO')
                    `);
                if (mov.CicIdCiclo) {
                    await new sql.Request(transaction).input('CicId', sql.Int, mov.CicIdCiclo).query(`
                        UPDATE c SET c.CicTotalOrdenes = ISNULL((
                            SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta
                            WHERE CicIdCiclo=c.CicIdCiclo AND MovTipo IN ('ORDEN','ENTREGA','ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado=0)
                        ), 0)
                        FROM dbo.CiclosCredito c WHERE c.CicIdCiclo=@CicId
                    `);
                }
            }

            if (dep.OReIdOrdenRetiro) {
                await new sql.Request(transaction).input('RetiroId', sql.Int, dep.OReIdOrdenRetiro).query(`
                    UPDATE dbo.OrdenesRetiro
                    SET OReCostoTotalOrden = (SELECT SUM(OrdCostoFinal) FROM dbo.OrdenesDeposito WHERE OReIdOrdenRetiro=@RetiroId)
                    WHERE OReIdOrdenRetiro=@RetiroId
                `);
            }

            await transaction.commit();
            logger.info(`[Quotation] Propagado a depósito: orden ${codigoOrden} costo ${costoAnterior} -> ${nuevoCosto}`);
        } catch (e) {
            try { await transaction.rollback(); } catch {}
            logger.warn(`[Quotation] No se pudo propagar a depósito para OrdenID=${ordenIdErp}: ${e.message}`);
        }
    }
}

/**
 * PUT /api/quotation/:noDocERP
 * Guarda las líneas editadas y recalcula QR_String, MontoTotal.
 * Body: { lineas: [{OrdenID, CodArticulo, Cantidad, PrecioUnitario, NombreArticulo?}], confirmado?: boolean }
 * Si alguna orden ya fue entregada/facturada/cobrada, responde 409 con
 * { requiereConfirmacion: true, advertencias } salvo que venga confirmado=true.
 */
exports.saveQuotation = async (req, res) => {
    const { noDocERP } = req.params;
    const { lineas, cotizacion = 40, confirmado = false, propagarADeposito = false } = req.body;
    const userArea = req.user?.AreaID || null;
    const isAdmin = !userArea || req.user?.rol === 'ADMIN' || req.user?.esAdmin;

    if (!lineas || !Array.isArray(lineas)) {
        return res.status(400).json({ error: 'Se requiere el campo "lineas" como array.' });
    }

    const pool = await getPool();

    // ── Chequeo de estados sensibles ANTES de tocar nada ────────────────────────
    // Sólo aplica cuando el caller pide propagar a depósito/retiro/contabilidad
    // (hoy: únicamente la vista de Administración de Órdenes). El resto de las
    // pantallas que reusan este mismo editor (ej. "Cotizar Productos" en el
    // detalle de orden de producción) siguen guardando sólo Cobranza, como antes.
    if (propagarADeposito && !confirmado) {
        const ordenIds = [...new Set(lineas.map(l => parseInt(l.OrdenID)).filter(Boolean))];
        const advertencias = await detectarEstadosSensibles(pool, ordenIds);
        if (advertencias.length > 0) {
            return res.status(409).json({
                requiereConfirmacion: true,
                advertencias,
                error: 'Esta orden ya avanzó de estado. Confirmá para modificar la cotización igual.'
            });
        }
    }

    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        // Verificar existencia de la cabecera con el mismo fallback multi-paso que el GET
        let cabRes = await new sql.Request(transaction)
            .input('Doc', sql.NVarChar, noDocERP)
            .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc))`);

        // Fallback 1: strip 3-letter prefix (portal orders saved as plain number e.g. '194')
        // Debe ir ANTES del bloque de creación para no duplicar una cabecera ya existente
        // guardada sin prefijo (p.ej. GET encuentra "4785" pero save recibe "SUB-4785").
        if (cabRes.recordset.length === 0) {
            const stripped = noDocERP.replace(/^[a-zA-Z]{3}-/i, '').trim();
            if (stripped && stripped !== noDocERP.trim()) {
                cabRes = await new sql.Request(transaction)
                    .input('DocStrip', sql.NVarChar, stripped)
                    .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@DocStrip))`);
            }
        }

        // Fallback 2: buscar via CodigoOrden en Ordenes → NoDocERP real en PedidosCobranza
        if (cabRes.recordset.length === 0) {
            const ordDocRes = await new sql.Request(transaction)
                .input('Cod', sql.NVarChar, noDocERP)
                .query(`SELECT TOP 1 NoDocERP FROM Ordenes WITH(NOLOCK)
                        WHERE LTRIM(RTRIM(CodigoOrden)) = LTRIM(RTRIM(@Cod))
                           OR LTRIM(RTRIM(CodigoOrden)) LIKE LTRIM(RTRIM(@Cod)) + ' %'`);
            if (ordDocRes.recordset.length > 0 && ordDocRes.recordset[0].NoDocERP) {
                const realDoc = ordDocRes.recordset[0].NoDocERP.trim();
                cabRes = await new sql.Request(transaction)
                    .input('Doc2', sql.NVarChar, realDoc)
                    .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc2))`);
            }
        }

        if (cabRes.recordset.length === 0) {
            // No existe en ningún formato — crearla resolviendo el CliIdCliente
            let clienteId = null;

            // Intento 1: por NoDocERP en Ordenes
            const ordCabRes = await new sql.Request(transaction)
                .input('Doc', sql.NVarChar, noDocERP)
                .query(`SELECT TOP 1 CliIdCliente FROM Ordenes WITH(NOLOCK)
                        WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR))) = LTRIM(RTRIM(@Doc))`);
            clienteId = ordCabRes.recordset[0]?.CliIdCliente || null;

            // Intento 2: por CodigoOrden en Ordenes
            if (!clienteId) {
                const cliByOrdRes = await new sql.Request(transaction)
                    .input('Cod', sql.NVarChar, noDocERP)
                    .query(`SELECT TOP 1 CliIdCliente FROM Ordenes WITH(NOLOCK)
                            WHERE LTRIM(RTRIM(CodigoOrden)) = LTRIM(RTRIM(@Cod))
                               OR LTRIM(RTRIM(CodigoOrden)) LIKE LTRIM(RTRIM(@Cod)) + ' %'`);
                clienteId = cliByOrdRes.recordset[0]?.CliIdCliente || null;
            }

            // Intento 3: por OrdenID de la primera línea
            if (!clienteId && lineas.length > 0) {
                const firstOrdenID = parseInt(lineas[0].OrdenID) || 0;
                if (firstOrdenID > 0) {
                    const cliByOIDRes = await new sql.Request(transaction)
                        .input('OID', sql.Int, firstOrdenID)
                        .query(`SELECT TOP 1 CliIdCliente FROM Ordenes WITH(NOLOCK) WHERE OrdenID = @OID`);
                    clienteId = cliByOIDRes.recordset[0]?.CliIdCliente || null;
                }
            }

            if (!clienteId) {
                throw new Error(`No se pudo determinar el cliente para el pedido ${noDocERP}.`);
            }

            const initialMoneda = lineas.some(l => (l.Moneda || '').toUpperCase() === 'USD') ? 'USD' : 'UYU';
            await new sql.Request(transaction)
                .input('Doc', sql.NVarChar, noDocERP)
                .input('Cli', sql.Int, clienteId)
                .input('Mon', sql.VarChar(10), initialMoneda)
                .query(`INSERT INTO PedidosCobranza (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, EstadoCobro) VALUES (LTRIM(RTRIM(@Doc)), @Cli, 0, @Mon, GETDATE(), 'PENDIENTE')`);
            cabRes = await new sql.Request(transaction)
                .input('Doc', sql.NVarChar, noDocERP)
                .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc))`);
        }
        const cabecera = cabRes.recordset[0];
        const pedidoId = cabecera.ID;
        // NoDocERP real de la cabecera hallada (puede diferir del recibido si venía con prefijo,
        // p.ej. recibido "SUB-4785" pero almacenado como "4785"). Usar este para los lookups por NoDocERP.
        const realNoDocERP = (cabecera.NoDocERP != null ? cabecera.NoDocERP.toString().trim() : noDocERP);

        // Descubrir OrdenID desde Ordenes usando NoDocERP (para líneas que lleguen sin OrdenID)
        const ordIdRes = await new sql.Request(transaction)
            .input('Doc', sql.NVarChar, realNoDocERP)
            .query(`SELECT TOP 1 OrdenID FROM Ordenes WITH(NOLOCK) WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR))) = LTRIM(RTRIM(@Doc))`);
        const discoveredOrdenID = ordIdRes.recordset[0]?.OrdenID || null;
        const moneda = cabecera.Moneda || 'UYU';

        // Si el usuario NO es admin, solo puede eliminar/agregar líneas de SU área.
        // Las líneas de otras áreas deben preservarse tal cual.
        let lineasAPreservar = [];
        if (!isAdmin) {
            // Cargar las líneas actuales de otras áreas para preservarlas
            const otrasAreasRes = await new sql.Request(transaction)
                .input('PID', sql.Int, pedidoId)
                .input('Area', sql.NVarChar, userArea)
                .query(`
                    SELECT PCD.*
                    FROM PedidosCobranzaDetalle PCD
                    LEFT JOIN Ordenes O ON PCD.OrdenID = O.OrdenID
                    WHERE PCD.PedidoCobranzaID = @PID
                      AND ISNULL(LTRIM(RTRIM(O.AreaID)), '') <> LTRIM(RTRIM(@Area))
                `);
            lineasAPreservar = otrasAreasRes.recordset;
        }

        // Eliminar líneas del área actual (o todas si admin)
        if (isAdmin) {
            await new sql.Request(transaction)
                .input('PID', sql.Int, pedidoId)
                .query(`DELETE FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID`);
        } else {
            await new sql.Request(transaction)
                .input('PID', sql.Int, pedidoId)
                .input('Area', sql.NVarChar, userArea)
                .query(`
                    DELETE PCD
                    FROM PedidosCobranzaDetalle PCD
                    LEFT JOIN Ordenes O ON PCD.OrdenID = O.OrdenID
                    WHERE PCD.PedidoCobranzaID = @PID
                      AND ISNULL(LTRIM(RTRIM(O.AreaID)), '') = LTRIM(RTRIM(@Area))
                `);
        }

        // Insertar las líneas nuevas/editadas
        for (const linea of lineas) {
            const subtotal = (parseFloat(linea.Cantidad) || 0) * (parseFloat(linea.PrecioUnitario) || 0);
            const lineaMon = linea.Moneda || moneda;
            const lineaMonOrig = linea.MonedaOriginal || lineaMon;
            const lineaSubOrig = parseFloat(linea.SubtotalOriginal) || ((parseFloat(linea.Cantidad) || 0) * (parseFloat(linea.PrecioUnitarioOriginal) || parseFloat(linea.PrecioUnitario) || 0));

            await new sql.Request(transaction)
                .input('PID', sql.Int, pedidoId)
                .input('OID', sql.Int, linea.OrdenID || discoveredOrdenID || null)
                .input('Cod', sql.NVarChar, linea.CodArticulo || '')
                .input('ProId', sql.Int, linea.ProIdProducto || null)
                .input('Cant', sql.Decimal(18, 2), parseFloat(linea.Cantidad) || 0)
                .input('DT', sql.Decimal(18, 2), parseFloat(linea.DatoTecnico) || null)
                .input('PU', sql.Decimal(18, 2), parseFloat(linea.PrecioUnitario) || 0)
                .input('ST', sql.Decimal(18, 2), subtotal)
                .input('MonOrig', sql.VarChar(10), lineaMonOrig)
                .input('PUOrig', sql.Decimal(18, 4), parseFloat(linea.PrecioUnitarioOriginal) || parseFloat(linea.PrecioUnitario) || 0)
                .input('STOrig', sql.Decimal(18, 4), lineaSubOrig)
                .input('Log', sql.NVarChar, linea.LogPrecioAplicado || 'Manual')
                .input('Mon', sql.VarChar, lineaMon)
                .input('Perfil', sql.NVarChar(sql.MAX), linea.PerfilAplicado || 'Manual')
                .input('Trace', sql.NVarChar(sql.MAX), linea.PricingTrace || 'Edición manual')
                .query(`INSERT INTO PedidosCobranzaDetalle 
                    (PedidoCobranzaID, OrdenID, CodArticulo, ProIdProducto, Cantidad, DatoTecnico, PrecioUnitario, Subtotal, 
                     LogPrecioAplicado, Moneda, PerfilAplicado, PricingTrace, MonedaOriginal, PrecioUnitarioOriginal, SubtotalOriginal)
                    VALUES (@PID, @OID, @Cod, @ProId, @Cant, @DT, @PU, @ST, @Log, @Mon, @Perfil, @Trace, @MonOrig, @PUOrig, @STOrig)`);
        }

        // Determinar moneda final revisando todas las líneas de la base de datos
        const curRes = await new sql.Request(transaction)
            .input('PID2', sql.Int, pedidoId)
            .query(`
                SELECT CASE WHEN EXISTS (SELECT 1 FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID2 AND Moneda = 'USD') THEN 'USD' ELSE 'UYU' END as MonedaFinal
            `);
        const monedaFinal = curRes.recordset[0].MonedaFinal;

        // Recalcular MontoTotal sumando TODAS las líneas, transformando a la moneda final
        const totRes = await new sql.Request(transaction)
            .input('PID', sql.Int, pedidoId)
            .input('Cotiz', sql.Decimal(18, 4), parseFloat(cotizacion) || 40)
            .input('MFinal', sql.VarChar(10), monedaFinal)
            .query(`
                SELECT 
                    ISNULL(SUM(
                        CASE 
                            WHEN @MFinal = 'USD' AND Moneda = 'UYU' THEN Subtotal / @Cotiz
                            WHEN @MFinal = 'UYU' AND Moneda = 'USD' THEN Subtotal * @Cotiz
                            ELSE Subtotal
                        END
                    ), 0) as Total, 
                    ISNULL(SUM(Cantidad), 0) as TotalCant 
                FROM PedidosCobranzaDetalle 
                WHERE PedidoCobranzaID = @PID
            `);

        const nuevoTotal = parseFloat(totRes.recordset[0].Total) || 0;
        const nuevaCantidad = parseFloat(totRes.recordset[0].TotalCant) || 0;

        // Actualizar QR_Importe, QR_Cantidad y QR_String con los nuevos totales
        const nuevoQrImporte = nuevoTotal.toFixed(2);
        const nuevoQrCantidad = nuevaCantidad.toString();

        // Reconstruir QR_String
        const nuevoQrString = [
            cabecera.QR_Pedido,
            cabecera.QR_Cliente,
            cabecera.QR_Trabajo,
            cabecera.QR_Urgencia,
            cabecera.QR_Producto,
            nuevoQrCantidad,
            nuevoQrImporte
        ].join(SEP);

        await new sql.Request(transaction)
            .input('ID', sql.Int, pedidoId)
            .input('Total', sql.Decimal(18, 2), nuevoTotal)
            .input('Cant', sql.NVarChar, nuevoQrCantidad)
            .input('Imp', sql.NVarChar, nuevoQrImporte)
            .input('QRS', sql.NVarChar(sql.MAX), nuevoQrString)
            .input('MFinalDB', sql.VarChar(10), monedaFinal)
            .query(`UPDATE PedidosCobranza SET 
                Moneda = @MFinalDB,
                MontoTotal = @Total,
                QR_Cantidad = @Cant,
                QR_Importe = @Imp,
                QR_String = @QRS,
                FechaGeneracion = GETDATE()
                WHERE ID = @ID`);

        await transaction.commit();

        // Sincronizar MovImporte con el nuevo total para órdenes ya contabilizadas
        try {
            await pool.request()
                .input('NoDoc', sql.NVarChar, realNoDocERP)
                .input('NewTotal', sql.Decimal(18, 2), nuevoTotal)
                .input('MFinal', sql.VarChar(10), monedaFinal)
                .query(`
                    UPDATE mc
                    SET mc.MovImporte = -@NewTotal
                    FROM dbo.MovimientosCuenta mc
                    INNER JOIN dbo.Ordenes o ON mc.OrdIdOrden = o.OrdenID
                    INNER JOIN dbo.CuentasCliente cc ON mc.CueIdCuenta = cc.CueIdCuenta
                    WHERE LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR))) = LTRIM(RTRIM(@NoDoc))
                      AND mc.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
                      AND mc.DocIdDocumento IS NULL
                      AND (
                          (cc.MonIdMoneda = 1 AND @MFinal = 'UYU')
                          OR (cc.MonIdMoneda = 2 AND @MFinal = 'USD')
                      )
                `);
            await pool.request()
                .input('NoDoc', sql.NVarChar, realNoDocERP)
                .input('NewTotal', sql.Decimal(18, 2), nuevoTotal)
                .query(`
                    UPDATE dbo.PedidosCobranza
                    SET MontoContabilizado = @NewTotal
                    WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@NoDoc))
                      AND MontoContabilizado IS NOT NULL
                      AND MontoContabilizado > 0
                `);
        } catch (syncErr) {
            logger.warn(`[Quotation] No se pudo sincronizar movimiento contable para ${noDocERP}: ${syncErr.message}`);
        }

        // Propagar a OrdenesDeposito/OrdenesRetiro (sólo si el caller lo pidió explícitamente)
        if (propagarADeposito) {
            try {
                await propagarCotizacionADeposito(pool, { pedidoId, monedaFinal, cotizacion });
            } catch (propErr) {
                logger.warn(`[Quotation] No se pudo propagar a depósito para ${noDocERP}: ${propErr.message}`);
            }
        }

        logger.info(`[Quotation] ✅ Cotización guardada para ${noDocERP} | Total: ${nuevoTotal} | QR: ${nuevoQrString}`);

        res.json({
            success: true,
            noDocERP,
            montoTotal: nuevoTotal,
            qrString: nuevoQrString
        });

    } catch (err) {
        try {
            await transaction.rollback();
        } catch (rollbackErr) {
            logger.error('[Quotation] Error on rollback:', rollbackErr);
        }
        logger.error('[Quotation] Error al guardar cotización:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/quotation/search-products?q=XXX
 * Buscador de productos para agregar nuevas líneas.
 */
exports.searchProducts = async (req, res) => {
    const { q } = req.query;
    try {
        const pool = await getPool();
        const request = pool.request();
        let whereClause = 'WHERE A.Mostrar = 1';
        if (q && q.length >= 2) {
            request.input('q', sql.NVarChar, `%${q}%`);
            whereClause = `WHERE A.Mostrar = 1 AND (A.Descripcion LIKE @q OR A.CodArticulo LIKE @q)`;
        }
        const result = await request.query(`
            SELECT TOP 1000
                LTRIM(RTRIM(A.CodArticulo)) as CodArticulo,
                LTRIM(RTRIM(A.Descripcion)) as Descripcion,
                A.ProIdProducto,
                LTRIM(RTRIM(CME.AreaID_Interno)) as AreaID,
                CME.NombreReferencia as AreaNombre,
                PB.Precio as PrecioBase,
                CASE 
                    WHEN PB.MonIdMoneda IS NOT NULL THEN (CASE WHEN PB.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END)
                    WHEN A.MonIdMoneda = 2 THEN 'USD' 
                    ELSE 'UYU' 
                END as Moneda
            FROM Articulos A WITH(NOLOCK)
            LEFT JOIN ConfigMapeoERP CME WITH(NOLOCK) ON CME.CodigoERP = A.Grupo COLLATE Database_Default
            LEFT JOIN PreciosBase PB WITH(NOLOCK) ON A.ProIdProducto = PB.ProIdProducto
            ${whereClause}
            ORDER BY CME.AreaID_Interno, A.Descripcion
        `);
        res.json(result.recordset);
    } catch (err) {
        logger.error('[Quotation] Error buscando productos:', err);
        res.status(500).json({ error: err.message });
    }
};
