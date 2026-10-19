import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Circle, FileDown, ImageOff, Loader2, Lock, Plus, RotateCw, Send, Trash2, Upload, X } from 'lucide-react';
import { apiClient } from '../api/apiClient';
import { solicitudesVendedorService as svc } from '../../services/modules/solicitudesVendedorService';
import { Miniatura, errorDe } from '../../components/pages/ventas/solicitudesComunes';
import { PrincipalBloque, useAccionesSolicitud } from '../../components/pages/ventas/SolicitudVendedorDetalle';
import { VistaAMedida, bajarGuiaDe, dpiImpreso, puntaDelArte, puntasDe, puntaDe, cajaFija } from '../../components/pages/ventas/TizadaProAMedida';
// Los bloques de la Solicitud son claros: los pasa a oscuro la misma hoja que usa el Área PRO, con los colores del portal
import '../../components/production/areas/areaProOscura.css';

/*
 * [TIENDA · ARMAR PEDIDO] El cliente arma su pedido de un producto con molde de TIZADA PRO (/portal/tienda/pedido/:id).
 *
 * Es la MISMA carga de la Solicitud del vendedor: PrincipalBloque (arte + editables → piezas y telas → lista de jugadores
 * de TIZADA PRO; el arte de Bordado / DTF / TPU sale de los editables de cada arte), con los mismos endpoints de /solicitudes-vendedor
 * (el backend deja pasar al cliente solo sobre sus pedidos: middleware/solicitudesClientePortal.js).
 * Lo propio de esta pantalla es lo de la tienda: producto y precio, qué extras lleva, Confirmar y cómo va.
 * Al confirmar sale solo a TIZADA PRO; cuando vuelve la tizada, el pedido se arma solo (pedidoPortalService).
 */
const BASE = '/web-orders/tienda/pedidos';
// Colores del portal (Tienda) para areaProOscura.css: fondo custom-dark, tarjetas #202024, zinc
const OSCURO = {
    '--pro-bg': '#19181B', '--pro-surface': '#202024', '--pro-soft': '#27272A', '--pro-hover': '#2E2E33',
    '--pro-ink': '#E4E4E7', '--pro-muted': '#A1A1AA', '--pro-line': '#34343A', '--pro-accent': '#006E97',
};
const simbolo = (m) => (m === 'USD' ? 'US$' : '$');
const numero = (n) => (Number(n) || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 });

