'use strict';

/**
 * cobranzasReportesController.js
 * ────────────────────────────────────────────────────────────────────────────
 * Reportes de COBRANZAS pedidos por administración (documento "control de
 * cobranzas", 17-sep-2026). Todo sale de tablas que ya existen — no hay SQL nuevo:
 *   · DeudaDocumento   = la cuenta a cobrar (con DDeFechaVencimiento)
 *   · DocumentosContables = lo facturado
 *   · Pagos / TransaccionesCaja = lo cobrado
 *
 *   GET /reportes/cobranzas-vencimientos → panel diario: cada deuda viva con su prioridad
 *   GET /reportes/cobranzas-periodos     → informe semanal / mensual / trimestral
 *   GET /reportes/cobranzas-clientes     → ficha financiera por cliente
 *
 * "Deuda viva" = DDeEstado IN (PENDIENTE, VENCIDO, PARCIAL) con pendiente > 0, mismo
 * criterio que Antigüedad de Deuda (contabilidadService.getAntiguedadDeuda).
 * "Venta" = mismo criterio que contabilidadReportesController.condEsVenta.
 */

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const VIVAS = `('PENDIENTE', 'VENCIDO', 'PARCIAL')`;

const condEsVenta = (alias = 'doc') => `(
    (
        (${alias}.DocTipo LIKE '%Factura%' OR ${alias}.DocTipo LIKE '%FACTURA%' OR ${alias}.DocTipo LIKE '%Ticket%' OR ${alias}.DocTipo LIKE '%TICKET%')
        AND ${alias}.DocTipo NOT LIKE '%Nota%' AND ${alias}.DocTipo NOT LIKE '%NOTA%'
    )
    OR RTRIM(${alias}.DocTipo) = 'Pedidos Caja'
)`;

// Vendedor del cliente: Clientes.VendedorID guarda la CÉDULA del usuario (Usuarios.Cedula)
const VENDEDOR_APPLY = (cliAlias) => `
    OUTER APPLY (SELECT TOP 1 ISNULL(NULLIF(RTRIM(u.Nombre), ''), u.Usuario) AS Vendedor
                 FROM dbo.Usuarios u WITH(NOLOCK)
                 WHERE CAST(u.Cedula AS NVARCHAR(20)) = LTRIM(RTRIM(${cliAlias}.VendedorID))) ven`;

