'use strict';
// =====================================================================
// Solicitudes de vendedores — tizadas de TizadaPro
// =====================================================================
// Flujo:
//  1. El diseñador genera la tizada en TizadaPro (services/tizadaProService.js la lee).
//  2. En la solicitud, "Vincular tizada": elige el trabajo de una lista leída de TizadaPro.
//     Guardamos una COPIA del resultado (TizadaPro borra sus trabajos viejos y no tiene
//     ningún vínculo con nuestro pedido).
//  3. Sube A MANO el PDF de cada hoja (TizadaPro no expone los archivos). La tela, el ancho
//     y los metros de ese archivo salen de la hoja vinculada, no de medir el PDF: una hoja
//     de TizadaPro puede tener varias páginas y la medición normal lo rechazaría.
//  4. La conversión a pedido no cambia: toma esos archivos de diseño pronto como siempre.
//
// Modelo: scripts/add_solicitudes_tizadapro.sql. Sin ese script, el módulo sigue funcionando
// y la vinculación avisa que falta.
// =====================================================================
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const tizadaPro = require('./tizadaProService');

const fallo = (status, mensaje) => { const e = new Error(mensaje); e.status = status; return e; };
const jsonObj = (s) => { try { return s ? JSON.parse(s) : {}; } catch (_) { return {}; } };
const FALTA_SQL = 'Falta correr scripts/add_solicitudes_tizadapro.sql en esta base.';

let _tieneTablas = false;
async function tieneTablas(pool) {
  if (_tieneTablas) return true;
  const r = await pool.request().query("SELECT OBJECT_ID('dbo.SolicitudesVendedorTizadas', 'U') AS t, COL_LENGTH('dbo.SolicitudesVendedorArchivos', 'TizadaID') AS c");
  _tieneTablas = r.recordset[0].t != null && r.recordset[0].c != null;
  return _tieneTablas;
}

const materialesPrincipal = (pool) => require('./solicitudesVendedorConversion').materialesPrincipal(pool);

// Molde de TizadaPro que tiene vinculado el producto del catálogo (configurador), si lo tiene.
async function moldeDelProducto(pool, productoSolId) {
  const r = await pool.request().input('P', sql.Int, productoSolId).query(`
    SELECT p.ProIdProducto, p.PedidoNoDocERP,
           CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL THEN NULL
                ELSE (SELECT vc.TizadaProMoldeRef FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS MoldeRef
    FROM dbo.SolicitudesVendedorProductos p WHERE p.ProductoSolID = @P`);
  return r.recordset[0] || null;
}

// ---------------------------------------------------------------------
// Lista de tizadas terminadas (para elegir cuál vincular). ?parteId= filtra por el
// molde del producto de esa parte, si el producto del catálogo tiene molde vinculado.
// ---------------------------------------------------------------------
async function listarTrabajos(pool, user, base, f) {
  if (!base.esVendedor(user) && !(await base.esDisenador(pool, user))) throw fallo(403, 'No tenés permiso para ver las tizadas.');
  let moldeRef = null;
  const parteId = parseInt(f?.parteId, 10);
  if (Number.isInteger(parteId)) {
    // Consulta directa (no parteConContexto: ese tira error si el producto ya es pedido, y acá solo se lista)
    const pa = await pool.request().input('Pa', sql.Int, parteId).query('SELECT ProductoSolID FROM dbo.SolicitudesVendedorPartes WHERE ParteID = @Pa');
    if (pa.recordset[0]) moldeRef = (await moldeDelProducto(pool, pa.recordset[0].ProductoSolID))?.MoldeRef || null;
  }
  const materiales = await materialesPrincipal(pool);
  const todas = await tizadaPro.trabajos(pool, materiales, { dias: f?.dias });
  const lista = moldeRef && !f?.todas ? todas.filter(t => t.moldeRef === moldeRef) : todas;
  return { moldeRef, trabajos: lista, totalSinFiltro: todas.length };
}

