import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";
import { inventoryService } from "../../services/modules/inventoryService";
import { areasService } from "../../services/modules/areasService";
import api from "../../services/api";
import { MultiAreaSelector } from "../ui/MultiAreaSelector";
import Selector from "../ui/Selector";
import EstadoTelaModal from "../modals/inventory/EstadoTelaModal";
import ManageBobinaModal from "../modals/inventory/ManageBobinaModal";
import SolicitarDevolucionTelaModal from "../modals/inventory/SolicitarDevolucionTelaModal";
import BandejaDevolucionesTelaPanel from "./BandejaDevolucionesTelaPanel";
import {
    CheckCircle, AlertTriangle, FileText, Settings2, Search, RefreshCw, Ruler, X, Loader2, Undo2, Inbox,
    Scroll, Check, CalendarDays, Mail, Phone, MapPin,
} from "lucide-react";
import { toast } from "sonner";

// Estética nueva (22/10/2026, como Reportes y Logística): fondo claro, tarjetas blancas con borde, íconos de Lucide en
// brand-cyan, pestañas con la elegida en negro; el color queda para el estado de la bobina (pendiente / disponible /
// agotada). En el celular el filtro de estado es un selector.
const CARD = "bg-white rounded-2xl border border-zinc-200";
const BTN_PRINCIPAL = "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const BTN_SECUNDARIO = "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50";
const BTN_ICONO = "p-1.5 rounded-xl border border-zinc-200 bg-white text-zinc-400 hover:text-zinc-700 hover:border-zinc-300 transition-colors";
const CAJA_BUSQUEDA = "flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5 transition-colors focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/15";
const chip = (activo) => `shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${
    activo ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"}`;
const segmento = (activo) => `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
    activo ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-800"}`;
