/**
 * retiroService.js — Servicio unificado para crear órdenes de retiro.
 * Centraliza la lógica compartida entre ordenesRetiroController (local)
 * y webOrdersController (web), eliminando duplicación de código.
 */
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { marcarCobranzaPagada } = require('./cobranzaService');
const { esDeadlock } = require('../utils/reintentarDeadlock');

/* ── IDS DE RETIRO ─────────────────────────────────────────────────────────
 * Antes se generaban con `SELECT MAX(id)+1 ... WITH (UPDLOCK)`, que toma un
 * lock de actualización y NO lo suelta hasta el commit: mientras dura toda la
 * transacción del retiro, nadie más puede crear uno. En RelOrdenesRetiroOrdenes
 * era peor porque es un heap: el MAX() recorre las 48 mil filas bloqueándolas.
 * Medido en producción el 31/08: 2.357 ms de promedio con 2 lecturas lógicas
 * — o sea, espera pura por lock.
 *
 * Una secuencia es un contador del motor: no toca la tabla ni toma locks suyos.
 * Se auto-crea sembrada desde el MAX actual + margen, así no importa el orden
 * entre correr el SQL del deploy y subir este código.
 *
 * OJO: la creación va por el POOL, nunca por la transacción del caller — si esa
 * transacción hace rollback, el DDL se iría con ella y quedaríamos marcándola
 * como creada en memoria.
 */
const SECUENCIAS = {
    Seq_OrdenesRetiro: { tabla: 'OrdenesRetiro', columna: 'OReIdOrdenRetiro' },
    Seq_RelOrdenesRetiroOrdenes: { tabla: 'RelOrdenesRetiroOrdenes', columna: 'RORIdOrdenRetiroOrden' },
};
const secuenciasListas = new Set();

async function asegurarSecuencia(nombre) {
    if (secuenciasListas.has(nombre)) return;
    const def = SECUENCIAS[nombre];
    const pool = await getPool();
    await pool.request().query(`
        IF OBJECT_ID('dbo.${nombre}', 'SO') IS NULL
        BEGIN
            DECLARE @Desde BIGINT = (SELECT ISNULL(MAX(${def.columna}), 0) + 100 FROM dbo.${def.tabla});
            DECLARE @Sql NVARCHAR(500) = N'CREATE SEQUENCE dbo.${nombre} AS INT START WITH '
                + CAST(@Desde AS NVARCHAR(20)) + N' INCREMENT BY 1 NO CACHE';
            EXEC sp_executesql @Sql;
        END
    `);
    secuenciasListas.add(nombre);
    logger.info(`[RETIRO] Secuencia dbo.${nombre} disponible`);
}

/** Próximo id, sin bloquear la tabla. NO CACHE: sin huecos al reiniciar SQL Server. */
async function proximoId(transaction, nombre) {
    await asegurarSecuencia(nombre);
    const r = await transaction.request().query(`SELECT NEXT VALUE FOR dbo.${nombre} AS Id`);
    return r.recordset[0].Id;
}

/**
 * verificarRecursoCliente
 * Chequea si el cliente tiene un plan de recursos activo para el producto dado.
 * Funciona para CUALQUIER tipo de cliente (no solo tipo 2 o 3).
 *
 * @returns {Promise<{tieneRecurso, planId, saldoDisponible, motivo}>}
 */
async function verificarRecursoCliente(transaction, { CliIdCliente, ProIdProducto }) {
    if (!CliIdCliente || !ProIdProducto) {
        return { tieneRecurso: false, motivo: 'sin_datos' };
    }

    try {
        const planRes = await transaction.request()
            .input('CliIdCliente',  sql.Int, CliIdCliente)
            .input('ProIdProducto', sql.Int, ProIdProducto)
            .query(`
                SELECT TOP 1
                    PlaIdPlan,
                    PlaCantidadTotal - PlaCantidadUsada AS SaldoDisponible
                FROM dbo.PlanesMetros WITH(NOLOCK)
                WHERE CliIdCliente  = @CliIdCliente
                  AND PlaActivo     = 1
                  AND (PlaFechaVencimiento IS NULL
                    OR PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                  AND (
                    ProIdProducto = @ProIdProducto
                    OR EXISTS (
                      SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                      WHERE pap.PlaIdPlan = PlanesMetros.PlaIdPlan
                        AND pap.ProIdProducto = @ProIdProducto
                    )
                  )
                ORDER BY PlaFechaAlta DESC
            `);

        if (!planRes.recordset.length) {
            return { tieneRecurso: false, motivo: 'sin_plan' };
        }

        const plan = planRes.recordset[0];
        return {
            tieneRecurso:    true,
            planId:          plan.PlaIdPlan,
            saldoDisponible: Number(plan.SaldoDisponible),
            motivo:          `plan_${plan.PlaIdPlan}`,
        };
    } catch (err) {
        logger.warn(`[RECURSO] Error verificando plan CliId=${CliIdCliente}: ${err.message}. Sin recurso.`);
        return { tieneRecurso: false, motivo: 'error_verificacion' };
    }
}

/**
 * verificarCuentaRestringida
 * Billetera: ¿la orden la cubre una cuenta RESTRINGIDA de dinero ("rollo en plata")?
 * Señal fuerte: ya existe el movimiento CONSUMO_CUENTA de esa orden (el motor la
 * descontó al ingreso). Señal de respaldo (espeja verificarRecursoCliente): hay una
 * cuenta restringida activa cuya lista blanca incluye el artículo.
 *
 * @returns {Promise<{cubierta:boolean, cueId?:number, motivo?:string}>}
 */
async function verificarCuentaRestringida(transaction, { CliIdCliente, OrdIdOrden, ProIdProducto }) {
    if (!CliIdCliente) return { cubierta: false };
    try {
        if (OrdIdOrden) {
            const mov = await transaction.request()
                .input('Ord', sql.Int, OrdIdOrden)
                .input('Cli', sql.Int, CliIdCliente)
                .query(`
                    SELECT TOP 1 m.CueIdCuenta
                    FROM   dbo.MovimientosCuenta m WITH(NOLOCK)
                    JOIN   dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
                    WHERE  m.OrdIdOrden = @Ord
                      AND  cc.CliIdCliente = @Cli
                      AND  m.MovTipo = 'CONSUMO_CUENTA'
                      AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      -- Solo cobertura ENTERA: un CUBIERTO_PARCIAL_CUENTA dejó resto en la principal
                      AND  m.MovObservaciones LIKE 'CUBIERTO_CUENTA_%'
                `);
            if (mov.recordset.length) return { cubierta: true, cueId: mov.recordset[0].CueIdCuenta, motivo: 'consumo registrado' };
        }
        // Respaldo (espeja el plan activo): cuenta con descuento automático Y que acepta negativo
        // → siempre cubre entera, aunque el movimiento todavía no exista. Sin negativo no se
        // puede asegurar la cobertura por adelantado.
        const cta = await transaction.request()
            .input('Cli', sql.Int, CliIdCliente)
            .input('Pro', sql.Int, ProIdProducto || null)
            .query(`
                SELECT TOP 1 cc.CueIdCuenta
                FROM   dbo.CuentasCliente cc WITH(NOLOCK)
                WHERE  cc.CliIdCliente = @Cli AND cc.CueActiva = 1 AND cc.CueEsPrincipal = 0
                  AND  cc.CueAutoConsumo = 1 AND cc.CuePuedeNegativo = 1
                  AND  cc.CueTipo LIKE 'DINERO%'
                  AND  (cc.CueRestringida = 0
                        OR (@Pro IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.CuentasClienteArticulosPermitidos ap WITH(NOLOCK)
                                                         WHERE ap.CueIdCuenta = cc.CueIdCuenta AND ap.ProIdProducto = @Pro)))
                ORDER BY cc.CueRestringida DESC, cc.CueIdCuenta ASC
            `);
        if (cta.recordset.length) return { cubierta: true, cueId: cta.recordset[0].CueIdCuenta, motivo: 'cuenta con descuento automático y negativo permitido' };
        return { cubierta: false };
    } catch (err) {
        logger.warn(`[RETIRO] Error verificando cuenta restringida CliId=${CliIdCliente}: ${err.message}. Sin cobertura.`);
        return { cubierta: false };
    }
}

/**
 * verificarCicloSemanal
 * Solo para clientes tipo 2 (Semanal): verifica ciclo de crédito abierto.
 */
async function verificarCicloSemanal(transaction, CliIdCliente) {
    try {
        const cicloRes = await transaction.request()
            .input('CliIdCliente', sql.Int, CliIdCliente)
            .query(`
                SELECT TOP 1 cc.CicIdCiclo, cc.CicFechaCierre
                FROM   dbo.CiclosCredito  cc WITH(NOLOCK)
                JOIN   dbo.CuentasCliente cu WITH(NOLOCK) ON cu.CueIdCuenta = cc.CueIdCuenta
                WHERE  cu.CliIdCliente = @CliIdCliente
                  AND  cc.CicEstado    = 'ABIERTO'
                  AND  cc.CicFechaCierre >= CAST(GETDATE() AS DATE)
            `);

        if (!cicloRes.recordset.length) {
            logger.warn(`[RECURSO] Semanal CliId=${CliIdCliente} → sin ciclo activo.`);
            return false;
        }
        return true;
    } catch (err) {
        logger.warn(`[RECURSO] Error verificando ciclo CliId=${CliIdCliente}: ${err.message}.`);
        return false;
    }
}

/**
 * calcularAdelantoLimpio
 * Saldo de adelanto REAL del cliente en su cuenta de dinero de la moneda dada.
 * Suma los movimientos por su importe CRUDO (que sí es confiable), EXCLUYENDO
 * VTA_CAJA/CIERRE_CICLO (capa fiscal que DUPLICA el débito de las órdenes) y los
 * anulados. NO usa CueSaldoActual (que arrastra descalces históricos y doble conteo).
 *
 * @returns {{ adelanto:number, tieneAnticipo:boolean }}
 *   adelanto >= 0 con tieneAnticipo=true → adelanto solvente → órdenes cubiertas.
 *   adelanto < 0 o sin anticipo          → sobre-consumió / no tiene adelanto → caja.
 */
