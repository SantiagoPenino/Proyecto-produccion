import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { areasService, externalService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { socket } from '../../services/socketService'; // IMPORT SOCKET CORRECTED

// Importa el componente del modal que creamos antes
import PedidoModal from '../modals/PedidoModal';

import ConfigPrintersModal from '../modals/config/ConfigPrintersModal';
import ConfigInsumosModal from '../modals/config/ConfigInsumosModal';
import ConfigFlowsModal from '../modals/config/ConfigFlowsModal';
import ConfigStatusesModal from '../modals/config/ConfigStatusesModal';
import ConfigRouteRulesModal from '../modals/config/ConfigRouteRulesModal';
import ConfigDeliveryTimesModal from '../modals/config/ConfigDeliveryTimesModal';

export default function ConfigPage({ onBack }) {
    const navigate = useNavigate();
    const [logs, setLogs] = useState([]);
    const [isLogModalOpen, setIsLogModalOpen] = useState(false);
    const [areas, setAreas] = useState([]);
    const [selectedAreaId, setSelectedAreaId] = useState('');
    const [loading, setLoading] = useState(false);
    const [importingERP, setImportingERP] = useState(false);
    const [activeModal, setActiveModal] = useState(null);

    // --- NUEVOS ESTADOS PARA EL DETALLE DEL PEDIDO ---
    const [selectedPedido, setSelectedPedido] = useState(null);
    const [isPedidoModalOpen, setIsPedidoModalOpen] = useState(false);

    const [details, setDetails] = useState({
        equipos: [],
        insumos: [],
        estados: [],
        pedidosNuevos: [] // Inicializado
    });

    const { user } = useAuth();
    const isAdmin = user?.role === 'admin' || user?.rol === 'admin' || user?.perfil === 'admin' || user?.usuario === 'admin';

    // SOCKET LISTENER FOR LOGS
    useEffect(() => {
        if (isLogModalOpen) {
            const handleLog = (data) => {
                const icon = data.type === 'error' ? '❌' : data.type === 'success' ? '✅' : data.type === 'warning' ? '⚠️' : 'ℹ️';
                setLogs(prev => [...prev, `${icon} ${data.message}`]);
            };

            socket.on('sync:log', handleLog);

            return () => {
                socket.off('sync:log', handleLog);
            };
        }
    }, [isLogModalOpen]);

    useEffect(() => {
        loadAreas();
    }, []);

    useEffect(() => {
        if (selectedAreaId) {
            loadAreaDetails(selectedAreaId);
        } else {
            setDetails({ equipos: [], insumos: [], estados: [], pedidosNuevos: [] });
        }
    }, [selectedAreaId]);

    const loadAreas = async () => {
        setLoading(true);
        try {
            const data = await areasService.getAll();
            if (Array.isArray(data)) {
                setAreas(data);
                if (data.length > 0 && !selectedAreaId) {
                    setSelectedAreaId(data[0].code);
                }
            }
        } catch (error) {
            console.error("Error cargando áreas:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadAreaDetails = async (code) => {
        try {
            const data = await areasService.getDetails(code);
            setDetails(prev => ({
                ...prev,
                equipos: Array.isArray(data?.equipos) ? data.equipos : [],
                insumos: Array.isArray(data?.insumos) ? data.insumos : [],
                estados: Array.isArray(data?.estados) ? data.estados : []
            }));
        } catch (error) {
            console.error("Error detalles:", error);
        }
    };

    const handleImportERP = async () => {
        setLogs(["[SISTEMA] Iniciando comunicación con el servidor..."]);
        setIsLogModalOpen(true);
        setImportingERP(true);

        try {
            const result = await externalService.syncOrders();

            if (result.success && result.pedidos) {
                // Contamos cuántos artículos en total tienen área asignada
                let totalArticulos = 0;
                let mapeados = 0;

                result.pedidos.forEach(p => {
                    p.items.forEach(item => {
                        totalArticulos++;
                        if (item.area_id_asignada) mapeados++;
                    });
                });

                setLogs(prev => [
                    ...prev,
                    "✅ Conexión con ERP exitosa.",
                    `📊 Se procesaron ${result.pedidos.length} pedidos.`,
                    `🎯 Mapeo Automático: ${mapeados} de ${totalArticulos} artículos asignados a un área.`,
                    result.pedidos // Objeto para inspección
                ]);

                setDetails(prev => ({
                    ...prev,
                    pedidosNuevos: result.pedidos
                }));
            }
        } catch (error) {
            setLogs(prev => [...prev, `❌ Error: ${error.message}`]);
        } finally {
            setImportingERP(false);
        }
    };

    // Función para abrir el detalle desde los logs o la lista
    const openPedidoDetail = (pedido) => {
        setSelectedPedido(pedido);
        setIsPedidoModalOpen(true);
    };

    const ConfigCard = ({ title, subtitle, icon, colorClass, onClick, loading }) => (
        <div
            onClick={onClick}
            className="group relative bg-white rounded-2xl p-6 border border-slate-100 shadow-xl shadow-slate-200/50 hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 cursor-pointer overflow-hidden"
        >
            <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${colorClass} opacity-10 rounded-bl-full group-hover:scale-150 transition-transform duration-500`}></div>
            <div className="relative z-10 flex items-start justify-between">
                <div>
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colorClass} text-white flex items-center justify-center text-xl mb-4 shadow-lg`}>
                        {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className={`fa-solid ${icon}`}></i>}
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-1">{title}</h3>
                    <p className="text-sm font-medium text-slate-400">{subtitle}</p>
                </div>
                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-slate-100 group-hover:text-slate-600 transition-colors">
                    <i className="fa-solid fa-chevron-right"></i>
                </div>
            </div>
        </div>
    );
    const currentArea = areas.find(a => a.code === selectedAreaId);
    return (
        <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-800">
            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 flex items-center justify-center transition-colors shadow-sm">
                        <i className="fa-solid fa-arrow-left"></i>
                    </button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Configuración</h1>
                        <p className="text-slate-500 font-medium text-sm">Administración del Sistema</p>
                    </div>
                </div>

                <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-2">Área Activa:</span>
                    <select
                        className="bg-slate-50 border-none text-sm font-bold text-slate-700 rounded-lg py-2 pl-3 pr-8 outline-none cursor-pointer"
                        value={selectedAreaId}
                        onChange={(e) => setSelectedAreaId(e.target.value)}
                        disabled={loading || importingERP}
                    >
                        <option value="">-- Seleccionar --</option>
                        {areas.map(area => (
                            <option key={area.code} value={area.code}>{area.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* ACCIONES GLOBALES */}
            {isAdmin && (
                <div className="mb-10 animate-fade-in-down">
                    <h2 className="text-lg font-black text-slate-700 mb-4 px-1 border-l-4 border-indigo-500">Administración Global</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
                        <ConfigCard
                            title="Usuarios"
                            subtitle="Gestión de personal"
                            icon="fa-users"
                            colorClass="from-blue-500 to-indigo-600"
                            onClick={() => navigate('/admin/users')}
                        />
                        <ConfigCard
                            title="Roles y Permisos"
                            subtitle="Control de acceso"
                            icon="fa-shield-halved"
                            colorClass="from-violet-500 to-purple-600"
                            onClick={() => navigate('/admin/roles')}
                        />
                        <ConfigCard
                            title="Menú del Sistema"
                            subtitle="Estructura y Rutas"
                            icon="fa-list-tree"
                            colorClass="from-fuchsia-500 to-pink-600"
                            onClick={() => navigate('/admin/menu')}
                        />
                        <ConfigCard
                            title="Auditoría"
                            subtitle="Logs y Seguridad"
                            icon="fa-list-check"
                            colorClass="from-slate-600 to-slate-800"
                            onClick={() => navigate('/admin/audit')}
                        />
                    </div>

                    <h2 className="text-lg font-black text-slate-700 mb-4 px-1 border-l-4 border-indigo-500">Integraciones</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        <ConfigCard
                            title="Sincronizar ERP"
                            subtitle="Importar órdenes pendientes"
                            icon="fa-cloud-arrow-down"
                            colorClass="from-cyan-500 to-blue-600"
                            onClick={handleImportERP}
                            loading={importingERP}
                        />
                    </div>
                </div>
            )}

            {/* CONTENIDO POR ÁREA */}
            {selectedAreaId ? (
                <div className="animate-fade-in-up">
                    <div className="mb-8">
                        <h2 className="text-lg font-black text-slate-700 mb-1">Panel de Control: <span className="text-cyan-600">{currentArea?.name}</span></h2>
                        <p className="text-slate-400 text-sm">Administra recursos y conexiones para esta área.</p>
                    </div>

                    <div className="bg-white p-4 rounded-xl mb-4 border border-indigo-200 flex justify-between items-center">
                        <p className="font-bold text-indigo-600">
                            Pedidos en memoria: {details.pedidosNuevos?.length || 0}
                        </p>
                        {details.pedidosNuevos?.length > 0 && (
                            <button
                                onClick={() => setIsLogModalOpen(true)}
                                className="text-xs bg-indigo-50 text-indigo-600 px-3 py-1 rounded-lg font-bold hover:bg-indigo-100"
                            >
                                VER LISTADO
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        <ConfigCard title="Equipos" subtitle={`${details.equipos.length} máquinas`} icon="fa-print" colorClass="from-cyan-400 to-blue-500" onClick={() => setActiveModal('printers')} />
                        <ConfigCard title="Insumos" subtitle={`${details.insumos.length} materiales`} icon="fa-boxes-stacked" colorClass="from-amber-400 to-orange-500" onClick={() => setActiveModal('insumos')} />
                        <ConfigCard title="Rutas" subtitle="Origen - Destino - Prioridad" icon="fa-route" colorClass="from-violet-400 to-fuchsia-600" onClick={() => setActiveModal('rules')} />
                        <ConfigCard title="Tiempos" subtitle="Entrega (Horas/Días)" icon="fa-hourglass-half" colorClass="from-amber-400 to-orange-600" onClick={() => setActiveModal('times')} />
                        <ConfigCard title="Estados" subtitle="Estatus visuales" icon="fa-list-check" colorClass="from-slate-500 to-slate-700" onClick={() => setActiveModal('statuses')} />
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center p-20 text-center border-2 border-dashed border-slate-200 rounded-3xl">
                    <h3 className="text-xl font-bold text-slate-400">Selecciona un área para comenzar</h3>
                </div>
            )}

            {/* --- MODAL DE DETALLE DE PEDIDO (EL QUE PEDISTE) --- */}
            <PedidoModal
                isOpen={isPedidoModalOpen}
                pedido={selectedPedido}
                onClose={() => setIsPedidoModalOpen(false)}
            />

            {/* MODALES DE CONFIGURACIÓN EXISTENTES */}
            {activeModal === 'printers' && <ConfigPrintersModal isOpen={true} onClose={() => { setActiveModal(null); loadAreaDetails(selectedAreaId); }} areaCode={selectedAreaId} equipos={details.equipos} />}
            {activeModal === 'insumos' && <ConfigInsumosModal isOpen={true} onClose={() => { setActiveModal(null); loadAreaDetails(selectedAreaId); }} areaCode={selectedAreaId} insumos={details.insumos} />}
            {activeModal === 'flows' && <ConfigFlowsModal isOpen={true} onClose={() => setActiveModal(null)} />}
            {activeModal === 'rules' && <ConfigRouteRulesModal isOpen={true} onClose={() => setActiveModal(null)} />}
            {activeModal === 'times' && <ConfigDeliveryTimesModal isOpen={true} onClose={() => setActiveModal(null)} />}
            {activeModal === 'statuses' && <ConfigStatusesModal isOpen={true} onClose={() => { setActiveModal(null); loadAreaDetails(selectedAreaId); }} areaCode={selectedAreaId} initialStatuses={details.estados} />}

            <ImportLogModal
                isOpen={isLogModalOpen}
                onClose={() => setIsLogModalOpen(false)}
                logs={logs}
                isImporting={importingERP}
                onViewPedido={openPedidoDetail} // Pasamos la función al modal de logs
            />
        </div>
    );
}

// COMPONENTE DEL MODAL DE LOGS MEJORADO
const ImportLogModal = ({ isOpen, onClose, logs, isImporting, onViewPedido }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
                <div className="bg-slate-50 px-8 py-6 border-b border-slate-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-black text-slate-800">Consola de Importación</h2>
                        <p className="text-slate-500 text-sm">Comunicación directa con el ERP</p>
                    </div>
                    {isImporting && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold animate-pulse">
                            <i className="fa-solid fa-spinner fa-spin"></i> PROCESANDO
                        </div>
                    )}
                </div>

                <div className="p-6">
                    <div className="bg-slate-900 rounded-2xl p-6 h-80 overflow-y-auto font-mono text-sm shadow-inner">
                        {logs.map((log, index) => {
                            const isData = typeof log === 'object';

                            return (
                                <div key={index} className="mb-4">
                                    {!isData ? (
                                        <div className="flex gap-3">
                                            <span className="text-slate-600">[{new Date().toLocaleTimeString()}]</span>
                                            <span className={
                                                log.includes('✅') ? 'text-emerald-400' :
                                                    log.includes('❌') ? 'text-red-400' :
                                                        log.includes('⚠️') ? 'text-amber-400' : 'text-slate-300'
                                            }>
                                                {log}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="mt-2 space-y-2">
                                            <p className="text-indigo-400 text-xs">// Lista de pedidos recibidos:</p>
                                            {log.map((p, pIdx) => (
                                                <div
                                                    key={pIdx}
                                                    onClick={() => onViewPedido(p)}
                                                    className="flex items-center justify-between p-3 bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer transition-colors group"
                                                >
                                                    <div>
                                                        <span className="text-emerald-400 font-bold">#{p.nro_documento}</span>
                                                        <span className="text-slate-400 ml-3">{p.cliente}</span>
                                                    </div>
                                                    <span className="text-xs text-indigo-300 group-hover:text-white">Ver Detalle <i className="fa-solid fa-eye ml-1"></i></span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
                    <button
                        onClick={onClose}
                        disabled={isImporting}
                        className={`px-8 py-3 rounded-xl font-bold transition-all ${isImporting ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                    >
                        {isImporting ? 'Sincronizando...' : 'Cerrar Consola'}
                    </button>
                </div>
            </div>
        </div>
    );
};