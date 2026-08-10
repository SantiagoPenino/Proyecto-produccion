import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    X, Trash2, Check, Wand2, ChevronUp, ChevronDown, Clock, Layers3,
    Mountain, ZoomIn, ZoomOut, Maximize2, Ruler, Scissors, Eraser, Spline, PaintBucket, Undo2,
} from 'lucide-react';
import {
    CARTA_HILOS, TIPOS_PUNTADA, puntadaPorId,
    detectarColores, hiloMasCercano, hexARgb,
    estimarPuntadas, estimarMinutos, PUNTADA_RELIEVE,
    quitarFondo, vectorizarPiezas, borrarPincel, pintarRegion,
} from '../utils/bordadoHilos';

/**
 * [BORDADO] Editor de prediseño — OPCIONAL.
 *
 * Imita cómo trabaja un sistema de digitalización (Wilcom y similares), a escala
 * de maqueta:
 *
 *   1. Reduce el arte a unos pocos COLORES DOMINANTES (lo que ahí se llama
 *      reducción de colores) y le asigna a cada uno un hilo de la carta.
 *   2. Cada color es una PARADA de máquina, numerada y reordenable: ese orden
 *      es el que sigue el operario.
 *   3. A cada pieza se le elige la PUNTADA — pespunte, satén o relleno son las
 *      tres reales, todo lo demás son variantes — y de ahí sale una estimación
 *      de puntadas por ÁREA × DENSIDAD, que es como se calcula de verdad.
 *   4. La "simulación de bordado" repinta el arte con los hilos elegidos y una
 *      textura por tipo de puntada, para que se vea a qué se parece.
 *
 * TODO ESTO ES INFORMATIVO. La matriz real la hace igual un diseñador: lo que
 * sale de acá es una referencia de intención (qué hilos, qué puntadas, dónde) y
 * una estimación de tamaño del trabajo, no un ponchado.
 *
 * Solo abre imágenes (PNG/JPG): un ponchado en PDF/AI/EPS/DST no se edita acá.
 */

const MAX_LADO = 420;

// Fondo a cuadros (como Photoshop) para distinguir lo transparente del hilo
// blanco cuando se quitó el fondo. Mismo criterio que usa DTF en FileUploadZone.
const DAMERO = {
    backgroundColor: '#52525b',
    backgroundImage:
        'linear-gradient(45deg, #71717a 25%, transparent 25%), linear-gradient(-45deg, #71717a 25%, transparent 25%), ' +
        'linear-gradient(45deg, transparent 75%, #71717a 75%), linear-gradient(-45deg, transparent 75%, #71717a 75%)',
    backgroundSize: '14px 14px',
    backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0px',
};

