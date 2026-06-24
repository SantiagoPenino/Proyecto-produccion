const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../utils/logger');

const logsDir = process.env.LOGS_PATH || path.join(__dirname, '..', 'logs');

// ─── GET /api/sysadmin/status ─────────────────────────────
exports.getSystemStatus = async (req, res) => {
    try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        // CPU usage (average across cores)
        const cpus = os.cpus();
        const cpuAvg = cpus.reduce((acc, cpu) => {
            const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
            const idle = cpu.times.idle;
            return acc + ((total - idle) / total) * 100;
        }, 0) / cpus.length;

        // DB status
        let dbStatus = { ok: false, activeConnections: 0 };
        try {
            const { getPool } = require('../config/db');
            const pool = await getPool();
            await pool.request().query('SELECT 1');
            dbStatus = {
                ok: true,
                activeConnections: pool._connected ? (pool.pool?.size || 0) : 0,
            };
        } catch (e) {
            dbStatus = { ok: false, error: e.message };
        }

        // Socket.IO clients
        let socketClients = 0;
        try {
            const io = req.app.get('socketio');
            if (io) socketClients = io.engine?.clientsCount || 0;
        } catch (e) { /* ignore */ }

        // 1. Database Size
        let dbSizeMB = 0;
        try {
            if (dbStatus.ok) {
                const { getPool } = require('../config/db');
                const pool = await getPool();
                const result = await pool.request().query('SELECT CAST(ROUND(SUM(size)*8.0/1024, 2) AS FLOAT) AS sizeMB FROM sys.database_files');
                if (result.recordset && result.recordset.length > 0) {
                    dbSizeMB = result.recordset[0].sizeMB;
                }
            }
        } catch (e) { /* ignore */ }

        // 2. PM2 Restarts
        let pm2Restarts = 0;
        try {
            const jlist = execSync('pm2 jlist', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
            const processes = JSON.parse(jlist);
            pm2Restarts = processes.reduce((acc, p) => acc + (p.pm2_env?.restart_time || 0), 0);
        } catch (e) { /* ignore */ }

        // 3. Disk Space (Windows)
        let disk = { total: 0, free: 0 };
        try {
            const driveLetter = path.parse(__dirname).root.substring(0, 2); // e.g., 'C:'
            const psCommand = `powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Where-Object DeviceID -eq '${driveLetter}' | Select-Object Size, FreeSpace | ConvertTo-Json"`;
            const output = execSync(psCommand, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
            const parsed = JSON.parse(output);
            if (parsed && parsed.Size && parsed.FreeSpace) {
                disk.total = parsed.Size;
                disk.free = parsed.FreeSpace;
            }
        } catch (e) { /* ignore */ }

        res.json({
            uptime: process.uptime(),
            nodeVersion: process.version,
            platform: os.platform(),
            hostname: os.hostname(),
            memory: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                percentUsed: ((usedMem / totalMem) * 100).toFixed(1),
            },
            cpu: {
                cores: cpus.length,
                model: cpus[0]?.model || 'Unknown',
                percentUsed: cpuAvg.toFixed(1),
            },
            db: { ...dbStatus, sizeMB: dbSizeMB },
            sockets: socketClients,
            disk,
            pm2Restarts,
            serverTime: new Date().toISOString(),
        });
    } catch (err) {
        logger.error('[SysAdmin] Error getting system status:', err);
        res.status(500).json({ error: 'Error obteniendo estado del sistema' });
    }
};

// ─── POST /api/sysadmin/clear-logs ────────────────────────
exports.clearLogs = async (req, res) => {
    try {
        if (fs.existsSync(logsDir)) {
            const files = fs.readdirSync(logsDir);
            for (const file of files) {
                if (file.endsWith('.log')) {
                    fs.writeFileSync(path.join(logsDir, file), ''); // Vacía el contenido
                }
            }
        }
        res.json({ message: 'Logs limpiados con éxito' });
    } catch (err) {
        logger.error('[SysAdmin] Error clearing logs:', err);
        res.status(500).json({ error: 'Error al limpiar logs' });
    }
};

