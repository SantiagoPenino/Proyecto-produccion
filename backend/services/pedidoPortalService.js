'use strict';
// =====================================================================
// PEDIDO ARMADO POR EL CLIENTE DESDE LA TIENDA DEL PORTAL (autogestión)
// =====================================================================
// El cliente elige en /portal/tienda un producto con molde de TIZADA PRO y lo arma con LA MISMA pantalla y LOS MISMOS
// endpoints de la Solicitud del vendedor (arte + editables, piezas y telas, lista de jugadores, arte de los extras):
// por dentro es una Solicitud con Origen = 'PORTAL' (scripts/add_solicitudes_portal.sql).
//
// Acá está SOLO lo que la Solicitud no tenía:
//   · quién es el cliente y si la solicitud es suya (lo usa también middleware/solicitudesClientePortal.js, que deja
//     pasar al cliente por /api/solicitudes-vendedor sobre SUS pedidos, actuando como su asesor)
//   · el alta desde la tienda (svc.crear con el producto y sus extras obligatorios)
//   · agregar / quitar un extra opcional (svc.actualizar)
//   · Confirmar: cantidad, precio de catálogo y fecha (svc.actualizar / svc.guardarPrecio) y a TIZADA PRO
//     (svc.enviarADiseno con Tizada = true, el mismo envío que hace el vendedor)
//   · el barrido que convierte en pedido lo que ya volvió de TIZADA (svc.convertir)
// =====================================================================
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('./solicitudesVendedorService');

const fallo = (status, mensaje, extra) => Object.assign(new Error(mensaje), { status, ...(extra || {}) });
const txt = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const EXTRA_DE_AREA = { EMB: 'BORDADO', DF: 'DTF', TPU: 'TPU' };
const NOMBRE_EXTRA = { BORDADO: 'Bordado', DTF: 'Estampado DTF', TPU: 'Estampado TPU' };

// ─────────────────────────────────────────────────────────────────────
// Base: columnas del SQL, cliente del token, usuario "portal"
// ─────────────────────────────────────────────────────────────────────
let _columnas = false;
async function exigirColumnas(pool) {
  if (_columnas) return;
  const r = await pool.request().query(`SELECT COL_LENGTH('dbo.SolicitudesVendedor', 'Origen') AS o, COL_LENGTH('dbo.SolicitudesVendedor', 'PortalConfirmado') AS c`);
  _columnas = r.recordset[0].o != null && r.recordset[0].c != null;   // se vuelve a mirar hasta que esté (sin reiniciar el backend)
  if (!_columnas) throw fallo(503, 'El armado de pedidos desde la tienda todavía no está habilitado (falta correr scripts/add_solicitudes_portal.sql).');
}

const esClientePortal = (user) => !!parseInt(user?.codCliente, 10) && user?.userType !== 'INTERNAL';
function clienteDe(user) {
  if (!esClientePortal(user)) throw fallo(403, 'Esto es para clientes del portal.');
  const cod = parseInt(user.codCliente, 10);
  return { codCliente: cod, nombre: txt(user.name || user.company || `Cliente ${cod}`, 80) };
}

// El asesor del cliente (Clientes.VendedorID → Trabajadores → Usuarios por cédula: el mismo "Tu asesor" del portal).
// Sin asesor con usuario: PORTAL_PEDIDOS_VENDEDOR_ID del .env, o el usuario 1.
async function vendedorDe(pool, codCliente) {
  try {
    const r = await pool.request().input('C', sql.Int, codCliente).query(`
      SELECT TOP 1 u.IdUsuario
      FROM dbo.Clientes c
      OUTER APPLY (SELECT TOP 1 tr.Cedula FROM dbo.Trabajadores tr
                   WHERE LTRIM(RTRIM(c.VendedorID)) IN (tr.ID, CAST(tr.Cedula AS NVARCHAR(50)))
                   ORDER BY CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(tr.[Área], '')))) = 'VENTAS' THEN 0 ELSE 1 END) t
      JOIN dbo.Usuarios u ON LTRIM(RTRIM(CAST(u.Cedula AS NVARCHAR(50)))) = LTRIM(RTRIM(CAST(t.Cedula AS NVARCHAR(50)))) AND u.Activo = 1
      WHERE c.CodCliente = @C`);
    if (r.recordset[0]?.IdUsuario) return r.recordset[0].IdUsuario;
  } catch (e) { logger.warn(`[PORTAL-PEDIDO] asesor del cliente ${codCliente}: ${e.message}`); }
  return parseInt(process.env.PORTAL_PEDIDOS_VENDEDOR_ID, 10) || 1;
}

// Las reglas de la Solicitud piden un vendedor: el cliente actúa como su asesor (VendedorID). En el historial queda
// "<cliente> · desde el portal". `portal: true` lo usan las reglas para acotar lo que puede hacer (ver subirArchivo).
const usuarioPortal = (vendedorId, cli) => ({
  id: vendedorId, name: txt(`${cli.nombre} · desde el portal`, 120), username: 'portal', role: 'VENTAS', idRol: 0, userType: 'INTERNAL',
  portal: true, codCliente: cli.codCliente,
});

let appRef = null;   // app de Express (sockets del alta del pedido): la conversión del barrido no tiene request
const recordarApp = (app) => { if (app && !appRef) appRef = app; };

// La solicitud tiene que ser del cliente del token y de la tienda. escribir = además, que siga en armado.
async function solicitudDelCliente(pool, user, solicitudId, { escribir = false } = {}) {
  await exigirColumnas(pool);
  const cli = clienteDe(user);
  const r = await pool.request().input('S', sql.Int, parseInt(solicitudId, 10) || 0).input('C', sql.Int, cli.codCliente).query(`
    SELECT s.SolicitudID, s.Estado, s.VendedorID, s.PortalConfirmado, s.NombreTrabajo, s.Observaciones,
           p.ProductoSolID, p.ProIdProducto, p.ProductoNombre, p.Cantidad, p.PedidoNoDocERP, p.DatosJson
    FROM dbo.SolicitudesVendedor s
    JOIN dbo.SolicitudesVendedorProductos p ON p.SolicitudID = s.SolicitudID AND p.Activo = 1
    WHERE s.SolicitudID = @S AND s.CodCliente = @C AND s.Origen = 'PORTAL'`);
  const s = r.recordset[0];
  if (!s) throw fallo(404, 'Ese pedido no existe o no es tuyo.');
  if (escribir) {
    if (s.Estado === 'CANCELADA') throw fallo(409, 'Este pedido fue descartado.');
    if (s.PortalConfirmado || s.PedidoNoDocERP) throw fallo(409, 'Este pedido ya está confirmado: desde acá no se puede cambiar. Si necesitás un cambio, escribinos por Soporte.');
  }
  return { ...s, cli, user: usuarioPortal(s.VendedorID, cli) };
}

