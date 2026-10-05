import api from '../apiClient';

// Servicio Técnico (backend: /api/servicio-tecnico — docs/servicio-tecnico-plan.md).
const armarForm = (campos = {}, archivos = []) => {
    const fd = new FormData();
    Object.entries(campos).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') fd.append(k, typeof v === 'boolean' ? String(v) : v);
    });
    archivos.forEach((f) => fd.append('adjuntos', f, f.name));
    return fd;
};
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export const servicioTecnicoService = {
    meta: async () => (await api.get('/servicio-tecnico/meta')).data.data,
    usuarios: async () => (await api.get('/servicio-tecnico/usuarios')).data.data,
    tiposFalla: async (categoria, q = '') =>
        (await api.get('/servicio-tecnico/tipos-falla', { params: { categoria, q } })).data.data,

    listar: async (filtros = {}) => (await api.get('/servicio-tecnico/solicitudes', { params: filtros })).data.data,
    detalle: async (id) => (await api.get(`/servicio-tecnico/solicitudes/${id}`)).data.data,
    crear: async (campos, archivos = []) =>
        (await api.post('/servicio-tecnico/solicitudes', armarForm(campos, archivos), multipart)).data.data,
    editar: async (id, campos) => (await api.put(`/servicio-tecnico/solicitudes/${id}`, campos)).data.data,
    tomar: async (id) => (await api.post(`/servicio-tecnico/solicitudes/${id}/tomar`)).data.data,
    asignar: async (id, tecnicoId) => (await api.post(`/servicio-tecnico/solicitudes/${id}/asignar`, { tecnicoId })).data.data,
    cambiarEstado: async (id, estado, motivo) =>
        (await api.post(`/servicio-tecnico/solicitudes/${id}/estado`, { estado, motivo })).data.data,
    derivar: async (id, datos) => (await api.post(`/servicio-tecnico/solicitudes/${id}/derivar`, datos)).data.data,
    finalizar: async (id, datos) => (await api.post(`/servicio-tecnico/solicitudes/${id}/finalizar`, datos)).data.data,
    reabrir: async (id, motivo) => (await api.post(`/servicio-tecnico/solicitudes/${id}/reabrir`, { motivo })).data.data,
    comentar: async (id, texto) => (await api.post(`/servicio-tecnico/solicitudes/${id}/comentarios`, { texto })).data,
    adjuntar: async (id, archivos) =>
        (await api.post(`/servicio-tecnico/solicitudes/${id}/adjuntos`, armarForm({}, archivos), multipart)).data.data,
    // Los adjuntos piden login: se bajan como blob (un <img src> no manda el token).
    adjuntoBlob: async (adjId) => (await api.get(`/servicio-tecnico/adjuntos/${adjId}`, { responseType: 'blob' })).data,

    cambiarEstadoMaquina: async (equipoId, estado, motivo, solId) =>
        (await api.put(`/servicio-tecnico/equipos/${equipoId}/estado`, { estado, motivo, solId })).data.data,

    // Máquinas (etapa 2)
    equipos: async (inactivas = false) => (await api.get('/servicio-tecnico/equipos', { params: inactivas ? { inactivas: 1 } : {} })).data,
    fichaEquipo: async (id) => (await api.get(`/servicio-tecnico/equipos/${id}`)).data,
    crearCambio: async (equipoId, campos, archivos = []) =>
        (await api.post(`/servicio-tecnico/equipos/${equipoId}/cambios`, armarForm(campos, archivos), multipart)).data.data,
    editarCambio: async (camId, campos) => (await api.put(`/servicio-tecnico/cambios/${camId}`, campos)).data,
    borrarCambio: async (camId) => (await api.delete(`/servicio-tecnico/cambios/${camId}`)).data,
    adjuntarCambio: async (camId, archivos) =>
        (await api.post(`/servicio-tecnico/cambios/${camId}/adjuntos`, armarForm({}, archivos), multipart)).data.data,

    // Mantenimientos (etapa 3)
    procedimientos: async (todos = false) => (await api.get('/servicio-tecnico/procedimientos', { params: todos ? { todos: 1 } : {} })).data.data,
    procedimiento: async (id) => (await api.get(`/servicio-tecnico/procedimientos/${id}`)).data.data,
    // Con fotos de insumos va multipart: los datos como JSON en "datos" y las fotos en "adjuntos"
    guardarProcedimiento: async (id, datos, fotos = []) => {
        const cuerpo = fotos.length ? armarForm({ datos: JSON.stringify(datos) }, fotos) : datos;
        const cfg = fotos.length ? multipart : undefined;
        return (id ? await api.put(`/servicio-tecnico/procedimientos/${id}`, cuerpo, cfg)
            : await api.post('/servicio-tecnico/procedimientos', cuerpo, cfg)).data.data;
    },
    activarProcedimiento: async (id, activo) => (await api.put(`/servicio-tecnico/procedimientos/${id}/activo`, { activo })).data,
    planes: async (todos = false) => (await api.get('/servicio-tecnico/planes', { params: todos ? { todos: 1 } : {} })).data.data,
    crearPlan: async (datos) => (await api.post('/servicio-tecnico/planes', datos)).data.data,
    editarPlan: async (id, datos) => (await api.put(`/servicio-tecnico/planes/${id}`, datos)).data,
    activarPlan: async (id, activo) => (await api.put(`/servicio-tecnico/planes/${id}/activo`, { activo })).data,
    trabajos: async (params) => (await api.get('/servicio-tecnico/trabajos', { params })).data.data,
    miSemana: async () => (await api.get('/servicio-tecnico/mi-semana')).data.data,
    trabajo: async (id) => (await api.get(`/servicio-tecnico/trabajos/${id}`)).data.data,
    crearTrabajo: async (datos) => (await api.post('/servicio-tecnico/trabajos', datos)).data.data,
    editarTrabajo: async (id, datos) => (await api.put(`/servicio-tecnico/trabajos/${id}`, datos)).data.data,
    posponerTrabajo: async (id, fecha, motivo) => (await api.post(`/servicio-tecnico/trabajos/${id}/posponer`, { fecha, motivo })).data.data,
    empezarTrabajo: async (id) => (await api.post(`/servicio-tecnico/trabajos/${id}/empezar`)).data.data,
    terminarTrabajo: async (id, datos) => (await api.post(`/servicio-tecnico/trabajos/${id}/terminar`, datos)).data.data,
    cancelarTrabajo: async (id, motivo) => (await api.post(`/servicio-tecnico/trabajos/${id}/cancelar`, { motivo })).data.data,
    marcarTarea: async (id, tareaId, datos) => (await api.put(`/servicio-tecnico/trabajos/${id}/tareas/${tareaId}`, datos)).data,
    agregarTarea: async (id, texto, minutos) => (await api.post(`/servicio-tecnico/trabajos/${id}/tareas`, { texto, minutos })).data,
    comentarTrabajo: async (id, texto) => (await api.post(`/servicio-tecnico/trabajos/${id}/comentarios`, { texto })).data,
    adjuntarTrabajo: async (id, archivos) =>
        (await api.post(`/servicio-tecnico/trabajos/${id}/adjuntos`, armarForm({}, archivos), multipart)).data.data,
    seguimientoHecho: async (solId, nota) => (await api.post(`/servicio-tecnico/solicitudes/${solId}/seguimiento`, { nota })).data,

    // Proyectos (etapa 4)
    proyectos: async (params) => (await api.get('/servicio-tecnico/proyectos', { params })).data.data,
    proyecto: async (id) => (await api.get(`/servicio-tecnico/proyectos/${id}`)).data.data,
    crearProyecto: async (datos) => (await api.post('/servicio-tecnico/proyectos', datos)).data.data,
    editarProyecto: async (id, datos) => (await api.put(`/servicio-tecnico/proyectos/${id}`, datos)).data.data,
    avanceProyecto: async (id, texto, progreso, archivos = []) =>
        (await api.post(`/servicio-tecnico/proyectos/${id}/avance`, armarForm({ texto, progreso }, archivos), multipart)).data.data,
    estadoProyecto: async (id, estado, motivo) => (await api.post(`/servicio-tecnico/proyectos/${id}/estado`, { estado, motivo })).data.data,
    adjuntarProyecto: async (id, archivos) =>
        (await api.post(`/servicio-tecnico/proyectos/${id}/adjuntos`, armarForm({}, archivos), multipart)).data.data,

    // Insumos del stock (etapa 4)
    insumosConfig: async () => (await api.get('/servicio-tecnico/insumos/config')).data.data,
    setDepositoInsumos: async (depositoId) => (await api.put('/servicio-tecnico/insumos/config', { depositoId })).data,
    stockInsumos: async (dep, q = '') => (await api.get('/servicio-tecnico/insumos/stock', { params: { dep, q } })).data.data,
    usosInsumos: async (params) => (await api.get('/servicio-tecnico/insumos/usos', { params })).data.data,
    registrarUso: async (datos) => (await api.post('/servicio-tecnico/insumos/usos', datos)).data.data,

    // Reportes (etapa 5)
    reporteResumen: async (desde, hasta) => (await api.get('/servicio-tecnico/reportes/resumen', { params: { desde, hasta } })).data.data,
    reporteSemanal: async (semana) => (await api.get('/servicio-tecnico/reportes/semanal', { params: { semana } })).data.data,
    setEncargado: async (usuarioId) => (await api.put('/servicio-tecnico/config/encargado', { usuarioId })).data.data,
};