// ─── GET /api/sysadmin/logs ───────────────────────────────
exports.getLogFiles = async (req, res) => {
    try {
        if (!fs.existsSync(logsDir)) {
            return res.json([]);
        }
        const files = fs.readdirSync(logsDir)
            .filter(f => f.endsWith('.log'))
            .map(f => {
                const stats = fs.statSync(path.join(logsDir, f));
                return {
                    name: f,
                    size: stats.size,
                    modified: stats.mtime,
                };
            })
            .sort((a, b) => new Date(b.modified) - new Date(a.modified));

        res.json(files);
    } catch (err) {
        logger.error('[SysAdmin] Error listing log files:', err);
        res.status(500).json({ error: 'Error listando archivos de log' });
    }
};

// ─── GET /api/sysadmin/logs/:filename ─────────────────────
exports.getLogContent = async (req, res) => {
    try {
        const { filename } = req.params;
        const { lines = 200, filter, level } = req.query;

        // Sanitize filename to prevent path traversal
        const sanitized = path.basename(filename);
        if (!sanitized.endsWith('.log')) {
            return res.status(400).json({ error: 'Solo archivos .log' });
        }

        const filePath = path.join(logsDir, sanitized);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Archivo no encontrado' });
        }

        // Read file and take last N lines
        const content = fs.readFileSync(filePath, 'utf-8');
        let allLines = content.split('\n').filter(l => l.trim());

        // Filter by level
        if (level) {
            const lvl = level.toUpperCase();
            allLines = allLines.filter(l => l.includes(`[${lvl}]`));
        }

        // Filter by text
        if (filter) {
            const term = filter.toLowerCase();
            allLines = allLines.filter(l => l.toLowerCase().includes(term));
        }

        // Return last N lines
        const maxLines = Math.min(parseInt(lines) || 200, 1000);
        const result = allLines.slice(-maxLines);

        res.json({
            filename: sanitized,
            totalLines: allLines.length,
            returnedLines: result.length,
            lines: result,
        });
    } catch (err) {
        logger.error('[SysAdmin] Error reading log file:', err);
        res.status(500).json({ error: 'Error leyendo archivo de log' });
    }
};

