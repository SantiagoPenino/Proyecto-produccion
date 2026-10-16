import api from '../apiClient';

// Desarrollos (backend: /api/desarrollos — docs/desarrollos/plan-integracion.md).
// :entidad en comentarios, historial y adjuntos = 'solicitud' | 'proyecto' | 'muestra'.
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };
const conArchivos = (archivos = []) => {
    const fd = new FormData();
    archivos.forEach((f) => fd.append('adjuntos', f, f.name));
    return fd;
};

export const desarrollosService = {
    sesion: async () => (await api.get('/desarrollos/sesion')).data.data,
    catalogos: async () => (await api.get('/desarrollos/catalogos')).data.data,

    equipo: async () => (await api.get('/desarrollos/equipo')).data.data,
    candidatos: async (q = '') => (await api.get('/desarrollos/equipo/candidatos', { params: { q } })).data.data,
    guardarMiembro: async (usuarioId, { nivel, lineas }) => (await api.put(`/desarrollos/equipo/${usuarioId}`, { nivel, lineas })).data.data,
    quitarMiembro: async (usuarioId) => (await api.delete(`/desarrollos/equipo/${usuarioId}`)).data.data,

    comentarios: async (entidad, id) => (await api.get(`/desarrollos/comentarios/${entidad}/${id}`)).data.data,
    comentar: async (entidad, id, texto) => (await api.post(`/desarrollos/comentarios/${entidad}/${id}`, { texto })).data.data,
    historial: async (entidad, id) => (await api.get(`/desarrollos/historial/${entidad}/${id}`)).data.data,
    adjuntos: async (entidad, id) => (await api.get(`/desarrollos/adjuntos/${entidad}/${id}`)).data.data,
    adjuntar: async (entidad, id, archivos) => (await api.post(`/desarrollos/adjuntos/${entidad}/${id}`, conArchivos(archivos), multipart)).data.data,
    quitarAdjunto: async (adjId) => (await api.delete(`/desarrollos/adjunto/${adjId}`)).data.data,
    // Los adjuntos piden login: se bajan como blob (un <img src> no manda el token).
    adjuntoBlob: async (adjId) => (await api.get(`/desarrollos/adjunto/${adjId}`, { responseType: 'blob' })).data,

    // Pedidos y Bandeja (fase 1)
    misPedidos: async () => (await api.get('/desarrollos/pedidos/mios')).data.data,
    bandeja: async () => (await api.get('/desarrollos/bandeja')).data.data,
    pedido: async (id) => (await api.get(`/desarrollos/pedidos/${id}`)).data.data,
    crearPedido: async (datos) => (await api.post('/desarrollos/pedidos', datos)).data.data,
    editarPedido: async (id, datos) => (await api.put(`/desarrollos/pedidos/${id}`, datos)).data.data,
    aprobar: async (id, { plantillaId, corrigeProyectoId }) => (await api.post(`/desarrollos/pedidos/${id}/aprobar`, { plantillaId, corrigeProyectoId })).data.data,
    posponer: async (id, { motivo, fechaRevision }) => (await api.post(`/desarrollos/pedidos/${id}/posponer`, { motivo, fechaRevision })).data.data,
    descartar: async (id, { motivo }) => (await api.post(`/desarrollos/pedidos/${id}/descartar`, { motivo })).data.data,
    reabrir: async (id) => (await api.post(`/desarrollos/pedidos/${id}/reabrir`)).data.data,
    borrarPedido: async (id) => (await api.delete(`/desarrollos/pedidos/${id}`)).data,
    clientes: async (q) => (await api.get('/desarrollos/clientes', { params: { q } })).data.data,
    usuarios: async () => (await api.get('/desarrollos/usuarios')).data.data,
    proyectosOpciones: async () => (await api.get('/desarrollos/proyectos/opciones')).data.data,

    // Proyectos, Tareas, Archivo y Plantillas (fase 2). Los cambios devuelven el proyecto entero.
    proyectos: async () => (await api.get('/desarrollos/proyectos')).data.data,
    proyecto: async (id) => (await api.get(`/desarrollos/proyectos/${id}`)).data.data,
    crearProyecto: async (datos) => (await api.post('/desarrollos/proyectos', datos)).data.data,
    guardarProyecto: async (id, cambios) => (await api.put(`/desarrollos/proyectos/${id}`, cambios)).data.data,
    cancelarProyecto: async (id) => (await api.post(`/desarrollos/proyectos/${id}/cancelar`)).data.data,
    reactivarProyecto: async (id) => (await api.post(`/desarrollos/proyectos/${id}/reactivar`)).data.data,
    borrarProyecto: async (id) => (await api.delete(`/desarrollos/proyectos/${id}`)).data,
    guardarComoPlantilla: async (id, nombre) => (await api.post(`/desarrollos/proyectos/${id}/plantilla`, { nombre })).data.data,
    nuevaTarea: async (proyectoId, etapaId, nombre) => (await api.post(`/desarrollos/proyectos/${proyectoId}/tareas`, { etapaId, nombre })).data.data,
    // { data: proyecto, aviso } (el aviso es "Ojo: dependía de…")
    tarea: async (id, cambios) => (await api.put(`/desarrollos/tareas/${id}`, cambios)).data,
    moverTarea: async (id, dir) => (await api.post(`/desarrollos/tareas/${id}/mover`, { dir })).data.data,
    quitarTarea: async (id) => (await api.delete(`/desarrollos/tareas/${id}`)).data.data,
    altaErp: async (id, proIdProducto) => (await api.post(`/desarrollos/tareas/${id}/alta-erp`, { proIdProducto })).data.data,
    confirmarFechas: async (items) => (await api.post('/desarrollos/tareas/confirmar-fechas', { items })).data,
    articulos: async (q) => (await api.get('/desarrollos/articulos', { params: { q } })).data.data,
    plantillas: async () => (await api.get('/desarrollos/plantillas')).data.data,
    guardarPlantilla: async (id, datos) => (id ? (await api.put(`/desarrollos/plantillas/${id}`, datos)) : (await api.post('/desarrollos/plantillas', datos))).data.data,
    borrarPlantilla: async (id) => (await api.delete(`/desarrollos/plantillas/${id}`)).data,
    guardarTipos: async (tipos) => (await api.put('/desarrollos/tipos', { tipos })).data.data,

    // Planificación e Inicio (fase 3). Las escrituras devuelven { data: { tandas, plan, orden }, mensaje?, destino?, ... }
    planificacion: async () => (await api.get('/desarrollos/tandas')).data.data,
    guardarPlan: async (cambios) => (await api.put('/desarrollos/plan', cambios)).data,
    guardarOrden: async (ids) => (await api.put('/desarrollos/orden', { ids })).data,
    crearTanda: async () => (await api.post('/desarrollos/tandas')).data,
    editarTanda: async (id, cambios) => (await api.put(`/desarrollos/tandas/${id}`, cambios)).data,
    borrarTanda: async (id) => (await api.delete(`/desarrollos/tandas/${id}`)).data,
    vincular: async (id, proyectoId, grupoId) => (await api.post(`/desarrollos/tandas/${id}/vincular`, grupoId === undefined ? { proyectoId } : { proyectoId, grupoId })).data,
    tareasTanda: async (id, { agregar = [], quitar = [], accion }) => (await api.post(`/desarrollos/tandas/${id}/tareas`, { agregar, quitar, accion })).data,
    desvincular: async (id, proyectoId) => (await api.post(`/desarrollos/tandas/${id}/desvincular`, { proyectoId })).data,
    crearGrupo: async (id) => (await api.post(`/desarrollos/tandas/${id}/grupos`)).data,
    renombrarGrupo: async (id, gid, nombre) => (await api.put(`/desarrollos/tandas/${id}/grupos/${gid}`, { nombre })).data,
    borrarGrupo: async (id, gid) => (await api.delete(`/desarrollos/tandas/${id}/grupos/${gid}`)).data,
    moverAGrupo: async (id, proyectoId, grupoId) => (await api.put(`/desarrollos/tandas/${id}/proyectos/${proyectoId}`, { grupoId })).data,
    cerrarTanda: async (id, pasar) => (await api.post(`/desarrollos/tandas/${id}/cerrar`, { pasar })).data,
    tareaATanda: async (tareaId) => (await api.post(`/desarrollos/tareas/${tareaId}/a-tanda`)).data,
    resumenMuestras: async () => (await api.get('/desarrollos/muestras/resumen')).data.data,

    // Fase 4: Muestras y Catálogo técnico
    muestras: async () => (await api.get('/desarrollos/muestras')).data.data,
    guardarMuestra: async (id, datos) => (id ? await api.put(`/desarrollos/muestras/${id}`, datos) : await api.post('/desarrollos/muestras', datos)).data.data,
    estadoMuestra: async (id, estadoId) => (await api.put(`/desarrollos/muestras/${id}/estado`, { estadoId })).data.data,
    tildeMuestra: async (id, tildeId, marcado) => (await api.put(`/desarrollos/muestras/${id}/tildes`, { tildeId, marcado })).data.data,
    borrarMuestra: async (id) => (await api.delete(`/desarrollos/muestras/${id}`)).data,
    orden: async (codigo) => (await api.get(`/desarrollos/ordenes/${encodeURIComponent(codigo)}`)).data.data,
    pegarMuestras: async (datos) => (await api.post('/desarrollos/muestras/pegar', datos)).data.data,
    listasMuestras: async () => (await api.get('/desarrollos/muestras/listas')).data.data,
    guardarListasMuestras: async (datos) => (await api.put('/desarrollos/muestras/listas', datos)).data,
    catalogo: async () => (await api.get('/desarrollos/catalogo')).data.data,
    crearCapacidad: async (datos) => (await api.post('/desarrollos/catalogo/capacidades', datos)).data.data,
    editarCapacidad: async (id, datos) => (await api.put(`/desarrollos/catalogo/capacidades/${id}`, datos)).data.data,
    borrarCapacidad: async (id) => (await api.delete(`/desarrollos/catalogo/capacidades/${id}`)).data,
    marcarResueltas: async (ids) => (await api.post('/desarrollos/catalogo/capacidades/resueltas', { ids })).data.data,
    capacidadesProyecto: async (proyectoId, relacion, ids) => (await api.put(`/desarrollos/proyectos/${proyectoId}/capacidades`, { relacion, ids })).data.data,
    crearVariante: async (datos) => (await api.post('/desarrollos/catalogo/variantes', datos)).data.data,
    editarVariante: async (id, datos) => (await api.put(`/desarrollos/catalogo/variantes/${id}`, datos)).data.data,
    borrarVariante: async (id) => (await api.delete(`/desarrollos/catalogo/variantes/${id}`)).data,
    tareaVariante: async (id, tareaId, hecho) => (await api.put(`/desarrollos/catalogo/variantes/${id}/tareas/${tareaId}`, { hecho })).data.data,
    editarOpcion: async (id, datos) => (await api.put(`/desarrollos/catalogo/opciones/${id}`, datos)).data,
};
