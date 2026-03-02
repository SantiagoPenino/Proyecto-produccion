import OrdersCard from '../dashboard/OrdersCard.jsx';
import { ordersService } from '../../services/modules/ordersService';

const Dashboard = ({ orders = [] }) => {

  return (
    <div className="min-h-screen bg-slate-50 p-8 custom-scrollbar font-sans text-slate-800">
      {/* Header */}
      <div className=" items-center justify-between mb-8 uppercase">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-1">Panel de Control</h1>
        <p className="text-slate-500 font-medium text-sm">Monitoreo en tiempo real de la producción</p>
      </div>

      {/* Grid de KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">

        <OrdersCard
          title="Activas"
          icon="fa-clipboard-list"
          bgColor="bg-emerald-600"
          zeroColor="text-emerald-500"
          queryKey="activeOrdersSummary"
          queryFn={ordersService.getActiveSummary}
        />

        <OrdersCard
          title="Con Falla"
          icon="fa-triangle-exclamation"
          bgColor="bg-yellow-500"
          borderColor="border-red-100"
          numberColor="text-red-600"
          zeroColor="text-slate-800"
          queryKey="failedOrdersSummary"
          queryFn={ordersService.getFailedSummary}
        />

        <OrdersCard
          title="Canceladas"
          icon="fa-ban"
          bgColor="bg-red-600"
          numberColor="text-red-600"
          zeroColor="text-slate-800"
          queryKey="cancelledOrdersSummary"
          queryFn={ordersService.getCancelledSummary}
        />

      </div>
    </div>
  );
};

export default Dashboard;