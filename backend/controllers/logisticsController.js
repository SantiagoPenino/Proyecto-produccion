const contabilidadService = require('../services/contabilidadService');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { changeOrderState } = require('../services/stateManagerService');
const { isPedidoCompletoEnArea, isPedidoCompletoGlobal, sqlExistsHermanaNoPronta } = require('../services/pedidoCompletoService');

// [PRENDAS] "Comprar y personalizar": Bordado/DTF/TPU/Estampado/Corte/Costura que cuelgan
// de una orden madre PRO (prenda comprada + personalizaciones, un solo precio) son trabajo
// interno — mismo trato que la hermana TERMINAC de ECOUV: no generan fila propia en
// OrdenesDeposito, así que no se cobran aparte ni disparan su propio WhatsApp. Solo la
// orden PRO cobra/avisa.
const esHermanaDePrendaPersonalizada = async (pool, codigoOrden) => {
    if (!codigoOrden) return false;
    try {
        const r = await pool.request()
            .input('Cod', require('mssql').VarChar, codigoOrden)
            .query(`
                SELECT TOP 1 1 AS X
                FROM Ordenes o
                JOIN Ordenes madre ON madre.NoDocERP = o.NoDocERP AND madre.AreaID = 'PRO'
                WHERE o.CodigoOrden = @Cod AND o.AreaID IN ('EMB', 'DF', 'TPU', 'EST', 'TWC', 'TWT', 'SB')
            `);
        return r.recordset.length > 0;
    } catch (e) {
        logger.warn('[Prendas] esHermanaDePrendaPersonalizada:', e.message);
        return false;
    }
};

// [PRENDAS] A qué orden corresponde REALMENTE el registro de OrdenesDeposito: si la orden
// que llega a Depósito es una hermana (EMB/DF/TPU/EST/TWC/TWT) de una PRO, hay que
// REDIRIGIR el registro a la madre — no simplemente omitirlo. Con varias hermanas
// convergiendo por separado (ej. Estampado partido en 1/2 y 2/2, cada una con su propio
// check-in), si la hermana se limita a excluirse sin redirigir, cuando la ÚLTIMA en llegar
// es justo una hermana, nada crea el registro y el pedido entero se queda sin cobrar ni
// avisar. Las llamadas siguientes (de otras hermanas del mismo pedido) van a encontrar el
// registro de la madre ya creado — el checkeo "existe" de cada call site sigue funcionando
// igual, solo que ahora busca por el CodigoOrden de la madre en vez del de la hermana.
// Devuelve null si no hay hermana que redirigir (orden normal, sigue su propio camino) o si
// es hermana pero no se pudo resolver la madre (más seguro no crear nada que facturar mal).
const resolverOrdenParaDeposito = async (pool, ordenId, codigoOrden) => {
    const esHermana = await esHermanaDePrendaPersonalizada(pool, codigoOrden);
    if (!esHermana) return { ordenId, codigoOrden };
    try {
        const r = await pool.request()
            .input('OID', require('mssql').Int, ordenId)
            .query(`
                SELECT TOP 1 madre.OrdenID, madre.CodigoOrden, madre.CliIdCliente, madre.CodCliente,
                       madre.DescripcionTrabajo, madre.ProIdProducto, madre.Magnitud
                FROM Ordenes o
                JOIN Ordenes madre ON madre.NoDocERP = o.NoDocERP AND madre.AreaID = 'PRO'
                WHERE o.OrdenID = @OID
            `);
        if (r.recordset.length > 0) {
            const m = r.recordset[0];
            return {
                ordenId: m.OrdenID, codigoOrden: m.CodigoOrden,
                cliIdCliente: m.CliIdCliente, codCliente: m.CodCliente,
                descripcionTrabajo: m.DescripcionTrabajo, proIdProducto: m.ProIdProducto,
                magnitud: m.Magnitud,
            };
        }
    } catch (e) {
        logger.warn('[Prendas] resolverOrdenParaDeposito:', e.message);
    }
    return null;
};

/**
 * Valida la regla de pedido completo para un conjunto de órdenes a despachar/recibir:
 *  - destino DEPOSITO  → el pedido debe estar completo GLOBALMENTE (todas las áreas).
 *  - destino otra área → el pedido debe estar completo EN EL ÁREA de la orden.
 * Lanza Error (statusCode 400) con el detalle de las órdenes faltantes.
 */
const validarPedidosCompletos = async (db, ordenes, areaDestino) => {
    const pedidosChequeados = new Set();
    for (const ord of ordenes) {
        if (!ord.NoDocERP) continue;
        const key = `${ord.NoDocERP}|${ord.AreaID || ''}`;
        if (pedidosChequeados.has(key)) continue;
        pedidosChequeados.add(key);

        const chk = (areaDestino === 'DEPOSITO')
            ? await isPedidoCompletoGlobal(db, ord.NoDocERP)
            : await isPedidoCompletoEnArea(db, ord.NoDocERP, ord.AreaID);

        if (!chk.completo) {
            const detalle = chk.faltantes
                .map(f => `${f.CodigoOrden} (${f.EstadoenArea || f.Estado || 'Pendiente'})`)
                .join(', ');
            const err = new Error(
                `Pedido ${ord.NoDocERP} incompleto${areaDestino === 'DEPOSITO' ? '' : ` en ${ord.AreaID}`}: faltan ${detalle}. ` +
                `No se puede ${areaDestino === 'DEPOSITO' ? 'enviar/recibir en DEPOSITO' : 'despachar'} hasta que el pedido esté completo.`
            );
            err.statusCode = 400;
            throw err;
        }
    }
};



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
        logger.error("Error registrando movimiento:", e);
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
        logger.error("Error validateBatch:", err);
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
                let nuevoEstado = (type === 'INGRESO') ? (areaId === 'LOCAL' ? 'PRONTO PARA ENTREGAR' : 'EN PROCESO') : 'EN TRANSITO';
                let nuevaUbicacion = areaId;

                // ALSO Update Logistica_Bultos if exists
                await new sql.Request(transaction)
                    .input('Est', sql.VarChar, (type === 'INGRESO') ? 'EN_STOCK' : 'EN_TRANSITO')
                    .input('Ubi', sql.VarChar, areaId)
                    .input('Cod', sql.VarChar, codNorm)
                    .query(`UPDATE Logistica_Bultos SET Estado = @Est, UbicacionActual = @Ubi WHERE CodigoEtiqueta = @Cod`);

                // Update Ordenes/Recepciones (dominio logística: estado propio, NO pasa por el servicio de estados de producción)
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
        logger.error("Error processBatch:", err);
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
        logger.error("Error createBulto:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.resolveBultoQR = async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código faltante' });

    // 1. If it's already a giant string, just return it
    if (code.includes('$*')) {
        return res.json({ qrString: code });
    }

    try {
        const pool = await getPool();
        // Buscar el Bulto o código directo
        const bultoReq = await pool.request()
            .input('Cod', sql.VarChar, code)
            .query("SELECT OrdenID FROM Logistica_Bultos WHERE CodigoEtiqueta = @Cod");
            
        let ordenId = null;
        if (bultoReq.recordset.length > 0) {
            ordenId = bultoReq.recordset[0].OrdenID;
        } else {
            // Verificar si mandaron el CodigoOrden (ej. DF-90952)
            const ordReq = await pool.request()
                .input('Cod', sql.VarChar, code)
                .query("SELECT OrdenID FROM Ordenes WHERE CodigoOrden = @Cod");
            if (ordReq.recordset.length > 0) {
                ordenId = ordReq.recordset[0].OrdenID;
            } else {
                // Chequear OrdenesDeposito por las dudas
                const ordDepReq = await pool.request()
                    .input('Cod', sql.VarChar, code)
                    .query("SELECT OrdIdOrden as OrdenID FROM OrdenesDeposito WHERE OrdCodigoOrden = @Cod");
                if (ordDepReq.recordset.length > 0) {
                    ordenId = ordDepReq.recordset[0].OrdenID;
                }
            }
        }

        if (!ordenId) {
            return res.status(404).json({ error: 'No se pudo resolver el código a una orden.' });
        }

        // Recuperar el CodigoQR gigante de Etiquetas
        const qrReq = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query("SELECT TOP 1 CodigoQR FROM Etiquetas WHERE OrdenID = @OID AND CodigoQR IS NOT NULL");
            
        if (qrReq.recordset.length > 0 && qrReq.recordset[0].CodigoQR) {
            return res.json({ qrString: qrReq.recordset[0].CodigoQR, fromLabel: true, ordenId });
        }

        return res.status(404).json({ error: 'La orden no tiene un código QR crudo asignado (genere etiquetas).'});
    } catch (err) {
        logger.error("Error resolveBultoQR:", err);
        return res.status(500).json({ error: err.message });
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
                logger.info(`[createRemito] Creando ${newBultos.length} bultos automáticos...`);
                for (const nb of newBultos) {
                    // nb: { ordenId, descripcion }
                    // Generar código etiqueta automático si no viene
                    const autoLabel = `PAQ-${nb.ordenId}-${Math.floor(Math.random() * 1000)}`;

                    const rNew = await new sql.Request(transaction)
                        .input('Cod', sql.VarChar, autoLabel)
                        .input('Tip', sql.VarChar, nb.tipo || 'PROD_TERMINADO')
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

            // --- GATE PEDIDO COMPLETO ---
            // Solo aplica a producto terminado: los insumos (TELA, PRENDA, etc.) que viajan
            // entre áreas para producir no se bloquean. Encomiendas tampoco (OrdenID apunta a OrdenesRetiro).
            // ENTREGAS PARCIALES: las áreas listadas en ConfiguracionGlobal.AREAS_DESPACHO_PARCIAL
            // pueden despachar un SUBCONJUNTO de bultos a OTRA área (no a DEPOSITO) sin exigir que el
            // pedido salga completo — para pedidos grandes que se mandan por tandas (ej. DIRECTA → Corte).
            // El resto de las áreas mantiene el candado de "pedido completo" intacto.
            let permiteParcial = false;
            if (areaOrigen && areaDestino !== 'DEPOSITO') {
                try {
                    const cfg = await new sql.Request(transaction)
                        .query("SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'AREAS_DESPACHO_PARCIAL'");
                    const areasParcial = (cfg.recordset[0]?.Valor || '')
                        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                    permiteParcial = areasParcial.includes(String(areaOrigen).trim().toUpperCase());
                } catch (e) {
                    logger.warn('[createRemito] No se pudo leer AREAS_DESPACHO_PARCIAL:', e.message);
                }
            }

            const idsGate = finalBultosIds.filter(id => !isNaN(id)).join(',');
            if (idsGate.length > 0) {
                const ordenesGate = await new sql.Request(transaction).query(`
                    SELECT DISTINCT o.OrdenID, o.CodigoOrden, o.NoDocERP, o.AreaID
                    FROM Logistica_Bultos b
                    JOIN Ordenes o ON b.OrdenID = o.OrdenID
                    WHERE b.BultoID IN (${idsGate})
                      AND b.Tipocontenido = 'PROD_TERMINADO'
                `);

                if (!permiteParcial) {
                    await validarPedidosCompletos(transaction, ordenesGate.recordset, areaDestino);

                    // --- CANDADO: el pedido debe salir COMPLETO del área ---
                    // No deja despachar si quedan bultos del mismo pedido (misma área, producto terminado,
                    // en stock, sin remito) por fuera de este despacho. Garantiza que el pedido no se parta.
                    const nodocs = [...new Set(ordenesGate.recordset.map(o => o.NoDocERP).filter(Boolean).map(n => String(n).trim()))];
                    if (nodocs.length > 0 && areaOrigen) {
                        const nodocList = nodocs.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
                        const faltan = await new sql.Request(transaction)
                            .input('AreaOrig', sql.VarChar, areaOrigen)
                            .query(`
                                SELECT DISTINCT o.CodigoOrden
                                FROM Logistica_Bultos b
                                JOIN Ordenes o ON b.OrdenID = o.OrdenID
                                WHERE LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) IN (${nodocList})
                                  AND b.UbicacionActual = @AreaOrig
                                  AND b.Estado = 'EN_STOCK'
                                  AND b.Tipocontenido = 'PROD_TERMINADO'
                                  AND b.BultoID NOT IN (${idsGate})
                                  -- Fallas internas (-F): NUNCA obligan a "salir completo" — son órdenes
                                  -- efímeras que reponen material de la madre, no un ítem del pedido del cliente.
                                  AND (o.CodigoOrden IS NULL OR o.CodigoOrden NOT LIKE '%-F%')
                                  AND NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems ei WHERE ei.BultoID = b.BultoID)
                            `);
                        if (faltan.recordset.length > 0) {
                            const det = [...new Set(faltan.recordset.map(f => f.CodigoOrden))].join(', ');
                            const err = new Error(`El pedido debe salir completo del área. Faltan por agregar al remito: ${det}.`);
                            err.statusCode = 400;
                            throw err;
                        }
                    }
                }
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
                    logger.info("[createRemito] Auto-consumed inputs for dispatched orders.");
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
            const dispatchedOrders = new Set();
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
                        OUTPUT INSERTED.CodigoEtiqueta, INSERTED.Estado, INSERTED.Tipocontenido, INSERTED.OrdenID
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
                    
                    // IF it's an encomienda, mark the Order as Dispatched (State 10) to block it from being selected again
                    if (row.Tipocontenido === 'ENCOMIENDA' && row.OrdenID) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, row.OrdenID)
                            .query(`
                                UPDATE OrdenesRetiro 
                                SET OReEstadoActual = 10, OReFechaEstadoActual = GETDATE() 
                                WHERE OReIdOrdenRetiro = @OID
                            `);
                    } else if (row.Tipocontenido !== 'ENCOMIENDA' && row.OrdenID) {
                        dispatchedOrders.add(row.OrdenID);
                    }
                }
            }

            for (const oid of dispatchedOrders) {
                // Despacho PARCIAL: la orden avanza a "En transito" recién cuando salió su ÚLTIMO bulto
                // terminado del área de origen. Si quedan bultos en stock (otra tanda), no avanza todavía.
                // En despacho normal el candado ya garantizó que salió completo → no quedan bultos → avanza igual.
                if (permiteParcial) {
                    const rem = await new sql.Request(transaction)
                        .input('OID', sql.Int, oid)
                        .input('AreaOrig', sql.VarChar, areaOrigen || '')
                        .query(`
                            SELECT COUNT(*) AS n FROM Logistica_Bultos
                            WHERE OrdenID = @OID
                              AND Tipocontenido = 'PROD_TERMINADO'
                              AND Estado = 'EN_STOCK'
                              AND UbicacionActual = @AreaOrig
                        `);
                    if ((rem.recordset[0]?.n || 0) > 0) continue; // quedan bultos → no avanzar aún
                }

                await changeOrderState(transaction, {
                    target   : { type: 'ORDER', id: oid },
                    estado   : 'En transito',
                    userObj  : req.user || req.body.usuario || usuarioId || 'Sistema',
                    detalle  : `Asignado a remito y numero del remito ${codigoRemito}`,
                    io       : req.app.get('socketio')
                });
            }

            await transaction.commit();
            res.json({ success: true, dispatchCode: codigoRemito, envioId, createdCount: newBultos.length });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error("Error createRemito:", err);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
};

