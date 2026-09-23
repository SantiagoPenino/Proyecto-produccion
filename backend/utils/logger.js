const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const logsDir = process.env.LOGS_PATH || path.join(__dirname, '..', 'logs');

// Formato timestamp DD/MM/YYYY HH:mm:ss
const timestampFormat = winston.format.timestamp({
    format: () => {
        const d = new Date();
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
    }
});

// Lo que llega después del mensaje como texto suelto — logger.error('[X]', err.message) — winston
// lo guarda aparte (info[SPLAT]) y este formato no lo imprimía: 408 llamadas del backend perdían
// el motivo del error (23/09: una nota de crédito fallida quedó registrada solo como
// "[NOTA-CREDITO]"). Los objetos y los Error ya los incorpora winston al mensaje o a meta; acá se
// suman solo los textos y números, en el orden en que vinieron.
const SPLAT = Symbol.for('splat');
const printFormat = winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    const sueltos = (info[SPLAT] || []).filter(a => a !== null && a !== undefined && typeof a !== 'object');
    const texto = sueltos.length ? `${message} ${sueltos.join(' ')}` : message;
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level.toUpperCase()}] ${texto}${metaStr}`;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(timestampFormat, printFormat),
    transports: [
        // Error log — solo errores
        new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: '14d',
            maxSize: '10m',
        }),
        // Combined log — todo
        new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d',
            maxSize: '20m',
        }),
    ],
});

// En desarrollo: también imprimir en consola con colores
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            timestampFormat,
            printFormat
        ),
    }));
}

module.exports = logger;
