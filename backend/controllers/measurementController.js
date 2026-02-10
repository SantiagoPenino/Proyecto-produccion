const { getPool, sql } = require('../config/db');
const driveService = require('../services/driveService');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const archiver = require('archiver');

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
        console.error("❌ Error SQL:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// ... (measureFiles stays the same) ...

// --- 4. PROCESAMIENTO POR LOTES (DESCARGAR + MEDIR) ---
exports.processBatch = async (req, res) => {
    const { fileIds } = req.body;

    if (!fileIds || fileIds.length === 0) return res.status(400).send("No files provided");

    try {
        const pool = await getPool();

        // Obtener metadatos
        const filesQuery = await pool.request().query(`
            SELECT 
                AO.ArchivoID, AO.RutaAlmacenamiento, AO.NombreArchivo, AO.Copias,
                O.OrdenID, O.CodigoOrden, O.Cliente, O.DescripcionTrabajo
            FROM dbo.ArchivosOrden AO
            INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
            WHERE AO.ArchivoID IN (${fileIds.join(',')})
        `);

        if (filesQuery.recordset.length === 0) return res.status(404).send("Files not found");

        // Configurar ZIP
        res.attachment('archivos_seleccionados.zip');
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', function (err) {
            console.error("Archiver Error:", err);
            if (!res.headersSent) res.status(500).send({ error: err.message });
        });

        archive.pipe(res);

        const sanitize = (str) => (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();

        for (const file of filesQuery.recordset) {
            try {
                const sourcePath = file.RutaAlmacenamiento || '';
                let tempBuffer = null;

                // 1. Descargar (Auth Drive / HTTP / Local)
                if (sourcePath.includes('drive.google.com')) {
                    const driveId = getDriveId(sourcePath);
                    if (driveId) {
                        const { stream } = await driveService.getFileStream(driveId);
                        const chunks = [];
                        for await (const chunk of stream) chunks.push(chunk);
                        tempBuffer = Buffer.concat(chunks);
                    }
                } else if (sourcePath.startsWith('http')) {
                    const r = await fetch(sourcePath, { signal: AbortSignal.timeout(300000) });
                    if (r.ok) tempBuffer = Buffer.from(await r.arrayBuffer());
                } else if (fs.existsSync(sourcePath)) {
                    tempBuffer = fs.readFileSync(sourcePath);
                }

                if (!tempBuffer) {
                    archive.append(`Error descargando ID ${file.ArchivoID}`, { name: `ERRORES/${file.ArchivoID}_error.txt` });
                    continue;
                }

                // 2. Detectar Extension y Nombre
                const origExt = path.extname(file.NombreArchivo || '').toLowerCase();
                let finalExt = origExt;
                const magicHex = tempBuffer.toString('hex', 0, 4).toUpperCase();

                if (magicHex.startsWith('25504446')) finalExt = '.pdf';
                else if (magicHex.startsWith('89504E47')) finalExt = '.png';
                else if (magicHex.startsWith('FFD8FF')) finalExt = '.jpg';

                if (!finalExt) finalExt = '.pdf';

                let baseName = file.NombreArchivo;
                if (!baseName || baseName.length < 3) {
                    const pOrder = sanitize(file.CodigoOrden || file.OrdenID.toString());
                    const pClient = sanitize(file.Cliente);
                    const pJob = sanitize(file.DescripcionTrabajo || 'Trabajo');
                    baseName = `${pOrder}_${pClient}_${pJob}_ID${file.ArchivoID}`;
                } else {
                    baseName = sanitize(baseName);
                }

                if (!baseName.toLowerCase().endsWith(finalExt)) baseName += finalExt;

                // 3. Agregar al ZIP
                archive.append(tempBuffer, { name: baseName });

            } catch (err) {
                console.error(`Error processing file ${file.ArchivoID}:`, err);
                archive.append(`Error: ${err.message}`, { name: `ERRORES/${file.ArchivoID}_ex.txt` });
            }
        }

        archive.finalize();

    } catch (err) {
        console.error("Error ProcessBatch Zip:", err);
        if (!res.headersSent) res.status(500).send(err.message);
    }
};

