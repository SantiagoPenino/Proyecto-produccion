import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Search, Loader2, Save, Trash2, Download, Filter, RefreshCcw, CheckSquare, Square, ChevronDown, CheckCircle, Database, X, Ban, Check, User, Hash, Truck, SearchX, ListChecks, FileText, AlertTriangle, CalendarDays, LayoutGrid, List } from 'lucide-react';
import api from '../../services/api';
import { utils, writeFile } from 'xlsx';
import Swal from 'sweetalert2';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, filtros, acciones masivas y tabla en tarjetas
// blancas con borde, ícono Lucide en brand-cyan sin fondo, fechas y selects propios (SelectorFecha / Selector) y el
// color solo para el estado de la orden. Los avisos y confirmaciones de Swal pasan al tema claro. Lógica sin cambios.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_DESTRUCTIVO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-500 enabled:hover:text-rose-600 enabled:hover:border-rose-200 enabled:hover:bg-rose-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ROTULO = 'block text-[11px] font-black text-zinc-400 uppercase tracking-wide mb-1.5';
const BADGE = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';
const ICONO_CAMPO = 'absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none';

// Color del chip de estado (solo presentación): verde lo entregado, rojo lo cancelado o perdido, ámbar lo que espera
// un aviso o bultos, brand-cyan lo que está pronto o en camino; el resto en gris.
const COLOR_ESTADO = {
    'entregado': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'cancelado': 'bg-rose-50 text-rose-700 border-rose-200',
    'perdida': 'bg-rose-50 text-rose-700 border-rose-200',
    'para avisar': 'bg-amber-50 text-amber-700 border-amber-200',
    'avisar nuevamente': 'bg-amber-50 text-amber-700 border-amber-200',
    'esperando bultos': 'bg-amber-50 text-amber-700 border-amber-200',
    'empaquetado sin abonar': 'bg-amber-50 text-amber-700 border-amber-200',
    'pronto': 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20',
    'pronto para entregar': 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20',
    'avisado': 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20',
    'en camino': 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20',
    'en viaje': 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20',
    'empaquetado y abonado': 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20',
};
const claseEstado = (estado) => COLOR_ESTADO[String(estado || '').trim().toLowerCase()] || 'bg-zinc-100 text-zinc-600 border-zinc-200';

// Vista del resultado (28/10/2026): tarjetas o filas, a elección; se recuerda en este navegador. En el celular siempre
// tarjetas: la tabla de 10 columnas no entra a 390 px.
const MQ_TABLA = '(min-width: 768px)';
function useConTabla() {
    const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_TABLA);
        const cambio = () => setConTabla(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return conTabla;
}
const VISTAS = [['tarjetas', LayoutGrid, 'Tarjetas'], ['filas', List, 'Filas']];
const segmento = (activo) => `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
    activo ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`;
const TH = 'px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-zinc-400';