// ─────────────────────────────────────────────────────────────────────
// Producto de la tienda: ¿se arma acá? (molde de TIZADA PRO) + precio + extras configurados
// ─────────────────────────────────────────────────────────────────────
let _colsCfg = null;
async function columnasConfig(pool) {
  if (_colsCfg) return _colsCfg;
  const r = await pool.request().query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProductoVentaConfig')`);
  _colsCfg = new Set(r.recordset.map(x => x.name));
  return _colsCfg;
}
const col = (cols, nombre, tipo = 'NVARCHAR(128)') => (cols.has(nombre) ? `vc.${nombre}` : `CAST(NULL AS ${tipo})`);

async function producto(pool, proId) {
  const cols = await columnasConfig(pool);
  // Precio: misma regla que /prendas-orders/productos-terminados (la moneda es la de PreciosBase)
  const r = await pool.request().input('P', sql.Int, proId).query(`
    SELECT TOP 1 a.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS Descripcion, LTRIM(RTRIM(tp.TituloVenta)) AS TituloVenta, tp.Publicado,
           UPPER(LTRIM(RTRIM(ISNULL(tp.TipoVitrina, 'TERMINADO')))) AS TipoVitrina,
           LTRIM(RTRIM(${col(cols, 'TizadaProMoldeRef')})) AS MoldeRef, ${col(cols, 'ModeloClave', 'NVARCHAR(96)')} AS ModeloClave,
           ${col(cols, 'CantidadMinima', 'INT')} AS CantidadMinima, ${col(cols, 'CantidadFija', 'INT')} AS CantidadFija,
           pb.Precio, ISNULL(pb.MonIdMoneda, CASE UPPER(LTRIM(RTRIM(pb.Moneda))) WHEN 'USD' THEN 2 WHEN 'UYU' THEN 1 ELSE a.MonIdMoneda END) AS MonIdMoneda,
           (SELECT TOP 1 x.url_imagen FROM (SELECT i.url_imagen, i.orden FROM dbo.Articulos_Imagenes i WHERE i.Idproid = a.ProIdProducto AND i.color IS NULL
                                             UNION ALL SELECT f.DibujoUrl, 9999 FROM dbo.ProductoFichaDiseno f WHERE f.ProIdProducto = a.ProIdProducto AND f.DibujoUrl IS NOT NULL) x
            ORDER BY x.orden) AS Foto
    FROM dbo.Articulos a
    LEFT JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = a.ProIdProducto
    LEFT JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
    OUTER APPLY (SELECT TOP 1 Precio, MonIdMoneda, Moneda FROM dbo.PreciosBase WHERE ProIdProducto = a.ProIdProducto) pb
    WHERE a.ProIdProducto = @P`);
  const p = r.recordset[0];
  if (!p) throw fallo(404, 'El producto no existe.');
  return {
    proId: p.ProIdProducto, nombre: p.TituloVenta || p.Descripcion, publicado: !!p.Publicado, tipoVitrina: p.TipoVitrina, moldeRef: p.MoldeRef || null,
    // lo que ve el cliente: sin la familia (igual que la tarjeta de la tienda); la solicitud guarda el nombre completo
    nombreCorto: String(p.TituloVenta || '').split(' · ').pop().trim() || String(p.Descripcion || '').split(' · ').pop().trim() || p.Descripcion,
    modeloClave: p.ModeloClave ? String(p.ModeloClave).trim() : null,   // variante: SU modelo del molde
    cantidadMinima: Number(p.CantidadMinima) || 0, cantidadFija: Number(p.CantidadFija) || 0,
    precio: p.Precio != null && Number(p.Precio) > 0 ? Number(p.Precio) : null, monId: p.MonIdMoneda === 2 ? 2 : 1,
    moneda: p.MonIdMoneda === 2 ? 'USD' : 'UYU', foto: p.Foto || null,
  };
}
const esArmable = (p) => p.publicado && p.tipoVitrina !== 'TERMINADO' && !!p.moldeRef;

// Productos de la tienda que se arman acá (la ficha muestra "Armar mi pedido")
async function armables(pool) {
  const cols = await columnasConfig(pool);
  if (!cols.has('TizadaProMoldeRef')) return [];
  const r = await pool.request().query(`
    SELECT tp.ProIdProducto FROM dbo.TiendaProductos tp
    JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = tp.ProIdProducto
    WHERE tp.Publicado = 1 AND UPPER(LTRIM(RTRIM(ISNULL(tp.TipoVitrina, 'TERMINADO')))) <> 'TERMINADO' AND LTRIM(RTRIM(ISNULL(vc.TizadaProMoldeRef, ''))) <> ''`);
  return r.recordset.map(x => x.ProIdProducto);
}

// Extras del producto (configurador › Técnicas: ProductoTerminadoServicios) con la forma de hacerlos (TecnicaOpciones:
// el artículo → variante y material de la parte, lo mismo que el vendedor elige a mano en "Servicios y extras").
// Las formas de hacer bordado / DTF / TPU (TecnicaOpciones activas), con su material y variante, y si el producto la marcó
async function opcionesTecnicas(pool, proId) {
  return (await pool.request().input('P', sql.Int, proId).query(`
    SELECT t.TecnicaOpcionID, LTRIM(RTRIM(t.AreaID)) AS AreaID, LTRIM(RTRIM(t.Nombre)) AS Nombre, m.Material, m.Variante, m.CodArticulo, m.CodStock,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.ProductoTecnicaOpciones x WHERE x.ProIdProducto = @P AND x.TecnicaOpcionID = t.TecnicaOpcionID) THEN 1 ELSE 0 END AS Marcada
    FROM dbo.TecnicaOpciones t
    OUTER APPLY (SELECT TOP 1 LTRIM(RTRIM(a.Descripcion)) AS Material, LTRIM(RTRIM(sa.Articulo)) AS Variante,
                        LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.CodStock)) AS CodStock
                 FROM dbo.Articulos a LEFT JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
                 WHERE LTRIM(RTRIM(a.CodArticulo)) = LTRIM(RTRIM(t.CodArticulo))) m
    WHERE t.AreaID IN ('EMB', 'DF', 'TPU') AND ISNULL(t.Activo, 1) = 1
    ORDER BY t.AreaID, ISNULL(t.Orden, 999), t.TecnicaOpcionID`).catch(() => ({ recordset: [] }))).recordset
    .filter(o => o.Material && o.Variante && !/recargo/i.test(o.Nombre));   // los recargos (Relieve 3D) no son una forma de hacerlo
}

