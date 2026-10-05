// ═════════════════════════════════════════════════════════════════════════
//  [PASO A PASO] Costuras de la ficha de diseño como secuencia de confección (05/10)
//  Cada paso: etapa · operación · costura ISO · máquina · qué piezas une · tiempo ·
//  observaciones · imagen (la de la costura del catálogo, o una foto propia del paso).
//  Datos: dbo.ProductoFichaDisenoCosturas (+ docs/migrations/configurador_costuras_paso_a_paso.sql).
// ═════════════════════════════════════════════════════════════════════════
import React, { useState, useId } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import Selector from '../ui/Selector';
import { ArrowUp, ArrowDown, X, Upload, TriangleAlert } from 'lucide-react';

const API = '/configurador';

// La etapa es texto libre (la escribe quien arma la ficha); los pasos seguidos con la misma etapa se agrupan.
export const pasoVacio = () => ({ etapa: '', union: '', iso: '', maquinaId: '', descripcion: '', tiempoMin: '', observaciones: '', imagenUrl: '' });

// Pasos de ejemplo para arrancar. Los tiempos son de referencia (minutos por prenda): ajustarlos al taller.
// La máquina va por nombre (dbo.MaquinasCostura) y se traduce al ID al cargar la plantilla.
const P = (etapa, union, iso, maquina, descripcion, tiempoMin, observaciones = '') => ({ etapa, union, iso, maquina, descripcion, tiempoMin, observaciones });
export const PLANTILLAS_COSTURA = [
    {
        id: 'remera', nombre: 'Remera / camiseta cuello redondo', pasos: [
            P('Preparación', 'Pegar etiqueta', 'ISO 301', 'Recta 1 aguja', 'Etiqueta de marca y talle + espalda (centro del escote)', 0.25, 'Centrada, a 2 cm del escote'),
            P('Armado', 'Unir hombros', 'ISO 514', 'Overlock 4 hilos', 'Delantero + espalda, por los hombros', 0.30, 'Con cinta de refuerzo en el hombro'),
            P('Armado', 'Cerrar tira de cuello', 'ISO 301', 'Recta 1 aguja', 'Tira de cuello, punta con punta (queda en aro)', 0.15),
            P('Armado', 'Pegar cuello', 'ISO 514', 'Overlock 4 hilos', 'Tira de cuello + escote', 0.45, 'Repartir la tira en 4 cuartos para que el cuello no quede ondulado'),
            P('Armado', 'Recubrir cuello', 'ISO 406', 'Recubridora (collareta)', 'Costura del cuello (tapacostura por la espalda)', 0.40),
            P('Armado', 'Pegar mangas', 'ISO 514', 'Overlock 4 hilos', 'Mangas + sisa del cuerpo', 0.70, 'Hacer coincidir el piquete de la manga con el hombro'),
            P('Armado', 'Cerrar costados y mangas', 'ISO 514', 'Overlock 4 hilos', 'Delantero + espalda por los costados, del puño al ruedo', 0.80, 'Coincidir la costura de la sisa'),
            P('Terminación', 'Ruedo de mangas', 'ISO 406', 'Recubridora (collareta)', 'Bocamanga (doblez de 2 cm)', 0.50),
            P('Terminación', 'Ruedo del cuerpo', 'ISO 406', 'Recubridora (collareta)', 'Bajo de la prenda (doblez de 2,5 cm)', 0.50),
            P('Control y planchado', 'Cortar hilos y control de calidad', '', 'Manual (mesa)', 'Prenda terminada', 0.40, 'Revisar medidas por talle y que no haya costuras abiertas'),
            P('Control y planchado', 'Planchado y doblado', '', 'Plancha', 'Prenda terminada', 0.50),
        ],
    },
    {
        // Molde TizadaPro "Camiseta Goes 2026" (modelo básquet): frente, espalda, 2 costadillos, cuello, tapacostura, 2 sisas.
        // Solo los pasos con costura (sin preparación ni empaquetado).
        id: 'basquet', nombre: 'Camiseta de básquet (musculosa con costadillos)', pasos: [
            P('Armado', 'Unir hombros', 'ISO 514', 'Overlock 4 hilos', 'Frente + espalda, por los hombros', 0.30),
            P('Armado', 'Pegar costadillos al frente', 'ISO 514', 'Overlock 4 hilos', 'Costadillo derecho + frente y costadillo izquierdo + frente (2 costuras)', 0.60, 'Hacer coincidir los piquetes; el costadillo arranca debajo de la sisa'),
            P('Armado', 'Cerrar costados con la espalda', 'ISO 514', 'Overlock 4 hilos', 'Costadillos + espalda, de la sisa al ruedo (2 costuras)', 0.60, 'Las dos uniones de la sisa a la misma altura. Meter la etiqueta de composición en el costado izquierdo, a 10 cm del ruedo'),
            P('Armado', 'Recubrir costuras de costadillos', 'ISO 602', 'Recubridora (collareta)', 'Las 4 costuras de los costadillos (pespunte visto por el derecho)', 0.90, 'Solo si el diseño lleva la costura vista; si no, borrar este paso'),
            P('Terminación', 'Cerrar cuello en aro', 'ISO 301', 'Recta 1 aguja', 'Pieza Cuello, punta con punta', 0.15),
            P('Terminación', 'Pegar cuello', 'ISO 514', 'Overlock 4 hilos', 'Cuello doblado al medio + escote de frente y espalda', 0.45, 'Repartir el cuello en 4 cuartos; la unión del aro va al centro de la espalda. Meter las etiquetas de marca y talle en el centro de la espalda'),
            P('Terminación', 'Pegar tapacostura en la espalda', 'ISO 406', 'Recubridora (collareta)', 'Tapacostura sobre la costura del cuello, de hombro a hombro por la espalda', 0.40, 'Tapa el overlock del cuello y fija las etiquetas'),
            P('Terminación', 'Recubrir cuello por el frente', 'ISO 406', 'Recubridora (collareta)', 'Costura del cuello, de hombro a hombro por el frente', 0.30),
            P('Terminación', 'Cerrar tiras de sisa en aro', 'ISO 301', 'Recta 1 aguja', 'Sisa derecha y sisa izquierda, punta con punta', 0.20),
            P('Terminación', 'Pegar ribete de sisas', 'ISO 514', 'Overlock 4 hilos', 'Tiras de sisa dobladas al medio + sisas del cuerpo', 0.80, 'La unión del aro va en la costura del costado; estirar apenas la tira en la parte de abajo de la sisa para que no quede abierta'),
            P('Terminación', 'Recubrir sisas', 'ISO 406', 'Recubridora (collareta)', 'Costura de las dos sisas (pespunte por el cuerpo)', 0.60),
            P('Terminación', 'Ruedo', 'ISO 406', 'Recubridora (collareta)', 'Bajo de frente, costadillos y espalda (doblez de 2,5 cm)', 0.55, 'Coincidir las costuras de los costados al doblar'),
        ],
    },
    {
        id: 'short', nombre: 'Short deportivo con elástico', pasos: [
            P('Preparación', 'Pegar etiqueta', 'ISO 301', 'Recta 1 aguja', 'Etiqueta + trasero (centro de la cintura)', 0.25),
            P('Armado', 'Unir tiro delantero', 'ISO 514', 'Overlock 4 hilos', 'Delantero izquierdo + delantero derecho', 0.30),
            P('Armado', 'Unir tiro trasero', 'ISO 514', 'Overlock 4 hilos', 'Trasero izquierdo + trasero derecho', 0.30),
            P('Armado', 'Cerrar costados', 'ISO 514', 'Overlock 4 hilos', 'Delantero + trasero, por los costados', 0.60),
            P('Armado', 'Cerrar entrepierna', 'ISO 514', 'Overlock 4 hilos', 'Entrepierna delantera + trasera', 0.45, 'Coincidir los tiros en el centro'),
            P('Armado', 'Cerrar elástico', 'ISO 301', 'Recta 1 aguja', 'Elástico de cintura, punta con punta', 0.20),
            P('Armado', 'Pegar elástico a la cintura', 'ISO 406', 'Recubridora (collareta)', 'Elástico + cintura (doblez cubriendo el elástico)', 0.70, 'Repartir el elástico en 4 cuartos'),
            P('Terminación', 'Ruedo de piernas', 'ISO 406', 'Recubridora (collareta)', 'Bajo de cada pierna (doblez de 2 cm)', 0.50),
            P('Control y planchado', 'Cortar hilos y control de calidad', '', 'Manual (mesa)', 'Prenda terminada', 0.30),
            P('Control y planchado', 'Doblado y embolsado', '', 'Manual (mesa)', 'Prenda terminada', 0.20),
        ],
    },
    {
        // Windflag pluma/gota: la bandera llega impresa (Directa) y cortada al contorno (Corte); Costura le pone la
        // vaina del mástil por el lado recto y la curva de arriba, cierra la punta y termina los bordes libres.
        id: 'windflag', nombre: 'Windflag (bandera pluma / gota)', pasos: [
            P('Preparación de la vaina', 'Control de la pieza impresa', '', 'Manual (mesa)', 'Bandera impresa y cortada (llega de Corte)', 0.50, 'Verificar medida, impresión completa y cuál es la cara impresa; si es doble faz, que las dos caras coincidan'),
            P('Preparación de la vaina', 'Cortar la tira de vaina', '', 'Manual (mesa)', 'Tira de poliéster 600D (negro o blanco): largo = lado del mástil + curva de arriba + 5 cm', 1.00, 'Ancho de la tira aprox. 9 cm: doblada deja un túnel de ~3,5 cm para el mástil'),
            P('Preparación de la vaina', 'Formar el túnel de la vaina', 'ISO 301', 'Recta 1 aguja', 'Tira de vaina doblada al medio, a lo largo', 1.20, 'Pespunte a 1 cm del borde abierto; quedan dos solapas libres para meter la bandera'),
            P('Armado', 'Cerrar la punta de la vaina', 'ISO 301', 'Recta 1 aguja', 'Extremo de arriba de la vaina (punta de la curva)', 0.40, 'Costura doble + doblez de refuerzo: la punta del mástil empuja ahí y no la tiene que perforar'),
            P('Armado', 'Pegar la vaina a la bandera', 'ISO 304', 'Zigzag', 'Lado del mástil y curva de arriba de la bandera, metidos entre las dos solapas de la vaina', 3.50, 'Meter la tela de a 20–30 cm siguiendo la curva, sin arrugas ni frunces; la vaina no tiene que tapar la impresión'),
            P('Armado', 'Atraques en los extremos', 'ISO 304', 'Atracadora', 'Inicio y final de la costura de la vaina', 0.30),
            P('Terminación', 'Dobladillo de los bordes libres', 'ISO 301', 'Recta 2 agujas', 'Borde de vuelo y borde de abajo (los lados sin vaina)', 2.50, 'Doblez de 1 cm hacia el revés; en las curvas coser despacio para que no frunza'),
            P('Terminación', 'Coser el cordón de tensión', 'ISO 301', 'Recta 1 aguja', 'Cordón elástico + punta de abajo del vuelo', 0.40, 'Es el que tensa la bandera contra la base; rematar con 3 pasadas'),
            P('Control y embolsado', 'Cortar hilos y control', '', 'Manual (mesa)', 'Bandera terminada', 0.60, 'Probar con un mástil que entre hasta la punta; revisar que no haya puntadas saltadas'),
            P('Control y embolsado', 'Doblado y embolsado', '', 'Manual (mesa)', 'Bandera terminada', 0.30, 'Si lleva estructura, el mástil y la base se juntan en Producción (PRO) antes de Depósito'),
        ],
    },
];

