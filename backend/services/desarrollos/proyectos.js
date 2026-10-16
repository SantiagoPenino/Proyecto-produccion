// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — lectura de proyectos y reglas que tocan la base (fase 2).
// Reglas: docs/desarrollos/spec-A §2.7, spec-B §3. Lo que solo se muestra (fechas sugeridas,
// bloqueadas, recomendado) se calcula en la pantalla (src/components/desarrollos/reglas.js).
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../../config/db');
const { hoyUY } = require('./comun');

const PENDIENTE = (estado) => estado !== 'HECHO' && estado !== 'NO_APLICA';

// Proyectos con sus etapas y tareas, ordenadas como DP.tareasDe (etapa y posición).
// db = pool o transacción. ids = null → todos los no borrados.
async function leerProyectos(db, { ids = null, conTareas = true } = {}) {
    const filtro = ids ? `p.ProyectoID IN (${ids.map(Number).filter(Number.isInteger).join(',') || 0})` : 'p.Borrado = 0';
    const proyectos = (await db.request().query(`
        SELECT p.ProyectoID AS id, p.Codigo AS codigo, p.Nombre AS nombre, p.Tipo AS tipo, p.TipoOrigen AS tipoOrigen, p.Origen AS origen,
               p.TipoID AS tipoId, p.PlantillaID AS plantillaId, p.PlantillaNombre AS plantillaNombre, p.Estado AS estado,
               p.LiderUsuarioID AS liderId, COALESCE(NULLIF(LTRIM(RTRIM(ul.Nombre)), ''), NULLIF(LTRIM(RTRIM(ul.Usuario)), ''), p.LiderTexto) AS lider,
               p.LineaAreaID AS lineaAreaId, CONVERT(CHAR(10), p.FechaInicio, 23) AS fechaInicio, CONVERT(CHAR(10), p.FechaLimite, 23) AS fechaLimite,
               p.ProIdProducto AS proIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS articuloCodigo, LTRIM(RTRIM(a.Descripcion)) AS articuloNombre,
               p.RefErpTexto AS refErpTexto,
               COALESCE(NULLIF(LTRIM(RTRIM(sa.Articulo)), ''), p.Familia) AS familia, p.Familia AS familiaPropia,
               COALESCE(v.EtiquetaID, p.EtiquetaID) AS etiquetaId, p.EtiquetaID AS etiquetaPropiaId, et.Nombre AS etiqueta,
               p.Notas AS notas, p.Proveedor AS proveedor, p.CostoEstimado AS costoEstimado,
               p.Estrategico AS estrategico, p.Comercial AS comercial, p.Complejidad AS complejidad, p.Recursos AS recursos,
               p.SolicitudID AS solicitudId, s.Numero AS solicitudNumero, p.CorrigeProyectoID AS corrigeProyectoId,
               p.FechaTerminado AS fechaTerminado, p.FechaCancelado AS fechaCancelado, p.FechaAlta AS creado, p.FechaActualizado AS actualizado,
               p.Borrado AS borrado,
               (SELECT COUNT(*) FROM dbo.DesMuestraProyectos mp JOIN dbo.DesMuestras m ON m.MuestraID = mp.MuestraID AND m.Borrado = 0 WHERE mp.ProyectoID = p.ProyectoID) AS muestras,
               (SELECT COUNT(*) FROM dbo.DesVariantes x WHERE x.ProyectoID = p.ProyectoID AND x.Borrado = 0) AS variantes,
               (SELECT COUNT(*) FROM dbo.DesCapacidadUso c JOIN dbo.DesCapacidades k ON k.CapacidadID = c.CapacidadID AND k.Borrado = 0 WHERE c.Entidad = 'PROYECTO' AND c.EntidadID = p.ProyectoID AND c.Relacion = 'REQUIERE') AS requiere,
               (SELECT COUNT(*) FROM dbo.DesCapacidadUso c JOIN dbo.DesCapacidades k ON k.CapacidadID = c.CapacidadID AND k.Borrado = 0 WHERE c.Entidad = 'PROYECTO' AND c.EntidadID = p.ProyectoID AND c.Relacion = 'RESUELVE') AS resuelve,
               (SELECT COUNT(*) FROM dbo.DesComentarios k WHERE k.Entidad = 'PROYECTO' AND k.EntidadID = p.ProyectoID) AS comentarios
        FROM dbo.DesProyectos p
        LEFT JOIN dbo.Usuarios ul ON ul.IdUsuario = p.LiderUsuarioID
        LEFT JOIN dbo.Articulos a ON a.ProIdProducto = p.ProIdProducto
        LEFT JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
        LEFT JOIN dbo.ProductoVentaConfig v ON v.ProIdProducto = p.ProIdProducto
        LEFT JOIN dbo.ProductoEtiqueta et ON et.EtiquetaID = COALESCE(v.EtiquetaID, p.EtiquetaID)
        LEFT JOIN dbo.DesSolicitudes s ON s.SolicitudID = p.SolicitudID
        WHERE ${filtro}`)).recordset;
    if (!proyectos.length) return [];
    const lista = proyectos.map(p => p.id).join(',');

    const etapas = (await db.request().query(`
        SELECT EtapaID AS id, ProyectoID AS proyectoId, Clave AS clave, Nombre AS nombre, Color AS color, Orden AS orden
        FROM dbo.DesProyectoEtapas WHERE ProyectoID IN (${lista}) ORDER BY ProyectoID, Orden, EtapaID`)).recordset;
    // Tandas abiertas: de cada proyecto y de cada tarea (Planificación, fase 3)
    const tandasProy = (await db.request().query(`
        SELECT tp.ProyectoID AS proyectoId, t.TandaID AS id, t.Nombre AS nombre
        FROM dbo.DesTandaProyectos tp JOIN dbo.DesTandas t ON t.TandaID = tp.TandaID AND t.Estado = 'ABIERTA'
        WHERE tp.ProyectoID IN (${lista}) ORDER BY t.Inicio`)).recordset;

    let tareas = [];
    let deps = [];
    let tandaTarea = [];
    if (conTareas) {
        tareas = (await db.request().query(`
            SELECT t.TareaID AS id, t.ProyectoID AS proyectoId, t.EtapaID AS etapaId, t.Nombre AS nombre, t.Orden AS orden, t.Estado AS estado,
                   t.ResponsableUsuarioID AS responsableId,
                   COALESCE(NULLIF(LTRIM(RTRIM(u.Nombre)), ''), NULLIF(LTRIM(RTRIM(u.Usuario)), ''), t.ResponsableTexto) AS responsable,
                   CONVERT(CHAR(10), t.Fecha, 23) AS fecha, t.HechoEl AS hechoEl, t.DiasHabiles AS diasHabiles, t.Entregable AS entregable,
                   t.Nota AS nota, t.PideRef AS pideRef, t.MarcaErp AS marcaErp
            FROM dbo.DesTareas t
            LEFT JOIN dbo.Usuarios u ON u.IdUsuario = t.ResponsableUsuarioID
            WHERE t.ProyectoID IN (${lista})`)).recordset;
        deps = (await db.request().query(`
            SELECT d.TareaID AS tareaId, d.DependeDeTareaID AS dependeDe FROM dbo.DesTareaDependencias d
            JOIN dbo.DesTareas t ON t.TareaID = d.TareaID WHERE t.ProyectoID IN (${lista})`)).recordset;
        tandaTarea = (await db.request().query(`
            SELECT tt.TareaID AS tareaId, t.TandaID AS id, t.Nombre AS nombre
            FROM dbo.DesTandaTareas tt JOIN dbo.DesTandas t ON t.TandaID = tt.TandaID
            JOIN dbo.DesTareas x ON x.TareaID = tt.TareaID
            WHERE tt.Abierta = 1 AND x.ProyectoID IN (${lista})`)).recordset;
    }

    const etapasDe = new Map();
    for (const e of etapas) { if (!etapasDe.has(e.proyectoId)) etapasDe.set(e.proyectoId, []); etapasDe.get(e.proyectoId).push(e); }
    const depsDe = new Map();
    for (const d of deps) { if (!depsDe.has(d.tareaId)) depsDe.set(d.tareaId, []); depsDe.get(d.tareaId).push(d.dependeDe); }
    const tandaDe = new Map(tandaTarea.map(t => [t.tareaId, { id: t.id, nombre: t.nombre }]));
    const tareasDe = new Map();
    for (const t of tareas) {
        if (!tareasDe.has(t.proyectoId)) tareasDe.set(t.proyectoId, []);
        tareasDe.get(t.proyectoId).push({ ...t, depende: depsDe.get(t.id) || [], tanda: tandaDe.get(t.id) || null });
    }

    return proyectos.map(p => {
        const es = etapasDe.get(p.id) || [];
        const ordenEtapa = new Map(es.map(e => [e.id, e.orden]));
        const ts = (tareasDe.get(p.id) || []).sort((a, b) => ((ordenEtapa.get(a.etapaId) ?? 99) - (ordenEtapa.get(b.etapaId) ?? 99)) || (a.orden - b.orden) || (a.id - b.id));
        return {
            ...p,
            codigoSolicitud: p.solicitudNumero ? `DES-${String(p.solicitudNumero).padStart(2, '0')}` : null,
            etapas: es,
            tareas: conTareas ? ts : undefined,
            tandas: tandasProy.filter(t => t.proyectoId === p.id).map(t => ({ id: t.id, nombre: t.nombre })),
        };
    });
}

