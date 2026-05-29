const { getPool, sql } = require('../config/db');
const PricingService = require('../services/pricingService');
const logger = require('../utils/logger');

// Obtener Precios Base (Lista Pagina o Filtrada)
// Obtener Precios Base (Lista Pagina o Filtrada)
const getBasePrices = async (req, res) => {
    try {
        const pool = await getPool();
        // Usamos LEFT JOIN con Articulos para mostrar Descripción si existe
        // PRECIO MULTI-MONEDA: Si un artículo tiene 2 precios, aparecerá 2 veces (deseado)
        const result = await pool.request().query(`
            SELECT LTRIM(RTRIM(A.CodArticulo)) as CodArticulo, A.Descripcion, A.SupFlia, A.Grupo, 
                   LTRIM(RTRIM(SA.Articulo)) as GrupoNombre, 
                   MAP.NombreReferencia as NombreReferenciaGrupo,
                   PB.ID, PB.Precio, CASE WHEN PB.MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END AS Moneda, PB.MonIdMoneda,
                   A.ProIdProducto
            FROM Articulos A
            LEFT JOIN StockArt SA ON A.CodStock = SA.CodStock
            LEFT JOIN ConfigMapeoERP MAP ON MAP.CodigoERP = A.Grupo COLLATE Database_Default
            LEFT JOIN PreciosBase PB ON A.ProIdProducto = PB.ProIdProducto
            ORDER BY A.SupFlia, A.Grupo, A.CodArticulo, PB.MonIdMoneda
        `);
        logger.info(`getBasePrices: Found ${result.recordset.length} rows.`);
        res.json(result.recordset);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Guardar Precio Base (Individual)
const saveBasePrice = async (req, res) => {
    const { codArticulo, precio, moneda } = req.body;
    try {
        await PricingService.setBasePrice(codArticulo, precio, moneda === 'USD' ? 2 : 1);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Guardar Precios Base (Masivo)
const saveBasePricesBulk = async (req, res) => {
    const { items } = req.body; // Array de { codArticulo, precio, moneda }
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Se espera un array 'items'." });

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const item of items) {
                const request = new sql.Request(transaction);

                if (item.id) {
                    await request
                        .input('Id', sql.Int, item.id)
                        .input('Precio', sql.Decimal(18, 4), item.precio)
                        .input('MonIdMoneda', sql.Int, (item.moneda === 'USD' || item.moneda === 2) ? 2 : 1)
                        .query(`
                            UPDATE PreciosBase 
                            SET Precio = @Precio, MonIdMoneda = @MonIdMoneda, UltimaActualizacion = GETDATE()
                            WHERE ID = @Id
                        `);
                } else {
                    // PreciosBase ahora sólo utiliza ProIdProducto (INT)
                    await request
                        .input('ProId', sql.Int, item.proIdProducto || null)
                        .input('Precio', sql.Decimal(18, 4), item.precio)
                        .input('MonIdMoneda', sql.Int, (item.moneda === 'USD' || item.moneda === 2) ? 2 : 1)
                        .query(`
                            IF @ProId IS NOT NULL AND @ProId > 0
                            BEGIN
                                MERGE PreciosBase AS target
                                USING (SELECT @MonIdMoneda AS MonIdMoneda, @ProId AS ProIdProducto) AS source
                                ON (target.ProIdProducto = source.ProIdProducto AND target.MonIdMoneda = source.MonIdMoneda)
                                WHEN MATCHED THEN
                                    UPDATE SET Precio = @Precio, UltimaActualizacion = GETDATE()
                                WHEN NOT MATCHED THEN
                                    INSERT (ProIdProducto, Precio, MonIdMoneda, UltimaActualizacion)
                                    VALUES (@ProId, @Precio, @MonIdMoneda, GETDATE());
                            END
                        `);
                }
            }

            await transaction.commit();
            res.json({ success: true, count: items.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (e) {
        logger.error("Error saveBasePricesBulk:", e);
        res.status(500).json({ error: e.message });
    }
};

// Endpoint de prueba para CALCULAR precio (Simulador)
const calculatePriceEndpoint = async (req, res) => {
    const { codArticulo, cantidad, clienteId, variables, targetCurrency, extraProfileIds, areaId, datoTecnicoValue } = req.body;
    try {
        const fallbackCurrency = targetCurrency || 'AUTO';
        const result = await PricingService.calculatePrice(codArticulo, parseFloat(cantidad) || 1, clienteId, extraProfileIds || [], variables || {}, fallbackCurrency, null, areaId, datoTecnicoValue);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Obtener Precios Escalonados (Reglas de Perfiles Activos)
const getTieredPrices = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT PI.ID, PI.PerfilID, PI.ProIdProducto, PI.CodGrupo, PI.TipoRegla, PI.Valor, 
                   CASE WHEN PI.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END as Moneda, PI.MonIdMoneda,
                   PI.CantidadMinima, PP.Nombre as NombrePerfil, PP.Categoria,
                   LTRIM(RTRIM(COALESCE(PI.CodGrupo, A.CodArticulo, CASE WHEN PI.ProIdProducto = 0 THEN 'TOTAL' WHEN PI.ProIdProducto IS NULL THEN 'TOTAL' ELSE CAST(PI.ProIdProducto AS VARCHAR) END))) as CodArticulo
            FROM PerfilesItems PI
            INNER JOIN PerfilesPrecios PP ON PI.PerfilID = PP.ID
            LEFT JOIN Articulos A ON PI.ProIdProducto = A.ProIdProducto
            WHERE PP.Activo = 1
        `);
        res.json(result.recordset);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Guardar Precios Escalonados (Masivo)
const saveTieredPricesBulk = async (req, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Se espera un array 'items'." });

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const item of items) {
                const request = new sql.Request(transaction);
                const monIdMoneda = (item.moneda === 'USD' || item.moneda === 2 || item.Moneda === 'USD') ? 2 : 1;

                if (item.action === 'delete') {
                    if (item.id) {
                        await request
                            .input('Id', sql.Int, item.id)
                            .query("DELETE FROM PerfilesItems WHERE ID = @Id");
                    }
                } else if (item.id) {
                    // UPDATE
                    await request
                        .input('Id', sql.Int, item.id)
                        .input('TipoRegla', sql.NVarChar, item.tipoRegla)
                        .input('Valor', sql.Decimal(18, 4), item.valor)
                        .input('MonIdMoneda', sql.Int, monIdMoneda)
                        .input('CantidadMinima', sql.Int, item.cantidadMinima)
                        .query(`
                            UPDATE PerfilesItems
                            SET TipoRegla = @TipoRegla, Valor = @Valor, MonIdMoneda = @MonIdMoneda, CantidadMinima = @CantidadMinima
                            WHERE ID = @Id
                        `);
                } else {
                    // INSERT (o MERGE para evitar duplicados)
                    let finalProId = (item.proIdProducto !== undefined && item.proIdProducto !== null) ? item.proIdProducto : null;
                    let finalCodGrupo = item.codGrupo || null;

                    await request
                        .input('PerfilID', sql.Int, item.perfilId)
                        .input('ProId', sql.Int, finalProId)
                        .input('CodGrupo', sql.VarChar, finalCodGrupo)
                        .input('TipoRegla', sql.NVarChar, item.tipoRegla)
                        .input('Valor', sql.Decimal(18, 4), item.valor)
                        .input('MonIdMoneda', sql.Int, monIdMoneda)
                        .input('CantidadMinima', sql.Int, item.cantidadMinima)
                        .query(`
                            MERGE PerfilesItems AS target
                            USING (SELECT @PerfilID AS PerfilID, @ProId AS ProIdProducto, @CantidadMinima AS CantidadMinima) AS source
                            ON (target.PerfilID = source.PerfilID AND ISNULL(target.ProIdProducto, 0) = ISNULL(source.ProIdProducto, 0) AND target.CantidadMinima = source.CantidadMinima)
                            WHEN MATCHED THEN
                                UPDATE SET TipoRegla = @TipoRegla, Valor = @Valor, MonIdMoneda = @MonIdMoneda
                            WHEN NOT MATCHED THEN
                                INSERT (PerfilID, ProIdProducto, CodGrupo, TipoRegla, Valor, MonIdMoneda, CantidadMinima)
                                VALUES (@PerfilID, @ProId, @CodGrupo, @TipoRegla, @Valor, @MonIdMoneda, @CantidadMinima);
                        `);
                }
            }

            await transaction.commit();
            res.json({ success: true, count: items.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (e) {
        logger.error("Error saveTieredPricesBulk:", e);
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getBasePrices,
    saveBasePrice,
    saveBasePricesBulk,
    calculatePriceEndpoint,
    getTieredPrices,
    saveTieredPricesBulk
};

