import React, { useState, useEffect } from 'react';
import { API_URL } from '../../../services/apiClient';
import { FileImage, FileBox, FileText } from 'lucide-react';
import { fileControlService } from '../../../services/modules/fileControlService';

const FileControlCard = ({ file, refreshOrder, onAction }) => {
    const [controlCount, setControlCount] = useState(file.Controlcopias || 0);
    const [status, setStatus] = useState(file.EstadoArchivo || 'Pendiente');
    const [loading, setLoading] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    // Borrador del input editable de cantidad (permite tipear el total controlado sin apretar +1 N veces)
    const [draft, setDraft] = useState(String(file.Controlcopias || 0));

    const totalCopies = parseInt(file.Copias || 1);
    const isCompleted = status === 'OK' || status === 'FINALIZADO';

    // Status Logic
    const isFailed = status === 'FALLA';
    const isCancelled = status === 'CANCELADO';

    // Si el archivo tiene VARIAS copias, la falla solo se puede reportar en la ÚLTIMA copia
    // (cuando ya se controlaron todas menos una). En archivos de 1 copia no hay restricción.
    const canReportFalla = totalCopies <= 1 || controlCount === totalCopies - 1;

    useEffect(() => {
        setControlCount(file.Controlcopias || 0);
        setStatus(file.EstadoArchivo || 'Pendiente');
        setDraft(String(file.Controlcopias || 0));
    }, [file.Controlcopias, file.EstadoArchivo]);

    const handleIncrement = async (e) => {
        e.stopPropagation();
        if (loading || isCompleted || isFailed || isCancelled) return;
        setLoading(true);
        try {
            const nextCount = controlCount + 1;
            setControlCount(nextCount); // Optimistic

            const res = await fileControlService.updateFileCopyCount(file.ArchivoID, nextCount, file.isService);
            if (res.success) {
                setControlCount(res.newCount);
                setStatus(res.newStatus);
                if (res.isCompletedNow || res.orderFullyCompleted) {
                    refreshOrder();
                }
            }
        } catch (error) {
            console.error(error);
            setControlCount(controlCount); // Revert
            // alert("Error"); // Avoid alert spam
        } finally {
            setLoading(false);
        }
    };

    const handleUndo = async (e) => {
        e.stopPropagation();
        if (loading || isFailed || isCancelled || controlCount === 0) return;
        setLoading(true);
        try {
            const nextCount = controlCount - 1;
            setControlCount(nextCount); // Optimistic

            const res = await fileControlService.updateFileCopyCount(file.ArchivoID, nextCount, file.isService);
            if (res.success) {
                setControlCount(res.newCount);
                setStatus(res.newStatus);
                refreshOrder(); // Refresh parent to update global metrics
            }
        } catch (error) {
            console.error(error);
            setControlCount(controlCount); // Revert
        } finally {
            setLoading(false);
        }
    };

    // Commit del input editable: setea el TOTAL controlado de golpe (valor absoluto). El backend
    // (updateFileCopyCount) ya clampa a [0, Copias] y deriva el estado OK al llegar al total.
    const commitCount = async () => {
        if (loading || isFailed || isCancelled) { setDraft(String(controlCount)); return; }
        let val = parseInt(draft, 10);
        if (isNaN(val)) { setDraft(String(controlCount)); return; }
        if (val < 0) val = 0;
        if (val > totalCopies) val = totalCopies;
        if (val === controlCount) { setDraft(String(val)); return; }
        setLoading(true);
        try {
            setControlCount(val); // Optimistic
            const res = await fileControlService.updateFileCopyCount(file.ArchivoID, val, file.isService);
            if (res.success) {
                setControlCount(res.newCount);
                setStatus(res.newStatus);
                setDraft(String(res.newCount));
                refreshOrder(); // Puede completar/descompletar la orden → refrescar métricas
            }
        } catch (error) {
            console.error(error);
            setControlCount(controlCount); // Revert
            setDraft(String(controlCount));
        } finally {
            setLoading(false);
        }
    };

    // --- Helpers ---
    const getBaseFileUrl = () => {
        if (file.urlProxy) {
            const base = API_URL.endsWith('/api') ? API_URL.replace('/api', '') : API_URL;
            return `${base}${file.urlProxy}`;
        }
        return file.url || file.link || file.RutaAlmacenamiento || file.Link || '#';
    };
    const fileUrl = getBaseFileUrl();
    const isImage = fileUrl.match(/\.(jpeg|jpg|gif|png|webp|bmp)$/i);
    const isPdf = fileUrl.match(/\.(pdf)$/i);
    const ext = fileUrl.split('.').pop()?.substring(0, 3).toUpperCase() || 'FILE';

    // Dims
    const w = parseFloat(file.Ancho || 0).toFixed(2);
    const h = parseFloat(file.Alto || 0).toFixed(2);
    const hasDims = w > 0 && h > 0;
    const area = (file.Metros || 0) * totalCopies;

    // Progress Bar
    const progress = Math.min((controlCount / totalCopies) * 100, 100);

    return (
        <div
            className={`relative group bg-white transition-all duration-200
                ${isCompleted ? 'border border-brand-cyan/50 bg-brand-cyan/5 z-10' : (isFailed ? 'border border-red-200 bg-red-50 z-10' : 'hover:bg-slate-50 z-0 hover:z-10')}
            `}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Background "Fill" effect for progress (Subtle) */}
            {!isFailed && !isCancelled && (
                <div
                    className="absolute bottom-0 left-0 h-1 transition-all duration-500 ease-out z-10 bg-brand-cyan"
                    style={{ width: `${progress}%` }}
                />
            )}

            <div className="flex flex-col sm:flex-row items-center p-3 tablet:p-2 gap-4 tablet:gap-3 relative z-10">

                {/* 1. THUMBNAIL */}
                <a
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="relative w-16 h-16 tablet:w-12 tablet:h-12 shrink-0 rounded-lg bg-zinc-100 border border-zinc-100 overflow-hidden cursor-zoom-in group-hover:shadow-sm transition-all"
                >
                    {isImage ? (
                        <img src={fileUrl} alt="Preview" className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-400 bg-zinc-50/50">
                            {file.isService ? (
                                <FileBox className="w-6 h-6 text-amber-500" />
                            ) : isPdf ? (
                                <FileText className="w-6 h-6 text-brand-magenta" />
                            ) : (
                                <FileImage className="w-6 h-6 text-brand-cyan" />
                            )}
                        </div>
                    )}
                    {/* Badge Copies on Thumb */}
                    <div className="absolute top-0 right-0 bg-zinc-900/80 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-bl-lg backdrop-blur-[2px]">
                        x{totalCopies}
                    </div>
                </a>

                {/* 2. INFO */}
                <div className="flex-1 w-full min-w-0 flex flex-col justify-center gap-1">
                    <div className="flex items-center justify-between">
                        <div className="font-bold text-zinc-700 text-sm tablet:text-xs truncate pr-2" title={file.NombreArchivo}>
                            {file.NombreArchivo?.replace(/\.dat$/i, '')}
                        </div>
                        {/* Status Label (If special) */}
                        {isFailed && <span className="text-[9px] font-black uppercase bg-red-100 text-red-600 px-2 py-0.5 rounded">FALLA</span>}
                        {isCancelled && <span className="text-[9px] font-black uppercase bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded">CANCELADO</span>}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium text-zinc-500">
                        {hasDims && (
                            <div className="flex items-center px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200">
                                <span>{w} x {h} m</span>
                            </div>
                        )}
                        {file.Material && (
                            <span className="truncate max-w-[150px] text-zinc-400" title={file.Material}>{file.Material}</span>
                        )}
                        {area > 0 && <span className="text-brand-cyan font-bold ml-auto">{parseFloat(area).toFixed(2)} m</span>}
                    </div>
                </div>

                {/* 3. ACTIONS (Counter + Button) */}
                <div className="flex items-center justify-between sm:justify-end gap-4 tablet:gap-2.5 pl-0 sm:pl-4 tablet:sm:pl-2.5 border-l-0 sm:border-l border-zinc-50 w-full sm:w-auto">

                    {/* Counter — editable (tipear la cantidad) cuando hay varias copias y no está en estado terminal */}
                    <div className="text-right flex flex-col justify-center">
                        <span className="text-[9px] font-black text-zinc-300 uppercase leading-none mb-0.5 tracking-wider">COPIAS</span>
                        {(totalCopies > 1 && !isCompleted && !isFailed && !isCancelled) ? (
                            <div className="flex items-baseline justify-end gap-0.5 leading-none">
                                <input
                                    type="number"
                                    min={0}
                                    max={totalCopies}
                                    value={draft}
                                    disabled={loading}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onBlur={commitCount}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                    title="Escribí la cantidad controlada"
                                    className="w-12 tablet:w-10 text-right text-xl tablet:text-base font-black text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-md px-1 py-0.5 outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <span className="text-sm text-zinc-300 font-bold">/{totalCopies}</span>
                            </div>
                        ) : (
                            <div className={`text-xl tablet:text-base font-black leading-none ${isCompleted ? 'text-brand-cyan' : (isFailed ? 'text-red-500' : 'text-zinc-700')}`}>
                                {controlCount}<span className="text-sm text-zinc-300 font-bold">/{totalCopies}</span>
                            </div>
                        )}
                    </div>

                    {/* Button */}
                    <div className="w-12 h-12 tablet:w-10 tablet:h-10 shrink-0 relative group/btn">
                        {isCompleted ? (
                            <button
                                onClick={handleUndo}
                                disabled={loading}
                                title="Deshacer (restar copia)"
                                className="w-full h-full rounded-full bg-brand-cyan/10 text-brand-cyan flex items-center justify-center hover:bg-brand-cyan hover:text-white transition-colors active:scale-95 group-hover/btn:shadow-md animate-in zoom-in duration-300"
                            >
                                {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-check text-xl"></i>}
                            </button>
                        ) : isFailed ? (
                            <div className="w-full h-full rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
                            </div>
                        ) : isCancelled ? (
                            <div className="w-full h-full rounded-full bg-zinc-100 text-zinc-400 flex items-center justify-center" title="Archivo cancelado">
                                <i className="fa-solid fa-ban text-xl"></i>
                            </div>
                        ) : (
                            <button
                                onClick={handleIncrement}
                                disabled={loading}
                                className={`w-full h-full rounded-full flex items-center justify-center shadow-sm transition-all active:scale-95 font-bold
                                    ${loading ? 'bg-zinc-100 text-zinc-400' : 'bg-brand-cyan hover:bg-[#005a7a] text-white shadow-brand-cyan/20'}
                                `}
                            >
                                {loading ? (
                                    <i className="fa-solid fa-circle-notch fa-spin"></i>
                                ) : (
                                    <i className="fa-solid fa-plus text-xl"></i>
                                )}
                            </button>
                        )}
                    </div>

                    {/* Report Falla (Warning Icon) — oculto si ya está en FALLA o CANCELADO.
                        En archivos de varias copias, solo habilitado en la última copia. */}
                    {!isFailed && !isCancelled && (
                        <button
                            disabled={!canReportFalla}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${canReportFalla ? 'text-zinc-300 hover:text-brand-magenta hover:bg-brand-magenta/10' : 'text-zinc-200 opacity-40 cursor-not-allowed'}`}
                            onClick={(e) => { e.stopPropagation(); if (canReportFalla) onAction(file, 'FALLA'); }}
                            title={canReportFalla ? 'Reportar Falla' : 'En archivos de varias copias, la falla solo se puede reportar en la última copia: controlá primero las copias buenas'}
                        >
                            <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
                        </button>
                    )}

                </div>

            </div>
        </div>
    );
};

export default FileControlCard;

