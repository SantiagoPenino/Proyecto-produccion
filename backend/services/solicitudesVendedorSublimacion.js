'use strict';
// =====================================================================
// Solicitudes de vendedores — piezas, telas y arte de la sublimación
// =====================================================================
// Para un producto del catálogo con molde de TizadaPro, la solicitud dice qué MODELO
// se pide y, pieza por pieza, qué TELA y qué ARTE del cliente lleva. Es lo que el
// diseñador necesita para armar la tizada en TizadaPro; hasta que está completo, la
// producción principal no se manda a Diseño.
//
// Se guarda dentro de SolicitudesVendedorProductos.DatosJson como
//   sublimacion: { modeloClave, modeloNombre, piezas: [{ pieza, generico, telaProIdProducto, telaNombre, fija, archivoId, nota }] }
// (sin SQL nuevo). Las telas elegibles son las que el producto OFRECE (ProductoTelas);
// una pieza con tela fija en TizadaPro no se elige: va siempre en esa tela.
// =====================================================================
const { sql } = require('../config/db');
const tizadaPro = require('./tizadaProService');

const fallo = (status, mensaje) => { const e = new Error(mensaje); e.status = status; return e; };
const jsonObj = (s) => { try { return s ? JSON.parse(s) : {}; } catch (_) { return {}; } };

async function productoSol(pool, solicitudId, productoSolId) {
  const r = await pool.request().input('Sol', sql.Int, solicitudId).input('P', sql.Int, productoSolId).query(`
    SELECT p.ProductoSolID, p.ProIdProducto, p.TipoFabricacion, p.DatosJson, p.PedidoNoDocERP,
           CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL THEN NULL
                ELSE (SELECT vc.TizadaProMoldeRef FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS MoldeRef
    FROM dbo.SolicitudesVendedorProductos p WHERE p.SolicitudID = @Sol AND p.ProductoSolID = @P AND p.Activo = 1`);
  const p = r.recordset[0];
  if (!p) throw fallo(404, 'El producto no pertenece a esta solicitud.');
  return p;
}

// ---------------------------------------------------------------------
// GET: molde del producto (modelos ofrecidos con sus piezas y telas fijas) + telas ofrecidas + lo elegido
// ---------------------------------------------------------------------
async function moldeDelProducto(pool, user, base, solicitudId, productoSolId) {
  if (!base.esVendedor(user) && !(await base.esDisenador(pool, user))) throw fallo(403, 'No tenés permiso para ver esta solicitud.');
  const p = await productoSol(pool, solicitudId, productoSolId);
  const elegido = jsonObj(p.DatosJson).sublimacion || null;
  if (p.TipoFabricacion !== 'PRODUCTO_TERMINADO' || !p.ProIdProducto) return { aplica: false, motivo: 'Es un producto del cliente: no tiene molde en el catálogo.', elegido };
  if (!p.MoldeRef) return { aplica: false, motivo: 'El producto del catálogo no tiene molde de TizadaPro vinculado (se vincula en Configurar productos).', elegido };

  const [molde] = await tizadaPro.moldes(pool, { ref: p.MoldeRef, soloActivos: false });
  if (!molde) return { aplica: false, motivo: 'El molde vinculado ya no está en TizadaPro.', elegido };
  const req = () => pool.request().input('PID', sql.Int, p.ProIdProducto);
  const [mods, tls] = await Promise.all([
    req().query('SELECT ModeloClave AS clave, ModeloNombre AS nombre, EsDefault FROM dbo.ProductoModelos WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ModeloNombre'),
    req().query(`SELECT t.TelaProIdProducto, t.EsDefault, LTRIM(RTRIM(a.Descripcion)) AS Material
                 FROM dbo.ProductoTelas t LEFT JOIN dbo.Articulos a ON a.ProIdProducto = t.TelaProIdProducto
                 WHERE t.ProIdProducto = @PID ORDER BY ISNULL(t.Orden, 999), t.TelaProIdProducto`),
  ]);
  const ofrecidos = mods.recordset;
  const telas = tls.recordset.map(x => ({ proIdProducto: x.TelaProIdProducto, nombre: x.Material || `Artículo ${x.TelaProIdProducto}`, esDefault: !!x.EsDefault }));
  // Sin recorte en el configurador → se ofrecen todas las telas que el molde admite en TizadaPro
  // (solo las que existen y están visibles en nuestro catálogo).
  const telasDelMolde = !telas.length;
  if (telasDelMolde) (molde.telas || []).filter(t => t.estado === 'OK' && t.proIdProducto).forEach((t, i) => telas.push({ proIdProducto: t.proIdProducto, nombre: t.nombre, esDefault: i === 0 }));
  const telaFijaDe = (d) => {
    const fijas = molde.telasPorPieza || {};
    const l = fijas[d.nombre] || fijas[d.generico] || [];
    return l.length ? { proIdProducto: l[0].proIdProducto, nombre: l[0].nombre } : null;
  };
  // Modelos que el producto ofrece; si no marcó ninguno, todos los del molde
  const base_ = molde.modelos.length ? molde.modelos : [{ clave: '__molde__', nombre: molde.nombre, piezasIds: molde.piezasDetalle.map(d => d.idEnMolde) }];
  const lista = (ofrecidos.length ? base_.filter(m => ofrecidos.some(o => o.clave === m.clave)) : base_).map(m => {
    const det = molde.piezasDetalle.filter(d => (m.piezasIds || []).includes(d.idEnMolde));
    const o = ofrecidos.find(x => x.clave === m.clave);
    return {
      clave: m.clave, nombre: m.nombre, esDefault: !!o?.EsDefault,
      piezas: det.map(d => ({ pieza: d.nombre, generico: d.generico, anchoCm: d.anchoCm, altoCm: d.altoCm, svgPath: d.svgPath || null, telaFija: telaFijaDe(d) })),
    };
  });
  return { aplica: true, moldeRef: molde.ref, moldeNombre: molde.nombre, modelos: lista, telas, telasDelMolde, elegido };
}

