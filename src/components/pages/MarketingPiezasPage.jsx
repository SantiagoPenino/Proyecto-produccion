import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Undo2, Redo2, Download, PackageSearch, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import LienzoPieza, { puntoEnCapa } from '../marketing/piezas/LienzoPieza';
import PanelCapa from '../marketing/piezas/PanelCapa';
import ListaCapas from '../marketing/piezas/ListaCapas';
import { ModalProducto, ModalFotoVitrina } from '../marketing/piezas/Modales';
import { Tarjeta, Segmentado, PaletaTintas, Interruptor } from '../marketing/piezas/controles';
import { ICONOS_CAPA } from '../marketing/piezas/iconos';
import { useEditorPieza } from '../marketing/piezas/useEditorPieza';
import { useImagenes, abrirArchivoImagen } from '../marketing/piezas/useImagenes';
import {
    TIPOS, ES_TEXTO, PLANTILLAS, crearCapa, duplicarCapa, capasDePlantilla, cambiarFormato,
    cambiarConCentro, rotarCapa, aplicarProducto, limites, dimensiones,
} from '../marketing/piezas/capas';
import { FORMATOS, FUENTES } from '../marketing/piezas/marca';

// [MARKETING 15/10] /marketing/piezas — Compositor de piezas para redes (posteos de feed e
// historias) con la identidad de user. Viene del compositor que armó Marketing
// (Desktop/user-marca/user-marca/compositor/compositor-user.html), sin el chat con IA y con
// capas libres: se agregan, se arrastran, se estiran y se giran dentro del recuadro.
// Plan: docs/marketing-compositor-piezas-plan.md.

const AGREGAR = ['titulo', 'texto', 'dato', 'precio', 'etiqueta', 'imagen', 'logo', 'barra', 'asterisco'];

const ATAJOS = [
    ['Doble clic en un texto', 'escribir sobre la pieza'],
    ['Flechas', 'mover 1 px (con Shift, 10 px)'],
    ['Shift al girar', 'de a 15°'],
    ['Alt al arrastrar', 'sin guías magnéticas'],
    ['Ctrl+D', 'duplicar'],
    ['Supr', 'borrar'],
    ['Ctrl+Z / Ctrl+Y', 'deshacer / rehacer'],
    ['Esc', 'soltar la selección'],
];

// El canvas no espera a las fuentes: si dibuja antes, mide con otra letra. Se esperan (hasta 5 s).
const useFuentesListas = () => {
    const [listas, setListas] = useState(false);
    useEffect(() => {
        let vivo = true;
        const cargas = FUENTES.map(f => (document.fonts?.load ? document.fonts.load(f).catch(() => null) : Promise.resolve()));
        Promise.race([Promise.all(cargas), new Promise(r => setTimeout(r, 5000))]).then(() => { if (vivo) setListas(true); });
        return () => { vivo = false; };
    }, []);
    return listas;
};

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'pieza';

