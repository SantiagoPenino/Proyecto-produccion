// Sumas de PedidosCobranzaDetalle con conversión de moneda.
//
// Un pedido puede tener líneas en monedas DISTINTAS a la de su cabecera: en ECOUV la
// impresión se cotiza en USD y las terminaciones (ojales, soldadura) salen de la lista de
// precios en UYU. Sumar `Subtotal` en crudo trata esos pesos como dólares y multiplica el
// total por ~40 (EUV-13767: 19.75 + 300 + 540 = 859.75 US$ cuando el pedido eran 40.30).
// El error espejo — quedarse con UNA línea — pierde las terminaciones (EUV-14157: 18.00
// en vez de 39.98).
//
// Es la misma conversión que hace la pantalla de cotización al guardar
// (quotationController, "Recalcular MontoTotal sumando TODAS las líneas"); acá se replica
// para los recálculos de contabilidad, retiros, WMS, depósito y etiquetas, que la hacían
// en crudo.
const sql = require('mssql');

// Cotización del día, con 40 de piso si Cotizaciones estuviera vacía o en 0.
const T_SQL_COTIZ = `
    DECLARE @Cotiz DECIMAL(18,4) =
        ISNULL((SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC), 40);
    IF (@Cotiz IS NULL OR @Cotiz = 0) SET @Cotiz = 40;`;

// Convierte el Subtotal de una línea a @MFinal. Requiere las columnas Moneda y Subtotal
// en alcance con el alias que se le pase.
const conversion = (alias) => `
    CASE
        WHEN @MFinal = 'USD' AND ${alias}Moneda = 'UYU' THEN ${alias}Subtotal / @Cotiz
        WHEN @MFinal = 'UYU' AND ${alias}Moneda = 'USD' THEN ${alias}Subtotal * @Cotiz
        ELSE ${alias}Subtotal
    END`;

/**
 * Moneda REAL del Subtotal de una línea del pedido (expresión SQL, para SELECTs de lectura).
 *
 * La pre-factura mostraba todas las líneas con la moneda de la CABECERA: en EUV-19358
 * (pedido en USD) los ojales — 32 × $U 30 = $U 960 — salían como US$ 960 en vez de US$ 23,51.
 *
 * No alcanza con leer la etiqueta de la línea: hay datos viejos donde la etiqueta está mal y
 * el Subtotal ya está en la moneda del pedido (julio/2026: líneas 'USD' con importe en pesos;
 * artículo 21: líneas 'UYU' con importe en dólares). Decide el TOTAL del pedido: si MontoTotal
 * es la suma en crudo de las líneas facturables, están todas en la moneda de la cabecera; si
 * no (el total se armó convirtiendo), manda la etiqueta de la línea.
 *
 * @param pc alias de PedidosCobranza   @param d alias de PedidosCobranzaDetalle
 */
const sqlMonedaLinea = (pc, d) => `
    CASE
        WHEN ${pc}.Moneda IS NULL OR NULLIF(LTRIM(RTRIM(${d}.Moneda)), '') IS NULL
             OR UPPER(LTRIM(RTRIM(${d}.Moneda))) = UPPER(LTRIM(RTRIM(${pc}.Moneda))) THEN ${pc}.Moneda
        WHEN UPPER(LTRIM(RTRIM(${d}.Moneda))) IN ('USD', 'UYU')
             AND ABS(ISNULL(${pc}.MontoTotal, 0) - ISNULL((
                    SELECT SUM(mlx.Subtotal) FROM dbo.PedidosCobranzaDetalle mlx WITH(NOLOCK)
                    WHERE mlx.PedidoCobranzaID = ${pc}.ID
                      AND ISNULL(mlx.EsHermanaConsolidada, 0) = 0
                      AND ISNULL(mlx.EsFacturable, 1) = 1), 0)) > 0.02
             THEN UPPER(LTRIM(RTRIM(${d}.Moneda)))
        ELSE ${pc}.Moneda
    END`;

