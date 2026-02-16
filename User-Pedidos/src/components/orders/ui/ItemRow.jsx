import React from 'react';
import { Trash2, FileCode } from 'lucide-react';

export const ItemRow = ({ item, index, onRemove, onFileChange }) => {
    return (
        <div className="p-4 bg-white rounded-2xl border border-zinc-100 shadow-sm mb-4 transition-all hover:shadow-md">
            <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-black bg-zinc-900 text-white py-1 px-3 rounded-full">
                    ARCHIVO #{index + 1}
                </span>
                <button
                    onClick={() => onRemove(item.id)}
                    className="text-zinc-400 hover:text-red-500 text-[10px] font-bold flex items-center gap-1 transition-colors"
                >
                    <Trash2 size={14} /> ELIMINAR
                </button>
            </div>

            <div className="bg-zinc-50 border border-zinc-200 border-dashed rounded-xl p-4">
                <input
                    type="file"
                    className="block w-full text-sm text-zinc-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-xl file:border-0
                    file:text-xs file:font-bold
                    file:bg-zinc-900 file:text-white
                    hover:file:bg-black cursor-pointer"
                    onChange={onFileChange}
                />
            </div>

            {item.file && (
                <div className="mt-3 text-[10px] font-bold bg-blue-50 text-blue-700 p-2 rounded-lg border border-blue-100 flex items-center gap-2">
                    <FileCode size={14} />
                    <span>
                        MEDIDA DETECTADA: {item.file.width} x {item.file.height} {item.file.unit}
                    </span>
                </div>
            )}
        </div>
    );
};