async function calcularAdelantoLimpio(transaction, CliIdCliente, moneda) {
    const cueTipo = (moneda && String(moneda).toUpperCase() === 'USD') ? 'DINERO_USD' : 'DINERO_UYU';
    const r = await transaction.request()
        .input('Cli',  sql.Int,         CliIdCliente)
        .input('Tipo', sql.VarChar(20), cueTipo)
        .query(`
            SELECT
                ISNULL(SUM(m.MovImporte), 0) AS Adelanto,
                ISNULL(SUM(CASE WHEN m.MovTipo = 'ANTICIPO' THEN m.MovImporte ELSE 0 END), 0) AS TotalAnticipos
            FROM   dbo.MovimientosCuenta m  WITH(NOLOCK)
            JOIN   dbo.CuentasCliente    cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
            WHERE  cc.CliIdCliente = @Cli
              AND  cc.CueTipo      = @Tipo
              -- Billetera: solo la cuenta PRINCIPAL cubre retiros automáticamente;
              -- las cuentas secundarias/restringidas se usan solo por elección explícita.
              AND  cc.CueEsPrincipal = 1
              AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
              AND  m.MovTipo NOT IN ('VTA_CAJA', 'CIERRE_CICLO')
        `);
    const row = r.recordset[0] || {};
    return {
        adelanto:      parseFloat(row.Adelanto) || 0,
        tieneAnticipo: (parseFloat(row.TotalAnticipos) || 0) > 0.01,
    };
}

/**
 * tienePlanHistorico
 * ¿El cliente tuvo ALGUNA VEZ un plan de metros (rollo) para el producto — activo
 * O CERRADO? Se usa para dejar pasar el ROLLO NEGATIVO: cuando el plan se consumió
 * y quedó en negativo (o se cerró), la orden se cubrió en metros (no en plata) y el
 * saldo negativo se compensa con el próximo rollo. Mientras exista historia de rollo
 * para ese producto, el retiro pasa (Abonado). Sin ninguna historia → no es rollo real.
 * Espeja la condición de hookOrdenCreada (ultimoPlanRes, sin filtro PlaActivo).
 */
/**
 * ordenCubiertaPorLibro
 * ¿El LIBRO de recursos muestra que esta orden ya consumió sus metros de un plan?
 * (ENTREGA en cuentas de metros por >= OrdCantidad.) Es la prueba dura de cobertura:
 * cubre el caso de una orden con costo VIEJO (cotizada antes de comprar el rollo)
 * cuyos metros SÍ se descontaron al ingresar — no debe volver a cobrarse.
 * OJO: m.OrdIdOrden apunta a Ordenes(ERP).OrdenID, acá llega el id de OrdenesDeposito
 * — se resuelve por OrdCodigoOrden.
 */
async function ordenCubiertaPorLibro(transaction, OrdIdOrdenDeposito) {
    try {
        const r = await transaction.request()
            .input('Ord', sql.Int, OrdIdOrdenDeposito)
            .query(`
                SELECT od.OrdCantidad,
                       (SELECT ISNULL(SUM(-m.MovImporte), 0)
                          FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                          JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
                         WHERE m.OrdIdOrden = o.OrdenID
                           AND cc.CliIdCliente = od.CliIdCliente
                           AND cc.CueTipo NOT IN ('DINERO_USD','DINERO_UYU')
                           AND m.MovTipo = 'ENTREGA'
                           AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) AS MetrosLibro
                FROM dbo.OrdenesDeposito od WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.CodigoOrden = od.OrdCodigoOrden
                WHERE od.OrdIdOrden = @Ord
            `);
        if (!r.recordset.length) return false;
        const cant   = parseFloat(r.recordset[0].OrdCantidad) || 0;
        const libro  = parseFloat(r.recordset[0].MetrosLibro) || 0;
        return cant > 0 && libro >= cant - 0.005;
    } catch (err) {
        logger.warn(`[RETIRO] Error verificando libro de recursos OrdDep=${OrdIdOrdenDeposito}: ${err.message}.`);
        return false;
    }
}

/* ── RETIROS CON PESOS Y DÓLARES (27/10/2026, INF-SIS-2026-07) ──────────────
 * Cada orden queda en su moneda; acá se decide la moneda del RETIRO y su total.
 * Todas las órdenes a cobrar en dólares → retiro en dólares, como siempre. En pesos, o
 * mezcladas → retiro en pesos: los dólares pasan a pesos con la cotización del día
 * (Cotizaciones.CotDolar, la misma de la caja y la billetera) o con la que se pase, que es
 * la que quedó fija al empezar un pago online.
 * Antes, si alguna orden era en dólares, el retiro entero quedaba en dólares con el total
 * sumado sin convertir: RT-34046 ($ 3.000 + $ 3.000 + US$ 5,28) figuraba «US$ 6.005,28».
 */
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const monedaDe = (c) => (/US|U\$/i.test(String(c || '')) ? 'USD' : 'UYU');

/** Última cotización del dólar cargada: { cotizacion, fecha, dia: 'dd/mm' }, o null si no hay. */
async function cotizacionDelDia(exec) {
    // dia armado en SQL: el Date del driver se corre de día según la zona horaria
    const r = await exec.request().query(
        'SELECT TOP 1 CotDolar, CotFecha, CONVERT(VARCHAR(5), CotFecha, 103) AS Dia FROM dbo.Cotizaciones WITH(NOLOCK) WHERE CotDolar > 0 ORDER BY CotFecha DESC');
    const row = r.recordset[0];
    return row ? { cotizacion: Number(row.CotDolar), fecha: row.CotFecha, dia: row.Dia } : null;
}

/**
 * Moneda y pendiente de cobro de cada orden, con las reglas de la lista del portal
 * (getPickupOrders): moneda e importe de la cobranza si la tiene, si no los de la orden;
 * paga (cobranza, billetera entera o pago anotado) → 0; cubierta en parte por la billetera
 * → el resto que quedó en la cuenta corriente. Con `pendiente: false` solo lee la moneda.
 * @returns {Map<number, {codigo, moneda, pendiente}>}
 */
async function leerOrdenesParaCobro(exec, ordIds, { pendiente = true } = {}) {
    const req = exec.request();
    ordIds.forEach((id, i) => req.input(`oc${i}`, sql.Int, id));
    const r = await req.query(`
        SELECT o.OrdIdOrden, o.OrdCodigoOrden, o.MonIdMoneda, o.OrdCostoFinal, o.PagIdPago,
               pc.Moneda AS CobMoneda, pc.MontoTotal AS CobMonto, pc.EstadoCobro
               ${pendiente ? `,
               CASE WHEN EXISTS (
                   SELECT 1 FROM dbo.MovimientosCuenta cx WITH(NOLOCK)
                   JOIN dbo.CuentasCliente ccx WITH(NOLOCK) ON ccx.CueIdCuenta = cx.CueIdCuenta
                   WHERE ccx.CliIdCliente = o.CliIdCliente
                     AND cx.MovTipo = 'CONSUMO_CUENTA'
                     AND (cx.MovAnulado IS NULL OR cx.MovAnulado = 0)
                     AND cx.MovObservaciones LIKE 'CUBIERTO[_]CUENTA[_]%'
                     AND (cx.OrdIdOrden = o.OrdIdOrden
                          OR cx.OrdIdOrden IN (SELECT erp.OrdenID FROM dbo.Ordenes erp WITH(NOLOCK) WHERE erp.CodigoOrden = o.OrdCodigoOrden))
               ) THEN 1 ELSE 0 END AS CubiertaBilletera,
               CASE WHEN EXISTS (
                   SELECT 1 FROM dbo.MovimientosCuenta cp WITH(NOLOCK)
                   JOIN dbo.CuentasCliente ccp WITH(NOLOCK) ON ccp.CueIdCuenta = cp.CueIdCuenta
                   WHERE ccp.CliIdCliente = o.CliIdCliente
                     AND cp.MovTipo = 'CONSUMO_CUENTA'
                     AND (cp.MovAnulado IS NULL OR cp.MovAnulado = 0)
                     AND cp.MovObservaciones LIKE 'CUBIERTO[_]PARCIAL[_]CUENTA%'
                     AND (cp.OrdIdOrden = o.OrdIdOrden
                          OR cp.OrdIdOrden IN (SELECT erp3.OrdenID FROM dbo.Ordenes erp3 WITH(NOLOCK) WHERE erp3.CodigoOrden = o.OrdCodigoOrden))
               ) THEN 1 ELSE 0 END AS ParcialBilletera,
               (SELECT TOP 1 ABS(mr.MovImporte)
                FROM dbo.MovimientosCuenta mr WITH(NOLOCK)
                JOIN dbo.CuentasCliente ccr WITH(NOLOCK) ON ccr.CueIdCuenta = mr.CueIdCuenta
                WHERE ccr.CliIdCliente = o.CliIdCliente
                  AND mr.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                  AND (mr.MovAnulado IS NULL OR mr.MovAnulado = 0)
                  AND mr.DocIdDocumento IS NULL
                  AND (mr.MovObservaciones IS NULL OR mr.MovObservaciones NOT LIKE 'CUBIERTO%')
                  AND (mr.OrdIdOrden = o.OrdIdOrden
                       OR mr.OrdIdOrden IN (SELECT erp4.OrdenID FROM dbo.Ordenes erp4 WITH(NOLOCK) WHERE erp4.CodigoOrden = o.OrdCodigoOrden))
                ORDER BY mr.MovIdMovimiento DESC) AS RestoCtaCte` : ''}
        FROM dbo.OrdenesDeposito o WITH(NOLOCK)
        OUTER APPLY (SELECT TOP 1 p.Moneda, p.MontoTotal, p.EstadoCobro
                     FROM dbo.PedidosCobranza p WITH(NOLOCK)
                     WHERE p.NoDocERP = o.OrdCodigoOrden
                     ORDER BY p.ID DESC) pc
        WHERE o.OrdIdOrden IN (${ordIds.map((_, i) => `@oc${i}`).join(',')})
    `);
    const out = new Map();
    for (const o of r.recordset) {
        let importe = o.CobMonto != null ? Number(o.CobMonto) : (Number(o.OrdCostoFinal) || 0);
        let paga = o.EstadoCobro === 'Pagado';
        if (o.CubiertaBilletera === 1 || o.PagIdPago != null) paga = true;
        else if (o.ParcialBilletera === 1 && o.RestoCtaCte != null) importe = Number(o.RestoCtaCte);
        out.set(o.OrdIdOrden, {
            codigo:    (o.OrdCodigoOrden || `#${o.OrdIdOrden}`).trim(),
            moneda:    o.CobMoneda ? monedaDe(o.CobMoneda) : (Number(o.MonIdMoneda) === 2 ? 'USD' : 'UYU'),
            pendiente: paga ? 0 : r2(Math.max(0, importe)),
        });
    }
    return out;
}

