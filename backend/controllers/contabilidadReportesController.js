'use strict';

/**
 * contabilidadReportesController.js
 * ────────────────────────────────────────────────────────────────────────────
 * Reportes de Contabilidad: ventas por área, ventas por documento (DGI), ingresos.
 *
 * DocTipo real en DocumentosContables (verificado contra la base, no es 'FACTURA'
 * literal): 'E-Factura Contado', 'E-Factura Credito', 'E-Ticket Contado',
 * 'E-TICKET CREDITO', notas de crédito/débito, 'Pedidos Caja', 'Recibo',
 * 'RECIBO ANTICIPO', 'EGRESO_CAJA'. "Venta" acá = Factura/Ticket (sin Notas) +
 * 'Pedidos Caja' (venta de caja aún sin resolver a un CFE formal — la mayoría ya
 * cobrada, decisión explícita del usuario: si no se cuenta, el reporte subestima
 * fuerte la venta real, sobre todo en USD donde Pedidos Caja BORRADOR es ~3x más
 * grande que todo lo facturado). Recibo/RECIBO ANTICIPO/EGRESO_CAJA y anuladas
 * (DocEstado='ANULADO') siguen afuera de los tres reportes. Al no tener nunca
 * CfeEstado='ACEPTADO_DGI', Pedidos Caja cae siempre en "No enviado a DGI" en el
 * reporte de documentos — correcto, todavía no se envió.
 *
 * ── Cómo se resuelve la ORDEN/ÁREA detrás de un documento ───────────────────────
 * Fuente única: dbo.DocumentosContablesDetalle.OrdCodigoOrden — la "verdad" de
 * facturación (decisión del usuario, 2026-07-21): es la tabla real de líneas de
 * cada documento (Contado, Crédito y Pedidos Caja por igual), y el monto de cada
 * línea (DcdSubtotal) es el que corresponde sumar por área.
 *
 * Antes se reconstruía la orden por dos caminos separados (TransaccionDetalle para
 * Contado, MovimientosCuenta para Crédito por ciclo) porque OrdCodigoOrden estaba
 * vacío en buena parte de las líneas — pero investigando por qué, se confirmó que
 * en el 95.9% de esos casos el código de orden SÍ está, como texto libre dentro de
 * DcdDscItem (ej. 'Orden: DTF-4761 (javier)...' o 'DF-102059 - LOBAS'), porque
 * varios puntos de inserción (cierre de ciclo en contabilidadService.js:2553-2578,
 * edición de factura en cfeController.js:1017-1032) nunca completan la columna
 * estructurada. Ver backend/scripts/backfill_ordcodigoorden_detalle.js — parsea
 * ese texto y completa la columna (dry-run por defecto, --apply para ejecutar).
 * Con eso corrido, la cobertura de OrdCodigoOrden sube a ~96%+; sin correrlo, las
 * líneas que quedan sin código cavan directo a "Sin área" (no rompen nada).
 *
 * El área en sí sale del PREFIJO del código de orden (ej. 'DF-102047', 'XSB-45248'),
 * matcheado contra la nomenclatura real de prefijos usada en toda la base (confirmada
 * con el usuario). Familias por área:
 *   DTF                      → DF, DTF, UVDF (UV DTF), + variantes R.../reposición
 *   Sublimacion              → SB, SUB, + variantes X.../R... (externa/reposición)
 *   ECOUV                    → ECOUV, EUV, + variantes X.../R...
 *   IMPRESION DIRECTA        → DIR, DIRECTA, IMD, + variantes X.../R...
 *   Bordado                  → EMB, BOR
 *   Corte                    → TWC, COR
 *   Costura                  → COS, TWT
 *   Diseño                   → DIS, TWD
 *   TPU                      → TPU, TP
 *   Estampado                → EST
 *   Productos Confeccionados → PRO
 *   Venta Directa            → VEN (venta de mostrador, no es área de producción)
 * Prefijo 'X...' = orden externa que viaja entre sectores (ver ordenesExternasService.js).
 * Prefijo 'R...' = reposición/rework de esa área.
 * Cualquier prefijo no reconocido (TEST, ORDEN, PRINT, códigos malformados) → 'Sin área'.
 *
 * Nota sobre ARTÍCULO: DocumentosContablesDetalle no tiene ProIdProducto — el filtro
 * de artículo matchea igual que antes vía PedidosCobranza/PedidosCobranzaDetalle
 * (join por texto de código de orden), así que su cobertura es la de esa tabla, no
 * la de DocumentosContablesDetalle.
 *
 * ── Por qué "Ventas por Área" y "Ventas por Documento" tienen que dar el mismo total ──
 * (decisión del usuario, 2026-07-23: son la misma plata vista de dos formas, tienen
 * que cerrar exacto). La primera versión sumaba DcdSubtotal (línea) directo, que NO
 * necesariamente suma lo mismo que DocTotal (cabecera) — IVA, descuentos generales,
 * líneas duplicadas por ediciones, etc. hacen que la suma de líneas se desvíe del
 * total real del documento (verificado: en USD llegaba a estar 77% por ENCIMA del
 * total facturado real).
 *
 * Ahora cada documento reparte su propio DocTotal (no DcdSubtotal) entre las áreas
 * que tocó, PROPORCIONALMENTE al peso de DcdSubtotal de cada área dentro de ese
 * documento. Si un documento no tiene ningún Subtotal para pesar (todo en 0), se
 * reparte por partes iguales entre las áreas que aparecen. Como los pesos de cada
 * documento siempre suman 1, la suma total de todas las áreas es matemáticamente
 * idéntica a la suma de DocTotal de "Ventas por Documento" — no es una casualidad
 * de los datos, está garantizado por construcción.
 * ────────────────────────────────────────────────────────────────────────────
 */

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Documentos que representan una venta: Factura/Ticket (mismo criterio de matching que
// cfeController.js:60-64, sin Notas) + Pedidos Caja (venta de caja sin resolver a CFE
// todavía — ver nota de cabecera). Recibo/RECIBO ANTICIPO/EGRESO_CAJA quedan afuera al
// no matchear ninguna de las dos condiciones.
const condEsVenta = (alias = 'doc') => `(
    (
        (${alias}.DocTipo LIKE '%Factura%' OR ${alias}.DocTipo LIKE '%FACTURA%' OR ${alias}.DocTipo LIKE '%Ticket%' OR ${alias}.DocTipo LIKE '%TICKET%')
        AND ${alias}.DocTipo NOT LIKE '%Nota%' AND ${alias}.DocTipo NOT LIKE '%NOTA%'
    )
    OR RTRIM(${alias}.DocTipo) = 'Pedidos Caja'
)`;
const COND_ES_VENTA = condEsVenta('doc');

// Área a partir del prefijo de un código de orden (ej. 'dcd.OrdCodigoOrden'). Si el
// código es NULL (línea sin código todavía), el CASE/ISNULL de abajo cae solo a
// 'Sin área' — no hace falta filtrarlo aparte. Nomenclatura confirmada con el usuario.
const areaDesdeCodigo = (expr) => `ISNULL(CASE UPPER(LTRIM(RTRIM(
        LEFT(${expr}, CASE WHEN CHARINDEX('-', ${expr}) > 0 THEN CHARINDEX('-', ${expr}) - 1 ELSE LEN(${expr}) END)
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

// Lista fija de áreas posibles (salida de areaDesdeCodigo), para poblar el filtro sin
// depender de una tabla.
const AREAS_CONOCIDAS = [
    'DTF', 'Sublimacion', 'ECOUV', 'IMPRESION DIRECTA', 'Bordado', 'Corte',
    'Costura', 'Diseño', 'TPU', 'Estampado', 'Productos Confeccionados', 'Venta Directa',
];

// Filtro de artículo: DocumentosContablesDetalle no tiene ProIdProducto, así que se
// matchea vía PedidosCobranza/PedidosCobranzaDetalle (mismo join por texto de código
// de orden que ya se usaba). codigoExpr = expresión SQL con el código de orden (ej. 'dcd.OrdCodigoOrden').
const condArticulo = (codigoExpr) => `EXISTS (
    SELECT 1
    FROM dbo.PedidosCobranza pcA WITH(NOLOCK)
    JOIN dbo.PedidosCobranzaDetalle pcdA WITH(NOLOCK) ON pcdA.PedidoCobranzaID = pcA.ID
    WHERE CAST(pcA.NoDocERP AS VARCHAR(100)) =
        LEFT(${codigoExpr}, CASE WHEN CHARINDEX(' ', ${codigoExpr}) > 0 THEN CHARINDEX(' ', ${codigoExpr}) - 1 ELSE LEN(${codigoExpr}) END)
      AND pcdA.ProIdProducto = @articulo
)`;

// Filtro de área/artículo precalculado UNA sola vez como CTE (set de DocIdDocumento que
// matchean), para usar con IN en vez de repetir el filtro por cada consulta.
const filtroAreaArticulo = (area, articulo, alias) => {
    if (!area && !articulo) return { cte: '', cond: '' };
    const conds = [condEsVenta('fdoc'), `fdoc.DocEstado <> 'ANULADO'`];
    if (area)     conds.push(`${areaDesdeCodigo('dcd.OrdCodigoOrden')} = @area`);
    if (articulo) conds.push(condArticulo('dcd.OrdCodigoOrden'));
    const cte = `FiltroAreaArticulo AS (
        SELECT DISTINCT dcd.DocIdDocumento
        FROM dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
        JOIN dbo.DocumentosContables fdoc WITH(NOLOCK) ON fdoc.DocIdDocumento = dcd.DocIdDocumento
        WHERE ${conds.join(' AND ')}
    )`;
    return { cte, cond: `${alias}.DocIdDocumento IN (SELECT DocIdDocumento FROM FiltroAreaArticulo)` };
};

// Bindea fecha/área/artículo (comunes a los reportes) — SIEMPRE (con NULL si no vienen),
// porque las queries las referencian incondicionalmente (patrón "@x IS NULL OR ...").
// La moneda se bindea aparte en cada endpoint porque cambia de tipo: texto ('UYU'/'USD')
// a nivel línea de detalle, vs MonIdMoneda numérico a nivel documento.
const bindFiltrosComunes = (r, { fechaDesde, fechaHasta, area, articulo }) => {
    r.input('fechaDesde', sql.DateTime, fechaDesde ? new Date(fechaDesde) : null);
    if (fechaHasta) {
        const d = new Date(fechaHasta);
        d.setHours(23, 59, 59, 999);
        r.input('fechaHasta', sql.DateTime, d);
    } else {
        r.input('fechaHasta', sql.DateTime, null);
    }
    r.input('area', sql.NVarChar(150), area || null);
    r.input('articulo', sql.Int, articulo ? parseInt(articulo) : null);
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
// Cada documento reparte su propio DocTotal (no DcdSubtotal) entre las áreas que
// tocó, proporcional al peso de DcdSubtotal de cada área dentro de ese documento
// (ver nota de cabecera "Por qué tienen que dar el mismo total"). Esto además
// corrige un bug real: esta query no aplicaba fechaDesde/fechaHasta (a diferencia
// de ventas-por-documento, que sí) — "30 días" mostraba histórico completo acá,
// lo que por sí solo ya explicaba buena parte del desfasaje entre los dos reportes.
exports.getVentasPorArea = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { moneda } = params;

        const areaExpr   = areaDesdeCodigo('dcd.OrdCodigoOrden');
        const monedaExpr = `CASE WHEN l.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END`;

        const r = pool.request();
        bindFiltrosComunes(r, params);
        r.input('moneda', sql.NVarChar(10), moneda || null);

        const result = await r.query(`
            ;WITH DocsVenta AS (
                SELECT fdoc.DocIdDocumento, fdoc.DocTotal, fdoc.MonIdMoneda
                FROM dbo.DocumentosContables fdoc WITH(NOLOCK)
                WHERE ${condEsVenta('fdoc')}
                  AND fdoc.DocEstado <> 'ANULADO'
                  AND (@fechaDesde IS NULL OR fdoc.DocFechaEmision >= @fechaDesde)
                  AND (@fechaHasta IS NULL OR fdoc.DocFechaEmision <= @fechaHasta)
                  AND (@articulo IS NULL OR EXISTS (
                        SELECT 1 FROM dbo.DocumentosContablesDetalle dcdA WITH(NOLOCK)
                        WHERE dcdA.DocIdDocumento = fdoc.DocIdDocumento
                          AND ${condArticulo('dcdA.OrdCodigoOrden')}
                  ))
            ),
            LineasPorDocArea AS (
                SELECT dv.DocIdDocumento, dv.DocTotal, dv.MonIdMoneda,
                       ${areaExpr} AS Area,
                       SUM(dcd.DcdSubtotal) AS SubtotalArea
                FROM DocsVenta dv
                LEFT JOIN dbo.DocumentosContablesDetalle dcd WITH(NOLOCK) ON dcd.DocIdDocumento = dv.DocIdDocumento
                GROUP BY dv.DocIdDocumento, dv.DocTotal, dv.MonIdMoneda, ${areaExpr}
            ),
            TotalPorDoc AS (
                SELECT DocIdDocumento, SUM(SubtotalArea) AS SubtotalDocTotal, COUNT(*) AS NAreas
                FROM LineasPorDocArea
                GROUP BY DocIdDocumento
            )
            SELECT
                l.Area,
                ${monedaExpr} AS Moneda,
                SUM(l.DocTotal * CASE
                    WHEN ISNULL(t.SubtotalDocTotal, 0) = 0 THEN 1.0 / t.NAreas
                    ELSE CAST(l.SubtotalArea AS FLOAT) / t.SubtotalDocTotal
                END) AS Ventas,
                COUNT(DISTINCT l.DocIdDocumento) AS CantidadDocumentos
            FROM LineasPorDocArea l
            JOIN TotalPorDoc t ON t.DocIdDocumento = l.DocIdDocumento
            WHERE (@area IS NULL OR l.Area = @area)
              AND (@moneda IS NULL OR ${monedaExpr} = @moneda)
            GROUP BY l.Area, ${monedaExpr}
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
// Unidad de conteo = documento completo (DocTotal). area/articulo filtran vía un CTE
// precalculado (no bajan a nivel línea, para no alterar el importe sumado).
exports.getVentasPorDocumento = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { fechaDesde, fechaHasta, area, articulo, moneda } = params;

        const filtro = filtroAreaArticulo(area, articulo, 'doc');

        const conds = [
            COND_ES_VENTA,
            `doc.DocEstado <> 'ANULADO'`,
        ];
        if (fechaDesde)  conds.push('doc.DocFechaEmision >= @fechaDesde');
        if (fechaHasta)  conds.push('doc.DocFechaEmision <= @fechaHasta');
        if (moneda)      conds.push('doc.MonIdMoneda = @moneda');
        if (filtro.cond) conds.push(filtro.cond);

        const r = pool.request();
        bindFiltrosComunes(r, params);
        if (moneda) r.input('moneda', sql.Int, parseInt(moneda)); // acá moneda es MonIdMoneda (numérico), no texto

        const result = await r.query(`
            ${filtro.cte ? `;WITH ${filtro.cte}` : ''}
            SELECT
                CASE WHEN doc.CfeEstado = 'ACEPTADO_DGI' THEN 'ENVIADO_DGI' ELSE 'NO_ENVIADO' END AS EstadoDgi,
                CASE WHEN doc.DocTipo LIKE '%Credito%' OR doc.DocTipo LIKE '%CREDITO%' THEN 'CREDITO' ELSE 'CONTADO' END AS TipoPago,
                doc.MonIdMoneda,
                ISNULL(mon.MonSimbolo, '')          AS MonSimbolo,
                ISNULL(mon.MonDescripcionMoneda, '') AS MonNombre,
                COUNT(*)          AS CantidadDocumentos,
                SUM(doc.DocTotal) AS ImporteTotal,
                -- Pendiente solo para Crédito: en Contado, DeudaDocumento aparece asociado a
                -- documentos con DocPagado=true y montos que no coinciden con DocTotal (dato
                -- sucio verificado, no representa deuda real de esa venta) — mismo criterio
                -- que "de eso, a crédito" en el frontend, para que ambos números coincidan.
                SUM(CASE WHEN doc.DocTipo LIKE '%Credito%' OR doc.DocTipo LIKE '%CREDITO%' THEN ISNULL(dd.Pendiente, 0) ELSE 0 END) AS ImportePendiente
            FROM dbo.DocumentosContables doc WITH(NOLOCK)
            LEFT JOIN dbo.Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = doc.MonIdMoneda
            -- Pre-agregado 1 fila por documento (puede haber >1 fila en DeudaDocumento
            -- para el mismo doc) para no duplicar CantidadDocumentos/ImporteTotal al hacer LEFT JOIN.
            LEFT JOIN (
                SELECT DocIdDocumento, SUM(DDeImportePendiente) AS Pendiente
                FROM dbo.DeudaDocumento WITH(NOLOCK)
                GROUP BY DocIdDocumento
            ) dd ON dd.DocIdDocumento = doc.DocIdDocumento
            WHERE ${conds.join(' AND ')}
            GROUP BY CASE WHEN doc.CfeEstado = 'ACEPTADO_DGI' THEN 'ENVIADO_DGI' ELSE 'NO_ENVIADO' END,
                     CASE WHEN doc.DocTipo LIKE '%Credito%' OR doc.DocTipo LIKE '%CREDITO%' THEN 'CREDITO' ELSE 'CONTADO' END,
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
// Plata efectivamente COBRADA (no lo facturado — dbo.Pagos, no DocTotal/DocPagado,
// que no son fuente confiable de cobro real: ver cfeController.js:904-938).
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
        const { area, articulo, moneda } = params;

        const filtro = filtroAreaArticulo(area, articulo, 'dc');

        const r = pool.request();
        bindFiltrosComunes(r, params);
        // Referenciado incondicionalmente en el SQL (patrón "@moneda IS NULL OR ..."), a
        // diferencia de ventas-por-area/documento — debe bindearse siempre.
        r.input('moneda', sql.Int, moneda ? parseInt(moneda) : null);

        const result = await r.query(`
            ;WITH ${filtro.cte ? `${filtro.cte},` : ''}
            IngresosContado AS (
                SELECT dc.DocIdDocumento, dc.DocFechaEmision, p.PagFechaPago, p.PagIdMonedaPago AS MonIdMoneda, p.PagMontoPago AS Importe
                FROM dbo.Pagos p WITH(NOLOCK)
                JOIN dbo.TransaccionesCaja t WITH(NOLOCK) ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
                JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.TcaIdTransaccion = t.TcaIdTransaccion
                WHERE p.PagTipoMovimiento <> 'ANULADO'
                  AND ${condEsVenta('dc')}
                  AND dc.DocEstado <> 'ANULADO'
                  AND (@moneda IS NULL OR p.PagIdMonedaPago = @moneda)
                  ${filtro.cond ? `AND ${filtro.cond}` : ''}
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
                  ${filtro.cond ? `AND ${filtro.cond}` : ''}
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

        const porFechaPago = result.recordset.filter(row => row.Base === 'PAGO');
        const porFechaFactura = result.recordset.filter(row => row.Base === 'FACTURA');
        res.json({ success: true, porFechaPago, porFechaFactura });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getIngresos:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
