'use strict';
// =====================================================================
// Solicitudes de vendedores — specs/41-captacion-de-solicitudes-vendedores.md
// =====================================================================
// La Solicitud vive ANTES del pedido: acá no se crea ninguna orden de
// producción ni se toca el saldo de ningún cliente (INV-SOL.04). La seña es
// un dato. La conversión a pedido (spec §9) todavía no está construida:
// depende de la interfaz de ingreso de pedidos por sistema; acá solo existe
// validarConversion(), que dice qué falta (RN-SOL.27).
//
// Convención del módulo: el controller pasa `pool` y `req.user`; las reglas
// de negocio lanzan Error con `.status` (4xx) y el controller lo traduce.
// =====================================================================
const fs = require('fs');
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const { rollbackSeguro } = require('../utils/rollbackSeguro');

const ROLES_VENDEDOR = ['Admin', 'Administracion', 'Coordinador', 'Atención al Cliente', 'VENTAS'];
const TIPOS_PARTE = ['PRINCIPAL', 'BORDADO', 'DTF', 'TPU'];
const TIPOS_ADICIONAL = ['BORDADO', 'DTF', 'TPU'];
const ROLES_ARCHIVO = ['ARTE_CLIENTE', 'REFERENCIA', 'BOCETO', 'PLANILLA', 'TIZADA', 'DISENO_PRONTO', 'COMPROBANTE'];   // COMPROBANTE = comprobante de pago de la seña (informativo)
const NOMBRE_PARTE = { PRINCIPAL: 'Producción principal (sublimación)', BORDADO: 'Bordado', DTF: 'Estampado DTF', TPU: 'Estampado TPU' };
const NOMBRE_ESTADO_PARTE = { INGRESADO: 'Ingresado', ENVIADO_DISENO: 'Enviado a diseño', DISENO_INICIADO: 'Diseño iniciado', DISENADO: 'Diseñado' };

// Formatos del archivo de diseño pronto: los mismos que acepta el ingreso de
// pedidos de prenda (sublimación PNG/JPEG/PDF; DTF y TPU PNG/PDF). Bordado
// acepta cualquier formato (ponchados).
const FORMATOS_DISENO = {
  PRINCIPAL: { ext: ['png', 'jpg', 'jpeg', 'pdf'], txt: 'PNG, JPEG o PDF' },
  DTF: { ext: ['png', 'pdf'], txt: 'PNG o PDF' },
  TPU: { ext: ['png', 'pdf'], txt: 'PNG o PDF' },
};

const fallo = (status, mensaje) => { const e = new Error(mensaje); e.status = status; return e; };

// Las columnas de la ficha de ingreso (FichaJson / FechaEntrega / FechaEntregaHasta) las agrega
// scripts/add_conversion_solicitud_pedido.sql. Si todavía no corrió, el módulo sigue funcionando
// sin ellas (la ficha no se guarda y se avisa en el log) en vez de romper la pantalla.
let _tieneFicha = null;
async function tieneFicha(pool) {
  if (_tieneFicha === null) {
    const r = await pool.request().query("SELECT COUNT(*) AS n FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SolicitudesVendedor') AND name = 'FichaJson'");
    _tieneFicha = r.recordset[0].n > 0;
    if (!_tieneFicha) logger.warn('[SOLICITUDES] Falta correr scripts/add_conversion_solicitud_pedido.sql: la ficha de ingreso (muestra, plazo, fecha de entrega, indicaciones) NO se guarda hasta entonces.');
  }
  return _tieneFicha;
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const txt = (v, max) => { const s = String(v ?? '').trim(); return s ? (max ? s.substring(0, max) : s) : null; };
const entero = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const decimal = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
// Claves ordenadas: el mismo dato da siempre el mismo texto, así la edición no ve "cambios" que no existen.
const ordenar = (o) => (Array.isArray(o) ? o.map(ordenar) : (o && typeof o === 'object' ? Object.keys(o).sort().reduce((a, k) => { a[k] = ordenar(o[k]); return a; }, {}) : o));
const jsonTxt = (o) => (o && typeof o === 'object' && Object.keys(o).length ? JSON.stringify(ordenar(o)) : null);
const jsonObj = (s) => { try { return s ? JSON.parse(s) : {}; } catch (_) { return {}; } };

const esAdmin = (user) => parseInt(user?.idRol, 10) === 1 || norm(user?.role) === 'admin';
const esVendedor = (user) => esAdmin(user) || ROLES_VENDEDOR.map(norm).includes(norm(user?.role));

// Diseñador = rol de login "Diseñador" (lo crea scripts/add_solicitudes_vendedor.sql), o Admin, o alguien
// con otro rol habilitado como excepción en SolicitudesVendedorDisenadores.
async function esDisenador(pool, user) {
  if (esAdmin(user) || norm(user?.role) === 'disenador') return true;
  const r = await pool.request().input('U', sql.Int, user.id)
    .query('SELECT 1 AS ok FROM dbo.SolicitudesVendedorDisenadores WHERE IdUsuario = @U AND Activo = 1');
  return r.recordset.length > 0;
}

const exigirVendedor = (user) => { if (!esVendedor(user)) throw fallo(403, 'Esta acción es solo para vendedores.'); };

// ---------------------------------------------------------------------
// Historial (INV-SOL.02: solo se inserta; no hay UPDATE ni DELETE en el módulo)
// ---------------------------------------------------------------------
async function registrarEvento(cx, user, ev) {
  const r = await new sql.Request(cx)
    .input('Sol', sql.Int, ev.solicitudId)
    .input('Prod', sql.Int, ev.productoSolId || null)
    .input('Parte', sql.Int, ev.parteId || null)
    .input('Tipo', sql.VarChar(24), ev.tipo)
    .input('Ant', sql.VarChar(20), ev.estadoAnterior || null)
    .input('Nue', sql.VarChar(20), ev.estadoNuevo || null)
    .input('Texto', sql.NVarChar(sql.MAX), ev.texto || null)
    .input('U', sql.Int, user.id)
    .input('UN', sql.NVarChar(120), txt(user.name || user.username, 120))
    .query(`INSERT INTO dbo.SolicitudesVendedorEventos
              (SolicitudID, ProductoSolID, ParteID, Tipo, EstadoAnterior, EstadoNuevo, Texto, UsuarioID, UsuarioNombre)
            OUTPUT INSERTED.EventoID
            VALUES (@Sol, @Prod, @Parte, @Tipo, @Ant, @Nue, @Texto, @U, @UN)`);
  return r.recordset[0].EventoID;
}

// Ingresada / En diseño / Pedido solicitado se DERIVAN (RN-SOL.24).
async function recalcularEstado(cx, user, solicitudId) {
  const r = await new sql.Request(cx).input('Sol', sql.Int, solicitudId).query(`
    SELECT s.Estado,
      (SELECT COUNT(*) FROM dbo.SolicitudesVendedorProductos p WHERE p.SolicitudID = s.SolicitudID AND p.Activo = 1) AS Productos,
      (SELECT COUNT(*) FROM dbo.SolicitudesVendedorProductos p WHERE p.SolicitudID = s.SolicitudID AND p.Activo = 1 AND p.PedidoNoDocERP IS NOT NULL) AS Convertidos,
      (SELECT COUNT(*) FROM dbo.SolicitudesVendedorPartes pa
         JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID AND p.Activo = 1
        WHERE pa.SolicitudID = s.SolicitudID AND pa.Activo = 1 AND pa.Estado <> 'INGRESADO') AS PartesEnDiseno
    FROM dbo.SolicitudesVendedor s WHERE s.SolicitudID = @Sol`);
  const f = r.recordset[0];
  if (!f || f.Estado === 'CANCELADA') return f?.Estado;
  let nuevo = 'INGRESADA';
  if (f.Productos > 0 && f.Convertidos === f.Productos) nuevo = 'PEDIDO_SOLICITADO';
  else if (f.PartesEnDiseno > 0 || f.Convertidos > 0) nuevo = 'EN_DISENO';
  if (nuevo !== f.Estado) {
    await new sql.Request(cx).input('Sol', sql.Int, solicitudId).input('E', sql.VarChar(20), nuevo)
      .query('UPDATE dbo.SolicitudesVendedor SET Estado = @E WHERE SolicitudID = @Sol');
    await registrarEvento(cx, user, { solicitudId, tipo: 'ESTADO_SOLICITUD', estadoAnterior: f.Estado, estadoNuevo: nuevo });
  }
  return nuevo;
}

async function cabecera(cx, solicitudId) {
  const r = await new sql.Request(cx).input('Sol', sql.Int, solicitudId)
    .query('SELECT * FROM dbo.SolicitudesVendedor WHERE SolicitudID = @Sol');
  if (!r.recordset.length) throw fallo(404, 'La solicitud no existe.');
  return r.recordset[0];
}

function exigirAbierta(sol) {
  if (sol.Estado === 'CANCELADA') throw fallo(409, 'La solicitud está cancelada: no admite cambios.');
  if (sol.Estado === 'PEDIDO_SOLICITADO') throw fallo(409, 'La solicitud ya se convirtió en pedido: no admite cambios.');
}

// ---------------------------------------------------------------------
// Validación de lo que llega del formulario
// ---------------------------------------------------------------------
function limpiarParte(p) {
  const tipo = String(p?.Tipo || '').toUpperCase();
  if (!TIPOS_PARTE.includes(tipo)) throw fallo(400, `Tipo de servicio desconocido: "${p?.Tipo}".`);
  const arte = p.ArteOrigen ? String(p.ArteOrigen).toUpperCase() : null;
  if (arte && !['CLIENTE', 'EMPRESA'].includes(arte)) throw fallo(400, 'Quién diseña debe ser "Cliente" o "Empresa".');
  return {
    ParteID: entero(p.ParteID),
    Tipo: tipo,
    IncluidoEnProducto: p.IncluidoEnProducto ? 1 : 0,
    CantidadTotal: entero(p.CantidadTotal),
    PorPrenda: entero(p.PorPrenda),
    Ubicacion: txt(p.Ubicacion, 300),
    ArteOrigen: arte,
    DatosJson: jsonTxt(p.Datos),
    Observaciones: txt(p.Observaciones),
  };
}

function limpiarProducto(p, i) {
  const n = i + 1;
  const tipo = String(p?.TipoFabricacion || '').toUpperCase();
  if (!['PRODUCTO_TERMINADO', 'PERSONALIZADO'].includes(tipo)) throw fallo(400, `Producto ${n}: elegí el tipo de fabricación.`);
  const proId = entero(p.ProIdProducto);
  if (tipo === 'PRODUCTO_TERMINADO' && !proId) throw fallo(400, `Producto ${n}: elegí el producto terminado del catálogo.`);
  const cant = entero(p.Cantidad);
  if (!cant || cant <= 0) throw fallo(400, `Producto ${n}: ingresá la cantidad de prendas.`);
  const partes = (Array.isArray(p.Partes) ? p.Partes : []).map(limpiarParte);
  const vistos = new Set();
  for (const pa of partes) {
    if (vistos.has(pa.Tipo)) throw fallo(400, `Producto ${n}: "${NOMBRE_PARTE[pa.Tipo]}" está cargado dos veces.`);
    vistos.add(pa.Tipo);
  }
  // La producción principal existe siempre: su arte siempre pasa por Diseño (RN-SOL.18b).
  if (!vistos.has('PRINCIPAL')) partes.unshift(limpiarParte({ Tipo: 'PRINCIPAL' }));
  return {
    ProductoSolID: entero(p.ProductoSolID),
    Orden: n,
    TipoFabricacion: tipo,
    ProIdProducto: tipo === 'PRODUCTO_TERMINADO' ? proId : null,
    ProductoNombre: txt(p.ProductoNombre, 200),
    Cantidad: cant,
    Observaciones: txt(p.Observaciones),
    DatosJson: jsonTxt(p.Datos),
    Partes: partes,
  };
}

function limpiarCabecera(b, user) {
  const codCliente = entero(b.CodCliente);
  if (!codCliente) throw fallo(400, 'Elegí el cliente de la solicitud.');
  const nombre = txt(b.NombreTrabajo, 200);
  if (!nombre) throw fallo(400, 'Ingresá el nombre del trabajo.');
  const detalle = txt(b.Detalle);
  if (!detalle) throw fallo(400, 'Escribí el detalle de la solicitud (qué pide el cliente).');
  const fecha = (v) => { const s = String(v || '').trim().slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
  const fi = (b.Ficha && typeof b.Ficha === 'object') ? b.Ficha : {};
  const mu = (fi.muestra && typeof fi.muestra === 'object') ? fi.muestra : {};
  if (fi.dondeSeCose && !['TALLER', 'EXTERNO'].includes(fi.dondeSeCose)) throw fallo(400, 'Dónde se cose: "Nuestro taller" o "Taller externo".');
  if (mu.respuesta && !['PIDIO', 'ACEPTO', 'RECHAZO'].includes(mu.respuesta)) throw fallo(400, 'La respuesta sobre la muestra no es válida.');
  // Ficha de ingreso a producción (checklist del taller). Se guarda como llegó, saneada.
  const Ficha = {
    dondeSeCose: fi.dondeSeCose || 'TALLER', tallerExterno: txt(fi.tallerExterno, 200),
    muestra: { ofrecida: !!mu.ofrecida, respuesta: mu.respuesta || '', aprobada: !!mu.aprobada },
    plazoOk: !!fi.plazoOk, indicaciones: txt(fi.indicaciones), sinIndicaciones: !!fi.sinIndicaciones, notasInternas: txt(fi.notasInternas),
    senaFecha: fecha(fi.senaFecha) || '',   // fecha de la transferencia de la seña (informativo)
  };
  return { CodCliente: codCliente, NombreTrabajo: nombre, Detalle: detalle, Observaciones: txt(b.Observaciones), VendedorID: user.id /* el vendedor es quien ingresa la solicitud: no se elige */, PreId: entero(b.PreId), PreNumero: null,
           FichaJson: jsonTxt(Ficha), FechaEntrega: fecha(b.FechaEntrega), FechaEntregaHasta: fecha(b.FechaEntregaHasta) };
}

// RN-SOL.05b: presupuesto del que salió la solicitud (opcional). La tabla Presupuestos la crea
// su propia pantalla al primer uso, así que puede no existir todavía.
async function resolverPresupuesto(cx, cab) {
  if (!cab.PreId) { cab.PreNumero = null; return; }
  const r = await new sql.Request(cx).input('Pre', sql.Int, cab.PreId).query(`
    IF OBJECT_ID('dbo.Presupuestos', 'U') IS NULL SELECT CAST(NULL AS varchar(20)) AS PreNumero, CAST(NULL AS varchar(15)) AS Estado WHERE 1 = 0;
    ELSE SELECT PreNumero, Estado FROM dbo.Presupuestos WHERE PreId = @Pre AND PreTipo = 'PRESUPUESTO';`);
  const pre = r.recordset[0];
  if (!pre) throw fallo(400, 'El presupuesto elegido no existe.');
  if (pre.Estado === 'ANULADO') throw fallo(400, `El presupuesto ${pre.PreNumero} está anulado: no se puede asociar.`);
  cab.PreNumero = String(pre.PreNumero).trim();
}

async function insertarProducto(cx, solicitudId, p) {
  const r = await new sql.Request(cx)
    .input('Sol', sql.Int, solicitudId).input('Ord', sql.Int, p.Orden)
    .input('Tipo', sql.VarChar(20), p.TipoFabricacion).input('Pro', sql.Int, p.ProIdProducto)
    .input('Nom', sql.NVarChar(200), p.ProductoNombre).input('Cant', sql.Int, p.Cantidad)
    .input('Obs', sql.NVarChar(sql.MAX), p.Observaciones).input('Dat', sql.NVarChar(sql.MAX), p.DatosJson)
    .query(`INSERT INTO dbo.SolicitudesVendedorProductos (SolicitudID, Orden, TipoFabricacion, ProIdProducto, ProductoNombre, Cantidad, Observaciones, DatosJson)
            OUTPUT INSERTED.ProductoSolID
            VALUES (@Sol, @Ord, @Tipo, @Pro, @Nom, @Cant, @Obs, @Dat)`);
  return r.recordset[0].ProductoSolID;
}

async function insertarParte(cx, solicitudId, productoSolId, pa) {
  const r = await new sql.Request(cx)
    .input('Sol', sql.Int, solicitudId).input('Prod', sql.Int, productoSolId)
    .input('Tipo', sql.VarChar(12), pa.Tipo).input('Incl', sql.Bit, pa.IncluidoEnProducto)
    .input('Cant', sql.Int, pa.CantidadTotal).input('PP', sql.Int, pa.PorPrenda)
    .input('Ubi', sql.NVarChar(300), pa.Ubicacion).input('Arte', sql.VarChar(10), pa.ArteOrigen)
    .input('Dat', sql.NVarChar(sql.MAX), pa.DatosJson).input('Obs', sql.NVarChar(sql.MAX), pa.Observaciones)
    .query(`INSERT INTO dbo.SolicitudesVendedorPartes (SolicitudID, ProductoSolID, Tipo, IncluidoEnProducto, CantidadTotal, PorPrenda, Ubicacion, ArteOrigen, DatosJson, Observaciones)
            OUTPUT INSERTED.ParteID
            VALUES (@Sol, @Prod, @Tipo, @Incl, @Cant, @PP, @Ubi, @Arte, @Dat, @Obs)`);
  return r.recordset[0].ParteID;
}

// ---------------------------------------------------------------------
// Alta (RN-SOL.05 / RN-SOL.07)
// ---------------------------------------------------------------------
async function crear(pool, user, body) {
  exigirVendedor(user);
  const cab = limpiarCabecera(body, user);
  const productos = (Array.isArray(body.Productos) ? body.Productos : []).map(limpiarProducto);
  if (!productos.length) throw fallo(400, 'Cargá al menos un producto solicitado.');
  if (new Set(productos.map(p => p.TipoFabricacion)).size > 1) throw fallo(400, 'Una solicitud es toda de productos del catálogo o toda de productos del cliente: no se pueden mezclar.');

  const cli = await pool.request().input('Cod', sql.Int, cab.CodCliente).query('SELECT 1 AS ok FROM dbo.Clientes WHERE CodCliente = @Cod');
  if (!cli.recordset.length) throw fallo(400, 'El cliente elegido no existe.');
  await resolverPresupuesto(pool, cab);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const conFicha = await tieneFicha(pool);
    const ins = await new sql.Request(transaction)
      .input('Cod', sql.Int, cab.CodCliente).input('Nom', sql.NVarChar(200), cab.NombreTrabajo)
      .input('Ven', sql.Int, cab.VendedorID).input('Det', sql.NVarChar(sql.MAX), cab.Detalle)
      .input('Obs', sql.NVarChar(sql.MAX), cab.Observaciones).input('U', sql.Int, user.id)
      .input('Pre', sql.Int, cab.PreId).input('PreNum', sql.VarChar(20), cab.PreNumero)
      .input('Fi', sql.NVarChar(sql.MAX), cab.FichaJson).input('FE', sql.Date, cab.FechaEntrega).input('FEH', sql.Date, cab.FechaEntregaHasta)
      .query(`INSERT INTO dbo.SolicitudesVendedor (CodCliente, NombreTrabajo, VendedorID, Detalle, Observaciones, PreId, PreNumero, UsuarioAlta${conFicha ? ', FichaJson, FechaEntrega, FechaEntregaHasta' : ''})
              OUTPUT INSERTED.SolicitudID
              VALUES (@Cod, @Nom, @Ven, @Det, @Obs, @Pre, @PreNum, @U${conFicha ? ', @Fi, @FE, @FEH' : ''})`);
    const solicitudId = ins.recordset[0].SolicitudID;
    for (const p of productos) {
      const pid = await insertarProducto(transaction, solicitudId, p);
      for (const pa of p.Partes) await insertarParte(transaction, solicitudId, pid, pa);
    }
    await registrarEvento(transaction, user, { solicitudId, tipo: 'ALTA', estadoNuevo: 'INGRESADA', texto: `Solicitud ingresada con ${productos.length} producto(s).` });
    await transaction.commit();
    return { SolicitudID: solicitudId };
  } catch (err) {
    await rollbackSeguro(transaction, 'solicitudesVendedor.crear');
    throw err;
  }
}

// ---------------------------------------------------------------------
// Edición (RN-SOL.20b / RN-SOL.20c): lo que cambia sobre una parte que ya
// está en Diseño la deja señalada como "Modificada", con el detalle.
// ---------------------------------------------------------------------
const CAMPOS_PARTE = [['CantidadTotal', 'Cantidad total'], ['PorPrenda', 'Por prenda'], ['Ubicacion', 'Ubicación'], ['ArteOrigen', 'Quién diseña'], ['DatosJson', 'Datos técnicos'], ['Observaciones', 'Observaciones']];
const CAMPOS_PRODUCTO = [['TipoFabricacion', 'Tipo de fabricación'], ['ProIdProducto', 'Producto'], ['Cantidad', 'Cantidad de prendas'], ['DatosJson', 'Corte / costura'], ['Observaciones', 'Observaciones del producto']];
const ver = (v) => (v === null || v === undefined || v === '' ? '(vacío)' : String(v));
const diferencias = (campos, antes, ahora) => campos
  .filter(([k]) => ver(antes[k]) !== ver(ahora[k]))
  .map(([k, etiqueta]) => (k === 'DatosJson' ? `${etiqueta}: cambiaron` : `${etiqueta}: ${ver(antes[k])} → ${ver(ahora[k])}`));

async function marcarModificada(cx, user, parteId, detalle) {
  await new sql.Request(cx).input('P', sql.Int, parteId).input('Det', sql.NVarChar(sql.MAX), detalle).input('U', sql.Int, user.id)
    .query(`UPDATE dbo.SolicitudesVendedorPartes
               SET Modificada = 1,
                   ModificadaDetalle = CASE WHEN Modificada = 1 AND ModificadaDetalle IS NOT NULL THEN ModificadaDetalle + CHAR(10) + @Det ELSE @Det END,
                   ModificadaPor = @U, ModificadaFecha = GETDATE()
             WHERE ParteID = @P`);
}

async function actualizar(pool, user, solicitudId, body) {
  exigirVendedor(user);
  const cab = limpiarCabecera(body, user);
  const productos = (Array.isArray(body.Productos) ? body.Productos : []).map(limpiarProducto);
  if (!productos.length) throw fallo(400, 'La solicitud debe tener al menos un producto.');

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const sol = await cabecera(transaction, solicitudId);
    exigirAbierta(sol);
    cab.VendedorID = sol.VendedorID;   // el vendedor no se cambia al editar: queda el que la ingresó
    await resolverPresupuesto(transaction, cab);

    const prodsBD = (await new sql.Request(transaction).input('Sol', sql.Int, solicitudId)
      .query('SELECT * FROM dbo.SolicitudesVendedorProductos WHERE SolicitudID = @Sol AND Activo = 1')).recordset;
    const partesBD = (await new sql.Request(transaction).input('Sol', sql.Int, solicitudId)
      .query('SELECT * FROM dbo.SolicitudesVendedorPartes WHERE SolicitudID = @Sol AND Activo = 1')).recordset;
    const cambios = [];

    // Cabecera
    const fechaBD = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
    const solCmp = { ...sol, FechaEntrega: fechaBD(sol.FechaEntrega), FechaEntregaHasta: fechaBD(sol.FechaEntregaHasta) };
    const difCab = diferencias([['CodCliente', 'Cliente'], ['NombreTrabajo', 'Nombre del trabajo'], ['VendedorID', 'Vendedor'], ['Detalle', 'Detalle'], ['Observaciones', 'Observaciones'], ['PreNumero', 'Presupuesto asociado'],
                                ['FichaJson', 'Ficha de ingreso (muestra, plazo, indicaciones, dónde se cose)'], ['FechaEntrega', 'Fecha de entrega'], ['FechaEntregaHasta', 'Fecha de entrega (hasta)']], solCmp, cab);
    if (difCab.length) {
      await new sql.Request(transaction)
        .input('Sol', sql.Int, solicitudId).input('Cod', sql.Int, cab.CodCliente).input('Nom', sql.NVarChar(200), cab.NombreTrabajo)
        .input('Ven', sql.Int, cab.VendedorID).input('Det', sql.NVarChar(sql.MAX), cab.Detalle)
        .input('Obs', sql.NVarChar(sql.MAX), cab.Observaciones).input('U', sql.Int, user.id)
        .input('Pre', sql.Int, cab.PreId).input('PreNum', sql.VarChar(20), cab.PreNumero)
        .input('Fi', sql.NVarChar(sql.MAX), cab.FichaJson).input('FE', sql.Date, cab.FechaEntrega).input('FEH', sql.Date, cab.FechaEntregaHasta)
        .query(`UPDATE dbo.SolicitudesVendedor SET CodCliente = @Cod, NombreTrabajo = @Nom, VendedorID = @Ven, Detalle = @Det,
                       Observaciones = @Obs, PreId = @Pre, PreNumero = @PreNum, ${(await tieneFicha(pool)) ? 'FichaJson = @Fi, FechaEntrega = @FE, FechaEntregaHasta = @FEH,' : ''}
                       UsuarioModif = @U, FechaModif = GETDATE() WHERE SolicitudID = @Sol`);
      cambios.push(...difCab);
    }

    const idsProdRecibidos = new Set();
    for (const p of productos) {
      const antes = p.ProductoSolID ? prodsBD.find(x => x.ProductoSolID === p.ProductoSolID) : null;
      if (p.ProductoSolID && !antes) throw fallo(400, `El producto ${p.Orden} no pertenece a esta solicitud.`);
      let pid = p.ProductoSolID;

      if (!antes) {
        pid = await insertarProducto(transaction, solicitudId, p);
        for (const pa of p.Partes) await insertarParte(transaction, solicitudId, pid, pa);
        cambios.push(`Producto ${p.Orden} agregado.`);
        idsProdRecibidos.add(pid);
        continue;
      }
      idsProdRecibidos.add(pid);
      const difProd = diferencias(CAMPOS_PRODUCTO, antes, p);
      if (antes.PedidoNoDocERP) {
        // Ya convertido: no se edita desde la Solicitud (RN-SOL.20c)
        if (difProd.length) throw fallo(409, `El producto ${p.Orden} ya se convirtió en pedido: no se puede editar desde la solicitud.`);
        continue;
      }
      if (difProd.length || antes.Orden !== p.Orden) {
        await new sql.Request(transaction)
          .input('Id', sql.Int, pid).input('Ord', sql.Int, p.Orden).input('Tipo', sql.VarChar(20), p.TipoFabricacion)
          .input('Pro', sql.Int, p.ProIdProducto).input('Nom', sql.NVarChar(200), p.ProductoNombre).input('Cant', sql.Int, p.Cantidad)
          .input('Obs', sql.NVarChar(sql.MAX), p.Observaciones).input('Dat', sql.NVarChar(sql.MAX), p.DatosJson)
          .query(`UPDATE dbo.SolicitudesVendedorProductos SET Orden = @Ord, TipoFabricacion = @Tipo, ProIdProducto = @Pro, ProductoNombre = @Nom,
                         Cantidad = @Cant, Observaciones = @Obs, DatosJson = @Dat WHERE ProductoSolID = @Id`);
      }
      if (difProd.length) cambios.push(`Producto ${p.Orden}: ${difProd.join('; ')}`);

      const partesAntes = partesBD.filter(x => x.ProductoSolID === pid);
      const tiposRecibidos = new Set();
      for (const pa of p.Partes) {
        tiposRecibidos.add(pa.Tipo);
        const paAntes = partesAntes.find(x => x.Tipo === pa.Tipo);
        if (!paAntes) {
          await insertarParte(transaction, solicitudId, pid, pa);
          cambios.push(`Producto ${p.Orden}: se agregó ${NOMBRE_PARTE[pa.Tipo]}.`);
          continue;
        }
        const difParte = diferencias(CAMPOS_PARTE, paAntes, pa);
        if (difParte.length) {
          await new sql.Request(transaction)
            .input('Id', sql.Int, paAntes.ParteID).input('Cant', sql.Int, pa.CantidadTotal).input('PP', sql.Int, pa.PorPrenda)
            .input('Ubi', sql.NVarChar(300), pa.Ubicacion).input('Arte', sql.VarChar(10), pa.ArteOrigen)
            .input('Dat', sql.NVarChar(sql.MAX), pa.DatosJson).input('Obs', sql.NVarChar(sql.MAX), pa.Observaciones)
            .query(`UPDATE dbo.SolicitudesVendedorPartes SET CantidadTotal = @Cant, PorPrenda = @PP, Ubicacion = @Ubi, ArteOrigen = @Arte,
                           DatosJson = @Dat, Observaciones = @Obs WHERE ParteID = @Id`);
          cambios.push(`Producto ${p.Orden} · ${NOMBRE_PARTE[pa.Tipo]}: ${difParte.join('; ')}`);
        }
        // Señal para Diseño: cambió la parte o cambió su producto
        const detalle = [...difParte, ...difProd.map(d => `Producto: ${d}`)];
        // Sin diseñador y ya "Diseñado" = el vendedor adjuntó el arte listo del cliente, sin pasar por Diseño:
        // no hay a quién avisarle, así que no se marca (si no, el cambio quedaba sin nadie que lo pudiera aceptar).
        const sinPasarPorDiseno = paAntes.Estado === 'DISENADO' && !paAntes.DisenadorID;
        if (detalle.length && paAntes.Estado !== 'INGRESADO' && !sinPasarPorDiseno) {
          await marcarModificada(transaction, user, paAntes.ParteID, detalle.join('; '));
        }
      }
      // Servicios quitados
      for (const paAntes of partesAntes.filter(x => !tiposRecibidos.has(x.Tipo))) {
        if (paAntes.Tipo === 'PRINCIPAL') continue;
        if (paAntes.IncluidoEnProducto && p.ProIdProducto === antes.ProIdProducto) {
          throw fallo(409, `${NOMBRE_PARTE[paAntes.Tipo]} viene incluido en el producto elegido: no se puede quitar.`);
        }
        await new sql.Request(transaction).input('Id', sql.Int, paAntes.ParteID)
          .query('UPDATE dbo.SolicitudesVendedorPartes SET Activo = 0 WHERE ParteID = @Id');
        cambios.push(`Producto ${p.Orden}: se quitó ${NOMBRE_PARTE[paAntes.Tipo]}${paAntes.Estado !== 'INGRESADO' ? ' (estaba en Diseño: sale de la bandeja)' : ''}.`);
      }
    }

    // Productos quitados
    for (const antes of prodsBD.filter(x => !idsProdRecibidos.has(x.ProductoSolID))) {
      if (antes.PedidoNoDocERP) throw fallo(409, 'No se puede quitar un producto que ya se convirtió en pedido.');
      await new sql.Request(transaction).input('Id', sql.Int, antes.ProductoSolID).query(`
        UPDATE dbo.SolicitudesVendedorProductos SET Activo = 0 WHERE ProductoSolID = @Id;
        UPDATE dbo.SolicitudesVendedorPartes    SET Activo = 0 WHERE ProductoSolID = @Id;`);
      cambios.push(`Se quitó el producto "${antes.ProductoNombre || 'personalizado'}" (${antes.Cantidad} prendas).`);
    }

    if (cambios.length) {
      await registrarEvento(transaction, user, { solicitudId, tipo: 'EDICION', texto: cambios.join('\n') });
      await recalcularEstado(transaction, user, solicitudId);
    }
    await transaction.commit();
    return { SolicitudID: solicitudId, cambios: cambios.length };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.actualizar ${solicitudId}`);
    throw err;
  }
}

// ---------------------------------------------------------------------
// Precio pactado y seña (spec §5). La Solicitud NUNCA toca el saldo.
// ---------------------------------------------------------------------
async function guardarPrecio(pool, user, solicitudId, b) {
  exigirVendedor(user);
  const modo = b.ModoCobro ? String(b.ModoCobro).toUpperCase() : null;
  if (!['PRECIO_ESTABLECIDO', 'POR_AREA'].includes(modo)) throw fallo(400, 'Elegí cómo se cobra: "Precio establecido" o "Facturar por cada área".');
  const precio = decimal(b.PrecioPactado);
  const moneda = entero(b.MonIdMoneda);
  if (modo === 'PRECIO_ESTABLECIDO') {
    if (!precio || precio <= 0) throw fallo(400, 'Ingresá el precio pactado de la solicitud.');
    if (![1, 2].includes(moneda)) throw fallo(400, 'Elegí la moneda del precio pactado.');
  }
  const requiere = b.RequiereSena ? 1 : 0;
  const senaReq = decimal(b.SenaMontoRequerido);
  if (requiere && (!senaReq || senaReq <= 0)) throw fallo(400, 'Indicá de cuánto es la seña requerida.');
  if (requiere && ![1, 2].includes(moneda)) throw fallo(400, 'Elegí la moneda de la seña.');

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const sol = await cabecera(transaction, solicitudId);
    exigirAbierta(sol);
    await new sql.Request(transaction)
      .input('Sol', sql.Int, solicitudId).input('Modo', sql.VarChar(20), modo)
      .input('Precio', sql.Decimal(18, 2), modo === 'PRECIO_ESTABLECIDO' ? precio : null)
      .input('Mon', sql.Int, moneda || null).input('Req', sql.Bit, requiere)
      .input('SenaReq', sql.Decimal(18, 2), requiere ? senaReq : null).input('U', sql.Int, user.id)
      .query(`UPDATE dbo.SolicitudesVendedor SET ModoCobro = @Modo, PrecioPactado = @Precio, MonIdMoneda = @Mon,
                     RequiereSena = @Req, SenaMontoRequerido = @SenaReq, UsuarioModif = @U, FechaModif = GETDATE()
               WHERE SolicitudID = @Sol`);
    const simb = moneda === 2 ? 'US$' : '$';
    const partes = [modo === 'PRECIO_ESTABLECIDO' ? `Precio establecido: ${simb} ${precio.toFixed(2)}` : 'Se factura por cada área',
      requiere ? `Requiere seña de ${simb} ${senaReq.toFixed(2)}` : 'No requiere seña'];
    await registrarEvento(transaction, user, { solicitudId, tipo: 'PRECIO', texto: partes.join(' · ') });
    await transaction.commit();
    return { ok: true };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.guardarPrecio ${solicitudId}`);
    throw err;
  }
}

