const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

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
        const items = await pool.request().input('ID', sql.Int, id).query(`
            SELECT PI.ID, PI.PerfilID, 
                   LTRIM(RTRIM(COALESCE(PI.CodGrupo, A.CodArticulo, CASE WHEN PI.ProIdProducto = 0 THEN 'TOTAL' ELSE CAST(PI.ProIdProducto AS VARCHAR) END))) as CodArticulo, 
                   PI.ProIdProducto, PI.CodGrupo, PI.TipoRegla, PI.Valor, CASE WHEN PI.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END as Moneda, PI.CantidadMinima 
            FROM PerfilesItems PI
            LEFT JOIN Articulos A ON PI.ProIdProducto = A.ProIdProducto
            WHERE PI.PerfilID = @ID
        `);

        if (profile.recordset.length === 0) return res.status(404).json({ error: "Perfil no encontrado" });

        res.json({ profile: profile.recordset[0], items: items.recordset });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const saveProfile = async (req, res) => {
    const { id, nombre, descripcion, items, esGlobal, categoria } = req.body;
    // items: [{ CodArticulo, TipoRegla, Valor }]

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        let profileId = id;
        const isGlobalBit = esGlobal ? 1 : 0;
        const catStr = categoria || 'Todos';

        // 1. Upsert Header
        const headerReq = new sql.Request(transaction);
        if (id) {
            await headerReq
                .input('ID', sql.Int, id)
                .input('Nom', sql.NVarChar, nombre)
                .input('Desc', sql.NVarChar, descripcion)
                .input('Glob', sql.Bit, isGlobalBit)
                .input('Cat', sql.VarChar, catStr)
                .query("UPDATE PerfilesPrecios SET Nombre = @Nom, Descripcion = @Desc, EsGlobal = @Glob, Categoria = @Cat WHERE ID = @ID");
        } else {
            const result = await headerReq
                .input('Nom', sql.NVarChar, nombre)
                .input('Desc', sql.NVarChar, descripcion)
                .input('Glob', sql.Bit, isGlobalBit)
                .input('Cat', sql.VarChar, catStr)
                .query("INSERT INTO PerfilesPrecios (Nombre, Descripcion, EsGlobal, Categoria) OUTPUT INSERTED.ID VALUES (@Nom, @Desc, @Glob, @Cat)");
            profileId = result.recordset[0].ID;
        }

        // 2. Clear Items
        const delReq = new sql.Request(transaction);
        await delReq.input('pid', sql.Int, profileId).query("DELETE FROM PerfilesItems WHERE PerfilID = @pid");

        // 3. Insert Items
        if (items && items.length > 0) {
            for (const item of items) {
                let finalProIdProducto = (item.ProIdProducto !== undefined && item.ProIdProducto !== null) ? item.ProIdProducto : null;
                let finalCodGrupo = item.CodGrupo || null;
                
                // Conversión de fallback para la UI que use 'TOTAL' o 'GRUPO:'
                const codArtStr = (item.CodArticulo || '').toString();
                if (codArtStr === 'TOTAL') {
                    finalProIdProducto = 0;
                    finalCodGrupo = null;
                } else if (codArtStr.startsWith('GRUPO:')) {
                    finalProIdProducto = null;
                    finalCodGrupo = codArtStr.replace('GRUPO:', '').trim();
                }

                if (finalProIdProducto !== null || finalCodGrupo !== null) {
                    await new sql.Request(transaction)
                        .input('pid', sql.Int, profileId)
                        .input('proId', sql.Int, finalProIdProducto)
                        .input('grupo', sql.VarChar, finalCodGrupo)
                        .input('tipo', sql.NVarChar, item.TipoRegla || 'percentage_discount')
                        .input('val', sql.Decimal(18, 4), item.Valor)
                        .input('mon', sql.Int, (item.MonIdMoneda === 'USD' || item.MonIdMoneda === 2 || item.Moneda === 'USD') ? 2 : 1) // Guardar MonIdMoneda (fallback)
                        .input('min', sql.Int, item.CantidadMinima || 1)
                        .query("INSERT INTO PerfilesItems (PerfilID, ProIdProducto, CodGrupo, TipoRegla, Valor, MonIdMoneda, CantidadMinima) VALUES (@pid, @proId, @grupo, @tipo, @val, @mon, @min)");
                }
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
        logger.info("Fetching customer assignments with PerfilesIDs...");
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT DISTINCT
                COALESCE(C.CliIdCliente, PE.CliIdCliente) as ClienteID,
                PE.PerfilesIDs,
                (
                    SELECT COUNT(*) 
                    FROM PreciosEspecialesItems 
                    WHERE CliIdCliente = COALESCE(C.CliIdCliente, PE.CliIdCliente) 
                       OR ClienteID = COALESCE(C.CliIdCliente, PE.CliIdCliente)
                       OR (C.CodCliente IS NOT NULL AND (CliIdCliente = C.CodCliente OR ClienteID = C.CodCliente))
                ) as CantReglas
            FROM PreciosEspeciales PE
            LEFT JOIN Clientes C ON C.CodCliente = PE.CliIdCliente OR C.CliIdCliente = PE.CliIdCliente
        `);
        res.json(result.recordset);
    } catch (e) {
        logger.error("SQL Error in getAllCustomersWithProfile:", e); // Log detallado
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
        
        // Resolve target CliIdCliente and CodCliente from Clientes
        const clientRes = await pool.request()
            .input('CID', sql.Int, clienteId)
            .query("SELECT CliIdCliente, CodCliente FROM Clientes WHERE CliIdCliente = @CID OR CodCliente = @CID");

        let targetCliId = clienteId;
        let targetCodCliente = clienteId;
        if (clientRes.recordset.length > 0) {
            targetCliId = clientRes.recordset[0].CliIdCliente; // always use the internal CliIdCliente
            targetCodCliente = clientRes.recordset[0].CodCliente;
        }

        // Upsert en PreciosEspeciales bajo targetCliId
        await pool.request()
            .input('CID', sql.Int, targetCliId)
            .input('CodCli', sql.Int, targetCodCliente)
            .input('PIDs', sql.NVarChar, pidsStr)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM PreciosEspeciales WHERE CliIdCliente = @CID)
                BEGIN
                    INSERT INTO PreciosEspeciales (CliIdCliente, ClienteID, PerfilesIDs) VALUES (@CID, @CodCli, @PIDs)
                END
                ELSE
                BEGIN
                    UPDATE PreciosEspeciales SET 
                        PerfilesIDs = @PIDs,
                        ClienteID = @CodCli,
                        UltimaActualizacion = GETDATE()
                    WHERE CliIdCliente = @CID
                END
            `);

        res.json({ success: true });
    } catch (e) {
        logger.error("Error assigning profile:", e);
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
