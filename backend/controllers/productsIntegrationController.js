const { sql, getPool } = require('../config/db');
const axios = require('axios');
const https = require('https');
const { logAlert } = require('../services/alertsService');
const logger = require('../utils/logger');

// 1. Obtener Articulos Locales
const getLocalArticles = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TOP 5000 
                a.ProIdProducto, a.SupFlia, a.Grupo, 
                LTRIM(RTRIM(a.CodStock)) AS CodStock,
                LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo,
                LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                a.IDProdReact, a.Mostrar, a.anchoimprimible, a.largoimprimible, a.LLEVAPAPEL, a.MonIdMoneda,
                map.NombreReferencia AS DescripcionGrupo,
                LTRIM(RTRIM(sa.Articulo)) AS DescripcionStock,
                pb.Precio AS PrecioBase,
                wm.producto_maestro_id,
                wm.nombre_wms,
                ISNULL(vc.CantidadVariantes, 0) AS CantidadVariantes
            FROM Articulos a
            LEFT JOIN ConfigMapeoERP map ON LTRIM(RTRIM(map.CodigoERP)) = LTRIM(RTRIM(a.Grupo)) COLLATE Database_Default
            LEFT JOIN StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
            LEFT JOIN PreciosBase pb WITH(NOLOCK) ON pb.ProIdProducto = a.ProIdProducto
            LEFT JOIN Articulos_Wms wm ON wm.Idproid = a.ProIdProducto
            LEFT JOIN (
                SELECT Idproid, COUNT(*) AS CantidadVariantes
                FROM Articulos_WMS_Variantes
                GROUP BY Idproid
            ) vc ON vc.Idproid = a.ProIdProducto
            ORDER BY a.SupFlia, a.Grupo, a.CodStock, a.Descripcion
        `);
        res.json(result.recordset);
    } catch (e) {
        logger.error("Error getLocalArticles:", e);
        res.status(500).json({ error: e.message });
    }
};

// 2. Obtener Productos (query directa a DB local)
const getRemoteProducts = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                p.ProIdProducto, p.ProCodigoOdooProducto, p.ProNombreProducto,
                p.ProDescripcion, p.ProPrecioVenta, p.ProCategoria,
                a.CodArticulo, a.IDProdReact
            FROM Productos p
            LEFT JOIN Articulos a ON a.IDProdReact = p.ProIdProducto
            ORDER BY p.ProNombreProducto
        `);
        res.json(result.recordset);
    } catch (e) {
        logger.error("Error getRemoteProducts:", e.message);
        res.status(500).json({ error: "Error al obtener productos", details: e.message });
    }
};

// 3. Vincular (Link)
const linkProduct = async (req, res) => {
    const { codArticulo, idProdReact } = req.body;
    if (!codArticulo || !idProdReact) {
        return res.status(400).json({ error: "Falta CodArticulo o IdProdReact" });
    }
    try {
        const pool = await getPool();
        await pool.request()
            .input('Cod', sql.VarChar, codArticulo)
            .input('ReactID', sql.Int, idProdReact)
            .query("UPDATE Articulos SET IDProdReact = @ReactID WHERE CodArticulo = @Cod");
        logAlert('INFO', 'PRODUCTO', 'Producto vinculado manualmente', codArticulo, { idProdReact });
        res.json({ success: true, message: "Vinculado correctamente" });
    } catch (e) {
        logger.error("Error linkProduct:", e);
        logAlert('ERROR', 'PRODUCTO', 'Fallo al vincular producto', codArticulo, { error: e.message });
        res.status(500).json({ error: e.message });
    }
};

// 4. Desvincular (Unlink)
const unlinkProduct = async (req, res) => {
    const { codArticulo } = req.body;
    if (!codArticulo) return res.status(400).json({ error: "Falta CodArticulo" });
    try {
        const pool = await getPool();
        await pool.request()
            .input('Cod', sql.VarChar, codArticulo)
            .query("UPDATE Articulos SET IDProdReact = NULL WHERE CodArticulo = @Cod");
        logAlert('WARN', 'PRODUCTO', 'Producto desvinculado', codArticulo);
        res.json({ success: true, message: "Desvinculado correctamente" });
    } catch (e) {
        logger.error("Error unlinkProduct:", e);
        res.status(500).json({ error: e.message });
    }
};

