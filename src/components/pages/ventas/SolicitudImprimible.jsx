import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFecha, fmtFechaHora } from '../../../utils/fechas';
import { RESPUESTA_MUESTRA } from './checklistSolicitud';
import { NOMBRE_PARTE, ROL_ARCHIVO, plata } from './solicitudesComunes';

/**
 * Hojas para imprimir de una Solicitud (como las de la maqueta "Ingreso a producción"). Se guardan
 * como PDF desde el cuadro de impresión del navegador (Destino → Guardar como PDF).
 *   ?tipo=taller  → Ficha taller: el pedido completo, con la lista de requisitos pendientes si falta algo.
 *   ?tipo=diseno  → Hoja diseño: solo lo que necesita el diseñador (sin notas internas, plazo ni sector).
 *   ?tipo=completo → PDF completo: todo lo de la ficha taller + cada archivo impreso en miniatura.
 */
const TITULO = { taller: 'Ficha taller', diseno: 'Hoja diseño', completo: 'PDF completo' };

// Miniatura impresa de un archivo: la vista previa pública de Drive (mismo método que la bandeja de Bordado).
// Si Drive no la da (archivo sin compartir o formato sin vista previa), se imprime la extensión.
const driveIdDe = (url) => { const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{10,})|[?&]id=([a-zA-Z0-9_-]{10,})/); return m ? (m[1] || m[2]) : null; };
function MiniaturaImpresa({ a }) {
    const [error, setError] = useState(false);
    const idDrive = driveIdDe(a.UrlDrive);
    const src = idDrive && !error ? `https://drive.google.com/thumbnail?id=${idDrive}&sz=w400` : null;
    const ext = (String(a.NombreOriginal || '').split('.').pop() || '').toUpperCase().slice(0, 4);
    return (
        <figure className="mini-imp border border-slate-300 rounded p-1 text-center m-0">
            <div className="h-28 flex items-center justify-center bg-slate-50 overflow-hidden">
                {src ? <img src={src} alt="" className="max-h-28 max-w-full object-contain" onError={() => setError(true)} /> : <span className="text-lg font-black text-slate-400">{ext || 'ARCHIVO'}</span>}
            </div>
            <figcaption className="text-[9px] leading-tight mt-1 break-all">
                <b>{a.NombreOriginal}</b><br />
                {ROL_ARCHIVO[a.Rol] || a.Rol}{a.AnchoM && a.AltoM ? ` · ${Number(a.AnchoM).toFixed(2)}×${Number(a.AltoM).toFixed(2)} m` : ''}{a.Material ? ` · ${a.Material}` : ''}{a.Copias ? ` · ${a.Copias} copias` : ''}
            </figcaption>
        </figure>
    );
}

