// Secciones de Desarrollos (docs/desarrollos/plan-integracion.md §4.1). Cada una es su propia entrada
// del menú, hija del grupo "Desarrollos", para elegir por rol quién ve cada una (Modulos +
// PermisosRoles; docs/desarrollos/menu-desarrollos.sql). El orden es el del prototipo de Felipe.
// `fase`: en qué fase del plan llega la pantalla (mientras tanto muestra un aviso).
// Aparte de DesarrollosPage para que el layout las use sin cargar esa página.
export const SECCIONES_DES = [
    { id: 'inicio',        ruta: '/desarrollos/inicio',        label: 'Inicio',               fase: 3 },
    { id: 'bandeja',       ruta: '/desarrollos/bandeja',       label: 'Bandeja',              fase: 1 },
    { id: 'proyectos',     ruta: '/desarrollos/proyectos',     label: 'Proyectos',            fase: 2 },
    { id: 'planificacion', ruta: '/desarrollos/planificacion', label: 'Planificación',        fase: 3 },
    { id: 'tareas',        ruta: '/desarrollos/tareas',        label: 'Tareas',               fase: 2 },
    { id: 'muestras',      ruta: '/desarrollos/muestras',      label: 'Muestras',             fase: 4 },
    { id: 'pedidos',       ruta: '/desarrollos/pedidos',       label: 'Pedidos',              fase: 1 },
    { id: 'catalogo',      ruta: '/desarrollos/catalogo',      label: 'Catálogo técnico',     fase: 4 },
    { id: 'archivo',       ruta: '/desarrollos/archivo',       label: 'Archivo',              fase: 2 },
    { id: 'reportes',      ruta: '/desarrollos/reportes',      label: 'Reportes',             fase: 5 },
    { id: 'plantillas',    ruta: '/desarrollos/plantillas',    label: 'Plantillas',           fase: 2 },
    { id: 'equipo',        ruta: '/desarrollos/equipo',        label: 'Equipo de desarrollo', fase: 0 },
];

// /desarrollos solo (un link o un aviso): a la primera sección que ve el rol, con el resto del link.
export const destinoDesarrollos = (search, rutasPermitidas) => {
    const ve = SECCIONES_DES.filter(s => rutasPermitidas.includes(s.ruta));
    if (!ve.length) return null;
    const params = new URLSearchParams(search || '');
    const pedida = ve.find(s => s.id === params.get('seccion')) || ve[0];
    params.delete('seccion');
    const resto = params.toString();
    return pedida.ruta + (resto ? `?${resto}` : '');
};