async function extrasDelProducto(pool, proId) {
  const serv = (await pool.request().input('P', sql.Int, proId).query(`
    SELECT LTRIM(RTRIM(AreaID)) AS AreaID, Obligatorio, UPPER(ISNULL(Modo, 'LIBRE')) AS Modo, UPPER(ISNULL(Cobro, 'APARTE')) AS Cobro
    FROM dbo.ProductoTerminadoServicios WHERE ProIdProducto = @P`).catch(() => ({ recordset: [] }))).recordset
    .filter(s => EXTRA_DE_AREA[String(s.AreaID).toUpperCase()]);
  if (!serv.length) return [];
  const opc = await opcionesTecnicas(pool, proId);
  return serv.map(s => {
    const area = String(s.AreaID).toUpperCase();
    const tipo = EXTRA_DE_AREA[area];
    const deArea = opc.filter(o => o.AreaID === area);
    const marcadas = deArea.filter(o => o.Marcada);
    const lista = (s.Modo === 'LIBRE' || !marcadas.length) ? deArea : marcadas;
    return {
      tipo, nombre: NOMBRE_EXTRA[tipo], obligatorio: !!s.Obligatorio, cobro: s.Cobro === 'INCLUIDA' ? 'INCLUIDA' : 'APARTE',
      opciones: (s.Modo === 'FIJA' ? lista.slice(0, 1) : lista).map(opcionDe),
    };
  });
}
// [TIPO DEL EXTRA 14/10] Para la tabla del arte del VENDEDOR: cómo se puede hacer cada extra, la misma lista que ve el
// cliente en la Tienda (las que ofrece el producto). Si el producto no tiene ese extra en Técnicas (el vendedor lo agregó
// igual), todas las activas del área. { BORDADO: [{ id, nombre, material, variante }], DTF: [...], TPU: [...] }
async function formasDeExtras(pool, proId) {
  const [conf, opc] = await Promise.all([extrasDelProducto(pool, proId), opcionesTecnicas(pool, proId)]);
  return Object.fromEntries(Object.entries(EXTRA_DE_AREA).map(([area, tipo]) => {
    const e = conf.find(x => x.tipo === tipo);
    return [tipo, e ? e.opciones : opc.filter(o => o.AreaID === area).map(opcionDe)];
  }));
}
const opcionDe = (o) => ({ id: o.TecnicaOpcionID, nombre: o.Nombre, material: o.Material, variante: o.Variante, codArticulo: o.CodArticulo || null, codStock: o.CodStock || null });

