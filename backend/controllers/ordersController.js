const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const pushService = require('../services/pushNotificationService');
const { changeOrderState } = require('../services/stateManagerService');

// Capas del arte TPU: son EXACTAMENTE estas, ni una más ni una menos. Al subir funciona como
// tope (se cargan de a poco) y al mandar a producción se exige el número justo.
const CAPAS_ARTE_TPU = 5;

// HELPER: Recalcular Magnitud de la Orden (Suma de piezas de Archivos + Servicios)
// Se usa en add, update, delete y cancel para mantener la coherencia.
const recalculateOrderMagnitude = async (transaction, ordenId) => {
    if (!ordenId) return;
    try {
        // TPU queda AFUERA del recálculo: su Magnitud es la CANTIDAD PEDIDA (unidades a producir),
        // fijada al crear el pedido. Sus archivos son las capas del arte (boceto, cmyk, corte...),
        // no unidades — recalcular desde ahí pisaba la cantidad (borrar el boceto la dejaba en 0,
        // subir las capas del arte la convertía en el número de capas) y encima disparaba la
        // recotización con ese número.
        const areaRes = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query('SELECT AreaID FROM dbo.Ordenes WHERE OrdenID = @OID');
        if (String(areaRes.recordset[0]?.AreaID || '').trim().toUpperCase() === 'TPU') return;

        await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`
                DECLARE @UM NVARCHAR(20);
                SELECT @UM = LTRIM(RTRIM(ISNULL(UM, 'u'))) FROM dbo.Ordenes WHERE OrdenID = @OID;

                DECLARE @Total FLOAT = 0;

                -- Si la unidad es metros (m, m2, ml, etc.) sumamos Metros × Copias; si no, sumamos Copias.
                -- Metros es el valor POR COPIA (FileItem muestra Total = Metros × Copias), por lo que la
                -- magnitud real debe multiplicar por Copias, igual que al crear la orden
                -- (integrationOrdersController: totalMagnitud += valMetros * safeCopies).
                IF LEFT(LOWER(@UM), 1) = 'm'
                BEGIN
                    SELECT @Total = @Total + ISNULL(SUM(CAST(ISNULL(Metros, 0) AS FLOAT) * CAST(ISNULL(Copias, 1) AS FLOAT)), 0)
                    FROM dbo.ArchivosOrden
                    WHERE OrdenID = @OID AND ISNULL(EstadoArchivo, '') != 'CANCELADO';
                END
                ELSE
                BEGIN
                    SELECT @Total = @Total + ISNULL(SUM(CAST(ISNULL(Copias, 0) AS FLOAT)), 0)
                    FROM dbo.ArchivosOrden
                    WHERE OrdenID = @OID AND ISNULL(EstadoArchivo, '') != 'CANCELADO';
                END

                -- Servicios extra (terminaciones: ojales, soldaduras...): NO se suman a la
                -- magnitud cuando la orden tiene archivos. Son unidades, no metros — sumarlos
                -- inflaba la magnitud (3,32 m² + 11 ojales = 14,32 "m²") y el motor cotizaba
                -- el material por esa cifra. Cada servicio ya se cobra en su propia línea.
                -- Solo son la magnitud si la orden NO tiene archivos (orden de solo servicios),
                -- para que no quede en 0.
                IF @Total = 0
                BEGIN
                    SELECT @Total = ISNULL(SUM(CAST(ISNULL(Cantidad, 0) AS FLOAT)), 0)
                    FROM dbo.ServiciosExtraOrden
                    WHERE OrdenID = @OID;
                END

                -- Guardar solo el número, sin sufijo de unidad (la columna UM ya tiene la unidad)
                UPDATE dbo.Ordenes
                SET Magnitud = CAST(FORMAT(@Total, '0.##') AS NVARCHAR(20))
                WHERE OrdenID = @OID;
            `);
    } catch (e) {
        logger.error("❌ Error recalculateOrderMagnitude:", e.message);
    }
};

// HELPER: Re-cotiza el pedido tras un cambio de magnitud/cantidad de una orden.
// Reconstruye PedidosCobranza + PedidosCobranzaDetalle (Subtotal/importe) y el MontoTotal
// del pedido usando el motor de precios (misma vía que usa el flujo de cancelación).
// Se usa onlyCalculate:true → PERSISTE la cotización pero NO empuja a ERP/REACT ni escribe
// en OrdenesDeposito (evita efectos externos al editar la medida desde el detalle de orden).
// Debe llamarse DESPUÉS de commitear la transacción (lee datos ya persistidos y escribe por su cuenta).
const recotizarPedidoDeOrden = async (pool, ordenId, userId = 1, userName = 'Sistema') => {
    if (!ordenId) return;
    try {
        const docRes = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query('SELECT NoDocERP FROM dbo.Ordenes WHERE OrdenID = @OID');
        const noDocERP = docRes.recordset[0]?.NoDocERP;
        if (!noDocERP || !noDocERP.toString().trim()) {
            logger.warn(`[Recotizar] Orden ${ordenId} sin NoDocERP; se omite recotización de cobranza.`);
            return;
        }
        const ERPSyncService = require('../services/erpSyncService');
        await ERPSyncService.syncFinalOrderIntegration(
            noDocERP.toString().trim(),
            parseInt(userId) || 1,
            String(userName || 'Sistema').substring(0, 99),
            null,
            { onlyCalculate: true }
        );
        logger.info(`[Recotizar] ✅ Cotización/importe actualizados para pedido ${noDocERP} (orden ${ordenId}).`);
    } catch (e) {
        logger.error('[Recotizar] ❌ Error recotizando pedido tras cambio de magnitud:', e.message);
    }
};
// Se exporta para reusarlo desde otras áreas que cambian cantidades cobrables
// (ej. Terminaciones confirma las magnitudes reales del trabajo).
exports.recotizarPedidoDeOrden = recotizarPedidoDeOrden;

// =====================================================================
// =====================================================================
// SUBIR ARCHIVO DE PRODUCCIÓN (PDF) A UNA ORDEN EXISTENTE
// Uso interno (ej. arte final de TPU). Inserta la fila en ArchivosOrden,
// sube el binario a Drive y genera el thumbnail (misma maquinaria que la web).
// =====================================================================
exports.uploadProductionFile = async (req, res) => {
    const { ordenId } = req.params;
    const file = req.file;
    const fs = require('fs');
    if (!file || !ordenId) return res.status(400).json({ error: "Falta archivo u orden." });

    const nombreLower = (file.originalname || '').toLowerCase();
    const esValido = (file.mimetype || '').toLowerCase().includes('pdf') || nombreLower.endsWith('.pdf') || nombreLower.endsWith('.plt');
    if (!esValido) {
        if (file.path) { try { fs.unlinkSync(file.path); } catch (_) {} }
        return res.status(400).json({ error: "Solo se permiten archivos PDF o PLT." });
    }

    const tmpPath = file.path || null;
    try {
        const driveService = require('../services/driveService');
        const { generateThumbnail } = require('../utils/thumbnailGenerator');
        const pool = await getPool();

        await require('./webOrdersController').ensureColFechaAprobacion(pool);
        const ordRes = await pool.request()
            .input('OID', sql.Int, parseInt(ordenId))
            .query('SELECT OrdenID, CodigoOrden, AreaID, Nota, FechaAprobacionCliente FROM Ordenes WHERE OrdenID = @OID');
        if (!ordRes.recordset.length) return res.status(404).json({ error: "Orden no encontrada." });
        const orden = ordRes.recordset[0];

        // Se cuentan las CAPAS DE ARTE, sin el boceto: el boceto es lo que el cliente aprobó, no
        // es arte, y vive en la pestaña de referencias. Contándolo, el tope de 5 se comía una capa.
        const cntRes = await pool.request()
            .input('OID', sql.Int, orden.OrdenID)
            .query(`SELECT COUNT(*) AS n FROM ArchivosOrden
                    WHERE OrdenID = @OID AND ISNULL(EstadoArchivo,'') <> 'Cancelado'
                      AND LOWER(NombreArchivo) NOT LIKE '%boceto%'`);
        const nArchivos = cntRes.recordset[0]?.n || 0;
        const finalName = file.originalname;

        // TPU en dos fases. Antes de la aprobación del cliente solo existe UNA subida válida: el
        // BOCETO DE PRODUCCIÓN (PDF con 'boceto' en el nombre). Las otras capas del arte recién se
        // suben con el pedido aprobado. El reuso [REUSO-REGEN] no pasa por aprobación: sube las
        // capas directo, así que queda exento.
        const esTPUOrden = String(orden.AreaID || '').toUpperCase() === 'TPU';
        const esReusoTPU = /\[REUSO-REGEN\]/i.test(orden.Nota || '');
        if (esTPUOrden && !esReusoTPU && !orden.FechaAprobacionCliente) {
            if (nArchivos >= 1) {
                return res.status(400).json({ error: 'Ya hay un boceto de producción cargado. Envialo a aprobación del cliente (si está mal, borralo y subí otro).' });
            }
            if (!/boceto/i.test(finalName)) {
                return res.status(400).json({ error: 'Antes de la aprobación solo se sube el BOCETO DE PRODUCCIÓN: el nombre del archivo debe incluir "boceto".' });
            }
            if (!(file.mimetype || '').toLowerCase().includes('pdf') && !nombreLower.endsWith('.pdf')) {
                return res.status(400).json({ error: 'El boceto de producción debe ser un PDF (es lo que el cliente ve y el visor 3D rasteriza).' });
            }
        } else if (nArchivos >= CAPAS_ARTE_TPU) {
            // El arte son CAPAS_ARTE_TPU capas exactas (sin contar cancelados). Acá es un tope
            // porque se suben de a poco; el "ni una menos" se exige al mandar a producción.
            return res.status(400).json({ error: `La orden ya tiene ${CAPAS_ARTE_TPU} archivos de arte (son ${CAPAS_ARTE_TPU}, ni más ni menos).` });
        }

        // 1. INSERT fila ArchivosOrden (ruta pendiente hasta que suba a Drive)
        const insRes = await pool.request()
            .input('OID', sql.Int, orden.OrdenID)
            .input('Nom', sql.NVarChar(255), finalName)
            .query(`
                INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, TipoArchivo, Copias, EstadoArchivo, FechaSubida)
                OUTPUT INSERTED.ArchivoID
                VALUES (@OID, @Nom, 'Impresion', 1, 'Pendiente', GETDATE())
            `);
        const archivoId = insRes.recordset[0].ArchivoID;

        // 2. Subir binario a Drive
        const fileInput = tmpPath ? fs.createReadStream(tmpPath) : file.buffer;
        const driveUrl = await driveService.uploadToDrive(fileInput, finalName, orden.AreaID || 'GENERAL');

        // 3. UPDATE ruta
        await pool.request()
            .input('ID', sql.Int, archivoId)
            .input('Url', sql.VarChar(500), driveUrl)
            .query('UPDATE ArchivosOrden SET RutaAlmacenamiento = @Url, FechaSubida = GETDATE() WHERE ArchivoID = @ID');

        // 4. Thumbnail (PDF → 1ª página) en background, fire-and-forget
        try {
            const buffer = tmpPath ? await fs.promises.readFile(tmpPath) : file.buffer;
            if (buffer) generateThumbnail(buffer, orden.CodigoOrden, archivoId, finalName).catch(e => logger.warn('[uploadProductionFile] thumb: ' + e.message));
        } catch (e) { logger.warn('[uploadProductionFile] thumb read: ' + e.message); }

        // TPU: con la ÚLTIMA capa del arte la orden queda lista para fabricar. El estado de área
        // pasa a 'Diseñado' — que cuelga de Producción, así que el general salta solo y el tablero
        // deja de pulsar. `nArchivos` es el conteo previo a este INSERT (sin el boceto).
        // El reuso va por `esReusoTPU`, igual que el gate de arriba: nunca tiene fecha de aprobación
        // (el diseño ya lo aprobó el cliente en la orden original), así que exigirla lo dejaba
        // clavado en Pendiente con las 5 capas subidas.
        if (esTPUOrden && (orden.FechaAprobacionCliente || esReusoTPU) && (nArchivos + 1) === CAPAS_ARTE_TPU) {
            const tx = new sql.Transaction(pool);
            await tx.begin();
            try {
                await changeOrderState(tx, {
                    target : { type: 'ORDER', id: orden.OrdenID },
                    estado : 'Diseñado',
                    userObj: req.user || 'Sistema',
                    detalle: `Arte completo (${CAPAS_ARTE_TPU} capas) — lista para asignar a un lote`,
                    io     : req.app.get('socketio'),
                });
                await tx.commit();
            } catch (e) {
                await tx.rollback();
                // El archivo ya se subió: que falle el cambio de estado no puede tirar abajo la subida.
                logger.error('[uploadProductionFile] No se pudo pasar la orden a Para Imprimir: ' + e.message);
            }
        }

        logger.info(`[uploadProductionFile] Orden ${orden.CodigoOrden}: +archivo ${finalName} (ArchivoID ${archivoId})`);
        res.json({ success: true, archivoId, nombre: finalName, url: driveUrl });
    } catch (err) {
        logger.error('[uploadProductionFile] ' + err.message);
        res.status(500).json({ error: err.message });
    } finally {
        if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
    }
};

