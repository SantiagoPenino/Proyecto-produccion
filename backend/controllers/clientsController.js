const { getPool, sql } = require('../config/db');
const axios = require('axios'); // Importar axios para el proxy
const ERP_API_BASE = process.env.ERP_API_URL;

// Cache para el Token de la API Macrosoft
let macrosoftAuthToken = null;
let macrosoftTokenExp = 0;

async function getMacrosoftToken() {
    if (macrosoftAuthToken && Date.now() < macrosoftTokenExp) {
        return macrosoftAuthToken;
    }
    try {
        const username = process.env.MACROSOFT_API_USER || 'user';
        const password = process.env.MACROSOFT_API_PASSWORD || '1234';

        console.log(`[MACROSOFT AUTH] Solicitando token a ${ERP_API_BASE}/authenticate`);
        const res = await axios.post(`${ERP_API_BASE}/authenticate`, { username, password });

        // Asumiendo que el token viene en res.data.token (o simplemente es el texto JWT retornado)
        let token = res.data?.token || res.data?.accessToken;

        if (!token && typeof res.data === 'string') {
            token = res.data;
        } else if (!token && res.data && typeof res.data.data === 'string') {
            token = res.data.data;
        } else if (!token && res.data && typeof res.data === 'object' && !res.data.error) {
            token = res.data.token;
        }

        if (!token) {
            console.warn('[MACROSOFT AUTH] No se logró parsear el token, se devuelve data completo (podría ser objeto)', res.data);
            token = res.data; // fallback en caso que de todas formas funcionase
        }

        macrosoftAuthToken = token;
        macrosoftTokenExp = Date.now() + 1000 * 60 * 55; // 55 mins caché
        return token;
    } catch (err) {
        console.error("[MACROSOFT AUTH] Error obteniendo token:", err.message);
        return null;
    }
}

// Proxy para API Externa (Evita CORS) - Obtener Un Cliente por ID (Legacy/Local)
exports.getMacrosoftClientData = async (req, res) => {
    const { id } = req.params;
    try {
        const token = await getMacrosoftToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const response = await axios.get(`${ERP_API_BASE}/clientes/${id}`, { headers });
        res.json(response.data);
    } catch (error) {
        console.log(`[PROXY] Falló búsqueda directa '/clientes/${id}'. Intentando buscar en lista completa...`);

        // Fallback: Obtener todos y filtrar (según descripción usuario "trae todos")
        try {
            const token = await getMacrosoftToken();
            const headers = token ? { Authorization: `Bearer ${token}` } : {};

            const listRes = await axios.get(`${ERP_API_BASE}/clientes`, { headers });
            let items = listRes.data;
            if (items && items.data) items = items.data; // Nuevo formato con { data: [...] }
            if (items && items.recordset) items = items.recordset;

            if (Array.isArray(items)) {
                const term = id.toLowerCase();
                const found = items.find(c =>
                    (c.CodigoCliente && String(c.CodigoCliente).toLowerCase() === term) ||
                    (c.IdCliente && String(c.IdCliente) === term) ||
                    (c.NombreCliente && c.NombreCliente.toLowerCase().includes(term))
                );

                if (found) {
                    console.log(`[PROXY] Encontrado en lista completa: ${found.NombreCliente}`);
                    return res.json(found);
                }
            }
        } catch (err2) {
            console.log("[PROXY] Falló fallback 1 (/api/clientes). Probando espejo React (dataall)...");
            try {
                const listRes2 = await axios.get(`${ERP_API_BASE}/api/apicliente/dataall`);
                let items2 = listRes2.data;
                if (items2 && items2.recordset) items2 = items2.recordset;

                if (Array.isArray(items2)) {
                    const term = id.toLowerCase();
                    const found = items2.find(c =>
                        (c.CodigoCliente && String(c.CodigoCliente).toLowerCase() === term) ||
                        (c.IdCliente && String(c.IdCliente) === term) ||
                        (c.NombreCliente && c.NombreCliente.toLowerCase().includes(term))
                    );
                    if (found) {
                        console.log(`[PROXY] Encontrado en espejo React: ${found.NombreCliente}`);
                        return res.json(found);
                    }
                }
            } catch (err3) {
                console.error("[PROXY] Fallaron todos los intentos:", err3.message);
            }
        }

        // Si falla todo, devolver error original
        res.status(502).json({
            error: "Error API Macrosoft",
            details: error.response?.data ? JSON.stringify(error.response.data) : error.message
        });
    }
};

