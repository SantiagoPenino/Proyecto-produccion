const { sql, getPool } = require('../config/db');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../middleware/asyncHandler');
const logger = require('../utils/logger');
const { hashear, verificar } = require('../utils/password');
const JWT_SECRET = process.env.JWT_SECRET;

/*
 * Diseñadores del portal: cuentas que crean pedidos EN NOMBRE de clientes que los
 * eligieron desde su perfil (vínculo en dbo.ClienteDisenadores — el cliente autoriza,
 * el diseñador nunca se auto-asigna). Ver docs/disenadores-portal-plan.md.
 *
 * SQL requerido (manual):
 *   CREATE TABLE dbo.Disenadores (DisenadorID INT IDENTITY PRIMARY KEY, Nombre NVARCHAR(200) NOT NULL,
 *     Email NVARCHAR(200) NOT NULL, Telefono NVARCHAR(50) NULL, WebPasswordHash NVARCHAR(300) NULL,
 *     Aprobado BIT NOT NULL DEFAULT 0, Activo BIT NOT NULL DEFAULT 1, FechaAlta DATETIME NOT NULL DEFAULT GETDATE());
 *   CREATE TABLE dbo.ClienteDisenadores (ID INT IDENTITY PRIMARY KEY, CodCliente INT NOT NULL,
 *     DisenadorID INT NOT NULL, FechaAlta DATETIME NOT NULL DEFAULT GETDATE(),
 *     CONSTRAINT UQ_ClienteDisenador UNIQUE (CodCliente, DisenadorID));
 *   ALTER TABLE dbo.Ordenes ADD DisenadorID INT NULL;
 *   ALTER TABLE dbo.Clientes ADD AprobarPedidosDisenador BIT NOT NULL DEFAULT 0;
 *   ALTER TABLE dbo.Ordenes ADD AprobacionPendiente BIT NOT NULL DEFAULT 0;  -- F4: hold hasta aprobación del cliente
 */

// Guardas de rol simples (el portal comparte verifyToken con toda la app)
const esCliente = (req) => !!req.user?.codCliente;
const esDisenador = (req) => req.user?.role === 'WEB_DESIGNER' && !!req.user?.disenadorId;

// ===================================
// REGISTRO (público) — queda Aprobado=0 hasta que USER lo apruebe (P1)
// ===================================
exports.register = asyncHandler(async (req, res) => {
    const { nombre, email, telefono, password } = req.body;
    if (!nombre?.trim() || !email?.trim() || !password) {
        return res.status(400).json({ success: false, message: 'Nombre, email y contraseña son obligatorios.' });
    }

    const pool = await getPool();
    const dup = await pool.request()
        .input('Email', sql.NVarChar(200), email.trim())
        .query('SELECT DisenadorID FROM dbo.Disenadores WHERE LTRIM(RTRIM(Email)) = @Email');
    if (dup.recordset.length) {
        return res.status(409).json({ success: false, message: 'Ya existe un diseñador registrado con ese email.' });
    }

    await pool.request()
        .input('Nombre', sql.NVarChar(200), nombre.trim())
        .input('Email', sql.NVarChar(200), email.trim())
        .input('Tel', sql.NVarChar(50), telefono?.trim() || null)
        .input('Pass', sql.NVarChar(300), await hashear(password))
        .query('INSERT INTO dbo.Disenadores (Nombre, Email, Telefono, WebPasswordHash) VALUES (@Nombre, @Email, @Tel, @Pass)');

    logger.info(`🎨 [Disenador] Registro nuevo: ${email.trim()} (pendiente de aprobación)`);
    res.json({ success: true, pendingApproval: true, message: 'Registro exitoso. Tu cuenta de diseñador queda pendiente de aprobación por USER.' });
});

