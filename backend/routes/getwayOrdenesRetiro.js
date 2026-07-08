// apiordenesRetiro.js
const express = require('express');
const router = express.Router();
const { createOrdenRetiro, getOrdenesRetiroPorEstados, actualizarOrdenRetiroEstado, marcarOrdenRetiroPronto, ordenesRetiroCaja, marcarOrdenRetiroEntregado, getOrdenesRetiroPasarPorCaja, ordenesRetiroMarcarPasarPorCaja, getOrdenesRetiroPorFecha, getOrdenesRetiroPorLugar, marcarDespachoEntregadoAutorizado, buscarParaMostrador, getClienteEnvioDatos, getTodasSinRetiro, backfillLugarRetiro, getOrdenesRetiroPorRemito, editarCostoOrden, desvincularOrdenRetiro, cancelarOrdenCaja, exonerarOrdenCaja, revertirExoneracionOrden } = require('../controllers/ordenesRetiroController');
const { verifyToken } = require('../middleware/authMiddleware');

// Ruta para crear una Orden de Retiro
router.post('/crear', verifyToken, createOrdenRetiro);

// Rutas de edición administrativa de órdenes
router.post('/caja/orden/editar',      verifyToken, editarCostoOrden);
router.post('/caja/orden/desvincular', verifyToken, desvincularOrdenRetiro);
router.post('/caja/orden/cancelar',    verifyToken, cancelarOrdenCaja);
router.post('/caja/orden/exonerar',    verifyToken, exonerarOrdenCaja);
router.post('/caja/orden/exonerar/revertir', verifyToken, revertirExoneracionOrden);

// Ruta para obtener todas las órdenes de retiro en estado "Ingresado"
router.get('/estados', getOrdenesRetiroPorEstados);

// Ruta para actualizar estado orden de retiro
router.post('/actualizarEstado', verifyToken, actualizarOrdenRetiroEstado)

// Ruta para marcar una orden de retiro como pronto
router.post('/marcarPronto', verifyToken, marcarOrdenRetiroPronto);

// Ruta para marcar orden como entregada
router.post('/marcarOrdenEntregada', verifyToken, marcarOrdenRetiroEntregado)

// Ruta para traer las ordenes de retiro y ordenes para la caja
router.get('/caja', ordenesRetiroCaja);

// Ruta para traer las ordenes de retiro que deben pasar por caja
router.get('/pasarporcaja', getOrdenesRetiroPasarPorCaja);

// Ruta para traer las ordenes de retiro que deben pasar por caja
router.post('/marcarpasarporcaja/:pasar', verifyToken, ordenesRetiroMarcarPasarPorCaja);

router.get('/filterByDate', getOrdenesRetiroPorFecha);

// Rutas para Entregas/Logística
router.get('/lugar/:lugarId', getOrdenesRetiroPorLugar);
router.post('/despachos/entregar-autorizado', verifyToken, marcarDespachoEntregadoAutorizado);

// Mostrador & Facturación Remota
router.get('/mostrador/buscar', verifyToken, buscarParaMostrador);

// Retiros por Código de Remito Logístico
router.get('/remito/:remitoCode', verifyToken, getOrdenesRetiroPorRemito);

// Todas las órdenes sin retiro, con filtro opcional ?lugar=ID
router.get('/sin-retiro', verifyToken, getTodasSinRetiro);

// Datos de envío del cliente (DireccionesEnvioCliente)
router.get('/cliente-envio/:cliId', verifyToken, getClienteEnvioDatos);

// Backfill: ?dry=true para preview, sin parámetro para ejecutar
router.get('/backfill-lugar', verifyToken, backfillLugarRetiro);
router.post('/backfill-lugar', verifyToken, backfillLugarRetiro);

module.exports = router;
