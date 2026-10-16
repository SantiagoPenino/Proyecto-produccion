/* ============================================================================
   LOTE — 31 clientes Común cuyo "saldo a favor" es SOLO el bug "pago en pesos
   escrito en la cuenta en dólares" (35 cobros, US$ 41.586,92 fantasma).
   Al corregirlo, TODAS sus cuentas de dinero quedan en 0,00.

   QUÉ ES (22-sep-2026, verificado en la réplica local = pantalla de prod):
     Cobros de documentos en PESOS (e-tickets/facturas contado, PC) que el
     editarFactura viejo escribió en la cuenta US$ del cliente con el número en
     pesos, sin convertir (ej. Sursidoor ET-7389: cargo US$ 48,40, cobro escrito
     1.977,00 "US$" = los $ 1.977 reales). Son del 28/8 al 3/9 — el lote del 1/9
     (fix_pagos_pesos_en_cuentas_usd_masivo.sql) no los tomó. Misma regla que
     ese lote y que RXD: el cobro queda POR EL IMPORTE DEL CARGO de su cuenta.

   QUÉ HACE
     1. Detecta los cobros con el MISMO detector del lote del 1/9, pero SOLO en
        los 31 clientes listados abajo (candado: ningún otro cliente entra).
     2. MovImporte = cargo del mismo documento en la misma cuenta; deja la marca
        FIX_MONEDA_2026-09-22 en la observación.
     3. Recalcula MovSaldoPosterior y CueSaldoActual de las cuentas tocadas.
     4. VERIFICA dentro de la transacción que todas las cuentas de dinero de los
        31 quedaron en 0 (±1). Si alguna no → ROLLBACK de todo y aviso.
     NO toca Pagos/TransaccionesCaja (el monto real en pesos sigue ahí), ni
     documentos, ni deudas, ni otros clientes.

   ESPERADO: 35 movimientos · 31 clientes · 31 cuentas · después: 31 cuentas en 0.

   Correr en PRODUCCIÓN, en SSMS, entero (F5). @SoloVista = 1 (default) solo
   muestra; @SoloVista = 0 aplica. No deja transacciones abiertas.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar

DECLARE @Clientes TABLE (CliIdCliente INT PRIMARY KEY);
INSERT INTO @Clientes VALUES (93),(226),(289),(467),(633),(729),(825),(831),(883),(1366),(1482),(2041),(2170),(2245),(2259),(3042),
                             (5227),(5431),(6776),(7002),(7171),(8478),(8502),(8610),(8677),(8698),(8710),(8717),(8815),(9048),(9050);

-- Los cobros a corregir (detector del lote del 1/9, acotado a los 31)
DECLARE @Fix TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, CliIdCliente INT, Doc VARCHAR(30), ImporteViejo DECIMAL(18,4), ImporteNuevo DECIMAL(18,4));
INSERT INTO @Fix
SELECT m.MovIdMovimiento, m.CueIdCuenta, cc.CliIdCliente, RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), m.MovImporte, x.Cargo
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
CROSS APPLY (SELECT Cargo = ISNULL(ABS(SUM(m2.MovImporte)), 0) FROM dbo.MovimientosCuenta m2
             WHERE m2.DocIdDocumento = m.DocIdDocumento AND m2.CueIdCuenta = m.CueIdCuenta AND ISNULL(m2.MovAnulado, 0) = 0
               AND m2.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m2.MovImporte < 0) x
WHERE ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo = 'PAGO' AND m.MovImporte > 0
  AND cc.CueTipo LIKE 'DINERO%' AND cl.TClIdTipoCliente = 1
  AND cc.MonIdMoneda <> d.MonIdMoneda                 -- la cuenta es de otra moneda que el documento
  AND ABS(m.MovImporte - d.DocTotal) < 0.02           -- y se estampó el total del documento sin convertir
  AND x.Cargo > 0.005 AND ABS(m.MovImporte - x.Cargo) > 0.02;

/* ── CANDADOS ─────────────────────────────────────────────────────────────── */
DECLARE @N INT = (SELECT COUNT(*) FROM @Fix), @NCli INT = (SELECT COUNT(DISTINCT CliIdCliente) FROM @Fix);
IF @N <> 35 OR @NCli <> 31
BEGIN
    SELECT 'CANDADO' AS Aviso, @N AS MovimientosDetectados, @NCli AS ClientesDetectados, 35 AS Esperado_Movs, 31 AS Esperado_Clientes;
    RAISERROR('CANDADO: se esperaban 35 cobros de 31 clientes y el detector encontro otra cosa. No se toca nada — revisar antes.', 16, 1); RETURN;
END

