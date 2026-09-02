// Rutas de la gestión del WMS PROPIO (sección /stock del admin).
// Montado en /api/wms-interno (server.js). Todo con token, como el resto del admin.
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/wmsInternoController');

router.get('/depositos', verifyToken, ctrl.getDepositos);
router.get('/panel', verifyToken, ctrl.getPanel);
router.get('/historial', verifyToken, ctrl.getHistorial);
router.get('/inventario', verifyToken, ctrl.getInventario);
router.get('/variantes', verifyToken, ctrl.buscarVariantes);
router.get('/variantes/:id/etiquetas', verifyToken, ctrl.getEtiquetasVariante);
router.get('/etiquetas/buscar', verifyToken, ctrl.buscarEtiqueta);
router.post('/ingresos', verifyToken, ctrl.crearIngreso);
router.post('/etiquetas/:id/ajuste', verifyToken, ctrl.ajustarEtiqueta);
router.post('/etiquetas/:id/baja', verifyToken, ctrl.bajaEtiqueta);
router.post('/etiquetas/:id/peso', verifyToken, ctrl.registrarPeso);
// Importaciones: expedientes que agrupan compras
router.get('/importaciones', verifyToken, ctrl.getImportaciones);
router.get('/importaciones/:id', verifyToken, ctrl.getImportacionDetalle);
router.post('/importaciones', verifyToken, ctrl.crearImportacion);
router.post('/importaciones/:id/progreso', verifyToken, ctrl.setProgresoImportacion);
router.post('/importaciones/:id/compras', verifyToken, ctrl.vincularCompraImportacion);
router.get('/remitos', verifyToken, ctrl.getRemitos);
router.get('/remitos/:id', verifyToken, ctrl.getRemitoDetalle);
router.post('/remitos', verifyToken, ctrl.crearRemito);
router.post('/remitos/:id/cancelar', verifyToken, ctrl.cancelarRemito);
router.post('/remitos/items/:id/recibir', verifyToken, ctrl.recibirRemitoItem);
router.get('/mi-sector', verifyToken, ctrl.getMiSector);
router.post('/mi-sector', verifyToken, ctrl.setMiSector);
router.get('/solicitudes', verifyToken, ctrl.getSolicitudes);
router.get('/solicitudes/:id', verifyToken, ctrl.getSolicitudDetalle);
router.post('/solicitudes', verifyToken, ctrl.crearSolicitud);
router.post('/solicitudes/:id/estado', verifyToken, ctrl.setEstadoSolicitud);
router.get('/compras', verifyToken, ctrl.getCompras);
// Gestión de sistema (maestros)
router.get('/gestion/proveedores', verifyToken, ctrl.getProveedores);
router.post('/gestion/proveedores', verifyToken, ctrl.guardarProveedor);
router.put('/gestion/proveedores/:id', verifyToken, ctrl.guardarProveedor);
router.delete('/gestion/proveedores/:id', verifyToken, ctrl.borrarProveedor);
router.get('/gestion/depositos', verifyToken, ctrl.getDepositosGestion);
router.post('/gestion/depositos', verifyToken, ctrl.guardarDeposito);
router.put('/gestion/depositos/:id', verifyToken, ctrl.guardarDeposito);
router.get('/gestion/plantillas', verifyToken, ctrl.getPlantillas);
router.post('/gestion/plantillas', verifyToken, ctrl.guardarPlantilla);
router.put('/gestion/plantillas/:id', verifyToken, ctrl.guardarPlantilla);
router.get('/gestion/catalogo', verifyToken, ctrl.getCatalogo);
router.get('/gestion/articulos', verifyToken, ctrl.getArticulosGestion);
router.put('/gestion/articulos/:varId/costo', verifyToken, ctrl.guardarCostoVariante);
router.get('/gestion/limites', verifyToken, ctrl.getLimites);
router.get('/gestion/limites-agrupados', verifyToken, ctrl.getLimitesAgrupados);
router.put('/gestion/limites-lote', verifyToken, ctrl.guardarLimitesLote);
router.put('/gestion/limites/:varId', verifyToken, ctrl.guardarLimites);

router.get('/compras-catalogos', verifyToken, ctrl.getComprasCatalogos);
router.get('/compras-ref-libre', verifyToken, ctrl.chequearReferencia);
router.post('/pagos-motivos', verifyToken, ctrl.crearMotivoPago);
router.get('/compras/:id', verifyToken, ctrl.getCompraDetalle);
router.post('/compras', verifyToken, ctrl.crearCompra);
router.put('/compras/:id', verifyToken, ctrl.editarCompra);
router.post('/compras/:id/progreso', verifyToken, ctrl.setProgresoCompra);
router.post('/compras/:id/autorizar', verifyToken, ctrl.autorizarCompra);
router.post('/compras/:id/pagos', verifyToken, ctrl.registrarPagoCompra);
router.post('/compras/:id/recibir', verifyToken, ctrl.recibirCompra);
// Adjuntos de la compra (facturas, BL, despachos): disco + índice en tabla
router.post('/compras/:id/costos', verifyToken, ctrl.agregarCostoExtra);
router.delete('/compras/costos/:cceId', verifyToken, ctrl.borrarCostoExtra);
router.post('/compras/:id/plantilla', verifyToken, ctrl.setPlantillaCompra);
router.get('/compras/:id/archivos', verifyToken, ctrl.getCompraArchivos);
router.post('/compras/:id/archivos', verifyToken, (req, res) => {
    ctrl.uploadCompraArchivo(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        ctrl.subirCompraArchivo(req, res);
    });
});
router.delete('/compras/archivos/:carId', verifyToken, ctrl.borrarCompraArchivo);
router.get('/discrepancias', verifyToken, ctrl.getDiscrepancias);
router.post('/discrepancias/:id/resolver', verifyToken, ctrl.resolverDiscrepancia);

module.exports = router;
