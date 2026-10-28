const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const logsDir = process.env.LOGS_PATH || path.join(__dirname, '..', 'logs');

// Logger dedicado para HTTP — escribe en http-YYYY-MM-DD.log, NO en combined
const httpLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: () => {
                const d = new Date();
                return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
            }
        }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
    ),
    transports: [
        new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'http-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '7d',
            maxSize: '20m',
        }),
    ],
});

const mainLogger = require('../utils/logger');
// Contadores de pedidos y errores por minuto para el monitor del servidor (/admin/monitor)
const monitor = require('../services/monitorService');

/**
 * Express middleware — loguea cada HTTP request.
 * Formato: [HTTP] METHOD /url STATUS TIMEms — user:ID
 */
module.exports = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        // Ignorar rutas muy ruidosas que no aportan valor de auditoría
        const noisyPaths = [
            '/api/health',
            '/assets/',
            '/sw.js',
            '/manifest.json',
            '/favicon.ico'
        ];
        
        const url = req.originalUrl || req.url;
        const isNoisy = noisyPaths.some(p => url.startsWith(p) || url === p);

        const duration = Date.now() - start;
        monitor.registrarHttp(res.statusCode, duration, url, {
            ip: req.ip, build: req.headers['x-front-build'], usuario: req.user?.id,
            // En los logins, solo el usuario que se intentó (nunca la contraseña), para los fallidos del monitor
            loginUsuario: /^\/api\/(web-)?auth\/login/.test(url) ? (req.body?.username || req.body?.email || req.body?.usuario) : undefined,
            // Subidas de archivos (26/10): el monitor las muestra aparte, con MB/s, y no entre las rutas lentas
            multipart: /^multipart\/form-data/i.test(req.headers['content-type'] || ''),
            bytes: Number(req.headers['content-length']) || null,
        });
        const userId = req.user?.id || '-';
        const line = `[HTTP] ${req.method} ${url} ${res.statusCode} ${duration}ms — user:${userId}`;

        if (res.statusCode >= 500) {
            mainLogger.error(line);  // Errores sí van al combined siempre
        }
        
        if (!isNoisy || res.statusCode >= 400) {
            httpLogger.info(line);       // Solo loguear si no es ruido o si dio error
        }
    });

    next();
};
