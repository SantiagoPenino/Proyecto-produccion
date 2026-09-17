import React, { useState, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { Listbox, Transition } from '@headlessui/react';
import { Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { consultasService } from '../../../services/api';

// =====================================================================
// CONSULTA AL CLIENTE — el modal del operario (SB · DTF · ECOUV)
// =====================================================================
// UNA pregunta + hasta 5 fotos. No es un chat: el cliente responde una sola vez,
// aprobando o cancelando. Ver docs/consultas-cliente-plan.md §5c.
//
// Ámbar en todo el modal, nunca magenta: esto es una acción de ESPERA, no
// destructiva. El magenta está reservado a cancelar.
//
// Props:
//   orden    — la orden (code, area); se muestra para que el operario sepa qué frena
//   archivo  — { id, nombre } o null si la consulta es sobre la orden entera
//   onClose  — cerrar sin crear
//   onCreada — creada con éxito: el padre recarga
const MAX_FOTOS = 5;                  // espeja multerConsultasConfig
const MAX_BYTES = 5 * 1024 * 1024;    // 5 MB por foto, igual que el backend
const MIN_PREGUNTA = 10;              // el backend rechaza por debajo de esto

const ModalConsultaCliente = ({ orden, archivo = null, onClose, onCreada }) => {
    const [motivos, setMotivos] = useState([]);
    const [motivo, setMotivo] = useState(null);
    const [pregunta, setPregunta] = useState('');
    const [fotos, setFotos] = useState([]);      // { file, preview }
    const [enviando, setEnviando] = useState(false);

    useEffect(() => {
        consultasService.getMotivos()
            .then(setMotivos)
            .catch(() => toast.error('No se pudieron cargar los motivos de consulta.'));
    }, []);

    // Los object URL de las previsualizaciones se revocan al desmontar (si no, quedan
    // los blobs de cada foto elegida colgados en memoria mientras viva la pestaña).
    // Por ref: un efecto con [] cerraría sobre la lista VACÍA del primer render y no
    // revocaría nada.
    const fotosRef = React.useRef(fotos);
    fotosRef.current = fotos;
    useEffect(() => () => fotosRef.current.forEach(f => URL.revokeObjectURL(f.preview)), []);

    // Al elegir motivo se precarga su texto sugerido, salvo que el operario ya haya
    // escrito algo: lo que escribió una persona nunca se pisa.
    const elegirMotivo = (m) => {
        setMotivo(m);
        if (!pregunta.trim() && m?.MotConDescDefault) setPregunta(m.MotConDescDefault);
    };

    const agregarFotos = (lista) => {
        const nuevas = [];
        for (const file of Array.from(lista || [])) {
            if (fotos.length + nuevas.length >= MAX_FOTOS) {
                toast.error(`Hasta ${MAX_FOTOS} fotos por consulta.`);
                break;
            }
            if (!/^image\//i.test(file.type)) {
                toast.error(`"${file.name}" no es una imagen.`);
                continue;
            }
            if (file.size > MAX_BYTES) {
                toast.error(`"${file.name}" pesa más de 5 MB.`);
                continue;
            }
            nuevas.push({ file, preview: URL.createObjectURL(file) });
        }
        if (nuevas.length) setFotos(prev => [...prev, ...nuevas]);
    };

    const quitarFoto = (idx) => {
        setFotos(prev => {
            URL.revokeObjectURL(prev[idx].preview);
            return prev.filter((_, i) => i !== idx);
        });
    };

    const textoOk = pregunta.trim().length >= MIN_PREGUNTA;
    const puedeEnviar = !!motivo && textoOk && !enviando;

    const enviar = async () => {
        if (!puedeEnviar) return;
        setEnviando(true);
        try {
            await consultasService.crear({
                ordenId  : orden.id,
                archivoId: archivo?.id || null,
                motivoId : motivo.MotConIdMotivo,
                pregunta : pregunta.trim(),
                fotos    : fotos.map(f => f.file),
            });
            toast.success('Consulta enviada. La orden queda frenada hasta que el cliente responda.');
            onCreada?.();
            onClose?.();
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo enviar la consulta.');
        } finally {
            setEnviando(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-zinc-900/60" onClick={enviando ? undefined : onClose} />

            <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-amber-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">

                <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-start justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                            <i className="fa-solid fa-comment-dots text-amber-600" />
                        </div>
                        <div>
                            <h3 className="font-black text-zinc-800 text-sm uppercase tracking-wide">Consultar al cliente</h3>
                            <p className="text-xs text-zinc-500 mt-0.5">
                                {archivo
                                    ? <>Sobre el archivo <b className="text-zinc-700">{archivo.nombre}</b></>
                                    : <>Sobre toda la orden <b className="text-zinc-700">{orden?.code}</b></>}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={enviando}
                        className="w-7 h-7 rounded-full bg-white border border-zinc-200 text-zinc-400 hover:text-zinc-700 flex items-center justify-center shrink-0 transition-colors"
                    ><i className="fa-solid fa-xmark" /></button>
                </div>

                <div className="px-5 py-4 space-y-4 overflow-y-auto custom-scrollbar">

                    {/* MOTIVO */}
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1.5 tracking-wide">
                            Motivo <span className="text-amber-600">*</span>
                        </label>
                        <Listbox value={motivo} onChange={elegirMotivo}>
                            <div className="relative">
                                <Listbox.Button className="relative w-full cursor-pointer rounded-xl bg-zinc-50 py-2.5 pl-4 pr-10 text-left border border-zinc-200 hover:border-amber-300 focus:outline-none text-sm transition-colors">
                                    <span className={`block truncate font-medium ${motivo ? 'text-zinc-900' : 'text-zinc-400'}`}>
                                        {motivo ? motivo.MotConTitulo : 'Elegí un motivo...'}
                                    </span>
                                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400">
                                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                    </span>
                                </Listbox.Button>
                                <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
                                    <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-xl bg-white py-2 text-sm shadow-xl border border-zinc-100 focus:outline-none z-20">
                                        {motivos.map(m => (
                                            <Listbox.Option
                                                key={m.MotConIdMotivo}
                                                value={m}
                                                className={({ active }) =>
                                                    `relative cursor-pointer select-none py-2 pl-9 pr-4 ${active ? 'bg-amber-50 text-amber-700' : 'text-zinc-700'}`}
                                            >
                                                {({ selected }) => (
                                                    <>
                                                        <span className={`block truncate ${selected ? 'font-black' : 'font-medium'}`}>{m.MotConTitulo}</span>
                                                        {selected && (
                                                            <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-amber-600">
                                                                <Check className="h-4 w-4" aria-hidden="true" />
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

                    {/* LA PREGUNTA */}
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1.5 tracking-wide">
                            Qué le preguntás <span className="text-amber-600">*</span>
                        </label>
                        <textarea
                            className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:border-amber-400 min-h-[110px] text-sm font-medium text-zinc-700 resize-none transition-colors"
                            placeholder="Ej.: el logo viene en 72 dpi y a este tamaño va a salir pixelado. ¿Lo imprimimos igual o nos mandás el archivo en alta?"
                            value={pregunta}
                            onChange={e => setPregunta(e.target.value)}
                            maxLength={1500}
                            autoFocus
                        />
                        <div className="flex justify-between items-center mt-1">
                            <span className={`text-[10px] font-bold ${textoOk ? 'text-zinc-400' : 'text-amber-600'}`}>
                                {textoOk ? 'El cliente lee esto tal cual.' : `Mínimo ${MIN_PREGUNTA} caracteres.`}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-mono">{pregunta.trim().length}/1500</span>
                        </div>
                    </div>

                    {/* FOTOS */}
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1.5 tracking-wide">
                            Fotos <span className="text-zinc-400 normal-case font-medium">(opcional, hasta {MAX_FOTOS})</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {fotos.map((f, i) => (
                                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-zinc-200 group">
                                    <img src={f.preview} alt="" className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => quitarFoto(i)}
                                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 border border-zinc-200 text-zinc-500 hover:text-brand-magenta flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Quitar"
                                    ><i className="fa-solid fa-xmark text-[10px]" /></button>
                                </div>
                            ))}
                            {fotos.length < MAX_FOTOS && (
                                <label className="w-20 h-20 rounded-lg border-2 border-dashed border-zinc-200 hover:border-amber-300 hover:bg-amber-50/50 flex flex-col items-center justify-center cursor-pointer text-zinc-400 hover:text-amber-500 transition-colors">
                                    <i className="fa-solid fa-camera text-base" />
                                    <span className="text-[9px] font-bold mt-1">Agregar</span>
                                    <input
                                        type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden"
                                        onChange={e => { agregarFotos(e.target.files); e.target.value = ''; }}
                                    />
                                </label>
                            )}
                        </div>
                    </div>

                    {/* QUÉ PASA AL ENVIAR */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <p className="text-xs text-amber-800 font-medium leading-relaxed">
                            <i className="fa-solid fa-hand text-amber-600 mr-1.5" />
                            Al enviarla, <b>la orden {orden?.code} queda frenada</b>: sale de la grilla activa y no se
                            puede asignar a un lote hasta que el cliente responda. Si aprueba, vuelve a donde estaba;
                            si cancela, se cancela {archivo ? 'el archivo' : 'la orden'}.
                        </p>
                    </div>
                </div>

                <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-200 flex justify-end gap-3 shrink-0">
                    <button
                        onClick={onClose}
                        disabled={enviando}
                        className="px-4 py-2 text-zinc-500 font-bold text-sm hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
                    >Volver</button>
                    <button
                        onClick={enviar}
                        disabled={!puedeEnviar}
                        className={`px-5 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2 ${
                            puedeEnviar
                                ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-200 active:scale-95'
                                : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                        }`}
                    >
                        <i className={`fa-solid ${enviando ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}`} />
                        {enviando ? 'Enviando...' : 'Enviar consulta'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ModalConsultaCliente;
