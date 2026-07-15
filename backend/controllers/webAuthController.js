const { sql, getPool } = require('../config/db');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../middleware/asyncHandler');
const logger = require('../utils/logger');
// Sincronización con la planilla de clientes vía API directa de Google (googleapis + token OAuth),
// no por Apps Script: mismo mecanismo que usa el panel admin y apunta a la planilla nueva.
const googleSheets = require('../services/sheetsService');
const { trackLogin } = require('../utils/sessionTracker');
const { audit } = require('../utils/auditLogger');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not defined in environment variables');

// ===================================
// LOGIN
// ===================================
exports.login = asyncHandler(async (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier) {
        return res.status(400).json({ success: false, message: 'ID Cliente requerido' });
    }

    logger.info(`🔐 [LOGIN ATTEMPT] Identifier: '${identifier}'`);

    const pool = await getPool();

    const result = await pool.request()
        .input('Val', sql.NVarChar, identifier.trim())
        .query(`
            SELECT c.*, t.Nombre AS VendedorNombre, t.Cedula AS VendedorCedula, NULL AS VendedorTelefono, d.Nombre AS DepartamentoNombre
            FROM Clientes c
            LEFT JOIN dbo.Trabajadores t ON c.VendedorID = t.ID
            LEFT JOIN dbo.Departamentos d ON c.DepartamentoID = d.ID
            WHERE LTRIM(RTRIM(c.IDCliente)) = @Val
        `);

    logger.info(`🔐 [LOGIN RESULT] Matches found: ${result.recordset.length}`);

    if (result.recordset.length === 0) {
        // Login unificado: si no es un cliente, puede ser un DISEÑADOR (mismo formulario del portal)
        const { tryDesignerLogin } = require('./webDesignerController');
        if (await tryDesignerLogin(req, res, identifier, password)) return;

        trackLogin(null, identifier, req.ip, 'WEB_CLIENT', false, 'Usuario no encontrado');
        audit('LOGIN', { user: identifier, ip: req.ip, type: 'WEB_CLIENT', result: 'FAIL', reason: 'Usuario no encontrado' });
        return res.status(401).json({ success: false, message: 'Usuario incorrecto: No se encontró el cliente.' });
    }

    const client = result.recordset[0];

    let isValid = false;
    let isFirstTime = false;

    if (!client.WebPasswordHash || client.WebPasswordHash === '') {
        if (password && password.length > 0) {
            isFirstTime = true;
            isValid = true;
        } else {
            return res.status(401).json({ success: false, message: 'Debe ingresar una contraseña.' });
        }
    } else if (client.WebPasswordHash === password) {
        isValid = true;
    }

    if (!isValid) {
        return res.status(401).json({ success: false, message: 'Contraseña incorrecta.' });
    }

    if (!client.WebActive) {
        const email = client.Email || '';
        let maskedEmail = '';
        if (email) {
            const [local, domain] = email.split('@');
            maskedEmail = local.length <= 2
                ? email
                : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1] + '@' + domain;
        }
        return res.status(403).json({
            success: false,
            accountInactive: true,
            maskedEmail,
            message: 'Tu cuenta aún no fue activada.'
        });
    }

    if (isFirstTime) {
        await pool.request()
            .input('ID', sql.Int, client.CodCliente)
            .input('Pass', sql.NVarChar, password)
            .query("UPDATE Clientes SET WebPasswordHash = @Pass, WebResetPassword = 0 WHERE CodCliente = @ID");
        client.WebResetPassword = false;
    }

    const token = jwt.sign(
        {
            id: client.CodCliente,
            email: client.Email,
            name: client.Nombre,
            role: 'WEB_CLIENT',
            codCliente: client.CodCliente,
            requireReset: client.WebResetPassword
        },
        JWT_SECRET,
        { expiresIn: '30d' }
    );

    await pool.request()
        .input('ID', sql.Int, client.CodCliente)
        .query("UPDATE Clientes SET WebLastLogin = GETDATE() WHERE CodCliente = @ID");

    trackLogin(client.CodCliente, client.IDCliente || identifier, req.ip, 'WEB_CLIENT', true);
    audit('LOGIN', { user: client.IDCliente || identifier, userId: client.CodCliente, ip: req.ip, type: 'WEB_CLIENT', result: 'OK' });

    const mustReset = Boolean(client.WebResetPassword) && client.WebResetPassword.toString() !== '0' && client.WebResetPassword.toString() !== 'false';
    logger.info(`🔍 DEBUG - DB WebResetPassword = ${client.WebResetPassword} | Type = ${typeof client.WebResetPassword} | IsBuffer = ${Buffer.isBuffer(client.WebResetPassword)} | Evaluated MustReset = ${mustReset}`);

    res.json({
        success: true,
        user: {
            id: client.CodCliente,
            email: client.Email,
            name: client.Nombre,
            company: client.NombreFantasia,
            role: 'WEB_CLIENT',
            codCliente: client.CodCliente,
            cliIdCliente: client.CliIdCliente,
            requireReset: mustReset,
            idCliente: client.IDCliente ? client.IDCliente.trim() : (identifier ? identifier.trim() : ''),
            ruc: client.CioRuc,
            departamentoNombre: client.DepartamentoNombre || null,
            vendedorNombre: client.VendedorNombre || null,
            vendedorCedula: client.VendedorCedula || null,
            vendedorTelefono: client.VendedorTelefono || null
        },
        token
    });
});