const claseCampoFila = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200';
const claseSel = 'flex items-center gap-1.5 bg-white text-left text-slate-700 outline-none transition-colors hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-200 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm';
const claseEtiqueta = 'block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-0.5';

export const totalMinutos = (pasos) => pasos.reduce((s, p) => s + (Number(p.tiempoMin) || 0), 0);

// Editor de la lista de pasos (va dentro de la ficha de diseño del producto)
export function PasosCosturaEditor({ pasos, onChange, costurasIso, maquinas, pasoAPaso }) {
    const [subiendo, setSubiendo] = useState(null);   // índice del paso que está subiendo foto
    const isoDe = (cod) => costurasIso.find(o => o.CodigoISO === cod);
    const set = (i, patch) => onChange(pasos.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const mover = (i, d) => { const n = [...pasos]; const k = i + d; if (k < 0 || k >= n.length) return; [n[i], n[k]] = [n[k], n[i]]; onChange(n); };
    // Al elegir la costura se propone su máquina típica, salvo que el paso ya tenga otra elegida a mano
    const elegirIso = (i, cod) => {
        const p = pasos[i];
        const maqAnterior = isoDe(p.iso)?.MaquinaCosturaID;
        const maqNueva = isoDe(cod)?.MaquinaCosturaID;
        const tocarMaq = maqNueva && (!p.maquinaId || String(p.maquinaId) === String(maqAnterior || ''));
        set(i, { iso: cod, ...(tocarMaq ? { maquinaId: maqNueva } : {}) });
    };
    const subirFoto = async (i, file) => {
        if (!file) return;
        setSubiendo(i);
        try {
            const fd = new FormData(); fd.append('imagen', file);
            const { data } = await api.post(`${API}/ficha-diseno/imagen-paso`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            set(i, { imagenUrl: data.imagenUrl });
            toast.success(`✅ Foto cargada en el paso ${i + 1}. Se guarda con "Guardar".`);
        } catch (e) { toast.error('Error subiendo la foto: ' + (e.response?.data?.error || e.message)); }
        finally { setSubiendo(null); }
    };
    const cargarPlantilla = (id) => {
        const pl = PLANTILLAS_COSTURA.find(x => x.id === id); if (!pl) return;
        if (pasos.length && !window.confirm(`Cargar el ejemplo "${pl.nombre}" REEMPLAZA los ${pasos.length} pasos de esta lista. ¿Seguir?`)) return;
        const maqId = (nombre) => maquinas.find(m => m.Nombre === nombre)?.MaquinaCosturaID || '';
        onChange(pl.pasos.map(p => ({ ...pasoVacio(), ...p, iso: costurasIso.some(o => o.CodigoISO === p.iso) ? p.iso : '', maquinaId: maqId(p.maquina), tiempoMin: String(p.tiempoMin) })));
        toast.success(`Ejemplo "${pl.nombre}" cargado: ${pl.pasos.length} pasos. Revisá tiempos y piezas, y guardá.`);
    };
    const total = totalMinutos(pasos);
    // Sugerencias para el campo Etapa: las que ya se escribieron en este producto
    const idEtapas = useId();
    const etapasUsadas = [...new Set(pasos.map(p => (p.etapa || '').trim()).filter(Boolean))];

    return (
        <div className="space-y-2">
            <datalist id={idEtapas}>{etapasUsadas.map(e => <option key={e} value={e} />)}</datalist>
            {!pasoAPaso && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>Falta correr <b>docs/migrations/configurador_costuras_paso_a_paso.sql</b> en esta base. Hasta entonces solo se guardan la <b>operación</b> y la <b>costura ISO</b> de cada paso; etapa, máquina, piezas, tiempo, observaciones y foto se pierden al guardar.</span>
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                    {pasos.length} {pasos.length === 1 ? 'paso' : 'pasos'}
                    {total > 0 && <> · <b className="text-slate-700">{total.toFixed(2)} min</b> por prenda</>}
                </span>
                <Selector value="" onChange={e => cargarPlantilla(e.target.value)} title="Reemplaza la lista por los pasos de una prenda de ejemplo"
                    claseBoton="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50" anchoLista={300}>
                    <option value="">Cargar pasos de ejemplo…</option>
                    {PLANTILLAS_COSTURA.map(pl => <option key={pl.id} value={pl.id} descripcion={`${pl.pasos.length} pasos · reemplaza la lista actual`}>{pl.nombre}</option>)}
                </Selector>
            </div>

            {pasos.map((p, i) => {
                const iso = isoDe(p.iso);
                const img = p.imagenUrl || iso?.ImagenUrl || '';
                const nuevaEtapa = i === 0 || pasos[i - 1].etapa !== p.etapa;
                return (
                    <React.Fragment key={i}>
                        {nuevaEtapa && p.etapa && <div className="pt-1 text-[10px] font-black uppercase tracking-wider text-slate-400">{p.etapa}</div>}
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="flex flex-col gap-3 md:flex-row">
                                <div className="min-w-0 flex-1 space-y-2">
                                    <div className="flex flex-wrap items-end gap-2">
                                        <span className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-black text-white" title={`Paso ${i + 1}`}>{i + 1}</span>
                                        <label className="w-48">
                                            <span className={claseEtiqueta}>Etapa</span>
                                            <input value={p.etapa || ''} list={idEtapas} maxLength={60} placeholder="Ej. Armado"
                                                title="Texto libre. Los pasos seguidos con la misma etapa se agrupan bajo ese título."
                                                onChange={e => set(i, { etapa: e.target.value })} className={`w-full ${claseCampoFila}`} />
                                        </label>
                                        <label className="min-w-[200px] flex-1">
                                            <span className={claseEtiqueta}>Operación</span>
                                            <input value={p.union} placeholder="Ej. Unir hombros" onChange={e => set(i, { union: e.target.value })}
                                                className={`w-full font-bold ${claseCampoFila} ${p.union.trim() ? '' : 'border-amber-300'}`} />
                                        </label>
                                        <div className="mb-0.5 flex items-center">
                                            <button type="button" title="Subir el paso" disabled={i === 0} onClick={() => mover(i, -1)} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp size={15} /></button>
                                            <button type="button" title="Bajar el paso" disabled={i === pasos.length - 1} onClick={() => mover(i, 1)} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown size={15} /></button>
                                            <button type="button" title={`Quitar el paso ${i + 1}`} onClick={() => onChange(pasos.filter((_, j) => j !== i))} className="rounded p-1 text-red-400 hover:text-red-600"><X size={16} /></button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_110px]">
                                        <label>
                                            <span className={claseEtiqueta}>Costura (ISO 4915)</span>
                                            <Selector value={p.iso || ''} onChange={e => elegirIso(i, e.target.value)} claseBoton={`w-full ${claseSel}`} anchoLista={340}>
                                                <option value="" descripcion="Planchado, control, cortar hilos, dar vuelta…">Sin costura (operación manual)</option>
                                                {costurasIso.filter(o => o.Activo !== false || o.CodigoISO === p.iso).map(o => <option key={o.CosturaISOID} value={o.CodigoISO} descripcion={o.Descripcion || undefined}>{o.CodigoISO} — {o.Nombre}</option>)}
                                            </Selector>
                                        </label>
                                        <label>
                                            <span className={claseEtiqueta}>Máquina</span>
                                            <Selector value={p.maquinaId ? String(p.maquinaId) : ''} onChange={e => set(i, { maquinaId: e.target.value })} claseBoton={`w-full ${claseSel}`} anchoLista={300}>
                                                <option value="">{maquinas.length ? 'Sin máquina' : 'Sin catálogo de máquinas'}</option>
                                                {maquinas.filter(m => m.Activo !== false || String(m.MaquinaCosturaID) === String(p.maquinaId)).map(m => <option key={m.MaquinaCosturaID} value={String(m.MaquinaCosturaID)} descripcion={m.Descripcion || undefined}>{m.Nombre}</option>)}
                                            </Selector>
                                        </label>
                                        <label>
                                            <span className={claseEtiqueta}>Tiempo (min)</span>
                                            <input type="number" min="0" step="0.05" value={p.tiempoMin} placeholder="0,50" title="Minutos por prenda"
                                                onChange={e => set(i, { tiempoMin: e.target.value })} className={`w-full text-center font-bold ${claseCampoFila}`} />
                                        </label>
                                    </div>
                                    <label className="block">
                                        <span className={claseEtiqueta}>Qué piezas une</span>
                                        <input value={p.descripcion} placeholder="Ej. Delantero + espalda, por los hombros" onChange={e => set(i, { descripcion: e.target.value })} className={`w-full ${claseCampoFila}`} />
                                    </label>
                                    <label className="block">
                                        <span className={claseEtiqueta}>Observaciones</span>
                                        <input value={p.observaciones} placeholder="Ej. Hacer coincidir el piquete de la manga con el hombro" onChange={e => set(i, { observaciones: e.target.value })} className={`w-full ${claseCampoFila}`} />
                                    </label>
                                </div>

                                {/* Imagen: la foto propia del paso, o el esquema de la costura del catálogo */}
                                <div className="flex w-full shrink-0 flex-col items-center gap-1.5 md:w-48">
                                    <span className={`${claseEtiqueta} self-start`}>Imagen</span>
                                    {img ? (
                                        <a href={img} target="_blank" rel="noreferrer" title="Ver la imagen grande" className="block w-full">
                                            <img src={img} alt={p.iso ? `Costura ${p.iso}` : 'Foto del paso'} className="h-28 w-full rounded-lg border border-slate-200 bg-white object-contain" />
                                        </a>
                                    ) : (
                                        <div className="flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-center text-[11px] text-slate-400">Sin imagen</div>
                                    )}
                                    <span className="text-[10px] text-slate-400">{p.imagenUrl ? 'Foto propia de este paso' : iso?.ImagenUrl ? `Esquema de la costura ${p.iso}` : ''}</span>
                                    <div className="flex flex-wrap justify-center gap-1">
                                        <label className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 ${!pasoAPaso || subiendo === i ? 'pointer-events-none opacity-50' : ''}`}
                                            title={pasoAPaso ? 'Subir una foto de cómo se hace o cómo queda este paso (reemplaza al esquema de la costura solo en este paso)' : 'Falta correr el SQL de paso a paso'}>
                                            <Upload size={12} aria-hidden="true" />{subiendo === i ? 'Subiendo…' : p.imagenUrl ? 'Cambiar foto' : 'Subir foto del paso'}
                                            <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; subirFoto(i, f); }} />
                                        </label>
                                        {p.imagenUrl && (
                                            <button type="button" onClick={() => set(i, { imagenUrl: '' })} title="Quita la foto propia y vuelve a mostrar el esquema de la costura"
                                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-50">Quitar foto</button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </React.Fragment>
                );
            })}

            <button type="button" onClick={() => onChange([...pasos, { ...pasoVacio(), etapa: pasos[pasos.length - 1]?.etapa || '' }])}
                className="border border-dashed border-slate-300 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:border-slate-400 w-full">
                + Agregar paso
            </button>
        </div>
    );
}

// Tabla de pasos para la vista imprimible de la ficha técnica
export function TablaPasosCostura({ pasos, costurasIso, maquinas }) {
    const lista = pasos.filter(p => (p.union || '').trim());
    if (!lista.length) return null;
    const total = totalMinutos(lista);
    return (
        <table className="w-full text-[11px] mb-3">
            <thead><tr className="border-b-2 border-slate-800 text-left">
                <th className="py-1 pr-1">#</th><th className="py-1 pr-2">Operación · piezas que une</th><th className="py-1 pr-2">Costura</th><th className="py-1 pr-2">Máquina</th><th className="py-1 pr-2 text-right">Min</th><th className="py-1 pr-2">Observaciones</th><th className="py-1"></th>
            </tr></thead>
            <tbody>
                {lista.map((p, i) => {
                    const iso = costurasIso.find(o => o.CodigoISO === p.iso);
                    const maq = maquinas.find(m => String(m.MaquinaCosturaID) === String(p.maquinaId));
                    const img = p.imagenUrl || iso?.ImagenUrl;
                    const etapaNueva = p.etapa && (i === 0 || lista[i - 1].etapa !== p.etapa);
                    return (
                        <React.Fragment key={i}>
                            {etapaNueva && <tr><td colSpan={7} className="pt-2 pb-0.5 text-[10px] font-black uppercase text-slate-500">{p.etapa}</td></tr>}
                            <tr className="border-b border-slate-100 align-top">
                                <td className="py-1 pr-1 font-bold">{i + 1}</td>
                                <td className="py-1 pr-2"><b>{p.union}</b>{p.descripcion ? <div className="text-slate-500">{p.descripcion}</div> : null}</td>
                                <td className="py-1 pr-2">{p.iso || '—'}{iso ? <div className="text-slate-500">{iso.Nombre}</div> : null}</td>
                                <td className="py-1 pr-2">{maq?.Nombre || ''}</td>
                                <td className="py-1 pr-2 text-right">{p.tiempoMin !== '' && p.tiempoMin != null ? p.tiempoMin : ''}</td>
                                <td className="py-1 pr-2">{p.observaciones}</td>
                                <td className="py-1">{img ? <img src={img} alt="" className="h-12 w-20 object-contain" /> : null}</td>
                            </tr>
                        </React.Fragment>
                    );
                })}
                {total > 0 && <tr><td colSpan={4} className="py-1 pr-2 text-right font-bold">Tiempo total por prenda</td><td className="py-1 pr-2 text-right font-bold">{total.toFixed(2)}</td><td colSpan={2} className="py-1">min</td></tr>}
            </tbody>
        </table>
    );
}
