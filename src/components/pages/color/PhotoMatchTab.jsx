import { useState, useRef, useCallback } from 'react';
import { Camera, ImagePlus, RotateCcw, Pipette, AlertTriangle, CheckCircle2, Info, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../../services/apiClient';
import { CHART_PATCHES, CHART_COLS, CHART_ROWS } from './chartData';

// LAB (D65) → sRGB, para el preview en pantalla (inverso del rgbToLab del tab Manual).
function labToRgb(L, a, b) {
    let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200;
    const f = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
    x = 0.95047 * f(x); y = 1.00000 * f(y); z = 1.08883 * f(z);
    const lin = (X, Y, Z, c0, c1, c2) => X * c0 + Y * c1 + Z * c2;
    let r = lin(x, y, z, 3.2404542, -1.5371385, -0.4985314);
    let g = lin(x, y, z, -0.9692660, 1.8760108, 0.0415560);
    let bb = lin(x, y, z, 0.0556434, -0.2040259, 1.0572252);
    const gam = c => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(1, c)); };
    return { r: Math.round(gam(r) * 255), g: Math.round(gam(g) * 255), b: Math.round(gam(bb) * 255) };
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();

function fitQuality(e) {
    if (e < 2) return { label: 'Excelente', cls: 'text-green-700 bg-green-100 border-green-300' };
    if (e < 3.5) return { label: 'Buena', cls: 'text-green-700 bg-green-100 border-green-300' };
    if (e < 5) return { label: 'Aceptable', cls: 'text-yellow-700 bg-yellow-100 border-yellow-300' };
    return { label: 'Dudosa — repetí la foto', cls: 'text-red-700 bg-red-100 border-red-300' };
}

const CORNER_LABELS = ['arriba-izquierda', 'arriba-derecha', 'abajo-derecha', 'abajo-izquierda'];

const PHOTO_DOS = [
    'Luz pareja y difusa (cerca de una ventana, sin sol directo)',
    'Chart y muestra juntas y planas, en la misma foto',
    'Las 4 esquinas de la chart bien visibles',
    'Chart derecha (título arriba) y llenando el cuadro',
];
const PHOTO_DONTS = [
    'Flash, o reflejos/brillos sobre la chart',
    'Sombras o luz despareja sobre la chart',
    'Fotos muy en ángulo o desde lejos',
];

