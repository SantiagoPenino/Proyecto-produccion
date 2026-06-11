import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Worker configurado para Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export const STORAGE_TYPE = 'BASE64';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
const ALLOWED_FORMATS = [
    'image/png', 'image/jpeg', 'image/jpg', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
];

export const validateFile = (file) => {
    if (!file) return { valid: false, error: 'No file selected' };
    if (file.size > MAX_FILE_SIZE) return { valid: false, error: 'Excede 500MB' };
    return { valid: true };
};

const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
};

const getImageDimensions = (base64) => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.width, height: img.height });
        };
        img.onerror = () => resolve(null);
        img.src = base64;
    });
};

// Leer DPI real desde los bytes del archivo (PNG pHYs / JPEG JFIF/EXIF)
const getImageDPI = (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        // Leemos los primeros 64KB (suficiente para headers)
        reader.readAsArrayBuffer(file.slice(0, 65536));
        reader.onload = (e) => {
            try {
                const buf = new Uint8Array(e.target.result);

                // --- PNG: buscar chunk pHYs ---
                if (buf[0] === 0x89 && buf[1] === 0x50) { // PNG signature
                    for (let i = 8; i < buf.length - 12; i++) {
                        // Buscar "pHYs" (70 48 59 73)
                        if (buf[i + 4] === 0x70 && buf[i + 5] === 0x48 && buf[i + 6] === 0x59 && buf[i + 7] === 0x73) {
                            const dataStart = i + 8;
                            const ppuX = (buf[dataStart] << 24) | (buf[dataStart + 1] << 16) | (buf[dataStart + 2] << 8) | buf[dataStart + 3];
                            const ppuY = (buf[dataStart + 4] << 24) | (buf[dataStart + 5] << 16) | (buf[dataStart + 6] << 8) | buf[dataStart + 7];
                            const unit = buf[dataStart + 8]; // 1 = metros
                            if (unit === 1 && ppuX > 0 && ppuY > 0) {
                                // pHYs da pixels por metro directamente
                                const dpiX = Math.round(ppuX / 39.3701); // px/m → px/inch
                                const dpiY = Math.round(ppuY / 39.3701);
                                console.log(`[DPI] PNG pHYs: ${dpiX}x${dpiY} DPI`);
                                resolve({ dpiX, dpiY });
                                return;
                            }
                            break;
                        }
                        // Saltar al siguiente chunk
                        const chunkLen = (buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3];
                        i += chunkLen + 11; // length(4) + type(4) + data + crc(4) - 1
                    }
                }

                // --- JPEG: buscar JFIF APP0 ---
                if (buf[0] === 0xFF && buf[1] === 0xD8) { // JPEG SOI
                    for (let i = 2; i < buf.length - 20; i++) {
                        // APP0 JFIF marker
                        if (buf[i] === 0xFF && buf[i + 1] === 0xE0) {
                            const jfif = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7], buf[i + 8]);
                            if (jfif === 'JFIF\x00') {
                                const densityUnit = buf[i + 9];
                                const xDensity = (buf[i + 10] << 8) | buf[i + 11];
                                const yDensity = (buf[i + 12] << 8) | buf[i + 13];
                                if (densityUnit === 1 && xDensity > 0) { // DPI
                                    console.log(`[DPI] JPEG JFIF: ${xDensity}x${yDensity} DPI`);
                                    resolve({ dpiX: xDensity, dpiY: yDensity });
                                    return;
                                } else if (densityUnit === 2 && xDensity > 0) { // dots/cm
                                    const dpiX = Math.round(xDensity * 2.54);
                                    const dpiY = Math.round(yDensity * 2.54);
                                    console.log(`[DPI] JPEG JFIF (cm): ${dpiX}x${dpiY} DPI`);
                                    resolve({ dpiX, dpiY });
                                    return;
                                }
                            }
                            break;
                        }
                    }
                }

                // No se encontró DPI → default 300
                console.log('[DPI] No se detectó DPI, usando 300 por defecto');
                resolve({ dpiX: 300, dpiY: 300 });
            } catch (err) {
                console.warn('[DPI] Error leyendo DPI:', err);
                resolve({ dpiX: 300, dpiY: 300 });
            }
        };
        reader.onerror = () => resolve({ dpiX: 300, dpiY: 300 });
    });
};

