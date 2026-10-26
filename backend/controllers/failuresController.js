const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Catálogo de tipos de falla de producción (TiposFallas), por área.
// Los tickets de mantenimiento de máquinas (TicketsMantenimiento, que además dejaban la máquina
// en 'FALLA' para siempre) se reemplazaron por Servicio Técnico — controllers/servicioTecnicoController.js.

// =====================================================================
// 1. BUSCAR TÍTULOS DE FALLA (Nomenclador)
// =====================================================================
exports.searchFailureTitles = async (req, res) => {
    const { q, area } = req.query;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('term', sql.NVarChar(100), `%${q || ''}%`)
            .input('area', sql.VarChar(20), area)
            .query(`
                SELECT Top 10 Titulo
                FROM dbo.TiposFallas
                WHERE AreaID = @area AND Titulo LIKE @term
                ORDER BY EsFrecuente DESC, Titulo ASC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 2. CREAR NUEVO TIPO DE FALLA (Catálogo)
// =====================================================================
exports.createFailureType = async (req, res) => {
    const { areaId, titulo } = req.body;

    if (!areaId || !titulo) return res.status(400).json({ error: "Faltan datos" });

    try {
        const pool = await getPool();

        // Insertar directo (con validación de existencia implícita en SQL)
        await pool.request()
            .input('AreaID', sql.VarChar(20), areaId)
            .input('Titulo', sql.NVarChar(200), titulo)
            .query(`
                IF NOT EXISTS (SELECT * FROM dbo.TiposFallas WHERE AreaID = @AreaID AND Titulo = @Titulo)
                BEGIN
                    INSERT INTO dbo.TiposFallas (AreaID, Titulo) VALUES (@AreaID, @Titulo)
                END
            `);

        res.json({ success: true, message: 'Catálogo actualizado' });
    } catch (err) {
        logger.error("Error crear tipo falla:", err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 3. ADMINISTRAR TIPOS DE FALLA (pantalla «Tipos de falla», 23/10/2026)
// =====================================================================
// Cada tipo es de un área (AreaID) o 'General' (se ofrece en todas las áreas). Dice dónde se ofrece:
// EnProduccion (al reportar una falla en Control/planilla) y/o EnReposicion (razón principal de una
// reposición de Atención al Cliente). Activo = 0 lo oculta de las listas sin perder el historial
// (FallasProduccion.TipoFalla guarda el FallaID). Solo se borra si nunca se usó.
// Requiere las columnas Activo / EnProduccion / EnReposicion (ver Notas de deploy del CHANGELOG).
const AREA_GENERAL = 'General';
const AREA_VALIDA = /^[A-Za-z0-9_\-]{1,20}$/;

const leerTipoDelBody = (body = {}) => {
    const titulo = String(body.titulo || '').trim();
    const descripcion = String(body.descripcion || '').trim();
    const areaId = String(body.areaId || '').trim() || AREA_GENERAL;
    const enProduccion = !!body.enProduccion;
    const enReposicion = !!body.enReposicion;
    if (!titulo) return { error: 'Falta el nombre del tipo de falla.' };
    if (titulo.length > 100) return { error: 'El nombre no puede pasar de 100 caracteres.' };
    if (descripcion.length > 255) return { error: 'La descripción no puede pasar de 255 caracteres.' };
    if (areaId !== AREA_GENERAL && !AREA_VALIDA.test(areaId)) return { error: 'Área inválida.' };
    if (!enProduccion && !enReposicion) return { error: 'Marcá dónde se ofrece: en producción, en reposiciones o en los dos.' };
    return {
        datos: {
            titulo, descripcion: descripcion || null, areaId, enProduccion, enReposicion,
            frecuente: !!body.frecuente,
            activo: body.activo === undefined ? true : !!body.activo,
        },
    };
};

// Mismo nombre en la misma área (sin importar mayúsculas ni espacios de los costados)
const existeDuplicado = async (pool, { areaId, titulo }, exceptoId = null) => {
    const r = await pool.request()
        .input('AreaID', sql.VarChar(20), areaId)
        .input('Titulo', sql.NVarChar(100), titulo)
        .input('Excepto', sql.Int, exceptoId)
        .query(`SELECT TOP 1 FallaID FROM dbo.TiposFallas
                WHERE AreaID = @AreaID AND LOWER(LTRIM(RTRIM(Titulo))) = LOWER(@Titulo)
                  AND (@Excepto IS NULL OR FallaID <> @Excepto)`);
    return r.recordset.length > 0;
};

// GET /api/failures/tipos → { tipos, areas }: todos los tipos (también los inactivos) con cuántas
// fallas registradas tienen, y las áreas para elegir (las productivas de ConfigMapeoERP más las que
// ya tengan tipos cargados).
exports.listarTipos = async (req, res) => {
    try {
        const pool = await getPool();
        const [rt, ru, rm, ra, rp] = await Promise.all([
            pool.request().query(`SELECT FallaID, LTRIM(RTRIM(AreaID)) AS AreaID, Titulo, DescripcionDefault, EsFrecuente,
                                         Activo, EnProduccion, EnReposicion
                                  FROM dbo.TiposFallas WITH(NOLOCK)`),
            pool.request().query(`SELECT TRY_CAST(TipoFalla AS INT) AS FallaID, COUNT(*) AS Usos
                                  FROM dbo.FallasProduccion WITH(NOLOCK)
                                  GROUP BY TRY_CAST(TipoFalla AS INT)`),
            pool.request().query(`SELECT DISTINCT LTRIM(RTRIM(AreaID_Interno)) AS Codigo, NombreReferencia
                                  FROM dbo.ConfigMapeoERP WITH(NOLOCK) WHERE AreaID_Interno IS NOT NULL`),
            pool.request().query(`SELECT LTRIM(RTRIM(AreaID)) AS Codigo, Nombre FROM dbo.Areas WITH(NOLOCK)`),
            // Prefijo con que se nombran las órdenes de cada área (DF → DTF, SB → SUB, ECOUV → EUV, EMB → BOR…):
            // el más usado, como en el Panel de Control. Es lo que la gente reconoce; el AreaID interno se sigue guardando.
            pool.request().query(`SELECT LTRIM(RTRIM(AreaID)) AS Codigo, LEFT(CodigoOrden, CHARINDEX('-', CodigoOrden + '-') - 1) AS Prefijo, COUNT(*) AS n
                                  FROM dbo.Ordenes WITH(NOLOCK) WHERE AreaID IS NOT NULL
                                  GROUP BY LTRIM(RTRIM(AreaID)), LEFT(CodigoOrden, CHARINDEX('-', CodigoOrden + '-') - 1)`),
        ]);
        const prefijo = {};
        const masUsado = {};
        for (const r of rp.recordset) {
            const pre = String(r.Prefijo || '').trim();
            if (pre && (!masUsado[r.Codigo] || r.n > masUsado[r.Codigo])) { masUsado[r.Codigo] = r.n; prefijo[r.Codigo] = pre; }
        }
        const usos = Object.fromEntries(ru.recordset.filter(u => u.FallaID != null).map(u => [u.FallaID, u.Usos]));
        const nombreMapeo = Object.fromEntries(rm.recordset.map(a => [a.Codigo, String(a.NombreReferencia || '').trim()]));
        const nombreArea = Object.fromEntries(ra.recordset.map(a => [a.Codigo, String(a.Nombre || '').trim()]));
        const codigos = new Set([...rm.recordset.map(a => a.Codigo), ...rt.recordset.map(t => t.AreaID)]);
        codigos.delete(AREA_GENERAL);
        codigos.delete('');
        // sinArea: el código no está en ConfigMapeoERP ni en Areas (ej. 'DTF', cuando el área es 'DF'): sus tipos
        // no se ofrecen en ninguna lista, porque ninguna orden tiene ese AreaID.
        const areas = [...codigos]
            .map(codigo => ({ codigo, nombre: nombreMapeo[codigo] || nombreArea[codigo] || codigo, prefijo: prefijo[codigo] || null, sinArea: !nombreMapeo[codigo] && !nombreArea[codigo] }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        const tipos = rt.recordset.map(t => ({
            id: t.FallaID,
            areaId: t.AreaID,
            titulo: t.Titulo,
            descripcion: t.DescripcionDefault || '',
            frecuente: !!t.EsFrecuente,
            activo: !!t.Activo,
            enProduccion: !!t.EnProduccion,
            enReposicion: !!t.EnReposicion,
            usos: usos[t.FallaID] || 0,
        }));
        res.json({ tipos, areas });
    } catch (err) {
        logger.error('Error listar tipos de falla:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/failures/tipos
exports.crearTipo = async (req, res) => {
    const { error, datos } = leerTipoDelBody(req.body);
    if (error) return res.status(400).json({ error });
    try {
        const pool = await getPool();
        if (await existeDuplicado(pool, datos)) {
            return res.status(409).json({ error: `Ya hay un tipo «${datos.titulo}» en ${datos.areaId}.` });
        }
        const r = await pool.request()
            .input('AreaID', sql.VarChar(20), datos.areaId)
            .input('Titulo', sql.NVarChar(100), datos.titulo)
            .input('Desc', sql.NVarChar(255), datos.descripcion)
            .input('Frec', sql.Bit, datos.frecuente)
            .input('Activo', sql.Bit, datos.activo)
            .input('EnProd', sql.Bit, datos.enProduccion)
            .input('EnRepo', sql.Bit, datos.enReposicion)
            .query(`INSERT INTO dbo.TiposFallas (AreaID, Titulo, DescripcionDefault, EsFrecuente, Activo, EnProduccion, EnReposicion)
                    OUTPUT INSERTED.FallaID
                    VALUES (@AreaID, @Titulo, @Desc, @Frec, @Activo, @EnProd, @EnRepo)`);
        logger.info(`[Tipos de falla] Creado #${r.recordset[0].FallaID} «${datos.titulo}» (${datos.areaId}) por usuario ${req.user?.id}.`);
        res.json({ success: true, id: r.recordset[0].FallaID });
    } catch (err) {
        logger.error('Error crear tipo de falla:', err);
        res.status(500).json({ error: err.message });
    }
};

