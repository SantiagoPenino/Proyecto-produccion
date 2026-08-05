const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { changeOrderState } = require('../services/stateManagerService');

// [BANDEJA GENÉRICA] Bandeja simple de órdenes (NO lotes) — reemplaza la Mesa de
// Armado/Control por lotes que usan el resto de las áreas. Nace para Bordado (EMB) y se
// generalizó para Estampado (EST): ambas son "servicios" sin archivo de impresión propio
// (Magnitud='0' a propósito), cada tarjeta es UNA orden. Mismo espíritu que Terminaciones
// (EcoUvFinishing), pero sin nada de hermanas XEUV/terminaciones-por-archivo — acá el gate
// es el checklist de Requisitos (ConfigRequisitosProduccion / OrdenCumplimientoRequisitos)
// que ya usa OrderRequirementsList. Todas las funciones toman `area` de req.query.area
// (default 'EMB' por compatibilidad) — embRoutes.js la fuerza a 'EMB', estRoutes.js a 'EST'.
//
// fase=trabajo (default): pendientes CON todos los requisitos bloqueantes cumplidos.
// fase=control: ya trabajadas (EstadoenArea='Control y Calidad'), esperando el conteo de
//   Control y la cantidad de bultos antes de aprobar (recién ahí se generan etiquetas).

// Extraer ID de Drive de una URL (mismo helper que productionController.js) — para armar
// el link de miniatura pública sin generar nada del lado del servidor.
const getDriveId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:id=|\/d\/)([\w-]+)/);
    return match ? match[1] : null;
};

// Campos comunes que se agregan a la orden en ambas fases: máquina/operario asignados,
// TODOS los archivos de referencia recientes (boceto + logo, no solo el último) y resumen
// de notas — todo con subconsultas correlacionadas en la MISMA query, sin N+1 por tarjeta.
const CAMPOS_ENRIQUECIDOS = `
    m.Nombre AS MaquinaNombre,
    u.Nombre AS OperarioNombre,
    (
        SELECT TOP 4 RefID, NombreOriginal, TipoArchivo, UbicacionStorage
        FROM ArchivosReferencia WHERE OrdenID = o.OrdenID
        ORDER BY FechaSubida DESC
        FOR JSON PATH
    ) AS RefsJson,
    (SELECT COUNT(*) FROM OrdenNotasProduccion WHERE OrdenID = o.OrdenID) AS NotasCount,
    (SELECT TOP 1 Texto FROM OrdenNotasProduccion WHERE OrdenID = o.OrdenID ORDER BY FechaCreacion DESC) AS UltimaNota,
    -- [PRENDAS] Hermana de una prenda comprada+personalizada: la cantidad REAL vive en la
    -- orden madre PRO (misma NoDocERP), la propia Magnitud queda en '0' a propósito (ver
    -- prendasOrdersController.js). Sin esto, el progreso nunca cierra para estas órdenes.
    CASE WHEN TRY_CAST(o.Magnitud AS FLOAT) > 0 THEN o.Magnitud ELSE pro.Magnitud END AS MagnitudEfectiva
`;
const JOINS_ENRIQUECIDOS = `
    LEFT JOIN ConfigEquipos m ON m.EquipoID = o.MaquinaID
    LEFT JOIN Usuarios u ON u.IdUsuario = o.OperarioAsignadoID
    LEFT JOIN Ordenes pro ON pro.NoDocERP = o.NoDocERP AND pro.AreaID = 'PRO'
`;

// [ESTAMPADO] Cuando hay DTF y TPU activos a la vez, se crean DOS órdenes de Estampado
// (una por cada transfer — ver prendasOrdersController.js, fisicasEST), cada una encadenada
// con LiberaCuandoOrdenID a SU fuente específica (la orden DF o la TPU de la que depende).
// EstadoDependencia='OK' solo dice que la PRODUCCIÓN de esa fuente terminó — no que el
// transfer ya llegó físicamente a Estampado. En vez de un requisito con nombre fijo
// ('DTF'/'TPU', que le aparecería a las DOS órdenes de EST por igual aunque cada una solo
// dependa de una), este chequeo es automático por orden: ¿ya hay un bulto de la orden
// LiberaCuandoOrdenID físicamente en stock en esta área? "Prendas a Estampar" (el gate
// PRENDA vía Requisitos) sigue siendo el checklist con nombre — es común a las dos.
const SQL_TRANSFER_LLEGO = `
    (o.LiberaCuandoOrdenID IS NULL OR EXISTS (
        SELECT 1 FROM Logistica_Bultos lb
        WHERE lb.OrdenID = o.LiberaCuandoOrdenID AND lb.UbicacionActual = @Area AND lb.Estado = 'EN_STOCK'
    ))
`;