const getMimeTypeFromMagic = (base64) => {
    const header = base64.split(',')[1]?.substring(0, 20) || '';
    if (header.startsWith('iVBORw0KGgo')) return 'image/png';
    if (header.startsWith('/9j/')) return 'image/jpeg';
    if (header.startsWith('JVBERi')) return 'application/pdf';
    return null;
};

const getPdfDimensionsFromFile = (file) => {
    return new Promise((resolve) => {
        const headSize = Math.min(file.size, 500000);
        const tailSize = file.size > 1000000 ? Math.min(3000000, file.size - headSize) : 0;

        const searchMediaBox = (text) => {
            const data = text.replace(/\r\n?/g, ' ').replace(/\n/g, ' ');
            const boxRegex = /\/(MediaBox|CropBox)\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g;
            let largestMediaBox = null;
            let fallback = null;
            let match;
            while ((match = boxRegex.exec(data)) !== null) {
                const boxType = match[1];
                const w = Math.abs(parseFloat(match[4]) - parseFloat(match[2]));
                const h = Math.abs(parseFloat(match[5]) - parseFloat(match[3]));
                if (w < 1 || h < 1) continue;
                if (boxType === 'MediaBox') {
                    // Quedarnos con el MediaBox más grande (página de impresión)
                    if (!largestMediaBox || (w * h) > (largestMediaBox.w * largestMediaBox.h)) {
                        largestMediaBox = { type: boxType, w, h, data };
                    }
                } else if (!fallback) {
                    fallback = { type: boxType, w, h, data };
                }
            }
            return largestMediaBox || fallback;
        };

        const finalize = (result) => {
            if (!result) {
                console.warn(`[PDF PARSER] No se encontró MediaBox/CropBox en el PDF.`);
                resolve(null);
                return;
            }
            let widthInPoints = result.w;
            let heightInPoints = result.h;
            const rotateMatch = result.data.match(/\/Rotate\s+(\d+)/);
            if (rotateMatch) {
                const rotation = parseInt(rotateMatch[1]);
                if (rotation === 90 || rotation === 270) {
                    [widthInPoints, heightInPoints] = [heightInPoints, widthInPoints];
                }
            }
            const widthInMeters = (widthInPoints / 72) * 0.0254;
            const heightInMeters = (heightInPoints / 72) * 0.0254;
            console.log(`[PDF PARSER] ${result.type}: ${widthInPoints.toFixed(1)}x${heightInPoints.toFixed(1)}pt → ${widthInMeters.toFixed(3)}x${heightInMeters.toFixed(3)}m`);
            resolve({
                width: parseFloat(widthInMeters.toFixed(3)),
                height: parseFloat(heightInMeters.toFixed(3)),
                unit: 'meters'
            });
        };

        // Leer el inicio del PDF
        const headReader = new FileReader();
        headReader.onload = (e) => {
            try {
                const headResult = searchMediaBox(e.target.result);
                // Si encontramos MediaBox en el inicio, listo
                if (headResult && headResult.type === 'MediaBox') {
                    finalize(headResult);
                    return;
                }

                // Si el archivo es grande, leer también el final
                if (tailSize > 0) {
                    const tailReader = new FileReader();
                    tailReader.onload = (e2) => {
                        try {
                            const tailResult = searchMediaBox(e2.target.result);
                            // Priorizar MediaBox del tail, sino lo que tengamos
                            if (tailResult && tailResult.type === 'MediaBox') {
                                finalize(tailResult);
                            } else {
                                finalize(headResult || tailResult);
                            }
                        } catch (err) {
                            console.error("[PDF PARSER] Error leyendo tail:", err);
                            finalize(headResult);
                        }
                    };
                    tailReader.onerror = () => finalize(headResult);
                    tailReader.readAsText(file.slice(file.size - tailSize), 'latin1');
                } else {
                    finalize(headResult);
                }
            } catch (err) {
                console.error("[PDF PARSER] Error analizando contenido:", err);
                resolve(null);
            }
        };
        headReader.onerror = () => {
            console.error("[PDF PARSER] Error leyendo archivo");
            resolve(null);
        };
        headReader.readAsText(file.slice(0, headSize), 'latin1');
    });
};

