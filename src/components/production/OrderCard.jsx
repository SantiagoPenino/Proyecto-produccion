import React from 'react';

/**
 * Component to display an Order in a list (Tailwind Version)
 * @param {object} order - Order data object
 * @param {boolean} isSelected - If true, applies active styles
 * @param {function} onClick - Click handler
 */
const OrderCard = ({ order, isSelected, onClick }) => {
    return (
        <div
            onClick={() => onClick(order)}
            className={`
        relative p-4 mb-2 rounded-xl cursor-pointer
        transition-all duration-200 border
        flex flex-col gap-2 group
        ${isSelected
                    ? 'bg-brand-600 border-brand-500 shadow-lg shadow-brand-500/30 translate-x-1'
                    : 'bg-white border-zinc-100 hover:border-brand-200 hover:shadow-md'
                }
      `}
        >
            {/* Header Row */}
            <div className="flex justify-between items-center">
                <div className={`
          text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md
          ${isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-brand-50 text-brand-600'
                    }
        `}>
                    #{order.CodigoPedido || order.CodigoOrden || order.OrdenID}
                </div>
                <div className={`
          text-[10px] font-bold uppercase
          ${isSelected ? 'text-white/60' : 'text-zinc-400'}
        `}>
                    ROLLER {order.NombreRollo}
                </div>
            </div>

            {/* Client Name */}
            <div className={`
        text-xs font-bold truncate
        ${isSelected ? 'text-white' : 'text-zinc-700'}
      `}>
                {order.ClienteNombre}
            </div>

            {/* Material (Main Focus) */}
            <div className={`
        text-sm font-black uppercase leading-tight
        ${isSelected ? 'text-white' : 'text-zinc-800'}
      `}>
                {order.Material}
            </div>

            {/* Description */}
            <div className={`
        text-[10px] font-semibold italic uppercase truncate
        ${isSelected ? 'text-white/70' : 'text-zinc-400'}
      `}>
                {order.DescripcionTrabajo || 'Sin descripción'}
            </div>

            {/* Active Indicator Bar */}
            {isSelected && (
                <div className="absolute left-0 top-3 bottom-3 w-1 bg-white rounded-r-full opacity-50"></div>
            )}
        </div>
    );
};

export default OrderCard;


