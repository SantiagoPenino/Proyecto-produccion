// src/data/mockData.js - CORREGIDO
export const mockMachines = [
  { 
    id: "M-DTF-01", 
    name: "DTF-01 (60cm)", 
    type: "Impresora", 
    area: "DTF", 
    status: "OK",
    capacity: 100,
    tickets: []
  },
  { 
    id: "M-UV-01", 
    name: "Roland LEF-200", 
    type: "Impresora", 
    area: "UV", 
    status: "FAIL",
    capacity: 50,
    tickets: []
  },
  { 
    id: "M-BORD-01", 
    name: "Tajima 6", 
    type: "Bordadora", 
    area: "BORD", 
    status: "OK",
    capacity: 200000,
    tickets: []
  }
];

export const mockOrders = [
  { 
    id: "1088", 
    area: "DTF", 
    entryDate: "2025-11-22T09:30:00",
    client: "Juan Perez", 
    clientID: "C-99",
    desc: "Escudos Futbol", 
    priority: "Urgente",
    variant: "DTF Comun",
    filesData: [{ name: "escudo.pdf", copies: 10, meters: 1.5 }],
    magnitude: "15m",
    status: "Imprimiendo", 
    progress: 60,
    printer: "M-DTF-01",
    rollId: "R-101",
    note: "Ojo borde",
    selected: false,
    unread: 0
  },
  { 
    id: "1051", 
    area: "DTF", 
    entryDate: "2025-11-22T10:00:00",
    client: "Marca Ropa X", 
    clientID: "C-99",
    desc: "Etiquetas", 
    priority: "Normal",
    variant: "DTF UV", 
    filesData: [],
    magnitude: "5m",
    status: "Pendiente", 
    progress: 0,
    printer: "",
    rollId: null,
    note: "",
    selected: false,
    unread: 2
  },
  { 
    id: "4001", 
    area: "BORD", 
    entryDate: "2025-11-22T08:00:00",
    client: "Colegio ABC", 
    desc: "Insignias", 
    priority: "Normal",
    variant: "Aplique",
    stitches: 15000,
    quantity: 50,
    magnitude: "50u",
    status: "Matriz", 
    matrixStatus: "En Prueba",
    printer: "",
    logos: ["escudo_colegio.png"],
    matrices: [{name:"v1_densa.dst", date:"21/11"}, {name:"v2_final.dst", date:"Hoy"}],
    selected: false,
    unread: 0
  }
];

export const AREA_CONFIG = {
  'DTF': { 
    name: 'Impresión DTF',
    gridTemplate: '40px 40px 60px 80px 80px 80px 100px 220px 150px 80px 60px 70px 90px 120px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Rollo', 'Cliente', 'Trabajo', 'Nota', 'Modo', 'Arch.', 'Metros', 'Estado', 'Impresora', 'Chat']
  },
  'UV': { 
    name: 'ECO UV',
    gridTemplate: '40px 40px 60px 80px 80px 80px 100px 220px 150px 80px 100px 60px 70px 90px 120px 50px', 
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Rollo', 'Cliente', 'Trabajo', 'Nota', 'Modo', 'Material', 'Arch.', 'Unid.', 'Estado', 'Impresora', 'Chat']
  },
  'SUB': { 
    name: 'Sublimación',
    gridTemplate: '40px 40px 60px 80px 80px 80px 100px 220px 150px 80px 100px 60px 70px 90px 120px 120px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Rollo', 'Cliente', 'Trabajo', 'Nota', 'Modo', 'Tela', 'Arch.', 'Metros', 'Estado', 'Impresora', 'Calandra', 'Chat']
  },
  'BORD': { 
    name: 'Bordado Industrial',
    gridTemplate: '40px 40px 60px 80px 80px 80px 100px 220px 150px 70px 70px 80px 80px 90px 120px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Rollo', 'Cliente', 'Trabajo', 'Nota', 'Logo', 'Matriz', 'Pts', 'Unid.', 'Estado', 'Máquina', 'Chat']
  },
  'COORD': { 
    name: 'Coordinación de Producto',
    gridTemplate: '40px 40px 60px 80px 80px 120px 220px 150px 150px 100px 100px 90px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Cliente', 'Producto', 'Flujo', 'Abastecimiento', 'Origen', 'Estado', 'Chat']
  }
};