/**
 * Solicitudes de insumo del cliente (Spec 39, RN-FLT.10 / RN-FLT.11) — bandeja de Atención al
 * Cliente y Administración. Montado en /api/solicitudes-insumo.
 *
 *  - listar / detalle (con el stock encontrado y la reposición)
 *  - notificar al cliente por el portal (ticket del helpdesk + push, nada por WhatsApp)
 *  - registrar la decisión: USA_STOCK | TRAE_MAS | ACEPTA_PARCIAL | COMPRA_ADMIN | VEN_INTERNA
 *  - vincular una PRE nueva (desde Ingreso de materiales): recién ahí nace la orden de falla
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { changeOrderState } = require('../services/stateManagerService');
const libro = require('../services/libroEntregasService');
const cadena = require('../services/cadenaReposicionService');
const reposiciones = require('../services/reposicionesService');
const { registrarAuditoria } = require('../services/trackingService');

const err400 = (msg) => { const e = new Error(msg); e.statusCode = 400; return e; };

const SQL_SOLICITUD = `
    SELECT s.*, r.OrdenMadreID, r.OrdenReportaID, r.AreaProduce, r.AreaReporta, r.Tipo AS TipoReposicion, r.OrigenInsumo, r.Estado AS EstadoReposicion,
           r.Cantidad, r.Unidad, r.Motivo, r.Nota, r.ImagenPath, r.DetallePiezas, r.NoDocERP, r.FechaCreacion AS FechaReporte, r.OrdenFallaID,
           m.CodigoOrden AS CodigoMadre, m.Cliente, m.CliIdCliente, m.CodCliente, m.DescripcionTrabajo, m.Magnitud AS MagnitudMadre, m.UM AS UMMadre, m.BobinaTelaID, m.PrendaClienteID, m.WmsVarianteId, m.ProIdProducto,
           rep.CodigoOrden AS CodigoReporta, f.CodigoOrden AS CodigoFalla, f.EstadoenArea AS EstadoFalla,
           DATEDIFF(day, GETDATE(), s.Vencimiento) AS DiasParaVencer
    FROM SolicitudesInsumo s
    JOIN Reposiciones r ON r.ReposicionID = s.ReposicionID
    JOIN Ordenes m ON m.OrdenID = r.OrdenMadreID
    LEFT JOIN Ordenes rep ON rep.OrdenID = r.OrdenReportaID
    LEFT JOIN Ordenes f ON f.OrdenID = r.OrdenFallaID`;

const mapSol = (x) => {
    let stock = null, piezas = null;
    try { stock = x.StockEncontrado ? JSON.parse(x.StockEncontrado) : null; } catch (_) { /* ignore */ }
    try { piezas = x.DetallePiezas ? JSON.parse(x.DetallePiezas) : null; } catch (_) { /* ignore */ }
    return { ...x, StockEncontrado: stock, DetallePiezas: piezas, NoDocERP: x.NoDocERP ? String(x.NoDocERP).trim() : null, CodigoMadre: String(x.CodigoMadre || '').trim() };
};

/** GET /solicitudes-insumo?estado=ABIERTAS|RESUELTAS|TODAS */
exports.listar = async (req, res) => {
    try {
        const estado = String(req.query.estado || 'ABIERTAS').toUpperCase();
        const where = estado === 'RESUELTAS' ? `WHERE s.Estado = 'RESUELTA'` : estado === 'TODAS' ? '' : `WHERE s.Estado <> 'RESUELTA'`;
        const pool = await getPool();
        const r = await pool.request().query(`${SQL_SOLICITUD} ${where} ORDER BY CASE s.Estado WHEN 'NUEVA' THEN 0 WHEN 'SIN_RESPUESTA' THEN 1 WHEN 'NOTIFICADA' THEN 2 ELSE 3 END, s.FechaCreacion DESC`);
        const resumen = await pool.request().query(`SELECT Estado, COUNT(*) n FROM SolicitudesInsumo GROUP BY Estado`);
        res.json({ solicitudes: r.recordset.map(mapSol), resumen: Object.fromEntries(resumen.recordset.map(x => [x.Estado, x.n])) });
    } catch (err) { logger.error('[solicitudes] listar:', err); res.status(500).json({ error: err.message }); }
};