/**
 * Órdenes que ya tienen comprobante vivo (factura, e-ticket o pedido de caja): la misma condición
 * que el control de caja «cada orden lleva UN solo comprobante» (cajaService.procesarTransaccion).
 * Si queda deuda, se cobra por Pago de Deudas; los pagos online no las cobran (INF-SIS-2026-13: el
 * 28/10 un cliente pagó por Handy el RW-35313, ya facturado en la FA-2999, caja rechazó registrar
 * el cobro y la plata quedó en la pasarela sin anotar).
 * Documento acreditado ENTERO por una nota de crédito (INF-SIS-2026-14, P6): la NC no desliga la
 * orden y la refactura no la vuelve a ligar, así que la deuda real está en otro documento que desde
 * la orden no se encuentra (DIR-33506: FA-2693 acreditada por NC-000056, la deuda en FA-2714). Se
 * prefiere un documento sin acreditar; si no hay, la orden sale con deuda (se resuelve en caja) y
 * con la NC en `acreditadaPor`. Antes salía «paga» por la deuda COBRADO que deja la NC.
 * @returns {Promise<Map<number, {documento:string, deudaPendiente:boolean, acreditadaPor:string|null}>>}
 */
async function leerFacturadas(exec, ordIds) {
    const ids = [...new Set((ordIds || []).map(n => parseInt(n, 10)).filter(n => !isNaN(n)))];
    const out = new Map();
    if (!ids.length) return out;
    const req = exec.request();
    ids.forEach((id, i) => req.input(`of${i}`, sql.Int, id));
    const r = await req.query(`
        SELECT od.OrdIdOrden, f.Documento, f.DeudaEstado, f.NotaCredito
        FROM dbo.OrdenesDeposito od WITH(NOLOCK)
        CROSS APPLY (
            SELECT TOP 1 LTRIM(RTRIM(dc.DocSerie)) + '-' + LTRIM(RTRIM(CAST(dc.DocNumero AS VARCHAR(50)))) AS Documento,
                   ISNULL((SELECT TOP 1 dd.DDeEstado FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                           WHERE dd.DocIdDocumento = dc.DocIdDocumento), 'PAGADO') AS DeudaEstado,
                   nc.NotaCredito
            FROM dbo.MovimientosCuenta m WITH(NOLOCK)
            JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = od.CliIdCliente
            JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento
            OUTER APPLY (
                SELECT TOP 1 LTRIM(RTRIM(n.DocSerie)) + '-' + LTRIM(RTRIM(CAST(n.DocNumero AS VARCHAR(50)))) AS NotaCredito
                FROM dbo.DocumentosContables n WITH(NOLOCK)
                WHERE n.DocIdDocumentoRef = dc.DocIdDocumento AND n.DocTipo LIKE '%Nota De Cr%'
                  AND ISNULL(n.DocEstado, '') <> 'ANULADO'
                  AND (SELECT SUM(n2.DocTotal) FROM dbo.DocumentosContables n2 WITH(NOLOCK)
                       WHERE n2.DocIdDocumentoRef = dc.DocIdDocumento AND n2.DocTipo LIKE '%Nota De Cr%'
                         AND ISNULL(n2.DocEstado, '') <> 'ANULADO') >= dc.DocTotal - 0.01
                ORDER BY n.DocIdDocumento DESC
            ) nc
            WHERE (m.OrdIdOrden = od.OrdIdOrden
                   OR m.OrdIdOrden IN (SELECT o2.OrdenID FROM dbo.Ordenes o2 WITH(NOLOCK) WHERE o2.CodigoOrden = od.OrdCodigoOrden))
              AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
              AND ISNULL(dc.DocEstado, '') <> 'ANULADO'
            ORDER BY CASE WHEN nc.NotaCredito IS NULL THEN 0 ELSE 1 END, m.MovIdMovimiento DESC
        ) f
        WHERE od.OrdIdOrden IN (${ids.map((_, i) => `@of${i}`).join(',')})
          AND ISNULL(od.OrdCostoFinal, 0) > 0.01`);
    for (const row of r.recordset) {
        out.set(row.OrdIdOrden, {
            documento: row.Documento,
            deudaPendiente: !!row.NotaCredito
                || ['PENDIENTE', 'PARCIAL', 'VENCIDO'].includes(String(row.DeudaEstado || '').toUpperCase()),
            acreditadaPor: row.NotaCredito || null,
        });
    }
    return out;
}

/**
 * Órdenes de un retiro que quedan FUERA de un cobro y se siguen debiendo (INF-SIS-2026-14, P2):
 * sin comprobante y sin nada que las cubra (pago, cobranza o billetera), o facturadas con la deuda
 * viva. No cuentan las facturadas sin deuda, las pagas, las exoneradas (tienen PagIdPago), las de
 * costo 0 ni las canceladas (10) o perdidas (11). El 9 sí cuenta: crearRetiro pone así las órdenes
 * al armar el retiro, no solo al entregarlas.
 * @param {number[]} cobradas — las que cubre el cobro en curso (se saltean)
 * @returns {Promise<{ordId:number, codigo:string, documento:string|null}[]>}
 */
async function ordenesQueQuedanDebiendo(exec, retiroId, cobradas) {
    const cob = new Set((cobradas || []).map(n => parseInt(n, 10)));
    const r = await exec.request()
        .input('Id', sql.Int, retiroId)
        .query(`
            SELECT od.OrdIdOrden
            FROM dbo.OrdenesDeposito od WITH(NOLOCK)
            WHERE od.OReIdOrdenRetiro = @Id
              AND ISNULL(od.PagIdPago, 0) = 0
              AND ISNULL(od.OrdCostoFinal, 0) > 0.01
              AND od.OrdEstadoActual NOT IN (10, 11)`);
    const resto = r.recordset.map(x => x.OrdIdOrden).filter(id => !cob.has(id));
    if (!resto.length) return [];
    const cobro = await leerOrdenesParaCobro(exec, resto);
    const fact  = await leerFacturadas(exec, resto);
    return resto
        .filter(id => (fact.has(id) ? fact.get(id).deudaPendiente : (cobro.get(id)?.pendiente || 0) > 0.01))
        .map(id => ({ ordId: id, codigo: cobro.get(id)?.codigo || `#${id}`, documento: fact.get(id)?.documento || null }));
}

/**
 * Cierra un retiro sin abonar que ya no debe nada (INF-SIS-2026-14, 1c). Lo usan los cobros que
 * pagan órdenes sin pasar por el cobro del retiro: Pago de Deudas sobre la factura y el cobro manual
 * de una factura. 1 y 2 → 3 Abonado; 7 → 8 Empaquetado y abonado (la regla de «Cubrir con billetera»
 * de caja). Entregados, autorizados y en viaje no se tocan.
 * @returns {Promise<boolean>} si lo cerró
 */
async function cerrarRetiroSiNoDebe(exec, { retiroId, pagId, usuarioId }) {
    const ret = (await exec.request().input('Id', sql.Int, retiroId)
        .query('SELECT OReEstadoActual FROM dbo.OrdenesRetiro WITH(UPDLOCK) WHERE OReIdOrdenRetiro = @Id')).recordset[0];
    if (!ret || ![1, 2, 7].includes(Number(ret.OReEstadoActual))) return false;
    if ((await ordenesQueQuedanDebiendo(exec, retiroId, [])).length) return false;
    const nuevo = Number(ret.OReEstadoActual) === 7 ? 8 : 3;
    await exec.request()
        .input('Id', sql.Int, retiroId)
        .input('PagId', sql.Int, pagId || null)
        .input('Est', sql.Int, nuevo)
        .input('Usr', sql.Int, usuarioId || 70)
        .query(`
            UPDATE dbo.OrdenesRetiro
            SET PagIdPago            = CASE WHEN ISNULL(PagIdPago, 0) = 0 THEN ISNULL(@PagId, PagIdPago) ELSE PagIdPago END,
                OReEstadoActual      = @Est,
                OReFechaEstadoActual = GETDATE(),
                ORePasarPorCaja      = 0
            WHERE OReIdOrdenRetiro = @Id;

            INSERT INTO dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            VALUES (@Id, @Est, GETDATE(), @Usr);

            UPDATE dbo.OcupacionEstantes SET Pagado = 1
            WHERE OrdenRetiro IN (SELECT COALESCE(FormaRetiro, 'R') + '-' + CAST(OReIdOrdenRetiro AS VARCHAR)
                                  FROM dbo.OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @Id);`);
    logger.info(`[RETIRO] Retiro ${retiroId} sin nada pendiente → estado ${nuevo} (abonado).`);
    return true;
}

/**
 * Al saldar un documento, sus órdenes quedan pagas (INF-SIS-2026-14, P4): PagIdPago del cobro y
 * estado 7 si no están resueltas, como en el cobro de un retiro. Antes Pago de Deudas sobre la factura
 * y el cobro manual de editarFactura bajaban la deuda, pero la orden seguía «a cobrar» para el portal,
 * la caja y la entrega. Después cierra los retiros sin abonar que ya no deben nada.
 * Solo documentos sin deuda viva y no acreditados enteros por una nota de crédito, y solo órdenes que
 * todavía se van a retirar: en depósito sin retiro o en un retiro sin abonar (1, 2, 7). Las ya
 * entregadas no lo necesitan (una factura de ciclo cobrada después de la entrega queda como antes).
 * @returns {Promise<{ordenes:number[], retiros:number[]}>} órdenes marcadas y retiros cerrados
 */
