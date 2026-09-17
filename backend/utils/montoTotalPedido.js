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

module.exports = { SQL_RECALC_MONTO_TOTAL, totalesCobranzaDeOrden, totalDelPedido, importeOrdenParaDeposito };
