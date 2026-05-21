import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, Edit2, Trash2, RefreshCw, ChevronDown, AlertTriangle, Hash, Loader2, FileText, Lock, Search, User } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFecha = (f) => f ? new Date(f).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const UI_LIMITE = 10000;
const UI_VALOR = 6.05; 
const DGI_UMBRAL_UYU = UI_LIMITE * UI_VALOR;

// Detecta si una línea es de agrupación/subtotal (no editable)
const esLineaAgrupacion = (nom = '') => false;

// ── Fila de línea ─────────────────────────────────────────────────────────────
const LineaRow = ({ linea, idx, onChange, onDelete }) => {
    const bloqueada = esLineaAgrupacion(linea.DcdNomItem);

    const handle = (field, value) => {
        const updated = { ...linea, [field]: value };
        if (field === 'DcdCantidad' || field === 'DcdPrecioUnitario') {
            const c = field === 'DcdCantidad' ? parseFloat(value) || 0 : parseFloat(updated.DcdCantidad) || 0;
            const p = field === 'DcdPrecioUnitario' ? parseFloat(value) || 0 : parseFloat(updated.DcdPrecioUnitario) || 0;
            updated.DcdSubtotal = parseFloat((c * p).toFixed(4));
        }
        onChange(idx, updated);
    };

    if (bloqueada) {
        return (
            <tr className="bg-slate-50 border-b border-dashed border-slate-200">
                <td className="px-3 py-2 w-10 text-center">
                    <Lock size={12} className="text-slate-300 mx-auto" />
                </td>
                <td className="px-3 py-2 text-xs font-bold text-slate-500 italic" colSpan={3}>
                    {linea.DcdNomItem}
                </td>
                <td className="px-3 py-2 text-right">
                    <span className="text-xs font-black text-slate-600 bg-slate-200 px-2 py-1 rounded-lg">
                        {fmt(linea.DcdSubtotal)}
                    </span>
                </td>
                <td className="px-2 py-2 w-10" />
            </tr>
        );
    }

    return (
        <tr className="border-b border-slate-100 hover:bg-indigo-50/30 transition-colors">
            <td className="px-3 py-2 w-10 text-center text-xs text-slate-400 font-mono">{idx + 1}</td>
            <td className="px-2 py-2">
                <input
                    type="text"
                    value={linea.DcdNomItem || ''}
                    onChange={e => handle('DcdNomItem', e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
                    placeholder="Descripción"
                />
            </td>
            <td className="px-2 py-2 w-24">
                <input
                    type="number"
                    value={linea.DcdCantidad ?? 1}
                    onChange={e => handle('DcdCantidad', e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-right focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
                    min="0" step="0.0001"
                />
            </td>
            <td className="px-2 py-2 w-28">
                <input
                    type="number"
                    value={linea.DcdPrecioUnitario ?? 0}
                    onChange={e => handle('DcdPrecioUnitario', e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-right focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
                    min="0" step="0.0001"
                />
            </td>
            <td className="px-2 py-2 w-28 text-right">
                <span className="text-sm font-semibold text-slate-700 bg-slate-100 px-2.5 py-1.5 rounded-lg block text-right">
                    {fmt(linea.DcdSubtotal)}
                </span>
            </td>
            <td className="px-2 py-2 w-10 text-center">
                <button
                    onClick={() => onDelete(idx)}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Eliminar línea"
                >
                    <Trash2 size={14} />
                </button>
            </td>
        </tr>
    );
};

// ── MODAL ─────────────────────────────────────────────────────────────────────
export default function CfeEditModal({ doc, onClose, onSuccess }) {
    const [loadingDetalle, setLoadingDetalle] = useState(true);
    const [saving, setSaving] = useState(false);
    const [tiposDoc, setTiposDoc] = useState([]);
    const [articulos, setArticulos] = useState([]);
    const [lineas, setLineas] = useState([]);

    // Búsqueda de clientes
    const [qCliente, setQCliente] = useState('');
    const [clientesRes, setClientesRes] = useState([]);
    const [buscandoCli, setBuscandoCli] = useState(false);
    const [clienteSel, setClienteSel] = useState(null); // { CliIdCliente, Nombre, NombreFantasia, CioRuc, DireccionTrabajo }

    const [form, setForm] = useState({
        DocTipo:          doc.DocTipo || '',
        CliIdCliente:     doc.CliIdCliente || 1,
        MonIdMoneda:      doc.MonIdMoneda || 1,
        DocObservaciones: doc.DocObservaciones || '',
        DocSubtotal:      Number(doc.DocSubtotal) || 0,
        DocImpuestos:     Number(doc.DocImpuestos) || 0,
        DocTotal:         Number(doc.DocTotal) || 0,
        DocCliNombre:     doc.DocCliNombre || '',
        DocCliDocumento:  doc.DocCliDocumento || '',
        DocCliDireccion:  doc.DocCliDireccion || '',
        DocCliCiudad:     doc.DocCliCiudad || '',
    });

    // Cargar detalle + nomencladores
    const cargar = useCallback(async () => {
        setLoadingDetalle(true);
        try {
            const [detRes, nomRes, artRes] = await Promise.all([
                api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/detalle`),
                api.get('/contabilidad/cfe/nomencladores'),
                api.get('/contabilidad/articulos'),
            ]);

            // Cargar líneas
            if (detRes.data?.detalles?.length) {
                setLineas(detRes.data.detalles.map(l => ({ ...l })));
            }

            // Cargar datos del doc desde la API (fuente de verdad)
            if (detRes.data?.doc) {
                const d = detRes.data.doc;
                setForm(prev => ({
                    ...prev,
                    DocSubtotal:      Number(d.DocSubtotal)  || prev.DocSubtotal,
                    DocImpuestos:     Number(d.DocImpuestos) || prev.DocImpuestos,
                    DocTotal:         Number(d.DocTotal)     || prev.DocTotal,
                    DocObservaciones: d.DocObservaciones     || '',
                    DocTipo:          d.DocTipo              || prev.DocTipo,
                    MonIdMoneda:      d.MonIdMoneda          || prev.MonIdMoneda,
                    CliIdCliente:     d.CliIdCliente         || prev.CliIdCliente,
                    DocCliNombre:     d.DocCliNombre         || d.CliRazonSocial    || d.CliNombreFantasia || '',
                    DocCliDocumento:  d.DocCliDocumento      || d.CliRUT            || '',
                    DocCliDireccion:  d.DocCliDireccion      || d.CliDireccion      || '',
                    DocCliCiudad:     d.DocCliCiudad         || '',
                }));

                // Setear el cliente seleccionado para mostrarlo en la UI
                if (d.CliIdCliente) {
                    setClienteSel({
                        CliIdCliente:  d.CliIdCliente,
                        Nombre:        d.CliRazonSocial    || d.CliNombreFantasia || 'Consumidor Final',
                        NombreFantasia: d.CliNombreFantasia || '',
                        CioRuc:        d.CliRUT            || '',
                        DireccionTrabajo: d.CliDireccion   || '',
                    });
                }
            }

            if (nomRes.data?.tiposDocumentos) setTiposDoc(nomRes.data.tiposDocumentos);
            if (artRes.data) setArticulos(Array.isArray(artRes.data) ? artRes.data : []);

        } catch (err) {
            toast.error('Error cargando detalle: ' + (err.response?.data?.error || err.message));
        } finally {
            setLoadingDetalle(false);
        }
    }, [doc.DocIdDocumento]);

    useEffect(() => { cargar(); }, [cargar]);

    // Búsqueda de clientes con debounce
    useEffect(() => {
        if (!qCliente.trim() || qCliente.length < 2) { setClientesRes([]); return; }
        const t = setTimeout(async () => {
            setBuscandoCli(true);
            try {
                const res = await api.get(`/contabilidad/clientes-activos?q=${encodeURIComponent(qCliente)}&tipo=TODOS`);
                setClientesRes(Array.isArray(res.data?.data) ? res.data.data : []);
            } catch { toast.error('Error buscando clientes'); }
            setBuscandoCli(false);
        }, 400);
        return () => clearTimeout(t);
    }, [qCliente]);

    // Cuando se selecciona un cliente → actualizar form con sus datos DGI
    const seleccionarCliente = (c) => {
        setClienteSel(c);
        setClientesRes([]);
        setQCliente('');
        setForm(prev => ({
            ...prev,
            CliIdCliente:    c.CliIdCliente,
            DocCliNombre:    c.NombreFantasia || c.Nombre || '',
            DocCliDocumento: c.CioRuc || c.IDCliente || '',
            DocCliDireccion: c.DireccionTrabajo || '',
            DocCliCiudad:    '',
        }));
    };

    // Recalcular totales desde líneas
    useEffect(() => {
        if (!lineas.length) return;
        const editables = lineas.filter(l => !esLineaAgrupacion(l.DcdNomItem));
        const subtotal = parseFloat(editables.reduce((a, l) => a + (parseFloat(l.DcdSubtotal) || 0), 0).toFixed(2));
        const iva = parseFloat((subtotal * 0.22).toFixed(2));
        setForm(prev => ({ ...prev, DocSubtotal: subtotal, DocImpuestos: iva, DocTotal: parseFloat((subtotal + iva).toFixed(2)) }));
    }, [lineas]);

    const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
    const handleLineaChange = (idx, updated) => setLineas(prev => prev.map((l, i) => i === idx ? updated : l));
    const handleEliminar = (idx) => setLineas(prev => prev.filter((_, i) => i !== idx));

    const handleAddLinea = () => {
        setLineas(prev => [...prev, {
            DcdIdDetalle: null,
            DcdNomItem: '',
            DcdCantidad: 1,
            DcdPrecioUnitario: 0,
            DcdSubtotal: 0
        }]);
    };

    const handleSave = async () => {
        if (form.DocTipo.includes('FACTURA')) {
            if (!form.DocCliDocumento || form.DocCliDocumento.replace(/\D/g, '').length < 11) {
                toast.error('Las E-Facturas requieren un número de RUT válido.');
                return;
            }
        } else if (form.DocTipo.includes('TICKET')) {
            const isUYU = form.MonIdMoneda === 1 || form.MonIdMoneda === '1';
            if (isUYU && form.DocTotal > DGI_UMBRAL_UYU) {
                if (!form.DocCliDocumento || form.DocCliDocumento.trim() === '') {
                    toast.error(`Para ventas mayores a $${fmt(DGI_UMBRAL_UYU)} (10.000 UI) debe ingresar C.I. o RUT del cliente.`);
                    return;
                }
            }
        }

        setSaving(true);
        try {
            await api.put(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}`, {
                DocTipo:         form.DocTipo,
                CliIdCliente:    Number(form.CliIdCliente),
                MonIdMoneda:     Number(form.MonIdMoneda),
                DocSubtotal:     form.DocSubtotal,
                DocImpuestos:    form.DocImpuestos,
                DocTotal:        form.DocTotal,
                DocObservaciones: form.DocObservaciones,
                lineas: lineas.map(l => ({
                    DcdIdDetalle:       l.DcdIdDetalle,
                    DcdNomItem:         l.DcdNomItem,
                    DcdCantidad:        parseFloat(l.DcdCantidad) || 1,
                    DcdPrecioUnitario:  parseFloat(l.DcdPrecioUnitario) || 0,
                    DcdSubtotal:        parseFloat(l.DcdSubtotal) || 0,
                    _agrupacion:        esLineaAgrupacion(l.DcdNomItem),
                })),
                DocCliNombre:    form.DocCliNombre,
                DocCliDocumento: form.DocCliDocumento,
                DocCliDireccion: form.DocCliDireccion,
                DocCliCiudad:    form.DocCliCiudad,
            });

            toast.success('✅ Factura actualizada y asiento sincronizado');
            onSuccess();
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaving(false);
        }
    };

    const simbolo = form.MonIdMoneda === 2 || form.MonIdMoneda === '2' ? 'U$S' : '$';
    const lineasEditables = lineas.filter(l => !esLineaAgrupacion(l.DcdNomItem)).length;

    // Construir las opciones del select de tipo doc incluyendo el valor actual
    const opcionesTipo = [
        { value: '', label: '— Seleccioná —' },
        ...tiposDoc.map(t => ({ value: t.label || t.value, label: t.label || t.value })),
    ];
    // Si el DocTipo actual no está en la lista, agregarlo para que el select lo muestre
    if (form.DocTipo && !opcionesTipo.find(o => o.value === form.DocTipo)) {
        opcionesTipo.splice(1, 0, { value: form.DocTipo, label: form.DocTipo });
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[92vh] shadow-2xl flex flex-col overflow-hidden"
                style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.3)' }}>

                {/* Header */}
                <div className="shrink-0 bg-gradient-to-r from-indigo-700 via-indigo-600 to-violet-600 px-7 py-5 flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Edit2 size={14} className="text-indigo-200" />
                            <span className="text-xs font-black uppercase tracking-widest text-indigo-200">Editar Documento CFE</span>
                        </div>
                        <h2 className="text-2xl font-black text-white">{doc.DocSerie}-{doc.DocNumero}
                            <span className="ml-3 text-sm font-semibold text-indigo-200 bg-white/10 px-3 py-1 rounded-full">{doc.DocTipo}</span>
                        </h2>
                        <p className="text-indigo-300 text-xs mt-1">{fmtFecha(doc.DocFechaEmision)} · {clienteSel?.NombreFantasia || clienteSel?.Nombre || doc.CliNombreFantasia || doc.CliRazonSocial || 'Consumidor Final'}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl text-indigo-200 hover:bg-white/10 transition-colors"><X size={18} /></button>
                </div>

                {/* Aviso */}
                <div className="shrink-0 mx-6 mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
                    <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                    <p className="text-xs text-amber-700 font-medium">Solo documentos <strong>PENDIENTE</strong>. Los cambios actualizan el asiento en el Libro Mayor.</p>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 custom-scrollbar">

                    {/* ── Fila 1: Tipo Doc + Moneda ── */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                                <FileText size={11} className="inline mr-1" />Tipo de Documento
                            </label>
                            <div className="relative">
                                <select
                                    value={form.DocTipo}
                                    onChange={e => setField('DocTipo', e.target.value)}
                                    className="w-full text-sm border-2 border-indigo-200 rounded-xl px-3 py-2.5 pr-8 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none appearance-none font-semibold text-indigo-900"
                                >
                                    {opcionesTipo.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Moneda</label>
                            <div className="relative">
                                <select
                                    value={form.MonIdMoneda}
                                    onChange={e => setField('MonIdMoneda', parseInt(e.target.value))}
                                    className="w-full text-sm border-2 border-slate-200 rounded-xl px-3 py-2.5 pr-8 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none appearance-none font-semibold"
                                >
                                    <option value={1}>$ — Peso Uruguayo (UYU)</option>
                                    <option value={2}>U$S — Dólar (USD)</option>
                                </select>
                                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                    </div>

                    {/* ── Fila 2: Cliente (búsqueda) + Observaciones ── */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Cliente</label>

                            {clienteSel ? (
                                /* Cliente seleccionado → mostrar tarjeta */
                                <div className="flex items-center justify-between bg-indigo-50 border-2 border-indigo-200 rounded-xl px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <User size={14} className="text-indigo-500 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-indigo-900 truncate">{clienteSel.NombreFantasia || clienteSel.Nombre}</p>
                                            <p className="text-[10px] text-indigo-400 font-mono">ID: {clienteSel.CliIdCliente} {clienteSel.CioRuc ? `· RUT: ${clienteSel.CioRuc}` : ''}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => { setClienteSel(null); setQCliente(''); }}
                                        className="ml-2 p-1 rounded-lg text-indigo-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                                        title="Cambiar cliente"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                /* Buscador de cliente */
                                <div className="relative">
                                    <div className="flex items-center border-2 border-slate-200 rounded-xl px-3 py-2 focus-within:border-indigo-400 bg-white transition-all">
                                        <Search size={14} className="text-slate-400 shrink-0" />
                                        <input
                                            value={qCliente}
                                            onChange={e => setQCliente(e.target.value)}
                                            placeholder="Buscar por nombre, RUC, ID..."
                                            className="flex-1 text-sm px-2 outline-none bg-transparent text-slate-800 font-medium placeholder-slate-400"
                                        />
                                        {buscandoCli && <Loader2 size={14} className="text-indigo-400 animate-spin shrink-0" />}
                                    </div>
                                    {clientesRes.length > 0 && (
                                        <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 max-h-52 overflow-y-auto">
                                            {clientesRes.map(c => (
                                                <div
                                                    key={c.CliIdCliente}
                                                    onClick={() => seleccionarCliente(c)}
                                                    className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 cursor-pointer border-b border-slate-50 last:border-0 transition-colors"
                                                >
                                                    <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center font-black text-indigo-600 text-sm shrink-0">
                                                        {(c.NombreFantasia || c.Nombre)?.[0] || 'C'}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-slate-800">{c.NombreFantasia || c.Nombre}</p>
                                                        <p className="text-[10px] text-slate-400 font-mono">ID: {c.CliIdCliente} {c.CioRuc ? `· ${c.CioRuc}` : ''}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Observaciones</label>
                            <input
                                type="text"
                                value={form.DocObservaciones}
                                onChange={e => setField('DocObservaciones', e.target.value)}
                                placeholder="Notas internas..."
                                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:ring-2 focus:ring-indigo-400 outline-none"
                            />
                        </div>
                    </div>

                    {/* ── Datos DGI del Comprobante ── */}
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Datos DGI del Comprobante</h3>
                            {form.DocTipo?.includes('TICKET') && form.MonIdMoneda === 1 && form.DocTotal > DGI_UMBRAL_UYU && (
                                <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-lg border border-amber-200">RUT/CI OBLIGATORIO (&gt;{DGI_UMBRAL_UYU} UYU)</span>
                            )}
                        </div>
                        <div className="grid grid-cols-4 gap-3">
                            <div className="col-span-1">
                                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Nombre / Razón Social</label>
                                <input type="text" value={form.DocCliNombre} onChange={e => setField('DocCliNombre', e.target.value)}
                                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-2 focus:ring-indigo-400 outline-none" />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Documento (RUT / CI)</label>
                                <input type="text" value={form.DocCliDocumento} onChange={e => setField('DocCliDocumento', e.target.value)}
                                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-2 focus:ring-indigo-400 outline-none" />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Dirección</label>
                                <input type="text" value={form.DocCliDireccion} onChange={e => setField('DocCliDireccion', e.target.value)}
                                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-2 focus:ring-indigo-400 outline-none" />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Ciudad / Depto</label>
                                <input type="text" value={form.DocCliCiudad} onChange={e => setField('DocCliCiudad', e.target.value)}
                                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-2 focus:ring-indigo-400 outline-none" />
                            </div>
                        </div>
                    </div>

                    {/* ── Líneas de detalle ── */}
                    <div>
                        <datalist id="articulos-list">
                            {articulos.map((art, i) => (
                                <option key={i} value={art.Descripcion || art.Material} />
                            ))}
                        </datalist>

                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Líneas de Detalle</h3>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-indigo-600 font-bold bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-lg">
                                    {lineasEditables} editables
                                </span>
                                <span className="text-xs text-slate-400 font-medium bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-lg">
                                    <Lock size={9} className="inline mr-1" />{lineas.length - lineasEditables} bloqueadas
                                </span>
                            </div>
                        </div>

                        <div className="border border-slate-200 rounded-2xl overflow-hidden">
                            {loadingDetalle ? (
                                <div className="flex items-center justify-center py-10 gap-2 text-slate-500">
                                    <Loader2 size={18} className="animate-spin text-indigo-500" />
                                    <span className="text-sm">Cargando detalle...</span>
                                </div>
                            ) : lineas.length === 0 ? (
                                <div className="py-8 text-center text-slate-400 text-sm">Sin líneas registradas.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-100 border-b border-slate-200">
                                            <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                                <th className="px-3 py-3 w-10 text-center">#</th>
                                                <th className="px-2 py-3">Descripción</th>
                                                <th className="px-2 py-3 w-24 text-right">Cantidad</th>
                                                <th className="px-2 py-3 w-28 text-right">P. Unitario</th>
                                                <th className="px-2 py-3 w-28 text-right">Subtotal</th>
                                                <th className="px-2 py-3 w-10" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {lineas.map((l, idx) => (
                                                <LineaRow
                                                    key={l.DcdIdDetalle || idx}
                                                    linea={l} idx={idx}
                                                    onChange={handleLineaChange}
                                                    onDelete={handleEliminar}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            
                            <div className="bg-slate-50 border-t border-slate-200 p-2 flex justify-center">
                                <button
                                    onClick={handleAddLinea}
                                    className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    + Agregar Línea
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── Totales ── */}
                    <div className="bg-gradient-to-br from-slate-50 to-indigo-50/40 border border-slate-200 rounded-2xl p-5">
                        <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-4">Totales Calculados</h3>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            {[
                                { label: 'Subtotal Neto', val: form.DocSubtotal },
                                { label: 'IVA 22%', val: form.DocImpuestos },
                            ].map(f => (
                                <div key={f.label}>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">{f.label}</p>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">{simbolo}</span>
                                        <input type="number" value={f.val} readOnly
                                            className="w-full bg-slate-100 text-slate-500 border border-slate-200 rounded-xl px-3 py-2.5 pl-10 text-right text-sm cursor-not-allowed" />
                                    </div>
                                </div>
                            ))}
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 mb-1.5">Total con IVA</p>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-600 text-sm font-black">{simbolo}</span>
                                    <input type="number" value={form.DocTotal} readOnly
                                        className="w-full bg-indigo-50 text-indigo-700 border-2 border-indigo-200 rounded-xl px-3 py-2.5 pl-10 text-right text-base font-black cursor-not-allowed" />
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-end border-t border-slate-200 pt-3">
                            <p className="text-2xl font-black text-indigo-700">{simbolo} {fmt(form.DocTotal)}</p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-6 py-4 flex items-center justify-between rounded-b-3xl">
                    <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                        <Hash size={11} />Doc ID: <strong className="text-slate-600">{doc.DocIdDocumento}</strong>
                        &nbsp;·&nbsp;<span className="text-amber-600 font-bold">PENDIENTE DGI</span>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onClose} disabled={saving}
                            className="px-5 py-2.5 rounded-xl text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 font-semibold text-sm transition-colors disabled:opacity-50">
                            Cancelar
                        </button>
                        <button onClick={handleSave} disabled={saving || loadingDetalle}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white bg-indigo-600 hover:bg-indigo-500 font-bold text-sm shadow-md shadow-indigo-600/20 disabled:opacity-50 transition-colors">
                            {saving ? <><RefreshCw size={15} className="animate-spin" /> Guardando...</> : <><Save size={15} /> Guardar y Sincronizar</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
