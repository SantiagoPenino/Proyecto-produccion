'use strict';
// =====================================================================
// Checklist de INGRESO A PRODUCCIÓN de una Solicitud (por producto).
// Copia de la función evaluar() de la maqueta "Ingreso a producción" (produccion.html),
// adaptada a los datos de la Solicitud. Tres listas, como la maqueta:
//   faltan → lo que FRENA la conversión a pedido (rojo)
//   ok     → lo que ya está (verde)
//   luego  → lo que se puede completar después y NO frena (ámbar)
// El sello: listo = faltan vacío.
//
// MISMAS reglas en src/components/pages/ventas/checklistSolicitud.js (vista previa en vivo del
// formulario). Si se cambia una, se cambia la otra.
// =====================================================================
const t = (v) => !!String(v == null ? '' : v).trim();

/**
 * @param sol      cabecera con sol.Ficha (objeto) y sol.FechaEntrega
 * @param p        producto con p.Datos (objeto) y p.Partes
 * @param archivos archivos vigentes de la solicitud
 * @param extra    faltantes técnicos de la conversión (faltantesConversion) que también frenan
 */
function evaluarProducto(sol, p, archivos, extra = []) {
  const faltan = [], ok = [], luego = [];
  const c = (cond, txt) => (cond ? ok : faltan).push(txt);
  const f = sol.Ficha || {};
  const d = p.Datos || {};
  const principal = (p.Partes || []).find(x => x.Tipo === 'PRINCIPAL');
  const vig = (archivos || []).filter(a => a.Vigente);
  const delProducto = (a) => a.ProductoSolID === p.ProductoSolID || (principal && a.ParteID === principal.ParteID);
  const general = (a) => !a.ProductoSolID && !a.ParteID && !a.EventoID;
  const arch = (roles) => vig.some(a => roles.includes(a.Rol) && (delProducto(a) || general(a)));

  c(t(sol.NombreTrabajo), 'Nombre del pedido');
  c(!!sol.VendedorID, 'Vendedor');
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
  c(!!sol.FechaEntrega, 'Fecha concreta en que el cliente necesita el trabajo');
  c(!!f.plazoOk, 'Plazo informado y aceptado');
  c(t(f.indicaciones) || !!f.sinIndicaciones, 'Indicaciones adicionales anotadas');
  if (f.dondeSeCose === 'EXTERNO' && !t(f.tallerExterno)) luego.push('Nombre del taller externo');

  // Lo técnico de la conversión (precio pactado, seña, datos de cada servicio, diseño pronto…)
  faltan.push(...extra);
  return { listo: faltan.length === 0, faltan, ok, luego };
}

module.exports = { evaluarProducto };
