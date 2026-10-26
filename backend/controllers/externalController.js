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

// GET /api/external/ordenes-produccion — órdenes de producción (tabla Ordenes) con sus archivos, para el
// sistema del compañero (pedido del 23/10/2026). Por orden: código, cantidad de archivos, metros y copias de
// cada archivo, máquina (o null), si tuvo fallas (o null) y fecha y hora de creación (23/10). Lo que se pidió:
// material, variante, código de artículo, cantidad pedida y unidad (23/10, más tarde).
// Auth: header x-api-key = EXTERNAL_API_KEY (la misma que /ordenes).
// GET /api/external/ordenes-produccion?page=1&pageSize=100&fechaDesde=AAAA-MM-DD&fechaHasta=AAAA-MM-DD&codigoOrden=
//
// - Sin las órdenes canceladas ni los archivos cancelados (no se producen).
// - metros = de UNA copia (así lo guarda ArchivosOrden.Metros): el total del archivo es metros × copias.
// - maquina = la de la orden o, si no tiene, la de su lote (ISNULL(o.MaquinaID, r.MaquinaID), como la planilla).
// - tuvoFallas = true si se le registró alguna falla (FallasProduccion) o tiene un archivo en falla
//   (EstadoArchivo 'FALLA' o CopiasFalladas > 0, como completarOrden); false si ya pasó por control o está
//   finalizada sin fallas; null si todavía no se controló (no se sabe).
// - codigoOrden filtra exacto (no LIKE): 'DTF-123' no trae 'DTF-1234'. Las fechas son de ingreso de la orden.
// - material / variante / codigoArticulo: lo que se pidió, de la orden (Ordenes.Material, Variante, CodArticulo). Es uno
//   por orden: el CodigoArticulo de cada archivo es siempre el de su orden (verificado en 31.713 archivos, 23/10).
// - cantidadPedida / unidad: Ordenes.Magnitud y UM, tal cual las usa el sistema ('m', 'u', 'prend', 'baj'…). En las
//   reposiciones (-R) es lo repuesto, no lo de la orden madre.
// - fechaCreacion = Ordenes.FechaIngreso en hora de Uruguay con su desfase ('2026-10-21T14:55:14-03:00'). Uruguay no
//   tiene horario de verano desde 2015: siempre -03:00. Se arma desde el Date del driver, que ya viene bien en cada
//   entorno (DB_USE_UTC). Por lo mismo, fechaDesde/fechaHasta son días de Uruguay y van como Date (en producción la
//   base guarda UTC: un literal 'AAAA-MM-DD' cortaba el día a las 21:00 del anterior).
exports.getOrdenesProduccion = async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY;

    if (!apiKey || apiKey !== EXTERNAL_API_KEY) {
        return res.status(401).json({ error: 'No autorizado. API Key inválida o faltante.' });
    }

    let page = parseInt(req.query.page, 10);
    let pageSize = parseInt(req.query.pageSize, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 100;
    if (pageSize > 1000) pageSize = 1000;
    const offset = (page - 1) * pageSize;

    const { fechaDesde, fechaHasta, codigoOrden } = req.query;
    const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
    if ((fechaDesde && !esFecha(fechaDesde)) || (fechaHasta && !esFecha(fechaHasta))) {
        return res.status(400).json({ error: 'Las fechas van como AAAA-MM-DD.' });
    }

    try {
        const pool = await getPool();
        const request = pool.request();

        let where = " WHERE ISNULL(o.Estado, '') <> 'Cancelado'";
        const medianocheUY = (dia) => new Date(`${dia}T00:00:00-03:00`);
        if (fechaDesde) {
            where += ' AND o.FechaIngreso >= @fechaDesde';
            request.input('fechaDesde', sql.DateTime, medianocheUY(fechaDesde));
        }
        if (fechaHasta) {
            where += ' AND o.FechaIngreso < @fechaHastaExcl';
            request.input('fechaHastaExcl', sql.DateTime, new Date(medianocheUY(fechaHasta).getTime() + 24 * 60 * 60 * 1000));
        }
        if (codigoOrden) {
            where += ' AND LTRIM(RTRIM(o.CodigoOrden)) = @codigoOrden';
            request.input('codigoOrden', sql.VarChar(100), String(codigoOrden).trim());
        }

        const countResult = await request.query(`SELECT COUNT(*) AS total FROM Ordenes o WITH(NOLOCK) ${where}`);
        const total = countResult.recordset[0].total;

        request.input('offset', sql.Int, offset);
        request.input('pageSize', sql.Int, pageSize);
        const ordenes = (await request.query(`
            SELECT
                o.OrdenID,
                LTRIM(RTRIM(o.CodigoOrden)) AS codigoOrden,
                o.FechaIngreso,
                LTRIM(RTRIM(o.Material))    AS material,
                LTRIM(RTRIM(o.Variante))    AS variante,
                LTRIM(RTRIM(o.CodArticulo)) AS codigoArticulo,
                o.Magnitud,
                LTRIM(RTRIM(o.UM))          AS unidad,
                LTRIM(RTRIM(ce.Nombre))     AS maquina,
                CASE
                    WHEN EXISTS (SELECT 1 FROM FallasProduccion f WITH(NOLOCK) WHERE f.OrdenID = o.OrdenID)
                      OR EXISTS (SELECT 1 FROM ArchivosOrden a WITH(NOLOCK)
                                 WHERE a.OrdenID = o.OrdenID AND (a.EstadoArchivo = 'FALLA' OR ISNULL(a.CopiasFalladas, 0) > 0))
                        THEN 1
                    WHEN o.Estado = 'Finalizado'
                      OR EXISTS (SELECT 1 FROM ArchivosOrden a WITH(NOLOCK) WHERE a.OrdenID = o.OrdenID AND a.EstadoArchivo = 'OK')
                        THEN 0
                    ELSE NULL
                END AS tuvoFallas
            FROM Ordenes o WITH(NOLOCK)
            LEFT JOIN Rollos r WITH(NOLOCK) ON r.RolloID = o.RolloID
            LEFT JOIN ConfigEquipos ce WITH(NOLOCK) ON ce.EquipoID = ISNULL(o.MaquinaID, r.MaquinaID)
            ${where}
            ORDER BY o.FechaIngreso DESC, o.OrdenID DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
        `)).recordset;

        // Archivos de las órdenes de esta página (una sola consulta)
        const archivosPorOrden = new Map();
        if (ordenes.length) {
            const archivos = (await pool.request()
                .input('ids', sql.VarChar(sql.MAX), ordenes.map(o => o.OrdenID).join(','))
                .query(`
                    SELECT a.OrdenID, a.ArchivoID, a.NombreArchivo, a.Metros, a.Copias
                    FROM ArchivosOrden a WITH(NOLOCK)
                    WHERE a.OrdenID IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
                      AND ISNULL(a.EstadoArchivo, '') <> 'CANCELADO'
                    ORDER BY a.OrdenID, a.ArchivoID
                `)).recordset;
            for (const a of archivos) {
                if (!archivosPorOrden.has(a.OrdenID)) archivosPorOrden.set(a.OrdenID, []);
                archivosPorOrden.get(a.OrdenID).push({
                    archivoId: a.ArchivoID,
                    nombre: a.NombreArchivo,
                    metros: a.Metros == null ? null : Number(a.Metros),
                    copias: a.Copias == null ? null : Number(a.Copias),
                });
            }
        }

        // '2026-10-21T14:55:14-03:00'
        const horaUY = (f) => f ? `${new Date(f.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19)}-03:00` : null;
        const data = ordenes.map(o => {
            const archivos = archivosPorOrden.get(o.OrdenID) || [];
            return {
                codigoOrden: o.codigoOrden,
                fechaCreacion: horaUY(o.FechaIngreso),
                material: o.material || null,
                variante: o.variante || null,
                codigoArticulo: o.codigoArticulo || null,
                // Magnitud es texto en la base ('5.00', '200'); si no es un número, null
                cantidadPedida: (() => { const n = parseFloat(String(o.Magnitud ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; })(),
                unidad: o.unidad || null,
                cantidadArchivos: archivos.length,
                archivos,
                maquina: o.maquina || null,
                tuvoFallas: o.tuvoFallas == null ? null : o.tuvoFallas === 1,
            };
        });

        res.json({
            success: true,
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
            count: data.length,
            data
        });
    } catch (error) {
        console.error('Error obteniendo órdenes de producción para sistema externo:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener órdenes de producción.' });
    }
};

// GET /api/external/telas
// Devuelve los artículos de tela activos (Grupo 1.1, CodStock 1.1.1.1, Mostrar=1).
// Auth: header x-api-key = EXTERNAL_API_KEY
exports.getTelas = async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY;

    if (!apiKey || apiKey !== EXTERNAL_API_KEY) {
        return res.status(401).json({ error: 'No autorizado. API Key inválida o faltante.' });
    }

    try {
        const pool = await getPool();
        const query = `
            SELECT
                a.ProIdProducto as id,
                LTRIM(RTRIM(a.CodArticulo)) as codigoArticulo,
                LTRIM(RTRIM(a.Descripcion)) as descripcion,
                CASE WHEN a.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END as moneda,
                pb.Precio as precioBase
            FROM Articulos a WITH(NOLOCK)
            LEFT JOIN PreciosBase pb WITH(NOLOCK) ON pb.ProIdProducto = a.ProIdProducto
            WHERE a.Mostrar = 1
              AND LTRIM(RTRIM(a.Grupo)) = '1.1'
              AND LTRIM(RTRIM(a.CodStock)) = '1.1.1.1'
            ORDER BY a.Descripcion
        `;
        const result = await pool.request().query(query);

        res.json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('Error obteniendo telas para sistema externo:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener telas.' });
    }
};

