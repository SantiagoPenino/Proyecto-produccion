'use strict';

/**
 * contabilidadReportesController.js
 * ────────────────────────────────────────────────────────────────────────────
 * Reportes de Contabilidad: ventas por área, ventas por documento (DGI).
 *
 * DocTipo real en DocumentosContables (verificado contra la base, no es 'FACTURA'
 * literal): 'E-Factura Contado', 'E-Factura Credito', 'E-Ticket Contado',
 * 'E-TICKET CREDITO', notas de crédito/débito, 'Pedidos Caja', 'Recibo',
 * 'RECIBO ANTICIPO', 'EGRESO_CAJA'. "Venta" acá = Factura/Ticket (sin Notas)
 * únicamente — Pedidos Caja, recibos y egresos quedan afuera de ambos reportes.
 *
 * El área NO sale de Ordenes.AreaID (el join OrdenesDeposito→Ordenes casi nunca
 * resuelve para estos documentos — verificado contra la base). Sale del PREFIJO
 * del código de orden (OrdenesDeposito.OrdCodigoOrden, ej. 'DF-102047',
 * 'XSB-45248'), matcheado contra la nomenclatura real de prefijos usada en toda
 * la base (confirmada con el usuario). Familias por área:
 *   DTF                  → DF, DTF, UVDF (UV DTF), + variantes R.../reposición
 *   Sublimacion           → SB, SUB, + variantes X.../R... (externa/reposición)
 *   ECOUV                 → ECOUV, EUV, + variantes X.../R...
 *   IMPRESION DIRECTA     → DIR, DIRECTA, IMD, + variantes X.../R...
 *   Bordado                → EMB, BOR
 *   Corte                  → TWC, COR
 *   Costura                → COS, TWT
 *   Diseño                 → DIS, TWD
 *   TPU                    → TPU, TP
 *   Estampado               → EST
 *   Productos Confeccionados → PRO
 *   Venta Directa            → VEN (venta de mostrador, no es área de producción)
 * Prefijo 'X...' = orden externa que viaja entre sectores (ver ordenesExternasService.js).
 * Prefijo 'R...' = reposición/rework de esa área.
 * Cualquier prefijo no reconocido (TEST, ORDEN, PRINT, códigos malformados) → 'Sin área'.
 * ────────────────────────────────────────────────────────────────────────────
 */

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Documentos que representan una venta (mismo criterio de matching que cfeController.js:60-64).
const condEsVenta = (alias = 'doc') => `(
    (${alias}.DocTipo LIKE '%Factura%' OR ${alias}.DocTipo LIKE '%FACTURA%' OR ${alias}.DocTipo LIKE '%Ticket%' OR ${alias}.DocTipo LIKE '%TICKET%')
    AND ${alias}.DocTipo NOT LIKE '%Nota%' AND ${alias}.DocTipo NOT LIKE '%NOTA%'
)`;
const COND_ES_VENTA = condEsVenta('doc');

