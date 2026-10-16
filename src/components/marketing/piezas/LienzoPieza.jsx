import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Stage, Layer, Shape, Transformer } from 'react-konva';
import { dibujarFondo, dibujarCapa, medirCapa, estadoDibujo, fuenteDe, INTERLINEADO } from './dibujo';
import { dimensiones, limites, cajaEnvolvente, corrimientoDentro, ES_TEXTO } from './capas';
import { ZONA_SEGURA_HISTORIA, resolverColor } from './marca';

// La pieza en pantalla, con Konva. Todo se dibuja en coordenadas de la pieza (1080 de ancho) y el
// Stage se escala para entrar en el lugar disponible. Mover, cambiar el tamaño y girar los resuelve
// el Transformer de Konva; acá se agrega lo nuestro: que nada salga del recuadro, las guías
// magnéticas, la zona segura de las historias y el cuadro para escribir sobre la pieza.

const ESQUINAS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const LADOS = ['middle-left', 'middle-right'];
const anclasDe = (tipo) => {
    if (ES_TEXTO.has(tipo) || tipo === 'barra') return [...ESQUINAS, ...LADOS];
    if (tipo === 'imagen') return [...ESQUINAS, ...LADOS, 'top-center', 'bottom-center'];
    return ESQUINAS;
};
const GIROS = [0, 45, 90, 135, 180, 225, 270, 315];
const GIROS_15 = Array.from({ length: 24 }, (_, i) => i * 15);
const AZUL = '#22a9ff';
const IMAN_PX = 6; // distancia en pantalla a la que una capa se pega a una guía

const limitar = (v, min, max) => Math.min(max, Math.max(min, v));
const normalizarGiro = (g) => {
    const r = ((g % 360) + 360) % 360;
    return Math.round((r > 180 ? r - 360 : r) * 100) / 100;
};

// Konva dibuja cada capa llamando a sceneFunc con su contexto; se usa el contexto nativo para que
// el dibujo sea el mismo código que el del PNG.
const sceneCapa = (ctx, shape) => dibujarCapa(ctx._context, shape.getAttr('capa'), shape.getAttr('pieza'), shape.getAttr('imagen'));
// Toda la caja responde al mouse, no solo las letras.
const hitCaja = (ctx, shape) => {
    ctx.beginPath();
    ctx.rect(0, 0, shape.width(), shape.height());
    ctx.closePath();
    ctx.fillStrokeShape(shape);
};

export const puntoEnCapa = (capa, px, py) => {
    const { w, h } = medirCapa(capa);
    const r = -(capa.rotacion || 0) * Math.PI / 180;
    const dx = px - capa.x, dy = py - capa.y;
    const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
    return lx >= 0 && lx <= w && ly >= 0 && ly <= h;
};

