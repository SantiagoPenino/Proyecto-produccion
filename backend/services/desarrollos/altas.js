// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — altas que cruzan tablas (los "cruces" del prototipo): códigos, proyecto desde una
// plantilla y variante. Todo recibe la transacción de quien llama.
// Plan: docs/desarrollos/plan-integracion.md · Reglas: docs/desarrollos/spec-B §2.7 y §3.6.
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../../config/db');
const { codigoSolicitud, hoyUY } = require('./comun');

// Próximo número de pedido (DES-NN). Con UPDLOCK + HOLDLOCK dos altas al mismo tiempo no repiten número.
async function siguienteNumeroSolicitud(tx) {
    const r = await tx.request().query('SELECT ISNULL(MAX(Numero), 0) + 1 AS n FROM dbo.DesSolicitudes WITH (UPDLOCK, HOLDLOCK)');
    return r.recordset[0].n;
}

// Próximo código de proyecto: PD-NN o CO-NN (máximo + 1 por prefijo, mínimo dos dígitos, como nextCode).
// Cuenta también los borrados, para no reusar un código que alguien recuerde.
async function siguienteCodigoProyecto(tx, prefijo) {
    const r = await tx.request().input('P', sql.VarChar(10), prefijo).query(`
        SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(Codigo, LEN(@P) + 1, 20) AS INT)), 0) + 1 AS n
        FROM dbo.DesProyectos WITH (UPDLOCK, HOLDLOCK) WHERE Codigo LIKE @P + '%'`);
    return `${prefijo}${String(r.recordset[0].n).padStart(2, '0')}`;
}

async function leerPlantilla(tx, { plantillaId = null, clave = null }) {
    const req = tx.request();
    let filtro;
    if (plantillaId) { req.input('Id', sql.Int, plantillaId); filtro = 'PlantillaID = @Id'; }
    else { req.input('C', sql.VarChar(40), clave); filtro = 'Clave = @C'; }
    const p = (await req.query(`SELECT PlantillaID, Clave, Nombre, Para, TipoID FROM dbo.DesPlantillas WHERE ${filtro} AND Activo = 1`)).recordset[0];
    if (!p) return null;
    const etapas = (await tx.request().input('P', sql.Int, p.PlantillaID)
        .query('SELECT EtapaID, Clave, Nombre, Color, Orden FROM dbo.DesPlantillaEtapas WHERE PlantillaID = @P ORDER BY Orden, EtapaID')).recordset;
    const tareas = (await tx.request().input('P', sql.Int, p.PlantillaID)
        .query('SELECT EtapaID, Nombre, DiasHabiles, Entregable, PideRef, MarcaErp, Orden FROM dbo.DesPlantillaTareas WHERE PlantillaID = @P ORDER BY Orden, PlantillaTareaID')).recordset;
    return { ...p, etapas, tareas };
}

