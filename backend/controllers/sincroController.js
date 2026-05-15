const { getPool } = require('../config/db');

// GET - Obtener todos los registros de SINCRO-ARTICULOS
const getSincroArticulos = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT PRODUCTO, codStock, VARIANTE, PROIDPRODUCTO, Material, codArticulo, IDREACT, AREA
            FROM [SINCRO-ARTICULOS]
            ORDER BY AREA, PRODUCTO
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('getSincroArticulos error:', err);
        res.status(500).json({ error: err.message });
    }
};

// PUT - Guardar todos los registros (reemplaza la tabla completa)
const saveSincroArticulos = async (req, res) => {
    const rows = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'Se esperaba un array de filas' });

    try {
        const pool = await getPool();
        const tx = pool.transaction();
        await tx.begin();

        try {
            await tx.request().query(`DELETE FROM [SINCRO-ARTICULOS]`);

            for (const r of rows) {
                await tx.request()
                    .input('PRODUCTO', r.PRODUCTO ?? null)
                    .input('codStock', r.codStock ?? null)
                    .input('VARIANTE', r.VARIANTE ?? null)
                    .input('PROIDPRODUCTO', r.PROIDPRODUCTO ?? null)
                    .input('Material', r.Material ?? null)
                    .input('codArticulo', r.codArticulo ?? null)
                    .input('IDREACT', r.IDREACT ?? null)
                    .input('AREA', r.AREA ?? null)
                    .query(`
                        INSERT INTO [SINCRO-ARTICULOS] (PRODUCTO,codStock,VARIANTE,PROIDPRODUCTO,Material,codArticulo,IDREACT,AREA)
                        VALUES (@PRODUCTO,@codStock,@VARIANTE,@PROIDPRODUCTO,@Material,@codArticulo,@IDREACT,@AREA)
                    `);
            }

            await tx.commit();
            res.json({ success: true, count: rows.length });
        } catch (e) {
            await tx.rollback();
            throw e;
        }
    } catch (err) {
        console.error('saveSincroArticulos error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getSincroArticulos, saveSincroArticulos };