// Área a partir del prefijo de OrdenesDeposito.OrdCodigoOrden (todo antes del primer '-').
// Nomenclatura confirmada con el usuario — ver comentario de cabecera.
const AREA_DESDE_ORDEN = `ISNULL(CASE UPPER(LTRIM(RTRIM(
        LEFT(od.OrdCodigoOrden, CASE WHEN CHARINDEX('-', od.OrdCodigoOrden) > 0 THEN CHARINDEX('-', od.OrdCodigoOrden) - 1 ELSE LEN(od.OrdCodigoOrden) END)
    )))
    WHEN 'DF'     THEN 'DTF' WHEN 'DTF'    THEN 'DTF' WHEN 'UVDF'   THEN 'DTF' WHEN 'RDF'    THEN 'DTF' WHEN 'RUVDF'  THEN 'DTF' WHEN 'RRDF' THEN 'DTF' WHEN 'RRUVDF' THEN 'DTF'
    WHEN 'SB'     THEN 'Sublimacion' WHEN 'SUB' THEN 'Sublimacion' WHEN 'XSB' THEN 'Sublimacion' WHEN 'RSB' THEN 'Sublimacion' WHEN 'RXSB' THEN 'Sublimacion'
    WHEN 'ECOUV'  THEN 'ECOUV' WHEN 'EUV' THEN 'ECOUV' WHEN 'XECOUV' THEN 'ECOUV' WHEN 'RECOUV' THEN 'ECOUV' WHEN 'RXECOUV' THEN 'ECOUV'
    WHEN 'DIR'    THEN 'IMPRESION DIRECTA' WHEN 'DIRECTA' THEN 'IMPRESION DIRECTA' WHEN 'IMD' THEN 'IMPRESION DIRECTA' WHEN 'XIMD' THEN 'IMPRESION DIRECTA' WHEN 'RIMD' THEN 'IMPRESION DIRECTA' WHEN 'RXIMD' THEN 'IMPRESION DIRECTA'
    WHEN 'EMB'    THEN 'Bordado' WHEN 'BOR' THEN 'Bordado'
    WHEN 'TWC'    THEN 'Corte' WHEN 'COR' THEN 'Corte'
    WHEN 'COS'    THEN 'Costura' WHEN 'TWT' THEN 'Costura'
    WHEN 'DIS'    THEN 'Diseño' WHEN 'TWD' THEN 'Diseño'
    WHEN 'TPU'    THEN 'TPU' WHEN 'TP' THEN 'TPU'
    WHEN 'EST'    THEN 'Estampado'
    WHEN 'PRO'    THEN 'Productos Confeccionados'
    WHEN 'VEN'    THEN 'Venta Directa'
    ELSE NULL
END, 'Sin área')`;

// Lista fija de áreas posibles (salida de AREA_DESDE_ORDEN), para poblar el filtro sin
// depender de una tabla — ya no sale de ConfigMapeoERP/Ordenes.AreaID.
const AREAS_CONOCIDAS = [
    'DTF', 'Sublimacion', 'ECOUV', 'IMPRESION DIRECTA', 'Bordado', 'Corte',
    'Costura', 'Diseño', 'TPU', 'Estampado', 'Productos Confeccionados', 'Venta Directa',
];

// Cadena de joins Factura/Ticket → línea de detalle (para el monto) — ya no necesita
// Ordenes/ConfigMapeoERP porque el área sale directo de OrdenesDeposito.OrdCodigoOrden.
const JOIN_VENTA_DETALLE = `
    FROM dbo.DocumentosContables doc WITH(NOLOCK)
    JOIN dbo.DeudaDocumento dd          WITH(NOLOCK) ON dd.DocIdDocumento = doc.DocIdDocumento
    JOIN dbo.OrdenesDeposito od         WITH(NOLOCK) ON od.OrdIdOrden = dd.OrdIdOrden
    JOIN dbo.PedidosCobranza pc         WITH(NOLOCK) ON LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden
    JOIN dbo.PedidosCobranzaDetalle pcd WITH(NOLOCK) ON pcd.PedidoCobranzaID = pc.ID
`;

// Excluye reposiciones sin cargo (mismo guard que contabilidadCore.js:456-460 / 511-515)
const COND_SIN_REPOSICION_GRATIS = `
    NOT (
        od.OrdCodigoOrden LIKE '%-R[0-9]%'
        AND ISNULL(pcd.Subtotal, 0) = 0
        AND ISNULL(od.OrdCostoFinal, 0) = 0
    )
`;

const MONEDA_LINEA = `CASE WHEN od.MonIdMoneda = 2 THEN 'USD'
                            WHEN od.MonIdMoneda = 1 THEN 'UYU'
                            ELSE ISNULL(pc.Moneda, ISNULL(pcd.Moneda, 'UYU')) END`;

