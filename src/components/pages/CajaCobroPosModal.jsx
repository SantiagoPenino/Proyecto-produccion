import React from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, Loader2, CheckCircle2, XCircle, AlertTriangle, PhoneCall } from 'lucide-react';

/**
 * Cobro con tarjeta integrado (POSLink): lo que ve la cajera mientras el cliente paga en el POS.
 * El estado lo trae CajaTransaccionView poleando GET /contabilidad/caja/pos/cobros/:uuid cada 2,5 s;
 * este componente solo lo muestra y ofrece lo que se puede hacer en cada momento.
 *
 * Reglas que la pantalla no puede romper (docs/poslink-implementacion-plan.md §4):
 *   · Cancelar desde acá solo mientras el POS no tomó la venta. Después, solo la tecla roja del POS.
 *   · "En duda" y "cobrado sin registrar" NUNCA ofrecen reintentar: el cliente puede haber pagado.
 */
const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CajaCobroPosModal({ cobro, onCancelar, onCerrarSinCobro, onCerrar, accionando }) {
    if (!cobro) return null;
    const { estado, mensaje, detalle, final, segundosRestantes, moneda, monto, terminal, tarjeta, debito, autorizacion,
        conRebaja, facturaReservada, rebajaIva, tipo } = cobro;
    // Anulación / devolución (F4): la plata va al cliente.
    const reversion = tipo === 'ANULACION' || tipo === 'DEVOLUCION';
    const tituloModal = tipo === 'ANULACION' ? 'Anulación con tarjeta' : tipo === 'DEVOLUCION' ? 'Devolución con tarjeta' : 'Cobro con tarjeta';
    const simbolo = moneda === 'USD' ? 'US$' : '$';
    const cancelable = ['CREADA', 'ENVIADA', 'ESPERANDO_POS'].includes(estado);
    const peligro = ['INDETERMINADA', 'APROBADA_SIN_REGISTRAR'].includes(estado);
    const pideAccion = ['PEDIR_AUTORIZACION', 'PENDIENTE_BILLETERA'].includes(estado);
    const ok = estado === 'REGISTRADA';
    const sinCobro = ['RECHAZADA', 'CANCELADA', 'ERROR_VALIDACION'].includes(estado);

    const Icono = ok ? CheckCircle2 : peligro ? AlertTriangle : pideAccion ? PhoneCall : sinCobro ? XCircle : CreditCard;
    const colorIcono = ok ? 'text-emerald-500' : peligro ? 'text-rose-500' : pideAccion ? 'text-amber-500' : sinCobro ? 'text-slate-400' : 'text-brand-cyan';

    return createPortal(
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5 border border-zinc-200 animate-in zoom-in-95 duration-200 text-slate-800">
                <div className="flex justify-between items-center">
                    <h3 className="font-black text-zinc-800 text-lg uppercase tracking-wider flex items-center gap-2">
                        <CreditCard className="text-brand-cyan" size={20} />
                        {tituloModal}
                    </h3>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">POS {terminal}</span>
                </div>

                <div className="text-center">
                    <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider mb-1">{reversion ? 'Importe a devolver' : 'Importe en el POS'}</p>
                    <p className="text-4xl font-black text-slate-800">{simbolo} {fmt(monto)}</p>
                    {/* Ley 19.210: con débito, la procesadora descuenta la rebaja de IVA del importe */}
                    {conRebaja && (
                        <p className="mt-1 text-[11px] font-bold text-slate-400">
                            Con rebaja de IVA (Ley 19.210){facturaReservada ? ` · factura ${facturaReservada}` : ''}
                        </p>
                    )}
                </div>

                <div className="flex flex-col items-center gap-3 text-center">
                    {final
                        ? <Icono className={colorIcono} size={44} />
                        : <Loader2 className="text-brand-cyan animate-spin" size={44} />}
                    <p className={`text-sm font-black ${peligro ? 'text-rose-600' : 'text-slate-700'}`}>{mensaje}</p>
                    {detalle && <p className="text-xs font-bold text-slate-500">{detalle}</p>}
                    {!final && segundosRestantes != null && segundosRestantes > 0 && (
                        <p className="text-[11px] font-bold text-slate-400">Vence en {segundosRestantes} s</p>
                    )}
                    {estado === 'CAPTURADA' && (
                        <p className="text-[11px] font-bold text-slate-400">Para cancelar ahora, usá la tecla roja del POS.</p>
                    )}
                    {ok && !reversion && (
                        <p className="text-xs font-bold text-slate-500">
                            {debito === true ? 'Débito' : debito === false ? 'Crédito' : 'Tarjeta'}
                            {tarjeta ? ` ···· ${tarjeta}` : ''}{autorizacion ? ` · Autorización ${autorizacion}` : ''}
                        </p>
                    )}
                    {ok && rebajaIva != null && (
                        <p className="text-xs font-bold text-slate-500">
                            Rebaja de IVA {simbolo} {fmt(rebajaIva)} · la tarjeta cobró {simbolo} {fmt(monto - rebajaIva)}
                        </p>
                    )}
                    {estado === 'PEDIR_AUTORIZACION' && (
                        <p className="text-xs font-bold text-slate-500">
                            Si no vas a pedir la autorización al emisor, cerralo sin cobro y cobrá con otro medio.
                        </p>
                    )}
                </div>

                {cancelable && (
                    <button onClick={onCancelar} disabled={accionando}
                        className="w-full bg-white border border-slate-300 hover:border-slate-400 disabled:opacity-50 text-slate-700 font-black py-3 rounded-xl transition-all flex justify-center items-center gap-2 uppercase tracking-widest text-xs">
                        {accionando ? <Loader2 size={16} className="animate-spin" /> : 'Cancelar cobro'}
                    </button>
                )}
                {pideAccion && (
                    <button onClick={onCerrarSinCobro} disabled={accionando}
                        className="w-full bg-white border border-slate-300 hover:border-slate-400 disabled:opacity-50 text-slate-700 font-black py-3 rounded-xl transition-all flex justify-center items-center gap-2 uppercase tracking-widest text-xs">
                        {accionando ? <Loader2 size={16} className="animate-spin" /> : 'Cerrar sin cobro'}
                    </button>
                )}
                {final && !pideAccion && (
                    <button onClick={onCerrar}
                        className={`w-full font-black py-3 rounded-xl transition-all flex justify-center items-center gap-2 uppercase tracking-widest text-xs ${peligro
                            ? 'bg-rose-600 hover:bg-rose-700 text-white'
                            : 'bg-brand-cyan hover:bg-brand-cyan/90 text-white shadow-lg shadow-brand-cyan/20'}`}>
                        {peligro ? 'Entendido, no cobro de nuevo' : ok ? 'Listo' : 'Cerrar'}
                    </button>
                )}
            </div>
        </div>,
        document.body
    );
}
