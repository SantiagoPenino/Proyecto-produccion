import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ClipboardList, FileText, Loader2, Printer, RefreshCw } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFecha, fmtFechaHora } from '../../../utils/fechas';
import OrderDetailModal from '../../production/components/OrderDetailModal';
import { BTN_PRIMARIO, BTN_SECUNDARIO, ESTADO_SOLICITUD, Pill, VisorPdf, errorDe } from './solicitudesComunes';
import { DisenoTab, ProductoTab, medirDisenoPronto } from './SolicitudVendedorDetalle';
import './fichaPedido.css';

/**
 * Spec 41 — Trabajo de Diseño sobre una solicitud (/ventas/solicitudes/:id/diseno).
 * Es adonde llega el diseñador desde su Bandeja de Diseño: acá vincula la tizada de TizadaPro,
 * sube el PDF de cada hoja o el diseño pronto, toma trabajos y acepta cambios. La solicitud
 * (lo que el cliente pidió) se mira aparte, en solo lectura: la pantalla del vendedor ya no
 * tiene pestaña de Diseño, solo muestra el estado de cada servicio.
 */
export default function SolicitudDisenoPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth() || {};
    const [s, setS] = useState(null);
    const [perfil, setPerfil] = useState({ esVendedor: false, esDisenador: false, esAdmin: false });
    const [busy, setBusy] = useState(false);
    const [subida, setSubida] = useState(null);
    const [telas, setTelas] = useState([]);
    const [ficha, setFicha] = useState(null);
    const [generandoFicha, setGenerandoFicha] = useState(false);
    const [pdf, setPdf] = useState(null);
    const [tab, setTab] = useState('diseno');   // 'solicitud' (lo que llegó, solo lectura) | 'diseno' (subir tizada y diseños)

    const cargar = useCallback(async () => {
        try { setS(await svc.obtener(id)); }
        catch (e) { toast.error(errorDe(e)); navigate('/ventas/bandeja-diseno'); }
    }, [id, navigate]);
    useEffect(() => {
        cargar();
        svc.miPerfil().then(setPerfil).catch(() => { });
        svc.materialesPrincipal().then(setTelas).catch(() => setTelas([]));
    }, [cargar]);

    const hacer = async (fn, okMsg) => {
        setBusy(true);
        try { await fn(); if (okMsg) toast.success(okMsg); await cargar(); return true; }
        catch (e) { toast.error(errorDe(e)); return false; }
        finally { setBusy(false); }
    };
    const subir = async (files, campos, tipoParte) => {
        const lista = Array.from(files || []);
        if (!lista.length) return;
        setBusy(true);
        try {
            for (const f of lista) {
                const medida = campos.Rol === 'DISENO_PRONTO' && !campos.TizadaID ? await medirDisenoPronto(f, tipoParte) : {};
                setSubida({ nombre: f.name, pct: 0 });
                await svc.subirArchivo(id, f, { ...campos, ...medida }, (loaded, total) => setSubida({ nombre: f.name, pct: total ? Math.round((loaded / total) * 100) : 0 }));
            }
            toast.success(lista.length === 1 ? 'Archivo guardado.' : `${lista.length} archivos guardados.`);
        } catch (e) { toast.error(errorDe(e)); }
        finally { setSubida(null); setBusy(false); await cargar(); }
    };
    // La ficha tarda unos segundos: se muestra en un visor acá mismo (una pestaña emergente abierta
    // después de esperar la bloquea el navegador y "no sale nada").
    const abrirFicha = async () => {
        setGenerandoFicha(true);
        try { setPdf(new Blob([await svc.fichaPdf(id)], { type: 'application/pdf' })); }
        catch (e) { toast.error(`No se pudo generar la ficha: ${errorDe(e)}`); }
        finally { setGenerandoFicha(false); }
    };

    if (!s) return <div className="fp fp-oscuro"><div className="p-10 flex justify-center"><Loader2 className="animate-spin" /></div></div>;
    const abierta = s.Estado === 'INGRESADA' || s.Estado === 'EN_DISENO';
    const archivosDe = (filtro) => s.Archivos.filter(a => a.Vigente && filtro(a));

    return (
        <>
        <div className="fp fp-oscuro">
        <div className="max-w-7xl mx-auto space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex flex-wrap items-center gap-2"><Pill e={s.Estado} mapa={ESTADO_SOLICITUD} />
                        <span className="text-[11px] text-slate-400">Solicitud #{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</span></div>
                    <h1 className="text-xl font-black text-slate-800 mt-1 flex items-center gap-2"><ClipboardList size={20} className="text-indigo-500" /> Diseño · {s.NombreTrabajo}</h1>
                    <p className="text-sm text-slate-600">{s.ClienteNombre}{s.ClienteCodigo ? <span className="font-mono text-xs text-slate-400"> · {s.ClienteCodigo}</span> : null} · vendedor <b>{s.VendedorNombre || '—'}</b>{s.FechaEntrega ? <> · entrega <b>{fmtFecha(s.FechaEntrega)}</b></> : null}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => navigate('/ventas/bandeja-diseno')} className={BTN_SECUNDARIO}><ArrowLeft size={14} /> Bandeja de Diseño</button>
                    <button onClick={() => navigate(`/ventas/solicitudes/${id}`)} className={BTN_SECUNDARIO} title="Lo que el cliente pidió y mandó (solo lectura para Diseño)"><FileText size={14} /> Ver la solicitud</button>
                    <button onClick={cargar} className={BTN_SECUNDARIO} title="Actualizar"><RefreshCw size={14} /></button>
                    <button onClick={abrirFicha} disabled={generandoFicha} className={BTN_PRIMARIO}>{generandoFicha ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Ficha del pedido (PDF)</button>
                </div>
            </div>

            {!abierta && <div className="bg-slate-100 border border-slate-300 rounded-xl p-3 text-sm text-slate-700">La solicitud está <b>{ESTADO_SOLICITUD[s.Estado]?.txt || s.Estado}</b>: acá se mira, no se cambia.</div>}

            {subida && (
                <div className="sticky top-2 z-20 bg-white border border-indigo-200 rounded-xl p-3 shadow">
                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Subiendo "{subida.nombre}"… {subida.pct}%</div>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${subida.pct}%` }} /></div>
                </div>
            )}

            <div className="bg-white border border-slate-200 rounded-2xl">
                <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2 pt-2">
                    {[['solicitud', 'Lo que llegó de la solicitud'], ['diseno', 'Diseño: tizada y archivos']].map(([k, t]) => (
                        <button key={k} onClick={() => setTab(k)}
                            className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px ${tab === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{t}</button>
                    ))}
                </div>
                <div className="p-4 space-y-6">
                    {tab === 'solicitud' && (
                        <>
                            <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                                Solo lectura: es lo que el vendedor cargó. {s.Detalle ? <>Detalle de la solicitud: <b className="whitespace-pre-line">{s.Detalle}</b></> : null}
                            </div>
                            {s.Productos.map((p, i) => (
                                <ProductoTab key={p.ProductoSolID} s={s} p={p} n={i + 1} id={id} user={user} perfil={{ ...perfil, esVendedor: false }} busy={busy} abierta={abierta} puedeVender={false}
                                    telas={telas} archivosDe={archivosDe} hacer={hacer} subir={subir} onAbrirFicha={setFicha} />
                            ))}
                        </>
                    )}
                    {tab === 'diseno' && (
                        <>
                            <DisenoTab s={s} id={id} user={user} perfil={perfil} busy={busy} abierta={abierta} telas={telas} archivosDe={archivosDe} hacer={hacer} subir={subir} onAbrirFicha={setFicha} />
                        </>
                    )}
                </div>
            </div>
        </div>
        </div>
        <OrderDetailModal order={ficha} onClose={() => { setFicha(null); cargar(); }} onOrderUpdated={cargar} />
        <VisorPdf blob={pdf} nombre={`Ficha pedido SOL-${s.SolicitudID}.pdf`} onClose={() => setPdf(null)} />
        </>
    );
}
