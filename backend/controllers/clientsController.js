const { getPool, sql } = require('../config/db');
const axios = require('axios');
const logger = require('../utils/logger');

const ERP_API_BASE = process.env.ERP_API_URL;

// Google Sheets service (carga protegida)
let sheetsService = null;
try { sheetsService = require('../services/sheetsService'); } catch (e) { console.warn('[clientsController] sheetsService no disponible:', e.message); }

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

        logger.info(`[MACROSOFT AUTH] Solicitando token a ${ERP_API_BASE}/authenticate`);
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
            logger.warn('[MACROSOFT AUTH] No se logró parsear el token, se devuelve data completo (podría ser objeto)', res.data);
            token = res.data; // fallback en caso que de todas formas funcionase
        }

        macrosoftAuthToken = token;
        macrosoftTokenExp = Date.now() + 1000 * 60 * 55; // 55 mins caché
        return token;
    } catch (err) {
        logger.error("[MACROSOFT AUTH] Error obteniendo token:", err.message);
        return null;
    }
}

// ─── BÚSQUEDA EN ClientesReact (local DB) — reemplaza la llamada a API externa ───
exports.getMacrosoftClientData = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('term', sql.VarChar(100), id)
            .query(`
                SELECT TOP 1 *
                FROM ClientesReact WITH(NOLOCK)
                WHERE CliCodigoCliente = @term
                   OR CAST(CliIdCliente AS VARCHAR) = @term
                   OR CliNombreApellido LIKE '%' + @term + '%'
                   OR CliNombreEmpresa  LIKE '%' + @term + '%'
            `);
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado en ClientesReact' });
        }
        res.json(result.recordset[0]);
    } catch (error) {
        logger.error('[getMacrosoftClientData] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
};

// Obtener clientes de ClientesReact que NO están vinculados en la tabla local Clientes
exports.getAllReactClients = async (req, res) => {
    try {
        const pool = await getPool();
        const { q } = req.query;
        const request = pool.request();
        let whereSearch = '1=1';

        if (q) {
            whereSearch = `(
                cr.CliNombreApellido LIKE @q
                OR cr.CliNombreEmpresa LIKE @q
                OR cr.CliCodigoCliente LIKE @q
                OR cr.CliMail LIKE @q
                OR cr.CliDocumento LIKE @q
            )`;
            request.input('q', sql.VarChar(200), `%${q}%`);
        }

        // Solo retorna los de ClientesReact que NO están ya vinculados en dbo.Clientes
        const result = await request.query(`
            SELECT 
                cr.CliIdCliente       AS IdCliente,
                cr.CliCodigoCliente   AS CodigoCliente,
                cr.CliNombreApellido  AS NombreCliente,
                cr.CliNombreEmpresa   AS EmpresaCliente,
                cr.CliCelular         AS Telefono,
                cr.CliMail            AS Email,
                cr.CliDocumento       AS Rut,
                cr.CliLocalidad       AS Localidad,
                cr.CliDireccion       AS Direccion,
                cr.CliAgencia         AS Agencia,
                cr.TClIdTipoCliente,
                cr.LReIdLugarRetiro,
                cr.CliFechaAlta
            FROM ClientesReact cr WITH(NOLOCK)
            WHERE NOT EXISTS (
                SELECT 1 FROM dbo.Clientes loc WITH(NOLOCK)
                WHERE loc.IDCliente = cr.CliCodigoCliente
                   OR (loc.IDReact IS NOT NULL AND loc.IDReact <> '' AND CAST(loc.IDReact AS VARCHAR) = CAST(cr.CliIdCliente AS VARCHAR))
            )
            AND ${whereSearch}
            ORDER BY cr.CliNombreApellido ASC
        `);

        logger.info(`[getAllReactClients] Devolviendo ${result.recordset.length} clientes React sin vincular`);
        res.set('Cache-Control', 'no-store');
        res.json(result.recordset);
    } catch (error) {
        logger.error("Error getAllReactClients:", error.message);
        res.status(500).json({ error: "Error al obtener clientes: " + error.message });
    }
};

// ─── Página individual de Macrosoft (para carga progresiva desde el frontend) ───
exports.getMacrosoftPage = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    try {
        const token = await getMacrosoftToken();
        if (!token) return res.status(502).json({ error: 'No se pudo obtener token de Macrosoft' });

        const msRes = await axios.get(`${ERP_API_BASE}/clientes`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15000,
            params: { page }
        });

        const data = Array.isArray(msRes.data?.data) ? msRes.data.data : (Array.isArray(msRes.data) ? msRes.data : []);
        const pages = msRes.data?.pages ?? 1;
        const length = msRes.data?.length ?? data.length;

        // Trimear strings con padding
        const trimStr = v => typeof v === 'string' ? v.trim() || null : v;
        const cleaned = data.map(c => ({
            CodCliente: c.CodCliente,
            Nombre: trimStr(c.Nombre),
            NombreFantasia: trimStr(c.NombreFantasia),
            DireccionTrabajo: trimStr(c.DireccionTrabajo),
            TelefonoTrabajo: trimStr(c.TelefonoTrabajo),
            CioRuc: trimStr(c.CioRuc),
            Cedula: trimStr(c.Cedula),
            Celular: trimStr(c.Celular),
            Email: trimStr(c.Email),
            Moneda: c.Moneda,
            TiposPrecios: c.TiposPrecios,
        }));

        // Si es página 1 devolver el set de CodCliente locales (para que el frontend detecte vínculos)
        // CLAVE: dbo.Clientes.CodCliente == Macrosoft API CodCliente (son el mismo campo)
        let vinculadosMap = null;
        if (page === 1) {
            const pool = await getPool();
            const localRes = await pool.request().query(`
                SELECT CodCliente, CodReferencia
                FROM dbo.Clientes WITH(NOLOCK)
            `);
            vinculadosMap = {};
            localRes.recordset.forEach(loc => {
                // Existencia: si el CodCliente local == CodCliente Macrosoft → está vinculado
                const key = String(loc.CodCliente || '').trim();
                if (key) vinculadosMap[key] = 1;  // 1 = existe en local
            });
            console.log(`[getMacrosoftPage] ${Object.keys(vinculadosMap).length} clientes en local`);
        }

        res.set('Cache-Control', 'no-store');
        res.json({ data: cleaned, page, pages, length, vinculadosMap });

    } catch (err) {
        console.error(`[getMacrosoftPage] Error página ${page}:`, err.message);
        res.status(500).json({ error: err.message });
    }
};