async function marcarOrdenesDeDocumentosPagas(exec, { docIds, pagId, usuarioId }) {
    const ids = [...new Set((docIds || []).map(n => parseInt(n, 10)).filter(n => n > 0))];
    if (!ids.length || !pagId) return { ordenes: [], retiros: [] };
    const r = await exec.request()
        .input('PagId', sql.Int, pagId)
        .input('Usr', sql.Int, usuarioId || 70)
        .query(`
            DECLARE @ords TABLE (OrdIdOrden INT PRIMARY KEY);
            DECLARE @cambios TABLE (OrdIdOrden INT, EstadoViejo INT, EstadoNuevo INT);

            INSERT INTO @ords (OrdIdOrden)
            SELECT DISTINCT od.OrdIdOrden
            FROM dbo.MovimientosCuenta m WITH(NOLOCK)
            JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento
            JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
            LEFT JOIN dbo.Ordenes o2 WITH(NOLOCK) ON o2.OrdenID = m.OrdIdOrden
            JOIN dbo.OrdenesDeposito od WITH(NOLOCK)
              ON od.CliIdCliente = cc.CliIdCliente
             AND (od.OrdIdOrden = m.OrdIdOrden OR od.OrdCodigoOrden = o2.CodigoOrden)
            LEFT JOIN dbo.OrdenesRetiro rr WITH(NOLOCK) ON rr.OReIdOrdenRetiro = od.OReIdOrdenRetiro
            WHERE m.DocIdDocumento IN (${ids.join(',')})
              AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
              AND ISNULL(dc.DocEstado, '') <> 'ANULADO'
              AND ISNULL(od.PagIdPago, 0) = 0
              AND ISNULL(od.OrdCostoFinal, 0) > 0.01
              AND ((od.OReIdOrdenRetiro IS NULL AND od.OrdEstadoActual NOT IN (9, 10, 11))
                   OR rr.OReEstadoActual IN (1, 2, 7))
              AND NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                              WHERE dd.DocIdDocumento = dc.DocIdDocumento
                                AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01)
              AND ISNULL((SELECT SUM(n.DocTotal) FROM dbo.DocumentosContables n WITH(NOLOCK)
                          WHERE n.DocIdDocumentoRef = dc.DocIdDocumento AND n.DocTipo LIKE '%Nota De Cr%'
                            AND ISNULL(n.DocEstado, '') <> 'ANULADO'), 0) < dc.DocTotal - 0.01;

            UPDATE od
            SET PagIdPago            = @PagId,
                OrdEstadoActual      = CASE WHEN od.OrdEstadoActual IN (9,10,11) THEN od.OrdEstadoActual ELSE 7 END,
                OrdFechaEstadoActual = CASE WHEN od.OrdEstadoActual IN (9,10,11) THEN od.OrdFechaEstadoActual ELSE GETDATE() END
            OUTPUT inserted.OrdIdOrden, deleted.OrdEstadoActual, inserted.OrdEstadoActual INTO @cambios
            FROM dbo.OrdenesDeposito od
            JOIN @ords x ON x.OrdIdOrden = od.OrdIdOrden;

            INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            SELECT OrdIdOrden, EstadoNuevo, GETDATE(), @Usr FROM @cambios WHERE EstadoViejo <> EstadoNuevo;

            SELECT od.OrdIdOrden, od.OReIdOrdenRetiro
            FROM dbo.OrdenesDeposito od WITH(NOLOCK) JOIN @ords x ON x.OrdIdOrden = od.OrdIdOrden;`);
    const ordenes = r.recordset.map(x => x.OrdIdOrden);
    const retiros = [];
    for (const retiroId of [...new Set(r.recordset.map(x => x.OReIdOrdenRetiro).filter(Boolean))]) {
        if (await cerrarRetiroSiNoDebe(exec, { retiroId, pagId, usuarioId })) retiros.push(retiroId);
    }
    if (ordenes.length) logger.info(`[RETIRO] Documento(s) ${ids.join(', ')} saldado(s): ${ordenes.length} orden(es) quedan pagas (PagIdPago ${pagId})${retiros.length ? `; retiros cerrados: ${retiros.join(', ')}` : ''}.`);
    return { ordenes, retiros };
}

/**
 * Moneda y total de un retiro a partir de sus órdenes. La usan todos los caminos que arman
 * o cobran un retiro (portal, tótem, mostrador, Mercado Pago, Handy, billetera, «Pagos
 * pendientes») y los recálculos al editar o sacar una orden.
 *
 * @param exec   pool o transacción
 * @param {Array<{ordId:number, importe?:number}>} items — importe a cobrar de cada orden EN SU
 *        MONEDA; si no viene, el pendiente de cobro (leerOrdenesParaCobro).
 * @param {{cotizacion?:number, excluirFacturadas?:boolean}} [opts] — cotización fija (la guardada
 *        al empezar un pago online); sin ella, la del día. excluirFacturadas: las órdenes que ya
 *        tienen comprobante valen 0 (pagos online, INF-SIS-2026-13) y salen en `facturadas`.
 * @returns {Promise<{moneda:'UYU'|'USD', mezcla:boolean, cotizacion:number|null,
 *           cotizacionDia:string|null, total:number, dolares:number, dolaresEnPesos:number,
 *           items:Array<{ordId, codigo, moneda, importe, importeRetiro}>}>}
 *   mezcla: hay importes a cobrar en las dos monedas. dolares / dolaresEnPesos: lo que se
 *   convirtió (0 si no hay mezcla).
 */
async function cotizarSeleccion(exec, items, { cotizacion, excluirFacturadas = false } = {}) {
    const pedidos = new Map();
    for (const it of items || []) {
        const id = parseInt(it.ordId, 10);
        if (isNaN(id)) continue;
        const imp = (it.importe === undefined || it.importe === null || it.importe === '') ? null : Number(it.importe);
        pedidos.set(id, Number.isFinite(imp) ? r2(Math.max(0, imp)) : null);
    }
    if (!pedidos.size) throw new Error('No hay órdenes para calcular el total del retiro.');
    const faltaPendiente = [...pedidos.values()].some(v => v === null);
    const datos = await leerOrdenesParaCobro(exec, [...pedidos.keys()], { pendiente: faltaPendiente });

    const filas = [];
    for (const [ordId, importe] of pedidos) {
        const d = datos.get(ordId);
        if (!d) continue; // orden inexistente: quien arma el retiro ya la descarta
        filas.push({ ordId, codigo: d.codigo, moneda: d.moneda, importe: importe === null ? d.pendiente : importe });
    }
    if (!filas.length) throw new Error('Las órdenes del retiro no existen.');

    // Pagos online: una orden que ya tiene comprobante no se cobra acá (su deuda va por Pago de
    // Deudas en caja). Si se cobraba, caja rechazaba el registro y la plata quedaba sin anotar.
    if (excluirFacturadas) {
        const fact = await leerFacturadas(exec, filas.map(f => f.ordId));
        for (const f of filas) {
            const fa = fact.get(f.ordId);
            // Solo las que se iban a cobrar: una ya paga (su e-Ticket del cobro también es un
            // comprobante) no es «facturada» para el cliente: sale como paga (INF-SIS-2026-14, P8).
            if (fa && f.importe > 0.004) { f.importe = 0; f.facturada = fa; }
        }
    }

    const monedasACobrar = new Set(filas.filter(f => f.importe > 0.004).map(f => f.moneda));
    const mezcla = monedasACobrar.size > 1;
    const soloDolares = monedasACobrar.size
        ? (monedasACobrar.size === 1 && monedasACobrar.has('USD'))
        : filas.every(f => f.moneda === 'USD');
    const moneda = soloDolares ? 'USD' : 'UYU';

    let cot = null, cotDia = null;
    if (mezcla) {
        if (Number(cotizacion) > 1) {
            cot = Number(cotizacion);
        } else {
            const c = await cotizacionDelDia(exec);
            if (!c) throw new Error('No hay cotización del dólar cargada: no se puede pasar a pesos un retiro con órdenes en dólares.');
            cot = c.cotizacion;
            cotDia = c.dia;
        }
    }

    let dolares = 0, dolaresEnPesos = 0;
    for (const f of filas) {
        if (moneda === 'UYU' && f.moneda === 'USD' && f.importe > 0) {
            f.importeRetiro = r2(f.importe * cot);
            dolares += f.importe;
            dolaresEnPesos += f.importeRetiro;
        } else {
            f.importeRetiro = f.importe;
        }
    }
    return {
        moneda, mezcla, cotizacion: cot, cotizacionDia: cotDia,
        total: r2(filas.reduce((s, f) => s + f.importeRetiro, 0)),
        dolares: r2(dolares), dolaresEnPesos: r2(dolaresEnPesos),
        items: filas,
        facturadas: filas.filter(f => f.facturada).map(f => ({ ordId: f.ordId, codigo: f.codigo, ...f.facturada })),
    };
}

/** Mensaje para cuando todo lo elegido ya está facturado (pagos online, INF-SIS-2026-13). */
function mensajeSoloFacturadas(facturadas) {
    const lista = (facturadas || []).map(f => `${f.codigo} (${f.documento})`).join(', ');
    const varias = (facturadas || []).length > 1;
    return `${lista} ya ${varias ? 'están facturadas' : 'está facturada'}: no se ${varias ? 'pagan' : 'paga'} por acá. `
        + 'Confirmá el retiro sin pagar; si la factura tiene saldo, se paga en caja.';
}

/**
 * Pago online de un retiro, justo antes de registrarlo en caja (INF-SIS-2026-14, P3): qué órdenes
 * cobra y por cuánto. Las que ya tienen comprobante quedan fuera del cobro (caja rechaza el registro
 * entero si van adentro):
 *  - las marcadas al armar el link (`facturada`): el link no las cobró, valían 0;
 *  - las facturadas DESPUÉS de armar el link: el link sí las cobró. Esa parte de la plata no se
 *    imputa (va a la factura si tiene saldo, o queda a favor: lo decide Finanzas) y el resto se
 *    registra por las otras órdenes.
 * El reparto es proporcional a los importes del link (`orders[].amount`, en la moneda del retiro):
 * vale aunque la pasarela cobre en otra moneda (Mercado Pago pasa los dólares a pesos).
 * @param {object[]} orders — las órdenes guardadas al armar el link ({ rawId, amount, facturada? })
 * @returns {Promise<{registrar:boolean, orderNumbers?:number[], monto:number,
 *           sinImputar:null|{monto:number, ordenes:object[]}, motivo?:string}>}
 *          orderNumbers sin definir = todas las del retiro (caja las busca, como siempre).
 */
