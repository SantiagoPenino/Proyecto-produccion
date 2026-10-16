-- ============================================================================
-- fix_ciclo_sacar_movs_ajenos.sql
-- ----------------------------------------------------------------------------
-- CORRE PRIMERO diag_ciclo_descuadrado.sql. Este script arregla UN escenario
-- concreto: el ciclo tiene marcados movimientos de ORDEN que NO son de la
-- cuenta del ciclo (tipicamente arrastrados de un ciclo viejo o de la cuenta
-- de la otra moneda).
--
-- El cierre suma el total del ciclo filtrando por CicIdCiclo y NO verifica la
-- cuenta, asi que esos movimientos inflan el total; la pre-factura, que arma
-- las lineas desde los pedidos congelados de la cuenta correcta, no los tiene.
-- De ahi el "El total del ciclo (X) no coincide con la suma de las lineas (Y)".
--
-- QUE HACE: les saca la marca de ciclo (CicIdCiclo = NULL) a esos movimientos.
--   . NO los anula, NO los borra, NO les cambia el importe ni la cuenta.
--   . El saldo del cliente NO se mueve (las ORDEN no cuentan para el saldo).
--   . Quedan como ordenes pendientes de facturar, disponibles para el ciclo
--     que les corresponda. Nada se pierde.
--
-- CANDADOS:
--   . el ciclo tiene que estar ABIERTO
--   . solo salen movimientos ORDEN/ORDEN_ANTICIPO, negativos, sin documento
--   . solo los que estan en una cuenta DISTINTA a la del ciclo
--   . si no hay ninguno, avisa y no toca nada (el descuadre es por otra causa:
--     volve al panel 3 del diagnostico)
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Nombre VARCHAR(60) = 'CR SPORT';   -- nombre o codigo del cliente
DECLARE @Cli INT, @Cic INT, @CueCiclo INT, @N INT;

SELECT TOP 1 @Cli = cl.CliIdCliente
FROM dbo.Clientes cl
WHERE RTRIM(cl.Nombre) = @Nombre OR RTRIM(cl.IDCliente) = @Nombre
ORDER BY CASE WHEN RTRIM(cl.Nombre) = @Nombre THEN 0 ELSE 1 END;

IF @Cli IS NULL
BEGIN
    RAISERROR('No hay cliente exacto con ese nombre/codigo. No se toca nada.', 16, 1);
    RETURN;
END

SELECT TOP 1 @Cic = c.CicIdCiclo, @CueCiclo = c.CueIdCuenta
FROM dbo.CiclosCredito c
WHERE c.CliIdCliente = @Cli AND c.CicEstado = 'ABIERTO'
ORDER BY c.CicIdCiclo DESC;

IF @Cic IS NULL
BEGIN
    RAISERROR('Ese cliente no tiene un ciclo ABIERTO. No se toca nada.', 16, 1);
    RETURN;
END

-- Los que sobran: movimientos del ciclo que viven en otra cuenta
DECLARE @Ajenos TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, Importe DECIMAL(18,4));
INSERT INTO @Ajenos (MovIdMovimiento, CueIdCuenta, Importe)
SELECT m.MovIdMovimiento, m.CueIdCuenta, ABS(m.MovImporte)
FROM dbo.MovimientosCuenta m
WHERE m.CicIdCiclo = @Cic
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.MovImporte < 0
  AND m.DocIdDocumento IS NULL
  AND m.CueIdCuenta <> @CueCiclo;

SELECT @N = COUNT(*) FROM @Ajenos;

IF @N = 0
BEGIN
    RAISERROR('El ciclo NO tiene movimientos de otra cuenta: el descuadre es por otra causa. Mira el panel 3 de diag_ciclo_descuadrado.sql (ordenes sin pedido congelado, o importe distinto al congelado). No se toca nada.', 16, 1);
    RETURN;
END

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES', Ciclo = @Cic, CuentaDelCiclo = @CueCiclo,
       TotalQueSumabaElCierre = CAST((SELECT SUM(ABS(m.MovImporte)) FROM dbo.MovimientosCuenta m
             WHERE m.CicIdCiclo = @Cic AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.MovImporte < 0
               AND m.DocIdDocumento IS NULL
               AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')) AS DECIMAL(18,2)),
       MovimientosQueSalen = @N,
       ImporteQueSale = CAST((SELECT SUM(Importe) FROM @Ajenos) AS DECIMAL(18,2));

SELECT Momento = 'ANTES - LOS QUE SALEN', a.MovIdMovimiento, a.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       a.Importe, Concepto = LEFT(ISNULL(m.MovConcepto,''), 50), m.MovFecha
FROM @Ajenos a
JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = a.MovIdMovimiento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = a.CueIdCuenta;

-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

    UPDATE m
    SET m.CicIdCiclo = NULL,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' FIX_CICLO_2026-09-07: estaba marcado en el ciclo ' + CONVERT(VARCHAR(20), @Cic) +
            ' pero vive en la cuenta ' + CONVERT(VARCHAR(20), m.CueIdCuenta) +
            ', no en la del ciclo (' + CONVERT(VARCHAR(20), @CueCiclo) + '). Inflaba el total' +
            ' y frenaba la factura. Se le saca la marca de ciclo; la orden sigue pendiente.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Ajenos a ON a.MovIdMovimiento = m.MovIdMovimiento;

COMMIT TRANSACTION;

-- ── DESPUES: este total ya tiene que coincidir con la pre-factura ──────────
SELECT Momento = 'DESPUES', Ciclo = @Cic,
       TotalDelCiclo = CAST(ISNULL((SELECT SUM(ABS(m.MovImporte)) FROM dbo.MovimientosCuenta m
             WHERE m.CicIdCiclo = @Cic AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.MovImporte < 0
               AND m.DocIdDocumento IS NULL
               AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')), 0) AS DECIMAL(18,2)),
       Movimientos = (SELECT COUNT(*) FROM dbo.MovimientosCuenta m
             WHERE m.CicIdCiclo = @Cic AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND m.MovImporte < 0
               AND m.DocIdDocumento IS NULL);

-- Control: el saldo del cliente no se movio (las ORDEN no cuentan para el saldo)
SELECT Momento = 'DESPUES - SALDOS', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.MonIdMoneda DESC;
