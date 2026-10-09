'use strict';

/**
 * reportesOrdenesController.js
 * ────────────────────────────────────────────────────────────────────────────
 * Dos reportes de ÓRDENES para Reportes de Contabilidad (pedido 08-oct-2026):
 *
 *   GET /reportes/ordenes-retiradas-sin-pago?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *       Órdenes ENTREGADAS (OrdenesDeposito estado 9) en el rango, que no están pagas.
 *
 *   GET /reportes/ordenes-pendientes-facturar
 *       Foto del momento: cargos de órdenes en cuenta corriente SIN documento y que no
 *       se pagaron con un recurso. Es lo que la pre-factura del 360 muestra como
 *       "Sin facturar", pero de TODOS los clientes juntos.
 *
 * Solo lectura. El filtro por tipo de cliente / vendedor lo hace la pantalla.
 *
 * "Consumida en un recurso" (no se cobra en plata, no va a ninguno de los dos reportes):
 *   · el cargo ORDEN está marcado CUBIERTO_* (plan de metros, saldo de otra cuenta, plan en
 *     negativo) o MATERIAL_CUBIERTO_* — mismas marcas que excluye getOrdenesAnticipo; o
 *   · la orden tiene un movimiento vivo en una cuenta que NO es de dinero (MTS: ENTREGA /
 *     RECARGO_URGENCIA del plan). Hay cargos con consumo en el plan pero sin la marca
 *     (9 al 07-oct, ej. DTF-31302): por eso se mira también la cuenta del recurso.
 */

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Fecha como TEXTO ISO para mandarla a SQL como VarChar (mismo criterio y motivo que
// cobranzasReportesController.parseFecha: con un Date el driver corría la hora).
const parseFecha = (s, finDia = false) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}${finDia ? 'T23:59:59.997' : 'T00:00:00'}`;
};

// Vendedor del cliente: Clientes.VendedorID guarda la CÉDULA del usuario (Usuarios.Cedula)
const VENDEDOR_APPLY = (cliAlias) => `
    OUTER APPLY (SELECT TOP 1 ISNULL(NULLIF(RTRIM(u.Nombre), ''), u.Usuario) AS Vendedor
                 FROM dbo.Usuarios u WITH(NOLOCK)
                 WHERE CAST(u.Cedula AS NVARCHAR(20)) = LTRIM(RTRIM(${cliAlias}.VendedorID))) ven`;

// Primer token del MovConcepto (`${CodigoOrden} ${NombreTrabajo}`): último recurso para saber
// de qué orden es un movimiento cuando su OrdIdOrden no resuelve.
const SQL_TOKEN = (col) => `CASE WHEN CHARINDEX(' ', LTRIM(${col})) > 0
             THEN LEFT(LTRIM(${col}), CHARINDEX(' ', LTRIM(${col})) - 1) ELSE LTRIM(${col}) END`;

// Código COMPLETO de la orden de un movimiento (con el "(2/2)" de las órdenes hermanas):
// MovimientosCuenta.OrdIdOrden es el id de Ordenes (vía logística) o de OrdenesDeposito.
// Requiere `LEFT JOIN dbo.Ordenes erp` y `LEFT JOIN dbo.OrdenesDeposito odm` sobre ese id.
const SQL_COD_MOV = (movAlias) =>
    `UPPER(LTRIM(RTRIM(COALESCE(erp.CodigoOrden, odm.OrdCodigoOrden, ${SQL_TOKEN(`${movAlias}.MovConcepto`)}))))`;

const SQL_ES_CUBIERTO = (col) => `(${col} LIKE 'CUBIERTO%' OR ${col} LIKE 'MATERIAL[_]CUBIERTO%')`;

const SIMBOLO = { 1: '$', 2: 'US$' };

// ─── GET /api/contabilidad/reportes/ordenes-retiradas-sin-pago ────────────────
// Entregada = OrdenesDeposito.OrdEstadoActual 9; la fecha es la de ese estado.
// Paga (NO entra) si: la orden o su retiro tienen PagIdPago (cobro directo: caja,
// pasarela, anticipo) · se consumió en un recurso · su cargo está en un documento ya
// saldado (DocPagado = 1 o todas sus deudas cobradas; mismo criterio que la Auditoría de
// Depósito, auditDepositoSql.resolverSituacionPago). Tampoco entran las de importe 0.
exports.getOrdenesRetiradasSinPago = async (req, res) => {
    try {
        const desde = parseFecha(req.query.desde);
        const hasta = parseFecha(req.query.hasta, true);
        if (!desde || !hasta) return res.status(400).json({ success: false, error: 'Faltan las fechas desde / hasta (YYYY-MM-DD).' });

        const pool = await getPool();
        const result = await pool.request()
            .input('desde', sql.VarChar(30), desde)
            .input('hasta', sql.VarChar(30), hasta)
            .query(`
            -- Las tres partes se calculan una vez en tablas en memoria: como CTE juntas, SQL Server
            -- armaba un plan que tardaba ~20 s (cada una sola tarda < 0,4 s).

            -- Cargos ORDEN de cada orden (por código completo), en cuentas de dinero
            DECLARE @mv TABLE (Cod NVARCHAR(150) COLLATE DATABASE_DEFAULT PRIMARY KEY, DocId INT, Cubierta INT,
                               Cargos INT, Cargo DECIMAL(18, 4), MonCargo INT);
            INSERT INTO @mv
            SELECT x.Cod, MAX(x.DocIdDocumento), MAX(x.Cubierta), COUNT(*), SUM(x.Importe), MAX(x.MonIdMoneda)
            FROM (
                SELECT ${SQL_COD_MOV('mc')} AS Cod, mc.DocIdDocumento,
                       CASE WHEN ${SQL_ES_CUBIERTO('mc.MovObservaciones')} THEN 1 ELSE 0 END AS Cubierta,
                       ABS(mc.MovImporte) AS Importe, cc.MonIdMoneda
                FROM dbo.MovimientosCuenta mc WITH(NOLOCK)
                JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = mc.CueIdCuenta
                LEFT JOIN dbo.Ordenes erp WITH(NOLOCK) ON erp.OrdenID = mc.OrdIdOrden
                LEFT JOIN dbo.OrdenesDeposito odm WITH(NOLOCK) ON odm.OrdIdOrden = mc.OrdIdOrden AND erp.OrdenID IS NULL
                WHERE mc.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO') AND ISNULL(mc.MovAnulado, 0) = 0
                  AND cc.CueTipo LIKE 'DINERO%'
            ) x
            WHERE x.Cod IS NOT NULL
            GROUP BY x.Cod;

            -- Órdenes con consumo en una cuenta de recurso (plan de metros)
            DECLARE @rec TABLE (Cod NVARCHAR(150) COLLATE DATABASE_DEFAULT PRIMARY KEY);
            INSERT INTO @rec
            SELECT DISTINCT x.Cod FROM (
                SELECT ${SQL_COD_MOV('rm')} AS Cod
                FROM dbo.MovimientosCuenta rm WITH(NOLOCK)
                JOIN dbo.CuentasCliente rc WITH(NOLOCK) ON rc.CueIdCuenta = rm.CueIdCuenta
                LEFT JOIN dbo.Ordenes erp WITH(NOLOCK) ON erp.OrdenID = rm.OrdIdOrden
                LEFT JOIN dbo.OrdenesDeposito odm WITH(NOLOCK) ON odm.OrdIdOrden = rm.OrdIdOrden AND erp.OrdenID IS NULL
                WHERE rc.CueTipo NOT LIKE 'DINERO%' AND rm.OrdIdOrden IS NOT NULL AND ISNULL(rm.MovAnulado, 0) = 0
            ) x WHERE x.Cod IS NOT NULL;

            -- Retiros que pasaron por "Autorizado" (estado 9): caja dejó salir sin cobrar
            DECLARE @aut TABLE (OReIdOrdenRetiro INT PRIMARY KEY);
            INSERT INTO @aut
            SELECT DISTINCT h.OReIdOrdenRetiro FROM dbo.HistoricoEstadosOrdenesRetiro h WITH(NOLOCK)
            WHERE h.EORIdEstadoOrden = 9 AND h.OReIdOrdenRetiro IS NOT NULL;

            WITH ords AS (
                SELECT o.OrdIdOrden, LTRIM(RTRIM(o.OrdCodigoOrden)) AS CodigoOrden,
                       UPPER(LTRIM(RTRIM(o.OrdCodigoOrden))) AS Cod,
                       LTRIM(RTRIM(o.OrdNombreTrabajo)) AS Trabajo,
                       o.CliIdCliente, o.OrdCostoFinal, o.MonIdMoneda, o.OReIdOrdenRetiro,
                       o.OrdFechaEstadoActual AS FechaEntrega
                FROM dbo.OrdenesDeposito o WITH(NOLOCK)
                WHERE o.OrdEstadoActual = 9
                  AND o.OrdFechaEstadoActual >= @desde AND o.OrdFechaEstadoActual <= @hasta
                  AND o.PagIdPago IS NULL
            )
            SELECT ords.OrdIdOrden, ords.CodigoOrden, ords.Trabajo, ords.FechaEntrega,
                   ords.OrdCostoFinal, ords.MonIdMoneda, ords.OReIdOrdenRetiro,
                   er.EORNombreEstado AS RetiroEstado, LTRIM(RTRIM(r.FormaRetiro)) AS FormaRetiro,
                   CASE WHEN aut.OReIdOrdenRetiro IS NOT NULL THEN 1 ELSE 0 END AS AutorizadoCaja,
                   c.CliIdCliente, LTRIM(RTRIM(c.Nombre)) AS Cliente, LTRIM(RTRIM(c.IDCliente)) AS IDCliente,
                   c.TClIdTipoCliente AS TipoClienteId, LTRIM(RTRIM(tc.TClDescripcion)) AS TipoCliente,
                   ven.Vendedor,
                   ISNULL(mv.Cargos, 0) AS Cargos, mv.Cargo, mv.MonCargo,
                   doc.DocIdDocumento, LTRIM(RTRIM(doc.DocTipo)) AS DocTipo, LTRIM(RTRIM(doc.DocSerie)) AS DocSerie,
                   LTRIM(RTRIM(CAST(doc.DocNumero AS VARCHAR(50)))) AS DocNumero, doc.DocPagado, doc.MonIdMoneda AS DocMonIdMoneda,
                   dd.DeudasTotales, dd.DeudasVivas, dd.PendienteDoc
            FROM ords
            LEFT JOIN dbo.OrdenesRetiro r WITH(NOLOCK) ON r.OReIdOrdenRetiro = ords.OReIdOrdenRetiro
            LEFT JOIN dbo.EstadosOrdenesRetiro er WITH(NOLOCK) ON er.EORIdEstadoOrden = r.OReEstadoActual
            LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = ords.CliIdCliente
            LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            ${VENDEDOR_APPLY('c')}
            LEFT JOIN @mv  mv  ON mv.Cod  = ords.Cod
            LEFT JOIN @rec rec ON rec.Cod = ords.Cod
            LEFT JOIN @aut aut ON aut.OReIdOrdenRetiro = ords.OReIdOrdenRetiro
            LEFT JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.DocIdDocumento = mv.DocId AND doc.DocEstado <> 'ANULADO'
            OUTER APPLY (
                SELECT COUNT(*) AS DeudasTotales,
                       SUM(CASE WHEN x.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND x.DDeImportePendiente > 0.01 THEN 1 ELSE 0 END) AS DeudasVivas,
                       SUM(CASE WHEN x.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND x.DDeImportePendiente > 0.01 THEN x.DDeImportePendiente ELSE 0 END) AS PendienteDoc
                FROM dbo.DeudaDocumento x WITH(NOLOCK) WHERE x.DocIdDocumento = doc.DocIdDocumento
            ) dd
            WHERE r.PagIdPago IS NULL
              AND ISNULL(mv.Cubierta, 0) = 0
              AND rec.Cod IS NULL
            ORDER BY ords.FechaEntrega DESC, ords.OrdIdOrden DESC
        `);

        const data = [];
        for (const r of result.recordset) {
            const docSaldado = !!r.DocIdDocumento && (r.DocPagado === true || r.DocPagado === 1
                || (Number(r.DeudasTotales || 0) > 0 && Number(r.DeudasVivas || 0) === 0));
            if (docSaldado) continue;

            // Importe de la orden (lo que cobra caja). Sin costo en depósito → el cargo en cuenta.
            const usaCosto = Number(r.OrdCostoFinal || 0) > 0.009;
            const importe = usaCosto ? Number(r.OrdCostoFinal) : Number(r.Cargo || 0);
            if (!(importe > 0.009)) continue; // nada que cobrar (reposiciones, sin cargo)
            const monId = usaCosto ? (r.MonIdMoneda || 1) : (r.MonCargo || 1);

            let situacion;
            if (r.DocIdDocumento) situacion = 'FACTURADO_IMPAGO';
            else if (r.Cargos > 0) situacion = 'CARGO_SIN_FACTURAR';
            else situacion = 'SIN_CARGO';

            data.push({
                OrdIdOrden: r.OrdIdOrden,
                CodigoOrden: r.CodigoOrden,
                Trabajo: r.Trabajo || null,
                FechaEntrega: r.FechaEntrega,
                Importe: Math.round(importe * 100) / 100,
                MonIdMoneda: monId,
                MonSimbolo: SIMBOLO[monId] || '$',
                OReIdOrdenRetiro: r.OReIdOrdenRetiro,
                RetiroEstado: r.RetiroEstado || null,
                FormaRetiro: r.FormaRetiro || null,
                AutorizadoCaja: !!r.AutorizadoCaja,
                CliIdCliente: r.CliIdCliente,
                Cliente: r.Cliente || '(sin cliente)',
                IDCliente: r.IDCliente || null,
                TipoClienteId: r.TipoClienteId,
                TipoCliente: r.TipoCliente || null,
                Vendedor: r.Vendedor || null,
                Situacion: situacion,
                DocIdDocumento: r.DocIdDocumento || null,
                DocTipo: r.DocTipo || null,
                DocRef: r.DocIdDocumento ? ([r.DocSerie, r.DocNumero].filter(Boolean).join('-') || `#${r.DocIdDocumento}`) : null,
                PendienteDoc: r.DocIdDocumento ? Number(r.PendienteDoc || 0) : null,
                DocMonSimbolo: r.DocIdDocumento ? (SIMBOLO[r.DocMonIdMoneda] || '$') : null,
            });
        }

        res.json({ success: true, data, desde: req.query.desde, hasta: req.query.hasta });
    } catch (err) {
        logger.error('[REPORTES] getOrdenesRetiradasSinPago:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── GET /api/contabilidad/reportes/ordenes-pendientes-facturar ───────────────
// Una fila por cargo (MovimientosCuenta ORDEN / ORDEN_ANTICIPO) en una cuenta de dinero:
//   · sin documento (DocIdDocumento NULL) y no anulado
//   · no consumido en un recurso (ver encabezado)
//   · la misma orden no tiene OTRO cargo ya facturado en un documento no anulado (mismo
//     criterio que SQL_EXCLUIR_ORDEN_YA_FACTURADA: por OrdIdOrden dentro del cliente)
// Es la misma base que getOrdenesAnticipo (pre-factura del 360), para todos los clientes.
exports.getOrdenesPendientesFacturar = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT m.MovIdMovimiento, m.MovTipo, m.OrdIdOrden, m.MovFecha,
                   ABS(m.MovImporte) AS Importe,
                   LTRIM(RTRIM(m.MovConcepto)) AS Concepto,
                   cc.CueIdCuenta, cc.MonIdMoneda, ISNULL(mo.MonSimbolo, '$') AS MonSimbolo,
                   DATEDIFF(DAY, m.MovFecha, GETDATE()) AS DiasSinFacturar,
                   c.CliIdCliente, LTRIM(RTRIM(c.Nombre)) AS Cliente, LTRIM(RTRIM(c.IDCliente)) AS IDCliente,
                   c.TClIdTipoCliente AS TipoClienteId, LTRIM(RTRIM(tc.TClDescripcion)) AS TipoCliente,
                   ven.Vendedor,
                   oa.CodigoOrden,
                   od.OrdEstadoActual, eo.EOrNombreEstado AS EstadoOrden, od.OrdFechaEstadoActual
            FROM dbo.MovimientosCuenta m WITH(NOLOCK)
            JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CueTipo LIKE 'DINERO%'
            JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
            LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            LEFT JOIN dbo.Monedas mo WITH(NOLOCK) ON mo.MonIdMoneda = cc.MonIdMoneda
            ${VENDEDOR_APPLY('c')}
            -- Código de la orden: mismo orden de búsqueda que getOrdenesAnticipo
            OUTER APPLY (
                SELECT LTRIM(RTRIM(COALESCE(
                    (SELECT TOP 1 CodigoOrden FROM dbo.Ordenes WITH(NOLOCK) WHERE OrdenID = m.OrdIdOrden),
                    (SELECT TOP 1 OrdCodigoOrden FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OrdIdOrden = m.OrdIdOrden),
                    (SELECT TOP 1 OrdCodigoOrden FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OReIdOrdenRetiro = m.OReIdOrdenRetiro),
                    ${SQL_TOKEN('m.MovConcepto')}
                ))) AS CodigoOrden
            ) oa
            -- Dónde está la orden hoy (depósito / entregada); NULL = todavía no entró a depósito
            OUTER APPLY (
                SELECT TOP 1 x.OrdEstadoActual, x.OrdFechaEstadoActual
                FROM dbo.OrdenesDeposito x WITH(NOLOCK) WHERE x.OrdCodigoOrden = oa.CodigoOrden
                ORDER BY x.OrdIdOrden DESC
            ) od
            LEFT JOIN dbo.EstadosOrdenes eo WITH(NOLOCK) ON eo.EOrIdEstadoOrden = od.OrdEstadoActual
            WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
              AND m.DocIdDocumento IS NULL
              AND ISNULL(m.MovAnulado, 0) = 0
              AND ABS(m.MovImporte) > 0.009
              AND NOT ${SQL_ES_CUBIERTO(`ISNULL(m.MovObservaciones, '')`)}
              -- consumida en un recurso: movimiento vivo de la orden en una cuenta que no es de dinero
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.MovimientosCuenta rm WITH(NOLOCK)
                  JOIN dbo.CuentasCliente rc WITH(NOLOCK) ON rc.CueIdCuenta = rm.CueIdCuenta
                  WHERE rm.OrdIdOrden = m.OrdIdOrden AND rc.CliIdCliente = cc.CliIdCliente
                    AND rc.CueTipo NOT LIKE 'DINERO%' AND ISNULL(rm.MovAnulado, 0) = 0)
              -- la orden ya tiene otro cargo facturado (documento no anulado)
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.MovimientosCuenta mf WITH(NOLOCK)
                  JOIN dbo.CuentasCliente cf WITH(NOLOCK) ON cf.CueIdCuenta = mf.CueIdCuenta
                  JOIN dbo.DocumentosContables df WITH(NOLOCK) ON df.DocIdDocumento = mf.DocIdDocumento AND df.DocEstado <> 'ANULADO'
                  WHERE mf.OrdIdOrden = m.OrdIdOrden AND cf.CliIdCliente = cc.CliIdCliente
                    AND mf.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO') AND ISNULL(mf.MovAnulado, 0) = 0)
            ORDER BY m.MovFecha ASC, m.MovIdMovimiento ASC
        `);

        const data = result.recordset.map(r => {
            const concepto = (r.Concepto || '').replace(/\s+/g, ' ').trim();
            const codigo = r.CodigoOrden || null;
            // Trabajo = el concepto sin el código al inicio (mismo criterio que getMovimientosOrdenes)
            let trabajo = concepto;
            if (codigo && concepto.toUpperCase().startsWith(codigo.toUpperCase())) trabajo = concepto.slice(codigo.length).trim();
            let ubicacion;
            if (r.OrdEstadoActual == null) ubicacion = 'SIN_DEPOSITO';
            else if (r.OrdEstadoActual === 9) ubicacion = 'ENTREGADA';
            else if (r.OrdEstadoActual === 10 || r.OrdEstadoActual === 11) ubicacion = 'CANCELADA_PERDIDA';
            else ubicacion = 'EN_DEPOSITO';
            return {
                MovIdMovimiento: r.MovIdMovimiento,
                MovTipo: r.MovTipo,
                OrdIdOrden: r.OrdIdOrden,
                CodigoOrden: codigo,
                Trabajo: trabajo || null,
                FechaCargo: r.MovFecha,
                DiasSinFacturar: r.DiasSinFacturar,
                Importe: Math.round(Number(r.Importe || 0) * 100) / 100,
                MonIdMoneda: r.MonIdMoneda,
                MonSimbolo: r.MonSimbolo,
                CliIdCliente: r.CliIdCliente,
                Cliente: r.Cliente,
                IDCliente: r.IDCliente || null,
                TipoClienteId: r.TipoClienteId,
                TipoCliente: r.TipoCliente || null,
                Vendedor: r.Vendedor || null,
                Ubicacion: ubicacion,
                EstadoOrden: r.EstadoOrden || null,
                FechaEstadoOrden: r.OrdFechaEstadoActual || null,
            };
        });

        res.json({ success: true, data, generado: new Date().toISOString() });
    } catch (err) {
        logger.error('[REPORTES] getOrdenesPendientesFacturar:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