// Imprime cuando terminaron de cargar las miniaturas (si no, salen en blanco en el PDF). Tope: 10 s.
const imprimir = async () => {
    const imgs = [...document.querySelectorAll('.hoja img')];
    await Promise.all(imgs.map(img => (img.complete ? null : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); setTimeout(r, 10000); }))));
    window.print();
};
export default function SolicitudImprimible() {
    const { id } = useParams();
    const [params] = useSearchParams();
    const tipo = ['diseno', 'completo'].includes(params.get('tipo')) ? params.get('tipo') : 'taller';
    const esCompleto = tipo === 'completo';
    const [s, setS] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => { svc.obtener(id).then(setS).catch(e => setError(e?.response?.data?.error || e.message)); }, [id]);

    if (error) return <div className="p-8 text-rose-700">{error}</div>;
    if (!s) return <div className="p-8 text-slate-500">Cargando…</div>;

    const f = s.Ficha || {};
    const mu = f.muestra || {};
    const vig = s.Archivos.filter(a => a.Vigente);
    const esDiseno = tipo === 'diseno';
    const H = ({ children }) => <h2 className="text-[11px] font-black uppercase tracking-wide text-slate-500 border-b border-slate-300 pb-0.5 mt-4 mb-1.5">{children}</h2>;
    const F = ({ l, v }) => (v === null || v === undefined || v === '' ? null : <div className="text-xs"><span className="text-slate-500">{l}: </span><span className="text-slate-900 whitespace-pre-line">{v}</span></div>);
    const Archivos = ({ lista, titulo }) => lista.length && esCompleto ? (
        <div className="mt-1.5">
            <div className="text-[10px] font-black uppercase text-slate-500 mb-1">{titulo}</div>
            <div className="grid grid-cols-4 gap-2">{lista.map(a => <MiniaturaImpresa key={a.ArchivoID} a={a} />)}</div>
        </div>
    ) : lista.length ? <div className="text-xs"><span className="text-slate-500">{titulo}: </span>{lista.map(a => <span key={a.ArchivoID} className="inline-block mr-2">{a.NombreOriginal}{a.AnchoM && a.AltoM ? ` (${Number(a.AnchoM).toFixed(2)}×${Number(a.AltoM).toFixed(2)} m${a.Copias ? `, ${a.Copias} copias` : ''})` : ''}{a.Material ? ` · ${a.Material}` : ''} <span className="text-slate-400">[{ROL_ARCHIVO[a.Rol] || a.Rol}]</span></span>)}</div> : null;

    return (
        <div className="bg-white text-slate-900 min-h-screen">
            <style>{`@media print { .no-print { display: none !important } body { background: #fff } .hoja { padding: 0 !important; max-width: none !important } .salto { page-break-before: always } .mini-imp { break-inside: avoid } img { -webkit-print-color-adjust: exact; print-color-adjust: exact } }`}</style>
            <div className="no-print sticky top-0 bg-slate-100 border-b border-slate-300 px-4 py-2 flex flex-wrap items-center gap-2 text-xs">
                <b>{TITULO[tipo]}</b> · Solicitud #{s.SolicitudID}
                <button onClick={imprimir} className="ml-auto px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-bold">Imprimir / guardar como PDF</button>
                {Object.keys(TITULO).filter(t => t !== tipo).map(t => <a key={t} href={`/ventas/solicitudes/${id}/imprimir?tipo=${t}`} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold">Ver {TITULO[t].toLowerCase()}</a>)}
                <span className="text-slate-500">En el cuadro de impresión, en Destino elegí "Guardar como PDF".</span>
            </div>

            <div className="hoja max-w-3xl mx-auto p-6">
                <div className="flex items-start justify-between gap-3 border-b-2 border-slate-900 pb-2">
                    <div>
                        <div className="text-[11px] text-slate-500">{TITULO[tipo].toUpperCase()} · Solicitud #{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</div>
                        <h1 className="text-2xl font-black leading-tight">{s.NombreTrabajo}</h1>
                        <div className="text-sm">{s.ClienteNombre}{s.ClienteCodigo ? ` · ${s.ClienteCodigo}` : ''} · vendedor {s.VendedorNombre || '—'}</div>
                    </div>
                    <div className="text-right text-xs">
                        {s.Productos.some(p => p.PedidoNoDocERP) && <div className="font-black text-base">Pedido {s.Productos.filter(p => p.PedidoNoDocERP).map(p => p.PedidoNoDocERP).join(', ')}</div>}
                        {!esDiseno && <div>Entrega: <b>{s.FechaEntrega ? `${fmtFecha(s.FechaEntrega)}${s.FechaEntregaHasta ? ` → ${fmtFecha(s.FechaEntregaHasta)}` : ''}` : 'sin fecha'}</b></div>}
                        {!esDiseno && <div>{f.dondeSeCose === 'EXTERNO' ? `Taller externo${f.tallerExterno ? `: ${f.tallerExterno}` : ''}` : 'Se cose en nuestro taller'}</div>}
                    </div>
                </div>

                <H>Qué pide el cliente</H>
                <div className="text-sm whitespace-pre-line">{s.Detalle}</div>
                {s.Observaciones && <F l="Observaciones" v={s.Observaciones} />}
                <Archivos titulo="Archivos generales" lista={vig.filter(a => !a.ProductoSolID && !a.ParteID && !a.EventoID)} />

                {s.Productos.map((p, i) => {
                    const d = p.Datos || {};
                    const e = d.espec || {};
                    const conv = s.Conversion.find(c => c.ProductoSolID === p.ProductoSolID);
                    const principal = p.Partes.find(x => x.Tipo === 'PRINCIPAL');
                    return (
                        <div key={p.ProductoSolID} className={i > 0 ? 'salto' : ''}>
                            <H>Producto {i + 1}: {p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || `Producto ${p.ProIdProducto}`) : 'Personalizado'} · {p.Cantidad} unidades{p.PedidoNoDocERP ? ` · pedido ${p.PedidoNoDocERP}` : ''}</H>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                                <F l="Tipo de trabajo" v={d.tipoTrabajo} />
                                <F l="Cómo se define" v={d.comoSeDefine === 'MEDIDA' ? 'Por medidas en cm' : 'Por talle'} />
                                {d.comoSeDefine === 'MEDIDA' ? <><F l="Medidas y cantidad por medida" v={d.medidas} /><F l="Terminación / costura" v={d.terminacion} /></>
                                    : <><F l="Talles" v={d.notaTalles} /><F l="Medidas de la prenda" v={d.medidasPrenda || (d.tablaEstandar ? 'Tabla estándar del taller, confirmada con el cliente' : '')} /></>}
                                {d.personalizacion && <F l="Nombres y números" v={d.listaCerrada ? 'Lista completa y cerrada' : 'LISTA SIN CERRAR'} />}
                                {(d.productoNuevo || d.produccionGrande || d.requiereMuestra) && <F l="Marcas" v={[d.productoNuevo && 'Producto nuevo', d.produccionGrande && 'Producción grande', d.requiereMuestra && `Muestra: ${d.muestraAprobada ? 'aprobada' : 'requiere confección, sin aprobar'}`].filter(Boolean).join(' · ')} />}
                                {d.muestraFisica && <F l="Referencia" v="El cliente entregó muestra física o molde" />}
                                {d.corte?.activo && <F l="Corte" v={`${d.corte.tipoMolde} · ${d.corte.origenTela}`} />}
                                {d.costura?.activo && <F l="Costura" v={d.costura.instrucciones || 'Sin instrucciones especiales'} />}
                                {p.Observaciones && <div className="col-span-2"><F l="Observaciones" v={p.Observaciones} /></div>}
                            </div>
                            {d.productoNuevo && (
                                <div className="mt-1.5 border border-slate-300 rounded p-2 grid grid-cols-2 gap-x-6 gap-y-0.5">
                                    <div className="col-span-2 text-[10px] font-black uppercase text-slate-500">Especificaciones técnicas (producto nuevo)</div>
                                    <F l="Costuras" v={e.costuras} /><F l="Terminaciones" v={e.terminaciones} /><F l="Avíos y accesorios" v={e.avios} /><F l="Tela e insumos" v={e.tela ? `${e.tela}${e.provee ? ` — provee ${e.provee === 'TALLER' ? 'el taller' : 'el cliente'}` : ''}` : ''} />
                                </div>
                            )}
                            <Archivos titulo="Planilla / referencias del producto" lista={vig.filter(a => a.ProductoSolID === p.ProductoSolID && !a.ParteID)} />

                            <div className="mt-2 space-y-1.5">
                                {p.Partes.map(pa => {
                                    const dd = pa.Datos || {};
                                    return (
                                        <div key={pa.ParteID} className="border-l-2 border-slate-400 pl-2">
                                            <div className="text-xs font-black">{NOMBRE_PARTE[pa.Tipo]}{pa.Tipo !== 'PRINCIPAL' ? ` · ${pa.CantidadTotal ?? p.Cantidad} en total${pa.PorPrenda ? ` · ${pa.PorPrenda} por prenda` : ''}` : ''}{pa.Ubicacion ? ` · ${pa.Ubicacion}` : ''}</div>
                                            <div className="grid grid-cols-2 gap-x-6">
                                                {dd.variante && <F l={pa.Tipo === 'BORDADO' ? 'Dónde se borda' : 'Tipo'} v={dd.variante} />}
                                                {dd.material && <F l={pa.Tipo === 'BORDADO' ? 'Tipo de bordado' : pa.Tipo === 'DTF' ? 'Film' : 'Artículo'} v={dd.material} />}
                                                {dd.origenPrendas && <F l="Origen de las prendas" v={dd.origenPrendas} />}
                                                {pa.Tipo !== 'PRINCIPAL' && <F l="El arte" v={pa.ArteOrigen === 'CLIENTE' ? 'viene listo del cliente' : 'se diseña en la empresa'} />}
                                            </div>
                                            {pa.Observaciones && <F l="Indicaciones para Diseño" v={pa.Observaciones} />}
                                            <Archivos titulo="Arte del cliente / bocetos" lista={vig.filter(a => a.ParteID === pa.ParteID && a.Rol !== 'DISENO_PRONTO')} />
                                            <Archivos titulo="Diseño pronto" lista={vig.filter(a => a.ParteID === pa.ParteID && a.Rol === 'DISENO_PRONTO')} />
                                        </div>
                                    );
                                })}
                            </div>
                            {principal && d.diseno?.origen && <F l="Diseño" v={d.diseno.origen === 'NO' ? 'No lleva' : d.diseno.origen === 'CLIENTE' ? `lo entrega el cliente${d.diseno.verificado ? ' · archivo verificado' : ' · archivo SIN verificar'}` : `lo hace el taller${d.diseno.aprobado ? ' · propuesta aprobada por escrito' : ' · propuesta SIN aprobar'}`} />}

                            {!esDiseno && conv?.checklist && !conv.checklist.listo && (
                                <div className="mt-2 border border-rose-400 rounded p-2 text-xs">
                                    <div className="font-black text-rose-700">Requisitos pendientes (frenan el ingreso):</div>
                                    <ul className="list-disc pl-4">{conv.checklist.faltan.map((x, k) => <li key={k}>{x}</li>)}</ul>
                                </div>
                            )}
                        </div>
                    );
                })}

                {f.indicaciones && <><H>Indicaciones del cliente</H><div className="text-sm whitespace-pre-line">{f.indicaciones}</div></>}

                {!esDiseno && (
                    <>
                        <H>Muestra, plazo y cobro</H>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                            {mu.ofrecida && <F l="Muestra" v={`ofrecida · ${RESPUESTA_MUESTRA[mu.respuesta] || 'respuesta sin registrar'}${mu.respuesta !== 'RECHAZO' ? ` · aprobada: ${mu.aprobada ? 'sí' : 'no'}` : ''}`} />}
                            <F l="Cómo se cobra" v={!s.ModoCobro ? 'Sin pactar' : s.ModoCobro === 'POR_AREA' ? 'Por cada área' : `Precio establecido ${plata(s.PrecioPactado, s.MonIdMoneda)}`} />
                            <F l="Seña" v={!s.RequiereSena ? 'No requiere' : s.SenaConfirmada ? `${plata(s.SenaMonto, s.MonIdMoneda)} confirmada (${s.SenaVia || ''})` : `${plata(s.SenaMontoRequerido, s.MonIdMoneda)} SIN confirmar`} />
                        </div>
                        {f.notasInternas && <><H>Notas internas</H><div className="text-sm whitespace-pre-line">{f.notasInternas}</div></>}
                    </>
                )}
                <div className="mt-6 text-[10px] text-slate-400 border-t border-slate-200 pt-1">Impreso el {fmtFechaHora(new Date())} · {TITULO[tipo]} · Solicitud #{s.SolicitudID}</div>
            </div>
        </div>
    );
}
