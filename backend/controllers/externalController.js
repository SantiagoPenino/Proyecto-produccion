const { sql, getPool } = require('../config/db');

exports.getClientes = async (req, res) => {
    // Basic API Key validation
    const apiKey = req.headers['x-api-key'];
    // Default fallback en caso de no tenerlo en el .env
    const EXPERT_API_KEY = process.env.EXTERNAL_API_KEY;

    if (!apiKey || apiKey !== EXPERT_API_KEY) {
        return res.status(401).json({ error: 'No autorizado. API Key inválida o faltante.' });
    }

    try {
        const pool = await getPool();
        const query = `
            SELECT 
                c.CliIdCliente as id,
                c.CodCliente,
                c.IDCliente,
                c.Nombre,
                c.NombreFantasia,
                c.Email,
                c.TelefonoTrabajo,
                c.CioRuc,
                c.DireccionTrabajo,
                c.DepartamentoID,
                c.LocalidadID,
                c.VendedorID,
                t.Nombre as VendedorNombre,
                c.FormaEnvioID,
                c.WebLastLogin
            FROM [SecureAppDB].[dbo].[Clientes] c
            LEFT JOIN [SecureAppDB].[dbo].[Trabajadores] t ON CAST(c.VendedorID AS VARCHAR) = CAST(t.Cedula AS VARCHAR)
            WHERE c.CliIdCliente IS NOT NULL
        `;
        const result = await pool.request().query(query);

        res.json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('Error obteniendo clientes para sistema externo:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener clientes.' });
    }
};

