// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — solicitudes (etapa 1). Plan: docs/servicio-tecnico-plan.md
//
// Cualquier usuario interno carga solicitudes (fallas de máquinas de producción, PC, internet,
// software, instalaciones) y ve el historial. Tomar, derivar, finalizar, editar y cambiar el
// estado de una máquina: solo técnicos (área SERVICIO) o Admin — esAdminOServicioTecnico.
//
// Estado de la máquina (ConfigEquipos.Estado, el de Configuración → Equipos): si la solicitud
// dice que la máquina NO puede trabajar, pasa a MANTENIMIENTO (fuera de servicio: no suma
// capacidad y no recibe lotes); al finalizar, el técnico elige cómo queda. Ya no se escribe
// FALLA (ver utils/estadoEquipo.js).
//
// Avisos (services/notificacionesService.js): solicitud nueva → encargado (selector guardado en
// ConfiguracionGlobal 'ST_EncargadoId'; si no hay, env ST_ENCARGADO_USUARIO = id o usuario; si
// tampoco, todos los técnicos). Derivación → técnico que la recibe + encargado. Finalizada →
// quien la pidió. Nunca se le avisa a quien hizo la acción.
//
// Tablas: docs/servicio-tecnico/st-etapa1.sql. Fechas con GETDATE() como el resto del sistema;
// las columnas DATE se devuelven como texto 'AAAA-MM-DD' para que el navegador no las corra.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { ESTADOS_EQUIPO, normalizarEstado } = require('../utils/estadoEquipo');
const { notificar } = require('../services/notificacionesService');
const { rutaAdjunto } = require('../middleware/multerServicioTecnico');
const {
    MODULO, CATEGORIAS, PRIORIDADES, ESTADOS, RESULTADOS, ETIQUETA_RESULTADO, ETIQUETA_PRIORIDAD,
    codigo, urlSolicitud, esTecnico, esAdmin, texto, bool, idNum, fechaISO, escaparLike,
    responderError, emitirCambio, avisarTableros, nombreUsuario, usuarioActual, tecnicos, encargado,
    historial, cambiarEstadoEquipo, guardarAdjuntos, limpiarTemporales,
} = require('../services/servicioTecnicoComun');

// Lectura de una solicitud con lo que necesitan la lista y el detalle.
const SELECT_SOLICITUD = `
    SELECT s.SolId, s.Categoria, s.EquipoId, s.EquipoTexto, s.AreaId, s.Titulo, s.Descripcion, s.Prioridad,
           s.MaquinaNoTrabaja, s.EstadoEquipoPrevio, s.Estado, s.EsperaMotivo, s.Resultado,
           s.FechaSolicitud, s.SolicitanteId, s.SolicitanteNombre, s.CargadoPorId, s.CargadoPorNombre,
           s.TecnicoId, s.TecnicoNombre, s.FechaTomada, s.DerivadaExterno,
           s.FechaFin, s.FinalizadaPorId, s.FinalizadaPorNombre, s.TrabajoRealizado,
           s.RequiereSeguimiento, CONVERT(VARCHAR(10), s.FechaSeguimiento, 23) AS FechaSeguimiento, s.SeguimientoNota,
           s.NecesitaRepuestos, s.RepuestosDetalle, s.MinutosParada, s.LegacyTicketId, s.FechaActualizacion,
           s.SeguimientoHechoFecha, s.SeguimientoHechoPor, s.SeguimientoResultado,
           e.Nombre AS EquipoNombre, e.Estado AS EquipoEstado, a.Nombre AS AreaNombre,
           DATEDIFF(MINUTE, s.FechaSolicitud, s.FechaTomada) AS MinutosRespuesta,
           DATEDIFF(MINUTE, s.FechaSolicitud, s.FechaFin) AS MinutosResolucion,
           (SELECT COUNT(*) FROM dbo.ST_Adjuntos ad WHERE ad.Entidad = 'SOLICITUD' AND ad.EntidadId = s.SolId) AS Adjuntos
    FROM dbo.ST_Solicitudes s
    LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = s.EquipoId
    LEFT JOIN dbo.Areas a ON a.AreaID = s.AreaId`;

const conCodigo = (fila) => fila && ({ ...fila, Codigo: codigo(fila.SolId) });

async function leerSolicitud(pool, solId) {
    const r = await pool.request().input('Id', sql.Int, solId).query(`${SELECT_SOLICITUD} WHERE s.SolId = @Id`);
    return conCodigo(r.recordset[0]);
}

// Solo los técnicos actúan; el que pidió la solicitud puede comentar y adjuntar en la suya.
const esDeUsuario = (sol, usuarioId) => usuarioId && (sol.SolicitanteId === usuarioId || sol.CargadoPorId === usuarioId);

// =============================================================================
// GET /meta → datos para armar la pantalla y el formulario
// =============================================================================
exports.getMeta = async (req, res) => {
    try {
        const pool = await getPool();
        const [usuario, enc, tecs, areas, equipos] = await Promise.all([
            usuarioActual(pool, req),
            encargado(pool),
            tecnicos(pool),
            pool.request().query('SELECT LTRIM(RTRIM(AreaID)) AS AreaID, Nombre FROM dbo.Areas WITH (NOLOCK) ORDER BY Nombre'),
            pool.request().query(`SELECT EquipoID, LTRIM(RTRIM(Nombre)) AS Nombre, LTRIM(RTRIM(AreaID)) AS AreaID, Estado
                                  FROM dbo.ConfigEquipos WITH (NOLOCK) WHERE Activo = 1 ORDER BY AreaID, Nombre`),
        ]);
        res.json({
            success: true,
            data: {
                usuario, esTecnico: esTecnico(req), esAdmin: esAdmin(req),
                encargado: enc, tecnicos: tecs,
                areas: areas.recordset, equipos: equipos.recordset,
                estadosEquipo: ESTADOS_EQUIPO,
            },
        });
    } catch (err) { responderError(res, err, 'getMeta'); }
};

