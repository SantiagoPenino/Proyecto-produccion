const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// Historial: excepciones del cliente y asignación de perfiles (ver services/historialPrecios.js)
const { leerReglasCliente, leerPerfilesCliente, guardarHistorialCliente, registrarAsignaciones } = require('../services/historialPrecios');

// ── Validación de lo que llega (plan INF-SIS-2026-12, punto 2.2) ──────────────────────────────────
// Frena el guardado entero (no se borra nada) si una regla no se puede aplicar bien. Los % negativos
// SÍ valen: son recargos (5 clientes los tienen). Precio fijo 0 también vale: el motor lo acepta a
// propósito en las excepciones de un cliente. La familia sin código solo se rechaza si es nueva:
// hay reglas viejas así (clientes 28, 101, 347, 806) que la pantalla reenvía tal cual.
const TIPOS_REGLA = ['percentage', 'percentage_discount', 'fixed', 'fixed_price', 'subtract'];
const numUY = v => Number(v).toLocaleString('es-UY', { maximumFractionDigits: 4 });

const validarReglas = (rules, reglasAntes) => {
    const habiaFamiliaSinCodigo = reglasAntes.some(r => r.ProIdProducto == null && !(r.CodGrupo || '').trim());
    const problemas = [];
    (rules || []).forEach(rule => {
        const cod = (rule.CodArticulo || '').toString();
        const tipo = rule.TipoRegla || 'fixed';
        const v = Number(rule.Valor);
        const regla = { cod, proId: rule.ProIdProducto };
        if (!TIPOS_REGLA.includes(tipo)) {
            problemas.push({ ...regla, texto: `tiene un tipo de regla que el sistema no conoce («${tipo}»)`, solucion: 'volvé a cargarla como descuento, precio fijo o importe por unidad' });
        } else if (rule.Valor === null || rule.Valor === undefined || rule.Valor === '' || !Number.isFinite(v)) {
            problemas.push({ ...regla, texto: 'no tiene un valor numérico', solucion: 'cargá el porcentaje o el precio' });
        } else if (tipo.includes('percentage') && v > 100) {
            problemas.push({ ...regla, texto: `tiene un descuento de ${numUY(v)} %`, solucion: 'revisá el valor: un descuento va hasta 100 % (un % negativo es un recargo)' });
        } else if ((tipo === 'fixed' || tipo === 'fixed_price') && v < 0) {
            problemas.push({ ...regla, texto: `tiene un precio fijo negativo (${numUY(v)})`, solucion: 'el precio fijo va de 0 para arriba' });
        } else if (tipo === 'subtract' && v < 0) {
            problemas.push({ ...regla, texto: `tiene un descuento por unidad negativo (${numUY(v)})`, solucion: 'cargá un importe mayor a 0' });
        }
        if (cod.startsWith('GRUPO:') && !cod.replace('GRUPO:', '').trim() && !habiaFamiliaSinCodigo) {
            problemas.push({ ...regla, texto: 'no tiene código de familia', solucion: 'elegí la familia de la lista' });
        }
    });
    return problemas;
};

