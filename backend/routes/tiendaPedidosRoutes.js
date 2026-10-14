'use strict';
// /api/web-orders/tienda/pedidos — el cliente arma su pedido en la Tienda del portal (services/pedidoPortalService.js).
// Lo que se carga (arte, editables, piezas y telas, lista de jugadores, arte de los extras) va por los endpoints de
// siempre de /api/solicitudes-vendedor (middleware/solicitudesClientePortal.js); acá está solo lo que no existía.
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/db');
const logger = require('../utils/logger');
const { verifyToken } = require('../middleware/authMiddleware');
const { impersonarCliente } = require('../controllers/webDesignerController');
const portal = require('../services/pedidoPortalService');

router.use(verifyToken, impersonarCliente, (req, res, next) => { portal.recordarApp(req.app); next(); });

const accion = (ctx, fn) => async (req, res) => {
  try { res.json({ success: true, data: await fn(await getPool(), req) }); }
  catch (e) {
    const status = e.status || 500;
    if (status >= 500) logger.error(`[PORTAL-PEDIDO] ${ctx}: ${e.stack || e.message}`);
    res.status(status).json({ success: false, error: e.message || 'Error inesperado', faltan: e.faltan, codigo: e.codigo });
  }
};

router.get('/armables', accion('armables', (pool) => portal.armables(pool)));                       // productos que se arman acá
// Plantilla de TIZADA PRO para armar el arte (link en la foto del producto): qué productos la tienen, prepararla y bajarla
const plantillas = require('../services/tiendaPlantillas');
router.get('/plantillas', accion('plantillas', (pool) => plantillas.conPlantilla(pool)));
router.get('/plantillas/:proId', accion('plantilla', (pool, req) => plantillas.preparar(pool, req.params.proId)));
router.get('/plantillas/:proId/archivo', async (req, res) => {
  try {
    const a = await plantillas.archivo(await getPool(), req.params.proId);
    res.setHeader('Content-Type', 'application/postscript');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.send(a.buffer);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) logger.error(`[TIENDA-PLANTILLA] ${req.params.proId}: ${e.stack || e.message}`);
    res.status(status).json({ success: false, error: e.message || 'Error inesperado' });
  }
});
router.get('/', accion('listar', (pool, req) => portal.listar(pool, req.user)));                     // mis pedidos de la tienda
router.post('/', accion('crear', (pool, req) => portal.crear(pool, req.user, req.body || {})));      // empezar (o retomar) uno
router.get('/:id', accion('resumen', (pool, req) => portal.resumen(pool, req.user, req.params.id)));
router.put('/:id/extras/:tipo', accion('extra', (pool, req) => portal.cambiarExtra(pool, req.user, req.params.id, req.params.tipo, req.body || {})));
router.get('/:id/arte/:archivoId', accion('revisarArte', (pool, req) => portal.revisarArte(pool, req.user, req.params.id, req.params.archivoId)));   // [A MEDIDA] ¿sirve para imprimir? + vista
router.post('/:id/confirmar', accion('confirmar', (pool, req) => portal.confirmar(pool, req.user, req.params.id, req.body || {})));
router.post('/:id/descartar', accion('descartar', (pool, req) => portal.descartar(pool, req.user, req.params.id)));

// Lo que ya volvió de TIZADA PRO se convierte solo en pedido (cada PORTAL_PEDIDOS_BARRIDO_SEGUNDOS, 60 por defecto)
portal.iniciarBarrido(getPool);

module.exports = router;
