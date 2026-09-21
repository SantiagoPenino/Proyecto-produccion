'use strict';
// Validador intermedio del ingreso de pedidos por sistema.
//
// Quien manda el pedido (hoy la Solicitud del vendedor; mañana un sistema externo) DEBERÍA
// mandarlo bien. Esto es la red de seguridad: repite, del lado del servidor, las reglas que
// /ventas/pedido-prenda aplica en el navegador, porque el creador de pedidos confía en lo que
// recibe (metros, materiales, cantidades). Nada se crea si esta lista no vuelve vacía.
//
// Además de validar, RESUELVE cada material contra el catálogo (código, stock, ancho): el
// traductor usa esos datos, no los que mandó el origen.
const { sql } = require('../../config/db');
const { materialesDe, buscarMaterial, anchoDeMaterial, bobinasDe } = require('./catalogo');

const VARIANTE_SUBLIMACION = 'Sublimacion Tela';   // fija en /ventas/pedido-prenda (prendaServices.js)
const VARIANTE_DTF = 'DTF Textil';                 // fija en /ventas/pedido-prenda
const TOLERANCIA_ANCHO_M = 0.002;                  // PrendaOrderForm.jsx:161
const TIPOS_SERVICIO = ['BORDADO', 'DTF', 'TPU'];
const AREA_DE = { BORDADO: 'EMB', DTF: 'DF', TPU: 'TPU' };
const NOMBRE_DE = { BORDADO: 'Bordado', DTF: 'Estampado DTF', TPU: 'Estampado TPU' };

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const esUrl = (u) => /^https?:\/\//i.test(String(u || ''));

// Medida de un archivo de DTF contra su material. La usan el validador (al convertir) y la
// Solicitud (al subir el diseño pronto). Reglas de PrendaOrderForm.jsx:1107-1135 (ancho) y
// 1154-1170 (alto DTF 0,10–2,50 m). mat = fila del catálogo (o null si todavía no hay material).
function errorMedidaDtf(nombre, ancho, alto, mat) {
  if (!(ancho > 0) || !(alto > 0)) return { codigo: 'ARCHIVO_SIN_MEDIDA', mensaje: `"${nombre}": no tiene medida (ancho y alto en metros). Volvé a subirlo para que se mida.` };
  if (alto > 2.5) return { codigo: 'DTF_ALTO_MAXIMO', mensaje: `"${nombre}" mide ${alto.toFixed(2)} m de alto: el máximo para DTF es 2,50 m.` };
  if (alto < 0.1) return { codigo: 'DTF_ALTO_MINIMO', mensaje: `"${nombre}" mide ${alto.toFixed(2)} m de alto: el mínimo para DTF es 0,10 m.` };
  if (!mat) return null;
  const anchoRedondeado = Math.ceil(Number(((ancho - TOLERANCIA_ANCHO_M) * 100).toFixed(6))) / 100;
  const maxImprimible = Math.round((anchoDeMaterial(mat) - 0.03) * 100) / 100;
  if (anchoRedondeado > maxImprimible + 1e-9) return { codigo: 'ANCHO_EXCEDE_MATERIAL', mensaje: `"${nombre}" mide ${anchoRedondeado.toFixed(2)}m de ancho y excede el ancho imprimible de "${String(mat.Material).trim()}" (${maxImprimible.toFixed(2)}m). Ajustá el archivo.` };
  return null;
}

