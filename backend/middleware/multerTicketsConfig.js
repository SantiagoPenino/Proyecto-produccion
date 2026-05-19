const multer = require('multer');
const path = require('path');
const fs = require('fs');

const BASE_PATH = process.env.TICKETS_SOPORTE_PATH || path.join(__dirname, '../tickets');

/**
 * Retorna la carpeta base para los adjuntos de tickets.
 * Si se pasa un ticketId, retorna la subcarpeta específica del ticket.
 * Crea la carpeta si no existe.
 */
const getTicketFolder = (ticketId) => {
    const folder = ticketId
        ? path.join(BASE_PATH, String(ticketId))
        : path.join(BASE_PATH, 'temp');

    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
    return folder;
};

/**
 * Mueve los archivos de la carpeta temp al directorio definitivo del ticket.
 * Útil después de crear un ticket nuevo (el ID no existía al momento del upload).
 */
const moverArchivosATicket = (files, ticketId) => {
    if (!files || files.length === 0) return [];
    const destFolder = getTicketFolder(ticketId);
    const nuevosPaths = [];

    for (const file of files) {
        const origen = file.path;
        const destino = path.join(destFolder, file.filename);
        fs.renameSync(origen, destino);
        nuevosPaths.push({ ...file, path: destino });
    }

    // Eliminar carpeta temp si quedó vacía
    const tempFolder = path.join(BASE_PATH, 'temp');
    try {
        const remaining = fs.readdirSync(tempFolder);
        if (remaining.length === 0) fs.rmdirSync(tempFolder);
    } catch (_) {}

    return nuevosPaths;
};

// Storage dinámico: si req.params.id existe usamos esa carpeta, si no, temp.
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const ticketId = req.params.id || null;
        cb(null, getTicketFolder(ticketId));
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    },
});

const uploadTickets = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max por archivo
});

module.exports = { uploadTickets, getTicketFolder, moverArchivosATicket };
