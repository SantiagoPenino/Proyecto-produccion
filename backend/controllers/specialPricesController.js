const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// Obtener Lista de Clientes Especiales
const getClients = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            WITH CombinedClients AS (
                SELECT DISTINCT 
                    COALESCE(C.CliIdCliente, PE.CliIdCliente) as ClienteID,
                    C.Nombre,
                    C.NombreFantasia,
                    C.IDCliente,
                    C.CioRuc,
                    C.Email,
                    C.TelefonoTrabajo,
                    C.DireccionTrabajo
                FROM PreciosEspeciales PE
                LEFT JOIN Clientes C ON C.CodCliente = PE.CliIdCliente OR C.CliIdCliente = PE.CliIdCliente
            )
            SELECT 
                CC.ClienteID,
                CC.Nombre,
                CC.NombreFantasia,
                CC.IDCliente,
                CC.CioRuc,
                CC.Email,
                CC.TelefonoTrabajo,
                CC.DireccionTrabajo,
                (
                    SELECT COUNT(*) 
                    FROM PreciosEspecialesItems PI
                    LEFT JOIN Clientes C2 ON C2.CliIdCliente = CC.ClienteID
                    WHERE PI.CliIdCliente = CC.ClienteID 
                       OR PI.ClienteID = CC.ClienteID
                       OR (C2.CodCliente IS NOT NULL AND (PI.CliIdCliente = C2.CodCliente OR PI.ClienteID = C2.CodCliente))
                ) as CantReglas
            FROM CombinedClients CC
            ORDER BY COALESCE(CC.Nombre, CAST(CC.ClienteID AS VARCHAR))
        `);
        res.json(result.recordset);
    } catch (e) {
        logger.error("Error getting special clients:", e);
        res.status(500).json({ error: e.message });
    }
};

// Obtener Reglas de un Cliente
const getClientRules = async (req, res) => {
    const { clientId } = req.params;
    try {
        const pool = await getPool();
        // 1. Buscamos el cliente en la tabla Clientes
        const clientRes = await pool.request()
            .input('CID', sql.Int, clientId)
            .query(`
                SELECT CliIdCliente, CodCliente, Nombre, NombreFantasia, IDCliente, CioRuc, Email, TelefonoTrabajo, DireccionTrabajo
                FROM Clientes
                WHERE CliIdCliente = @CID OR CodCliente = @CID
            `);

        let clientInfo = null;
        let dbCliId = null;
        let dbCodCliente = null;

        if (clientRes.recordset.length > 0) {
            clientInfo = clientRes.recordset[0];
            dbCliId = clientInfo.CliIdCliente;
            dbCodCliente = clientInfo.CodCliente;
        }

        // 2. Si no existe en la tabla Clientes, intentamos buscar en PreciosEspeciales
        if (!clientInfo) {
            const peRes = await pool.request()
                .input('CID', sql.Int, clientId)
                .query(`
                    SELECT CliIdCliente, ClienteID, NombreCliente as Nombre 
                    FROM PreciosEspeciales 
                    WHERE CliIdCliente = @CID OR ClienteID = @CID
                `);
            if (peRes.recordset.length > 0) {
                const peRow = peRes.recordset[0];
                clientInfo = {
                    CliIdCliente: peRow.CliIdCliente,
                    CodCliente: peRow.ClienteID,
                    Nombre: peRow.Nombre || `Cliente ${clientId}`
                };
                dbCliId = peRow.CliIdCliente;
                dbCodCliente = peRow.ClienteID;
            }
        }

        if (!clientInfo) {
            return res.status(404).json({ error: "Cliente no encontrado" });
        }

        // 3. Obtener todas las reglas (items) para este cliente, usando ambos IDs
        const itemsRes = await pool.request()
            .input('CliId', sql.Int, dbCliId)
            .input('CodCli', sql.Int, dbCodCliente)
            .query(`
                SELECT LTRIM(RTRIM(COALESCE(PI.CodGrupo, A.CodArticulo, CASE WHEN PI.ProIdProducto = 0 THEN 'TOTAL' ELSE CAST(PI.ProIdProducto AS VARCHAR) END))) as CodArticulo, 
                       PI.ProIdProducto, PI.CodGrupo, PI.TipoRegla, PI.Valor, PI.MonIdMoneda as Moneda, PI.MinCantidad as CantidadMinima 
                FROM PreciosEspecialesItems PI
                LEFT JOIN Articulos A ON PI.ProIdProducto = A.ProIdProducto
                WHERE PI.CliIdCliente IN (@CliId, @CodCli) OR PI.ClienteID IN (@CliId, @CodCli)
            `);

        // 4. Obtener todos los perfiles de precios vinculados en PreciosEspeciales para ambos IDs
        let profiles = [];
        const peProfilesRes = await pool.request()
            .input('CliId', sql.Int, dbCliId)
            .input('CodCli', sql.Int, dbCodCliente)
            .query(`
                SELECT DISTINCT PerfilesIDs 
                FROM PreciosEspeciales 
                WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)
            `);

        // Recolectar y parsear todos los perfiles asignados
        let perfilesSet = new Set();
        peProfilesRes.recordset.forEach(row => {
            if (row.PerfilesIDs) {
                row.PerfilesIDs.split(',')
                    .map(id => parseInt(id.trim()))
                    .filter(id => !isNaN(id))
                    .forEach(id => perfilesSet.add(id));
            }
        });

        const perfilesList = Array.from(perfilesSet);
        if (perfilesList.length > 0) {
            const perfilesRes = await pool.request()
                .query("SELECT ID, Nombre as NombrePerfil, EsGlobal as [Global] FROM PerfilesPrecios WHERE Activo = 1");
            const allProfiles = perfilesRes.recordset || [];
            profiles = allProfiles.filter(p => perfilesList.includes(p.ID));
        }

        res.json({
            client: clientInfo,
            rules: itemsRes.recordset,
            profiles: profiles
        });
    } catch (e) {
        logger.error("Error getting client rules:", e);
        res.status(500).json({ error: e.message });
    }
};

// Guardar/Actualizar Perfil de Cliente
const saveClientProfile = async (req, res) => {
    const { clientId, nombre, rules, profileIds } = req.body; // rules: [{ CodArticulo, TipoRegla, Valor, Moneda, MinCantidad }]

    if (!clientId) return res.status(400).json({ error: "Falta ClientID" });

    try {
        const pool = await getPool();
        // 1. Buscar el cliente en la tabla Clientes para obtener ambos IDs
        const clientRes = await pool.request()
            .input('CID', sql.Int, clientId)
            .query("SELECT CliIdCliente, CodCliente FROM Clientes WHERE CliIdCliente = @CID OR CodCliente = @CID");

        let targetCliId = clientId;
        let targetCodCliente = clientId;
        if (clientRes.recordset.length > 0) {
            targetCliId = clientRes.recordset[0].CliIdCliente; // always use identity as main key
            targetCodCliente = clientRes.recordset[0].CodCliente;
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 2. Determinar perfiles a asignar
            let finalPerfilesIDs = null;
            if (profileIds && Array.isArray(profileIds)) {
                finalPerfilesIDs = profileIds.length > 0 ? profileIds.join(',') : null;
            } else {
                // Obtener perfiles existentes de cualquier registro duplicado para no perderlos
                const profilesRes = await new sql.Request(transaction)
                    .input('CliId', sql.Int, targetCliId)
                    .input('CodCli', sql.Int, targetCodCliente)
                    .query(`
                        SELECT DISTINCT PerfilesIDs 
                        FROM PreciosEspeciales 
                        WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)
                    `);
                
                let perfilesSet = new Set();
                profilesRes.recordset.forEach(row => {
                    if (row.PerfilesIDs) {
                        row.PerfilesIDs.split(',')
                            .map(id => id.trim())
                            .filter(Boolean)
                            .forEach(id => perfilesSet.add(id));
                    }
                });
                finalPerfilesIDs = perfilesSet.size > 0 ? Array.from(perfilesSet).join(',') : null;
            }

            // 3. Eliminar registros duplicados/antiguos tanto en PreciosEspeciales como en PreciosEspecialesItems
            await new sql.Request(transaction)
                .input('CliId', sql.Int, targetCliId)
                .input('CodCli', sql.Int, targetCodCliente)
                .query(`
                    DELETE FROM PreciosEspeciales 
                    WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)
                `);

            await new sql.Request(transaction)
                .input('CliId', sql.Int, targetCliId)
                .input('CodCli', sql.Int, targetCodCliente)
                .query(`
                    DELETE FROM PreciosEspecialesItems 
                    WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)
                `);

            // 4. Insertar una única fila cabecera en PreciosEspeciales con el CliIdCliente e IDCliente/ClienteID correcto
            const headerReq = new sql.Request(transaction);
            await headerReq
                .input('CliId', sql.Int, targetCliId)
                .input('CodCli', sql.Int, targetCodCliente)
                .input('Nombre', sql.NVarChar, nombre || '')
                .input('PIDs', sql.NVarChar, finalPerfilesIDs)
                .query(`
                    INSERT INTO PreciosEspeciales (CliIdCliente, ClienteID, NombreCliente, PerfilesIDs, FechaCreacion, UltimaActualizacion) 
                    VALUES (@CliId, @CodCli, @Nombre, @PIDs, GETDATE(), GETDATE())
                `);

            // 5. Insertar Nuevos Items bajo el targetCliId
            if (rules && rules.length > 0) {
                for (const rule of rules) {
                    const itemReq = new sql.Request(transaction);

                    const codArtStr = (rule.CodArticulo || '').toString();
                    let finalProIdProducto = rule.ProIdProducto !== undefined ? rule.ProIdProducto : null;
                    let finalCodGrupo = rule.CodGrupo || null;

                    if (codArtStr === 'TOTAL') {
                        finalProIdProducto = 0;
                        finalCodGrupo = null;
                    } else if (codArtStr.startsWith('GRUPO:')) {
                        finalProIdProducto = null;
                        finalCodGrupo = codArtStr.replace('GRUPO:', '').trim();
                    }

                    if (finalProIdProducto !== null || finalCodGrupo !== null) {
                        await itemReq
                            .input('CliId', sql.Int, targetCliId)
                            .input('CodCli', sql.Int, targetCodCliente)
                            .input('ProId', sql.Int, finalProIdProducto)
                            .input('CodArt', sql.NVarChar, codArtStr)
                            .input('Grupo', sql.VarChar, finalCodGrupo)
                            .input('Tipo', sql.NVarChar, rule.TipoRegla || 'fixed')
                            .input('Val', sql.Decimal(18, 4), rule.Valor || 0)
                            .input('MonIdMoneda', sql.Int, (rule.MonIdMoneda === 'USD' || rule.MonIdMoneda === 2 || rule.Moneda === 'USD') ? 2 : 1)
                            .input('Min', sql.Decimal(18, 2), rule.MinCantidad || 0)
                            .query(`
                                INSERT INTO PreciosEspecialesItems (CliIdCliente, ClienteID, CodArticulo, ProIdProducto, CodGrupo, TipoRegla, Valor, MonIdMoneda, MinCantidad)
                                VALUES (@CliId, @CodCli, @CodArt, @ProId, @Grupo, @Tipo, @Val, @MonIdMoneda, @Min)
                            `);
                    }
                }
            }

            await transaction.commit();
            res.json({ success: true, message: "Perfil guardado correctamente" });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (e) {
        logger.error("Error saving client profile:", e);
        res.status(500).json({ error: e.message });
    }
};

// Eliminar Cliente
const deleteClient = async (req, res) => {
    const { clientId } = req.params;

    try {
        const pool = await getPool();
        const clientRes = await pool.request()
            .input('CID', sql.Int, clientId)
            .query("SELECT CliIdCliente, CodCliente FROM Clientes WHERE CliIdCliente = @CID OR CodCliente = @CID");

        let targetCliId = clientId;
        let targetCodCliente = clientId;
        if (clientRes.recordset.length > 0) {
            targetCliId = clientRes.recordset[0].CliIdCliente;
            targetCodCliente = clientRes.recordset[0].CodCliente;
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            await new sql.Request(transaction)
                .input('CliId', sql.Int, targetCliId)
                .input('CodCli', sql.Int, targetCodCliente)
                .query("DELETE FROM PreciosEspecialesItems WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)");
            
            await new sql.Request(transaction)
                .input('CliId', sql.Int, targetCliId)
                .input('CodCli', sql.Int, targetCodCliente)
                .query("DELETE FROM PreciosEspeciales WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)");

            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (e) {
        logger.error("Error deleting special prices client:", e);
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getClients,
    getClientRules,
    saveClientProfile,
    deleteClient
};