// GET /api/external/clientes-crm — ficha de cliente para el CRM del compañero (campos y
// nombres definidos con él el 03/09). Distinto de /clientes: ese ya lo consume otra
// integración y no se le tocan los nombres de campo para no romperla.
// Auth: header x-api-key = CRM_API_KEY (si no está seteada, cae a EXTERNAL_API_KEY).
//
// Departamento/Localidad van RESUELTOS a texto (pedido explícito, no el ID crudo).
// UltimaCompra = fecha del último pedido de OrdenesDeposito con pago asociado
// (PagIdPago > 0) — no cualquier pedido, y no la fecha de facturación.
// TotalFacturado quedó afuera a pedido: DocumentosContables mezcla ventas con
// recibos/egresos y sumar todo a lo bruto da un número inflado — se descartó el cálculo.
exports.getClientesCrm = async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const VALID_KEY = process.env.CRM_API_KEY || process.env.EXTERNAL_API_KEY;

    if (!apiKey || apiKey !== VALID_KEY) {
        return res.status(401).json({ error: 'No autorizado. API Key inválida o faltante.' });
    }

    try {
        const pool = await getPool();
        // CTE con la fecha ya agregada por cliente: un JOIN, no una subquery correlacionada
        // por cada uno de los ~5.250 clientes (OrdenesDeposito no tiene índice en
        // CliIdCliente — la correlacionada haría un scan por fila, mismo patrón que ya
        // causó 275% de CPU en el tablero en agosto).
        const query = `
            ;WITH UltimasCompras AS (
                SELECT CliIdCliente, MAX(OrdFechaIngresoOrden) AS UltimaCompra
                FROM dbo.OrdenesDeposito WITH (NOLOCK)
                WHERE PagIdPago > 0
                GROUP BY CliIdCliente
            )
            SELECT
                c.CliIdCliente                    AS Id,
                LTRIM(RTRIM(c.IDCliente))          AS IdCliente,
                LTRIM(RTRIM(c.Nombre))             AS Nombre,
                LTRIM(RTRIM(c.TelefonoTrabajo))    AS Telefono,
                uc.UltimaCompra                    AS UltimaCompra,
                LTRIM(RTRIM(c.VendedorID))         AS Vendedor,
                LTRIM(RTRIM(c.NombreFantasia))     AS RazonSocial,
                LTRIM(RTRIM(c.Email))              AS Email,
                LTRIM(RTRIM(dep.Nombre))           AS Departamento,
                LTRIM(RTRIM(loc.Nombre))           AS Localidad,
                c.ESTADO                           AS Estado
            FROM dbo.Clientes c WITH (NOLOCK)
            LEFT JOIN UltimasCompras uc ON uc.CliIdCliente = c.CliIdCliente
            LEFT JOIN dbo.Departamentos dep WITH (NOLOCK) ON dep.ID = c.DepartamentoID
            LEFT JOIN dbo.Localidades   loc WITH (NOLOCK) ON loc.ID = c.LocalidadID
            WHERE c.CliIdCliente IS NOT NULL
            ORDER BY c.CliIdCliente
        `;
        const result = await pool.request().query(query);

        res.json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('Error obteniendo clientes-crm:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener clientes.' });
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

