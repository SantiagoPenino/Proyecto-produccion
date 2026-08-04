import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Worker configurado para Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export const STORAGE_TYPE = 'BASE64';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
const ALLOWED_FORMATS = [
    'image/png', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
];

export const validateFile = (file, { allowJpeg = false } = {}) => {
    if (!file) return { valid: false, error: 'No file selected' };
    if (file.size > MAX_FILE_SIZE) return { valid: false, error: 'Excede 500MB' };
    // JPEG por default no se permite en producción (el arte va en PNG con transparencia o PDF).
    // Excepción: sublimación lo acepta (allowJpeg) — ahí no se necesita canal alpha.
    const ext = (file.name?.split('.').pop() || '').toLowerCase();
    const mime = (file.type || '').toLowerCase();
    if (!allowJpeg && (mime === 'image/jpeg' || mime === 'image/jpg' || ext === 'jpg' || ext === 'jpeg')) {
        return { valid: false, error: 'No se permiten archivos JPEG. Subí el arte en PNG o PDF.' };
    }
    return { valid: true };
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

// Lee ancho/alto de un PNG desde su header (chunk IHDR), SIN decodificar la imagen.
// Necesario en mobile: iOS Safari no puede decodificar PNG grandes (>~16,7 MP) con <img>,
// pero el header son solo los primeros bytes, así que la medida sale igual.
const getPngDimensionsFromHeader = (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const buf = new Uint8Array(e.target.result);
                // Firma PNG (89 50 4E 47) + IHDR como primer chunk (bytes 12-15 = "IHDR")
                const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
                const isIHDR = buf[12] === 0x49 && buf[13] === 0x48 && buf[14] === 0x44 && buf[15] === 0x52;
                if (!isPng || !isIHDR) return resolve(null);
                // Width: bytes 16-19, Height: bytes 20-23 (uint32 big-endian)
                const u32 = (o) => (buf[o] * 0x1000000) + (buf[o + 1] << 16) + (buf[o + 2] << 8) + buf[o + 3];
                const width = u32(16);
                const height = u32(20);
                resolve(width > 0 && height > 0 ? { width, height } : null);
            } catch (_) {
                resolve(null);
            }
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file.slice(0, 24)); // solo el header
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
                                resolve({ dpiX, dpiY, hasDPI: true });
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
                                    resolve({ dpiX: xDensity, dpiY: yDensity, hasDPI: true });
                                    return;
                                } else if (densityUnit === 2 && xDensity > 0) { // dots/cm
                                    const dpiX = Math.round(xDensity * 2.54);
                                    const dpiY = Math.round(yDensity * 2.54);
                                    console.log(`[DPI] JPEG JFIF (cm): ${dpiX}x${dpiY} DPI`);
                                    resolve({ dpiX, dpiY, hasDPI: true });
                                    return;
                                }
                            }
                            break;
                        }
                    }
                }

                // No se encontró DPI → default 300
                console.log('[DPI] No se detectó DPI, usando 300 por defecto');
                resolve({ dpiX: 300, dpiY: 300, hasDPI: false });
            } catch (err) {
                console.warn('[DPI] Error leyendo DPI:', err);
                resolve({ dpiX: 300, dpiY: 300, hasDPI: false });
            }
        };
        reader.onerror = () => resolve({ dpiX: 300, dpiY: 300, hasDPI: false });
    });
};

const getMimeTypeFromMagic = (base64) => {
    const header = base64.split(',')[1]?.substring(0, 20) || '';
    if (header.startsWith('iVBORw0KGgo')) return 'image/png';
    if (header.startsWith('/9j/')) return 'image/jpeg';
    if (header.startsWith('JVBERi')) return 'application/pdf';
    return null;
};

// Magic number leyendo SOLO los primeros bytes. base64 codifica de a grupos de 3 bytes, así que
// el base64 de un slice arranca idéntico al del archivo completo: la firma se reconoce igual y
// no hay que convertir 77MB para mirar 11 caracteres.
const getMimeTypeFromHead = (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(getMimeTypeFromMagic(reader.result));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file.slice(0, 64));
    });
};

