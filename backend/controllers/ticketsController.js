const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { moverArchivosATicket } = require('../middleware/multerTicketsConfig');

// ─────────────────────────────────────────────────────────────────────────────
// DEPARTAMENTOS / CATEGORIAS (Ruteo Dinámico)
// ─────────────────────────────────────────────────────────────────────────────
exports.getCategorias = async (req, res) => {
    try {
        const isClient = req.user && req.user.role === 'WEB_CLIENT';
        const pool = await getPool();

        // Si es cliente, filtramos los departamentos que sean "Públicos Web"
        // Si no existe la configuración, mandamos un mapeo hardcodeado hasta que creen la tabla
        
        let query = `
            SELECT DepIdDepartamento as ID, DepNombre as Nombre, DepAplicaClienteWeb as AplicaWeb 
            FROM Tickets_Departamentos 
            WHERE DepActivo = 1
        `;
        
        if (isClient) {
            query += ` AND DepAplicaClienteWeb = 1`;
        }

        query += ` ORDER BY DepOrden ASC`;

        try {
            const result = await pool.request().query(query);
            if (result.recordset.length > 0) {
                return res.json({ success: true, data: result.recordset });
            } else {
                return res.json({ success: true, data: [] });
            }
        } catch (e) {
            // Fallback si la tabla aún no fue creada
            const fakeData = isClient ? [
                { ID: 1, Nombre: "Reclamo de Calidad / Producción" },
                { ID: 2, Nombre: "Consultas de Finanzas / Pagos" },
                { ID: 3, Nombre: "Dudas sobre mi Envío / Logística" },
                { ID: 4, Nombre: "Presupuestos / Área de Ventas" },
                { ID: 5, Nombre: "Cambios en mi Diseño / Pre-Prensa" }
            ] : [
                { ID: 1, Nombre: "Producción y Calidad" },
                { ID: 2, Nombre: "Finanzas y Contabilidad" },
                { ID: 3, Nombre: "Logística y Despacho" },
                { ID: 4, Nombre: "Ventas / Comercial" },
                { ID: 5, Nombre: "Archivo y Diseño" },
                { ID: 10, Nombre: "Mantenimiento Preventivo" },
                { ID: 11, Nombre: "Sistemas ERP/Web" },
                { ID: 12, Nombre: "Soporte General Operativo" }
            ];
            return res.json({ success: true, data: fakeData });
        }

    } catch (err) {
        logger.error('Error en getCategorias Tickets:', err.message);
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREACIÓN DE UN NUEVO TICKET
// ─────────────────────────────────────────────────────────────────────────────
exports.createTicket = async (req, res) => {
    try {
        const { asunto, departamentoId, prioridad, descripcion, ordenId } = req.body;
        const isClient = req.user && req.user.role === 'WEB_CLIENT';
        
        const cliIdCliente = isClient ? req.user.id : null;
        const usrIdCreador = !isClient ? req.user.id : null; // Asumiendo que admins tienen id en req.user
        
        if (!asunto || !departamentoId || !descripcion) {
            return res.status(400).json({ error: 'El asunto, área y descripción son requeridos.' });
        }

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Insertar Cabecera
            const ticketResult = await transaction.request()
                .input('CliId', sql.Int, cliIdCliente)
                .input('UsrId', sql.Int, usrIdCreador)
                .input('DepId', sql.Int, parseInt(departamentoId))
                .input('OrdId', sql.Int, ordenId ? parseInt(ordenId) : null)
                .input('Asunto', sql.NVarChar(200), asunto)
                .input('Prio', sql.Int, parseInt(prioridad) || 2) // Default Media
                .query(`
                    INSERT INTO Tickets (CliIdCliente, UsrIdCreador, DepIdDepartamento, OrdIdOrden, TicAsunto, TicPrioridad, TicEstado, TicFechaAlta, TicFechaActualizacion)
                    OUTPUT INSERTED.TicIdTicket
                    VALUES (@CliId, @UsrId, @DepId, @OrdId, @Asunto, @Prio, 1, GETDATE(), GETDATE())
                `);
            
            const ticketId = ticketResult.recordset[0].TicIdTicket;

            // 2. Insertar Primer Mensaje
            const msgResult = await transaction.request()
                .input('TicId', sql.Int, ticketId)
                .input('UsrId', sql.Int, usrIdCreador)
                .input('CliId', sql.Int, cliIdCliente)
                .input('Txt', sql.NVarChar(sql.MAX), descripcion)
                .query(`
                    INSERT INTO Tickets_Mensajes (TicIdTicket, UsrIdAutor, CliIdAutor, TMenEsNotaInterna, TMenTexto, TMenFecha)
                    OUTPUT INSERTED.TMenIdMensaje
                    VALUES (@TicId, @UsrId, @CliId, 0, @Txt, GETDATE())
                `);
            
            const mensajeId = msgResult.recordset[0].TMenIdMensaje;

            // 3. Insertar Evidencia (Si hay archivos adjuntos vía Multer)
            // Primero movemos los archivos de temp/ a tickets/{ticketId}/
            const archivosMovidos = moverArchivosATicket(req.files, ticketId);

            if (archivosMovidos.length > 0) {
                for (const file of archivosMovidos) {
                    await transaction.request()
                        .input('MsgId', sql.Int, mensajeId)
                        .input('Ruta', sql.VarChar(500), file.filename)
                        .query(`
                            INSERT INTO Tickets_Adjuntos (TMenIdMensaje, TAdjRutaArchivo)
                            VALUES (@MsgId, @Ruta)
                        `);
                }
            }

            await transaction.commit();

            // Notificar al panel admin que llegó un ticket nuevo
            const io = req.app.get('socketio');
            if (io) {
                io.to('helpdesk:admin').emit('ticket:new', { ticketId, asunto, departamentoId });
            }

            res.status(201).json({ success: true, message: 'Ticket creado exitosamente.', ticketId });

        } catch (dbErr) {
            await transaction.rollback();
            throw dbErr;
        }

    } catch (err) {
        logger.error('Error al crear Ticket:', err.message);
        res.status(500).json({ error: 'Error interno al procesar su solicitud.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// LISTADO DE TICKETS (Bandeja)
// ─────────────────────────────────────────────────────────────────────────────
exports.getTickets = async (req, res) => {
    try {
        const isClient = req.user && req.user.role === 'WEB_CLIENT';
        const pool = await getPool();

        let query = `
            SELECT 
                T.TicIdTicket, T.TicAsunto, T.TicPrioridad, T.TicEstado, T.TicFechaActualizacion, T.DepIdDepartamento, T.OrdIdOrden,
                OD.OrdCodigoOrden,
                D.DepNombre as Departamento,
                (SELECT COUNT(*) FROM Tickets_Mensajes M WHERE M.TicIdTicket = T.TicIdTicket) as TotalMensajes
            FROM Tickets T
            LEFT JOIN Tickets_Departamentos D ON T.DepIdDepartamento = D.DepIdDepartamento
            LEFT JOIN OrdenesDeposito OD ON OD.OrdIdOrden = T.OrdIdOrden
            WHERE 1=1
        `;

        if (isClient) {
            query += ` AND T.CliIdCliente = @UserId `;
        }

        query += ` ORDER BY T.TicFechaActualizacion DESC`;

        const result = await pool.request()
            .input('UserId', sql.Int, isClient ? req.user.id : null)
            .query(query);

        res.json({ success: true, data: result.recordset });

    } catch (e) {
        logger.error('Error getTickets:', e.message);
        // Si falló por falta de tablas, devolver arreglo vacío para que el frontend no estalle
        res.json({ success: true, data: [] });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// MOSTRAR DETALLE E HILO DEL TICKET
// ─────────────────────────────────────────────────────────────────────────────
exports.getTicketDetails = async (req, res) => {
    try {
        const ticketId = req.params.id;
        const isClient = req.user && req.user.role === 'WEB_CLIENT';
        const clientId = req.user.id;
        const pool = await getPool();

        // CABECERA
        const tReq = pool.request().input('Id', sql.Int, ticketId);
        
        let tQuery = `
            SELECT T.*, D.DepNombre, C.Nombre as ClienteNombre, C.TelefonoTrabajo as ClienteCelular, C.Email as ClienteEmail,
                OD.OrdCodigoOrden
            FROM Tickets T
            LEFT JOIN Tickets_Departamentos D ON T.DepIdDepartamento = D.DepIdDepartamento
            LEFT JOIN Clientes C ON T.CliIdCliente = C.CodCliente
            LEFT JOIN OrdenesDeposito OD ON OD.OrdIdOrden = T.OrdIdOrden
            WHERE TicIdTicket = @Id
        `;
        // Seguridad cliente
        if (isClient) {
            tQuery += ` AND T.CliIdCliente = @CliId `;
            tReq.input('CliId', sql.Int, clientId);
        }

        const tRes = await tReq.query(tQuery);
        if (tRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado o sin permisos.' });
        }
        const ticket = tRes.recordset[0];

        // MENSAJES E HILO
        let mQuery = `
            SELECT M.*, 
                   C.Nombre as ClienteNombre, 
                   U.Nombre as EmpleadoNombre 
            FROM Tickets_Mensajes M
            LEFT JOIN Clientes C ON M.CliIdAutor = C.CodCliente
            LEFT JOIN dbo.Usuarios U ON M.UsrIdAutor = U.IdUsuario
            WHERE M.TicIdTicket = @Id
        `;
        
        // Si es un cliente, bloquear las notas de los empleados que son "EsNotaInterna = 1"
        if (isClient) {
            mQuery += ` AND M.TMenEsNotaInterna = 0 `;
        }
        mQuery += ` ORDER BY M.TMenFecha ASC`;

        const mRes = await pool.request()
            .input('Id', sql.Int, ticketId)
            .query(mQuery);
        
        let mensajes = mRes.recordset;

        // ADJUNTOS
        if (mensajes.length > 0) {
            const msgIds = mensajes.map(m => m.TMenIdMensaje);
            const aRes = await pool.request()
                .query(`SELECT * FROM Tickets_Adjuntos WHERE TMenIdMensaje IN (${msgIds.join(',')})`);
            
            // Asignar adjuntos a su respectivo mensaje
            mensajes.forEach(m => {
                m.adjuntos = aRes.recordset.filter(a => a.TMenIdMensaje === m.TMenIdMensaje);
            });
        }

        res.json({ success: true, ticket, mensajes });

    } catch (e) {
        logger.error('Error getTicketDetails:', e.message);
        res.status(500).json({ error: 'Error cargando datos del ticket' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// RESPONDER AL TICKET (Añadir Mensaje / Nota Interna)
// ─────────────────────────────────────────────────────────────────────────────
exports.replyToTicket = async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { texto, esNotaInterna } = req.body;
        const isClient = req.user && req.user.role === 'WEB_CLIENT';
        
        const cliIdAutor = isClient ? req.user.id : null;
        const usrIdAutor = !isClient ? req.user.id : null;

        // Los clientes nunca pueden postear notas internas, forzamos false
        const notaInternaFlag = isClient ? 0 : (esNotaInterna === 'true' || esNotaInterna === true ? 1 : 0);

        const mensajeTexto = texto || '';
        const hasFiles = req.files && req.files.length > 0;

        if (!mensajeTexto.trim() && !hasFiles) {
            return res.status(400).json({ error: 'El mensaje debe contener texto o al menos un archivo adjunto.' });
        }

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Insertar Mensaje
            const msgResult = await transaction.request()
                .input('Tic', sql.Int, ticketId)
                .input('Usr', sql.Int, usrIdAutor)
                .input('Cli', sql.Int, cliIdAutor)
                .input('Interna', sql.Bit, notaInternaFlag)
                .input('Txt', sql.NVarChar(sql.MAX), mensajeTexto)
                .query(`
                    INSERT INTO Tickets_Mensajes (TicIdTicket, UsrIdAutor, CliIdAutor, TMenEsNotaInterna, TMenTexto, TMenFecha)
                    OUTPUT INSERTED.TMenIdMensaje
                    VALUES (@Tic, @Usr, @Cli, @Interna, @Txt, GETDATE())
                `);
            
            const mensajeId = msgResult.recordset[0].TMenIdMensaje;

            // 2. Archivos Adjuntos
            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    await transaction.request()
                        .input('MsgId', sql.Int, mensajeId)
                        .input('Ruta', sql.VarChar(500), file.filename)
                        .query(`
                            INSERT INTO Tickets_Adjuntos (TMenIdMensaje, TAdjRutaArchivo)
                            VALUES (@MsgId, @Ruta)
                        `);
                }
            }

            // 3. Actualizar touch date del ticket (y estado si un cliente contestó, volver a En Espera de Staff)
            let updateQ = `UPDATE Tickets SET TicFechaActualizacion = GETDATE()`;
            if (isClient) {
                // Si el cliente contesta, obligatoriamente lo pasamos a "Abierto/En Proceso"  (1 o 2) 
                // para que le reaparezca al staff
                updateQ += `, TicEstado = 1`; 
            } else if (!notaInternaFlag) {
                // Si un staff contesta de forma publica, queda "Esperando al Cliente" (3)
                updateQ += `, TicEstado = 3`;
            }

            updateQ += ` WHERE TicIdTicket = @Tic`;
            await transaction.request().input('Tic', sql.Int, ticketId).query(updateQ);

            // Obtener información del creador del ticket para la notificación push antes de committear
            const ticketInfoRes = await transaction.request()
                .input('Tic', sql.Int, ticketId)
                .query(`SELECT CliIdCliente, TicAsunto FROM Tickets WHERE TicIdTicket = @Tic`);
            const ticketInfo = ticketInfoRes.recordset[0];

            await transaction.commit();

            // Notificación push al cliente si responde el staff públicamente
            if (!isClient && !notaInternaFlag && ticketInfo?.CliIdCliente) {
                try {
                    const pushService = require('../services/pushNotificationService');
                    await pushService.sendToClient(ticketInfo.CliIdCliente, {
                        title: `Respuesta en Ticket #${ticketId}`,
                        body: `Soporte respondió: "${ticketInfo.TicAsunto || 'Sin asunto'}"`,
                        url: `/portal/soporte/${ticketId}`
                    });
                } catch (pushErr) {
                    logger.error('[WebPush] Error al enviar notificación de ticket:', pushErr.message);
                }
            }

            // Emitir al room del ticket (cliente + admin mirando ese hilo)
            const io = req.app.get('socketio');
            if (io) {
                const payload = {
                    ticketId: parseInt(ticketId),
                    esNotaInterna: notaInternaFlag === 1,
                    autor: isClient ? 'client' : 'staff'
                };
                // Al room del ticket específico
                io.to(`ticket:${ticketId}`).emit('ticket:new_message', payload);
                // Al panel admin para refrescar la bandeja
                io.to('helpdesk:admin').emit('ticket:updated', payload);
            }

            res.json({ success: true, message: 'Respuesta enviada.' });

        } catch (dbErr) {
            await transaction.rollback();
            throw dbErr;
        }
    } catch (e) {
        logger.error('Error respondiendo ticket:', e.message);
        res.status(500).json({ error: 'Error al enviar la respuesta' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CERRAR / RESOLVER TICKET (Solo Admins o dueño)
// ─────────────────────────────────────────────────────────────────────────────
exports.updateTicketStatus = async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { nuevoEstado, departamentoId } = req.body;
        
        // 4 = Resuelto, 5 = Cancelado
        const estadoToSet = nuevoEstado ? parseInt(nuevoEstado) : 4; 

        const pool = await getPool();
        
        // Si envían un departamentoId, es una derivación interna.
        if (departamentoId) {
            await pool.request()
                .input('Tic', sql.Int, ticketId)
                .input('DepId', sql.Int, departamentoId)
                .query(`UPDATE Tickets SET DepIdDepartamento = @DepId, TicFechaActualizacion = GETDATE() WHERE TicIdTicket = @Tic`);
            const io = req.app.get('socketio');
            if (io) io.to(`ticket:${ticketId}`).to('helpdesk:admin').emit('ticket:updated', { ticketId: parseInt(ticketId) });
            return res.json({ success: true, message: 'Ticket derivado a nueva área.' });
        }

        // Obtener la información del ticket para la notificación push
        const ticketInfoRes = await pool.request()
            .input('Tic', sql.Int, ticketId)
            .query(`SELECT CliIdCliente, TicAsunto FROM Tickets WHERE TicIdTicket = @Tic`);
        const ticketInfo = ticketInfoRes.recordset[0];

        await pool.request()
            .input('Tic', sql.Int, ticketId)
            .input('E', sql.Int, estadoToSet)
            .query(`UPDATE Tickets SET TicEstado = @E, TicFechaActualizacion = GETDATE() WHERE TicIdTicket = @Tic`);

        // Notificar al cliente si el estado cambia a Resuelto (4) o Cerrado (5)
        if (ticketInfo?.CliIdCliente && (estadoToSet === 4 || estadoToSet === 5)) {
            try {
                const pushService = require('../services/pushNotificationService');
                const estadoText = estadoToSet === 4 ? 'Resuelto' : 'Cerrado';
                await pushService.sendToClient(ticketInfo.CliIdCliente, {
                    title: `Ticket #${ticketId} ${estadoText}`,
                    body: `Tu ticket "${ticketInfo.TicAsunto || 'Sin asunto'}" ha sido marcado como ${estadoText.toLowerCase()}.`,
                    url: `/portal/soporte/${ticketId}`
                });
            } catch (pushErr) {
                logger.error('[WebPush] Error al enviar notificación de cambio de estado:', pushErr.message);
            }
        }

        const io2 = req.app.get('socketio');
        if (io2) io2.to(`ticket:${ticketId}`).to('helpdesk:admin').emit('ticket:updated', { ticketId: parseInt(ticketId), nuevoEstado: estadoToSet });

        res.json({ success: true, message: 'Estado del ticket modificado con éxito.' });
    } catch (e) {
        logger.error('Error cerrando ticket:', e.message);
        res.status(500).json({ error: 'Fallo al modificar el estado' });
    }
};