async function validar(pool, pedido) {
  const errores = [];
  const err = (codigo, campo, mensaje) => errores.push({ codigo, campo, mensaje });
  const archivoOk = (a, campo, quePide) => {
    if (!a || !esUrl(a.url)) { err('ARCHIVO_SIN_ENLACE', campo, `${quePide}: falta el enlace del archivo${a?.nombre ? ` "${a.nombre}"` : ''}.`); return false; }
    if (!String(a.nombre || '').trim()) { err('ARCHIVO_SIN_NOMBRE', campo, `${quePide}: falta el nombre del archivo.`); return false; }
    return true;
  };

  // ── Cabecera ────────────────────────────────────────────────────────────────
  if (pedido.modo !== 'FABRICAR') err('MODO_NO_HABILITADO', 'modo', `El modo "${pedido.modo}" todavía no se puede ingresar por sistema. Hoy solo "Fabricar prendas a la medida".`);
  if (pedido.servicioPrincipal !== 'sublimacion') err('SERVICIO_NO_HABILITADO', 'servicioPrincipal', `La producción principal "${pedido.servicioPrincipal}" todavía no se puede ingresar por sistema. Hoy solo Sublimación.`);
  if (!String(pedido.nombreTrabajo || '').trim()) err('FALTA_NOMBRE_TRABAJO', 'nombreTrabajo', 'Falta el nombre del proyecto / trabajo.');

  const codCliente = parseInt(pedido.cliente?.codCliente, 10);
  let cliente = null;
  if (!codCliente) err('FALTA_CLIENTE', 'cliente.codCliente', 'Falta el cliente al que se le carga el pedido.');
  else {
    const r = await pool.request().input('Cod', sql.Int, codCliente).query(`
      SELECT CodCliente, CliIdCliente, RTRIM(LTRIM(IDCliente)) AS IDCliente, Nombre, Email, ESTADO
      FROM dbo.Clientes WHERE CodCliente = @Cod`);
    cliente = r.recordset[0] || null;
    if (!cliente) err('CLIENTE_INEXISTENTE', 'cliente.codCliente', `El cliente ${codCliente} no existe.`);
    else if (String(cliente.ESTADO || '').trim().toUpperCase() === 'BLOQUEADO') err('CLIENTE_BLOQUEADO', 'cliente.codCliente', `El cliente "${cliente.Nombre}" está BLOQUEADO: no se le pueden cargar pedidos.`);
  }

  // ── Producto ────────────────────────────────────────────────────────────────
  const prod = pedido.producto || {};
  if (!(parseInt(prod.cantidad, 10) > 0)) err('FALTA_CANTIDAD', 'producto.cantidad', 'Falta la cantidad de prendas.');
  if (prod.tipoFabricacion === 'TERMINADO') {
    const proId = parseInt(prod.proIdProducto, 10);
    if (!proId) err('FALTA_PRODUCTO', 'producto.proIdProducto', 'Falta elegir el producto terminado del catálogo.');
    else {
      const r = await pool.request().input('P', sql.Int, proId).query('SELECT TOP 1 ProIdProducto, LTRIM(RTRIM(Descripcion)) AS Descripcion FROM dbo.articulos WHERE ProIdProducto = @P');
      if (!r.recordset.length) err('PRODUCTO_INEXISTENTE', 'producto.proIdProducto', `El producto terminado ${proId} no existe en el catálogo.`);
      else prod.nombre = r.recordset[0].Descripcion;   // el nombre que viaja al pedido es el del catálogo
    }
  } else if (prod.tipoFabricacion === 'PERSONALIZADO') {
    const precio = prod.precio || {};
    if (precio.modo === 'ESTABLECIDO') {
      if (!(num(precio.monto) > 0)) err('FALTA_PRECIO', 'producto.precio.monto', 'Precio establecido: falta el monto.');
      if (!['UYU', 'USD'].includes(precio.moneda)) err('MONEDA_INVALIDA', 'producto.precio.moneda', 'Precio establecido: la moneda debe ser UYU o USD.');
    } else if (precio.modo !== 'POR_AREA') {
      err('FALTA_MODO_COBRO', 'producto.precio.modo', 'Falta cómo se cobra: "Facturar por cada área" o "Precio establecido".');
    }
  } else {
    err('TIPO_FABRICACION_INVALIDO', 'producto.tipoFabricacion', 'El tipo de fabricación debe ser "Producto terminado" o "Producto personalizado (cliente)".');
  }

  // ── Tela del cliente: la bobina define el ancho y el largo disponibles (jsx:1099-1104, 1142-1151)
  const corteTC = pedido.corte && String(pedido.corte.origenTela || '').toUpperCase() === 'TELA CLIENTE' ? pedido.corte : null;
  let bobina = null;
  if (corteTC) {
    if (corteTC.tipoMolde === 'SUBLIMACION') err('TELA_CLIENTE_MOLDE', 'corte.tipoMolde', 'Corte: con tela del cliente el molde no puede ser "SUBLIMACION" (esa opción es para tela sublimada en User).');
    const bid = parseInt(corteTC.bobinaId, 10);
    if (!bid) err('FALTA_BOBINA', 'corte.bobinaId', 'Corte con tela del cliente: falta elegir la bobina.');
    else if (cliente) {
      bobina = (await bobinasDe(pool, cliente)).find(b => b.BobinaID === bid) || null;
      if (!bobina) err('BOBINA_NO_DISPONIBLE', 'corte.bobinaId', `La bobina ${bid} no es de este cliente o ya no tiene metros disponibles.`);
      else corteTC.nombreTelaCliente = corteTC.nombreTelaCliente || String(bobina.DescripcionTela || '').trim();
    }
  }

  // ── Producción principal (sublimación): un archivo = un ítem ─────────────────
  const imp = pedido.impresion || {};
  imp.variante = VARIANTE_SUBLIMACION;
  const items = Array.isArray(imp.items) ? imp.items : [];
  if (!items.length) err('FALTA_ARTE', 'impresion.items', 'Producción principal: no hay ningún archivo de diseño pronto.');
  const telas = items.length ? await materialesDe(pool, 'SB', VARIANTE_SUBLIMACION) : [];
  items.forEach((it, i) => {
    const campo = `impresion.items[${i}]`;
    const nom = it.archivo?.nombre || `archivo ${i + 1}`;
    if (!archivoOk(it.archivo, `${campo}.archivo`, 'Producción principal')) return;
    const copias = parseInt(it.copias, 10);
    if (!(copias >= 1)) { err('COPIAS_INVALIDAS', `${campo}.copias`, `"${nom}": las copias deben ser 1 o más.`); return; }
    it.copias = copias;
    const ancho = num(it.archivo.anchoM), alto = num(it.archivo.altoM);
    if (!(ancho > 0) || !(alto > 0)) { err('ARCHIVO_SIN_MEDIDA', `${campo}.archivo`, `"${nom}": no tiene medida (ancho y alto en metros). Volvé a subirlo para que se mida.`); return; }
    const mat = buscarMaterial(telas, it.material);
    if (!mat) { err('MATERIAL_INVALIDO', `${campo}.material`, `"${nom}": ${it.material?.nombre ? `el material "${it.material.nombre}" no está en el catálogo de Sublimación` : 'falta elegir el material (la tela)'}.`); return; }
    it.material = { nombre: String(mat.Material).trim(), codArticulo: String(mat.CodArticulo ?? '').trim(), codStock: String(mat.CodStock ?? '').trim() };

    // Mismas reglas de ancho que PrendaOrderForm.jsx:1107-1135
    const anchoBobina = bobina ? parseFloat(bobina.AnchoReal ?? bobina.Ancho) : NaN;
    const usaBobina = Number.isFinite(anchoBobina) && anchoBobina > 0;      // el ancho lo define la bobina, no el material
    const maxWidth = usaBobina ? anchoBobina : anchoDeMaterial(mat);
    const largoFijo = usaBobina ? 0 : (parseFloat(mat.Largo) || 0);
    const etiquetaAncho = usaBobina ? `la bobina "${String(bobina.DescripcionTela || bobina.CodigoEtiqueta || '').trim()}"` : `"${it.material.nombre}"`;
    if (largoFijo > 0) {
      const cm = (v) => Math.round(Number((v * 100).toFixed(6)));
      if (cm(ancho) !== cm(maxWidth) || cm(alto) !== cm(largoFijo)) {
        err('MEDIDA_FIJA', `${campo}.archivo`, `"${it.material.nombre}" se imprime a MEDIDA FIJA: "${nom}" debe medir exactamente ${maxWidth.toFixed(2)}m de ancho x ${largoFijo.toFixed(2)}m de largo, y mide ${ancho.toFixed(2)}m x ${alto.toFixed(2)}m.`);
      }
    } else {
      const anchoRedondeado = Math.ceil(Number(((ancho - TOLERANCIA_ANCHO_M) * 100).toFixed(6))) / 100;
      const maxImprimible = Math.round((maxWidth - 0.03) * 100) / 100;
      if (anchoRedondeado > maxImprimible + 1e-9) {
        err('ANCHO_EXCEDE_MATERIAL', `${campo}.archivo`, `"${nom}" mide ${anchoRedondeado.toFixed(2)}m de ancho y excede el ancho imprimible de ${etiquetaAncho} (${maxImprimible.toFixed(2)}m). Ajustá el archivo o elegí otra tela.`);
      }
    }
  });

  // Largo total = Σ alto × copias (misma fórmula que el pie del formulario, jsx:2332-2337)
  if (bobina) {
    const largo = Math.round(items.reduce((acc, it) => acc + ((num(it.archivo?.altoM) || 0) * (parseInt(it.copias, 10) || 1)), 0) * 100) / 100;
    pedido.corte.magnitudM = largo;
    if (largo > parseFloat(bobina.MetrosRestantes)) err('BOBINA_SIN_METROS', 'corte.bobinaId', `La bobina tiene ${parseFloat(bobina.MetrosRestantes).toFixed(2)} m y el pedido necesita ${largo.toFixed(2)} m.`);
  }

  // ── Corte y costura ──────────────────────────────────────────────────────────
  const corte = pedido.corte || null;
  if (corte) {
    if (!corte.tipoMolde) err('CORTE_SIN_MOLDE', 'corte.tipoMolde', 'Corte: falta el tipo de molde.');
    if (!corte.origenTela) err('CORTE_SIN_TELA', 'corte.origenTela', 'Corte: falta el origen de la tela.');
    const tizadas = Array.isArray(corte.tizadas) ? corte.tizadas : [];
    // La tizada es el archivo de impresión de la sublimación (impresion.items), no un archivo de Corte:
    // acá no se exige. Si igual llega algo en corte.tizadas, viaja a Corte como referencia.
    tizadas.forEach((a, i) => archivoOk(a, `corte.tizadas[${i}]`, 'Corte (tizada)'));
  }
  if (pedido.costura && !corte) err('COSTURA_SIN_CORTE', 'costura', 'Costura requiere Corte.');

  // ── Servicios adicionales ────────────────────────────────────────────────────
  const servicios = Array.isArray(pedido.servicios) ? pedido.servicios : [];
  const vistos = new Set();
  for (let i = 0; i < servicios.length; i++) {
    const s = servicios[i];
    const campo = `servicios[${i}]`;
    if (!TIPOS_SERVICIO.includes(s.tipo)) { err('SERVICIO_DESCONOCIDO', `${campo}.tipo`, `Servicio desconocido: "${s.tipo}".`); continue; }
    const n = NOMBRE_DE[s.tipo];
    if (vistos.has(s.tipo)) { err('SERVICIO_REPETIDO', `${campo}.tipo`, `${n} está cargado dos veces.`); continue; }
    vistos.add(s.tipo);

    if (s.tipo === 'DTF') s.variante = VARIANTE_DTF;
    if (!String(s.variante || '').trim()) { err('FALTA_VARIANTE', `${campo}.variante`, `${n}: falta el tipo / variante.`); continue; }
    const mats = await materialesDe(pool, AREA_DE[s.tipo], s.variante);
    const mat = buscarMaterial(mats, s.material);
    if (!mat) err('MATERIAL_INVALIDO', `${campo}.material`, `${n}: ${s.material?.nombre ? `"${s.material.nombre}" no está en el catálogo de "${s.variante}"` : 'falta el material'}.`);
    else s.material = { nombre: String(mat.Material).trim(), codArticulo: String(mat.CodArticulo ?? '').trim(), codStock: String(mat.CodStock ?? '').trim() };

    const archivos = Array.isArray(s.archivos) ? s.archivos : [];
    const bocetos = Array.isArray(s.bocetos) ? s.bocetos : [];
    // Bordado y TPU NO exigen archivo: en producción el ponchado / el arte se suben después desde la ficha de la
    // orden (Bordado: requisito "Matriz"; TPU: boceto → aprobación del cliente → arte). DTF sí lo exige.
    if (s.tipo === 'BORDADO') {
      if (!(parseInt(s.prendas, 10) > 0)) err('FALTA_CANTIDAD', `${campo}.prendas`, 'Bordado: falta la cantidad de prendas.');
    } else {
      if (s.tipo === 'DTF' && !archivos.length) err('FALTA_ARTE', `${campo}.archivos`, `${n}: hace falta al menos un archivo para imprimir.`);
      const est = s.estampado || {};
      if (!(parseInt(est.prendas, 10) > 0)) err('FALTA_CANTIDAD', `${campo}.estampado.prendas`, `${n}: falta la cantidad total de prendas a estampar.`);
      if (!(parseInt(est.estampadosPorPrenda, 10) > 0)) err('FALTA_CANTIDAD', `${campo}.estampado.estampadosPorPrenda`, `${n}: faltan los estampados por prenda.`);
    }
    // DTF se mide contra su material (el film). Bordado y TPU NO llevan medida: solo se exige el archivo.
    archivos.forEach((a, k) => {
      if (!archivoOk(a, `${campo}.archivos[${k}]`, n) || s.tipo !== 'DTF') return;
      const e = errorMedidaDtf(a.nombre, num(a.anchoM), num(a.altoM), mat);
      if (e) err(e.codigo, `${campo}.archivos[${k}]`, e.mensaje);
      a.copias = a.copias === undefined || a.copias === null || a.copias === '' ? 1 : parseInt(a.copias, 10);
      if (!(a.copias >= 1)) err('COPIAS_INVALIDAS', `${campo}.archivos[${k}].copias`, `"${a.nombre}": las copias deben ser 1 o más.`);
    });
    bocetos.forEach((a, k) => archivoOk(a, `${campo}.bocetos[${k}]`, `${n} (boceto)`));
  }

  ['bocetos', 'planillas', 'archivosReferencia'].forEach(grupo => (Array.isArray(pedido[grupo]) ? pedido[grupo] : []).forEach((a, k) => archivoOk(a, `${grupo}[${k}]`, 'Archivos del pedido')));

  return { errores, cliente };
}

module.exports = { validar, errorMedidaDtf, VARIANTE_SUBLIMACION, VARIANTE_DTF };