exports.detalle = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().input('id', sql.Int, parseInt(req.params.id, 10)).query(`${SQL_SOLICITUD} WHERE s.SolicitudID = @id`);
        if (!r.recordset.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
        const sol = mapSol(r.recordset[0]);
        // Stock actual (puede haber cambiado desde que se abrió)
        try {
            const solicitudes = require('../services/solicitudesInsumoService');
            const madre = (await pool.request().input('id', sql.Int, sol.OrdenMadreID).query(`SELECT * FROM Ordenes WHERE OrdenID = @id`)).recordset[0];
            sol.StockActual = await solicitudes.buscarStock(sol.Tipo, madre, pool);
        } catch (e) { sol.StockActual = null; }
        res.json(sol);
    } catch (err) { logger.error('[solicitudes] detalle:', err); res.status(500).json({ error: err.message }); }
};

/** POST /solicitudes-insumo/:id/notificar { mensaje } → ticket del helpdesk visible para el cliente + push */
exports.notificar = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { mensaje } = req.body || {};
    try {
        const pool = await getPool();
        const r = await pool.request().input('id', sql.Int, id).query(`${SQL_SOLICITUD} WHERE s.SolicitudID = @id`);
        if (!r.recordset.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
        const s = mapSol(r.recordset[0]);
        // [PRODUCTO_LOCAL] Al cliente solo se le avisa cuando el insumo es suyo (entró por PRE).
        if (s.Tipo === 'PRODUCTO_LOCAL') throw err400('Es un producto del local: no se le avisa al cliente. Solo hay que aprobar la reposición.');
        if (!s.CliIdCliente) throw err400('La orden no tiene cliente asociado: no se puede notificar por el portal.');
        // Tickets.CliIdCliente y las suscripciones push del portal guardan el CodCliente (el id del
        // usuario web), NO Clientes.CliIdCliente: con el id interno el cliente no veía el ticket.
        let codCliente = parseInt(String(s.CodCliente || '').trim(), 10);
        if (!Number.isFinite(codCliente)) {
            const c = (await pool.request().input('id', sql.Int, s.CliIdCliente).query(`SELECT CodCliente FROM Clientes WHERE CliIdCliente = @id`)).recordset[0];
            codCliente = parseInt(String(c?.CodCliente || '').trim(), 10);
        }
        if (!Number.isFinite(codCliente)) throw err400('El cliente no tiene código de portal: no se puede notificar por el portal.');
        const stockTxt = s.StockEncontrado?.resumen ? ` Tenés en nuestro depósito: ${s.StockEncontrado.resumen}.` : '';
        const texto = (mensaje && String(mensaje).trim()) || (
            `Hola. En la producción de tu orden ${s.CodigoMadre} se dañó parte de ${s.Tipo === 'TELA_CLIENTE' ? 'la tela que nos entregaste' : s.Tipo === 'PRENDA_CLIENTE' ? 'las prendas que nos entregaste' : 'el producto'} ` +
            `(${s.Cantidad != null ? `${Number(s.Cantidad)} ${String(s.Unidad || '').trim()}` : 'cantidad a confirmar'} · motivo: ${s.Motivo || 'falla de producción'}).` + stockTxt +
            ` Necesitamos que nos indiques cómo seguir: ${s.StockEncontrado?.encontrado?.length ? 'usar ese stock, ' : ''}traer más ${s.Tipo === 'PRENDA_CLIENTE' ? 'prendas' : 'tela'}, o retirar solo lo producido. Respondé por acá.`);
        const tx = new sql.Transaction(pool);
        await tx.begin();
        let ticketId;
        try {
            const t = await new sql.Request(tx)
                .input('CliId', sql.Int, codCliente).input('UsrId', sql.Int, req.user?.id || null)
                .input('OrdId', sql.Int, s.OrdenMadreID).input('Asunto', sql.NVarChar(200), `Insumo dañado en ${s.CodigoMadre}: necesitamos tu decisión`)
                .query(`INSERT INTO Tickets (CliIdCliente, UsrIdCreador, DepIdDepartamento, OrdIdOrden, TicAsunto, TicPrioridad, TicEstado, TicFechaAlta, TicFechaActualizacion)
                        OUTPUT INSERTED.TicIdTicket VALUES (@CliId, @UsrId, 1, @OrdId, @Asunto, 1, 3, GETDATE(), GETDATE())`);
            ticketId = t.recordset[0].TicIdTicket;
            await new sql.Request(tx).input('TicId', sql.Int, ticketId).input('UsrId', sql.Int, req.user?.id || null).input('Txt', sql.NVarChar(sql.MAX), texto)
                .query(`INSERT INTO Tickets_Mensajes (TicIdTicket, UsrIdAutor, CliIdAutor, TMenEsNotaInterna, TMenTexto, TMenFecha) VALUES (@TicId, @UsrId, NULL, 0, @Txt, GETDATE())`);
            await new sql.Request(tx).input('id', sql.Int, id).input('u', sql.Int, req.user?.id || null)
                .query(`UPDATE SolicitudesInsumo SET Estado = CASE WHEN Estado IN ('NUEVA','SIN_RESPUESTA') THEN 'NOTIFICADA' ELSE Estado END, NotificadaPortal = 1, FechaNotificacion = GETDATE(), UsuarioNotifica = @u,
                        DetalleDecision = CONCAT(ISNULL(DetalleDecision,''), 'Ticket #', ${ticketId}, ' enviado al portal. ') WHERE SolicitudID = @id`);
            await registrarAuditoria(tx, req.user?.id, 'SOLICITUD_INSUMO_NOTIFICADA', `Solicitud #${id} (${s.CodigoMadre}) notificada por el portal: ticket #${ticketId}`, req.ip);
            await tx.commit();
        } catch (e) { await tx.rollback(); throw e; }
        try {
            const push = require('../services/pushNotificationService');
            await push.sendToClient(codCliente, { title: `Necesitamos tu decisión · ${s.CodigoMadre}`, body: 'Se dañó parte del insumo que nos entregaste. Entrá al portal para elegir cómo seguir.', url: `/portal/soporte/${ticketId}` });
        } catch (e) { logger.warn('[solicitudes] push:', e.message); }
        const io = req.app.get('socketio');
        if (io) { try { io.to('helpdesk:admin').emit('ticket:new', { ticketId }); } catch (_) { /* best effort */ } }
        res.json({ success: true, ticketId, message: `Notificado por el portal (ticket #${ticketId}). La solicitud queda esperando la respuesta del cliente.` });
    } catch (err) { logger.error('[solicitudes] notificar:', err); res.status(err.statusCode || 500).json({ error: err.message }); }
};

