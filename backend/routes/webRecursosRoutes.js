const express = require('express');
const router = express.Router();
const webRecursosController = require('../controllers/webRecursosController');

// 👇 Middleware
const { verifyToken } = require('../middleware/authMiddleware');

// "MIS RECURSOS" DEL PORTAL DEL CLIENTE (solo lectura, cliente fijado por el token)
router.get('/mis-recursos', verifyToken, webRecursosController.getMisRecursos);
router.get('/mis-recursos/cuentas/:CueIdCuenta/movimientos', verifyToken, webRecursosController.getMovimientosMiRecurso);

// TELAS DEL CLIENTE (metros físicos en depósito, mismo dato que el 360)
router.get('/mis-telas', verifyToken, webRecursosController.getMisTelas);
router.get('/mis-telas/estado-cuenta', verifyToken, webRecursosController.getEstadoCuentaMisTelas);
router.get('/mis-telas/avisos-excedente', verifyToken, webRecursosController.getMisAvisosExcedente);
router.post('/mis-telas/:bobinaId/solicitar-devolucion', verifyToken, webRecursosController.solicitarDevolucionMiTela);

module.exports = router;
