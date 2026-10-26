import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

// Estética nueva (22/10/2026): mismo aspecto que el Selector propio (borde zinc, foco brand-cyan, lista redondeada).
export const MultiAreaSelector = ({ areas, selected, onChange, placeholder = 'Seleccionar Áreas', disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const handleToggle = (code) => {
        if (selected.includes(code)) {
            onChange(selected.filter(c => c !== code));
        } else {
            onChange([...selected, code]);
        }
    };

    const handleToggleAll = () => {
        if (selected.length === areas.length) {
            onChange([]);
        } else {
            onChange(areas.map(a => a.AreaID || a.code)); // Support both formats if needed, usually AreaID/code from api
        }
    };

    // Normalize area id access
    const getAreaId = (area) => area.AreaID || area.code;

    return (
        <div className="relative inline-block text-left z-30 w-full" ref={wrapperRef}>
            <button
                onClick={() => !disabled && setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm font-semibold text-zinc-800 text-left outline-none transition-colors ${isOpen ? 'border-brand-cyan ring-2 ring-brand-cyan/15' : 'border-zinc-200'} ${disabled ? 'bg-zinc-50 text-zinc-500 cursor-not-allowed' : 'hover:border-zinc-300'}`}
                type="button"
                disabled={disabled}
            >
                <span className="truncate">
                    {disabled && areas.length > 0
                        ? (areas.find(a => selected.includes(a.AreaID || a.code))?.Nombre || areas.find(a => selected.includes(a.AreaID || a.code))?.name || placeholder)
                        : selected.length === 0 ? placeholder :
                            selected.length === areas.length ? 'Todas las Áreas' :
                                `${selected.length} Seleccionadas`}
                </span>
                {!disabled && <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180 text-brand-cyan' : 'text-zinc-400'}`} />}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-1 w-full min-w-[200px] bg-white border border-zinc-200 rounded-xl shadow-xl shadow-zinc-900/10 p-1 max-h-72 overflow-y-auto z-50">
                    <div className="p-2 border-b border-zinc-100 mb-1">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={selected.length === areas.length && areas.length > 0}
                                onChange={handleToggleAll}
                                className="w-4 h-4 rounded accent-brand-cyan"
                            />
                            <span className="text-sm font-bold text-zinc-700">Seleccionar todas</span>
                        </label>
                    </div>
                    <div className="space-y-1">
                        {areas.map(area => {
                            const id = getAreaId(area);
                            return (
                                <label key={id} className="flex items-center gap-2 px-2 py-2 hover:bg-zinc-50 rounded-lg cursor-pointer select-none transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(id)}
                                        onChange={() => handleToggle(id)}
                                        className="w-4 h-4 rounded accent-brand-cyan"
                                    />
                                    <span className="text-sm text-zinc-700 truncate">{area.Nombre || area.name}</span>
                                    {(area.Categoria || area.category) && <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 rounded ml-auto">{area.Categoria || area.category}</span>}
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