// PUT /api/failures/tipos/:id
exports.editarTipo = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Tipo de falla inválido.' });
    const { error, datos } = leerTipoDelBody(req.body);
    if (error) return res.status(400).json({ error });
    try {
        const pool = await getPool();
        if (await existeDuplicado(pool, datos, id)) {
            return res.status(409).json({ error: `Ya hay un tipo «${datos.titulo}» en ${datos.areaId}.` });
        }
        const r = await pool.request()
            .input('ID', sql.Int, id)
            .input('AreaID', sql.VarChar(20), datos.areaId)
            .input('Titulo', sql.NVarChar(100), datos.titulo)
            .input('Desc', sql.NVarChar(255), datos.descripcion)
            .input('Frec', sql.Bit, datos.frecuente)
            .input('Activo', sql.Bit, datos.activo)
            .input('EnProd', sql.Bit, datos.enProduccion)
            .input('EnRepo', sql.Bit, datos.enReposicion)
            .query(`UPDATE dbo.TiposFallas
                    SET AreaID = @AreaID, Titulo = @Titulo, DescripcionDefault = @Desc, EsFrecuente = @Frec,
                        Activo = @Activo, EnProduccion = @EnProd, EnReposicion = @EnRepo
                    WHERE FallaID = @ID`);
        if (!r.rowsAffected[0]) return res.status(404).json({ error: 'No existe ese tipo de falla.' });
        logger.info(`[Tipos de falla] Editado #${id} «${datos.titulo}» (${datos.areaId}, activo=${datos.activo}) por usuario ${req.user?.id}.`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Error editar tipo de falla:', err);
        res.status(500).json({ error: err.message });
    }
};

