// =============================================================================
// Panel de Producción (Reportes de Contabilidad → Dashboard)
// GET /api/dashboard/produccion/panel?sector=&turno=&rango=
//
// Devuelve TODO lo que muestra el panel en una sola respuesta, ya filtrado por
// sector comercial, turno y rango. Cada bloque dice de dónde sale el dato:
//
//   - Sectores          : dbo.Sectores + dbo.SectorMapeo (área → sector) + ConfigMapeoERP (nombre ↔ AreaID)
//   - Órdenes activas   : dbo.Ordenes (estado actual, no depende del rango ni del turno)
//   - Prontas           : dbo.HistorialOrdenes Estado='Pronto' (primer "Pronto" de cada orden)
//   - Cumplimiento      : prontas con FechaInicio <= ISNULL(Ordenes.FechaCompromiso, Ordenes.FechaEstimadaEntrega)
//                         (mismo criterio que la Agenda de Planificación y el tablero de Bordado:
//                         FechaCompromiso es la promesa "real" simulando la cola de trabajo —hoy
//                         solo se calcula para Bordado vendido por el portal—, y para el resto de
//                         las órdenes queda NULL y cae en la FechaEstimadaEntrega fija de siempre)
//   - Fallas            : dbo.FallasProduccion + dbo.TiposFallas
//   - Máquinas          : dbo.ConfigEquipos (Estado / EstadoProceso actuales)
//   - Tiempos de entrega: dbo.ConfiguracionTiemposEntrega
//   - Tiempo de inactividad: SIN FUENTE todavía (se devuelve null)
// =============================================================================
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const safe = async (fn, fallback, label) => {
    try { return await fn(); }
    catch (e) { logger.error(`[PROD-PANEL] ${label}:`, e.message); return fallback; }
};

const META_CUMPLIMIENTO = 90; // % objetivo por defecto (editable desde "Configurar" → ConfiguracionGlobal)
const CLAVE_META = 'PANEL_PRODUCCION_META_CUMPLIMIENTO';

// Meta configurada en dbo.ConfiguracionGlobal (si no existe la clave, vale META_CUMPLIMIENTO)
const leerMeta = async (pool) => {
    try {
        const r = await pool.request().input('clave', sql.VarChar(50), CLAVE_META)
            .query(`SELECT TOP 1 Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = @clave`);
        const v = Number(String(r.recordset[0]?.Valor ?? '').replace(',', '.'));
        return v > 0 && v <= 100 ? v : META_CUMPLIMIENTO;
    } catch { return META_CUMPLIMIENTO; }
};

// Upsert de una clave en ConfiguracionGlobal. Misma técnica que cfeController.asegurarClaveConfigGlobal:
// la tabla tiene columnas NOT NULL que varían por instalación (AreaID → 'ADMIN' para claves globales).
const guardarClaveGlobal = async (pool, clave, valor) => {
    const existe = await pool.request().input('clave', sql.VarChar(50), clave)
        .query(`SELECT 1 AS x FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = @clave`);
    if (existe.recordset.length > 0) {
        await pool.request().input('clave', sql.VarChar(50), clave).input('valor', sql.NVarChar(100), String(valor))
            .query(`UPDATE dbo.ConfiguracionGlobal SET Valor = @valor WHERE Clave = @clave`);
        return;
    }
    const colsRes = await pool.request().query(`
        SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ConfiguracionGlobal'`);
    const nombres = ['[Clave]', '[Valor]'], valores = ['@clave', '@valor'];
    for (const c of colsRes.recordset) {
        if (c.COLUMN_NAME === 'Clave' || c.COLUMN_NAME === 'Valor') continue;
        if (c.IS_NULLABLE === 'NO' && c.COLUMN_DEFAULT == null) {
            const t = String(c.DATA_TYPE || '').toLowerCase();
            nombres.push(`[${c.COLUMN_NAME}]`);
            if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'bit'].includes(t)) valores.push('0');
            else if (t.includes('date') || t.includes('time')) valores.push('GETDATE()');
            else valores.push(c.COLUMN_NAME === 'AreaID' ? "'ADMIN'" : "''");
        }
    }
    await pool.request().input('clave', sql.VarChar(50), clave).input('valor', sql.NVarChar(100), String(valor))
        .query(`INSERT INTO dbo.ConfiguracionGlobal (${nombres.join(', ')}) VALUES (${valores.join(', ')})`);
};
const HORA_CORTE_TURNO  = 14; // Turno 1 = antes de las 14 h, Turno 2 = desde las 14 h (misma regla que analytics)

const ACTIVAS_WHERE = `o.Estado NOT IN ('Entregado', 'Finalizado', 'Cancelado', 'Anulado', 'Rechazado', 'Pronto')`;

// Definición acordada (7-sep-2026):
//   En cola     = órdenes activas con Estado 'Pendiente'.
//   En proceso  = órdenes con Estado general 'Produccion', menos las que están en tránsito (pedido 8-sep-2026).
//   En tránsito = órdenes activas con EstadoenArea 'En transito' (van dentro de "en proceso");
//                 su detalle sale del último envío: Ordenes → Logistica_Bultos → Logistica_EnvioItems → Logistica_Envios.
const estadoGeneral = o => String(o.Estado || '').trim().toUpperCase();
const esPendiente   = o => estadoGeneral(o) === 'PENDIENTE';
const esProduccion  = o => estadoGeneral(o) === 'PRODUCCION';

const magnitudExpr = (col = 'o.Magnitud') =>
    `ISNULL(TRY_CAST(REPLACE(REPLACE(${col}, ',', '.'), ' ', '') AS FLOAT), 0)`;

const turnoWhere = (turno, col) => {
    if (String(turno) === '1') return `AND DATEPART(HOUR, ${col}) < ${HORA_CORTE_TURNO}`;
    if (String(turno) === '2') return `AND DATEPART(HOUR, ${col}) >= ${HORA_CORTE_TURNO}`;
    return '';
};

