const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const TIPOS_VALIDOS = ['MATERIAL', 'PRODUCTO_TERMINADO', 'TERMINACION'];

// Listar StockArt (todas las variantes) con conteo de artículos por CodStock
exports.getStockArt = async (req, res) => {
    try {
        const { grupo } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let where = '';
        if (grupo) {
            request.input('Grupo', sql.VarChar, grupo);
            where = "WHERE LTRIM(RTRIM(S.Grupo)) = LTRIM(RTRIM(@Grupo))";
        }
        const r = await request.query(`
            SELECT
                LTRIM(RTRIM(S.SupFlia))  AS SupFlia,
                LTRIM(RTRIM(S.Grupo))    AS Grupo,
                LTRIM(RTRIM(S.CodStock)) AS CodStock,
                LTRIM(RTRIM(S.Ref))      AS Ref,
                LTRIM(RTRIM(S.Articulo)) AS Articulo,
                LTRIM(RTRIM(S.UM))       AS UM,
                S.Mostrar,
                ISNULL(S.TipoStock, 'MATERIAL') AS TipoStock,
                (SELECT COUNT(*) FROM articulos A WHERE LTRIM(RTRIM(A.CodStock)) = LTRIM(RTRIM(S.CodStock))) AS CantArticulos
            FROM StockArt S
            ${where}
            ORDER BY S.Grupo, S.CodStock
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[StockArt] Error listando:', e);
        res.status(500).json({ error: e.message });
    }
};

// Crear variante nueva
exports.createStockArt = async (req, res) => {
    const { grupo, codStock, articulo, um, tipoStock, mostrar } = req.body;
    if (!grupo || !codStock || !articulo) {
        return res.status(400).json({ error: 'Grupo, CodStock y Articulo son obligatorios.' });
    }
    if (tipoStock && !TIPOS_VALIDOS.includes(tipoStock)) {
        return res.status(400).json({ error: `TipoStock inválido. Valores: ${TIPOS_VALIDOS.join(', ')}` });
    }
    try {
        const pool = await getPool();

        const dup = await pool.request()
            .input('Cod', sql.VarChar, codStock.trim())
            .query("SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = @Cod");
        if (dup.recordset.length > 0) {
            return res.status(409).json({ error: `Ya existe una variante con CodStock ${codStock}.` });
        }

        // Ref incremental dentro del grupo; SupFlia = primer tramo del grupo ('1.3' -> '1')
        const refRes = await pool.request()
            .input('Grupo', sql.VarChar, grupo.trim())
            .query("SELECT ISNULL(MAX(TRY_CAST(LTRIM(RTRIM(Ref)) AS INT)), 0) + 1 AS NextRef FROM StockArt WHERE LTRIM(RTRIM(Grupo)) = @Grupo");
        const nextRef = String(refRes.recordset[0].NextRef);
        const supFlia = grupo.trim().split('.')[0];

        await pool.request()
            .input('SupFlia', sql.VarChar, supFlia)
            .input('Grupo', sql.VarChar, grupo.trim())
            .input('Cod', sql.VarChar, codStock.trim())
            .input('Ref', sql.VarChar, nextRef)
            .input('Art', sql.VarChar, articulo.trim())
            .input('UM', sql.VarChar, (um || 'U').trim())
            .input('Tipo', sql.VarChar, tipoStock || 'MATERIAL')
            .input('Mos', sql.Bit, mostrar === false ? 0 : 1)
            .query(`
                INSERT INTO StockArt (SupFlia, Grupo, CodStock, Ref, Articulo, Marcado, UM, Mostrar, TipoStock)
                VALUES (@SupFlia, @Grupo, @Cod, @Ref, @Art, 0, @UM, @Mos, @Tipo)
            `);

        logger.info(`[StockArt] Variante creada: ${codStock} '${articulo}' (${tipoStock || 'MATERIAL'}) por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error creando:', e);
        res.status(500).json({ error: e.message });
    }
};

// Editar variante (nombre, UM, tipo, visibilidad)
exports.updateStockArt = async (req, res) => {
    const { codStock } = req.params;
    const { articulo, um, tipoStock, mostrar } = req.body;
    if (tipoStock && !TIPOS_VALIDOS.includes(tipoStock)) {
        return res.status(400).json({ error: `TipoStock inválido. Valores: ${TIPOS_VALIDOS.join(', ')}` });
    }
    try {
        const pool = await getPool();
        const sets = [];
        const request = pool.request().input('Cod', sql.VarChar, codStock.trim());
        if (articulo !== undefined) { sets.push('Articulo = @Art'); request.input('Art', sql.VarChar, String(articulo).trim()); }
        if (um !== undefined)       { sets.push('UM = @UM');       request.input('UM', sql.VarChar, String(um).trim()); }
        if (tipoStock !== undefined){ sets.push('TipoStock = @Tipo'); request.input('Tipo', sql.VarChar, tipoStock); }
        if (mostrar !== undefined)  { sets.push('Mostrar = @Mos'); request.input('Mos', sql.Bit, mostrar ? 1 : 0); }
        if (sets.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });

        const r = await request.query(`UPDATE StockArt SET ${sets.join(', ')} WHERE LTRIM(RTRIM(CodStock)) = @Cod`);
        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe CodStock ${codStock}.` });

        logger.info(`[StockArt] Variante ${codStock} actualizada por ${req.user?.username || 'N/A'}: ${JSON.stringify(req.body)}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error actualizando:', e);
        res.status(500).json({ error: e.message });
    }
};

