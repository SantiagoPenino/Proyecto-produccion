'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// INGRESO DE PEDIDOS DE PRENDA POR SISTEMA — puerta HTTP para un sistema externo
//   /api/external/pedidos-prenda        (docs: backend/docs/API_EXTERNAL_PEDIDOS_PRENDA.md)
//
// El externo manda el pedido en términos de negocio; acá solo se autentica, se resuelve el
// cliente y se entrega al MISMO procesador que usa la Solicitud del vendedor
// (services/pedidosExternos): validador → traductor → creador de pedidos de siempre.
//
// Apagado de emergencia sin desplegar: PEDIDOS_EXTERNOS_ENABLED=0 en el .env y reiniciar.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const procesador = require('../services/pedidosExternos/procesador');
const catalogo = require('../services/pedidosExternos/catalogo');
const { VARIANTE_SUBLIMACION, VARIANTE_DTF } = require('../services/pedidosExternos/validador');

const ORIGEN = () => (process.env.PEDIDOS_EXTERNOS_ORIGEN || 'SISTEMA_EXTERNO').substring(0, 50);

// Falla CERRADO: sin key configurada, o con el módulo apagado, nadie entra.
exports.verificarKey = (req, res, next) => {
  const key = process.env.PEDIDOS_EXTERNOS_API_KEY || '';
  if (process.env.PEDIDOS_EXTERNOS_ENABLED === '0' || key.length < 24) {
    return res.status(503).json({ success: false, error: 'El ingreso de pedidos por sistema está apagado.' });
  }
  const recibida = String(req.headers['x-api-key'] || '');
  const a = crypto.createHash('sha256').update(recibida).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ success: false, error: 'API key inválida.' });
  next();
};

const responder = (ctx, fn) => async (req, res) => {
  try { await fn(await getPool(), req, res); }
  catch (e) {
    const status = e?.status || 500;
    if (status >= 500) logger.error(`[PEDIDOS-SISTEMA] ${ctx}: ${e?.stack || e?.message}`);
    res.status(status).json({ success: false, error: e?.message || 'Error inesperado' });
  }
};
const fallo = (status, mensaje) => { const e = new Error(mensaje); e.status = status; return e; };
const limpio = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));

// Usuario interno a nombre del cual entran los pedidos del externo (queda en el historial de las órdenes).
async function usuarioDeServicio(pool) {
  const id = parseInt(process.env.PEDIDOS_EXTERNOS_USUARIO_ID, 10);
  if (!id) throw fallo(503, 'Falta configurar PEDIDOS_EXTERNOS_USUARIO_ID (usuario interno a nombre del cual entran los pedidos).');
  const r = await pool.request().input('Id', sql.Int, id).query('SELECT UserID, Username, Nombre, IdRol FROM dbo.Usuarios WHERE UserID = @Id');
  const u = r.recordset[0];
  if (!u) throw fallo(503, `El usuario de servicio ${id} no existe.`);
  return { id: u.UserID, username: u.Username, name: u.Nombre, idRol: u.IdRol, role: 'Sistema', userType: 'INTERNAL' };
}

// El externo puede identificar al cliente por codCliente, por idReact o por idCliente (el código de texto).
async function resolverCliente(pool, c) {
  if (!c) return null;
  if (parseInt(c.codCliente, 10) > 0) return parseInt(c.codCliente, 10);
  const idReact = parseInt(c.idReact, 10);
  if (idReact > 0) {   // IDReact 0 no es un vínculo válido (ver integrationOrdersController)
    const r = await pool.request().input('V', sql.Int, idReact).query('SELECT TOP 1 CodCliente FROM dbo.Clientes WHERE IDReact = @V');
    if (r.recordset.length) return r.recordset[0].CodCliente;
  }
  if (String(c.idCliente || '').trim()) {
    const r = await pool.request().input('V', sql.NVarChar, String(c.idCliente).trim()).query('SELECT TOP 1 CodCliente FROM dbo.Clientes WHERE LTRIM(RTRIM(IDCliente)) = @V');
    if (r.recordset.length) return r.recordset[0].CodCliente;
  }
  return null;
}

// POST /  → 202. El pedido se valida, se mide y se crea en segundo plano; el estado se consulta con GET /:idExterno
exports.recibir = responder('recibir', async (pool, req, res) => {
  const { idExterno, ...pedido } = req.body || {};
  const id = String(idExterno || '').trim();
  if (!id || id.length > 100) throw fallo(400, 'Falta "idExterno": el identificador único del pedido en tu sistema (hasta 100 caracteres).');
  pedido.cliente = { codCliente: await resolverCliente(pool, pedido.cliente) };
  const r = await procesador.recibir(pool, { origen: ORIGEN(), idExterno: id, pedido, usuarioInterno: await usuarioDeServicio(pool), app: req.app });
  res.status(r.estado === 'PROCESANDO' ? 202 : 200).json({ success: true, data: { idExterno: id, ...r } });
});