// ---------------------------------------------------------------------
// Vincular un trabajo de TizadaPro a la producción principal de un producto
// ---------------------------------------------------------------------
async function vincular(pool, user, base, parteId, b) {
  if (!(await tieneTablas(pool))) throw fallo(409, FALTA_SQL);
  const trabajoId = parseInt(b?.trabajoId, 10);
  if (!Number.isInteger(trabajoId)) throw fallo(400, 'Elegí la tizada de TizadaPro.');
  const pa = await base.parteConContexto(pool, parteId);
  if (pa.Tipo !== 'PRINCIPAL') throw fallo(400, 'La tizada va en la producción principal (sublimación).');
  const sol = await base.cabecera(pool, pa.SolicitudID);
  base.exigirAbierta(sol);
  const prod = await moldeDelProducto(pool, pa.ProductoSolID);
  if (prod?.PedidoNoDocERP) throw fallo(409, 'Este producto ya se convirtió en pedido: la tizada ya no se cambia acá.');
  const puede = base.esAdmin(user) || (pa.DisenadorID && pa.DisenadorID === user.id);
  if (!puede) throw fallo(403, 'La tizada la vincula el diseñador que tomó el trabajo.');
  if (!['DISENO_INICIADO', 'DISENADO'].includes(pa.Estado)) throw fallo(409, 'Primero tomá el trabajo de la bandeja.');

  const t = await tizadaPro.trabajo(pool, await materialesPrincipal(pool), trabajoId);
  if (!t) throw fallo(404, 'Esa tizada ya no está en TizadaPro (se borró o todavía no terminó). Generala de nuevo.');
  if (t.estado !== 'listo') throw fallo(409, `Esa tizada todavía no terminó en TizadaPro (estado: ${t.estado}).`);
  if (!t.hojas.length) throw fallo(400, 'Esa tizada no tiene hojas.');
  const sinTela = t.hojas.filter(h => !h.codArticulo).map(h => h.tela);
  if (sinTela.length) throw fallo(400, `Estas telas de la tizada no están en el catálogo de Sublimación: ${sinTela.join(', ')}. Revisá el artículo de la tela.`);
  if (prod?.MoldeRef && t.moldeRef && prod.MoldeRef !== t.moldeRef && !b?.forzar) {
    throw fallo(409, `Esa tizada es del molde "${t.molde}", pero el producto del catálogo está vinculado a otro molde de TizadaPro. Elegí una tizada de ese molde o marcá "Usar igual" si es correcto.`);
  }
  const { estado, ...resumen } = t;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const previa = await new sql.Request(transaction).input('Pa', sql.Int, parteId)
      .query('UPDATE dbo.SolicitudesVendedorTizadas SET Vigente = 0 OUTPUT DELETED.TizadaID WHERE ParteID = @Pa AND Vigente = 1');
    const ins = await new sql.Request(transaction)
      .input('Sol', sql.Int, pa.SolicitudID).input('Prod', sql.Int, pa.ProductoSolID).input('Pa', sql.Int, parteId)
      .input('T', sql.Int, resumen.trabajoId).input('Ref', sql.NVarChar(128), resumen.ref)
      .input('MRef', sql.NVarChar(800), resumen.moldeRef).input('MNom', sql.NVarChar(800), resumen.molde)
      .input('Pz', sql.Int, Number.isFinite(Number(resumen.piezas)) ? Number(resumen.piezas) : null)
      .input('F', sql.DateTime2, resumen.fecha).input('Res', sql.NVarChar(sql.MAX), JSON.stringify(resumen))
      .input('U', sql.Int, user.id)
      .query(`INSERT INTO dbo.SolicitudesVendedorTizadas
                (SolicitudID, ProductoSolID, ParteID, TrabajoID, TrabajoRef, MoldeRef, MoldeNombre, Piezas, FechaTizada, ResultadoJson, UsuarioVincula)
              OUTPUT INSERTED.TizadaID
              VALUES (@Sol, @Prod, @Pa, @T, @Ref, @MRef, @MNom, @Pz, @F, @Res, @U)`);
    const tizadaId = ins.recordset[0].TizadaID;
    const telasTxt = resumen.hojas.map(h => `${h.material} ${(h.consumoCm / 100).toFixed(2)} m`).join(', ');
    await base.registrarEvento(transaction, user, {
      solicitudId: pa.SolicitudID, productoSolId: pa.ProductoSolID, parteId, tipo: 'ARCHIVO',
      texto: `${previa.recordset.length ? 'Se cambió la tizada' : 'Se vinculó la tizada'} de TizadaPro "${resumen.molde}" (trabajo ${resumen.ref || resumen.trabajoId}): ${resumen.piezas ?? '?'} piezas · ${telasTxt}. Falta subir el PDF de cada hoja.`,
    });
    await transaction.commit();
    return { TizadaID: tizadaId, ...resumen };
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.vincularTizada ${parteId}`);
    throw err;
  }
}

// Tizadas vigentes de una solicitud (para el detalle)
async function deSolicitud(pool, solicitudId) {
  if (!(await tieneTablas(pool))) return [];
  const r = await pool.request().input('Sol', sql.Int, solicitudId).query(`
    SELECT t.TizadaID, t.ProductoSolID, t.ParteID, t.TrabajoID, t.TrabajoRef, t.MoldeRef, t.MoldeNombre, t.Piezas, t.FechaTizada,
           t.ResultadoJson, t.FechaVincula, u.Nombre AS UsuarioNombre
    FROM dbo.SolicitudesVendedorTizadas t
    LEFT JOIN dbo.Usuarios u ON u.IdUsuario = t.UsuarioVincula
    WHERE t.SolicitudID = @Sol AND t.Vigente = 1`);
  return r.recordset.map(({ ResultadoJson, ...t }) => ({ ...t, Resultado: jsonObj(ResultadoJson) }));
}

// Al subir el PDF de una hoja: la tela, el ancho y los metros salen de la tizada vinculada.
// Devuelve los campos a guardar en el archivo, o null si el archivo no viene de una tizada.
async function datosDeHoja(pool, pa, b) {
  const tizadaId = parseInt(b?.TizadaID, 10);
  if (!Number.isInteger(tizadaId)) return null;
  if (!(await tieneTablas(pool))) throw fallo(409, FALTA_SQL);
  if (!pa || pa.Tipo !== 'PRINCIPAL') throw fallo(400, 'La hoja de una tizada va en la producción principal.');
  const r = await pool.request().input('T', sql.Int, tizadaId).input('Pa', sql.Int, pa.ParteID)
    .query('SELECT ResultadoJson FROM dbo.SolicitudesVendedorTizadas WHERE TizadaID = @T AND ParteID = @Pa AND Vigente = 1');
  if (!r.recordset.length) throw fallo(409, 'Esa tizada ya no es la vigente de este servicio. Recargá la página.');
  const res = jsonObj(r.recordset[0].ResultadoJson);
  const hoja = (res.hojas || []).find(h => h.archivo === b.TizadaHoja);
  if (!hoja) throw fallo(400, 'Esa hoja no está en la tizada vinculada.');
  return {
    TizadaID: tizadaId, TizadaHoja: hoja.archivo,
    AnchoM: hoja.anchoCm ? Number((hoja.anchoCm / 100).toFixed(4)) : null,
    AltoM: hoja.consumoCm ? Number((hoja.consumoCm / 100).toFixed(4)) : null,
    CodArticulo: hoja.codArticulo, Material: hoja.material,
  };
}

async function marcarArchivo(cx, archivoId, d) {
  await new sql.Request(cx).input('A', sql.Int, archivoId).input('T', sql.Int, d.TizadaID).input('H', sql.NVarChar(260), d.TizadaHoja)
    .query('UPDATE dbo.SolicitudesVendedorArchivos SET TizadaID = @T, TizadaHoja = @H WHERE ArchivoID = @A');
}

module.exports = { listarTrabajos, vincular, deSolicitud, datosDeHoja, marcarArchivo, tieneTablas };
