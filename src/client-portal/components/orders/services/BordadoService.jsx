import React from 'react';
import { GlassCard } from '../ui/GlassCard';
import { UploadCloud, FileCode } from 'lucide-react';
import { ItemRow } from '../ui/ItemRow';

/**
 * Componente para Servicio de Bordado.
 * Maneja: Carga de Ponchados, Bocetos, Cantidad de Prendas y Ubicaciones.
 */
export function BordadoService({
    items,
    updateItem,
    removeItem,
    addItem,
    ponchadoFiles,
    bocetoFile,
    setBocetoFile,
    setPonchadoFiles
}) {
    // Nota: El Bordado tiene lógica específica de Ponchado (archivo especializado) y Boceto (imagen).
    // Si la lógica completa de BordadoTechnicalUI se moviera aquí, este sería el lugar.

    return (
        <GlassCard title="Archivos de Producción y Bocetos">
            <div className="space-y-6">

                {/* 1. Carga de Ponchado Principal */}
                <div className="bg-zinc-50 p-6 rounded-2xl border border-zinc-200">
                    <h4 className="font-bold text-sm mb-3 uppercase tracking-wide flex items-center gap-2">
                        <FileCode size={16} /> Archivo de Ponchado (Principal)
                    </h4>
                    <input
                        type="file"
                        className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
                        onChange={(e) => setPonchadoFiles(e.target.files)}
                        multiple
                    />
                    {ponchadoFiles && ponchadoFiles.length > 0 && (
                        <div className="mt-2 text-xs text-blue-600 font-bold bg-blue-50 p-2 rounded-lg border border-blue-100">
                            {ponchadoFiles.length} archivo(s) seleccionado(s)
                        </div>
                    )}
                </div>

                {/* 2. Carga de Boceto Visual */}
                <div className="bg-zinc-50 p-6 rounded-2xl border border-zinc-200">
                    <h4 className="font-bold text-sm mb-3 uppercase tracking-wide flex items-center gap-2">
                        <UploadCloud size={16} /> Boceto Visual / Mockup
                    </h4>
                    <p className="text-xs text-zinc-400 mb-3">Sube una imagen de referencia para mostrar cómo debe quedar el bordado.</p>
                    <input
                        type="file"
                        className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-zinc-800 file:text-white hover:file:bg-black cursor-pointer"
                        onChange={(e) => setBocetoFile(e.target.files[0])}
                    />
                    {bocetoFile && (
                        <div className="mt-2 text-xs text-green-600 font-bold bg-green-50 p-2 rounded-lg border border-green-100">
                            Boceto cargado: {bocetoFile.name}
                        </div>
                    )}
                </div>

                {/* 3. Items adicionales (si aplica) */}
                {/* Algunos servicios de bordado permiten múltiples ubicaciones como items extra */}
            </div>
        </GlassCard>
    );
}