// Crea un proyecto con las etapas y tareas de la plantilla (las copia: cambiar la plantilla después
// no toca el proyecto). Todas las tareas quedan pendientes y a nombre de `responsableId`.
// datos: { nombre, tipo: NUEVO|CORRECCION, tipoOrigen, origen, tipoId, liderId, lineaAreaId, fechaLimite,
//          proIdProducto, refErpTexto, familia, etiquetaId, notas, puntaje {E,C,X,R}, solicitudId, corrigeProyectoId }
async function crearProyecto(tx, plantilla, datos, responsableId) {
    const codigo = await siguienteCodigoProyecto(tx, datos.tipo === 'CORRECCION' ? 'CO-' : 'PD-');
    const r = await tx.request()
        .input('Codigo', sql.VarChar(20), codigo)
        .input('Nombre', sql.NVarChar(120), String(datos.nombre || 'Sin nombre').slice(0, 120))
        .input('Tipo', sql.VarChar(12), datos.tipo)
        .input('TipoOrigen', sql.VarChar(20), datos.tipoOrigen || null)
        .input('Origen', sql.VarChar(20), datos.origen || null)
        .input('TipoID', sql.Int, datos.tipoId)
        .input('PlantillaID', sql.Int, plantilla.PlantillaID)
        .input('PlantillaNombre', sql.NVarChar(60), plantilla.Nombre)
        .input('Lider', sql.Int, datos.liderId || null)
        .input('Linea', sql.VarChar(20), datos.lineaAreaId || null)
        .input('Inicio', sql.VarChar(10), hoyUY())
        .input('Limite', sql.VarChar(10), datos.fechaLimite || null)
        .input('Pro', sql.Int, datos.proIdProducto || null)
        .input('Ref', sql.NVarChar(40), datos.refErpTexto || null)
        .input('Familia', sql.NVarChar(60), datos.familia || null)
        .input('Etiqueta', sql.Int, datos.etiquetaId || null)
        .input('Notas', sql.NVarChar(sql.MAX), datos.notas || null)
        .input('E', sql.TinyInt, datos.puntaje?.estrategico ?? null)
        .input('C', sql.TinyInt, datos.puntaje?.comercial ?? null)
        .input('X', sql.TinyInt, datos.puntaje?.complejidad ?? null)
        .input('R', sql.TinyInt, datos.puntaje?.recursos ?? null)
        .input('Sol', sql.Int, datos.solicitudId || null)
        .input('Corr', sql.Int, datos.corrigeProyectoId || null)
        .query(`INSERT INTO dbo.DesProyectos (Codigo, Nombre, Tipo, TipoOrigen, Origen, TipoID, PlantillaID, PlantillaNombre, Estado,
                    LiderUsuarioID, LineaAreaID, FechaInicio, FechaLimite, ProIdProducto, RefErpTexto, Familia, EtiquetaID, Notas,
                    Estrategico, Comercial, Complejidad, Recursos, SolicitudID, CorrigeProyectoID)
                OUTPUT INSERTED.ProyectoID
                VALUES (@Codigo, @Nombre, @Tipo, @TipoOrigen, @Origen, @TipoID, @PlantillaID, @PlantillaNombre, 'ACTIVO',
                    @Lider, @Linea, CONVERT(DATE, @Inicio, 23), CONVERT(DATE, @Limite, 23), @Pro, @Ref, @Familia, @Etiqueta, @Notas,
                    @E, @C, @X, @R, @Sol, @Corr)`);
    const proyectoId = r.recordset[0].ProyectoID;

    const etapaNueva = new Map(); // etapa de la plantilla → etapa del proyecto
    for (const e of plantilla.etapas) {
        const re = await tx.request()
            .input('P', sql.Int, proyectoId).input('C', sql.VarChar(40), e.Clave).input('N', sql.NVarChar(40), e.Nombre)
            .input('Col', sql.VarChar(7), e.Color).input('O', sql.Int, e.Orden)
            .query('INSERT INTO dbo.DesProyectoEtapas (ProyectoID, Clave, Nombre, Color, Orden) OUTPUT INSERTED.EtapaID VALUES (@P, @C, @N, @Col, @O)');
        etapaNueva.set(e.EtapaID, re.recordset[0].EtapaID);
    }
    for (const t of plantilla.tareas) {
        await tx.request()
            .input('P', sql.Int, proyectoId).input('E', sql.Int, etapaNueva.get(t.EtapaID))
            .input('N', sql.NVarChar(120), t.Nombre).input('O', sql.Int, t.Orden)
            .input('Resp', sql.Int, responsableId || null)
            // Como tplPasos: una duración de 0 en la plantilla queda en 1 en el proyecto
            .input('D', sql.Int, t.DiasHabiles || 1)
            .input('Ent', sql.NVarChar(80), t.Entregable || null)
            .input('Ref', sql.Bit, !!t.PideRef).input('Erp', sql.Bit, !!t.MarcaErp)
            .query(`INSERT INTO dbo.DesTareas (ProyectoID, EtapaID, Nombre, Orden, Estado, ResponsableUsuarioID, DiasHabiles, Entregable, PideRef, MarcaErp)
                    VALUES (@P, @E, @N, @O, 'PENDIENTE', @Resp, @D, @Ent, @Ref, @Erp)`);
    }
    // Historial: arranca en la primera etapa (la de la primera tarea; si no hay tareas, la primera)
    const primera = plantilla.etapas.find(e => plantilla.tareas.some(t => t.EtapaID === e.EtapaID)) || plantilla.etapas[0];
    if (primera) {
        await tx.request().input('P', sql.Int, proyectoId).input('E', sql.Int, etapaNueva.get(primera.EtapaID)).input('N', sql.NVarChar(40), primera.Nombre)
            .query('INSERT INTO dbo.DesHistorialEtapas (ProyectoID, EtapaID, Etapa) VALUES (@P, @E, @N)');
    }
    return { proyectoId, codigo };
}

