const { getPool, sql } = require('../config/db');
const fs = require('fs');
const path = require('path');
const driveService = require('../services/driveService');

// Helper to save base64 file to Google Drive
const saveFileToDrive = async (base64Data, fileName, areaName) => {
    if (!base64Data || !fileName) return null;
    try {
        return await driveService.uploadToDrive(base64Data, fileName, areaName);
    } catch (e) {
        console.error('Error saving file to Drive:', e);
        return null;
    }
};

exports.createClientOrder = async (req, res) => {
    const {
        serviceId,
        jobName,
        subtype, // e.g. 'DTF Común'
        urgency,
        globalMaterial,
        items, // Array of { file: { name, data }, copies, material, note }
        generalNote,
        selectedComplementary
    } = req.body;

    const userId = req.user ? req.user.id : null;
    const codCliente = req.user ? req.user.codCliente : null;
    const clientName = req.user ? (req.user.name || req.user.username) : 'Cliente Web'; // Si req.user.name is "Empresa" or "Nombre"

    // Map Service ID to Area ID (Backend constraints)
    // Adjust these mappings based on your backend Areas table
    const serviceToArea = {
        'dtf': 'DTF',
        'DF': 'DTF',
        'sublimacion_tela': 'SUB',
        'sublimacion_rigidos': 'SUB', // Example
        'corte_laser': 'LASER',
        'bordado': 'BORD',
        'directa_320': 'ECOUV', // Maybe? Or PLOTTER
        'docu_color': 'IMPRENTA',
        'carteleria': 'PLOTTER'
    };

    // Default fallback
    const areaId = serviceToArea[serviceId] || 'GENE';

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        // 1. Create Base Order
        const requestOrder = new sql.Request(transaction);
        const resultOrder = await requestOrder
            .input('AreaID', sql.VarChar(20), areaId)
            // Use CodCliente if available, else 0 or fallback
            // IMPORTANT: If 'Cliente' column is Name, use Name. If you have CodCliente column, populate it.
            // Based on schema check: Ordenes has 'CodCliente' (int?) and 'Cliente' (varchar)
            .input('Cliente', sql.NVarChar(200), clientName)
            .input('CodCliente', sql.Int, codCliente || null) // <--- Populate CodCliente
            .input('Descripcion', sql.NVarChar(300), jobName)
            .input('Prioridad', sql.VarChar(20), urgency === 'urgente' ? 'Alta' : 'Normal')
            .input('Material', sql.VarChar(255), globalMaterial || subtype || '')
            .input('Variante', sql.VarChar(100), subtype || '') // Use subtype as variant if global material not present
            .input('Nota', sql.NVarChar(sql.MAX), generalNote)
            .input('ArchivosCount', sql.Int, items ? items.length : 0)
            .input('IdUsuario', sql.Int, userId)
            // Extra JSON metadata for specifics
            .input('MetaData', sql.NVarChar(sql.MAX), JSON.stringify({
                serviceId,
                subtype,
                complementary: selectedComplementary,
                webUserId: userId
            }))
            .query(`
                INSERT INTO dbo.Ordenes (
                    AreaID, Cliente, CodCliente, DescripcionTrabajo, Prioridad, 
                    Material, Variante, Nota, ArchivosCount, 
                    Estado, FechaIngreso, meta_data
                )
                OUTPUT INSERTED.OrdenID
                VALUES (
                    @AreaID, @Cliente, @CodCliente, @Descripcion, @Prioridad, 
                    @Material, @Variante, @Nota, @ArchivosCount, 
                    'Pendiente', GETDATE(), @MetaData
                )
            `);

        const newOrderId = resultOrder.recordset[0].OrdenID;

        // 2. Process Items and Files
        if (items && items.length > 0) {
            for (const item of items) {
                // Save Main File
                let fileUrl = null;
                if (item.file && item.file.data) {
                    fileUrl = await saveFileToDrive(item.file.data, item.file.name, areaId);
                }

                // Save Back File (if exists)
                let fileBackUrl = null;
                if (item.fileBack && item.fileBack.data) {
                    fileBackUrl = await saveFileToDrive(item.fileBack.data, item.fileBack.name, areaId);
                }

                if (fileUrl) {
                    const reqFile = new sql.Request(transaction);
                    await reqFile
                        .input('OID', sql.Int, newOrderId)
                        .input('Nombre', sql.VarChar(200), item.file.name)
                        .input('Ruta', sql.VarChar(500), fileUrl)
                        .input('Tipo', sql.VarChar(50), 'Production')
                        .input('Copias', sql.Int, item.copies || 1)
                        .input('Notas', sql.NVarChar(sql.MAX), item.note || '')
                        .query(`
                            INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Observaciones, FechaSubida)
                            VALUES (@OID, @Nombre, @Ruta, @Tipo, @Copias, @Notas, GETDATE())
                        `);
                }

                if (fileBackUrl) {
                    const reqFileBack = new sql.Request(transaction);
                    await reqFileBack
                        .input('OID', sql.Int, newOrderId)
                        .input('Nombre', sql.VarChar(200), 'DORSO-' + item.fileBack.name)
                        .input('Ruta', sql.VarChar(500), fileBackUrl)
                        .input('Tipo', sql.VarChar(50), 'Back')
                        .input('Copias', sql.Int, item.copies || 1)
                        .query(`
                            INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, FechaSubida)
                            VALUES (@OID, @Nombre, @Ruta, @Tipo, @Copias, GETDATE())
                        `);
                }
            }
        }

        // 3. Log History
        await new sql.Request(transaction)
            .input('OID', sql.Int, newOrderId)
            .input('User', sql.VarChar, String(userId || 'Guest'))
            .input('Det', sql.NVarChar, 'Pedido Web Creado')
            .query(`
                INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                VALUES (@OID, 'Pendiente', GETDATE(), GETDATE(), @User, @Det)
            `);

        await transaction.commit();
        res.json({ success: true, orderId: newOrderId });

    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("Error creating client order:", err);
        res.status(500).json({ error: err.message });
    }
};