async function confirmarSena(pool, user, solicitudId, b) {
  exigirVendedor(user);   // RN-SOL.17: la confirma el vendedor
  const via = txt(b.SenaVia, 60);
  const monto = decimal(b.SenaMonto);
  const ref = txt(b.SenaReferencia, 120);
  const fechaT = /^\d{4}-\d{2}-\d{2}$/.test(String(b.SenaFecha || '').slice(0, 10)) ? String(b.SenaFecha).slice(0, 10) : null;   // opcional, solo para el historial
  if (!via) throw fallo(400, 'Indicá la vía de entrada del dinero.');
  if (!monto || monto <= 0) throw fallo(400, 'Indicá el monto de la seña.');
  if (!ref) throw fallo(400, 'Indicá la referencia del pago.');

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const sol = await cabecera(transaction, solicitudId);
    exigirAbierta(sol);
    if (!sol.RequiereSena) throw fallo(409, 'Esta solicitud no requiere seña.');
    await new sql.Request(transaction)
      .input('Sol', sql.Int, solicitudId).input('Via', sql.NVarChar(60), via).input('Monto', sql.Decimal(18, 2), monto)
      .input('Ref', sql.NVarChar(120), ref).input('U', sql.Int, user.id)
      .query(`UPDATE dbo.SolicitudesVendedor SET SenaConfirmada = 1, SenaVia = @Via, SenaMonto = @Monto, SenaReferencia = @Ref,
                     SenaConfirmadaPor = @U, SenaFechaConfirma = GETDATE() WHERE SolicitudID = @Sol`);
    await registrarEvento(transaction, user, {
      solicitudId, tipo: 'SENA',
      texto: `${sol.SenaConfirmada ? 'Seña corregida' : 'Seña confirmada'}: ${monto.toFixed(2)} por ${via}${fechaT ? `, transferencia del ${fechaT.split('-').reverse().join('/')}` : ''}, referencia ${ref}. (Dato de la solicitud: el saldo lo ingresan Administración y Caja.)`,
    });
    await transaction.commit();
    return { ok: true };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.confirmarSena ${solicitudId}`);
    throw err;
  }
}

// ---------------------------------------------------------------------
// Interacciones (RN-SOL.03)
// ---------------------------------------------------------------------
async function agregarInteraccion(pool, user, solicitudId, b) {
  const texto = txt(b.Texto);
  if (!texto) throw fallo(400, 'Escribí el texto de la interacción.');
  await cabecera(pool, solicitudId);
  const eventoId = await registrarEvento(pool, user, { solicitudId, tipo: 'INTERACCION', texto });
  return { EventoID: eventoId };
}

// ---------------------------------------------------------------------
// Diseño: enviar, bandeja común, tomar, aceptar cambio (spec §6)
// ---------------------------------------------------------------------
// [CORREGIR EL DISEÑO 15/10] Producto ya convertido en pedido con una corrección abierta (solicitudesVendedorCorreccion):
// Diseño vuelve a trabajar SU arte, su lista, su tizada y sus diseños prontos (principal y DTF). Los candados de
// "ya es pedido" dejan pasar solo eso mientras la corrección está abierta.
async function enCorreccion(cx, productoSolId) {
  if (!productoSolId) return false;
  const r = await new sql.Request(cx).input('P', sql.Int, productoSolId).query(`
    SELECT CASE WHEN ISJSON(DatosJson) = 1 THEN JSON_VALUE(DatosJson, '$.correccion.activa') END AS A
    FROM dbo.SolicitudesVendedorProductos WHERE ProductoSolID = @P AND PedidoNoDocERP IS NOT NULL`);
  return r.recordset[0]?.A === 'true';
}

// opts.permitirCorreccion: la principal o el DTF de un producto en corrección no se frenan por "ya es pedido" (pa.EnCorreccion)
async function parteConContexto(cx, parteId, opts = {}) {
  const r = await new sql.Request(cx).input('P', sql.Int, parteId).query(`
    SELECT pa.*, s.Estado AS SolEstado, p.PedidoNoDocERP, p.Activo AS ProdActivo
    FROM dbo.SolicitudesVendedorPartes pa
    JOIN dbo.SolicitudesVendedor s          ON s.SolicitudID = pa.SolicitudID
    JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID
    WHERE pa.ParteID = @P`);
  const pa = r.recordset[0];
  if (!pa || !pa.Activo || !pa.ProdActivo) throw fallo(404, 'El servicio no existe o fue quitado de la solicitud.');
  if (pa.SolEstado === 'CANCELADA') throw fallo(409, 'La solicitud está cancelada.');
  if (pa.PedidoNoDocERP) {
    if (opts.permitirCorreccion && ['PRINCIPAL', 'DTF'].includes(pa.Tipo) && await enCorreccion(cx, pa.ProductoSolID)) pa.EnCorreccion = true;
    else throw fallo(409, 'Este producto ya se convirtió en pedido.');
  }
  return pa;
}

async function cambiarEstadoParte(cx, user, pa, nuevo, sets, texto) {
  await new sql.Request(cx).input('P', sql.Int, pa.ParteID).input('E', sql.VarChar(16), nuevo).input('U', sql.Int, user.id)
    .query(`UPDATE dbo.SolicitudesVendedorPartes SET Estado = @E${sets ? ', ' + sets : ''} WHERE ParteID = @P`);
  await registrarEvento(cx, user, {
    solicitudId: pa.SolicitudID, productoSolId: pa.ProductoSolID, parteId: pa.ParteID, tipo: 'ESTADO_PARTE',
    estadoAnterior: pa.Estado, estadoNuevo: nuevo, texto: `${NOMBRE_PARTE[pa.Tipo]}: ${NOMBRE_ESTADO_PARTE[nuevo]}${texto ? ' — ' + texto : ''}`,
  });
  await recalcularEstado(cx, user, pa.SolicitudID);
}

async function enviarADiseno(pool, user, parteId, b) {
  exigirVendedor(user);
  const tipoTrabajo = String(b.TipoTrabajo || '').toUpperCase();
  if (!['REVISAR', 'DESDE_CERO'].includes(tipoTrabajo)) throw fallo(400, 'Elegí el tipo de trabajo: "Revisar" o "Diseñar desde cero".');
  // TIZADA PRO: con molde de TIZADA, la principal solo sale a Diseño si TIZADA acepta los datos y el arte pasa la
  // revisión de letras (fuera de la transacción: llama a TIZADA y deja registrada la revisión).
  await require('./solicitudesVendedorTizadaPro').validarParaDiseno(pool, user, baseTizadaPro(), parteId);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const pa = await parteConContexto(transaction, parteId);
    if (pa.Estado !== 'INGRESADO') throw fallo(409, `${NOMBRE_PARTE[pa.Tipo]} ya está en Diseño (${NOMBRE_ESTADO_PARTE[pa.Estado]}).`);
    // Producto del catálogo con molde: la producción principal no sale a Diseño sin modelo + tela por pieza
    if (pa.Tipo === 'PRINCIPAL') {
      const falta = await require('./solicitudesVendedorSublimacion').faltaSublimacion(transaction, pa.ProductoSolID);
      if (falta) throw fallo(409, falta);
    }
    // [15/10] Con molde de TIZADA PRO, el arte de bordado / DTF / TPU sale del arte del producto (sus objetos) o se sube
    // aparte: sin ningún archivo de arte, el servicio no sale a Diseño (llegaría vacío a la bandeja).
    if (['BORDADO', 'DTF', 'TPU'].includes(pa.Tipo)) {
      const r = await new sql.Request(transaction).input('P', sql.Int, pa.ProductoSolID).input('Pa', sql.Int, parteId).query(`
        SELECT CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL THEN NULL
                    ELSE (SELECT NULLIF(LTRIM(RTRIM(vc.TizadaProMoldeRef)), '') FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS MoldeRef,
               (SELECT COUNT(*) FROM dbo.SolicitudesVendedorArchivos a WHERE a.ParteID = @Pa AND a.Rol = 'ARTE_CLIENTE' AND a.Vigente = 1) AS Artes
        FROM dbo.SolicitudesVendedorProductos p WHERE p.ProductoSolID = @P`);
      const x = r.recordset[0];
      if (x?.MoldeRef && !(x.Artes > 0)) {
        throw fallo(409, `${NOMBRE_PARTE[pa.Tipo]} todavía no tiene arte: subí el arte del producto y elegí qué objetos van en ${NOMBRE_PARTE[pa.Tipo].toLowerCase()} (o subí su archivo aparte en la tabla del arte).`);
      }
    }
    await new sql.Request(transaction).input('P', sql.Int, parteId).input('TT', sql.VarChar(12), tipoTrabajo)
      .query('UPDATE dbo.SolicitudesVendedorPartes SET TipoTrabajo = @TT, FechaEnvioDiseno = GETDATE() WHERE ParteID = @P');
    await cambiarEstadoParte(transaction, user, pa, 'ENVIADO_DISENO', 'UsuarioEnvioDiseno = @U',
      tipoTrabajo === 'REVISAR' ? 'para revisar el arte del cliente' : 'para diseñar desde cero');
    await transaction.commit();
    // TIZADA PRO: con el tilde "Generar la tizada en TIZADA PRO" (b.Tizada = true) la principal sale a TIZADA ya, y se
    // devuelve cómo salió (si falla, el envío a Diseño ya quedó hecho). Sin tilde (b.Tizada = false) no sale. Sin el dato
    // (pantallas viejas): como antes, sale sola solo con TIZADAPRO_ENVIO_MODO=AL_ENVIAR_A_DISENO, después de responder.
    if (pa.Tipo === 'PRINCIPAL' && b.Tizada === true) {
      const r = await require('./solicitudesVendedorTizadaPro').envioAutomatico(pool, user, baseTizadaPro(), pa.SolicitudID, pa.ProductoSolID, true);
      return { ok: true, tizada: r ? { Estado: r.Estado, Referencia: r.Referencia || null, mensaje: r.mensaje || r.ErrorTexto || null } : null };
    }
    if (pa.Tipo === 'PRINCIPAL' && b.Tizada === undefined) {
      setImmediate(() => require('./solicitudesVendedorTizadaPro').envioAutomatico(pool, user, baseTizadaPro(), pa.SolicitudID, pa.ProductoSolID));
    }
    return { ok: true };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.enviarADiseno parte ${parteId}`);
    throw err;
  }
}

