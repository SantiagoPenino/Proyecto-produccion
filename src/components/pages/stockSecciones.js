// Secciones de Stock. Cada una es su propia entrada del menú (28/09), hija del grupo "Stock",
// para poder elegir por rol quién ve cada una (Modulos + PermisosRoles). `ruta` es la de la
// tabla Modulos. Aparte de StockGestionPage para que el layout las use sin cargar esa página.
export const SECCIONES_STOCK = [
    { id: 'panel',   ruta: '/stock/panel',      label: 'Panel de Control' },
    { id: 'global',  ruta: '/stock/inventario', label: 'Inventario Global' },
    { id: 'sector',  ruta: '/stock/mi-sector',  label: 'Mi Sector' },
    { id: 'compras', ruta: '/stock/compras',    label: 'Compras' },
    { id: 'gestion', ruta: '/stock/sistema',    label: 'Gestión de Sistema' },
];