// ===================================
// REGISTER
// ===================================
exports.register = asyncHandler(async (req, res) => {
    const {
        idcliente,
        name, email, password, company, phone,
        address, ruc, localidad, agencia, fantasyName, documento,
        departamentoId, localidadId, agenciaId, formaEnvioId,
        manualVendedorId, newsletter
    } = req.body;

    if (!idcliente || !password) {
        return res.status(400).json({ error: "Faltan datos obligatorios (ID Cliente, Contraseña)" });
    }

    const pool = await getPool();

    // --- Fetch department name (always, independent of vendedor path) ---
    let deptoNombre = '';
    if (departamentoId) {
        try {
            const deptoResult = await pool.request()
                .input('DepID', sql.Int, departamentoId)
                .query("SELECT Nombre FROM dbo.Departamentos WHERE ID = @DepID");
            deptoNombre = deptoResult.recordset[0]?.Nombre || '';
        } catch (err) {
            logger.warn('⚠️ Error fetching department name:', err.message);
        }
    }

    // --- Vendedor assignment: manual selection takes priority, otherwise auto-assign ---
    let vendedorId = manualVendedorId || null;
    if (!vendedorId && departamentoId) {
        try {
            const zonaResult = await pool.request()
                .input('DepID', sql.Int, departamentoId)
                .query("SELECT Zona FROM dbo.Departamentos WHERE ID = @DepID");

            const zona = zonaResult.recordset[0]?.Zona;

            if (zona) {
                const vendedorResult = await pool.request()
                    .input('Zona', sql.NVarChar, zona)
                    .query(`
                        SELECT TOP 1 t.ID
                        FROM dbo.Trabajadores t
                        LEFT JOIN dbo.Clientes c ON c.VendedorID = t.ID
                        WHERE t.Zona = @Zona AND t.[Área] = 'Ventas'
                        GROUP BY t.ID
                        ORDER BY COUNT(c.CodCliente) ASC
                    `);

                vendedorId = vendedorResult.recordset[0]?.ID || null;
            }
        } catch (err) {
            logger.warn('⚠️ Error auto-assigning vendedor:', err.message);
        }
    }

    // 1. Verificar si IDCliente ya existe
    const checkId = await pool.request()
        .input('Val', sql.NVarChar, idcliente)
        .query("SELECT CodCliente FROM Clientes WHERE IDCliente = @Val");

    if (checkId.recordset.length > 0) {
        return res.status(409).json({ success: false, message: 'Este ID de cliente ya está en uso. Elegí otro.' });
    }

    // 2. Verificar si el email ya existe
    if (email) {
        const checkEmail = await pool.request()
            .input('Email', sql.NVarChar, email.trim().toLowerCase())
            .query("SELECT CodCliente FROM Clientes WHERE LOWER(LTRIM(RTRIM(Email))) = @Email AND Email IS NOT NULL AND Email != ''");

        if (checkEmail.recordset.length > 0) {
            return res.status(409).json({ success: false, message: 'Este correo electrónico ya está registrado.' });
        }
    }

    // 2.1 Verificar si el teléfono ya existe
    if (phone) {
        const checkPhone = await pool.request()
            .input('Tel', sql.NVarChar, phone.trim())
            .query("SELECT CodCliente FROM Clientes WHERE TelefonoTrabajo = @Tel AND TelefonoTrabajo IS NOT NULL AND TelefonoTrabajo != ''");

        if (checkPhone.recordset.length > 0) {
            return res.status(409).json({ success: false, message: 'Este teléfono ya se encuentra registrado en el sistema.' });
        }
    }

    // 2.2 Verificar si el RUT/Documento ya existe
    if (ruc) {
        const checkRuc = await pool.request()
            .input('Ruc', sql.NVarChar, ruc.trim())
            .query("SELECT CodCliente FROM Clientes WHERE CioRuc = @Ruc AND CioRuc IS NOT NULL AND CioRuc != ''");

        if (checkRuc.recordset.length > 0) {
            return res.status(409).json({ success: false, message: 'Este documento (RUT/CI) ya se encuentra registrado en el sistema.' });
        }
    }

    // 3. Crear cliente nuevo
    const idQuery = await pool.request().query("SELECT ISNULL(MAX(CodCliente), 0) + 1 as NextID FROM Clientes");
    let codClienteInterno = idQuery.recordset[0].NextID;

    const insertRes = await pool.request()
        .input('CC', sql.Int, codClienteInterno)
        .input('IDC', sql.NVarChar(50), idcliente)
        .input('Nom', sql.NVarChar(200), company || name || 'Nuevo Cliente')
        .input('Fant', sql.NVarChar(200), fantasyName || name || '')
        .input('Email', sql.NVarChar(200), email)
        .input('Tel', sql.NVarChar(50), phone || '')
        .input('Dir', sql.NVarChar(500), address || '')
        .input('Ruc', sql.NVarChar(50), ruc || '')
        .input('Pass', sql.NVarChar(255), password)
        .input('DepID', sql.Int, departamentoId || null)
        .input('LocID', sql.Int, localidadId || null)
        .input('AgeID', sql.Int, agenciaId || null)
        .input('FenvID', sql.Int, formaEnvioId || null)
        .input('VenID', sql.NVarChar(20), vendedorId)
        .input('Newsletter', sql.Bit, newsletter ? 1 : 0)
        .query(`
            INSERT INTO Clientes (
                CodCliente, IDCliente, Nombre, NombreFantasia, Email, TelefonoTrabajo, DireccionTrabajo, CioRuc, 
                WebPasswordHash, WebActive, WebResetPassword, Newsletter,
                DepartamentoID, LocalidadID, AgenciaID, FormaEnvioID, VendedorID, FechaRegistro
            )
            OUTPUT INSERTED.CliIdCliente
            VALUES (
                @CC, @IDC, @Nom, @Fant, @Email, @Tel, @Dir, @Ruc, 
                @Pass, 0, 0, @Newsletter,
                @DepID, @LocID, @AgeID, @FenvID, @VenID, GETDATE()
            )
        `);

    const cliIdClienteGenerado = insertRes.recordset[0].CliIdCliente;

    await pool.request()
        .input('CID', sql.Int, cliIdClienteGenerado)
        .query('UPDATE Clientes SET IDReact = @CID WHERE CliIdCliente = @CID');

    const emailService = require('../services/emailService');
    if (email) {
        emailService.sendRegistrationMail(email, company || name, codClienteInterno).catch(console.error);
    }

    res.json({
        success: true,
        pendingApproval: true,
        message: 'Registro exitoso. Revisá tu correo electrónico para activar tu cuenta.'
    });

    // Fire-and-forget: sincronizar con Google Sheets
    googleSheets.insertarCliente({
        idCliente: idcliente,
        nombre: name || '',
        telefono: phone || '',
        email: email || '',
        empresa: company || '',
        doc: ruc || '',
        direccion: address || '',
        depto: deptoNombre || '',
        localidad: localidad || '',
        tipoRetiro: formaEnvioId === 1 || formaEnvioId === '1' ? 'Retiro en el local' : 'Encomienda: ' + agencia,
        idReact: String(cliIdClienteGenerado),
    }).catch(e => logger.warn('[GoogleSheets] insertarCliente falló:', e.message));
});