// ---------------------------------------------------------------------
// PUT: guardar modelo + tela y arte por pieza
// body: { modeloClave, piezas: [{ pieza, telaProIdProducto, archivoId, nota }] }
// ---------------------------------------------------------------------
async function guardarSublimacion(pool, user, base, solicitudId, productoSolId, body) {
  const sol = await base.cabecera(pool, solicitudId);
  base.exigirAbierta(sol);
  if (!base.esVendedor(user)) throw fallo(403, 'Las piezas y telas las carga el vendedor.');
  const p = await productoSol(pool, solicitudId, productoSolId);
  if (p.PedidoNoDocERP) throw fallo(409, 'Este producto ya se convirtió en pedido.');
  const info = await moldeDelProducto(pool, user, base, solicitudId, productoSolId);
  if (!info.aplica) throw fallo(400, info.motivo);
  const modelo = info.modelos.find(m => m.clave === String(body?.modeloClave || ''));
  if (!modelo) throw fallo(400, 'Elegí el modelo.');
  const telasOk = new Map(info.telas.map(t => [Number(t.proIdProducto), t]));
  const archivos = (await pool.request().input('Sol', sql.Int, solicitudId).query(`SELECT ArchivoID, NombreOriginal FROM dbo.SolicitudesVendedorArchivos WHERE SolicitudID = @Sol AND Vigente = 1`)).recordset;
  const pedidas = new Map((Array.isArray(body?.piezas) ? body.piezas : []).map(x => [String(x.pieza), x]));
  const piezas = []; const faltan = [];
  for (const pz of modelo.piezas) {
    const x = pedidas.get(pz.pieza) || {};
    let tela = null;
    if (pz.telaFija) tela = pz.telaFija;
    else {
      const id = parseInt(x.telaProIdProducto, 10);
      const t = telasOk.get(id);
      if (!t) faltan.push(pz.generico || pz.pieza); else tela = { proIdProducto: t.proIdProducto, nombre: t.nombre };
    }
    const aid = parseInt(x.archivoId, 10);
    const arch = Number.isInteger(aid) ? archivos.find(a => a.ArchivoID === aid) : null;
    piezas.push({ pieza: pz.pieza, generico: pz.generico, telaProIdProducto: tela ? tela.proIdProducto : null, telaNombre: tela ? tela.nombre : null, fija: !!pz.telaFija,
      archivoId: arch ? arch.ArchivoID : null, archivoNombre: arch ? arch.NombreOriginal : null, nota: x.nota ? String(x.nota).trim().slice(0, 200) : null });
  }
  if (faltan.length && !body?.parcial) throw fallo(400, `Falta la tela de: ${[...new Set(faltan)].join(', ')}. Elegí una de las telas que ofrece el producto.`);
  const datos = jsonObj(p.DatosJson);
  datos.sublimacion = { modeloClave: modelo.clave, modeloNombre: modelo.nombre, piezas, completo: faltan.length === 0, fecha: new Date().toISOString() };
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).input('P', sql.Int, productoSolId).input('D', sql.NVarChar(sql.MAX), JSON.stringify(datos))
      .query('UPDATE dbo.SolicitudesVendedorProductos SET DatosJson = @D WHERE ProductoSolID = @P');
    const resumen = piezas.map(z => `${z.generico || z.pieza}: ${z.telaNombre || '—'}${z.archivoNombre ? ' · arte ' + z.archivoNombre : ''}`).join(' · ');
    await base.registrarEvento(transaction, user, { solicitudId, productoSolId, parteId: null, tipo: 'EDICION', texto: `Sublimación: modelo "${modelo.nombre}" · ${resumen}.` });
    await transaction.commit();
  } catch (e) { try { await transaction.rollback(); } catch (_) {} throw e; }
  return datos.sublimacion;
}

