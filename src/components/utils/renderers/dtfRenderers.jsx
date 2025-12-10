import React from 'react';

// ✅ RENDERERS ESPECÍFICOS DE DTF
export const dtfRenderers = {
  rollRenderer: (order, isSelected, onToggle, index) => (
    order.rollId ? (
      <div className="dtf-roll-badge">
        {order.rollId}
      </div>
    ) : (
      <span className="empty-value">-</span>
    )
  ),
  
  metersRenderer: (order) => (
    <span className="dtf-meters-value">
      {order.meters || '0'}m
    </span>
  ),
  
  inkTypeRenderer: (order) => (
    <span className={`dtf-ink-badge dtf-ink-${order.inkType?.toLowerCase()}`}>
      <i className="fa-solid fa-fill-drip"></i>
      {order.inkType || 'Standard'}
    </span>
  ),
  
  resolutionRenderer: (order) => (
    <span className="dtf-resolution">
      {order.resolution === 'HIGH' ? '1200dpi' : 
       order.resolution === 'MEDIUM' ? '600dpi' : '300dpi'}
    </span>
  ),
  
  printerRenderer: (order) => (
    <select 
      className="dtf-printer-select"
      value={order.printer || ''}
      onChange={(e) => console.log('Cambiar impresora:', e.target.value)}
    >
      <option value="DTF-01">DTF-01</option>
      <option value="DTF-02">DTF-02</option>
      <option value="DTF-03">DTF-03</option>
    </select>
  ),
  
  // Renderer para archivos DTF
  filesRenderer: (order) => (
    <button 
      className="dtf-files-button"
      onClick={() => console.log('Abrir archivos:', order.id)}
    >
      <i className="fa-solid fa-file-pdf"></i>
      {order.filesData?.length || 0}
    </button>
  )
};

// ✅ FILTROS ESPECÍFICOS DTF
export const applyDtfFilters = (orders, filters) => {
  let filtered = [...orders];
  
  // Filtro por rollo
  if (filters.rollFilter && filters.rollFilter !== 'ALL') {
    if (filters.rollFilter === 'NO_ROLL') {
      filtered = filtered.filter(order => !order.rollId);
    } else {
      filtered = filtered.filter(order => order.rollId === filters.rollFilter);
    }
  }
  
  // Filtro por tipo de tinta
  if (filters.inkTypeFilter && filters.inkTypeFilter !== 'ALL') {
    filtered = filtered.filter(order => order.inkType === filters.inkTypeFilter);
  }
  
  // Filtro por resolución
  if (filters.resolutionFilter && filters.resolutionFilter !== 'ALL') {
    filtered = filtered.filter(order => order.resolution === filters.resolutionFilter);
  }
  
  // Filtro por impresora
  if (filters.printerFilter && filters.printerFilter !== 'ALL') {
    filtered = filtered.filter(order => order.printer === filters.printerFilter);
  }
  
  return filtered;
};

// ✅ DATOS MOCK ESPECÍFICOS DTF
export const getDtfMockOrders = () => {
  return areaConfigs.DTF.mockData.orders;
};