const { getPool, sql } = require('../config/db');

// --- PERFILES ---

const getAllProfiles = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query("SELECT * FROM PerfilesPrecios WHERE Activo = 1 ORDER BY Nombre");
        res.json(result.recordset);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const getProfileDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const profile = await pool.request().input('ID', sql.Int, id).query("SELECT * FROM PerfilesPrecios WHERE ID = @ID");
        const items = await pool.request().input('ID', sql.Int, id).query("SELECT * FROM PerfilesItems WHERE PerfilID = @ID");

        if (profile.recordset.length === 0) return res.status(404).json({ error: "Perfil no encontrado" });

        res.json({ profile: profile.recordset[0], items: items.recordset });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const saveProfile = async (req, res) => {
    const { id, nombre, descripcion, items, esGlobal } = req.body;
    // items: [{ CodArticulo, TipoRegla, Valor }]

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        let profileId = id;
        const isGlobalBit = esGlobal ? 1 : 0;

        // 1. Upsert Header
        const headerReq = new sql.Request(transaction);
        if (id) {
            await headerReq
                .input('ID', sql.Int, id)
                .input('Nom', sql.NVarChar, nombre)
                .input('Desc', sql.NVarChar, descripcion)
                .input('Glob', sql.Bit, isGlobalBit)
                .query("UPDATE PerfilesPrecios SET Nombre = @Nom, Descripcion = @Desc, EsGlobal = @Glob WHERE ID = @ID");
        } else {
            const result = await headerReq
                .input('Nom', sql.NVarChar, nombre)
                .input('Desc', sql.NVarChar, descripcion)
                .input('Glob', sql.Bit, isGlobalBit)
                .query("INSERT INTO PerfilesPrecios (Nombre, Descripcion, EsGlobal) OUTPUT INSERTED.ID VALUES (@Nom, @Desc, @Glob)");
            profileId = result.recordset[0].ID;
        }

        // 2. Clear Items
        const delReq = new sql.Request(transaction);
        await delReq.input('pid', sql.Int, profileId).query("DELETE FROM PerfilesItems WHERE PerfilID = @pid");

        // 3. Insert Items
        if (items && items.length > 0) {
            // Bulk insert o loop. Loop es ok para configs.
            for (const item of items) {
                await new sql.Request(transaction)
                    .input('pid', sql.Int, profileId)
                    .input('cod', sql.NVarChar, item.CodArticulo || 'TOTAL')
                    .input('tipo', sql.NVarChar, item.TipoRegla || 'percentage_discount')
                    .input('val', sql.Decimal(18, 4), item.Valor)
                    .input('min', sql.Int, item.CantidadMinima || 1) // Nuevo campo
                    .query("INSERT INTO PerfilesItems (PerfilID, CodArticulo, TipoRegla, Valor, CantidadMinima) VALUES (@pid, @cod, @tipo, @val, @min)");
            }
        }

        await transaction.commit();
        res.json({ success: true, id: profileId });
    } catch (e) {
        if (transaction._aborted === false) await transaction.rollback(); // Rollback only if not aborted
        res.status(500).json({ error: e.message });
    }
};

const deleteProfile = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        // Check usage
        const usage = await pool.request().input('ID', sql.Int, id).query("SELECT TOP 1 1 FROM PreciosEspeciales WHERE PerfilID = @ID");
        if (usage.recordset.length > 0) return res.status(400).json({ error: "No se puede eliminar: Hay clientes usando este perfil." });

        await pool.request().input('ID', sql.Int, id).query("UPDATE PerfilesPrecios SET Activo = 0 WHERE ID = @ID"); // Soft delete
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// --- ASIGNACIÓN DE CLIENTES ---

const getAllCustomersWithProfile = async (req, res) => {
    // Si tienes tabla Clientes, úsala. Si no, usa PreciosEspeciales como base + API externa?
    // El usuario tiene /api/clients que devuelve lista.
    // Nosotros debemos devolver la lista combinada con su PerfilID.

    // Como no tengo acceso directo a la tabla Clientes del ERP (a veces es externa), 
    // haré un LEFT JOIN con nuestra tabla de configuración.

    // Asumiremos que el frontend pide la lista de clientes al ERP (/api/clients) 
    // y luego pide a este endpoint la lista de asignaciones para combinar.
    // O si tenemos tabla local Clientes, hacemos JOIN.

    // Version: Devolver solo asignaciones (ClienteID -> PerfilID)
    try {
        console.log("Fetching customer assignments with PerfilesIDs...");
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                PE.ClienteID, PE.NombreCliente, PE.PerfilID, PE.PerfilesIDs,
                PP.Nombre as NombrePerfil,
                (SELECT COUNT(*) FROM PreciosEspecialesItems WHERE ClienteID = PE.ClienteID) as CantReglas
            FROM PreciosEspeciales PE
            LEFT JOIN PerfilesPrecios PP ON PE.PerfilID = PP.ID
        `);
        res.json(result.recordset);
    } catch (e) {
        console.error("SQL Error in getAllCustomersWithProfile:", e); // Log detallado
        res.status(500).json({ error: e.message, code: e.code }); // Retornar detalle
    }
};

const assignProfileToCustomer = async (req, res) => {
    let { clienteId, nombreCliente, perfilId } = req.body;

    // Normalizar a Array para guardar lista completa
    let idList = [];
    if (Array.isArray(perfilId)) {
        idList = perfilId;
    } else if (perfilId) {
        idList = [perfilId];
    }

    // Perfil Principal (Legacy / Compatibilidad)
    const mainPid = idList.length > 0 ? parseInt(idList[0]) : null;
    // Lista completa (Nueva func)
    const pidsStr = idList.length > 0 ? idList.join(',') : null;

    try {
        const pool = await getPool();
        // Upsert en PreciosEspeciales
        await pool.request()
            .input('CID', sql.Int, clienteId)
            .input('Nom', sql.NVarChar, nombreCliente || `Cliente ${clienteId}`)
            .input('PID', sql.Int, mainPid)
            .input('PIDs', sql.NVarChar, pidsStr)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM PreciosEspeciales WHERE ClienteID = @CID)
                BEGIN
                    INSERT INTO PreciosEspeciales (ClienteID, NombreCliente, PerfilID, PerfilesIDs) VALUES (@CID, @Nom, @PID, @PIDs)
                END
                ELSE
                BEGIN
                    UPDATE PreciosEspeciales SET 
                        PerfilID = @PID, 
                        PerfilesIDs = @PIDs,
                        NombreCliente = COALESCE(@Nom, NombreCliente),
                        UltimaActualizacion = GETDATE()
                    WHERE ClienteID = @CID
                END
            `);

        res.json({ success: true });
    } catch (e) {
        console.error("Error assigning profile:", e);
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getAllProfiles,
    getProfileDetails,
    saveProfile,
    deleteProfile,
    getAllCustomersWithProfile,
    assignProfileToCustomer
};
