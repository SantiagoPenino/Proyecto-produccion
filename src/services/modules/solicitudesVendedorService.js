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
    materialesPrincipal: (area) => dato(api.get(`${BASE}/materiales-principal`, { params: { area: area && area !== 'SB' ? area : undefined } })),
    /** payload: { CodArticulo?, Material?, Copias? } — tela y copias de un diseño pronto ya subido */
    definirProduccionArchivo: (id, archivoId, payload) => dato(api.put(`${BASE}/${id}/archivos/${archivoId}/produccion`, payload)),

    /** Molde del producto del catálogo (modelos ofrecidos con piezas y telas fijas, telas ofrecidas) + lo ya elegido. */
    moldeDelProducto: (id, productoSolId) => dato(api.get(`${BASE}/${id}/productos/${productoSolId}/molde`)),
    /** payload: { modeloClave, piezas: [{ pieza, telaProIdProducto, archivoId, nota }], parcial? } */
    guardarSublimacion: (id, productoSolId, payload) => dato(api.put(`${BASE}/${id}/productos/${productoSolId}/sublimacion`, payload)),
    /** payload: { comoSeDefine, notaTalles, medidas, terminacion, medidasPrenda, tablaEstandar, personalizacion, listaCerrada } */
    guardarTalles: (id, productoSolId, payload) => dato(api.put(`${BASE}/${id}/productos/${productoSolId}/talles`, payload)),
    /** TIZADA PRO por API: estructura de la planilla del molde, diseños, lista de talles, artes y envíos del producto. */
    tizadaProVer: (id, productoSolId) => dato(api.get(`${BASE}/${id}/productos/${productoSolId}/tizadapro`)),
    /** payload: { disenos: [{ nombre, variable, variableNombre, tela, telasPorPieza, arteArchivoId }], planilla: [{ diseno, <columna>: valor }] } */
    tizadaProGuardar: (id, productoSolId, payload) => dato(api.put(`${BASE}/${id}/productos/${productoSolId}/tizadapro`, payload)),
    /** Arma el .zip y lo manda a TIZADA PRO. soloRevisar = solo POST /pedidos/validar (no genera nada). */
    tizadaProEnviar: (id, productoSolId, soloRevisar) => dato(api.post(`${BASE}/${id}/productos/${productoSolId}/tizadapro/enviar`, { soloRevisar: !!soloRevisar })),
    /** Pregunta a TIZADA por un envío (y si está listo carga la tizada). reintentar = volver a cargar un resultado que falló. */
    tizadaProActualizar: (id, envioId, reintentar) => dato(api.post(`${BASE}/${id}/tizadapro/envios/${envioId}/actualizar`, { reintentar: !!reintentar })),
    /** Tizadas terminadas en TizadaPro (base externa, solo lectura). parteId filtra por el molde del producto; todas=1 las muestra igual. */
    tizadasTizadaPro: (parteId, todas) => dato(api.get(`${BASE}/tizadapro/trabajos`, { params: { parteId: parteId || undefined, todas: todas ? 1 : undefined } })),
    /** Vincula una tizada de TizadaPro a la producción principal (guarda copia del resultado). forzar = aunque sea de otro molde. */
    vincularTizada: (parteId, trabajoId, forzar) => dato(api.post(`${BASE}/partes/${parteId}/tizada`, { trabajoId, forzar: !!forzar })),

    /** Convierte UN producto de la solicitud en pedido de producción (un pedido por producto). */
    /** bobinaId: solo cuando el corte es con tela del cliente (se elige al convertir) */
    convertir: (id, productoSolId, bobinaId) => dato(api.post(`${BASE}/${id}/productos/${productoSolId}/convertir`, { bobinaId: bobinaId || null })),
    bobinas: (id) => dato(api.get(`${BASE}/${id}/bobinas`)),
    reintentarArchivos: (id, productoSolId) => dato(api.post(`${BASE}/${id}/productos/${productoSolId}/reintentar-archivos`)),
    recuperarArchivos: (id, productoSolId) => dato(api.post(`${BASE}/${id}/productos/${productoSolId}/recuperar-archivos`)),

    /** Ficha del pedido en PDF (Blob): todo lo de la solicitud, la misma que se adjunta al pedido al convertir. */
    fichaPdf: async (id) => (await api.get(`${BASE}/${id}/ficha-pdf`, { responseType: 'blob' })).data,
    /** ¿Se llega a la fecha de entrega? Recorre los sectores sobre la carga real de cada uno. */
    estimarPlazo: (id) => dato(api.get(`${BASE}/${id}/plazo`)),
    /** Calendario: entregas comprometidas + trabajo planificado de los pedidos ya convertidos. */
    calendario: (desde, hasta) => dato(api.get(`${BASE}/calendario`, { params: { desde, hasta } })),
    bandeja: () => dato(api.get(`${BASE}/bandeja-diseno`)),
    /** Órdenes de Bordado y TPU que ya están en producción y todavía esperan su diseño (solo lectura). */
    disenosEnProduccion: () => dato(api.get(`${BASE}/disenos-en-produccion`)),
    enviarADiseno: (parteId, TipoTrabajo) => dato(api.post(`${BASE}/partes/${parteId}/enviar-diseno`, { TipoTrabajo })),
    tomar: (parteId) => dato(api.post(`${BASE}/partes/${parteId}/tomar`)),
    aceptarCambio: (parteId) => dato(api.post(`${BASE}/partes/${parteId}/aceptar-cambio`)),
};

export default solicitudesVendedorService;
