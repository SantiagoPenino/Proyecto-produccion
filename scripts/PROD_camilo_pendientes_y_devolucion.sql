-- ============================================================================
-- PROD_camilo_pendientes_y_devolucion.sql
-- ----------------------------------------------------------------------------
-- CAMILO-7008 (CliIdCliente 4). Hace DOS cosas que van juntas:
--
--   (1) Deja PENDIENTES los tres documentos, como pidio administracion:
--           PC-2877  ($   270,00)
--           PC-3576  (US$ 389,91)
--           PC-4026  (US$  31,81)
--       Hoy los dos de dolares figuran cobrados, pero no entro plata: se
--       taparon con el saldo a favor de la nota de credito NC-11
--       (ANTICIPO_APLICADO, sin caja). El PC-3576 ademas tiene un "pago espejo"
--       sin recibo, o sea que estaba cobrado dos veces.
--
--   (2) Descuenta de la cuenta corriente la DEVOLUCION EN EFECTIVO de la
--       nota de credito NC-11 (US$ 541,27).
--
-- >>> IMPORTANTE — EL ORDEN <<<
-- La salida de plata de la CAJA se registra POR PANTALLA, no por este script:
--       Caja -> Egreso -> tipo "Devolucion a Cliente" -> US$ 541,27
-- Ese tipo ya esta configurado y apunta a la cuenta 2.3.1 Anticipos de
-- Clientes, que es el asiento correcto:
--       2.3.1 Anticipos de Clientes   541,27
--          a  1.1.2 Caja ME (USD)              541,27
-- La pantalla genera el egreso, su documento y su asiento — pero NO toca la
-- cuenta corriente del cliente (verificado en registrarEgreso). Eso lo hace
-- este script.
--
-- Registra el egreso PRIMERO, anota su numero de egreso y ponelo abajo en
-- @EgrIdEgreso. Si lo dejas en NULL el script corre igual, pero el movimiento
-- queda sin el vinculo al egreso y hay que atarlo despues a mano.
--
-- COMO QUEDA:
--       cuenta 11   (US$)  +119,55  ->  -421,72   = 389,91 + 31,81, lo que debe
--       cuenta 1534 ($)    -270,00  ->  -270,00   (sin cambios)
--
--       Sin saldo a favor: se le devolvio la plata de la nota de credito y
--       quedan los tres pedidos para cobrar. Es la foto que pidio administracion.
--
-- Idempotente: si los tres ya estan pendientes, esa parte no hace nada; si la
-- devolucion ya se asento, aborta y avisa.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli INT = 4;
DECLARE @CueUsd INT = 11, @CuePesos INT = 1534;
DECLARE @Devolucion DECIMAL(18,4) = 541.27;    -- el total de la NC-11
DECLARE @DocNC INT = 6360;                     -- la nota de credito NC-11

-- ⇩⇩ PONE ACA el numero de egreso que te dio la pantalla (o deja NULL) ⇩⇩
DECLARE @EgrIdEgreso INT = NULL;
-- ⇧⇧ ------------------------------------------------------------- ⇧⇧

-- ══ CANDADOS ═══════════════════════════════════════════════════════════════

-- 1 · la NC-11 tiene que existir, viva y por 541,27
IF NOT EXISTS (SELECT 1 FROM dbo.DocumentosContables
               WHERE DocIdDocumento = @DocNC AND CliIdCliente = @Cli
                 AND RTRIM(DocSerie) = 'NC' AND ABS(DocTotal - @Devolucion) <= 0.01
                 AND ISNULL(DocEstado,'') <> 'ANULADO')
BEGIN
    RAISERROR('La NC-11 no esta como esperabamos (viva, del cliente 4, por 541,27). No se toca nada.', 16, 1);
    RETURN;
END

-- 2 · la devolucion no puede estar ya asentada
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
           WHERE CueIdCuenta = @CueUsd AND (MovAnulado IS NULL OR MovAnulado = 0)
             AND MovTipo = 'AJUSTE' AND ABS(MovImporte + @Devolucion) <= 0.01
             AND MovObservaciones LIKE '%DEVOLUCION_NC11%')
BEGIN
    RAISERROR('La devolucion de la NC-11 YA esta asentada en la cuenta. No se duplica. No se toca nada.', 16, 1);
    RETURN;
END

-- 3 · si se indico un egreso, tiene que existir, estar vivo y ser por el mismo importe
IF @EgrIdEgreso IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.EgresosCaja
                   WHERE EgrIdEgreso = @EgrIdEgreso
                     AND ISNULL(EgrEstado,'') NOT IN ('ANULADO','ANULADA')
                     AND ABS(EgrMonto - @Devolucion) <= 0.01)
    BEGIN
        RAISERROR('El egreso indicado no existe, esta anulado, o no es por 541,27. Revisar el numero. No se toca nada.', 16, 1);
        RETURN;
    END
END

-- Los dos documentos de dolares que tienen que quedar pendientes
DECLARE @Docs TABLE (DocIdDocumento INT PRIMARY KEY, Etiqueta VARCHAR(20));
INSERT INTO @Docs (DocIdDocumento, Etiqueta)
SELECT d.DocIdDocumento, RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero)
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('3576','4026')
  AND ISNULL(d.DocEstado,'') <> 'ANULADO';

