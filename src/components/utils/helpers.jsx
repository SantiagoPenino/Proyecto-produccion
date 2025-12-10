export const formatDate = (dateString) => {
  const date = new Date(dateString);
  return {
    date: date.toLocaleDateString('es-ES'),
    time: date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  };
};

export const calculateTimeDifference = (startDate, endDate = new Date()) => {
  const diff = new Date(endDate) - new Date(startDate);
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

export const generateOrderCode = (prefix = 'ORD') => {
  const timestamp = Date.now().toString().slice(-6);
  return `${prefix}-${timestamp}`;
};

export const filterOrdersByArea = (orders, area) => {
  return orders.filter(order => order.area === area);
};

export const getOrdersByRoll = (orders, rollId) => {
  if (rollId === 'ALL') return orders;
  return orders.filter(order => order.rollId === rollId);
};

export const calculateProgress = (orders) => {
  const total = orders.length;
  const completed = orders.filter(order => 
    order.status === 'Finalizado' || order.status === 'Entregado'
  ).length;
  
  return total > 0 ? Math.round((completed / total) * 100) : 0;
};