// --- 5. PROCESAMIENTO POR ÓRDENES (DESCARGAR EN ESTRUCTURA DE CARPETAS) ---
exports.processOrdersBatch = async (req, res) => {
    const { orderIds } = req.body;
    const baseDir = 'C:\\ORDENES';
    const results = [];

    if (!orderIds || orderIds.length === 0) return res.status(400).json({ error: "No orders provided" });

    try {
        const pool = await getPool();

        // Obtener archivos de las órdenes seleccionadas con info de Área y Rollo
        const filesQuery = await pool.request().query(`
            SELECT 
                AO.ArchivoID, AO.RutaAlmacenamiento, AO.RutaLocal, AO.NombreArchivo, AO.Copias,
                O.OrdenID, O.CodigoOrden, O.Cliente, O.DescripcionTrabajo, O.AreaID,
                ISNULL(R.Nombre, 'Lote ' + CAST(O.RolloID as VARCHAR)) as RollName
            FROM dbo.ArchivosOrden AO
            INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
            LEFT JOIN dbo.Rollos R ON O.RolloID = R.RolloID
            WHERE O.OrdenID IN (${orderIds.join(',')})
        `);

        if (filesQuery.recordset.length === 0) {
            return res.json({ success: true, message: "No se encontraron archivos en las órdenes seleccionadas.", results: [] });
        }

        // --- PRE-CALCULO DE INDICES (Igual que fileProcessingService) ---
        // Agrupar archivos por OrdenID para calcular "Archivo X de Y"
        const filesByOrder = {};
        filesQuery.recordset.forEach(f => {
            if (!filesByOrder[f.OrdenID]) filesByOrder[f.OrdenID] = [];
            filesByOrder[f.OrdenID].push(f);
        });

        const filesToProcess = [];
        for (const oId in filesByOrder) {
            const group = filesByOrder[oId];
            // Ordenar por ID para consistencia
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
                // DEFINE TARGET DIRECTORY: C:\ORDENES\{AreaID}\{RollName}
                const safeArea = sanitize(file.AreaID || 'GENERAL');
                const safeRoll = sanitize(file.RollName || 'Sin-Rollo');
                const targetDir = path.join(baseDir, safeArea, safeRoll);

                // Asegurar directorio
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                // 1. ORIGEN (Descarga Robusta)
                // 1. ORIGEN (Descarga Forzada - Usuario solicitó "Si existe borre y descargue")
                const sourcePath = file.RutaAlmacenamiento || '';
                let tempBuffer = null;

                // [REMOVED LOCAL CHECK TO FORCE DOWNLOAD]
                // B. Download from URL matches logic in service
                if (!tempBuffer) {
                    if (sourcePath.includes('drive.google.com')) {
                        const driveId = getDriveId(sourcePath);
                        if (!driveId) throw new Error('Link de Drive inválido');

                        const { stream } = await driveService.getFileStream(driveId);
                        const chunks = [];
                        for await (const chunk of stream) chunks.push(chunk);
                        tempBuffer = Buffer.concat(chunks);
                    } else if (sourcePath.startsWith('http')) {
                        const res = await fetch(sourcePath, { signal: AbortSignal.timeout(300000) }); // 5 min
                        if (!res.ok) throw new Error(`Status ${res.status} al descargar de Web`);
                        tempBuffer = Buffer.from(await res.arrayBuffer());
                    } else if (fs.existsSync(sourcePath)) {
                        tempBuffer = fs.readFileSync(sourcePath);
                    } else {
                        throw new Error('Archivo origen no encontrado en DB (RutaLocal ni RutaAlmacenamiento válidos)');
                    }
                }

                // VALIDACIÓN BÁSICA
                if (!tempBuffer || tempBuffer.length === 0) throw new Error("El archivo descargado está vacío (0 bytes)");
                const header = tempBuffer.slice(0, 500).toString().trim();
                if (header.toLowerCase().startsWith('<!doctype html') || header.toLowerCase().startsWith('<html')) {
                    // Check for Virus Scan Warning
                    const content = tempBuffer.toString('utf8');
                    if (content.includes('Virus scan') || content.includes('virus') || content.includes('confirm=')) {
                        console.log(`[Batch] Drive Virus Scan Warning detectado en archivo ${file.ArchivoID}. Intentando bypass...`);

                        let confirmToken = null;
                        const match = content.match(/confirm=([a-zA-Z0-9_\-]+)/);
                        if (match) confirmToken = match[1];

                        if (!confirmToken) {
                            const matchForm = content.match(/action=".*?confirm=([a-zA-Z0-9_\-]+)/);
                            if (matchForm) confirmToken = matchForm[1];
                        }

                        let bypassUrl = '';
                        const driveId = getDriveId(sourcePath);

                        if (confirmToken) {
                            bypassUrl = `https://drive.google.com/uc?export=download&id=${driveId}&confirm=${confirmToken}`;
                        } else {
                            bypassUrl = `https://drive.google.com/uc?export=download&id=${driveId}&confirm=t`;
                        }

                        const r2 = await fetch(bypassUrl, { signal: AbortSignal.timeout(300000) });
                        if (r2.ok) tempBuffer = Buffer.from(await r2.arrayBuffer());

                        // Re-check header
                        const headerRetry = tempBuffer.slice(0, 15).toString().trim().toLowerCase();
                        if (headerRetry.startsWith('<!doctype html') || headerRetry.startsWith('<html')) {
                            throw new Error("Falló bypass de Virus Scan (el archivo sigue siendo HTML).");
                        }
                    } else {
                        throw new Error("El archivo descargado parece ser HTML (error Drive/Login).");
                    }
                }

                // Sanitizar: Reemplazar slash / por guion - (para "1/1" -> "1-1") y borrar chars prohibidos
                // const sanitize = (str) => (str || '').replace(/\//g, '-').replace(/[<>:"\\|?*]/g, ' ').trim();

                // 2. DESTINO (RENOMBRADO) - Detectar extensión real
                const origExt = path.extname(file.NombreArchivo || '').toLowerCase();
                let finalExt = origExt;

                // Inspeccionar Magic Numbers (HEX) para mayor precisión
                // PDF: 25 50 44 46, PNG: 89 50 4E 47, JPG: FF D8 FF
                const magicHex = tempBuffer.toString('hex', 0, 4).toUpperCase();
                console.log(`[FileTypeDebug] FileID: ${file.ArchivoID}, Name: ${file.NombreArchivo}, OrigExt: ${origExt}, Magic: ${magicHex}`);

                if (magicHex.startsWith('25504446')) {
                    finalExt = '.pdf';
                } else if (magicHex.startsWith('89504E47')) {
                    finalExt = '.png';
                } else if (magicHex.startsWith('FFD8FF')) {
                    finalExt = '.jpg';
                }

                // Si no detectamos nada por contenido, confiamos en la extensión original si existe.
                if (!finalExt) {
                    // Si tampoco existe extensión original, intentamos adivinar por ruta o fallback a .pdf
                    const urlExt = path.extname(file.RutaAlmacenamiento || '').split('?')[0].toLowerCase();
                    if (['.jpg', '.jpeg', '.png', '.pdf', '.tiff', '.tif'].includes(urlExt)) {
                        finalExt = urlExt;
                    } else {
                        finalExt = '.pdf'; // Último recurso
                    }
                }

                if (finalExt === '.jpeg') finalExt = '.jpg';

                // Naming Format: CODIGO (ORDEN)_CLIENTE_TRABAJO_Archivo X de Y (X n COPIAS)
                const pCodigo = sanitize(file.CodigoOrden || file.OrdenID.toString());
                const pCliente = sanitize(file.Cliente || 'Cliente');

                let pTrabajo = sanitize(file.DescripcionTrabajo || 'Trabajo');
                if (pTrabajo.length > 50) pTrabajo = pTrabajo.substring(0, 50); // Prevent path overflow

                const pArchivo = `Archivo ${file.Copias || 1} de ${1}`; // Simplification primarily for single selections or where index isn't tracked globally here. 
                // Better approach to match exactly: We need sequential index if processing multiple files for same order.
                // However, in this loop we iterate a flat list. 

                // Let's rely on baseName logic from fileProcessingService but we need idxInOrder.
                // Since this is a manual download batch, the strict '1 of N' might be less critical than matching the pattern.
                // But let's try to match exactly if possible.

                const pCopias = sanitize((file.Copias || 1).toString());

                // EJEMPLO: 61 (1-1)_GOAT_trabajo 2_Archivo 1 de 1 (X 1 COPIAS)
                // Note: In fileProcessingService, it calculates idxInOrder. Here we don't have it easily without pre-grouping.
                // For now, using a generic "Archivo" placeholder or file Name if available as priority.

                // Let's use the exact same detailed logic found in fileProcessingService lines 98-112

                // Recalculating index context for correct naming if multiple files per order
                if (!file.idxInOrder) file.idxInOrder = 1;
                if (!file.totalInOrder) file.totalInOrder = 1;

                let baseName = `${pCodigo}_${pCliente}_${pTrabajo}_Archivo ${file.idxInOrder} de ${file.totalInOrder} (X ${pCopias} COPIAS)`;

                if (!baseName.toLowerCase().endsWith(finalExt.toLowerCase())) {
                    baseName += finalExt;
                }

                const destPath = path.join(targetDir, baseName);

                // "Si existe borre y descargue"
                if (fs.existsSync(destPath)) {
                    try { fs.unlinkSync(destPath); } catch (e) {
                        console.warn("Could not delete existing file:", e.message);
                    }
                }

                fs.writeFileSync(destPath, tempBuffer);
                log.savedTo = destPath;

                // 3. MEDICIÓN AUTOMATICA
                let widthM = 0;
                let heightM = 0;
                try {
                    const isPdf = finalExt.toLowerCase() === '.pdf' || (tempBuffer.slice(0, 4).toString() === '%PDF');
                    if (isPdf) {
                        const pdfDoc = await PDFDocument.load(tempBuffer, { updateMetadata: false });
                        const pages = pdfDoc.getPages();
                        if (pages.length > 0) {
                            const { width, height } = pages[0].getSize();
                            widthM = cmToM(pointsToCm(width));
                            heightM = cmToM(pointsToCm(height));
                        }
                    } else {
                        const metadata = await sharp(tempBuffer).metadata();
                        const density = metadata.density || 72;
                        widthM = cmToM(pixelsToCm(metadata.width, density));
                        heightM = cmToM(pixelsToCm(metadata.height, density));
                    }
                } catch (measureErr) {
                    log.measureError = measureErr.message;
                }

                log.width = parseFloat(widthM.toFixed(2));
                log.height = parseFloat(heightM.toFixed(2));

                // 4. GUARDAR EN BD
                if (log.width > 0 && log.height > 0) {
                    await new sql.Request(pool)
                        .input('ID', sql.Int, file.ArchivoID)
                        .input('M', sql.Decimal(10, 2), log.height)
                        .input('W', sql.Decimal(10, 2), log.width)
                        .input('H', sql.Decimal(10, 2), log.height)
                        .input('RL', sql.VarChar(500), destPath) // Actualizar RutaLocal
                        .input('NA', sql.VarChar(255), baseName) // Actualizar NombreArchivo
                        .query(`
                            UPDATE dbo.ArchivosOrden 
                            SET MedidaConfirmada = @M, Ancho = @W, Alto = @H, RutaLocal = @RL, NombreArchivo = @NA
                            WHERE ArchivoID = @ID
                        `);
                } else {
                    // Even if measure fail, save location
                    await new sql.Request(pool)
                        .input('ID', sql.Int, file.ArchivoID)
                        .input('RL', sql.VarChar(500), destPath)
                        .input('NA', sql.VarChar(255), baseName)
                        .query(`UPDATE dbo.ArchivosOrden SET RutaLocal = @RL, NombreArchivo = @NA WHERE ArchivoID = @ID`);
                }
            } catch (err) {
                console.error(`ERROR PROCESSING FILE ${file.ArchivoID}:`, err);
                log.status = 'ERROR';
                log.error = err.message;
            }
            results.push(log);
        }

        res.json({ success: true, results });

    } catch (err) {
        console.error("Error Orders Batch Process:", err);
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
                // CASO A: Es un Link de Google Drive
                if (filePath.includes('drive.google.com')) {
                    const driveId = getDriveId(filePath);
                    if (!driveId) throw new Error('Link de Drive inválido');

                    console.log(`⬇️ Descargando para medir (Auth): ${file.ArchivoID}`);
                    const { stream } = await driveService.getFileStream(driveId);
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    fileBuffer = Buffer.concat(chunks);
                }
                // CASO B: Es un Link Web normal (http...)
                else if (filePath.startsWith('http')) {
                    const response = await fetch(filePath);
                    if (!response.ok) throw new Error('Falló descarga Web');
                    const arrayBuffer = await response.arrayBuffer();
                    fileBuffer = Buffer.from(arrayBuffer);
                }
                // CASO C: Es un archivo Local en el Servidor (C:\...)
                else {
                    if (!fs.existsSync(filePath)) {
                        results.push({ id: file.ArchivoID, width: 0, height: 0, area: 0, error: 'No encontrado en disco local' });
                        continue;
                    }
                    fileBuffer = fs.readFileSync(filePath);
                }

                // --- LÓGICA DE MEDICIÓN (COMÚN) ---
                let widthCm = 0;
                let heightCm = 0;

                // Detectar si es PDF por extensión o por tipo en DB
                const isPdf = filePath.toLowerCase().endsWith('.pdf') || file.TipoArchivo === 'pdf' || (fileBuffer && fileBuffer.slice(0, 4).toString() === '%PDF');

                if (isPdf) {
                    const pdfDoc = await PDFDocument.load(fileBuffer, { updateMetadata: false });
                    const pages = pdfDoc.getPages();
                    if (pages.length > 0) {
                        const { width, height } = pages[0].getSize();
                        widthCm = pointsToCm(width);
                        heightCm = pointsToCm(height);
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
                console.error(`❌ Error midiendo archivo ${file.ArchivoID}:`, error.message);
                results.push({ id: file.ArchivoID, width: 0, height: 0, area: 0, error: 'Error al leer/descargar archivo' });
            }
        }
        res.json({ success: true, results });
    } catch (err) {
        console.error("Error general measureFiles:", err);
        res.status(500).json({ error: "Error interno medidor." });
    }
};

