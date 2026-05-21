const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// Obtener Lista de Clientes Especiales
const getClients = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                PE.CliIdCliente as ClienteID,
                C.Nombre,
                C.NombreFantasia,
                C.IDCliente,
                (SELECT COUNT(*) FROM PreciosEspecialesItems WHERE CliIdCliente = PE.CliIdCliente) as CantReglas
            FROM PreciosEspeciales PE
            LEFT JOIN Clientes C ON C.CodCliente = PE.CliIdCliente OR C.CliIdCliente = PE.CliIdCliente
            ORDER BY COALESCE(C.Nombre, CAST(PE.CliIdCliente AS VARCHAR))
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
        // 1. Verificar si existe el cliente
        const clientRes = await pool.request()
            .input('CID', sql.Int, clientId)
            .query("SELECT * FROM PreciosEspeciales WHERE CliIdCliente = @CID");

        if (clientRes.recordset.length === 0) {
            return res.status(404).json({ error: "Cliente no encontrado" });
        }

        // 2. Obtener Items
        const itemsRes = await pool.request()
            .input('CID', sql.Int, clientId)
            .query(`
                SELECT LTRIM(RTRIM(COALESCE(PI.CodGrupo, A.CodArticulo, CASE WHEN PI.ProIdProducto = 0 THEN 'TOTAL' ELSE CAST(PI.ProIdProducto AS VARCHAR) END))) as CodArticulo, 
                       PI.ProIdProducto, PI.CodGrupo, PI.TipoRegla, PI.Valor, PI.MonIdMoneda as Moneda, PI.MinCantidad as CantidadMinima 
                FROM PreciosEspecialesItems PI
                LEFT JOIN Articulos A ON PI.ProIdProducto = A.ProIdProducto
                WHERE PI.CliIdCliente = @CID OR PI.ClienteID = @CID
            `);

        // 3. Obtener Perfiles Generales Asignados (Manejo seguro si la tabla no existe en la migración)
        let profiles = [];
        try {
            const perfilesRes = await pool.request()
                .input('CID', sql.Int, clientId)
                .query(`
                    IF OBJECT_ID('ClientePerfil', 'U') IS NOT NULL AND OBJECT_ID('Perfiles', 'U') IS NOT NULL
                    BEGIN
                        SELECT P.NombrePerfil, P.Global, CP.FechaAsignacion
                        FROM ClientePerfil CP
                        JOIN Perfiles P ON CP.PerfilID = P.PerfilID
                        WHERE CP.ClienteID = @CID AND CP.Activo = 1 AND P.Activo = 1
                    END
                `);
            profiles = perfilesRes.recordset || [];
        } catch(e) {
            // Ignorar si las tablas de perfiles no están migradas
        }

        res.json({
            client: clientRes.recordset[0] || { CliIdCliente: clientId },
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
    const { clientId, nombre, rules } = req.body; // rules: [{ CodArticulo, TipoRegla, Valor, Moneda, MinCantidad }]

    if (!clientId) return res.status(400).json({ error: "Falta ClientID" });

    const transaction = new sql.Transaction(await getPool());
    try {
        await transaction.begin();

        // 1. Upsert Cabecera
        const headerReq = new sql.Request(transaction);
        await headerReq
            .input('CliId', sql.Int, clientId)
            .input('Nombre', sql.NVarChar, nombre || '')
            .query(`
                IF NOT EXISTS (SELECT 1 FROM PreciosEspeciales WHERE CliIdCliente = @CliId OR ClienteID = @CliId)
                BEGIN
                    INSERT INTO PreciosEspeciales (CliIdCliente, ClienteID, NombreCliente) 
                    VALUES (@CliId, @CliId, @Nombre)
                END
                ELSE
                BEGIN
                    UPDATE PreciosEspeciales 
                    SET UltimaActualizacion = GETDATE(), NombreCliente = @Nombre 
                    WHERE CliIdCliente = @CliId OR ClienteID = @CliId
                END
            `);

        // 2. Limpiar Items Anteriores
        const delReq = new sql.Request(transaction);
        await delReq.input('CID', sql.Int, clientId).query("DELETE FROM PreciosEspecialesItems WHERE CliIdCliente = @CID");

        // 3. Insertar Nuevos Items
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
                        .input('CliId', sql.Int, clientId)
                        .input('ProId', sql.Int, finalProIdProducto)
                        .input('CodArt', sql.NVarChar, codArtStr)
                        .input('Grupo', sql.VarChar, finalCodGrupo)
                        .input('Tipo', sql.NVarChar, rule.TipoRegla || 'fixed')
                        .input('Val', sql.Decimal(18, 4), rule.Valor || 0)
                        .input('MonIdMoneda', sql.Int, (rule.MonIdMoneda === 'USD' || rule.MonIdMoneda === 2 || rule.Moneda === 'USD') ? 2 : 1)
                        .input('Min', sql.Decimal(18, 2), rule.MinCantidad || 0)
                        .query(`
                            INSERT INTO PreciosEspecialesItems (CliIdCliente, ClienteID, CodArticulo, ProIdProducto, CodGrupo, TipoRegla, Valor, MonIdMoneda, MinCantidad)
                            VALUES (@CliId, @CliId, @CodArt, @ProId, @Grupo, @Tipo, @Val, @MonIdMoneda, @Min)
                        `);
                }
            }
        }

        await transaction.commit();
        res.json({ success: true, message: "Perfil guardado correctamente" });

    } catch (e) {
        if (transaction._begun) await transaction.rollback();
        logger.error("Error saving client profile:", e);
        res.status(500).json({ error: e.message });
    }
};

// Eliminar Cliente
const deleteClient = async (req, res) => {
    const { clientId } = req.params;

    const transaction = new sql.Transaction(await getPool());
    try {
        await transaction.begin();

        await new sql.Request(transaction).input('CID', sql.Int, clientId).query("DELETE FROM PreciosEspecialesItems WHERE CliIdCliente = @CID");
        await new sql.Request(transaction).input('CID', sql.Int, clientId).query("DELETE FROM PreciosEspeciales WHERE CliIdCliente = @CID");

        await transaction.commit();
        res.json({ success: true });
    } catch (e) {
        if (transaction._begun) await transaction.rollback();
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getClients,
    getClientRules,
    saveClientProfile,
    deleteClient
};
