import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { Palette, Pipette, ChevronDown, ChevronUp, AlertTriangle, Info, ImagePlus, X, RotateCcw, Check } from 'lucide-react';
import { Listbox, Transition } from '@headlessui/react';
import api from '../../../services/apiClient';

const CMYK_META = {
    C: { color: '#00B5CC' },
    M: { color: '#EC008C' },
    Y: { color: '#FFD700' },
    K: { color: '#1a1a1a' },
};

const DEFAULT_LAB = { L: 55, a: 25, b: -30 };

const LAB_FIELDS = [
    { key: 'L', label: 'L* (Luminosidad)', min: 0,    max: 100 },
    { key: 'a', label: 'A* (verde ↔ rojo)', min: -128, max: 127 },
    { key: 'b', label: 'B* (azul ↔ amarillo)', min: -128, max: 127 },
];

function friendlyProfileName(filename) {
    return filename
        .replace(/\.icc$/i, '')
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function rgbToLab(r, g, b) {
    const toLinear = c => {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
    const X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
    const Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
    const Z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    const fx = f(X / 0.95047), fy = f(Y / 1.00000), fz = f(Z / 1.08883);
    return {
        L: Math.round((116 * fy - 16) * 10) / 10,
        a: Math.round((500 * (fx - fy)) * 10) / 10,
        b: Math.round((200 * (fy - fz)) * 10) / 10,
    };
}

function DeltaEBadge({ value }) {
    let cls, label;
    if (value < 1)        { cls = 'bg-emerald-100 text-emerald-700 border-emerald-300'; label = 'Excelente'; }
    else if (value < 2)   { cls = 'bg-green-100 text-green-700 border-green-300';       label = 'Muy buena'; }
    else if (value < 3.5) { cls = 'bg-yellow-100 text-yellow-700 border-yellow-300';    label = 'Aceptable'; }
    else if (value < 5)   { cls = 'bg-orange-100 text-orange-700 border-orange-300';    label = 'Límite'; }
    else                  { cls = 'bg-red-100 text-red-700 border-red-300';             label = 'Fuera de gama'; }
    return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
            ΔE {value} · {label}
        </span>
    );
}

function CMYKBars({ cmyk }) {
    return (
        <div className="grid grid-cols-4 gap-3">
            {['C', 'M', 'Y', 'K'].map(ch => (
                <div key={ch} className="flex flex-col items-center gap-1.5">
                    <span className="text-xs font-bold text-zinc-500">{ch}</span>
                    <div className="relative w-full h-20 bg-zinc-100 rounded-lg overflow-hidden flex flex-col justify-end">
                        <div
                            className="w-full transition-all duration-700"
                            style={{ height: `${cmyk[ch]}%`, backgroundColor: CMYK_META[ch].color, opacity: 0.85 }}
                        />
                    </div>
                    <span className="text-sm font-bold text-zinc-700">{cmyk[ch]}%</span>
                </div>
            ))}
        </div>
    );
}

function ImagePicker({ onPick }) {
    const canvasRef = useRef(null);
    const imgRef = useRef(null);
    const [imgSrc, setImgSrc] = useState(null);
    const [cursor, setCursor] = useState({ x: null, y: null });
    const [pickedRgb, setPickedRgb] = useState(null);

    const loadImage = e => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        setImgSrc(url);
        setPickedRgb(null);
        setCursor({ x: null, y: null });
    };

    useEffect(() => {
        if (!imgSrc || !canvasRef.current) return;
        const img = new Image();
        img.onload = () => {
            imgRef.current = img;
            const canvas = canvasRef.current;
            const maxW = canvas.parentElement.clientWidth;
            const scale = Math.min(1, maxW / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = imgSrc;
    }, [imgSrc]);

    const handleClick = useCallback(e => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = Math.round((e.clientX - rect.left) * scaleX);
        const y = Math.round((e.clientY - rect.top) * scaleY);
        const [r, g, b] = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
        setPickedRgb({ r, g, b });
        setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        onPick(rgbToLab(r, g, b));
    }, [onPick]);

    const clear = () => { setImgSrc(null); setPickedRgb(null); setCursor({ x: null, y: null }); };

    return (
        <div className="space-y-3">
            {!imgSrc ? (
                <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-zinc-200 rounded-xl p-5 cursor-pointer hover:border-brand-cyan/50 hover:bg-brand-cyan/5 transition-colors">
                    <ImagePlus size={22} className="text-zinc-300" />
                    <span className="text-xs text-zinc-400">Subir imagen y hacer click en el color</span>
                    <input type="file" accept="image/*" className="hidden" onChange={loadImage} />
                </label>
            ) : (
                <div className="space-y-2">
                    <div className="relative rounded-xl overflow-hidden border border-zinc-200" style={{ cursor: 'crosshair' }}>
                        <canvas ref={canvasRef} onClick={handleClick} className="w-full block" />
                        {cursor.x !== null && (
                            <div className="absolute pointer-events-none" style={{ left: cursor.x, top: cursor.y, transform: 'translate(-50%,-50%)' }}>
                                <div className="w-5 h-5 rounded-full border-2 border-white shadow-lg"
                                    style={{ backgroundColor: pickedRgb ? `rgb(${pickedRgb.r},${pickedRgb.g},${pickedRgb.b})` : 'transparent' }} />
                            </div>
                        )}
                    </div>
                    <div className="flex items-center justify-between">
                        {pickedRgb ? (
                            <div className="flex items-center gap-2">
                                <div className="w-5 h-5 rounded border border-zinc-200 flex-shrink-0"
                                    style={{ backgroundColor: `rgb(${pickedRgb.r},${pickedRgb.g},${pickedRgb.b})` }} />
                                <span className="text-xs text-zinc-500 font-mono">RGB {pickedRgb.r} {pickedRgb.g} {pickedRgb.b}</span>
                            </div>
                        ) : (
                            <span className="text-xs text-zinc-400">Hacé click en la imagen</span>
                        )}
                        <button onClick={clear} className="text-zinc-400 hover:text-zinc-600 transition-colors"><X size={14} /></button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Componente Listbox de HeadlessUI para selección de perfil ICC
function ProfileListbox({ label, value, onChange, profiles }) {
    const DEFAULT_OPTION = { path: '', name: '— por defecto —' };
    const allOptions = [DEFAULT_OPTION, ...profiles];
    const selected = allOptions.find(p => p.path === value) || DEFAULT_OPTION;

    return (
        <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">{label}</label>
            <Listbox value={value} onChange={onChange}>
                <div className="relative">
                    <Listbox.Button className="relative w-full cursor-pointer border border-zinc-200 rounded-lg bg-white pl-3 pr-8 py-1.5 text-left text-xs focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 hover:border-zinc-300 transition-colors">
                        <span className="block truncate text-zinc-700 font-medium">
                            {selected.path === '' ? (
                                <span className="text-zinc-400 italic">{DEFAULT_OPTION.name}</span>
                            ) : friendlyProfileName(selected.name)}
                        </span>
                        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                            <ChevronDown size={13} className="text-zinc-400" aria-hidden="true" />
                        </span>
                    </Listbox.Button>
                    <Transition
                        as={Fragment}
                        leave="transition ease-in duration-100"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                    >
                        <Listbox.Options className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg bg-white py-1 text-xs shadow-lg ring-1 ring-black/5 focus:outline-none border border-zinc-200">
                            {allOptions.map((p) => (
                                <Listbox.Option
                                    key={p.path}
                                    value={p.path}
                                    className={({ active }) =>
                                        `relative cursor-pointer select-none py-2 pl-8 pr-3 ${active ? 'bg-brand-cyan/10 text-brand-cyan' : 'text-zinc-700'}`
                                    }
                                >
                                    {({ selected: isSelected }) => (
                                        <>
                                            <span className={`block truncate ${isSelected ? 'font-semibold' : 'font-normal'}`}>
                                                {p.path === '' ? <span className="italic text-zinc-400">{p.name}</span> : friendlyProfileName(p.name)}
                                            </span>
                                            {isSelected && (
                                                <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-brand-cyan">
                                                    <Check size={13} aria-hidden="true" />
                                                </span>
                                            )}
                                        </>
                                    )}
                                </Listbox.Option>
                            ))}
                        </Listbox.Options>
                    </Transition>
                </div>
            </Listbox>
        </div>
    );
}

export default function ManualMatchTab() {
    const [lab, setLab] = useState(DEFAULT_LAB);
    const [highlighted, setHighlighted] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(true);      // expandido por defecto
    const [showImagePicker, setShowImagePicker] = useState(true); // expandido por defecto
    const [profiles, setProfiles] = useState([]);
    const [entrada, setEntrada] = useState('');
    const [salida, setSalida] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [isStale, setIsStale] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        api.get('/color/profiles').then(res => {
            if (res.data.success) {
                setProfiles(res.data.profiles);
                const def = res.data.profiles.find(p => p.name.toLowerCase().includes('fedar'));
                const defEntrada = res.data.profiles.find(p => p.name.toLowerCase().includes('swop'));
                if (def) setSalida(def.path);
                if (defEntrada) setEntrada(defEntrada.path);
            }
        }).catch(() => {});
    }, []);

    const updateLab = useCallback((newLab) => {
        setLab(newLab);
        if (result) setIsStale(true);
    }, [result]);

    const handleSliderChange = (key, val) => {
        setLab(prev => ({ ...prev, [key]: parseFloat(val) }));
        if (result) setIsStale(true);
    };

    const handleReset = () => {
        setLab(DEFAULT_LAB);
        setResult(null);
        setIsStale(false);
        setError(null);
    };

    const handleCalc = async () => {
        setLoading(true);
        setError(null);
        setIsStale(false);
        try {
            const body = { L: lab.L, a: lab.a, b: lab.b };
            if (entrada.trim()) body.entrada = entrada.trim();
            if (salida.trim()) body.salida = salida.trim();
            const res = await api.post('/color/match', body);
            if (res.data.success) setResult(res.data.data);
            else setError(res.data.error || 'Error desconocido');
        } catch (e) {
            setError(e.response?.data?.error || e.message || 'Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    const handleImagePick = useCallback(labVal => {
        setLab(labVal);
        if (result) setIsStale(true);
        setHighlighted(true);
        setTimeout(() => setHighlighted(false), 1000);
    }, [result]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
                {/* Panel izquierdo */}
                <div className="lg:col-span-3">
                    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-5 flex flex-col gap-4">

                        {/* Captura desde imagen */}
                        <div>
                            <button
                                type="button"
                                onClick={() => setShowImagePicker(v => !v)}
                                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                            >
                                {showImagePicker ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                <ImagePlus size={13} />
                                Capturar desde imagen
                            </button>
                            {showImagePicker && (
                                <div className="mt-3">
                                    <ImagePicker onPick={handleImagePick} />
                                </div>
                            )}
                        </div>

                        {/* Sliders LAB + Preview lateral */}
                        <div>
                            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">Color objetivo (LAB)</h2>
                            <div className="flex gap-4 items-center">
                                {/* Sliders */}
                                <div className="flex-1">
                                    {LAB_FIELDS.map(({ key, label, min, max }) => (
                                        <div key={key} className={`mb-2 rounded-lg px-1 py-0.5 transition-all duration-300 ${highlighted ? 'bg-brand-cyan/5' : ''}`}>
                                            <label className="block text-xs font-semibold text-zinc-600 mb-0.5">{label}</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="range" min={min} max={max} step={0.1} value={lab[key]}
                                                    onChange={e => handleSliderChange(key, e.target.value)}
                                                    className="flex-1 accent-brand-cyan"
                                                />
                                                <input
                                                    type="number" min={min} max={max} step={0.1} value={lab[key]}
                                                    onChange={e => handleSliderChange(key, e.target.value)}
                                                    className="w-16 border border-zinc-200 rounded-lg px-1.5 py-1 text-xs font-mono text-center focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {/* Preview de color */}
                                <div className="shrink-0 self-stretch">
                                    <div
                                        className={`w-12 h-full rounded-xl border transition-all duration-300 ${highlighted ? 'border-brand-cyan scale-105' : 'border-zinc-200'}`}
                                        style={{ background: `lab(${lab.L}% ${lab.a} ${lab.b})` }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Perfiles ICC */}
                        <div>
                            <button
                                type="button"
                                onClick={() => setShowAdvanced(v => !v)}
                                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                            >
                                {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                Perfiles ICC
                            </button>
                            {showAdvanced && (
                                <div className="space-y-3 mt-3">
                                    <ProfileListbox
                                        label="Perfil de entrada (cliente)"
                                        value={entrada}
                                        onChange={setEntrada}
                                        profiles={profiles}
                                    />
                                    <ProfileListbox
                                        label="Perfil de salida (impresora)"
                                        value={salida}
                                        onChange={setSalida}
                                        profiles={profiles}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Botón sticky */}
                        <div className="pt-2">
                            <button
                                type="button" onClick={handleCalc} disabled={loading}
                                className="w-full bg-brand-cyan text-white font-bold py-2.5 rounded-xl hover:bg-brand-cyan/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-brand-cyan/20"
                            >
                                {loading ? (
                                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Calculando...</>
                                ) : (
                                    <><Pipette size={16} />{isStale ? 'Recalcular' : 'Calcular'}</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Resultados */}
                <div className={`lg:col-span-2 space-y-4 transition-opacity duration-300 ${isStale ? 'opacity-40' : 'opacity-100'}`}>
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
                            <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                            <div>
                                <div className="font-semibold text-red-700 text-sm">Error</div>
                                <div className="text-red-600 text-sm mt-0.5 whitespace-pre-wrap">{error}</div>
                            </div>
                        </div>
                    )}

                    {!result && !error && !loading && (
                        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-10 text-center">
                            <Palette size={40} className="mx-auto text-zinc-200 mb-3" />
                            <p className="text-zinc-400 text-sm">Ingresá los valores LAB o capturá desde imagen, luego presioná Calcular.</p>
                        </div>
                    )}

                    {isStale && result && (
                        <div className="text-center text-xs text-zinc-400 -mb-2">
                            Valores cambiados — presioná Recalcular para actualizar
                        </div>
                    )}

                    {result && (
                        <>
                            <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-5">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <div className="text-xs font-bold text-brand-cyan uppercase tracking-wide">Camino A</div>
                                        <div className="text-sm font-semibold text-zinc-700 mt-0.5">Color spot / nombrado</div>
                                    </div>
                                    {result.caminoA && <DeltaEBadge value={result.caminoA.deltaE} />}
                                </div>
                                {result.caminoA ? (
                                    <>
                                        <CMYKBars cmyk={result.caminoA.cmyk} />
                                        <div className="mt-3 text-xs text-zinc-500 bg-zinc-50 rounded-lg p-3 font-mono">
                                            LAB real: L={result.caminoA.labReal.L} A={result.caminoA.labReal.a} B={result.caminoA.labReal.b}
                                        </div>
                                        <p className="mt-2 text-xs text-zinc-400">Definir estos valores como color spot en el RIP para máxima fidelidad.</p>
                                    </>
                                ) : (
                                    <p className="text-sm text-zinc-500">No se pudo invertir el perfil de salida.</p>
                                )}
                            </div>

                            <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-5">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <div className="text-xs font-bold text-brand-cyan uppercase tracking-wide">Camino B</div>
                                        <div className="text-sm font-semibold text-zinc-700 mt-0.5">CMYK de entrada (perfil cliente)</div>
                                    </div>
                                    {result.caminoB && <DeltaEBadge value={result.caminoB.deltaE} />}
                                </div>
                                {result.caminoB ? (
                                    <>
                                        <CMYKBars cmyk={result.caminoB.cmyk} />
                                        <div className="mt-3 text-xs text-zinc-500 bg-zinc-50 rounded-lg p-3 font-mono">
                                            LAB en perfil entrada: L={result.caminoB.labReal.L} A={result.caminoB.labReal.a} B={result.caminoB.labReal.b}
                                        </div>
                                        <p className="mt-2 text-xs text-zinc-400">El cliente coloca este CMYK en su documento; llega a la impresora vía gestión de color normal.</p>
                                    </>
                                ) : (
                                    <p className="text-sm text-zinc-500">No se pudo invertir el perfil de entrada.</p>
                                )}
                            </div>

                            {result.recomendacion && (
                                <div className="bg-brand-cyan/5 border border-brand-cyan/20 rounded-2xl p-4 flex gap-3">
                                    <Info size={18} className="text-brand-cyan flex-shrink-0 mt-0.5" />
                                    <div>
                                        <div className="font-bold text-zinc-800 text-sm">Recomendación</div>
                                        <div className="text-zinc-600 text-sm mt-0.5">{result.recomendacion}</div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
    );
}
