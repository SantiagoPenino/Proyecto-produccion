/* ============================================================================
   LOTE 31-B — 31 clientes Común que quedan en 0,00 al corregir DOS cosas:
     A) el bug "pago en pesos escrito en la cuenta en dólares" (mismo detector
        y misma regla que el lote del 1/9 y que el lote de los 31 anteriores);
     B) el "cobro doble de julio": PAGO suelto a nivel orden ("Pago: DTF-4033
        (...)", sin documento, sin transacción de caja — a lo sumo imputado a una
        deuda de ORDEN ya cobrada) escrito
        el 3/7–17/7 ADEMÁS del cobro del documento contado. Verificado 22-sep
        en Ele23 DTF-5155/ET-1449, Franco castro DTF-4659/ET-1244, Seba
        Rodriguez DTF-4033/FA-16: la orden está dentro del documento facturado
        y el documento ya tiene su cobro completo → el suelto es el duplicado.

   CANDADO POR DOCUMENTO (B): un suelto se anula SOLO si TODAS las órdenes que
   nombra están facturadas y el documento de cada una ya tiene cobro propio por
   el total de su cargo. Si el documento no tiene cobro (caso Marcos Mendez,
   Horacio Vaiz, Rdssport), el suelto es el cobro real y NO se toca — esos
   clientes no están en esta lista.

   QUÉ HACE
     A) MovImporte del cobro = cargo del mismo documento en la misma cuenta.
     B) MovAnulado = 1 en el PAGO suelto duplicado (no se borra: queda anulado
        con la explicación en la observación). Fecha original intacta.
     Recalcula MovSaldoPosterior y CueSaldoActual de las cuentas tocadas y
     VERIFICA dentro de la transacción que TODAS las cuentas de dinero de los 31
     quedaron en 0 (±1). Si una sola no → ROLLBACK de todo.
     NO toca Pagos/TransaccionesCaja, documentos, deudas ni otros clientes.

   ESPERADO: A) 34 cobros (US$ 69.195,29) · B) 61 sueltos anulados (US$ 2.120,43) · 31 clientes · después 0
   cuentas fuera de cero (los números exactos se controlan con candado abajo).

   Correr en PRODUCCIÓN, en SSMS, entero (F5). @SoloVista = 1 (default) solo
   muestra; @SoloVista = 0 aplica. No deja transacciones abiertas.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar
DECLARE @EsperadoA INT = 34, @EsperadoB INT = 61, @EsperadoCli INT = 31;

DECLARE @Clientes TABLE (CliIdCliente INT PRIMARY KEY);
INSERT INTO @Clientes VALUES (30),(52),(62),(102),(379),(669),(1565),(1634),(2044),(2177),(2772),(2815),(2877),(2909),(2955),(5641),
                             (5710),(5721),(5801),(5903),(5904),(5935),(5982),(6908),(6931),(6937),(7270),(8328),(8452),(8587),(8600);

/* ── A) cobros en pesos dentro de cuentas US$ (detector del lote del 1/9) ─── */
DECLARE @FixA TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, CliIdCliente INT, Doc VARCHAR(30), ImporteViejo DECIMAL(18,4), ImporteNuevo DECIMAL(18,4));
INSERT INTO @FixA
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
  AND cc.MonIdMoneda <> d.MonIdMoneda AND ABS(m.MovImporte - d.DocTotal) < 0.02
  AND x.Cargo > 0.005 AND ABS(m.MovImporte - x.Cargo) > 0.02;

/* ── B) cobros sueltos de julio a nivel orden, duplicados del cobro del documento ── */
DECLARE @Sueltos TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, CliIdCliente INT, MovFecha DATETIME, MovImporte DECIMAL(18,4), MovConcepto NVARCHAR(500), PagIdPago INT);
INSERT INTO @Sueltos
SELECT m.MovIdMovimiento, m.CueIdCuenta, cc.CliIdCliente, m.MovFecha, m.MovImporte, m.MovConcepto, m.PagIdPago
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
WHERE cc.CueTipo LIKE 'DINERO%' AND ISNULL(m.MovAnulado, 0) = 0 AND m.DocIdDocumento IS NULL
  AND m.MovTipo IN ('PAGO','COBRO') AND m.MovImporte > 0 AND m.MovConcepto LIKE 'Pago:%'
  -- si tiene imputación, solo puede ser a una deuda de ORDEN (nunca a un documento): es el cobro a nivel orden
  AND NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
                  WHERE ip.PagIdPago = m.PagIdPago AND dd.DocIdDocumento IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM dbo.Pagos p WHERE p.PagIdPago = m.PagIdPago AND p.PagTcaIdTransaccion IS NOT NULL);     -- sin transacción de caja

