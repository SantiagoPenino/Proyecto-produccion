import React, { useState, useEffect, useRef } from 'react';
import { PackageSearch, Send, Trash2, CheckCircle2, AlertCircle, Info, Loader2, Package, User, CheckCircle, Activity, ShoppingBag, DollarSign, Tag } from 'lucide-react';
import api from '../../services/api';

const CargaDepositoPage = () => {
    const [codes, setCodes] = useState([{ value: '', id: 0, status: 'idle', message: '', parsed: null }]);
    const [loading, setLoading] = useState(false);
    const [modosMap, setModosMap] = useState({});
    const inputRefs = useRef({});

    // Cargar los Modos de Orden al montar
    useEffect(() => {
        api.get('/apiordenes/modos').then(res => {
            if (res.data) {
                const map = {};
                res.data.forEach(m => { map[m.MOrIdModoOrden] = m.MOrNombreModo; });
                setModosMap(map);
            }
        }).catch(() => console.error("No se pudieron cargar los modos correspondientes."));
    }, []);

    // Autoenfocar el último campo
    useEffect(() => {
        const lastCode = codes[codes.length - 1];
        if (lastCode && inputRefs.current[lastCode.id]) {
            inputRefs.current[lastCode.id].focus();
        }
    }, [codes.length]);

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

        setCodes(prev => {
            const isDuplicate = prev.some(c => c.value === trimmedValue && c.id !== id && trimmedValue !== '');

            const newCodes = prev.map(c => {
                if (c.id === id) {
                    if (isDuplicate) {
                        return { ...c, value: trimmedValue, status: 'error', message: 'Este código ya fue escaneado en esta tanda.', parsed: null };
                    } else if (trimmedValue !== '' && c.value !== trimmedValue) {
                        // Iniciar validacion asíncrona
                        setTimeout(() => validateQRCode(id, trimmedValue), 50);
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

    const handleKeyDown = (e, index) => {
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            if (index < codes.length - 1) {
                const nextC = codes[index + 1].id;
                inputRefs.current[nextC]?.focus();
            } else {
                if (codes[index].value !== '') {
                    setCodes(curr => {
                        const newId = Date.now();
                        return [...curr, { value: '', id: newId, status: 'idle', message: '', parsed: null }];
                    });
                }
            }
        }
    };

    const processCodes = async () => {
        const toProcess = codes.filter(c => c.value.trim() !== '' && c.status !== 'success' && c.status !== 'info' && c.status !== 'error' && c.status !== 'validating');

        if (toProcess.length === 0) return;

        setLoading(true);

        // Marcamos como cargando
        setCodes(prev => prev.map(c =>
            toProcess.some(p => p.id === c.id) ? { ...c, status: 'loading', message: 'Guardando...' } : c
        ));

        // Procesamiento en paralelo
        const promises = toProcess.map(async (codeObj) => {
            try {
                const res = await api.post('/apiordenes/data', {
                    ordenString: codeObj.value,
                    estado: 'Ingresado'
                });
                return { id: codeObj.id, status: res.status === 202 ? 'info' : 'success', message: res.status === 202 ? 'La orden se reingresó exitosamente al depósito.' : 'Orden guardada correctamente en depósito.' };
            } catch (err) {
                const status = err.response?.status;
                let message = 'Error inesperado al cargar.';
                if (status === 400) message = 'La orden ya fue ingresada previamente en depósito.';
                if (status === 403) message = 'El campo cliente se encuentra vacío en la etiqueta.';
                if (status === 404) message = 'Cliente no encontrado en el sistema.';
                if (status === 405) message = 'Producto no encontrado en el sistema.';
                if (status === 500) message = 'Falla interna del servidor. Carga rechazada.';
                return { id: codeObj.id, status: 'error', message };
            }
        });

        const results = await Promise.all(promises);

        setCodes(prev => prev.map(c => {
            const r = results.find(res => res.id === c.id);
            if (r) return { ...c, status: r.status, message: r.message };
            return c;
        });

        setLoading(false);

        // Limpieza de inputs
        setCodes(curr => {
            const last = curr[curr.length - 1];
            if (last && last.value !== '') {
                return [...curr, { value: '', id: Date.now(), status: 'idle', message: '', parsed: null }];
            }
            return curr;
        });

        // Enfocar el último
        setTimeout(() => {
            const lastCodeObj = inputRefs.current[codes[codes.length - 1]?.id];
            if (lastCodeObj) lastCodeObj.focus();
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

    return (
        <div className="p-4 lg:p-8 max-w-[1600px] w-full mx-auto min-h-[85vh] flex gap-8 flex-col xl:flex-row bg-[#f6f8fb]">

            {/* PANEL IZQUIERDO: Inputs */}
            <div className="w-full xl:w-[45%] flex flex-col pt-8 bg-white rounded-2xl shadow-sm border border-slate-200">
                <h1 className="text-3xl font-black text-slate-800 mb-6 text-center tracking-tight">Carga de Códigos</h1>

                <div className="w-full px-6 lg:px-12 flex flex-col gap-3 min-h-[40vh] max-h-[60vh] overflow-y-auto pb-6 scrollbar-thin scrollbar-thumb-slate-200">
                    {codes.map((code, index) => (
                        <div key={code.id} className="w-full relative group flex items-center">
                            <input
                                ref={el => inputRefs.current[code.id] = el}
                                type="text"
                                className={`w-full text-center font-bold text-slate-700 py-3 rounded-lg border-2 outline-none transition-all 
                                    ${code.status === 'error' ? 'border-rose-400 bg-rose-50' :
                                        code.status === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' :
                                            code.status === 'info' ? 'border-blue-300 bg-blue-50 text-blue-800' :
                                                code.status === 'validating' ? 'border-amber-300 bg-amber-50 text-amber-800' :
                                                    'border-slate-200 focus:border-[#3b82f6] focus:bg-blue-50/30'}`}
                                value={code.value}
                                placeholder={index === codes.length - 1 ? 'Escanee la etiqueta aquí...' : ''}
                                onInput={(e) => handleInput(code.id, e.target.value)}
                                onPaste={(e) => handlePaste(e, code.id)}
                                onKeyDown={(e) => handleKeyDown(e, index)}
                                disabled={code.status === 'loading' || code.status === 'success' || code.status === 'info'}
                                autoComplete="off"
                            />
                            {/* Loader durante la validacion async */}
                            {code.status === 'validating' && (
                                <div className="absolute right-4 text-amber-500">
                                    <Loader2 className="animate-spin" size={20} />
                                </div>
                            )}

                            {/* Boton flotante derecho para eliminar la fila */}
                            <button
                                tabIndex={-1}
                                onClick={() => removeRow(code.id)}
                                className={`absolute -right-8 text-slate-300 hover:text-rose-500 p-2 opacity-0 group-hover:opacity-100 transition-opacity ${code.status === 'loading' ? 'hidden' : ''}`}
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    ))}
                </div>

                <div className="w-full px-6 lg:px-12 pb-10 mt-auto">
                    <button
                        onClick={processCodes}
                        disabled={loading || codes.every(c => c.value.trim() === '' || c.status === 'error' || c.status === 'success' || c.status === 'info' || c.status === 'validating')}
                        className="w-full py-4 bg-[#409cf9] hover:bg-[#2b86ea] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl uppercase tracking-widest shadow-md transition-colors flex justify-center items-center gap-2 text-md"
                    >
                        {loading ? <><Loader2 size={20} className="animate-spin" /> Guardando...</> : 'Confirmar Carga'}
                    </button>
                </div>
            </div>

            {/* PANEL DERECHO: Tarjetas asincrónicas ampliadas */}
            <div className="w-full xl:w-[55%] flex flex-col p-4 bg-transparent">
                <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <PackageSearch className="text-[#409cf9]" /> Resultados y Validaciones
                </h2>

                <div className="flex flex-col gap-4 max-h-[75vh] overflow-y-auto pr-2 pb-10 scrollbar-thin scrollbar-thumb-slate-300">
                    {codes.slice().reverse().filter(c => c.value.trim() !== '').map(code => {
                        const isError = code.status === 'error';
                        const isSuccess = code.status === 'success';
                        const isInfo = code.status === 'info';
                        const isLoading = code.status === 'loading' || code.status === 'validating';
                        const isIdle = code.status === 'idle';

                        const rawStringDisplay = code.parsed ? code.parsed.CodigoOrden : (code.value.length > 25 ? code.value.substring(0, 25) + '...' : code.value);

                        return (
                            <div key={`card-${code.id}`} className={`p-5 rounded-2xl border flex items-start gap-5 transition-all shadow-sm bg-white
                                ${isError ? 'border-rose-300' :
                                    isSuccess ? 'border-emerald-300' :
                                        isInfo ? 'border-blue-300' :
                                            isLoading ? 'border-amber-300 opacity-90' : 'border-slate-200'
                                }
                            `}>
                                {/* Icono Lado Izquierdo */}
                                <div className="mt-1">
                                    {isError && <AlertCircle className="text-rose-500 transform scale-110" size={32} />}
                                    {isSuccess && <CheckCircle2 className="text-emerald-500 transform scale-110" size={32} />}
                                    {isInfo && <Info className="text-blue-500 transform scale-110" size={32} />}
                                    {isLoading && <Loader2 className="text-amber-500 animate-spin" size={32} />}
                                    {isIdle && <Package className="text-slate-400" size={32} />}
                                </div>

                                <div className="flex-1 flex flex-col w-full overflow-hidden">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className={`font-black text-xl truncate ${isError ? 'text-rose-800' : isSuccess ? 'text-emerald-800' : 'text-slate-800'}`}>
                                            {rawStringDisplay}
                                        </span>
                                        {/* Status Badge */}
                                        <span className={`px-2.5 py-1 text-xs font-bold uppercase rounded-md tracking-wider border shrink-0
                                            ${isError ? 'bg-rose-50 text-rose-600 border-rose-200' :
                                                isSuccess ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                                    isInfo ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                                        code.status === 'validating' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                                            isLoading ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                                                'bg-slate-100 text-slate-500 border-slate-200'
                                            }
                                        `}>
                                            {isError ? 'ALERTA / RECHAZADO' :
                                                isSuccess ? 'CARGADO CON ÉXITO' :
                                                    isInfo ? 'REINGRESADO' :
                                                        code.status === 'validating' ? 'VERIFICANDO...' :
                                                            isLoading ? 'GUARDANDO...' : 'LISTO PARA CARGAR'}
                                        </span>
                                    </div>

                                    {/* Mostrar Información Completa parseada */}
                                    {code.parsed && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 mt-2 bg-slate-50 rounded-xl p-4 border border-slate-100">

                                            {/* Columna 1: Cliente y Tipo */}
                                            <div className="flex flex-col gap-1">
                                                <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-wide">
                                                    <span className="flex items-center gap-1"><User size={12} /> Cliente</span>
                                                    <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{code.parsed.TipoCliente}</span>
                                                </div>
                                                <span className="text-slate-800 font-semibold truncate" title={code.parsed.CodigoCliente}>
                                                    {code.parsed.CodigoCliente}
                                                </span>
                                            </div>

                                            {/* Columna 2: Producto */}
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wide">
                                                    <ShoppingBag size={12} /> Producto
                                                </div>
                                                <span className="text-slate-800 font-semibold truncate" title={code.parsed.ProductoNombre}>
                                                    {code.parsed.ProductoNombre}
                                                </span>
                                            </div>

                                            {/* Columna 3: Precio y Moneda */}
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wide">
                                                    <DollarSign size={12} /> Importe
                                                </div>
                                                <span className="text-slate-800 font-black">
                                                    {code.parsed.Moneda} {code.parsed.CostoFinal?.toFixed(2)}
                                                </span>
                                            </div>

                                            {/* Columna 4: Trabajo */}
                                            <div className="flex flex-col gap-1 lg:col-span-2">
                                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wide">
                                                    <Tag size={12} /> Nombre de Trabajo
                                                </div>
                                                <span className="text-slate-700 italic truncate" title={code.parsed.NombreTrabajo}>
                                                    {code.parsed.NombreTrabajo || 'Sin Descripción'}
                                                </span>
                                            </div>

                                            {/* Columna 5: Cantidad y Modalidad */}
                                            <div className="flex items-center justify-between col-span-1 lg:col-span-1 border-l pl-4 border-slate-200">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Cant</span>
                                                    <span className="text-slate-800 font-black text-lg">{code.parsed.Cantidad}</span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1"><Activity size={12} /> Modalidad</span>
                                                    <span className="text-slate-800 font-semibold">{modosMap[code.parsed.IdModo] || `M-${code.parsed.IdModo}`}</span>
                                                </div>
                                            </div>

                                        </div>
                                    )}

                                    {/* Mostrar el mensaje de error o éxito */}
                                    {code.message && (
                                        <div className={`mt-3 text-sm font-semibold p-3.5 rounded-xl border
                                            ${isError ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                isSuccess ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                    'bg-blue-50 text-blue-800 border-blue-200'
                                            }
                                        `}>
                                            {code.message}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {codes.filter(c => c.value.trim() !== '').length === 0 && (
                        <div className="flex flex-col items-center justify-center p-16 mt-8 mx-4 text-slate-400 bg-white shadow-sm border border-slate-200 rounded-3xl">
                            <PackageSearch size={64} strokeWidth={1.5} className="mb-6 text-blue-400 opacity-60" />
                            <h3 className="text-xl font-bold text-slate-800 mb-2">Panel de Validaciones</h3>
                            <p className="font-medium text-center text-slate-500 max-w-sm">
                                A medida que ingrese los códigos en el panel central, iremos verificando en tiempo real si toda la información está correcta.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CargaDepositoPage;