// ===================================
// ME (GET CURRENT USER)
// ===================================
exports.me = asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "No autorizado" });

    // Sesiones de diseñador: su /me vive en webDesignerController
    if (req.user.role === 'WEB_DESIGNER') {
        const { meDesigner } = require('./webDesignerController');
        return meDesigner(req, res);
    }

    const pool = await getPool();
    const r = await pool.request()
        .input('ID', sql.Int, req.user.codCliente)
        .query(`
            SELECT c.*, t.Nombre AS VendedorNombre, t.Cedula AS VendedorCedula, NULL AS VendedorTelefono, d.Nombre AS DepartamentoNombre
            FROM Clientes c
            LEFT JOIN dbo.Trabajadores t ON c.VendedorID = t.ID
            LEFT JOIN dbo.Departamentos d ON c.DepartamentoID = d.ID
            WHERE c.CodCliente = @ID
        `);

    if (r.recordset.length > 0) {
        const u = r.recordset[0];
        res.json({
            success: true,
            user: {
                id: u.CodCliente,
                idCliente: u.IDCliente ? u.IDCliente.trim() : u.IDCliente,
                email: u.Email,
                name: u.Nombre,
                company: u.NombreFantasia,
                phone: u.TelefonoTrabajo,
                address: u.DireccionTrabajo,
                ruc: u.CioRuc,
                departamentoId: u.DepartamentoID,
                departamentoNombre: u.DepartamentoNombre || null,
                localidadId: u.LocalidadID,
                agenciaId: u.AgenciaID,
                formaEnvioId: u.FormaEnvioID,
                tipoClienteId: u.TClIdTipoCliente || null,
                vendedorNombre: u.VendedorNombre || null,
                vendedorCedula: u.VendedorCedula || null,
                vendedorTelefono: u.VendedorTelefono || null,
                role: 'WEB_CLIENT',
                codCliente: u.CodCliente,
                cliIdCliente: u.CliIdCliente,
                requireReset: u.WebResetPassword || (u.WebPasswordHash == null) || (u.WebPasswordHash === ''),
                estado: u.ESTADO || 'ACTIVO'
            }
        });
    } else {
        res.status(404).json({ error: "Cliente no encontrado" });
    }
});

