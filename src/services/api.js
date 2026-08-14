// src/services/api.js
import api from './apiClient';

// Export Default API Client
export default api;

// Export Individual Services
export { areasService } from './modules/areasService';
export { ordersService } from './modules/ordersService';
export { stockService } from './modules/stockService';
export { failuresService } from './modules/failuresService';
export { clientsService, workflowsService, externalService } from './modules/commonService';
export { rollsService } from './modules/rollsService';
export { logisticsService } from './modules/logisticsService';
export { productionService } from './modules/productionService';
export { menuService } from './modules/menuService';
export { rolesService } from './modules/rolesService';
export { usersService } from './modules/usersService';
export { auditService } from './modules/auditService';
export { authService } from './modules/authService';
export { fileControlService } from './modules/fileControlService';
export { routesConfigService } from './modules/routesConfigService';
export { deliveryTimesService } from './modules/deliveryTimesService';
export { horarioLaboralService } from './modules/horarioLaboralService';
export { planificacionService } from './modules/planificacionService';
export { feriadosService } from './modules/feriadosService';
export { insumosService } from './modules/insumosService';
export { receptionService } from './modules/receptionService';
export { machineControlService } from './modules/machineControlService';
export { wmsService } from './modules/wmsService';
export { tareasService } from './modules/tareasService';