// [20/10] ¿la solicitud tiene Origen? (scripts/add_solicitudes_portal.sql): los pedidos del portal se marcan en la bandeja
let _conOrigen = false;
async function conOrigenSol(pool) {
  if (_conOrigen) return true;
  _conOrigen = (await pool.request().query("SELECT COL_LENGTH('dbo.SolicitudesVendedor', 'Origen') AS c")).recordset[0].c != null;
  return _conOrigen;
}
const SQL_BANDEJA = `
  SELECT pa.ParteID, pa.SolicitudID, pa.ProductoSolID, pa.Tipo, pa.Estado, pa.TipoTrabajo, pa.CantidadTotal, pa.PorPrenda, pa.Ubicacion,
         pa.ArteOrigen, pa.Observaciones, pa.DisenadorID, pa.FechaEnvioDiseno, pa.FechaInicioDiseno, pa.FechaDisenado,
         pa.Modificada, pa.ModificadaDetalle, pa.ModificadaFecha,
         s.NombreTrabajo, s.CodCliente, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre,
         p.ProductoNombre, p.TipoFabricacion, p.Cantidad AS CantidadPrendas,
         uv.Nombre AS VendedorNombre, ud.Nombre AS DisenadorNombre,
         -- molde de TIZADA PRO del producto: la principal no se "toma", se manda a TIZADA (vuelve sola como diseño pronto)
         CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL THEN NULL
              ELSE (SELECT LTRIM(RTRIM(vc.TizadaProMoldeRef)) FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS TizadaProMoldeRef
  FROM dbo.SolicitudesVendedorPartes pa
  JOIN dbo.SolicitudesVendedor s          ON s.SolicitudID = pa.SolicitudID AND s.Estado <> 'CANCELADA'
  JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID AND p.Activo = 1 AND p.PedidoNoDocERP IS NULL
  LEFT JOIN dbo.Clientes c  ON c.CodCliente = s.CodCliente
  LEFT JOIN dbo.Usuarios uv ON uv.IdUsuario = s.VendedorID
  LEFT JOIN dbo.Usuarios ud ON ud.IdUsuario = pa.DisenadorID
  WHERE pa.Activo = 1`;

// RN-SOL.31: el diseñador ve la bandeja común (nadie la tomó) y lo que él tomó.
async function bandeja(pool, user) {
  if (!(await esDisenador(pool, user))) throw fallo(403, 'La bandeja de Diseño es solo para diseñadores habilitados.');
  // [20/10] Origen: 'PORTAL' = lo pidió el cliente desde la tienda (el "vendedor" es la asesora de su ficha)
  const SQL = (await conOrigenSol(pool)) ? SQL_BANDEJA.replace('s.NombreTrabajo, s.CodCliente,', 's.NombreTrabajo, s.CodCliente, s.Origen,') : SQL_BANDEJA;
  const disponibles = (await pool.request().query(`${SQL} AND pa.Estado = 'ENVIADO_DISENO' ORDER BY pa.FechaEnvioDiseno ASC`)).recordset;
  const mias = (await pool.request().input('U', sql.Int, user.id)
    .query(`${SQL} AND pa.DisenadorID = @U AND pa.Estado IN ('DISENO_INICIADO','DISENADO')
            ORDER BY CASE WHEN pa.Estado = 'DISENO_INICIADO' THEN 0 ELSE 1 END, pa.Modificada DESC, pa.FechaInicioDiseno ASC`)).recordset;
  await completarBandeja(pool, [...disponibles, ...mias]);
  return { disponibles, mias };
}

// ─────────────────────────────────────────────────────────────────────
// [BANDEJA · DEL PORTAL 20/10] Lo que llegó de la tienda del portal y todavía no es pedido de producción, con en qué está:
//   ARMANDO          el cliente lo está armando (no confirmó)
//   EN_DISENO        confirmado: lo tiene Diseño (para tomar o tomado)
//   EN_TIZADA        TIZADA PRO lo está procesando
//   TIZADA_RECHAZO   TIZADA no lo aceptó (Detalle = por qué)
//   POR_CONVERTIR    diseñado: el pedido se arma solo (barrido de pedidoPortalService.convertirListos)
//   ERROR_CONVERSION diseñado, pero el pedido no se pudo armar solo (Detalle = el último error)
// ─────────────────────────────────────────────────────────────────────
async function portalDiseno(pool, user) {
  if (!(await esDisenador(pool, user))) throw fallo(403, 'La bandeja de Diseño es solo para diseñadores habilitados.');
  if (!(await conOrigenSol(pool))) return [];
  const conEnvios = (await pool.request().query("SELECT OBJECT_ID('dbo.TizadaProEnvios', 'U') AS t")).recordset[0].t != null;
  const r = await pool.request().query(`
    SELECT TOP 300 s.SolicitudID, s.NombreTrabajo, s.FechaSolicitud, s.PortalConfirmado, s.CodCliente, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre,
           uv.Nombre AS VendedorNombre, p.ProductoSolID, p.ProductoNombre, p.Cantidad,
           pa.ParteID, pa.Estado AS EstadoPrincipal, pa.DisenadorID, ud.Nombre AS DisenadorNombre,
           ${conEnvios ? 'env.Estado AS TizadaEstado, env.Etapa AS TizadaEtapa, env.ErrorTexto AS TizadaError, env.Referencia AS TizadaRef, env.FechaActualizado AS TizadaFecha,' : ''}
           ev.Texto AS ErrorConversion, ev.Fecha AS ErrorConversionFecha
    FROM dbo.SolicitudesVendedor s
    JOIN dbo.SolicitudesVendedorProductos p ON p.SolicitudID = s.SolicitudID AND p.Activo = 1 AND p.PedidoNoDocERP IS NULL
    LEFT JOIN dbo.Clientes c  ON c.CodCliente = s.CodCliente
    LEFT JOIN dbo.Usuarios uv ON uv.IdUsuario = s.VendedorID
    OUTER APPLY (SELECT TOP 1 x.ParteID, x.Estado, x.DisenadorID FROM dbo.SolicitudesVendedorPartes x
                 WHERE x.ProductoSolID = p.ProductoSolID AND x.Tipo = 'PRINCIPAL' AND x.Activo = 1) pa
    LEFT JOIN dbo.Usuarios ud ON ud.IdUsuario = pa.DisenadorID
    ${conEnvios ? `OUTER APPLY (SELECT TOP 1 e.Estado, e.Etapa, e.ErrorTexto, e.Referencia, e.FechaActualizado FROM dbo.TizadaProEnvios e
                 WHERE e.Origen = 'SOLICITUD' AND e.OrigenItemID = p.ProductoSolID AND ISNULL(e.SoloRevision, 0) = 0 ORDER BY e.EnvioID DESC) env` : ''}
    OUTER APPLY (SELECT TOP 1 v.Texto, v.Fecha FROM dbo.SolicitudesVendedorEventos v
                 WHERE v.SolicitudID = s.SolicitudID AND v.Texto LIKE 'El pedido del portal no se pudo armar solo%' ORDER BY v.Fecha DESC) ev
    WHERE s.Origen = 'PORTAL' AND s.Estado <> 'CANCELADA'
    ORDER BY CASE WHEN s.PortalConfirmado IS NULL THEN 1 ELSE 0 END, ISNULL(s.PortalConfirmado, s.FechaSolicitud) DESC`);
  return r.recordset.map(x => {
    const enTizada = ['EN_COLA', 'PROCESANDO', 'LISTO', 'APLICANDO'].includes(x.TizadaEstado);
    const rechazo = ['RECHAZADO', 'ERROR'].includes(x.TizadaEstado) && x.EstadoPrincipal !== 'DISENADO';
    const situacion = !x.PortalConfirmado ? 'ARMANDO'
      : enTizada ? 'EN_TIZADA'
        : rechazo ? 'TIZADA_RECHAZO'
          : x.EstadoPrincipal === 'DISENADO' ? (x.ErrorConversion ? 'ERROR_CONVERSION' : 'POR_CONVERTIR')
            : 'EN_DISENO';
    const detalle = situacion === 'TIZADA_RECHAZO' ? (x.TizadaError || x.TizadaEtapa || null)
      : situacion === 'ERROR_CONVERSION' ? String(x.ErrorConversion).replace(/^El pedido del portal no se pudo armar solo \([^)]*\):\s*/, '')
        : situacion === 'EN_TIZADA' ? (x.TizadaEtapa || null) : null;
    return { ...x, Situacion: situacion, Detalle: detalle, EsMia: x.DisenadorID === user.id };
  });
}

// Cancelar un pedido del portal desde la bandeja (con motivo; el cliente lo ve en su portal: pedidoPortalService.listar)
async function cancelarDelPortal(pool, user, solicitudId, b) {
  if (!(await esDisenador(pool, user)) && !esVendedor(user)) throw fallo(403, 'Solo Diseño o un vendedor pueden cancelar un pedido del portal.');
  if (!(await conOrigenSol(pool))) throw fallo(409, 'Falta scripts/add_solicitudes_portal.sql en esta base.');
  const s = (await pool.request().input('S', sql.Int, solicitudId).query('SELECT Origen FROM dbo.SolicitudesVendedor WHERE SolicitudID = @S')).recordset[0];
  if (!s) throw fallo(404, 'Esa solicitud no existe.');
  if (s.Origen !== 'PORTAL') throw fallo(409, 'Desde la bandeja solo se cancelan pedidos que vinieron del portal.');
  return cancelar(pool, user, solicitudId, b, { diseno: true });
}

// [BANDEJA · BUSCAR 20/10] Buscar en todo Diseño: cualquier servicio de cualquier solicitud (de cualquier diseñador, del
// portal, ya pedido o cancelada), por cliente, trabajo, #solicitud, vendedor, diseñador, producto o pedido. Hasta 80.
async function buscarDiseno(pool, user, q) {
  if (!(await esDisenador(pool, user))) throw fallo(403, 'La bandeja de Diseño es solo para diseñadores habilitados.');
  const palabras = String(q || '').trim().split(/\s+/).filter(w => w.length >= 1).slice(0, 6);
  if (!palabras.length || String(q).trim().length < 2) return [];
  const origen = await conOrigenSol(pool);
  const rq = pool.request();
  const texto = `(ISNULL(c.Nombre, '') + ' ' + ISNULL(s.NombreTrabajo, '') + ' #' + CAST(s.SolicitudID AS varchar(20)) + ' ' + ISNULL(uv.Nombre, '') + ' '
    + ISNULL(ud.Nombre, '') + ' ' + ISNULL(p.ProductoNombre, '') + ISNULL(' pedido ' + CAST(p.PedidoNoDocERP AS varchar(30)), '')) COLLATE Latin1_General_CI_AI`;
  const conds = palabras.map((w, i) => { rq.input(`w${i}`, sql.NVarChar(120), `%${w.replace(/[%_[]/g, ch => `[${ch}]`)}%`); return `${texto} LIKE @w${i}`; });
  const r = await rq.query(`
    SELECT TOP 80 pa.ParteID, pa.SolicitudID, pa.ProductoSolID, pa.Tipo, pa.Estado, pa.DisenadorID, pa.Modificada, pa.FechaEnvioDiseno, pa.FechaDisenado,
           s.NombreTrabajo, s.Estado AS SolEstado, ${origen ? 's.Origen, s.PortalConfirmado,' : ''} LTRIM(RTRIM(c.Nombre)) AS ClienteNombre,
           p.ProductoNombre, p.Cantidad AS CantidadPrendas, p.PedidoNoDocERP, uv.Nombre AS VendedorNombre, ud.Nombre AS DisenadorNombre
    FROM dbo.SolicitudesVendedorPartes pa
    JOIN dbo.SolicitudesVendedor s          ON s.SolicitudID = pa.SolicitudID
    JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID AND p.Activo = 1
    LEFT JOIN dbo.Clientes c  ON c.CodCliente = s.CodCliente
    LEFT JOIN dbo.Usuarios uv ON uv.IdUsuario = s.VendedorID
    LEFT JOIN dbo.Usuarios ud ON ud.IdUsuario = pa.DisenadorID
    WHERE pa.Activo = 1 AND ${conds.join(' AND ')}
    ORDER BY CASE WHEN s.Estado = 'CANCELADA' THEN 1 ELSE 0 END, pa.SolicitudID DESC, pa.ParteID`);
  return r.recordset.map(x => ({ ...x, EsMia: x.DisenadorID === user.id }));
}

