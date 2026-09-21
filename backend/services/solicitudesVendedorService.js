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
const ROLES_ARCHIVO = ['ARTE_CLIENTE', 'REFERENCIA', 'BOCETO', 'PLANILLA', 'TIZADA', 'DISENO_PRONTO'];
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
  return { CodCliente: codCliente, NombreTrabajo: nombre, Detalle: detalle, Observaciones: txt(b.Observaciones), VendedorID: entero(b.VendedorID) || user.id, PreId: entero(b.PreId), PreNumero: null };
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

  const cli = await pool.request().input('Cod', sql.Int, cab.CodCliente).query('SELECT 1 AS ok FROM dbo.Clientes WHERE CodCliente = @Cod');
  if (!cli.recordset.length) throw fallo(400, 'El cliente elegido no existe.');
  await resolverPresupuesto(pool, cab);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const ins = await new sql.Request(transaction)
      .input('Cod', sql.Int, cab.CodCliente).input('Nom', sql.NVarChar(200), cab.NombreTrabajo)
      .input('Ven', sql.Int, cab.VendedorID).input('Det', sql.NVarChar(sql.MAX), cab.Detalle)
      .input('Obs', sql.NVarChar(sql.MAX), cab.Observaciones).input('U', sql.Int, user.id)
      .input('Pre', sql.Int, cab.PreId).input('PreNum', sql.VarChar(20), cab.PreNumero)
      .query(`INSERT INTO dbo.SolicitudesVendedor (CodCliente, NombreTrabajo, VendedorID, Detalle, Observaciones, PreId, PreNumero, UsuarioAlta)
              OUTPUT INSERTED.SolicitudID
              VALUES (@Cod, @Nom, @Ven, @Det, @Obs, @Pre, @PreNum, @U)`);
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
    await resolverPresupuesto(transaction, cab);

    const prodsBD = (await new sql.Request(transaction).input('Sol', sql.Int, solicitudId)
      .query('SELECT * FROM dbo.SolicitudesVendedorProductos WHERE SolicitudID = @Sol AND Activo = 1')).recordset;
    const partesBD = (await new sql.Request(transaction).input('Sol', sql.Int, solicitudId)
      .query('SELECT * FROM dbo.SolicitudesVendedorPartes WHERE SolicitudID = @Sol AND Activo = 1')).recordset;
    const cambios = [];

    // Cabecera
    const difCab = diferencias([['CodCliente', 'Cliente'], ['NombreTrabajo', 'Nombre del trabajo'], ['VendedorID', 'Vendedor'], ['Detalle', 'Detalle'], ['Observaciones', 'Observaciones'], ['PreNumero', 'Presupuesto asociado']], sol, cab);
    if (difCab.length) {
      await new sql.Request(transaction)
        .input('Sol', sql.Int, solicitudId).input('Cod', sql.Int, cab.CodCliente).input('Nom', sql.NVarChar(200), cab.NombreTrabajo)
        .input('Ven', sql.Int, cab.VendedorID).input('Det', sql.NVarChar(sql.MAX), cab.Detalle)
        .input('Obs', sql.NVarChar(sql.MAX), cab.Observaciones).input('U', sql.Int, user.id)
        .input('Pre', sql.Int, cab.PreId).input('PreNum', sql.VarChar(20), cab.PreNumero)
        .query(`UPDATE dbo.SolicitudesVendedor SET CodCliente = @Cod, NombreTrabajo = @Nom, VendedorID = @Ven, Detalle = @Det,
                       Observaciones = @Obs, PreId = @Pre, PreNumero = @PreNum, UsuarioModif = @U, FechaModif = GETDATE() WHERE SolicitudID = @Sol`);
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
      texto: `${sol.SenaConfirmada ? 'Seña corregida' : 'Seña confirmada'}: ${monto.toFixed(2)} por ${via}, referencia ${ref}. (Dato de la solicitud: el saldo lo ingresan Administración y Caja.)`,
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
async function parteConContexto(cx, parteId) {
  const r = await new sql.Request(cx).input('P', sql.Int, parteId).query(`
    SELECT pa.*, s.Estado AS SolEstado, p.PedidoNoDocERP, p.Activo AS ProdActivo
    FROM dbo.SolicitudesVendedorPartes pa
    JOIN dbo.SolicitudesVendedor s          ON s.SolicitudID = pa.SolicitudID
    JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID
    WHERE pa.ParteID = @P`);
  const pa = r.recordset[0];
  if (!pa || !pa.Activo || !pa.ProdActivo) throw fallo(404, 'El servicio no existe o fue quitado de la solicitud.');
  if (pa.SolEstado === 'CANCELADA') throw fallo(409, 'La solicitud está cancelada.');
  if (pa.PedidoNoDocERP) throw fallo(409, 'Este producto ya se convirtió en pedido.');
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
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const pa = await parteConContexto(transaction, parteId);
    if (pa.Estado !== 'INGRESADO') throw fallo(409, `${NOMBRE_PARTE[pa.Tipo]} ya está en Diseño (${NOMBRE_ESTADO_PARTE[pa.Estado]}).`);
    await new sql.Request(transaction).input('P', sql.Int, parteId).input('TT', sql.VarChar(12), tipoTrabajo)
      .query('UPDATE dbo.SolicitudesVendedorPartes SET TipoTrabajo = @TT, FechaEnvioDiseno = GETDATE() WHERE ParteID = @P');
    await cambiarEstadoParte(transaction, user, pa, 'ENVIADO_DISENO', 'UsuarioEnvioDiseno = @U',
      tipoTrabajo === 'REVISAR' ? 'para revisar el arte del cliente' : 'para diseñar desde cero');
    await transaction.commit();
    return { ok: true };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.enviarADiseno parte ${parteId}`);
    throw err;
  }
}

const SQL_BANDEJA = `
  SELECT pa.ParteID, pa.SolicitudID, pa.ProductoSolID, pa.Tipo, pa.Estado, pa.TipoTrabajo, pa.CantidadTotal, pa.PorPrenda, pa.Ubicacion,
         pa.ArteOrigen, pa.Observaciones, pa.DisenadorID, pa.FechaEnvioDiseno, pa.FechaInicioDiseno, pa.FechaDisenado,
         pa.Modificada, pa.ModificadaDetalle, pa.ModificadaFecha,
         s.NombreTrabajo, s.CodCliente, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre,
         p.ProductoNombre, p.TipoFabricacion, p.Cantidad AS CantidadPrendas,
         uv.Nombre AS VendedorNombre, ud.Nombre AS DisenadorNombre
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
  const disponibles = (await pool.request().query(`${SQL_BANDEJA} AND pa.Estado = 'ENVIADO_DISENO' ORDER BY pa.FechaEnvioDiseno ASC`)).recordset;
  const mias = (await pool.request().input('U', sql.Int, user.id)
    .query(`${SQL_BANDEJA} AND pa.DisenadorID = @U AND pa.Estado IN ('DISENO_INICIADO','DISENADO')
            ORDER BY CASE WHEN pa.Estado = 'DISENO_INICIADO' THEN 0 ELSE 1 END, pa.Modificada DESC, pa.FechaInicioDiseno ASC`)).recordset;
  return { disponibles, mias };
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
    if (!ROLES_ARCHIVO.includes(rol)) throw fallo(400, 'Indicá qué es el archivo (arte del cliente, referencia, boceto, planilla, tizada o diseño pronto).');
    const parteId = entero(b.ParteID);
    const reemplazaA = entero(b.ReemplazaA);
    const eventoId = entero(b.EventoID);
    let productoSolId = entero(b.ProductoSolID);
    const nombre = txt(file.originalname, 260) || 'archivo';
    const ext = (nombre.split('.').pop() || '').toLowerCase();

    const sol = await cabecera(pool, solicitudId);
    exigirAbierta(sol);

    let pa = null;
    if (parteId) {
      pa = await parteConContexto(pool, parteId);
      if (pa.SolicitudID !== solicitudId) throw fallo(400, 'El servicio no pertenece a esta solicitud.');
      productoSolId = pa.ProductoSolID;
    }

    if (rol === 'DISENO_PRONTO') {
      if (!pa) throw fallo(400, 'El diseño pronto se sube sobre un servicio concreto.');
      const soyElDisenador = pa.DisenadorID && (pa.DisenadorID === user.id || esAdmin(user));
      // RN-SOL.20: arte listo del cliente en un servicio adicional → lo adjunta el vendedor, sin pasar por Diseño.
      const vendedorDirecto = !pa.DisenadorID && TIPOS_ADICIONAL.includes(pa.Tipo) && ['INGRESADO', 'DISENADO'].includes(pa.Estado) && esVendedor(user);
      if (!soyElDisenador && !vendedorDirecto) {
        throw fallo(403, pa.Tipo === 'PRINCIPAL'
          ? 'El arte de la producción principal siempre pasa por Diseño: lo sube el diseñador que tomó el trabajo.'
          : 'El diseño pronto lo sube el diseñador que tomó el trabajo (o el vendedor, si el arte vino listo del cliente y no se envió a Diseño).');
      }
      if (soyElDisenador && !['DISENO_INICIADO', 'DISENADO'].includes(pa.Estado)) throw fallo(409, 'Primero tomá el trabajo de la bandeja.');
      const f = FORMATOS_DISENO[pa.Tipo];
      if (f && !f.ext.includes(ext)) throw fallo(400, `Formato inválido para ${NOMBRE_PARTE[pa.Tipo]}. Solo se permite ${f.txt}.`);
    } else if (!esVendedor(user) && !(pa && pa.DisenadorID === user.id) && !(eventoId && await esDisenador(pool, user))) {
      throw fallo(403, 'No tenés permiso para adjuntar archivos a esta solicitud.');
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
    if (rol === 'DISENO_PRONTO' && pa.Tipo === 'PRINCIPAL') produccion = await require('./solicitudesVendedorConversion').resolverProduccion(pool, b, viejo);
    if (rol === 'DISENO_PRONTO' && pa.Tipo === 'DTF') {
      await require('./solicitudesVendedorConversion').exigirMedidaDtf(pool, pa, b, nombre);
      produccion = { Material: null, CodArticulo: null, CodStock: null, Copias: parseInt(b.Copias, 10) >= 1 ? parseInt(b.Copias, 10) : (viejo?.Copias || 1) };   // DTF: solo copias
    }

    // 1. Fila pendiente → 2. Drive (fuera de transacción: es lento) → 3. cierre en transacción
    const ins = await pool.request()
      .input('Sol', sql.Int, solicitudId).input('Prod', sql.Int, productoSolId || null).input('Parte', sql.Int, parteId || null)
      .input('Ev', sql.Int, eventoId || null).input('Rol', sql.VarChar(20), rol).input('Nom', sql.NVarChar(260), nombre)
      .input('Tam', sql.BigInt, file.size || null).input('An', sql.Decimal(10, 4), decimal(b.AnchoM)).input('Al', sql.Decimal(10, 4), decimal(b.AltoM))
      .input('Rep', sql.Int, reemplazaA || null).input('U', sql.Int, user.id)
      .query(`INSERT INTO dbo.SolicitudesVendedorArchivos (SolicitudID, ProductoSolID, ParteID, EventoID, Rol, NombreOriginal, UrlDrive, TamanoBytes, AnchoM, AltoM, Vigente, ReemplazaA, UsuarioSube)
              OUTPUT INSERTED.ArchivoID
              VALUES (@Sol, @Prod, @Parte, @Ev, @Rol, @Nom, 'Pendiente', @Tam, @An, @Al, 0, @Rep, @U)`);
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
    exigirAbierta(sol);
    const r = await new sql.Request(transaction).input('A', sql.Int, archivoId).input('Sol', sql.Int, solicitudId)
      .query('SELECT * FROM dbo.SolicitudesVendedorArchivos WHERE ArchivoID = @A AND SolicitudID = @Sol AND Vigente = 1');
    const a = r.recordset[0];
    if (!a) throw fallo(404, 'El archivo no existe o ya fue quitado.');
    if (a.Rol === 'DISENO_PRONTO') {
      // Un servicio puede llevar varios archivos de diseño pronto: uno de más se puede quitar.
      // El ÚLTIMO no: el servicio está "Diseñado" porque tiene archivo — ese se sustituye por el corregido.
      const pa = await parteConContexto(transaction, a.ParteID);
      const puede = esAdmin(user) || (pa.DisenadorID && pa.DisenadorID === user.id) || (!pa.DisenadorID && esVendedor(user));
      if (!puede) throw fallo(403, 'El diseño pronto lo quita el diseñador que tiene el trabajo (o el vendedor, si el servicio no pasó por Diseño).');
      const otros = await new sql.Request(transaction).input('P', sql.Int, a.ParteID).input('A', sql.Int, archivoId)
        .query("SELECT COUNT(*) AS n FROM dbo.SolicitudesVendedorArchivos WHERE ParteID = @P AND Rol = 'DISENO_PRONTO' AND Vigente = 1 AND ArchivoID <> @A");
      if (!otros.recordset[0].n) throw fallo(409, 'Es el único archivo de diseño pronto de este servicio: no se quita, se sustituye por el archivo corregido.');
    } else {
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
async function cancelar(pool, user, solicitudId, b) {
  exigirVendedor(user);
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

  const r = await req.query(`
    SELECT TOP 500 s.SolicitudID, s.PreNumero, s.FechaSolicitud, s.CodCliente, LTRIM(RTRIM(c.Nombre)) AS ClienteNombre, s.NombreTrabajo, s.Estado,
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
  return r.recordset;
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

  // RN-SOL.31: quien no es vendedor solo entra si tiene (o puede tomar) algo de esta solicitud.
  if (!esVendedor(user)) {
    const puede = (await esDisenador(pool, user)) && partes.some(p => p.Estado === 'ENVIADO_DISENO' || p.DisenadorID === user.id);
    if (!puede) throw fallo(403, 'No tenés ningún trabajo de Diseño en esta solicitud.');
  }

  const productos = (await pool.request().input('Sol', sql.Int, solicitudId)
    .query('SELECT * FROM dbo.SolicitudesVendedorProductos WHERE SolicitudID = @Sol AND Activo = 1 ORDER BY Orden')).recordset;
  const archivos = (await pool.request().input('Sol', sql.Int, solicitudId).query(`
    SELECT a.*, u.Nombre AS UsuarioNombre FROM dbo.SolicitudesVendedorArchivos a
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
  sol.Presupuesto = null;
  if (sol.PreId) {
    try {
      const pre = await pool.request().input('Pre', sql.Int, sol.PreId)
        .query('SELECT PreId, PreNumero, ClienteNombre, Moneda, Total, Estado, FechaEmision FROM dbo.Presupuestos WHERE PreId = @Pre');
      sol.Presupuesto = pre.recordset[0] || null;
    } catch (e) { logger.warn(`[SOLICITUDES] no se pudo leer el presupuesto ${sol.PreId}: ${e.message}`); }
  }
  sol.Conversion = sol.Productos.map(p => ({ ProductoSolID: p.ProductoSolID, faltantes: faltantesConversion(sol, p, archivos), avisos: avisosConversion(p, archivos) }));
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
    }
    const d = pa.Datos || {};
    if (pa.Tipo === 'BORDADO') {
      if (!d.variante) f.push('Bordado: falta dónde se borda (sobre la prenda / parche adhesivo).');
      if (!d.material) f.push('Bordado: falta el tipo de bordado (100% hilo / con tafeta).');
      if (!(pa.CantidadTotal > 0)) f.push('Bordado: falta la cantidad total.');
    }
    if (pa.Tipo === 'DTF') {
      if (!d.material) f.push('Estampado DTF: falta el film / material.');
      if (!(pa.CantidadTotal > 0)) f.push('Estampado DTF: falta la cantidad total.');
      if (!(pa.PorPrenda > 0)) f.push('Estampado DTF: faltan los estampados por prenda.');
    }
    if (pa.Tipo === 'TPU') {
      if (!d.variante) f.push('Estampado TPU: falta el tipo / variante.');
      if (!d.material) f.push('Estampado TPU: falta el artículo de TPU (tipo y tamaño del parche).');
      if (!d.origenPrendas) f.push('Estampado TPU: falta el origen de las prendas.');
      if (!(pa.CantidadTotal > 0)) f.push('Estampado TPU: falta la cantidad total.');
      if (!(pa.PorPrenda > 0)) f.push('Estampado TPU: faltan los estampados por prenda.');
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
const baseConversion = () => ({ cabecera, exigirAbierta, exigirVendedor, esAdmin, esVendedor, esDisenador, registrarEvento, recalcularEstado, obtener });
const materialesPrincipal = (pool) => require('./solicitudesVendedorConversion').materialesPrincipal(pool);
const definirProduccionArchivo = (pool, user, solicitudId, archivoId, b) => require('./solicitudesVendedorConversion').definirProduccionArchivo(pool, user, baseConversion(), solicitudId, archivoId, b);
const convertir = (pool, user, solicitudId, productoSolId, b, app) => require('./solicitudesVendedorConversion').convertir(pool, user, baseConversion(), solicitudId, productoSolId, b, app);
const disenosEnProduccion = (pool, user) => require('./solicitudesVendedorConversion').disenosEnProduccion(pool, user, baseConversion());
const bobinasDelCliente = (pool, user, solicitudId) => require('./solicitudesVendedorConversion').bobinasDelCliente(pool, user, baseConversion(), solicitudId);
const reintentarArchivos = (pool, user, solicitudId, productoSolId, app) => require('./solicitudesVendedorConversion').reintentarArchivos(pool, user, baseConversion(), solicitudId, productoSolId, app);

module.exports = {
  materialesPrincipal, definirProduccionArchivo, convertir, reintentarArchivos, bobinasDelCliente, disenosEnProduccion,
  crear, actualizar, listar, obtener, guardarPrecio, confirmarSena, agregarInteraccion,
  enviarADiseno, bandeja, tomarParte, aceptarCambio, subirArchivo, quitarArchivo, cancelar,
  listarVendedores, listarDisenadores, definirDisenador, miPerfil,
};
