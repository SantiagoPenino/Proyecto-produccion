'use strict';

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const CLAVE_ACTIVO      = 'URGENCIA_DESCUENTO_ROLLO_ACTIVO';
const CLAVE_PORCENTAJE  = 'URGENCIA_DESCUENTO_ROLLO_PORCENTAJE';
const CLAVE_MODO        = 'URGENCIA_DESCUENTO_ROLLO_MODO';

/**
 * GET /api/profiles/urgencia-descuento-rollo/config
 */
exports.getConfig = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('cActivo', sql.VarChar(100), CLAVE_ACTIVO)
            .input('cPct',    sql.VarChar(100), CLAVE_PORCENTAJE)
            .input('cModo',   sql.VarChar(100), CLAVE_MODO)
            .query(`SELECT Clave, Valor FROM dbo.ConfiguracionGlobal WHERE Clave IN (@cActivo, @cPct, @cModo)`);

        const cfg = {};
        result.recordset.forEach(r => { cfg[r.Clave] = r.Valor; });

        res.json({
            success: true,
            data: {
                activo:      cfg[CLAVE_ACTIVO] === '1',
                porcentaje:  parseFloat(cfg[CLAVE_PORCENTAJE]) || 25,
                modo:        cfg[CLAVE_MODO] === 'TODOS' ? 'TODOS' : 'PILOTO',
            }
        });
    } catch (err) {
        logger.error('[UrgenciaDescuentoRollo] getConfig:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * PUT /api/profiles/urgencia-descuento-rollo/config
 * Body: { activo: boolean, porcentaje: number, modo: 'PILOTO'|'TODOS' }
 */
exports.setConfig = async (req, res) => {
    const { activo, porcentaje, modo } = req.body;

    if (porcentaje !== undefined && (isNaN(porcentaje) || porcentaje <= 0 || porcentaje > 100)) {
        return res.status(400).json({ success: false, error: 'porcentaje debe ser un número entre 0 y 100.' });
    }
    if (modo !== undefined && !['PILOTO', 'TODOS'].includes(modo)) {
        return res.status(400).json({ success: false, error: 'modo debe ser PILOTO o TODOS.' });
    }

    try {
        const pool = await getPool();

        if (activo !== undefined) {
            await pool.request()
                .input('Clave', sql.VarChar(100), CLAVE_ACTIVO)
                .input('Valor', sql.NVarChar(500), activo ? '1' : '0')
                .query(`
                    UPDATE dbo.ConfiguracionGlobal SET Valor = @Valor WHERE Clave = @Clave
                `);
        }

        if (porcentaje !== undefined) {
            await pool.request()
                .input('Clave', sql.VarChar(100), CLAVE_PORCENTAJE)
                .input('Valor', sql.NVarChar(500), String(porcentaje))
                .query(`
                    UPDATE dbo.ConfiguracionGlobal SET Valor = @Valor WHERE Clave = @Clave
                `);
        }

        if (modo !== undefined) {
            await pool.request()
                .input('Clave', sql.VarChar(100), CLAVE_MODO)
                .input('Valor', sql.NVarChar(500), modo)
                .query(`
                    UPDATE dbo.ConfiguracionGlobal SET Valor = @Valor WHERE Clave = @Clave
                `);
        }

        res.json({ success: true, message: 'Configuración actualizada.' });
    } catch (err) {
        logger.error('[UrgenciaDescuentoRollo] setConfig:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/profiles/urgencia-descuento-rollo/excepciones
 * Lista de clientes de la tabla — su significado depende del modo (ver getConfig):
 * en PILOTO son los ÚNICOS que pagan el recargo; en TODOS son los que quedan
 * EXCLUIDOS de pagarlo.
 */
exports.getExcepciones = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT
                e.ID,
                e.CliIdCliente,
                c.Nombre AS ClienteNombre,
                e.Motivo,
                e.FechaAlta
            FROM dbo.UrgenciaDescuentoRolloExcepciones e
            JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = e.CliIdCliente
            WHERE e.Activo = 1
            ORDER BY c.Nombre
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('[UrgenciaDescuentoRollo] getExcepciones:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /api/profiles/urgencia-descuento-rollo/excepciones
 * Body: { CliIdCliente, Motivo? }
 */
exports.addExcepcion = async (req, res) => {
    const { CliIdCliente, Motivo = null } = req.body;
    const UsuarioAlta = req.user?.id ?? 1;

    if (!CliIdCliente) {
        return res.status(400).json({ success: false, error: 'CliIdCliente es obligatorio.' });
    }

    try {
        const pool = await getPool();

        const cliRes = await pool.request()
            .input('cid', sql.Int, parseInt(CliIdCliente))
            .query(`SELECT TOP 1 CliIdCliente FROM dbo.Clientes WHERE CliIdCliente = @cid OR CodCliente = @cid`);
        if (cliRes.recordset.length === 0) {
            return res.status(400).json({ success: false, error: `Cliente ${CliIdCliente} no encontrado en la base de datos.` });
        }
        const realCliId = cliRes.recordset[0].CliIdCliente;

        await pool.request()
            .input('CliId', sql.Int, realCliId)
            .input('Motivo', sql.NVarChar(200), Motivo)
            .input('Usr', sql.Int, UsuarioAlta)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.UrgenciaDescuentoRolloExcepciones WHERE CliIdCliente = @CliId)
                    UPDATE dbo.UrgenciaDescuentoRolloExcepciones
                    SET Activo = 1, Motivo = @Motivo, FechaAlta = GETDATE(), UsuarioAlta = @Usr
                    WHERE CliIdCliente = @CliId
                ELSE
                    INSERT INTO dbo.UrgenciaDescuentoRolloExcepciones
                        (CliIdCliente, Activo, Motivo, FechaAlta, UsuarioAlta)
                    VALUES (@CliId, 1, @Motivo, GETDATE(), @Usr)
            `);

        const modoRes = await pool.request()
            .input('cModo', sql.VarChar(100), CLAVE_MODO)
            .query(`SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = @cModo`);
        const esPiloto = modoRes.recordset[0]?.Valor !== 'TODOS';

        res.json({
            success: true,
            message: esPiloto
                ? 'Cliente agregado al piloto — a partir de ahora paga el recargo de urgencia en metros.'
                : 'Cliente excluido del recargo — no pagará metros extra por urgencia.',
        });
    } catch (err) {
        logger.error('[UrgenciaDescuentoRollo] addExcepcion:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * DELETE /api/profiles/urgencia-descuento-rollo/excepciones/:id
 */
exports.deleteExcepcion = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, parseInt(id))
            .query(`UPDATE dbo.UrgenciaDescuentoRolloExcepciones SET Activo = 0 WHERE ID = @ID`);

        const modoRes = await pool.request()
            .input('cModo', sql.VarChar(100), CLAVE_MODO)
            .query(`SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = @cModo`);
        const esPiloto = modoRes.recordset[0]?.Valor !== 'TODOS';

        res.json({
            success: true,
            message: esPiloto
                ? 'Cliente sacado del piloto — deja de pagar el recargo de urgencia en metros.'
                : 'Excepción eliminada — el cliente vuelve a pagar el recargo de metros por urgencia.',
        });
    } catch (err) {
        logger.error('[UrgenciaDescuentoRollo] deleteExcepcion:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