// «La regla de DTF textil COMUN tiene un descuento de 180 %. Solución: revisá el valor; …»
const mensajeProblemas = async (transaction, problemas) => {
    const ids = [...new Set(problemas.map(p => parseInt(p.proId, 10)).filter(n => Number.isInteger(n) && n > 0))];
    const nombres = {};
    if (ids.length) {
        (await new sql.Request(transaction).query(`SELECT ProIdProducto, LTRIM(RTRIM(Descripcion)) AS Descripcion FROM Articulos WHERE ProIdProducto IN (${ids.join(',')})`))
            .recordset.forEach(r => { nombres[r.ProIdProducto] = r.Descripcion; });
    }
    return problemas.map(p => {
        const nombre = p.cod === 'TOTAL' ? 'la regla general'
            : p.cod.startsWith('GRUPO:') ? (p.cod.replace('GRUPO:', '').trim() ? `la familia ${p.cod.replace('GRUPO:', '').trim()}` : 'una familia nueva')
            : (nombres[parseInt(p.proId, 10)] || `el artículo ${p.cod}`);
        return `La regla de ${nombre} ${p.texto}. Solución: ${p.solucion}.`;
    }).join(' ');
};

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
            // Cómo estaba la tarifa antes de tocarla (para validar y para el historial)
            const reglasAntes = await leerReglasCliente(transaction, targetCliId, targetCodCliente);
            const perfilesAntes = await leerPerfilesCliente(transaction, targetCliId, targetCodCliente);

            const problemas = validarReglas(rules, reglasAntes);
            if (problemas.length > 0) {
                const mensaje = await mensajeProblemas(transaction, problemas);
                await transaction.rollback();
                logger.warn(`[PRECIOS-ESP] Guardar tarifa del cliente ${targetCliId} frenado: ${mensaje}`);
                return res.status(400).json({ error: mensaje, problemas });
            }

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
            const reglasDespues = [];
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
                        const tipo = rule.TipoRegla || 'fixed';
                        const valor = rule.Valor || 0;
                        const monIdMoneda = (rule.MonIdMoneda === 'USD' || rule.MonIdMoneda === 2 || rule.Moneda === 'USD') ? 2 : 1;
                        const minCantidad = rule.MinCantidad || 0;
                        await itemReq
                            .input('CliId', sql.Int, targetCliId)
                            .input('CodCli', sql.Int, targetCodCliente)
                            .input('ProId', sql.Int, finalProIdProducto)
                            .input('CodArt', sql.NVarChar, codArtStr)
                            .input('Grupo', sql.VarChar, finalCodGrupo)
                            .input('Tipo', sql.NVarChar, tipo)
                            .input('Val', sql.Decimal(18, 4), valor)
                            .input('MonIdMoneda', sql.Int, monIdMoneda)
                            .input('Min', sql.Decimal(18, 2), minCantidad)
                            .query(`
                                INSERT INTO PreciosEspecialesItems (CliIdCliente, ClienteID, CodArticulo, ProIdProducto, CodGrupo, TipoRegla, Valor, MonIdMoneda, MinCantidad)
                                VALUES (@CliId, @CodCli, @CodArt, @ProId, @Grupo, @Tipo, @Val, @MonIdMoneda, @Min)
                            `);
                        reglasDespues.push({ CodArticulo: codArtStr.trim(), ProIdProducto: finalProIdProducto, CodGrupo: finalCodGrupo, TipoRegla: tipo, Valor: Number(valor), MonIdMoneda: monIdMoneda, MinCantidad: Number(minCantidad) });
                    }
                }
            }

            await guardarHistorialCliente(transaction, {
                cliId: targetCliId, origen: 'GUARDAR_TARIFA', user: req.user,
                antes: reglasAntes, despues: reglasDespues,
                perfilesAntes, perfilesDespues: finalPerfilesIDs
            });
            await registrarAsignaciones(transaction, { cliId: targetCliId, perfilesAntes, perfilesDespues: finalPerfilesIDs, user: req.user, desde: 'Precios especiales' });

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
            const reglasAntes = await leerReglasCliente(transaction, targetCliId, targetCodCliente);
            const perfilesAntes = await leerPerfilesCliente(transaction, targetCliId, targetCodCliente);

            await new sql.Request(transaction)
                .input('CliId', sql.Int, targetCliId)
                .input('CodCli', sql.Int, targetCodCliente)
                .query("DELETE FROM PreciosEspecialesItems WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)");
            
            await new sql.Request(transaction)
                .input('CliId', sql.Int, targetCliId)
                .input('CodCli', sql.Int, targetCodCliente)
                .query("DELETE FROM PreciosEspeciales WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)");

            await guardarHistorialCliente(transaction, {
                cliId: targetCliId, origen: 'QUITAR_CLIENTE', user: req.user,
                antes: reglasAntes, despues: [],
                perfilesAntes, perfilesDespues: null
            });
            await registrarAsignaciones(transaction, { cliId: targetCliId, perfilesAntes, perfilesDespues: null, user: req.user, desde: 'Quitar cliente' });

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
