const { getPool, sql } = require('../config/db');
const driveService = require('../services/driveService');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument, PDFName } = require('pdf-lib');
const { construirNombreArchivo, materialParaNombre, usaNombreNuevo } = require('../utils/nombreArchivoOrden');

// /UserUnit de una página pdf-lib (default 1). Los PDF de más de ~5.08m (límite 14400pt)
// traen UserUnit (ej. 10): sin aplicarlo el trabajo se mide N veces más chico.
const getPdfUserUnit = (page) => {
    try {
        const uu = page.node.get(PDFName.of('UserUnit'));
        const n = uu && typeof uu.asNumber === 'function' ? uu.asNumber() : NaN;
        return (Number.isFinite(n) && n > 0) ? n : 1;
    } catch (_) { return 1; }
};
const archiver = require('archiver');
const fileProcessingService = require('../services/fileProcessingService');
const axios = require('axios');
const logger = require('../utils/logger');

// --- HELPERS ---
const pointsToCm = (points) => (points / 72) * 2.54;
const pixelsToCm = (pixels, dpi) => (pixels / dpi) * 2.54;
const cmToM = (cm) => cm / 100;

// Extraer ID de Drive desde URL
const getDriveId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:id=|\/d\/)([\w-]+)/);
    return match ? match[1] : null;
};

