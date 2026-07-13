const { getPool, sql } = require('../config/db');
const { changeOrderState } = require('../services/stateManagerService');
const { validarMetrosFalla } = require('../services/fallaValidationService');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const fileProcessingService = require('../services/fileProcessingService');
const logger = require('../utils/logger');

// --- HELPERS CONSTANTS ---
const pointsToCm = (points) => (points / 72) * 2.54;
const pixelsToCm = (pixels, dpi) => (pixels / dpi) * 2.54;
const cmToM = (cm) => cm / 100;

// Extraer ID de Drive
const getDriveId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:id=|\/d\/)([\w-]+)/);
    return match ? match[1] : null;
};

// ==========================================
// 1. TABLERO KANBAN (ASIGNACIÓN)
// ==========================================
exports.getProductionBoard = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();
        const machines = await pool.request().input('Area', sql.VarChar, area)
            .query("SELECT EquipoID as id, Nombre as name, CASE WHEN EstadoProceso = 'Detenido' THEN 'OK' ELSE EstadoProceso END as status FROM dbo.ConfigEquipos WHERE AreaID = @Area AND Activo = 1");

        const rolls = await pool.request().input('Area', sql.VarChar, area)
            .query(`SELECT R.*, R.RolloID as id, R.Codigo as rollCode, 
                   (SELECT COUNT(*) FROM dbo.Ordenes WHERE RolloID = R.RolloID) as ordersCount
                   FROM dbo.Rollos R WHERE R.AreaID = @Area AND R.Estado NOT IN ('Cerrado', 'Finalizado')`);

        res.json({
            machines: machines.recordset.map(m => ({
                ...m,
                rolls: rolls.recordset.filter(r => String(r.MaquinaID) === String(m.id))
            })),
            pendingRolls: rolls.recordset.filter(r => !r.MaquinaID)
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// ==========================================
// 2. CONTROL DE TIEMPOS (PLAY/PAUSE)
// ==========================================
const { registrarAuditoria, registrarHistorialOrden } = require('../services/trackingService');

// Guarda para los cambios de estado a nivel LOTE (iniciar/pausar/finalizar/mover):
// las órdenes ya resueltas dentro del lote (controladas Pronto, con falla esperando
// reposición, finalizadas, canceladas, entregadas) conservan su estado — p. ej.
// finalizar la máquina NO debe sacarle el 'Pronto' a una orden ya controlada.
const GUARD_ORDENES_RESUELTAS =
    "ISNULL(EstadoenArea,'') NOT IN ('Pronto','Con Falla','Retenido','Finalizado','Entregado','Avisado','Para Avisar','Cancelado') " +
    "AND Estado NOT IN ('Finalizado','Cancelado','Entregado')";

exports.toggleRollStatus = async (req, res) => {
    try {
        const { rollId, action, destination } = req.body;
        const userId = req.user ? req.user.id : (req.body.userId || 1);
        const ip = req.ip || req.connection.remoteAddress;

        logger.info(`[toggleRollStatus] START - RollID: ${rollId}, Action: ${action}`);

        // Basic Validation
        if (!rollId || !action) {
            return res.status(400).json({ error: "Falta rollId o action en la solicitud." });
        }

        let transaction;
        try {
            const pool = await getPool();
            transaction = new sql.Transaction(pool);
            await transaction.begin();
            const request = new sql.Request(transaction);

            // 1. Obtener informacin actual del Rollo y su Maquina
            // Use logic to handle potential string/int IDs based on usage (Schema usually VarChar or Int, sticking to DB.js usage)
            // Adjust query to handle flexible ID types.
            const rollInfo = await request
                .input('RID_GET', sql.VarChar(50), String(rollId))
                .query(`SELECT r.RolloID, r.MaquinaID, r.BobinaID, r.AreaID, c.EstadoProceso, c.Nombre as NombreEquipo
                    FROM dbo.Rollos r
                    LEFT JOIN dbo.ConfigEquipos c ON r.MaquinaID = c.EquipoID
                    WHERE CAST(r.RolloID AS VARCHAR(50)) = @RID_GET OR r.Nombre = @RID_GET`);

            if (rollInfo.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: "El rollo no existe." });
            }

            const currentRoll = rollInfo.recordset[0];
            // "ponme a tomar de la base" - Usamos estrictamente lo que diga la configuración del equipo
            // Si en la base dice 'Detenido' por error, usará 'Detenido' hasta que se corrija el dato maestro.
            let machineStatus = currentRoll.EstadoProceso || 'Produccion';

            if (action === 'start') {
                // === VALIDACIÓN MAQUINA ===
                if (!currentRoll.MaquinaID) {
                    await transaction.rollback();
                    return res.status(400).json({ error: "No se puede iniciar un rollo que no está asignado a una máquina (está en mesa)." });
                }

                // === VALIDACIÓN DE BOBINA (REMOVIDA/ADAPTADA A SLOTS) ===
                // Ahora verificamos si la máquina tiene una bobina montada y la asignamos al rollo automáticamente.
                // Si no tiene, PERMITIMOS INICIAR igual (usuario asume responsabilidad o es material sin control).

                const slotRes = await new sql.Request(transaction)
                    .input('EqID', sql.Int, currentRoll.MaquinaID)
                    .query("SELECT TOP 1 BobinaMontadaID FROM SlotsMaquina WHERE EquipoID = @EqID AND Tipo = 'BOBINA' AND BobinaMontadaID IS NOT NULL ORDER BY OrdenVisual");

                if (slotRes.recordset.length > 0) {
                    const activeBobinaId = slotRes.recordset[0].BobinaMontadaID;
                    logger.info(`[toggleRollStatus] Auto-assigning Bobina ${activeBobinaId} from Machine Slot to Roll ${rollId}`);

                    await new sql.Request(transaction)
                        .input('NewBID', sql.Int, activeBobinaId)
                        .input('RID_Upd', sql.VarChar(50), currentRoll.RolloID.toString())
                        .query("UPDATE dbo.Rollos SET BobinaID = @NewBID WHERE CAST(RolloID AS VARCHAR(50)) = @RID_Upd");

                    // Actualizamos currentRoll para que el resto de la lógica (si la hubiera) tenga el ID
                    currentRoll.BobinaID = activeBobinaId;
                } else {
                    logger.warn(`[toggleRollStatus] Warning: Machine ${currentRoll.MaquinaID} has no bobina mounted in slots. Starting Roll ${rollId} without specific BobinaID.`);
                }
                // ============================

                // === START ===
                // Roll: Estado -> 'En maquina', FechaInicioProduccion -> Now
                await new sql.Request(transaction)
                    .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                    .query(`UPDATE dbo.Rollos
                        SET Estado = 'En maquina',
                        FechaInicioProduccion = GETDATE()
                        WHERE CAST(RolloID AS VARCHAR(50)) = @RID`);

                // Estampar la máquina en TODAS las órdenes del lote al iniciar producción.
                // Garantiza que toda orden que se produce registre en qué máquina se hizo, sin depender
                // de cómo/cuándo entró al lote (al asignar el lote podían no quedar cubiertas las órdenes
                // agregadas después). Este es el momento real de producción.
                await new sql.Request(transaction)
                    .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                    .input('MID', sql.Int, currentRoll.MaquinaID)
                    .query('UPDATE dbo.Ordenes SET MaquinaID = @MID WHERE CAST(RolloID AS VARCHAR(50)) = @RID');

                // Bitacora Logic
                const resID = await new sql.Request(transaction).query("SELECT ISNULL(MAX(BitacoraID), 0) + 1 as NewID FROM dbo.BitacoraProduccion");
                const newBitacoraID = resID.recordset[0].NewID;

                await new sql.Request(transaction)
                    .input('BID', sql.Int, newBitacoraID)
                    .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                    .input('MID', sql.Int, currentRoll.MaquinaID)
                    .input('UID', sql.Int, userId)
                    .query(`INSERT INTO dbo.BitacoraProduccion (BitacoraID, RolloID, MaquinaID, UsuarioID, FechaInicio) 
                        VALUES (@BID, @RID, @MID, @UID, GETDATE())`);

                // Estado + historial via servicio central
                await changeOrderState(transaction, {
                    target   : { type: 'ROLL', id: currentRoll.RolloID },
                    estado   : 'En Maquina',
                    userObj  : req.user,
                    detalle  : 'Inicio Produccion - Maquina {maquina} / Lote {rollo}',
                    maquinaId: currentRoll.MaquinaID,
                    rolloId  : currentRoll.RolloID,
                    guard    : GUARD_ORDENES_RESUELTAS,
                    io       : req.app.get('socketio'),
                });
                await registrarAuditoria(transaction, userId, 'INICIO_PRODUCCION', `Rollo ${rollId} iniciado`, ip);

            } else if (action === 'pause') {
                // === PAUSE ===
                await new sql.Request(transaction)
                    .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                    .query("UPDATE dbo.Rollos SET Estado = 'Pausado' WHERE CAST(RolloID AS VARCHAR(50)) = @RID");

                // Close Bitacora
                await new sql.Request(transaction)
                    .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                    .query("UPDATE dbo.BitacoraProduccion SET FechaFin = GETDATE() WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND FechaFin IS NULL");

                // Estado + historial via servicio central (sigue En Maquina, detenida)
                await changeOrderState(transaction, {
                    target  : { type: 'ROLL', id: currentRoll.RolloID },
                    estado  : 'En Maquina',
                    userObj : req.user,
                    detalle : 'Produccion Pausada - Lote {rollo}',
                    rolloId : currentRoll.RolloID,
                    guard   : GUARD_ORDENES_RESUELTAS,
                    io      : req.app.get('socketio'),
                });
                await registrarAuditoria(transaction, userId, 'PAUSA_PRODUCCION', `Rollo ${rollId} pausado`, ip);

            } else if (action === 'finish') {
                // === FINISH ===

                // === VALIDACIÓN: metros del grupo de falla OBLIGATORIOS al finalizar en una máquina ===
                // Si el lote tiene órdenes -F, no se puede finalizar (pasar a calandra o enviar a calidad)
                // hasta que el grupo de falla tenga su total y cada orden -F su metraje.
                // No aplica a 'production' (devolver a la cola es una corrección, no una finalización).
                // La misma validación se corre al ASIGNAR un lote a una calandra (productionKanbanController),
                // para que arrastrarlo no saltee este control.
                if (destination !== 'production') {
                    const chk = await validarMetrosFalla(transaction, currentRoll.RolloID);
                    if (chk.falta) {
                        await transaction.rollback();
                        return res.status(400).json({ error: `No se puede finalizar el lote: falta cargar ${chk.motivo}.` });
                    }
                }

                // Opción A: Devolver a Producción (No Calidad)
                if (destination === 'production') {
                    await new sql.Request(transaction)
                        .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                        .query("UPDATE dbo.Rollos SET Estado = 'En Cola', MaquinaID = NULL WHERE CAST(RolloID AS VARCHAR(50)) = @RID");

                    await new sql.Request(transaction).input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                        .query("UPDATE dbo.BitacoraProduccion SET FechaFin = GETDATE() WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND FechaFin IS NULL");

                    // MaquinaID se conserva en Ordenes — se actualiza al reasignar el rollo a otra máquina

                    // Estado + historial via servicio central
                    await changeOrderState(transaction, {
                        target  : { type: 'ROLL', id: currentRoll.RolloID },
                        estado  : 'En Lote',
                        userObj : req.user,
                        detalle : 'Fin Proceso - Retorna a Cola / Lote {rollo}',
                        rolloId : currentRoll.RolloID,
                        guard   : GUARD_ORDENES_RESUELTAS,
                        io      : req.app.get('socketio'),
                    });

                } else if (destination === 'calender') {
                    // Opción C: finalizó en una IMPRESORA → el lote continúa en una CALANDRA:
                    // una máquina cuyo NOMBRE empiece con "calandra" (la de menos cola), no cualquier no-impresora.
                    const calRes = await new sql.Request(transaction)
                        .input('Area', sql.VarChar, currentRoll.AreaID)
                        .query(`
                            SELECT TOP 1 e.EquipoID
                            FROM dbo.ConfigEquipos e
                            WHERE e.AreaID = @Area AND e.Activo = 1 AND LTRIM(LOWER(e.Nombre)) LIKE 'calandra%'
                            ORDER BY (
                                SELECT COUNT(*) FROM dbo.Rollos r
                                WHERE r.MaquinaID = e.EquipoID AND r.Estado NOT IN ('Finalizado','Cerrado','Cancelado')
                            ) ASC, e.EquipoID ASC
                        `);
                    const calenderId = calRes.recordset[0]?.EquipoID || null;

                    // Cierre de la bitácora de impresión (en ambos casos).
                    await new sql.Request(transaction).input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                        .query("UPDATE dbo.BitacoraProduccion SET FechaFin = GETDATE() WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND FechaFin IS NULL");

                    if (calenderId) {
                        // Reasignar el rollo a la calandra: queda En Cola, listo para arrancar ahí.
                        await new sql.Request(transaction)
                            .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                            .input('MID', sql.Int, calenderId)
                            .query("UPDATE dbo.Rollos SET Estado = 'En Cola', MaquinaID = @MID WHERE CAST(RolloID AS VARCHAR(50)) = @RID");
                        await new sql.Request(transaction)
                            .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                            .input('MID', sql.Int, calenderId)
                            .query(`UPDATE dbo.Ordenes SET MaquinaID = @MID WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND ${GUARD_ORDENES_RESUELTAS}`);
                        await changeOrderState(transaction, {
                            target   : { type: 'ROLL', id: currentRoll.RolloID },
                            estado   : 'En Maquina', // el lote ya está en la calandra (una máquina) → En Maquina, no En Lote
                            userObj  : req.user,
                            detalle  : 'Fin Impresion - Pasa a Calandra {rollo} - Maquina {maquina}',
                            rolloId  : currentRoll.RolloID,
                            maquinaId: calenderId,
                            guard    : GUARD_ORDENES_RESUELTAS,
                            io       : req.app.get('socketio')
                        });
                        await registrarAuditoria(transaction, userId, 'FIN_IMPRESION_A_CALANDRA', `Rollo ${rollId} pasó a calandra ${calenderId}`, ip);
                    } else {
                        // Sin calandra disponible → vuelve a la cola (Mesa de Armado) para no perder el rollo.
                        await new sql.Request(transaction)
                            .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                            .query("UPDATE dbo.Rollos SET Estado = 'En Cola', MaquinaID = NULL WHERE CAST(RolloID AS VARCHAR(50)) = @RID");
                        await new sql.Request(transaction)
                            .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                            .query(`UPDATE dbo.Ordenes SET MaquinaID = NULL WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND ${GUARD_ORDENES_RESUELTAS}`);
                        await changeOrderState(transaction, {
                            target  : { type: 'ROLL', id: currentRoll.RolloID },
                            estado  : 'En Lote',
                            userObj : req.user,
                            detalle : 'Fin Impresion - Sin calandra disponible, vuelve a la cola {rollo}',
                            rolloId : currentRoll.RolloID,
                            guard   : GUARD_ORDENES_RESUELTAS,
                            io      : req.app.get('socketio')
                        });
                    }

                } else {
                    // Opción B: FINALIZAR COMPLETAMENTE (ENVIAR A CALIDAD) - Default
                    // El Rollo pasa a Finalizado pero conserva MaquinaID para historial
                    await new sql.Request(transaction)
                        .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                        .query(`UPDATE dbo.Rollos SET Estado = 'Finalizado' WHERE CAST(RolloID AS VARCHAR(50)) = @RID`);

                    await new sql.Request(transaction).input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                        .query("UPDATE dbo.BitacoraProduccion SET FechaFin = GETDATE() WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND FechaFin IS NULL");

                    // Estado + historial via servicio central (MaquinaID y RolloID se conservan en Ordenes)
                    await changeOrderState(transaction, {
                        target   : { type: 'ROLL', id: currentRoll.RolloID },
                        estado   : 'Control y Calidad',
                        userObj  : req.user,
                        detalle  : 'Fin Impresion - Enviado a Control / Lote {rollo} - Maquina {maquina}',
                        rolloId  : currentRoll.RolloID,
                        maquinaId: currentRoll.MaquinaID,
                        guard    : GUARD_ORDENES_RESUELTAS,
                        io       : req.app.get('socketio'),
                    });
                    await registrarAuditoria(transaction, userId, 'FIN_PRODUCCION', `Rollo ${rollId} finalizado`, ip);
                }
            }

            await transaction.commit();
            res.json({ success: true });

        } catch (err) {
            if (transaction) await transaction.rollback();
            logger.error("Error toggleRollStatus:", err);
            // Important: Return JSON error so frontend (Axios) can display it nicely
            res.status(500).json({ error: err.message });
        }
    } catch (outerErr) {
        logger.error("❌ CRITICAL UNCAUGHT ERROR in toggleRollStatus:", outerErr);
        // Ensure response is sent if not already
        if (!res.headersSent) {
            res.status(500).json({ error: "Critical Error: " + outerErr.message });
        }
    }
};