// Eliminar variante (solo si NO tiene artículos: se mueven primero desde el editor)
exports.deleteStockArt = async (req, res) => {
    const { codStock } = req.params;
    try {
        const pool = await getPool();
        const cnt = await pool.request()
            .input('Cod', sql.VarChar, codStock.trim())
            .query("SELECT COUNT(*) AS Cant FROM articulos WHERE LTRIM(RTRIM(CodStock)) = @Cod");
        const cantArt = cnt.recordset[0]?.Cant || 0;
        if (cantArt > 0) {
            return res.status(409).json({ error: `La variante tiene ${cantArt} artículo(s): movelos a otra variante antes de eliminarla.` });
        }

        const r = await pool.request()
            .input('Cod', sql.VarChar, codStock.trim())
            .query("DELETE FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = @Cod");
        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe la variante ${codStock}.` });

        logger.info(`[StockArt] Variante ${codStock} ELIMINADA por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error eliminando variante:', e);
        res.status(500).json({ error: e.message });
    }
};

// Artículos de una variante
exports.getArticulos = async (req, res) => {
    const { codStock } = req.params;
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Cod', sql.VarChar, codStock.trim())
            .query(`
                SELECT LTRIM(RTRIM(CodArticulo)) AS CodArticulo,
                       LTRIM(RTRIM(Descripcion)) AS Descripcion,
                       ISNULL(mostrar, 1) AS Mostrar
                FROM articulos
                WHERE LTRIM(RTRIM(CodStock)) = @Cod
                ORDER BY Descripcion
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[StockArt] Error listando artículos:', e);
        res.status(500).json({ error: e.message });
    }
};

// Catálogo de terminaciones (activas por defecto; ?all=1 incluye inactivas para administración)
exports.getTerminacionesCatalogo = async (req, res) => {
    try {
        const pool = await getPool();
        const where = req.query.all === '1' ? '' : 'WHERE T.Activo = 1';
        // OUTER APPLY con TOP 1: CodArticulo puede estar duplicado en articulos
        // (mismo código en grupos distintos); priorizamos el de variante TERMINACION.
        const r = await pool.request().query(`
            SELECT T.TerminacionID, T.Nombre, T.CodArticulo, T.UnidadCobro, T.Activo,
                   T.Ubicaciones, T.ReglaCantidad, T.ParamCantidad, T.ClienteElige,
                   A.Descripcion AS ArticuloDescripcion,
                   P.Precio, P.Moneda
            FROM Terminaciones T
            OUTER APPLY (
                SELECT TOP 1 LTRIM(RTRIM(Ar.Descripcion)) AS Descripcion
                FROM articulos Ar
                WHERE LTRIM(RTRIM(Ar.CodArticulo)) = LTRIM(RTRIM(T.CodArticulo))
                ORDER BY CASE WHEN LTRIM(RTRIM(Ar.CodStock)) IN (
                    SELECT LTRIM(RTRIM(S.CodStock)) FROM StockArt S WHERE ISNULL(S.TipoStock, 'MATERIAL') = 'TERMINACION'
                ) THEN 0 ELSE 1 END
            ) A
            OUTER APPLY (
                SELECT TOP 1 PB.Precio, LTRIM(RTRIM(PB.Moneda)) AS Moneda
                FROM PreciosBase PB
                WHERE LTRIM(RTRIM(PB.CodArticulo)) = LTRIM(RTRIM(T.CodArticulo))
                ORDER BY PB.UltimaActualizacion DESC
            ) P
            ${where}
            ORDER BY T.Nombre
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[StockArt] Error listando terminaciones:', e);
        res.status(500).json({ error: e.message });
    }
};

const UNIDADES_COBRO = ['U', 'M', 'M2'];
const REGLAS_CANTIDAD = ['FIJA', 'CADA_X_CM', 'METROS_TRAMO'];