exports.createRemitoFromOrders = async (req, res) => {
    const { areaOrigen, areaDestino, usuarioId, orderIds = [], observations } = req.body;
    
    if (!orderIds || orderIds.length === 0) {
        return res.status(400).json({ error: "No orders provided" });
    }

    try {
        const pool = await getPool();
        
        // 1. Fetch existing bultos for these orders that are in the areaOrigen AND not dispatched
        const bultosRes = await pool.request()
            .input('Orig', sql.VarChar, areaOrigen)
            .query(`
                SELECT BultoID, OrdenID 
                FROM Logistica_Bultos 
                WHERE OrdenID IN (${orderIds.join(',')}) 
                AND UbicacionActual = @Orig 
                AND Estado = 'EN_STOCK'
            `);
            
        const existingBultos = bultosRes.recordset;
        const bultosIds = existingBultos.map(b => b.BultoID);
        const ordersWithBultos = new Set(existingBultos.map(b => b.OrdenID));
        
        // 2. Identify orders that DO NOT have bultos yet
        const newBultos = [];
        for (const oid of orderIds) {
            if (!ordersWithBultos.has(oid)) {
                // Fetch basic order info to create the bulto
                const ordReq = await pool.request().input('OID', sql.Int, oid).query("SELECT Cliente, CodigoOrden FROM Ordenes WHERE OrdenID = @OID");
                let desc = "Auto-generado";
                if(ordReq.recordset.length > 0) desc = `${ordReq.recordset[0].CodigoOrden} - ${ordReq.recordset[0].Cliente}`;
                
                newBultos.push({
                    ordenId: oid,
                    descripcion: desc,
                    tipo: 'PROD_TERMINADO'
                });
            }
        }
        
        // 3. Delegate to existing logic by overriding req.body
        req.body = {
            areaOrigen,
            areaDestino,
            usuarioId,
            bultosIds,
            newBultos,
            observations
        };
        
        return exports.createRemito(req, res);
        
    } catch (err) {
        logger.error("Error createRemitoFromOrders:", err);
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
                SELECT i.*, b.Estado as BultoEstado, b.CodigoEtiqueta, b.Descripcion, b.OrdenID, b.ComprobantePath,
                       b.Tipocontenido, o.Cliente, o.DescripcionTrabajo, o.CodigoOrden, o.NoDocERP,
                       cliord.IDCliente AS IDCliente,
                       et.NumeroBulto, et.TotalBultos,
                       CASE
                           WHEN b.Tipocontenido = 'ENCOMIENDA' AND ret.OReIdOrdenRetiro IS NOT NULL
                           THEN ISNULL(ret.FormaRetiro, 'R') + '-' + CAST(ret.OReIdOrdenRetiro AS VARCHAR)
                           ELSE NULL
                       END AS RetiroAsociado,
                       ret.OReIdOrdenRetiro AS RetiroID,
                       ret.ReceptorNombre,
                       cli.Nombre AS ClienteRetiro
                FROM Logistica_EnvioItems i
                INNER JOIN Logistica_Bultos b ON i.BultoID = b.BultoID
                -- OJO: en bultos de ENCOMIENDA el OrdenID es el N° de OrdenesRetiro, NO de
                -- Ordenes — sin el filtro, una encomienda vieja se cuelga de la orden NUEVA
                -- que nació con ese mismo OrdenID (caso XEUV-12142 vs PAQ-12662-535).
                LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
                LEFT JOIN dbo.Clientes cliord WITH(NOLOCK) ON o.CliIdCliente = cliord.CliIdCliente
                LEFT JOIN OrdenesRetiro ret ON b.OrdenID = ret.OReIdOrdenRetiro
                LEFT JOIN Clientes cli ON ret.CodCliente = cli.CodCliente
                OUTER APPLY (
                    SELECT TOP 1 E.NumeroBulto, E.TotalBultos
                    FROM Etiquetas E WITH(NOLOCK)
                    WHERE E.CodigoEtiqueta = b.CodigoEtiqueta
                ) et
                WHERE i.EnvioID = @EID
            `);

        res.json({ ...envio, items: items.recordset });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.searchRemitos = async (req, res) => {
    const { query } = req.query;
    console.log('[SEARCH REMITOS] query recibida:', query);
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Q',      sql.VarChar, `%${query}%`)
            .input('QExact', sql.VarChar, query)
            .query(`
                SELECT DISTINCT TOP 20
                    e.EnvioID,
                    e.CodigoRemito,
                    e.Estado,
                    e.FechaSalida,
                    e.AreaOrigenID,
                    e.AreaDestinoID,
                    (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) AS TotalItems,
                    -- Código de la orden que coincidió con la búsqueda
                    COALESCE(od.OrdCodigoOrden, o.CodigoOrden, CAST(b.OrdenID AS VARCHAR)) AS OrdenEncontrada
                FROM Logistica_Envios e
                INNER JOIN Logistica_EnvioItems i  ON e.EnvioID  = i.EnvioID
                INNER JOIN Logistica_Bultos     b  ON i.BultoID  = b.BultoID
                -- Encomiendas: su OrdenID es el N° de OrdenesRetiro, no de Ordenes — sin el
                -- filtro, buscar una orden nueva encontraba remitos viejos de encomiendas ajenas.
                LEFT  JOIN Ordenes              o  ON o.OrdenID  = b.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
                LEFT  JOIN OrdenesDeposito      od ON od.OrdIdOrden = b.OrdenID
                WHERE b.CodigoEtiqueta   LIKE @Q
                   OR CAST(b.OrdenID AS VARCHAR) = @QExact
                   OR e.CodigoRemito              = @QExact
                   OR o.CodigoOrden               LIKE @Q
                   OR CAST(o.NoDocERP AS VARCHAR)  LIKE @Q
                   OR od.OrdCodigoOrden            LIKE @Q
                ORDER BY e.FechaSalida DESC
            `);
        console.log('[SEARCH REMITOS] resultados:', r.recordset.length);
        res.json(r.recordset);
    } catch (err) {
        console.error('[SEARCH REMITOS] ERROR:', err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.getIncomingRemitos = async (req, res) => {
    const { areaId } = req.query;
    if (!areaId) return res.json([]);
    const isTodos = areaId === 'TODOS';

    try {
        const pool = await getPool();
        const q = isTodos ? `
            SELECT e.*, 
                   (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
            FROM Logistica_Envios e
            WHERE e.Estado IN ('ESPERANDO_RETIRO', 'EN_TRANSITO', 'EN_TRANSITO_PARCIAL', 'DESPACHADO', 'RECIBIDO_PARCIAL')
            ORDER BY e.FechaSalida DESC
        ` : `
            SELECT e.*, 
                   (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
            FROM Logistica_Envios e
            WHERE e.AreaDestinoID = @A
            AND e.Estado IN ('ESPERANDO_RETIRO', 'EN_TRANSITO', 'EN_TRANSITO_PARCIAL', 'DESPACHADO', 'RECIBIDO_PARCIAL')
            ORDER BY e.FechaSalida DESC
        `;
        
        const r = await pool.request().input('A', sql.VarChar, areaId).query(q);
        res.json(r.recordset);
    } catch (err) {
        logger.error("Error getIncomingRemitos:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getOutgoingRemitos = async (req, res) => {
    const { areaId } = req.query;
    if (!areaId) return res.json([]);
    const isTodos = areaId === 'TODOS';

    try {
        const pool = await getPool();
        const q = isTodos ? `
            SELECT e.*, 
                   (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
            FROM Logistica_Envios e
            ORDER BY e.FechaSalida DESC
        ` : `
            SELECT e.*, 
                   (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
            FROM Logistica_Envios e
            WHERE e.AreaOrigenID = @A
            ORDER BY e.FechaSalida DESC
        `;
        
        const r = await pool.request().input('A', sql.VarChar, areaId).query(q);
        res.json(r.recordset);
    } catch (err) {
        logger.error("Error getOutgoingRemitos:", err);
        res.status(500).json({ error: err.message });
    }
};

// --- RECEPCION DE DESPACHOS ---

exports.receiveDispatch = async (req, res) => {
    let { envioId, itemsRecibidos, usuarioId, areaReceptora, codigoEtiqueta, forzarOrdenes } = req.body;
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

            // FORZAR-PURO (desde la bandeja "Esperando Bultos"): puede llegar sin bultos nuevos,
            // solo con forzarOrdenes. En ese caso no hay remito (envioId) ni items.
            if (!itemsRecibidos) itemsRecibidos = [];
            if (!areaReceptora && Array.isArray(forzarOrdenes) && forzarOrdenes.length > 0) areaReceptora = 'DEPOSITO';

            // --- GATE PEDIDO COMPLETO: a DEPOSITO solo se recibe con el pedido completo (todas las áreas) ---
            if (areaReceptora === 'DEPOSITO') {
                const idsEscaneados = (itemsRecibidos || [])
                    .filter(i => i.estado === 'ESCANEADO' && !isNaN(i.bultoId))
                    .map(i => i.bultoId);
                if (idsEscaneados.length > 0) {
                    const ordenesGate = await new sql.Request(transaction).query(`
                        SELECT DISTINCT o.OrdenID, o.CodigoOrden, o.NoDocERP, o.AreaID
                        FROM Logistica_Bultos b
                        JOIN Ordenes o ON b.OrdenID = o.OrdenID
                        WHERE b.BultoID IN (${idsEscaneados.join(',')})
                          AND b.Tipocontenido = 'PROD_TERMINADO'
                    `);
                    await validarPedidosCompletos(transaction, ordenesGate.recordset, 'DEPOSITO');
                }
            }

            let receivedCount = 0;
            const receivedOrdersSet = new Set();
            const recibidasIntermedias = new Set();

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
                                -- [COMBOS] Si el bulto es la ancla de retiro de un combo, su NoDocERP es
                                -- el de la venta VEN- (no el del pedido real) — el auto-fulfill de más
                                -- abajo (busca la orden a desbloquear por NoDocERP+AreaID) nunca
                                -- encontraría la hermana real sin este COALESCE. Sin combo,
                                -- ComboPedidoNoDocERP es siempre NULL — no-op.
                                COALESCE(o.ComboPedidoNoDocERP, o.NoDocERP) AS NoDocERP,
                                r.Referencias, -- Fetch raw references
                                COALESCE(o.Cliente, r.Cliente) as Cliente
                            FROM Logistica_Bultos b
                            -- Encomiendas: OrdenID = N° de OrdenesRetiro → sin el filtro, el
                            -- check-in tomaba Cliente/NoDocERP de una orden NUEVA ajena.
                            LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
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
                        
                        if (OrdenID && areaReceptora === 'DEPOSITO' && item.estado === 'ESCANEADO' && bultoInfo.Tipocontenido !== 'ENCOMIENDA') {
                            receivedOrdersSet.add(Number(OrdenID));
                        }

                        // [PRENDAS] Recepción en un área INTERMEDIA (no Depósito): la orden que mandó
                        // el bulto queda 'En transito' para siempre si nadie la cierra acá — nada más
                        // la avanza. Se junta para procesar después del loop (ver más abajo), igual
                        // patrón que receivedOrdersSet pero sin la contabilidad/gate de Depósito.
                        if (OrdenID && areaReceptora && areaReceptora !== 'DEPOSITO' && item.estado === 'ESCANEADO' && bultoInfo.Tipocontenido !== 'ENCOMIENDA') {
                            recibidasIntermedias.add(Number(OrdenID));
                        }

                        // CHECK-IN EN TERMINAC: al recibir el material impreso, la orden hermana
                        // XEUV del mismo pedido pasa de 'Pendiente' a 'Material Recibido' — recién
                        // ahí queda disponible en la bandeja de terminaciones para trabajar.
                        // (Nunca con encomiendas: su OrdenID es el N° de OrdenesRetiro y el
                        // subselect por NoDocERP caería en una orden ajena.)
                        if (OrdenID && (areaReceptora || '').toUpperCase() === 'TERMINAC' && bultoInfo.Tipocontenido !== 'ENCOMIENDA') {
                            try {
                                const herRes = await new sql.Request(transaction)
                                    .input('OID', sql.Int, OrdenID)
                                    .query(`
                                        SELECT H.OrdenID FROM Ordenes H
                                        WHERE H.AreaID = 'TERMINAC' AND H.Estado NOT IN ('Cancelado')
                                          AND ISNULL(H.EstadoenArea, 'Pendiente') = 'Pendiente'
                                          AND H.NoDocERP = (SELECT NoDocERP FROM Ordenes WHERE OrdenID = @OID)
                                    `);
                                for (const her of herRes.recordset) {
                                    await changeOrderState(transaction, {
                                        target : { type: 'ORDER', id: her.OrdenID },
                                        estado : 'Material Recibido',
                                        userObj: req.user || 'Sistema',
                                        detalle: `Material impreso recibido en Terminaciones (bulto ${CodigoEtiqueta || item.bultoId})`,
                                        io     : req.app.get('socketio')
                                    });
                                    logger.info(`[Check-in TERMINAC] Orden ${her.OrdenID} -> Material Recibido (bulto ${CodigoEtiqueta})`);
                                }
                            } catch (eTer) {
                                logger.warn('[Check-in TERMINAC] No se pudo actualizar la hermana de terminaciones:', eTer.message);
                            }
                        }

                        const { Cliente } = bultoInfo;
                        logger.info("Resolved Order Data:", { OrdenID, Cliente, Ref: bultoInfo.Referencias });

                        // --- AUTO-FULFILL REQUIREMENT ON CHECK-IN ---
                        if (OrdenID && areaReceptora) {
                            // --- LOGICA INTELIGENTE: ORIGEN -> ENTREGA ---
                            let reqTypeToFulfill = null;
                            let originAreaID = '';

                            // 1. Averiguar ORIGEN del Remito asociado
                            // bultoInfo NO trae BultoID (el SELECT de extData no lo pide) — quedaba
                            // undefined y esta consulta no encontraba NUNCA el remito, por lo que
                            // el auto-cumplimiento de requisitos por Origen→Entrega jamás disparaba
                            // (silenciosamente caía al fallback por Tipocontenido, que tampoco
                            // reconoce 'PROD_TERMINADO'). item.bultoId es el ID real del bulto que
                            // se está procesando en esta vuelta del loop.
                            const remitoRes = await new sql.Request(transaction)
                                .input('BID', sql.Int, item.bultoId)
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
                                originAreaID = (row.AreaOrigenID || '').trim();
                                // Areas.Entrega es CHAR de ancho fijo (relleno con espacios, ej.
                                // 'PRENDAS   ') — sin el trim la normalización plural->singular de
                                // abajo (=== 'PRENDAS') nunca daba verdadero y el LIKE de más abajo
                                // jamás matcheaba nada: el requisito quedaba "Pendiente" para siempre
                                // aunque el check-in se hiciera perfecto.
                                if (row.Entrega && row.Entrega.trim()) {
                                    reqTypeToFulfill = row.Entrega.trim(); // Ej: 'DTF', 'PRENDAS', 'TELA'
                                    logger.info(`[AutoCheck] Requisito detectado por Origen ${originAreaID}: ${reqTypeToFulfill}`);
                                }
                            }

                            // FALLBACK (Usando .includes para TELA DE CLIENTE)
                            if (!reqTypeToFulfill) {
                                const tipoBulto = (bultoInfo.Tipocontenido || '').toUpperCase();
                                if (tipoBulto.includes('TELA') || tipoBulto.includes('INSUMO')) reqTypeToFulfill = 'TELA';
                                else if (tipoBulto.includes('PRENDA')) reqTypeToFulfill = 'PRENDA';
                                else if (tipoBulto.includes('DTF') || tipoBulto.includes('DISENO')) reqTypeToFulfill = 'DTF';
                                else if (originAreaID === 'SB') reqTypeToFulfill = 'TELA';
                            }

                            if (reqTypeToFulfill) {
                                const obsAuto = `Recibido en ${areaReceptora} ${originAreaID ? 'desde ' + originAreaID : ''} (Item: ${code})`;

                                // Ajuste para búsqueda LIKE
                                let searchPattern = reqTypeToFulfill;

                                // Normalización de Plurales/Sinónimos para coincidir con ConfigRequisitos
                                if (searchPattern === 'PRENDAS') searchPattern = 'PRENDA';
                                if (searchPattern === 'CORTES') searchPattern = 'CORTES';
                                if (searchPattern === 'DTF') searchPattern = 'DISENO'; // Si definimos que DTF satisface REQ-DISENO
                                // [PRENDAS] TPU también estampa un transfer, igual que DTF — sin esto,
                                // un TPU llegando a Estampado nunca cumple el requisito "DTF a Estampar"
                                // (CodigoRequisito='DTF', matcheado vía DISENO) y la orden queda
                                // bloqueada para siempre aunque el transfer ya esté físicamente ahí.
                                if (searchPattern === 'TPU') searchPattern = 'DISENO';

                                // Query de cumplimiento
                                await new sql.Request(transaction)
                                    .input('OID', sql.Int, OrdenID)
                                    .input('Type', sql.VarChar(50), `%${searchPattern}%`)
                                    .input('Area', sql.VarChar(50), areaReceptora)
                                    .input('Doc', sql.VarChar, bultoInfo.NoDocERP || NoDocERP || '')
                                    .input('Obs', sql.NVarChar(200), obsAuto)
                                    .query(`
                                        MERGE OrdenCumplimientoRequisitos AS target
                                        USING (
                                            SELECT DISTINCT req.RequisitoID, req.AreaID, dest.OrdenID
                                            FROM ConfigRequisitosProduccion req
                                            CROSS JOIN (
                                                SELECT OrdenID FROM Ordenes 
                                                WHERE 
                                                   (
                                                       (@Doc != '' AND NoDocERP = @Doc)
                                                       OR 
                                                       (@Doc = '' AND NoDocERP = (SELECT TOP 1 NoDocERP FROM Ordenes WHERE OrdenID = @OID))
                                                       OR
                                                       (@Doc = '' AND OrdenID = @OID)
                                                   )
                                                   AND AreaID = @Area 
                                                   AND Estado != 'CANCELADO'
                                            ) dest
                                            WHERE (
                                                req.CodigoRequisito LIKE @Type
                                                OR (@Type LIKE '%DISENO%' AND req.CodigoRequisito LIKE '%DTF%')
                                                OR (@Type LIKE '%DTF%' AND req.CodigoRequisito LIKE '%DISENO%')
                                            )
                                            AND req.AreaID = @Area
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
                            logger.info("Creating NEW Bobina:", newLabel, "for Ref:", code, "Client:", Cliente, "Mts:", mts);

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
                            logger.info("Check-In Non-Coil Item (Product):", code);

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
                                logger.info("Renaming Legacy Bobina:", existing.CodigoEtiqueta, "->", targetCode);
                            }

                            logger.info("Updating Bobina:", targetCode, "Client:", Cliente);

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

            // [PRENDAS] Cerrar en su área de ORIGEN cada orden cuyo bulto se acaba de recibir en una
            // área intermedia (no Depósito, que tiene su propio flujo de 'Ingresado' + contabilidad
            // más abajo). Sin esto, la orden queda 'En transito' para siempre y la Hoja de Ruta la
            // muestra como "en producción" aunque ya se haya entregado del todo en esa área. Guard
            // "EstadoenArea = 'En transito'": si por lo que sea la orden no estaba en ese estado
            // (ej. re-escaneo, o el bulto no vino de un despacho normal), no se toca nada.
            for (const oid of recibidasIntermedias) {
                await changeOrderState(transaction, {
                    target : { type: 'ORDER', id: oid },
                    estado : 'Recibido en Destino',
                    userObj: req.user || req.body.usuario || usuarioId || 'Sistema',
                    detalle: `Bulto recibido en ${areaReceptora}`,
                    guard  : "EstadoenArea = 'En transito'",
                    io     : req.app.get('socketio'),
                });
            }

            // Check if full reception (solo si hay remito; el forzar-puro desde la bandeja no trae envioId)
            let newStatus = 'RECIBIDO_TOTAL';
            if (envioId) {
                const check = await new sql.Request(transaction).input('EID', sql.Int, envioId)
                    .query("SELECT COUNT(*) as Total, SUM(CASE WHEN EstadoRecepcion != 'PENDIENTE' THEN 1 ELSE 0 END) as Processed FROM Logistica_EnvioItems WHERE EnvioID = @EID");

                const { Total, Processed } = check.recordset[0];
                newStatus = (Processed >= Total) ? 'RECIBIDO_TOTAL' : 'RECIBIDO_PARCIAL';

                await new sql.Request(transaction)
                    .input('Est', sql.VarChar, newStatus)
                    .input('UID', sql.Int, usuarioId)
                    .input('EID', sql.Int, envioId)
                    .query(`UPDATE Logistica_Envios SET Estado = @Est, UsuarioReceptor = @UID, FechaLlegada = GETDATE() WHERE EnvioID = @EID`);
            }

            // --- REWORK "ESPERAR TODOS LOS BULTOS": gate por PEDIDO (NoDocERP) ---
            // El pedido completo (todas sus órdenes hermanas no canceladas) debe tener TODOS sus
            // bultos PROD_TERMINADO "vivos" en el depósito para ingresar/contabilizar/avisar.
            // "Vivos" = Estado <> 'PROCESADO': excluye los bultos que la orden dejó en áreas
            // intermedias al transformarse (auto-consume) — no se espera nada de áreas anteriores.
            // Hasta completarse, las órdenes quedan en estado 13. Forzar una orden fuerza el pedido.
            // Cuando el pedido completa, se procesan TODAS las hermanas (también las recibidas antes).
            const forzarSet = new Set((forzarOrdenes || []).map(Number).filter(n => !isNaN(n)));
            // Forzar-puro: las órdenes forzadas se procesan aunque no vinieran bultos nuevos en esta llamada
            if (areaReceptora === 'DEPOSITO') for (const oid of forzarSet) receivedOrdersSet.add(oid);
            const ordenBultos = {};          // OrdenID -> { esperados, recibidos, lista } (números del PEDIDO)
            const expandidas = new Set();    // hermanas sumadas al completarse el pedido (no escaneadas ahora)
            let ordenesProcesar = [...receivedOrdersSet];
            if (areaReceptora === 'DEPOSITO' && receivedOrdersSet.size > 0) {
                const procesarSet = new Set([...receivedOrdersSet].map(Number).filter(n => !isNaN(n)));
                const idsIn = [...procesarSet].join(',');

                // Pedido (NoDocERP) de cada orden tocada
                const ordenPedido = {};
                if (idsIn.length > 0) {
                    const pedRes = await new sql.Request(transaction).query(`
                        SELECT OrdenID, LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) AS NoDoc
                        FROM Ordenes WHERE OrdenID IN (${idsIn})
                    `);
                    for (const r of pedRes.recordset) ordenPedido[r.OrdenID] = (r.NoDoc && r.NoDoc.length) ? r.NoDoc : null;
                }

                // Gate por pedido: contar bultos vivos de TODAS las hermanas
                const pedidos = [...new Set(Object.values(ordenPedido).filter(Boolean))];
                for (const noDoc of pedidos) {
                    const cnt = await new sql.Request(transaction)
                        .input('NoDoc', sql.VarChar, noDoc)
                        .query(`
                            SELECT o.OrdenID,
                                   COUNT(b.BultoID) AS Esperados,
                                   ISNULL(SUM(CASE WHEN b.Estado='EN_STOCK' AND b.UbicacionActual='DEPOSITO' THEN 1 ELSE 0 END), 0) AS Recibidos
                            FROM Ordenes o
                            LEFT JOIN Logistica_Bultos b ON b.OrdenID = o.OrdenID
                                 AND b.Tipocontenido = 'PROD_TERMINADO'
                                 AND b.Estado <> 'PROCESADO'
                            WHERE LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) = @NoDoc
                              AND (o.Estado IS NULL OR UPPER(LTRIM(RTRIM(o.Estado))) <> 'CANCELADO')
                            GROUP BY o.OrdenID
                        `);
                    const espPed = cnt.recordset.reduce((a, r) => a + (r.Esperados || 0), 0);
                    const recPed = cnt.recordset.reduce((a, r) => a + (r.Recibidos || 0), 0);
                    const forzado = cnt.recordset.some(r => forzarSet.has(Number(r.OrdenID)));
                    const completoFisico = espPed > 0 && recPed >= espPed;
                    // espPed === 0: sin bultos de producto terminado que esperar (ej. recepción de insumos) → no se gatea
                    const lista = forzado || completoFisico || espPed === 0;
                    for (const r of cnt.recordset) {
                        const roid = Number(r.OrdenID);
                        ordenBultos[roid] = { esperados: espPed, recibidos: recPed, lista };
                        if ((forzado || completoFisico) && !procesarSet.has(roid)) {
                            procesarSet.add(roid);
                            expandidas.add(roid);   // hermana recibida antes: ahora se ingresa junto al pedido
                        }
                    }
                }

                // Órdenes sin pedido (NoDocERP NULL): gate por la propia orden
                for (const oid of [...procesarSet]) {
                    if (ordenPedido[oid] || ordenBultos[oid]) continue;
                    const cntB = await new sql.Request(transaction)
                        .input('OID', sql.Int, oid)
                        .query(`
                            SELECT COUNT(*) AS Esperados,
                                   ISNULL(SUM(CASE WHEN Estado='EN_STOCK' AND UbicacionActual='DEPOSITO' THEN 1 ELSE 0 END), 0) AS Recibidos
                            FROM Logistica_Bultos
                            WHERE OrdenID=@OID AND Tipocontenido='PROD_TERMINADO' AND Estado <> 'PROCESADO'
                        `);
                    const esperados = cntB.recordset[0].Esperados || 0;
                    const recibidos = cntB.recordset[0].Recibidos || 0;
                    const lista = forzarSet.has(Number(oid)) || esperados === 0 || recibidos >= esperados;
                    ordenBultos[oid] = { esperados, recibidos, lista };
                }

                ordenesProcesar = [...procesarSet];
            }

            // ==========================================
            // LOGICA CONTABLE WMS (PUNTO DE CHECKING)
            // ==========================================
            if (areaReceptora === 'DEPOSITO') {
                try {
                    const poolLocal = await getPool(); // Fuera de la transaccion WMS
                    // Órdenes a procesar: escaneadas + forzadas + hermanas del pedido cuando el pedido
                    // quedó completo (se ingresan/contabilizan todas juntas, una sola vez por orden).
                    const ordenesAContab = [...new Set(ordenesProcesar.map(Number))].filter(n => !isNaN(n));

                    for (const L_OrdenID of ordenesAContab) {
                        // --- GATE ESPERAR BULTOS: si la orden aún no tiene todos sus bultos, no contabilizar ---
                        if (ordenBultos[L_OrdenID] && !ordenBultos[L_OrdenID].lista) continue;
                        
                        const oData = await poolLocal.request().input('OID', require('mssql').Int, L_OrdenID).query("SELECT Cliente, CodCliente, CliIdCliente, CodigoOrden, DescripcionTrabajo, ProIdProducto, AreaID, TRY_CAST(Magnitud AS FLOAT) AS Magnitud FROM Ordenes WITH(NOLOCK) WHERE OrdenID = @OID");
                        if (oData.recordset.length === 0) continue;
                        const oRow = oData.recordset[0];
                        const logPrefix = `[CONTABILIDAD-WMS] [${oRow.CodigoOrden}] ${oRow.DescripcionTrabajo.substring(0,30)}`;

                        // 2. Buscar en PedidosCobranza
                        const pcReq = await poolLocal.request().input('OID', require('mssql').Int, L_OrdenID)
                            .query("SELECT ID, MontoTotal, NoDocERP, MontoContabilizado, MetrosContabilizados, Moneda FROM PedidosCobranza WITH(NOLOCK) WHERE NoDocERP = (SELECT TOP 1 LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR))) FROM Ordenes WITH(NOLOCK) WHERE OrdenID = @OID)");

                        console.log(`${logPrefix} -> Encontrado PedidoCobranza =`, pcReq.recordset.length > 0);
if (pcReq.recordset.length > 0) {
                            const pc = pcReq.recordset[0];
                            const currentMonto = parseFloat(pc.MontoTotal) || 0;
                            const mContado = parseFloat(pc.MontoContabilizado) || 0;
                            const metContado = parseFloat(pc.MetrosContabilizados) || 0;

                            const detReq = await poolLocal.request().input('PID', require('mssql').Int, pc.ID)
                                .query("SELECT SUM(CASE WHEN Cantidad IS NULL THEN 0 ELSE Cantidad END) as Metros FROM PedidosCobranzaDetalle WITH(NOLOCK) WHERE PedidoCobranzaID = @PID");
                            const totalMetros = detReq.recordset.length > 0 ? (parseFloat(detReq.recordset[0].Metros) || 0) : 0;

                            let triggerReversal = false;
                            let triggerForward = false;

                            if (mContado === 0) {
                                // Nuevo
                                if (currentMonto > 0 || totalMetros > 0) triggerForward = true;
                            } else {
                                if (mContado !== currentMonto || metContado !== totalMetros) {
                                    triggerReversal = true;
                                    triggerForward = true;
                                }
                            }

                            console.log(`${logPrefix} -> Reversa=${triggerReversal}, Adelante=${triggerForward}, totalMetros=${totalMetros}, currentMonto=${currentMonto}, mContado=${mContado}, metContado=${metContado}`);
if (triggerReversal || triggerForward) {
                                // oData is fetched above
                                    const finalMonId = (pc.Moneda === 'USD') ? 2 : 1; 

                                    // Para la REVERSA vamos a simular el mismo cargo pero NEGATIVO
                                    if (triggerReversal && mContado !== 0) {
                                        console.log(`${logPrefix} -> Reversando orden por diferencia`); // por diferencia en Checking.`);
                                        const cliPKRev = oRow.CliIdCliente || oRow.CodCliente;
                                          let revEvento = 'ORDEN';
                                          const prevPl = await poolLocal.request().input('Cli', require('mssql').Int, cliPKRev).query("SELECT TOP 1 PlaIdPlan FROM PlanesMetros WITH(NOLOCK) WHERE CliIdCliente = @Cli");
                                          if(prevPl.recordset.length > 0) revEvento = 'ENTREGA';

                                          await contabilidadService.procesarEventoContable(revEvento, {
                                              OrdIdOrden: L_OrdenID,
                                              CliIdCliente: cliPKRev,
                                              Cantidad: -metContado,
                                              Importe: -mContado,
                                              CodigoOrden: oRow.CodigoOrden,
                                              NombreTrabajo: `[REVERSA AUT.] ${oRow.DescripcionTrabajo}`,
                                              UsuarioAlta: usuarioId || 1,
                                              MonIdMoneda: finalMonId
                                          });
                                    }

                                    // Adicion Nueva
                                     if (triggerForward && (currentMonto !== 0 || totalMetros > 0)) {
                                         console.log(`${logPrefix} -> Generando nuevo cargo`); // por ${currentMonto}`);
                                         const cRes = await poolLocal.request().query("SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC");
                                         const cotizacionVal = cRes.recordset[0]?.CotDolar || 40;

                                         const details = await poolLocal.request().input('PID', require('mssql').Int, pc.ID).query("SELECT Cantidad, Subtotal as TotalLinea, ProIdProducto as IDProdReact, Moneda, OrdenID FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID");
                                           
                                           // --- EN ESTE PUNTO LA ORDEN YA LLAMÓ AL CHECKIN WMS, INSERTAMOS EN ORDENESDEPOSITO SI FALTA ---
                                           // Las fallas (-F) son internas: su material se incorpora a la madre,
                                           // no deben crear registro propio en OrdenesDeposito (sino el job WSP las avisaría).
                                           const esFallaInterna = (oRow.CodigoOrden || '').includes('-F');
                                           // Las hermanas de terminaciones (XEUV, área TERMINAC) son igual de internas:
                                           // contienen el TRABAJO de terminación, no un producto aparte. Lo que el
                                           // cliente retira es la orden madre (EUV) con su cantidad e importe. Si
                                           // entraran a OrdenesDeposito, el retiro mostraría una línea fantasma
                                           // (cant 1, costo 0) y el job de WhatsApp avisaría el pedido dos veces.
                                           const esHermanaTerminac = (oRow.AreaID || '').trim().toUpperCase() === 'TERMINAC';
                                           // [PRENDAS] Bordado/DTF/TPU/Estampado/Corte/Costura de una prenda comprada
                                           // + personalizada: la que factura y avisa es SIEMPRE la orden madre PRO,
                                           // nunca la hermana — mismo trato que TERMINAC arriba, pero acá SE
                                           // REDIRIGE a la madre en vez de no crear nada: con varias hermanas
                                           // convergiendo en Depósito por separado (ej. Estampado partido en 1/2 y
                                           // 2/2), si la que llega de última fuera simplemente excluida, el pedido
                                           // se quedaba sin ningún registro — sin cobrar ni avisar por WhatsApp.
                                           const ordenDeposito = (esFallaInterna || esHermanaTerminac)
                                               ? null
                                               : await resolverOrdenParaDeposito(poolLocal, L_OrdenID, oRow.CodigoOrden);

                                           if (ordenDeposito) {
                                               const depCheck = await poolLocal.request().input('Cod', require('mssql').VarChar, ordenDeposito.codigoOrden)
                                                   .query("SELECT OrdIdOrden FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdCodigoOrden = @Cod");

                                               if (depCheck.recordset.length === 0 && details.recordset.length > 0) {
                                               // Línea de cobranza de ESTA orden (o de la madre, si se redirigió) — no
                                               // del pedido completo: cada orden hermana entra con su propio
                                               // importe/cantidad/producto para no duplicar el total en el retiro.
                                               // Fallback al comportamiento previo si el detalle no tuviera la orden desglosada.
                                               // Reposiciones cliente (-R): NUNCA tienen línea propia en PedidosCobranzaDetalle y el
                                               // fallback a la 1ª línea del pedido les copiaba el costo de la MADRE (el retiro les
                                               // mostraba importe). Son re-trabajo sin cargo: siempre costo 0 y su propia cantidad.
                                               const esRepoCliente = /-R\d+$/i.test(oRow.CodigoOrden || '');
                                               const dOrden = esRepoCliente ? null : (details.recordset.find(d => Number(d.OrdenID) === Number(ordenDeposito.ordenId)) || details.recordset[0]);
                                               const cantOrden  = (dOrden && dOrden.Cantidad   != null) ? parseFloat(dOrden.Cantidad)   : (parseFloat(ordenDeposito.magnitud ?? oRow.Magnitud) || totalMetros || 0);
                                               const costoOrden = esRepoCliente ? 0 : ((dOrden && dOrden.TotalLinea != null) ? parseFloat(dOrden.TotalLinea) : currentMonto);
                                               const prodOrden  = (dOrden && dOrden.IDProdReact)        ? dOrden.IDProdReact           : (ordenDeposito.proIdProducto ?? oRow.ProIdProducto ?? null);
                                               const cliPKForDep = ordenDeposito.cliIdCliente || ordenDeposito.codCliente || oRow.CliIdCliente || oRow.CodCliente;
                                               const lugarReq = await poolLocal.request().input('CID', require('mssql').Int, cliPKForDep).query("SELECT FormaEnvioID FROM Clientes WITH(NOLOCK) WHERE CliIdCliente = @CID");
                                               const lugarRetiro = lugarReq.recordset[0]?.FormaEnvioID ? parseInt(lugarReq.recordset[0].FormaEnvioID) : null;

                                               const insertResult = await poolLocal.request()
                                                   .input('Cod', require('mssql').VarChar, ordenDeposito.codigoOrden)
                                                   .input('Cant', require('mssql').Float, cantOrden)
                                                   .input('Cli', require('mssql').Int, cliPKForDep)
                                                   .input('Trab', require('mssql').VarChar, ordenDeposito.descripcionTrabajo || oRow.DescripcionTrabajo)
                                                   .input('Prod', require('mssql').Int, prodOrden)
                                                   .input('Mon', require('mssql').Int, finalMonId)
                                                   .input('Costo', require('mssql').Float, costoOrden)
                                                   .input('Usr', require('mssql').Int, usuarioId || 1)
                                                   .input('Lugar', require('mssql').Int, lugarRetiro)
                                                   .query(`
                                                       INSERT INTO OrdenesDeposito (
                                                           OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo,
                                                           MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal,
                                                           OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual, LReIdLugarRetiro
                                                       )
                                                       OUTPUT INSERTED.OrdIdOrden
                                                       VALUES (
                                                           @Cod, @Cant, @Cli, @Trab, 1, @Prod, @Mon, @Costo,
                                                           GETDATE(), @Usr, 1, GETDATE(), @Lugar
                                                       )
                                                   `);
                                               if (insertResult.recordset[0]?.OrdIdOrden) {
                                                   await poolLocal.request()
                                                       .input('OID', require('mssql').Int, insertResult.recordset[0].OrdIdOrden)
                                                       .input('Usr', require('mssql').Int, usuarioId || 1)
                                                       .query("INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@OID, 1, GETDATE(), @Usr)");
                                               }
                                               console.log(`[WMS-INTERNAL] Creado OrdenesDeposito para ${ordenDeposito.codigoOrden}${ordenDeposito.codigoOrden !== oRow.CodigoOrden ? ` (redirigido desde hermana ${oRow.CodigoOrden})` : ''}`);
                                               }
                                           }
                                           // ------------------------------------------------------------------------------------------------
                                         
                                           // Líneas de cobranza de ESTA orden, no del pedido completo: en un pedido
                                           // multitela hay 1 línea por tela y N órdenes hermanas; recorrer todas las
                                           // líneas para cada hermana descontaba los metros de cada plan N veces
                                           // (y sumaba el importe del pedido entero en cada orden).
                                           // Fallback al comportamiento previo SOLO si ninguna línea trae OrdenID
                                           // (pedidos legacy sin desglose): ahí el pedido es de una sola orden.
                                           const lineasPedido = details.recordset;
                                           const lineasOrden  = lineasPedido.filter(d => Number(d.OrdenID) === Number(L_OrdenID));
                                           const lineasContab = lineasOrden.length > 0
                                               ? lineasOrden
                                               : (lineasPedido.some(d => d.OrdenID != null) ? [] : lineasPedido);
                                           console.log(`${logPrefix} -> Líneas a contabilizar: ${lineasContab.length} de ${lineasPedido.length} del pedido`);

                                           let importeTotalOrden = 0;
                                           for (const d of lineasContab) {
                                               const lineQty = parseFloat(d.Cantidad) || 0;
                                               const lineMon = (d.Moneda || pc.Moneda || 'UYU').trim().toUpperCase();
                                               const docMon = (pc.Moneda || 'UYU').trim().toUpperCase();
                                               let lineImp = parseFloat(d.TotalLinea) || 0;

                                               if (lineMon !== docMon) {
                                                   if (lineMon === 'UYU' && docMon === 'USD') {
                                                       lineImp = parseFloat((lineImp / cotizacionVal).toFixed(2));
                                                   } else if (lineMon === 'USD' && docMon === 'UYU') {
                                                       lineImp = parseFloat((lineImp * cotizacionVal).toFixed(2));
                                                   }
                                               }

                                              // Detectar si el cliente tiene un plan activo y cuántos metros disponibles
                                              const cliPK = oRow.CliIdCliente || oRow.CodCliente;
                                              let planMetrosDisp = 0;
                                              let planIdCtb = null;
                                              if (d.IDProdReact) {
                                                  const planQueryCtb = await poolLocal.request()
                                                      .input('Cli', require('mssql').Int, cliPK)
                                                      .input('Pro', require('mssql').Int, d.IDProdReact)
                                                      .query(`SELECT TOP 1 pm.PlaIdPlan,
                                                                   ISNULL(pm.PlaCantidadTotal, 0) - ISNULL(pm.PlaCantidadUsada, 0) AS MetrosDisponibles
                                                               FROM dbo.PlanesMetros pm WITH(NOLOCK)
                                                               WHERE pm.CliIdCliente = @Cli 
                                                                 AND pm.PlaActivo = 1
                                                                 AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                                                                 AND (
                                                                   pm.ProIdProducto = @Pro
                                                                   OR EXISTS (
                                                                     SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                                                                     WHERE pap.PlaIdPlan = pm.PlaIdPlan
                                                                       AND pap.ProIdProducto = @Pro
                                                                   )
                                                                 )
                                                               ORDER BY pm.PlaFechaVencimiento ASC`);
                                                  if (planQueryCtb.recordset.length > 0) {
                                                      planMetrosDisp = parseFloat(planQueryCtb.recordset[0].MetrosDisponibles) || 0;
                                                      planIdCtb = planQueryCtb.recordset[0].PlaIdPlan;
                                                  }
                                              }

                                              const hayPlanCtb = planIdCtb !== null && planMetrosDisp > 0;

                                              if (hayPlanCtb && lineQty <= planMetrosDisp) {
                                                  // CASO A: Plan cubre todo — 1 evento ENTREGA a $0
                                                  console.log(`${logPrefix} -> ENTREGA TOTAL por prepago (${lineQty}m, $0, Plan #${planIdCtb})`);
                                                  await contabilidadService.procesarEventoContable('ENTREGA', {
                                                      OrdIdOrden: L_OrdenID,
                                                      CliIdCliente: cliPK,
                                                      ProIdProducto: d.IDProdReact || null,
                                                      Cantidad: lineQty,
                                                      Importe: 0,
                                                      CodigoOrden: oRow.CodigoOrden,
                                                      NombreTrabajo: oRow.DescripcionTrabajo,
                                                      UsuarioAlta: usuarioId || 1,
                                                      MonIdMoneda: finalMonId
                                                  });

                                              } else if (hayPlanCtb && planMetrosDisp > 0 && lineQty > planMetrosDisp) {
                                                  // CASO B: Plan cubre PARCIALMENTE — 2 eventos
                                                  const metrosRestCtb = lineQty - planMetrosDisp;
                                                  const proporcionCtb = lineQty > 0 ? metrosRestCtb / lineQty : 1;
                                                  const importeExcedente = parseFloat((lineImp * proporcionCtb).toFixed(2));

                                                  console.log(`${logPrefix} -> ENTREGA PARCIAL por prepago: ${planMetrosDisp}m a $0 + ${metrosRestCtb}m a $${importeExcedente} (Plan #${planIdCtb})`);

                                                  // Evento 1: ENTREGA por los metros cubiertos
                                                  await contabilidadService.procesarEventoContable('ENTREGA', {
                                                      OrdIdOrden: L_OrdenID,
                                                      CliIdCliente: cliPK,
                                                      ProIdProducto: d.IDProdReact || null,
                                                      Cantidad: planMetrosDisp,
                                                      Importe: 0,
                                                      CodigoOrden: oRow.CodigoOrden,
                                                      NombreTrabajo: `[PREPAGO] ${oRow.DescripcionTrabajo}`,
                                                      UsuarioAlta: usuarioId || 1,
                                                      MonIdMoneda: finalMonId
                                                  });

                                                  // Evento 2: ORDEN por el excedente (Agrupado)
                                                  if (importeExcedente > 0 || metrosRestCtb > 0) {
                                                      importeTotalOrden += importeExcedente;
                                                  }

                                              } else if (lineImp > 0) {
                                                  // CASO C: Sin plan — evento ORDEN normal (Agrupado)
                                                  importeTotalOrden += lineImp;
                                              }
                                          }

                                          // Llamada única al motor contable por el TOTAL agrupado de la orden
                                          if (importeTotalOrden > 0) {
                                              const cliPK = oRow.CliIdCliente || oRow.CodCliente;
                                              console.log(`${logPrefix} -> ORDEN agrupada sin prepago ($${importeTotalOrden})`);
                                              await contabilidadService.procesarEventoContable('ORDEN', {
                                                  OrdIdOrden: L_OrdenID,
                                                  CliIdCliente: cliPK,
                                                  ProIdProducto: null,
                                                  Cantidad: 1,
                                                  CodigoOrden: oRow.CodigoOrden,
                                                  NombreTrabajo: oRow.DescripcionTrabajo,
                                                  UsuarioAlta: usuarioId || 1,
                                                  Importe: importeTotalOrden,
                                                  MonIdMoneda: finalMonId
                                              });
                                          }


                                        // Update PedidosCobranza Marca
                                        await poolLocal.request()
                                            .input('M', require('mssql').Decimal(18,2), currentMonto)
                                            .input('Met', require('mssql').Decimal(18,2), totalMetros)
                                            .input('PID', require('mssql').Int, pc.ID)
                                            .query("UPDATE PedidosCobranza SET MontoContabilizado = @M, MetrosContabilizados = @Met WHERE ID = @PID");
                                    }
                                     }  // fin if (triggerReversal || triggerForward)
                                 }  // fin if (pcReq)

                                 // Fallback: órdenes de reposición (-R1, -R2...) u órdenes sin PedidosCobranza
                                 // no entran al bloque contable, pero igual deben insertarse en OrdenesDeposito
                                 // para que el aviso funcione.
                                 try {
                                     // Las fallas (-F) son internas: tampoco deben crear registro por el fallback
                                     const esFallaFb = (oRow.CodigoOrden || '').includes('-F');
                                     // Ídem hermanas de terminaciones (XEUV): no tienen línea propia de
                                     // cobranza — justamente por eso caen SIEMPRE en este fallback — y
                                     // entrarían al depósito como una orden fantasma de costo 0.
                                     const esTerminacFb = (oRow.AreaID || '').trim().toUpperCase() === 'TERMINAC';
                                     // [PRENDAS] Hermana de una prenda comprada+personalizada: redirigir a la
                                     // madre PRO en vez de simplemente omitir (ver resolverOrdenParaDeposito).
                                     const ordenDepositoFb = (esFallaFb || esTerminacFb)
                                         ? null
                                         : await resolverOrdenParaDeposito(poolLocal, L_OrdenID, oRow.CodigoOrden);

                                     if (ordenDepositoFb) {
                                         const fallbackCheck = await poolLocal.request()
                                             .input('Cod', require('mssql').VarChar, ordenDepositoFb.codigoOrden)
                                             .query("SELECT OrdIdOrden FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdCodigoOrden = @Cod");

                                         if (fallbackCheck.recordset.length === 0) {
                                         const cliPKFb = ordenDepositoFb.cliIdCliente || ordenDepositoFb.codCliente || oRow.CliIdCliente || oRow.CodCliente;
                                         const lugarFbReq = await poolLocal.request()
                                             .input('CID', require('mssql').Int, cliPKFb)
                                             .query("SELECT FormaEnvioID FROM Clientes WITH(NOLOCK) WHERE CliIdCliente = @CID");
                                         const lugarFb = lugarFbReq.recordset[0]?.FormaEnvioID ? parseInt(lugarFbReq.recordset[0].FormaEnvioID) : null;

                                         // Importe/cantidad/producto de la línea de ESTA orden (o de la madre, si
                                         // se redirigió) — no 0 fijo: cubre hermanas cuyo pedido ya quedó
                                         // contabilizado (marca) en esta misma pasada.
                                         const linFb = await poolLocal.request()
                                             .input('OID', require('mssql').Int, ordenDepositoFb.ordenId)
                                             .query(`SELECT SUM(Cantidad) AS Cant, SUM(Subtotal) AS Imp, MIN(ProIdProducto) AS Prod
                                                     FROM PedidosCobranzaDetalle WITH(NOLOCK) WHERE OrdenID=@OID`);
                                         const fbCant  = parseFloat(linFb.recordset[0]?.Cant) || ordenDepositoFb.magnitud || oRow.Magnitud || 0;
                                         const fbCosto = parseFloat(linFb.recordset[0]?.Imp) || 0;
                                         const fbProd  = linFb.recordset[0]?.Prod || ordenDepositoFb.proIdProducto || oRow.ProIdProducto || null;
                                         const fbMon   = (pcReq.recordset[0]?.Moneda === 'USD') ? 2 : 1;

                                         const fbInsert = await poolLocal.request()
                                             .input('Cod', require('mssql').VarChar, ordenDepositoFb.codigoOrden)
                                             .input('Cli', require('mssql').Int, cliPKFb)
                                             .input('Trab', require('mssql').VarChar, ordenDepositoFb.descripcionTrabajo || oRow.DescripcionTrabajo)
                                             .input('Prod', require('mssql').Int, fbProd)
                                             .input('Cant', require('mssql').Float, fbCant)
                                             .input('Mon', require('mssql').Int, fbMon)
                                             .input('Costo', require('mssql').Float, fbCosto)
                                             .input('Usr', require('mssql').Int, usuarioId || 1)
                                             .input('Lugar', require('mssql').Int, lugarFb)
                                             .query(`
                                                 INSERT INTO OrdenesDeposito (
                                                     OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo,
                                                     MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal,
                                                     OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual, LReIdLugarRetiro
                                                 )
                                                 OUTPUT INSERTED.OrdIdOrden
                                                 VALUES (
                                                     @Cod, @Cant, @Cli, @Trab, 1, @Prod, @Mon, @Costo,
                                                     GETDATE(), @Usr, 1, GETDATE(), @Lugar
                                                 )
                                             `);
                                         if (fbInsert.recordset[0]?.OrdIdOrden) {
                                             await poolLocal.request()
                                                 .input('OID', require('mssql').Int, fbInsert.recordset[0].OrdIdOrden)
                                                 .input('Usr', require('mssql').Int, usuarioId || 1)
                                                 .query("INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@OID, 1, GETDATE(), @Usr)");
                                             console.log(`[WMS-FALLBACK] Creado OrdenesDeposito para repo/sin-PC: ${ordenDepositoFb.codigoOrden}${ordenDepositoFb.codigoOrden !== oRow.CodigoOrden ? ` (redirigido desde hermana ${oRow.CodigoOrden})` : ''}`);
                                         }
                                         }
                                     }
                                 } catch (eFb) {
                                     console.error(`[WMS-FALLBACK] Error insertando OrdenesDeposito fallback para ${oRow.CodigoOrden}:`, eFb.message);
                                 }
                             }  // fin for items
                } catch (eCont) {
                    console.error("[CONTABILIDAD-WMS] Error al procesar evento en DEPOSITO:", eCont);
                    throw eCont;
                }

                // --- REWORK: escribir contadores (números del PEDIDO) y estado 13 (Esperando) o 1 (Ingresado).
                // Si la fila no existe y el pedido está incompleto (flujo manual, sin createOrden),
                // se CREA en estado 13 con el importe/cantidad/producto de la línea de la orden,
                // para que quede visible en la bandeja "Esperando Bultos". ---
                try {
                    const poolCnt = await getPool();
                    for (const oid of ordenesProcesar) {
                        const bInfo = ordenBultos[oid];
                        if (!bInfo) continue;

                        const oInf = await poolCnt.request()
                            .input('OID', require('mssql').Int, oid)
                            .query(`SELECT CodigoOrden, CliIdCliente, CodCliente, DescripcionTrabajo, ProIdProducto,
                                           TRY_CAST(Magnitud AS FLOAT) AS Magnitud,
                                           LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) AS NoDoc
                                    FROM Ordenes WITH(NOLOCK) WHERE OrdenID=@OID`);
                        const oi = oInf.recordset[0];
                        // Las fallas (-F) son internas: no gestionan fila propia en depósito.
                        // [PRENDAS] Hermana de una prenda comprada+personalizada: los contadores
                        // (Esperados/Recibidos, YA calculados a nivel PEDIDO más arriba) se
                        // actualizan sobre la fila de la madre PRO, no sobre una fila propia de
                        // la hermana (que nunca existe — ver resolverOrdenParaDeposito).
                        const esFallaUp = (oi?.CodigoOrden || '').includes('-F');
                        const ordenDepositoUp = (oi && !esFallaUp)
                            ? await resolverOrdenParaDeposito(poolCnt, oid, oi.CodigoOrden)
                            : null;
                        if (!ordenDepositoUp) continue;

                        const upd = await poolCnt.request()
                            .input('Cod', require('mssql').VarChar, ordenDepositoUp.codigoOrden)
                            .input('Esp', require('mssql').Int, bInfo.esperados)
                            .input('Rec', require('mssql').Int, bInfo.recibidos)
                            .input('Est', require('mssql').Int, bInfo.lista ? 1 : 13)
                            .query(`
                                UPDATE OrdenesDeposito
                                SET BultosEsperados=@Esp, BultosRecibidos=@Rec,
                                    OrdEstadoActual=@Est, OrdFechaEstadoActual=GETDATE()
                                WHERE OrdCodigoOrden = @Cod
                                  -- Solo gestiona órdenes recién entrando (1) o esperando (13).
                                  -- No toca las ya avisadas/en retiro/entregadas/canceladas/perdidas.
                                  AND OrdEstadoActual NOT IN (6,7,9,10,11,12)
                            `);

                        // UPSERT: sin fila y pedido incompleto → crearla en estado 13 (visibilidad en bandeja)
                        if (!bInfo.lista && (upd.rowsAffected?.[0] || 0) === 0) {
                                const existe = await poolCnt.request()
                                    .input('Cod', require('mssql').VarChar, ordenDepositoUp.codigoOrden)
                                    .query(`SELECT TOP 1 OrdIdOrden FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdCodigoOrden = @Cod`);
                                if (existe.recordset.length === 0) {
                                    const lin = await poolCnt.request()
                                        .input('OID', require('mssql').Int, ordenDepositoUp.ordenId)
                                        .query(`SELECT SUM(Cantidad) AS Cant, SUM(Subtotal) AS Imp, MIN(ProIdProducto) AS Prod
                                                FROM PedidosCobranzaDetalle WITH(NOLOCK) WHERE OrdenID=@OID`);
                                    const monR = await poolCnt.request()
                                        .input('ND', require('mssql').VarChar, oi.NoDoc || '')
                                        .query(`SELECT TOP 1 Moneda FROM PedidosCobranza WITH(NOLOCK) WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) = @ND`);
                                    const cliPkUp = ordenDepositoUp.cliIdCliente || ordenDepositoUp.codCliente || oi.CliIdCliente || oi.CodCliente;
                                    const lugR = await poolCnt.request()
                                        .input('CID', require('mssql').Int, cliPkUp)
                                        .query("SELECT FormaEnvioID FROM Clientes WITH(NOLOCK) WHERE CliIdCliente=@CID");
                                    const insUp = await poolCnt.request()
                                        .input('Cod', require('mssql').VarChar, ordenDepositoUp.codigoOrden)
                                        .input('Cant', require('mssql').Float, parseFloat(lin.recordset[0]?.Cant) || ordenDepositoUp.magnitud || oi.Magnitud || 0)
                                        .input('Cli', require('mssql').Int, cliPkUp)
                                        .input('Trab', require('mssql').VarChar, ordenDepositoUp.descripcionTrabajo || oi.DescripcionTrabajo)
                                        .input('Prod', require('mssql').Int, lin.recordset[0]?.Prod || ordenDepositoUp.proIdProducto || oi.ProIdProducto || null)
                                        .input('Mon', require('mssql').Int, (monR.recordset[0]?.Moneda === 'USD') ? 2 : 1)
                                        .input('Costo', require('mssql').Float, parseFloat(lin.recordset[0]?.Imp) || 0)
                                        .input('Usr', require('mssql').Int, usuarioId || 1)
                                        .input('Lugar', require('mssql').Int, lugR.recordset[0]?.FormaEnvioID ? parseInt(lugR.recordset[0].FormaEnvioID) : null)
                                        .input('Esp', require('mssql').Int, bInfo.esperados)
                                        .input('Rec', require('mssql').Int, bInfo.recibidos)
                                        .query(`
                                            INSERT INTO OrdenesDeposito (
                                                OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo,
                                                MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal,
                                                OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual,
                                                LReIdLugarRetiro, BultosEsperados, BultosRecibidos
                                            )
                                            OUTPUT INSERTED.OrdIdOrden
                                            VALUES (@Cod, @Cant, @Cli, @Trab, 1, @Prod, @Mon, @Costo,
                                                    GETDATE(), @Usr, 13, GETDATE(), @Lugar, @Esp, @Rec)
                                        `);
                                    if (insUp.recordset[0]?.OrdIdOrden) {
                                        await poolCnt.request()
                                            .input('OID', require('mssql').Int, insUp.recordset[0].OrdIdOrden)
                                            .input('Usr', require('mssql').Int, usuarioId || 1)
                                            .query("INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@OID, 13, GETDATE(), @Usr)");
                                    }
                                    console.log(`[REWORK-BULTOS] Fila creada en Esperando (13) para ${ordenDepositoUp.codigoOrden}${ordenDepositoUp.codigoOrden !== oi.CodigoOrden ? ` (redirigido desde hermana ${oi.CodigoOrden})` : ''}`);
                                }
                        }
                    }
                } catch (eCnt) {
                    console.error("[REWORK-BULTOS] Error actualizando contadores/estado:", eCnt.message);
                }
            }
            for (const oid of ordenesProcesar) {
                if (ordenBultos[oid] && !ordenBultos[oid].lista) continue;  // pedido incompleto: no pasa a Ingresado hasta tener todos los bultos
                if (expandidas.has(Number(oid))) {
                    // Hermana sumada al completarse el pedido: no regredir si ya avanzó (avisada/retiro/entregada)
                    const chkE = await new sql.Request(transaction)
                        .input('OID', sql.Int, oid)
                        .query(`SELECT TOP 1 OrdEstadoActual FROM OrdenesDeposito WITH(NOLOCK)
                                WHERE OrdCodigoOrden = (SELECT TOP 1 CodigoOrden FROM Ordenes WITH(NOLOCK) WHERE OrdenID=@OID)
                                ORDER BY OrdIdOrden DESC`);
                    const estE = chkE.recordset[0]?.OrdEstadoActual;
                    if (estE && [6, 7, 9, 10, 11, 12].includes(Number(estE))) continue;
                }
                await changeOrderState(transaction, {
                    target   : { type: 'ORDER', id: oid },
                    estado   : 'Ingresado',
                    userObj  : req.user || req.body.usuario || usuarioId || 'Sistema',
                    detalle  : `Orden Ingresada (Recepción en ${areaReceptora})`,
                    io       : req.app.get('socketio')
                });
            }

            await transaction.commit();

            // [PRENDAS] FASE 6: el remito final PRO→DEPOSITO YA NO se arma solo acá al recibir
            // en PRO (eso vivía en la Fase 5 — se sacó por un bug real: "En Tránsito" contaba
            // como "pronto" en isPedidoCompletoGlobal, así que un componente que todavía viajaba
            // HACIA PRO ya se contaba como listo, y el sistema armaba remitos parciales de a
            // uno). Ahora es una acción manual desde la pantalla de Control de PRO — ver
            // getPedidosCompletosPRO / aprobarControlPRO más abajo, que usan
            // isPedidoCompletoFisicamenteEnArea (mira la UBICACIÓN real del bulto, no el estado
            // de la orden).
            res.json({ success: true, status: newStatus });

        }         catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error("Error receiveDispatch:", err);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
};

// [PRENDAS] FASE 6 — Control manual en PRO: en vez de armar el remito final PRO→DEPOSITO
// solo (Fase 5, sacado por el bug de "En Tránsito" ya visto arriba), el dueño revisa el
// pedido reunido en PRO y lo aprueba a mano. isPedidoCompletoFisicamenteEnArea (mira la
// UBICACIÓN real del bulto, no el estado de la orden) es la fuente de verdad de ambos
// endpoints — mismo criterio, sin duplicar lógica.
exports.getPedidosCompletosPRO = async (req, res) => {
    try {
        const pool = await getPool();
        const { isPedidoCompletoFisicamenteEnArea } = require('../services/pedidoCompletoService');

        // Candidatos: pedidos con orden madre PRO real que ya tienen algún componente
        // físicamente en PRO — evita recorrer TODA la tabla Ordenes.
        const candidatosRes = await pool.request().query(`
            SELECT DISTINCT LTRIM(RTRIM(O.NoDocERP)) AS NoDocERP
            FROM Ordenes O
            JOIN Logistica_Bultos B ON B.OrdenID = O.OrdenID
            WHERE O.AreaID <> 'PRO'
              AND B.UbicacionActual = 'PRO' AND B.Estado = 'EN_STOCK'
              AND ISNULL(B.Tipocontenido, '') <> 'ENCOMIENDA'
              AND EXISTS (
                  SELECT 1 FROM Ordenes P
                  WHERE P.NoDocERP = O.NoDocERP AND P.AreaID = 'PRO'
                    AND ISNULL(P.EstadoDependencia, '') <> 'VENTA_DIRECTA'
              )
        `);

        const pedidos = [];
        for (const row of candidatosRes.recordset) {
            const chk = await isPedidoCompletoFisicamenteEnArea(pool, row.NoDocERP, 'PRO');
            if (!chk.completo) continue;

            const ordenProRes = await pool.request()
                .input('Doc', sql.VarChar, row.NoDocERP)
                .query(`
                    SELECT TOP 1 O.OrdenID, O.Cliente, O.DescripcionTrabajo, O.CodigoOrden,
                           A.Descripcion AS NombreProducto
                    FROM Ordenes O
                    LEFT JOIN Articulos A ON A.ProIdProducto = O.ProIdProducto
                    WHERE O.NoDocERP = @Doc AND O.AreaID = 'PRO'
                      AND ISNULL(O.EstadoDependencia, '') <> 'VENTA_DIRECTA'
                `);
            const ordenPro = ordenProRes.recordset[0];
            if (!ordenPro) continue; // no debería pasar — por seguridad

            const componentesRes = await pool.request()
                .input('Doc', sql.VarChar, row.NoDocERP)
                .query(`
                    SELECT O.OrdenID, O.CodigoOrden, O.AreaID, O.Magnitud,
                           B.BultoID, B.CodigoEtiqueta,
                           A.Descripcion AS NombreArticulo
                    FROM Ordenes O
                    JOIN Logistica_Bultos B ON B.OrdenID = O.OrdenID
                        AND B.UbicacionActual = 'PRO' AND B.Estado = 'EN_STOCK'
                        AND ISNULL(B.Tipocontenido, '') <> 'ENCOMIENDA'
                    LEFT JOIN Articulos A ON A.ProIdProducto = O.ProIdProducto
                    WHERE O.NoDocERP = @Doc AND O.AreaID <> 'PRO'
                    ORDER BY O.OrdenID
                `);

            pedidos.push({
                noDocERP: row.NoDocERP,
                ordenProId: ordenPro.OrdenID,
                codigoOrden: ordenPro.CodigoOrden,
                cliente: ordenPro.Cliente,
                trabajo: ordenPro.DescripcionTrabajo,
                producto: ordenPro.NombreProducto,
                componentes: componentesRes.recordset.map(c => ({
                    ordenId: c.OrdenID,
                    codigoOrden: c.CodigoOrden,
                    areaId: c.AreaID,
                    nombreArticulo: c.NombreArticulo,
                    magnitud: c.Magnitud,
                    bultoId: c.BultoID,
                    codigoEtiqueta: c.CodigoEtiqueta,
                })),
            });
        }

        res.json({ success: true, pedidos });
    } catch (err) {
        logger.error('[PRENDAS] getPedidosCompletosPRO:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.aprobarControlPRO = async (req, res) => {
    const noDocERP = (req.params.noDocERP || '').trim();
    if (!noDocERP) return res.status(400).json({ error: 'noDocERP inválido.' });
    try {
        const pool = await getPool();
        const { isPedidoCompletoFisicamenteEnArea } = require('../services/pedidoCompletoService');

        // Re-verificación: evita doble-click o que 2 operadores aprueben el mismo pedido a
        // la vez / que llegue un componente nuevo entre que se abrió la pantalla y se aprobó.
        const chk = await isPedidoCompletoFisicamenteEnArea(pool, noDocERP, 'PRO');
        if (!chk.completo) {
            return res.status(400).json({ error: `Todavía falta${chk.faltantes.length === 1 ? '' : 'n'} ${chk.faltantes.length} componente(s) por llegar a PRO.` });
        }

        const ordenProRes = await pool.request()
            .input('Doc', sql.VarChar, noDocERP)
            .query(`
                SELECT TOP 1 OrdenID FROM Ordenes
                WHERE NoDocERP = @Doc AND AreaID = 'PRO' AND ISNULL(EstadoDependencia, '') <> 'VENTA_DIRECTA'
            `);
        const ordenProId = ordenProRes.recordset[0]?.OrdenID;
        if (!ordenProId) return res.status(404).json({ error: 'No se encontró la orden madre PRO de este pedido.' });

        // Bultos de los componentes que se van a consumir (cerrar) tras generar el bulto final.
        const bultosComponentes = await pool.request()
            .input('Doc', sql.VarChar, noDocERP)
            .query(`
                SELECT B.BultoID
                FROM Ordenes O
                JOIN Logistica_Bultos B ON B.OrdenID = O.OrdenID
                WHERE O.NoDocERP = @Doc AND O.AreaID <> 'PRO'
                  AND B.UbicacionActual = 'PRO' AND B.Estado = 'EN_STOCK'
                  AND ISNULL(B.Tipocontenido, '') <> 'ENCOMIENDA'
            `);

        // Bulto FINAL (producto terminado consolidado) sobre la orden madre — su
        // ProximoServicio ya es 'DEPOSITO', sale PROD_TERMINADO sin overrides.
        const LabelGenerationService = require('../services/LabelGenerationService');
        const lr = await LabelGenerationService.addOneBulto(ordenProId, req.user?.id || 1, req.user?.usuario || 'Sistema', {});
        if (!lr.success) {
            return res.status(500).json({ error: `No se pudo generar la etiqueta final: ${lr.error}` });
        }

        // Consumir (cerrar) los bultos de los componentes — ya cumplieron su función, mismo
        // patrón que el AUTO-CONSUME de createRemito (líneas ~536-583 de este archivo).
        for (const b of bultosComponentes.recordset) {
            await pool.request()
                .input('BID', sql.Int, b.BultoID)
                .query(`UPDATE Logistica_Bultos SET Estado = 'PROCESADO', UbicacionActual = 'PROCESADO' WHERE BultoID = @BID`);
        }

        // Remito final PRO→DEPOSITO con el bulto nuevo — reusa createRemitoFromOrders tal
        // cual (mismo patrón de req/res simulados que el remito automático de la Fase 4).
        let remitoResult = null;
        const fakeRes = {
            json: (data) => { remitoResult = data; },
            status: (code) => ({ json: (data) => { remitoResult = { ...data, _statusCode: code }; } }),
        };
        await exports.createRemitoFromOrders({
            body: {
                areaOrigen: 'PRO',
                areaDestino: 'DEPOSITO',
                usuarioId: req.user?.id || 1,
                orderIds: [ordenProId],
                observations: `Control aprobado — pedido completo (${noDocERP})`,
            },
            user: req.user || 'Sistema',
            app: req.app,
        }, fakeRes);

        if (!remitoResult?.success) {
            logger.warn(`[PRENDAS] aprobarControlPRO: etiqueta generada pero el remito falló para ${noDocERP}:`, remitoResult);
            return res.json({
                success: true,
                totalBultos: lr.totalBultos,
                remitoCreado: false,
                message: 'Etiqueta generada, pero el remito no se pudo armar automáticamente — armalo a mano desde Despacho de PRO.',
            });
        }

        res.json({
            success: true,
            totalBultos: lr.totalBultos,
            remitoCreado: true,
            dispatchCode: remitoResult.dispatchCode,
            componentesConsumidos: bultosComponentes.recordset.length,
        });
    } catch (err) {
        logger.error('[PRENDAS] aprobarControlPRO:', err);
        res.status(500).json({ error: err.message });
    }
};

// --- BANDEJA: órdenes esperando bultos (estado 13) ---
exports.getEsperandoBultos = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT od.OrdIdOrden, od.OrdCodigoOrden,
                   od.CliIdCliente, c.Nombre AS Cliente,
                   ISNULL(od.BultosEsperados, 0) AS BultosEsperados,
                   ISNULL(od.BultosRecibidos, 0) AS BultosRecibidos,
                   od.OrdNombreTrabajo,
                   od.OrdFechaEstadoActual,
                   DATEDIFF(DAY, od.OrdFechaEstadoActual, GETDATE()) AS DiasEsperando,
                   o.OrdenID AS OrdenIdReal
            FROM OrdenesDeposito od WITH(NOLOCK)
            LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = od.CliIdCliente
            LEFT JOIN Ordenes o WITH(NOLOCK) ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
            WHERE od.OrdEstadoActual = 13
            ORDER BY od.OrdFechaEstadoActual ASC
        `);
        res.json(r.recordset);
    } catch (err) {
        logger.error("Error getEsperandoBultos:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getDashboard = async (req, res) => {
    const { areaId } = req.query;
    try {
        const pool = await getPool();

        // Ejecutar ambas queries EN PARALELO para reducir tiempo de respuesta
        const [r, rPending] = await Promise.all([
            // 1. Bultos existentes en el área
            pool.request().input('A', sql.VarChar, areaId)
                .query(`
                    SELECT 
                        b.BultoID, b.CodigoEtiqueta, b.Descripcion, b.Estado, b.UbicacionActual, b.Tipocontenido,
                        b.OrdenID,
                        o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.ProximoServicio,
                        (SELECT COUNT(*) FROM Logistica_Bultos WITH(NOLOCK)
                          WHERE OrdenID = b.OrdenID
                            AND ISNULL(Tipocontenido,'') <> 'ENCOMIENDA') as TotalBultosOrden
                    FROM Logistica_Bultos b WITH(NOLOCK)
                    -- Encomiendas: OrdenID = N° de OrdenesRetiro, no de Ordenes (evita colgar
                    -- el bulto de una orden nueva que nació con ese mismo número)
                    LEFT JOIN Ordenes o WITH(NOLOCK) ON b.OrdenID = o.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
                    WHERE b.UbicacionActual = @A 
                    AND b.Estado NOT IN ('PERDIDO', 'DESPACHADO', 'EN_TRANSITO')
                `),

            // 2. Órdenes pendientes sin bultos aún
            // OPTIMIZACIÓN: NOT EXISTS en lugar de LEFT JOIN — mucho más eficiente con índices
            pool.request().input('A', sql.VarChar, areaId)
                .query(`
                    SELECT
                        o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Estado, o.AreaID, o.EstadoLogistica
                    FROM Ordenes o WITH(NOLOCK)
                    WHERE o.AreaID = @A
                    AND o.Estado NOT IN ('Entregado', 'Finalizado', 'Cancelado', 'Pendiente')
                    AND NOT EXISTS (
                        -- OJO: en bultos de ENCOMIENDA el OrdenID es el N° de OrdenesRetiro,
                        -- NO de Ordenes — sin este filtro una encomienda ajena con el mismo
                        -- número "tapa" a la orden y desaparece del canasto.
                        SELECT 1 FROM Logistica_Bultos lb WITH(NOLOCK)
                        WHERE lb.OrdenID = o.OrdenID
                          AND ISNULL(lb.Tipocontenido, '') <> 'ENCOMIENDA'
                    )
                `)
        ]);

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
                tipoBulto: row.Tipocontenido || 'PROD_TERMINADO',
                proximoServicio: row.ProximoServicio,
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
        logger.error("Error getDashboard:", err);
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

        // GUARD: si el destino ya recibió el remito, firmar la salida lo pisaba a
        // EN_TRANSITO y el remito "resucitaba" en la bandeja de check-in con todos
        // los bultos en verde (caso REM-333997 / REM-113666). RECIBIDO_PARCIAL sí
        // se permite: puede haber un segundo viaje con los bultos que faltaron.
        if (envio.Estado === 'RECIBIDO_TOTAL' || envio.Estado === 'ENTREGADO') {
            return res.status(409).json({
                error: `El remito ${remitoCode} ya fue recibido completo en ${envio.AreaDestinoID}. No se puede firmar una salida de un remito ya recibido.`
            });
        }

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
        logger.error("Error confirmTransport:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.confirmRemitoDelivery = async (req, res) => {
    try {
        const { code } = req.params;
        const file = req.file;
        let { bultosIds } = req.body;
        
        if (!bultosIds) {
            return res.status(400).json({ error: 'Debe especificar los bultos a los que aplica este comprobante' });
        }

        // Parse bultosIds from FormData text
        let idsArray = [];
        try {
            idsArray = typeof bultosIds === 'string' ? JSON.parse(bultosIds) : bultosIds;
        } catch (e) {
            return res.status(400).json({ error: 'Formato inválido de bultosIds' });
        }

        if (idsArray.length === 0) {
            return res.status(400).json({ error: 'No se seleccionaron bultos' });
        }

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        try {
            // Ensure column exists in BULTOS instead of Envios (Safe to fail if already exists)
            try {
                await new sql.Request(transaction).query("ALTER TABLE Logistica_Bultos ADD ComprobantePath NVARCHAR(MAX) NULL");
            } catch (e) { /* Ignore */ }

            const comprobanteUrl = file ? `/comprobantesEncomiendas/${file.filename}` : null;
            const idsList = idsArray.join(',');

            // 1. Update Bultos inside this Envio
            await new sql.Request(transaction)
                .input('Path', sql.NVarChar, comprobanteUrl)
                .query(`
                    UPDATE Logistica_Bultos
                    SET Estado = 'ENTREGADO', UbicacionActual = 'CLIENTE_FINAL', 
                    ComprobantePath = ISNULL(@Path, ComprobantePath)
                    WHERE BultoID IN (${idsList})
                `);
                
            // 1.5 Update items in the Envio
            await new sql.Request(transaction)
                .input('Code', sql.VarChar, code)
                .query(`
                    UPDATE Logistica_EnvioItems
                    SET EstadoRecepcion = 'ENTREGADO'
                    WHERE BultoID IN (${idsList}) AND EnvioID = (SELECT EnvioID FROM Logistica_Envios WHERE CodigoRemito = @Code)
                `);

            // 2. Update OrdenesRetiro to Mark as Entregado (state 5) if they were encomiendas
            await new sql.Request(transaction).query(`
                UPDATE OrdenesRetiro
                SET OReEstadoActual = 5, OReFechaEstadoActual = GETDATE()
                WHERE OReIdOrdenRetiro IN (
                    SELECT b.OrdenID FROM Logistica_Bultos b
                    WHERE b.BultoID IN (${idsList}) AND b.Tipocontenido = 'ENCOMIENDA' AND b.OrdenID IS NOT NULL
                );

                UPDATE OrdenesDeposito
                SET OrdEstadoActual = 9, OrdFechaEstadoActual = GETDATE()
                WHERE OReIdOrdenRetiro IN (
                    SELECT b.OrdenID FROM Logistica_Bultos b
                    WHERE b.BultoID IN (${idsList}) AND b.Tipocontenido = 'ENCOMIENDA' AND b.OrdenID IS NOT NULL
                );
            `);

            // 3. Check if ALL items in this Envio are delivered to mark the Envio itself as Delivered
            const remainingReq = await new sql.Request(transaction)
                .input('Code', sql.VarChar, code)
                .query(`
                    SELECT COUNT(*) as Pendientes 
                    FROM Logistica_EnvioItems i
                    JOIN Logistica_Envios e ON e.EnvioID = i.EnvioID
                    WHERE e.CodigoRemito = @Code AND i.EstadoRecepcion != 'ENTREGADO'
                `);
            
            if (remainingReq.recordset[0].Pendientes === 0) {
                await new sql.Request(transaction)
                    .input('Code', sql.VarChar, code)
                    .query("UPDATE Logistica_Envios SET Estado = 'ENTREGADO' WHERE CodigoRemito = @Code");
            }

            await transaction.commit();
            res.json({ success: true, message: 'Comprobante subido y bultos cerrados exitosamente' });
        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }
    } catch (err) {
        logger.error("Error confirmRemitoDelivery:", err);
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
                e.AreaOrigenID,
                e.AreaDestinoID,
                e.FechaSalida as FechaCreacion,
                e.FechaSalida as Fecha,
                (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalBultos,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM Logistica_EnvioItems ei
                        INNER JOIN Logistica_Bultos b ON ei.BultoID = b.BultoID
                        WHERE ei.EnvioID = e.EnvioID AND b.Tipocontenido = 'ENCOMIENDA'
                    ) THEN 'ENCOMIENDA'
                    ELSE 'PRODUCCION'
                END AS TipoEnvio
            FROM Logistica_Envios e
            ORDER BY e.FechaSalida DESC
        `);
        res.json(r.recordset);
    } catch (err) {
        logger.error(err);
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
        logger.error(err);
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
                                        USING (
                                            SELECT DISTINCT req.RequisitoID, req.AreaID, dest.OrdenID
                                            FROM ConfigRequisitosProduccion req
                                            CROSS JOIN (
                                                SELECT OrdenID FROM Ordenes 
                                                WHERE 
                                                   (
                                                       (@Doc != '' AND NoDocERP = @Doc)
                                                       OR 
                                                       (@Doc = '' AND NoDocERP = (SELECT TOP 1 NoDocERP FROM Ordenes WHERE OrdenID = @OID))
                                                       OR
                                                       (@Doc = '' AND OrdenID = @OID)
                                                   )
                                                   AND AreaID = @Area 
                                                   AND Estado != 'CANCELADO'
                                            ) dest
                                            WHERE (
                                                req.CodigoRequisito LIKE @Type
                                                OR (@Type LIKE '%DISENO%' AND req.CodigoRequisito LIKE '%DTF%')
                                                OR (@Type LIKE '%DTF%' AND req.CodigoRequisito LIKE '%DISENO%')
                                            )
                                            AND req.AreaID = @Area
                                        ) AS source
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
        logger.error(err);
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
                o.NoDocERP,
                COALESCE(r.Codigo, '') as CodigoRecepcion,
                COALESCE(r.Cliente, o.Cliente, 'CLIENTE_NOT_FOUND') as Cliente,
                cliord.IDCliente AS IDCliente,
                COALESCE(CONCAT(r.Tipo, ' - ', r.Detalle), r.Detalle, o.DescripcionTrabajo, b.Descripcion) as DescripcionTrabajo,
                COALESCE(r.FechaRecepcion, o.FechaIngreso, b.FechaCreacion) as FechaIngreso,
                COALESCE(r.ProximoServicio, o.ProximoServicio, 'LOGISTICA') as ProximoServicio
            FROM Logistica_Bultos b
            -- Encomiendas: OrdenID = N° de OrdenesRetiro, no de Ordenes (sin el filtro, los
            -- datos de la orden fantasma pisaban al COALESCE con la recepción/bulto)
            LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
            LEFT JOIN dbo.Clientes cliord WITH(NOLOCK) ON o.CliIdCliente = cliord.CliIdCliente
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
            AND NOT EXISTS (
                SELECT 1 FROM Logistica_EnvioItems ei WHERE ei.BultoID = b.BultoID
            )
            -- Pedido completo en área: ocultar producto terminado de pedidos con órdenes
            -- hermanas (mismo NoDocERP, misma área) aún no prontas
            AND NOT (
                b.Tipocontenido = 'PROD_TERMINADO'
                AND o.OrdenID IS NOT NULL
                AND ${sqlExistsHermanaNoPronta('o')}
            )
            -- Fallas internas (-F): sus bultos circulan por planta con etiqueta, pero una -F NUNCA se
            -- despacha sola — su material se incorpora al pedido madre. No se ofrecen en Crear Remito.
            -- (Bultos sin orden asociada, ej. recepciones, siguen apareciendo: el IS NULL los conserva.)
            AND (o.CodigoOrden IS NULL OR o.CodigoOrden NOT LIKE '%-F%')
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

// CHECK-IN TERMINAC DIFERIDO: recuperar de extraviados un bulto hacia Terminaciones
// equivale a recibir el material — la hermana XEUV 'Pendiente' del mismo pedido pasa
// a 'Material Recibido'. Sin esto, el gancho solo corría en el check-in de remitos y
// las órdenes recuperadas quedaban clavadas en Pendiente (no aparecían en la bandeja).
// Nunca con encomiendas: su OrdenID es el N° de OrdenesRetiro, no de Ordenes.
async function hookTerminacRecuperado(transaction, bultoId, req, location) {
    if ((location || '').trim().toUpperCase() !== 'TERMINAC') return;
    try {
        const bInfo = await new sql.Request(transaction)
            .input('BID', sql.Int, bultoId)
            .query("SELECT OrdenID, Tipocontenido, CodigoEtiqueta FROM Logistica_Bultos WHERE BultoID = @BID");
        const b = bInfo.recordset[0];
        if (!b?.OrdenID || (b.Tipocontenido || '').toUpperCase() === 'ENCOMIENDA') return;
        const herRes = await new sql.Request(transaction)
            .input('OID', sql.Int, b.OrdenID)
            .query(`
                SELECT H.OrdenID FROM Ordenes H
                WHERE H.AreaID = 'TERMINAC' AND H.Estado NOT IN ('Cancelado')
                  AND ISNULL(H.EstadoenArea, 'Pendiente') = 'Pendiente'
                  AND H.NoDocERP = (SELECT NoDocERP FROM Ordenes WHERE OrdenID = @OID)
            `);
        for (const her of herRes.recordset) {
            await changeOrderState(transaction, {
                target : { type: 'ORDER', id: her.OrdenID },
                estado : 'Material Recibido',
                userObj: req.user || 'Sistema',
                detalle: `Material impreso recuperado de extraviados en Terminaciones (bulto ${b.CodigoEtiqueta || bultoId})`,
                io     : req.app.get('socketio')
            });
            logger.info(`[Recuperar TERMINAC] Orden ${her.OrdenID} -> Material Recibido (bulto ${b.CodigoEtiqueta})`);
        }
    } catch (eTer) {
        logger.warn('[Recuperar TERMINAC] No se pudo actualizar la hermana de terminaciones:', eTer.message);
    }
}

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

            await hookTerminacRecuperado(transaction, bultoId, req, location);

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
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.toggleRequirement = async (req, res) => {
    // [FIX] La versión anterior armaba un MERGE cross-orden (aplicar a TODAS las
    // hermanas del mismo NoDocERP con un CodigoRequisito que matcheara @Type) pero
    // nunca declaraba @Doc ni @Type como inputs — cualquier click en el check de
    // Requisitos tiraba "Must declare the scalar variable @Doc" y no hacía nada.
    // Simplificado a lo que en verdad hace falta: togglear ESTA orden y ESTE
    // requisito puntual, nada más.
    // fechaCumplimiento (opcional): ISO string — para cuando la aprobación pasó ANTES
    // de que alguien la cargue acá (ej. WhatsApp de ayer a la tarde). Si no viene, GETDATE().
    const { ordenId, requisitoId, cumplido, observaciones, fechaCumplimiento } = req.body; // cumplido: bool
    try {
        const pool = await getPool();
        if (cumplido) {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .input('Obs', sql.NVarChar, observaciones || '')
                .input('Fecha', sql.DateTime, fechaCumplimiento ? new Date(fechaCumplimiento) : new Date())
                .query(`
                    DECLARE @Area NVARCHAR(50) = (SELECT AreaID FROM ConfigRequisitosProduccion WHERE RequisitoID = @RID);
                    MERGE OrdenCumplimientoRequisitos AS target
                    USING (SELECT @RID AS RequisitoID, @Area AS AreaID) AS source
                    ON (target.OrdenID = @OID AND target.RequisitoID = source.RequisitoID)
                    WHEN MATCHED THEN
                        UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = @Fecha, Observaciones = @Obs
                    WHEN NOT MATCHED THEN
                        INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                        VALUES (@OID, source.AreaID, source.RequisitoID, 'CUMPLIDO', @Fecha, @Obs);
                `);
        } else if (observaciones) {
            // Desmarca pero deja la observación (ej. "por qué falta") — mismo criterio
            // que ya tenía la versión vieja.
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .input('Obs', sql.NVarChar, observaciones)
                .query(`
                    DECLARE @Area NVARCHAR(50) = (SELECT AreaID FROM ConfigRequisitosProduccion WHERE RequisitoID = @RID);
                    MERGE OrdenCumplimientoRequisitos AS target
                    USING (SELECT @RID AS RequisitoID, @Area AS AreaID) AS source
                    ON (target.OrdenID = @OID AND target.RequisitoID = source.RequisitoID)
                    WHEN MATCHED THEN
                        UPDATE SET Estado = 'PENDIENTE', Observaciones = @Obs
                    WHEN NOT MATCHED THEN
                        INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                        VALUES (@OID, source.AreaID, source.RequisitoID, 'PENDIENTE', NULL, @Obs);
                `);
        } else {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .query("DELETE FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID");
        }
        res.json({ success: true });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.getAvailableResources = async (req, res) => {
    const { ordenId, reqCode, areaId } = req.query;
    logger.info(`[getAvailableResources] Buscando para Orden ${ordenId}, Req: ${reqCode}, Area: ${areaId}`);

    try {
        const pool = await getPool();

        // 1. Obtener Datos de la Orden (Cliente + área + bobina ya vinculada)
        const orderRes = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query("SELECT Cliente, CliIdCliente, AreaID, BobinaTelaID FROM Ordenes WHERE OrdenID = @OID");

        if (orderRes.recordset.length === 0) return res.json([]);
        const clienteNombre = orderRes.recordset[0].Cliente || '';
        const cliIdCliente = orderRes.recordset[0].CliIdCliente || null;
        const areaOrden = (orderRes.recordset[0].AreaID || areaId || '').trim();
        const bobinaTelaId = orderRes.recordset[0].BobinaTelaID || null;
        logger.info(`[REQ] Cliente: '${clienteNombre}' (ID ${cliIdCliente}), Área: ${areaOrden}, BobinaTela: ${bobinaTelaId}`);

        let resources = [];
        let specificFound = false;

        // Campos completos de la bobina de tela cliente: la etiqueta muestra tela,
        // PRE del ingreso, metros, ancho y peso — no solo "Bobina N".
        const CAMPOS_BOBINA = `
            ib.BobinaID as id,
            CASE WHEN ib.CodigoEtiqueta IS NULL THEN 'Bob-' + CAST(ib.BobinaID as varchar) ELSE ib.CodigoEtiqueta END as label,
            'Bobina ' + CAST(ib.BobinaID as varchar) + ' (' + CAST(ib.MetrosRestantes as varchar) + 'm) - ' + ISNULL(ib.Referencia, '') as description,
            ib.Ubicacion as location,
            ib.Referencia as pre,
            LTRIM(RTRIM(ISNULL(ib.DescripcionTela, ''))) as tela,
            ib.MetrosRestantes as metros,
            ib.MetrosIniciales as metrosIniciales,
            ISNULL(ib.AnchoReal, ib.Ancho) as ancho,
            ISNULL(ib.PesoReal, ib.Peso) as peso,
            ib.AreaID as areaBobina,
            ib.Estado as estadoBobina,
            ISNULL(NULLIF(LTRIM(RTRIM(ib.NombreCliente)), ''), LTRIM(RTRIM(ISNULL(cli.Nombre, '')))) as clienteBobina,
            CASE WHEN TRY_CAST(ib.ClienteID AS INT) = @CliId OR ib.OrdenID = @OID OR ib.BobinaID = @BobTela THEN 1 ELSE 0 END as esDelCliente,
            CASE WHEN ib.BobinaID = @BobTela THEN 1 ELSE 0 END as vinculadaAOrden
        `;
        const JOIN_CLIENTE = `LEFT JOIN Clientes cli ON TRY_CAST(ib.ClienteID AS INT) = cli.CliIdCliente`;

        // Lógica según tipo de requisito
        if (reqCode && reqCode.includes('TELA')) {
            // ESTRATEGIA 1: bobinas DE ESTE CLIENTE (por CliIdCliente, por la orden, o por
            // el nombre en la Referencia — legacy), en CUALQUIER estado — una tela
            // Agotada por el consumo de esta misma orden sigue siendo LA tela del
            // trabajo y tiene que verse (con su estado). La vinculada a la orden
            // (Ordenes.BobinaTelaID, la eligió el form de corte) va primera SIEMPRE.
            const queryBob = `
                    SELECT ${CAMPOS_BOBINA}
                    FROM InventarioBobinas ib
                    ${JOIN_CLIENTE}
                    WHERE ib.InsumoID = 1146 -- Filtro Solicitado
                    AND (
                         ib.BobinaID = @BobTela
                         OR (ib.Estado IN ('Disponible', 'En Uso', 'Agotado') AND (
                             ib.OrdenID = @OID
                             OR TRY_CAST(ib.ClienteID AS INT) = @CliId
                             OR ib.Referencia LIKE '%' + @CliName + '%'
                         ))
                    )
                    ORDER BY CASE WHEN ib.BobinaID = @BobTela THEN 0 ELSE 1 END,
                             CASE WHEN LTRIM(RTRIM(ISNULL(ib.AreaID, ''))) = @AreaOrden THEN 0 ELSE 1 END,
                             ib.FechaIngreso DESC
            `;
            const rSpecific = await pool.request()
                .input('CliName', sql.NVarChar, clienteNombre || 'XXXXXXXX')
                .input('OID', sql.Int, ordenId)
                .input('CliId', sql.Int, cliIdCliente)
                .input('AreaOrden', sql.VarChar(20), areaOrden)
                .input('BobTela', sql.Int, bobinaTelaId)
                .query(queryBob);

            resources = rSpecific.recordset;

            if (resources.length > 0) specificFound = true;

            // ESTRATEGIA 2: Fallback — SOLO bobinas disponibles del ÁREA de la orden
            // (antes traía las de cualquier cliente y cualquier área, y confundía).
            if (resources.length === 0) {
                logger.info(`[REQ] Sin bobinas del cliente. Trayendo disponibles del área ${areaOrden} (Insumo 1146).`);
                const rFallback = await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .input('CliId', sql.Int, cliIdCliente)
                    .input('AreaOrden', sql.VarChar(20), areaOrden)
                    .input('BobTela', sql.Int, bobinaTelaId)
                    .query(`
                        SELECT TOP 50 ${CAMPOS_BOBINA}
                        FROM InventarioBobinas ib
                        ${JOIN_CLIENTE}
                        WHERE ib.Estado IN ('Disponible')
                        AND ib.InsumoID = 1146 -- Filtro Solicitado
                        AND LTRIM(RTRIM(ISNULL(ib.AreaID, ''))) = @AreaOrden
                        ORDER BY ib.FechaIngreso DESC
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

        logger.info(`[REQ] Returning ${resources.length} resources (Specific: ${specificFound})`);
        res.json(resources);

    } catch (err) {
        logger.error(err);
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

            // 3. Destino TERMINAC: habilitar la hermana XEUV (check-in diferido)
            await hookTerminacRecuperado(transaction, bultoId, req, location);

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

// --- STOCK DEPOSITO Y SYNC ---

exports.getDepositStock = async (req, res) => {
    try {
        const pool = await getPool();
        // Agrupar por Pedido Base (CodigoQR string V3)
        // La logica: Bultos en DEPOSITO y EN_STOCK
        // Usamos el CodigoQR de la etiqueta para agrupar, ya que es el identificador unico del "Pedido V3"
        const resultGrouped = await pool.request().query(`
            SELECT 
                MAX(O.CodigoOrden) as CodigoOrden,
                MAX(O.Cliente) as Cliente,
                MAX(O.DescripcionTrabajo) as Descripcion,
                MAX(O.FechaIngreso) as FechaIngreso,
                MAX(O.CostoTotal) as Precio,
                MAX(O.Magnitud) as Cantidad,
                MAX(O.PerfilesPrecio) as PerfilesPrecio,
                E.CodigoQR as V3String,
                COUNT(DISTINCT LB.BultoID) as CantidadBultos,
                MAX(PC.EstadoSyncReact) as EstadoSyncReact,
                MAX(PC.ObsReact) as ObsReact,
                MAX(PC.EstadoSyncERP) as EstadoSyncERP,
                MAX(PC.ObsERP) as ObsERP,
                MAX(PC.Moneda) as Moneda,
                MAX(PCD.LogPrecioAplicado) as LogFacturacion,
                STRING_AGG(LB.CodigoEtiqueta, ', ') as BultosList
            FROM Logistica_Bultos LB
            JOIN Etiquetas E ON LB.CodigoEtiqueta = E.CodigoEtiqueta
            LEFT JOIN Ordenes O ON LB.OrdenID = O.OrdenID
            LEFT JOIN PedidosCobranzaDetalle PCD ON O.OrdenID = PCD.OrdenID
            LEFT JOIN PedidosCobranza PC ON PCD.PedidoCobranzaID = PC.ID
            WHERE (LB.UbicacionActual = 'DEPOSITO' OR LB.UbicacionActual = 'LOGISTICA')
              AND LB.Estado = 'EN_STOCK'
            GROUP BY E.CodigoQR
        `);

        res.json(resultGrouped.recordset);
    } catch (err) {
        logger.error("Error getDepositStock:", err);
        res.status(500).json({ error: err.message });
    }
};

// getExternalToken removido - erpSyncService maneja la escritura directa en DB

const ERPSyncService = require('../services/erpSyncService');

exports.syncDepositStock = async (req, res) => {
    try {
        const { items } = req.body; // Array de { qr, ... }
        if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Formato incorrecto. Se espera array "items"' });

        const pool = await getPool();
        const { isProcessActive } = require('./configuracionesController');

        const isReactGlobalActive = await isProcessActive('SYNC_REACT_CORE');
        const isErpGlobalActive = await isProcessActive('SYNC_ERP_MACROSOFT');

        const results = [];

        // 1. Identificar NoDocERP únicos y mapear Bultos / Notas
        const docsToSync = new Map(); // Map de noDocERP -> { bultoCode, notes }

        for (const item of items) {
            let code = null;
            let bultoRef = null;

            if (item.qr) {
                // Soportar formato tradicional $[ID]$*...
                const parts = item.qr.split('$*');
                code = parts[0].trim();

                // Si el código trae el prefijo $, lo quitamos para la consulta DB
                if (code.startsWith('$')) {
                    code = code.substring(1);
                }

                if (code.startsWith('B')) bultoRef = code;
                logger.info(`[SyncLogistics] Procesando item con código: ${code} (Bulto: ${bultoRef || 'No'})`);
            } else if (item.noDocERP) {
                const docId = item.noDocERP.toString().trim();
                logger.info(`[SyncLogistics] Procesando por NoDocERP directo: ${docId}`);
                if (!docsToSync.has(docId)) docsToSync.set(docId, { bultoCode: null, notes: '', price: null, quantity: null, profile: null, reactPayload: null, erpPayload: null });
                continue;
            }

            if (code) {
                const isBulto = code.startsWith('B');
                let query = "";
                let queryParam = code;

                if (isBulto) {
                    query = "SELECT TOP 1 O.NoDocERP FROM Ordenes O JOIN Etiquetas E ON O.OrdenID = E.OrdenID WHERE E.CodigoEtiqueta = @Code";
                } else if (code.startsWith('ORD-')) {
                    // Si viene como ORD-12345, intentamos buscar por OrdenID directamente
                    const idPart = code.replace('ORD-', '');
                    if (!isNaN(idPart)) {
                        query = "SELECT TOP 1 NoDocERP FROM Ordenes WHERE OrdenID = @ID OR CodigoOrden = @Code";
                        queryParam = idPart;
                    } else {
                        query = "SELECT TOP 1 NoDocERP FROM Ordenes WHERE CodigoOrden = @Code OR CodigoOrden LIKE @Code + ' (%)' OR NoDocERP = @Code";
                    }
                } else {
                    query = "SELECT TOP 1 NoDocERP FROM Ordenes WHERE CodigoOrden = @Code OR CodigoOrden LIKE @Code + ' (%)' OR NoDocERP = @Code OR REPLACE(NoDocERP, 'RE-', '') = @Code";
                }

                const orderInfo = await pool.request()
                    .input('Code', sql.VarChar, code)
                    .input('ID', sql.Int, isNaN(queryParam) ? 0 : parseInt(queryParam))
                    .query(query);

                // Fallback: Si no se encontró por QR, intentar por CodigoOrden explícito si existe
                if (orderInfo.recordset.length === 0 && item.CodigoOrden) {
                    logger.info(`[SyncLogistics] Fallback: Buscando por CodigoOrden explícito: ${item.CodigoOrden}`);
                    const fallbackInfo = await pool.request()
                        .input('C', sql.VarChar, item.CodigoOrden)
                        .query("SELECT TOP 1 NoDocERP FROM Ordenes WHERE CodigoOrden = @C OR CodigoOrden LIKE @C + ' (%)'");
                    if (fallbackInfo.recordset.length > 0) {
                        orderInfo.recordset = fallbackInfo.recordset;
                    }
                }

                if (orderInfo.recordset.length > 0 && orderInfo.recordset[0].NoDocERP) {
                    const docId = orderInfo.recordset[0].NoDocERP.toString().trim();
                    logger.info(`[SyncLogistics] Documento encontrado: ${docId} para código: ${code}`);
                    const existing = docsToSync.get(docId) || { bultoCode: null, notes: '', price: null, quantity: null, profile: null, reactPayload: null, erpPayload: null };

                    docsToSync.set(docId, {
                        bultoCode: bultoRef || existing.bultoCode,
                        notes: item.notes || existing.notes,
                        price: item.price !== undefined ? item.price : existing.price,
                        quantity: item.quantity !== undefined ? item.quantity : existing.quantity,
                        profile: item.profile !== undefined ? item.profile : existing.profile,
                        reactPayload: item.reactPayload || existing.reactPayload,
                        erpPayload: item.erpPayload || existing.erpPayload
                    });
                } else {
                    logger.info(`[SyncLogistics] NO se encontró NoDocERP en la base de datos para: ${code}`);
                }
            }
        }

        logger.info(`[SyncLogistics] Total de documentos únicos a sincronizar: ${docsToSync.size}`, Array.from(docsToSync.keys()));

        // 2. Ejecutar Sincronización Integral por Documento
        for (const [doc, data] of docsToSync.entries()) {
            try {
                logger.info(`[SyncLogistics] Ejecutando Sync Integral para Doc: ${doc} ${data.bultoCode ? '(Bulto: ' + data.bultoCode + ')' : ''}`);

                const syncRes = await ERPSyncService.syncFinalOrderIntegration(doc, req.user?.id || 1, req.user?.usuario || 'Sistema', data.bultoCode, {
                    userNotes: data.notes,
                    priceOverride: data.price,
                    quantityOverride: data.quantity,
                    profileOverride: data.profile,
                    syncTarget: req.body.target,
                    forcedReactPayload: data.reactPayload,
                    forcedErpPayload: data.erpPayload,
                    isReactEnabledGlobal: isReactGlobalActive,
                    isErpEnabledGlobal: isErpGlobalActive
                });

                results.push({
                    document: doc,
                    success: syncRes.success,
                    total: syncRes.totalPriceSum,
                    react: syncRes.reactSuccess ? 'OK' : 'Error',
                    erp: syncRes.erpSuccess ? 'OK' : 'Error'
                });
            } catch (docErr) {
                logger.error(`[SyncLogistics] Error en documento ${doc}:`, docErr.message);
                results.push({
                    document: doc,
                    success: false,
                    error: docErr.message
                });
            }
        }

        res.json({ success: true, results });

    } catch (err) {
        logger.error("Error syncDepositStock:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.recalculateDepositStockPrices = async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Array "items" requerido' });

        const pool = await getPool();
        const results = [];
        const processedDocs = new Set();

        for (const item of items) {
            if (!item.qr) continue;

            const qrString = item.qr.startsWith('$') ? item.qr.substring(1) : item.qr;
            const cleanQR = qrString.split('$*')[0].trim();

            const docQuery = `
                SELECT TOP 1 O.NoDocERP 
                FROM Ordenes O
                LEFT JOIN Etiquetas E ON O.OrdenID = E.OrdenID
                WHERE E.CodigoQR = @QR 
                   OR E.CodigoEtiqueta = @QR
                   OR O.CodigoOrden = @QR
                   OR O.CodigoOrden LIKE @QR + ' (%)'
            `;

            const orderInfo = await pool.request().input('QR', sql.VarChar, cleanQR).query(docQuery);

            if (orderInfo.recordset.length > 0 && orderInfo.recordset[0].NoDocERP) {
                const docId = orderInfo.recordset[0].NoDocERP.toString().trim();
                const syncRes = await ERPSyncService.syncFinalOrderIntegration(docId, req.user?.id || 1, req.user?.usuario || 'Sistema', null, {
                    onlyCalculate: true,
                    priceOverride: item.price,
                    quantityOverride: item.quantity,
                    profileOverride: item.profile
                });

                results.push({
                    qr: item.qr,
                    document: docId,
                    success: syncRes.success,
                    total: syncRes.totalPriceSum,
                    currency: syncRes.targetCurrency,
                    reactPayload: syncRes.reactPayload,
                    erpPayload: syncRes.erpPayload
                });
            }
        }

        res.json(results);
    } catch (err) {
        logger.error("Error recalculateDepositStockPrices:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.releaseDepositStock = async (req, res) => {
    const { items } = req.body; // items: [{ qr: "..." }]
    if (!items || items.length === 0) return res.json({ success: true, count: 0 });

    let releasedCount = 0;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const affectedOrderIds = new Set();

        try {
            for (const item of items) {
                if (!item.qr) continue;

                // 1. Identify Bultos by QR (The QR in 'items' is the V3 string from Etiquetas table)
                // We need to find Bultos linked to Etiquetas linked to this QR

                // First get the Etiqueta Codes for this QR
                // IMPORTANT: The QR in 'Etiquetas' table is unique per row? Or multiple rows/bultos share same QR string?
                // In DepositStockPage, we group by E.CodigoQR. So multiple bultos can form one "Pedido V3".

                // Logic: Release ALL bultos associated with this QR string.

                const updateRes = await new sql.Request(transaction)
                    .input('QR', sql.NVarChar(4000), item.qr)
                    .query(`
                        UPDATE LB
                        SET 
                            LB.Estado = 'ENTREGADO', 
                            LB.UbicacionActual = 'CLIENTE'
                        OUTPUT INSERTED.CodigoEtiqueta, INSERTED.OrdenID
                        FROM Logistica_Bultos LB
                        INNER JOIN Etiquetas E ON LB.CodigoEtiqueta = E.CodigoEtiqueta
                        WHERE E.CodigoQR = @QR 
                          AND LB.UbicacionActual = 'DEPOSITO'
                    `);

                const updatedRows = updateRes.recordset;
                updatedRows.forEach(r => affectedOrderIds.add(r.OrdenID));
                releasedCount += updatedRows.length;

                // Log Movements for each released bulto
                for (const row of updatedRows) {
                    const code = row.CodigoEtiqueta;
                    await new sql.Request(transaction)
                        .input('Cod', sql.VarChar, code)
                        .input('User', sql.Int, req.user?.id || 1)
                        .query(`
                             INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
                             VALUES (@Cod, 'SALIDA', 'DEPOSITO', @User, GETDATE(), 'Liberación por Sincronización', 'EN_STOCK', 'ENTREGADO', 0)
                        `);
                }
            }

            // Close Orders if fully delivered
            for (const oid of affectedOrderIds) {
                if (!oid) continue;
                const pendingRes = await new sql.Request(transaction).input('OID', sql.Int, oid).query("SELECT COUNT(*) as C FROM Logistica_Bultos WHERE OrdenID = @OID AND Estado != 'ENTREGADO'");

                if (pendingRes.recordset[0].C === 0) {
                    await changeOrderState(transaction, {
                        target  : { type: 'ORDER', id: oid },
                        estado  : 'Finalizado',
                        userObj : req.user || 'Sistema',
                        detalle : 'Entrega completa al cliente',
                        extraSet: { EstadoLogistica: 'ENTREGADO', UbicacionActual: 'CLIENTE' },
                        io      : req.app.get('socketio'),
                    });
                }
            }

            await transaction.commit();
            res.json({ success: true, count: releasedCount });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        logger.error("Error releaseDepositStock:", err);
        res.status(500).json({ error: err.message });
    }
};