/** Cierra la solicitud, cierra la reposición sin orden y libera la orden que reportó. */
async function cerrarSinReposicion(tx, sol, userObj, io) {
    await new sql.Request(tx).input('rep', sql.Int, sol.ReposicionID).query(`UPDATE Reposiciones SET Estado = 'CERRADA', FechaCierre = GETDATE() WHERE ReposicionID = @rep`);
    await new sql.Request(tx).input('rep', sql.Int, sol.ReposicionID).query(`UPDATE Reposiciones SET Estado = 'CANCELADA', FechaCierre = GETDATE() WHERE ReposicionAnteriorID = @rep AND Estado IN ('BLOQUEADA','ESPERANDO_INSUMO')`);
    await reposiciones.liberarOrdenReportaSiCorresponde(tx, sol.OrdenReportaID, userObj, io);
}

/**
 * POST /solicitudes-insumo/:id/decision
 * { decision: USA_STOCK|TRAE_MAS|ACEPTA_PARCIAL|COMPRA_ADMIN|VEN_INTERNA, medioConfirmacion, detalle,
 *   bobinaId?, prendaId?, cantidadProducida? }
 */
exports.decidir = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { decision, detalle, bobinaId, prendaId, cantidadProducida } = req.body || {};
    let { medioConfirmacion } = req.body || {};
    const userObj = req.user || 'Sistema';
    const io = req.app.get('socketio');
    let tx;
    try {
        const pool = await getPool();
        const r = await pool.request().input('id', sql.Int, id).query(`${SQL_SOLICITUD} WHERE s.SolicitudID = @id`);
        if (!r.recordset.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
        const s = mapSol(r.recordset[0]);
        if (s.Estado === 'RESUELTA') throw err400('La solicitud ya está resuelta.');
        if (!['USA_STOCK', 'TRAE_MAS', 'ACEPTA_PARCIAL', 'COMPRA_ADMIN', 'VEN_INTERNA'].includes(decision)) throw err400('Decisión inválida.');
        // [PRODUCTO_LOCAL] No decide el cliente: solo se aprueba la reposición del stock del local.
        if (s.Tipo === 'PRODUCTO_LOCAL') {
            if (decision !== 'VEN_INTERNA') throw err400('Es un producto del local: solo se puede aprobar la reposición (VEN interna).');
            medioConfirmacion = 'interno';
        }
        if (!medioConfirmacion) throw err400('Indicá cómo confirmó el cliente (portal, teléfono, mostrador).');
        const areasUnidades = await libro.areasQueCuentanUnidades(pool);

        tx = new sql.Transaction(pool);
        await tx.begin();
        const setDecision = async (estado) => {
            await new sql.Request(tx).input('id', sql.Int, id).input('d', sql.VarChar(20), decision).input('m', sql.NVarChar(50), String(medioConfirmacion).slice(0, 50))
                .input('det', sql.NVarChar(sql.MAX), detalle || null).input('u', sql.Int, req.user?.id || null).input('e', sql.VarChar(20), estado)
                .input('bob', sql.Int, bobinaId || null).input('pre', sql.Int, prendaId || null)
                .query(`UPDATE SolicitudesInsumo SET Decision = @d, MedioConfirmacion = @m, DetalleDecision = CONCAT(ISNULL(DetalleDecision,''), ISNULL(@det,'')), UsuarioDecision = @u, FechaDecision = GETDATE(), Estado = @e,
                        BobinaUsadaID = ISNULL(@bob, BobinaUsadaID), PrendaUsadaID = ISNULL(@pre, PrendaUsadaID) WHERE SolicitudID = @id`);
        };
        let resultado = {};

        if (decision === 'USA_STOCK') {
            if (s.Tipo === 'TELA_CLIENTE' && !bobinaId) throw err400('Elegí qué bobina del cliente se usa.');
            if (s.Tipo === 'PRENDA_CLIENTE' && !prendaId) throw err400('Elegí qué prendas del cliente se usan.');
            if (bobinaId) {
                const b = (await new sql.Request(tx).input('b', sql.Int, bobinaId).query(`SELECT BobinaID, CodigoEtiqueta, MetrosRestantes, Estado FROM InventarioBobinas WHERE BobinaID = @b`)).recordset[0];
                if (!b || !['Disponible', 'En Uso'].includes(b.Estado) || Number(b.MetrosRestantes) <= 0) throw err400('Esa bobina no está disponible.');
            }
            const creadas = await cadena.materializarCadena(tx, s.ReposicionID, { bobinaId: bobinaId || null, prendaId: prendaId || null, areasUnidades, motivoExtra: 'El cliente confirmó usar su propio stock.' });
            await setDecision('RESUELTA');
            resultado = { creadas, message: `Se creó ${creadas.map(c => c.codigo).join(' y ')} usando el stock del cliente. La solicitud queda resuelta; ${s.CodigoReporta || s.CodigoMadre} se libera cuando llegue la reposición.` };
        } else if (decision === 'TRAE_MAS' || decision === 'COMPRA_ADMIN') {
            await setDecision(s.Estado === 'NUEVA' ? 'NOTIFICADA' : s.Estado);
            resultado = { message: decision === 'TRAE_MAS'
                ? `Registrado: el cliente trae más ${s.Tipo === 'PRENDA_CLIENTE' ? 'prendas' : 'tela'}. La orden de falla se crea cuando ingrese la PRE nueva vinculada a esta solicitud.`
                : 'Registrado: Administración compra el insumo. Cuando ingrese como PRE vinculada a esta solicitud, nace la orden de falla.' };
        } else if (decision === 'ACEPTA_PARCIAL') {
            const prod = cantidadProducida != null && cantidadProducida !== '' ? Number(cantidadProducida) : null;
            if (prod == null || !Number.isFinite(prod) || prod < 0) throw err400('Indicá cuánto se produjo realmente (la nueva cantidad de la orden).');
            // Redimensionar la orden madre a lo producido; el pedido cuenta como completo (INV-FLT.06: recotizar)
            await new sql.Request(tx).input('id', sql.Int, s.OrdenMadreID).input('m', sql.NVarChar, String(prod)).input('c', sql.Decimal(12, 2), prod)
                .query(`UPDATE Ordenes SET Magnitud = @m, CantidadEsperada = @c, Observaciones = CONCAT(ISNULL(Observaciones,''), ' [Parcial aceptado por el cliente: ', @m, ']') WHERE OrdenID = @id`);
            await cerrarSinReposicion(tx, s, userObj, io);
            await setDecision('RESUELTA');
            resultado = { message: `Registrado: el cliente se lleva lo producido. ${s.CodigoMadre} pasa a ${prod} ${String(s.UMMadre || '').trim()} y la falla queda cerrada sin costo.` };
            resultado.recotizar = true;
        } else if (decision === 'VEN_INTERNA') {
            if (s.Tipo !== 'PRODUCTO_LOCAL') throw err400('La VEN interna es solo para productos del local.');
            const ven = await crearVenInterna(tx, s, req.user);
            // La reposición sigue abierta hasta que el producto nuevo llegue al área (como complemento de la madre)
            await new sql.Request(tx).input('rep', sql.Int, s.ReposicionID).input('v', sql.Int, ven.ordenId).query(`UPDATE Reposiciones SET VenOrdenID = @v, OrdenFallaID = @v, Estado = 'EN_PRODUCCION' WHERE ReposicionID = @rep`);
            await setDecision('RESUELTA');
            resultado = { ven, message: `Se creó la ${ven.codigo} interna sin costo para el cliente por ${s.Cantidad != null ? Number(s.Cantidad) : 1} unidad(es). Descuenta stock, no genera deuda ni factura.` };
        }
        await registrarAuditoria(tx, req.user?.id, 'SOLICITUD_INSUMO_DECISION', `Solicitud #${id} (${s.CodigoMadre}) → ${decision} · ${medioConfirmacion}${detalle ? ' · ' + detalle : ''}`, req.ip);
        await tx.commit();

        // Recotización fuera de la transacción (usa el motor de siempre): la orden ya tiene su nueva cantidad.
        if (resultado.recotizar && s.NoDocERP) {
            try {
                const ERPSyncService = require('../services/erpSyncService');
                await ERPSyncService.syncFinalOrderIntegration(s.NoDocERP, req.user?.id || 1, req.user?.username || 'Sistema', null, { userNotes: `Parcial aceptado por el cliente en ${s.CodigoMadre}` });
                const ped = (await pool.request().input('d', sql.VarChar, s.NoDocERP).query(`SELECT TOP 1 ID, Moneda FROM PedidosCobranza WHERE NoDocERP = @d ORDER BY ID DESC`)).recordset[0];
                if (ped) {
                    const tc = await libro.getConfigValor('TIPO_CAMBIO_USD', '40', pool);
                    const { propagarCotizacionADeposito } = require('./quotationController');
                    if (propagarCotizacionADeposito) await propagarCotizacionADeposito(pool, { pedidoId: ped.ID, monedaFinal: ped.Moneda || 'UYU', cotizacion: tc });
                }
                resultado.message += ' La cotización se recalculó con el mismo precio unitario.';
            } catch (eCot) {
                logger.error('[solicitudes] recotización parcial aceptado:', eCot.message);
                resultado.message += ` ATENCIÓN: la recotización automática falló (${eCot.message}); revisala desde Cotizar.`;
            }
        }
        res.json({ success: true, decision, ...resultado });
    } catch (err) {
        if (tx) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } }
        logger.error('[solicitudes] decidir:', err);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
};

