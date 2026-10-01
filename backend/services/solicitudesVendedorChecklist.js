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

  c(t(sol.NombreTrabajo), 'Nombre del trabajo');
  c(!!sol.VendedorID, 'Vendedor');
  c(t(d.tipoTrabajo) || (p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !!p.ProIdProducto), 'Tipo de trabajo definido');
  c(arch(['BOCETO', 'ARTE_CLIENTE', 'REFERENCIA', 'DISENO_PRONTO']) || !!d.muestraFisica, 'Boceto, ficha técnica o muestra de referencia');
  c(Number(p.Cantidad) > 0, 'Cantidad total de unidades');
  // [ACCESORIOS] si el producto lleva accesorios de stock, los que van necesitan su variante (talle/color)
  const accs = Array.isArray(d.accesorios) ? d.accesorios.filter(a => a && a.incluir !== false) : [];
  if (accs.length) c(accs.every(a => !!a.wmsVarianteId), 'Accesorios de stock con variante elegida');

  // F1: un producto del catálogo sin molde (Molde = NO: windflag, funda, cuadro) se pide por unidad
  // a medida fija — no tiene talles ni planilla.
  const porUnidad = (p.Config?.Molde ?? p.Molde ?? p._molde) === 'NO';
  if (d.comoSeDefine === 'MEDIDA') {
    c(t(d.medidas), 'Medidas exactas en cm y cantidad por medida');
    c(t(d.terminacion), 'Tipo de terminación o costura');
  } else if (!porUnidad) {
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
  // El archivo que Diseño subió como diseño pronto ES la verificación: no hace falta la tilde a mano.
  if (dis.origen === 'CLIENTE') c(!!dis.verificado || arch(['DISENO_PRONTO']), 'Archivo de diseño entregado y verificado');
  if (dis.origen === 'TALLER') c(!!dis.aprobado, 'Diseño aprobado por escrito por el cliente');

  // 25-sep: la muestra se marca POR PRODUCTO ("Requiere confección de muestra"; producto nuevo o
  // producción grande la requieren siempre). "Se le ofreció / qué respondió" ya no se pide.
  // Solicitudes viejas: si la cabecera tenía la muestra aprobada (o rechazada), se sigue respetando.
  const mu = f.muestra || {};
  const pideMuestra = !!d.requiereMuestra;   // la marca el vendedor (producto nuevo / producción grande la tildan solos, pero se puede destildar)
  if (pideMuestra && mu.respuesta !== 'RECHAZO') c(!!d.muestraAprobada || !!mu.aprobada, 'Muestra aprobada por el cliente');
  c(!!sol.FechaEntrega, 'Fecha concreta en que el cliente necesita el trabajo');
  // 25-sep: "Plazo informado y aceptado" e "Indicaciones del cliente" dejaron de pedirse (las
  // indicaciones van en Observaciones generales, que es libre y no frena el ingreso).
  if (f.dondeSeCose === 'EXTERNO' && !t(f.tallerExterno)) luego.push('Nombre del taller externo');

  // Lo técnico de la conversión (precio pactado, seña, datos de cada servicio, diseño pronto…)
  faltan.push(...extra);
  return { listo: faltan.length === 0, faltan, ok, luego };
}

module.exports = { evaluarProducto };
