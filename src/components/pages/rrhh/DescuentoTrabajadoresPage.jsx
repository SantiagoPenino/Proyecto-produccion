import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
    BadgePercent, Search, RefreshCw, UserPlus, UserMinus, IdCard, ChevronDown, ChevronRight, AlertTriangle, Check,
    Loader2, HelpCircle, X, Lightbulb, ArrowRight, Link2, Unlink, Pencil, ArrowLeft
} from 'lucide-react';
import api from '../../../services/apiClient';

// Recursos Humanos → Descuento a Trabajadores (/rrhh/descuento-trabajadores).
// Quién tiene aplicado el perfil de precios "Descuento Trabajadores 10%", aplicarlo o quitarlo de a
// una cuenta de cliente, vincular trabajadores de la planilla con sus cuentas y corregir cédulas.
// Backend: backend/controllers/rrhhController.js.

const API = '/rrhh/descuento-trabajadores';

// ── Formato ──────────────────────────────────────────────────────────────────
// La cuenta se nombra por su ID de cliente (lo que la gente reconoce); debajo, el nombre y la CI.
const tituloCuenta = (c) => (c.idCliente || c.nombreFantasia || c.nombre || `Cliente ${c.cliIdCliente}`).trim();
const nombresCuenta = (c) => {
    const titulo = tituloCuenta(c).toLowerCase();
    const vistos = new Set([titulo]);
    return [c.nombreFantasia, c.nombre]
        .map(v => (v || '').trim())
        .filter(v => v && !vistos.has(v.toLowerCase()) && vistos.add(v.toLowerCase()));
};
const ciTexto = (ci) => ((ci || '').trim() ? `CI ${ci.trim()}` : 'Sin CI');
const detalleCuenta = (c, { conCi = true } = {}) => [...nombresCuenta(c), conCi && ciTexto(c.cioRuc)].filter(Boolean).join(' · ');

const soloDigitos = (s) => String(s ?? '').replace(/[.\-\s]/g, '');
// Dígito verificador de la cédula uruguaya (mismo cálculo que el backend).
const ciValida = (d) => {
    if (!/^\d{6,8}$/.test(d)) return false;
    const base = d.slice(0, -1).padStart(7, '0');
    const suma = [...base].reduce((s, x, i) => s + Number(x) * [2, 9, 8, 7, 6, 3, 4][i], 0);
    return (10 - (suma % 10)) % 10 === Number(d.slice(-1));
};