// Upsert del precio de una terminación en PreciosBase (por CodArticulo del
// artículo vinculado). El precio del sector escribe DIRECTO acá — decisión
// del usuario 21/07 — en vez de pasar por la planilla/SYNC.
async function upsertPrecioBase(pool, codArticulo, precio, moneda) {
    const cod = String(codArticulo).trim();
    const mon = (String(moneda || 'UYU').toUpperCase() === 'USD') ? { m: 'USD', id: 2 } : { m: 'UYU', id: 1 };

    const upd = await pool.request()
        .input('Cod', sql.NVarChar, cod)
        .input('P', sql.Decimal(18, 2), precio)
        .input('M', sql.NVarChar, mon.m)
        .input('MI', sql.Int, mon.id)
        .query(`UPDATE PreciosBase SET Precio = @P, Moneda = @M, MonIdMoneda = @MI, UltimaActualizacion = GETDATE()
                WHERE LTRIM(RTRIM(CodArticulo)) = @Cod`);

    if (upd.rowsAffected[0] === 0) {
        const art = await pool.request()
            .input('Cod', sql.VarChar, cod)
            .query(`SELECT TOP 1 ProIdProducto FROM articulos WHERE LTRIM(RTRIM(CodArticulo)) = @Cod
                    ORDER BY CASE WHEN LTRIM(RTRIM(CodStock)) LIKE '1.1.3.%' THEN 0 ELSE 1 END`);
        await pool.request()
            .input('Cod', sql.NVarChar, cod)
            .input('P', sql.Decimal(18, 2), precio)
            .input('M', sql.NVarChar, mon.m)
            .input('MI', sql.Int, mon.id)
            .input('Pro', sql.Int, art.recordset[0]?.ProIdProducto || null)
            .query(`INSERT INTO PreciosBase (CodArticulo, Precio, Moneda, MonIdMoneda, UltimaActualizacion, ProIdProducto)
                    VALUES (@Cod, @P, @M, @MI, GETDATE(), @Pro)`);
    }
}

// Crear terminación nueva (con manera de aplicación y precio directo opcionales)
exports.createTerminacion = async (req, res) => {
    const { nombre, codArticulo, unidadCobro, ubicaciones, reglaCantidad, paramCantidad, clienteElige, precio, moneda } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    if (unidadCobro && !UNIDADES_COBRO.includes(unidadCobro)) {
        return res.status(400).json({ error: `UnidadCobro inválida. Valores: ${UNIDADES_COBRO.join(', ')}` });
    }
    if (reglaCantidad && !REGLAS_CANTIDAD.includes(reglaCantidad)) {
        return res.status(400).json({ error: `ReglaCantidad inválida. Valores: ${REGLAS_CANTIDAD.join(', ')}` });
    }
    try {
        const pool = await getPool();
        const dup = await pool.request()
            .input('Nom', sql.NVarChar, nombre.trim())
            .query("SELECT 1 FROM Terminaciones WHERE LTRIM(RTRIM(Nombre)) = @Nom");
        if (dup.recordset.length > 0) return res.status(409).json({ error: `Ya existe una terminación '${nombre.trim()}'.` });

        await pool.request()
            .input('Nom', sql.NVarChar, nombre.trim())
            .input('Art', sql.VarChar, codArticulo ? codArticulo.trim() : null)
            .input('UC', sql.VarChar, unidadCobro || 'U')
            .input('Ubi', sql.VarChar, ubicaciones || null)
            .input('Reg', sql.VarChar, reglaCantidad || 'FIJA')
            .input('Par', sql.Decimal(9, 2), paramCantidad != null && paramCantidad !== '' ? paramCantidad : (reglaCantidad === 'METROS_TRAMO' ? null : 1))
            .input('Eli', sql.Bit, clienteElige === false ? 0 : 1)
            .query(`INSERT INTO Terminaciones (Nombre, CodArticulo, UnidadCobro, Ubicaciones, ReglaCantidad, ParamCantidad, ClienteElige)
                    VALUES (@Nom, @Art, @UC, @Ubi, @Reg, @Par, @Eli)`);

        if (precio !== undefined && precio !== null && precio !== '' && codArticulo) {
            await upsertPrecioBase(pool, codArticulo, parseFloat(precio) || 0, moneda);
        }

        logger.info(`[StockArt] Terminación creada: '${nombre.trim()}' (${unidadCobro || 'U'}) por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error creando terminación:', e);
        res.status(500).json({ error: e.message });
    }
};

// Editar terminación (nombre, artículo, unidad, activo, manera de aplicación, precio)
exports.updateTerminacion = async (req, res) => {
    const { id } = req.params;
    const { nombre, codArticulo, unidadCobro, activo, ubicaciones, reglaCantidad, paramCantidad, clienteElige, precio, moneda } = req.body;
    if (unidadCobro !== undefined && !UNIDADES_COBRO.includes(unidadCobro)) {
        return res.status(400).json({ error: `UnidadCobro inválida. Valores: ${UNIDADES_COBRO.join(', ')}` });
    }
    if (reglaCantidad !== undefined && !REGLAS_CANTIDAD.includes(reglaCantidad)) {
        return res.status(400).json({ error: `ReglaCantidad inválida. Valores: ${REGLAS_CANTIDAD.join(', ')}` });
    }
    try {
        const pool = await getPool();
        const sets = [];
        const request = pool.request().input('ID', sql.Int, parseInt(id));
        if (nombre !== undefined)        { sets.push('Nombre = @Nom');        request.input('Nom', sql.NVarChar, String(nombre).trim()); }
        if (codArticulo !== undefined)   { sets.push('CodArticulo = @Art');   request.input('Art', sql.VarChar, codArticulo ? String(codArticulo).trim() : null); }
        if (unidadCobro !== undefined)   { sets.push('UnidadCobro = @UC');    request.input('UC', sql.VarChar, unidadCobro); }
        if (activo !== undefined)        { sets.push('Activo = @Act');        request.input('Act', sql.Bit, activo ? 1 : 0); }
        if (ubicaciones !== undefined)   { sets.push('Ubicaciones = @Ubi');   request.input('Ubi', sql.VarChar, ubicaciones || null); }
        if (reglaCantidad !== undefined) { sets.push('ReglaCantidad = @Reg'); request.input('Reg', sql.VarChar, reglaCantidad); }
        if (paramCantidad !== undefined) { sets.push('ParamCantidad = @Par'); request.input('Par', sql.Decimal(9, 2), paramCantidad != null && paramCantidad !== '' ? paramCantidad : null); }
        if (clienteElige !== undefined)  { sets.push('ClienteElige = @Eli');  request.input('Eli', sql.Bit, clienteElige ? 1 : 0); }
        if (sets.length === 0 && precio === undefined) return res.status(400).json({ error: 'Nada para actualizar.' });

        if (sets.length > 0) {
            const r = await request.query(`UPDATE Terminaciones SET ${sets.join(', ')} WHERE TerminacionID = @ID`);
            if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe la terminación ${id}.` });
        }

        // Precio directo → PreciosBase del artículo vinculado (decisión usuario 21/07)
        if (precio !== undefined && precio !== null && precio !== '') {
            const rowArt = await pool.request()
                .input('ID', sql.Int, parseInt(id))
                .query("SELECT LTRIM(RTRIM(ISNULL(CodArticulo, ''))) AS CodArticulo FROM Terminaciones WHERE TerminacionID = @ID");
            const codArt = rowArt.recordset[0]?.CodArticulo;
            if (!codArt) return res.status(400).json({ error: 'La terminación no tiene artículo vinculado: asignale uno para poder ponerle precio.' });
            await upsertPrecioBase(pool, codArt, parseFloat(precio) || 0, moneda);
        }

        logger.info(`[StockArt] Terminación ${id} actualizada por ${req.user?.username || 'N/A'}: ${JSON.stringify(req.body)}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error actualizando terminación:', e);
        res.status(500).json({ error: e.message });
    }
};

// Precio base directo de un artículo (alta de producto terminado desde el sector)
exports.setPrecioBaseArticulo = async (req, res) => {
    const { codArticulo } = req.params;
    const { precio, moneda } = req.body;
    if (precio == null || precio === '' || isNaN(parseFloat(precio))) {
        return res.status(400).json({ error: 'Precio inválido.' });
    }
    try {
        const pool = await getPool();
        await upsertPrecioBase(pool, codArticulo, parseFloat(precio), moneda);
        logger.info(`[StockArt] PrecioBase de ${codArticulo} = ${precio} ${moneda || 'UYU'} por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error guardando precio base:', e);
        res.status(500).json({ error: e.message });
    }
};

