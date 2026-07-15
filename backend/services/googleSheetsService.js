// googleSheetsService.js
// Sincronización fire-and-forget con Google Sheets vía Apps Script.
// La API key se lee desde process.env.INTEGRATION_API_KEY (nunca hardcodeada).

const logger = require('../utils/logger');

const SCRIPT_ID = 'AKfycbxwGN0blqb4Loka9nHgYHf83eM33d5fJ7o1Ugo4qbiV81VClM6RcK9S_pjwnauq6y8i';
const BASE_URL  = `https://script.google.com/macros/s/${SCRIPT_ID}/exec`;

/**
 * Inserta un cliente nuevo en la planilla de Google Sheets.
 * Se llama después de un registro exitoso en la DB local.
 * @param {Object} cliente
 */
const insertarClienteEnGoogle = async (cliente) => {
    const apiKey = process.env.INTEGRATION_API_KEY;
    if (!apiKey) {
        logger.warn('[GoogleSheets] INTEGRATION_API_KEY no definida. Se omite inserción.');
        return;
    }

    const params = new URLSearchParams({
        apiKey,
        action:     'insertarCliente',
        idCliente:  cliente.idCliente  || '',
        nombre:     cliente.nombre     || '',
        telefono:   cliente.telefono   || '',
        email:      cliente.email      || '',
        empresa:    cliente.empresa    || '',
        doc:        cliente.doc        || '',
        depto:      cliente.depto      || '',
        localidad:  cliente.localidad  || '',
        tipoRetiro: cliente.tipoRetiro || '',
        direccion:  cliente.direccion  || '',
        idReact:    cliente.idReact    || '',
    });

    const url = `${BASE_URL}?${params.toString()}`;

    const response = await fetch(url);
    const raw = await response.text();

    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        // El Apps Script no devolvió JSON (típico: HTML de login/permisos o un redirect cuando el
        // deployment no es "cualquiera puede acceder", o la URL/versión cambió). Se ve en el crudo.
        logger.warn(`[GoogleSheets] Respuesta NO-JSON al insertar cliente. HTTP ${response.status} — ${raw.slice(0, 300)}`);
        return { ok: false, error: 'Respuesta no-JSON del Apps Script' };
    }

    if (data.ok) {
        logger.info('[GoogleSheets] Cliente insertado:', data.mensaje);
    } else {
        // data.error suele venir vacío; volcamos la respuesta completa + el status para ver la causa real.
        logger.warn(`[GoogleSheets] Error al insertar cliente. HTTP ${response.status} — respuesta: ${JSON.stringify(data)}`);
    }

    return data;
};

/**
 * Actualiza un cliente existente en la planilla de Google Sheets.
 * Se llama después de un updateProfile exitoso.
 * @param {string|number} idReact  - IDReact del cliente (clave de búsqueda en Sheets)
 * @param {Object}        nuevosDatos - Campos a modificar
 */
const actualizarClienteEnGoogle = async (idReact, nuevosDatos) => {
    const apiKey = process.env.INTEGRATION_API_KEY;
    if (!apiKey) {
        logger.warn('[GoogleSheets] INTEGRATION_API_KEY no definida. Se omite actualización.');
        return;
    }

    if (!idReact) {
        logger.warn('[GoogleSheets] idReact vacío, no se puede actualizar en Sheets.');
        return;
    }

    const params = new URLSearchParams({
        apiKey,
        action:  'actualizarCliente',
        idReact: String(idReact),
        ...nuevosDatos,
    });

    const url = `${BASE_URL}?${params.toString()}`;

    const response = await fetch(url);
    const data     = await response.json();

    if (data.ok) {
        logger.info('[GoogleSheets] Cliente actualizado:', data.mensaje);
    } else {
        logger.warn('[GoogleSheets] Error al actualizar cliente:', data.error);
    }

    return data;
};

module.exports = { insertarClienteEnGoogle, actualizarClienteEnGoogle };