const EditorPiezas = () => {
    const { user } = useAuth();
    const { pieza, cambiar, deshacer, rehacer, puedeDeshacer, puedeRehacer, recuperado } = useEditorPieza(user?.id);
    const imagenes = useImagenes(pieza.capas);
    const [seleccion, setSeleccion] = useState(null);
    const [editandoId, setEditandoId] = useState(null);
    const [enfocar, setEnfocar] = useState(null);
    const [modal, setModal] = useState(null); // 'producto' | { tipo: 'vitrina', destino }
    const lienzoRef = useRef(null);
    const archivoRef = useRef(null);
    const destinoFoto = useRef(null);

    useEffect(() => {
        if (recuperado) toast.info('Se recuperó la pieza que estabas armando.');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Si la capa elegida dejó de existir (deshacer, borrar), se suelta.
    useEffect(() => {
        if (seleccion && !pieza.capas.some(c => c.id === seleccion)) setSeleccion(null);
        if (editandoId && !pieza.capas.some(c => c.id === editandoId)) setEditandoId(null);
    }, [pieza, seleccion, editandoId]);

    const capaSel = pieza.capas.find(c => c.id === seleccion) || null;

    // ---------- cambios ----------
    const actualizarCapa = useCallback((id, cambios, { grupo, centro } = {}) => {
        cambiar(p => ({ ...p, capas: p.capas.map(c => (c.id !== id ? c : centro ? cambiarConCentro(c, cambios) : { ...c, ...cambios })) }), grupo);
    }, [cambiar]);

    const cambiarDesdeLienzo = useCallback((id, cambios) => actualizarCapa(id, cambios), [actualizarCapa]);

    const agregar = (tipo) => {
        const rol = TIPOS[tipo].rol;
        const libre = rol && !pieza.capas.some(c => c.rol === rol);
        const capa = crearCapa(tipo, pieza, libre ? { rol } : {});
        cambiar(p => ({ ...p, capas: [...p.capas, capa] }));
        setSeleccion(capa.id);
        if (ES_TEXTO.has(tipo)) setEditandoId(capa.id);
    };

    const moverOrden = (id, delta) => cambiar((p) => {
        const i = p.capas.findIndex(c => c.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= p.capas.length) return p;
        const capas = [...p.capas];
        const [c] = capas.splice(i, 1);
        capas.splice(j, 0, c);
        return { ...p, capas };
    });

    const reordenar = (desde, hasta) => cambiar((p) => {
        const capas = [...p.capas];
        const [c] = capas.splice(desde, 1);
        capas.splice(hasta, 0, c);
        return { ...p, capas };
    });

    const alternar = (id, campo) => cambiar(p => ({ ...p, capas: p.capas.map(c => (c.id === id ? { ...c, [campo]: !c[campo] } : c)) }));

    const accion = (nombre, id = seleccion) => {
        const capa = pieza.capas.find(c => c.id === id);
        if (!capa) return;
        if (nombre === 'duplicar') {
            const copia = duplicarCapa(capa);
            cambiar((p) => {
                const capas = [...p.capas];
                capas.splice(p.capas.findIndex(c => c.id === id) + 1, 0, copia);
                return { ...p, capas };
            });
            setSeleccion(copia.id);
        } else if (nombre === 'borrar') {
            cambiar(p => ({ ...p, capas: p.capas.filter(c => c.id !== id) }));
            setSeleccion(null);
            setEditandoId(null);
        } else if (nombre === 'adelante') moverOrden(id, 1);
        else if (nombre === 'atras') moverOrden(id, -1);
        else if (nombre === 'ocultar') alternar(id, 'oculta');
        else if (nombre === 'bloquear') alternar(id, 'bloqueada');
    };

    const rotar = (grados) => {
        if (!seleccion) return;
        cambiar(p => ({ ...p, capas: p.capas.map(c => (c.id === seleccion ? rotarCapa(c, grados) : c)) }));
    };

    // ---------- fotos ----------
    // Pone la foto en una capa existente (`destino`) o crea una capa nueva con la proporción de
    // la foto, centrada donde se soltó (o en la pieza).
    const ponerFoto = (destino, datos, img, punto) => {
        if (destino) {
            actualizarCapa(destino, { ...datos, faltaImagen: null, zoom: 1, encuadreX: 0.5, encuadreY: 0.5 });
            setSeleccion(destino);
            return;
        }
        const lim = limites(pieza);
        const maxW = (lim.x1 - lim.x0) * 0.7, maxH = (lim.y1 - lim.y0) * 0.6;
        const r = img?.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.75;
        let ancho = maxW, alto = ancho * r;
        if (alto > maxH) { alto = maxH; ancho = alto / r; }
        const libre = !pieza.capas.some(c => c.rol === 'imagen');
        const extra = { ...datos, ancho, alto, ...(libre ? { rol: 'imagen' } : {}) };
        if (punto) { extra.x = punto.x - ancho / 2; extra.y = punto.y - alto / 2; }
        const capa = crearCapa('imagen', pieza, extra);
        cambiar(p => ({ ...p, capas: [...p.capas, capa] }));
        setSeleccion(capa.id);
    };

    const pedirFotoPC = (destino) => {
        destinoFoto.current = destino;
        archivoRef.current?.click();
    };

    const alElegirArchivo = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const { src, img, nombre } = await abrirArchivoImagen(file);
            ponerFoto(destinoFoto.current, { src, origen: 'local', nombreArchivo: nombre }, img);
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Una foto soltada sobre una capa de imagen la reemplaza; si no, va en una capa nueva.
    const alSoltarArchivo = async (file, punto) => {
        const destino = punto && [...pieza.capas].reverse()
            .find(c => c.tipo === 'imagen' && !c.oculta && !c.bloqueada && puntoEnCapa(c, punto.x, punto.y));
        try {
            const { src, img, nombre } = await abrirArchivoImagen(file);
            ponerFoto(destino?.id || null, { src, origen: 'local', nombreArchivo: nombre }, img, punto);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const ajustarCaja = () => {
        const c = capaSel;
        const img = c && imagenes[c.src];
        if (!img) return;
        const r = img.naturalHeight / img.naturalWidth;
        const lim = limites(pieza);
        let ancho = c.ancho, alto = ancho * r;
        if (alto > lim.y1 - lim.y0) { alto = lim.y1 - lim.y0; ancho = alto / r; }
        if (ancho > lim.x1 - lim.x0) { ancho = lim.x1 - lim.x0; alto = ancho * r; }
        actualizarCapa(c.id, { ancho, alto, zoom: 1, encuadreX: 0.5, encuadreY: 0.5 }, { centro: true });
    };

    // ---------- doble clic ----------
    const dobleClic = useCallback((capa) => {
        setSeleccion(capa.id);
        if (ES_TEXTO.has(capa.tipo)) setEditandoId(capa.id);
        else if (capa.tipo === 'precio') setEnfocar({ id: capa.id, campo: 'monto', n: Date.now() });
        else if (capa.tipo === 'etiqueta') setEnfocar({ id: capa.id, campo: 'texto', n: Date.now() });
        else if (capa.tipo === 'imagen') pedirFotoPC(capa.id);
    }, []);

    const editarTexto = useCallback((id, texto) => actualizarCapa(id, { texto }, { grupo: `${id}:texto` }), [actualizarCapa]);
    const terminarEdicion = useCallback(() => setEditandoId(null), []);

    // ---------- pieza ----------
    const usarPlantilla = (p) => {
        cambiar(actual => ({ ...actual, capas: capasDePlantilla(p.id, actual) }));
        setSeleccion(null);
        setEditandoId(null);
        toast.success(`Plantilla «${p.nombre}» aplicada. Ctrl+Z para volver atrás.`);
    };

    const usarProducto = (datos) => {
        const { pieza: nueva, avisos } = aplicarProducto(pieza, datos);
        cambiar(() => nueva);
        setModal(null);
        setEditandoId(null);
        toast.success('La pieza tiene los datos del producto.');
        avisos.forEach(a => toast.info(a));
    };

    // ---------- PNG ----------
    const descargar = () => {
        setEditandoId(null);
        const capaTitulo = pieza.capas.find(c => c.rol === 'titulo') || pieza.capas.find(c => c.tipo === 'titulo');
        const nombre = `user-${pieza.formato}-${slug(capaTitulo?.texto)}.png`;
        if (pieza.capas.some(c => c.tipo === 'imagen' && !c.oculta && c.src && !imagenes[c.src])) {
            toast.warning('Hay una foto que no se pudo cargar: la pieza sale sin ella.');
        }
        // Después de que se cierre el cuadro de texto (si había uno abierto).
        setTimeout(() => {
            let canvas;
            try {
                canvas = lienzoRef.current.exportar();
            } catch {
                toast.error('No se pudo armar el PNG.');
                return;
            }
            try {
                canvas.toBlob((blob) => {
                    if (!blob) { toast.error('No se pudo armar el PNG.'); return; }
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = nombre;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 2000);
                }, 'image/png');
            } catch {
                // El navegador no deja exportar un canvas con fotos de otro sitio sin permiso.
                toast.error('Una de las fotos viene de otro sitio y el navegador no deja bajarla. Subila desde la PC.');
            }
        }, 0);
    };

    // ---------- teclado ----------
    useEffect(() => {
        const alTeclear = (e) => {
            if (modal) return;
            const t = e.target;
            const escribiendo = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
            const mod = e.ctrlKey || e.metaKey;
            const tecla = e.key.toLowerCase();
            if (escribiendo) return;
            if (mod && tecla === 'z') { e.preventDefault(); if (e.shiftKey) rehacer(); else deshacer(); return; }
            if (mod && tecla === 'y') { e.preventDefault(); rehacer(); return; }
            if (e.key === 'Escape') { setSeleccion(null); return; }
            const capa = pieza.capas.find(c => c.id === seleccion);
            if (!capa) return;
            if (mod && tecla === 'd') { e.preventDefault(); accion('duplicar', capa.id); return; }
            if (capa.bloqueada) return;
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); accion('borrar', capa.id); return; }
            const paso = e.shiftKey ? 10 : 1;
            const d = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[e.key];
            if (d) {
                e.preventDefault();
                cambiar(p => ({ ...p, capas: p.capas.map(c => (c.id === capa.id ? { ...c, x: c.x + d[0], y: c.y + d[1] } : c)) }), `teclas:${capa.id}`);
            }
        };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    });

    const { W, H } = dimensiones(pieza);
    const botonBarra = 'flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed';

    return (
        <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
            <div className="flex flex-wrap items-start gap-3 mb-5">
                <div className="flex-1 min-w-[240px]">
                    <h1 className="text-2xl font-black text-slate-800">Piezas para redes</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Posteos e historias con la identidad de user. Arrastrá los elementos, estiralos con las manijas y giralos con la de arriba.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={botonBarra} onClick={() => setModal('producto')}>
                        <PackageSearch size={16} className="text-brand-cyan" /> Elegir producto
                    </button>
                    <button type="button" className={botonBarra} onClick={deshacer} disabled={!puedeDeshacer} title="Deshacer (Ctrl+Z)">
                        <Undo2 size={16} className="text-brand-cyan" />
                    </button>
                    <button type="button" className={botonBarra} onClick={rehacer} disabled={!puedeRehacer} title="Rehacer (Ctrl+Y)">
                        <Redo2 size={16} className="text-brand-cyan" />
                    </button>
                    <button type="button" onClick={descargar}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-black hover:opacity-90">
                        <Download size={16} /> Descargar PNG
                    </button>
                </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
                <section className="min-w-0">
                    <div className="bg-slate-100 rounded-2xl p-3 sm:p-4">
                        <LienzoPieza
                            ref={lienzoRef}
                            pieza={pieza}
                            imagenes={imagenes}
                            seleccion={seleccion}
                            editandoId={editandoId}
                            onSeleccionar={setSeleccion}
                            onCambiarCapa={cambiarDesdeLienzo}
                            onDobleClic={dobleClic}
                            onEditarTexto={editarTexto}
                            onTerminarEdicion={terminarEdicion}
                            onSoltarArchivo={alSoltarArchivo}
                        />
                    </div>
                    <p className="mt-2 text-center text-[11px] text-slate-400 font-mono">
                        {W} × {H} px · RGB · {FORMATOS[pieza.formato]?.nombre.toLowerCase()} · para imprenta, los archivos CMYK oficiales
                    </p>
                </section>

                <aside className="space-y-4 lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto lg:pr-1 pb-2">
                    <Tarjeta titulo="Agregar">
                        <div className="grid grid-cols-3 gap-2">
                            {AGREGAR.map((tipo) => {
                                const Icono = ICONOS_CAPA[tipo];
                                return (
                                    <button key={tipo} type="button" onClick={() => agregar(tipo)}
                                        className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border border-slate-200 hover:border-brand-cyan hover:bg-sky-50 text-[11px] font-bold text-slate-600 text-center leading-tight">
                                        <Icono size={18} className="text-brand-cyan" />
                                        {TIPOS[tipo].nombre}
                                    </button>
                                );
                            })}
                        </div>
                    </Tarjeta>

                    <PanelCapa
                        capa={capaSel}
                        pieza={pieza}
                        imagenCargada={!!(capaSel?.tipo === 'imagen' && capaSel.src && imagenes[capaSel.src])}
                        enfocar={enfocar}
                        onCambiar={(cambios, op) => actualizarCapa(capaSel.id, cambios, op)}
                        onRotar={rotar}
                        onAccion={nombre => accion(nombre)}
                        onSubirFoto={() => pedirFotoPC(capaSel.id)}
                        onFotoVitrina={() => setModal({ tipo: 'vitrina', destino: capaSel.id })}
                        onAjustarCaja={ajustarCaja}
                    />

                    <ListaCapas
                        capas={pieza.capas}
                        seleccion={seleccion}
                        onSeleccionar={setSeleccion}
                        onReordenar={reordenar}
                        onAlternar={alternar}
                    />

                    <Tarjeta titulo="Pieza">
                        <div className="space-y-3.5">
                            <Segmentado
                                opciones={[{ id: 'feed', nombre: 'Posteo de feed' }, { id: 'historia', nombre: 'Historia' }]}
                                valor={pieza.formato}
                                onCambiar={f => cambiar(p => cambiarFormato(p, f))}
                            />
                            <Segmentado
                                opciones={[{ id: 'oscuro', nombre: 'Fondo oscuro' }, { id: 'tinta', nombre: 'Fondo de tinta' }]}
                                valor={pieza.fondo}
                                onCambiar={v => cambiar(p => ({ ...p, fondo: v }))}
                            />
                            <div className="flex items-center gap-3">
                                <span className="text-[11px] font-bold text-slate-500">Acento</span>
                                <PaletaTintas valor={pieza.acento} onCambiar={v => cambiar(p => ({ ...p, acento: v }))} />
                            </div>
                            <Interruptor activo={pieza.marco} onCambiar={v => cambiar(p => ({ ...p, marco: v }))} etiqueta="Recuadro (los elementos no salen de él)" />
                            <div className="pt-3 border-t border-slate-100">
                                <p className="text-[11px] font-bold text-slate-500 mb-2">Empezar de una plantilla</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {PLANTILLAS.map(p => (
                                        <button key={p.id} type="button" onClick={() => usarPlantilla(p)}
                                            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:border-slate-300">
                                            {p.nombre}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </Tarjeta>

                    <Tarjeta titulo="Atajos">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                            {ATAJOS.map(([t, d]) => (
                                <React.Fragment key={t}>
                                    <dt className="font-bold text-slate-600 whitespace-nowrap">{t}</dt>
                                    <dd className="text-slate-500">{d}</dd>
                                </React.Fragment>
                            ))}
                        </dl>
                    </Tarjeta>
                </aside>
            </div>

            <input ref={archivoRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={alElegirArchivo} />

            {modal === 'producto' && <ModalProducto onCerrar={() => setModal(null)} onElegir={usarProducto} />}
            {modal?.tipo === 'vitrina' && (
                <ModalFotoVitrina
                    onCerrar={() => setModal(null)}
                    onElegir={(src) => { ponerFoto(modal.destino, { src, origen: 'vitrina', nombreArchivo: '' }); setModal(null); }}
                />
            )}
        </div>
    );
};

const MarketingPiezasPage = () => {
    const listas = useFuentesListas();
    if (!listas) {
        return (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-24 justify-center">
                <Loader2 size={18} className="animate-spin" /> Cargando las fuentes de la marca...
            </div>
        );
    }
    return <EditorPiezas />;
};

export default MarketingPiezasPage;