// [BANDEJA · HECHOS 15/10] Lo que Diseño ya terminó: todo servicio "Diseñado" entre b.desde y b.hasta ('AAAA-MM-DD', los
// dos incluidos; sin fechas, HOY; un año como máximo), sea o no pedido todavía. Por fila: quién lo hizo (Quien: DISENADOR con su nombre, TIZADA = lo hizo TIZADA
// PRO sola, VENDEDOR = el vendedor adjuntó el arte listo del cliente), cuándo, y del pedido cuántas órdenes ya terminó la
// planta. EsMia: lo tenía tomado quien mira. Solo lectura.
async function disenosHechos(pool, user, b = {}) {
  if (!(await esDisenador(pool, user))) throw fallo(403, 'La bandeja de Diseño es solo para diseñadores habilitados.');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dia = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const desde = dia(b.desde) || iso(new Date()), hasta = dia(b.hasta) || iso(new Date());
  if (hasta < desde) throw fallo(400, 'La fecha "hasta" no puede ser anterior a "desde".');
  if ((new Date(hasta) - new Date(desde)) / 86400000 > 366) throw fallo(400, 'Elegí un período de un año como máximo.');
  const filas = (await pool.request().input('De', sql.Date, desde).input('Ha', sql.Date, hasta).query(`
    SELECT TOP 500 pa.ParteID, pa.SolicitudID, pa.ProductoSolID, pa.Tipo, pa.TipoTrabajo, pa.FechaDisenado, pa.DisenadorID,
           LTRIM(RTRIM(ud.Nombre)) AS DisenadorNombre, LTRIM(RTRIM(uu.Nombre)) AS HizoNombre, pa.DatosJson AS ParteDatos,
           s.NombreTrabajo, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre, uv.Nombre AS VendedorNombre,
           p.ProductoNombre, p.TipoFabricacion, p.Cantidad AS CantidadPrendas, p.PedidoNoDocERP, p.FechaConversion
    FROM dbo.SolicitudesVendedorPartes pa
    JOIN dbo.SolicitudesVendedor s          ON s.SolicitudID = pa.SolicitudID AND s.Estado <> 'CANCELADA'
    JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID AND p.Activo = 1
    LEFT JOIN dbo.Clientes c  ON c.CodCliente = s.CodCliente
    LEFT JOIN dbo.Usuarios uv ON uv.IdUsuario = s.VendedorID
    LEFT JOIN dbo.Usuarios ud ON ud.IdUsuario = pa.DisenadorID
    LEFT JOIN dbo.Usuarios uu ON uu.IdUsuario = pa.UsuarioDisenado
    WHERE pa.Activo = 1 AND pa.Estado = 'DISENADO' AND pa.FechaDisenado >= @De AND pa.FechaDisenado < DATEADD(day, 1, @Ha)
    ORDER BY pa.FechaDisenado DESC`)).recordset;
  // Del pedido: cuántas órdenes tiene (sin las canceladas) y cuántas ya terminó la planta. Una sola lectura de Ordenes.
  const pedidos = [...new Set(filas.map(x => x.PedidoNoDocERP).filter(Boolean).map(Number))];
  const ped = new Map();
  if (pedidos.length) {
    const r = await pool.request().query(`
      SELECT LTRIM(RTRIM(CAST(o.NoDocERP AS varchar(50)))) AS NoDocERP, COUNT(*) AS Ordenes,
             SUM(CASE WHEN o.Estado IN ('Finalizado', 'Entregado', 'Pronto', 'Cerrado') THEN 1 ELSE 0 END) AS Terminadas
      FROM dbo.Ordenes o
      WHERE LTRIM(RTRIM(CAST(o.NoDocERP AS varchar(50)))) IN (${pedidos.map(n => `'${n}'`).join(',')}) AND ISNULL(o.Estado, '') <> 'Cancelado'
      GROUP BY LTRIM(RTRIM(CAST(o.NoDocERP AS varchar(50))))`);
    r.recordset.forEach(x => ped.set(String(x.NoDocERP), { Ordenes: x.Ordenes, Terminadas: x.Terminadas }));
  }
  return filas.map(({ ParteDatos, ...x }) => {
    let auto = null;
    try { auto = JSON.parse(ParteDatos || '{}').disenoAutomatico || null; } catch (_) { /* sin datos */ }
    const Quien = x.DisenadorID ? 'DISENADOR' : auto ? 'TIZADA' : 'VENDEDOR';
    return {
      ...x, Quien, Automatico: auto ? { referencia: auto.referencia || null, detalle: auto.detalle || null } : null,
      EsMia: !!x.DisenadorID && Number(x.DisenadorID) === Number(user.id),
      Pedido: x.PedidoNoDocERP ? { NoDocERP: x.PedidoNoDocERP, ...(ped.get(String(x.PedidoNoDocERP)) || { Ordenes: 0, Terminadas: 0 }) } : null,
    };
  });
}

// [BANDEJA 15/10] Productos con TIZADA PRO: las cantidades salen de la lista de jugadores, no de "cantidad total / por
// prenda" del formulario viejo. Cada fila trae ListaPrendas (lo que suma la lista; a medida, las unidades de los diseños;
// null sin lista) y la principal, TizadaEnCurso ({ Referencia, Estado, Etapa }) si hay un pedido en TIZADA trabajando.
async function completarBandeja(pool, filas) {
  const ids = [...new Set(filas.filter(x => x.TizadaProMoldeRef).map(x => Number(x.ProductoSolID)))];
  if (!ids.length) return;
  const prods = (await pool.request().query(`SELECT ProductoSolID, DatosJson FROM dbo.SolicitudesVendedorProductos WHERE ProductoSolID IN (${ids.join(',')})`)).recordset;
  const lista = new Map(prods.map(r => {
    let tz = null;
    try { tz = JSON.parse(r.DatosJson || '{}').tizadaPro || null; } catch (_) { /* JSON roto: sin lista */ }
    const filasLista = tz?.planilla || [];
    // misma cuenta que faltantesConversion: cada fila suma su Cantidad (vacía = 1); a medida, la cantidad de cada diseño
    const unidades = filasLista.length ? filasLista.reduce((t, f) => t + (Number(f.cantidad) > 0 ? Number(f.cantidad) : 1), 0)
      : (tz?.disenos || []).reduce((t, d) => t + (Number(d.cantidad) > 0 ? Number(d.cantidad) : 0), 0);
    return [r.ProductoSolID, unidades || null];
  }));
  let enCurso = new Map();
  try {
    const r = await pool.request().query(`
      SELECT e.OrigenItemID AS ProductoSolID, e.Referencia, e.Estado, e.Etapa
      FROM dbo.TizadaProEnvios e
      WHERE e.Origen = 'SOLICITUD' AND e.OrigenItemID IN (${ids.join(',')}) AND e.Estado IN ('EN_COLA','PROCESANDO','LISTO','APLICANDO')
        AND e.EnvioID = (SELECT MAX(x.EnvioID) FROM dbo.TizadaProEnvios x WHERE x.Origen = 'SOLICITUD' AND x.OrigenItemID = e.OrigenItemID AND ISNULL(x.SoloRevision, 0) = 0)`);
    enCurso = new Map(r.recordset.map(x => [x.ProductoSolID, { Referencia: x.Referencia, Estado: x.Estado, Etapa: x.Etapa }]));
  } catch (_) { /* sin la tabla de envíos (scripts/add_tizadapro_envios.sql): no se muestra */ }
  for (const x of filas) {
    if (!x.TizadaProMoldeRef) continue;
    x.ListaPrendas = lista.get(Number(x.ProductoSolID)) ?? null;
    x.TizadaEnCurso = x.Tipo === 'PRINCIPAL' ? (enCurso.get(Number(x.ProductoSolID)) || null) : null;
  }
}

async function tomarParte(pool, user, parteId) {
  if (!(await esDisenador(pool, user))) throw fallo(403, 'Solo un diseñador habilitado puede tomar un trabajo.');
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const pa = await parteConContexto(transaction, parteId);
    // Candado: el UPDATE solo pega si sigue libre (dos diseñadores a la vez → gana uno)
    const upd = await new sql.Request(transaction).input('P', sql.Int, parteId).input('U', sql.Int, user.id)
      .query(`UPDATE dbo.SolicitudesVendedorPartes SET DisenadorID = @U, FechaInicioDiseno = GETDATE()
               WHERE ParteID = @P AND Estado = 'ENVIADO_DISENO' AND DisenadorID IS NULL`);
    if (!upd.rowsAffected[0]) throw fallo(409, 'Este trabajo ya lo tomó otro diseñador o ya no está en la bandeja.');
    await cambiarEstadoParte(transaction, user, pa, 'DISENO_INICIADO', null, `lo tomó ${user.name || user.username}`);
    // "Si la parte aún no fue tomada, lo acepta quien la tome" (RN-SOL.20b)
    if (pa.Modificada) await aceptarCambioTx(transaction, user, pa, 'al tomar el trabajo');
    await transaction.commit();
    return { ok: true };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.tomarParte ${parteId}`);
    throw err;
  }
}

async function aceptarCambioTx(cx, user, pa, como) {
  await new sql.Request(cx).input('P', sql.Int, pa.ParteID)
    .query('UPDATE dbo.SolicitudesVendedorPartes SET Modificada = 0 WHERE ParteID = @P');
  await registrarEvento(cx, user, {
    solicitudId: pa.SolicitudID, productoSolId: pa.ProductoSolID, parteId: pa.ParteID, tipo: 'CAMBIO_ACEPTADO',
    texto: `${NOMBRE_PARTE[pa.Tipo]}: cambio aceptado${como ? ' ' + como : ''}. Era: ${pa.ModificadaDetalle || '(sin detalle)'}`,
  });
}

async function aceptarCambio(pool, user, parteId) {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const pa = await parteConContexto(transaction, parteId);
    if (!pa.Modificada) throw fallo(409, 'Este servicio no tiene cambios pendientes de aceptar.');
    const sinPasarPorDiseno = pa.Estado === 'DISENADO' && !pa.DisenadorID;   // no hay diseñador: lo confirma el vendedor
    if (!esAdmin(user) && pa.DisenadorID !== user.id && !(sinPasarPorDiseno && esVendedor(user))) throw fallo(403, 'El cambio lo acepta el diseñador que tiene el trabajo.');
    await aceptarCambioTx(transaction, user, pa, sinPasarPorDiseno ? '(este servicio no pasó por Diseño: lo confirmó el vendedor)' : null);
    await transaction.commit();
    return { ok: true };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.aceptarCambio ${parteId}`);
    throw err;
  }
}

// ---------------------------------------------------------------------
// Archivos (spec §4): se suben UNA vez a Drive; el pedido toma el enlace.
// ---------------------------------------------------------------------
async function subirArchivo(pool, user, solicitudId, b, file) {
  if (!file) throw fallo(400, 'Falta el archivo.');
  const tmpPath = file.path || null;
  let archivoId = null;
  try {
    const rol = String(b.Rol || '').toUpperCase();
    if (!ROLES_ARCHIVO.includes(rol)) throw fallo(400, 'Indicá qué es el archivo (arte del cliente, referencia, boceto, planilla, tizada, diseño pronto o comprobante de pago).');
    // [PORTAL] el cliente que arma su pedido en la Tienda sube lo suyo: arte, referencias, bocetos y planillas
    if (user?.portal && !['ARTE_CLIENTE', 'REFERENCIA', 'BOCETO', 'PLANILLA'].includes(rol)) throw fallo(403, 'Desde el portal se sube el arte, referencias, bocetos o la planilla.');
    if (rol === 'COMPROBANTE' && (entero(b.ParteID) || entero(b.ProductoSolID) || entero(b.EventoID))) throw fallo(400, 'El comprobante de pago es de toda la solicitud: no va en un producto ni en un servicio.');
    const parteId = entero(b.ParteID);
    const reemplazaA = entero(b.ReemplazaA);
    const eventoId = entero(b.EventoID);
    let productoSolId = entero(b.ProductoSolID);
    const nombre = txt(file.originalname, 260) || 'archivo';
    const ext = (nombre.split('.').pop() || '').toLowerCase();

    const sol = await cabecera(pool, solicitudId);

    let pa = null;
    if (parteId) {
      // [CORREGIR EL DISEÑO 15/10] con una corrección abierta se vuelve a subir el diseño pronto de la principal y del DTF
      pa = await parteConContexto(pool, parteId, { permitirCorreccion: rol === 'DISENO_PRONTO' });
      if (pa.SolicitudID !== solicitudId) throw fallo(400, 'El servicio no pertenece a esta solicitud.');
      productoSolId = pa.ProductoSolID;
    }
    if (!pa?.EnCorreccion || sol.Estado === 'CANCELADA') exigirAbierta(sol);

    if (rol === 'DISENO_PRONTO') {
      if (!pa) throw fallo(400, 'El diseño pronto se sube sobre un servicio concreto.');
      // en una corrección lo sube cualquier diseñador (el trabajo ya estaba hecho y puede no tener dueño)
      const corrigiendo = !!pa.EnCorreccion && await esDisenador(pool, user);
      if (pa.EnCorreccion && !corrigiendo) throw fallo(403, 'Durante la corrección del diseño, los archivos los sube un diseñador.');
      const soyElDisenador = corrigiendo || (pa.DisenadorID && (pa.DisenadorID === user.id || esAdmin(user)));
      // RN-SOL.20: arte listo del cliente en un servicio adicional → lo adjunta el vendedor, sin pasar por Diseño.
      const vendedorDirecto = !pa.DisenadorID && TIPOS_ADICIONAL.includes(pa.Tipo) && ['INGRESADO', 'DISENADO'].includes(pa.Estado) && esVendedor(user);
      if (!soyElDisenador && !vendedorDirecto) {
        throw fallo(403, pa.Tipo === 'PRINCIPAL'
          ? 'El arte de la producción principal siempre pasa por Diseño: lo sube el diseñador que tomó el trabajo.'
          : 'El diseño pronto lo sube el diseñador que tomó el trabajo (o el vendedor, si el arte vino listo del cliente y no se envió a Diseño).');
      }
      if (soyElDisenador && !corrigiendo && !['DISENO_INICIADO', 'DISENADO'].includes(pa.Estado)) throw fallo(409, 'Primero tomá el trabajo de la bandeja.');
      const f = FORMATOS_DISENO[pa.Tipo];
      if (f && !f.ext.includes(ext)) throw fallo(400, `Formato inválido para ${NOMBRE_PARTE[pa.Tipo]}. Solo se permite ${f.txt}.`);
    } else if (!esVendedor(user) && !(pa && pa.DisenadorID === user.id) && !(eventoId && await esDisenador(pool, user))
      // [LO HACE EL TALLER 26/10] el arte de la producción principal lo arma Diseño: un diseñador lo sube con el trabajo ya
      // en Diseño (con molde de TIZADA PRO la principal no se "toma": se manda a TIZADA, así que todavía no tiene dueño)
      && !(rol === 'ARTE_CLIENTE' && pa?.Tipo === 'PRINCIPAL' && ['ENVIADO_DISENO', 'DISENO_INICIADO', 'DISENADO'].includes(pa.Estado) && await esDisenador(pool, user))) {
      throw fallo(403, 'No tenés permiso para adjuntar archivos a esta solicitud.');
    }

    // Hoja de una tizada de TizadaPro: la tela, el ancho y los metros salen de la tizada
    // vinculada (no de medir el PDF, que puede tener varias páginas). null = archivo común.
    const hojaTizada = rol === 'DISENO_PRONTO' ? await require('./solicitudesVendedorTizadas').datosDeHoja(pool, pa, b) : null;
    if (hojaTizada) b = { ...b, AnchoM: hojaTizada.AnchoM, AltoM: hojaTizada.AltoM, CodArticulo: hojaTizada.CodArticulo, Material: hojaTizada.Material };
    // F1: producto del catálogo sin molde → el archivo de impresión tiene que medir la medida fija del producto
    if (rol === 'DISENO_PRONTO' && pa && pa.Tipo === 'PRINCIPAL' && !hojaTizada) {
      const conv = require('./solicitudesVendedorConversion');
      const mf = await conv.medidaFijaDeProducto(pool, pa.ProductoSolID);
      if (mf) {
        if (!(Number(b.AnchoM) > 0 && Number(b.AltoM) > 0)) throw fallo(400, `Este producto se imprime a medida fija (${mf.anchoM.toFixed(2)} × ${mf.altoM.toFixed(2)} m) y "${nombre}" no trae medida: exportalo con DPI y volvé a subirlo.`);
        const e = conv.errorMedidaFija(nombre, b.AnchoM, b.AltoM, mf);
        if (e) throw fallo(400, e);
        // A medida fija, un archivo = una unidad: las copias arrancan en las unidades pedidas (el diseñador puede cambiarlas)
        if (!reemplazaA && (b.Copias === undefined || b.Copias === null || b.Copias === '') && mf.cantidad > 0) b = { ...b, Copias: mf.cantidad };
      }
    }

    let viejo = null;
    let produccion = null;   // tela + copias: solo diseño pronto de la producción principal
    if (reemplazaA) {
      const r = await pool.request().input('A', sql.Int, reemplazaA).input('Sol', sql.Int, solicitudId)
        .query('SELECT * FROM dbo.SolicitudesVendedorArchivos WHERE ArchivoID = @A AND SolicitudID = @Sol AND Vigente = 1');
      viejo = r.recordset[0];
      if (!viejo) throw fallo(404, 'El archivo a sustituir no existe o ya fue sustituido.');
      if (viejo.Rol !== rol || (viejo.ParteID || null) !== (parteId || null)) throw fallo(400, 'El archivo nuevo debe sustituir a uno del mismo tipo y del mismo servicio.');
    }
    // El archivo corregido hereda la tela y las copias del que sustituye, salvo que lleguen otras.
    if (rol === 'DISENO_PRONTO' && pa.Tipo === 'PRINCIPAL') {
      const conv = require('./solicitudesVendedorConversion');
      produccion = await conv.resolverProduccion(pool, b, viejo, await conv.areaPrincipalDeProducto(pool, pa.ProductoSolID));
    }
    if (rol === 'DISENO_PRONTO' && pa.Tipo === 'DTF') {
      await require('./solicitudesVendedorConversion').exigirMedidaDtf(pool, pa, b, nombre);
      // DTF: solo copias; el film vacío es el del servicio. [15/10] El pliego corregido hereda el film del que sustituye
      // (con objetos en varios films cada pliego es de uno; sin esto, el corregido quedaba en el film del servicio).
      produccion = { Material: viejo?.Material || null, CodArticulo: viejo?.CodArticulo || null, CodStock: viejo?.CodStock || null,
        Copias: parseInt(b.Copias, 10) >= 1 ? parseInt(b.Copias, 10) : (viejo?.Copias || 1) };
    }

    // 1. Fila pendiente → 2. Drive (fuera de transacción: es lento) → 3. cierre en transacción
    const ins = await pool.request()
      .input('Sol', sql.Int, solicitudId).input('Prod', sql.Int, productoSolId || null).input('Parte', sql.Int, parteId || null)
      .input('Ev', sql.Int, eventoId || null).input('Rol', sql.VarChar(20), rol).input('Nom', sql.NVarChar(260), nombre)
      .input('Tam', sql.BigInt, file.size || null).input('An', sql.Decimal(10, 4), decimal(b.AnchoM)).input('Al', sql.Decimal(10, 4), decimal(b.AltoM))
      .input('Rep', sql.Int, reemplazaA || null).input('U', sql.Int, user.id)
      .query(`INSERT INTO dbo.SolicitudesVendedorArchivos (SolicitudID, ProductoSolID, ParteID, EventoID, Rol, NombreOriginal, UrlDrive, TamanoBytes, AnchoM, AltoM, Vigente, ReemplazaA, UsuarioSube)
              OUTPUT INSERTED.ArchivoID
              VALUES (@Sol, @Prod, @Parte, @Ev, @Rol, @Nom, 'Pendiente', @Tam, @An, @Al, 0, @Rep, @U)`)
      .catch((e) => { throw (rol === 'COMPROBANTE' && /CK_SolVenArchivo_Rol/.test(e.message)) ? fallo(409, 'La base todavía no acepta comprobantes de pago: falta correr la sección 4 de scripts/add_conversion_solicitud_pedido.sql.') : e; });
    archivoId = ins.recordset[0].ArchivoID;

    const driveService = require('./driveService');
    const fileInput = tmpPath ? fs.createReadStream(tmpPath) : file.buffer;
    const url = await driveService.uploadToDrive(fileInput, `SOL-${solicitudId}_${nombre}`, 'SOLICITUDES');

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await new sql.Request(transaction).input('A', sql.Int, archivoId).input('Url', sql.NVarChar(sql.MAX), url)
        .query('UPDATE dbo.SolicitudesVendedorArchivos SET UrlDrive = @Url, Vigente = 1 WHERE ArchivoID = @A');
      if (produccion) await require('./solicitudesVendedorConversion').guardarProduccion(transaction, archivoId, produccion);
      if (hojaTizada) await require('./solicitudesVendedorTizadas').marcarArchivo(transaction, archivoId, hojaTizada);
      if (viejo) {
        await new sql.Request(transaction).input('A', sql.Int, viejo.ArchivoID)
          .query('UPDATE dbo.SolicitudesVendedorArchivos SET Vigente = 0 WHERE ArchivoID = @A');
      }
      const donde = pa ? `${NOMBRE_PARTE[pa.Tipo]}: ` : '';
      await registrarEvento(transaction, user, {
        solicitudId, productoSolId, parteId, tipo: viejo ? 'ARCHIVO_SUSTITUIDO' : 'ARCHIVO',
        texto: viejo ? `${donde}"${nombre}" sustituyó a "${viejo.NombreOriginal}" (${rol}).` : `${donde}se adjuntó "${nombre}" (${rol}).`,
      });
      if (pa && rol === 'DISENO_PRONTO' && pa.Estado !== 'DISENADO') {
        // Subir el archivo terminado es lo que marca la parte como diseñada (RN-SOL.19)
        await cambiarEstadoParte(transaction, user, pa, 'DISENADO', 'FechaDisenado = GETDATE(), UsuarioDisenado = @U', null);
      } else if (pa && rol !== 'DISENO_PRONTO' && pa.Estado !== 'INGRESADO' && esVendedor(user) && pa.DisenadorID !== user.id && !(pa.Estado === 'DISENADO' && !pa.DisenadorID)) {
        // Arte o referencia nueva sobre una parte que ya está en Diseño → señal "Modificada"
        await marcarModificada(transaction, user, pa.ParteID, viejo ? `Archivo sustituido: "${viejo.NombreOriginal}" → "${nombre}"` : `Archivo nuevo: "${nombre}" (${rol})`);
      }
      await transaction.commit();
    } catch (err) {
      await rollbackSeguro(transaction, `solicitudesVendedor.subirArchivo ${solicitudId}`);
      throw err;
    }
    return { ArchivoID: archivoId, UrlDrive: url, NombreOriginal: nombre };
  } catch (err) {
    // La fila pendiente nunca llegó a estar vigente: se limpia para no dejar basura.
    if (archivoId) {
      try { await pool.request().input('A', sql.Int, archivoId).query("DELETE FROM dbo.SolicitudesVendedorArchivos WHERE ArchivoID = @A AND UrlDrive = 'Pendiente'"); }
      catch (e) { logger.warn(`[SOLICITUDES] no se pudo limpiar el archivo pendiente ${archivoId}: ${e.message}`); }
    }
    throw err;
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
  }
}