-- 4 · ninguno puede tener caja: si la tuviera, ese cobro seria real
IF EXISTS (SELECT 1 FROM dbo.DocumentosContables d JOIN @Docs x ON x.DocIdDocumento = d.DocIdDocumento
           WHERE d.TcaIdTransaccion IS NOT NULL)
BEGIN
    RAISERROR('Alguno de los documentos SI tiene transaccion de caja: ese cobro es real y no corresponde dejarlo pendiente. Revisar a mano. No se toca nada.', 16, 1);
    RETURN;
END

-- ══ ANTES ══════════════════════════════════════════════════════════════════
SELECT Momento = 'ANTES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

SELECT Momento = 'ANTES - LOS TRES', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- ══ EL ARREGLO ═════════════════════════════════════════════════════════════
BEGIN TRANSACTION;

    -- ── (1) LOS TRES PENDIENTES ────────────────────────────────────────────
    -- Anular los pagos espejo (cobros sin PagIdPago, sin caja, junto al cargo)
    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' FIX_CAMILO_2026-09-09: pago espejo sin PagIdPago, sin recibo y sin transaccion' +
            ' de caja, creado junto con el cargo. No entro plata: el documento queda PENDIENTE.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Docs x ON x.DocIdDocumento = m.DocIdDocumento
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
      AND m.PagIdPago IS NULL
      AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta c
                  WHERE c.DocIdDocumento = m.DocIdDocumento
                    AND c.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                    AND (c.MovAnulado IS NULL OR c.MovAnulado = 0)
                    AND ABS(DATEDIFF(SECOND, c.MovFecha, m.MovFecha)) <= 1);

    -- Sacar las coberturas con saldo a favor (ANTICIPO_APLICADO sin caja)
    DECLARE @PagosFantasma TABLE (PagIdPago INT PRIMARY KEY);
    INSERT INTO @PagosFantasma (PagIdPago)
    SELECT DISTINCT ip.PagIdPago
    FROM dbo.ImputacionPago ip
    JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
    JOIN @Docs x ON x.DocIdDocumento = dd.DocIdDocumento
    JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
    WHERE p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL;

    DELETE ip FROM dbo.ImputacionPago ip JOIN @PagosFantasma f ON f.PagIdPago = ip.PagIdPago;

    DELETE p FROM dbo.Pagos p JOIN @PagosFantasma f ON f.PagIdPago = p.PagIdPago
    WHERE NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip2 WHERE ip2.PagIdPago = p.PagIdPago);

    -- La deuda vuelve por el total
    UPDATE dd
    SET dd.DDeImportePendiente = dd.DDeImporteOriginal,
        dd.DDeEstado = 'PENDIENTE',
        dd.DDeFechaCobro = NULL,
        dd.DDeObservaciones = LEFT(LTRIM(ISNULL(dd.DDeObservaciones,'') +
            ' FIX_CAMILO_2026-09-09: figuraba cobrada contra el saldo a favor de la NC-11,' +
            ' pero no entro plata. Administracion definio que queda PENDIENTE de cobro.'), 500)
    FROM dbo.DeudaDocumento dd
    JOIN @Docs x ON x.DocIdDocumento = dd.DocIdDocumento
    WHERE dd.DDeEstado NOT IN ('PENDIENTE','PARCIAL','VENCIDO');

    UPDATE d SET d.DocPagado = 0
    FROM dbo.DocumentosContables d JOIN @Docs x ON x.DocIdDocumento = d.DocIdDocumento;

    -- ── (2) LA DEVOLUCION EN EFECTIVO DE LA NC-11 ─────────────────────────
    -- Sale de la caja por la pantalla de egresos (2.3.1 Anticipos de Clientes
    -- contra 1.1.2 Caja ME). Aca se descuenta de la cuenta corriente para que
    -- el saldo a favor deje de estar disponible.
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         MovFecha, MovUsuarioAlta, DocIdDocumento, MovObservaciones)
    VALUES
        (@CueUsd, 'AJUSTE',
         'Devolucion en efectivo - Nota de credito NC-11',
         -@Devolucion, 0, GETDATE(), 11, @DocNC,
         LEFT('DEVOLUCION_NC11_2026-09-09: se le devolvio al cliente el saldo a favor que dejo'
            + ' la nota de credito NC-11 (US$ 541,27, aceptada por DGI, que anulaba el ET-3643'
            + ' ya cobrado por transferencia). La salida de caja va por el egreso tipo'
            + ' "Devolucion a Cliente" (2.3.1 Anticipos de Clientes a 1.1.2 Caja ME).'
            + ISNULL(' Egreso Nro ' + CONVERT(VARCHAR(20), @EgrIdEgreso) + '.', ' EGRESO SIN VINCULAR: atar a mano.'), 500));

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
SELECT Momento = 'DESPUES', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (@CueUsd, @CuePesos);

-- Los TRES tienen que quedar PENDIENTE por su total
SELECT Momento = 'DESPUES - LOS TRES', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Total = CAST(d.DocTotal AS DECIMAL(18,2)), d.DocPagado,
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- Control: la deuda total tiene que dar igual al saldo de la cuenta en dolares
SELECT Momento = 'CONTROL',
       DeudaUsd = CAST(389.91 + 31.81 AS DECIMAL(18,2)),
       SaldoCuentaUsd = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       Cuadra = CASE WHEN ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) + 421.72) <= 0.02
                     THEN 'SI' ELSE 'NO - revisar' END;