// 5. Actualizar Producto Local
const updateLocalProduct = async (req, res) => {
    const { proIdProducto, codArticulo, idProdReact, descripcion, codStock, grupo, supFlia, mostrar, anchoImprimible, largoImprimible, llevaPapel, monIdMoneda } = req.body;
    if (!proIdProducto && !codArticulo) return res.status(400).json({ error: "Falta ProIdProducto o CodArticulo" });
    try {
        const pool = await getPool();
        const req2 = pool.request()
            .input('NewCod',   sql.VarChar(50),     codArticulo    || '')
            .input('ReactId',  sql.Int,              idProdReact != null && idProdReact !== '' ? parseInt(idProdReact) : null)
            .input('Desc',     sql.VarChar(255),     descripcion    || '')
            .input('Stock',    sql.VarChar(50),      codStock       || '')
            .input('Grp',      sql.VarChar(100),     grupo          || '')
            .input('Sup',      sql.VarChar(100),     supFlia        || '')
            .input('Mos',      sql.Bit,              mostrar ? 1 : 0)
            .input('Ancho',    sql.Decimal(10, 2),   parseFloat(anchoImprimible) || 0)
            // Largo imprimible: > 0 = medida FIJA (el portal exige ancho x largo exactos); vacío/0 = NULL (sin medida fija)
            .input('Largo',    sql.Decimal(10, 2),   parseFloat(largoImprimible) || null)
            .input('Papel',    sql.Bit,              llevaPapel ? 1 : 0)
            .input('MonId',    sql.Int,              monIdMoneda != null ? parseInt(monIdMoneda) : null);

        if (proIdProducto) {
            req2.input('ProId', sql.Int, parseInt(proIdProducto));
            await req2.query(`
                UPDATE Articulos
                SET CodArticulo     = @NewCod,
                    IDProdReact     = @ReactId,
                    Descripcion     = @Desc,
                    CodStock        = @Stock,
                    Grupo           = @Grp,
                    SupFlia         = @Sup,
                    Mostrar         = @Mos,
                    anchoimprimible = @Ancho,
                    largoimprimible = @Largo,
                    LLEVAPAPEL      = @Papel,
                    MonIdMoneda     = @MonId
                WHERE ProIdProducto = @ProId
            `);
        } else {
            req2.input('Cod', sql.VarChar(50), codArticulo);
            await req2.query(`
                UPDATE Articulos
                SET IDProdReact     = @ReactId,
                    Descripcion     = @Desc,
                    CodStock        = @Stock,
                    Grupo           = @Grp,
                    SupFlia         = @Sup,
                    Mostrar         = @Mos,
                    anchoimprimible = @Ancho,
                    largoimprimible = @Largo,
                    LLEVAPAPEL      = @Papel,
                    MonIdMoneda     = @MonId
                WHERE CodArticulo   = @Cod
            `);
        }
        logAlert('INFO', 'PRODUCTO', 'Producto local actualizado', codArticulo, { descripcion, codStock, idProdReact });
        res.json({ success: true, message: "Producto actualizado correctamente" });
    } catch (e) {
        logger.error("Error updateLocalProduct:", e);
        res.status(500).json({ error: e.message });
    }
};