async function quitarArchivo(pool, user, solicitudId, archivoId) {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const sol = await cabecera(transaction, solicitudId);
    const r = await new sql.Request(transaction).input('A', sql.Int, archivoId).input('Sol', sql.Int, solicitudId)
      .query('SELECT * FROM dbo.SolicitudesVendedorArchivos WHERE ArchivoID = @A AND SolicitudID = @Sol AND Vigente = 1');
    const a = r.recordset[0];
    if (!a) throw fallo(404, 'El archivo no existe o ya fue quitado.');
    // [CORREGIR EL DISEÑO 15/10] en una corrección abierta, un diseñador quita diseños prontos de más de la principal / DTF
    const corrigiendo = a.Rol === 'DISENO_PRONTO' && !!a.ParteID && await enCorreccion(transaction, a.ProductoSolID) && await esDisenador(pool, user);
    if (!corrigiendo || sol.Estado === 'CANCELADA') exigirAbierta(sol);
    if (a.Rol === 'DISENO_PRONTO') {
      // Un servicio puede llevar varios archivos de diseño pronto: uno de más se puede quitar.
      // El ÚLTIMO no: el servicio está "Diseñado" porque tiene archivo — ese se sustituye por el corregido.
      const pa = await parteConContexto(transaction, a.ParteID, { permitirCorreccion: corrigiendo });
      const puede = corrigiendo || esAdmin(user) || (pa.DisenadorID && pa.DisenadorID === user.id) || (!pa.DisenadorID && esVendedor(user));
      if (!puede) throw fallo(403, 'El diseño pronto lo quita el diseñador que tiene el trabajo (o el vendedor, si el servicio no pasó por Diseño).');
      const otros = await new sql.Request(transaction).input('P', sql.Int, a.ParteID).input('A', sql.Int, archivoId)
        .query("SELECT COUNT(*) AS n FROM dbo.SolicitudesVendedorArchivos WHERE ParteID = @P AND Rol = 'DISENO_PRONTO' AND Vigente = 1 AND ArchivoID <> @A");
      if (!otros.recordset[0].n && corrigiendo) throw fallo(409, 'Es el único archivo de diseño pronto de este servicio: en la corrección se sustituye por el corregido, no se quita.');
      if (!otros.recordset[0].n) {
        // Si nunca pasó por Diseño (RN-SOL.20: el vendedor lo adjuntó directo), quitar el único archivo
        // deshace el "Diseñado": el servicio vuelve a Ingresado. Con diseñador, se sustituye, no se quita.
        if (pa.DisenadorID) throw fallo(409, 'Es el único archivo de diseño pronto de este servicio: no se quita, se sustituye por el archivo corregido.');
        await new sql.Request(transaction).input('A', sql.Int, archivoId).query('UPDATE dbo.SolicitudesVendedorArchivos SET Vigente = 0 WHERE ArchivoID = @A');
        await registrarEvento(transaction, user, { solicitudId, productoSolId: a.ProductoSolID, parteId: a.ParteID, tipo: 'ARCHIVO', texto: `Se quitó "${a.NombreOriginal}" (${a.Rol}).` });
        if (pa.Estado === 'DISENADO') await cambiarEstadoParte(transaction, user, pa, 'INGRESADO', 'FechaDisenado = NULL, UsuarioDisenado = NULL', 'se quitó el único diseño pronto: vuelve a Ingresado');
        await recalcularEstado(transaction, user, solicitudId);
        await transaction.commit();
        return { ok: true };
      }
    } else if (!(a.Rol === 'ARTE_CLIENTE' && a.UsuarioSube === user.id && await esDisenador(pool, user))) {
      // [LO HACE EL TALLER 26/10] el diseñador quita el arte que subió él (el del cliente, solo el vendedor)
      exigirVendedor(user);
    }
    await new sql.Request(transaction).input('A', sql.Int, archivoId).query('UPDATE dbo.SolicitudesVendedorArchivos SET Vigente = 0 WHERE ArchivoID = @A');
    await registrarEvento(transaction, user, { solicitudId, productoSolId: a.ProductoSolID, parteId: a.ParteID, tipo: 'ARCHIVO', texto: `Se quitó "${a.NombreOriginal}" (${a.Rol}).` });
    await transaction.commit();
    return { ok: true };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.quitarArchivo ${archivoId}`);
    throw err;
  }
}

// ---------------------------------------------------------------------
// Cancelar (RN-SOL.24b)
// ---------------------------------------------------------------------
// opts.diseno [20/10]: lo cancela un diseñador desde la bandeja (pestaña "Del portal"); el permiso ya lo controló cancelarDelPortal
async function cancelar(pool, user, solicitudId, b, opts = {}) {
  if (!opts.diseno) exigirVendedor(user);
  const motivo = txt(b.Motivo, 500);
  if (!motivo) throw fallo(400, 'Para cancelar la solicitud hay que escribir el motivo.');
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const sol = await cabecera(transaction, solicitudId);
    if (sol.Estado === 'CANCELADA') throw fallo(409, 'La solicitud ya está cancelada.');
    const conv = await new sql.Request(transaction).input('Sol', sql.Int, solicitudId)
      .query('SELECT COUNT(*) AS N FROM dbo.SolicitudesVendedorProductos WHERE SolicitudID = @Sol AND Activo = 1 AND PedidoNoDocERP IS NOT NULL');
    if (conv.recordset[0].N > 0) throw fallo(409, 'No se puede cancelar: al menos un producto ya se convirtió en pedido de producción.');
    await new sql.Request(transaction).input('Sol', sql.Int, solicitudId).input('M', sql.NVarChar(500), motivo).input('U', sql.Int, user.id)
      .query(`UPDATE dbo.SolicitudesVendedor SET Estado = 'CANCELADA', MotivoCancelacion = @M, CanceladaPor = @U, FechaCancelacion = GETDATE() WHERE SolicitudID = @Sol`);
    await registrarEvento(transaction, user, {
      solicitudId, tipo: 'CANCELACION', estadoAnterior: sol.Estado, estadoNuevo: 'CANCELADA',
      texto: `Motivo: ${motivo}${sol.SenaConfirmada ? ` · ATENCIÓN: tenía una seña registrada de ${Number(sol.SenaMonto).toFixed(2)} (${sol.SenaVia}, ref. ${sol.SenaReferencia}). Administración decide qué se hace con ese dinero.` : ''}`,
    });
    await transaction.commit();
    return { ok: true };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.cancelar ${solicitudId}`);
    throw err;
  }
}

// ---------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------
async function listar(pool, user, f) {
  exigirVendedor(user);   // RN-SOL.30: los vendedores ven todas
  const conv = require('./solicitudesVendedorConversion');
  const req = pool.request();
  const where = ['1 = 1'];
  if (f.estado && f.estado !== 'TODAS') {
    // Abierta = todavía queda algo por hacer: no se convirtió, o ya es pedido pero su Bordado / TPU sigue esperando diseño
    // en producción. No se da por cerrada hasta que esté completo todo.
    if (f.estado === 'ABIERTAS') where.push("(s.Estado IN ('INGRESADA','EN_DISENO') OR ISNULL(z.DisenoPendProd, 0) > 0)");
    // "En diseño" incluye las que YA son pedido pero cuyo Bordado / TPU todavía espera diseño en producción
    else if (f.estado === 'EN_DISENO') where.push("(s.Estado = 'EN_DISENO' OR ISNULL(z.DisenoPendProd, 0) > 0)");
    else { req.input('Estado', sql.VarChar(20), f.estado); where.push('s.Estado = @Estado'); }
  }
  if (entero(f.vendedorId)) { req.input('Ven', sql.Int, entero(f.vendedorId)); where.push('s.VendedorID = @Ven'); }
  if (entero(f.codCliente)) { req.input('Cod', sql.Int, entero(f.codCliente)); where.push('s.CodCliente = @Cod'); }
  if (f.desde) { req.input('Desde', sql.Date, f.desde); where.push('s.FechaSolicitud >= @Desde'); }
  if (f.hasta) { req.input('Hasta', sql.Date, f.hasta); where.push('s.FechaSolicitud < DATEADD(DAY, 1, @Hasta)'); }
  if (txt(f.q)) { req.input('Q', sql.NVarChar(120), `%${txt(f.q, 100)}%`); where.push('(s.NombreTrabajo LIKE @Q OR c.Nombre LIKE @Q OR c.NombreFantasia LIKE @Q OR CAST(s.SolicitudID AS varchar(12)) LIKE @Q OR EXISTS (SELECT 1 FROM dbo.SolicitudesVendedorProductos pq WHERE pq.SolicitudID = s.SolicitudID AND pq.Activo = 1 AND CAST(pq.PedidoNoDocERP AS varchar(12)) LIKE @Q))'); }
  // [PORTAL] los pedidos que el cliente arma en la Tienda aparecen cuando los confirma (scripts/add_solicitudes_portal.sql)
  const conPortal = (await pool.request().query("SELECT COL_LENGTH('dbo.SolicitudesVendedor', 'PortalConfirmado') AS c")).recordset[0].c != null;
  if (conPortal) where.push("NOT (s.Origen = 'PORTAL' AND s.PortalConfirmado IS NULL)");

  const r = await req.query(`
    SELECT TOP 500 s.SolicitudID, s.PreNumero, s.FechaSolicitud, ${conPortal ? 's.Origen' : "'VENDEDOR' AS Origen"}, ${(await tieneFicha(pool)) ? 's.FechaEntrega, s.FechaEntregaHasta, s.FichaJson' : 'NULL AS FechaEntrega, NULL AS FechaEntregaHasta, NULL AS FichaJson'}, s.CodCliente, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre, s.NombreTrabajo, s.Estado,
           s.VendedorID, u.Nombre AS VendedorNombre, s.ModoCobro, s.PrecioPactado, s.MonIdMoneda, s.RequiereSena, s.SenaConfirmada,
           x.Productos, x.Convertidos,
           -- Números de los pedidos de producción creados desde esta solicitud (uno por producto convertido)
           STUFF((SELECT ', ' + CAST(p2.PedidoNoDocERP AS varchar(12)) FROM dbo.SolicitudesVendedorProductos p2
                  WHERE p2.SolicitudID = s.SolicitudID AND p2.Activo = 1 AND p2.PedidoNoDocERP IS NOT NULL
                  ORDER BY p2.Orden FOR XML PATH('')), 1, 2, '') AS NumerosPedido,
           y.Partes, y.Ingresadas, y.EnBandeja, y.Iniciadas, y.Disenadas, y.Modificadas,
           ISNULL(z.DisenoPendProd, 0) AS DisenoPendProd, z.DisenoPendProdTxt
    FROM dbo.SolicitudesVendedor s
    LEFT JOIN dbo.Clientes c ON c.CodCliente = s.CodCliente
    LEFT JOIN dbo.Usuarios u ON u.IdUsuario = s.VendedorID
    OUTER APPLY (SELECT COUNT(*) AS Productos, SUM(CASE WHEN p.PedidoNoDocERP IS NOT NULL THEN 1 ELSE 0 END) AS Convertidos
                 FROM dbo.SolicitudesVendedorProductos p WHERE p.SolicitudID = s.SolicitudID AND p.Activo = 1) x
    OUTER APPLY (SELECT COUNT(*) AS Partes,
                        SUM(CASE WHEN pa.Estado = 'INGRESADO' AND p.PedidoNoDocERP IS NULL THEN 1 ELSE 0 END) AS Ingresadas,
                        SUM(CASE WHEN pa.Estado = 'ENVIADO_DISENO' AND p.PedidoNoDocERP IS NULL THEN 1 ELSE 0 END) AS EnBandeja,
                        SUM(CASE WHEN pa.Estado = 'DISENO_INICIADO' AND p.PedidoNoDocERP IS NULL THEN 1 ELSE 0 END) AS Iniciadas,
                        SUM(CASE WHEN pa.Estado = 'DISENADO' THEN 1 ELSE 0 END) AS Disenadas,
                        SUM(CASE WHEN pa.Modificada = 1 THEN 1 ELSE 0 END) AS Modificadas
                 FROM dbo.SolicitudesVendedorPartes pa
                 JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID AND p.Activo = 1
                 WHERE pa.SolicitudID = s.SolicitudID AND pa.Activo = 1) y
    -- Diseño que sigue pendiente EN PRODUCCIÓN para los pedidos de esta solicitud (Bordado / TPU)
    OUTER APPLY (
      SELECT COUNT(*) AS DisenoPendProd,
             STUFF((SELECT ' · ' + LTRIM(RTRIM(o.CodigoOrden)) + ': ' + CASE x.Etapa WHEN 'FALTA_DISENO' THEN 'falta diseño' WHEN 'ESPERANDO_APROBACION' THEN 'esperando aprobación del cliente'
                                                                              WHEN 'RECHAZADO' THEN 'rechazado por el cliente' ELSE 'aprobado, falta el arte' END
                    FROM dbo.SolicitudesVendedorProductos p3
                    JOIN dbo.Ordenes o ON o.NoDocERP = CAST(p3.PedidoNoDocERP AS varchar(50))
                    ${conv.ETAPA_APPLY_PARA_LISTA()}
                    WHERE p3.SolicitudID = s.SolicitudID AND p3.Activo = 1 AND p3.PedidoNoDocERP IS NOT NULL AND ${conv.SQL_ORDEN_VIVA} AND x.Etapa IS NOT NULL
                    FOR XML PATH('')), 1, 3, '') AS DisenoPendProdTxt
      FROM dbo.SolicitudesVendedorProductos p2
      JOIN dbo.Ordenes o ON o.NoDocERP = CAST(p2.PedidoNoDocERP AS varchar(50))
      ${conv.ETAPA_APPLY_PARA_LISTA()}
      WHERE p2.SolicitudID = s.SolicitudID AND p2.Activo = 1 AND p2.PedidoNoDocERP IS NOT NULL AND ${conv.SQL_ORDEN_VIVA} AND x.Etapa IS NOT NULL
    ) z
    WHERE ${where.join(' AND ')}
    ORDER BY s.FechaSolicitud DESC`);
  return sellarLista(pool, r.recordset);
}