// Área efectiva de la request: query param si viene (estRoutes.js/embRoutes.js lo fuerzan),
// si no default 'EMB' por compatibilidad con el código ya desplegado.
const getArea = (req) => (req.query?.area || req.body?.area || 'EMB').toString().trim().toUpperCase();

// [PRENDAS] Cantidad real de prendas de la orden: si es hermana de una orden madre PRO
// (Magnitud propia en '0' a propósito, ver prendasOrdersController.js), sale de ahí.
// Compartida por setProgreso / setProgresoControl / aprobarControl para no repetir el JOIN.
async function getMagnitudEfectiva(pool, ordenId) {
    const r = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query(`
            SELECT CASE WHEN TRY_CAST(o.Magnitud AS FLOAT) > 0 THEN o.Magnitud ELSE pro.Magnitud END AS MagnitudEfectiva
            FROM Ordenes o
            LEFT JOIN Ordenes pro ON pro.NoDocERP = o.NoDocERP AND pro.AreaID = 'PRO'
            WHERE o.OrdenID = @OID
        `);
    if (!r.recordset.length) return null;
    return parseFloat(r.recordset[0].MagnitudEfectiva) || 0;
}

// Arma la URL de preview de cada referencia (miniatura pública de Drive si hay ID, si no
// el thumbnail local que ya genera el sistema al subir — thumbnailGenerator.js). Distingue
// boceto de logo/matriz por TipoArchivo (BOCETO_BORDADO / MATRIZ_LOGOS, ver
// PrendaOrderForm.jsx) para poder mostrar los dos por separado en el detalle.
function enriquecerPreview(row) {
    let refs = [];
    try { refs = row.RefsJson ? JSON.parse(row.RefsJson) : []; } catch (e) { refs = []; }
    row.Referencias = refs.map(f => {
        const driveId = getDriveId(f.UbicacionStorage);
        const previewUrl = driveId
            ? `https://drive.google.com/thumbnail?id=${driveId}&sz=w300`
            : `/thumbnails/${encodeURIComponent(row.CodigoOrden)}/${f.RefID}.jpg`;
        const tipo = (f.TipoArchivo || '').toUpperCase();
        const esBoceto = tipo.includes('BOCETO');
        const esLogo = tipo.includes('LOGO') || tipo.includes('MATRIZ');
        return { ...f, previewUrl, esBoceto, esLogo };
    });
    // Compat con lo que ya pintaba la tarjeta chica de la bandeja (primer archivo, cualquiera).
    row.PreviewUrl = row.Referencias[0]?.previewUrl || null;
    delete row.RefsJson;
    return row;
}

