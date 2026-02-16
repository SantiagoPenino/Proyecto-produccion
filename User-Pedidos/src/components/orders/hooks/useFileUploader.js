import { useState, useCallback } from 'react';
import { fileService } from '../../../api/fileService'; // Reutilizamos tu servicio de API

/**
 * Hook especializado en manejo de archivos.
 * - Validación (Tamaño, Tipo).
 * - Procesamiento (Medidas Imagen vs PDF Vectorial).
 * - Cola de subida.
 */
export function useFileUploader() {
    const [uploadQueue, setUploadQueue] = useState([]);
    const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState(null);

    /**
     * Procesa un archivo localmente antes de subirlo.
     * Lee medidas y valida contra reglas de negocio.
     */
    const processFile = useCallback(async (file, config) => {
        try {
            // Lógica reutilizada de tu fileService (optimizado)
            const result = await fileService.uploadFile(file);

            // Regla de Negocio: Validar Ancho Máximo
            if (config?.maxMaterialWidth && result.width && !result.measurementError) {
                // Convertir pixels a metros solo si NO es ya metros
                const widthInMeters = result.unit === 'meters'
                    ? result.width
                    : (result.width / 300) * 0.0254;

                if (widthInMeters > config.maxMaterialWidth) {
                    throw new Error(`El ancho del archivo (${widthInMeters.toFixed(3)}m) excede el ancho imprimible (${config.maxMaterialWidth}m).`);
                }
            }

            if (result.measurementError) {
                console.warn(`[FileWarning] ${result.measurementError}`);
            }

            return { success: true, meta: result };
        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        }
    }, []);

    /**
     * Inicia la subida secuencial de archivos al servidor.
     * @param {Array} manifest - Lista de { originalName, dbId, type }
     * @param {Map} filesMap - Mapa de archivos locales { [originalName]: FileObject }
     */
    const startUploadStream = async (manifest, filesMap) => {
        setIsUploading(true);
        setUploadProgress({ current: 0, total: manifest.length });
        setError(null);

        try {
            for (let i = 0; i < manifest.length; i++) {
                const item = manifest[i];
                const fileObj = filesMap.get(item.originalName);

                if (!fileObj) {
                    console.warn(`Archivo no encontrado para subir: ${item.originalName}`);
                    continue; // Skip
                }

                // Subida real por streaming
                await fileService.uploadStream(fileObj, {
                    dbId: item.dbId,
                    type: item.type,
                    finalName: item.finalName,
                    area: item.area
                });

                setUploadProgress(prev => ({ ...prev, current: i + 1 }));
            }
            return { success: true };
        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setIsUploading(false);
        }
    };

    return {
        processFile,
        startUploadStream,
        isUploading,
        progress: uploadProgress,
        error,
        resetError: () => setError(null)
    };
}