-- Las órdenes que nombra cada suelto: "Pago: DTF-4033 (escudo), SUB-4612 (papel)" → DTF-4033, SUB-4612
DECLARE @Ords TABLE (MovIdMovimiento INT, CliIdCliente INT, Cod VARCHAR(60));
INSERT INTO @Ords
SELECT s.MovIdMovimiento, s.CliIdCliente, UPPER(LEFT(t.Codigo, CHARINDEX(' ', t.Codigo + ' ') - 1))
FROM @Sueltos s
CROSS APPLY (SELECT Codigo = LTRIM(RTRIM(v.value)) FROM STRING_SPLIT(REPLACE(s.MovConcepto, 'Pago:', ''), ',') v) t
WHERE t.Codigo LIKE '%-%';

-- Por cada orden: ¿está facturada, y el documento tiene cobro propio por el total de su cargo?
DECLARE @Estado TABLE (MovIdMovimiento INT, Cod VARCHAR(60), DocIdDocumento INT, DocOK BIT);
INSERT INTO @Estado
SELECT o.MovIdMovimiento, o.Cod, x.DocIdDocumento,
       DocOK = CASE WHEN x.DocIdDocumento IS NOT NULL AND x.Cobro >= x.Cargo - 0.02 AND x.Cargo > 0.005 THEN 1 ELSE 0 END
FROM @Ords o
OUTER APPLY (
    SELECT TOP 1 mo.DocIdDocumento,
           Cargo = ISNULL((SELECT ABS(SUM(z.MovImporte)) FROM dbo.MovimientosCuenta z WHERE z.DocIdDocumento = mo.DocIdDocumento AND ISNULL(z.MovAnulado,0)=0
                           AND z.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND z.MovImporte < 0), 0),
           Cobro = ISNULL((SELECT SUM(z.MovImporte) FROM dbo.MovimientosCuenta z WHERE z.DocIdDocumento = mo.DocIdDocumento AND ISNULL(z.MovAnulado,0)=0
                           AND z.MovTipo IN ('PAGO','COBRO') AND z.MovImporte > 0), 0)
    FROM dbo.MovimientosCuenta mo JOIN dbo.CuentasCliente c2 ON c2.CueIdCuenta = mo.CueIdCuenta
    WHERE c2.CliIdCliente = o.CliIdCliente AND mo.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND ISNULL(mo.MovAnulado,0)=0 AND mo.DocIdDocumento IS NOT NULL
      AND (mo.MovConcepto = o.Cod OR mo.MovConcepto LIKE o.Cod + ' %' OR mo.MovConcepto LIKE o.Cod + '(%')
    ORDER BY mo.DocIdDocumento DESC) x;

DECLARE @FixB TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, CliIdCliente INT, MovFecha DATETIME, MovImporte DECIMAL(18,4), Concepto NVARCHAR(200), Docs NVARCHAR(200));
INSERT INTO @FixB
SELECT s.MovIdMovimiento, s.CueIdCuenta, s.CliIdCliente, s.MovFecha, s.MovImporte, LEFT(s.MovConcepto, 200),
       (SELECT STRING_AGG(CAST(RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero) AS NVARCHAR(MAX)), ', ') FROM (SELECT DISTINCT e.DocIdDocumento FROM @Estado e WHERE e.MovIdMovimiento = s.MovIdMovimiento) q JOIN dbo.DocumentosContables d ON d.DocIdDocumento = q.DocIdDocumento)
FROM @Sueltos s
WHERE EXISTS (SELECT 1 FROM @Ords o WHERE o.MovIdMovimiento = s.MovIdMovimiento)                          -- nombra al menos una orden
  AND NOT EXISTS (SELECT 1 FROM @Estado e WHERE e.MovIdMovimiento = s.MovIdMovimiento AND e.DocOK = 0);   -- y TODAS están facturadas con cobro propio completo

