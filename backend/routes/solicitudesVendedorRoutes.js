'use strict';
// /api/solicitudes-vendedor — captación de solicitudes de vendedores (specs/41). Solo usuarios internos.
// Quién puede qué (vendedor / diseñador habilitado / admin) lo decide el service:
// "diseñador" no es un rol de login, es la tabla SolicitudesVendedorDisenadores.
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/solicitudesVendedorController');
const upload = require('../middleware/multerSolicitudesConfig');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(soloInternoConRol());

// Catálogos del módulo
router.get('/mi-perfil', ctrl.miPerfil);
router.get('/vendedores', ctrl.listarVendedores);
router.get('/disenadores', ctrl.listarDisenadores);
router.get('/materiales-principal', ctrl.materialesPrincipal);   // telas de sublimación que elige el diseñador
router.put('/disenadores/:idUsuario', ctrl.definirDisenador);

// Bandeja común de Diseño y trabajo sobre cada parte
router.get('/bandeja-diseno', ctrl.bandeja);
router.get('/disenos-en-produccion', ctrl.disenosEnProduccion);   // Bordado / TPU ya en planta que esperan su diseño (solo lectura)
router.post('/partes/:parteId/enviar-diseno', ctrl.enviarADiseno);
router.post('/partes/:parteId/tomar', ctrl.tomarParte);
router.post('/partes/:parteId/aceptar-cambio', ctrl.aceptarCambio);

// Solicitudes
router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.get('/:id', ctrl.obtener);
router.put('/:id', ctrl.actualizar);
router.put('/:id/precio', ctrl.guardarPrecio);
router.post('/:id/sena/confirmar', ctrl.confirmarSena);
router.post('/:id/interacciones', ctrl.agregarInteraccion);
router.post('/:id/cancelar', ctrl.cancelar);
router.post('/:id/archivos', upload.single('file'), ctrl.subirArchivo);
router.delete('/:id/archivos/:archivoId', ctrl.quitarArchivo);
router.put('/:id/archivos/:archivoId/produccion', ctrl.definirProduccionArchivo);   // tela + copias de un diseño pronto

// Conversión a pedido de producción (un pedido por producto)
router.get('/:id/bobinas', ctrl.bobinasDelCliente);   // tela del cliente: la bobina se elige al convertir
router.post('/:id/productos/:productoSolId/convertir', ctrl.convertir);
router.post('/:id/productos/:productoSolId/reintentar-archivos', ctrl.reintentarArchivos);

module.exports = router;
