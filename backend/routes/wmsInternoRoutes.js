// Rutas de la gestión del WMS PROPIO (sección /stock del admin).
// Montado en /api/wms-interno (server.js). Solo usuarios internos (19/10): antes bastaba con
// verifyToken, que acepta también el token de un cliente del portal. Nadie del portal, el tótem
// ni páginas públicas llama a estas rutas (revisado ruta por ruta).
const express = require('express');
const router = express.Router();
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/wmsInternoController');
const { webpEnSubida } = require('../utils/imagenWebp');

router.use(verifyToken, soloInternoConRol());

router.get('/depositos', ctrl.getDepositos);
router.get('/panel', ctrl.getPanel);
router.get('/historial', ctrl.getHistorial);
router.get('/gasto-sectores', ctrl.getGastoSectores);
router.get('/inventario', ctrl.getInventario);
router.get('/variantes', ctrl.buscarVariantes);
router.get('/variantes/:id/etiquetas', ctrl.getEtiquetasVariante);
router.get('/etiquetas/buscar', ctrl.buscarEtiqueta);
router.post('/ingresos', ctrl.crearIngreso);
router.post('/etiquetas/:id/ajuste', ctrl.ajustarEtiqueta);
router.post('/etiquetas/:id/baja', ctrl.bajaEtiqueta);
router.post('/etiquetas/:id/peso', ctrl.registrarPeso);
// Importaciones: expedientes que agrupan compras
router.get('/importaciones', ctrl.getImportaciones);
router.get('/importaciones/:id', ctrl.getImportacionDetalle);
router.post('/importaciones', ctrl.crearImportacion);
router.post('/importaciones/:id/progreso', ctrl.setProgresoImportacion);
router.post('/importaciones/:id/compras', ctrl.vincularCompraImportacion);
router.get('/remitos', ctrl.getRemitos);
router.get('/remitos/:id', ctrl.getRemitoDetalle);
router.post('/remitos', ctrl.crearRemito);
router.post('/remitos/:id/cancelar', ctrl.cancelarRemito);
router.post('/remitos/items/:id/recibir', ctrl.recibirRemitoItem);
router.get('/mi-sector', ctrl.getMiSector);
router.post('/mi-sector', ctrl.setMiSector);
router.get('/solicitudes', ctrl.getSolicitudes);
router.get('/solicitudes/:id', ctrl.getSolicitudDetalle);
router.post('/solicitudes', ctrl.crearSolicitud);
router.post('/solicitudes/:id/despachar', ctrl.despacharSolicitud);
router.post('/solicitudes/:id/estado', ctrl.setEstadoSolicitud);
// Sector del stock de cada área, para el botón de insumos del área (29/09)
router.get('/area-deposito', ctrl.getAreaDeposito);
router.put('/area-deposito', ctrl.setAreaDeposito);
router.get('/compras', ctrl.getCompras);
// Gestión de sistema (maestros)
router.get('/gestion/proveedores', ctrl.getProveedores);
router.post('/gestion/proveedores', ctrl.guardarProveedor);
router.put('/gestion/proveedores/:id', ctrl.guardarProveedor);
router.delete('/gestion/proveedores/:id', ctrl.borrarProveedor);
router.get('/gestion/depositos', ctrl.getDepositosGestion);
router.post('/gestion/depositos', ctrl.guardarDeposito);
router.put('/gestion/depositos/:id', ctrl.guardarDeposito);
router.get('/gestion/plantillas', ctrl.getPlantillas);
router.post('/gestion/plantillas', ctrl.guardarPlantilla);
router.put('/gestion/plantillas/:id', ctrl.guardarPlantilla);
router.get('/gestion/catalogo', ctrl.getCatalogo);
router.get('/gestion/articulos', ctrl.getArticulosGestion);
router.put('/gestion/articulos/:varId/costo', ctrl.guardarCostoVariante);
router.get('/gestion/limites', ctrl.getLimites);
router.get('/gestion/limites-agrupados', ctrl.getLimitesAgrupados);
router.put('/gestion/limites-lote', ctrl.guardarLimitesLote);
router.put('/gestion/limites/:varId', ctrl.guardarLimites);

router.get('/compras-catalogos', ctrl.getComprasCatalogos);
router.get('/compras-ref-libre', ctrl.chequearReferencia);
router.post('/pagos-motivos', ctrl.crearMotivoPago);
router.get('/compras/:id', ctrl.getCompraDetalle);
router.post('/compras', ctrl.crearCompra);
router.put('/compras/:id', ctrl.editarCompra);
router.post('/compras/:id/progreso', ctrl.setProgresoCompra);
router.post('/compras/:id/autorizar', ctrl.autorizarCompra);
router.post('/compras/:id/pagos', ctrl.registrarPagoCompra);
router.post('/compras/:id/recibir', ctrl.recibirCompra);
router.post('/compras/:id/anular', ctrl.anularCompra);   // cargada por error: queda en «Anuladas»
// Adjuntos de la compra (facturas, BL, despachos): disco + índice en tabla
router.post('/compras/:id/costos', ctrl.agregarCostoExtra);
router.delete('/compras/costos/:cceId', ctrl.borrarCostoExtra);
router.post('/compras/:id/plantilla', ctrl.setPlantillaCompra);
router.get('/compras/:id/archivos', ctrl.getCompraArchivos);
router.post('/compras/:id/archivos', (req, res) => {
    ctrl.uploadCompraArchivo(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        // Fotos → WebP 80 ≤ 1080 px (07/10/2026); PDF, Office, XML y ZIP quedan igual.
        webpEnSubida(req, res, () => ctrl.subirCompraArchivo(req, res));
    });
});
router.delete('/compras/archivos/:carId', ctrl.borrarCompraArchivo);
router.get('/discrepancias', ctrl.getDiscrepancias);
router.post('/discrepancias/:id/resolver', ctrl.resolverDiscrepancia);

module.exports = router;
