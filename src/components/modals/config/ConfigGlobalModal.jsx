import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../services/apiClient';

// Editor de la tabla ConfiguracionGlobal (Clave / Área / Valor).
// Cada clave la consume el módulo que corresponde; acá solo se cambia el Valor.
const ConfigGlobalModal = ({ isOpen, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [ok, setOk] = useState(null);

    const [rows, setRows] = useState([]);
    const [edits, setEdits] = useState({});   // { Clave: valorEditado }
    const [savingKey, setSavingKey] = useState(null);
    const [search, setSearch] = useState('');

    const [nuevaClave, setNuevaClave] = useState('');
    const [nuevoValor, setNuevoValor] = useState('');
    const [nuevaArea, setNuevaArea] = useState('ADMIN');
    const [agregando, setAgregando] = useState(false);

    useEffect(() => {
        if (isOpen) load();
    }, [isOpen]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get('/admin/config-global');
            setRows(res.data?.data || []);
            setEdits({});
        } catch (err) {
            console.error(err);
            setError('Error cargando la configuración general.');
        } finally {
            setLoading(false);
        }
    };

    const filtradas = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(r =>
            (r.Clave || '').toLowerCase().includes(q) ||
            (r.Valor || '').toLowerCase().includes(q)
        );
    }, [rows, search]);

    const valorDe = (r) => (edits[r.Clave] !== undefined ? edits[r.Clave] : (r.Valor ?? ''));
    const cambiada = (r) => edits[r.Clave] !== undefined && edits[r.Clave] !== (r.Valor ?? '');

    const handleGuardar = async (r) => {
        const valor = valorDe(r);
        if (!window.confirm(`Guardar en la base:\n\n${r.Clave} = "${valor}"\n\n(antes: "${r.Valor ?? ''}")\n\nEl cambio afecta al módulo que usa esta clave.`)) return;

        setSavingKey(r.Clave);
        setError(null);
        setOk(null);
        try {
            await api.put('/admin/config-global', { clave: r.Clave, valor, areaID: r.AreaID });
            setRows(prev => prev.map(x => x.Clave === r.Clave ? { ...x, Valor: valor } : x));
            setEdits(prev => { const c = { ...prev }; delete c[r.Clave]; return c; });
            setOk(`${r.Clave} guardada.`);
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.error || 'Error al guardar.');
        } finally {
            setSavingKey(null);
        }
    };

    const handleAgregar = async () => {
        const clave = nuevaClave.trim();
        if (!clave) return;
        if (rows.some(r => r.Clave.toLowerCase() === clave.toLowerCase())) {
            setError('Esa clave ya existe en la lista.');
            return;
        }
        if (!window.confirm(`Crear la clave nueva:\n\n${clave} = "${nuevoValor}"  (área ${nuevaArea || 'ADMIN'})`)) return;

        setAgregando(true);
        setError(null);
        setOk(null);
        try {
            await api.put('/admin/config-global', { clave, valor: nuevoValor, areaID: nuevaArea || 'ADMIN' });
            setNuevaClave('');
            setNuevoValor('');
            setOk(`${clave} creada.`);
            load();
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.error || 'Error al crear la clave.');
        } finally {
            setAgregando(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-900/50 p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden border border-zinc-200 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="bg-zinc-900 px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 text-white">
                        <div className="p-2 bg-white/10 rounded-lg">
                            <i className="fa-solid fa-sliders text-cyan-400"></i>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Configuración General</h3>
                            <p className="text-xs text-zinc-400">Tabla ConfiguracionGlobal — el cambio impacta apenas se guarda</p>
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
                <div className="p-6 overflow-y-auto bg-zinc-50 flex-1 space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold border border-red-100">{error}</div>
                    )}
                    {ok && (
                        <div className="bg-emerald-50 text-emerald-700 p-3 rounded-xl text-sm font-bold border border-emerald-100">{ok}</div>
                    )}

                    <input
                        type="text"
                        placeholder="Buscar por clave o valor..."
                        className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />

                    {loading ? (
                        <div className="flex justify-center py-10 text-zinc-400">
                            <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-zinc-100 text-zinc-500 text-[11px] uppercase tracking-wider">
                                    <tr>
                                        <th className="text-left px-4 py-2 font-bold">Clave</th>
                                        <th className="text-left px-4 py-2 font-bold w-20">Área</th>
                                        <th className="text-left px-4 py-2 font-bold">Valor</th>
                                        <th className="px-4 py-2 w-28"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtradas.length === 0 ? (
                                        <tr><td colSpan={4} className="text-center text-zinc-400 py-6">No hay claves que coincidan.</td></tr>
                                    ) : filtradas.map(r => (
                                        <tr key={r.Clave} className="border-t border-zinc-100">
                                            <td className="px-4 py-2 font-bold text-zinc-800 font-mono text-xs">{r.Clave}</td>
                                            <td className="px-4 py-2 text-zinc-500 text-xs">{r.AreaID}</td>
                                            <td className="px-4 py-2">
                                                <input
                                                    type="text"
                                                    className={`w-full p-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 ${cambiada(r) ? 'border-amber-400 bg-amber-50' : 'border-zinc-200'}`}
                                                    value={valorDe(r)}
                                                    onChange={(e) => setEdits(prev => ({ ...prev, [r.Clave]: e.target.value }))}
                                                />
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                <button
                                                    onClick={() => handleGuardar(r)}
                                                    disabled={!cambiada(r) || savingKey === r.Clave}
                                                    className="px-3 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 text-xs shadow-md active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
                                                >
                                                    {savingKey === r.Clave ? <i className="fa-solid fa-circle-notch fa-spin"></i> : 'Guardar'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Alta de clave nueva */}
                    <div className="bg-white rounded-xl border border-zinc-200 p-4">
                        <p className="font-bold text-sm text-zinc-800 mb-1">Agregar una clave nueva</p>
                        <p className="text-xs text-zinc-500 mb-3">Solo sirve si el código ya lee esa clave; escribirla acá no crea comportamiento por sí sola.</p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="CLAVE"
                                maxLength={50}
                                className="flex-1 p-2 text-sm border border-zinc-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                                value={nuevaClave}
                                onChange={(e) => setNuevaClave(e.target.value)}
                            />
                            <input
                                type="text"
                                placeholder="Área"
                                maxLength={10}
                                className="w-24 p-2 text-sm border border-zinc-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                value={nuevaArea}
                                onChange={(e) => setNuevaArea(e.target.value)}
                            />
                            <input
                                type="text"
                                placeholder="Valor"
                                className="flex-1 p-2 text-sm border border-zinc-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                value={nuevoValor}
                                onChange={(e) => setNuevoValor(e.target.value)}
                            />
                            <button
                                onClick={handleAgregar}
                                disabled={!nuevaClave.trim() || agregando}
                                className="px-4 py-2 bg-zinc-900 text-white font-bold rounded-lg hover:bg-zinc-800 text-xs shadow-md active:scale-95 transition-transform disabled:opacity-40 shrink-0"
                            >
                                {agregando ? <i className="fa-solid fa-circle-notch fa-spin"></i> : 'Agregar'}
                            </button>
                        </div>
                    </div>
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

export default ConfigGlobalModal;