// ── Pedido PARTIDO en varias órdenes (multitela: SUB-23364 (1/2), (2/2)…) ───────────────
// Cada orden entra a Depósito con SU importe y tiene SU cargo en la cuenta. Pero la
// pre-factura, la cotización y el guardado de precios nacieron con "un cargo = el pedido
// entero". Regla única para que las dos épocas convivan:
//
//   a un cargo le toca TODO el pedido, MENOS las líneas de las órdenes hermanas que ya
//   tienen su asiento propio.
//
// Pedido de una sola orden, o pedido viejo donde solo una orden recibió cargo (las hermanas
// quedaron sin asiento): le toca el pedido entero, igual que siempre. Pedido nuevo con un
// cargo por orden: a cada uno le tocan solo sus líneas.

/**
 * Condición SQL: la orden `ordenId` ya tiene asiento propio (cargo en dinero, metros de plan
 * o consumo de billetera) en las cuentas del cliente `cli`. El OrdIdOrden de los movimientos
 * apunta a DOS tablas (Ordenes u OrdenesDeposito): se miran los dos ids, siempre dentro del
 * mismo cliente. `movExcluir` (opcional): un movimiento que no cuenta (el propio).
 */
// (Dos EXISTS con igualdades simples, uno por cada id: así cada uno entra por el índice de
// MovimientosCuenta.OrdIdOrden. Con un solo IN que mezclaba los dos ids la pre-factura de un
// cliente con 284 cargos pendientes no terminaba — medido.)
const sqlOrdenTieneAsiento = (ordenId, cli, movExcluir = null) => {
    const filtro = (mh) => `
              AND ${mh}.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO', 'ENTREGA', 'CONSUMO_CUENTA')
              ${movExcluir ? `AND ${mh}.MovIdMovimiento <> ${movExcluir}` : ''}
              AND EXISTS (SELECT 1 FROM dbo.CuentasCliente cch WITH(NOLOCK)
                          WHERE cch.CueIdCuenta = ${mh}.CueIdCuenta AND cch.CliIdCliente = ${cli})`;
    return `(
        EXISTS (
            SELECT 1 FROM dbo.MovimientosCuenta mh1 WITH(NOLOCK)
            WHERE mh1.OrdIdOrden = ${ordenId}${filtro('mh1')}
        )
        OR EXISTS (
            SELECT 1 FROM dbo.Ordenes oh WITH(NOLOCK)
            JOIN dbo.OrdenesDeposito odh WITH(NOLOCK) ON odh.OrdCodigoOrden = oh.CodigoOrden
            JOIN dbo.MovimientosCuenta mh2 WITH(NOLOCK) ON mh2.OrdIdOrden = odh.OrdIdOrden
            WHERE oh.OrdenID = ${ordenId}${filtro('mh2')}
        )
    )`;
};

/**
 * Condición SQL: la línea `d` del pedido le toca al cargo `m` (ver regla de arriba).
 * `m` = alias de MovimientosCuenta, `d` = alias de PedidosCobranzaDetalle, `cli` = cliente.
 *
 * Va en un CASE a propósito: se evalúa en orden, así que en el caso de siempre (la línea es de
 * la orden del cargo) corta en la primera rama y no consulta nada más.
 */
const sqlLineaTocaAlCargo = (m, d, cli) => `(1 = CASE
        WHEN ${d}.OrdenID IS NULL OR ${d}.OrdenID = ${m}.OrdIdOrden THEN 1
        -- el cargo puede estar anotado con el id de OrdenesDeposito de esa misma orden
        WHEN EXISTS (SELECT 1 FROM dbo.Ordenes op WITH(NOLOCK)
                     JOIN dbo.OrdenesDeposito odp WITH(NOLOCK) ON odp.OrdCodigoOrden = op.CodigoOrden
                     WHERE op.OrdenID = ${d}.OrdenID AND odp.OrdIdOrden = ${m}.OrdIdOrden) THEN 1
        -- hermana con asiento propio: sus líneas van con SU cargo
        WHEN ${sqlOrdenTieneAsiento(`${d}.OrdenID`, cli, `${m}.MovIdMovimiento`)} THEN 0
        ELSE 1 END)`;

