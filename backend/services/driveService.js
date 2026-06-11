const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const logger = require('../utils/logger');

// Rutas de archivos
const OAUTH_PATH = path.join(__dirname, '../oauth-credentials.json');
const TOKEN_PATH = path.join(__dirname, '../token.json');

let oauth2Client = null;

/**
 * Inicializa el cliente OAuth2
 */
const initOAuth = () => {
    if (!fs.existsSync(OAUTH_PATH)) {
        logger.error("❌ [DriveService] Falta oauth-credentials.json en el backend.");
        return null;
    }

    try {
        const content = fs.readFileSync(OAUTH_PATH);
        const credentials = JSON.parse(content);
        const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

        oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

        // Cargar token si ya existe
        if (fs.existsSync(TOKEN_PATH)) {
            const token = fs.readFileSync(TOKEN_PATH);
            oauth2Client.setCredentials(JSON.parse(token));
            logger.info("✅ [DriveService] Sesión de usuario cargada (token.json).");
        } else {
            logger.warn("⚠️ [DriveService] No hay sesión iniciada. Visita el link de autorización.");
        }
        return oauth2Client;
    } catch (e) {
        logger.error("❌ [DriveService] Error inicializando OAuth:", e);
        return null;
    }
};

oauth2Client = initOAuth();
const drive = google.drive({ version: 'v3', auth: oauth2Client });

const DRIVE_PARENT_ID = process.env.GOOGLE_DRIVE_PARENT_ID || null;
const folderCache = {};

/**
 * Genera la URL para que el usuario autorice la cuenta
 */
exports.getAuthUrl = () => {
    if (!oauth2Client) oauth2Client = initOAuth();
    if (!oauth2Client) return null;

    logger.info("🔗 [OAuth] Generating URL with redirect_uri:", oauth2Client.redirectUri);
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/drive.file'
        ],
        prompt: 'consent' // Forzar refreshtoken
    });
};

/**
 * Guarda el token recibido tras la autorización
 */
exports.saveToken = async (code) => {
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        logger.info("✅ [DriveService] Token guardado correctamente en token.json.");
        return true;
    } catch (e) {
        logger.error("❌ Error guardando token:", e);
        return false;
    }
};

const getOrCreateFolder = async (folderName, parentId = null, retries = 3) => {
    const effectiveParentId = parentId || DRIVE_PARENT_ID;
    const cacheKey = folderName + (effectiveParentId || 'root');
    if (folderCache[cacheKey]) return folderCache[cacheKey];

    try {
        let q = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        if (effectiveParentId) q += ` and '${effectiveParentId}' in parents`;

        // Pequeño delay si es un reintento por red
        if (retries < 3) await new Promise(r => setTimeout(r, 1000));

        const res = await drive.files.list({
            q, fields: 'files(id, name)',
            supportsAllDrives: true, includeItemsFromAllDrives: true
        });
        const folders = res.data.files;
        if (folders.length > 0) {
            folderCache[cacheKey] = folders[0].id;
            return folders[0].id;
        }

        const folder = await drive.files.create({
            resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: effectiveParentId ? [effectiveParentId] : [] },
            fields: 'id', supportsAllDrives: true
        });
        folderCache[cacheKey] = folder.data.id;
        return folder.data.id;
    } catch (error) {
        // Reintentar si es error de red (ECONNRESET, ETIMEDOUT, etc)
        if (retries > 0 && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.message.includes('socket'))) {
            logger.warn(`⚠️ [DriveService] Error de red en getOrCreateFolder (${folderName}). Reintentando... (${retries} restantes)`);
            return getOrCreateFolder(folderName, parentId, retries - 1);
        }
        throw error;
    }
};

exports.getFileStream = async (fileId) => {
    if (!fs.existsSync(TOKEN_PATH)) throw new Error("Requiere autorización.");
    try {
        // 1. Obtener Metadatos (Nombre y MimeType real)
        const metaResponse = await drive.files.get({
            fileId: fileId,
            fields: 'name, mimeType, size',
            supportsAllDrives: true
        });

        // 2. Obtener Stream
        const response = await drive.files.get(
            { fileId: fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream' }
        );

        return {
            stream: response.data,
            mimeType: metaResponse.data.mimeType || response.headers['content-type'],
            name: metaResponse.data.name,
            size: metaResponse.data.size
        };
    } catch (error) {
        logger.error("Error getFileStream:", error);
        throw error;
    }
};

exports.uploadToDrive = async (fileInput, fileName, areaName, retries = 2) => {

    // Validar autorización
    // Nota: Es mejor cachear el cliente, pero por seguridad chequeamos token.json
    // OJO: Si oauth2Client no está inicializado, initOAuth() debe llamarse o usarse el global.
    // El código actual usa 'drive' global que ya tiene auth. 
    // fs.existsSync(TOKEN_PATH) es un check algo rústico pero funcional por ahora.

    try {
        const rootFolderId = await getOrCreateFolder('PEDIDOS WEB'); // Estandarizamos mayúsculas
        const areaFolderId = await getOrCreateFolder(areaName || 'GENERAL', rootFolderId);

        let mediaBody;
        let mimeType = 'application/octet-stream';

        if (Buffer.isBuffer(fileInput)) {
            // --- FLUJO BUFFER (memoryStorage) ---
            mediaBody = Readable.from(fileInput);
        } else if (fileInput && typeof fileInput.pipe === 'function') {
            // --- FLUJO STREAM (diskStorage / ReadStream) ---
            mediaBody = fileInput;
        } else if (typeof fileInput === 'string') {

            // --- FLUJO BASE64 (LEGACY) ---
            const cleanData = fileInput.trim();

            if (cleanData.startsWith('data:')) {
                const matches = cleanData.match(/^data:([^;]+);base64,(.+)$/s);
                if (matches && matches.length === 3) {
                    mimeType = matches[1];
                    const pureBase64 = matches[2].replace(/\s/g, '');
                    mediaBody = Readable.from(Buffer.from(pureBase64, 'base64'));
                } else {
                    throw new Error('Formato Base64 inválido');
                }
            } else {
                // Raw Base64
                mediaBody = Readable.from(Buffer.from(cleanData, 'base64'));
            }
        } else {
            throw new Error("Tipo de archivo no soportado para subida (ni Buffer ni String)");
        }

        const file = await drive.files.create({
            resource: {
                name: fileName,
                parents: [areaFolderId]
            },
            media: {
                mimeType: mimeType,
                body: mediaBody
            },
            fields: 'id, webViewLink, webContentLink',
            supportsAllDrives: true
        });

        logger.info(`✅ [Drive] Archivo subido: ${fileName} -> ${file.data.webViewLink}`);
        return file.data.webViewLink;

    } catch (error) {
        // Reintentos automáticos para errores de red
        if (retries > 0 && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.message.includes('socket'))) {
            logger.warn(`⚠️ [DriveService] Error de red. Reintentando subida de ${fileName}... (${retries})`);
            // Esperar un poco antes de reintentar
            await new Promise(r => setTimeout(r, 1500));
            return exports.uploadToDrive(fileInput, fileName, areaName, retries - 1);
        }
        logger.error(`❌ [DriveService] Error subiendo ${fileName}:`, error.message);
        throw error;
    }
};
