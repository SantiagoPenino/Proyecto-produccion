const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'oauth-credentials.json');
const TOKEN_PATH       = path.join(__dirname, '..', 'token.json');

// Spreadsheet de clientes
// 15/07/2026: migrado a la planilla NUEVA ("BASE DE DATOS CLIENTES REGISTRADOS NUEVA").
// La vieja (1rgjR09Y8M9DQ0oOaGAipxwSnsrykCvkOPL2XlK-c4OY) se agotó el historial de versiones.
// La hoja 'Respuestas de formulario 5' conserva la misma estructura de columnas (ver COL abajo).
const SPREADSHEET_ID = '1likGD_Zuu-pQMFpDlw7TNCx39VZ7_0P9x6RGFTc__IQ';
const SHEET_NAME      = 'Respuestas de formulario 5';

// Scopes requeridos
const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
];

// Columnas de la hoja (índice 0-based)
// A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9, K=10, L=11, M=12, N=13
const COL = {
    IDCliente:      3,   // D
    Nombre:         4,   // E
    Telefono:       5,   // F
    Email:          6,   // G
    Empresa:        7,   // H  (Empresa o marca)
    CioRuc:         8,   // I
    Departamento:   9,   // J
    Localidad:      10,  // K
    FormaEnvio:     11,  // L  (Tipo de retiro)
    Direccion:      12,  // M
    IDReact:        13,  // N
};

// ── Auth ─────────────────────────────────────────────────────────────────────

function getOAuth2Client() {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    // Soporta tipo "installed" (Escritorio) y "web" (Aplicación web)
    const cfg = creds.installed || creds.web;
    if (!cfg) throw new Error('oauth-credentials.json inválido: falta clave "installed" o "web"');
    const { client_id, client_secret } = cfg;
    const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/google/auth/callback';
    return new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
}

/**
 * Devuelve el OAuth2 client con el token cargado.
 * Lanza error si no hay token válido con scope spreadsheets.
 */
async function getAuthClient() {
    const oAuth2Client = getOAuth2Client();
    if (!fs.existsSync(TOKEN_PATH)) {
        throw new Error('NO_TOKEN: Debe autorizar el acceso a Google Sheets primero.');
    }
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);

    // Refrescar si expiró
    if (token.expiry_date && Date.now() > token.expiry_date - 60000) {
        const { credentials } = await oAuth2Client.refreshAccessToken();
        oAuth2Client.setCredentials(credentials);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 4));
    }

    // Verificar que tiene scope de spreadsheets
    const scope = token.scope || '';
    if (!scope.includes('spreadsheets')) {
        throw new Error('NO_SHEETS_SCOPE: El token no tiene permisos de Sheets. Reautoriza desde /google/auth');
    }

    return oAuth2Client;
}

/**
 * Genera la URL de autorización para que el usuario la abra en el navegador.
 */
function getAuthUrl() {
    const oAuth2Client = getOAuth2Client();
    return oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
    });
}

/**
 * Intercambia el code de autorización por tokens y los guarda en token.json.
 */
async function saveTokenFromCode(code) {
    const oAuth2Client = getOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 4));
    return tokens;
}

// ── Operaciones de Sheets ────────────────────────────────────────────────────

/**
 * Lee todas las filas de la hoja de clientes.
 * Devuelve array de objetos mapeados.
 */
async function getAllRows() {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A:P`,
    });

    const rows = res.data.values || [];
    // Ignorar fila 0 (encabezados del formulario)
    return rows.slice(1).map((row, idx) => mapRow(row, idx + 2)); // +2 porque slice(1) + 1-indexed
}

/**
 * Busca una fila por IDReact (col N).
 * Devuelve { rowData, rowIndex } o null.
 */
async function findRowByIDReact(idReact) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A:P`,
    });

    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cellIDReact = (row[COL.IDReact] || '').trim();
        if (String(cellIDReact) === String(idReact).trim()) {
            return { rowData: mapRow(row, i + 1), rowIndex: i + 1, rawRow: row };
        }
    }
    return null;
}

/**
 * Actualiza campos de una fila en la hoja (por rowIndex, 1-based).
 */
