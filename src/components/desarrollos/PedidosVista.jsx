import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Paperclip, X, ChevronDown, Send } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import SelectorFecha from '../ui/SelectorFecha';
import { btnPri, btnSec, input, label } from '../servicio-tecnico/ui';
import ClienteBuscador from './ClienteBuscador';
import { Comentarios, Adjuntos, Pastilla, Desplegable, fmtD, mensajeError } from './comun';

// Pedidos (spec-B §1): lo que ve un vendedor. Un formulario corto para cargar lo que piden los clientes
// y "Mis pedidos", con el estado en palabras simples, el motivo y los comentarios.

const BORRADOR = { titulo: '', descripcion: '', cliente: { id: null, texto: '' }, fechaLimite: '' };

const NuevoPedido = ({ onEnviado }) => {
    const [d, setD] = useState(BORRADOR);
    const [archivos, setArchivos] = useState([]);
    const [enviando, setEnviando] = useState(false);
    const [aviso, setAviso] = useState(null); // { tipo: 'ok' | 'error', texto }
    const tituloRef = useRef(null);
    const archivosRef = useRef(null);
    const cambiar = (k, v) => { setD(x => ({ ...x, [k]: v })); setAviso(null); };

    const enviar = async (e) => {
        e.preventDefault();
        if (!d.titulo.trim()) { setAviso({ tipo: 'error', texto: 'Escribí qué piden.' }); tituloRef.current?.focus(); return; }
        setEnviando(true);
        try {
            const nuevo = await desarrollosService.crearPedido({
                titulo: d.titulo.trim(), descripcion: d.descripcion.trim(),
                cliente: { id: d.cliente.id, texto: d.cliente.texto.trim() }, fechaLimite: d.fechaLimite || null,
            });
            if (archivos.length) {
                try { await desarrollosService.adjuntar('solicitud', nuevo.id, archivos); }
                catch (err) { toast.error(mensajeError(err, 'El pedido se envió, pero no se pudieron subir los archivos.')); }
            }
            setD(BORRADOR);
            setArchivos([]);
            setAviso({ tipo: 'ok', texto: 'Pedido enviado. Lo ves abajo, en «Mis pedidos».' });
            onEnviado(nuevo.id);
        } catch (err) {
            setAviso({ tipo: 'error', texto: mensajeError(err, 'No se pudo enviar el pedido.') });
        } finally { setEnviando(false); }
    };

    return (
        <form onSubmit={enviar} className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 flex flex-col gap-4">
            <h2 className="text-base font-black text-zinc-800">Nuevo pedido</h2>
            <div>
                <span className={label}>Qué piden</span>
                <input ref={tituloRef} className={input} value={d.titulo} maxLength={120} onChange={(e) => cambiar('titulo', e.target.value)}
                    placeholder="Ej.: camiseta de ciclismo manga larga" />
            </div>
            <div>
                <span className={label}>Detalle</span>
                <textarea className={`${input} min-h-[84px]`} rows={3} value={d.descripcion} maxLength={4000} onChange={(e) => cambiar('descripcion', e.target.value)}
                    placeholder="Medidas, tela, terminaciones, cantidad, para qué lo quieren…" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <span className={label}>Cliente</span>
                    <ClienteBuscador value={d.cliente} onChange={(v) => cambiar('cliente', v)} />
                </div>
                <div>
                    <span className={label}>Para cuándo (opcional)</span>
                    <SelectorFecha value={d.fechaLimite} onChange={(e) => cambiar('fechaLimite', e.target.value)} vaciable className="w-full" />
                </div>
            </div>
            <div>
                <span className={label}>Fotos o PDF (opcional)</span>
                <div className="flex flex-wrap items-center gap-2">
                    {archivos.map((f, i) => (
                        <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border border-zinc-200 bg-zinc-50 text-xs text-zinc-600">
                            {f.name}
                            <button type="button" onClick={() => setArchivos(a => a.filter((_, j) => j !== i))} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-zinc-200" title="Quitar"><X size={12} /></button>
                        </span>
                    ))}
                    <input ref={archivosRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
                        onChange={(e) => { setArchivos(a => [...a, ...e.target.files]); e.target.value = ''; }} />
                    <button type="button" onClick={() => archivosRef.current?.click()} className={btnSec}><Paperclip size={15} className="text-brand-cyan" /> Agregar</button>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={enviando} className={btnPri}>
                    {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Enviar pedido
                </button>
                {aviso && <span className={`text-sm font-bold ${aviso.tipo === 'ok' ? 'text-emerald-700' : 'text-brand-magenta'}`}>{aviso.texto}</span>}
            </div>
        </form>
    );
};

const FilaPedido = ({ s, abierto, onAlternar, version }) => {
    const ev = s.estadoVendedor || {};
    return (
        <div id={`pedido-${s.id}`} className="border-b border-zinc-100 last:border-b-0">
            <button type="button" onClick={onAlternar} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-zinc-50">
                <span className="flex-1 min-w-[200px] text-sm text-zinc-600">
                    <b className="text-zinc-800">{s.titulo}</b> · {fmtD(s.creado)}{s.cliente ? ` · ${s.cliente}` : ''}
                    {s.comentarios > 0 ? ` · ${s.comentarios} ${s.comentarios === 1 ? 'comentario' : 'comentarios'}` : ''}
                </span>
                <Pastilla tono={ev.clase}>{ev.texto}</Pastilla>
                <ChevronDown size={16} className={`text-zinc-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
            </button>
            {ev.motivo && (
                <div className="mx-4 mb-3 rounded-xl bg-zinc-50 px-3 py-2 text-sm">
                    <span className="text-[11px] font-black uppercase tracking-wide text-zinc-400">Motivo</span>
                    <p className="whitespace-pre-wrap text-zinc-700">{ev.motivo}</p>
                </div>
            )}
            <Desplegable abierto={abierto}>
                <div className="px-4 pb-4 flex flex-col gap-3">
                    {s.descripcion && <p className="whitespace-pre-wrap text-sm text-zinc-700">{s.descripcion}</p>}
                    {s.fechaLimite && <p className="text-sm text-zinc-500">Para el {fmtD(s.fechaLimite)}</p>}
                    {s.archivos > 0 && <Adjuntos entidad="solicitud" id={s.id} version={version} />}
                    <div>
                        <span className={label}>Comentarios</span>
                        <Comentarios entidad="solicitud" id={s.id} version={version} />
                    </div>
                </div>
            </Desplegable>
        </div>
    );
};

const PedidosVista = ({ sesion, version, abrirInicial }) => {
    const [lista, setLista] = useState(null);
    const [abierto, setAbierto] = useState(abrirInicial || null);
    const cargar = useCallback(async () => {
        try { setLista(await desarrollosService.misPedidos()); }
        catch (e) { setLista([]); toast.error(mensajeError(e, 'No se pudieron cargar tus pedidos.')); }
    }, []);
    useEffect(() => { cargar(); }, [cargar, version]);
    useEffect(() => { if (abrirInicial) setAbierto(abrirInicial); }, [abrirInicial]);
    // Abierto desde un aviso: que se vea
    useEffect(() => {
        if (!abierto || !lista) return;
        document.getElementById(`pedido-${abierto}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [abierto, lista]);

    const nombre = String(sesion?.usuario?.nombre || '').split(' ')[0];
    return (
        <div className="flex flex-col gap-5">
            <p className="text-sm text-zinc-500">Hola{nombre ? `, ${nombre}` : ''}. Cargá acá lo que te piden los clientes y seguí en qué quedó cada pedido.</p>
            <div className="grid gap-5 xl:grid-cols-2 items-start">
            <NuevoPedido onEnviado={(id) => { cargar(); setAbierto(id); }} />
            <div>
                <h2 className="mb-2 text-base font-black text-zinc-800">Mis pedidos <span className="text-zinc-400 font-bold">{lista?.length ?? ''}</span></h2>
                <div className="rounded-2xl border border-zinc-200 bg-white">
                    {lista === null ? <div className="p-4"><Loader2 size={18} className="animate-spin text-zinc-300" /></div>
                        : !lista.length ? <p className="p-4 text-sm text-zinc-400">Todavía no cargaste ningún pedido.</p>
                        : lista.map(s => (
                            <FilaPedido key={s.id} s={s} version={version} abierto={abierto === s.id}
                                onAlternar={() => setAbierto(a => (a === s.id ? null : s.id))} />
                        ))}
                </div>
            </div>
            </div>
        </div>
    );
};

export default PedidosVista;
