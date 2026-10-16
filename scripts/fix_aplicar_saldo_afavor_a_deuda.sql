-- ============================================================================
-- fix_aplicar_saldo_afavor_a_deuda.sql
-- ----------------------------------------------------------------------------
-- Repara el descuadre "deuda viva + saldo a favor conviviendo" de UN documento:
-- le imputa a su DeudaDocumento la plata a favor que el cliente ya tenía y que
-- el libro mayor YA descontó, pero que nunca se aplicó a la deuda.
--
-- Caso que lo origina: Gerardo Mazzoni (RUC/CI 36583734), PC-3825 por US$ 3.006,46.
-- El cliente tenía US$ 2.957,36 a favor (recibo de anticipo RA-29 por US$ 3.000).
-- El documento se emitió Contado, se editó a Crédito, y la deuda nació por los
-- 3.006,46 enteros sin tocar el saldo a favor. El libro mayor sí quedó neteado
-- (saldo -49,10): lo único mal es la DeudaDocumento.
--
-- CUÁNTO APLICA — no "todo el saldo a favor", sino el EXCESO de deuda sobre lo que
-- el libro mayor dice que el cliente debe:
--       Exceso = (deudas vivas de la cuenta) - (lo que el libro dice que debe)
--       Aplicar = MIN(pendiente de ESTA deuda, Exceso)
-- Así es idempotente (correrlo de nuevo aplica 0) y nunca "paga" una deuda que el
-- libro respalda: si las dos verdades ya coinciden, no hace nada.
--
-- QUÉ HACE — exactamente lo mismo que el código cuando funciona:
--   1. Pagos: un pago sintético PagTipoMovimiento='ANTICIPO_APLICADO'
--   2. ImputacionPago: lo imputa a ESA deuda (dirigido, no PEPS: no toca deudas viejas)
--   3. DeudaDocumento: baja el pendiente y actualiza el estado
--   4. DocumentosContables.DocPagado = 1 SOLO si la deuda queda en cero
-- NO agrega ningún MovimientosCuenta: el libro mayor ya tiene el anticipo y el
-- cargo, sumarle algo más lo descuadraría al revés.
--
-- CANDADOS (si alguno falla, no toca NADA y explica por qué):
--   · el documento tiene que tener UNA sola deuda viva
--   · el cargo del documento tiene que existir en el libro mayor
--   · ninguna otra deuda viva de la cuenta puede estar sin su cargo en el libro
--     (esas son "deudas sin movimiento" — otro problema — y falsean el exceso)
--
-- Correr con el fix de código desplegado (crearDeudaDocumento ya no vuelve a crear
-- este descuadre) — si no, el próximo documento repite el problema.
-- ============================================================================

SET XACT_ABORT ON;

-- ── PARÁMETROS: el documento a reparar ──────────────────────────────────────
DECLARE @Serie   VARCHAR(10)  = 'PC';
DECLARE @Numero  VARCHAR(20)  = '3825';
DECLARE @Ruc     VARCHAR(20)  = '36583734';   -- RUC/CI del cliente (control cruzado)
DECLARE @Usuario INT          = 1;            -- usuario que queda en el pago sintético

DECLARE @Doc INT, @Cli INT, @Cue INT, @Mon INT, @DDe INT, @Pend DECIMAL(18,4),
        @SaldoReal DECIMAL(18,4), @DeudaViva DECIMAL(18,4), @Exceso DECIMAL(18,4),
        @Aplicar DECIMAL(18,4), @Pag INT, @N INT;

SELECT TOP 1 @Doc = d.DocIdDocumento, @Cli = d.CliIdCliente
FROM dbo.DocumentosContables d
JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
WHERE RTRIM(d.DocSerie) = @Serie
  AND RTRIM(d.DocNumero) = @Numero
  AND RTRIM(ISNULL(c.CioRuc, '')) = @Ruc
ORDER BY d.DocIdDocumento DESC;

IF @Doc IS NULL
BEGIN
    RAISERROR('No se encontró el documento %s-%s para el RUC/CI %s. Revisar los parámetros.', 16, 1, @Serie, @Numero, @Ruc);
    RETURN;
END

-- ── CANDADO 1: una sola deuda viva para el documento ────────────────────────
SELECT @N = COUNT(*)
FROM dbo.DeudaDocumento
WHERE DocIdDocumento = @Doc
  AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
  AND DDeImportePendiente > 0.01;

IF @N <> 1
BEGIN
    SELECT DDeIdDocumento, CueIdCuenta, DDeImporteOriginal, DDeImportePendiente, DDeEstado
    FROM dbo.DeudaDocumento WHERE DocIdDocumento = @Doc;
    RAISERROR('El documento tiene %d deudas vivas (se esperaba 1). No se toca nada.', 16, 1, @N);
    RETURN;
END

SELECT TOP 1 @DDe = dd.DDeIdDocumento, @Cue = dd.CueIdCuenta, @Pend = dd.DDeImportePendiente
FROM dbo.DeudaDocumento dd
WHERE dd.DocIdDocumento = @Doc
  AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
  AND dd.DDeImportePendiente > 0.01;

SELECT @Mon = ISNULL(MonIdMoneda, 1) FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue;

-- ── CANDADO 2: el cargo del documento tiene que estar en el libro mayor ─────
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
               WHERE m.DocIdDocumento = @Doc
                 AND m.CueIdCuenta = @Cue
                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO')
                 AND m.MovImporte < 0)
BEGIN
    RAISERROR('El documento no tiene su cargo en el libro mayor de la cuenta %d: la deuda no se puede comparar contra el saldo. No se toca nada.', 16, 1, @Cue);
    RETURN;
END