// =====================================================================
// TPU: ENVIAR A APROBACIÓN DEL CLIENTE
// Retiene la orden (AprobacionPendiente=1, Estado='Cargando...') hasta que el cliente
// apruebe el BOCETO. Es el inverso de aprobarPedido (webOrdersController), que valida
// AprobacionPendiente=1 AND Estado='Cargando...' y la reactiva a 'Pendiente'.
// =====================================================================
exports.enviarAprobacionTPU = async (req, res) => {
    const ordenId = parseInt(req.params?.ordenId || req.body?.ordenId);
    if (!ordenId) return res.status(400).json({ error: 'Falta ordenId.' });
    try {
        const pool = await getPool();
        await require('./webOrdersController').ensureColFechaAprobacion(pool);
        const check = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                SELECT o.OrdenID, o.AreaID, o.Estado, o.Nota, o.RolloID, o.FechaAprobacionCliente, o.AprobacionPendiente,
                       (SELECT COUNT(*) FROM ArchivosOrden ao
                          WHERE ao.OrdenID = o.OrdenID AND ISNULL(ao.EstadoArchivo,'') <> 'Cancelado') AS archivos,
                       (SELECT COUNT(*) FROM ArchivosOrden ao
                          WHERE ao.OrdenID = o.OrdenID AND ISNULL(ao.EstadoArchivo,'') <> 'Cancelado'
                            AND LOWER(ao.NombreArchivo) LIKE '%boceto%') AS bocetos
                FROM Ordenes o WHERE o.OrdenID = @OID
            `);
        if (!check.recordset.length) return res.status(404).json({ error: 'Orden no encontrada.' });
        const o = check.recordset[0];
        if (String(o.AreaID || '').toUpperCase() !== 'TPU') return res.status(400).json({ error: 'Solo aplica a órdenes TPU.' });

        // Reuso de matriz con cantidad distinta ([REUSO-REGEN]): el diseño ya está aprobado, así que al
        // completar las capas regeneradas la orden entra DIRECTO a producción, sin aprobación del cliente.
        const esReuso = /\[REUSO-REGEN\]/i.test(o.Nota || '');

        if (esReuso) {
            // El reuso NO pasa por el cliente: entra directo a fabricar, así que el arte tiene que
            // estar completo (las capas regeneradas para la cantidad nueva).
            const capasArte = (o.archivos || 0) - (o.bocetos || 0); // el boceto no es una capa de arte
            if (capasArte !== CAPAS_ARTE_TPU) {
                return res.status(400).json({ error: `Se necesitan exactamente ${CAPAS_ARTE_TPU} archivos de arte para enviar a producción (hay ${capasArte}).` });
            }
            if (String(o.Estado || '') !== 'Cargando...') return res.status(400).json({ error: 'La orden ya está en producción.' });
            // Activar directo a producción (sin aprobación del cliente).
            const { changeOrderState } = require('../services/stateManagerService');
            const tx = new sql.Transaction(pool);
            await tx.begin();
            try {
                await changeOrderState(tx, {
                    target : { type: 'ORDER', id: ordenId },
                    estado : 'Pendiente',
                    userObj: req.user || 'Sistema',
                    detalle: 'Arte regenerado (reuso de matriz) — a producción sin aprobación',
                    guard  : "Estado = 'Cargando...'",
                    io     : req.app.get('socketio'),
                });
                await tx.commit();
            } catch (e) { await tx.rollback(); throw e; }
            try {
                const io = req.app.get('socketio');
                if (io) io.emit('server:ordersUpdated', { count: 1, source: 'tpu-reuso-a-produccion' });
            } catch (_) {}
            logger.info(`[TPU] Orden ${ordenId} (reuso) enviada directo a producción sin aprobación.`);
            return res.json({ success: true, aProduccion: true });
        }

        // Una vez que el cliente aprobó, no hay vuelta atrás por este botón: re-enviar a aprobación
        // retendría una orden que ya está en producción (Estado='Cargando...' la saca del flujo,
        // incluso estando en un lote).
        if (o.FechaAprobacionCliente) {
            return res.status(400).json({ error: 'El cliente ya aprobó este pedido: no se puede volver a enviar a aprobación.' });
        }
        if (o.RolloID != null) {
            return res.status(400).json({ error: 'La orden ya está asignada a un lote: no se puede enviar a aprobación.' });
        }

        // Lo único que el cliente aprueba es el BOCETO (un PDF con 'boceto' en el nombre, que se
        // muestra en Archivos de Referencia). Las otras capas del arte se suben DESPUÉS de que
        // apruebe, ya en producción — por eso acá no se exigen los 6 archivos.
        if (!o.bocetos) {
            return res.status(400).json({ error: 'Falta el boceto: subí un PDF con "boceto" en el nombre para enviar a aprobación.' });
        }

        if (o.AprobacionPendiente) return res.status(400).json({ error: 'La orden ya está esperando la aprobación del cliente.' });

        // FechaRechazoCliente = NULL: si venía de un rechazo, al reenviar el boceto corregido la
        // marca roja del tablero se apaga (vuelve a estar en manos del cliente).
        // TexturasElige = NULL: la decisión es DEL CLIENTE y se resuelve al aprobar (aprobarPedido):
        // si guardó texturas en el visor son suyas; si aprobó pelado, las define el diseñador.
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`UPDATE Ordenes SET AprobacionPendiente = 1, Estado = 'Pendiente', EstadoenArea = 'Esperando', FechaRechazoCliente = NULL, TexturasElige = NULL WHERE OrdenID = @OID`);

        try {
            const io = req.app.get('socketio');
            if (io) io.emit('server:ordersUpdated', { count: 1, source: 'tpu-enviar-aprobacion' });
        } catch (_) {}

        logger.info(`[TPU] Orden ${ordenId} enviada a aprobación del cliente.`);
        res.json({ success: true });
    } catch (err) {
        logger.error('[enviarAprobacionTPU] ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// TPU: TEXTURAS POR ZONA — lado interno
// El cliente las elige en el visor 3D al aprobar el boceto; producción las ve acá y puede
// corregirlas. Los helpers viven en webOrdersController (se requiere adentro de la función
// para no acoplar la carga de los dos módulos).
// =====================================================================

// GET /api/orders/:ordenId/texturas — lectura para el detalle de la orden (sin scope de cliente).
// Además de la elección, devuelve la FASE del flujo TPU (aprobado / en lote): el modal la necesita
// para decidir qué uploader mostrar y ya hace esta llamada al abrir — así se evita otro request.
exports.getTexturasOrdenInterno = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    if (!ordenId) return res.status(400).json({ error: 'Falta ordenId.' });
    try {
        const wo = require('./webOrdersController');
        const pool = await getPool();
        await wo.ensureColFechaAprobacion(pool);
        const [data, ordRes] = await Promise.all([
            wo.leerTexturasOrden(pool, ordenId),
            pool.request().input('OID', sql.Int, ordenId)
                .query('SELECT FechaAprobacionCliente, FechaRechazoCliente, RolloID, TexturasElige FROM dbo.Ordenes WITH(NOLOCK) WHERE OrdenID = @OID'),
        ]);
        const o = ordRes.recordset[0] || {};
        res.json({
            success: true, data,
            aprobado: !!o.FechaAprobacionCliente,
            rechazado: !!o.FechaRechazoCliente,
            enLote: o.RolloID != null,
            texturasElige: o.TexturasElige || null, // 'DISENADOR' = aprobó sin elegir: las define el diseñador
        });
    } catch (err) {
        logger.error('[getTexturasOrdenInterno] ' + err.message);
        res.status(500).json({ error: 'No se pudieron leer las texturas de la orden.' });
    }
};

// PUT /api/orders/:ordenId/texturas — el operario corrige la elección.
// Queda marcada como OPERARIO y se registra en el historial: se está cambiando lo que se va a
// fabricar respecto de lo que el cliente aprobó, así que tiene que haber rastro de quién y cuándo.
exports.setTexturasOrdenInterno = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const elecciones = req.body?.elecciones;
    if (!ordenId || !elecciones || typeof elecciones !== 'object') {
        return res.status(400).json({ error: 'Datos inválidos' });
    }
    try {
        const wo = require('./webOrdersController');
        for (const valor of Object.values(elecciones)) {
            if (!wo.zonaValida(valor)) return res.status(400).json({ error: `Textura desconocida: ${wo.texturaDeZona(valor)}` });
        }
        const pool = await getPool();
        await wo.ensureColFechaAprobacion(pool);
        const ord = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query('SELECT OrdenID FROM dbo.Ordenes WHERE OrdenID = @OID');
        if (!ord.recordset.length) return res.status(404).json({ error: 'Orden no encontrada.' });

        const usuarioId = parseInt(req.user?.id || req.user?.UsuarioID) || null;
        const antes = await wo.leerTexturasOrden(pool, ordenId);
        await wo.guardarTexturasOrden(pool, ordenId, elecciones, 'OPERARIO', usuarioId);

        // Historial: fila CERRADA (FechaInicio = FechaFin) con el estado actual de la orden, para
        // no pisar la fila abierta del estado real — mismo patrón que la edición de archivos.
        const previo = new Map(antes.map(r => [r.ZonaIndice, r.ArchivoTextura]));
        const cambios = Object.entries(elecciones)
            .map(([z, valor]) => {
                const de = previo.get(parseInt(z, 10)) || 'sin textura';
                const hacia = wo.texturaDeZona(valor) || 'sin textura';
                return de === hacia ? null : `Zona ${parseInt(z, 10) + 1}: ${de} → ${hacia}`;
            })
            .filter(Boolean);
        if (cambios.length) {
            const safeUser = String(req.user?.nombre || req.user?.Nombre || req.user?.usuario || usuarioId || 'Sistema').substring(0, 99);
            pool.request()
                .input('OID', sql.Int, ordenId)
                .input('User', sql.VarChar(100), safeUser)
                .input('Det', sql.NVarChar, `Texturas modificadas — ${cambios.join(' | ')}`.substring(0, 499))
                .query(`
                    INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                    SELECT @OID, ISNULL(EstadoenArea, 'Pendiente'), GETDATE(), GETDATE(), @User, @Det FROM Ordenes WHERE OrdenID = @OID
                `).catch(e => logger.error('[setTexturasOrdenInterno] historial: ' + e.message));
        }

        res.json({ success: true, cambios: cambios.length });
    } catch (err) {
        logger.error('[setTexturasOrdenInterno] ' + err.message);
        res.status(500).json({ error: 'No se pudo guardar la elección de texturas.' });
    }
};

// POST /api/orders/:ordenId/boceto-aprobado — mismo archivo pero generado desde el visor interno,
// cuando el cliente aprobó "pelado" y las texturas las define el diseñador. Sin scope de cliente.
exports.subirBocetoAprobadoInterno = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    if (!ordenId || !req.file) return res.status(400).json({ error: 'Datos inválidos' });
    try {
        const wo = require('./webOrdersController');
        const pool = await getPool();
        const chk = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query('SELECT CodigoOrden FROM dbo.Ordenes WHERE OrdenID = @OID');
        if (!chk.recordset.length) return res.status(404).json({ error: 'Orden no encontrada.' });

        const buffer = await wo.leerYBorrarTmp(req.file);
        if (!buffer) return res.status(400).json({ error: 'No llegó la imagen.' });
        const out = await wo.guardarBocetoAprobado(
            pool, ordenId, buffer, chk.recordset[0].CodigoOrden, req.body?.resumen);
        res.json({ success: true, ...out });
    } catch (err) {
        logger.error('[subirBocetoAprobadoInterno] ' + err.message);
        res.status(500).json({ error: 'No se pudo archivar el boceto aprobado.' });
    }
};

// ─── TPU: VISOR 3D INTERNO ───────────────────────────────────────────────────
// Mismas capas que expone el portal (webOrdersController.getTpuModelCapas/Archivo) pero SIN el
// scope de CodCliente: el visor también se abre desde el detalle de la orden para que el
// DISEÑADOR elija las texturas antes de mandar el boceto a aprobación.

// GET /api/orders/:ordenId/tpu-model
exports.getTpuModelCapasInterno = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    if (!ordenId) return res.status(400).json({ error: 'Datos inválidos' });
    try {
        const wo = require('./webOrdersController');
        const pool = await getPool();
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                SELECT ao.ArchivoID, ao.NombreArchivo
                FROM dbo.ArchivosOrden ao WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = ao.OrdenID
                WHERE ao.OrdenID = @OID
                  AND UPPER(LTRIM(RTRIM(o.AreaID))) = 'TPU'
                  AND ISNULL(ao.EstadoArchivo,'') <> 'Cancelado'
                  AND ao.RutaAlmacenamiento IS NOT NULL
            `);
        const capas = {};
        for (const row of r.recordset) {
            const rol = wo.rolCapaTpu(row.NombreArchivo);
            const esPdf = /\.pdf$/i.test(String(row.NombreArchivo || ''));
            if (rol && esPdf && !capas[rol]) capas[rol] = row.ArchivoID;
        }
        res.json({ success: true, capas });
    } catch (err) {
        logger.error(`[TPU-3D interno] capas: ${err.message}`);
        res.status(500).json({ error: 'Error al obtener las capas del modelo.' });
    }
};

// GET /api/orders/:ordenId/tpu-model/archivo/:archivoId
exports.getTpuModelArchivoInterno = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const archivoId = parseInt(req.params.archivoId, 10);
    if (!ordenId || !archivoId) return res.status(400).json({ error: 'Datos inválidos' });
    try {
        const driveService = require('../services/driveService');
        const pool = await getPool();
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('AID', sql.Int, archivoId)
            .query(`
                SELECT TOP 1 ao.RutaAlmacenamiento
                FROM dbo.ArchivosOrden ao WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = ao.OrdenID
                WHERE ao.ArchivoID = @AID AND ao.OrdenID = @OID
                  AND UPPER(LTRIM(RTRIM(o.AreaID))) = 'TPU'
                  AND ISNULL(ao.EstadoArchivo,'') <> 'Cancelado'
            `);
        const ruta = r.recordset[0]?.RutaAlmacenamiento;
        const driveId = ruta ? (String(ruta).match(/(?:id=|\/d\/)([\w-]+)/) || [])[1] : null;
        if (!driveId) return res.status(404).json({ error: 'Capa no encontrada.' });

        const file = await driveService.getFileStream(driveId);
        res.setHeader('Content-Type', file.mimeType || 'application/pdf');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        file.stream.pipe(res);
    } catch (err) {
        logger.error(`[TPU-3D interno] archivo: ${err.message}`);
        res.status(500).json({ error: 'Error al leer la capa.' });
    }
};

// =====================================================================
// 1. OBTENER ÓRDENES (ACTUALIZADO: Lee Material, Variante y CodigoOrden)
// =====================================================================
exports.getOrdersByArea = async (req, res) => {
    // Soporte para params o query
    let area = req.query.area || req.params.area;
    const { mode, q } = req.query;

    // logger.info(`🔎 [getOrdersByArea] Request for Area: '${area}', Mode: '${mode}'`);

    try {
        // Limpieza de nombre de área (Tu lógica original)
        if (area && area.toLowerCase().startsWith('planilla-')) {
            area = area.replace('planilla-', '').toUpperCase();
        }
        // Normalizar a mayúsculas para que 'df' encuentre AreaID='DF' en la DB
        if (area) area = area.toUpperCase();
        
        if (area === 'SUBLIMACION') area = 'SUB';
        if (area === 'BORDADO') area = 'BORD';

        // DEBUG: Force print final area
        // logger.info(`🔎 [getOrdersByArea] Querying DB with AreaID = '${area}'`);


        const pool = await getPool();
        // Auto-heal de FechaAprobacionCliente/FechaRechazoCliente: el SELECT las lee siempre.
        // La función cachea tras el primer llamado, así que en el camino caliente no cuesta nada.
        await require('./webOrdersController').ensureColFechaAprobacion(pool);

        let query = `
            SELECT
                o.OrdenID,
                o.CodigoOrden,      -- <--- NUEVO: Código Visual (UV-14 1/3)
                o.IdCabezalERP,
                o.Cliente,
                o.CodCliente,
                o.IdClienteReact,
                c.IDCliente as IDClienteStr, -- <--- NUEVO: El verdadero IDCliente alfanumérico
                o.DescripcionTrabajo,
                o.AreaID,
                o.Estado,
                o.EstadoenArea,     -- <--- NUEVO: Estado especifico del area
                o.FechaAprobacionCliente,  -- TPU: pintan la celda de estado (verde aprobado / rojo rechazado)
                o.FechaRechazoCliente,
                -- TPU: capas de arte ya subidas (sin el boceto, que no es arte). Decide si el verde
                -- de la celda parpadea (falta arte) o queda fijo (ya está completo). Va dentro del
                -- CASE para que la subconsulta no corra en las órdenes de las otras áreas.
                CASE WHEN UPPER(LTRIM(RTRIM(o.AreaID))) = 'TPU' THEN (
                    SELECT COUNT(*) FROM dbo.ArchivosOrden ao WITH(NOLOCK)
                    WHERE ao.OrdenID = o.OrdenID AND ISNULL(ao.EstadoArchivo,'') <> 'Cancelado'
                      AND LOWER(ao.NombreArchivo) NOT LIKE '%boceto%'
                ) ELSE 0 END AS CapasArte,
                o.Prioridad,
                o.FechaIngreso,
                o.FechaHabilitacion,    -- <--- NUEVO: Fecha Real de Habilitación
                o.EstadoDependencia,    -- <--- NUEVO: Dependencia (OK, ESPERANDO_INSUMO)
                o.FechaEstimadaEntrega,
                o.Magnitud,
                o.Material,         -- <--- NUEVO: Descripción del Material
                o.Variante,         -- <--- NUEVO: Código de Stock (1.1.3.1)
                -- TELA DE CLIENTE (variante con "cliente"): partes de la bobina que eligió el cliente.
                -- El material a mostrar (Referencia + DescripcionTela capitalizada + Ancho) se arma en el map.
                ibt.Referencia AS BobRef,
                ibt.DescripcionTela AS BobDesc,
                COALESCE(ibt.AnchoReal, ibt.Ancho) AS BobAncho,
                o.RolloID,
                o.Nota,
                o.Tinta,            -- <--- NUEVO: Tinta recuperada
                o.ModoRetiro,       -- <--- NUEVO: Retiro recuperado
                o.UM,               -- <--- NUEVO: Unidad de Medida recuperada
                o.meta_data,
                o.ArchivosCount,
                o.ProximoServicio,
                
                m.Nombre as NombreMaquina,
                
                (
                    SELECT 
                        ArchivoID as id,
                        NombreArchivo as nombre,
                        RutaAlmacenamiento as link,
                        TipoArchivo as tipo,
                        Copias as copias,
                        Metros as metros,
                        Ancho as ancho,
                        Alto as alto,
                        EstadoArchivo as estado,
                        DetalleLinea,
                        Observaciones as notas
                    FROM dbo.ArchivosOrden WITH(NOLOCK)
                    WHERE OrdenID = o.OrdenID
                    FOR JSON PATH
                ) as files_data

            FROM dbo.Ordenes o WITH(NOLOCK)
            LEFT JOIN dbo.ConfigEquipos m WITH(NOLOCK) ON o.MaquinaID = m.EquipoID
            LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON o.IdClienteReact = c.IDReact
            LEFT JOIN dbo.InventarioBobinas ibt WITH(NOLOCK) ON ibt.BobinaID = o.BobinaTelaID
            WHERE o.AreaID = @Area
        `;

        const request = pool.request();
        request.input('Area', sql.VarChar(20), area);

        const estadosFinales = "'Entregado', 'Finalizado', 'Cancelado'";
        if (mode === 'history') {
            query += ` AND o.Estado IN (${estadosFinales})`;
        } else if (mode === 'cancelled') {
            query += ` AND UPPER(LTRIM(RTRIM(o.Estado))) IN ('CANCELADO', 'ANULADO', 'RECHAZADO')`;
        } else if (mode === 'pronto') {
            query += ` AND UPPER(LTRIM(RTRIM(o.Estado))) = 'FINALIZADO'`;
        } else if (mode === 'all') {
            // No filtrar por estado
        } else {
            query += ` AND o.Estado NOT IN (${estadosFinales})`;
            // ECOUV — separación física de locales: la vista del local de IMPRESIÓN
            // no muestra las órdenes que ya pasaron a Terminaciones (sub-estado).
            // Esas las trabaja la bandeja del local de terminaciones.
            if (String(area || '').toUpperCase() === 'ECOUV') {
                query += ` AND LTRIM(RTRIM(ISNULL(o.EstadoenArea, ''))) <> 'En Terminaciones'`;
            }
        }

        if (q) {
            query += ' AND (o.Cliente LIKE @q OR o.CodigoOrden LIKE @q OR CAST(o.OrdenID AS VARCHAR) LIKE @q)';
            request.input('q', sql.NVarChar(100), `%${q}%`);
        }

        query += ` ORDER BY 
            CASE 
                WHEN o.Prioridad = 'Falla' OR o.CodigoOrden LIKE '%-F%' THEN 1
                WHEN o.Prioridad = 'Reposición' OR o.CodigoOrden LIKE '%-R%' THEN 2
                WHEN o.Prioridad = 'Urgente'    THEN 3 
                WHEN o.Prioridad = 'Normal'     THEN 4 
                ELSE 5 
            END ASC,
            ISNULL(o.Secuencia, 0) DESC,
            o.FechaIngreso ASC`;


        const result = await request.query(query);

        // Mapeo EXACTO para que tu Frontend AG Grid funcione
        const orders = result.recordset.map(o => ({
            id: o.OrdenID,
            code: o.CodigoOrden,
            erpId: o.IdCabezalERP,
            client: o.Cliente,
            codCliente: o.CodCliente,
            idClienteReact: o.IdClienteReact,
            idClienteStr: o.IDClienteStr, // <--- MAPEAMOS EL STRING ID (Ej: GERMANLF, MARKETING)
            desc: o.DescripcionTrabajo,
            area: o.AreaID,
            status: o.Estado,
            areaStatus: o.EstadoenArea, // <--- Mapeamos EstadoenArea
            // TPU: veredicto del cliente sobre el boceto — el tablero pinta la celda de estado.
            // `arteCompleto` se resuelve ACÁ y no en el front para que el número de capas viva en
            // un solo lado (CAPAS_ARTE_TPU) y no haya una copia más que se pueda desincronizar.
            clienteAprobo: !!o.FechaAprobacionCliente,
            clienteRechazo: !!o.FechaRechazoCliente,
            arteCompleto: (o.CapasArte || 0) >= CAPAS_ARTE_TPU,
            priority: o.Prioridad,
            entryDate: o.FechaIngreso,

            // --- NUEVOS CAMPOS DE SLA REAL ---
            enabledDate: o.FechaHabilitacion, // Cuando se liberó la restricción
            dependencyStatus: o.EstadoDependencia || 'OK', // 'ESPERANDO_INSUMOS', 'OK'
            // --------------------------------

            deliveryDate: o.FechaEstimadaEntrega,
            printer: o.NombreMaquina,
            rollId: o.RolloID,
            magnitude: o.Magnitud,
            unit: o.UM,                 // <--- Mapeo para el frontend

            // Tela de Cliente (variante con "cliente") → material = bobina elegida
            // (Referencia + DescripcionTela en Capital + Ancho); resto → Material.
            material: (/cliente/i.test(o.Variante || '') && o.BobDesc)
                ? [
                    o.BobRef,
                    String(o.BobDesc).toLowerCase().split(/\s+/).filter(Boolean)
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                    o.BobAncho
                  ].filter(x => x != null && String(x).trim() !== '').join(' ')
                : o.Material,
            variantCode: o.Variante,    // CodStock

            note: o.Nota,
            ink: o.Tinta || '',         // <--- Mapeo para el frontend
            retiro: o.ModoRetiro || '',
            filesCount: o.ArchivosCount,
            nextService: o.ProximoServicio || '-',
            meta: o.meta_data ? JSON.parse(o.meta_data) : {},
            filesData: o.files_data ? JSON.parse(o.files_data).map(f => ({
                ...f,
                urlProxy: (f.link && f.link.includes('drive.google.com'))
                    ? `/api/production-file-control/view-drive-file?url=${encodeURIComponent(f.link)}`
                    : null
            })) : []
        }));

        res.json(orders);

    } catch (err) {
        logger.error("❌ Error obteniendo órdenes:", err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 2. CREAR ORDEN (ACTUALIZADO: Inserta Material y Variante)
// =====================================================================
exports.createOrder = async (req, res) => {
    const {
        cliente, prioridad, fechaEntrega,
        servicios, // <--- ARRAY UNIFICADO
        notasGenerales,
        nombreTrabajo
    } = req.body;

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        // Generar un ID Agrupador Único para todo el "Pedido" (Header)
        const commonUUID = require('crypto').randomUUID();
        const createdIds = [];
        const createdOrdersData = [];

        // Validar que hay servicios
        if (!servicios || !Array.isArray(servicios) || servicios.length === 0) {
            throw new Error("El pedido no contiene servicios válidos.");
        }

        // Iterar y crear una Orden por cada servicio en la lista
        for (let i = 0; i < servicios.length; i++) {
            const srv = servicios[i];

            // Datos del Servicio Especifico
            const areaId = srv.areaId || 'PENDIENTE';
            const material = srv.cabecera?.material || '';
            const variante = srv.cabecera?.variante || '';
            const codArt = srv.cabecera?.codArticulo || null; // <--- YA NO ES HARDCODED

            // Nota combinada: Nota del servicio + General (solo en el principal?)
            // Decisión: Poner nota general en todos o solo en el principal. 
            // Ponemos nota especifica + ref a general si es consultable.
            const notaServicio = (srv.notas || '') + (i === 0 && notasGenerales ? `\n[GRAL]: ${notasGenerales}` : '');

            const requestOrder = new sql.Request(transaction);
            const resultOrder = await requestOrder
                .input('AreaID', sql.VarChar(20), areaId)
                .input('Cliente', sql.NVarChar(200), cliente)
                .input('Descripcion', sql.NVarChar(300), nombreTrabajo || `Pedido ${cliente}`)
                .input('Prioridad', sql.VarChar(20), prioridad)
                .input('Material', sql.VarChar(255), material)
                .input('Variante', sql.VarChar(100), variante)
                .input('CodArticulo', sql.VarChar(50), codArt)
                .input('Nota', sql.NVarChar(sql.MAX), notaServicio)
                .input('FechaEstimada', sql.DateTime, fechaEntrega ? new Date(fechaEntrega) : null)
                .input('UUID', sql.VarChar(50), commonUUID) // <--- VINCULACIÓN
                .input('ArchivosCount', sql.Int, (srv.archivos || []).length)
                .query(`
                    INSERT INTO dbo.Ordenes (
                        AreaID, Cliente, DescripcionTrabajo, Prioridad, 
                        Material, Variante, CodArticulo, 
                        Nota, FechaEstimadaEntrega, ArchivosCount, 
                        Estado, FechaIngreso, IdCabezalERP
                    )
                    OUTPUT INSERTED.OrdenID
                    VALUES (
                        @AreaID, @Cliente, @Descripcion, @Prioridad, 
                        @Material, @Variante, @CodArticulo,
                        @Nota, @FechaEstimada, @ArchivosCount, 
                        'Pendiente', GETDATE(), @UUID
                    )
                `);

            const newOrderId = resultOrder.recordset[0].OrdenID;
            
            // Traer el CodigoOrden que fue generado por la BD o Trigger
            const codeReq = await new sql.Request(transaction).input('OID', sql.Int, newOrderId).query(`SELECT CodigoOrden FROM Ordenes WHERE OrdenID = @OID`);
            const generatedCode = codeReq.recordset.length > 0 ? codeReq.recordset[0].CodigoOrden : (areaId + '-' + newOrderId);

            createdIds.push(newOrderId);
            createdOrdersData.push({
                id: newOrderId,
                area: areaId,
                variante: variante,
                prioridad: prioridad,
                codigo: generatedCode
            });

            // Insertar Archivos del Servicio
            if (srv.archivos && Array.isArray(srv.archivos)) {
                for (const file of srv.archivos) {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, newOrderId)
                        .input('Nom', sql.VarChar(255), file.name || 'Archivo')
                        .input('Tipo', sql.VarChar(50), file.tipo || 'GENERAL')
                        .input('Ruta', sql.VarChar(500), file.url || '') // Si ya tienes URL
                        .input('Copias', sql.Int, file.copias || 1) // Asegurar que copias se inserta
                        .query(`
                            INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, TipoArchivo, RutaAlmacenamiento, EstadoArchivo, FechaSubida, Copias)
                            VALUES (@OID, @Nom, @Tipo, @Ruta, 'Pendiente', GETDATE(), @Copias)
                        `);
                }
            }

            // Insertar Servicios Extra
            if (srv.serviciosExtra && Array.isArray(srv.serviciosExtra)) {
                for (const service of srv.serviciosExtra) {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, newOrderId)
                        .input('Desc', sql.NVarChar(255), service.descripcion || 'Servicio Extra')
                        .input('Cant', sql.Decimal(18, 2), service.cantidad || 0)
                        .input('Obs', sql.NVarChar(sql.MAX), service.observacion || '')
                        .input('Puntadas', sql.Int, service.puntadas || null)
                        .input('Bajadas', sql.Int, service.bajadas || null)
                        .input('BajadasAdicionales', sql.Int, service.bajadasAdicionales || null)
                        .query(`
                            INSERT INTO ServiciosExtraOrden (OrdenID, Descripcion, Cantidad, Observacion, FechaRegistro, Puntadas, Bajadas, BajadasAdicionales)
                            VALUES (@OID, @Desc, @Cant, @Obs, GETDATE(), @Puntadas, @Bajadas, @BajadasAdicionales)
                        `);
                }
            }

            // Recalcular magnitud inicial de la orden
            await recalculateOrderMagnitude(transaction, newOrderId);

            // Historial via servicio central
            await changeOrderState(transaction, {
                target  : { type: 'ORDER', id: newOrderId },
                estado  : 'Pendiente',
                userObj : req.user || req.body.usuario,
                detalle : `Orden Creada (Multi-Servicio). Parte de Grupo: ${commonUUID}`,
                io       : req.app.get('socketio')
            });
        }

        await transaction.commit();

        const io = req.app.get('socketio');
        if (io) {
            io.emit('server:ordersUpdated', { count: createdIds.length });
            io.emit('server:new_order', { orders: createdOrdersData });
        }

        res.json({ success: true, orderIds: createdIds, groupId: commonUUID, message: "Pedido Multi-Servicio creado correctamente." });

    } catch (err) {
        await transaction.rollback();
        logger.error("❌ Error creando pedido multi-servicio:", err);
        res.status(500).json({ error: err.message });
    }
};


