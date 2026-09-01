import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Listbox } from '@headlessui/react';
import api from '../../services/api';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import {
    PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import {
    Search, Loader2, ChevronDown, ChevronRight, Package, PackagePlus, Truck, Scale,
    Printer, Check, X, AlertTriangle, Boxes, ScanLine, Plus, Trash2, ArrowRight, ArrowUpRight, PackageCheck,
    LayoutDashboard, DollarSign, TrendingUp, Layers, History, ShoppingCart, Lock, Unlock, CircleDot,
    MapPin, Inbox, Send, Paperclip, FileText, Upload, CalendarDays, CalendarOff, ChevronLeft,
    Factory, Anchor, Ship, CheckCircle2, Pencil, Settings, Workflow, ChevronUp, Activity
} from 'lucide-react';

// Los pasos de cada plantilla traen su icono por nombre (columna Icono, migrada del
// sistema anterior). Nombre → componente Lucide; si aparece uno nuevo, cae en CircleDot.
const ICONOS_PASO = { Package, Factory, Truck, Anchor, Ship, MapPin, CheckCircle2, Boxes, Inbox };

// [WMS PROPIO — F3] /stock — gestión del stock propio (tablas Wms_*, API /api/wms-interno).
// Cuatro pestañas: Inventario (buscar → variantes → etiquetas, ajustar por conteo, imprimir),
// Ingreso (alta de etiqueta + impresión), Remitos internos (crear = descuenta origen;
// recibir por item — el último cierra el remito solo) y Diferencias (la bandeja que alimenta
// el backend cuando falta stock). Plan: docs/wms-propio-plan.md.

const fmtCant = (v) => {
    const n = Number(v);
    if (v == null || isNaN(n)) return '—';
    return n % 1 === 0 ? n.toLocaleString('es-UY') : n.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtFecha = (v) => v ? new Date(v).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
// Un solo símbolo por moneda en todo el módulo (la tabla trae 'U$S', acá va 'US$').
const simMoneda = (cod) => String(cod || '').toUpperCase() === 'USD' ? 'US$' : '$';
// Capital Case para textos que vienen con casing inconsistente ('JIAXING ZHEJIANG' → 'Jiaxing Zhejiang').
// CSS capitalize no alcanza: solo sube la primera letra, no baja el resto.
const capitalizar = (v) => String(v || '').toLowerCase().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));

// Etiqueta física: ventana propia (como el resto de las impresiones del sistema), QR = EtiId.
async function imprimirEtiqueta({ etiId, producto, variante, talle, color, cantidad, unidad, codigoBarras }) {
    let qr = '';
    try { qr = await QRCode.toDataURL(String(etiId), { margin: 1, width: 220 }); } catch (e) { /* sin QR igual sale */ }
    const w = window.open('', '_blank', 'width=420,height=520');
    if (!w) { toast.error('El navegador bloqueó la ventana de impresión'); return; }
    const ejes = [talle, color].filter(Boolean).join(' · ');
    w.document.write(`<!DOCTYPE html><html><head><title>Etiqueta ${etiId}</title><style>
        @page { size: 100mm 60mm; margin: 3mm; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 6px; }
        .fila { display: flex; gap: 10px; align-items: center; }
        .qr { width: 42mm; height: 42mm; }
        .prod { font-size: 13px; font-weight: bold; margin: 0 0 2px; }
        .var { font-size: 12px; margin: 0 0 2px; }
        .ejes { font-size: 11px; color: #444; margin: 0 0 6px; }
        .cant { font-size: 20px; font-weight: bold; margin: 0; }
        .id { font-size: 26px; font-weight: 900; letter-spacing: 1px; margin: 4px 0 0; }
        .cb { font-size: 10px; color: #666; margin-top: 2px; }
    </style></head><body>
        <div class="fila">
            ${qr ? `<img class="qr" src="${qr}">` : ''}
            <div>
                <p class="prod">${(producto || '').substring(0, 40)}</p>
                <p class="var">${(variante || '').substring(0, 40)}</p>
                ${ejes ? `<p class="ejes">${ejes}</p>` : ''}
                <p class="cant">${fmtCant(cantidad)} ${unidad || ''}</p>
                <p class="id">#${etiId}</p>
                ${codigoBarras ? `<p class="cb">${codigoBarras}</p>` : ''}
            </div>
        </div>
        <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`);
    w.document.close();
}

// Select de la casa (Headless UI): mismo comportamiento en toda la sección.
// opciones: [{ value, label }] · size 'sm' para los de dentro del modal.
function Selector({ value, onChange, opciones = [], placeholder = 'Seleccionar...', size = 'md', className = '', ancho = '' }) {
    const sel = opciones.find(o => String(o.value) === String(value));
    const chico = size === 'sm';
    return (
        <Listbox value={value} onChange={onChange}>
            <div className={`relative ${ancho || 'min-w-[150px]'} ${className}`}>
                <Listbox.Button className={`w-full flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 outline-none hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 transition-all whitespace-nowrap ${chico ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-sm'}`}>
                    <span className={`truncate ${sel ? '' : 'text-slate-400'}`}>{sel ? sel.label : placeholder}</span>
                    <ChevronDown size={chico ? 12 : 14} className="text-slate-400 shrink-0" />
                </Listbox.Button>
                <Listbox.Options anchor={{ to: 'bottom start', gap: 4 }}
                    className="z-[6200] min-w-[var(--button-width)] w-max max-w-[260px] bg-white border border-slate-200 rounded-xl shadow-xl overflow-auto max-h-64 outline-none">
                    {opciones.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Sin opciones</p>}
                    {opciones.map(o => (
                        <Listbox.Option key={o.value} value={o.value}
                            className={({ active }) => `flex items-center justify-between gap-3 px-3 py-2 text-xs font-bold cursor-pointer transition-colors ${active ? 'bg-slate-50 text-slate-900' : 'text-slate-600'}`}>
                            {({ selected }) => (
                                <>
                                    <span className="truncate">{o.label}</span>
                                    {selected && <Check size={12} className="text-sky-600 shrink-0" />}
                                </>
                            )}
                        </Listbox.Option>
                    ))}
                </Listbox.Options>
            </div>
        </Listbox>
    );
}

// Incoterms 2020. El código es lo que se guarda; el texto es para que el que
// carga la compra no tenga que acordarse de memoria qué cubre cada uno.
const INCOTERMS = [
    { value: 'EXW', label: 'EXW — En fábrica' },
    { value: 'FCA', label: 'FCA — Franco transportista' },
    { value: 'FAS', label: 'FAS — Franco al costado del buque' },
    { value: 'FOB', label: 'FOB — Franco a bordo' },
    { value: 'CFR', label: 'CFR — Costo y flete' },
    { value: 'CIF', label: 'CIF — Costo, seguro y flete' },
    { value: 'CPT', label: 'CPT — Transporte pagado hasta' },
    { value: 'CIP', label: 'CIP — Transporte y seguro pagados hasta' },
    { value: 'DAP', label: 'DAP — Entregada en lugar' },
    { value: 'DPU', label: 'DPU — Entregada en lugar descargada' },
    { value: 'DDP', label: 'DDP — Entregada derechos pagados' },
];
// yyyy-MM-dd para <input type="date"> (la fecha viene como ISO del backend)
const fechaInput = (v) => v ? String(v).slice(0, 10) : '';

// Chip de dato suelto (arribo, volumen, peso, incoterm)
function Dato({ icono: Ico, label, valor, ayuda }) {
    return (
        <div title={ayuda || ''} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200">
            <Ico size={15} className="text-slate-300 shrink-0" />
            <div className="leading-tight">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                <p className="text-sm font-black text-slate-700 tabular-nums font-gsanscode">{valor}</p>
            </div>
        </div>
    );
}

// Campo con etiqueta arriba (el layout de formulario del sistema anterior)
function Campo({ label, error = false, children }) {
    return (
        <div className="space-y-1.5">
            <label className={`block text-[10px] font-black uppercase tracking-widest pl-1 ${error ? 'text-rose-500' : 'text-slate-400'}`}>{label}</label>
            {children}
        </div>
    );
}

/* ── SELECTOR DE FECHA ─────────────────────────────────────────────────────
 * Reemplazo del <input type="date"> nativo, que Chrome dibuja en SU idioma de
 * UI (mm/dd/yyyy en inglés) ignorando el lang="es" de la página.
 *
 * MISMO CONTRATO que el nativo — value = 'yyyy-MM-dd' | '' y onChange(string) —
 * así se puede sustituir en el resto del sistema con buscar y reemplazar.
 *
 * Ojo con las fechas "sin hora": SIEMPRE se construyen con new Date(a, m, d)
 * en hora local. new Date('2026-11-15') parsea en UTC y en Uruguay (-03) cae
 * el día anterior — el mismo bug que hubo al guardar el arribo de las compras.
 */
const DIAS_ES = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const MESES_ES = Array.from({ length: 12 }, (_, m) =>
    new Intl.DateTimeFormat('es-UY', { month: 'long' }).format(new Date(2026, m, 1)));

const aISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const deISO = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const mismoDia = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const PANEL_ANCHO = 268;   // px — hay que saberlo para acotarlo a la pantalla
const PANEL_ALTO = 330;

