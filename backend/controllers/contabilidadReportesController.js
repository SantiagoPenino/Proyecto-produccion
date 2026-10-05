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
 * 'Pedidos Caja'; desde el 1-oct-2026 las notas de crédito entran además como una
 * venta negativa (ver "Las notas de crédito RESTAN" más abajo). Pedidos Caja es la
 * venta de caja aún sin resolver a un CFE formal (la mayoría ya
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

// ── Las notas de crédito RESTAN en todos los reportes de ventas (decisión del usuario,
// 1-oct-2026: "las notas de crédito se deben de restar"). Antes solo las restaba Top
// Clientes; Ventas por Área, Ventas por Documento, Resumen Mensual, Top Productos y el
// Árbol las dejaban afuera, así que una factura anulada con nota de crédito seguía
// contando entera (set-2026: 12 facturas, US$ 2.444 unificados).
// La nota entra como una venta NEGATIVA (la de débito, positiva) en la fecha en que se
// emite, con su propio estado de DGI, y se reparte entre las áreas y artículos de SUS
// líneas, que se copian de la factura (verificado: 33 de 38 notas tienen las mismas
// áreas que su factura). Las cantidades de documentos siguen contando solo ventas.
// Recibos, anticipos y egresos siguen afuera. Cobros e ingresos no cambian.
const condEsNota = (alias = 'doc') => `(${alias}.DocTipo LIKE '%Nota%' OR ${alias}.DocTipo LIKE '%NOTA%')`;
const condVentaONota = (alias = 'doc') => `(${condEsVenta(alias)} OR ${condEsNota(alias)})`;
const signoExpr = (alias = 'doc') => `CASE
    WHEN ${alias}.CfeTipoCFE IN (103, 113) THEN 1
    WHEN ${alias}.CfeTipoCFE IN (102, 112) THEN -1
    WHEN ${condEsNota(alias)} THEN -1
    ELSE 1 END`;

// Área a partir del prefijo de un código de orden (ej. 'dcd.OrdCodigoOrden'). Si el
// código es NULL (línea sin código todavía) o el prefijo no matchea, se intenta un
// segundo fallback por dcd.DcdNomItem (nombre del ítem vendido, ej. líneas de insumo
// sin orden asociada) antes de caer a 'Sin área'. Todo llamador usa alias 'dcd' para
// DocumentosContablesDetalle, así que dcd.DcdNomItem siempre está disponible acá.
// Nomenclatura confirmada con el usuario.
// ─────────────────────────────────────────────────────────────────────────────
// El área de una línea sale de la columna DcdArea, que se estampa al crear la
// línea (SP_EstamparAreaLineasDocumento: orden → artículo → prefijo). El parseo
// del prefijo queda como FALLBACK para: (a) instalaciones donde todavía no se
// corrió add_DcdArea.sql, y (b) líneas que por lo que sea quedaron sin estampar.
// Cobertura medida tras el backfill: 99,85% de las líneas de venta (antes 94,5%).
// ─────────────────────────────────────────────────────────────────────────────
let _tieneDcdArea = null;
const tieneDcdArea = async () => {
    if (_tieneDcdArea !== null) return _tieneDcdArea;
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='DocumentosContablesDetalle' AND COLUMN_NAME='DcdArea'`);
        _tieneDcdArea = Number(r.recordset[0]?.N || 0) > 0;
        if (!_tieneDcdArea) logger.warn('[CONTABILIDAD-REPORTES] DcdArea no existe: los reportes usan el parseo del prefijo (correr add_DcdArea.sql).');
    } catch { _tieneDcdArea = false; }
    return _tieneDcdArea;
};

// Área deducida del PREFIJO de un texto con forma de código de orden ('DTF-23538', 'EUV-22215 LAURA…').
const casePrefijo = (e) => `CASE UPPER(LTRIM(RTRIM(
        LEFT(${e}, CASE WHEN CHARINDEX('-', ${e}) > 0 THEN CHARINDEX('-', ${e}) - 1 ELSE LEN(${e}) END)
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
END`;

// Orden de búsqueda: 1) prefijo del código de orden de la línea; 2) prefijo del CONCEPTO cuando
// el facturador escribió el código ahí y dejó OrdCodigoOrden vacío (prod, sep-2026: 'DTF-23538',
// 'EUV-25118', 'SUB-27365'… — solo si el concepto tiene un guion cerca del principio, para no
// confundir un nombre cualquiera con un código); 3) conceptos conocidos por nombre; 4) 'Sin área'.
const areaParseada = (expr) => `ISNULL(COALESCE(${casePrefijo(expr)},
CASE WHEN CHARINDEX('-', LTRIM(dcd.DcdNomItem)) BETWEEN 3 AND 8 THEN ${casePrefijo('LTRIM(dcd.DcdNomItem)')} END,
CASE WHEN UPPER(LTRIM(RTRIM(dcd.DcdNomItem))) = 'DTF TEXTIL COMUN' THEN 'DTF'
     -- Plata cobrada por adelantado (pedido del usuario 05-oct-2026): la carga de saldo de
     -- la billetera y los beneficios prepagos se facturan con el concepto "Crédito prepago
     -- de servicios — …" (webOrdersController / ContabilidadCuentasView), y a mano como
     -- "Saldo anticipado". No son de ningún área productiva: van a 'Adelanto de Saldo'.
     WHEN LTRIM(dcd.DcdNomItem) LIKE 'Cr_dito prepago de servicios%' THEN 'Adelanto de Saldo'
     WHEN UPPER(LTRIM(RTRIM(dcd.DcdNomItem))) = 'SALDO ANTICIPADO' THEN 'Adelanto de Saldo'
END
), 'Sin área')`;

/**
 * Área de una línea. `expr` es la columna del código de orden con su alias
 * (ej. 'dcd.OrdCodigoOrden'); de ahí se deduce el alias para leer DcdArea.
 * Requiere que el handler haya hecho `await tieneDcdArea()` antes.
 */
const areaDesdeCodigo = (expr) => {
    const alias = String(expr).split('.')[0];
    return _tieneDcdArea
        ? `ISNULL(NULLIF(LTRIM(RTRIM(${alias}.DcdArea)), ''), ${areaParseada(expr)})`
        : areaParseada(expr);
};

// Lista fija de áreas posibles (salida de areaDesdeCodigo), para poblar el filtro sin
// depender de una tabla.
const AREAS_CONOCIDAS = [
    'DTF', 'Sublimacion', 'ECOUV', 'IMPRESION DIRECTA', 'Bordado', 'Corte',
    'Costura', 'Diseño', 'TPU', 'Estampado', 'Productos Confeccionados', 'Venta Directa',
    'Adelanto de Saldo', // no es un área productiva: cargas de saldo / prepagos facturados
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
// Líneas de detalle que son del artículo filtrado (@articulo), contemplando las notas:
// sus líneas casi nunca traen el código de orden (se copian de la factura sin él), pero
// sí el artículo (DcdProIdProducto). Sin esto, con filtro de artículo las notas no restarían.
// Va como CTE con UNION y NO como un OR en el WHERE: `EXISTS(...) OR (...)` le saca el
// semi-join al optimizador y la consulta pasa de 30 ms a más de 120 s (medido 1-oct-2026).
const cteLineasArticulo = () => `LineasArticulo AS (
            SELECT dcd.DcdIdDetalle
            FROM dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
            WHERE ${condArticulo('dcd.OrdCodigoOrden')}
            UNION
            SELECT dcd.DcdIdDetalle
            FROM dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
            JOIN dbo.DocumentosContables ndoc WITH(NOLOCK) ON ndoc.DocIdDocumento = dcd.DocIdDocumento
            WHERE ${condEsNota('ndoc')} AND dcd.DcdProIdProducto = @articulo
        )`;
const condLineaDelArticulo = (aliasDet) => `${aliasDet}.DcdIdDetalle IN (SELECT la.DcdIdDetalle FROM LineasArticulo la)`;

// Filtro de área/artículo precalculado UNA sola vez como CTE: los DocIdDocumento que
// matchean y el PESO del área dentro de cada documento (0..1), para que el reporte por
// documento y los ingresos tomen SOLO la parte del documento que es del área/sector,
// con el mismo reparto que ventas-por-area (proporción de DcdSubtotal por área; si el
// documento no tiene subtotales, partes iguales entre sus áreas). Sin filtro de área
// (solo artículo) el peso es 1 = documento entero, como antes.
// Decisión del usuario (23-sep-2026): "cada línea tiene su área y ese es el importe
// que debe tomarse" — antes, con filtro de sector, un ticket con TPU + Sublimación
// contaba entero como TPU y el reporte por documento no cuadraba con el de área.
// condAreas: condición ya armada por condAreasIn (área puntual o áreas de un sector).
const filtroAreaArticulo = (condAreas, articulo, alias) => {
    if (!condAreas && !articulo) return { cte: '', join: '', peso: '1.0' };
    // Ventas y notas: la nota pesa por el área de sus propias líneas, igual que la factura.
    const conds = [condVentaONota('fdoc'), `fdoc.DocEstado <> 'ANULADO'`];
    if (articulo) conds.push(condLineaDelArticulo('dcd'));
    let cte;
    if (condAreas) {
        const areaExpr = areaDesdeCodigo('dcd.OrdCodigoOrden');
        cte = `FiltroAreaArticulo AS (
            SELECT x.DocIdDocumento,
                   CASE WHEN ISNULL(x.SubTot, 0) = 0 THEN CAST(x.NAreasFiltro AS FLOAT) / x.NAreas
                        ELSE CAST(x.SubArea AS FLOAT) / x.SubTot END AS Peso
            FROM (
                SELECT dcd.DocIdDocumento,
                       SUM(CASE WHEN ${condAreas} THEN ISNULL(dcd.DcdSubtotal, 0) ELSE 0 END) AS SubArea,
                       SUM(ISNULL(dcd.DcdSubtotal, 0)) AS SubTot,
                       COUNT(DISTINCT CASE WHEN ${condAreas} THEN ${areaExpr} END) AS NAreasFiltro,
                       COUNT(DISTINCT ${areaExpr}) AS NAreas
                FROM dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
                JOIN dbo.DocumentosContables fdoc WITH(NOLOCK) ON fdoc.DocIdDocumento = dcd.DocIdDocumento
                WHERE ${conds.join(' AND ')}
                GROUP BY dcd.DocIdDocumento
            ) x
            WHERE x.NAreasFiltro > 0
        )`;
    } else {
        cte = `FiltroAreaArticulo AS (
            SELECT DISTINCT dcd.DocIdDocumento, CAST(1.0 AS FLOAT) AS Peso
            FROM dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
            JOIN dbo.DocumentosContables fdoc WITH(NOLOCK) ON fdoc.DocIdDocumento = dcd.DocIdDocumento
            WHERE ${conds.join(' AND ')}
        )`;
    }
    // Con filtro de artículo, la CTE de sus líneas va delante (FiltroAreaArticulo la usa).
    if (articulo) cte = `${cteLineasArticulo()},\n        ${cte}`;
    return {
        cte,
        join: `JOIN FiltroAreaArticulo faa ON faa.DocIdDocumento = ${alias}.DocIdDocumento`,
        peso: 'faa.Peso',
    };
};

// Bindea fecha/área/artículo (comunes a los reportes) — SIEMPRE (con NULL si no vienen),
// porque las queries las referencian incondicionalmente (patrón "@x IS NULL OR ...").
// La moneda se bindea aparte en cada endpoint porque cambia de tipo: texto ('UYU'/'USD')
// a nivel línea de detalle, vs MonIdMoneda numérico a nivel documento.
// Las fechas llegan como 'YYYY-MM-DD' y se mandan a SQL como TEXTO ISO ('...T00:00:00' /
// '...T23:59:59.997'), no como Date. Antes se hacía new Date('2026-08-31') (= medianoche
// UTC) + setHours(23,59,59) en hora LOCAL del proceso: con Node en Uruguay (UTC-3) el
// "hasta" quedaba en 2026-08-31 02:59:59 y el último día del rango perdía todo lo emitido
// después de las 3 de la mañana (detectado 23-sep-2026: 30 días ≠ septiembre + 24-31/08).
// Con texto el corte es el día calendario, sin depender del reloj del proceso.
const soloFecha = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const bindFiltrosComunes = (r, { fechaDesde, fechaHasta, area, articulo }) => {
    const d = soloFecha(fechaDesde), h = soloFecha(fechaHasta);
    r.input('fechaDesde', sql.VarChar(30), d ? `${d}T00:00:00` : null);
    r.input('fechaHasta', sql.VarChar(30), h ? `${h}T23:59:59.997` : null);
    r.input('area', sql.NVarChar(150), area || null);
    r.input('articulo', sql.Int, articulo ? parseInt(articulo) : null);
};

const extractParams = (q) => ({
    fechaDesde: q.fechaDesde || null,
    fechaHasta: q.fechaHasta || null,
    area:       q.area || null,
    articulo:   q.articulo || null,
    moneda:     q.moneda || null,
    sector:     q.sector || null,
    dgi:        q.dgi || null, // 'DGI' | 'SIN_DGI' | null/'TODO' (sin filtro)
});

// Filtro por estado DGI del documento (switch SIN DGI / TODO / DGI de la pantalla).
// 'DGI' = solo CFE aceptados por DGI; 'SIN_DGI' = todo lo que no lo está (incluye
// Pedidos Caja, que nunca se envían); cualquier otro valor = sin filtro (TODO).
const condDgi = (alias, dgi) => {
    if (dgi === 'DGI')     return `${alias}.CfeEstado = 'ACEPTADO_DGI'`;
    if (dgi === 'SIN_DGI') return `(${alias}.CfeEstado IS NULL OR ${alias}.CfeEstado <> 'ACEPTADO_DGI')`;
    return '';
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTORES COMERCIALES (dbo.Sectores + dbo.SectorMapeo)
//
// El negocio no mira las ventas por área productiva sino por SECTOR comercial,
// y no son lo mismo: CENCO = Corte + Costura, EMBLEMAS = Bordado + Estampado.
// El área es el hecho (dónde se produjo); el sector es una agrupación que la
// administración puede cambiar. Por eso el sector NO se guarda en cada línea:
// se deriva del área con este mapeo, así un cambio de estructura comercial
// reagrupa todo el histórico y las series siguen siendo comparables.
//
// Las áreas sin mapear (hoy 'Diseño' y 'Sin área') caen a SIN_SECTOR a
// propósito: quedan visibles en los reportes en vez de esconderse dentro de un
// sector equivocado.
// ─────────────────────────────────────────────────────────────────────────────
const SIN_SECTOR = { id: 'SIN_SECTOR', nombre: 'Sin sector asignado', orden: 9999 };

let _cacheSectores = { data: null, ts: 0 };
const CACHE_SECTORES_MS = 60000;

/** Devuelve { sectores: [{id,nombre,orden}], areaASector: {area: secId}, areasPorSector: {secId: [areas]} } */
const getMapeoSectores = async () => {
    if (_cacheSectores.data && Date.now() - _cacheSectores.ts < CACHE_SECTORES_MS) return _cacheSectores.data;
    const pool = await getPool();
    let sectores = [], mapeo = [];
    try {
        const rs = await pool.request().query(`
            SELECT SecId, SecNombre, SecOrden FROM dbo.Sectores WITH(NOLOCK)
            WHERE SecActivo = 1 ORDER BY SecOrden, SecNombre`);
        sectores = rs.recordset.map(x => ({ id: x.SecId, nombre: x.SecNombre, orden: x.SecOrden }));
        const rm = await pool.request().query(`
            SELECT SmaTipo, SmaClave, SecId FROM dbo.SectorMapeo WITH(NOLOCK) WHERE SmaActivo = 1`);
        mapeo = rm.recordset;
    } catch (err) {
        // Sin las tablas (deploy anterior al SQL) los reportes siguen andando por área.
        logger.warn('[CONTABILIDAD-REPORTES] Sectores no disponibles: ' + err.message);
        _cacheSectores = { data: { sectores: [], areaASector: {}, areasPorSector: {}, disponible: false }, ts: Date.now() };
        return _cacheSectores.data;
    }
    const areaASector = {}, areasPorSector = {};
    for (const m of mapeo.filter(x => x.SmaTipo === 'AREA')) {
        areaASector[m.SmaClave] = m.SecId;
        (areasPorSector[m.SecId] = areasPorSector[m.SecId] || []).push(m.SmaClave);
    }
    const data = { sectores, areaASector, areasPorSector, disponible: true };
    _cacheSectores = { data, ts: Date.now() };
    return data;
};

/** Nombre del sector de un área (o SIN_SECTOR si no está mapeada). */
const sectorDeArea = (area, mapa) => {
    const secId = mapa.areaASector[area];
    if (!secId) return SIN_SECTOR;
    const s = mapa.sectores.find(x => x.id === secId);
    return s || SIN_SECTOR;
};

/**
 * Áreas que hay que filtrar según los parámetros: [] = sin filtro.
 * `area` filtra un área puntual; `sector` filtra todas las áreas del sector.
 */
const areasDeFiltro = async (params) => {
    if (params.area) return [params.area];
    if (params.sector) {
        const mapa = await getMapeoSectores();
        return mapa.areasPorSector[params.sector] || ['__SECTOR_SIN_AREAS__'];
    }
    return [];
};

/** Condición SQL `expr IN (@fa0, @fa1...)` + bindeo de los parámetros. */
const condAreasIn = (areas, expr, request) => {
    if (!areas.length) return '';
    const names = areas.map((a, i) => {
        request.input(`fa${i}`, sql.NVarChar(150), a);
        return `@fa${i}`;
    });
    return `${expr} IN (${names.join(', ')})`;
};

// ─── GET /api/contabilidad/reportes/ventas-filtros ────────────────────────────
exports.getFiltrosVentas = async (req, res) => {
    try {
        const pool = await getPool();
        const monedas = await pool.request().query(`
            SELECT MonIdMoneda, MonDescripcionMoneda AS nombre, MonSimbolo
            FROM dbo.Monedas WITH(NOLOCK)
            ORDER BY MonIdMoneda
        `);
        // Cotización del día: precarga el TC editable de la torta unificada y del
        // resumen mensual (el usuario puede pisarla a mano en pantalla).
        const cot = await pool.request().query(`
            SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK)
            WHERE CotDolar IS NOT NULL ORDER BY CotFecha DESC
        `);
        // Sectores comerciales + qué áreas agrupa cada uno (para el selector)
        const mapa = await getMapeoSectores();
        const sinMapear = AREAS_CONOCIDAS.filter(a => !mapa.areaASector[a]);

        res.json({
            success: true,
            areas: AREAS_CONOCIDAS.map(nombre => ({ nombre, sector: mapa.areaASector[nombre] || null })),
            monedas: monedas.recordset,
            cotizacionDolar: cot.recordset.length ? Number(cot.recordset[0].CotDolar) : null,
            sectores: mapa.sectores.map(s => ({ ...s, areas: mapa.areasPorSector[s.id] || [] })),
            sectoresDisponibles: mapa.disponible,
            areasSinSector: sinMapear,
        });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getFiltrosVentas:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── GET /api/contabilidad/reportes/ventas-por-area ───────────────────────────
// Cada documento reparte su propio DocTotal (no DcdSubtotal) entre las áreas que
// tocó, proporcional al peso de DcdSubtotal de cada área dentro de ese documento
// (ver nota de cabecera "Por qué tienen que dar el mismo total"). Las notas de
// crédito entran con el DocTotal en negativo y se reparten igual. Esto además
// corrige un bug real: esta query no aplicaba fechaDesde/fechaHasta (a diferencia
// de ventas-por-documento, que sí) — "30 días" mostraba histórico completo acá,
// lo que por sí solo ya explicaba buena parte del desfasaje entre los dos reportes.
exports.getVentasPorArea = async (req, res) => {
    try {
        await tieneDcdArea(); // el área sale de DcdArea; si no existe, del parseo del prefijo
        const pool = await getPool();
        const params = extractParams(req.query);
        const { moneda, dgi } = params;

        const areaExpr   = areaDesdeCodigo('dcd.OrdCodigoOrden');
        const monedaExpr = `CASE WHEN l.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END`;
        const filtroDgi  = condDgi('fdoc', dgi);

        const r = pool.request();
        bindFiltrosComunes(r, params);
        r.input('moneda', sql.NVarChar(10), moneda || null);

        // DocTotal va con el signo de la nota (la de crédito resta): se reparte entre las
        // áreas de las líneas de la propia nota. CantidadDocumentos cuenta solo ventas.
        const pesoArea = `CASE
                    WHEN ISNULL(t.SubtotalDocTotal, 0) = 0 THEN 1.0 / t.NAreas
                    ELSE CAST(l.SubtotalArea AS FLOAT) / t.SubtotalDocTotal
                END`;
        const result = await r.query(`
            ;WITH ${params.articulo ? `${cteLineasArticulo()},` : ''}
            DocsVenta AS (
                SELECT fdoc.DocIdDocumento, fdoc.DocTotal * ${signoExpr('fdoc')} AS DocTotal, fdoc.MonIdMoneda,
                       CASE WHEN ${condEsNota('fdoc')} THEN 1 ELSE 0 END AS EsNota
                FROM dbo.DocumentosContables fdoc WITH(NOLOCK)
                WHERE ${condVentaONota('fdoc')}
                  AND fdoc.DocEstado <> 'ANULADO'
                  ${filtroDgi ? `AND ${filtroDgi}` : ''}
                  AND (@fechaDesde IS NULL OR fdoc.DocFechaEmision >= @fechaDesde)
                  AND (@fechaHasta IS NULL OR fdoc.DocFechaEmision <= @fechaHasta)
                  ${params.articulo ? `AND EXISTS (
                        SELECT 1 FROM dbo.DocumentosContablesDetalle dcdA WITH(NOLOCK)
                        WHERE dcdA.DocIdDocumento = fdoc.DocIdDocumento
                          AND ${condLineaDelArticulo('dcdA')}
                  )` : ''}
            ),
            LineasPorDocArea AS (
                SELECT dv.DocIdDocumento, dv.DocTotal, dv.MonIdMoneda, dv.EsNota,
                       ${areaExpr} AS Area,
                       SUM(dcd.DcdSubtotal) AS SubtotalArea
                FROM DocsVenta dv
                LEFT JOIN dbo.DocumentosContablesDetalle dcd WITH(NOLOCK) ON dcd.DocIdDocumento = dv.DocIdDocumento
                GROUP BY dv.DocIdDocumento, dv.DocTotal, dv.MonIdMoneda, dv.EsNota, ${areaExpr}
            ),
            TotalPorDoc AS (
                SELECT DocIdDocumento, SUM(SubtotalArea) AS SubtotalDocTotal, COUNT(*) AS NAreas
                FROM LineasPorDocArea
                GROUP BY DocIdDocumento
            )
            SELECT
                l.Area,
                ${monedaExpr} AS Moneda,
                SUM(l.DocTotal * ${pesoArea}) AS Ventas,
                COUNT(DISTINCT CASE WHEN l.EsNota = 0 THEN l.DocIdDocumento END) AS CantidadDocumentos,
                SUM(CASE WHEN l.EsNota = 1 THEN l.DocTotal * ${pesoArea} ELSE 0 END) AS Notas
            FROM LineasPorDocArea l
            JOIN TotalPorDoc t ON t.DocIdDocumento = l.DocIdDocumento
            WHERE (@area IS NULL OR l.Area = @area)
              AND (@moneda IS NULL OR ${monedaExpr} = @moneda)
            GROUP BY l.Area, ${monedaExpr}
            ORDER BY Moneda, Ventas DESC
        `);

        // Filtro por sector: se aplica acá (el SQL agrupa por área y el sector es
        // un roll-up de áreas, así no hay que tocar la query pesada).
        const mapa = await getMapeoSectores();
        let filas = result.recordset;
        if (params.sector) {
            const areasSec = mapa.areasPorSector[params.sector] || [];
            filas = filas.filter(r => areasSec.includes(r.Area));
        }

        // Porcentaje por moneda calculado acá, no en el frontend. `notas` = lo que restaron
        // las notas (con su signo), ya incluido en ventas: es solo para que la pantalla lo diga.
        const porMoneda = {};
        for (const row of filas) {
            if (!porMoneda[row.Moneda]) porMoneda[row.Moneda] = { total: 0, notas: 0, items: [] };
            porMoneda[row.Moneda].total += Number(row.Ventas || 0);
            porMoneda[row.Moneda].notas += Number(row.Notas || 0);
            porMoneda[row.Moneda].items.push(row);
        }
        for (const mon of Object.keys(porMoneda)) {
            const bucket = porMoneda[mon];
            bucket.items = bucket.items.map(it => ({
                area: it.Area,
                ventas: Number(it.Ventas || 0),
                notas: Number(it.Notas || 0),
                cantidadDocumentos: it.CantidadDocumentos,
                porcentaje: bucket.total > 0 ? Number(((Number(it.Ventas || 0) / bucket.total) * 100).toFixed(2)) : 0,
            }));
        }

        // Mismo corte agrupado por SECTOR comercial (roll-up de las áreas)
        const porSector = {};
        for (const row of filas) {
            const sec = sectorDeArea(row.Area, mapa);
            const b = porSector[row.Moneda] = porSector[row.Moneda] || { total: 0, notas: 0, _acc: {} };
            const it = b._acc[sec.id] = b._acc[sec.id] || {
                sector: sec.id, nombre: sec.nombre, orden: sec.orden,
                ventas: 0, notas: 0, cantidadDocumentos: 0, areas: [],
            };
            it.ventas += Number(row.Ventas || 0);
            it.notas += Number(row.Notas || 0);
            it.cantidadDocumentos += Number(row.CantidadDocumentos || 0);
            if (!it.areas.includes(row.Area)) it.areas.push(row.Area);
            b.total += Number(row.Ventas || 0);
            b.notas += Number(row.Notas || 0);
        }
        for (const mon of Object.keys(porSector)) {
            const b = porSector[mon];
            b.items = Object.values(b._acc)
                .map(it => ({ ...it, porcentaje: b.total > 0 ? Number(((it.ventas / b.total) * 100).toFixed(2)) : 0 }))
                .sort((a, z) => z.ventas - a.ventas);
            delete b._acc;
        }

        res.json({ success: true, data: filas, porMoneda, porSector, sectoresDisponibles: mapa.disponible });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getVentasPorArea:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── GET /api/contabilidad/reportes/ventas-por-documento ──────────────────────
// Unidad de conteo = documento (CantidadDocumentos cuenta documentos de venta). El importe
// es el DocTotal, con las notas de crédito restando, y con filtro de área/sector SOLO la
// porción del documento que es de esas áreas (faa.Peso, mismo reparto que ventas-por-area)
// — así los dos reportes cuadran también filtrados. Con filtro de artículo solo, el
// documento entero. CantidadNotas / ImporteNotas dicen cuánto restaron las notas de la fila.
exports.getVentasPorDocumento = async (req, res) => {
    try {
        await tieneDcdArea(); // el área sale de DcdArea; si no existe, del parseo del prefijo
        const pool = await getPool();
        const params = extractParams(req.query);
        const { fechaDesde, fechaHasta, articulo, moneda, dgi } = params;

        const r = pool.request();
        bindFiltrosComunes(r, params);
        if (moneda) r.input('moneda', sql.Int, parseInt(moneda)); // acá moneda es MonIdMoneda (numérico), no texto

        const condAreas = condAreasIn(await areasDeFiltro(params), areaDesdeCodigo('dcd.OrdCodigoOrden'), r);
        const filtro = filtroAreaArticulo(condAreas, articulo, 'doc');
        const filtroDgi = condDgi('doc', dgi);

        const conds = [
            condVentaONota('doc'),
            `doc.DocEstado <> 'ANULADO'`,
        ];
        if (filtroDgi)   conds.push(filtroDgi);
        if (fechaDesde)  conds.push('doc.DocFechaEmision >= @fechaDesde');
        if (fechaHasta)  conds.push('doc.DocFechaEmision <= @fechaHasta');
        if (moneda)      conds.push('doc.MonIdMoneda = @moneda');

        // Las notas restan (ver "Las notas de crédito RESTAN" arriba). Cada una va en la fila
        // de su propio estado de DGI y del tipo de pago de la FACTURA a la que apunta: su
        // DocTipo llega cortado ('E-Factura Nota De Cr') y no dice si era contado o crédito.
        // Si apunta a otra nota (una de débito que revierte una de crédito) se sigue un paso
        // más, para que las dos caigan en la misma fila y se compensen.
        const esNota = condEsNota('doc');
        const signo = signoExpr('doc');
        const estadoDgi = `CASE WHEN doc.CfeEstado = 'ACEPTADO_DGI' THEN 'ENVIADO_DGI' ELSE 'NO_ENVIADO' END`;
        const tipoPago = `CASE WHEN tp.Tipo LIKE '%Credito%' OR tp.Tipo LIKE '%CREDITO%'
                               OR (RTRIM(tp.Tipo) = 'Pedidos Caja' AND tp.Ciclo IS NOT NULL) THEN 'CREDITO' ELSE 'CONTADO' END`;
        const esVentaConDeuda = `(NOT ${esNota} AND (doc.DocTipo LIKE '%Credito%' OR doc.DocTipo LIKE '%CREDITO%' OR RTRIM(doc.DocTipo) = 'Pedidos Caja'))`;

        const result = await r.query(`
            ${filtro.cte ? `;WITH ${filtro.cte}` : ''}
            -- TipoPago: un "Pedidos Caja" es CONTADO si nació de una transacción de caja
            -- (se cobró en el momento) y CRÉDITO si nació de un cierre de ciclo de cuenta
            -- corriente (CicIdCiclo): el cliente lo paga después en cuotas. Antes todos
            -- caían en CONTADO por el nombre del tipo (verificado 23-sep-2026: 3.303 de
            -- caja vs 332 cierres de ciclo).
            SELECT
                ${estadoDgi} AS EstadoDgi,
                ${tipoPago} AS TipoPago,
                doc.MonIdMoneda,
                ISNULL(mon.MonSimbolo, '')          AS MonSimbolo,
                ISNULL(mon.MonDescripcionMoneda, '') AS MonNombre,
                -- Las cantidades cuentan solo documentos de venta; las notas van aparte.
                SUM(CASE WHEN ${esNota} THEN 0 ELSE 1 END) AS CantidadDocumentos,
                SUM(doc.DocTotal * ${signo} * ${filtro.peso}) AS ImporteTotal,
                SUM(CASE WHEN ${esNota} THEN 1 ELSE 0 END) AS CantidadNotas,
                SUM(CASE WHEN ${esNota} THEN doc.DocTotal * ${signo} * ${filtro.peso} ELSE 0 END) AS ImporteNotas,
                -- Pendiente = deuda VIVA (DeudaDocumento PENDIENTE/VENCIDO/PARCIAL) de los
                -- documentos a Crédito y de los Pedidos Caja (venta de caja que quedó sin
                -- pagar — pedido del usuario 23-sep-2026: PC-3981 y PC-4290 debían US$ 368,69 y
                -- el reporte decía 0). En tickets/facturas Contado sigue en 0: ahí DeudaDocumento
                -- trae dato sucio (docs pagados con deuda) y no representa deuda real.
                SUM(CASE WHEN ${esVentaConDeuda}
                         THEN ISNULL(dd.Pendiente, 0) ELSE 0 END * ${filtro.peso}) AS ImportePendiente,
                -- Cuántos documentos de la fila tienen algo pendiente (para mostrar "(n)" al lado)
                SUM(CASE WHEN ${esVentaConDeuda}
                          AND ISNULL(dd.Pendiente, 0) > 0.005 THEN 1 ELSE 0 END) AS CantidadConPendiente
            FROM dbo.DocumentosContables doc WITH(NOLOCK)
            ${filtro.join}
            LEFT JOIN dbo.Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = doc.MonIdMoneda
            -- Pre-agregado 1 fila por documento (puede haber >1 fila en DeudaDocumento
            -- para el mismo doc) para no duplicar CantidadDocumentos/ImporteTotal al hacer LEFT JOIN.
            LEFT JOIN (
                SELECT DocIdDocumento, SUM(DDeImportePendiente) AS Pendiente
                FROM dbo.DeudaDocumento WITH(NOLOCK)
                WHERE DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL')
                GROUP BY DocIdDocumento
            ) dd ON dd.DocIdDocumento = doc.DocIdDocumento
            -- Documento al que apunta la nota (y el de ese, si también es una nota)
            LEFT JOIN dbo.DocumentosContables ref  WITH(NOLOCK) ON ref.DocIdDocumento  = doc.DocIdDocumentoRef AND ${esNota}
            LEFT JOIN dbo.DocumentosContables ref2 WITH(NOLOCK) ON ref2.DocIdDocumento = ref.DocIdDocumentoRef AND ${condEsNota('ref')}
            CROSS APPLY (
                SELECT CASE WHEN ref2.DocIdDocumento IS NOT NULL THEN ref2.DocTipo
                            WHEN ref.DocIdDocumento  IS NOT NULL THEN ref.DocTipo  ELSE doc.DocTipo END AS Tipo,
                       CASE WHEN ref2.DocIdDocumento IS NOT NULL THEN ref2.CicIdCiclo
                            WHEN ref.DocIdDocumento  IS NOT NULL THEN ref.CicIdCiclo ELSE doc.CicIdCiclo END AS Ciclo
            ) tp
            WHERE ${conds.join(' AND ')}
            GROUP BY ${estadoDgi}, ${tipoPago},
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
        await tieneDcdArea(); // el área sale de DcdArea; si no existe, del parseo del prefijo
        const pool = await getPool();
        const params = extractParams(req.query);
        const { articulo, moneda, dgi } = params;

        const r = pool.request();
        bindFiltrosComunes(r, params);
        // Referenciado incondicionalmente en el SQL (patrón "@moneda IS NULL OR ..."), a
        // diferencia de ventas-por-area/documento — debe bindearse siempre.
        r.input('moneda', sql.Int, moneda ? parseInt(moneda) : null);

        const condAreas = condAreasIn(await areasDeFiltro(params), areaDesdeCodigo('dcd.OrdCodigoOrden'), r);
        const filtro = filtroAreaArticulo(condAreas, articulo, 'dc');
        const filtroDgi = condDgi('dc', dgi);

        // Factor para llevar el pago a la moneda del documento: 1 si coinciden; si no,
        // dólar del día del pago (última cotización cargada hasta esa fecha).
        const tcDiaPago = `(SELECT TOP 1 c.CotDolar FROM dbo.Cotizaciones c WITH(NOLOCK)
                             WHERE c.CotDolar > 0 AND c.CotFecha <= CAST(p.PagFechaPago AS DATE) ORDER BY c.CotFecha DESC)`;
        const factorAMonedaDoc = `CASE WHEN p.PagIdMonedaPago = dc.MonIdMoneda THEN 1.0
                                       WHEN dc.MonIdMoneda = 2 THEN 1.0 / NULLIF(${tcDiaPago}, 0)
                                       ELSE ${tcDiaPago} END`;

        const result = await r.query(`
            ;WITH ${filtro.cte ? `${filtro.cte},` : ''}
            -- Con filtro de área/sector, del pago se toma la misma porción que tiene el
            -- área en el documento (faa.Peso), igual que el "Facturado" con el que se compara.
            -- El cobro se expresa en la MONEDA DEL DOCUMENTO (decisión del usuario 23-sep-2026):
            -- antes se agrupaba por la moneda del pago, y una venta en US$ pagada en $ caía
            -- en la caja de pesos y quedaba "no cobrada" en dólares. Un pago en otra moneda se
            -- convierte al dólar del día del pago (dbo.Cotizaciones; Pagos.PagCotizacion no
            -- sirve: vale 1 en los pagos cruzados). MonIdMonedaPago se conserva para mostrar
            -- cuánto de lo cobrado entró en la otra moneda.
            IngresosContado AS (
                SELECT p.PagIdPago, dc.DocIdDocumento, dc.DocFechaEmision, p.PagFechaPago,
                       dc.MonIdMoneda, p.PagIdMonedaPago AS MonIdMonedaPago,
                       p.PagMontoPago * ${filtro.peso} * ${factorAMonedaDoc} AS Importe
                FROM dbo.Pagos p WITH(NOLOCK)
                JOIN dbo.TransaccionesCaja t WITH(NOLOCK) ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
                JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.TcaIdTransaccion = t.TcaIdTransaccion
                ${filtro.join}
                WHERE p.PagTipoMovimiento <> 'ANULADO'
                  AND ${condEsVenta('dc')}
                  AND dc.DocEstado <> 'ANULADO'
                  ${filtroDgi ? `AND ${filtroDgi}` : ''}
                  AND (@moneda IS NULL OR p.PagIdMonedaPago = @moneda)
            ),
            IngresosCredito AS (
                SELECT p.PagIdPago, dc.DocIdDocumento, dc.DocFechaEmision, p.PagFechaPago,
                       dc.MonIdMoneda, p.PagIdMonedaPago AS MonIdMonedaPago,
                       p.PagMontoPago * ${filtro.peso} * ${factorAMonedaDoc} AS Importe
                FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagIdPago = m.PagIdPago
                JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento
                ${filtro.join}
                WHERE m.MovTipo IN ('PAGO','COBRO')
                  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND p.PagTipoMovimiento <> 'ANULADO'
                  AND ${condEsVenta('dc')}
                  AND dc.DocEstado <> 'ANULADO'
                  ${filtroDgi ? `AND ${filtroDgi}` : ''}
                  AND (@moneda IS NULL OR p.PagIdMonedaPago = @moneda)
            ),
            -- Un pago cuenta UNA sola vez (verificado 23-sep-2026: los pagos de contado
            -- también tienen su MovimientosCuenta PAGO con DocIdDocumento, así que los dos
            -- caminos traían el mismo pago dos veces — sin filtro, $2,3 M de más en un mes;
            -- y un pago aplicado a varios documentos aparecía una vez por documento).
            IngresosTodos AS (
                SELECT PagIdPago, DocIdDocumento, DocFechaEmision, PagFechaPago, MonIdMoneda, MonIdMonedaPago, Importe
                FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY PagIdPago ORDER BY Prioridad, DocIdDocumento) AS Rn
                    FROM (
                        SELECT 1 AS Prioridad, * FROM IngresosContado
                        UNION ALL
                        SELECT 2 AS Prioridad, * FROM IngresosCredito
                    ) u
                ) d
                WHERE Rn = 1
            )
            -- MonIdMoneda = moneda del DOCUMENTO; ImporteOtraMoneda = parte de ImporteCobrado
            -- que se pagó en la otra moneda (ya convertida).
            SELECT 'PAGO' AS Base, MonIdMoneda, SUM(Importe) AS ImporteCobrado,
                   SUM(CASE WHEN MonIdMonedaPago <> MonIdMoneda THEN Importe ELSE 0 END) AS ImporteOtraMoneda,
                   COUNT(DISTINCT DocIdDocumento) AS CantidadFacturas
            FROM IngresosTodos
            WHERE (@fechaDesde IS NULL OR PagFechaPago >= @fechaDesde)
              AND (@fechaHasta IS NULL OR PagFechaPago <= @fechaHasta)
            GROUP BY MonIdMoneda
            UNION ALL
            SELECT 'FACTURA' AS Base, MonIdMoneda, SUM(Importe) AS ImporteCobrado,
                   SUM(CASE WHEN MonIdMonedaPago <> MonIdMoneda THEN Importe ELSE 0 END) AS ImporteOtraMoneda,
                   COUNT(DISTINCT DocIdDocumento) AS CantidadFacturas
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

// ─────────────────────────────────────────────────────────────────────────────
// LIBRO CONTADOR (CSV de importación para el estudio contable)
// Formato: Dia,Debe,Haber,Concepto,RUC,Moneda,Total,CodigoIVA,IVA,Cotizacion,Libro
// Solo documentos CfeEstado='ACEPTADO_DGI'. Lógica en services/libroContadorService.js
// (la misma que los scripts export_libro_*_contador.js).
// ─────────────────────────────────────────────────────────────────────────────
const libroContador = require('../services/libroContadorService');

/** GET /api/contabilidad/reportes/libro-contador-ventas?mes=YYYY-MM&fechaBase=contable|dgi */
exports.getLibroContadorVentas = async (req, res) => {
    try {
        const { mes, fechaBase } = req.query;
        const data = await libroContador.generarLibroVentas({ mes, fechaBase: fechaBase || 'contable' });
        res.json({ success: true, ...data });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getLibroContadorVentas:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/** GET /api/contabilidad/reportes/libro-contador-cobros?mes=YYYY-MM */
exports.getLibroContadorCobros = async (req, res) => {
    try {
        const { mes } = req.query;
        const data = await libroContador.generarLibroCobros({ mes });
        res.json({ success: true, ...data });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getLibroContadorCobros:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOP CLIENTES / TOP PRODUCTOS / DRILL-DOWN (reportes nuevos, maqueta del contador)
//
// Universo: mismo criterio de "venta" que los reportes de arriba (condEsVenta,
// sin anulados) MÁS las Notas de Crédito RESTANDO (decisión del usuario 12-ago-2026):
// el total de un cliente es lo que realmente le facturó la empresa, neto de NC.
//
// Cliente = CLIENTE INTERNO (el dueño de la orden), NO el receptor del CFE en DGI
// (decisión del usuario): un e-ticket a consumidor final o una factura a un tercero
// se atribuyen igual al cliente que encargó el trabajo. Resolución en 2 pasos:
//   1. doc.CliIdCliente (la cuenta interna que ya separa DocCli* del receptor DGI).
//   2. Si esa ficha es la bolsa genérica de mostrador (2089, ver ficha RFA SAS) o
//      NULL, se busca el dueño real vía las órdenes del documento:
//      DocumentosContablesDetalle.OrdCodigoOrden → Ordenes.CodigoOrden → CliIdCliente.
//   3. Lo irresoluble queda en la fila "Mostrador / sin identificar".
// ─────────────────────────────────────────────────────────────────────────────

// Fichas genéricas que NO son un cliente real: la bolsa de mostrador (2089, que
// además es RFA SAS real) y "USER CF" (8741), el comodín que usa la facturación
// manual cuando el receptor no tiene ficha. Sus documentos se atribuyen: 1º al
// dueño de la orden; 2º al RECEPTOR REAL del CFE en DGI (decisión del usuario,
// 12-ago-2026 — así FA-413 aparece como "Otero Gelpi" y no como "USER CF");
// 3º a "Mostrador / sin identificar".
const CLIENTE_MOSTRADOR = 2089; // se mantiene para el flag EsMostrador
const CLIENTES_GENERICOS = [2089, 8741];
const SQL_GENERICOS = CLIENTES_GENERICOS.join(', ');

// Moneda de los rankings (Top Clientes / Top Productos / Árbol / drill-downs):
//   moneda=1|2  → solo documentos de esa moneda, importes tal cual.
//   moneda=UNIF → las DOS monedas llevadas a US$: los documentos en $ se dividen por
//                 @tc (el TC que manda la pantalla, o la última cotización cargada).
// Pedido del usuario 23-sep-2026: "representado a una moneda, al dólar con el tipo
// de cambio como en las otras vistas". @moneda y @tc se bindean SIEMPRE porque las
// queries los referencian incondicionalmente.
const bindMonedaTop = async (r, params, q = {}) => {
    const unif = String(params.moneda || '').toUpperCase() === 'UNIF';
    let tc = unif ? (parseFloat(q.tc) || 0) : 0;
    if (unif && !(tc > 0)) {
        const pool = await getPool();
        const cot = await pool.request().query(`
            SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK)
            WHERE CotDolar > 0 ORDER BY CotFecha DESC`);
        tc = Number(cot.recordset[0]?.CotDolar) || 40;
    }
    r.input('moneda', sql.Int, unif ? null : (parseInt(params.moneda) || 1));
    r.input('tc', sql.Float, unif ? tc : 1);
    return { unif, tc };
};
// Factor que lleva el importe de un documento a la moneda del ranking (1 salvo en
// modo unificado para documentos en pesos).
const factorMonedaTop = (alias = 'doc') =>
    `CASE WHEN @moneda IS NULL AND ${alias}.MonIdMoneda = 1 THEN 1.0 / @tc ELSE 1.0 END`;

// Ventas + Notas (NC resta, ND suma): condVentaONota y signoExpr están arriba, junto a
// condEsVenta, porque ahora los usan todos los reportes de ventas.

// Primer token de un código de orden ('DF-102059 - LOBAS' → 'DF-102059').
const primerToken = (expr) =>
    `LEFT(${expr}, CASE WHEN CHARINDEX(' ', ${expr}) > 0 THEN CHARINDEX(' ', ${expr}) - 1 ELSE LEN(${expr}) END)`;

// Reglas que también usa "Ventas por vendedor" (vendedorVistaController.getVentasMensuales),
// para que su total cierre con estos reportes: mismo universo de documentos, mismo signo de
// las notas, mismo filtro de DGI y misma forma de encontrar al cliente real de un documento.
exports.reglasVentas = { condEsVenta, condVentaONota, signoExpr, condDgi, primerToken, CLIENTES_GENERICOS };

// Prefijo de batch compartido por Top Clientes y su drill-down. Materializa cada
// paso en tablas temporales (UNA sola pasada por tabla) porque la versión con CTEs
// re-evaluaba la resolución de cliente y el reparto por área una vez por cada
// referencia, y con el filtro de área superaba los 120s de timeout.
const batchDocsClienteMonto = (condArea = '') => `
    SET NOCOUNT ON;

    -- 1. Documentos del rango (ventas + notas, con signo)
    SELECT doc.DocIdDocumento, doc.CliIdCliente, doc.DocTotal, doc.MonIdMoneda,
           ${factorMonedaTop('doc')} AS Factor,
           doc.DocTipo, doc.DocSerie, doc.DocNumero, doc.CfeNumeroOficial,
           doc.CfeEstado, doc.DocFechaEmision, doc.DocCliNombre, doc.DocCliDocumento,
           ${signoExpr('doc')} AS Signo
    INTO #docs
    FROM dbo.DocumentosContables doc WITH(NOLOCK)
    WHERE ${condVentaONota('doc')}
      AND doc.DocEstado <> 'ANULADO'
      AND (@fechaDesde IS NULL OR doc.DocFechaEmision >= @fechaDesde)
      AND (@fechaHasta IS NULL OR doc.DocFechaEmision <= @fechaHasta)
      AND (@moneda IS NULL OR doc.MonIdMoneda = @moneda);

    -- 2. Áreas de cada documento con su peso (una pasada por el detalle)
    SELECT d.DocIdDocumento,
           ${areaDesdeCodigo('dcd.OrdCodigoOrden')} AS Area,
           SUM(ISNULL(dcd.DcdSubtotal, 0)) AS SubArea
    INTO #lineas
    FROM #docs d
    LEFT JOIN dbo.DocumentosContablesDetalle dcd WITH(NOLOCK) ON dcd.DocIdDocumento = d.DocIdDocumento
    GROUP BY d.DocIdDocumento, ${areaDesdeCodigo('dcd.OrdCodigoOrden')};

    -- 3. Dueño de la orden, solo para docs de fichas genéricas / sin cliente
    SELECT x.DocIdDocumento, MIN(o.CliIdCliente) AS CliOrden
    INTO #duenos
    FROM (
        SELECT DISTINCT dcd.DocIdDocumento,
               ${primerToken('dcd.OrdCodigoOrden')} AS Tok
        FROM #docs d
        JOIN dbo.DocumentosContablesDetalle dcd WITH(NOLOCK) ON dcd.DocIdDocumento = d.DocIdDocumento
        WHERE (d.CliIdCliente IS NULL OR d.CliIdCliente IN (${SQL_GENERICOS}))
          AND dcd.OrdCodigoOrden IS NOT NULL AND LTRIM(dcd.OrdCodigoOrden) <> ''
    ) x
    JOIN dbo.Ordenes o WITH(NOLOCK) ON o.CodigoOrden = x.Tok
    WHERE o.CliIdCliente IS NOT NULL AND o.CliIdCliente NOT IN (${SQL_GENERICOS})
    GROUP BY x.DocIdDocumento;

    -- 3b. Ficha encontrada por el RUC/CI del receptor: facturas manuales emitidas
    --     con ficha genérica cuyo receptor SÍ existe como cliente (mismo documento).
    SELECT d.DocIdDocumento, MIN(c.CliIdCliente) AS CliRuc
    INTO #porRuc
    FROM #docs d
    JOIN dbo.Clientes c WITH(NOLOCK)
      ON REPLACE(REPLACE(RTRIM(c.CioRuc), '-', ''), '.', '') =
         REPLACE(REPLACE(RTRIM(d.DocCliDocumento), '-', ''), '.', '')
    WHERE (d.CliIdCliente IS NULL OR d.CliIdCliente IN (${SQL_GENERICOS}))
      AND RTRIM(ISNULL(d.DocCliDocumento, '')) <> ''
      AND RTRIM(ISNULL(c.CioRuc, '')) <> ''
      AND c.CliIdCliente NOT IN (${SQL_GENERICOS})
    GROUP BY d.DocIdDocumento;

    -- 4. Documentos con el cliente interno resuelto: ficha real → dueño de la
    --    orden → ficha por RUC del receptor. Si nada resuelve, ReceptorReal guarda
    --    el nombre del receptor del CFE (grupo propio, marcado "sin ficha").
    SELECT d.*,
           CASE WHEN d.CliIdCliente IS NOT NULL AND d.CliIdCliente NOT IN (${SQL_GENERICOS})
                THEN d.CliIdCliente ELSE COALESCE(du.CliOrden, pr.CliRuc) END AS CliResuelto,
           CASE WHEN (d.CliIdCliente IS NULL OR d.CliIdCliente IN (${SQL_GENERICOS}))
                     AND du.CliOrden IS NULL AND pr.CliRuc IS NULL
                     AND RTRIM(ISNULL(d.DocCliNombre, '')) <> ''
                     AND UPPER(RTRIM(d.DocCliNombre)) NOT IN ('CONSUMIDOR FINAL', 'SIN NOMBRE')
                THEN RTRIM(d.DocCliNombre) ELSE NULL END AS ReceptorReal
    INTO #docsr
    FROM #docs d
    LEFT JOIN #duenos du ON du.DocIdDocumento = d.DocIdDocumento
    LEFT JOIN #porRuc pr ON pr.DocIdDocumento = d.DocIdDocumento;

    -- 5. Porción del DocTotal por área (pesos por DcdSubtotal, suman 1 por doc;
    --    con @area seteada queda SOLO la porción de esa área).
    --    CliId es la CLAVE DE GRUPO del ranking: '<id>' cliente interno,
    --    'R:<RECEPTOR>' receptor DGI sin ficha, 'M' mostrador/sin identificar.
    -- COALESCE (no ISNULL): ISNULL hereda el VARCHAR(20) del primer argumento y
    -- truncaba las claves 'R:<receptor>' largas.
    SELECT l.DocIdDocumento,
           COALESCE(CAST(r.CliResuelto AS VARCHAR(20)),
                    'R:' + UPPER(r.ReceptorReal), 'M') AS CliId,
           l.Area, r.Signo,
           r.DocTotal * r.Factor * r.Signo * CASE WHEN ISNULL(t.SubTot, 0) = 0 THEN 1.0 / t.NAreas
                                       ELSE CAST(l.SubArea AS FLOAT) / t.SubTot END AS Monto
    INTO #monto
    FROM #lineas l
    JOIN (SELECT DocIdDocumento, SUM(SubArea) AS SubTot, COUNT(*) AS NAreas FROM #lineas GROUP BY DocIdDocumento) t
      ON t.DocIdDocumento = l.DocIdDocumento
    JOIN #docsr r ON r.DocIdDocumento = l.DocIdDocumento
    ${condArea ? `WHERE ${condArea}` : ''};
`;

/**
 * GET /api/contabilidad/reportes/top-clientes
 *   ?fechaDesde&fechaHasta&moneda=1|2&area=&limite=50
 * Ranking de clientes internos por monto facturado neto de NC, con área dominante
 * y % de participación sobre el total del universo filtrado. Con filtro de área,
 * cada cliente suma SOLO la porción de sus documentos que corresponde a esa área.
 */
exports.getTopClientes = async (req, res) => {
    try {
        await tieneDcdArea(); // el área sale de DcdArea; si no existe, del parseo del prefijo
        const pool = await getPool();
        const params = extractParams(req.query);
        const limite = Math.min(parseInt(req.query.limite) || 50, 200);

        const r = pool.request();
        bindFiltrosComunes(r, params);
        await bindMonedaTop(r, params, req.query);
        r.input('limite', sql.Int, limite);
        // area = un área puntual; sector = todas las áreas de ese sector
        const condArea = condAreasIn(await areasDeFiltro(params), 'l.Area', r);

        const result = await r.query(`
            ${batchDocsClienteMonto(condArea)}
            ;WITH PorCliente AS (
                SELECT CliId,
                       SUM(Monto) AS Monto,
                       COUNT(DISTINCT DocIdDocumento) AS CantidadDocumentos,
                       COUNT(DISTINCT CASE WHEN Signo = -1 THEN DocIdDocumento END) AS CantidadNC
                FROM #monto
                GROUP BY CliId
            ),
            AreaPorCliente AS (
                SELECT CliId, Area,
                       ROW_NUMBER() OVER (PARTITION BY CliId ORDER BY SUM(Monto) DESC) AS rn
                FROM #monto
                GROUP BY CliId, Area
            )
            SELECT TOP (@limite)
                pc.CliId,
                CASE WHEN pc.CliId = 'M' THEN 'Mostrador / sin identificar'
                     WHEN pc.CliId LIKE 'R:%' THEN ISNULL(rec.ReceptorReal, SUBSTRING(pc.CliId, 3, 200))
                     ELSE RTRIM(ISNULL(c.Nombre, 'Cliente #' + pc.CliId)) END AS Nombre,
                -- CAST previo: CodCliente es numérico y sin él ISNULL(NULL,'') devuelve 0
                RTRIM(ISNULL(CAST(c.CodCliente AS VARCHAR(30)), '')) AS CodCliente,
                CASE WHEN pc.CliId = 'M' OR pc.CliId IN (${CLIENTES_GENERICOS.map(x => `'${x}'`).join(', ')}) THEN 1 ELSE 0 END AS EsMostrador,
                CASE WHEN pc.CliId LIKE 'R:%' THEN 1 ELSE 0 END AS EsSinFicha,
                pc.Monto, pc.CantidadDocumentos, pc.CantidadNC,
                ISNULL(ap.Area, 'Sin área') AS AreaDominante,
                tot.TotalUniverso, tot.CantidadClientes
            FROM PorCliente pc
            LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = TRY_CAST(pc.CliId AS INT)
            LEFT JOIN AreaPorCliente ap ON ap.CliId = pc.CliId AND ap.rn = 1
            OUTER APPLY (
                SELECT TOP 1 x.ReceptorReal
                FROM #docsr x
                WHERE 'R:' + UPPER(x.ReceptorReal) = pc.CliId
            ) rec
            CROSS JOIN (SELECT SUM(Monto) AS TotalUniverso, COUNT(*) AS CantidadClientes FROM PorCliente WHERE Monto > 0) tot
            WHERE pc.Monto <> 0
            ORDER BY pc.Monto DESC
        `);

        const rows = result.recordset;
        const totalUniverso = rows.length ? Number(rows[0].TotalUniverso || 0) : 0;
        res.json({
            success: true,
            data: rows.map(x => ({
                cliId: x.CliId, // clave de grupo: '<id>' | 'R:<RECEPTOR>' | 'M'
                nombre: x.Nombre,
                codCliente: x.CodCliente,
                esMostrador: !!x.EsMostrador,
                esSinFicha: !!x.EsSinFicha, // receptor real del CFE, sin ficha de cliente interno
                monto: Number(x.Monto || 0),
                cantidadDocumentos: x.CantidadDocumentos,
                cantidadNC: x.CantidadNC,
                areaDominante: x.AreaDominante,
                participacion: totalUniverso > 0 ? Number(((Number(x.Monto || 0) / totalUniverso) * 100).toFixed(2)) : 0,
            })),
            totalUniverso,
            cantidadClientes: rows.length ? rows[0].CantidadClientes : 0,
        });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getTopClientes:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/contabilidad/reportes/top-clientes-detalle
 *   ?cliente=<clave de grupo: '<id>' | 'R:<RECEPTOR>' | 'M'>&fechaDesde&fechaHasta&moneda&area=
 * Drill-down: los comprobantes que componen el total de una fila del ranking.
 */
exports.getTopClientesDetalle = async (req, res) => {
    try {
        await tieneDcdArea(); // el área sale de DcdArea; si no existe, del parseo del prefijo
        const pool = await getPool();
        const params = extractParams(req.query);
        const cliente = String(req.query.cliente || '').trim();
        if (!cliente) return res.status(400).json({ success: false, error: 'Falta el parámetro cliente' });

        const r = pool.request();
        bindFiltrosComunes(r, params);
        await bindMonedaTop(r, params, req.query);
        r.input('cliente', sql.NVarChar(250), cliente);
        const condArea = condAreasIn(await areasDeFiltro(params), 'l.Area', r);

        const result = await r.query(`
            ${batchDocsClienteMonto(condArea)}
            SELECT TOP 500
                dc.DocIdDocumento,
                LTRIM(RTRIM(dc.DocTipo)) AS DocTipo,
                RTRIM(ISNULL(dc.DocSerie, '')) + '-' + RTRIM(ISNULL(dc.DocNumero, '')) AS NumeroInterno,
                dc.CfeNumeroOficial,
                dc.DocFechaEmision,
                -- Con filtro de área es la PORCIÓN del documento que corresponde a esa
                -- área (mismo reparto que el ranking, así el modal suma igual que la fila);
                -- sin filtro es el total del documento (con signo de NC).
                m.Importe,
                dc.MonIdMoneda,
                dc.DocTotal * dc.Signo AS ImporteOriginal,
                dc.Signo,
                CASE WHEN dc.CfeEstado = 'ACEPTADO_DGI' THEN 1 ELSE 0 END AS EnviadoDgi,
                -- A quién salió el CFE en DGI, cuando el interno es una ficha genérica
                CASE WHEN dc.CliIdCliente IS NULL OR dc.CliIdCliente IN (${SQL_GENERICOS})
                     THEN ISNULL(NULLIF(RTRIM(dc.DocCliNombre), ''), 'Consumidor final') ELSE NULL END AS ReceptorDgi,
                areas.Area AS AreaDominante
            FROM #docsr dc
            JOIN (
                SELECT DocIdDocumento, SUM(Monto) AS Importe
                FROM #monto
                GROUP BY DocIdDocumento
            ) m ON m.DocIdDocumento = dc.DocIdDocumento
            OUTER APPLY (
                SELECT TOP 1 x.Area
                FROM #monto x
                WHERE x.DocIdDocumento = dc.DocIdDocumento
                ORDER BY x.Monto DESC
            ) areas
            WHERE COALESCE(CAST(dc.CliResuelto AS VARCHAR(20)),
                           'R:' + UPPER(dc.ReceptorReal), 'M') = @cliente
            ORDER BY dc.DocFechaEmision DESC
        `);

        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getTopClientesDetalle:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── Top Productos ────────────────────────────────────────────────────────────
// (23-sep-2026) El artículo sale de la LÍNEA FACTURADA (DocumentosContablesDetalle.
// DcdProIdProducto, poblado en el 97% de las líneas de venta desde jun-2026), no
// de la cotización de la orden como antes. Aquello perdía toda venta sin código de
// orden (en TPU/USD/30 días: 24 de 33 líneas, US$ 1.790 de 2.182) y sumaba importes
// COTIZADOS (PedidosCobranzaDetalle), no facturados. El importe de cada línea es su
// parte del DocTotal con el mismo reparto que ventas-por-area (proporción de
// DcdSubtotal dentro del documento; si el documento no tiene subtotales, partes
// iguales), así el ranking suma exactamente lo mismo que Ventas por Área con el
// mismo filtro. La orden se usa solo para variante / nombre del trabajo / cliente
// dueño de la orden. Las NC restan (1-oct-2026): sus líneas traen el artículo de la
// factura, así que entran con importe y cantidad en negativo; antes quedaban afuera.
// Las líneas sin artículo se devuelven aparte (sinArticulo) para que la pantalla lo diga.
// El filtro de área va en la CTE "Lineas" (no en LineasVenta) para que el reparto
// del DocTotal se calcule sobre TODAS las líneas del documento.
const cteLineasVenta = (condArea = '') => `
    LineasVenta AS (
        SELECT doc.DocIdDocumento, doc.DocFechaEmision, doc.DocTipo, doc.DocSerie, doc.DocNumero, doc.MonIdMoneda,
               ${factorMonedaTop('doc')} AS Factor,
               CASE WHEN ${condEsNota('doc')} THEN 1 ELSE 0 END AS EsNota,
               dcd.DcdIdDetalle, dcd.DcdProIdProducto AS ProIdProducto, dcd.DcdNomItem,
               ISNULL(dcd.DcdCantidad, 0) * ${signoExpr('doc')} AS Cantidad,
               CASE WHEN dcd.OrdCodigoOrden IS NULL OR LTRIM(dcd.OrdCodigoOrden) = '' THEN NULL
                    ELSE ${primerToken('dcd.OrdCodigoOrden')} END AS CodigoOrden,
               ${areaDesdeCodigo('dcd.OrdCodigoOrden')} AS Area,
               COALESCE(o.CliIdCliente, doc.CliIdCliente) AS ClienteId,
               o.OrdenID,
               NULLIF(LTRIM(RTRIM(CAST(o.Variante AS NVARCHAR(200)))), '') AS Variante,
               NULLIF(LTRIM(RTRIM(CAST(o.DescripcionTrabajo AS NVARCHAR(400)))), '') AS NombreTrabajo,
               doc.DocTotal * ${signoExpr('doc')} * ${factorMonedaTop('doc')} * CASE
                   WHEN SUM(ISNULL(dcd.DcdSubtotal, 0)) OVER (PARTITION BY doc.DocIdDocumento) = 0
                        THEN 1.0 / COUNT(*) OVER (PARTITION BY doc.DocIdDocumento)
                   ELSE CAST(ISNULL(dcd.DcdSubtotal, 0) AS FLOAT) / SUM(ISNULL(dcd.DcdSubtotal, 0)) OVER (PARTITION BY doc.DocIdDocumento)
               END AS Monto
        FROM dbo.DocumentosContables doc WITH(NOLOCK)
        JOIN dbo.DocumentosContablesDetalle dcd WITH(NOLOCK) ON dcd.DocIdDocumento = doc.DocIdDocumento
        OUTER APPLY (
            SELECT TOP 1 o.OrdenID, o.CliIdCliente, o.Variante, o.DescripcionTrabajo
            FROM dbo.Ordenes o WITH(NOLOCK)
            WHERE dcd.OrdCodigoOrden IS NOT NULL AND LTRIM(dcd.OrdCodigoOrden) <> ''
              AND o.CodigoOrden = ${primerToken('dcd.OrdCodigoOrden')}
        ) o
        WHERE ${condVentaONota('doc')}
          AND doc.DocEstado <> 'ANULADO'
          AND (@fechaDesde IS NULL OR doc.DocFechaEmision >= @fechaDesde)
          AND (@fechaHasta IS NULL OR doc.DocFechaEmision <= @fechaHasta)
          AND (@moneda IS NULL OR doc.MonIdMoneda = @moneda)
    ),
    Lineas AS (
        SELECT lv.* FROM LineasVenta lv
        ${condArea ? `WHERE ${condArea}` : ''}
    )`;

/**
 * GET /api/contabilidad/reportes/top-productos
 *   ?fechaDesde&fechaHasta&moneda=1|2|UNIF&tc=&area=|sector=&cliente=&limite=200
 * Ranking de artículos por monto facturado y unidades (el orden final lo elige el
 * front). Devuelve además sinArticulo = lo facturado en líneas sin artículo, que
 * no puede entrar al ranking.
 */
exports.getTopProductos = async (req, res) => {
    try {
        await tieneDcdArea(); // el área sale de DcdArea; si no existe, del parseo del prefijo
        const pool = await getPool();
        const params = extractParams(req.query);
        const cliente = req.query.cliente ? parseInt(req.query.cliente) : null;
        const limite = Math.min(parseInt(req.query.limite) || 200, 500);

        const r = pool.request();
        bindFiltrosComunes(r, params);
        await bindMonedaTop(r, params, req.query);
        r.input('cliente', sql.Int, cliente);
        r.input('limite', sql.Int, limite);
        const condArea = condAreasIn(await areasDeFiltro(params), 'lv.Area', r);

        const result = await r.query(`
            ;WITH ${cteLineasVenta(condArea)},
            PorProducto AS (
                SELECT l.ProIdProducto,
                       RTRIM(ISNULL(a.CodArticulo, '')) AS CodArticulo,
                       RTRIM(ISNULL(a.Descripcion, 'Artículo #' + CAST(l.ProIdProducto AS VARCHAR(10)))) AS Descripcion,
                       RTRIM(ISNULL(CAST(a.Grupo AS VARCHAR(20)), '')) AS Grupo,
                       SUM(l.Cantidad) AS Unidades,
                       SUM(l.Monto) AS Monto,
                       COUNT(DISTINCT CASE WHEN l.EsNota = 0 THEN l.DocIdDocumento END) AS CantidadDocumentos
                FROM Lineas l
                LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = l.ProIdProducto
                WHERE l.ProIdProducto IS NOT NULL
                  AND (@cliente IS NULL OR l.ClienteId = @cliente)
                GROUP BY l.ProIdProducto, a.CodArticulo, a.Descripcion, a.Grupo
                HAVING SUM(l.Monto) <> 0 OR SUM(l.Cantidad) <> 0
            ),
            -- Área donde más se facturó cada artículo (para mostrarla en el ranking).
            -- Si no tiene, cae a la clasificación del catálogo (ArticuloClasificacion).
            AreaPorProducto AS (
                SELECT l.ProIdProducto, l.Area,
                       ROW_NUMBER() OVER (PARTITION BY l.ProIdProducto ORDER BY SUM(l.Monto) DESC) AS rn
                FROM Lineas l
                WHERE l.ProIdProducto IS NOT NULL AND (@cliente IS NULL OR l.ClienteId = @cliente)
                GROUP BY l.ProIdProducto, l.Area
            )
            SELECT TOP (@limite)
                p.*,
                COALESCE(ap.Area, cl.AclArea, 'Sin área') AS Area,
                cl.AclVariante AS Variante
            FROM PorProducto p
            LEFT JOIN AreaPorProducto ap ON ap.ProIdProducto = p.ProIdProducto AND ap.rn = 1
            LEFT JOIN dbo.ArticuloClasificacion cl WITH(NOLOCK) ON cl.ProIdProducto = p.ProIdProducto
            ORDER BY p.Monto DESC
        `);

        // Lo facturado que NO puede entrar al ranking porque la línea no tiene artículo
        const sinArt = await r.query(`
            ;WITH ${cteLineasVenta(condArea)}
            SELECT ISNULL(SUM(l.Monto), 0) AS Monto,
                   SUM(CASE WHEN l.EsNota = 0 THEN 1 ELSE 0 END) AS Lineas,
                   COUNT(DISTINCT CASE WHEN l.EsNota = 0 THEN l.DocIdDocumento END) AS Documentos
            FROM Lineas l
            WHERE l.ProIdProducto IS NULL AND (@cliente IS NULL OR l.ClienteId = @cliente)
        `);

        // Sector al que pertenece el área de cada artículo (roll-up del mapeo)
        const mapa = await getMapeoSectores();
        res.json({
            success: true,
            data: result.recordset.map(x => ({ ...x, Sector: sectorDeArea(x.Area, mapa).nombre })),
            sinArticulo: sinArt.recordset[0] || { Monto: 0, Lineas: 0, Documentos: 0 },
        });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getTopProductos:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE SECTORES (pantalla de administración)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/contabilidad/reportes/sectores — sectores + qué áreas agrupa cada uno */
exports.getSectores = async (req, res) => {
    try {
        const mapa = await getMapeoSectores();
        res.json({
            success: true,
            disponible: mapa.disponible,
            sectores: mapa.sectores.map(s => ({ ...s, areas: mapa.areasPorSector[s.id] || [] })),
            areas: AREAS_CONOCIDAS.map(nombre => ({ nombre, sector: mapa.areaASector[nombre] || null })),
        });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getSectores:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/** POST /api/contabilidad/reportes/sectores  { id, nombre, orden } — crea o renombra */
exports.guardarSector = async (req, res) => {
    try {
        const id = String(req.body?.id || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 30);
        const nombre = String(req.body?.nombre || '').trim().slice(0, 100);
        const orden = parseInt(req.body?.orden) || 0;
        if (!id || !nombre) return res.status(400).json({ success: false, error: 'Faltan el código y el nombre del sector.' });

        const pool = await getPool();
        await pool.request()
            .input('id', sql.VarChar(30), id)
            .input('nombre', sql.NVarChar(100), nombre)
            .input('orden', sql.Int, orden)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.Sectores WHERE SecId = @id)
                    UPDATE dbo.Sectores SET SecNombre = @nombre, SecOrden = @orden WHERE SecId = @id;
                ELSE
                    INSERT INTO dbo.Sectores (SecId, SecNombre, SecOrden, SecActivo) VALUES (@id, @nombre, @orden, 1);
            `);
        _cacheSectores = { data: null, ts: 0 };
        logger.info(`[CONTABILIDAD-REPORTES] Sector guardado: ${id} (${nombre})`);
        res.json({ success: true });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] guardarSector:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * PUT /api/contabilidad/reportes/sectores/mapeo  { area, sector }
 * Asigna un área a un sector. sector vacío/null = desasignar (queda "Sin sector").
 * Cambia SOLO la agrupación: al derivarse en cada consulta, todo el histórico
 * se reagrupa al instante y ninguna venta cambia de importe.
 */
exports.guardarMapeoSector = async (req, res) => {
    try {
        const area = String(req.body?.area || '').trim();
        const sector = String(req.body?.sector || '').trim();
        if (!area) return res.status(400).json({ success: false, error: 'Falta el área.' });

        const pool = await getPool();
        const r = pool.request().input('area', sql.VarChar(100), area);
        if (!sector) {
            await r.query(`DELETE FROM dbo.SectorMapeo WHERE SmaTipo = 'AREA' AND SmaClave = @area`);
        } else {
            await r.input('sector', sql.VarChar(30), sector).query(`
                IF EXISTS (SELECT 1 FROM dbo.SectorMapeo WHERE SmaTipo = 'AREA' AND SmaClave = @area)
                    UPDATE dbo.SectorMapeo SET SecId = @sector, SmaActivo = 1 WHERE SmaTipo = 'AREA' AND SmaClave = @area;
                ELSE
                    INSERT INTO dbo.SectorMapeo (SmaTipo, SmaClave, SecId, SmaActivo) VALUES ('AREA', @area, @sector, 1);
            `);
        }
        _cacheSectores = { data: null, ts: 0 };
        logger.info(`[CONTABILIDAD-REPORTES] Área "${area}" → sector "${sector || '(ninguno)'}"`);
        res.json({ success: true });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] guardarMapeoSector:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO DE ARTÍCULOS: árbol Sector → Área → Variante → Artículo
// La clasificación vive en dbo.ArticuloClasificacion (área + variante por
// artículo); el sector se deriva del área. Sirve para que una venta de mostrador
// —sin orden de producción— igual sepa a qué área y sector pertenece.
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/contabilidad/reportes/catalogo — árbol + artículos sin clasificar */
exports.getCatalogoArbol = async (req, res) => {
    try {
        const pool = await getPool();
        // Sin las tablas de clasificación (deploy anterior al SQL) la pantalla no
        // puede funcionar, pero avisa qué falta en vez de tirar un error crudo.
        const existe = await pool.request().query(`
            SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='ArticuloClasificacion'`);
        if (Number(existe.recordset[0]?.N || 0) === 0) {
            return res.json({
                success: true, disponible: false,
                arbol: [], sinClasificar: [], totalArticulos: 0, clasificados: 0,
                areas: AREAS_CONOCIDAS, variantesPorArea: {},
                mensaje: 'Falta correr add_ArticuloClasificacion.sql en esta base para poder clasificar el catálogo.',
            });
        }

        const arts = (await pool.request().query(`
            SELECT a.ProIdProducto,
                   RTRIM(ISNULL(a.CodArticulo, '')) AS CodArticulo,
                   RTRIM(ISNULL(a.Descripcion, '')) AS Descripcion,
                   RTRIM(ISNULL(CAST(a.Grupo AS VARCHAR(20)), '')) AS Grupo,
                   c.AclArea, c.AclVariante, c.AclOrigen
            FROM dbo.Articulos a WITH(NOLOCK)
            LEFT JOIN dbo.ArticuloClasificacion c WITH(NOLOCK) ON c.ProIdProducto = a.ProIdProducto
            ORDER BY a.Descripcion
        `)).recordset;

        // Variantes ya usadas por área (para sugerirlas al clasificar a mano)
        const vars = (await pool.request().query(`
            SELECT DISTINCT c.AclArea AS Area, c.AclVariante AS Variante
            FROM dbo.ArticuloClasificacion c WITH(NOLOCK)
            WHERE c.AclArea IS NOT NULL AND c.AclVariante IS NOT NULL
            UNION
            SELECT DISTINCT
                   CASE UPPER(LTRIM(RTRIM(o.AreaID)))
                       WHEN 'DF' THEN 'DTF' WHEN 'SB' THEN 'Sublimacion' WHEN 'ECOUV' THEN 'ECOUV'
                       WHEN 'TERMINAC' THEN 'ECOUV' WHEN 'DIRECTA' THEN 'IMPRESION DIRECTA'
                       WHEN 'DIRECTA-ALGODON' THEN 'IMPRESION DIRECTA' WHEN 'EMB' THEN 'Bordado'
                       WHEN 'EST' THEN 'Estampado' WHEN 'TWC' THEN 'Corte' WHEN 'TWT' THEN 'Costura'
                       WHEN 'TPU' THEN 'TPU' WHEN 'PRO' THEN 'Productos Confeccionados' ELSE NULL END,
                   LTRIM(RTRIM(CAST(o.Variante AS NVARCHAR(200))))
            FROM dbo.Ordenes AS o WITH(NOLOCK)
            WHERE o.Variante IS NOT NULL AND LTRIM(RTRIM(CAST(o.Variante AS NVARCHAR(200)))) <> ''
        `)).recordset.filter(x => x.Area && x.Variante);

        const variantesPorArea = {};
        for (const v of vars) (variantesPorArea[v.Area] = variantesPorArea[v.Area] || []).push(v.Variante);
        for (const k of Object.keys(variantesPorArea)) variantesPorArea[k] = [...new Set(variantesPorArea[k])].sort();

        // Árbol
        const mapa = await getMapeoSectores();
        const raiz = new Map();
        const sinClasificar = [];
        for (const a of arts) {
            const item = {
                proIdProducto: a.ProIdProducto, codArticulo: a.CodArticulo,
                descripcion: a.Descripcion, grupo: a.Grupo,
                area: a.AclArea || null, variante: a.AclVariante || null,
                origen: a.AclOrigen || null,
            };
            if (!a.AclArea) { sinClasificar.push(item); continue; }
            const sec = sectorDeArea(a.AclArea, mapa);
            if (!raiz.has(sec.id)) raiz.set(sec.id, { id: sec.id, nombre: sec.nombre, nivel: 'sector', cantidad: 0, hijos: new Map() });
            const nSec = raiz.get(sec.id);
            if (!nSec.hijos.has(a.AclArea)) nSec.hijos.set(a.AclArea, { id: `${sec.id}|${a.AclArea}`, nombre: a.AclArea, nivel: 'area', cantidad: 0, hijos: new Map() });
            const nArea = nSec.hijos.get(a.AclArea);
            const varName = a.AclVariante || 'Sin variante';
            if (!nArea.hijos.has(varName)) nArea.hijos.set(varName, { id: `${sec.id}|${a.AclArea}|${varName}`, nombre: varName, nivel: 'variante', cantidad: 0, articulos: [] });
            const nVar = nArea.hijos.get(varName);
            nVar.articulos.push(item);
            nSec.cantidad++; nArea.cantidad++; nVar.cantidad++;
        }

        const materializar = (m) => [...m.values()].sort((a, b) => b.cantidad - a.cantidad).map(n => ({
            ...n,
            hijos: n.hijos ? materializar(n.hijos) : undefined,
            articulos: n.articulos ? n.articulos.sort((x, y) => x.descripcion.localeCompare(y.descripcion)) : undefined,
        }));

        res.json({
            success: true,
            arbol: materializar(raiz),
            sinClasificar,
            totalArticulos: arts.length,
            clasificados: arts.length - sinClasificar.length,
            areas: AREAS_CONOCIDAS,
            variantesPorArea,
        });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getCatalogoArbol:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * PUT /api/contabilidad/reportes/catalogo/articulo
 *   { productos: [id...], area, variante }
 * Clasifica uno o varios artículos. area vacía = sacarlos del árbol.
 */
exports.clasificarArticulos = async (req, res) => {
    try {
        const productos = Array.isArray(req.body?.productos) ? req.body.productos.map(Number).filter(n => n > 0) : [];
        const area = String(req.body?.area || '').trim();
        const variante = String(req.body?.variante || '').trim();
        if (!productos.length) return res.status(400).json({ success: false, error: 'No se indicó ningún artículo.' });
        if (area && !AREAS_CONOCIDAS.includes(area)) {
            return res.status(400).json({ success: false, error: `El área "${area}" no existe.` });
        }

        const pool = await getPool();
        for (const id of productos) {
            await pool.request()
                .input('id', sql.Int, id)
                .input('area', sql.NVarChar(150), area || null)
                .input('variante', sql.NVarChar(200), variante || null)
                .input('usr', sql.Int, req.user?.id || null)
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.ArticuloClasificacion WHERE ProIdProducto = @id)
                        UPDATE dbo.ArticuloClasificacion
                        SET AclArea = @area, AclVariante = @variante, AclOrigen = 'MANUAL',
                            AclFecha = GETDATE(), AclUsuarioId = @usr
                        WHERE ProIdProducto = @id;
                    ELSE
                        INSERT INTO dbo.ArticuloClasificacion (ProIdProducto, AclArea, AclVariante, AclOrigen, AclUsuarioId)
                        VALUES (@id, @area, @variante, 'MANUAL', @usr);
                `);
        }
        logger.info(`[CONTABILIDAD-REPORTES] ${productos.length} artículo(s) → área "${area || '(ninguna)'}" / variante "${variante || '(ninguna)'}"`);
        res.json({ success: true, actualizados: productos.length });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] clasificarArticulos:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/contabilidad/reportes/arbol-ventas
 *   ?fechaDesde&fechaHasta&moneda=1|2&area=|sector=
 *
 * Jerarquía Sector → Área → Variante → Producto para explorar la venta de lo
 * general a lo particular. Cada nivel sale de una fuente distinta y real:
 *   Sector   → mapeo dbo.SectorMapeo sobre el área
 *   Área     → prefijo del código de orden (mismo criterio que el resto)
 *   Variante → Ordenes.Variante (poblada en ~99,9% de las órdenes)
 *   Producto → PedidosCobranzaDetalle.ProIdProducto → Articulos
 *
 * OJO con los importes: salen de la cotización de la orden (pcd.Subtotal), que
 * es la única fuente que llega a nivel artículo. Por eso el total del árbol
 * puede no coincidir exactamente con Ventas por Área (que reparte el DocTotal
 * facturado); el front lo aclara. Es la misma base que Top Productos, así que
 * esas dos pantallas sí cierran entre sí.
 */
exports.getArbolVentas = async (req, res) => {
    try {
        await tieneDcdArea(); // el área sale de DcdArea; si no existe, del parseo del prefijo
        const pool = await getPool();
        const params = extractParams(req.query);

        const r = pool.request();
        bindFiltrosComunes(r, params);
        await bindMonedaTop(r, params, req.query);
        const condArea = condAreasIn(await areasDeFiltro(params), 'lv.Area', r);

        // Misma base que Top Productos (líneas facturadas). Las líneas sin artículo
        // entran como hoja "Sin artículo en la línea", así el total del árbol es el
        // mismo que Ventas por Área.
        const result = await r.query(`
            ;WITH ${cteLineasVenta(condArea)}
            SELECT l.Area,
                   l.Variante,
                   l.ProIdProducto,
                   RTRIM(ISNULL(a.Descripcion, CASE WHEN l.ProIdProducto IS NULL THEN 'Sin artículo en la línea'
                                                    ELSE 'Artículo #' + CAST(l.ProIdProducto AS VARCHAR(10)) END)) AS Producto,
                   RTRIM(ISNULL(a.CodArticulo, ''))              AS CodArticulo,
                   SUM(l.Cantidad)                               AS Unidades,
                   SUM(l.Monto)                                  AS Monto,
                   COUNT(DISTINCT CASE WHEN l.EsNota = 0 THEN l.DocIdDocumento END) AS Documentos,
                   COUNT(DISTINCT l.OrdenID)                     AS Ordenes
            FROM Lineas l
            LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = l.ProIdProducto
            GROUP BY l.Area, l.Variante, l.ProIdProducto, a.Descripcion, a.CodArticulo
            HAVING SUM(l.Monto) <> 0 OR SUM(l.Cantidad) <> 0
        `);

        // Armado del árbol: agrupa hacia arriba (producto → variante → área → sector)
        const mapa = await getMapeoSectores();
        const raiz = new Map();
        const nodo = (cont, id, nombre, nivel) => {
            if (!cont.has(id)) cont.set(id, { id, nombre, nivel, monto: 0, unidades: 0, documentos: 0, hijos: new Map() });
            return cont.get(id);
        };
        const sumar = (n, row) => {
            n.monto += Number(row.Monto || 0);
            n.unidades += Number(row.Unidades || 0);
            n.documentos += Number(row.Documentos || 0);
        };

        for (const row of result.recordset) {
            const sec = sectorDeArea(row.Area, mapa);
            const nSec = nodo(raiz, sec.id, sec.nombre, 'sector');
            const nArea = nodo(nSec.hijos, `${sec.id}|${row.Area}`, row.Area, 'area');
            const varName = row.Variante || 'Sin variante';
            const nVar = nodo(nArea.hijos, `${sec.id}|${row.Area}|${varName}`, varName, 'variante');
            const nProd = nodo(nVar.hijos, `p${row.ProIdProducto}`, row.Producto, 'producto');
            nProd.codArticulo = row.CodArticulo;
            nProd.proIdProducto = row.ProIdProducto;
            [nSec, nArea, nVar, nProd].forEach(n => sumar(n, row));
        }

        // Map → array ordenado por monto, con % sobre el padre
        const materializar = (cont, totalPadre) =>
            [...cont.values()]
                .sort((a, b) => b.monto - a.monto)
                .map(n => ({
                    id: n.id, nombre: n.nombre, nivel: n.nivel,
                    codArticulo: n.codArticulo, proIdProducto: n.proIdProducto,
                    monto: Number(n.monto.toFixed(2)),
                    unidades: Number(n.unidades.toFixed(2)),
                    documentos: n.documentos,
                    porcentajePadre: totalPadre > 0 ? Number(((n.monto / totalPadre) * 100).toFixed(2)) : 0,
                    hijos: materializar(n.hijos, n.monto),
                }));

        const total = [...raiz.values()].reduce((s, n) => s + n.monto, 0);
        res.json({ success: true, total: Number(total.toFixed(2)), data: materializar(raiz, total) });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getArbolVentas:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/contabilidad/reportes/top-productos-detalle
 *   ?producto=<ProIdProducto>&fechaDesde&fechaHasta&moneda&area=&cliente=
 * Drill-down: órdenes/comprobantes que componen el total de un artículo.
 */
exports.getTopProductosDetalle = async (req, res) => {
    try {
        await tieneDcdArea(); // el área sale de DcdArea; si no existe, del parseo del prefijo
        const pool = await getPool();
        const params = extractParams(req.query);
        const producto = parseInt(req.query.producto);
        if (isNaN(producto)) return res.status(400).json({ success: false, error: 'Falta el parámetro producto' });
        const cliente = req.query.cliente ? parseInt(req.query.cliente) : null;

        const r = pool.request();
        bindFiltrosComunes(r, params);
        await bindMonedaTop(r, params, req.query);
        r.input('cliente', sql.Int, cliente);
        r.input('producto', sql.Int, producto);
        const condArea = condAreasIn(await areasDeFiltro(params), 'lv.Area', r);

        // Una fila por línea facturada del artículo (Subtotal = su parte del DocTotal,
        // ya en la moneda del ranking; SubtotalOriginal = en la moneda del documento).
        const result = await r.query(`
            ;WITH ${cteLineasVenta(condArea)}
            SELECT TOP 500
                l.DocIdDocumento,
                LTRIM(RTRIM(l.DocTipo)) AS DocTipo,
                RTRIM(ISNULL(l.DocSerie, '')) + '-' + RTRIM(ISNULL(CAST(l.DocNumero AS VARCHAR(50)), '')) AS NumeroInterno,
                l.DocFechaEmision,
                l.CodigoOrden,
                l.Area,
                l.Variante,
                l.NombreTrabajo,
                RTRIM(ISNULL(c.Nombre, 'Mostrador')) AS Cliente,
                l.Cantidad,
                CASE WHEN l.Cantidad <> 0 THEN l.Monto / l.Cantidad ELSE NULL END AS PrecioUnitario,
                l.Monto AS Subtotal,
                l.MonIdMoneda,
                l.Monto / NULLIF(l.Factor, 0) AS SubtotalOriginal
            FROM Lineas l
            LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = l.ClienteId
            WHERE l.ProIdProducto = @producto
              AND (@cliente IS NULL OR l.ClienteId = @cliente)
            ORDER BY l.DocFechaEmision DESC
        `);

        const mapa = await getMapeoSectores();
        res.json({
            success: true,
            data: result.recordset.map(x => ({ ...x, Sector: sectorDeArea(x.Area, mapa).nombre })),
        });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getTopProductosDetalle:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN MENSUAL: EVOLUCIÓN DEL AÑO + COMPARACIÓN CON EL AÑO ANTERIOR
// (maqueta "Resumen Mensual – Evolución y Comparación", 28-sep-2026)
//
// ventas-mensuales: un dato por mes del año pedido, mismo universo y mismo
// reparto por área/sector que ventas-por-area (DocTotal × peso del área), con el
// TC promedio de cada mes (dbo.Cotizaciones) para que los meses pasados no cambien
// cuando cambia la cotización del día. Un mes sin documentos en el sistema cae a
// dbo.VentasHistoricas (cargado a mano) y se marca origen 'historico': así se
// cubren 2025 entero y los meses de 2026 anteriores al arranque del sistema.
// ─────────────────────────────────────────────────────────────────────────────

// Clave del ámbito tal como la guarda VentasHistoricas y la usa la pantalla:
// '' = total empresa, 'S:<sector>' o 'A:<área>'.
const claveAmbito = (params) => params.sector ? `S:${params.sector}` : params.area ? `A:${params.area}` : '';

let _tieneVentasHistoricas = null;
const tieneVentasHistoricas = async () => {
    if (_tieneVentasHistoricas !== null) return _tieneVentasHistoricas;
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VentasHistoricas'`);
        _tieneVentasHistoricas = Number(r.recordset[0]?.N || 0) > 0;
        if (!_tieneVentasHistoricas) logger.warn('[CONTABILIDAD-REPORTES] dbo.VentasHistoricas no existe: correr scripts/add_ventas_historicas.sql');
    } catch { _tieneVentasHistoricas = false; }
    return _tieneVentasHistoricas;
};

const leerHistoricas = async (anio, ambito) => {
    if (!(await tieneVentasHistoricas())) return [];
    const pool = await getPool();
    const r = await pool.request()
        .input('anio', sql.Int, anio)
        .input('ambito', sql.NVarChar(60), ambito)
        .query(`
            SELECT VhiMes AS Mes, VhiMoneda AS Moneda, VhiMonto AS Monto, VhiUsuario AS Usuario, VhiFechaCarga AS FechaCarga
            FROM dbo.VentasHistoricas WITH(NOLOCK)
            WHERE VhiAnio = @anio AND VhiAmbito = @ambito
            ORDER BY VhiMes`);
    return r.recordset;
};

/**
 * GET /api/contabilidad/reportes/ventas-mensuales?anio=2026&sector=|area=&dgi=
 * Devuelve { anio, mesEnCurso, tcReferencia, meses: [{ mes, uyu, usd, docs, tc, origen }] }
 *   origen: 'sistema' (documentos), 'historico' (VentasHistoricas) o null (sin datos).
 */
exports.getVentasMensuales = async (req, res) => {
    try {
        await tieneDcdArea();
        const pool = await getPool();
        const params = extractParams(req.query);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();
        const ambito = claveAmbito(params);

        const r = pool.request();
        bindFiltrosComunes(r, { ...params, fechaDesde: `${anio}-01-01`, fechaHasta: `${anio}-12-31` });
        const condAreas = condAreasIn(await areasDeFiltro(params), areaDesdeCodigo('dcd.OrdCodigoOrden'), r);
        const filtro = filtroAreaArticulo(condAreas, params.articulo, 'doc');
        const filtroDgi = condDgi('doc', params.dgi);

        const ventas = await r.query(`
            ${filtro.cte ? `;WITH ${filtro.cte}` : ''}
            -- Las notas de crédito restan en el mes en que se emiten; Docs cuenta solo ventas.
            SELECT MONTH(doc.DocFechaEmision) AS Mes, doc.MonIdMoneda,
                   SUM(doc.DocTotal * ${signoExpr('doc')} * ${filtro.peso}) AS Total,
                   SUM(CASE WHEN ${condEsNota('doc')} THEN 0 ELSE 1 END) AS Docs
            FROM dbo.DocumentosContables doc WITH(NOLOCK)
            ${filtro.join}
            WHERE ${condVentaONota('doc')}
              AND doc.DocEstado <> 'ANULADO'
              ${filtroDgi ? `AND ${filtroDgi}` : ''}
              AND doc.DocFechaEmision >= @fechaDesde AND doc.DocFechaEmision <= @fechaHasta
            GROUP BY MONTH(doc.DocFechaEmision), doc.MonIdMoneda
        `);

        // TC promedio de cada mes del año (y el último cargado, de referencia)
        const cot = await pool.request().input('anio', sql.Int, anio).query(`
            SELECT MONTH(CotFecha) AS Mes, AVG(CotDolar) AS Tc
            FROM dbo.Cotizaciones WITH(NOLOCK)
            WHERE YEAR(CotFecha) = @anio AND CotDolar > 0
            GROUP BY MONTH(CotFecha);
            SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) WHERE CotDolar > 0 ORDER BY CotFecha DESC;
        `);
        const tcMes = {};
        for (const x of cot.recordsets[0]) tcMes[x.Mes] = Number(x.Tc);
        const tcReferencia = Number(cot.recordsets[1][0]?.CotDolar) || null;

        const hist = await leerHistoricas(anio, ambito);

        const hoy = new Date();
        const meses = [];
        for (let m = 1; m <= 12; m++) {
            const filas = ventas.recordset.filter(x => x.Mes === m);
            const h = hist.filter(x => x.Mes === m);
            const fila = { mes: m, uyu: 0, usd: 0, docs: 0, tc: tcMes[m] ? Number(tcMes[m].toFixed(4)) : null, origen: null, sistemaUyu: 0, sistemaUsd: 0 };
            for (const x of filas) {
                if (x.MonIdMoneda === 2) fila.sistemaUsd += Number(x.Total || 0); else fila.sistemaUyu += Number(x.Total || 0);
                fila.docs += Number(x.Docs || 0);
            }
            // Si administración cargó el mes a mano, ese valor manda (los meses anteriores
            // al arranque del sistema pueden tener algún documento suelto, ej. abril-2026
            // con 1 documento). Lo que tiene el sistema se devuelve igual (sistemaUyu/Usd,
            // docs) para que la pantalla lo pueda mostrar.
            if (h.length) {
                for (const x of h) { if (x.Moneda === 'USD') fila.usd += Number(x.Monto || 0); else fila.uyu += Number(x.Monto || 0); }
                fila.origen = 'historico';
            } else if (filas.length) {
                fila.uyu = fila.sistemaUyu; fila.usd = fila.sistemaUsd;
                fila.origen = 'sistema';
            }
            fila.sistemaUyu = Number(fila.sistemaUyu.toFixed(2));
            fila.sistemaUsd = Number(fila.sistemaUsd.toFixed(2));
            fila.uyu = Number(fila.uyu.toFixed(2));
            fila.usd = Number(fila.usd.toFixed(2));
            meses.push(fila);
        }

        res.json({
            success: true,
            anio, ambito,
            mesEnCurso: anio === hoy.getFullYear() ? hoy.getMonth() + 1 : null,
            tcReferencia,
            historicasDisponibles: await tieneVentasHistoricas(),
            meses,
        });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getVentasMensuales:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/** GET /api/contabilidad/reportes/ventas-historicas?anio=2025&sector=|area= */
exports.getVentasHistoricas = async (req, res) => {
    try {
        const params = extractParams(req.query);
        const anio = parseInt(req.query.anio);
        if (!anio) return res.status(400).json({ success: false, error: 'Falta el parámetro anio' });
        res.json({ success: true, anio, ambito: claveAmbito(params), disponible: await tieneVentasHistoricas(), data: await leerHistoricas(anio, claveAmbito(params)) });
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] getVentasHistoricas:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * PUT /api/contabilidad/reportes/ventas-historicas
 * body { anio, sector?, area?, moneda: 'USD'|'UYU', meses: [{ mes: 1..12, monto: número | null }] }
 * monto null/vacío borra el mes. Solo Admin / Administracion (lo controla la ruta).
 */
exports.guardarVentasHistoricas = async (req, res) => {
    try {
        if (!(await tieneVentasHistoricas())) {
            return res.status(409).json({ success: false, error: 'Falta crear la tabla VentasHistoricas (scripts/add_ventas_historicas.sql).' });
        }
        const b = req.body || {};
        const anio = parseInt(b.anio);
        const moneda = String(b.moneda || 'USD').toUpperCase();
        if (!anio || anio < 2000 || anio > 2100) return res.status(400).json({ success: false, error: 'Año inválido' });
        if (!['USD', 'UYU'].includes(moneda)) return res.status(400).json({ success: false, error: 'Moneda inválida (USD o UYU)' });
        if (!Array.isArray(b.meses) || !b.meses.length) return res.status(400).json({ success: false, error: 'Faltan los meses' });
        const ambito = claveAmbito({ sector: b.sector || null, area: b.area || null });
        const usuario = String(req.user?.username || req.user?.name || req.user?.id || '').substring(0, 100);

        const pool = await getPool();
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            let guardados = 0, borrados = 0;
            for (const m of b.meses) {
                const mes = parseInt(m.mes);
                if (!(mes >= 1 && mes <= 12)) continue;
                const monto = (m.monto === null || m.monto === undefined || m.monto === '') ? null : Number(m.monto);
                if (monto !== null && !(monto >= 0)) return res.status(400).json({ success: false, error: `Monto inválido en el mes ${mes}` });
                const rq = new sql.Request(tx)
                    .input('anio', sql.Int, anio).input('mes', sql.Int, mes)
                    .input('ambito', sql.NVarChar(60), ambito).input('moneda', sql.Char(3), moneda);
                if (monto === null) {
                    const d = await rq.query(`DELETE FROM dbo.VentasHistoricas WHERE VhiAnio = @anio AND VhiMes = @mes AND VhiAmbito = @ambito AND VhiMoneda = @moneda`);
                    borrados += d.rowsAffected[0] || 0;
                } else {
                    await rq.input('monto', sql.Decimal(18, 2), monto).input('usuario', sql.NVarChar(100), usuario).query(`
                        MERGE dbo.VentasHistoricas AS t
                        USING (SELECT @anio AS A, @mes AS M, @ambito AS Am, @moneda AS Mo) AS s
                          ON t.VhiAnio = s.A AND t.VhiMes = s.M AND t.VhiAmbito = s.Am AND t.VhiMoneda = s.Mo
                        WHEN MATCHED THEN UPDATE SET VhiMonto = @monto, VhiUsuario = @usuario, VhiFechaCarga = GETDATE()
                        WHEN NOT MATCHED THEN INSERT (VhiAnio, VhiMes, VhiAmbito, VhiMoneda, VhiMonto, VhiUsuario, VhiFechaCarga)
                             VALUES (@anio, @mes, @ambito, @moneda, @monto, @usuario, GETDATE());`);
                    guardados++;
                }
            }
            await tx.commit();
            logger.info(`[CONTABILIDAD-REPORTES] Ventas históricas ${anio} '${ambito}' ${moneda}: ${guardados} guardados, ${borrados} borrados (${usuario})`);
            res.json({ success: true, guardados, borrados, data: await leerHistoricas(anio, ambito) });
        } catch (e) {
            try { await tx.rollback(); } catch { /* ya cerrada */ }
            throw e;
        }
    } catch (err) {
        logger.error('[CONTABILIDAD-REPORTES] guardarVentasHistoricas:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
