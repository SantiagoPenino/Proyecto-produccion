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

/**
 * Obtiene la URL de thumbnail de un archivo en Drive usando la API autenticada.
 * Funciona para PDFs grandes, imágenes, y cualquier tipo soportado por Drive.
 * Returns null si Drive no puede generar thumbnail para ese archivo.
 */
exports.getThumbnailUrl = async (fileId) => {
    try {
        const res = await drive.files.get({
            fileId: fileId,
            fields: 'thumbnailLink, mimeType',
            supportsAllDrives: true
        });
        return res.data.thumbnailLink || null;
    } catch (error) {
        logger.warn(`[DriveService] No se pudo obtener thumbnail para ${fileId}:`, error.message);
        return null;
    }
};

// Estado HTTP de un error de googleapis/gaxios, o null si no hubo respuesta (corte de red)
const estadoHttp = (error) => {
    const n = Number(error?.response?.status ?? error?.status ?? error?.code);
    return Number.isInteger(n) && n >= 100 && n < 600 ? n : null;
};
const esPaginaHtml = (texto) => /^\s*<(!doctype html|html)/i.test(String(texto || ''));

// El error de Google en una línea: el estado HTTP y el motivo, sin la página HTML entera que devuelve
// Drive cuando falla de su lado (06/10/2026: el log y el portal recibían el HTML como mensaje).
exports.resumenError = (error) => {
    const estado = estadoHttp(error);
    let texto = String(error?.message || error || '').trim();
    if (esPaginaHtml(texto)) {
        const titulo = (texto.match(/<title>([^<]*)<\/title>/i) || [])[1];
        texto = `Google devolvió una página de error${titulo ? ` («${titulo.trim()}»)` : ''}`;
    }
    texto = texto.replace(/\s+/g, ' ').slice(0, 300);
    return estado ? `HTTP ${estado} · ${texto}` : texto;
};

// Lo que se sube, listo para otro intento: un Buffer o un texto se reusan; un stream de un archivo se
// vuelve a abrir, porque el intento que falló ya lo leyó. Un stream que no sale de un archivo no se
// puede repetir: null (no se reintenta).
const rearmarEntrada = (fileInput) => {
    if (Buffer.isBuffer(fileInput) || typeof fileInput === 'string') return fileInput;
    if (fileInput && typeof fileInput.pipe === 'function' && typeof fileInput.path === 'string' && fs.existsSync(fileInput.path)) {
        try { if (typeof fileInput.destroy === 'function') fileInput.destroy(); } catch (_) { /* ya estaba cerrado */ }
        return fs.createReadStream(fileInput.path);
    }
    return null;
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

        // Hacer el archivo públicamente visible (cualquier persona con el link puede ver)
        try {
            await drive.permissions.create({
                fileId: file.data.id,
                supportsAllDrives: true,
                requestBody: {
                    role: 'reader',
                    type: 'anyone'
                }
            });
        } catch (permErr) {
            logger.warn(`⚠️ [Drive] No se pudo hacer público el archivo ${fileName}: ${permErr.message}`);
        }

        logger.info(`✅ [Drive] Archivo subido: ${fileName} -> ${file.data.webViewLink}`);
        return file.data.webViewLink;


    } catch (error) {
        // Reintentos automáticos: cortes de red y fallas del lado de Google (5xx, 429, o una página HTML
        // en vez de la respuesta de la API, como DTF-31473 el 06/10/2026).
        const estado = estadoHttp(error);
        const deRed = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || String(error.message || '').includes('socket');
        const deGoogle = (estado >= 500 && estado < 600) || estado === 429 || esPaginaHtml(error.message);
        if (retries > 0 && (deRed || deGoogle)) {
            // Un stream ya se leyó en el intento que falló: se vuelve a abrir el archivo. Antes se
            // reintentaba con el mismo stream y Drive recibía un archivo vacío o cortado.
            const deNuevo = rearmarEntrada(fileInput);
            if (deNuevo) {
                const espera = deGoogle ? 3000 : 1500;
                logger.warn(`⚠️ [DriveService] ${deGoogle ? 'Google falló' : 'Error de red'} subiendo ${fileName} (${exports.resumenError(error)}). Reintento en ${espera / 1000} s (quedan ${retries}).`);
                await new Promise(r => setTimeout(r, espera));
                return exports.uploadToDrive(deNuevo, fileName, areaName, retries - 1);
            }
        }
        logger.error(`❌ [DriveService] Error subiendo ${fileName}: ${exports.resumenError(error)}`);
        throw error;
    }
};

// [TIZADA PRO] Copia un archivo que ya está en Drive (ej. la tizada que dejó TIZADA PRO en su carpeta)
// a PEDIDOS WEB/<área> con otro nombre, sin bajarlo ni volver a subirlo. Requiere que nuestra cuenta de
// Google pueda leer el original (misma cuenta, o carpeta compartida). Devuelve { id, url, bytes }.
exports.copyFile = async (fileId, newName, areaName) => {
    const rootFolderId = await getOrCreateFolder('PEDIDOS WEB');
    const areaFolderId = await getOrCreateFolder(areaName || 'GENERAL', rootFolderId);
    const r = await drive.files.copy({
        fileId, supportsAllDrives: true, fields: 'id, webViewLink, size',
        requestBody: { name: newName, parents: [areaFolderId] },
    });
    try {
        await drive.permissions.create({ fileId: r.data.id, supportsAllDrives: true, requestBody: { role: 'reader', type: 'anyone' } });
    } catch (permErr) {
        logger.warn(`⚠️ [Drive] No se pudo hacer pública la copia ${newName}: ${permErr.message}`);
    }
    logger.info(`✅ [Drive] Copiado ${fileId} -> ${newName}`);
    return { id: r.data.id, url: r.data.webViewLink, bytes: r.data.size ? Number(r.data.size) : null };
};
