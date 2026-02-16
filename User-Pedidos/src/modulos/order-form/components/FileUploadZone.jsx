import React, { useState } from 'react';
import { UploadCloud, CheckCircle } from 'lucide-react';

export const FileUploadZone = ({ id, onFileSelected, selectedFile, label, icon: Icon = UploadCloud, color = "blue", multiple = false }) => {
    const [isOver, setIsOver] = useState(false);
    const uniqueId = `file-input-${id}-${label.replace(/\s+/g, '-')}`;

    const handleDrop = (e) => {
        e.preventDefault();
        setIsOver(false);
        if (multiple) {
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) onFileSelected(files);
        } else {
            const file = e.dataTransfer.files[0];
            if (file) onFileSelected(file);
        }
    };

    return (
        <div
            className={`relative group transition-all duration-300 border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer
                ${selectedFile ? 'border-green-400 bg-green-50/50' : (isOver ? 'border-blue-400 bg-blue-50' : 'border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50')}`}
            onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragLeave={() => setIsOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById(uniqueId).click()}
        >
            <input
                id={uniqueId}
                type="file"
                multiple={multiple}
                className="hidden"
                onChange={(e) => {
                    if (multiple) {
                        onFileSelected(Array.from(e.target.files));
                    } else {
                        onFileSelected(e.target.files[0]);
                    }
                }}
            />

            {selectedFile ? (
                <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-300">
                    <CheckCircle size={28} className="text-green-500 mb-2" />
                    <span className="text-[10px] font-bold text-green-700 truncate max-w-[150px]">
                        {multiple ? 'Archivos listos' : selectedFile.name}
                    </span>
                    <p className="text-[10px] text-green-600 uppercase tracking-tighter">
                        {multiple ? '+ Agregar más' : 'Listo para Drive'}
                    </p>
                </div>
            ) : (
                <>
                    <div className={`p-2 rounded-full ${isOver ? 'bg-blue-100' : 'bg-zinc-100 group-hover:bg-zinc-200'} transition-colors`}>
                        <Icon size={24} className={isOver ? 'text-blue-500' : 'text-zinc-500'} />
                    </div>
                    <div className="text-center">
                        <span className="text-[10px] font-bold text-zinc-600 block uppercase tracking-tight">{label}</span>
                        <p className="text-[9px] text-zinc-400">Arrastra o haz click</p>
                    </div>
                </>
            )}
        </div>
    );
};

export default FileUploadZone;
