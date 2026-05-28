const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

exports.getConfiguraciones = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query("SELECT * FROM ConfiguracionesSync ORDER BY NombreProceso");
        res.json(result.recordset);
    } catch (error) {
        logger.error("Error obteniendo configuraciones:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.updateConfiguracion = async (req, res) => {
    try {
        const { ProcesoID, Activo } = req.body;

        if (!ProcesoID || typeof Activo !== 'boolean') {
            return res.status(400).json({ error: "Faltan datos o formato incorrecto. Se requiere ProcesoID y Activo (boolean)." });
        }

        const pool = await getPool();
        await pool.request()
            .input('ProcesoID', sql.VarChar, ProcesoID)
            .input('Activo', sql.Bit, Activo ? 1 : 0)
            .query("UPDATE ConfiguracionesSync SET Activo = @Activo WHERE ProcesoID = @ProcesoID");

        res.json({ success: true, message: `Configuración ${ProcesoID} actualizada correctamente a ${Activo}` });
    } catch (error) {
        logger.error("Error actualizando configuracion:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.setPlanillaRow = async (req, res) => {
    try {
        const { rowNumber, area = 'DF' } = req.body;
        if (!rowNumber) {
            return res.status(400).json({ error: "Debe ingresar el número de fila." });
        }

        const PLANILLA_URL = process.env.PLANILLA_SCRIPT_URL;
        if (!PLANILLA_URL) {
            return res.status(500).json({ error: "URL de la Planilla de Sheets no configurada (.env)." });
        }

        const axios = require('axios');
        try {
            const scriptUrl = `${PLANILLA_URL}?action=setRow&area=${area}&value=${encodeURIComponent(rowNumber)}`;
            logger.info("Setting planilla row via:", scriptUrl);

            const response = await axios.get(scriptUrl);

            // Log this manual action
            let procesoId = 'SYNC_PLANILLA_SHEETS_DF';
            if (area === 'SB') procesoId = 'SYNC_PLANILLA_SHEETS_SUB';
            else if (area === 'IMD') procesoId = 'SYNC_PLANILLA_SHEETS_IMD';
            else if (area === 'TPU') procesoId = 'SYNC_PLANILLA_SHEETS_TPU';
            else if (area === 'CENCO') procesoId = 'SYNC_PLANILLA_SHEETS_CENCO';

            exports.updateProcessLog(procesoId, 'OK', `FILA ACTUALIZADA MANUALMENTE: Recargará desde la fila ${rowNumber}.`);

            res.json({ success: true, message: `Propiedad actualizada. La lectura se reiniciará desde la fila ${rowNumber}.`, scriptResponse: response.data });
        } catch (scriptErr) {
            logger.error("Error contactando Apps Script:", scriptErr);
            throw new Error("No se pudo contactar al servidor de Google Apps Script. " + scriptErr.message);
        }

    } catch (error) {
        logger.error("Error setPlanillaRow:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getPlanillaRow = async (req, res) => {
    try {
        const { area = 'DF' } = req.query;

        const PLANILLA_URL = process.env.PLANILLA_SCRIPT_URL;
        if (!PLANILLA_URL) {
            return res.status(500).json({ error: "URL de la Planilla de Sheets no configurada (.env)." });
        }

        const axios = require('axios');
        try {
            const scriptUrl = `${PLANILLA_URL}?action=getRow&area=${area}`;
            const response = await axios.get(scriptUrl);

            // Expected response from script: { status: 'OK', currentRow: N }
            // If the script does not have this logic yet, handle fallback gracefully
            res.json({ success: true, currentRow: response.data.currentRow || '' });
        } catch (scriptErr) {
            logger.error("Error obteniendo fila desde Apps Script:", scriptErr);
            throw new Error("No se pudo leer la fila actual.");
        }
    } catch (error) {
        logger.error("Error getPlanillaRow:", error);
        res.status(500).json({ error: error.message });
    }
};

// Helper function to be used by other controllers to check if a process is active
exports.isProcessActive = async (procesoID) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('ProcesoID', sql.VarChar, procesoID)
            .query("SELECT Activo FROM ConfiguracionesSync WHERE ProcesoID = @ProcesoID");

        if (result.recordset.length > 0) {
            return result.recordset[0].Activo === true;
        }
        return false; // Si no existe, lo apagamos por seguridad
    } catch (err) {
        logger.error(`Error verificando estado del proceso ${procesoID}:`, err);
        return false; // Ante duda, no ejecutar
    }
};

// Helper para actualizar estado y hora de ejecución
exports.updateProcessLog = async (procesoID, estado, mensaje = '') => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('ProcesoID', sql.VarChar, procesoID)
            .input('Estado', sql.VarChar, estado) // 'OK' o 'ERROR'
            .input('Msg', sql.NVarChar(sql.MAX), mensaje)
            .query("UPDATE ConfiguracionesSync SET UltimaEjecucion = GETDATE(), UltimoEstado = @Estado, MensajeError = @Msg WHERE ProcesoID = @ProcesoID");
    } catch (err) {
        logger.error(`Error guardando log de proceso ${procesoID}:`, err);
    }
};