// ===================================
// UPDATE PASSWORD (FORCE RESET)
// ===================================
exports.updatePassword = asyncHandler(async (req, res) => {
    const userId = req.user.codCliente;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: "La contraseña es muy corta" });
    }

    const pool = await getPool();
    await pool.request()
        .input('ID', sql.Int, userId)
        .input('Pass', sql.NVarChar, newPassword)
        .query("UPDATE Clientes SET WebPasswordHash = @Pass, WebResetPassword = 0 WHERE CodCliente = @ID");

    res.json({ success: true, message: "Contraseña actualizada correctamente" });
});

// ===================================
// UPDATE PROFILE (CLIENT SELF-EDIT)
// ===================================
exports.updateProfile = asyncHandler(async (req, res) => {
    const userId = req.user.codCliente;
    const {
        name, company, phone, address, ruc, documento,
        localidad, agencia, departamentoId, localidadId, agenciaId, formaEnvioId
    } = req.body;

    const pool = await getPool();
    await pool.request()
        .input('ID', sql.Int, userId)
        .input('Nombre', sql.NVarChar, name || null)
        .input('NombreFantasia', sql.NVarChar, company || null)
        .input('Telefono', sql.NVarChar, phone || null)
        .input('Direccion', sql.NVarChar, address || null)
        .input('Ruc', sql.NVarChar, ruc || null)
        .input('DepID', sql.Int, departamentoId || null)
        .input('LocID', sql.Int, localidadId || null)
        .input('AgeID', sql.Int, agenciaId || null)
        .input('FenvID', sql.Int, formaEnvioId || null)
        .query(`
            UPDATE Clientes 
            SET Nombre = ISNULL(@Nombre, Nombre),
                NombreFantasia = ISNULL(@NombreFantasia, NombreFantasia),
                TelefonoTrabajo = ISNULL(@Telefono, TelefonoTrabajo),
                DireccionTrabajo = ISNULL(@Direccion, DireccionTrabajo),
                CioRuc = ISNULL(@Ruc, CioRuc),
                DepartamentoID = ISNULL(@DepID, DepartamentoID),
                LocalidadID = ISNULL(@LocID, LocalidadID),
                AgenciaID = ISNULL(@AgeID, AgenciaID),
                FormaEnvioID = ISNULL(@FenvID, FormaEnvioID)
            WHERE CodCliente = @ID
        `);

    const r = await pool.request()
        .input('ID2', sql.Int, userId)
        .query("SELECT * FROM Clientes WHERE CodCliente = @ID2");

    if (r.recordset.length > 0) {
        const u = r.recordset[0];
        res.json({
            success: true,
            user: {
                id: u.CodCliente,
                idCliente: u.IDCliente ? u.IDCliente.trim() : u.IDCliente,
                email: u.Email,
                name: u.Nombre,
                company: u.NombreFantasia,
                phone: u.TelefonoTrabajo,
                address: u.DireccionTrabajo,
                ruc: u.CioRuc,
                departamentoId: u.DepartamentoID,
                localidadId: u.LocalidadID,
                agenciaId: u.AgenciaID,
                formaEnvioId: u.FormaEnvioID,
                role: 'WEB_CLIENT',
                codCliente: u.CodCliente
            }
        });

        if (u.IDReact) {
            // Fetch department name for Sheets sync
            let deptoNombreUpdate = '';
            if (u.DepartamentoID) {
                try {
                    const deptoRes = await pool.request()
                        .input('DepID', sql.Int, u.DepartamentoID)
                        .query("SELECT Nombre FROM dbo.Departamentos WHERE ID = @DepID");
                    deptoNombreUpdate = deptoRes.recordset[0]?.Nombre || '';
                } catch (_) {}
            }

            googleSheets.actualizarCliente(u.IDReact, {
                nombre: name || '',
                telefono: phone || '',
                empresa: company || '',
                direccion: address || '',
                doc: ruc || '',
                depto: deptoNombreUpdate,
                localidad: localidad || '',
                tipoRetiro: u.FormaEnvioID === 1 ? 'Retiro en el local' : `Encomienda: ${agencia || ''}`,
            }).catch(e => logger.warn('[GoogleSheets] actualizarCliente falló:', e.message));
        }
    } else {
        res.status(404).json({ error: "Cliente no encontrado" });
    }
});