export const fileService = {
    // Returns { name, data: 'data:image...', size, type, width, height, measurementError, originalFile, unit }
    uploadFile: async (file) => {
        const validation = validateFile(file);
        if (!validation.valid) throw new Error(validation.error);

        try {
            const LARGE_FILE = 500 * 1024 * 1024; // 500MB
            const isLarge = file.size > LARGE_FILE;

            // Archivos grandes: object URL (sin copiar a RAM). Chicos: base64 para preview.
            const previewData = isLarge ? URL.createObjectURL(file) : await fileToBase64(file);

            // Detectar tipo: para archivos grandes confiar en extensión, para chicos usar magic bytes
            let detectedType;
            if (isLarge) {
                detectedType = file.type || 'application/octet-stream';
            } else {
                detectedType = getMimeTypeFromMagic(previewData) || file.type;
            }
            if (file.name.toLowerCase().endsWith('.pdf')) detectedType = 'application/pdf';

            let dimensions = { width: null, height: null, unit: null };
            let measurementError = null;
            let pageCount = null;

            if (detectedType.startsWith('image/')) {
                // Para imágenes grandes, crear object URL temporal para getImageDimensions
                const imgSrc = isLarge ? previewData : previewData;
                const dims = await getImageDimensions(imgSrc);
                if (dims) {
                    // Leer DPI real del archivo (no asumir 300)
                    const { dpiX, dpiY } = await getImageDPI(file);
                    const widthM = (dims.width / dpiX) * 0.0254;
                    const heightM = (dims.height / dpiY) * 0.0254;
                    console.log(`[IMG] ${dims.width}x${dims.height}px @ ${dpiX}DPI → ${widthM.toFixed(3)}x${heightM.toFixed(3)}m`);
                    dimensions = {
                        width: parseFloat(widthM.toFixed(3)),
                        height: parseFloat(heightM.toFixed(3)),
                        unit: 'meters'
                    };
                } else {
                    measurementError = "Formato de imagen no procesable para medida";
                }
            } else if (detectedType === 'application/pdf') {
                // 1. Intentar parser rápido (regex sobre texto plano)
                let dims = await getPdfDimensionsFromFile(file);

                // 2. Fallback: usar pdf.js para PDFs con streams comprimidos
                if (!dims) {
                    try {
                        console.log('[PDF PARSER] Regex falló, usando pdf.js...');
                        const arrayBuffer = await file.arrayBuffer();
                        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                        pageCount = pdf.numPages;
                        const page = await pdf.getPage(1);

                        // Usar MediaBox directamente en vez de getViewport (que usa CropBox)
                        let widthPt, heightPt;
                        const mediaBox = page._pageInfo?.view || page.view;
                        if (mediaBox && mediaBox.length === 4) {
                            widthPt = Math.abs(mediaBox[2] - mediaBox[0]);
                            heightPt = Math.abs(mediaBox[3] - mediaBox[1]);
                        }

                        // Si no tenemos mediaBox, intentar desde la referencia interna
                        if (!widthPt || !heightPt) {
                            try {
                                const dict = page._pageInfo?.rawDict || page.pageDict;
                                const mb = dict?.get?.('MediaBox');
                                if (mb && mb.length === 4) {
                                    widthPt = Math.abs(mb[2] - mb[0]);
                                    heightPt = Math.abs(mb[3] - mb[1]);
                                }
                            } catch (e) { }
                        }

                        // Último fallback: viewport
                        if (!widthPt || !heightPt) {
                            const viewport = page.getViewport({ scale: 1 });
                            widthPt = viewport.width;
                            heightPt = viewport.height;
                        }

                        const widthM = (widthPt / 72) * 0.0254;
                        const heightM = (heightPt / 72) * 0.0254;
                        console.log(`[PDF PARSER] pdf.js: ${widthPt.toFixed(1)}x${heightPt.toFixed(1)}pt → ${widthM.toFixed(3)}x${heightM.toFixed(3)}m`);
                        dims = {
                            width: parseFloat(widthM.toFixed(3)),
                            height: parseFloat(heightM.toFixed(3)),
                            unit: 'meters'
                        };
                    } catch (pdfErr) {
                        console.error('[PDF PARSER] pdf.js también falló:', pdfErr.message);
                    }
                }

                if (dims) {
                    dimensions = dims;
                    // Si es multipágina, calcular el alto total (suma) y ancho máximo
                    try {
                        let pdfRef = null;
                        if (!pageCount) {
                            const arrayBuffer = await file.arrayBuffer();
                            pdfRef = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                            pageCount = pdfRef.numPages;
                        }
                        
                        if (pageCount > 1) {
                            // Cargar la referencia si no se cargó arriba (ej: vino del fallback)
                            if (!pdfRef) {
                                const arrayBuffer = await file.arrayBuffer();
                                pdfRef = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                            }
                            
                            let totalHeightM = 0;
                            let maxWidthM = 0;
                            
                            for (let i = 1; i <= pageCount; i++) {
                                const page = await pdfRef.getPage(i);
                                let widthPt, heightPt;
                                const mediaBox = page._pageInfo?.view || page.view;
                                if (mediaBox && mediaBox.length === 4) {
                                    widthPt = Math.abs(mediaBox[2] - mediaBox[0]);
                                    heightPt = Math.abs(mediaBox[3] - mediaBox[1]);
                                } else {
                                    try {
                                        const dict = page._pageInfo?.rawDict || page.pageDict;
                                        const mb = dict?.get?.('MediaBox');
                                        if (mb && mb.length === 4) {
                                            widthPt = Math.abs(mb[2] - mb[0]);
                                            heightPt = Math.abs(mb[3] - mb[1]);
                                        }
                                    } catch (e) {}
                                }
                                if (!widthPt || !heightPt) {
                                    const viewport = page.getViewport({ scale: 1 });
                                    widthPt = viewport.width;
                                    heightPt = viewport.height;
                                }
                                
                                const pageW = (widthPt / 72) * 0.0254;
                                const pageH = (heightPt / 72) * 0.0254;
                                
                                if (pageW > maxWidthM) maxWidthM = pageW;
                                totalHeightM += pageH;
                            }
                            
                            dimensions = {
                                width: parseFloat(maxWidthM.toFixed(3)),
                                height: parseFloat(totalHeightM.toFixed(3)),
                                unit: 'meters'
                            };
                            console.log(`[PDF PARSER] Suma de ${pageCount} páginas: Ancho Max = ${dimensions.width}m, Alto Total = ${dimensions.height}m`);
                        }
                    } catch (e) {
                        console.error('[PDF PARSER] Error sumando páginas de PDF:', e);
                    }
                } else {
                    measurementError = "No se pudo extraer dimensiones del PDF";
                }
            } else {
                measurementError = `Tipo de archivo (${detectedType}) no soportado para medida automática`;
            }

            return {
                name: file.name,
                preview: isLarge ? previewData : previewData.substring(0, 500) + '...',
                fileData: file,
                size: file.size,
                type: detectedType,
                width: dimensions.width,
                height: dimensions.height,
                unit: dimensions.unit,
                pageCount: pageCount,
                measurementError: measurementError
            };
        } catch (error) {
            console.error("Error converting file:", error);
            throw new Error("Error procesando el archivo");
        }
    },

    // Nueva función para subir por Streaming (FormData)
    uploadStream: async (file, metadata) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('dbId', metadata.dbId);
        formData.append('type', metadata.type);
        formData.append('finalName', metadata.finalName);
        formData.append('area', metadata.area);

        const token = localStorage.getItem('auth_token'); // CORREGIDO: key 'auth_token'
        const apiUrl = import.meta.env.VITE_API_URL || '/api';

        const response = await fetch(`${apiUrl}/web-orders/upload-stream`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (!response.ok) {
            let errorMsg = 'Error en subida';
            try {
                const err = await response.json();
                errorMsg = err.error || errorMsg;
            } catch (e) { }
            throw new Error(errorMsg);
        }

        return await response.json();
    }
};