/**
 * Subconsulta SQL (escalar): importe de las líneas del pedido `pedidoId` que NO le tocan al
 * cargo `m` — las de órdenes hermanas con asiento propio —, en la moneda de la cabecera
 * (`monedaPedido`), convirtiendo con `cot`. El cargo vale MontoTotal menos esto.
 */
const sqlImporteDeOtrasOrdenes = ({ pedidoId, monedaPedido, cot, m, cli }) => `
    ISNULL((
        -- Se suma por moneda y se convierte AFUERA: SQL Server no admite mezclar columnas
        -- de la consulta de afuera (la moneda del pedido) dentro de un SUM.
        SELECT CASE
                 WHEN ${monedaPedido} = 'USD' THEN sx.Usd + sx.Otr + sx.Uyu / ${cot}
                 WHEN ${monedaPedido} = 'UYU' THEN sx.Uyu + sx.Otr + sx.Usd * ${cot}
                 ELSE sx.Usd + sx.Uyu + sx.Otr END
        FROM (
            SELECT ISNULL(SUM(CASE WHEN dx.Moneda = 'USD' THEN dx.Subtotal ELSE 0 END), 0) AS Usd,
                   ISNULL(SUM(CASE WHEN dx.Moneda = 'UYU' THEN dx.Subtotal ELSE 0 END), 0) AS Uyu,
                   ISNULL(SUM(CASE WHEN dx.Moneda IN ('USD', 'UYU') THEN 0 ELSE dx.Subtotal END), 0) AS Otr
            FROM dbo.PedidosCobranzaDetalle dx WITH(NOLOCK)
            WHERE dx.PedidoCobranzaID = ${pedidoId}
              AND ISNULL(dx.EsHermanaConsolidada, 0) = 0
              AND ISNULL(dx.EsFacturable, 1) = 1
              AND NOT ${sqlLineaTocaAlCargo(m, 'dx', cli)}
        ) sx
    ), 0)`;

/**
 * ¿Esta orden de un pedido partido quedó SIN su cargo al entrar a Depósito?
 *
 * La marca PedidosCobranza.MontoContabilizado es del PEDIDO y la deja la primera orden que
 * pasa; como cada orden asienta solo SUS líneas, las hermanas encontraban el pedido ya
 * marcado y no asentaban nada (SUB-23364 (1/2): US$ 80,50 entregados sin cargo). Devuelve
 * true cuando la orden tiene líneas propias para asentar y todavía ningún asiento, salvo
 * que los cargos de sus hermanas ya cubran el pedido entero (pedidos de la época "un cargo
 * por pedido", o cargos ya sincronizados al total): ahí asentarla sería cobrarla dos veces.
 */