const fmtFecha = (f) => new Date(f).toLocaleDateString('es-UY', { day:'2-digit', month:'2-digit', year:'2-digit' });

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
    onSolicitarDevolucion,
}) => {
    const esPendiente   = bob.Estado === "Pendiente";
    const esAgotada     = bob.Estado === "Agotado" || bob.Estado === "Cerrado";
    const pctUsado      = bob.MetrosIniciales > 0
        ? Math.round((1 - bob.MetrosRestantes / bob.MetrosIniciales) * 100)
        : 0;
    const esConfirmando = confirmandoId === bob.BobinaID;

    return (
        <div className={`${CARD} overflow-hidden flex items-stretch transition-colors ${
            esConfirmando ? "ring-2 ring-amber-200 border-amber-300" :
            esAgotada     ? "opacity-75" :
            "hover:border-zinc-300"
        }`}>
            {/* Barra lateral de estado */}
            <div className={`w-1.5 shrink-0 ${esPendiente ? "bg-amber-400" : esAgotada ? "bg-zinc-300" : "bg-emerald-500"}`} />

            <div className="flex-1 min-w-0 p-4">
                <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                                esPendiente ? "bg-amber-50 text-amber-700 border-amber-200"
                                : esAgotada ? "bg-zinc-100 text-zinc-500 border-zinc-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                            }`}>{esPendiente ? "Pendiente" : esAgotada ? "Agotado" : "Disponible"}</span>
                            <span className="text-xs text-zinc-400 font-mono">{bob.AreaID}</span>
                        </div>
                        {bob.Referencia && (
                            <div className="mt-2">
                                <span className="inline-block bg-zinc-100 border border-zinc-200 text-zinc-800 font-black font-mono text-xl px-2.5 py-0.5 rounded-lg tracking-wider">
                                    {bob.Referencia}
                                </span>
                            </div>
                        )}
                        <h3 className="font-bold text-zinc-800 mt-1.5 text-sm leading-tight truncate">
                            {bob.DescripcionTela || bob.TipoTela}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <p className="text-xs text-zinc-600 font-medium">{bob.NombreCliente || bob.ClienteID}</p>
                            {bob.IdCliente && (
                                <span className="text-[10px] font-black font-mono bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-200">
                                    ID: {bob.IdCliente}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="text-right ml-3">
                        <span className={`text-2xl font-black tabular-nums ${bob.MetrosRestantes < 5 ? "text-rose-600" : "text-zinc-800"}`}>
                            {(parseFloat(bob.MetrosRestantes) || 0).toFixed(1)}
                        </span>
                        <span className="text-xs text-zinc-400 block">m restantes</span>
                    </div>
                </div>

                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-mono text-zinc-700 font-bold truncate">{bob.CodigoEtiqueta}</p>
                    {bob.FechaIngreso && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 font-medium whitespace-nowrap ml-2 tabular-nums">
                            <CalendarDays className="w-3 h-3 text-brand-cyan" /> {fmtFecha(bob.FechaIngreso)}
                        </span>
                    )}
                </div>

                {/* Medidas declaradas vs confirmadas */}
                <div className="mb-3 text-xs rounded-xl overflow-hidden border border-zinc-200">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-zinc-50 border-b border-zinc-200">
                                <th className="text-left px-2.5 py-1.5 text-zinc-400 font-black text-[10px] uppercase tracking-wide"></th>
                                <th className="text-right px-2.5 py-1.5 text-zinc-400 font-black text-[10px] uppercase tracking-wide">Declarado</th>
                                <th className="text-right px-2.5 py-1.5 text-zinc-400 font-black text-[10px] uppercase tracking-wide">Confirmado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            <tr>
                                <td className="px-2.5 py-1.5 text-zinc-500 font-medium">Largo</td>
                                <td className="px-2.5 py-1.5 text-right font-bold text-zinc-700 tabular-nums">{parseFloat(bob.MetrosIniciales).toFixed(2)} m</td>
                                <td className="px-2.5 py-1.5 text-right">
                                    {!esPendiente ? (
                                        <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${
                                            Math.abs(bob.MetrosRestantes - bob.MetrosIniciales) / bob.MetrosIniciales > 0.1
                                                ? "text-amber-600" : "text-emerald-600"
                                        }`}><Check className="w-3 h-3" /> {(parseFloat(bob.MetrosRestantes) || 0).toFixed(2)} m</span>
                                    ) : <span className="text-zinc-300">—</span>}
                                </td>
                            </tr>
                            {(bob.Ancho || bob.AnchoReal) && (
                                <tr>
                                    <td className="px-2.5 py-1.5 text-zinc-500 font-medium">Ancho</td>
                                    <td className="px-2.5 py-1.5 text-right font-bold text-zinc-700 tabular-nums">
                                        {bob.Ancho ? `${parseFloat(bob.Ancho).toFixed(2)} m` : <span className="text-zinc-300">—</span>}
                                    </td>
                                    <td className="px-2.5 py-1.5 text-right">
                                        {bob.AnchoReal
                                            ? <span className="inline-flex items-center gap-1 font-bold text-emerald-600 tabular-nums"><Check className="w-3 h-3" /> {parseFloat(bob.AnchoReal).toFixed(2)} m</span>
                                            : <span className="text-zinc-300">—</span>}
                                    </td>
                                </tr>
                            )}
                            {(bob.Peso || bob.PesoReal) && (
                                <tr>
                                    <td className="px-2.5 py-1.5 text-zinc-500 font-medium">Peso</td>
                                    <td className="px-2.5 py-1.5 text-right font-bold text-zinc-700 tabular-nums">
                                        {bob.Peso ? `${parseFloat(bob.Peso).toFixed(2)} kg` : <span className="text-zinc-300">—</span>}
                                    </td>
                                    <td className="px-2.5 py-1.5 text-right">
                                        {bob.PesoReal
                                            ? <span className="inline-flex items-center gap-1 font-bold text-emerald-600 tabular-nums"><Check className="w-3 h-3" /> {parseFloat(bob.PesoReal).toFixed(2)} kg</span>
                                            : <span className="text-zinc-300">—</span>}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="w-full bg-zinc-100 rounded-full h-1.5 mb-4">
                    <div className={`h-1.5 rounded-full ${
                        pctUsado > 80 ? "bg-rose-500" : pctUsado > 50 ? "bg-amber-400" : "bg-emerald-500"
                    }`} style={{ width: `${Math.min(pctUsado, 100)}%` }} />
                </div>

                <div className="flex gap-2 justify-end flex-wrap">
                    {esPendiente ? (
                        <button
                            type="button"
                            onClick={() => esConfirmando ? onCancelarConfirmar() : onConfirmar(bob)}
                            className={esConfirmando ? BTN_SECUNDARIO : BTN_PRINCIPAL}
                        >
                            {esConfirmando ? <X className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                            {esConfirmando ? "Cancelar" : "Confirmar medida"}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onEstadoCuenta(bob.BobinaID)}
                            className={BTN_SECUNDARIO}
                        >
                            <FileText className="w-3.5 h-3.5 text-brand-cyan" /> Estado de cuenta
                        </button>
                    )}
                    {!esAgotada && !esPendiente && (
                        <button
                            type="button"
                            onClick={() => onSolicitarDevolucion(bob)}
                            className={BTN_ICONO}
                            title="Solicitar devolución/descarte de excedente"
                            aria-label="Solicitar devolución o descarte de excedente"
                        >
                            <Undo2 className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => onAdministrar(bob)}
                        className={BTN_ICONO}
                        title="Administrar"
                        aria-label="Administrar"
                    >
                        <Settings2 className="w-4 h-4" />
                    </button>
                </div>

                {esConfirmando && (
                    <div className="mt-3 pt-3 border-t border-zinc-100">
                        <p className="text-xs font-bold text-zinc-700 mb-3 flex items-center gap-1.5">
                            <Ruler className="w-3.5 h-3.5 text-brand-cyan" /> Medidas reales de la bobina
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
                                        <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">{label}</label>
                                        <input
                                            type="text" inputMode="decimal"
                                            value={val}
                                            onChange={e => {
                                                const raw = e.target.value.replace(",", ".");
                                                if (raw === "" || /^\d*\.?\d*$/.test(raw)) set(raw);
                                            }}
                                            className="w-full border border-zinc-200 rounded-xl px-2 py-1.5 text-sm font-bold text-zinc-800 text-center tabular-nums focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
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
                            type="button"
                            disabled={confirmLoading || !metrosRealesInput || parseFloat(metrosRealesInput) <= 0}
                            onClick={onEjecutarConfirm}
                            className={`${BTN_PRINCIPAL} w-full py-2`}
                        >
                            {confirmLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            {confirmLoading ? "Confirmando..." : "Confirmar medidas"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// Encabezado de cada grupo de bobinas (pendientes / disponibles / agotadas)
const TituloGrupo = ({ titulo, cantidad, punto }) => (
    <h2 className="flex items-center gap-2 text-sm font-black text-zinc-800 mb-3">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${punto}`} />
        {titulo}
        <span className="text-xs font-normal text-zinc-400">{cantidad} {cantidad === 1 ? "bobina" : "bobinas"}</span>
    </h2>
);

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
    const [solicitandoBobina, setSolicitandoBobina] = useState(null);
    const [vista, setVista]                         = useState("inventario"); // 'inventario' | 'bandeja'

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

    // Las tres listas usan la misma tarjeta con las mismas acciones
    const tarjeta = (bob) => (
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
            onSolicitarDevolucion={setSolicitandoBobina}
            onEjecutarConfirm={ejecutarConfirmacion}
        />
    );
    const GRILLA = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3";

    return (
        <div className="p-3 md:p-6 bg-slate-50 min-h-full font-sans text-zinc-800">
            <div className="space-y-4">
                {/* ── Encabezado ─────────────────────────────────────────── */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <Scroll size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                        <div className="min-w-0">
                            <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Inventario tela de cliente</h1>
                            <p className="text-sm text-zinc-400">Control de bobinas por cliente y confirmación de medidas</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white">
                            <button type="button" onClick={() => setVista("inventario")} className={segmento(vista === "inventario")}>
                                Inventario
                            </button>
                            <button type="button" onClick={() => setVista("bandeja")} className={segmento(vista === "bandeja")}>
                                <Inbox className="w-3.5 h-3.5" /> Bandeja de devoluciones
                            </button>
                        </div>
                        {vista === "inventario" && (
                            <button
                                type="button"
                                onClick={loadInventory}
                                disabled={loading || selectedAreas.length === 0}
                                className={`${BTN_SECUNDARIO} py-2 text-sm`}
                                title="Actualizar"
                                aria-label="Actualizar"
                            >
                                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            </button>
                        )}
                    </div>
                </div>

                {vista === "bandeja" && <BandejaDevolucionesTelaPanel />}

              {vista === "inventario" && (<>
                {/* ── Filtros: áreas, cliente, texto y estado ─────────────── */}
                <div className={`${CARD} p-3 md:p-4 space-y-3`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <MultiAreaSelector areas={areasList} selected={selectedAreas} onChange={setSelectedAreas} placeholder="Seleccionar areas..." />

                        {/* Buscador de cliente tipo Caja */}
                        <div className="relative" ref={searchRef}>
                            <div className={`${CAJA_BUSQUEDA} ${clienteSeleccionado ? "border-brand-cyan" : "border-zinc-200"}`}>
                                {buscandoCliente
                                    ? <Loader2 className="w-4 h-4 text-brand-cyan animate-spin shrink-0" />
                                    : <Search className="w-4 h-4 text-zinc-400 shrink-0" />}
                                <input
                                    type="text"
                                    placeholder="Buscar cliente por nombre, código o referencia..."
                                    aria-label="Buscar cliente"
                                    className="flex-1 bg-transparent text-sm text-zinc-800 placeholder:text-zinc-400 outline-none min-w-0"
                                    value={clienteQuery}
                                    onChange={e => {
                                        setClienteQuery(e.target.value);
                                        setClienteSeleccionado(null);
                                        buscarClientes(e.target.value);
                                    }}
                                    autoComplete="off"
                                />
                                {(clienteQuery || clienteSeleccionado) && (
                                    <button type="button" onClick={limpiarCliente} className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-700 transition-colors" aria-label="Limpiar cliente">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>

                            {/* Dropdown de sugerencias */}
                            {clienteSugerencias.length > 0 && !clienteSeleccionado && (
                                <div className="absolute z-50 top-full mt-1.5 left-0 right-0 bg-white border border-zinc-200 rounded-xl shadow-xl shadow-zinc-900/10 overflow-hidden">
                                    <div className="px-3 py-2 bg-zinc-50 text-[10px] font-black text-zinc-400 uppercase tracking-wide border-b border-zinc-100 flex justify-between">
                                        <span>Clientes encontrados</span>
                                        <span>{clienteSugerencias.length} resultados</span>
                                    </div>
                                    {clienteSugerencias.map(c => (
                                        <button key={c.CliIdCliente}
                                            type="button"
                                            onClick={() => seleccionarCliente(c)}
                                            className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 border-b border-zinc-100 last:border-0 flex items-center gap-3 transition-colors"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-700 font-black text-sm shrink-0">
                                                {(c.Nombre || c.NombreFantasia || 'C')[0].toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-sm text-zinc-800 truncate">{c.Nombre || c.NombreFantasia}</p>
                                                <div className="flex gap-2 mt-0.5">
                                                    <span className="text-[10px] font-mono bg-zinc-100 text-zinc-500 px-1.5 rounded">{c.CliIdCliente}</span>
                                                    {c.CodCliente && <span className="text-[10px] text-zinc-400">{c.CodCliente}</span>}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Texto (PRE / tela / bobina) + estado */}
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <div className={`${CAJA_BUSQUEDA} border-zinc-200 flex-1`}>
                            <Search className="w-4 h-4 text-zinc-400 shrink-0" />
                            <input
                                type="text"
                                placeholder="Filtrar por PRE, tela o bobina..."
                                aria-label="Filtrar por PRE, tela o bobina"
                                className="flex-1 bg-transparent text-sm text-zinc-800 placeholder:text-zinc-400 outline-none min-w-0"
                                value={filtroTexto}
                                onChange={e => setFiltroTexto(e.target.value)}
                                autoComplete="off"
                            />
                            {filtroTexto && (
                                <button type="button" onClick={() => setFiltroTexto("")} className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-700 transition-colors" aria-label="Limpiar filtro">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                        {/* Celular: selector; escritorio: pestañas */}
                        <div className="sm:hidden">
                            <Selector filtro className="w-full" aria-label="Estado" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
                                <option value="Todas">Todos los estados</option>
                                <option value="Pendiente">Pendiente</option>
                                <option value="Disponible">Disponible</option>
                                <option value="Agotado">Agotado</option>
                            </Selector>
                        </div>
                        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
                            {["Todas", "Pendiente", "Disponible", "Agotado"].map(op => (
                                <button key={op} type="button" onClick={() => setFiltroEstado(op)} className={chip(filtroEstado === op)}>
                                    {op}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── Tarjeta del cliente seleccionado ─────────────────── */}
                {clienteSeleccionado && (
                    <div className={`${CARD} p-4 flex items-center gap-4`}>
                        <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-700 font-black text-xl shrink-0">
                            {(clienteSeleccionado.Nombre || clienteSeleccionado.NombreFantasia || 'C')[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-black text-zinc-800 text-base leading-tight">{clienteSeleccionado.Nombre || clienteSeleccionado.NombreFantasia}</p>
                            <div className="flex flex-wrap items-center gap-3 mt-1">
                                <span className="text-[11px] font-mono bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full border border-zinc-200 font-bold">ID CLIENTE: {clienteSeleccionado.CliIdCliente}</span>
                                {clienteSeleccionado.Email    && <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><Mail className="w-3.5 h-3.5 text-brand-cyan" /> {clienteSeleccionado.Email}</span>}
                                {clienteSeleccionado.Telefono && <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><Phone className="w-3.5 h-3.5 text-brand-cyan" /> {clienteSeleccionado.Telefono}</span>}
                                {clienteSeleccionado.Direccion && <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><MapPin className="w-3.5 h-3.5 text-brand-cyan" /> {clienteSeleccionado.Direccion}</span>}
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            <p className="text-2xl font-black text-zinc-800 tabular-nums">{bobinasTela.length}</p>
                            <p className="text-xs text-zinc-400">bobinas</p>
                        </div>
                    </div>
                )}

                {/* ── Totales ─────────────────────────────────────────── */}
                {bobinasTela.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                            { n: bobinasTela.length, label: "Total bobinas", cls: "text-zinc-800" },
                            { n: pendientes.length,  label: "Pendientes",    cls: "text-amber-600" },
                            { n: disponibles.length, label: "Disponibles",   cls: "text-emerald-600" },
                            { n: agotadas.length,    label: "Agotadas",      cls: "text-zinc-400" },
                        ].map(({ n, label, cls }) => (
                            <div key={label} className={`${CARD} px-4 py-3 min-w-0`}>
                                <div className="text-[11px] font-black text-zinc-400 uppercase tracking-wide truncate">{label}</div>
                                <div className={`mt-1 text-xl md:text-2xl font-black tabular-nums leading-tight ${cls}`}>{n}</div>
                            </div>
                        ))}
                    </div>
                )}

                {loading && (
                    <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-3`}>
                        <Loader2 size={30} className="animate-spin text-brand-cyan" />
                        <p className="text-sm text-zinc-400">Cargando inventario...</p>
                    </div>
                )}

                {!loading && selectedAreas.length === 0 && (
                    <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-2 px-4 text-center`}>
                        <Scroll size={40} className="text-zinc-200" />
                        <p className="text-sm text-zinc-400">Seleccioná al menos un área para ver las telas.</p>
                    </div>
                )}

                {!loading && selectedAreas.length > 0 && bobinasTela.length === 0 && (
                    <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-2 px-4 text-center`}>
                        <Scroll size={40} className="text-zinc-200" />
                        <p className="text-sm text-zinc-400">No hay telas de cliente en las áreas seleccionadas.</p>
                    </div>
                )}

                {!loading && pendientes.length > 0 && (
                    <div>
                        <TituloGrupo titulo="Pendientes de confirmación" cantidad={pendientes.length} punto="bg-amber-400" />
                        <div className={GRILLA}>{pendientes.map(tarjeta)}</div>
                    </div>
                )}

                {!loading && disponibles.length > 0 && (
                    <div>
                        <TituloGrupo titulo="Disponibles" cantidad={disponibles.length} punto="bg-emerald-500" />
                        <div className={GRILLA}>{disponibles.map(tarjeta)}</div>
                    </div>
                )}

                {!loading && agotadas.length > 0 && (
                    <div>
                        <TituloGrupo titulo="Agotadas" cantidad={agotadas.length} punto="bg-zinc-300" />
                        <div className={GRILLA}>{agotadas.map(tarjeta)}</div>
                    </div>
                )}
              </>)}
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
            {solicitandoBobina && (
                <SolicitarDevolucionTelaModal
                    bobina={solicitandoBobina}
                    clienteId={solicitandoBobina.ClienteID}
                    onClose={() => setSolicitandoBobina(null)}
                    onSuccess={loadInventory}
                />
            )}
        </div>
    );
};

export default TelaClienteInventarioPage;
