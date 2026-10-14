'use strict';
// /api/solicitudes-vendedor para un CLIENTE del portal: el pedido que arma en la Tienda es una Solicitud (Origen PORTAL)
// y lo carga con las MISMAS pantallas y los MISMOS endpoints que el vendedor. Acá se decide qué puede tocar:
//   · solo estas rutas (leer su pedido, subir / quitar su arte y planilla, editables, piezas y telas, lista de
//     jugadores, "Revisar en TIZADA" sin generar nada, y preguntar cómo va un envío)
//   · solo sobre SUS solicitudes de la tienda, y las que cambian algo solo mientras la está armando
// Pasa a la regla de siempre con un usuario "portal" que actúa como su asesor (pedidoPortalService.usuarioPortal).
// Los usuarios internos siguen exactamente como antes (soloInternoConRol).
const { getPool } = require('../config/db');
const { soloInternoConRol } = require('./authMiddleware');
const portal = require('../services/pedidoPortalService');

const RUTAS = [
  // [método, ruta, qué hace]  leer = también con el pedido ya confirmado (para ver cómo va)
  ['GET', /^\/(\d+)$/, 'leer'],
  ['GET', /^\/(\d+)\/productos\/\d+\/tizadapro$/, 'leer'],
  ['GET', /^\/(\d+)\/productos\/\d+\/molde$/, 'leer'],
  ['POST', /^\/(\d+)\/tizadapro\/envios\/\d+\/actualizar$/, 'leer'],
  ['GET', /^\/(\d+)\/archivos\/\d+\/piezas$/, 'leer'],
  ['PUT', /^\/(\d+)\/productos\/\d+\/tizadapro$/, 'escribir'],
  ['POST', /^\/(\d+)\/productos\/\d+\/tizadapro\/editables$/, 'escribir'],
  ['POST', /^\/(\d+)\/productos\/\d+\/tizadapro\/enviar$/, 'revisar'],
  ['PUT', /^\/(\d+)\/productos\/\d+\/sublimacion$/, 'escribir'],
  // [A MEDIDA] las cuentas de TIZADA para su medida (no guardan nada) y la plantilla de esa medida para armar su arte
  ['POST', /^\/(\d+)\/productos\/\d+\/tizadapro\/calcular$/, 'leer'],
  ['POST', /^\/(\d+)\/productos\/\d+\/tizadapro\/plantilla$/, 'escribir'],
  ['GET', /^\/(\d+)\/productos\/\d+\/tizadapro\/plantilla$/, 'leer'],
  ['GET', /^\/(\d+)\/productos\/\d+\/tizadapro\/plantilla\/archivo$/, 'leer'],
  ['POST', /^\/(\d+)\/archivos$/, 'escribir'],
  ['DELETE', /^\/(\d+)\/archivos\/\d+$/, 'escribir'],
];

const internos = soloInternoConRol();

module.exports = async function internoOClientePortal(req, res, next) {
  if (!portal.esClientePortal(req.user)) return internos(req, res, next);
  const ruta = RUTAS.find(([m, re]) => m === req.method && re.test(req.path));
  // Catálogo de solo lectura que usan las pantallas (telas de un área)
  if (!ruta && req.method === 'GET' && req.path === '/materiales-principal') return next();
  if (!ruta) return res.status(403).json({ success: false, error: 'Esta acción no está disponible desde el portal.' });
  const [, re, que] = ruta;
  // "Revisar en TIZADA" sí; generar la tizada no (sale sola al confirmar el pedido)
  if (que === 'revisar' && req.body?.soloRevisar !== true) return res.status(403).json({ success: false, error: 'La tizada se genera sola al confirmar el pedido.' });
  try {
    const s = await portal.solicitudDelCliente(await getPool(), req.user, req.path.match(re)[1], { escribir: que !== 'leer' });
    req.clientePortal = req.user;
    req.user = s.user;
    portal.recordarApp(req.app);
    // El historial interno de la solicitud (interacciones del vendedor, quién hizo qué) no viaja al cliente
    if (req.method === 'GET' && /^\/\d+$/.test(req.path)) {
      const json = res.json.bind(res);
      res.json = (body) => { if (body?.data) body.data.Eventos = []; return json(body); };
    }
    return next();
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, error: e.message });
  }
};