// El backend (/apiordenes/datafilter) manda la fecha de ingreso ya como texto en-US, hora de Montevideo
// («10/26/2026, 8:48:43 PM»): se muestra DD/MM/AA HH:mm en 24 h, como el resto del sistema. Otra forma, tal cual.
const fechaIngreso = (v) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)$/i.exec(String(v || '').trim());
    if (!m) return v || '-';
    const h = (Number(m[4]) % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(m[2])}/${p(m[1])}/${m[3].slice(-2)} ${p(h)}:${m[5]}`;
};

const Toast = Swal.mixin({
    toast: true,
    position: 'bottom-end',
    showConfirmButton: false,
    timer: 3500,
    timerProgressBar: true,
});

const OrderSearchPage = () => {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [orders, setOrders] = useState([]);
    // Tarjetas o filas de a 50: una búsqueda por fechas puede traer miles. Al acercarse al final se agregan 50 más; vuelve a
    // 50 con cada búsqueda. La selección («seleccionar todas», acciones masivas, Excel) sigue tomando todas las órdenes.
    const [verOrdenes, setVerOrdenes] = useState(50);
    useEffect(() => { setVerOrdenes(50); }, [orders]);
    const obsOrdenes = useRef(null);
    const centinelaOrdenes = useCallback((nodo) => {
        if (obsOrdenes.current) obsOrdenes.current.disconnect();
        if (!nodo) return;
        obsOrdenes.current = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVerOrdenes(v => v + 50); },
            { rootMargin: '0px 0px 600px 0px' });
        obsOrdenes.current.observe(nodo);
    }, []);
    const conTabla = useConTabla();
    // Por defecto, filas (28/10, pedido de Santiago); si el navegador ya eligió una, queda esa.
    const [vista, setVista] = useState(() => { try { return localStorage.getItem('buscarOrdenes.vista') || 'filas'; } catch (_) { return 'filas'; } });
    const cambiarVista = (v) => { setVista(v); try { localStorage.setItem('buscarOrdenes.vista', v); } catch (_) { /* nada */ } };
    const enFilas = conTabla && vista === 'filas';
    const [selectedOrders, setSelectedOrders] = useState(new Set());
    const [estadosOrden, setEstadosOrden] = useState([]);
    const [tiposClientes, setTiposClientes] = useState([]);
    const [selectedOrderDetail, setSelectedOrderDetail] = useState(null);
    const dropdownRef = useRef(null);

    // Filters match the old BaseDeposito.js state
    const [filters, setFilters] = useState({
        codigoCliente: '',
        estados: [], // array of strings
        fechaDesde: '',
        fechaHasta: '',
        codigoOrden: '',
        tipoCliente: '',
        numeroRetiro: ''
    });

    const [nuevoEstado, setNuevoEstado] = useState('');
    const [loading, setLoading] = useState(false);
    const [bulkUpdating, setBulkUpdating] = useState(false);

    useEffect(() => {
        fetchEstadosOrdenes();
        fetchTiposClientes();

        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const fetchEstadosOrdenes = async () => {
        try {
            const res = await api.get('/apiordenes/estados/list');
            setEstadosOrden(res.data || []);
        } catch (error) {
            console.error('Error al obtener estados de órdenes:', error);
            Toast.fire({ icon: 'error', title: 'Error al cargar la lista de estados' });
        }
    };

    const fetchTiposClientes = async () => {
        try {
            const res = await api.get('/clients/tipos');
            setTiposClientes(res.data || []);
        } catch (error) {
            console.error('Error al obtener tipos de clientes:', error);
            // toast.error('Error al cargar la lista de tipos de cliente'); // Silent error or handle differently
        }
    };

    const fetchAllOrders = async (currentFilters = filters) => {
        const hasFilters =
            currentFilters.codigoCliente ||
            currentFilters.codigoOrden ||
            currentFilters.fechaDesde ||
            currentFilters.fechaHasta ||
            currentFilters.tipoCliente ||
            currentFilters.numeroRetiro ||
            (currentFilters.estados && currentFilters.estados.length > 0);

        if (!hasFilters) {
            Toast.fire({ icon: 'warning', title: 'Por favor ingresá al menos un filtro de búsqueda.' });
            return;
        }

        try {
            setLoading(true);
            setOrders([]); // clear
            setSelectedOrders(new Set()); // clear selection

            const queryParams = new URLSearchParams();
            if (currentFilters.codigoCliente) queryParams.append("codigoCliente", currentFilters.codigoCliente);
            if (currentFilters.codigoOrden) queryParams.append("codigoOrden", currentFilters.codigoOrden);
            if (currentFilters.fechaDesde) queryParams.append("fechaDesde", currentFilters.fechaDesde);
            if (currentFilters.fechaHasta) queryParams.append("fechaHasta", currentFilters.fechaHasta);
            if (currentFilters.tipoCliente) queryParams.append("tipoCliente", currentFilters.tipoCliente);
            if (currentFilters.numeroRetiro) queryParams.append("numeroRetiro", currentFilters.numeroRetiro);
            if (currentFilters.estados && currentFilters.estados.length > 0) {
                currentFilters.estados.forEach(est => queryParams.append("estado", est));
            }

            const response = await api.get(`/apiordenes/datafilter?${queryParams.toString()}`);
            if (Array.isArray(response.data)) {
                setOrders(response.data);
                if (response.data.length === 0) {
                    Toast.fire({ icon: 'info', title: 'No se encontraron órdenes con esos filtros.' });
                } else {
                    Toast.fire({ icon: 'success', title: `Se encontraron ${response.data.length} órdenes.` });
                }
            } else {
                Toast.fire({ icon: 'error', title: 'La respuesta del servidor fue inválida.' });
            }
        } catch (error) {
            console.error('Error buscando ordenes:', error);
            Toast.fire({ icon: 'error', title: 'Error al realizar la búsqueda.' });
        } finally {
            setLoading(false);
        }
    };

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const resetFilters = () => {
        setFilters({
            codigoCliente: '',
            estados: [],
            fechaDesde: '',
            fechaHasta: '',
            codigoOrden: '',
            tipoCliente: '',
            numeroRetiro: ''
        });
        setOrders([]);
        setSelectedOrders(new Set());
    };

    const toggleOrderSelection = (idOrden) => {
        setSelectedOrders(prev => {
            const next = new Set(prev);
            if (next.has(idOrden)) next.delete(idOrden);
            else next.add(idOrden);
            return next;
        });
    };

    const toggleAllSelection = () => {
        if (selectedOrders.size === orders.length && orders.length > 0) {
            setSelectedOrders(new Set());
        } else {
            setSelectedOrders(new Set(orders.map(o => o.IdOrden)));
        }
    };

    // ACCIONES EN LOTE
    const handleUpdateEstado = async () => {
        if (selectedOrders.size === 0) {
            Toast.fire({ icon: 'warning', title: 'No hay órdenes seleccionadas.' });
            return;
        }
        if (!nuevoEstado) {
            Toast.fire({ icon: 'warning', title: 'Seleccioná el nuevo estado.' });
            return;
        }

        try {
            setBulkUpdating(true);

            // Replicando viejo endpoint /apiordenes/actualizarEstado
            await api.post('/apiordenes/actualizarEstado', {
                nuevoEstado: nuevoEstado,
                orderIds: Array.from(selectedOrders)
            });

            Toast.fire({ icon: 'success', title: `Se actualizaron ${selectedOrders.size} órdenes a ${nuevoEstado}` });
            setSelectedOrders(new Set());
            setNuevoEstado('');
            fetchAllOrders(filters); // recargar
        } catch (error) {
            console.error('Error batch update:', error);
            Toast.fire({ icon: 'error', title: 'Hubo un problema al actualizar estados.' });
        } finally {
            setBulkUpdating(false);
        }
    };

    const handleAnularRetiro = async () => {
        if (selectedOrders.size === 0) return;

        // Identificar los retiros involucrados en la selección
        const selectedOrderObjects = orders.filter(o => selectedOrders.has(o.IdOrden));
        const retiros = Array.from(new Set(selectedOrderObjects.map(o => o.OrdenRetiro).filter(Boolean)));

        if (retiros.length === 0) {
            Toast.fire({ icon: 'warning', title: 'Ninguna de las órdenes seleccionadas pertenece a un retiro.' });
            return;
        }

        if (retiros.length > 1) {
            Toast.fire({ icon: 'warning', title: 'Seleccionaste órdenes de diferentes retiros. Seleccioná solo de uno.' });
            return;
        }

        const idRetiro = retiros[0];

        const { value: motivo } = await Swal.fire({
            title: 'Anular Orden de Retiro',
            html: `¿Estás seguro de que deseas anular el retiro <strong>${idRetiro}</strong>?<br>Las órdenes volverán a estar disponibles para un nuevo retiro.`,
            input: 'text',
            inputLabel: 'Motivo de la anulación',
            inputPlaceholder: 'Ej: Error en bultos, Cliente cancela...',
            showCancelButton: true,
            confirmButtonText: 'Anular Retiro',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#e11d48',
            inputValidator: (value) => {
                if (!value) return 'Debes ingresar un motivo';
            }
        });

        if (!motivo) return;

        try {
            setBulkUpdating(true);
            const idLimpio = String(idRetiro).replace(/^[A-Za-z]+-/, '');
            console.log(`[DEBUG] Intentando anular retiro. URL: /web-retiros/anular/${idLimpio}`);
            await api.post(`/web-retiros/anular/${idLimpio}`, { motivo });

            Toast.fire({ icon: 'success', title: 'Orden de retiro anulada correctamente.' });
            setSelectedOrders(new Set());
            fetchAllOrders(filters);
        } catch (error) {
            console.error('Error anular retiro:', error);
            const msg = error.response?.data?.error || error.response?.data?.message || error.message || 'Error al anular retiro.';
            Swal.fire({ icon: 'error', title: 'No se pudo anular', text: msg, confirmButtonColor: '#006E97' });
        } finally {
            setBulkUpdating(false);
        }
    };

    const handleDeleteOrders = async () => {

        if (selectedOrders.size === 0) return;

        const { value } = await Swal.fire({
            title: '¿Eliminar órdenes?',
            html: `Vas a eliminar <strong>${selectedOrders.size}</strong> orden(es). Esta acción <strong>no se puede deshacer</strong>.<br><br>Escribí <strong>ELIMINAR</strong> para confirmar.`,
            input: 'text',
            inputPlaceholder: 'ELIMINAR',
            inputAttributes: { autocomplete: 'off' },
            showCancelButton: true,
            confirmButtonText: 'Confirmar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#e11d48',
            didOpen: () => {
                const confirmBtn = Swal.getConfirmButton();
                const input = Swal.getInput();
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.4';
                confirmBtn.style.cursor = 'not-allowed';
                input.addEventListener('input', () => {
                    const ok = input.value === 'ELIMINAR';
                    confirmBtn.disabled = !ok;
                    confirmBtn.style.opacity = ok ? '1' : '0.4';
                    confirmBtn.style.cursor = ok ? 'pointer' : 'not-allowed';
                });
            },
            preConfirm: (val) => val === 'ELIMINAR',
        });

        if (!value) return;

        try {
            setBulkUpdating(true);
            // Replicando viejo endpoint /apiordenes/eliminar (usualmente data:{ordenes:[id,id]})
            await api.request({
                url: '/apiordenes/eliminar',
                method: 'DELETE',
                data: { orderIds: Array.from(selectedOrders) }
            });

            Toast.fire({ icon: 'success', title: 'Órdenes eliminadas correctamente.' });
            setSelectedOrders(new Set());
            fetchAllOrders(filters);
        } catch (error) {
            console.error('Error deleting:', error);
            Toast.fire({ icon: 'error', title: 'Error al eliminar órdenes.' });
        } finally {
            setBulkUpdating(false);
        }
    };

    // ─── Estado para el modal de confirmación de re-exportación ────────────────
    const [reexportConfirm, setReexportConfirm] = useState(null); // null | { yaExportadas, pendientes, exportables }

    const handleDownloadExcel = async () => {
        if (orders.length === 0) {
            Toast.fire({ icon: 'warning', title: 'No hay órdenes para exportar.' });
            return;
        }

        const yaExportadas = orders.filter(o => o.ExportadoOdoo === true || o.ExportadoOdoo === 1);
        const pendientes   = orders.filter(o => o.ExportadoOdoo === false || o.ExportadoOdoo === null);

        // Si hay órdenes ya exportadas → mostrar confirmación custom antes de seguir
        if (yaExportadas.length > 0) {
            setReexportConfirm({ yaExportadas, pendientes });
            return;
        }

        await doExport(pendientes);
    };

    // Ejecuta la exportación real (llamada desde handleDownloadExcel o desde el modal de confirmación)
    const doExport = async (aExportar) => {
        setReexportConfirm(null);

        if (aExportar.length === 0) {
            Toast.fire({ icon: 'info', title: 'No hay órdenes pendientes de exportación.' });
            return;
        }

        // Detectar las que no tienen ProCodigoOdooProducto (solo aviso, no bloquean)
        const sinCodigo = aExportar.filter(o => !o.ProCodigoOdooProducto || o.ProCodigoOdooProducto.trim() === '');
        if (sinCodigo.length > 0) {
            Toast.fire({ icon: 'warning', title: `${sinCodigo.length} orden(es) sin Código Odoo: la celda quedará vacía.` });
        }

        // Helper: trim seguro para strings
        const t = (v) => (typeof v === 'string' ? v.trim() : v);

        try {
            const filas = aExportar.map(order => ({
                'Líneas del pedido/Producto': order.ProCodigoOdooProducto
                    ? t(order.ProCodigoOdooProducto) + (t(order.Modo) === 'Normal' ? 'N' : t(order.Modo) === 'Urgente' ? 'U' : '')
                    : '',
                'Referencia del pedido':       t(order.CodigoOrden),
                'Líneas del pedido/Cantidad':  order.Cantidad ? parseFloat(order.Cantidad) : 0,
                'Cliente':                     t(order.IdCliente),
                'Referencia cliente':          t(order.NombreTrabajo),
                'Modo':                        t(order.Modo),
            }));

            const worksheet = utils.json_to_sheet(filas);
            const workbook  = utils.book_new();
            utils.book_append_sheet(workbook, worksheet, 'Órdenes');
            writeFile(workbook, `Ordenes_Odoo_${new Date().toISOString().slice(0,10)}.xlsx`);

            // Marcar como exportadas en la DB
            const orderIds = aExportar.map(o => o.IdOrden);
            await api.post('/apiordenes/actualizarExportacion', { orderIds });

            Toast.fire({ icon: 'success', title: `${aExportar.length} orden(es) exportadas y marcadas correctamente.` });
            fetchAllOrders(filters);

        } catch (error) {
            console.error('EXCEL ERROR:', error);
            Toast.fire({ icon: 'error', title: 'Error al generar Excel o marcar exportación.' });
        }
    };

    // Manejo de Estados MultiSelect Simplificado (Tailwind custom render)
    const handleEstadoToggle = (estado) => {
        setFilters(prev => {
            const set = new Set(prev.estados);
            if (set.has(estado)) set.delete(estado);
            else set.add(estado);
            return { ...prev, estados: Array.from(set) };
        });
    };

    const handleSelectAllEstados = (e) => {
        e.stopPropagation();
        if (filters.estados.length === estadosOrden.length) {
            setFilters(prev => ({ ...prev, estados: [] }));
        } else {
            setFilters(prev => ({ ...prev, estados: estadosOrden.map(est => est.Estado || est.EOrNombreEstado) }));
        }
    };

    const allSelected = orders.length > 0 && selectedOrders.size === orders.length;

    return (
        <div className="p-3 md:p-6 bg-slate-50 min-h-full font-sans text-zinc-800 flex flex-col gap-4 animate-in fade-in duration-300">
            {/* Header Tipo Base Datos de Ordenes */}
            <div className="flex items-center gap-3 min-w-0">
                <Database size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                <div className="min-w-0">
                    <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Base de Datos de Órdenes</h1>
                    <p className="text-sm text-zinc-400">Buscador global multiplataforma. Use los filtros para actualizar estados en masivo.</p>
                </div>
            </div>

            {/* Main Filters Module (Like Old View) */}
            <div className={`${CARD} p-4 md:p-5`}>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                    <div className="min-w-0">
                        <label htmlFor="bdo-codigoCliente" className={ROTULO}>Código Cliente</label>
                        <div className="relative">
                            <User size={15} className={ICONO_CAMPO} />
                            <input
                                id="bdo-codigoCliente"
                                type="text"
                                name="codigoCliente"
                                value={filters.codigoCliente}
                                onChange={handleFilterChange}
                                onKeyDown={(e) => e.key === 'Enter' && fetchAllOrders()}
                                placeholder="Ej. MACROSOFT"
                                className={CAMPO}
                            />
                        </div>
                    </div>
                    <div className="min-w-0">
                        <label htmlFor="bdo-codigoOrden" className={ROTULO}>Código Orden</label>
                        <div className="relative">
                            <Hash size={15} className={ICONO_CAMPO} />
                            <input
                                id="bdo-codigoOrden"
                                type="text"
                                name="codigoOrden"
                                value={filters.codigoOrden}
                                onChange={handleFilterChange}
                                onKeyDown={(e) => e.key === 'Enter' && fetchAllOrders()}
                                placeholder="Ej. O-1234..."
                                className={CAMPO}
                            />
                        </div>
                    </div>
                    <div className="min-w-0">
                        <label htmlFor="bdo-fechaDesde" className={ROTULO}>Fecha Desde</label>
                        <SelectorFecha
                            id="bdo-fechaDesde"
                            name="fechaDesde"
                            value={filters.fechaDesde}
                            onChange={handleFilterChange}
                            vaciable
                        />
                    </div>
                    <div className="min-w-0">
                        <label htmlFor="bdo-fechaHasta" className={ROTULO}>Fecha Hasta</label>
                        <SelectorFecha
                            id="bdo-fechaHasta"
                            name="fechaHasta"
                            value={filters.fechaHasta}
                            onChange={handleFilterChange}
                            vaciable
                        />
                    </div>
                    <div className="min-w-0">
                        <label htmlFor="bdo-tipoCliente" className={ROTULO}>Tipo de Cliente</label>
                        <Selector
                            id="bdo-tipoCliente"
                            name="tipoCliente"
                            value={filters.tipoCliente}
                            onChange={handleFilterChange}
                        >
                            <option value="">TODOS</option>
                            {tiposClientes.map(tc => (
                                <option key={tc.TClIdTipoCliente} value={tc.TClIdTipoCliente}>
                                    {tc.TClDescripcion}
                                </option>
                            ))}
                        </Selector>
                    </div>
                    <div className="min-w-0">
                        <label htmlFor="bdo-numeroRetiro" className={ROTULO}>N° Retiro</label>
                        <div className="relative">
                            <Truck size={15} className={ICONO_CAMPO} />
                            <input
                                id="bdo-numeroRetiro"
                                type="text"
                                name="numeroRetiro"
                                value={filters.numeroRetiro}
                                onChange={handleFilterChange}
                                onKeyDown={(e) => e.key === 'Enter' && fetchAllOrders()}
                                placeholder="Ej. RL-1234"
                                className={CAMPO}
                            />
                        </div>
                    </div>
                </div>

                {/* Multiselect Estados Combo */}
                <div ref={dropdownRef} className="mt-4">
                    <label htmlFor="bdo-estados" className={ROTULO}>Estados a Filtrar</label>
                    <div className="flex flex-col md:flex-row md:items-start gap-2">
                        <div className="relative w-full md:w-80 shrink-0">
                            <button
                                id="bdo-estados"
                                type="button"
                                onClick={() => setDropdownOpen(!dropdownOpen)}
                                aria-expanded={dropdownOpen}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-white border rounded-xl text-sm text-left outline-none transition-colors focus-visible:border-brand-cyan focus-visible:ring-2 focus-visible:ring-brand-cyan/15 ${
                                    dropdownOpen ? 'border-brand-cyan ring-2 ring-brand-cyan/15'
                                        : filters.estados.length > 0 ? 'border-brand-cyan/40 hover:border-brand-cyan/60'
                                            : 'border-zinc-200 hover:border-zinc-300'}`}
                            >
                                <span className={`truncate ${filters.estados.length === 0 ? 'text-zinc-400' : 'font-bold text-brand-cyan'}`}>
                                    {filters.estados.length === 0
                                        ? 'Seleccione estados...'
                                        : `${filters.estados.length} estado(s) seleccionado(s)`}
                                </span>
                                <ChevronDown size={16} className={`shrink-0 transition-transform duration-200 ${dropdownOpen ? 'rotate-180 text-brand-cyan' : filters.estados.length > 0 ? 'text-brand-cyan' : 'text-zinc-400'}`} />
                            </button>

                            {dropdownOpen && (
                                <div className="absolute z-30 left-0 right-0 mt-1.5 p-1 bg-white border border-zinc-200 rounded-xl shadow-xl shadow-zinc-900/10 max-h-80 overflow-y-auto overscroll-contain animate-in fade-in slide-in-from-top-2">
                                    <button
                                        type="button"
                                        onClick={handleSelectAllEstados}
                                        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-[11px] font-black uppercase tracking-wide text-zinc-500 hover:bg-zinc-50 transition-colors"
                                    >
                                        <span>Seleccionar Todos ({estadosOrden.length})</span>
                                        {filters.estados.length === estadosOrden.length && <CheckCircle size={14} className="shrink-0 text-brand-cyan" />}
                                    </button>
                                    <div className="mx-1 my-1 border-t border-zinc-100" />
                                    {estadosOrden.map((est) => {
                                        const selected = filters.estados.includes(est.Estado || est.EOrNombreEstado);
                                        return (
                                            <button
                                                type="button"
                                                key={est.IdEstadoOrden || est.Estado || est.EOrNombreEstado}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleEstadoToggle(est.Estado || est.EOrNombreEstado);
                                                }}
                                                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors ${selected ? 'bg-brand-cyan/5 text-brand-cyan font-bold' : 'text-zinc-700 hover:bg-zinc-50'}`}
                                            >
                                                <span>{est.Estado || est.EOrNombreEstado}</span>
                                                {selected && <Check size={15} className="shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Selected Filters Chips */}
                        {filters.estados.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 md:pt-2 animate-in fade-in zoom-in-95 duration-200">
                                {filters.estados.map(est => (
                                    <span key={est} className={`${BADGE} inline-flex items-center gap-1 bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20 cursor-default`}>
                                        {est}
                                        <X
                                            size={14}
                                            className="cursor-pointer rounded-full p-0.5 hover:bg-brand-cyan/15"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleEstadoToggle(est);
                                            }}
                                        />
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Action Row 1: Filters */}
                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-zinc-100">
                    <button
                        type="button"
                        onClick={() => fetchAllOrders(filters)}
                        disabled={loading}
                        className={BTN_PRINCIPAL}
                    >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} />}
                        Filtrar
                    </button>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className={BTN_SECUNDARIO}
                    >
                        <RefreshCcw size={15} /> Restablecer
                    </button>
                    <button
                        type="button"
                        onClick={handleDownloadExcel}
                        className={`${BTN_SECUNDARIO} sm:ml-auto`}
                    >
                        <Download size={15} /> Descargar Excel
                    </button>
                </div>
            </div>

            {/* Action Row 2: Bulk Updaters */}
            <div className={`${CARD} p-3 md:p-4 flex flex-col lg:flex-row lg:items-center gap-3`}>
                <div className="flex items-center gap-2.5 min-w-0">
                    <ListChecks size={20} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <p className="text-sm font-black text-zinc-800">Acciones masivas</p>
                        <p className="text-xs text-zinc-400">
                            {selectedOrders.size === 0 ? 'Marcá órdenes en la lista para usarlas.' : `${selectedOrders.size} orden(es) seleccionada(s)`}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 lg:ml-auto">
                    <Selector
                        value={nuevoEstado}
                        onChange={(e) => setNuevoEstado(e.target.value)}
                        aria-label="Nuevo estado"
                        className="sm:w-56"
                    >
                        <option value="">Nuevo estado...</option>
                        {estadosOrden.map(e => <option key={e.IdEstadoOrden || e.Estado || e.EOrNombreEstado} value={e.Estado || e.EOrNombreEstado}>{e.Estado || e.EOrNombreEstado}</option>)}
                    </Selector>

                    <button
                        type="button"
                        disabled={selectedOrders.size === 0 || !nuevoEstado || bulkUpdating}
                        onClick={handleUpdateEstado}
                        className={`${BTN_PRINCIPAL} whitespace-nowrap flex-1 sm:flex-none`}
                    >
                        {bulkUpdating ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                        Actualizar Estado ({selectedOrders.size})
                    </button>

                    <button
                        type="button"
                        disabled={selectedOrders.size === 0 || bulkUpdating}
                        onClick={handleAnularRetiro}
                        className={`${BTN_SECUNDARIO} disabled:cursor-not-allowed whitespace-nowrap flex-1 sm:flex-none`}
                    >
                        {bulkUpdating ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />}
                        Anular Retiro
                    </button>

                    <button
                        type="button"
                        disabled={selectedOrders.size === 0 || bulkUpdating}
                        onClick={handleDeleteOrders}
                        className={`${BTN_DESTRUCTIVO} whitespace-nowrap flex-1 sm:flex-none`}
                    >
                        <Trash2 size={15} /> Eliminar Órdenes
                    </button>

                </div>
            </div>

            {/* Data Grid Section — tarjetas o filas, según el selector de vista (en el celular siempre tarjetas) */}
            <div className="space-y-3">
                <div className={`${CARD} px-4 py-3 flex flex-wrap items-center justify-between gap-3`}>
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-zinc-800">Órdenes</h2>
                        <p className="text-sm text-zinc-400">
                            {loading ? 'Buscando…' : orders.length > 0 ? `${orders.length.toLocaleString('es-UY')} ${orders.length === 1 ? 'orden encontrada' : 'órdenes encontradas'}` : 'Resultado de la búsqueda'}
                        </p>
                    </div>
                    {(orders.length > 0 || conTabla) && (
                        <div className="flex flex-wrap items-center gap-2">
                            {orders.length > 0 && selectedOrders.size > 0 && (
                                <span className={`${BADGE} bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20 tabular-nums`}>
                                    {selectedOrders.size} seleccionada(s)
                                </span>
                            )}
                            {/* Seleccionar todo en tarjetas; en filas lo hace el checkbox del encabezado de la tabla */}
                            {orders.length > 0 && !enFilas && (
                                <label className={`${BTN_SECUNDARIO} cursor-pointer select-none`}>
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleAllSelection}
                                        className="w-4 h-4 cursor-pointer accent-brand-cyan"
                                    />
                                    Seleccionar todas
                                </label>
                            )}
                            {conTabla && (
                                <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white" role="group" aria-label="Vista de las órdenes">
                                    {VISTAS.map(([v, Icono, txt]) => (
                                        <button key={v} type="button" onClick={() => cambiarVista(v)} aria-pressed={vista === v} className={segmento(vista === v)}>
                                            <Icono size={14} /> {txt}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {loading ? (
                    <div className={`${CARD} flex flex-col items-center justify-center gap-3 py-16`}>
                        <Loader2 size={30} className="animate-spin text-brand-cyan" />
                        <span className="text-sm text-zinc-400">Buscando órdenes…</span>
                    </div>
                ) : orders.length === 0 ? (
                    <div className={`${CARD} flex flex-col items-center justify-center gap-2 py-16 px-4 text-center`}>
                        <SearchX size={40} className="text-zinc-200" />
                        <span className="text-sm text-zinc-400">No hay órdenes disponibles. Realiza una búsqueda.</span>
                    </div>
                ) : enFilas ? (
                    <div className={`${CARD} overflow-hidden`}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left whitespace-nowrap">
                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                    <tr>
                                        <th className="pl-4 pr-2 py-2.5 w-10">
                                            <input
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={toggleAllSelection}
                                                aria-label="Seleccionar todas"
                                                className="w-4 h-4 align-middle cursor-pointer accent-brand-cyan"
                                            />
                                        </th>
                                        <th className={TH}>Código orden</th>
                                        <th className={TH}>Orden retiro</th>
                                        <th className={TH}>Cliente</th>
                                        <th className={TH}>Trabajo</th>
                                        <th className={TH}>Producto</th>
                                        <th className={TH}>Estado</th>
                                        <th className={`${TH} text-right`}>Cantidad</th>
                                        <th className={`${TH} text-right`}>Costo final</th>
                                        <th className={`${TH} pr-4`}>Fecha ingreso</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {orders.slice(0, verOrdenes).map(order => {
                                        const marcada = selectedOrders.has(order.IdOrden);
                                        return (
                                            <tr key={order.IdOrden}
                                                onClick={() => setSelectedOrderDetail(order)}
                                                className={`cursor-pointer transition-colors ${marcada ? 'bg-brand-cyan/5 hover:bg-brand-cyan/10' : 'hover:bg-zinc-50'}`}
                                            >
                                                <td className="pl-4 pr-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={marcada}
                                                        onChange={(e) => {
                                                            e.stopPropagation();
                                                            toggleOrderSelection(order.IdOrden);
                                                        }}
                                                        aria-label={`Seleccionar ${order.CodigoOrden}`}
                                                        className="w-4 h-4 align-middle cursor-pointer accent-brand-cyan"
                                                    />
                                                </td>
                                                <td className="px-3 py-2.5 font-mono text-xs font-black text-zinc-800">{order.CodigoOrden}</td>
                                                <td className="px-3 py-2.5">
                                                    {order.OrdenRetiro ? (
                                                        <div className="flex flex-col">
                                                            <span className="font-black text-brand-cyan tabular-nums">#{order.OrdenRetiro}</span>
                                                            {order.EstadoOrdenRetiro && (
                                                                <span className="max-w-[110px] 2xl:max-w-[200px] truncate text-[10px] text-zinc-400 font-bold uppercase tracking-wide" title={order.EstadoOrdenRetiro}>{order.EstadoOrdenRetiro}</span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-zinc-300">-</span>
                                                    )}
                                                </td>
                                                {/* Cliente, trabajo y producto bajan a dos líneas en pantallas angostas en vez de agrandar la tabla */}
                                                <td className="px-3 py-2.5 min-w-[100px] max-w-[200px] whitespace-normal">
                                                    <div className="font-bold text-zinc-800 line-clamp-2 [overflow-wrap:anywhere]" title={order.IdCliente}>{order.IdCliente}</div>
                                                </td>
                                                <td className="px-3 py-2.5 min-w-[120px] max-w-[260px] whitespace-normal">
                                                    <div className="text-zinc-500 line-clamp-2 [overflow-wrap:anywhere]" title={order.NombreTrabajo}>{order.NombreTrabajo || '-'}</div>
                                                </td>
                                                <td className="px-3 py-2.5 min-w-[120px] max-w-[240px] whitespace-normal">
                                                    <div className="text-zinc-600 line-clamp-2 [overflow-wrap:anywhere]" title={order.Producto}>{order.Producto || '-'}</div>
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    <span className={`${BADGE} ${claseEstado(order.EstadoAprobacionStr || order.Estado)}`}>{order.EstadoAprobacionStr || order.Estado}</span>
                                                </td>
                                                <td className="px-3 py-2.5 text-right text-zinc-700 tabular-nums">{order.Cantidad}</td>
                                                <td className="px-3 py-2.5 text-right font-black text-zinc-800 tabular-nums">{order.CostoFinal ? `${order.MonSimbolo || '$'}${Number(order.CostoFinal).toFixed(2)}` : '-'}</td>
                                                <td className="pl-3 pr-4 py-2.5 text-xs text-zinc-500 tabular-nums">{fechaIngreso(order.FechaIngresoOrden)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {orders.length > verOrdenes && (
                            <div ref={centinelaOrdenes} className="py-3 text-center text-xs text-zinc-400 border-t border-zinc-100">
                                Mostrando {verOrdenes} de {orders.length}…
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                        {orders.slice(0, verOrdenes).map(order => (
                            <div key={order.IdOrden}
                                onClick={() => setSelectedOrderDetail(order)}
                                className={`rounded-2xl border p-4 flex flex-col gap-3 cursor-pointer transition-colors ${selectedOrders.has(order.IdOrden) ? 'border-brand-cyan bg-brand-cyan/5' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}
                            >
                                {/* Selección, código y estado */}
                                <div className="flex items-start gap-2.5">
                                    <label className="shrink-0 -m-1.5 p-1.5 flex cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={selectedOrders.has(order.IdOrden)}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                toggleOrderSelection(order.IdOrden);
                                            }}
                                            aria-label={`Seleccionar ${order.CodigoOrden}`}
                                            className="w-4 h-4 cursor-pointer accent-brand-cyan"
                                        />
                                    </label>
                                    <span className="flex-1 min-w-0 font-mono text-sm font-black text-zinc-800 leading-4 break-words">{order.CodigoOrden}</span>
                                    <span className={`${BADGE} shrink-0 whitespace-nowrap ${claseEstado(order.EstadoAprobacionStr || order.Estado)}`}>{order.EstadoAprobacionStr || order.Estado}</span>
                                </div>

                                {/* Cliente y trabajo */}
                                <div className="min-w-0">
                                    <p className="font-bold text-zinc-800 truncate" title={order.IdCliente}>{order.IdCliente}</p>
                                    <p className="text-sm text-zinc-500 truncate" title={order.NombreTrabajo}>{order.NombreTrabajo || '-'}</p>
                                </div>

                                {/* Datos */}
                                <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5 pt-3 border-t border-zinc-100 text-sm">
                                    <div className="min-w-0">
                                        <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Orden retiro</dt>
                                        <dd>
                                            {order.OrdenRetiro ? (
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-black text-brand-cyan tabular-nums">#{order.OrdenRetiro}</span>
                                                    {order.EstadoOrdenRetiro && (
                                                        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wide truncate" title={order.EstadoOrdenRetiro}>{order.EstadoOrdenRetiro}</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-zinc-300">-</span>
                                            )}
                                        </dd>
                                    </div>
                                    <div className="min-w-0 col-span-2">
                                        <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Producto</dt>
                                        <dd className="text-zinc-600 truncate" title={order.Producto}>{order.Producto || '-'}</dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Cantidad</dt>
                                        <dd className="text-zinc-700 tabular-nums">{order.Cantidad}</dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Costo final</dt>
                                        <dd className="font-black text-zinc-800 tabular-nums">{order.CostoFinal ? `${order.MonSimbolo || '$'}${Number(order.CostoFinal).toFixed(2)}` : '-'}</dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Fecha ingreso</dt>
                                        <dd className="text-xs text-zinc-500 tabular-nums">{fechaIngreso(order.FechaIngresoOrden)}</dd>
                                    </div>
                                </dl>
                            </div>
                        ))}
                        {orders.length > verOrdenes && (
                            <div ref={centinelaOrdenes} className="col-span-full py-3 text-center text-xs text-zinc-400">
                                Mostrando {verOrdenes} de {orders.length}…
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal Detail Order */}
            {selectedOrderDetail && (
                <div className="fixed inset-0 z-[6000] flex items-stretch sm:items-center justify-center sm:p-4 bg-black/40 animate-in fade-in duration-200">
                    <div
                        className="bg-white sm:rounded-2xl sm:border sm:border-zinc-200 shadow-xl w-full sm:max-w-4xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header Modal */}
                        <div className="flex justify-between items-center gap-3 px-5 py-4 border-b border-zinc-100 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <FileText size={22} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                                <h3 className="text-lg font-black text-zinc-800 truncate">Detalles de la Orden</h3>
                            </div>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setSelectedOrderDetail(null); }}
                                aria-label="Cerrar"
                                className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors focus:outline-none"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body Modal */}
                        <div className="p-5 overflow-y-auto">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-5 gap-x-6">

                                {/* Info Row 1 */}
                                <div className="min-w-0">
                                    <p className={ROTULO}>Código Orden</p>
                                    <p className="text-sm font-mono font-black text-zinc-800 break-words">{selectedOrderDetail.CodigoOrden || '-'}</p>
                                </div>
                                <div className="min-w-0">
                                    <p className={ROTULO}>Orden Retiro</p>
                                    <p className={`text-sm font-black flex flex-wrap items-center gap-2 ${selectedOrderDetail.OrdenRetiro ? 'text-brand-cyan' : 'text-zinc-800'}`}>
                                        {selectedOrderDetail.OrdenRetiro ? `#${selectedOrderDetail.OrdenRetiro}` : '-'}
                                        {selectedOrderDetail.EstadoOrdenRetiro && <span className={`${BADGE} uppercase ${claseEstado(selectedOrderDetail.EstadoOrdenRetiro)}`}>{selectedOrderDetail.EstadoOrdenRetiro}</span>}
                                    </p>
                                </div>
                                <div className="min-w-0">
                                    <p className={ROTULO}>ID Cliente</p>
                                    <p className="text-sm font-medium text-zinc-800 break-words">{selectedOrderDetail.IdCliente || '-'}</p>
                                </div>

                                {/* Info Row 2 */}
                                <div className="min-w-0">
                                    <p className={ROTULO}>Nombre Trabajo</p>
                                    <p className="text-sm font-medium text-zinc-800 break-words">{selectedOrderDetail.NombreTrabajo || '-'}</p>
                                </div>
                                <div className="min-w-0">
                                    <p className={ROTULO}>Producto</p>
                                    <p className="text-sm font-medium text-zinc-800 break-words">{selectedOrderDetail.Producto || '-'}</p>
                                </div>
                                <div className="min-w-0">
                                    <p className={ROTULO}>Estado</p>
                                    <p className="text-sm font-medium text-zinc-800">
                                        {selectedOrderDetail.Estado
                                            ? <span className={`${BADGE} ${claseEstado(selectedOrderDetail.Estado)}`}>{selectedOrderDetail.Estado}</span>
                                            : '-'}
                                    </p>
                                </div>

                                {/* Info Row 3 */}
                                <div className="min-w-0">
                                    <p className={ROTULO}>Cantidad</p>
                                    <p className="text-sm font-medium text-zinc-800 tabular-nums">{selectedOrderDetail.Cantidad || '-'}</p>
                                </div>
                                <div className="min-w-0">
                                    <p className={ROTULO}>Precio Unitario</p>
                                    <p className="text-sm font-medium text-zinc-800 tabular-nums">{selectedOrderDetail.PrecioUnitario ? `${selectedOrderDetail.MonSimbolo || '$'}${Number(selectedOrderDetail.PrecioUnitario).toFixed(2)}` : '-'}</p>
                                </div>
                                <div className="min-w-0">
                                    <p className={ROTULO}>Costo Final</p>
                                    <p className="text-sm font-black text-zinc-800 tabular-nums">{selectedOrderDetail.CostoFinal ? `${selectedOrderDetail.MonSimbolo || '$'}${Number(selectedOrderDetail.CostoFinal).toFixed(2)}` : '-'}</p>
                                </div>

                                {/* Info Row 4 */}
                                <div className="min-w-0">
                                    <p className={ROTULO}>Descuento Aplicado</p>
                                    <p className="text-sm font-medium text-zinc-800 tabular-nums">{selectedOrderDetail.DescuentoAplicado || '-'}</p>
                                </div>
                                <div className="min-w-0">
                                    <p className={ROTULO}>Modo</p>
                                    <p className="text-sm font-medium text-zinc-800">{selectedOrderDetail.Modo || '-'}</p>
                                </div>
                                <div className="min-w-0">
                                    <p className={ROTULO}>Lugar Retiro</p>
                                    <p className="text-sm font-medium text-zinc-800 break-words">{selectedOrderDetail.LugarRetiro || '-'}</p>
                                </div>

                                {/* Info Row 5 */}
                                <div className="min-w-0">
                                    <p className={ROTULO}>Fecha Ingreso Orden</p>
                                    <p className="text-sm font-medium text-zinc-800 tabular-nums">{fechaIngreso(selectedOrderDetail.FechaIngresoOrden)}</p>
                                </div>
                                <div className="min-w-0 md:col-span-2">
                                    <p className={ROTULO}>Nota Cliente</p>
                                    <p className="text-sm font-medium text-zinc-800 break-words">{selectedOrderDetail.OrdNotaCliente || '-'}</p>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Modal de confirmación: órdenes ya exportadas */}
            {reexportConfirm && (
                <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-black/40 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-xl animate-in zoom-in-95 duration-200 overflow-hidden">
                        {/* Header */}
                        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
                            <AlertTriangle size={22} className="shrink-0 text-amber-500 mt-0.5" aria-hidden="true" />
                            <div className="min-w-0">
                                <h3 className="text-base font-black text-zinc-800 leading-snug">Órdenes ya exportadas detectadas</h3>
                                <p className="text-sm text-zinc-500 mt-1">
                                    {reexportConfirm.yaExportadas.length} orden(es) de tu búsqueda ya fueron exportadas anteriormente.
                                </p>
                            </div>
                        </div>

                        {/* Lista de ya exportadas */}
                        <div className="px-5 pb-4 max-h-56 overflow-y-auto">
                            <p className="text-[11px] font-black text-zinc-400 uppercase tracking-wide mb-2">
                                Órdenes con exportación previa
                            </p>
                            <div className="flex flex-col gap-1.5">
                                {reexportConfirm.yaExportadas.map(o => {
                                    const fechaOrden = o.FechaIngresoOrden
                                        ? new Date(o.FechaIngresoOrden).toLocaleString('es-UY', {
                                            day: '2-digit', month: '2-digit', year: 'numeric',
                                            hour: '2-digit', minute: '2-digit'
                                          })
                                        : '—';
                                    return (
                                        <div key={o.IdOrden} className="flex items-center justify-between gap-3 bg-zinc-50 rounded-xl px-3 py-2 border border-zinc-100">
                                            <span className="font-mono text-xs font-black text-zinc-700">{o.CodigoOrden}</span>
                                            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 font-medium tabular-nums">
                                                <CalendarDays size={13} className="shrink-0 text-zinc-400" /> {fechaOrden}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Info pendientes */}
                        {reexportConfirm.pendientes.length > 0 && (
                            <div className="px-5 pb-4">
                                <p className="text-xs text-zinc-600 bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl px-3 py-2">
                                    También hay <strong className="text-brand-cyan">{reexportConfirm.pendientes.length}</strong> orden(es) <em>pendientes</em> (nunca exportadas).
                                </p>
                            </div>
                        )}

                        {/* Botones */}
                        <div className="flex flex-wrap justify-end gap-2 px-5 py-3 bg-zinc-50 border-t border-zinc-100">
                            <button
                                type="button"
                                onClick={() => setReexportConfirm(null)}
                                className={`${BTN_SECUNDARIO} flex-1 sm:flex-none`}
                            >
                                Cancelar
                            </button>
                            {reexportConfirm.pendientes.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => doExport(reexportConfirm.pendientes)}
                                    className={`${BTN_PRINCIPAL} flex-1 sm:flex-none`}
                                >
                                    <Download size={15} /> Solo pendientes ({reexportConfirm.pendientes.length})
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => doExport([...reexportConfirm.yaExportadas, ...reexportConfirm.pendientes])}
                                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-sm font-bold text-amber-700 hover:bg-amber-100 transition-colors flex-1 sm:flex-none"
                            >
                                <Download size={15} /> Re-exportar todo ({reexportConfirm.yaExportadas.length + reexportConfirm.pendientes.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderSearchPage;