// Helper inside closure or file scope to avoid code duplication
async function registerHistoryForOrders(transaction, rollId, estado, userId, detalle) {
    const req = new sql.Request(transaction);
    const res = await req.input('RID_H', sql.Int, rollId).query("SELECT OrdenID FROM dbo.Ordenes WHERE RolloID = @RID_H");
    for (const o of res.recordset) {
        await registrarHistorialOrden(transaction, o.OrdenID, estado, userId, detalle);
    }
}

// ==========================================
// 3. CONTROL DE CALIDAD / ARCHIVOS
// ==========================================
exports.getRollAndFiles = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();
        const result = await pool.request().input('Area', sql.VarChar, area).query(`
            SELECT R.Nombre as RollName, O.Cliente, A.* FROM dbo.ArchivosOrden A
            JOIN dbo.Ordenes O ON A.OrdenID = O.OrdenID
            JOIN dbo.Rollos R ON O.RolloID = R.RolloID
            WHERE R.AreaID = @Area AND R.Estado = 'Finalizado'
        `);
        const mappedFiles = result.recordset.map(archivo => {
            if (archivo.RutaAlmacenamiento && archivo.RutaAlmacenamiento.includes('drive.google.com')) {
                return {
                    ...archivo,
                    urlProxy: `/api/production-file-control/view-drive-file?url=${encodeURIComponent(archivo.RutaAlmacenamiento)}`
                };
            }
            return archivo;
        });
        res.json(mappedFiles);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.registerFileAction = async (req, res) => {
    const { fileId, action } = req.body;
    try {
        const pool = await getPool();
        await pool.request().input('ID', sql.Int, fileId).input('Status', sql.VarChar, action)
            .query("UPDATE dbo.ArchivosOrden SET Estado = @Status WHERE ArchivoID = @ID");
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// ==========================================
// 4. FUNCIONES DE APOYO (ASIGNACIÓN Y TABLA)
// ==========================================

exports.getOrderDetails = async (req, res) => {
    const { orderId } = req.query;
    logger.info(`[productionController] Obteniendo detalles para OrderID: ${orderId}`);
    try {
        const pool = await getPool();
        // Frontend fetch expects direct array of files
        // Fetch files for the given orderId
        const files = await pool.request()
            .input('ID', sql.Int, orderId)
            .query("SELECT * FROM dbo.ArchivosOrden WHERE OrdenID = @ID");

        logger.info(`[productionController] Archivos encontrados: ${files.recordset.length}`);

        const mappedFiles = files.recordset.map(archivo => {
            if (archivo.RutaAlmacenamiento && archivo.RutaAlmacenamiento.includes('drive.google.com')) {
                return {
                    ...archivo,
                    urlProxy: `/api/production-file-control/view-drive-file?url=${encodeURIComponent(archivo.RutaAlmacenamiento)}`
                };
            }
            return archivo;
        });

        // Return only the files array
        res.json(mappedFiles);
    } catch (err) {
        logger.error(`[productionController] Error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
};

// Stubs para evitar errores de Undefined en el Router
exports.getBoardData = async (req, res) => { res.json([]); };
exports.moveOrder = async (req, res) => { res.json({ success: true }); };
exports.createRoll = async (req, res) => { res.json({ success: true }); };
exports.reorderOrders = async (req, res) => { res.json({ success: true }); };
exports.updateRollName = async (req, res) => { res.json({ success: true }); };
exports.getMachines = async (req, res) => { res.json([]); };

// ==========================================
// 5. MAGIC SORT (Armado Automático)
// ==========================================
exports.magicSort = async (req, res) => {
    const { areaCode, selectedIds } = req.body;
    const userId = req.user ? req.user.id : (req.body.userId || 1);
    const ip = req.ip || req.connection.remoteAddress;

    // Normalize Area Code
    let targetArea = areaCode;
    // if (areaCode === 'DF') targetArea = 'DTF'; 

    if (!['ECOUV', 'DTF', 'DF', 'DIRECTA'].includes(targetArea)) {
        return res.status(400).json({ error: 'La lógica mágica solo está definida para ECOUV, DTF, DF e Impresión Directa por el momento.' });
    }

    if (!selectedIds || !Array.isArray(selectedIds) || selectedIds.length === 0) {
        return res.status(400).json({ error: 'Debe seleccionar al menos una orden para utilizar Magic Sort.' });
    }

    try {
        const pool = await getPool();

        logger.info("--- INICIANDO SECUENCIA MAGIC SORT (SECUENCIAL) ---");

        // ---------------------------------------------------------
        // PASO 0: PREPARACIÓN Y CLASIFICACIÓN
        // ---------------------------------------------------------

        // Sanitize IDs
        const safeIds = selectedIds.map(id => Number(id)).filter(n => !isNaN(n));
        if (safeIds.length === 0) return res.status(400).json({ error: 'IDs inválidos.' });

        const pendingRes = await pool.request().input('Area', sql.VarChar, targetArea)
            .query(`
                SELECT OrdenID, CodigoOrden, Variante, Tinta, Prioridad, Magnitud, Material, Cliente, DescripcionTrabajo 
                FROM dbo.Ordenes 
                WHERE AreaID = @Area 
                AND Estado = 'Pendiente' 
                AND RolloID IS NULL 
                AND OrdenID IN (${safeIds.join(',')})
            `);

        const allPending = pendingRes.recordset;
        if (allPending.length === 0) {
            return res.json({ success: true, message: 'No hay órdenes pendientes seleccionadas válidas para agrupar.' });
        }

        // Helper Prioridad
        const priorityScore = (p) => {
            const s = (p || '').toLowerCase();
            if (s.includes('falla')) return 4;
            if (s.includes('urgente')) return 3;
            if (s.includes('reposici')) return 2;
            return 1;
        };
        const sortFn = (a, b) => priorityScore(b.Prioridad) - priorityScore(a.Prioridad);

        // Agrupación (Simplificada para ejemplo, expandible)
        const groups = { terminaciones: [], uv: [], ecosolvente: [] };
        const processedIds = new Set();

        groups.terminaciones = allPending.filter(o => (o.Variante || '').toLowerCase().includes('materiales extra gran formato')).sort(sortFn);
        groups.terminaciones.forEach(o => processedIds.add(o.OrdenID));

        groups.uv = allPending.filter(o => !processedIds.has(o.OrdenID) && (o.Tinta || '').toUpperCase() === 'UV').sort(sortFn);
        groups.uv.forEach(o => processedIds.add(o.OrdenID));

        groups.ecosolvente = allPending.filter(o => !processedIds.has(o.OrdenID) && ((o.Tinta || '').toLowerCase().includes('ecosolvente') || (o.Material || '').toLowerCase().includes('lona frontlight'))).sort(sortFn);

        const groupByMaterial = (orders) => {
            const grouped = {};
            orders.forEach(o => {
                const mat = (o.Material || 'GENERICO').toUpperCase().trim();
                if (!grouped[mat]) grouped[mat] = [];
                grouped[mat].push(o);
            });
            return grouped;
        };

        // ---------------------------------------------------------
        // LOGICA SECUENCIAL
        // ---------------------------------------------------------

        let createdRollsCount = 0;
        let assignedRollsCount = 0;

        // Función "Interna" que simula el Crear Lote Manual
        // Retorna el ID del rollo creado para pasarlo al siguiente paso
        const step1_createBatch = async (transaction, orders, config, materialName) => {
            if (!orders || orders.length === 0) return null;
            const { namePrefix } = config;

            // 1.1 Asignación de Bobina (Valor Agregado del Automático)
            let assignedBobinaId = null;
            try {
                const totalMeters = orders.reduce((acc, o) => acc + (parseFloat((o.Magnitud || '0').replace(/[^\d.]/g, '')) || 0), 0);
                const insumoRes = await new sql.Request(transaction).input('MatName', sql.NVarChar, `%${materialName.trim()}%`).query("SELECT TOP 1 InsumoID FROM Insumos WHERE Nombre LIKE @MatName OR CodigoReferencia LIKE @MatName OR Categoria LIKE @MatName");

                if (insumoRes.recordset.length > 0) {
                    const insumoId = insumoRes.recordset[0].InsumoID;
                    const bobinaRes = await new sql.Request(transaction).input('IID', sql.Int, insumoId).input('Area', sql.VarChar, targetArea)
                        .query(`SELECT TOP 1 BobinaID, MetrosRestantes FROM InventarioBobinas WHERE InsumoID = @IID AND (Estado = 'Disponible' OR Estado = 'En Uso') AND MetrosRestantes >= ${totalMeters} AND (AreaID = @Area OR AreaID IS NULL) ORDER BY FechaIngreso ASC`);

                    if (bobinaRes.recordset.length > 0) {
                        assignedBobinaId = bobinaRes.recordset[0].BobinaID;
                        await new sql.Request(transaction).input('BID', sql.Int, assignedBobinaId).query("UPDATE InventarioBobinas SET Estado = 'En Uso' WHERE BobinaID = @BID");
                    }
                }
            } catch (e) { logger.warn("Bobina auto-assign warning:", e.message); }

            // 1.2 Crear Rollo (ESTADO: ABIERTO - MESA DE ARMADO)
            const displayId = Math.floor(Math.random() * 1000);
            const cleanMat = (materialName || '').replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 20);
            const rollName = `Auto ${namePrefix} (${cleanMat}) ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} - ID:${displayId}`;

            const insertRes = await new sql.Request(transaction)
                .input('Nombre', sql.NVarChar(100), rollName)
                .input('AreaID', sql.VarChar(20), targetArea)
                .input('Color', sql.VarChar(10), '#8b5cf6')
                .input('BobinaID', sql.Int, assignedBobinaId)
                // NO ASIGNAMOS MAQUINA AUN (MaquinaID = NULL)
                .query(`INSERT INTO dbo.Rollos (Nombre, AreaID, CapacidadMaxima, ColorHex, Estado, MaquinaID, FechaCreacion, BobinaID) OUTPUT INSERTED.RolloID VALUES (@Nombre, @AreaID, 100, @Color, 'Abierto', NULL, GETDATE(), @BobinaID)`);

            const newRollId = insertRes.recordset[0].RolloID;

            // 1.3 Asignar Órdenes al Rollo (ESTADO: EN LOTE)
            let seq = 1;
            for (const order of orders) {
                await new sql.Request(transaction)
                    .input('OID', sql.Int, order.OrdenID)
                    .input('RID', sql.Int, newRollId)
                    .input('Seq', sql.Int, seq)
                    .query('UPDATE dbo.Ordenes SET RolloID = @RID, Secuencia = @Seq, MaquinaID = NULL WHERE OrdenID = @OID');

                // Estado + historial via servicio central
                await changeOrderState(transaction, {
                    target  : { type: 'ORDER', id: order.OrdenID },
                    estado  : 'En Lote',
                    userObj : req.user,
                    detalle : 'Asignado a Lote {rollo}',
                    rolloId : newRollId,
                io       : req.app.get('socketio'),
                io       : req.app.get('socketio')
            });
                seq++;
            }

            createdRollsCount++;
            return newRollId;
        };

        // Función "Interna" que simula el Asignar Máquina Manual
        const step2_assignMachine = async (transaction, rollId, config) => {
            if (!rollId) return false;
            const { machineKeyword } = config;

            // 2.1 Buscar Máquina
            const mRes = await new sql.Request(transaction).query(`SELECT TOP 1 EquipoID, Nombre FROM dbo.ConfigEquipos WHERE AreaID = 'ECOUV' AND Nombre LIKE '%${machineKeyword}%' AND Activo = 1`);
            const machine = mRes.recordset[0];

            if (!machine) {
                logger.info(`[MagicSort] No se encontró máquina para Rollo ${rollId} (KW: ${machineKeyword}). Se queda en Mesa de Armado.`);
                return false;
            }

            // 2.2 Ejecutar Lógica de Asignación (Replica assignRoll)
            const machineStatus = 'En Cola';

            // Update Rollo
            await new sql.Request(transaction).input('RID', sql.Int, rollId).input('MID', sql.Int, machine.EquipoID).input('St', sql.VarChar, machineStatus)
                .query("UPDATE dbo.Rollos SET MaquinaID = @MID WHERE RolloID = @RID"); // Nota: Estado del rollo suele mantenerse 'Abierto' hasta que entra a produccion real o se pausa, o segun logica manual.

            // Actualizar solo MaquinaID (gestion de equipo)
            await new sql.Request(transaction)
                .input('RID', sql.Int, rollId)
                .input('MID', sql.Int, machine.EquipoID)
                .query('UPDATE dbo.Ordenes SET MaquinaID = @MID WHERE RolloID = @RID');

            // Estado + historial via servicio central
            await changeOrderState(transaction, {
                target   : { type: 'ROLL', id: rollId },
                estado   : 'En Maquina',
                userObj  : req.user,
                detalle  : 'Asignado a Maquina {maquina} / Lote {rollo}',
                maquinaId: machine.EquipoID,
                rolloId  : rollId,
                io       : req.app.get('socketio'),
                io       : req.app.get('socketio')
            });

            assignedRollsCount++;
            return true;
        };

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Ejecutar Secuencia por Grupo
            const processFullSequence = async (list, config, mat) => {
                // PASO 1: CREAR LOTE
                const rollId = await step1_createBatch(transaction, list, config, mat);

                // PASO 2: ASIGNAR MAQUINA (Si se creó lote)
                if (rollId) {
                    await step2_assignMachine(transaction, rollId, config);
                }
                return list.length;
            };

            if (targetArea === 'DIRECTA') {
                // IMPRESIÓN DIRECTA: criterio igual a DTF — un lote por material.
                // Sin agrupación por tinta y sin asignación automática de máquina
                // (step2 busca equipos ECOUV): los lotes quedan en Mesa de Armado.
                for (const [mat, list] of Object.entries(groupByMaterial(allPending))) {
                    await step1_createBatch(transaction, list, { namePrefix: 'Directa' }, mat);
                }
            } else {
                // Terminaciones
                for (const [mat, list] of Object.entries(groupByMaterial(groups.terminaciones))) {
                    await processFullSequence(list, { namePrefix: 'Term', machineKeyword: 'Terminaciones ECOUV' }, mat);
                }
                // UV
                for (const [mat, list] of Object.entries(groupByMaterial(groups.uv))) {
                    await processFullSequence(list, { namePrefix: 'UV', machineKeyword: 'UV' }, mat);
                }
                // Eco
                for (const [mat, list] of Object.entries(groupByMaterial(groups.ecosolvente))) {
                    await processFullSequence(list, { namePrefix: 'Eco', machineKeyword: 'Ecosolvente' }, mat);
                }
            }

            await registrarAuditoria(transaction, userId, 'MAGIC_SORT_SEQ', `Magic Sort Secuencial: ${createdRollsCount} lotes creados, ${assignedRollsCount} asignados.`, ip);
            await transaction.commit();

            res.json({
                success: true,
                message: `Proceso completado. ${createdRollsCount} lotes generados (${assignedRollsCount} asignados a máquina).`
            });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        logger.error("Error MagicSort:", err);
        res.status(500).json({ error: err.message });
    }
};
exports.getGroupedOrderDetails = async (req, res) => { res.json([]); };

exports.measureFiles = async (req, res) => {
    const { fileIds } = req.body;
    try {
        await fileProcessingService.processFiles(fileIds, req.app.get('io'));
        res.json({ success: true, message: 'Procesamiento iniciado.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