// ¿La cuenta de cliente parece de ese trabajador? Compara las palabras del nombre en la planilla
// (sin acentos, de 3 letras o más) contra nombre, fantasía e ID de la cuenta.
// 'si': coinciden todas · 'parcial': alguna · 'no': ninguna.
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const coincidenciaNombre = (nombreTrabajador, cuenta) => {
    const palabras = sinAcentos(nombreTrabajador).split(/[^a-z]+/).filter(p => p.length >= 3);
    if (palabras.length === 0) return 'si';
    const texto = sinAcentos([cuenta.nombre, cuenta.nombreFantasia, cuenta.idCliente].join(' '));
    const encontradas = palabras.filter(p => texto.includes(p)).length;
    if (encontradas === palabras.length) return 'si';
    return encontradas > 0 ? 'parcial' : 'no';
};
const fecha = (f) => (f ? new Date(f).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const errorDe = (e) => e?.response?.data?.error || e?.message || 'Error desconocido';

// ── Piezas chicas ────────────────────────────────────────────────────────────
const BotonLapiz = ({ onClick, titulo }) => (
    <button type="button" onClick={onClick} title={titulo} aria-label={titulo}
        className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
        <Pencil size={12} />
    </button>
);

// Trabajador de la planilla. Con onEditarCi muestra su cédula con lápiz; con onDesvincular, si el
// vínculo es a mano, un botón para deshacerlo.
const FichaRRHH = ({ trabajador, onEditarCi, onDesvincular }) => {
    if (!trabajador) return null;
    return (
        <div className="flex items-start gap-1.5 min-w-0">
            <IdCard size={14} className="text-emerald-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
                <div className="text-xs font-bold text-slate-700 truncate">{trabajador.nombre}</div>
                <div className="text-[11px] text-slate-500 truncate">{[trabajador.area, trabajador.puesto].filter(Boolean).join(' · ') || 'Sin área'}</div>
                <div className="flex items-center gap-1 flex-wrap">
                    {onEditarCi && (
                        <span className="inline-flex items-center text-[11px] font-mono text-slate-400">
                            CI {trabajador.cedula}<BotonLapiz onClick={onEditarCi} titulo="Corregir la cédula del trabajador" />
                        </span>
                    )}
                    {trabajador.porVinculo ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-1 py-px">
                            <Link2 size={10} /> Vinculado
                            {onDesvincular && (
                                <button type="button" onClick={onDesvincular} title="Desvincular" aria-label="Desvincular"
                                    className="ml-0.5 text-indigo-400 hover:text-rose-600"><Unlink size={10} /></button>
                            )}
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

// Cuenta de cliente: ID en negrita, debajo nombre y CI (con lápiz si se puede corregir).
const Cuenta = ({ c, onEditarCi, grande = false }) => (
    <div className="min-w-0">
        <div className={`font-bold text-slate-800 truncate ${grande ? 'text-base' : 'text-sm'}`}>{tituloCuenta(c)}</div>
        <div className="text-xs text-slate-500 flex items-center gap-0.5 min-w-0">
            <span className="truncate">{detalleCuenta(c)}</span>
            {onEditarCi && <BotonLapiz onClick={onEditarCi} titulo="Corregir el CI/RUT de la cuenta" />}
        </div>
    </div>
);

const Casilla = ({ checked, onChange, children }) => (
    <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
        <span className="text-sm text-slate-700">{children}</span>
    </label>
);

const ListoOk = ({ children }) => (
    <div className="flex items-center gap-2 text-sm text-emerald-700"><Check size={16} className="shrink-0" /> {children}</div>
);

// ── Base de las ventanas ─────────────────────────────────────────────────────
const Ventana = ({ onClose, bloqueada = false, ancho = 'max-w-md', etiqueta, children }) => {
    useEffect(() => {
        const alTeclear = (e) => { if (e.key === 'Escape' && !bloqueada) onClose(); };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    }, [onClose, bloqueada]);
    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !bloqueada && onClose()}>
            <div role="dialog" aria-modal="true" aria-label={etiqueta}
                className={`bg-white rounded-2xl shadow-2xl w-full ${ancho} max-h-[90vh] flex flex-col overflow-hidden`}
                onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
};

const CabeceraVentana = ({ icono: Icono, color = 'indigo', titulo, subtitulo, onClose }) => {
    const colores = { indigo: 'bg-indigo-50 text-indigo-600', rose: 'bg-rose-50 text-rose-600', amber: 'bg-amber-50 text-amber-600' };
    return (
        <div className="px-6 pt-6 pb-2 flex items-start gap-4">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${colores[color]}`}><Icono size={20} /></div>
            <div className="min-w-0 flex-1">
                <h3 className="text-lg font-black text-slate-800">{titulo}</h3>
                {subtitulo && <p className="text-sm text-slate-500">{subtitulo}</p>}
            </div>
            {onClose && <button type="button" onClick={onClose} title="Cerrar" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>}
        </div>
    );
};

const PieVentana = ({ children }) => (
    <div className="px-6 py-4 mt-2 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">{children}</div>
);
const BotonSecundario = ({ children, ...p }) => (
    <button type="button" {...p} className="px-4 py-2.5 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">{children}</button>
);
const BotonPrincipal = ({ children, color = 'indigo', cargando, ...p }) => (
    <button type="button" {...p} className={`px-4 py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-60 inline-flex items-center justify-center gap-2 shadow-sm ${color === 'rose' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
        {cargando && <Loader2 size={16} className="animate-spin" />}{children}
    </button>
);

// ── Ayuda ────────────────────────────────────────────────────────────────────
// Réplicas de los botones de la pantalla, para que el texto los muestre tal cual se ven.
const MuestraAplicar = () => (
    <span className="inline-flex items-center gap-1 rounded-md font-bold text-[11px] bg-indigo-600 text-white px-2 py-0.5 align-middle"><UserPlus size={12} /> Aplicar</span>
);
const MuestraQuitar = () => (
    <span className="inline-flex items-center gap-1 rounded-md font-bold text-[11px] text-rose-600 border border-rose-200 bg-white px-2 py-0.5 align-middle"><UserMinus size={12} /> Quitar</span>
);
const MuestraVincular = ({ texto = 'Vincular' }) => (
    <span className="inline-flex items-center gap-1 rounded-md font-bold text-[11px] text-indigo-700 border border-indigo-200 bg-indigo-50 px-2 py-0.5 align-middle"><Link2 size={12} /> {texto}</span>
);
const MuestraLapiz = () => (
    <span className="inline-flex items-center justify-center rounded-md text-indigo-600 bg-indigo-50 w-5 h-5 align-middle"><Pencil size={11} /></span>
);

const SeccionAyuda = ({ titulo, children }) => (
    <section>
        <h3 className="text-xs font-black text-indigo-700 uppercase tracking-wide mb-2">{titulo}</h3>
        <div className="text-sm text-slate-600 leading-relaxed flex flex-col gap-2">{children}</div>
    </section>
);

const Campo = ({ nombre, children }) => (
    <li className="flex flex-col sm:flex-row gap-0.5 sm:gap-3">
        <span className="sm:w-36 shrink-0 font-bold text-slate-800">{nombre}</span>
        <span>{children}</span>
    </li>
);

const AyudaModal = ({ perfil, onClose }) => {
    const nombrePerfil = perfil?.nombre || 'Descuento Trabajadores 10%';
    return (
        <Ventana onClose={onClose} ancho="max-w-2xl" etiqueta="Ayuda">
            <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-4 flex items-center gap-3">
                <HelpCircle size={22} className="text-white shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="text-white font-black text-lg">Cómo usar esta pantalla</div>
                    <div className="text-indigo-100 text-sm">Descuento a Trabajadores</div>
                </div>
                <button type="button" onClick={onClose} title="Cerrar" className="p-1.5 rounded-lg text-white hover:bg-white/15"><X size={20} /></button>
            </div>

            <div className="p-6 overflow-y-auto flex flex-col gap-6">
                <SeccionAyuda titulo="¿Para qué sirve?">
                    <p>
                        Muestra qué cuentas de cliente tienen aplicado el perfil de precios <b>{nombrePerfil}</b>, y permite ponérselo o
                        sacárselo a cada una. Al cotizar un pedido de una cuenta de esta lista, el sistema le aplica el descuento del
                        perfil. El cambio rige para los pedidos que se coticen desde ese momento.
                    </p>
                    <p>
                        El descuento va siempre a una <b>cuenta de cliente</b> (su ID de cliente), no al trabajador ni a su usuario del
                        sistema. Por eso cada trabajador tiene que estar <b>vinculado</b> a su cuenta: por su cédula cargada en el CI/RUT
                        de la cuenta, o vinculado a mano.
                    </p>
                </SeccionAyuda>

                <SeccionAyuda titulo="Encabezado">
                    <ul className="flex flex-col gap-2">
                        <Campo nombre="Perfil de precios">El perfil que maneja esta pantalla. El porcentaje y las reglas se configuran en Gestión de Precios → Gestión de Perfiles.</Campo>
                        <Campo nombre="Se aplica en">Las áreas donde rige el descuento. <b>Todos</b> quiere decir que aplica a todos los productos.</Campo>
                        <Campo nombre="Con descuento">Cuántas cuentas lo tienen hoy.</Campo>
                        <Campo nombre={<RefreshCw size={14} className="inline" />}>Vuelve a cargar todo, por si alguien lo cambió desde otra computadora.</Campo>
                    </ul>
                </SeccionAyuda>

                <SeccionAyuda titulo="Lista: trabajadores con el descuento">
                    <ul className="flex flex-col gap-2">
                        <Campo nombre="Cuenta de cliente">En negrita el ID de cliente; debajo, el nombre de la cuenta.</Campo>
                        <Campo nombre="CI / RUT">El documento de la cuenta, el mismo que va en sus facturas. Con <MuestraLapiz /> se corrige.</Campo>
                        <Campo nombre="Ficha RRHH">
                            El trabajador de la planilla que corresponde a esa cuenta: nombre, área y puesto. Si dice <b>Vinculado</b>, se unió a mano.
                            Si no hay ninguno, aparece <MuestraVincular texto="Vincular trabajador" /> para elegirlo.
                        </Campo>
                        <Campo nombre="Otros perfiles">Otros perfiles de precio de la cuenta. Al quitar el descuento de trabajador, estos se mantienen.</Campo>
                        <Campo nombre="Actualizado">La última vez que se modificaron los perfiles de esa cuenta.</Campo>
                    </ul>
                    <p>El cuadro <b>Filtrar la lista</b> busca dentro de la lista por ID, nombre, cédula, nombre del trabajador o área.</p>
                </SeccionAyuda>

                <SeccionAyuda titulo="Cómo poner el descuento">
                    <ol className="list-decimal pl-5 flex flex-col gap-1.5">
                        <li>En <b>Aplicar el descuento</b>, escribí ID de cliente, código, cédula o palabras del nombre (sin importar acentos ni el orden).</li>
                        <li>Fijate en el ID, la CI y la Ficha RRHH para confirmar que es la cuenta correcta.</li>
                        <li>Tocá <MuestraAplicar />. La cuenta pasa a la lista.</li>
                    </ol>
                    <p>También se puede desde las listas de abajo (ver "Cruce con la planilla").</p>
                </SeccionAyuda>

                <SeccionAyuda titulo="Cómo quitar el descuento">
                    <ol className="list-decimal pl-5 flex flex-col gap-1.5">
                        <li>Buscá la cuenta en la lista. Si son muchas, usá <b>Filtrar la lista</b>.</li>
                        <li>Tocá <MuestraQuitar /> en su fila.</li>
                        <li>Se abre una ventana con los datos de la cuenta. Revisá que sea la correcta y tocá <b>Quitar descuento</b>; con <b>Cancelar</b> no cambia nada.</li>
                    </ol>
                </SeccionAyuda>

                <SeccionAyuda titulo="Vincular un trabajador con su cuenta">
                    <p>Se puede hacer desde los dos lados:</p>
                    <ul className="flex flex-col gap-2">
                        <Campo nombre="Desde la cuenta">En la lista, la cuenta que no tiene Ficha RRHH muestra <MuestraVincular texto="Vincular trabajador" />: buscás al trabajador en la planilla y lo elegís.</Campo>
                        <Campo nombre="Desde el trabajador">En <b>Trabajadores sin cuenta de cliente</b>, <MuestraVincular texto="Vincular cuenta" />: buscás su cuenta y la elegís.</Campo>
                    </ul>
                    <p>Antes de confirmar, la ventana ofrece dos cosas:</p>
                    <ul className="list-disc pl-5 flex flex-col gap-1.5">
                        <li><b>Cargar la CI en la cuenta</b>: copia la cédula del trabajador al CI/RUT de la cuenta, así queda bien en las facturas y el cruce sale solo. Si la cuenta ya tiene otro documento (por ejemplo, el RUT de su empresa), viene desmarcado: el vínculo funciona igual sin tocarlo.</li>
                        <li><b>Aplicar el descuento</b> a esa cuenta en el mismo paso.</li>
                    </ul>
                    <p>Para deshacer un vínculo hecho a mano, tocá el ícono de desvincular al lado de <b>Vinculado</b>. Si el cruce es por cédula, se deshace corrigiendo la CI.</p>
                </SeccionAyuda>

                <SeccionAyuda titulo="Corregir cédulas">
                    <ul className="flex flex-col gap-2">
                        <Campo nombre="CI de la cuenta"><MuestraLapiz /> al lado de la CI de una cuenta. Acepta CI (con o sin puntos y guion) o RUT de 12 dígitos. Es el documento de las facturas del cliente.</Campo>
                        <Campo nombre="CI del trabajador"><MuestraLapiz /> al lado de la CI en la Ficha RRHH. Cambia la cédula en la planilla; tiene que tener el dígito verificador correcto. A un vendedor no se le puede cambiar desde acá, porque sus clientes están asignados por esa cédula.</Campo>
                    </ul>
                </SeccionAyuda>

                <SeccionAyuda titulo="Cruce con la planilla (las dos listas de abajo)">
                    <ul className="flex flex-col gap-2">
                        <Campo nombre="Sin el descuento">
                            El trabajador tiene cuenta (vinculada o con su cédula), pero esa cuenta no tiene el descuento. A la izquierda el
                            trabajador, a la derecha la <b>cuenta que recibe el descuento</b> si tocás <MuestraAplicar />. Un aviso amarillo
                            quiere decir que el nombre de la cuenta no se parece al del trabajador: puede ser una cuenta de la empresa o de otra
                            persona con la cédula mal cargada. Revisala antes de aplicar.
                        </Campo>
                        <Campo nombre="Sin cuenta de cliente">
                            No tiene ninguna cuenta vinculada ni con su cédula, así que todavía no se le puede aplicar. Tocá <MuestraVincular texto="Vincular cuenta" />
                            y buscala. Si no tiene cuenta, creásela en Gestión Clientes con su cédula en CI/RUT.
                        </Campo>
                    </ul>
                </SeccionAyuda>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex gap-3">
                    <Lightbulb size={18} className="shrink-0 mt-0.5 text-amber-600" />
                    <ul className="flex flex-col gap-1.5">
                        <li><b>No encuentro la cuenta:</b> probá con menos palabras, con el ID de cliente o con la cédula.</li>
                        <li>Cada cambio (aplicar, quitar, vincular, corregir una CI) queda registrado en la Auditoría con el usuario que lo hizo.</li>
                        <li>Es la misma asignación que se ve en Gestión de Precios → Asignación a Clientes: lo que cambies acá se ve allá también.</li>
                    </ul>
                </div>
            </div>

            <PieVentana><BotonPrincipal onClick={onClose}>Entendido</BotonPrincipal></PieVentana>
        </Ventana>
    );
};

// ── Confirmación para quitar ─────────────────────────────────────────────────
const ConfirmarQuitarModal = ({ cliente, perfil, procesando, onConfirmar, onCancelar }) => {
    const cancelarRef = useRef(null);
    useEffect(() => { cancelarRef.current?.focus(); }, []);
    return (
        <Ventana onClose={onCancelar} bloqueada={procesando} etiqueta="Quitar descuento">
            <CabeceraVentana icono={UserMinus} color="rose" titulo="Quitar descuento"
                subtitulo={<>Se le va a quitar el perfil <b className="text-slate-700">{perfil?.nombre || 'Descuento Trabajadores'}</b> a:</>} />
            <div className="mx-6 mt-2 bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
                <Cuenta c={cliente} grande />
                <FichaRRHH trabajador={cliente.trabajador} />
                {cliente.otrosPerfiles?.length > 0 && (
                    <div className="text-xs text-slate-500">
                        Mantiene: {cliente.otrosPerfiles.map(p => (
                            <span key={p} className="inline-block font-semibold bg-white text-slate-600 border border-slate-200 rounded px-1.5 py-0.5 mr-1">{p}</span>
                        ))}
                    </div>
                )}
            </div>
            <p className="px-6 mt-4 text-sm text-slate-600">
                Los pedidos que se coticen desde ahora van a <b>precio normal</b>. Si te equivocás, lo podés volver a aplicar desde el buscador.
            </p>
            <PieVentana>
                <button ref={cancelarRef} type="button" onClick={onCancelar} disabled={procesando}
                    className="px-4 py-2.5 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
                    Cancelar
                </button>
                <BotonPrincipal color="rose" onClick={onConfirmar} disabled={procesando} cargando={procesando}>
                    {!procesando && <UserMinus size={16} />}{procesando ? 'Quitando…' : 'Quitar descuento'}
                </BotonPrincipal>
            </PieVentana>
        </Ventana>
    );
};

// ── Corregir una cédula ──────────────────────────────────────────────────────
// tipo 'cuenta': Clientes.CioRuc (CI o RUT, va en las facturas) · tipo 'trabajador': la planilla.
const EditarCiModal = ({ edicion, onClose, onGuardado }) => {
    const { tipo, id, ciActual, quien } = edicion;
    const [valor, setValor] = useState(ciActual || '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    const inputRef = useRef(null);
    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

    const d = soloDigitos(valor);
    const esCuenta = tipo === 'cuenta';
    const formatoOk = esCuenta ? /^(\d{6,8}|\d{12})$/.test(d) : /^\d{6,8}$/.test(d);
    const esCi = /^\d{6,8}$/.test(d);
    const verificadorMal = esCi && !ciValida(d);
    const sinCambios = d === soloDigitos(ciActual);
    const puedeGuardar = formatoOk && !sinCambios && !(verificadorMal && !esCuenta);

    const guardar = async () => {
        if (!puedeGuardar) return;
        setGuardando(true);
        setError(null);
        try {
            const url = esCuenta ? `${API}/clientes/${id}/ci` : `${API}/trabajadores/${id}/ci`;
            await api.put(url, { ci: d });
            toast.success(esCuenta ? `CI/RUT de ${quien} actualizado` : `Cédula de ${quien} actualizada`);
            onGuardado();
        } catch (e) {
            setError(errorDe(e));
        } finally {
            setGuardando(false);
        }
    };

    return (
        <Ventana onClose={onClose} bloqueada={guardando} etiqueta="Corregir cédula">
            <CabeceraVentana icono={Pencil} titulo={esCuenta ? 'CI / RUT de la cuenta' : 'Cédula del trabajador'} subtitulo={quien} onClose={guardando ? null : onClose} />
            <div className="px-6 flex flex-col gap-3">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{esCuenta ? 'CI o RUT' : 'Cédula'}</label>
                    <input ref={inputRef} type="text" inputMode="numeric" value={valor}
                        onChange={e => { setValor(e.target.value); setError(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') guardar(); }}
                        placeholder={esCuenta ? 'Ej: 5.413.264-9 o 217654320018' : 'Ej: 5.413.264-9'}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-lg font-mono outline-none focus:ring-2 focus:ring-indigo-400" />
                    <div className="text-xs text-slate-400 mt-1">Actual: {(ciActual || '').trim() || 'vacío'}</div>
                </div>
                {d && !formatoOk && (
                    <div className="text-xs text-rose-600">{esCuenta ? 'Una CI tiene de 6 a 8 dígitos y un RUT, 12.' : 'Una cédula tiene de 6 a 8 dígitos.'}</div>
                )}
                {verificadorMal && (
                    <div className="flex items-start gap-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                        <AlertTriangle size={14} className="shrink-0 mt-px" />
                        {esCuenta
                            ? 'El dígito verificador no coincide: revisá que esté bien escrita. Se puede guardar igual.'
                            : 'El dígito verificador no coincide: revisá que esté bien escrita.'}
                    </div>
                )}
                <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                    {esCuenta
                        ? 'Es el documento que va en las facturas de este cliente. Se guarda solo con números.'
                        : 'Cambia la cédula en la planilla de trabajadores. A un vendedor no se le puede cambiar desde acá: sus clientes están asignados por esa cédula.'}
                </div>
                {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">{error}</div>}
            </div>
            <PieVentana>
                <BotonSecundario onClick={onClose} disabled={guardando}>Cancelar</BotonSecundario>
                <BotonPrincipal onClick={guardar} disabled={!puedeGuardar || guardando} cargando={guardando}>Guardar</BotonPrincipal>
            </PieVentana>
        </Ventana>
    );
};

// ── Vincular trabajador ↔ cuenta ─────────────────────────────────────────────
// desde 'trabajador': se busca la cuenta · desde 'cuenta': se busca al trabajador en la planilla.
const VincularModal = ({ inicio, perfil, onClose, onHecho }) => {
    const desdeTrabajador = inicio.desde === 'trabajador';
    const [trabajador, setTrabajador] = useState(desdeTrabajador ? inicio.trabajador : null);
    const [cuenta, setCuenta] = useState(desdeTrabajador ? null : inicio.cuenta);
    const [q, setQ] = useState(() => {
        if (desdeTrabajador) return inicio.trabajador.nombre;
        return (inicio.cuenta.nombre || inicio.cuenta.nombreFantasia || '').trim();
    });
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const [cargarCi, setCargarCi] = useState(false);
    const [aplicarDescuento, setAplicarDescuento] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const ultima = useRef(0);
    const enConfirmacion = !!(trabajador && cuenta);

    useEffect(() => {
        if (enConfirmacion) return undefined;
        const t0 = q.trim();
        if (t0.length < 2) { setResultados([]); setBuscando(false); return undefined; }
        setBuscando(true);
        const n = ++ultima.current;
        const t = setTimeout(async () => {
            try {
                const { data } = await api.get(desdeTrabajador ? `${API}/buscar` : `${API}/trabajadores`, { params: { q: t0 } });
                if (n === ultima.current) setResultados(data || []);
            } catch (e) {
                if (n === ultima.current) toast.error('Error buscando: ' + errorDe(e));
            } finally {
                if (n === ultima.current) setBuscando(false);
            }
        }, 300);
        return () => clearTimeout(t);
    }, [q, desdeTrabajador, enConfirmacion]);

    // Al llegar a la confirmación: cargar la CI solo si la cuenta no tiene documento.
    useEffect(() => {
        if (!enConfirmacion) return;
        setCargarCi(!soloDigitos(cuenta.cioRuc));
        setAplicarDescuento(true);
    }, [enConfirmacion, cuenta]);

    const elegir = (r) => {
        if (desdeTrabajador) setCuenta(r);
        else setTrabajador(r.trabajador);
    };
    const volver = () => { if (desdeTrabajador) setCuenta(null); else setTrabajador(null); };

    const ciCuenta = soloDigitos(cuenta?.cioRuc);
    const mismaCi = enConfirmacion && ciCuenta === String(trabajador.cedula);
    const otroDocumento = enConfirmacion && !!ciCuenta && !mismaCi;
    const yaTieneDescuento = !!cuenta?.tieneDescuento;

    const confirmar = async () => {
        setGuardando(true);
        try {
            await api.post(`${API}/vinculos`, {
                cedula: trabajador.cedula,
                cliIdCliente: cuenta.cliIdCliente,
                cargarCi: !mismaCi && cargarCi,
                aplicarDescuento: !!perfil && !yaTieneDescuento && aplicarDescuento
            });
            toast.success(`${trabajador.nombre} vinculado a ${tituloCuenta(cuenta)}`);
            onHecho();
        } catch (e) {
            toast.error('No se pudo vincular: ' + errorDe(e));
        } finally {
            setGuardando(false);
        }
    };

    return (
        <Ventana onClose={onClose} bloqueada={guardando} ancho="max-w-xl" etiqueta="Vincular">
            <CabeceraVentana icono={Link2}
                titulo={desdeTrabajador ? 'Vincular cuenta de cliente' : 'Vincular trabajador'}
                subtitulo={desdeTrabajador ? <>Elegí la cuenta de <b className="text-slate-700">{inicio.trabajador.nombre}</b></> : <>Elegí el trabajador de la cuenta <b className="text-slate-700">{tituloCuenta(inicio.cuenta)}</b></>}
                onClose={guardando ? null : onClose} />

            {!enConfirmacion ? (
                <div className="px-6 pb-6 flex flex-col gap-3 overflow-hidden">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input autoFocus type="text" value={q} onChange={e => setQ(e.target.value)}
                            placeholder={desdeTrabajador ? 'ID de cliente, nombre, código o cédula…' : 'Nombre o cédula del trabajador…'}
                            className="w-full border border-slate-300 rounded-xl pl-9 pr-9 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                        {buscando && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />}
                    </div>
                    <p className="text-xs text-slate-400">No importan los acentos ni el orden de las palabras. Si no aparece, probá con menos palabras{desdeTrabajador ? ', el ID de cliente o la cédula' : ' o la cédula'}.</p>
                    <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-y-auto max-h-80">
                        {!buscando && q.trim().length >= 2 && resultados.length === 0 && (
                            <li className="px-4 py-6 text-center text-sm text-slate-400">
                                Sin resultados.{desdeTrabajador && ' Si no tiene cuenta, hay que crearla en Gestión Clientes.'}
                            </li>
                        )}
                        {resultados.map(r => (
                            <li key={desdeTrabajador ? r.cliIdCliente : r.cedula} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                                <div className="flex-1 min-w-0">
                                    {desdeTrabajador ? (
                                        <>
                                            <Cuenta c={r} />
                                            {r.trabajador && (
                                                <div className="text-[11px] text-amber-700 mt-0.5 truncate">Ya corresponde a {r.trabajador.nombre}</div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <FichaRRHH trabajador={r.trabajador} />
                                            <div className="text-[11px] font-mono text-slate-400 pl-5">CI {r.cedula}</div>
                                        </>
                                    )}
                                </div>
                                <button type="button" onClick={() => elegir(r)}
                                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100">
                                    Elegir
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <>
                    <div className="px-6 flex flex-col gap-4 overflow-y-auto">
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-center">
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 min-w-0">
                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-1">Trabajador</div>
                                <FichaRRHH trabajador={trabajador} />
                                <div className="text-[11px] font-mono text-slate-500 pl-5 mt-0.5">CI {trabajador.cedula}</div>
                            </div>
                            <Link2 size={18} className="text-indigo-400 justify-self-center rotate-90 sm:rotate-0" />
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 min-w-0">
                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-1">Cuenta de cliente</div>
                                <Cuenta c={cuenta} />
                            </div>
                        </div>

                        {coincidenciaNombre(trabajador.nombre, cuenta) === 'no' && (
                            <div className="flex items-start gap-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                                <AlertTriangle size={14} className="shrink-0 mt-px" />
                                El nombre de la cuenta no se parece al del trabajador. Confirmá que sea su cuenta antes de vincular.
                            </div>
                        )}

                        <div className="flex flex-col gap-3 border border-slate-200 rounded-xl p-4">
                            {mismaCi ? (
                                <ListoOk>La cuenta ya tiene la CI {trabajador.cedula}.</ListoOk>
                            ) : (
                                <div className="flex flex-col gap-1.5">
                                    <Casilla checked={cargarCi} onChange={setCargarCi}>
                                        Cargar la CI <b className="font-mono">{trabajador.cedula}</b> en el CI/RUT de la cuenta
                                    </Casilla>
                                    {otroDocumento ? (
                                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 ml-6">
                                            La cuenta tiene el documento <b className="font-mono">{cuenta.cioRuc.trim()}</b>, que es el que va en sus facturas.
                                            Reemplazalo solo si está mal; si es el RUT de su empresa, dejalo: el vínculo funciona igual.
                                        </p>
                                    ) : (
                                        <p className="text-xs text-slate-500 ml-6">La cuenta no tiene documento: conviene cargarlo, también sirve para sus facturas.</p>
                                    )}
                                </div>
                            )}
                            {perfil && (yaTieneDescuento ? (
                                <ListoOk>La cuenta ya tiene el descuento.</ListoOk>
                            ) : (
                                <Casilla checked={aplicarDescuento} onChange={setAplicarDescuento}>
                                    Aplicar el descuento <b>{perfil.nombre}</b> a esta cuenta
                                </Casilla>
                            ))}
                        </div>
                    </div>
                    <PieVentana>
                        <BotonSecundario onClick={volver} disabled={guardando}><ArrowLeft size={14} /> Elegir otro</BotonSecundario>
                        <BotonPrincipal onClick={confirmar} disabled={guardando} cargando={guardando}>
                            {!guardando && <Link2 size={16} />} Vincular
                        </BotonPrincipal>
                    </PieVentana>
                </>
            )}
        </Ventana>
    );
};

// ── Pantalla ─────────────────────────────────────────────────────────────────
const DescuentoTrabajadoresPage = () => {
    const [perfil, setPerfil] = useState(null);
    const [clientes, setClientes] = useState([]);
    const [sugeridos, setSugeridos] = useState([]);
    const [sinCuenta, setSinCuenta] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [errorCarga, setErrorCarga] = useState(null);
    const [filtro, setFiltro] = useState('');
    const [enCurso, setEnCurso] = useState(null); // cliIdCliente que se está aplicando/quitando
    const [verSugeridos, setVerSugeridos] = useState(false);
    const [verSinCuenta, setVerSinCuenta] = useState(false);

    // Ventanas
    const [verAyuda, setVerAyuda] = useState(false);
    const [aQuitar, setAQuitar] = useState(null);       // cuenta esperando confirmación
    const [edicionCi, setEdicionCi] = useState(null);   // { tipo, id, ciActual, quien }
    const [vinculo, setVinculo] = useState(null);       // { desde: 'trabajador'|'cuenta', trabajador?, cuenta? }
    const cerrarAyuda = useCallback(() => setVerAyuda(false), []);
    const cancelarQuitar = useCallback(() => setAQuitar(null), []);
    const cerrarEdicionCi = useCallback(() => setEdicionCi(null), []);
    const cerrarVinculo = useCallback(() => setVinculo(null), []);

    // Buscador para aplicar el descuento
    const [busqueda, setBusqueda] = useState('');
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const [refrescoBusqueda, setRefrescoBusqueda] = useState(0);
    const ultimaBusqueda = useRef(0);

    const cargar = useCallback(async () => {
        setCargando(true);
        setErrorCarga(null);
        try {
            const { data } = await api.get(API);
            setPerfil(data.perfil);
            setClientes(data.clientes || []);
            setSugeridos(data.sugeridos || []);
            setSinCuenta(data.sinCuenta || []);
        } catch (e) {
            setErrorCarga(errorDe(e));
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    useEffect(() => {
        const q = busqueda.trim();
        if (q.length < 2) { setResultados([]); setBuscando(false); return undefined; }
        setBuscando(true);
        const n = ++ultimaBusqueda.current;
        const t = setTimeout(async () => {
            try {
                const { data } = await api.get(`${API}/buscar`, { params: { q } });
                if (n === ultimaBusqueda.current) setResultados(data || []);
            } catch (e) {
                if (n === ultimaBusqueda.current) toast.error('Error buscando clientes: ' + errorDe(e));
            } finally {
                if (n === ultimaBusqueda.current) setBuscando(false);
            }
        }, 350);
        return () => clearTimeout(t);
    }, [busqueda, refrescoBusqueda]);

    // Después de vincular o corregir una CI cambian fichas y cruces: se recarga todo.
    const recargarTodo = useCallback(() => {
        setRefrescoBusqueda(n => n + 1);
        return cargar();
    }, [cargar]);

    const aplicar = async (c) => {
        setEnCurso(c.cliIdCliente);
        try {
            await api.post(`${API}/${c.cliIdCliente}`);
            toast.success(`Descuento aplicado a ${tituloCuenta(c)}`);
            setResultados(prev => prev.map(r => (r.cliIdCliente === c.cliIdCliente ? { ...r, tieneDescuento: true } : r)));
            await cargar();
        } catch (e) {
            toast.error('No se pudo aplicar: ' + errorDe(e));
        } finally {
            setEnCurso(null);
        }
    };

    // El botón Quitar de la fila abre la confirmación; esto corre al confirmar.
    const confirmarQuitar = async () => {
        const c = aQuitar;
        if (!c) return;
        setEnCurso(c.cliIdCliente);
        try {
            await api.delete(`${API}/${c.cliIdCliente}`);
            toast.success(`Descuento quitado a ${tituloCuenta(c)}`);
            setResultados(prev => prev.map(r => (r.cliIdCliente === c.cliIdCliente ? { ...r, tieneDescuento: false } : r)));
            setAQuitar(null);
            await cargar();
        } catch (e) {
            toast.error('No se pudo quitar: ' + errorDe(e));
        } finally {
            setEnCurso(null);
        }
    };

    const desvincular = async (trabajador, c) => {
        try {
            await api.delete(`${API}/vinculos/${trabajador.cedula}/${c.cliIdCliente}`);
            toast.success(`${trabajador.nombre} desvinculado de ${tituloCuenta(c)}`);
            await recargarTodo();
        } catch (e) {
            toast.error('No se pudo desvincular: ' + errorDe(e));
        }
    };

    const editarCiCuenta = (c) => setEdicionCi({ tipo: 'cuenta', id: c.cliIdCliente, ciActual: c.cioRuc, quien: tituloCuenta(c) });
    const editarCiTrabajador = (t) => setEdicionCi({ tipo: 'trabajador', id: t.cedula, ciActual: String(t.cedula), quien: t.nombre });

    const clientesFiltrados = useMemo(() => {
        const f = sinAcentos(filtro.trim());
        if (!f) return clientes;
        return clientes.filter(c => [c.idCliente, c.nombre, c.nombreFantasia, c.codCliente, c.cioRuc, c.trabajador?.nombre, c.trabajador?.area]
            .some(v => v != null && sinAcentos(v).includes(f)));
    }, [clientes, filtro]);

    const botonAplicar = (c) => (
        <button
            type="button"
            onClick={() => aplicar(c)}
            disabled={enCurso != null || !perfil}
            className="inline-flex items-center gap-1.5 rounded-lg font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors px-2.5 py-1.5"
        >
            {enCurso === c.cliIdCliente ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Aplicar
        </button>
    );
    const botonVincular = (texto, onClick) => (
        <button type="button" onClick={onClick}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100">
            <Link2 size={14} /> {texto}
        </button>
    );

    return (
        <div className="h-full overflow-y-auto bg-slate-50">
            <div className="max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-5">

                {/* Encabezado */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                            <BadgePercent size={22} />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-xl font-black text-slate-800">Descuento a Trabajadores</h1>
                            <p className="text-sm text-slate-500 truncate">
                                {perfil
                                    ? <>Perfil de precios <span className="font-semibold text-slate-700">{perfil.nombre}</span> · se aplica en: <span className="font-semibold text-slate-700">{perfil.categoria}</span></>
                                    : 'Clientes con el perfil de precios de trabajadores'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <div className="text-2xl font-black text-indigo-700 leading-none">{cargando ? '…' : clientes.length}</div>
                            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">con descuento</div>
                        </div>
                        <button type="button" onClick={recargarTodo} disabled={cargando} title="Actualizar"
                            className="p-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50">
                            <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} />
                        </button>
                        <button type="button" onClick={() => setVerAyuda(true)} title="Ayuda: cómo usar esta pantalla" aria-label="Ayuda"
                            className="p-2.5 rounded-xl border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100">
                            <HelpCircle size={16} />
                        </button>
                    </div>
                </div>

                {verAyuda && <AyudaModal perfil={perfil} onClose={cerrarAyuda} />}
                {aQuitar && (
                    <ConfirmarQuitarModal cliente={aQuitar} perfil={perfil} procesando={enCurso === aQuitar.cliIdCliente}
                        onConfirmar={confirmarQuitar} onCancelar={cancelarQuitar} />
                )}
                {edicionCi && (
                    <EditarCiModal edicion={edicionCi} onClose={cerrarEdicionCi}
                        onGuardado={() => { setEdicionCi(null); recargarTodo(); }} />
                )}
                {vinculo && (
                    <VincularModal inicio={vinculo} perfil={perfil} onClose={cerrarVinculo}
                        onHecho={() => { setVinculo(null); recargarTodo(); }} />
                )}

                {errorCarga && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm flex items-center gap-2">
                        <AlertTriangle size={16} className="shrink-0" /> No se pudo cargar la lista: {errorCarga}
                    </div>
                )}

                {!cargando && !errorCarga && !perfil && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm flex items-start gap-2">
                        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                        <div>
                            No se encontró el perfil de precios <b>Descuento Trabajadores</b>. Revisá que esté activo en Gestión de Precios →
                            Gestión de Perfiles, o que la clave <code className="font-mono text-xs">RRHH_PERFIL_DESCUENTO_TRABAJADORES</code> de
                            ConfiguracionGlobal tenga su ID.
                        </div>
                    </div>
                )}

                {/* Aplicar a una cuenta */}
                {perfil && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                        <h2 className="text-sm font-black text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                            <UserPlus size={16} className="text-indigo-500" /> Aplicar el descuento
                        </h2>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                                placeholder="Buscar cuenta por ID de cliente, nombre, código o cédula…"
                                className="w-full border border-slate-300 rounded-xl pl-9 pr-9 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                            {buscando && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />}
                        </div>

                        {busqueda.trim().length >= 2 && !buscando && resultados.length === 0 && (
                            <p className="text-sm text-slate-400 mt-3">Sin resultados para “{busqueda.trim()}”.</p>
                        )}

                        {resultados.length > 0 && (
                            <ul className="mt-3 divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                                {resultados.map(c => (
                                    <li key={c.cliIdCliente} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-2.5 hover:bg-slate-50">
                                        <div className="flex-1 min-w-0"><Cuenta c={c} /></div>
                                        <div className="sm:w-56">
                                            {c.trabajador
                                                ? <FichaRRHH trabajador={c.trabajador} />
                                                : <span className="text-[11px] text-slate-400">Sin trabajador vinculado</span>}
                                        </div>
                                        <div className="sm:w-28 sm:text-right">
                                            {c.tieneDescuento
                                                ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5"><Check size={14} /> Ya lo tiene</span>
                                                : botonAplicar(c)}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {/* Quiénes lo tienen */}
                {perfil && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
                            <h2 className="text-sm font-black text-slate-700 uppercase tracking-wide flex-1">Trabajadores con el descuento</h2>
                            <div className="relative sm:w-72">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input type="text" value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Filtrar la lista…"
                                    className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-[11px] font-black text-slate-500 uppercase tracking-wide text-left">
                                        <th className="px-5 py-2.5">Cuenta de cliente</th>
                                        <th className="px-3 py-2.5">CI / RUT</th>
                                        <th className="px-3 py-2.5">Ficha RRHH</th>
                                        <th className="px-3 py-2.5">Otros perfiles</th>
                                        <th className="px-3 py-2.5">Actualizado</th>
                                        <th className="px-5 py-2.5 text-right"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {cargando && clientes.length === 0 && (
                                        <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400"><Loader2 size={20} className="inline animate-spin" /></td></tr>
                                    )}
                                    {!cargando && clientesFiltrados.length === 0 && (
                                        <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                                            {clientes.length === 0 ? 'Nadie tiene el descuento aplicado.' : 'Ninguna cuenta coincide con el filtro.'}
                                        </td></tr>
                                    )}
                                    {clientesFiltrados.map(c => (
                                        <tr key={c.cliIdCliente} className="hover:bg-slate-50/70">
                                            <td className="px-5 py-3 max-w-[260px]">
                                                <div className="font-bold text-slate-800 truncate">{c.existeCliente ? tituloCuenta(c) : `Cliente ${c.cliIdCliente} (no existe)`}</div>
                                                <div className="text-xs text-slate-500 truncate">{detalleCuenta(c, { conCi: false })}</div>
                                            </td>
                                            <td className="px-3 py-3 whitespace-nowrap">
                                                <span className="inline-flex items-center gap-0.5">
                                                    <span className={`text-xs font-mono ${(c.cioRuc || '').trim() ? 'text-slate-600' : 'text-slate-300'}`}>{(c.cioRuc || '').trim() || '—'}</span>
                                                    {c.existeCliente && <BotonLapiz onClick={() => editarCiCuenta(c)} titulo="Corregir el CI/RUT de la cuenta" />}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 max-w-[240px]">
                                                {c.trabajador
                                                    ? <FichaRRHH trabajador={c.trabajador}
                                                        onEditarCi={() => editarCiTrabajador(c.trabajador)}
                                                        onDesvincular={() => desvincular(c.trabajador, c)} />
                                                    : c.existeCliente && botonVincular('Vincular trabajador', () => setVinculo({ desde: 'cuenta', cuenta: { ...c, tieneDescuento: true } }))}
                                            </td>
                                            <td className="px-3 py-3">
                                                {c.otrosPerfiles.length === 0
                                                    ? <span className="text-slate-300 text-xs">—</span>
                                                    : <div className="flex flex-wrap gap-1">{c.otrosPerfiles.map(p => (
                                                        <span key={p} className="text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5">{p}</span>
                                                    ))}</div>}
                                            </td>
                                            <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">{fecha(c.ultimaActualizacion)}</td>
                                            <td className="px-5 py-3 text-right">
                                                <button type="button" onClick={() => setAQuitar(c)} disabled={enCurso != null}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-rose-600 border border-rose-200 hover:bg-rose-50 disabled:opacity-50 transition-colors">
                                                    {enCurso === c.cliIdCliente ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />} Quitar
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Cuentas de trabajadores (vinculadas o con su cédula) que no tienen el descuento */}
                {perfil && sugeridos.length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <button type="button" onClick={() => setVerSugeridos(v => !v)}
                            className="w-full px-5 py-4 flex items-center gap-2 text-left hover:bg-slate-50">
                            {verSugeridos ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                            <span className="text-sm font-black text-slate-700 uppercase tracking-wide flex-1">Trabajadores sin el descuento</span>
                            <span className="text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5">{sugeridos.length}</span>
                        </button>
                        {verSugeridos && (
                            <>
                                <p className="px-5 pb-3 text-xs text-slate-500">
                                    Trabajadores de la planilla con una cuenta de cliente (vinculada o con su misma cédula) que no tiene el descuento.
                                    <b> Aplicar</b> se lo pone a la cuenta de la derecha. Revisá que sea de esa persona: si la cédula está mal cargada,
                                    la cuenta puede ser de otro.
                                </p>
                                <div className="hidden md:grid grid-cols-[minmax(0,15rem)_1.25rem_minmax(0,1fr)_6rem] gap-3 px-5 py-2 bg-slate-50 border-t border-slate-100 text-[11px] font-black text-slate-500 uppercase tracking-wide">
                                    <span>Trabajador (planilla RRHH)</span>
                                    <span />
                                    <span>Cuenta de cliente que recibe el descuento</span>
                                    <span />
                                </div>
                                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                                    {sugeridos.map(s => {
                                        const coincide = coincidenciaNombre(s.trabajador?.nombre, s);
                                        return (
                                            <li key={s.cliIdCliente} className="grid grid-cols-1 md:grid-cols-[minmax(0,15rem)_1.25rem_minmax(0,1fr)_6rem] md:items-center gap-2 md:gap-3 px-5 py-3">
                                                <FichaRRHH trabajador={s.trabajador}
                                                    onEditarCi={() => editarCiTrabajador(s.trabajador)}
                                                    onDesvincular={() => desvincular(s.trabajador, s)} />
                                                <ArrowRight size={16} className="hidden md:block text-slate-300" />
                                                <div className="min-w-0">
                                                    <Cuenta c={s} onEditarCi={() => editarCiCuenta(s)} />
                                                    {coincide === 'no' && (
                                                        <div className="mt-1 inline-flex items-start gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                                                            <AlertTriangle size={12} className="shrink-0 mt-px" />
                                                            El nombre de la cuenta no se parece al del trabajador. Puede ser una cuenta de otra persona o de la empresa con su cédula: revisala antes de aplicar.
                                                        </div>
                                                    )}
                                                    {coincide === 'parcial' && (
                                                        <div className="mt-1 text-[11px] text-slate-500">El nombre coincide solo en parte: revisá que sea la misma persona.</div>
                                                    )}
                                                    {s.otraCuentaConDescuento && (
                                                        <div className="mt-1 text-[11px] text-emerald-700">Ya tiene el descuento en otra cuenta: <b>{s.otraCuentaConDescuento}</b>.</div>
                                                    )}
                                                </div>
                                                <div className="md:text-right">{botonAplicar(s)}</div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </>
                        )}
                    </div>
                )}

                {/* Trabajadores de la planilla sin ninguna cuenta */}
                {perfil && sinCuenta.length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <button type="button" onClick={() => setVerSinCuenta(v => !v)}
                            className="w-full px-5 py-4 flex items-center gap-2 text-left hover:bg-slate-50">
                            {verSinCuenta ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                            <span className="text-sm font-black text-slate-700 uppercase tracking-wide flex-1">Trabajadores sin cuenta de cliente</span>
                            <span className="text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200 rounded-full px-2.5 py-0.5">{sinCuenta.length}</span>
                        </button>
                        {verSinCuenta && (
                            <>
                                <div className="px-5 pb-4 text-xs text-slate-600 flex flex-col gap-1.5">
                                    <p>
                                        No tienen ninguna cuenta vinculada ni con su cédula, así que <b>todavía no se les puede aplicar el descuento</b>.
                                        Puede que tengan cuenta sin la cédula cargada, o que no tengan.
                                    </p>
                                    <ol className="list-decimal pl-5 flex flex-col gap-1">
                                        <li>Tocá <b>Vincular cuenta</b> y buscá su cuenta. Al vincularla podés cargarle la CI y aplicarle el descuento en el mismo paso.</li>
                                        <li>Si no tiene cuenta, creásela en Gestión Clientes con su cédula en CI/RUT. Después va a aparecer en <b>Trabajadores sin el descuento</b>.</li>
                                    </ol>
                                </div>
                                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                                    {sinCuenta.map(t => (
                                        <li key={t.cedula} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-2.5">
                                            <div className="flex-1 min-w-0">
                                                <FichaRRHH trabajador={t.trabajador} onEditarCi={() => editarCiTrabajador(t.trabajador)} />
                                            </div>
                                            <div className="sm:text-right">
                                                {botonVincular('Vincular cuenta', () => setVinculo({ desde: 'trabajador', trabajador: t.trabajador }))}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DescuentoTrabajadoresPage;
