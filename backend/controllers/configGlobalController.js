'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN GENERAL (tabla ConfiguracionGlobal)
// Editor de las claves globales del sistema desde Configuración → Configuración General.
// La tabla es Clave (PK lógica) + AreaID + Valor. El que consume cada clave es el
// código de su módulo; acá solo se lee y se guarda el Valor.
// ─────────────────────────────────────────────────────────────────────────────

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

/** GET /api/admin/config-global → todas las claves ordenadas alfabéticamente */
exports.getAll = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT Clave, LTRIM(RTRIM(AreaID)) AS AreaID, Valor
            FROM dbo.ConfiguracionGlobal WITH(NOLOCK)
            ORDER BY Clave ASC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('[ConfigGlobal] getAll:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * PUT /api/admin/config-global
 * Body: { clave, valor, areaID? }
 * Si la clave existe actualiza el Valor; si no existe, la crea (AreaID por defecto 'ADMIN').
 */
exports.upsert = async (req, res) => {
    const clave = String(req.body?.clave || '').trim();
    const valor = req.body?.valor == null ? '' : String(req.body.valor);
    const areaID = String(req.body?.areaID || 'ADMIN').trim();

    if (!clave) return res.status(400).json({ success: false, error: 'Falta la clave.' });
    if (clave.length > 50) return res.status(400).json({ success: false, error: 'La clave no puede tener más de 50 caracteres.' });
    if (areaID.length > 10) return res.status(400).json({ success: false, error: 'El área no puede tener más de 10 caracteres.' });

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('Clave', sql.VarChar(50), clave)
            .input('Area', sql.NChar(10), areaID)
            .input('Valor', sql.NVarChar(sql.MAX), valor)
            .query(`
                UPDATE dbo.ConfiguracionGlobal SET Valor = @Valor WHERE Clave = @Clave;
                IF @@ROWCOUNT = 0
                    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES (@Clave, @Area, @Valor);
            `);

        const creada = result.rowsAffected[0] === 0;
        logger.info(`[ConfigGlobal] ${creada ? 'CREADA' : 'ACTUALIZADA'} ${clave} = "${valor}" por ${req.user?.usuario || req.user?.nombre || 'sistema'}`);
        res.json({ success: true, creada });
    } catch (err) {
        logger.error('[ConfigGlobal] upsert:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