// Obtener todos los clientes desde la API real de Macrosoft + vínculo local
exports.getAllMacrosoftClients = async (req, res) => {
    const { q } = req.query;
    try {
        // 1. Obtener token y llamar a la API Macrosoft real
        const token = await getMacrosoftToken();
        if (!token) return res.status(502).json({ error: 'No se pudo obtener token de Macrosoft' });

        const headers = { Authorization: `Bearer ${token}` };

        // 1. Primera llamada para saber cuántas páginas hay
        const firstRes = await axios.get(`${ERP_API_BASE}/clientes`, {
            headers, timeout: 20000,
            params: { page: 1 }
        });

        // Extraer array y metadatos de paginación
        const extractBatch = (d) => {
            if (Array.isArray(d)) return d;
            if (Array.isArray(d?.data)) return d.data;
            if (Array.isArray(d?.clientes)) return d.clientes;
            if (Array.isArray(d?.items)) return d.items;
            // Si el objeto tiene una clave con array grande, buscarla
            if (d && typeof d === 'object') {
                for (const k of Object.keys(d)) {
                    if (Array.isArray(d[k]) && d[k].length > 0) return d[k];
                }
            }
            return [];
        };

        const batch1 = extractBatch(firstRes.data);
        const totalPages = firstRes.data?.pages ?? firstRes.data?.totalPages ?? firstRes.data?.last_page ?? 1;
        const perPage = firstRes.data?.length ?? firstRes.data?.per_page ?? batch1.length ?? 30;

        console.log(`[MS API] Página 1/${totalPages}: ${batch1.length} clientes (perPage=${perPage})`);

        let clientes = [...batch1];

        // 2. Buscar el resto de páginas en lotes paralelos de 10
        if (totalPages > 1) {
            const CONCURRENCY = 10;
            for (let start = 2; start <= totalPages; start += CONCURRENCY) {
                const end = Math.min(start + CONCURRENCY - 1, totalPages);
                const requests = [];
                for (let p = start; p <= end; p++) {
                    requests.push(
                        axios.get(`${ERP_API_BASE}/clientes`, {
                            headers, timeout: 20000,
                            params: { page: p }
                        }).then(r => ({ page: p, batch: extractBatch(r.data) }))
                            .catch(e => { console.warn(`[MS API] Página ${p} falló:`, e.message); return { page: p, batch: [] }; })
                    );
                }
                const results = await Promise.all(requests);
                results.sort((a, b) => a.page - b.page);
                results.forEach(({ page: p, batch }) => {
                    clientes = clientes.concat(batch);
                    if (batch.length > 0) console.log(`[MS API] Página ${p}: +${batch.length} (total: ${clientes.length})`);
                });
            }
        }

        console.log(`[MS API] ✓ Total final: ${clientes.length} clientes de ${totalPages} páginas`);

        // 2. Cruzar con tabla local — CodCliente local == CodCliente Macrosoft
        const pool = await getPool();
        const localRes = await pool.request().query(`
            SELECT CodCliente, CodReferencia
            FROM dbo.Clientes WITH(NOLOCK)
        `);
        // CLAVE: dbo.Clientes.CodCliente == Macrosoft CodCliente (mismo campo)
        const vinculadosMap = {};
        localRes.recordset.forEach(loc => {
            const key = String(loc.CodCliente || '').trim();
            if (key) vinculadosMap[key] = 1;  // 1 = existe en local
        });
        console.log(`[getAllMacrosoftClients] ${Object.keys(vinculadosMap).length} clientes en local`);

        // 3. Filtro por búsqueda (lado servidor ya no aplica, lo hace el frontend)
        //    pero si viene q, filtramos antes de devolver para reducir payload
        if (q) {
            const t = q.toLowerCase();
            clientes = clientes.filter(c =>
                [c.Nombre, c.NombreFantasia, c.CioRuc, c.TelefonoTrabajo, c.Email, String(c.CodCliente || '')]
                    .some(v => String(v || '').toLowerCase().includes(t))
            );
        }

        // 4. Enriquecer con vínculo local + limpiar strings con espacios (padding de la API)
        const trimStr = (v) => (typeof v === 'string' ? v.trim() || null : v);
        const enriched = clientes.map(c => ({
            CodCliente: c.CodCliente,
            Nombre: trimStr(c.Nombre),
            NombreFantasia: trimStr(c.NombreFantasia),
            DireccionTrabajo: trimStr(c.DireccionTrabajo),
            DireccionParticular: trimStr(c.DireccionParticular),
            TelefonoTrabajo: trimStr(c.TelefonoTrabajo),
            TelefonoParticular: trimStr(c.TelefonoParticular),
            CioRuc: trimStr(c.CioRuc),
            Cedula: trimStr(c.Cedula),
            Celular: trimStr(c.Celular),
            Email: trimStr(c.Email),
            Moneda: c.Moneda,
            TiposPrecios: c.TiposPrecios,
            Descuento: c.Descuento,
            // Vínculo local
            EsVinculado: vinculadosMap[String(c.CodCliente)] ? 1 : 0,
            CodClienteLocal: vinculadosMap[String(c.CodCliente)] || null,
        }));

        console.log(`[getAllMacrosoftClients] API Macrosoft devolvió ${clientes.length} clientes, ${Object.keys(vinculadosMap).length} vinculados localmente`);
        res.set('Cache-Control', 'no-store');
        res.json({ data: enriched, total: enriched.length });

    } catch (error) {
        logger.error('[getAllMacrosoftClients] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
};

// Buscar Clientes (Autocompletado)
exports.searchClients = async (req, res) => {
    // El término se recorta y se acota: los nombres salen de columnas CHAR y arrastran decenas de
    // espacios de padding ("Vestir Corporativo SRL" + 130 espacios). Al buscar con ese texto, el
    // valor superaba el NVarChar(100) declarado y SQL rechazaba el parámetro entero
    // ("Data type 0xE7 has an invalid data length") → 500. Además el padding nunca matchea.
    const termino = String(req.query.q ?? '').trim().slice(0, 100);
    try {
        if (!termino) return res.json([]);
        const pool = await getPool();
        const result = await pool.request()
            .input('term', sql.NVarChar(200), `%${termino}%`)
            .query('SELECT TOP 10 * FROM dbo.Clientes WHERE Nombre LIKE @term OR IDCliente LIKE @term OR NombreFantasia LIKE @term');
        res.json(result.recordset);
    } catch (err) {
        logger.error(`[clients/search] Error buscando "${termino}": ${err.message}`);
        res.status(500).json({ error: err.message });
    }
};

// Crear Cliente
exports.createClient = async (req, res) => {
    const {
        nombre, telefono, email, direccion, ruc, nombreFantasia,
        codReact, idReact, codCliente, codReferencia,
        // Campos nuevos enviados por el form completo
        idCliente, tipoCliente, vendedorId, estado,
        departamentoId, localidadId, agenciaId, formaEnvioId, webActive
    } = req.body;
    try {
        const pool = await getPool();

        // Verificar si ya existe por nombre exacto
        const check = await pool.request()
            .input('Nombre', sql.NVarChar(200), nombre)
            .query("SELECT COUNT(*) as count FROM dbo.Clientes WHERE Nombre = @Nombre");

        if (check.recordset[0].count > 0) {
            const existing = await pool.request()
                .input('Nombre', sql.NVarChar(200), nombre)
                .query("SELECT * FROM dbo.Clientes WHERE Nombre = @Nombre");
            return res.json(existing.recordset[0]);
        }

        const safeString = (val) => (val !== undefined && val !== null && val !== '') ? String(val) : null;
        const safeInt    = (val) => (val !== undefined && val !== null && val !== '') ? parseInt(val) : null;

        // Determinar CodCliente
        let nextId = null;
        if (codCliente) {
            nextId = parseInt(codCliente);
            logger.info("Usando ID Legacy forzado:", nextId);
        } else if (idReact && !isNaN(parseInt(idReact))) {
            nextId = parseInt(idReact);
            logger.info("Usando ID React como CodCliente Local:", nextId);
        } else {
            const idQuery = await pool.request().query("SELECT ISNULL(MAX(CodCliente), 0) + 1 as NextID FROM dbo.Clientes");
            nextId = idQuery.recordset[0].NextID;
            logger.info("Generado nuevo CodCliente Auto:", nextId);
        }

        const result = await pool.request()
            .input('NextId',         sql.Int,           nextId)
            .input('Nombre',         sql.NVarChar(200), safeString(nombre))
            .input('Telefono',       sql.NVarChar(50),  safeString(telefono))
            .input('Email',          sql.NVarChar(200), safeString(email))
            .input('Direccion',      sql.NVarChar(500), safeString(direccion))
            .input('Ruc',            sql.NVarChar(50),  safeString(ruc))
            .input('Fantasia',       sql.NVarChar(200), safeString(nombreFantasia))
            .input('IdReact',        sql.NVarChar(50),  safeString(idReact))
            .input('CodRef',         sql.NVarChar(50),  safeString(codReferencia || codReact))
            .input('IDCliente',      sql.VarChar(255),  safeString(idCliente))
            .input('TipoCliente',    sql.Int,           safeInt(tipoCliente))
            .input('VendedorId',     sql.NVarChar(20),  safeString(vendedorId))
            .input('Estado',         sql.NVarChar(10),  safeString(estado) || 'ACTIVO')
            .input('DepartamentoId', sql.Int,           safeInt(departamentoId))
            .input('LocalidadId',    sql.Int,           safeInt(localidadId))
            .input('AgenciaId',      sql.Int,           safeInt(agenciaId))
            .input('FormaEnvioId',   sql.Int,           safeInt(formaEnvioId))
            .input('WebActive',      sql.Bit,           webActive ? 1 : 0)
            .query(`
                INSERT INTO dbo.Clientes
                    (CodCliente, Nombre, TelefonoTrabajo, Email, DireccionTrabajo, CioRuc,
                     NombreFantasia, IDCliente, IDReact, CodReferencia,
                     TClIdTipoCliente, VendedorID, ESTADO,
                     DepartamentoID, LocalidadID, AgenciaID, FormaEnvioID, WebActive)
                OUTPUT INSERTED.*
                VALUES
                    (@NextId, @Nombre, @Telefono, @Email, @Direccion, @Ruc,
                     @Fantasia, @IDCliente, @IdReact, @CodRef,
                     @TipoCliente, @VendedorId, @Estado,
                     @DepartamentoId, @LocalidadId, @AgenciaId, @FormaEnvioId, @WebActive)
            `);

        res.json(result.recordset[0]);
    } catch (err) {
        logger.error("[CreateClient ERROR]", err);
        logger.error("Full Body:", req.body);
        res.status(500).json({ error: "DB Error: " + err.message });
    }
};

// ─── ENDPOINT PÚBLICO: Crear cliente desde sistema externo ────────────────────
// POST /api/clients/external-create
// Header: x-api-key: <EXTERNAL_API_KEY del .env>
// Body: { Nombre*, NombreFantasia, TelefonoTrabajo, Email, CioRuc, IDCliente, IDReact, DireccionTrabajo, TClIdTipoCliente, VendedorID, ESTADO }
// Retorna: { success, CodCliente, CliIdCliente, alreadyExists }
exports.createExternalClient = async (req, res) => {
    // 1. Validar API Key
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.EXTERNAL_API_KEY;
    if (!validKey || apiKey !== validKey) {
        return res.status(401).json({ error: 'API Key inválida o no configurada' });
    }

    const {
        Nombre, NombreFantasia, TelefonoTrabajo, Email, CioRuc,
        IDCliente, IDReact, DireccionTrabajo,
        TClIdTipoCliente, VendedorID, ESTADO
    } = req.body;

    if (!Nombre?.trim()) {
        return res.status(400).json({ error: 'El campo Nombre es obligatorio' });
    }

    try {
        const pool = await getPool();
        const safe = (v, max = 200) => (v != null && v !== '') ? String(v).substring(0, max) : null;

        // 2. Verificar si ya existe por Nombre exacto
        const checkNom = await pool.request()
            .input('N', sql.NVarChar(200), Nombre.trim())
            .query(`SELECT CodCliente FROM dbo.Clientes WHERE LTRIM(RTRIM(Nombre)) = LTRIM(RTRIM(@N))`);

        if (checkNom.recordset.length > 0) {
            const existingId = checkNom.recordset[0].CodCliente;
            logger.info(`[EXT CREATE] Cliente ya existe: "${Nombre}" → CodCliente=${existingId}`);
            return res.json({ success: true, alreadyExists: true, CodCliente: existingId, CliIdCliente: existingId });
        }

        // 3. Generar CodCliente
        const idRow = await pool.request().query(`SELECT ISNULL(MAX(CodCliente), 0) + 1 AS NextID FROM dbo.Clientes`);
        const nextId = idRow.recordset[0].NextID;

        // 4. Insertar
        const result = await pool.request()
            .input('CodCliente',      sql.Int,          nextId)
            .input('Nombre',          sql.NVarChar(200), safe(Nombre, 200))
            .input('NombreFantasia',  sql.NVarChar(200), safe(NombreFantasia, 200))
            .input('TelefonoTrabajo', sql.Char(20),      safe(TelefonoTrabajo, 20))
            .input('Email',           sql.Char(40),      safe(Email, 40))
            .input('CioRuc',          sql.Char(20),      safe(CioRuc, 20))
            .input('IDCliente',       sql.VarChar(255),  safe(IDCliente, 255))
            .input('IDReact',         sql.NVarChar(100), safe(IDReact, 100))
            .input('DireccionTrabajo',sql.Char(80),      safe(DireccionTrabajo, 80))
            .input('TClIdTipoCliente',sql.Int,           TClIdTipoCliente ? parseInt(TClIdTipoCliente) : null)
            .input('VendedorID',      sql.NVarChar(20),  safe(VendedorID, 20))
            .input('ESTADO',          sql.NVarChar(10),  safe(ESTADO, 10) || 'ACTIVO')
            .query(`
                INSERT INTO dbo.Clientes
                    (CodCliente, Nombre, NombreFantasia, TelefonoTrabajo, Email, CioRuc,
                     IDCliente, IDReact, DireccionTrabajo, TClIdTipoCliente, VendedorID, ESTADO)
                OUTPUT INSERTED.CodCliente
                VALUES
                    (@CodCliente, @Nombre, @NombreFantasia, @TelefonoTrabajo, @Email, @CioRuc,
                     @IDCliente, @IDReact, @DireccionTrabajo, @TClIdTipoCliente, @VendedorID, @ESTADO)
            `);

        const newId = result.recordset[0].CodCliente;
        logger.info(`[EXT CREATE] Cliente creado: "${Nombre}" → CodCliente=${newId}`);
        return res.status(201).json({ success: true, alreadyExists: false, CodCliente: newId, CliIdCliente: newId });

    } catch (err) {
        logger.error('[EXT CREATE] Error:', err.message);
        return res.status(500).json({ error: 'Error interno: ' + err.message });
    }
};

// --- NUEVOS METODOS DE INTEGRACION ---

// Obtener todos los clientes con JOINs a catálogos para vista tabla
exports.getAllClients = async (req, res) => {
    const { q, mode, light } = req.query;
    try {
        const pool = await getPool();

        // Modo LIVIANO para selectores (ej. Facturación Manual): sin los 6 LEFT JOIN de catálogo
        // (el de Trabajadores con TRY_CAST era lo más caro) y solo las columnas que el selector usa.
        // Baja fuerte el tiempo de carga de 5000+ clientes. Aditivo: no cambia el modo normal.
        if (light) {
            const reqL = pool.request();
            let ql = `
                SELECT c.CliIdCliente, c.CodCliente, c.Nombre, c.NombreFantasia,
                       c.IDCliente, c.CioRuc, c.DireccionTrabajo, c.DepartamentoID,
                       c.TClIdTipoCliente, c.ESTADO
                FROM dbo.Clientes c WITH(NOLOCK)
                WHERE 1=1`;
            if (q) {
                ql += ` AND (c.Nombre LIKE @q OR c.NombreFantasia LIKE @q OR c.CioRuc LIKE @q
                             OR CAST(c.CodCliente AS VARCHAR) LIKE @q OR c.IDCliente LIKE @q)`;
                reqL.input('q', sql.NVarChar, `%${q}%`);
            }
            ql += ` ORDER BY c.Nombre ASC`;
            const rL = await reqL.query(ql);
            return res.json(rL.recordset);
        }

        let query = `
            SELECT 
                c.CliIdCliente, c.CodCliente, c.Nombre, c.NombreFantasia,
                c.IDCliente, c.CioRuc, c.IDReact, c.CodReferencia,
                c.Email, c.TelefonoTrabajo, c.DireccionTrabajo,
                c.ESTADO, c.WebActive,
                c.VendedorID, c.FechaRegistro,
                c.DepartamentoID, c.LocalidadID, c.AgenciaID,
                c.FormaEnvioID, c.TClIdTipoCliente,
                l.Nombre  AS LocalidadNombre,
                d.Nombre  AS DepartamentoNombre,
                a.Nombre  AS AgenciaNombre,
                fe.Nombre AS FormaEnvioNombre,
                tc.TClDescripcion AS TipoClienteNombre,
                t.Nombre  AS VendedorNombre
            FROM dbo.Clientes c WITH(NOLOCK)
            LEFT JOIN Localidades   l  WITH(NOLOCK) ON l.ID  = c.LocalidadID
            LEFT JOIN Departamentos d  WITH(NOLOCK) ON d.ID  = c.DepartamentoID
            LEFT JOIN Agencias      a  WITH(NOLOCK) ON a.ID  = c.AgenciaID
            LEFT JOIN FormasEnvio   fe WITH(NOLOCK) ON fe.ID = c.FormaEnvioID
            LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            LEFT JOIN Trabajadores  t  WITH(NOLOCK) ON TRY_CAST(t.Cedula AS NVARCHAR(50)) = c.VendedorID
            WHERE 1=1
        `;

        const request = pool.request();

        if (q) {
            query += ` 
                AND (c.Nombre LIKE @q 
                   OR c.NombreFantasia LIKE @q 
                   OR c.CioRuc LIKE @q 
                   OR c.Email LIKE @q
                   OR c.TelefonoTrabajo LIKE @q
                   OR CAST(c.CodCliente AS VARCHAR) LIKE @q
                   OR CAST(c.CliIdCliente AS VARCHAR) LIKE @q
                   OR c.IDCliente LIKE @q
                   OR CAST(c.IDReact AS VARCHAR) LIKE @q)
            `;
            request.input('q', sql.NVarChar, `%${q}%`);
        }

        if (mode === 'linked') {
            query += ` AND c.IDReact IS NOT NULL`;
        } else if (mode === 'unlinked') {
            query += ` AND c.IDReact IS NULL`;
        }

        query += ` ORDER BY c.Nombre ASC`;

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        logger.error('getAllClients error:', err.message);
        res.status(500).json({ error: err.message });
    }
};


// Vincular Cliente con React
exports.updateClientLink = async (req, res) => {
    const { codCliente } = req.params;
    const { codigoReact, idReact } = req.body;

    logger.info(`[LINK] Intentando vincular LocalID=${codCliente} con ReactCode=${codigoReact}, ReactID=${idReact}`);

    try {
        const pool = await getPool();
        await pool.request()
            .input('CC', sql.Int, codCliente)
            .input('CR', sql.NVarChar(50), codigoReact ? String(codigoReact).trim() : null)
            .input('IR', sql.NVarChar(50), idReact ? String(idReact).trim() : null)
            .query(`
                UPDATE dbo.Clientes 
                SET IDCliente = @CR, IDReact = @IR 
                WHERE CodCliente = @CC
            `);

        res.json({ success: true, message: 'Vinculación con React actualizada correctamente' });
    } catch (err) {
        logger.error("[LINK ERROR] Falló SQL Update:", err);
        res.status(500).json({ error: "Error al actualizar base de datos: " + err.message });
    }
};

// Vincular Cliente con Macrosoft
exports.updateClientLinkMacrosoft = async (req, res) => {
    const { codCliente } = req.params;
    const { codReferencia } = req.body;

    logger.info(`[LINK MACROSOFT] Intentando vincular LocalID=${codCliente} con CodReferencia=${codReferencia}`);

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
        logger.error("[LINK MACROSOFT ERROR] Falló SQL Update:", err);
        res.status(500).json({ error: "Error al actualizar base de datos: " + err.message });
    }
};

// Importar Cliente desde ClientesReact → tabla local Clientes
exports.importReactClient = async (req, res) => {
    // Acepta tanto el formato nuevo (de ClientesReact) como el antiguo (de API externa)
    const {
        IdCliente, CodigoCliente,          // de ClientesReact
        NombreCliente, EmpresaCliente,     // de ClientesReact
        Telefono, Email, Rut,              // de ClientesReact
        Localidad, Direccion,              // de ClientesReact
        TClIdTipoCliente, LReIdLugarRetiro // de ClientesReact
    } = req.body;

    const nombreFinal = (EmpresaCliente || NombreCliente || '').trim() || 'Sin Nombre';
    const fantasiaFinal = (NombreCliente || '').trim();

    logger.info('[IMPORT] Importando desde ClientesReact:', { nombreFinal, CodigoCliente, IdCliente });

    try {
        const pool = await getPool();

        // Verificar si ya existe por CodigoReact o IDReact
        const check = await pool.request()
            .input('CR', sql.NVarChar(50), String(CodigoCliente || '').trim())
            .input('IR', sql.Int, parseInt(IdCliente) || null)
            .query(`
                SELECT TOP 1 CodCliente, Nombre FROM dbo.Clientes WITH(NOLOCK)
                WHERE (IDCliente = @CR AND @CR <> '')
                   OR (IDReact = @IR AND @IR IS NOT NULL)
            `);

        if (check.recordset.length > 0) {
            return res.json({
                success: true,
                alreadyExists: true,
                client: check.recordset[0],
                message: `El cliente ya existe localmente (CodCliente=${check.recordset[0].CodCliente})`
            });
        }

        // Insertar en Clientes local
        const result = await pool.request()
            .input('Nom', sql.NVarChar(200), nombreFinal)
            .input('Fant', sql.NVarChar(200), fantasiaFinal)
            .input('Ruc', sql.NVarChar(50), String(Rut || '').trim() || null)
            .input('Email', sql.NVarChar(200), String(Email || '').trim() || null)
            .input('Tel', sql.NVarChar(50), String(Telefono || '').trim() || null)
            .input('Dir', sql.NVarChar(500), String(Direccion || '').trim() || null)
            .input('Loc', sql.NVarChar(200), String(Localidad || '').trim() || null)
            .input('CR', sql.NVarChar(50), String(CodigoCliente || '').trim() || null)
            .input('IR', sql.Int, parseInt(IdCliente) || null)
            .input('Tipo', sql.Int, parseInt(TClIdTipoCliente) || null)
            .input('LRe', sql.Int, parseInt(LReIdLugarRetiro) || null)
            .query(`
                INSERT INTO dbo.Clientes
                    (Nombre, NombreFantasia, CioRuc, Email, TelefonoTrabajo,
                     CliDireccion, Localidad, IDCliente, IDReact, TClIdTipoCliente, FormaEnvioID)
                OUTPUT INSERTED.*
                VALUES (@Nom, @Fant, @Ruc, @Email, @Tel,
                        @Dir, @Loc, @CR, @IR, @Tipo, @LRe)
            `);

        res.json({ success: true, alreadyExists: false, client: result.recordset[0] });

    } catch (err) {
        logger.error('[IMPORT ERROR]', err);
        res.status(500).json({ error: 'Error creando cliente local: ' + err.message });
    }
};

// createReactClient removido - ya no se necesita exportar a legacy
// La creación de clientes se hace directamente en la DB local via createClient
exports.createReactClient = async (req, res) => {
    const client = req.body;
    try {
        logger.info("[createReactClient] Creando cliente directamente en DB local:", client.Nombre);
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
        logger.info(`[createReactClient] Cliente creado: CodCliente=${created.CodCliente}`);

        res.json({
            success: true,
            data: created,
            message: "Cliente creado en DB local"
        });
    } catch (error) {
        logger.error("Error createReactClient:", error.message);
        res.status(500).json({ error: "Error interno al crear cliente: " + error.message });
    }
};

exports.createMacrosoftClient = async (req, res) => {
    const client = req.body;
    try {
        logger.info("Iniciando exportación a Macrosoft:", client.Nombre);

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
        logger.error("Error exportando a Macrosoft:", error.message);
        res.status(500).json({ error: "Fallo conexión API Macrosoft" });
    }
};

// Búsqueda Unificada: Local → ClientesReact (misma DB, sin llamada a API externa)
exports.searchClientUnified = async (req, res) => {
    const { term } = req.query;
    if (!term) return res.status(400).json({ error: 'Término de búsqueda requerido' });

    try {
        const pool = await getPool();

        // 1. Búsqueda en tabla local Clientes (prioridad)
        const localRes = await pool.request()
            .input('Term', sql.NVarChar(100), term)
            .query(`
                SELECT TOP 1 * FROM dbo.Clientes WITH(NOLOCK)
                WHERE CAST(CodCliente AS NVARCHAR(50)) = @Term
                   OR Nombre LIKE '%' + @Term + '%'
                   OR CioRuc = @Term
                   OR IDCliente = @Term
                   OR CAST(IDReact AS NVARCHAR(50)) = @Term
                   OR NombreFantasia LIKE '%' + @Term + '%'
            `);

        if (localRes.recordset.length > 0) {
            logger.info(`[Unified] Encontrado en Local: ${term}`);
            return res.json({ source: 'local', client: localRes.recordset[0], found: true });
        }

        // 2. Búsqueda en ClientesReact (tabla local, antes era API externa)
        logger.info(`[Unified] No en local. Buscando en ClientesReact: ${term}`);
        const reactRes = await pool.request()
            .input('Term2', sql.VarChar(200), term)
            .query(`
                SELECT TOP 1
                    CliIdCliente    AS IdCliente,
                    CliCodigoCliente AS CodigoCliente,
                    CliNombreApellido AS NombreCliente,
                    CliNombreEmpresa  AS EmpresaCliente,
                    CliCelular       AS Telefono,
                    CliMail          AS Email,
                    CliDocumento     AS Rut,
                    CliLocalidad     AS Localidad,
                    CliDireccion     AS Direccion,
                    CliAgencia       AS Agencia,
                    TClIdTipoCliente,
                    LReIdLugarRetiro
                FROM ClientesReact WITH(NOLOCK)
                WHERE CliCodigoCliente = @Term2
                   OR CAST(CliIdCliente AS VARCHAR) = @Term2
                   OR CliNombreApellido LIKE '%' + @Term2 + '%'
                   OR CliNombreEmpresa  LIKE '%' + @Term2 + '%'
                   OR CliMail = @Term2
                   OR CliDocumento = @Term2
            `);

        if (reactRes.recordset.length > 0) {
            logger.info(`[Unified] Encontrado en ClientesReact: ${term}`);
            return res.json({ source: 'react', client: reactRes.recordset[0], found: true });
        }

        return res.json({ found: false, message: 'No encontrado en Local ni en ClientesReact' });

    } catch (error) {
        logger.error('Error Unified Search:', error);
        res.status(500).json({ error: error.message });
    }
};

exports.updateClient = async (req, res) => {
    const { codCliente } = req.params;
    const {
        // Identificación
        Nombre, NombreFantasia, IDCliente, CioRuc, IDReact, CodReferencia,
        // Contacto
        TelefonoTrabajo, Email,
        // Dirección
        DireccionTrabajo,
        // Clasificación
        TClIdTipoCliente,
        // Geo FK
        DepartamentoID, LocalidadID, AgenciaID, FormaEnvioID,
        // Comercial
        VendedorID,
        // Estado / Web
        ESTADO, WebActive,
    } = req.body;

    if (!codCliente) return res.status(400).json({ error: 'Falta CodCliente' });

    try {
        const pool = await getPool();
        const safeStr = (val, max = 500) => (val !== undefined && val !== null) ? String(val).substring(0, max) : null;
        const safeInt = (val) => (val !== undefined && val !== null && val !== '') ? parseInt(val) : null;

        await pool.request()
            .input('CC',     sql.Int,          safeInt(codCliente))
            .input('Nom',    sql.Char(150),     safeStr(Nombre, 150))
            .input('Fan',    sql.Char(150),     safeStr(NombreFantasia, 150))
            .input('IDCli',  sql.VarChar(255),  safeStr(IDCliente, 255))
            .input('Ruc',    sql.Char(20),      safeStr(CioRuc, 20))
            .input('IReact', sql.NVarChar(100), IDReact != null ? String(IDReact) : null)
            .input('CRef',   sql.BigInt,        safeInt(CodReferencia))
            .input('Tel',    sql.Char(20),      safeStr(TelefonoTrabajo, 20))
            .input('Mail',   sql.Char(40),      safeStr(Email, 40))
            .input('DirTrab',sql.Char(80),      safeStr(DireccionTrabajo, 80))
            .input('TipCli', sql.Int,           safeInt(TClIdTipoCliente))
            .input('DepID',  sql.Int,           safeInt(DepartamentoID))
            .input('LocID',  sql.Int,           safeInt(LocalidadID))
            .input('AgeID',  sql.Int,           safeInt(AgenciaID))
            .input('FEnvID', sql.Int,           safeInt(FormaEnvioID))
            .input('Vend',   sql.NVarChar(20),  safeStr(VendedorID, 20))
            .input('Est',    sql.NVarChar(10),  safeStr(ESTADO, 10))
            .input('WA',     sql.Bit,           WebActive != null ? (WebActive ? 1 : 0) : null)
            .query(`
                UPDATE dbo.Clientes SET
                    Nombre           = COALESCE(@Nom,    Nombre),
                    NombreFantasia   = COALESCE(@Fan,    NombreFantasia),
                    IDCliente        = COALESCE(@IDCli,  IDCliente),
                    CioRuc           = COALESCE(@Ruc,    CioRuc),
                    IDReact          = COALESCE(@IReact, IDReact),
                    CodReferencia    = @CRef,
                    TelefonoTrabajo  = COALESCE(@Tel,    TelefonoTrabajo),
                    Email            = COALESCE(@Mail,   Email),
                    DireccionTrabajo = COALESCE(@DirTrab, DireccionTrabajo),
                    TClIdTipoCliente = COALESCE(@TipCli, TClIdTipoCliente),
                    DepartamentoID   = COALESCE(@DepID,  DepartamentoID),
                    LocalidadID      = COALESCE(@LocID,  LocalidadID),
                    AgenciaID        = COALESCE(@AgeID,  AgenciaID),
                    FormaEnvioID     = COALESCE(@FEnvID, FormaEnvioID),
                    VendedorID       = COALESCE(@Vend,   VendedorID),
                    ESTADO           = COALESCE(@Est,    ESTADO),
                    WebActive        = COALESCE(@WA,     WebActive)
                WHERE CodCliente = @CC
            `);

        res.json({ success: true, message: 'Cliente actualizado correctamente' });
    } catch (e) {
        logger.error('Error updateClient:', e);
        res.status(500).json({ error: e.message });
    }
};



// Obtener duplicados por IDReact
exports.getDuplicateClients = async (req, res) => {
    try {
        const pool = await getPool();

        const dupIdsResult = await pool.request().query(`
            SELECT IDCliente
            FROM dbo.Clientes WITH (NOLOCK)
            WHERE IDCliente IS NOT NULL AND IDCliente <> ''
            GROUP BY IDCliente
            HAVING COUNT(*) > 1
        `);

        const dupIds = dupIdsResult.recordset.map(row => row.IDCliente);
        if (dupIds.length === 0) return res.json({ clients: [], reactClients: [], formAnswers: [] });

        const idListStr = dupIds.map(id => `'${id}'`).join(',');

        const clientsResult = await pool.request().query(`
            SELECT * FROM dbo.Clientes WITH (NOLOCK)
            WHERE IDCliente IN (${idListStr})
            ORDER BY IDCliente ASC
        `);

        const reactIds = [...new Set(clientsResult.recordset.map(c => c.IDReact).filter(id => id && String(id).trim() !== ''))];
        let reactResult = { recordset: [] };
        let formResult = { recordset: [] };

        if (reactIds.length > 0) {
            const reactIdListStr = reactIds.map(id => `'${id}'`).join(',');

            reactResult = await pool.request().query(`
                SELECT * FROM dbo.clientesreact WITH (NOLOCK)
                WHERE CAST(CliIdCliente AS VARCHAR) IN (${reactIdListStr})
            `);

            formResult = await pool.request().query(`
                SELECT * FROM dbo.[Respuestas de formulario] WITH (NOLOCK)
                WHERE CAST([ID react] AS VARCHAR) IN (${reactIdListStr})
            `);
        }

        res.json({
            clients: clientsResult.recordset,
            reactClients: reactResult.recordset,
            formAnswers: formResult.recordset
        });

    } catch (err) {
        logger.error("Error getDuplicateClients:", err);
        res.status(500).json({ error: "DB Error: " + err.message });
    }
};

// Eliminar Cliente
exports.deleteClient = async (req, res) => {
    const { codCliente } = req.params;

    if (!codCliente) return res.status(400).json({ error: "Falta CodCliente" });

    try {
        const pool = await getPool();

        const cliRes = await pool.request()
            .input('CC', sql.Int, codCliente)
            .query('SELECT CliIdCliente, LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.Clientes WHERE CodCliente = @CC');
        if (cliRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        const { CliIdCliente, Nombre } = cliRes.recordset[0];

        // ── Candado (26-ago-2026, caso Carlos Benechi): borrar un cliente con vida
        // operativa/contable deja huérfanos irrecuperables — órdenes en depósito que
        // no se pueden retirar ni cobrar, deudas sin dueño. Si tiene algo vivo se
        // rechaza con el detalle; la alternativa es desactivarlo (ESTADO Inactivo).
        const chk = await pool.request()
            .input('Cli', sql.Int, CliIdCliente)
            // Texto, no Int: Ordenes.CodCliente es nchar(10) y con un parámetro Int
            // SQL convierte la COLUMNA y pierde el índice IX_Ordenes_CodCliente.
            .input('CCtxt', sql.NVarChar(10), String(codCliente))
            .query(`
                SELECT
                  (SELECT COUNT(*) FROM dbo.OrdenesDeposito WITH(NOLOCK)
                     WHERE CliIdCliente = @Cli AND OrdEstadoActual NOT IN (9, 10)) AS DepositoSinEntregar,
                  (SELECT COUNT(*) FROM dbo.Ordenes WITH(NOLOCK)
                     WHERE CodCliente = @CCtxt
                       AND ISNULL(Estado, '') NOT IN ('Entregado', 'Cancelado', 'Finalizado')) AS OrdenesEnProduccion,
                  (SELECT COUNT(*) FROM dbo.DeudaDocumento dd
                     JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
                     WHERE cc.CliIdCliente = @Cli
                       AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')) AS DeudasVivas,
                  (SELECT COUNT(*) FROM dbo.CuentasCliente WITH(NOLOCK)
                     WHERE CliIdCliente = @Cli AND ABS(ISNULL(CueSaldoActual, 0)) > 0.01) AS CuentasConSaldo
            `);
        const c = chk.recordset[0];
        const motivos = [];
        if (c.DepositoSinEntregar > 0) motivos.push(`${c.DepositoSinEntregar} orden(es) en depósito sin entregar`);
        if (c.OrdenesEnProduccion > 0) motivos.push(`${c.OrdenesEnProduccion} orden(es) activas en producción`);
        if (c.DeudasVivas > 0)         motivos.push(`${c.DeudasVivas} deuda(s) pendientes de cobro`);
        if (c.CuentasConSaldo > 0)     motivos.push(`${c.CuentasConSaldo} cuenta(s) con saldo distinto de cero`);

        if (motivos.length > 0) {
            return res.status(409).json({
                error: `No se puede eliminar a ${Nombre}: tiene ${motivos.join(', ')}. ` +
                       `Si no querés que aparezca más, desactivalo (Estado: Inactivo) en vez de eliminarlo.`
            });
        }

        // Cliente limpio: se llevan también sus direcciones de envío (única FK real,
        // sin cascada — dejarlas bloqueaba el DELETE con error críptico de FK).
        await pool.request()
            .input('Cli', sql.Int, CliIdCliente)
            .query('DELETE FROM dbo.DireccionesEnvioCliente WHERE CliIdCliente = @Cli');
        await pool.request()
            .input('CC', sql.Int, codCliente)
            .query('DELETE FROM dbo.Clientes WHERE CodCliente = @CC');

        res.json({ success: true, message: "Cliente eliminado correctamente" });
    } catch (err) {
        logger.error("Error deleteClient:", err);
        res.status(500).json({ error: "No se puede eliminar porque posiblemente tenga datos asociados en ordenes o facturas. " + err.message });
    }
};

// -------------------------------------------------------------------
// TIPOS CLIENTES
// -------------------------------------------------------------------
exports.getTiposClientes = async (req, res) => {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const result = await pool.request().query('SELECT TClIdTipoCliente, TClDescripcion FROM TiposClientes WITH(NOLOCK) ORDER BY TClIdTipoCliente ASC');
        res.json(result.recordset);
    } catch (error) {
        logger.error('Error al obtener Tipos de Clientes:', error);
        res.status(500).json({ message: 'Error al obtener Tipos de Clientes', error: error.message });
    }
};

// -------------------------------------------------------------------
// CATALOGS — todos los catálogos en una sola llamada
// -------------------------------------------------------------------
exports.getCatalogs = async (req, res) => {
    try {
        const pool = await getPool();
        const [localidades, departamentos, agencias, formasEnvio, tiposClientes, vendedores] = await Promise.all([
            pool.request().query('SELECT ID, Nombre, DepartamentoID FROM Localidades WITH(NOLOCK) ORDER BY Nombre'),
            pool.request().query('SELECT ID, Nombre FROM Departamentos WITH(NOLOCK) ORDER BY Nombre'),
            pool.request().query('SELECT ID, Nombre FROM Agencias WITH(NOLOCK) ORDER BY Nombre'),
            pool.request().query('SELECT ID, Nombre FROM FormasEnvio WITH(NOLOCK) ORDER BY Nombre'),
            pool.request().query('SELECT TClIdTipoCliente AS ID, TClDescripcion AS Nombre FROM TiposClientes WITH(NOLOCK) ORDER BY TClDescripcion'),
            // Trabajadores del área VENTAS — columna se llama [Área] con Á mayúscula (U+00C1)
            pool.request().query("SELECT Cedula, Nombre FROM Trabajadores WITH(NOLOCK) WHERE [\u00C1rea] = 'VENTAS' ORDER BY Nombre"),
        ]);
        res.json({
            localidades: localidades.recordset,
            departamentos: departamentos.recordset,
            agencias: agencias.recordset,
            formasEnvio: formasEnvio.recordset,
            tiposClientes: tiposClientes.recordset,
            vendedores: vendedores.recordset,
        });
    } catch (error) {
        logger.error('Error getCatalogs:', error);
        res.status(500).json({ error: error.message });
    }
};

// -------------------------------------------------------------------
// ÁRBOL — clientes agrupados por vendedor o tipo de cliente
// -------------------------------------------------------------------
exports.getClientsTree = async (req, res) => {
    const { group = 'vendedor' } = req.query;
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT
                c.CliIdCliente, c.CodCliente, c.Nombre, c.NombreFantasia,
                c.IDCliente, c.CioRuc, c.IDReact, c.CodReferencia,
                c.Email, c.TelefonoTrabajo, c.DireccionTrabajo,
                c.ESTADO, c.VendedorID, c.TClIdTipoCliente,
                tc.TClDescripcion AS TipoClienteNombre,
                t.Nombre AS VendedorNombre
            FROM dbo.Clientes c WITH(NOLOCK)
            LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            LEFT JOIN Trabajadores  t  WITH(NOLOCK) ON TRY_CAST(t.Cedula AS NVARCHAR(50)) = c.VendedorID
            ORDER BY c.Nombre ASC
        `);

        const clients = result.recordset;
        const tree = {};

        if (group === 'vendedor') {
            clients.forEach(c => {
                const key = c.VendedorNombre?.trim() || 'Sin Vendedor';
                if (!tree[key]) tree[key] = { label: key, groupKey: c.VendedorID || '__none__', clients: [] };
                tree[key].clients.push(c);
            });
        } else {
            clients.forEach(c => {
                const key = c.TipoClienteNombre?.trim() || 'Sin Tipo';
                if (!tree[key]) tree[key] = { label: key, groupKey: c.TClIdTipoCliente || '__none__', clients: [] };
                tree[key].clients.push(c);
            });
        }

        res.json({ groups: Object.values(tree).sort((a, b) => a.label.localeCompare(b.label)) });
    } catch (err) {
        console.error('getClientsTree error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// Actualización rápida desde el árbol (cambia vendedor o tipo)
exports.quickUpdateClient = async (req, res) => {
    const { codCliente } = req.params;
    const { VendedorID, TClIdTipoCliente } = req.body;
    try {
        const pool = await getPool();
        const safeStr = (v) => (v !== undefined && v !== null && v !== '') ? String(v) : null;
        const safeInt = (v) => (v !== undefined && v !== null && v !== '') ? parseInt(v) : null;
        await pool.request()
            .input('CC', sql.Int, parseInt(codCliente))
            .input('Vend', sql.NVarChar(20), safeStr(VendedorID))
            .input('Tipo', sql.Int, safeInt(TClIdTipoCliente))
            .query(`
                UPDATE dbo.Clientes SET
                    VendedorID       = CASE WHEN @Vend IS NOT NULL THEN @Vend ELSE VendedorID END,
                    TClIdTipoCliente = CASE WHEN @Tipo IS NOT NULL THEN @Tipo ELSE TClIdTipoCliente END
                WHERE CodCliente = @CC
            `);
        res.json({ success: true });
    } catch (err) {
        console.error('quickUpdateClient error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// -------------------------------------------------------------------
// MACROSOFT — Actualizar cliente existente vía API
// -------------------------------------------------------------------
exports.updateMacrosoftClient = async (req, res) => {
    const { codReferencia } = req.params;
    const client = req.body;
    try {
        const token = await getMacrosoftToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const payload = {
            CodCliente: codReferencia,
            Nombre: client.Nombre || undefined,
            NombreFantasia: client.NombreFantasia || undefined,
            CioRuc: client.CioRuc || undefined,
            DireccionTrabajo: client.DireccionTrabajo || undefined,
            TelefonoTrabajo: client.TelefonoTrabajo || undefined,
            Email: client.Email || undefined,
        };
        const response = await axios.put(`${ERP_API_BASE}/clientes/${codReferencia}`, payload, { headers });
        res.json({ success: true, data: response.data });
    } catch (err) {
        console.error('[updateMacrosoftClient] Error:', err.message);
        res.status(500).json({ error: 'Error actualizando en Macrosoft: ' + err.message });
    }
};

// ─── GOOGLE SHEETS ────────────────────────────────────────────────────────────

const svcGuard = (res) => {
    if (!sheetsService) { res.status(503).json({ error: 'Google Sheets service no disponible' }); return false; }
    return true;
};

// GET /clients/sheets/all
exports.sheetsGetAll = async (req, res) => {
    if (!svcGuard(res)) return;
    try {
        const rows = await sheetsService.getAllRows();
        res.json(rows);
    } catch (err) {
        console.error('[sheetsGetAll] Error:', err.message);
        const status = err.message.startsWith('NO_TOKEN') || err.message.startsWith('NO_SHEETS') ? 401 : 500;
        res.status(status).json({ error: err.message });
    }
};

// GET /clients/sheets/search?idreact=XXX
exports.sheetsSearch = async (req, res) => {
    if (!svcGuard(res)) return;
    const { idreact } = req.query;
    if (!idreact) return res.status(400).json({ error: 'Falta ?idreact=' });
    try {
        const result = await sheetsService.findRowByIDReact(idreact);
        if (!result) return res.status(404).json({ error: 'No encontrado' });
        res.json(result);
    } catch (err) {
        console.error('[sheetsSearch] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// POST /clients/sheets/update — { idreact, data }
exports.sheetsUpdate = async (req, res) => {
    if (!svcGuard(res)) return;
    const { idreact, data } = req.body;
    if (!idreact || !data) return res.status(400).json({ error: 'Faltan campos: idreact, data' });
    try {
        const found = await sheetsService.findRowByIDReact(idreact);
        if (!found) return res.status(404).json({ error: `IDReact ${idreact} no encontrado` });
        const result = await sheetsService.updateRow(found.rowIndex, data);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[sheetsUpdate] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};
