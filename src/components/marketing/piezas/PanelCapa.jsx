import React, { useEffect, useRef } from 'react';
import {
    Copy, Trash2, Eye, EyeOff, Lock, LockOpen, BringToFront, SendToBack, RotateCcw,
    AlignLeft, AlignCenter, AlignRight, Upload, Store, Maximize2,
} from 'lucide-react';
import { Tarjeta, Campo, claseInput, Segmentado, Paleta, Interruptor, Numero, Deslizador } from './controles';
import { TIPOS, ES_TEXTO } from './capas';

// Propiedades de la capa elegida. Los cambios de texto se juntan en un solo paso de deshacer.

const ALINEACIONES = [
    { id: 'left', nombre: '', titulo: 'A la izquierda', icono: AlignLeft },
    { id: 'center', nombre: '', titulo: 'Centrado', icono: AlignCenter },
    { id: 'right', nombre: '', titulo: 'A la derecha', icono: AlignRight },
];

const PESOS = [
    { id: '300', nombre: 'Light' },
    { id: '400', nombre: 'Regular' },
    { id: '700', nombre: 'Bold' },
];

const FORMAS = [
    { id: 'marca', nombre: 'Marca', titulo: 'Dos esquinas grandes arriba, como en el manual' },
    { id: 'redondeada', nombre: 'Redondeada' },
    { id: 'circulo', nombre: 'Círculo' },
    { id: 'recta', nombre: 'Recta' },
];

const Boton = ({ titulo, onClick, children, peligro = false, activo = false }) => (
    <button
        type="button"
        title={titulo}
        aria-label={titulo}
        onClick={onClick}
        className={`w-8 h-8 rounded-lg flex items-center justify-center border ${activo ? 'border-brand-cyan bg-sky-50 text-brand-cyan' : 'border-slate-200 text-slate-500'} ${peligro ? 'hover:text-rose-600 hover:border-rose-200' : 'hover:text-brand-cyan hover:border-slate-300'}`}
    >
        {children}
    </button>
);

