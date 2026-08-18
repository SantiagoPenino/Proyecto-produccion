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
 * incluidas dentro del subtotal de la línea de PRO.
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

module.exports = { SQL_RECALC_MONTO_TOTAL, totalesCobranzaDeOrden };