// ===================================
// FORGOT PASSWORD (send reset link)
// ===================================
exports.forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;

    logger.info(`🔑 [FORGOT-PASSWORD] Solicitud recibida para email: '${email}'`);

    if (!email || !email.trim()) {
        return res.status(400).json({ success: false, message: 'El email es requerido.' });
    }

    const pool = await getPool();
    const result = await pool.request()
        .input('Email', sql.NVarChar, email.trim().toLowerCase())
        .query(`
            SELECT CodCliente, Nombre, Email
            FROM Clientes
            WHERE LOWER(LTRIM(RTRIM(Email))) = @Email
              AND WebActive = 1
        `);

    logger.info(`🔑 [FORGOT-PASSWORD] Clientes encontrados con ese email: ${result.recordset.length}`);

    if (result.recordset.length === 0) {
        logger.warn(`🔑 [FORGOT-PASSWORD] Email '${email}' no encontrado o cuenta inactiva. No se envía correo.`);
        return res.json({ success: true });
    }

    const client = result.recordset[0];
    logger.info(`🔑 [FORGOT-PASSWORD] Enviando link de reset a CodCliente=${client.CodCliente} (${client.Email})`);

    const resetToken = jwt.sign(
        { codCliente: client.CodCliente, purpose: 'password-reset' },
        JWT_SECRET,
        { expiresIn: '15m' }
    );

    const emailService = require('../services/emailService');
    emailService.sendPasswordResetLinkMail(client.Email, client.Nombre, resetToken)
        .then(ok => logger.info(`🔑 [FORGOT-PASSWORD] sendMail resultado: ${ok}`))
        .catch(err => logger.error(`🔑 [FORGOT-PASSWORD] sendMail excepción: ${err.message}`));

    return res.json({ success: true });
});