async function cobroOnlineSinFacturadas(exec, { ordenRetiroId, orders, monto }) {
    const total = r2(Number(monto) || 0);
    const hijas = (await exec.request().input('R', sql.Int, ordenRetiroId).query(
        'SELECT OrdIdOrden, RTRIM(OrdCodigoOrden) AS Codigo FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OReIdOrdenRetiro = @R')).recordset;
    const codigo = new Map(hijas.map(h => [h.OrdIdOrden, h.Codigo]));
    const delLink = (orders || []).filter(o => o && parseInt(o.rawId, 10) > 0);
    const importeDe = (o) => (o.amount === null || o.amount === undefined || o.amount === '') ? NaN : Number(o.amount);
    // El link no cobró las marcadas facturadas ni las que valían 0 (ya pagas, cubiertas o sin costo)
    const noCobrada = (o) => !!o.facturada || importeDe(o) <= 0.004;
    const excluidas = delLink.filter(noCobrada).length;
    // Las que cobró el link; los links sin el detalle por orden: todas las del retiro, sin importe
    const cobradas = delLink.length
        ? delLink.filter(o => !noCobrada(o)).map(o => ({ ordId: parseInt(o.rawId, 10), amount: importeDe(o) }))
        : hijas.map(h => ({ ordId: h.OrdIdOrden, amount: NaN }));
    const fact = await leerFacturadas(exec, cobradas.map(c => c.ordId));
    const nuevas = cobradas.filter(c => fact.has(c.ordId));
    if (!nuevas.length) {
        return { registrar: true, monto: total, sinImputar: null,
                 orderNumbers: excluidas ? cobradas.map(c => c.ordId) : undefined };
    }

    const sinImputarDe = (m) => ({
        monto: m,
        ordenes: nuevas.map(c => ({ ordId: c.ordId, codigo: codigo.get(c.ordId) || `#${c.ordId}`, ...fact.get(c.ordId) })),
    });
    const restantes = cobradas.filter(c => !fact.has(c.ordId));
    const sumaLink = cobradas.reduce((s, c) => s + c.amount, 0);
    const sumaNuevas = nuevas.reduce((s, c) => s + c.amount, 0);
    if (!restantes.length) {
        return { registrar: false, monto: total, sinImputar: sinImputarDe(total), motivo: 'todo lo que cobró el link ya está facturado' };
    }
    if (!Number.isFinite(sumaLink) || !(sumaLink > 0)) {
        return { registrar: false, monto: total, sinImputar: sinImputarDe(total), motivo: 'el link no guardó el importe de cada orden y no se puede repartir' };
    }
    const montoSinImputar = r2(total * sumaNuevas / sumaLink);
    const resto = r2(total - montoSinImputar);
    if (!(resto > 0.01)) {
        return { registrar: false, monto: total, sinImputar: sinImputarDe(total), motivo: 'todo lo que cobró el link ya está facturado' };
    }
    return { registrar: true, orderNumbers: restantes.map(c => c.ordId), monto: resto, sinImputar: sinImputarDe(montoSinImputar) };
}

/**
 * ¿Ya hay en el retiro un cobro de caja de esta transacción online? El retiro con una orden
 * facturada con saldo queda sin abonar aunque el pago se registre (sigue «pasar por caja»), así
 * que el aviso repetido de la pasarela no se ve en OrdenesRetiro.PagIdPago: se busca por las
 * órdenes, con la Tx que caja guarda en las observaciones (INF-SIS-2026-14).
 */
async function pagoOnlineYaRegistrado(exec, ordenRetiroId, txId) {
    if (!txId) return false;
    const r = await exec.request()
        .input('R', sql.Int, ordenRetiroId)
        .input('Tx', sql.NVarChar(300), `%Tx: ${txId})%`)
        .query(`
            SELECT TOP 1 1 AS Si
            FROM dbo.OrdenesDeposito od WITH(NOLOCK)
            JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagIdPago = od.PagIdPago
            JOIN dbo.TransaccionesCaja tc WITH(NOLOCK) ON tc.TcaIdTransaccion = p.PagTcaIdTransaccion
            WHERE od.OReIdOrdenRetiro = @R
              AND tc.TcaObservaciones LIKE @Tx`);
    return r.recordset.length > 0;
}

/**
 * Vuelve a calcular el total y la moneda de un retiro con el costo de sus órdenes
 * (OrdCostoFinal), convirtiendo si mezcla monedas. Reemplaza el SUM(OrdCostoFinal) sin
 * convertir que hacían al editar, sacar o cancelar una orden y al repropagar una cotización.
 * @returns la cotización del retiro (cotizarSeleccion), o null si quedó sin órdenes.
 */
async function recalcularTotalRetiro(exec, OReIdOrdenRetiro) {
    const r = await exec.request()
        .input('RetiroId', sql.Int, OReIdOrdenRetiro)
        .query('SELECT OrdIdOrden, OrdCostoFinal FROM dbo.OrdenesDeposito WHERE OReIdOrdenRetiro = @RetiroId');
    if (!r.recordset.length) return null;
    const sel = await cotizarSeleccion(exec, r.recordset.map(o => ({ ordId: o.OrdIdOrden, importe: Number(o.OrdCostoFinal) || 0 })));
    await exec.request()
        .input('RetiroId', sql.Int, OReIdOrdenRetiro)
        .input('Total', sql.Decimal(18, 2), sel.total)
        .input('Moneda', sql.VarChar(10), sel.moneda)
        .query('UPDATE dbo.OrdenesRetiro SET OReCostoTotalOrden = @Total, MonIdMoneda = @Moneda WHERE OReIdOrdenRetiro = @RetiroId');
    if (sel.mezcla) logger.info(`[RETIRO] Total de R-${OReIdOrdenRetiro} recalculado: $ ${sel.total} (US$ ${sel.dolares} @ ${sel.cotizacion}).`);
    return sel;
}

/**
 * Crea una orden de retiro completa dentro de una transacción existente.
 *
 * @param {Transaction} transaction — transacción SQL ya iniciada
 * @param {Object} params
 * @param {number[]} params.ordIds — IDs numéricos de OrdenesDeposito a incluir en el retiro
 * @param {number} params.totalCost — costo total del retiro
 * @param {number} params.lugarRetiro — ID del lugar de retiro
 * @param {number} params.usuarioAlta — ID del usuario que crea el retiro
 * @param {string} params.formaRetiro — 'RL' (Retiro Local) o 'RW' (Retiro Web)
 * @param {number} [params.codCliente] — código del cliente
 * @param {string} [params.moneda] — sugerencia; la moneda la decide cotizarSeleccion
 * @param {Object} [params.importesPorOrden] — { [OrdIdOrden]: importe en la moneda de la orden }.
 *        Si viene (aunque sea {}), el total sale de las órdenes: el importe de este mapa o, si
 *        la orden no está, su pendiente de cobro. Sin él se usa totalCost, salvo que el retiro
 *        mezcle monedas: ahí el total siempre se calcula convertido.
 * @param {number} [params.cotizacion] — cotización fija (la del pago online); sin ella, la del día
 * @returns {number} OReIdOrdenRetiro — ID del retiro creado
 */
