const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const devolucionSvc = require('../services/telaClienteDevolucionFisicaService');

// ====================================================================
// MÓDULO: Tela Cliente — Gestión centralizada de metros por cliente
// Análogo a la "Billetera" pero para metros de tela física
// ====================================================================

// ─────────────────────────────────────────────────────────────────────
// 1. SALDO DE METROS POR TIPO DE TELA
//    GET /api/tela-cliente/:clienteId/saldo
// ─────────────────────────────────────────────────────────────────────
exports.getSaldo = async (req, res) => {
    const { clienteId } = req.params;
    if (!clienteId) return res.status(400).json({ error: 'clienteId requerido' });

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('ClienteID', sql.NVarChar(255), clienteId)
            .query(`
                SELECT
                    ib.InsumoID,
                    ins.Nombre                                                        AS InsumoNombre,
                    -- Descripcion real del tipo de tela (ej: "Seda Americana")
                    -- Se saca del Detalle de la Recepcion vinculada via Referencia
                    COALESCE(
                        NULLIF(
                            -- Quitar prefijo "TELA: " si existe
                            CASE WHEN r.Detalle LIKE 'TELA:%'
                                 THEN LTRIM(SUBSTRING(r.Detalle, 7, 500))
                                 ELSE r.Detalle
                            END,
                        ''),
                        lb.Descripcion,
                        ins.Nombre
                    )                                                                 AS TipoTela,
                    COUNT(DISTINCT ib.BobinaID)                                       AS CantidadBultos,
                    SUM(ib.MetrosIniciales)                                           AS MetrosIngresados,
                    -- Disponible real: solo bobinas activas (una Agotada puede tener un
                    -- remanente físico de merma que no es usable)
                    SUM(CASE WHEN ib.Estado IN ('Disponible', 'En Uso')
                            THEN ib.MetrosRestantes ELSE 0 END)                      AS MetrosDisponibles,
                    -- Consumo: una bobina AGOTADA se cuenta entera. Su remanente es merma no
                    -- usable y MetrosDisponibles ya la excluye (ver arriba); si el consumo
                    -- descontara ese resto, al cliente le quedaban metros sin explicación
                    -- (ingresados 10,00 − consumidos 9,90 = 0,10, pero disponibles 0,00).
                    -- Solo aplica a 'Agotado': 'Pendiente' no está consumida, está por recibirse.
                    SUM(CASE WHEN ib.Estado = 'Agotado' THEN ib.MetrosIniciales
                             ELSE ib.MetrosIniciales - ib.MetrosRestantes END)        AS MetrosConsumidos,
                    CAST(
                        100.0 * SUM(CASE WHEN ib.Estado = 'Agotado' THEN ib.MetrosIniciales
                                         ELSE ib.MetrosIniciales - ib.MetrosRestantes END)
                        / NULLIF(SUM(ib.MetrosIniciales), 0)
                    AS DECIMAL(5,2))                                                  AS PorcentajeConsumido,
                    SUM(CASE WHEN ib.Estado = 'En Uso'
                            THEN ib.MetrosRestantes ELSE 0 END)                      AS MetrosEnProceso,
                    SUM(CASE WHEN ib.Estado = 'Disponible'
                            THEN ib.MetrosRestantes ELSE 0 END)                      AS MetrosLibres,
                    MAX(ib.FechaIngreso)                                              AS UltimoIngreso
                FROM InventarioBobinas ib
                JOIN Insumos ins
                    ON ib.InsumoID = ins.InsumoID
                -- Traer descripcion del bulto logistico (tiene "TELA: Seda Americana")
                LEFT JOIN Logistica_Bultos lb
                    ON lb.CodigoEtiqueta = ib.Referencia
                    OR lb.RecepcionID   = (
                        SELECT TOP 1 RecepcionID FROM Recepciones
                        WHERE Codigo = ib.Referencia OR Codigo + '-1' = ib.Referencia
                    )
                -- Traer la recepcion vinculada para el Detalle
                LEFT JOIN Recepciones r
                    ON r.Codigo = ib.Referencia
                    OR r.Codigo = LEFT(ib.Referencia, LEN(ib.Referencia) - 2)  -- PRE-5 <- PRE-5-1
                -- Incluye Agotado/Cerrado: la tela consumida sigue siendo historia del
                -- cliente (antes desaparecía del saldo al agotarse, como si nunca hubiera
                -- entrado — los metros ingresados/consumidos quedaban invisibles).
                WHERE ib.ClienteID = @ClienteID
                GROUP BY
                    ib.InsumoID,
                    ins.Nombre,
                    COALESCE(
                        NULLIF(
                            CASE WHEN r.Detalle LIKE 'TELA:%'
                                 THEN LTRIM(SUBSTRING(r.Detalle, 7, 500))
                                 ELSE r.Detalle
                            END,
                        ''),
                        lb.Descripcion,
                        ins.Nombre
                    )
                ORDER BY UltimoIngreso DESC
            `);

        res.json({ success: true, saldos: result.recordset, data: result.recordset });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error getSaldo:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────
// 2. ESTADO DE CUENTA COMPLETO (extracto tipo bancario)
//    GET /api/tela-cliente/:clienteId/estado-cuenta
//    Query: ?desde=YYYY-MM-DD &hasta=YYYY-MM-DD &insumoId=N &tipo=INGRESO
// ─────────────────────────────────────────────────────────────────────
exports.getEstadoCuenta = async (req, res) => {
    const { clienteId } = req.params;
    const { desde, hasta, insumoId, tipo } = req.query;

    try {
        const pool = await getPool();
        const request = pool.request()
            .input('ClienteID', sql.NVarChar(255), clienteId);

        let filtros = '';
        if (desde) { request.input('Desde', sql.DateTime, new Date(desde)); filtros += ' AND mi.FechaMovimiento >= @Desde'; }
        if (hasta) { request.input('Hasta', sql.DateTime, new Date(hasta + 'T23:59:59')); filtros += ' AND mi.FechaMovimiento <= @Hasta'; }
        if (insumoId) { request.input('InsumoID', sql.Int, parseInt(insumoId)); filtros += ' AND mi.InsumoID = @InsumoID'; }
        if (tipo) { request.input('Tipo', sql.VarChar(50), tipo); filtros += ' AND mi.TipoMovimiento = @Tipo'; }

        const { tela } = req.query;
        if (tela) { request.input('Tela', sql.NVarChar(200), `%${tela}%`); filtros += ' AND (ib.DescripcionTela LIKE @Tela OR ins.Nombre LIKE @Tela)'; }

        // La última solicitud de devolución/descarte de cada bulto: el portal muestra «Devolución pedida»
        // en vez del botón (antes dejaba pedir otra y el servicio la rechazaba), o el motivo si se rechazó.
        await devolucionSvc.ensureSchema(pool);

        const result = await request.query(`
            SELECT
                mi.MovimientoID,
                mi.FechaMovimiento,
                mi.TipoMovimiento,
                mi.Cantidad,
                -- Mostrar el CodigoOrden (SUB-13625) y no el OrdenID interno (14598):
                -- las refs viejas quedaron guardadas con el ID interno, se traduce al leer.
                CASE WHEN o.CodigoOrden IS NOT NULL
                          AND mi.Referencia LIKE 'Consumo Orden ' + CAST(mi.OrdenID AS VARCHAR(20)) + ' %'
                     THEN REPLACE(mi.Referencia,
                                  'Consumo Orden ' + CAST(mi.OrdenID AS VARCHAR(20)),
                                  'Consumo Orden ' + LTRIM(RTRIM(o.CodigoOrden)))
                     ELSE mi.Referencia
                END                                                         AS Referencia,
                ib.BobinaID,
                ib.CodigoEtiqueta                                           AS Bulto,
                ib.MetrosIniciales                                          AS MetrosIniciales,
                ib.Ancho                                                    AS Ancho,
                ib.Peso                                                     AS Peso,
                ib.MetrosRestantes                                          AS SaldoBulto,
                ib.Estado                                                   AS EstadoBulto,
                COALESCE(NULLIF(ib.DescripcionTela,''), ins.Nombre)         AS TipoTela,
                ib.Referencia                                               AS ReferenciaOrden,
                ins.InsumoID,
                r.Codigo                                                    AS CodigoRecepcion,
                r.FechaRecepcion                                            AS FechaRecepcion,
                u.Nombre                                                    AS Operario,
                sol.SolicitudTevID, sol.SolicitudAccion, sol.SolicitudFecha, sol.SolicitudEstado,
                CASE WHEN sol.SolicitudEstado = 'RECHAZADA' THEN sol.SolicitudMotivo END    AS SolicitudMotivo
            FROM MovimientosInsumos mi
            JOIN InventarioBobinas ib   ON mi.BobinaID  = ib.BobinaID
            JOIN Insumos ins            ON mi.InsumoID  = ins.InsumoID
            LEFT JOIN Recepciones r     ON ib.Referencia LIKE r.Codigo + '%'
            LEFT JOIN Usuarios u        ON mi.UsuarioID = u.IdUsuario
            LEFT JOIN Ordenes o         ON mi.OrdenID   = o.OrdenID
            -- La última solicitud del bulto, en el estado que esté: abierta (PENDIENTE/APROBADA) el portal
            -- muestra «Devolución pedida»; RECHAZADA, el motivo (al cliente se lo avisa también por push).
            OUTER APPLY (
                SELECT TOP 1 e.TevID AS SolicitudTevID, e.Accion AS SolicitudAccion, e.FechaCreacion AS SolicitudFecha,
                       e.Estado AS SolicitudEstado, e.Observaciones AS SolicitudMotivo
                FROM dbo.TelaClienteEventos e WITH(NOLOCK)
                WHERE e.BobinaID = ib.BobinaID AND e.Tipo = 'SOLICITUD_CLIENTE'
                ORDER BY e.TevID DESC
            ) sol
            WHERE ib.ClienteID = @ClienteID
            ${filtros}
            ORDER BY mi.FechaMovimiento DESC
        `);


        // Calcular saldo acumulado (running balance) por bobina.
        // OJO: antes se acumulaba por InsumoID, pero varias bobinas del cliente
        // comparten insumo genérico y el saldo de una contaminaba a la otra
        // (ej: BOB-97 mostraba 67.55 en vez de 67.45 por los 0.10 de BOB-93).
        const rows = result.recordset;
        const saldoAcum = {};
        // Recorremos de más antiguo a más reciente para acumular.
        // La Cantidad ya se guarda con signo (consumos en negativo, devoluciones e ingresos
        // en positivo) — se suma tal cual. El "todo lo no-INGRESO resta en valor absoluto"
        // de antes daba vuelta las DEVOLUCION_CANCELACION y el acumulado terminaba en
        // negativo (-37.86 con saldo real 0.70). La lista EGRESOS queda solo como guarda
        // para movimientos viejos de consumo/merma que hayan quedado guardados sin signo.
        const EGRESOS = ['CONSUMO_PRODUCCION', 'CONSUMO_ORDEN', 'MERMA_REIMPRESION', 'AJUSTE_DESECHO'];
        [...rows].reverse().forEach(r => {
            const key = r.BobinaID;
            if (!saldoAcum[key]) saldoAcum[key] = 0;
            const qty = parseFloat(r.Cantidad || 0);
            if (EGRESOS.includes(r.TipoMovimiento)) saldoAcum[key] -= Math.abs(qty);
            else saldoAcum[key] += qty;
            r.SaldoAcumulado = parseFloat(saldoAcum[key].toFixed(2));
        });

        res.json({ success: true, data: rows, total: rows.length });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error getEstadoCuenta:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────
// 6. DEVOLUCIÓN FÍSICA DE EXCEDENTE — solicitar / bandeja / empaquetar
//    Ver backend/services/telaClienteDevolucionFisicaService.js
// ─────────────────────────────────────────────────────────────────────

// POST /api/tela-cliente/:clienteId/bobinas/:bobinaId/solicitar
// Body: { accion: 'DEVOLVER'|'DESCARTAR', observaciones? }
// El canal (Retiro/Encomienda) y la dirección de envío ya NO se piden acá — se
// definen recién cuando el cliente retira de verdad, por el circuito normal de
// retiros (portal/tótem/WebRetirosPage), igual que cualquier otra orden.
// Usable desde la vista interna de la bobina Y (delegado) desde el portal.
exports.solicitarDevolucion = async (req, res) => {
    const { clienteId, bobinaId } = req.params;
    const { accion, observaciones, origen } = req.body;
    const usuarioId = req.user?.id || null;

    try {
        const pool = await getPool();
        const { tevId } = await devolucionSvc.solicitarDevolucion(pool, {
            clienteId, bobinaId, accion, observaciones,
            origen: origen || (req.user?.role === 'WEB_CLIENT' ? 'PORTAL' : 'INTERNO'),
            usuarioId,
        });
        res.status(201).json({ success: true, tevId });
    } catch (err) {
        // Los controles del servicio (solicitud repetida, bobina agotada...) traen su código: son avisos.
        if (err.statusCode) {
            logger.warn(`[TELA-CLIENTE] Solicitud de devolución rechazada (bobina ${bobinaId}, cliente ${clienteId}, usuario ${usuarioId ?? '-'}): ${err.message}`);
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('[TELA-CLIENTE] Error solicitarDevolucion:', err);
        res.status(500).json({ error: err.message });
    }
};

// GET /api/tela-cliente/bandeja?estado=PENDIENTE
exports.getBandeja = async (req, res) => {
    try {
        const pool = await getPool();
        const data = await devolucionSvc.listarBandeja(pool, { estado: req.query.estado });
        res.json({ success: true, data });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error getBandeja:', err);
        res.status(500).json({ error: err.message });
    }
};

// GET /api/tela-cliente/bandeja/para-empaquetar
exports.getParaEmpaquetar = async (req, res) => {
    try {
        const pool = await getPool();
        const data = await devolucionSvc.listarParaEmpaquetar(pool);
        res.json({ success: true, data });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error getParaEmpaquetar:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/tela-cliente/bandeja/:tevId/aprobar
exports.aprobarEvento = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await devolucionSvc.aprobarSolicitud(pool, { tevId: req.params.tevId, usuarioId: req.user?.id });
        res.json({ success: true, ...r });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error aprobarEvento:', err);
        res.status(400).json({ error: err.message });
    }
};

// POST /api/tela-cliente/bandeja/:tevId/rechazar
exports.rechazarEvento = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await devolucionSvc.rechazarSolicitud(pool, { tevId: req.params.tevId, usuarioId: req.user?.id, motivo: req.body?.motivo });
        res.json({ success: true, ...r });
    } catch (err) {
        if (err.statusCode) {
            logger.warn(`[TELA-CLIENTE] Rechazo de la solicitud #${req.params.tevId} no aplicado: ${err.message}`);
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('[TELA-CLIENTE] Error rechazarEvento:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/tela-cliente/bandeja/:tevId/entregada — la tela se le dio en mano al cliente
// Body: { nota? }
exports.marcarEntregada = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await devolucionSvc.marcarEntregada(pool, { tevId: req.params.tevId, usuarioId: req.user?.id, nota: req.body?.nota });
        logger.info(`[TELA-CLIENTE] Solicitud #${req.params.tevId} marcada como entregada en mano por el usuario ${req.user?.id ?? '-'}${r.bobinaCerrada ? ' (bobina cerrada)' : ''}.`);
        res.json({ success: true, ...r });
    } catch (err) {
        if (err.statusCode) {
            logger.warn(`[TELA-CLIENTE] «Ya se entregó» no aplicado a la solicitud #${req.params.tevId}: ${err.message}`);
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('[TELA-CLIENTE] Error marcarEntregada:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/tela-cliente/bandeja/:tevId/empaquetar
exports.empaquetarDevolucion = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await devolucionSvc.empaquetarDevolucion(pool, {
            tevId: req.params.tevId,
            usuarioId: req.user?.id,
            userName: req.user?.name || req.user?.username,
        });
        res.json({ success: true, ...r });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error empaquetarDevolucion:', err);
        res.status(400).json({ error: err.message });
    }
};

// POST /api/tela-cliente/bandeja/:tevId/marcar-enviado  (aviso de excedente, tras contactar por Callbell)
exports.marcarAvisoEnviado = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await devolucionSvc.marcarAvisoEnviado(pool, { tevId: req.params.tevId, usuarioId: req.user?.id });
        res.json({ success: true, ...r });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error marcarAvisoEnviado:', err);
        res.status(400).json({ error: err.message });
    }
};
