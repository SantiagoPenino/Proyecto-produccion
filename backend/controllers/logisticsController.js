const { getPool, sql } = require('../config/db');

// Helper para registrar movimientos históricos
const registrarMovimiento = async (transaction, { codigoBulto, tipo, area, usuario, obs, estAnt, estNew, esRecep }) => {
    try {
        await new sql.Request(transaction)
            .input('Cod', sql.VarChar, codigoBulto)
            .input('Tipo', sql.VarChar, tipo)
            .input('Area', sql.VarChar, area)
            .input('User', sql.Int, usuario || 1)
            .input('Obs', sql.NVarChar, obs || '')
            .input('ant', sql.VarChar, estAnt || null)
            .input('nue', sql.VarChar, estNew || null)
            .input('recep', sql.Bit, esRecep ? 1 : 0)
            .query(`
                INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
                VALUES (@Cod, @Tipo, @Area, @User, GETDATE(), @Obs, @ant, @nue, @recep)
            `);
    } catch (e) {
        console.error("Error registrando movimiento:", e);
    }
};

// Helpers
const normalize = (s) => (s || '').toString().trim().toUpperCase();

function getNextStep(pipelineStr, currentStep) {
    if (!pipelineStr) return 'DEPOSITO';
    const steps = pipelineStr.split(/[\/-]/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!currentStep) return steps[0];
    const curr = currentStep.toUpperCase();
    const idx = steps.findIndex(s => s === curr || s.includes(curr));
    if (idx >= 0 && idx < steps.length - 1) {
        return steps[idx + 1];
    }
    return 'DEPOSITO';
}

// ==========================================
// 1. LEGACY / BATCH LOGIC (Mantenida por compatibilidad)
// ==========================================