// Resumen para listas: tarea actual, etapa actual, avance y atrasadas (como DP.tareaActual, etapaDe,
// avance y atrasadas). La etapa es 'CANCELADO', la de la primera tarea sin terminar o 'TERMINADO'.
function resumen(p) {
    const ts = p.tareas || [];
    const actual = p.estado === 'CANCELADO' ? null : ts.find(t => PENDIENTE(t.estado)) || null;
    const etapa = p.estado === 'CANCELADO' ? 'CANCELADO' : actual ? actual.etapaId : 'TERMINADO';
    const aplican = ts.filter(t => t.estado !== 'NO_APLICA');
    const h = ts.filter(t => t.estado === 'HECHO').length;
    const hoy = hoyUY();
    return {
        tareaActual: actual ? { id: actual.id, nombre: actual.nombre, responsable: actual.responsable, responsableId: actual.responsableId, fecha: actual.fecha, etapaId: actual.etapaId } : null,
        etapaActual: etapa,
        avance: { h, t: aplican.length, pct: aplican.length ? Math.round(h * 100 / aplican.length) : 0 },
        atrasadas: ts.filter(t => t.fecha && t.fecha < hoy && PENDIENTE(t.estado)).length,
    };
}

// Etapa actual leída de la base: { etapaId, nombre } o null si no queda nada pendiente.
async function etapaActualDB(tx, proyectoId) {
    const r = await tx.request().input('P', sql.Int, proyectoId).query(`
        SELECT TOP 1 e.EtapaID AS etapaId, e.Nombre AS nombre FROM dbo.DesTareas t JOIN dbo.DesProyectoEtapas e ON e.EtapaID = t.EtapaID
        WHERE t.ProyectoID = @P AND t.Estado NOT IN ('HECHO', 'NO_APLICA') ORDER BY e.Orden, t.Orden, t.TareaID`);
    return r.recordset[0] || null;
}

