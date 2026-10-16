const express = require('express');
const router = express.Router();
const c = require('../controllers/desarrollosController');
const p = require('../controllers/desarrollosPedidosController');
const pr = require('../controllers/desarrollosProyectosController');
const pl = require('../controllers/desarrollosPlantillasController');
const pn = require('../controllers/desarrollosPlanificacionController');
const mu = require('../controllers/desarrollosMuestrasController');
const ca = require('../controllers/desarrollosCatalogoController');
const { verifyToken, soloInternoConRol } = require('../middleware/authMiddleware');
const { subirAdjuntos } = require('../middleware/multerDesarrollos');
const { getPool } = require('../config/db');
const { asegurarEsquema } = require('../services/desarrollos/esquema');
const logger = require('../utils/logger');

// Desarrollos (docs/desarrollos/plan-integracion.md). Todo el módulo: usuario interno logueado.
// Qué puede hacer cada uno (equipo editor/colaborador, o quien pidió algo) lo controla cada
// controller con services/desarrollos/comun.js.
router.use(verifyToken, soloInternoConRol());

// Las tablas se crean solas la primera vez (services/desarrollos/esquema.js).
router.use((req, res, next) => {
    getPool().then(asegurarEsquema).then(() => next(), (err) => {
        logger.error(`[Desarrollos] no se pudieron crear las tablas: ${err.message}`);
        res.status(503).json({ success: false, error: 'Desarrollos no está listo: no se pudieron crear sus tablas en la base.' });
    });
});

router.get('/sesion', c.sesion);
router.get('/catalogos', c.catalogos);

// Equipo de desarrollo (reemplaza a "Más › Equipo" del prototipo)
router.get('/equipo', c.equipo);
router.get('/equipo/candidatos', c.candidatos);             // ?q=
router.put('/equipo/:usuarioId', c.guardarMiembro);         // { nivel: EDITOR|COLABORADOR, lineas: [SB, DIRECTA, ECOUV] }
router.delete('/equipo/:usuarioId', c.quitarMiembro);

// Comunes a pedidos, proyectos y muestras (:entidad = solicitud | proyecto | muestra)
router.get('/comentarios/:entidad/:id', c.comentarios);
router.post('/comentarios/:entidad/:id', c.comentar);       // { texto }
router.get('/historial/:entidad/:id', c.historial);
router.get('/adjuntos/:entidad/:id', c.adjuntos);
router.post('/adjuntos/:entidad/:id', subirAdjuntos, c.adjuntar);
router.get('/adjunto/:adjId', c.verAdjunto);
router.delete('/adjunto/:adjId', c.quitarAdjunto);

// Fase 1: Pedidos (quien pide) y Bandeja (el equipo decide)
router.get('/pedidos/mios', p.mios);
router.get('/bandeja', p.bandeja);
router.post('/pedidos', p.crear);                            // { titulo, descripcion, cliente: {id, texto}, fechaLimite, (equipo) tipo, tipoId, cantidad, pedidoPorUsuarioId|pedidoPorTexto }
router.get('/pedidos/:id', p.detalle);
router.put('/pedidos/:id', p.editar);
router.post('/pedidos/:id/aprobar', p.aprobar);              // { plantillaId, corrigeProyectoId } — editor
router.post('/pedidos/:id/posponer', p.posponer);            // { motivo, fechaRevision }
router.post('/pedidos/:id/descartar', p.descartar);          // { motivo }
router.post('/pedidos/:id/reabrir', p.reabrir);
router.delete('/pedidos/:id', p.borrar);                     // editor; queda marcado borrado
router.get('/clientes', p.clientes);                         // ?q= (los del vendedor primero)
router.get('/usuarios', p.usuarios);
router.get('/proyectos/opciones', p.proyectosOpciones);