const ordenHermanaSinCargo = async (pool, pedidoId, ordenId) => {
    const r = await pool.request()
        .input('PID', sql.Int, pedidoId)
        .input('OID', sql.Int, ordenId)
        .query(`
            ${T_SQL_COTIZ}
            DECLARE @MFinal VARCHAR(10) = ISNULL((SELECT Moneda FROM dbo.PedidosCobranza WITH(NOLOCK) WHERE ID = @PID), 'UYU');
            DECLARE @Cli INT = (
                SELECT TOP 1 COALESCE(NULLIF(o.CliIdCliente, 0),
                       (SELECT TOP 1 c.CliIdCliente FROM dbo.Clientes c WITH(NOLOCK) WHERE c.CodCliente = TRY_CAST(o.CodCliente AS INT)))
                FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.OrdenID = @OID);

            SELECT
                (SELECT COUNT(DISTINCT d.OrdenID) FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
                  WHERE d.PedidoCobranzaID = @PID AND d.OrdenID IS NOT NULL) AS Ordenes,
                (SELECT COUNT(*) FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
                  WHERE d.PedidoCobranzaID = @PID AND d.OrdenID = @OID AND ISNULL(d.EsHermanaConsolidada, 0) = 0
                    AND (ISNULL(d.Subtotal, 0) > 0 OR ISNULL(d.Cantidad, 0) > 0)) AS LineasPropias,
                (SELECT ISNULL(SUM(${conversion('d.')}), 0) FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
                  WHERE d.PedidoCobranzaID = @PID AND d.OrdenID = @OID AND ISNULL(d.EsHermanaConsolidada, 0) = 0) AS ImportePropio,
                (SELECT MontoTotal FROM dbo.PedidosCobranza WITH(NOLOCK) WHERE ID = @PID) AS MontoTotal,
                CASE WHEN @Cli IS NOT NULL AND ${sqlOrdenTieneAsiento('@OID', '@Cli')} THEN 1 ELSE 0 END AS TieneAsiento,
                @Cli AS CliIdCliente,
                -- Cargos en dinero de las hermanas, llevados a la moneda del pedido
                (SELECT ISNULL(SUM(CASE
                            WHEN @MFinal = 'USD' AND ISNULL(cc.MonIdMoneda, 1) = 1 THEN ABS(mv.MovImporte) / @Cotiz
                            WHEN @MFinal = 'UYU' AND cc.MonIdMoneda = 2            THEN ABS(mv.MovImporte) * @Cotiz
                            ELSE ABS(mv.MovImporte) END), 0)
                   FROM dbo.MovimientosCuenta mv WITH(NOLOCK)
                   JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = mv.CueIdCuenta
                  WHERE cc.CliIdCliente = @Cli
                    AND mv.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
                    AND (mv.MovAnulado IS NULL OR mv.MovAnulado = 0)
                    AND mv.OrdIdOrden IN (SELECT d.OrdenID FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
                                           WHERE d.PedidoCobranzaID = @PID AND d.OrdenID IS NOT NULL AND d.OrdenID <> @OID)) AS CargosHermanas;
        `);
    const x = r.recordset[0] || {};
    if (!(Number(x.Ordenes) > 1) || !(Number(x.LineasPropias) > 0)) return false;   // pedido de una orden, o sin líneas propias
    if (!x.CliIdCliente || Number(x.TieneAsiento) === 1) return false;              // ya asentada (o cliente inexistente)
    const total = parseFloat(x.MontoTotal) || 0;
    const yaCargado = (parseFloat(x.CargosHermanas) || 0) + (parseFloat(x.ImportePropio) || 0);
    return yaCargado <= total * 1.01 + 0.05;
};

/**
 * Recalcula PedidosCobranza.MontoTotal. Espera un parámetro @PID (int) con el ID del pedido.
 *
 * "Comprar y personalizar": las líneas hermanas (EMB/DF/TPU/EST) siguen excluidas — ya están
 * incluidas dentro del subtotal de la línea de PRO. Una línea destildada como NO facturable
 * (EsFacturable = 0) tampoco suma: no se le cobra al cliente ni sale en la factura (misma
 * regla que la cotización al guardar y que el "Nuevo Total" de la pantalla).
 */
const SQL_RECALC_MONTO_TOTAL = `
    ${T_SQL_COTIZ}
    DECLARE @MFinal VARCHAR(10) =
        ISNULL((SELECT Moneda FROM dbo.PedidosCobranza WITH(NOLOCK) WHERE ID = @PID), 'UYU');

    UPDATE dbo.PedidosCobranza
    SET MontoTotal = (
        SELECT ISNULL(SUM(${conversion('d.')}), 0)
        FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
        WHERE d.PedidoCobranzaID = @PID
          AND ISNULL(d.EsHermanaConsolidada, 0) = 0
          AND ISNULL(d.EsFacturable, 1) = 1
    )
    WHERE ID = @PID;
`;