// Devuelve la fecha como TEXTO ISO ('YYYY-MM-DDT00:00:00' / 'T23:59:59.997') para
// mandarla a SQL como VarChar: con un Date, el driver la corría 3 horas según el reloj
// del proceso Node y el último día del rango perdía documentos (mismo problema
// corregido en contabilidadReportesController.bindFiltrosComunes, 23-sep-2026).
const parseFecha = (s, finDia = false) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}${finDia ? 'T23:59:59.997' : 'T00:00:00'}`;
};

// ─── GET /api/contabilidad/reportes/cobranzas-vencimientos ────────────────────
// Panel diario de vencimientos: una fila por deuda viva (factura, orden sin facturar
// o saldo inicial), con los días para vencer (negativo = vencida). La prioridad y los
// totales por tramo los arma el frontend sobre esta lista.
exports.getCobranzasVencimientos = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT
                d.DDeIdDocumento,
                cli.CliIdCliente,
                RTRIM(cli.Nombre)                         AS Cliente,
                RTRIM(ISNULL(cli.TelefonoTrabajo, ''))    AS Telefono,
                RTRIM(ISNULL(cli.Email, ''))              AS Email,
                CASE WHEN cc.CueTipo = 'DINERO_USD' THEN 'USD' ELSE 'UYU' END AS Moneda,
                CASE WHEN d.DocIdDocumento IS NOT NULL THEN 'FACTURA'
                     WHEN d.OrdIdOrden     IS NOT NULL THEN 'ORDEN'
                     ELSE 'OTRO' END                      AS Tipo,
                CASE WHEN d.DocIdDocumento IS NOT NULL
                          THEN RTRIM(doc.DocTipo) + ' ' + ISNULL(doc.DocSerie, '') + '-' + ISNULL(doc.DocNumero, '')
                     WHEN d.OrdIdOrden IS NOT NULL
                          THEN COALESCE(od.OrdCodigoOrden, ordERP.CodigoOrden, 'Orden #' + CAST(d.OrdIdOrden AS VARCHAR(20)))
                     ELSE 'Saldo inicial / sin documento' END AS Documento,
                d.DDeFechaEmision, d.DDeFechaVencimiento,
                d.DDeImporteOriginal, d.DDeImportePendiente, d.DDeEstado,
                DATEDIFF(DAY, GETDATE(), d.DDeFechaVencimiento) AS DiasParaVencer,
                ven.Vendedor,
                cp.CPaNombre AS CondicionPago
            FROM dbo.DeudaDocumento d WITH(NOLOCK)
            JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = d.CueIdCuenta
            JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
            LEFT JOIN dbo.CondicionesPago cp WITH(NOLOCK) ON cp.CPaIdCondicion = cc.CPaIdCondicion
            LEFT JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.DocIdDocumento = d.DocIdDocumento
            -- OrdIdOrden apunta a dos tablas según quién creó la deuda (mismo COALESCE que getTodasLasDeudasVivas)
            LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = d.OrdIdOrden
            LEFT JOIN dbo.Ordenes ordERP WITH(NOLOCK) ON ordERP.OrdenID = d.OrdIdOrden
            ${VENDEDOR_APPLY('cli')}
            WHERE d.DDeEstado IN ${VIVAS}
              AND d.DDeImportePendiente > 0
              AND cc.CueActiva = 1
              AND cc.CueTipo IN ('DINERO_UYU', 'DINERO_USD', 'CORRIENTE', 'CREDITO')
            ORDER BY d.DDeFechaVencimiento ASC, d.DDeImportePendiente DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('[COBRANZAS] getCobranzasVencimientos:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── GET /api/contabilidad/reportes/cobranzas-periodos ────────────────────────
// ?agrupar=semana|mes|trimestre &desde=YYYY-MM-DD &hasta=YYYY-MM-DD &vendedor=<cédula>
//
// Por cada período (según la FECHA DE LA FACTURA) y moneda:
//   Facturado = SUM(DocTotal) de las ventas del período
//   Pendiente = lo que de ESAS facturas sigue vivo en cuenta corriente
//   Vencido   = la parte del pendiente cuyo vencimiento ya pasó
//   Cobrado   = Facturado − Pendiente   ·   % cobranza = Cobrado / Facturado
//   Ingresos  = plata que ENTRÓ a caja en el período (por fecha de pago), dato aparte:
//               incluye cobros de facturas viejas, por eso no tiene por qué dar igual a Cobrado.
//
// El pendiente se lleva a la moneda de la factura con la proporción pendiente/original de
// su deuda: así una factura cuya deuda se asentó en la cuenta de la otra moneda (o que
// tiene la deuda duplicada) no se cuenta mal ni dos veces.
exports.getCobranzasPeriodos = async (req, res) => {
    try {
        const pool = await getPool();
        const agrupar = ['semana', 'mes', 'trimestre'].includes(req.query.agrupar) ? req.query.agrupar : 'mes';
        const hoy = new Date();
        const hasta = parseFecha(req.query.hasta, true) || hoy;
        let desde = parseFecha(req.query.desde);
        if (!desde) {
            desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
            if (agrupar === 'semana') { desde = new Date(hoy); desde.setDate(hoy.getDate() - 7 * 8); }
            else if (agrupar === 'mes') desde.setMonth(desde.getMonth() - 5);
            else desde.setMonth(desde.getMonth() - 11);
            desde.setHours(0, 0, 0, 0);
        }
        const vendedor = req.query.vendedor ? String(req.query.vendedor).trim() : null;

        // Inicio del período de una fecha (semana = lunes; 1900-01-01 fue lunes)
        const periodoDe = (f) => agrupar === 'semana'
            ? `DATEADD(DAY, -(DATEDIFF(DAY, '19000101', CAST(${f} AS DATE)) % 7), CAST(${f} AS DATE))`
            : agrupar === 'trimestre'
                ? `DATEFROMPARTS(YEAR(${f}), ((MONTH(${f}) - 1) / 3) * 3 + 1, 1)`
                : `DATEFROMPARTS(YEAR(${f}), MONTH(${f}), 1)`;

        const base = () => pool.request()
            .input('desde', sql.VarChar(30), desde)
            .input('hasta', sql.VarChar(30), hasta)
            .input('vendedor', sql.NVarChar(20), vendedor);

        const CTE_DOCS = `
            ;WITH Docs AS (
                SELECT doc.DocIdDocumento, doc.DocTotal, doc.MonIdMoneda, doc.DocFechaEmision, doc.CliIdCliente
                FROM dbo.DocumentosContables doc WITH(NOLOCK)
                LEFT JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = doc.CliIdCliente
                WHERE ${condEsVenta('doc')}
                  AND doc.DocEstado <> 'ANULADO'
                  AND doc.DocFechaEmision >= @desde AND doc.DocFechaEmision <= @hasta
                  AND (@vendedor IS NULL OR LTRIM(RTRIM(cli.VendedorID)) = @vendedor)
            ),
            Deuda AS (
                SELECT d.DocIdDocumento,
                       SUM(CASE WHEN d.DDeEstado NOT IN ('CANCELADA', 'CANCELADO') THEN d.DDeImporteOriginal ELSE 0 END) AS Orig,
                       SUM(CASE WHEN d.DDeEstado IN ${VIVAS} THEN d.DDeImportePendiente ELSE 0 END) AS Pend,
                       SUM(CASE WHEN d.DDeEstado IN ${VIVAS} AND d.DDeFechaVencimiento < CAST(GETDATE() AS DATE)
                                THEN d.DDeImportePendiente ELSE 0 END) AS Venc
                FROM dbo.DeudaDocumento d WITH(NOLOCK)
                WHERE d.DocIdDocumento IN (SELECT DocIdDocumento FROM Docs)
                GROUP BY d.DocIdDocumento
            ),
            Base AS (
                SELECT x.*,
                       x.DocTotal * CASE WHEN ISNULL(de.Orig, 0) <= 0 THEN 0 WHEN de.Pend >= de.Orig THEN 1 ELSE de.Pend / de.Orig END AS Pendiente,
                       x.DocTotal * CASE WHEN ISNULL(de.Orig, 0) <= 0 THEN 0 WHEN de.Venc >= de.Orig THEN 1 ELSE de.Venc / de.Orig END AS Vencido
                FROM Docs x
                LEFT JOIN Deuda de ON de.DocIdDocumento = x.DocIdDocumento
            )`;

        const [rPer, rCond, rIng, rVend] = await Promise.all([
            base().query(`
                ${CTE_DOCS}
                SELECT ${periodoDe('b.DocFechaEmision')} AS Periodo,
                       CASE WHEN b.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
                       COUNT(*) AS Documentos, COUNT(DISTINCT b.CliIdCliente) AS Clientes,
                       SUM(b.DocTotal) AS Facturado, SUM(b.Pendiente) AS Pendiente, SUM(b.Vencido) AS Vencido
                FROM Base b
                GROUP BY ${periodoDe('b.DocFechaEmision')}, CASE WHEN b.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END
                ORDER BY Periodo DESC, Moneda
            `),
            // Mismo rango, abierto por la condición de pago del cliente (la "modalidad" del documento)
            base().query(`
                ${CTE_DOCS}
                SELECT ISNULL(cond.CPaNombre, 'Sin condición') AS Condicion,
                       CASE WHEN b.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
                       COUNT(DISTINCT b.CliIdCliente) AS Clientes,
                       SUM(b.DocTotal) AS Facturado, SUM(b.Pendiente) AS Pendiente, SUM(b.Vencido) AS Vencido
                FROM Base b
                OUTER APPLY (SELECT TOP 1 cp.CPaNombre
                             FROM dbo.CuentasCliente cc WITH(NOLOCK)
                             JOIN dbo.CondicionesPago cp WITH(NOLOCK) ON cp.CPaIdCondicion = cc.CPaIdCondicion
                             WHERE cc.CliIdCliente = b.CliIdCliente AND cc.CueActiva = 1 AND cc.CueEsPrincipal = 1
                             ORDER BY CASE WHEN cc.MonIdMoneda = b.MonIdMoneda THEN 0 ELSE 1 END, cc.CueIdCuenta) cond
                GROUP BY ISNULL(cond.CPaNombre, 'Sin condición'), CASE WHEN b.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END
                ORDER BY Moneda, Facturado DESC
            `),
            // Plata que entró a caja en el período (por FECHA DE PAGO). Pagos → TransaccionesCaja.
            base().query(`
                SELECT ${periodoDe('p.PagFechaPago')} AS Periodo,
                       CASE WHEN p.PagIdMonedaPago = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
                       SUM(p.PagMontoPago) AS Ingresos
                FROM dbo.Pagos p WITH(NOLOCK)
                JOIN dbo.TransaccionesCaja t WITH(NOLOCK) ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
                LEFT JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = t.TcaClienteId
                WHERE p.PagFechaPago >= @desde AND p.PagFechaPago <= @hasta
                  AND p.PagTipoMovimiento <> 'ANULADO'
                  AND t.TcaEstado IN ('COMPLETADO', 'COMPLETADA', 'COBRADO')
                  AND (@vendedor IS NULL OR LTRIM(RTRIM(cli.VendedorID)) = @vendedor)
                GROUP BY ${periodoDe('p.PagFechaPago')}, CASE WHEN p.PagIdMonedaPago = 2 THEN 'USD' ELSE 'UYU' END
            `),
            pool.request().query(`
                SELECT DISTINCT LTRIM(RTRIM(c.VendedorID)) AS Cedula,
                       ISNULL(NULLIF(RTRIM(u.Nombre), ''), u.Usuario) AS Nombre
                FROM dbo.Clientes c WITH(NOLOCK)
                JOIN dbo.Usuarios u WITH(NOLOCK) ON CAST(u.Cedula AS NVARCHAR(20)) = LTRIM(RTRIM(c.VendedorID))
                ORDER BY Nombre
            `),
        ]);

        const clave = (f) => new Date(f).toISOString().slice(0, 10);
        const ingresos = {};
        for (const r of rIng.recordset) ingresos[`${clave(r.Periodo)}|${r.Moneda}`] = Number(r.Ingresos || 0);

        const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
        const armar = (r) => {
            const fact = Number(r.Facturado || 0), pend = Number(r.Pendiente || 0);
            return {
                Facturado: r2(fact), Pendiente: r2(pend), Vencido: r2(r.Vencido), Cobrado: r2(fact - pend),
                PctCobranza: fact > 0 ? Math.round((fact - pend) / fact * 1000) / 10 : null,
            };
        };

        res.json({
            success: true,
            agrupar,
            desde, hasta,
            periodos: rPer.recordset.map(r => ({
                Periodo: clave(r.Periodo), Moneda: r.Moneda, Documentos: r.Documentos, Clientes: r.Clientes,
                ...armar(r), Ingresos: r2(ingresos[`${clave(r.Periodo)}|${r.Moneda}`] || 0),
            })),
            porCondicion: rCond.recordset.map(r => ({ Condicion: r.Condicion, Moneda: r.Moneda, Clientes: r.Clientes, ...armar(r) })),
            vendedores: rVend.recordset,
        });
    } catch (err) {
        logger.error('[COBRANZAS] getCobranzasPeriodos:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── GET /api/contabilidad/reportes/cobranzas-clientes ────────────────────────
// Ficha financiera de los clientes que hoy deben algo: pendiente y vencido por moneda,
// facturas vencidas, días de atraso máximo, último pago y cuánto demora en pagar (promedio
// de días entre la emisión y el cobro de sus deudas ya cobradas).
exports.getCobranzasClientes = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            ;WITH Vivas AS (
                SELECT cc.CliIdCliente,
                       CASE WHEN cc.CueTipo = 'DINERO_USD' THEN 'USD' ELSE 'UYU' END AS Moneda,
                       SUM(d.DDeImportePendiente) AS Pendiente,
                       SUM(CASE WHEN d.DDeFechaVencimiento < CAST(GETDATE() AS DATE) THEN d.DDeImportePendiente ELSE 0 END) AS Vencido,
                       COUNT(*) AS DeudasVivas,
                       SUM(CASE WHEN d.DDeFechaVencimiento < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS DeudasVencidas,
                       MAX(DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE())) AS MaxDiasAtraso
                FROM dbo.DeudaDocumento d WITH(NOLOCK)
                JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = d.CueIdCuenta
                WHERE d.DDeEstado IN ${VIVAS} AND d.DDeImportePendiente > 0 AND cc.CueActiva = 1
                  AND cc.CueTipo IN ('DINERO_UYU', 'DINERO_USD', 'CORRIENTE', 'CREDITO')
                GROUP BY cc.CliIdCliente, CASE WHEN cc.CueTipo = 'DINERO_USD' THEN 'USD' ELSE 'UYU' END
            )
            SELECT v.CliIdCliente, RTRIM(cli.Nombre) AS Cliente, RTRIM(ISNULL(cli.TelefonoTrabajo, '')) AS Telefono,
                   v.Moneda, v.Pendiente, v.Vencido, v.DeudasVivas, v.DeudasVencidas,
                   CASE WHEN v.MaxDiasAtraso > 0 THEN v.MaxDiasAtraso ELSE 0 END AS MaxDiasAtraso,
                   ven.Vendedor, up.UltimoPagoFecha, up.UltimoPagoMonto, up.UltimoPagoMoneda,
                   dp.DiasPromedioPago, dp.DeudasCobradas
            FROM Vivas v
            JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = v.CliIdCliente
            ${VENDEDOR_APPLY('cli')}
            OUTER APPLY (SELECT TOP 1 p.PagFechaPago AS UltimoPagoFecha, p.PagMontoPago AS UltimoPagoMonto,
                                CASE WHEN p.PagIdMonedaPago = 2 THEN 'USD' ELSE 'UYU' END AS UltimoPagoMoneda
                         FROM dbo.Pagos p WITH(NOLOCK)
                         JOIN dbo.TransaccionesCaja t WITH(NOLOCK) ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
                         WHERE t.TcaClienteId = v.CliIdCliente AND p.PagTipoMovimiento <> 'ANULADO'
                           AND t.TcaEstado IN ('COMPLETADO', 'COMPLETADA', 'COBRADO')
                         ORDER BY p.PagFechaPago DESC) up
            OUTER APPLY (SELECT AVG(CAST(DATEDIFF(DAY, d2.DDeFechaEmision, d2.DDeFechaCobro) AS FLOAT)) AS DiasPromedioPago, COUNT(*) AS DeudasCobradas
                         FROM dbo.DeudaDocumento d2 WITH(NOLOCK)
                         JOIN dbo.CuentasCliente c2 WITH(NOLOCK) ON c2.CueIdCuenta = d2.CueIdCuenta
                         WHERE c2.CliIdCliente = v.CliIdCliente AND d2.DDeFechaCobro IS NOT NULL
                           AND d2.DDeEstado IN ('COBRADO', 'PAGADO')) dp
            ORDER BY v.Vencido DESC, v.Pendiente DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('[COBRANZAS] getCobranzasClientes:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
