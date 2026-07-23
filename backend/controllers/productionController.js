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
// OJO: incluir también los estados logísticos post-Pronto ('En transito','Ingresado',...). Una orden
// que ya se controló (Pronto) y siguió avanzando (se despachó a un remito → 'En transito', o entró a
// depósito → 'Ingresado') NO debe volver a "Control y Calidad" porque finalicen su máquina. Sin estos,
// una orden despachada antes de finalizar el rollo quedaba desprotegida y se pisaba hacia atrás.
const GUARD_ORDENES_RESUELTAS =
    "ISNULL(EstadoenArea,'') NOT IN ('Pronto','En transito','En Transito','En Tránsito','Ingresado','Pronto para entregar','Con Falla','Retenido','Finalizado','Entregado','Avisado','Para Avisar','Cancelado') " +
    "AND Estado NOT IN ('Finalizado','Cancelado','Entregado')";

// Áreas con IMPRESIÓN PARCIAL (por unidades o metros): al finalizar un lote, las órdenes incompletas
// NO bloquean — vuelven a la Mesa de Armado conservando su avance (Ordenes.CantidadImpresa) para
// continuar otro día en un lote nuevo. Ver docs/impresion-parcial-plan.md
// DIRECTA cuenta piezas o metros según el artículo (misma mecánica).
const AREAS_IMPRESION_PARCIAL = ['TPU', 'DIRECTA'];

