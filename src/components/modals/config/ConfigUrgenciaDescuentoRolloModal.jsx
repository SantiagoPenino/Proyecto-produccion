import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../services/apiClient';

const ConfigUrgenciaDescuentoRolloModal = ({ isOpen, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const [activo, setActivo] = useState(false);
    const [porcentaje, setPorcentaje] = useState(25);
    const [modo, setModo] = useState('PILOTO'); // 'PILOTO' | 'TODOS'

    const [excepciones, setExcepciones] = useState([]);
    const [excLoading, setExcLoading] = useState(false);

    const [cliSearch, setCliSearch] = useState('');
    const [cliResults, setCliResults] = useState([]);
    const [cliDropOpen, setCliDropOpen] = useState(false);
    const [selectedCli, setSelectedCli] = useState(null);
    const [motivo, setMotivo] = useState('');

    const esPiloto = modo === 'PILOTO';

    useEffect(() => {
        if (isOpen) {
            loadConfig();
            loadExcepciones();
        }
    }, [isOpen]);

    useEffect(() => {
        if (!cliSearch.trim()) { setCliResults([]); setCliDropOpen(false); return; }
        const t = setTimeout(async () => {
            try {
                const res = await api.get('/clients/search', { params: { q: cliSearch, limit: 15 } });
                setCliResults(res.data?.data || res.data || []);
                setCliDropOpen(true);
            } catch { setCliResults([]); }
        }, 300);
        return () => clearTimeout(t);
    }, [cliSearch]);

    const loadConfig = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get('/profiles/urgencia-descuento-rollo/config');
            setActivo(!!res.data?.data?.activo);
            setPorcentaje(res.data?.data?.porcentaje ?? 25);
            setModo(res.data?.data?.modo === 'TODOS' ? 'TODOS' : 'PILOTO');
        } catch (err) {
            console.error(err);
            setError('Error cargando la configuración.');
        } finally {
            setLoading(false);
        }
    };

    const loadExcepciones = async () => {
        setExcLoading(true);
        try {
            const res = await api.get('/profiles/urgencia-descuento-rollo/excepciones');
            setExcepciones(res.data?.data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setExcLoading(false);
        }
    };

    const handleToggleActivo = async () => {
        const nuevo = !activo;
        setActivo(nuevo);
        setSaving(true);
        try {
            await api.put('/profiles/urgencia-descuento-rollo/config', { activo: nuevo });
        } catch (err) {
            console.error(err);
            setActivo(!nuevo);
            setError('Error al guardar el cambio.');
        } finally {
            setSaving(false);
        }
    };

    const handleSavePorcentaje = async () => {
        const val = parseFloat(porcentaje);
        if (isNaN(val) || val <= 0 || val > 100) {
            setError('El porcentaje debe ser un número entre 0 y 100.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await api.put('/profiles/urgencia-descuento-rollo/config', { porcentaje: val });
        } catch (err) {
            console.error(err);
            setError('Error al guardar el porcentaje.');
        } finally {
            setSaving(false);
        }
    };

    const handleChangeModo = async (nuevoModo) => {
        if (nuevoModo === modo) return;
        const confirmMsg = nuevoModo === 'TODOS'
            ? '¿Pasar a modo "Todos"? El recargo empezará a aplicar a TODOS los clientes con orden Urgente + excepción de cobro, excepto los que estén en la lista de abajo.'
            : '¿Volver a modo "Piloto"? El recargo dejará de aplicar a todos y volverá a aplicar SOLO a los clientes de la lista de abajo.';
        if (!window.confirm(confirmMsg)) return;

        const anterior = modo;
        setModo(nuevoModo);
        setSaving(true);
        try {
            await api.put('/profiles/urgencia-descuento-rollo/config', { modo: nuevoModo });
        } catch (err) {
            console.error(err);
            setModo(anterior);
            setError('Error al cambiar el modo.');
        } finally {
            setSaving(false);
        }
    };

    const handleAddExcepcion = async () => {
        if (!selectedCli) return;
        try {
            await api.post('/profiles/urgencia-descuento-rollo/excepciones', {
                CliIdCliente: selectedCli.CliIdCliente,
                Motivo: motivo || null,
            });
            setSelectedCli(null);
            setCliSearch('');
            setMotivo('');
            loadExcepciones();
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.error || 'Error al guardar.');
        }
    };

    const handleDeleteExcepcion = async (id) => {
        const confirmMsg = esPiloto
            ? '¿Sacar a este cliente del piloto? Dejará de pagar el recargo de metros por urgencia.'
            : '¿Volver a cobrarle a este cliente el recargo de metros por urgencia?';
        if (!window.confirm(confirmMsg)) return;
        try {
            await api.delete(`/profiles/urgencia-descuento-rollo/excepciones/${id}`);
            loadExcepciones();
        } catch (err) {
            console.error(err);
            setError('Error al eliminar.');
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-900/50 p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-zinc-200 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="bg-zinc-900 px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 text-white">
                        <div className="p-2 bg-white/10 rounded-lg">
                            <i className="fa-solid fa-bolt text-amber-400"></i>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Recargo Urgencia s/Rollo</h3>
                            <p className="text-xs text-zinc-400">Cobra metros extra del rollo por adelantado cuando la urgencia no se cobra en $</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-2 rounded-full w-8 h-8 flex items-center justify-center"
                    >
                        <i className="fa-solid fa-times"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto bg-zinc-50 flex-1 space-y-6">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold border border-red-100">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex justify-center py-8 text-zinc-400">
                            <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
                        </div>
                    ) : (
                        <>
                            {/* Modo de rollout */}
                            <div className="bg-white rounded-xl border border-zinc-200 p-4">
                                <p className="font-bold text-sm text-zinc-800 mb-1">Modo</p>
                                <p className="text-xs text-zinc-500 mb-3">
                                    Elegí cómo se usa la lista de clientes de más abajo.
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => handleChangeModo('PILOTO')}
                                        disabled={saving}
                                        className={`text-left p-3 rounded-lg border-2 transition-colors ${esPiloto ? 'border-indigo-500 bg-indigo-50' : 'border-zinc-200 hover:border-zinc-300'}`}
                                    >
                                        <p className={`text-sm font-bold ${esPiloto ? 'text-indigo-700' : 'text-zinc-700'}`}>Piloto</p>
                                        <p className="text-[11px] text-zinc-500 mt-0.5">Solo pagan el recargo los clientes que agregues a la lista.</p>
                                    </button>
                                    <button
                                        onClick={() => handleChangeModo('TODOS')}
                                        disabled={saving}
                                        className={`text-left p-3 rounded-lg border-2 transition-colors ${!esPiloto ? 'border-indigo-500 bg-indigo-50' : 'border-zinc-200 hover:border-zinc-300'}`}
                                    >
                                        <p className={`text-sm font-bold ${!esPiloto ? 'text-indigo-700' : 'text-zinc-700'}`}>Todos</p>
                                        <p className="text-[11px] text-zinc-500 mt-0.5">Pagan todos, excepto los que agregues a la lista.</p>
                                    </button>
                                </div>
                            </div>

                            {/* Flag general */}
                            <div className="bg-white rounded-xl border border-zinc-200 p-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-bold text-sm text-zinc-800">Activar recargo</p>
                                        <p className="text-xs text-zinc-500 mt-0.5">
                                            Cuando una orden Urgente no cobra el recargo de urgencia en $ (por excepción existente),
                                            la orden consume un {porcentaje || 25}% MÁS de metros del rollo por adelantado, como recargo.
                                            {esPiloto
                                                ? ' En modo Piloto, esto solo afecta a los clientes de la lista de abajo.'
                                                : ' En modo Todos, esto afecta a todos los clientes, excepto los de la lista de abajo.'}
                                        </p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={activo}
                                            disabled={saving}
                                            onChange={handleToggleActivo}
                                        />
                                        <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                    </label>
                                </div>

                                <div className="mt-4 pt-4 border-t border-zinc-100 flex items-center gap-3">
                                    <label className="text-xs font-bold text-zinc-500 uppercase">Porcentaje de recargo</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        className="w-24 p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-zinc-700"
                                        value={porcentaje}
                                        onChange={(e) => setPorcentaje(e.target.value)}
                                    />
                                    <span className="text-sm text-zinc-500">%</span>
                                    <button
                                        onClick={handleSavePorcentaje}
                                        disabled={saving}
                                        className="ml-auto px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 text-xs shadow-md active:scale-95 transition-transform disabled:opacity-50"
                                    >
                                        Guardar %
                                    </button>
                                </div>
                            </div>

                            {/* Lista de clientes — piloto o excepciones según el modo */}
                            <div className="bg-white rounded-xl border border-zinc-200 p-4">
                                <p className="font-bold text-sm text-zinc-800 mb-1">
                                    {esPiloto ? 'Clientes en el piloto' : 'Clientes excluidos del recargo'}
                                </p>
                                <p className="text-xs text-zinc-500 mb-3">
                                    {esPiloto
                                        ? 'Solo estos clientes pagan el recargo de metros por urgencia. El resto no se ve afectado.'
                                        : 'Aunque el flag general esté activo, a estos clientes NO se les cobra el % extra de metros por urgencia.'}
                                </p>

                                <div className="relative flex gap-2 mb-4">
                                    <div className="relative flex-1">
                                        <input
                                            type="text"
                                            placeholder="Buscar cliente por nombre o código..."
                                            className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                            value={selectedCli ? selectedCli.Nombre : cliSearch}
                                            onChange={(e) => { setSelectedCli(null); setCliSearch(e.target.value); }}
                                            onFocus={() => cliResults.length > 0 && setCliDropOpen(true)}
                                        />
                                        {cliDropOpen && cliResults.length > 0 && (
                                            <div className="absolute z-10 top-full left-0 right-0 bg-white border border-zinc-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                                                {cliResults.map(c => (
                                                    <button
                                                        key={c.CliIdCliente}
                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 border-b border-zinc-50 last:border-0"
                                                        onClick={() => { setSelectedCli(c); setCliSearch(''); setCliDropOpen(false); }}
                                                    >
                                                        {c.Nombre}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Motivo (opcional)"
                                        className="w-40 p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={motivo}
                                        onChange={(e) => setMotivo(e.target.value)}
                                    />
                                    <button
                                        onClick={handleAddExcepcion}
                                        disabled={!selectedCli}
                                        className="px-4 py-2 bg-zinc-900 text-white font-bold rounded-lg hover:bg-zinc-800 text-xs shadow-md active:scale-95 transition-transform disabled:opacity-40 shrink-0"
                                    >
                                        {esPiloto ? 'Agregar' : 'Excluir'}
                                    </button>
                                </div>

                                {excLoading ? (
                                    <div className="flex justify-center py-4 text-zinc-400">
                                        <i className="fa-solid fa-circle-notch fa-spin"></i>
                                    </div>
                                ) : excepciones.length === 0 ? (
                                    <p className="text-center text-zinc-400 text-sm py-4">
                                        {esPiloto ? 'Nadie en el piloto todavía — el recargo no se le cobra a nadie.' : 'Ningún cliente excluido — el recargo aplica a todos.'}
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {excepciones.map(e => (
                                            <div key={e.ID} className="flex items-center justify-between p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                                                <div>
                                                    <p className="text-sm font-bold text-zinc-800">{e.ClienteNombre}</p>
                                                    {e.Motivo && <p className="text-xs text-zinc-500">{e.Motivo}</p>}
                                                </div>
                                                <button
                                                    onClick={() => handleDeleteExcepcion(e.ID)}
                                                    className="text-red-500 hover:text-red-700 text-xs font-bold"
                                                >
                                                    <i className="fa-solid fa-trash mr-1"></i> Quitar
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-white border-t border-zinc-100 flex justify-end shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-zinc-900 text-white font-bold rounded-xl text-sm hover:bg-zinc-800 transition-colors shadow-lg shadow-zinc-300/50"
                    >
                        Cerrar
                    </button>
                </div>

            </div>
        </div>,
        document.body
    );
};

export default ConfigUrgenciaDescuentoRolloModal;
