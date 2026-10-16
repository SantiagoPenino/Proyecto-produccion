-- ============================================================================
-- PROD_camilo_pc3576_a_deuda.sql
-- ----------------------------------------------------------------------------
-- CORRER DESPUES de PROD_fix_camilo7008_ABC.sql.
--
-- Administracion confirma que el PC-3576 (US$ 389,91) TAMPOCO se cobro, asi que
-- tiene que quedar como deuda.
--
-- >>> LEER ESTO ANTES DE CORRERLO <<<
-- El PC-3576 tiene una TRANSACCION DE CAJA COBRADA:
--       Tca 10476 · recibo PC-3576 · 27/08/2026 15:39:32
--       $ 15.920,03 / 40,83 = US$ 389,91 · Contado · COBRADO
--       Pago 63649
--
-- Si ese cobro no existio, esa plata NO puede quedar en la caja: el arqueo del
-- 27/08 tendria $ 15.920,03 que nunca entraron. Por eso este script anula las
-- DOS cosas a la vez — la caja y el cobro en la cuenta corriente. Si se anulara
-- solo una, quedaria descuadrado.
--
-- SI EL COBRO SI ENTRO y lo que pasa es que se aplico al documento equivocado,
-- NO corras esto: hay que mover ese cobro al documento que corresponde, que es
-- otra cosa. Avisame y lo armamos.
--
-- QUE HACE:
--   1. Anula la transaccion de caja 10476 y su pago (la plata sale del arqueo)
--   2. Anula el pago espejo del PC-3576 en la cuenta corriente (US$ 389,91)
--   3. Saca la imputacion del cobro sobre la deuda
--   4. Deja la deuda en 389,91 PENDIENTE y el documento sin pagar
--
-- COMO QUEDA:
--       cuenta 11   (US$)   -31,81  ->  -421,72   = 389,91 + 31,81
--       cuenta 1534 ($)    -270,00  ->  -270,00   (sin cambios)
--
--       Los TRES pendientes, como pidio administracion:
--             PC-2877  $   270,00
--             PC-3576  US$ 389,91
--             PC-4026  US$  31,81
--
--       Y el arqueo del 27/08 baja $ 15.920,03, que es la contrapartida.
--
-- Idempotente: si ya esta anulado, aborta y avisa.
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli INT = 4;
DECLARE @CueUsd INT = 11, @CuePesos INT = 1534;
DECLARE @Doc3576 INT = 9628;
DECLARE @Deuda3576 INT = 11279;
DECLARE @Importe DECIMAL(18,4) = 389.91;
DECLARE @Usuario INT = 11;
DECLARE @Tca INT, @EnPesos DECIMAL(18,4);

-- ══ CANDADOS ═══════════════════════════════════════════════════════════════

-- 1 · el documento tiene que ser el PC-3576 vivo de CAMILO, con su caja
SELECT @Tca = d.TcaIdTransaccion
FROM dbo.DocumentosContables d
WHERE d.DocIdDocumento = @Doc3576 AND d.CliIdCliente = @Cli
  AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) = '3576'
  AND ISNULL(d.DocEstado,'') <> 'ANULADO'
  AND ABS(d.DocTotal - @Importe) <= 0.01;

IF @Tca IS NULL
BEGIN
    RAISERROR('El PC-3576 no esta como esperabamos (vivo, del cliente 4, por 389,91, con transaccion de caja). Puede que ya se haya corregido. No se toca nada.', 16, 1);
    RETURN;
END

-- 2 · la caja tiene que estar viva (si ya esta anulada, no hay nada que hacer)
SELECT @EnPesos = t.TcaTotalCobrado
FROM dbo.TransaccionesCaja t
WHERE t.TcaIdTransaccion = @Tca
  AND ISNULL(t.TcaEstado,'') NOT IN ('ANULADO','ANULADA');

IF @EnPesos IS NULL
BEGIN
    RAISERROR('La caja del PC-3576 ya esta anulada. No se toca nada.', 16, 1);
    RETURN;
END

-- 3 · esa caja no puede estar cobrando ademas otros documentos
IF (SELECT COUNT(*) FROM dbo.DocumentosContables WHERE TcaIdTransaccion = @Tca) > 1
BEGIN
    SELECT Alerta = 'LA CAJA COBRA VARIOS DOCUMENTOS',
           Documento = RTRIM(DocSerie) + '-' + RTRIM(DocNumero), DocTotal
    FROM dbo.DocumentosContables WHERE TcaIdTransaccion = @Tca;
    RAISERROR('Esa transaccion de caja cobra MAS de un documento (ver arriba). Anularla afectaria a los otros. Revisar a mano. No se toca nada.', 16, 1);
    RETURN;
END

