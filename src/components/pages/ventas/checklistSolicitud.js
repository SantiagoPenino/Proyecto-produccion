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

    c(t(cab.NombreTrabajo), 'Nombre del pedido');
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

    const mu = f.muestra || {};
    c(!!mu.ofrecida && t(mu.respuesta), 'Muestra ofrecida y respuesta registrada');
    if ((d.productoNuevo || d.produccionGrande) && mu.respuesta !== 'RECHAZO') c(!!mu.aprobada, 'Muestra aprobada por el cliente');
    c(!!cab.FechaEntrega, 'Fecha concreta en que el cliente necesita el trabajo');
    c(!!f.plazoOk, 'Plazo informado y aceptado');
    c(t(f.indicaciones) || !!f.sinIndicaciones, 'Indicaciones adicionales anotadas');
    if (f.dondeSeCose === 'EXTERNO' && !t(f.tallerExterno)) luego.push('Nombre del taller externo');

    faltan.push(...extra);
    return { listo: faltan.length === 0, faltan, ok, luego };
}

export const fichaVacia = () => ({
    dondeSeCose: 'TALLER', tallerExterno: '',
    muestra: { ofrecida: false, respuesta: '', aprobada: false },
    plazoOk: false, indicaciones: '', sinIndicaciones: false, notasInternas: '',
});

export const datosProductoVacios = () => ({
    corte: { activo: false, tipoMolde: 'SUBLIMACION', origenTela: 'TELA SUBLIMADA EN USER' },
    costura: { activo: false, instrucciones: '' },
    tipoTrabajo: '', comoSeDefine: 'TALLE', productoNuevo: false, produccionGrande: false,
    medidas: '', terminacion: '',
    notaTalles: '', medidasPrenda: '', tablaEstandar: false, personalizacion: false, listaCerrada: false,
    muestraFisica: false,
    espec: { costuras: '', terminaciones: '', avios: '', tela: '', provee: '' },
    diseno: { origen: 'TALLER', verificado: false, aprobado: false },
});