// GET /usuarios → usuarios internos activos (quién reporta, encargado)
exports.getUsuarios = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT IdUsuario AS id, LTRIM(RTRIM(ISNULL(NULLIF(Nombre, ''), Usuario))) AS nombre,
                   LTRIM(RTRIM(Usuario)) AS usuario, UPPER(LTRIM(RTRIM(ISNULL(AreaUsuario, '')))) AS area
            FROM dbo.Usuarios WITH (NOLOCK)
            WHERE ISNULL(Activo, 1) = 1
            ORDER BY nombre`);
        res.json({ success: true, data: r.recordset });
    } catch (err) { responderError(res, err, 'getUsuarios'); }
};

// =============================================================================
// GET /solicitudes?q=&estado=&categoria=&prioridad=&tecnico=&area=&equipo=&desde=&hasta=&mias=1
//   estado: ABIERTAS (todo lo no finalizado, default) | TODAS | uno de ESTADOS
// =============================================================================
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        const r = pool.request();
        const where = [];
        const estado = String(req.query.estado || 'ABIERTAS').toUpperCase();
        if (estado === 'ABIERTAS') where.push(`s.Estado <> 'FINALIZADA'`);
        else if (ESTADOS.includes(estado)) { where.push('s.Estado = @Estado'); r.input('Estado', sql.VarChar(20), estado); }

        const categoria = String(req.query.categoria || '').toUpperCase();
        if (CATEGORIAS.includes(categoria)) { where.push('s.Categoria = @Cat'); r.input('Cat', sql.VarChar(20), categoria); }
        const prioridad = String(req.query.prioridad || '').toUpperCase();
        if (PRIORIDADES.includes(prioridad)) { where.push('s.Prioridad = @Prio'); r.input('Prio', sql.VarChar(10), prioridad); }
        const area = texto(req.query.area, 20);
        if (area) { where.push('s.AreaId = @Area'); r.input('Area', sql.VarChar(20), area); }
        const equipo = idNum(req.query.equipo);
        if (equipo) { where.push('s.EquipoId = @Eq'); r.input('Eq', sql.Int, equipo); }
        const tecnico = req.query.tecnico === 'yo' ? idNum(req.user?.id) : idNum(req.query.tecnico);
        if (tecnico) { where.push('s.TecnicoId = @Tec'); r.input('Tec', sql.Int, tecnico); }
        if (bool(req.query.mias)) {
            where.push('(s.SolicitanteId = @Yo OR s.CargadoPorId = @Yo)');
            r.input('Yo', sql.Int, idNum(req.user?.id) || -1);
        }
        const desde = fechaISO(req.query.desde);
        if (desde) { where.push('s.FechaSolicitud >= CAST(@Desde AS DATE)'); r.input('Desde', sql.VarChar(10), desde); }
        const hasta = fechaISO(req.query.hasta);
        if (hasta) { where.push('s.FechaSolicitud < DATEADD(DAY, 1, CAST(@Hasta AS DATE))'); r.input('Hasta', sql.VarChar(10), hasta); }

        // Buscador por palabra: número (ST-12 / 12 / ticket viejo), título, descripción, lo realizado,
        // máquina/equipo, quién la pidió, técnico, servicio externo.
        const q = texto(req.query.q, 100);
        if (q) {
            const num = q.match(/^(?:st-?)?0*(\d{1,7})$/i);
            const partes = [
                's.Titulo LIKE @Q', 's.Descripcion LIKE @Q', 's.TrabajoRealizado LIKE @Q', 's.EquipoTexto LIKE @Q',
                'e.Nombre LIKE @Q', 's.SolicitanteNombre LIKE @Q', 's.TecnicoNombre LIKE @Q',
                's.DerivadaExterno LIKE @Q', 's.RepuestosDetalle LIKE @Q', 's.LegacyTicketId LIKE @Q',
            ];
            if (num) { partes.push('s.SolId = @QNum'); r.input('QNum', sql.Int, parseInt(num[1], 10)); }
            where.push(`(${partes.join(' OR ')})`);
            r.input('Q', sql.NVarChar(120), `%${escaparLike(q)}%`);
        }

        const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 300, 1), 1000);
        r.input('Lim', sql.Int, limite);
        const result = await r.query(`
            SELECT TOP (@Lim) * FROM (${SELECT_SOLICITUD}
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}) x
            -- Abiertas primero: las más urgentes y, dentro de cada prioridad, las más viejas.
            -- Finalizadas después, las más recientes arriba.
            ORDER BY CASE WHEN x.Estado = 'FINALIZADA' THEN 1 ELSE 0 END,
                     CASE WHEN x.Estado <> 'FINALIZADA' THEN CASE x.Prioridad WHEN 'CRITICA' THEN 4 WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END END DESC,
                     CASE WHEN x.Estado <> 'FINALIZADA' THEN x.FechaSolicitud END ASC,
                     x.FechaFin DESC, x.SolId DESC`);
        res.json({ success: true, data: result.recordset.map(conCodigo) });
    } catch (err) { responderError(res, err, 'listar'); }
};

// GET /solicitudes/:id → solicitud + historial + adjuntos + otras abiertas de la misma máquina
exports.detalle = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Solicitud inválida.' });
    try {
        const pool = await getPool();
        const sol = await leerSolicitud(pool, id);
        if (!sol) return res.status(404).json({ success: false, error: 'No existe la solicitud.' });
        const [his, adj, otras] = await Promise.all([
            pool.request().input('Id', sql.Int, id).query(`
                SELECT HisId, Fecha, UsuarioId, UsuarioNombre, Accion, Detalle, Motivo, AUsuarioId, AUsuarioNombre
                FROM dbo.ST_Historial WHERE Entidad = 'SOLICITUD' AND EntidadId = @Id ORDER BY Fecha, HisId`),
            pool.request().input('Id', sql.Int, id).query(`
                SELECT AdjId, NombreOriginal, Mime, Bytes, UsuarioNombre, Fecha
                FROM dbo.ST_Adjuntos WHERE Entidad = 'SOLICITUD' AND EntidadId = @Id ORDER BY Fecha, AdjId`),
            sol.EquipoId
                ? pool.request().input('Id', sql.Int, id).input('E', sql.Int, sol.EquipoId).query(`
                    SELECT SolId, Titulo, Estado, MaquinaNoTrabaja FROM dbo.ST_Solicitudes
                    WHERE EquipoId = @E AND SolId <> @Id AND Estado <> 'FINALIZADA'`)
                : Promise.resolve({ recordset: [] }),
        ]);
        res.json({
            success: true,
            data: {
                ...sol,
                historial: his.recordset,
                adjuntos: adj.recordset,
                otrasAbiertasEquipo: otras.recordset.map(conCodigo),
                puedeActuar: esTecnico(req),
                esMia: !!esDeUsuario(sol, idNum(req.user?.id)),
            },
        });
    } catch (err) { responderError(res, err, 'detalle'); }
};

// =============================================================================
// POST /solicitudes (multipart: campos + adjuntos) → cualquier usuario interno
// =============================================================================
exports.crear = async (req, res) => {
    const b = req.body || {};
    const files = req.files || [];
    const categoria = String(b.categoria || '').toUpperCase();
    const titulo = texto(b.titulo, 200);
    const prioridad = PRIORIDADES.includes(String(b.prioridad || '').toUpperCase()) ? String(b.prioridad).toUpperCase() : 'MEDIA';
    const equipoId = categoria === 'MAQUINA' ? idNum(b.equipoId) : null;

    if (!CATEGORIAS.includes(categoria)) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Elegí el tipo de problema.' }); }
    if (!titulo) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Escribí qué pasa (título).' }); }
    if (categoria === 'MAQUINA' && !equipoId) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Elegí la máquina.' }); }

    let tx = null;
    try {
        const pool = await getPool();
        const usuario = await usuarioActual(pool, req);
        // Quién reporta (hay tablets con usuario propio y otras compartidas por el área):
        //   solicitanteId → un usuario de la lista · solo solicitanteNombre → alguien sin usuario ·
        //   nada → el usuario logueado.
        let solicitante = { id: usuario.id, nombre: usuario.nombre };
        const solicitanteId = idNum(b.solicitanteId);
        const solicitanteTexto = texto(b.solicitanteNombre, 150);
        if (solicitanteId) {
            const nombre = await nombreUsuario(pool, solicitanteId);
            if (!nombre) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'La persona que reporta no existe.' }); }
            solicitante = { id: solicitanteId, nombre };
        } else if (solicitanteTexto) {
            solicitante = { id: null, nombre: solicitanteTexto };
        }
        const maquinaNoTrabaja = !!equipoId && bool(b.maquinaNoTrabaja);

        let areaId = texto(b.areaId, 20);
        let equipo = null;
        if (equipoId) {
            const r = await pool.request().input('E', sql.Int, equipoId)
                .query('SELECT EquipoID, LTRIM(RTRIM(Nombre)) AS Nombre, LTRIM(RTRIM(AreaID)) AS AreaID, Estado FROM dbo.ConfigEquipos WHERE EquipoID = @E');
            equipo = r.recordset[0];
            if (!equipo) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'La máquina elegida no existe.' }); }
            areaId = areaId || equipo.AreaID;
        }

        tx = new sql.Transaction(pool);
        await tx.begin();
        const ins = await tx.request()
            .input('Cat', sql.VarChar(20), categoria)
            .input('Eq', sql.Int, equipoId)
            .input('EqT', sql.NVarChar(150), equipoId ? null : texto(b.equipoTexto, 150))
            .input('Area', sql.VarChar(20), areaId)
            .input('Tit', sql.NVarChar(200), titulo)
            .input('Desc', sql.NVarChar(sql.MAX), texto(b.descripcion, 8000))
            .input('Prio', sql.VarChar(10), prioridad)
            .input('NoTrab', sql.Bit, maquinaNoTrabaja)
            .input('SolId', sql.Int, solicitante.id)
            .input('SolN', sql.NVarChar(150), solicitante.nombre)
            .input('CarId', sql.Int, usuario.id)
            .input('CarN', sql.NVarChar(150), usuario.nombre)
            .query(`INSERT INTO dbo.ST_Solicitudes (Categoria, EquipoId, EquipoTexto, AreaId, Titulo, Descripcion, Prioridad,
                        MaquinaNoTrabaja, SolicitanteId, SolicitanteNombre, CargadoPorId, CargadoPorNombre)
                    OUTPUT INSERTED.SolId
                    VALUES (@Cat, @Eq, @EqT, @Area, @Tit, @Desc, @Prio, @NoTrab, @SolId, @SolN, @CarId, @CarN)`);
        const solId = ins.recordset[0].SolId;

        const detalle = [
            `Prioridad ${ETIQUETA_PRIORIDAD[prioridad]}`,
            equipo ? `Máquina ${equipo.Nombre}${maquinaNoTrabaja ? ' (no puede trabajar)' : ''}` : null,
            solicitante.nombre && solicitante.nombre !== usuario.nombre ? `Reporta ${solicitante.nombre}` : null,
        ].filter(Boolean).join(' · ');
        await historial(tx, { entidadId: solId, usuario, accion: 'CREADA', detalle });

        // La máquina no puede trabajar → fuera de servicio (MANTENIMIENTO). Se guarda cómo estaba.
        let maquinaCambio = false;
        if (maquinaNoTrabaja) {
            const anterior = await cambiarEstadoEquipo(tx, {
                equipoId, nuevo: 'MANTENIMIENTO', usuario, motivo: `Solicitud ${codigo(solId)}: ${titulo}`,
            });
            if (anterior && anterior !== 'MANTENIMIENTO') {
                maquinaCambio = true;
                await tx.request().input('Id', sql.Int, solId).input('Prev', sql.NVarChar(100), anterior)
                    .query('UPDATE dbo.ST_Solicitudes SET EstadoEquipoPrevio = @Prev WHERE SolId = @Id');
            }
        }

        // Sugerencias de título: se suma el uso (o se agrega la primera vez).
        await tx.request().input('Cat', sql.VarChar(20), categoria).input('Tit', sql.NVarChar(200), titulo).query(`
            UPDATE dbo.ST_TiposFalla SET Usos = Usos + 1 WHERE Categoria = @Cat AND Titulo = @Tit;
            IF @@ROWCOUNT = 0 INSERT INTO dbo.ST_TiposFalla (Categoria, Titulo, Usos) VALUES (@Cat, @Tit, 1);`);

        await tx.commit();
        tx = null;

        const adj = await guardarAdjuntos(pool, { entidad: 'SOLICITUD', entidadId: solId, files, usuario });
        if (adj.length) {
            await historial(pool, { entidadId: solId, usuario, accion: 'ADJUNTO', detalle: adj.map(a => a.NombreOriginal).join(', ') });
        }

        // Aviso: al encargado; si no hay encargado, a todos los técnicos. Nunca a quien la cargó.
        const enc = await encargado(pool);
        const destinatarios = (enc ? [enc.id] : (await tecnicos(pool)).map(t => t.id)).filter(id => id !== usuario.id);
        notificar({
            usuarioIds: destinatarios, modulo: MODULO, io: req.app.get('socketio'),
            titulo: `Nueva solicitud ${codigo(solId)} · ${ETIQUETA_PRIORIDAD[prioridad]}`,
            texto: `${equipo ? equipo.Nombre + ': ' : ''}${titulo}${solicitante.nombre ? ' — reporta ' + solicitante.nombre : ''}`,
            url: urlSolicitud(solId), tag: `st-${solId}`,
        });
        emitirCambio(req, solId);
        if (maquinaCambio) avisarTableros(req, equipoId);
        logger.info(`[ServicioTecnico] ${codigo(solId)} creada por ${usuario.nombre} (${categoria}${equipo ? ' · ' + equipo.Nombre : ''})`);
        res.json({ success: true, data: await leerSolicitud(pool, solId) });
    } catch (err) {
        await rollbackSeguro(tx, 'ST crear solicitud');
        limpiarTemporales(files);
        responderError(res, err, 'crear');
    }
};

// Carga la solicitud para una acción de técnico. Responde el error y devuelve null si no corresponde.
async function solicitudParaAccion(req, res, pool, { permitirFinalizada = false } = {}) {
    if (!esTecnico(req)) { res.status(403).json({ success: false, error: 'Solo Servicio Técnico puede hacer esto.' }); return null; }
    const id = idNum(req.params.id);
    if (!id) { res.status(400).json({ success: false, error: 'Solicitud inválida.' }); return null; }
    const sol = await leerSolicitud(pool, id);
    if (!sol) { res.status(404).json({ success: false, error: 'No existe la solicitud.' }); return null; }
    if (!permitirFinalizada && sol.Estado === 'FINALIZADA') {
        res.status(409).json({ success: false, error: `${sol.Codigo} ya está finalizada.` }); return null;
    }
    return sol;
}

// POST /solicitudes/:id/tomar → el técnico la toma (queda EN_CURSO a su nombre)
exports.tomar = async (req, res) => {
    try {
        const pool = await getPool();
        const sol = await solicitudParaAccion(req, res, pool);
        if (!sol) return;
        const usuario = await usuarioActual(pool, req);
        await pool.request().input('Id', sql.Int, sol.SolId).input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .query(`UPDATE dbo.ST_Solicitudes
                    SET TecnicoId = @U, TecnicoNombre = @UN, Estado = 'EN_CURSO', EsperaMotivo = NULL, DerivadaExterno = NULL,
                        FechaTomada = ISNULL(FechaTomada, GETDATE()), FechaActualizacion = GETDATE()
                    WHERE SolId = @Id`);
        await historial(pool, {
            entidadId: sol.SolId, usuario, accion: 'TOMADA',
            detalle: sol.TecnicoId && sol.TecnicoId !== usuario.id ? `Antes la tenía ${sol.TecnicoNombre}` : null,
        });
        emitirCambio(req, sol.SolId);
        res.json({ success: true, data: await leerSolicitud(pool, sol.SolId) });
    } catch (err) { responderError(res, err, 'tomar'); }
};

// POST /solicitudes/:id/estado { estado: EN_CURSO | EN_ESPERA, motivo }
exports.cambiarEstado = async (req, res) => {
    const nuevo = String(req.body?.estado || '').toUpperCase();
    const motivo = texto(req.body?.motivo, 300);
    if (!['EN_CURSO', 'EN_ESPERA'].includes(nuevo)) return res.status(400).json({ success: false, error: 'Estado inválido.' });
    if (nuevo === 'EN_ESPERA' && !motivo) return res.status(400).json({ success: false, error: 'Indicá qué se está esperando.' });
    try {
        const pool = await getPool();
        const sol = await solicitudParaAccion(req, res, pool);
        if (!sol) return;
        const usuario = await usuarioActual(pool, req);
        await pool.request().input('Id', sql.Int, sol.SolId).input('S', sql.VarChar(20), nuevo)
            .input('M', sql.NVarChar(300), nuevo === 'EN_ESPERA' ? motivo : null)
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .query(`UPDATE dbo.ST_Solicitudes
                    SET Estado = @S, EsperaMotivo = @M, FechaActualizacion = GETDATE(),
                        TecnicoId = ISNULL(TecnicoId, @U), TecnicoNombre = ISNULL(TecnicoNombre, @UN),
                        FechaTomada = ISNULL(FechaTomada, GETDATE())
                    WHERE SolId = @Id`);
        await historial(pool, {
            entidadId: sol.SolId, usuario, accion: 'ESTADO',
            detalle: nuevo === 'EN_ESPERA' ? 'En espera' : 'En curso', motivo: nuevo === 'EN_ESPERA' ? motivo : null,
        });
        emitirCambio(req, sol.SolId);
        res.json({ success: true, data: await leerSolicitud(pool, sol.SolId) });
    } catch (err) { responderError(res, err, 'cambiarEstado'); }
};

// POST /solicitudes/:id/derivar { tecnicoId | externo, motivo }
exports.derivar = async (req, res) => {
    const tecnicoId = idNum(req.body?.tecnicoId);
    const externo = texto(req.body?.externo, 200);
    const motivo = texto(req.body?.motivo, 500);
    if (!motivo) return res.status(400).json({ success: false, error: 'El motivo de la derivación es obligatorio.' });
    if (!tecnicoId === !externo) return res.status(400).json({ success: false, error: 'Elegí un técnico o escribí el servicio externo.' });
    try {
        const pool = await getPool();
        const sol = await solicitudParaAccion(req, res, pool);
        if (!sol) return;
        const usuario = await usuarioActual(pool, req);
        const destino = tecnicoId ? { id: tecnicoId, nombre: await nombreUsuario(pool, tecnicoId) } : null;
        if (tecnicoId && !destino.nombre) return res.status(400).json({ success: false, error: 'El técnico elegido no existe.' });

        const r = pool.request().input('Id', sql.Int, sol.SolId)
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre);
        if (destino) {
            r.input('T', sql.Int, destino.id).input('TN', sql.NVarChar(150), destino.nombre);
            await r.query(`UPDATE dbo.ST_Solicitudes
                           SET TecnicoId = @T, TecnicoNombre = @TN, Estado = 'DERIVADA', DerivadaExterno = NULL,
                               EsperaMotivo = NULL, FechaActualizacion = GETDATE()
                           WHERE SolId = @Id`);
        } else {
            // A un servicio externo: la sigue el técnico que la tenía (o quien deriva).
            r.input('X', sql.NVarChar(200), externo);
            await r.query(`UPDATE dbo.ST_Solicitudes
                           SET Estado = 'DERIVADA', DerivadaExterno = @X, EsperaMotivo = NULL,
                               TecnicoId = ISNULL(TecnicoId, @U), TecnicoNombre = ISNULL(TecnicoNombre, @UN),
                               FechaTomada = ISNULL(FechaTomada, GETDATE()), FechaActualizacion = GETDATE()
                           WHERE SolId = @Id`);
        }
        await historial(pool, {
            entidadId: sol.SolId, usuario, accion: 'DERIVADA', motivo,
            detalle: destino ? `A ${destino.nombre}` : `A servicio externo: ${externo}`,
            aUsuario: destino,
        });

        const enc = await encargado(pool);
        const aviso = { modulo: MODULO, io: req.app.get('socketio'), url: urlSolicitud(sol.SolId), tag: `st-${sol.SolId}` };
        if (destino && destino.id !== usuario.id) {
            notificar({ ...aviso, usuarioIds: [destino.id], titulo: `Te derivaron ${sol.Codigo}`, texto: `${sol.Titulo} — motivo: ${motivo}` });
        }
        if (enc && enc.id !== usuario.id && enc.id !== destino?.id) {
            notificar({
                ...aviso, usuarioIds: [enc.id],
                titulo: `${sol.Codigo} derivada a ${destino ? destino.nombre : externo}`,
                texto: `${sol.Titulo} — motivo: ${motivo} (derivó ${usuario.nombre})`,
            });
        }
        emitirCambio(req, sol.SolId);
        res.json({ success: true, data: await leerSolicitud(pool, sol.SolId) });
    } catch (err) { responderError(res, err, 'derivar'); }
};

// POST /solicitudes/:id/finalizar
//   { resultado, trabajoRealizado, requiereSeguimiento, fechaSeguimiento, seguimientoNota,
//     necesitaRepuestos, repuestosDetalle, estadoEquipo ('' = no cambiar) }
exports.finalizar = async (req, res) => {
    const b = req.body || {};
    const resultado = String(b.resultado || '').toUpperCase();
    const trabajo = texto(b.trabajoRealizado, 8000);
    const estadoEquipo = normalizarEstado(b.estadoEquipo);
    if (!RESULTADOS.includes(resultado)) return res.status(400).json({ success: false, error: 'Elegí cómo terminó (resultado).' });
    if (!trabajo) {
        return res.status(400).json({ success: false, error: resultado === 'CANCELADA' ? 'Escribí por qué se cancela.' : 'Describí lo realizado.' });
    }
    if (estadoEquipo && !ESTADOS_EQUIPO.includes(estadoEquipo)) return res.status(400).json({ success: false, error: 'Estado de máquina inválido.' });
    const requiereSeguimiento = bool(b.requiereSeguimiento);
    const fechaSeguimiento = requiereSeguimiento ? fechaISO(b.fechaSeguimiento) : null;

    let tx = null;
    try {
        const pool = await getPool();
        const sol = await solicitudParaAccion(req, res, pool);
        if (!sol) return;
        const usuario = await usuarioActual(pool, req);

        tx = new sql.Transaction(pool);
        await tx.begin();
        await tx.request()
            .input('Id', sql.Int, sol.SolId)
            .input('R', sql.VarChar(20), resultado)
            .input('Trab', sql.NVarChar(sql.MAX), trabajo)
            .input('Seg', sql.Bit, requiereSeguimiento)
            .input('FSeg', sql.VarChar(10), fechaSeguimiento)
            .input('NSeg', sql.NVarChar(500), requiereSeguimiento ? texto(b.seguimientoNota, 500) : null)
            .input('Rep', sql.Bit, bool(b.necesitaRepuestos))
            .input('RepD', sql.NVarChar(1000), bool(b.necesitaRepuestos) ? texto(b.repuestosDetalle, 1000) : null)
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .query(`UPDATE dbo.ST_Solicitudes
                    SET Estado = 'FINALIZADA', Resultado = @R, TrabajoRealizado = @Trab,
                        RequiereSeguimiento = @Seg, FechaSeguimiento = CAST(@FSeg AS DATE), SeguimientoNota = @NSeg,
                        NecesitaRepuestos = @Rep, RepuestosDetalle = @RepD, EsperaMotivo = NULL,
                        FechaFin = GETDATE(), FinalizadaPorId = @U, FinalizadaPorNombre = @UN,
                        TecnicoId = ISNULL(TecnicoId, @U), TecnicoNombre = ISNULL(TecnicoNombre, @UN),
                        -- Parada: desde que se pidió hasta ahora, solo si la máquina no podía trabajar.
                        MinutosParada = CASE WHEN MaquinaNoTrabaja = 1 THEN DATEDIFF(MINUTE, FechaSolicitud, GETDATE()) END,
                        FechaActualizacion = GETDATE()
                    WHERE SolId = @Id`);
        await historial(tx, {
            entidadId: sol.SolId, usuario, accion: 'FINALIZADA', detalle: ETIQUETA_RESULTADO[resultado],
            motivo: requiereSeguimiento ? `Requiere seguimiento${fechaSeguimiento ? ' el ' + fechaSeguimiento.split('-').reverse().join('/') : ''}` : null,
        });
        let maquinaCambio = false;
        if (sol.EquipoId && estadoEquipo) {
            const anterior = await cambiarEstadoEquipo(tx, { equipoId: sol.EquipoId, nuevo: estadoEquipo, usuario, motivo: `Solicitud ${sol.Codigo} finalizada (${ETIQUETA_RESULTADO[resultado]})` });
            maquinaCambio = !!anterior && anterior !== estadoEquipo;
            if (maquinaCambio) {
                await historial(tx, { entidadId: sol.SolId, usuario, accion: 'MAQUINA', detalle: `Estado de la máquina: ${anterior} → ${estadoEquipo}` });
            }
        }
        await tx.commit();
        tx = null;
        if (maquinaCambio) avisarTableros(req, sol.EquipoId);

        const pidio = sol.SolicitanteId || sol.CargadoPorId;
        if (pidio && pidio !== usuario.id) {
            notificar({
                usuarioIds: [pidio], modulo: MODULO, io: req.app.get('socketio'),
                titulo: `Tu solicitud ${sol.Codigo} fue finalizada`,
                texto: `${ETIQUETA_RESULTADO[resultado]} — ${sol.Titulo}`,
                url: urlSolicitud(sol.SolId), tag: `st-${sol.SolId}`,
            });
        }
        emitirCambio(req, sol.SolId);
        res.json({ success: true, data: await leerSolicitud(pool, sol.SolId) });
    } catch (err) {
        await rollbackSeguro(tx, 'ST finalizar');
        responderError(res, err, 'finalizar');
    }
};

// POST /solicitudes/:id/reabrir { motivo }
exports.reabrir = async (req, res) => {
    const motivo = texto(req.body?.motivo, 500);
    if (!motivo) return res.status(400).json({ success: false, error: 'Indicá por qué se reabre.' });
    try {
        const pool = await getPool();
        const sol = await solicitudParaAccion(req, res, pool, { permitirFinalizada: true });
        if (!sol) return;
        if (sol.Estado !== 'FINALIZADA') return res.status(409).json({ success: false, error: `${sol.Codigo} no está finalizada.` });
        const usuario = await usuarioActual(pool, req);
        await pool.request().input('Id', sql.Int, sol.SolId).query(`
            UPDATE dbo.ST_Solicitudes
            SET Estado = CASE WHEN TecnicoId IS NULL THEN 'PENDIENTE' ELSE 'EN_CURSO' END,
                Resultado = NULL, FechaFin = NULL, FinalizadaPorId = NULL, FinalizadaPorNombre = NULL,
                MinutosParada = NULL, FechaActualizacion = GETDATE()
            WHERE SolId = @Id`);
        await historial(pool, { entidadId: sol.SolId, usuario, accion: 'REABIERTA', motivo });
        emitirCambio(req, sol.SolId);
        res.json({ success: true, data: await leerSolicitud(pool, sol.SolId) });
    } catch (err) { responderError(res, err, 'reabrir'); }
};

// PUT /solicitudes/:id → edición de datos (técnicos). Deja en el historial qué cambió.
const CAMPOS_EDITABLES = [
    // [clave body, columna, tipo, etiqueta, normalizar]
    ['titulo', 'Titulo', sql.NVarChar(200), 'Título', v => texto(v, 200)],
    ['descripcion', 'Descripcion', sql.NVarChar(sql.MAX), 'Descripción', v => texto(v, 8000)],
    ['prioridad', 'Prioridad', sql.VarChar(10), 'Prioridad', v => (PRIORIDADES.includes(String(v).toUpperCase()) ? String(v).toUpperCase() : undefined)],
    ['categoria', 'Categoria', sql.VarChar(20), 'Tipo', v => (CATEGORIAS.includes(String(v).toUpperCase()) ? String(v).toUpperCase() : undefined)],
    ['equipoTexto', 'EquipoTexto', sql.NVarChar(150), 'Equipo / lugar', v => texto(v, 150)],
    ['areaId', 'AreaId', sql.VarChar(20), 'Área', v => texto(v, 20)],
    ['trabajoRealizado', 'TrabajoRealizado', sql.NVarChar(sql.MAX), 'Lo realizado', v => texto(v, 8000)],
    ['requiereSeguimiento', 'RequiereSeguimiento', sql.Bit, 'Requiere seguimiento', v => bool(v)],
    ['fechaSeguimiento', 'FechaSeguimiento', sql.VarChar(10), 'Fecha de seguimiento', v => fechaISO(v)],
    ['seguimientoNota', 'SeguimientoNota', sql.NVarChar(500), 'Nota de seguimiento', v => texto(v, 500)],
    ['necesitaRepuestos', 'NecesitaRepuestos', sql.Bit, 'Necesita repuestos', v => bool(v)],
    ['repuestosDetalle', 'RepuestosDetalle', sql.NVarChar(1000), 'Repuestos', v => texto(v, 1000)],
];
exports.editar = async (req, res) => {
    try {
        const pool = await getPool();
        const sol = await solicitudParaAccion(req, res, pool, { permitirFinalizada: true });
        if (!sol) return;
        const usuario = await usuarioActual(pool, req);
        const b = req.body || {};
        const r = pool.request().input('Id', sql.Int, sol.SolId);
        const sets = [];
        const cambios = [];
        const mostrar = (v) => (v === true ? 'sí' : v === false ? 'no' : v == null || v === '' ? '—' : String(v).length > 60 ? String(v).slice(0, 60) + '…' : String(v));
        for (const [clave, col, tipo, etiqueta, norm] of CAMPOS_EDITABLES) {
            if (!(clave in b)) continue;
            const nuevo = norm(b[clave]);
            if (nuevo === undefined) continue;
            const actual = typeof sol[col] === 'boolean' ? sol[col] : (sol[col] ?? null);
            if ((actual ?? null) === (nuevo ?? null) || (actual === null && nuevo === '')) continue;
            if (clave === 'titulo' && !nuevo) continue; // el título no se puede vaciar
            sets.push(col === 'FechaSeguimiento' ? `${col} = CAST(@${col} AS DATE)` : `${col} = @${col}`);
            r.input(col, tipo, nuevo);
            cambios.push(`${etiqueta}: ${mostrar(actual)} → ${mostrar(nuevo)}`);
        }
        if (!sets.length) return res.json({ success: true, data: sol });
        await r.query(`UPDATE dbo.ST_Solicitudes SET ${sets.join(', ')}, FechaActualizacion = GETDATE() WHERE SolId = @Id`);
        await historial(pool, { entidadId: sol.SolId, usuario, accion: 'EDITADA', detalle: cambios.join('\n') });
        emitirCambio(req, sol.SolId);
        res.json({ success: true, data: await leerSolicitud(pool, sol.SolId) });
    } catch (err) { responderError(res, err, 'editar'); }
};

// POST /solicitudes/:id/comentarios { texto } → técnicos o quien la pidió
exports.comentar = async (req, res) => {
    const id = idNum(req.params.id);
    const comentario = texto(req.body?.texto, 4000);
    if (!id) return res.status(400).json({ success: false, error: 'Solicitud inválida.' });
    if (!comentario) return res.status(400).json({ success: false, error: 'Escribí el comentario.' });
    try {
        const pool = await getPool();
        const sol = await leerSolicitud(pool, id);
        if (!sol) return res.status(404).json({ success: false, error: 'No existe la solicitud.' });
        if (!esTecnico(req) && !esDeUsuario(sol, idNum(req.user?.id))) {
            return res.status(403).json({ success: false, error: 'Solo Servicio Técnico o quien pidió la solicitud pueden comentar.' });
        }
        const usuario = await usuarioActual(pool, req);
        await historial(pool, { entidadId: id, usuario, accion: 'COMENTARIO', detalle: comentario });
        await pool.request().input('Id', sql.Int, id).query('UPDATE dbo.ST_Solicitudes SET FechaActualizacion = GETDATE() WHERE SolId = @Id');

        // Si comenta quien la pidió, se entera el técnico que la tiene (o el encargado si nadie la tomó).
        if (!esTecnico(req)) {
            const enc = await encargado(pool);
            const aQuien = sol.TecnicoId || enc?.id;
            if (aQuien && aQuien !== usuario.id) {
                notificar({
                    usuarioIds: [aQuien], modulo: MODULO, io: req.app.get('socketio'),
                    titulo: `Comentario en ${sol.Codigo}`, texto: `${usuario.nombre}: ${comentario}`,
                    url: urlSolicitud(id), tag: `st-${id}`,
                });
            }
        }
        emitirCambio(req, id);
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'comentar'); }
};

// POST /solicitudes/:id/adjuntos (multipart) → técnicos o quien la pidió
exports.adjuntar = async (req, res) => {
    const id = idNum(req.params.id);
    const files = req.files || [];
    if (!id) { limpiarTemporales(files); return res.status(400).json({ success: false, error: 'Solicitud inválida.' }); }
    if (!files.length) return res.status(400).json({ success: false, error: 'No llegó ningún archivo.' });
    try {
        const pool = await getPool();
        const sol = await leerSolicitud(pool, id);
        if (!sol) { limpiarTemporales(files); return res.status(404).json({ success: false, error: 'No existe la solicitud.' }); }
        if (!esTecnico(req) && !esDeUsuario(sol, idNum(req.user?.id))) {
            limpiarTemporales(files);
            return res.status(403).json({ success: false, error: 'Solo Servicio Técnico o quien pidió la solicitud pueden adjuntar.' });
        }
        const usuario = await usuarioActual(pool, req);
        const adj = await guardarAdjuntos(pool, { entidad: 'SOLICITUD', entidadId: id, files, usuario });
        if (adj.length) {
            await historial(pool, { entidadId: id, usuario, accion: 'ADJUNTO', detalle: adj.map(a => a.NombreOriginal).join(', ') });
            await pool.request().input('Id', sql.Int, id).query('UPDATE dbo.ST_Solicitudes SET FechaActualizacion = GETDATE() WHERE SolId = @Id');
        }
        emitirCambio(req, id);
        res.json({ success: true, data: adj });
    } catch (err) {
        limpiarTemporales(files);
        responderError(res, err, 'adjuntar');
    }
};

// GET /adjuntos/:adjId → el archivo (cualquier usuario interno: el historial es de lectura libre)
exports.verAdjunto = async (req, res) => {
    const adjId = idNum(req.params.adjId);
    if (!adjId) return res.status(400).json({ success: false, error: 'Adjunto inválido.' });
    try {
        const pool = await getPool();
        const r = await pool.request().input('Id', sql.Int, adjId)
            .query('SELECT Entidad, EntidadId, Archivo, NombreOriginal, Mime FROM dbo.ST_Adjuntos WHERE AdjId = @Id');
        const a = r.recordset[0];
        if (!a) return res.status(404).json({ success: false, error: 'No existe el adjunto.' });
        const abs = rutaAdjunto(a.Entidad, a.EntidadId, a.Archivo);
        if (!fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'El archivo ya no está en el servidor.' });
        if (a.Mime) res.type(a.Mime);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.NombreOriginal || a.Archivo)}`);
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.sendFile(abs);
    } catch (err) { responderError(res, err, 'verAdjunto'); }
};