-- 4 · los pagos de esa caja no pueden estar imputados a OTRAS deudas
IF EXISTS (SELECT 1 FROM dbo.ImputacionPago ip
           JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
           WHERE p.PagTcaIdTransaccion = @Tca AND ip.DDeIdDocumento <> @Deuda3576)
BEGIN
    RAISERROR('Los pagos de esa caja tambien estan imputados a OTRA deuda. Sacarlos la desbalancearia. Revisar a mano. No se toca nada.', 16, 1);
    RETURN;
END

-- ══ ANTES ══════════════════════════════════════════════════════════════════
SELECT Momento = 'ANTES - CUENTAS', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

SELECT Momento = 'ANTES - LA CAJA QUE SE ANULA', t.TcaIdTransaccion,
       Recibo = RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc),
       Fecha = t.TcaFecha, Cobrado = CAST(t.TcaTotalCobrado AS DECIMAL(18,2)),
       t.TcaMonedaBase, t.TcaEstado
FROM dbo.TransaccionesCaja t WHERE t.TcaIdTransaccion = @Tca;

-- ══ EL ARREGLO ══════════════════════════════════════════════════════════════
BEGIN TRANSACTION;

    -- 1 · La caja: la plata sale del arqueo
    UPDATE dbo.TransaccionesCaja
    SET TcaEstado = 'ANULADO',
        TcaFechaAnulacion = GETDATE(),
        TcaUsuarioAnula = @Usuario,
        TcaObservaciones = LEFT(LTRIM(ISNULL(TcaObservaciones,'') +
            ' | ANULADO 2026-09-09: administracion confirmo que el PC-3576 no se cobro.' +
            ' Esta plata no entro: sale del arqueo del 27/08.'), 500)
    WHERE TcaIdTransaccion = @Tca;

    UPDATE dbo.Pagos
    SET PagTipoMovimiento = 'ANULADO'
    WHERE PagTcaIdTransaccion = @Tca;

    -- 2 · El cobro en la cuenta corriente
    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' FIX_CAMILO_3576_2026-09-09: administracion confirmo que este pedido no se cobro.' +
            ' Se anula el cobro y se anula tambien su caja (Tca ' + CONVERT(VARCHAR(20), @Tca) +
            ', $ ' + CONVERT(VARCHAR(30), CAST(@EnPesos AS DECIMAL(18,2))) + '). Queda PENDIENTE.'), 500)
    FROM dbo.MovimientosCuenta m
    WHERE m.DocIdDocumento = @Doc3576
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
      AND m.MovImporte > 0;

    -- 3 · Las imputaciones sobre esa deuda
    DELETE FROM dbo.ImputacionPago WHERE DDeIdDocumento = @Deuda3576;

    -- 4 · La deuda vuelve por el total
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = DDeImporteOriginal,
        DDeEstado = 'PENDIENTE',
        DDeFechaCobro = NULL,
        DDeObservaciones = LEFT(LTRIM(ISNULL(DDeObservaciones,'') +
            ' FIX_CAMILO_3576_2026-09-09: administracion confirmo que no se cobro.' +
            ' Se anularon el cobro y su transaccion de caja. Queda PENDIENTE.'), 500)
    WHERE DDeIdDocumento = @Deuda3576;

    UPDATE dbo.DocumentosContables SET DocPagado = 0 WHERE DocIdDocumento = @Doc3576;

    -- Saldo corrido y saldo de cuenta (convencion de la casa)
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (@CueUsd, @CuePesos) AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

COMMIT TRANSACTION;

-- ══ DESPUES ════════════════════════════════════════════════════════════════
-- Esperado:  cuenta 11 (US$) = -421,72   |   cuenta 1534 ($) = -270,00
SELECT Momento = 'DESPUES - CUENTAS', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

-- Los TRES pendientes
SELECT Momento = 'DESPUES - LOS TRES', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Total = CAST(d.DocTotal AS DECIMAL(18,2)), d.DocPagado,
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- La caja anulada, para el arqueo
SELECT Momento = 'DESPUES - LA CAJA', t.TcaIdTransaccion,
       Recibo = RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc),
       Fecha = t.TcaFecha, Cobrado = CAST(t.TcaTotalCobrado AS DECIMAL(18,2)),
       t.TcaEstado, t.TcaFechaAnulacion,
       Aviso = 'el arqueo del 27/08 baja $ ' + CONVERT(VARCHAR(30), CAST(t.TcaTotalCobrado AS DECIMAL(18,2)))
FROM dbo.TransaccionesCaja t WHERE t.TcaIdTransaccion = @Tca;

SELECT Momento = 'CONTROL',
       DeudaUsd = CAST(389.91 + 31.81 AS DECIMAL(18,2)),
       SaldoCuentaUsd = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       Cuadra = CASE WHEN ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) + 421.72) <= 0.02
                     THEN 'SI' ELSE 'NO - revisar' END;