// --- 1. OBTENER LISTA ---
exports.getOrdersToMeasure = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();
        let areaFilter = area;
        if (area === 'SUBLIMACION') areaFilter = 'SUB';
        if (area === 'BORDADO') areaFilter = 'BORD';

        const result = await pool.request()
            .input('Area', sql.VarChar(20), areaFilter)
            .query(`
                SELECT 
                    o.OrdenID as id, o.CodigoOrden as code, o.Cliente as client, o.RolloID as rollId, 
                    ISNULL(R.Nombre, 'Lote ' + CAST(o.RolloID AS VARCHAR)) as rollName,
                    ISNULL(o.Material, 'Sin Material') as material, o.Prioridad as priority, o.FechaIngreso,
                    (
                        SELECT 
                            ArchivoID as id, NombreArchivo as name, RutaAlmacenamiento as url,
                            TipoArchivo as type, ISNULL(Copias, 1) as copies, ISNULL(Metros, 0) as confirmed, 
                            Ancho as autoWidth, Alto as autoHeight
                        FROM dbo.ArchivosOrden 
                        WHERE OrdenID = o.OrdenID 
                        FOR JSON PATH
                    ) as files
                FROM dbo.Ordenes o
                LEFT JOIN dbo.Rollos R ON o.RolloID = R.RolloID
                WHERE o.AreaID = @Area AND o.Estado NOT IN ('Entregado', 'Cancelado', 'Finalizado')
                AND EXISTS (SELECT 1 FROM dbo.ArchivosOrden WHERE OrdenID = o.OrdenID)
                ORDER BY o.Prioridad DESC, o.FechaIngreso ASC
            `);

        const data = result.recordset.map(row => ({
            ...row,
            files: (row.files && row.files !== 'null') ? JSON.parse(row.files) : []
        }));
        res.json(data);
    } catch (err) {
        logger.error("❌ Error SQL:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// --- 4. PROCESAMIENTO POR LOTES (DESCARGAR ZIP - OPTIMIZADO STREAMING) ---
exports.processBatch = async (req, res) => {
    const { fileIds } = req.body;

    if (!fileIds || fileIds.length === 0) return res.status(400).send("No files provided");

    try {
        const pool = await getPool();

        // Obtener metadatos
        const filesQuery = await pool.request().query(`
            SELECT 
                AO.ArchivoID, AO.RutaAlmacenamiento, AO.NombreArchivo, AO.Copias, AO.OrdenID,
                O.CodigoOrden, O.Cliente, O.DescripcionTrabajo, O.Material, O.AreaID,
                ibt.Referencia AS PreTelaCliente
            FROM dbo.ArchivosOrden AO
            INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
            LEFT JOIN dbo.InventarioBobinas ibt WITH(NOLOCK) ON ibt.BobinaID = O.BobinaTelaID
            WHERE AO.ArchivoID IN (${fileIds.join(',')})
        `);

        if (filesQuery.recordset.length === 0) return res.status(404).send("Files not found");

        // Configurar ZIP
        res.attachment('archivos_seleccionados.zip');
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', function (err) {
            logger.error("Archiver Error:", err);
            if (!res.headersSent) res.status(500).send({ error: err.message });
        });

        archive.pipe(res);

        const sanitize = (str) => (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();

        for (const file of filesQuery.recordset) {
            try {
                const sourcePath = file.RutaAlmacenamiento || '';

                // Determinar extensión (Sin leer magic bytes para permitir streaming)
                let ext = path.extname(file.NombreArchivo || '').toLowerCase();
                if (!ext || ext.length < 2) {
                    try {
                        const urlObj = new URL(sourcePath);
                        ext = path.extname(urlObj.pathname).toLowerCase();
                    } catch (e) { }
                }
                if (!ext) ext = '.pdf';

                let baseName = file.NombreArchivo;
                if (!baseName || baseName.length < 3) {
                    baseName = (await usaNombreNuevo(file.AreaID))
                        ? construirNombreArchivo({
                            material: materialParaNombre(file.Material, file.PreTelaCliente),
                            codigoOrden: file.CodigoOrden || file.OrdenID.toString(),
                            cliente: file.Cliente,
                            idx: 1,
                            total: 1,
                            copias: file.Copias || 1
                        })
                        : `${sanitize(file.CodigoOrden || file.OrdenID.toString())}_${sanitize(file.Cliente)}_${sanitize(file.DescripcionTrabajo || 'Trabajo')} Archivo 1 de 1 (x${file.Copias || 1} COPIAS)`;
                } else {
                    baseName = sanitize(baseName);
                }

                if (!baseName.toLowerCase().endsWith(ext)) baseName += ext;

                // STREAMING DIRECTO AL ZIP
                if (sourcePath.includes('drive.google.com')) {
                    const driveId = getDriveId(sourcePath);
                    if (driveId) {
                        try {
                            const { stream } = await driveService.getFileStream(driveId);
                            archive.append(stream, { name: baseName });
                        } catch (driveErr) {
                            archive.append(`Error Drive: ${driveErr.message}`, { name: `ERRORES/${file.ArchivoID}_error.txt` });
                        }
                    }
                } else if (sourcePath.startsWith('http')) {
                    const response = await axios({
                        url: sourcePath,
                        method: 'GET',
                        responseType: 'stream',
                        timeout: 600000 // 10 min
                    });
                    archive.append(response.data, { name: baseName });
                } else if (fs.existsSync(sourcePath)) {
                    archive.file(sourcePath, { name: baseName });
                } else {
                    archive.append(`Archivo no encontrado: ${sourcePath}`, { name: `ERRORES/${file.ArchivoID}_404.txt` });
                }

            } catch (err) {
                logger.error(`Error processing file ${file.ArchivoID}:`, err);
                archive.append(`Error: ${err.message}`, { name: `ERRORES/${file.ArchivoID}_ex.txt` });
            }
        }

        archive.finalize();

    } catch (err) {
        logger.error("Error ProcessBatch Zip:", err);
        if (!res.headersSent) res.status(500).send(err.message);
    }
};

// --- 5. PROCESAMIENTO POR ÓRDENES (DESCARGAR EN ESTRUCTURA DE CARPETAS - OPTIMIZADO) ---
exports.processOrdersBatch = async (req, res) => {
    const { orderIds } = req.body;
    const baseDir = process.env.ORDENES_PATH || path.join(__dirname, '..', 'ordenes');
    const results = [];

    if (!orderIds || orderIds.length === 0) return res.status(400).json({ error: "No orders provided" });

    try {
        const pool = await getPool();

        // Obtener archivos
        const filesQuery = await pool.request().query(`
            SELECT 
                AO.ArchivoID, AO.RutaAlmacenamiento, AO.RutaLocal, AO.NombreArchivo, AO.Copias,
                O.OrdenID, O.CodigoOrden, O.Cliente, O.DescripcionTrabajo, O.AreaID, O.Material,
                ibt.Referencia AS PreTelaCliente,
                ISNULL(R.Nombre, 'Lote ' + CAST(O.RolloID as VARCHAR)) as RollName
            FROM dbo.ArchivosOrden AO
            INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
            LEFT JOIN dbo.Rollos R ON O.RolloID = R.RolloID
            LEFT JOIN dbo.InventarioBobinas ibt WITH(NOLOCK) ON ibt.BobinaID = O.BobinaTelaID
            WHERE O.OrdenID IN (${orderIds.join(',')})
        `);

        if (filesQuery.recordset.length === 0) {
            return res.json({ success: true, message: "No se encontraron archivos.", results: [] });
        }

        // Agrupar
        const filesByOrder = {};
        filesQuery.recordset.forEach(f => {
            if (!filesByOrder[f.OrdenID]) filesByOrder[f.OrdenID] = [];
            filesByOrder[f.OrdenID].push(f);
        });

        const filesToProcess = [];
        for (const oId in filesByOrder) {
            const group = filesByOrder[oId];
            group.sort((a, b) => a.ArchivoID - b.ArchivoID);
            group.forEach((f, idx) => {
                f.idxInOrder = idx + 1;
                f.totalInOrder = group.length;
                filesToProcess.push(f);
            });
        }

        const sanitize = (str) => (str || '').replace(/\//g, '-').replace(/[<>:"\\|?*]/g, ' ').trim();

        for (const file of filesToProcess) {
            let log = { id: file.ArchivoID, status: 'OK' };
            try {
                const safeArea = sanitize(file.AreaID || 'GENERAL');
                const safeRoll = sanitize(file.RollName || 'Sin-Rollo');
                const targetDir = path.join(baseDir, safeArea, safeRoll);

                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                // 1. ORIGEN (Descarga Robusta Streaming a Disco)
                const sourcePath = file.RutaAlmacenamiento || '';

                // Determinar Nombre Base Temporal
                let ext = path.extname(file.NombreArchivo || '').toLowerCase() || '.pdf';
                let baseName = (await usaNombreNuevo(file.AreaID))
                    ? construirNombreArchivo({
                        material: materialParaNombre(file.Material, file.PreTelaCliente),
                        codigoOrden: file.CodigoOrden,
                        cliente: file.Cliente,
                        idx: file.idxInOrder,
                        total: file.totalInOrder,
                        copias: file.Copias || 1
                    })
                    : `${file.CodigoOrden}_${sanitize(file.Cliente)}_${sanitize(file.DescripcionTrabajo)} Archivo ${file.idxInOrder} de ${file.totalInOrder}`;
                let fileName = baseName + ext;
                let destPath = path.join(targetDir, fileName);

                // --- STREAMING DOWNLOAD TO DISK (Avoid RAM) ---
                const writer = fs.createWriteStream(destPath);

                if (sourcePath.includes('drive.google.com')) {
                    const driveId = getDriveId(sourcePath);
                    const { stream } = await driveService.getFileStream(driveId);
                    stream.pipe(writer);
                } else if (sourcePath.startsWith('http')) {
                    const response = await axios({
                        url: sourcePath,
                        method: 'GET',
                        responseType: 'stream',
                        timeout: 300000
                    });
                    response.data.pipe(writer);
                } else if (fs.existsSync(sourcePath)) {
                    // Local Copy
                    fs.copyFileSync(sourcePath, destPath);
                    writer.close(); // Not used
                }

                // Wait for finish if stream
                if (sourcePath.startsWith('http') || sourcePath.includes('drive')) {
                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });
                }

                log.savedTo = destPath;

                // 2. MEDICIÓN (Optimizada)
                let widthM = 0;
                let heightM = 0;
                try {
                    // Check magic bytes from Disk (Only 4 bytes)
                    const fd = fs.openSync(destPath, 'r');
                    const magicBuf = Buffer.alloc(4);
                    fs.readSync(fd, magicBuf, 0, 4, 0);
                    fs.closeSync(fd);
                    const magic = magicBuf.toString('ascii');

                    const isPdf = ext === '.pdf' || magic === '%PDF';

                    if (isPdf) {
                        // PDF requires loading, but we try-catch to avoid crash
                        // If file > 500MB, skip measurement?
                        const stats = fs.statSync(destPath);
                        if (stats.size > 500 * 1024 * 1024) {
                            logger.warn("Skipping measurement for huge PDF:", stats.size);
                        } else {
                            const pdfBuf = fs.readFileSync(destPath);
                            const pdfDoc = await PDFDocument.load(pdfBuf, { updateMetadata: false });
                            const pages = pdfDoc.getPages();
                            if (pages.length > 0) {
                                const { width, height } = pages[0].getSize();
                                const uu = getPdfUserUnit(pages[0]);
                                widthM = cmToM(pointsToCm(width * uu));
                                heightM = cmToM(pointsToCm(height * uu));
                            }
                        }
                    } else {
                        // Image: Use Sharp with File Path (Streaming)
                        const metadata = await sharp(destPath).metadata(); // Handles file path
                        const density = metadata.density || 72;
                        widthM = cmToM(pixelsToCm(metadata.width, density));
                        heightM = cmToM(pixelsToCm(metadata.height, density));
                    }
                } catch (measureErr) {
                    log.measureError = measureErr.message;
                }

                log.width = parseFloat(widthM.toFixed(2));
                log.height = parseFloat(heightM.toFixed(2));

                // 3. UPDATE BD
                // ... Update Logic Same as Before ...
                if (log.width > 0) {
                    await new sql.Request(pool)
                        .input('ID', sql.Int, file.ArchivoID)
                        .input('M', sql.Decimal(10, 2), log.height)
                        .input('W', sql.Decimal(10, 2), log.width)
                        .input('H', sql.Decimal(10, 2), log.height)
                        .input('RL', sql.VarChar(500), destPath)
                        .input('NA', sql.VarChar(255), fileName)
                        .query(`UPDATE dbo.ArchivosOrden SET Metros=@M, Ancho=@W, Alto=@H, MedidaConfirmada=1, RutaLocal=@RL, NombreArchivo=@NA WHERE ArchivoID=@ID`);
                } else {
                    await new sql.Request(pool)
                        .input('ID', sql.Int, file.ArchivoID)
                        .input('RL', sql.VarChar(500), destPath)
                        .input('NA', sql.VarChar(255), fileName)
                        .query(`UPDATE dbo.ArchivosOrden SET RutaLocal=@RL, NombreArchivo=@NA WHERE ArchivoID=@ID`);
                }

            } catch (err) {
                logger.error(`ERROR FILE ${file.ArchivoID}:`, err);
                log.status = 'ERROR';
                log.error = err.message;
            }
            results.push(log);
        }

        res.json({ success: true, results });

    } catch (err) {
        logger.error("Error Orders Batch Process:", err);
        res.status(500).json({ error: err.message });
    }
};

