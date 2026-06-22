const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const ERPSyncService = require('./erpSyncService');

class LabelGenerationService {

    /**
     * Valida y regenera etiquetas para una orden.
     * SIMPLIFICADO: Ahora solo se encarga de crear los bultos para logística.
     * La cotización y sincronización se movieron al flujo de ERPSyncService.
     */
    static async regenerateLabelsForOrder(ordenId, userId, userName, cantidadManual = null) {
        let transaction;
        try {
            const pool = await getPool();

            // 1. Obtener Info Orden Actual
            const orderRes = await pool.request()
                .input('OID', sql.Int, ordenId)
                .query(`SELECT * FROM Ordenes WHERE OrdenID = @OID`);

            if (orderRes.recordset.length === 0) {
                return { success: false, error: 'Orden no encontrada' };
            }
            const o = orderRes.recordset[0];

            // --- VALIDACIÓN DE MAGNITUD DESDE PEDIDOSCOBRANZADETALLE ---
            // A solicitud del usuario, la validación estricta debe basarse en la cotización guardada en el ERP Sync.
            const pcdRes = await pool.request()
                .input('OID', sql.Int, ordenId)
                .query(`SELECT SUM(Cantidad) as TotalCantidad FROM PedidosCobranzaDetalle WHERE OrdenID = @OID`);
            
            const magnitudValor = parseFloat(pcdRes.recordset[0]?.TotalCantidad) || 0;
            
            const codOrdLocal = (o.CodigoOrden || '').trim().toUpperCase();
            const prioridadLocal = (o.Prioridad || '').trim().toUpperCase();
            const esRepoLocal = codOrdLocal.includes('-R') || prioridadLocal === 'REPOSICIÓN' || prioridadLocal === 'REPOSICION';

            if (magnitudValor <= 0 && !esRepoLocal) {
                return { success: false, error: `No se pueden generar etiquetas: La magnitud cotizada es 0 o inválida. Revise la cotización de los items para esta área en 'Cotizar Productos'.` };
            }

            // --- CÁLCULO CANTIDAD BULTOS (Lógica Metros/Bulto) ---
            let totalBultos = cantidadManual;

            if (!totalBultos || totalBultos < 1) {
                try {
                    const configRes = await pool.request()
                        .input('Clave', sql.VarChar(50), 'METROSBULTOS')
                        .input('AreaID', sql.VarChar(20), o.AreaID || 'GEN')
                        .query(`SELECT TOP 1 Valor FROM ConfiguracionGlobal WHERE Clave = @Clave AND (AreaID = @AreaID OR AreaID = 'ADMIN') ORDER BY CASE WHEN AreaID = @AreaID THEN 1 ELSE 2 END ASC`);

                    let metrosPorBulto = 60;
                    if (configRes.recordset.length > 0) metrosPorBulto = parseFloat(configRes.recordset[0].Valor) || 60;

                    const metrosRes = await pool.request()
                        .input('OID', sql.Int, ordenId)
                        .query(`SELECT SUM(ISNULL(Copias, 1) * ISNULL(Metros, 0)) as TotalMetos FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo IN ('OK', 'Finalizado')`);

                    const totalMetros = metrosRes.recordset[0].TotalMetos || 0;
                    if (totalMetros > 0) totalBultos = Math.ceil(totalMetros / metrosPorBulto);
                    else totalBultos = 1;
                } catch (e) {
                    totalBultos = 1;
                }
            }

            // --- EXTRACCION DE PRECIO Y QR DE DB (NUEVA LOGICA UNIFICADA) ---
            let importeTotalStr = '0.00';
            let targetCurrency = 'UYU';
            let dbQrString = null;
            let dbDetalleCostos = null;
            let dbPerfilesPrecio = null;

            try {
                // Buscamos en PedidosCobranza ya que guarda la fuente de la verdad
                const pRes = await pool.request().input('Doc', sql.NVarChar, o.NoDocERP || '').query("SELECT MontoTotal, Moneda, QR_String, DetalleCostos, PerfilesPrecio FROM PedidosCobranza WHERE NoDocERP = @Doc");
                if (pRes.recordset.length > 0) {
                    importeTotalStr = Number(pRes.recordset[0].MontoTotal || 0).toFixed(2);
                    targetCurrency = pRes.recordset[0].Moneda || 'UYU';
                    dbQrString = pRes.recordset[0].QR_String;
                    dbDetalleCostos = pRes.recordset[0].DetalleCostos;
                    dbPerfilesPrecio = pRes.recordset[0].PerfilesPrecio;
                } else if (o.CostoTotal) {
                    importeTotalStr = Number(o.CostoTotal).toFixed(2);
                }
            } catch (ignore) {
                if (o.CostoTotal) importeTotalStr = Number(o.CostoTotal).toFixed(2);
            }

            // Validar costo > 0, EXCEPTO para órdenes de Reposición o Prepago.
            // En Reposición o Prepago el $0 es intencional, se permite imprimir igual.
            const codOrd = (o.CodigoOrden || '').trim().toUpperCase();
            const prioridad = (o.Prioridad || '').trim().toUpperCase();
            const esReposicion = codOrd.includes('-R') || prioridad === 'REPOSICIÓN' || prioridad === 'REPOSICION';
            const esPrepago = (dbPerfilesPrecio && dbPerfilesPrecio.toLowerCase().includes('prepago')) || (dbDetalleCostos && dbDetalleCostos.toLowerCase().includes('prepago'));
            
            if (!esReposicion && !esPrepago && (importeTotalStr === '0.00' || importeTotalStr === '0' || Number(importeTotalStr) <= 0)) {
                return { success: false, error: 'Calculo Frio: La orden no cuenta con un costo válido (Es $0). Vaya a Edit Cotización e ingrese un valor, o asegúrese de aplicar prepago o código R para habilitar $0.' };
            }

            // --- GENERACIÓN / RESCATE DEL STRING QR ($*) CLASICO ---
            let finalQrStringToSave = dbQrString;

            // Si la base de datos es antigua y no tiene QR guardado aún, realizamos un fallback/re-armado
            if (!finalQrStringToSave) {
                const baseOrderMatch = o.CodigoOrden ? o.CodigoOrden.match(/^(\d+)/) : null;
                const baseOrderNum = baseOrderMatch ? baseOrderMatch[1] : (o.CodigoOrden || o.OrdenID);

                const qrPedido = baseOrderNum;
                const qrCliente = o.IdClienteReact || '0';
                const qrTrabajo = (o.DescripcionTrabajo || '').replace(/\$\*/g, ' ').trim();
                const isUrgent = (o.Prioridad && (o.Prioridad.toLowerCase().includes('urgente') || o.Prioridad.toLowerCase().includes('alta')));
                const qrUrgencia = isUrgent ? '2' : '1';
                const qrProducto = targetCurrency === 'USD' ? '150' : '82';
                const qrCantidad = o.Magnitud || '1';
                
                const SEP = '$*';
                finalQrStringToSave = `${qrPedido}${SEP}${qrCliente}${SEP}${qrTrabajo}${SEP}${qrUrgencia}${SEP}${qrProducto}${SEP}${qrCantidad}${SEP}${importeTotalStr}`;
            }

            // QR Simplificado para Control Interno (Fallback/Logística)
            const qrSimple = `ORD-${o.OrdenID}`;

            // --- TRANSACCION DB ---
            transaction = new sql.Transaction(pool);
            await transaction.begin();

            // --- VALIDACION: NoDocERP (Requisito para Logística/React) ---
            if (!o.NoDocERP) {
                await transaction.rollback();
                return { success: false, error: 'No se pueden generar etiquetas: El pedido no tiene asignado un NoDocERP. Sincronice con el ERP primero.' };
            }

            // ══════════════════════════════════════════════════════════════
            // LOG FORENSE: etiquetas que van a ser ELIMINADAS
            // ══════════════════════════════════════════════════════════════
            try {
                const preDeleteRes = await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .query('SELECT EtiquetaID, CodigoEtiqueta, NumeroBulto, TotalBultos, FechaGeneracion FROM Etiquetas WHERE OrdenID = @OID');
                const preDelete = preDeleteRes.recordset;
                const callerStack = new Error().stack
                    .split('\n')
                    .slice(2, 6) // primeras 4 líneas del stack (excluye Error itself)
                    .map(l => l.trim())
                    .join(' | ');

                logger.warn(
                    `[LabelService:FORENSIC] ⚠️  ANTES DEL DELETE — OrdenID=${ordenId} | Etiquetas existentes: ${preDelete.length}` +
                    (preDelete.length > 0
                        ? ' | IDs: ' + preDelete.map(e => `${e.CodigoEtiqueta}(ID=${e.EtiquetaID})`).join(', ')
                        : ' | (ninguna)') +
                    ` | Caller: ${callerStack}`
                );
            } catch (logErr) {
                logger.warn(`[LabelService:FORENSIC] Error en log pre-delete: ${logErr.message}`);
            }

            // Limpieza de datos logísticos previos
            try {
                await new sql.Request(transaction).input('OID', sql.Int, ordenId).query(`
                    DELETE M FROM MovimientosLogistica M
                    INNER JOIN Logistica_Bultos LB ON M.CodigoBulto = LB.CodigoEtiqueta
                    INNER JOIN Etiquetas E ON LB.CodigoEtiqueta = E.CodigoEtiqueta
                    WHERE E.OrdenID = @OID
                `);
                await new sql.Request(transaction).input('OID', sql.Int, ordenId).query(`
                    DELETE LE FROM Logistica_EnvioItems LE
                    INNER JOIN Logistica_Bultos LB ON LE.BultoID = LB.BultoID
                    WHERE LB.OrdenID = @OID
                `);
            } catch (ign) { }

            await new sql.Request(transaction).input('OID', sql.Int, ordenId).query("DELETE FROM Logistica_Bultos WHERE OrdenID = @OID");
            await new sql.Request(transaction).input('OID', sql.Int, ordenId).query("DELETE FROM Etiquetas WHERE OrdenID = @OID");
            logger.warn(`[LabelService:FORENSIC] 🗑️  DELETE ejecutado — OrdenID=${ordenId}`);

            // Insertar Nuevos Bultos/Etiquetas
            const proximoServicio = (o.ProximoServicio || 'DEPOSITO').trim().toUpperCase();
            const esUltimoServicio = proximoServicio.includes('DEPOSITO') || proximoServicio === '';
            const tipoBulto = esUltimoServicio ? 'PROD_TERMINADO' : 'EN_PROCESO';

            for (let i = 1; i <= totalBultos; i++) {
                // Opcional: Para debugging, pasemos a Etiquetas el CodigoQR con formato legacy (finalQrStringToSave)
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .input('Num', sql.Int, i)
                    .input('Tot', sql.Int, totalBultos)
                    .input('QR', sql.NVarChar(sql.MAX), finalQrStringToSave)
                    .input('User', sql.VarChar(100), userName)
                    .input('Area', sql.VarChar(20), o.AreaID || 'GEN')
                    .input('UID', sql.Int, userId)
                    .input('Job', sql.NVarChar(255), (o.DescripcionTrabajo || '').substring(0, 255))
                    .input('Tipo', sql.VarChar(50), tipoBulto)
                    .input('DC', sql.NVarChar(sql.MAX), dbDetalleCostos)
                    .input('PP', sql.NVarChar(sql.MAX), dbPerfilesPrecio)
                    .input('Doc', sql.VarChar(50), (o.NoDocERP || o.CodigoOrden || String(ordenId)).trim())
                    .query(`
                        INSERT INTO Etiquetas(OrdenID, NumeroBulto, TotalBultos, CodigoQR, FechaGeneracion, Usuario, CreadoPor, DetalleCostos, PerfilesPrecio)
                        VALUES(@OID, @Num, @Tot, @QR, GETDATE(), @User, @User, @DC, @PP);

                        DECLARE @NewID INT = SCOPE_IDENTITY();
                        -- Formato: (NumeroDeOrden/ERP)/B(IdBulto)
                        DECLARE @Code NVARCHAR(50) = LTRIM(RTRIM(@Doc)) + '/B' + CAST(@NewID AS NVARCHAR);
                        
                        UPDATE Etiquetas SET CodigoEtiqueta = @Code WHERE EtiquetaID = @NewID;

                        INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                        VALUES (@Code, @Tipo, @OID, @Job, @Area, 'EN_STOCK', @UID);
                    `);
            }

            // --- AUTO-CONSUME BULTO PADRE ---
            // Cuando un área genera su etiqueta (termina de procesar), se auto-consume el bulto de materia prima (ej. tela de SB)
            // que llegó a esta área y que pertenece a la misma orden (mismo NoDocERP).
            try {
                const consumedRes = await new sql.Request(transaction)
                    .input('Area', sql.VarChar(20), o.AreaID || 'GEN')
                    .input('Doc', sql.VarChar(50), (o.NoDocERP || o.CodigoOrden || '').trim())
                    .input('OID', sql.Int, ordenId)
                    .query(`
                        UPDATE Logistica_Bultos 
                        SET Estado = 'CONSUMIDO'
                        OUTPUT INSERTED.CodigoEtiqueta, INSERTED.UbicacionActual
                        WHERE UbicacionActual = @Area 
                          AND Estado = 'EN_STOCK'
                          AND OrdenID != @OID
                          AND OrdenID IN (SELECT OrdenID FROM Ordenes WHERE NoDocERP = @Doc OR CodigoOrden = @Doc)
                    `);

                // Insertar trazabilidad del consumo
                for (const c of consumedRes.recordset) {
                    await new sql.Request(transaction)
                        .input('CodigoBulto', sql.NVarChar, c.CodigoEtiqueta)
                        .input('TipoMovimiento', sql.NVarChar, 'CONSUMO')
                        .input('UsuarioID', sql.Int, userId)
                        .input('Ubicacion', sql.NVarChar, c.UbicacionActual)
                        .input('Observaciones', sql.NVarChar(sql.MAX), `Consumo auto por generación de bulto en ${o.AreaID}`)
                        .query(`
                            INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, UsuarioID, UbicacionDestino, Observaciones) 
                            VALUES (@CodigoBulto, @TipoMovimiento, @UsuarioID, @Ubicacion, @Observaciones)
                        `);
                }
            } catch (autoErr) {
                logger.error(`[LabelService] Error auto-consumiendo bultos padres:`, autoErr);
            }

            await transaction.commit();

            // ══════════════════════════════════════════════════════════════
            // LOG FORENSE: etiquetas recién creadas
            // ══════════════════════════════════════════════════════════════
            try {
                const postInsertRes = await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .query('SELECT EtiquetaID, CodigoEtiqueta, NumeroBulto, TotalBultos FROM Etiquetas WHERE OrdenID = @OID');
                const postInsert = postInsertRes.recordset;
                logger.warn(
                    `[LabelService:FORENSIC] ✅  DESPUÉS DEL INSERT — OrdenID=${ordenId} | Etiquetas nuevas: ${postInsert.length}` +
                    (postInsert.length > 0
                        ? ' | IDs: ' + postInsert.map(e => `${e.CodigoEtiqueta}(ID=${e.EtiquetaID})`).join(', ')
                        : '')
                );
            } catch (logErr) {
                logger.warn(`[LabelService:FORENSIC] Error en log post-insert: ${logErr.message}`);
            }

            logger.info(`[LabelService] Exito. ${totalBultos} bultos generados para Orden ${ordenId}.`);

            return { success: true, totalBultos };

        } catch (err) {
            if (transaction) await transaction.rollback();
            throw err;
        }
    }
    /**
     * Agrega UN bulto adicional a una orden sin regenerar los existentes.
     * Preserva los CodigoEtiqueta ya impresos. Usa UPDLOCK para evitar race conditions.
     */
    static async addOneBulto(ordenId, userId, userName) {
        let transaction;
        try {
            const pool = await getPool();

            // Obtener info de la orden
            const orderRes = await pool.request()
                .input('OID', sql.Int, ordenId)
                .query(`SELECT * FROM Ordenes WHERE OrdenID = @OID`);

            if (orderRes.recordset.length === 0) {
                return { success: false, error: 'Orden no encontrada' };
            }
            const o = orderRes.recordset[0];

            if (!o.NoDocERP) {
                return { success: false, error: 'La orden no tiene NoDocERP asignado. Sincronice con el ERP primero.' };
            }

            transaction = new sql.Transaction(pool);
            await transaction.begin();

            // UPDLOCK: bloquea durante el SELECT para evitar race condition
            const cntRes = await new sql.Request(transaction)
                .input('OID', sql.Int, ordenId)
                .query(`SELECT COUNT(*) as cnt FROM Etiquetas WITH (UPDLOCK) WHERE OrdenID = @OID`);

            const nuevoNumero = (cntRes.recordset[0]?.cnt || 0) + 1;

            // Obtener datos para el nuevo bulto (QR, tipo, etc. de etiquetas existentes)
            const existingRes = await new sql.Request(transaction)
                .input('OID', sql.Int, ordenId)
                .query(`SELECT TOP 1 CodigoQR, DetalleCostos, PerfilesPrecio FROM Etiquetas WHERE OrdenID = @OID`);

            const existingData = existingRes.recordset[0] || {};
            const proximoServicio = (o.ProximoServicio || 'DEPOSITO').trim().toUpperCase();
            const esUltimoServicio = proximoServicio.includes('DEPOSITO') || proximoServicio === '';
            const tipoBulto = esUltimoServicio ? 'PROD_TERMINADO' : 'EN_PROCESO';
            const doc = (o.NoDocERP || o.CodigoOrden || String(ordenId)).trim();

            // Insertar el nuevo bulto
            await new sql.Request(transaction)
                .input('OID', sql.Int, ordenId)
                .input('Num', sql.Int, nuevoNumero)
                .input('Tot', sql.Int, nuevoNumero)
                .input('QR', sql.NVarChar(sql.MAX), existingData.CodigoQR || '')
                .input('User', sql.VarChar(100), userName)
                .input('Area', sql.VarChar(20), o.AreaID || 'GEN')
                .input('UID', sql.Int, userId)
                .input('Job', sql.NVarChar(255), (o.DescripcionTrabajo || '').substring(0, 255))
                .input('Tipo', sql.VarChar(50), tipoBulto)
                .input('DC', sql.NVarChar(sql.MAX), existingData.DetalleCostos || null)
                .input('PP', sql.NVarChar(sql.MAX), existingData.PerfilesPrecio || null)
                .input('Doc', sql.VarChar(50), doc)
                .query(`
                    INSERT INTO Etiquetas(OrdenID, NumeroBulto, TotalBultos, CodigoQR, FechaGeneracion, Usuario, CreadoPor, DetalleCostos, PerfilesPrecio)
                    VALUES(@OID, @Num, @Tot, @QR, GETDATE(), @User, @User, @DC, @PP);

                    DECLARE @NewID INT = SCOPE_IDENTITY();
                    DECLARE @Code NVARCHAR(50) = LTRIM(RTRIM(@Doc)) + '/B' + CAST(@NewID AS NVARCHAR);
                    
                    UPDATE Etiquetas SET CodigoEtiqueta = @Code WHERE EtiquetaID = @NewID;

                    INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                    VALUES (@Code, @Tipo, @OID, @Job, @Area, 'EN_STOCK', @UID);
                `);

            // Actualizar TotalBultos en TODOS los bultos de la orden
            await new sql.Request(transaction)
                .input('OID', sql.Int, ordenId)
                .input('Tot', sql.Int, nuevoNumero)
                .query(`UPDATE Etiquetas SET TotalBultos = @Tot WHERE OrdenID = @OID`);

            await transaction.commit();
            logger.info(`[LabelService] addOneBulto OK. Orden ${ordenId} ahora tiene ${nuevoNumero} bulto(s).`);

            return { success: true, totalBultos: nuevoNumero };

        } catch (err) {
            if (transaction) try { await transaction.rollback(); } catch (e) {}
            throw err;
        }
    }
    /**
     * Recalcula los contadores (TotalBultos) de todas las etiquetas existentes de una orden.
     * NO borra ni crea etiquetas. NO cambia NumeroBulto ni CodigoEtiqueta.
     * Solo actualiza TotalBultos = COUNT(*) actual para que los contadores queden consistentes.
     */
    static async recalcularContadores(ordenId) {
        const pool = await getPool();
        const cntRes = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`SELECT COUNT(*) as cnt FROM Etiquetas WHERE OrdenID = @OID`);

        const total = cntRes.recordset[0]?.cnt || 0;

        if (total === 0) {
            return { success: false, error: 'La orden no tiene etiquetas. Use Regenerar para crearlas.' };
        }

        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Tot', sql.Int, total)
            .query(`UPDATE Etiquetas SET TotalBultos = @Tot WHERE OrdenID = @OID`);

        logger.info(`[LabelService] recalcularContadores OK. Orden ${ordenId}: ${total} bulto(s), TotalBultos actualizado.`);
        return { success: true, totalBultos: total };
    }
}

module.exports = LabelGenerationService;