// 6. Crear Producto Local (INSERT)
const createLocalProduct = async (req, res) => {
    const { codArticulo, idProdReact, descripcion, codStock, grupo, supFlia, mostrar, anchoImprimible, largoImprimible, llevaPapel, monIdMoneda } = req.body;
    if (!codArticulo) return res.status(400).json({ error: 'El CodArticulo es obligatorio' });
    try {
        const pool = await getPool();
        await pool.request()
            .input('Cod',   sql.VarChar(50),     codArticulo.trim())
            .input('React', sql.Int,              idProdReact != null && idProdReact !== '' ? parseInt(idProdReact) : null)
            .input('Desc',  sql.VarChar(255),     descripcion    || '')
            .input('Stock', sql.VarChar(50),      codStock       || '')
            .input('Grp',   sql.VarChar(100),     grupo          || '')
            .input('Sup',   sql.VarChar(100),     supFlia        || '')
            .input('Mos',   sql.Bit,              mostrar ? 1 : 0)
            .input('Ancho', sql.Decimal(10, 2),   parseFloat(anchoImprimible) || 0)
            .input('Largo', sql.Decimal(10, 2),   parseFloat(largoImprimible) || null)
            .input('Papel', sql.Bit,              llevaPapel ? 1 : 0)
            .input('MonId', sql.Int,              monIdMoneda != null && monIdMoneda !== '' ? parseInt(monIdMoneda) : null)
            .query(`
                INSERT INTO Articulos
                    (CodArticulo, IDProdReact, Descripcion, CodStock, Grupo, SupFlia, Mostrar, anchoimprimible, largoimprimible, LLEVAPAPEL, MonIdMoneda, borrar)
                VALUES
                    (@Cod, @React, @Desc, @Stock, @Grp, @Sup, @Mos, @Ancho, @Largo, @Papel, @MonId, 0)
            `);
        logAlert('INFO', 'PRODUCTO', 'Nuevo artículo creado', codArticulo, { descripcion, codStock, idProdReact });
        res.status(201).json({ success: true, message: 'Artículo creado correctamente' });
    } catch (e) {
        logger.error('Error createLocalProduct:', e);
        res.status(500).json({ error: e.message });
    }
};

// 6b. Eliminar Producto Local (DELETE físico, con guard de uso)
const deleteLocalProduct = async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Falta ProIdProducto' });
    const proId = parseInt(id);
    if (Number.isNaN(proId)) return res.status(400).json({ error: 'ProIdProducto inválido' });

    try {
        const pool = await getPool();

        // Datos del artículo (para el log y validar existencia)
        const artRes = await pool.request()
            .input('ProId', sql.Int, proId)
            .query(`SELECT LTRIM(RTRIM(CodArticulo)) AS CodArticulo, LTRIM(RTRIM(Descripcion)) AS Descripcion
                    FROM Articulos WHERE ProIdProducto = @ProId`);
        if (artRes.recordset.length === 0) {
            return res.status(404).json({ error: 'El artículo no existe' });
        }
        const { CodArticulo, Descripcion } = artRes.recordset[0];

        // GUARD: no permitir borrar un producto que ya se usó en operaciones reales.
        // (No hay FKs declaradas: un DELETE ciego orfanaría historial.)
        const usoRes = await pool.request()
            .input('ProId', sql.Int, proId)
            .query(`
                SELECT
                    (SELECT COUNT(*) FROM Ordenes               WHERE ProIdProducto = @ProId) AS ordenes,
                    (SELECT COUNT(*) FROM OrdenesDeposito       WHERE ProIdProducto = @ProId) AS deposito,
                    (SELECT COUNT(*) FROM PedidosCobranzaDetalle WHERE ProIdProducto = @ProId) AS pedidos,
                    (SELECT COUNT(*) FROM CuentasCliente        WHERE ProIdProducto = @ProId) AS cuentas,
                    (SELECT COUNT(*) FROM PlanesMetros          WHERE ProIdProducto = @ProId) AS planes
            `);
        const u = usoRes.recordset[0];
        const bloqueos = [];
        if (u.ordenes  > 0) bloqueos.push(`${u.ordenes} orden(es) de producción`);
        if (u.deposito > 0) bloqueos.push(`${u.deposito} registro(s) de depósito`);
        if (u.pedidos  > 0) bloqueos.push(`${u.pedidos} línea(s) de pedido/facturación`);
        if (u.cuentas  > 0) bloqueos.push(`${u.cuentas} movimiento(s) en cuentas de cliente`);
        if (u.planes   > 0) bloqueos.push(`${u.planes} plan(es) de metros`);

        if (bloqueos.length > 0) {
            return res.status(409).json({
                error: `No se puede eliminar: el producto tiene ${bloqueos.join(', ')}. ` +
                       `Para retirarlo del catálogo, desactivá "Mostrar Activo" en Editar.`,
                enUso: true
            });
        }

        // Producto sin uso real → borrado físico + limpieza de config asociada, en transacción.
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const auxTables = [
                { t: 'Articulos_Imagenes',              c: 'Idproid' },
                { t: 'Articulos_Wms',                   c: 'Idproid' },
                { t: 'Articulos_WMS_Variantes',         c: 'Idproid' },
                { t: 'Articulos_UbicacionLocal',        c: 'Idproid' },
                { t: 'PreciosBase',                     c: 'ProIdProducto' },
                { t: 'PreciosEspecialesItems',          c: 'ProIdProducto' },
                { t: 'PerfilesItems',                   c: 'ProIdProducto' },
                { t: 'PreciosListaPublica',             c: 'ProIdProducto' },
                { t: 'HistoricoPreciosProductos',       c: 'ProIdProducto' },
                { t: 'PlanesMetrosArticulosPermitidos', c: 'ProIdProducto' },
                { t: 'UrgenciaExcepciones',             c: 'ProIdProducto' },
            ];
            for (const { t, c } of auxTables) {
                await transaction.request()
                    .input('ProId', sql.Int, proId)
                    .query(`DELETE FROM [${t}] WHERE ${c} = @ProId`);
            }
            await transaction.request()
                .input('ProId', sql.Int, proId)
                .query(`DELETE FROM Articulos WHERE ProIdProducto = @ProId`);

            await transaction.commit();
        } catch (dbErr) {
            await transaction.rollback();
            throw dbErr;
        }

        logAlert('WARN', 'PRODUCTO', 'Artículo eliminado', CodArticulo, { proId, descripcion: Descripcion });
        res.json({ success: true, message: 'Artículo eliminado correctamente' });
    } catch (e) {
        logger.error('Error deleteLocalProduct:', e);
        res.status(500).json({ error: e.message });
    }
};

