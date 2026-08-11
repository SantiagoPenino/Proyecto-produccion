import React from 'react';

/**
 * [BORDADO] Selector de prendas del cliente — hermano de BobinaSelector.
 *
 * Lista las prendas que el cliente ya entregó en recepción y que todavía tienen
 * saldo libre (/inventory/prendas-cliente/disponible → vw_PrendasClienteDisponibles).
 * El cliente elige la LÍNEA (12 gorros negros), no el remito entero: un mismo
 * PRE puede traer prendas distintas.
 *
 * `yaComprometido` son las prendas que los OTROS diseños del mismo pedido ya
 * tomaron de esa línea — el saldo que se muestra las descuenta en vivo, para
 * que no elija 40 gorros dos veces y recién se entere al confirmar.
 */
export default function PrendaClienteSelector({
    prendasDisponibles = [],
    selectedPrendaId = null,
    onSelect = () => {},
    yaComprometido = {},
}) {
    const disponibleReal = (p) =>
        (parseInt(p.CantidadDisponible) || 0) - (yaComprometido[p.PrendaClienteID] || 0);

    if (prendasDisponibles.length === 0) {
        return (
            <p className="text-[11px] font-bold text-amber-500/90">
                No tenés prendas disponibles. Entregalas en recepción y te las damos de alta
                para poder usarlas en tus pedidos de bordado.
            </p>
        );
    }

    return (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {prendasDisponibles.map(p => {
                const libre = disponibleReal(p);
                const elegida = selectedPrendaId === p.PrendaClienteID;
                // Sin saldo no se puede elegir, salvo que sea LA que este diseño ya tiene
                // elegida (si no, al cargar la cantidad completa el botón se auto-deshabilita
                // y el usuario no puede ni corregirla).
                const agotada = libre <= 0 && !elegida;

                return (
                    <button
                        key={p.PrendaClienteID}
                        type="button"
                        disabled={agotada}
                        onClick={() => onSelect(elegida ? null : p)}
                        className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                            elegida
                                ? 'border-brand-gold bg-brand-gold/10'
                                : agotada
                                    ? 'border-zinc-800 bg-zinc-900/20 opacity-40 cursor-not-allowed'
                                    : 'border-zinc-700/50 bg-zinc-900/40 hover:border-zinc-500'
                        }`}
                    >
                        <div className="font-black text-xs text-zinc-100">
                            {p.Descripcion || 'Prenda sin descripción'}
                            {p.Color ? ` · ${p.Color}` : ''}
                            {p.Talle ? ` · Talle ${p.Talle}` : ''}
                        </div>
                        <div className="flex gap-3 mt-1 text-[10px] font-bold text-zinc-500 flex-wrap">
                            {p.FechaIngreso && <span>📅 {new Date(p.FechaIngreso).toLocaleDateString()}</span>}
                            {p.CodigoRecepcion && <span className="font-mono">{p.CodigoRecepcion}</span>}
                            <span>Entregaste {p.Cantidad}</span>
                            <span className={libre > 0 ? 'text-emerald-400' : 'text-red-400'}>
                                ▸ {libre > 0 ? `${libre} disponibles` : 'sin saldo'}
                            </span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
