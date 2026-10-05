// Secciones de Servicio Técnico. Cada una es su propia entrada del menú (02/10), hija del grupo
// "Servicio Técnico", para poder elegir por rol quién ve cada una (Modulos + PermisosRoles). `ruta`
// es la de la tabla Modulos (docs/servicio-tecnico/st-menu-secciones.sql). Aparte de
// ServicioTecnicoPage para que el layout las use sin cargar esa página.
export const SECCIONES_ST = [
    { id: 'solicitudes', ruta: '/servicio-tecnico/solicitudes', label: 'Solicitudes' },
    { id: 'semana',      ruta: '/servicio-tecnico/mi-semana',   label: 'Mi semana' },
    { id: 'calendario',  ruta: '/servicio-tecnico/calendario',  label: 'Calendario' },
    { id: 'maquinas',    ruta: '/servicio-tecnico/maquinas',    label: 'Máquinas' },
    { id: 'planes',      ruta: '/servicio-tecnico/planes',      label: 'Planes y procedimientos' },
    { id: 'proyectos',   ruta: '/servicio-tecnico/proyectos',   label: 'Proyectos' },
    { id: 'insumos',     ruta: '/servicio-tecnico/insumos',     label: 'Insumos' },
    { id: 'reportes',    ruta: '/servicio-tecnico/reportes',    label: 'Reportes' },
];

// Adónde va un link viejo a /servicio-tecnico (los avisos de la campanita y los push lo usan:
// ?sol=ID, ?trab=ID, ?proy=ID, ?seccion=semana|reportes…). A la sección que pide ?seccion= si el rol
// la ve; un trabajo, a Mi semana o al Calendario; si no, a la primera sección que ve el rol. El
// resto del query (sol, trab, proy, semana) sigue: el panel de detalle se abre en cualquier sección.
export const destinoServicioTecnico = (search, rutasPermitidas) => {
    const params = new URLSearchParams(search || '');
    const ve = SECCIONES_ST.filter(s => rutasPermitidas.includes(s.ruta));
    if (!ve.length) return null;
    const pedida = ve.find(s => s.id === params.get('seccion'))
        || (params.get('trab') ? ve.find(s => s.id === 'semana') || ve.find(s => s.id === 'calendario') : null)
        || ve[0];
    params.delete('seccion');
    const resto = params.toString();
    return pedida.ruta + (resto ? `?${resto}` : '');
};
