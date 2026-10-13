// SIN USO (13/10): el front no llama a /api/chat (ver controllers/chatController.js). Confirmar con Yoania si se usa o se borra. Ver docs/auditoria-limpieza-2026-10-09.md.
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { verifyToken } = require('../middleware/authMiddleware'); // Opcional si queremos protegerlo

// POST /api/chat
// Protegido por token para saber quién pregunta

// Ruta normal del Chat
router.post('/', verifyToken, chatController.handleChatMessage);

// Ruta de diagnóstico (Sin token para facilitar prueba rápida en navegador)
router.get('/test-gemini', chatController.testGeminiConnection);

module.exports = router;