/**
 * VEN interna (RN-FLT.10, producto del local): mismo molde que crearVentaTienda (tiendaController) —
 * cabecera PedidosCobranza + detalle + orden ancla en PRO — pero a precio 0, Origen 'REPOSICION' y con
 * la ancla apuntando al área que reportó (viaja como complemento de la madre). Descuenta stock, no
 * genera deuda ni factura.
 */
async function crearVenInterna(tx, s, user) {
    const maxResult = await new sql.Request(tx).query(`SELECT ISNULL(MAX(CAST(SUBSTRING(NoDocERP, 5, LEN(NoDocERP)) AS INT)), 0) + 1 as NextID FROM PedidosCobranza WHERE NoDocERP LIKE 'VEN-%'`);
    const codigo = `VEN-${String(maxResult.recordset[0].NextID).padStart(4, '0')}`;
    const cantidad = s.Cantidad != null && Number(s.Cantidad) > 0 ? Number(s.Cantidad) : 1;
    let wms = s.WmsVarianteId || null, prod = s.ProIdProducto || null;
    // [VENTA/COMBO] Qué prenda sacar del stock: la de la venta de retiro de LA MISMA prenda que
    // falló (mismo pedido y mismo ComboItemID que la orden madre). Va antes que la búsqueda por
    // pedido de abajo: esa agarra la primera variante cualquiera y, en un pedido con un short y
    // un gorro, podía reponer el gorro cuando se rompió el short.
    if (!wms && s.OrdenMadreID) {
        const a = (await new sql.Request(tx).input('m', sql.Int, s.OrdenMadreID).query(`
            SELECT TOP 1 a.WmsVarianteId, a.ProIdProducto
            FROM Ordenes o
            JOIN Ordenes a ON a.EstadoDependencia = 'VENTA_DIRECTA'
                          AND a.ComboItemID = o.ComboItemID
                          AND LTRIM(RTRIM(a.ComboPedidoNoDocERP)) = LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
                          AND a.WmsVarianteId IS NOT NULL
            WHERE o.OrdenID = @m AND o.ComboItemID IS NOT NULL
            ORDER BY a.OrdenID`)).recordset[0];
        if (a) { wms = a.WmsVarianteId; prod = prod || a.ProIdProducto; }
    }
    if (!wms && s.NoDocERP) {
        const h = (await new sql.Request(tx).input('d', sql.NVarChar, s.NoDocERP).query(`SELECT TOP 1 WmsVarianteId, ProIdProducto FROM Ordenes WHERE RTRIM(NoDocERP) = RTRIM(@d) AND WmsVarianteId IS NOT NULL`)).recordset[0];
        if (h) { wms = h.WmsVarianteId; prod = prod || h.ProIdProducto; }
    }
    if (!prod && wms) {
        // Variante WMS → artículo (misma tabla que usa la tienda)
        const v = (await new sql.Request(tx).input('w', sql.Int, wms).query(`SELECT TOP 1 Idproid FROM Articulos_WMS_Variantes WHERE wms_variante_id = @w`)).recordset[0];
        prod = v?.Idproid || null;
    }
    const cliId = s.CliIdCliente || 2089;
    const head = await new sql.Request(tx)
        .input('NoDocERP', sql.NVarChar, codigo).input('ClienteID', sql.Int, cliId)
        .query(`INSERT INTO PedidosCobranza (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, EstadoCobro, Origen, ModoRetiro)
                OUTPUT INSERTED.ID VALUES (@NoDocERP, @ClienteID, 0, 'UYU', GETDATE(), 'PENDIENTE', 'REPOSICION', 'MOSTRADOR')`);
    const pedidoId = head.recordset[0].ID;
    await new sql.Request(tx).input('P', sql.Int, pedidoId).input('Prod', sql.Int, prod).input('Cod', sql.NVarChar, wms ? String(wms) : 'REPOSICION').input('C', sql.Decimal(18, 2), cantidad)
        .query(`INSERT INTO PedidosCobranzaDetalle (PedidoCobranzaID, OrdenID, ProIdProducto, CodArticulo, Cantidad, PrecioUnitario, Subtotal, Moneda, DatoTecnico, PrecioUnitarioOriginal, SubtotalOriginal, MonedaOriginal)
                VALUES (@P, 1, @Prod, @Cod, @C, 0, 0, 'UYU', 0, 0, 0, 'UYU')`);
    const ins = await new sql.Request(tx)
        .input('Cliente', sql.NVarChar(200), s.Cliente || 'CONSUMIDOR FINAL').input('CliId', sql.Int, cliId)
        .input('Desc', sql.NVarChar(300), `REPOSICIÓN INTERNA POR FALLA · ${s.CodigoMadre} (${cantidad} unidad(es), sin costo para el cliente)`)
        .input('Mat', sql.VarChar(255), 'VENTA WMS').input('Cod', sql.VarChar(50), codigo).input('Mag', sql.VarChar(50), String(cantidad))
        .input('Prod', sql.Int, prod).input('Wms', sql.Int, wms).input('Prox', sql.VarChar(50), String(s.AreaReporta || 'DEPOSITO').trim())
        .input('Madre', sql.Int, s.OrdenMadreID)
        .query(`INSERT INTO Ordenes (AreaID, Cliente, CliIdCliente, DescripcionTrabajo, Prioridad, FechaIngreso, FechaEstimadaEntrega, Material, CodigoOrden, NoDocERP,
                                     Magnitud, ProximoServicio, UM, Estado, EstadoenArea, ProIdProducto, WmsVarianteId, EstadoDependencia, CostoTotal, OrdenOrigenID)
                OUTPUT INSERTED.OrdenID
                VALUES ('PRO', @Cliente, @CliId, @Desc, 'Falla', GETDATE(), DATEADD(day, 1, GETDATE()), @Mat, @Cod, @Cod,
                        @Mag, @Prox, 'u', 'Pendiente', 'Pendiente', @Prod, @Wms, 'VENTA_DIRECTA', 0, @Madre)`);
    return { codigo, pedidoId, ordenId: ins.recordset[0].OrdenID, cantidad };
}

