import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ClipboardList, FileText, Loader2, Printer, RefreshCw } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFecha, fmtFechaHora } from '../../../utils/fechas';
import OrderDetailModal from '../../production/components/OrderDetailModal';
import { BTN_PRIMARIO, BTN_SECUNDARIO, ESTADO_SOLICITUD, VisorPdf, errorDe } from './solicitudesComunes';
import { DisenoTab, Pastilla, ProductoTab, medirDisenoPronto } from './SolicitudVendedorDetalle';
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

    // Mientras un pedido está pasando sus archivos a producción, se refresca solo cada 3 s.
    const pasando = !!s?.Conversion?.some(c => ['PROCESANDO', 'PASANDO_ARCHIVOS'].includes(c.pedido?.estado) && !c.pedido?.archivosColgados);
    useEffect(() => {
        if (!pasando) return undefined;
        const t = setInterval(cargar, 3000);
        return () => clearInterval(t);
    }, [pasando, cargar]);

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

    if (!s) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-brand-cyan" /></div>;
    const abierta = s.Estado === 'INGRESADA' || s.Estado === 'EN_DISENO';
    const archivosDe = (filtro) => s.Archivos.filter(a => a.Vigente && filtro(a));

    // Tema claro, como el detalle de la solicitud (06/10): comparten ProductoTab y DisenoTab, así que pasan juntas.
    // Antes iba dentro de .fp-oscuro (fichaPedido.css) y en max-w-7xl centrado; ahora a todo el ancho.
    return (
        <>
        <div className="p-3 md:p-6 space-y-4">
            {/* Encabezado como el del detalle: ícono de Lucide en brand-cyan y sin fondo, título grande */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <ClipboardList size={30} className="mt-1 shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><Pastilla e={s.Estado} mapa={ESTADO_SOLICITUD} />
                            <span className="text-xs text-slate-400">Solicitud #{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</span></div>
                        <h1 className="mt-1 text-2xl font-black leading-tight text-slate-800">Diseño · {s.NombreTrabajo}</h1>
                        <p className="text-sm text-slate-500">{s.ClienteNombre}{s.ClienteCodigo ? <span className="text-xs text-slate-400"> · {s.ClienteCodigo}</span> : null} · vendedor <b className="text-slate-700">{s.VendedorNombre || '—'}</b>{s.FechaEntrega ? <> · entrega <b className="text-slate-700">{fmtFecha(s.FechaEntrega)}</b></> : null}</p>
                    </div>
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
                <div className="sticky top-2 z-20 bg-white border border-brand-cyan/30 rounded-xl p-3 shadow">
                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2"><Loader2 size={12} className="animate-spin text-brand-cyan" /> Subiendo "{subida.nombre}"… {subida.pct}%</div>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-brand-cyan transition-all" style={{ width: `${subida.pct}%` }} /></div>
                </div>
            )}

            <div className="bg-white border border-slate-200 rounded-2xl">
                {/* Pestañas subrayadas en brand-cyan, como las del detalle (antes texto de 12 px) */}
                <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2">
                    {[['solicitud', 'Lo que llegó de la solicitud'], ['diseno', 'Diseño: tizada y archivos']].map(([k, t]) => (
                        <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}
                            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-bold transition-colors ${tab === k ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>{t}</button>
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
        <OrderDetailModal order={ficha} onClose={() => { setFicha(null); cargar(); }} onOrderUpdated={cargar} />
        <VisorPdf blob={pdf} nombre={`Ficha pedido SOL-${s.SolicitudID}.pdf`} onClose={() => setPdf(null)} />
        </>
    );
}