/* ── CANDADOS ─────────────────────────────────────────────────────────────── */
DECLARE @NA INT = (SELECT COUNT(*) FROM @FixA), @NB INT = (SELECT COUNT(*) FROM @FixB),
        @NCli INT = (SELECT COUNT(DISTINCT CliIdCliente) FROM (SELECT CliIdCliente FROM @FixA UNION SELECT CliIdCliente FROM @FixB) u);
IF @NA <> @EsperadoA OR @NB <> @EsperadoB OR @NCli <> @EsperadoCli
BEGIN
    SELECT 'CANDADO' AS Aviso, @NA AS A_Detectados, @EsperadoA AS A_Esperados, @NB AS B_Detectados, @EsperadoB AS B_Esperados, @NCli AS Clientes, @EsperadoCli AS ClientesEsperados;
    SELECT 'SUELTOS QUE NO PASAN EL CANDADO POR DOCUMENTO' AS Aviso, s.CliIdCliente, s.MovIdMovimiento, s.MovFecha, s.MovImporte, LEFT(s.MovConcepto,80) AS Concepto
    FROM @Sueltos s WHERE NOT EXISTS (SELECT 1 FROM @FixB f WHERE f.MovIdMovimiento = s.MovIdMovimiento);
    RAISERROR('CANDADO: los conteos no son los esperados (ver arriba). No se toca nada — revisar antes.', 16, 1); RETURN;
END

-- Vista previa: todas las cuentas de dinero de los 31 tienen que quedar en 0
DECLARE @Prev TABLE (CliIdCliente INT, CueIdCuenta INT, Moneda VARCHAR(3), SaldoHoy DECIMAL(18,2), CorrA DECIMAL(18,2), CorrB DECIMAL(18,2), SaldoDespues DECIMAL(18,2));
INSERT INTO @Prev
SELECT cc.CliIdCliente, cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END, s.Saldo, ISNULL(a.C, 0), ISNULL(b.C, 0), s.Saldo - ISNULL(a.C, 0) - ISNULL(b.C, 0)
FROM dbo.CuentasCliente cc JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                        AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))) s
OUTER APPLY (SELECT C = CAST(SUM(f.ImporteViejo - f.ImporteNuevo) AS DECIMAL(18,2)) FROM @FixA f WHERE f.CueIdCuenta = cc.CueIdCuenta) a
OUTER APPLY (SELECT C = CAST(SUM(f.MovImporte) AS DECIMAL(18,2)) FROM @FixB f WHERE f.CueIdCuenta = cc.CueIdCuenta) b
WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1;

IF EXISTS (SELECT 1 FROM @Prev WHERE ABS(SaldoDespues) > 1)
BEGIN
    SELECT 'CANDADO - no queda en 0' AS Aviso, * FROM @Prev WHERE ABS(SaldoDespues) > 1;
    RAISERROR('CANDADO: alguna cuenta NO quedaria en 0 (listada arriba). Este lote es solo para los que quedan en 0. No se toca nada.', 16, 1); RETURN;
END

/* ── ANTES ────────────────────────────────────────────────────────────────── */
SELECT 'RESUMEN' AS Paso, @NA AS A_CobrosPesosEnUSD, CAST((SELECT SUM(ImporteViejo - ImporteNuevo) FROM @FixA) AS DECIMAL(18,2)) AS A_FantasmaUSD,
       @NB AS B_SueltosDuplicados, CAST((SELECT SUM(f.MovImporte) FROM @FixB f JOIN dbo.CuentasCliente c ON c.CueIdCuenta = f.CueIdCuenta WHERE c.MonIdMoneda = 2) AS DECIMAL(18,2)) AS B_USD,
       CAST((SELECT SUM(f.MovImporte) FROM @FixB f JOIN dbo.CuentasCliente c ON c.CueIdCuenta = f.CueIdCuenta WHERE c.MonIdMoneda <> 2) AS DECIMAL(18,2)) AS B_UYU, @NCli AS Clientes;