exports.getEmbOrders = async (req, res) => {
    const fase = (req.query.fase || 'trabajo').toLowerCase();
    const area = getArea(req);
    try {
        const pool = await getPool();
        const query = fase === 'control'
            ? `
                SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material, o.Variante, o.Nota,
                       o.Magnitud, o.Prioridad, o.FechaIngreso, o.Estado, o.EstadoenArea, o.NoDocERP,
                       o.MaquinaID, o.OperarioAsignadoID, o.EstadoTrabajoEmb, o.CantidadTerminada, o.CantidadControlada, ${CAMPOS_ENRIQUECIDOS}
                FROM Ordenes o
                ${JOINS_ENRIQUECIDOS}
                WHERE o.AreaID = @Area AND o.Estado NOT IN ('Cancelado')
                  AND o.EstadoenArea = 'Control y Calidad'
                ORDER BY o.FechaIngreso ASC
            `
            : `
                SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material, o.Variante, o.Nota,
                       o.Magnitud, o.Prioridad, o.FechaIngreso, o.Estado, o.EstadoenArea, o.NoDocERP,
                       o.MaquinaID, o.OperarioAsignadoID, o.EstadoTrabajoEmb, o.CantidadTerminada, ${CAMPOS_ENRIQUECIDOS}
                FROM Ordenes o
                ${JOINS_ENRIQUECIDOS}
                WHERE o.AreaID = @Area
                  AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Pronto')
                  AND ISNULL(o.EstadoenArea, '') NOT IN ('Pronto', 'Control y Calidad')
                  AND (o.EstadoDependencia IS NULL OR o.EstadoDependencia = 'OK')
                  AND ${SQL_TRANSFER_LLEGO}
                  AND NOT EXISTS (
                      SELECT 1 FROM ConfigRequisitosProduccion req
                      WHERE req.AreaID = @Area AND req.EsBloqueante = 1
                        AND NOT EXISTS (
                            SELECT 1 FROM OrdenCumplimientoRequisitos cum
                            WHERE cum.OrdenID = o.OrdenID AND cum.RequisitoID = req.RequisitoID
                              AND cum.Estado = 'CUMPLIDO'
                        )
                  )
                ORDER BY o.FechaIngreso ASC
            `;
        const r = await pool.request().input('Area', sql.VarChar(20), area).query(query);
        res.json({ success: true, data: r.recordset.map(enriquecerPreview) });
    } catch (err) {
        logger.error('[Bandeja] getEmbOrders: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// Pendientes SIN todos los requisitos cumplidos (o esperando que llegue el transfer
// encadenado — ver SQL_TRANSFER_LLEGO) — para que la bandeja también pueda mostrar "esto
// está trabado, falta X" en vez de solo lo que ya está listo. Cada orden cae en UN solo
// motivo (mutuamente excluyentes: si el transfer no llegó, esa es la razón que se muestra,
// aunque además le falte algún requisito con nombre).
exports.getEmbOrdersBloqueadas = async (req, res) => {
    const area = getArea(req);
    try {
        const pool = await getPool();
        const r = await pool.request().input('Area', sql.VarChar(20), area).query(`
            SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material,
                   o.FechaIngreso, o.NoDocERP,
                   STRING_AGG(req.Descripcion, ', ') AS FaltantePendiente
            FROM Ordenes o
            JOIN ConfigRequisitosProduccion req ON req.AreaID = @Area AND req.EsBloqueante = 1
            LEFT JOIN OrdenCumplimientoRequisitos cum
                ON cum.OrdenID = o.OrdenID AND cum.RequisitoID = req.RequisitoID AND cum.Estado = 'CUMPLIDO'
            WHERE o.AreaID = @Area
              AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Pronto')
              AND ISNULL(o.EstadoenArea, '') <> 'Pronto'
              AND (o.EstadoDependencia IS NULL OR o.EstadoDependencia = 'OK')
              AND ${SQL_TRANSFER_LLEGO}
              AND cum.OrdenID IS NULL
            GROUP BY o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material, o.FechaIngreso, o.NoDocERP

            UNION ALL

            -- Esperando que llegue el transfer encadenado (DTF o TPU, según corresponda) —
            -- prioridad sobre el motivo de arriba: si el material no llegó, no importa qué
            -- requisito con nombre falte, lo que hay que mostrar es "está en camino".
            SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material,
                   o.FechaIngreso, o.NoDocERP,
                   'Esperando que llegue el material (transfer DTF/TPU)' AS FaltantePendiente
            FROM Ordenes o
            WHERE o.AreaID = @Area
              AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Pronto')
              AND ISNULL(o.EstadoenArea, '') <> 'Pronto'
              AND (o.EstadoDependencia IS NULL OR o.EstadoDependencia = 'OK')
              AND NOT (${SQL_TRANSFER_LLEGO})

            UNION ALL

            -- [PRENDAS] Cualquier otro gate TODAVÍA activo (EstadoDependencia con algo que no
            -- sea NULL/OK) — antes esto dejaba la orden INVISIBLE en todas partes (ni en
            -- "trabajo" ni acá, que solo cubría EstadoDependencia NULL/OK) hasta que se
            -- liberara. Cubre 'ESPERANDO_IMPRESION' (esperando que termine su DTF/TPU) y
            -- 'ESPERANDO_RETIRO_WMS' (esperando que se confirme el retiro del depósito) — se ve
            -- desde que se crea el pedido, con el motivo real.
            SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material,
                   o.FechaIngreso, o.NoDocERP,
                   CASE o.EstadoDependencia
                       WHEN 'ESPERANDO_IMPRESION' THEN CONCAT('Esperando que termine ',
                           ISNULL(NULLIF(LTRIM(RTRIM(fuente.AreaID)), ''), 'su origen'), ' (', ISNULL(fuente.CodigoOrden, '—'), ')')
                       WHEN 'ESPERANDO_RETIRO_WMS' THEN 'Esperando que se confirme el retiro del depósito (WMS)'
                       ELSE CONCAT('Esperando: ', o.EstadoDependencia)
                   END AS FaltantePendiente
            FROM Ordenes o
            LEFT JOIN Ordenes fuente ON fuente.OrdenID = o.LiberaCuandoOrdenID
            WHERE o.AreaID = @Area
              AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Pronto')
              AND ISNULL(o.EstadoenArea, '') <> 'Pronto'
              AND o.EstadoDependencia IS NOT NULL AND o.EstadoDependencia <> 'OK'

            ORDER BY FechaIngreso ASC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        logger.error('[Bandeja] getEmbOrdersBloqueadas: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// Máquinas activas del área (mismo patrón correcto que ya usa productionKanbanController.js
// — NO el equiposController.getEquipos viejo, que apunta a una tabla "Maquinas" que no existe).
exports.getMaquinasEmb = async (req, res) => {
    const area = getArea(req);
    try {
        const pool = await getPool();
        const r = await pool.request().input('Area', sql.VarChar(20), area).query(`
            SELECT EquipoID, Nombre FROM ConfigEquipos WHERE AreaID = @Area AND Activo = 1 ORDER BY Nombre
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        logger.error('[Bandeja] getMaquinasEmb: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.asignarMaquina = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const maquinaId = req.body?.maquinaId ? parseInt(req.body.maquinaId, 10) : null;
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    try {
        const pool = await getPool();
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('MID', sql.Int, maquinaId)
            .query('UPDATE Ordenes SET MaquinaID = @MID WHERE OrdenID = @OID');
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] asignarMaquina: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.asignarOperario = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const operarioId = req.body?.operarioId ? parseInt(req.body.operarioId, 10) : null;
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    try {
        const pool = await getPool();
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('UID', sql.Int, operarioId)
            .query('UPDATE Ordenes SET OperarioAsignadoID = @UID WHERE OrdenID = @OID');
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] asignarOperario: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// [BORDADO] Inicio/Pausa — igual que "Iniciar"/"Pausar" de un lote (MachineControl.jsx:
// Rollos.Estado 'En maquina'/'En cola'), pero por orden individual: acá se refleja en
// Ordenes.EstadoenArea con el mismo mecanismo central (changeOrderState) que usa el resto
// de las áreas, para que la Planilla y cualquier otra pantalla vean el estado real — no
// solo el flag EstadoTrabajoEmb interno de esta bandeja.
// "Fin" tampoco vive acá: es exports.finalizarTrabajo, más abajo (mueve a Control y
// Calidad — el cierre real con etiqueta/bulto pasa recién en la fase Control).
exports.setEstadoTrabajo = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const estado = req.body?.estado; // 'EN_PROCESO' | 'PAUSADO' | null (volver a "sin iniciar")
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    if (estado && !['EN_PROCESO', 'PAUSADO'].includes(estado)) {
        return res.status(400).json({ error: "estado debe ser 'EN_PROCESO', 'PAUSADO' o null." });
    }
    try {
        const pool = await getPool();
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Est', sql.VarChar(20), estado || null)
            .query('UPDATE Ordenes SET EstadoTrabajoEmb = @Est WHERE OrdenID = @OID');

        // EstadoenArea real, mismo vocabulario que ConfigEstados ya usa en el resto del
        // sistema ('En Maquina' al iniciar; volver a 'Pendiente' al pausar o desiniciar).
        const estadoenArea = estado === 'EN_PROCESO' ? 'En Maquina' : 'Pendiente';
        await changeOrderState(pool, {
            target : { type: 'ORDER', id: ordenId },
            estado : estadoenArea,
            userObj: req.user || 'Sistema',
            detalle: estado === 'EN_PROCESO' ? 'Trabajo iniciado' : 'Trabajo pausado',
            io     : req.app.get('socketio'),
        });

        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] setEstadoTrabajo: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// Cuántas prendas de esta orden ya están bordadas — para el % de avance en la tarjeta.
// Rango válido: >= 1 y <= cantidad total (aflojado — con cantidades chicas, ej. 2, no
// había ningún valor entero posible entre 1 y el total en estricto "mayor/menor que").
exports.setProgreso = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const cantidad = parseFloat(req.body?.cantidadTerminada);
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    if (isNaN(cantidad)) return res.status(400).json({ error: 'Cantidad inválida.' });
    try {
        const pool = await getPool();
        const magnitud = await getMagnitudEfectiva(pool, ordenId);
        if (magnitud === null) return res.status(404).json({ error: 'Orden no encontrada.' });

        if (cantidad < 1) {
            return res.status(400).json({ error: 'La cantidad de bordados hechos debe ser al menos 1.' });
        }
        if (cantidad > magnitud) {
            return res.status(400).json({ error: `No puede superar la cantidad total de prendas (${magnitud}).` });
        }

        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Cant', sql.Float, cantidad)
            .query('UPDATE Ordenes SET CantidadTerminada = @Cant WHERE OrdenID = @OID');
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] setProgreso: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// [BORDADO] "Finalizar Tarea" de la Bandeja: el trabajo de bordar terminó, pasa a Control
// y Calidad (mismo verbo que usa Terminaciones — EcoUvFinishing fase 'trabajo'). Todavía
// NO genera etiqueta/bulto: eso se decide recién en Control, con la cantidad real de
// bultos que salen físicamente.
exports.finalizarTrabajo = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    try {
        const pool = await getPool();
        await changeOrderState(pool, {
            target : { type: 'ORDER', id: ordenId },
            estado : 'Control y Calidad',
            userObj: req.user || 'Sistema',
            detalle: 'Trabajo terminado — pasa a Control y Calidad',
            io     : req.app.get('socketio'),
        });
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] finalizarTrabajo: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// Cuántas prendas ya se controlaron — CONTADOR APARTE del de bordado (CantidadTerminada):
// una cosa es cuántas se van bordando, otra cuántas ya se verificaron en Control.
exports.setProgresoControl = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const cantidad = parseFloat(req.body?.cantidadControlada);
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    if (isNaN(cantidad)) return res.status(400).json({ error: 'Cantidad inválida.' });
    try {
        const pool = await getPool();
        const magnitud = await getMagnitudEfectiva(pool, ordenId);
        if (magnitud === null) return res.status(404).json({ error: 'Orden no encontrada.' });

        if (cantidad < 1) {
            return res.status(400).json({ error: 'La cantidad controlada debe ser al menos 1.' });
        }
        if (cantidad > magnitud) {
            return res.status(400).json({ error: `No puede superar la cantidad total de prendas (${magnitud}).` });
        }

        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Cant', sql.Float, cantidad)
            .query('UPDATE Ordenes SET CantidadControlada = @Cant WHERE OrdenID = @OID');
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] setProgresoControl: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// [BORDADO] "Aprobar Control": gate por conteo controlado completo (mismo espíritu que el
// conteo de copias por archivo de Terminaciones), pasa la orden a Pronto y genera los N
// bultos/etiquetas elegidos por quien controla — sobre la MISMA orden de bordado (no la
// madre PRO): cada hermana rutea su propio bulto a su ProximoServicio (EST o DEPOSITO,
// definido al crearla — ver prendasOrdersController.js), así que el bulto tiene que
// seguir viajando con el código de bordado, no el de la prenda comprada.
exports.aprobarControl = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const cantBultos = Math.max(1, parseInt(req.body?.bultos, 10) || 1);
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    try {
        const pool = await getPool();

        const ordRes = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                SELECT o.CantidadControlada, o.AreaID, o.ProximoServicio,
                       LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) AS NoDoc,
                       CASE WHEN TRY_CAST(o.Magnitud AS FLOAT) > 0 THEN o.Magnitud ELSE pro.Magnitud END AS MagnitudEfectiva
                FROM Ordenes o
                LEFT JOIN Ordenes pro ON pro.NoDocERP = o.NoDocERP AND pro.AreaID = 'PRO'
                WHERE o.OrdenID = @OID
            `);
        if (!ordRes.recordset.length) return res.status(404).json({ error: 'Orden no encontrada.' });
        const ordenRow = ordRes.recordset[0];
        const magnitud = parseFloat(ordenRow.MagnitudEfectiva) || 0;
        const controlado = parseFloat(ordenRow.CantidadControlada) || 0;
        if (magnitud > 0 && controlado < magnitud) {
            return res.status(400).json({ error: `Controlaste ${controlado} de ${magnitud} prenda(s): completá el conteo antes de aprobar.` });
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            await changeOrderState(tx, {
                target : { type: 'ORDER', id: ordenId },
                estado : 'Pronto',
                userObj: req.user || 'Sistema',
                detalle: 'Control aprobado',
                io     : req.app.get('socketio'),
            });
            await tx.commit();
        } catch (e) { await tx.rollback(); throw e; }

        // [PRENDAS] Estampado puede tener varias hermanas para el MISMO pedido (una por
        // cada DTF/TPU activo), todas trabajando sobre la MISMA prenda física — si cada
        // una generara su propio bulto "producto terminado" al aprobarse, quedarían N
        // sets de bultos para una sola prenda. Mientras quede alguna hermana EST sin
        // aprobar, esta NO genera bulto: el bulto final lo genera la ÚLTIMA en aprobarse.
        let esperandoHermanaEst = false;
        if ((ordenRow.AreaID || '').trim().toUpperCase() === 'EST' && ordenRow.NoDoc) {
            const sibRes = await pool.request()
                .input('ND', sql.VarChar, ordenRow.NoDoc)
                .input('OID', sql.Int, ordenId)
                .query(`
                    SELECT COUNT(*) AS Pendientes
                    FROM Ordenes
                    WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) = @ND
                      AND AreaID = 'EST' AND OrdenID <> @OID
                      AND (EstadoenArea IS NULL OR UPPER(LTRIM(RTRIM(EstadoenArea))) <> 'PRONTO')
                      AND (Estado IS NULL OR UPPER(LTRIM(RTRIM(Estado))) <> 'CANCELADO')
                `);
            esperandoHermanaEst = (sibRes.recordset[0]?.Pendientes || 0) > 0;
        }

        let totalBultos = 0;
        if (!esperandoHermanaEst) {
            try {
                const LabelGenerationService = require('../services/LabelGenerationService');
                // Tipo de bulto según destino real (igual criterio que addOneBulto): si el
                // próximo paso NO es Depósito (ej. Bordado que todavía va a Estampado), es
                // material EN_PROCESO, no producto terminado — si no, nunca deja de "esperar
                // bultos" en el gate de Depósito porque ese bulto jamás llega ahí.
                const prox = (ordenRow.ProximoServicio || 'DEPOSITO').trim().toUpperCase();
                const esUltimoServicio = prox.includes('DEPOSITO') || prox === '';
                // Sin `ubicacion` explícita: addBultosTerminados usa o.AreaID por default —
                // así el bulto queda en la ubicación real de la orden (EMB o EST), no fija.
                const lr = await LabelGenerationService.addBultosTerminados(
                    ordenId, cantBultos, req.user?.id || 1, req.user?.usuario || 'Sistema',
                    { tipoBulto: esUltimoServicio ? 'PROD_TERMINADO' : 'EN_PROCESO' }
                );
                if (lr.success) totalBultos = lr.totalBultos;
                else logger.warn('[Bandeja] aprobarControl: no se generó la etiqueta: ' + lr.error);
            } catch (eLab) {
                logger.warn('[Bandeja] aprobarControl: error generando etiquetas: ' + eLab.message);
            }
        } else {
            logger.info(`[Bandeja] aprobarControl: orden ${ordenId} aprobada; bulto final pendiente de otra hermana EST del mismo pedido.`);
        }

        res.json({
            success: true, totalBultos, esperandoHermanaEst,
            areaID: ordenRow.AreaID,
            proximoServicio: ordenRow.ProximoServicio || null,
        });
    } catch (err) {
        logger.error('[Bandeja] aprobarControl: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};
