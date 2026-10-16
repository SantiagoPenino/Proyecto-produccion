'use strict';
// /api/solicitudes-vendedor — captación de solicitudes de vendedores (specs/41). Usuarios internos.
// Quién puede qué (vendedor / diseñador habilitado / admin) lo decide el service:
// "diseñador" no es un rol de login, es la tabla SolicitudesVendedorDisenadores.
// [PORTAL] Un cliente del portal entra SOLO a unas pocas rutas, sobre los pedidos que arma en la Tienda
// (middleware/solicitudesClientePortal.js); para los internos sigue siendo soloInternoConRol().
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/solicitudesVendedorController');
const upload = require('../middleware/multerSolicitudesConfig');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(require('../middleware/solicitudesClientePortal'));

// Catálogos del módulo
router.get('/mi-perfil', ctrl.miPerfil);
router.get('/vendedores', ctrl.listarVendedores);
router.get('/disenadores', ctrl.listarDisenadores);
router.get('/materiales-principal', ctrl.materialesPrincipal);   // telas de sublimación que elige el diseñador
router.put('/disenadores/:idUsuario', ctrl.definirDisenador);

// Bandeja común de Diseño y trabajo sobre cada parte
router.get('/bandeja-diseno', ctrl.bandeja);
router.get('/bandeja-diseno/hechos', ctrl.disenosHechos);   // [15/10] lo que Diseño ya terminó (?desde=AAAA-MM-DD&hasta=…; sin fechas, hoy)
router.get('/disenos-en-produccion', ctrl.disenosEnProduccion);   // Bordado / TPU ya en planta que esperan su diseño (solo lectura)
router.post('/partes/:parteId/enviar-diseno', ctrl.enviarADiseno);
router.post('/partes/:parteId/tomar', ctrl.tomarParte);
router.post('/partes/:parteId/aceptar-cambio', ctrl.aceptarCambio);
// Tizadas de TizadaPro (base externa del mismo servidor, solo lectura)
router.get('/tizadapro/trabajos', ctrl.tizadasTizadaPro);          // tizadas terminadas para elegir (?dias=15)
router.post('/partes/:parteId/tizada', ctrl.vincularTizada);       // vincular una a la producción principal

// Calendario de entregas y trabajo planificado (solo lectura)
router.get('/calendario', ctrl.calendario);

// Solicitudes
router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.get('/:id', ctrl.obtener);
router.get('/:id/plazo', ctrl.estimarPlazo);
router.get('/:id/ficha-pdf', ctrl.fichaPdf);
// TIZADA PRO por API: diseños + lista de talles del producto, mandar, y actualizar un envío
router.get('/:id/productos/:productoSolId/tizadapro', ctrl.tizadaProVer);
router.post('/:id/productos/:productoSolId/tizadapro/editables', ctrl.tizadaProEditables);   // leer los editables de un arte (con el proceso sugerido)
router.put('/:id/productos/:productoSolId/tizadapro', ctrl.tizadaProGuardar);
router.post('/:id/productos/:productoSolId/tizadapro/enviar', ctrl.tizadaProEnviar);
router.post('/:id/productos/:productoSolId/tizadapro/calcular', ctrl.tizadaProCalcular);          // [A MEDIDA] cuentas de TIZADA para una medida (no guarda)
router.get('/:id/productos/:productoSolId/tizadapro/arte/:archivoId', ctrl.tizadaProArteVista);        // [A MEDIDA] la vista del arte, para verla sobre el corte
router.post('/:id/productos/:productoSolId/tizadapro/plantilla', ctrl.tizadaProPlantillaPedir);   // [A MEDIDA] pedir la plantilla con la medida de cada diseño
router.get('/:id/productos/:productoSolId/tizadapro/plantilla', ctrl.tizadaProPlantillaEstado);   // estado y archivos
router.get('/:id/productos/:productoSolId/tizadapro/plantilla/archivo', ctrl.tizadaProPlantillaBajar);   // ?nombre=… (pasa por acá: la llave no sale)
router.post('/:id/tizadapro/envios/:envioId/actualizar', ctrl.tizadaProActualizar);   // ficha del pedido en PDF (la misma que se adjunta al pedido al convertir)   // ¿se llega a la fecha de entrega? (sobre la cola real de cada sector)
router.put('/:id', ctrl.actualizar);
router.put('/:id/datos', ctrl.guardarDatos);   // [GUARDADO AUTOMÁTICO 15/10] un dato a la vez (nombre, detalle, fechas, cliente, cantidad)
router.put('/:id/precio', ctrl.guardarPrecio);
router.post('/:id/sena/confirmar', ctrl.confirmarSena);
router.post('/:id/interacciones', ctrl.agregarInteraccion);
router.post('/:id/cancelar', ctrl.cancelar);
router.post('/:id/archivos', upload.single('file'), ctrl.subirArchivo);
router.delete('/:id/archivos/:archivoId', ctrl.quitarArchivo);
router.get('/:id/archivos/:archivoId/piezas', ctrl.piezasDelArte);   // vista de cada pieza (mesa) de un arte .ai / .pdf
router.put('/:id/archivos/:archivoId/produccion', ctrl.definirProduccionArchivo);   // tela + copias de un diseño pronto

// Sublimación: modelo + tela y arte por pieza (producto del catálogo con molde de TizadaPro)
router.get('/:id/productos/:productoSolId/molde', ctrl.moldeDelProducto);
router.get('/:id/productos/:productoSolId/extras-formas', ctrl.formasDeExtras);   // [TIPO DEL EXTRA 14/10] cómo se puede hacer cada extra
router.put('/:id/productos/:productoSolId/extras/:tipo', ctrl.cambiarExtra);
router.post('/:id/productos/:productoSolId/correccion', ctrl.correccionAbrir);              // [15/10] corregir el diseño de un pedido ya en producción
router.post('/:id/productos/:productoSolId/correccion/cancelar', ctrl.correccionCancelar);
router.get('/:id/productos/:productoSolId/correccion/plan', ctrl.correccionPlan);           // qué le pasa a cada orden (solo lectura)
router.post('/:id/productos/:productoSolId/correccion/aplicar', ctrl.correccionAplicar);    // "Pasar al pedido"       // [FASE 1 15/10] agregar / quitar un extra desde la tabla del arte
router.put('/:id/productos/:productoSolId/sublimacion', ctrl.guardarSublimacion);
router.put('/:id/productos/:productoSolId/talles', ctrl.guardarTalles);          // lista de talles / medidas / nombres y números

// Conversión a pedido de producción (un pedido por producto)
router.get('/:id/bobinas', ctrl.bobinasDelCliente);   // tela del cliente: la bobina se elige al convertir
router.post('/:id/productos/:productoSolId/convertir', ctrl.convertir);
router.post('/:id/productos/:productoSolId/reintentar-archivos', ctrl.reintentarArchivos);
router.post('/:id/productos/:productoSolId/recuperar-archivos', ctrl.recuperarArchivos);   // tizada rehecha → órdenes del pedido

module.exports = router;
