import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";
import { inventoryService } from "../../services/modules/inventoryService";
import { areasService } from "../../services/modules/areasService";
import api from "../../services/api";
import { MultiAreaSelector } from "../ui/MultiAreaSelector";
import EstadoTelaModal from "../modals/inventory/EstadoTelaModal";
import ManageBobinaModal from "../modals/inventory/ManageBobinaModal";
import { CheckCircle, AlertTriangle, FileText, Settings2, Search, RefreshCw, Ruler, X, User, Loader2 } from "lucide-react";
import { toast } from "sonner";

// ─── BobinaCard — definida FUERA del componente padre para evitar remount en cada render ───
const BobinaCard = ({
    bob,
    confirmandoId,
    metrosRealesInput, setMetrosRealesInput,
    anchoInput,        setAnchoInput,
    pesoInput,         setPesoInput,
    confirmLoading,
    onConfirmar,
    onCancelarConfirmar,
    onEstadoCuenta,
    onAdministrar,
    onEjecutarConfirm,
}) => {
    const esPendiente   = bob.Estado === "Pendiente";
    const esAgotada     = bob.Estado === "Agotado" || bob.Estado === "Cerrado";
    const pctUsado      = bob.MetrosIniciales > 0
        ? Math.round((1 - bob.MetrosRestantes / bob.MetrosIniciales) * 100)
        : 0;
    const esConfirmando = confirmandoId === bob.BobinaID;

    return (
        <div className={`bg-white rounded-xl shadow border-2 p-4 transition-all ${
            esConfirmando ? "border-amber-400 ring-2 ring-amber-100" :
            esPendiente   ? "border-amber-300" :
            esAgotada     ? "border-slate-200 opacity-75" :
            "border-slate-200 hover:border-indigo-300"
        }`}>
            <div className="flex justify-between items-start mb-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            esPendiente ? "bg-amber-100 text-amber-700"
                            : esAgotada ? "bg-slate-200 text-slate-500"
                            : "bg-green-100 text-green-700"
                        }`}>{esPendiente ? "Pendiente" : esAgotada ? "Agotado" : "Disponible"}</span>
                        <span className="text-xs text-slate-400 font-mono">{bob.AreaID}</span>
                    </div>
                    {bob.Referencia && (
                        <div className="mt-1.5">
                            <span className="inline-block bg-indigo-600 text-white font-black font-mono text-xl px-3 py-1 rounded-lg tracking-wider shadow-sm">
                                {bob.Referencia}
                            </span>
                        </div>
                    )}
                    <h3 className="font-bold text-slate-800 mt-1 text-sm leading-tight truncate">
                        {bob.DescripcionTela || bob.TipoTela}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <p className="text-xs text-slate-600 font-medium">{bob.NombreCliente || bob.ClienteID}</p>
                        {bob.IdCliente && (
                            <span className="text-[10px] font-black font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">
                                ID: {bob.IdCliente}
                            </span>
                        )}
                    </div>
                </div>
                <div className="text-right ml-3">
                    <span className={`text-2xl font-black ${bob.MetrosRestantes < 5 ? "text-red-500" : "text-slate-800"}`}>
                        {parseFloat(bob.MetrosRestantes).toFixed(1)}
                    </span>
                    <span className="text-xs text-slate-400 block">m restantes</span>
                </div>
            </div>

            <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-mono text-slate-800 font-bold truncate">{bob.CodigoEtiqueta}</p>
                {bob.FechaIngreso && (
                    <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap ml-2">
                        📅 {new Date(bob.FechaIngreso).toLocaleDateString('es-UY', { day:'2-digit', month:'2-digit', year:'2-digit' })}
                    </span>
                )}
            </div>

            {/* Medidas declaradas vs confirmadas */}
            <div className="mb-3 text-xs rounded-lg overflow-hidden border border-slate-100">
                <table className="w-full">
                    <thead>
                        <tr className="bg-slate-50">
                            <th className="text-left px-2 py-1 text-slate-400 font-semibold text-[10px] uppercase"></th>
                            <th className="text-right px-2 py-1 text-slate-400 font-semibold text-[10px] uppercase">Declarado</th>
                            <th className="text-right px-2 py-1 text-slate-400 font-semibold text-[10px] uppercase">Confirmado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        <tr>
                            <td className="px-2 py-1 text-slate-500 font-medium">Largo</td>
                            <td className="px-2 py-1 text-right font-bold text-slate-700">{parseFloat(bob.MetrosIniciales).toFixed(2)} m</td>
                            <td className="px-2 py-1 text-right">
                                {!esPendiente ? (
                                    <span className={`font-bold ${
                                        Math.abs(bob.MetrosRestantes - bob.MetrosIniciales) / bob.MetrosIniciales > 0.1
                                            ? "text-amber-600" : "text-green-600"
                                    }`}>✓ {parseFloat(bob.MetrosRestantes).toFixed(2)} m</span>
                                ) : <span className="text-slate-300">—</span>}
                            </td>
                        </tr>
                        {(bob.Ancho || bob.AnchoReal) && (
                            <tr>
                                <td className="px-2 py-1 text-slate-500 font-medium">Ancho</td>
                                <td className="px-2 py-1 text-right font-bold text-slate-700">
                                    {bob.Ancho ? `${parseFloat(bob.Ancho).toFixed(2)} m` : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="px-2 py-1 text-right">
                                    {bob.AnchoReal
                                        ? <span className="font-bold text-green-600">✓ {parseFloat(bob.AnchoReal).toFixed(2)} m</span>
                                        : <span className="text-slate-300">—</span>}
                                </td>
                            </tr>
                        )}
                        {(bob.Peso || bob.PesoReal) && (
                            <tr>
                                <td className="px-2 py-1 text-slate-500 font-medium">Peso</td>
                                <td className="px-2 py-1 text-right font-bold text-slate-700">
                                    {bob.Peso ? `${parseFloat(bob.Peso).toFixed(2)} kg` : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="px-2 py-1 text-right">
                                    {bob.PesoReal
                                        ? <span className="font-bold text-green-600">✓ {parseFloat(bob.PesoReal).toFixed(2)} kg</span>
                                        : <span className="text-slate-300">—</span>}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="w-full bg-slate-100 rounded-full h-1.5 mb-4">
                <div className={`h-1.5 rounded-full ${
                    pctUsado > 80 ? "bg-red-500" : pctUsado > 50 ? "bg-amber-400" : "bg-green-500"
                }`} style={{ width: `${Math.min(pctUsado, 100)}%` }} />
            </div>

            <div className="flex gap-2 justify-end">
                {esPendiente ? (
                    <button
                        onClick={() => esConfirmando ? onCancelarConfirmar() : onConfirmar(bob)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-xs font-bold transition-colors ${
                            esConfirmando ? "bg-slate-500 hover:bg-slate-600" : "bg-amber-500 hover:bg-amber-600"
                        }`}
                    >
                        <CheckCircle className="w-3.5 h-3.5" />
                        {esConfirmando ? "Cancelar" : "Confirmar medida"}
                    </button>
                ) : (
                    <button
                        onClick={() => onEstadoCuenta(bob.BobinaID)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold border border-indigo-200 transition-colors"
                    >
                        <FileText className="w-3.5 h-3.5" /> Estado de Cuenta
                    </button>
                )}
                <button
                    onClick={() => onAdministrar(bob)}
                    className="p-1.5 text-indigo-500 hover:text-white bg-indigo-50 hover:bg-indigo-500 rounded-lg border border-indigo-200 hover:border-indigo-500 transition-colors"
                    title="Administrar"
                >
                    <Settings2 className="w-4 h-4" />
                </button>
            </div>

            {esConfirmando && (
                <div className="mt-3 pt-3 border-t border-amber-200">
                    <p className="text-xs font-bold text-amber-700 mb-3 flex items-center gap-1">
                        <Ruler className="w-3.5 h-3.5" /> Medidas reales de la bobina
                    </p>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                            { label: "Largo (m) *", val: metrosRealesInput, set: setMetrosRealesInput, ph: String(bob.MetrosRestantes), warn: true },
                            { label: "Ancho (m)",   val: anchoInput,        set: setAnchoInput,        ph: bob.Ancho ? String(bob.Ancho) : "0.00" },
                            { label: "Peso (kg)",   val: pesoInput,         set: setPesoInput,         ph: bob.Peso  ? String(bob.Peso)  : "0.00" },
                        ].map(({ label, val, set, ph, warn }) => {
                            const decl = parseFloat(bob.MetrosIniciales) || 0;
                            const real = parseFloat(val.replace(",", ".")) || 0;
                            const pct  = warn && decl > 0 ? Math.abs((real - decl) / decl) * 100 : 0;
                            return (
                                <div key={label}>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</label>
                                    <input
                                        type="text" inputMode="decimal"
                                        value={val}
                                        onChange={e => {
                                            const raw = e.target.value.replace(",", ".");
                                            if (raw === "" || /^\d*\.?\d*$/.test(raw)) set(raw);
                                        }}
                                        className={`w-full border rounded-lg px-2 py-1.5 text-sm font-bold focus:outline-none text-center transition-colors ${
                                            val && parseFloat(val) > 0
                                                ? "border-amber-400 bg-amber-50 focus:border-amber-500"
                                                : "border-slate-300 focus:border-amber-500"
                                        }`}
                                        placeholder={ph}
                                        autoComplete="off"
                                    />
                                    {warn && pct > 10 && val !== "" && (
                                        <div className="flex items-center gap-0.5 mt-1 text-[10px] text-amber-600">
                                            <AlertTriangle className="w-3 h-3" /> {pct.toFixed(1)}% dif. al declarado
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <button
                        disabled={confirmLoading || !metrosRealesInput || parseFloat(metrosRealesInput) <= 0}
                        onClick={onEjecutarConfirm}
                        className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
                    >
                        {confirmLoading ? "Confirmando..." : "Confirmar medidas"}
                    </button>
                </div>
            )}
        </div>
    );
};

const TelaClienteInventarioPage = () => {
    const { user } = useAuth();
    const isAdmin = user?.rol?.toLowerCase() === "admin";
    const isDeposito = user?.areaKey?.trim().toUpperCase() === "DEPOSITO";
    const hasFullAccess = isAdmin || isDeposito;

    const [selectedAreas, setSelectedAreas]         = useState([]);
    const [inventory, setInventory]                 = useState([]);
    const [areasList, setAreasList]                 = useState([]);
    const [loading, setLoading]                     = useState(false);
    const [confirmando, setConfirmando]             = useState(null);
    const [metrosRealesInput, setMetrosRealesInput] = useState("");
    const [anchoInput, setAnchoInput]               = useState("");
    const [pesoInput, setPesoInput]                 = useState("");
    const [confirmLoading, setConfirmLoading]       = useState(false);
    const [estadoTelaBobina, setEstadoTelaBobina]   = useState(null);
    const [managingBobina, setManagingBobina]       = useState(null);

    // -- Buscador de cliente tipo Caja --
    const [clienteQuery, setClienteQuery]           = useState("");
    const [clienteSugerencias, setClienteSugerencias] = useState([]);
    const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
    const [buscandoCliente, setBuscandoCliente]     = useState(false);
    const searchRef                                 = useRef(null);

    // -- Filtros: texto (PRE / tela / bobina) + estado --
    const [filtroTexto, setFiltroTexto]             = useState("");
    const [filtroEstado, setFiltroEstado]           = useState("Todas");

    useEffect(() => { loadAreas(); }, []);

    const loadAreas = async () => {
        try {
            const data = await areasService.getAll({ withTelaCliente: true });
            const adapted = data.map(d => ({ ...d, code: d.AreaID, name: d.Nombre }));
            if (!hasFullAccess && user) {
                const uArea = user.areaKey?.trim().toUpperCase();
                const match = adapted.find(a => a.code?.trim().toUpperCase() === uArea);
                if (match) setSelectedAreas([match.code]);
            } else if (hasFullAccess && adapted.length > 0) {
                // Para admin/deposito: seleccionar todas las areas con tela de cliente
                setSelectedAreas(adapted.map(a => a.code));
            }
            setAreasList(adapted);
        } catch { /* silencioso */ }
    };

    const loadInventory = async () => {
        if (selectedAreas.length === 0) return;
        setLoading(true);
        try {
            const data = await inventoryService.getInventoryByArea(selectedAreas.join(","), { includeAgotadas: true });
            setInventory(data || []);
        } catch (e) {
            toast.error("Error cargando inventario: " + (e?.message || ""));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (selectedAreas.length > 0) loadInventory(); }, [selectedAreas]);

    // Buscar clientes desde la API (mismo endpoint que Caja)
    const buscarClientes = async (q) => {
        if (!q || q.length < 2) { setClienteSugerencias([]); return; }
        setBuscandoCliente(true);
        try {
            const res = await api.get(`/contabilidad/clientes-activos?q=${encodeURIComponent(q)}&limit=8`);
            setClienteSugerencias(res.data?.data || []);
        } catch { setClienteSugerencias([]); }
        finally { setBuscandoCliente(false); }
    };

    const seleccionarCliente = (c) => {
        setClienteSeleccionado(c);
        setClienteQuery(`${c.Nombre || c.NombreFantasia || ''} — ${c.CliIdCliente}`);
        setClienteSugerencias([]);
    };

    const limpiarCliente = () => {
        setClienteSeleccionado(null);
        setClienteQuery("");
        setClienteSugerencias([]);
    };

    // Click fuera cierra el dropdown
    useEffect(() => {
        const handler = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setClienteSugerencias([]); };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // Búsqueda: por cliente (elegido del dropdown) o por Referencia de bobina (texto tipeado).
    // Si el texto matchea alguna Referencia, filtramos por ella; si no (ej. estás tipeando un
    // nombre de cliente), no filtramos las bobinas — así el flujo de selección de cliente sigue igual.
    const _q = clienteQuery.trim().toLowerCase();
    const _allBatches = inventory
        .flatMap(item => (item.ActiveBatches || item.batches || []).filter(b => b.ClienteID != null && b.ClienteID !== ""));
    const _refMatch = _q.length > 0 && !clienteSeleccionado
        && _allBatches.some(b => (b.Referencia || '').toLowerCase().includes(_q));
    const _porCliente = _allBatches.filter(b => {
        if (clienteSeleccionado) return String(b.ClienteID) === String(clienteSeleccionado.CliIdCliente);
        if (_refMatch) return (b.Referencia || '').toLowerCase().includes(_q);
        return true;
    });

    // Filtros por texto (PRE / tela / bobina / cliente) y por estado
    const _txt  = filtroTexto.trim().toLowerCase();
    const _norm = (v) => (v == null ? '' : String(v)).toLowerCase();
    const matchTexto = (b) => !_txt ||
        [b.Referencia, b.TipoTela, b.DescripcionTela, b.CodigoEtiqueta, b.NombreCliente, b.ClienteID, b.IdCliente]
            .some(v => _norm(v).includes(_txt));
    const matchEstado = (b) => {
        if (filtroEstado === "Todas")      return true;
        if (filtroEstado === "Disponible") return b.Estado === "Disponible" || b.Estado === "En Uso";
        if (filtroEstado === "Agotado")    return b.Estado === "Agotado" || b.Estado === "Cerrado";
        return b.Estado === filtroEstado;
    };
    const bobinasTela = _porCliente.filter(b => matchTexto(b) && matchEstado(b));

    const pendientes  = bobinasTela.filter(b => b.Estado === "Pendiente");
    const disponibles = bobinasTela.filter(b => b.Estado === "Disponible" || b.Estado === "En Uso");
    const agotadas    = bobinasTela.filter(b => b.Estado === "Agotado" || b.Estado === "Cerrado");

    const abrirConfirmacion = (bob) => {
        setConfirmando({ bobina: bob, insumoName: bob.DescripcionTela || bob.TipoTela });
        setMetrosRealesInput(String(bob.MetrosRestantes));
        setAnchoInput(bob.Ancho ? String(bob.Ancho) : "");
        setPesoInput(bob.Peso  ? String(bob.Peso)   : "");
    };

    const ejecutarConfirmacion = async () => {
        const metros = parseFloat(metrosRealesInput);
        if (!metros || metros <= 0) { toast.error("Ingresa el largo real medido"); return; }
        setConfirmLoading(true);
        try {
            const ancho = parseFloat(anchoInput) || null;
            const peso  = parseFloat(pesoInput)  || null;
            const res = await inventoryService.confirmarMedida(confirmando.bobina.BobinaID, metros, ancho, peso);
            if (res.alerta) toast.warning(res.alertaMsg);
            else toast.success("Medidas confirmadas. Tela disponible para produccion.");
            setConfirmando(null);
            loadInventory();
        } catch (err) {
            toast.error(err?.response?.data?.error || "Error al confirmar medidas");
        } finally {
            setConfirmLoading(false);
        }
    };

    return (
        <div className="p-6 bg-slate-50 min-h-screen">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">Inventario Tela de Cliente</h1>
                            <p className="text-slate-500 text-sm mt-0.5">Control de bobinas por cliente y confirmacion de medidas</p>
                        </div>
                        <button
                            onClick={loadInventory}
                            disabled={loading || selectedAreas.length === 0}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            Actualizar
                        </button>
                    </div>
                </div>

                {/* Buscador de cliente tipo Caja */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col sm:flex-row gap-3 items-start">
                    <div className="flex-1">
                        <MultiAreaSelector areas={areasList} selected={selectedAreas} onChange={setSelectedAreas} placeholder="Seleccionar areas..." />
                    </div>
                    <div className="relative min-w-[300px]" ref={searchRef}>
                        <div className="flex items-center gap-2 border-2 rounded-xl px-3 py-2 transition-all bg-slate-50 focus-within:bg-white"
                            style={{ borderColor: clienteSeleccionado ? '#6366f1' : undefined }}
                        >
                            {buscandoCliente
                                ? <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                                : <Search className="w-4 h-4 text-slate-400 shrink-0" />}
                            <input
                                type="text"
                                placeholder="Buscar cliente por nombre, código o referencia..."
                                className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none min-w-0"
                                value={clienteQuery}
                                onChange={e => {
                                    setClienteQuery(e.target.value);
                                    setClienteSeleccionado(null);
                                    buscarClientes(e.target.value);
                                }}
                                autoComplete="off"
                            />
                            {(clienteQuery || clienteSeleccionado) && (
                                <button onClick={limpiarCliente} className="p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        {/* Dropdown de sugerencias */}
                        {clienteSugerencias.length > 0 && !clienteSeleccionado && (
                            <div className="absolute z-50 top-full mt-2 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                                <div className="px-3 py-2 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100 flex justify-between">
                                    <span>Clientes encontrados</span>
                                    <span>{clienteSugerencias.length} resultados</span>
                                </div>
                                {clienteSugerencias.map(c => (
                                    <button key={c.CliIdCliente}
                                        onClick={() => seleccionarCliente(c)}
                                        className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 border-b border-slate-50 last:border-0 flex items-center gap-3 transition-colors group"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-black text-sm shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                            {(c.Nombre || c.NombreFantasia || 'C')[0].toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm text-slate-800 truncate">{c.Nombre || c.NombreFantasia}</p>
                                            <div className="flex gap-2 mt-0.5">
                                                <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 rounded">{c.CliIdCliente}</span>
                                                {c.CodCliente && <span className="text-[10px] text-slate-400">{c.CodCliente}</span>}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Filtros: texto (PRE / tela / bobina) + estado */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 flex flex-col sm:flex-row gap-3 sm:items-center">
                    <div className="flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus-within:bg-white focus-within:border-indigo-300 flex-1 transition-all">
                        <Search className="w-4 h-4 text-slate-400 shrink-0" />
                        <input
                            type="text"
                            placeholder="Filtrar por PRE, tela o bobina..."
                            className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none min-w-0"
                            value={filtroTexto}
                            onChange={e => setFiltroTexto(e.target.value)}
                            autoComplete="off"
                        />
                        {filtroTexto && (
                            <button onClick={() => setFiltroTexto("")} className="p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                        {["Todas", "Pendiente", "Disponible", "Agotado"].map(op => (
                            <button
                                key={op}
                                onClick={() => setFiltroEstado(op)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                    filtroEstado === op
                                        ? "bg-indigo-600 text-white border-indigo-600"
                                        : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                                }`}
                            >
                                {op}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tarjeta del cliente seleccionado */}
                {clienteSeleccionado && (
                    <div className="bg-white rounded-xl border-2 border-indigo-200 p-4 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-white font-black text-xl shrink-0">
                            {(clienteSeleccionado.Nombre || clienteSeleccionado.NombreFantasia || 'C')[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-black text-slate-800 text-base leading-tight">{clienteSeleccionado.Nombre || clienteSeleccionado.NombreFantasia}</p>
                            <div className="flex flex-wrap gap-3 mt-1">
                                <span className="text-[11px] font-mono bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-200 font-bold">ID CLIENTE: {clienteSeleccionado.CliIdCliente}</span>
                                {clienteSeleccionado.Email    && <span className="text-xs text-slate-500">✉ {clienteSeleccionado.Email}</span>}
                                {clienteSeleccionado.Telefono && <span className="text-xs text-slate-500">📞 {clienteSeleccionado.Telefono}</span>}
                                {clienteSeleccionado.Direccion && <span className="text-xs text-slate-500">📍 {clienteSeleccionado.Direccion}</span>}
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            <p className="text-2xl font-black text-indigo-600">{bobinasTela.length}</p>
                            <p className="text-xs text-slate-400">bobinas</p>
                        </div>
                    </div>
                )}

                {bobinasTela.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                            { n: bobinasTela.length, label: "Total bobinas", cls: "bg-white border-slate-200 text-slate-800" },
                            { n: pendientes.length,  label: "Pendientes",    cls: "bg-amber-50 border-amber-200 text-amber-600" },
                            { n: disponibles.length, label: "Disponibles",   cls: "bg-green-50 border-green-200 text-green-600" },
                            { n: agotadas.length,    label: "Agotadas",      cls: "bg-slate-100 border-slate-200 text-slate-500" },
                        ].map(({ n, label, cls }) => (
                            <div key={label} className={`rounded-xl border p-4 text-center ${cls}`}>
                                <div className="text-2xl font-black">{n}</div>
                                <div className="text-xs font-medium mt-0.5 opacity-80">{label}</div>
                            </div>
                        ))}
                    </div>
                )}

                {loading && (
                    <div className="text-center py-16 text-slate-400">
                        <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
                        <p>Cargando inventario...</p>
                    </div>
                )}

                {!loading && selectedAreas.length === 0 && (
                    <div className="text-center py-20 text-slate-400">
                        <p>Selecciona al menos un area para ver las telas.</p>
                    </div>
                )}

                {!loading && selectedAreas.length > 0 && bobinasTela.length === 0 && (
                    <div className="text-center py-20 text-slate-400">
                        <p>No hay telas de cliente en las areas seleccionadas.</p>
                    </div>
                )}

                {!loading && pendientes.length > 0 && (
                    <div>
                        <h2 className="text-sm font-bold text-amber-700 uppercase tracking-wide mb-3">
                            Pendientes de confirmacion ({pendientes.length})
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        {pendientes.map(bob => (
                            <BobinaCard
                                key={bob.BobinaID}
                                bob={bob}
                                confirmandoId={confirmando?.bobina?.BobinaID ?? null}
                                metrosRealesInput={metrosRealesInput} setMetrosRealesInput={setMetrosRealesInput}
                                anchoInput={anchoInput}               setAnchoInput={setAnchoInput}
                                pesoInput={pesoInput}                 setPesoInput={setPesoInput}
                                confirmLoading={confirmLoading}
                                onConfirmar={abrirConfirmacion}
                                onCancelarConfirmar={() => setConfirmando(null)}
                                onEstadoCuenta={setEstadoTelaBobina}
                                onAdministrar={(b) => setManagingBobina({ bobina: b, insumoName: b.TipoTela })}
                                onEjecutarConfirm={ejecutarConfirmacion}
                            />
                        ))}
                        </div>
                    </div>
                )}

                {!loading && disponibles.length > 0 && (
                    <div>
                        <h2 className="text-sm font-bold text-green-700 uppercase tracking-wide mb-3">
                            Disponibles ({disponibles.length})
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        {disponibles.map(bob => (
                            <BobinaCard
                                key={bob.BobinaID}
                                bob={bob}
                                confirmandoId={confirmando?.bobina?.BobinaID ?? null}
                                metrosRealesInput={metrosRealesInput} setMetrosRealesInput={setMetrosRealesInput}
                                anchoInput={anchoInput}               setAnchoInput={setAnchoInput}
                                pesoInput={pesoInput}                 setPesoInput={setPesoInput}
                                confirmLoading={confirmLoading}
                                onConfirmar={abrirConfirmacion}
                                onCancelarConfirmar={() => setConfirmando(null)}
                                onEstadoCuenta={setEstadoTelaBobina}
                                onAdministrar={(b) => setManagingBobina({ bobina: b, insumoName: b.TipoTela })}
                                onEjecutarConfirm={ejecutarConfirmacion}
                            />
                        ))}
                        </div>
                    </div>
                )}

                {!loading && agotadas.length > 0 && (
                    <div>
                        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">
                            Agotadas ({agotadas.length})
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        {agotadas.map(bob => (
                            <BobinaCard
                                key={bob.BobinaID}
                                bob={bob}
                                confirmandoId={confirmando?.bobina?.BobinaID ?? null}
                                metrosRealesInput={metrosRealesInput} setMetrosRealesInput={setMetrosRealesInput}
                                anchoInput={anchoInput}               setAnchoInput={setAnchoInput}
                                pesoInput={pesoInput}                 setPesoInput={setPesoInput}
                                confirmLoading={confirmLoading}
                                onConfirmar={abrirConfirmacion}
                                onCancelarConfirmar={() => setConfirmando(null)}
                                onEstadoCuenta={setEstadoTelaBobina}
                                onAdministrar={(b) => setManagingBobina({ bobina: b, insumoName: b.TipoTela })}
                                onEjecutarConfirm={ejecutarConfirmacion}
                            />
                        ))}
                        </div>
                    </div>
                )}
            </div>

            {estadoTelaBobina && (
                <EstadoTelaModal bobinaId={estadoTelaBobina} onClose={() => setEstadoTelaBobina(null)} />
            )}
            {managingBobina && (
                <ManageBobinaModal
                    bobina={managingBobina.bobina}
                    insumoName={managingBobina.insumoName}
                    onClose={() => setManagingBobina(null)}
                    onSuccess={loadInventory}
                />
            )}
        </div>
    );
};

export default TelaClienteInventarioPage;