// Arriba de este tamaño el navegador NO cuenta páginas (ver uploadFile): contar obliga a cargar
// el archivo entero a RAM y en mobile es lo que rompe la subida. El backend valida el multipágina
// con pdf-lib y rechaza con motivo, que es la validación que manda.
const PAGE_COUNT_MAX_SIZE = 25 * 1024 * 1024; // 25MB

const getPdfDimensionsFromFile = (file) => {
    return new Promise((resolve) => {
        const headSize = Math.min(file.size, 500000);
        // Leer la cola SIEMPRE que quede algo después del head (antes arrancaba recién en 1MB,
        // así que los archivos de 500KB–1MB nunca veían su propio final).
        const tailSize = file.size > headSize ? Math.min(3000000, file.size - headSize) : 0;

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
            // /UserUnit N: multiplicador de unidad. Los PDF de más de ~5.08m (límite de 14400pt)
            // vienen con UserUnit (ej. 10) — ignorarlo mide el trabajo N veces más chico.
            const userUnitMatch = result.data.match(/\/UserUnit\s+([\d.]+)/);
            const userUnit = userUnitMatch ? (parseFloat(userUnitMatch[1]) || 1) : 1;
            const widthInMeters = (widthInPoints * userUnit / 72) * 0.0254;
            const heightInMeters = (heightInPoints * userUnit / 72) * 0.0254;
            console.log(`[PDF PARSER] ${result.type}: ${widthInPoints.toFixed(1)}x${heightInPoints.toFixed(1)}pt${userUnit !== 1 ? ` (UserUnit ${userUnit})` : ''} → ${widthInMeters.toFixed(3)}x${heightInMeters.toFixed(3)}m`);
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
                // NO cortar acá aunque el head ya traiga un MediaBox: los PDF guardados de forma
                // INCREMENTAL (Illustrator) dejan la página vieja al principio del archivo y anexan
                // la vigente al final. Quedarse con la del head devuelve la medida de una versión
                // anterior del arte (caso real: 0,21 × 0,53 m en vez de 0,78 × 2,00 m).
                // El final del archivo es la única fuente confiable: ahí está lo último que se guardó.
                if (tailSize > 0) {
                    const tailReader = new FileReader();
                    tailReader.onload = (e2) => {
                        try {
                            const tailResult = searchMediaBox(e2.target.result);
                            // El final manda: es lo último que se guardó, o sea la versión vigente
                            // de la página. Al head se cae solo si en la cola no había ninguna caja.
                            finalize(tailResult || headResult);
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
    uploadFile: async (file, opts = {}) => {
        const validation = validateFile(file, opts);
        if (!validation.valid) throw new Error(validation.error);

        try {
            // El archivo NUNCA se copia a RAM acá: el object URL es una referencia al Blob y el tipo
            // sale de los primeros 64 bytes. Antes todo lo que bajaba de 500MB pasaba por
            // fileToBase64 → un string de ~1,4x el tamaño del archivo, que después se tiraba entero
            // salvo 500 caracteres guardados en `preview`, campo que no lee nadie. En desktop no se
            // notaba; en un celular un PDF de 77MB se comía ~250MB de heap entre esto y el conteo de
            // páginas, y la subida moría sin llegar a mandar un byte (nginx ni la registraba).
            const previewData = URL.createObjectURL(file);

            let detectedType = await getMimeTypeFromHead(file) || file.type || 'application/octet-stream';
            if (file.name.toLowerCase().endsWith('.pdf')) detectedType = 'application/pdf';

            let dimensions = { width: null, height: null, unit: null };
            let measurementError = null;
            let pageCount = null;
            let hasDPI = true; // Por defecto true (para pdfs o si no aplica)

            if (detectedType.startsWith('image/')) {
                // 1) Intentar leer dimensiones del HEADER (PNG IHDR), sin decodificar la imagen.
                //    En mobile iOS Safari no decodifica PNG grandes (>~16,7 MP) con <img>.
                // 2) Fallback a <img> para otros formatos o si el header no se pudo leer.
                let dims = await getPngDimensionsFromHeader(file);
                if (!dims) dims = await getImageDimensions(previewData);
                if (dims) {
                    // Leer DPI real del archivo (no asumir 300)
                    const dpiResult = await getImageDPI(file);
                    hasDPI = dpiResult.hasDPI !== false;
                    const widthM = (dims.width / dpiResult.dpiX) * 0.0254;
                    const heightM = (dims.height / dpiResult.dpiY) * 0.0254;
                    console.log(`[IMG] ${dims.width}x${dims.height}px @ ${dpiResult.dpiX}DPI → ${widthM.toFixed(3)}x${heightM.toFixed(3)}m`);
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

                        // pdf.js expone /UserUnit por página (PDFs gigantes: sin esto se mide N veces más chico)
                        const uu = page.userUnit || 1;
                        const widthM = (widthPt * uu / 72) * 0.0254;
                        const heightM = (heightPt * uu / 72) * 0.0254;
                        console.log(`[PDF PARSER] pdf.js: ${widthPt.toFixed(1)}x${heightPt.toFixed(1)}pt${uu !== 1 ? ` (UserUnit ${uu})` : ''} → ${widthM.toFixed(3)}x${heightM.toFixed(3)}m`);
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
                        // El guard de tamaño es lo que evita el arrayBuffer() del archivo entero.
                        // Si no se cuenta, pageCount queda null y no se bloquea acá: el multipágina
                        // lo corta el backend (uploadOrderFile, pdf-lib) con el motivo concreto.
                        if (!pageCount && file.size <= PAGE_COUNT_MAX_SIZE) {
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

                                const uuPage = page.userUnit || 1;
                                const pageW = (widthPt * uuPage / 72) * 0.0254;
                                const pageH = (heightPt * uuPage / 72) * 0.0254;
                                
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
                preview: previewData,
                fileData: file,
                size: file.size,
                type: detectedType,
                width: dimensions.width,
                height: dimensions.height,
                unit: dimensions.unit,
                pageCount: pageCount,
                measurementError: measurementError,
                hasDPI: hasDPI
            };
        } catch (error) {
            console.error("Error converting file:", error);
            throw new Error("Error procesando el archivo");
        }
    },

    // Nueva función para subir por Streaming (FormData)
    uploadStream: async (file, metadata, onProgress) => {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('dbId', metadata.dbId);
            formData.append('type', metadata.type);
            formData.append('finalName', metadata.finalName);
            formData.append('area', metadata.area || '');
            // Extraer codigoOrden del finalName (ej: 'DTF-1072_CLIENTE_arch.pdf' → 'DTF-1072')
            if (metadata.finalName) {
                const m = metadata.finalName.match(/^([A-Z]+-\d+)/i);
                if (m) formData.append('codigoOrden', m[1]);
            }

            const token = localStorage.getItem('auth_token'); // CORREGIDO: key 'auth_token'
            const apiUrl = import.meta.env.VITE_API_URL || '/api';

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${apiUrl}/web-orders/upload-stream`, true);
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
            // Modo diseñador: subir el archivo EN NOMBRE del cliente elegido (validado server-side)
            try {
                const dc = JSON.parse(localStorage.getItem('designer_cliente') || 'null');
                if (dc?.codCliente) xhr.setRequestHeader('X-Cliente-CodCliente', String(dc.codCliente));
            } catch (_) { }

            if (onProgress) {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        onProgress(event.loaded, event.total);
                    }
                };
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        resolve(xhr.responseText);
                    }
                } else {
                    let errorMsg = 'Error en subida';
                    try {
                        const err = JSON.parse(xhr.responseText);
                        errorMsg = err.error || errorMsg;
                    } catch (e) { }
                    reject(new Error(errorMsg));
                }
            };

            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.send(formData);
        });
    }
};