// Ilustración de referencia: foto correcta (plana, luz pareja, esquinas visibles).
function GoodPhotoSvg() {
    return (
        <svg viewBox="0 0 200 120" className="w-full rounded-lg border border-zinc-200" role="img" aria-label="Ejemplo de foto correcta">
            <rect width="200" height="120" fill="#eef0ee" />
            <rect x="20" y="38" width="20" height="20" rx="2" fill="#735444" stroke="#fff" strokeWidth="1" />
            <rect x="44" y="38" width="20" height="20" rx="2" fill="#c29682" stroke="#fff" strokeWidth="1" />
            <rect x="68" y="38" width="20" height="20" rx="2" fill="#627a9d" stroke="#fff" strokeWidth="1" />
            <rect x="20" y="62" width="20" height="20" rx="2" fill="#d6782c" stroke="#fff" strokeWidth="1" />
            <rect x="44" y="62" width="20" height="20" rx="2" fill="#469449" stroke="#fff" strokeWidth="1" />
            <rect x="68" y="62" width="20" height="20" rx="2" fill="#383d96" stroke="#fff" strokeWidth="1" />
            <rect x="110" y="40" width="64" height="42" rx="4" fill="#2e5e8c" stroke="#fff" strokeWidth="1" />
            <circle cx="181" cy="19" r="11" fill="#22c55e" />
            <path d="M175.5 19 l4 4 l7 -8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// Ilustración de referencia: foto a evitar (reflejo, sombra y ángulo).
function BadPhotoSvg() {
    return (
        <svg viewBox="0 0 200 120" className="w-full rounded-lg border border-zinc-200" role="img" aria-label="Ejemplo de foto a evitar">
            <rect width="200" height="120" fill="#e9eae8" />
            <rect x="128" y="0" width="72" height="120" fill="#000" opacity="0.18" />
            <g transform="rotate(-8 54 60)">
                <rect x="20" y="38" width="20" height="20" rx="2" fill="#735444" stroke="#fff" strokeWidth="1" />
                <rect x="44" y="38" width="20" height="20" rx="2" fill="#c29682" stroke="#fff" strokeWidth="1" />
                <rect x="68" y="38" width="20" height="20" rx="2" fill="#627a9d" stroke="#fff" strokeWidth="1" />
                <rect x="20" y="62" width="20" height="20" rx="2" fill="#d6782c" stroke="#fff" strokeWidth="1" />
                <rect x="44" y="62" width="20" height="20" rx="2" fill="#469449" stroke="#fff" strokeWidth="1" />
                <rect x="68" y="62" width="20" height="20" rx="2" fill="#383d96" stroke="#fff" strokeWidth="1" />
            </g>
            <rect x="108" y="42" width="60" height="40" rx="4" fill="#2e5e8c" stroke="#fff" strokeWidth="1" opacity="0.85" />
            <polygon points="18,6 52,6 30,114 -4,114" fill="#fff" opacity="0.42" />
            <circle cx="181" cy="19" r="11" fill="#ef4444" />
            <path d="M176 14 l10 10 M186 14 l-10 10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
    );
}

export default function PhotoMatchTab() {
    const canvasRef = useRef(null);
    const [imgSrc, setImgSrc] = useState(null);
    const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
    const [corners, setCorners] = useState([]);          // {x,y} en px de canvas (orden TL,TR,BR,BL)
    const [gridDots, setGridDots] = useState([]);        // 24 posiciones muestreadas
    const [capturedRgb, setCapturedRgb] = useState([]);  // [{patchId, rgb}]
    const [sample, setSample] = useState(null);          // {x,y}
    const [sampleRgb, setSampleRgb] = useState(null);    // [r,g,b]
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [showGuide, setShowGuide] = useState(false);

    const loadImage = e => {
        const file = e.target.files[0];
        if (!file) return;
        resetMarks();
        setImgSrc(URL.createObjectURL(file));
    };

    const onImgLoad = e => {
        const img = e.target;
        const canvas = canvasRef.current;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        setCanvasSize({ w: img.naturalWidth, h: img.naturalHeight });
    };

    const resetMarks = () => {
        setCorners([]); setGridDots([]); setCapturedRgb([]);
        setSample(null); setSampleRgb(null); setResult(null); setError(null);
    };

    const sampleRegion = useCallback((x, y, size = 9) => {
        const ctx = canvasRef.current.getContext('2d');
        const half = Math.floor(size / 2);
        const sx = Math.max(0, Math.round(x) - half);
        const sy = Math.max(0, Math.round(y) - half);
        const d = ctx.getImageData(sx, sy, size, size).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    }, []);

    const sampleGrid = useCallback((c4) => {
        const [TL, TR, BR, BL] = c4;
        const captured = [], dots = [];
        CHART_PATCHES.forEach((p, i) => {
            const col = i % CHART_COLS, row = Math.floor(i / CHART_COLS);
            const u = (col + 0.5) / CHART_COLS, v = (row + 0.5) / CHART_ROWS;
            const topX = TL.x * (1 - u) + TR.x * u, topY = TL.y * (1 - u) + TR.y * u;
            const botX = BL.x * (1 - u) + BR.x * u, botY = BL.y * (1 - u) + BR.y * u;
            const px = topX * (1 - v) + botX * v, py = topY * (1 - v) + botY * v;
            captured.push({ patchId: p.id, rgb: sampleRegion(px, py) });
            dots.push({ x: px, y: py });
        });
        setCapturedRgb(captured);
        setGridDots(dots);
    }, [sampleRegion]);

    const handleClick = e => {
        const canvas = canvasRef.current;
        if (!canvas || !canvasSize.w) return;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);

        if (corners.length < 4) {
            const next = [...corners, { x, y }];
            setCorners(next);
            if (next.length === 4) sampleGrid(next);
        } else {
            setSample({ x, y });
            setSampleRgb(sampleRegion(x, y));
            setResult(null);
        }
    };

    const handleCalibrate = async () => {
        setError(null); setResult(null);
        if (capturedRgb.length === 0 || !sampleRgb) { setError('Marcá las 4 esquinas y la muestra primero.'); return; }
        setLoading(true);
        try {
            const cal = await api.post('/color/calibrate', { capturedRgb, sampleRgb });
            if (!cal.data.success) { setError(cal.data.error || 'Error de calibración.'); return; }
            const { lab, fitError, model, tirada } = cal.data.data;
            const rgb = labToRgb(lab.L, lab.a, lab.b);
            const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
            let cmyk = null;
            try {
                const m = await api.post('/color/match', { L: lab.L, a: lab.a, b: lab.b });
                if (m.data.success) cmyk = m.data.data.caminoA?.cmyk || null;
            } catch { /* CMYK opcional */ }
            setResult({ lab, fitError, model, tirada, hex, cmyk });
        } catch (e) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setLoading(false);
        }
    };

    const pct = (v, total) => `${(v / total) * 100}%`;
    const stepMsg = corners.length < 4
        ? `Marcá la esquina ${CORNER_LABELS[corners.length]} de la chart (${corners.length}/4)`
        : !sampleRgb
            ? 'Ahora hacé click en tu muestra (el color a medir)'
            : 'Listo para calibrar';

    return (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
            {/* Foto + marcado */}
            <div className="lg:col-span-3 space-y-3">
                {/* Guía: cómo sacar la foto — panel entero clickeable, colapsado por defecto */}
                <div
                    onClick={() => setShowGuide(v => !v)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={showGuide}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowGuide(v => !v); } }}
                    className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-5 cursor-pointer select-none hover:border-zinc-300 transition-colors"
                >
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                            <Info size={16} className="text-brand-cyan" /> Cómo sacar la foto
                        </span>
                        {showGuide ? <ChevronUp size={16} className="text-zinc-400" /> : <ChevronDown size={16} className="text-zinc-400" />}
                    </div>
                    {showGuide && (
                        <div className="grid sm:grid-cols-2 gap-5 mt-4">
                            <div>
                                <div className="text-[11px] font-bold text-green-700 uppercase tracking-wide mb-2">Hacé</div>
                                <GoodPhotoSvg />
                                <ul className="space-y-1.5 mt-3">
                                    {PHOTO_DOS.map((t, i) => (
                                        <li key={i} className="flex gap-2 text-xs text-zinc-600">
                                            <Check size={14} className="text-green-500 flex-shrink-0 mt-0.5" /> <span>{t}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div>
                                <div className="text-[11px] font-bold text-red-700 uppercase tracking-wide mb-2">Evitá</div>
                                <BadPhotoSvg />
                                <ul className="space-y-1.5 mt-3">
                                    {PHOTO_DONTS.map((t, i) => (
                                        <li key={i} className="flex gap-2 text-xs text-zinc-600">
                                            <X size={14} className="text-red-500 flex-shrink-0 mt-0.5" /> <span>{t}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-5">
                    {!imgSrc ? (
                        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-zinc-200 rounded-xl p-10 cursor-pointer hover:border-brand-cyan/50 hover:bg-brand-cyan/5 transition-colors">
                            <ImagePlus size={26} className="text-zinc-300" />
                            <span className="text-sm text-zinc-500 font-semibold">Subir foto (chart + muestra)</span>
                            <span className="text-xs text-zinc-400 text-center">Luz pareja, sin reflejos, las 4 esquinas visibles</span>
                            <input type="file" accept="image/*" className="hidden" onChange={loadImage} />
                        </label>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-brand-cyan bg-brand-cyan/5 rounded-lg px-3 py-2">
                                <Pipette size={15} /> {stepMsg}
                            </div>
                            <div className="relative rounded-xl overflow-hidden border border-zinc-200" style={{ cursor: 'crosshair' }}>
                                {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                                <img src={imgSrc} onLoad={onImgLoad} alt="foto" className="hidden" />
                                <canvas ref={canvasRef} onClick={handleClick} className="w-full block" />

                                {/* Grilla de los 24 muestreados */}
                                {gridDots.map((d, i) => (
                                    <div key={i} className="absolute w-1.5 h-1.5 rounded-full bg-white/80 ring-1 ring-black/40 pointer-events-none"
                                        style={{ left: pct(d.x, canvasSize.w), top: pct(d.y, canvasSize.h), transform: 'translate(-50%,-50%)' }} />
                                ))}
                                {/* Esquinas */}
                                {corners.map((c, i) => (
                                    <div key={i} className="absolute w-5 h-5 rounded-full bg-brand-cyan text-white text-[10px] font-bold flex items-center justify-center border-2 border-white shadow pointer-events-none"
                                        style={{ left: pct(c.x, canvasSize.w), top: pct(c.y, canvasSize.h), transform: 'translate(-50%,-50%)' }}>
                                        {i + 1}
                                    </div>
                                ))}
                                {/* Muestra */}
                                {sample && (
                                    <div className="absolute w-6 h-6 rounded-full border-[3px] border-pink-500 pointer-events-none"
                                        style={{ left: pct(sample.x, canvasSize.w), top: pct(sample.y, canvasSize.h), transform: 'translate(-50%,-50%)' }} />
                                )}
                            </div>

                            <div className="flex items-center justify-between">
                                <button onClick={resetMarks} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700">
                                    <RotateCcw size={13} /> Reiniciar marcas
                                </button>
                                <label className="text-xs text-brand-cyan hover:underline cursor-pointer font-semibold">
                                    Cambiar foto
                                    <input type="file" accept="image/*" className="hidden" onChange={loadImage} />
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                {imgSrc && (
                    <button
                        onClick={handleCalibrate}
                        disabled={loading || !sampleRgb}
                        className="w-full bg-brand-cyan text-white font-bold py-2.5 rounded-xl hover:bg-brand-cyan/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-brand-cyan/20"
                    >
                        {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Calibrando...</> : <><Camera size={16} /> Calibrar color</>}
                    </button>
                )}
            </div>

            {/* Resultados */}
            <div className="lg:col-span-2 space-y-4">
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
                        <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                        <div className="text-red-600 text-sm whitespace-pre-wrap">{error}</div>
                    </div>
                )}

                {!result && !error && (
                    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8 text-center">
                        <Info size={32} className="mx-auto text-zinc-200 mb-3" />
                        <p className="text-zinc-400 text-sm">Subí una foto, marcá las 4 esquinas de la chart y tu muestra, y presioná Calibrar.</p>
                    </div>
                )}

                {result && (
                    <>
                        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-5">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-14 h-14 rounded-xl border border-zinc-200 flex-shrink-0" style={{ backgroundColor: result.hex }} />
                                <div>
                                    <div className="text-lg font-bold text-zinc-800 font-mono">{result.hex}</div>
                                    <div className="text-xs text-zinc-500">Color calibrado · tirada {result.tirada}</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 mb-3">
                                {[['L*', result.lab.L], ['a*', result.lab.a], ['b*', result.lab.b]].map(([k, v]) => (
                                    <div key={k} className="bg-zinc-50 rounded-lg p-2 text-center">
                                        <div className="text-[11px] text-zinc-400 font-semibold">{k}</div>
                                        <div className="text-sm font-bold text-zinc-700 font-mono">{v}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">Calidad del ajuste (ΔE {result.fitError})</span>
                                <span className={`px-2 py-0.5 rounded-full font-semibold border ${fitQuality(result.fitError).cls}`}>
                                    {fitQuality(result.fitError).label}
                                </span>
                            </div>
                        </div>

                        {result.cmyk && (
                            <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-5">
                                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">CMYK (perfil de salida)</h3>
                                <div className="grid grid-cols-4 gap-2">
                                    {['C', 'M', 'Y', 'K'].map(ch => (
                                        <div key={ch} className="bg-zinc-50 rounded-lg p-2 text-center">
                                            <div className="text-[11px] text-zinc-400 font-semibold">{ch}</div>
                                            <div className="text-sm font-bold text-zinc-700 font-mono">{result.cmyk[ch]}%</div>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-xs text-zinc-400 mt-2">Para el detalle de gama (ΔE, Camino A/B), usá el color en la tab Manual.</p>
                            </div>
                        )}

                        {result.fitError >= 5 && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 flex gap-3">
                                <AlertTriangle size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                                <div className="text-yellow-700 text-xs">El ajuste dio alto: probablemente la foto tiene reflejos o luz despareja. Sacá otra con luz difusa y la chart bien plana.</div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
