const { getPool, sql } = require('../config/db');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument, PDFName } = require('pdf-lib');

// /UserUnit de una página pdf-lib (default 1). Los PDF de más de ~5.08m (límite 14400pt)
// traen UserUnit (ej. 10): sin aplicarlo el trabajo se mide N veces más chico.
const getPdfUserUnit = (page) => {
    try {
        const uu = page.node.get(PDFName.of('UserUnit'));
        const n = uu && typeof uu.asNumber === 'function' ? uu.asNumber() : NaN;
        return (Number.isFinite(n) && n > 0) ? n : 1;
    } catch (_) { return 1; }
};
const logger = require('../utils/logger');
const driveService = require('./driveService');
const { construirNombreArchivo, materialParaNombre, usaNombreNuevo } = require('../utils/nombreArchivoOrden');


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
 * @param {Array<number>} targetFileIds - (Opcional) IDs específicos de archivo a procesar
 */
const processOrderListInternal = async (orderIds, io, targetFileIds = null, opts = {}) => {
    if (!orderIds || orderIds.length === 0) return;

    logger.info(`⚡ [FileProcessing] Iniciando procesamiento asíncrono para ${orderIds.length} órdenes...` + (targetFileIds ? ` (Target Files: ${targetFileIds.length})` : ''));

    setImmediate(async () => {
        try {
            const pool = await getPool();

            // 1. Obtener archivos de las órdenes indicadas
            const idsStr = orderIds.join(',');

            // IMPORTANTE: Obtenemos TODOS los archivos de la orden para calcular los índices correctamente (Archivo 1 de N)
            const filesRes = await pool.request().query(`
                SELECT AO.ArchivoID, AO.RutaAlmacenamiento, AO.RutaLocal, AO.NombreArchivo, AO.Copias,
                       O.OrdenID, O.CodigoOrden, O.Cliente, O.DescripcionTrabajo, O.Material, O.UM, O.AreaID,
                       -- TELA DE CLIENTE (SB): el PRE de la recepción se suma al material en el nombre
                       ibt.Referencia AS PreTelaCliente
                FROM dbo.ArchivosOrden AO
                INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
                LEFT JOIN dbo.InventarioBobinas ibt WITH(NOLOCK) ON ibt.BobinaID = O.BobinaTelaID
                WHERE AO.OrdenID IN (${idsStr})
                AND AO.EstadoArchivo != 'CANCELADO'
            `);

            const files = filesRes.recordset;
            logger.info(`   📂[FileProcessing] Encontrados ${files.length} archivos totales en las órdenes.`);

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

                    // AHORA FILTRAMOS: Solo añadimos a la lista de procesamiento si es un targetFileId (o si no hay targets)
                    if (!targetFileIds || targetFileIds.includes(f.ArchivoID)) {
                        processedFiles.push(f);
                    }
                });
            }

            logger.info(`   🎯[FileProcessing] Archivos a procesar realmente: ${processedFiles.length}`);

            const rootDir = process.env.ORDENES_PATH || path.join(__dirname, '..', 'ordenes');

            for (const file of processedFiles) {
                try {
                    // Carpeta dinámica por Area
                    const areaFolder = (file.AreaID || 'GENERAL').trim().toUpperCase().replace(/[<>:"/\\|?*]/g, '');
                    const targetDir = path.join(rootDir, areaFolder);
                    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                    logger.info(`      Medio: ${file.NombreArchivo} (ID: ${file.ArchivoID})...`);

                    // A. Descargar / Verificar Local
                    // Sanitizar: Reemplazar slash / por guion - (para "1/1" -> "1-1") y borrar chars prohibidos
                    const sanitize = (str) => (str || '').replace(/\//g, '-').replace(/[<>:"\\|?*]/g, ' ').trim();

                    // SUBLIMACIÓN: {MATERIAL}-{ORDEN}_{CLIENTE}_Arch {Idx} de {Total} (x{Copias})
                    //              (ej: Bandera (1,60)-SUB-9408_PROP851uy_Arch 1 de 1 (x1))
                    // RESTO DE ÁREAS: {ORDEN}_{CLIENTE}_{TRABAJO} Archivo {Idx} de {Total} (x{Copias} COPIAS) — como siempre
                    let baseName;
                    if (await usaNombreNuevo(file.AreaID)) {
                        baseName = construirNombreArchivo({
                            material: materialParaNombre(file.Material, file.PreTelaCliente),
                            codigoOrden: file.CodigoOrden || file.OrdenID.toString(),
                            cliente: file.Cliente,
                            idx: file.idxInOrder,
                            total: file.totalInOrder,
                            copias: file.Copias || 1,
                            dorso: /DORSO/i.test(file.NombreArchivo || '') // el dorso sigue marcado como tal
                        });
                    } else {
                        const pCodigo = sanitize(file.CodigoOrden || file.OrdenID.toString());
                        const pCliente = sanitize(file.Cliente || 'Cliente');

                        let pTrabajo = sanitize(file.DescripcionTrabajo || 'Trabajo');
                        if (pTrabajo.length > 50) pTrabajo = pTrabajo.substring(0, 50); // Prevent path overflow

                        // EJEMPLO: 61 (1-1)_GOAT_trabajo 2 Archivo 1 de 1 (x1 COPIAS)
                        baseName = `${pCodigo}_${pCliente}_${pTrabajo} Archivo ${file.idxInOrder} de ${file.totalInOrder} (x${file.Copias || 1} COPIAS)`;
                    }

                    // Determinar si ya tenemos ruta local válida y el archivo existe
                    let destPath = '';
                    let needsDownload = true;

                    // Forzamos descarga/renombre si el usuario lo pide explicitamente (implícito en la llamada individual)
                    // Pero para ser eficientes, checkeamos existencia y nombre.
                    if (file.RutaLocal && fs.existsSync(file.RutaLocal)) {
                        const existingName = path.basename(file.RutaLocal, path.extname(file.RutaLocal));
                        if (existingName === baseName) {
                            destPath = file.RutaLocal;
                            needsDownload = false;
                            logger.info(`      ✅ Usando copia local existente(Nombre correcto): ${destPath}`);
                        } else {
                            logger.info(`      ⚠️ RutaLocal existe pero nombre difiere.Se generará nuevo con nombre correcto.`);
                        }
                    }

                    if (needsDownload) {
                        const tempPath = path.join(targetDir, `${baseName}.tmp`);
                        let sourcePath = file.RutaAlmacenamiento || '';
                        let isDrive = false;
                        let driveFileId = null;

                        if (sourcePath.includes('drive.google.com')) {
                            const dId = getDriveId(sourcePath);
                            if (dId) {
                                isDrive = true;
                                driveFileId = dId;
                            }
                        }

                        // ... Downloading Logic ...
                        try {
                            if (isDrive && driveFileId) {
                                logger.info(`      🚀 Descargando archivo de Drive usando API autorizada (ID: ${driveFileId})...`);
                                const { stream } = await driveService.getFileStream(driveFileId);
                                const writer = fs.createWriteStream(tempPath);
                                stream.pipe(writer);
                                await new Promise((resolve, reject) => {
                                    writer.on('finish', resolve);
                                    writer.on('error', reject);
                                });
                            } else if (sourcePath.startsWith('http')) {
                                await downloadStream(sourcePath, tempPath);
                            } else if (fs.existsSync(sourcePath)) {
                                fs.copyFileSync(sourcePath, tempPath);
                            } else {
                                logger.warn(`      ⚠️ Source not found: ${sourcePath}`);
                                continue;
                            }
                        } catch (dlErr) {
                            logger.warn(`      ⚠️ Download Error ${file.ArchivoID}: ${dlErr.message}`);
                            continue;
                        }

                        // ... Rename Logic ...
                        let finalExt = path.extname(file.NombreArchivo || '').toLowerCase(); // Default to original extension

                        try {
                            const fd = fs.openSync(tempPath, 'r');
                            const buffer = Buffer.alloc(4);
                            fs.readSync(fd, buffer, 0, 4, 0);
                            fs.closeSync(fd);

                            const magicHex = buffer.toString('hex').toUpperCase();

                            if (magicHex.startsWith('25504446')) {
                                finalExt = '.pdf';
                            } else if (magicHex.startsWith('89504E47')) {
                                finalExt = '.png';
                            } else if (magicHex.startsWith('FFD8FF')) {
                                finalExt = '.jpg';
                            } else if (magicHex.startsWith('504B0304')) {
                                // ZIP or Office file, check further if needed, or assume zip
                                // finalExt = '.zip'; 
                            } else if (magicHex.startsWith('38425053')) {
                                finalExt = '.psd';
                            }

                            // Fallbacks
                            if (!finalExt || finalExt === '.dat') {
                                const urlExt = path.extname(file.RutaAlmacenamiento || '').split('?')[0].toLowerCase();
                                if (['.jpg', '.jpeg', '.png', '.pdf', '.tiff', '.tif', '.psd', '.ai', '.eps'].includes(urlExt)) {
                                    finalExt = urlExt;
                                } else {
                                    finalExt = '.pdf'; // Last resort default
                                }
                            }
                            if (finalExt === '.jpeg') finalExt = '.jpg';

                        } catch (e) {
                            if (!finalExt) finalExt = '.pdf';
                        }

                        let fileNameWithExt = baseName;
                        if (!fileNameWithExt.toLowerCase().endsWith(finalExt.toLowerCase())) fileNameWithExt += finalExt;

                        destPath = path.join(targetDir, fileNameWithExt);
                        if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch (e) { }
                        fs.renameSync(tempPath, destPath);

                        // UPDATE RUTA LOCAL Y NOMBRE ARCHIVO
                        await pool.request()
                            .input('ID', sql.Int, file.ArchivoID)
                            .input('R', sql.VarChar(500), destPath)
                            .input('N', sql.VarChar(255), fileNameWithExt)
                            .query("UPDATE dbo.ArchivosOrden SET RutaLocal=@R, NombreArchivo=@N WHERE ArchivoID=@ID");
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
                                    const uu = getPdfUserUnit(pages[0]);
                                    widthM = cmToM(pointsToCm(width * uu));
                                    heightM = cmToM(pointsToCm(height * uu));
                                    measureDone = true;
                                }
                            } catch (pdfErr) {
                                logger.warn(`      ⚠️ PDF-LIB failed (${pdfErr.message}). Trying fallback to Image...`);
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
                        logger.warn(`      ⚠️ Error midiendo archivo ${file.ArchivoID}: ${measureErr.message} | HEAD: ${headDump}`);
                    }

                    // E. Actualizar BD si tenemos medidas válidas
                    if (widthM > 0 && heightM > 0) {
                        logger.info(`      ✅ Medidas obtenidas: ${widthM.toFixed(2)}m x ${heightM.toFixed(2)}m`);

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
                            valorMetros = heightM;
                        }

                        await pool.request()
                            .input('ID', sql.Int, file.ArchivoID)
                            .input('M', sql.Decimal(10, 2), valorMetros)
                            .input('W', sql.Decimal(10, 2), widthM)
                            .input('H', sql.Decimal(10, 2), heightM)
                            .query("UPDATE dbo.ArchivosOrden SET Metros=@M, Ancho=@W, Alto=@H, MedidaConfirmada=1 WHERE ArchivoID=@ID");

                        // Recalcular Magnitud Global de la Orden.
                        // TPU queda AFUERA (mismo guard que ordersController.recalculateOrderMagnitude):
                        // su Magnitud es la CANTIDAD PEDIDA en unidades, fijada al crear el pedido, y
                        // sus archivos son las capas del arte, no unidades. Acá además el boceto no
                        // tiene metros, así que el recálculo daría 0 y le borraría la cantidad.
                        // [PRO] Producción (prendas) también: su Magnitud es la CANTIDAD DE PRENDAS,
                        // editable a mano en el detalle — medir un arte no debe pisarla.
                        // Va como condición del UPDATE y no como SELECT aparte para no agregar un viaje
                        // más a la base en un bucle que corre por cada archivo medido.
                        await pool.request()
                            .input('OID', sql.Int, file.OrdenID)
                            .query(`
                                DECLARE @TotalProd DECIMAL(18,2) = 0;
                                DECLARE @TotalServ DECIMAL(18,2) = 0;
                                SELECT @TotalProd = SUM(ISNULL(Metros, 0) * ISNULL(Copias, 1))
                                FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo != 'CANCELADO';
                                -- Los servicios extra son UNIDADES (ojales, soldaduras): no se
                                -- suman a los metros de impresión — cada uno se cobra en su
                                -- propia línea. Solo hacen de magnitud si no hay archivos.
                                IF ISNULL(@TotalProd, 0) = 0
                                    SELECT @TotalServ = SUM(ISNULL(Cantidad, 0)) FROM ServiciosExtraOrden WHERE OrdenID = @OID;
                                UPDATE dbo.Ordenes SET Magnitud = CAST((ISNULL(@TotalProd, 0) + ISNULL(@TotalServ, 0)) AS NVARCHAR(50))
                                WHERE OrdenID = @OID AND UPPER(LTRIM(RTRIM(ISNULL(AreaID, '')))) NOT IN ('TPU', 'PRO')
                            `);

                        if (io) {
                            io.emit('server:order_updated', { orderId: file.OrdenID });
                        }
                    }

                } catch (fileErr) {
                    logger.error(`      ❌ Error procesando archivo ${file.ArchivoID}:`, fileErr.message);
                }
            }

            // Recotizar el pedido tras medir — SOLO cuando el llamador lo pide (ej. subida
            // manual desde el detalle de la orden PRO): la medida recién calculada cambió la
            // magnitud de la orden destino y el importe debe seguirla. El flujo de creación
            // del portal NO usa esto (cotiza aparte, en su propio circuito).
            if (opts.recotizarPedido) {
                try {
                    // require acá adentro (no arriba) para no crear un ciclo con ordersController
                    const { recotizarPedidoDeOrden } = require('../controllers/ordersController');
                    for (const oid of orderIds) {
                        await recotizarPedidoDeOrden(pool, oid);
                    }
                } catch (eCot) {
                    logger.error('[FileProcessing] Error recotizando tras medición: ' + eCot.message);
                }
            }

            logger.info(`⚡ [FileProcessing] Proceso finalizado.`);
            if (io) io.emit('server:ordersUpdated', { count: 1 }); // Refresh general

        } catch (err) {
            logger.error("❌ [FileProcessing] Error general:", err);
        }
    });
};

exports.processOrderList = processOrderListInternal;

/**
 * Nueva función para procesar lista de ARCHIVOS específicos.
 * Internamente resuelve las Órdenes y reutiliza processOrderList con filtro.
 */
exports.processFiles = async (fileIds, io, opts = {}) => {
    if (!fileIds || fileIds.length === 0) return;
    try {
        const pool = await getPool();
        // Obtener IDs de orden asociados
        const fileIdsStr = fileIds.join(',');
        const res = await pool.request().query(`SELECT DISTINCT OrdenID FROM dbo.ArchivosOrden WHERE ArchivoID IN (${fileIdsStr})`);

        const orderIds = res.recordset.map(r => r.OrdenID);
        if (orderIds.length > 0) {
            // Llamar a processOrderListInternal pasando los fileIds como target
            await processOrderListInternal(orderIds, io, fileIds, opts);
        }
    } catch (err) {
        logger.error("Error processFiles:", err);
    }
};