exports.validateBatch = async (req, res) => {
    const { codes, areaId, type } = req.body; // type: 'INGRESO' | 'EGRESO'
    const results = [];

    try {
        const pool = await getPool();

        for (const code of codes) {
            if (!code || !code.trim()) continue;
            const codNorm = normalize(code);
            let entity = null;

            // Identificar origen (Recepcion vs Orden)
            if (codNorm.startsWith('PRE')) {
                const r = await pool.request().input('C', sql.VarChar, codNorm)
                    .query("SELECT * FROM Recepciones WHERE Codigo = @C");
                entity = r.recordset[0];
            } else {
                const r = await pool.request().input('C', sql.VarChar, codNorm)
                    .query("SELECT * FROM Ordenes WHERE CodigoOrden = @C");
                entity = r.recordset[0];
            }

            const out = {
                orden: code,
                isValid: false,
                message: '',
                entity: entity ? {
                    Estado: entity.Estado,
                    Ubicacion: entity.UbicacionActual,
                    Proximo: entity.ProximoServicio
                } : null
            };

            if (!entity) {
                // Check if it exists in Logistica_Bultos (New System)
                const bultoCheck = await pool.request().input('C', sql.VarChar, codNorm)
                    .query("SELECT UbicacionActual, Estado FROM Logistica_Bultos WHERE CodigoEtiqueta = @C");

                if (bultoCheck.recordset.length > 0) {
                    const b = bultoCheck.recordset[0];
                    out.entity = { Ubicacion: b.UbicacionActual, Estado: b.Estado };
                    // Apply generic logic regarding location
                    if (type === 'INGRESO') {
                        if (normalize(b.UbicacionActual) === normalize(areaId)) {
                            out.message = 'Ya está en el área';
                            out.isValid = true;
                        } else {
                            out.message = `Viene de ${b.UbicacionActual}`;
                            out.isValid = true;
                        }
                    } else {
                        // EGRESO
                        if (normalize(b.UbicacionActual) !== normalize(areaId)) {
                            out.message = `No está en esta área (${b.UbicacionActual})`;
                            out.isValid = false;
                        } else {
                            out.message = 'Listo para despachar';
                            out.isValid = true;
                        }
                    }
                } else {
                    // Not found anywhere
                    if (type === 'INGRESO') {
                        out.isValid = true;
                        out.message = 'Nuevo Ingreso (No registrado)';
                        out.isNew = true;
                    } else {
                        out.isValid = false;
                        out.message = 'No existe en base de datos';
                    }
                }
            } else {
                // Legacy Logic for Orders/Recepciones
                const ubicacion = normalize(entity.UbicacionActual);
                const estado = normalize(entity.Estado);
                const area = normalize(areaId);

                if (type === 'INGRESO') {
                    if (ubicacion === area && estado !== 'EN TRANSITO') {
                        out.isValid = true;
                        out.message = 'Ya está en el área ' + estado;
                    } else if (estado === 'EN TRANSITO') {
                        out.isValid = true;
                        out.message = 'Listo para recibir';
                    } else {
                        out.isValid = true;
                        out.message = `Viene de ${ubicacion} (${estado})`;
                    }
                } else { // EGRESO
                    if (ubicacion !== area && estado !== 'INGRESO' && estado !== 'EN PROCESO' && estado !== 'RECEPCIONADO') {
                        out.isValid = false;
                        out.message = `No está en esta área (Está en ${ubicacion})`;
                    } else if (estado === 'EN TRANSITO') {
                        out.isValid = false;
                        out.message = 'Ya fue despachado (En Transito)';
                    } else {
                        out.isValid = true;
                        const pipeline = entity.Detalle || entity.Servicios || '';
                        out.nextService = getNextStep(pipeline, area);
                        out.message = 'Listo para despachar -> ' + out.nextService;
                    }
                }
            }
            results.push(out);
        }
        res.json({ results });
    } catch (err) {
        console.error("Error validateBatch:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.processBatch = async (req, res) => {
    const { movements, areaId, type, usuarioId } = req.body;
    const processed = [];

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const mov of movements) {
                const codNorm = normalize(mov.orden);
                let isRecepcion = codNorm.startsWith('PRE');

                // Update Legacy Tables
                let nuevoEstado = (type === 'INGRESO') ? 'EN PROCESO' : 'EN TRANSITO';
                let nuevaUbicacion = areaId;

                // ALSO Update Logistica_Bultos if exists
                await new sql.Request(transaction)
                    .input('Est', sql.VarChar, (type === 'INGRESO') ? 'EN_STOCK' : 'EN_TRANSITO')
                    .input('Ubi', sql.VarChar, areaId)
                    .input('Cod', sql.VarChar, codNorm)
                    .query(`UPDATE Logistica_Bultos SET Estado = @Est, UbicacionActual = @Ubi WHERE CodigoEtiqueta = @Cod`);

                // Update Ordenes/Recepciones
                const qryUpdate = isRecepcion
                    ? `UPDATE Recepciones SET Estado = @Est, UbicacionActual = @Ubi WHERE Codigo = @Cod`
                    : `UPDATE Ordenes SET Estado = @Est, UbicacionActual = @Ubi WHERE CodigoOrden = @Cod`;

                await new sql.Request(transaction)
                    .input('Est', sql.VarChar, nuevoEstado)
                    .input('Ubi', sql.VarChar, nuevaUbicacion)
                    .input('Cod', sql.VarChar, codNorm)
                    .query(qryUpdate);

                // Log Legacy
                await new sql.Request(transaction)
                    .input('Cod', sql.VarChar, codNorm)
                    .input('Tipo', sql.VarChar, type)
                    .input('Area', sql.VarChar, areaId)
                    .input('UID', sql.Int, usuarioId)
                    .input('Obs', sql.NVarChar, mov.observaciones || '')
                    .query(`INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones) VALUES (@Cod, @Tipo, @Area, @UID, @Obs)`);

                processed.push({ orden: codNorm, estado: nuevoEstado });
            }

            await transaction.commit();
            res.json({ success: true, processed });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        console.error("Error processBatch:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 2. NEW WMS LOGIC (BULTOS & REMITOS)
// ==========================================

// --- BULTOS ---

exports.createBulto = async (req, res) => {
    const { codigoEtiqueta, tipo, ordenId, descripcion, ubicacion, usuarioId } = req.body;
    try {
        const pool = await getPool();
        // Insert or Update (upsert logic simple)
        const check = await pool.request().input('C', sql.VarChar, codigoEtiqueta).query("SELECT BultoID FROM Logistica_Bultos WHERE CodigoEtiqueta = @C");

        if (check.recordset.length > 0) {
            return res.json({ success: true, message: 'Bulto ya existía en sistema WMS', id: check.recordset[0].BultoID });
        }

        const r = await pool.request()
            .input('Cod', sql.VarChar, codigoEtiqueta)
            .input('Tip', sql.VarChar, tipo || 'PROD_TERMINADO')
            .input('OID', sql.Int, ordenId || null)
            .input('Desc', sql.NVarChar, descripcion || '')
            .input('Ubi', sql.NVarChar, ubicacion || 'PRODUCCION')
            .input('UID', sql.Int, usuarioId || 1)
            .query(`
                INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                OUTPUT INSERTED.BultoID
                VALUES (@Cod, @Tip, @OID, @Desc, @Ubi, 'EN_STOCK', @UID)
            `);

        res.json({ success: true, id: r.recordset[0].BultoID });
    } catch (err) {
        console.error("Error createBulto:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getBultoByLabel = async (req, res) => {
    const { label } = req.params;
    try {
        const pool = await getPool();
        const r = await pool.request().input('L', sql.VarChar, label)
            .query("SELECT * FROM Logistica_Bultos WHERE CodigoEtiqueta = @L");

        if (r.recordset.length === 0) return res.status(404).json({ error: 'Bulto no encontrado' });
        res.json(r.recordset[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- REMITOS (DISPATCH) ---

exports.createRemito = async (req, res) => {
    const { areaOrigen, areaDestino, usuarioId, bultosIds = [], newBultos = [], observations } = req.body;

    // Generar codigo remito
    const codigoRemito = `REM-${Date.now().toString().slice(-6)}`;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const finalBultosIds = [...bultosIds];

            // 0. Procesar Bultos Nuevos (Auto-Creación)
            if (newBultos && newBultos.length > 0) {
                console.log(`[createRemito] Creando ${newBultos.length} bultos automáticos...`);
                for (const nb of newBultos) {
                    // nb: { ordenId, descripcion }
                    // Generar código etiqueta automático si no viene
                    const autoLabel = `PAQ-${nb.ordenId}-${Math.floor(Math.random() * 1000)}`;

                    const rNew = await new sql.Request(transaction)
                        .input('Cod', sql.VarChar, autoLabel)
                        .input('Tip', sql.VarChar, 'PROD_TERMINADO')
                        .input('OID', sql.Int, nb.ordenId)
                        .input('Desc', sql.NVarChar, nb.descripcion || 'Generado autom. en Despacho')
                        .input('Ubi', sql.NVarChar, areaOrigen || 'PRODUCCION')
                        .input('UID', sql.Int, usuarioId || 1)
                        .query(`
                            INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                            OUTPUT INSERTED.BultoID
                            VALUES (@Cod, @Tip, @OID, @Desc, @Ubi, 'EN_STOCK', @UID)
                        `);

                    const newId = rNew.recordset[0].BultoID;
                    finalBultosIds.push(newId);
                }
            }

            if (finalBultosIds.length === 0) {
                throw new Error("No hay bultos para despachar (ni existentes ni nuevos).");
            }

            // --- AUTO-CONSUME: Consumir Insumos Transformados ---
            // Regla: Al despachar un tipo de producto (ej: PROD_TERMINADO), consumimos los insumos (ej: TELA/PRENDA) de esa orden en el área.
            if (finalBultosIds.length > 0) {
                const safeIds = finalBultosIds.filter(id => !isNaN(id)).join(',');

                if (safeIds.length > 0) {
                    // Detectar qué Tipos de contenido estamos despachando por Orden
                    const typesRes = await new sql.Request(transaction).query(`
                        SELECT DISTINCT OrdenID, Tipocontenido 
                        FROM Logistica_Bultos 
                        WHERE BultoID IN (${safeIds}) 
                        AND OrdenID IS NOT NULL
                     `);

                    for (const g of typesRes.recordset) {
                        // Para esta orden, damos de baja (PROCESADO) todo lo que sea de TIPO DIFERENTE
                        const consumedRes = await new sql.Request(transaction)
                            .input('OID', sql.Int, g.OrdenID)
                            .input('Tip', sql.VarChar, g.Tipocontenido) // El tipo que SALE
                            .input('Orig', sql.VarChar, areaOrigen)
                            .input('User', sql.Int, usuarioId || 1)
                            .query(`
                                UPDATE Logistica_Bultos 
                                SET Estado = 'PROCESADO', UbicacionActual = 'PROCESADO'
                                OUTPUT INSERTED.CodigoEtiqueta, INSERTED.BultoID
                                WHERE OrdenID = @OID 
                                AND UbicacionActual = @Orig 
                                AND Estado = 'EN_STOCK'
                                AND Tipocontenido <> @Tip -- Diferente tipo (Insumo)
                            `);

                        // Log Movements
                        for (const c of consumedRes.recordset) {
                            await registrarMovimiento(transaction, {
                                codigoBulto: c.CodigoEtiqueta,
                                tipo: 'CONSUMO',
                                area: areaOrigen,
                                usuario: usuarioId,
                                obs: `Consumo auto por salida de ${g.Tipocontenido}`,
                                estAnt: 'EN_STOCK',
                                estNew: 'PROCESADO',
                                esRecep: false
                            });
                        }
                    }
                    console.log("[createRemito] Auto-consumed inputs for dispatched orders.");
                }
            }

            // 1. Crear Cabecera
            const headRes = await new sql.Request(transaction)
                .input('Code', sql.VarChar, codigoRemito)
                .input('Orig', sql.VarChar, areaOrigen)
                .input('Dest', sql.VarChar, areaDestino)
                .input('User', sql.Int, usuarioId)
                .input('Obs', sql.NVarChar, observations)
                .query(`
                    INSERT INTO Logistica_Envios 
                    (CodigoRemito, AreaOrigenID, AreaDestinoID, UsuarioEmisor, FechaSalida, Estado, Observaciones)
                    OUTPUT INSERTED.EnvioID
                    VALUES (@Code, @Orig, @Dest, @User, GETDATE(), 'ESPERANDO_RETIRO', @Obs)
                `);
            const envioId = headRes.recordset[0].EnvioID;

            // 2. Insertar Items y Actualizar Bultos
            for (const bid of finalBultosIds) {
                // Link
                await new sql.Request(transaction)
                    .input('EID', sql.Int, envioId)
                    .input('BID', sql.Int, bid)
                    .query(`INSERT INTO Logistica_EnvioItems (EnvioID, BultoID, EstadoRecepcion) VALUES (@EID, @BID, 'PENDIENTE')`);

                // Update Bulto Status and Log Movement
                const upRes = await new sql.Request(transaction)
                    .input('BID', sql.Int, bid)
                    .query(`
                        UPDATE Logistica_Bultos 
                        SET Estado = 'EN_TRANSITO', UbicacionActual = 'TRANSITO' 
                        OUTPUT INSERTED.CodigoEtiqueta, INSERTED.Estado
                        WHERE BultoID = @BID
                    `);

                if (upRes.recordset.length > 0) {
                    const row = upRes.recordset[0];
                    await registrarMovimiento(transaction, {
                        codigoBulto: row.CodigoEtiqueta,
                        tipo: 'SALIDA',
                        area: areaOrigen,
                        usuario: usuarioId,
                        obs: `Despacho Remito ${codigoRemito}`,
                        estAnt: 'EN_STOCK',
                        estNew: 'EN_TRANSITO',
                        esRecep: false
                    });
                }
            }

            await transaction.commit();
            res.json({ success: true, dispatchCode: codigoRemito, envioId, createdCount: newBultos.length });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        console.error("Error createRemito:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.validateDispatch = async (req, res) => {
    const { bultosIds } = req.body; // Array of IDs
    // Check status
    try {
        const pool = await getPool();
        // Si la lista esta vacia es valido (quizas son todos nuevos)
        if (!bultosIds || bultosIds.length === 0) return res.json({ valid: true, details: [] });

        // Podriamos chequear si estan disponibles
        const r = await pool.request().query(`SELECT BultoID, Estado, UbicacionActual FROM Logistica_Bultos WHERE BultoID IN (${bultosIds.join(',')})`);
        res.json({ valid: true, details: r.recordset });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getRemitoByCode = async (req, res) => {
    const { code } = req.params;
    try {
        const pool = await getPool();
        // Cabecera
        const head = await pool.request().input('C', sql.VarChar, code)
            .query("SELECT * FROM Logistica_Envios WHERE CodigoRemito = @C");

        if (head.recordset.length === 0) return res.status(404).json({ error: 'Remito no encontrado' });
        const envio = head.recordset[0];

        // Items + Bulto Info + Orden Info
        const items = await pool.request().input('EID', sql.Int, envio.EnvioID)
            .query(`
                SELECT i.*, b.CodigoEtiqueta, b.Descripcion, b.OrdenID, o.Cliente, o.DescripcionTrabajo
                FROM Logistica_EnvioItems i
                INNER JOIN Logistica_Bultos b ON i.BultoID = b.BultoID
                LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID
                WHERE i.EnvioID = @EID
            `);

        res.json({ ...envio, items: items.recordset });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getIncomingRemitos = async (req, res) => {
    const { areaId } = req.query;
    if (!areaId) return res.json([]);

    try {
        const pool = await getPool();
        const r = await pool.request().input('A', sql.VarChar, areaId)
            .query(`
                SELECT e.*, 
                       (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
                FROM Logistica_Envios e
                WHERE e.AreaDestinoID = @A
                AND e.Estado IN ('ESPERANDO_RETIRO', 'EN_TRANSITO', 'DESPACHADO')
                ORDER BY e.FechaSalida DESC
            `);
        res.json(r.recordset);
    } catch (err) {
        console.error("Error getIncomingRemitos:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getOutgoingRemitos = async (req, res) => {
    const { areaId } = req.query;
    if (!areaId) return res.json([]);

    try {
        const pool = await getPool();
        const r = await pool.request().input('A', sql.VarChar, areaId)
            .query(`
                SELECT e.*, 
                       (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
                FROM Logistica_Envios e
                WHERE e.AreaOrigenID = @A
                ORDER BY e.FechaSalida DESC
            `);
        res.json(r.recordset);
    } catch (err) {
        console.error("Error getOutgoingRemitos:", err);
        res.status(500).json({ error: err.message });
    }
};

// --- RECEPCION DE DESPACHOS ---

exports.receiveDispatch = async (req, res) => {
    let { envioId, itemsRecibidos, usuarioId, areaReceptora, codigoEtiqueta } = req.body;
    // itemsRecibidos: [{ bultoId, estado: 'ESCANEADO' | 'FALTANTE' }]

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // AUTO-DETECT AREA & SINGLE MODE SUPPORT
            if (!areaReceptora) {
                // Fetch from Remito Destino
                const remitoCheck = await new sql.Request(transaction)
                    .input('EID', sql.Int, envioId)
                    .query("SELECT AreaDestinoID FROM Logistica_Envios WHERE EnvioID = @EID");
                if (remitoCheck.recordset.length > 0) {
                    areaReceptora = remitoCheck.recordset[0].AreaDestinoID;
                }
            }

            // SINGLE ITEM MODE (Scanner)
            if (codigoEtiqueta && !itemsRecibidos) {
                // Resolve BultoID
                const bultoReq = await new sql.Request(transaction)
                    .input('C', sql.VarChar, codigoEtiqueta)
                    .query("SELECT BultoID FROM Logistica_Bultos WHERE CodigoEtiqueta = @C");

                if (bultoReq.recordset.length === 0) throw new Error("Bulto no encontrado: " + codigoEtiqueta);

                const bId = bultoReq.recordset[0].BultoID;
                itemsRecibidos = [{ bultoId: bId, estado: 'ESCANEADO' }];
            }

            let receivedCount = 0;

            for (const item of itemsRecibidos) {
                // Update Logistica_EnvioItems
                await new sql.Request(transaction)
                    .input('Est', sql.VarChar, item.estado)
                    .input('EID', sql.Int, envioId)
                    .input('BID', sql.Int, item.bultoId)
                    .query(`UPDATE Logistica_EnvioItems SET EstadoRecepcion = @Est, FechaEscaneo = GETDATE() WHERE EnvioID = @EID AND BultoID = @BID`);

                // Update Bulto Location logic
                if (item.estado === 'ESCANEADO') {
                    await new sql.Request(transaction)
                        .input('Ubi', sql.VarChar, areaReceptora)
                        .input('BID', sql.Int, item.bultoId)
                        .query(`UPDATE Logistica_Bultos SET Estado = 'EN_STOCK', UbicacionActual = @Ubi WHERE BultoID = @BID`);

                    // UPDATE INVENTARIO (SYNC OR CREATE)
                    // 1. Get Code
                    const codeReq = await new sql.Request(transaction).input('BID', sql.Int, item.bultoId).query("SELECT CodigoEtiqueta FROM Logistica_Bultos WHERE BultoID = @BID");
                    const code = codeReq.recordset[0]?.CodigoEtiqueta;

                    // SCOPED VARIABLES
                    let bultoInfo = {};
                    let CodigoEtiqueta = null;
                    let OrdenID = null;

                    if (code) {
                        // 1. Get Extended Data (Try Order first, then Reception)
                        // This logic handles both internal Orders (linked in Logistica_Bultos) and Client Fabrics (Linked to Recepciones via Code)
                        const extData = await new sql.Request(transaction).input('BID', sql.Int, item.bultoId).input('Code', sql.VarChar, code)
                            .query(`
                            SELECT 
                                b.CodigoEtiqueta, 
                                b.OrdenID, 
                                b.Descripcion,
                                b.Tipocontenido,
                                o.NoDocERP,
                                r.Referencias, -- Fetch raw references
                                COALESCE(o.Cliente, r.Cliente) as Cliente
                            FROM Logistica_Bultos b
                            LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID
                            LEFT JOIN Recepciones r ON b.CodigoEtiqueta = r.Codigo
                            WHERE b.BultoID = @BID
                        `);

                        bultoInfo = extData.recordset[0] || {};
                        CodigoEtiqueta = bultoInfo.CodigoEtiqueta;

                        // Parse OrdenID from Referencias manually to be safer
                        OrdenID = bultoInfo.OrdenID;
                        if (!OrdenID) {
                            // Try to extract "Ord: 1234" from desc/ref
                            const combined = (bultoInfo.Referencias || '') + ' ' + (bultoInfo.Descripcion || '');
                            const match = combined.match(/Ord(?:en)?:?\s*(\d+)/i);
                            if (match) OrdenID = parseInt(match[1]);
                        }

                        const { Cliente } = bultoInfo;
                        console.log("Resolved Order Data:", { OrdenID, Cliente, Ref: bultoInfo.Referencias });

                        // --- AUTO-FULFILL REQUIREMENT ON CHECK-IN ---
                        if (OrdenID && areaReceptora) {
                            // --- LOGICA INTELIGENTE: ORIGEN -> ENTREGA ---
                            let reqTypeToFulfill = null;
                            let originAreaID = '';

                            // 1. Averiguar ORIGEN del Remito asociado
                            const remitoRes = await new sql.Request(transaction)
                                .input('BID', sql.Int, bultoInfo.BultoID)
                                .query(`
                                    SELECT TOP 1 e.AreaOrigenID, a.Entrega
                                    FROM Logistica_EnvioItems ei
                                    JOIN Logistica_Envios e ON ei.EnvioID = e.EnvioID
                                    LEFT JOIN Areas a ON e.AreaOrigenID = a.AreaID
                                    WHERE ei.BultoID = @BID
                                    ORDER BY e.EnvioID DESC
                                `);

                            if (remitoRes.recordset.length > 0) {
                                const row = remitoRes.recordset[0];
                                originAreaID = row.AreaOrigenID;
                                if (row.Entrega) {
                                    reqTypeToFulfill = row.Entrega; // Ej: 'DTF', 'PRENDAS', 'TELA'
                                    console.log(`[AutoCheck] Requisito detectado por Origen ${originAreaID}: ${reqTypeToFulfill}`);
                                }
                            }

                            // FALLBACK (Usando .includes para TELA DE CLIENTE)
                            if (!reqTypeToFulfill) {
                                const tipoBulto = (bultoInfo.Tipocontenido || '').toUpperCase();
                                if (tipoBulto.includes('TELA') || tipoBulto.includes('INSUMO')) reqTypeToFulfill = 'TELA';
                                else if (tipoBulto.includes('PRENDA')) reqTypeToFulfill = 'PRENDA';
                                else if (tipoBulto.includes('DTF') || tipoBulto.includes('DISENO')) reqTypeToFulfill = 'DTF';
                            }

                            if (reqTypeToFulfill) {
                                const obsAuto = `Recibido en ${areaReceptora} ${originAreaID ? 'desde ' + originAreaID : ''} (Item: ${code})`;

                                // Ajuste para búsqueda LIKE
                                let searchPattern = reqTypeToFulfill;

                                // Normalización de Plurales/Sinónimos para coincidir con ConfigRequisitos
                                if (searchPattern === 'PRENDAS') searchPattern = 'PRENDA';
                                if (searchPattern === 'CORTES') searchPattern = 'CORTES';
                                if (searchPattern === 'DTF') searchPattern = 'DISENO'; // Si definimos que DTF satisface REQ-DISENO

                                // Query de cumplimiento
                                await new sql.Request(transaction)
                                    .input('OID', sql.Int, OrdenID)
                                    .input('Type', sql.VarChar(50), `%${searchPattern}%`)
                                    .input('Area', sql.VarChar(50), areaReceptora)
                                    .input('Doc', sql.VarChar, bultoInfo.NoDocERP || '')
                                    .input('Obs', sql.NVarChar(200), obsAuto)
                                    .query(`
                                        MERGE OrdenCumplimientoRequisitos AS target
                                        USING (
                                            SELECT DISTINCT req.RequisitoID, req.AreaID, dest.OrdenID
                                            FROM ConfigRequisitosProduccion req
                                            CROSS JOIN (
                                                SELECT OrdenID FROM Ordenes 
                                                WHERE (@Doc != '' AND NoDocERP = @Doc AND AreaID = @Area AND Estado != 'CANCELADO')
                                                   OR (@Doc = '' AND OrdenID = @OID)
                                            ) dest
                                            WHERE (
                                                req.CodigoRequisito LIKE @Type
                                                OR (@Type LIKE '%DISENO%' AND req.CodigoRequisito LIKE '%DTF%')
                                                OR (@Type LIKE '%DTF%' AND req.CodigoRequisito LIKE '%DISENO%')
                                            )
                                            AND (
                                                (@Type LIKE '%TELA%' OR @Type LIKE '%DISENO%' OR @Type LIKE '%PRENDA%' OR @Type LIKE '%DTF%')
                                                OR req.AreaID = @Area
                                            )
                                        ) AS source
                                        ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
                                        WHEN MATCHED THEN
                                            UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE(), Observaciones = @Obs
                                        WHEN NOT MATCHED THEN
                                            INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                                            VALUES (source.OrdenID, source.AreaID, source.RequisitoID, 'CUMPLIDO', GETDATE(), @Obs);
                                    `);
                            }
                        }

                        // Check if exists
                        const invCheck = await new sql.Request(transaction)
                            .input('C', sql.VarChar, code)
                            .query("SELECT BobinaID, CodigoEtiqueta FROM InventarioBobinas WHERE Referencia = @C OR CodigoEtiqueta = @C");

                        const isCoilCandidate = code && (code.startsWith('PRE-') || code.startsWith('BOB-'));

                        if (invCheck.recordset.length === 0 && isCoilCandidate) {
                            // CREATE (Alta en Inventario)
                            let mts = 100;
                            if (bultoInfo && bultoInfo.Referencias) {
                                const mMatch = bultoInfo.Referencias.match(/Mts:([\d\.]+)/);
                                if (mMatch) mts = parseFloat(mMatch[1]);
                            }

                            const newLabel = `BOB-${Date.now()}-${Math.floor(Math.random() * 100)}`;
                            console.log("Creating NEW Bobina:", newLabel, "for Ref:", code, "Client:", Cliente, "Mts:", mts);

                            await new sql.Request(transaction)
                                .input('Ubi', sql.VarChar, areaReceptora)
                                .input('Ref', sql.VarChar, code)
                                .input('NewCode', sql.VarChar, newLabel)
                                .input('Cli', sql.VarChar, Cliente || null)
                                .input('Ord', sql.Int, OrdenID || null)
                                .input('Mts', sql.Decimal(10, 2), mts)
                                .query(`
                                    INSERT INTO InventarioBobinas 
                                    (InsumoID, AreaID, CodigoEtiqueta, Referencia, ClienteID, OrdenID, MetrosIniciales, MetrosRestantes, Estado, FechaIngreso, LoteProveedor)
                                    SELECT TOP 1 InsumoID, @Ubi, @NewCode, @Ref, @Cli, @Ord, @Mts, @Mts, 'Disponible', GETDATE(), 'INGRESO-CHECKIN'
                                    FROM Insumos 
                                    WHERE EsProductivo = 1 
                                    ORDER BY InsumoID ASC
                                `);

                            // [DISABLED] SYNC Logistica_Bultos & BAJA ORIGINAL - User Request: Avoid Duplicates in Logistics View
                            // The Coil (BOB) exists in Inventory only. The original Pack (PRE) remains in Logistics.

                            // 1. UPDATE LOGISTICS FOR ORIGINAL PACK (PRE) 
                            // Ensure it's marked as received in the area
                            if (code) {
                                await new sql.Request(transaction)
                                    .input('Ubi', sql.VarChar, areaReceptora)
                                    .input('C', sql.VarChar, code)
                                    .query("UPDATE Logistica_Bultos SET UbicacionActual = @Ubi, Estado = 'EN_STOCK' WHERE CodigoEtiqueta = @C");

                                await registrarMovimiento(transaction, {
                                    codigoBulto: code, tipo: 'INGRESO', area: areaReceptora, usuario: usuarioId,
                                    obs: 'Check-In (Linked to Inv)', estAnt: null, estNew: 'EN_STOCK', esRecep: true
                                });
                            }
                        } else if (invCheck.recordset.length === 0) {
                            // CASO: Item NO es Bobina/Insumo (ej. Producto Terminado SB, EMB, etc)
                            // Solo actualizamos Logística, no Inventario de Bobinas.
                            console.log("Check-In Non-Coil Item (Product):", code);

                            await new sql.Request(transaction)
                                .input('Ubi', sql.VarChar, areaReceptora)
                                .input('C', sql.VarChar, code)
                                .query("UPDATE Logistica_Bultos SET UbicacionActual = @Ubi, Estado = 'EN_STOCK' WHERE CodigoEtiqueta = @C");

                            await registrarMovimiento(transaction, {
                                codigoBulto: code,
                                tipo: 'INGRESO',
                                area: areaReceptora,
                                usuario: usuarioId,
                                obs: 'Ingreso Producto',
                                estAnt: null,
                                estNew: 'EN_STOCK',
                                esRecep: true
                            });

                        } else {
                            // UPDATE (Movimiento y Normalizacion)
                            const existing = invCheck.recordset[0];
                            let targetCode = existing.CodigoEtiqueta;

                            // Si el código actual ES un PRE de Recepcion, lo migramos a BOB. Si es otra cosa (SB, EMB), lo dejamos.
                            if (targetCode.startsWith('PRE-')) {
                                targetCode = `BOB-${Date.now()}-${Math.floor(Math.random() * 100)}`;
                                console.log("Renaming Legacy Bobina:", existing.CodigoEtiqueta, "->", targetCode);
                            }

                            console.log("Updating Bobina:", targetCode, "Client:", Cliente);

                            await new sql.Request(transaction)
                                .input('Ubi', sql.VarChar, areaReceptora)
                                .input('Ref', sql.VarChar, code)
                                .input('Cli', sql.VarChar, Cliente || null)
                                .input('Ord', sql.Int, OrdenID || null)
                                .input('FinalCode', sql.VarChar, targetCode)
                                .input('BID', sql.Int, existing.BobinaID)
                                .query(`
                                    UPDATE InventarioBobinas 
                                    SET AreaID = @Ubi,
                                        CodigoEtiqueta = @FinalCode,
                                        Referencia = @Ref,
                                        ClienteID = ISNULL(@Cli, ClienteID),
                                        OrdenID = ISNULL(@Ord, OrdenID)
                                    WHERE BobinaID = @BID
                                `);

                            // SYNC Logistica_Bultos
                            await new sql.Request(transaction)
                                .input('Cod', sql.VarChar, targetCode)
                                .input('Ubi', sql.VarChar, areaReceptora)
                                .query("UPDATE Logistica_Bultos SET UbicacionActual = @Ubi, Estado = 'EN_STOCK' WHERE CodigoEtiqueta = @Cod");

                            // Log Movimiento
                            await registrarMovimiento(transaction, {
                                codigoBulto: targetCode,
                                tipo: 'INGRESO',
                                area: areaReceptora,
                                usuario: usuarioId,
                                obs: `Check-in en ${areaReceptora}`,
                                estAnt: 'EN_TRANSITO',
                                estNew: 'EN_STOCK',
                                esRecep: true
                            });
                        }
                    }

                    receivedCount++;

                    /* 
                    // --- REQUIREMENTS ENGINE (DISABLED FOR MANUAL VALIDATION) ---
                    // Se reactivará como "Sugerencia" en la UI más adelante
                    if (OrdenID) {
                        // Logic commented out to prevent auto-save
                    }
                    */
                } else if (item.estado === 'PERDIDO') {
                    // MARCAR COMO PERDIDO EN MAESTRO DE BULTOS
                    await new sql.Request(transaction)
                        .input('BID', sql.Int, item.bultoId)
                        .query(`UPDATE Logistica_Bultos SET Estado = 'PERDIDO', UbicacionActual = 'EXTRAVIADO' WHERE BultoID = @BID`);

                    // Log Movement
                    await new sql.Request(transaction)
                        .input('BID', sql.Int, item.bultoId)
                        .query("INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones) SELECT CodigoEtiqueta, 'PERDIDA', 'EXTRAVIADO', 1, 'Reportado como perdido en Recepción' FROM Logistica_Bultos WHERE BultoID = @BID");
                }
            }

            // Check if full reception
            const check = await new sql.Request(transaction).input('EID', sql.Int, envioId)
                .query("SELECT COUNT(*) as Total, SUM(CASE WHEN EstadoRecepcion != 'PENDIENTE' THEN 1 ELSE 0 END) as Processed FROM Logistica_EnvioItems WHERE EnvioID = @EID");

            const { Total, Processed } = check.recordset[0];
            const newStatus = (Processed >= Total) ? 'RECIBIDO_TOTAL' : 'RECIBIDO_PARCIAL';

            await new sql.Request(transaction)
                .input('Est', sql.VarChar, newStatus)
                .input('UID', sql.Int, usuarioId)
                .input('EID', sql.Int, envioId)
                .query(`UPDATE Logistica_Envios SET Estado = @Est, UsuarioReceptor = @UID, FechaLlegada = GETDATE() WHERE EnvioID = @EID`);

            await transaction.commit();
            res.json({ success: true, status: newStatus });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        console.error("Error receiveDispatch:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getDashboard = async (req, res) => {
    const { areaId } = req.query;
    try {
        const pool = await getPool();

        // 1. Existing Bultos
        const r = await pool.request().input('A', sql.VarChar, areaId)
            .query(`
                SELECT 
                    b.BultoID, b.CodigoEtiqueta, b.Descripcion, b.Estado, b.UbicacionActual,
                    b.OrdenID,
                    o.CodigoOrden, o.Cliente, o.DescripcionTrabajo,
                    (SELECT COUNT(*) FROM Logistica_Bultos WHERE OrdenID = b.OrdenID) as TotalBultosOrden
                FROM Logistica_Bultos b
                LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID
                WHERE b.UbicacionActual = @A 
                AND b.Estado NOT IN ('PERDIDO', 'DESPACHADO', 'EN_TRANSITO')
            `);

        // 2. Pending Orders (Ready but No Bultos yet)
        const rPending = await pool.request().input('A', sql.VarChar, areaId)
            .query(`
                SELECT 
                   o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Estado, o.AreaID, o.EstadoLogistica
                FROM Ordenes o
                WHERE o.AreaID = @A
                AND o.Estado NOT IN ('Entregado', 'Finalizado', 'Cancelado', 'Pendiente') -- Solo en proceso activo
                AND o.OrdenID NOT IN (SELECT DISTINCT OrdenID FROM Logistica_Bultos WHERE OrdenID IS NOT NULL)
            `);

        // Estructuras de retorno
        const fallas = [];
        const incompletos = [];
        const completos = {}; // { 'NOMBRE_CANASTO': [Orders...] }

        // Agrupar bultos por Orden
        const ordersMap = {};

        // A. Procesar Bultos Reales (Asumimos que si tiene bultos, ya está "Listo" o en "Stock")
        // Pero respetamos si la orden tiene una marca específica de logística

        // ... (Lógica de bultos permanece igual, pero podemos enriquecerla con EstadoLogistica si hiciéramos JOIN en query 1) ...
        // Para consistencia, vamos a actualizar query 1 también si es necesario, pero por ahora nos enfocamos en el mappeo.

        for (const row of r.recordset) {
            const oid = row.OrdenID || 'S/O-' + row.CodigoEtiqueta;
            if (!ordersMap[oid]) {
                ordersMap[oid] = {
                    id: row.OrdenID,
                    code: row.CodigoOrden || 'S/O',
                    client: row.Cliente || 'Sin Cliente',
                    desc: row.DescripcionTrabajo || row.Descripcion,
                    area: areaId,
                    status: 'PRONTO', // Bulto físico implica 'PRONTO' usualmente
                    logStatus: 'LISTO', // Por defecto
                    bultos: []
                };
            }

            ordersMap[oid].bultos.push({
                id: row.BultoID,
                code: row.CodigoEtiqueta,
                status: row.Estado,
                desc: row.Descripcion,
                num: ordersMap[oid].bultos.length + 1,
                total: row.TotalBultosOrden || 1
            });
        }

        // B. Procesar Ordenes Pendientes
        for (const row of rPending.recordset) {
            const oid = row.OrdenID;
            if (!ordersMap[oid]) {
                ordersMap[oid] = {
                    id: row.OrdenID,
                    code: row.CodigoOrden || `ORD-${row.OrdenID}`,
                    client: row.Cliente || 'Sin Cliente',
                    desc: row.DescripcionTrabajo,
                    area: areaId,
                    status: row.Estado || 'EN PROCESO',
                    logStatus: row.EstadoLogistica, // <--- CAMPO CLAVE
                    bultos: []
                };
            }
            // Bulto Virtual
            ordersMap[oid].bultos.push({
                id: null,
                isVirtual: true,
                code: 'PENDIENTE',
                status: 'VIRTUAL',
                desc: 'Bulto Virtual',
                num: 1,
                total: 1
            });
        }

        // Clasificar Ordenes usando EstadoLogistica
        Object.values(ordersMap).forEach(ord => {
            // Prioridad 1: Bultos con Falla
            const hasFailBulto = ord.bultos.some(b => b.status === 'RETENIDO' || b.status === 'FALLA');
            // Prioridad 2: EstadoLogistica Explicito
            const logSt = (ord.logStatus || '').toUpperCase();

            // MATCH EXACTO CON VALORES DE PRODUCCION (productionFileController)
            // Valores esperados: 'Canasto Incompletos', 'Esperando Reposición', 'Canasto Produccion', 'Canasto Reposiciones'

            if (hasFailBulto || logSt.includes('REPOSICION') || logSt.includes('FALLA')) {
                fallas.push(ord);
            }
            else if (logSt.includes('INCOMPLETO')) {
                incompletos.push(ord);
            }
            else {
                // Canastos Dinámicos
                let basketName = ord.logStatus; // Mantener casing original si existe

                if (!basketName) {
                    // Si es NULL, inferimos por existencia de bultos físicos
                    const hasPhysical = ord.bultos.some(b => !b.isVirtual);
                    basketName = hasPhysical ? `Listo en ${areaId}` : `En Proceso (${areaId})`;
                } else {
                    // Normalizar 'Canasto Produccion' a 'Listo en X' para consistencia visual
                    if (basketName.toUpperCase() === 'CANASTO PRODUCCION') {
                        basketName = `Listo en ${areaId}`;
                    }
                }

                if (!completos[basketName]) completos[basketName] = [];
                completos[basketName].push(ord);
            }
        });

        res.json({
            fallas,
            incompletos,
            completos
        });

    } catch (err) {
        console.error("Error getDashboard:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getHistory = async (req, res) => {
    // Implementation similar to legacy but querying Logistica_Bultos or MovimientosLogistica
    // Keeping it simple for now
    const { areaId } = req.query;
    try {
        const pool = await getPool();
        const r = await pool.request().input('A', sql.VarChar, areaId)
            .query("SELECT TOP 50 * FROM MovimientosLogistica WHERE AreaID = @A ORDER BY FechaMovimiento DESC");
        res.json(r.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 3. TRANSPORT / CADETE
// ==========================================

exports.confirmTransport = async (req, res) => {
    const { remitoCode, scannedCodes, driverName, driverDetails, userId } = req.body;

    try {
        const pool = await getPool();

        // 1. Operator Check
        const uid = userId || 1;

        // 2. Remito Check
        const remitoRes = await pool.request()
            .input('C', sql.VarChar, remitoCode)
            .query("SELECT EnvioID, Estado, AreaOrigenID, AreaDestinoID FROM Logistica_Envios WHERE CodigoRemito = @C");

        if (remitoRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Remito no encontrado' });
        }
        const envio = remitoRes.recordset[0];

        // 3. Check Total Items vs Scanned
        const totalItemsReq = await pool.request()
            .input('EID', sql.Int, envio.EnvioID)
            .query("SELECT COUNT(*) as Total FROM Logistica_EnvioItems WHERE EnvioID = @EID");
        const totalItems = totalItemsReq.recordset[0].Total;
        const scannedCount = scannedCodes.length;

        const isPartial = scannedCount < totalItems;
        const newState = isPartial ? 'EN_TRANSITO_PARCIAL' : 'EN_TRANSITO';

        // 4. Update Transaction
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const obsText = driverDetails ? `${driverName} (${driverDetails})` : driverName;

            // Log Movements for each scanned item
            for (const code of scannedCodes) {
                // Update Movement Log
                await new sql.Request(transaction)
                    .input('Cod', sql.VarChar, code)
                    .input('Tipo', sql.VarChar, 'TRANSITO_INICIO')
                    .input('Area', sql.VarChar, 'TRANSITO')
                    .input('UID', sql.Int, uid)
                    .input('Obs', sql.NVarChar, `Salida con: ${obsText} - Remito: ${remitoCode}`)
                    .query(`
                        INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones) 
                        VALUES (@Cod, @Tipo, @Area, @UID, @Obs)
                    `);
            }

            // Update Logistica_Envios: Observaciones + Estado
            // If partial, maybe we should mark which items were NOT dispatched?
            // For now, tracking at Remito level is sufficient as per request "EN QUE ESTADO QUEDA".
            let finalObs = `Transportista: ${obsText}`;
            if (isPartial) finalObs += ` | PARCIAL (${scannedCount}/${totalItems})`;

            await new sql.Request(transaction)
                .input('Obs', sql.NVarChar, finalObs)
                .input('Est', sql.VarChar, newState)
                .input('EID', sql.Int, envio.EnvioID)
                .query("UPDATE Logistica_Envios SET Observaciones = ISNULL(Observaciones, '') + ' | ' + @Obs, Estado = @Est WHERE EnvioID = @EID");

            await transaction.commit();

            res.json({
                success: true,
                message: isPartial
                    ? `Despacho PARCIAL confirmado (${scannedCount}/${totalItems}). Estado: ${newState}`
                    : `Despacho COMPLETO confirmado. Estado: ${newState}`
            });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        console.error("Error confirmTransport:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getActiveTransports = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT TOP 200
                e.EnvioID,
                e.CodigoRemito,
                e.Estado,
                e.Observaciones,
                e.FechaSalida as FechaCreacion,
                (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalBultos,
                e.FechaSalida as Fecha
            FROM Logistica_Envios e
            ORDER BY e.FechaSalida DESC
        `);
        res.json(r.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// --- REQUISITOS DE PRODUCCION (MANUAL CHECK) ---

exports.getOrderRequirements = async (req, res) => {
    const { ordenId, areaId } = req.query;
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Area', sql.VarChar, areaId)
            .query(`
                SELECT 
                    req.RequisitoID, 
                    req.CodigoRequisito, 
                    req.Descripcion, 
                    req.EsBloqueante,
                    CASE WHEN cum.Estado = 'CUMPLIDO' THEN 1 ELSE 0 END as Cumplido,
                    cum.FechaCumplimiento
                FROM ConfigRequisitosProduccion req
                LEFT JOIN OrdenCumplimientoRequisitos cum 
                    ON req.RequisitoID = cum.RequisitoID AND cum.OrdenID = @OID
                WHERE req.AreaID = @Area
            `);
        res.json(r.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.toggleRequirement = async (req, res) => {
    const { ordenId, requisitoId, cumplido } = req.body;
    try {
        const pool = await getPool();
        if (cumplido) {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .query(`
                    DECLARE @Area NVARCHAR(50) = (SELECT AreaID FROM ConfigRequisitosProduccion WHERE RequisitoID = @RID);
                    
                    MERGE OrdenCumplimientoRequisitos AS target
                    USING (SELECT @OID as OrdenID, @RID as RequisitoID) AS source
                    ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
                    WHEN MATCHED THEN
                        UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE()
                    WHEN NOT MATCHED THEN
                        INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento)
                        VALUES (@OID, @Area, @RID, 'CUMPLIDO', GETDATE());
                `);
        } else {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .query("DELETE FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID");
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.getAreaStock = async (req, res) => {
    const { areaId } = req.query;
    try {
        const pool = await getPool();

        let query = `
            SELECT 
                b.*,
                -- Hybrid Data Fetching (Prioritize Reception/Customer Service Data)
                o.CodigoOrden,
                COALESCE(r.Codigo, '') as CodigoRecepcion,
                COALESCE(r.Cliente, o.Cliente, 'CLIENTE_NOT_FOUND') as Cliente,
                COALESCE(CONCAT(r.Tipo, ' - ', r.Detalle), r.Detalle, o.DescripcionTrabajo, b.Descripcion) as DescripcionTrabajo,
                COALESCE(r.FechaRecepcion, o.FechaIngreso, b.FechaCreacion) as FechaIngreso,
                COALESCE(r.ProximoServicio, o.ProximoServicio, 'LOGISTICA') as ProximoServicio
            FROM Logistica_Bultos b
            LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID
            -- ROBUST JOIN: Priority to Explicit ID, Fallback to String Match
            LEFT JOIN Recepciones r ON (
                b.RecepcionID = r.RecepcionID 
                OR 
                (b.RecepcionID IS NULL AND (
                    LTRIM(RTRIM(b.CodigoEtiqueta)) = LTRIM(RTRIM(r.Codigo)) 
                    OR 
                    (LTRIM(RTRIM(b.CodigoEtiqueta)) LIKE CONCAT(LTRIM(RTRIM(r.Codigo)), '-%'))
                    OR
                    LTRIM(RTRIM(r.Codigo)) = LEFT(b.CodigoEtiqueta, LEN(b.CodigoEtiqueta) - CHARINDEX('-', REVERSE(b.CodigoEtiqueta)))
                ))
            )
            
            WHERE b.Estado = 'EN_STOCK'
        `;

        if (areaId && areaId !== 'TODOS') {
            query += " AND b.UbicacionActual = @Area";
        }

        query += " ORDER BY b.BultoID DESC";

        const reqSql = pool.request();
        if (areaId && areaId !== 'TODOS') reqSql.input('Area', sql.VarChar, areaId);

        const r = await reqSql.query(query);
        res.json(r.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- LOST & FOUND ---

exports.getLostItems = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM Logistica_Bultos WHERE Estado = 'PERDIDO'");
        res.json(r.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.recoverItem = async (req, res) => {
    const { bultoId, location } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            await new sql.Request(transaction)
                .input('Loc', sql.VarChar, location || 'RECEPCION')
                .input('BID', sql.Int, bultoId)
                .query("UPDATE Logistica_Bultos SET Estado = 'EN_STOCK', UbicacionActual = @Loc WHERE BultoID = @BID");

            await new sql.Request(transaction)
                .input('Loc', sql.VarChar, location || 'RECEPCION')
                .input('BID', sql.Int, bultoId)
                .query(`
                    INSERT INTO MovimientosLogistica(CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones)
                    SELECT CodigoEtiqueta, 'RECUPERACION', @Loc, 1, 'Recuperado de Extraviados'
                    FROM Logistica_Bultos WHERE BultoID = @BID
                `);

            await transaction.commit();
            res.json({ success: true, message: 'Item recuperado existosamente' });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Let's modify confirmTransport to update Envio Status to 'EN_TRANSITO' is a good practice.
// But for now, let's query Envios with "Transporte Confirmado" in Obs OR rely on Movimientos.

// Better: Query Logistica_Envios where Estado = 'EN_TRANSITO' (if we update it)
// Let's implicitly assume any Envio created recently that is not 'RECIBIDO' and has movements 'TRANSITO_INICIO'

// Let's update `confirmTransport` to set Estado = 'EN_TRANSITO' first? 
// It's safer. BUT user is live.
// Let's Query:
// Recent movements of type TRANSITO_INICIO grouped by Remito (via Observaciones parsing or Join).

// Actually, Logistica_Envios contains "CodigoRemito".
// Let's search unique Remitos that have items in "TRANSITO" state?
// MovimientosLogistica doesn't change Item State directly in DB (Logistica_Bultos).

// Let's use a smart query:
// Get Envios where Observaciones LIKE '%Transportista:%' AND Estado != 'RECIBIDO'

// --- REQUISITOS DE PRODUCCION (MANUAL CHECK) ---

exports.getOrderRequirements = async (req, res) => {
    const { ordenId, areaId } = req.query;
    try {
        const pool = await getPool();
        // Obtener configuración + Estado actual
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Area', sql.VarChar, areaId)
            .query(`
                SELECT 
                    req.RequisitoID, 
                    req.CodigoRequisito, 
                    req.Descripcion, 
                    req.EsBloqueante,
                    CASE WHEN cum.Estado = 'CUMPLIDO' THEN 1 ELSE 0 END as Cumplido,
                    cum.FechaCumplimiento,
                    cum.Observaciones
                FROM ConfigRequisitosProduccion req
                LEFT JOIN OrdenCumplimientoRequisitos cum 
                    ON req.RequisitoID = cum.RequisitoID AND cum.OrdenID = @OID
                WHERE req.AreaID = @Area
            `);
        res.json(r.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.toggleRequirement = async (req, res) => {
    const { ordenId, requisitoId, cumplido, observaciones } = req.body; // cumplido: bool
    try {
        const pool = await getPool();
        if (cumplido) {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .input('Obs', sql.NVarChar, observaciones || '')
                .query(`
                    DECLARE @Area NVARCHAR(50) = (SELECT AreaID FROM ConfigRequisitosProduccion WHERE RequisitoID = @RID);
                    
                    MERGE OrdenCumplimientoRequisitos AS target
                    USING (SELECT @OID as OrdenID, @RID as RequisitoID) AS source
                    ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
                    WHEN MATCHED THEN
                        UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE(), Observaciones = @Obs
                    WHEN NOT MATCHED THEN
                        INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                        VALUES (@OID, @Area, @RID, 'CUMPLIDO', GETDATE(), @Obs);
                `);
        } else {
            // Si desmarca, borramos o ponemos PENDIENTE.
            // Opcionalmente podríamos dejarlo como PENDIENTE y borrar observaciones?
            // Por ahora mantenemos la lógica de eliminar para limpiar history, O
            // Si hay Observaciones, tal vez deberíamos preservar el registro como 'PENDIENTE' con la nota de por qué falla?
            // "ponme unas observaciones en esa tabla"
            // El usuario suele querer observaciones cuando FALTA algo también.
            // Para cambiar lógica simple check, vamos a permitir guardar registro 'PENDIENTE' si hay observación.

            if (observaciones) {
                await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .input('RID', sql.Int, requisitoId)
                    .input('Obs', sql.NVarChar, observaciones)
                    .query(`
                    DECLARE @Area NVARCHAR(50) = (SELECT AreaID FROM ConfigRequisitosProduccion WHERE RequisitoID = @RID);
                    MERGE OrdenCumplimientoRequisitos AS target
                    USING (SELECT @OID as OrdenID, @RID as RequisitoID) AS source
                    ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
                    WHEN MATCHED THEN
                        UPDATE SET Estado = 'PENDIENTE', Observaciones = @Obs
                    WHEN NOT MATCHED THEN
                        INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                        VALUES (@OID, @Area, @RID, 'PENDIENTE', NULL, @Obs);
                `);
            } else {
                await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .input('RID', sql.Int, requisitoId)
                    .query("DELETE FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID");
            }
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.getAvailableResources = async (req, res) => {
    const { ordenId, reqCode, areaId } = req.query;
    console.log(`[getAvailableResources] Buscando para Orden ${ordenId}, Req: ${reqCode}, Area: ${areaId}`);

    try {
        const pool = await getPool();

        // 1. Obtener Datos de la Orden (Cliente)
        const orderRes = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query("SELECT Cliente FROM Ordenes WHERE OrdenID = @OID");

        if (orderRes.recordset.length === 0) return res.json([]);
        const clienteNombre = orderRes.recordset[0].Cliente || '';
        console.log(`[REQ] Cliente: '${clienteNombre}'`);

        let resources = [];
        let specificFound = false;

        // Lógica según tipo de requisito
        if (reqCode && reqCode.includes('TELA')) {
            // ESTRATEGIA 1: Búsqueda Específica
            const queryBob = `
                    SELECT 
                        BobinaID as id, 
                        CASE WHEN CodigoEtiqueta IS NULL THEN 'Bob-' + CAST(BobinaID as varchar) ELSE CodigoEtiqueta END as label, 
                        'Bobina ' + CAST(BobinaID as varchar) + ' (' + CAST(MetrosRestantes as varchar) + 'm) - ' + ISNULL(Referencia, '') as description,
                        Ubicacion as location
                    FROM InventarioBobinas 
                    WHERE Estado IN ('Disponible', 'En Uso')
                    AND InsumoID = 1146 -- Filtro Solicitado
                    AND (
                         OrdenID = @OID 
                         OR Referencia LIKE '%' + @CliName + '%'
                    )
            `;
            const rSpecific = await pool.request()
                .input('CliName', sql.NVarChar, clienteNombre || 'XXXXXXXX')
                .input('OID', sql.Int, ordenId)
                .query(queryBob);

            resources = rSpecific.recordset;

            if (resources.length > 0) specificFound = true;

            // ESTRATEGIA 2: Fallback (Top 50 disponibles recientes FILTRANDO InsumoID)
            if (resources.length === 0) {
                console.log("[REQ] No specific coils found. Fetching generic available coils (Insumo 1146).");
                const rFallback = await pool.request()
                    .query(`
                        SELECT TOP 50
                            BobinaID as id, 
                            CASE WHEN CodigoEtiqueta IS NULL THEN 'Bob-' + CAST(BobinaID as varchar) ELSE CodigoEtiqueta END as label, 
                            'Bobina ' + CAST(BobinaID as varchar) + ' (' + CAST(MetrosRestantes as varchar) + 'm) - ' + ISNULL(Referencia, '') as description,
                            Ubicacion as location
                        FROM InventarioBobinas 
                        WHERE Estado IN ('Disponible')
                        AND InsumoID = 1146 -- Filtro Solicitado
                        ORDER BY FechaIngreso DESC
                    `);
                resources = rFallback.recordset;
            }
        }
        else if (reqCode && (reqCode.includes('PRENDA') || reqCode.includes('CORTES'))) {
            // Buscar Bultos Específicos
            const rSpecific = await pool.request()
                .input('OID', sql.Int, ordenId)
                .query(`
                    SELECT 
                        BultoID as id, 
                        CodigoEtiqueta as label, 
                        Descripcion + ' (' + Estado + ')' as description, 
                        UbicacionActual as location
                    FROM Logistica_Bultos
                    WHERE OrdenID = @OID
                    AND Estado IN ('EN_STOCK', 'EN_TRANSITO')
                `);
            resources = rSpecific.recordset;
            if (resources.length > 0) specificFound = true;

            // Fallback Bultos - FILTRADO POR AREA
            if (resources.length === 0) {
                let locationFilter = null;
                if (areaId === 'EMB') locationFilter = 'BORDADO';
                if (areaId === 'EST') locationFilter = 'ESTAMPADO';
                if (areaId === 'TWT') locationFilter = 'COSTURA'; // Asunción
                if (areaId === 'TWC') locationFilter = 'CORTE';

                let queryFallback = `
                        SELECT TOP 50
                            BultoID as id, 
                            CodigoEtiqueta as label, 
                            Descripcion + ' (' + Estado + ')' as description, 
                            UbicacionActual as location
                        FROM Logistica_Bultos
                        WHERE Estado IN ('EN_STOCK')
                 `;

                if (locationFilter) {
                    queryFallback += ` AND UbicacionActual = @LocFilter`;
                }

                queryFallback += ` ORDER BY BultoID DESC`;

                const reqFallback = pool.request();
                if (locationFilter) reqFallback.input('LocFilter', sql.VarChar, locationFilter);

                const rFallback = await reqFallback.query(queryFallback);
                resources = rFallback.recordset;
            }
        }

        console.log(`[REQ] Returning ${resources.length} resources (Specific: ${specificFound})`);
        res.json(resources);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// Duplicate getAreaStock removed. Main implementation is above.

// --- LOST & FOUND ---

exports.getLostItems = async (req, res) => {
    try {
        const pool = await getPool();
        // Fetch items with state 'PERDIDO'
        // Also fetch last update time if possible (assume Fecha is in Logs?)
        // For simplicity, just get from Bultos table
        const r = await pool.request().query("SELECT * FROM Logistica_Bultos WHERE Estado = 'PERDIDO'");
        res.json(r.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.recoverItem = async (req, res) => {
    const { bultoId, location } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Update Bulto
            await new sql.Request(transaction)
                .input('Loc', sql.VarChar, location || 'RECEPCION')
                .input('BID', sql.Int, bultoId)
                .query("UPDATE Logistica_Bultos SET Estado = 'EN_STOCK', UbicacionActual = @Loc WHERE BultoID = @BID");

            // 2. Log Movement
            await new sql.Request(transaction)
                .input('Loc', sql.VarChar, location || 'RECEPCION')
                .input('BID', sql.Int, bultoId)
                .query(`
                    INSERT INTO MovimientosLogistica(CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones)
                    SELECT CodigoEtiqueta, 'RECUPERACION', @Loc, 1, 'Recuperado de Extraviados'
                    FROM Logistica_Bultos WHERE BultoID = @BID
            `);

            await transaction.commit();
            res.json({ success: true, message: 'Item recuperado existosamente' });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