// Bindea fecha/área/artículo (comunes a los reportes). La moneda se bindea aparte
// en cada endpoint porque cambia de tipo: texto ('UYU'/'USD') a nivel línea de detalle,
// vs MonIdMoneda numérico a nivel documento.
// fechaDesde/fechaHasta se bindean SIEMPRE (con NULL si no vienen): getIngresos las
// referencia incondicionalmente en el SQL (patrón "@x IS NULL OR ..."), a diferencia
// de ventas-por-area/documento que arman el WHERE condicionalmente en JS.
const bindFiltrosComunes = (r, { fechaDesde, fechaHasta, area, articulo }) => {
    r.input('fechaDesde', sql.DateTime, fechaDesde ? new Date(fechaDesde) : null);
    if (fechaHasta) {
        const d = new Date(fechaHasta);
        d.setHours(23, 59, 59, 999);
        r.input('fechaHasta', sql.DateTime, d);
    } else {
        r.input('fechaHasta', sql.DateTime, null);
    }
    if (area)     r.input('area', sql.NVarChar(150), area);
    if (articulo) r.input('articulo', sql.Int, parseInt(articulo));
};

const extractParams = (q) => ({
    fechaDesde: q.fechaDesde || null,
    fechaHasta: q.fechaHasta || null,
    area:       q.area || null,
    articulo:   q.articulo || null,
    moneda:     q.moneda || null,
});

