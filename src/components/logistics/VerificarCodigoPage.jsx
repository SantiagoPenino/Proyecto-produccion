import React, { useState, useRef, useEffect } from 'react';
import { ScanLine, CheckCircle2, AlertCircle, AlertTriangle, Loader2, RefreshCw, Send, Hash, User, FileText, Tag, Package, BarChart2, DollarSign, Edit3, X } from 'lucide-react';
import api from '../../services/api';

// ─── Definición de los 7 campos del QR ──────────────────────────────────────
const CAMPOS_QR = [
    { key: 'CodigoOrden',      label: 'Código de Orden',    icon: Hash,       pos: 0, desc: 'Identificador único de la orden (ej: PRO-99999)' },
    { key: 'CodigoClienteQR',  label: 'ID Cliente (QR)',    icon: User,       pos: 1, desc: 'Código del cliente codificado en el QR' },
    { key: 'NombreTrabajo',    label: 'Nombre del Trabajo', icon: FileText,   pos: 2, desc: 'Descripción o título del trabajo' },
    { key: 'IdModo',           label: 'Modo',               icon: Tag,        pos: 3, desc: 'Identificador del modo de producción' },
    { key: 'IdProductoQR',     label: 'ID Producto (QR)',   icon: Package,    pos: 4, desc: 'Código del producto codificado en el QR' },
    { key: 'Cantidad',         label: 'Cantidad',            icon: BarChart2,  pos: 5, desc: 'Cantidad de unidades' },
    { key: 'CostoFinal',       label: 'Costo Final',        icon: DollarSign, pos: 6, desc: 'Costo final del trabajo' },
];

// Estética nueva (22/10/2026): encabezado con ícono brand-cyan sin fondo, tarjetas blancas zinc, color solo
// para el resultado (emerald válido, brand-magenta error, amber editando) y sin emojis ni símbolos.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const ROTULO = 'text-[11px] font-black uppercase tracking-widest text-zinc-400';