async function crearRetiro(transaction, { ordIds, totalCost, lugarRetiro, usuarioAlta, formaRetiro, codCliente, moneda, direccion, departamento, localidad, agenciaId, importesPorOrden, cotizacion }) {
    if (!ordIds || ordIds.length === 0) {
        throw new Error('No se proporcionaron órdenes válidas para el retiro.');
    }

    // ── VALIDACIÓN: excluir órdenes que ya pertenecen a un retiro activo ──
    // Un retiro se considera "activo" si su estado NO es cancelado (6) ni anulado (10).
    // NO excluimos estado 9 de OrdenesDeposito porque ese estado se usa también para
    // marcar entregas, y excluirlo permitía pisar órdenes ya entregadas (bug RW13394).
    const checkParams = ordIds.map((_, i) => `@dup${i}`).join(',');
    const dupReq = transaction.request();
    ordIds.forEach((id, i) => dupReq.input(`dup${i}`, sql.Int, id));
    const dupRes = await dupReq.query(`
        SELECT od.OrdIdOrden FROM OrdenesDeposito od WITH(NOLOCK)
        JOIN OrdenesRetiro r WITH(NOLOCK) ON r.OReIdOrdenRetiro = od.OReIdOrdenRetiro
        WHERE od.OrdIdOrden IN (${checkParams})
          AND od.OReIdOrdenRetiro IS NOT NULL
          AND od.OrdEstadoActual NOT IN (6)
          AND r.OReEstadoActual NOT IN (6)
    `);
    const yaAsignadas = new Set(dupRes.recordset.map(r => r.OrdIdOrden));
    const ordIdsLibres = ordIds.filter(id => !yaAsignadas.has(id));
    if (ordIdsLibres.length === 0) {
        throw new Error('Todas las órdenes seleccionadas ya pertenecen a un retiro activo.');
    }
    if (yaAsignadas.size > 0) {
        logger.warn(`[crearRetiro] ${yaAsignadas.size} orden(es) ya asignadas a otro retiro, se excluyen: ${[...yaAsignadas].join(', ')}`);
    }
    ordIds = ordIdsLibres;

    // Datos del cliente (iguales para todas las órdenes del retiro)
    const tipoRes = await transaction.request()
        .input('OrdId', sql.Int, ordIds[0])
        .query(`
        SELECT c.TClIdTipoCliente, c.CodCliente, o.CliIdCliente, tc.TClDescripcion
            FROM OrdenesDeposito o WITH(NOLOCK)
            JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
            LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            WHERE o.OrdIdOrden = @OrdId
        `);
    const tipoCliente     = tipoRes.recordset[0]?.TClIdTipoCliente || 1;
    const tipoClienteDesc = tipoRes.recordset[0]?.TClDescripcion   || '';
    const CliIdCliente    = tipoRes.recordset[0]?.CliIdCliente     || null;
    const finalCodCliente = codCliente || tipoRes.recordset[0]?.CodCliente || null;

    // Datos de CADA orden: producto, cantidad y si ya tiene pago
    const ordParamsClause = ordIds.map((_, i) => `@ord${i}`).join(',');
    const ordDataReq = transaction.request();
    ordIds.forEach((id, i) => ordDataReq.input(`ord${i}`, sql.Int, id));
    const ordDataRes = await ordDataReq.query(`
        SELECT od.OrdIdOrden, od.ProIdProducto, od.OrdCantidad, od.PagIdPago, od.MonIdMoneda, od.OrdCostoFinal,
               o.EstadoDependencia,
               -- Pagada según la cobranza (mismo cruce que getPickupOrders del portal)
               CASE WHEN EXISTS (SELECT 1 FROM dbo.PedidosCobranza pc WITH(NOLOCK)
                                 WHERE pc.NoDocERP = od.OrdCodigoOrden AND pc.EstadoCobro = 'Pagado')
                    THEN 1 ELSE 0 END AS CobPagado
        FROM   dbo.OrdenesDeposito od WITH(NOLOCK)
        LEFT JOIN dbo.Ordenes o WITH(NOLOCK) ON o.CodigoOrden = od.OrdCodigoOrden
        WHERE  od.OrdIdOrden IN (${ordParamsClause})
    `);
    const ordenesData  = ordDataRes.recordset;
    const pagoExistenteId = ordenesData.find(o => o.PagIdPago)?.PagIdPago || null;

    // ── MONEDA Y TOTAL DEL RETIRO (cotizarSeleccion) ────────────────────────
    // Las órdenes son la fuente de verdad: todas a cobrar en dólares → dólares; si no, pesos,
    // con los dólares convertidos. El parámetro `moneda` es solo una sugerencia.
    const sel = await cotizarSeleccion(transaction,
        ordIds.map(id => ({ ordId: id, importe: importesPorOrden ? importesPorOrden[id] : undefined })),
        { cotizacion });
    const monedaFinal = sel.moneda;
    const monedaOrden = new Map(sel.items.map(i => [i.ordId, i.moneda]));
    let costoTotal = totalCost || 0;
    if (importesPorOrden || sel.mezcla) {
        if (Math.abs(r2(costoTotal) - sel.total) > 0.009) {
            logger.info(`[crearRetiro] Total calculado con las órdenes: ${costoTotal} → ${monedaFinal} ${sel.total}${sel.mezcla ? ` (US$ ${sel.dolares} @ ${sel.cotizacion})` : ''}`);
        }
        costoTotal = sel.total;
    }
    if (moneda && String(moneda).toUpperCase() !== monedaFinal) {
        logger.warn(`[crearRetiro] Moneda corregida: parámetro='${moneda}' → según las órdenes='${monedaFinal}'${sel.mezcla ? ' (pesos y dólares)' : ''}`);
    }

    // ── CONTROL DE ENTREGA: estado inicial del retiro según COBERTURA ────────────
    //
    //  El retiro nace CUBIERTO (no pasa por caja) solo si TODAS sus órdenes están
    //  cubiertas. Si queda alguna sin cobertura verificable → estado 1 (FRENA, caja).
    //  Reemplaza el viejo bypass ciego de tipo 2/3 (que autorizaba sin verificar nada).
    //
    //  Cobertura y estado resultante:
    //    ABONADO (3)    — pago previo, plan de metros activo, o ROLLO con la orden a costo 0.
    //                     ROLLO: la cobertura la define el COSTO de cada orden — costo 0 = la
    //                     cubrió el rollo → pasa; costo > 0 = fuera del rollo → debe pagar.
    //    AUTORIZADO (9) — crédito: ciclo semanal abierto, o PLATA adelantada (anticipo) con
    //                     saldo LIMPIO >= 0 (ver calcularAdelantoLimpio; NO usa el CueSaldoActual
    //                     roto). El débito ORDEN ya corrió al INGRESO → el chequeo es
    //                     "adelanto >= 0", no ">= costo".
    //    FRENA (1)      — sin ninguna cobertura → pasa por caja.

    const esRollo = /ROLLO/i.test(tipoClienteDesc || '');

    // Semanal (tipo 2) O rollo que ADEMÁS opera a crédito (ciclo abierto): se le fía y se
    // cobra al cierre del ciclo → NO frena aunque la orden tenga costo. Hay clientes tipo 3
    // (rollo) con ciclo de crédito abierto: sus órdenes con costo son CRÉDITO, no fuga.
    let tieneCicloSemanal = false;
    if (tipoCliente === 2 || esRollo) {
        tieneCicloSemanal = await verificarCicloSemanal(transaction, CliIdCliente);
    }

    // Las cubiertas por pago/plan/rollo dejan el retiro ABONADO; las que quedan necesitan
    // CRÉDITO (ciclo o plata) → AUTORIZADO. Si a alguna no la cubre nada → FRENA.
    const ordenesQueNecesitanCredito = [];
    for (const orden of ordenesData) {
        if (orden.PagIdPago) continue; // ya pagada
        if (orden.CobPagado) {
            logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} pagada según la cobranza → cubierta, pasa.`);
            continue;
        }
        // Costo 0 = no hay nada que cobrar → no frena en el pago (cualquier tipo de cliente).
        // Antes solo pasaba si era rollo o si el libro mostraba metros descontados; si no,
        // el retiro nacía FRENADO pidiendo pagar $0.
        if ((parseFloat(orden.OrdCostoFinal) || 0) <= 0) {
            logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} con costo 0 → nada que cobrar, pasa.`);
            continue;
        }

        // Devolución de excedente de tela cliente: SIEMPRE $0 por diseño, nunca pasa por
        // caja aunque el cliente no tenga plan/rollo/billetera abiertos (ver
        // telaClienteDevolucionFisicaService.js — antes esto se resolvía con un INSERT a
        // mano en OrdenesRetiro para esquivar este mismo motor; ahora entra por acá).
        if (orden.EstadoDependencia === 'DEVOLUCION_TELA_CLIENTE') {
            logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} es devolución de tela cliente (costo $0) → cubierta, pasa.`);
            continue;
        }

        // ── ROLLO POR ADELANTADO: la cobertura la define el COSTO de la orden ──
        // El motor de contabilización (check-in a DEPOSITO) deja OrdCostoFinal = 0
        // cuando el rollo/plan de metros cubrió la orden, y OrdCostoFinal > 0 cuando
        // NO la cubrió (rollo agotado, sin recurso comprado, o producto fuera del plan).
        // Por eso el costo es la señal fiable: costo 0 = cubierta por el rollo → pasa;
        // costo > 0 = fuera del rollo → debe pagar (NO se autoriza por ser tipo rollo).
        // Antes 'tienePlanHistorico' dejaba pasar TODA orden del rollo, tuviera costo o no.
        if (esRollo) {
            const costoOrden = parseFloat(orden.OrdCostoFinal) || 0;
            if (costoOrden <= 0) {
                logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} cubierta por rollo (costo 0) → pasa.`);
                continue;
            }
            // Costo VIEJO (cotizado antes de comprar el rollo) pero el LIBRO muestra los
            // metros ya descontados de un plan → está cubierta, no se cobra de nuevo.
            if (await ordenCubiertaPorLibro(transaction, orden.OrdIdOrden)) {
                logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} de rollo con costo ${costoOrden} pero metros YA descontados según el libro → cubierta, pasa.`);
                continue;
            }
            logger.warn(`[RETIRO] Orden ${orden.OrdIdOrden} de rollo con costo ${costoOrden} (fuera del rollo) → requiere pago o crédito (ciclo abierto).`);
            ordenesQueNecesitanCredito.push(orden);
            continue;
        }

        if (orden.ProIdProducto) {
            // plan de metros ACTIVO → rollo positivo
            const recurso = await verificarRecursoCliente(transaction, { CliIdCliente, ProIdProducto: orden.ProIdProducto });
            if (recurso.tieneRecurso) {
                logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} cubierta por plan activo #${recurso.planId}`);
                continue;
            }
        }

        // Billetera: cuenta RESTRINGIDA de dinero ("rollo en plata") → misma cobertura que el plan
        const ctaRestr = await verificarCuentaRestringida(transaction, { CliIdCliente, OrdIdOrden: orden.OrdIdOrden, ProIdProducto: orden.ProIdProducto });
        if (ctaRestr.cubierta) {
            logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} cubierta por cuenta restringida #${ctaRestr.cueId} (${ctaRestr.motivo})`);
            continue;
        }

        // Costo 0 y el LIBRO muestra los metros ya descontados de un plan (aunque el
        // plan se haya cerrado al consumir los últimos metros) → cubierta, no frena
        // en caja con $0 a cobrar.
        if ((parseFloat(orden.OrdCostoFinal) || 0) <= 0
            && await ordenCubiertaPorLibro(transaction, orden.OrdIdOrden)) {
            logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} con costo 0 y metros descontados según el libro → cubierta, pasa.`);
            continue;
        }

        ordenesQueNecesitanCredito.push(orden);
    }

    let estadoOrdenRetiro;

    if (ordenesQueNecesitanCredito.length === 0) {
        estadoOrdenRetiro = 3; // todo cubierto por pago / plan / rollo → Abonado

    } else {
        // ¿Las cubre el CRÉDITO? Ciclo semanal, o plata adelantada (saldo limpio >= 0).
        // La plata adelantada se mira en la moneda de cada orden: si el retiro mezcla, las de
        // dólares contra la cuenta en dólares y las de pesos contra la de pesos.
        let cubiertoPorCredito = tieneCicloSemanal;
        let detalle = 'ciclo semanal';
        if (!cubiertoPorCredito) {
            const monedasCredito = [...new Set(ordenesQueNecesitanCredito.map(o => monedaOrden.get(o.OrdIdOrden) || monedaFinal))];
            const detalles = [];
            cubiertoPorCredito = true;
            for (const mon of monedasCredito) {
                const { adelanto, tieneAnticipo } = await calcularAdelantoLimpio(transaction, CliIdCliente, mon);
                if (!(tieneAnticipo && adelanto >= -0.01)) cubiertoPorCredito = false;
                detalles.push(`adelanto ${mon}=${adelanto.toFixed(2)} (tieneAnticipo=${tieneAnticipo})`);
            }
            detalle = detalles.join(', ');
        }

        if (cubiertoPorCredito) {
            estadoOrdenRetiro = 9; // Autorizado (crédito: ciclo semanal o plata adelantada)
            logger.info(`[RETIRO] Cli ${CliIdCliente}: ${ordenesQueNecesitanCredito.length} orden(es) cubiertas por crédito (${detalle}) → Autorizado.`);
        } else {
            estadoOrdenRetiro = 1; // sin plan, sin rollo, sin crédito → FRENA a caja
            logger.warn(`[RETIRO] Cli ${CliIdCliente}: ${ordenesQueNecesitanCredito.length} orden(es) sin cobertura (${detalle}) → estado 1 (FRENA a caja).`);
        }
    }

    // Estados "cubiertos" (NO pasan por caja): 3 Abonado, 4 Abonado de antemano, 9 Autorizado.
    // Los cubiertos dejan PagIdPago = 0 (centinela "cubierto sin efectivo"); estado 1 → NULL (aparece en caja).
    const retiroCubierto = [3, 4, 9].includes(estadoOrdenRetiro);

    // 1. Id del retiro, por secuencia (ver nota arriba: el MAX+1 con UPDLOCK
    //    serializaba la creación de retiros durante toda la transacción)
    const OReIdOrdenRetiro = await proximoId(transaction, 'Seq_OrdenesRetiro');

    // 2. INSERT OrdenesRetiro (con CodCliente, MonIdMoneda, FormaRetiro, PagIdPago si ya está pago)
    await transaction.request()
        .input('OReId', sql.Int, OReIdOrdenRetiro)
        .input('Costo', sql.Float, costoTotal)
        .input('Lugar', sql.Int, lugarRetiro)
        .input('Estado', sql.Int, estadoOrdenRetiro)
        .input('Usr', sql.Int, usuarioAlta)
        .input('FormaRetiro', sql.VarChar(2), formaRetiro || 'RL')
        .input('CodCliente', sql.Int, finalCodCliente)
        .input('Moneda', sql.VarChar(10), monedaFinal)
        .input('Dir', sql.NVarChar(500), direccion || null)
        .input('Depto', sql.NVarChar(200), departamento || null)
        .input('Loc', sql.NVarChar(200), localidad || null)
        .input('AgenciaId', sql.Int, agenciaId ? parseInt(agenciaId, 10) : null)
        .input('PagIdExistente', sql.Int, retiroCubierto ? (pagoExistenteId || 0) : pagoExistenteId)
        .query(`
            INSERT INTO OrdenesRetiro 
                (OReIdOrdenRetiro, OReCostoTotalOrden, LReIdLugarRetiro, OReFechaAlta, OReUsuarioAlta, OReEstadoActual, OReFechaEstadoActual, FormaRetiro, CodCliente, MonIdMoneda, DireccionEnvio, DepartamentoEnvio, LocalidadEnvio, AgenciaEnvio, PagIdPago)
            VALUES 
                (@OReId, @Costo, @Lugar, GETDATE(), @Usr, @Estado, GETDATE(), @FormaRetiro, @CodCliente, @Moneda, @Dir, @Depto, @Loc, @AgenciaId, @PagIdExistente)
        `);


    // 3. INSERT HistoricoEstadosOrdenesRetiro (estado inicial)
    await transaction.request()
        .input('OReId', sql.Int, OReIdOrdenRetiro)
        .input('Estado', sql.Int, estadoOrdenRetiro)
        .input('Usr', sql.Int, usuarioAlta)
        .query(`
            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            VALUES (@OReId, @Estado, GETDATE(), @Usr)
        `);

    // 4. Ids de RelOrdenesRetiroOrdenes, uno por línea, también por secuencia
    for (const ordId of ordIds) {
        const nextRelId = await proximoId(transaction, 'Seq_RelOrdenesRetiroOrdenes');
        await transaction.request()
            .input('RelId', sql.Int, nextRelId)
            .input('RetiroId', sql.Int, OReIdOrdenRetiro)
            .input('OrdenId', sql.Int, ordId)
            .query(`
                INSERT INTO RelOrdenesRetiroOrdenes (RORIdOrdenRetiroOrden, OReIdOrdenRetiro, OrdIdOrden)
                VALUES (@RelId, @RetiroId, @OrdenId)
            `);
    }

    // 5. UPDATE OrdenesDeposito (estado=4, asignar lugar y retiroId)
    //    + INSERT HistoricoEstadosOrdenes
    for (const ordId of ordIds) {
        await transaction.request()
            .input('OrdId', sql.Int, ordId)
            .input('Lugar', sql.Int, lugarRetiro)
            .input('RetiroId', sql.Int, OReIdOrdenRetiro)
            .input('Usr', sql.Int, usuarioAlta)
            .input('PagId', sql.Int, retiroCubierto ? 0 : null)
            .query(`
                UPDATE OrdenesDeposito SET 
                    LReIdLugarRetiro = @Lugar, 
                    OReIdOrdenRetiro = @RetiroId,
                    OrdEstadoActual = 9, 
                    OrdFechaEstadoActual = GETDATE(),
                    PagIdPago = ISNULL(PagIdPago, @PagId)
                WHERE OrdIdOrden = @OrdId;

                INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                VALUES (@OrdId, 9, GETDATE(), @Usr);
            `);
    }

    // Si el retiro incluye alguna devolución de tela cliente, cerrar su seguimiento acá
    // — es el único lugar donde nace el retiro real para ese tipo de orden (ver arriba).
    const ordIdsDevolucion = ordenesData
        .filter(o => o.EstadoDependencia === 'DEVOLUCION_TELA_CLIENTE' && ordIds.includes(o.OrdIdOrden))
        .map(o => o.OrdIdOrden);
    if (ordIdsDevolucion.length > 0) {
        try {
            await transaction.request()
                .input('RetiroId', sql.Int, OReIdOrdenRetiro)
                .query(`
                    UPDATE t SET Estado = 'ENVIADA', OReIdOrdenRetiro = @RetiroId,
                                 FechaResolucion = ISNULL(FechaResolucion, GETDATE())
                    FROM dbo.TelaClienteEventos t
                    JOIN dbo.Ordenes o ON o.OrdenID = t.OrdenGeneradaID
                    JOIN dbo.OrdenesDeposito od ON od.OrdCodigoOrden = o.CodigoOrden
                    WHERE od.OrdIdOrden IN (${ordIdsDevolucion.join(',')})
                      AND t.Tipo = 'SOLICITUD_CLIENTE' AND t.Estado = 'EN_DEPOSITO'
                `);
        } catch (eTev) {
            logger.warn(`[RETIRO] No se pudo cerrar el seguimiento de devolución de tela cliente: ${eTev.message}`);
        }
    }

    return OReIdOrdenRetiro;
}

/**
 * Marca un retiro y todas sus órdenes hijas como entregadas.
 * Centraliza la lógica que estaba duplicada en 4 funciones distintas.
 *
 * @param {Transaction|Request} transactionOrReq — transacción SQL o request
 * @param {number} OReIdOrdenRetiro — ID numérico del retiro
 * @param {Date} fecha — fecha de entrega
 * @param {number} usuarioId — ID del usuario que entrega
 */
async function marcarEntregado(transactionOrReq, OReIdOrdenRetiro, fecha, usuarioId) {
    // Soportar tanto transaction.request() como new sql.Request(transaction)
    const request = typeof transactionOrReq.request === 'function'
        ? transactionOrReq.request()
        : new sql.Request(transactionOrReq);

    await request
        .input('ID', sql.Int, OReIdOrdenRetiro)
        .input('Fec', sql.DateTime, fecha)
        .input('Usr', sql.Int, usuarioId)
        .query(`
            INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            SELECT OrdIdOrden, 9, @Fec, @Usr FROM OrdenesDeposito WHERE OReIdOrdenRetiro = @ID;

            UPDATE OrdenesDeposito SET OrdEstadoActual = 9, OrdFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;

            UPDATE OrdenesRetiro SET OReEstadoActual = 5, ORePasarPorCaja = 0, OReFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;

            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) 
            VALUES (@ID, 5, @Fec, @Usr);

            -- Liberar estante automáticamente al entregar.
            -- [26/10/2026] El código del retiro (RT-34959) se calcula ANTES y se borra por ese valor. Con la
            -- subconsulta dentro del WHERE, SQL Server recorría TODO IX_OcupacionEstantes_OrdenRetiro tomando
            -- un candado U en cada fila (Index Scan) y dos entregas a la vez se cruzaban: deadlocks del 26/10
            -- a las 16:07 (RT-34959 y RT-34956). Con la variable va directo a la fila (Index Seek).
            DECLARE @Ret VARCHAR(50) = COALESCE((SELECT RTRIM(FormaRetiro) FROM OrdenesRetiro WHERE OReIdOrdenRetiro = @ID), 'R')
                                       + '-' + CAST(@ID AS VARCHAR(12));
            DELETE FROM OcupacionEstantes WHERE OrdenRetiro = @Ret;
        `);

    // [25/09] Los bultos de las órdenes del retiro salen de Depósito: hasta ahora la entrega no los
    // tocaba y quedaban "en stock" para siempre (24.494 bultos de 24.374 órdenes entregadas entre el
    // 12/06 y el 25/09 seguían figurando en Stock Depósito). Incluye las reposiciones y fallas de cada
    // orden (DTF-22306 → DTF-22306-R1…), que salen con la madre. Mismo estado que el cierre de
    // encomiendas (ENTREGADO en CLIENTE_FINAL) y un movimiento de salida por bulto. Si esto falla, la
    // entrega sigue: es registro de logística, no puede frenar al cliente en el mostrador.
    try {
        const reqBultos = typeof transactionOrReq.request === 'function'
            ? transactionOrReq.request()
            : new sql.Request(transactionOrReq);
        await reqBultos
            .input('ID', sql.Int, OReIdOrdenRetiro)
            .input('Fec', sql.DateTime, fecha)
            .input('Usr', sql.Int, usuarioId)
            .query(`
                DECLARE @salen TABLE (CodigoEtiqueta NVARCHAR(100) COLLATE DATABASE_DEFAULT, Ubicacion NVARCHAR(100) COLLATE DATABASE_DEFAULT);
                DECLARE @Ret VARCHAR(30) = ISNULL((SELECT RTRIM(FormaRetiro) FROM OrdenesRetiro WHERE OReIdOrdenRetiro = @ID), 'R') + '-' + CAST(@ID AS VARCHAR);
                WITH base AS (
                    SELECT o.OrdenID, o.CodigoOrden
                    FROM OrdenesDeposito od JOIN Ordenes o ON o.CodigoOrden = od.OrdCodigoOrden
                    WHERE od.OReIdOrdenRetiro = @ID
                    UNION
                    SELECT o.OrdenID, o.CodigoOrden
                    FROM OrdenesDeposito od JOIN Ordenes o ON o.NoDocERP = od.OrdCodigoOrden
                    WHERE od.OReIdOrdenRetiro = @ID
                ), ords AS (
                    SELECT OrdenID FROM base
                    UNION
                    SELECT h.OrdenID FROM base
                    JOIN Ordenes h ON h.CodigoOrden LIKE REPLACE(REPLACE(REPLACE(base.CodigoOrden, '[', '[[]'), '%', '[%]'), '_', '[_]') + '-%'
                )
                UPDATE b SET b.Estado = 'ENTREGADO', b.UbicacionActual = 'CLIENTE_FINAL'
                OUTPUT INSERTED.CodigoEtiqueta, DELETED.UbicacionActual INTO @salen
                FROM Logistica_Bultos b
                WHERE b.OrdenID IN (SELECT OrdenID FROM ords)
                  AND ISNULL(b.Tipocontenido, '') <> 'ENCOMIENDA'
                  AND b.Estado = 'EN_STOCK' AND b.UbicacionActual IN ('DEPOSITO', 'LOGISTICA');

                INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
                SELECT CodigoEtiqueta, 'SALIDA', Ubicacion, @Usr, @Fec, 'Entregado al cliente con el retiro ' + @Ret, 'EN_STOCK', 'ENTREGADO', 0
                FROM @salen;
            `);
    } catch (errBultos) {
        // [26/10] Un deadlock no se traga: SQL Server ya deshizo toda la transacción, así que seguir con la
        // entrega sería trabajar sobre nada. Sube para que el que llama reintente el retiro entero.
        if (esDeadlock(errBultos)) throw errBultos;
        logger.warn(`[RETIRO] No se pudieron cerrar los bultos del retiro ${OReIdOrdenRetiro}: ${errBultos.message}`);
    }

    // Sincronización global con stateManagerService
    try {
        const { changeOrderState } = require('./stateManagerService');
        // Make sure to reuse the same request or create a new one safely
        const syncReq = typeof transactionOrReq.request === 'function' ? transactionOrReq.request() : new (require('mssql')).Request(transactionOrReq);
        // El JOIN con OR (od.OrdCodigoOrden = o.NoDocERP OR = o.CodigoOrden) obligaba a recorrer casi
        // todo Ordenes × OrdenesDeposito: ningún índice sirve para un OR en el ON, y esto corre UNA VEZ
        // POR RETIRO — era el grueso de los 75s que tardaba la entrega múltiple (y el bloqueo que
        // tumbaba Caja/CFE/estantes). Partido en dos ramas UNION, cada una sí usa índice.
        // UNION (no ALL) deduplica, así que el resultado es el mismo.
        const mainOrdersRes = await syncReq
            .input('RetiroID', require('mssql').Int, OReIdOrdenRetiro)
            .query(`
                SELECT o.OrdenID
                FROM OrdenesDeposito od WITH(NOLOCK)
                INNER JOIN Ordenes o WITH(NOLOCK) ON o.NoDocERP = od.OrdCodigoOrden
                WHERE od.OReIdOrdenRetiro = @RetiroID
                UNION
                SELECT o.OrdenID
                FROM OrdenesDeposito od WITH(NOLOCK)
                INNER JOIN Ordenes o WITH(NOLOCK) ON o.CodigoOrden = od.OrdCodigoOrden
                WHERE od.OReIdOrdenRetiro = @RetiroID
            `);
            
        for (const row of mainOrdersRes.recordset) {
            await changeOrderState(transactionOrReq, {
                target: { type: 'ORDER', id: row.OrdenID },
                estado: 'Entregado',
                userObj: usuarioId || 'Sistema',
                detalle: 'Estado global sincronizado (Retiro Entregado)'
            });
        }
    } catch (syncErr) {
        if (esDeadlock(syncErr)) throw syncErr;   // [26/10] ídem bultos: que se reintente el retiro
        console.error('Error sincronizando estado global a Entregado en marcarEntregado:', syncErr);
    }
}

/**
 * Registra un pago para un retiro, actualiza estados y hace auto-cierre si corresponde.
 * Centraliza la lógica que estaba duplicada en pagosController y webRetirosController.
 *
 * @param {Transaction} transaction — transacción SQL ya iniciada
 * @param {Object} params
 * @param {number} params.ordenRetiroId — ID numérico del retiro
 * @param {number} params.metodoPagoId — ID del método de pago
 * @param {number} params.monedaId — ID de la moneda
 * @param {number} params.monto — monto del pago
 * @param {number[]} [params.orderNumbers] — IDs de OrdenesDeposito a actualizar
 * @param {number} params.usuarioId — ID del usuario que registra el pago
 * @param {number} params.nuevoEstado — estado nuevo del retiro (3=Abonado, 8=Empaquetado y abonado)
 * @returns {{ pagoId: number }} — ID del pago creado
 */
/**
 * Corre `fn` recién cuando la transacción de mssql se confirma (evento 'commit'); si se
 * deshace (rollback propio o del servidor por timeout/deadlock, evento 'rollback') no corre
 * nunca. Si `transaction` no es una transacción (un pool), corre enseguida.
 */
function alConfirmar(transaction, fn) {
    if (!transaction || typeof transaction.commit !== 'function' || typeof transaction.once !== 'function') {
        fn();
        return;
    }
    const onCommit = () => { transaction.removeListener('rollback', onRollback); fn(); };
    const onRollback = () => { transaction.removeListener('commit', onCommit); };
    transaction.once('commit', onCommit);
    transaction.once('rollback', onRollback);
}

async function registrarPago(transaction, { ordenRetiroId, metodoPagoId, monedaId, monto, orderNumbers, usuarioId, nuevoEstado }) {
    // 1. INSERT Pagos
    const createReq = typeof transaction.request === 'function'
        ? transaction.request()
        : new sql.Request(transaction);

    const pagoResult = await createReq
        .input('metodoPagoId', sql.Int, metodoPagoId)
        .input('monedaId', sql.Int, monedaId)
        .input('monto', sql.Float, monto)
        .input('fecha', sql.DateTime, new Date())
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
            INSERT INTO Pagos (MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago, PagUsuarioAlta)
            OUTPUT INSERTED.PagIdPago
            VALUES (@metodoPagoId, @monedaId, @monto, @fecha, @usuarioId)
        `);

    const pagoId = pagoResult.recordset[0].PagIdPago;

    // 2. UPDATE OrdenesRetiro (estado + PagIdPago)
    const updateRetReq = typeof transaction.request === 'function'
        ? transaction.request()
        : new sql.Request(transaction);

    await updateRetReq
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .input('nuevoEstado', sql.Int, nuevoEstado)
        .input('pagoId', sql.Int, pagoId)
        .query(`
            UPDATE OrdenesRetiro 
            SET PagIdPago = @pagoId, 
                OReEstadoActual = CASE WHEN OReEstadoActual = 5 THEN 5 ELSE @nuevoEstado END,
                OReFechaEstadoActual = GETDATE(), ORePasarPorCaja = 0
            WHERE OReIdOrdenRetiro = @ordenRetiroId;
        `);

    // 3. INSERT Histórico retiro
    const histRetReq = typeof transaction.request === 'function'
        ? transaction.request()
        : new sql.Request(transaction);

    await histRetReq
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .input('nuevoEstado', sql.Int, nuevoEstado)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            VALUES (@ordenRetiroId, @nuevoEstado, GETDATE(), @usuarioId);
        `);

    // 4. UPDATE OrdenesDeposito + Histórico (si hay orderNumbers)
    if (orderNumbers && orderNumbers.length > 0) {
        const updateReq = typeof transaction.request === 'function'
            ? transaction.request()
            : new sql.Request(transaction);

        updateReq.input('pagoId', sql.Int, pagoId);
        updateReq.input('Usr', sql.Int, usuarioId);
        orderNumbers.forEach((oid, i) => updateReq.input(`oid${i}`, sql.Int, parseInt(oid, 10)));
        const inClause = orderNumbers.map((_, i) => `@oid${i}`).join(',');

        // El pago vincula PagIdPago SIEMPRE, pero solo promueve a 7 si la orden no está resuelta:
        // un pago tardío NO debe "des-entregar" una orden ya retirada (9) ni revivir una
        // cancelada/perdida (10/11). Historial solo si el estado cambió.
        await updateReq.query(`
            DECLARE @cambios TABLE (OrdIdOrden INT, EstadoViejo INT, EstadoNuevo INT);

            UPDATE OrdenesDeposito
            SET PagIdPago = @pagoId,
                OrdEstadoActual      = CASE WHEN OrdEstadoActual IN (9,10,11) THEN OrdEstadoActual ELSE 7 END,
                OrdFechaEstadoActual = CASE WHEN OrdEstadoActual IN (9,10,11) THEN OrdFechaEstadoActual ELSE GETDATE() END
            OUTPUT inserted.OrdIdOrden, deleted.OrdEstadoActual, inserted.OrdEstadoActual INTO @cambios
            WHERE OrdIdOrden IN (${inClause});

            INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            SELECT OrdIdOrden, EstadoNuevo, GETDATE(), @Usr
            FROM @cambios WHERE EstadoViejo <> EstadoNuevo;
        `);

        // Sincronizar la vista de cobranza de forma desacoplada (no retiene locks), pero recién
        // cuando el pago queda confirmado: si la transacción se deshace, la cobranza no se toca
        // (antes se disparaba con el pago todavía abierto y quedaba "Pagado" aunque el pago se
        // revirtiera; 08/10/2026). Es el mismo criterio que caja, que la sincroniza post-commit.
        alConfirmar(transaction, () => {
            marcarCobranzaPagada(null, orderNumbers).catch(e =>
                logger.warn(`[RETIRO] Sincronización de cobranza falló: ${e.message}`)
            );
        });
    }

    // 5. AUTO-CIERRE: si todas las órdenes hijas están pagas → estado 4 (Abonado)
    const checkReq = typeof transaction.request === 'function'
        ? transaction.request()
        : new sql.Request(transaction);

    const todasPagasRes = await checkReq
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .query(`
            SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN od.PagIdPago IS NOT NULL THEN 1 ELSE 0 END) AS pagas
            FROM OrdenesDeposito od WITH(NOLOCK)
            WHERE od.OReIdOrdenRetiro = @ordenRetiroId
              AND od.OrdEstadoActual NOT IN (6, 9)
        `);

    const { total, pagas } = todasPagasRes.recordset[0];

    if (total > 0 && total === pagas) {
        const cierreReq = typeof transaction.request === 'function'
            ? transaction.request()
            : new sql.Request(transaction);

        await cierreReq
            .input('ordenRetiroId', sql.Int, ordenRetiroId)
            .input('pagoId', sql.Int, pagoId)
            .input('usuarioId', sql.Int, usuarioId)
            .query(`
                UPDATE OrdenesRetiro 
                SET PagIdPago = @pagoId, 
                    OReEstadoActual = CASE WHEN OReEstadoActual = 5 THEN 5 ELSE 4 END,
                    OReFechaEstadoActual = GETDATE(), ORePasarPorCaja = 0
                WHERE OReIdOrdenRetiro = @ordenRetiroId
                  AND (PagIdPago IS NULL OR PagIdPago = 0 OR OReEstadoActual = 5);

                INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                VALUES (@ordenRetiroId, 4, GETDATE(), @usuarioId);
            `);

        logger.info(`[AUTO-PAGO] OrdenRetiro R-${ordenRetiroId} marcada como Abonada automáticamente.`);
    }

    return { pagoId };
}

module.exports = { crearRetiro, marcarEntregado, registrarPago, cotizarSeleccion, leerFacturadas, mensajeSoloFacturadas, leerOrdenesParaCobro, cobroOnlineSinFacturadas, pagoOnlineYaRegistrado, ordenesQueQuedanDebiendo, cerrarRetiroSiNoDebe, marcarOrdenesDeDocumentosPagas, recalcularTotalRetiro, cotizacionDelDia };