// ¿La producción principal de este producto está lista para ir a Diseño? (la usa enviarADiseno)
// Hace falta: piezas y telas completas (si el producto tiene molde) y la planilla de talles y
// nombres (salvo que el producto se defina por medidas, que van escritas en la solicitud).
async function faltaSublimacion(cx, productoSolId) {
  const r = await new sql.Request(cx).input('P', sql.Int, productoSolId).query(`
    SELECT p.TipoFabricacion, p.DatosJson,
           CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL THEN NULL
                ELSE (SELECT vc.TizadaProMoldeRef FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS MoldeRef,
           (SELECT COUNT(*) FROM dbo.SolicitudesVendedorArchivos a WHERE a.ProductoSolID = p.ProductoSolID AND a.ParteID IS NULL AND a.Rol = 'PLANILLA' AND a.Vigente = 1) AS Planillas
    FROM dbo.SolicitudesVendedorProductos p WHERE p.ProductoSolID = @P`);
  const p = r.recordset[0];
  if (!p) return null;
  const datos = jsonObj(p.DatosJson);
  if (p.TipoFabricacion === 'PRODUCTO_TERMINADO' && p.MoldeRef) {
    const s = datos.sublimacion;
    if (!s || !s.modeloClave) return 'Antes de enviar a Diseño, elegí el modelo y la tela de cada pieza en "Piezas y telas".';
    if (!s.completo) return 'Faltan telas en "Piezas y telas": completalas antes de enviar a Diseño.';
  }
  if (!p.Planillas && !String(datos.notaTalles || '').trim() && datos.comoSeDefine !== 'MEDIDA') return 'Antes de enviar a Diseño, adjuntá la planilla de talles y nombres (o escribí la nota de talles).';
  return null;
}

// ---------------------------------------------------------------------
// PUT talles: lo que antes era la pestaña "Lista de talles" del formulario, ahora se carga en la
// solicitud, en la sección "Planilla de talles y nombres" de la producción principal.
// body: { comoSeDefine, notaTalles, medidas, terminacion, medidasPrenda, tablaEstandar, personalizacion, listaCerrada }
// ---------------------------------------------------------------------
const CAMPOS_TALLES = ['comoSeDefine', 'notaTalles', 'medidas', 'terminacion', 'medidasPrenda', 'tablaEstandar', 'personalizacion', 'listaCerrada'];
async function guardarTalles(pool, user, base, solicitudId, productoSolId, body) {
  const sol = await base.cabecera(pool, solicitudId);
  base.exigirAbierta(sol);
  if (!base.esVendedor(user)) throw fallo(403, 'Los talles los carga el vendedor.');
  const p = await productoSol(pool, solicitudId, productoSolId);
  if (p.PedidoNoDocERP) throw fallo(409, 'Este producto ya se convirtió en pedido.');
  const datos = jsonObj(p.DatosJson);
  const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const b = body || {};
  const n = {
    comoSeDefine: b.comoSeDefine === 'MEDIDA' ? 'MEDIDA' : 'TALLE',
    notaTalles: txt(b.notaTalles, 300), medidas: txt(b.medidas, 4000), terminacion: txt(b.terminacion, 300), medidasPrenda: txt(b.medidasPrenda, 2000),
    tablaEstandar: !!b.tablaEstandar, personalizacion: !!b.personalizacion,
  };
  n.listaCerrada = n.personalizacion && !!b.listaCerrada;
  const cambios = CAMPOS_TALLES.filter(k => String(datos[k] ?? '') !== String(n[k] ?? ''));
  if (!cambios.length) return n;
  Object.assign(datos, n);
  const resumen = n.comoSeDefine === 'MEDIDA'
    ? `por medidas${n.medidas ? ' · ' + n.medidas.replace(/\s+/g, ' ').slice(0, 80) : ''}${n.terminacion ? ' · ' + n.terminacion : ''}`
    : `por talle${n.notaTalles ? ' · ' + n.notaTalles : ''}${n.tablaEstandar ? ' · tabla estándar del taller' : ''}${n.personalizacion ? (n.listaCerrada ? ' · nombres y números (lista cerrada)' : ' · nombres y números (lista SIN cerrar)') : ''}`;
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).input('P', sql.Int, productoSolId).input('D', sql.NVarChar(sql.MAX), JSON.stringify(datos))
      .query('UPDATE dbo.SolicitudesVendedorProductos SET DatosJson = @D WHERE ProductoSolID = @P');
    await base.registrarEvento(transaction, user, { solicitudId, productoSolId, parteId: null, tipo: 'EDICION', texto: `Talles: ${resumen}.` });
    // Si la producción principal ya está en Diseño, el diseñador tiene que enterarse (RN-SOL.20b)
    const pa = (await new sql.Request(transaction).input('P', sql.Int, productoSolId)
      .query("SELECT ParteID, Estado FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Tipo = 'PRINCIPAL' AND Activo = 1")).recordset[0];
    if (pa && pa.Estado !== 'INGRESADO') await base.marcarModificada(transaction, user, pa.ParteID, `Talles: ${resumen}`);
    await transaction.commit();
  } catch (e) { try { await transaction.rollback(); } catch (_) {} throw e; }
  return n;
}

module.exports = { moldeDelProducto, guardarSublimacion, faltaSublimacion, guardarTalles };