// ===================================
// LOGIN (fallback desde webAuthController.login — mismo formulario para todos)
// Devuelve true si respondió (existía el diseñador); false → el caller sigue con su 401.
// ===================================
exports.tryDesignerLogin = async (req, res, identifier, password) => {
    const pool = await getPool();
    const r = await pool.request()
        .input('Val', sql.NVarChar(200), identifier.trim())
        .query('SELECT * FROM dbo.Disenadores WHERE LTRIM(RTRIM(Email)) = @Val AND Activo = 1');
    if (!r.recordset.length) return false;

    const d = r.recordset[0];
    if (!d.Aprobado) {
        res.status(403).json({ success: false, message: 'Tu cuenta de diseñador aún no fue aprobada por USER.' });
        return true;
    }
    const chk = await verificar(password, d.WebPasswordHash);
    if (!chk.ok) {
        res.status(401).json({ success: false, message: 'Contraseña incorrecta.' });
        return true;
    }
    // Entró con la contraseña vieja en texto plano: se migra a bcrypt (best-effort).
    if (chk.rehash) {
        try {
            await pool.request()
                .input('ID', sql.Int, d.DisenadorID)
                .input('Hash', sql.NVarChar(300), chk.rehash)
                .query('UPDATE dbo.Disenadores SET WebPasswordHash = @Hash WHERE DisenadorID = @ID');
        } catch (e) {
            logger.warn(`[PASSWORD] No se pudo migrar al diseñador ${d.DisenadorID}: ${e.message}`);
        }
    }

    const userPayload = {
        id: d.DisenadorID,
        disenadorId: d.DisenadorID,
        email: d.Email,
        name: d.Nombre,
        role: 'WEB_DESIGNER'
    };
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '30d' });
    logger.info(`🎨 [Disenador] Login OK: ${d.Email} (ID ${d.DisenadorID})`);
    res.json({ success: true, user: userPayload, token });
    return true;
};

// ME para diseñadores (lo llama webAuthController.me cuando el token es WEB_DESIGNER)
exports.meDesigner = asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request()
        .input('ID', sql.Int, req.user.disenadorId)
        .query('SELECT DisenadorID, Nombre, Email, Telefono, Aprobado, Activo FROM dbo.Disenadores WHERE DisenadorID = @ID');
    if (!r.recordset.length || !r.recordset[0].Activo) {
        return res.status(404).json({ error: 'Diseñador no encontrado o inactivo' });
    }
    const d = r.recordset[0];
    res.json({
        success: true,
        user: { id: d.DisenadorID, disenadorId: d.DisenadorID, email: d.Email, name: d.Nombre, phone: d.Telefono, role: 'WEB_DESIGNER' }
    });
});

// ===================================
// DIRECTORIO (para el selector del perfil del cliente)
// ===================================
exports.getDirectorio = asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request()
        .query('SELECT DisenadorID, Nombre FROM dbo.Disenadores WHERE Aprobado = 1 AND Activo = 1 ORDER BY Nombre');
    res.json({ success: true, data: r.recordset });
});

// ===================================
// LADO CLIENTE: sus diseñadores + toggle de aprobación (P2: varios, P6: toggle)
// ===================================
exports.getMisDisenadores = asyncHandler(async (req, res) => {
    if (!esCliente(req)) return res.status(403).json({ error: 'Solo clientes' });
    const pool = await getPool();
    const [dis, cli] = await Promise.all([
        pool.request().input('Cod', sql.Int, req.user.codCliente).query(`
            SELECT d.DisenadorID, d.Nombre, cd.FechaAlta
            FROM dbo.ClienteDisenadores cd
            JOIN dbo.Disenadores d ON d.DisenadorID = cd.DisenadorID
            WHERE cd.CodCliente = @Cod AND d.Activo = 1
            ORDER BY d.Nombre
        `),
        pool.request().input('Cod', sql.Int, req.user.codCliente)
            .query('SELECT ISNULL(AprobarPedidosDisenador, 0) AS Aprobar FROM dbo.Clientes WHERE CodCliente = @Cod')
    ]);
    res.json({
        success: true,
        disenadores: dis.recordset,
        requiereAprobacion: !!cli.recordset[0]?.Aprobar
    });
});