// --- 2. MEDIR ARCHIVOS (AHORA CON SOPORTE PARA DRIVE) ---
exports.measureFiles = async (req, res) => {
    const { fileIds } = req.body;
    const results = [];

    try {
        const pool = await getPool();
        if (!fileIds || fileIds.length === 0) return res.json({ success: true, results: [] });

        const filesQuery = await pool.request().query(`
            SELECT ArchivoID, RutaAlmacenamiento, TipoArchivo 
            FROM dbo.ArchivosOrden 
            WHERE ArchivoID IN (${fileIds.join(',')})
        `);

        for (const file of filesQuery.recordset) {
            const filePath = file.RutaAlmacenamiento || '';
            let fileBuffer = null;

            try {
                if (filePath.includes('drive.google.com')) {
                    const driveId = getDriveId(filePath);
                    if (!driveId) throw new Error('Link de Drive inválido');

                    const { stream } = await driveService.getFileStream(driveId);
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    fileBuffer = Buffer.concat(chunks);
                } else if (filePath.startsWith('http')) {
                    const response = await fetch(filePath);
                    if (!response.ok) throw new Error('Falló descarga Web');
                    const arrayBuffer = await response.arrayBuffer();
                    fileBuffer = Buffer.from(arrayBuffer);
                } else {
                    if (!fs.existsSync(filePath)) {
                        results.push({ id: file.ArchivoID, width: 0, height: 0, area: 0, error: 'No encontrado en disco local' });
                        continue;
                    }
                    fileBuffer = fs.readFileSync(filePath);
                }

                let widthCm = 0;
                let heightCm = 0;
                const isPdf = filePath.toLowerCase().endsWith('.pdf') || file.TipoArchivo === 'pdf' || (fileBuffer && fileBuffer.slice(0, 4).toString() === '%PDF');

                if (isPdf) {
                    const pdfDoc = await PDFDocument.load(fileBuffer, { updateMetadata: false });
                    const pages = pdfDoc.getPages();
                    if (pages.length > 0) {
                        const { width, height } = pages[0].getSize();
                        const uu = getPdfUserUnit(pages[0]);
                        widthCm = pointsToCm(width * uu);
                        heightCm = pointsToCm(height * uu);
                    }
                } else {
                    const metadata = await sharp(fileBuffer).metadata();
                    const density = metadata.density || 72;
                    widthCm = pixelsToCm(metadata.width, density);
                    heightCm = pixelsToCm(metadata.height, density);
                }

                const widthM = cmToM(widthCm);
                const heightM = cmToM(heightCm);
                const areaM2 = widthM * heightM;

                results.push({
                    id: file.ArchivoID,
                    width: parseFloat(widthM.toFixed(2)),
                    height: parseFloat(heightM.toFixed(2)),
                    area: parseFloat(areaM2.toFixed(4))
                });

            } catch (error) {
                logger.error(`❌ Error midiendo archivo ${file.ArchivoID}:`, error.message);
                results.push({ id: file.ArchivoID, width: 0, height: 0, area: 0, error: 'Error al leer/descargar archivo' });
            }
        }
        res.json({ success: true, results });
    } catch (err) {
        logger.error("Error general measureFiles:", err);
        res.status(500).json({ error: "Error interno medidor." });
    }
};