// --- 3. GUARDAR RESULTADOS ---
const { registrarAuditoria, registrarHistorialOrden } = require('../services/trackingService');

// ... (rest of imports unchanged)

// ... (previous functions unchanged)

// --- 3. GUARDAR RESULTADOS ---
exports.saveMeasurements = async (req, res) => {
    console.log("🛠️ SAVE MEASUREMENTS:", req.body);
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
                // 1. Obtener OrdenID para historial
                const fileInfo = await new sql.Request(transaction)
                    .input('FID', sql.Int, m.id)
                    .query("SELECT OrdenID FROM dbo.ArchivosOrden WHERE ArchivoID = @FID");

                if (fileInfo.recordset[0]) {
                    affectedOrders.add(fileInfo.recordset[0].OrdenID);
                }

                // 2. Actualizar Medidas
                await new sql.Request(transaction)
                    .input('ID', sql.Int, m.id)
                    .input('MetrosVal', sql.Decimal(10, 2), m.confirmed)
                    .input('W', sql.Decimal(10, 2), m.width || 0)
                    .input('H', sql.Decimal(10, 2), m.height || 0)
                    .query(`UPDATE dbo.ArchivosOrden SET Metros = @MetrosVal, Ancho = @W, Alto = @H, MedidaConfirmada = 1 WHERE ArchivoID = @ID`);
            }

            // 3. Registrar Historial por Orden Afectada
            for (const orderId of affectedOrders) {
                // Obtenemos estado actual para no cambiarlo
                const orderData = await new sql.Request(transaction)
                    .input('OID', sql.Int, orderId)
                    .query("SELECT Estado FROM dbo.Ordenes WHERE OrdenID = @OID");

                const currentStatus = orderData.recordset[0]?.Estado || 'Pendiente';

                // RECALCULO AUTOMATICO DE MAGNITUD TOTAL DE LA ORDEN
                const calcRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, orderId)
                    .query(`
                        SELECT SUM(ISNULL(Copias, 1) * ISNULL(Metros, 0)) as Total 
                        FROM dbo.ArchivosOrden 
                        WHERE OrdenID = @OID
                    `);
                const newTotal = calcRes.recordset[0].Total || 0;

                // Actualizar Magnitud en la Orden
                await new sql.Request(transaction)
                    .input('OID', sql.Int, orderId)
                    .input('Mag', sql.VarChar(50), newTotal.toFixed(2))
                    .query("UPDATE dbo.Ordenes SET Magnitud = @Mag WHERE OrdenID = @OID");

                await registrarHistorialOrden(transaction, orderId, currentStatus, currentUserId, `Medición actualizada. Nueva Magnitud: ${newTotal.toFixed(2)}m`);
            }

            // 4. Registrar Auditoría Global
            await registrarAuditoria(transaction, currentUserId, 'MEDICION_FILES', `Actualizados ${measurements.length} archivos`, userIp);

            await transaction.commit();
            res.json({ success: true });
        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }
    } catch (err) {
        console.error("Error guardando medidas:", err);
        res.status(500).json({ error: err.message });
    }
};

