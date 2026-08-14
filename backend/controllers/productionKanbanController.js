const { getPool, sql } = require('../config/db');
const { changeOrderState, GUARD_ORDENES_RESUELTAS } = require('../services/stateManagerService');
const { registrarAuditoria } = require('../services/trackingService');
const { validarMetrosFalla } = require('../services/fallaValidationService');
const logger = require('../utils/logger');

exports.getBoard = async (req, res) => {
    let { area } = req.query;
    // Log suprimido — alta frecuencia de polling

    try {
        const POOL = await getPool();

        const machinesRes = await POOL.request()
            .input('Area', sql.VarChar, area)
            .query(`
                SELECT
                    EquipoID as id,
                    Nombre as name,
                    Estado as status,
                    EstadoProceso as processStatus,
                    SeparacionImpresion as separacionImpresion
                FROM [dbo].[ConfigEquipos]
                WHERE AreaID = @Area AND Activo = 1
                ORDER BY Nombre ASC
            `);

        const machines = machinesRes.recordset;

        // Garantizar que exista la columna de orden de cola (la crea reorderRolls la 1ª vez).
        // Sin esto, agregar r.Secuencia al SELECT rompería el tablero en BDs donde aún no existe.
        await POOL.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'Secuencia' AND Object_ID = Object_ID('dbo.Rollos'))
                ALTER TABLE dbo.Rollos ADD Secuencia INT NULL;
        `);

        const rollsRes = await POOL.request()
            .input('Area', sql.VarChar, area)
            .query(`
                SELECT 
                    r.RolloID as id, 
                    r.RolloID as rollCode, 
                    r.Nombre as name, 
                    r.Estado as status, 
                    r.MaquinaID as machineId,
                    ISNULL(r.MetrosTotales, 0) as usage,
                    ISNULL(r.CapacidadMaxima, 0) as capacity,
                    r.ColorHex as color,
                    ISNULL(r.TotalOrdenes, 0) as ordersCount,
                    r.Secuencia as secuencia,
                    u.Nombre AS CreadorNombre,
                    u.IdUsuario AS CreadorId
                FROM dbo.[Rollos] r
                LEFT JOIN dbo.Usuarios u ON r.UsuarioID = u.IdUsuario
                WHERE r.AreaID = @Area AND r.Estado NOT IN ('Cerrado', 'Finalizado', 'Cancelado')
            `);

        let allRolls = rollsRes.recordset.map(r => ({ 
            ...r, 
            creador: r.CreadorNombre,
            userId: r.CreadorId,
            orders: [], 
            usage: 0 
        }));

        const ordersRes = await POOL.request()
            .input('Area', sql.VarChar, area)
            .query(`
                SELECT 
                    o.OrdenID as id,
                    o.CodigoOrden as code,
                    o.Cliente as client,
                    o.DescripcionTrabajo as descr,
                    o.Material as material,
                    o.RolloID as rollId,
                    o.Prioridad as priority,
                    o.Estado as status,
                    o.Magnitud as magnitude,
                    o.Variante as variantCode,
                    (SELECT COUNT(*) FROM dbo.ArchivosOrden WHERE OrdenID = o.OrdenID) as fileCount
                FROM dbo.Ordenes o
                WHERE o.AreaID = @Area 
                  AND o.RolloID IS NOT NULL 
                  AND o.Estado NOT IN ('Finalizado', 'Entregado', 'Cancelado')
            `);

        const orders = ordersRes.recordset;
        orders.forEach(order => {
            const roll = allRolls.find(r => String(r.id) === String(order.rollId));
            if (roll) {
                const rawMag = String(order.magnitude || '0').replace(',', '.');
                const mag = parseFloat(rawMag.replace(/[^\d.]/g, '')) || 0;
                roll.orders.push({ ...order, desc: order.descr, magnitude: mag });
                roll.usage += mag;
                roll.ordersCount = roll.orders.length;
            }
        });

        allRolls.forEach(r => {
            const ignored = ['SIN MATERIAL ESPECIFICADO', 'SIN MATERIAL', 'NINGUNO', 'N/A', 'VARIOS'];
            const rawMaterials = r.orders.map(o => (o.material || '').trim());
            const validMaterials = rawMaterials.filter(m => m && !ignored.includes(m.toUpperCase()));
            const uniqueMaterials = [...new Set(validMaterials)];
            if (uniqueMaterials.length === 0) r.material = '-';
            else if (uniqueMaterials.length === 1) r.material = uniqueMaterials[0];
            else r.material = 'Varios Materiales';
        });

        // Ordenar por Secuencia DESC (primero arriba), igual que el Drag&Drop de Coordinación.
        // Los lotes nunca reordenados (Secuencia NULL) quedan al final, por id ascendente.
        allRolls.sort((a, b) => {
            const sa = a.secuencia ?? 0;
            const sb = b.secuencia ?? 0;
            if (sb !== sa) return sb - sa;
            return Number(a.id) - Number(b.id);
        });

        const finalMachines = machines.map(m => {
            const assignedRolls = allRolls.filter(r => String(r.machineId) === String(m.id));
            return {
                ...m,
                rolls: assignedRolls,
                isBusy: assignedRolls.some(r => r.status.includes('En maquina'))
            };
        });

        const pendingRolls = allRolls.filter(r =>
            !r.machineId ||
            String(r.machineId).toUpperCase() === 'NULL' ||
            String(r.machineId).trim() === '' ||
            String(r.machineId) === '0'
        );

        res.json({ machines: finalMachines, pendingRolls });

    } catch (err) {
        logger.error("❌ ERROR SQL:", err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.assignRoll = async (req, res) => {
    const { rollId, rollIds, machineId } = req.body;
    const userObj = req.user || req.body.usuario || req.body.userId;
    if (!userObj) return res.status(400).json({ error: "Usuario no autenticado o no proporcionado" });
    const ip = req.ip || req.connection.remoteAddress;
    const mid = machineId || null;

    let targets = [];
    if (rollIds && Array.isArray(rollIds)) {
        targets = rollIds;
    } else if (rollId) {
        targets = [rollId];
    }

    if (targets.length === 0) {
        return res.status(400).json({ error: "No se indicaron rollos para asignar." });
    }

    logger.info(`[assignRoll-Kanban] Rolls: [${targets.join(', ')}], MachineID: ${machineId}`);

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // Si el destino es una CALANDRA (máquina cuyo nombre empieza con "calandra"), un lote con
        // órdenes de falla sin metros NO puede entrar — misma regla que al finalizar. Sin esto,
        // arrastrar el lote directo a la calandra saltearía la validación del metraje de falla.
        if (mid) {
            const mRes = await new sql.Request(transaction)
                .input('MID', sql.Int, mid)
                .query("SELECT Nombre FROM dbo.ConfigEquipos WHERE EquipoID = @MID");
            const nombreMaq = (mRes.recordset[0]?.Nombre || '').trim().toLowerCase();

            // TINTA UV: una orden con tinta UV solo puede ir a una máquina que tenga "UV" en el
            // nombre. La tinta define en qué equipo se imprime; mandarla a una Ecosolvente sale mal.
            if (!nombreMaq.includes('uv')) {
                for (const currentRollId of targets) {
                    const uvRes = await new sql.Request(transaction)
                        .input('RID_UV', sql.VarChar(50), String(currentRollId))
                        .query(`SELECT COUNT(*) AS ConUV FROM dbo.Ordenes
                                WHERE CAST(RolloID AS VARCHAR(50)) = @RID_UV
                                  AND UPPER(LTRIM(RTRIM(ISNULL(Tinta,'')))) = 'UV'
                                  AND Estado NOT IN ('Cancelado','Cancelada')`);
                    const conUV = uvRes.recordset[0]?.ConUV || 0;
                    if (conUV > 0) {
                        await transaction.rollback();
                        return res.status(400).json({
                            error: `El lote tiene ${conUV} orden(es) con tinta UV: solo puede asignarse a una máquina UV.`
                        });
                    }
                }
            }

            if (nombreMaq.startsWith('calandra')) {
                for (const currentRollId of targets) {
                    const chk = await validarMetrosFalla(transaction, currentRollId);
                    if (chk.falta) {
                        await transaction.rollback();
                        return res.status(400).json({
                            error: `No se puede mover el lote a la calandra: falta cargar ${chk.motivo}.`
                        });
                    }

                    // A la calandra solo entra un lote TERMINADO DE IMPRIMIR: si quedan órdenes sin
                    // marcar como impresas, todavía le falta pasar por la impresora. Espeja el gate
                    // del botón Finalizar, que es el otro camino por el que un lote llega a la calandra.
                    const impRes = await new sql.Request(transaction)
                        .input('RID_IMP', sql.VarChar(50), String(currentRollId))
                        .query(`SELECT COUNT(*) AS Faltan FROM dbo.Ordenes
                                WHERE CAST(RolloID AS VARCHAR(50)) = @RID_IMP
                                  AND ISNULL(Impreso, 0) = 0
                                  AND Estado NOT IN ('Cancelado','Cancelada')`);
                    const faltanImp = impRes.recordset[0]?.Faltan || 0;
                    if (faltanImp > 0) {
                        await transaction.rollback();
                        return res.status(400).json({
                            error: `No se puede mover el lote a la calandra: faltan ${faltanImp} orden(es) sin marcar como impresas.`
                        });
                    }
                }
            }
        }

        for (const currentRollId of targets) {
            // Actualizar Rollo (gestión de equipo, no de estado)
            await new sql.Request(transaction)
                .input('RID', sql.Int, currentRollId)
                .input('MID', sql.Int, mid)
                .query("UPDATE dbo.Rollos SET MaquinaID = @MID, Estado = 'En cola' WHERE RolloID = @RID");

            // Actualizar solo MaquinaID en Ordenes (Estado/EstadoenArea via stateManager).
            // El guard evita tocar las órdenes ya resueltas del lote: una orden controlada y
            // despachada (En transito) no vuelve a producción porque se reasigne el lote.
            await new sql.Request(transaction)
                .input('MID', sql.Int, mid)
                .input('RID', sql.Int, currentRollId)
                .query(`UPDATE dbo.Ordenes SET MaquinaID = @MID WHERE RolloID = @RID AND ${GUARD_ORDENES_RESUELTAS}`);

            // Estado + historial via servicio central
            await changeOrderState(transaction, {
                target   : { type: 'ROLL', id: currentRollId },
                estado   : 'En Maquina',
                userObj  : userObj,
                detalle  : 'Asignado a Maquina {maquina}',
                maquinaId: mid,
                rolloId  : currentRollId,
                guard    : GUARD_ORDENES_RESUELTAS,
                io       : req.app.get('socketio')
            });
        }

        const { userIdNum } = require('../services/stateManagerService').extractUser(userObj);
        await registrarAuditoria(transaction, userIdNum, 'ASIGNACION_MASIVA', `${targets.length} rollos asignados a Maquina ${machineId}`, ip);

        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logger.error("❌ ERROR AL ASIGNAR (Kanban):", err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.unassignRoll = async (req, res) => {
    const { rollId } = req.body;
    const userObj = req.user || req.body.usuario || req.body.userId;
    if (!userObj) return res.status(400).json({ error: "Usuario no autenticado o no proporcionado" });
    const ip = req.ip || req.connection.remoteAddress;

    logger.info(`[unassignRoll-Kanban] RollID: ${rollId}`);
    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 1. Desmontar Rollo (gestión de equipo)
        await new sql.Request(transaction)
            .input('RID', sql.Int, rollId)
            .query("UPDATE dbo.Rollos SET MaquinaID = NULL, Estado = 'Abierto' WHERE RolloID = @RID");

        // 2. Limpiar MaquinaID en Ordenes (gestión de equipo) — sin tocar las ya resueltas
        await new sql.Request(transaction)
            .input('RID', sql.Int, rollId)
            .query(`UPDATE dbo.Ordenes SET MaquinaID = NULL WHERE RolloID = @RID AND ${GUARD_ORDENES_RESUELTAS}`);

        // 3. Estado + historial via servicio central. Con guard, igual que el desmontaje de
        // productionController: desmontar el lote no devuelve a 'En Lote' una orden que ya se
        // controló y salió despachada.
        await changeOrderState(transaction, {
            target  : { type: 'ROLL', id: rollId },
            estado  : 'En Lote',
            userObj : userObj,
            detalle : 'Desmontado de Maquina - Lote {rollo}',
            rolloId : rollId,
            guard   : GUARD_ORDENES_RESUELTAS,
            io      : req.app.get('socketio')
        });

        const { userIdNum } = require('../services/stateManagerService').extractUser(userObj);
        await registrarAuditoria(transaction, userIdNum, 'DESMONTAJE_ROLLO', `Rollo ${rollId} desmontado`, ip);

        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logger.error("❌ ERROR AL DESASIGNAR:", err.message);
        res.status(500).json({ error: err.message });
    }
};
