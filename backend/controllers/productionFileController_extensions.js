const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

/**
 * 7. Buscar Órdenes Entregadas/Finalizadas para Reposición (Atención al Cliente)
 */
const getCompletedOrdersForReplacement = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 3) return res.json([]);

        const pool = await getPool();
        const request = pool.request();

        let sqlQuery = `
            SELECT TOP 20 
                OrdenID, CodigoOrden, Cliente, FechaIngreso, FechaEstimadaEntrega, 
                Estado, Material, DescripcionTrabajo, NoDocERP
            FROM Ordenes WITH (NOLOCK)
            WHERE (Estado IN ('ENTREGADO', 'FINALIZADO', 'DESPACHADO') OR ISNULL(EstadoenArea,'') IN ('Pronto', 'PRONTO'))
            AND (
                CodigoOrden LIKE @Search 
                OR Cliente LIKE @Search 
                OR CAST(OrdenID AS VARCHAR) = @Exact
                OR NoDocERP LIKE @Search
            )
            ORDER BY OrdenID DESC
        `;

        request.input('Search', sql.NVarChar, `%${q}%`);
        request.input('Exact', sql.NVarChar, q);

        const result = await request.query(sqlQuery);
        res.json(result.recordset);

    } catch (error) {
        logger.error("Error getCompletedOrdersForReplacement:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * 8. Crear Orden de Reposición (Batch)
 * Recibe lista de archivos a reponer de una orden ya terminada.
 * Validaciones: metros ≤ metros originales, copias ≤ copias originales.
 * Observación de archivo: incluye máquina y lote de la impresión original.
 */
const createCustomerReplacementOrder = async (req, res) => {
    const { originalOrderId, files, globalObservation, userId } = req.body;
    let transaction;

    try {
        if (!originalOrderId || !files || files.length === 0) {
            return res.status(400).json({ error: "Datos incompletos" });
        }

        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 1. Obtener Datos Orden Original
        const ordRes = await new sql.Request(transaction)
            .input('ID', sql.Int, originalOrderId)
            .query(`
                SELECT O.*, 
                       R.Nombre as NombreRollo,
                       CE.Nombre as NombreMaquina
                FROM Ordenes O
                LEFT JOIN Rollos R ON O.RolloID = R.RolloID
                LEFT JOIN ConfigEquipos CE ON ISNULL(O.MaquinaID, R.MaquinaID) = CE.EquipoID
                WHERE O.OrdenID = @ID
            `);

        if (ordRes.recordset.length === 0) throw new Error("Orden original no encontrada");
        const originalOrder = ordRes.recordset[0];

        // 2. Obtener datos originales de cada archivo para validar límites
        const fileIds = files.map(f => parseInt(f.id)).filter(id => !isNaN(id));
        const placeholders = fileIds.map((_, i) => `@FID${i}`).join(',');
        const origFilesReq = new sql.Request(transaction);
        fileIds.forEach((id, i) => origFilesReq.input(`FID${i}`, sql.Int, id));
        const origFilesRes = await origFilesReq.query(
            `SELECT ArchivoID, Metros as MetrosOrig, Copias as CopiasOrig FROM dbo.ArchivosOrden WHERE ArchivoID IN (${placeholders})`
        );
        const origFilesMap = {};
        origFilesRes.recordset.forEach(r => { origFilesMap[r.ArchivoID] = r; });

        // 3. Validar límites (metros y copias) antes de proceder
        for (const file of files) {
            const orig = origFilesMap[parseInt(file.id)];
            if (!orig) throw new Error(`Archivo ID ${file.id} no encontrado en la orden original`);

            const metersReq = parseFloat(file.meters);
            const copiesReq = parseInt(file.copies) || parseInt(orig.CopiasOrig);
            const metersOrig = parseFloat(orig.MetrosOrig);
            const copiesOrig = parseInt(orig.CopiasOrig);

            if (metersReq > metersOrig) {
                throw new Error(
                    `No se puede reponer más metros de los originales. Archivo ID ${file.id}: solicitado ${metersReq}m, máximo permitido ${metersOrig}m`
                );
            }
            if (copiesReq > copiesOrig) {
                throw new Error(
                    `No se puede reponer más copias de las originales. Archivo ID ${file.id}: solicitado ${copiesReq} copias, máximo permitido ${copiesOrig} copias`
                );
            }
        }

        // 4. Crear Nueva Orden de Reposición
        // Generar codigo con sufijo -R + número corto para unicidad
        const suffix = `-R${Math.floor(Math.random() * 1000)}`;
        const newCode = `${originalOrder.CodigoOrden} ${suffix}`;

        const insertOrderResult = await new sql.Request(transaction)
            .input('NewCode', sql.NVarChar, newCode)
            .input('OldID', sql.Int, originalOrderId)
            .input('GlobalObs', sql.NVarChar, globalObservation || 'Reposición Cliente')
            .query(`
                INSERT INTO dbo.Ordenes(
                    CodigoOrden, Cliente, FechaIngreso, FechaEstimadaEntrega,
                    Material, DescripcionTrabajo, Prioridad,
                    Estado, EstadoenArea, AreaID,
                    Magnitud, IdCabezalERP, ProximoServicio, Observaciones, NoDocERP,
                    FechaEntradaSector, CantidadArchivos, Variante, UnidadMedida, 
                    IDCliente, IDProducto, CodCliente, CodArticulo
                )
                SELECT
                    @NewCode, Cliente, GETDATE(), DATEADD(day, 2, GETDATE()),
                    Material, DescripcionTrabajo, 'URGENTE',
                    'Pendiente', 'Pendiente', AreaID,
                    Magnitud, IdCabezalERP, ProximoServicio, @GlobalObs, NoDocERP,
                    GETDATE(), 0, Variante, UnidadMedida,
                    IDCliente, IDProducto, CodCliente, CodArticulo
                FROM dbo.Ordenes
                WHERE OrdenID = @OldID;
                
                SELECT SCOPE_IDENTITY() as NewID;
             `);

        const newOrderId = insertOrderResult.recordset[0].NewID;

        let totalFiles = 0;

        // 5. Insertar Archivos Seleccionados con validación y obs enriquecida
        for (const file of files) {
            const oldFileId = parseInt(file.id);
            const metersToReprint = parseFloat(file.meters);
            const orig = origFilesMap[oldFileId];
            const copiesToReprint = parseInt(file.copies) || parseInt(orig.CopiasOrig);

            // Construir observación enriquecida con máquina y lote originales
            const maquinaInfo = originalOrder.NombreMaquina ? `Máquina: ${originalOrder.NombreMaquina}` : '';
            const loteInfo = originalOrder.NombreRollo ? `Lote: ${originalOrder.NombreRollo}` : '';
            const contextInfo = [maquinaInfo, loteInfo].filter(Boolean).join(' | ');
            const userObs = (file.obs || '').trim();
            const fullObs = contextInfo
                ? (userObs ? `${userObs} | ${contextInfo}` : contextInfo)
                : (userObs || 'Reposición Cliente');

            await new sql.Request(transaction)
                .input('NewOrderID', sql.Int, newOrderId)
                .input('OldFileID', sql.Int, oldFileId)
                .input('Metros', sql.Decimal(10, 2), metersToReprint)
                .input('Copias', sql.Int, copiesToReprint)
                .input('Obs', sql.NVarChar, fullObs)
                .query(`
                    INSERT INTO dbo.ArchivosOrden(
                        OrdenID, NombreArchivo, RutaAlmacenamiento, Metros, Copias, Ancho, Alto, Material, Observaciones,
                        TipoArchivo, FechaSubida, EstadoArchivo
                    )
                    SELECT 
                        @NewOrderID, NombreArchivo, RutaAlmacenamiento, @Metros, @Copias, Ancho, Alto, Material, @Obs,
                        TipoArchivo, GETDATE(), 'Pendiente'
                    FROM dbo.ArchivosOrden WHERE ArchivoID = @OldFileID
                `);

            totalFiles++;

            // Registrar en FallasProduccion para trazabilidad
            // Observación de falla: descripción del problema (obs del usuario)
            const obsParaFalla = userObs || `Reposición cliente - Orden ${originalOrder.CodigoOrden}`;
            await new sql.Request(transaction)
                .input('OldID', sql.Int, originalOrderId)
                .input('FileID', sql.Int, oldFileId)
                .input('AreaID', sql.VarChar, originalOrder.AreaID || 'General')
                .input('Metros', sql.Decimal(10, 2), metersToReprint)
                .input('ObsFalla', sql.NVarChar, obsParaFalla)
                .query(`
                    INSERT INTO FallasProduccion(OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, Observaciones)
                    VALUES(@OldID, @FileID, @AreaID, GETDATE(), 1, @Metros, @ObsFalla)
                `);
        }

        // Actualizar contador archivos orden nueva
        await new sql.Request(transaction)
            .input('Total', sql.Int, totalFiles)
            .input('ID', sql.Int, newOrderId)
            .query("UPDATE Ordenes SET CantidadArchivos = @Total WHERE OrdenID = @ID");

        await transaction.commit();
        res.json({ success: true, newOrderId, newCode });

    } catch (error) {
        if (transaction) {
            try { await transaction.rollback(); } catch (e) { }
        }
        logger.error("Error createCustomerReplacementOrder:", error);
        res.status(500).json({ error: error.message });
    }
};