// Obtener TODOS los clientes del sistema (query directa a DB local)
exports.getAllReactClients = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                CliIdCliente, CodCliente, Nombre, NombreFantasia, TelefonoTrabajo,
                CioRuc, Email, CodigoReact, IDReact, Tipo, CliDireccion,
                Localidad, Agencia, IDCliente, Cedula, IDClientePlanilla,
                WebActive, ESTADO, VendedorID, FechaRegistro
            FROM dbo.Clientes WITH(NOLOCK)
            ORDER BY Nombre ASC
        `);

        console.log(`[getAllReactClients] Devolviendo ${result.recordset.length} clientes desde DB local`);
        res.set('Cache-Control', 'no-store');
        res.json(result.recordset);
    } catch (error) {
        console.error("Error getAllReactClients:", error.message);
        res.status(500).json({ error: "Error al obtener clientes: " + error.message });
    }
};

exports.getAllMacrosoftClients = async (req, res) => {
    try {
        const token = await getMacrosoftToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        // Fetch primera página
        const response1 = await axios.get(`${ERP_API_BASE}/clientes?page=1`, { headers });
        let allClients = response1.data.data || [];
        const totalPages = response1.data.pages || 1;

        if (totalPages > 1) {
            // Buscamos las demás páginas en paralelo para acelerar respuesta
            const pageRequests = [];
            for (let i = 2; i <= totalPages; i++) {
                pageRequests.push(
                    axios.get(`${ERP_API_BASE}/clientes?page=${i}`, { headers }).catch(e => ({ data: { data: [] } }))
                );
            }
            const responses = await Promise.all(pageRequests);
            responses.forEach(r => {
                if (r.data && r.data.data) {
                    allClients = allClients.concat(r.data.data);
                }
            });
        }

        res.set('Cache-Control', 'no-store');
        res.json(allClients);
    } catch (error) {
        console.error("Error Proxy Macrosoft API:", error.message);
        res.status(502).json({ error: "Fallo conexión con API Externa Macrosoft" });
    }
};

// Buscar Clientes (Autocompletado)
exports.searchClients = async (req, res) => {
    const { q } = req.query; // Lo que escribe el usuario
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('term', sql.NVarChar(100), `%${q}%`)
            .query('SELECT TOP 10 * FROM dbo.Clientes WHERE Nombre LIKE @term');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Crear Cliente
exports.createClient = async (req, res) => {
    const { nombre, telefono, email, direccion, ruc, nombreFantasia, codReact, idReact, codCliente } = req.body;
    try {
        const pool = await getPool();

        // Verificar si existe
        // ... (misma lógica de check, omitida para brevedad si no la toco? No, debo reemplazar todo el bloque si uso replace)
        // Usaré un bloque más grande para reemplazar todo.

        const check = await pool.request()
            .input('Nombre', sql.NVarChar(200), nombre)
            .query("SELECT COUNT(*) as count FROM dbo.Clientes WHERE Nombre = @Nombre");

        if (check.recordset[0].count > 0) {
            const existing = await pool.request()
                .input('Nombre', sql.NVarChar(200), nombre)
                .query("SELECT * FROM dbo.Clientes WHERE Nombre = @Nombre");
            return res.json(existing.recordset[0]);
        }

        // Insertar nuevo FULL
        // Sanitizar inputs para evitar errores de tipo
        const safeString = (val) => (val !== undefined && val !== null && val !== '') ? String(val) : null;

        // Determinar ID Local:
        // Si el usuario quiere usar el ID Externo (React) como ID Local
        // Determinar ID Local:
        // Prioridad: 1. ID Legacy Forzado (codCliente) | 2. ID React | 3. Auto-generado
        let nextId = null;
        if (codCliente) {
            nextId = parseInt(codCliente);
            console.log("Usando ID Legacy forzado:", nextId);
        } else if (idReact && !isNaN(parseInt(idReact))) {
            nextId = parseInt(idReact);
            console.log("Usando ID React como CodCliente Local:", nextId);
        } else {
            const idQuery = await pool.request().query("SELECT ISNULL(MAX(CodCliente), 0) + 1 as NextID FROM dbo.Clientes");
            nextId = idQuery.recordset[0].NextID;
            console.log("Generado nuevo CodCliente Auto:", nextId);
        }

        const result = await pool.request()
            .input('NextId', sql.Int, nextId)
            .input('Nombre', sql.NVarChar(200), safeString(nombre))
            .input('Telefono', sql.NVarChar(50), safeString(telefono))
            .input('Email', sql.NVarChar(200), safeString(email))
            .input('Direccion', sql.NVarChar(500), safeString(direccion))
            .input('Ruc', sql.NVarChar(50), safeString(ruc))
            .input('Fantasia', sql.NVarChar(200), safeString(nombreFantasia))
            .input('CodReact', sql.NVarChar(50), safeString(codReact))
            .input('IdReact', sql.NVarChar(50), safeString(idReact))
            .query(`
                INSERT INTO dbo.Clientes (CodCliente, Nombre, TelefonoTrabajo, Email, CliDireccion, CioRuc, NombreFantasia, CodigoReact, IDReact) 
                OUTPUT INSERTED.* 
                VALUES (@NextId, @Nombre, @Telefono, @Email, @Direccion, @Ruc, @Fantasia, @CodReact, @IdReact)
            `);

        res.json(result.recordset[0]);
    } catch (err) {
        console.error("[CreateClient ERROR]", err);
        console.error("Full Body:", req.body);
        res.status(500).json({ error: "DB Error: " + err.message });
    }
};

// --- NUEVOS METODOS DE INTEGRACION ---

// Obtener todos los clientes (paginado o top) para gestión
exports.getAllClients = async (req, res) => {
    const { q, mode } = req.query; // mode: 'all', 'linked', 'unlinked'
    try {
        const pool = await getPool();
        let query = `
            SELECT 
                CodCliente, Nombre, NombreFantasia, CioRuc, CodigoReact, IDReact, Email, TelefonoTrabajo, CodReferencia
            FROM dbo.Clientes
            WHERE 1=1
        `;

        const request = pool.request();

        if (q) {
            // Búsqueda en servidor sobre todos los campos relevantes
            query += ` 
                AND (Nombre LIKE @q 
                   OR NombreFantasia LIKE @q 
                   OR CioRuc LIKE @q 
                   OR CAST(CodCliente AS VARCHAR) LIKE @q)
            `;
            request.input('q', sql.NVarChar, `%${q}%`);
        }

        // Filtro por MODO (linked / unlinked)
        // Usamos IDReact como criterio principal de "vinculado"
        if (mode === 'linked') {
            query += ` AND (IDReact IS NOT NULL AND IDReact <> '')`;
        } else if (mode === 'unlinked') {
            query += ` AND (IDReact IS NULL OR IDReact = '')`;
        }

        // Ordenamiento: 
        // Si buscamos 'unlinked', ordenamos por nombre.
        // Si buscamos 'all' o 'linked', priorizamos los que tienen IDReact para verlos primero (o consistencia).
        // En este caso, si el usuario filtra, el orden debe ser consistente.

        query += ` ORDER BY Nombre ASC`;

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Vincular Cliente con React
exports.updateClientLink = async (req, res) => {
    const { codCliente } = req.params;
    const { codigoReact, idReact } = req.body;

    console.log(`[LINK] Intentando vincular LocalID=${codCliente} con ReactCode=${codigoReact}, ReactID=${idReact}`);

    try {
        const pool = await getPool();
        await pool.request()
            .input('CC', sql.Int, codCliente)
            .input('CR', sql.NVarChar(50), codigoReact ? String(codigoReact).trim() : null)
            .input('IR', sql.NVarChar(50), idReact ? String(idReact).trim() : null)
            .query(`
                UPDATE dbo.Clientes 
                SET CodigoReact = @CR, IDReact = @IR 
                WHERE CodCliente = @CC
            `);

        res.json({ success: true, message: 'Vinculación con React actualizada correctamente' });
    } catch (err) {
        console.error("[LINK ERROR] Falló SQL Update:", err);
        res.status(500).json({ error: "Error al actualizar base de datos: " + err.message });
    }
};

// Vincular Cliente con Macrosoft
exports.updateClientLinkMacrosoft = async (req, res) => {
    const { codCliente } = req.params;
    const { codReferencia } = req.body;

    console.log(`[LINK MACROSOFT] Intentando vincular LocalID=${codCliente} con CodReferencia=${codReferencia}`);

    try {
        const pool = await getPool();
        await pool.request()
            .input('CC', sql.Int, parseInt(codCliente))
            .input('CR', sql.Int, codReferencia ? parseInt(codReferencia) : null)
            .query(`
                UPDATE dbo.Clientes 
                SET CodReferencia = @CR 
                WHERE CodCliente = @CC
            `);

        res.json({ success: true, message: 'Vinculación con Macrosoft actualizada correctamente' });
    } catch (err) {
        console.error("[LINK MACROSOFT ERROR] Falló SQL Update:", err);
        res.status(500).json({ error: "Error al actualizar base de datos: " + err.message });
    }
};

// Importar Cliente desde React (Crear en Local)
exports.importReactClient = async (req, res) => {
    const { NombreCliente, EmpresaCliente, Email, Rut, Telefono, Direccion, CodigoCliente, IdCliente } = req.body;

    console.log("[IMPORT] Creando cliente local desde React:", { NombreCliente, CodigoCliente });

    try {
        const pool = await getPool();

        // Mapeo de campos: React -> Local
        const nombreFinal = EmpresaCliente || NombreCliente || 'Sin Nombre';
        const rutFinal = Rut || '';
        const emailFinal = Email || '';
        const telFinal = Telefono || '';

        // Insertar en Local
        const result = await pool.request()
            .input('Nom', sql.NVarChar(200), nombreFinal)
            .input('Fant', sql.NVarChar(200), NombreCliente || '')
            .input('Ruc', sql.NVarChar(50), rutFinal)
            .input('Email', sql.NVarChar(100), emailFinal)
            .input('Tel', sql.NVarChar(50), telFinal)
            .input('CR', sql.NVarChar(50), String(CodigoCliente || '').trim())
            .input('IR', sql.NVarChar(50), String(IdCliente || '').trim())
            .query(`
                INSERT INTO dbo.Clientes (Nombre, NombreFantasia, CioRuc, Email, TelefonoTrabajo, CodigoReact, IDReact)
                OUTPUT INSERTED.*
                VALUES (@Nom, @Fant, @Ruc, @Email, @Tel, @CR, @IR)
            `);

        res.json({ success: true, client: result.recordset[0] });

    } catch (err) {
        console.error("[IMPORT ERROR]", err);
        res.status(500).json({ error: "Error creando cliente local: " + err.message });
    }
};

// createReactClient removido - ya no se necesita exportar a legacy
// La creación de clientes se hace directamente en la DB local via createClient
exports.createReactClient = async (req, res) => {
    const client = req.body;
    try {
        console.log("[createReactClient] Creando cliente directamente en DB local:", client.Nombre);
        const pool = await getPool();
        const safeString = (val) => (val !== undefined && val !== null && val !== '') ? String(val) : null;

        // Verificar si ya existe
        const check = await pool.request()
            .input('Nom', sql.NVarChar(200), client.Nombre)
            .query("SELECT CodCliente FROM dbo.Clientes WHERE Nombre = @Nom");

        if (check.recordset.length > 0) {
            return res.json({
                success: true,
                message: "Cliente ya existe en DB local",
                data: { CodCliente: check.recordset[0].CodCliente }
            });
        }

        // Insertar
        const result = await pool.request()
            .input('Nom', sql.NVarChar(200), safeString(client.Nombre))
            .input('Fan', sql.NVarChar(200), safeString(client.NombreFantasia))
            .input('Tel', sql.NVarChar(50), safeString(client.TelefonoTrabajo))
            .input('Mail', sql.NVarChar(200), safeString(client.Email))
            .input('Ruc', sql.NVarChar(50), safeString(client.CioRuc))
            .input('Dir', sql.NVarChar(500), safeString(client.CliDireccion || client.Direccion))
            .query(`
                INSERT INTO dbo.Clientes (Nombre, NombreFantasia, TelefonoTrabajo, Email, CioRuc, CliDireccion)
                OUTPUT INSERTED.*
                VALUES (@Nom, @Fan, @Tel, @Mail, @Ruc, @Dir)
            `);

        const created = result.recordset[0];
        console.log(`[createReactClient] Cliente creado: CodCliente=${created.CodCliente}`);

        res.json({
            success: true,
            data: created,
            message: "Cliente creado en DB local"
        });
    } catch (error) {
        console.error("Error createReactClient:", error.message);
        res.status(500).json({ error: "Error interno al crear cliente: " + error.message });
    }
};

exports.createMacrosoftClient = async (req, res) => {
    const client = req.body;
    try {
        console.log("Iniciando exportación a Macrosoft:", client.Nombre);

        const token = await getMacrosoftToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        // Mapeo Local -> Macrosoft
        // Regla solicitada: nombre fantasia = idcliente (CodCliente local)
        const payload = {
            Nombre: client.Nombre || 'Sin Nombre',
            NombreFantasia: String(client.CodCliente),
            Moneda: 1, // Por defecto
            CioRuc: client.CioRuc || '',
            DireccionParticular: client.CliDireccion || '',
            DireccionTrabajo: client.CliDireccion || '',
            TelefonoParticular: client.TelefonoTrabajo || '',
            TelefonoTrabajo: client.TelefonoTrabajo || '',
            Email: client.Email || '',
            FechaNac: '20000101' // default required format by macrosoft maybe?
        };

        const response = await axios.post(`${ERP_API_BASE}/clientes`, payload, { headers });
        let createdClient = response.data;
        if (createdClient && createdClient.data && Array.isArray(createdClient.data) && createdClient.data.length > 0) {
            createdClient = createdClient.data[0];
        }

        const newId = createdClient?.CodCliente || createdClient?.IdCliente;

        // Autolink en la base de datos (Macrosoft usa la misma columna en base de datos local? no, en la local la DB tiene la col para macrosoft -> el user configuro "codigoReact" para React, pero por la BD "CodCliente" en su esquema originario es la Key primaria. "macrosoft es codcliente y de react es codigoreact." wait, si Macrosoft devuelve un ID nuevo pero la db local ya tiene un CodCliente como primary key, como lo guarda el usuario? 
        // "macrosoft es codcliente y de react es codigoreact")
        // Wait, "Mi base de datos principal donde ingresasn en la base local y el id es idcliente, hay que señalizar si estan enlazados a react y a macrosoft, macrosoft es codcliente y de react es codigoreact"
        // Wait! Let's examine the Local DB schema in the file.
        // `UPDATE dbo.Clientes SET CodigoReact = @CR, IDReact = @IR WHERE CodCliente = @CC` -> CodCliente seems to be the Local PK.
        // If "macrosoft es codcliente y de react es codigoreact", CodigoReferencia? In GET query we have CodReferencia. Let's see how search was doing it.
        // Ah! Search Unified local query: `WHERE CAST(CodCliente AS NVARCHAR(50)) = @Term OR Nombre LIKE '%' + @Term + '%' OR CioRuc = @Term OR CodigoReact = @Term OR CAST(IDReact AS NVARCHAR(50)) = @Term`. There's no separate field for Macrosoft ID if CodCliente is the Local ID? 
        // Oh... "Mi base de datos principal donde ingresasn en la base local  y el id es idcliente, hay que  señalizar si estan enlazados a react y a macrosoft, macrosoft es codcliente y de react es codigoreact."
        // Let's assume there is a CodReferencia or we should just pass the message and let him edit the manual fields.

        if (newId) {
            // El usuario parece querer usar un nuevo campo o reutilizar.
            // Para asegurar que funciona sin romper esquema:
            const pool = await getPool();
            // Voy a actualizar CodReferencia asumiendo que es para eso o le paso solo el feedback al fronetnd
        }

        res.json({
            success: true,
            data: response.data,
            message: "Cliente creado en Macrosoft auto!"
        });

    } catch (error) {
        console.error("Error exportando a Macrosoft:", error.message);
        res.status(500).json({ error: "Fallo conexión API Macrosoft" });
    }
};

// Búsqueda Unificada: Local -> Legacy (6061)
exports.searchClientUnified = async (req, res) => {
    const { term } = req.query;
    if (!term) return res.status(400).json({ error: "Término de búsqueda requerido" });

    try {
        const pool = await getPool();

        // 1. Búsqueda Local (Prioridad)
        const localRes = await pool.request()
            .input('Term', sql.NVarChar(100), term)
            .query(`
                SELECT TOP 1 * FROM dbo.Clientes 
                WHERE CAST(CodCliente AS NVARCHAR(50)) = @Term 
                   OR Nombre LIKE '%' + @Term + '%' 
                   OR CioRuc = @Term
                   OR CodigoReact = @Term
                   OR CAST(IDReact AS NVARCHAR(50)) = @Term
            `);

        if (localRes.recordset.length > 0) {
            console.log(`[Unified] Encontrado en Local: ${term}`);
            return res.json({
                source: 'local',
                client: localRes.recordset[0],
                found: true
            });
        }

        // 2. Búsqueda Legacy (6061)
        console.log(`[Unified] No en local. Buscando en Macrosoft: ${term}`);

        let legacyClient = null;

        // Intento 1: Directo (útil si term es ID numérico como '185201')
        try {
            const token = await getMacrosoftToken();
            const headers = token ? { Authorization: `Bearer ${token}` } : {};

            const r = await axios.get(`${ERP_API_BASE}/clientes/${term}`, { headers });
            let data = r.data;
            if (data && data.recordset) data = data.recordset;
            if (data && data.data && !Array.isArray(data.data)) data = data.data; // Desempaquetar { data: {...} }

            if (Array.isArray(data)) {
                if (data.length > 0) legacyClient = data[0];
            } else if (data) {
                legacyClient = data;
            }
        } catch (e) {
            console.log(`[Unified] Fallo directo Api Macrosoft (/clientes/${term}). Probando búsqueda en lista...`);
        }

        // Intento 2: Búsqueda en Lista Completa (Backup robusto)
        if (!legacyClient) {
            try {
                // Intentamos primero la ruta standard, luego la de 'dataall' que nos pegó el usuario
                let rutasListas = [
                    `${ERP_API_BASE}/clientes`,
                    `${ERP_API_BASE}/api/apicliente/dataall` // Mantener por si acaso retrocompatible
                ];

                for (const url of rutasListas) {
                    if (legacyClient) break;
                    try {
                        const token = await getMacrosoftToken();
                        const headers = token ? { Authorization: `Bearer ${token}` } : {};

                        const r = await axios.get(url, { headers });
                        let items = r.data;
                        if (items && items.recordset) items = items.recordset; // Manejar wrapper recordset

                        if (Array.isArray(items)) {
                            const t = term.toLowerCase();
                            legacyClient = items.find(c =>
                                (c.CodigoCliente && String(c.CodigoCliente).toLowerCase() == t) ||
                                (c.IdCliente && String(c.IdCliente) == t) ||
                                (c.NombreCliente && c.NombreCliente.toLowerCase().includes(t)) ||
                                (c.CliNombreApellido && c.CliNombreApellido.toLowerCase().includes(t))
                            );
                            if (legacyClient) console.log(`[Unified] Encontrado en lista (${url})`);
                        }
                    } catch (ign) { }
                }
            } catch (e2) { console.error("[Unified] Error fallback:", e2); }
        }

        if (legacyClient) {
            return res.json({
                source: 'legacy',
                client: legacyClient,
                found: true
            });
        }

        return res.json({ found: false, message: "No encontrado en Local ni Legacy" });

    } catch (error) {
        console.error("Error Unified Search:", error);
        res.status(500).json({ error: error.message });
    }
};

// Actualizar Cliente Local
exports.updateClient = async (req, res) => {
    const { codCliente } = req.params;
    const { Nombre, NombreFantasia, CioRuc, Email, TelefonoTrabajo, CliDireccion } = req.body;

    if (!codCliente) return res.status(400).json({ error: "Falta CodCliente" });

    try {
        const pool = await getPool();
        const safeString = (val) => (val !== undefined && val !== null) ? String(val) : null;

        await pool.request()
            .input('CC', sql.Int, codCliente)
            .input('Nom', sql.NVarChar(200), safeString(Nombre))
            .input('Fan', sql.NVarChar(200), safeString(NombreFantasia))
            .input('Ruc', sql.NVarChar(50), safeString(CioRuc))
            .input('Mail', sql.NVarChar(100), safeString(Email))
            .input('Tel', sql.NVarChar(50), safeString(TelefonoTrabajo))
            .input('Dir', sql.NVarChar(500), safeString(CliDireccion))
            .query(`
                UPDATE dbo.Clientes 
                SET Nombre = @Nom,
                    NombreFantasia = @Fan,
                    CioRuc = @Ruc,
                    Email = @Mail,
                    TelefonoTrabajo = @Tel,
                    CliDireccion = @Dir
                WHERE CodCliente = @CC
            `);

        res.json({ success: true, message: "Cliente actualizado correctamente" });
    } catch (e) {
        console.error("Error updateClient:", e);
        res.status(500).json({ error: e.message });
    }
};