export default function PredisenoBordadoModal({
    file, paletaInicial = [], anchoCm = 0, altoCm = 0, cantidad = 0, onGuardar, onCerrar,
}) {
    const canvasRef = useRef(null);
    const originalRef = useRef(null);
    // Lienzo de trabajo, fuera de pantalla: es la imagen sobre la que se calcula
    // todo. Arranca igual al original y cambia cuando se quita el fondo. El
    // original se guarda intacto para poder deshacer.
    const baseRef = useRef(null);
    const [paleta, setPaleta] = useState(paletaInicial);
    const [vista, setVista] = useState('BORDADO');  // BORDADO | ORIGINAL
    // Herramienta activa sobre el lienzo: null | CUENTAGOTAS | GOMA | BALDE
    const [herramienta, setHerramienta] = useState(null);
    const [hiloPintar, setHiloPintar] = useState(CARTA_HILOS[0].codigo);
    const [radioGoma, setRadioGoma] = useState(8);
    const pintandoRef = useRef(false);   // goma: arrastre con el botón apretado
    const [listo, setListo] = useState(false);
    const [error, setError] = useState('');
    const [sinFondo, setSinFondo] = useState(false);
    const [verContornos, setVerContornos] = useState(false);
    const [aviso, setAviso] = useState('');

    // ── Deshacer ──────────────────────────────────────────────────────────
    // Cada acción que toca el dibujo guarda antes una foto del lienzo de trabajo
    // y de la secuencia de hilos. Se guardan las dos cosas juntas porque van de
    // la mano: pintar cambia los píxeles Y agrega un hilo a la lista, así que
    // deshacer tiene que revertir las dos o queda incoherente.
    //
    // OJO: este bloque va DESPUÉS de todos los useState. Las dependencias de un
    // useCallback se evalúan en el render, así que si `sinFondo` todavía no está
    // declarado, el componente revienta antes de dibujar nada.
    const historialRef = useRef([]);
    const [pasosAtras, setPasosAtras] = useState(0);
    const MAX_HISTORIAL = 12;

    const guardarEstado = useCallback(() => {
        const base = baseRef.current;
        if (!base) return;
        const ctx = base.getContext('2d', { willReadFrequently: true });
        historialRef.current.push({
            imagen: ctx.getImageData(0, 0, base.width, base.height),
            paleta,
            sinFondo,
        });
        if (historialRef.current.length > MAX_HISTORIAL) historialRef.current.shift();
        setPasosAtras(historialRef.current.length);
    }, [paleta, sinFondo]);

    const deshacer = useCallback(() => {
        const previo = historialRef.current.pop();
        setPasosAtras(historialRef.current.length);
        if (!previo) return;
        const base = baseRef.current;
        if (base) {
            base.getContext('2d', { willReadFrequently: true }).putImageData(previo.imagen, 0, 0);
        }
        setPaleta(previo.paleta);
        setSinFondo(previo.sinFondo);
        setAviso('');
    }, []);

    // Ctrl+Z, como en cualquier editor.
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); deshacer(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [deshacer]);
    // AJUSTAR = ocupa el espacio disponible · REAL = del tamaño que va a quedar
    // bordado sobre la prenda, según el ancho y largo cargados en el diseño.
    const [modoTamano, setModoTamano] = useState('AJUSTAR');
    const [zoom, setZoom] = useState(1);

    // ── Carga de la imagen ────────────────────────────────────────────────
    // `cancelado` es imprescindible: en desarrollo React monta el efecto dos
    // veces, y sin esto la limpieza del primer montaje revoca la URL mientras la
    // imagen sigue cargando → dispara onerror y el modal decía "no se pudo abrir"
    // con un archivo perfecto. Por eso la URL se libera al terminar, no al limpiar.
    useEffect(() => {
        if (!file) return;
        if (!/^image\//.test(file.type || '')) {
            setError('Solo se pueden diseñar imágenes (PNG o JPG). Un ponchado en PDF, AI o DST no se puede abrir acá.');
            return;
        }
        let cancelado = false;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            if (cancelado) return;
            const c = canvasRef.current;
            if (!c) return;
            const ratio = img.naturalWidth / img.naturalHeight;
            const w = ratio >= 1 ? Math.min(MAX_LADO, img.naturalWidth) : Math.round(Math.min(MAX_LADO, img.naturalHeight) * ratio);
            const h = ratio >= 1 ? Math.round(w / ratio) : Math.min(MAX_LADO, img.naturalHeight);
            c.width = w; c.height = h;
            originalRef.current = img;

            // Lienzo de trabajo con la imagen ya escalada.
            const base = document.createElement('canvas');
            base.width = w; base.height = h;
            base.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
            baseRef.current = base;

            setListo(true);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            if (!cancelado) setError('No se pudo abrir la imagen.');
        };
        img.src = url;
        return () => { cancelado = true; };
    }, [file]);

    // ── Quitar el fondo ───────────────────────────────────────────────────
    // Trabaja sobre el lienzo de trabajo, así el original queda entero y se
    // puede volver atrás.
    const borrarFondo = () => {
        const base = baseRef.current;
        if (!base) return;
        guardarEstado();
        const ctx = base.getContext('2d', { willReadFrequently: true });
        const borrados = quitarFondo(ctx, base.width, base.height);
        const proporcion = borrados / (base.width * base.height);

        if (borrados === 0) {
            setAviso('No se encontró un fondo parejo para quitar. Si el arte tiene fondo con degradé o textura, hay que recortarlo antes de subirlo.');
            return;
        }
        if (proporcion > 0.92) {
            // Se comió casi todo: el arte no tenía fondo plano, era todo del
            // mismo tono. Se deshace en vez de dejar el lienzo vacío.
            ctx.clearRect(0, 0, base.width, base.height);
            ctx.drawImage(originalRef.current, 0, 0, base.width, base.height);
            setAviso('Con este arte no se puede: al quitar el fondo se borraba casi todo el dibujo. Quedó como estaba.');
            return;
        }
        setAviso('');
        setSinFondo(true);
        detectar(false);
    };

    const restaurarFondo = () => {
        const base = baseRef.current, img = originalRef.current;
        if (!base || !img) return;
        guardarEstado();
        const ctx = base.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, base.width, base.height);
        ctx.drawImage(img, 0, 0, base.width, base.height);
        setSinFondo(false);
        setAviso('');
        detectar(false);
    };

    // ── Detección de hilos + vectorizado ──────────────────────────────────
    // Dos pasos, como un programa de digitalizar: primero reduce el arte a unos
    // pocos colores, después convierte cada color en una PIEZA con su contorno.
    // El área sale de la geometría de esas piezas y no de contar píxeles, que
    // con los bordes difusos del antialiasing siempre queda inflado.
    const detectar = useCallback((silencioso = false) => {
        const base = baseRef.current;
        if (!base) return;
        if (silencioso && paleta.length) return;
        const ctx = base.getContext('2d', { willReadFrequently: true });

        const encontrados = detectarColores(ctx, base.width, base.height, 6);
        if (!encontrados.length) return;

        const vector = vectorizarPiezas(ctx, base.width, base.height, encontrados.map(e => e.hex));

        setPaleta(previa => encontrados.map((e, i) => {
            const pieza = vector[i];
            const cobertura = pieza ? pieza.cobertura : e.cobertura;

            // Al volver a detectar (después de pintar, borrar o quitar el fondo)
            // se conserva lo que el cliente ya había elegido para ese color: hilo,
            // puntada y relieve. Si no, cada retoque le borraba las decisiones.
            const anterior = previa.find(p =>
                Math.abs(parseInt(p.colorOriginal.slice(1, 3), 16) - parseInt(e.hex.slice(1, 3), 16)) < 24 &&
                Math.abs(parseInt(p.colorOriginal.slice(3, 5), 16) - parseInt(e.hex.slice(3, 5), 16)) < 24 &&
                Math.abs(parseInt(p.colorOriginal.slice(5, 7), 16) - parseInt(e.hex.slice(5, 7), 16)) < 24
            );

            return {
                id: `p${i}_${e.hex.slice(1)}`,
                colorOriginal: e.hex,
                hilo: anterior ? anterior.hilo : hiloMasCercano(e.hex).codigo,
                cobertura,
                anillos: pieza ? pieza.anillos : [],
                // El color que más superficie ocupa suele ser relleno; los que
                // aparecen poco suelen ser contornos y letras (satén).
                puntada: anterior ? anterior.puntada : (cobertura > 0.35 ? 'TATAMI' : 'SATEN'),
                relieve: anterior ? !!anterior.relieve : false,
            };
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paleta.length]);

    // Al abrir por primera vez se detecta solo: el cliente ve algo con sentido
    // sin tener que entender nada.
    useEffect(() => {
        if (listo && paleta.length === 0) detectar(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listo]);

    // ── Repintado: cada píxel se lleva al hilo de su pieza + textura ───────
    const repintar = useCallback(() => {
        const c = canvasRef.current, base = baseRef.current;
        if (!c || !base) return;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(base, 0, 0);

        if (vista === 'ORIGINAL' || paleta.length === 0) return;

        const piezas = paleta.map(p => ({
            orig: hexARgb(p.colorOriginal),
            dest: hexARgb((CARTA_HILOS.find(h => h.codigo === p.hilo) || {}).hex || p.colorOriginal),
            // El relieve solo existe en satén: la puntada de arriba corta la goma.
            puntada: p.relieve ? PUNTADA_RELIEVE : p.puntada,
            relieve: !!p.relieve,
        }));

        const imgData = ctx.getImageData(0, 0, c.width, c.height);
        const d = imgData.data;
        const w = c.width, h = c.height;
        const total = w * h;

        // Paso 1 — a qué pieza pertenece cada píxel. Se calcula aparte porque el
        // relieve necesita mirar a los vecinos para sombrear los bordes.
        const idx = new Int8Array(total).fill(-1);
        for (let n = 0; n < total; n++) {
            const i = n * 4;
            if (d[i + 3] < 128) continue;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            let mejor = -1, mejorD = Infinity;
            for (let k = 0; k < piezas.length; k++) {
                const p = piezas[k];
                const dd = (r - p.orig.r) ** 2 + (g - p.orig.g) ** 2 + (b - p.orig.b) ** 2;
                if (dd < mejorD) { mejorD = dd; mejor = k; }
            }
            idx[n] = mejor;
        }

        // Paso 2 — color del hilo + textura de la puntada.
        for (let n = 0; n < total; n++) {
            const pi = idx[n];
            if (pi < 0) continue;
            const p = piezas[pi];
            const i = n * 4;
            const px = n % w, py = (n / w) | 0;

            let nr = p.dest.r, ng = p.dest.g, nb = p.dest.b;

            // La textura es lo que hace que se lea como bordado y no como dibujo
            // plano. Se modula el brillo; el color del hilo no cambia.
            let k = 0;
            switch (p.puntada) {
                case 'SATEN':    k = ((px + py) % 6 < 2) ? 26 : -10; break;   // brillo diagonal
                case 'TATAMI':   k = (py % 3 === 0) ? -22 : ((px % 4 === 0) ? -10 : 6); break; // trama
                case 'PESPUNTE': k = (px % 5 === 0 && py % 5 === 0) ? -55 : 10; break;  // línea punteada
                case 'ZIGZAG':   k = (Math.abs((px % 8) - 4) + py) % 6 < 2 ? 22 : -14; break;
                case 'TAFETA':   k = (px % 5 === 0 || py % 5 === 0) ? -18 : 4; break;   // trama de tela
                default:         k = 0;
            }

            // [RELIEVE] Volumen: la pieza se ilumina del lado de la luz y se
            // ensombrece del opuesto, mirando si el vecino es otra pieza o vacío.
            // Con dos píxeles de borde alcanza para que se lea levantada.
            if (p.relieve) {
                const arriba = (px > 1 && py > 1) ? idx[n - w - 1] : -1;
                const abajo  = (px < w - 2 && py < h - 2) ? idx[n + w + 1] : -1;
                if (arriba !== pi) k += 55;        // canto iluminado
                else if (abajo !== pi) k -= 60;    // sombra proyectada
                else k += 12;                      // la cara de arriba, más clara
            }

            nr += k; ng += k; nb += k;
            d[i]     = nr < 0 ? 0 : nr > 255 ? 255 : nr;
            d[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
            d[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
        }
        ctx.putImageData(imgData, 0, 0);

        // Contornos de las piezas vectorizadas, como los muestra un programa de
        // digitalizar. Van encima de la simulación, no la reemplazan.
        if (verContornos) {
            ctx.save();
            ctx.lineJoin = 'round';
            // Un solo trazo fino y translúcido. El doble trazo grueso de antes
            // (oscuro + blanco) tapaba el dibujo y, con un logo detallado, se
            // veía como si el arte tuviera un borde blanco sucio.
            ctx.strokeStyle = 'rgba(255,255,255,.55)';
            ctx.lineWidth = 0.8;
            for (const p of paleta) {
                for (const anillo of (p.anillos || [])) {
                    ctx.beginPath();
                    anillo.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                    ctx.closePath();
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
    }, [paleta, vista, verContornos]);

    useEffect(() => { if (listo) repintar(); }, [listo, repintar]);

    // ── Acciones sobre la secuencia ───────────────────────────────────────
    const actualizar = (id, cambios) => setPaleta(p => p.map(x => (x.id === id ? { ...x, ...cambios } : x)));
    const quitar = (id) => setPaleta(p => p.filter(x => x.id !== id));
    const mover = (i, delta) => setPaleta(p => {
        const j = i + delta;
        if (j < 0 || j >= p.length) return p;
        const copia = [...p];
        [copia[i], copia[j]] = [copia[j], copia[i]];
        return copia;
    });

    // Coordenadas del click en píxeles del lienzo (no de pantalla: puede estar
    // con zoom o a tamaño real).
    const puntoDelLienzo = (e) => {
        const c = canvasRef.current;
        if (!c) return null;
        const rect = c.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) * (c.width / rect.width));
        const y = Math.floor((e.clientY - rect.top) * (c.height / rect.height));
        if (x < 0 || y < 0 || x >= c.width || y >= c.height) return null;
        return { x, y };
    };

    const ctxBase = () => baseRef.current?.getContext('2d', { willReadFrequently: true });

    const usarHerramienta = (e, arrastrando = false) => {
        if (!herramienta) return;
        const pt = puntoDelLienzo(e);
        const base = baseRef.current, ctx = ctxBase();
        if (!pt || !base || !ctx) return;

        if (herramienta === 'GOMA') {
            // Una sola foto por trazo (al apretar), no por cada movimiento: si no,
            // deshacer iría píxel por píxel y haría falta apretarlo cien veces.
            if (!arrastrando) guardarEstado();
            borrarPincel(ctx, base.width, base.height, pt.x, pt.y, radioGoma);
            repintar();                       // en vivo mientras arrastra
            return;
        }
        if (arrastrando) return;              // el balde es de un solo click

        if (herramienta === 'BALDE') {
            const destino = CARTA_HILOS.find(h => h.codigo === hiloPintar);
            guardarEstado();
            const pintados = pintarRegion(ctx, base.width, base.height, pt.x, pt.y, destino.hex);
            if (!pintados) {
                historialRef.current.pop();   // no cambió nada: no ensuciar el deshacer
                setPasosAtras(historialRef.current.length);
                setAviso('Ahí no hay nada para pintar: tocá adentro de un área del dibujo.');
                return;
            }
            setAviso('');
            detectar(false);                  // el color nuevo pasa a ser su propia pieza
        }
    };

    // La goma pinta mientras se arrastra; al soltar se recalculan las piezas una
    // sola vez (hacerlo en cada movimiento trabaría el lienzo).
    const soltar = () => {
        if (pintandoRef.current && herramienta === 'GOMA') detectar(false);
        pintandoRef.current = false;
    };

    // ── Totales ───────────────────────────────────────────────────────────
    const conPuntadas = paleta.map(p => ({
        ...p,
        puntadas: estimarPuntadas({
            anchoCm, altoCm, cobertura: p.cobertura, tipoPuntada: p.puntada, relieve: p.relieve,
        }),
    }));
    const totalPuntadas = conPuntadas.reduce((s, p) => s + p.puntadas, 0);
    const minutos = estimarMinutos(totalPuntadas, paleta.length);
    const hayMedidas = parseFloat(anchoCm) > 0 && parseFloat(altoCm) > 0;
    const piezasRelieve = conPuntadas.filter(p => p.relieve).length;
    const piezasTafeta = conPuntadas.filter(p => !p.relieve && p.puntada === 'TAFETA').length;

    // Ancho de dibujo del lienzo en píxeles de pantalla.
    //   AJUSTAR → lo maneja el CSS (null), solo se aplica el zoom sobre el tamaño natural.
    //   REAL    → los centímetros del bordado llevados a píxeles. 96 dpi es el
    //             estándar de CSS: 1 cm ≈ 37,8 px. Es aproximado y se avisa.
    const PX_POR_CM = 37.8;
    const anchoPx = modoTamano === 'REAL' && hayMedidas
        ? parseFloat(anchoCm) * PX_POR_CM * zoom
        : (zoom !== 1 && canvasRef.current ? canvasRef.current.width * zoom : null);

    // Marcar TODO en relieve (o sacarlo) de una: para el caso "todo el logo
    // levantado", sin tener que ir pieza por pieza.
    const relieveTodo = (valor) => setPaleta(p => p.map(x => ({
        ...x, relieve: valor, ...(valor ? { puntada: PUNTADA_RELIEVE } : {}),
    })));

    const guardar = () => {
        const c = canvasRef.current;
        const datos = {
            paleta: conPuntadas,
            puntadasEstimadas: hayMedidas ? totalPuntadas : null,
            // El cargo de relieve del pedido sale de acá: si alguna pieza va en
            // relieve, el diseño lo lleva. Así el tilde de la tarjeta deja de ser
            // una declaración suelta y pasa a reflejar lo que realmente se diseñó.
            relieve3D: piezasRelieve > 0,
        };
        if (!c) { onGuardar({ ...datos, arteDisenado: null }); return; }
        const base = (file?.name || 'logo').replace(/\.[^.]+$/, '');
        // Se guarda la SIMULACIÓN, no el original: es lo que el cliente aprobó ver.
        const guardarBlob = () => c.toBlob((blob) => {
            onGuardar({
                ...datos,
                arteDisenado: blob ? new File([blob], `${base} - diseñado.png`, { type: 'image/png' }) : null,
            });
        }, 'image/png');
        if (vista === 'ORIGINAL') {
            // Si está viendo el original, repintar antes para no guardar el arte crudo.
            setVista('BORDADO');
            setTimeout(guardarBlob, 60);
        } else guardarBlob();
    };

    const hiloDe = (cod) => CARTA_HILOS.find(h => h.codigo === cod) || CARTA_HILOS[0];

    // Los de la carta que todavía no están en la secuencia: son los únicos que
    // tiene sentido ofrecer para agregar.
    const hilosSinUsar = CARTA_HILOS.filter(h => !paleta.some(p => p.hilo === h.codigo));

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-3">
            <div className="w-full max-w-5xl max-h-[94vh] overflow-hidden bg-zinc-900 border border-zinc-700 rounded-3xl flex flex-col">

                {/* Encabezado */}
                <div className="flex items-start justify-between gap-4 p-5 border-b border-zinc-800">
                    <div>
                        <h3 className="text-sm font-black text-zinc-100 uppercase tracking-widest">Diseñar el bordado</h3>
                        <p className="text-[10px] text-zinc-500 mt-1 max-w-xl leading-relaxed">
                            Elegí los hilos y con qué puntada va bordada cada parte. Es una referencia para el taller:
                            la matriz definitiva la hace igual un diseñador.
                        </p>
                    </div>
                    <button type="button" onClick={onCerrar} className="text-zinc-500 hover:text-zinc-200 transition-colors shrink-0">
                        <X size={20} />
                    </button>
                </div>

                {error ? (
                    <div className="p-5">
                        <p className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] font-bold text-amber-400">
                            {error}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">

                            {/* ── Lienzo ── */}
                            <div className="p-5 border-b lg:border-b-0 lg:border-r border-zinc-800">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="flex rounded-lg overflow-hidden border border-zinc-700">
                                        {[['BORDADO', 'Simulación'], ['ORIGINAL', 'Arte original']].map(([v, txt]) => (
                                            <button
                                                key={v} type="button" onClick={() => setVista(v)}
                                                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wide transition-colors ${
                                                    vista === v ? 'bg-brand-gold text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                                }`}
                                            >{txt}</button>
                                        ))}
                                    </div>
                                    {/* Agregar un hilo NUEVO de la carta: solo aparecen los que
                                        todavía no están en la secuencia. Al elegirlo queda cargado
                                        en el balde, que es lo único que se puede hacer con un hilo
                                        que todavía no está en ninguna parte del dibujo: pintarlo. */}
                                    <select
                                        value=""
                                        onChange={(e) => {
                                            const cod = e.target.value;
                                            if (!cod) return;
                                            const hilo = CARTA_HILOS.find(h => h.codigo === cod);
                                            setPaleta(p => [...p, {
                                                id: `p${Date.now()}${p.length}`,
                                                colorOriginal: hilo.hex,
                                                hilo: hilo.codigo,
                                                cobertura: 0,
                                                anillos: [],
                                                puntada: 'SATEN',
                                                relieve: false,
                                            }]);
                                            setHiloPintar(cod);
                                            setHerramienta('BALDE');
                                            setAviso('');
                                        }}
                                        className="h-[30px] px-2 bg-zinc-800 border border-zinc-700 rounded-lg text-[10px] font-black text-zinc-400 uppercase tracking-wide outline-none hover:text-zinc-200 focus:border-brand-gold cursor-pointer"
                                        title="Suma un hilo de la carta que todavía no estés usando y lo deja listo para pintar con él"
                                    >
                                        <option value="">+ Agregar hilo</option>
                                        {hilosSinUsar.map(h => (
                                            <option key={h.codigo} value={h.codigo}>{h.nombre}</option>
                                        ))}
                                    </select>

                                    {[
                                        { id: 'BALDE', icono: <PaintBucket size={12} />, txt: 'Pintar',
                                          ayuda: 'Pinta el área cerrada que toques con el hilo elegido. Frena contra el contorno, así podés pintar una sola raya' },
                                        { id: 'GOMA', icono: <Eraser size={12} />, txt: 'Goma',
                                          ayuda: 'Borra lo que sobró del fondo. Mantené apretado y arrastrá' },
                                    ].map(h => (
                                        <button
                                            key={h.id} type="button"
                                            onClick={() => { setHerramienta(v => (v === h.id ? null : h.id)); setAviso(''); }}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-wide transition-colors ${
                                                herramienta === h.id
                                                    ? 'bg-brand-gold/15 border-brand-gold text-brand-gold'
                                                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                            }`}
                                            title={h.ayuda}
                                        >
                                            {h.icono} {h.txt}
                                        </button>
                                    ))}

                                    <button
                                        type="button"
                                        onClick={sinFondo ? restaurarFondo : borrarFondo}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-wide transition-colors ${
                                            sinFondo
                                                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400'
                                                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                        }`}
                                        title={sinFondo
                                            ? 'Devuelve el fondo que tenía el arte original'
                                            : 'Borra el fondo liso que rodea al dibujo. Lo que esté encerrado adentro (por ejemplo letras blancas) no se toca.'}
                                    >
                                        <Eraser size={12} /> {sinFondo ? 'Fondo quitado' : 'Quitar fondo'}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={deshacer}
                                        disabled={pasosAtras === 0}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-[10px] font-black text-zinc-400 uppercase tracking-wide hover:text-zinc-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-zinc-400"
                                        title={pasosAtras === 0
                                            ? 'No hay nada para deshacer'
                                            : `Deshace lo último que hiciste sobre el dibujo (quedan ${pasosAtras}). También con Ctrl+Z`}
                                    >
                                        <Undo2 size={12} /> Deshacer{pasosAtras > 0 ? ` (${pasosAtras})` : ''}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setVerContornos(v => !v)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-wide transition-colors ${
                                            verContornos
                                                ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                                                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                        }`}
                                        title="Marca el borde de cada pieza detectada, como en un programa de digitalizar"
                                    >
                                        <Spline size={12} /> Contornos
                                    </button>
                                </div>

                                {aviso && (
                                    <p className="mb-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] font-bold text-amber-400 leading-relaxed">
                                        {aviso}
                                    </p>
                                )}

                                {/* Barra de la herramienta activa: qué hace y con qué */}
                                {herramienta === 'BALDE' && (
                                    <div className="mb-2 px-3 py-2 rounded-lg bg-brand-gold/10 border border-brand-gold/30 flex items-center gap-2 flex-wrap">
                                        <span className="text-[11px] font-bold text-brand-gold">Pintar con</span>
                                        <span className="w-5 h-5 rounded-full border-2 border-white/25 shrink-0"
                                            style={{ backgroundColor: (CARTA_HILOS.find(h => h.codigo === hiloPintar) || {}).hex }} />
                                        <select
                                            value={hiloPintar}
                                            onChange={(e) => setHiloPintar(e.target.value)}
                                            className="h-7 px-2 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-bold text-zinc-200 outline-none focus:border-brand-gold"
                                        >
                                            {CARTA_HILOS.map(h => <option key={h.codigo} value={h.codigo}>{h.nombre}</option>)}
                                        </select>
                                        <span className="text-[10px] text-zinc-400">
                                            Tocá adentro del área a pintar. Frena contra el contorno.
                                        </span>
                                    </div>
                                )}

                                {herramienta === 'GOMA' && (
                                    <div className="mb-2 px-3 py-2 rounded-lg bg-brand-gold/10 border border-brand-gold/30 flex items-center gap-2 flex-wrap">
                                        <span className="text-[11px] font-bold text-brand-gold">Grosor</span>
                                        <input
                                            type="range" min="2" max="30" step="1" value={radioGoma}
                                            onChange={(e) => setRadioGoma(parseInt(e.target.value))}
                                            className="accent-brand-gold w-28"
                                        />
                                        <span className="text-[11px] font-black text-zinc-200 w-8">{radioGoma * 2}px</span>
                                        <span className="text-[10px] text-zinc-400">
                                            Mantené apretado y arrastrá sobre lo que quieras borrar.
                                        </span>
                                    </div>
                                )}

                                <div className="rounded-2xl bg-zinc-950/60 border border-zinc-800 p-4 flex justify-center items-center min-h-[240px] max-h-[46vh] overflow-auto">
                                    <canvas
                                        ref={canvasRef}
                                        onMouseDown={(e) => { pintandoRef.current = true; usarHerramienta(e); }}
                                        onMouseMove={(e) => { if (pintandoRef.current) usarHerramienta(e, true); }}
                                        onMouseUp={soltar}
                                        onMouseLeave={soltar}
                                        style={{
                                            ...(anchoPx ? { width: `${anchoPx}px`, height: 'auto', maxWidth: 'none' } : {}),
                                            // Damero atrás cuando hay transparencia, para que se
                                            // vea qué quedó vacío y qué es hilo blanco.
                                            ...(sinFondo ? DAMERO : {}),
                                        }}
                                        className={`rounded shrink-0 ${anchoPx ? '' : 'max-w-full max-h-[42vh]'} ${herramienta ? 'cursor-crosshair' : 'cursor-default'}`}
                                    />
                                </div>

                                {/* Zoom y tamaño real */}
                                <div className="flex items-center gap-2 mt-3 flex-wrap">
                                    <div className="flex items-center rounded-lg border border-zinc-700 overflow-hidden">
                                        <button type="button" onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))}
                                            className="px-2.5 py-1.5 bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors" title="Alejar">
                                            <ZoomOut size={13} />
                                        </button>
                                        <span className="px-2 py-1.5 bg-zinc-900 text-[10px] font-black text-zinc-300 min-w-[46px] text-center">
                                            {Math.round(zoom * 100)}%
                                        </span>
                                        <button type="button" onClick={() => setZoom(z => Math.min(6, +(z + 0.25).toFixed(2)))}
                                            className="px-2.5 py-1.5 bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors" title="Acercar">
                                            <ZoomIn size={13} />
                                        </button>
                                    </div>

                                    <button type="button"
                                        onClick={() => { setModoTamano('AJUSTAR'); setZoom(1); }}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-wide transition-colors ${
                                            modoTamano === 'AJUSTAR' ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                        }`}
                                        title="Que la imagen entre completa en el recuadro">
                                        <Maximize2 size={12} /> Ajustar
                                    </button>

                                    <button type="button"
                                        disabled={!hayMedidas}
                                        onClick={() => { setModoTamano('REAL'); setZoom(1); }}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                            modoTamano === 'REAL' ? 'bg-brand-gold text-zinc-900 border-brand-gold' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                        }`}
                                        title={hayMedidas
                                            ? `Ver el bordado del tamaño que va a quedar: ${anchoCm} × ${altoCm} cm`
                                            : 'Cargá el ancho y el largo del bordado para poder verlo a tamaño real'}>
                                        <Ruler size={12} /> Tamaño real
                                    </button>
                                </div>

                                {modoTamano === 'REAL' && hayMedidas && (
                                    <p className="text-[9px] text-zinc-500 mt-2 leading-relaxed">
                                        Así de grande va a quedar sobre la prenda: <span className="font-black text-zinc-300">{anchoCm} × {altoCm} cm</span>.
                                        Es aproximado — depende del tamaño y la resolución de tu pantalla.
                                    </p>
                                )}

                                <button
                                    type="button" onClick={() => { guardarEstado(); detectar(false); }}
                                    className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-[10px] font-black text-zinc-300 uppercase tracking-widest hover:border-brand-gold hover:text-brand-gold transition-all"
                                >
                                    <Wand2 size={13} /> Volver a detectar los hilos
                                </button>
                                <p className="text-[9px] text-zinc-600 mt-2 leading-relaxed">
                                    Reemplaza la lista por los colores que detecte en el arte. Perdés los cambios que hayas hecho a mano.
                                </p>
                            </div>

                            {/* ── Secuencia de hilos ── */}
                            <div className="p-5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black text-zinc-300 uppercase tracking-widest">
                                        Secuencia de bordado
                                    </h4>
                                    <span className="text-[9px] font-bold text-zinc-600 uppercase">{paleta.length} paradas</span>
                                </div>
                                <p className="text-[9px] text-zinc-600 -mt-2 leading-relaxed">
                                    La máquina borda en este orden y para en cada cambio de hilo.
                                </p>

                                {/* Relieve para TODO el diseño de una. El caso pieza por pieza
                                    se resuelve con el interruptor de cada parada. */}
                                {paleta.length > 0 && (
                                    <div className="flex items-center gap-2">
                                        <button type="button" onClick={() => relieveTodo(true)}
                                            disabled={piezasRelieve === paleta.length}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-zinc-700 bg-zinc-800/60 text-[9px] font-black text-zinc-300 uppercase tracking-wide hover:border-brand-gold hover:text-brand-gold transition-colors disabled:opacity-30 disabled:hover:border-zinc-700 disabled:hover:text-zinc-300"
                                            title="Marca todas las piezas en relieve 3D">
                                            <Mountain size={11} /> Todo en relieve
                                        </button>
                                        <button type="button" onClick={() => relieveTodo(false)}
                                            disabled={piezasRelieve === 0}
                                            className="flex-1 py-2 rounded-lg border border-zinc-700 bg-zinc-800/60 text-[9px] font-black text-zinc-300 uppercase tracking-wide hover:border-zinc-500 transition-colors disabled:opacity-30"
                                            title="Saca el relieve de todas las piezas">
                                            Todo plano
                                        </button>
                                    </div>
                                )}

                                {paleta.length === 0 ? (
                                    <p className="text-[11px] text-zinc-500 italic py-4">
                                        No se detectaron colores. Usá "Tomar hilo" sobre la imagen.
                                    </p>
                                ) : conPuntadas.map((p, i) => {
                                    const hilo = hiloDe(p.hilo);
                                    // Todo el detalle va al tooltip de la fila: cuánto ocupa, cuántas
                                    // puntadas lleva y para qué sirve esa puntada. Antes eran tres
                                    // renglones por pieza y con 6 hilos la lista no entraba en pantalla.
                                    const detalle = [
                                        `${hilo.nombre} (${hilo.codigo})`,
                                        `Ocupa el ${(p.cobertura * 100).toFixed(0)}% del arte`,
                                        hayMedidas ? `≈ ${p.puntadas.toLocaleString('es-UY')} puntadas` : null,
                                        p.relieve
                                            ? 'En relieve 3D sobre goma espuma: la puntada va un 50% más cerrada para cortarla, así que lleva más hilo y más tiempo.'
                                            : puntadaPorId(p.puntada).ayuda,
                                    ].filter(Boolean).join('\n');

                                    return (
                                        <div key={p.id} title={detalle}
                                            className="rounded-xl bg-zinc-800/40 border border-zinc-700/60 p-2 flex items-center gap-1.5">

                                            <span className="w-4 h-4 shrink-0 rounded bg-zinc-900 border border-zinc-700 text-[9px] font-black text-zinc-400 flex items-center justify-center">
                                                {i + 1}
                                            </span>

                                            {/* Hilo: la bolita del color va DENTRO del combo, no al lado */}
                                            <div className="relative flex-1 min-w-0">
                                                <span
                                                    className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-white/25 pointer-events-none"
                                                    style={{ backgroundColor: hilo.hex }}
                                                />
                                                <select
                                                    value={p.hilo}
                                                    onChange={(e) => actualizar(p.id, { hilo: e.target.value })}
                                                    title="Cambia el hilo de TODAS las partes de este color. Para cambiar una sola, usá Pintar."
                                                    className="w-full h-8 pl-8 pr-1 bg-zinc-900 border border-zinc-700 rounded text-[10px] font-bold text-zinc-200 outline-none focus:border-brand-gold"
                                                >
                                                    {CARTA_HILOS.map(h => (
                                                        <option key={h.codigo} value={h.codigo}>{h.nombre}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Puntada */}
                                            <select
                                                value={p.relieve ? PUNTADA_RELIEVE : p.puntada}
                                                disabled={!!p.relieve}
                                                onChange={(e) => actualizar(p.id, { puntada: e.target.value })}
                                                className="flex-1 min-w-0 h-8 px-1.5 bg-zinc-900 border border-zinc-700 rounded text-[10px] font-bold text-zinc-200 outline-none focus:border-brand-gold disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {TIPOS_PUNTADA.map(t => (
                                                    <option key={t.id} value={t.id}>{t.nombre}</option>
                                                ))}
                                            </select>

                                            {/* [RELIEVE] Por pieza: lo normal es una letra en relieve y el
                                                resto plano. Marcarlo fuerza satén (la puntada que corta la goma). */}
                                            <label
                                                title={p.relieve
                                                    ? 'En relieve 3D. Solo se puede bordar en satén: es la puntada que corta la goma espuma.'
                                                    : 'Bordar esta pieza en relieve 3D (sobre goma espuma)'}
                                                className={`shrink-0 flex items-center gap-1 h-8 px-1.5 rounded border cursor-pointer transition-colors ${
                                                    p.relieve
                                                        ? 'bg-brand-gold/15 border-brand-gold/50'
                                                        : 'bg-zinc-900 border-zinc-700 hover:border-zinc-600'
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={!!p.relieve}
                                                    onChange={(e) => actualizar(p.id, {
                                                        relieve: e.target.checked,
                                                        ...(e.target.checked ? { puntada: PUNTADA_RELIEVE } : {}),
                                                    })}
                                                    className="h-3 w-3 accent-brand-gold"
                                                />
                                                <span className={`text-[10px] font-black ${p.relieve ? 'text-brand-gold' : 'text-zinc-400'}`}>3D</span>
                                            </label>

                                            <div className="flex flex-col shrink-0">
                                                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0}
                                                    className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 disabled:hover:text-zinc-500"
                                                    title="Bordar antes"><ChevronUp size={12} /></button>
                                                <button type="button" onClick={() => mover(i, 1)} disabled={i === paleta.length - 1}
                                                    className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 disabled:hover:text-zinc-500"
                                                    title="Bordar después"><ChevronDown size={12} /></button>
                                            </div>

                                            <button type="button" onClick={() => quitar(p.id)}
                                                className="shrink-0 text-zinc-600 hover:text-red-500 transition-colors"
                                                title="Sacar este hilo"><Trash2 size={12} /></button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── Totales y acciones ── */}
                        <div className="border-t border-zinc-800 p-5">
                            {!hayMedidas ? (
                                <p className="mb-4 text-xs font-bold text-amber-400">
                                    Cargá el ancho y el largo del bordado para poder estimar las puntadas y el tiempo.
                                </p>
                            ) : (
                                <>
                                    {/* LO QUE MÁS IMPORTA, GRANDE: cuántas puntadas y cuánto tarda.
                                        Primero por prenda; abajo, el trabajo entero. */}
                                    <div className="mb-4 rounded-2xl bg-zinc-800/60 border border-zinc-700 overflow-hidden">
                                        <div className="grid grid-cols-2 divide-x divide-zinc-700">
                                            <div className="p-4">
                                                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mb-1">
                                                    <Layers3 size={12} /> Puntadas por prenda
                                                </p>
                                                <p className="text-3xl font-black text-white leading-none">
                                                    {totalPuntadas.toLocaleString('es-UY')}
                                                </p>
                                            </div>
                                            <div className="p-4">
                                                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mb-1">
                                                    <Clock size={12} /> Tiempo por prenda
                                                </p>
                                                <p className="text-3xl font-black text-white leading-none">
                                                    {formatearDuracion(minutos)}
                                                </p>
                                            </div>
                                        </div>

                                        {cantidad > 0 && (
                                            <div className="px-4 py-3 bg-brand-gold/10 border-t border-brand-gold/25 flex items-baseline gap-x-3 gap-y-1 flex-wrap">
                                                <span className="text-xs font-bold text-zinc-300">
                                                    Las <span className="font-black text-white">{cantidad}</span> prendas de este diseño:
                                                </span>
                                                <span className="text-lg font-black text-white">
                                                    {(totalPuntadas * cantidad).toLocaleString('es-UY')} puntadas
                                                </span>
                                                <span className="text-zinc-500">·</span>
                                                <span className="text-lg font-black text-brand-gold">
                                                    {formatearDuracion(minutos * cantidad)} de máquina
                                                </span>
                                            </div>
                                        )}

                                        <div className="px-4 py-2.5 border-t border-zinc-700 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs font-bold text-zinc-300">
                                            <span>Tamaño <span className="text-white font-black">{anchoCm} × {altoCm} cm</span></span>
                                            <span>Hilos <span className="text-white font-black">{paleta.length}</span></span>
                                            {piezasRelieve > 0 && (
                                                <span className="flex items-center gap-1.5 text-brand-gold">
                                                    <Mountain size={13} />
                                                    {piezasRelieve} {piezasRelieve === 1 ? 'pieza en relieve' : 'piezas en relieve'}
                                                </span>
                                            )}
                                            {piezasTafeta > 0 && (
                                                <span className="flex items-center gap-1.5 text-emerald-400">
                                                    <Scissors size={13} />
                                                    {piezasTafeta} {piezasTafeta === 1 ? 'pieza con tafeta' : 'piezas con tafeta'}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {piezasRelieve > 0 && (
                                        <p className="mb-2 text-xs font-bold text-brand-gold">
                                            El relieve suma un 50% de puntadas y el pedido lleva el cargo correspondiente.
                                        </p>
                                    )}
                                    {piezasTafeta > 0 && (
                                        <p className="mb-2 text-xs font-bold text-emerald-400">
                                            La tafeta cubre la superficie con tela: se borda mucho menos hilo y sale más barato.
                                        </p>
                                    )}
                                </>
                            )}

                            <p className="text-[11px] text-zinc-400 mb-4 leading-relaxed">
                                <span className="font-black text-zinc-200">Es una estimación.</span>{' '}
                                Se calcula por área y densidad — relleno ≈ 1.400 puntadas por pulgada², satén ≈ 1.000,
                                pespunte ≈ 300, tafeta ≈ 250, y el relieve suma 50%. El tiempo es a 600 puntadas por
                                minuto más el cambio de hilo, sin contar el bastidor. El número definitivo sale del
                                ponchado que hace el diseñador.
                            </p>

                            <div className="flex gap-3">
                                <button type="button" onClick={onCerrar}
                                    className="flex-1 py-3 rounded-xl border border-zinc-700 text-[11px] font-black text-zinc-400 uppercase tracking-widest hover:text-zinc-200 transition-colors">
                                    Cancelar
                                </button>
                                <button type="button" onClick={guardar}
                                    className="flex-1 py-3 rounded-xl bg-brand-gold text-zinc-900 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-2">
                                    <Check size={14} /> Guardar diseño
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// Minutos → "45 min" / "2 h 10 min". Los trabajos largos en minutos sueltos
// (ej. "310 min") no se leen.
const formatearDuracion = (minutos) => {
    const m = Math.max(1, Math.round(minutos));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
};