// ─── GET /api/contabilidad/reportes/ventas-filtros ────────────────────────────
exports.getFiltrosVentas = async (req, res) => {
    try {
        const pool = await getPool();
        const monedas = await pool.request().query(`
            SELECT MonIdMoneda, MonDescripcionMoneda AS nombre, MonSimbolo
            FROM dbo.Monedas WITH(NOLOCK)
            ORDER BY MonIdMoneda
        `);
        res.json({
            success: true,
            areas: AREAS_CONOCIDAS.map(nombre => ({ nombre })),
            monedas: monedas.recordset,
        });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getFiltrosVentas:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── GET /api/contabilidad/reportes/ventas-por-area ───────────────────────────
// Monto = suma de PedidosCobranzaDetalle.Subtotal (nunca DocTotal), para no duplicar
// venta cuando una misma factura tiene líneas de más de un área.
exports.getVentasPorArea = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { fechaDesde, fechaHasta, area, articulo, moneda } = params;

        const conds = [
            COND_ES_VENTA,
            `doc.DocEstado <> 'ANULADO'`,
            COND_SIN_REPOSICION_GRATIS,
        ];
        if (fechaDesde) conds.push('doc.DocFechaEmision >= @fechaDesde');
        if (fechaHasta) conds.push('doc.DocFechaEmision <= @fechaHasta');
        if (area)       conds.push(`${AREA_DESDE_ORDEN} = @area`);
        if (articulo)   conds.push('pcd.ProIdProducto = @articulo');
        if (moneda)     conds.push(`${MONEDA_LINEA} = @moneda`);

        const r = pool.request();
        bindFiltrosComunes(r, params);
        if (moneda) r.input('moneda', sql.NVarChar(10), moneda);

        const result = await r.query(`
            SELECT
                ${AREA_DESDE_ORDEN} AS Area,
                ${MONEDA_LINEA} AS Moneda,
                SUM(pcd.Subtotal) AS Ventas,
                COUNT(DISTINCT doc.DocIdDocumento) AS CantidadDocumentos
            ${JOIN_VENTA_DETALLE}
            WHERE ${conds.join(' AND ')}
            GROUP BY ${AREA_DESDE_ORDEN}, ${MONEDA_LINEA}
            ORDER BY Moneda, Ventas DESC
        `);

        // Porcentaje por moneda calculado acá, no en el frontend
        const porMoneda = {};
        for (const row of result.recordset) {
            if (!porMoneda[row.Moneda]) porMoneda[row.Moneda] = { total: 0, items: [] };
            porMoneda[row.Moneda].total += Number(row.Ventas || 0);
            porMoneda[row.Moneda].items.push(row);
        }
        for (const mon of Object.keys(porMoneda)) {
            const bucket = porMoneda[mon];
            bucket.items = bucket.items.map(it => ({
                area: it.Area,
                ventas: Number(it.Ventas || 0),
                cantidadDocumentos: it.CantidadDocumentos,
                porcentaje: bucket.total > 0 ? Number(((Number(it.Ventas || 0) / bucket.total) * 100).toFixed(2)) : 0,
            }));
        }

        res.json({ success: true, data: result.recordset, porMoneda });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getVentasPorArea:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── GET /api/contabilidad/reportes/ventas-por-documento ──────────────────────
// Unidad de conteo = documento completo (DocTotal). area/articulo filtran vía EXISTS
// (no bajan a nivel línea, para no alterar el importe sumado).
exports.getVentasPorDocumento = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { fechaDesde, fechaHasta, area, articulo, moneda } = params;

        const conds = [
            COND_ES_VENTA,
            `doc.DocEstado <> 'ANULADO'`,
        ];
        if (fechaDesde) conds.push('doc.DocFechaEmision >= @fechaDesde');
        if (fechaHasta) conds.push('doc.DocFechaEmision <= @fechaHasta');
        if (moneda)     conds.push('doc.MonIdMoneda = @moneda');
        if (area || articulo) {
            const existsConds = ['dd.DocIdDocumento = doc.DocIdDocumento'];
            if (area)     existsConds.push(`${AREA_DESDE_ORDEN} = @area`);
            if (articulo) existsConds.push('pcd.ProIdProducto = @articulo');
            conds.push(`EXISTS (
                SELECT 1
                FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                JOIN dbo.OrdenesDeposito od         WITH(NOLOCK) ON od.OrdIdOrden = dd.OrdIdOrden
                JOIN dbo.PedidosCobranza pc         WITH(NOLOCK) ON LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden
                JOIN dbo.PedidosCobranzaDetalle pcd WITH(NOLOCK) ON pcd.PedidoCobranzaID = pc.ID
                WHERE ${existsConds.join(' AND ')}
            )`);
        }

        const r = pool.request();
        bindFiltrosComunes(r, params);
        if (moneda) r.input('moneda', sql.Int, parseInt(moneda)); // acá moneda es MonIdMoneda (numérico), no texto

        const result = await r.query(`
            SELECT
                CASE WHEN doc.CfeEstado = 'ACEPTADO_DGI' THEN 'ENVIADO_DGI' ELSE 'NO_ENVIADO' END AS EstadoDgi,
                doc.MonIdMoneda,
                ISNULL(mon.MonSimbolo, '')          AS MonSimbolo,
                ISNULL(mon.MonDescripcionMoneda, '') AS MonNombre,
                COUNT(*)          AS CantidadDocumentos,
                SUM(doc.DocTotal) AS ImporteTotal
            FROM dbo.DocumentosContables doc WITH(NOLOCK)
            LEFT JOIN dbo.Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = doc.MonIdMoneda
            WHERE ${conds.join(' AND ')}
            GROUP BY CASE WHEN doc.CfeEstado = 'ACEPTADO_DGI' THEN 'ENVIADO_DGI' ELSE 'NO_ENVIADO' END,
                     doc.MonIdMoneda, mon.MonSimbolo, mon.MonDescripcionMoneda
            ORDER BY doc.MonIdMoneda, EstadoDgi
        `);

        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getVentasPorDocumento:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── GET /api/contabilidad/reportes/ingresos ───────────────────────────────────
// Plata efectivamente COBRADA de Factura/Ticket (no lo facturado — dbo.Pagos, no
// DocTotal/DocPagado, que no son fuente confiable de cobro real: ver cfeController.js:904-938).
// Dos caminos de vínculo Pago→Documento (verificados contra la base, no se puede usar
// uno solo: 'contado' cubre ~99% del volumen, 'crédito' cubre lo cobrado después por
// cta-cte):
//   Contado (pago en el momento de la venta): Pagos → TransaccionesCaja → DocumentosContables.TcaIdTransaccion
//   Crédito (venta a cta-cte cobrada después):  MovimientosCuenta (PAGO/COBRO) → Pagos, → DocumentosContables.DocIdDocumento
// Devuelve las DOS bases de fecha en la misma respuesta (fecha de pago = cash real;
// fecha de factura = solo cobros de facturas emitidas en el rango), el frontend elige
// cuál mostrar sin pegarle de nuevo al backend.
exports.getIngresos = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { fechaDesde, fechaHasta, area, articulo, moneda } = params;

        const existsAreaArticulo = (alias) => {
            if (!area && !articulo) return '';
            const existsConds = [`dd.DocIdDocumento = ${alias}.DocIdDocumento`];
            if (area)     existsConds.push(`${AREA_DESDE_ORDEN} = @area`);
            if (articulo) existsConds.push('pcd.ProIdProducto = @articulo');
            return `AND EXISTS (
                SELECT 1
                FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                JOIN dbo.OrdenesDeposito od         WITH(NOLOCK) ON od.OrdIdOrden = dd.OrdIdOrden
                JOIN dbo.PedidosCobranza pc         WITH(NOLOCK) ON LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden
                JOIN dbo.PedidosCobranzaDetalle pcd WITH(NOLOCK) ON pcd.PedidoCobranzaID = pc.ID
                WHERE ${existsConds.join(' AND ')}
            )`;
        };

        const r = pool.request();
        bindFiltrosComunes(r, params);
        // Referenciado incondicionalmente en el SQL (patrón "@moneda IS NULL OR ..."), a
        // diferencia de ventas-por-area/documento — debe bindearse siempre.
        r.input('moneda', sql.Int, moneda ? parseInt(moneda) : null);

        const result = await r.query(`
            ;WITH IngresosContado AS (
                SELECT dc.DocIdDocumento, dc.DocFechaEmision, p.PagFechaPago, p.PagIdMonedaPago AS MonIdMoneda, p.PagMontoPago AS Importe
                FROM dbo.Pagos p WITH(NOLOCK)
                JOIN dbo.TransaccionesCaja t WITH(NOLOCK) ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
                JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.TcaIdTransaccion = t.TcaIdTransaccion
                WHERE p.PagTipoMovimiento <> 'ANULADO'
                  AND ${condEsVenta('dc')}
                  AND dc.DocEstado <> 'ANULADO'
                  AND (@moneda IS NULL OR p.PagIdMonedaPago = @moneda)
                  ${existsAreaArticulo('dc')}
            ),
            IngresosCredito AS (
                SELECT dc.DocIdDocumento, dc.DocFechaEmision, p.PagFechaPago, p.PagIdMonedaPago AS MonIdMoneda, p.PagMontoPago AS Importe
                FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagIdPago = m.PagIdPago
                JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento
                WHERE m.MovTipo IN ('PAGO','COBRO')
                  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND p.PagTipoMovimiento <> 'ANULADO'
                  AND ${condEsVenta('dc')}
                  AND dc.DocEstado <> 'ANULADO'
                  AND (@moneda IS NULL OR p.PagIdMonedaPago = @moneda)
                  ${existsAreaArticulo('dc')}
            ),
            IngresosTodos AS (
                SELECT * FROM IngresosContado
                UNION ALL
                SELECT * FROM IngresosCredito
            )
            SELECT 'PAGO' AS Base, MonIdMoneda, SUM(Importe) AS ImporteCobrado, COUNT(DISTINCT DocIdDocumento) AS CantidadFacturas
            FROM IngresosTodos
            WHERE (@fechaDesde IS NULL OR PagFechaPago >= @fechaDesde)
              AND (@fechaHasta IS NULL OR PagFechaPago <= @fechaHasta)
            GROUP BY MonIdMoneda
            UNION ALL
            SELECT 'FACTURA' AS Base, MonIdMoneda, SUM(Importe) AS ImporteCobrado, COUNT(DISTINCT DocIdDocumento) AS CantidadFacturas
            FROM IngresosTodos
            WHERE (@fechaDesde IS NULL OR DocFechaEmision >= @fechaDesde)
              AND (@fechaHasta IS NULL OR DocFechaEmision <= @fechaHasta)
            GROUP BY MonIdMoneda
        `);

        const porFechaPago = result.recordset.filter(r => r.Base === 'PAGO');
        const porFechaFactura = result.recordset.filter(r => r.Base === 'FACTURA');
        res.json({ success: true, porFechaPago, porFechaFactura });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getIngresos:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
