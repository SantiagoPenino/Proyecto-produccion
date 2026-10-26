/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DASHBOARD DE VENTAS — CLIENTES  (23/10/2026)          /vendedores/dashboard
 * ═══════════════════════════════════════════════════════════════════════════
 * Solo lectura. Lo que compran los clientes, sobre las ÓRDENES cargadas
 * (dbo.Ordenes, sin las canceladas), con los mismos filtros que los reportes
 * de Administración y el panel de Producción:
 *   · VER POR: sector comercial o área productiva (?sector= | ?area=, los
 *     mismos de /contabilidad/reportes/ventas-filtros: el área es el
 *     NombreReferencia de ConfigMapeoERP).
 *   · Vendedor: la cartera (Clientes.VendedorID = cédula del trabajador).
 *   · FECHA (solo el resumen): ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD.
 *
 * GET /api/vendedor-360/dashboard/resumen     → lo del período: clientes que
 *     compraron, nuevos, pedidos, órdenes, importes y los 10 que más pedidos
 *     hicieron.
 * GET /api/vendedor-360/dashboard/sin-compras → los clientes que NO tienen
 *     ninguna orden cargada en los últimos ?dias= días (60 por defecto) pero
 *     sí antes: estado, vendedor, última compra y, en los 6 meses anteriores
 *     a esa última compra, qué servicios usaba, cuántos pedidos y órdenes, y
 *     el importe donde la orden tiene precio.
 *
 * Definiciones:
 *   · Sin las fichas genéricas de mostrador (2089, 8741: reglasVentas de
 *     contabilidadReportesController), que no son un cliente real.
 *   · Las canceladas, las fallas y las reposiciones no son compra (respuesta de
 *     la usuaria, 23/10; fallas/reposiciones = REPO_SQL del panel de Producción).
 *   · Compra = una orden cargada (Ordenes.FechaIngreso). Un pedido genera una
 *     orden por área (mismo NoDocERP): «pedidos» cuenta NoDocERP distintos y
 *     «órdenes» cuenta filas.
 *   · Con VER POR en un sector o área, todo se mira solo en esas áreas: «no
 *     compra hace 60 días en Sublimación» aunque siga comprando DTF.
 *   · Importe = OrdenesDeposito.OrdCostoFinal en su moneda (MonIdMoneda 1 = $,
 *     2 = US$), la fila más nueva por código de orden. Las órdenes sin esa
 *     fila o en 0 cuentan como «sin precio».
 * ═══════════════════════════════════════════════════════════════════════════
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { areasDeFiltro, condAreasIn, reglasVentas } = require('./contabilidadReportesController');
// Fallas y reposiciones (prioridad Falla / Reposición, códigos -F# / -R#): no son una compra. Misma regla que el panel de Producción
const { REPO_SQL } = require('./produccionPanelController');
// Las fichas genéricas de mostrador no son un cliente real (las mismas que saca Top Clientes)
const SQL_GENERICOS = reglasVentas.CLIENTES_GENERICOS.map(Number).filter(Number.isInteger).join(', ') || '0';