async function obtener(pool, user, solicitudId) {
  const r = await pool.request().input('Sol', sql.Int, solicitudId).query(`
    SELECT s.*, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre, LTRIM(RTRIM(c.NombreFantasia)) AS ClienteFantasia, LTRIM(RTRIM(c.IDCliente)) AS ClienteCodigo,
           uv.Nombre AS VendedorNombre, us.Nombre AS SenaConfirmadaPorNombre, uc.Nombre AS CanceladaPorNombre
    FROM dbo.SolicitudesVendedor s
    LEFT JOIN dbo.Clientes c  ON c.CodCliente = s.CodCliente
    LEFT JOIN dbo.Usuarios uv ON uv.IdUsuario = s.VendedorID
    LEFT JOIN dbo.Usuarios us ON us.IdUsuario = s.SenaConfirmadaPor
    LEFT JOIN dbo.Usuarios uc ON uc.IdUsuario = s.CanceladaPor
    WHERE s.SolicitudID = @Sol`);
  const sol = r.recordset[0];
  if (!sol) throw fallo(404, 'La solicitud no existe.');

  const partes = (await pool.request().input('Sol', sql.Int, solicitudId).query(`
    SELECT pa.*, ud.Nombre AS DisenadorNombre FROM dbo.SolicitudesVendedorPartes pa
    LEFT JOIN dbo.Usuarios ud ON ud.IdUsuario = pa.DisenadorID
    WHERE pa.SolicitudID = @Sol AND pa.Activo = 1
    ORDER BY CASE pa.Tipo WHEN 'PRINCIPAL' THEN 0 WHEN 'BORDADO' THEN 1 WHEN 'DTF' THEN 2 ELSE 3 END`)).recordset;

  // RN-SOL.31: quien no es vendedor entra si es diseñador y algo de esta solicitud pasó por Diseño. [15/10] Antes solo si tenía
  // (o podía tomar) un trabajo: desde "Hechos" no se abría lo que hizo otro o TIZADA solo, ni se podía corregir el diseño.
  // Entrar no es poder editar: cada acción sigue pidiendo ser el diseñador del trabajo (salvo la corrección del diseño).
  if (!esVendedor(user)) {
    if (!(await esDisenador(pool, user))) throw fallo(403, 'No tenés permiso para ver esta solicitud.');
    if (!partes.some(p => p.Estado === 'ENVIADO_DISENO' || p.FechaEnvioDiseno || p.DisenadorID === user.id)) throw fallo(403, 'Esta solicitud no tiene nada enviado a Diseño.');
  }

  const productos = (await pool.request().input('Sol', sql.Int, solicitudId)
    .query('SELECT * FROM dbo.SolicitudesVendedorProductos WHERE SolicitudID = @Sol AND Activo = 1 ORDER BY Orden')).recordset;
  const archivos = (await pool.request().input('Sol', sql.Int, solicitudId).query(`
    SELECT a.*, u.Nombre AS UsuarioNombre,
           -- [19/10] unidad del artículo de la tela (1 = Cantidades): ver faltantesConversion › por mesa
           (SELECT TOP 1 ar.UniIdUnidad FROM dbo.Articulos ar WHERE a.CodArticulo IS NOT NULL AND LTRIM(RTRIM(ar.CodArticulo)) = LTRIM(RTRIM(a.CodArticulo))) AS TelaUniIdUnidad
    FROM dbo.SolicitudesVendedorArchivos a
    LEFT JOIN dbo.Usuarios u ON u.IdUsuario = a.UsuarioSube
    WHERE a.SolicitudID = @Sol AND a.UrlDrive <> 'Pendiente' ORDER BY a.FechaSubida`)).recordset;
  const eventos = (await pool.request().input('Sol', sql.Int, solicitudId)
    .query('SELECT * FROM dbo.SolicitudesVendedorEventos WHERE SolicitudID = @Sol ORDER BY Fecha DESC, EventoID DESC')).recordset;

  sol.Productos = productos.map(p => ({
    ...p, Datos: jsonObj(p.DatosJson),
    Partes: partes.filter(pa => pa.ProductoSolID === p.ProductoSolID).map(pa => ({ ...pa, Datos: jsonObj(pa.DatosJson), Nombre: NOMBRE_PARTE[pa.Tipo] })),
  }));
  sol.Archivos = archivos;
  sol.Eventos = eventos;
  // F1: producción principal, molde y medida fija del producto del catálogo (ProductoVentaConfig)
  const idsCat = sol.Productos.filter(p => p.TipoFabricacion === 'PRODUCTO_TERMINADO' && p.ProIdProducto).map(p => Number(p.ProIdProducto));
  const cfgPorId = new Map();
  if (idsCat.length) {
    try {
      const c = await pool.request().query(`
        SELECT ProIdProducto, TecnicaPrincipal, Molde, UM, AnchoM, AltoM, BordeCm,
               CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL THEN NULL ELSE TizadaProMoldeRef END AS TizadaProMoldeRef
        FROM dbo.ProductoVentaConfig WHERE COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicaPrincipal') IS NOT NULL AND ProIdProducto IN (${idsCat.join(',')})`);
      c.recordset.forEach(x => cfgPorId.set(x.ProIdProducto, x));
    } catch (e) { logger.warn(`[SOLICITUDES] config F1 de productos: ${e.message}`); }
    // [A MEDIDA] productos a medida de TIZADA (sin docs/migrations/configurador_a_medida.sql, ninguno)
    try {
      const am = await pool.request().query(`SELECT ProIdProducto FROM dbo.ProductoVentaConfig WHERE AMedidaJson IS NOT NULL AND ProIdProducto IN (${idsCat.join(',')})`);
      am.recordset.forEach(x => { const c = cfgPorId.get(x.ProIdProducto); if (c) c.AMedida = true; });
    } catch (_) { /* falta la columna */ }
  }
  // [15/10] La tarjeta del producto en la solicitud (como la Tienda): foto (la del catálogo o el dibujo de la ficha), código,
  // familia y precio de catálogo. Misma foto que el catálogo de la solicitud (routes/prendasOrdersRoutes productos-terminados).
  const catPorId = new Map();
  if (idsCat.length) {
    try {
      const r = await pool.request().query(`
        SELECT a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(sa.Articulo)) AS Categoria,
               pb.Precio, LTRIM(RTRIM(pb.Moneda)) AS Moneda, img.url_imagen AS Imagen, vc.CantidadMinima, vc.CantidadFija
        FROM dbo.Articulos a
        LEFT JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
        LEFT JOIN dbo.PreciosBase pb ON pb.ProIdProducto = a.ProIdProducto
        LEFT JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
        OUTER APPLY (SELECT TOP 1 url_imagen FROM (
                         SELECT i.url_imagen, i.orden FROM dbo.Articulos_Imagenes i WHERE i.Idproid = a.ProIdProducto
                         UNION ALL
                         SELECT f.DibujoUrl, 9999 FROM dbo.ProductoFichaDiseno f WHERE f.ProIdProducto = a.ProIdProducto AND f.DibujoUrl IS NOT NULL
                     ) x ORDER BY x.orden) img
        WHERE a.ProIdProducto IN (${idsCat.join(',')})`);
      r.recordset.forEach(x => catPorId.set(x.ProIdProducto, x));
    } catch (e) { logger.warn(`[SOLICITUDES] foto / precio de catálogo de productos: ${e.message}`); }
  }
  for (const p of sol.Productos) {
    const c = p.ProIdProducto ? cfgPorId.get(Number(p.ProIdProducto)) : null;
    p.Config = c ? { TecnicaPrincipal: c.TecnicaPrincipal || 'SB', Molde: c.Molde || 'OBLIGATORIO', UM: c.UM || 'u', AnchoM: c.AnchoM, AltoM: c.AltoM, BordeCm: c.BordeCm, TizadaProMoldeRef: c.TizadaProMoldeRef || null, AMedida: !!c.AMedida } : null;
    const k = p.ProIdProducto ? catPorId.get(Number(p.ProIdProducto)) : null;
    p.Catalogo = k ? { codigo: k.CodArticulo || null, familia: k.Categoria || null, foto: k.Imagen || null, precio: k.Precio != null ? Number(k.Precio) : null, moneda: k.Moneda || null,
                             minima: Number(k.CantidadMinima) || null, fija: Number(k.CantidadFija) || null } : null;   // paquete fijo / mínimo (guardarDatos)
    const nombreArea = { DIRECTA: 'impresión directa', ECOUV: 'gran formato', DF: 'DTF' }[p.Config?.TecnicaPrincipal];
    if (nombreArea) p.Partes.forEach(pa => { if (pa.Tipo === 'PRINCIPAL') pa.Nombre = `Producción principal (${nombreArea})`; });
  }
  // Ficha técnica del producto del catálogo (avíos, costuras, material, tallas, notas, dibujo): informativa para Diseño y para el PDF
  for (const p of sol.Productos) {
    p.FichaProducto = null;
    if (p.TipoFabricacion === 'PRODUCTO_TERMINADO' && p.ProIdProducto) {
      try { p.FichaProducto = await require('./solicitudesVendedorFichaProducto').fichaProducto(pool, p.ProIdProducto); }
      catch (e) { logger.warn(`[SOLICITUDES] ficha del producto ${p.ProIdProducto}: ${e.message}`); }
    }
  }
  // Tizadas de TizadaPro vinculadas (copia del resultado). Nunca tumba el detalle.
  try { sol.Tizadas = await require('./solicitudesVendedorTizadas').deSolicitud(pool, solicitudId); }
  catch (e) { sol.Tizadas = []; logger.warn(`[SOLICITUDES] no se pudieron leer las tizadas de la solicitud ${solicitudId}: ${e.message}`); }
  sol.Ficha = jsonObj(sol.FichaJson);
  sol.Presupuesto = null;
  if (sol.PreId) {
    try {
      const pre = await pool.request().input('Pre', sql.Int, sol.PreId)
        .query('SELECT PreId, PreNumero, ClienteNombre, Moneda, Total, Estado, FechaEmision FROM dbo.Presupuestos WHERE PreId = @Pre');
      sol.Presupuesto = pre.recordset[0] || null;
    } catch (e) { logger.warn(`[SOLICITUDES] no se pudo leer el presupuesto ${sol.PreId}: ${e.message}`); }
  }
  sol.Conversion = sol.Productos.map(p => {
    const faltantes = faltantesConversion(sol, p, archivos);
    // Checklist de ingreso a producción (rojo / verde / ámbar), con lo técnico de la conversión adentro del rojo
    const checklist = p.PedidoNoDocERP ? { listo: true, faltan: [], ok: [], luego: [] } : require('./solicitudesVendedorChecklist').evaluarProducto(sol, p, archivos, faltantes);
    return { ProductoSolID: p.ProductoSolID, faltantes: checklist.faltan, avisos: avisosConversion(p, archivos), checklist };
  });
  const estados = await require('./solicitudesVendedorConversion').estadosConversion(pool, sol);
  sol.Conversion.forEach(c => { c.pedido = estados[c.ProductoSolID] || null; });
  // Pedido ya creado: el diseño de Bordado / TPU sigue en PRODUCCIÓN. Se trae cómo va cada orden.
  for (const p of sol.Productos.filter(x => x.PedidoNoDocERP)) {
    try {
      const ordenes = await require('./solicitudesVendedorConversion').disenoProduccionDePedido(pool, p.PedidoNoDocERP);
      const c = sol.Conversion.find(x => x.ProductoSolID === p.ProductoSolID);
      if (c) c.disenoProduccion = ordenes;
    } catch (e) { logger.warn(`[SOLICITUDES] no se pudo leer el diseño en producción del pedido ${p.PedidoNoDocERP}: ${e.message}`); }
  }
  return sol;
}

// Sello de cada solicitud de la lista (como la franja verde / roja de la maqueta): se evalúa el
// checklist de cada producto no convertido con 3 consultas en lote, no una por fila.
async function sellarLista(pool, filas) {
  const abiertas = filas.filter(s => s.Estado !== 'CANCELADA');
  for (const s of filas) { s.Ficha = jsonObj(s.FichaJson); delete s.FichaJson; s.Listo = null; s.Faltan = 0; s.Unidades = 0; }
  if (!abiertas.length) return filas;
  const ids = abiertas.map(s => s.SolicitudID).join(',');
  // [19/10] PorMesa existe si se corrió docs/migrations/tizadapro_mesas_novedades_16oct.sql
  const conPorMesa = (await pool.request().query("SELECT COL_LENGTH('dbo.SolicitudesVendedorArchivos', 'PorMesa') AS c")).recordset[0].c != null;
  const [prods, partes, archs] = await Promise.all([
    // F1: Molde del producto del catálogo, para que el checklist de la lista no pida talles a los que van por unidad
    pool.request().query(`SELECT p.*, CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'Molde') IS NULL THEN NULL ELSE (SELECT vc.Molde FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS Molde FROM dbo.SolicitudesVendedorProductos p WHERE p.Activo = 1 AND p.SolicitudID IN (${ids})`),
    pool.request().query(`SELECT ParteID, SolicitudID, ProductoSolID, Tipo, Estado, DatosJson, CantidadTotal, PorPrenda, Modificada, DisenadorID FROM dbo.SolicitudesVendedorPartes WHERE Activo = 1 AND SolicitudID IN (${ids})`),
    pool.request().query(`SELECT a.ArchivoID, a.SolicitudID, a.ProductoSolID, a.ParteID, a.EventoID, a.Rol, a.Vigente, a.Material, a.NombreOriginal, a.Copias${conPorMesa ? ', a.PorMesa' : ''},
                                (SELECT TOP 1 ar.UniIdUnidad FROM dbo.Articulos ar WHERE a.CodArticulo IS NOT NULL AND LTRIM(RTRIM(ar.CodArticulo)) = LTRIM(RTRIM(a.CodArticulo))) AS TelaUniIdUnidad
                         FROM dbo.SolicitudesVendedorArchivos a WHERE a.Vigente = 1 AND a.UrlDrive <> 'Pendiente' AND a.SolicitudID IN (${ids})`),
  ]);
  const { evaluarProducto } = require('./solicitudesVendedorChecklist');
  for (const s of abiertas) {
    const productos = prods.recordset.filter(p => p.SolicitudID === s.SolicitudID).map(p => ({
      ...p, Datos: jsonObj(p.DatosJson),
      Partes: partes.recordset.filter(pa => pa.ProductoSolID === p.ProductoSolID).map(pa => ({ ...pa, Datos: jsonObj(pa.DatosJson) })),
    }));
    const archivos = archs.recordset.filter(a => a.SolicitudID === s.SolicitudID);
    const cab = { ...s, Productos: productos };
    let faltan = 0;
    for (const p of productos) {
      s.Unidades += Number(p.Cantidad) || 0;
      if (p.PedidoNoDocERP) continue;
      faltan += evaluarProducto(cab, p, archivos, faltantesConversion(cab, p, archivos)).faltan.length;
    }
    s.Faltan = faltan;
    s.Listo = faltan === 0;
  }
  return filas;
}

// ---------------------------------------------------------------------
// RN-SOL.27: antes de crear nada se valida todo, y se dice exactamente qué
// falta y en qué producto o servicio. (La creación del pedido es la F3.)
// ---------------------------------------------------------------------
const DISENO_EN_PRODUCCION = ['BORDADO', 'TPU'];

// Avisos que NO frenan la conversión: qué va a pasar en producción con lo que todavía no está diseñado.
function avisosConversion(p, archivos) {
  const out = [];
  for (const pa of p.Partes.filter(x => DISENO_EN_PRODUCCION.includes(x.Tipo))) {
    const tieneArchivo = archivos.some(a => a.Vigente && a.ParteID === pa.ParteID && ['DISENO_PRONTO', 'BOCETO', 'REFERENCIA'].includes(a.Rol));
    if (pa.Tipo === 'BORDADO') out.push(`Bordado: la orden nace esperando la matriz (ponchado). Se sube después desde la ficha de la orden en el área de Bordado y ahí se libera sola.${tieneArchivo ? ' Lo que adjuntaste acá viaja como logo / boceto de referencia.' : ' No adjuntaste ningún logo ni boceto de referencia.'}`);
    else out.push(`Estampado TPU: la orden nace en "falta diseño". El boceto, la aprobación del cliente y el arte se hacen después desde la ficha de la orden en el área de TPU.${tieneArchivo ? ' Lo que adjuntaste acá viaja como boceto de referencia.' : ' No adjuntaste ningún boceto de referencia.'}`);
  }
  return out;
}