// 7. Update WMS Master ID
const updateWmsMasterId = async (req, res) => {
    const { id } = req.params;
    const { producto_maestro_id } = req.body;
    if (!id) return res.status(400).json({ error: 'Falta ProIdProducto' });
    try {
        const pool = await getPool();
        const updateRes = await pool.request()
            .input('Idproid', sql.Int, parseInt(id))
            .input('producto_maestro_id', sql.Int, producto_maestro_id != null && producto_maestro_id !== '' ? parseInt(producto_maestro_id) : null)
            .query(`UPDATE Articulos_Wms SET producto_maestro_id = @producto_maestro_id WHERE Idproid = @Idproid`);

        let nombre_wms = 'Sin Nombre';
        const articleRes = await pool.request()
            .input('Idproid', sql.Int, parseInt(id))
            .query(`SELECT Descripcion FROM Articulos WHERE ProIdProducto = @Idproid`);
        if (articleRes.recordset.length > 0) nombre_wms = articleRes.recordset[0].Descripcion;

        if (updateRes.rowsAffected[0] === 0) {
            await pool.request()
                .input('Idproid', sql.Int, parseInt(id))
                .input('producto_maestro_id', sql.Int, producto_maestro_id != null && producto_maestro_id !== '' ? parseInt(producto_maestro_id) : null)
                .input('nombre_wms', sql.VarChar(255), nombre_wms)
                .query(`INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms) VALUES (@Idproid, @producto_maestro_id, @nombre_wms)`);
        }

        // Sincronizar variantes del WMS
        if (producto_maestro_id) {
            try {
                const wmsUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
                const r = await fetch(`${wmsUrl}/sql`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: `USE Ventas_Dev; SELECT id as variante_id, nombre_variante, codigo_variante FROM Stock_Variantes WHERE producto_maestro_id = ${parseInt(producto_maestro_id)};` }),
                    signal: AbortSignal.timeout(10000)
                });
                const wmsData = await r.json();
                const variants = wmsData.data || [];
                await pool.request()
                    .input('Idproid', sql.Int, parseInt(id))
                    .query(`DELETE FROM Articulos_WMS_Variantes WHERE Idproid = @Idproid`);
                for (const v of variants) {
                    await pool.request()
                        .input('Idproid', sql.Int, parseInt(id))
                        .input('WmsVarianteId', sql.Int, v.variante_id)
                        .input('Sku', sql.VarChar, v.codigo_variante || '')
                        .input('NombreVariante', sql.VarChar, v.nombre_variante || '')
                        .query(`INSERT INTO Articulos_WMS_Variantes (Idproid, wms_variante_id, sku, nombre_variante) VALUES (@Idproid, @WmsVarianteId, @Sku, @NombreVariante)`);
                }
                logger.info(`WMS Master sync: ProId ${id} → ${variants.length} variantes`);
            } catch (err) {
                logger.error('Error syncing WMS variants: ' + err.message);
            }
        }

        res.json({ success: true, message: 'ID Maestro WMS actualizado correctamente' });
    } catch (e) {
        logger.error('Error updateWmsMasterId:', e);
        res.status(500).json({ error: e.message });
    }
};

