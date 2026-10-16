/*
  fix_moneda_deuda_desincronizada.sql
  ─────────────────────────────────────────────────────────────────────────
  Repara documentos donde la MONEDA de DocumentosContables no coincide con
  la moneda de la cuenta (CuentasCliente.MonIdMoneda) que hoy sostiene sus
  MovimientosCuenta / DeudaDocumento vivos.

  Causa raíz: editarFactura (cfeController.js) permitía cambiar la moneda
  de un documento (ej. PC-2438) sin migrar los movimientos/deuda ya
  existentes a la cuenta de la nueva moneda -- quedaban huérfanos en la
  cuenta vieja. Ya se corrigió el código para que esto no vuelva a pasar;
  este script es solo para reparar los datos que ya quedaron rotos.

  Nota: MovimientosCuenta y DeudaDocumento se migran de forma INDEPENDIENTE
  -- en los datos reales se encontraron documentos donde una tabla ya
  estaba en la cuenta correcta y la otra no (o incluso movimientos
  repartidos en DOS cuentas distintas para el mismo documento).

  Validado contra la réplica local dentro de una transacción con ROLLBACK
  (no se modificó nada) -- test1: 7 documentos afectados, los 7 quedaron
  sincronizados y consistentes.

  CÓMO CORRERLO EN PRODUCCIÓN:
    1. Ejecutar tal cual. Al final queda en una transacción ABIERTA sin
       COMMIT ni ROLLBACK -- revisar los PRINT/mensajes.
    2. Si todo se ve bien: seleccionar y ejecutar "COMMIT TRAN;" al final.
    3. Si algo no cuadra: "ROLLBACK TRAN;" y avisar para revisar el caso.
  ─────────────────────────────────────────────────────────────────────────
*/

SET NOCOUNT ON;
BEGIN TRAN;

DECLARE @DocIdDocumento INT, @MonIdMoneda INT, @CliIdCliente INT;
DECLARE @CueTipoNuevo VARCHAR(20), @Target INT;
DECLARE @OldCta INT, @Total DECIMAL(18,4);
DECLARE @Msg VARCHAR(500);

DECLARE docs CURSOR LOCAL FAST_FORWARD FOR
  SELECT DISTINCT dd.DocIdDocumento
  FROM dbo.DeudaDocumento dd WITH (UPDLOCK, ROWLOCK)
  JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
  JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
  WHERE dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
    AND cc.MonIdMoneda <> dc.MonIdMoneda;

OPEN docs;
FETCH NEXT FROM docs INTO @DocIdDocumento;

WHILE @@FETCH_STATUS = 0
BEGIN
  SELECT @MonIdMoneda = MonIdMoneda, @CliIdCliente = CliIdCliente
  FROM dbo.DocumentosContables
  WHERE DocIdDocumento = @DocIdDocumento;

  SET @CueTipoNuevo = CASE WHEN @MonIdMoneda = 2 THEN 'DINERO_USD' ELSE 'DINERO_UYU' END;

  SELECT TOP 1 @Target = CueIdCuenta
  FROM dbo.CuentasCliente
  WHERE CliIdCliente = @CliIdCliente AND CueTipo = @CueTipoNuevo AND CueActiva = 1;

  IF @Target IS NULL
  BEGIN
    SET @Msg = 'SKIP Doc ' + CAST(@DocIdDocumento AS VARCHAR) + ': cliente ' + CAST(@CliIdCliente AS VARCHAR)
             + ' no tiene cuenta ' + @CueTipoNuevo + ' -- revisar manualmente (no se creó cuenta nueva)';
    PRINT @Msg;
  END
  ELSE
  BEGIN
    -- 1. Migrar cada cuenta "vieja" distinta que aparezca en MovimientosCuenta de este doc
    DECLARE movs CURSOR LOCAL FAST_FORWARD FOR
      SELECT DISTINCT CueIdCuenta
      FROM dbo.MovimientosCuenta
      WHERE DocIdDocumento = @DocIdDocumento AND CueIdCuenta <> @Target
        AND (MovAnulado IS NULL OR MovAnulado = 0);

    OPEN movs;
    FETCH NEXT FROM movs INTO @OldCta;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      SELECT @Total = ISNULL(SUM(MovImporte), 0)
      FROM dbo.MovimientosCuenta
      WHERE DocIdDocumento = @DocIdDocumento AND CueIdCuenta = @OldCta
        AND (MovAnulado IS NULL OR MovAnulado = 0);

      UPDATE dbo.MovimientosCuenta
      SET CueIdCuenta = @Target
      WHERE DocIdDocumento = @DocIdDocumento AND CueIdCuenta = @OldCta
        AND (MovAnulado IS NULL OR MovAnulado = 0);

      IF ABS(@Total) > 0.001
      BEGIN
        UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Total WHERE CueIdCuenta = @OldCta;
        UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Total WHERE CueIdCuenta = @Target;
      END

      SET @Msg = '  MovimientosCuenta Doc ' + CAST(@DocIdDocumento AS VARCHAR) + ': cuenta ' + CAST(@OldCta AS VARCHAR)
               + ' -> ' + CAST(@Target AS VARCHAR) + ' (total movido ' + CAST(@Total AS VARCHAR) + ')';
      PRINT @Msg;

      FETCH NEXT FROM movs INTO @OldCta;
    END
    CLOSE movs;
    DEALLOCATE movs;

    -- 2. Migrar DeudaDocumento de forma independiente (no asumir que ya sigue a Movimientos)
    UPDATE dbo.DeudaDocumento
    SET CueIdCuenta = @Target
    WHERE DocIdDocumento = @DocIdDocumento AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
      AND CueIdCuenta <> @Target;

    IF @@ROWCOUNT > 0
    BEGIN
      SET @Msg = '  DeudaDocumento Doc ' + CAST(@DocIdDocumento AS VARCHAR) + ' migrada a cuenta ' + CAST(@Target AS VARCHAR);
      PRINT @Msg;
    END

    SET @Msg = 'OK Doc ' + CAST(@DocIdDocumento AS VARCHAR) + ' procesado.';
    PRINT @Msg;
  END

  FETCH NEXT FROM docs INTO @DocIdDocumento;
END

CLOSE docs;
DEALLOCATE docs;

-- Verificación final: debería devolver 0 filas (o solo los DocIdDocumento con SKIP arriba)
SELECT DISTINCT dd.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.MonIdMoneda AS MonedaDocumento, cc.MonIdMoneda AS MonedaDeudaActual
FROM dbo.DeudaDocumento dd
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
  AND cc.MonIdMoneda <> dc.MonIdMoneda;

-- Revisar los PRINT y el SELECT de arriba antes de decidir.
-- Si está todo bien:
-- COMMIT TRAN;
-- Si algo no cuadra:
-- ROLLBACK TRAN;
