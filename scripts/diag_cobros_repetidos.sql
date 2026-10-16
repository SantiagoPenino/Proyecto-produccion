-- ============================================================================
-- diag_cobros_repetidos.sql        SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- Busca el mismo cobro registrado VARIAS VECES en la caja: mismo cliente, mismo
-- importe, en el mismo minuto, con recibos distintos y todos COBRADOS.
--
-- Caso testigo - elea (cliente 257), 02/09/2026 16:14, en CUATRO segundos:
--     RC-000654  Tca 9778  16:14:18.687  COBRADO  US$ 655,13  ($ 26.755,31)
--     RC-000656  Tca 9779  16:14:21.160  COBRADO  US$ 655,13  ($ 26.755,31)
--     RC-000658  Tca 9780  16:14:22.327  COBRADO  US$ 655,13  ($ 26.755,31)
-- A la cuenta corriente se aplicaron 655,13 + 159,75 + 0,00 = US$ 814,88 (el
-- total del PC-2854, que quedo saldado). Pero la CAJA quedo con TRES cobros de
-- $ 26.755,31 = $ 80.265,93 cuando el cliente pago una sola vez.
--
-- Por eso el tercer recibo se ve en el Estado de Cuenta con la columna ABONO en
-- blanco: no le quedaba deuda que aplicar.
--
-- ESTO NO DESCUADRA LA CUENTA CORRIENTE - descuadra el ARQUEO DE CAJA.
--
-- Panel 1: resumen. Panel 2: el detalle de cada grupo, para cotejar con el arqueo.
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Desde DATE = '2026-06-01';   -- acotar si se quiere mirar solo lo reciente

;WITH R AS (
    SELECT t.TcaIdTransaccion, t.TcaClienteId, t.TcaFecha, t.TcaTotalCobrado, t.TcaMonedaBase,
           Recibo = RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc),
           -- mismo cliente + mismo importe + mismo MINUTO = mismo cobro repetido
           Grupo = DENSE_RANK() OVER (ORDER BY t.TcaClienteId, t.TcaTotalCobrado,
                                               CONVERT(VARCHAR(16), t.TcaFecha, 120)),
           N = COUNT(*) OVER (PARTITION BY t.TcaClienteId, t.TcaTotalCobrado,
                                           CONVERT(VARCHAR(16), t.TcaFecha, 120))
    FROM dbo.TransaccionesCaja t
    WHERE RTRIM(t.TcaSerieDoc) LIKE 'RC%'
      AND ISNULL(t.TcaEstado,'') NOT IN ('ANULADO','ANULADA')
      AND t.TcaTotalCobrado > 0.01
      AND t.TcaFecha >= @Desde
)
SELECT Panel = '1 - RESUMEN', Repeticiones = R.N,
       Casos = COUNT(DISTINCT R.Grupo), Recibos = COUNT(*),
       CobradoDeMas = CAST(SUM(R.TcaTotalCobrado * (R.N - 1.0) / R.N) AS DECIMAL(18,2))
FROM R WHERE R.N > 1
GROUP BY R.N ORDER BY R.N DESC;

;WITH R AS (
    SELECT t.TcaIdTransaccion, t.TcaClienteId, t.TcaFecha, t.TcaTotalCobrado, t.TcaMonedaBase,
           Recibo = RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc),
           N = COUNT(*) OVER (PARTITION BY t.TcaClienteId, t.TcaTotalCobrado,
                                           CONVERT(VARCHAR(16), t.TcaFecha, 120))
    FROM dbo.TransaccionesCaja t
    WHERE RTRIM(t.TcaSerieDoc) LIKE 'RC%'
      AND ISNULL(t.TcaEstado,'') NOT IN ('ANULADO','ANULADA')
      AND t.TcaTotalCobrado > 0.01
      AND t.TcaFecha >= @Desde
)
SELECT Panel = '2 - DETALLE', Cliente = RTRIM(cl.Nombre), R.TcaClienteId,
       R.Recibo, R.TcaIdTransaccion, R.TcaFecha, R.TcaMonedaBase,
       Cobrado = CAST(R.TcaTotalCobrado AS DECIMAL(18,2)),
       VecesEnEseMinuto = R.N,
       PagosDelRecibo = ISNULL((SELECT SUM(p.PagMontoPago) FROM dbo.Pagos p
                                WHERE p.PagTcaIdTransaccion = R.TcaIdTransaccion), 0),
       -- Lo que este recibo realmente movio en la cuenta corriente. Si es 0, ese
       -- cobro no aplico a ninguna deuda: es plata que entro a caja sin destino.
       AplicadoALaCuenta = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                   JOIN dbo.Pagos p2 ON p2.PagIdPago = m.PagIdPago
                                   WHERE p2.PagTcaIdTransaccion = R.TcaIdTransaccion
                                     AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
FROM R
JOIN dbo.Clientes cl ON cl.CliIdCliente = R.TcaClienteId
WHERE R.N > 1
ORDER BY R.TcaFecha DESC, R.Recibo;
