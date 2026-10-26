import { useState, useEffect } from 'react';
import { LayoutDashboard, ClipboardList, TriangleAlert, Ban } from 'lucide-react';
import OrdersCard, { ResumenOrdenesCelular } from '../dashboard/OrdersCard.jsx';
import ProduccionDiariaChart from '../dashboard/ProduccionDiariaChart.jsx';
import { ordersService } from '../../services/modules/ordersService';

// Panel de Control (22/10/2026: estética nueva, como Servicio Técnico y Configurar Productos: tarjetas
// blancas con borde, íconos de Lucide en brand-cyan sin fondo; el color queda para los estados). Las áreas
// van con el código de sus órdenes (SUB, DTF, XEUV, VEN...) en vez del área interna: lo arma el backend.
// 23/10: en el celular, los tres totales en una fila y el reparto por área del elegido (ver ResumenOrdenesCelular).
const TARJETAS = [
    { title: 'Activas', Icono: ClipboardList, tono: 'neutro', queryKey: 'activeOrdersSummary', queryFn: ordersService.getActiveSummary },
    { title: 'Con falla', Icono: TriangleAlert, tono: 'ambar', queryKey: 'failedOrdersSummary', queryFn: ordersService.getFailedSummary },
    { title: 'Canceladas', Icono: Ban, tono: 'rojo', queryKey: 'cancelledOrdersSummary', queryFn: ordersService.getCancelledSummary },
];

// Una vista sola según el ancho (no se dibujan las dos ocultando una)
const MQ_CELULAR = '(max-width: 767px)';
function useEsCelular() {
    const [esCelular, setEsCelular] = useState(() => window.matchMedia(MQ_CELULAR).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_CELULAR);
        const cambio = () => setEsCelular(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return esCelular;
}

const Dashboard = () => {
    const esCelular = useEsCelular();
    return (
        <div className="p-3 md:p-6 font-sans text-zinc-800">
            <div className="flex items-center gap-3 mb-4 md:mb-6">
                <LayoutDashboard size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                <div className="min-w-0">
                    <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Panel de Control</h1>
                    <p className="text-sm text-zinc-400">Monitoreo en tiempo real de la producción</p>
                </div>
            </div>

            {esCelular ? (
                <div className="mb-3">
                    <ResumenOrdenesCelular tarjetas={TARJETAS} />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-3 md:mb-4">
                    {TARJETAS.map(t => <OrdersCard key={t.queryKey} {...t} />)}
                </div>
            )}

            <ProduccionDiariaChart />
        </div>
    );
};

export default Dashboard;