const PanelCapa = ({ capa, pieza, imagenCargada, enfocar, onCambiar, onRotar, onAccion, onSubirFoto, onFotoVitrina, onAjustarCaja }) => {
    const refs = { texto: useRef(null), monto: useRef(null) };
    useEffect(() => {
        if (!enfocar || enfocar.id !== capa?.id) return;
        const el = refs[enfocar.campo]?.current;
        if (el) { el.focus(); el.select?.(); }
    }, [enfocar]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!capa) {
        return (
            <Tarjeta titulo="Capa">
                <p className="text-sm text-slate-400">
                    Tocá un elemento de la pieza para editarlo, o agregá uno nuevo. Doble clic sobre un texto para escribir ahí mismo.
                </p>
            </Tarjeta>
        );
    }

    const c = capa;
    const texto = (campo, valor) => onCambiar({ [campo]: valor }, { grupo: `${c.id}:${campo}` });
    const conCentro = (cambios) => onCambiar(cambios, { centro: true });

    return (
        <Tarjeta
            titulo={TIPOS[c.tipo]?.nombre || 'Capa'}
            acciones={(
                <div className="flex gap-1">
                    <Boton titulo="Duplicar (Ctrl+D)" onClick={() => onAccion('duplicar')}><Copy size={14} /></Boton>
                    <Boton titulo="Traer adelante" onClick={() => onAccion('adelante')}><BringToFront size={14} /></Boton>
                    <Boton titulo="Llevar atrás" onClick={() => onAccion('atras')}><SendToBack size={14} /></Boton>
                    <Boton titulo={c.oculta ? 'Mostrar' : 'Ocultar'} activo={c.oculta} onClick={() => onAccion('ocultar')}>{c.oculta ? <EyeOff size={14} /> : <Eye size={14} />}</Boton>
                    <Boton titulo={c.bloqueada ? 'Desbloquear' : 'Bloquear (no se mueve)'} activo={c.bloqueada} onClick={() => onAccion('bloquear')}>{c.bloqueada ? <Lock size={14} /> : <LockOpen size={14} />}</Boton>
                    <Boton titulo="Borrar (Supr)" peligro onClick={() => onAccion('borrar')}><Trash2 size={14} /></Boton>
                </div>
            )}
        >
            <div className="space-y-3.5">
                {ES_TEXTO.has(c.tipo) && (
                    <Campo etiqueta={c.tipo === 'dato' ? 'Dato (en Roboto Mono, la letra de las medidas)' : 'Texto'}>
                        <textarea
                            ref={refs.texto}
                            value={c.texto ?? ''}
                            rows={c.tipo === 'texto' ? 3 : 2}
                            onChange={e => texto('texto', e.target.value)}
                            className={`${claseInput} resize-y`}
                        />
                    </Campo>
                )}

                {c.tipo === 'etiqueta' && (
                    <Campo etiqueta="Texto">
                        <input ref={refs.texto} value={c.texto ?? ''} maxLength={40}
                            onChange={e => onCambiar({ texto: e.target.value }, { grupo: `${c.id}:texto`, centro: true })}
                            className={claseInput} />
                    </Campo>
                )}

                {c.tipo === 'precio' && (
                    <div className="grid grid-cols-[90px_1fr] gap-2">
                        <Campo etiqueta="Moneda">
                            <input value={c.moneda ?? ''} maxLength={6}
                                onChange={e => onCambiar({ moneda: e.target.value }, { grupo: `${c.id}:moneda`, centro: true })}
                                className={claseInput} />
                        </Campo>
                        <Campo etiqueta="Monto">
                            <input ref={refs.monto} value={c.monto ?? ''} maxLength={14}
                                onChange={e => onCambiar({ monto: e.target.value }, { grupo: `${c.id}:monto`, centro: true })}
                                className={`${claseInput} tabular-nums`} />
                        </Campo>
                    </div>
                )}

                {(ES_TEXTO.has(c.tipo) || c.tipo === 'precio' || c.tipo === 'etiqueta') && (
                    <div className="grid grid-cols-2 gap-2 items-end">
                        <Campo etiqueta="Tamaño de letra">
                            <Numero valor={c.tamano} min={8} max={600} sufijo="px" onCambiar={v => onCambiar({ tamano: v }, { centro: !ES_TEXTO.has(c.tipo) })} />
                        </Campo>
                        {ES_TEXTO.has(c.tipo) && (
                            <Campo etiqueta="Alineación">
                                <Segmentado opciones={ALINEACIONES} valor={c.alineacion || 'center'} onCambiar={v => onCambiar({ alineacion: v })} />
                            </Campo>
                        )}
                    </div>
                )}

                {c.tipo === 'texto' && (
                    <div className="flex flex-wrap items-center gap-3">
                        <Segmentado opciones={PESOS} valor={c.peso || '400'} onCambiar={v => onCambiar({ peso: v })} />
                        <Interruptor activo={!!c.mayusculas} onCambiar={v => onCambiar({ mayusculas: v })} etiqueta="Mayúsculas" />
                    </div>
                )}

                {c.tipo === 'dato' && (
                    <Interruptor activo={!!c.corchetes} onCambiar={v => onCambiar({ corchetes: v })} etiqueta="Entre < >, como en el manual" />
                )}

                {(ES_TEXTO.has(c.tipo) || ['precio', 'etiqueta', 'asterisco', 'logo'].includes(c.tipo)) && (
                    <Campo etiqueta={c.tipo === 'etiqueta' ? 'Color del texto' : 'Color'}>
                        <Paleta valor={c.color || 'auto'} pieza={pieza} onCambiar={v => onCambiar({ color: v })} />
                    </Campo>
                )}

                {c.tipo === 'etiqueta' && (
                    <Campo etiqueta="Color del borde">
                        <Paleta valor={c.colorBorde || 'acento'} pieza={pieza} onCambiar={v => onCambiar({ colorBorde: v })} />
                    </Campo>
                )}

                {c.tipo === 'logo' && (
                    <>
                        <Campo etiqueta="Versión">
                            <Segmentado
                                opciones={[{ id: 'isotipo', nombre: 'Isotipo' }, { id: 'logotipo', nombre: 'Logotipo' }]}
                                valor={c.version || 'isotipo'}
                                onCambiar={v => {
                                    // Al cambiar de versión se mantiene el alto aproximado.
                                    const ancho = v === 'logotipo' ? c.ancho * (240.08 / 96.75) / (52.39 / 76.78) : c.ancho / ((240.08 / 96.75) / (52.39 / 76.78));
                                    conCentro({ version: v, ancho });
                                }}
                            />
                        </Campo>
                        {c.version === 'logotipo' && (
                            <p className="text-xs text-slate-400">En «Automático» va en color sobre el fondo oscuro y en negro sobre la tinta, donde la barra de color no se lee.</p>
                        )}
                        <Campo etiqueta="Ancho">
                            <Numero valor={c.ancho} min={12} max={1000} sufijo="px" onCambiar={v => conCentro({ ancho: v })} />
                        </Campo>
                    </>
                )}

                {c.tipo === 'asterisco' && (
                    <Campo etiqueta="Tamaño">
                        <Numero valor={c.ancho} min={12} max={1000} sufijo="px" onCambiar={v => conCentro({ ancho: v })} />
                    </Campo>
                )}

                {c.tipo === 'barra' && (
                    <div className="grid grid-cols-2 gap-2">
                        <Campo etiqueta="Largo"><Numero valor={c.ancho} min={40} max={1000} sufijo="px" onCambiar={v => conCentro({ ancho: v })} /></Campo>
                        <Campo etiqueta="Alto"><Numero valor={c.alto} min={8} max={300} sufijo="px" onCambiar={v => conCentro({ alto: v })} /></Campo>
                    </div>
                )}

                {c.tipo === 'imagen' && (
                    <>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={onSubirFoto}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:border-slate-300">
                                <Upload size={14} className="text-brand-cyan" /> Subir desde la PC
                            </button>
                            <button type="button" onClick={onFotoVitrina}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:border-slate-300">
                                <Store size={14} className="text-brand-cyan" /> Foto de la vitrina
                            </button>
                            {imagenCargada && (
                                <button type="button" onClick={onAjustarCaja} title="La caja toma la proporción de la foto, sin recortarla"
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:border-slate-300">
                                    <Maximize2 size={14} className="text-brand-cyan" /> Caja a la medida de la foto
                                </button>
                            )}
                        </div>
                        {c.faltaImagen && <p className="text-xs text-amber-700">La foto «{c.faltaImagen}» era de la PC y no queda guardada en el borrador: subila de nuevo.</p>}
                        <p className="text-xs text-slate-400">También podés arrastrar una foto de la PC sobre esta capa.</p>
                        <Campo etiqueta="Forma">
                            <Segmentado opciones={FORMAS} valor={c.forma || 'marca'} onCambiar={v => onCambiar({ forma: v })} />
                        </Campo>
                        <Interruptor activo={!!c.borde} onCambiar={v => onCambiar({ borde: v })} etiqueta="Borde fino" />
                        <div className="grid grid-cols-2 gap-2">
                            <Campo etiqueta="Ancho"><Numero valor={c.ancho} min={40} max={2000} sufijo="px" onCambiar={v => conCentro({ ancho: v })} /></Campo>
                            <Campo etiqueta="Alto"><Numero valor={c.alto} min={40} max={2000} sufijo="px" onCambiar={v => conCentro({ alto: v })} /></Campo>
                        </div>
                        <Campo etiqueta={`Zoom de la foto · ${Math.round((c.zoom || 1) * 100)} %`}>
                            <Deslizador valor={c.zoom || 1} min={1} max={4} paso={0.01} onCambiar={v => onCambiar({ zoom: v }, { grupo: `${c.id}:zoom` })} />
                        </Campo>
                        <div className="grid grid-cols-2 gap-3">
                            <Campo etiqueta="Encuadre horizontal">
                                <Deslizador valor={c.encuadreX ?? 0.5} min={0} max={1} paso={0.01} onCambiar={v => onCambiar({ encuadreX: v }, { grupo: `${c.id}:ex` })} />
                            </Campo>
                            <Campo etiqueta="Encuadre vertical">
                                <Deslizador valor={c.encuadreY ?? 0.5} min={0} max={1} paso={0.01} onCambiar={v => onCambiar({ encuadreY: v }, { grupo: `${c.id}:ey` })} />
                            </Campo>
                        </div>
                    </>
                )}

                <div className="grid grid-cols-[1fr_auto] gap-2 items-end pt-1 border-t border-slate-100">
                    <Campo etiqueta="Giro (con Shift, de a 15°)" className="pt-3">
                        <Numero valor={c.rotacion || 0} min={-360} max={360} sufijo="°" decimales={1} onCambiar={onRotar} />
                    </Campo>
                    <button type="button" onClick={() => onRotar(0)} title="Volver a 0°"
                        className="h-[38px] px-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:border-slate-300 flex items-center gap-1.5">
                        <RotateCcw size={14} className="text-brand-cyan" /> 0°
                    </button>
                </div>
            </div>
        </Tarjeta>
    );
};

export default PanelCapa;
