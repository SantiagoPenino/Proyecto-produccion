// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — Pedidos y Bandeja (fase 1, docs/desarrollos/plan-integracion.md §6).
// Reglas y textos: docs/desarrollos/spec-B §1 (Pedidos) y §2 (Bandeja).
//
// Permisos:
// · Cargar un pedido: el equipo o quien tenga "Pedidos" en el menú de su rol (vendedores).
// · "Mis pedidos": los que pidió cada uno (por usuario, no por nombre como en el prototipo).
// · Bandeja (ver, editar, posponer, descartar, reabrir): el equipo. Aprobar y borrar: el editor.
// Arreglos del plan (§7) que viven acá: el vendedor nunca ve la nota interna (solo el motivo); una
// "orden" no se descarta; el código PD-/CO- lo decide la plantilla; una variante aprobada se sigue por
// su propio estado; y aprobar dos veces no crea dos proyectos.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { notificar } = require('../services/notificacionesService');
const {
    texto, idNum, fechaISO, escaparLike, codigoSolicitud,
    usuarioActual, nivelDe, rolVeRuta, exigir, bitacora, emitir, responderError,
} = require('../services/desarrollos/comun');
const { siguienteNumeroSolicitud, leerPlantilla, crearProyecto, crearVariante, plantillaPara } = require('../services/desarrollos/altas');

const MODULO = 'DESARROLLOS';
const RUTA_PEDIDOS = '/desarrollos/pedidos';
const TIPOS = ['SOLICITUD', 'IDEA', 'ORDEN', 'CORRECCION', 'VARIANTE'];
const ABIERTOS = ['NUEVA', 'EN_EVALUACION'];
const ESTADO_VARIANTE = { PROPUESTA: 'Propuesta', EN_DESARROLLO: 'En desarrollo', MUESTRA: 'En muestra' };
const urlPedido = (id) => `/desarrollos/pedidos?abrir=${id}`;
const urlBandeja = (id) => `/desarrollos/bandeja?abrir=${id}`;
const punto = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 5 ? n : 3; };
const fmtD = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');

// Cómo lo ve quien lo pidió (spec-B §1.4, sin mostrar nunca la nota interna).
function estadoVendedor(s) {
    if (s.estado === 'RECHAZADA') return { texto: 'No se hace', clase: 'no', motivo: s.motivo || null };
    if (s.estado === 'POSPUESTA') {
        return { texto: `Pospuesto${s.fechaRevision ? ` · se vuelve a ver el ${fmtD(s.fechaRevision)}` : ''}`, clase: 'pospuesto', motivo: s.motivo || null };
    }
    if (s.estado === 'APROBADA') {
        if (s.varianteId) {
            if (!s.varianteEstado) return { texto: 'Aprobado', clase: 'desarrollo' };
            if (s.varianteEstado === 'DESCARTADA') return { texto: 'Se canceló el desarrollo', clase: 'no' };
            if (s.varianteEstado === 'LISTA') return { texto: 'Listo', clase: 'listo' };
            return { texto: `Aprobado · en desarrollo (${ESTADO_VARIANTE[s.varianteEstado] || 'en curso'})`, clase: 'desarrollo' };
        }
        if (!s.proyectoId) return { texto: 'Aprobado', clase: 'desarrollo' };
        if (s.proyectoEstado === 'CANCELADO') return { texto: 'Se canceló el desarrollo', clase: 'no' };
        if (!s.proyectoEtapa) return { texto: 'Listo', clase: 'listo' };
        return { texto: `Aprobado · en desarrollo (${s.proyectoEtapa})`, clase: 'desarrollo' };
    }
    return { texto: 'Recibido', clase: 'recibido' };
}

