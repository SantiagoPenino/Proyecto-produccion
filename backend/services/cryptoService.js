/**
 * cryptoService.js
 * ----------------------------------------------------------------------------
 * PROPÓSITO
 *   Cifrar/descifrar contraseñas de SISNET que se almacenan en SQL Server
 *   (columna varchar(255)). Usa exclusivamente el módulo nativo `crypto`
 *   de Node.js — NO agrega dependencias npm.
 *
 * ALGORITMO
 *   AES-256-GCM (cifrado autenticado: confidencialidad + integridad vía authTag).
 *
 * CLAVE (process.env.SISNET_ENC_KEY)
 *   - Si el valor son 64 caracteres hexadecimales => se usa tal cual como
 *     clave de 32 bytes: Buffer.from(key, 'hex').
 *   - En cualquier otro caso => se deriva una clave de 32 bytes con
 *     crypto.scryptSync(key, 'user-macrosoft-multiempresa', 32).
 *
 * FORMATO DEL PAYLOAD (string almacenado en la BD)
 *   'v1:' + base64(iv) + ':' + base64(authTag) + ':' + base64(ciphertext)
 *     - v1        -> versión/prefijo del esquema (permite migraciones futuras).
 *     - iv        -> vector de inicialización aleatorio de 12 bytes.
 *     - authTag   -> tag de autenticación GCM de 16 bytes.
 *     - ciphertext-> texto cifrado.
 *   Total del prefijo/estructura holgadamente por debajo de varchar(255) para
 *   contraseñas de longitud típica.
 *
 * TOLERANCIA A VALORES LEGADOS / EN MIGRACIÓN
 *   decrypt() devuelve el valor SIN CAMBIOS si no comienza con 'v1:', de modo
 *   que las contraseñas antiguas en texto plano siguen funcionando mientras se
 *   migran gradualmente.
 *
 * FALLBACK INSEGURO
 *   Si process.env.SISNET_ENC_KEY NO está configurada, se emite UNA sola
 *   advertencia con logger.warn y tanto encrypt() como decrypt() devuelven el
 *   valor SIN MODIFICAR (texto plano). Esto es INSEGURO y existe únicamente
 *   para que la aplicación pueda arrancar; debe corregirse configurando la
 *   variable de entorno en producción.
 *
 * VARIABLE DE ENTORNO REQUERIDA
 *   SISNET_ENC_KEY  (recomendado: 64 hex chars => 32 bytes)
 *     Generar con:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * ----------------------------------------------------------------------------
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;            // 12 bytes recomendado para GCM
const KEY_LENGTH = 32;           // 32 bytes = AES-256
const SCRYPT_SALT = 'user-macrosoft-multiempresa';
const VERSION_PREFIX = 'v1:';

// Bandera para emitir la advertencia de fallback inseguro una sola vez.
let insecureWarningEmitted = false;

/**
 * Verifica si un string es exactamente 64 caracteres hexadecimales.
 * @param {string} value
 * @returns {boolean}
 */
function isHex64(value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Resuelve la clave de 32 bytes a partir de process.env.SISNET_ENC_KEY.
 * @returns {Buffer|null} Buffer de 32 bytes, o null si la variable no está configurada.
 */
function resolveKey() {
    const rawKey = process.env.SISNET_ENC_KEY;

    // Sin clave => se activa el fallback inseguro (texto plano).
    if (rawKey === undefined || rawKey === null || rawKey === '') {
        if (!insecureWarningEmitted) {
            logger.warn('[cryptoService] SISNET_ENC_KEY no configurada — usando fallback INSEGURO (texto plano)');
            insecureWarningEmitted = true;
        }
        return null;
    }

    if (isHex64(rawKey)) {
        return Buffer.from(rawKey, 'hex');
    }

    // Derivación determinística de 32 bytes a partir de una passphrase arbitraria.
    return crypto.scryptSync(rawKey, SCRYPT_SALT, KEY_LENGTH);
}

/**
 * Cifra un texto plano y devuelve el payload versionado.
 *
 * @param {string|null|undefined} plaintext - Contraseña en texto plano.
 * @returns {string|null}
 *   - null si plaintext es null/undefined/''.
 *   - El valor SIN MODIFICAR si SISNET_ENC_KEY no está configurada (fallback inseguro).
 *   - 'v1:' + base64(iv) + ':' + base64(authTag) + ':' + base64(ciphertext) en caso normal.
 *   - null si ocurre un error inesperado durante el cifrado.
 */
function encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined || plaintext === '') {
        return null;
    }

    try {
        const key = resolveKey();

        // Fallback INSEGURO: sin clave => se devuelve el texto plano tal cual.
        if (key === null) {
            return plaintext;
        }

        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        const ciphertext = Buffer.concat([
            cipher.update(String(plaintext), 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();

        return (
            VERSION_PREFIX +
            iv.toString('base64') + ':' +
            authTag.toString('base64') + ':' +
            ciphertext.toString('base64')
        );
    } catch (err) {
        logger.error(`[cryptoService] Error al cifrar: ${err.message}`);
        return null;
    }
}

/**
 * Descifra un payload versionado y devuelve el texto plano.
 *
 * @param {string|null|undefined} payload - Valor almacenado en la BD.
 * @returns {string|null}
 *   - null si payload es null/undefined/''.
 *   - El valor SIN MODIFICAR si no comienza con 'v1:' (legado/texto plano tolerado).
 *   - El valor SIN MODIFICAR si SISNET_ENC_KEY no está configurada (fallback inseguro).
 *   - El texto plano descifrado en caso normal.
 *   - null si el descifrado o la verificación del authTag fallan.
 */
function decrypt(payload) {
    if (payload === null || payload === undefined || payload === '') {
        return null;
    }

    // Tolerar valores legados o en texto plano durante la migración.
    if (typeof payload !== 'string' || !payload.startsWith(VERSION_PREFIX)) {
        return payload;
    }

    try {
        const key = resolveKey();

        // Fallback INSEGURO: sin clave => se devuelve el valor tal cual.
        if (key === null) {
            return payload;
        }

        // Estructura: 'v1:' + base64(iv) + ':' + base64(authTag) + ':' + base64(ciphertext)
        const body = payload.slice(VERSION_PREFIX.length);
        const parts = body.split(':');
        if (parts.length !== 3) {
            logger.error('[cryptoService] Error al descifrar: formato de payload inválido');
            return null;
        }

        const iv = Buffer.from(parts[0], 'base64');
        const authTag = Buffer.from(parts[1], 'base64');
        const ciphertext = Buffer.from(parts[2], 'base64');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        const plaintext = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);

        return plaintext.toString('utf8');
    } catch (err) {
        // Incluye fallos de verificación del authTag (payload corrupto o clave incorrecta).
        logger.error(`[cryptoService] Error al descifrar: ${err.message}`);
        return null;
    }
}

module.exports = { encrypt, decrypt };