// PUT /equipos/:id/estado { estado, motivo } → técnicos: cambia el estado de la máquina
exports.cambiarEstadoMaquina = async (req, res) => {
    if (!esTecnico(req)) return res.status(403).json({ success: false, error: 'Solo Servicio Técnico puede cambiar el estado de una máquina.' });
    const equipoId = idNum(req.params.id);
    const nuevo = normalizarEstado(req.body?.estado);
    const motivo = texto(req.body?.motivo, 500);
    if (!equipoId) return res.status(400).json({ success: false, error: 'Máquina inválida.' });
    if (!ESTADOS_EQUIPO.includes(nuevo)) return res.status(400).json({ success: false, error: 'Estado inválido.' });
    if (!motivo) return res.status(400).json({ success: false, error: 'Indicá el motivo del cambio.' });
    let tx = null;
    try {
        const pool = await getPool();
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const anterior = await cambiarEstadoEquipo(tx, { equipoId, nuevo, usuario, motivo });
        if (anterior === null) { await rollbackSeguro(tx, 'ST estado máquina'); tx = null; return res.status(404).json({ success: false, error: 'No existe la máquina.' }); }
        // Si se cambia desde una solicitud, que quede también en su historial.
        const solId = idNum(req.body?.solId);
        if (solId && anterior !== nuevo) {
            await historial(tx, { entidadId: solId, usuario, accion: 'MAQUINA', detalle: `Estado de la máquina: ${anterior} → ${nuevo}`, motivo });
        }
        await tx.commit();
        tx = null;
        if (anterior !== nuevo) avisarTableros(req, equipoId);
        if (solId) emitirCambio(req, solId);
        res.json({ success: true, data: { equipoId, anterior, estado: nuevo } });
    } catch (err) {
        await rollbackSeguro(tx, 'ST estado máquina');
        responderError(res, err, 'cambiarEstadoMaquina');
    }
};