// Una fila por pedido, con lo que usan la Bandeja y "Mis pedidos". `donde` va con alias s.
const SELECT_PEDIDOS = (donde) => `
    SELECT s.SolicitudID AS id, s.Numero AS numero, s.Tipo AS tipo, s.TipoID AS tipoId, s.Estado AS estado,
           s.Titulo AS titulo, s.Descripcion AS descripcion, s.CliIdCliente AS clienteId, s.ClienteTexto AS cliente,
           s.Cantidad AS cantidad, CONVERT(CHAR(10), s.FechaLimite, 23) AS fechaLimite,
           s.PedidoPorUsuarioID AS pedidoPorId,
           COALESCE(NULLIF(LTRIM(RTRIM(u.Nombre)), ''), NULLIF(LTRIM(RTRIM(u.Usuario)), ''), s.PedidoPorTexto) AS pedidoPor,
           s.AutorUsuarioID AS autorId, s.Familia AS familia, s.EtiquetaID AS etiquetaId,
           s.Estrategico AS estrategico, s.Comercial AS comercial, s.Complejidad AS complejidad, s.Recursos AS recursos,
           s.Evaluacion AS evaluacion, s.Motivo AS motivo, CONVERT(CHAR(10), s.FechaRevision, 23) AS fechaRevision,
           s.FechaDecision AS fechaDecision, s.CorrigeProyectoID AS corrigeProyectoId,
           s.ProyectoCreadoID AS proyectoId, p.Nombre AS proyectoNombre, p.Codigo AS proyectoCodigo, p.Estado AS proyectoEstado,
           ea.Nombre AS proyectoEtapa, s.VarianteCreadaID AS varianteId, v.Estado AS varianteEstado,
           (SELECT COUNT(*) FROM dbo.DesComentarios k WHERE k.Entidad = 'SOLICITUD' AND k.EntidadID = s.SolicitudID) AS comentarios,
           (SELECT TOP 1 a.AdjuntoID FROM dbo.DesAdjuntos a WHERE a.Entidad = 'SOLICITUD' AND a.EntidadID = s.SolicitudID
               AND a.Borrado = 0 AND a.Mime LIKE 'image/%' ORDER BY a.AdjuntoID) AS fotoId,
           (SELECT COUNT(*) FROM dbo.DesAdjuntos a WHERE a.Entidad = 'SOLICITUD' AND a.EntidadID = s.SolicitudID AND a.Borrado = 0) AS archivos,
           s.FechaAlta AS creado
    FROM dbo.DesSolicitudes s
    LEFT JOIN dbo.Usuarios u ON u.IdUsuario = s.PedidoPorUsuarioID
    LEFT JOIN dbo.DesProyectos p ON p.ProyectoID = s.ProyectoCreadoID AND p.Borrado = 0
    LEFT JOIN dbo.DesVariantes v ON v.VarianteID = s.VarianteCreadaID AND v.Borrado = 0
    OUTER APPLY (SELECT TOP 1 e.Nombre FROM dbo.DesTareas t JOIN dbo.DesProyectoEtapas e ON e.EtapaID = t.EtapaID
                 WHERE t.ProyectoID = p.ProyectoID AND t.Estado NOT IN ('HECHO', 'NO_APLICA') ORDER BY e.Orden, t.Orden) ea
    WHERE s.Borrado = 0 AND (${donde})`;

// Lo que ve quien pidió algo sin ser del equipo: sin la nota interna ni el puntaje.
const paraVendedor = (s) => {
    const { evaluacion, estrategico, comercial, complejidad, recursos, ...resto } = s;
    return { ...resto, codigo: codigoSolicitud(s.numero), estadoVendedor: estadoVendedor(s) };
};
const paraEquipo = (s) => ({ ...s, codigo: codigoSolicitud(s.numero), estadoVendedor: estadoVendedor(s) });

async function leerPedido(pool, id) {
    const r = await pool.request().input('Id', sql.Int, id).query(SELECT_PEDIDOS('s.SolicitudID = @Id'));
    return r.recordset[0] || null;
}

// A quién avisar cuando entra algo del lado de quien pide: los editores del equipo.
async function editoresEquipo(pool) {
    const r = await pool.request().query(`SELECT e.UsuarioID FROM dbo.DesEquipo e JOIN dbo.Usuarios u ON u.IdUsuario = e.UsuarioID
        WHERE e.Activo = 1 AND e.Nivel = 'EDITOR' AND ISNULL(u.Activo, 1) = 1`);
    return r.recordset.map(x => x.UsuarioID);
}

// ── Listas ───────────────────────────────────────────────────────────────────
// GET /pedidos/mios → "Mis pedidos": los que pidió el usuario (o cargó a nombre suyo el equipo)
exports.mios = async (req, res) => {
    try {
        const pool = await getPool();
        const yo = idNum(req.user?.id);
        const r = await pool.request().input('Yo', sql.Int, yo).query(`${SELECT_PEDIDOS('s.PedidoPorUsuarioID = @Yo')} ORDER BY s.FechaAlta DESC, s.SolicitudID DESC`);
        const esEquipo = !!await nivelDe(pool, req);
        res.json({ success: true, data: r.recordset.map(esEquipo ? paraEquipo : paraVendedor) });
    } catch (err) { responderError(res, err, 'mios'); }
};

// GET /bandeja → todo lo que entró (el equipo). Filtros y órdenes los hace la pantalla.
exports.bandeja = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver la Bandeja')) return;
        const r = await pool.request().query(`${SELECT_PEDIDOS('1 = 1')} ORDER BY s.FechaAlta DESC, s.SolicitudID DESC`);
        res.json({ success: true, data: r.recordset.map(paraEquipo) });
    } catch (err) { responderError(res, err, 'bandeja'); }
};

// GET /pedidos/:id → un pedido (el equipo, o quien lo pidió sin la nota interna)
exports.detalle = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Pedido inválido.' });
    try {
        const pool = await getPool();
        const s = await leerPedido(pool, id);
        if (!s) return res.status(404).json({ success: false, error: 'Ese pedido ya no existe.' });
        const esEquipo = !!await nivelDe(pool, req);
        const yo = idNum(req.user?.id);
        if (!esEquipo && s.pedidoPorId !== yo && s.autorId !== yo) return res.status(403).json({ success: false, error: 'No tenés acceso a este pedido.' });
        res.json({ success: true, data: esEquipo ? paraEquipo(s) : paraVendedor(s) });
    } catch (err) { responderError(res, err, 'detalle'); }
};