const VerificarCodigoPage = () => {
    const [rawCode, setRawCode]     = useState('');
    const [loading, setLoading]     = useState(false);
    const [result, setResult]       = useState(null);   // { valid, data, error, rawParts }
    const [editando, setEditando]   = useState(false);
    const [editFields, setEditFields] = useState({});   // campos editados manualmente
    const [ingresando, setIngresando] = useState(false);
    const [ingresadoMsg, setIngresadoMsg] = useState(null);
    const inputRef = useRef(null);

    // Auto-foco al montar
    useEffect(() => { inputRef.current?.focus(); }, []);

    // ─── Parse local sin validar DB (solo estructura) ────────────────────────
    const parseLocal = (str) => {
        const parts = str.trim().split('$*');
        if (parts.length !== 7) return null;
        const obj = {};
        CAMPOS_QR.forEach(c => { obj[c.key] = parts[c.pos]; });
        return obj;
    };

    // ─── Validar contra DB ───────────────────────────────────────────────────
    const handleValidar = async (valor = rawCode) => {
        const code = valor.trim();
        if (!code) return;
        setLoading(true);
        setResult(null);
        setIngresadoMsg(null);
        setEditando(false);

        // Parse local para mostrar campos aunque falle DB
        const localParts = parseLocal(code);

        try {
            const res = await api.post('/apiordenes/parse-qr', { ordenString: code });
            const p = res.data;
            setResult({
                valid: p.valid,
                data: p.data || null,
                error: p.error || null,
                rawParts: localParts,
                raw: code
            });
            if (p.valid && p.data) {
                // Inicializar campos editables con valores del servidor
                setEditFields({
                    CodigoOrden:     p.data.CodigoOrden,
                    CodigoClienteQR: p.data.IDCliente,
                    NombreTrabajo:   p.data.NombreTrabajo,
                    IdModo:          p.data.IdModo,
                    IdProductoQR:    String(p.data.IdProducto),
                    Cantidad:        String(p.data.Cantidad),
                    CostoFinal:      String(p.data.CostoFinal),
                });
            } else if (localParts) {
                setEditFields({ ...localParts });
            }
        } catch (err) {
            const msg = err.response?.data?.error || 'Error de conexión al validar.';
            // Detectar si el error del parse-qr es de cliente o producto
            let labelError = msg;
            if (err.response?.status === 404) {
                const isCliente = msg.toLowerCase().includes('cliente');
                const isProducto = msg.toLowerCase().includes('producto');
                if (isCliente) labelError = `Cliente no encontrado — ${msg}`;
                else if (isProducto) labelError = `Producto no encontrado — ${msg}`;
            }
            setResult({ valid: false, error: labelError, rawParts: localParts, raw: code });
            if (localParts) setEditFields({ ...localParts });
        } finally {
            setLoading(false);
        }
    };

    // ─── Ingresar la orden (con campos posiblemente editados) ────────────────
    const handleIngresar = async () => {
        if (!editFields) return;
        setIngresando(true);
        setIngresadoMsg(null);

        // Reconstruir el string QR con los campos (editados o no)
        const ordered = CAMPOS_QR.map(c => editFields[c.key] || '');
        const ordenString = ordered.join('$*');

        try {
            const res = await api.post('/apiordenes/data', {
                ordenString,
                estado: 'Ingresado'
            });
            const msg = res.status === 202
                ? 'Orden reingresada exitosamente al depósito.'
                : 'Orden ingresada correctamente. Pendiente aviso WhatsApp.';
            setIngresadoMsg({ ok: true, text: msg });
        } catch (err) {
            const status = err.response?.status;
            const serverMsg = err.response?.data?.error || '';
            let msg = 'Error inesperado al ingresar.';
            if (status === 400) msg = 'La orden ya fue ingresada previamente en depósito.';
            if (status === 403) msg = 'El campo cliente está vacío en la etiqueta.';
            if (status === 404) msg = `Cliente no encontrado — ID QR "${editFields.CodigoClienteQR}" no existe en el sistema local. Revisá y editá el campo "ID Cliente (QR)".`;
            if (status === 405) msg = `Producto no encontrado — ID QR "${editFields.IdProductoQR}" no existe en el sistema local. Revisá y editá el campo "ID Producto (QR)".`;
            if (status === 500) msg = 'Falla interna del servidor.';
            setIngresadoMsg({ ok: false, text: msg });
        } finally {
            setIngresando(false);
        }
    };

    const handleLimpiar = () => {
        setRawCode('');
        setResult(null);
        setEditando(false);
        setEditFields({});
        setIngresadoMsg(null);
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    // ─── Campo individual ────────────────────────────────────────────────────
    // Se llama como función ({campoQR(...)}), no como <CampoQR />: al estar definido adentro del componente,
    // como elemento se volvía a montar en cada tecla y el campo en edición perdía el foco.
    const campoQR = ({ campo, validado }) => {
        const Icon = campo.icon;
        const rawVal   = result?.rawParts?.[campo.key] ?? '—';
        const validVal = validado?.[campo.key] ?? null;

        // Usar el valor validado del servidor si existe, o el raw
        const displayVal = validVal !== null ? validVal : rawVal;
        const isEmpty = !rawVal || rawVal.trim() === '';
        const isMissing = !result?.rawParts; // no se pudo parsear la estructura

        return (
            <div key={campo.key} className={`rounded-xl border px-3.5 py-3 transition-colors ${
                isEmpty || isMissing
                    ? 'border-brand-magenta/20 bg-brand-magenta/5'
                    : 'border-zinc-200 bg-white hover:border-zinc-300'
            }`}>
                <div className="flex items-center gap-2 mb-1">
                    <Icon size={13} className={isEmpty ? 'text-brand-magenta' : 'text-brand-cyan'} />
                    <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">{campo.label}</span>
                    <span className="text-[10px] font-bold text-zinc-300 ml-auto tabular-nums">{campo.pos + 1}/7</span>
                </div>

                {editando ? (
                    <input
                        className="w-full text-sm font-bold text-zinc-800 border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                        value={editFields[campo.key] ?? ''}
                        onChange={e => setEditFields(prev => ({ ...prev, [campo.key]: e.target.value }))}
                    />
                ) : isEmpty ? (
                    <p className="text-sm font-bold text-brand-magenta inline-flex items-center gap-1.5">
                        <AlertTriangle size={14} /> Vacío
                    </p>
                ) : (
                    <p className="text-sm font-bold truncate text-zinc-800">{String(displayVal)}</p>
                )}

                <p className="text-[11px] text-zinc-400 mt-0.5 leading-tight">{campo.desc}</p>
            </div>
        );
    };

    // ─── Datos enriquecidos del servidor ─────────────────────────────────────
    const DatoServidor = ({ label, value, icon: Icon }) => (
        <div className="flex items-start gap-2.5 bg-zinc-50 rounded-xl px-3.5 py-2.5 min-w-0">
            <Icon size={14} className="text-brand-cyan shrink-0 mt-0.5" />
            <div className="min-w-0">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">{label}</p>
                <p className="text-sm font-bold text-zinc-800 break-words">{value}</p>
            </div>
        </div>
    );

    return (
        <div className="min-h-full flex flex-col gap-4 px-3 sm:px-6 py-5 text-zinc-700">
            {/* Header */}
            <div className="flex items-center gap-3">
                <ScanLine size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Verificar código de barras</h1>
                    <p className="text-sm text-zinc-500 mt-1">Escaneá o pegá un código QR para desglosar y validar sus 7 campos</p>
                </div>
            </div>

            {/* Input de escaneo */}
            <div className={`${CARD} p-5`}>
                <label htmlFor="verificar-codigo" className={`${ROTULO} mb-1.5 block`}>Código de barras / QR</label>
                <div className="flex flex-wrap sm:flex-nowrap gap-2">
                    <div className="relative w-full sm:w-auto sm:flex-1 min-w-0">
                        <ScanLine size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-cyan pointer-events-none" />
                        <input
                            id="verificar-codigo"
                            ref={inputRef}
                            type="text"
                            value={rawCode}
                            onChange={e => setRawCode(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleValidar()}
                            placeholder="Escaneá aquí o pegá el código..."
                            className="w-full pl-12 pr-4 py-3 bg-white border border-zinc-200 rounded-xl font-mono text-sm font-bold text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10 placeholder:text-zinc-300 placeholder:font-normal"
                            autoComplete="off"
                        />
                    </div>
                    <button
                        onClick={() => handleValidar()}
                        disabled={loading || !rawCode.trim()}
                        className={`${BTN_PRINCIPAL} whitespace-nowrap flex-1 sm:flex-none`}
                    >
                        {loading ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
                        Validar
                    </button>
                    {(result || rawCode) && (
                        <button
                            onClick={handleLimpiar}
                            className="shrink-0 w-12 rounded-xl border border-zinc-200 bg-white text-zinc-400 inline-flex items-center justify-center transition-colors hover:text-zinc-700 hover:bg-zinc-50"
                            title="Limpiar"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>

                {/* Estructura esperada */}
                <p className="text-[11px] text-zinc-400 mt-2.5 font-mono break-words">
                    Estructura: <span className="text-brand-cyan">CodOrden</span> $* <span className="text-brand-cyan">IDCliente</span> $* <span className="text-brand-cyan">NombreTrabajo</span> $* <span className="text-brand-cyan">Modo</span> $* <span className="text-brand-cyan">IDProducto</span> $* <span className="text-brand-cyan">Cantidad</span> $* <span className="text-brand-cyan">Costo</span>
                </p>
            </div>

            {/* Resultado */}
            {result && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

                    {/* Panel izquierdo: 7 campos */}
                    <div className={`${CARD} p-5 flex flex-col gap-2.5`}>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <h3 className="text-sm font-black text-zinc-800 uppercase tracking-wide">Desglose de los 7 campos</h3>
                            {result.rawParts ? (
                                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">7 campos detectados</span>
                            ) : (
                                <span className="text-[11px] font-bold text-brand-magenta bg-brand-magenta/10 border border-brand-magenta/20 px-2.5 py-1 rounded-full">
                                    {rawCode.split('$*').length} campos — se esperan 7
                                </span>
                            )}
                        </div>

                        {result.rawParts ? (
                            CAMPOS_QR.map(c => campoQR({ campo: c, validado: result.valid ? result.data : null }))
                        ) : (
                            <div className="bg-brand-magenta/5 border border-brand-magenta/20 rounded-xl p-5 text-center">
                                <AlertCircle size={32} className="text-brand-magenta mx-auto mb-2" />
                                <p className="text-sm font-bold text-brand-magenta">Código malformado</p>
                                <p className="text-xs text-zinc-500 mt-1">No se encontraron 7 partes separadas por <code className="font-mono font-bold text-zinc-700">$*</code>. El código tiene {rawCode.split('$*').length} partes.</p>
                            </div>
                        )}

                        {/* Botón editar */}
                        {result.rawParts && (
                            <button
                                onClick={() => setEditando(v => !v)}
                                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border font-bold text-sm transition-colors mt-1 ${
                                    editando
                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                                }`}
                            >
                                <Edit3 size={14} className={editando ? '' : 'text-brand-cyan'} />
                                {editando ? 'Editando campos...' : 'Editar campos manualmente'}
                            </button>
                        )}
                    </div>

                    {/* Panel derecho: resultado de validación + acción */}
                    <div className="flex flex-col gap-4">

                        {/* Estado de validación */}
                        <div className={`rounded-2xl border p-4 ${result.valid ? 'border-emerald-200 bg-emerald-50' : 'border-brand-magenta/20 bg-brand-magenta/5'}`}>
                            <div className="flex items-start gap-3">
                                {result.valid
                                    ? <CheckCircle2 size={26} className="text-emerald-600 shrink-0" />
                                    : <AlertCircle size={26} className="text-brand-magenta shrink-0" />
                                }
                                <div className="min-w-0">
                                    <p className={`font-black text-base ${result.valid ? 'text-emerald-700' : 'text-brand-magenta'}`}>
                                        {result.valid ? 'Código válido' : 'Error de validación'}
                                    </p>
                                    {result.error && (
                                        <p className="text-sm text-zinc-600 mt-1 break-words">{result.error}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Datos resueltos del servidor */}
                        {result.valid && result.data && (
                            <div className={`${CARD} p-5`}>
                                <h3 className={`${ROTULO} mb-3`}>Datos resueltos por el servidor</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <DatoServidor label="Código Orden" value={result.data.CodigoOrden}       icon={Hash} />
                                    <DatoServidor label="Cliente"      value={result.data.CodigoCliente}     icon={User} />
                                    <DatoServidor label="ID Cliente"   value={result.data.IDCliente}         icon={User} />
                                    <DatoServidor label="Tipo Cliente" value={result.data.TipoCliente}       icon={Tag} />
                                    <DatoServidor label="Producto"     value={result.data.ProductoNombre}    icon={Package} />
                                    <DatoServidor label="Modo"         value={result.data.IdModo}            icon={Tag} />
                                    <DatoServidor label="Cantidad"     value={`${result.data.Cantidad}`}     icon={BarChart2} />
                                    <DatoServidor label="Costo"        value={`${result.data.Moneda} ${result.data.CostoFinal}`} icon={DollarSign} />
                                </div>
                            </div>
                        )}

                        {/* Acción: re-validar o ingresar */}
                        <div className={`${CARD} p-5 flex flex-col gap-2.5`}>
                            <h3 className={ROTULO}>Acciones</h3>

                            {editando && (
                                <button
                                    onClick={() => {
                                        // Reconstruir código con campos editados y re-validar
                                        const newCode = CAMPOS_QR.map(c => editFields[c.key] || '').join('$*');
                                        setRawCode(newCode);
                                        handleValidar(newCode);
                                    }}
                                    className={BTN_SECUNDARIO}
                                >
                                    <RefreshCw size={15} className="text-brand-cyan" /> Re-validar con campos editados
                                </button>
                            )}

                            <button
                                onClick={handleIngresar}
                                disabled={ingresando || !editFields.CodigoOrden}
                                className={`${BTN_PRINCIPAL} py-2.5`}
                            >
                                {ingresando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                                Ingresar al depósito
                            </button>

                            {ingresadoMsg && (
                                <div className={`rounded-xl px-3.5 py-3 text-sm font-bold flex items-start gap-2 ${ingresadoMsg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-brand-magenta/5 border border-brand-magenta/20 text-brand-magenta'}`}>
                                    {ingresadoMsg.ok ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
                                    <span className="min-w-0 break-words">{ingresadoMsg.text}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VerificarCodigoPage;