// Materiales que OFRECEN una terminación (lado inverso de MaterialTerminaciones)
exports.getMaterialesDeTerminacion = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('TID', sql.Int, parseInt(id))
            .query("SELECT LTRIM(RTRIM(CodArticulo)) AS CodArticulo FROM MaterialTerminaciones WHERE TerminacionID = @TID");
        res.json({ success: true, data: r.recordset.map(x => x.CodArticulo) });
    } catch (e) {
        logger.error('[StockArt] Error materiales de terminación:', e);
        res.status(500).json({ error: e.message });
    }
};

// Reemplazar el set de materiales que ofrecen una terminación
exports.setMaterialesDeTerminacion = async (req, res) => {
    const { id } = req.params;
    const { codArticulos } = req.body;
    if (!Array.isArray(codArticulos)) return res.status(400).json({ error: 'codArticulos debe ser un array.' });
    const cods = [...new Set(codArticulos.map(c => String(c).trim()).filter(Boolean))];
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            await new sql.Request(transaction)
                .input('TID', sql.Int, parseInt(id))
                .query("DELETE FROM MaterialTerminaciones WHERE TerminacionID = @TID");
            for (const cod of cods) {
                await new sql.Request(transaction)
                    .input('TID', sql.Int, parseInt(id))
                    .input('Art', sql.VarChar, cod)
                    .query("INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID) VALUES (@Art, @TID)");
            }
            await transaction.commit();
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }
        logger.info(`[StockArt] Materiales de terminación ${id} actualizados (${cods.length}) por ${req.user?.username || 'N/A'}`);
        res.json({ success: true, count: cods.length });
    } catch (e) {
        logger.error('[StockArt] Error guardando materiales de terminación:', e);
        res.status(500).json({ error: e.message });
    }
};