// --- 5. NUEVA FUNCIÓN: DESCARGAR ZIP AL CLIENTE ---
exports.downloadOrdersZip = async (req, res) => {
    const { orderIds } = req.body;

    if (!orderIds || orderIds.length === 0) return res.status(400).send("No se recibieron IDs de órdenes");

    try {
        const pool = await getPool();

        // 1. Obtener Metadatos de Archivos
        const filesQuery = await pool.request().query(`
            SELECT 
                AO.ArchivoID, AO.RutaAlmacenamiento, AO.RutaLocal, AO.NombreArchivo, AO.Copias,
                O.OrdenID, O.CodigoOrden, O.Cliente, O.DescripcionTrabajo, O.AreaID,
                ISNULL(R.Nombre, 'Lote ' + CAST(O.RolloID as VARCHAR)) as RollName
            FROM dbo.ArchivosOrden AO
            INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
            LEFT JOIN dbo.Rollos R ON O.RolloID = R.RolloID
            WHERE O.OrdenID IN (${orderIds.join(',')})
        `);

        if (filesQuery.recordset.length === 0) return res.status(404).send("No se encontraron archivos para las órdenes seleccionadas");

        // Configurar Respuesta Zip
        res.attachment('ordenes_descarga.zip');
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', function (err) {
            console.error("Archiver Error:", err);
            if (!res.headersSent) res.status(500).send({ error: err.message });
        });

        archive.pipe(res);

        // Helper sanitizar
        const sanitize = (str) => (str || '').replace(/\//g, '-').replace(/[<>:"\\|?*]/g, ' ').trim();

        // Lógica de Descarga y Procesamiento (Idem processOrdersBatch pero en memoria para Zip)
        // Pre-cálculo índices
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

        for (const file of filesToProcess) {
            try {
                // A. Descargar Buffer
                const sourcePath = file.RutaAlmacenamiento || '';
                let tempBuffer = null;

                if (sourcePath.includes('drive.google.com')) {
                    const driveId = getDriveId(sourcePath);
                    if (driveId) {
                        try {
                            const { stream } = await driveService.getFileStream(driveId);
                            const chunks = [];
                            for await (const chunk of stream) chunks.push(chunk);
                            tempBuffer = Buffer.concat(chunks);
                        } catch (driveErr) {
                            console.error(`[ZIP] Error downloading from Drive ID ${driveId}:`, driveErr.message);
                            archive.append(`Error Drive API: ${driveErr.message}`, { name: `ERRORES/${file.ArchivoID}_drive_error.txt` });
                            continue;
                        }
                    }
                } else if (sourcePath.startsWith('http')) {
                    const r = await fetch(sourcePath, { signal: AbortSignal.timeout(300000) }); // 5 min timeout
                    if (r.ok) tempBuffer = Buffer.from(await r.arrayBuffer());
                } else if (fs.existsSync(sourcePath)) {
                    tempBuffer = fs.readFileSync(sourcePath);
                }

                if (!tempBuffer) {
                    archive.append(`Error descargando archivo ID ${file.ArchivoID}: ${sourcePath}`, { name: `ERRORES/${file.ArchivoID}_error.txt` });
                    continue;
                }

                // B. Validar HTML error y Bypass Virus Scan
                const header = tempBuffer.slice(0, 500).toString().trim(); // More context
                if (header.toLowerCase().includes('<!doctype html') || header.toLowerCase().includes('<html')) {
                    // Check for Virus Scan Warning
                    const content = tempBuffer.toString('utf8');
                    if (content.includes('Virus scan') || content.includes('virus') || content.includes('confirm=')) {
                        console.log(`[ZIP] Drive Virus Scan Warning detectado en archivo ${file.ArchivoID}. Intentando bypass...`);

                        let confirmToken = null;
                        const match = content.match(/confirm=([a-zA-Z0-9_\-]+)/);
                        if (match) confirmToken = match[1];

                        if (!confirmToken) {
                            const matchForm = content.match(/action=".*?confirm=([a-zA-Z0-9_\-]+)/);
                            if (matchForm) confirmToken = matchForm[1];
                        }

                        if (confirmToken) {
                            console.log(`[ZIP] Token encontrado: ${confirmToken}. Reintentando...`);
                            const driveId = getDriveId(sourcePath);
                            const bypassUrl = `https://drive.google.com/uc?export=download&id=${driveId}&confirm=${confirmToken}`;
                            const r2 = await fetch(bypassUrl, { signal: AbortSignal.timeout(300000) });
                            if (r2.ok) tempBuffer = Buffer.from(await r2.arrayBuffer());
                        } else {
                            // Try generic confirm
                            console.log(`[ZIP] Token no encontrado. Probando confirm=t...`);
                            const driveId = getDriveId(sourcePath);
                            const bypassUrl = `https://drive.google.com/uc?export=download&id=${driveId}&confirm=t`;
                            const r2 = await fetch(bypassUrl, { signal: AbortSignal.timeout(300000) });
                            if (r2.ok) tempBuffer = Buffer.from(await r2.arrayBuffer());
                        }

                        // Re-check header after retry
                        const headerRetry = tempBuffer.slice(0, 15).toString().trim().toLowerCase();
                        if (headerRetry.startsWith('<!doctype html') || headerRetry.startsWith('<html')) {
                            archive.append(`Error: Falló bypass de Virus Scan. ID ${file.ArchivoID}`, { name: `ERRORES/${file.ArchivoID}_virus_error.txt` });
                            continue;
                        }

                    } else {
                        archive.append(`Error: El archivo descargado parece ser HTML (Login Drive?). ID ${file.ArchivoID}`, { name: `ERRORES/${file.ArchivoID}_login_error.txt` });
                        continue;
                    }
                }

                // C. Detectar Extensión Real (Magic Hex)
                const origExt = path.extname(file.NombreArchivo || '').toLowerCase();
                let finalExt = origExt;
                const magicHex = tempBuffer.toString('hex', 0, 4).toUpperCase();

                if (magicHex.startsWith('25504446')) finalExt = '.pdf';
                else if (magicHex.startsWith('89504E47')) finalExt = '.png';
                else if (magicHex.startsWith('FFD8FF')) finalExt = '.jpg';

                if (!finalExt || finalExt === '.jpeg') {
                    if (finalExt === '.jpeg') finalExt = '.jpg';
                    else finalExt = '.pdf'; // Fallback
                }

                // D. Construir Nombre y Ruta en ZIP
                // Estructura: Area / Rollo / Orden_Client_Trabajo_XdeY.ext
                const safeArea = sanitize(file.AreaID || 'GENERAL');
                const safeRoll = sanitize(file.RollName || 'Sin-Rollo');

                let finalName = "";

                // Preferir Nombre Original Guardado si existe
                if (file.NombreArchivo && file.NombreArchivo.length > 5) {
                    finalName = sanitize(file.NombreArchivo);
                } else {
                    // Fallback a Generado
                    finalName = `${file.CodigoOrden}_${sanitize(file.Cliente)}_${sanitize(file.DescripcionTrabajo)}`;
                    if (file.totalInOrder > 1) {
                        finalName += `_(${file.idxInOrder}-${file.totalInOrder})`;
                    }
                }

                // Extension Check
                if (!finalName.toLowerCase().endsWith(finalExt)) finalName += finalExt;

                const zipPath = finalName;

                archive.append(tempBuffer, { name: zipPath });

            } catch (err) {
                console.error("Error processing file for zip:", err);
                archive.append(`Error procesando ID ${file.ArchivoID}: ${err.message}`, { name: `ERRORES/${file.ArchivoID}_ex.txt` });
            }
        }

        archive.finalize();

    } catch (err) {
        console.error("Zip Error:", err);
        res.status(500).send("Error del servidor creando el archivo ZIP");
    }
};