// Reposición / falla: prioridad 'Reposición' o 'Falla', o código con sufijo -R# / -F#####
// (ej. 'EUV-19159-R1', 'SUB-20724 (1/2)-F33171'). OJO: las órdenes de falla se finalizan
// sin pasar por "Pronto", por eso "con falla" se cuenta desde FallasProduccion y no desde acá.
const REPO_SQL = `(UPPER(LTRIM(RTRIM(ISNULL(o.Prioridad,'')))) IN ('FALLA','REPOSICION','REPOSICIÓN')
                   OR o.CodigoOrden LIKE '%-R[0-9]%' OR o.CodigoOrden LIKE '%-F[0-9]%')`;

const round1 = n => Math.round(n * 10) / 10;
const pad2   = n => String(n).padStart(2, '0');
const lblDia = d => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
const inicioDia = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// ── Rango ─────────────────────────────────────────────────────────────────────
// Acepta fechas explícitas (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD, mismas que Ventas por Área)
// o un preset (?rango=hoy|7|30|mes). El período anterior tiene la misma cantidad de días.
const parseFecha = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const resolverRango = (rango, desdeStr, hastaStr) => {
    const hoy = inicioDia(new Date());
    const ahora = new Date();
    let desde, hasta;
    const dIn = parseFecha(desdeStr), hIn = parseFecha(hastaStr);
    if (dIn && hIn && hIn >= dIn) {
        desde = dIn;
        hasta = new Date(hIn); hasta.setHours(23, 59, 59, 999);
        if (hasta > ahora) hasta = ahora;
    } else {
        let dias;
        if (rango === '7')        dias = 7;
        else if (rango === '30')  dias = 30;
        else if (rango === 'mes') dias = ahora.getDate();
        else                      dias = 1; // 'hoy'
        desde = new Date(hoy); desde.setDate(hoy.getDate() - (dias - 1));
        hasta = ahora;
    }
    const dias = Math.max(1, Math.round((inicioDia(hasta) - inicioDia(desde)) / 86400000) + 1);
    const desdePrev = new Date(desde); desdePrev.setDate(desde.getDate() - dias);
    return { dias, desde, hasta, desdePrev, hastaPrev: desde, modo: dias === 1 ? 'hora' : 'dia' };
};

// ── Sectores: SecId → códigos de área (Ordenes.AreaID) ────────────────────────
const cargarSectores = async (pool) => {
    const [rs, rm, rc] = await Promise.all([
        pool.request().query(`SELECT SecId, SecNombre, SecOrden FROM dbo.Sectores WITH(NOLOCK) WHERE SecActivo = 1 ORDER BY SecOrden, SecNombre`),
        pool.request().query(`SELECT SmaClave, SecId FROM dbo.SectorMapeo WITH(NOLOCK) WHERE SmaActivo = 1 AND SmaTipo = 'AREA'`),
        pool.request().query(`SELECT AreaID_Interno, NombreReferencia FROM dbo.ConfigMapeoERP WITH(NOLOCK) WHERE AreaID_Interno IS NOT NULL`),
    ]);
    const nombreACodigo = {}, codigoANombre = {};
    for (const r of rc.recordset) {
        const cod = String(r.AreaID_Interno).trim(), nom = String(r.NombreReferencia || '').trim();
        if (!cod) continue;
        codigoANombre[cod] = nom || cod;
        if (nom) (nombreACodigo[nom] = nombreACodigo[nom] || []).push(cod);
    }
    const codigoASector = {};
    const sectores = rs.recordset.map(s => ({ id: s.SecId, nombre: s.SecNombre, areas: [], areasNombre: [] }));
    const porId = Object.fromEntries(sectores.map(s => [s.id, s]));
    for (const m of rm.recordset) {
        const sec = porId[m.SecId]; if (!sec) continue;
        sec.areasNombre.push(m.SmaClave);
        for (const cod of (nombreACodigo[m.SmaClave] || [])) { sec.areas.push(cod); codigoASector[cod] = m.SecId; }
    }
    // Áreas productivas para los chips de "VER POR → Áreas productivas"
    const areas = Object.keys(nombreACodigo).sort((a, b) => a.localeCompare(b, 'es')).map(nombre => ({ nombre, codigos: nombreACodigo[nombre] }));
    return { sectores, codigoASector, codigoANombre, nombreACodigo, areas };
};

// Lista SQL segura de códigos de área (solo alfanuméricos y guiones).
const listaSql = codes => codes.filter(c => /^[A-Za-z0-9_\-]+$/.test(c)).map(c => `'${c}'`).join(',');

