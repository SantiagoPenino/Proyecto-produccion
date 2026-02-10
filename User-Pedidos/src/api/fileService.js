export const STORAGE_TYPE = 'BASE64';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const ALLOWED_FORMATS = [
    'image/png', 'image/jpeg', 'image/jpg', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
];

export const validateFile = (file) => {
    if (!file) return { valid: false, error: 'No file selected' };
    if (file.size > MAX_FILE_SIZE) return { valid: false, error: 'Excede 200MB' };
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

const getPdfDimensions = (base64) => {
    try {
        // Buscamos el MediaBox en los primeros 15KB del PDF (donde suele estar la cabecera)
        const binary = atob(base64.split(',')[1].substring(0, 15000));
        const mediaBoxMatch = binary.match(/\/MediaBox\s*\[\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\]/);
        if (mediaBoxMatch) {
            const w = parseFloat(mediaBoxMatch[3]) - parseFloat(mediaBoxMatch[1]);
            const h = parseFloat(mediaBoxMatch[4]) - parseFloat(mediaBoxMatch[2]);
            return { width: Math.abs(w), height: Math.abs(h) }; // En puntos (72 DPI)
        }
    } catch (e) {
        console.warn("Error parsing PDF header:", e);
    }
    return null;
};

export const fileService = {
    // Returns { name, data: 'data:image...', size, type, width, height, measurementError }
    uploadFile: async (file) => {
        const validation = validateFile(file);
        if (!validation.valid) throw new Error(validation.error);

        try {
            const base64Data = await fileToBase64(file);
            const detectedType = getMimeTypeFromMagic(base64Data) || file.type;

            let dimensions = { width: null, height: null };
            let measurementError = null;

            if (detectedType.startsWith('image/')) {
                const dims = await getImageDimensions(base64Data);
                if (dims) {
                    dimensions = dims;
                } else {
                    measurementError = "Formato de imagen no procesable para medida";
                }
            } else if (detectedType === 'application/pdf') {
                const dims = getPdfDimensions(base64Data);
                if (dims) {
                    // PDFs vienen en puntos (72 dpi). Convirtamos a "pixeles equivalentes de 300dpi" 
                    // para mantener consistencia con la lógica actual del front (px / 300)
                    dimensions = {
                        width: (dims.width / 72) * 300,
                        height: (dims.height / 72) * 300
                    };
                } else {
                    measurementError = "No se encontró MediaBox en el PDF";
                }
            } else {
                measurementError = `Tipo de archivo (${detectedType}) no soportado para medida automática`;
            }

            return {
                name: file.name,
                data: base64Data,
                size: file.size,
                type: detectedType,
                width: dimensions.width,
                height: dimensions.height,
                measurementError: measurementError
            };
        } catch (error) {
            console.error("Error converting file:", error);
            throw new Error("Error procesando el archivo");
        }
    }
};
