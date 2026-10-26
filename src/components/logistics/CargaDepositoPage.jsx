import React, { useState, useEffect, useRef } from 'react';
import { PackageSearch, Send, Trash2, CheckCircle2, AlertCircle, Info, Loader2, Package, User, Activity, ShoppingBag, Tag, Phone, XCircle, ScanLine, ChevronDown, RotateCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { socket } from '../../services/socketService';
import { toast } from 'sonner';
import useConfirmar from '../ui/useConfirmar';

// Estética nueva (22/10/2026, como Check-in de Logística): encabezado con ícono Lucide en brand-cyan, tarjetas blancas
// con una barra de estado al costado (rojo rechazado, ámbar en espera de WhatsApp, verde enviado, brand-cyan reingresado,
// gris listo / validando) y «Confirmar carga» en brand-cyan. En el celular las validaciones van en una columna.
const CARD = 'bg-white rounded-2xl border border-zinc-200';

const CargaDepositoPage = () => {
    // Confirmaciones con el estilo del sistema (antes window.confirm, la ventana gris del navegador)
    const [confirmar, ventanaConfirmar] = useConfirmar();
    // Clave única por sesión de carga (por máquina/usuario), soporta trabajo concurrente
    const SESSION_KEY = `carga_deposito_draft_${window.location.hostname}_${Date.now().toString(36).slice(-5)}`;
    const STORAGE_KEY = React.useMemo(() => {
        // Si ya hay una clave guardada para esta pestaña (en sessionStorage), la reutilizamos
        const existing = sessionStorage.getItem('carga_session_key');
        if (existing) return existing;
        const newKey = `carga_deposito_draft_${window.location.hostname}_${Date.now().toString(36)}`;
        sessionStorage.setItem('carga_session_key', newKey);
        return newKey;
    }, []);

    const EMPTY_CODE = { value: '', id: 0, status: 'idle', message: '', parsed: null };

    // Intentar recuperar estado previo del localStorage al iniciar
    const getInitialCodes = () => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Solo recuperar los que tienen valor real (no la fila vacía en blanco)
                // Los que tenían error se resetean a idle para que se revaliden limpios
                const recovered = parsed
                    .filter(c => c.value && c.value.trim() !== '')
                    .map(c => c.status === 'error'
                        ? { ...c, status: 'idle', message: '', parsed: null }
                        : c
                    );
                if (recovered.length > 0) {
                    // Añadir una fila vacía al final para seguir escaneando
                    return [...recovered, { ...EMPTY_CODE, id: Date.now() }];
                }
            }
        } catch (e) { /* silenciar errores de localStorage */ }
        return [EMPTY_CODE];
    };

    const [codes, setCodes] = useState(getInitialCodes);
    const [hasRecovered, setHasRecovered] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return parsed.filter(c => c.value && c.value.trim() !== '').length > 0;
            }
        } catch (e) { }
        return false;
    });
    const [loading, setLoading] = useState(false);
    const [modosMap, setModosMap] = useState({});
    const [expandedCardId, setExpandedCardId] = useState(null);
    const inputRefs = useRef({});
    // Timers de debounce por fila — cancela la validación anterior si el scanner sigue enviando
    const debounceTimers = useRef({});
    // Timestamp del último caracter recibido por fila (para detectar scanner rápido)
    const lastCharTime = useRef({});

    // ─── PERSISTENCIA AUTOMÁTICA ────────────────────────────────────────────────
    // Guardar en localStorage cada vez que cambian los códigos
    useEffect(() => {
        try {
            // Solo guardar idle y validating (no errores ni estados de WSP)
            // Los errores no se guardan: en la siguiente sesión el usuario debe re-escanear
            const toSave = codes.filter(c => c.value && c.value.trim() !== '' && ['idle', 'validating'].includes(c.status));
            if (toSave.length > 0) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (e) { /* silenciar errores de localStorage */ }
    }, [codes, STORAGE_KEY]);
    // ───────────────────────────────────────────────────────────────────────────

    // Cargar los Modos de Orden y ordenes pendientes de WSP al montar
    useEffect(() => {
        api.get('/apiordenes/modos').then(res => {
            if (res.data) {
                const map = {};
                res.data.forEach(m => { map[m.MOrIdModoOrden] = m.MOrNombreModo; });
                setModosMap(map);
            }
        }).catch(() => console.error("No se pudieron cargar los modos correspondientes."));

        // Cargar pendientes de avisar
        api.get('/apiordenes/pending-wsp').then(res => {
            if (res.data && res.data.length > 0) {
                const pendingCodes = res.data.map((ord, i) => {
                    const isError = ord.hasPhoneError;
                    return {
                        id: `pending-${ord.idOrden}-${i}`,
                        idOrden: ord.idOrden,
                        value: ord.CodigoOrden,
                        status: isError ? 'wsp_error' : 'wsp_waiting',
                        message: isError ? 'Número de teléfono inválido o vacío' : 'Orden guardada. Esperando WhatsApp...',
                        wspError: isError,
                        parsed: ord
                    };
                });
                setCodes(prev => {
                    // Deduplicar: no agregar los que ya están cargados (por idOrden o por código de orden)
                    const existingIds = new Set(prev.map(c => c.idOrden).filter(Boolean));
                    const existingValues = new Set(prev.map(c => c.value).filter(Boolean));
                    const nuevos = pendingCodes.filter(p =>
                        !existingIds.has(p.idOrden) && !existingValues.has(p.value)
                    );
                    return nuevos.length > 0 ? [...nuevos, ...prev] : prev;
                });
            }
        }).catch(() => console.error("No se pudieron cargar las órdenes pendientes de aviso."));
    }, []);

    // Autoenfocar el último campo
    useEffect(() => {
        const visibleCodes = codes.filter(c => !['wsp_waiting', 'wsp_success', 'info', 'wsp_error'].includes(c.status));
        const lastCode = visibleCodes[visibleCodes.length - 1];
        if (lastCode && inputRefs.current[lastCode.id]) {
            inputRefs.current[lastCode.id].focus();
        }
    }, [codes.length]);

    // ─── GLOBAL SCANNER CAPTURE ─────────────────────────────────────────────────
    // Captura teclas del escáner aunque el input no esté en foco.
    // Si se presiona una tecla imprimible y el foco NO está en un input de código,
    // redirige automáticamente al último input vacío.
    useEffect(() => {
        const handleGlobalKey = (e) => {
            // Ignorar si ya estamos en un input de esta página
            const active = document.activeElement;
            const isOurInput = active && active.dataset && active.dataset.cargaInput === 'true';
            if (isOurInput) return;

            // Ignorar teclas de control (Shift, Ctrl, Alt, etc.) excepto Enter
            if (e.key.length > 1 && e.key !== 'Enter') return;

            // Ignorar si hay un modal abierto o se está en otro input/textarea
            if (active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type !== 'button'))) return;

            // Buscar el último input vacío
            const visibleCodes = codes.filter(c => !['wsp_waiting', 'wsp_success', 'info', 'wsp_error'].includes(c.status));
            const lastCode = visibleCodes[visibleCodes.length - 1];
            if (lastCode && inputRefs.current[lastCode.id]) {
                const input = inputRefs.current[lastCode.id];
                input.focus();
                // No inyectar Enter, solo redirigir foco — el scanner mandará el char al input enfocado
            }
        };

        window.addEventListener('keydown', handleGlobalKey);
        return () => window.removeEventListener('keydown', handleGlobalKey);
    }, [codes]);

    // Socket.io para escuchar actualizaciones de WS
    useEffect(() => {
        const handleWspUpdate = (data) => {
            if (data && data.ordId) {
                setCodes(prev => {
                    const idx = prev.findIndex(c => c.idOrden === data.ordId);
                    if (idx < 0) return prev;

                    const newCodes = [...prev];
                    const target = { ...newCodes[idx] };

                    if (data.status === 'success') {
                        target.status = 'wsp_success';
                        target.message = 'Aviso de WhatsApp enviado correctamente.';
                        // Retirarlo después de 4 segundos para dar tiempo a ver el verde
                        setTimeout(() => removeRow(target.id), 4000);
                    } else if (data.status === 'error') {
                        target.status = 'wsp_error';
                        target.message = data.reason || 'Error conectando con Callbell.';
                        target.wspError = true;
                    }

                    newCodes[idx] = target;
                    return newCodes;
                });
            }
        };

        socket.on('actualizado_wsp', handleWspUpdate);
        return () => socket.off('actualizado_wsp', handleWspUpdate);
    }, []);

    // Lógica asíncrona validando contra DB
    const validateQRCode = async (id, value) => {
        try {
            const res = await api.post('/apiordenes/parse-qr', { ordenString: value });
            const p = res.data;
            if (p.valid) {
                setCodes(prev => prev.map(c => c.id === id ? { ...c, status: 'idle', message: '', parsed: p.data } : c));
            } else {
                setCodes(prev => prev.map(c => c.id === id ? { ...c, status: 'error', message: p.error, parsed: null } : c));
            }
        } catch (err) {
            const msg = err.response?.data?.error || 'Error de conexión o validación.';
            setCodes(prev => prev.map(c => c.id === id ? { ...c, status: 'error', message: msg, parsed: null } : c));
        }
    };

    const handleInput = (id, value) => {
        const trimmedValue = value.trim();
        const now = Date.now();

        setCodes(prev => {
            // ── SCANNER MERGE: si esta fila estaba vacía y recibió input muy rápido
            // después de otra fila, es porque el scanner partió el código con un Enter ──
            const currentRow = prev.find(c => c.id === id);
            const currentIndex = prev.indexOf(currentRow);
            if (currentRow && currentRow.value === '' && trimmedValue !== '' && currentIndex > 0) {
                const prevRow = prev[currentIndex - 1];
                const timeSincePrev = now - (lastCharTime.current[prevRow.id] || 0);
                // Si la fila anterior recibió input hace menos de 300ms, es un split del scanner
                if (timeSincePrev < 300 && prevRow.value !== '' && prevRow.status !== 'error') {
                    const merged = prevRow.value + trimmedValue;
                    // Cancelar validación anterior de la fila previa
                    if (debounceTimers.current[prevRow.id]) clearTimeout(debounceTimers.current[prevRow.id]);
                    debounceTimers.current[prevRow.id] = setTimeout(() => {
                        delete debounceTimers.current[prevRow.id];
                        validateQRCode(prevRow.id, merged);
                    }, 400);
                    lastCharTime.current[prevRow.id] = now;
                    // Mergear al anterior y limpiar esta fila
                    return prev.map(c => {
                        if (c.id === prevRow.id) return { ...c, value: merged, status: 'validating', message: 'Verificando orden...', parsed: null };
                        if (c.id === id) return { ...c, value: '', status: 'idle', message: '', parsed: null };
                        return c;
                    });
                }
            }

            lastCharTime.current[id] = now;

            const isDuplicate = prev.some(c => c.value === trimmedValue && c.id !== id && trimmedValue !== '');

            const newCodes = prev.map(c => {
                if (c.id === id) {
                    if (isDuplicate) {
                        return { ...c, value: trimmedValue, status: 'error', message: 'Este código ya fue escaneado en esta tanda.', parsed: null };
                    } else if (trimmedValue !== '' && c.value !== trimmedValue) {
                        // Debounce con cancelación: espera 400ms sin cambios antes de validar
                        if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id]);
                        debounceTimers.current[id] = setTimeout(() => {
                            delete debounceTimers.current[id];
                            validateQRCode(id, trimmedValue);
                        }, 400);
                        return { ...c, value: trimmedValue, status: 'validating', message: 'Verificando orden...', parsed: null };
                    }
                    return { ...c, value: trimmedValue };
                }
                return c;
            });

            // Si es válido y no duplicado, generamos una linea nueva
            if (trimmedValue !== '' && !isDuplicate) {
                setTimeout(() => {
                    setCodes(curr => {
                        const last = curr[curr.length - 1];
                        if (last && last.value !== '') {
                            const newId = Date.now();
                            return [...curr, { value: '', id: newId, status: 'idle', message: '', parsed: null }];
                        }
                        return curr;
                    });
                }, 100);
            }

            return newCodes;
        });
    };

    const handlePaste = (e, id) => {
        e.preventDefault();
        const pastedText = e.clipboardData.getData('text');
        handleInput(id, pastedText);
    };

    const handleKeyDown = (e, codeId) => {
        // Trackear tiempo de cada tecla para detectar scanner rápido
        if (e.key.length === 1) {
            lastCharTime.current[codeId] = Date.now();
        }

        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            // Si el escáner aún está enviando caracteres (debounce activo), ignorar el Enter
            if (debounceTimers.current[codeId]) return;
            // Si el Enter llegó muy rápido después del último carácter (<200ms), es un Enter del scanner a mitad de lectura
            const timeSinceLastChar = Date.now() - (lastCharTime.current[codeId] || 0);
            if (timeSinceLastChar < 200) return;

            const current = codes.find(c => c.id === codeId);
            // Si el código tiene error, Enter re-dispara la validación
            if (current && current.status === 'error' && current.value.trim() !== '') {
                setCodes(prev => prev.map(c => c.id === codeId ? { ...c, status: 'validating', message: 'Reintentando...', parsed: null } : c));
                setTimeout(() => validateQRCode(codeId, current.value.trim()), 50);
                return;
            }
            const visibleCodes = codes.filter(c => !['wsp_waiting', 'wsp_success', 'info', 'wsp_error'].includes(c.status));
            const currentIndex = visibleCodes.findIndex(c => c.id === codeId);
            if (currentIndex < visibleCodes.length - 1) {
                const nextC = visibleCodes[currentIndex + 1].id;
                inputRefs.current[nextC]?.focus();
            } else {
                const currentCode = visibleCodes[currentIndex];
                if (currentCode && currentCode.value !== '') {
                    setCodes(curr => {
                        const newId = Date.now();
                        return [...curr, { value: '', id: newId, status: 'idle', message: '', parsed: null }];
                    });
                }
            }
        }
    };

    const processCodes = async () => {
        const toProcess = codes.filter(c => c.value.trim() !== '' && c.status !== 'success' && c.status !== 'info' && c.status !== 'error' && c.status !== 'wsp_error' && c.status !== 'wsp_waiting' && c.status !== 'validating');

        if (toProcess.length === 0) return;

        // ── Deduplicar por CodigoOrden (primera parte del QR) ──────────────
        const seen = new Set();
        const duplicateIds = [];
        const unique = toProcess.filter(c => {
            const codigo = c.value.trim().split('$*')[0];
            if (seen.has(codigo)) { duplicateIds.push(c.id); return false; }
            seen.add(codigo);
            return true;
        });

        // Marcar duplicados como error antes de procesar
        if (duplicateIds.length > 0) {
            setCodes(prev => prev.map(c =>
                duplicateIds.includes(c.id)
                    ? { ...c, status: 'error', message: '⚠️ Código duplicado en la lista. Solo se procesa una vez.' }
                    : c
            ));
        }

        setLoading(true);
        setCodes(prev => prev.map(c =>
            unique.some(p => p.id === c.id) ? { ...c, status: 'loading', message: 'Guardando...' } : c
        ));

        // ── Procesamiento SECUENCIAL para evitar race conditions en DB ──────
        const results = [];
        for (const codeObj of unique) {
            try {
                const res = await api.post('/apiordenes/data', {
                    ordenString: codeObj.value,
                    estado: 'Ingresado'
                });
                results.push({
                    id: codeObj.id,
                    idOrden: res.data.idOrden,
                    status: res.status === 202 ? 'info' : 'wsp_waiting',
                    message: res.status === 202 ? 'La orden se reingresó exitosamente al depósito.' : 'Orden guardada. Esperando WhatsApp...'
                });
            } catch (err) {
                const status = err.response?.status;
                let message = 'Error inesperado al cargar.';
                if (status === 400) message = 'La orden ya fue ingresada previamente en depósito.';
                if (status === 403) message = 'El campo cliente se encuentra vacío en la etiqueta.';
                if (status === 404) message = 'Cliente no encontrado en el sistema.';
                if (status === 405) message = 'Producto no encontrado en el sistema.';
                if (status === 500) message = 'Falla interna del servidor. Carga rechazada.';
                results.push({ id: codeObj.id, status: 'error', message });
            }
        }

        setCodes(prev => prev.map(c => {
            const r = results.find(res => res.id === c.id);
            if (r) return { ...c, status: r.status, message: r.message, idOrden: r.idOrden };
            return c;
        }));

        setLoading(false);
        localStorage.removeItem(STORAGE_KEY); // Limpiar el storage al confirmar la carga
        setHasRecovered(false); // Resetear el estado de recuperación

        // Limpieza de inputs SOLO para los que no tienen status error o info.
        // Wait, normally we keep them in the UI. Actually, the user wants them staying in the list:
        // "VA A TENER TODAS LAS ORDENES... LAS INGRESADAS PARA AVISAR QUE SE MANTENGAN AHI... "
        setCodes(curr => {
            const last = curr[curr.length - 1];
            if (last && last.value !== '') {
                return [...curr, { value: '', id: Date.now(), status: 'idle', message: '', parsed: null }];
            }
            return curr;
        });

        // Enfocar el último
        setTimeout(() => {
            setCodes(curr => {
                const visibleCodes = curr.filter(c => !['wsp_waiting', 'wsp_success', 'info', 'wsp_error'].includes(c.status));
                const lastCodeObj = inputRefs.current[visibleCodes[visibleCodes.length - 1]?.id];
                if (lastCodeObj) lastCodeObj.focus();
                return curr;
            });
        }, 100);
    };

    const removeRow = (id) => {
        setCodes(prev => {
            const arr = prev.filter(c => c.id !== id);
            if (arr.length === 0) {
                return [{ value: '', id: Date.now(), status: 'idle', message: '', parsed: null }];
            }
            return arr;
        });
    };

    const handleOmitirWsp = async (idOrden) => {
        if (!(await confirmar({
            titulo: '¿Marcar esta orden como avisada sin enviar WhatsApp?',
            texto: 'No se le manda el aviso al cliente: la orden queda como avisada.',
            confirmar: 'Marcar como avisada',
        }))) return;
        try {
            await api.post('/apiordenes/omitir-wsp', { ordId: idOrden });
            setCodes(prev => prev.map(c =>
                c.idOrden === idOrden
                    ? { ...c, status: 'wsp_success', message: 'WSP omitido. Orden marcada como avisada.', wspError: false }
                    : c
            ));
        } catch (err) {
            toast.error('No se pudo omitir el WSP: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleUpdatePhone = async (idOrden, nuevoTelefono) => {
        if (!nuevoTelefono || nuevoTelefono.trim() === '') return;

        try {
            await api.post('/apiordenes/update-phone', { ordId: idOrden, nuevoTelefono });

            // Si el backend responde ok (status 200), seteamos en 'wsp_waiting' de nuevo
            setCodes(prev => prev.map(c => {
                if (c.idOrden === idOrden) {
                    return { ...c, status: 'wsp_waiting', message: 'Número corregido. Intentando enviar aviso...', wspError: false };
                }
                return c;
            }));

        } catch (error) {
            console.error(error);
            toast.error("No se pudo redespachar la orden.");
        }
    };

    return (
        <div className="p-3 md:p-6 w-full min-h-full bg-slate-50 font-sans text-zinc-800 space-y-4">

            {/* ── Encabezado ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 min-w-0">
                <ScanLine size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                <div className="min-w-0">
                    <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Carga de códigos</h1>
                    <p className="text-sm text-zinc-400">Escaneá las etiquetas de las órdenes que entran al depósito: se validan solas y entran al confirmar.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">

            {/* PANEL IZQUIERDO: Inputs */}
            <div className={`${CARD} min-w-0 flex flex-col p-4 md:p-6`}>
                {hasRecovered && (
                    <div className="mb-4 px-3 py-2.5 bg-brand-cyan/5 border border-brand-cyan/20 text-zinc-700 rounded-xl flex items-center gap-2 text-sm">
                        <Info size={16} className="shrink-0 text-brand-cyan" />
                        <p>Se recuperaron códigos de una sesión anterior. Confirme la carga para procesarlos.</p>
                    </div>
                )}

                <div className="w-full flex flex-col gap-2.5 min-h-[30vh] max-h-[55vh] overflow-y-auto pb-4 pr-8 scrollbar-thin scrollbar-thumb-zinc-200">
                    {codes.filter(c => !['wsp_waiting', 'wsp_success', 'info', 'wsp_error'].includes(c.status)).map((code, index, visibleArr) => (
                        <div key={code.id} className="w-full relative group flex items-center">
                            <input
                                ref={el => inputRefs.current[code.id] = el}
                                type="text"
                                className={`w-full text-center font-bold text-zinc-800 py-3 rounded-xl border outline-none transition-colors placeholder:text-zinc-400 placeholder:font-semibold
                                ${code.status === 'error' || code.status === 'wsp_error' ? 'border-rose-300 bg-rose-50 text-rose-800' :
                                        code.status === 'wsp_success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' :
                                            code.status === 'wsp_waiting' ? 'border-amber-300 bg-amber-50 text-amber-800' :
                                                code.status === 'info' ? 'border-brand-cyan/30 bg-brand-cyan/5' :
                                                    code.status === 'validating' ? 'border-zinc-200 bg-zinc-50' :
                                                        'border-zinc-200 bg-white focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15'}`}
                                value={code.value}
                                placeholder={index === visibleArr.length - 1 ? 'Escanee la etiqueta aquí...' : ''}
                                onInput={(e) => handleInput(code.id, e.target.value)}
                                onPaste={(e) => handlePaste(e, code.id)}
                                onKeyDown={(e) => handleKeyDown(e, code.id)}
                                disabled={code.status === 'loading' || code.status === 'wsp_success' || code.status === 'wsp_waiting' || code.status === 'info' || code.wspError}
                                autoComplete="off"
                                data-carga-input="true"
                            />
                            {/* Loader durante la validacion async */}
                            {code.status === 'validating' && (
                                <div className="absolute right-4 text-brand-cyan">
                                    <Loader2 className="animate-spin" size={18} />
                                </div>
                            )}

                            {/* Boton flotante derecho para eliminar la fila */}
                            <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => removeRow(code.id)}
                                aria-label="Quitar este código"
                                className={`absolute -right-8 text-zinc-300 hover:text-rose-500 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity ${code.status === 'loading' ? 'hidden' : ''}`}
                            >
                                <Trash2 size={17} />
                            </button>
                        </div>
                    ))}
                </div>

                <div className="w-full mt-auto pt-2 flex flex-col gap-2">
                    <button
                        type="button"
                        onClick={processCodes}
                        disabled={loading || codes.every(c => c.value.trim() === '' || c.status === 'error' || c.status === 'wsp_success' || c.status === 'wsp_waiting' || c.status === 'info' || c.status === 'validating' || c.wspError)}
                        className="w-full py-3 rounded-xl bg-brand-cyan hover:bg-brand-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold transition-colors flex justify-center items-center gap-2"
                    >
                        {loading ? <><Loader2 size={18} className="animate-spin" /> Guardando...</> : <><CheckCircle2 size={18} /> Confirmar carga</>}
                    </button>
                    <button
                        type="button"
                        onClick={async () => {
                            if (!(await confirmar({ titulo: '¿Limpiar todos los códigos escaneados?', confirmar: 'Limpiar todo', peligro: true }))) return;
                            setCodes([{ ...EMPTY_CODE, id: Date.now() }]);
                            setHasRecovered(false);
                            localStorage.removeItem(STORAGE_KEY);
                        }}
                        disabled={loading || codes.every(c => c.value.trim() === '')}
                        className="w-full py-2 rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 font-bold transition-colors flex justify-center items-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <XCircle size={15} /> Limpiar todo
                    </button>
                </div>
            </div>

            {/* PANEL DERECHO: Tarjetas */}
            <div className="min-w-0 flex flex-col">
                <h2 className="text-sm font-black text-zinc-800 mb-3 flex items-center gap-2">
                    <PackageSearch className="text-brand-cyan" size={16} /> Validaciones
                    {codes.some(c => c.value.trim() !== '') && (
                        <span className="text-xs font-normal text-zinc-400">{codes.filter(c => c.value.trim() !== '').length}</span>
                    )}
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[75vh] overflow-y-auto pr-1 pb-6 scrollbar-thin scrollbar-thumb-zinc-300 auto-rows-max">
                    {codes.slice().reverse().filter(c => c.value.trim() !== '').map((code, idx) => {
                        const isError = code.status === 'error' || code.status === 'wsp_error';
                        const isWspSuccess = code.status === 'wsp_success';
                        const isWspWaiting = code.status === 'wsp_waiting';
                        const isInfo = code.status === 'info';
                        const isLoading = code.status === 'loading' || code.status === 'validating';
                        const isIdle = code.status === 'idle';

                        const rawStringDisplay = code.parsed ? code.parsed.CodigoOrden : (code.value.length > 25 ? code.value.substring(0, 25) + '...' : code.value);

                        return (
                            <div key={`card-${code.id}`}
                                className={`${CARD} overflow-hidden flex items-stretch transition-colors cursor-pointer self-start hover:border-zinc-300`}
                                onClick={(e) => {
                                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
                                    console.log('CLICK card idx:', idx, 'value:', code.value, 'id:', code.id);
                                    setExpandedCardId(prev => prev === idx ? null : idx);
                                }}
                            >
                                {/* Barra lateral de estado */}
                                <div className={`w-1.5 shrink-0 ${isError ? 'bg-rose-500' : isWspSuccess ? 'bg-emerald-500' : isWspWaiting ? 'bg-amber-400' : isInfo ? 'bg-brand-cyan' : 'bg-zinc-200'}`} />

                                <div className="flex-1 flex flex-col overflow-hidden px-3.5 py-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-black text-base text-zinc-800 truncate font-mono">
                                            {rawStringDisplay}
                                        </span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {isLoading && <Loader2 className="text-brand-cyan animate-spin" size={15} />}
                                            <span className={`px-2.5 py-0.5 text-[11px] font-bold uppercase rounded-full border
                                                ${isError ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                    isWspSuccess ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                        isWspWaiting ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                            isInfo ? 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20' :
                                                                'bg-zinc-100 text-zinc-600 border-zinc-200'
                                                }
                                            `}>
                                                {isError ? 'RECHAZADO' :
                                                    isWspSuccess ? 'ENVIADO' :
                                                        isWspWaiting ? 'EN ESPERA' :
                                                            isInfo ? 'REINGRESADO' :
                                                                code.status === 'validating' ? 'VALIDANDO...' :
                                                                    isLoading ? 'GUARDANDO...' : 'LISTO'}
                                            </span>
                                            {code.parsed && (
                                                <ChevronDown size={15} className={`text-zinc-400 transition-transform ${expandedCardId === idx ? 'rotate-180' : ''}`} />
                                            )}
                                        </div>
                                    </div>

                                    {/* Información expandida */}
                                    <AnimatePresence>
                                    {expandedCardId === idx && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ duration: 0.2, ease: 'easeOut' }}
                                            className="overflow-hidden"
                                        >
                                        <div className="mt-3 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                                            {/* Info parseada */}
                                            {code.parsed && (
                                                <div className="grid grid-cols-2 gap-x-3 gap-y-2 bg-zinc-50 rounded-xl p-2.5 border border-zinc-100 text-xs">
                                                    <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1 min-w-0">
                                                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide flex items-center gap-1"><User size={10} className="text-brand-cyan" /> Cliente</span>
                                                        <span className="text-zinc-800 font-semibold truncate">{code.parsed.CodigoCliente}
                                                            {code.parsed.IDCliente && code.parsed.IDCliente !== 'N/A' && (
                                                                <span className="ml-1 text-[10px] font-normal text-zinc-500 bg-zinc-200 px-1 py-[1px] rounded">ID: {code.parsed.IDCliente}</span>
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1 min-w-0">
                                                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide flex items-center gap-1"><ShoppingBag size={10} className="text-brand-cyan" /> Producto</span>
                                                        <span className="text-zinc-800 font-semibold truncate">{code.parsed.ProductoNombre}</span>
                                                    </div>
                                                    {/* Material desde Sheets — solo para XSB/XDF */}
                                                    {code.parsed.EsOrdenExterna && code.parsed.MaterialSheets && (
                                                        <div className="flex flex-col gap-0.5 col-span-2 min-w-0">
                                                            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                                                                <Activity size={10} className="text-brand-cyan" /> Tela (planilla)
                                                            </span>
                                                            <span className="text-zinc-800 font-black truncate flex items-center gap-1.5">
                                                                {code.parsed.MaterialSheets}
                                                                {code.parsed.CantidadSheets != null && (
                                                                    <span className="bg-brand-cyan/5 text-brand-cyan text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-brand-cyan/20">
                                                                        {code.parsed.CantidadSheets} mts
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="flex flex-col gap-0.5 col-span-2 min-w-0">
                                                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide flex items-center gap-1"><Tag size={10} className="text-brand-cyan" /> Trabajo</span>
                                                        <span className="text-zinc-700 italic truncate">{code.parsed.NombreTrabajo || 'Sin Descripción'}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between col-span-2 border-t pt-2 border-zinc-200 flex-wrap gap-2">
                                                        <span className="text-zinc-800 font-black text-sm tabular-nums">Cant: {code.parsed.Cantidad}</span>
                                                        <span className="text-zinc-600 font-semibold text-xs">{modosMap[code.parsed.IdModo] || `M-${code.parsed.IdModo}`}</span>
                                                        {code.parsed.CostoFinal != null && (
                                                            <span className="bg-white border border-zinc-200 rounded-md px-2 py-0.5 text-zinc-800 font-black text-xs tabular-nums">
                                                                {code.parsed.Moneda || '$U'} {Number(code.parsed.CostoFinal).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Mensaje de error / WSP */}
                                            {code.message && (
                                                <div className={`text-xs font-semibold px-3 py-2 rounded-xl border flex justify-between items-center gap-2
                                                    ${isError ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                        isWspSuccess ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                            isWspWaiting ? 'bg-amber-50 text-amber-800 border-amber-200' :
                                                                'bg-brand-cyan/5 text-zinc-700 border-brand-cyan/20'
                                                    }
                                                `}>
                                                    <span className="flex-1 text-center">{code.message}</span>
                                                    {isError && !code.wspError && (
                                                        <button
                                                            type="button"
                                                            title="Reintentar validación"
                                                            onClick={() => {
                                                                setCodes(prev => prev.map(c => c.id === code.id ? { ...c, status: 'validating', message: 'Reintentando...', parsed: null } : c));
                                                                setTimeout(() => validateQRCode(code.id, code.value.trim()), 50);
                                                            }}
                                                            className="shrink-0 bg-white border border-rose-200 hover:bg-rose-100 text-rose-700 rounded-lg px-2 py-0.5 text-[11px] font-bold transition-colors flex items-center gap-1"
                                                        >
                                                            <RotateCw size={10} /> Reintentar
                                                        </button>
                                                    )}
                                                    {isWspWaiting && code.idOrden && (
                                                        <button
                                                            type="button"
                                                            title="Marcar como avisado sin enviar WhatsApp"
                                                            onClick={() => handleOmitirWsp(code.idOrden)}
                                                            className="shrink-0 bg-white border border-amber-200 hover:bg-amber-100 text-amber-800 rounded-lg px-2 py-0.5 text-[11px] font-bold transition-colors flex items-center gap-1"
                                                        >
                                                            <XCircle size={10} /> Saltar WSP
                                                        </button>
                                                    )}
                                                </div>
                                            )}

                                            {/* Re-Despacho si falla WhatsApp */}
                                            {code.wspError && code.idOrden && (
                                                <div className="bg-white p-2 border border-rose-200 rounded-xl flex items-center gap-2">
                                                    <Phone size={15} className="shrink-0 text-brand-cyan ml-1" />
                                                    <div className="flex-1 min-w-0">
                                                        <input
                                                            type="text"
                                                            placeholder="Celular válido..."
                                                            className="w-full bg-white border border-zinc-200 py-1 px-2 rounded-lg text-xs outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                                                            id={`phone-input-${code.idOrden}`}
                                                        />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="bg-brand-cyan hover:bg-brand-cyan/90 text-white font-bold py-1.5 flex items-center gap-1.5 px-3 rounded-lg text-xs transition-colors"
                                                        onClick={() => {
                                                            const val = document.getElementById(`phone-input-${code.idOrden}`).value;
                                                            if (val) handleUpdatePhone(code.idOrden, val);
                                                        }}
                                                    >
                                                        <Send size={12} /> Redespachar
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        </motion.div>
                                    )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        );
                    })}
                    {codes.filter(c => c.value.trim() !== '').length === 0 && (
                        <div className={`${CARD} sm:col-span-2 flex flex-col items-center justify-center py-14 px-6 text-center`}>
                            <PackageSearch size={40} className="mb-3 text-zinc-200" />
                            <h3 className="font-black text-zinc-700 mb-1">Panel de validaciones</h3>
                            <p className="text-sm text-zinc-400 max-w-sm">
                                A medida que ingrese los códigos en el panel central, iremos verificando en tiempo real si toda la información está correcta.
                            </p>
                        </div>
                    )}
                </div>
            </div>
            </div>
            {ventanaConfirmar}
        </div>
    );
};

export default CargaDepositoPage;