function parteExtra(e, opcionId, previa = null, cantidad = 1) {
  const op = e.opciones.find(o => o.id === opcionId) || e.opciones.find(o => o.material === previa?.Datos?.material) || e.opciones[0] || null;
  const datos = { ...(previa?.Datos || {}), opcionId: op?.id || null, variante: op?.variante || (e.tipo === 'DTF' ? 'DTF Textil' : null), material: op?.material || null };
  if (e.tipo === 'TPU') datos.origenPrendas = 'Stock User';
  return {
    ParteID: previa?.ParteID, Tipo: e.tipo, IncluidoEnProducto: e.obligatorio, CantidadTotal: previa?.CantidadTotal ?? cantidad, PorPrenda: previa?.PorPrenda ?? 1,
    Ubicacion: previa?.Ubicacion || null, ArteOrigen: e.tipo === 'DTF' ? 'CLIENTE' : 'EMPRESA', Observaciones: previa?.Observaciones || null, Datos: datos,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Cambios con svc.actualizar: se arma el cuerpo con lo que hay (como el formulario del vendedor al editar) y se cambia lo justo
// ─────────────────────────────────────────────────────────────────────
const fechaTxt = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
async function actualizarSolicitud(pool, s, cambiar) {
  const sol = await svc.obtener(pool, s.user, s.SolicitudID);
  const body = {
    CodCliente: sol.CodCliente, NombreTrabajo: sol.NombreTrabajo, Detalle: sol.Detalle, Observaciones: sol.Observaciones, PreId: sol.PreId,
    FechaEntrega: fechaTxt(sol.FechaEntrega), FechaEntregaHasta: fechaTxt(sol.FechaEntregaHasta), Ficha: sol.Ficha || {},
    Productos: sol.Productos.map(p => ({
      ProductoSolID: p.ProductoSolID, TipoFabricacion: p.TipoFabricacion, ProIdProducto: p.ProIdProducto, ProductoNombre: p.ProductoNombre,
      Cantidad: p.Cantidad, Observaciones: p.Observaciones, Datos: p.Datos,
      Partes: p.Partes.map(pa => ({ ParteID: pa.ParteID, Tipo: pa.Tipo, IncluidoEnProducto: pa.IncluidoEnProducto, CantidadTotal: pa.CantidadTotal, PorPrenda: pa.PorPrenda,
        Ubicacion: pa.Ubicacion, ArteOrigen: pa.ArteOrigen, Datos: pa.Datos, Observaciones: pa.Observaciones })),
    })),
  };
  await cambiar(body, sol);
  return svc.actualizar(pool, s.user, s.SolicitudID, body);
}

// ─────────────────────────────────────────────────────────────────────
// Alta desde la tienda (o se retoma el que quedó a medio armar del mismo producto)
// ─────────────────────────────────────────────────────────────────────
async function crear(pool, token, b) {
  await exigirColumnas(pool);
  const cli = clienteDe(token);
  const proId = parseInt(b?.proIdProducto, 10);
  if (!proId) throw fallo(400, 'Elegí el producto.');
  const prod = await producto(pool, proId);
  if (!esArmable(prod)) throw fallo(422, 'Este producto todavía no se puede armar desde la tienda: consultanos por Soporte.', { codigo: 'NO_ARMABLE' });

  const ya = (await pool.request().input('C', sql.Int, cli.codCliente).input('P', sql.Int, proId).query(`
    SELECT TOP 1 s.SolicitudID FROM dbo.SolicitudesVendedor s
    JOIN dbo.SolicitudesVendedorProductos p ON p.SolicitudID = s.SolicitudID AND p.Activo = 1
    WHERE s.CodCliente = @C AND s.Origen = 'PORTAL' AND s.PortalConfirmado IS NULL AND s.Estado <> 'CANCELADA' AND p.ProIdProducto = @P
    ORDER BY s.SolicitudID DESC`)).recordset[0];
  if (ya && !b?.nuevo) return { SolicitudID: ya.SolicitudID, retomado: true };

  const user = usuarioPortal(await vendedorDe(pool, cli.codCliente), cli);
  const cant = Math.max(1, prod.cantidadFija || prod.cantidadMinima || 1);
  const extras = (await extrasDelProducto(pool, proId)).filter(e => e.obligatorio);
  const { SolicitudID } = await svc.crear(pool, user, {
    CodCliente: cli.codCliente, NombreTrabajo: prod.nombre,
    Detalle: 'Pedido armado por el cliente desde la Tienda del portal: el arte, la tela, la lista de jugadores y el arte de los extras los cargó el cliente.',
    Productos: [{
      TipoFabricacion: 'PRODUCTO_TERMINADO', ProIdProducto: proId, ProductoNombre: prod.nombre, Cantidad: cant,
      // Como el formulario del vendedor: se corta y se cose todo; el diseño lo trae el cliente (lo verifica la tizada)
      Datos: { corte: { activo: true, tipoMolde: 'SUBLIMACION', origenTela: 'TELA SUBLIMADA EN USER' }, costura: { activo: true, instrucciones: '' },
               comoSeDefine: 'TALLE', diseno: { origen: 'CLIENTE', verificado: false, aprobado: false } },
      Partes: [{ Tipo: 'PRINCIPAL', ArteOrigen: 'CLIENTE' }, ...extras.map(e => parteExtra(e, null, null, cant))],
    }],
  });
  try {
    await pool.request().input('S', sql.Int, SolicitudID).query("UPDATE dbo.SolicitudesVendedor SET Origen = 'PORTAL' WHERE SolicitudID = @S");
  } catch (e) {
    await svc.cancelar(pool, user, SolicitudID, { Motivo: 'No se pudo marcar como pedido del portal.' }).catch(() => { });
    throw e;
  }
  const p = (await svc.obtener(pool, user, SolicitudID)).Productos[0];
  await modeloYTelaPorDefecto(pool, user, SolicitudID, p.ProductoSolID, prod);
  logger.info(`[PORTAL-PEDIDO] cliente ${cli.codCliente} empezó a armar SOL-${SolicitudID} (${prod.nombre})`);
  return { SolicitudID };
}

// Modelo y tela de arranque ("Piezas y telas"), guardados con svc.guardarSublimacion: el modelo de la variante (o el
// marcado por defecto, o el primero, como la pantalla) y la tela que el producto ofrece (la única, o la marcada por defecto).
async function modeloYTelaPorDefecto(pool, user, solicitudId, productoSolId, prod) {
  try {
    const molde = await svc.moldeDelProducto(pool, user, solicitudId, productoSolId);
    if (!molde.aplica || molde.elegido?.modeloClave) return;
    const modelo = molde.modelos.find(m => m.clave === prod.modeloClave) || molde.modelos.find(m => m.esDefault) || molde.modelos[0];
    const tela = molde.telas.length === 1 ? molde.telas[0] : molde.telas.find(t => t.esDefault);
    if (!modelo) return;
    await svc.guardarSublimacion(pool, user, solicitudId, productoSolId, {
      modeloClave: modelo.clave, parcial: !tela, piezas: modelo.piezas.map(pz => ({ pieza: pz.pieza, telaProIdProducto: pz.telaFija ? null : (tela?.proIdProducto || null) })),
    });
  } catch (e) { logger.warn(`[PORTAL-PEDIDO] modelo/tela de arranque SOL-${solicitudId}: ${e.message}`); }
}

// Lo de la tienda que la Solicitud no trae: foto, precio de catálogo, mínimos y los extras del producto (con cuáles lleva)
async function resumen(pool, token, id) {
  const s = await solicitudDelCliente(pool, token, id);
  const prod0 = await producto(pool, s.ProIdProducto);
  // Sin modelo / tela todavía (pedido abierto antes de este arranque): se ponen los de por defecto
  const enArmado = !s.PortalConfirmado && s.Estado !== 'CANCELADA' && !s.PedidoNoDocERP;
  if (enArmado && !(() => { try { return JSON.parse(s.DatosJson || '{}').sublimacion?.modeloClave; } catch (_) { return null; } })()) {
    await modeloYTelaPorDefecto(pool, s.user, s.SolicitudID, s.ProductoSolID, prod0);
  }
  const [prod, extras, partes, envio] = await Promise.all([
    prod0,
    extrasDelProducto(pool, s.ProIdProducto),
    pool.request().input('P', sql.Int, s.ProductoSolID).query("SELECT ParteID, Tipo, DatosJson, Ubicacion FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Activo = 1 AND Tipo <> 'PRINCIPAL'"),
    // el último pedido a TIZADA PRO (no las revisiones): para que el cliente vea si lo rechazó, en vez de esperar
    s.PortalConfirmado ? pool.request().input('P', sql.Int, s.ProductoSolID).query(`
      SELECT TOP 1 Estado FROM dbo.TizadaProEnvios
      WHERE Origen = 'SOLICITUD' AND OrigenItemID = @P AND ISNULL(SoloRevision, 0) = 0 ORDER BY EnvioID DESC`).catch(() => ({ recordset: [] })) : { recordset: [] },
  ]);
  const ult = envio.recordset[0];
  return {
    SolicitudID: s.SolicitudID, ProductoSolID: s.ProductoSolID, confirmado: s.PortalConfirmado, cancelado: s.Estado === 'CANCELADA', pedido: s.PedidoNoDocERP || null,
    tizada: ult ? { estado: ult.Estado } : null,   // el motivo lo ve el equipo en la solicitud
    producto: { proId: prod.proId, nombre: prod.nombreCorto, nombreCompleto: prod.nombre, foto: prod.foto, precio: prod.precio, moneda: prod.moneda, cantidadMinima: prod.cantidadMinima, cantidadFija: prod.cantidadFija },
    extras: extras.map(e => {
      const pa = partes.recordset.find(x => x.Tipo === e.tipo);
      const d = (() => { try { return JSON.parse(pa?.DatosJson || '{}'); } catch (_) { return {}; } })();
      return { tipo: e.tipo, nombre: e.nombre, obligatorio: e.obligatorio, cobro: e.cobro, activo: !!pa, opciones: e.opciones.map(o => ({ id: o.id, nombre: o.nombre })),
        opcionId: d.opcionId || e.opciones.find(o => o.material === d.material)?.id || null, parteId: pa?.ParteID || null, ubicacion: pa?.Ubicacion || '' };
    }),
  };
}

// Agregar / quitar un extra opcional del producto, elegir cómo se hace (bordado sobre la prenda / parche…) o dónde va
async function cambiarExtra(pool, token, id, tipo, b) {
  const s = await solicitudDelCliente(pool, token, id, { escribir: true });
  const T = String(tipo || '').toUpperCase();
  const e = (await extrasDelProducto(pool, s.ProIdProducto)).find(x => x.tipo === T);
  if (!e) throw fallo(400, 'Este producto no lleva ese extra.');
  const opcionId = b?.opcionId != null ? parseInt(b.opcionId, 10) : null;
  if (opcionId && !e.opciones.some(o => o.id === opcionId)) throw fallo(400, 'Esa opción no está disponible para este producto.');
  if (b?.activo === false && e.obligatorio) throw fallo(409, `${e.nombre} viene incluido en el producto: no se puede quitar.`);
  return actualizarSolicitud(pool, s, (body) => {
    const p = body.Productos[0];
    const previa = p.Partes.find(x => x.Tipo === T) || null;
    p.Partes = p.Partes.filter(x => x.Tipo !== T);
    if (b?.activo === false) return;
    const nueva = parteExtra(e, opcionId, previa, p.Cantidad);
    if (b?.ubicacion !== undefined) nueva.Ubicacion = txt(b.ubicacion, 300) || null;   // dónde va (ej. pecho izquierdo)
    p.Partes.push(nueva);
  });
}

async function descartar(pool, token, id) {
  const s = await solicitudDelCliente(pool, token, id, { escribir: true });
  await svc.cancelar(pool, s.user, s.SolicitudID, { Motivo: 'El cliente descartó el pedido que estaba armando en la tienda del portal.' });
  return { ok: true };
}

// Pedidos de la tienda del cliente en curso: los que está armando y los confirmados que todavía no son pedido de
// producción (los que ya pasaron a producción se siguen en Mi Fábrica, no acá)
async function listar(pool, token) {
  await exigirColumnas(pool);
  const cli = clienteDe(token);
  const r = await pool.request().input('C', sql.Int, cli.codCliente).query(`
    SELECT TOP 30 s.SolicitudID, s.PortalConfirmado, s.NombreTrabajo, s.FechaSolicitud, p.ProductoNombre, p.Cantidad, p.PedidoNoDocERP, p.DatosJson,
           (SELECT TOP 1 pa.Estado FROM dbo.SolicitudesVendedorPartes pa WHERE pa.ProductoSolID = p.ProductoSolID AND pa.Tipo = 'PRINCIPAL' AND pa.Activo = 1) AS EstadoPrincipal
    FROM dbo.SolicitudesVendedor s
    JOIN dbo.SolicitudesVendedorProductos p ON p.SolicitudID = s.SolicitudID AND p.Activo = 1
    WHERE s.CodCliente = @C AND s.Origen = 'PORTAL' AND s.Estado <> 'CANCELADA' AND p.PedidoNoDocERP IS NULL
      AND (s.PortalConfirmado IS NULL OR s.PortalConfirmado > DATEADD(DAY, -45, GETDATE()))
    ORDER BY CASE WHEN s.PortalConfirmado IS NULL THEN 0 ELSE 1 END, s.SolicitudID DESC`);
  // Mientras lo arma, las prendas salen de la lista de jugadores (Cantidad vacía = 1); al confirmar quedan en Cantidad.
  // [A MEDIDA] la cantidad de cada diseño (los diseños con medida)
  const prendasDeLista = (datosJson) => {
    let tzp = {};
    try { tzp = JSON.parse(datosJson || '{}').tizadaPro || {}; } catch (_) { /* sin lista */ }
    const ds = (tzp.disenos || []).filter(d => d.medida);
    if (ds.length) return ds.reduce((t, d) => t + (parseInt(d.cantidad, 10) > 0 ? parseInt(d.cantidad, 10) : 0), 0);
    return (tzp.planilla || []).reduce((t, f) => t + (Number(f.cantidad) > 0 ? Number(f.cantidad) : 1), 0);
  };
  return r.recordset.map(x => ({
    // sin la familia, como en la tienda; si el cliente le puso nombre al pedido (el equipo), ese
    id: x.SolicitudID, producto: String(x.ProductoNombre || '').split(' · ').pop().trim(),
    nombre: x.NombreTrabajo && x.NombreTrabajo !== x.ProductoNombre ? x.NombreTrabajo : String(x.ProductoNombre || '').split(' · ').pop().trim(),
    pedido: x.PedidoNoDocERP || null,
    prendas: x.PortalConfirmado ? x.Cantidad : prendasDeLista(x.DatosJson),
    aMedida: (() => { try { return (JSON.parse(x.DatosJson || '{}').tizadaPro?.disenos || []).some(d => d.medida); } catch (_) { return false; } })(),
    etapa: !x.PortalConfirmado ? 'ARMANDO' : x.PedidoNoDocERP ? 'PEDIDO' : x.EstadoPrincipal === 'DISENADO' ? 'LISTO' : 'TIZADA',
  }));
}

// ─────────────────────────────────────────────────────────────────────
// [A MEDIDA · AUTOGESTIÓN] El arte del cliente para una toalla, bandera…: SOLO .ai (compatible con PDF) o .pdf, que
// sirva para imprimir. Al subirlo se revisa (revisarArte) y al confirmar se arma solo el arte para TIZADA con la medida
// TOTAL que calcula TIZADA (medida + margen), en vectores (armarArtesAMedida). Nadie lo arma a mano.
// ─────────────────────────────────────────────────────────────────────
const DPI_MIN = () => Number(process.env.PORTAL_ARTE_DPI_MIN) || 100;   // menos que esto, las imágenes del arte se ven pixeladas
const sinTildes = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const AI_VIEJO = 'es un .ai en formato viejo (PostScript) o guardado sin "Crear archivo compatible con PDF". Abrilo en Illustrator y guardalo de nuevo como .ai con esa opción tildada (o exportalo como PDF) y subilo otra vez.';

// Lo que se sabe de un arte (se calcula una vez por archivo y queda en disco): si sirve, por qué no, sus mesas, la calidad
// de la primera página (trazos, imágenes con su tamaño, texto vivo) y su vista entera para dibujarla sobre la forma.
async function analisisDeArte(pool, solicitudId, archivoId) {
  const a = (await pool.request().input('A', sql.Int, parseInt(archivoId, 10) || 0).input('S', sql.Int, solicitudId)
    .query('SELECT ArchivoID, NombreOriginal, UrlDrive FROM dbo.SolicitudesVendedorArchivos WHERE ArchivoID = @A AND SolicitudID = @S AND Vigente = 1')).recordset[0];
  if (!a) throw fallo(404, 'Ese archivo no está en tu pedido.');
  if (!/\.(ai|pdf)$/i.test(a.NombreOriginal || '')) return { ok: false, problemas: ['El arte tiene que ser un .ai o un .pdf (con los textos convertidos a curvas).'] };
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(require('../utils/rutasUploads').rutaUploads('cache'), 'arte-portal');
  const archivo = path.join(dir, `${a.ArchivoID}.json`);
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch (_) { /* no está todavía */ }
  let buffer;
  try { buffer = await require('./solicitudesVendedorTizadaPro').bajarDeDrive(a.UrlDrive); }
  catch (e) { throw fallo(502, `No se pudo leer "${a.NombreOriginal}": ${e.message}`); }
  const ini = buffer.indexOf('%PDF');
  let r;
  if (ini < 0 || ini > 1024) r = { ok: false, problemas: [`"${a.NombreOriginal}" ${AI_VIEJO}`] };
  else {
    let an;
    try { an = await require('./tizadaProEditables').analizarArte(buffer); }
    catch (e) { throw fallo(422, `No se pudo abrir "${a.NombreOriginal}": ${e.message}`); }
    const q = an.calidad;
    const problemas = [];
    if (q.texto) problemas.push('Tiene textos sin convertir a curvas: en Illustrator seleccioná todo, Texto › Crear contornos, y guardalo de nuevo.');
    if (!q.trazos && !q.imagenes.length) problemas.push('La primera página está vacía.');
    r = {
      ok: !problemas.length, problemas, paginas: an.paginas, vectorial: !q.imagenes.length,
      calidad: { anchoPt: q.anchoPt, altoPt: q.altoPt, imagenes: q.imagenes }, vista: an.vista,
    };
  }
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(archivo, JSON.stringify(r)); }
  catch (e) { logger.warn(`[PORTAL-PEDIDO] análisis del arte ${a.ArchivoID}: no se guardó en disco (${e.message})`); }
  return r;
}

// GET /:id/arte/:archivoId — ¿el arte sirve para imprimir? (+ su vista y lo necesario para calcular la resolución a la medida)
async function revisarArte(pool, token, id, archivoId) {
  const s = await solicitudDelCliente(pool, token, id);
  return { ...(await analisisDeArte(pool, s.SolicitudID, archivoId)), dpiMinimo: DPI_MIN() };
}

// Al confirmar: por cada diseño con el arte del cliente (archivoCliente), el arte para TIZADA. Si el cliente ya lo armó sobre
// la plantilla (sus mesas dicen la pieza en "guias"), va tal cual; si no, se arma solo a la medida TOTAL, en vectores. Si ya
// se armó con el mismo archivo, medida y ajuste, no se rehace; si cambió algo, se rehace y el anterior se quita.
// Devuelve lo que no se pudo (por diseño).
async function armarArtesAMedida(pool, s, sol, tz) {
  const am = require('./tizadaProAMedida');
  const cfg = tz.aMedida?.config;
  const principal = sol.Productos[0].Partes.find(pa => pa.Tipo === 'PRINCIPAL');
  if (!cfg || !principal) return [];
  const pieza = cfg.pieza || tz.estructura?.piezas?.[0];
  const problemas = [];
  const disenos = [];
  let cambio = false;
  for (const d of tz.datos?.disenos || []) {
    const origen = d.archivoCliente;
    const firma = { origen, medida: am.resumen(d.medida), ajuste: d.ajuste === 'entera' ? 'entera' : 'llenar' };
    const hecho = (d.arteArchivoId === origen && !d.arteAuto)
      || (d.arteAuto && d.arteArchivoId && d.arteAuto.origen === firma.origen && d.arteAuto.medida === firma.medida && d.arteAuto.ajuste === firma.ajuste);
    // sin arte, ya armado, o sin medida todavía (eso lo dice la revisión): queda como está
    if (!origen || hecho || am.normalizarMedida(d.medida, cfg, null).errores.length) { disenos.push(d); continue; }
    const arch = sol.Archivos.find(a => a.ArchivoID === origen && a.Vigente);
    if (!arch) { problemas.push(`${d.nombre}: tu arte ya no está: subilo de nuevo.`); disenos.push({ ...d, archivoCliente: null }); cambio = true; continue; }
    try {
      const an = await analisisDeArte(pool, s.SolicitudID, origen);
      if (!an.ok) { an.problemas.forEach(m => problemas.push(`${d.nombre}: ${m}`)); disenos.push(d); continue; }
      // armado sobre la plantilla de TIZADA: va tal cual (TIZADA controla que sea de esta medida)
      if (an.paginas.some(m => m.pieza && sinTildes(m.pieza) === sinTildes(pieza))) {
        disenos.push({ ...d, arteArchivoId: origen, arteAuto: null, editablesLeidoDe: null });
        cambio = true;
        continue;
      }
      const c = await svc.tizadaProCalcular(pool, s.user, s.SolicitudID, s.ProductoSolID, { medida: d.medida, tela: d.tela });
      if (!c.ok || !c.total_cm?.ancho) throw new Error([...(c.errores || []), ...(c.alarmas || []).map(a => a.mensaje || a.codigo), c.sinTizada, c.error].filter(Boolean).join(' ') || 'TIZADA no calculó la medida');
      const dpi = am.dpiImpreso(an.calidad, c.total_cm.ancho, c.total_cm.alto, firma.ajuste);
      if (dpi != null && dpi < DPI_MIN()) {
        problemas.push(`${d.nombre}: las imágenes de tu arte quedan a ${dpi} dpi impresas a esta medida (mínimo ${DPI_MIN()}): se verían pixeladas. Usá imágenes de más resolución o vectores.`);
        disenos.push(d);
        continue;
      }
      const pdf = await am.arteDesdePdf({
        pdf: await require('./solicitudesVendedorTizadaPro').bajarDeDrive(arch.UrlDrive),
        anchoCm: c.total_cm.ancho, altoCm: c.total_cm.alto, pieza, ajuste: firma.ajuste,
      });
      const nombre = `${d.nombre}__arte ${Math.round(c.total_cm.ancho)}x${Math.round(c.total_cm.alto)} cm.pdf`;   // la medida total (con el margen)
      const sub = await svc.subirArchivo(pool, s.user, s.SolicitudID, { Rol: 'ARTE_CLIENTE', ParteID: principal.ParteID }, { buffer: pdf, size: pdf.length, originalname: nombre });
      if (d.arteAuto && d.arteArchivoId) await svc.quitarArchivo(pool, s.user, s.SolicitudID, d.arteArchivoId).catch(() => { });   // el armado antes, de otra medida
      // el armado no tiene editables propios (se marca leído para que la pantalla no lo lea)
      disenos.push({ ...d, arteArchivoId: sub.ArchivoID, arteAuto: firma, editablesLeidoDe: sub.ArchivoID, editablesDetalle: [], editables: {} });
      cambio = true;
    } catch (e) {
      logger.warn(`[PORTAL-PEDIDO] arte a medida SOL-${s.SolicitudID} ${d.nombre}: ${e.message}`);
      problemas.push(`${d.nombre}: no se pudo armar el arte para TIZADA (${e.message}).`);
      disenos.push(d);
    }
  }
  if (cambio) await svc.tizadaProGuardar(pool, s.user, s.SolicitudID, s.ProductoSolID, { disenos, planilla: tz.datos?.planilla || [] });
  return problemas;
}

// ─────────────────────────────────────────────────────────────────────
// Confirmar: deja la solicitud como la necesita la conversión y la manda a TIZADA PRO
// ─────────────────────────────────────────────────────────────────────
async function confirmar(pool, token, id, b) {
  const s = await solicitudDelCliente(pool, token, id, { escribir: true });
  const prod = await producto(pool, s.ProIdProducto);
  const sol = await svc.obtener(pool, s.user, s.SolicitudID);
  const p = sol.Productos[0];
  let tz = await svc.tizadaProVer(pool, s.user, s.SolicitudID, s.ProductoSolID);
  // [A MEDIDA] primero se arma solo el arte de los diseños que trajeron una imagen; después se revisa todo
  const sinArmar = tz.aMedida && !tz.sinGuardar ? await armarArtesAMedida(pool, s, sol, tz) : [];
  if (tz.aMedida && !tz.sinGuardar) {
    tz = await svc.tizadaProVer(pool, s.user, s.SolicitudID, s.ProductoSolID);
    sol.Archivos = (await svc.obtener(pool, s.user, s.SolicitudID)).Archivos;
  }

  // Lo que frena (cada cosa con el paso de la pantalla donde se arregla)
  const faltan = [];
  const pf = (paso, mensaje) => faltan.push({ paso, mensaje });
  if (!tz.aplica) pf('arte', tz.motivo || 'Este producto no tiene molde de TIZADA PRO.');
  if (!tz.apiActiva) pf('confirmar', 'Ahora mismo no hay conexión con TIZADA PRO. Dejá todo cargado y confirmalo en un rato.');
  sinArmar.forEach(m => pf('arte', m));
  (tz.errores || []).forEach(e => {
    // [A MEDIDA] un diseño con su arte subido que no se pudo armar ya dice por qué (sinArmar); sin arte: que lo suba
    const d = tz.aMedida && /^disenos\[(\d+)\]\.arte$/.test(e.donde) ? (tz.datos?.disenos || [])[Number(e.donde.match(/\d+/)[0])] : null;
    if (d?.archivoCliente) return;
    pf(/^planilla/.test(e.donde) ? 'lista' : /\.(medida|cantidad)$/.test(e.donde) ? 'medida' : /\.(variable|tela)$/.test(e.donde) ? 'tela' : 'arte',
      d ? `${d.nombre}: falta tu arte (.ai o .pdf).` : e.mensaje);
  });
  const cc = (tz.estructura?.columnas || []).find(c => c.rol === 'cantidad');
  // [A MEDIDA] las unidades son la cantidad de cada diseño; si no, las filas de la lista de jugadores (Cantidad vacía = 1)
  const prendas = tz.aMedida
    ? (tz.datos?.disenos || []).reduce((t, d) => t + (parseInt(d.cantidad, 10) > 0 ? parseInt(d.cantidad, 10) : 0), 0)
    : (tz.datos?.planilla || []).reduce((t, f) => t + (cc && Number(f[cc.id]) > 0 ? Number(f[cc.id]) : 1), 0);
  const [pasoCant, unid, enLa] = tz.aMedida ? ['medida', 'unidades', 'el pedido'] : ['lista', 'prendas', 'la lista'];
  if (prendas && prod.cantidadMinima && prendas < prod.cantidadMinima) pf(pasoCant, `El mínimo de este producto es ${prod.cantidadMinima} ${unid} (${enLa} tiene ${prendas}).`);
  if (prendas && prod.cantidadFija && prendas % prod.cantidadFija) pf(pasoCant, `Este producto va en paquetes de ${prod.cantidadFija}: ${enLa} tiene que sumar un múltiplo de ${prod.cantidadFija} (tiene ${prendas}).`);
  const arteDe = (pa) => sol.Archivos.filter(a => a.Vigente && a.ParteID === pa.ParteID && a.Rol === 'ARTE_CLIENTE');

  // Extras POR ARTE (13/10): cada camiseta (jugador, golero…) lleva los obligatorios del producto + los que prendió en su
  // pestaña (disenos[].extras). Pedidos de antes, sin nada por arte: el extra que está en el pedido vale para todos.
  const disenos = tz.sinGuardar ? [] : (tz.datos?.disenos || []);
  const filasDe = (d) => (tz.datos?.planilla || []).filter(f => disenos.length === 1 || String(f.diseno || '').toUpperCase() === d.nombre);
  const sumar = (fs) => fs.reduce((t, f) => t + (cc && Number(f[cc.id]) > 0 ? Number(f[cc.id]) : 1), 0);
  const cfgExtras = await extrasDelProducto(pool, s.ProIdProducto);
  const PROC = { BORDADO: 'bordado', DTF: 'dtf', TPU: 'tpu' };
  const obligatorio = (T) => !!cfgExtras.find(e => e.tipo === T)?.obligatorio;
  const porArte = (T) => disenos.some(d => d.extras && T in d.extras);
  const lleva = (d, T) => obligatorio(T) || (porArte(T) ? !!d.extras?.[T]?.activo : p.Partes.some(pa => pa.Tipo === T));
  const deDiseno = (a, d) => String(a.NombreOriginal || '').toUpperCase().startsWith(`${d.nombre}__`);   // subido en la pestaña de ese arte
  for (const pa of p.Partes.filter(x => x.Tipo !== 'PRINCIPAL')) {
    const arte = arteDe(pa);
    const paraTodos = arte.filter(a => !/^EDITABLE_/i.test(a.NombreOriginal || '') && !disenos.some(d => deDiseno(a, d)));
    for (const d of disenos.filter(x => lleva(x, pa.Tipo))) {
      const conEditable = (d.editablesDetalle || []).some(o => ((d.editables || {})[o.objeto] || o.sugerido) === PROC[pa.Tipo]);
      if (!conEditable && !arte.some(a => deDiseno(a, d)) && !paraTodos.length) pf('extras', `${d.nombre} · ${pa.Nombre}: falta el arte (un editable de su diseño o un archivo).`);
    }
  }
  if (faltan.length) throw fallo(409, 'Todavía falta completar algunas cosas.', { faltan });
  // Prendas y "dónde va" de cada extra: las de los artes que lo llevan
  const prendasExtra = (T) => (disenos.length ? sumar(disenos.filter(d => lleva(d, T)).flatMap(filasDe)) : prendas);
  const ubicacionExtra = (T) => disenos.filter(d => lleva(d, T) && d.extras?.[T]?.ubicacion)
    .map(d => (disenos.length > 1 ? `${d.nombre}: ${d.extras[T].ubicacion}` : d.extras[T].ubicacion)).join(' · ');

  // 1. Cantidad = la lista; nombre, notas y fecha de entrega (la que estima la cola real de cada sector; si no, 15 días)
  let fecha = null;
  try { fecha = (await require('./solicitudesVendedorPlazo').estimarPlazo({ ...sol, Productos: [{ ...p, Cantidad: prendas }] }))?.fechaEstimadaFin || null; }
  catch (e) { logger.warn(`[PORTAL-PEDIDO] plazo SOL-${s.SolicitudID}: ${e.message}`); }
  if (!fecha) { const d = new Date(); d.setDate(d.getDate() + 15); fecha = d.toISOString().slice(0, 10); }
  const notas = txt(b?.observaciones, 2000);
  await actualizarSolicitud(pool, s, (body) => {
    body.NombreTrabajo = txt(b?.nombreTrabajo, 200) || body.NombreTrabajo;
    body.Observaciones = [body.Observaciones, notas].filter(Boolean).join('\n') || null;
    body.FechaEntrega = fecha;
    const q = body.Productos[0];
    q.Cantidad = prendas;
    // un extra opcional que no lleva ningún arte sale del pedido; los demás llevan las prendas de sus artes y dónde va cada uno
    q.Partes = q.Partes.filter(pa => pa.Tipo === 'PRINCIPAL' || obligatorio(pa.Tipo) || prendasExtra(pa.Tipo) > 0);
    q.Partes.filter(pa => pa.Tipo !== 'PRINCIPAL').forEach(pa => {
      pa.CantidadTotal = prendasExtra(pa.Tipo) || prendas;
      pa.PorPrenda = Math.max(1, pa.PorPrenda || 1);
      const u = ubicacionExtra(pa.Tipo);
      if (u) pa.Ubicacion = u.slice(0, 300);
    });
  });

  // 2. Precio: el de catálogo por prenda (lo que dice la tienda). Los extras "aparte" los suma el vendedor; sin precio de catálogo, cobra cada área.
  if (prod.precio) await svc.guardarPrecio(pool, s.user, s.SolicitudID, { ModoCobro: 'PRECIO_ESTABLECIDO', PrecioPactado: +(prod.precio * prendas).toFixed(2), MonIdMoneda: prod.monId, RequiereSena: false });
  else await svc.guardarPrecio(pool, s.user, s.SolicitudID, { ModoCobro: 'POR_AREA', MonIdMoneda: prod.monId, RequiereSena: false });

  // 3. A TIZADA PRO: el mismo envío que hace el vendedor ("Enviar a Diseño" con "Generar ya la tizada"). Antes de salir,
  //    TIZADA revisa los datos y las letras del arte: si no lo acepta, no se confirma nada (409 con el motivo).
  const principal = p.Partes.find(pa => pa.Tipo === 'PRINCIPAL');
  const r = await svc.enviarADiseno(pool, s.user, principal.ParteID, { TipoTrabajo: 'REVISAR', Tizada: true });
  // DTF con un arte subido aparte (no editable del diseño): el pliego lo arma Diseño, como en cualquier solicitud
  for (const pa of p.Partes.filter(x => x.Tipo === 'DTF' && x.Estado === 'INGRESADO' && arteDe(x).some(a => !/^EDITABLE_/i.test(a.NombreOriginal || '')))) {
    await svc.enviarADiseno(pool, s.user, pa.ParteID, { TipoTrabajo: 'REVISAR' }).catch(e => logger.warn(`[PORTAL-PEDIDO] DTF a Diseño SOL-${s.SolicitudID}: ${e.message}`));
  }
  await pool.request().input('S', sql.Int, s.SolicitudID).query('UPDATE dbo.SolicitudesVendedor SET PortalConfirmado = GETDATE() WHERE SolicitudID = @S');
  const aparte = (await extrasDelProducto(pool, s.ProIdProducto)).filter(e => e.cobro === 'APARTE' && p.Partes.some(pa => pa.Tipo === e.tipo)).map(e => e.nombre);
  await svc._baseTizadaPro().registrarEvento(pool, s.user, {
    solicitudId: s.SolicitudID, productoSolId: s.ProductoSolID, tipo: 'EDICION',
    texto: `El cliente confirmó el pedido desde la tienda del portal: ${prendas} prenda(s)${prod.precio ? ` × ${prod.moneda === 'USD' ? 'US$' : '$'} ${prod.precio}` : ''}.`
      + `${r?.tizada ? ` TIZADA PRO: ${r.tizada.Estado}${r.tizada.mensaje ? ` (${r.tizada.mensaje})` : ''}.` : ''}`
      + `${aparte.length ? ` Se cobra aparte (sumarlo al precio): ${aparte.join(', ')}.` : ''}`,
  });
  logger.info(`[PORTAL-PEDIDO] SOL-${s.SolicitudID} confirmado por el cliente ${s.cli.codCliente}: TIZADA ${r?.tizada?.Estado || '—'}`);
  return { ok: true, tizada: r?.tizada || null };
}

// ─────────────────────────────────────────────────────────────────────
// Barrido: lo del portal que ya volvió de TIZADA (y del DTF, si fue a Diseño) se convierte solo en pedido
// ─────────────────────────────────────────────────────────────────────
const ultimoError = new Map();   // SolicitudID → { fecha, mensaje }: lo que falla no se reintenta cada minuto
const convirtiendo = new Set();
async function convertirListos(pool) {
  try { await exigirColumnas(pool); } catch (_) { return; }
  const r = await pool.request().query(`
    SELECT s.SolicitudID, s.VendedorID, s.CodCliente, p.ProductoSolID, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre
    FROM dbo.SolicitudesVendedor s
    JOIN dbo.SolicitudesVendedorProductos p ON p.SolicitudID = s.SolicitudID AND p.Activo = 1 AND p.PedidoNoDocERP IS NULL
    LEFT JOIN dbo.Clientes c ON c.CodCliente = s.CodCliente
    WHERE s.Origen = 'PORTAL' AND s.PortalConfirmado IS NOT NULL AND s.Estado IN ('INGRESADA', 'EN_DISENO')
      AND NOT EXISTS (SELECT 1 FROM dbo.SolicitudesVendedorPartes pa WHERE pa.ProductoSolID = p.ProductoSolID AND pa.Activo = 1
                      AND ((pa.Tipo IN ('PRINCIPAL', 'DTF') AND pa.Estado <> 'DISENADO') OR pa.Modificada = 1))`);
  for (const f of r.recordset) {
    const err = ultimoError.get(f.SolicitudID);
    if ((err && Date.now() - err.fecha < 10 * 60 * 1000) || convirtiendo.has(f.SolicitudID)) continue;
    convirtiendo.add(f.SolicitudID);
    const user = usuarioPortal(f.VendedorID, { nombre: f.ClienteNombre || `Cliente ${f.CodCliente}`, codCliente: f.CodCliente });
    try {
      const res = await svc.convertir(pool, user, f.SolicitudID, f.ProductoSolID, {}, appRef);
      ultimoError.delete(f.SolicitudID);
      logger.info(`[PORTAL-PEDIDO] SOL-${f.SolicitudID} → pedido ${res.noDocERP} (${(res.codigosOrden || []).join(', ')}) armado solo`);
    } catch (e) {
      const nuevo = !err || err.mensaje !== e.message;
      ultimoError.set(f.SolicitudID, { fecha: Date.now(), mensaje: e.message });
      logger.warn(`[PORTAL-PEDIDO] SOL-${f.SolicitudID}: no se pudo armar el pedido solo: ${e.message}`);
      if (nuevo) {
        await svc.agregarInteraccion(pool, user, f.SolicitudID, { Texto: `El pedido del portal no se pudo armar solo (se arma desde esta solicitud con "Convertir"): ${e.message}` }).catch(() => { });
      }
    } finally { convirtiendo.delete(f.SolicitudID); }
  }
}
let timer = null;
function iniciarBarrido(getPool) {
  if (timer || process.env.PORTAL_PEDIDOS_BARRIDO === '0') return;
  const seg = Math.max(30, parseInt(process.env.PORTAL_PEDIDOS_BARRIDO_SEGUNDOS, 10) || 60);
  timer = setInterval(async () => {
    try { await convertirListos(await getPool()); } catch (e) { logger.warn(`[PORTAL-PEDIDO] barrido: ${e.message}`); }
  }, seg * 1000);
  if (timer.unref) timer.unref();
}

module.exports = {
  esClientePortal, solicitudDelCliente, recordarApp, producto, extrasDelProducto, formasDeExtras, vendedorDe,
  armables, listar, crear, resumen, cambiarExtra, revisarArte, descartar, confirmar, convertirListos, iniciarBarrido,
  analisisDeArte,   // [A MEDIDA] también la pantalla del vendedor/diseñador (solicitudesVendedorTizadaPro.vistaArte)
};
