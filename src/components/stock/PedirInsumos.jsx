import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Inbox, Trash2, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../services/api';
import BuscadorVariante from './BuscadorVariante';

const fmtFecha = (v) => v ? new Date(v).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

/**
 * Pedido de insumos de un sector del stock (Wms_Solicitudes): armar una solicitud nueva o ver las
 * enviadas. La usan Mi Sector (/stock) y el botón de insumos de cada área (29/09), así los dos
 * piden igual y el pedido llega a Órdenes solicitadas, donde se despacha con remito.
 *
 * @param dep          depósito (sector) que pide
 * @param solicitudes  las del sector, si el padre ya las carga (Mi Sector las usa para su contador);
 *                     sin esto las carga el componente
 * @param onEnviado    después de enviar una (el padre recarga lo suyo)
 * @param compacto     solapas chicas en vez de las dos tarjetas grandes (para un modal)
 */
export default function PedirInsumos({ dep, solicitudes: solicitudesPadre = null, onEnviado = null, compacto = false }) {
    const [modo, setModo] = useState('nueva');       // nueva | enviadas
    const [pidiendo, setPidiendo] = useState([]);    // items del pedido nuevo
    const [enviando, setEnviando] = useState(false);
    const [propias, setPropias] = useState([]);

    const delPadre = Array.isArray(solicitudesPadre);
    const solicitudes = delPadre ? solicitudesPadre : propias;

    const cargarPropias = useCallback(async () => {
        if (delPadre || !dep) return;
        try {
            const r = await api.get(`/wms-interno/solicitudes?dep=${dep}`);
            setPropias(r.data?.data || []);
        } catch (e) { setPropias([]); }
    }, [dep, delPadre]);
    useEffect(() => { cargarPropias(); }, [cargarPropias]);

    const agregar = (v) => setPidiendo(p => p.some(i => i.VarId === v.VarId) ? p : [...p, { ...v, cantidad: '' }]);
    const enviar = async () => {
        const items = pidiendo.filter(i => parseFloat(i.cantidad) > 0).map(i => ({ varId: i.VarId, cantidad: parseFloat(i.cantidad) }));
        if (!items.length) return toast.error('Agregá lo que necesitás');
        setEnviando(true);
        try {
            const r = await api.post('/wms-interno/solicitudes', { depSolicitanteId: dep, items });
            toast.success(`Pedido ${r.data.numeracion} enviado a Logística`);
            setPidiendo([]);
            cargarPropias();
            onEnviado?.();
        } catch (e) { toast.error('No se pudo enviar el pedido'); }
        finally { setEnviando(false); }
    };

    const enviadas = `${solicitudes.length} enviada${solicitudes.length !== 1 ? 's' : ''}`;

    return (
        <div className="space-y-4">
            {compacto ? (
                <div className="flex gap-1 border-b border-slate-200">
                    {[['nueva', 'Nueva solicitud'], ['enviadas', `Enviadas (${solicitudes.length})`]].map(([k, t]) => (
                        <button key={k} type="button" onClick={() => setModo(k)}
                            className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${modo === k
                                ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                            {t}
                        </button>
                    ))}
                </div>
            ) : (
                /* Dos modos, como el sistema anterior: armar una solicitud o ver las enviadas */
                <div className="grid sm:grid-cols-2 gap-4">
                    <button onClick={() => setModo('nueva')}
                        className={`rounded-2xl border p-6 flex flex-col items-center gap-2 transition-all ${
                            modo === 'nueva' ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-slate-200 bg-white hover:border-slate-300 text-slate-500'}`}>
                        <Plus size={22} className={modo === 'nueva' ? 'text-white' : 'text-slate-400'} />
                        <span className="text-sm font-black uppercase tracking-wider">Nueva solicitud</span>
                    </button>
                    <button onClick={() => setModo('enviadas')}
                        className={`rounded-2xl border p-6 flex flex-col items-center gap-2 transition-all ${
                            modo === 'enviadas' ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-slate-200 bg-white hover:border-slate-300 text-slate-500'}`}>
                        <Inbox size={22} className={modo === 'enviadas' ? 'text-white' : 'text-slate-400'} />
                        <span className="text-sm font-black uppercase tracking-wider">Mis solicitudes</span>
                        <span className={`text-[11px] font-black rounded-full px-2.5 py-0.5 ${
                            modo === 'enviadas' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                            {enviadas}
                        </span>
                    </button>
                </div>
            )}

            {modo === 'nueva' ? (
                <div className={`bg-white space-y-4 ${compacto ? '' : 'rounded-2xl border border-slate-200 p-5'}`}>
                    {!compacto && (
                        <div>
                            <p className="text-base font-black text-slate-800">Nueva solicitud de insumos</p>
                            <p className="text-xs text-slate-500 mt-0.5">Elegí los artículos que necesitás y enviá la solicitud a Logística.</p>
                        </div>
                    )}

                    {pidiendo.length === 0 ? (
                        // [24/09] El buscador va ADENTRO del carrito vacío, grande y con el cursor puesto: chico
                        // y arriba a la derecha no se veía, y no quedaba claro cómo se agregaba un artículo.
                        <div className="rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50/40 py-10 px-6 flex flex-col items-center text-center">
                            <p className="text-sm font-black text-slate-700">¿Qué necesitás?</p>
                            <p className="text-xs text-slate-500 mt-1 mb-4">Buscá el artículo por nombre, variante o código y tocalo para sumarlo al pedido.</p>
                            <div className="w-full max-w-xl text-left">
                                <BuscadorVariante grande autoFocus placeholder="Escribí el artículo que necesitás..." onElegir={agregar} />
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                                {pidiendo.map((i, idx) => (
                                    <div key={i.VarId} className="flex items-center gap-3 px-3 py-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-700 break-words">{i.Producto}</p>
                                            {i.NombreVariante && <p className="text-xs text-slate-500 leading-snug break-words">{i.NombreVariante}</p>}
                                        </div>
                                        <input type="number" min="0" step="1" placeholder="Cant." value={i.cantidad}
                                            onChange={e => setPidiendo(p => p.map((x, xi) => xi === idx ? { ...x, cantidad: e.target.value } : x))}
                                            className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                        <button onClick={() => setPidiendo(p => p.filter((_, xi) => xi !== idx))}
                                            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 flex items-center justify-center"><Trash2 size={13} /></button>
                                    </div>
                                ))}
                            </div>
                            <div className="max-w-md"><BuscadorVariante placeholder="Agregar otro artículo..." onElegir={agregar} /></div>
                        </>
                    )}

                    <button onClick={enviar} disabled={!pidiendo.length || enviando}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black disabled:opacity-40">
                        {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Enviar pedido
                    </button>
                </div>
            ) : (
                <div className={`bg-white divide-y divide-slate-50 ${compacto ? 'rounded-xl border border-slate-200' : 'rounded-2xl border border-slate-200'}`}>
                    {!compacto && <p className="px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Mis solicitudes</p>}
                    {solicitudes.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-400">Sin pedidos todavía.</p> :
                        solicitudes.map(s => (
                            <div key={s.SolId} className="flex items-center gap-3 px-4 py-2.5">
                                <span className="text-sm font-black text-slate-700 w-28 font-gsanscode">{s.Numeracion}</span>
                                <span className="text-xs text-slate-400 flex-1">{fmtFecha(s.FechaCreacion)} · {s.Items} item{s.Items !== 1 ? 's' : ''}</span>
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${s.Estado === 'PENDIENTE' ? 'bg-amber-100 text-amber-700' : ['ATENDIDA', 'APROBADA', 'ENTREGADA'].includes(s.Estado) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{s.Estado}</span>
                            </div>
                        ))}
                </div>
            )}
        </div>
    );
}