// Áreas con BLOQUEO DURO al finalizar: el lote no se puede finalizar con órdenes sin marcar
// (espeja el gate del front en MachineControl). 'DF'/'DTF' son la misma área según el entorno.
const AREAS_GATE_MARCADO = ['SB', 'DF', 'DTF'];

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
                .query(`SELECT r.RolloID, r.MaquinaID, r.BobinaID, r.AreaID, c.EstadoProceso, c.Nombre as NombreEquipo,
                    ISNULL(c.SeparacionImpresion, 0) AS EsImpresora
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

                // === VALIDACIÓN: todas las órdenes marcadas antes de finalizar (espeja el bloqueo de la UI) ===
                // Impresora → Impreso ; no-impresora (calandra) → Calandrado. No aplica a 'production' (volver a la
                // cola es una corrección, no una finalización). El flag EsImpresora viene de ConfigEquipos.
                if (destination !== 'production') {
                    // OJO: SeparacionImpresion puede venir como CHAR ('0'/'1') según el tipo de la
                    // columna — y un '0' string es TRUTHY en JS: `!!EsImpresora` daba true hasta en
                    // las calandras y el gate exigía 'Impreso' donde la UI marca 'Calandrado'
                    // (lotes 100% calandrados imposibles de finalizar). Parse explícito.
                    const esImpresora = currentRoll.EsImpresora === true || Number(String(currentRoll.EsImpresora ?? '0').trim()) === 1;
                    const areaRollUp = String(currentRoll.AreaID || '').trim().toUpperCase();
                    // La marca a exigir: 'Calandrado' SOLO en calandras de SB (única área con calandras);
                    // en el resto (DTF, TPU, y las impresoras de SB) la marca es 'Impreso'. Si esto usara
                    // Calandrado en DTF, el gate bloquearía siempre (ahí nadie calandra).
                    const colMarca = (areaRollUp === 'SB' && !esImpresora) ? 'Calandrado' : 'Impreso'; // valor interno fijo, no input del cliente
                    const marcaRes = await new sql.Request(transaction)
                        .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                        .query(`SELECT COUNT(*) AS Faltan FROM dbo.Ordenes
                                WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND ISNULL(${colMarca}, 0) = 0`);
                    const faltanMarca = marcaRes.recordset[0]?.Faltan || 0;
                    const esAreaParcial = AREAS_IMPRESION_PARCIAL.includes(String(currentRoll.AreaID || '').toUpperCase());

                    if (faltanMarca > 0 && esAreaParcial) {
                        // IMPRESIÓN PARCIAL: las incompletas vuelven a la Mesa de Armado con su avance
                        // (misma receta que moveOrder con destino null: RolloID/Secuencia/MaquinaID = NULL
                        // + estado 'Pendiente'). Las completas siguen el flujo normal del lote.
                        const incompletasRes = await new sql.Request(transaction)
                            .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                            .query(`SELECT OrdenID, CodigoOrden FROM dbo.Ordenes
                                    WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND ISNULL(${colMarca}, 0) = 0`);

                        for (const o of incompletasRes.recordset) {
                            await new sql.Request(transaction)
                                .input('OID', sql.Int, o.OrdenID)
                                .query(`UPDATE dbo.Ordenes SET RolloID = NULL, Secuencia = NULL, MaquinaID = NULL WHERE OrdenID = @OID`);
                            await changeOrderState(transaction, {
                                target : { type: 'ORDER', id: o.OrdenID },
                                estado : 'Pendiente',
                                userObj: req.user,
                                detalle: 'Impresión parcial: vuelve a Mesa de Armado conservando el avance',
                                io     : req.app.get('socketio'),
                            });
                        }
                        logger.info(`[toggleRollStatus] Impresión parcial: ${incompletasRes.recordset.length} orden(es) del rollo ${currentRoll.RolloID} vuelven a mesa.`);

                        // Si TODAS eran incompletas, el lote quedó vacío: cerrarlo acá mismo.
                        const restantesRes = await new sql.Request(transaction)
                            .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                            .query(`SELECT COUNT(*) AS C FROM dbo.Ordenes WHERE CAST(RolloID AS VARCHAR(50)) = @RID`);
                        if ((restantesRes.recordset[0]?.C || 0) === 0) {
                            await new sql.Request(transaction)
                                .input('RID', sql.VarChar(50), currentRoll.RolloID.toString())
                                .query(`UPDATE dbo.BitacoraProduccion SET FechaFin = GETDATE() WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND FechaFin IS NULL;
                                        UPDATE dbo.Rollos SET Estado = 'Finalizado', MaquinaID = NULL WHERE CAST(RolloID AS VARCHAR(50)) = @RID;`);
                            await transaction.commit();
                            const ioEmpty = req.app.get('socketio');
                            if (ioEmpty) ioEmpty.emit('server:order_updated', { type: 'roll_finished_partial' });
                            return res.json({ success: true, message: 'Todas las órdenes volvieron a la Mesa de Armado con su avance; el lote quedó finalizado.' });
                        }
                    } else if (faltanMarca > 0 && AREAS_GATE_MARCADO.includes(areaRollUp)) {
                        // Bloqueo duro (SB y DTF, espeja el gate del front en MachineControl):
                        // en el resto de las áreas el marcado no aplica y se finaliza sin exigirlo.
                        await transaction.rollback();
                        return res.status(400).json({ error: `No se puede finalizar: faltan ${faltanMarca} orden(es) sin marcar como ${colMarca === 'Calandrado' ? 'calandrado' : 'impreso'}.` });
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

// Etiqueta térmica (10x15) de un LOTE finalizado: nombre, fecha/hora de finalización, metros totales,
// y cuántas órdenes urgentes / con falla (-F) contiene. Se imprime automáticamente al finalizar el lote
// desde Planeación. Las órdenes conservan su RolloID al finalizar, así que los datos se calculan acá.
exports.printEtiquetaLote = async (req, res) => {
    try {
        const rollId = String(req.params.id || '');
        const pool = await getPool();

        // La fecha se formatea EN SQL (dd/mm/yyyy, hh:mi) a propósito: el driver lee el DATETIME
        // (guardado en hora local) como si fuera UTC, y formatearlo después en JS restaba 3h
        // (un lote finalizado 11:01 se imprimía 08:01). Así sale tal cual quedó guardado.
        const loteRes = await pool.request()
            .input('RID', sql.VarChar(50), rollId)
            .query(`
                SELECT TOP 1 rl.Nombre AS LoteNombre,
                       CONVERT(VARCHAR(10), f.Fin, 103) + ', ' + CONVERT(VARCHAR(5), f.Fin, 108) AS FechaFinStr
                FROM dbo.Rollos rl WITH(NOLOCK)
                CROSS APPLY (
                    SELECT ISNULL((SELECT MAX(b.FechaFin) FROM dbo.BitacoraProduccion b WITH(NOLOCK)
                                    WHERE CAST(b.RolloID AS VARCHAR(50)) = @RID), GETDATE()) AS Fin
                ) f
                WHERE CAST(rl.RolloID AS VARCHAR(50)) = @RID
            `);
        const lote = loteRes.recordset[0] || {};
        const nombreLote = (lote.LoteNombre || `Lote ${rollId}`).trim();

        const aggRes = await pool.request()
            .input('RID', sql.VarChar(50), rollId)
            .query(`
                SELECT
                    ISNULL(SUM(TRY_CAST(REPLACE(REPLACE(ISNULL(Magnitud,'0'),' ',''),',','.') AS FLOAT)), 0) AS MetrosTotales,
                    SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(Prioridad,'')))) = 'URGENTE' THEN 1 ELSE 0 END) AS Urgentes,
                    SUM(CASE WHEN CodigoOrden LIKE '%-F%' THEN 1 ELSE 0 END) AS Fallas
                FROM dbo.Ordenes WITH(NOLOCK)
                WHERE CAST(RolloID AS VARCHAR(50)) = @RID
            `);
        const agg = aggRes.recordset[0] || {};
        const metros = Number(agg.MetrosTotales || 0);
        const urgentes = Number(agg.Urgentes || 0);
        const fallas = Number(agg.Fallas || 0);

        // Fallback solo si el rollo no existe (sin fila): ahí sí se formatea en JS, con zona explícita.
        const fechaStr = lote.FechaFinStr || new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
        const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

        // El nombre del lote se achica según su largo para ocupar el ancho de la etiqueta en vez de
        // partirse en 3 líneas. Ancho útil = 10cm - 2×0.6cm de padding ≈ 8.8cm ≈ 332px a 96dpi, y en
        // Arial 900 cada carácter ocupa ~0.62em. Se acota entre 13px y 34px.
        const loteFont = Math.max(13, Math.min(34, Math.floor(332 / (Math.max(nombreLote.length, 1) * 0.62))));

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Lote ${esc(nombreLote)}</title>
<style>
  @page { size: 10cm 15cm; margin: 0; }
  body { font-family: 'Arial', sans-serif; margin: 0; padding: 0; background: #fff; color: #000; }
  .label { width: 10cm; height: 15cm; box-sizing: border-box; padding: 0.7cm 0.6cm; display: flex; flex-direction: column; }
  .lote { font-size: ${loteFont}px; font-weight: 900; text-transform: uppercase; letter-spacing: 0; word-break: break-word; line-height: 1.1; border-bottom: 3px solid #000; padding-bottom: 10px; }
  .row { margin-top: 14px; }
  .lbl { font-size: 13px; font-weight: 800; text-transform: uppercase; color: #555; }
  .val { font-size: 22px; font-weight: 900; }
  .metros { font-size: 40px; font-weight: 900; }
  .banner { font-size: 24px; font-weight: 900; background: #000; color: #fff; text-align: center; padding: 8px 0; margin-top: 12px; letter-spacing: 1px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
  <div class="label">
    <div class="lote">${esc(nombreLote)}</div>
    <div class="row"><div class="lbl">Finalizado</div><div class="val">${fechaStr}</div></div>
    <div class="row"><div class="lbl">Metros totales</div><div class="metros">${metros.toFixed(2)} m</div></div>
    ${urgentes > 0 ? `<div class="banner">${urgentes} URGENTE${urgentes > 1 ? 'S' : ''}</div>` : ''}
    ${fallas > 0 ? `<div class="banner">${fallas} FALLA${fallas > 1 ? 'S' : ''}</div>` : ''}
  </div>
</body></html>`;

        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        logger.error('Error printEtiquetaLote:', err);
        res.status(500).send('<h1>Error generando la etiqueta del lote</h1>');
    }
};
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