// Después de tocar tareas: si cambió la etapa actual, deja el rastro en el historial y marca o
// desmarca el terminado. Devuelve { terminadoAhora } (para avisarle a quien pidió el desarrollo).
async function registrarCambioEtapa(tx, proyectoId, antes) {
    const despues = await etapaActualDB(tx, proyectoId);
    const clave = (e) => (e ? e.etapaId : 'TERMINADO');
    if (clave(antes) === clave(despues)) return { terminadoAhora: false };
    await tx.request().input('P', sql.Int, proyectoId).input('E', sql.Int, despues?.etapaId || null)
        .input('N', sql.NVarChar(40), despues ? despues.nombre : 'Terminado')
        .query('INSERT INTO dbo.DesHistorialEtapas (ProyectoID, EtapaID, Etapa) VALUES (@P, @E, @N)');
    await tx.request().input('P', sql.Int, proyectoId).input('T', sql.Bit, !despues)
        .query('UPDATE dbo.DesProyectos SET FechaTerminado = CASE WHEN @T = 1 THEN GETDATE() ELSE NULL END, FechaActualizado = GETDATE() WHERE ProyectoID = @P');
    return { terminadoAhora: !despues };
}

module.exports = { leerProyectos, resumen, etapaActualDB, registrarCambioEtapa, PENDIENTE };
