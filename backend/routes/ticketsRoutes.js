const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ticketsController = require('../controllers/ticketsController');
const { verifyToken } = require('../middleware/authMiddleware');
const { uploadTickets, getTicketFolder } = require('../middleware/multerTicketsConfig');

// Todo el módulo de tickets es privado (ya sea web_client o admin)
router.use(verifyToken);

// ─────────────────────────────────────────────────────────────────────────────
// SERVIR ADJUNTOS DE TICKETS (autenticado)
// ─────────────────────────────────────────────────────────────────────────────
// GET /tickets/adjunto/:ticketId/:filename
router.get('/adjunto/:ticketId/:filename', (req, res) => {
    const filename = path.basename(req.params.filename); // Sanitizar
    const ticketFolder = getTicketFolder(req.params.ticketId);
    const filePath = path.join(ticketFolder, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Adjunto no encontrado.' });
    }

    res.sendFile(filePath);
});

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS COMPARTIDAS (Web Client y Admins)
// ─────────────────────────────────────────────────────────────────────────────
// Obtener lista de departamentos habilitados (el controlador filtra según rol)
router.get('/categorias', ticketsController.getCategorias);

// Obtener detalles de un ticket específico
router.get('/:id', ticketsController.getTicketDetails);

// Responder a un ticket (enviar mensaje) -> req.files.evidencia opcional
// Admins pueden enviar esNotaInterna en el body.
router.post('/:id/responder', uploadTickets.array('evidencia', 5), ticketsController.replyToTicket);

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS CLIENTES WEB 
// ─────────────────────────────────────────────────────────────────────────────
// Obtener todos mis tickets (El controlador filtra CliId = userId si el rol es WEB_CLIENT)
router.get('/', ticketsController.getTickets);

// Crear nuevo ticket
router.post('/', uploadTickets.array('evidencia', 5), ticketsController.createTicket);

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS ADICIONALES ADMINS
// ─────────────────────────────────────────────────────────────────────────────
// Actualizar estado o derivar (Resolver, Cerrar)
router.put('/:id/estado', ticketsController.updateTicketStatus);

module.exports = router;