function faltantesConversion(sol, p, archivos) {
  const f = [];
  if (sol.Estado === 'CANCELADA') return ['La solicitud está cancelada.'];
  if (p.PedidoNoDocERP) return [];
  if (!sol.ModoCobro) f.push('Falta el precio pactado de la solicitud (cómo se cobra).');
  else if (sol.ModoCobro === 'PRECIO_ESTABLECIDO' && !(Number(sol.PrecioPactado) > 0)) f.push('Falta el monto del precio establecido.');
  if (sol.RequiereSena && !sol.SenaConfirmada) f.push('La seña está sin confirmar (vía de entrada, monto y referencia del pago).');
  if (p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !p.ProIdProducto) f.push('Falta elegir el producto terminado.');
  if (!(p.Cantidad > 0)) f.push('Falta la cantidad de prendas.');
  // [15/10] Con TIZADA PRO la lista de jugadores (a medida: los diseños) dice cuántas van: tiene que dar la cantidad del producto
  const tzl = p.Datos?.tizadaPro;
  if (p.Config?.TizadaProMoldeRef && tzl && p.Cantidad > 0) {
    const am = !!p.Config.AMedida;
    const filas = am ? (tzl.disenos || []) : (tzl.planilla || []);
    const suma = am ? filas.reduce((t, d) => t + (Number(d.cantidad) > 0 ? Number(d.cantidad) : 0), 0)
      : filas.reduce((t, x) => t + (Number(x.cantidad) > 0 ? Number(x.cantidad) : 1), 0);
    if (filas.length && suma !== Number(p.Cantidad)) {
      f.push(`La lista de jugadores suma ${suma} ${am ? 'unidad(es)' : 'prenda(s)'} y el producto dice ${p.Cantidad}: corregí la cantidad (en la tarjeta del producto) o la lista.`);
    }
  }
  // P-14 sin resolver: el precio es UNO por solicitud y sale un pedido por producto.
  if (sol.ModoCobro === 'PRECIO_ESTABLECIDO' && p.TipoFabricacion === 'PERSONALIZADO' && sol.Productos.length > 1) f.push('Precio establecido con más de un producto: todavía no está definido cuánto del precio lleva cada pedido. Dejá un solo producto en la solicitud o cobrá "por cada área".');

  const corte = p.Datos?.corte || {};
  if (corte.activo) {
    if (!corte.tipoMolde) f.push('Corte: falta el tipo de molde.');
    if (!corte.origenTela) f.push('Corte: falta el origen de la tela.');
    // La tizada NO se pide acá: es el archivo de impresión de la sublimación, o sea el diseño pronto de la
    // producción principal (que ya es obligatorio). Corte trabaja por contraste sobre la tela ya sublimada.
    // La bobina de tela del cliente se elige en el momento de convertir: depende del stock de ese momento.
    if (corte.origenTela === 'TELA CLIENTE' && corte.tipoMolde === 'SUBLIMACION') f.push('Corte: con tela del cliente el molde no puede ser "SUBLIMACION".');
  }
  if (p.Datos?.costura?.activo && !corte.activo) f.push('Costura requiere Corte.');

  for (const pa of p.Partes) {
    const n = NOMBRE_PARTE[pa.Tipo];
    // Bordado y TPU se pueden convertir SIN diseño: en producción el ponchado / el arte se suben después desde
    // la ficha de la orden (Bordado espera en "Esperando requisitos: Matriz"; TPU sigue boceto → aprobación → arte).
    // La producción principal y el DTF sí lo exigen: su archivo define los metros que se imprimen y se cobran.
    const disenoOpcional = DISENO_EN_PRODUCCION.includes(pa.Tipo);
    if (!disenoOpcional && pa.Estado !== 'DISENADO') f.push(`${n}: todavía no está diseñado (${NOMBRE_ESTADO_PARTE[pa.Estado]}).`);
    else if (!disenoOpcional && !archivos.some(a => a.Vigente && a.ParteID === pa.ParteID && a.Rol === 'DISENO_PRONTO')) f.push(`${n}: no tiene archivo de diseño pronto vigente.`);
    if (pa.Modificada) f.push(`${n}: tiene un cambio que Diseño todavía no aceptó.`);
    if (pa.Tipo === 'PRINCIPAL') {
      archivos.filter(a => a.Vigente && a.ParteID === pa.ParteID && a.Rol === 'DISENO_PRONTO' && !a.Material)
        .forEach(a => f.push(`${n}: falta elegir la tela de "${a.NombreOriginal}" (la carga el diseñador).`));
      // [19/10] TIZADA "Copias": cada impresión trae PorMesa unidades. Si la tela se cobra por unidad (Cantidades), el cobro de
      // Sublimación por pieza suma las COPIAS (impresiones) y no las unidades: se frena. Producción no cambia (copias = impresiones).
      archivos.filter(a => a.Vigente && a.ParteID === pa.ParteID && a.Rol === 'DISENO_PRONTO' && Number(a.PorMesa) > 1 && Number(a.TelaUniIdUnidad) === 1)
        .forEach(a => f.push(`${n}: "${a.NombreOriginal}" trae ${a.PorMesa} unidades por impresión y su tela (${a.Material}) está cargada para cobrarse por unidad: se cobrarían ${a.Copias || 1} en vez de ${(a.Copias || 1) * Number(a.PorMesa)}. Pasá esa tela a metros en el artículo (o avisá a Sistemas) antes de convertir.`));
    }
    const d = pa.Datos || {};
    // [15/10] La cantidad total y las bajadas por prenda ya no frenan: salen de la lista de jugadores (cada objeto × las
    // prendas de su diseño) y, sin lista, la cantidad del producto y 1 por prenda (solicitudesVendedorConversion.armarPedido).
    // El tipo se elige por objeto en la tabla del arte (y queda en el servicio).
    const conTabla = !!p.Config?.TizadaProMoldeRef;
    if (pa.Tipo === 'BORDADO') {
      if (!d.variante) f.push(conTabla ? 'Bordado: falta el tipo de bordado (elegilo en la tabla del arte).' : 'Bordado: falta dónde se borda (sobre la prenda / parche adhesivo).');
      else if (!d.material) f.push(conTabla ? 'Bordado: falta el tipo de bordado (elegilo en la tabla del arte).' : 'Bordado: falta el tipo de bordado (100% hilo / con tafeta).');
    }
    if (pa.Tipo === 'DTF') {
      if (!d.material) f.push(conTabla ? 'Estampado DTF: falta el film (elegilo en la tabla del arte).' : 'Estampado DTF: falta el film / material.');
      // [TIPO POR OBJETO] Cada film que usan los objetos necesita su pliego (y no sobra ninguno). Sin tipo propio = el del servicio.
      const deLaParte = archivos.filter(a => a.Vigente && a.ParteID === pa.ParteID);
      const usados = new Set(deLaParte.filter(a => a.Rol === 'ARTE_CLIENTE').map(a => a.Material || d.material).filter(Boolean));
      const pliegos = deLaParte.filter(a => a.Rol === 'DISENO_PRONTO');
      const conPliego = new Set(pliegos.map(a => a.Material || d.material).filter(Boolean));
      if (pliegos.length && usados.size > 1) {
        [...usados].filter(m => !conPliego.has(m)).forEach(m => f.push(`Estampado DTF: hay objetos en "${m}" y ningún pliego con ese film (va un pliego por film).`));
        [...conPliego].filter(m => !usados.has(m)).forEach(m => f.push(`Estampado DTF: hay un pliego en "${m}" y ningún objeto usa ese film.`));
      }
    }
    if (pa.Tipo === 'TPU') {
      if (!d.variante) f.push('Estampado TPU: falta el tipo / variante.');
      if (!d.material) f.push('Estampado TPU: falta el artículo de TPU (tipo y tamaño del parche).');
      if (!d.origenPrendas) f.push('Estampado TPU: falta el origen de las prendas.');
    }
  }
  return f;
}

// ---------------------------------------------------------------------
// Catálogos del módulo
// ---------------------------------------------------------------------
async function listarVendedores(pool) {
  const r = await pool.request().query(`
    SELECT u.IdUsuario, LTRIM(RTRIM(u.Nombre)) AS Nombre, ro.NombreRol
    FROM dbo.Usuarios u JOIN dbo.Roles ro ON ro.IdRol = u.IdRol
    WHERE u.Activo = 1 AND ro.NombreRol IN ('VENTAS', 'Admin', 'Administracion', 'Coordinador', 'Atención al Cliente')
    ORDER BY CASE WHEN ro.NombreRol = 'VENTAS' THEN 0 ELSE 1 END, u.Nombre`);
  return r.recordset;
}

async function listarDisenadores(pool, user) {
  if (!esAdmin(user)) throw fallo(403, 'Solo un administrador define quiénes son diseñadores.');
  const r = await pool.request().query(`
    SELECT u.IdUsuario, LTRIM(RTRIM(u.Nombre)) AS Nombre, ro.NombreRol,
           CAST(CASE WHEN ro.NombreRol = N'Diseñador' THEN 1 ELSE 0 END AS bit) AS PorRol,
           CAST(CASE WHEN ro.NombreRol = N'Diseñador' OR (d.IdUsuario IS NOT NULL AND d.Activo = 1) THEN 1 ELSE 0 END AS bit) AS EsDisenador
    FROM dbo.Usuarios u
    LEFT JOIN dbo.Roles ro ON ro.IdRol = u.IdRol
    LEFT JOIN dbo.SolicitudesVendedorDisenadores d ON d.IdUsuario = u.IdUsuario
    WHERE u.Activo = 1 ORDER BY u.Nombre`);
  return r.recordset;
}

async function definirDisenador(pool, user, idUsuario, activo) {
  if (!esAdmin(user)) throw fallo(403, 'Solo un administrador define quiénes son diseñadores.');
  await pool.request().input('U', sql.Int, idUsuario).input('A', sql.Bit, activo ? 1 : 0).query(`
    IF EXISTS (SELECT 1 FROM dbo.SolicitudesVendedorDisenadores WHERE IdUsuario = @U)
      UPDATE dbo.SolicitudesVendedorDisenadores SET Activo = @A WHERE IdUsuario = @U;
    ELSE
      INSERT INTO dbo.SolicitudesVendedorDisenadores (IdUsuario, Activo) VALUES (@U, @A);`);
  return { ok: true };
}

async function miPerfil(pool, user) {
  return { esVendedor: esVendedor(user), esDisenador: await esDisenador(pool, user), esAdmin: esAdmin(user) };
}

// ---------------------------------------------------------------------
// Conversión a pedido de producción (spec §9) — services/solicitudesVendedorConversion.js
// ---------------------------------------------------------------------
const baseConversion = () => ({ cabecera, exigirAbierta, exigirVendedor, esAdmin, esVendedor, esDisenador, registrarEvento, recalcularEstado, obtener, enCorreccion });
const materialesPrincipal = (pool, areaId) => require('./solicitudesVendedorConversion').materialesPrincipal(pool, areaId);
const definirProduccionArchivo = (pool, user, solicitudId, archivoId, b) => require('./solicitudesVendedorConversion').definirProduccionArchivo(pool, user, baseConversion(), solicitudId, archivoId, b);
// Tizadas de TizadaPro (services/solicitudesVendedorTizadas.js)
const baseTizadas = () => ({ ...baseConversion(), parteConContexto, marcarModificada });
const tizadasTizadaPro = (pool, user, f) => require('./solicitudesVendedorTizadas').listarTrabajos(pool, user, baseTizadas(), f);
// Piezas, telas y arte de la sublimación (services/solicitudesVendedorSublimacion.js)
const moldeDelProducto = (pool, user, solicitudId, productoSolId) => require('./solicitudesVendedorSublimacion').moldeDelProducto(pool, user, baseTizadas(), solicitudId, productoSolId);
const guardarSublimacion = (pool, user, solicitudId, productoSolId, b) => require('./solicitudesVendedorSublimacion').guardarSublimacion(pool, user, baseTizadas(), solicitudId, productoSolId, b);
const guardarTalles = (pool, user, solicitudId, productoSolId, b) => require('./solicitudesVendedorSublimacion').guardarTalles(pool, user, baseTizadas(), solicitudId, productoSolId, b);
const vincularTizada = (pool, user, parteId, b) => require('./solicitudesVendedorTizadas').vincular(pool, user, baseTizadas(), parteId, b);
// TIZADA PRO por API: diseños + lista de talles → pedido a TIZADA → vuelve la tizada (services/solicitudesVendedorTizadaPro.js)
const baseTizadaPro = () => ({ ...baseTizadas(), cambiarEstadoParte, enCorreccion });
const tizadaProVer = (pool, user, solicitudId, productoSolId) => require('./solicitudesVendedorTizadaPro').ver(pool, user, baseTizadaPro(), solicitudId, productoSolId);
const tizadaProEditables = (pool, user, solicitudId, productoSolId, b) => require('./solicitudesVendedorTizadaPro').leerEditables(pool, user, baseTizadaPro(), solicitudId, productoSolId, b && b.arteArchivoId);
const piezasDelArte = (pool, user, solicitudId, archivoId) => require('./solicitudesVendedorTizadaPro').piezasDelArte(pool, user, baseTizadaPro(), solicitudId, archivoId);
const tizadaProGuardar = (pool, user, solicitudId, productoSolId, b) => require('./solicitudesVendedorTizadaPro').guardar(pool, user, baseTizadaPro(), solicitudId, productoSolId, b);
// [A MEDIDA] cuentas en vivo de la medida de un diseño + plantilla con la medida para el diseñador
const tizadaProCalcular = (pool, user, solicitudId, productoSolId, b) => require('./solicitudesVendedorTizadaPro').calcularMedida(pool, user, baseTizadaPro(), solicitudId, productoSolId, b);
const tizadaProArteVista = (pool, user, solicitudId, productoSolId, archivoId) => require('./solicitudesVendedorTizadaPro').vistaArte(pool, user, baseTizadaPro(), solicitudId, productoSolId, archivoId);
const tizadaProPlantillaPedir = (pool, user, solicitudId, productoSolId) => require('./solicitudesVendedorTizadaPro').pedirPlantilla(pool, user, baseTizadaPro(), solicitudId, productoSolId);
const tizadaProPlantillaEstado = (pool, user, solicitudId, productoSolId) => require('./solicitudesVendedorTizadaPro').estadoPlantilla(pool, user, baseTizadaPro(), solicitudId, productoSolId);
const tizadaProPlantillaBajar = (pool, user, solicitudId, productoSolId, nombre) => require('./solicitudesVendedorTizadaPro').bajarPlantilla(pool, user, baseTizadaPro(), solicitudId, productoSolId, nombre);
const tizadaProEnviar = (pool, user, solicitudId, productoSolId, b) => require('./solicitudesVendedorTizadaPro').enviar(pool, user, baseTizadaPro(), solicitudId, productoSolId, b);
// [CORREGIR EL DISEÑO 15/10] corregir el diseño de un producto que ya es pedido (services/solicitudesVendedorCorreccion.js)
const baseCorreccion = () => ({ esDisenador, registrarEvento });
const correccionAbrir = (pool, user, solicitudId, productoSolId, b) => require('./solicitudesVendedorCorreccion').abrir(pool, user, baseCorreccion(), solicitudId, productoSolId, b);
const correccionCancelar = (pool, user, solicitudId, productoSolId) => require('./solicitudesVendedorCorreccion').cancelar(pool, user, baseCorreccion(), solicitudId, productoSolId);
const correccionPlan = (pool, user, solicitudId, productoSolId) => require('./solicitudesVendedorCorreccion').plan(pool, user, baseCorreccion(), solicitudId, productoSolId);
const correccionAplicar = (pool, user, solicitudId, productoSolId, app) => require('./solicitudesVendedorCorreccion').aplicar(pool, user, baseCorreccion(), solicitudId, productoSolId, app);
// [23/10/2026] Tiempos de Diseño y fallas por diseño: los puntos de la bonificación (services/solicitudesVendedorPuntosDiseno.js)
const basePuntos = () => ({ esDisenador, registrarEvento, esAdmin, esVendedor });
const puntosDiseno = (pool, user, q) => require('./solicitudesVendedorPuntosDiseno').puntos(pool, user, basePuntos(), q);
const marcarFallaDiseno = (pool, user, parteId, b) => require('./solicitudesVendedorPuntosDiseno').marcarFalla(pool, user, basePuntos(), parteId, b);
const anularFallaDiseno = (pool, user, eventoId, b) => require('./solicitudesVendedorPuntosDiseno').anularFalla(pool, user, basePuntos(), eventoId, b);
async function tizadaProActualizar(pool, user, solicitudId, envioId, b) {
  if (!esVendedor(user) && !(await esDisenador(pool, user))) throw fallo(403, 'Esto lo hace el vendedor o un diseñador habilitado.');
  const r = await pool.request().input('E', sql.Int, envioId).input('S', sql.Int, solicitudId).query("SELECT EnvioID FROM dbo.TizadaProEnvios WHERE EnvioID = @E AND Origen = 'SOLICITUD' AND OrigenID = @S");
  if (!r.recordset.length) throw fallo(404, 'Ese envío a TIZADA PRO no es de esta solicitud.');
  const tz = require('./solicitudesVendedorTizadaPro');
  return b?.reintentar ? tz.reintentarAplicar(pool, envioId) : tz.actualizar(pool, envioId);
}
const convertir = (pool, user, solicitudId, productoSolId, b, app) => require('./solicitudesVendedorConversion').convertir(pool, user, baseConversion(), solicitudId, productoSolId, b, app);
// ¿Se llega a la fecha de entrega? Recorre los sectores sobre la cola real de cada uno (solo lectura).
async function estimarPlazo(pool, user, solicitudId) {
  const sol = await obtener(pool, user, solicitudId);
  return require('./solicitudesVendedorPlazo').estimarPlazo(sol);
}