// 8. Upload Article Image
const uploadArticleImage = async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Falta ID de articulo' });
    if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
    try {
        const pool = await getPool();
        const imageUrl = `/uploads/${req.file.filename}`;
        await pool.request()
            .input('Idproid', sql.Int, parseInt(id))
            .input('UrlImagen', sql.VarChar(500), imageUrl)
            .query(`
                IF EXISTS (SELECT 1 FROM Articulos_Imagenes WHERE Idproid = @Idproid)
                BEGIN
                    UPDATE Articulos_Imagenes SET url_imagen = @UrlImagen WHERE Idproid = @Idproid
                END
                ELSE
                BEGIN
                    INSERT INTO Articulos_Imagenes (Idproid, url_imagen, es_generica, orden)
                    VALUES (@Idproid, @UrlImagen, 0, 1)
                END
            `);
        res.json({ success: true, imageUrl, message: 'Imagen guardada correctamente' });
    } catch (e) {
        logger.error("Error uploadArticleImage:", e);
        res.status(500).json({ error: e.message });
    }
};

// 9. Get WMS Master Products
const getWmsMasters = async (req, res) => {
    try {
        const wmsUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
        const r = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'USE Ventas_Dev; SELECT id, nombre FROM Stock_Productos_Maestros ORDER BY nombre;' }),
            signal: AbortSignal.timeout(10000)
        });
        const wmsData = await r.json();
        res.json({ success: true, data: wmsData.data || [] });
    } catch (e) {
        logger.error("Error fetching WMS Masters:", e);
        res.status(500).json({ error: 'Error al obtener productos maestros del WMS' });
    }
};

// 10. Get WMS Variants for a specific Master ID
const getWmsVariants = async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Falta ID de producto maestro' });
    try {
        const wmsUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
        const r = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `USE Ventas_Dev; SELECT id as variante_id, nombre_variante, codigo_variante FROM Stock_Variantes WHERE producto_maestro_id = ${parseInt(id)};` }),
            signal: AbortSignal.timeout(10000)
        });
        const wmsData = await r.json();
        res.json({ success: true, data: wmsData.data || [] });
    } catch (e) {
        logger.error("Error fetching WMS Variants:", e);
        res.status(500).json({ error: 'Error al obtener variantes del WMS' });
    }
};