// --- 3. GUARDAR RESULTADOS ---
const { registrarAuditoria, registrarHistorialOrden } = require('../services/trackingService');

exports.saveMeasurements = async (req, res) => {
    logger.info("🛠️ SAVE MEASUREMENTS:", req.body);
    const { measurements, userId } = req.body;
    const currentUserId = userId || 1;
    const userIp = req.ip || req.connection.remoteAddress || '';

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const affectedOrders = new Set();
            for (const m of measurements) {
                const fileInfo = await new sql.Request(transaction)
                    .input('FID', sql.Int, m.id)
                    .query("SELECT OrdenID FROM dbo.ArchivosOrden WHERE ArchivoID = @FID");

                if (fileInfo.recordset[0]) affectedOrders.add(fileInfo.recordset[0].OrdenID);

                await new sql.Request(transaction)
                    .input('ID', sql.Int, m.id)
                    .input('MetrosVal', sql.Decimal(10, 2), m.confirmed)
                    .input('W', sql.Decimal(10, 2), m.width || 0)
                    .input('H', sql.Decimal(10, 2), m.height || 0)
                    .query(`UPDATE dbo.ArchivosOrden SET Metros = @MetrosVal, Ancho = @W, Alto = @H, MedidaConfirmada = 1 WHERE ArchivoID = @ID`);
            }

            for (const orderId of affectedOrders) {
                const orderData = await new sql.Request(transaction)
                    .input('OID', sql.Int, orderId)
                    .query("SELECT Estado FROM dbo.Ordenes WHERE OrdenID = @OID");
                const currentStatus = orderData.recordset[0]?.Estado || 'Pendiente';

                const calcRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, orderId)
                    .query(`SELECT SUM(ISNULL(Copias, 1) * ISNULL(Metros, 0)) as Total FROM dbo.ArchivosOrden WHERE OrdenID = @OID`);
                const newTotal = calcRes.recordset[0].Total || 0;

                // TPU afuera: su Magnitud es la CANTIDAD PEDIDA en unidades, no metros de archivos.
                // Sus archivos son las capas del arte y el boceto no tiene metros, así que este
                // recálculo le dejaría la cantidad en 0.00.
                await new sql.Request(transaction)
                    .input('OID', sql.Int, orderId)
                    .input('Mag', sql.VarChar(50), newTotal.toFixed(2))
                    .query(`UPDATE dbo.Ordenes SET Magnitud = @Mag
                            WHERE OrdenID = @OID AND UPPER(LTRIM(RTRIM(ISNULL(AreaID, '')))) <> 'TPU'`);

                await registrarHistorialOrden(transaction, orderId, currentStatus, currentUserId, `Medición actualizada. Nueva Magnitud: ${newTotal.toFixed(2)}m`);
            }

            await registrarAuditoria(transaction, currentUserId, 'MEDICION_FILES', `Actualizados ${measurements.length} archivos`, userIp);
            await transaction.commit();
            res.json({ success: true });
        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }
    } catch (err) {
        logger.error("Error guardando medidas:", err);
        res.status(500).json({ error: err.message });
    }
};