// Materiales de impresión (artículos de variantes tipo MATERIAL, opcionalmente por grupo)
exports.getMaterialesImpresion = async (req, res) => {
    try {
        const { grupo } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let grupoFilter = '';
        if (grupo) {
            request.input('Grupo', sql.VarChar, grupo);
            grupoFilter = "AND LTRIM(RTRIM(S.Grupo)) = LTRIM(RTRIM(@Grupo))";
        }
        const r = await request.query(`
            SELECT LTRIM(RTRIM(A.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(A.Descripcion)) AS Descripcion,
                   LTRIM(RTRIM(A.CodStock)) AS CodStock
            FROM articulos A
            WHERE LTRIM(RTRIM(A.CodStock)) IN (
                SELECT LTRIM(RTRIM(S.CodStock)) FROM StockArt S
                WHERE ISNULL(S.TipoStock, 'MATERIAL') = 'MATERIAL' ${grupoFilter}
            )
            AND ISNULL(A.mostrar, 1) = 1
            ORDER BY A.Descripcion
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[StockArt] Error materiales de impresión:', e);
        res.status(500).json({ error: e.message });
    }
};

// Artículos disponibles para vincular a una terminación (variantes de tipo TERMINACION)
exports.getArticulosParaTerminaciones = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT LTRIM(RTRIM(A.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(A.Descripcion)) AS Descripcion
            FROM articulos A
            WHERE LTRIM(RTRIM(A.CodStock)) IN (
                SELECT LTRIM(RTRIM(S.CodStock)) FROM StockArt S WHERE ISNULL(S.TipoStock, 'MATERIAL') = 'TERMINACION'
            )
            AND ISNULL(A.mostrar, 1) = 1
            ORDER BY A.Descripcion
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[StockArt] Error artículos para terminaciones:', e);
        res.status(500).json({ error: e.message });
    }
};

// Terminaciones asignadas a un artículo (material de impresión)
exports.getTerminacionesArticulo = async (req, res) => {
    const { codArticulo } = req.params;
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Art', sql.VarChar, codArticulo.trim())
            .query("SELECT TerminacionID FROM MaterialTerminaciones WHERE LTRIM(RTRIM(CodArticulo)) = @Art");
        res.json({ success: true, data: r.recordset.map(x => x.TerminacionID) });
    } catch (e) {
        logger.error('[StockArt] Error terminaciones de artículo:', e);
        res.status(500).json({ error: e.message });
    }
};

// Reemplazar el set de terminaciones posibles de un artículo
exports.setTerminacionesArticulo = async (req, res) => {
    const { codArticulo } = req.params;
    const { terminacionIds } = req.body;
    if (!Array.isArray(terminacionIds)) {
        return res.status(400).json({ error: 'terminacionIds debe ser un array de IDs.' });
    }
    const ids = [...new Set(terminacionIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            await new sql.Request(transaction)
                .input('Art', sql.VarChar, codArticulo.trim())
                .query("DELETE FROM MaterialTerminaciones WHERE LTRIM(RTRIM(CodArticulo)) = @Art");

            for (const id of ids) {
                await new sql.Request(transaction)
                    .input('Art', sql.VarChar, codArticulo.trim())
                    .input('TID', sql.Int, id)
                    .query("INSERT INTO MaterialTerminaciones (CodArticulo, TerminacionID) VALUES (@Art, @TID)");
            }
            await transaction.commit();
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }
        logger.info(`[StockArt] Terminaciones de ${codArticulo} actualizadas (${ids.length}) por ${req.user?.username || 'N/A'}`);
        res.json({ success: true, count: ids.length });
    } catch (e) {
        logger.error('[StockArt] Error guardando terminaciones de artículo:', e);
        res.status(500).json({ error: e.message });
    }
};

// Listado de PRODUCTOS TERMINADOS (artículos bajo variantes tipo PT del grupo 1.3)
exports.getProductosTerminados = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT LTRIM(RTRIM(A.CodArticulo)) AS CodArticulo,
                   LTRIM(RTRIM(A.Descripcion)) AS Descripcion,
                   LTRIM(RTRIM(A.CodStock))    AS CodStock,
                   ISNULL(A.mostrar, 1)         AS Mostrar,
                   A.MonIdMoneda, A.ProIdProducto,
                   LTRIM(RTRIM(S.Articulo))     AS Variante,
                   P.Precio, P.Moneda
            FROM articulos A
            INNER JOIN StockArt S ON LTRIM(RTRIM(S.CodStock)) = LTRIM(RTRIM(A.CodStock))
                AND ISNULL(S.TipoStock, 'MATERIAL') = 'PRODUCTO_TERMINADO'
                AND LTRIM(RTRIM(S.Grupo)) = '1.3'
            OUTER APPLY (
                SELECT TOP 1 PB.Precio, LTRIM(RTRIM(PB.Moneda)) AS Moneda
                FROM PreciosBase PB
                WHERE LTRIM(RTRIM(PB.CodArticulo)) = LTRIM(RTRIM(A.CodArticulo))
                ORDER BY PB.UltimaActualizacion DESC
            ) P
            ORDER BY S.Articulo, A.Descripcion
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[StockArt] Error listando productos terminados:', e);
        res.status(500).json({ error: e.message });
    }
};

// Crear PRODUCTO TERMINADO completo: artículo (CodArticulo = IDProdReact =
// ProIdProducto, asignado automático) + ficha + precio, en una transacción.
exports.crearProductoTerminado = async (req, res) => {
    const { descripcion, codStock, mostrar, anchoM, altoM, bordeCm, materialCodArticulo, tinta, terminaciones, precio, moneda } = req.body;
    if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    if (!codStock) return res.status(400).json({ error: 'Elegí la variante (CodStock).' });
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        let proId;
        try {
            // 1. Artículo con código provisorio; ProIdProducto es IDENTITY
            const ins = await new sql.Request(transaction)
                .input('Desc',  sql.VarChar(255), descripcion.trim())
                .input('Stock', sql.VarChar(50), String(codStock).trim())
                .input('Mos',   sql.Bit, mostrar === false ? 0 : 1)
                .input('MonId', sql.Int, (String(moneda || 'UYU').toUpperCase() === 'USD') ? 2 : 1)
                .query(`
                    INSERT INTO Articulos
                        (CodArticulo, IDProdReact, Descripcion, CodStock, Grupo, SupFlia, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda, borrar)
                    OUTPUT INSERTED.ProIdProducto
                    VALUES ('PT-TMP', NULL, @Desc, @Stock, '1.3', '1', @Mos, 0, 0, @MonId, 0)
                `);
            proId = ins.recordset[0].ProIdProducto;

            // 2. Código automático: CodArticulo = IDProdReact = ProIdProducto
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .query("UPDATE Articulos SET CodArticulo = CAST(ProIdProducto AS VARCHAR(50)), IDProdReact = ProIdProducto WHERE ProIdProducto = @PID");

            // 3. Ficha de producción
            const insP = await new sql.Request(transaction)
                .input('Art', sql.VarChar, String(proId))
                .input('An',  sql.Decimal(9, 3), anchoM != null && anchoM !== '' ? anchoM : null)
                .input('Al',  sql.Decimal(9, 3), altoM != null && altoM !== '' ? altoM : null)
                .input('Bor', sql.Decimal(9, 2), bordeCm != null && bordeCm !== '' ? bordeCm : null)
                .input('Mat', sql.VarChar, materialCodArticulo ? String(materialCodArticulo).trim() : null)
                .input('Tin', sql.VarChar, tinta ? String(tinta).trim() : null)
                .query("INSERT INTO ProductosTerminados (CodArticulo, AnchoM, AltoM, BordeCm, MaterialCodArticulo, Tinta) OUTPUT INSERTED.ID VALUES (@Art, @An, @Al, @Bor, @Mat, @Tin)");
            const fichaId = insP.recordset[0].ID;

            for (const t of (Array.isArray(terminaciones) ? terminaciones : [])) {
                const tid = Number(t.terminacionId);
                if (!Number.isInteger(tid) || tid <= 0) continue;
                await new sql.Request(transaction)
                    .input('PID', sql.Int, fichaId)
                    .input('TID', sql.Int, tid)
                    .input('Cnt', sql.Decimal(18, 2), Number(t.cantidad) || 1)
                    .input('Ubi', sql.VarChar(30), t.ubicacion ? String(t.ubicacion).trim() : null)
                    .query("INSERT INTO ProductoTerminadoTerminaciones (ProductoID, TerminacionID, Cantidad, Ubicacion) VALUES (@PID, @TID, @Cnt, @Ubi)");
            }
            await transaction.commit();
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

        // 4. Precio cerrado → PreciosBase (fuera de la transacción, con el código definitivo)
        if (precio !== undefined && precio !== null && precio !== '') {
            await upsertPrecioBase(pool, String(proId), parseFloat(precio) || 0, moneda);
        }

        logger.info(`[StockArt] Producto terminado creado: '${descripcion.trim()}' (cod/id ${proId}) por ${req.user?.username || 'N/A'}`);
        res.json({ success: true, codArticulo: String(proId), proIdProducto: proId });
    } catch (e) {
        logger.error('[StockArt] Error creando producto terminado:', e);
        res.status(500).json({ error: e.message });
    }
};

// Editar DATOS del artículo de un producto terminado (nombre / visible / variante)
exports.updateProductoTerminadoDatos = async (req, res) => {
    const { codArticulo } = req.params;
    const { descripcion, mostrar, codStock } = req.body;
    try {
        const pool = await getPool();
        const sets = [];
        const request = pool.request().input('Art', sql.VarChar, codArticulo.trim());
        if (descripcion !== undefined) { sets.push('Descripcion = @Desc'); request.input('Desc', sql.VarChar(255), String(descripcion).trim()); }
        if (mostrar !== undefined)     { sets.push('Mostrar = @Mos');      request.input('Mos', sql.Bit, mostrar ? 1 : 0); }
        if (codStock !== undefined)    { sets.push('CodStock = @Stk');     request.input('Stk', sql.VarChar(50), String(codStock).trim()); }
        if (sets.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });

        const r = await request.query(`
            UPDATE Articulos SET ${sets.join(', ')}
            WHERE LTRIM(RTRIM(CodArticulo)) = @Art
              AND LTRIM(RTRIM(CodStock)) IN (
                  SELECT LTRIM(RTRIM(S.CodStock)) FROM StockArt S
                  WHERE ISNULL(S.TipoStock, 'MATERIAL') = 'PRODUCTO_TERMINADO'
              )
        `);
        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe el producto terminado ${codArticulo}.` });

        logger.info(`[StockArt] Producto terminado ${codArticulo} (datos) actualizado por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error actualizando datos de producto terminado:', e);
        res.status(500).json({ error: e.message });
    }
};

// Datos de producto terminado de un artículo: dimensiones + terminaciones incluidas
exports.getProductoTerminado = async (req, res) => {
    const { codArticulo } = req.params;
    try {
        const pool = await getPool();
        const prod = await pool.request()
            .input('Art', sql.VarChar, codArticulo.trim())
            .query("SELECT ID, AnchoM, AltoM, BordeCm, Activo, LTRIM(RTRIM(MaterialCodArticulo)) AS MaterialCodArticulo, LTRIM(RTRIM(Tinta)) AS Tinta FROM ProductosTerminados WHERE LTRIM(RTRIM(CodArticulo)) = @Art");
        if (prod.recordset.length === 0) {
            return res.json({ success: true, data: null });
        }
        const p = prod.recordset[0];
        const terms = await pool.request()
            .input('PID', sql.Int, p.ID)
            .query("SELECT TerminacionID, Cantidad, LTRIM(RTRIM(ISNULL(Ubicacion, ''))) AS Ubicacion FROM ProductoTerminadoTerminaciones WHERE ProductoID = @PID");
        res.json({
            success: true,
            data: { anchoM: p.AnchoM, altoM: p.AltoM, bordeCm: p.BordeCm, activo: p.Activo, materialCodArticulo: p.MaterialCodArticulo || '', tinta: p.Tinta || '', terminaciones: terms.recordset }
        });
    } catch (e) {
        logger.error('[StockArt] Error producto terminado:', e);
        res.status(500).json({ error: e.message });
    }
};

// Guardar producto terminado: upsert dimensiones + reemplazo de terminaciones incluidas
exports.setProductoTerminado = async (req, res) => {
    const { codArticulo } = req.params;
    const { anchoM, altoM, bordeCm, materialCodArticulo, tinta, terminaciones } = req.body; // terminaciones: [{terminacionId, cantidad, ubicacion}]
    if (terminaciones && !Array.isArray(terminaciones)) {
        return res.status(400).json({ error: 'terminaciones debe ser un array de {terminacionId, cantidad}.' });
    }
    const items = (terminaciones || [])
        .map(t => ({ id: Number(t.terminacionId), cant: Number(t.cantidad) || 1, ubi: t.ubicacion ? String(t.ubicacion).trim() : null }))
        .filter(t => Number.isInteger(t.id) && t.id > 0);
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            // Upsert ProductosTerminados
            const existing = await new sql.Request(transaction)
                .input('Art', sql.VarChar, codArticulo.trim())
                .query("SELECT ID FROM ProductosTerminados WHERE LTRIM(RTRIM(CodArticulo)) = @Art");

            let productoId;
            if (existing.recordset.length > 0) {
                productoId = existing.recordset[0].ID;
                await new sql.Request(transaction)
                    .input('PID', sql.Int, productoId)
                    .input('An', sql.Decimal(9, 3), anchoM != null && anchoM !== '' ? anchoM : null)
                    .input('Al', sql.Decimal(9, 3), altoM != null && altoM !== '' ? altoM : null)
                    .input('Bor', sql.Decimal(9, 2), bordeCm != null && bordeCm !== '' ? bordeCm : null)
                    .input('Mat', sql.VarChar, materialCodArticulo ? String(materialCodArticulo).trim() : null)
                    .input('Tin', sql.VarChar, tinta ? String(tinta).trim() : null)
                    .query("UPDATE ProductosTerminados SET AnchoM = @An, AltoM = @Al, BordeCm = @Bor, MaterialCodArticulo = @Mat, Tinta = @Tin WHERE ID = @PID");
            } else {
                const ins = await new sql.Request(transaction)
                    .input('Art', sql.VarChar, codArticulo.trim())
                    .input('An', sql.Decimal(9, 3), anchoM != null && anchoM !== '' ? anchoM : null)
                    .input('Al', sql.Decimal(9, 3), altoM != null && altoM !== '' ? altoM : null)
                    .input('Bor', sql.Decimal(9, 2), bordeCm != null && bordeCm !== '' ? bordeCm : null)
                    .input('Mat', sql.VarChar, materialCodArticulo ? String(materialCodArticulo).trim() : null)
                    .input('Tin', sql.VarChar, tinta ? String(tinta).trim() : null)
                    .query("INSERT INTO ProductosTerminados (CodArticulo, AnchoM, AltoM, BordeCm, MaterialCodArticulo, Tinta) OUTPUT INSERTED.ID VALUES (@Art, @An, @Al, @Bor, @Mat, @Tin)");
                productoId = ins.recordset[0].ID;
            }

            // Reemplazar terminaciones incluidas
            await new sql.Request(transaction)
                .input('PID', sql.Int, productoId)
                .query("DELETE FROM ProductoTerminadoTerminaciones WHERE ProductoID = @PID");
            for (const t of items) {
                await new sql.Request(transaction)
                    .input('PID', sql.Int, productoId)
                    .input('TID', sql.Int, t.id)
                    .input('Cnt', sql.Decimal(18, 2), t.cant)
                    .input('Ubi', sql.VarChar(30), t.ubi)
                    .query("INSERT INTO ProductoTerminadoTerminaciones (ProductoID, TerminacionID, Cantidad, Ubicacion) VALUES (@PID, @TID, @Cnt, @Ubi)");
            }
            await transaction.commit();
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }
        logger.info(`[StockArt] Producto terminado ${codArticulo} guardado (${items.length} term. incluidas) por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error guardando producto terminado:', e);
        res.status(500).json({ error: e.message });
    }
};

