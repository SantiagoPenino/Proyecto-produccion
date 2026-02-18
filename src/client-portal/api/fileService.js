export const STORAGE_TYPE = 'BASE64';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
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

const getMimeTypeFromMagic = (base64) => {
    const header = base64.split(',')[1]?.substring(0, 20) || '';
    if (header.startsWith('iVBORw0KGgo')) return 'image/png';
    if (header.startsWith('/9j/')) return 'image/jpeg';
    if (header.startsWith('JVBERi')) return 'application/pdf';
    return null;
};

const getPdfDimensionsFromFile = (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        // Leemos los primeros 50KB (suficiente para la mayoría de headers PDF)
        const blob = file.slice(0, 50000);
        reader.readAsText(blob, 'latin1'); // 'latin1' mapea bytes 0-255 a caracteres 1:1

        reader.onload = (e) => {
            try {
                const data = e.target.result;

                // Buscar MediaBox o CropBox
                // Ejemplo: /MediaBox [0 0 595.28 841.89]
                // Soporta saltos de línea y espacios múltiples
                const boxRegex = /\/(MediaBox|CropBox)\s*\[\s*(-?[\d\.]+)\s+(-?[\d\.]+)\s+(-?[\d\.]+)\s+(-?[\d\.]+)\s*\]/;
                const match = data.match(boxRegex);

                if (match) {
                    const x1 = parseFloat(match[2]);
                    const y1 = parseFloat(match[3]);
                    const x2 = parseFloat(match[4]);
                    const y2 = parseFloat(match[5]);

                    let widthInPoints = Math.abs(x2 - x1);
                    let heightInPoints = Math.abs(y2 - y1);

                    // Detectar rotación (/Rotate 90)
                    const rotateMatch = data.match(/\/Rotate\s+(\d+)/);
                    if (rotateMatch) {
                        const rotation = parseInt(rotateMatch[1]);
                        if (rotation === 90 || rotation === 270) {
                            [widthInPoints, heightInPoints] = [heightInPoints, widthInPoints];
                        }
                    }

                    // --- CONVERSIÓN CRÍTICA A METROS ---
                    // 72 puntos = 1 pulgada
                    // 1 pulgada = 0.0254 metros
                    const widthInMeters = (widthInPoints / 72) * 0.0254;
                    const heightInMeters = (heightInPoints / 72) * 0.0254;

                    console.log(`[PDF PARSER] Puntos: ${widthInPoints}x${heightInPoints} -> Metros: ${widthInMeters.toFixed(3)}x${heightInMeters.toFixed(3)}`);

                    resolve({
                        width: parseFloat(widthInMeters.toFixed(3)),
                        height: parseFloat(heightInMeters.toFixed(3)),
                        unit: 'meters'
                    });
                    return;
                }
                console.warn("[PDF PARSER] No se encontró MediaBox en los primeros 50KB.");
                resolve(null);
            } catch (err) {
                console.error("[PDF PARSER] Error analizando contenido:", err);
                resolve(null);
            }
        };
        reader.onerror = () => {
            console.error("[PDF PARSER] Error leyendo archivo");
            resolve(null);
        };
    });
};

export const fileService = {
    // Returns { name, data: 'data:image...', size, type, width, height, measurementError, originalFile, unit }
    uploadFile: async (file) => {
        const validation = validateFile(file);
        if (!validation.valid) throw new Error(validation.error);

        try {
            // Leemos Base64 para preview (opcional/necesario para imgs)
            const base64Data = await fileToBase64(file);

            // Detectar tipo: Confiar en extensión si es PDF para forzar intento
            let detectedType = getMimeTypeFromMagic(base64Data) || file.type;
            if (file.name.toLowerCase().endsWith('.pdf')) detectedType = 'application/pdf';

            let dimensions = { width: null, height: null, unit: null };
            let measurementError = null;

            if (detectedType.startsWith('image/')) {
                const dims = await getImageDimensions(base64Data);
                if (dims) {
                    dimensions = { ...dims, unit: 'px' };
                } else {
                    measurementError = "Formato de imagen no procesable para medida";
                }
            } else if (detectedType === 'application/pdf') {
                // USAR NUEVA FUNCIÓN ROBUSTA
                const dims = await getPdfDimensionsFromFile(file);
                if (dims) {
                    dimensions = dims;
                } else {
                    measurementError = "No se pudo extraer dimensiones vectoriales (MediaBox) del PDF";
                }
            } else {
                measurementError = `Tipo de archivo (${detectedType}) no soportado para medida automática`;
            }

            return {
                name: file.name,
                preview: base64Data.substring(0, 500) + '...',
                fileData: file,
                size: file.size,
                type: detectedType,
                width: dimensions.width,
                height: dimensions.height,
                unit: dimensions.unit,
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
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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
