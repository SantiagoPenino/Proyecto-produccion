const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Impersonación de cliente para ALTA INTERNA (vendedores).
 *
 * Espejo de `impersonarCliente` (webDesignerController) pero con OTRA regla de autorización:
 *   - Diseñador  → solo los clientes que LO eligieron (tabla ClienteDisenadores).
 *   - Interno    → CUALQUIER cliente. El vendedor no depende de que el cliente lo autorice.
 *
 * Mantiene el candado de seguridad de createWebOrder (webOrdersController:238-241):
 * el body NUNCA elige el cliente. Lo elige este middleware, tras validar el rol,
 * y lo inyecta en req.user — igual que hace el flujo de diseñadores.
 *
 * Entrada: header `X-Cliente-CodCliente` (mismo header que usa el portal).
 * Requiere verifyToken antes.
 */
exports.impersonarClienteInterno = async (req, res, next) => {
    try {
        if (req.user?.userType !== 'INTERNAL') {
            return res.status(403).json({
                success: false,
                message: 'Solo usuarios internos pueden cargar órdenes en nombre de un cliente.'
            });
        }

        const codCliente = parseInt(req.headers['x-cliente-codcliente']);
        if (!codCliente) {
            return res.status(400).json({
                success: false,
                message: 'Elegí el cliente al que se le carga la orden.'
            });
        }

        const pool = await getPool();
        const r = await pool.request()
            .input('Cod', sql.Int, codCliente)
            .query(`
                SELECT CodCliente, CliIdCliente, RTRIM(LTRIM(IDCliente)) AS IDCliente,
                       Nombre, NombreFantasia, Email, ESTADO
                FROM dbo.Clientes
                WHERE CodCliente = @Cod
            `);

        if (!r.recordset.length) {
            logger.warn(`[AltaInterna] Cliente inexistente: ${codCliente} (usuario ${req.user.id})`);
            return res.status(404).json({ success: false, message: 'Ese cliente no existe.' });
        }

        const c = r.recordset[0];

        // Trazabilidad: quién cargó la orden realmente (espejo de req.disenadorId).
        req.vendedorId = req.user.id;
        req.vendedorNombre = req.user.name || req.user.username || 'Interno';

        logger.info(`[AltaInterna] ${req.vendedorNombre} (id ${req.vendedorId}) carga a nombre de ${c.IDCliente || c.Nombre} (Cod ${c.CodCliente})`);

        // Aguas abajo el flujo trata el request como del cliente — idéntico al de diseñadores.
        req.user = {
            ...req.user,
            id: c.CodCliente,
            codCliente: c.CodCliente,
            cliIdCliente: c.CliIdCliente,
            idCliente: c.IDCliente,
            name: c.Nombre,
            email: c.Email || req.user.email,
            role: 'WEB_CLIENT',
            impersonadoPorInterno: req.vendedorId,
        };

        next();
    } catch (err) {
        logger.error('[AltaInterna] Error en impersonación:', err);
        res.status(500).json({ success: false, message: 'Error validando el cliente.' });
    }
};