// ── Alta ─────────────────────────────────────────────────────────────────────
// POST /pedidos { titulo, descripcion, cliente: { id, texto }, fechaLimite }
//   el equipo además: { tipo, tipoId, cantidad, pedidoPorUsuarioId | pedidoPorTexto }
exports.crear = async (req, res) => {
    const titulo = texto(req.body?.titulo, 120);
    if (!titulo) return res.status(400).json({ success: false, error: 'Escribí qué piden.' });
    let tx = null;
    try {
        const pool = await getPool();
        const nivel = await nivelDe(pool, req);
        if (!nivel && !await rolVeRuta(pool, req, RUTA_PEDIDOS)) {
            return res.status(403).json({ success: false, error: 'Tu rol no puede cargar pedidos de desarrollo.' });
        }
        const usuario = await usuarioActual(pool, req);
        const b = req.body || {};
        const clienteId = idNum(b.cliente?.id);
        let clienteTexto = texto(b.cliente?.texto, 120);
        if (clienteId) {
            const c = await pool.request().input('C', sql.Int, clienteId)
                .query(`SELECT COALESCE(NULLIF(LTRIM(RTRIM(NombreFantasia)), ''), LTRIM(RTRIM(Nombre))) AS Nombre FROM dbo.Clientes WHERE CliIdCliente = @C`);
            if (!c.recordset.length) return res.status(400).json({ success: false, error: 'Ese cliente no existe.' });
            clienteTexto = c.recordset[0].Nombre;
        }
        // Lo que solo carga el equipo (en la Bandeja); un vendedor siempre pide un "Pedido" de producto, a su nombre.
        const tipos = (await pool.request().query('SELECT TipoID, Clave FROM dbo.DesTiposDesarrollo WHERE Activo = 1')).recordset;
        const tipoProducto = tipos.find(t => t.Clave === 'producto')?.TipoID || tipos[0]?.TipoID;
        let tipo = 'SOLICITUD';
        let tipoId = tipoProducto;
        let pedidoPorId = usuario.id;
        let pedidoPorTexto = null;
        let cantidad = null;
        if (nivel) {
            if (TIPOS.includes(String(b.tipo || '').toUpperCase())) tipo = String(b.tipo).toUpperCase();
            if (tipos.some(t => t.TipoID === idNum(b.tipoId))) tipoId = idNum(b.tipoId);
            cantidad = texto(b.cantidad, 60);
            if (b.pedidoPorUsuarioId !== undefined || b.pedidoPorTexto !== undefined) {
                pedidoPorId = idNum(b.pedidoPorUsuarioId);
                pedidoPorTexto = pedidoPorId ? null : texto(b.pedidoPorTexto, 120);
                if (!pedidoPorId && !pedidoPorTexto) pedidoPorId = usuario.id;
            }
        }

        tx = new sql.Transaction(pool);
        await tx.begin();
        const numero = await siguienteNumeroSolicitud(tx);
        const r = await tx.request()
            .input('Num', sql.Int, numero).input('Tipo', sql.VarChar(12), tipo).input('TipoID', sql.Int, tipoId)
            .input('Tit', sql.NVarChar(120), titulo).input('Desc', sql.NVarChar(4000), texto(b.descripcion, 4000))
            .input('Cli', sql.Int, clienteId).input('CliT', sql.NVarChar(120), clienteTexto)
            .input('Cant', sql.NVarChar(60), cantidad).input('Lim', sql.VarChar(10), fechaISO(b.fechaLimite))
            .input('PP', sql.Int, pedidoPorId).input('PPT', sql.NVarChar(120), pedidoPorTexto)
            .input('Autor', sql.Int, usuario.id).input('AE', sql.Bit, !!nivel)
            .query(`INSERT INTO dbo.DesSolicitudes (Numero, Tipo, TipoID, Estado, Titulo, Descripcion, CliIdCliente, ClienteTexto, Cantidad,
                        FechaLimite, PedidoPorUsuarioID, PedidoPorTexto, AutorUsuarioID, AutorEquipo)
                    OUTPUT INSERTED.SolicitudID
                    VALUES (@Num, @Tipo, @TipoID, 'NUEVA', @Tit, @Desc, @Cli, @CliT, @Cant, CONVERT(DATE, @Lim, 23), @PP, @PPT, @Autor, @AE)`);
        const id = r.recordset[0].SolicitudID;
        const etiquetaTipo = { SOLICITUD: 'Pedido', IDEA: 'Idea', ORDEN: 'Orden', CORRECCION: 'Corrección', VARIANTE: 'Variante' }[tipo];
        await bitacora(tx, { entidad: 'SOLICITUD', entidadId: id, accion: 'Cargó', detalle: `${etiquetaTipo}: ${titulo}`, usuario });
        await tx.commit();
        tx = null;

        const s = await leerPedido(pool, id);
        // Aviso a los editores del equipo (menos a quien lo cargó)
        const destino = (await editoresEquipo(pool)).filter(x => x !== usuario.id);
        notificar({
            usuarioIds: destino, modulo: MODULO, io: req.app.get('socketio'), tag: `des-sol-${id}`,
            titulo: `Nuevo pedido ${codigoSolicitud(numero)}`,
            texto: `${titulo} — pidió ${s.pedidoPor || usuario.nombre}${clienteTexto ? ` · ${clienteTexto}` : ''}`,
            url: urlBandeja(id),
        });
        emitir(req, { entidad: 'SOLICITUD', id });
        logger.info(`[Desarrollos] ${codigoSolicitud(numero)} cargado por ${usuario.nombre}`);
        res.json({ success: true, data: nivel ? paraEquipo(s) : paraVendedor(s) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos crear pedido');
        responderError(res, err, 'crear');
    }
};

// ── Edición (Bandeja) ────────────────────────────────────────────────────────
const ETIQUETAS_CAMBIO = {
    titulo: 'título', descripcion: 'detalle', cliente: 'cliente', cantidad: 'cantidad', fechaLimite: 'para cuándo',
    tipo: 'tipo', corrigeProyectoId: 'producto', familia: 'familia', tipoId: 'tipo de desarrollo', evaluacion: 'nota de evaluación',
    puntaje: 'puntaje',
};

// PUT /pedidos/:id { titulo, descripcion, cliente {id, texto}, cantidad, fechaLimite, tipo, tipoId, corrigeProyectoId,
//                    familia, estrategico, comercial, complejidad, recursos, evaluacion }
exports.editar = async (req, res) => {
    const id = idNum(req.params.id);
    const b = req.body || {};
    const titulo = texto(b.titulo, 120);
    if (!id) return res.status(400).json({ success: false, error: 'Pedido inválido.' });
    if (!titulo) return res.status(400).json({ success: false, error: 'Falta el título.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'editar pedidos')) return;
        const usuario = await usuarioActual(pool, req);
        const antes = await leerPedido(pool, id);
        if (!antes) return res.status(404).json({ success: false, error: 'Ese pedido ya no existe.' });

        const tipo = TIPOS.includes(String(b.tipo || '').toUpperCase()) ? String(b.tipo).toUpperCase() : antes.tipo;
        const tipos = (await pool.request().query('SELECT TipoID FROM dbo.DesTiposDesarrollo')).recordset.map(t => t.TipoID);
        const tipoId = tipos.includes(idNum(b.tipoId)) ? idNum(b.tipoId) : antes.tipoId;
        // El producto que se corrige o al que se le agrega la variante solo vale para esos dos tipos
        let corrige = ['CORRECCION', 'VARIANTE'].includes(tipo) ? idNum(b.corrigeProyectoId) : null;
        if (corrige) {
            const p = await pool.request().input('P', sql.Int, corrige).query('SELECT 1 AS Si FROM dbo.DesProyectos WHERE ProyectoID = @P AND Borrado = 0');
            if (!p.recordset.length) corrige = null;
        }
        const clienteId = idNum(b.cliente?.id);
        let clienteTexto = b.cliente === undefined ? antes.cliente : texto(b.cliente?.texto, 120);
        if (clienteId) {
            const c = await pool.request().input('C', sql.Int, clienteId)
                .query(`SELECT COALESCE(NULLIF(LTRIM(RTRIM(NombreFantasia)), ''), LTRIM(RTRIM(Nombre))) AS Nombre FROM dbo.Clientes WHERE CliIdCliente = @C`);
            clienteTexto = c.recordset[0]?.Nombre || clienteTexto;
        }
        const nuevo = {
            titulo, descripcion: texto(b.descripcion, 4000), cliente: clienteTexto, clienteId: b.cliente === undefined ? antes.clienteId : clienteId,
            cantidad: texto(b.cantidad, 60), fechaLimite: fechaISO(b.fechaLimite), tipo, tipoId, corrigeProyectoId: corrige,
            familia: texto(b.familia, 60), evaluacion: texto(b.evaluacion, 2000),
            estrategico: punto(b.estrategico), comercial: punto(b.comercial), complejidad: punto(b.complejidad), recursos: punto(b.recursos),
        };
        const cambios = [];
        for (const k of ['titulo', 'descripcion', 'cliente', 'cantidad', 'fechaLimite', 'tipo', 'corrigeProyectoId', 'familia', 'tipoId', 'evaluacion']) {
            if ((antes[k] ?? null) !== (nuevo[k] ?? null)) cambios.push(ETIQUETAS_CAMBIO[k]);
        }
        if (['estrategico', 'comercial', 'complejidad', 'recursos'].some(k => (antes[k] || 3) !== nuevo[k])) cambios.push(ETIQUETAS_CAMBIO.puntaje);
        if (!cambios.length) return res.json({ success: true, data: paraEquipo(antes), sinCambios: true });

        tx = new sql.Transaction(pool);
        await tx.begin();
        await tx.request()
            .input('Id', sql.Int, id).input('Tit', sql.NVarChar(120), nuevo.titulo).input('Desc', sql.NVarChar(4000), nuevo.descripcion)
            .input('Cli', sql.Int, nuevo.clienteId).input('CliT', sql.NVarChar(120), nuevo.cliente).input('Cant', sql.NVarChar(60), nuevo.cantidad)
            .input('Lim', sql.VarChar(10), nuevo.fechaLimite).input('Tipo', sql.VarChar(12), nuevo.tipo).input('TipoID', sql.Int, nuevo.tipoId)
            .input('Corr', sql.Int, nuevo.corrigeProyectoId).input('Fam', sql.NVarChar(60), nuevo.familia).input('Ev', sql.NVarChar(2000), nuevo.evaluacion)
            .input('E', sql.TinyInt, nuevo.estrategico).input('C', sql.TinyInt, nuevo.comercial)
            .input('X', sql.TinyInt, nuevo.complejidad).input('R', sql.TinyInt, nuevo.recursos)
            .query(`UPDATE dbo.DesSolicitudes SET Titulo = @Tit, Descripcion = @Desc, CliIdCliente = @Cli, ClienteTexto = @CliT, Cantidad = @Cant,
                        FechaLimite = CONVERT(DATE, @Lim, 23), Tipo = @Tipo, TipoID = @TipoID, CorrigeProyectoID = @Corr, Familia = @Fam,
                        Evaluacion = @Ev, Estrategico = @E, Comercial = @C, Complejidad = @X, Recursos = @R, FechaActualizado = GETDATE()
                    WHERE SolicitudID = @Id`);
        await bitacora(tx, { entidad: 'SOLICITUD', entidadId: id, accion: 'Editó', detalle: cambios.join(' · '), usuario });
        await tx.commit();
        tx = null;
        emitir(req, { entidad: 'SOLICITUD', id });
        res.json({ success: true, data: paraEquipo(await leerPedido(pool, id)) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos editar pedido');
        responderError(res, err, 'editar');
    }
};

// ── Decisiones ───────────────────────────────────────────────────────────────
// Lee el pedido bloqueándolo (dos decisiones a la vez no se pisan). null si no existe.
async function pedidoParaDecidir(tx, id) {
    const r = await tx.request().input('Id', sql.Int, id).query(`
        SELECT SolicitudID, Numero, Tipo, TipoID, Estado, Titulo, Descripcion, ClienteTexto, Cantidad, CONVERT(CHAR(10), FechaLimite, 23) AS FechaLimite,
               PedidoPorUsuarioID, PedidoPorTexto, CorrigeProyectoID, Familia, EtiquetaID, LineaAreaID, RefErpTexto,
               Estrategico, Comercial, Complejidad, Recursos, Evaluacion
        FROM dbo.DesSolicitudes WITH (UPDLOCK, ROWLOCK) WHERE SolicitudID = @Id AND Borrado = 0`);
    return r.recordset[0] || null;
}

// Aviso a quien pidió el pedido (si es un usuario y no es quien decidió)
function avisarAlQuePidio(req, s, usuario, titulo, textoAviso) {
    if (!s.PedidoPorUsuarioID || s.PedidoPorUsuarioID === usuario.id) return;
    notificar({
        usuarioIds: [s.PedidoPorUsuarioID], modulo: MODULO, io: req.app.get('socketio'), tag: `des-sol-${s.SolicitudID}`,
        titulo, texto: textoAviso, url: urlPedido(s.SolicitudID),
    });
}

// POST /pedidos/:id/aprobar { plantillaId, corrigeProyectoId } → crea el proyecto (o la variante). Editor.
exports.aprobar = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Pedido inválido.' });
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'aprobar pedidos')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const s = await pedidoParaDecidir(tx, id);
        if (!s) { await rollbackSeguro(tx, 'Desarrollos aprobar'); tx = null; return res.status(404).json({ success: false, error: 'Ese pedido ya no existe.' }); }
        if (![...ABIERTOS, 'POSPUESTA'].includes(s.Estado)) {
            await rollbackSeguro(tx, 'Desarrollos aprobar'); tx = null;
            return res.status(409).json({ success: false, error: 'Ese pedido ya se decidió: recargá la Bandeja.' });
        }
        const codigo = codigoSolicitud(s.Numero);
        const cid = idNum(req.body?.corrigeProyectoId) || s.CorrigeProyectoID || null;
        const base = cid ? (await tx.request().input('P', sql.Int, cid).query(`
            SELECT ProyectoID, Nombre, Codigo, LiderUsuarioID, ProIdProducto, RefErpTexto, Familia, EtiquetaID, LineaAreaID
            FROM dbo.DesProyectos WHERE ProyectoID = @P AND Borrado = 0`)).recordset[0] || null : null;

        let proyectoId;
        let varianteId = null;
        let resumen;
        if (s.Tipo === 'VARIANTE') {
            if (!base) {
                await rollbackSeguro(tx, 'Desarrollos aprobar'); tx = null;
                return res.status(400).json({ success: false, error: 'Elegí el producto al que se le agrega la variante.' });
            }
            varianteId = await crearVariante(tx, {
                proyectoId: base.ProyectoID, nombre: s.Titulo, libre: s.Descripcion, origen: 'solicitud', solicitudId: id,
                estado: 'EN_DESARROLLO', responsableId: base.LiderUsuarioID, fechaLimite: s.FechaLimite, nota: s.Evaluacion,
            });
            proyectoId = base.ProyectoID;
            await bitacora(tx, { entidad: 'PROYECTO', entidadId: proyectoId, accion: 'Variantes', detalle: `variante nueva desde ${codigo}: ${s.Titulo}`, usuario });
            await bitacora(tx, { entidad: 'SOLICITUD', entidadId: id, accion: 'Aprobó la variante', detalle: `se agregó a ${base.Nombre}`, usuario });
            resumen = `se agregó como variante de ${base.Nombre}`;
        } else {
            // Plantilla: la elegida, o la que corresponde (corrección → "correccion"; si no, la del tipo de desarrollo)
            let plantilla = idNum(req.body?.plantillaId) ? await leerPlantilla(tx, { plantillaId: idNum(req.body.plantillaId) }) : null;
            if (plantilla && plantilla.Para === 'VARIANTE') plantilla = null;
            if (!plantilla) {
                if (s.Tipo === 'CORRECCION') plantilla = await leerPlantilla(tx, { clave: 'correccion' });
                else {
                    // En serie: una transacción de mssql no acepta dos consultas a la vez
                    const plantillas = await tx.request().query("SELECT PlantillaID, Clave, Para, TipoID FROM dbo.DesPlantillas WHERE Activo = 1 AND Para <> 'VARIANTE' ORDER BY Orden, PlantillaID");
                    const tipos = await tx.request().query('SELECT TipoID, Clave, EsProducto FROM dbo.DesTiposDesarrollo');
                    const pid = plantillaPara(plantillas.recordset, tipos.recordset, s.TipoID);
                    plantilla = pid ? await leerPlantilla(tx, { plantillaId: pid }) : null;
                }
            }
            if (!plantilla) {
                await rollbackSeguro(tx, 'Desarrollos aprobar'); tx = null;
                return res.status(400).json({ success: false, error: 'No hay una plantilla para crear el proyecto.' });
            }
            // El código y el tipo los decide la plantilla (plan §7.16)
            const tipoProy = plantilla.Para === 'CORRECCION' ? 'CORRECCION' : 'NUEVO';
            const notas = [
                s.Descripcion, s.ClienteTexto ? `Cliente: ${s.ClienteTexto}` : null, s.Cantidad ? `Cantidad: ${s.Cantidad}` : null,
                s.Evaluacion ? `Evaluación: ${s.Evaluacion}` : null,
            ].filter(Boolean).join('\n');
            const creado = await crearProyecto(tx, plantilla, {
                nombre: tipoProy === 'CORRECCION' ? `Corrección: ${base?.Nombre || s.Titulo}` : s.Titulo,
                tipo: tipoProy, tipoOrigen: s.Tipo.toLowerCase(), origen: 'solicitud',
                tipoId: s.TipoID || plantilla.TipoID, liderId: usuario.id,
                lineaAreaId: s.LineaAreaID || base?.LineaAreaID, fechaLimite: s.FechaLimite,
                proIdProducto: base?.ProIdProducto, refErpTexto: s.RefErpTexto || base?.RefErpTexto,
                familia: s.Familia || base?.Familia, etiquetaId: s.EtiquetaID || base?.EtiquetaID, notas,
                puntaje: { estrategico: s.Estrategico, comercial: s.Comercial, complejidad: s.Complejidad, recursos: s.Recursos },
                solicitudId: id, corrigeProyectoId: cid,
            }, usuario.id);
            proyectoId = creado.proyectoId;
            // Las capacidades que pedía el pedido pasan al proyecto
            await tx.request().input('S', sql.Int, id).input('P', sql.Int, proyectoId).query(`
                INSERT INTO dbo.DesCapacidadUso (CapacidadID, Entidad, EntidadID, Relacion)
                SELECT CapacidadID, 'PROYECTO', @P, 'REQUIERE' FROM dbo.DesCapacidadUso WHERE Entidad = 'SOLICITUD' AND EntidadID = @S AND Relacion = 'REQUIERE'`);
            const quien = s.PedidoPorUsuarioID ? (await tx.request().input('U', sql.Int, s.PedidoPorUsuarioID)
                .query(`SELECT LTRIM(RTRIM(ISNULL(NULLIF(Nombre, ''), Usuario))) AS N FROM dbo.Usuarios WHERE IdUsuario = @U`)).recordset[0]?.N : s.PedidoPorTexto;
            await bitacora(tx, { entidad: 'PROYECTO', entidadId: proyectoId, accion: 'Planificado', detalle: `desde ${codigo}${quien ? `, pedido por ${quien}` : ''}`, usuario });
            await bitacora(tx, { entidad: 'SOLICITUD', entidadId: id, accion: 'Aprobó y creó el proyecto', detalle: `${creado.codigo}${s.Evaluacion ? ` · ${s.Evaluacion}` : ''}`, usuario });
            resumen = `se creó el proyecto ${creado.codigo}`;
        }
        await tx.request().input('Id', sql.Int, id).input('Corr', sql.Int, cid).input('P', sql.Int, proyectoId)
            .input('V', sql.Int, varianteId).input('U', sql.Int, usuario.id)
            .query(`UPDATE dbo.DesSolicitudes SET Estado = 'APROBADA', CorrigeProyectoID = @Corr, ProyectoCreadoID = @P, VarianteCreadaID = @V,
                        FechaDecision = GETDATE(), DecididoPorUsuarioID = @U, FechaActualizado = GETDATE()
                    WHERE SolicitudID = @Id`);
        await tx.commit();
        tx = null;

        avisarAlQuePidio(req, s, usuario, `Aprobaron tu pedido ${codigo}`, `${s.Titulo} — ${resumen}`);
        emitir(req, { entidad: 'SOLICITUD', id });
        emitir(req, { entidad: 'PROYECTO', id: proyectoId });
        logger.info(`[Desarrollos] ${codigo} aprobado por ${usuario.nombre}: ${resumen}`);
        res.json({ success: true, data: { proyectoId, varianteId, pedido: paraEquipo(await leerPedido(pool, id)) } });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos aprobar');
        responderError(res, err, 'aprobar');
    }
};

// POST /pedidos/:id/posponer { motivo, fechaRevision } (el equipo; solo lo que está por resolver)
// POST /pedidos/:id/descartar { motivo } (el equipo; lo que está por resolver o pospuesto, menos las órdenes)
async function decidir(req, res, decision) {
    const id = idNum(req.params.id);
    const motivo = texto(req.body?.motivo, 2000);
    if (!id) return res.status(400).json({ success: false, error: 'Pedido inválido.' });
    if (!motivo) return res.status(400).json({ success: false, error: 'Escribí el motivo.' });
    const revision = decision === 'POSPUESTA' ? fechaISO(req.body?.fechaRevision) : null;
    let tx = null;
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', decision === 'POSPUESTA' ? 'posponer pedidos' : 'descartar pedidos')) return;
        const usuario = await usuarioActual(pool, req);
        tx = new sql.Transaction(pool);
        await tx.begin();
        const s = await pedidoParaDecidir(tx, id);
        const fin = async (status, error) => { await rollbackSeguro(tx, 'Desarrollos decidir'); tx = null; return res.status(status).json({ success: false, error }); };
        if (!s) return fin(404, 'Ese pedido ya no existe.');
        const permitidos = decision === 'POSPUESTA' ? ABIERTOS : [...ABIERTOS, 'POSPUESTA'];
        if (!permitidos.includes(s.Estado)) return fin(409, 'Ese pedido ya se decidió: recargá la Bandeja.');
        if (decision === 'RECHAZADA' && s.Tipo === 'ORDEN') return fin(400, 'Una orden hay que hacerla: no se puede descartar.');
        await tx.request().input('Id', sql.Int, id).input('E', sql.VarChar(14), decision).input('M', sql.NVarChar(2000), motivo)
            .input('F', sql.VarChar(10), revision).input('U', sql.Int, usuario.id)
            .query(`UPDATE dbo.DesSolicitudes SET Estado = @E, Motivo = @M, FechaRevision = CONVERT(DATE, @F, 23),
                        FechaDecision = GETDATE(), DecididoPorUsuarioID = @U, FechaActualizado = GETDATE()
                    WHERE SolicitudID = @Id`);
        await bitacora(tx, {
            entidad: 'SOLICITUD', entidadId: id, usuario,
            accion: decision === 'POSPUESTA' ? 'Pospuso' : 'Rechazó',
            detalle: `${revision ? `revisar el ${fmtD(revision)}. ` : ''}${motivo}`,
        });
        await tx.commit();
        tx = null;
        const codigo = codigoSolicitud(s.Numero);
        if (decision === 'POSPUESTA') {
            avisarAlQuePidio(req, s, usuario, `Pospusieron tu pedido ${codigo}`, `${s.Titulo} — ${motivo}${revision ? ` (se vuelve a ver el ${fmtD(revision)})` : ''}`);
        } else {
            avisarAlQuePidio(req, s, usuario, `Tu pedido ${codigo} no se hace`, `${s.Titulo} — ${motivo}`);
        }
        emitir(req, { entidad: 'SOLICITUD', id });
        res.json({ success: true, data: paraEquipo(await leerPedido(pool, id)) });
    } catch (err) {
        if (tx) await rollbackSeguro(tx, 'Desarrollos decidir');
        responderError(res, err, decision === 'POSPUESTA' ? 'posponer' : 'descartar');
    }
}
exports.posponer = (req, res) => decidir(req, res, 'POSPUESTA');
exports.descartar = (req, res) => decidir(req, res, 'RECHAZADA');

// POST /pedidos/:id/reabrir → un descartado vuelve a la Bandeja (el equipo)
exports.reabrir = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Pedido inválido.' });
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'reabrir pedidos')) return;
        const usuario = await usuarioActual(pool, req);
        const r = await pool.request().input('Id', sql.Int, id).query(`
            UPDATE dbo.DesSolicitudes SET Estado = 'NUEVA', Motivo = NULL, FechaRevision = NULL, FechaActualizado = GETDATE()
            OUTPUT INSERTED.SolicitudID, INSERTED.Numero, INSERTED.Titulo, INSERTED.PedidoPorUsuarioID
            WHERE SolicitudID = @Id AND Borrado = 0 AND Estado = 'RECHAZADA'`);
        const s = r.recordset[0];
        if (!s) return res.status(409).json({ success: false, error: 'Solo se reabre un pedido descartado.' });
        await bitacora(pool, { entidad: 'SOLICITUD', entidadId: id, accion: 'Reabrió', detalle: 'vuelve a la bandeja', usuario });
        avisarAlQuePidio(req, s, usuario, `Tu pedido ${codigoSolicitud(s.Numero)} volvió a la Bandeja`, `${s.Titulo} — se vuelve a evaluar`);
        emitir(req, { entidad: 'SOLICITUD', id });
        res.json({ success: true, data: paraEquipo(await leerPedido(pool, id)) });
    } catch (err) { responderError(res, err, 'reabrir'); }
};