// 11. Importar Master Product desde WMS a local
const importWmsMaster = async (req, res) => {
    try {
        const { id } = req.params;
        const wmsUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';

        const resMaestro = await fetch(`${wmsUrl}/sql`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `USE Ventas_Dev; SELECT id, nombre FROM Stock_Productos_Maestros WHERE id = ${id}` })
        });
        const wmsMaestro = (await resMaestro.json()).data?.[0];
        if (!wmsMaestro) return res.status(404).json({ success: false, message: 'Producto Maestro no encontrado en WMS.' });

        const resVariantes = await fetch(`${wmsUrl}/sql`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `USE Ventas_Dev; SELECT id, producto_maestro_id, nombre_variante, codigo_variante FROM Stock_Variantes WHERE producto_maestro_id = ${id}` })
        });
        const wmsVariantes = (await resVariantes.json()).data || [];

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const checkMapping = await transaction.request()
                .input('WmsMasterId', sql.Int, id)
                .query(`SELECT Idproid FROM Articulos_Wms WHERE producto_maestro_id = @WmsMasterId`);
            if (checkMapping.recordset.length > 0) {
                await transaction.rollback();
                return res.status(400).json({ success: false, message: 'El producto ya está importado.' });
            }
            const insertArt = await transaction.request()
                .input('Nombre', sql.VarChar, wmsMaestro.nombre)
                .input('CodArticulo', sql.VarChar, `WMS-${id}`)
                .query(`INSERT INTO Articulos (CodArticulo, Descripcion, SupFlia, Grupo, Mostrar, MonIdMoneda, borrar) OUTPUT INSERTED.ProIdProducto VALUES (@CodArticulo, @Nombre, '2', '2.1', 1, 2, 0)`);
            const localId = insertArt.recordset[0].ProIdProducto;
            await transaction.request()
                .input('Idproid', sql.Int, localId).input('WmsMasterId', sql.Int, id).input('NombreWms', sql.VarChar, wmsMaestro.nombre)
                .query(`INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms, fecha_sync) VALUES (@Idproid, @WmsMasterId, @NombreWms, GETDATE())`);
            for (const variant of wmsVariantes) {
                await transaction.request()
                    .input('Idproid', sql.Int, localId).input('WmsVarianteId', sql.Int, variant.id)
                    .input('Sku', sql.VarChar, variant.codigo_variante || '').input('NombreVariante', sql.VarChar, variant.nombre_variante || '')
                    .query(`INSERT INTO Articulos_WMS_Variantes (Idproid, wms_variante_id, sku, nombre_variante) VALUES (@Idproid, @WmsVarianteId, @Sku, @NombreVariante)`);
            }
            await transaction.commit();
            res.json({ success: true, message: 'Producto y variantes importados correctamente.', newId: localId });
        } catch (dbErr) {
            await transaction.rollback();
            throw dbErr;
        }
    } catch (err) {
        console.error('Error in importWmsMaster:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// 12. Obtener variantes locales de un artículo
const getArticleVariants = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, parseInt(id))
            .query(`
                SELECT v.id, v.wms_variante_id, v.sku, v.nombre_variante,
                       v.precio_excepcion, v.moneda_excepcion
                FROM Articulos_WMS_Variantes v
                WHERE v.Idproid = @id
                ORDER BY v.nombre_variante
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Error in getArticleVariants:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// 13. Actualizar precio de una variante
const updateVariantPrice = async (req, res) => {
    try {
        const { id } = req.params;
        const { precio_excepcion, moneda_excepcion } = req.body;
        const pool = await getPool();
        let monedaId = null;
        if (precio_excepcion !== null && precio_excepcion !== undefined && precio_excepcion !== '') {
            if (moneda_excepcion === 'USD' || moneda_excepcion === 2) monedaId = 2;
            else monedaId = 1;
        }
        await pool.request()
            .input('id', sql.Int, parseInt(id))
            .input('precio', sql.Decimal(18,2), precio_excepcion !== '' && precio_excepcion !== null && precio_excepcion !== undefined ? parseFloat(precio_excepcion) : null)
            .input('moneda', sql.Int, monedaId)
            .query(`
                UPDATE Articulos_WMS_Variantes
                SET precio_excepcion = @precio,
                    moneda_excepcion = @moneda
                WHERE id = @id
            `);
        res.json({ success: true, message: 'Precio actualizado correctamente' });
    } catch (err) {
        console.error('Error in updateVariantPrice:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    getLocalArticles,
    getRemoteProducts,
    linkProduct,
    unlinkProduct,
    updateLocalProduct,
    createLocalProduct,
    deleteLocalProduct,
    updateWmsMasterId,
    uploadArticleImage,
    getWmsMasters,
    getWmsVariants,
    importWmsMaster,
    getArticleVariants,
    updateVariantPrice
};