exports.vincular = asyncHandler(async (req, res) => {
    if (!esCliente(req)) return res.status(403).json({ error: 'Solo clientes' });
    const disenadorId = parseInt(req.body.disenadorId);
    if (!disenadorId) return res.status(400).json({ error: 'disenadorId requerido' });

    const pool = await getPool();
    const d = await pool.request().input('ID', sql.Int, disenadorId)
        .query('SELECT DisenadorID FROM dbo.Disenadores WHERE DisenadorID = @ID AND Aprobado = 1 AND Activo = 1');
    if (!d.recordset.length) return res.status(404).json({ error: 'Diseñador no disponible' });

    await pool.request()
        .input('Cod', sql.Int, req.user.codCliente)
        .input('DID', sql.Int, disenadorId)
        .query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.ClienteDisenadores WHERE CodCliente = @Cod AND DisenadorID = @DID)
                INSERT INTO dbo.ClienteDisenadores (CodCliente, DisenadorID) VALUES (@Cod, @DID)
        `);
    res.json({ success: true });
});

exports.desvincular = asyncHandler(async (req, res) => {
    if (!esCliente(req)) return res.status(403).json({ error: 'Solo clientes' });
    const disenadorId = parseInt(req.params.disenadorId);
    if (!disenadorId) return res.status(400).json({ error: 'disenadorId requerido' });

    const pool = await getPool();
    await pool.request()
        .input('Cod', sql.Int, req.user.codCliente)
        .input('DID', sql.Int, disenadorId)
        .query('DELETE FROM dbo.ClienteDisenadores WHERE CodCliente = @Cod AND DisenadorID = @DID');
    res.json({ success: true });
});

// Toggle "debo aprobar los pedidos que suban mis diseñadores" (default: entra directo)
exports.setAprobacion = asyncHandler(async (req, res) => {
    if (!esCliente(req)) return res.status(403).json({ error: 'Solo clientes' });
    const requiere = req.body.requiere ? 1 : 0;
    const pool = await getPool();
    await pool.request()
        .input('Cod', sql.Int, req.user.codCliente)
        .input('V', sql.Bit, requiere)
        .query('UPDATE dbo.Clientes SET AprobarPedidosDisenador = @V WHERE CodCliente = @Cod');
    res.json({ success: true, requiereAprobacion: !!requiere });
});

// ===================================
// F2 — IMPERSONACIÓN VALIDADA
// Middleware para rutas del portal que el diseñador usa "en nombre de" un cliente.
// Si el token es WEB_DESIGNER, exige el header X-Cliente-CodCliente, valida el vínculo
// en ClienteDisenadores (el cliente lo autorizó) e inyecta al cliente en req.user.
// Para clientes/usuarios normales es un no-op. TODA la seguridad vive acá.
// ===================================
exports.impersonarCliente = async (req, res, next) => {
    try {
        if (req.user?.role !== 'WEB_DESIGNER') return next();

        const codCliente = parseInt(req.headers['x-cliente-codcliente']);
        if (!codCliente) {
            return res.status(403).json({ success: false, message: 'Seleccioná un cliente para operar en su nombre.' });
        }

        const pool = await getPool();
        const r = await pool.request()
            .input('DID', sql.Int, req.user.disenadorId)
            .input('Cod', sql.Int, codCliente)
            .query(`
                SELECT c.CodCliente, c.CliIdCliente, RTRIM(LTRIM(c.IDCliente)) AS IDCliente,
                       c.Nombre, c.NombreFantasia, c.Email
                FROM dbo.ClienteDisenadores cd
                JOIN dbo.Clientes c ON c.CodCliente = cd.CodCliente
                WHERE cd.DisenadorID = @DID AND cd.CodCliente = @Cod
            `);

        if (!r.recordset.length) {
            logger.warn(`🎨 [Disenador] Impersonación RECHAZADA: diseñador ${req.user.disenadorId} → cliente ${codCliente} (sin autorización)`);
            return res.status(403).json({ success: false, message: 'Ese cliente no te autorizó (o te quitó la autorización).' });
        }

        const c = r.recordset[0];
        req.disenadorId = req.user.disenadorId; // para estampar Ordenes.DisenadorID
        req.user = {
            ...req.user,
            id: c.CodCliente,
            codCliente: c.CodCliente,
            cliIdCliente: c.CliIdCliente,
            idCliente: c.IDCliente,
            name: c.Nombre,
            email: c.Email || req.user.email,
            role: 'WEB_CLIENT', // aguas abajo todo el flujo trata el request como del cliente
            impersonadoPorDisenador: req.user.disenadorId,
        };
        next();
    } catch (err) {
        logger.error('[Disenador] Error en impersonación:', err);
        res.status(500).json({ success: false, message: 'Error validando la autorización del cliente.' });
    }
};

// ===================================
// LADO DISEÑADOR: los clientes que lo eligieron (base de la F2)
// ===================================
exports.getMisClientes = asyncHandler(async (req, res) => {
    if (!esDisenador(req)) return res.status(403).json({ error: 'Solo diseñadores' });
    const pool = await getPool();
    const r = await pool.request()
        .input('DID', sql.Int, req.user.disenadorId)
        .query(`
            SELECT c.CodCliente, RTRIM(LTRIM(c.IDCliente)) AS IDCliente,
                   RTRIM(LTRIM(c.Nombre)) AS Nombre, RTRIM(LTRIM(c.NombreFantasia)) AS NombreFantasia,
                   ISNULL(c.AprobarPedidosDisenador, 0) AS RequiereAprobacion
            FROM dbo.ClienteDisenadores cd
            JOIN dbo.Clientes c ON c.CodCliente = cd.CodCliente
            WHERE cd.DisenadorID = @DID
            ORDER BY c.Nombre
        `);
    res.json({ success: true, data: r.recordset });
});

// ===================================
// ADMIN (usuarios internos): aprobar y gestionar diseñadores — vista /designers
// ===================================
// Interno = token que NO es de cliente web ni de diseñador (los internos no llevan codCliente)
const esInterno = (req) => !!req.user && req.user.role !== 'WEB_CLIENT' && req.user.role !== 'WEB_DESIGNER' && !req.user.codCliente;

exports.adminListaDisenadores = asyncHandler(async (req, res) => {
    if (!esInterno(req)) return res.status(403).json({ error: 'Solo usuarios internos' });
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT d.DisenadorID, RTRIM(LTRIM(d.Nombre)) AS Nombre, RTRIM(LTRIM(d.Email)) AS Email,
               d.Telefono, d.Aprobado, d.Activo, d.FechaAlta,
               (SELECT COUNT(*) FROM dbo.ClienteDisenadores cd WHERE cd.DisenadorID = d.DisenadorID) AS Clientes,
               (SELECT COUNT(*) FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.DisenadorID = d.DisenadorID) AS Pedidos
        FROM dbo.Disenadores d
        ORDER BY d.Aprobado ASC, d.FechaAlta DESC
    `);
    res.json({ success: true, data: r.recordset });
});