// --- 5. NUEVA FUNCIÓN: DESCARGAR ZIP AL CLIENTE (STREAMING OPTIMIZED) ---
exports.downloadOrdersZip = async (req, res) => {
    const { orderIds, clientId } = req.body;

    if (!orderIds || orderIds.length === 0) return res.status(400).send("No se recibieron IDs de órdenes");

    try {
        const pool = await getPool();

        // 1. Obtener Metadatos de Archivos
        const filesQuery = await pool.request().query(`
            SELECT
                AO.ArchivoID, AO.RutaAlmacenamiento, AO.RutaLocal, AO.NombreArchivo, AO.Copias,
                O.OrdenID, O.CodigoOrden, O.Cliente, O.DescripcionTrabajo, O.AreaID, O.Material, O.NoDocERP,
                ibt.Referencia AS PreTelaCliente,
                ISNULL(R.Nombre, 'Lote ' + CAST(O.RolloID as VARCHAR)) as RollName
            FROM dbo.ArchivosOrden AO
            INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
            LEFT JOIN dbo.Rollos R ON O.RolloID = R.RolloID
            LEFT JOIN dbo.InventarioBobinas ibt WITH(NOLOCK) ON ibt.BobinaID = O.BobinaTelaID
            WHERE O.OrdenID IN (${orderIds.join(',')})
        `);

        if (filesQuery.recordset.length === 0) return res.status(404).send("No se encontraron archivos para las órdenes seleccionadas");

        // Configurar Respuesta Zip
        res.attachment('ordenes_descarga.zip');
        
        // Deshabilitar el timeout del socket para esta conexión de larga duración.
        // Sin esto, Node.js puede cortar la conexión silenciosa si el primer archivo
        // demora más que el keep-alive timeout por defecto (~5s).
        req.socket.setTimeout(0);
        req.socket.setNoDelay(true);
        req.socket.setKeepAlive(true);

        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', function (err) {
            logger.error("Archiver Error:", err);
            if (!res.headersSent) res.status(500).send({ error: err.message });
        });

        archive.pipe(res);
        // Enviar los headers HTTP inmediatamente para que el cliente sepa que la
        // descarga comenzó y no corte por timeout antes de recibir el primer byte.
        res.flushHeaders();

        // Helper sanitizar
        const sanitize = (str) => (str || '').replace(/\//g, '-').replace(/[<>:"\\|?*]/g, ' ').trim();

        // Lógica de Descarga y Procesamiento
        const filesByOrder = {};
        filesQuery.recordset.forEach(f => {
            if (!filesByOrder[f.OrdenID]) filesByOrder[f.OrdenID] = [];
            filesByOrder[f.OrdenID].push(f);
        });
        const filesToProcess = [];
        for (const oId in filesByOrder) {
            const group = filesByOrder[oId];
            group.sort((a, b) => a.ArchivoID - b.ArchivoID);
            group.forEach((f, idx) => {
                f.idxInOrder = idx + 1;
                f.totalInOrder = group.length;
                filesToProcess.push(f);
            });
        }

        const io = req.app.get('socketio');
        let processedCount = 0;

        for (const file of filesToProcess) {
            try {
                processedCount++;
                if (io && clientId) {
                    io.to(clientId).emit('zip:progress', {
                        currentFile: processedCount,
                        totalFiles: filesToProcess.length,
                        fileName: file.NombreArchivo
                    });
                }
                // Determine Extension (Optimistic)
                const sourcePath = file.RutaAlmacenamiento || '';
                let ext = path.extname(file.NombreArchivo || '').toLowerCase();
                if (!ext) ext = path.extname(sourcePath).split('?')[0].toLowerCase();
                if (!ext) ext = '.pdf';

                let finalName = "";
                if (file.NombreArchivo && file.NombreArchivo.length > 10) {
                    finalName = sanitize(file.NombreArchivo);
                } else {
                    finalName = (await usaNombreNuevo(file.AreaID))
                        ? construirNombreArchivo({
                            material: materialParaNombre(file.Material, file.PreTelaCliente),
                            codigoOrden: file.CodigoOrden,
                            cliente: file.Cliente,
                            idx: file.idxInOrder,
                            total: file.totalInOrder,
                            copias: file.Copias || 1
                        })
                        : `${file.CodigoOrden}_${sanitize(file.Cliente)}_${sanitize(file.DescripcionTrabajo)} Archivo ${file.idxInOrder} de ${file.totalInOrder} (x${file.Copias || 1} COPIAS)`;
                }
                if (!finalName.toLowerCase().endsWith(ext)) finalName += ext;

                // TPU: cada orden en su propia carpeta dentro del ZIP (`tpu-<NoDocERP>/archivo.pdf`).
                // El sanitize de arriba ya sacó las barras del nombre, así que este es el único '/'.
                const carpeta = carpetaDeOrden(file);
                if (carpeta) finalName = `${carpeta}/${finalName}`;

                // Helper function to append a stream and wait for it to finish
                const appendStreamAndWait = (stream, name) => {
                    return new Promise((resolve, reject) => {
                        archive.append(stream, { name });
                        stream.on('end', resolve);
                        stream.on('error', reject);
                        
                        // Also resolve if the stream is aborted/closed prematurely
                        stream.on('close', resolve);
                    });
                };

                // Streaming Download
                if (sourcePath.includes('drive.google.com')) {
                    const driveId = getDriveId(sourcePath);
                    if (driveId) {
                        try {
                            const { stream } = await driveService.getFileStream(driveId);
                            await appendStreamAndWait(stream, finalName);
                        } catch (e) {
                            archive.append(`Error: ${e.message}`, { name: `ERRORES/${file.ArchivoID}_err.txt` });
                        }
                    }
                } else if (sourcePath.startsWith('http')) {
                    const response = await axios({
                        url: sourcePath,
                        method: 'GET',
                        responseType: 'stream',
                        timeout: 600000
                    });
                    await appendStreamAndWait(response.data, finalName);
                } else if (fs.existsSync(sourcePath)) {
                    archive.file(sourcePath, { name: finalName });
                }

            } catch (err) {
                logger.error("Error processing file for zip:", err);
                archive.append(`Error procesando ID ${file.ArchivoID}: ${err.message}`, { name: `ERRORES/${file.ArchivoID}_ex.txt` });
            }
        }

        archive.finalize();

    } catch (err) {
        logger.error("Zip Error:", err);
        res.status(500).send("Error del servidor creando el archivo ZIP");
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DESCARGA ARCHIVO POR ARCHIVO (sin ZIP)
// El flujo del ZIP baja todo a memoria del navegador antes de descomprimir, lo que
// pesa en lotes grandes. Acá el front pide primero el manifiesto (qué archivos y con
// qué nombre) y después baja cada uno por separado, escribiéndolo apenas llega.
// La convención de nombres es la MISMA que la del ZIP (helper compartido) para que
// los dos caminos produzcan archivos idénticos.
// ─────────────────────────────────────────────────────────────────────────────

const sanitizeFileName = (str) => (str || '').replace(/\//g, '-').replace(/[<>:"\\|?*]/g, ' ').trim();

/**
 * Subcarpeta destino del archivo dentro de la descarga (ZIP o escritura en disco).
 * Solo TPU: una orden son 5 capas (CMYK + spots + corte) y sueltas en la raíz del lote no se
 * sabe cuál es de cuál, así que cada orden va en su propia carpeta `tpu-<NoDocERP>`.
 * El resto de las áreas sigue plano (null = sin carpeta).
 * Fallback al CodigoOrden: las matrices migradas de la planilla vieja no tienen NoDocERP.
 */
const carpetaDeOrden = (f) => {
    if (String(f.AreaID || '').trim().toUpperCase() !== 'TPU') return null;
    const nro = String(f.NoDocERP || '').trim();
    return sanitizeFileName(nro ? `tpu-${nro}` : (f.CodigoOrden || `orden-${f.OrdenID}`));
};

/**
 * Devuelve los archivos de las órdenes con su nombre final ya resuelto.
 * El índice "Archivo N de M" se calcula por orden, ordenando por ArchivoID.
 */
async function buildFilesManifest(orderIds) {
    const ids = (orderIds || []).map(n => parseInt(n)).filter(n => !isNaN(n));
    if (!ids.length) return [];

    const pool = await getPool();
    const filesQuery = await pool.request().query(`
        SELECT
            AO.ArchivoID, AO.RutaAlmacenamiento, AO.NombreArchivo, AO.Copias,
            O.OrdenID, O.CodigoOrden, O.Cliente, O.DescripcionTrabajo, O.Material, O.AreaID, O.NoDocERP,
            ibt.Referencia AS PreTelaCliente,
            ISNULL(R.Nombre, 'Lote ' + CAST(O.RolloID as VARCHAR)) as RollName
        FROM dbo.ArchivosOrden AO
        INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
        LEFT JOIN dbo.Rollos R ON O.RolloID = R.RolloID
        LEFT JOIN dbo.InventarioBobinas ibt WITH(NOLOCK) ON ibt.BobinaID = O.BobinaTelaID
        WHERE O.OrdenID IN (${ids.join(',')})
    `);

    const byOrder = {};
    filesQuery.recordset.forEach(f => {
        if (!byOrder[f.OrdenID]) byOrder[f.OrdenID] = [];
        byOrder[f.OrdenID].push(f);
    });

    const out = [];
    for (const oId in byOrder) {
        const group = byOrder[oId].sort((a, b) => a.ArchivoID - b.ArchivoID);
        // for...of (y no forEach) porque el interruptor del nombre nuevo se lee de la base (await).
        for (const [idx, f] of group.entries()) {
            const sourcePath = f.RutaAlmacenamiento || '';
            let ext = path.extname(f.NombreArchivo || '').toLowerCase();
            if (!ext) ext = path.extname(sourcePath).split('?')[0].toLowerCase();
            if (!ext) ext = '.pdf';

            let finalName;
            if (f.NombreArchivo && f.NombreArchivo.length > 10) {
                finalName = sanitizeFileName(f.NombreArchivo);
            } else if (await usaNombreNuevo(f.AreaID)) {
                finalName = construirNombreArchivo({
                    material: materialParaNombre(f.Material, f.PreTelaCliente),
                    codigoOrden: f.CodigoOrden,
                    cliente: f.Cliente,
                    idx: idx + 1,
                    total: group.length,
                    copias: f.Copias || 1
                });
            } else {
                finalName = `${f.CodigoOrden}_${sanitizeFileName(f.Cliente)}_${sanitizeFileName(f.DescripcionTrabajo)} Archivo ${idx + 1} de ${group.length} (x${f.Copias || 1} COPIAS)`;
            }
            if (!finalName.toLowerCase().endsWith(ext)) finalName += ext;

            out.push({ ...f, finalName, carpeta: carpetaDeOrden(f) });
        }
    }
    return out;
}

/** POST /measurements/files-manifest → { rollName, files: [{ archivoId, fileName, codigoOrden }] } */
exports.getOrdersFilesManifest = async (req, res) => {
    const { orderIds } = req.body;
    if (!orderIds || orderIds.length === 0) return res.status(400).json({ error: 'No se recibieron IDs de órdenes' });
    try {
        const files = await buildFilesManifest(orderIds);
        if (!files.length) return res.status(404).json({ error: 'No se encontraron archivos para las órdenes seleccionadas' });
        res.json({
            rollName: files[0].RollName || null,
            // `carpeta` = subcarpeta destino (solo TPU); el front la crea antes de escribir el archivo.
            files: files.map(f => ({ archivoId: f.ArchivoID, fileName: f.finalName, codigoOrden: f.CodigoOrden, carpeta: f.carpeta })),
        });
    } catch (err) {
        logger.error('[files-manifest] Error:', err);
        res.status(500).json({ error: err.message });
    }
};

/** GET /measurements/file/:archivoId → sirve UN archivo en streaming (Drive / http / disco). */
exports.downloadSingleFile = async (req, res) => {
    const archivoId = parseInt(req.params.archivoId);
    if (isNaN(archivoId)) return res.status(400).send('archivoId inválido');

    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('AID', sql.Int, archivoId)
            .query('SELECT ArchivoID, RutaAlmacenamiento, NombreArchivo FROM dbo.ArchivosOrden WHERE ArchivoID = @AID');
        if (!r.recordset.length) return res.status(404).send('Archivo no encontrado');

        const file = r.recordset[0];
        const sourcePath = file.RutaAlmacenamiento || '';

        // Archivos grandes desde Drive/URL: sin esto el socket puede cortar por keep-alive.
        req.socket.setTimeout(0);
        const nombreDescarga = sanitizeFileName(file.NombreArchivo) || `archivo_${archivoId}`;
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nombreDescarga)}`);

        if (sourcePath.includes('drive.google.com')) {
            const driveId = getDriveId(sourcePath);
            if (!driveId) return res.status(400).send('No se pudo identificar el archivo de Drive');
            const { stream, mimeType, size } = await driveService.getFileStream(driveId);
            if (mimeType) res.setHeader('Content-Type', mimeType);
            if (size) res.setHeader('Content-Length', size);
            stream.on('error', (e) => { logger.error(`[download-file ${archivoId}] Drive stream:`, e); if (!res.headersSent) res.status(502).end(); });
            return stream.pipe(res);
        }

        if (sourcePath.startsWith('http')) {
            const response = await axios({ url: sourcePath, method: 'GET', responseType: 'stream', timeout: 600000 });
            if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
            if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
            return response.data.pipe(res);
        }

        if (fs.existsSync(sourcePath)) return res.sendFile(path.resolve(sourcePath));

        return res.status(404).send('El archivo no está disponible en el origen');
    } catch (err) {
        logger.error(`[download-file ${archivoId}] Error:`, err);
        if (!res.headersSent) res.status(500).send('Error descargando el archivo: ' + err.message);
    }
};

// NEW: Server Side Process Wrapper
exports.processFilesServerSide = async (req, res) => {
    const { fileIds } = req.body;
    try {
        await fileProcessingService.processFiles(fileIds, req.app.get('io'));
        res.json({ success: true, message: 'Procesamiento en servidor iniciado.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// NEW: Server Side Process Wrapper for Orders
exports.processOrdersServerSide = async (req, res) => {
    const { orderIds } = req.body;
    try {
        if (!orderIds || orderIds.length === 0) return res.status(400).json({ error: "No orders provided" });
        const pool = await getPool();
        const filesQuery = await pool.request().query(`
            SELECT ArchivoID 
            FROM dbo.ArchivosOrden 
            WHERE OrdenID IN (${orderIds.join(',')})
        `);
        const fileIds = filesQuery.recordset.map(r => r.ArchivoID);
        if (fileIds.length === 0) return res.status(404).json({ error: "No hay archivos asociados a estas órdenes" });

        await fileProcessingService.processFiles(fileIds, req.app.get('io'));
        res.json({ success: true, message: 'Procesamiento en servidor iniciado para ' + fileIds.length + ' archivos.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