// Eliminar un artículo (material/producto) del catálogo.
// Guardas: se identifica por CodArticulo + CodStock (hay códigos duplicados entre
// grupos, ej. '28') y se bloquea si tiene órdenes históricas (ahí corresponde
// ocultarlo con mostrar=0, no borrarlo).
exports.deleteArticulo = async (req, res) => {
    const { codArticulo } = req.params;
    const { codStock } = req.query;
    if (!codStock) return res.status(400).json({ error: 'codStock es obligatorio (hay códigos de artículo duplicados entre grupos).' });
    try {
        const pool = await getPool();

        const uso = await pool.request()
            .input('Art', sql.VarChar, codArticulo.trim())
            .query("SELECT COUNT(*) AS Cant FROM Ordenes WHERE LTRIM(RTRIM(ISNULL(CodArticulo, ''))) = @Art");
        const enOrdenes = uso.recordset[0]?.Cant || 0;
        if (enOrdenes > 0) {
            return res.status(409).json({ error: `El artículo está en ${enOrdenes} orden(es) históricas: ocultalo (ojito) en vez de eliminarlo.` });
        }

        const r = await pool.request()
            .input('Art', sql.VarChar, codArticulo.trim())
            .input('Stk', sql.VarChar, String(codStock).trim())
            .query("DELETE FROM articulos WHERE LTRIM(RTRIM(CodArticulo)) = @Art AND LTRIM(RTRIM(CodStock)) = @Stk");
        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe el artículo ${codArticulo} en esa variante.` });

        // Limpiar sus relaciones de terminaciones (si era material de impresión)
        await pool.request()
            .input('Art', sql.VarChar, codArticulo.trim())
            .query("DELETE FROM MaterialTerminaciones WHERE LTRIM(RTRIM(CodArticulo)) = @Art");

        logger.info(`[StockArt] Artículo ${codArticulo} (${codStock}) ELIMINADO por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error eliminando artículo:', e);
        res.status(500).json({ error: e.message });
    }
};

// Mover artículo a otra variante (cambia articulos.CodStock)
exports.moverArticulo = async (req, res) => {
    const { codArticulo } = req.params;
    const { codStockDestino } = req.body;
    if (!codStockDestino) return res.status(400).json({ error: 'codStockDestino es obligatorio.' });
    try {
        const pool = await getPool();

        const destino = await pool.request()
            .input('Cod', sql.VarChar, codStockDestino.trim())
            .query("SELECT 1 FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = @Cod");
        if (destino.recordset.length === 0) {
            return res.status(404).json({ error: `El CodStock destino ${codStockDestino} no existe en StockArt.` });
        }

        const r = await pool.request()
            .input('Art', sql.VarChar, codArticulo.trim())
            .input('Cod', sql.VarChar, codStockDestino.trim())
            .query("UPDATE articulos SET CodStock = @Cod WHERE LTRIM(RTRIM(CodArticulo)) = @Art");
        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe el artículo ${codArticulo}.` });

        logger.info(`[StockArt] Artículo ${codArticulo} movido a ${codStockDestino} por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error moviendo artículo:', e);
        res.status(500).json({ error: e.message });
    }
};
