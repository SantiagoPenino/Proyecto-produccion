// Checklist de INGRESO A PRODUCCIÓN — vista previa en vivo en el formulario.
// MISMAS reglas que backend/services/solicitudesVendedorChecklist.js (que es la fuente de verdad:
// el sello guardado, la lista y el detalle salen de ahí). Si se cambia una, se cambia la otra.
const t = (v) => !!String(v == null ? '' : v).trim();

export const RESPUESTA_MUESTRA = { PIDIO: 'La pidió él', ACEPTO: 'Aceptó hacerla', RECHAZO: 'La rechazó, avanza sin muestra' };

/** cab: { NombreTrabajo, VendedorID, FechaEntrega, Ficha } · p: producto del formulario ({ Datos, Cantidad, TipoFabricacion, ProIdProducto }) · archivos: los ya guardados (opcional) */
export function evaluarProducto(cab, p, archivos = [], extra = []) {
    const faltan = [], ok = [], luego = [];
    const c = (cond, txt) => (cond ? ok : faltan).push(txt);
    const f = cab.Ficha || {};
    const d = p.Datos || {};
    const vig = (archivos || []).filter(a => a.Vigente);
    const mio = (a) => a.ProductoSolID === p.ProductoSolID || (p.Principal?.ParteID && a.ParteID === p.Principal.ParteID) || (!a.ProductoSolID && !a.ParteID && !a.EventoID);
    const arch = (roles) => vig.some(a => roles.includes(a.Rol) && mio(a));

    c(t(cab.NombreTrabajo), 'Nombre del trabajo');
    c(!!cab.VendedorID, 'Vendedor');
    c(t(d.tipoTrabajo) || (p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !!p.ProIdProducto), 'Tipo de trabajo definido');
    c(arch(['BOCETO', 'ARTE_CLIENTE', 'REFERENCIA', 'DISENO_PRONTO']) || !!d.muestraFisica, 'Boceto, ficha técnica o muestra de referencia');
    c(Number(p.Cantidad) > 0, 'Cantidad total de unidades');

    if (d.comoSeDefine === 'MEDIDA') {
        c(t(d.medidas), 'Medidas exactas en cm y cantidad por medida');
        c(t(d.terminacion), 'Tipo de terminación o costura');
    } else {
        c(arch(['PLANILLA']) || t(d.notaTalles), 'Lista de talles');
        if (!(t(d.medidasPrenda) || d.tablaEstandar)) luego.push('Medidas de la prenda');
        if (d.personalizacion) c(!!d.listaCerrada, 'Lista de nombres y números completa y cerrada');
    }
    if (d.productoNuevo) {
        const e = d.espec || {};
        c(t(e.costuras), 'Tipos de costura por parte de la prenda');
        c(t(e.terminaciones), 'Terminaciones definidas');
        c(t(e.avios), 'Avíos y accesorios definidos');
        c(t(e.tela) && t(e.provee), 'Tela e insumos definidos, y quién los provee');
    }
    const dis = d.diseno || {};
    if (dis.origen === 'CLIENTE') c(!!dis.verificado, 'Archivo de diseño entregado y verificado');
    if (dis.origen === 'TALLER') c(!!dis.aprobado, 'Diseño aprobado por escrito por el cliente');

    // 25-sep: la muestra se marca POR PRODUCTO ("Requiere confección de muestra"; producto nuevo o
    // producción grande la requieren siempre). "Se le ofreció / qué respondió" ya no se pide.
    // Solicitudes viejas: si la cabecera tenía la muestra aprobada (o rechazada), se sigue respetando.
    const mu = f.muestra || {};
    const pideMuestra = !!d.requiereMuestra;   // la marca el vendedor (producto nuevo / producción grande la tildan solos, pero se puede destildar)
    if (pideMuestra && mu.respuesta !== 'RECHAZO') c(!!d.muestraAprobada || !!mu.aprobada, 'Muestra aprobada por el cliente');
    c(!!cab.FechaEntrega, 'Fecha concreta en que el cliente necesita el trabajo');
    // 25-sep: "Plazo informado y aceptado" e "Indicaciones del cliente" dejaron de pedirse (igual que en el servidor).
    if (f.dondeSeCose === 'EXTERNO' && !t(f.tallerExterno)) luego.push('Nombre del taller externo');

    faltan.push(...extra);
    return { listo: faltan.length === 0, faltan, ok, luego };
}

// En qué bloque de la ficha se completa cada requisito (el panel "Estado del pedido" los agrupa así).
// Números internos (en pantalla el paso 4 ya no existe: se ven 1 a 6).
// 1 Identificación · 2 Pago y seña · 3 Producto · 6 Lista de talles · 7 Servicios y extras
export const BLOQUE_DEL_REQUISITO = {
    'Nombre del trabajo': 1, 'Vendedor': 1, 'Fecha concreta en que el cliente necesita el trabajo': 1,
    'Tipo de trabajo definido': 3, 'Cantidad total de unidades': 3, 'Muestra aprobada por el cliente': 3,
    'Tipos de costura por parte de la prenda': 3, 'Terminaciones definidas': 3, 'Avíos y accesorios definidos': 3, 'Tela e insumos definidos, y quién los provee': 3, 'Nombre del taller externo': 7,
    'Boceto, ficha técnica o muestra de referencia': 3,
    'Archivo de diseño entregado y verificado': 3, 'Diseño aprobado por escrito por el cliente': 3,
    'Lista de talles': 6, 'Lista de nombres y números completa y cerrada': 6, 'Medidas exactas en cm y cantidad por medida': 6, 'Tipo de terminación o costura': 6, 'Medidas de la prenda': 6,
};

export const fichaVacia = () => ({
    dondeSeCose: 'TALLER', tallerExterno: '',
    muestra: { ofrecida: false, respuesta: '', aprobada: false },
    plazoOk: false, indicaciones: '', sinIndicaciones: false, notasInternas: '',
    senaFecha: '',   // fecha de la transferencia de la seña (informativo)
});

export const datosProductoVacios = () => ({
    // 25-sep: por inferencia todo se corta y se cose (ya no se elige en el formulario)
    corte: { activo: true, tipoMolde: 'SUBLIMACION', origenTela: 'TELA SUBLIMADA EN USER' },
    costura: { activo: true, instrucciones: '' },
    tipoTrabajo: '', comoSeDefine: 'TALLE', productoNuevo: false, produccionGrande: false,
    medidas: '', terminacion: '',
    notaTalles: '', medidasPrenda: '', tablaEstandar: false, personalizacion: false, listaCerrada: false,
    muestraFisica: false,
    requiereMuestra: false, muestraAprobada: false,   // muestra por producto (25-sep)
    espec: { costuras: '', terminaciones: '', avios: '', tela: '', provee: '' },
    diseno: { origen: 'TALLER', verificado: false, aprobado: false },
});