/**
 * Cantidad, importe y producto que le corresponden a UNA orden dentro de su pedido,
 * sumando TODAS sus líneas de cobranza convertidas a una sola moneda.
 *
 * Solo cuenta las líneas de la cabecera VIGENTE del pedido de la orden (la más nueva si
 * hubiera duplicadas). Sin esa restricción la suma queda inflada: hay datos legacy
 * (junio/2026, caso DF-179) donde hasta 32 líneas de cabeceras ajenas apuntan al mismo
 * OrdenID.
 *
 * @param monedaDestino 'USD' | 'UYU', o null/undefined para tomar la de la cabecera del
 *                      pedido al que pertenecen las líneas.
 * @returns { Cant, Imp, Prod } — Imp ya redondeado a 2 decimales.
 */
const totalesCobranzaDeOrden = async (pool, ordenId, monedaDestino = null) => {
    const mon = (monedaDestino || '').toUpperCase();
    const r = await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('MonParam', sql.VarChar(10), (mon === 'USD' || mon === 'UYU') ? mon : null)
        .query(`
            ${T_SQL_COTIZ}
            DECLARE @PedId INT = (
                SELECT TOP 1 p.ID
                FROM dbo.PedidosCobranza p WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK)
                  ON LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(p.NoDocERP AS VARCHAR(50))))
                WHERE o.OrdenID = @OID
                ORDER BY p.ID DESC);

            DECLARE @MFinal VARCHAR(10) = @MonParam;
            IF @MFinal IS NULL
                SET @MFinal = ISNULL((
                    SELECT Moneda FROM dbo.PedidosCobranza WITH(NOLOCK) WHERE ID = @PedId), 'UYU');

            SELECT SUM(Cantidad)               AS Cant,
                   SUM(${conversion('')})      AS Imp,
                   MIN(ProIdProducto)          AS Prod
            FROM dbo.PedidosCobranzaDetalle WITH(NOLOCK)
            WHERE OrdenID = @OID
              AND PedidoCobranzaID = @PedId;
        `);
    const row = r.recordset[0] || {};
    return {
        Cant: row.Cant,
        Imp: row.Imp == null ? null : Math.round(parseFloat(row.Imp) * 100) / 100,
        Prod: row.Prod,
    };
};

/**
 * Total real del PEDIDO COMPLETO (todas las líneas de TODAS sus órdenes, sin las
 * hermanas ya consolidadas), convertido a una moneda — mismo cálculo que
 * SQL_RECALC_MONTO_TOTAL pero de lectura y por NoDocERP en vez de por PedidoCobranzaID.
 *
 * Para "comprar y personalizar" facturado "por área" (marcador [FACTURA POR AREA]):
 * cada área cobra su propia línea y la orden de Producción — la ÚNICA que el cliente
 * retira físicamente por Depósito — queda a propósito con su línea en $0. Sin esto,
 * `totalesCobranzaDeOrden` (que solo mira las líneas de ESA orden) le da al ingreso a
 * Depósito y al aviso de WhatsApp un costo $0, y el cliente se lleva el pedido sin
 * pagar nada. Con el modo "consolidado" (sin el marcador) esto da el mismo resultado
 * que `totalesCobranzaDeOrden` de la orden de Producción, porque ya tiene todo sumado.
 */