-- ── CANDADO 3: ninguna deuda viva de la cuenta sin cargo en el libro ────────
SELECT @N = COUNT(*)
FROM dbo.DeudaDocumento dd
WHERE dd.CueIdCuenta = @Cue
  AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
  AND dd.DDeImportePendiente > 0.01
  AND (dd.DocIdDocumento IS NULL
       OR NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                      WHERE m.DocIdDocumento = dd.DocIdDocumento
                        AND m.CueIdCuenta = dd.CueIdCuenta
                        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                        AND m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO')
                        AND m.MovImporte < 0));

IF @N > 0
BEGIN
    SELECT dd.DDeIdDocumento, dd.DocIdDocumento, dd.DDeImportePendiente, dd.DDeEstado
    FROM dbo.DeudaDocumento dd
    WHERE dd.CueIdCuenta = @Cue
      AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
      AND dd.DDeImportePendiente > 0.01
      AND (dd.DocIdDocumento IS NULL
           OR NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                          WHERE m.DocIdDocumento = dd.DocIdDocumento
                            AND m.CueIdCuenta = dd.CueIdCuenta
                            AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                            AND m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO')
                            AND m.MovImporte < 0));
    RAISERROR('La cuenta %d tiene %d deuda(s) viva(s) SIN cargo en el libro mayor (listadas arriba): el exceso no es confiable. No se toca nada.', 16, 1, @Cue, @N);
    RETURN;
END

-- ── Cuánto sobra de deuda contra lo que el libro dice que debe ──────────────
SELECT @SaldoReal = ISNULL(SUM(m.MovImporte), 0)
FROM dbo.MovimientosCuenta m
WHERE m.CueIdCuenta = @Cue
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');

SELECT @DeudaViva = ISNULL(SUM(dd.DDeImportePendiente), 0)
FROM dbo.DeudaDocumento dd
WHERE dd.CueIdCuenta = @Cue
  AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO');

SET @Exceso  = @DeudaViva - CASE WHEN @SaldoReal < 0 THEN -@SaldoReal ELSE 0 END;
SET @Aplicar = ROUND(CASE WHEN @Pend < @Exceso THEN @Pend ELSE @Exceso END, 2);

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES', DocIdDocumento = @Doc, CliIdCliente = @Cli, CueIdCuenta = @Cue,
       DDeIdDocumento = @DDe, PendienteDeuda = @Pend,
       SaldoLibro = @SaldoReal, DeudaVivaCuenta = @DeudaViva, ExcesoDeuda = @Exceso,
       AAplicar = @Aplicar, PendienteQueQueda = @Pend - CASE WHEN @Aplicar > 0 THEN @Aplicar ELSE 0 END;

IF @Aplicar <= 0.01
BEGIN
    PRINT 'La deuda ya coincide con lo que dice el libro mayor: no hay nada para aplicar. No se hizo ningún cambio.';
    RETURN;
END

BEGIN TRANSACTION;

    INSERT INTO dbo.Pagos
        (MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago,
         PagUsuarioAlta, PagCotizacion, PagMontoConvertido, PagTipoMovimiento)
    VALUES
        (1, @Mon, @Aplicar, GETDATE(), @Usuario, 1, @Aplicar, 'ANTICIPO_APLICADO');

    SET @Pag = SCOPE_IDENTITY();

    INSERT INTO dbo.ImputacionPago
        (PagIdPago, DDeIdDocumento, CueIdCuenta, ImpImporte, ImpFecha, ImpUsuarioAlta)
    VALUES
        (@Pag, @DDe, @Cue, @Aplicar, GETDATE(), @Usuario);

    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = CASE WHEN DDeImportePendiente - @Aplicar < 0 THEN 0
                                   ELSE DDeImportePendiente - @Aplicar END,
        DDeEstado           = CASE WHEN DDeImportePendiente - @Aplicar <= 0.01 THEN 'COBRADO' ELSE 'PARCIAL' END,
        DDeFechaCobro       = CASE WHEN DDeImportePendiente - @Aplicar <= 0.01 THEN GETDATE() ELSE DDeFechaCobro END
    WHERE DDeIdDocumento = @DDe;

    -- El Estado de Cuenta, cuando no hay deuda viva, cae a mirar DocumentosContables.DocPagado
    -- (columna distinta): sin esto la pantalla seguiría mostrando el pendiente completo.
    UPDATE dbo.DocumentosContables
    SET DocPagado = 1
    WHERE DocIdDocumento = @Doc
      AND NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento
                      WHERE DocIdDocumento = @Doc
                        AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                        AND DDeImportePendiente > 0.01);

COMMIT TRANSACTION;

-- ── DESPUÉS ─────────────────────────────────────────────────────────────────
-- Esperado en el caso Mazzoni: deuda PARCIAL con 49,10 pendiente, un pago nuevo
-- imputado por 2.957,36, y el saldo del libro en -49,10 (sin cambios) = las dos
-- verdades diciendo lo mismo.
SELECT Momento = 'DESPUES',
       RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero) AS Documento,
       d.DocTotal, d.DocPagado,
       dd.DDeIdDocumento, dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado,
       Imputado = ISNULL((SELECT SUM(ip.ImpImporte) FROM dbo.ImputacionPago ip
                          WHERE ip.DDeIdDocumento = dd.DDeIdDocumento), 0),
       SaldoLibroCuenta = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                  WHERE m.CueIdCuenta = dd.CueIdCuenta
                                    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                    AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
       DeudaVivaCuenta  = ISNULL((SELECT SUM(x.DDeImportePendiente) FROM dbo.DeudaDocumento x
                                  WHERE x.CueIdCuenta = dd.CueIdCuenta
                                    AND x.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')), 0)
FROM dbo.DocumentosContables d
JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.DocIdDocumento = @Doc;