// DELETE /pedidos/:id → lo marca borrado (editor). Sus archivos y comentarios quedan; el proyecto que
// haya creado sigue (y sigue mostrando los archivos del pedido).
exports.borrar = async (req, res) => {
    const id = idNum(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Pedido inválido.' });
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EDITOR', 'borrar pedidos')) return;
        const usuario = await usuarioActual(pool, req);
        const r = await pool.request().input('Id', sql.Int, id)
            .query('UPDATE dbo.DesSolicitudes SET Borrado = 1, FechaBorrado = GETDATE() WHERE SolicitudID = @Id AND Borrado = 0');
        if (!r.rowsAffected[0]) return res.status(404).json({ success: false, error: 'Ese pedido ya no existe.' });
        await bitacora(pool, { entidad: 'SOLICITUD', entidadId: id, accion: 'Borró', detalle: 'el pedido', usuario });
        emitir(req, { entidad: 'SOLICITUD', id });
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'borrar'); }
};

// ── Listas de apoyo ──────────────────────────────────────────────────────────
// GET /clientes?q= → clientes para el pedido: al vendedor le salen primero los suyos
exports.clientes = async (req, res) => {
    const q = texto(req.query.q, 60);
    try {
        const pool = await getPool();
        if (!await nivelDe(pool, req) && !await rolVeRuta(pool, req, RUTA_PEDIDOS)) return res.status(403).json({ success: false, error: 'No tenés acceso.' });
        if (!q || q.length < 2) return res.json({ success: true, data: [] });
        const r = await pool.request().input('Q', sql.NVarChar(80), `%${escaparLike(q)}%`).input('U', sql.Int, idNum(req.user?.id)).query(`
            DECLARE @Ced NVARCHAR(30) = (SELECT TOP 1 LTRIM(RTRIM(Cedula)) FROM dbo.Usuarios WHERE IdUsuario = @U);
            SELECT TOP 15 c.CliIdCliente AS id, c.CodCliente AS codigo,
                   COALESCE(NULLIF(LTRIM(RTRIM(c.NombreFantasia)), ''), LTRIM(RTRIM(c.Nombre))) AS nombre,
                   LTRIM(RTRIM(c.Nombre)) AS razon,
                   CAST(CASE WHEN @Ced <> '' AND LTRIM(RTRIM(c.VendedorID)) = @Ced THEN 1 ELSE 0 END AS BIT) AS mio
            FROM dbo.Clientes c
            WHERE c.Nombre LIKE @Q OR c.NombreFantasia LIKE @Q OR CAST(c.CodCliente AS VARCHAR(20)) LIKE @Q
            ORDER BY mio DESC, nombre`);
        res.json({ success: true, data: r.recordset });
    } catch (err) { responderError(res, err, 'clientes'); }
};

// GET /usuarios → usuarios activos (para "Lo pidió" en la Bandeja)
exports.usuarios = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver los usuarios')) return;
        const r = await pool.request().query(`
            SELECT IdUsuario AS id, LTRIM(RTRIM(ISNULL(NULLIF(Nombre, ''), Usuario))) AS nombre
            FROM dbo.Usuarios WHERE ISNULL(Activo, 1) = 1 ORDER BY nombre`);
        res.json({ success: true, data: r.recordset });
    } catch (err) { responderError(res, err, 'usuarios'); }
};

// GET /proyectos/opciones → todos los proyectos (para elegir qué producto se corrige o recibe la variante)
exports.proyectosOpciones = async (req, res) => {
    try {
        const pool = await getPool();
        if (!await exigir(req, res, pool, 'EQUIPO', 'ver los proyectos')) return;
        const r = await pool.request().query(`
            SELECT ProyectoID AS id, Nombre AS nombre, Codigo AS codigo, Estado AS estado
            FROM dbo.DesProyectos WHERE Borrado = 0 ORDER BY Nombre`);
        res.json({ success: true, data: r.recordset });
    } catch (err) { responderError(res, err, 'proyectosOpciones'); }
};

module.exports.estadoVendedor = estadoVendedor;