const totalDelPedido = async (pool, noDocERP, monedaDestino = null) => {
    const mon = (monedaDestino || '').toUpperCase();
    const r = await pool.request()
        .input('Doc', sql.NVarChar(50), String(noDocERP || '').trim())
        .input('MonParam', sql.VarChar(10), (mon === 'USD' || mon === 'UYU') ? mon : null)
        .query(`
            ${T_SQL_COTIZ}
            DECLARE @PedId INT, @PedMoneda VARCHAR(10);
            SELECT TOP 1 @PedId = ID, @PedMoneda = Moneda FROM dbo.PedidosCobranza WITH(NOLOCK)
                WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc)) ORDER BY ID DESC;

            DECLARE @MFinal VARCHAR(10) = ISNULL(@MonParam, @PedMoneda);
            IF @MFinal IS NULL SET @MFinal = 'UYU';

            SELECT ISNULL(SUM(${conversion('d.')}), 0) AS Imp
            FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
            WHERE d.PedidoCobranzaID = @PedId
              AND ISNULL(d.EsHermanaConsolidada, 0) = 0;
        `);
    const row = r.recordset[0] || {};
    return { Imp: row.Imp == null ? null : Math.round(parseFloat(row.Imp) * 100) / 100 };
};

/**
 * [POR ÁREA] Cantidad, importe y producto con los que una orden entra a DEPÓSITO.
 *
 * Igual que `totalesCobranzaDeOrden`, salvo un caso: la orden madre PRO de un pedido cobrado
 * POR ÁREA (marcador [FACTURA POR AREA] en su nota). Ahí cada área cobra su propia línea
 * (el bordado, el DTF, el estampado… y en "Comprar y personalizar" también los artículos, que
 * son líneas de la madre), pero la ÚNICA que el cliente retira por Depósito es la madre: entra
 * con el TOTAL del pedido. Antes solo se hacía cuando la línea de la madre valía 0; desde que
 * la madre lleva los artículos del carrito ya no vale 0 y los bordados quedaban sin cobrar.
 */
const importeOrdenParaDeposito = async (pool, ordenId, monedaDestino = null) => {
    const lin = await totalesCobranzaDeOrden(pool, ordenId, monedaDestino);
    try {
        const o = (await pool.request().input('OID', sql.Int, ordenId).query(`
            SELECT TOP 1 LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) AS NoDoc, Magnitud, ProIdProducto,
                   (SELECT TOP 1 a.ProIdProducto FROM dbo.Articulos a WITH(NOLOCK)
                     WHERE LTRIM(RTRIM(a.CodArticulo)) = 'PPERS' AND ISNULL(a.borrar, 0) = 0) AS ProdPPERS
            FROM dbo.Ordenes WITH(NOLOCK)
            WHERE OrdenID = @OID AND AreaID = 'PRO' AND ComboItemID IS NULL
              AND ISNULL(EstadoDependencia, '') <> 'VENTA_DIRECTA'
              AND Nota LIKE '%[[]FACTURA POR AREA]%'
        `)).recordset[0];
        if (!o?.NoDoc) return lin;
        const pedido = await totalDelPedido(pool, o.NoDoc, monedaDestino);
        const imp = parseFloat(pedido?.Imp);
        // Cantidad = prendas del pedido (Magnitud de la madre), no la suma de sus líneas: con los
        // artículos del carrito la madre tiene PPERS + el artículo, y sumaba las prendas dos veces.
        // Producto = el de la madre; la de prenda del cliente no tiene → genérico PPERS.
        const mag = parseFloat(o.Magnitud);
        return {
            ...lin,
            Imp: imp > 0 ? imp : lin.Imp,
            Cant: mag > 0 ? mag : lin.Cant,
            Prod: o.ProIdProducto || o.ProdPPERS || lin.Prod,
            porArea: true,
        };
    } catch (e) {
        return lin;
    }
};

module.exports = { SQL_RECALC_MONTO_TOTAL, sqlMonedaLinea, sqlOrdenTieneAsiento, sqlLineaTocaAlCargo, sqlImporteDeOtrasOrdenes, ordenHermanaSinCargo, totalesCobranzaDeOrden, totalDelPedido, importeOrdenParaDeposito };