// ===================================
// RESET PASSWORD (consume reset token)
// ===================================
exports.resetPassword = asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token) {
        return res.status(400).json({ success: false, expired: true, message: 'Token requerido.' });
    }
    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 4 caracteres.' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        const expired = err.name === 'TokenExpiredError';
        return res.status(400).json({ success: false, expired, message: expired ? 'El enlace expiró.' : 'Token inválido.' });
    }

    if (decoded.purpose !== 'password-reset') {
        return res.status(400).json({ success: false, message: 'Token inválido.' });
    }

    const pool = await getPool();
    await pool.request()
        .input('ID', sql.Int, decoded.codCliente)
        .input('Pass', sql.NVarChar, newPassword)
        .query("UPDATE Clientes SET WebPasswordHash = @Pass, WebResetPassword = 0 WHERE CodCliente = @ID");

    return res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
});

// ===================================
// ACTIVATE ACCOUNT (EMAIL VERIFICATION)
// ===================================
exports.activate = asyncHandler(async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).send(activationPage('Token inválido o faltante.', false));
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const pool = await getPool();

        const result = await pool.request()
            .input('ID', sql.Int, decoded.codCliente)
            .query('SELECT CodCliente, WebActive, Nombre FROM Clientes WHERE CodCliente = @ID');

        if (result.recordset.length === 0) {
            return res.status(404).send(activationPage('Cliente no encontrado.', false));
        }

        const client = result.recordset[0];

        if (client.WebActive) {
            return res.send(activationPage('Tu cuenta ya estaba activada. Podés iniciar sesión.', true));
        }

        await pool.request()
            .input('ID', sql.Int, decoded.codCliente)
            .query('UPDATE Clientes SET WebActive = 1 WHERE CodCliente = @ID');

        return res.send(activationPage('¡Tu cuenta fue activada exitosamente! Ya podés iniciar sesión.', true));
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(400).send(activationPage('El enlace de activación expiró. Registrate nuevamente.', false));
        }
        return res.status(400).send(activationPage('Token inválido.', false));
    }
});

