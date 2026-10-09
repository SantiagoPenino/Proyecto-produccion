const express = require('express');
const router = express.Router();
const c = require('../controllers/servicioTecnicoController');
const eq = require('../controllers/stEquiposController');
const fi = require('../controllers/stFichaEquipoController');
const mt = require('../controllers/stMantenimientoController');
const pr = require('../controllers/stProyectosController');
const ins = require('../controllers/stInsumosController');
const rep = require('../controllers/stReportesController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');
const { subirAdjuntos } = require('../middleware/multerServicioTecnico');

// Servicio Técnico (docs/servicio-tecnico-plan.md). Todo el módulo: usuario interno logueado.
// Las acciones de técnico (tomar, derivar, finalizar, editar, estado de máquina) las controla
// el controller: Admin o área SERVICIO.
router.use(verifyToken, soloInternoConRol());

// Columnas del 30/09 (franja horaria de los trabajos; días, franja y tiempo de los planes): la primera vez
// se agregan solas. Si falla, sigue igual y lo vuelve a intentar en el próximo pedido.
const { getPool } = require('../config/db');
const { asegurarEsquemaMantenimiento } = require('../services/stMantenimientoService');
router.use((req, res, next) => {
    getPool().then(asegurarEsquemaMantenimiento).then(() => next(), (err) => {
        require('../utils/logger').warn(`[ServicioTecnico] columnas de mantenimiento: ${err.message}`);
        next();
    });
});

router.get('/meta', c.getMeta);
router.get('/usuarios', c.getUsuarios);
router.get('/tipos-falla', c.tiposFalla);                        // ?categoria=&q=

router.get('/solicitudes', c.listar);                            // ?q=&estado=&categoria=&prioridad=&tecnico=&area=&equipo=&desde=&hasta=&mias=1
router.post('/solicitudes', subirAdjuntos, c.crear);             // multipart: campos + adjuntos
router.get('/solicitudes/:id', c.detalle);
router.put('/solicitudes/:id', c.editar);
router.post('/solicitudes/:id/tomar', c.tomar);
router.post('/solicitudes/:id/asignar', c.asignar);              // { tecnicoId } — encargado o Admin
router.post('/solicitudes/:id/estado', c.cambiarEstado);         // { estado: EN_CURSO | EN_ESPERA, motivo }
router.post('/solicitudes/:id/derivar', c.derivar);              // { tecnicoId | externo, motivo }
router.post('/solicitudes/:id/finalizar', c.finalizar);
router.post('/solicitudes/:id/reabrir', c.reabrir);              // { motivo }
router.post('/solicitudes/:id/comentarios', c.comentar);         // { texto }
router.post('/solicitudes/:id/adjuntos', subirAdjuntos, c.adjuntar);

router.get('/adjuntos/:adjId', c.verAdjunto);
router.put('/config/encargado', c.setEncargado);                 // { usuarioId | null } — Admin o el encargado actual

// Máquinas (etapa 2): ficha, estado e historial de cambios
router.get('/equipos', eq.listar);                               // ?inactivas=1
router.post('/equipos', eq.crearEquipo);                         // { nombre, areaId, tipo, esImpresora } — técnicos (08/10)
router.get('/equipos/:id', eq.ficha);
router.put('/equipos/:id/estado', c.cambiarEstadoMaquina);       // { estado, motivo, solId? }
// Ficha técnica (08/10, docs/servicio-tecnico/ficha-tecnica-maquinas-plan.md): una sección por vez, o copiar de otra
router.put('/equipos/:id/ficha', fi.guardarFicha);              // { seccion, titulo, valores, resumen } | { copiarDe }
router.put('/equipos/:id/capacidad', fi.guardarCapacidad);      // columnas de ConfigEquipos (Planificación) + extra
// Parte 2 (08/10): preventivo y repuestos críticos de la máquina
router.get('/equipos/:id/preventivo', mt.preventivoEquipo);      // planes, programado (con lo vencido) y últimos cerrados
router.get('/equipos/:id/repuestos', ins.repuestosEquipo);       // repuestos con el stock y los límites del /stock
router.post('/equipos/:id/repuestos', ins.agregarRepuesto);      // { varId, nota } — técnicos
router.delete('/equipos/:id/repuestos/:repId', ins.quitarRepuesto); // técnicos
// Parte 3 (08/10): fotos, manuales y otros archivos de la máquina (ST_Adjuntos, Entidad EQUIPO) — técnicos
router.post('/equipos/:id/adjuntos', subirAdjuntos, eq.adjuntarEquipo);  // multipart: adjuntos
router.put('/equipos/:id/adjuntos/:adjId', eq.renombrarAdjuntoEquipo);  // { nombre }
router.delete('/equipos/:id/adjuntos/:adjId', eq.borrarAdjuntoEquipo);
router.post('/equipos/:id/cambios', subirAdjuntos, eq.crearCambio);
router.put('/cambios/:camId', eq.editarCambio);
router.delete('/cambios/:camId', eq.borrarCambio);               // solo Admin
router.post('/cambios/:camId/adjuntos', subirAdjuntos, eq.adjuntarCambio);

