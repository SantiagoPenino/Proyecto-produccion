const { spawn } = require('child_process');
const fs = require('fs');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
// Tope de memoria para los dos scripts (23/10/2026): si lo pasan, falla solo el script
const { entornoConTope, describirFallo } = require('../utils/topeMemoriaPython');

const SCRIPT_PATH = process.env.COLOR_SCRIPT_PATH || '/var/www/sistema-produccion/scripts/igualador_color.py';
const CALIB_SCRIPT_PATH = process.env.COLOR_CALIB_SCRIPT_PATH || SCRIPT_PATH.replace(/igualador_color\.py$/, 'color_calibrate.py');
const ICC_DIR = process.env.ICC_DIR || '/mnt/user-data/uploads';
const DEFAULT_ENTRADA = `${ICC_DIR}/uswebcoatedswop.icc`;
const DEFAULT_SALIDA  = `${ICC_DIR}/fedar8H_XinF_50g_dryR__V360x1200_2Pass_.icc`;

const match = async (req, res) => {
    const { L, a, b, entrada, salida } = req.body;

    if (L === undefined || a === undefined || b === undefined) {
        return res.status(400).json({ success: false, error: 'Se requieren valores L, a y b' });
    }

    const args = ['--lab', String(L), String(a), String(b), '--json'];
    if (entrada) args.push('--entrada', entrada);
    if (salida) args.push('--salida', salida);

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const env = entornoConTope();
    const child = spawn(pythonCmd, [SCRIPT_PATH, ...args], { env });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', d => { output += d.toString(); });
    child.stderr.on('data', d => { errorOutput += d.toString(); });

    child.on('close', (code, signal) => {
        if (code !== 0) {
            logger.warn(`[Color] igualador_color falló: ${describirFallo({ code, signal }, errorOutput, env)}`);
            return res.status(500).json({
                success: false,
                error: errorOutput.trim() || `El script terminó con código ${code}. Verificá que Python y transicc (LittleCMS) estén instalados en el servidor.`
            });
        }
        try {
            const data = JSON.parse(output.trim());
            res.json({ success: true, data });
        } catch {
            res.status(500).json({ success: false, error: 'Error parseando respuesta del script', raw: output });
        }
    });

    child.on('error', err => {
        res.status(500).json({
            success: false,
            error: `No se pudo ejecutar Python: ${err.message}. Verificá que Python esté instalado en el servidor.`
        });
    });
};

const getDefaults = (req, res) => {
    res.json({
        success: true,
        defaults: { entrada: DEFAULT_ENTRADA, salida: DEFAULT_SALIDA }
    });
};

const getProfiles = (req, res) => {
    try {
        const files = fs.readdirSync(ICC_DIR)
            .filter(f => f.toLowerCase().endsWith('.icc'))
            .map(f => ({ name: f, path: `${ICC_DIR}/${f}` }));
        res.json({ success: true, profiles: files });
    } catch (err) {
        res.status(500).json({ success: false, error: `No se pudo leer el directorio de perfiles: ${err.message}` });
    }
};

