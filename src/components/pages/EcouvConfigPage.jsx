import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import StockArtEditModal from '../modals/config/StockArtEditModal';

// Configuración ECOUV — vista para el SECTOR (se publica por Menú del Sistema +
// Roles, ruta /area/ecouv/config). Reúne las herramientas del área sin exponer
// la administración global: variantes/artículos del grupo 1.3, catálogo de
// terminaciones, fichas de productos y la bandeja de trabajo.
const GRUPO_ECOUV = '1.3';

const ToolCard = ({ icon, iconBg, title, subtitle, onClick, footer }) => (
    <button onClick={onClick}
        className="group bg-white rounded-2xl border border-slate-200 hover:border-cyan-400 hover:shadow-xl hover:shadow-cyan-500/10 transition-all p-6 text-left flex flex-col gap-3 relative overflow-hidden">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg bg-gradient-to-br ${iconBg} shadow-sm`}>
            <i className={`fa-solid ${icon}`}></i>
        </div>
        <div>
            <h3 className="font-black text-slate-800 group-hover:text-cyan-700 transition-colors">{title}</h3>
            <p className="text-xs text-slate-500 mt-1 leading-snug">{subtitle}</p>
        </div>
        {footer && <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-auto">{footer}</span>}
        <i className="fa-solid fa-chevron-right absolute right-5 top-1/2 -translate-y-1/2 text-slate-200 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all"></i>
    </button>
);

const EcouvConfigPage = () => {
    const navigate = useNavigate();
    const [modal, setModal] = useState(null); // null | 'variantes' | 'terminaciones'
    const [stats, setStats] = useState(null);

    // Resumen del área: variantes visibles, artículos y terminaciones activas
    const loadStats = async () => {
        try {
            const [va, te] = await Promise.all([
                api.get(`/stockart?grupo=${GRUPO_ECOUV}`),
                api.get('/stockart/terminaciones')
            ]);
            const rows = va.data?.data || [];
            const visibles = rows.filter(r => r.Mostrar);
            setStats({
                variantes: visibles.length,
                articulos: rows.reduce((acc, r) => acc + (r.CantArticulos || 0), 0),
                terminaciones: (te.data?.data || []).length
            });
        } catch (e) {
            console.error('Error cargando resumen ECOUV:', e);
        }
    };

    useEffect(() => { loadStats(); }, []);

    return (
        <div className="p-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-2">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30">
                    <i className="fa-solid fa-print text-xl"></i>
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Configuración ECOUV</h1>
                    <p className="text-sm text-slate-400">Variantes, terminaciones y fichas del área de impresión Eco/UV</p>
                </div>
            </div>

            {/* Resumen */}
            {stats && (
                <div className="flex flex-wrap gap-3 my-5">
                    <span className="bg-cyan-50 text-cyan-700 border border-cyan-200 px-3 py-1.5 rounded-full text-xs font-bold">
                        {stats.variantes} variantes visibles
                    </span>
                    <span className="bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1.5 rounded-full text-xs font-bold">
                        {stats.articulos} artículos
                    </span>
                    <span className="bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full text-xs font-bold">
                        {stats.terminaciones} terminaciones activas
                    </span>
                </div>
            )}

            {/* Herramientas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
                <ToolCard
                    icon="fa-boxes-stacked"
                    iconBg="from-purple-500 to-fuchsia-600"
                    title="Variantes y Artículos"
                    subtitle="Lonas, Canvas, Vinilos, Cuadros, Pasacalles... Crear variantes, cambiar el tipo (Material / Prod. Terminado), ocultar del portal y mover artículos entre variantes."
                    footer="Editor StockArt · grupo 1.3"
                    onClick={() => setModal('variantes')}
                />
                <ToolCard
                    icon="fa-scissors"
                    iconBg="from-amber-500 to-orange-600"
                    title="Catálogo de Terminaciones"
                    subtitle="Alta y edición de terminaciones (ojales, soldadura, bastidor...): unidad de cobro, artículo para facturar y activar/desactivar."
                    footer="Se ofrecen según el material"
                    onClick={() => setModal('terminaciones')}
                />
                <ToolCard
                    icon="fa-box-open"
                    iconBg="from-blue-500 to-indigo-600"
                    title="Fichas de Productos y Materiales"
                    subtitle="Por artículo: terminaciones que acepta cada material, ficha del producto terminado (medidas, material de impresión, tinta, incluidas), ancho imprimible y precios."
                    footer="Catálogo y WMS → Editar Artículo"
                    onClick={() => navigate('/admin/products-integration')}
                />
                <ToolCard
                    icon="fa-list-check"
                    iconBg="from-emerald-500 to-teal-600"
                    title="Bandeja de Terminaciones"
                    subtitle="Trabajo diario del sector: checklist de terminaciones por archivo de cada orden, marcar Hechas y finalizar para liberar a logística."
                    footer="Órdenes En Terminaciones"
                    onClick={() => navigate('/produccion/terminaciones')}
                />
            </div>

            <p className="text-[11px] text-slate-400 mt-8">
                <i className="fa-solid fa-circle-info mr-1.5"></i>
                Los cambios impactan al instante en el pedido web del portal (variantes, materiales y terminaciones que ve el cliente).
            </p>

            {/* Modales */}
            {modal === 'variantes' && (
                <StockArtEditModal isOpen={true} initialGrupo={GRUPO_ECOUV} onClose={() => { setModal(null); loadStats(); }} />
            )}
            {modal === 'terminaciones' && (
                <StockArtEditModal isOpen={true} initialGrupo={GRUPO_ECOUV} initialView="terminaciones" onClose={() => { setModal(null); loadStats(); }} />
            )}
        </div>
    );
};

export default EcouvConfigPage;