function SelectorFecha({ value, onChange, placeholder = 'dd/mm/aaaa', min, max, className = '', ancho = 'w-40' }) {
    const elegido = deISO(value);
    const hoy = new Date();
    const [abierto, setAbierto] = useState(false);
    const [cursor, setCursor] = useState(() => elegido || new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const [pos, setPos] = useState(null);          // posición fija del panel portalizado
    const caja = useRef(null);
    const panel = useRef(null);

    // El panel vive en document.body: no lo recorta ningún overflow y no se sale
    // de la pantalla cuando el campo está contra el borde derecho.
    const ubicar = useCallback(() => {
        const r = caja.current?.getBoundingClientRect();
        if (!r) return;
        const M = 8;                                // aire contra los bordes
        let izq = r.left;
        // No entra a la derecha → se alinea por el borde derecho del campo
        if (izq + PANEL_ANCHO > window.innerWidth - M) izq = r.right - PANEL_ANCHO;
        izq = Math.max(M, Math.min(izq, window.innerWidth - PANEL_ANCHO - M));
        // No entra abajo → se abre hacia arriba, si arriba hay lugar
        let arr = r.bottom + 4;
        if (arr + PANEL_ALTO > window.innerHeight - M && r.top - PANEL_ALTO - 4 > M) arr = r.top - PANEL_ALTO - 4;
        setPos({ top: arr, left: izq });
    }, []);

    // Al reabrir, pararse en el mes de lo elegido y ubicar el panel
    useEffect(() => {
        if (!abierto) return;
        setCursor(deISO(value) || new Date(hoy.getFullYear(), hoy.getMonth(), 1));
        ubicar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto]);

    // Cerrar al click afuera o con Escape; reubicar si scrollea o cambia el tamaño
    useEffect(() => {
        if (!abierto) return;
        const fuera = (e) => {
            if (caja.current?.contains(e.target) || panel.current?.contains(e.target)) return;
            setAbierto(false);
        };
        const esc = (e) => { if (e.key === 'Escape') setAbierto(false); };
        document.addEventListener('mousedown', fuera);
        document.addEventListener('keydown', esc);
        window.addEventListener('resize', ubicar);
        window.addEventListener('scroll', ubicar, true);   // capture: agarra scrolls internos
        return () => {
            document.removeEventListener('mousedown', fuera);
            document.removeEventListener('keydown', esc);
            window.removeEventListener('resize', ubicar);
            window.removeEventListener('scroll', ubicar, true);
        };
    }, [abierto, ubicar]);

    const limMin = deISO(min), limMax = deISO(max);
    const fueraDeRango = (d) => (limMin && d < limMin) || (limMax && d > limMax);

    // Grilla del mes, arrancando en lunes (como se escriben los calendarios acá)
    const celdas = useMemo(() => {
        const primero = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const corr = (primero.getDay() + 6) % 7;              // domingo=0 → lunes=0
        const arranque = new Date(primero.getFullYear(), primero.getMonth(), 1 - corr);
        return Array.from({ length: 42 }, (_, i) =>
            new Date(arranque.getFullYear(), arranque.getMonth(), arranque.getDate() + i));
    }, [cursor]);

    const mover = (n) => setCursor(c => new Date(c.getFullYear(), c.getMonth() + n, 1));
    const elegir = (d) => { onChange(aISO(d)); setAbierto(false); };

    return (
        <div ref={caja} className={`relative ${ancho} ${className}`}>
            <button type="button" onClick={() => setAbierto(a => !a)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 transition-all">
                <span className={elegido ? 'font-bold text-slate-700 tabular-nums font-gsanscode' : 'text-slate-400'}>
                    {elegido ? elegido.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' }) : placeholder}
                </span>
                <CalendarDays size={15} className="text-slate-400 shrink-0" />
            </button>

            {abierto && pos && createPortal(
                <div ref={panel} style={{ top: pos.top, left: pos.left, width: PANEL_ANCHO }}
                    className="fixed z-[6200] bg-white border border-slate-200 rounded-2xl shadow-xl p-3">
                    <div className="flex items-center gap-1 mb-2">
                        <button type="button" onClick={() => mover(-1)} title="Mes anterior"
                            className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 flex items-center justify-center">
                            <ChevronLeft size={16} />
                        </button>
                        <p className="flex-1 text-center text-xs font-black uppercase tracking-wider text-slate-700">
                            {MESES_ES[cursor.getMonth()]} {cursor.getFullYear()}
                        </p>
                        <button type="button" onClick={() => mover(1)} title="Mes siguiente"
                            className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 flex items-center justify-center">
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {DIAS_ES.map(d => (
                            <span key={d} className="h-6 flex items-center justify-center text-[10px] font-black uppercase text-slate-400">{d}</span>
                        ))}
                    </div>

                    <div className="grid grid-cols-7 gap-0.5">
                        {celdas.map((d, i) => {
                            const otroMes = d.getMonth() !== cursor.getMonth();
                            const sel = mismoDia(d, elegido);
                            const esHoy = mismoDia(d, hoy);
                            const bloqueado = fueraDeRango(d);
                            return (
                                <button key={i} type="button" disabled={bloqueado} onClick={() => elegir(d)}
                                    className={`h-8 rounded-lg text-xs tabular-nums font-gsanscode transition-colors ${
                                        sel ? 'bg-brand-cyan text-white font-black'
                                        : bloqueado ? 'text-slate-200 cursor-not-allowed'
                                        : otroMes ? 'text-slate-300 hover:bg-slate-50'
                                        : 'text-slate-700 font-bold hover:bg-sky-50'
                                    } ${esHoy && !sel ? 'ring-1 ring-inset ring-sky-300' : ''}`}>
                                    {d.getDate()}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                        <button type="button" onClick={() => { onChange(''); setAbierto(false); }}
                            className="text-[11px] font-black text-slate-400 hover:text-slate-600 px-1">Limpiar</button>
                        <button type="button" onClick={() => elegir(new Date())}
                            className="text-[11px] font-black text-sky-600 hover:text-sky-700 px-1">Hoy</button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

// Hoja de remito para imprimir: ventana propia, igual que las etiquetas.
function imprimirRemito(cab, items) {
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) { toast.error('El navegador bloqueó la ventana de impresión'); return; }
    const filas = items.map(i => `<tr>
        <td class="c">${fmtCant(i.CantidadEnviada)}</td>
        <td class="c">${Number(i.CantidadRecibida) > 0 ? fmtCant(i.CantidadRecibida) : '—'}</td>
        <td>${i.Producto || ''}</td>
        <td class="v">${[i.NombreVariante, i.Talle, i.Color].filter(Boolean).join(' · ')}</td>
    </tr>`).join('');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${cab.Numeracion}</title><style>
        @page { size: A4; margin: 14mm; }
        /* El padding es para la ventana en pantalla; al imprimir manda el @page */
        body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 14mm; }
        @media print { body { padding: 0; } }
        h1 { font-size: 26px; margin: 0; line-height: 1.1; letter-spacing: -.5px; white-space: nowrap; }
        .sub { font-size: 9px; letter-spacing: .18em; color: #94a3b8; text-transform: uppercase; margin-top: 6px; }
        .top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
        .doc { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; min-width: 300px; }
        .doc div { display: flex; justify-content: space-between; gap: 20px; padding: 4px 0; font-size: 11px; }
        .doc .k { color: #94a3b8; text-transform: uppercase; letter-spacing: .1em; font-size: 9px; }
        .doc .val { font-weight: bold; font-family: 'Courier New', monospace; }
        .ok { color: #047857; font-weight: bold; }
        hr { border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0; }
        .deps { display: flex; gap: 14px; margin-bottom: 20px; }
        .dep { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; }
        .dep .k { font-size: 8.5px; letter-spacing: .14em; color: #94a3b8; text-transform: uppercase; }
        .dep .n { font-size: 17px; font-weight: bold; margin-top: 3px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { text-align: left; font-size: 8.5px; letter-spacing: .12em; text-transform: uppercase; color: #94a3b8;
             border-bottom: 1px solid #e2e8f0; padding: 7px 8px; }
        td { padding: 8px; border-bottom: 1px solid #f1f5f9; }
        td.c, th.c { text-align: center; font-family: 'Courier New', monospace; font-weight: bold; width: 70px; }
        td.v { text-align: right; color: #059669; font-size: 10px; text-transform: uppercase; }
        .obs { margin-top: 18px; font-size: 10px; color: #64748b; }
        .pie { margin-top: 28px; font-size: 9px; color: #94a3b8; }
    </style></head><body>
        <div class="top">
            <div><h1>REMITO DE MOVIMIENTO</h1><p class="sub">Sistema logístico interno · WMS</p></div>
            <div class="doc">
                <div><span class="k">N° documento</span><span class="val">${cab.Numeracion || ''}</span></div>
                <div><span class="k">Fecha operación</span><span class="val">${cab.FechaCreacion ? new Date(cab.FechaCreacion).toLocaleString('es-UY') : '—'}</span></div>
                <div><span class="k">Estado</span><span class="val ok">${cab.Estado || ''}</span></div>
                ${cab.Responsable ? `<div><span class="k">Responsable</span><span class="val">${cab.Responsable}</span></div>` : ''}
            </div>
        </div>
        <hr/>
        <div class="deps">
            <div class="dep"><p class="k">↗ Sale desde (origen logístico)</p><p class="n">${cab.DepOrigen || '—'}</p></div>
            <div class="dep"><p class="k">⇄ Llega a (destino físico)</p><p class="n">${cab.DepDestino || '—'}</p></div>
        </div>
        <table>
            <thead><tr><th class="c">C. env</th><th class="c">C. rec</th><th>Artículo / descripción</th><th style="text-align:right">Var / lote</th></tr></thead>
            <tbody>${filas}</tbody>
        </table>
        ${cab.Observaciones ? `<p class="obs"><b>Observaciones:</b> ${cab.Observaciones}</p>` : ''}
        <p class="pie">${items.length} línea${items.length !== 1 ? 's' : ''} · impreso el ${new Date().toLocaleString('es-UY')}</p>
    </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 250);
}

// Hoja de remito en pantalla (se abre desde el REM-xxxxxxx del historial)
function ModalRemito({ remId, onCerrar }) {
    const [cab, setCab] = useState(null);
    const [items, setItems] = useState([]);
    const [cargando, setCargando] = useState(true);

    useEffect(() => {
        let vivo = true;
        api.get(`/wms-interno/remitos/${remId}`)
            .then(r => { if (!vivo) return; setCab(r.data?.cabecera || null); setItems(r.data?.data || []); })
            .catch(() => toast.error('No se pudo cargar el remito'))
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [remId]);

    const TONO = {
        RECIBIDO: 'text-emerald-600', EN_TRANSITO: 'text-sky-600',
        CANCELADO: 'text-rose-600',
    };

    return createPortal(
        <div className="fixed inset-0 z-[6000] flex items-start justify-center p-4 overflow-y-auto bg-slate-900/70"
            onClick={onCerrar}>
            <div onClick={e => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 overflow-hidden">
                {/* Barra de acciones DENTRO de la tarjeta: afuera se montaba sobre la navbar */}
                <div className="flex justify-end gap-2 px-6 py-3 border-b border-slate-100 bg-slate-50/60">
                    <button onClick={() => cab && imprimirRemito(cab, items)} disabled={!cab}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan hover:brightness-110 text-white text-[11px] font-black uppercase tracking-wider disabled:opacity-50">
                        <Printer size={14} /> Imprimir hoja
                    </button>
                    <button onClick={onCerrar}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 text-[11px] font-black uppercase tracking-wider">
                        <X size={14} /> Cerrar
                    </button>
                </div>

                {cargando ? (
                    <div className="flex items-center gap-2 text-slate-400 text-sm py-24 justify-center">
                        <Loader2 size={18} className="animate-spin" /> Cargando...
                    </div>
                ) : !cab ? (
                    <div className="text-center py-24 text-slate-400 text-sm">No se encontró el remito.</div>
                ) : (
                    <div className="p-8">
                        <div className="flex flex-wrap items-start justify-between gap-6">
                            <div>
                                <h2 className="text-3xl font-black text-slate-800 leading-none tracking-tight">REMITO DE<br />MOVIMIENTO</h2>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mt-2">
                                    Sistema logístico interno · WMS
                                </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 px-4 py-3 min-w-[300px] space-y-1">
                                {[
                                    ['N° documento', <span className="font-gsanscode">{cab.Numeracion}</span>],
                                    ['Fecha operación', <span className="font-gsanscode">{cab.FechaCreacion ? new Date(cab.FechaCreacion).toLocaleString('es-UY') : '—'}</span>],
                                    ['Estado', <span className={`font-gsanscode ${TONO[cab.Estado] || 'text-slate-600'}`}>{cab.Estado}</span>],
                                    ...(cab.Responsable ? [['Responsable', <span>{cab.Responsable}</span>]] : []),
                                ].map(([k, v], i) => (
                                    <div key={i} className="flex items-center justify-between gap-6">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{k}</span>
                                        <span className="text-xs font-black text-slate-700 tabular-nums">{v}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="border-t border-slate-100 my-6" />

                        <div className="grid sm:grid-cols-2 gap-3 mb-6">
                            <div className="rounded-xl border border-slate-200 px-4 py-3">
                                <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                    <ArrowUpRight size={11} /> Sale desde (origen logístico)
                                </p>
                                <p className="text-lg font-black text-slate-800 mt-0.5">{cab.DepOrigen || '—'}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 px-4 py-3">
                                <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                    <ArrowRight size={11} /> Llega a (destino físico)
                                </p>
                                <p className="text-lg font-black text-slate-800 mt-0.5">{cab.DepDestino || '—'}</p>
                            </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                            <div className="grid grid-cols-[70px_70px_1fr_180px] gap-2 px-4 py-2 bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                <span className="text-center">C. env</span>
                                <span className="text-center">C. rec</span>
                                <span>Artículo / descripción</span>
                                <span className="text-right">Var / lote</span>
                            </div>
                            <div className="divide-y divide-slate-50">
                                {items.length === 0 ? (
                                    <p className="px-4 py-8 text-center text-xs text-slate-400">El remito no tiene líneas.</p>
                                ) : items.map(i => (
                                    <div key={i.RemItId} className="grid grid-cols-[70px_70px_1fr_180px] gap-2 px-4 py-2.5 items-center">
                                        <span className="text-center text-sm font-black text-slate-700 tabular-nums font-gsanscode">{fmtCant(i.CantidadEnviada)}</span>
                                        <span className="text-center text-sm font-bold text-slate-400 tabular-nums font-gsanscode">
                                            {Number(i.CantidadRecibida) > 0 ? fmtCant(i.CantidadRecibida) : '—'}
                                        </span>
                                        <span className="text-sm font-bold text-slate-700 truncate">{i.Producto}</span>
                                        <span className="text-right text-[10px] font-bold uppercase text-emerald-600 truncate">
                                            {[i.NombreVariante, i.Talle, i.Color].filter(Boolean).join(' · ')}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {cab.Observaciones && (
                            <p className="text-xs text-slate-500 mt-4"><b>Observaciones:</b> {cab.Observaciones}</p>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}

// Autocomplete de variantes (lo usan Ingreso y Remitos)
function BuscadorVariante({ onElegir, placeholder = 'Buscar producto o variante...' }) {
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [abierto, setAbierto] = useState(false);
    const [buscando, setBuscando] = useState(false);
    const [buscado, setBuscado] = useState(false);   // ya volvió una búsqueda para esta q
    const timer = useRef(null);
    useEffect(() => {
        if (q.trim().length < 2) { setRes([]); setBuscado(false); setBuscando(false); return; }
        setBuscando(true); setBuscado(false);
        clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
            try {
                const r = await api.get(`/wms-interno/variantes?q=${encodeURIComponent(q.trim())}`);
                setRes(r.data?.data || []);
                setAbierto(true);
            } catch (e) { setRes([]); }
            finally { setBuscando(false); setBuscado(true); }
        }, 300);
        return () => clearTimeout(timer.current);
    }, [q]);
    return (
        <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => q.trim().length >= 2 && setAbierto(true)}
                placeholder={placeholder}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
            {buscando && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 animate-spin" />}
            {/* Sin esto el campo queda mudo cuando no hay match y parece que no funciona */}
            {abierto && buscado && res.length === 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-3">
                    <p className="text-xs font-bold text-slate-500">Ningún artículo coincide con “{q.trim()}”.</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Probá con el nombre del producto, la variante o el código.</p>
                </div>
            )}
            {abierto && res.length > 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-y-auto">
                    {res.map(v => (
                        <button key={v.VarId} type="button"
                            onClick={() => { onElegir(v); setQ(''); setRes([]); setAbierto(false); }}
                            className="w-full text-left px-3 py-2.5 hover:bg-sky-50 border-b border-slate-50 last:border-b-0">
                            <p className="text-sm font-bold text-slate-700">{v.Producto}</p>
                            <p className="text-xs text-slate-500">
                                {v.NombreVariante}
                                {(v.Talle || v.Color) && <span className="ml-1 text-slate-400">({[v.Talle, v.Color].filter(Boolean).join(' · ')})</span>}
                                {v.CodigoVariante && <span className="ml-1 font-mono text-[10px] text-slate-400">{v.CodigoVariante}</span>}
                            </p>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

const StockGestionPage = () => {
    const [tab, setTab] = useState('panel');
    const [depositos, setDepositos] = useState([]);
    const [dep, setDep] = useState(5);
    const [pendDisc, setPendDisc] = useState(0);

    useEffect(() => {
        api.get('/wms-interno/depositos').then(r => setDepositos(r.data?.data || [])).catch(() => toast.error('No se pudieron cargar los depósitos'));
        api.get('/wms-interno/discrepancias?estado=PENDIENTE').then(r => setPendDisc((r.data?.data || []).length)).catch(() => {});
    }, []);

    const nombreDep = (id) => depositos.find(d => d.DepId === id)?.Nombre || `Dep ${id}`;

    // Misma navegación que el sistema anterior, para que nadie tenga que reaprender:
    // Panel de Control · Inventario Global · Mi Sector · Compras
    const tabs = [
        { id: 'panel', label: 'Panel de Control', icono: LayoutDashboard },
        { id: 'global', label: 'Inventario Global', icono: Boxes, badge: pendDisc },
        { id: 'sector', label: 'Mi Sector', icono: MapPin },
        { id: 'compras', label: 'Compras', icono: ShoppingCart },
        { id: 'gestion', label: 'Gestión de Sistema', icono: Settings },
    ];

    return (
        <div className="p-4 md:p-6 xl:px-10 w-full font-dmsans">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2"><Package size={24} className="text-sky-600" /> Stock</h1>
                    <p className="text-sm text-slate-500 mt-1">Gestión del depósito propio: etiquetas, ingresos, traslados y diferencias.</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Depósito</span>
                    <Listbox value={dep} onChange={setDep}>
                        <div className="relative min-w-[180px]">
                            <Listbox.Button className="w-full flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 outline-none hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 transition-all shadow-sm whitespace-nowrap">
                                <span>{nombreDep(dep)}</span>
                                <ChevronDown size={14} className="text-slate-400 shrink-0" />
                            </Listbox.Button>
                            <Listbox.Options className="absolute right-0 z-40 mt-1 min-w-full w-max bg-white border border-slate-200 rounded-xl shadow-xl overflow-auto max-h-64 outline-none">
                                {(depositos.length ? depositos : [{ DepId: 5, Nombre: 'Depósito 5' }]).map(d => (
                                    <Listbox.Option key={d.DepId} value={d.DepId}
                                        className={({ active }) => `flex items-center justify-between gap-3 px-4 py-2 text-sm font-bold cursor-pointer transition-colors whitespace-nowrap ${active ? 'bg-slate-50 text-slate-900' : 'text-slate-600'}`}>
                                        {({ selected }) => (
                                            <>
                                                <span>{d.Nombre || `Depósito ${d.DepId}`}</span>
                                                {selected && <Check size={13} className="text-sky-600 shrink-0" />}
                                            </>
                                        )}
                                    </Listbox.Option>
                                ))}
                            </Listbox.Options>
                        </div>
                    </Listbox>
                </div>
            </div>

            <div className="flex gap-1.5 mb-4 flex-wrap">
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-black transition-colors ${tab === t.id ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        <t.icono size={15} /> {t.label}
                        {t.badge > 0 && <span className="ml-0.5 text-[10px] bg-amber-400 text-amber-900 rounded-full px-1.5 py-0.5 font-black">{t.badge}</span>}
                    </button>
                ))}
            </div>

            {tab === 'panel' && <TabPanel />}
            {tab === 'global' && <InventarioGlobal dep={dep} depositos={depositos} nombreDep={nombreDep} onDiscrepancias={setPendDisc} />}
            {tab === 'sector' && <TabMiSector depositos={depositos} />}
            {tab === 'compras' && <TabCompras depositos={depositos} depDefault={dep} />}
            {tab === 'gestion' && <TabGestion depositos={depositos} />}
        </div>
    );
};

// Etiquetas PRE-IMPRESAS de una compra: se imprimen ANTES de que llegue la mercadería,
// para pegar en los bultos al bajarlos. El QR codifica COMPRA:<id>:LINEA:<id> (todavía no
// existe la etiqueta de stock: esa nace al recibir, con su EtiId y su cantidad real).
async function imprimirEtiquetasCompra(compra, lineas, simboloMoneda) {
    const items = (lineas || []).filter(l => Number(l.Cantidad) > 0);
    if (!items.length) { toast.error('La compra no tiene artículos'); return; }
    const qrs = await Promise.all(items.map(l =>
        QRCode.toDataURL(`COMPRA:${compra.CompId}:LINEA:${l.CDetId}`, { margin: 1, width: 190 }).catch(() => '')
    ));
    const w = window.open('', '_blank', 'width=760,height=800');
    if (!w) { toast.error('El navegador bloqueó la ventana de impresión'); return; }
    const celdas = items.map((l, i) => `
        <div class="eti">
            ${qrs[i] ? `<img src="${qrs[i]}">` : ''}
            <div class="txt">
                <p class="prod">${(l.Producto || '').substring(0, 34)}</p>
                <p class="var">${(l.NombreVariante || '').substring(0, 34)}</p>
                <p class="cant">${Number(l.Cantidad).toLocaleString('es-UY')} <span>${l.UnidadBase || ''}</span></p>
                <p class="ref">Compra #${compra.CompId} · ${compra.Proveedor || ''}</p>
                <p class="ref">${compra.ReferenciaFactura ? 'Ref: ' + compra.ReferenciaFactura : ''}</p>
            </div>
        </div>`).join('');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas compra ${compra.CompId}</title><style>
        @page { size: A4; margin: 8mm; }
        body { font-family: Arial, sans-serif; margin: 0; display: flex; flex-wrap: wrap; gap: 4mm; }
        .eti { width: 92mm; height: 42mm; border: 1px dashed #cbd5e1; border-radius: 3mm; padding: 3mm;
               display: flex; gap: 3mm; align-items: center; box-sizing: border-box; page-break-inside: avoid; }
        .eti img { width: 32mm; height: 32mm; }
        .txt { min-width: 0; }
        .prod { font-size: 11pt; font-weight: bold; margin: 0 0 1mm; }
        .var  { font-size: 9pt; margin: 0 0 1mm; color: #334155; }
        .cant { font-size: 15pt; font-weight: 900; margin: 0 0 1mm; }
        .cant span { font-size: 8pt; font-weight: normal; color: #64748b; }
        .ref  { font-size: 7pt; color: #64748b; margin: 0; }
    </style></head><body>${celdas}
        <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`);
    w.document.close();
}

// Reporte gerencial del panel: ventana propia + print (mismo patrón que las etiquetas).
function imprimirReporteGerencial(d) {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { toast.error('El navegador bloqueó la ventana de impresión'); return; }
    const fecha = new Date().toLocaleString('es-UY');
    const num = (v, dec = 0) => Number(v || 0).toLocaleString('es-UY', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const val = (mon) => Number(d.valorizacion.find(v => (v.Moneda || 'UYU').toUpperCase().includes(mon))?.Total || 0);

    const filas = (arr, fn) => arr.map(fn).join('');
    const tabla = (titulo, cabeceras, cuerpo) => `
        <h2>${titulo}</h2>
        <table><thead><tr>${cabeceras.map(c => `<th${c.r ? ' class="r"' : ''}>${c.t ?? c}</th>`).join('')}</tr></thead>
        <tbody>${cuerpo || '<tr><td colspan="9" class="vacio">Sin datos</td></tr>'}</tbody></table>`;

    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte de stock</title><style>
        @page { size: A4; margin: 14mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 9pt; margin: 0; }
        h1 { font-size: 17pt; margin: 0 0 2px; }
        .sub { color: #64748b; font-size: 8pt; margin-bottom: 14px; }
        h2 { font-size: 10pt; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #0f172a; text-transform: uppercase; letter-spacing: .04em; }
        .kpis { display: flex; gap: 8px; flex-wrap: wrap; }
        .kpi { flex: 1 1 130px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; }
        .kpi .t { font-size: 7pt; text-transform: uppercase; letter-spacing: .08em; color: #64748b; }
        .kpi .v { font-size: 14pt; font-weight: 900; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 4px 6px; }
        td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
        th.r, td.r { text-align: right; }
        .vacio { color: #94a3b8; text-align: center; padding: 10px; }
        .crit { color: #b91c1c; font-weight: 900; }
        .aler { color: #b45309; font-weight: 900; }
        .pie { margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 7.5pt; color: #94a3b8; }
    </style></head><body>
        <h1>Reporte de stock</h1>
        <div class="sub">Generado el ${fecha}</div>

        <div class="kpis">
            <div class="kpi"><div class="t">Activos (USD)</div><div class="v">US$ ${num(val('USD'))}</div></div>
            <div class="kpi"><div class="t">Activos (UYU)</div><div class="v">$ ${num(val('UYU'))}</div></div>
            <div class="kpi"><div class="t">Volumen físico</div><div class="v">${num(d.volumen.Unidades)}</div></div>
            <div class="kpi"><div class="t">Variantes con stock</div><div class="v">${num(d.volumen.Variantes)}</div></div>
        </div>

        ${tabla('Distribución por depósito',
            ['Depósito', { t: 'Unidades', r: 1 }, { t: 'Capital USD', r: 1 }, { t: 'Capital UYU', r: 1 }],
            filas(d.porDeposito || [], r => `<tr><td>${r.Deposito || '—'}</td><td class="r">${num(r.Unidades)}</td><td class="r">US$ ${num(r.CapitalUSD)}</td><td class="r">$ ${num(r.CapitalUYU)}</td></tr>`))}

        ${tabla('Distribución por familia',
            ['Familia', { t: 'Unidades', r: 1 }, { t: 'Variantes', r: 1 }],
            filas(d.porCategoria || [], r => `<tr><td>${r.Familia}</td><td class="r">${num(r.Unidades)}</td><td class="r">${num(r.Variantes)}</td></tr>`))}

        ${tabla('Más consumidos este mes',
            ['#', 'Artículo', { t: 'Unidades', r: 1 }],
            filas(d.topConsumo || [], (r, i) => `<tr><td>${i + 1}</td><td>${r.Producto} — ${r.NombreVariante}</td><td class="r">${num(r.Unidades)}</td></tr>`))}

        ${tabla('Stock crítico',
            ['Estado', 'Familia', 'Artículo', { t: 'Stock', r: 1 }, { t: 'Límites', r: 1 }],
            filas(d.criticos || [], r => `<tr>
                <td class="${r.Estado === 'CRITICO' ? 'crit' : 'aler'}">${r.Estado === 'CRITICO' ? 'CRÍTICO' : 'ALERTA'}</td>
                <td>${r.Familia || '—'}</td><td>${r.Producto} — ${r.NombreVariante}</td>
                <td class="r ${r.Estado === 'CRITICO' ? 'crit' : 'aler'}">${num(r.StockGlobal)}</td>
                <td class="r">C: ${r.CantidadCritica} / A: ${r.CantidadAlerta}</td></tr>`))}

        ${(d.anomalias || []).length ? tabla('Anomalías de consumo (hoy)',
            ['Artículo', { t: 'Salidas hoy', r: 1 }, { t: 'Promedio/día', r: 1 }],
            filas(d.anomalias, r => `<tr><td>${r.Producto} — ${r.NombreVariante}</td><td class="r">${r.Hoy}</td><td class="r">${r.PromedioDia}</td></tr>`)) : ''}

        <div class="pie">Sistema de Gestión de Producción · Stock</div>
        <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`);
    w.document.close();
}

/* Barra de anomalías del panel: solo existe si hay algo detectado (si no, no ocupa lugar).
   Con más de una, van rotando — misma idea que el panel del sistema anterior. */
function BarraAnomalias({ anomalias = [] }) {
    const [i, setI] = useState(0);
    const n = anomalias.length;
    useEffect(() => {
        if (n < 2) return;
        const t = setInterval(() => setI(x => (x + 1) % n), 4500);
        return () => clearInterval(t);
    }, [n]);
    if (!n) return null;
    const a = anomalias[i] || anomalias[0];
    return (
        <div className="flex items-center gap-3 bg-amber-500 text-white rounded-2xl px-4 py-2.5">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-widest shrink-0 hidden sm:inline">Anomalías detectadas</span>
            <span className="text-sm font-bold truncate flex-1">
                {a.Producto} — {a.NombreVariante}
                <span className="ml-2 font-black">({a.Hoy} {a.Hoy === 1 ? 'salida' : 'salidas'} hoy)</span>
                <span className="ml-2 text-white/70 font-semibold">promedio {Number(a.PromedioDia) < 0.1 ? '<0,1' : a.PromedioDia}/día</span>
            </span>
            {n > 1 && (
                <span className="flex items-center gap-1 shrink-0">
                    {anomalias.map((_, k) => (
                        <span key={k} className={`w-1.5 h-1.5 rounded-full ${k === i ? 'bg-white' : 'bg-white/40'}`} />
                    ))}
                </span>
            )}
        </div>
    );
}

/* ── PANEL (F4 — gerencial) ─────────────────────────────────────────────── */
// Paleta de los gráficos (misma familia de colores que el panel del sistema anterior)
const COLORES = ['#3b82f6', '#8b5cf6', '#ef4444', '#ec4899', '#f59e0b', '#14b8a6', '#22c55e', '#64748b'];

const tooltipStyle = {
    contentStyle: { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, fontWeight: 700, boxShadow: '0 4px 14px rgba(15,23,42,.08)' },
    labelStyle: { fontWeight: 900, color: '#0f172a' },
};

function TabPanel() {
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);

    useEffect(() => {
        api.get('/wms-interno/panel')
            .then(r => setDatos(r.data?.data || null))
            .catch(() => toast.error('No se pudo cargar el panel'))
            .finally(() => setCargando(false));
    }, []);

    if (cargando) return <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando panel...</div>;
    if (!datos) return <div className="text-center py-16 text-slate-400 text-sm">Sin datos.</div>;

    const val = (mon) => Number(datos.valorizacion.find(v => (v.Moneda || 'UYU').toUpperCase().includes(mon))?.Total || 0);
    const fmtPlata = (n) => n.toLocaleString('es-UY', { maximumFractionDigits: 0 });
    const top = datos.topConsumo[0];
    const enRiesgo = Number(datos.salud?.EnRiesgo || 0);
    const conLimite = Number(datos.salud?.ConLimite || 0);

    const Card = ({ icono: Icono, titulo, valor, sub, acento = 'text-slate-800', tag = null, tono = 'sky' }) => (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 relative">
            {tag && <span className="absolute top-4 right-4 text-[9px] font-black uppercase tracking-widest bg-rose-100 text-rose-600 rounded-full px-2.5 py-1">{tag}</span>}
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center mb-4 ${tono === 'emerald' ? 'bg-emerald-50' : tono === 'rose' ? 'bg-rose-50' : 'bg-sky-50'}`}>
                <Icono size={20} className={tono === 'emerald' ? 'text-emerald-600' : tono === 'rose' ? 'text-rose-500' : 'text-sky-600'} />
            </div>
            <p className={`text-3xl xl:text-4xl font-black tabular-nums font-gsanscode leading-none tracking-tight ${acento}`}>{valor}</p>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mt-2">{titulo}</p>
            {sub && <p className="text-[11px] text-slate-400 font-semibold mt-1 leading-tight">{sub}</p>}
        </div>
    );

    const Panel = ({ icono: Icono, titulo, extra = null, children, className = '' }) => (
        <div className={`bg-white rounded-2xl border border-slate-200 p-4 ${className}`}>
            <div className="flex items-center gap-2 mb-3">
                {Icono && <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center"><Icono size={14} className="text-slate-500" /></div>}
                <h3 className="text-sm font-black text-slate-700 flex-1">{titulo}</h3>
                {extra}
            </div>
            {children}
        </div>
    );

    return (
        <div className="space-y-4">
            <BarraAnomalias anomalias={datos.anomalias} />

            {/* Encabezado del panel */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-3xl xl:text-4xl font-black text-slate-800 flex items-center gap-2.5 tracking-tight">
                        <TrendingUp size={30} className="text-indigo-500" /> Centro de control
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">Inventario en tiempo real, anomalías y valoración de activos.</p>
                </div>
                <button onClick={() => imprimirReporteGerencial(datos)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-black text-slate-600 hover:bg-slate-50">
                    <Printer size={15} /> Generar reporte gerencial
                </button>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Card icono={DollarSign} titulo="Activos valorizados (USD)" valor={`US$ ${fmtPlata(val('USD'))}`} tono="emerald" />
                <Card icono={DollarSign} titulo="Activos valorizados (UYU)" valor={`$ ${fmtPlata(val('UYU'))}`} tono="emerald" />
                <Card icono={Boxes} titulo="Volumen físico (unidades)" valor={fmtCant(datos.volumen.Unidades)} />
                <Card icono={Layers} titulo="Diversidad de catálogo" valor={fmtCant(datos.volumen.Variantes)} sub="variantes con stock" />
                <Card icono={TrendingUp} titulo="Más consumido este mes" tag="Top consumo" tono="rose"
                    valor={top ? fmtCant(top.Unidades) : '—'}
                    sub={top ? `${top.Producto} — ${top.NombreVariante}` : 'sin consumo este mes'}
                    acento="text-rose-600" />
            </div>

            {/* Anomalías + ordenador de compras */}
            <div className="grid lg:grid-cols-[1fr_1.6fr] gap-4 items-start">
                <div className="space-y-4">
                    <Panel icono={TrendingUp} titulo="Anomalías en consumo (hoy)">
                        {datos.anomalias.length === 0 ? (
                            <p className="text-sm text-emerald-600 font-bold py-6 text-center">✓ Consumo dentro de lo normal</p>
                        ) : (
                            <div className="space-y-2">
                                {datos.anomalias.map((a, i) => (
                                    <div key={i} className="border-l-4 border-amber-400 bg-amber-50/50 rounded-r-xl px-3 py-2.5">
                                        <p className="text-sm font-bold text-slate-700">{a.Producto} — {a.NombreVariante}</p>
                                        <p className="text-[11px] text-slate-500 font-semibold flex justify-between mt-0.5">
                                            <span className="text-amber-700 font-black">↗ {a.Hoy} salidas hoy</span>
                                            <span>Promedio normal: {Number(a.PromedioDia) < 0.1 ? '<0,1' : a.PromedioDia}/día</span>
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>

                    <Panel icono={AlertTriangle} titulo="Quiebres críticos por almacén">
                        {(datos.quiebres || []).length === 0 ? (
                            <p className="text-sm text-slate-400 font-bold py-6 text-center">Distribución local sana</p>
                        ) : (
                            <div className="divide-y divide-slate-50">
                                {datos.quiebres.map((q, i) => (
                                    <div key={i} className="flex items-center gap-3 py-2">
                                        <span className="text-sm font-bold text-slate-600 flex-1 truncate">{q.Deposito}</span>
                                        <span className="text-xs font-black text-rose-600 bg-rose-50 rounded-full px-2.5 py-0.5">{q.Quiebres}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>
                </div>

                <Panel icono={ShoppingCart} titulo="Ordenador lógico de compras (stock global)"
                    extra={datos.criticos.length > 0 && (
                        <span className="text-[10px] font-black bg-sky-50 text-sky-700 rounded-full px-2.5 py-1">
                            {datos.criticos.length} ítem{datos.criticos.length !== 1 ? 's' : ''} requiere{datos.criticos.length !== 1 ? 'n' : ''} acción
                        </span>
                    )}>
                    {datos.criticos.length === 0 ? (
                        <p className="text-sm text-emerald-600 font-bold py-8 text-center">✓ Nada por debajo de sus límites</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <div className="grid grid-cols-[76px_100px_1fr_80px_100px] gap-2 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                                <span>Estado</span><span>Familia</span><span>Artículo físico</span><span className="text-right">Stock</span><span className="text-right">Límite</span>
                            </div>
                            <div className="divide-y divide-slate-50">
                                {datos.criticos.map((c, i) => (
                                    <div key={i} className="grid grid-cols-[76px_100px_1fr_80px_100px] gap-2 px-2 py-2.5 items-center">
                                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full text-center ${c.Estado === 'CRITICO' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                            ● {c.Estado === 'CRITICO' ? 'CRÍTICO' : 'ALERTA'}
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase truncate">{c.Familia || '—'}</span>
                                        <span className="text-xs font-bold text-slate-700 truncate">{c.Producto} — {c.NombreVariante}</span>
                                        <span className={`text-base text-right font-black tabular-nums font-gsanscode ${c.Estado === 'CRITICO' ? 'text-rose-600' : 'text-amber-600'}`}>{fmtCant(c.StockGlobal)}</span>
                                        <span className="text-[10px] text-right text-slate-400 font-bold">C: {c.CantidadCritica} / A: {c.CantidadAlerta}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </Panel>
            </div>

            {/* Gráficos */}
            <div className="grid lg:grid-cols-3 gap-4 items-start">
                <Panel icono={MapPin} titulo="Valor concentrado por almacén">
                    {/* CapitalTotalUSD ya viene convertido con la cotización del sistema */}
                    <ResponsiveContainer width="100%" height={240}>
                        <PieChart>
                            <Pie dataKey="valor" nameKey="label" innerRadius={52} outerRadius={82} paddingAngle={1}
                                data={(datos.porDeposito || []).map(d => ({ label: d.Deposito, valor: Math.round(Number(d.CapitalTotalUSD || 0)) }))}>
                                {(datos.porDeposito || []).map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                            </Pie>
                            <Tooltip {...tooltipStyle} formatter={(val) => ['US$ ' + Number(val).toLocaleString('es-UY'), 'Capital']} />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3">
                        {(datos.porDeposito || []).map((d, i) => (
                            <span key={i} className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                                <span className="w-2 h-2 rounded-sm" style={{ background: COLORES[i % COLORES.length] }} />
                                {d.Deposito}
                            </span>
                        ))}
                    </div>
                </Panel>

                <Panel icono={Layers} titulo="Volumen físico por familia (top 8)">
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart layout="vertical" data={(datos.porCategoria || []).map(c => ({ label: c.Familia, valor: Number(c.Unidades) }))}
                            margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
                            <XAxis type="number" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                            <YAxis type="category" dataKey="label" width={88} tick={{ fontSize: 8, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                            <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }} formatter={(val) => [Number(val).toLocaleString('es-UY'), 'Unidades']} />
                            <Bar dataKey="valor" radius={[0, 4, 4, 0]} barSize={13}>
                                {(datos.porCategoria || []).map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </Panel>

                <Panel icono={TrendingUp} titulo="Proporción de salud (global)">
                    <div className="relative">
                        <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                                <Pie dataKey="valor" nameKey="label" innerRadius={58} outerRadius={84} paddingAngle={1} startAngle={90} endAngle={-270}
                                    data={[{ label: 'Sanas', valor: Math.max(0, conLimite - enRiesgo) }, { label: 'En riesgo', valor: enRiesgo }]}>
                                    <Cell fill="#22c55e" /><Cell fill="#ef4444" />
                                </Pie>
                                <Tooltip {...tooltipStyle} formatter={(val, nom) => [val + (val === 1 ? ' variante' : ' variantes'), nom]} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-3xl font-black text-slate-800 leading-none">{enRiesgo}</span>
                            <span className="text-[9px] font-black tracking-widest text-slate-400 mt-1">EN RIESGO</span>
                        </div>
                    </div>
                    <p className="text-center text-[11px] text-slate-400 font-semibold mt-2">
                        {enRiesgo} de {conLimite} variantes con límite configurado
                    </p>
                </Panel>
            </div>

            {/* Top rotación */}
            <Panel icono={TrendingUp} titulo="Top 10 rotación (consumo del mes)">
                <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={(datos.topConsumo || []).map(t => ({ label: `${t.Producto} — ${t.NombreVariante}`, corto: t.NombreVariante, valor: Number(t.Unidades) }))}
                        margin={{ top: 18, right: 8, left: 0, bottom: 46 }}>
                        <XAxis dataKey="corto" tick={{ fontSize: 8, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false}
                            interval={0} angle={-28} textAnchor="end" height={54} />
                        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                        <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }}
                            formatter={(val) => [Number(val).toLocaleString('es-UY'), 'Unidades']}
                            labelFormatter={(_, p) => (p && p[0] && p[0].payload.label) || ''} />
                        <Bar dataKey="valor" fill="#6366f1" radius={[5, 5, 0, 0]} maxBarSize={54}>
                            <LabelList dataKey="valor" position="top" style={{ fontSize: 9, fontWeight: 900, fill: '#64748b' }}
                                formatter={(val) => Number(val).toLocaleString('es-UY')} />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </Panel>
        </div>
    );
}

/* ── ÓRDENES SOLICITADAS (Logística atiende los pedidos de los sectores) ─── */
function TabSolicitudes({ depositos }) {
    const [estado, setEstado] = useState('PENDIENTE');
    const [lista, setLista] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [abierta, setAbierta] = useState(null);
    const [det, setDet] = useState({});

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const r = await api.get(`/wms-interno/solicitudes${estado ? `?estado=${estado}` : ''}`);
            setLista(r.data?.data || []);
        } catch (e) { toast.error('No se pudieron cargar los pedidos'); }
        finally { setCargando(false); }
    }, [estado]);
    useEffect(() => { cargar(); }, [cargar]);

    const verDetalle = async (id) => {
        if (abierta === id) { setAbierta(null); return; }
        setAbierta(id);
        try {
            const r = await api.get(`/wms-interno/solicitudes/${id}`);
            setDet(prev => ({ ...prev, [id]: r.data?.data || [] }));
        } catch (e) { toast.error('No se pudo cargar el pedido'); }
    };
    const marcar = async (sol, nuevoEstado) => {
        try {
            await api.post(`/wms-interno/solicitudes/${sol.SolId}/estado`, { estado: nuevoEstado });
            toast.success(nuevoEstado === 'ATENDIDA' ? 'Pedido marcado como atendido' : 'Pedido cancelado');
            cargar();
        } catch (e) { toast.error('No se pudo actualizar'); }
    };

    return (
        <div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <div className="flex-1 min-w-[200px]">
                    <h3 className="text-lg font-black text-slate-800">Órdenes solicitadas</h3>
                    <p className="text-xs text-slate-500">Pedidos de insumos que hacen los sectores desde “Mi Sector”.</p>
                </div>
                {[['PENDIENTE', 'Pendientes'], ['ATENDIDA', 'Atendidas'], ['', 'Todas']].map(([v, l]) => (
                    <button key={v} onClick={() => setEstado(v)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-black ${estado === v ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
                ))}
            </div>

            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : lista.length === 0 ? (
                <div className="text-center py-16 text-emerald-600 text-sm font-bold">✓ No hay pedidos {estado === 'PENDIENTE' ? 'pendientes' : ''}</div>
            ) : (
                <div className="space-y-2">
                    {lista.map(sol => (
                        <div key={sol.SolId} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                            <button onClick={() => verDetalle(sol.SolId)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left">
                                {abierta === sol.SolId ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                                <span className="text-sm font-black text-slate-700 w-28 font-gsanscode">{sol.Numeracion}</span>
                                <span className="text-sm font-bold text-slate-600 flex-1 truncate">{sol.Deposito || `Depósito ${sol.DepSolicitanteId}`}</span>
                                <span className="text-[11px] text-slate-400 font-gsanscode">{fmtFecha(sol.FechaCreacion)}</span>
                                <span className="text-[11px] font-bold text-slate-500">{sol.Items} ítem{sol.Items !== 1 ? 's' : ''}</span>
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${sol.Estado === 'PENDIENTE' ? 'bg-amber-100 text-amber-700' : ['ATENDIDA', 'APROBADA', 'ENTREGADA'].includes(sol.Estado) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{sol.Estado}</span>
                            </button>
                            {abierta === sol.SolId && (
                                <div className="border-t border-slate-100">
                                    <div className="divide-y divide-slate-50">
                                        {(det[sol.SolId] || []).map(it => (
                                            <div key={it.SolItId} className="flex items-center gap-3 pl-11 pr-4 py-2.5">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-bold text-slate-700 truncate">{it.Producto} — {it.NombreVariante}</p>
                                                    <p className="text-[11px] text-slate-400">{[it.Talle, it.Color].filter(Boolean).join(' · ')}</p>
                                                </div>
                                                <span className="text-sm font-black text-slate-800 tabular-nums font-gsanscode">
                                                    {fmtCant(it.CantidadSolicitada)} <span className="text-[10px] text-slate-400 font-bold">{it.UnidadBase}</span>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    {sol.Estado === 'PENDIENTE' && (
                                        <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-slate-50 border-t border-slate-100">
                                            <p className="text-[11px] text-slate-500 font-semibold flex-1">
                                                Para despacharlo, armá un remito desde <b>Trasladar</b> hacia {sol.Deposito}; después marcalo atendido.
                                            </p>
                                            <button onClick={() => marcar(sol, 'ATENDIDA')}
                                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black">Marcar atendido</button>
                                            <button onClick={() => marcar(sol, 'CANCELADA')}
                                                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-500 hover:bg-white">Cancelar</button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── RETIRAR STOCK (consumo, merma, salida) ──────────────────────────────── */
function TabRetirar({ dep, nombreDep }) {
    const [variante, setVariante] = useState(null);
    const [etiquetas, setEtiquetas] = useState([]);
    const [sel, setSel] = useState(null);
    const [cantidad, setCantidad] = useState('');
    const [motivo, setMotivo] = useState('baja_consumo');
    const [saliendo, setSaliendo] = useState(false);

    const cargarEtiquetas = async (v) => {
        setVariante(v); setSel(null); setCantidad('');
        try {
            const r = await api.get(`/wms-interno/variantes/${v.VarId}/etiquetas?dep=${dep}`);
            setEtiquetas(r.data?.data || []);
        } catch (e) { toast.error('No se pudieron cargar los lotes'); }
    };
    const retirar = async () => {
        const n = parseFloat(String(cantidad).replace(',', '.'));
        if (!sel) return toast.error('Elegí de qué lote sale');
        if (!(n > 0)) return toast.error('Escribí la cantidad');
        setSaliendo(true);
        try {
            const r = await api.post(`/wms-interno/etiquetas/${sel.EtiId}/baja`, { cantidad: n, motivo });
            toast.success(`Retirado ${fmtCant(r.data.salio)} del lote #${sel.EtiId}`);
            cargarEtiquetas(variante);
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo retirar'); }
        finally { setSaliendo(false); }
    };

    return (
        <div className="max-w-3xl space-y-4">
            <div>
                <h3 className="text-lg font-black text-slate-800">Retirar stock</h3>
                <p className="text-xs text-slate-500">Consumos internos, mermas o salidas definitivas en <b>{nombreDep(dep)}</b>.</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                {variante ? (
                    <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                        <div className="min-w-0">
                            <p className="text-sm font-black text-slate-700 truncate">{variante.Producto}</p>
                            <p className="text-xs text-slate-500 truncate">{variante.NombreVariante}</p>
                        </div>
                        <button onClick={() => { setVariante(null); setEtiquetas([]); }}
                            className="w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-400 flex items-center justify-center shrink-0"><X size={13} /></button>
                    </div>
                ) : <BuscadorVariante placeholder="¿Qué artículo sale?" onElegir={cargarEtiquetas} />}

                {variante && (
                    etiquetas.length === 0 ? (
                        <p className="text-sm text-slate-400 py-6 text-center">No hay lotes con stock de este artículo en {nombreDep(dep)}.</p>
                    ) : (
                        <>
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Elegí el lote</p>
                            <div className="rounded-xl border border-slate-200 divide-y divide-slate-50 max-h-56 overflow-y-auto">
                                {etiquetas.map(e => (
                                    <button key={e.EtiId} onClick={() => { setSel(e); setCantidad(String(e.CantidadActual)); }}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${sel?.EtiId === e.EtiId ? 'bg-sky-50' : 'hover:bg-slate-50'}`}>
                                        <span className="text-xs font-black text-slate-700 w-20 font-gsanscode">#{e.EtiId}</span>
                                        <span className="text-[11px] font-mono text-slate-400 flex-1 truncate">{e.CodigoBarras || ''}</span>
                                        <span className="text-sm font-black text-slate-800 tabular-nums font-gsanscode">{fmtCant(e.CantidadActual)}</span>
                                        {sel?.EtiId === e.EtiId && <Check size={14} className="text-sky-600" />}
                                    </button>
                                ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <input type="number" min="0" step="1" value={cantidad} onChange={e => setCantidad(e.target.value)}
                                    placeholder="Cantidad" className="w-32 px-3 py-2 rounded-xl border border-slate-200 text-sm text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                <Selector value={motivo} onChange={setMotivo}
                                    opciones={[
                                        { value: 'baja_consumo', label: 'Consumo interno' },
                                        { value: 'baja_merma', label: 'Merma / rotura' },
                                        { value: 'egreso_final', label: 'Venta libre / salida' },
                                    ]} />
                                <button onClick={retirar} disabled={saliendo || !sel}
                                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-black disabled:opacity-40">
                                    {saliendo ? <Loader2 size={15} className="animate-spin" /> : <Scale size={15} />} Retirar
                                </button>
                            </div>
                        </>
                    )
                )}
            </div>
        </div>
    );
}

/* ── REGISTRO DE PESO ────────────────────────────────────────────────────── */
function TabPeso({ dep }) {
    const [codigo, setCodigo] = useState('');
    const [eti, setEti] = useState(null);
    const [peso, setPeso] = useState('');
    const [medida, setMedida] = useState('');
    const [buscando, setBuscando] = useState(false);

    const buscar = async () => {
        if (!codigo.trim()) return;
        setBuscando(true);
        try {
            const r = await api.get(`/wms-interno/etiquetas/buscar?codigo=${encodeURIComponent(codigo.trim())}`);
            setEti(r.data?.data);
            setPeso(r.data?.data?.Peso != null ? String(r.data.data.Peso) : '');
            setMedida(r.data?.data?.MedidaSecundaria != null ? String(r.data.data.MedidaSecundaria) : '');
        } catch (e) {
            setEti(null);
            toast.error(e.response?.status === 404 ? 'No se encontró esa etiqueta' : 'Error buscando');
        } finally { setBuscando(false); }
    };
    const guardar = async () => {
        try {
            await api.post(`/wms-interno/etiquetas/${eti.EtiId}/peso`, { peso, medidaSecundaria: medida });
            toast.success(`Peso registrado en el lote #${eti.EtiId}`);
            setCodigo(''); setEti(null); setPeso(''); setMedida('');
        } catch (e) { toast.error('No se pudo guardar'); }
    };

    return (
        <div className="max-w-2xl space-y-4">
            <div>
                <h3 className="text-lg font-black text-slate-800">Registro de peso</h3>
                <p className="text-xs text-slate-500">Escaneá o escribí el número de etiqueta para cargarle el peso real del lote.</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input autoFocus value={codigo} onChange={e => setCodigo(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') buscar(); }}
                            placeholder="Número de etiqueta o código de barras"
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
                    </div>
                    <button onClick={buscar} disabled={buscando}
                        className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black disabled:opacity-50">
                        {buscando ? <Loader2 size={15} className="animate-spin" /> : 'Buscar'}
                    </button>
                </div>

                {eti && (
                    <div className="space-y-3">
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                            <p className="text-sm font-black text-slate-700">{eti.Producto} — {eti.NombreVariante}</p>
                            <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
                                Lote <span className="font-gsanscode">#{eti.EtiId}</span> · {eti.Deposito} ·
                                <span className="font-gsanscode"> {fmtCant(eti.CantidadActual)}</span> {eti.UnidadBase}
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Peso (kg)</label>
                                <input type="number" min="0" step="0.001" value={peso} onChange={e => setPeso(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-black text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" placeholder="0,000" />
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Medida secundaria <span className="normal-case font-semibold">(ej. metros)</span></label>
                                <input type="number" min="0" step="1" value={medida} onChange={e => setMedida(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" placeholder="0,00" />
                            </div>
                        </div>
                        <button onClick={guardar}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-sm">
                            <Scale size={16} /> Guardar peso
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── INVENTARIO GLOBAL: mismas solapas que el sistema anterior ────────────── */
function InventarioGlobal({ dep, depositos, nombreDep, onDiscrepancias }) {
    const [sub, setSub] = useState('acciones');
    const [pend, setPend] = useState(0);

    useEffect(() => {
        api.get('/wms-interno/discrepancias?estado=PENDIENTE')
            .then(r => { const n = (r.data?.data || []).length; setPend(n); onDiscrepancias?.(n); })
            .catch(() => {});
    }, [onDiscrepancias]);

    const solapas = [
        { id: 'acciones', label: 'Panel', icono: LayoutDashboard },
        { id: 'inventario', label: 'Inventario', icono: Boxes },
        { id: 'historial', label: 'Historial', icono: History },
        { id: 'diferencias', label: 'Diferencias', icono: Scale, badge: pend },
    ];

    // Atajos a cada operación, igual que el panel del sistema anterior
    const acciones = [
        { id: 'ingreso', titulo: 'Ingresar Stock', desc: 'Registrar mercadería nueva en el depósito y generar su etiqueta.', icono: PackagePlus, tono: 'sky' },
        { id: 'remitos', titulo: 'Trasladar', desc: 'Mover artículos entre sectores y almacenes físicos.', icono: Truck, tono: 'indigo' },
        { id: 'solicitudes', titulo: 'Órdenes Solicitadas', desc: 'Atender y despachar los pedidos de insumos de los sectores.', icono: Send, tono: 'emerald' },
        { id: 'retirar', titulo: 'Retirar Stock', desc: 'Consumos, mermas o salidas definitivas del patrimonio.', icono: Scale, tono: 'rose' },
        { id: 'etiqueta', titulo: 'Generar Etiqueta', desc: 'Etiquetas con QR para lotes físicos (cajas, bidones, paletas).', icono: ScanLine, tono: 'slate' },
        { id: 'peso', titulo: 'Registro de Peso', desc: 'Cargar el peso real de un lote y vincularlo a su etiqueta.', icono: Scale, tono: 'amber' },
    ];

    const TONOS = {
        sky: 'bg-sky-50 text-sky-600', indigo: 'bg-indigo-50 text-indigo-600',
        emerald: 'bg-emerald-50 text-emerald-600', rose: 'bg-rose-50 text-rose-500',
        slate: 'bg-slate-100 text-slate-500', amber: 'bg-amber-50 text-amber-600',
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
                {solapas.map(x => (
                    <button key={x.id} onClick={() => setSub(x.id)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-black transition-colors ${sub === x.id ? 'bg-white border border-slate-200 text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        <x.icono size={15} /> {x.label}
                        {x.badge > 0 && <span className="text-[10px] bg-amber-400 text-amber-900 rounded-full px-1.5 font-black">{x.badge}</span>}
                    </button>
                ))}
            </div>

            {sub === 'acciones' && (
                <div className="space-y-4">
                    <ControlAlertas />
                    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        {acciones.map(a => (
                            <button key={a.id} onClick={() => setSub(a.id)}
                                className="bg-white rounded-2xl border border-slate-200 hover:border-sky-300 hover:shadow-md transition-all p-5 text-left">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${TONOS[a.tono]}`}>
                                    <a.icono size={22} />
                                </div>
                                <p className="text-lg font-black text-slate-800 leading-tight">{a.titulo}</p>
                                <p className="text-xs text-slate-500 mt-1.5 leading-snug">{a.desc}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {sub !== 'acciones' && sub !== 'inventario' && sub !== 'historial' && sub !== 'diferencias' && (
                <button onClick={() => setSub('acciones')} className="text-xs font-black text-slate-400 hover:text-slate-600">← volver al panel</button>
            )}

            {sub === 'inventario' && <TabInventario dep={dep} depositos={depositos} />}
            {sub === 'historial' && <TabHistorial />}
            {sub === 'diferencias' && <TabDiferencias onCambio={(n) => { setPend(n); onDiscrepancias?.(n); }} />}
            {sub === 'ingreso' && <TabIngreso dep={dep} nombreDep={nombreDep} />}
            {sub === 'etiqueta' && <TabIngreso dep={dep} nombreDep={nombreDep} />}
            {sub === 'remitos' && <TabRemitos depositos={depositos} depDefault={dep} />}
            {sub === 'solicitudes' && <TabSolicitudes depositos={depositos} />}
            {sub === 'retirar' && <TabRetirar dep={dep} nombreDep={nombreDep} />}
            {sub === 'peso' && <TabPeso dep={dep} />}
        </div>
    );
}

// Control de stock y alertas (bloque superior del panel del sistema anterior)
// Ficha de un artículo por debajo de su límite: familia, nombre, mínimo y lo que queda.
function FichaAlerta({ c, critico }) {
    // El "mínimo" que se muestra es el límite que efectivamente cruzó
    const min = critico
        ? (Number(c.CantidadCritica) || Number(c.CantidadAlerta) || 0)
        : (Number(c.CantidadAlerta) || Number(c.CantidadCritica) || 0);
    return (
        <div className={`rounded-xl border px-4 py-3 ${critico ? 'border-rose-200 bg-rose-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
            <div className="flex items-start justify-between gap-3">
                <p className={`text-[9px] font-black uppercase tracking-widest truncate ${critico ? 'text-rose-400' : 'text-amber-500'}`}>
                    {c.Familia || c.Producto}
                </p>
                <p className="text-[10px] font-bold text-slate-400 shrink-0 tabular-nums font-gsanscode">Mín: {fmtCant(min)}</p>
            </div>
            <div className="flex items-end justify-between gap-3 mt-0.5">
                <p className="text-sm font-black text-slate-700 truncate">{c.NombreVariante || c.Producto}</p>
                <p className={`text-lg font-black tabular-nums font-gsanscode leading-none shrink-0 ${critico ? 'text-rose-600' : 'text-amber-600'}`}>
                    {fmtCant(c.StockGlobal)}
                </p>
            </div>
        </div>
    );
}

function ControlAlertas() {
    const [d, setD] = useState(null);
    const [abierto, setAbierto] = useState(false);
    useEffect(() => { api.get('/wms-interno/panel').then(r => setD(r.data?.data || null)).catch(() => {}); }, []);
    const todos = d?.criticos || [];
    const listaCrit = todos.filter(c => c.Estado === 'CRITICO');
    const listaAlerta = todos.filter(c => c.Estado !== 'CRITICO');
    const criticas = listaCrit.length;
    const alertas = listaAlerta.length;
    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                    <AlertTriangle size={16} className="text-rose-500" />
                    <h3 className="text-sm font-black text-slate-700 uppercase tracking-wide flex-1">Control de stock y alertas</h3>
                    <span className="text-[10px] font-black bg-rose-100 text-rose-700 rounded-full px-2.5 py-1">{criticas} críticas</span>
                    <span className="text-[10px] font-black bg-amber-100 text-amber-700 rounded-full px-2.5 py-1">{alertas} bajas</span>
                </div>
                {/* El bloque abre el desglose, igual que el sistema anterior */}
                <button onClick={() => setAbierto(a => !a)} disabled={!todos.length}
                    title={todos.length ? 'Ver el detalle de los artículos' : 'Sin artículos por debajo del límite'}
                    className={`rounded-2xl border p-3 flex gap-3 transition-all ${
                        abierto ? 'border-rose-300 bg-rose-50/40 ring-2 ring-rose-100' : 'border-slate-200 hover:border-rose-200'
                    } ${todos.length ? '' : 'opacity-60 cursor-default'}`}>
                    <div className="flex items-center gap-2 pl-1 pr-2">
                        <Package size={16} className="text-slate-400" />
                        <span className="text-xs font-black text-slate-600">Global</span>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-2 text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">Alertas</p>
                        <p className="text-2xl font-black text-amber-700 tabular-nums font-gsanscode leading-tight">{alertas}</p>
                    </div>
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-6 py-2 text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest text-rose-600">Críticas</p>
                        <p className="text-2xl font-black text-rose-700 tabular-nums font-gsanscode leading-tight">{criticas}</p>
                    </div>
                </button>
            </div>

            {abierto && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-start justify-between gap-3 mb-4">
                        <h3 className="text-lg font-black text-slate-800">Desglose de alertas: stock general</h3>
                        <button onClick={() => setAbierto(false)}
                            className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 flex items-center justify-center shrink-0">
                            <X size={15} />
                        </button>
                    </div>

                    {listaCrit.length > 0 && (
                        <>
                            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-rose-600 mb-2">
                                <AlertTriangle size={12} /> Nivel crítico
                            </p>
                            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
                                {listaCrit.map(c => <FichaAlerta key={`c-${c.Producto}-${c.NombreVariante}`} c={c} critico />)}
                            </div>
                        </>
                    )}

                    {listaAlerta.length > 0 && (
                        <>
                            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2">
                                <AlertTriangle size={12} /> Nivel de alerta
                            </p>
                            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                                {listaAlerta.map(c => <FichaAlerta key={`a-${c.Producto}-${c.NombreVariante}`} c={c} />)}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// Tarjeta de remito en Mi Sector: el envío de un vistazo. La usan los salientes
// (con Cancelar) y el historial de recibidos (solo Ver detalles).
function TarjetaRemitoSector({ r, sentido, onVer, acciones = null }) {
    const entrante = sentido === 'entrada';
    // La tarjeta entera abre la hoja del remito; los botones de acción que van
    // adentro cortan la propagación para no dispararla también.
    return (
        <div role="button" tabIndex={0} title="Ver la hoja del remito"
            onClick={() => onVer(r.RemId)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onVer(r.RemId); } }}
            className="bg-white rounded-2xl border border-slate-200 p-4 cursor-pointer hover:border-sky-300 hover:shadow-md transition-all">
            <div className="flex flex-wrap items-center gap-3">
                <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${entrante ? 'bg-emerald-50' : 'bg-sky-50'}`}>
                    {entrante ? <PackageCheck size={19} className="text-emerald-500" /> : <Truck size={19} className="text-sky-500" />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black tracking-wider text-white bg-slate-800 rounded-lg px-2 py-1 font-gsanscode whitespace-nowrap">
                            {r.Numeracion}
                        </span>
                        <span className="text-[11px] font-bold text-slate-400 tabular-nums font-gsanscode">{fmtFecha(r.FechaCreacion)}</span>
                    </div>
                    <p className="text-base font-black text-slate-800 mt-1 truncate">
                        {entrante ? `Origen: ${r.DepOrigen || r.DepOrigenId}` : `Destino: ${r.DepDestino || r.DepDestinoId}`}
                    </p>
                    <p className="text-[11px] font-bold text-slate-400">
                        Contiene {r.Items} artículo{r.Items !== 1 ? 's' : ''} {entrante ? 'registrado' : 'despachado'}{r.Items !== 1 ? 's' : ''}
                        {r.Unidades > 0 && <span> · {fmtCant(r.Unidades)} unidades</span>}
                    </p>
                </div>
                {acciones && (
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {acciones}
                    </div>
                )}
                <ChevronRight size={18} className="text-slate-300 shrink-0" />
            </div>
        </div>
    );
}

/* ── MI SECTOR (vista del operario sobre SU depósito) ────────────────────── */
function TabMiSector({ depositos }) {
    const [sector, setSector] = useState(undefined);   // undefined = cargando
    const [sub, setSub] = useState('stock');
    const [stock, setStock] = useState([]);
    const [pendientes, setPendientes] = useState([]);
    const [salientes, setSalientes] = useState([]);      // despachados por mi sector, en camino
    const [hojaRemito, setHojaRemito] = useState(null);   // RemId de la hoja abierta
    const [modoPedido, setModoPedido] = useState('nueva'); // nueva | mias
    const [cancelando, setCancelando] = useState(null);  // RemId con la confirmación abierta
    const [motivoCancel, setMotivoCancel] = useState('');
    const [recibidos, setRecibidos] = useState([]);
    const [solicitudes, setSolicitudes] = useState([]);
    const [detRem, setDetRem] = useState({});
    const [abierto, setAbierto] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [q, setQ] = useState('');
    const [pidiendo, setPidiendo] = useState([]);       // items del pedido nuevo
    const [famSel, setFamSel] = useState(null);        // familia abierta en 'Mi stock'

    useEffect(() => {
        api.get('/wms-interno/mi-sector')
            .then(r => setSector(r.data?.data?.WmsDepId ? r.data.data : null))
            .catch(() => setSector(null));
    }, []);

    const dep = sector?.WmsDepId;

    const cargar = useCallback(async () => {
        if (!dep) return;
        setCargando(true);
        try {
            const [s, p, sal, rec, sol] = await Promise.all([
                api.get(`/wms-interno/inventario?dep=${dep}&conStock=1&q=${encodeURIComponent(q.trim())}`),
                api.get(`/wms-interno/remitos?estado=EN_TRANSITO&destino=${dep}`),
                // Lo que ESTE sector despachó y todavía está viajando
                api.get(`/wms-interno/remitos?estado=EN_TRANSITO&origen=${dep}`),
                api.get(`/wms-interno/remitos?estado=RECIBIDO&destino=${dep}`),
                api.get(`/wms-interno/solicitudes?dep=${dep}`),
            ]);
            setStock(s.data?.data || []);
            setPendientes(p.data?.data || []);
            setSalientes(sal.data?.data || []);
            setRecibidos(rec.data?.data || []);
            setSolicitudes(sol.data?.data || []);
        } catch (e) { toast.error('No se pudo cargar el sector'); }
        finally { setCargando(false); }
    }, [dep, q]);
    useEffect(() => { cargar(); }, [cargar]);

    const cancelarRemito = async (rem) => {
        try {
            const r = await api.post(`/wms-interno/remitos/${rem.RemId}/cancelar`, { motivo: motivoCancel.trim() });
            const n = (r.data?.devueltos || []).length;
            toast.success(r.data?.yaCancelado
                ? 'Ese remito ya estaba cancelado'
                : `Remito cancelado — ${n} línea${n !== 1 ? 's' : ''} devuelta${n !== 1 ? 's' : ''} al sector`);
            setCancelando(null); setMotivoCancel('');
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo cancelar el remito'); }
    };

    const elegirSector = async (depId) => {
        try {
            await api.post('/wms-interno/mi-sector', { depId });
            const d = depositos.find(x => x.DepId === depId);
            setSector({ WmsDepId: depId, Deposito: d?.Nombre });
            setFamSel(null); setQ('');
            toast.success(`Sector asignado: ${d?.Nombre || depId}`);
        } catch (e) { toast.error('No se pudo asignar el sector'); }
    };

    const verRemito = async (remId) => {
        if (abierto === remId) { setAbierto(null); return; }
        setAbierto(remId);
        try {
            const r = await api.get(`/wms-interno/remitos/${remId}`);
            setDetRem(prev => ({ ...prev, [remId]: r.data?.data || [] }));
        } catch (e) { toast.error('No se pudo cargar el remito'); }
    };
    const recibirItem = async (it, remId) => {
        try {
            const r = await api.post(`/wms-interno/remitos/items/${it.RemItId}/recibir`, { cantidadRecibida: it.CantidadEnviada });
            if (!r.data.yaRecibido) {
                toast.success(`Recibido — etiqueta #${r.data.etiId ?? '—'}`);
                if (r.data.etiId) imprimirEtiqueta({ etiId: r.data.etiId, producto: it.Producto, variante: it.NombreVariante, talle: it.Talle, color: it.Color, cantidad: it.CantidadEnviada, unidad: it.UnidadBase });
            }
            verRemito(remId); setAbierto(remId);
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo recibir'); }
    };
    const enviarPedido = async () => {
        const items = pidiendo.filter(i => parseFloat(i.cantidad) > 0).map(i => ({ varId: i.VarId, cantidad: parseFloat(i.cantidad) }));
        if (!items.length) return toast.error('Agregá lo que necesitás');
        try {
            const r = await api.post('/wms-interno/solicitudes', { depSolicitanteId: dep, items });
            toast.success(`Pedido ${r.data.numeracion} enviado a Logística`);
            setPidiendo([]);
            cargar();
        } catch (e) { toast.error('No se pudo enviar el pedido'); }
    };

    if (sector === undefined) return <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>;

    if (!sector) return (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-lg">
            <h3 className="text-sm font-black text-slate-700 mb-1">Todavía no tenés un sector asignado</h3>
            <p className="text-sm text-slate-500 mb-4">Elegí el depósito en el que trabajás. Queda guardado en tu usuario.</p>
            <div className="flex flex-wrap gap-2">
                {depositos.map(d => (
                    <button key={d.DepId} onClick={() => elegirSector(d.DepId)}
                        className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-sky-50 hover:border-sky-300">
                        {d.Nombre || `Depósito ${d.DepId}`}
                    </button>
                ))}
            </div>
        </div>
    );

    // Agrupado por familia para las tarjetas + lista filtrada al entrar en una
    const familiasSector = (() => {
        const map = {};
        stock.forEach(v => {
            const f = v.Categoria || 'Sin familia';
            map[f] = map[f] || { nombre: f, etiquetas: 0, variantes: 0 };
            map[f].etiquetas += Number(v.Etiquetas || 0);
            map[f].variantes += 1;
        });
        return Object.values(map).sort((a, b) => b.etiquetas - a.etiquetas);
    })();
    const stockFiltrado = famSel ? stock.filter(v => (v.Categoria || 'Sin familia') === famSel) : stock;

    const subs = [
        // el contador son LOTES FÍSICOS (etiquetas), igual que el panel operativo anterior
        { id: 'stock', label: 'Mi stock físico', n: familiasSector.reduce((s, f) => s + f.etiquetas, 0) },
        { id: 'pendientes', label: 'Remitos pendientes', n: pendientes.length },
        { id: 'pedir', label: 'Pedir insumos', n: solicitudes.filter(s => s.Estado === 'PENDIENTE').length },
        { id: 'recibidos', label: 'Remitos recibidos', n: recibidos.length },
    ];

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-wrap items-center justify-between gap-5">
                <div className="min-w-[280px] flex-1">
                    <h2 className="text-2xl xl:text-3xl font-black text-slate-800 tracking-tight">Mi sector de operaciones</h2>
                    <p className="text-sm text-slate-500 mt-1.5 max-w-xl">
                        El inventario disponible de tu área, los remitos que te transfiere Logística y los pedidos de insumos.
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Sector asignado</p>
                    <Listbox value={dep} onChange={elegirSector}>
                        <div className="relative min-w-[240px]">
                            <Listbox.Button className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-base font-black text-slate-700 outline-none focus:ring-2 focus:ring-sky-200 whitespace-nowrap">
                                <MapPin size={16} className="text-sky-600 shrink-0" />
                                <span className="flex-1 text-left">{sector.Deposito || `Depósito ${dep}`}</span>
                                <ChevronDown size={15} className="text-slate-400 shrink-0" />
                            </Listbox.Button>
                            <Listbox.Options className="absolute right-0 z-40 mt-1 min-w-full w-max bg-white border border-slate-200 rounded-xl shadow-xl overflow-auto max-h-72 outline-none">
                                {depositos.map(d => (
                                    <Listbox.Option key={d.DepId} value={d.DepId}
                                        className={({ active }) => `flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-bold cursor-pointer transition-colors whitespace-nowrap ${active ? 'bg-slate-50 text-slate-900' : 'text-slate-600'}`}>
                                        {({ selected }) => (
                                            <>
                                                <span>{d.Nombre || `Depósito ${d.DepId}`}</span>
                                                {selected && <Check size={14} className="text-sky-600 shrink-0" />}
                                            </>
                                        )}
                                    </Listbox.Option>
                                ))}
                            </Listbox.Options>
                        </div>
                    </Listbox>
                </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {subs.map(s => (
                    <button key={s.id} onClick={() => setSub(s.id)}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black ${sub === s.id ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        {s.label}
                        {s.n > 0 && <span className={`text-[10px] rounded-full px-1.5 ${sub === s.id ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{s.n}</span>}
                    </button>
                ))}
            </div>

            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-12 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : sub === 'stock' ? (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
                        <Boxes size={17} className="text-slate-400" />
                        <h3 className="text-base font-black text-slate-700 flex-1">
                            {famSel ? famSel : 'Listado de material en el área'}
                        </h3>
                        {famSel && (
                            <button onClick={() => setFamSel(null)} className="text-xs font-black text-slate-400 hover:text-slate-600">← todas las familias</button>
                        )}
                        <div className="relative">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por variante o producto..."
                                className="w-64 pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
                        </div>
                    </div>

                    {stock.length === 0 ? (
                        <p className="px-4 py-12 text-center text-sm text-slate-400">Sin material en el sector.</p>
                    ) : (!famSel && !q.trim()) ? (
                        // Vista por familias (como el panel operativo del sistema anterior)
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 p-5">
                            {familiasSector.map(f => (
                                <button key={f.nombre} onClick={() => setFamSel(f.nombre)}
                                    className="bg-white rounded-2xl border border-slate-200 hover:border-sky-300 hover:shadow-sm transition-all p-5 flex flex-col items-center gap-2">
                                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center"><Package size={22} className="text-slate-400" /></div>
                                    <p className="text-sm font-black text-slate-700 uppercase text-center leading-tight">{f.nombre}</p>
                                    <span className="text-[11px] font-bold text-slate-500 bg-slate-100 rounded-full px-3 py-1">
                                        {f.etiquetas} lote{f.etiquetas !== 1 ? 's' : ''} físico{f.etiquetas !== 1 ? 's' : ''}
                                    </span>
                                    <span className="text-[10px] font-bold text-slate-400">{f.variantes} variante{f.variantes !== 1 ? 's' : ''}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {stockFiltrado.length === 0 ? (
                                <p className="px-4 py-12 text-center text-sm text-slate-400">Nada que coincida.</p>
                            ) : stockFiltrado.map(v => (
                                <div key={v.VarId} className="flex items-center gap-3 px-5 py-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-slate-700 truncate">{v.Producto} — {v.NombreVariante}</p>
                                        <p className="text-[11px] text-slate-400">
                                            {[v.Talle, v.Color].filter(Boolean).join(' · ')}{(v.Talle || v.Color) ? ' · ' : ''}{v.Etiquetas} etiq.
                                            {!famSel && v.Categoria && <span className="ml-2 uppercase font-bold text-slate-300">{v.Categoria}</span>}
                                        </p>
                                    </div>
                                    <span className="text-base font-black text-slate-800 tabular-nums font-gsanscode">{fmtCant(v.Stock)} <span className="text-[10px] text-slate-400 font-bold">{v.UnidadBase}</span></span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : sub === 'recibidos' ? (
                <div className="space-y-3">
                    {hojaRemito && <ModalRemito remId={hojaRemito} onCerrar={() => setHojaRemito(null)} />}
                    <p className="flex items-center gap-2 text-sm font-black text-slate-700">
                        <PackageCheck size={16} className="text-emerald-500" /> Historial de recepciones
                    </p>
                    {recibidos.length === 0 ? (
                        <div className="bg-white rounded-2xl border border-slate-200 text-center py-12 text-slate-400 text-sm">
                            Todavía no recibiste ningún remito en este sector.
                        </div>
                    ) : recibidos.map(r => (
                        <TarjetaRemitoSector key={r.RemId} r={r} sentido="entrada" onVer={setHojaRemito} />
                    ))}
                </div>
            ) : sub === 'pendientes' ? (
                <div className="space-y-4">
                    {hojaRemito && <ModalRemito remId={hojaRemito} onCerrar={() => setHojaRemito(null)} />}

                    {sub === 'pendientes' && (
                        <p className="flex items-center gap-2 text-sm font-black text-slate-700">
                            <Truck size={16} className="text-amber-500" />
                            Remitos entrantes (por recibir en {sector?.Deposito || 'tu sector'})
                        </p>
                    )}

                    <div className="space-y-2">
                    {pendientes.length === 0 ? (
                        <div className="bg-white rounded-2xl border border-slate-200 text-center py-12 text-slate-400 text-sm">
                            No hay despachos en tránsito hacia este sector.
                        </div>
                    ) : pendientes.map(r => (
                        <div key={r.RemId} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                            <button onClick={() => verRemito(r.RemId)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left">
                                {abierto === r.RemId ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                                <Inbox size={15} className="text-slate-300" />
                                <span className="text-sm font-black text-slate-700 w-24">{r.Numeracion}</span>
                                <span className="text-xs font-bold text-slate-500 flex-1">desde {r.DepOrigen || r.DepOrigenId}</span>
                                <span className="text-[11px] text-slate-400">{fmtFecha(r.FechaCreacion)}</span>
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${r.Estado === 'RECIBIDO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {r.Pendientes > 0 ? `${r.Items - r.Pendientes}/${r.Items}` : r.Estado}
                                </span>
                            </button>
                            {abierto === r.RemId && (
                                <div className="border-t border-slate-100 divide-y divide-slate-50">
                                    {(detRem[r.RemId] || []).map(it => (
                                        <div key={it.RemItId} className="flex items-center gap-3 pl-11 pr-4 py-2.5">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-700 truncate">{it.Producto} — {it.NombreVariante}</p>
                                                <p className="text-[11px] text-slate-400">{[it.Talle, it.Color].filter(Boolean).join(' · ')}</p>
                                            </div>
                                            <span className="text-xs tabular-nums font-gsanscode text-slate-500">{fmtCant(it.CantidadEnviada)} {it.UnidadBase}</span>
                                            {it.Estado === 'PENDIENTE'
                                                ? <button onClick={() => recibirItem(it, r.RemId)} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black">Recibir</button>
                                                : <span className="text-xs text-emerald-600 font-bold">recibido</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    </div>

                    {/* Lo que este sector despachó y sigue viajando: se puede anular
                        hasta que el destino lo reciba (la mercadería vuelve al sector). */}
                    {sub === 'pendientes' && (
                        <>
                            <p className="flex items-center gap-2 text-sm font-black text-slate-700 pt-2">
                                <Send size={15} className="text-sky-500" />
                                Remitos salientes (enviados por {sector?.Deposito || 'tu sector'}, en tránsito)
                            </p>
                            {salientes.length === 0 ? (
                                <div className="bg-white rounded-2xl border border-slate-200 text-center py-12 text-slate-400 text-sm">
                                    No hay despachos en tránsito desde este sector.
                                </div>
                            ) : salientes.map(r => (
                                <div key={r.RemId} className="space-y-0">
                                    <TarjetaRemitoSector r={r} sentido="salida" onVer={setHojaRemito}
                                        acciones={
                                            <button onClick={() => { setCancelando(cancelando === r.RemId ? null : r.RemId); setMotivoCancel(''); }}
                                                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 text-xs font-black">
                                                <Trash2 size={13} /> Cancelar
                                            </button>
                                        } />
                                    {cancelando === r.RemId && (
                                        <div className="mt-2 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 flex flex-wrap items-center gap-2">
                                            <p className="text-[11px] font-bold text-rose-700 w-full">
                                                Se anula el envío y las {r.Items} línea{r.Items !== 1 ? 's' : ''} vuelven a {sector?.Deposito || 'este sector'}.
                                            </p>
                                            <input autoFocus value={motivoCancel} onChange={e => setMotivoCancel(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') cancelarRemito(r); if (e.key === 'Escape') setCancelando(null); }}
                                                placeholder="Motivo (opcional)"
                                                className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                            <button onClick={() => cancelarRemito(r)}
                                                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black">Confirmar</button>
                                            <button onClick={() => setCancelando(null)}
                                                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-500 text-xs font-black">Volver</button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Dos modos, como el sistema anterior: armar una solicitud o ver las enviadas */}
                    <div className="grid sm:grid-cols-2 gap-4">
                        <button onClick={() => setModoPedido('nueva')}
                            className={`rounded-2xl border p-6 flex flex-col items-center gap-2 transition-all ${
                                modoPedido === 'nueva' ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-slate-200 bg-white hover:border-slate-300 text-slate-500'}`}>
                            <Plus size={22} className={modoPedido === 'nueva' ? 'text-white' : 'text-slate-400'} />
                            <span className="text-sm font-black uppercase tracking-wider">Nueva solicitud</span>
                        </button>
                        <button onClick={() => setModoPedido('mias')}
                            className={`rounded-2xl border p-6 flex flex-col items-center gap-2 transition-all ${
                                modoPedido === 'mias' ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-slate-200 bg-white hover:border-slate-300 text-slate-500'}`}>
                            <Inbox size={22} className={modoPedido === 'mias' ? 'text-white' : 'text-slate-400'} />
                            <span className="text-sm font-black uppercase tracking-wider">Mis solicitudes</span>
                            <span className={`text-[11px] font-black rounded-full px-2.5 py-0.5 ${
                                modoPedido === 'mias' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                {solicitudes.length} enviada{solicitudes.length !== 1 ? 's' : ''}
                            </span>
                        </button>
                    </div>

                    {modoPedido === 'nueva' ? (
                        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center gap-3">
                                <div className="flex-1">
                                    <p className="text-base font-black text-slate-800">Nueva solicitud de insumos</p>
                                    <p className="text-xs text-slate-500 mt-0.5">Elegí los artículos que necesitás y enviá la solicitud a Logística.</p>
                                </div>
                                <div className="w-full md:w-80"><BuscadorVariante placeholder="Agregar artículo..."
                                    onElegir={(v) => setPidiendo(p => p.some(i => i.VarId === v.VarId) ? p : [...p, { ...v, cantidad: '' }])} /></div>
                            </div>

                            {pidiendo.length === 0 ? (
                                <div className="rounded-2xl border-2 border-dashed border-slate-200 py-14 flex flex-col items-center text-center px-6">
                                    <div className="w-12 h-12 rounded-full border-2 border-slate-200 flex items-center justify-center mb-3">
                                        <Plus size={22} className="text-slate-300" />
                                    </div>
                                    <p className="text-sm font-black text-slate-600">El carrito está vacío.</p>
                                    <p className="text-xs text-slate-400 mt-1">Buscá un artículo arriba para pedir insumos del catálogo.</p>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                                    {pidiendo.map((i, idx) => (
                                        <div key={i.VarId} className="flex items-center gap-3 px-3 py-2">
                                            <p className="text-sm font-bold text-slate-700 flex-1 truncate">{i.Producto} — {i.NombreVariante}</p>
                                            <input type="number" min="0" step="1" placeholder="Cant." value={i.cantidad}
                                                onChange={e => setPidiendo(p => p.map((x, xi) => xi === idx ? { ...x, cantidad: e.target.value } : x))}
                                                className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                            <button onClick={() => setPidiendo(p => p.filter((_, xi) => xi !== idx))}
                                                className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 flex items-center justify-center"><Trash2 size={13} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <button onClick={enviarPedido} disabled={!pidiendo.length}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black disabled:opacity-40">
                                <Send size={15} /> Enviar pedido
                            </button>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-50">
                            <p className="px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Mis solicitudes</p>
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
            )}
        </div>
    );
}

/* ── INVENTARIO ─────────────────────────────────────────────────────────── */
function TabInventario({ dep, depositos = [] }) {
    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [q, setQ] = useState('');
    const [soloStock, setSoloStock] = useState(true);
    const [abiertos, setAbiertos] = useState({});
    const [almacen, setAlmacen] = useState(0);            // 0 = uso global (arranca global, como el sistema anterior)
    const [etiquetas, setEtiquetas] = useState({});       // VarId -> filas
    const [varAbierta, setVarAbierta] = useState(null);
    const [ajustando, setAjustando] = useState(null);     // EtiId en edición
    const [cantContada, setCantContada] = useState('');
    const [retirando, setRetirando] = useState(null);    // EtiId del que se saca stock
    const [cantRetiro, setCantRetiro] = useState('');
    const [motivoRetiro, setMotivoRetiro] = useState('baja_consumo');
    const timer = useRef(null);

    // Si cambian el depósito en la barra de arriba, el inventario lo sigue;
    // pero al entrar arranca en global, no en el depósito de la barra.
    const montado = useRef(false);
    useEffect(() => {
        if (!montado.current) { montado.current = true; return; }
        setAlmacen(dep);
    }, [dep]);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const r = await api.get(`/wms-interno/inventario?dep=${almacen}&conStock=${soloStock ? 1 : 0}&q=${encodeURIComponent(q.trim())}`);
            setFilas(r.data?.data || []);
        } catch (e) { toast.error('No se pudo cargar el inventario'); }
        finally { setCargando(false); }
    }, [almacen, soloStock, q]);

    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(cargar, q ? 350 : 0);
        return () => clearTimeout(timer.current);
    }, [cargar]);

    const grupos = useMemo(() => {
        const map = {};
        filas.forEach(f => { (map[f.Producto] = map[f.Producto] || []).push(f); });
        return Object.keys(map).sort().map(nombre => ({ nombre, items: map[nombre] }));
    }, [filas]);

    const verEtiquetas = async (varId) => {
        if (varAbierta === varId) { setVarAbierta(null); return; }
        setVarAbierta(varId);
        try {
            const r = await api.get(`/wms-interno/variantes/${varId}/etiquetas?dep=${almacen || dep}`);
            setEtiquetas(prev => ({ ...prev, [varId]: r.data?.data || [] }));
        } catch (e) { toast.error('No se pudieron cargar las etiquetas'); }
    };

    const retirarStock = async (eti, varId) => {
        const n = parseFloat(String(cantRetiro).replace(',', '.'));
        if (!(n > 0)) { toast.error('Escribí cuánto sale'); return; }
        try {
            const r = await api.post(`/wms-interno/etiquetas/${eti.EtiId}/baja`, { cantidad: n, motivo: motivoRetiro });
            toast.success(`Retirado ${fmtCant(r.data.salio)}${r.data.parcial ? ' (era todo lo que quedaba en esa etiqueta)' : ''}`);
            setRetirando(null); setCantRetiro('');
            verEtiquetas(varId); setVarAbierta(varId);
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo retirar'); }
    };

    const guardarAjuste = async (eti, varId, fila) => {
        const n = parseFloat(String(cantContada).replace(',', '.'));
        if (isNaN(n) || n < 0) { toast.error('Escribí la cantidad contada'); return; }
        try {
            const r = await api.post(`/wms-interno/etiquetas/${eti.EtiId}/ajuste`, { cantidadContada: n });
            const dif = Number(r.data?.diferencia || 0);
            toast.success(dif === 0 ? 'Sin diferencia — la etiqueta ya estaba bien' : `Ajustado: ${dif > 0 ? '+' : ''}${fmtCant(dif)}`);
            setAjustando(null); setCantContada('');
            verEtiquetas(varId); setVarAbierta(varId);
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo ajustar'); }
    };

    return (
        <div>
            {/* Filtro por ubicación, igual que el sistema anterior */}
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Filtrar por locación (almacenes)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 mb-4">
                {[{ DepId: 0, Nombre: 'Uso global' }, ...depositos].map(d => (
                    <button key={d.DepId} onClick={() => setAlmacen(d.DepId)}
                        className={`rounded-2xl border p-3 flex flex-col items-center gap-1.5 transition-all ${almacen === d.DepId ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        {d.DepId === 0
                            ? <Layers size={18} className={almacen === 0 ? 'text-sky-600' : 'text-slate-400'} />
                            : <Package size={18} className={almacen === d.DepId ? 'text-sky-600' : 'text-slate-400'} />}
                        <span className={`text-[10px] font-black uppercase text-center leading-tight ${almacen === d.DepId ? 'text-sky-700' : 'text-slate-500'}`}>
                            {d.Nombre}
                        </span>
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="relative flex-1 min-w-[240px] max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto, variante, sku, talle o color..."
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
                </div>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-600 cursor-pointer select-none">
                    <input type="checkbox" checked={soloStock} onChange={e => setSoloStock(e.target.checked)} className="rounded outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                    Solo con stock
                </label>
            </div>

            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : grupos.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">Nada para mostrar en este depósito.</div>
            ) : (
                <div className="space-y-2.5">
                    <div className="grid grid-cols-[24px_1fr_130px_140px_140px] gap-3 px-4 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        <span /><span>Familia / maestro</span>
                        <span className="text-right">Cantidad física</span>
                        <span className="text-center">Gestión lotes</span>
                        <span className="text-right">Patrimonio</span>
                    </div>
                    {grupos.map(g => {
                        const abierto = q ? true : !!abiertos[g.nombre];
                        const total = g.items.reduce((s, i) => s + Number(i.Stock || 0), 0);
                        return (
                            <div key={g.nombre} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                                <button onClick={() => setAbiertos(a => ({ ...a, [g.nombre]: !a[g.nombre] }))}
                                    className="w-full grid grid-cols-[24px_1fr_130px_140px_140px] gap-3 items-center px-4 py-3.5 hover:bg-slate-50 text-left">
                                    {abierto ? <ChevronDown size={17} className="text-slate-400" /> : <ChevronRight size={17} className="text-slate-400" />}
                                    <div className="min-w-0">
                                        <p className="text-sm font-black text-slate-700 truncate">{g.nombre}</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">
                                            {g.items[0]?.Categoria || ''} · {g.items.length} variante{g.items.length !== 1 ? 's' : ''}
                                        </p>
                                    </div>
                                    <span className="text-base font-black text-slate-800 tabular-nums font-gsanscode text-right">
                                        {fmtCant(total)} <span className="text-[10px] text-slate-400 font-bold">{g.items[0]?.UnidadBase || ''}</span>
                                    </span>
                                    <span className="text-center">
                                        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">
                                            {g.items.reduce((a, i) => a + Number(i.Etiquetas || 0), 0)} lotes
                                        </span>
                                    </span>
                                    <span className="text-sm font-black text-slate-600 tabular-nums font-gsanscode text-right">
                                        {simMoneda(g.items[0]?.Moneda)} {g.items.reduce((a, i) => a + Number(i.Patrimonio || 0), 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                    </span>
                                </button>
                                {abierto && (
                                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                                        {g.items.map(v => (
                                            <div key={v.VarId}>
                                                <button onClick={() => verEtiquetas(v.VarId)}
                                                    className="w-full flex items-center gap-3 pl-11 pr-4 py-2.5 hover:bg-slate-50/60 text-left">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-bold text-slate-700 truncate">{v.NombreVariante}</p>
                                                        <p className="text-[11px] text-slate-400 font-semibold">
                                                            {[v.Talle, v.Color].filter(Boolean).join(' · ')}
                                                            {v.CodigoVariante && <span className="ml-2 font-mono">{v.CodigoVariante}</span>}
                                                        </p>
                                                    </div>
                                                    <span className="text-sm font-black text-slate-800 tabular-nums font-gsanscode">{fmtCant(v.Stock)} <span className="text-[10px] text-slate-400 font-bold">{v.UnidadBase}</span></span>
                                                    <span className="text-[10px] text-slate-400 font-bold w-20 text-right">{v.Etiquetas} etiq.</span>
                                                </button>
                                                {varAbierta === v.VarId && (
                                                    <div className="pl-11 pr-4 pb-3">
                                                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                                                            <div className="grid grid-cols-[70px_1fr_90px_90px_110px] gap-2 px-3 py-1.5 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                                <span>#</span><span>Código</span><span className="text-right">Inicial</span><span className="text-right">Actual</span><span></span>
                                                            </div>
                                                            {(etiquetas[v.VarId] || []).map(e => (
                                                                <div key={e.EtiId} className="grid grid-cols-[70px_1fr_90px_90px_110px] gap-2 px-3 py-2 border-t border-slate-100 items-center">
                                                                    <span className="text-xs font-black text-slate-700">#{e.EtiId}</span>
                                                                    <span className="text-[11px] font-mono text-slate-500 truncate">{e.CodigoBarras || '—'}</span>
                                                                    <span className="text-xs text-right tabular-nums font-gsanscode text-slate-500">{fmtCant(e.CantidadInicial)}</span>
                                                                    <span className="text-xs text-right tabular-nums font-gsanscode font-black text-slate-800">{fmtCant(e.CantidadActual)}</span>
                                                                    <div className="flex justify-end gap-1">
                                                                        {ajustando === e.EtiId ? (
                                                                            <>
                                                                                <input autoFocus type="number" inputMode="decimal" min="0" step="1"
                                                                                    value={cantContada} onChange={ev => setCantContada(ev.target.value)}
                                                                                    onKeyDown={ev => { if (ev.key === 'Enter') guardarAjuste(e, v.VarId); if (ev.key === 'Escape') setAjustando(null); }}
                                                                                    className="w-16 px-1.5 py-1 rounded-lg border border-sky-300 text-xs text-right focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                                                                <button onClick={() => guardarAjuste(e, v.VarId)} className="w-6 h-6 rounded-lg bg-emerald-500 text-white flex items-center justify-center"><Check size={12} /></button>
                                                                                <button onClick={() => setAjustando(null)} className="w-6 h-6 rounded-lg border border-slate-200 text-slate-400 flex items-center justify-center"><X size={11} /></button>
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <button title="Ajustar por conteo" onClick={() => { setAjustando(e.EtiId); setRetirando(null); setCantContada(String(e.CantidadActual)); }}
                                                                                    className="px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-black text-slate-500 hover:bg-slate-50">CONTAR</button>
                                                                                <button title="Retirar stock (consumo, merma, venta libre)"
                                                                                    onClick={() => { setRetirando(retirando === e.EtiId ? null : e.EtiId); setAjustando(null); setCantRetiro(''); }}
                                                                                    className="px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-black text-slate-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200">SACAR</button>
                                                                                <button title="Imprimir etiqueta"
                                                                                    onClick={() => imprimirEtiqueta({ etiId: e.EtiId, producto: g.nombre, variante: v.NombreVariante, talle: v.Talle, color: v.Color, cantidad: e.CantidadActual, unidad: v.UnidadBase, codigoBarras: e.CodigoBarras })}
                                                                                    className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-sky-600 flex items-center justify-center"><Printer size={13} /></button>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            {retirando && (etiquetas[v.VarId] || []).some(e => e.EtiId === retirando) && (
                                                                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-t border-slate-100 bg-rose-50/40">
                                                                    <span className="text-[10px] font-black uppercase tracking-wider text-rose-700">
                                                                        Retirar de #{retirando}
                                                                    </span>
                                                                    <input autoFocus type="number" min="0" step="1" value={cantRetiro}
                                                                        onChange={ev => setCantRetiro(ev.target.value)}
                                                                        onKeyDown={ev => { if (ev.key === 'Enter') retirarStock((etiquetas[v.VarId] || []).find(x => x.EtiId === retirando), v.VarId); if (ev.key === 'Escape') setRetirando(null); }}
                                                                        placeholder="Cantidad"
                                                                        className="w-28 px-2.5 py-1.5 rounded-lg border border-rose-200 text-sm text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                                    <Selector size="sm" value={motivoRetiro} onChange={setMotivoRetiro}
                                                                        opciones={[
                                                                            { value: 'baja_consumo', label: 'Consumo interno' },
                                                                            { value: 'baja_merma', label: 'Merma / rotura' },
                                                                            { value: 'egreso_final', label: 'Venta libre / salida' },
                                                                        ]} />
                                                                    <button onClick={() => retirarStock((etiquetas[v.VarId] || []).find(x => x.EtiId === retirando), v.VarId)}
                                                                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-black">Retirar</button>
                                                                    <button onClick={() => setRetirando(null)}
                                                                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-black text-slate-500">Cancelar</button>
                                                                </div>
                                                            )}
                                                            {!(etiquetas[v.VarId] || []).length && (
                                                                <p className="px-3 py-3 text-xs text-slate-400 border-t border-slate-100">Sin etiquetas activas en este depósito.</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ── INGRESO ─────────────────────────────────────────────────────────────── */
function TabIngreso({ dep, nombreDep }) {
    const [variante, setVariante] = useState(null);
    const [cantidad, setCantidad] = useState('');
    const [medida, setMedida] = useState('');
    const [peso, setPeso] = useState('');
    const [costo, setCosto] = useState('');
    const [codigo, setCodigo] = useState('');
    const [guardando, setGuardando] = useState(false);

    const guardar = async () => {
        if (!variante) return toast.error('Elegí la variante');
        const n = parseFloat(String(cantidad).replace(',', '.'));
        if (!(n > 0)) return toast.error('Escribí la cantidad');
        setGuardando(true);
        try {
            const r = await api.post('/wms-interno/ingresos', {
                varId: variante.VarId, depId: dep, cantidad: n,
                medidaSecundaria: medida || null, peso: peso || null,
                costoUnitario: costo || 0, codigoBarras: codigo || null,
            });
            toast.success(`Etiqueta #${r.data.etiId} creada en ${nombreDep(dep)}`);
            imprimirEtiqueta({
                etiId: r.data.etiId, producto: variante.Producto, variante: variante.NombreVariante,
                talle: variante.Talle, color: variante.Color, cantidad: n, unidad: variante.UnidadBase, codigoBarras: codigo || null,
            });
            setCantidad(''); setMedida(''); setPeso(''); setCosto(''); setCodigo('');
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo crear el ingreso'); }
        finally { setGuardando(false); }
    };

    return (
        <div className="max-w-xl">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <p className="text-sm text-slate-500">Alta de una etiqueta física en <b>{nombreDep(dep)}</b>. Al guardar se imprime sola.</p>
                {variante ? (
                    <div className="flex items-center justify-between gap-3 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5">
                        <div className="min-w-0">
                            <p className="text-sm font-black text-slate-700 truncate">{variante.Producto}</p>
                            <p className="text-xs text-slate-500 truncate">{variante.NombreVariante} {[variante.Talle, variante.Color].filter(Boolean).join(' · ')}</p>
                        </div>
                        <button onClick={() => setVariante(null)} className="w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-400 flex items-center justify-center shrink-0"><X size={13} /></button>
                    </div>
                ) : (
                    <BuscadorVariante onElegir={setVariante} />
                )}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Cantidad {variante?.UnidadBase ? `(${variante.UnidadBase})` : ''}</label>
                        <input type="number" inputMode="decimal" min="0" step="1" value={cantidad} onChange={e => setCantidad(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-black focus:outline-none focus:ring-2 focus:ring-sky-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Medida secundaria <span className="normal-case font-semibold">(ej. metros)</span></label>
                        <input type="number" inputMode="decimal" min="0" step="1" value={medida} onChange={e => setMedida(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Peso (kg)</label>
                        <input type="number" inputMode="decimal" min="0" step="0.001" value={peso} onChange={e => setPeso(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Costo unitario</label>
                        <input type="number" inputMode="decimal" min="0" step="1" value={costo} onChange={e => setCosto(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    </div>
                    <div className="col-span-2">
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Código de barras <span className="normal-case font-semibold">(opcional — sin esto se escanea el # de etiqueta)</span></label>
                        <input value={codigo} onChange={e => setCodigo(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-200" />
                    </div>
                </div>
                <button onClick={guardar} disabled={guardando}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-sm disabled:opacity-50">
                    {guardando ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />} Ingresar e imprimir etiqueta
                </button>
            </div>
        </div>
    );
}

/* ── REMITOS ─────────────────────────────────────────────────────────────── */
function TabRemitos({ depositos, depDefault }) {
    const [filtro, setFiltro] = useState('EN_TRANSITO');
    const [remitos, setRemitos] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [abierto, setAbierto] = useState(null);          // RemId expandido
    const [detalle, setDetalle] = useState({});            // RemId -> items
    const [creando, setCreando] = useState(false);
    const [recibiendo, setRecibiendo] = useState({});      // RemItId -> cantidad editada

    // creación
    const [origen, setOrigen] = useState(depDefault);
    const [destino, setDestino] = useState('');
    const [itemsNuevo, setItemsNuevo] = useState([]);
    const [obs, setObs] = useState('');
    const [guardando, setGuardando] = useState(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const r = await api.get(`/wms-interno/remitos${filtro ? `?estado=${filtro}` : ''}`);
            setRemitos(r.data?.data || []);
        } catch (e) { toast.error('No se pudieron cargar los remitos'); }
        finally { setCargando(false); }
    }, [filtro]);
    useEffect(() => { cargar(); }, [cargar]);

    const verDetalle = async (remId) => {
        if (abierto === remId) { setAbierto(null); return; }
        setAbierto(remId);
        try {
            const r = await api.get(`/wms-interno/remitos/${remId}`);
            setDetalle(prev => ({ ...prev, [remId]: r.data?.data || [] }));
        } catch (e) { toast.error('No se pudo cargar el detalle'); }
    };

    const crear = async () => {
        if (!origen || !destino || parseInt(origen, 10) === parseInt(destino, 10)) return toast.error('Elegí origen y destino distintos');
        if (!itemsNuevo.length) return toast.error('Agregá al menos una variante');
        setGuardando(true);
        try {
            const r = await api.post('/wms-interno/remitos', {
                depOrigenId: parseInt(origen, 10), depDestinoId: parseInt(destino, 10),
                items: itemsNuevo.map(i => ({ varId: i.VarId, cantidad: parseFloat(i.cantidad) })),
                obs,
            });
            const cortos = (r.data.items || []).filter(i => i.enviada < i.pedida);
            toast.success(`Remito ${r.data.numeracion} creado — el stock ya salió del origen`);
            if (cortos.length) toast.warning(`${cortos.length} variante(s) viajan con menos de lo pedido (no había stock suficiente)`);
            setCreando(false); setItemsNuevo([]); setObs('');
            setFiltro('EN_TRANSITO');
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo crear el remito'); }
        finally { setGuardando(false); }
    };

    const recibir = async (item, rem) => {
        const val = recibiendo[item.RemItId] ?? item.CantidadEnviada;
        try {
            const r = await api.post(`/wms-interno/remitos/items/${item.RemItId}/recibir`, { cantidadRecibida: val });
            if (r.data.yaRecibido) toast.info('Ese item ya estaba recibido');
            else {
                toast.success(`Recibido — etiqueta #${r.data.etiId ?? '—'} creada en destino${r.data.perdida ? ` (faltaron ${fmtCant(r.data.perdida)}: quedó como diferencia)` : ''}`);
                if (r.data.etiId) imprimirEtiqueta({
                    etiId: r.data.etiId, producto: item.Producto, variante: item.NombreVariante,
                    talle: item.Talle, color: item.Color, cantidad: val, unidad: item.UnidadBase,
                });
            }
            verDetalle(rem.RemId); setAbierto(rem.RemId);
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo recibir'); }
    };

    return (
        <div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
                {[['EN_TRANSITO', 'En tránsito'], ['RECIBIDO', 'Recibidos'], ['', 'Todos']].map(([v, l]) => (
                    <button key={v} onClick={() => setFiltro(v)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-black ${filtro === v ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
                ))}
                <div className="flex-1" />
                <button onClick={() => setCreando(c => !c)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-black">
                    <Plus size={15} /> Nuevo remito
                </button>
            </div>

            {creando && (
                <div className="bg-white rounded-2xl border border-sky-200 p-5 mb-4 space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <Selector value={origen} onChange={setOrigen} placeholder="Origen..."
                            opciones={depositos.map(d => ({ value: d.DepId, label: d.Nombre || `Dep ${d.DepId}` }))} />
                        <ArrowRight size={16} className="text-slate-400" />
                        <Selector value={destino} onChange={setDestino} placeholder="Destino..."
                            opciones={depositos.filter(d => String(d.DepId) !== String(origen)).map(d => ({ value: d.DepId, label: d.Nombre || `Dep ${d.DepId}` }))} />
                        <input value={obs} onChange={e => setObs(e.target.value)} placeholder="Observaciones (opcional)"
                            className="flex-1 min-w-[180px] px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                    </div>
                    <div className="max-w-md"><BuscadorVariante placeholder="Agregar variante al remito..."
                        onElegir={(v) => setItemsNuevo(prev => prev.some(i => i.VarId === v.VarId) ? prev : [...prev, { ...v, cantidad: '' }])} /></div>
                    {itemsNuevo.length > 0 && (
                        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                            {itemsNuevo.map((i, idx) => (
                                <div key={i.VarId} className="flex items-center gap-3 px-3 py-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-slate-700 truncate">{i.Producto} — {i.NombreVariante}</p>
                                        <p className="text-[11px] text-slate-400">{[i.Talle, i.Color].filter(Boolean).join(' · ')}</p>
                                    </div>
                                    <input type="number" inputMode="decimal" min="0" step="1" placeholder="Cant."
                                        value={i.cantidad}
                                        onChange={e => setItemsNuevo(prev => prev.map((x, xi) => xi === idx ? { ...x, cantidad: e.target.value } : x))}
                                        className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                    <button onClick={() => setItemsNuevo(prev => prev.filter((_, xi) => xi !== idx))}
                                        className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 flex items-center justify-center"><Trash2 size={13} /></button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <AlertTriangle size={13} className="text-amber-500" />
                        Al crear el remito el stock <b>sale del origen en el acto</b> (queda "en tránsito" hasta recibirse en destino).
                    </div>
                    <button onClick={crear} disabled={guardando}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black disabled:opacity-50">
                        {guardando ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />} Crear y despachar
                    </button>
                </div>
            )}

            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : remitos.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">Sin remitos {filtro === 'EN_TRANSITO' ? 'en tránsito' : ''}.</div>
            ) : (
                <div className="space-y-2">
                    {remitos.map(r => (
                        <div key={r.RemId} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                            <button onClick={() => verDetalle(r.RemId)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left">
                                {abierto === r.RemId ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                                <span className="text-sm font-black text-slate-700 w-24">{r.Numeracion}</span>
                                <span className="text-xs font-bold text-slate-500 flex-1">{r.DepOrigen || r.DepOrigenId} → {r.DepDestino || r.DepDestinoId}</span>
                                <span className="text-[11px] text-slate-400">{fmtFecha(r.FechaCreacion)}</span>
                                <span className="text-[11px] font-bold text-slate-500">{r.Items} item{r.Items !== 1 ? 's' : ''}</span>
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${r.Estado === 'RECIBIDO' ? 'bg-emerald-100 text-emerald-700' : r.Estado === 'CANCELADO' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'}`}>
                                    {r.Estado === 'EN_TRANSITO' && r.Pendientes < r.Items ? `${r.Items - r.Pendientes}/${r.Items}` : r.Estado.replace('_', ' ')}
                                </span>
                            </button>
                            {abierto === r.RemId && (
                                <div className="border-t border-slate-100 divide-y divide-slate-50">
                                    {(detalle[r.RemId] || []).map(it => (
                                        <div key={it.RemItId} className="flex items-center gap-3 pl-11 pr-4 py-2.5">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-700 truncate">{it.Producto} — {it.NombreVariante}</p>
                                                <p className="text-[11px] text-slate-400">{[it.Talle, it.Color].filter(Boolean).join(' · ')}</p>
                                            </div>
                                            <span className="text-xs tabular-nums font-gsanscode text-slate-500">env. <b className="text-slate-800">{fmtCant(it.CantidadEnviada)}</b></span>
                                            {it.Estado === 'PENDIENTE' ? (
                                                <>
                                                    <input type="number" inputMode="decimal" min="0" step="1"
                                                        value={recibiendo[it.RemItId] ?? String(it.CantidadEnviada)}
                                                        onChange={e => setRecibiendo(prev => ({ ...prev, [it.RemItId]: e.target.value }))}
                                                        className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                    <button onClick={() => recibir(it, r)}
                                                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black">Recibir</button>
                                                </>
                                            ) : (
                                                <span className="text-xs text-emerald-600 font-bold">recibido {fmtCant(it.CantidadRecibida)}{it.EtiGeneradaId ? ` → #${it.EtiGeneradaId}` : ''}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── COMPRAS (F4) ────────────────────────────────────────────────────────── */
function TabCompras({ depositos, depDefault }) {
    const [filtro, setFiltro] = useState('activas');
    const [compras, setCompras] = useState([]);
    const [cat, setCat] = useState({ proveedores: [], monedas: [], plantillas: [], motivos: [], tiposFactura: [] });
    const [cargando, setCargando] = useState(true);
    const [abierta, setAbierta] = useState(null);
    const [det, setDet] = useState({});
    const [creando, setCreando] = useState(false);
    const [recibiendo, setRecibiendo] = useState({});   // CDetId -> cantidad
    const [bultosRec, setBultosRec] = useState({});     // CDetId -> bultos (etiquetas a abrir)
    const [depRec, setDepRec] = useState(depDefault);
    const [pagoMonto, setPagoMonto] = useState('');
    const [pagoMotivo, setPagoMotivo] = useState('');
    const [archivos, setArchivos] = useState({});      // CompId -> adjuntos
    const [subiendo, setSubiendo] = useState(false);
    const [costoDesc, setCostoDesc] = useState('');
    const [costoMonto, setCostoMonto] = useState('');
    const [vista, setVista] = useState('compras');     // compras | importaciones
    const [editando, setEditando] = useState(null);    // datos de cabecera en edición
    const refCostos = useRef(null);

    // alta (mismos campos que el formulario del sistema anterior)
    const [nPrv, setNPrv] = useState(''); const [nMon, setNMon] = useState('');
    const [nPla, setNPla] = useState(''); const [nRef, setNRef] = useState('');
    const [nTfa, setNTfa] = useState(''); const [nExtras, setNExtras] = useState('');
    const [nDep, setNDep] = useState(depDefault);
    // logística del embarque
    const [nEta, setNEta] = useState(''); const [nVol, setNVol] = useState('');
    const [nPeso, setNPeso] = useState(''); const [nInco, setNInco] = useState('');
    const [refDup, setRefDup] = useState(false);
    const [nItems, setNItems] = useState([]); const [guardando, setGuardando] = useState(false);
    // pagos declarados junto con la compra
    const [nPagos, setNPagos] = useState([]);
    const [pgMonto, setPgMonto] = useState(''); const [pgTipo, setPgTipo] = useState('');
    const [pgDetalle, setPgDetalle] = useState('');
    const [motivoNuevo, setMotivoNuevo] = useState(null);   // null = oculto, '' = abierto vacío

    const simAlta = simMoneda(cat.monedas.find(m => String(m.MonId) === String(nMon))?.Codigo);
    const totalAlta = nItems.reduce((a, i) => a + (parseFloat(i.cantidad) || 0) * (parseFloat(i.precio) || 0), 0);

    // El sistema anterior avisaba al salir del campo si el proveedor ya tenía esa referencia
    const chequearRef = async () => {
        if (!nPrv || !nRef.trim()) { setRefDup(false); return; }
        try {
            const r = await api.get(`/wms-interno/compras-ref-libre?prv=${nPrv}&ref=${encodeURIComponent(nRef.trim())}`);
            setRefDup(!r.data?.libre);
        } catch (e) { /* que no trabe el alta */ }
    };

    const agregarPago = () => {
        const m = parseFloat(String(pgMonto).replace(',', '.'));
        if (!(m > 0)) return toast.error('Escribí el monto del pago');
        if (!pgTipo) return toast.error('Elegí el motivo del pago');
        setNPagos(p => [...p, { monto: m, tipoPago: pgTipo, motivo: pgDetalle.trim() }]);
        setPgMonto(''); setPgDetalle('');
    };

    const guardarMotivo = async () => {
        const nombre = String(motivoNuevo || '').trim();
        if (!nombre) return setMotivoNuevo(null);
        try {
            const r = await api.post('/wms-interno/pagos-motivos', { nombre });
            const nuevo = r.data?.data;
            setCat(c => ({ ...c, motivos: c.motivos.some(x => x.PmoId === nuevo.PmoId) ? c.motivos : [...c.motivos, nuevo] }));
            setPgTipo(nuevo.Nombre);
            setMotivoNuevo(null);
        } catch (e) { toast.error('No se pudo crear el motivo'); }
    };

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const r = await api.get(`/wms-interno/compras?estado=${filtro}`);
            setCompras(r.data?.data || []);
        } catch (e) { toast.error('No se pudieron cargar las compras'); }
        finally { setCargando(false); }
    }, [filtro]);
    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => {
        api.get('/wms-interno/compras-catalogos').then(r => {
            const c = r.data?.data;
            if (!c) return;
            setCat(c);
            // Mismos defaults que el sistema anterior: primera moneda y primera plantilla
            setNMon(m => m || c.monedas?.[0]?.MonId || '');
            setNPla(p => p || c.plantillas?.[0]?.PlaId || '');
            setPgTipo(t => t || c.motivos?.[0]?.Nombre || '');
        }).catch(() => {});
    }, []);

    const verDetalle = async (id) => {
        setAbierta(id);
        try {
            const [r, a] = await Promise.all([
                api.get(`/wms-interno/compras/${id}`),
                api.get(`/wms-interno/compras/${id}/archivos`).catch(() => ({ data: { data: [] } })),
            ]);
            setDet(prev => ({ ...prev, [id]: r.data?.data }));
            setArchivos(prev => ({ ...prev, [id]: a.data?.data || [] }));
        } catch (e) { toast.error('No se pudo cargar el detalle'); }
    };

    const cargarArchivos = async (compId) => {
        try {
            const a = await api.get(`/wms-interno/compras/${compId}/archivos`);
            setArchivos(prev => ({ ...prev, [compId]: a.data?.data || [] }));
        } catch (e) { /* silencioso */ }
    };
    const subirArchivo = async (compId, file, descripcion) => {
        if (!file) return;
        const fd = new FormData();
        fd.append('archivo', file);
        if (descripcion) fd.append('descripcion', descripcion);
        setSubiendo(true);
        try {
            await api.post(`/wms-interno/compras/${compId}/archivos`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            toast.success('Archivo adjuntado');
            cargarArchivos(compId);
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo subir el archivo'); }
        finally { setSubiendo(false); }
    };
    const borrarArchivo = async (compId, carId) => {
        try {
            await api.delete(`/wms-interno/compras/archivos/${carId}`);
            toast.success('Archivo eliminado');
            cargarArchivos(compId);
        } catch (e) { toast.error('No se pudo eliminar'); }
    };
    const refrescar = async (id) => { const r = await api.get(`/wms-interno/compras/${id}`); setDet(prev => ({ ...prev, [id]: r.data?.data })); cargar(); };

    const avanzar = async (c, clave) => {
        try { await api.post(`/wms-interno/compras/${c.CompId}/progreso`, { clave }); toast.success('Progreso actualizado'); cargar(); }
        catch (e) { toast.error('No se pudo cambiar el progreso'); }
    };
    const autorizar = async (c) => {
        try {
            await api.post(`/wms-interno/compras/${c.CompId}/autorizar`, { autorizado: !c.AutorizadoRecepcion });
            toast.success(c.AutorizadoRecepcion ? 'Recepción bloqueada' : 'Recepción autorizada');
            cargar();
        } catch (e) { toast.error('No se pudo cambiar la autorización'); }
    };
    const pagar = async (c) => {
        const n = parseFloat(String(pagoMonto).replace(',', '.'));
        if (!(n > 0)) return toast.error('Monto inválido');
        try {
            await api.post(`/wms-interno/compras/${c.CompId}/pagos`, { monto: n, tipoPago: pagoMotivo || null });
            toast.success('Pago registrado'); setPagoMonto(''); setPagoMotivo('');
            refrescar(c.CompId);
        } catch (e) { toast.error('No se pudo registrar el pago'); }
    };
    const agregarCosto = async (c) => {
        const m = parseFloat(String(costoMonto).replace(',', '.'));
        if (!costoDesc.trim() || !(m > 0)) return toast.error('Completá concepto y monto');
        try {
            await api.post(`/wms-interno/compras/${c.CompId}/costos`, { descripcion: costoDesc.trim(), monto: m });
            toast.success('Costo agregado — se prorrateó en el costo de cada artículo');
            setCostoDesc(''); setCostoMonto('');
            refrescar(c.CompId);
        } catch (e) { toast.error('No se pudo agregar el costo'); }
    };
    const quitarCosto = async (c, cceId) => {
        try {
            await api.delete(`/wms-interno/compras/costos/${cceId}`);
            toast.success('Costo eliminado');
            refrescar(c.CompId);
        } catch (e) { toast.error('No se pudo eliminar'); }
    };
    const guardarEdicion = async (c) => {
        try {
            await api.put(`/wms-interno/compras/${c.CompId}`, editando);
            toast.success('Compra actualizada');
            setEditando(null);
            cargar(); refrescar(c.CompId);
        } catch (e) { toast.error('No se pudo guardar'); }
    };

    const cambiarPlantilla = async (c, plaId) => {
        try {
            await api.post(`/wms-interno/compras/${c.CompId}/plantilla`, { plaId });
            toast.success('Tipo de seguimiento actualizado');
            refrescar(c.CompId);
        } catch (e) { toast.error('No se pudo cambiar el seguimiento'); }
    };

    const recibir = async (c) => {
        const d = det[c.CompId];
        const lineas = (d?.lineas || [])
            .map(l => ({
                cDetId: l.CDetId,
                cantidad: parseFloat(recibiendo[l.CDetId] ?? (Number(l.Cantidad) - Number(l.CantidadRecibida))),
                bultos: parseInt(bultosRec[l.CDetId] ?? l.Bultos, 10) || 1,
            }))
            .filter(l => l.cantidad > 0);
        if (!lineas.length) return toast.error('No hay nada para recibir');
        try {
            const r = await api.post(`/wms-interno/compras/${c.CompId}/recibir`, { depId: depRec, lineas });
            // Una etiqueta por bulto: se imprime una por cada una, con su propia cantidad
            const todas = (r.data.etiquetas || []).flatMap(e =>
                (e.etiquetas || [{ etiId: e.etiId, cantidad: e.cantidad }]).map(x => ({ ...x, cDetId: e.cDetId })));
            toast.success(`${todas.length} etiqueta(s) creada(s) en el depósito`);
            for (const e of todas) {
                const l = d.lineas.find(x => x.CDetId === e.cDetId);
                if (l) await imprimirEtiqueta({ etiId: e.etiId, producto: l.Producto, variante: l.NombreVariante, talle: l.Talle, color: l.Color, cantidad: e.cantidad, unidad: l.UnidadBase });
            }
            setRecibiendo({}); setBultosRec({});
            refrescar(c.CompId);
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo recibir'); }
    };
    const crear = async (borrador = false) => {
        if (!nPrv) return toast.error('Elegí el proveedor');
        if (!nItems.length) return toast.error('Agregá al menos un artículo a la compra');
        // El backend descarta en silencio las líneas sin cantidad: no dejamos que salgan.
        const sinCant = nItems.filter(i => !(parseFloat(String(i.cantidad).replace(',', '.')) > 0));
        if (sinCant.length) return toast.error(`Falta la cantidad en ${sinCant.length} artículo${sinCant.length > 1 ? 's' : ''}`);
        if (refDup) return toast.error('Ese proveedor ya tiene una compra con esa referencia');
        setGuardando(true);
        try {
            await api.post('/wms-interno/compras', {
                prvId: nPrv, monedaId: nMon || null, plaId: nPla || null, tfaId: nTfa || null,
                referenciaFactura: nRef, depRecepcionId: nDep,
                gastosExtras: parseFloat(String(nExtras).replace(',', '.')) || 0,
                fechaEstimadaArribo: nEta || null, volumenM3: nVol, pesoKg: nPeso, incoterm: nInco || null,
                borrador,
                items: nItems.map(i => ({
                    varId: i.VarId,
                    cantidad: parseFloat(String(i.cantidad).replace(',', '.')),
                    precioUnitario: parseFloat(String(i.precio).replace(',', '.')) || 0,
                    bultos: parseInt(i.bultos, 10) || 1,
                })),
                pagos: nPagos,
            });
            toast.success(borrador ? 'Borrador guardado' : 'Compra registrada');
            setCreando(false); setNItems([]); setNRef(''); setNPrv(''); setNTfa('');
            setNExtras(''); setNPagos([]); setRefDup(false);
            setNEta(''); setNVol(''); setNPeso(''); setNInco('');
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo crear la compra'); }
        finally { setGuardando(false); }
    };

    const simbolo = (c) => simMoneda(c.Moneda);

    return (
        <div>
            <div className="flex items-center gap-1.5 mb-4">
                {[['compras', 'Compra formal', ShoppingCart], ['importaciones', 'Importaciones y costos', Ship]].map(([v, l, Ico]) => (
                    <button key={v} onClick={() => setVista(v)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black transition-colors ${vista === v ? 'bg-white border border-slate-200 text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        <Ico size={15} /> {l}
                    </button>
                ))}
            </div>

            {vista === 'importaciones' ? <PanelImportaciones cat={cat} /> : (<>

            <div className="flex flex-wrap items-center gap-2 mb-4">
                {[['activas', 'Activas'], ['historial', 'Recibidas'], ['todas', 'Todas']].map(([v, l]) => (
                    <button key={v} onClick={() => setFiltro(v)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-black ${filtro === v ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
                ))}
                <div className="flex-1" />
                <button onClick={() => setCreando(c => !c)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-black">
                    <Plus size={15} /> Nueva compra
                </button>
            </div>

            {creando && (
                <div className="space-y-4 mb-4">

                    {/* ── Datos del documento ── */}
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-50/60">
                            <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center"><FileText size={16} /></div>
                            <div>
                                <h3 className="text-sm font-black text-slate-800 leading-none">Datos del documento</h3>
                                <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Registra información fiscal o de remito</p>
                            </div>
                        </div>
                        <div className="p-5 grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                            <Campo label="Proveedor / vendedor">
                                <Selector value={nPrv} onChange={v => { setNPrv(v); setRefDup(false); }} className="w-full" ancho="w-full"
                                    placeholder="Elegir proveedor..."
                                    opciones={cat.proveedores.map(p => ({ value: p.PrvId, label: p.Nombre }))} />
                            </Campo>
                            <Campo label="Documento comercial">
                                <Selector value={nTfa} onChange={setNTfa} className="w-full" ancho="w-full"
                                    placeholder="Elegir comprobante..."
                                    opciones={cat.tiposFactura.map(t => ({ value: t.TfaId, label: t.Nombre }))} />
                            </Campo>
                            <Campo label={refDup ? 'Referencia ya emitida' : 'Nº referencia asoc. (remito/tkt)'} error={refDup}>
                                <input value={nRef} onBlur={chequearRef}
                                    onChange={e => { setNRef(e.target.value); if (refDup) setRefDup(false); }}
                                    placeholder="A-0001-090234"
                                    className={`w-full px-3 py-2 rounded-xl border text-sm font-bold uppercase outline-none transition-colors ${refDup ? 'border-rose-400 text-rose-600 focus:ring-2 focus:ring-rose-100' : 'border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200'}`} />
                            </Campo>
                            <Campo label="Moneda base">
                                <Selector value={nMon} onChange={setNMon} className="w-full" ancho="w-full"
                                    placeholder="Elegir moneda..."
                                    opciones={cat.monedas.map(m => ({ value: m.MonId, label: `${m.Codigo} (${simMoneda(m.Codigo)})` }))} />
                            </Campo>
                            <Campo label="Costos extras">
                                <input type="number" value={nExtras} onChange={e => setNExtras(e.target.value)} placeholder="0.00"
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-rose-600 tabular-nums font-gsanscode text-right placeholder:text-left outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                            </Campo>
                            <Campo label="Plantilla de progreso">
                                <Selector value={nPla} onChange={setNPla} className="w-full" ancho="w-full"
                                    placeholder="Elegir plantilla..."
                                    opciones={cat.plantillas.map(p => ({ value: p.PlaId, label: p.Nombre }))} />
                            </Campo>
                            <Campo label="Depósito de recepción">
                                <Selector value={nDep} onChange={v => setNDep(parseInt(v, 10))} className="w-full" ancho="w-full"
                                    opciones={depositos.map(d => ({ value: d.DepId, label: d.Nombre }))} />
                            </Campo>
                        </div>

                        {/* Logística del embarque */}
                        <div className="px-5 pb-5 -mt-1">
                            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                                    <Ship size={12} /> Logística del embarque
                                </p>
                                <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
                                    <Campo label="Fecha estimada de arribo">
                                        <input type="date" value={nEta} onChange={e => setNEta(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                    </Campo>
                                    <Campo label="Volumen (m³)">
                                        <input type="number" min="0" step="0.001" value={nVol} onChange={e => setNVol(e.target.value)} placeholder="0.000"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold tabular-nums font-gsanscode text-right placeholder:text-left outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                    </Campo>
                                    <Campo label="Peso (kg)">
                                        <input type="number" min="0" step="0.001" value={nPeso} onChange={e => setNPeso(e.target.value)} placeholder="0.000"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold tabular-nums font-gsanscode text-right placeholder:text-left outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                    </Campo>
                                    <Campo label="Incoterm">
                                        <Selector value={nInco} onChange={setNInco} className="w-full" ancho="w-full"
                                            placeholder="Elegir incoterm..." opciones={INCOTERMS} />
                                    </Campo>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Pagos realizados ── */}
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-50/60">
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><DollarSign size={16} /></div>
                            <div>
                                <h3 className="text-sm font-black text-slate-800 leading-none">Pagos realizados</h3>
                                <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Registra los pagos adelantados o totales para esta compra</p>
                            </div>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="grid md:grid-cols-4 gap-3 items-end bg-slate-50 rounded-xl border border-slate-100 p-4">
                                <Campo label="Monto del pago">
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-black">{simAlta}</span>
                                        <input type="number" value={pgMonto} onChange={e => setPgMonto(e.target.value)} placeholder="0.00"
                                            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold tabular-nums font-gsanscode text-right placeholder:text-left outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                    </div>
                                </Campo>
                                <Campo label="Motivo de pago">
                                    {motivoNuevo !== null ? (
                                        <div className="flex gap-1.5">
                                            <input autoFocus value={motivoNuevo} onChange={e => setMotivoNuevo(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') guardarMotivo(); if (e.key === 'Escape') setMotivoNuevo(null); }}
                                                placeholder="Nombre del motivo..."
                                                className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-emerald-300 text-sm outline-none" />
                                            <button onClick={guardarMotivo}
                                                className="w-9 shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center"><Check size={14} /></button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-1.5">
                                            <Selector value={pgTipo} onChange={setPgTipo} className="flex-1 min-w-0" ancho="w-full"
                                                placeholder="Elegir motivo..."
                                                opciones={cat.motivos.map(m => ({ value: m.Nombre, label: m.Nombre }))} />
                                            <button onClick={() => setMotivoNuevo('')} title="Nuevo motivo"
                                                className="w-9 shrink-0 rounded-xl border border-slate-200 text-slate-400 hover:text-sky-600 hover:border-sky-300 flex items-center justify-center"><Plus size={14} /></button>
                                        </div>
                                    )}
                                </Campo>
                                <Campo label="Detalle / explicación">
                                    <input value={pgDetalle} onChange={e => setPgDetalle(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') agregarPago(); }}
                                        placeholder="Ej: transferencia del 12/08"
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                </Campo>
                                <button onClick={agregarPago}
                                    className="h-[38px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider">
                                    Agregar
                                </button>
                            </div>

                            {nPagos.length === 0 ? (
                                <p className="text-center text-xs text-slate-400 font-semibold italic py-2">No se han registrado pagos para esta compra aún.</p>
                            ) : (
                                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                                    {nPagos.map((p, idx) => (
                                        <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">{p.tipoPago}</span>
                                            <p className="text-xs text-slate-500 font-semibold flex-1 truncate">{p.motivo || '—'}</p>
                                            <span className="text-sm font-black text-slate-800 tabular-nums font-gsanscode">{simAlta} {p.monto.toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span>
                                            <button onClick={() => setNPagos(x => x.filter((_, i) => i !== idx))}
                                                className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 flex items-center justify-center"><Trash2 size={13} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Facturador ── */}
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="flex flex-col md:flex-row md:items-center gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-50/60">
                            <div className="flex-1">
                                <h3 className="text-base font-black text-slate-800 leading-none">Facturador</h3>
                                <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Declara las cantidades y el costo de lote.</p>
                            </div>
                            <div className="w-full md:w-80"><BuscadorVariante placeholder="Añadir productos..."
                                onElegir={(v) => setNItems(prev => prev.some(i => i.VarId === v.VarId) ? prev : [...prev, { ...v, cantidad: '', precio: '', bultos: '' }])} /></div>
                        </div>

                        {nItems.length === 0 ? (
                            <div className="py-12 flex flex-col items-center text-center px-6">
                                <ShoppingCart size={40} className="text-slate-200 mb-3" />
                                <p className="text-sm font-black text-slate-500">Este comprobante está vacío.</p>
                                <p className="text-xs text-slate-400 mt-1 max-w-sm">Buscá un artículo arriba para armar el lote de registro de tu historial contable.</p>
                            </div>
                        ) : (
                            <div className="p-4 space-y-2">
                                <div className="hidden md:grid grid-cols-[1fr_100px_110px_120px_120px_36px] gap-2 px-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    <span>Producto asentado</span>
                                    <span className="text-center">Bultos</span>
                                    <span className="text-center">Cant. recibida</span>
                                    <span className="text-right">Cost. unit</span>
                                    <span className="text-right">Subtotal</span>
                                    <span />
                                </div>
                                {nItems.map((i, idx) => {
                                    const sub = (parseFloat(i.cantidad) || 0) * (parseFloat(i.precio) || 0);
                                    const set = (campo, val) => setNItems(p => p.map((x, xi) => xi === idx ? { ...x, [campo]: val } : x));
                                    return (
                                        <div key={i.VarId} className="rounded-xl border border-slate-100 hover:border-slate-200 transition-colors px-3 py-2 flex flex-col md:grid md:grid-cols-[1fr_100px_110px_120px_120px_36px] gap-2 md:items-center">
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-slate-800 truncate">{i.Producto}</p>
                                                <p className="text-[11px] text-slate-400 font-semibold truncate">{i.NombreVariante}</p>
                                            </div>
                                            <div className="flex flex-col items-center gap-0.5">
                                                <input type="number" min="1" step="1" value={i.bultos || ''} onChange={e => set('bultos', e.target.value)} placeholder="1"
                                                    className="w-full px-2 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm font-bold text-center outline-none focus:border-amber-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                                <span className="text-[9px] font-black text-slate-400 uppercase leading-none">Cajas físicas</span>
                                            </div>
                                            <div className="flex flex-col items-center gap-0.5">
                                                <input type="number" min="0" step="1" value={i.cantidad} onChange={e => set('cantidad', e.target.value)} placeholder="Cant."
                                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-sm font-bold text-center outline-none focus:border-sky-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                                <span className="text-[9px] font-black text-slate-400 uppercase leading-none">{i.UnidadBase || 'u'} total</span>
                                            </div>
                                            <input type="number" min="0" step="1" value={i.precio} onChange={e => set('precio', e.target.value)} placeholder="Costo"
                                                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-emerald-700 text-sm font-bold tabular-nums font-gsanscode text-right placeholder:text-left outline-none focus:border-emerald-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                            <p className="text-sm font-black text-slate-800 tabular-nums font-gsanscode text-right">{simAlta} {sub.toLocaleString('es-UY', { minimumFractionDigits: 2 })}</p>
                                            <button onClick={() => setNItems(p => p.filter((_, xi) => xi !== idx))}
                                                className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 flex items-center justify-center justify-self-end"><Trash2 size={13} /></button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center gap-4">
                            <div className="flex-1">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total declarado a pagar</p>
                                <p className="text-3xl font-black text-emerald-600 tabular-nums font-gsanscode tracking-tight">
                                    {simAlta} {totalAlta.toLocaleString('es-UY', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2">
                                <button onClick={() => setCreando(false)}
                                    className="px-4 py-2.5 rounded-xl text-xs font-black text-slate-400 hover:text-slate-600">Cancelar</button>
                                <button onClick={() => crear(true)} disabled={guardando}
                                    className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 text-xs font-black uppercase tracking-wider disabled:opacity-50">
                                    Guardar como borrador
                                </button>
                                <button onClick={() => crear(false)} disabled={guardando}
                                    className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50">
                                    {guardando ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />} Asentar recibo oficial
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : compras.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">Sin compras.</div>
            ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {compras.map(c => {
                        const pend = Number(c.TotalCompra) - Number(c.Pagado);
                        const recibida = String(c.Progreso) === 'recibido';
                        return (
                            <button key={c.CompId} onClick={() => verDetalle(c.CompId)}
                                className="bg-white rounded-2xl border border-slate-200 hover:border-sky-300 hover:shadow-md transition-all p-5 text-left flex flex-col gap-3">
                                <div className="flex items-start justify-between gap-2">
                                    <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${
                                        recibida ? 'bg-emerald-100 text-emerald-700'
                                        : c.Estado === 'pre-compra' ? 'bg-amber-100 text-amber-700'
                                        : 'bg-brand-cyan/10 text-brand-cyan'}`}>
                                        {recibida ? 'Recibida' : c.Estado === 'pre-compra' ? 'Borrador / precompra' : 'Confirmada'}
                                    </span>
                                    <span className="text-[11px] font-bold text-slate-400">{fmtFecha(c.FechaCreacion)}</span>
                                </div>

                                <div className="min-w-0">
                                    <p className="text-lg font-black text-slate-800 truncate leading-tight">{c.Proveedor || 'Sin proveedor'}</p>
                                    <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                                        <span className="font-mono">#{c.CompId}</span>
                                        {c.ReferenciaFactura ? ` · Ref: ${c.ReferenciaFactura}` : ''}
                                    </p>
                                </div>

                                <div className="border-t border-slate-100 pt-3 flex items-end justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Progreso</p>
                                        <p className="text-sm font-black text-slate-600 truncate">{c.ProgresoEtiqueta || c.Progreso || '—'}</p>
                                        <p className="text-[10px] font-bold text-slate-400 mt-0.5 flex items-center gap-1">
                                            {c.AutorizadoRecepcion ? <Unlock size={10} className="text-emerald-600" /> : <Lock size={10} />}
                                            {c.Lineas} ítem{c.Lineas !== 1 ? 's' : ''}
                                        </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-xl font-black text-emerald-600 tabular-nums font-gsanscode leading-tight">
                                            {simbolo(c)} {Number(c.TotalCompra).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                        </p>
                                        <p className={`text-[10px] font-bold ${pend > 0.01 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                            {pend > 0.01 ? `resta ${simbolo(c)} ${pend.toLocaleString('es-UY', { maximumFractionDigits: 2 })}` : 'pagada'}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            </>)}

            {/* Detalle en modal (fondo sólido, sin blur) */}
            {abierta && (() => {
                const c = compras.find(x => x.CompId === abierta);
                if (!c) return null;
                const d = det[c.CompId];
                return createPortal((
                    <div className="fixed inset-0 z-[6000] flex items-center justify-center p-3 md:p-6 bg-slate-900/60 font-dmsans"
                        onClick={e => { if (e.target === e.currentTarget) setAbierta(null); }}>
                        <div className="bg-white rounded-2xl w-full max-w-[1200px] max-h-[92vh] shadow-2xl flex flex-col overflow-hidden">
                            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-white shrink-0">
                                <div className="min-w-0 flex-1">
                                    <h3 className="text-xl font-black text-slate-800 truncate">
                                        Compra #{c.CompId} · {c.Proveedor || 'Sin proveedor'}
                                    </h3>
                                    <p className="text-xs text-slate-400 font-bold mt-0.5">
                                        {c.ReferenciaFactura ? `Ref: ${c.ReferenciaFactura} · ` : ''}{fmtFecha(c.FechaCreacion)}
                                    </p>
                                </div>
                                <button onClick={() => setAbierta(null)}
                                    className="w-9 h-9 rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50 flex items-center justify-center shrink-0">
                                    <X size={17} />
                                </button>
                            </div>
                            <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">

                                        {!d ? <div className="flex items-center gap-2 text-slate-400 text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando...</div> : (<>
                                            {/* Encabezado: monto, extras y acciones */}
                                            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 flex flex-wrap items-center gap-3">
                                                <div className="flex flex-wrap items-center gap-2 flex-1">
                                                    <button onClick={() => imprimirEtiquetasCompra(c, d.lineas, simbolo(c))}
                                                        className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-black text-slate-600">
                                                        <Printer size={14} /> Imprimir etiquetas ({d.lineas.length})
                                                    </button>
                                                    <label className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-black cursor-pointer ${c.AutorizadoRecepcion ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                                        <input type="checkbox" checked={!!c.AutorizadoRecepcion} onChange={() => autorizar(c)} className="rounded outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                        Autorizar recepción
                                                    </label>
                                                    <button onClick={() => setEditando(editando ? null : {
                                                            prvId: c.PrvId || '', monedaId: c.MonedaId || '', tfaId: c.TfaId || '',
                                                            referenciaFactura: c.ReferenciaFactura || '', depRecepcionId: c.DepRecepcionId || '',
                                                            fechaEstimadaArribo: fechaInput(c.FechaEstimadaArribo),
                                                            volumenM3: c.VolumenM3 ?? '', pesoKg: c.PesoKg ?? '', incoterm: c.Incoterm || '',
                                                        })}
                                                        className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-black ${editando ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'}`}>
                                                        <Pencil size={13} /> {editando ? 'Cancelar edición' : 'Editar compra'}
                                                    </button>
                                                    <button onClick={() => refCostos.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                                                        className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-xs font-black text-sky-700">
                                                        <Plus size={13} /> Cargar costo extra
                                                    </button>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Monto total</p>
                                                    <p className="text-3xl font-black text-brand-cyan tabular-nums font-gsanscode leading-tight">
                                                        {simbolo(c)} {Number(c.TotalCompra).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                                    </p>
                                                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                                                        Gastos / fletes extra: {simbolo(c)} {Number(c.GastosExtras || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Edición de la cabecera */}
                                            {editando && (
                                                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                                                    <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Editar datos de la compra</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        <Selector value={editando.prvId} placeholder="Proveedor..."
                                                            onChange={(v) => setEditando(x => ({ ...x, prvId: v }))}
                                                            opciones={cat.proveedores.map(p => ({ value: p.PrvId, label: p.Nombre }))} />
                                                        <Selector value={editando.monedaId} placeholder="Moneda..."
                                                            onChange={(v) => setEditando(x => ({ ...x, monedaId: v }))}
                                                            opciones={cat.monedas.map(m => ({ value: m.MonId, label: `${m.Codigo} (${simMoneda(m.Codigo)})` }))} />
                                                        <Selector value={editando.tfaId} placeholder="Tipo de factura..."
                                                            onChange={(v) => setEditando(x => ({ ...x, tfaId: v }))}
                                                            opciones={cat.tiposFactura.map(t => ({ value: t.TfaId, label: t.Nombre }))} />
                                                        <Selector value={editando.depRecepcionId} placeholder="Depósito de recepción..."
                                                            onChange={(v) => setEditando(x => ({ ...x, depRecepcionId: v }))}
                                                            opciones={depositos.map(dp => ({ value: dp.DepId, label: dp.Nombre }))} />
                                                        <input value={editando.referenciaFactura}
                                                            onChange={e => setEditando(x => ({ ...x, referenciaFactura: e.target.value }))}
                                                            placeholder="Referencia / factura"
                                                            className="flex-1 min-w-[180px] px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                        <input type="date" value={editando.fechaEstimadaArribo} title="Fecha estimada de arribo"
                                                            onChange={e => setEditando(x => ({ ...x, fechaEstimadaArribo: e.target.value }))}
                                                            className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                        <input type="number" min="0" step="0.001" value={editando.volumenM3} placeholder="m³"
                                                            onChange={e => setEditando(x => ({ ...x, volumenM3: e.target.value }))}
                                                            className="w-24 px-3 py-2 rounded-xl border border-slate-200 text-sm tabular-nums font-gsanscode text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                        <input type="number" min="0" step="0.001" value={editando.pesoKg} placeholder="kg"
                                                            onChange={e => setEditando(x => ({ ...x, pesoKg: e.target.value }))}
                                                            className="w-24 px-3 py-2 rounded-xl border border-slate-200 text-sm tabular-nums font-gsanscode text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                        <Selector value={editando.incoterm} placeholder="Incoterm..."
                                                            onChange={(v) => setEditando(x => ({ ...x, incoterm: v }))}
                                                            opciones={INCOTERMS} />
                                                        <button onClick={() => guardarEdicion(c)}
                                                            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-black">Guardar cambios</button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Datos del embarque: solo si hay alguno cargado */}
                                            {(c.FechaEstimadaArribo || c.VolumenM3 || c.PesoKg || c.Incoterm) && (
                                                <div className="flex flex-wrap gap-2">
                                                    {c.FechaEstimadaArribo && <Dato icono={Anchor} label="Arribo estimado" valor={fmtFecha(c.FechaEstimadaArribo)} />}
                                                    {c.VolumenM3 > 0 && <Dato icono={Boxes} label="Volumen" valor={`${fmtCant(c.VolumenM3)} m³`} />}
                                                    {c.PesoKg > 0 && <Dato icono={Scale} label="Peso" valor={`${fmtCant(c.PesoKg)} kg`} />}
                                                    {c.Incoterm && <Dato icono={Ship} label="Incoterm" valor={c.Incoterm}
                                                        ayuda={INCOTERMS.find(i => i.value === c.Incoterm)?.label} />}
                                                </div>
                                            )}

                                            {/* Cargamento + progreso logístico al costado */}
                                            <div className="grid lg:grid-cols-[1fr_260px] gap-4 items-start">
                                            <div className="space-y-4 min-w-0">
                                            {/* Líneas + recepción */}
                                            <div className="rounded-xl border border-slate-200 overflow-x-auto">
                                                <div className="min-w-[820px]">
                                                    <div className="grid grid-cols-[1fr_90px_80px_90px_100px_110px_160px] gap-2 px-3 py-1.5 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                        <span>Artículo</span>
                                                        <span className="text-right">Pedido</span>
                                                        <span className="text-right">Recibido</span>
                                                        <span className="text-right">Real u.</span>
                                                        <span className="text-right" title="Costo puesto en depósito: el precio con los costos extra prorrateados">Local u.</span>
                                                        <span className="text-right">Total</span>
                                                        <span className="text-right" title="Bultos (etiquetas a abrir) y cantidad a recibir">Bultos · recibir</span>
                                                    </div>
                                                    <div className="divide-y divide-slate-50">
                                                        {d.lineas.map(l => {
                                                            const pendiente = Number(l.Cantidad) - Number(l.CantidadRecibida);
                                                            const local = Number(l.CostoPuestoLocal) > 0 ? Number(l.CostoPuestoLocal) : Number(l.PrecioUnitario || 0);
                                                            const conExtras = local > Number(l.PrecioUnitario || 0) + 0.001;
                                                            return (
                                                                <div key={l.CDetId} className="grid grid-cols-[1fr_90px_80px_90px_100px_110px_160px] gap-2 px-3 py-2 items-center">
                                                                    <div className="min-w-0">
                                                                        <p className="text-sm font-bold text-slate-700 truncate">{l.Producto} — {l.NombreVariante}</p>
                                                                        <p className="text-[10px] text-slate-400">{[l.Talle, l.Color].filter(Boolean).join(' · ')}</p>
                                                                    </div>
                                                                    <span className="text-xs text-right tabular-nums font-gsanscode text-slate-500">{fmtCant(l.Cantidad)}</span>
                                                                    <span className={`text-xs text-right tabular-nums font-gsanscode font-bold ${pendiente <= 0.001 ? 'text-emerald-600' : 'text-slate-700'}`}>{fmtCant(l.CantidadRecibida)}</span>
                                                                    <span className="text-xs text-right tabular-nums font-gsanscode text-slate-400">{simbolo(c)} {fmtCant(l.PrecioUnitario)}</span>
                                                                    <span className={`text-xs text-right tabular-nums font-gsanscode font-bold ${conExtras ? 'text-sky-700' : 'text-slate-500'}`}
                                                                        title={conExtras ? 'Incluye los costos extra prorrateados' : 'Sin costos extra'}>
                                                                        {simbolo(c)} {fmtCant(local)}
                                                                    </span>
                                                                    <span className="text-xs text-right tabular-nums font-gsanscode font-black text-emerald-700">
                                                                        {simbolo(c)} {Number(Number(l.Cantidad) * local).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                                                    </span>
                                                                    <div className="flex justify-end items-center gap-1.5">
                                                                        {pendiente > 0.001 ? (<>
                                                                            {/* Bultos: cuántas etiquetas físicas se abren con lo que entra */}
                                                                            <input type="number" min="1" step="1" title="Bultos: etiquetas a abrir"
                                                                                value={bultosRec[l.CDetId] ?? String(l.Bultos || 1)}
                                                                                onChange={e => setBultosRec(p => ({ ...p, [l.CDetId]: e.target.value }))}
                                                                                className="w-14 px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm font-bold text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                                            <input type="number" min="0" step="1"
                                                                                value={recibiendo[l.CDetId] ?? String(pendiente)}
                                                                                onChange={e => setRecibiendo(p => ({ ...p, [l.CDetId]: e.target.value }))}
                                                                                className="w-24 px-2 py-1 rounded-lg border border-slate-200 text-sm text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                                        </>) : <span className="text-[10px] font-black text-emerald-600">completa</span>}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="flex justify-end gap-6 px-3 py-2 bg-slate-50 border-t border-slate-100">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cargamento: {d.lineas.length} ítem{d.lineas.length !== 1 ? 's' : ''}</span>
                                                        <span className="text-sm font-black text-slate-800 tabular-nums font-gsanscode">
                                                            {simbolo(c)} {d.lineas.reduce((acc, l) => acc + Number(l.Cantidad) * (Number(l.CostoPuestoLocal) > 0 ? Number(l.CostoPuestoLocal) : Number(l.PrecioUnitario || 0)), 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border ${c.AutorizadoRecepcion ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                                                    {c.AutorizadoRecepcion ? <Unlock size={13} /> : <Lock size={13} />}
                                                    {c.AutorizadoRecepcion ? 'Recepción autorizada' : 'Recepción bloqueada'}
                                                </span>
                                                <Selector value={depRec} onChange={(v) => setDepRec(parseInt(v, 10))}
                                                    opciones={depositos.map(dp => ({ value: dp.DepId, label: `Entra en: ${dp.Nombre}` }))} />
                                                <button onClick={() => recibir(c)} disabled={!c.AutorizadoRecepcion || c.LineasPendientes === 0}
                                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black disabled:opacity-40 disabled:cursor-not-allowed"
                                                    title={!c.AutorizadoRecepcion ? 'Primero autorizá la recepción' : ''}>
                                                    <PackagePlus size={14} /> Recibir e imprimir etiquetas
                                                </button>
                                            </div>

                                            </div>

                                            {/* Progreso logístico — línea de tiempo vertical */}
                                            <div className="rounded-xl border border-slate-200 p-4 lg:sticky lg:top-0">
                                                <div className="flex items-center justify-between gap-2 mb-3">
                                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 leading-tight">Progreso<br />logístico</p>
                                                    <Selector size="sm" ancho="w-[136px]" placeholder="Seguimiento..."
                                                        value={c.PlaId || ''} onChange={(v) => cambiarPlantilla(c, parseInt(v, 10))}
                                                        opciones={cat.plantillas.map(p => ({ value: p.PlaId, label: p.Nombre }))} />
                                                </div>
                                                {d.pasos?.length > 0 ? (
                                                    <div className="relative">
                                                        {(() => {
                                                            const iAct = d.pasos.findIndex(p => String(p.Clave) === String(c.Progreso));
                                                            return d.pasos.map((p, i) => {
                                                                const hecho = iAct >= 0 && i < iAct;
                                                                const actual = i === iAct;
                                                                const Ico = ICONOS_PASO[p.Icono] || CircleDot;
                                                                const ultimo = i === d.pasos.length - 1;
                                                                return (
                                                                    <button key={p.Clave} onClick={() => avanzar(c, p.Clave)}
                                                                        title={hecho ? 'Etapa cumplida — click para volver acá' : actual ? 'Etapa actual' : 'Marcar esta etapa'}
                                                                        className="group relative flex items-start gap-3 w-full text-left pb-4 last:pb-0">
                                                                        {/* línea que une los pasos */}
                                                                        {!ultimo && (
                                                                            <span className={`absolute left-[9px] top-5 bottom-0 w-px ${hecho ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                                                                        )}
                                                                        <span className={`relative z-10 w-[19px] h-[19px] rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${
                                                                            hecho ? 'bg-emerald-500 border-emerald-500'
                                                                            : actual ? 'bg-sky-500 border-sky-500 ring-4 ring-sky-100'
                                                                            : 'bg-white border-slate-300 group-hover:border-sky-400'}`}>
                                                                            {hecho && <Check size={11} className="text-white" strokeWidth={3.5} />}
                                                                        </span>
                                                                        <Ico size={15} className={`shrink-0 mt-0.5 ${hecho ? 'text-emerald-600' : actual ? 'text-sky-600' : 'text-slate-300'}`} />
                                                                        <span className={`text-[12px] font-black leading-tight ${
                                                                            hecho ? 'text-emerald-700' : actual ? 'text-slate-800' : 'text-slate-400 group-hover:text-slate-600'}`}>
                                                                            {p.Etiqueta}
                                                                        </span>
                                                                    </button>
                                                                );
                                                            });
                                                        })()}
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-slate-400">Sin tipo de seguimiento asignado — elegí uno arriba.</p>
                                                )}
                                            </div>
                                            </div>

                                            {/* Costos adicionales: aduana, flete, despachante... */}
                                            <div ref={refCostos} className="rounded-xl border border-slate-200 p-3">
                                                <div className="flex items-center justify-between gap-3 mb-2">
                                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Costos adicionales (aduana, transporte…)</p>
                                                    {Number(c.GastosExtras) > 0 && (
                                                        <span className="text-[11px] font-black text-slate-500">
                                                            extras {simbolo(c)} {Number(c.GastosExtras).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                                        </span>
                                                    )}
                                                </div>
                                                {(d.costos || []).length > 0 && (
                                                    <div className="divide-y divide-slate-50 mb-2">
                                                        {d.costos.map(x => (
                                                            <div key={x.CceId} className="flex items-center gap-3 py-1.5">
                                                                <span className="text-xs font-bold text-slate-600 flex-1 truncate">{x.Descripcion}</span>
                                                                <span className="text-sm font-black text-slate-800 tabular-nums font-gsanscode">{simbolo(c)} {Number(x.Monto).toLocaleString('es-UY', { maximumFractionDigits: 2 })}</span>
                                                                <button onClick={() => quitarCosto(c, x.CceId)}
                                                                    className="w-6 h-6 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 flex items-center justify-center"><Trash2 size={11} /></button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <input value={costoDesc} onChange={e => setCostoDesc(e.target.value)} placeholder="Concepto (aduana, flete, despachante...)"
                                                        className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                    <input type="number" value={costoMonto} onChange={e => setCostoMonto(e.target.value)} placeholder="Monto"
                                                        className="w-32 px-3 py-2 rounded-xl border border-slate-200 text-sm text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                    <button onClick={() => agregarCosto(c)} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-black">Agregar costo</button>
                                                </div>
                                                <p className="text-[10px] text-slate-400 font-semibold mt-2">
                                                    Los costos extra se reparten entre los artículos según cuánto pesa cada uno en la compra: la etiqueta que nace al recibir ya lleva el costo real puesto en depósito.
                                                </p>
                                            </div>

                                            {/* Pagos */}
                                            <div className="rounded-xl border border-slate-200 p-3">
                                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Pagos</p>
                                                {d.pagos.length > 0 && (
                                                    <div className="divide-y divide-slate-50 mb-2">
                                                        {d.pagos.map(p => (
                                                            <div key={p.PagId} className="flex items-center gap-3 py-1.5">
                                                                <span className="text-[11px] text-slate-400 font-semibold w-20">{fmtFecha(p.Fecha)}</span>
                                                                <span className="text-xs font-bold text-slate-600 flex-1 truncate">{p.TipoPago || p.Motivo || 'Pago'}</span>
                                                                <span className="text-sm font-black text-slate-800 tabular-nums font-gsanscode">{simbolo(c)} {Number(p.Monto).toLocaleString('es-UY', { maximumFractionDigits: 2 })}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <input type="number" placeholder="Monto" value={pagoMonto} onChange={e => setPagoMonto(e.target.value)}
                                                        className="w-32 px-3 py-2 rounded-xl border border-slate-200 text-sm text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                    <Selector value={pagoMotivo} onChange={setPagoMotivo} placeholder="Motivo..."
                                                        opciones={cat.motivos.map(m => ({ value: m.Nombre, label: m.Nombre }))} />
                                                    <button onClick={() => pagar(c)} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-black">Registrar pago</button>
                                                </div>
                                            </div>

                                            {/* Adjuntos: facturas, BL, despachos... */}
                                            <div className="rounded-xl border border-slate-200 p-3">
                                                <div className="flex items-center justify-between gap-3 mb-2">
                                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                                        <Paperclip size={12} /> Documentos de la compra
                                                        <span className="normal-case tracking-normal font-bold text-slate-300 ml-1" title="Carpeta en el servidor donde se guardan estos archivos">
                                                            · carpeta <span className="font-mono">compras/{c.CompId}</span>
                                                        </span>
                                                    </p>
                                                    <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer ${subiendo ? 'bg-slate-100 text-slate-400' : 'bg-sky-600 hover:bg-sky-700 text-white'}`}>
                                                        {subiendo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                                                        {subiendo ? 'Subiendo...' : 'Adjuntar'}
                                                        <input type="file" className="hidden outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" disabled={subiendo}
                                                            accept=".pdf,.jpg,.jpeg,.png,.webp,.xml,.zip,.doc,.docx,.xls,.xlsx"
                                                            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; subirArchivo(c.CompId, f); }} />
                                                    </label>
                                                </div>
                                                {(archivos[c.CompId] || []).length === 0 ? (
                                                    <p className="text-xs text-slate-400 py-3 text-center">Sin documentos adjuntos (facturas, BL, despachos...).</p>
                                                ) : (
                                                    <div className="divide-y divide-slate-50">
                                                        {(archivos[c.CompId] || []).map(a => (
                                                            <div key={a.CarId} className="flex items-center gap-3 py-2">
                                                                <FileText size={15} className="text-slate-300 shrink-0" />
                                                                <a href={`/stock-compras/${c.CompId}/${a.Archivo}`} target="_blank" rel="noreferrer"
                                                                    className="text-sm font-bold text-sky-700 hover:underline truncate flex-1">
                                                                    {a.NombreOriginal}
                                                                </a>
                                                                <span className="text-[10px] text-slate-400 font-semibold shrink-0">
                                                                    {a.Tamano ? `${(a.Tamano / 1024 / 1024).toFixed(1)} MB` : ''} · {fmtFecha(a.FechaSubida)}
                                                                </span>
                                                                <button onClick={() => borrarArchivo(c.CompId, a.CarId)} title="Eliminar"
                                                                    className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 flex items-center justify-center shrink-0">
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </>)}
                            </div>
                        </div>
                    </div>
                ), document.body);
            })()}
        </div>
    );
}

/* ── IMPORTACIONES (expedientes que agrupan compras) ─────────────────────── */
function PanelImportaciones({ cat }) {
    const [lista, setLista] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [abierta, setAbierta] = useState(null);
    const [det, setDet] = useState({});
    const [creando, setCreando] = useState(false);
    const [nuevo, setNuevo] = useState({ origen: '', empresaImportadora: '', contactoImportadora: '', empresaTransporteLocal: '', contactoTransporteLocal: '', plaId: '' });

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const r = await api.get('/wms-interno/importaciones');
            setLista(r.data?.data || []);
        } catch (e) { toast.error('No se pudieron cargar las importaciones'); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const verDetalle = async (id) => {
        setAbierta(abierta === id ? null : id);
        if (abierta === id) return;
        try {
            const r = await api.get(`/wms-interno/importaciones/${id}`);
            setDet(prev => ({ ...prev, [id]: r.data?.data }));
        } catch (e) { toast.error('No se pudo cargar el expediente'); }
    };
    const avanzar = async (imp, clave) => {
        try { await api.post(`/wms-interno/importaciones/${imp.ImpId}/progreso`, { clave }); cargar(); }
        catch (e) { toast.error('No se pudo cambiar la etapa'); }
    };
    const crear = async () => {
        if (!nuevo.origen.trim()) return toast.error('Escribí el origen (país, puerto...)');
        try {
            await api.post('/wms-interno/importaciones', nuevo);
            toast.success('Importación creada');
            setCreando(false);
            setNuevo({ origen: '', empresaImportadora: '', contactoImportadora: '', empresaTransporteLocal: '', contactoTransporteLocal: '', plaId: '' });
            cargar();
        } catch (e) { toast.error('No se pudo crear'); }
    };

    return (
        <div>
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex-1 min-w-[220px]">
                    <h3 className="text-lg font-black text-slate-800">Importaciones consolidadas</h3>
                    <p className="text-xs text-slate-500">Expedientes logísticos que agrupan varias compras.</p>
                </div>
                <button onClick={() => setCreando(c => !c)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-black">
                    <Plus size={15} /> Crear importación
                </button>
            </div>

            {creando && (
                <div className="bg-white rounded-2xl border border-sky-200 p-5 mb-4 space-y-3">
                    <div className="grid md:grid-cols-3 gap-3">
                        <input value={nuevo.origen} onChange={e => setNuevo(x => ({ ...x, origen: e.target.value }))}
                            placeholder="Origen (China, Brasil...)" className="px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                        <input value={nuevo.empresaImportadora} onChange={e => setNuevo(x => ({ ...x, empresaImportadora: e.target.value }))}
                            placeholder="Empresa importadora" className="px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                        <input value={nuevo.contactoImportadora} onChange={e => setNuevo(x => ({ ...x, contactoImportadora: e.target.value }))}
                            placeholder="Contacto importadora" className="px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                        <input value={nuevo.empresaTransporteLocal} onChange={e => setNuevo(x => ({ ...x, empresaTransporteLocal: e.target.value }))}
                            placeholder="Transporte local" className="px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                        <input value={nuevo.contactoTransporteLocal} onChange={e => setNuevo(x => ({ ...x, contactoTransporteLocal: e.target.value }))}
                            placeholder="Contacto transporte" className="px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                        <Selector value={nuevo.plaId} placeholder="Tipo de seguimiento..."
                            onChange={(v) => setNuevo(x => ({ ...x, plaId: v }))}
                            opciones={cat.plantillas.map(p => ({ value: p.PlaId, label: p.Nombre }))} />
                    </div>
                    <button onClick={crear} className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black">Crear importación</button>
                </div>
            )}

            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : lista.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">Sin importaciones.</div>
            ) : (
                <div className="space-y-3">
                    {lista.map(imp => {
                        const d = det[imp.ImpId];
                        const avance = imp.TotalPasos > 0 ? Math.round((Number(imp.ProgresoOrden || 0) / Number(imp.TotalPasos)) * 100) : 0;
                        return (
                            <div key={imp.ImpId} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                                <button onClick={() => verDetalle(imp.ImpId)} className="w-full text-left p-5 hover:bg-slate-50/60">
                                    <div className="flex flex-wrap items-start gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0">
                                            <Ship size={22} className="text-slate-400" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-lg font-black text-slate-800 uppercase">{imp.Origen}</p>
                                                <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                                                    {(imp.Estado || '').replace('_', ' ')}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-[11px]">
                                                <span className="text-slate-400 font-bold">Importador: <span className="text-slate-600">{imp.EmpresaImportadora || '—'}</span></span>
                                                <span className="text-slate-400 font-bold">Transporte local: <span className="text-slate-600">{imp.EmpresaTransporteLocal || '—'}</span></span>
                                            </div>
                                            <div className="mt-3 max-w-md">
                                                <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
                                                    <span>Seguimiento</span><span>{imp.ProgresoEtiqueta || imp.Progreso || '—'}</span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                                    <div className="h-full rounded-full bg-brand-cyan" style={{ width: `${avance}%` }} />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Compras contenidas</p>
                                            <p className="text-3xl font-black text-slate-800 tabular-nums font-gsanscode">{imp.Compras}</p>
                                            <p className="text-xs font-black text-slate-600 tabular-nums font-gsanscode mt-1">
                                                US$ {Number(imp.TotalCompras).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                            </p>
                                        </div>
                                    </div>
                                </button>

                                {abierta === imp.ImpId && d && (
                                    <div className="border-t border-slate-100 p-5 space-y-4">
                                        <div className="flex flex-wrap gap-1.5">
                                            {(() => {
                                                const iAct = d.pasos.findIndex(p => String(p.Clave) === String(imp.Progreso));
                                                return d.pasos.map((p, i) => {
                                                    const hecho = iAct >= 0 && i < iAct;
                                                    const actual = i === iAct;
                                                    const Ico = ICONOS_PASO[p.Icono] || CircleDot;
                                                    return (
                                                        <button key={p.Clave} onClick={() => avanzar(imp, p.Clave)}
                                                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black border transition-colors ${
                                                                actual ? 'bg-sky-600 text-white border-sky-600'
                                                                : hecho ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'}`}>
                                                            <Ico size={13} /> {p.Etiqueta}
                                                        </button>
                                                    );
                                                });
                                            })()}
                                        </div>

                                        <div className="rounded-xl border border-slate-200 divide-y divide-slate-50">
                                            <p className="px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Compras del expediente</p>
                                            {d.compras.length === 0 ? (
                                                <p className="px-4 py-6 text-center text-xs text-slate-400">Todavía no hay compras asociadas.</p>
                                            ) : d.compras.map(c => (
                                                <div key={c.CompId} className="flex items-center gap-3 px-4 py-2.5">
                                                    <span className="text-xs font-black text-slate-300 w-12 font-gsanscode">#{c.CompId}</span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-bold text-slate-700 truncate">{c.Proveedor || 'Sin proveedor'}</p>
                                                        <p className="text-[10px] text-slate-400 font-semibold">{c.ReferenciaFactura ? `Ref: ${c.ReferenciaFactura}` : ''}</p>
                                                    </div>
                                                    <span className="text-[10px] font-black text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{c.ProgresoEtiqueta || c.Progreso}</span>
                                                    <span className="text-sm font-black text-slate-800 tabular-nums font-gsanscode">
                                                        {simMoneda(c.Moneda)} {Number(c.TotalCompra).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>

                                        {d.pagos.length > 0 && (
                                            <div className="rounded-xl border border-slate-200 p-3">
                                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Pagos del expediente</p>
                                                <div className="divide-y divide-slate-50">
                                                    {d.pagos.map(p => (
                                                        <div key={p.PagId} className="flex items-center gap-3 py-1.5">
                                                            <span className="text-[11px] text-slate-400 font-semibold w-20 font-gsanscode">{fmtFecha(p.Fecha)}</span>
                                                            <span className="text-xs font-bold text-slate-600 flex-1 truncate">{p.TipoPago || p.Motivo || 'Pago'}</span>
                                                            <span className="text-sm font-black text-slate-800 tabular-nums font-gsanscode">
                                                                US$ {Number(p.Monto).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ── HISTORIAL (trazabilidad: ledger nuevo + histórico del sistema anterior) ── */
const ETIQUETA_TIPO = {
    traslado_salida: ['Traslado (salida)', 'text-sky-700 bg-sky-50 border-sky-200'],
    traslado_entrada: ['Traslado (entrada)', 'text-sky-700 bg-sky-50 border-sky-200'],
    ingreso: ['Ingreso', 'text-emerald-700 bg-emerald-50 border-emerald-200'],
    ingreso_compra: ['Ingreso compra', 'text-emerald-700 bg-emerald-50 border-emerald-200'],
    apertura_migracion: ['Apertura', 'text-slate-500 bg-slate-50 border-slate-200'],
    egreso_venta_web: ['Egreso venta', 'text-rose-700 bg-rose-50 border-rose-200'],
    baja_consumo: ['Baja consumo', 'text-rose-700 bg-rose-50 border-rose-200'],
    egreso_final: ['Egreso', 'text-rose-700 bg-rose-50 border-rose-200'],
    egreso_auto: ['Egreso auto', 'text-rose-700 bg-rose-50 border-rose-200'],
    ajuste_conteo: ['Ajuste conteo', 'text-amber-700 bg-amber-50 border-amber-200'],
    anulacion: ['Anulación', 'text-amber-700 bg-amber-50 border-amber-200'],
    // tipos del sistema anterior (vienen del histórico migrado)
    recepcion_confirmada: ['Recepción remito', 'text-sky-700 bg-sky-50 border-sky-200'],
    ingreso_auditoria_libre: ['Ingreso auditoría', 'text-emerald-700 bg-emerald-50 border-emerald-200'],
    fraccionamiento_ingreso: ['Fraccionamiento (+)', 'text-slate-600 bg-slate-50 border-slate-200'],
    fraccionamiento_salida: ['Fraccionamiento (−)', 'text-slate-600 bg-slate-50 border-slate-200'],
};

function TabHistorial() {
    const [grupo, setGrupo] = useState('');
    const [q, setQ] = useState('');
    const [fecha, setFecha] = useState('');
    const [filas, setFilas] = useState([]);
    const [pagina, setPagina] = useState(0);
    const [hayMas, setHayMas] = useState(false);
    const [cargando, setCargando] = useState(true);
    const [verRemito, setVerRemito] = useState(null);   // RemId de la hoja abierta
    const timer = useRef(null);

    const cargar = useCallback(async (pag = 0, append = false) => {
        setCargando(true);
        try {
            const params = new URLSearchParams({ grupo, q: q.trim(), fecha, pagina: String(pag) });
            const r = await api.get(`/wms-interno/historial?${params}`);
            const data = r.data?.data || [];
            setFilas(prev => append ? [...prev, ...data] : data);
            setHayMas(data.length === (r.data?.pageSize || 60));
            setPagina(pag);
        } catch (e) { toast.error('No se pudo cargar el historial'); }
        finally { setCargando(false); }
    }, [grupo, q, fecha]);

    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => cargar(0, false), q ? 350 : 0);
        return () => clearTimeout(timer.current);
    }, [cargar]);

    const fmtHora = (v) => v ? new Date(v).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

    return (
        <div>
            {verRemito && <ModalRemito remId={verRemito} onCerrar={() => setVerRemito(null)} />}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                {[['', 'Todos'], ['TRASLADOS', 'Traslados'], ['INGRESOS', 'Ingresos'], ['EGRESOS', 'Egresos / Bajas'], ['AJUSTES', 'Ajustes']].map(([v, l]) => (
                    <button key={v} onClick={() => setGrupo(v)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-black ${grupo === v ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
                ))}
                <div className="flex-1" />
                <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={q} onChange={e => setQ(e.target.value)}
                        placeholder="Producto, variante, # etiqueta o remito..."
                        className="w-72 pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
                </div>
                <SelectorFecha value={fecha} onChange={setFecha} />
                {fecha && (
                    <button onClick={() => setFecha('')} title="Quitar el filtro de fecha"
                        className="w-9 h-9 shrink-0 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center transition-colors">
                        <CalendarOff size={15} />
                    </button>
                )}
            </div>

            {cargando && pagina === 0 ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : filas.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">Sin movimientos con esos filtros.</div>
            ) : (
                <>
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="hidden md:grid grid-cols-[110px_130px_1fr_90px_170px_120px] gap-2 px-4 py-2 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                            <span>Fecha</span><span>Tipo</span><span>Artículo</span><span className="text-right">Cantidad</span><span>Depósitos</span><span>Ref</span>
                        </div>
                        <div className="divide-y divide-slate-50">
                            {filas.map((f, i) => {
                                const [label, css] = ETIQUETA_TIPO[f.Tipo] || [f.Tipo, 'text-slate-500 bg-slate-50 border-slate-200'];
                                const cant = Number(f.Cantidad || 0);
                                return (
                                    <div key={i} className="grid md:grid-cols-[110px_130px_1fr_90px_170px_120px] grid-cols-2 gap-2 px-4 py-2.5 items-center">
                                        <span className="text-[11px] text-slate-500 font-semibold tabular-nums font-gsanscode">{fmtHora(f.Fecha)}</span>
                                        <span><span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${css}`}>{label}</span></span>
                                        <div className="min-w-0 col-span-2 md:col-span-1">
                                            <p className="text-sm font-bold text-slate-700 truncate">{f.Producto || '—'}{f.NombreVariante ? ` — ${f.NombreVariante}` : ''}</p>
                                            <p className="text-[10px] text-slate-400 font-semibold">
                                                #{f.EtiId}{(f.Talle || f.Color) ? ` · ${[f.Talle, f.Color].filter(Boolean).join(' · ')}` : ''}
                                                {f.Fuente === 'HISTORICO' && <span className="ml-2 text-slate-300">sistema anterior{f.UsuarioTexto ? ` · ${f.UsuarioTexto}` : ''}</span>}
                                            </p>
                                        </div>
                                        <span className={`text-sm text-right font-black tabular-nums font-gsanscode ${cant < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                            {cant > 0 ? '+' : ''}{fmtCant(cant)}
                                        </span>
                                        <span className="text-[11px] text-slate-500 font-semibold truncate">
                                            {f.DepOrigen || ''}{f.DepOrigen && f.DepDestino ? ' → ' : ''}{f.DepDestino || ''}
                                        </span>
                                        {/* El remito se muestra con su código y abre la hoja del envío */}
                                        {f.RefTipo === 'REMITO' && f.RefId ? (
                                            <button onClick={() => setVerRemito(f.RefId)} title="Ver la hoja del remito"
                                                className="text-[10px] font-bold text-sky-600 hover:text-sky-700 hover:underline font-mono truncate text-left">
                                                {f.RefNumero || `REMITO ${f.RefId}`}
                                            </button>
                                        ) : (
                                            <span className="text-[10px] font-bold text-slate-400 font-mono truncate">
                                                {f.RefTipo ? `${f.RefTipo} ${f.RefId ?? ''}` : ''}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {hayMas && (
                        <div className="flex justify-center mt-3">
                            <button onClick={() => cargar(pagina + 1, true)} disabled={cargando}
                                className="px-5 py-2 rounded-xl bg-white border border-slate-200 text-sm font-black text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                                {cargando ? 'Cargando...' : 'Cargar más'}
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/* ── DIFERENCIAS ─────────────────────────────────────────────────────────── */
function TabDiferencias({ onCambio }) {
    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [resolviendo, setResolviendo] = useState(null);
    const [nota, setNota] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const r = await api.get('/wms-interno/discrepancias?estado=PENDIENTE');
            const data = r.data?.data || [];
            setFilas(data);
            onCambio?.(data.length);
        } catch (e) { toast.error('No se pudieron cargar las diferencias'); }
        finally { setCargando(false); }
    }, [onCambio]);
    useEffect(() => { cargar(); }, [cargar]);

    const resolver = async (d) => {
        if (!nota.trim()) return toast.error('Contá qué se hizo (se contó, se ajustó, se encontró...)');
        try {
            await api.post(`/wms-interno/discrepancias/${d.DisId}/resolver`, { resolucion: nota.trim() });
            toast.success('Diferencia resuelta');
            setResolviendo(null); setNota('');
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo resolver'); }
    };

    return (
        <div>
            <p className="text-sm text-slate-500 mb-4">
                Cada vez que una venta o un traslado encuentra <b>menos stock del que el sistema esperaba</b>, la
                diferencia queda acá hasta que alguien la investigue (contar la variante, ajustar, o encontrar el faltante).
            </p>
            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : filas.length === 0 ? (
                <div className="text-center py-16 text-emerald-600 text-sm font-bold">✓ Sin diferencias pendientes</div>
            ) : (
                <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                    {filas.map(d => (
                        <div key={d.DisId} className="px-4 py-3">
                            <div className="flex items-center gap-3 flex-wrap">
                                <AlertTriangle size={15} className="text-amber-500 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-slate-700 truncate">{d.Producto} — {d.NombreVariante} {[d.Talle, d.Color].filter(Boolean).join(' · ')}</p>
                                    <p className="text-[11px] text-slate-400">
                                        {d.Deposito || `Dep ${d.DepId}`} · {fmtFecha(d.Fecha)}
                                        {d.RefTipo && <span className="ml-2 font-mono">{d.RefTipo} {d.RefId}</span>}
                                    </p>
                                </div>
                                <span className="text-sm font-black text-rose-600 tabular-nums font-gsanscode">faltan {fmtCant(d.Faltante)}</span>
                                {resolviendo === d.DisId ? (
                                    <div className="flex items-center gap-1.5 w-full sm:w-auto mt-1 sm:mt-0">
                                        <input autoFocus value={nota} onChange={e => setNota(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') resolver(d); if (e.key === 'Escape') setResolviendo(null); }}
                                            placeholder="Qué se hizo / se encontró..."
                                            className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-lg border border-sky-300 text-sm focus:outline-none" />
                                        <button onClick={() => resolver(d)} className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center"><Check size={13} /></button>
                                        <button onClick={() => setResolviendo(null)} className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 flex items-center justify-center"><X size={12} /></button>
                                    </div>
                                ) : (
                                    <button onClick={() => { setResolviendo(d.DisId); setNota(''); }}
                                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-black text-slate-500 hover:bg-slate-50">Resolver</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── GESTIÓN DE SISTEMA ────────────────────────────────────────────────────
 * Los maestros que sin esta pantalla habría que seguir tocando en el sistema
 * anterior. Cuatro por ahora; el resto (artículos, variantes, familias, monedas,
 * usuarios) se resuelve con lo que el sistema ya tiene.
 */
function TabGestion({ depositos = [] }) {
    const [sub, setSub] = useState(null);
    const fichas = [
        { id: 'limites',    titulo: 'Alertas de stock', desc: 'Los límites crítico, de alerta e ideal de cada artículo. Son los que encienden el panel.', icono: AlertTriangle, tono: 'rose' },
        { id: 'proveedores', titulo: 'Proveedores',     desc: 'Directorio de importadores y proveedores de plaza.', icono: Truck, tono: 'sky' },
        { id: 'depositos',   titulo: 'Almacenes y sectores', desc: 'Locaciones físicas o lógicas donde vive el stock.', icono: MapPin, tono: 'indigo' },
        { id: 'plantillas',  titulo: 'Plantillas de progreso', desc: 'Las etapas por las que pasa una compra o una importación.', icono: Workflow, tono: 'amber' },
    ];
    const TONOS = {
        rose: 'bg-rose-50 text-rose-500', sky: 'bg-sky-50 text-sky-600',
        indigo: 'bg-indigo-50 text-indigo-600', amber: 'bg-amber-50 text-amber-600',
    };

    if (sub) {
        const f = fichas.find(x => x.id === sub);
        return (
            <div className="space-y-4">
                <button onClick={() => setSub(null)} className="flex items-center gap-1.5 text-xs font-black text-slate-400 hover:text-slate-600">
                    <ChevronLeft size={14} /> Volver a Gestión de Sistema
                </button>
                <h3 className="text-xl font-black text-slate-800">{f.titulo}</h3>
                {sub === 'limites' && <GestionLimites depositos={depositos} />}
                {sub === 'proveedores' && <GestionProveedores />}
                {sub === 'depositos' && <GestionDepositos />}
                {sub === 'plantillas' && <GestionPlantillas />}
            </div>
        );
    }

    return (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {fichas.map(f => (
                <button key={f.id} onClick={() => setSub(f.id)}
                    className="bg-white rounded-2xl border border-slate-200 hover:border-sky-300 hover:shadow-md transition-all p-5 text-left">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${TONOS[f.tono]}`}>
                        <f.icono size={22} />
                    </div>
                    <p className="text-lg font-black text-slate-800 leading-tight">{f.titulo}</p>
                    <p className="text-xs text-slate-500 mt-1.5 leading-snug">{f.desc}</p>
                </button>
            ))}
        </div>
    );
}

/* Elegir artículos navegando el catálogo: familia → maestro → variantes.
 * El buscador de arriba saltea los niveles; las carpetas son para cuando no te
 * acordás el nombre, que es el caso real al configurar alertas por rubro.
 */
function ModalCatalogo({ elegidos, onToggle, onCerrar }) {
    const [ruta, setRuta] = useState([]);          // [{tipo, id, nombre}]
    const [items, setItems] = useState([]);
    const [nivel, setNivel] = useState('familias');
    const [cargando, setCargando] = useState(true);
    const [q, setQ] = useState('');
    const [resBusq, setResBusq] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const timer = useRef(null);

    const cargar = useCallback(async (cat, pma) => {
        setCargando(true);
        try {
            const p = pma ? `?pma=${pma}` : cat ? `?cat=${cat}` : '';
            const r = await api.get(`/wms-interno/gestion/catalogo${p}`);
            setItems(r.data?.data || []); setNivel(r.data?.nivel || 'familias');
        } catch (e) { toast.error('No se pudo cargar el catálogo'); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    // Búsqueda directa: pasa por encima de la navegación
    useEffect(() => {
        clearTimeout(timer.current);
        if (q.trim().length < 2) { setResBusq([]); setBuscando(false); return; }
        setBuscando(true);
        timer.current = setTimeout(async () => {
            try { setResBusq((await api.get(`/wms-interno/variantes?q=${encodeURIComponent(q.trim())}`)).data?.data || []); }
            catch (e) { setResBusq([]); }
            finally { setBuscando(false); }
        }, 300);
        return () => clearTimeout(timer.current);
    }, [q]);

    const entrar = (item) => {
        if (nivel === 'familias') { setRuta([{ tipo: 'cat', id: item.CatId, nombre: item.Nombre }]); cargar(item.CatId); }
        else if (nivel === 'maestros') { setRuta(r => [...r, { tipo: 'pma', id: item.PmaId, nombre: item.Nombre }]); cargar(null, item.PmaId); }
    };
    const volverA = (i) => {
        const nueva = ruta.slice(0, i + 1);
        setRuta(nueva);
        if (!nueva.length) cargar();
        else if (nueva.length === 1) cargar(nueva[0].id);
        else cargar(null, nueva[1].id);
    };

    const puesto = (varId) => elegidos.some(e => e.VarId === varId);
    const lista = q.trim().length >= 2 ? resBusq : items;
    const enVariantes = q.trim().length >= 2 || nivel === 'variantes';

    return createPortal(
        <div className="fixed inset-0 z-[6000] flex items-start justify-center p-4 overflow-y-auto bg-slate-900/70" onClick={onCerrar}>
            <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-8 overflow-hidden">
                <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-100">
                    <div>
                        <h3 className="text-lg font-black text-slate-800">Elegir artículos</h3>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
                            {enVariantes ? 'Tocá un artículo para agregarlo' : 'Elegí una familia'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {elegidos.length > 0 && (
                            <span className="text-[11px] font-black text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-3 py-1.5">
                                {elegidos.length} elegido{elegidos.length !== 1 ? 's' : ''}
                            </span>
                        )}
                        <button onClick={onCerrar} className="w-9 h-9 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center"><X size={16} /></button>
                    </div>
                </div>

                <div className="px-6 py-4 space-y-4">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cualquier artículo directamente..."
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
                        {buscando && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 animate-spin" />}
                    </div>

                    {q.trim().length < 2 && ruta.length > 0 && (
                        <div className="flex items-center gap-1 text-xs font-black text-slate-400">
                            <button onClick={() => volverA(-1)} className="hover:text-slate-600">Catálogo</button>
                            {ruta.map((r, i) => (
                                <React.Fragment key={r.id}>
                                    <ChevronRight size={12} className="text-slate-300" />
                                    <button onClick={() => volverA(i)} className={i === ruta.length - 1 ? 'text-slate-700' : 'hover:text-slate-600'}>{r.nombre}</button>
                                </React.Fragment>
                            ))}
                        </div>
                    )}

                    {cargando ? (
                        <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
                    ) : lista.length === 0 ? (
                        <div className="text-center py-16 text-slate-400 text-sm">
                            {q.trim().length >= 2 ? `Ningún artículo coincide con “${q.trim()}”.` : 'Esta familia no tiene artículos.'}
                        </div>
                    ) : enVariantes ? (
                        <div className="rounded-xl border border-slate-200 divide-y divide-slate-50 max-h-[45vh] overflow-y-auto">
                            {lista.map(v => {
                                const ya = puesto(v.VarId);
                                return (
                                    <button key={v.VarId} onClick={() => onToggle(v)}
                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${ya ? 'bg-sky-50/60' : 'hover:bg-slate-50'}`}>
                                        <div className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${ya ? 'bg-brand-cyan border-brand-cyan' : 'border-slate-300'}`}>
                                            {ya && <Check size={12} className="text-white" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-700 truncate">{v.Producto}</p>
                                            <p className="text-[11px] text-slate-400 truncate">
                                                {v.NombreVariante}
                                                {[v.Talle, v.Color].filter(Boolean).length > 0 && ` · ${[v.Talle, v.Color].filter(Boolean).join(' · ')}`}
                                            </p>
                                        </div>
                                        {Number(v.CantidadCritica) > 0 && (
                                            <span className="text-[9px] font-black uppercase text-slate-400 bg-slate-100 rounded-full px-2 py-0.5 shrink-0">ya tiene límite</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 max-h-[45vh] overflow-y-auto">
                            {lista.map(it => {
                                const esFam = nivel === 'familias';
                                const n = esFam ? it.Maestros : it.Variantes;
                                return (
                                    <button key={esFam ? it.CatId : it.PmaId} onClick={() => entrar(it)} disabled={n === 0}
                                        className="bg-white rounded-2xl border border-slate-200 hover:border-sky-300 hover:shadow-md transition-all p-4 flex flex-col items-center gap-2 text-center disabled:opacity-40 disabled:hover:border-slate-200">
                                        <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center">
                                            {esFam ? <Layers size={20} /> : <Package size={20} />}
                                        </div>
                                        <p className="text-xs font-black text-slate-800 uppercase leading-tight">{it.Nombre}</p>
                                        <span className="text-[10px] font-bold text-slate-400">
                                            {n} {esFam ? 'artículo' : 'variante'}{n !== 1 ? 's' : ''}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                    <button onClick={onCerrar} className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black">
                        Listo{elegidos.length > 0 && ` (${elegidos.length})`}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

/* Límites de stock — lo que enciende el panel de alertas.
 * Dos modos, como el sistema anterior: CONFIGURAR (elegir varios artículos y
 * ponerles el mismo umbral de una) y GESTIONAR (la lista de los que ya tienen).
 * El "entorno" decide dónde se guarda: global en la variante, o por almacén en
 * Wms_AlertasDepositos — un almacén sin fila no tiene mínimo propio.
 */
function GestionLimites({ depositos = [] }) {
    const [modo, setModo] = useState('config');
    const [entorno, setEntorno] = useState(0);        // 0 = general (todos los almacenes)
    const [filas, setFilas] = useState([]);
    const [q, setQ] = useState('');
    const [soloConLimite, setSoloConLimite] = useState(true);
    const [cargando, setCargando] = useState(true);
    const [edit, setEdit] = useState(null);
    const [vals, setVals] = useState({ critica: '', alerta: '', ideal: '' });
    // configuración en lote
    const [elegidos, setElegidos] = useState([]);
    const [lote, setLote] = useState({ alerta: '', critica: '' });
    // vista agrupada: las COMBINACIONES de umbral en uso (las "políticas")
    const [catalogoAbierto, setCatalogoAbierto] = useState(false);
    const [vista, setVista] = useState('agrupada');   // agrupada | lista
    const [combos, setCombos] = useState([]);
    const [combo, setCombo] = useState(null);         // {Alerta, Critica} al abrir una tarjeta
    const [guardando, setGuardando] = useState(false);
    const timer = useRef(null);

    const nombreEntorno = entorno === 0 ? 'todos los almacenes' : (depositos.find(d => d.DepId === entorno)?.Nombre || `Dep ${entorno}`);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const filtro = combo ? `&alerta=${combo.Alerta}&critica=${combo.Critica}` : '';
            const r = await api.get(`/wms-interno/gestion/limites?q=${encodeURIComponent(q.trim())}&conLimite=${soloConLimite ? 1 : 0}&dep=${entorno}${filtro}`);
            setFilas(r.data?.data || []);
        } catch (e) { toast.error('No se pudieron cargar los límites'); }
        finally { setCargando(false); }
    }, [q, soloConLimite, entorno, combo]);

    // Las combinaciones se agrupan en el servidor: el conteo no depende de cuántas
    // filas se hayan traído a la pantalla.
    useEffect(() => {
        if (modo !== 'gestion') return;
        api.get(`/wms-interno/gestion/limites-agrupados?dep=${entorno}`)
            .then(r => setCombos(r.data?.data || [])).catch(() => setCombos([]));
    }, [entorno, modo, filas]);
    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(cargar, q ? 300 : 0);
        return () => clearTimeout(timer.current);
    }, [cargar, q]);

    const guardar = async (v) => {
        try {
            await api.put(`/wms-interno/gestion/limites/${v.VarId}`, { ...vals, depId: entorno });
            toast.success(`Límites de ${v.NombreVariante} actualizados`);
            setEdit(null); cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo guardar'); }
    };

    const aplicarLote = async () => {
        if (!elegidos.length) return toast.error('Elegí al menos un artículo');
        setGuardando(true);
        try {
            const r = await api.put('/wms-interno/gestion/limites-lote', {
                varIds: elegidos.map(e => e.VarId), depId: entorno,
                critica: lote.critica || 0, alerta: lote.alerta || 0, ideal: 0,
            });
            const n = r.data?.aplicados || 0;
            toast.success(`Límites aplicados a ${n} artículo${n !== 1 ? 's' : ''} en ${nombreEntorno}`);
            setElegidos([]); setLote({ alerta: '', critica: '' });
            if (modo === 'gestion') cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudieron aplicar'); }
        finally { setGuardando(false); }
    };

    const Entornos = () => (
        <div>
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                <Layers size={12} /> Seleccionar entorno
            </p>
            <div className="flex flex-wrap gap-2">
                {[{ DepId: 0, Nombre: 'General' }, ...depositos].map(d => (
                    <button key={d.DepId} onClick={() => { setEntorno(d.DepId); setCombo(null); }}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black transition-colors ${
                            entorno === d.DepId ? 'bg-brand-cyan text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        {d.Nombre}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {catalogoAbierto && (
                <ModalCatalogo elegidos={elegidos} onCerrar={() => setCatalogoAbierto(false)}
                    onToggle={(v) => setElegidos(p => p.some(x => x.VarId === v.VarId) ? p.filter(x => x.VarId !== v.VarId) : [...p, v])} />
            )}
            <div className="flex flex-wrap gap-1.5">
                {[['config', 'Configuración', Settings], ['gestion', 'Gestión de alertas', Layers]].map(([v, l, Ico]) => (
                    <button key={v} onClick={() => setModo(v)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-black transition-colors ${modo === v ? 'bg-white border border-slate-200 text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        <Ico size={15} /> {l}
                        {v === 'gestion' && filas.length > 0 && <span className="text-[10px] bg-slate-100 text-slate-500 rounded-full px-1.5 font-black">{filas.length}</span>}
                    </button>
                ))}
            </div>

            {modo === 'config' ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
                    <div>
                        <h4 className="flex items-center gap-2 text-lg font-black text-slate-800">
                            <AlertTriangle size={18} className="text-rose-500" /> Configuración de alertas
                        </h4>
                        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                            Poné los umbrales de varios artículos de una, en general o en un almacén puntual.
                            Si el stock llega o baja del umbral, el artículo aparece en el panel. <b>Un valor en 0 desactiva la alerta.</b>
                        </p>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-5">
                        <div>
                            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                                <Package size={12} /> Seleccionar artículos
                            </p>
                            <button onClick={() => setCatalogoAbierto(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700 text-sm font-black">
                                <Layers size={15} /> Elegir del catálogo
                            </button>
                            {elegidos.length === 0 ? (
                                <div className="mt-3 rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center px-4">
                                    <Layers size={26} className="text-slate-300 mx-auto mb-2" />
                                    <p className="text-sm font-black text-slate-500">Ningún artículo elegido</p>
                                    <p className="text-xs text-slate-400 mt-1">Tocá “Elegir del catálogo” para agregarlos.</p>
                                </div>
                            ) : (
                                <div className="mt-3 rounded-xl border border-slate-200 divide-y divide-slate-50 max-h-72 overflow-y-auto">
                                    {elegidos.map(v => (
                                        <div key={v.VarId} className="flex items-center gap-2 px-3 py-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-700 truncate">{v.Producto}</p>
                                                <p className="text-[11px] text-slate-400 truncate">{v.NombreVariante}</p>
                                            </div>
                                            <button onClick={() => setElegidos(p => p.filter(x => x.VarId !== v.VarId))}
                                                className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 flex items-center justify-center shrink-0"><X size={13} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-4">
                            <Entornos />
                            <div className={`rounded-2xl border p-4 ${entorno === 0 ? 'border-sky-200 bg-sky-50/40' : 'border-indigo-200 bg-indigo-50/40'}`}>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">
                                    {entorno === 0 ? 'Alerta general (todos los almacenes)' : `Alerta solo en ${nombreEntorno}`}
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                    <Campo label="Alerta">
                                        <input type="number" min="0" step="1" value={lote.alerta} placeholder="0"
                                            onChange={e => setLote(x => ({ ...x, alerta: e.target.value }))}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-amber-600 tabular-nums font-gsanscode text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                    </Campo>
                                    <Campo label="Crítica">
                                        <input type="number" min="0" step="1" value={lote.critica} placeholder="0"
                                            onChange={e => setLote(x => ({ ...x, critica: e.target.value }))}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-rose-600 tabular-nums font-gsanscode text-right placeholder:text-left [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                    </Campo>
                                </div>
                            </div>
                            <button onClick={aplicarLote} disabled={!elegidos.length || guardando}
                                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black disabled:opacity-40">
                                {guardando ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                                Establecer límites{elegidos.length > 0 && ` en ${elegidos.length} artículo${elegidos.length !== 1 ? 's' : ''}`}
                            </button>
                            {entorno !== 0 && (
                                <p className="text-[11px] text-slate-400">
                                    Con los dos en 0, se borra el umbral propio de {nombreEntorno} y ese almacén vuelve a regirse solo por el general.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <Entornos />

                    {/* Dos maneras de mirar lo mismo: por política de umbral o artículo por artículo */}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex gap-1.5">
                            {[['agrupada', 'Por umbral'], ['lista', 'Lista de artículos']].map(([v, l]) => (
                                <button key={v} onClick={() => { setVista(v); if (v === 'agrupada') setCombo(null); }}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-black ${vista === v ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
                            ))}
                        </div>
                        {combo && (
                            <button onClick={() => setCombo(null)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-xs font-black">
                                Alerta {fmtCant(combo.Alerta)} · Crítica {fmtCant(combo.Critica)} <X size={12} />
                            </button>
                        )}
                        <div className="flex-1" />
                        <div className="relative min-w-[240px] max-w-md">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto o variante..."
                                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
                        </div>
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-600 cursor-pointer select-none">
                            <input type="checkbox" checked={soloConLimite} onChange={e => setSoloConLimite(e.target.checked)} className="rounded outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                            Solo los que tienen límite
                        </label>
                    </div>

                    {vista === 'agrupada' && !combo && (
                        combos.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-slate-200 text-center py-16 text-slate-400 text-sm">
                                {entorno === 0 ? 'Ningún artículo tiene umbrales cargados.' : `${nombreEntorno} no tiene umbrales propios.`}
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                                    {combos.map(c => (
                                        <button key={`${c.Alerta}-${c.Critica}`} onClick={() => { setCombo(c); setVista('lista'); }}
                                            className="bg-white rounded-2xl border border-slate-200 hover:border-sky-300 hover:shadow-md transition-all p-4 flex flex-col items-center gap-2">
                                            <Activity size={20} className="text-emerald-500" />
                                            <p className="text-base font-black text-slate-800 tabular-nums font-gsanscode">
                                                A{fmtCant(c.Alerta)} <span className="text-slate-300">·</span> C{fmtCant(c.Critica)}
                                            </p>
                                            <span className={`text-[10px] font-black rounded-full px-2.5 py-1 ${c.Articulos === 1 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                                {c.Articulos} artículo{c.Articulos !== 1 ? 's' : ''}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[11px] text-slate-400">
                                    Cada tarjeta es una combinación de umbrales en uso: <b>A</b> = alerta, <b>C</b> = crítica.
                                    {combos.some(c => c.Articulos === 1) && <> Las de <b className="text-amber-700">un solo artículo</b> suelen ser valores puestos a dedo — conviene revisarlas.</>}
                                </p>
                            </>
                        )
                    )}

                    {(vista === 'lista' || combo) && (cargando ? (
                        <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
                    ) : filas.length === 0 ? (
                        <div className="bg-white rounded-2xl border border-slate-200 text-center py-16 text-slate-400 text-sm">
                            {entorno === 0 ? 'Nada para mostrar.' : `${nombreEntorno} no tiene umbrales propios.`}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                            <div className="grid grid-cols-[1fr_110px_110px_110px_110px_110px] gap-3 px-4 py-2 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                <span>Artículo</span>
                                <span className="text-right">Stock</span>
                                <span className="text-right">Crítico</span>
                                <span className="text-right">Alerta</span>
                                <span className="text-right">Ideal</span>
                                <span />
                            </div>
                            <div className="divide-y divide-slate-50">
                                {filas.map(v => {
                                    const editando = edit === v.VarId;
                                    const critico = Number(v.CantidadCritica) > 0 && Number(v.StockGlobal) <= Number(v.CantidadCritica);
                                    return (
                                        <div key={v.VarId} className="grid grid-cols-[1fr_110px_110px_110px_110px_110px] gap-3 px-4 py-2.5 items-center">
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-slate-700 truncate">{v.Producto}</p>
                                                <p className="text-[11px] text-slate-400 font-semibold truncate">
                                                    {v.NombreVariante}{[v.Talle, v.Color].filter(Boolean).length > 0 && ` · ${[v.Talle, v.Color].filter(Boolean).join(' · ')}`}
                                                </p>
                                            </div>
                                            <span className={`text-sm font-black tabular-nums font-gsanscode text-right ${critico ? 'text-rose-600' : 'text-slate-700'}`}>
                                                {fmtCant(v.StockGlobal)}
                                            </span>
                                            {['critica', 'alerta', 'ideal'].map(campo => (
                                                <div key={campo} className="text-right">
                                                    {editando ? (
                                                        <input type="number" min="0" step="1" value={vals[campo]}
                                                            onChange={e => setVals(x => ({ ...x, [campo]: e.target.value }))}
                                                            onKeyDown={e => { if (e.key === 'Enter') guardar(v); if (e.key === 'Escape') setEdit(null); }}
                                                            className="w-full px-2 py-1.5 rounded-lg border border-sky-300 text-sm text-right tabular-nums font-gsanscode [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                                    ) : (
                                                        <span className="text-sm font-bold text-slate-500 tabular-nums font-gsanscode">
                                                            {fmtCant(v[campo === 'critica' ? 'CantidadCritica' : campo === 'alerta' ? 'CantidadAlerta' : 'CantidadIdeal'])}
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                            <div className="flex justify-end gap-1.5">
                                                {editando ? (<>
                                                    <button onClick={() => guardar(v)} className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-black">Guardar</button>
                                                    <button onClick={() => setEdit(null)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-slate-400 text-[11px] font-black">✕</button>
                                                </>) : (
                                                    <button onClick={() => { setEdit(v.VarId); setVals({ critica: v.CantidadCritica, alerta: v.CantidadAlerta, ideal: v.CantidadIdeal }); }}
                                                        className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-sky-600 hover:border-sky-300 flex items-center justify-center"><Pencil size={13} /></button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    <p className="text-[11px] text-slate-400">
                        El <b>crítico</b> pinta el artículo en rojo en el panel; el de <b>alerta</b>, en ámbar. El <b>ideal</b> es la referencia de reposición.
                        {entorno !== 0 && <> Estás viendo los umbrales propios de <b>{nombreEntorno}</b>, no los generales.</>}
                    </p>
                </div>
            )}
        </div>
    );
}

/* Proveedores — como el sistema anterior: el alta SIEMPRE a la izquierda y el
 * directorio en tarjetas. La edición va en su propio modal: reusar el panel de
 * alta mutándolo a "Editar" mezclaba las dos cosas y confundía. */
const CAMPOS_PRV = [
    ['nombre', 'Nombre fantasía'], ['razonSocial', 'Razón social'],
    ['documento', 'RUT / ID'], ['ciudad', 'Ciudad / país'],
    ['contacto', 'Persona de contacto / tel.'],
];

function FormProveedor({ f, setF, onGuardar }) {
    return (
        <>
            <Campo label="Nombre fantasía">
                <input value={f.nombre} onChange={e => setF(x => ({ ...x, nombre: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
            </Campo>
            <Campo label="Razón social">
                <input value={f.razonSocial} onChange={e => setF(x => ({ ...x, razonSocial: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
                <Campo label="RUT / ID">
                    <input value={f.documento} onChange={e => setF(x => ({ ...x, documento: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                </Campo>
                <Campo label="Ciudad / país">
                    <input value={f.ciudad} onChange={e => setF(x => ({ ...x, ciudad: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                </Campo>
            </div>
            <Campo label="Persona de contacto / tel.">
                <input value={f.contacto} onChange={e => setF(x => ({ ...x, contacto: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') onGuardar(); }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
            </Campo>
        </>
    );
}

function GestionProveedores() {
    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const VACIO = { nombre: '', razonSocial: '', documento: '', contacto: '', ciudad: '' };
    const [fNuevo, setFNuevo] = useState(VACIO);          // el alta de la izquierda
    const [creando, setCreando] = useState(false);        // modal de alta
    const [editando, setEditando] = useState(null);       // proveedor abierto en el modal
    const [fEdit, setFEdit] = useState(VACIO);
    const [borrando, setBorrando] = useState(null);
    const [confirmTexto, setConfirmTexto] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        try { setFilas((await api.get('/wms-interno/gestion/proveedores')).data?.data || []); }
        catch (e) { toast.error('No se pudieron cargar los proveedores'); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const registrar = async () => {
        if (!fNuevo.nombre.trim()) return toast.error('El nombre es obligatorio');
        try {
            await api.post('/wms-interno/gestion/proveedores', fNuevo);
            toast.success('Proveedor registrado');
            setFNuevo(VACIO); setCreando(false); cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo registrar'); }
    };

    const abrirEdicion = (p) => {
        setEditando(p);
        setFEdit({ nombre: p.Nombre || '', razonSocial: p.RazonSocial || '', documento: p.Documento || '', contacto: p.Contacto || '', ciudad: p.Ciudad || '' });
    };
    const guardarEdicion = async () => {
        if (!fEdit.nombre.trim()) return toast.error('El nombre es obligatorio');
        try {
            await api.put(`/wms-interno/gestion/proveedores/${editando.PrvId}`, fEdit);
            toast.success('Proveedor actualizado');
            setEditando(null); cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo guardar'); }
    };

    const confirmOk = confirmTexto.trim().toUpperCase() === 'ELIMINAR';
    const borrar = async () => {
        const p = borrando;
        if (!p || !confirmOk) return;
        try {
            await api.delete(`/wms-interno/gestion/proveedores/${p.PrvId}`);
            toast.success(`${p.Nombre} eliminado`);
            setBorrando(null); setConfirmTexto('');
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo eliminar'); }
    };

    // Un solo modal para alta y edición: cambia el título, el form es el mismo.
    const modalAbierto = creando || editando;
    const esEdicion = !!editando;
    const fModal = esEdicion ? fEdit : fNuevo;
    const setFModal = esEdicion ? setFEdit : setFNuevo;
    const guardarModal = esEdicion ? guardarEdicion : registrar;
    const cerrarModal = () => { setEditando(null); setCreando(false); };

    return (
        <div className="space-y-4">
            {modalAbierto && createPortal(
                <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-slate-900/70"
                    onClick={cerrarModal}>
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/60">
                            <p className="flex items-center gap-2 text-base font-black text-slate-800">
                                {esEdicion ? <Pencil size={16} className="text-sky-600" /> : <Truck size={16} className="text-sky-600" />}
                                {esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}
                            </p>
                            <button onClick={cerrarModal}
                                className="w-9 h-9 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center"><X size={16} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <FormProveedor f={fModal} setF={setFModal} onGuardar={guardarModal} />
                        </div>
                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
                            <button onClick={cerrarModal}
                                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-black hover:bg-slate-100">Cancelar</button>
                            <button onClick={guardarModal}
                                className="px-5 py-2.5 rounded-xl bg-brand-cyan hover:brightness-110 text-white text-sm font-black">
                                {esEdicion ? 'Guardar cambios' : 'Registrar proveedor'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Borrar es irreversible: se confirma tipeando ELIMINAR, no con un click */}
            {borrando && createPortal(
                <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-slate-900/70"
                    onClick={() => setBorrando(null)}>
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
                        <div className="flex items-start gap-3">
                            <div className="w-11 h-11 shrink-0 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center">
                                <Trash2 size={20} />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-lg font-black text-slate-800">Eliminar proveedor</h3>
                                <p className="text-sm text-slate-500 mt-0.5">
                                    Vas a borrar a <b className="text-slate-700">{borrando.Nombre}</b> del directorio.
                                    Esto no se puede deshacer.
                                </p>
                            </div>
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                                Escribí <span className="text-rose-600">ELIMINAR</span> para confirmar
                            </p>
                            <input autoFocus value={confirmTexto} onChange={e => setConfirmTexto(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && confirmOk) borrar(); if (e.key === 'Escape') setBorrando(null); }}
                                placeholder="ELIMINAR"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-black tracking-widest uppercase outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setBorrando(null)}
                                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-black hover:bg-slate-50">Cancelar</button>
                            <button onClick={borrar} disabled={!confirmOk}
                                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed">
                                Eliminar definitivamente
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Directorio a lo ancho; el alta vive en el modal */}
            <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                    <p className="text-base font-black text-slate-800">Directorio de proveedores</p>
                    <button onClick={() => { setFNuevo(VACIO); setCreando(true); }}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-black">
                        <Plus size={15} /> Nuevo proveedor
                    </button>
                </div>
                {cargando ? (
                    <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
                ) : filas.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 text-center py-16 text-slate-400 text-sm">Todavía no hay proveedores.</div>
                ) : (
                    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                        {filas.map(p => (
                            <div key={p.PrvId} className="bg-white rounded-2xl border border-slate-200 p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-base font-black text-slate-800 truncate">{p.Nombre}</p>
                                    <div className="flex gap-1.5 shrink-0">
                                        <button onClick={() => abrirEdicion(p)} title="Editar"
                                            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-sky-600 hover:border-sky-300 flex items-center justify-center"><Pencil size={12} /></button>
                                        <button onClick={() => { setBorrando(p); setConfirmTexto(''); }} disabled={p.Compras > 0}
                                            title={p.Compras > 0 ? 'Tiene compras asociadas: no se puede borrar' : 'Eliminar'}
                                            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-200 flex items-center justify-center disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:border-slate-200"><Trash2 size={12} /></button>
                                    </div>
                                </div>
                                {p.RazonSocial && (
                                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mt-0.5 leading-snug">{p.RazonSocial}</p>
                                )}
                                {/* Los tres datos van SIEMPRE, con guion si faltan — el hueco también informa.
                                    La pill de compras comparte renglón con Contacto: no roba alto propio. */}
                                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                                    {[['RUT', p.Documento], ['Ciudad', capitalizar(p.Ciudad)]].map(([k, v]) => (
                                        <p key={k} className="text-[11px] leading-snug truncate">
                                            <span className="font-black uppercase tracking-wide text-slate-400">{k}:</span>{' '}
                                            <span className="font-bold text-slate-600">{v || '—'}</span>
                                        </p>
                                    ))}
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-[11px] leading-snug truncate min-w-0">
                                            <span className="font-black uppercase tracking-wide text-slate-400">Contacto:</span>{' '}
                                            <span className="font-bold text-slate-600">{p.Contacto || '—'}</span>
                                        </p>
                                        {p.Compras > 0 && (
                                            <span className="shrink-0 text-[10px] font-black text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">
                                                {p.Compras} compra{p.Compras !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/* Almacenes y sectores */
function GestionDepositos() {
    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [edit, setEdit] = useState(null);
    const [f, setF] = useState({ nombre: '', tipo: '', ubicacion: '', activo: true });

    const cargar = useCallback(async () => {
        setCargando(true);
        try { setFilas((await api.get('/wms-interno/gestion/depositos')).data?.data || []); }
        catch (e) { toast.error('No se pudieron cargar los almacenes'); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const abrir = (d) => {
        setEdit(d ? d.DepId : 'nuevo');
        setF(d ? { nombre: d.Nombre || '', tipo: d.Tipo || '', ubicacion: d.Ubicacion || '', activo: !!d.Activo }
               : { nombre: '', tipo: '', ubicacion: '', activo: true });
    };
    const guardar = async () => {
        if (!f.nombre.trim()) return toast.error('El nombre es obligatorio');
        try {
            if (edit === 'nuevo') await api.post('/wms-interno/gestion/depositos', f);
            else await api.put(`/wms-interno/gestion/depositos/${edit}`, f);
            toast.success('Almacén guardado');
            setEdit(null); cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo guardar'); }
    };

    // El toggle de la tarjeta manda el registro completo: el PUT es de cabecera entera
    const toggleActivo = async (d) => {
        try {
            await api.put(`/wms-interno/gestion/depositos/${d.DepId}`,
                { nombre: d.Nombre, tipo: d.Tipo, ubicacion: d.Ubicacion, activo: !d.Activo });
            toast.success(`${d.Nombre} ${d.Activo ? 'inactivado' : 'activado'}`);
            cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo cambiar el estado'); }
    };

    return (
        <div className="space-y-4">
            <button onClick={() => abrir(null)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-black">
                <Plus size={15} /> Nuevo almacén
            </button>

            {edit !== null && (
                <div className="bg-white rounded-2xl border border-sky-200 p-5 space-y-4">
                    <p className="text-sm font-black text-slate-700">{edit === 'nuevo' ? 'Nuevo almacén' : 'Editar almacén'}</p>
                    <div className="grid md:grid-cols-3 gap-4">
                        <Campo label="Nombre"><input autoFocus value={f.nombre} onChange={e => setF(x => ({ ...x, nombre: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" /></Campo>
                        <Campo label="Tipo"><Selector value={f.tipo} onChange={v => setF(x => ({ ...x, tipo: v }))} className="w-full" ancho="w-full" placeholder="Elegir tipo..."
                            opciones={[{ value: 'central', label: 'Central' }, { value: 'sector', label: 'Sector' }, { value: 'tercero', label: 'Tercero' }]} /></Campo>
                        <Campo label="Ubicación"><input value={f.ubicacion} onChange={e => setF(x => ({ ...x, ubicacion: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" /></Campo>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={guardar} className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black">Guardar</button>
                        <button onClick={() => setEdit(null)} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-black">Cancelar</button>
                    </div>
                </div>
            )}

            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filas.map(d => (
                        <div key={d.DepId} className={`bg-white rounded-2xl border p-4 ${d.Activo ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 shrink-0 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center"><MapPin size={18} /></div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-base font-black text-slate-800 truncate">{d.Nombre}</p>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase">
                                        {d.Tipo || 'sin tipo'}{!d.Activo && ' · inactivo'}
                                    </p>
                                    {d.Ubicacion && <p className="text-[11px] text-slate-400 truncate">{d.Ubicacion}</p>}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button onClick={() => toggleActivo(d)}
                                        title={d.Activo ? 'Activo — click para inactivar' : 'Inactivo — click para activar'}
                                        className={`relative w-9 h-5 rounded-full transition-colors ${d.Activo ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${d.Activo ? 'translate-x-4' : ''}`} />
                                    </button>
                                    <button onClick={() => abrir(d)} className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-sky-600 hover:border-sky-300 flex items-center justify-center"><Pencil size={13} /></button>
                                </div>
                            </div>
                            <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                                <span className="text-[10px] font-black text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">{d.Etiquetas} etiquetas</span>
                                {d.Usuarios > 0 && <span className="text-[10px] font-black text-sky-700 bg-sky-50 rounded-full px-2.5 py-1">{d.Usuarios} usuario{d.Usuarios !== 1 ? 's' : ''}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <p className="text-[11px] text-slate-400">Un almacén con etiquetas no se puede borrar — si dejó de usarse, marcalo como inactivo.</p>
        </div>
    );
}

/* Plantillas de progreso: las etapas de una compra o importación */
function GestionPlantillas() {
    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [edit, setEdit] = useState(null);
    const [f, setF] = useState({ nombre: '', descripcion: '', pasos: [] });

    const cargar = useCallback(async () => {
        setCargando(true);
        try { setFilas((await api.get('/wms-interno/gestion/plantillas')).data?.data || []); }
        catch (e) { toast.error('No se pudieron cargar las plantillas'); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const abrir = (p) => {
        setEdit(p ? p.PlaId : 'nuevo');
        setF(p ? { nombre: p.Nombre || '', descripcion: p.Descripcion || '', pasos: p.pasos.map(x => ({ clave: x.Clave, etiqueta: x.Etiqueta })) }
               : { nombre: '', descripcion: '', pasos: [{ clave: '', etiqueta: '' }] });
    };
    const guardar = async () => {
        if (!f.nombre.trim()) return toast.error('El nombre es obligatorio');
        if (!f.pasos.some(p => p.etiqueta.trim())) return toast.error('Cargá al menos un paso');
        try {
            if (edit === 'nuevo') await api.post('/wms-interno/gestion/plantillas', f);
            else await api.put(`/wms-interno/gestion/plantillas/${edit}`, f);
            toast.success('Plantilla guardada');
            setEdit(null); cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo guardar'); }
    };
    const mover = (i, delta) => setF(x => {
        const p = [...x.pasos]; const j = i + delta;
        if (j < 0 || j >= p.length) return x;
        [p[i], p[j]] = [p[j], p[i]];
        return { ...x, pasos: p };
    });

    return (
        <div className="space-y-4">
            <button onClick={() => abrir(null)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-black">
                <Plus size={15} /> Nueva plantilla
            </button>

            {edit !== null && (
                <div className="bg-white rounded-2xl border border-sky-200 p-5 space-y-4">
                    <p className="text-sm font-black text-slate-700">{edit === 'nuevo' ? 'Nueva plantilla' : 'Editar plantilla'}</p>
                    <div className="grid md:grid-cols-2 gap-4">
                        <Campo label="Nombre"><input autoFocus value={f.nombre} onChange={e => setF(x => ({ ...x, nombre: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" /></Campo>
                        <Campo label="Descripción"><input value={f.descripcion} onChange={e => setF(x => ({ ...x, descripcion: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" /></Campo>
                    </div>

                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Etapas, en orden</p>
                        <div className="space-y-2">
                            {f.pasos.map((p, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <span className="w-7 h-7 shrink-0 rounded-lg bg-slate-100 text-slate-500 text-xs font-black flex items-center justify-center font-gsanscode">{i + 1}</span>
                                    <input value={p.etiqueta} placeholder="Nombre de la etapa (ej: En fabricación)"
                                        onChange={e => setF(x => ({ ...x, pasos: x.pasos.map((y, yi) => yi === i ? { ...y, etiqueta: e.target.value } : y) }))}
                                        className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200" />
                                    <div className="flex gap-1">
                                        <button onClick={() => mover(i, -1)} disabled={i === 0} title="Subir"
                                            className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center disabled:opacity-30"><ChevronUp size={14} /></button>
                                        <button onClick={() => mover(i, 1)} disabled={i === f.pasos.length - 1} title="Bajar"
                                            className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center disabled:opacity-30"><ChevronDown size={14} /></button>
                                        <button onClick={() => setF(x => ({ ...x, pasos: x.pasos.filter((_, yi) => yi !== i) }))} title="Quitar"
                                            className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 flex items-center justify-center"><Trash2 size={13} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => setF(x => ({ ...x, pasos: [...x.pasos, { clave: '', etiqueta: '' }] }))}
                            className="mt-2 flex items-center gap-1.5 text-xs font-black text-sky-600 hover:text-sky-700">
                            <Plus size={13} /> Agregar etapa
                        </button>
                    </div>

                    {edit !== 'nuevo' && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                            Las compras que ya están en una etapa guardan su <b>clave</b>. Si renombrás una etapa, la clave se conserva; si la borrás, esas compras quedan sin etapa reconocible.
                        </p>
                    )}

                    <div className="flex gap-2">
                        <button onClick={guardar} className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-black">Guardar</button>
                        <button onClick={() => setEdit(null)} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-black">Cancelar</button>
                    </div>
                </div>
            )}

            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando...</div>
            ) : (
                <div className="space-y-3">
                    {filas.map(p => (
                        <div key={p.PlaId} className="bg-white rounded-2xl border border-slate-200 p-4">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 shrink-0 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><Workflow size={18} /></div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-base font-black text-slate-800 truncate">{p.Nombre}</p>
                                    <p className="text-[11px] text-slate-400 font-semibold">
                                        {p.pasos.length} etapa{p.pasos.length !== 1 ? 's' : ''} · usada por {p.Compras} compra{p.Compras !== 1 ? 's' : ''}
                                    </p>
                                </div>
                                <button onClick={() => abrir(p)} className="w-8 h-8 shrink-0 rounded-lg border border-slate-200 text-slate-400 hover:text-sky-600 hover:border-sky-300 flex items-center justify-center"><Pencil size={13} /></button>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {p.pasos.map((x, i) => (
                                    <React.Fragment key={x.PasId}>
                                        {i > 0 && <ChevronRight size={12} className="text-slate-300" />}
                                        <span className="text-[10px] font-black uppercase tracking-wide text-slate-600 bg-slate-100 rounded-full px-2.5 py-1">{x.Etiqueta}</span>
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default StockGestionPage;
