// SIN USO (13/10): solo lo requiere controllers/chatController.js (sin uso). Ver docs/auditoria-limpieza-2026-10-09.md.
const axios = require('axios');
const logger = require('../utils/logger');

// URL del Webhook de n8n (Ajustar según configuración en n8n)
const N8N_HOST = process.env.N8N_API_URL || 'http://localhost:5678';

// "test" es para cuando ejecutas manualmente en el editor de n8n.
// "production" es para cuando el flujo está activo.
const N8N_WEBHOOK_URL_TEST = `${N8N_HOST}/webhook-test/chat-search`;
const N8N_WEBHOOK_URL_PROD = `${N8N_HOST}/webhook/chat-search`;

// Usamos la de TEST por defecto para desenvolvimento, o la que el usuario prefiera.
const TARGET_URL = N8N_WEBHOOK_URL_TEST;

exports.searchInDrive = async (query) => {
    try {
        logger.info(`📡 [N8N Service] Enviando query a n8n: "${query}"`);

        const response = await axios.post(TARGET_URL, {
            query: query
        }, {
            timeout: 60000 // n8n puede tardar en buscar y leer archivos
        });

        // Esperamos que n8n devuelva algo como: { "results": "Texto consolidado de los archivos..." }
        // O una lista de archivos.

        if (response.data) {
            logger.info(`✅ [N8N Service] Respuesta recibida (${JSON.stringify(response.data).length} chars)`);

            // Si n8n devuelve un texto directo
            if (typeof response.data === 'string') return response.data;

            // Si devuelve objeto JSON con propiedad 'text' o 'output'
            if (response.data.text) return response.data.text;
            if (response.data.output) return response.data.output;

            // Si devuelve un array de archivos
            if (Array.isArray(response.data)) {
                return response.data.map(f => `--- DOC: ${f.name} ---\n${f.content || f.text}`).join('\n\n');
            }

            return JSON.stringify(response.data);
        }

        return null;

    } catch (error) {
        logger.error(`❌ [N8N Service] Error conectando con n8n: ${error.message}`);
        if (error.code === 'ECONNREFUSED') {
            return "ERROR_N8N_OFFLINE"; // Indicar que n8n no está corriendo
        }
        throw error;
    }
};
