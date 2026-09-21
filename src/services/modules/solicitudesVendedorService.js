import api from '../apiClient';

// Spec 41 — Captación de solicitudes de vendedores (solicitud previa al pedido + bandeja de Diseño)
const BASE = '/solicitudes-vendedor';
const dato = async (p) => (await p).data.data;

export const solicitudesVendedorService = {
    miPerfil: () => dato(api.get(`${BASE}/mi-perfil`)),
    vendedores: () => dato(api.get(`${BASE}/vendedores`)),
    disenadores: () => dato(api.get(`${BASE}/disenadores`)),
    definirDisenador: (idUsuario, activo) => dato(api.put(`${BASE}/disenadores/${idUsuario}`, { activo })),

    /** filtros: { estado: ABIERTAS|INGRESADA|EN_DISENO|PEDIDO_SOLICITADO|CANCELADA|TODAS, vendedorId, desde, hasta, q } */
    listar: (filtros) => dato(api.get(BASE, { params: filtros })),
    obtener: (id) => dato(api.get(`${BASE}/${id}`)),
    crear: (payload) => dato(api.post(BASE, payload)),
    actualizar: (id, payload) => dato(api.put(`${BASE}/${id}`, payload)),
    guardarPrecio: (id, payload) => dato(api.put(`${BASE}/${id}/precio`, payload)),
    confirmarSena: (id, payload) => dato(api.post(`${BASE}/${id}/sena/confirmar`, payload)),
    agregarInteraccion: (id, Texto) => dato(api.post(`${BASE}/${id}/interacciones`, { Texto })),
    cancelar: (id, Motivo) => dato(api.post(`${BASE}/${id}/cancelar`, { Motivo })),

    /** campos: { Rol, ParteID?, ProductoSolID?, EventoID?, ReemplazaA?, AnchoM?, AltoM? } */
    subirArchivo: (id, file, campos, onProgress) => {
        const fd = new FormData();
        fd.append('file', file);
        Object.entries(campos || {}).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') fd.append(k, v); });
        return dato(api.post(`${BASE}/${id}/archivos`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: onProgress ? (e) => onProgress(e.loaded, e.total || file.size || 0) : undefined,
        }));
    },
    quitarArchivo: (id, archivoId) => dato(api.delete(`${BASE}/${id}/archivos/${archivoId}`)),

    /** Telas de sublimación que elige el diseñador para cada archivo de la producción principal. */
    materialesPrincipal: () => dato(api.get(`${BASE}/materiales-principal`)),
    /** payload: { CodArticulo?, Material?, Copias? } — tela y copias de un diseño pronto ya subido */
    definirProduccionArchivo: (id, archivoId, payload) => dato(api.put(`${BASE}/${id}/archivos/${archivoId}/produccion`, payload)),

    /** Convierte UN producto de la solicitud en pedido de producción (un pedido por producto). */
    /** bobinaId: solo cuando el corte es con tela del cliente (se elige al convertir) */
    convertir: (id, productoSolId, bobinaId) => dato(api.post(`${BASE}/${id}/productos/${productoSolId}/convertir`, { bobinaId: bobinaId || null })),
    bobinas: (id) => dato(api.get(`${BASE}/${id}/bobinas`)),
    reintentarArchivos: (id, productoSolId) => dato(api.post(`${BASE}/${id}/productos/${productoSolId}/reintentar-archivos`)),

    bandeja: () => dato(api.get(`${BASE}/bandeja-diseno`)),
    /** Órdenes de Bordado y TPU que ya están en producción y todavía esperan su diseño (solo lectura). */
    disenosEnProduccion: () => dato(api.get(`${BASE}/disenos-en-produccion`)),
    enviarADiseno: (parteId, TipoTrabajo) => dato(api.post(`${BASE}/partes/${parteId}/enviar-diseno`, { TipoTrabajo })),
    tomar: (parteId) => dato(api.post(`${BASE}/partes/${parteId}/tomar`)),
    aceptarCambio: (parteId) => dato(api.post(`${BASE}/partes/${parteId}/aceptar-cambio`)),
};

export default solicitudesVendedorService;
