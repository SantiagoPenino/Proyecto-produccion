const { getPool, sql } = require('../config/db');
const axios = require('axios'); // Importar axios para el proxy

// Proxy para API Externa (Evita CORS) - Obtener Un Cliente por ID (Legacy/Local)
exports.getMacrosoftClientData = async (req, res) => {
    const { id } = req.params;
    try {
        const response = await axios.get(`http://localhost:6061/api/clientes/${id}`);
        res.json(response.data);
    } catch (error) {
        console.log(`[PROXY] Falló búsqueda directa '/${id}'. Intentando buscar en lista completa...`);

        // Fallback: Obtener todos y filtrar (según descripción usuario "trae todos")
        try {
            const listRes = await axios.get(`http://localhost:6061/api/clientes`);
            let items = listRes.data;
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
                const listRes2 = await axios.get(`http://localhost:6061/api/apicliente/dataall`);
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
            error: "Error API Legacy 6061",
            details: error.response?.data ? JSON.stringify(error.response.data) : error.message
        });
    }
};

// Proxy para obtener TODOS los clientes del sistema React (Nueva API con Auth)
exports.getAllReactClients = async (req, res) => {
    try {
        // 1. Obtener Token
        const tokenRes = await axios.post('https://administracionuser.uy/api/apilogin/generate-token', {
            apiKey: "api_key_google_123sadas12513_user"
        });

        const token = tokenRes.data.token || tokenRes.data.accessToken || tokenRes.data; // Ajustar según respuesta real

        if (!token) throw new Error("No se recibió token de autenticación");

        // 2. Obtener Datos usando Token
        const response = await axios.get('https://administracionuser.uy/api/apicliente/dataall', {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log("--- RESPUESTA API REACT DATAALL ---");
        // console.log(JSON.stringify(response.data, null, 2).substring(0, 500) + "..."); // Ver primeros caracteres
        console.log("Tipo:", typeof response.data);
        console.log("Es Array:", Array.isArray(response.data));
        if (!Array.isArray(response.data)) console.log("Keys:", Object.keys(response.data));
        console.log("-----------------------------------");

        res.json(response.data);
    } catch (error) {
        console.error("Error Proxy React API:", error.message);
        if (error.response) {
            console.error("Detalle Error:", error.response.data);
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(502).json({ error: "Fallo conexión con API externa Auth/Data" });
        }
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
    const { q } = req.query;
    try {
        const pool = await getPool();
        let query = `
            SELECT TOP 500 
                CodCliente, Nombre, NombreFantasia, CioRuc, CodigoReact, IDReact, Email, TelefonoTrabajo, CodReferencia
            FROM dbo.Clientes
        `;

        const request = pool.request();

        if (q) {
            // Búsqueda en servidor sobre todos los campos relevantes
            query += ` 
                WHERE Nombre LIKE @q 
                   OR NombreFantasia LIKE @q 
                   OR CioRuc LIKE @q 
                   OR CAST(CodCliente AS VARCHAR) LIKE @q
            `;
            request.input('q', sql.NVarChar, `%${q}%`);
        }

        // Priorizar vinculados
        query += ` ORDER BY CASE WHEN CodigoReact IS NOT NULL AND CodigoReact <> '' THEN 0 ELSE 1 END, Nombre ASC`;

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

        res.json({ success: true, message: 'Vinculación actualizada correctamente' });
    } catch (err) {
        console.error("[LINK ERROR] Falló SQL Update:", err); // Log detallado en backend
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

// Helper para obtener token (Reutilizable)
async function getExternalToken() {
    const tokenRes = await axios.post('https://administracionuser.uy/api/apilogin/generate-token', {
        apiKey: "api_key_google_123sadas12513_user"
    });
    return tokenRes.data.token || tokenRes.data.accessToken || tokenRes.data;
}

exports.createReactClient = async (req, res) => {
    const client = req.body; // Datos del cliente local

    try {
        console.log("Iniciando exportación a React:", client.Nombre);

        // 1. Obtener Token
        const token = await getExternalToken();
        if (!token) throw new Error("No se pudo obtener token de API Externa");

        // 2. Mapear Datos (Local -> Formato React)
        // Ajustamos los campos según tu esquema local (dbo.Clientes) vs API Externa
        const payload = {
            CliCodigoCliente: String(client.CodCliente),       // Usamos ID Local como Código Allá
            CliNombreApellido: client.Nombre,
            CliCelular: client.TelefonoTrabajo ? String(client.TelefonoTrabajo) : null,
            CliMail: client.Email || null,
            CliNombreEmpresa: client.NombreFantasia || null,
            CliDocumento: client.CioRuc || null,
            CliLocalidad: client.Ciudad || "Montevideo", // Valor por defecto si falta
            CliDireccion: client.Direccion || null,
            TClIdTipoCliente: 1 // Hardcoded según requerimiento
        };

        console.log("Enviando Payload a React:", payload);

        // 3. Enviar a API Externa
        const response = await axios.post('https://administracionuser.uy/api/apicliente/create', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        // 4. AUTOLINK: Actualizar base local con los datos devueltos
        const createdReactClient = response.data;
        // Asumimos que la respuesta trae IdCliente y CodigoCliente (ajustar segun respuesta API real)
        const nuevoCodigoReact = createdReactClient.CodigoCliente || createdReactClient.CliCodigoCliente || createdReactClient.codigoCliente;
        const nuevoIdReact = createdReactClient.IdCliente || createdReactClient.CliId || createdReactClient.idCliente;

        if (nuevoCodigoReact) {
            const pool = await getPool();
            await pool.request()
                .input('CC', sql.Int, client.CodCliente)
                .input('CR', sql.NVarChar(50), String(nuevoCodigoReact).trim())
                .input('IR', sql.NVarChar(50), nuevoIdReact ? String(nuevoIdReact).trim() : null)
                .query(`UPDATE dbo.Clientes SET CodigoReact = @CR, IDReact = @IR WHERE CodCliente = @CC`);
            console.log(`Autovínculo completado: Local ${client.CodCliente} <-> React ${nuevoCodigoReact}`);
        } else {
            console.warn("WARN: No se encontró ID en respuesta React para autovincular:", createdReactClient);
        }

        res.json({
            success: true,
            data: response.data,
            message: "Cliente creado y VINCULADO automáticamente"
        });

    } catch (error) {
        console.error("Error creando cliente en React:", error.message);
        if (error.response) {
            console.error("Detalle Error API:", error.response.data);
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: "Error interno al exportar cliente" });
        }
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
        console.log(`[Unified] No en local. Buscando en Legacy 6061: ${term}`);

        let legacyClient = null;

        // Intento 1: Directo (útil si term es ID numérico como '185201')
        try {
            const r = await axios.get(`http://localhost:6061/api/clientes/${term}`);
            let data = r.data;
            if (data && data.recordset) data = data.recordset;
            if (data && data.data && !Array.isArray(data.data)) data = data.data; // Desempaquetar { data: {...} }

            if (Array.isArray(data)) {
                if (data.length > 0) legacyClient = data[0];
            } else if (data) {
                legacyClient = data;
            }
        } catch (e) {
            console.log(`[Unified] Fallo directo 6061 (/api/clientes/${term}). Probando búsqueda en lista...`);
        }

        // Intento 2: Búsqueda en Lista Completa (Backup robusto)
        if (!legacyClient) {
            try {
                // Intentamos primero la ruta standard, luego la de 'dataall' que nos pegó el usuario
                let rutasListas = [
                    'http://localhost:6061/api/apicliente/dataall', // Prioridad según log usuario
                    'http://localhost:6061/api/clientes'
                ];

                for (const url of rutasListas) {
                    if (legacyClient) break;
                    try {
                        const r = await axios.get(url);
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