async function updateRow(rowIndex, data) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const updates = [];

    const fieldMap = {
        IDCliente:    COL.IDCliente,
        Nombre:       COL.Nombre,
        Telefono:     COL.Telefono,
        TelefonoTrabajo: COL.Telefono,
        Email:        COL.Email,
        Empresa:      COL.Empresa,
        CioRuc:       COL.CioRuc,
        Departamento: COL.Departamento,
        Localidad:    COL.Localidad,
        FormaEnvio:   COL.FormaEnvio,
        Direccion:    COL.Direccion,
    };

    for (const [field, colIdx] of Object.entries(fieldMap)) {
        if (data[field] !== undefined) {
            const colLetter = colIndexToLetter(colIdx);
            updates.push({
                range: `'${SHEET_NAME}'!${colLetter}${rowIndex}`,
                values: [[data[field] ?? '']],
            });
        }
    }

    if (updates.length === 0) return { updated: 0 };

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updates,
        },
    });

    return { updated: updates.length };
}

/**
 * Inserta un cliente nuevo como fila al final de la hoja (API directa).
 * Reemplaza el insertarClienteEnGoogle del Apps Script. Mapea a las columnas A–N;
 * A/B/C (Marca temporal, correo de Forms, Puntuación) quedan vacías, igual que los
 * registros que ya venía cargando el sistema.
 */
async function insertarCliente(cliente) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const fila = new Array(COL.IDReact + 1).fill('');
    fila[COL.IDCliente]    = cliente.idCliente  || '';
    fila[COL.Nombre]       = cliente.nombre     || '';
    fila[COL.Telefono]     = cliente.telefono   || '';
    fila[COL.Email]        = cliente.email      || '';
    fila[COL.Empresa]      = cliente.empresa    || '';
    fila[COL.CioRuc]       = cliente.doc        || '';
    fila[COL.Departamento] = cliente.depto      || '';
    fila[COL.Localidad]    = cliente.localidad  || '';
    fila[COL.FormaEnvio]   = cliente.tipoRetiro || '';
    fila[COL.Direccion]    = cliente.direccion  || '';
    fila[COL.IDReact]      = cliente.idReact != null ? String(cliente.idReact) : '';

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A:N`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [fila] },
    });

    return { ok: true };
}

/**
 * Actualiza un cliente existente buscándolo por IDReact (col N).
 * Reemplaza el actualizarClienteEnGoogle del Apps Script. Acepta las mismas claves
 * (lowercase) que enviaba el backend y las traduce al fieldMap de updateRow.
 */
async function actualizarCliente(idReact, nuevosDatos = {}) {
    if (!idReact) return { ok: false, error: 'idReact vacío' };
    const found = await findRowByIDReact(idReact);
    if (!found) return { ok: false, error: 'Cliente no encontrado en la planilla' };

    const traduccion = {
        nombre:     'Nombre',
        telefono:   'Telefono',
        empresa:    'Empresa',
        direccion:  'Direccion',
        doc:        'CioRuc',
        depto:      'Departamento',
        localidad:  'Localidad',
        tipoRetiro: 'FormaEnvio',
    };
    const data = {};
    for (const [k, v] of Object.entries(nuevosDatos)) {
        if (traduccion[k] && v !== undefined) data[traduccion[k]] = v;
    }
    if (Object.keys(data).length === 0) return { ok: true, updated: 0 };

    const res = await updateRow(found.rowIndex, data);
    return { ok: true, ...res };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapRow(row, sheetRowNumber) {
    return {
        _sheetRow:    sheetRowNumber,
        IDCliente:    (row[COL.IDCliente]   || '').trim(),
        Nombre:       (row[COL.Nombre]       || '').trim(),
        Telefono:     (row[COL.Telefono]     || '').trim(),
        Email:        (row[COL.Email]        || '').trim(),
        CioRuc:       (row[COL.CioRuc]       || '').trim(),
        Departamento: (row[COL.Departamento] || '').trim(),
        Localidad:    (row[COL.Localidad]    || '').trim(),
        FormaEnvio:   (row[COL.FormaEnvio]   || '').trim(),
        IDReact:      (row[COL.IDReact]      || '').trim(),
    };
}

function colIndexToLetter(idx) {
    // 0→A, 1→B, ..., 25→Z, 26→AA ...
    let letter = '';
    let n = idx;
    while (n >= 0) {
        letter = String.fromCharCode((n % 26) + 65) + letter;
        n = Math.floor(n / 26) - 1;
    }
    return letter;
}

module.exports = {
    getAuthUrl,
    saveTokenFromCode,
    getAllRows,
    findRowByIDReact,
    updateRow,
    insertarCliente,
    actualizarCliente,
    SPREADSHEET_ID,
    SHEET_NAME,
};