-- Vista previa: cada cuenta de los 31 tiene que quedar en 0 al aplicar
DECLARE @Prev TABLE (CliIdCliente INT, CueIdCuenta INT, Moneda VARCHAR(3), SaldoHoy DECIMAL(18,2), Correccion DECIMAL(18,2), SaldoDespues DECIMAL(18,2));
INSERT INTO @Prev
SELECT cc.CliIdCliente, cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       s.Saldo, ISNULL(f.Corr, 0), s.Saldo - ISNULL(f.Corr, 0)
FROM dbo.CuentasCliente cc JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                        AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))) s
OUTER APPLY (SELECT Corr = CAST(SUM(f.ImporteViejo - f.ImporteNuevo) AS DECIMAL(18,2)) FROM @Fix f WHERE f.CueIdCuenta = cc.CueIdCuenta) f
WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1;

IF EXISTS (SELECT 1 FROM @Prev WHERE ABS(SaldoDespues) > 1)
BEGIN
    SELECT 'CANDADO - no queda en 0' AS Aviso, * FROM @Prev WHERE ABS(SaldoDespues) > 1;
    RAISERROR('CANDADO: alguna cuenta de estos clientes NO quedaria en 0 al corregir (listada arriba). Este lote es solo para los que quedan en 0. No se toca nada.', 16, 1); RETURN;
END

/* ── ANTES ────────────────────────────────────────────────────────────────── */
SELECT 'RESUMEN' AS Paso, @N AS Movimientos, @NCli AS Clientes, (SELECT COUNT(DISTINCT CueIdCuenta) FROM @Fix) AS Cuentas,
       CAST(SUM(f.ImporteViejo - f.ImporteNuevo) AS DECIMAL(18,2)) AS FantasmaUSD FROM @Fix f;

SELECT 'A CORREGIR' AS Paso, f.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, f.CueIdCuenta, f.MovIdMovimiento, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, f.Doc,
       CAST(f.ImporteViejo AS DECIMAL(18,2)) AS PagoEscrito, CAST(f.ImporteNuevo AS DECIMAL(18,2)) AS PagoCorrectoUSD
FROM @Fix f JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = f.MovIdMovimiento JOIN dbo.Clientes c ON c.CliIdCliente = f.CliIdCliente
ORDER BY f.CliIdCliente, m.MovFecha;

SELECT 'VISTA PREVIA POR CUENTA' AS Paso, p.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, p.CueIdCuenta, p.Moneda, p.SaldoHoy, p.Correccion, p.SaldoDespues
FROM @Prev p JOIN dbo.Clientes c ON c.CliIdCliente = p.CliIdCliente WHERE p.Correccion <> 0 OR ABS(p.SaldoHoy) > 1 ORDER BY p.CliIdCliente, p.CueIdCuenta;

/* ── APLICAR ──────────────────────────────────────────────────────────────── */
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

    UPDATE m
    SET m.MovImporte = f.ImporteNuevo,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' FIX_MONEDA_2026-09-22: el cobro decia '
            + CONVERT(VARCHAR(30), CAST(f.ImporteViejo AS DECIMAL(18,2))) + ' (el total en pesos del documento) en una cuenta en dolares; queda igual al cargo: '
            + CONVERT(VARCHAR(30), CAST(f.ImporteNuevo AS DECIMAL(18,2))) + '. fix_lote_pesos_en_usd_31_clientes_a_cero.sql'), 500)
    FROM dbo.MovimientosCuenta m JOIN @Fix f ON f.MovIdMovimiento = m.MovIdMovimiento;

    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Fix) AND ISNULL(m.MovAnulado, 0) = 0
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0), 0)
    FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Fix);

    -- Verificación dura: todas las cuentas de dinero de los 31 en 0 (±1). Si no, se deshace TODO.
    IF EXISTS (SELECT 1 FROM dbo.CuentasCliente cc JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
               WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1
                 AND ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                                 AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) > 1)
    BEGIN
        ROLLBACK TRANSACTION;
        RAISERROR('VERIFICACION FALLO: alguna cuenta no quedo en 0. Se deshizo todo, no quedo nada escrito.', 16, 1); RETURN;
    END

    COMMIT TRANSACTION;
    PRINT CONCAT('Aplicado: ', @N, ' cobros de ', @NCli, ' clientes corregidos; sus cuentas quedaron en 0.');
END
ELSE
    PRINT 'SOLO VISTA: no se escribio nada. Revisar y volver a correr con @SoloVista = 0.';

/* ── DESPUÉS ──────────────────────────────────────────────────────────────── */
SELECT CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END AS Momento,
       Cuentas = COUNT(*),
       EnCero = SUM(CASE WHEN ABS(s.Saldo) <= 1 THEN 1 ELSE 0 END),
       FueraDeCero = SUM(CASE WHEN ABS(s.Saldo) > 1 THEN 1 ELSE 0 END),
       SumaSaldos = CAST(SUM(s.Saldo) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                        AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1;