const LienzoPieza = forwardRef(({
    pieza, imagenes, seleccion, editandoId,
    onSeleccionar, onCambiarCapa, onDobleClic, onEditarTexto, onTerminarEdicion, onSoltarArchivo,
}, ref) => {
    const { W, H } = dimensiones(pieza);
    const lim = limites(pieza);

    // ---------- tamaño en pantalla ----------
    const contRef = useRef(null);
    const [espacio, setEspacio] = useState({ w: 520, h: 650 });
    useLayoutEffect(() => {
        const el = contRef.current;
        if (!el) return undefined;
        const medir = () => {
            const r = el.getBoundingClientRect();
            setEspacio({ w: Math.max(200, r.width), h: Math.max(360, window.innerHeight - r.top - 56) });
        };
        medir();
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        window.addEventListener('resize', medir);
        return () => { ro.disconnect(); window.removeEventListener('resize', medir); };
    }, []);
    const k = Math.min(espacio.w / W, espacio.h / H);

    // Valores que leen los manejadores de Konva sin rearmarse en cada render.
    const vivo = useRef({});
    vivo.current = { k, lim, W, H, pieza };

    const stageRef = useRef(null);
    const trRef = useRef(null);
    const capaUIRef = useRef(null);
    const guiasRef = useRef([]);
    const objetivosRef = useRef({ v: [], h: [] });

    // ---------- selección ----------
    useEffect(() => {
        const tr = trRef.current;
        const stage = stageRef.current;
        if (!tr || !stage) return;
        const capa = pieza.capas.find(c => c.id === seleccion);
        const nodo = capa && !capa.bloqueada && !capa.oculta && capa.id !== editandoId ? stage.findOne(`#${capa.id}`) : null;
        if (nodo) tr.enabledAnchors(anclasDe(capa.tipo));
        tr.nodes(nodo ? [nodo] : []);
        tr.getLayer()?.batchDraw();
    }, [pieza, seleccion, editandoId]);

    // Con Shift apretado, el giro se pega cada 15°.
    useEffect(() => {
        const poner = (shift) => {
            const tr = trRef.current;
            if (!tr) return;
            tr.rotationSnaps(shift ? GIROS_15 : GIROS);
            tr.rotationSnapTolerance(shift ? 7.5 : 4);
        };
        const abajo = (e) => { if (e.key === 'Shift') poner(true); };
        const arriba = (e) => { if (e.key === 'Shift') poner(false); };
        const soltar = () => poner(false);
        window.addEventListener('keydown', abajo);
        window.addEventListener('keyup', arriba);
        window.addEventListener('blur', soltar);
        return () => {
            window.removeEventListener('keydown', abajo);
            window.removeEventListener('keyup', arriba);
            window.removeEventListener('blur', soltar);
        };
    }, []);

    // ---------- límites al cambiar tamaño o girar ----------
    // Las cajas de Konva vienen en píxeles de pantalla (pieza × k). Si la caja nueva sale del
    // recuadro, se rechaza: el giro o el estiramiento se frena en el borde.
    const limitarCaja = useCallback((viejo, nuevo) => {
        const { k: e, lim: l } = vivo.current;
        if (Math.abs(nuevo.width) / e < 12 || Math.abs(nuevo.height) / e < 12) return viejo;
        const fuera = (b) => {
            const c = Math.cos(b.rotation), s = Math.sin(b.rotation);
            return [[0, 0], [b.width, 0], [b.width, b.height], [0, b.height]].some(([px, py]) => {
                const x = (b.x + px * c - py * s) / e, y = (b.y + px * s + py * c) / e;
                return x < l.x0 - 0.5 || x > l.x1 + 0.5 || y < l.y0 - 0.5 || y > l.y1 + 0.5;
            });
        };
        // Si ya estaba afuera (una capa más grande que el recuadro), no se traba.
        return fuera(nuevo) && !fuera(viejo) ? viejo : nuevo;
    }, []);

    // Mientras se estira, la escala de Konva se pasa a las medidas de la capa (tamaño de letra,
    // ancho, alto) y la escala vuelve a 1: así los textos se rearman en vez de deformarse.
    const alTransformar = useCallback((e) => {
        const nodo = e.target;
        const capa = nodo.getAttr('capa');
        const ancla = trRef.current?.getActiveAnchor();
        const sx = nodo.scaleX(), sy = nodo.scaleY();
        if (!capa || ancla === 'rotater' || (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6)) return;
        const lado = ancla === 'middle-left' || ancla === 'middle-right';
        let cambios = {};
        switch (capa.tipo) {
            case 'titulo':
            case 'texto':
            case 'dato':
                cambios = lado
                    ? { ancho: Math.max(60, capa.ancho * sx) }
                    : { tamano: limitar(capa.tamano * sx, 8, 600), ancho: Math.max(60, capa.ancho * sx) };
                break;
            case 'precio':
            case 'etiqueta':
                cambios = { tamano: limitar(capa.tamano * sx, 8, 600) };
                break;
            case 'logo':
            case 'asterisco':
                cambios = { ancho: Math.max(12, capa.ancho * sx) };
                break;
            case 'barra':
                cambios = lado ? { ancho: Math.max(40, capa.ancho * sx) } : { ancho: Math.max(40, capa.ancho * sx), alto: Math.max(8, capa.alto * sy) };
                break;
            case 'imagen':
                cambios = { ancho: Math.max(40, capa.ancho * sx), alto: Math.max(40, capa.alto * sy) };
                break;
            default:
                break;
        }
        const nueva = { ...capa, ...cambios };
        const { w, h } = medirCapa(nueva);
        nodo.setAttrs({ capa: nueva, width: w, height: h, scaleX: 1, scaleY: 1 });
    }, []);

    const alTerminarTransformar = useCallback((e) => {
        const nodo = e.target;
        const capa = nodo.getAttr('capa');
        if (!capa) return;
        onCambiarCapa(capa.id, { ...capa, x: nodo.x(), y: nodo.y(), rotacion: normalizarGiro(nodo.rotation()) });
    }, [onCambiarCapa]);

    // ---------- arrastre: guías magnéticas y recuadro ----------
    const alEmpezarArrastre = useCallback((e) => {
        const id = e.target.id();
        const { lim: l, W: w0, H: h0, pieza: p } = vivo.current;
        const v = [l.x0, w0 / 2, l.x1];
        const h = [l.y0, h0 / 2, l.y1];
        p.capas.forEach((c) => {
            if (c.id === id || c.oculta) return;
            const m = medirCapa(c);
            const b = cajaEnvolvente(c.x, c.y, m.w, m.h, c.rotacion);
            v.push(b.x0, (b.x0 + b.x1) / 2, b.x1);
            h.push(b.y0, (b.y0 + b.y1) / 2, b.y1);
        });
        objetivosRef.current = { v, h };
        onSeleccionar(id);
    }, [onSeleccionar]);

    const alArrastrar = useCallback((e) => {
        const nodo = e.target;
        const { k: esc, lim: l } = vivo.current;
        const w = nodo.width(), h = nodo.height(), rot = nodo.rotation();
        let b = cajaEnvolvente(nodo.x(), nodo.y(), w, h, rot);
        const guias = [];
        if (!e.evt?.altKey) {
            const tol = IMAN_PX / esc;
            const pegar = (bordes, objetivos) => {
                let mejor = null;
                objetivos.forEach((t) => bordes.forEach((p) => {
                    const d = t - p;
                    if (Math.abs(d) <= tol && (!mejor || Math.abs(d) < Math.abs(mejor.d))) mejor = { d, t };
                }));
                return mejor;
            };
            const mx = pegar([b.x0, (b.x0 + b.x1) / 2, b.x1], objetivosRef.current.v);
            const my = pegar([b.y0, (b.y0 + b.y1) / 2, b.y1], objetivosRef.current.h);
            if (mx) { nodo.x(nodo.x() + mx.d); guias.push({ o: 'v', p: mx.t }); }
            if (my) { nodo.y(nodo.y() + my.d); guias.push({ o: 'h', p: my.t }); }
            b = cajaEnvolvente(nodo.x(), nodo.y(), w, h, rot);
        }
        const { dx, dy } = corrimientoDentro(b, l);
        if (dx || dy) { nodo.x(nodo.x() + dx); nodo.y(nodo.y() + dy); }
        guiasRef.current = guias;
        capaUIRef.current?.batchDraw();
    }, []);

    const alSoltar = useCallback((e) => {
        const nodo = e.target;
        guiasRef.current = [];
        capaUIRef.current?.batchDraw();
        onCambiarCapa(nodo.id(), { x: nodo.x(), y: nodo.y() });
    }, [onCambiarCapa]);

    const sceneGuias = useCallback((ctx) => {
        const c = ctx._context;
        const { k: esc, W: w0, H: h0 } = vivo.current;
        if (!guiasRef.current.length) return;
        c.save();
        c.strokeStyle = AZUL;
        c.lineWidth = 1.5 / esc;
        c.setLineDash([6 / esc, 4 / esc]);
        guiasRef.current.forEach((g) => {
            c.beginPath();
            if (g.o === 'v') { c.moveTo(g.p, 0); c.lineTo(g.p, h0); } else { c.moveTo(0, g.p); c.lineTo(w0, g.p); }
            c.stroke();
        });
        c.restore();
    }, []);

    // Historias: la franja de arriba y la de abajo, que puede tapar la interfaz de Instagram.
    const sceneZonaSegura = useCallback((ctx) => {
        const c = ctx._context;
        const { k: esc, W: w0, H: h0 } = vivo.current;
        const z = ZONA_SEGURA_HISTORIA;
        c.save();
        c.fillStyle = 'rgba(34,169,255,0.08)';
        c.fillRect(0, 0, w0, z);
        c.fillRect(0, h0 - z, w0, z);
        c.strokeStyle = 'rgba(34,169,255,0.75)';
        c.lineWidth = 1.5 / esc;
        c.setLineDash([8 / esc, 6 / esc]);
        c.beginPath();
        c.moveTo(0, z); c.lineTo(w0, z);
        c.moveTo(0, h0 - z); c.lineTo(w0, h0 - z);
        c.stroke();
        c.setLineDash([]);
        c.font = `600 ${11 / esc}px Inter`;
        c.fillStyle = 'rgba(34,169,255,0.95)';
        c.textBaseline = 'bottom';
        c.fillText('Puede quedar tapado por Instagram', 64, z - 6 / esc);
        c.textBaseline = 'top';
        c.fillText('Puede quedar tapado por Instagram', 64, h0 - z + 6 / esc);
        c.restore();
    }, []);

    const sceneFondo = useCallback((ctx) => {
        const { W: w0, H: h0, pieza: p } = vivo.current;
        dibujarFondo(ctx._context, { W: w0, H: h0, fondo: p.fondo, acento: p.acento, marco: p.marco });
    }, []);

    // ---------- exportar ----------
    useImperativeHandle(ref, () => ({
        // Dibuja la pieza a tamaño real (1080 × 1350 o 1920) sin selección, guías ni ayudas, y
        // devuelve el canvas. El Stage pasa un instante a escala 1: con la escala de pantalla, el
        // redondeo dejaba el PNG un píxel más corto.
        exportar: () => {
            const stage = stageRef.current;
            const tr = trRef.current;
            const ui = capaUIRef.current;
            const { W: w0, H: h0 } = vivo.current;
            const tam = stage.size();
            const esc = stage.scaleX();
            const nodos = tr.nodes();
            tr.nodes([]);
            ui.hide();
            estadoDibujo.exportando = true;
            try {
                stage.size({ width: w0, height: h0 });
                stage.scale({ x: 1, y: 1 });
                return stage.toCanvas({ pixelRatio: 1 });
            } finally {
                stage.size(tam);
                stage.scale({ x: esc, y: esc });
                estadoDibujo.exportando = false;
                ui.show();
                tr.nodes(nodos);
                stage.draw();
            }
        },
    }), []);

    // ---------- soltar fotos desde la PC ----------
    const [soltando, setSoltando] = useState(false);
    const alSoltarArchivo = (e) => {
        e.preventDefault();
        setSoltando(false);
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        const r = stageRef.current?.container().getBoundingClientRect();
        const punto = r ? { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k } : null;
        onSoltarArchivo(file, punto);
    };

    // ---------- escribir sobre la pieza ----------
    const capaEditando = pieza.capas.find(c => c.id === editandoId && ES_TEXTO.has(c.tipo));
    const taRef = useRef(null);
    useEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        ta.select();
    }, [editandoId]);
    useLayoutEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight}px`;
    });

    const piezaCtx = { fondo: pieza.fondo, acento: pieza.acento };

    return (
        <div ref={contRef} className="w-full flex justify-center">
            <div
                className={`relative rounded-xl overflow-hidden shadow-sm ring-1 ${soltando ? 'ring-2 ring-[#22a9ff]' : 'ring-slate-300'}`}
                style={{ width: W * k, height: H * k }}
                onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setSoltando(true); } }}
                onDragLeave={() => setSoltando(false)}
                onDrop={alSoltarArchivo}
            >
                <Stage
                    ref={stageRef}
                    width={W * k}
                    height={H * k}
                    scaleX={k}
                    scaleY={k}
                    onMouseDown={(e) => { if (e.target === e.target.getStage()) onSeleccionar(null); }}
                    onTouchStart={(e) => { if (e.target === e.target.getStage()) onSeleccionar(null); }}
                >
                    <Layer>
                        <Shape listening={false} sceneFunc={sceneFondo} pieza={piezaCtx} formato={pieza.formato} marco={pieza.marco} />
                        {pieza.capas.map((c) => {
                            const { w, h } = medirCapa(c);
                            const libre = !c.bloqueada;
                            return (
                                <Shape
                                    key={c.id}
                                    id={c.id}
                                    name="capa"
                                    x={c.x}
                                    y={c.y}
                                    width={w}
                                    height={h}
                                    rotation={c.rotacion || 0}
                                    visible={!c.oculta && c.id !== editandoId}
                                    listening={libre}
                                    draggable={libre}
                                    capa={c}
                                    pieza={piezaCtx}
                                    imagen={c.tipo === 'imagen' && c.src ? imagenes[c.src] : undefined}
                                    sceneFunc={sceneCapa}
                                    hitFunc={hitCaja}
                                    onMouseDown={() => onSeleccionar(c.id)}
                                    onTouchStart={() => onSeleccionar(c.id)}
                                    onDblClick={() => onDobleClic(c)}
                                    onDblTap={() => onDobleClic(c)}
                                    onDragStart={alEmpezarArrastre}
                                    onDragMove={alArrastrar}
                                    onDragEnd={alSoltar}
                                    onTransform={alTransformar}
                                    onTransformEnd={alTerminarTransformar}
                                    onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'move'; }}
                                    onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                                />
                            );
                        })}
                    </Layer>
                    <Layer ref={capaUIRef}>
                        {pieza.formato === 'historia' && <Shape listening={false} sceneFunc={sceneZonaSegura} />}
                        <Shape listening={false} sceneFunc={sceneGuias} />
                        <Transformer
                            ref={trRef}
                            rotationSnaps={GIROS}
                            rotationSnapTolerance={4}
                            rotateAnchorOffset={26}
                            boundBoxFunc={limitarCaja}
                            keepRatio
                            flipEnabled={false}
                            ignoreStroke
                            anchorSize={10}
                            anchorCornerRadius={3}
                            anchorStroke={AZUL}
                            anchorFill="#ffffff"
                            borderStroke={AZUL}
                            borderStrokeWidth={1.5}
                        />
                    </Layer>
                </Stage>

                {capaEditando && (
                    <textarea
                        ref={taRef}
                        value={capaEditando.texto ?? ''}
                        onChange={(e) => onEditarTexto(capaEditando.id, e.target.value)}
                        onBlur={onTerminarEdicion}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                                e.preventDefault();
                                e.currentTarget.blur();
                            }
                        }}
                        spellCheck={false}
                        rows={1}
                        style={{
                            position: 'absolute',
                            left: capaEditando.x * k,
                            top: capaEditando.y * k,
                            width: capaEditando.ancho * k,
                            transform: `rotate(${capaEditando.rotacion || 0}deg)`,
                            transformOrigin: 'top left',
                            font: fuenteDe({ ...capaEditando, tamano: capaEditando.tamano * k }),
                            lineHeight: INTERLINEADO[capaEditando.tipo] || 1.3,
                            color: resolverColor(capaEditando.color, pieza.fondo, pieza.acento),
                            caretColor: AZUL,
                            textAlign: capaEditando.alineacion || 'center',
                            textTransform: capaEditando.tipo === 'titulo' || capaEditando.mayusculas ? 'uppercase' : 'none',
                            background: 'transparent',
                            border: 'none',
                            outline: `1px dashed ${AZUL}`,
                            padding: 0,
                            margin: 0,
                            resize: 'none',
                            overflow: 'hidden',
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'break-word',
                        }}
                    />
                )}
            </div>
        </div>
    );
});

LienzoPieza.displayName = 'LienzoPieza';
export default LienzoPieza;