/**
 * POST /solicitudes-insumo/:id/vincular-pre { recepcionId, bobinaId?, prendaId? }
 * La PRE nueva repone la solicitud: recién ahora nace la orden de falla con esa bobina/prenda.
 */
exports.vincularPre = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { recepcionId, bobinaId, prendaId } = req.body || {};
    try {
        const out = await exports.vincularPreInterno({ solicitudId: id, recepcionId, bobinaId, prendaId, user: req.user, ip: req.ip });
        res.json({ success: true, ...out });
    } catch (err) { logger.error('[solicitudes] vincularPre:', err); res.status(err.statusCode || 500).json({ error: err.message }); }
};

/** Reutilizable desde el ingreso de PRE (receptionController). */
exports.vincularPreInterno = async ({ solicitudId, recepcionId, bobinaId, prendaId, user, ip }) => {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, solicitudId).query(`${SQL_SOLICITUD} WHERE s.SolicitudID = @id`);
    if (!r.recordset.length) throw err400('Solicitud no encontrada');
    const s = mapSol(r.recordset[0]);
    if (s.Estado === 'RESUELTA') throw err400(`La solicitud #${solicitudId} ya está resuelta.`);
    let bob = bobinaId || null, pre = prendaId || null;
    if (recepcionId && !bob && s.Tipo === 'TELA_CLIENTE') {
        const b = (await pool.request().input('rid', sql.Int, recepcionId).query(`SELECT TOP 1 ib.BobinaID FROM InventarioBobinas ib JOIN Recepciones rc ON rc.RecepcionID = @rid WHERE ib.Referencia = rc.Codigo OR ib.Referencia LIKE rc.Codigo + '-%' ORDER BY ib.BobinaID`)).recordset[0];
        bob = b?.BobinaID || null;
    }
    if (recepcionId && !pre && s.Tipo === 'PRENDA_CLIENTE') {
        const p = (await pool.request().input('rid', sql.Int, recepcionId).query(`SELECT TOP 1 PrendaClienteID FROM InventarioPrendasCliente WHERE RecepcionID = @rid ORDER BY PrendaClienteID`)).recordset[0];
        pre = p?.PrendaClienteID || null;
    }
    const areasUnidades = await libro.areasQueCuentanUnidades(pool);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        const creadas = await cadena.materializarCadena(tx, s.ReposicionID, { bobinaId: bob, prendaId: pre, areasUnidades, motivoExtra: recepcionId ? `Repone la PRE #${recepcionId}.` : '' });
        await new sql.Request(tx).input('id', sql.Int, solicitudId).input('rid', sql.Int, recepcionId || null).input('bob', sql.Int, bob).input('pre', sql.Int, pre).input('u', sql.Int, user?.id || null)
            .query(`UPDATE SolicitudesInsumo SET Estado = 'RESUELTA', RecepcionID = ISNULL(@rid, RecepcionID), BobinaUsadaID = ISNULL(@bob, BobinaUsadaID), PrendaUsadaID = ISNULL(@pre, PrendaUsadaID),
                    Decision = ISNULL(Decision, 'TRAE_MAS'), UsuarioDecision = ISNULL(UsuarioDecision, @u), FechaDecision = ISNULL(FechaDecision, GETDATE()),
                    DetalleDecision = CONCAT(ISNULL(DetalleDecision,''), 'PRE vinculada. ') WHERE SolicitudID = @id`);
        await registrarAuditoria(tx, user?.id, 'SOLICITUD_INSUMO_PRE', `Solicitud #${solicitudId} (${s.CodigoMadre}) resuelta con PRE ${recepcionId || '-'}: ${creadas.map(c => c.codigo).join(', ')}`, ip);
        await tx.commit();
        return { creadas, message: `Se creó ${creadas.map(c => c.codigo).join(' y ')} con el insumo nuevo. La solicitud #${solicitudId} pasa a Resuelta; ${s.CodigoReporta || s.CodigoMadre} se libera cuando llegue la reposición.` };
    } catch (e) { await tx.rollback(); throw e; }
};