// Calendario: entregas comprometidas con el cliente (solicitudes) y, para las ya convertidas, la fecha
// prometida de cada orden en su sector (trabajo planificado). Solo lectura.
async function calendario(pool, user, f) {
  exigirVendedor(user);
  const desde = String(f.desde || '').slice(0, 10), hasta = String(f.hasta || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw fallo(400, 'Falta el rango de fechas (desde / hasta).');
  const conFicha = await tieneFicha(pool);
  const entregas = conFicha ? (await pool.request().input('D', sql.Date, desde).input('H', sql.Date, hasta).query(`
    SELECT s.SolicitudID, s.NombreTrabajo, s.Estado, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre, u.Nombre AS VendedorNombre,
           CONVERT(varchar(10), s.FechaEntrega, 23) AS FechaEntrega, CONVERT(varchar(10), s.FechaEntregaHasta, 23) AS FechaEntregaHasta,
           (SELECT SUM(p.Cantidad) FROM dbo.SolicitudesVendedorProductos p WHERE p.SolicitudID = s.SolicitudID AND p.Activo = 1) AS Unidades,
           (SELECT COUNT(*) FROM dbo.SolicitudesVendedorProductos p WHERE p.SolicitudID = s.SolicitudID AND p.Activo = 1 AND p.PedidoNoDocERP IS NOT NULL) AS Convertidos,
           (SELECT COUNT(*) FROM dbo.SolicitudesVendedorProductos p WHERE p.SolicitudID = s.SolicitudID AND p.Activo = 1) AS Productos
    FROM dbo.SolicitudesVendedor s
    LEFT JOIN dbo.Clientes c ON c.CodCliente = s.CodCliente
    LEFT JOIN dbo.Usuarios u ON u.IdUsuario = s.VendedorID
    WHERE s.Estado <> 'CANCELADA' AND s.FechaEntrega IS NOT NULL
      AND s.FechaEntrega <= @H AND ISNULL(s.FechaEntregaHasta, s.FechaEntrega) >= @D
    ORDER BY s.FechaEntrega`)).recordset : [];
  // Trabajo planificado: órdenes de los pedidos que salieron de una solicitud, por su fecha prometida
  const trabajo = (await pool.request().input('D', sql.Date, desde).input('H', sql.Date, hasta).query(`
    SELECT p.SolicitudID, s.NombreTrabajo, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre, o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden, LTRIM(RTRIM(o.AreaID)) AS AreaID,
           o.Estado, o.EstadoenArea, CONVERT(varchar(10), ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega), 23) AS Fecha
    FROM dbo.SolicitudesVendedorProductos p
    JOIN dbo.SolicitudesVendedor s ON s.SolicitudID = p.SolicitudID
    LEFT JOIN dbo.Clientes c ON c.CodCliente = s.CodCliente
    JOIN dbo.Ordenes o ON LTRIM(RTRIM(CAST(o.NoDocERP AS varchar(50)))) = CAST(p.PedidoNoDocERP AS varchar(50))
    WHERE p.Activo = 1 AND p.PedidoNoDocERP IS NOT NULL AND o.AreaID <> 'PRO' AND ISNULL(o.Estado, '') <> 'Cancelado'
      AND ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega) BETWEEN @D AND @H
    ORDER BY Fecha, o.OrdenID`)).recordset;
  // Sin fecha de entrega: es un requisito pendiente, se listan aparte (como en la maqueta)
  const sinFecha = conFicha ? (await pool.request().query(`
    SELECT s.SolicitudID, s.NombreTrabajo, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre
    FROM dbo.SolicitudesVendedor s LEFT JOIN dbo.Clientes c ON c.CodCliente = s.CodCliente
    WHERE s.Estado IN ('INGRESADA', 'EN_DISENO') AND s.FechaEntrega IS NULL ORDER BY s.FechaSolicitud DESC`)).recordset : [];
  return { desde, hasta, entregas, trabajo, sinFecha };
}

const disenosEnProduccion = (pool, user) => require('./solicitudesVendedorConversion').disenosEnProduccion(pool, user, baseConversion());
const bobinasDelCliente = (pool, user, solicitudId) => require('./solicitudesVendedorConversion').bobinasDelCliente(pool, user, baseConversion(), solicitudId);
const reintentarArchivos = (pool, user, solicitudId, productoSolId, app) => require('./solicitudesVendedorConversion').reintentarArchivos(pool, user, baseConversion(), solicitudId, productoSolId, app);
// Recuperar los archivos de un pedido ya creado (tizada rehecha → órdenes que los esperaban; services/solicitudesVendedorRecuperar.js)
const recuperarArchivos = (pool, user, solicitudId, productoSolId, app) => require('./solicitudesVendedorRecuperar').recuperar(pool, user, baseConversion(), solicitudId, productoSolId, app);

// [TIPO DEL EXTRA 14/10] Cómo se puede hacer cada bordado / DTF / TPU (la misma lista que ve el cliente en la Tienda,
// pedidoPortalService.formasDeExtras), para elegir el tipo de CADA objeto en la tabla del arte (15/10: se guarda en el
// diseño de TIZADA, solicitudesVendedorTizadaPro.sincronizarFormas). Cada forma trae su variante y su material.
// Devuelve { formas: { BORDADO: [...], DTF: [...], TPU: [...] }, extras: los que admite el producto (con cobro y si va incluido) }.
async function formasDeExtras(pool, user, solicitudId, productoSolId) {
  if (!esVendedor(user) && !(await esDisenador(pool, user))) throw fallo(403, 'No tenés permiso para ver esta solicitud.');
  const p = (await pool.request().input('S', sql.Int, solicitudId).input('P', sql.Int, productoSolId)
    .query('SELECT ProIdProducto FROM dbo.SolicitudesVendedorProductos WHERE ProductoSolID = @P AND SolicitudID = @S AND Activo = 1')).recordset[0];
  if (!p) throw fallo(404, 'El producto no existe en esta solicitud.');
  if (!p.ProIdProducto) return { formas: {}, extras: [] };
  const portal = require('./pedidoPortalService');
  const [formas, extras] = await Promise.all([portal.formasDeExtras(pool, p.ProIdProducto), portal.extrasDelProducto(pool, p.ProIdProducto)]);
  return { formas, extras: extras.map(e => ({ tipo: e.tipo, nombre: e.nombre, cobro: e.cobro, obligatorio: e.obligatorio })) };
}

// [GUARDADO AUTOMÁTICO 15/10] La solicitud del vendedor ya no tiene "Guardar": cada dato se guarda solo al dejar el campo.
// Llega UN dato (cliente, nombre del trabajo, detalle, fechas o la cantidad de un producto) y se escribe SOLO esa columna,
// en su transacción: no se pasa por actualizar con el cuerpo entero, que podría pisar lo que la tabla del arte de TIZADA
// PRO guarda sola al mismo tiempo (DatosJson). Mismas reglas y mensajes que el formulario, mismo historial (EDICION) y la
// misma marca "Modificada" para Diseño cuando cambia la cantidad de un producto que ya está en Diseño.
// b: { CodCliente?, NombreTrabajo?, Detalle?, FechaEntrega?, FechaEntregaHasta?, Productos?: [{ ProductoSolID, Cantidad }] }
async function guardarDatos(pool, user, solicitudId, b) {
  exigirVendedor(user);
  const conFicha = await tieneFicha(pool);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const sol = await cabecera(transaction, solicitudId);
    exigirAbierta(sol);
    const cambios = [];

    // Cabecera: solo lo que llegó
    const fechaBD = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
    const fecha = (v) => { const s = String(v || '').trim().slice(0, 10); if (!s) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw fallo(400, 'La fecha no es válida.'); return s; };
    const antes = { CodCliente: sol.CodCliente, NombreTrabajo: sol.NombreTrabajo, Detalle: sol.Detalle, FechaEntrega: fechaBD(sol.FechaEntrega), FechaEntregaHasta: fechaBD(sol.FechaEntregaHasta) };
    const ahora = { ...antes };
    if (b.CodCliente !== undefined) {
      ahora.CodCliente = entero(b.CodCliente);
      if (!ahora.CodCliente) throw fallo(400, 'Elegí el cliente de la solicitud.');
      const cli = await new sql.Request(transaction).input('Cod', sql.Int, ahora.CodCliente).query('SELECT 1 AS ok FROM dbo.Clientes WHERE CodCliente = @Cod');
      if (!cli.recordset.length) throw fallo(400, 'El cliente elegido no existe.');
    }
    if (b.NombreTrabajo !== undefined) { ahora.NombreTrabajo = txt(b.NombreTrabajo, 200); if (!ahora.NombreTrabajo) throw fallo(400, 'Ingresá el nombre del trabajo.'); }
    if (b.Detalle !== undefined) { ahora.Detalle = txt(b.Detalle); if (!ahora.Detalle) throw fallo(400, 'Escribí el detalle de la solicitud (qué pide el cliente).'); }
    if (conFicha && b.FechaEntrega !== undefined) ahora.FechaEntrega = fecha(b.FechaEntrega);
    if (conFicha && b.FechaEntregaHasta !== undefined) ahora.FechaEntregaHasta = fecha(b.FechaEntregaHasta);
    if (ahora.FechaEntrega && ahora.FechaEntregaHasta && ahora.FechaEntregaHasta < ahora.FechaEntrega) throw fallo(400, 'La fecha "hasta" no puede ser anterior a la fecha que necesita el cliente.');
    const difCab = diferencias([['CodCliente', 'Cliente'], ['NombreTrabajo', 'Nombre del trabajo'], ['Detalle', 'Detalle'], ['FechaEntrega', 'Fecha de entrega'], ['FechaEntregaHasta', 'Fecha de entrega (hasta)']], antes, ahora);
    if (difCab.length) {
      await new sql.Request(transaction)
        .input('Sol', sql.Int, solicitudId).input('Cod', sql.Int, ahora.CodCliente).input('Nom', sql.NVarChar(200), ahora.NombreTrabajo)
        .input('Det', sql.NVarChar(sql.MAX), ahora.Detalle).input('FE', sql.Date, ahora.FechaEntrega).input('FEH', sql.Date, ahora.FechaEntregaHasta).input('U', sql.Int, user.id)
        .query(`UPDATE dbo.SolicitudesVendedor SET CodCliente = @Cod, NombreTrabajo = @Nom, Detalle = @Det,
                       ${conFicha ? 'FechaEntrega = @FE, FechaEntregaHasta = @FEH,' : ''} UsuarioModif = @U, FechaModif = GETDATE()
                 WHERE SolicitudID = @Sol`);
      cambios.push(...difCab);
    }

    // Cantidad de un producto (las mismas reglas del producto que el formulario: paquete fijo / mínimo)
    for (const x of (Array.isArray(b.Productos) ? b.Productos : [])) {
      if (x.Cantidad === undefined) continue;
      const p = (await new sql.Request(transaction).input('P', sql.Int, entero(x.ProductoSolID)).input('S', sql.Int, solicitudId)
        .query('SELECT ProductoSolID, Orden, ProIdProducto, Cantidad, PedidoNoDocERP FROM dbo.SolicitudesVendedorProductos WHERE ProductoSolID = @P AND SolicitudID = @S AND Activo = 1')).recordset[0];
      if (!p) throw fallo(404, 'El producto no existe en esta solicitud.');
      if (p.PedidoNoDocERP) throw fallo(409, `Este producto ya se convirtió en el pedido ${p.PedidoNoDocERP}: no se puede editar desde la solicitud.`);
      const cant = entero(x.Cantidad);
      if (!cant || cant <= 0) throw fallo(400, 'La cantidad tiene que ser 1 o más.');
      if (cant === Number(p.Cantidad)) continue;
      if (p.ProIdProducto) {
        const cfg = (await new sql.Request(transaction).input('Pro', sql.Int, p.ProIdProducto)
          .query('SELECT CantidadMinima, CantidadFija FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @Pro')).recordset[0] || {};
        const fija = Number(cfg.CantidadFija) || 0, min = Number(cfg.CantidadMinima) || 0;
        if (fija && cant % fija !== 0) throw fallo(400, `Se vende en paquetes de ${fija}: poné un múltiplo de ${fija}.`);
        if (!fija && min && cant < min) throw fallo(400, `El mínimo de este producto es ${min} unidades.`);
      }
      await new sql.Request(transaction).input('P', sql.Int, p.ProductoSolID).input('C', sql.Int, cant)
        .query('UPDATE dbo.SolicitudesVendedorProductos SET Cantidad = @C WHERE ProductoSolID = @P');
      const difProd = `Cantidad de prendas: ${p.Cantidad} → ${cant}`;
      const partes = (await new sql.Request(transaction).input('P', sql.Int, p.ProductoSolID)
        .query('SELECT ParteID, Tipo, CantidadTotal, Estado, DisenadorID FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Activo = 1')).recordset;
      for (const pa of partes) {
        // los extras que tenían la cantidad del producto (la que pone el formulario si queda vacía) siguen a la nueva
        const sigue = pa.Tipo !== 'PRINCIPAL' && (pa.CantidadTotal == null || Number(pa.CantidadTotal) === Number(p.Cantidad));
        if (sigue) await new sql.Request(transaction).input('Id', sql.Int, pa.ParteID).input('C', sql.Int, cant).query('UPDATE dbo.SolicitudesVendedorPartes SET CantidadTotal = @C WHERE ParteID = @Id');
        // como actualizar: se avisa a Diseño, salvo lo que no pasó por Diseño (arte listo del cliente, sin diseñador)
        const sinPasarPorDiseno = pa.Estado === 'DISENADO' && !pa.DisenadorID;
        if (pa.Estado !== 'INGRESADO' && !sinPasarPorDiseno) {
          await marcarModificada(transaction, user, pa.ParteID, [...(sigue ? [`Cantidad total: ${ver(pa.CantidadTotal)} → ${cant}`] : []), `Producto: ${difProd}`].join('; '));
        }
      }
      cambios.push(`Producto ${p.Orden}: ${difProd}`);
    }

    if (cambios.length) await registrarEvento(transaction, user, { solicitudId, tipo: 'EDICION', texto: cambios.join('\n') });
    await transaction.commit();
    return { SolicitudID: solicitudId, cambios: cambios.length };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.guardarDatos ${solicitudId}`);
    throw err;
  }
}

// [FASE 1 · 15/10] Sin "Servicios y extras" en el formulario (productos con TIZADA PRO): el bordado / DTF / TPU se agrega
// desde la tabla del arte al usarlo y se quita cuando ningún objeto lo usa, como en la Tienda (pedidoPortalService.cambiarExtra).
// Se arma el cuerpo con lo que hay y se cambia lo justo con actualizar (copia de pedidoPortalService.actualizarSolicitud).
// Solo los que admite el producto (Configurar productos › Técnicas). Quitar: solo uno opcional, en Ingresado y sin archivos
// subidos aparte (si no, { quitado: false, motivo }: no es un error, el extra queda).
const fechaTxt = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
async function cambiarExtra(pool, user, solicitudId, productoSolId, tipo, b) {
  exigirVendedor(user);
  const T = String(tipo || '').toUpperCase();
  if (!['BORDADO', 'DTF', 'TPU'].includes(T)) throw fallo(400, 'Solo se agrega bordado, DTF o TPU.');
  const activo = b?.activo !== false;
  const sol = await obtener(pool, user, solicitudId);
  exigirAbierta(sol);
  const p = sol.Productos.find(x => x.ProductoSolID === productoSolId);
  if (!p) throw fallo(404, 'El producto no existe en esta solicitud.');
  if (p.PedidoNoDocERP) throw fallo(409, `Este producto ya se convirtió en el pedido ${p.PedidoNoDocERP}.`);
  const previa = p.Partes.find(x => x.Tipo === T);
  if (activo) {
    if (previa) return { ParteID: previa.ParteID };
    const e = p.ProIdProducto ? (await require('./pedidoPortalService').extrasDelProducto(pool, p.ProIdProducto)).find(x => x.tipo === T) : null;
    if (!e) throw fallo(400, `Este producto no lleva ${NOMBRE_PARTE[T]} (se habilita en Configurar productos › Técnicas).`);
  } else {
    if (!previa) return { quitado: false };
    if (previa.IncluidoEnProducto) return { quitado: false, motivo: `${NOMBRE_PARTE[T]} viene incluido en el producto.` };
    if (previa.Estado !== 'INGRESADO') return { quitado: false, motivo: `${NOMBRE_PARTE[T]} ya está en Diseño.` };
    if (sol.Archivos.some(a => a.Vigente && a.ParteID === previa.ParteID && !/^EDITABLE_/i.test(a.NombreOriginal || ''))) return { quitado: false, motivo: `${NOMBRE_PARTE[T]} tiene archivos subidos.` };
  }
  const body = {
    CodCliente: sol.CodCliente, NombreTrabajo: sol.NombreTrabajo, Detalle: sol.Detalle, Observaciones: sol.Observaciones, PreId: sol.PreId,
    FechaEntrega: fechaTxt(sol.FechaEntrega), FechaEntregaHasta: fechaTxt(sol.FechaEntregaHasta), Ficha: sol.Ficha || {},
    Productos: sol.Productos.map(x => ({
      ProductoSolID: x.ProductoSolID, TipoFabricacion: x.TipoFabricacion, ProIdProducto: x.ProIdProducto, ProductoNombre: x.ProductoNombre,
      Cantidad: x.Cantidad, Observaciones: x.Observaciones, Datos: x.Datos,
      Partes: x.Partes.map(pa => ({ ParteID: pa.ParteID, Tipo: pa.Tipo, IncluidoEnProducto: pa.IncluidoEnProducto, CantidadTotal: pa.CantidadTotal, PorPrenda: pa.PorPrenda,
        Ubicacion: pa.Ubicacion, ArteOrigen: pa.ArteOrigen, Datos: pa.Datos, Observaciones: pa.Observaciones })),
    })),
  };
  const bp = body.Productos.find(x => x.ProductoSolID === productoSolId);
  if (activo) {
    // como el formulario (alternarServicio): la cantidad del producto, 1 por prenda; DTF textil y TPU con prendas de stock
    bp.Partes.push({ Tipo: T, IncluidoEnProducto: false, CantidadTotal: p.Cantidad, PorPrenda: 1, Ubicacion: null, ArteOrigen: 'EMPRESA', Observaciones: null,
      Datos: T === 'DTF' ? { variante: 'DTF Textil' } : T === 'TPU' ? { origenPrendas: 'Stock User' } : {} });
  } else bp.Partes = bp.Partes.filter(x => x.Tipo !== T);
  await actualizar(pool, user, solicitudId, body);
  if (!activo) return { quitado: true };
  const nueva = (await pool.request().input('P', sql.Int, productoSolId).input('T', sql.VarChar(12), T)
    .query('SELECT TOP 1 ParteID FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Tipo = @T AND Activo = 1 ORDER BY ParteID DESC')).recordset[0];
  return { ParteID: nueva?.ParteID || null };
}

module.exports = {
  formasDeExtras, cambiarExtra, guardarDatos, disenosHechos, correccionAbrir, correccionCancelar, correccionPlan, correccionAplicar,
  puntosDiseno, marcarFallaDiseno, anularFallaDiseno,
  tizadaProVer, tizadaProEditables, piezasDelArte, tizadaProGuardar, tizadaProCalcular, tizadaProArteVista, tizadaProPlantillaPedir, tizadaProPlantillaEstado, tizadaProPlantillaBajar, tizadaProEnviar, tizadaProActualizar, _baseTizadaPro: () => baseTizadaPro(),
  materialesPrincipal, definirProduccionArchivo, tizadasTizadaPro, vincularTizada, moldeDelProducto, guardarSublimacion, guardarTalles, convertir, reintentarArchivos, recuperarArchivos, bobinasDelCliente, disenosEnProduccion, estimarPlazo, calendario,
  crear, actualizar, listar, obtener, guardarPrecio, confirmarSena, agregarInteraccion,
  enviarADiseno, bandeja, portalDiseno, cancelarDelPortal, buscarDiseno, tomarParte, aceptarCambio, subirArchivo, quitarArchivo, cancelar,
  listarVendedores, listarDisenadores, definirDisenador, miPerfil,
};