// ─── GET /api/sysadmin/metrics ────────────────────────────
exports.getDailyMetrics = async (req, res) => {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();

        // Órdenes del día
        const ordersResult = await pool.request().query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN OReEstadoActual = 1 THEN 1 ELSE 0 END) as ingresadas,
                SUM(CASE WHEN OReEstadoActual IN (7, 8) THEN 1 ELSE 0 END) as empaquetadas,
                SUM(CASE WHEN OReEstadoActual = 5 THEN 1 ELSE 0 END) as entregadas,
                SUM(CASE WHEN OReEstadoActual = 6 THEN 1 ELSE 0 END) as canceladas,
                SUM(CASE WHEN OReEstadoActual = 9 THEN 1 ELSE 0 END) as autorizadas
            FROM OrdenesRetiro WITH(NOLOCK)
            WHERE CAST(OReFechaAlta AS DATE) = CAST(GETDATE() AS DATE)
        `);

        // Pagos del día
        const paymentsResult = await pool.request().query(`
            SELECT
                COUNT(*) as cantidad,
                ISNULL(SUM(CASE WHEN p.PagIdMonedaPago = 1 THEN p.PagMontoPago ELSE 0 END), 0) as totalUYU,
                ISNULL(SUM(CASE WHEN p.PagIdMonedaPago = 2 THEN p.PagMontoPago ELSE 0 END), 0) as totalUSD
            FROM Pagos p WITH(NOLOCK)
            WHERE CAST(p.PagFechaPago AS DATE) = CAST(GETDATE() AS DATE)
        `);

        res.json({
            orders: ordersResult.recordset[0] || {},
            payments: paymentsResult.recordset[0] || {},
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        logger.error('[SysAdmin] Error getting daily metrics:', err);
        res.status(500).json({ error: 'Error obteniendo métricas' });
    }
};

// ─── GET /api/sysadmin/sessions ───────────────────────────
exports.getSessions = async (req, res) => {
    try {
        const { getActiveSessions, getLoginHistory } = require('../utils/sessionTracker');
        const limit = parseInt(req.query.limit) || 100;
        res.json({
            active: getActiveSessions(),
            history: getLoginHistory(limit),
        });
    } catch (err) {
        logger.error('[SysAdmin] Error getting sessions:', err);
        res.status(500).json({ error: 'Error obteniendo sesiones' });
    }
};

// ─── DELETE /api/sysadmin/sessions/:userId ────────────────
exports.killSession = async (req, res) => {
    try {
        const { userId } = req.params;
        const { removeSession } = require('../utils/sessionTracker');
        
        // Remover de la memoria del servidor
        removeSession(userId);

        // Emitir evento por WebSockets para desconectar la interfaz cliente
        const io = req.app.get('socketio');
        if (io) {
            io.emit('force_logout_user', { userId });
        }

        const { audit } = require('../utils/auditLogger');
        audit('KICK_USER', { user: req.user?.username, adminId: req.user?.id, kickedUserId: userId });

        res.json({ message: 'Sesión terminada exitosamente. El usuario será desconectado.' });
    } catch (err) {
        logger.error('[SysAdmin] Error killing session:', err);
        res.status(500).json({ error: 'Error al desconectar usuario' });
    }
};

// ─── POST /api/sysadmin/sql ───────────────────────────────
exports.executeSql = async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Query requerida' });
        }

        // Only allow SELECT / WITH ... SELECT (read-only)
        const trimmed = query.trim().toUpperCase();
        const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE', 'GRANT', 'REVOKE'];
        for (const word of forbidden) {
            if (trimmed.startsWith(word) || trimmed.includes(` ${word} `) || trimmed.includes(`\n${word} `)) {
                return res.status(403).json({ error: `Operación no permitida: ${word}. Solo se permiten SELECT.` });
            }
        }

        const { audit } = require('../utils/auditLogger');
        audit('SQL_CONSOLE', { user: req.user?.username, userId: req.user?.id, query: query.substring(0, 200) });

        const { getPool } = require('../config/db');
        const pool = await getPool();
        const start = Date.now();
        const result = await pool.request().query(query);
        const duration = Date.now() - start;

        res.json({
            columns: Object.keys(result.recordset?.[0] || {}),
            rows: result.recordset || [],
            rowCount: result.rowsAffected?.[0] || result.recordset?.length || 0,
            duration
        });
    } catch (err) {
        logger.error('[SysAdmin] Error executing SQL:', err);
        res.status(500).json({ error: err.message || 'Error ejecutando SQL' });
    }
};

// ─── GET /api/sysadmin/slow-queries ───────────────────────
exports.getSlowQueries = async (req, res) => {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TOP 10 
                execution_count,
                (total_worker_time / execution_count) / 1000 AS avg_duration_ms,
                SUBSTRING(st.text, (qs.statement_start_offset/2)+1, 
                    ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text) ELSE qs.statement_end_offset END - qs.statement_start_offset)/2) + 1) AS query_text
            FROM sys.dm_exec_query_stats AS qs 
            CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st 
            ORDER BY avg_duration_ms DESC
        `);
        res.json({ queries: result.recordset || [] });
    } catch (err) {
        logger.error('[SysAdmin] Error getting slow queries:', err);
        res.status(500).json({ error: 'Error obteniendo consultas lentas' });
    }
};

// ─── POST /api/sysadmin/maintenance ───────────────────────
// Avisa a TODOS los clientes conectados que el sistema se va a reiniciar (banner +
// cuenta regresiva). NO reinicia nada: el reinicio real lo hace el deploy. Con
// { cancel: true } oculta el banner. Al volver el server, server:started recarga solo.
exports.broadcastMaintenance = (req, res) => {
    const io = req.app.get('socketio');
    if (!io) return res.status(500).json({ error: 'Socket.io no disponible' });

    const maintenanceState = require('../utils/maintenanceState');
    const { mensaje, segundos, cancel } = req.body || {};

    if (cancel) {
        maintenanceState.clear();
        io.emit('server:maintenance', { cancel: true });
        return res.json({ success: true, cancelled: true });
    }

    const secs = Number(segundos);
    const payload = {
        mensaje: (mensaje && String(mensaje).trim())
            || 'El sistema se reiniciará para una actualización. Guardá tu trabajo.',
        segundos: (Number.isFinite(secs) && secs > 0) ? Math.min(secs, 3600) : 120,
    };

    maintenanceState.set(payload.mensaje, payload.segundos);

    try {
        const { audit } = require('../utils/auditLogger');
        audit('MAINTENANCE_NOTICE', { user: req.user?.username, segundos: payload.segundos, ip: req.ip });
    } catch (_) {}

    io.emit('server:maintenance', payload);
    return res.json({ success: true, ...payload });
};