// ─── Chart de referencia (parches medidos con espectrofotómetro) ─────────────
// Se auto-crean las tablas la primera vez (mismo patrón que PushSubscriptions, etc.)
async function ensureChartTables() {
    const pool = await getPool();
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ColorChartTiradas')
        BEGIN
            CREATE TABLE ColorChartTiradas (
                Id INT IDENTITY PRIMARY KEY,
                BatchCode NVARCHAR(50) NOT NULL,
                Descripcion NVARCHAR(200) NULL,
                Activa BIT NOT NULL DEFAULT 0,
                FechaAlta DATETIME DEFAULT GETDATE(),
                CONSTRAINT UQ_ColorChart_Batch UNIQUE(BatchCode)
            );
        END
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ColorChartParches')
        BEGIN
            CREATE TABLE ColorChartParches (
                Id INT IDENTITY PRIMARY KEY,
                TiradaId INT NOT NULL,
                PatchId INT NOT NULL,
                LabL FLOAT NOT NULL,
                LabA FLOAT NOT NULL,
                LabB FLOAT NOT NULL,
                CONSTRAINT UQ_ColorChartParche UNIQUE(TiradaId, PatchId)
            );
            CREATE INDEX IX_ColorChartParche_Tirada ON ColorChartParches(TiradaId);
        END
    `);
}

const listCharts = async (req, res) => {
    try {
        await ensureChartTables();
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT t.Id, t.BatchCode, t.Descripcion, t.Activa, t.FechaAlta,
                   (SELECT COUNT(*) FROM ColorChartParches WHERE TiradaId = t.Id) AS NumParches
            FROM ColorChartTiradas t
            ORDER BY t.Activa DESC, t.FechaAlta DESC
        `);
        res.json({ success: true, charts: r.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const getChart = async (req, res) => {
    try {
        await ensureChartTables();
        const pool = await getPool();
        const id = parseInt(req.params.id, 10);
        const t = await pool.request().input('Id', sql.Int, id)
            .query('SELECT Id, BatchCode, Descripcion, Activa, FechaAlta FROM ColorChartTiradas WHERE Id = @Id');
        if (!t.recordset.length) return res.status(404).json({ success: false, error: 'Tirada no encontrada' });
        const p = await pool.request().input('Id', sql.Int, id)
            .query('SELECT PatchId, LabL AS L, LabA AS A, LabB AS B FROM ColorChartParches WHERE TiradaId = @Id ORDER BY PatchId');
        res.json({ success: true, chart: t.recordset[0], patches: p.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const saveChart = async (req, res) => {
    const { batchCode, descripcion, patches, activa } = req.body;
    if (!batchCode || !Array.isArray(patches) || patches.length === 0) {
        return res.status(400).json({ success: false, error: 'Se requiere batchCode y al menos un parche.' });
    }
    let transaction;
    try {
        await ensureChartTables();
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const up = await transaction.request()
            .input('Batch', sql.NVarChar(50), batchCode)
            .input('Desc', sql.NVarChar(200), descripcion || null)
            .query(`
                IF EXISTS (SELECT 1 FROM ColorChartTiradas WHERE BatchCode = @Batch)
                BEGIN
                    UPDATE ColorChartTiradas SET Descripcion = @Desc WHERE BatchCode = @Batch;
                    SELECT Id FROM ColorChartTiradas WHERE BatchCode = @Batch;
                END
                ELSE
                BEGIN
                    INSERT INTO ColorChartTiradas (BatchCode, Descripcion) VALUES (@Batch, @Desc);
                    SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;
                END
            `);
        const tiradaId = up.recordset[0].Id;

        await transaction.request().input('Tid', sql.Int, tiradaId)
            .query('DELETE FROM ColorChartParches WHERE TiradaId = @Tid');

        for (const p of patches) {
            await transaction.request()
                .input('Tid', sql.Int, tiradaId)
                .input('Pid', sql.Int, p.patchId)
                .input('L', sql.Float, p.L)
                .input('A', sql.Float, p.a)
                .input('B', sql.Float, p.b)
                .query('INSERT INTO ColorChartParches (TiradaId, PatchId, LabL, LabA, LabB) VALUES (@Tid, @Pid, @L, @A, @B)');
        }

        if (activa) {
            await transaction.request().input('Tid', sql.Int, tiradaId)
                .query('UPDATE ColorChartTiradas SET Activa = CASE WHEN Id = @Tid THEN 1 ELSE 0 END');
        }

        await transaction.commit();
        res.json({ success: true, data: { tiradaId } });
    } catch (err) {
        if (transaction) { try { await transaction.rollback(); } catch (e) { /* noop */ } }
        res.status(500).json({ success: false, error: err.message });
    }
};

const activateChart = async (req, res) => {
    try {
        await ensureChartTables();
        const pool = await getPool();
        const id = parseInt(req.params.id, 10);
        await pool.request().input('Id', sql.Int, id)
            .query('UPDATE ColorChartTiradas SET Activa = CASE WHEN Id = @Id THEN 1 ELSE 0 END');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── Calibración por foto ────────────────────────────────────────────────────
// Recibe el RGB capturado de cada parche de la chart (desde la foto) + el RGB de
// la muestra; ajusta RGB->LAB contra la tirada ACTIVA y devuelve el LAB calibrado.
const calibrate = async (req, res) => {
    const { capturedRgb, sampleRgb } = req.body;
    if (!Array.isArray(capturedRgb) || !Array.isArray(sampleRgb) || sampleRgb.length !== 3) {
        return res.status(400).json({ success: false, error: 'Faltan datos de la foto (parches o muestra).' });
    }
    try {
        await ensureChartTables();
        const pool = await getPool();
        const tr = await pool.request().query(
            'SELECT TOP 1 Id, BatchCode FROM ColorChartTiradas WHERE Activa = 1 ORDER BY FechaAlta DESC'
        );
        if (!tr.recordset.length) {
            return res.status(400).json({ success: false, error: 'No hay una tirada activa. Cargá y activá una en la tab "Chart / Referencia".' });
        }
        const tiradaId = tr.recordset[0].Id;
        const pr = await pool.request().input('Id', sql.Int, tiradaId)
            .query('SELECT PatchId, LabL, LabA, LabB FROM ColorChartParches WHERE TiradaId = @Id');
        const labById = {};
        pr.recordset.forEach(p => { labById[p.PatchId] = [p.LabL, p.LabA, p.LabB]; });

        // Emparejar cada RGB capturado con el LAB medido del mismo parche
        const patches = [];
        for (const c of capturedRgb) {
            const lab = labById[c.patchId];
            if (lab && Array.isArray(c.rgb) && c.rgb.length === 3) {
                patches.push({ rgb: c.rgb, lab });
            }
        }
        if (patches.length < 4) {
            return res.status(400).json({ success: false, error: 'La tirada activa no tiene suficientes parches medidos (mínimo 4).' });
        }

        const payload = JSON.stringify({ patches, sample_rgb: sampleRgb });
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        const env = entornoConTope();
        const child = spawn(pythonCmd, [CALIB_SCRIPT_PATH], { env });
        let output = '', errorOutput = '';
        child.stdout.on('data', d => { output += d.toString(); });
        child.stderr.on('data', d => { errorOutput += d.toString(); });
        child.on('close', (code, signal) => {
            if (code !== 0) {
                logger.warn(`[Color] color_calibrate falló: ${describirFallo({ code, signal }, errorOutput, env)}`);
                return res.status(500).json({ success: false, error: errorOutput.trim() || `El calibrador terminó con código ${code}. Verificá que numpy esté instalado en el server.` });
            }
            try {
                const data = JSON.parse(output.trim());
                res.json({ success: true, data: { ...data, tirada: tr.recordset[0].BatchCode } });
            } catch {
                res.status(500).json({ success: false, error: 'No se pudo parsear la salida del calibrador.', raw: output });
            }
        });
        child.on('error', err => {
            res.status(500).json({ success: false, error: `No se pudo ejecutar Python: ${err.message}` });
        });
        child.stdin.write(payload);
        child.stdin.end();
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = { match, getDefaults, getProfiles, listCharts, getChart, saveChart, activateChart, calibrate };