// Fase 2: Proyectos y su ficha, Tareas, Archivo (lectura de /proyectos) y Plantillas
router.get('/proyectos', pr.listar);                          // todos, con tareas y resumen
router.post('/proyectos', pr.crear);                          // { nombre, plantillaId, lineaAreaId, liderId, fechaInicio } — editor
router.get('/proyectos/:id', pr.ficha);
router.put('/proyectos/:id', pr.guardar);                     // solo los campos que vienen — editor
router.post('/proyectos/:id/cancelar', pr.cancelar);
router.post('/proyectos/:id/reactivar', pr.reactivar);
router.delete('/proyectos/:id', pr.borrar);                   // queda marcado borrado
router.post('/proyectos/:id/plantilla', pr.guardarComoPlantilla); // { nombre }
router.post('/proyectos/:id/tareas', pr.nuevaTarea);          // { etapaId, nombre }
router.post('/tareas/confirmar-fechas', pr.confirmarFechas);  // { items: [{ tareaId, fecha }] }
router.put('/tareas/:id', pr.editarTarea);                    // { estado, responsableId, fecha, nombre, etapaId, diasHabiles, entregable, nota, depende }
router.post('/tareas/:id/mover', pr.moverTarea);              // { dir: -1 | 1 }
router.post('/tareas/:id/alta-erp', pr.altaErp);              // { proIdProducto }
router.delete('/tareas/:id', pr.quitarTarea);
router.get('/articulos', pr.articulos);                       // ?q=
router.get('/plantillas', pl.listar);
router.post('/plantillas', pl.guardar);
router.put('/plantillas/:id', pl.guardar);
router.delete('/plantillas/:id', pl.borrar);
router.put('/tipos', pl.guardarTipos);                        // { tipos: [{ id?, nombre, esProducto }] }

// Fase 3: Planificación (tandas y lista de desarrollo) e Inicio
router.get('/tandas', pn.listar);                             // tandas, plan y orden manual
router.put('/plan', pn.guardarPlan);                          // { horizonte, tanda }
router.put('/orden', pn.guardarOrden);                        // { ids }
router.post('/tandas', pn.crear);
router.put('/tandas/:id', pn.editar);                         // { nombre, inicio, fin, objetivo }
router.delete('/tandas/:id', pn.borrar);
router.post('/tandas/:id/vincular', pn.vincular);             // { proyectoId, grupoId? }
router.post('/tandas/:id/tareas', pn.tareas);                 // { agregar, quitar, accion }
router.post('/tandas/:id/desvincular', pn.desvincular);       // { proyectoId }
router.post('/tandas/:id/grupos', pn.crearGrupo);
router.put('/tandas/:id/grupos/:gid', pn.renombrarGrupo);     // { nombre }
router.delete('/tandas/:id/grupos/:gid', pn.borrarGrupo);
router.put('/tandas/:id/proyectos/:pid', pn.moverAGrupo);     // { grupoId }
router.post('/tandas/:id/cerrar', pn.cerrar);                 // { pasar }
router.post('/tareas/:id/a-tanda', pn.tareaATanda);
router.get('/muestras/resumen', pn.resumenMuestras);

// Fase 4: Muestras y Catálogo técnico (capacidades, variantes, opciones de slot)
router.get('/muestras', mu.listar);
router.get('/muestras/listas', mu.listas);                    // estados y tildes con cuántas muestras los usan
router.put('/muestras/listas', mu.guardarListas);             // { estados: [{ id?, nombre, tono }], tildes: [{ id?, nombre }] } — editor
router.post('/muestras/pegar', mu.pegar);                     // { filas: [{ numero, nombre, marcada, comentario }], estadoSi, estadoNo, proyectoId }
router.post('/muestras', mu.guardar);                         // { ordenes: [{ numero, nombre }], proyectos, estadoId, fechaEnvio, ronda, tildes, comentario }
router.put('/muestras/:id', mu.guardar);
router.put('/muestras/:id/estado', mu.estado);                // { estadoId }
router.put('/muestras/:id/tildes', mu.tilde);                 // { tildeId, marcado }
router.delete('/muestras/:id', mu.borrar);                    // queda marcada borrada
router.get('/ordenes/:codigo', mu.orden);                     // una orden del sistema por su número
router.get('/catalogo', ca.leer);
router.post('/catalogo/capacidades', ca.crearCapacidad);      // { nombre, familia, ambito, nota } — editor
router.post('/catalogo/capacidades/resueltas', ca.marcarResueltas); // { ids }
router.put('/catalogo/capacidades/:id', ca.editarCapacidad);  // { nombre, familia, ambito, nota } o { resuelta }
router.delete('/catalogo/capacidades/:id', ca.borrarCapacidad);
router.put('/proyectos/:id/capacidades', ca.capacidadesProyecto); // { relacion: REQUIERE|RESUELVE, ids }
router.post('/catalogo/variantes', ca.crearVariante);         // { proyectoId, nombre, combinacion, libre }
router.put('/catalogo/variantes/:id', ca.editarVariante);
router.delete('/catalogo/variantes/:id', ca.borrarVariante);
router.put('/catalogo/variantes/:id/tareas/:tareaId', ca.tareaVariante); // { hecho }
router.put('/catalogo/opciones/:id', ca.editarOpcion);        // { estado, habilitada, nota }

module.exports = router;