// ─── POST /api/sysadmin/restart ───────────────────────────
exports.restartServer = async (req, res) => {
    try {
        const { password } = req.body;
        const ADMIN_PASSWORD = process.env.ADMIN_RESTART_PASSWORD || process.env.JWT_SECRET || 'admin-restart-2026';

        if (password !== ADMIN_PASSWORD) {
            return res.status(403).json({ error: 'Contraseña de administración incorrecta.' });
        }

        const { audit } = require('../utils/auditLogger');
        audit('SERVER_RESTART', { user: req.user?.username, userId: req.user?.id, ip: req.ip });

        logger.warn('[SysAdmin] Server restart requested by ' + (req.user?.username || 'unknown'));

        // Respond first, then exit
        res.json({ success: true, message: 'Servidor reiniciando...' });

        setTimeout(() => {
            process.exit(0); // PM2 / NSSM will auto-restart
        }, 1000);
    } catch (err) {
        logger.error('[SysAdmin] Restart error:', err);
        res.status(500).json({ error: 'Error al reiniciar' });
    }
};

// ─── GET /api/sysadmin/services ───────────────────────────
// #12 — Test external services
exports.testServices = async (req, res) => {
    const axios = require('axios');
    const results = [];

    const ping = async (name, url, opts = {}) => {
        const start = Date.now();
        try {
            const r = await axios({ method: 'GET', url, timeout: 8000, ...opts });
            results.push({ name, url, status: 'OK', statusCode: r.status, ms: Date.now() - start });
        } catch (e) {
            results.push({ name, url, status: 'ERROR', error: e.message?.substring(0, 100), ms: Date.now() - start });
        }
    };

    await Promise.allSettled([
        ping('Handy Payments', 'https://api.payments.handy.uy/api/v2/payments', { method: 'OPTIONS' }),
        ping('Callbell (WhatsApp)', 'https://api.callbell.eu/v1/messages', {
            method: 'GET',
            headers: { Authorization: `Bearer ${process.env.CALLBELL_API_KEY || 'test'}` }
        }),
        ping('BCU Cotizaciones', 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones?wsdl'),
        ping('Google (Internet)', 'https://www.google.com', { method: 'HEAD' }),
    ]);

    res.json(results);
};

// ─── POST /api/sysadmin/backup ────────────────────────────
// #13 — Manual DB backup
exports.backupDatabase = async (req, res) => {
    try {
        const { exec } = require('child_process');
        const { audit } = require('../utils/auditLogger');
        const scriptPath = process.env.BACKUP_SCRIPT_PATH || '/var/www/scripts/backup.sh';

        audit('DB_BACKUP', { user: req.user?.username, userId: req.user?.id, script: scriptPath });
        logger.info(`[SysAdmin] Ejecutando backup script: ${scriptPath}`);

        exec(`bash ${scriptPath}`, { timeout: 120000 }, (error, stdout, stderr) => {
            if (error) {
                logger.error('[SysAdmin] Backup script error:', error.message);
                return res.status(500).json({ error: error.message, stderr });
            }
            logger.info('[SysAdmin] Backup completado:', stdout);
            res.json({ success: true, output: stdout, timestamp: new Date().toISOString() });
        });
    } catch (err) {
        logger.error('[SysAdmin] Backup error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─── POST /api/sysadmin/client-error ──────────────────────
// #14 — Frontend error reporting (no auth required — mounted separately)
exports.reportClientError = async (req, res) => {
    const { message, stack, url, userAgent, userId, timestamp } = req.body;
    const ip = (req.ip || '').replace(/^::ffff:/, '');

    // Store in memory + log
    if (!global.__frontendErrors) global.__frontendErrors = [];
    const entry = {
        message: (message || '').substring(0, 500),
        stack: (stack || '').substring(0, 1000),
        url, userAgent: (userAgent || '').substring(0, 200),
        userId, ip,
        timestamp: timestamp || new Date().toISOString(),
    };
    global.__frontendErrors.unshift(entry);
    if (global.__frontendErrors.length > 200) global.__frontendErrors.length = 200;

    logger.error(`[FRONTEND_ERROR] ${entry.message} | url=${url} | user=${userId} | ip=${ip}`);

    // #15 — Error accumulation alert check
    const recentErrors = global.__frontendErrors.filter(e =>
        (Date.now() - new Date(e.timestamp).getTime()) < 5 * 60 * 1000
    );
    if (recentErrors.length >= 10 && !global.__errorAlertSent) {
        global.__errorAlertSent = true;
        logger.warn(`[ALERT] ⚠️ ${recentErrors.length} errores de frontend en los últimos 5 minutos!`);
        // Reset flag after 10 minutes
        setTimeout(() => { global.__errorAlertSent = false; }, 10 * 60 * 1000);
    }

    res.json({ ok: true });
};

// ─── GET /api/sysadmin/client-errors ──────────────────────
// View collected frontend errors
exports.getClientErrors = async (req, res) => {
    const errors = global.__frontendErrors || [];
    const limit = parseInt(req.query.limit) || 50;
    res.json({
        errors: errors.slice(0, limit),
        total: errors.length,
        alertActive: !!global.__errorAlertSent,
        recentCount: errors.filter(e => (Date.now() - new Date(e.timestamp).getTime()) < 5 * 60 * 1000).length,
    });
};

// ─── GET /api/sysadmin/tables ─────────────────────────────
// #16 — DB table info
exports.getTableInfo = async (req, res) => {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();

        // Tables with row counts and sizes
        const tablesResult = await pool.request().query(`
            SELECT
                t.TABLE_NAME AS [name],
                p.[rows] AS [rowCount],
                CAST(ROUND(((SUM(a.total_pages) * 8) / 1024.0), 2) AS DECIMAL(18,2)) AS [sizeMB]
            FROM INFORMATION_SCHEMA.TABLES t
            INNER JOIN sys.tables st ON st.name = t.TABLE_NAME
            INNER JOIN sys.indexes i ON st.object_id = i.object_id
            INNER JOIN sys.partitions p ON i.object_id = p.OBJECT_ID AND i.index_id = p.index_id
            INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
            WHERE t.TABLE_TYPE = 'BASE TABLE' AND i.object_id > 255 AND i.index_id <= 1
            GROUP BY t.TABLE_NAME, p.[rows]
            ORDER BY p.[rows] DESC
        `);

        res.json({ tables: tablesResult.recordset || [] });
    } catch (err) {
        logger.error('[SysAdmin] Table info error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─── GET /api/sysadmin/tables/:tableName ──────────────────
// Column info for a specific table
exports.getTableColumns = async (req, res) => {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const tableName = req.params.tableName.replace(/[^a-zA-Z0-9_]/g, ''); // sanitize

        const columnsResult = await pool.request()
            .input('table', require('../config/db').sql.NVarChar, tableName)
            .query(`
                SELECT
                    COLUMN_NAME as name,
                    DATA_TYPE as type,
                    CHARACTER_MAXIMUM_LENGTH as maxLength,
                    IS_NULLABLE as nullable,
                    COLUMN_DEFAULT as defaultValue
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = @table
                ORDER BY ORDINAL_POSITION
            `);

        res.json({ table: tableName, columns: columnsResult.recordset || [] });
    } catch (err) {
        logger.error('[SysAdmin] Column info error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─── GET /api/sysadmin/audit ──────────────────────────────
// Audit trail viewer
exports.getAuditTrail = async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const logsDir = process.env.LOGS_PATH || path.join(__dirname, '..', 'logs');
        const limit = parseInt(req.query.limit) || 100;
        const actionFilter = req.query.action || '';

        // Find audit log files, sorted newest first
        const files = fs.readdirSync(logsDir)
            .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
            .sort().reverse();

        let entries = [];
        for (const file of files) {
            if (entries.length >= limit) break;
            const content = fs.readFileSync(path.join(logsDir, file), 'utf8');
            const lines = content.split('\n').filter(l => l.trim()).reverse();
            for (const line of lines) {
                if (entries.length >= limit) break;
                // Parse: "DD/MM/YYYY HH:mm:ss [AUDIT] ACTION key:val key:val"
                const match = line.match(/^(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}) \[AUDIT\] (\S+)\s*(.*)/);
                if (!match) continue;
                const [, timestamp, action, detailsRaw] = match;
                if (actionFilter && action !== actionFilter) continue;
                const details = {};
                detailsRaw.split(/\s+/).forEach(pair => {
                    const idx = pair.indexOf(':');
                    if (idx > 0) details[pair.slice(0, idx)] = pair.slice(idx + 1);
                });
                entries.push({ timestamp, action, details, raw: line });
            }
        }

        res.json({ entries, total: entries.length, files: files.length });
    } catch (err) {
        logger.error('[SysAdmin] Audit trail error:', err);
        res.status(500).json({ error: err.message });
    }
};