// PATCH /api/external/clientes/:id/vendedor
exports.updateVendedor = async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY;

    if (!apiKey || apiKey !== EXTERNAL_API_KEY) {
        return res.status(401).json({ error: 'No autorizado. API Key inválida o faltante.' });
    }

    const { id } = req.params;
    const { VendedorID } = req.body;

    if (!id) {
        return res.status(400).json({ error: 'Falta el parámetro id del cliente.' });
    }
    if (VendedorID === undefined || VendedorID === null) {
        return res.status(400).json({ error: 'Falta el campo VendedorID en el body.' });
    }

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('VendedorID', sql.Int, VendedorID)
            .input('CliIdCliente', sql.Int, id)
            .query(`
                UPDATE [SecureAppDB].[dbo].[Clientes]
                SET VendedorID = @VendedorID
                WHERE CliIdCliente = @CliIdCliente
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado.' });
        }

        res.json({ success: true, message: `VendedorID actualizado correctamente para cliente ${id}.` });
    } catch (error) {
        console.error('Error actualizando VendedorID:', error);
        res.status(500).json({ error: 'Error interno al actualizar VendedorID.' });
    }
};

// GET /api/external/ordenes
// Devuelve las órdenes de la tabla OrdenesDeposito (con importe) para consumo externo.
// Auth: header x-api-key = EXTERNAL_API_KEY
// Filtros opcionales (query string): fechaDesde, fechaHasta (YYYY-MM-DD), codigoOrden, estado, idCliente, material
// Paginación: page (>=1, default 1), pageSize (1-1000, default 100)
exports.getOrdenes = async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY;

    if (!apiKey || apiKey !== EXTERNAL_API_KEY) {
        return res.status(401).json({ error: 'No autorizado. API Key inválida o faltante.' });
    }

    // --- Paginación ---
    let page = parseInt(req.query.page, 10);
    let pageSize = parseInt(req.query.pageSize, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 100;
    if (pageSize > 1000) pageSize = 1000;
    const offset = (page - 1) * pageSize;

    const { fechaDesde, fechaHasta, codigoOrden, estado, idCliente, material } = req.query;

    try {
        const pool = await getPool();
        const request = pool.request();

        // Construcción dinámica del WHERE (compartido entre el conteo y la página)
        let where = ' WHERE 1 = 1';
        if (fechaDesde) {
            where += ' AND CONVERT(DATE, o.OrdFechaIngresoOrden) >= @fechaDesde';
            request.input('fechaDesde', sql.Date, new Date(fechaDesde));
        }
        if (fechaHasta) {
            where += ' AND CONVERT(DATE, o.OrdFechaIngresoOrden) <= @fechaHasta';
            request.input('fechaHasta', sql.Date, new Date(fechaHasta));
        }
        if (codigoOrden) {
            where += ` AND o.OrdCodigoOrden LIKE '%' + @codigoOrden + '%'`;
            request.input('codigoOrden', sql.NVarChar, codigoOrden);
        }
        if (estado) {
            where += ' AND eo.EOrNombreEstado = @estado';
            request.input('estado', sql.NVarChar, estado);
        }
        if (idCliente) {
            where += ` AND (c.IDCliente LIKE '%' + @idCliente + '%' OR c.Nombre LIKE '%' + @idCliente + '%')`;
            request.input('idCliente', sql.NVarChar, idCliente);
        }
        if (material) {
            // "material" = producto (Articulos): busca por descripción o código de artículo
            where += ` AND (p.Descripcion LIKE '%' + @material + '%' OR p.CodArticulo LIKE '%' + @material + '%')`;
            request.input('material', sql.NVarChar, material);
        }

        const fromJoins = `
            FROM OrdenesDeposito o WITH(NOLOCK)
            LEFT JOIN Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
            LEFT JOIN Articulos p WITH(NOLOCK) ON o.ProIdProducto = p.ProIdProducto
            LEFT JOIN Monedas mon WITH(NOLOCK) ON o.MonIdMoneda = mon.MonIdMoneda
            LEFT JOIN EstadosOrdenes eo WITH(NOLOCK) ON o.OrdEstadoActual = eo.EOrIdEstadoOrden
            LEFT JOIN ModosOrdenes mo WITH(NOLOCK) ON o.MOrIdModoOrden = mo.MOrIdModoOrden
        `;

        // Total de registros que cumplen el filtro
        const countResult = await request.query(`SELECT COUNT(*) AS total ${fromJoins} ${where}`);
        const total = countResult.recordset[0].total;

        // Página de datos
        request.input('offset', sql.Int, offset);
        request.input('pageSize', sql.Int, pageSize);

        const dataQuery = `
            SELECT
                LTRIM(RTRIM(o.OrdCodigoOrden))             AS codigoOrden,
                LTRIM(RTRIM(c.IDCliente))                  AS idCliente,
                LTRIM(RTRIM(o.OrdNombreTrabajo))           AS trabajo,
                LTRIM(RTRIM(ISNULL(p.Descripcion, '')))    AS producto,
                LTRIM(RTRIM(ISNULL(p.CodArticulo, '')))    AS codigoProducto,
                LTRIM(RTRIM(mo.MOrNombreModo))             AS modo,
                o.OrdCantidad                              AS cantidad,
                LTRIM(RTRIM(eo.EOrNombreEstado))           AS estado,
                o.OrdFechaIngresoOrden                     AS fechaIngreso,
                CAST(o.OrdCostoFinal AS DECIMAL(10,2))     AS importe,
                LTRIM(RTRIM(mon.MonSimbolo))               AS moneda
            ${fromJoins}
            ${where}
            ORDER BY o.OrdFechaIngresoOrden DESC, o.OrdIdOrden DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
        `;

        const result = await request.query(dataQuery);

        res.json({
            success: true,
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('Error obteniendo órdenes para sistema externo:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener órdenes.' });
    }
};

// GET /api/external/vendedores
exports.getVendedores = async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY;

    if (!apiKey || apiKey !== EXTERNAL_API_KEY) {
        return res.status(401).json({ error: 'No autorizado. API Key inválida o faltante.' });
    }

    try {
        const pool = await getPool();
        const query = `
            SELECT 
                Cedula as id,
                Cedula as VendedorID,
                Nombre as VendedorNombre,
                Zona 
            FROM [SecureAppDB].[dbo].[Trabajadores]
            WHERE Zona IS NOT NULL AND LTRIM(RTRIM(Zona)) != ''
        `;
        const result = await pool.request().query(query);

        res.json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('Error obteniendo vendedores para sistema externo:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener vendedores.' });
    }
};

