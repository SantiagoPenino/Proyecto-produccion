-- ============================================================================
-- PROD_camilo_tres_pendientes.sql
-- ----------------------------------------------------------------------------
-- REEMPLAZA a PROD_fix_camilo7008_parteD.sql (ese solo anulaba el pago espejo).
-- Correr DESPUES de PROD_fix_camilo7008.sql, que ya se corrio (partes A, B y C).
--
-- Administracion definio que estos TRES tienen que quedar PENDIENTES:
--       PC-2877  ($   270,00)   <- la parte C ya lo dejo asi
--       PC-3576  (US$ 389,91)
--       PC-4026  (US$  31,81)
--
-- Hoy los dos de dolares figuran COBRADOS, pero no entro plata por ellos: se
-- taparon con el saldo a favor de la nota de credito NC-11 (ANTICIPO_APLICADO,
-- sin caja). Ademas el PC-3576 tiene un "pago espejo" (un PAGO creado en el
-- mismo segundo que el cargo, sin recibo y sin transaccion de caja), asi que
-- estaba cobrado DOS veces.
--
-- QUE HACE, para el PC-3576 y el PC-4026:
--   1. anula los pagos espejo (cobros sin PagIdPago, sin caja, hechos junto al cargo)
--   2. borra las imputaciones ANTICIPO_APLICADO sin caja y el pago sintetico
--   3. repone la deuda por el total y la deja PENDIENTE
--   4. pone DocPagado = 0
--
-- NO toca el PC-2877 (ya quedo pendiente con la parte C), ni la NC-11, ni ningun
-- cobro con respaldo de caja, ni ningun DocTotal.
--
-- COMO QUEDA:
--       cuenta 11   (US$)  +509,46  ->  +119,55
--            = 541,27 (NC-11) - 389,91 (PC-3576) - 31,81 (PC-4026)
--       cuenta 1534 ($)    -270,00  ->  -270,00   (sin cambios)
--
--       Deudas vivas:  PC-2877  $   270,00
--                      PC-3576  US$ 389,91
--                      PC-4026  US$  31,81
--
--       El cliente tiene US$ 541,27 a favor por la nota de credito y debe
--       US$ 421,72 + $ 270. El saldo de la cuenta (119,55) es el neto.
--
-- Idempotente: lo que ya este pendiente o anulado no vuelve a entrar.
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cli INT = 4;

-- Los documentos que tienen que quedar pendientes (los de DOLARES; el PC-2877 ya esta)
DECLARE @Docs TABLE (DocIdDocumento INT PRIMARY KEY, Etiqueta VARCHAR(20), Total DECIMAL(18,4));
INSERT INTO @Docs (DocIdDocumento, Etiqueta, Total)
SELECT d.DocIdDocumento, RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), d.DocTotal
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli
  AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) IN ('3576','4026')
  AND ISNULL(d.DocEstado,'') <> 'ANULADO';

DECLARE @N INT; SELECT @N = COUNT(*) FROM @Docs;
IF @N <> 2
BEGIN
    SELECT Encontrados = Etiqueta, DocIdDocumento, Total FROM @Docs;
    RAISERROR('Se esperaban 2 documentos (PC-3576 y PC-4026) y se encontraron %d. No se toca nada.', 16, 1, @N);
    RETURN;
END

-- ── CANDADO 1: ninguno puede tener transaccion de caja ────────────────────
-- Si la tuviera, ese cobro seria REAL y no corresponde dejarlo pendiente.
IF EXISTS (SELECT 1 FROM dbo.DocumentosContables d JOIN @Docs x ON x.DocIdDocumento = d.DocIdDocumento
           WHERE d.TcaIdTransaccion IS NOT NULL)
BEGIN
    SELECT Alerta = 'TIENE CAJA', Documento = x.Etiqueta, d.TcaIdTransaccion
    FROM dbo.DocumentosContables d JOIN @Docs x ON x.DocIdDocumento = d.DocIdDocumento
    WHERE d.TcaIdTransaccion IS NOT NULL;
    RAISERROR('Alguno de los documentos SI tiene transaccion de caja (ver arriba): ese cobro es real. Revisar a mano. No se toca nada.', 16, 1);
    RETURN;
END

-- ── CANDADO 2: ningun cobro de esos documentos puede tener recibo ─────────
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
           JOIN @Docs x ON x.DocIdDocumento = m.DocIdDocumento
           JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
           WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
             AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
             AND p.PagTcaIdTransaccion IS NOT NULL)
BEGIN
    RAISERROR('Alguno de los cobros tiene recibo de caja: es plata que entro de verdad. Revisar a mano. No se toca nada.', 16, 1);
    RETURN;
END

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES - CUENTAS', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (11, 1534);

SELECT Momento = 'ANTES - LOS TRES', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Total = CAST(d.DocTotal AS DECIMAL(18,2)), d.DocPagado,
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

    -- 1. Anular los pagos espejo: cobros sin PagIdPago, sin caja, creados en el
    --    mismo segundo que el cargo del documento.
    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' FIX_CAMILO_PENDIENTES_2026-09-08: pago espejo sin PagIdPago, sin recibo y sin' +
            ' transaccion de caja, creado junto con el cargo. No entro plata por este' +
            ' documento: administracion definio que queda PENDIENTE.'), 500)
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

    -- 2. Sacar las coberturas con saldo a favor (ANTICIPO_APLICADO sin caja)
    DECLARE @PagosFantasma TABLE (PagIdPago INT PRIMARY KEY);
    INSERT INTO @PagosFantasma (PagIdPago)
    SELECT DISTINCT ip.PagIdPago
    FROM dbo.ImputacionPago ip
    JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
    JOIN @Docs x ON x.DocIdDocumento = dd.DocIdDocumento
    JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
    WHERE p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL;

    DELETE ip
    FROM dbo.ImputacionPago ip
    JOIN @PagosFantasma f ON f.PagIdPago = ip.PagIdPago;

    DELETE p
    FROM dbo.Pagos p
    JOIN @PagosFantasma f ON f.PagIdPago = p.PagIdPago
    WHERE NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip2 WHERE ip2.PagIdPago = p.PagIdPago);

    -- 3. La deuda vuelve por el total
    UPDATE dd
    SET dd.DDeImportePendiente = dd.DDeImporteOriginal,
        dd.DDeEstado = 'PENDIENTE',
        dd.DDeFechaCobro = NULL,
        dd.DDeObservaciones = LEFT(LTRIM(ISNULL(dd.DDeObservaciones,'') +
            ' FIX_CAMILO_PENDIENTES_2026-09-08: figuraba cobrada contra el saldo a favor de' +
            ' la nota de credito NC-11, pero no entro plata. Administracion definio que este' +
            ' documento queda PENDIENTE de cobro.'), 500)
    FROM dbo.DeudaDocumento dd
    JOIN @Docs x ON x.DocIdDocumento = dd.DocIdDocumento;

    UPDATE d SET d.DocPagado = 0
    FROM dbo.DocumentosContables d JOIN @Docs x ON x.DocIdDocumento = d.DocIdDocumento;

    -- 4. Saldo corrido y saldo de cuenta (convencion de la casa)
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (11, 1534) AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (11, 1534);

COMMIT TRANSACTION;

-- ── DESPUES ─────────────────────────────────────────────────────────────────
-- Esperado:  cuenta 11 (US$) = +119,55   |   cuenta 1534 ($) = -270,00
SELECT Momento = 'DESPUES - CUENTAS', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (11, 1534);

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
