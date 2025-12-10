export const AREA_CONFIG = {
  DTF: {
    name: 'Impresión DTF',
    gridTemplate: '40px 40px 60px 80px 80px 80px 100px 220px 150px 80px 60px 70px 90px 120px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Rollo', 'Cliente', 'Trabajo', 'Nota', 'Modo', 'Arch.', 'Metros', 'Estado', 'Impresora', 'Chat']
  },
  SUB: {
    name: 'Sublimación',
    gridTemplate: '40px 40px 60px 80px 80px 80px 100px 220px 150px 80px 100px 60px 70px 90px 120px 120px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Rollo', 'Cliente', 'Trabajo', 'Nota', 'Modo', 'Tela', 'Arch.', 'Metros', 'Estado', 'Impresora', 'Calandra', 'Chat']
  },
  UV: {
    name: 'ECO UV',
    gridTemplate: '40px 40px 60px 80px 80px 80px 100px 220px 150px 80px 100px 60px 70px 90px 120px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Rollo', 'Cliente', 'Trabajo', 'Nota', 'Modo', 'Material', 'Arch.', 'Unid.', 'Estado', 'Impresora', 'Chat']
  },
  BORD: {
    name: 'Bordado Industrial',
    gridTemplate: '40px 40px 60px 80px 80px 80px 100px 220px 150px 70px 70px 80px 80px 90px 120px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Rollo', 'Cliente', 'Trabajo', 'Nota', 'Logo', 'Matriz', 'Pts', 'Unid.', 'Estado', 'Máquina', 'Chat']
  }
};

export const ORDER_STATUS = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'Imprimiendo',
  COMPLETED: 'Finalizado',
  DELIVERED: 'Entregado'
};

export const MACHINE_STATUS = {
  OK: 'Operativo',
  FAIL: 'Falla',
  WARN: 'Advertencia',
  MAINTENANCE: 'Mantenimiento'
};

export const PRIORITY_LEVELS = {
  HIGH: 'Alta',
  MEDIUM: 'Media',
  LOW: 'Baja'
};