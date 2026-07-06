'use strict';

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

/**
 * GET /api/profiles/urgencia-excepciones
 * Lista todas las excepciones activas con nombre de cliente, artículo y área.
 */
exports.getExcepciones = async (req, res) => {
    try {
        const pool = await getPool();

        // Filtro opcional por cliente (acepta CodCliente externo o CliIdCliente interno)
        let whereExtra = '';
        if (req.query.cliId) {
            const cid = parseInt(req.query.cliId);
            const cliRes = await pool.request()
                .input('cid', sql.Int, cid)
                .query(`SELECT TOP 1 CliIdCliente FROM dbo.Clientes WHERE CliIdCliente = @cid OR CodCliente = @cid`);
            if (cliRes.recordset.length > 0) {
                whereExtra = ` AND ue.CliIdCliente = ${cliRes.recordset[0].CliIdCliente}`;
            } else {
                return res.json({ success: true, data: [] });
            }
        }

        const result = await pool.request().query(`
            SELECT
                ue.ID,
                ue.CliIdCliente,
                c.Nombre          AS ClienteNombre,
                ue.ProIdProducto,
                a.Descripcion     AS ArticuloNombre,
                a.CodArticulo,
                ue.CodArea,
                ISNULL(cme.NombreReferencia, ue.CodArea) AS AreaNombre,
                ue.Descripcion,
                ue.FechaAlta
            FROM dbo.UrgenciaExcepciones ue
            JOIN dbo.Clientes  c   WITH(NOLOCK) ON c.CliIdCliente  = ue.CliIdCliente
            LEFT JOIN dbo.Articulos a   WITH(NOLOCK) ON a.ProIdProducto = ue.ProIdProducto
            LEFT JOIN dbo.ConfigMapeoERP cme WITH(NOLOCK) ON LTRIM(RTRIM(cme.AreaID_Interno)) = ue.CodArea
            WHERE ue.Activo = 1${whereExtra}
            ORDER BY c.Nombre, ue.CodArea, a.Descripcion
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('[UrgenciaExcepciones] getExcepciones:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/profiles/urgencia-excepciones/areas
 * Devuelve solo los servicios/áreas que TIENEN urgencia activa en el sistema
 * (excluye los que están en AREAS_SIN_URGENCIA en ConfiguracionGlobal).
 */
exports.getAreas = async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request().query(`
            SELECT DISTINCT
                LTRIM(RTRIM(AreaID_Interno)) AS CodArea,
                NombreReferencia             AS AreaNombre
            FROM dbo.ConfigMapeoERP WITH(NOLOCK)
            WHERE AreaID_Interno IS NOT NULL AND LTRIM(RTRIM(AreaID_Interno)) <> ''
            ORDER BY NombreReferencia
        `);

        // Con ?all=1 devuelve todas las áreas sin filtrar (para el selector de categorías del perfil)
        if (req.query.all === '1') {
            return res.json({ success: true, data: result.recordset });
        }

        // Leer categoría del perfil de urgencia
        const cfgRes = await pool.request().query(`
            SELECT cg.Valor AS sinUrgencia, pp.Categoria AS urgCategoria
            FROM dbo.ConfiguracionGlobal cg
            CROSS JOIN (
                SELECT TOP 1 Categoria FROM dbo.PerfilesPrecios
                WHERE ID = (SELECT TOP 1 CAST(Valor AS INT) FROM dbo.ConfiguracionGlobal WHERE Clave = 'ID_PERFIL_URGENCIA')
                AND Activo = 1
            ) pp
            WHERE cg.Clave = 'AREAS_SIN_URGENCIA'
        `);

        const urgCategoria = (cfgRes.recordset[0]?.urgCategoria || 'Todos').trim();

        let data;
        if (urgCategoria && urgCategoria !== 'Todos') {
            // Resolver AreaNombre → CodArea para comparación exacta
            const urgCats = urgCategoria.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            data = result.recordset.filter(a =>
                urgCats.includes(a.CodArea.toUpperCase()) ||
                urgCats.includes((a.AreaNombre || '').toUpperCase())
            );
        } else {
            // Categoría = 'Todos' → excluir las de AREAS_SIN_URGENCIA
            const sinUrg = (cfgRes.recordset[0]?.sinUrgencia || 'BOR,EMB,COR,TWC,COS,TWT')
                .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            data = result.recordset.filter(a => !sinUrg.includes(a.CodArea.toUpperCase()));
        }

        res.json({ success: true, data });
    } catch (err) {
        logger.error('[UrgenciaExcepciones] getAreas:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /api/profiles/urgencia-excepciones
 * Agrega una excepción.
 * Body:
 *   { CliIdCliente, ProIdProducto? }  → excepción por artículo específico
 *   { CliIdCliente, CodArea? }        → excepción por área/servicio completo
 *   { CliIdCliente }                  → exento total (ProIdProducto=null, CodArea=null)
 */
exports.addExcepcion = async (req, res) => {
    const { CliIdCliente, ProIdProducto = null, CodArea = null, Descripcion = null } = req.body;
    const UsuarioAlta = req.user?.id ?? 1;

    if (!CliIdCliente) {
        return res.status(400).json({ success: false, error: 'CliIdCliente es obligatorio.' });
    }

    const proId   = ProIdProducto ? parseInt(ProIdProducto) : null;
    const codArea = CodArea ? CodArea.trim().toUpperCase() : null;

    try {
        const pool = await getPool();

        // Resolver CliIdCliente interno: puede llegar CodCliente (externo) o CliIdCliente
        const cliRes = await pool.request()
            .input('cid', sql.Int, parseInt(CliIdCliente))
            .query(`SELECT TOP 1 CliIdCliente FROM dbo.Clientes
                    WHERE CliIdCliente = @cid OR CodCliente = @cid`);
        if (cliRes.recordset.length === 0) {
            return res.status(400).json({ success: false, error: `Cliente ${CliIdCliente} no encontrado en la base de datos.` });
        }
        const realCliId = cliRes.recordset[0].CliIdCliente;
        await pool.request()
            .input('CliId',   sql.Int,           realCliId)
            .input('ProId',   sql.Int,           proId)
            .input('CodArea', sql.VarChar(20),   codArea)
            .input('Desc',    sql.NVarChar(200), Descripcion || null)
            .input('Usr',     sql.Int,           UsuarioAlta)
            .query(`
                IF NOT EXISTS (
                    SELECT 1 FROM dbo.UrgenciaExcepciones
                    WHERE CliIdCliente = @CliId
                      AND Activo = 1
                      AND (ProIdProducto = @ProId OR (ProIdProducto IS NULL AND @ProId IS NULL))
                      AND (CodArea      = @CodArea OR (CodArea      IS NULL AND @CodArea IS NULL))
                )
                INSERT INTO dbo.UrgenciaExcepciones
                    (CliIdCliente, ProIdProducto, CodArea, Descripcion, Activo, FechaAlta, UsuarioAlta)
                VALUES
                    (@CliId, @ProId, @CodArea, @Desc, 1, GETDATE(), @Usr)
                ELSE
                    RAISERROR('Ya existe una excepción para ese cliente y servicio.', 16, 1)
            `);
        res.json({ success: true, message: 'Excepción registrada.' });
    } catch (err) {
        logger.error('[UrgenciaExcepciones] addExcepcion:', err.message);
        const status = err.message.includes('Ya existe') ? 409 : 500;
        res.status(status).json({ success: false, error: err.message });
    }
};

/**
 * DELETE /api/profiles/urgencia-excepciones/:id
 */
exports.deleteExcepcion = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, parseInt(id))
            .query(`UPDATE dbo.UrgenciaExcepciones SET Activo = 0 WHERE ID = @ID`);
        res.json({ success: true, message: 'Excepción eliminada.' });
    } catch (err) {
        logger.error('[UrgenciaExcepciones] deleteExcepcion:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
