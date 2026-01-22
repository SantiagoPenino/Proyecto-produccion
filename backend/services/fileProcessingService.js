const { getPool, sql } = require('../config/db');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

// --- HELPERS ---
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

    // No bloqueamos el hilo principal con await aqui, pero queremos loguear progreso
    // Ejecutamos en "background" real (aunque Node es single thread, esto corre tras el response)

    setImmediate(async () => {
        try {
            const pool = await getPool();

            // 1. Obtener archivos de las órdenes indicadas
            // Solo procesamos archivos "Pendientes" de medición (o todos si queremos forzar)
            // Por eficiencia, asumimos que si Metros=0 hay que medir
            const idsStr = orderIds.join(',');
            const filesRes = await pool.request().query(`
                SELECT AO.ArchivoID, AO.RutaAlmacenamiento, AO.NombreArchivo, AO.Copias,
                       O.OrdenID, O.CodigoOrden, O.Cliente, O.DescripcionTrabajo, O.Material
                FROM dbo.ArchivosOrden AO
                INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
                WHERE AO.OrdenID IN (${idsStr}) 
                AND (AO.Metros = 0 OR AO.Metros IS NULL) -- Solo procesar no medidos
                AND AO.EstadoArchivo != 'CANCELADO'
            `);

            const files = filesRes.recordset;
            console.log(`   📂 [FileProcessing] Encontrados ${files.length} archivos para medir.`);

            if (files.length === 0) return;

            const targetDir = 'C:\\ORDENES';
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

            for (const file of files) {
                try {
                    console.log(`      Medio: ${file.NombreArchivo} (ID: ${file.ArchivoID})...`);
                    const sourcePath = file.RutaAlmacenamiento || '';
                    let tempBuffer = null;

                    // A. Descargar / Leer
                    if (sourcePath.includes('drive.google.com')) {
                        const driveId = getDriveId(sourcePath);
                        if (driveId) {
                            const res = await fetch(`https://drive.google.com/uc?export=download&id=${driveId}`);
                            if (res.ok) tempBuffer = Buffer.from(await res.arrayBuffer());
                        }
                    } else if (sourcePath.startsWith('http')) {
                        const res = await fetch(sourcePath);
                        if (res.ok) tempBuffer = Buffer.from(await res.arrayBuffer());
                    } else if (fs.existsSync(sourcePath)) {
                        tempBuffer = fs.readFileSync(sourcePath);
                    }

                    if (!tempBuffer) {
                        console.warn(`      ⚠️ No se pudo leer buffer para archivo ${file.ArchivoID}`);
                        continue;
                    }

                    // B. Determinar Extensión y Nombre Local
                    const sanitize = (str) => (str || '').replace(/[<>:"/\\|?*]/g, '-').trim();
                    const ext = path.extname(file.NombreArchivo || '') || '.pdf';
                    let finalExt = ext;
                    if (!finalExt && tempBuffer.slice(0, 4).toString() === '%PDF') finalExt = '.pdf';

                    // Construcción inteligente de nombre
                    let baseName = file.NombreArchivo;
                    if (!baseName || baseName.length < 3) {
                        const partOrder = sanitize(file.CodigoOrden || file.OrdenID.toString());
                        const partCopies = sanitize((file.Copias || 1).toString());
                        const partMaterial = sanitize(file.Material || 'Mat');
                        baseName = `${partOrder}-${partMaterial}-x${partCopies}`;
                    } else {
                        baseName = sanitize(baseName);
                    }

                    if (!baseName.toLowerCase().endsWith(finalExt.toLowerCase())) {
                        baseName += finalExt;
                    }

                    // C. Guardar Local
                    const destPath = path.join(targetDir, baseName);
                    fs.writeFileSync(destPath, tempBuffer);

                    // D. Medir (Dimensiones Reales)
                    let widthM = 0;
                    let heightM = 0;

                    try {
                        const isPdf = finalExt.toLowerCase() === '.pdf';
                        if (isPdf) {
                            const pdfDoc = await PDFDocument.load(tempBuffer, { updateMetadata: false });
                            const pages = pdfDoc.getPages();
                            if (pages.length > 0) {
                                const { width, height } = pages[0].getSize();
                                widthM = cmToM(pointsToCm(width));
                                heightM = cmToM(pointsToCm(height));
                            }
                        } else {
                            // Imagen (Sharp)
                            const m = await sharp(tempBuffer).metadata();
                            widthM = cmToM(pixelsToCm(m.width, m.density || 72));
                            heightM = cmToM(pixelsToCm(m.height, m.density || 72));
                        }
                    } catch (measureErr) {
                        console.warn(`      ⚠️ Error midiendo archivo ${file.ArchivoID}: ${measureErr.message}`);
                    }

                    // E. Actualizar BD si tenemos medidas válidas
                    if (widthM > 0 && heightM > 0) {
                        console.log(`      ✅ Medidas obtenidas: ${widthM.toFixed(2)}m x ${heightM.toFixed(2)}m`);

                        // Actualizar Archivo
                        await pool.request()
                            .input('ID', sql.Int, file.ArchivoID)
                            .input('M', sql.Decimal(10, 2), heightM) // Usamos Alto como 'Metros' lineal principal por defecto, o logica de área?
                            .input('W', sql.Decimal(10, 2), widthM)
                            .input('H', sql.Decimal(10, 2), heightM)
                            .input('Ruta', sql.VarChar(500), destPath) // Actualizamos ruta a local
                            .query("UPDATE dbo.ArchivosOrden SET Metros=@M, Ancho=@W, Alto=@H, RutaAlmacenamiento=@Ruta WHERE ArchivoID=@ID");

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
                            // Opcional: Evento especifico si el front lo soportara
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
