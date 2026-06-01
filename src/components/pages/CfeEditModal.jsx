import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, Edit2, Trash2, RefreshCw, ChevronDown, AlertTriangle, Hash, Loader2, FileText, Lock, Search, User, UserCheck } from 'lucide-react';
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
        if (field === 'DcdCantidad' || field === 'DcdPrecioUnitario' || field === 'ivaRate') {
            const c = parseFloat(updated.DcdCantidad) || 0;
            const p = parseFloat(updated.DcdPrecioUnitario) || 0;
            const r = (updated.ivaRate !== undefined && updated.ivaRate !== null) ? parseFloat(updated.ivaRate) : 22;
            const total = c * p;
            
            updated.DcdSubtotal = parseFloat((total / (1 + r / 100)).toFixed(4));
            updated.DcdImpuestos = parseFloat((total - updated.DcdSubtotal).toFixed(4));
            updated.DcdTotal = parseFloat(total.toFixed(4));
            
            if (field === 'DcdPrecioUnitario') {
                updated.precioNote = 'Modificado manualmente';
            }
        }
        onChange(idx, updated);
    };

    if (bloqueada) {
        return (
            <tr className="bg-slate-50 border-b border-dashed border-slate-200">
                <td className="px-3 py-2 w-10 text-center">
                    <Lock size={12} className="text-slate-300 mx-auto" />
                </td>
                <td className="px-3 py-2 text-xs font-bold text-slate-500 italic" colSpan={5}>
                    {linea.DcdNomItem}
                </td>
                <td className="px-3 py-2 text-right">
                    <span className="text-xs font-black text-slate-600 bg-slate-200 px-2 py-1 rounded-lg">
                        {fmt(linea.DcdTotal || linea.DcdSubtotal)}
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
                <div className="flex flex-col gap-1.5">
                    <input
                        type="text"
                        value={linea.DcdNomItem || ''}
                        onChange={e => handle('DcdNomItem', e.target.value)}
                        list="articulos-list"
                        className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-400 outline-none bg-white font-medium"
                        placeholder="Descripción"
                    />
                    <input
                        type="text"
                        value={linea.DcdDscItem || ''}
                        onChange={e => handle('DcdDscItem', e.target.value)}
                        className="w-full text-xs border border-dashed border-slate-200 rounded-lg px-2.5 py-1 focus:ring-2 focus:ring-indigo-300 outline-none bg-slate-50/50 text-slate-500 placeholder-slate-400"
                        placeholder="Detalle adicional / Sublínea"
                    />
                </div>
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
                {linea.precioNote && (
                    <span className="text-[10px] text-indigo-500 font-semibold block text-right mt-1 italic" title={linea.precioNote}>
                        {linea.precioNote}
                    </span>
                )}
            </td>
            <td className="px-2 py-2 w-24">
                <select
                    value={linea.ivaRate ?? 22}
                    onChange={e => handle('ivaRate', e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-400 outline-none bg-white text-slate-800"
                >
                    <option value={22}>22%</option>
                    <option value={10}>10%</option>
                    <option value={0}>0%</option>
                </select>
            </td>
            <td className="px-2 py-2 w-24 text-right font-mono text-xs text-slate-600">
                {fmt(linea.DcdSubtotal || 0)}
            </td>
            <td className="px-2 py-2 w-24 text-right font-mono text-sm font-bold text-slate-900">
                {fmt(linea.DcdTotal || (parseFloat(linea.DcdCantidad || 0) * parseFloat(linea.DcdPrecioUnitario || 0)))}
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
    const [updatingClient, setUpdatingClient] = useState(false);
    const [tiposDoc, setTiposDoc] = useState([]);
    const [articulos, setArticulos] = useState([]);
    const [departamentos, setDepartamentos] = useState([]);
    const [lineas, setLineas] = useState([]);

    // Búsqueda de clientes
    const [qCliente, setQCliente] = useState('');
    const [clientesRes, setClientesRes] = useState([]);
    const [buscandoCli, setBuscandoCli] = useState(false);
    const [clienteSel, setClienteSel] = useState(null); // { CliIdCliente, Nombre, NombreFantasia, CioRuc, DireccionTrabajo }

    const getClienteDisplayName = (c) => {
        if (!c) return '';
        const nom = c.Nombre?.trim();
        const fan = c.NombreFantasia?.trim();
        return nom || fan || 'Cliente sin nombre';
    };

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (!event.target.closest('.client-search-container')) {
                setClientesRes([]);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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
            const [detRes, nomRes, artRes, depRes] = await Promise.all([
                api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/detalle`),
                api.get('/contabilidad/cfe/nomencladores'),
                api.get('/contabilidad/articulos'),
                api.get('/nomenclators/departments').catch(() => ({ data: { success: false, data: [] } })),
            ]);

            // Cargar líneas
            if (detRes.data?.detalles?.length) {
                setLineas(detRes.data.detalles.map(l => {
                    const sub = parseFloat(l.DcdSubtotal) || 0;
                    const imp = parseFloat(l.DcdImpuestos) || 0;
                    let ivaRate = 22;
                    if (sub > 0) {
                        const ratio = (imp / sub) * 100;
                        if (ratio < 2) ivaRate = 0;
                        else if (ratio < 15) ivaRate = 10;
                        else ivaRate = 22;
                    }
                    const total = parseFloat(l.DcdTotal) || (sub + imp);
                    const qty = parseFloat(l.DcdCantidad) || 1;
                    const priceWithIva = qty > 0 ? (total / qty) : (parseFloat(l.DcdPrecioUnitario) || 0);

                    return {
                        ...l,
                        DcdPrecioUnitario: parseFloat(priceWithIva.toFixed(4)),
                        ivaRate: ivaRate,
                        precioNote: 'Precio original'
                    };
                }));
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
            
            // Cargar artículos de forma segura
            if (artRes.data?.success && Array.isArray(artRes.data.data)) {
                setArticulos(artRes.data.data);
            } else if (artRes.data && Array.isArray(artRes.data)) {
                setArticulos(artRes.data);
            } else {
                setArticulos([]);
            }

            // Cargar departamentos de forma segura
            if (depRes.data?.success && Array.isArray(depRes.data.data)) {
                setDepartamentos(depRes.data.data);
            } else if (depRes.data && Array.isArray(depRes.data)) {
                setDepartamentos(depRes.data);
            } else {
                setDepartamentos([]);
            }

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

    const recalcularPrecioLinea = async (idx, currLine, currentClienteId, currentMonedaId) => {
        if (!currLine.DcdNomItem) return;
        const match = articulos.find(a => a.NombreArticulo === currLine.DcdNomItem);
        if (!match) return;
        try {
            const res = await api.post('/prices/calculate', {
                codArticulo: match.CodigoArticulo,
                cantidad: parseFloat(currLine.DcdCantidad) || 1,
                clienteId: currentClienteId ? Number(currentClienteId) : null,
                targetCurrency: currentMonedaId === 2 ? 'USD' : 'UYU'
            });
            if (res.data && res.data.precioUnitario !== undefined) {
                const price = Number(res.data.precioUnitario);
                setLineas(prev => prev.map((l, i) => {
                    if (i === idx) {
                        const qty = parseFloat(l.DcdCantidad) || 0;
                        const r = (l.ivaRate !== undefined && l.ivaRate !== null) ? parseFloat(l.ivaRate) : 22;
                        const lineTotal = qty * price;
                        const lineNeto = lineTotal / (1 + r / 100);
                        const lineIva = lineTotal - lineNeto;
                        return {
                            ...l,
                            DcdPrecioUnitario: price,
                            DcdSubtotal: parseFloat(lineNeto.toFixed(4)),
                            DcdImpuestos: parseFloat(lineIva.toFixed(4)),
                            DcdTotal: parseFloat(lineTotal.toFixed(4)),
                            precioNote: res.data.perfilesAplicados?.length 
                                ? `Tarifa: ${res.data.perfilesAplicados.join(', ')}` 
                                : 'Precio Base'
                        };
                    }
                    return l;
                }));
            }
        } catch (err) {
            console.error('Error recalculando precio:', err);
        }
    };

    // Cuando se selecciona un cliente → actualizar form con sus datos DGI
    const seleccionarCliente = (c) => {
        setClienteSel(c);
        setClientesRes([]);
        setQCliente('');
        // Buscar el departamento correspondiente por ID para auto-rellenar Ciudad/Depto
        let deptoNombre = '';
        if (c.DepartamentoID && departamentos.length > 0) {
            const found = departamentos.find(d => d.ID === c.DepartamentoID || d.id === c.DepartamentoID);
            if (found) deptoNombre = found.Nombre;
        }
        
        const newClienteId = c.CliIdCliente;
        setForm(prev => ({
            ...prev,
            CliIdCliente:    newClienteId,
            DocCliNombre:    getClienteDisplayName(c),
            DocCliDocumento: c.CioRuc || c.IDCliente || '',
            DocCliDireccion: c.DireccionTrabajo || '',
            DocCliCiudad:    deptoNombre || prev.DocCliCiudad || '',
        }));

        // Recalcular precios de todas las líneas que coincidan con productos (solo nuevas)
        setTimeout(() => {
            lineas.forEach((l, idx) => {
                if (!l.DcdIdDetalle) {
                    recalcularPrecioLinea(idx, l, newClienteId, form.MonIdMoneda);
                }
            });
        }, 100);
    };

    const handleSetConsumidorFinal = () => {
        setForm(prev => ({
            ...prev,
            DocCliNombre: 'Consumidor Final',
            DocCliDocumento: '',
            DocCliDireccion: '',
            DocCliCiudad: 'Montevideo'
        }));
        toast.info('Campos DGI cambiados a Consumidor Final');
    };

    const handleRestoreFichaCliente = () => {
        if (!clienteSel) {
            toast.error('Debe buscar y seleccionar un cliente primero');
            return;
        }
        let deptoNombre = '';
        if (clienteSel.DepartamentoID && departamentos.length > 0) {
            const found = departamentos.find(d => d.ID === clienteSel.DepartamentoID || d.id === clienteSel.DepartamentoID);
            if (found) deptoNombre = found.Nombre;
        }
        setForm(prev => ({
            ...prev,
            DocCliNombre: getClienteDisplayName(clienteSel),
            DocCliDocumento: clienteSel.CioRuc || clienteSel.IDCliente || '',
            DocCliDireccion: clienteSel.DireccionTrabajo || '',
            DocCliCiudad: deptoNombre || prev.DocCliCiudad || '',
        }));
        toast.success('Datos DGI restablecidos desde la ficha del cliente');
    };

    const handleUpdateClientDGI = async () => {
        if (!form.CliIdCliente || Number(form.CliIdCliente) <= 1) {
            toast.error('Debe seleccionar un cliente válido para actualizar su ficha.');
            return;
        }
        if (!form.DocCliNombre || !form.DocCliDocumento || !form.DocCliDireccion || !form.DocCliCiudad) {
            toast.error('Todos los campos (Nombre, Documento, Dirección, Ciudad/Depto) son obligatorios para actualizar la ficha.');
            return;
        }

        const depObj = departamentos.find(d => d.Nombre === form.DocCliCiudad);
        const depId = depObj ? depObj.ID || depObj.id : null;
        if (!depId) {
            toast.error('El departamento seleccionado no es válido.');
            return;
        }

        setUpdatingClient(true);
        try {
            await api.patch(`/contabilidad/clientes/${form.CliIdCliente}/dgi`, {
                Nombre: form.DocCliNombre,
                Documento: form.DocCliDocumento,
                Direccion: form.DocCliDireccion,
                Ciudad: depId
            });
            toast.success('Ficha del cliente actualizada con éxito');
        } catch (err) {
            toast.error('Error al actualizar ficha: ' + (err.response?.data?.error || err.message));
        } finally {
            setUpdatingClient(false);
        }
    };

    // Recalcular totales desde líneas
    useEffect(() => {
        if (!lineas.length) return;
        const editables = lineas.filter(l => !esLineaAgrupacion(l.DcdNomItem));
        let total = 0;
        let subtotal = 0;
        editables.forEach(l => {
            const qty = parseFloat(l.DcdCantidad) || 0;
            const price = parseFloat(l.DcdPrecioUnitario) || 0;
            const r = (l.ivaRate !== undefined && l.ivaRate !== null) ? parseFloat(l.ivaRate) : 22;
            const lineTotal = qty * price;
            const lineNeto = lineTotal / (1 + r / 100);
            total += lineTotal;
            subtotal += lineNeto;
        });
        setForm(prev => ({
            ...prev,
            DocSubtotal: parseFloat(subtotal.toFixed(2)),
            DocImpuestos: parseFloat((total - subtotal).toFixed(2)),
            DocTotal: parseFloat(total.toFixed(2))
        }));
    }, [lineas]);

    const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
    const handleLineaChange = async (idx, updated) => {
        const originalLinea = lineas[idx];
        const descChanged = updated.DcdNomItem !== originalLinea?.DcdNomItem;
        const cantChanged = updated.DcdCantidad !== originalLinea?.DcdCantidad;
        const ivaChanged = updated.ivaRate !== originalLinea?.ivaRate;

        setLineas(prev => prev.map((l, i) => i === idx ? updated : l));

        if ((descChanged || cantChanged) && updated.DcdNomItem && !ivaChanged) {
            const match = articulos.find(a => a.NombreArticulo === updated.DcdNomItem);
            if (match) {
                try {
                    const res = await api.post('/prices/calculate', {
                        codArticulo: match.CodigoArticulo,
                        cantidad: parseFloat(updated.DcdCantidad) || 1,
                        clienteId: form.CliIdCliente ? Number(form.CliIdCliente) : null,
                        targetCurrency: form.MonIdMoneda === 2 ? 'USD' : 'UYU'
                    });
                    
                    if (res.data && res.data.precioUnitario !== undefined) {
                        const price = Number(res.data.precioUnitario);
                        setLineas(prev => prev.map((l, i) => {
                            if (i === idx) {
                                const qty = parseFloat(l.DcdCantidad) || 0;
                                const r = (l.ivaRate !== undefined && l.ivaRate !== null) ? parseFloat(l.ivaRate) : 22;
                                const lineTotal = qty * price;
                                const lineNeto = lineTotal / (1 + r / 100);
                                const lineIva = lineTotal - lineNeto;
                                return {
                                    ...l,
                                    DcdPrecioUnitario: price,
                                    DcdSubtotal: parseFloat(lineNeto.toFixed(4)),
                                    DcdImpuestos: parseFloat(lineIva.toFixed(4)),
                                    DcdTotal: parseFloat(lineTotal.toFixed(4)),
                                    precioNote: res.data.perfilesAplicados?.length 
                                        ? `Tarifa: ${res.data.perfilesAplicados.join(', ')}` 
                                        : 'Precio Base'
                                };
                            }
                            return l;
                        }));
                        toast.success(`Precio cargado: ${form.MonIdMoneda === 2 ? 'U$S' : '$'} ${price} (Perfil: ${res.data.perfilesAplicados?.join(', ') || 'Precio Base'})`);
                    }
                } catch (err) {
                    console.error('Error calculando precio:', err);
                }
            }
        }
    };
    const handleEliminar = (idx) => setLineas(prev => prev.filter((_, i) => i !== idx));

    const handleAddLinea = () => {
        setLineas(prev => [...prev, {
            DcdIdDetalle: null,
            DcdNomItem: '',
            DcdDscItem: '',
            DcdCantidad: 1,
            DcdPrecioUnitario: 0,
            DcdSubtotal: 0,
            DcdImpuestos: 0,
            DcdTotal: 0,
            ivaRate: 22
        }]);
    };

    const handleSave = async () => {
        if (form.DocTipo.toUpperCase().includes('FACTURA')) {
            const isConsumidorFinal = 
                (clienteSel && (clienteSel.CliIdCliente === 1 || clienteSel.CliIdCliente === 100101 || getClienteDisplayName(clienteSel).toLowerCase().includes('consumidor final'))) ||
                (!clienteSel && (form.CliIdCliente === 1 || form.CliIdCliente === 100101 || form.DocCliNombre?.toLowerCase().includes('consumidor final')));

            if (isConsumidorFinal) {
                toast.error('Las e-Facturas (débito o crédito) no pueden emitirse a Consumidor Final. Seleccione un cliente con RUT.');
                return;
            }
            if (!form.DocCliDocumento || form.DocCliDocumento.replace(/\D/g, '').length < 11) {
                toast.error('Las E-Facturas requieren un número de RUT válido.');
                return;
            }
        } else if (form.DocTipo.toUpperCase().includes('TICKET')) {
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
                    DcdDscItem:         l.DcdDscItem || '',
                    DcdCantidad:        parseFloat(l.DcdCantidad) || 1,
                    DcdPrecioUnitario:  parseFloat(l.DcdPrecioUnitario) || 0,
                    DcdSubtotal:        parseFloat(l.DcdSubtotal) || 0,
                    DcdImpuestos:       parseFloat(l.DcdImpuestos) || 0,
                    DcdTotal:           parseFloat(l.DcdTotal) || 0,
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
                                    onChange={e => {
                                        const newMonId = parseInt(e.target.value);
                                        setField('MonIdMoneda', newMonId);
                                        // Recalcular precios de todas las líneas que coincidan con productos (solo nuevas)
                                        setTimeout(() => {
                                            lineas.forEach((l, idx) => {
                                                if (!l.DcdIdDetalle) {
                                                    recalcularPrecioLinea(idx, l, form.CliIdCliente, newMonId);
                                                }
                                            });
                                        }, 100);
                                    }}
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
                                            <p className="text-sm font-black text-indigo-900 truncate">{getClienteDisplayName(clienteSel)}</p>
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
                                <div className="relative client-search-container">
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
                                                        {getClienteDisplayName(c)[0] || 'C'}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-slate-800">{getClienteDisplayName(c)}</p>
                                                        {c.Nombre && c.NombreFantasia && c.Nombre.trim() !== c.NombreFantasia.trim() && <p className="text-xs text-slate-400 font-medium italic">"{c.NombreFantasia}"</p>}
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
                            <div className="flex items-center gap-2">
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Datos DGI del Comprobante</h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleSetConsumidorFinal}
                                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 hover:border-purple-300 transition-colors cursor-pointer"
                                    >
                                        Consumidor Final
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRestoreFichaCliente}
                                        disabled={!clienteSel}
                                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Ficha Cliente
                                    </button>
                                    
                                    {form.CliIdCliente && Number(form.CliIdCliente) > 1 && (
                                        <button
                                            type="button"
                                            onClick={handleUpdateClientDGI}
                                            disabled={updatingClient}
                                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                            {updatingClient ? (
                                                <Loader2 size={11} className="animate-spin" />
                                            ) : (
                                                <UserCheck size={11} />
                                            )}
                                            Actualizar Ficha
                                        </button>
                                    )}
                                </div>
                            </div>
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
                                <div className="relative">
                                    <select
                                        value={form.DocCliCiudad}
                                        onChange={e => setField('DocCliCiudad', e.target.value)}
                                        className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-2 focus:ring-indigo-400 outline-none appearance-none pr-6 font-medium text-slate-700 font-sans"
                                    >
                                        <option value="">— Seleccionar —</option>
                                        {departamentos.map(dep => (
                                            <option key={dep.ID || dep.id} value={dep.Nombre}>{dep.Nombre}</option>
                                        ))}
                                        {form.DocCliCiudad && !departamentos.find(d => d.Nombre === form.DocCliCiudad) && (
                                            <option value={form.DocCliCiudad}>{form.DocCliCiudad}</option>
                                        )}
                                    </select>
                                    <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Líneas de detalle ── */}
                    <div>
                        <datalist id="articulos-list">
                            {articulos.map((art, i) => (
                                <option key={art.IDArticulo || i} value={art.NombreArticulo}>
                                    {art.CodigoArticulo ? `[${art.CodigoArticulo}]` : ''}
                                </option>
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
                                                <th className="px-2 py-3 w-20 text-right">Cantidad</th>
                                                <th className="px-2 py-3 w-24 text-right">P. Unitario</th>
                                                <th className="px-2 py-3 w-20 text-center">IVA %</th>
                                                <th className="px-2 py-3 w-24 text-right">Subtotal Neto</th>
                                                <th className="px-2 py-3 w-24 text-right">Total con IVA</th>
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
                        &nbsp;·&nbsp;<span className={doc.CfeEstado === 'BORRADOR' ? "text-purple-600 font-bold" : "text-amber-600 font-bold"}>
                            {doc.CfeEstado === 'BORRADOR' ? 'BORRADOR' : 'PENDIENTE DGI'}
                        </span>
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