// DELETE /api/failures/tipos/:id → solo si ninguna falla registrada lo usa (si no, se desactiva)
exports.borrarTipo = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Tipo de falla inválido.' });
    try {
        const pool = await getPool();
        const u = await pool.request().input('ID', sql.Int, id)
            .query(`SELECT COUNT(*) AS n FROM dbo.FallasProduccion WITH(NOLOCK) WHERE TRY_CAST(TipoFalla AS INT) = @ID`);
        const usos = u.recordset[0].n;
        if (usos > 0) {
            return res.status(409).json({ error: `Tiene ${usos} falla(s) registradas: no se puede borrar sin perder ese historial. Desactivalo.` });
        }
        const r = await pool.request().input('ID', sql.Int, id).query('DELETE FROM dbo.TiposFallas WHERE FallaID = @ID');
        if (!r.rowsAffected[0]) return res.status(404).json({ error: 'No existe ese tipo de falla.' });
        logger.info(`[Tipos de falla] Borrado #${id} por usuario ${req.user?.id}.`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Error borrar tipo de falla:', err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 4. SUGERENCIAS DE SERVICIO TÉCNICO (pestaña «Servicio Técnico», 23/10/2026)
// =====================================================================
// ST_TiposFalla: las sugerencias del «¿Qué pasa?» al pedir Servicio Técnico. Se agregan solas: cada solicitud suma
// un uso a su texto (o lo crea). Se cargó de entrada con los títulos de los tickets de mantenimiento viejos, por eso
// hay fallas de impresión mezcladas. No hay FK: las solicitudes guardan su texto, así que borrar o renombrar no
// cambia ninguna solicitud. Un texto desactivado sigue sumando usos pero no se sugiere; uno borrado vuelve a
// aparecer si alguien lo escribe de nuevo.
const GRUPO_ST = { MAQUINA: 'MAQUINA', PC: 'PC', RED: 'PC', SOFTWARE: 'PC', OTRO: 'OTRO', INSTALACIONES: 'OTRO' };
const CATEGORIAS_ST = ['MAQUINA', 'PC', 'OTRO'];

const leerSugerenciaDelBody = (body = {}) => {
    const titulo = String(body.titulo || '').trim();
    const categoria = String(body.categoria || '').trim().toUpperCase();
    if (!titulo) return { error: 'Falta el texto de la sugerencia.' };
    if (titulo.length > 200) return { error: 'El texto no puede pasar de 200 caracteres.' };
    if (!CATEGORIAS_ST.includes(categoria)) return { error: 'Elegí el tipo de problema: Máquina, PC e internet u Otro.' };
    return { datos: { titulo, categoria, activo: body.activo === undefined ? true : !!body.activo } };
};

// Mismo texto en el mismo tipo de problema (contando los tipos viejos del grupo)
const existeSugerencia = async (pool, { titulo, categoria }, exceptoId = null) => {
    const cats = Object.keys(GRUPO_ST).filter(c => GRUPO_ST[c] === categoria);
    const r = pool.request().input('Titulo', sql.NVarChar(200), titulo).input('Excepto', sql.Int, exceptoId);
    cats.forEach((c, i) => r.input(`C${i}`, sql.VarChar(20), c));
    const q = await r.query(`SELECT TOP 1 TipoId FROM dbo.ST_TiposFalla
                             WHERE Categoria IN (${cats.map((_, i) => `@C${i}`).join(', ')})
                               AND LOWER(LTRIM(RTRIM(Titulo))) = LOWER(@Titulo)
                               AND (@Excepto IS NULL OR TipoId <> @Excepto)`);
    return q.recordset.length > 0;
};

// GET /api/failures/st-tipos → todas (también las desactivadas), con el grupo nuevo (MAQUINA / PC / OTRO)
exports.listarSugerenciasST = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`SELECT TipoId, Categoria, Titulo, Usos, Activo FROM dbo.ST_TiposFalla WITH(NOLOCK)`);
        res.json({
            sugerencias: r.recordset.map(t => ({
                id: t.TipoId, categoria: GRUPO_ST[String(t.Categoria || '').trim().toUpperCase()] || 'OTRO',
                titulo: t.Titulo, usos: t.Usos || 0, activo: !!t.Activo,
            })),
        });
    } catch (err) {
        logger.error('Error listar sugerencias de Servicio Técnico:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/failures/st-tipos
exports.crearSugerenciaST = async (req, res) => {
    const { error, datos } = leerSugerenciaDelBody(req.body);
    if (error) return res.status(400).json({ error });
    try {
        const pool = await getPool();
        if (await existeSugerencia(pool, datos)) return res.status(409).json({ error: `Ya está la sugerencia «${datos.titulo}» en ese tipo de problema.` });
        const r = await pool.request()
            .input('Cat', sql.VarChar(20), datos.categoria).input('Titulo', sql.NVarChar(200), datos.titulo).input('Activo', sql.Bit, datos.activo)
            .query(`INSERT INTO dbo.ST_TiposFalla (Categoria, Titulo, Usos, Activo) OUTPUT INSERTED.TipoId VALUES (@Cat, @Titulo, 0, @Activo)`);
        logger.info(`[Tipos de falla · ST] Sugerencia #${r.recordset[0].TipoId} «${datos.titulo}» (${datos.categoria}) creada por usuario ${req.user?.id}.`);
        res.json({ success: true, id: r.recordset[0].TipoId });
    } catch (err) {
        logger.error('Error crear sugerencia de Servicio Técnico:', err);
        res.status(500).json({ error: err.message });
    }
};

// PUT /api/failures/st-tipos/:id
exports.editarSugerenciaST = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Sugerencia inválida.' });
    const { error, datos } = leerSugerenciaDelBody(req.body);
    if (error) return res.status(400).json({ error });
    try {
        const pool = await getPool();
        if (await existeSugerencia(pool, datos, id)) return res.status(409).json({ error: `Ya está la sugerencia «${datos.titulo}» en ese tipo de problema.` });
        const r = await pool.request()
            .input('ID', sql.Int, id).input('Cat', sql.VarChar(20), datos.categoria).input('Titulo', sql.NVarChar(200), datos.titulo).input('Activo', sql.Bit, datos.activo)
            .query(`UPDATE dbo.ST_TiposFalla SET Categoria = @Cat, Titulo = @Titulo, Activo = @Activo WHERE TipoId = @ID`);
        if (!r.rowsAffected[0]) return res.status(404).json({ error: 'No existe esa sugerencia.' });
        logger.info(`[Tipos de falla · ST] Sugerencia #${id} → «${datos.titulo}» (${datos.categoria}, activo=${datos.activo}) por usuario ${req.user?.id}.`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Error editar sugerencia de Servicio Técnico:', err);
        res.status(500).json({ error: err.message });
    }
};

// DELETE /api/failures/st-tipos/:id → no toca ninguna solicitud (guardan su texto)
exports.borrarSugerenciaST = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Sugerencia inválida.' });
    try {
        const pool = await getPool();
        const r = await pool.request().input('ID', sql.Int, id).query('DELETE FROM dbo.ST_TiposFalla WHERE TipoId = @ID');
        if (!r.rowsAffected[0]) return res.status(404).json({ error: 'No existe esa sugerencia.' });
        logger.info(`[Tipos de falla · ST] Sugerencia #${id} borrada por usuario ${req.user?.id}.`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Error borrar sugerencia de Servicio Técnico:', err);
        res.status(500).json({ error: err.message });
    }
};
