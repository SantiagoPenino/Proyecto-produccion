const { getPool, sql } = require('../config/db');
const PricingService = require('../services/pricingService');

// Obtener Precios Base (Lista Pagina o Filtrada)
const getBasePrices = async (req, res) => {
    try {
        const pool = await getPool();
        // Usamos LEFT JOIN con Articulos para mostrar Descripción si existe
        // Asumimos 'Articulos' tiene 'Descripcion'
        const result = await pool.request().query(`
            SELECT A.CodArticulo, A.Descripcion, A.SupFlia, A.Grupo, 
                   LTRIM(RTRIM(SA.Articulo)) as GrupoNombre, 
                   PB.Precio, PB.Moneda
            FROM Articulos A
            LEFT JOIN StockArt SA ON A.CodStock = SA.CodStock
            LEFT JOIN PreciosBase PB ON A.CodArticulo = PB.CodArticulo
            ORDER BY A.SupFlia, A.Grupo, A.CodArticulo
        `);
        console.log(`getBasePrices: Found ${result.recordset.length} articles.`);
        res.json(result.recordset);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Guardar Precio Base (Individual)
const saveBasePrice = async (req, res) => {
    const { codArticulo, precio, moneda } = req.body;
    try {
        await PricingService.setBasePrice(codArticulo, precio, moneda);
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
                // Upsert logic in-line or via service (simplified here for speed)
                const request = new sql.Request(transaction);
                await request
                    .input('Cod', sql.NVarChar, item.codArticulo)
                    .input('Precio', sql.Decimal(18, 4), item.precio)
                    .input('Moneda', sql.VarChar, item.moneda || 'UYU')
                    .query(`
                        MERGE PreciosBase AS target
                        USING (SELECT @Cod AS CodArticulo) AS source
                        ON (target.CodArticulo = source.CodArticulo)
                        WHEN MATCHED THEN
                            UPDATE SET Precio = @Precio, Moneda = @Moneda, UltimaActualizacion = GETDATE()
                        WHEN NOT MATCHED THEN
                            INSERT (CodArticulo, Precio, Moneda, UltimaActualizacion)
                            VALUES (@Cod, @Precio, @Moneda, GETDATE());
                    `);
            }

            await transaction.commit();
            res.json({ success: true, count: items.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (e) {
        console.error("Error saveBasePricesBulk:", e);
        res.status(500).json({ error: e.message });
    }
};

// Endpoint de prueba para CALCULAR precio (Simulación)
const calculatePriceEndpoint = async (req, res) => {
    const { codArticulo, cantidad, clienteId } = req.body;
    try {
        const result = await PricingService.calculatePrice(codArticulo, cantidad, clienteId);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const debugPriceEndpoint = async (req, res) => {
    await PricingService.debugPrice(req, res);
};

module.exports = {
    getBasePrices,
    saveBasePrice,
    saveBasePricesBulk,
    calculatePriceEndpoint,
    debugPriceEndpoint
};