// Mantenimientos (etapa 3): procedimientos, planes, trabajos del calendario, "Mi semana"
router.get('/procedimientos', mt.listarProcedimientos);           // ?todos=1
router.get('/procedimientos/:id', mt.detalleProcedimiento);
// { titulo, descripcion, areaId, equipoId, pasos, insumos }; con fotos de insumos, multipart ("datos" JSON + "adjuntos")
router.post('/procedimientos', subirAdjuntos, mt.guardarProcedimiento);
router.put('/procedimientos/:id', subirAdjuntos, mt.guardarProcedimiento);
router.put('/procedimientos/:id/activo', mt.activarProcedimiento);
router.get('/planes', mt.listarPlanes);                           // ?todos=1
router.post('/planes', mt.crearPlan);
router.put('/planes/:id', mt.editarPlan);
router.put('/planes/:id/activo', mt.activarPlan);
router.get('/trabajos', mt.listarTrabajos);                       // ?desde=&hasta=&tecnico=yo|sin|id&vencidos=1
router.get('/mi-semana', mt.miSemana);
router.post('/trabajos', mt.crearTrabajo);
router.get('/trabajos/:id', mt.detalleTrabajo);
router.put('/trabajos/:id', mt.editarTrabajo);
router.post('/trabajos/:id/posponer', mt.posponer);               // { fecha, motivo }
router.post('/trabajos/:id/empezar', mt.empezar);
router.post('/trabajos/:id/terminar', mt.terminar);               // { resultado, minutosReales, observaciones, motivo, estadoEquipo }
router.post('/trabajos/:id/cancelar', mt.cancelar);               // { motivo }
router.put('/trabajos/:id/tareas/:tareaId', mt.marcarTarea);      // { hecha, nota }
router.post('/trabajos/:id/tareas', mt.agregarTarea);             // { texto, minutos }
router.post('/trabajos/:id/comentarios', mt.comentarTrabajo);
router.post('/trabajos/:id/adjuntos', subirAdjuntos, mt.adjuntarTrabajo);
router.post('/solicitudes/:id/seguimiento', mt.seguimientoHecho); // { nota } → seguimiento hecho

// Proyectos (etapa 4)
router.get('/proyectos', pr.listar);                              // ?estado=ABIERTOS|TODOS|<estado>&q=
router.post('/proyectos', pr.crear);
router.get('/proyectos/:id', pr.detalle);
router.put('/proyectos/:id', pr.editar);
router.post('/proyectos/:id/avance', subirAdjuntos, pr.avance);   // multipart: texto, progreso, adjuntos
router.post('/proyectos/:id/estado', pr.cambiarEstado);           // { estado, motivo }
router.post('/proyectos/:id/adjuntos', subirAdjuntos, pr.adjuntar);

// Insumos del stock (etapa 4)
router.get('/insumos/config', ins.config);
router.put('/insumos/config', ins.setDeposito);                   // { depositoId | null } — solo Admin
router.get('/insumos/stock', ins.stock);                          // ?dep=&q=
router.get('/insumos/usos', ins.listarUsos);                      // ?desde=&hasta=&q=&equipo=&solId=&trabId=&proyId=
router.post('/insumos/usos', ins.registrarUso);                   // { varId, depId, cantidad, solId, trabId, proyId, equipoId, nota, forzar }

// Reportes (etapa 5) — técnicos y Admin
router.get('/reportes/resumen', rep.resumen);                     // ?desde=&hasta=
router.get('/reportes/semanal', rep.semanal);                     // ?semana=AAAA-MM-DD

module.exports = router;