// Variante nueva de un producto, con las tareas de la plantilla "variante" a nombre del responsable.
// datos: { proyectoId, nombre, libre, combinacion, origen, solicitudId, estado, responsableId, fechaLimite, nota }
async function crearVariante(tx, datos) {
    const orden = (await tx.request().input('P', sql.Int, datos.proyectoId)
        .query('SELECT ISNULL(MAX(Orden), 0) + 1 AS n FROM dbo.DesVariantes WHERE ProyectoID = @P')).recordset[0].n;
    const r = await tx.request()
        .input('P', sql.Int, datos.proyectoId).input('N', sql.NVarChar(120), String(datos.nombre || 'Sin nombre').slice(0, 120))
        .input('Comb', sql.NVarChar(2000), datos.combinacion && Object.keys(datos.combinacion).length ? JSON.stringify(datos.combinacion) : null)
        .input('L', sql.NVarChar(200), datos.libre ? String(datos.libre).slice(0, 200) : null)
        .input('Or', sql.VarChar(12), datos.origen || 'equipo').input('S', sql.Int, datos.solicitudId || null)
        .input('Est', sql.VarChar(14), datos.estado || 'PROPUESTA')
        .input('Resp', sql.Int, datos.responsableId || null)
        .input('F', sql.VarChar(10), datos.fechaLimite || null)
        .input('Nota', sql.NVarChar(300), datos.nota ? String(datos.nota).slice(0, 300) : null)
        .input('O', sql.Int, orden)
        .query(`INSERT INTO dbo.DesVariantes (ProyectoID, Nombre, CombinacionJson, Libre, Origen, SolicitudID, Estado, Moldes, Tizada, TizadaNombre, Erp,
                    ResponsableUsuarioID, Fecha, Nota, Orden)
                OUTPUT INSERTED.VarianteID
                VALUES (@P, @N, @Comb, @L, @Or, @S, @Est, 'NO', 'NO', NULL, 'NO', @Resp, CONVERT(DATE, @F, 23), @Nota, @O)`);
    const varianteId = r.recordset[0].VarianteID;
    const plantilla = await leerPlantilla(tx, { clave: 'variante' });
    if (plantilla) {
        const claveEtapa = new Map(plantilla.etapas.map(e => [e.EtapaID, e.Clave || e.Nombre]));
        const ordenEtapa = new Map(plantilla.etapas.map(e => [e.EtapaID, e.Orden]));
        const tareas = [...plantilla.tareas].sort((a, b) => (ordenEtapa.get(a.EtapaID) - ordenEtapa.get(b.EtapaID)) || (a.Orden - b.Orden));
        for (const [i, t] of tareas.entries()) {
            await tx.request()
                .input('V', sql.Int, varianteId).input('E', sql.VarChar(40), claveEtapa.get(t.EtapaID))
                .input('N', sql.NVarChar(120), t.Nombre).input('O', sql.Int, i + 1)
                .input('Resp', sql.Int, datos.responsableId || null).input('D', sql.Int, t.DiasHabiles || 1)
                .input('Ent', sql.NVarChar(80), t.Entregable || null)
                .query(`INSERT INTO dbo.DesVarianteTareas (VarianteID, EtapaClave, Nombre, Orden, Estado, ResponsableUsuarioID, DiasHabiles, Entregable)
                        VALUES (@V, @E, @N, @O, 'PENDIENTE', @Resp, @D, @Ent)`);
        }
    }
    return varianteId;
}

// Plantilla que se propone para un tipo de desarrollo. Como plantillaPara del prototipo, con el arreglo
// del plan (§7.13): "proceso" propone "Proceso o procedimiento" (antes caía en la de máquina) y
// "tecnología" la de máquina, como dice el Plan funcional.
const PLANTILLA_POR_TIPO = { tecnologia: 'maquina', proceso: 'procedimiento' };
function plantillaPara(plantillas, tipos, tipoId) {
    const tipo = tipos.find(t => t.id === tipoId || t.TipoID === tipoId);
    const clave = tipo?.clave || tipo?.Clave;
    const productos = plantillas.filter(p => (p.para || p.Para) === 'PRODUCTO');
    const id = (p) => p.id ?? p.PlantillaID;
    const deTipo = productos.find(p => (p.tipoId ?? p.TipoID) === tipoId);
    if (deTipo) return id(deTipo);
    const porClave = PLANTILLA_POR_TIPO[clave] && productos.find(p => (p.clave ?? p.Clave) === PLANTILLA_POR_TIPO[clave]);
    if (porClave) return id(porClave);
    const esProducto = !!(tipo?.esProducto ?? tipo?.EsProducto);
    if (!esProducto) {
        const otra = productos.find(p => {
            const t = tipos.find(x => (x.id ?? x.TipoID) === (p.tipoId ?? p.TipoID));
            return t && !(t.esProducto ?? t.EsProducto);
        });
        if (otra) return id(otra);
    }
    const prenda = productos.find(p => (p.clave ?? p.Clave) === 'prenda');
    return prenda ? id(prenda) : (productos[0] ? id(productos[0]) : null);
}

module.exports = {
    siguienteNumeroSolicitud, siguienteCodigoProyecto, leerPlantilla, crearProyecto, crearVariante, plantillaPara, codigoSolicitud,
};