exports.estado = responder('estado', async (pool, req, res) => {
  const r = await procesador.estadoDe(pool, ORIGEN(), String(req.params.idExterno));
  if (!r) throw fallo(404, 'Ese pedido no existe.');
  res.json({ success: true, data: { idExterno: req.params.idExterno, ...r } });
});

exports.reintentarArchivos = responder('reintentarArchivos', async (pool, req, res) => {
  const r = await procesador.reintentarArchivos(pool, { origen: ORIGEN(), idExterno: String(req.params.idExterno), usuarioInterno: await usuarioDeServicio(pool), app: req.app });
  res.json({ success: true, data: { idExterno: req.params.idExterno, ...r } });
});

// ── Catálogos de lectura: los valores válidos para armar el pedido ───────────────────────────────
const material = (m) => limpio({ codArticulo: m.CodArticulo, nombre: m.Material, anchoImprimibleM: m.Ancho, largoFijoM: m.Largo });

exports.catalogoTelas = responder('catalogoTelas', async (pool, req, res) => {
  res.json({ success: true, data: { variante: VARIANTE_SUBLIMACION, telas: (await catalogo.materialesDe(pool, 'SB', VARIANTE_SUBLIMACION)).map(material) } });
});

exports.catalogoServicios = responder('catalogoServicios', async (pool, req, res) => {
  const variantesDe = async (areaId) => (await pool.request().input('AreaID', sql.VarChar, areaId).query(`
      SELECT DISTINCT LTRIM(RTRIM(dbo.StockArt.Articulo)) AS Variante
      FROM dbo.ConfigMapeoERP INNER JOIN dbo.StockArt ON dbo.ConfigMapeoERP.CodigoERP = dbo.StockArt.Grupo
      WHERE dbo.ConfigMapeoERP.AreaID_Interno = @AreaID AND ISNULL(dbo.StockArt.mostrar, 1) = 1
      ORDER BY Variante`)).recordset.map(v => v.Variante);
  const out = {};
  for (const [tipo, areaId] of [['BORDADO', 'EMB'], ['DTF', 'DF'], ['TPU', 'TPU']]) {
    const variantes = tipo === 'DTF' ? [VARIANTE_DTF] : await variantesDe(areaId);   // DTF: variante fija, igual que la página
    out[tipo] = [];
    for (const v of variantes) out[tipo].push({ variante: v, materiales: (await catalogo.materialesDe(pool, areaId, v)).map(material) });
  }
  res.json({ success: true, data: out });
});

// Mismos filtros que usa la página para "Producto terminado a fabricar" (grupo 2.1).
exports.catalogoProductos = responder('catalogoProductos', async (pool, req, res) => {
  const r = await pool.request().query(`
      SELECT a.ProIdProducto AS proIdProducto, LTRIM(RTRIM(a.Descripcion)) AS nombre, LTRIM(RTRIM(sa.Articulo)) AS categoria
      FROM dbo.Articulos a
      INNER JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
      WHERE ISNULL(sa.TipoStock, 'MATERIAL') = 'PRODUCTO_TERMINADO' AND ISNULL(a.borrar, 0) = 0 AND ISNULL(a.Mostrar, 1) = 1
        AND LTRIM(RTRIM(sa.Grupo)) = '2.1'
      ORDER BY categoria, nombre`);
  res.json({ success: true, data: r.recordset });
});

exports.catalogoBobinas = responder('catalogoBobinas', async (pool, req, res) => {
  const cod = await resolverCliente(pool, { codCliente: req.params.codCliente });
  const c = cod && (await pool.request().input('Cod', sql.Int, cod).query('SELECT CodCliente, CliIdCliente, RTRIM(LTRIM(IDCliente)) AS IDCliente FROM dbo.Clientes WHERE CodCliente = @Cod')).recordset[0];
  if (!c) throw fallo(404, 'Ese cliente no existe.');
  res.json({
    success: true,
    data: (await catalogo.bobinasDe(pool, c)).map(b => ({ bobinaId: b.BobinaID, etiqueta: b.CodigoEtiqueta, tela: String(b.DescripcionTela || '').trim(), metrosDisponibles: b.MetrosRestantes, anchoM: b.AnchoReal ?? b.Ancho })),
  });
});