// =============================================================================
exports.getPanel = async (req, res) => {
    try {
        const pool  = await getPool();
        const sectorId  = req.query.sector ? String(req.query.sector).trim() : '';
        const areaNom   = req.query.area ? String(req.query.area).trim() : '';   // NombreReferencia (ej. 'Sublimacion')
        const verPor    = req.query.verPor === 'area' ? 'area' : 'sector';       // cómo se agrupa el gráfico "por sector"
        const turno     = req.query.turno ? String(req.query.turno).trim() : '';
        const rango     = req.query.rango ? String(req.query.rango).trim() : 'hoy';
        const R = resolverRango(rango, req.query.desde, req.query.hasta);

        const [mapa, meta] = await Promise.all([
            safe(() => cargarSectores(pool), { sectores: [], codigoASector: {}, codigoANombre: {}, nombreACodigo: {}, areas: [] }, 'sectores'),
            leerMeta(pool),
        ]);
        const sectorSel = sectorId ? mapa.sectores.find(s => s.id === sectorId) : null;
        const areaSel   = !sectorSel && areaNom ? (mapa.areas.find(a => a.nombre === areaNom) || { nombre: areaNom, codigos: [] }) : null;

        // Filtro de área: por sector (todas sus áreas) o por un área productiva puntual.
        // Sector/área sin códigos mapeados → no matchea nada.
        let areaF = '';
        if (sectorSel)    areaF = sectorSel.areas.length  ? `AND o.AreaID IN (${listaSql(sectorSel.areas)})`  : 'AND 1 = 0';
        else if (areaSel) areaF = areaSel.codigos.length  ? `AND o.AreaID IN (${listaSql(areaSel.codigos)})` : 'AND 1 = 0';
        const areaFcol = col => areaF.replace('o.AreaID', col);

        const base = () => {
            const r = pool.request();
            r.input('desde',     sql.DateTime, R.desde);
            r.input('hasta',     sql.DateTime, R.hasta);
            r.input('desdePrev', sql.DateTime, R.desdePrev);
            const d14 = inicioDia(new Date()); d14.setDate(d14.getDate() - 13);
            r.input('desde14',   sql.DateTime, d14);
            return r;
        };

        // Primer "Pronto" de cada orden desde la fecha más vieja que necesitamos.
        const CTE_PRONTAS = (desdeParam) => `
            WITH p AS (
                SELECT h.OrdenID, MIN(h.FechaInicio) AS f
                FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                WHERE UPPER(LTRIM(RTRIM(h.Estado))) = 'PRONTO' AND h.FechaInicio >= ${desdeParam}
                GROUP BY h.OrdenID
            )`;

        const [
            resActivas, resTransito, resKpis, resSerie, resDaily, resPorArea, resTop, resDepKpi, resDepDet, resFallasDet, resRepos, resFallaOrdMetros, resFallas, resMaquinas, resEntrega,
        ] = await Promise.all([

            // 1. Órdenes activas (estado actual) — sirve para en proceso / en cola / en tránsito y el modal
            safe(() => base().query(`
                SELECT TOP 1000
                    o.OrdenID, o.CodigoOrden, o.DescripcionTrabajo, o.Cliente, o.AreaID, o.MaquinaID, o.Estado,
                    ISNULL(LTRIM(RTRIM(o.EstadoenArea)), o.Estado) AS EstadoenArea, o.Prioridad,
                    ${magnitudExpr()} AS metros, LTRIM(RTRIM(ISNULL(o.UM, ''))) AS um
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE ${ACTIVAS_WHERE} AND ISNULL(LTRIM(RTRIM(o.EstadoenArea)), '') <> 'Pronto' ${areaF}
                ORDER BY o.FechaIngreso
            `), { recordset: [] }, 'activas'),

            // 1b. Órdenes en tránsito con su último envío (remito, origen, destino, estado del envío)
            safe(() => base().query(`
                SELECT o.OrdenID, o.CodigoOrden, o.DescripcionTrabajo, o.Cliente, o.AreaID, o.Prioridad,
                       ${magnitudExpr()} AS metros, LTRIM(RTRIM(ISNULL(o.UM, ''))) AS um,
                       x.CodigoRemito, x.AreaOrigenID, x.AreaDestinoID, x.EstadoEnvio, x.FechaSalida, x.FechaLlegada, x.CodigoEtiqueta, x.EstadoBulto
                FROM dbo.Ordenes o WITH(NOLOCK)
                OUTER APPLY (
                    SELECT TOP 1 e.CodigoRemito, e.AreaOrigenID, e.AreaDestinoID, e.Estado AS EstadoEnvio, e.FechaSalida, e.FechaLlegada,
                                 b.CodigoEtiqueta, b.Estado AS EstadoBulto
                    FROM dbo.Logistica_Bultos b WITH(NOLOCK)
                    JOIN dbo.Logistica_EnvioItems ei WITH(NOLOCK) ON ei.BultoID = b.BultoID
                    JOIN dbo.Logistica_Envios e WITH(NOLOCK) ON e.EnvioID = ei.EnvioID
                    WHERE b.OrdenID = o.OrdenID
                    ORDER BY e.EnvioID DESC
                ) x
                WHERE ${ACTIVAS_WHERE} AND LTRIM(RTRIM(ISNULL(o.EstadoenArea, ''))) = 'En transito' ${areaF}
                ORDER BY x.FechaSalida DESC, o.OrdenID
            `), { recordset: [] }, 'transito'),

            // 2. KPIs del período y del período anterior (prontas)
            safe(() => base().query(`
                ${CTE_PRONTAS('@desdePrev')}
                SELECT CASE WHEN p.f >= @desde THEN 'cur' ELSE 'prev' END AS per,
                       COUNT(*)                                                          AS n,
                       SUM(CASE WHEN ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega) IS NOT NULL AND p.f <= ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega) THEN 1 ELSE 0 END) AS enTiempo,
                       SUM(CASE WHEN ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega) IS NOT NULL THEN 1 ELSE 0 END)                                                          AS conFecha,
                       SUM(${magnitudExpr()})                                            AS metros,
                       SUM(CASE WHEN ${REPO_SQL} THEN 1 ELSE 0 END)                       AS reposiciones,
                       SUM(CASE WHEN ${REPO_SQL} THEN ${magnitudExpr()} ELSE 0 END)       AS metrosRepo,
                       MAX(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMax, MIN(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMin,
                       MAX(CASE WHEN ${REPO_SQL} THEN LTRIM(RTRIM(ISNULL(o.UM,''))) END) AS umRepoMax,
                       MIN(CASE WHEN ${REPO_SQL} THEN LTRIM(RTRIM(ISNULL(o.UM,''))) END) AS umRepoMin
                FROM p JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = p.OrdenID
                WHERE p.f <= @hasta ${areaF} ${turnoWhere(turno, 'p.f')}
                GROUP BY CASE WHEN p.f >= @desde THEN 'cur' ELSE 'prev' END
            `), { recordset: [] }, 'kpis'),

            // 3. Serie de cumplimiento (por hora si el rango es "hoy", por día si no)
            safe(() => base().query(`
                ${CTE_PRONTAS('@desde')}
                SELECT ${R.modo === 'hora' ? 'DATEPART(HOUR, p.f)' : 'CAST(p.f AS DATE)'} AS k,
                       COUNT(*) AS n,
                       SUM(CASE WHEN o.FechaEstimadaEntrega IS NOT NULL AND p.f <= o.FechaEstimadaEntrega THEN 1 ELSE 0 END) AS enTiempo,
                       SUM(CASE WHEN o.FechaEstimadaEntrega IS NOT NULL THEN 1 ELSE 0 END) AS conFecha
                FROM p JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = p.OrdenID
                WHERE p.f <= @hasta ${areaF} ${turnoWhere(turno, 'p.f')}
                GROUP BY ${R.modo === 'hora' ? 'DATEPART(HOUR, p.f)' : 'CAST(p.f AS DATE)'}
                ORDER BY k
            `), { recordset: [] }, 'serie'),

            // 4. Producción diaria últimos 14 días (no depende del rango; sí del sector y turno)
            safe(() => base().query(`
                ${CTE_PRONTAS('@desde14')}
                SELECT CAST(p.f AS DATE) AS d, COUNT(*) AS n, SUM(${magnitudExpr()}) AS metros,
                       SUM(CASE WHEN ${REPO_SQL} THEN 1 ELSE 0 END) AS repo
                FROM p JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = p.OrdenID
                WHERE p.f <= @hasta ${areaF} ${turnoWhere(turno, 'p.f')}
                GROUP BY CAST(p.f AS DATE)
                ORDER BY d
            `), { recordset: [] }, 'daily'),

            // 5. Producción por área en el período (TODAS las áreas, para el gráfico por sector)
            //    Mismo criterio que el top 10 (8-sep-2026): solo órdenes en Estado general 'Finalizado',
            //    ubicadas en el período por su primer "Pronto".
            safe(() => base().query(`
                ${CTE_PRONTAS('@desde')}
                SELECT o.AreaID, COUNT(*) AS n, SUM(${magnitudExpr()}) AS metros,
                       MAX(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMax, MIN(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMin
                FROM p JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = p.OrdenID
                WHERE p.f <= @hasta AND UPPER(LTRIM(RTRIM(o.Estado))) = 'FINALIZADO' ${turnoWhere(turno, 'p.f')}
                GROUP BY o.AreaID
            `), { recordset: [] }, 'porArea'),

            // 6. Materiales producidos en el período (todos; el top 10 por órdenes y por volumen se arma en JS)
            //    Pedido 8-sep-2026: SOLO órdenes con Estado general 'Finalizado'. Como no hay fecha de
            //    finalización confiable (HistorialOrdenes casi no registra 'Finalizado'), la orden se ubica
            //    en el período por su primer "Pronto". Quedan afuera canceladas, en producción y órdenes de falla.
            safe(() => base().query(`
                ${CTE_PRONTAS('@desde')}
                SELECT LTRIM(RTRIM(o.Material)) AS producto, COUNT(*) AS n, SUM(${magnitudExpr()}) AS metros,
                       MAX(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMax, MIN(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMin
                FROM p JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = p.OrdenID
                WHERE p.f <= @hasta AND o.Material IS NOT NULL AND LTRIM(RTRIM(o.Material)) <> ''
                      AND UPPER(LTRIM(RTRIM(o.Estado))) = 'FINALIZADO'
                      ${areaF} ${turnoWhere(turno, 'p.f')}
                GROUP BY LTRIM(RTRIM(o.Material))
            `), { recordset: [] }, 'top'),

            // 6b. Órdenes que ENTRARON A DEPÓSITO en el período (y en el anterior): envíos de Logística con
            //     destino DEPOSITO y fecha de llegada dentro del rango; una orden cuenta una vez (primera llegada).
            safe(() => base().query(`
                WITH ll AS (
                    SELECT b.OrdenID, MIN(e.FechaLlegada) AS f
                    FROM dbo.Logistica_Envios e WITH(NOLOCK)
                    JOIN dbo.Logistica_EnvioItems ei WITH(NOLOCK) ON ei.EnvioID = e.EnvioID
                    JOIN dbo.Logistica_Bultos b WITH(NOLOCK) ON b.BultoID = ei.BultoID
                    WHERE e.AreaDestinoID = 'DEPOSITO' AND e.FechaLlegada IS NOT NULL
                      AND e.FechaLlegada >= @desdePrev AND e.FechaLlegada <= @hasta AND b.OrdenID IS NOT NULL
                    GROUP BY b.OrdenID
                )
                SELECT CASE WHEN ll.f >= @desde THEN 'cur' ELSE 'prev' END AS per,
                       COUNT(*) AS n, SUM(${magnitudExpr()}) AS metros,
                       MAX(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMax, MIN(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMin
                FROM ll JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = ll.OrdenID
                WHERE 1 = 1 ${areaF} ${turnoWhere(turno, 'll.f')}
                GROUP BY CASE WHEN ll.f >= @desde THEN 'cur' ELSE 'prev' END
            `), { recordset: [] }, 'depositoKpi'),

            // 6c. Detalle de esas órdenes (período actual) con remito, origen y hora de llegada
            safe(() => base().query(`
                WITH ll AS (
                    SELECT b.OrdenID, MIN(e.EnvioID) AS EnvioID, MIN(e.FechaLlegada) AS f
                    FROM dbo.Logistica_Envios e WITH(NOLOCK)
                    JOIN dbo.Logistica_EnvioItems ei WITH(NOLOCK) ON ei.EnvioID = e.EnvioID
                    JOIN dbo.Logistica_Bultos b WITH(NOLOCK) ON b.BultoID = ei.BultoID
                    WHERE e.AreaDestinoID = 'DEPOSITO' AND e.FechaLlegada IS NOT NULL
                      AND e.FechaLlegada >= @desde AND e.FechaLlegada <= @hasta AND b.OrdenID IS NOT NULL
                    GROUP BY b.OrdenID
                )
                SELECT TOP 1000 o.OrdenID, o.CodigoOrden, o.DescripcionTrabajo, o.Cliente, o.AreaID, o.Prioridad, o.Estado, o.EstadoenArea,
                       ${magnitudExpr()} AS metros, LTRIM(RTRIM(ISNULL(o.UM, ''))) AS um,
                       ll.f AS FechaLlegada, e.CodigoRemito, e.AreaOrigenID, e.AreaDestinoID, e.Estado AS EstadoEnvio, e.FechaSalida
                FROM ll
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = ll.OrdenID
                LEFT JOIN dbo.Logistica_Envios e WITH(NOLOCK) ON e.EnvioID = ll.EnvioID
                WHERE 1 = 1 ${areaF} ${turnoWhere(turno, 'll.f')}
                ORDER BY ll.f DESC
            `), { recordset: [] }, 'depositoDetalle'),

            // 7a. Detalle de las fallas reportadas en el período (para el modal de la tarjeta)
            safe(() => base().query(`
                SELECT TOP 500 f.FallaID, f.FechaFalla, f.AreaID, f.Observaciones, f.CantidadFalla, f.CopiasFalla, f.ImagenFalla,
                       ISNULL(tf.Titulo, 'Sin tipo') AS tipo, ce.Nombre AS equipo,
                       o.OrdenID, o.CodigoOrden, o.DescripcionTrabajo, o.Cliente, o.Estado, o.EstadoenArea, o.Prioridad
                FROM dbo.FallasProduccion f WITH(NOLOCK)
                LEFT JOIN dbo.TiposFallas tf WITH(NOLOCK) ON tf.FallaID = TRY_CAST(f.TipoFalla AS INT)
                LEFT JOIN dbo.ConfigEquipos ce WITH(NOLOCK) ON ce.EquipoID = f.EquipoID
                LEFT JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = f.OrdenID
                WHERE f.FechaFalla >= @desde AND f.FechaFalla <= @hasta
                      ${areaFcol('f.AreaID')} ${turnoWhere(turno, 'f.FechaFalla')}
                ORDER BY f.FechaFalla DESC
            `), { recordset: [] }, 'fallasDetalle'),

            // 7b. Reposiciones y órdenes de falla INGRESADAS en el período (código -R# / -F##### o prioridad Falla/Reposición)
            safe(() => base().query(`
                SELECT TOP 500 o.OrdenID, o.CodigoOrden, o.DescripcionTrabajo, o.Cliente, o.AreaID, o.Prioridad, o.Estado, o.EstadoenArea,
                       o.FechaIngreso, ${magnitudExpr()} AS metros, LTRIM(RTRIM(ISNULL(o.UM, ''))) AS um
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.FechaIngreso >= @desde AND o.FechaIngreso <= @hasta AND ${REPO_SQL}
                      ${areaF} ${turnoWhere(turno, 'o.FechaIngreso')}
                ORDER BY o.FechaIngreso DESC
            `), { recordset: [] }, 'reposiciones'),

            // 6d. Volumen de "con falla reportada": una orden con 2 tipos de falla distintos no debe
            //     duplicar su magnitud (por eso se deduplica por OrdenID antes de sumar, a diferencia
            //     de fallasPorTipo que sí puede repetir una orden si falló con más de un tipo).
            safe(() => base().query(`
                WITH fo AS (
                    SELECT CASE WHEN f.FechaFalla >= @desde THEN 'cur' ELSE 'prev' END AS per, f.OrdenID
                    FROM dbo.FallasProduccion f WITH(NOLOCK)
                    WHERE f.FechaFalla >= @desdePrev AND f.FechaFalla <= @hasta
                          ${areaFcol('f.AreaID')} ${turnoWhere(turno, 'f.FechaFalla')}
                    GROUP BY CASE WHEN f.FechaFalla >= @desde THEN 'cur' ELSE 'prev' END, f.OrdenID
                )
                SELECT fo.per, SUM(${magnitudExpr()}) AS metros,
                       MAX(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMax, MIN(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMin
                FROM fo JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = fo.OrdenID
                GROUP BY fo.per
            `), { recordset: [] }, 'fallaOrdMetros'),

            // 7. Fallas reportadas por tipo (período y período anterior)
            //    n = fallas registradas (eventos), ordenes = órdenes distintas afectadas,
            //    metros = suma de la Magnitud de esas órdenes distintas (volumen afectado), con su unidad.
            safe(() => base().query(`
                WITH fx AS (
                    SELECT CASE WHEN f.FechaFalla >= @desde THEN 'cur' ELSE 'prev' END AS per,
                           ISNULL(tf.Titulo, 'Sin tipo') AS tipo, f.FallaID, f.OrdenID
                    FROM dbo.FallasProduccion f WITH(NOLOCK)
                    LEFT JOIN dbo.TiposFallas tf WITH(NOLOCK) ON tf.FallaID = TRY_CAST(f.TipoFalla AS INT)
                    WHERE f.FechaFalla >= @desdePrev AND f.FechaFalla <= @hasta
                          ${areaFcol('f.AreaID')} ${turnoWhere(turno, 'f.FechaFalla')}
                ),
                fo AS (SELECT per, tipo, OrdenID FROM fx GROUP BY per, tipo, OrdenID)
                SELECT x.per, x.tipo, x.n, x.ordenes, ISNULL(m.metros, 0) AS metros, m.umMax, m.umMin
                FROM (SELECT per, tipo, COUNT(*) AS n, COUNT(DISTINCT OrdenID) AS ordenes FROM fx GROUP BY per, tipo) x
                LEFT JOIN (
                    SELECT fo.per, fo.tipo, SUM(${magnitudExpr()}) AS metros,
                           MAX(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMax, MIN(LTRIM(RTRIM(ISNULL(o.UM,'')))) AS umMin
                    FROM fo JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = fo.OrdenID
                    GROUP BY fo.per, fo.tipo
                ) m ON m.per = x.per AND m.tipo = x.tipo
                ORDER BY x.n DESC
            `), { recordset: [] }, 'fallas'),

            // 8. Máquinas (estado actual)
            safe(() => base().query(`
                SELECT ce.EquipoID, ce.AreaID, ce.Nombre, ce.Estado, ce.EstadoProceso
                FROM dbo.ConfigEquipos ce WITH(NOLOCK)
                WHERE ce.Activo = 1 ${areaFcol('ce.AreaID')}
                ORDER BY ce.AreaID, ce.Nombre
            `), { recordset: [] }, 'maquinas'),

            // 9. Tiempos de entrega configurados
            safe(() => base().query(`
                SELECT t.AreaID, t.Prioridad, t.Horas, t.Dias, t.Texto
                FROM dbo.ConfiguracionTiemposEntrega t WITH(NOLOCK)
                WHERE 1 = 1 ${areaFcol('t.AreaID')}
                ORDER BY t.AreaID, t.Prioridad
            `), { recordset: [] }, 'entrega'),
        ]);

        // ── Activas → en proceso / en cola / en tránsito ─────────────────────
        const fmtOrden = o => ({
            id: (o.CodigoOrden || `#${o.OrdenID}`).trim(),
            ordenId: o.OrdenID,
            trabajo: (o.DescripcionTrabajo || '').trim(),
            cliente: (o.Cliente || '').trim(),
            estado: o.EstadoenArea,
            area: mapa.codigoANombre[o.AreaID] || o.AreaID,
            sector: mapa.codigoASector[o.AreaID] || null,
            prioridad: o.Prioridad,
            metros: Number(o.metros || 0),
            um: o.um || '',
        });
        const activas    = resActivas.recordset.map(o => ({ ...fmtOrden(o), estadoGeneral: String(o.Estado || '').trim(), pendiente: esPendiente(o), produccion: esProduccion(o) }));
        const enCola     = activas.filter(o => o.pendiente);
        // En proceso = Estado 'Produccion' SIN las que están en tránsito (pedido 8-sep-2026)
        const enProceso  = activas.filter(o => o.produccion && o.estado !== 'En transito');
        const sumM = l => Math.round(l.reduce((s, o) => s + o.metros, 0) * 100) / 100;
        const nombreUbic = cod => { const c = String(cod || '').trim(); return mapa.codigoANombre[c] || c || '—'; };
        const enTransito = resTransito.recordset.map(o => ({
            ...fmtOrden(o),
            estado: 'En transito',
            remito: o.CodigoRemito || null,
            origen: nombreUbic(o.AreaOrigenID),
            destino: nombreUbic(o.AreaDestinoID),
            estadoEnvio: o.EstadoEnvio || (o.CodigoRemito ? '' : 'Sin envío asociado'),
            salida: o.FechaSalida || null,
            llegada: o.FechaLlegada || null,
            bulto: o.CodigoEtiqueta || null,
            estadoBulto: o.EstadoBulto || null,
        }));

        // órdenes "En Maquina" por equipo (para el panel de máquinas)
        const ordenesPorMaquina = {};
        for (const o of resActivas.recordset) {
            if (o.MaquinaID && o.EstadoenArea === 'En Maquina') ordenesPorMaquina[o.MaquinaID] = (ordenesPorMaquina[o.MaquinaID] || 0) + 1;
        }

        // ── KPIs período ─────────────────────────────────────────────────────
        const kp = Object.fromEntries(resKpis.recordset.map(r => [r.per, r]));
        const cur = kp.cur || {}, prev = kp.prev || {};
        const pct = (a, b) => (b > 0 ? round1(a / b * 100) : null);
        const umUnica = cur.umMax && cur.umMax === cur.umMin ? cur.umMax : (cur.n ? 'mixta' : '');

        const kpis = {
            cumplimiento:     pct(cur.enTiempo || 0, cur.conFecha || 0),
            cumplimientoPrev: pct(prev.enTiempo || 0, prev.conFecha || 0),
            prontasConFecha:  cur.conFecha || 0,
            prontas:          cur.n || 0,
            prontasPrev:      prev.n || 0,
            metros:           Math.round((cur.metros || 0) * 100) / 100,
            um:               umUnica,
            reposiciones:     cur.reposiciones || 0,
            enProceso:        enProceso.length,  metrosProceso:  sumM(enProceso),
            enCola:           enCola.length,     metrosCola:     sumM(enCola),
            enTransito:       enTransito.length, metrosTransito: sumM(enTransito),
            fallas:           resFallas.recordset.filter(r => r.per === 'cur').reduce((s, r) => s + r.n, 0),
            fallasPrev:       resFallas.recordset.filter(r => r.per === 'prev').reduce((s, r) => s + r.n, 0),
            fallasOrdenes:    resFallas.recordset.filter(r => r.per === 'cur').reduce((s, r) => s + r.ordenes, 0),
            inactividadMin:   null, // sin fuente de datos todavía
        };
        // "Con falla" = órdenes distintas con falla reportada en el período (FallasProduccion)
        kpis.conFalla = kpis.fallasOrdenes;

        // Volumen de "con falla reportada" (deduplicado por orden, ver query 6d) y de "reposiciones
        // prontas" (subconjunto de cur, ver query 2) — para medir la Tasa de defectos por Volumen.
        const faM = Object.fromEntries(resFallaOrdMetros.recordset.map(r => [r.per, r]));
        const faCur = faM.cur || {};
        kpis.conFallaMetros     = Math.round((faCur.metros || 0) * 100) / 100;
        kpis.conFallaUm         = faCur.umMax && faCur.umMax === faCur.umMin ? faCur.umMax : ((faCur.umMax || faCur.umMin) ? 'mixta' : '');
        kpis.reposicionesMetros = Math.round((cur.metrosRepo || 0) * 100) / 100;
        kpis.reposicionesUm     = cur.umRepoMax && cur.umRepoMax === cur.umRepoMin ? cur.umRepoMax : ((cur.umRepoMax || cur.umRepoMin) ? 'mixta' : '');

        // Ingresadas a depósito (tarjeta "Total ingresado a depósito")
        const dk = Object.fromEntries(resDepKpi.recordset.map(r => [r.per, r]));
        const dCur = dk.cur || {}, dPrev = dk.prev || {};
        kpis.deposito       = dCur.n || 0;
        kpis.depositoPrev   = dPrev.n || 0;
        kpis.depositoMetros = Math.round((dCur.metros || 0) * 100) / 100;
        kpis.depositoUm     = dCur.umMax && dCur.umMax === dCur.umMin ? dCur.umMax : (dCur.n ? 'mixta' : '');

        // ── Serie de cumplimiento ────────────────────────────────────────────
        let serie;
        if (R.modo === 'hora') {
            const porHora = Object.fromEntries(resSerie.recordset.map(r => [Number(r.k), r]));
            const hIni = turno === '2' ? HORA_CORTE_TURNO : 6, hFin = turno === '1' ? HORA_CORTE_TURNO - 1 : 22;
            serie = { modo: 'hora', puntos: [] };
            for (let h = hIni; h <= hFin; h++) {
                const r = porHora[h];
                serie.puntos.push({ label: `${pad2(h)}:00`, valor: r ? pct(r.enTiempo, r.conFecha) : null, n: r ? r.n : 0 });
            }
        } else {
            const porDia = {};
            for (const r of resSerie.recordset) porDia[new Date(r.k).toISOString().slice(0, 10)] = r;
            serie = { modo: 'dia', puntos: [] };
            for (let i = R.dias - 1; i >= 0; i--) {
                const d = new Date(); d.setDate(d.getDate() - i);
                const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
                const r = porDia[key];
                serie.puntos.push({ label: lblDia(d), valor: r ? pct(r.enTiempo, r.conFecha) : null, n: r ? r.n : 0 });
            }
        }

        // ── Producción diaria (14 días) ──────────────────────────────────────
        const porDia14 = {};
        for (const r of resDaily.recordset) porDia14[new Date(r.d).toISOString().slice(0, 10)] = r;
        const daily = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
            const r = porDia14[key] || {};
            daily.push({ label: lblDia(d), unidades: r.n || 0, metros: Math.round((r.metros || 0) * 100) / 100, repo: r.repo || 0, hoy: i === 0 });
        }

        // ── Por sector o por área (según VER POR) ────────────────────────────
        const porSectorMap = {};
        for (const r of resPorArea.recordset) {
            let key, nombre;
            if (verPor === 'area') {
                nombre = mapa.codigoANombre[r.AreaID] || r.AreaID;
                key = 'A:' + nombre;
            } else {
                const secId = mapa.codigoASector[r.AreaID];
                key = secId ? 'S:' + secId : 'SIN_SECTOR';
                nombre = secId ? mapa.sectores.find(s => s.id === secId).nombre : `Sin sector (${mapa.codigoANombre[r.AreaID] || r.AreaID})`;
            }
            const x = porSectorMap[key] = porSectorMap[key] || { id: key, sector: nombre, unidades: 0, metros: 0, ums: new Set() };
            x.unidades += r.n; x.metros += Number(r.metros || 0);
            if (r.umMax) x.ums.add(r.umMax); if (r.umMin) x.ums.add(r.umMin);
        }
        const porSector = Object.values(porSectorMap).sort((a, b) => b.unidades - a.unidades)
            .map(({ ums, ...x }) => ({ ...x, metros: Math.round(x.metros * 100) / 100, um: ums.size === 1 ? [...ums][0] : (ums.size ? 'mixta' : '') }));

        // ── Fallas por tipo (período actual) ─────────────────────────────────
        const fallasPorTipo = resFallas.recordset.filter(r => r.per === 'cur')
            .map(r => ({ tipo: r.tipo, cantidad: r.n, ordenes: r.ordenes, metros: Math.round((r.metros || 0) * 100) / 100,
                         um: r.umMax && r.umMax === r.umMin ? r.umMax : (r.umMax || r.umMin ? 'mixta' : '') }))
            .sort((a, b) => b.cantidad - a.cantidad);

        // ── Máquinas ─────────────────────────────────────────────────────────
        // Estado real: ConfigEquipos.Estado vale 'DISPONIBLE' u 'OK' cuando la máquina está sana;
        // EstadoProceso ('Detenido', 'Imprimiendo', ...) no siempre se mantiene al día, así que
        // una máquina se considera ACTIVA si tiene órdenes "En Maquina" o un proceso en curso.
        const maquinas = resMaquinas.recordset.map(m => {
            const estado = String(m.Estado || '').trim().toUpperCase();
            const proceso = String(m.EstadoProceso || '').trim();
            const detenida = !proceso || /^DETENID/i.test(proceso);
            const sana = !estado || estado === 'DISPONIBLE' || estado === 'OK';
            const enMaquina = ordenesPorMaquina[m.EquipoID] || 0;
            const activa = sana && (enMaquina > 0 || !detenida);
            return {
                id: m.EquipoID,
                n: String(m.Nombre || '').trim(),
                area: mapa.codigoANombre[m.AreaID] || m.AreaID,
                sector: mapa.codigoASector[m.AreaID] || null,
                activa,
                motivo: !sana ? String(m.Estado).trim() : (activa ? '' : 'Detenida · sin órdenes en máquina'),
                proceso,
                ordenesEnMaquina: enMaquina,
            };
        });

        // ── Materiales (para los dos rankings del top 10) ────────────────────
        const materiales = resTop.recordset.map(r => ({
            producto: r.producto,
            unidades: r.n,
            metros: Math.round((r.metros || 0) * 100) / 100,
            um: r.umMax && r.umMax === r.umMin ? r.umMax : (r.umMax || r.umMin ? 'mixta' : ''),
        }));

        // ── Tiempos de entrega ───────────────────────────────────────────────
        const entrega = resEntrega.recordset.map(t => ({
            area: mapa.codigoANombre[t.AreaID] || t.AreaID,
            prioridad: t.Prioridad,
            texto: t.Texto || (t.Horas ? `${t.Horas} h` : t.Dias ? `${t.Dias} d` : '—'),
        }));

        res.json({
            success: true,
            generadoEn: new Date(),
            meta,
            horaCorteTurno: HORA_CORTE_TURNO,
            periodo: { rango, dias: R.dias, desde: R.desde, hasta: R.hasta, modo: R.modo },
            sectores: mapa.sectores.map(s => ({ id: s.id, nombre: s.nombre, areas: s.areasNombre })),
            areas: mapa.areas.map(a => ({ nombre: a.nombre })),
            verPor,
            sector: sectorSel ? { id: sectorSel.id, nombre: sectorSel.nombre, areas: sectorSel.areasNombre } : null,
            area: areaSel ? { nombre: areaSel.nombre } : null,
            kpis,
            serie,
            daily,
            fallasPorTipo,
            maquinas,
            porSector,
            // Ranking por cantidad de órdenes y ranking por volumen (suma de Magnitud, con su unidad)
            topProductos:        materiales.slice().sort((a, b) => b.unidades - a.unidades).slice(0, 10),
            topProductosVolumen: materiales.slice().sort((a, b) => b.metros - a.metros).slice(0, 10),
            ordenesProceso: enProceso,
            ordenesCola: enCola,
            ordenesTransito: enTransito,
            ordenesDeposito: resDepDet.recordset.map(o => ({
                ...fmtOrden(o),
                estado: o.EstadoenArea || o.Estado || '',
                estadoGeneral: String(o.Estado || '').trim(),
                remito: o.CodigoRemito || null,
                origen: nombreUbic(o.AreaOrigenID),
                destino: nombreUbic(o.AreaDestinoID),
                estadoEnvio: o.EstadoEnvio || '',
                salida: o.FechaSalida || null,
                llegada: o.FechaLlegada || null,
            })),
            fallasDetalle: resFallasDet.recordset.map(f => ({
                id: f.FallaID,
                fecha: f.FechaFalla,
                area: mapa.codigoANombre[String(f.AreaID || '').trim()] || f.AreaID,
                tipo: f.tipo,
                equipo: f.equipo || null,
                observaciones: (f.Observaciones || '').trim(),
                cantidad: f.CantidadFalla,
                copias: f.CopiasFalla,
                imagen: f.ImagenFalla || null,
                ordenId: f.OrdenID,
                orden: (f.CodigoOrden || (f.OrdenID ? `#${f.OrdenID}` : '')).trim(),
                trabajo: (f.DescripcionTrabajo || '').trim(),
                cliente: (f.Cliente || '').trim(),
                estadoOrden: f.EstadoenArea || f.Estado || '',
            })),
            reposiciones: resRepos.recordset.map(o => ({
                ...fmtOrden(o),
                estadoGeneral: String(o.Estado || '').trim(),
                ingreso: o.FechaIngreso,
                tipo: /-F[0-9]/.test(String(o.CodigoOrden || '')) || /^FALLA$/i.test(String(o.Prioridad || '').trim()) ? 'Falla' : 'Reposición',
                origen: String(o.CodigoOrden || '').replace(/-[RF][0-9]+.*$/, '').trim(), // código de la orden original
            })),
            fallasTotales: resFallasDet.recordset.length,
            entrega,
        });
    } catch (err) {
        logger.error('[PROD-PANEL] getPanel:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// =============================================================================
// Configuración del panel (botón "Configurar")
//   GET /api/dashboard/produccion/panel/config → meta, tipos de falla por área, tiempos de entrega, áreas
//   PUT /api/dashboard/produccion/panel/config { meta } → guarda la meta en ConfiguracionGlobal
// Los tipos de falla se agregan con el endpoint existente POST /api/failures/titles y los
// tiempos de entrega se editan con /api/delivery-times (mismo modal que Configuración).
// =============================================================================
exports.getPanelConfig = async (req, res) => {
    try {
        const pool = await getPool();
        const [mapa, meta, resTipos, resEntrega] = await Promise.all([
            safe(() => cargarSectores(pool), { sectores: [], codigoASector: {}, codigoANombre: {}, nombreACodigo: {}, areas: [] }, 'sectores'),
            leerMeta(pool),
            safe(() => pool.request().query(`SELECT FallaID, AreaID, Titulo, EsFrecuente FROM dbo.TiposFallas WITH(NOLOCK) ORDER BY AreaID, EsFrecuente DESC, Titulo`), { recordset: [] }, 'tiposFalla'),
            safe(() => pool.request().query(`SELECT ConfigID, AreaID, Prioridad, Horas, Dias, Texto FROM dbo.ConfiguracionTiemposEntrega WITH(NOLOCK) ORDER BY AreaID, Prioridad`), { recordset: [] }, 'entrega'),
        ]);
        const nombreArea = cod => mapa.codigoANombre[String(cod || '').trim()] || String(cod || '').trim();
        res.json({
            success: true,
            meta,
            metaDefault: META_CUMPLIMIENTO,
            clave: CLAVE_META,
            horaCorteTurno: HORA_CORTE_TURNO,
            // Áreas productivas con su código interno (para dar de alta tipos de falla)
            areas: Object.entries(mapa.codigoANombre).map(([code, nombre]) => ({ code, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
            tiposFalla: resTipos.recordset.map(t => ({ id: t.FallaID, areaCode: String(t.AreaID || '').trim(), area: nombreArea(t.AreaID), titulo: t.Titulo, frecuente: !!t.EsFrecuente })),
            entrega: resEntrega.recordset.map(t => ({
                id: t.ConfigID, areaCode: String(t.AreaID || '').trim(), area: nombreArea(t.AreaID), prioridad: t.Prioridad,
                horas: t.Horas, dias: t.Dias, texto: t.Texto,
                resumen: t.Texto || (t.Horas ? `${t.Horas} h` : t.Dias ? `${t.Dias} d` : '—'),
            })),
        });
    } catch (err) {
        logger.error('[PROD-PANEL] getPanelConfig:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.putPanelConfig = async (req, res) => {
    try {
        const meta = Number(String(req.body?.meta ?? '').replace(',', '.'));
        if (!(meta > 0 && meta <= 100)) return res.status(400).json({ success: false, message: 'La meta de cumplimiento debe ser un porcentaje entre 1 y 100.' });
        const pool = await getPool();
        await guardarClaveGlobal(pool, CLAVE_META, Math.round(meta * 10) / 10);
        res.json({ success: true, meta: Math.round(meta * 10) / 10 });
    } catch (err) {
        logger.error('[PROD-PANEL] putPanelConfig:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};