// =====================================================================
// 3. FUNCIONES ORIGINALES (Restauradas tal cual estaban)
// =====================================================================

exports.assignRoll = async (req, res) => {
    // Soportamos ambos: un solo ID por URL o múltiples por body
    const { orderId } = req.params;
    let { orderIds, rollId, isNew, rollName, areaCode, capacity, color, bobinaId } = req.body;

    // Normalizar areaCode si viene 'DF'
    // if (areaCode === 'DF') areaCode = 'DTF'; // DISABLED: User requested to keep DF

    try {
        if (areaCode === 'DTF') areaCode = 'DF';

        const pool = await getPool();

        // Unify inputs
        let targetOrderIds = [];
        if (orderIds && Array.isArray(orderIds)) targetOrderIds = orderIds;
        else if (orderId) targetOrderIds.push(orderId);

        if (targetOrderIds.length === 0) throw new Error("No se especificaron órdenes.");

        // ----------------------------------------------------
        // REGLA DE NEGOCIO PARA SUBLIMACIÓN (SB)
        // No permitir mezclar papel con otros materiales en el mismo lote
        // ----------------------------------------------------
        if (areaCode === 'SB') {
            const newOrderData = await new sql.Request(pool)
                .query(`SELECT Material FROM dbo.Ordenes WHERE OrdenID IN (${targetOrderIds.join(',')})`);

            const newHasPapel = newOrderData.recordset.some(o => (o.Material || '').toLowerCase().includes('papel'));
            const newHasOther = newOrderData.recordset.some(o => !(o.Material || '').toLowerCase().includes('papel'));

            if (newHasPapel && newHasOther) {
                return res.status(400).json({ error: '⛔ En Sublimación no se puede mezclar papel con otros materiales en el mismo lote.' });
            }

            if (!isNew && rollId) {
                const existingData = await new sql.Request(pool)
                    .input('RID_SB', typeof rollId === 'number' ? sql.Int : sql.VarChar(20), rollId)
                    .query(`SELECT TOP 1 Material FROM dbo.Ordenes WHERE RolloID = @RID_SB`);

                if (existingData.recordset.length > 0) {
                    const existingHasPapel = (existingData.recordset[0].Material || '').toLowerCase().includes('papel');
                    if (existingHasPapel !== newHasPapel) {
                        return res.status(400).json({ error: '⛔ En Sublimación no se puede mezclar papel con otros materiales en el mismo lote.' });
                    }
                }
            }
        }

        // ----------------------------------------------------
        // REGLA DE NEGOCIO PARA DTF (DF), IMPRESIÓN DIRECTA y ECOUV
        // No permitir mezclar variantes o materiales en el mismo lote (un lote por material).
        // ECOUV va por otro lado: NO restringe la variante (puede convivir en el lote) pero SÍ la
        // tinta, porque la tinta es lo que rutea el lote a la máquina — un lote mitad Ecosolvente
        // y mitad UV no se puede imprimir de una sola pasada.
        // ----------------------------------------------------
        if (areaCode === 'DF' || areaCode === 'DIRECTA' || areaCode === 'ECOUV') {
            const areaLbl = areaCode === 'DIRECTA' ? 'Impresión Directa'
                          : areaCode === 'ECOUV'   ? 'EcoUV'
                          : 'DTF';
            const chequeaVariante = areaCode !== 'ECOUV';
            const chequeaTinta    = areaCode === 'ECOUV';
            const orderData = await new sql.Request(pool)
                .query(`SELECT Variante, Material, Tinta FROM dbo.Ordenes WHERE OrdenID IN (${targetOrderIds.join(',')})`);

            const variantSet = new Set();
            const materialSet = new Set();
            const tintaSet = new Set();

            orderData.recordset.forEach(o => {
                variantSet.add((o.Variante || '').trim().toLowerCase());
                materialSet.add((o.Material || '').trim().toLowerCase());
                tintaSet.add((o.Tinta || '').trim().toLowerCase());
            });

            if (chequeaVariante && variantSet.size > 1) {
                return res.status(400).json({ error: `⛔ En ${areaLbl} no se permite asignar órdenes con distinta Variante al mismo lote.` });
            }
            if (materialSet.size > 1) {
                return res.status(400).json({ error: `⛔ En ${areaLbl} no se permite asignar órdenes con distinto Material al mismo lote.` });
            }
            if (chequeaTinta && tintaSet.size > 1) {
                return res.status(400).json({ error: `⛔ En ${areaLbl} no se permite asignar órdenes con distinta Tinta al mismo lote.` });
            }

            if (!isNew && rollId) {
                const existingOrdersData = await new sql.Request(pool)
                    .input('RID_CHECK', typeof rollId === 'number' ? sql.Int : sql.VarChar(20), rollId)
                    .query(`SELECT TOP 1 Variante, Material, Tinta FROM dbo.Ordenes WHERE RolloID = @RID_CHECK`);

                if (existingOrdersData.recordset.length > 0) {
                    const existingOrder = existingOrdersData.recordset[0];
                    const existingVariant = (existingOrder.Variante || '').trim().toLowerCase();
                    const existingMaterial = (existingOrder.Material || '').trim().toLowerCase();
                    const existingTinta = (existingOrder.Tinta || '').trim().toLowerCase();

                    const newVariant = Array.from(variantSet)[0];
                    const newMaterial = Array.from(materialSet)[0];
                    const newTinta = Array.from(tintaSet)[0];

                    if (chequeaVariante && existingVariant && existingVariant !== newVariant) {
                        return res.status(400).json({ error: `⛔ El lote seleccionado ya contiene órdenes con variante '${existingOrder.Variante}'. No puedes mezclar variantes en ${areaLbl}.` });
                    }
                    if (existingMaterial && existingMaterial !== newMaterial) {
                        return res.status(400).json({ error: `⛔ El lote seleccionado ya contiene órdenes con material '${existingOrder.Material}'. No puedes mezclar materiales en ${areaLbl}.` });
                    }
                    if (chequeaTinta && existingTinta && existingTinta !== newTinta) {
                        return res.status(400).json({ error: `⛔ El lote seleccionado ya contiene órdenes con tinta '${existingOrder.Tinta}'. No puedes mezclar tintas en ${areaLbl}.` });
                    }
                }
            }
        }

        // ----------------------------------------------------
        // REGLA DE NEGOCIO PARA TPU
        // A un lote solo entra la orden con el ARTE COMPLETO: las CAPAS_ARTE_TPU capas, sin contar
        // el boceto (que es lo que aprobó el cliente, no se fabrica). Sin esto se podía mandar a
        // imprimir una orden a la que todavía le faltan capas.
        // ----------------------------------------------------
        if (areaCode === 'TPU') {
            const idsTPU = targetOrderIds.map(x => parseInt(x, 10)).filter(Number.isInteger);
            if (idsTPU.length > 0) {
                const arteRes = await new sql.Request(pool)
                    .query(`
                        SELECT o.OrdenID, o.CodigoOrden,
                               (SELECT COUNT(*) FROM dbo.ArchivosOrden ao
                                 WHERE ao.OrdenID = o.OrdenID
                                   AND ISNULL(ao.EstadoArchivo, '') <> 'Cancelado'
                                   AND LOWER(ao.NombreArchivo) NOT LIKE '%boceto%') AS Capas
                        FROM dbo.Ordenes o
                        WHERE o.OrdenID IN (${idsTPU.join(',')})
                    `);
                const incompletas = arteRes.recordset.filter(o => (o.Capas || 0) !== CAPAS_ARTE_TPU);
                if (incompletas.length > 0) {
                    const detalle = incompletas
                        .map(o => `${o.CodigoOrden} (${o.Capas || 0}/${CAPAS_ARTE_TPU})`)
                        .join(', ');
                    return res.status(400).json({
                        error: `⛔ Falta el arte para asignar a un lote: ${detalle}. Subí las ${CAPAS_ARTE_TPU} capas antes de mandarla a imprimir.`
                    });
                }
            }
        }
        // ----------------------------------------------------

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. SI ES NUEVO ROLLO, LO CREAMOS PRIMERO
            if (isNew) {
                rollId = `R-${Date.now().toString().slice(-6)}`;
                const finalName = rollName || `Lote ${rollId}`;

                // A. Gestionar Bobina si viene
                if (bobinaId) {
                    // Verificar disponibilidad (doble check seguro)
                    const bobinaCheck = await new sql.Request(transaction)
                        .input('BID', sql.Int, bobinaId)
                        .query("SELECT BobinaID, MetrosRestantes FROM InventarioBobinas WHERE BobinaID = @BID AND (Estado = 'Disponible' OR Estado = 'En Uso')");

                    if (bobinaCheck.recordset.length === 0) {
                        throw new Error("La bobina seleccionada no está disponible.");
                    }

                    // Marcar En Uso
                    await new sql.Request(transaction)
                        .input('BID', sql.Int, bobinaId)
                        .query("UPDATE InventarioBobinas SET Estado = 'En Uso' WHERE BobinaID = @BID");

                    // Capacity fallback
                    if (!capacity) capacity = bobinaCheck.recordset[0].MetrosRestantes;
                }

                // B. Insertar Rollo
                // B. Insertar Rollo (Let DB handle ID)
                const userId = req.user ? (req.user.id || req.user.IdUsuario) : null;
                const insertRollRes = await new sql.Request(transaction)
                    .input('Nombre', sql.NVarChar(100), finalName)
                    .input('Area', sql.VarChar(20), areaCode || 'General')
                    .input('Cap', sql.Decimal(10, 2), capacity || 100)
                    .input('Col', sql.VarChar(10), color || '#3b82f6')
                    .input('BID', sql.Int, bobinaId || null)
                    .input('UsuarioID', sql.Int, userId)
                    .query(`
                        INSERT INTO dbo.Rollos (Nombre, AreaID, CapacidadMaxima, ColorHex, Estado, MaquinaID, FechaCreacion, BobinaID, UsuarioID)
                        OUTPUT INSERTED.RolloID
                        VALUES (@Nombre, @Area, @Cap, @Col, 'Abierto', NULL, GETDATE(), @BID, @UsuarioID)
                    `);

                // Capture the real Numeric ID generated by DB
                rollId = insertRollRes.recordset[0].RolloID;
                logger.info(`[assignRoll] Nuevo Rollo Creado: ID=${rollId} (${finalName})`);

            }

            // Unify inputs ya se hizo arriba


            // 2. VINCULAR ÓRDENES (Primero las asignamos al rollo sin tocar secuencia aun)
            // Esto es necesario para que luego al consultar "todas las ordenes del rollo"
            // incluyan a las nuevas y podamos reordenar el conjunto completo.

            for (const oid of targetOrderIds) {
                await new sql.Request(transaction)
                    .input('OID', sql.Int, oid)
                    // Detect if ID is Number or String to avoid validation error
                    .input('RID', typeof rollId === 'number' ? sql.Int : sql.VarChar(20), rollId)
                    .query(`
                        UPDATE dbo.Ordenes 
                        SET 
                            RolloID = @RID,


                            -- Importante: Si la orden es 'Reposicion' o tiene 'falla' en true, aseguramos su marca.
                            -- Pero aqui solo actualizamos la vinculacion.
                            Observaciones = Observaciones -- No-op
                        WHERE OrdenID = @OID
                    `);

                // Historial via servicio central
                await changeOrderState(transaction, {
                    target  : { type: 'ORDER', id: oid },
                    estado  : rollId ? 'En Lote' : 'Pendiente',
                    userObj : req.user || req.body.usuario,
                    detalle : rollId ? 'Asignado a Lote {rollo}' : 'Retirado de Lote',
                    rolloId : rollId,
                io       : req.app.get('socketio')
            });
            }

            // 3. RECALCULAR SECUENCIA
            // - Lote NUEVO: se ordena el conjunto completo (SB por material A-Z; resto por prioridad).
            // - Lote EXISTENTE: NO se pisa el orden que el usuario ya armó (drags/sorts del modal
            //   quedaban destruidos por el resort completo) — las órdenes nuevas se APPENDEAN al
            //   final, ordenadas entre sí por las mismas reglas de prioridad.
            const allOrdersInRoll = await new sql.Request(transaction)
                .input('RID_ALL', typeof rollId === 'number' ? sql.Int : sql.VarChar(20), rollId)
                .query(`
                    SELECT OrdenID, Prioridad, falla, FechaEntradaSector, FechaIngreso, Material, Secuencia
                    FROM Ordenes
                    WHERE RolloID = @RID_ALL
                `);

            // Sorting Logic general:
            // 1. Fallas / Reposiciones (falla = 1) -> TOP
            // 2. Prioridad = 'Urgente' -> SECOND
            // 3. Fecha (FIFO) -> LAST
            const prioritySort = (arr) => arr.sort((a, b) => {
                const isFallaA = a.falla ? 1 : 0;
                const isFallaB = b.falla ? 1 : 0;
                if (isFallaA !== isFallaB) return isFallaB - isFallaA; // 1 goes first

                const isUrgenteA = (a.Prioridad === 'Urgente');
                const isUrgenteB = (b.Prioridad === 'Urgente');
                if (isUrgenteA !== isUrgenteB) return isUrgenteB - isUrgenteA; // True goes first

                // FIFO: FechaEntradaSector o FechaIngreso como fallback
                const dateA = new Date(a.FechaEntradaSector || a.FechaIngreso).getTime();
                const dateB = new Date(b.FechaEntradaSector || b.FechaIngreso).getTime();
                return dateA - dateB; // Ascending (older first)
            });

            if (isNew) {
                let ordersToSort = allOrdersInRoll.recordset;
                // REGLA ESPECIAL SB: lote NUEVO en Sublimación se ordena por Material A-Z
                if (areaCode === 'SB') {
                    ordersToSort.sort((a, b) => {
                        const matA = (a.Material || '').trim().toLowerCase();
                        const matB = (b.Material || '').trim().toLowerCase();
                        return matA.localeCompare(matB);
                    });
                } else {
                    prioritySort(ordersToSort);
                }

                for (let i = 0; i < ordersToSort.length; i++) {
                    await new sql.Request(transaction)
                        .input('OID_SEQ', sql.Int, ordersToSort[i].OrdenID)
                        .input('SEQ_VAL', sql.Int, i + 1)
                        .query("UPDATE Ordenes SET Secuencia = @SEQ_VAL WHERE OrdenID = @OID_SEQ");
                }
            } else {
                // Lote EXISTENTE: append de las órdenes nuevas después de la última secuencia
                const newIdsSet = new Set(targetOrderIds.map(Number));
                const existentes = allOrdersInRoll.recordset.filter(o => !newIdsSet.has(o.OrdenID));
                const nuevas = allOrdersInRoll.recordset.filter(o => newIdsSet.has(o.OrdenID));
                const maxSeq = existentes.reduce((m, o) => Math.max(m, o.Secuencia || 0), 0);

                prioritySort(nuevas);
                let seq = maxSeq + 1;
                for (const o of nuevas) {
                    await new sql.Request(transaction)
                        .input('OID_SEQ', sql.Int, o.OrdenID)
                        .input('SEQ_VAL', sql.Int, seq++)
                        .query("UPDATE Ordenes SET Secuencia = @SEQ_VAL WHERE OrdenID = @OID_SEQ");
                }
            }

            await transaction.commit();
            const io = req.app.get('socketio');
            if (io) {
                if (isNew) io.emit('server:rollCreated', { rollId });
                io.emit('server:rollsUpdated', { count: 1 });
                io.emit('server:ordersUpdated', { count: targetOrderIds.length });
                io.emit('lotes:updated', { action: isNew ? 'created' : 'assigned', rollId });
            }
            res.json({ success: true, rollId });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error("Error assignRoll:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.updateFile = async (req, res) => {
    const { fileId, copias, metros, link, ancho, alto, nombre } = req.body;
    logger.info(`📝 UpdateFile: ID=${fileId}, Copias=${copias}, Metros=${metros}, Ancho=${ancho}, Alto=${alto}, Nombre=${nombre}`);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 0. Valores ANTERIORES. Sin esto, editar las medidas de un arte no dejaba ningún rastro
            //    de qué se cambió (el historial solo decía "Archivo modificado") y después era
            //    imposible saber si un archivo se había tocado a mano ni cuál era el valor original.
            const prevRes = await new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .query("SELECT OrdenID, Copias, Metros, Ancho, Alto, NombreArchivo FROM dbo.ArchivosOrden WHERE ArchivoID = @ID");
            const prev = prevRes.recordset[0] || {};

            // 1. Actualizar el Archivo
            const reqUpdate = new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .input('Copias', sql.Int, copias)
                .input('Metros', sql.Decimal(10, 2), metros)
                .input('Ancho', sql.Decimal(10, 2), ancho || 0)
                .input('Alto', sql.Decimal(10, 2), alto || 0)
                .input('Ruta', sql.VarChar(500), link);

            let queryUpdate = "UPDATE dbo.ArchivosOrden SET Copias = @Copias, Metros = @Metros, Ancho = @Ancho, Alto = @Alto, RutaAlmacenamiento = @Ruta";

            if (nombre) {
                reqUpdate.input('Nom', sql.VarChar(255), nombre);
                queryUpdate += ", NombreArchivo = @Nom";
            }

            queryUpdate += " WHERE ArchivoID = @ID";
            await reqUpdate.query(queryUpdate);

            // 2. Obtener OrdenID (Crucial: Verificar que obtenemos un ID)
            const orderRes = await new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .query("SELECT OrdenID FROM ArchivosOrden WHERE ArchivoID = @ID");

            const ordenId = orderRes.recordset[0]?.OrdenID;

            if (ordenId) {
                await recalculateOrderMagnitude(transaction, ordenId);
            } else {
                logger.warn(`⚠️ No se encontró OrdenID para el archivo ${fileId}`);
            }

            await transaction.commit();

            // LOG HISTORIAL — con el detalle de QUÉ cambió (antes → después), no solo "modificado".
            const safeUser = String((req.body.userId || req.body.usuario || 'Sistema'));
            const cambios = [];
            const aNum = (v) => (v === null || v === undefined || v === '') ? null : Number(v);
            const cmp = (etiqueta, antes, ahora, dec = 2) => {
                const a = aNum(antes), b = aNum(ahora);
                if (a === null && b === null) return;
                if (a === null || b === null || Math.abs(a - b) > 1e-9) {
                    cambios.push(`${etiqueta}: ${a === null ? '—' : a.toFixed(dec)} → ${b === null ? '—' : b.toFixed(dec)}`);
                }
            };
            cmp('Ancho', prev.Ancho, ancho);
            cmp('Alto', prev.Alto, alto);
            cmp('Copias', prev.Copias, copias, 0);
            cmp('Metros', prev.Metros, metros);
            if (nombre && String(nombre) !== String(prev.NombreArchivo || '')) {
                cambios.push(`Nombre: "${prev.NombreArchivo || '—'}" → "${nombre}"`);
            }
            const detalleLog = (cambios.length
                ? `Archivo modificado (ID: ${fileId}) — ${cambios.join(' | ')}`
                : `Archivo modificado (ID: ${fileId}) — sin cambios de valores`).substring(0, 499);
            if (cambios.length) logger.info(`📝 [UpdateFile] Archivo ${fileId} por ${safeUser}: ${cambios.join(' | ')}`);

            if (ordenId) {
                pool.request()
                    .input('OID', sql.Int, ordenId)
                    .input('Est', sql.VarChar, 'Modificado')
                    .input('User', sql.VarChar, safeUser)
                    .input('Det', sql.NVarChar, detalleLog)
                    .query(`
                        INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                        SELECT @OID, ISNULL(EstadoenArea, 'Pendiente'), GETDATE(), GETDATE(), @User, @Det FROM Ordenes WHERE OrdenID = @OID
                    `).catch(e => logger.error("Log Error:", e));
            }

            // 4. Recotizar el pedido: propaga la nueva magnitud a la cotización
            //    (PedidosCobranzaDetalle → Subtotal/importe y MontoTotal del pedido).
            await recotizarPedidoDeOrden(pool, ordenId, req.body.userId || req.body.usuario, safeUser);

            // 5. Notificar actualización
            const io = req.app.get('socketio');
            if (io && ordenId) {
                io.emit('server:order_updated', { orderId: ordenId });
            }

            res.json({ success: true });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error("❌ Error updating file:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.addFile = async (req, res) => {
    const { ordenId, nombre, link, tipo, copias, metros } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool); // Add transaction for consistency
        await transaction.begin();

        try {
            if (tipo?.toLowerCase() === 'servicio') {
                // INSERTAR EN TABLA DE SERVICIOS
                const { puntadas, bajadas, bajadasAdicionales } = req.body;
                await new sql.Request(transaction)
                    .input('OrdenID', sql.Int, ordenId)
                    .input('Desc', sql.NVarChar(255), nombre || 'Servicio Extra')
                    .input('Cant', sql.Decimal(18, 2), copias || 1)
                    .input('Obs', sql.NVarChar(sql.MAX), '')
                    .input('Puntadas', sql.Int, puntadas || null)
                    .input('Bajadas', sql.Int, bajadas || null)
                    .input('BajadasAdicionales', sql.Int, bajadasAdicionales || null)
                    .query(`
                        INSERT INTO dbo.ServiciosExtraOrden 
                        (OrdenID, Descripcion, Cantidad, Observacion, FechaRegistro, Puntadas, Bajadas, BajadasAdicionales) 
                        VALUES (@OrdenID, @Desc, @Cant, @Obs, GETDATE(), @Puntadas, @Bajadas, @BajadasAdicionales)
                    `);
            } else {
                // INSERTAR EN TABLA DE ARCHIVOS
                await new sql.Request(transaction)
                    .input('OrdenID', sql.Int, ordenId)
                    .input('Nombre', sql.VarChar(200), nombre)
                    .input('Ruta', sql.VarChar(500), link)
                    .input('Tipo', sql.VarChar(50), tipo)
                    .input('Copias', sql.Int, copias)
                    .input('Metros', sql.Decimal(10, 2), metros)
                    .query("INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, FechaSubida) VALUES (@OrdenID, @Nombre, @Ruta, @Tipo, @Copias, @Metros, GETDATE())");
            }

            // Recalcular magnitud tras agregar item
            await recalculateOrderMagnitude(transaction, ordenId);

            // LOG HISTORIAL
            const safeUser = String((req.body.userId || req.body.usuario || 'Sistema'));
            await new sql.Request(transaction)
                .input('OID', sql.Int, ordenId)
                .input('Est', sql.VarChar, 'Nuevo Archivo')
                .input('User', sql.VarChar, safeUser)
                .input('Det', sql.NVarChar, `Archivo agregado: ${nombre}`)
                .query(`
                    INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                    SELECT @OID, ISNULL(EstadoenArea, 'Pendiente'), GETDATE(), GETDATE(), @User, @Det FROM Ordenes WHERE OrdenID = @OID
                 `);

            await transaction.commit();

            // Recotizar: el nuevo archivo/servicio cambia la magnitud → actualiza la cotización.
            await recotizarPedidoDeOrden(pool, ordenId, req.body.userId || req.body.usuario, String(req.body.userId || req.body.usuario || 'Sistema'));

            res.json({ success: true });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteFile = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Buscamos el OrdenID antes de borrar para poder recalcular
            const findRes = await new sql.Request(transaction)
                .input('ID', sql.Int, id)
                .query(`
                    SELECT OrdenID FROM dbo.ArchivosOrden WHERE ArchivoID = @ID
                    UNION
                    SELECT OrdenID FROM dbo.ServiciosExtraOrden WHERE ServicioID = @ID
                `);
            const ordenId = findRes.recordset[0]?.OrdenID;

            // Intentamos borrar de ambas tablas ya que el frontend los unifica
            await new sql.Request(transaction)
                .input('ID', sql.Int, id)
                .query(`
                    DELETE FROM dbo.ArchivosOrden WHERE ArchivoID = @ID;
                    DELETE FROM dbo.ServiciosExtraOrden WHERE ServicioID = @ID;
                `);

            if (ordenId) {
                await recalculateOrderMagnitude(transaction, ordenId);
            }

            await transaction.commit();

            // Recotizar: al eliminar un archivo/servicio la magnitud baja → actualiza la cotización.
            await recotizarPedidoDeOrden(pool, ordenId, req.body?.userId || req.body?.usuario, String(req.body?.userId || req.body?.usuario || 'Sistema'));

            res.json({ success: true });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error("❌ Error deleteFile:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.updateStatus = async (req, res) => {
    const { id } = req.params;
    const { status, usuario } = req.body;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. El cambio de Estado/EstadoenArea lo hace changeOrderState (abajo). Se quitó el UPDATE crudo redundante.

            // Preparar datos de usuario
            const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
            const safeUser = String(rawUser || 'Sistema').substring(0, 99);
            let userIdInt = 1;
            if (typeof usuario === 'object' && usuario.UsuarioID) userIdInt = parseInt(usuario.UsuarioID);
            else if (typeof usuario === 'number') userIdInt = usuario;

            // Historial via servicio central
            await changeOrderState(transaction, {
                target  : { type: 'ORDER', id },
                estado  : status,
                userObj : req.user || req.body.usuario,
                detalle : `Cambio de estado a ${status}`,
                io       : req.app.get('socketio')
            });

            // 3. Insertar Auditoria
            await new sql.Request(transaction)
                .input('IdUser', sql.Int, userIdInt)
                .input('Accion', sql.VarChar, 'CAMBIO_ESTADO')
                .input('Detalle', sql.NVarChar, `Orden ${id} cambio a ${status}`)
                .input('IP', sql.VarChar, req.ip || '::1')
                .query(`INSERT INTO Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora) VALUES (@IdUser, @Accion, @Detalle, @IP, GETDATE())`);

            await transaction.commit();

            const io = req.app.get('socketio');
            if (io) {
                io.emit('server:order_updated', { orderId: id, status: status, timestamp: new Date() });
                io.emit('server:ordersUpdated', { count: 1 });
            }

            res.json({ success: true });

            // Push notification — solo estados relevantes para el cliente
            const statusStr = String(status).trim().toLowerCase();
            let pushMsg = null;
            if (statusStr.includes('ingresado') || statusStr === '1') {
                pushMsg = { title: '¡Tu pedido está listo!', body: `Tu pedido {code} está listo para ser retirado.`, url: '/portal/pickup' };
            } else if (statusStr.includes('en camino') || statusStr === '8') {
                pushMsg = { title: 'Pedido en camino', body: `Tu pedido {code} fue despachado y está en camino.`, url: '/portal/pickup' };
            } else if (statusStr.includes('cancelado') || statusStr === '10') {
                pushMsg = { title: 'Pedido cancelado', body: `Tu pedido {code} fue cancelado.`, url: '/portal/pickup' };
            }
            if (pushMsg) pushService.sendToOrderClient(id, pushMsg).catch(err => logger.error('[WebPush Trigger] Error:', err.message));

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error("Error updateStatus:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.updateAreaStatus = async (req, res) => {
    const { id } = req.params;
    const { areaStatus, usuario } = req.body;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // El UPDATE de EstadoenArea lo realiza changeOrderState (abajo). Se eliminó aquí un
            // UPDATE crudo redundante que el servicio pisaba con el mismo valor (migración previa a medias).
            const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
            const safeUser = String(rawUser || 'Sistema').substring(0, 99);

            // Historial via servicio central
            await changeOrderState(transaction, {
                target  : { type: 'ORDER', id },
                estado  : areaStatus,
                userObj : req.user || req.body.usuario,
                detalle : `Cambio de estado en area a ${areaStatus}`,
                io       : req.app.get('socketio')
            });

            await transaction.commit();

            const io = req.app.get('socketio');
            if (io) {
                io.emit('server:order_updated', { orderId: id, timestamp: new Date() });
                io.emit('server:ordersUpdated', { count: 1 });
            }

            res.json({ success: true });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error("Error updateAreaStatus:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.deleteOrder = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request().input('ID', id).query("DELETE FROM dbo.ArchivosOrden WHERE OrdenID = @ID");
        await pool.request().input('ID', id).query("DELETE FROM dbo.Ordenes WHERE OrdenID = @ID");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// (Duplicado antiguo eliminado)

// =====================================================================
// 4. RESTAURAR FUNCIONES FALTANTES (Placeholders Funcionales)
// =====================================================================

exports.advancedSearchOrders = async (req, res) => {
    try {
        const { filters } = req.body || {};
        const params = filters || {}; // Safety fallback
        const pool = await getPool();
        const request = pool.request();

        let query = `
            SELECT 
                o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.AreaID, 
                o.Estado, o.EstadoenArea, o.Prioridad, o.FechaIngreso, o.FechaEstimadaEntrega,
                o.Material, o.Variante, o.Tinta, o.ModoRetiro, o.ArchivosCount, o.ProximoServicio,
                c.IDCliente, c.NombreFantasia, c.TelefonoTrabajo, c.Email, c.DireccionTrabajo
            FROM dbo.Ordenes o
            LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
            WHERE 1=1
        `;

        if (params.search) {
            query += " AND (o.Cliente LIKE @Search OR o.CodigoOrden LIKE @Search OR CAST(o.OrdenID AS VARCHAR) LIKE @Search OR o.NoDocERP LIKE @Search OR c.IDCliente LIKE @Search OR c.TelefonoTrabajo LIKE @Search OR c.NombreFantasia LIKE @Search)";
            request.input('Search', sql.VarChar, `%${params.search}%`);
        } else {
            if (params.client) {
                query += " AND o.Cliente LIKE @Client";
                request.input('Client', sql.NVarChar, `%${params.client}%`);
            }

            if (params.code) {
                query += " AND (o.CodigoOrden LIKE @Code OR CAST(o.OrdenID AS VARCHAR) LIKE @Code OR o.NoDocERP LIKE @Code)";
                request.input('Code', sql.VarChar, `%${params.code}%`);
            }
        }

        if (params.status && params.status !== 'ALL') {
            query += " AND o.Estado = @Status";
            request.input('Status', sql.VarChar, params.status);
        }

        if (params.area && params.area !== 'ALL') {
            if (Array.isArray(params.area)) {
                if (params.area.length > 0) {
                    const areaPlaceholders = params.area.map((_, i) => `@Area${i}`).join(',');
                    query += ` AND o.AreaID IN (${areaPlaceholders})`;
                    params.area.forEach((a, i) => request.input(`Area${i}`, sql.VarChar, a));
                }
            } else {
                query += " AND o.AreaID LIKE @Area";
                request.input('Area', sql.VarChar, `%${params.area}%`);
            }
        }

        if (params.dateFrom) {
            query += " AND o.FechaIngreso >= @DateFrom";
            request.input('DateFrom', sql.DateTime, new Date(params.dateFrom));
        }

        if (params.dateTo) {
            query += " AND o.FechaIngreso <= @DateTo";
            const d = new Date(params.dateTo);
            d.setHours(23, 59, 59, 999); // Final del día
            request.input('DateTo', sql.DateTime, d);
        }

        query += " ORDER BY o.FechaIngreso DESC";

        const result = await request.query(query);

        const orders = result.recordset.map(o => ({
            id: o.OrdenID,
            code: o.CodigoOrden || `ORD-${o.OrdenID}`,
            client: o.Cliente || 'Sin Cliente',
            desc: o.DescripcionTrabajo || '',
            area: o.AreaID || '',
            status: o.Estado || 'Pendiente',
            estadoArea: o.EstadoenArea || '',
            priority: o.Prioridad || 'Normal',

            // Sanitización de Fechas
            entryDate: o.FechaIngreso ? new Date(o.FechaIngreso).toISOString() : null,
            deliveryDate: o.FechaEstimadaEntrega ? new Date(o.FechaEstimadaEntrega).toISOString() : null,

            material: o.Material || '',
            variantCode: o.Variante || '',
            ink: o.Tinta || '',
            retiro: o.ModoRetiro || '',
            filesCount: o.ArchivosCount || 0,
            nextService: o.ProximoServicio || '-',

            // Información extendida del Cliente
            idCliente: o.IDCliente || '',
            nombreFantasia: o.NombreFantasia || '',
            telefono: o.TelefonoTrabajo || '',
            email: o.Email || '',
            direccion: o.DireccionTrabajo || ''
        }));

        logger.info(`🔍 Búsqueda Avanzada: ${orders.length} resultados encontrados.`);
        res.json(orders);

    } catch (e) {
        logger.error("❌ Error en Búsqueda Avanzada:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getOrderFullDetails = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().input('ID', sql.Int, req.params.id).query(`
            SELECT O.*, C.IDCliente,
                   ibt.Referencia AS BobRef, ibt.DescripcionTela AS BobDesc,
                   COALESCE(ibt.AnchoReal, ibt.Ancho) AS BobAncho
            FROM Ordenes O
            LEFT JOIN Clientes C ON C.CliIdCliente = O.CliIdCliente
            LEFT JOIN dbo.InventarioBobinas ibt WITH(NOLOCK) ON ibt.BobinaID = O.BobinaTelaID
            WHERE O.OrdenID = @ID
        `);
        const row = r.recordset[0];
        if (row) {
            // Tela de Cliente: el material a mostrar es la BOBINA elegida (Referencia +
            // DescripcionTela capitalizada + Ancho) — misma regla que getOrdersByArea. Sin esto,
            // el detalle de orden mostraba el material genérico ("Tela Cliente (Minimo 5mts)")
            // en vez de qué tela es.
            if (/cliente/i.test(row.Variante || '') && row.BobDesc) {
                row.Material = [
                    row.BobRef,
                    String(row.BobDesc).toLowerCase().split(/\s+/).filter(Boolean)
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                    row.BobAncho
                ].filter(x => x != null && String(x).trim() !== '').join(' ');
            }
        }
        res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getIntegralPedidoDetailsV2 = async (req, res) => {
    try {
        const { ref } = req.params;
        const pool = await getPool();
        const request = pool.request();

        // 1. Buscar Órdenes Relacionadas
        // Intentamos buscar por NroDocERP primero (para agrupar 1/X, 2/X)
        // O si parece un ID o Codigo específico
        request.input('Ref', sql.VarChar, ref);

        // Estrategia: Buscar el documento ancla (NoDocERP) y luego traer todas sus sub-órdenes
        const queryOrders = `
            DECLARE @RefTrimmed NVARCHAR(50) = LTRIM(RTRIM(@Ref));
            DECLARE @AnchorDoc NVARCHAR(50);

            -- 1. Búsqueda exacta por NoDocERP o CodigoOrden
            SELECT TOP 1 @AnchorDoc = NoDocERP 
            FROM Ordenes 
            WHERE LTRIM(RTRIM(NoDocERP)) = @RefTrimmed 
               OR LTRIM(RTRIM(CodigoOrden)) = @RefTrimmed;

            -- 2. Si no encuentra, busca sub-órdenes (ej: el número después del guión) o por ID
            IF @AnchorDoc IS NULL
            BEGIN
                SELECT TOP 1 @AnchorDoc = NoDocERP 
                FROM Ordenes 
                WHERE LTRIM(RTRIM(CodigoOrden)) LIKE '%-' + @RefTrimmed 
                   OR CAST(OrdenID AS VARCHAR) = @RefTrimmed
                ORDER BY 
                   CASE WHEN LTRIM(RTRIM(CodigoOrden)) LIKE '%-' + @RefTrimmed THEN 1 ELSE 2 END;
            END

            -- Si encontramos el ancla, traemos todos sus hermanos
            IF @AnchorDoc IS NOT NULL AND LTRIM(RTRIM(@AnchorDoc)) != ''
            BEGIN
                SELECT * FROM Ordenes WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@AnchorDoc));
            END
            ELSE
            BEGIN
                -- Fallback estricto
                SELECT * FROM Ordenes WHERE LTRIM(RTRIM(CodigoOrden)) LIKE @RefTrimmed + '%';
            END
        `;

        const result = await request.query(queryOrders);
        const orders = result.recordset;

        if (orders.length === 0) {
            return res.status(404).json({ error: "No se encontraron órdenes con esa referencia." });
        }

        // 2. Construir Header (Datos Agregados)
        const first = orders[0];
        const total = orders.length;
        const terminados = orders.filter(o => ['FINALIZADO', 'ENTREGADO', 'CANCELADO'].includes((o.Estado || '').toUpperCase())).length;
        const avance = total > 0 ? Math.round((terminados / total) * 100) : 0;

        // Buscar la orden que coincide exactamente con la referencia buscada
        // (el pedido puede tener sub-órdenes: DF-1162, DTF-1162, etc.)
        const matchedOrder = orders.find(o =>
            (o.CodigoOrden || '').trim() === ref.trim() ||
            (o.NoDocERP || '').trim() === ref.trim()
        ) || first;

        const header = {
            pedidoRef: first.NoDocERP || ref,
            cliente: first.Cliente,
            descripcion: first.DescripcionTrabajo,
            avance: avance,
            estadoGlobal: matchedOrder.Estado || 'PENDIENTE'
        };

        // 3. Mapear Órdenes para la tabla
        // Ordenamos por la secuencia del código (ej. 1/3, 2/3) para garantizar el orden del flujo
        orders.sort((a, b) => a.CodigoOrden.localeCompare(b.CodigoOrden, undefined, { numeric: true }));

        const mappedOrders = orders.map(o => ({
            OrdenID: o.OrdenID,
            CodigoOrden: o.CodigoOrden,
            AreaID: o.AreaID,
            Material: o.Material,
            FechaIngreso: o.FechaIngreso,
            Estado: o.Estado,
            Magnitud: o.Magnitud,
            AreaUM: first.UnidadMedida || '',
            ProximoServicio: o.ProximoServicio
        }));

        // 4. Recuperar Historial y LOGÍSTICA (Moved up for Routing Logic)
        const orderIds = orders.map(o => o.OrdenID);
        let historialData = [];
        let bultosData = [];
        let archivosData = [];

        if (orderIds.length > 0) {
            const safeIds = orderIds.join(',');

            // A. Historial
            const hQuery = `
                SELECT 
                    H.*, 
                    H.FechaInicio as Fecha, 
                    O.CodigoOrden,
                    COALESCE(U.Nombre, U.Usuario, H.Usuario) as NombreUsuario
                FROM HistorialOrdenes H
                INNER JOIN Ordenes O ON H.OrdenID = O.OrdenID
                LEFT JOIN Usuarios U ON CAST(U.IdUsuario AS VARCHAR) = H.Usuario
                WHERE H.OrdenID IN (${safeIds}) 
                ORDER BY H.FechaInicio DESC
            `;
            const hResult = await pool.request().query(hQuery);
            historialData = hResult.recordset;

            // B. Logística (Bultos asociados a estas órdenes)
            // OJO: Logistica_Bultos.OrdenID está sobrecargado -> en los bultos de PRODUCCION
            // apunta a Ordenes.OrdenID, pero en los de ENCOMIENDA apunta a
            // OrdenesRetiro.OReIdOrdenRetiro (ver logisticsController: UPDATE OrdenesRetiro
            // ... WHERE OReIdOrdenRetiro IN (SELECT b.OrdenID ... Tipocontenido='ENCOMIENDA')).
            // Sin excluirlas, una encomienda de otro cliente cuyo Nro de retiro coincide con
            // el OrdenID del pedido aparece colgada acá con su remito. Nunca son bultos del pedido.
            const bQuery = `
                SELECT 
                    LB.BultoID, 
                    LB.CodigoEtiqueta, 
                    LB.Descripcion, 
                    LB.Tipocontenido as Tipo, 
                    LB.UbicacionActual as Ubicacion, 
                    LB.Estado, 
                    O.CodigoOrden,
                    LB.OrdenID,
                    (SELECT TOP 1 LE.CodigoRemito FROM Logistica_EnvioItems LEI INNER JOIN Logistica_Envios LE ON LEI.EnvioID = LE.EnvioID WHERE LEI.BultoID = LB.BultoID ORDER BY LE.FechaSalida DESC) as CodigoRemito
                FROM Logistica_Bultos LB
                INNER JOIN Ordenes O ON LB.OrdenID = O.OrdenID
                WHERE LB.OrdenID IN (${safeIds})
                  AND ISNULL(LB.Tipocontenido, '') <> 'ENCOMIENDA'
                ORDER BY LB.BultoID ASC
            `;
            const bResult = await pool.request().query(bQuery);
            bultosData = bResult.recordset;

            // C. Archivos de Impresión y Producción
            const prodFilesQ = `SELECT *, 'produccion' as Categoria FROM ArchivosOrden WHERE OrdenID IN (${safeIds})`;
            const refFilesQ = `SELECT *, 'referencia' as Categoria FROM ArchivosReferencia WHERE OrdenID IN (${safeIds})`;
            const servQ = `SELECT *, 'servicio' as Categoria FROM ServiciosExtraOrden WHERE OrdenID IN (${safeIds})`;

            const [pRes, rRes, sRes] = await Promise.all([
                pool.request().query(prodFilesQ),
                pool.request().query(refFilesQ),
                pool.request().query(servQ)
            ]);

            // De-duplicar archivos de referencia por URL (UbicacionStorage)
            const uniqueRefs = new Map();
            rRes.recordset.forEach(f => {
                const url = (f.UbicacionStorage || '').trim();
                if (!url) {
                    uniqueRefs.set(`ref_${f.RefID}`, f);
                    return;
                }
                const urlKey = url.toLowerCase();
                const existing = uniqueRefs.get(urlKey);
                if (!existing) {
                    uniqueRefs.set(urlKey, f);
                } else {
                    // Priorizar el registro que tenga un NombreOriginal descriptivo y no la URL
                    const existingName = (existing.NombreOriginal || '').trim();
                    const currentName = (f.NombreOriginal || '').trim();
                    const existingIsUrl = existingName.startsWith('http') || existingName.includes('drive.google');
                    const currentIsUrl = currentName.startsWith('http') || currentName.includes('drive.google');
                    
                    if (existingIsUrl && !currentIsUrl) {
                        uniqueRefs.set(urlKey, f);
                    }
                }
            });
            const deduplicatedRefs = Array.from(uniqueRefs.values());

            archivosData = [...pRes.recordset, ...deduplicatedRefs, ...sRes.recordset];
        }

        // 3.5 Construir Ruta Visual (Step Tracker) - AGRUPADA POR ÁREA
        const areaSteps = new Map();

        orders.forEach(o => {
            if (!areaSteps.has(o.AreaID)) {
                areaSteps.set(o.AreaID, {
                    id: o.AreaID,
                    label: o.AreaID,
                    orders: [],
                    date: o.FechaHabilitacion || o.FechaIngreso
                });
            }
            areaSteps.get(o.AreaID).orders.push(o);
        });

        // Inyectar pasos futuros basados en ProximoServicio
        orders.forEach(o => {
            if (o.ProximoServicio && typeof o.ProximoServicio === 'string' && o.ProximoServicio.trim() !== '') {
                const ps = o.ProximoServicio.trim();
                const psUpper = ps.toUpperCase();
                const existingKey = Array.from(areaSteps.keys()).find(k => k.toUpperCase() === psUpper);
                if (!existingKey) {
                    areaSteps.set(ps, {
                        id: ps,
                        label: ps,
                        orders: [],
                        date: new Date()
                    });
                }
            }
        });

        // WMS Logic Flags (Without Injection)
        let hasDepoStock = false;
        let hasDepoDelivered = false;
        if (bultosData.length > 0) {
            hasDepoStock = bultosData.some(b => b.Ubicacion === 'DEPOSITO');
            hasDepoDelivered = bultosData.some(b => b.Ubicacion === 'CLIENTE' || b.Estado === 'ENTREGADO');

            // INYECCIÓN SEGURA: Si hay actividad logística pero la orden no tiene área de depósito explícita
            if (hasDepoStock || hasDepoDelivered) {
                const existingKey = Array.from(areaSteps.keys()).find(k => /(DEPOSITO|DEPÓSITO|LOGISTICA|LOGÍSTICA)/i.test(k));
                if (!existingKey) {
                    areaSteps.set('DEPOSITO', {
                        id: 'DEPOSITO',
                        label: 'DEPOSITO',
                        orders: [],
                        date: new Date()
                    });
                }
            }
        }

        // --- Pre-consulta DEPOSITO (fuera del .map sincrónico) ---
        // El estado del paso DEPOSITO sale SIEMPRE de OrdenesDeposito (la orden recibida en depósito).
        // Si todavía no existe esa fila, la orden NO llegó al depósito => "PENDIENTE A RECIBIR".
        // NUNCA se usa el estado del bulto como fallback: un bulto puede figurar ENTREGADO /
        // CLIENTE_FINAL por logística sin que la orden haya ingresado nunca al depósito.
        let depoStatusResult = 'PENDIENTE A RECIBIR';
        try {
            const orderIdsForDepo = orders.map(o => o.OrdenID);
            const noDocERPs = [...new Set(orders.map(o => o.NoDocERP).filter(Boolean))];
            let depoRow = null;

            const codigos = orders.map(o => `'${(o.CodigoOrden || '').replace(/'/g, "''").trim()}'`).join(',');
            if (codigos) {
                const depoRes = await pool.request().query(`
                    SELECT TOP 1
                        OD.OrdEstadoActual,
                        COALESCE(LTRIM(RTRIM(EO.EOrNombreEstado)), CAST(OD.OrdEstadoActual AS VARCHAR)) as NombreEstado
                    FROM dbo.OrdenesDeposito OD
                    LEFT JOIN dbo.EstadosOrdenes EO ON EO.EOrIdEstadoOrden = OD.OrdEstadoActual
                    WHERE LTRIM(RTRIM(OD.OrdCodigoOrden)) IN (${codigos})
                `);
                if (depoRes.recordset.length > 0) depoRow = depoRes.recordset[0];
            }

            if (depoRow) {
                // Estado real de la orden dentro del depósito (EstadosOrdenes)
                depoStatusResult = depoRow.NombreEstado || 'PENDIENTE A RECIBIR';
            }
        } catch (depoErr) {
            logger.warn(`[IntegralV2] Error consultando OrdenesDeposito: ${depoErr.message}`);
        }

        const ruta = Array.from(areaSteps.values()).map(step => {
            let stepStatus = 'PENDIENTE';

            const isStorageStep = /(DEPOSITO|DEPÓSITO|LOGISTICA|LOGÍSTICA)/i.test(step.label || step.id);

            if (isStorageStep) {
                // Estado directo de la tabla OrdenesDeposito
                stepStatus = depoStatusResult;
            } else {
                // Estado directo de la tabla Ordenes (primer orden viva del área)
                const estadoDirecto = step.orders.find(o => o.Estado)?.Estado;
                stepStatus = estadoDirecto || 'PENDIENTE';
            }

            return {
                id: step.id,
                label: step.label,
                status: stepStatus,
                date: step.date,
                count: step.orders.length
            };
        });




        // 5. Data Final
        const responseData = {
            header,
            ordenes: mappedOrders,
            ruta: ruta,
            logistica: { bultos: bultosData }, // Ahora con datos reales
            fallas: [], // Se podría expandir luego con lógica de fallas detectadas en bultos
            historial: historialData,
            archivos: archivosData
        };

        res.json(responseData);

    } catch (e) {
        logger.error("❌ Error Integral Details:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getPrioritiesConfig = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM ConfigPrioridades");
        res.json(r.recordset);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getEstadosConfig = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT TOP (1000) [EstadoID]
                  ,[AreaID]
                  ,[Nombre]
                  ,[ColorHex]
                  ,[Orden]
                  ,[EsFinal]
                  ,[TipoEstado]
              FROM dbo.ConfigEstados
              ORDER BY [Orden] ASC
        `);
        res.json(r.recordset);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getActiveOrdersSummary = async (req, res) => {
    try {
        const { area } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let queryBase = "FROM Ordenes WHERE Estado NOT IN ('Entregado', 'Finalizado', 'Cancelado')";

        // 1. Total General
        let queryTotal = `SELECT COUNT(*) as count ${queryBase}`;

        // 2. Desglose por Área
        let queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} GROUP BY AreaID`;

        if (area) {
            queryTotal += " AND AreaID = @Area";
            queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} AND AreaID = @Area GROUP BY AreaID`; // Ajuste si hay filtro
            request.input('Area', sql.VarChar, area);
        }

        const resTotal = await request.query(queryTotal);
        const resGroup = await request.query(queryGroup);

        // Construir objeto perArea { "ECOUV": 5, "DTF": 2 }
        const perArea = {};
        resGroup.recordset.forEach(row => {
            if (row.AreaID) perArea[row.AreaID] = row.count;
        });

        res.json({
            totalGeneral: resTotal.recordset[0].count,
            perArea: perArea,
            pending: 0 // Legacy support if needed
        });
    } catch (e) {
        logger.error("❌ Error Dashboard Summary:", e);
        res.status(500).json({ error: e.message });
    }
};
exports.getCancelledOrdersSummary = async (req, res) => {
    try {
        const { area } = req.query;
        const pool = await getPool();
        const request = pool.request();

        // Base Query
        let queryBase = "FROM Ordenes WHERE Estado IN ('Cancelado', 'CANCELADO', 'Anulado', 'RECHAZADO')";

        // 1. Total General
        let queryTotal = `SELECT COUNT(*) as count ${queryBase}`;

        // 2. Desglose por Área
        let queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} GROUP BY AreaID`;

        if (area) {
            queryTotal += " AND AreaID = @Area";
            queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} AND AreaID = @Area GROUP BY AreaID`;
            request.input('Area', sql.VarChar, area);
        }

        const resTotal = await request.query(queryTotal);
        const resGroup = await request.query(queryGroup);

        const perArea = {};
        resGroup.recordset.forEach(row => {
            if (row.AreaID) perArea[row.AreaID] = row.count;
        });

        res.json({
            totalGeneral: resTotal.recordset[0].count,
            perArea: perArea
        });

    } catch (e) {
        logger.error("❌ Error Dash Cancelled:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getFailedOrdersSummary = async (req, res) => {
    try {
        const { area } = req.query;
        const pool = await getPool();
        const request = pool.request();

        // Base Query - Asumimos 'FALLA' como estado principal para el dashboard rápido,
        // Y TAMBIÉN patrones visuales en el código (-F)
        let queryBase = `FROM Ordenes WHERE (
            Estado IN ('FALLA', 'Falla', 'DEFECTO')
            OR CodigoOrden LIKE 'F%'
            OR CodigoOrden LIKE '%-F%'
            OR CodigoOrden LIKE '% F%'
        )`;

        // 1. Total General
        let queryTotal = `SELECT COUNT(*) as count ${queryBase}`;

        // 2. Desglose por Área
        let queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} GROUP BY AreaID`;

        if (area) {
            queryTotal += " AND AreaID = @Area";
            queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} AND AreaID = @Area GROUP BY AreaID`;
            request.input('Area', sql.VarChar, area);
        }

        const resTotal = await request.query(queryTotal);
        const resGroup = await request.query(queryGroup);

        const perArea = {};
        resGroup.recordset.forEach(row => {
            if (row.AreaID) perArea[row.AreaID] = row.count;
        });

        res.json({
            totalGeneral: resTotal.recordset[0].count,
            perArea: perArea
        });
    } catch (e) {
        logger.error("❌ Error Dash Failed:", e);
        res.status(500).json({ error: e.message });
    }
};
exports.unassignOrder = async (req, res) => {
    const { orderId } = req.body;
    if (!req.user && !req.body.usuario) return res.status(400).json({ error: 'Usuario no autenticado' });

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener RolloID actual antes de quitarlo
            const current = await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .query("SELECT RolloID, CodigoOrden, Estado, EstadoenArea FROM Ordenes WHERE OrdenID = @OID");

            const rollId = current.recordset[0]?.RolloID;
            const codOrden = current.recordset[0]?.CodigoOrden;
            const estadoActual = current.recordset[0]?.Estado || '';
            const estadoAreaActual = current.recordset[0]?.EstadoenArea || '';

            // Solo volver a Pendiente si la orden no está en un estado terminal.
            // Comparación case-insensitive y sobre AMBOS campos: una orden cancelada guarda
            // 'Cancelado' (no 'CANCELADO'), por lo que el === exacto la dejaba pasar a Pendiente,
            // resucitando una orden ya cancelada.
            const TERMINALES = ['CANCELADO', 'ANULADO', 'RECHAZADO', 'TERMINADO', 'FINALIZADO', 'ENTREGADO'];
            const normEstado = (s) => (s || '').toUpperCase().trim();
            const isProtectedState = TERMINALES.includes(normEstado(estadoActual)) || TERMINALES.includes(normEstado(estadoAreaActual));
            const nuevoEstado = isProtectedState ? estadoActual : 'Pendiente';
            const nuevoEstadoArea = isProtectedState ? estadoAreaActual : 'Pendiente';
            const estadoLog = isProtectedState ? estadoActual : 'PREPARACION';

            // 2. Desasignar Orden (Volver a pendiente solo si corresponde)
            // MaquinaID se conserva — se actualiza al reasignar a otro rollo/máquina
            await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .query(`
                    UPDATE Ordenes 
                    SET RolloID = NULL, 
                        Secuencia = NULL
                    WHERE OrdenID = @OID
                `);

            // Historial y Estado a través del servicio
            await changeOrderState(transaction, {
                target: { type: 'ORDER', id: orderId },
                estado: nuevoEstadoArea,
                userObj: req.user || req.body.usuario,
                detalle: `Retirado del Lote ${rollId || '?'}`,
                io       : req.app.get('socketio')
            });

            // 3. Verificar si el rollo quedó vacío
            let rollCancelled = false;
            if (rollId) {
                const countRes = await new sql.Request(transaction)
                    .input('RID', sql.VarChar(50), String(rollId))
                    .query("SELECT COUNT(*) as Cnt FROM Ordenes WHERE RolloID = @RID");

                if (countRes.recordset[0].Cnt === 0) {
                    // Cancelar Rollo vacio (Limpieza Automática)
                    logger.info(`[AutoCleanup] Rollo ${rollId} quedó vacío. Cancelando...`);

                    // A. Obtener Máquina asignada (si existe) para liberarla visualmente (EstadoProceso)
                    const rollInfo = await new sql.Request(transaction)
                        .input('RID', sql.VarChar(50), String(rollId))
                        .query("SELECT MaquinaID FROM Rollos WHERE RolloID = @RID");

                    const maqId = rollInfo.recordset[0]?.MaquinaID;

                    // B. Eliminar el rollo físicamente (ya que quedó vacío)
                    await new sql.Request(transaction)
                        .input('RID', sql.VarChar(50), String(rollId))
                        .query("DELETE FROM Rollos WHERE RolloID = @RID");

                    // C. Resetear EstadoProceso de la Máquina (si tenía)
                    if (maqId) {
                        await new sql.Request(transaction)
                            .input('MID', sql.Int, maqId)
                            .query("UPDATE ConfigEquipos SET EstadoProceso = 'Detenido' WHERE EquipoID = @MID");
                    }

                    // D. Importante: Desvincular Órdenes de la Máquina (aunque estén desasignadas, por seguridad)
                    // (Ya se hizo en el paso 2 con MaquinaID=NULL, OrdenID=@OID)
                    // Pero asegurarse de que ninguna otra orden quede pegada a ese rollo (CNT=0 garantiza esto).

                    rollCancelled = true;
                }
            }

            await transaction.commit();
            res.json({ success: true, rollCancelled, message: "Orden retirada del lote." });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error("Error unassignOrder:", err);
        res.status(500).json({ error: err.message });
    }
};
// (Versión antigua eliminada)

// ===================================
// ... (Otras funciones) ...

exports.cancelOrder = async (req, res) => {
    const { orderId, reason, motivoId, detalles, usuario } = req.body;
    logger.info(`🚫 Cancelando Orden ID: ${orderId}`);

    try {
        const safeReason = (reason && typeof reason === 'string') ? reason : 'Cancelado por usuario';
        const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
        const safeUser = String(rawUser || 'Sistema').substring(0, 99);
        const obsText = ` [CANCELADO: ${safeReason}]`;

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener NoDocERP, RolloID y estados actuales antes de cancelar
            const docRes = await new sql.Request(transaction)
                .input('ID', sql.Int, orderId)
                .query("SELECT NoDocERP, RolloID, Estado, EstadoenArea FROM Ordenes WHERE OrdenID = @ID");
            const noDocERP = docRes.recordset[0]?.NoDocERP;
            const rollId = docRes.recordset[0]?.RolloID;
            const estadoAnterior = docRes.recordset[0]?.Estado || 'En Proceso';
            const estadoAreaAnterior = docRes.recordset[0]?.EstadoenArea || 'En Proceso';

            // 1a. Guardar snapshot del estado anterior en HistorialOrdenes (para poder reactivar)
            await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .input('User', sql.VarChar(100), safeUser)
                .input('Det', sql.NVarChar, JSON.stringify({ __snapshot__: true, Estado: estadoAnterior, EstadoenArea: estadoAreaAnterior }))
                .query(`INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                        VALUES (@OID, 'SNAPSHOT_PRE_CANCEL', GETDATE(), GETDATE(), @User, @Det)`);

            // 1b. Limpiar lote y notas extras
            await new sql.Request(transaction)
                .input('ID', sql.Int, orderId)
                .input('Obs', sql.NVarChar, obsText)
                .input('MotivoID', sql.Int, motivoId || null)
                .input('Detalles', sql.NVarChar, detalles || null)
                .query(`
                    UPDATE Ordenes 
                    SET RolloID = NULL,
                        Nota = CONCAT(ISNULL(Nota, ''), @Obs),
                        Observaciones = CONCAT(ISNULL(Observaciones, ''), @Obs),
                        MotivoCancelacionID = @MotivoID,
                        DetallesCancelacion = @Detalles
                    WHERE OrdenID = @ID
                `);

            // 1c. Verificar si el lote quedó vacío y eliminarlo
            if (rollId) {
                const countRes = await new sql.Request(transaction)
                    .input('RID', sql.VarChar(50), String(rollId))
                    .query("SELECT COUNT(*) as Cnt FROM Ordenes WHERE RolloID = @RID");
                
                if (countRes.recordset[0].Cnt === 0) {
                    logger.info(`[AutoCleanup] Rollo ${rollId} quedó vacío tras cancelar orden. Eliminando...`);
                    await new sql.Request(transaction)
                        .input('RID', sql.VarChar(50), String(rollId))
                        .query("DELETE FROM Rollos WHERE RolloID = @RID");
                }
            }

            // 2. Cancelar sus archivos
            await new sql.Request(transaction)
                .input('ID', sql.Int, orderId)
                .input('User', sql.VarChar(100), safeUser)
                .input('MotivoID', sql.Int, motivoId || null)
                .input('Detalles', sql.NVarChar, detalles || null)
                .query(`
                    UPDATE ArchivosOrden 
                    SET EstadoArchivo = 'CANCELADO',
                        UsuarioControl = @User,
                        FechaControl = GETDATE(),
                        Observaciones = CONCAT(ISNULL(Observaciones, ''), ' [ORDEN CANCELADA]'),
                        MotivoCancelacionID = @MotivoID,
                        DetallesCancelacion = @Detalles
                    WHERE OrdenID = @ID AND EstadoArchivo != 'CANCELADO'
                `);

            // 3. Insertar Auditoria (Restored)
            let userIdInt = 1;
            if (typeof usuario === 'object' && usuario.UsuarioID) userIdInt = parseInt(usuario.UsuarioID);
            else if (typeof usuario === 'number') userIdInt = usuario;

            await new sql.Request(transaction)
                .input('IdUser', sql.Int, userIdInt)
                .input('Accion', sql.VarChar, 'CANCELAR_ORDEN')
                .input('Detalle', sql.NVarChar, `Orden ${orderId} cancelada. Motivo: ${safeReason}`)
                .input('IP', sql.VarChar, req.ip || '::1')
                .query(`INSERT INTO Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora) VALUES (@IdUser, @Accion, @Detalle, @IP, GETDATE())`);

            // TELA CLIENTE: Devolver a la bobina los metros REALMENTE consumidos por la orden.
            // Helper idempotente (guarda anti doble devolución) basado en MovimientosInsumos,
            // no en Ordenes.Magnitud — devuelve exactamente lo descontado al crear el pedido.
            const { devolverMetrosTelaCliente } = require('../utils/telaClienteDevolucion');
            const userIdTela = parseInt(req.user?.id || req.user?.UsuarioID || 1) || 1;
            const mtsDevueltos = await devolverMetrosTelaCliente(transaction, orderId, `Devolución por cancelación Orden ${orderId}`, userIdTela);
            if (mtsDevueltos > 0) logger.info(`[CANCEL-TELA] Orden ${orderId}: devueltos ${mtsDevueltos}m`);

            // Historial via servicio central
            await changeOrderState(transaction, {
                target  : { type: 'ORDER', id: orderId },
                estado  : 'Cancelado',
                userObj : req.user || req.body.usuario,
                detalle : safeReason,
                io      : req.app.get('socketio'),
                io       : req.app.get('socketio')
            });

            // ECOUV: cancelar también su hermana de terminaciones (XEUV-*): sin la
            // impresión no hay material que terminar. No-op para el resto de las áreas.
            const { cancelarHermanaTerminaciones } = require('../utils/hermanaTerminaciones');
            await cancelarHermanaTerminaciones(transaction, orderId, {
                userObj : req.user || req.body.usuario,
                io      : req.app.get('socketio')
            });

            await transaction.commit();

            // AUTO-CLEANUP: si el lote quedó solo con órdenes muertas (Pronto/finalizadas/canceladas
            // que siguen vinculadas), cancelarlo y liberar la máquina. El DELETE de arriba solo
            // cubre el caso "físicamente vacío".
            if (rollId) {
                const { cancelarLoteSiVacio } = require('../services/loteCleanupService');
                await cancelarLoteSiVacio(rollId, req.app.get('socketio'));
            }

            try {
                if (noDocERP) {
                    const ERPSyncService = require('../services/erpSyncService');
                    let userIdInt = 1;
                    if (typeof usuario === 'object' && usuario.UsuarioID) userIdInt = parseInt(usuario.UsuarioID);
                    else if (typeof usuario === 'number') userIdInt = usuario;
                    await ERPSyncService.syncFinalOrderIntegration(noDocERP, userIdInt, safeUser, null, { skipDeposito: true });
                }
            } catch (errSync) {
                logger.error("❌ Error recotizando orden tras cancelar:", errSync);
            }

            // 3. Notificación SOCKET (Dual para compatibilidad)
            try {
                const io = req.app.get('socketio');
                if (io) {
                    // Evento específico para detalles
                    io.emit('server:order_updated', { orderId, status: 'Cancelado' });
                    // Evento general para refrescar listas (Dashboard)
                    io.emit('server:ordersUpdated', { count: 1 });
                }
            } catch (sockErr) { logger.error("Socket error:", sockErr); }

            res.json({ success: true, message: 'Orden cancelada correctamente.' });

            // Push notification ({code} se reemplaza por el CodigoOrden en el servicio)
            pushService.sendToOrderClient(orderId, {
                title: 'Pedido cancelado',
                body: 'Tu pedido {code} fue cancelado.',
                url: '/portal/pickup',
                actions: [{ action: 'pedidos', title: 'Ver mis pedidos' }],
                actionUrls: { pedidos: '/portal/factory' },
            }).catch(err => logger.error('[WebPush Trigger] Error:', err.message));

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error("❌ Error cancelOrder:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.updateService = async (req, res) => {
    const { serviceId, cantidad, obs, nombre } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Actualizar el Servicio
            const { puntadas, bajadas, bajadasAdicionales } = req.body;

            const reqUpdate = new sql.Request(transaction)
                .input('ID', sql.Int, serviceId)
                .input('Cant', sql.Decimal(18, 2), cantidad) // Cantidad decimal
                .input('Obs', sql.NVarChar, obs || '')      // Obs opcional
                .input('Puntadas', sql.Int, puntadas || null)
                .input('Bajadas', sql.Int, bajadas || null)
                .input('BajadasAdicionales', sql.Int, bajadasAdicionales || null);

            let queryUpdate = `
                UPDATE dbo.ServiciosExtraOrden 
                SET Cantidad = @Cant, 
                    Observacion = @Obs,
                    Puntadas = @Puntadas,
                    Bajadas = @Bajadas,
                    BajadasAdicionales = @BajadasAdicionales
            `;

            if (nombre) {
                reqUpdate.input('Nom', sql.VarChar(255), nombre);
                queryUpdate += ", Descripcion = @Nom";
            }

            queryUpdate += " WHERE ServicioID = @ID";
            await reqUpdate.query(queryUpdate);

            // 2. Obtener OrdenID
            const serviceRes = await new sql.Request(transaction)
                .input('ID', sql.Int, serviceId)
                .query("SELECT OrdenID FROM ServiciosExtraOrden WHERE ServicioID = @ID");

            const ordenId = serviceRes.recordset[0]?.OrdenID;

            if (ordenId) {
                logger.info(`🔄 Recalculando Magnitud Global (Producción + Servicios) para OrdenID: ${ordenId}`);

                // 3. Recálculo Unificado (Producción + Servicios)
                await recalculateOrderMagnitude(transaction, ordenId);

                const safeUser = String((req.body.usuario || 'Sistema'));
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .input('Est', sql.VarChar, 'Servicio Modif.')
                    .input('User', sql.VarChar, safeUser)
                    .input('Det', sql.NVarChar, `Servicio Extra Actualizado ID: ${serviceId}`)
                    .query(`
                        INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                        SELECT @OID, ISNULL(EstadoenArea, 'Pendiente'), GETDATE(), GETDATE(), @User, @Det FROM Ordenes WHERE OrdenID = @OID
                    `);
            }

            await transaction.commit();

            // 4. Recotizar: cambiar la cantidad del servicio afecta la magnitud global → actualiza la cotización.
            await recotizarPedidoDeOrden(pool, ordenId, req.body.usuario, String(req.body.usuario || 'Sistema'));

            // 5. Notificar actualización en tiempo real
            const io = req.app.get('socketio');
            if (io && ordenId) {
                // Notificar a todos que la orden cambió (AreaView se actualizará)
                io.emit('orders:updated', { orderId: ordenId });
            }

            res.json({ success: true });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (e) {
        logger.error("❌ Error updateService:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getOrderReferences = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        
        // 1. Obtener NoDocERP
        const orderRes = await pool.request().input('ID', sql.Int, id).query(`
            SELECT NoDocERP FROM dbo.Ordenes WHERE OrdenID = @ID
        `);
        const noDocERP = orderRes.recordset[0]?.NoDocERP;

        let result;
        if (noDocERP) {
            // 2a. Traer referencias de todo el pedido
            result = await pool.request().input('NoDoc', sql.VarChar, noDocERP).query(`
                SELECT r.RefID as id, r.NombreOriginal as nombre, r.UbicacionStorage as link, 
                       ISNULL(r.TipoArchivo, 'Referencia') as tipo, r.NotasAdicionales as notas, r.OrdenID
                FROM dbo.ArchivosReferencia r
                INNER JOIN dbo.Ordenes o ON r.OrdenID = o.OrdenID
                WHERE o.NoDocERP = @NoDoc
            `);
        } else {
            // 2b. Fallback por orden individual
            result = await pool.request().input('ID', sql.Int, id).query(`
                SELECT RefID as id, NombreOriginal as nombre, UbicacionStorage as link, 
                       ISNULL(TipoArchivo, 'Referencia') as tipo, NotasAdicionales as notas, OrdenID
                FROM dbo.ArchivosReferencia WHERE OrdenID = @ID
            `);
        }

        // Agrupar visualmente por link (archivo) para evitar que el mismo archivo 
        // aparezca repetido si fue subido a varias órdenes del mismo carrito,
        // priorizando mantener los nombres amigables sobre URLs.
        const uniqueRefs = new Map();
        result.recordset.forEach(f => {
            if (f.link) {
                const linkKey = f.link.toLowerCase().trim();
                const existing = uniqueRefs.get(linkKey);
                if (!existing) {
                    uniqueRefs.set(linkKey, f);
                } else {
                    const existingName = (existing.nombre || '').trim();
                    const currentName = (f.nombre || '').trim();
                    const existingIsUrl = existingName.startsWith('http') || existingName.includes('drive.google');
                    const currentIsUrl = currentName.startsWith('http') || currentName.includes('drive.google');
                    
                    if (existingIsUrl && !currentIsUrl) {
                        uniqueRefs.set(linkKey, f);
                    }
                }
            } else if (!uniqueRefs.has(f.id)) {
                uniqueRefs.set(f.id, f);
            }
        });

        const mappedData = Array.from(uniqueRefs.values()).map(f => ({
            ...f,
            urlProxy: (f.link && f.link.includes('drive.google.com'))
                ? `/api/production-file-control/view-drive-file?url=${encodeURIComponent(f.link)}`
                : null
        }));
        res.json(mappedData);
    } catch (e) {
        logger.warn("⚠️ Error leyendo Referencias:", e.message);
        res.json([]);
    }
};

exports.getOrderServices = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request().input('ID', sql.Int, id).query(`
            SELECT 
                ServicioID as id, 
                Descripcion as nombre, 
                Cantidad as copias, 
                Observacion as notas, 
                'Servicio' as tipo,
                ISNULL(Estado, 'PENDIENTE') as Estado,
                Observaciones as ObservacionesControl,
                UsuarioControl,
                FechaControl,
                Puntadas,
                Bajadas,
                BajadasAdicionales
            FROM dbo.ServiciosExtraOrden 
            WHERE OrdenID = @ID
        `);
        res.json(result.recordset);
    } catch (e) {
        logger.warn("⚠️ Error leyendo Servicios:", e.message);
        res.json([]);
    }
};

exports.cancelRequest = async (req, res) => {
    const { orderId, reason, motivoId, detalles, usuario } = req.body;
    logger.info(`🔥 Cancelando PEDIDO COMPLETO (Request), Ref Order: ${orderId}`);

    try {
        // Sanitización estricta
        const safeReason = (reason && typeof reason === 'string') ? reason : 'Cancelado por solicitud';
        const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
        const safeUser = String(rawUser || 'Sistema').substring(0, 99);
        const obsText = ` [PEDIDO CANCELADO: ${safeReason}]`;

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener NoDocERP
            const docRes = await new sql.Request(transaction)
                .input('ID', sql.Int, orderId)
                .query("SELECT NoDocERP, CodigoOrden FROM Ordenes WHERE OrdenID = @ID");

            const noDoc = docRes.recordset[0]?.NoDocERP;
            let rowsAffected = 0;
            let rolloIdsAfectados = []; // lotes a los que pertenecían las órdenes canceladas (cleanup post-commit)

            if (noDoc) {
                // Capturar los lotes ANTES del UPDATE que pone RolloID = NULL
                const rollosRes = await new sql.Request(transaction)
                    .input('NoDoc', sql.VarChar(50), noDoc)
                    .query("SELECT DISTINCT RolloID FROM Ordenes WHERE NoDocERP = @NoDoc AND RolloID IS NOT NULL");
                rolloIdsAfectados = rollosRes.recordset.map(r => r.RolloID);
                // Obtener todas las órdenes activas del pedido con sus estados actuales
                const ordenesActivas = await new sql.Request(transaction)
                    .input('NoDoc', sql.VarChar(50), noDoc)
                    .query(`SELECT OrdenID, Estado, EstadoenArea FROM Ordenes WHERE NoDocERP = @NoDoc AND Estado != 'CANCELADO'`);

                // Guardar snapshot y aplicar estado cancelado
                for (const ord of ordenesActivas.recordset) {
                    // Snapshot pre-cancel
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, ord.OrdenID)
                        .input('User', sql.VarChar(100), safeUser)
                        .input('Det', sql.NVarChar, JSON.stringify({ __snapshot__: true, Estado: ord.Estado || 'En Proceso', EstadoenArea: ord.EstadoenArea || 'En Proceso' }))
                        .query(`INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                                VALUES (@OID, 'SNAPSHOT_PRE_CANCEL', GETDATE(), GETDATE(), @User, @Det)`);

                    // Aplicar estado Cancelado via servicio
                    await changeOrderState(transaction, {
                        target  : { type: 'ORDER', id: ord.OrdenID },
                        estado  : 'Cancelado',
                        userObj : req.user || req.body.usuario,
                        detalle : safeReason,
                io       : req.app.get('socketio')
            });
                }

                // Cancelar TODAS las órdenes con ese NoDocERP
                const r1 = await new sql.Request(transaction)
                    .input('NoDoc', sql.VarChar(50), noDoc)
                    .input('Obs', sql.NVarChar, obsText)
                    .input('MotivoID', sql.Int, motivoId || null)
                    .input('Detalles', sql.NVarChar, detalles || null)
                    .query(`
                        UPDATE Ordenes 
                        SET RolloID = NULL,
                            MaquinaID = NULL,
                            Secuencia = NULL,
                            Observaciones = CONCAT(ISNULL(Observaciones, ''), @Obs),
                            MotivoCancelacionID = @MotivoID,
                            DetallesCancelacion = @Detalles
                        WHERE NoDocERP = @NoDoc AND Estado != 'CANCELADO'
                    `);
                rowsAffected = r1.rowsAffected[0];

                // Cancelar archivos de esas órdenes
                await new sql.Request(transaction)
                    .input('NoDoc', sql.VarChar(50), noDoc)
                    .input('User', sql.VarChar(100), safeUser)
                    .input('MotivoID', sql.Int, motivoId || null)
                    .input('Detalles', sql.NVarChar, detalles || null)
                    .query(`
                        UPDATE AO
                        SET AO.EstadoArchivo = 'CANCELADO',
                            AO.UsuarioControl = @User,
                            AO.FechaControl = GETDATE(),
                            AO.Observaciones = CONCAT(ISNULL(AO.Observaciones, ''), ' [PEDIDO CANCELADO]'),
                            AO.MotivoCancelacionID = @MotivoID,
                            AO.DetallesCancelacion = @Detalles
                        FROM ArchivosOrden AO
                        INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                        WHERE O.NoDocERP = @NoDoc AND AO.EstadoArchivo != 'CANCELADO'
                    `);
            } else {
                // Fallback: Cancelar solo esta orden
                const rolloRes = await new sql.Request(transaction)
                    .input('ID', sql.Int, orderId)
                    .query("SELECT RolloID FROM Ordenes WHERE OrdenID = @ID AND RolloID IS NOT NULL");
                if (rolloRes.recordset[0]?.RolloID) rolloIdsAfectados.push(rolloRes.recordset[0].RolloID);

                const r2 = await new sql.Request(transaction)
                    .input('ID', sql.Int, orderId)
                    .input('Obs', sql.NVarChar, obsText)
                    .input('MotivoID', sql.Int, motivoId || null)
                    .input('Detalles', sql.NVarChar, detalles || null)
                    .query(`
                        UPDATE Ordenes
                        SET RolloID = NULL,
                            MaquinaID = NULL,
                            Secuencia = NULL,
                            Observaciones = CONCAT(ISNULL(Observaciones, ''), @Obs),
                            MotivoCancelacionID = @MotivoID,
                            DetallesCancelacion = @Detalles
                        WHERE OrdenID = @ID
                    `);
                rowsAffected = r2.rowsAffected[0];

                // Aplicar estado Cancelado via servicio
                await changeOrderState(transaction, {
                    target  : { type: 'ORDER', id: orderId },
                    estado  : 'Cancelado',
                    userObj : req.user || req.body.usuario,
                    detalle : safeReason,
                io       : req.app.get('socketio')
            });

                // Cancelar archivos
                await new sql.Request(transaction)
                    .input('ID', sql.Int, orderId)
                    .input('User', sql.VarChar(100), safeUser)
                    .input('MotivoID', sql.Int, motivoId || null)
                    .input('Detalles', sql.NVarChar, detalles || null)
                    .query(`
                     UPDATE ArchivosOrden 
                     SET EstadoArchivo = 'CANCELADO',
                         UsuarioControl = @User,
                         FechaControl = GETDATE(),
                         MotivoCancelacionID = @MotivoID,
                         DetallesCancelacion = @Detalles
                     WHERE OrdenID = @ID AND EstadoArchivo != 'CANCELADO'
                 `);
            }

            await transaction.commit();

            // AUTO-CLEANUP: cancelar los lotes que quedaron sin órdenes activas y liberar sus máquinas
            if (rolloIdsAfectados.length > 0) {
                const { cancelarLoteSiVacio } = require('../services/loteCleanupService');
                for (const rid of rolloIdsAfectados) {
                    await cancelarLoteSiVacio(rid, req.app.get('socketio'));
                }
            }

            try {
                if (noDoc) {
                    const ERPSyncService = require('../services/erpSyncService');
                    let userIdInt = 1;
                    if (typeof usuario === 'object' && usuario.UsuarioID) userIdInt = parseInt(usuario.UsuarioID);
                    else if (typeof usuario === 'number') userIdInt = usuario;
                    await ERPSyncService.syncFinalOrderIntegration(noDoc, userIdInt, safeUser, null, { skipDeposito: true });
                }
            } catch (syncErr) {
                logger.error("❌ Error recotizando orden tras cancelar Request:", syncErr);
            }            try {
                const io = req.app.get('socketio');
                if (io) io.emit('server:order_updated', { orderId });
            } catch (sockErr) { logger.error(sockErr); }

            res.json({ success: true, message: `Pedido cancelado. ${rowsAffected} órdenes afectadas.` });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error("❌ Error cancelRequest:", e);
        res.status(500).json({ error: e.message });
    }
};
exports.cancelRoll = async (req, res) => { res.json({ success: true }); };
exports.getOrderHistory = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        // Intentamos buscar en una tabla de auditoría si existe, o construimos historial básico
        // Asumiendo que existe una tabla de auditoría o log. Si no, devolvemos info básica de la orden como "Creada".
        // Por ahora, simularemos historial con la fecha de ingreso y control de archivos.

        const result = await pool.request()
            .input('ID', sql.Int, id)
            .query(`
                SELECT 'Orden Ingresada' as Detalle, FechaIngreso as Fecha, 'Pendiente' as Estado, UsuarioID as Usuario FROM Ordenes WHERE OrdenID = @ID
                UNION ALL
                SELECT CONCAT('Archivo Controlado: ', NombreArchivo, ' [', EstadoArchivo, ']'), FechaControl, EstadoArchivo, UsuarioControl FROM ArchivosOrden WHERE OrdenID = @ID AND FechaControl IS NOT NULL
                ORDER BY Fecha DESC
            `);

        res.json(result.recordset);
    } catch (e) {
        logger.error(e);
        res.status(500).json({ error: e.message });
    }
};
exports.cancelFile = async (req, res) => {
    const { fileId, reason, motivoId, detalles, usuario } = req.body;
    const userName = req.user ? (req.user.nombre || req.user.name || req.user.username || req.user.Nombre || String(usuario || 'Sistema')) : String(usuario || 'Sistema');
    logger.info(`🚫 Cancelando Archivo ID: ${fileId} | Motivo: ${reason} | Usuario: ${userName}`);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Marcar Archivo como Cancelado
            await new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .input('Obs', sql.NVarChar, reason || 'Cancelado por usuario')
                .input('User', sql.VarChar(100), userName)
                .input('MotivoID', sql.Int, motivoId || null)
                .input('Detalles', sql.NVarChar, detalles || null)
                .query(`
                    UPDATE dbo.ArchivosOrden 
                    SET EstadoArchivo = 'CANCELADO', 
                        Observaciones = CONCAT(Observaciones, ' [CANCELADO: ', @Obs, ']'),
                        UsuarioControl = @User,
                        FechaControl = GETDATE(),
                        MotivoCancelacionID = @MotivoID,
                        DetallesCancelacion = @Detalles
                    WHERE ArchivoID = @ID
                `);

            // 2. Obtener OrdenID y NoDocERP
            const orderRes = await new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .query(`
                    SELECT A.OrdenID, O.NoDocERP 
                    FROM ArchivosOrden A 
                    INNER JOIN Ordenes O ON A.OrdenID = O.OrdenID 
                    WHERE A.ArchivoID = @ID
                `);

            const ordenId = orderRes.recordset[0]?.OrdenID;
            const noDocERP = orderRes.recordset[0]?.NoDocERP;
            let orderCancelled = false;

            if (ordenId) {
                // 3. Recalcular Magnitud Total (Unificado)
                await recalculateOrderMagnitude(transaction, ordenId);

                // Obtener datos extras para el resto de la lógica de cancelación
                const statsRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .query(`
                        SELECT COUNT(*) as Activos
                        FROM ArchivosOrden 
                        WHERE OrdenID = @OID AND (EstadoArchivo IS NULL OR EstadoArchivo != 'CANCELADO')
                    `);
                const activos = statsRes.recordset[0]?.Activos || 0;

                // 5. Verificar si hay que cancelar la orden completa
                if (activos === 0) {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, ordenId)
                        .input('Obs', sql.NVarChar, 'Todos los archivos fueron cancelados.')
                        .query(`
                            UPDATE Ordenes 
                            SET RolloID = NULL,
                                MaquinaID = NULL,
                                Secuencia = NULL,
                                Observaciones = CONCAT(Observaciones, ' [AUTO-CANCEL: ', @Obs, ']')
                            WHERE OrdenID = @OID
                        `);

                    // LOG via servicio central
                    await changeOrderState(transaction, {
                        target  : { type: 'ORDER', id: ordenId },
                        estado  : 'Cancelado',
                        userObj : req.user || req.body.usuario,
                        detalle : 'Orden Auto-Cancelada (Sin archivos activos)',
                io       : req.app.get('socketio')
            });
                    // ECOUV: la hermana de terminaciones cae junto con la madre
                    const { cancelarHermanaTerminaciones } = require('../utils/hermanaTerminaciones');
                    await cancelarHermanaTerminaciones(transaction, ordenId, {
                        userObj : req.user || req.body.usuario,
                        io      : req.app.get('socketio')
                    });
                    orderCancelled = true;
                }

                // LOG FILE CANCELADO (Siempre)
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .input('Est', sql.VarChar, 'Archivo Cancelado')
                    .input('User', sql.VarChar, userName)
                    .input('Det', sql.NVarChar, `Archivo cancelado: ${reason}`)
                    .query(`
                       INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                       SELECT @OID, ISNULL(EstadoenArea, 'Pendiente'), GETDATE(), GETDATE(), @User, @Det FROM Ordenes WHERE OrdenID = @OID
                   `);
            }

            await transaction.commit();

            try {
                if (noDocERP) {
                    const ERPSyncService = require('../services/erpSyncService');
                    let userIdInt = 1;
                    if (typeof usuario === 'object' && usuario.UsuarioID) userIdInt = parseInt(usuario.UsuarioID);
                    else if (typeof usuario === 'number') userIdInt = usuario;
                    await ERPSyncService.syncFinalOrderIntegration(noDocERP, userIdInt, userName.substring(0,99), null, { skipDeposito: true });
                }
            } catch (errSync) {
                logger.error("❌ Error recotizando orden tras cancelar Archivo:", errSync);
            }

            // Socket fuera de transacción
            try {
                const io = req.app.get('socketio');
                if (io && ordenId) {
                    io.emit('server:order_updated', { orderId: ordenId });
                }
            } catch (sockErr) { logger.error("Socket emit error:", sockErr); }

            res.json({ success: true, orderCancelled });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error("❌ Error cancelling file:", e);
        res.status(500).json({ error: e.message });
    }
};
exports.assignFabricBobbin = async (req, res) => { res.json({ success: true }); };

// ============================================================
// REACTIVACIÓN (reversa de cancelación) — 3 niveles
// ============================================================

/**
 * Helper: obtiene el último EstadoArchivo registrado en HistorialOrdenes
 * ANTES del evento de cancelación, para cada archivo de una orden.
 * Si no hay historial, devuelve 'Pendiente' como fallback.
 */
const getLastFileStatesBeforeCancel = async (transaction, ordenId) => {
    const res = await new sql.Request(transaction)
        .input('OID', sql.Int, ordenId)
        .query(`
            SELECT 
                AO.ArchivoID,
                AO.NombreArchivo,
                ISNULL(
                    (
                        SELECT TOP 1 H.Estado
                        FROM HistorialOrdenes H
                        WHERE H.OrdenID = @OID
                          AND H.Estado NOT IN ('Cancelado','CANCELADO','Archivo Cancelado')
                          AND H.FechaInicio < (
                              SELECT MIN(H2.FechaInicio) FROM HistorialOrdenes H2
                              WHERE H2.OrdenID = @OID AND H2.Estado IN ('Cancelado','CANCELADO','Archivo Cancelado')
                          )
                        ORDER BY H.FechaInicio DESC
                    ),
                    'Pendiente'
                ) AS EstadoRestaurar
            FROM ArchivosOrden AO
            WHERE AO.OrdenID = @OID AND AO.EstadoArchivo = 'CANCELADO'
        `);
    return res.recordset; // [{ ArchivoID, NombreArchivo, EstadoRestaurar }]
};

/**
 * Reactivar UN ARCHIVO individual.
 * - Restaura el EstadoArchivo al estado previo a la cancelación.
 * - Si la orden fue auto-cancelada por ese archivo (todos cancelados), reactiva la orden también.
 * - Nunca toca otras órdenes del pedido.
 */
exports.reactivateFile = async (req, res) => {
    const { fileId, usuario } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId requerido' });

    const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
    const safeUser = String(rawUser || 'Sistema').substring(0, 99);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener OrdenID + EstadoOrden actual
            const infoRes = await new sql.Request(transaction)
                .input('FID', sql.Int, fileId)
                .query(`
                    SELECT AO.OrdenID, AO.NombreArchivo, O.Estado as EstadoOrden, O.Nota, O.Observaciones,
                           O.NoDocERP, O.MotivoCancelacionID, O.DetallesCancelacion
                    FROM ArchivosOrden AO
                    INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                    WHERE AO.ArchivoID = @FID
                `);
            if (!infoRes.recordset.length) throw new Error('Archivo no encontrado');

            const { OrdenID, EstadoOrden, Nota, Observaciones, NoDocERP } = infoRes.recordset[0];

            // 2. Determinar estado a restaurar para ESTE archivo
            const histRes = await new sql.Request(transaction)
                .input('OID', sql.Int, OrdenID)
                .query(`
                    SELECT TOP 1 Estado FROM HistorialOrdenes
                    WHERE OrdenID = @OID
                      AND Estado NOT IN ('Cancelado','CANCELADO','Archivo Cancelado')
                    ORDER BY FechaInicio DESC
                `);
            const estadoRestaurar = histRes.recordset[0]?.Estado || 'Pendiente';

            // 3. Restaurar el archivo
            await new sql.Request(transaction)
                .input('FID', sql.Int, fileId)
                .input('Estado', sql.VarChar(50), estadoRestaurar)
                .input('User', sql.VarChar(100), safeUser)
                .query(`
                    UPDATE ArchivosOrden
                    SET EstadoArchivo = @Estado,
                        MotivoCancelacionID = NULL,
                        DetallesCancelacion = NULL,
                        Observaciones = TRIM(
                            REPLACE(REPLACE(REPLACE(
                                ISNULL(Observaciones,''),
                                ' [CANCELADO]', ''), ' [ORDEN CANCELADA]', ''), ' [PEDIDO CANCELADO]', '')
                        ),
                        UsuarioControl = @User,
                        FechaControl = GETDATE()
                    WHERE ArchivoID = @FID
                `);

            // 4. ¿La orden fue auto-cancelada porque todos los archivos estaban cancelados?
            let orderReactivated = false;
            const esOrdenCancelada = (EstadoOrden || '').toUpperCase().includes('CANCELAD');
            if (esOrdenCancelada) {
                // Verificar si había otros archivos no cancelados ANTES de este (es decir, si auto-canceló)
                const otrosRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, OrdenID)
                    .input('FID', sql.Int, fileId)
                    .query(`
                        SELECT COUNT(*) as Cnt FROM ArchivosOrden
                        WHERE OrdenID = @OID AND ArchivoID != @FID AND EstadoArchivo != 'CANCELADO'
                    `);
                // Si no hay otros activos aún => la orden estaba auto-cancelada, la reactivamos
                if (otrosRes.recordset[0].Cnt === 0) {
                    const notaLimpia = (Nota || '')
                        .replace(/ \[CANCELADO:[^\]]*\]/g, '')
                        .replace(/ \[AUTO-CANCEL:[^\]]*\]/g, '')
                        .trim();
                    const obsLimpia = (Observaciones || '')
                        .replace(/ \[CANCELADO:[^\]]*\]/g, '')
                        .replace(/ \[PEDIDO CANCELADO:[^\]]*\]/g, '')
                        .replace(/ \[AUTO-CANCEL:[^\]]*\]/g, '')
                        .trim();

                    await new sql.Request(transaction)
                        .input('OID', sql.Int, OrdenID)
                        .input('Nota', sql.NVarChar, notaLimpia)
                        .input('Obs', sql.NVarChar, obsLimpia)
                        .query(`
                            UPDATE Ordenes
                            SET Nota = @Nota,
                                Observaciones = @Obs,
                                MotivoCancelacionID = NULL,
                                DetallesCancelacion = NULL
                            WHERE OrdenID = @OID
                        `);
                    orderReactivated = true;
                }
            }

            // 5. Recalcular magnitud
            await recalculateOrderMagnitude(transaction, OrdenID);

            // 6. Log en historial
            // Historial via servicio central
            await changeOrderState(transaction, {
                target  : { type: 'ORDER', id: OrdenID },
                estado  : 'Pendiente',
                userObj : req.user || req.body.usuario,
                detalle : 'Archivo reactivado manualmente',
                io       : req.app.get('socketio')
            });

            await transaction.commit();

            // 7. Socket
            try {
                const io = req.app.get('socketio');
                if (io) io.emit('server:order_updated', { orderId: OrdenID });
            } catch (_) {}

            // 8. Sync ERP si corresponde
            if (NoDocERP) {
                try {
                    const ERPSyncService = require('../services/erpSyncService');
                    const userIdInt = typeof usuario === 'object' ? parseInt(usuario.UsuarioID || 1) : (parseInt(usuario) || 1);
                    await ERPSyncService.syncFinalOrderIntegration(NoDocERP, userIdInt, safeUser, null, { skipDeposito: true });
                } catch (e) { logger.error('ERP sync error on reactivateFile:', e); }
            }

            res.json({ success: true, estadoRestaurado: estadoRestaurar, orderReactivated });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error('❌ Error reactivateFile:', e);
        res.status(500).json({ error: e.message });
    }
};

/**
 * Reactivar UNA ORDEN completa.
 * - Restaura el estado de todos sus archivos cancelados al estado previo.
 * - Limpia Nota, Observaciones, MotivoCancelacionID, DetallesCancelacion de la orden.
 * - No toca otras órdenes del pedido.
 */
exports.reactivateOrder = async (req, res) => {
    const { orderId, usuario } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });

    const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
    const safeUser = String(rawUser || 'Sistema').substring(0, 99);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Datos de la orden
            const orderRes = await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .query(`SELECT Nota, Observaciones, NoDocERP FROM Ordenes WHERE OrdenID = @OID`);
            if (!orderRes.recordset.length) throw new Error('Orden no encontrada');

            const { Nota, Observaciones, NoDocERP } = orderRes.recordset[0];

            // 2. Leer snapshot de estado guardado antes de la cancelación
            const snapRes = await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .query(`
                    SELECT TOP 1 Detalle FROM HistorialOrdenes
                    WHERE OrdenID = @OID AND Estado = 'SNAPSHOT_PRE_CANCEL'
                    ORDER BY FechaInicio DESC
                `);
            let estadoRestaurar = 'Pendiente';
            let estadoAreaRestaurar = 'Pendiente';
            if (snapRes.recordset.length) {
                try {
                    const snap = JSON.parse(snapRes.recordset[0].Detalle);
                    if (snap.__snapshot__) {
                        estadoRestaurar = snap.Estado || 'Pendiente';
                        estadoAreaRestaurar = snap.EstadoenArea || 'Pendiente';
                    }
                } catch (_) {}
            }

            // 3. Restaurar archivos cancelados
            await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .input('Estado', sql.VarChar(50), estadoRestaurar)
                .input('User', sql.VarChar(100), safeUser)
                .query(`
                    UPDATE ArchivosOrden
                    SET EstadoArchivo = @Estado,
                        MotivoCancelacionID = NULL,
                        DetallesCancelacion = NULL,
                        Observaciones = TRIM(
                            REPLACE(REPLACE(REPLACE(
                                ISNULL(Observaciones,''),
                                ' [CANCELADO]', ''), ' [ORDEN CANCELADA]', ''), ' [PEDIDO CANCELADO]', '')
                        ),
                        UsuarioControl = @User,
                        FechaControl = GETDATE()
                    WHERE OrdenID = @OID AND EstadoArchivo = 'CANCELADO'
                `);

            // 4. Limpiar nota de cancelación en la orden
            const notaLimpia = (Nota || '')
                .replace(/ \[CANCELADO:[^\]]*\]/g, '')
                .replace(/ \[AUTO-CANCEL:[^\]]*\]/g, '')
                .trim();
            const obsLimpia = (Observaciones || '')
                .replace(/ \[CANCELADO:[^\]]*\]/g, '')
                .replace(/ \[PEDIDO CANCELADO:[^\]]*\]/g, '')
                .replace(/ \[AUTO-CANCEL:[^\]]*\]/g, '')
                .trim();

            // 5. Limpiar notas de cancelacion
            await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .input('Nota', sql.NVarChar, notaLimpia)
                .input('Obs', sql.NVarChar, obsLimpia)
                .query(`
                    UPDATE Ordenes
                    SET Nota = @Nota,
                        Observaciones = @Obs,
                        MotivoCancelacionID = NULL,
                        DetallesCancelacion = NULL
                    WHERE OrdenID = @OID
                `);

            // 6. Recalcular magnitud
            await recalculateOrderMagnitude(transaction, orderId);

            // Historial via servicio central
            await changeOrderState(transaction, {
                target  : { type: 'ORDER', id: orderId },
                estado  : estadoAreaRestaurar,
                userObj : req.user || req.body.usuario,
                detalle : 'Orden reactivada manualmente',
                io       : req.app.get('socketio')
            });

            await transaction.commit();

            try {
                const io = req.app.get('socketio');
                if (io) io.emit('server:order_updated', { orderId });
            } catch (_) {}

            if (NoDocERP) {
                try {
                    const ERPSyncService = require('../services/erpSyncService');
                    const userIdInt = typeof usuario === 'object' ? parseInt(usuario.UsuarioID || 1) : (parseInt(usuario) || 1);
                    await ERPSyncService.syncFinalOrderIntegration(NoDocERP, userIdInt, safeUser, null, { skipDeposito: true });
                } catch (e) { logger.error('ERP sync error on reactivateOrder:', e); }
            }

            res.json({ success: true, estadoRestaurado: estadoRestaurar });

            // Push al cliente: contraparte del aviso de cancelación ('Pedido cancelado'), para que se
            // entere de que su pedido volvió a estar activo. {code} lo reemplaza el servicio por el
            // CodigoOrden. Fire-and-forget: si falla, no afecta la reactivación (ya commiteada).
            pushService.sendToOrderClient(orderId, {
                title: 'Pedido reactivado',
                body: 'Tu pedido {code} fue reactivado y vuelve a estar en curso.',
                url: '/portal/pickup',
                actions: [{ action: 'pedidos', title: 'Ver mis pedidos' }],
                actionUrls: { pedidos: '/portal/factory' },
            }).catch(err => logger.error('[WebPush Trigger] Error:', err.message));

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error('❌ Error reactivateOrder:', e);
        res.status(500).json({ error: e.message });
    }
};

/**
 * Reactivar TODO EL PEDIDO (todas las órdenes con el mismo NoDocERP).
 * - Restaura estado de todas las órdenes canceladas y sus archivos.
 * - Limpia los campos de cancelación en todas las órdenes del pedido.
 */
exports.reactivateRequest = async (req, res) => {
    const { orderId, usuario } = req.body; // orderId para obtener NoDocERP
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });

    const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
    const safeUser = String(rawUser || 'Sistema').substring(0, 99);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener NoDocERP
            const docRes = await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .query(`SELECT NoDocERP FROM Ordenes WHERE OrdenID = @OID`);
            const noDoc = docRes.recordset[0]?.NoDocERP;
            if (!noDoc) throw new Error('No se encontró NoDocERP para esta orden');

            // 2. Obtener todas las órdenes canceladas del pedido
            const ordenesRes = await new sql.Request(transaction)
                .input('NoDoc', sql.VarChar(50), noDoc)
                .query(`
                    SELECT OrdenID, Nota, Observaciones
                    FROM Ordenes
                    WHERE NoDocERP = @NoDoc AND Estado IN ('Cancelado','CANCELADO')
                `);
            const ordenes = ordenesRes.recordset;

            for (const orden of ordenes) {
                // 3a. Leer snapshot de estado guardado antes de la cancelación
                const snapRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, orden.OrdenID)
                    .query(`
                        SELECT TOP 1 Detalle FROM HistorialOrdenes
                        WHERE OrdenID = @OID AND Estado = 'SNAPSHOT_PRE_CANCEL'
                        ORDER BY FechaInicio DESC
                    `);
                let estadoRestaurar = 'Pendiente';
                let estadoAreaRestaurar = 'Pendiente';
                if (snapRes.recordset.length) {
                    try {
                        const snap = JSON.parse(snapRes.recordset[0].Detalle);
                        if (snap.__snapshot__) {
                            estadoRestaurar = snap.Estado || 'Pendiente';
                            estadoAreaRestaurar = snap.EstadoenArea || 'Pendiente';
                        }
                    } catch (_) {}
                }

                // 3b. Restaurar archivos de esta orden
                await new sql.Request(transaction)
                    .input('OID', sql.Int, orden.OrdenID)
                    .input('Estado', sql.VarChar(50), estadoRestaurar)
                    .input('User', sql.VarChar(100), safeUser)
                    .query(`
                        UPDATE ArchivosOrden
                        SET EstadoArchivo = @Estado,
                            MotivoCancelacionID = NULL,
                            DetallesCancelacion = NULL,
                            Observaciones = TRIM(
                                REPLACE(REPLACE(REPLACE(
                                    ISNULL(Observaciones,''),
                                    ' [CANCELADO]', ''), ' [ORDEN CANCELADA]', ''), ' [PEDIDO CANCELADO]', '')
                            ),
                            UsuarioControl = @User,
                            FechaControl = GETDATE()
                        WHERE OrdenID = @OID AND EstadoArchivo = 'CANCELADO'
                    `);

                // 3c. Limpiar y restaurar la orden
                const notaLimpia = (orden.Nota || '')
                    .replace(/ \[CANCELADO:[^\]]*\]/g, '')
                    .replace(/ \[PEDIDO CANCELADO:[^\]]*\]/g, '')
                    .replace(/ \[AUTO-CANCEL:[^\]]*\]/g, '')
                    .trim();
                const obsLimpia = (orden.Observaciones || '')
                    .replace(/ \[CANCELADO:[^\]]*\]/g, '')
                    .replace(/ \[PEDIDO CANCELADO:[^\]]*\]/g, '')
                    .replace(/ \[AUTO-CANCEL:[^\]]*\]/g, '')
                    .trim();

                await new sql.Request(transaction)
                    .input('OID', sql.Int, orden.OrdenID)
                    .input('Nota', sql.NVarChar, notaLimpia)
                    .input('Obs', sql.NVarChar, obsLimpia)
                    .query(`
                        UPDATE Ordenes
                        SET Nota = @Nota,
                            Observaciones = @Obs,
                            MotivoCancelacionID = NULL,
                            DetallesCancelacion = NULL
                        WHERE OrdenID = @OID
                    `);

                // 3d. Recalcular magnitud
                await recalculateOrderMagnitude(transaction, orden.OrdenID);

                // Historial via servicio central
                await changeOrderState(transaction, {
                    target  : { type: 'ORDER', id: orden.OrdenID },
                    estado  : estadoAreaRestaurar,
                    userObj : req.user || req.body.usuario,
                    detalle : 'Pedido reactivado manualmente',
                io       : req.app.get('socketio')
            });
            }

            await transaction.commit();

            // Socket + ERP sync
            try {
                const io = req.app.get('socketio');
                if (io) ordenes.forEach(o => io.emit('server:order_updated', { orderId: o.OrdenID }));
            } catch (_) {}

            try {
                const ERPSyncService = require('../services/erpSyncService');
                const userIdInt = typeof usuario === 'object' ? parseInt(usuario.UsuarioID || 1) : (parseInt(usuario) || 1);
                await ERPSyncService.syncFinalOrderIntegration(noDoc, userIdInt, safeUser, null, { skipDeposito: true });
            } catch (e) { logger.error('ERP sync error on reactivateRequest:', e); }

            res.json({ success: true, ordenesReactivadas: ordenes.length });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        logger.error('❌ Error reactivateRequest:', e);
        res.status(500).json({ error: e.message });
    }
};
