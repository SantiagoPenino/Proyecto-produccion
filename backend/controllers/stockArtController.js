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
                   A.Descripcion AS ArticuloDescripcion
            FROM Terminaciones T
            OUTER APPLY (
                SELECT TOP 1 LTRIM(RTRIM(Ar.Descripcion)) AS Descripcion
                FROM articulos Ar
                WHERE LTRIM(RTRIM(Ar.CodArticulo)) = LTRIM(RTRIM(T.CodArticulo))
                ORDER BY CASE WHEN LTRIM(RTRIM(Ar.CodStock)) IN (
                    SELECT LTRIM(RTRIM(S.CodStock)) FROM StockArt S WHERE ISNULL(S.TipoStock, 'MATERIAL') = 'TERMINACION'
                ) THEN 0 ELSE 1 END
            ) A
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

// Crear terminación nueva
exports.createTerminacion = async (req, res) => {
    const { nombre, codArticulo, unidadCobro } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    if (unidadCobro && !UNIDADES_COBRO.includes(unidadCobro)) {
        return res.status(400).json({ error: `UnidadCobro inválida. Valores: ${UNIDADES_COBRO.join(', ')}` });
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
            .query("INSERT INTO Terminaciones (Nombre, CodArticulo, UnidadCobro) VALUES (@Nom, @Art, @UC)");

        logger.info(`[StockArt] Terminación creada: '${nombre.trim()}' (${unidadCobro || 'U'}) por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error creando terminación:', e);
        res.status(500).json({ error: e.message });
    }
};

// Editar terminación (nombre, artículo, unidad, activo)
exports.updateTerminacion = async (req, res) => {
    const { id } = req.params;
    const { nombre, codArticulo, unidadCobro, activo } = req.body;
    if (unidadCobro !== undefined && !UNIDADES_COBRO.includes(unidadCobro)) {
        return res.status(400).json({ error: `UnidadCobro inválida. Valores: ${UNIDADES_COBRO.join(', ')}` });
    }
    try {
        const pool = await getPool();
        const sets = [];
        const request = pool.request().input('ID', sql.Int, parseInt(id));
        if (nombre !== undefined)      { sets.push('Nombre = @Nom');     request.input('Nom', sql.NVarChar, String(nombre).trim()); }
        if (codArticulo !== undefined) { sets.push('CodArticulo = @Art'); request.input('Art', sql.VarChar, codArticulo ? String(codArticulo).trim() : null); }
        if (unidadCobro !== undefined) { sets.push('UnidadCobro = @UC'); request.input('UC', sql.VarChar, unidadCobro); }
        if (activo !== undefined)      { sets.push('Activo = @Act');     request.input('Act', sql.Bit, activo ? 1 : 0); }
        if (sets.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });

        const r = await request.query(`UPDATE Terminaciones SET ${sets.join(', ')} WHERE TerminacionID = @ID`);
        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe la terminación ${id}.` });

        logger.info(`[StockArt] Terminación ${id} actualizada por ${req.user?.username || 'N/A'}: ${JSON.stringify(req.body)}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[StockArt] Error actualizando terminación:', e);
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

// Datos de producto terminado de un artículo: dimensiones + terminaciones incluidas
exports.getProductoTerminado = async (req, res) => {
    const { codArticulo } = req.params;
    try {
        const pool = await getPool();
        const prod = await pool.request()
            .input('Art', sql.VarChar, codArticulo.trim())
            .query("SELECT ID, AnchoM, AltoM, Activo, LTRIM(RTRIM(MaterialCodArticulo)) AS MaterialCodArticulo, LTRIM(RTRIM(Tinta)) AS Tinta FROM ProductosTerminados WHERE LTRIM(RTRIM(CodArticulo)) = @Art");
        if (prod.recordset.length === 0) {
            return res.json({ success: true, data: null });
        }
        const p = prod.recordset[0];
        const terms = await pool.request()
            .input('PID', sql.Int, p.ID)
            .query("SELECT TerminacionID, Cantidad FROM ProductoTerminadoTerminaciones WHERE ProductoID = @PID");
        res.json({
            success: true,
            data: { anchoM: p.AnchoM, altoM: p.AltoM, activo: p.Activo, materialCodArticulo: p.MaterialCodArticulo || '', tinta: p.Tinta || '', terminaciones: terms.recordset }
        });
    } catch (e) {
        logger.error('[StockArt] Error producto terminado:', e);
        res.status(500).json({ error: e.message });
    }
};

// Guardar producto terminado: upsert dimensiones + reemplazo de terminaciones incluidas
exports.setProductoTerminado = async (req, res) => {
    const { codArticulo } = req.params;
    const { anchoM, altoM, materialCodArticulo, tinta, terminaciones } = req.body; // terminaciones: [{terminacionId, cantidad}]
    if (terminaciones && !Array.isArray(terminaciones)) {
        return res.status(400).json({ error: 'terminaciones debe ser un array de {terminacionId, cantidad}.' });
    }
    const items = (terminaciones || [])
        .map(t => ({ id: Number(t.terminacionId), cant: Number(t.cantidad) || 1 }))
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
                    .input('Mat', sql.VarChar, materialCodArticulo ? String(materialCodArticulo).trim() : null)
                    .input('Tin', sql.VarChar, tinta ? String(tinta).trim() : null)
                    .query("UPDATE ProductosTerminados SET AnchoM = @An, AltoM = @Al, MaterialCodArticulo = @Mat, Tinta = @Tin WHERE ID = @PID");
            } else {
                const ins = await new sql.Request(transaction)
                    .input('Art', sql.VarChar, codArticulo.trim())
                    .input('An', sql.Decimal(9, 3), anchoM != null && anchoM !== '' ? anchoM : null)
                    .input('Al', sql.Decimal(9, 3), altoM != null && altoM !== '' ? altoM : null)
                    .input('Mat', sql.VarChar, materialCodArticulo ? String(materialCodArticulo).trim() : null)
                    .input('Tin', sql.VarChar, tinta ? String(tinta).trim() : null)
                    .query("INSERT INTO ProductosTerminados (CodArticulo, AnchoM, AltoM, MaterialCodArticulo, Tinta) OUTPUT INSERTED.ID VALUES (@Art, @An, @Al, @Mat, @Tin)");
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
                    .query("INSERT INTO ProductoTerminadoTerminaciones (ProductoID, TerminacionID, Cantidad) VALUES (@PID, @TID, @Cnt)");
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
