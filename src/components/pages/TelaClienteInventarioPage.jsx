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
    const esAgotado     = bob.Estado === "Agotado";
    const pctUsado      = bob.MetrosIniciales > 0
        ? Math.round((1 - bob.MetrosRestantes / bob.MetrosIniciales) * 100)
        : 0;
    const esConfirmando = confirmandoId === bob.BobinaID;
    const estadoBadge   = {
        "Pendiente":  "bg-amber-100 text-amber-700",
        "Disponible": "bg-green-100 text-green-700",
        "En Uso":     "bg-blue-100 text-blue-700",
        "Agotado":    "bg-rose-100 text-rose-700",
    }[bob.Estado] || "bg-slate-100 text-slate-600";

    return (
        <div className={`bg-white rounded-xl shadow border-2 p-4 transition-all ${
            esConfirmando ? "border-amber-400 ring-2 ring-amber-100" :
            esPendiente   ? "border-amber-300" :
            esAgotado     ? "border-slate-200 opacity-75" : "border-slate-200 hover:border-indigo-300"
        }`}>
            <div className="flex justify-between items-start mb-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${estadoBadge}`}>{bob.Estado || "—"}</span>
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
    const [estadoFiltro, setEstadoFiltro]           = useState("todos"); // Filtro por estado de bobina

    // -- Buscador de cliente tipo Caja --
    const [clienteQuery, setClienteQuery]           = useState("");
    const [clienteSugerencias, setClienteSugerencias] = useState([]);
    const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
    const [buscandoCliente, setBuscandoCliente]     = useState(false);
    const searchRef                                 = useRef(null);

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

    // Al filtrar por "Agotado" se cargan también las bobinas cerradas
    const verAgotadas = estadoFiltro === "Agotado";

    const loadInventory = async () => {
        if (selectedAreas.length === 0) return;
        setLoading(true);
        try {
            const data = await inventoryService.getInventoryByArea(selectedAreas.join(","), { incluirCerradas: verAgotadas });
            setInventory(data || []);
        } catch (e) {
            toast.error("Error cargando inventario: " + (e?.message || ""));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (selectedAreas.length > 0) loadInventory(); }, [selectedAreas, verAgotadas]);

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
    const bobinasTela = _allBatches.filter(b => {
        if (clienteSeleccionado) return String(b.ClienteID) === String(clienteSeleccionado.CliIdCliente);
        if (_refMatch) return (b.Referencia || '').toLowerCase().includes(_q);
        return true;
    });

    // Conteo por estado + estados presentes (para los chips de filtro)
    const conteoPorEstado = bobinasTela.reduce((acc, b) => {
        const e = b.Estado || "Sin estado";
        acc[e] = (acc[e] || 0) + 1;
        return acc;
    }, {});
    // 'Agotado' se maneja como chip fijo aparte (dispara la carga de cerradas)
    const ORDEN_ESTADOS = ["Pendiente", "Disponible", "En Uso"];
    const estadosPresentes = [
        ...ORDEN_ESTADOS.filter(e => conteoPorEstado[e]),
        ...Object.keys(conteoPorEstado).filter(e => e !== "Agotado" && !ORDEN_ESTADOS.includes(e)).sort(),
    ];
    const countActivas = bobinasTela.filter(b => b.Estado !== "Agotado").length;

    // Aplicar filtro de estado (client-side)
    const bobinasVisibles = estadoFiltro === "todos"
        ? bobinasTela.filter(b => b.Estado !== "Agotado")
        : bobinasTela.filter(b => (b.Estado || "Sin estado") === estadoFiltro);

    const pendientes  = bobinasVisibles.filter(b => b.Estado === "Pendiente");
    const disponibles = bobinasVisibles.filter(b => b.Estado !== "Pendiente" && b.Estado !== "Agotado");

    // Estilos de cada chip según estado (clases estáticas para que Tailwind no las purgue)
    const chipStyles = (key, activo) => {
        const map = {
            "todos":      activo ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300",
            "Pendiente":  activo ? "bg-amber-500 text-white border-amber-500" : "bg-white text-amber-700 border-amber-200 hover:border-amber-300",
            "Disponible": activo ? "bg-green-600 text-white border-green-600" : "bg-white text-green-700 border-green-200 hover:border-green-300",
            "En Uso":     activo ? "bg-blue-600 text-white border-blue-600"   : "bg-white text-blue-700 border-blue-200 hover:border-blue-300",
            "Agotado":    activo ? "bg-rose-500 text-white border-rose-500"   : "bg-white text-rose-600 border-rose-200 hover:border-rose-300",
        };
        return map[key] || (activo ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300");
    };

    // Render de una tarjeta (evita duplicar props en cada grilla)
    const renderCard = (bob) => (
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
    );

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

                {/* Filtro por estado de bobina */}
                {selectedAreas.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide mr-1">Estado:</span>
                        {[
                            { key: "todos", label: "Todas", n: countActivas },
                            ...estadosPresentes.map(e => ({ key: e, label: e, n: conteoPorEstado[e] })),
                            { key: "Agotado", label: "Agotados", n: verAgotadas ? (conteoPorEstado["Agotado"] || 0) : null },
                        ].map(({ key, label, n }) => {
                            const activo = estadoFiltro === key;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setEstadoFiltro(key)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${chipStyles(key, activo)}`}
                                >
                                    {label}
                                    {n != null && (
                                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] leading-none ${activo ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>{n}</span>
                                    )}
                                </button>
                            );
                        })}
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

                {/* Sin resultados para el filtro de estado activo */}
                {!loading && bobinasTela.length > 0 && bobinasVisibles.length === 0 && (
                    <div className="text-center py-16 text-slate-400">
                        <p>No hay bobinas en estado "{estadoFiltro}".</p>
                    </div>
                )}

                {/* Vista TODAS: separadas en Pendientes y Disponibles */}
                {!loading && estadoFiltro === "todos" && (
                    <>
                        {pendientes.length > 0 && (
                            <div>
                                <h2 className="text-sm font-bold text-amber-700 uppercase tracking-wide mb-3">
                                    Pendientes de confirmacion ({pendientes.length})
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                                    {pendientes.map(renderCard)}
                                </div>
                            </div>
                        )}
                        {disponibles.length > 0 && (
                            <div>
                                <h2 className="text-sm font-bold text-green-700 uppercase tracking-wide mb-3">
                                    Disponibles ({disponibles.length})
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                                    {disponibles.map(renderCard)}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* Vista FILTRADA por un estado: una sola grilla */}
                {!loading && estadoFiltro !== "todos" && bobinasVisibles.length > 0 && (
                    <div>
                        <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wide mb-3">
                            {estadoFiltro} ({bobinasVisibles.length})
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                            {bobinasVisibles.map(renderCard)}
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
