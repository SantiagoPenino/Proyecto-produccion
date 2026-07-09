import React from 'react';

/**
 * Selector de bobina de Tela de Cliente para el portal (Sublimación / Corte).
 * Lista las bobinas disponibles del cliente (traídas de /inventory/tela-cliente/disponible)
 * y permite elegir una. Al elegir, el ancho/metros de la bobina validan el archivo y sus
 * metros se descuentan al confirmar (el backend descuenta por bobinaId + magnitud).
 */
export default function BobinaSelector({ bobinasDisponibles = [], selectedBobinaId = null, setSelectedBobina = () => {} }) {
    return (
        <div className="p-4 bg-custom-dark md:rounded-2xl rounded-none border-y border-x-0 md:border-x border-zinc-700/50 -mx-4 md:mx-0">
            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Bobina de Tela del Cliente *</label>
            {bobinasDisponibles.length === 0 ? (
                <p className="text-[11px] font-bold text-amber-500/90">
                    Sin bobinas de tela disponibles. Entregá tu tela en recepción para poder usarla en pedidos.
                </p>
            ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {bobinasDisponibles.map(b => (
                        <button
                            key={b.BobinaID}
                            type="button"
                            onClick={() => setSelectedBobina(selectedBobinaId === b.BobinaID ? null : b)}
                            className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                                selectedBobinaId === b.BobinaID
                                    ? 'border-brand-gold bg-brand-gold/10'
                                    : 'border-zinc-700/50 bg-zinc-900/40 hover:border-zinc-500'
                            }`}
                        >
                            <div className="font-black text-xs text-zinc-100">{b.DescripcionTela || 'Tela sin descripción'}</div>
                            <div className="flex gap-3 mt-1 text-[10px] font-bold text-zinc-500 flex-wrap">
                                {b.FechaIngreso && <span>📅 {new Date(b.FechaIngreso).toLocaleDateString()}</span>}
                                <span className="font-mono">{b.CodigoEtiqueta}</span>
                                {b.Referencia && <span className="text-zinc-300">Ref: {b.Referencia}</span>}
                                <span className="text-emerald-400">▸ {parseFloat(b.MetrosRestantes).toFixed(2)} m largo</span>
                                {/* Ancho REAL (confirmado); si no está confirmado, cae al declarado */}
                                {(b.AnchoReal ?? b.Ancho) && <span>↔ {parseFloat(b.AnchoReal ?? b.Ancho).toFixed(2)} m ancho</span>}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