SELECT 'A · A CORREGIR' AS Paso, f.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, f.CueIdCuenta, f.MovIdMovimiento, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, f.Doc,
       CAST(f.ImporteViejo AS DECIMAL(18,2)) AS PagoEscrito, CAST(f.ImporteNuevo AS DECIMAL(18,2)) AS PagoCorrectoUSD
FROM @FixA f JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = f.MovIdMovimiento JOIN dbo.Clientes c ON c.CliIdCliente = f.CliIdCliente ORDER BY f.CliIdCliente, m.MovFecha;

SELECT 'B · A ANULAR' AS Paso, f.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, f.CueIdCuenta, f.MovIdMovimiento, CONVERT(VARCHAR(16), f.MovFecha, 120) AS Fecha,
       CAST(f.MovImporte AS DECIMAL(18,2)) AS Importe, f.Concepto, f.Docs AS DocumentoQueYaLoCobro
FROM @FixB f JOIN dbo.Clientes c ON c.CliIdCliente = f.CliIdCliente ORDER BY f.CliIdCliente, f.MovFecha;

SELECT 'VISTA PREVIA POR CUENTA' AS Paso, p.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, p.CueIdCuenta, p.Moneda, p.SaldoHoy, p.CorrA, p.CorrB, p.SaldoDespues
FROM @Prev p JOIN dbo.Clientes c ON c.CliIdCliente = p.CliIdCliente WHERE p.CorrA <> 0 OR p.CorrB <> 0 OR ABS(p.SaldoHoy) > 1 ORDER BY p.CliIdCliente, p.CueIdCuenta;

/* ── APLICAR ──────────────────────────────────────────────────────────────── */
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

    UPDATE m
    SET m.MovImporte = f.ImporteNuevo,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' FIX_MONEDA_2026-09-22: el cobro decia '
            + CONVERT(VARCHAR(30), CAST(f.ImporteViejo AS DECIMAL(18,2))) + ' (el total en pesos del documento) en una cuenta en dolares; queda igual al cargo: '
            + CONVERT(VARCHAR(30), CAST(f.ImporteNuevo AS DECIMAL(18,2))) + '. fix_lote_31b'), 500)
    FROM dbo.MovimientosCuenta m JOIN @FixA f ON f.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' ANULADO 22-sep-2026 (FIX_COBRO_DOBLE_JULIO): cobro a nivel orden duplicado — '
            + 'la(s) orden(es) ya estan facturadas y cobradas en ' + ISNULL(f.Docs, '?') + '. fix_lote_31b'), 500)
    FROM dbo.MovimientosCuenta m JOIN @FixB f ON f.MovIdMovimiento = m.MovIdMovimiento;

    ;WITH ctas AS (SELECT CueIdCuenta FROM @FixA UNION SELECT CueIdCuenta FROM @FixB),
    ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta IN (SELECT CueIdCuenta FROM ctas) AND ISNULL(m.MovAnulado, 0) = 0
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0), 0)
    FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta IN (SELECT CueIdCuenta FROM @FixA UNION SELECT CueIdCuenta FROM @FixB);

    IF EXISTS (SELECT 1 FROM dbo.CuentasCliente cc JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
               WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1
                 AND ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                                 AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) > 1)
    BEGIN
        ROLLBACK TRANSACTION;
        RAISERROR('VERIFICACION FALLO: alguna cuenta no quedo en 0. Se deshizo todo, no quedo nada escrito.', 16, 1); RETURN;
    END

    COMMIT TRANSACTION;
    PRINT CONCAT('Aplicado: ', @NA, ' cobros corregidos + ', @NB, ' sueltos anulados en ', @NCli, ' clientes; sus cuentas quedaron en 0.');
END
ELSE
    PRINT 'SOLO VISTA: no se escribio nada. Revisar y volver a correr con @SoloVista = 0.';

/* ── DESPUÉS ──────────────────────────────────────────────────────────────── */
SELECT CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END AS Momento,
       Cuentas = COUNT(*), EnCero = SUM(CASE WHEN ABS(s.Saldo) <= 1 THEN 1 ELSE 0 END), FueraDeCero = SUM(CASE WHEN ABS(s.Saldo) > 1 THEN 1 ELSE 0 END),
       SumaSaldos = CAST(SUM(s.Saldo) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                        AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1;