export const PedidoTiendaView = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [s, setS] = useState(null);          // la solicitud (GET /solicitudes-vendedor/:id)
    const [res, setRes] = useState(null);      // lo de la tienda: producto, precio, extras del producto
    const [nombre, setNombre] = useState('');
    const [notas, setNotas] = useState('');
    const [confirmando, setConfirmando] = useState(false);
    const [faltan, setFaltan] = useState([]);  // lo que devolvió Confirmar (409)
    const [configurando, setConfigurando] = useState(null);   // extra con "Configurar" abierto (BORDADO / DTF / TPU)
    const [guiaDe, setGuiaDe] = useState(null);   // a medida: diseño cuya plantilla .ai se está bajando
    const [analisis, setAnalisis] = useState({});      // a medida: ArchivoID → si el arte sirve para imprimir (+ su vista)
    const [revisandoDe, setRevisandoDe] = useState(null);   // a medida: diseño cuyo arte se está revisando
    const [puntaPropuesta, setPuntaPropuesta] = useState({});   // [PUNTA DEL ARTE 19/10] diseño → la punta que se puso sola mirando su arte
    const [rechazo, setRechazo] = useState({});        // a medida: diseño → el último arte que no sirvió y por qué

    const cargar = useCallback(async () => {
        try {
            // Primero lo de la tienda (si falta, deja puestos el modelo y la tela por defecto) y después la solicitud
            const r = await apiClient.get(`${BASE}/${id}`);
            const sol = await svc.obtener(id);
            setS(sol); setRes(r.data);
        } catch (e) { toast.error(errorDe(e)); navigate('/portal/tienda'); }
    }, [id, navigate]);
    useEffect(() => { cargar(); }, [cargar]);
    const { busy, subida, hacer, subir } = useAccionesSolicitud(id, cargar);

    // [A MEDIDA] ¿El arte del cliente sirve para imprimir? (lo revisa el servidor una vez por archivo; trae la vista para dibujarlo)
    const pidiendo = useRef(new Set());
    const revisarArte = useCallback(async (aid, esperar = false) => {
        if (!aid || (pidiendo.current.has(aid) && !esperar)) return null;
        pidiendo.current.add(aid);
        try { const r = await apiClient.get(`${BASE}/${id}/arte/${aid}`); setAnalisis(m => ({ ...m, [aid]: r.data })); return r.data; }
        catch (e) { const r = { ok: false, problemas: [e.message] }; setAnalisis(m => ({ ...m, [aid]: r })); return r; }
    }, [id]);
    useEffect(() => {
        (s?.Productos?.[0]?.Datos?.tizadaPro?.disenos || []).forEach(d => { if (d.archivoCliente) revisarArte(d.archivoCliente); });
    }, [s, revisarArte]);

    // Confirmado y todavía sin pedido: se mira solo cada 20 s cómo va
    const esperando = !!res?.confirmado && !res?.pedido && !res?.cancelado;
    useEffect(() => {
        if (!esperando) return undefined;
        const t = setInterval(cargar, 20000);
        return () => clearInterval(t);
    }, [esperando, cargar]);

    if (!s || !res) {
        return <div className="py-24 flex justify-center"><Loader2 size={28} className="animate-spin text-brand-cyan" /></div>;
    }

    const p = s.Productos[0];
    const editable = !res.confirmado && !res.cancelado && !p.PedidoNoDocERP;
    const abierta = s.Estado === 'INGRESADA' || s.Estado === 'EN_DISENO';
    const perfil = { esVendedor: editable, esDisenador: false, esAdmin: false };
    const archivosDe = (filtro) => s.Archivos.filter(a => a.Vigente && filtro(a));
    const principal = p.Partes.find(pa => pa.Tipo === 'PRINCIPAL');
    const extrasPartes = p.Partes.filter(pa => pa.Tipo !== 'PRINCIPAL');
    const tz = p.Datos?.tizadaPro || {};
    // [A MEDIDA] toalla, bandera, pañuelo…: cada diseño tiene su medida y su cantidad, y existe antes que su arte
    const esAMedida = !!p.Config?.AMedida;
    const disenos = (tz.disenos || []).filter(d => esAMedida || d.arteArchivoId);
    const filas = tz.planilla || [];
    // Cada fila es un jugador; las prendas suman la columna Cantidad (vacía = 1), igual que la lista y la conversión.
    // A medida: la cantidad de cada diseño.
    const prendas = esAMedida ? disenos.reduce((t, d) => t + (Number(d.cantidad) > 0 ? Number(d.cantidad) : 0), 0)
        : filas.length ? filas.reduce((t, f) => t + (Number(f.cantidad) > 0 ? Number(f.cantidad) : 1), 0) : p.Cantidad;
    const unidadTxt = (n) => (esAMedida ? (n === 1 ? 'unidad' : 'unidades') : (n === 1 ? 'prenda' : 'prendas'));
    // Extras POR ARTE: cada camiseta (jugador, golero…) lleva los obligatorios del producto + los que prendió en su
    // pestaña (diseño.extras). Pedido de antes, sin nada por arte: el extra que está en el pedido vale para todos.
    const PROCESO = { BORDADO: 'bordado', DTF: 'dtf', TPU: 'tpu' };
    const llevaEn = (lista, d, e) => e.obligatorio || (lista.some(x => x.extras && e.tipo in x.extras) ? !!d.extras?.[e.tipo]?.activo : e.activo);
    const editablesDe = (d, T) => (d.editablesDetalle || []).filter(o => ((d.editables || {})[o.objeto] || o.sugerido) === PROCESO[T]);
    const deDiseno = (a, d) => String(a.NombreOriginal || '').toUpperCase().startsWith(`${d.nombre}__`);   // subido en la pestaña de ese arte
    const subidosDe = (e, d) => (e.parteId ? archivosDe(a => a.ParteID === e.parteId && a.Rol === 'ARTE_CLIENTE' && !/^EDITABLE_/i.test(a.NombreOriginal || '')
        && (deDiseno(a, d) || !disenos.some(x => deDiseno(a, x)))) : []);
    const faltaArteExtra = disenos.flatMap(d => res.extras.filter(e => llevaEn(disenos, d, e) && !editablesDe(d, e.tipo).length && !subidosDe(e, d).length).map(e => `${d.nombre} · ${e.nombre}`));
    const telas = [...new Set((p.Datos?.sublimacion?.piezas || []).filter(x => !x.fija).map(x => x.telaNombre).filter(Boolean))];
    const prod = res.producto;
    const total = prod.precio != null ? prod.precio * prendas : null;
    const aparte = res.extras.filter(e => e.activo && e.cobro === 'APARTE');

    // Lo que falta, para verlo de un vistazo (la validación de verdad la hace el servidor al confirmar)
    const medidaOk = (d) => { const m = d.medida || {}; return !!m.fija || (m.forma === 'circulo' ? m.diametro_m > 0 : m.ancho_m > 0 && m.alto_m > 0); };
    // a medida: cada diseño con su .ai / .pdf y que sirva para imprimir (lo que dijo la revisión del servidor)
    const sinArte = disenos.filter(d => !(d.archivoCliente || d.arteArchivoId) || analisis[d.archivoCliente]?.ok === false).map(d => d.nombre);
    const pasos = esAMedida ? [
        { k: 'medida', t: 'Medida y cantidad', ok: disenos.length > 0 && disenos.every(d => medidaOk(d) && Number(d.cantidad) > 0 && d.tela), d: disenos.map(d => `${d.nombre} × ${Number(d.cantidad) > 0 ? d.cantidad : 0}`).join(' · ') || 'Elegí la medida y cuántas' },
        { k: 'arte', t: 'Tu arte', ok: disenos.length > 0 && !sinArte.length, d: sinArte.length ? `Falta: ${sinArte.join(' · ')}` : 'Listo' },
        ...(extrasPartes.length ? [{ k: 'extras', t: 'Arte de los extras', ok: !faltaArteExtra.length, d: faltaArteExtra.length ? `Falta: ${faltaArteExtra.join(' · ')}` : extrasPartes.map(pa => pa.Nombre).join(' · ') }] : []),
    ] : [
        { k: 'arte', t: 'Tu diseño', ok: disenos.length > 0, d: disenos.length ? disenos.map(x => x.nombre).join(' · ') : 'Subí el .ai o .pdf de cada variante' },
        { k: 'tela', t: 'Tela', ok: !!p.Datos?.sublimacion?.completo, d: telas.join(' · ') || 'Elegila en "Piezas y telas"' },
        { k: 'lista', t: 'Lista de jugadores', ok: filas.length > 0, d: filas.length ? `${filas.length} jugador${filas.length === 1 ? '' : 'es'} · ${prendas} prenda${prendas === 1 ? '' : 's'}` : 'Cargala o subí el Excel' },
        ...(extrasPartes.length ? [{ k: 'extras', t: 'Arte de los extras', ok: !faltaArteExtra.length, d: faltaArteExtra.length ? `Falta: ${faltaArteExtra.join(' · ')}` : extrasPartes.map(pa => pa.Nombre).join(' · ') }] : []),
    ];

    const cambiarExtra = (tipo, cambios) => hacer(() => apiClient.put(`${BASE}/${id}/extras/${tipo}`, cambios));
    // [EXTRAS EN LA TABLA] prende un extra en el pedido y devuelve su parte (para subirle el archivo en el acto)
    const activarExtra = async (tipo) => {
        await apiClient.put(`${BASE}/${id}/extras/${tipo}`, { activo: true });
        const r = await apiClient.get(`${BASE}/${id}`);
        await cargar();
        return (r?.data?.extras || []).find(e => e.tipo === tipo)?.parteId || null;
    };

    // Extras de UN arte, dentro de su pestaña (TizadaProBloque → porArte). Cada camiseta lleva los suyos: se prenden o
    // apagan acá (los obligatorios del producto van siempre); el arte sale de los editables de ESE arte o se sube para él
    // (queda como <ARTE>__archivo: al armar el pedido lleva las prendas de ese arte); y dónde va, por arte.
    const extrasDeArte = (d, { disenos: ds, guardarDisenos, ocupado }) => {
        if (!res.extras.length) return null;
        const ocup = busy || ocupado;
        const lleva = (x, e) => llevaEn(ds, x, e);
        // la primera vez que un extra se decide por arte, los demás artes quedan como estaban (no cambian solos)
        const fijar = (x, e) => (x.extras && e.tipo in x.extras ? x : { ...x, extras: { ...(x.extras || {}), [e.tipo]: { activo: lleva(x, e) } } });
        const prender = async (e, on) => {
            if (on && !e.activo) await cambiarExtra(e.tipo, { activo: true });   // el extra entra al pedido
            await guardarDisenos(x => {
                const y = fijar(x, e);
                if (x.nombre !== d.nombre) return y;
                // apagado: sus editables de ese proceso vuelven a sublimado
                const editables = { ...(y.editables || {}) };
                if (!on) (y.editablesDetalle || []).forEach(o => { if ((editables[o.objeto] || o.sugerido) === PROCESO[e.tipo]) editables[o.objeto] = 'sublimado'; });
                return { ...y, editables, extras: { ...y.extras, [e.tipo]: { ...(y.extras[e.tipo] || {}), activo: on } } };
            });
            if (!on && !e.obligatorio && !ds.some(x => x.nombre !== d.nombre && lleva(x, e))) await cambiarExtra(e.tipo, { activo: false });   // ningún arte lo lleva: sale del pedido
        };
        const dondeVa = (e, texto) => guardarDisenos(x => {
            if (x.nombre !== d.nombre) return x;
            const y = fijar(x, e);
            return { ...y, extras: { ...y.extras, [e.tipo]: { ...y.extras[e.tipo], ubicacion: String(texto || '').trim() || null } } };
        });
        return (
            <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5">Extras de {d.nombre} <span className="normal-case font-normal">cada {esAMedida ? 'diseño' : 'camiseta'} puede llevar los suyos</span></div>
                <div className="space-y-2">
                    {res.extras.map(e => {
                        const on = lleva(d, e);
                        const eds = on ? editablesDe(d, e.tipo) : [];
                        const subidos = on ? subidosDe(e, d) : [];
                        const ubic = d.extras?.[e.tipo]?.ubicacion || '';
                        const clave = `${d.nombre}:${e.tipo}`;
                        const abierto = on && editable && (configurando === clave || (!eds.length && !subidos.length && configurando !== `-${clave}`));
                        return (
                            <div key={e.tipo} className={`rounded-xl border px-3 py-2 text-xs ${on ? 'border-brand-cyan/40' : 'border-slate-200'}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                    {e.obligatorio
                                        ? <span className="inline-flex items-center gap-1.5 font-black text-slate-800"><Lock size={12} className="text-slate-400" /> {e.nombre}</span>
                                        : <button type="button" disabled={!editable || ocup} onClick={() => prender(e, !on)}
                                            className="inline-flex items-center gap-1.5 font-black text-slate-800 disabled:opacity-60" title={on ? `Sacarle ${e.nombre} a ${d.nombre}` : `Agregarle ${e.nombre} a ${d.nombre}`}>
                                            {on ? <Check size={13} className="text-brand-cyan" /> : <Plus size={13} className="text-slate-400" />} {e.nombre}
                                        </button>}
                                    <span className="text-slate-500">{e.cobro === 'INCLUIDA' ? 'incluido en el precio' : 'se cobra aparte'}</span>
                                    {on && (eds.length
                                        ? <span className="text-slate-600">· del arte: {eds.map(o => `${o.objeto} (${o.pieza})`).join(' · ')}</span>
                                        : subidos.length ? <span className="text-slate-600">· {subidos.length} arte{subidos.length === 1 ? '' : 's'} subido{subidos.length === 1 ? '' : 's'}</span>
                                            : <span className="text-amber-700 font-bold">· falta el arte</span>)}
                                    {on && ubic && <span className="text-slate-500">· va en {ubic}</span>}
                                    {on && editable && (
                                        <button type="button" onClick={() => setConfigurando(abierto ? `-${clave}` : clave)} className="ml-auto font-bold text-brand-cyan hover:underline">
                                            {abierto ? 'Listo' : 'Configurar'}
                                        </button>
                                    )}
                                </div>
                                {abierto && (
                                    <div className="mt-2 pt-2 border-t border-slate-200 space-y-2">
                                        {e.opciones.length > 1 && (
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="text-slate-500 w-16">Tipo</span>
                                                {e.opciones.map(o => (
                                                    <button key={o.id} type="button" disabled={ocup} onClick={() => cambiarExtra(e.tipo, { opcionId: o.id })}
                                                        className={`rounded-lg border px-2 py-0.5 font-bold ${e.opcionId === o.id ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>{o.nombre}</button>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-slate-500 w-16">Arte</span>
                                            {subidos.map(a => (
                                                <span key={a.ArchivoID} className="inline-flex items-center gap-1.5">
                                                    <Miniatura a={a} tam={36} entera />
                                                    <span className="max-w-[160px] truncate text-slate-700" title={a.NombreOriginal}>{String(a.NombreOriginal || '').replace(/^[^_]+__/, '')}</span>
                                                    <button type="button" disabled={ocup} title="Quitar este arte" onClick={() => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Arte quitado.')} className="text-slate-400 hover:text-rose-600"><X size={12} /></button>
                                                </span>
                                            ))}
                                            <label className={`inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-bold text-slate-600 hover:border-slate-300 cursor-pointer ${ocup ? 'opacity-50 pointer-events-none' : ''}`}>
                                                <Upload size={12} /> {subidos.length ? 'Agregar otro' : 'Subir el arte'}
                                                <input type="file" className="hidden" accept={e.tipo === 'DTF' ? '.png' : '.png,.jpg,.jpeg,.pdf,.ai,.svg'}
                                                    onChange={ev => {
                                                        const lista = Array.from(ev.target.files || []).map(f => new File([f], `${d.nombre}__${f.name}`, { type: f.type }));
                                                        ev.target.value = '';
                                                        subir(lista, { Rol: 'ARTE_CLIENTE', ParteID: e.parteId }, e.tipo);
                                                    }} />
                                            </label>
                                            {e.tipo === 'DTF' && <span className="text-slate-400">PNG con fondo transparente, a tamaño real</span>}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-slate-500 w-16">Dónde va</span>
                                            <input key={ubic} defaultValue={ubic} placeholder="Ej.: pecho izquierdo, 8 cm de ancho" disabled={ocup}
                                                onBlur={ev => { if (ev.target.value.trim() !== ubic) dondeVa(e, ev.target.value); }}
                                                onKeyDown={ev => { if (ev.key === 'Enter') ev.currentTarget.blur(); }}
                                                className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };
    // [A MEDIDA] El arte de UN diseño, arriba en su pestaña: SOLO .ai (compatible con PDF) o .pdf que sirva para imprimir
    // (se revisa al subirlo: textos en curvas y la resolución de sus imágenes a la medida). Al confirmar, el arte para TIZADA
    // se arma solo a su medida, en vectores (pedidoPortalService.armarArtesAMedida). Al lado, cómo queda: la forma con el
    // arte y las tiras (VistaAMedida, con las cuentas de TIZADA). Autogestión: nadie lo arma a mano.
    const arteAMedida = (d, { guardarDisenos, ocupado, aMedida: am, calc }) => {
        const ocup = busy || ocupado || !!guiaDe || !!revisandoDe;
        const archivo = (aid) => s.Archivos.find(a => a.ArchivoID === aid && a.Vigente) || null;
        const arch = d.archivoCliente ? archivo(d.archivoCliente) : null;
        const an = arch ? analisis[arch.ArchivoID] : null;
        // [19/10] sin "Que llene todo / Que entre entera": siempre llena (los pedidos de antes con "entera" la conservan)
        const ajuste = d.ajuste === 'entera' ? 'entera' : 'llenar';
        const giro = [90, 180, 270].includes(Number(d.giro)) ? Number(d.giro) : 0;   // [GIRAR EL ARTE 19/10]
        // armado sobre la plantilla de TIZADA (sus mesas dicen la pieza): va tal cual, no se gira (pedidoPortalService.armarArtesAMedida)
        const sobrePlantilla = !!an?.ok && (an.paginas || []).some(pg => pg.pieza);
        const limpio = (a) => String(a?.NombreOriginal || '').replace(/^[^_]+__/, '');
        const dpi = an?.ok && calc?.total_cm ? dpiImpreso(an.calidad, calc.total_cm.ancho, calc.total_cm.alto, ajuste, giro) : null;
        // lo que se recorta al llenar (cm por lado): si se ve (más de 0,5 cm por lado), se avisa
        const recorte = (() => {
            if (ajuste !== 'llenar' || sobrePlantilla || !an?.ok || !calc?.total_cm || !(an.calidad?.anchoPt > 0)) return null;
            const [aw, ah] = giro % 180 ? [an.calidad.altoPt, an.calidad.anchoPt] : [an.calidad.anchoPt, an.calidad.altoPt];
            const W = calc.total_cm.ancho, H = calc.total_cm.alto, k = Math.max(W / aw, H / ah);
            const x = (aw * k - W) / 2, y = (ah * k - H) / 2;
            return x > 0.5 ? { cm: x, donde: 'a cada costado' } : y > 0.5 ? { cm: y, donde: 'arriba y abajo' } : null;
        })();
        // .ai / .pdf ya subidos a la producción principal que ningún diseño usa (no los armados por el sistema)
        const usados = new Set(disenos.flatMap(x => [x.archivoCliente, x.arteArchivoId]).filter(Boolean));
        const sueltas = archivosDe(a => a.ParteID === principal.ParteID && a.Rol === 'ARTE_CLIENTE' && /\.(ai|pdf)$/i.test(a.NombreOriginal || '')
            && !usados.has(a.ArchivoID) && !/__arte \d+x\d+ cm\.pdf$/i.test(a.NombreOriginal || ''));
        const asignar = (cambio) => guardarDisenos(x => (x.nombre === d.nombre ? { ...x, ...cambio } : x));
        const sinArmado = { arteArchivoId: null, arteAuto: null, editablesLeidoDe: null, editablesDetalle: [], editables: {} };
        // [PUNTA DEL ARTE 19/10] la punta que dice el arte (null = no se sabe o el producto ofrece una sola)
        const proponerPunta = async (r, g) => {
            const cfg = am?.config;
            if (!cfg || puntasDe(cfg).length < 2 || !r?.vista) return null;
            const fijas = cfg.medidas?.modo === 'FIJAS' ? (cfg.medidas.fijas || []) : [];
            const fija = fijas.find(x => x.nombre === d.medida?.fija) || (fijas.length === 1 ? fijas[0] : null);
            if ((fija ? fija.forma : cfg.forma) !== 'triangulo') return null;
            const pu = puntaDe(cfg, d.medida);
            const m = d.medida || {};
            const cajaV = fija ? cajaFija(fija, 'abajo') : (['abajo', 'arriba'].includes(pu) ? { ancho: m.ancho_m, alto: m.alto_m } : { ancho: m.alto_m, alto: m.ancho_m });
            return puntaDelArte({ vista: r.vista, anchoPt: r.calidad?.anchoPt, altoPt: r.calidad?.altoPt, cajaV, puntas: puntasDe(cfg), giro: g });
        };
        // [GIRAR EL ARTE 19/10] de a 90° en el sentido del reloj; la punta se vuelve a proponer con el arte girado
        const girar = async () => {
            const g = (giro + 90) % 360;
            const sug = an?.ok ? await proponerPunta(an, g) : null;
            setPuntaPropuesta(x => ({ ...x, [d.nombre]: sug }));
            await asignar({ giro: g, ...(sug ? { medida: { ...(d.medida || {}), orientacion: sug } } : {}) });
        };
        // un arte (recién subido o de los ya subidos): se revisa y, si sirve, queda como el de este diseño
        const usar = async (aid, nombre, recienSubido) => {
            setRevisandoDe(d.nombre);
            try {
                const r = await revisarArte(aid, true);
                if (!r?.ok) {
                    setRechazo(m => ({ ...m, [d.nombre]: { nombre, problemas: r?.problemas?.length ? r.problemas : ['No se pudo revisar el archivo.'] } }));
                    if (recienSubido) await hacer(() => svc.quitarArchivo(id, aid));
                    return;
                }
                setRechazo(m => ({ ...m, [d.nombre]: null }));
                // [PUNTA DEL ARTE 19/10] triángulo con varias puntas posibles: se pone sola la que dice el arte (el cliente la puede cambiar).
                // Un arte nuevo empieza sin girar.
                const sug = await proponerPunta(r, 0);
                setPuntaPropuesta(x => ({ ...x, [d.nombre]: sug }));
                await asignar({ ...sinArmado, archivoCliente: aid, giro: 0, ...(sug ? { medida: { ...(d.medida || {}), orientacion: sug } } : {}) });
            } finally { setRevisandoDe(null); }
        };
        const subirArte = async (file) => {
            if (!file) return;
            if (!/\.(ai|pdf)$/i.test(file.name)) { setRechazo(m => ({ ...m, [d.nombre]: { nombre: file.name, problemas: ['El arte tiene que ser un .ai (compatible con PDF) o un .pdf, con los textos convertidos a curvas.'] } })); return; }
            const [hecho] = await subir([new File([file], `${d.nombre}__${file.name}`, { type: file.type })], { Rol: 'ARTE_CLIENTE', ParteID: principal.ParteID }, 'PRINCIPAL');
            if (hecho?.ArchivoID) await usar(hecho.ArchivoID, file.name, true);
        };
        const quitar = async () => {
            const aid = arch?.ArchivoID;
            await asignar({ ...sinArmado, archivoCliente: null });
            if (aid) await hacer(() => svc.quitarArchivo(id, aid));
        };
        const guia = async () => {
            setGuiaDe(d.nombre);
            try {
                // la plantilla sale con la medida guardada: primero se guarda lo que esté pendiente
                const pendientes = [];
                window.dispatchEvent(new CustomEvent('pedido-tienda:guardar', { detail: { pendientes } }));
                await Promise.all(pendientes);
                await bajarGuiaDe(id, p, d, am);
            } catch (e) { toast.error(errorDe(e)); } finally { setGuiaDe(null); }
        };
        const subirBtn = (texto) => (
            <label className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold text-slate-700 hover:border-brand-cyan cursor-pointer ${ocup ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={13} /> {texto}
                <input type="file" className="hidden" accept=".ai,.pdf" onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; subirArte(f); }} />
            </label>
        );
        const guiaBtn = (
            <button type="button" disabled={ocup || !medidaOk(d)} onClick={guia} title={medidaOk(d) ? 'La plantilla de TIZADA con esta medida, para armar tu arte en Illustrator' : 'Primero elegí la medida'}
                className="inline-flex items-center gap-1.5 font-bold text-brand-cyan hover:underline disabled:opacity-50 disabled:no-underline">
                {guiaDe === d.nombre ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} Plantilla de esta medida (.ai)
            </button>
        );
        const rech = rechazo[d.nombre];
        const calidad = !an?.ok ? null : an.vectorial ? { txt: 'Vectorial: se imprime nítido a cualquier medida.', cls: 'text-emerald-600' }
            : dpi == null ? { txt: 'Tiene imágenes: la calidad se calcula con la medida.', cls: 'text-slate-500' }
                : dpi < an.dpiMinimo ? { txt: `Sus imágenes quedan a ${dpi} dpi a esta medida: se verían pixeladas (mínimo ${an.dpiMinimo}). Subí uno con imágenes de más resolución.`, cls: 'text-rose-600 font-bold' }
                    : { txt: `Sus imágenes quedan a ${dpi} dpi a esta medida${dpi < 150 ? ' (aceptable)' : ' (buena calidad)'}.`, cls: dpi < 150 ? 'text-amber-600' : 'text-emerald-600' };
        return (
            <div className="text-xs">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5">Tu arte</div>
                <div className="flex flex-wrap items-start gap-4">
                    {/* cómo queda: la forma con el arte y las tiras (sin arte todavía: la forma y las tiras) */}
                    <div className="relative">
                        <VistaAMedida calc={calc} medida={d.medida} vista={an?.ok ? an.vista : null} ajuste={ajuste} giro={sobrePlantilla ? 0 : giro} />
                        {revisandoDe === d.nombre && <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded text-[11px] font-bold text-white gap-1"><Loader2 size={12} className="animate-spin" /> Revisando…</div>}
                    </div>
                    <div className="space-y-2 min-w-0 flex-1">
                        {arch ? (<>
                            <p className="font-bold text-slate-700 truncate max-w-[320px]" title={arch.NombreOriginal}>{limpio(arch)}</p>
                            {!an && <p className="text-[11px] text-slate-500 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Revisando tu arte…</p>}
                            {an && !an.ok && <ul className="list-disc pl-4 text-[11px] text-rose-600">{(an.problemas || []).map((m, i) => <li key={i}>{m}</li>)}</ul>}
                            {calidad && <p className={`text-[11px] ${calidad.cls}`}>{calidad.txt}</p>}
                            {puntaPropuesta[d.nombre] && <p className="text-[11px] text-slate-500">Pusimos la punta <b>{({ abajo: 'hacia abajo', arriba: 'hacia arriba', izq: 'a la izquierda', der: 'a la derecha' })[puntaPropuesta[d.nombre]]}</b> mirando tu arte. Si no es, cambiala abajo en <b>Punta</b>.</p>}
                            {recorte && <p className="text-[11px] font-bold text-amber-600">Tu arte no tiene la proporción de la pieza: se recortan {recorte.cm.toLocaleString('es-UY', { maximumFractionDigits: 1 })} cm {recorte.donde}. Para que no pase, armalo sobre la plantilla de esta medida.</p>}
                            {sobrePlantilla && <p className="text-[11px] text-emerald-600">Armado sobre la plantilla: va tal cual.</p>}
                            {calc?.total_cm && an?.ok && <p className="text-[11px] text-slate-500">Al confirmar se arma solo a {Math.round(calc.total_cm.ancho)} × {Math.round(calc.total_cm.alto)} cm (la medida con el margen para coser).</p>}
                            {editable && (
                                <div className="flex flex-wrap items-center gap-3">
                                    {subirBtn('Cambiar')}
                                    {an?.ok && !sobrePlantilla && (
                                        <button type="button" disabled={ocup} onClick={girar} title="Girar el arte 90° (en el sentido del reloj)"
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold text-slate-700 hover:border-brand-cyan disabled:opacity-50">
                                            <RotateCw size={13} /> Girar el arte{giro ? ` (${giro}°)` : ''}
                                        </button>
                                    )}
                                    <button type="button" disabled={ocup} onClick={quitar} className="inline-flex items-center gap-1 font-bold text-slate-400 hover:text-rose-600"><X size={12} /> Quitar</button>
                                </div>
                            )}
                        </>) : editable ? (<>
                            <p className="text-[12px] text-slate-600">Subí tu arte en <b>.ai</b> (compatible con PDF) o <b>.pdf</b>, con los textos convertidos a curvas. Se arma solo a la medida de este diseño.</p>
                            <div className="flex flex-wrap items-center gap-3">{subirBtn('Subir arte (.ai o .pdf)')}{guiaBtn}</div>
                            {sueltas.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">Ya subiste:
                                    {sueltas.map(a => (
                                        <button key={a.ArchivoID} type="button" disabled={ocup} onClick={() => usar(a.ArchivoID, limpio(a), false)} title={`Usar "${limpio(a)}" en ${d.nombre}`}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-1.5 py-1 hover:border-brand-cyan">
                                            <Miniatura a={a} tam={28} entera /><span className="max-w-[140px] truncate font-bold text-slate-700">{limpio(a)}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>) : <p className="text-[11px] text-slate-500">Sin arte.</p>}
                        {rech && (
                            <div className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
                                <b>"{rech.nombre}" no sirve para imprimir:</b>
                                <ul className="list-disc pl-4">{rech.problemas.map((m, i) => <li key={i}>{m}</li>)}</ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const confirmar = async () => {
        setConfirmando(true); setFaltan([]);
        try {
            // Primero se guarda lo que la lista de jugadores tenga pendiente (TizadaProBloque escucha este aviso)
            const pendientes = [];
            window.dispatchEvent(new CustomEvent('pedido-tienda:guardar', { detail: { pendientes } }));
            await Promise.all(pendientes);
            const r = await apiClient.post(`${BASE}/${id}/confirmar`, { nombreTrabajo: nombre, observaciones: notas });
            const tzr = r.data?.tizada;
            if (tzr && ['ERROR', 'RECHAZADO'].includes(tzr.Estado)) toast.warning('Recibimos tu pedido. TIZADA PRO no lo pudo tomar ahora: nuestro equipo lo revisa y lo manda.');
            else toast.success('¡Pedido confirmado! TIZADA PRO ya está armando la tizada.');
            await cargar();
        } catch (e) {
            setFaltan(e.data?.faltan?.length ? e.data.faltan : [{ mensaje: e.message }]);
        } finally { setConfirmando(false); }
    };
    const descartar = async () => {
        if (!window.confirm('Se descarta este pedido con todo lo que cargaste. ¿Seguimos?')) return;
        try { await apiClient.post(`${BASE}/${id}/descartar`); navigate('/portal/tienda'); }
        catch (e) { toast.error(e.message); }
    };

    // Cómo va (después de confirmar)
    const dtfEnDiseno = extrasPartes.some(pa => pa.Tipo === 'DTF' && ['ENVIADO_DISENO', 'DISENO_INICIADO'].includes(pa.Estado));
    const tizadaLista = principal?.Estado === 'DISENADO';
    // TIZADA lo rechazó o falló: se dice (con su motivo) en vez de quedar "armando" para siempre; lo retoma el equipo
    const tizadaFallo = !tizadaLista && ['RECHAZADO', 'ERROR', 'ERROR_APLICAR'].includes(res.tizada?.estado);
    const seguimiento = [
        { t: 'Pedido recibido', e: 'hecho' },
        tizadaFallo
            ? { t: 'TIZADA PRO no pudo armar la tizada', e: 'error', d: 'Nuestro equipo ya lo está revisando: te avisamos cuando siga.' }
            : { t: tizadaLista ? 'Tizada lista' : 'TIZADA PRO arma la tizada', e: tizadaLista ? 'hecho' : 'curso' },
        ...(dtfEnDiseno ? [{ t: 'Armamos el pliego de DTF', e: 'curso' }] : []),
        { t: p.PedidoNoDocERP ? `Pedido ${p.PedidoNoDocERP} en producción` : 'Armamos tu pedido', e: p.PedidoNoDocERP ? 'hecho' : (tizadaLista && !dtfEnDiseno ? 'curso' : 'espera') },
    ];

    return (
        <div className="space-y-5 font-dmsans">
            <Toaster position="top-right" richColors closeButton />

            {/* Encabezado */}
            <div className="flex items-center gap-3">
                <button onClick={() => navigate('/portal/tienda')} className="w-9 h-9 shrink-0 rounded-xl border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 flex items-center justify-center" title="Volver a la tienda"><ArrowLeft size={16} /></button>
                <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">{editable ? 'Armá tu pedido' : res.cancelado ? 'Pedido descartado' : 'Tu pedido'}</p>
                    {/* el nombre que le puso el cliente (el equipo); si no, el del producto sin la familia */}
                    <h1 className="text-xl md:text-2xl font-black text-zinc-100 leading-tight truncate">{s.NombreTrabajo && s.NombreTrabajo !== prod.nombreCompleto ? s.NombreTrabajo : prod.nombre}</h1>
                </div>
            </div>

            {subida && (
                <div className="sticky top-24 z-20 rounded-xl border border-brand-cyan/40 bg-custom-dark p-3">
                    <div className="text-xs font-bold text-zinc-200 flex items-center gap-2"><Loader2 size={12} className="animate-spin text-brand-cyan" /> Subiendo "{subida.nombre}"… {subida.pct}%</div>
                    <div className="h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden"><div className="h-full bg-brand-cyan transition-all" style={{ width: `${subida.pct}%` }} /></div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px] gap-5 items-start">
                {/* La carga: los mismos bloques de la Solicitud */}
                <div className="area-pro-oscura rounded-2xl border border-zinc-800 p-3 md:p-5 space-y-4 min-w-0" style={OSCURO}>
                    {principal && (
                        <PrincipalBloque cliente p={p} pa={principal} id={id} perfil={perfil} busy={busy} abierta={abierta} puedeVender={editable}
                            arte={archivosDe(a => a.ParteID === principal.ParteID && a.Rol !== 'DISENO_PRONTO')}
                            planillas={archivosDe(a => a.ProductoSolID === p.ProductoSolID && !a.ParteID)}
                            artes={archivosDe(a => a.Rol === 'ARTE_CLIENTE' && (a.ProductoSolID === p.ProductoSolID || p.Partes.some(pa => pa.ParteID === a.ParteID)))}
                            faltaEnvio={null} onEstadoSubl={() => { }} hacer={hacer} subir={subir}
                            porArte={esAMedida ? (d, ctx) => (ctx.seccion === 'arte' ? arteAMedida(d, ctx) : null) : null}
                            // [EXTRAS EN LA TABLA 14/10] prendas con talles: los extras se eligen en la tabla del arte de cada diseño
                            // [EXTRAS EN LA TABLA 14/10] los extras se eligen en la tabla de cada diseño (también a medida)
                            // [TIPO POR OBJETO 15/10] el tipo (DTF común / dorado…) se elige por objeto en la tabla y queda en el diseño
                            extrasPortal={{ lista: res.extras, activar: activarExtra }} />
                    )}
                </div>

                {/* Resumen, confirmar y cómo va */}
                <aside className="lg:sticky lg:top-24 rounded-2xl bg-custom-dark border border-zinc-800 p-4 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-14 h-14 rounded-xl bg-white shrink-0 overflow-hidden flex items-center justify-center">
                            {prod.foto ? <img src={prod.foto} alt="" className="w-full h-full object-contain" /> : <ImageOff size={18} className="text-zinc-300" />}
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-bold text-zinc-200 uppercase leading-snug line-clamp-2">{prod.nombre}</p>
                            {prod.precio != null && <p className="text-[11px] text-zinc-500 font-gsanscode">{simbolo(prod.moneda)} {numero(prod.precio)} c/u</p>}
                        </div>
                    </div>

                    {editable ? (
                        <>
                            <ul className="space-y-2">
                                {pasos.map(x => (
                                    <li key={x.k} className="flex items-start gap-2.5">
                                        {x.ok ? <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 shrink-0" /> : <Circle size={16} className="text-zinc-600 mt-0.5 shrink-0" />}
                                        <div className="min-w-0">
                                            <p className={`text-xs font-bold ${x.ok ? 'text-zinc-200' : 'text-zinc-400'}`}>{x.t}</p>
                                            <p className="text-[11px] text-zinc-500 truncate">{x.d}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>

                            <div className="border-t border-zinc-800 pt-3 space-y-1">
                                <div className="flex items-baseline justify-between">
                                    <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Total</span>
                                    {total != null
                                        ? <span className="font-gsanscode font-bold"><span className="text-[13px] text-zinc-500">{simbolo(prod.moneda)} </span><span className="text-2xl text-zinc-100">{numero(total)}</span></span>
                                        : <span className="text-sm font-bold text-zinc-300">A cotizar</span>}
                                </div>
                                {total != null && <p className="text-[11px] text-zinc-500 text-right">{prendas} {unidadTxt(prendas)} × {simbolo(prod.moneda)} {numero(prod.precio)}</p>}
                                {aparte.length > 0 && <p className="text-[11px] text-amber-400/90">{aparte.map(e => e.nombre).join(' y ')}: se cobra aparte según la lista de precios.</p>}
                            </div>

                            <div className="space-y-2">
                                <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del pedido (ej. el del equipo)"
                                    className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-brand-cyan/50 outline-none text-sm text-zinc-200 placeholder:text-zinc-600" />
                                <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="¿Algo más que tengamos que saber? (opcional)"
                                    className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-brand-cyan/50 outline-none text-sm text-zinc-200 placeholder:text-zinc-600 resize-none" />
                            </div>

                            {faltan.length > 0 && (
                                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 space-y-1">
                                    <p className="text-xs font-black text-rose-300 flex items-center gap-1.5"><AlertTriangle size={13} /> Antes de confirmar</p>
                                    <ul className="list-disc pl-4 space-y-0.5">{faltan.map((f, i) => <li key={i} className="text-[11px] text-rose-200/90">{f.mensaje}</li>)}</ul>
                                </div>
                            )}

                            {/* Siempre se puede tocar: la validación es al final (si falta algo, se lista arriba en rojo) */}
                            <button onClick={confirmar} disabled={confirmando || busy}
                                title="Revisa que esté todo y manda tu pedido: TIZADA PRO arma la tizada y el pedido se arma solo"
                                className={`w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-wide transition-colors flex items-center justify-center gap-2 ${confirmando || busy
                                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                    : 'bg-brand-cyan text-white hover:bg-brand-cyan/90'}`}>
                                {confirmando ? <><Loader2 size={16} className="animate-spin" /> Confirmando…</> : <><Send size={15} /> Confirmar pedido</>}
                            </button>
                            <button onClick={descartar} className="w-full text-[11px] font-bold text-zinc-600 hover:text-rose-400 inline-flex items-center justify-center gap-1"><Trash2 size={11} /> Descartar este pedido</button>
                        </>
                    ) : res.cancelado ? (
                        <p className="text-sm text-zinc-400 flex items-center gap-2"><X size={15} className="text-zinc-500" /> Este pedido se descartó.</p>
                    ) : (
                        <>
                            <ol className="space-y-3">
                                {seguimiento.map((x, i) => (
                                    <li key={i} className="flex items-start gap-2.5">
                                        {x.e === 'hecho' ? <CheckCircle2 size={17} className="text-emerald-400 shrink-0" />
                                            : x.e === 'curso' ? <Loader2 size={17} className="text-brand-cyan animate-spin shrink-0" />
                                                : x.e === 'error' ? <AlertTriangle size={17} className="text-rose-400 shrink-0" />
                                                    : <Circle size={17} className="text-zinc-700 shrink-0" />}
                                        <div className="min-w-0">
                                            <span className={`text-sm font-bold ${x.e === 'espera' ? 'text-zinc-600' : x.e === 'error' ? 'text-rose-300' : 'text-zinc-200'}`}>{x.t}</span>
                                            {x.d && <p className="text-[11px] text-zinc-400 mt-0.5">{x.d}</p>}
                                        </div>
                                    </li>
                                ))}
                            </ol>
                            <div className="border-t border-zinc-800 pt-3 text-[11px] text-zinc-500 space-y-1">
                                <p>{prendas} {unidadTxt(prendas)}{s.ModoCobro === 'PRECIO_ESTABLECIDO' ? <> · <span className="font-gsanscode text-zinc-300">{simbolo(prod.moneda)} {numero(s.PrecioPactado)}</span></> : null}</p>
                                {s.FechaEntrega && <p>Entrega estimada: <span className="text-zinc-300 font-bold">{new Date(s.FechaEntrega).toLocaleDateString('es-UY', { timeZone: 'UTC' })}</span></p>}
                                {p.PedidoNoDocERP && <button onClick={() => navigate('/portal/factory')} className="text-brand-cyan font-bold hover:underline">Seguilo en Mi Fábrica →</button>}
                            </div>
                        </>
                    )}
                </aside>
            </div>
        </div>
    );
};

export default PedidoTiendaView;