// HTML page shown after clicking activation link
function activationPage(message, success) {
    const successSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#00AEEF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 12px rgba(0, 174, 239, 0.4)); margin: 0 auto;">
            <circle cx="12" cy="12" r="10"/>
            <path d="m9 12 2 2 4-4"/>
        </svg>
    `;
    const errorSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#EC008C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 12px rgba(236, 0, 140, 0.4)); margin: 0 auto;">
            <circle cx="12" cy="12" r="10"/>
            <path d="m15 9-6 6"/>
            <path d="m9 9 6 6"/>
        </svg>
    `;

    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1.0">
        <title>Activación de Cuenta</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap');
            body {
                font-family: 'Inter', sans-serif;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background-color: #09090b;
                color: #f4f4f5;
                padding: 20px;
                box-sizing: border-box;
            }
            .card-wrapper {
                background: linear-gradient(135deg, #00AEEF, #EC008C, #FFF200);
                padding: 2px;
                border-radius: 24px;
                width: 100%;
                max-width: 420px;
                box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7);
                position: relative;
                z-index: 10;
            }
            .card {
                background-color: #19181B;
                padding: 40px;
                border-radius: 22px;
                text-align: center;
                width: 100%;
                box-sizing: border-box;
            }
            .icon {
                margin-bottom: 20px;
                display: flex;
                justify-content: center;
            }
            h2 {
                margin: 0 0 12px 0;
                font-size: 28px;
                font-weight: 900;
                color: #fff;
                letter-spacing: -0.5px;
            }
            p {
                margin: 0 0 32px 0;
                color: #a1a1aa;
                font-size: 15px;
                line-height: 1.6;
                font-weight: 600;
            }
            a.btn {
                display: inline-block;
                padding: 14px 32px;
                background-color: #00AEEF;
                color: #111;
                text-decoration: none;
                border-radius: 12px;
                font-weight: 800;
                font-size: 15px;
                transition: all 0.2s ease;
                box-shadow: 0 8px 16px -4px rgba(0, 174, 239, 0.4);
            }
            a.btn:hover {
                background-color: #009ce0;
                transform: translateY(-2px);
                box-shadow: 0 12px 20px -4px rgba(0, 174, 239, 0.5);
                color: #fff;
            }
            .particles {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                z-index: 0;
                pointer-events: none;
            }
        </style>
    </head>
    <body>
        <canvas id="particles-canvas" class="particles"></canvas>
        <div class="card-wrapper">
            <div class="card">
                <div class="icon">${success ? successSvg : errorSvg}</div>
                <h2>${success ? '¡Cuenta Activada!' : 'Ocurrió un error'}</h2>
                <p>${message}</p>
                <a href="https://user.com.uy/login" class="btn">Ir al Login</a>
            </div>
        </div>

        <script>
            const canvas = document.getElementById('particles-canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const COLORS = ['#00AEEF', '#EC008C', '#FFF200', '#FFFFFF'];
                let particles = [];
                const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
                resize();
                window.addEventListener('resize', resize);
                
                for (let i = 0; i < 40; i++) {
                    particles.push({
                        x: Math.random() * canvas.width,
                        y: Math.random() * canvas.height,
                        vx: (Math.random() - 0.5) * 0.4,
                        vy: (Math.random() - 0.5) * 0.4,
                        r: Math.random() * 2 + 1,
                        color: COLORS[Math.floor(Math.random() * COLORS.length)]
                    });
                }
                
                const draw = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    for (let i = 0; i < particles.length; i++) {
                        for (let j = i + 1; j < particles.length; j++) {
                            const dx = particles[i].x - particles[j].x;
                            const dy = particles[i].y - particles[j].y;
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist < 120) {
                                ctx.beginPath();
                                ctx.strokeStyle = \`rgba(255,255,255,\${0.08 * (1 - dist / 120)})\`;
                                ctx.lineWidth = 0.5;
                                ctx.moveTo(particles[i].x, particles[i].y);
                                ctx.lineTo(particles[j].x, particles[j].y);
                                ctx.stroke();
                            }
                        }
                    }
                    
                    particles.forEach(p => {
                        p.x += p.vx;
                        p.y += p.vy;
                        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                        ctx.fillStyle = p.color;
                        ctx.globalAlpha = 0.5;
                        ctx.fill();
                        ctx.globalAlpha = 1;
                    });
                    
                    requestAnimationFrame(draw);
                };
                draw();
            }
        </script>
    </body>
    </html>`;
}

// ===================================
// RESEND ACTIVATION EMAIL
// ===================================
exports.resendActivation = asyncHandler(async (req, res) => {
    const { identifier, email } = req.body;

    if (!identifier || !email) {
        return res.status(400).json({ success: false, message: 'Datos incompletos.' });
    }

    const pool = await getPool();
    const result = await pool.request()
        .input('Val', sql.NVarChar, identifier.trim())
        .query(`SELECT CodCliente, Nombre, Email, WebActive FROM Clientes WHERE LTRIM(RTRIM(IDCliente)) = @Val`);

    if (result.recordset.length === 0) {
        // No revelar si el usuario existe o no
        return res.json({ success: true, message: 'Si el correo es correcto, recibirás el email de activación.' });
    }

    const client = result.recordset[0];

    if (client.WebActive) {
        return res.status(400).json({ success: false, message: 'Esta cuenta ya está activa. Podés iniciar sesión.' });
    }

    const emailMatch = (client.Email || '').trim().toLowerCase() === email.trim().toLowerCase();
    if (!emailMatch) {
        return res.status(400).json({ success: false, emailMismatch: true, message: 'El correo ingresado no coincide con el registrado.' });
    }

    const emailService = require('../services/emailService');
    await emailService.sendRegistrationMail(client.Email, client.Nombre, client.CodCliente);

    return res.json({ success: true, message: 'Correo de activación reenviado. Revisá tu bandeja de entrada.' });
});
