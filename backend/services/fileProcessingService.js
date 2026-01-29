const { getPool, sql } = require('../config/db');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

// --- HELPERS ---
const downloadStream = async (url, filepath) => {
    const writer = fs.createWriteStream(filepath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        validateStatus: status => status === 200 // Only accept 200 OK
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};
const pointsToCm = (points) => (points / 72) * 2.54;
const pixelsToCm = (pixels, dpi) => (pixels / dpi) * 2.54;
const cmToM = (cm) => cm / 100;

// Extraer ID de Drive
const getDriveId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:id=|\/d\/)([\w-]+)/);
    return match ? match[1] : null;
};

/**
 * Procesa una lista de IDs de Ordenes de forma asíncrona.
 * Descarga archivos, mide dimensiones, actualiza DB y recalcula magnitud global.
 * @param {Array<number>} orderIds - Lista de IDs de órdenes a procesar
 * @param {Object} io - Instancia de Socket.io para notificaciones (opcional)
 */
exports.processOrderList = async (orderIds, io) => {
    if (!orderIds || orderIds.length === 0) return;

    console.log(`⚡ [FileProcessing] Iniciando procesamiento asíncrono para ${orderIds.length} órdenes...`);

    setImmediate(async () => {
        try {
            const pool = await getPool();

            // 1. Obtener archivos de las órdenes indicadas
            const idsStr = orderIds.join(',');

            console.log(`🔎 [FileProcessing] Consultando DB para OrdenIDs: ${idsStr}`);

            const filesRes = await pool.request().query(`
                SELECT AO.ArchivoID, AO.RutaAlmacenamiento, AO.RutaLocal, AO.NombreArchivo, AO.Copias,
                       O.OrdenID, O.CodigoOrden, O.Cliente, O.DescripcionTrabajo, O.Material, O.UM, O.AreaID
                FROM dbo.ArchivosOrden AO
                INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
                WHERE AO.OrdenID IN (${idsStr}) 
                AND AO.EstadoArchivo != 'CANCELADO'
            `);

            const files = filesRes.recordset;
            console.log(`   📂 [FileProcessing] Encontrados ${files.length} archivos para medir.`);

            if (files.length === 0) return;

            // --- PRE-CALCULO DE INDICES (Archivo X de Y) ---
            const filesByOrder = {};
            files.forEach(f => {
                if (!filesByOrder[f.OrdenID]) filesByOrder[f.OrdenID] = [];
                filesByOrder[f.OrdenID].push(f);
            });

            const processedFiles = [];
            for (const oId in filesByOrder) {
                const group = filesByOrder[oId];
                // Ordenar por ID para consistencia (el archivo con menor ID será el "1 de N")
                group.sort((a, b) => a.ArchivoID - b.ArchivoID);
                group.forEach((f, idx) => {
                    f.idxInOrder = idx + 1;
                    f.totalInOrder = group.length;
                    processedFiles.push(f);
                });
            }

            const rootDir = 'C:\\ORDENES';

            for (const file of processedFiles) {
                try {
                    // Carpeta dinámica por Area
                    const areaFolder = (file.AreaID || 'GENERAL').trim().toUpperCase().replace(/[<>:"/\\|?*]/g, '');
                    const targetDir = path.join(rootDir, areaFolder);
                    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                    console.log(`      Medio: ${file.NombreArchivo} (ID: ${file.ArchivoID})...`);

                    // A. Descargar / Verificar Local
                    // Sanitizar: Reemplazar slash / por guion - (para "1/1" -> "1-1") y borrar chars prohibidos
                    const sanitize = (str) => (str || '').replace(/\//g, '-').replace(/[<>:"\\|?*]/g, ' ').trim();

                    // Naming Format: CODIGO (ORDEN)_CLIENTE_TRABAJO_Archivo X de Y (X n COPIAS)
                    const pCodigo = sanitize(file.CodigoOrden || file.OrdenID.toString());
                    const pCliente = sanitize(file.Cliente || 'Cliente');

                    let pTrabajo = sanitize(file.DescripcionTrabajo || 'Trabajo');
                    if (pTrabajo.length > 50) pTrabajo = pTrabajo.substring(0, 50); // Prevent path overflow

                    const pArchivo = `Archivo ${file.idxInOrder} de ${file.totalInOrder}`;
                    const pCopias = sanitize((file.Copias || 1).toString());

                    // EJEMPLO: 61 (1-1)_GOAT_trabajo 2_Archivo 1 de 1 (X 1 COPIAS)
                    let baseName = `${pCodigo}_${pCliente}_${pTrabajo}_${pArchivo} (X ${pCopias} COPIAS)`;

                    // Determinar si ya tenemos ruta local válida y el archivo existe
                    let destPath = '';
                    let needsDownload = true;

                    // IMPORTANTE: Si cambiamos la convención de nombres, es probable que la RutaLocal antigua NO coincida
                    // con el nuevo baseName que acabamos de generar.
                    // Si queremos RENOMBRAR los existentes, tendríamos que detectar si existe archivo fisico en RutaLocal
                    // y renombrarlo. Pero por simplicidad en reprocesos, si el nombre deseado no existe, forzamos re-descarga (o renombre si pudieramos).
                    // Para evitar duplicados infinitos, asumimos que si RutaLocal existe, ES VALIDO. 
                    // PERO el usuario pidió que el nombre coincida.
                    // Entonces: Si RutaLocal existe pero NO termina con baseName (sin ext), entonces debemos moverlo/renombrarlo?
                    // Riesgoso. Mejor lógica simple: Ignorar RutaLocal si queremos forzar nombre nuevo.
                    // En este script asumimos que el usuario limpiará RutaLocal via reprocessing debug endpoint si quiere renombrar.

                    if (file.RutaLocal && fs.existsSync(file.RutaLocal)) {
                        // Check si el nombre coincide con el formato nuevo?
                        const existingName = path.basename(file.RutaLocal, path.extname(file.RutaLocal));
                        if (existingName === baseName) {
                            destPath = file.RutaLocal;
                            needsDownload = false;
                            console.log(`      ✅ Usando copia local existente (Nombre correcto): ${destPath}`);
                        } else {
                            console.log(`      ⚠️ RutaLocal existe pero nombre difiere. Se generará nuevo con nombre correcto.`);
                            // No usamos el viejo -> needsDownload = true. 
                            // Si descargamos de nuevo, tendremos 2 archivos.
                        }
                    }

                    if (needsDownload) {
                        const tempPath = path.join(targetDir, `${baseName}.tmp`);
                        let sourcePath = file.RutaAlmacenamiento || '';
                        let isDrive = false;

                        if (sourcePath.includes('drive.google.com')) {
                            const dId = getDriveId(sourcePath);
                            if (dId) {
                                sourcePath = `https://drive.google.com/uc?export=download&id=${dId}`;
                                isDrive = true;
                            }
                        }

                        // ... Downloading Logic ...
                        try {
                            if (sourcePath.startsWith('http')) {
                                await downloadStream(sourcePath, tempPath);
                                // Check Drive Warning
                                if (isDrive) {
                                    const stats = fs.statSync(tempPath);
                                    if (stats.size < 500000) {
                                        const content = fs.readFileSync(tempPath, 'utf8');
                                        if (content.includes('<html') || content.includes('<!doctype')) {
                                            const match = content.match(/confirm=([a-zA-Z0-9_-]+)/);
                                            if (match) {
                                                console.log(`      🔄 Drive Large File Confirm. Retrying...`);
                                                await downloadStream(`${sourcePath}&confirm=${match[1]}`, tempPath);
                                            }
                                        }
                                    }
                                }
                            } else if (fs.existsSync(sourcePath)) {
                                fs.copyFileSync(sourcePath, tempPath);
                            } else {
                                console.warn(`      ⚠️ Source not found: ${sourcePath}`);
                                continue;
                            }
                        } catch (dlErr) {
                            console.warn(`      ⚠️ Download Error ${file.ArchivoID}: ${dlErr.message}`);
                            continue;
                        }

                        // ... Rename Logic ...
                        let finalExt = '.pdf';
                        try {
                            const fd = fs.openSync(tempPath, 'r');
                            const magic = Buffer.alloc(4);
                            fs.readSync(fd, magic, 0, 4, 0);
                            fs.closeSync(fd);
                            if (!magic.toString().startsWith('%PDF')) {
                                const origExt = path.extname(file.NombreArchivo || '') || '.pdf';
                                finalExt = origExt;
                            }
                        } catch (e) { }

                        // Agregar extension al baseName si no la tiene (baseName puro no la tiene)
                        let fileNameWithExt = baseName;
                        if (!fileNameWithExt.toLowerCase().endsWith(finalExt.toLowerCase())) fileNameWithExt += finalExt;

                        destPath = path.join(targetDir, fileNameWithExt);
                        if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch (e) { }
                        fs.renameSync(tempPath, destPath);

                        // UPDATE RUTA LOCAL
                        await pool.request().input('ID', sql.Int, file.ArchivoID).input('R', sql.VarChar(500), destPath)
                            .query("UPDATE dbo.ArchivosOrden SET RutaLocal=@R WHERE ArchivoID=@ID");
                    }

                    // Read for Measurement
                    let tempBuffer = null;
                    try { tempBuffer = fs.readFileSync(destPath); } catch (e) { }

                    // D. Medir
                    let widthM = 0;
                    let heightM = 0;

                    try {
                        if (!tempBuffer) throw new Error("Empty buffer");
                        const magic = tempBuffer.slice(0, 4).toString();
                        const currentExt = path.extname(destPath).toLowerCase();
                        let isPdf = currentExt === '.pdf' || magic === '%PDF';
                        let measureDone = false;

                        // 1. Intento PDF
                        if (isPdf) {
                            try {
                                const pdfDoc = await PDFDocument.load(tempBuffer, { updateMetadata: false, ignoreEncryption: true });
                                const pages = pdfDoc.getPages();
                                if (pages.length > 0) {
                                    const { width, height } = pages[0].getSize();
                                    widthM = cmToM(pointsToCm(width));
                                    heightM = cmToM(pointsToCm(height));
                                    measureDone = true;
                                }
                            } catch (pdfErr) {
                                console.warn(`      ⚠️ PDF-LIB failed (${pdfErr.message}). Trying fallback to Image...`);
                            }
                        }

                        // 2. Intento Imagen (o PDF fallback via Sharp)
                        if (!measureDone) {
                            const m = await sharp(tempBuffer).metadata();
                            widthM = cmToM(pixelsToCm(m.width, m.density || 72));
                            heightM = cmToM(pixelsToCm(m.height, m.density || 72));
                        }

                    } catch (measureErr) {
                        const headDump = tempBuffer ? tempBuffer.slice(0, 60).toString().replace(/[\r\n]+/g, ' ') : 'null';
                        console.warn(`      ⚠️ Error midiendo archivo ${file.ArchivoID}: ${measureErr.message} | HEAD: ${headDump}`);
                    }

                    // E. Actualizar BD si tenemos medidas válidas
                    if (widthM > 0 && heightM > 0) {
                        console.log(`      ✅ Medidas obtenidas: ${widthM.toFixed(2)}m x ${heightM.toFixed(2)}m`);

                        // --- LOGICA DE CALCULO AUTOMATICO (Mimics Manual Logic) ---
                        let valorMetros = heightM; // Default ML
                        const matUpper = (file.Material || '').toUpperCase();
                        const umUpper = (file.UM || '').toUpperCase();

                        const isM2 = umUpper === 'M2' || matUpper.includes('LONA') || matUpper.includes('VINIL') || matUpper.includes('ADHESIV') || matUpper.includes('MICRO') || matUpper.includes('RIGID') || matUpper.includes('PVC') || matUpper.includes('CANVAS');
                        const isUnit = umUpper === 'U' || umUpper === 'UNID' || matUpper.includes('TAZA') || matUpper.includes('GORR') || matUpper.includes('LLAVE');

                        if (isUnit) {
                            valorMetros = 1;
                        } else if (isM2) {
                            valorMetros = widthM * heightM;
                        } else {
                            // Textil / Default (Lineal)
                            valorMetros = heightM;
                        }

                        // Actualizar Archivo con MedidaConfirmada = 1 (Path already updated)
                        await pool.request()
                            .input('ID', sql.Int, file.ArchivoID)
                            .input('M', sql.Decimal(10, 2), valorMetros)
                            .input('W', sql.Decimal(10, 2), widthM)
                            .input('H', sql.Decimal(10, 2), heightM)
                            .query("UPDATE dbo.ArchivosOrden SET Metros=@M, Ancho=@W, Alto=@H, MedidaConfirmada=1 WHERE ArchivoID=@ID");

                        // Recalcular Magnitud Global de la Orden
                        await pool.request()
                            .input('OID', sql.Int, file.OrdenID)
                            .query(`
                                DECLARE @TotalProd DECIMAL(18,2) = 0;
                                DECLARE @TotalServ DECIMAL(18,2) = 0;

                                -- Suma de Producción (Metros * Copias)
                                SELECT @TotalProd = SUM(ISNULL(Metros, 0) * ISNULL(Copias, 1))
                                FROM ArchivosOrden 
                                WHERE OrdenID = @OID AND EstadoArchivo != 'CANCELADO';

                                -- Suma de Servicios (Cantidad Directa)
                                SELECT @TotalServ = SUM(ISNULL(Cantidad, 0))
                                FROM ServiciosExtraOrden 
                                WHERE OrdenID = @OID;

                                UPDATE dbo.Ordenes 
                                SET Magnitud = CAST((ISNULL(@TotalProd, 0) + ISNULL(@TotalServ, 0)) AS NVARCHAR(50))
                                WHERE OrdenID = @OID
                            `);

                        // F. Notificar UI de cambio en orden especifica
                        if (io) {
                            io.emit('server:order_updated', { orderId: file.OrdenID });
                        }
                    }

                } catch (fileErr) {
                    console.error(`      ❌ Error procesando archivo ${file.ArchivoID}:`, fileErr.message);
                }
            }

            console.log(`⚡ [FileProcessing] Proceso finalizado.`);
            if (io) io.emit('server:ordersUpdated', { count: 1 }); // Refresh general

        } catch (err) {
            console.error("❌ [FileProcessing] Error general:", err);
        }
    });
};