// GET /tipos-falla?categoria=&q= → sugerencias de título (las más usadas primero)
exports.tiposFalla = async (req, res) => {
    try {
        const pool = await getPool();
        const r = pool.request();
        const where = ['Activo = 1'];
        const categoria = String(req.query.categoria || '').toUpperCase();
        if (CATEGORIAS.includes(categoria)) { where.push('Categoria = @Cat'); r.input('Cat', sql.VarChar(20), categoria); }
        const q = texto(req.query.q, 100);
        if (q) { where.push('Titulo LIKE @Q'); r.input('Q', sql.NVarChar(120), `%${escaparLike(q)}%`); }
        const result = await r.query(`SELECT TOP 15 TipoId, Categoria, Titulo, Usos FROM dbo.ST_TiposFalla
                                      WHERE ${where.join(' AND ')} ORDER BY Usos DESC, Titulo`);
        res.json({ success: true, data: result.recordset });
    } catch (err) { responderError(res, err, 'tiposFalla'); }
};

// PUT /config/encargado { usuarioId | null } → solo Admin
exports.setEncargado = async (req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ success: false, error: 'Solo un administrador puede elegir el encargado.' });
    const usuarioId = req.body?.usuarioId == null || req.body.usuarioId === '' ? null : idNum(req.body.usuarioId);
    if (req.body?.usuarioId && !usuarioId) return res.status(400).json({ success: false, error: 'Usuario inválido.' });
    try {
        const pool = await getPool();
        if (usuarioId) {
            const u = await pool.request().input('U', sql.Int, usuarioId)
                .query('SELECT IdUsuario FROM dbo.Usuarios WHERE IdUsuario = @U AND ISNULL(Activo, 1) = 1');
            if (!u.recordset.length) return res.status(400).json({ success: false, error: 'El usuario no existe o está inactivo.' });
        }
        await pool.request().input('V', sql.NVarChar(sql.MAX), usuarioId ? String(usuarioId) : '').query(`
            UPDATE dbo.ConfiguracionGlobal SET Valor = @V WHERE Clave = 'ST_EncargadoId';
            IF @@ROWCOUNT = 0 INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('ST_EncargadoId', 'SERVICIO', @V);`);
        const usuario = await usuarioActual(pool, req);
        logger.info(`[ServicioTecnico] Encargado → ${usuarioId || '(ninguno: queda la variable de entorno)'} por ${usuario.nombre}`);
        res.json({ success: true, data: await encargado(pool) });
    } catch (err) { responderError(res, err, 'setEncargado'); }
};