const DIAS_DEFECTO = 60;
const MESES_ANTES = 6;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fechaValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Las órdenes que cuentan (#O), con el filtro de VER POR y de vendedor. Deja la tabla temporal armada
// para las consultas que siguen en el mismo lote.
const armarOrdenes = async (rq, q) => {
    const areas = await areasDeFiltro({ sector: q.sector || null, area: q.area || null });
    const condArea = condAreasIn(areas, 'LTRIM(RTRIM(M.NombreReferencia))', rq);
    const vendedor = String(q.vendedor || '').trim();
    if (vendedor) rq.input('Vendedor', sql.NVarChar(50), vendedor);
    return `
        SELECT o.CliIdCliente, o.FechaIngreso,
               LTRIM(RTRIM(CAST(o.NoDocERP AS NVARCHAR(50)))) AS Pedido,
               LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden,
               COALESCE(NULLIF(LTRIM(RTRIM(M.NombreReferencia)), ''), LTRIM(RTRIM(o.AreaID)), 'Sin área') AS Servicio
        INTO #O
        FROM dbo.Ordenes o WITH(NOLOCK)
        LEFT JOIN dbo.ConfigMapeoERP M WITH(NOLOCK) ON LTRIM(RTRIM(M.AreaID_Interno)) = LTRIM(RTRIM(o.AreaID))
        ${vendedor ? 'JOIN dbo.Clientes cv WITH(NOLOCK) ON cv.CliIdCliente = o.CliIdCliente AND LTRIM(RTRIM(cv.VendedorID)) = @Vendedor' : ''}
        WHERE o.CliIdCliente IS NOT NULL
          AND o.CliIdCliente NOT IN (${SQL_GENERICOS})
          AND ISNULL(o.Estado, '') <> 'Cancelado'
          AND NOT ${REPO_SQL}
          ${condArea ? `AND ${condArea}` : ''};

        -- El importe de cada orden: la fila más nueva de OrdenesDeposito por código
        SELECT x.Cod, x.OrdCostoFinal, x.MonIdMoneda
        INTO #P
        FROM (
            SELECT LTRIM(RTRIM(od.OrdCodigoOrden)) AS Cod, od.OrdCostoFinal, od.MonIdMoneda,
                   ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(od.OrdCodigoOrden)) ORDER BY od.OrdIdOrden DESC) AS rn
            FROM dbo.OrdenesDeposito od WITH(NOLOCK)
            WHERE od.OrdCodigoOrden IS NOT NULL
        ) x
        WHERE x.rn = 1;
    `;
};

// Columnas de importe para un SELECT sobre #O o (con LEFT JOIN #P p)
const COLS_IMPORTE = `
    SUM(CASE WHEN p.MonIdMoneda = 2 THEN ISNULL(p.OrdCostoFinal, 0) ELSE 0 END) AS USD,
    SUM(CASE WHEN p.MonIdMoneda = 1 THEN ISNULL(p.OrdCostoFinal, 0) ELSE 0 END) AS UYU,
    SUM(CASE WHEN ISNULL(p.OrdCostoFinal, 0) > 0 THEN 0 ELSE 1 END) AS SinPrecio`;

const SELECT_CLIENTE = `
    c.CodCliente, LTRIM(RTRIM(c.IDCliente)) AS Alias, LTRIM(RTRIM(c.Nombre)) AS Nombre,
    LTRIM(RTRIM(c.NombreFantasia)) AS Fantasia, NULLIF(LTRIM(RTRIM(c.ESTADO)), '') AS Estado,
    tc.TClDescripcion AS TipoCliente, LTRIM(RTRIM(c.VendedorID)) AS VendedorID, LTRIM(RTRIM(t.Nombre)) AS Vendedor,
    NULLIF(LTRIM(RTRIM(c.TelefonoTrabajo)), '') AS Telefono, NULLIF(LTRIM(RTRIM(c.Email)), '') AS Email`;
const JOIN_CLIENTE = `
    JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = u.CliIdCliente
    LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
    OUTER APPLY (SELECT TOP 1 tr.Nombre FROM dbo.Trabajadores tr WITH(NOLOCK)
                 WHERE TRY_CAST(tr.Cedula AS NVARCHAR(50)) = LTRIM(RTRIM(c.VendedorID))) t`;

const aCliente = (f) => ({
    cliIdCliente: f.CliIdCliente,
    codCliente: f.CodCliente,
    alias: f.Alias || null,
    nombre: f.Fantasia || f.Nombre || f.Alias || `Cliente ${f.CliIdCliente}`,
    razonSocial: f.Nombre || null,
    estado: f.Estado || null,
    tipoCliente: f.TipoCliente || null,
    vendedorId: f.VendedorID || null,
    vendedor: f.Vendedor || f.VendedorID || null,
    telefono: f.Telefono || null,
    email: f.Email || null,
});

// GET /api/vendedor-360/dashboard/resumen?desde&hasta&sector&area&vendedor
exports.getResumen = async (req, res) => {
    const q = req.query || {};
    if (!fechaValida(q.desde) || !fechaValida(q.hasta)) return res.status(400).json({ success: false, error: 'Elegí el período (desde y hasta).' });
    try {
        const pool = await getPool();
        const rq = pool.request();
        rq.input('Desde', sql.Date, q.desde);
        rq.input('Hasta', sql.Date, q.hasta);
        const base = await armarOrdenes(rq, q);
        const r = await rq.query(`
            ${base}
            -- La primera compra de cada cliente (en el filtro): los «nuevos» son los que la hicieron en el período
            SELECT CliIdCliente, MIN(FechaIngreso) AS Primera INTO #F FROM #O GROUP BY CliIdCliente;

            SELECT COUNT(DISTINCT o.CliIdCliente) AS Clientes, COUNT(*) AS Ordenes, COUNT(DISTINCT o.Pedido) AS Pedidos, ${COLS_IMPORTE}
            FROM #O o LEFT JOIN #P p ON p.Cod = o.CodigoOrden
            WHERE o.FechaIngreso >= @Desde AND o.FechaIngreso < DATEADD(DAY, 1, @Hasta);

            SELECT COUNT(*) AS Nuevos FROM #F WHERE Primera >= @Desde AND Primera < DATEADD(DAY, 1, @Hasta);

            SELECT TOP 10 u.CliIdCliente, u.Pedidos, u.Ordenes, u.USD, u.UYU, u.SinPrecio, ${SELECT_CLIENTE}
            FROM (
                SELECT o.CliIdCliente, COUNT(DISTINCT o.Pedido) AS Pedidos, COUNT(*) AS Ordenes, ${COLS_IMPORTE}
                FROM #O o LEFT JOIN #P p ON p.Cod = o.CodigoOrden
                WHERE o.FechaIngreso >= @Desde AND o.FechaIngreso < DATEADD(DAY, 1, @Hasta)
                GROUP BY o.CliIdCliente
            ) u
            ${JOIN_CLIENTE}
            ORDER BY u.Pedidos DESC, u.USD DESC;

            SELECT o.CliIdCliente, o.Servicio, COUNT(*) AS Ordenes
            FROM #O o
            WHERE o.FechaIngreso >= @Desde AND o.FechaIngreso < DATEADD(DAY, 1, @Hasta)
            GROUP BY o.CliIdCliente, o.Servicio;

            DROP TABLE #O; DROP TABLE #P; DROP TABLE #F;`);
        const [totales, nuevos, top, servicios] = r.recordsets;
        const t = totales[0] || {};
        const serviciosDe = (id) => servicios.filter(s => s.CliIdCliente === id)
            .map(s => ({ servicio: s.Servicio, ordenes: s.Ordenes })).sort((a, b) => b.ordenes - a.ordenes);
        res.json({
            success: true,
            data: {
                clientes: t.Clientes || 0,
                nuevos: nuevos[0]?.Nuevos || 0,
                pedidos: t.Pedidos || 0,
                ordenes: t.Ordenes || 0,
                importe: { USD: r2(t.USD), UYU: r2(t.UYU), sinPrecio: t.SinPrecio || 0 },
                top: top.map(f => ({
                    ...aCliente(f), pedidos: f.Pedidos, ordenes: f.Ordenes,
                    importe: { USD: r2(f.USD), UYU: r2(f.UYU), sinPrecio: f.SinPrecio },
                    servicios: serviciosDe(f.CliIdCliente),
                })),
            },
        });
    } catch (err) {
        logger.error('[VENTAS-DASHBOARD] getResumen:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// GET /api/vendedor-360/dashboard/sin-compras?dias=60&sector&area&vendedor
exports.getSinCompras = async (req, res) => {
    const q = req.query || {};
    const dias = q.dias === undefined || q.dias === '' ? DIAS_DEFECTO : Number(q.dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 3650) return res.status(400).json({ success: false, error: 'Los días tienen que ser un número entero entre 1 y 3650.' });
    try {
        const pool = await getPool();
        const rq = pool.request();
        rq.input('Dias', sql.Int, dias);
        rq.input('Meses', sql.Int, MESES_ANTES);
        const base = await armarOrdenes(rq, q);
        const r = await rq.query(`
            DECLARE @Corte date = DATEADD(DAY, -@Dias, CAST(GETDATE() AS date));
            ${base}
            -- Los que compraron alguna vez pero ninguna orden desde el corte
            SELECT CliIdCliente, MAX(FechaIngreso) AS Ultima
            INTO #U FROM #O GROUP BY CliIdCliente HAVING MAX(FechaIngreso) < @Corte;

            SELECT u.CliIdCliente, CONVERT(VARCHAR(10), u.Ultima, 23) AS Ultima, DATEDIFF(DAY, u.Ultima, GETDATE()) AS DiasSinComprar,
                   CONVERT(VARCHAR(10), DATEADD(MONTH, -@Meses, u.Ultima), 23) AS VentanaDesde, ${SELECT_CLIENTE}
            FROM #U u
            ${JOIN_CLIENTE}
            ORDER BY u.Ultima DESC;

            -- Los ${MESES_ANTES} meses anteriores a la última compra, por servicio
            SELECT o.CliIdCliente, o.Servicio, COUNT(*) AS Ordenes, COUNT(DISTINCT o.Pedido) AS Pedidos, ${COLS_IMPORTE}
            FROM #O o
            JOIN #U u ON u.CliIdCliente = o.CliIdCliente
            LEFT JOIN #P p ON p.Cod = o.CodigoOrden
            WHERE o.FechaIngreso >= DATEADD(MONTH, -@Meses, u.Ultima)
            GROUP BY o.CliIdCliente, o.Servicio;

            -- Los pedidos distintos de esos meses (un pedido con dos áreas cuenta una vez)
            SELECT o.CliIdCliente, COUNT(DISTINCT o.Pedido) AS Pedidos
            FROM #O o JOIN #U u ON u.CliIdCliente = o.CliIdCliente
            WHERE o.FechaIngreso >= DATEADD(MONTH, -@Meses, u.Ultima)
            GROUP BY o.CliIdCliente;

            -- Desde cuándo hay órdenes en el sistema (la ventana de ${MESES_ANTES} meses puede quedar recortada)
            SELECT CONVERT(VARCHAR(10), MIN(FechaIngreso), 23) AS DatosDesde FROM dbo.Ordenes WITH(NOLOCK);

            DROP TABLE #O; DROP TABLE #P; DROP TABLE #U;`);
        const [clientes, porServicio, pedidos, desde] = r.recordsets;
        const datosDesde = desde[0]?.DatosDesde || null;
        const servicios = new Map();
        porServicio.forEach(s => {
            const lista = servicios.get(s.CliIdCliente) || [];
            lista.push({ servicio: s.Servicio, ordenes: s.Ordenes, pedidos: s.Pedidos, importe: { USD: r2(s.USD), UYU: r2(s.UYU), sinPrecio: s.SinPrecio } });
            servicios.set(s.CliIdCliente, lista);
        });
        const pedidosDe = new Map(pedidos.map(p => [p.CliIdCliente, p.Pedidos]));
        const data = clientes.map(f => {
            const lista = (servicios.get(f.CliIdCliente) || []).sort((a, b) => b.ordenes - a.ordenes);
            const suma = (k) => r2(lista.reduce((s, x) => s + x.importe[k], 0));
            return {
                ...aCliente(f),
                ultimaCompra: f.Ultima,
                diasSinComprar: f.DiasSinComprar,
                ventana: { desde: f.VentanaDesde, hasta: f.Ultima, recortada: !!datosDesde && f.VentanaDesde < datosDesde },
                servicios: lista,
                pedidos: pedidosDe.get(f.CliIdCliente) || 0,
                ordenes: lista.reduce((s, x) => s + x.ordenes, 0),
                importe: { USD: suma('USD'), UYU: suma('UYU'), sinPrecio: lista.reduce((s, x) => s + x.importe.sinPrecio, 0) },
            };
        });
        res.json({ success: true, dias, meses: MESES_ANTES, datosDesde, data });
    } catch (err) {
        logger.error('[VENTAS-DASHBOARD] getSinCompras:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