/** GET /solicitudes-insumo/abiertas-cliente?clienteId= — para el ingreso de PRE ("¿repone una solicitud abierta?") */
exports.abiertasCliente = async (req, res) => {
    try {
        const { clienteId } = req.query;
        const pool = await getPool();
        const r = await pool.request().input('c', sql.NVarChar, String(clienteId || '').trim()).query(`${SQL_SOLICITUD}
            WHERE s.Estado <> 'RESUELTA' AND (CAST(m.CliIdCliente AS NVARCHAR(50)) = @c OR LTRIM(RTRIM(m.CodCliente)) = @c OR @c = '')
            ORDER BY s.FechaCreacion DESC`);
        res.json(r.recordset.map(mapSol));
    } catch (err) { res.status(500).json({ error: err.message }); }
};

/** Job diario: solicitudes vencidas sin respuesta → SIN_RESPUESTA (para que Administración las resuelva). */
exports.marcarVencidas = async () => {
    const pool = await getPool();
    const r = await pool.request().query(`UPDATE SolicitudesInsumo SET Estado = 'SIN_RESPUESTA' OUTPUT INSERTED.SolicitudID WHERE Estado IN ('NUEVA','NOTIFICADA') AND Tipo <> 'PRODUCTO_LOCAL' AND Vencimiento IS NOT NULL AND Vencimiento < GETDATE()`);
    return r.recordset.map(x => x.SolicitudID);
};
