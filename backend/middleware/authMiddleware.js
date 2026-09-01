const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Clave secreta para firmar el token
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not defined in environment variables');

// =====================================================================
// MIDDLEWARE: VERIFICAR TOKEN
// =====================================================================
exports.verifyToken = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];

        if (!authHeader) {
            return res.status(403).json({ message: 'No se proporcionó token de autenticación.' });
        }

        const token = authHeader.split(' ')[1]; // Bearer <TOKEN>
        if (!token) {
            return res.status(403).json({ message: 'Formato de token inválido.' });
        }

        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) {
                return res.status(401).json({ message: 'Token inválido o expirado.' });
            }

            // Guardamos datos decodificados en req.user
            req.user = decoded;

            const { iat, exp, ...userData } = decoded;
            const newToken = jwt.sign(userData, JWT_SECRET, { expiresIn: '30d' });
            res.setHeader('x-renewed-token', newToken);

            // Actualizar actividad en sessionTracker
            const { touchSession } = require('../utils/sessionTracker');
            if (decoded.id) {
                const sessionUsername = decoded.username || decoded.name || decoded.email || 'Desconocido';
                const sessionType = decoded.userType || decoded.role || 'UNKNOWN';
                touchSession(decoded.id, sessionUsername, req.ip, sessionType);
            }

            next();
        });

    } catch (error) {
        logger.error('Error en verifyToken middleware:', error);
        return res.status(500).json({ message: 'Error interno de autenticación.' });
    }
};

// =====================================================================
// MIDDLEWARE: SOLO USUARIOS INTERNOS CON UN ROL HABILITADO
// =====================================================================
// Nace para los endpoints que cambian el ESTADO de una orden: estaban protegidos solo por
// verifyToken, que acepta CUALQUIER JWT válido — incluido el de un cliente del portal o un
// diseñador. Es decir que un cliente logueado podía cambiar el estado de cualquier orden
// (no solo las suyas) llamando la API directo. `authorizeAdminOrArea` no servía: solo
// verifica que el usuario TENGA un rol, cualquiera sea.
//
// Comparación normalizada (minúsculas + sin acentos) para que 'Coordinador', 'COORDINADOR'
// y 'coordinador' sean lo mismo. Los nombres salen de Roles.NombreRol.
const normalizaRol = (r) => String(r || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase();

/**
 * Roles habilitados para MODIFICAR estados de órdenes (Roles.NombreRol, normalizado).
 * Admin(1), User(2) y Coordinador(11). OJO: 'Administracion'(8) NO entra — normaliza a
 * 'administracion', que es distinto de 'admin'.
 */
const ROLES_EDITAN_ESTADO = ['admin', 'user', 'coordinador'];

/**
 * Exige usuario INTERNO y, si se pasan roles, que el suyo esté en la lista.
 * @param {string[]} [rolesPermitidos] - nombres de rol; si se omite, basta con ser interno.
 */
const soloInternoConRol = (rolesPermitidos = null) => (req, res, next) => {
    const u = req.user;
    if (!u) return res.status(401).json({ error: 'Usuario no autenticado.' });

    // Positivo a propósito: solo el login interno emite userType 'INTERNAL'. Cualquier otro
    // token (cliente web, diseñador, o uno viejo sin el campo) queda afuera.
    if (u.userType !== 'INTERNAL') {
        return res.status(403).json({ error: 'Esta acción es exclusiva del sistema interno.' });
    }

    if (rolesPermitidos && rolesPermitidos.length > 0) {
        const rol = normalizaRol(u.role);
        if (!rolesPermitidos.map(normalizaRol).includes(rol)) {
            return res.status(403).json({
                error: `Tu rol (${u.role || 'sin rol'}) no tiene permiso para modificar el estado de las órdenes.`
            });
        }
    }
    next();
};

// =====================================================================
// MIDDLEWARE: AUTORIZAR ADMIN O ÁREA
// =====================================================================
exports.authorizeAdminOrArea = (req, res, next) => {
    // Requiere verifyToken antes
    if (!req.user) {
        return res.status(401).json({ message: 'Usuario no autenticado.' });
    }

    const { role } = req.user;

    if (!role) {
        return res.status(403).json({ message: 'Usuario sin rol asignado.' });
    }

    next();
};

// =====================================================================
// HELPER: ES ADMIN O ÁREA SERVICIO TÉCNICO
// =====================================================================
// Para la capacidad "de fábrica" (ficha técnica) de las máquinas en ConfigEquipos: solo
// el rol Admin (Roles.NombreRol='Admin', IdRol 1) o los usuarios del área Servicio Técnico
// (Usuarios.AreaUsuario='SERVICIO') pueden editarla — a pedido de administración, 25-ago-2026.
// Nota: 'Administracion' (IdRol 8) es un rol DISTINTO de 'Admin' en este sistema y
// deliberadamente NO entra acá (mismo criterio que ROLES_EDITAN_ESTADO).
const esAdminOServicioTecnico = (u) => {
    if (!u) return false;
    return normalizaRol(u.role) === 'admin' || normalizaRol(u.areaKey) === 'servicio';
};

exports.soloInternoConRol = soloInternoConRol;
exports.ROLES_EDITAN_ESTADO = ROLES_EDITAN_ESTADO;
exports.esAdminOServicioTecnico = esAdminOServicioTecnico;
exports.JWT_SECRET = JWT_SECRET;
