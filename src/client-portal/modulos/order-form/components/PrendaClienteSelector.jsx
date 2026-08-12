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
                        <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-black text-sm text-zinc-100">
                                {p.Cantidad} {p.Descripcion || 'prendas'}
                            </span>
                            {p.Color && (
                                <span className="text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
                                    {p.Color}
                                </span>
                            )}
                            {p.Talle && (
                                <span className="text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
                                    Talle {p.Talle}
                                </span>
                            )}
                        </div>

                        <div className="flex gap-x-3 gap-y-1 mt-1.5 text-[10px] font-bold text-zinc-400 flex-wrap">
                            <span>
                                Entregadas el{' '}
                                <span className="text-zinc-200">
                                    {new Date(p.FechaRecepcion || p.FechaIngreso).toLocaleDateString('es-UY')}
                                </span>
                            </span>
                            {p.CodigoRecepcion && (
                                <span className="font-mono text-zinc-500" title="Número del remito de recepción">
                                    {p.CodigoRecepcion}
                                </span>
                            )}
                            {p.CantidadBultos > 0 && (
                                <span>{p.CantidadBultos} {p.CantidadBultos === 1 ? 'bulto' : 'bultos'}</span>
                            )}
                        </div>

                        {/* Lo que anotó recepción al recibirlas: muchas veces es el único
                            dato que le permite al cliente distinguir una entrega de otra. */}
                        {p.ObservacionesRecepcion && (
                            <p className="mt-1.5 text-[10px] text-zinc-500 italic line-clamp-2">
                                “{p.ObservacionesRecepcion}”
                            </p>
                        )}

                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-black px-2 py-1 rounded ${
                                libre > 0
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-red-500/15 text-red-400 border border-red-500/30'
                            }`}>
                                {libre > 0 ? `${libre} sin usar` : 'Sin saldo'}
                            </span>
                            {p.CantidadUsada > 0 && (
                                <span className="text-[10px] font-bold text-zinc-500">
                                    {p.CantidadUsada} ya comprometidas en otros pedidos
                                </span>
                            )}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