exports.adminActualizarDisenador = asyncHandler(async (req, res) => {
    if (!esInterno(req)) return res.status(403).json({ error: 'Solo usuarios internos' });
    const id = parseInt(req.params.disenadorId);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const { aprobado, activo } = req.body || {};
    if (aprobado === undefined && activo === undefined) {
        return res.status(400).json({ error: 'Nada para actualizar (aprobado y/o activo).' });
    }

    const pool = await getPool();
    const sets = [];
    const rq = pool.request().input('ID', sql.Int, id);
    if (aprobado !== undefined) { sets.push('Aprobado = @Aprobado'); rq.input('Aprobado', sql.Bit, aprobado ? 1 : 0); }
    if (activo !== undefined)   { sets.push('Activo = @Activo');     rq.input('Activo',   sql.Bit, activo ? 1 : 0); }
    const upd = await rq.query(`UPDATE dbo.Disenadores SET ${sets.join(', ')} WHERE DisenadorID = @ID`);
    if (!upd.rowsAffected[0]) return res.status(404).json({ error: 'Diseñador no encontrado.' });

    logger.info(`🎨 [Disenador] Admin ${req.user?.nombre || req.user?.username || req.user?.id} actualizó diseñador ${id}: ${sets.join(', ')}`);
    res.json({ success: true });
});

// F3 — Seguimiento: pedidos que el diseñador creó (Ordenes.DisenadorID), SIN precios ni importes.
// Las -F son fallas internas y no se muestran (misma regla que el portal del cliente).
exports.getMisPedidos = asyncHandler(async (req, res) => {
    if (!esDisenador(req)) return res.status(403).json({ error: 'Solo diseñadores' });
    const pool = await getPool();
    const r = await pool.request()
        .input('DID', sql.Int, req.user.disenadorId)
        .query(`
            SELECT TOP 100
                o.OrdenID, o.CodigoOrden, o.DescripcionTrabajo, o.Material,
                o.Estado, COALESCE(ar.Nombre, o.AreaID) AS Area,
                o.FechaIngreso,
                ISNULL(o.AprobacionPendiente, 0) AS AprobacionPendiente,
                RTRIM(LTRIM(ISNULL(c.NombreFantasia, c.Nombre))) AS Cliente
            FROM dbo.Ordenes o WITH(NOLOCK)
            LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CodCliente = o.CodCliente
            LEFT JOIN dbo.Areas ar WITH(NOLOCK) ON ar.AreaID = o.AreaID
            WHERE o.DisenadorID = @DID
              AND o.CodigoOrden NOT LIKE '%-F%'
            ORDER BY o.FechaIngreso DESC, o.OrdenID DESC
        `);
    res.json({ success: true, data: r.recordset });
});
