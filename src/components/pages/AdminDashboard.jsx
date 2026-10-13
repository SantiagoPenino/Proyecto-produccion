// SIN USO (13/10): nunca se importó. Es el único que llama a GET /api/admin/dynamic (adminController.getDynamicData). Ver docs/auditoria-limpieza-2026-10-09.md.
import React, { useState, useEffect } from 'react';
import DynamicGrid from '../common/DynamicGrid';
import { API_URL } from '../../services/apiClient';

const AdminDashboard = () => {
    const [reportType, setReportType] = useState('orders'); // 'orders', 'rolls', 'machines'
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);

    // Carga de datos
    const fetchData = async () => {
        setLoading(true);
        try {
            // Asegúrate que el puerto 5000 sea correcto para tu backend
            const res = await fetch(`${API_URL}/admin/dynamic?reportType=${reportType}`);
            if (res.ok) {
                const json = await res.json();
                setData(json);
            }
        } catch (e) {
            console.error("Error cargando reporte:", e);
        } finally {
            setLoading(false);
        }
    };

    // Recargar al cambiar pestaña
    useEffect(() => {
        fetchData();
    }, [reportType]);

    // Helper para clases CSS condicionales
    const getTabClass = (type) => {
        return `px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-sm border
        ${reportType === type
                ? 'bg-slate-800 text-white border-slate-900 shadow-md ring-2 ring-slate-200'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800'}`;
    };

    return (
        <div className="flex flex-col h-screen p-6 bg-slate-50 font-sans">

            {/* CABECERA */}
            <div className="flex justify-between items-center mb-6 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center text-slate-600 shadow-inner">
                        <i className="fa-solid fa-database text-xl"></i>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Panel DB</h1>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Administración de Datos</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        className={getTabClass('orders')}
                        onClick={() => setReportType('orders')}
                    >
                        <i className="fa-solid fa-clipboard-list"></i> Órdenes
                    </button>

                    <button
                        className={getTabClass('rolls')}
                        onClick={() => setReportType('rolls')}
                    >
                        <i className="fa-solid fa-scroll"></i> Rollos
                    </button>

                    <button
                        className={getTabClass('machines')}
                        onClick={() => setReportType('machines')}
                    >
                        <i className="fa-solid fa-industry"></i> Equipos
                    </button>

                    <div className="w-px h-8 bg-slate-300 mx-2"></div>

                    <button
                        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-blue-500 hover:shadow-sm border border-transparent hover:border-slate-200 transition-all"
                        onClick={fetchData}
                        title="Recargar datos"
                    >
                        <i className={`fa-solid fa-rotate-right text-lg ${loading ? 'fa-spin' : ''}`}></i>
                    </button>
                </div>
            </div>

            {/* GRID DINÁMICO */}
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <DynamicGrid data={data} loading={loading} />
            </div>

        </div>
    );
};

export default AdminDashboard;
