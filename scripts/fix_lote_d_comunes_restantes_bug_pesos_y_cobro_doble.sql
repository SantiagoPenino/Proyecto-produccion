/* ============================================================================
   LOTE D — Común que TODAVÍA tienen saldo a favor después de los lotes 31,
   31-B y C. A estos NO los deja en 0: les saca lo que es error mecánico y los
   deja con su resto REAL, que es lo que después se mira de a uno.

   Dos correcciones, las mismas de los lotes anteriores:
     A) bug "pago en pesos escrito en la cuenta en dólares": el cobro queda por
        el importe del cargo de su cuenta (detector del lote del 1/9).
     B) "cobro doble de julio": PAGO suelto a nivel orden anulado SOLO si TODAS
        las órdenes que nombra están facturadas y el documento de cada una ya
        tiene cobro propio por el total de su cargo. Además, si al anular el
        suelto la cuenta queda en negativo Y en esa cuenta hay documentos
        cobrados de menos, el suelto es el cobro real de esos documentos
        (Marcos Mendez, Horacio Vaiz, jim texeira, Bamtelas): NO se anula, se
        lista aparte para vincularlo a mano. Si queda en negativo sin
        documentos sin cobro, el negativo es deuda real (la cuenta gastó el
        crédito fantasma en cruces automáticos) y B se aplica igual.

   QUÉ CLIENTES: todos los Común con alguna cuenta de dinero activa con saldo
   > 1 al momento de correr (base viva), menos los ya procesados por los lotes
   anteriores (lista fija abajo; Lumifran y Morino1204 quedaron afuera del C y
   por eso SÍ entran acá).

   VERIFICACIÓN: para cada cuenta tocada, el saldo final tiene que ser EXACTO
   al previsto (saldo de hoy − A − B). Si una sola difiere → ROLLBACK de todo.
   La grilla del final ("DESPUES") es la lista para revisar de a uno.

   ESPERADO (local 22-sep): A) 23 cobros de 18 clientes (US$ 63.495,67) ·
   B) 84 sueltos de 48 clientes (US$ 4.955,09 + $ 2.205) · 4 clientes con B
   pendiente de vincular a mano. Candado: nunca MÁS que el techo; menos sí.

   Correr en PRODUCCIÓN, en SSMS, entero (F5). @SoloVista = 1 (default) solo
   muestra; @SoloVista = 0 aplica. No deja transacciones abiertas.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar
DECLARE @MaxA INT = 40, @MaxB INT = 120;   -- techo de seguridad para los conteos

-- Ya procesados por los lotes 31, 31-B y C (no se vuelven a tocar). 1682 Lumifran y 5956 Morino1204 NO están: entran acá.
DECLARE @Ya TABLE (CliIdCliente INT PRIMARY KEY);
INSERT INTO @Ya VALUES
(93),(226),(289),(467),(633),(729),(825),(831),(883),(1366),(1482),(2041),(2170),(2245),(2259),(3042),(5227),(5431),(6776),(7002),(7171),(8478),(8502),(8610),(8677),(8698),(8710),(8717),(8815),(9048),(9050),
(30),(52),(62),(102),(379),(669),(1565),(1634),(2044),(2177),(2772),(2815),(2877),(2909),(2955),(5641),(5710),(5721),(5801),(5903),(5904),(5935),(5982),(6908),(6931),(6937),(7270),(8328),(8452),(8587),(8600),
(15),(70),(74),(82),(84),(107),(129),(144),(148),(149),(166),(181),(189),(261),(266),(273),(276),(277),(288),(325),(348),(364),(372),(377),(397),(399),(401),(417),(436),(451),
(507),(513),(571),(589),(595),(616),(619),(621),(643),(645),(656),(680),(739),(746),(771),(784),(805),(870),(882),(894),(921),(976),(1003),(1082),(1097),(1149),(1210),(1213),(1228),(1230),
(1254),(1257),(1281),(1291),(1309),(1315),(1336),(1343),(1377),(1426),(1443),(1449),(1481),(1591),(1605),(1608),(1651),(1662),(1681),(1706),(1711),(1713),(1727),(1806),(1809),(1814),(1860),(1902),(1907),
(1920),(1933),(1973),(1984),(2036),(2076),(2081),(2130),(2143),(2214),(2249),(2286),(2312),(2340),(2360),(2381),(2455),(2458),(2468),(2513),(2536),(2569),(2633),(2642),(2646),(2656),(2718),(2768),(2855),(2962),
(2999),(3027),(3039),(3045),(3067),(3069),(3115),(3119),(3132),(5160),(5163),(5190),(5192),(5202),(5214),(5242),(5275),(5348),(5356),(5413),(5518),(5611),(5635),(5646),(5665),(5671),(5684),(5701),(5756),(5776),
(5836),(5870),(5884),(5916),(5958),(5962),(5979),(6339),(6660),(6815),(6849),(6851),(6855),(6900),(6924),(6935),(6940),(6942),(6970),(6972),(6978),(6985),(6986),(6988),(6989),(7037),(7052),(7067),(7079),
(7100),(7132),(7184),(7202),(7222),(7225),(7241),(7250),(7261),(8306),(8413),(8422),(8441),(8456),(8457),(8503),(8533),(8579),(8581),(8591),(8592),(8598),(8609),(8616),(8619),(8620),(8623),(8624),(8634),(8636),
(8643),(8644),(8723);

-- Clientes de este lote: Común con alguna cuenta de dinero a favor HOY
DECLARE @Clientes TABLE (CliIdCliente INT PRIMARY KEY);
INSERT INTO @Clientes
SELECT cl.CliIdCliente FROM dbo.Clientes cl
WHERE ISNULL(cl.TClIdTipoCliente, 0) = 1 AND cl.CliIdCliente NOT IN (SELECT CliIdCliente FROM @Ya)
  AND EXISTS (SELECT 1 FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = cl.CliIdCliente AND cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1
              AND ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                          AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) > 1);

/* ── A) cobros en pesos dentro de cuentas US$ ─────────────────────────────── */
DECLARE @FixA TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, CliIdCliente INT, Doc VARCHAR(30), ImporteViejo DECIMAL(18,4), ImporteNuevo DECIMAL(18,4));
INSERT INTO @FixA
SELECT m.MovIdMovimiento, m.CueIdCuenta, cc.CliIdCliente, RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), m.MovImporte, x.Cargo
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
CROSS APPLY (SELECT Cargo = ISNULL(ABS(SUM(m2.MovImporte)), 0) FROM dbo.MovimientosCuenta m2
             WHERE m2.DocIdDocumento = m.DocIdDocumento AND m2.CueIdCuenta = m.CueIdCuenta AND ISNULL(m2.MovAnulado, 0) = 0
               AND m2.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m2.MovImporte < 0) x
WHERE ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo = 'PAGO' AND m.MovImporte > 0 AND cc.CueTipo LIKE 'DINERO%'
  AND cc.MonIdMoneda <> d.MonIdMoneda AND ABS(m.MovImporte - d.DocTotal) < 0.02
  AND x.Cargo > 0.005 AND ABS(m.MovImporte - x.Cargo) > 0.02;

/* ── B) cobros sueltos de julio a nivel orden, duplicados del cobro del documento ── */
DECLARE @Sueltos TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, CliIdCliente INT, MovFecha DATETIME, MovImporte DECIMAL(18,4), MovConcepto NVARCHAR(500), PagIdPago INT);
INSERT INTO @Sueltos
SELECT m.MovIdMovimiento, m.CueIdCuenta, cc.CliIdCliente, m.MovFecha, m.MovImporte, m.MovConcepto, m.PagIdPago
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
WHERE cc.CueTipo LIKE 'DINERO%' AND ISNULL(m.MovAnulado, 0) = 0 AND m.DocIdDocumento IS NULL
  AND m.MovTipo IN ('PAGO','COBRO') AND m.MovImporte > 0 AND m.MovConcepto LIKE 'Pago:%'
  AND NOT EXISTS (SELECT 1 FROM dbo.ImputacionPago ip JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
                  WHERE ip.PagIdPago = m.PagIdPago AND dd.DocIdDocumento IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM dbo.Pagos p WHERE p.PagIdPago = m.PagIdPago AND p.PagTcaIdTransaccion IS NOT NULL);

DECLARE @Ords TABLE (MovIdMovimiento INT, CliIdCliente INT, Cod VARCHAR(60));
INSERT INTO @Ords
SELECT s.MovIdMovimiento, s.CliIdCliente, UPPER(LEFT(t.Codigo, CHARINDEX(' ', t.Codigo + ' ') - 1))
FROM @Sueltos s CROSS APPLY (SELECT Codigo = LTRIM(RTRIM(v.value)) FROM STRING_SPLIT(REPLACE(s.MovConcepto, 'Pago:', ''), ',') v) t
WHERE t.Codigo LIKE '%-%';

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
WHERE EXISTS (SELECT 1 FROM @Ords o WHERE o.MovIdMovimiento = s.MovIdMovimiento)
  AND NOT EXISTS (SELECT 1 FROM @Estado e WHERE e.MovIdMovimiento = s.MovIdMovimiento AND e.DocOK = 0);

/* ── CANDADOS ─────────────────────────────────────────────────────────────── */
DECLARE @NA INT = (SELECT COUNT(*) FROM @FixA), @NB INT = (SELECT COUNT(*) FROM @FixB);
IF @NA + @NB = 0 BEGIN RAISERROR('No hay nada para corregir en los clientes restantes. No se toca nada.', 16, 1); RETURN; END
IF @NA > @MaxA OR @NB > @MaxB
BEGIN
    SELECT 'CANDADO' AS Aviso, @NA AS A_Detectados, @MaxA AS A_Techo, @NB AS B_Detectados, @MaxB AS B_Techo;
    RAISERROR('CANDADO: se detectaron MAS correcciones que el techo previsto. No se toca nada — revisar antes.', 16, 1); RETURN;
END

-- Previsión por cuenta (solo las que se tocan): saldo hoy, corrección y saldo que va a quedar
DECLARE @Prev TABLE (CliIdCliente INT, CueIdCuenta INT, Moneda VARCHAR(3), SaldoHoy DECIMAL(18,2), CorrA DECIMAL(18,2), CorrB DECIMAL(18,2), SaldoDespues DECIMAL(18,2));
INSERT INTO @Prev
SELECT cc.CliIdCliente, cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END, s.Saldo, ISNULL(a.C, 0), ISNULL(b.C, 0), s.Saldo - ISNULL(a.C, 0) - ISNULL(b.C, 0)
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                        AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))) s
OUTER APPLY (SELECT C = CAST(SUM(f.ImporteViejo - f.ImporteNuevo) AS DECIMAL(18,2)) FROM @FixA f WHERE f.CueIdCuenta = cc.CueIdCuenta) a
OUTER APPLY (SELECT C = CAST(SUM(f.MovImporte) AS DECIMAL(18,2)) FROM @FixB f WHERE f.CueIdCuenta = cc.CueIdCuenta) b
WHERE cc.CueIdCuenta IN (SELECT CueIdCuenta FROM @FixA UNION SELECT CueIdCuenta FROM @FixB);

-- B solo a clientes en los que NO deja ninguna cuenta en negativo. Si la deja debiendo, el suelto
-- probablemente es el cobro real de un documento sin cobro propio: vincular a mano, no anular.
-- Se distingue: si en esa cuenta hay documentos con cargo SIN cobro (o con cobro incompleto), el suelto es
-- casi seguro el cobro real de esos documentos → no se toca. Si no los hay, el negativo que queda es deuda
-- real: la cuenta gasto el credito fantasma en cruces automaticos ('Cruce automatico -> Orden ...') y B se aplica igual.
DECLARE @SinB TABLE (CliIdCliente INT PRIMARY KEY);
INSERT INTO @SinB
SELECT DISTINCT p.CliIdCliente FROM @Prev p
WHERE p.CorrB <> 0 AND p.SaldoDespues < -1
  AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = p.CueIdCuenta AND ISNULL(m.MovAnulado,0)=0 AND m.DocIdDocumento IS NOT NULL
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO','PAGO_CRUZADO','AJUSTE_POS','AJUSTE_NEG','AJUSTE')
              GROUP BY m.DocIdDocumento HAVING SUM(m.MovImporte) < -0.5);   -- algun documento cobrado de menos en esta cuenta
IF EXISTS (SELECT 1 FROM @SinB)
    SELECT 'B NO APLICADO (hay documentos sin cobro en la cuenta: el suelto es el cobro real — vincular a mano)' AS Aviso, p.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, p.CueIdCuenta, p.Moneda, p.SaldoHoy, p.CorrA, p.CorrB, p.SaldoDespues
    FROM @Prev p JOIN dbo.Clientes c ON c.CliIdCliente = p.CliIdCliente WHERE p.CliIdCliente IN (SELECT CliIdCliente FROM @SinB) ORDER BY p.CliIdCliente, p.CueIdCuenta;
DELETE FROM @FixB WHERE CliIdCliente IN (SELECT CliIdCliente FROM @SinB);
SET @NB = (SELECT COUNT(*) FROM @FixB);
DELETE FROM @Prev;
INSERT INTO @Prev
SELECT cc.CliIdCliente, cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END, s.Saldo, ISNULL(a.C, 0), ISNULL(b.C, 0), s.Saldo - ISNULL(a.C, 0) - ISNULL(b.C, 0)
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                        AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))) s
OUTER APPLY (SELECT C = CAST(SUM(f.ImporteViejo - f.ImporteNuevo) AS DECIMAL(18,2)) FROM @FixA f WHERE f.CueIdCuenta = cc.CueIdCuenta) a
OUTER APPLY (SELECT C = CAST(SUM(f.MovImporte) AS DECIMAL(18,2)) FROM @FixB f WHERE f.CueIdCuenta = cc.CueIdCuenta) b
WHERE cc.CueIdCuenta IN (SELECT CueIdCuenta FROM @FixA UNION SELECT CueIdCuenta FROM @FixB);
IF @NA + @NB = 0 BEGIN RAISERROR('No quedo nada para corregir. No se toca nada.', 16, 1); RETURN; END

/* ── ANTES ────────────────────────────────────────────────────────────────── */
SELECT 'RESUMEN' AS Paso, (SELECT COUNT(*) FROM @Clientes) AS ComunesAFavorHoy,
       @NA AS A_Cobros, (SELECT COUNT(DISTINCT CliIdCliente) FROM @FixA) AS A_Clientes, CAST((SELECT SUM(ImporteViejo - ImporteNuevo) FROM @FixA) AS DECIMAL(18,2)) AS A_FantasmaUSD,
       @NB AS B_Sueltos, (SELECT COUNT(DISTINCT CliIdCliente) FROM @FixB) AS B_Clientes,
       CAST((SELECT SUM(f.MovImporte) FROM @FixB f JOIN dbo.CuentasCliente c ON c.CueIdCuenta = f.CueIdCuenta WHERE COALESCE(c.MonIdMoneda, CASE WHEN c.CueTipo = 'DINERO_USD' THEN 2 ELSE 1 END) = 2) AS DECIMAL(18,2)) AS B_USD,
       CAST((SELECT SUM(f.MovImporte) FROM @FixB f JOIN dbo.CuentasCliente c ON c.CueIdCuenta = f.CueIdCuenta WHERE COALESCE(c.MonIdMoneda, CASE WHEN c.CueTipo = 'DINERO_USD' THEN 2 ELSE 1 END) <> 2) AS DECIMAL(18,2)) AS B_UYU,
       (SELECT COUNT(*) FROM @Prev) AS CuentasTocadas, (SELECT COUNT(*) FROM @SinB) AS ClientesConB_Pendiente;

SELECT 'A · A CORREGIR' AS Paso, f.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, f.CueIdCuenta, f.MovIdMovimiento, CONVERT(VARCHAR(16), m.MovFecha, 120) AS Fecha, f.Doc,
       CAST(f.ImporteViejo AS DECIMAL(18,2)) AS PagoEscrito, CAST(f.ImporteNuevo AS DECIMAL(18,2)) AS PagoCorrectoUSD
FROM @FixA f JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = f.MovIdMovimiento JOIN dbo.Clientes c ON c.CliIdCliente = f.CliIdCliente ORDER BY f.CliIdCliente, m.MovFecha;

SELECT 'B · A ANULAR' AS Paso, f.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, f.CueIdCuenta, f.MovIdMovimiento, CONVERT(VARCHAR(16), f.MovFecha, 120) AS Fecha,
       CAST(f.MovImporte AS DECIMAL(18,2)) AS Importe, f.Concepto, f.Docs AS DocumentoQueYaLoCobro
FROM @FixB f JOIN dbo.Clientes c ON c.CliIdCliente = f.CliIdCliente ORDER BY f.CliIdCliente, f.MovFecha;

SELECT 'QUEDA ASI (previsto)' AS Paso, p.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, p.CueIdCuenta, p.Moneda, p.SaldoHoy, p.CorrA, p.CorrB, p.SaldoDespues
FROM @Prev p JOIN dbo.Clientes c ON c.CliIdCliente = p.CliIdCliente ORDER BY p.CliIdCliente, p.CueIdCuenta;

/* ── APLICAR ──────────────────────────────────────────────────────────────── */
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

    UPDATE m
    SET m.MovImporte = f.ImporteNuevo,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' FIX_MONEDA_2026-09-22: el cobro decia '
            + CONVERT(VARCHAR(30), CAST(f.ImporteViejo AS DECIMAL(18,2))) + ' (el total en pesos del documento) en una cuenta en dolares; queda igual al cargo: '
            + CONVERT(VARCHAR(30), CAST(f.ImporteNuevo AS DECIMAL(18,2))) + '. fix_lote_d'), 500)
    FROM dbo.MovimientosCuenta m JOIN @FixA f ON f.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' ANULADO 22-sep-2026 (FIX_COBRO_DOBLE_JULIO): cobro a nivel orden duplicado — '
            + 'la(s) orden(es) ya estan facturadas y cobradas en ' + ISNULL(f.Docs, '?') + '. fix_lote_d'), 500)
    FROM dbo.MovimientosCuenta m JOIN @FixB f ON f.MovIdMovimiento = m.MovIdMovimiento;

    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta IN (SELECT CueIdCuenta FROM @Prev) AND ISNULL(m.MovAnulado, 0) = 0
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0), 0)
    FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta IN (SELECT CueIdCuenta FROM @Prev);

    -- Verificación dura: cada cuenta tocada tiene que quedar EXACTO en lo previsto
    IF EXISTS (SELECT 1 FROM @Prev p
               WHERE ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = p.CueIdCuenta
                                 AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) - p.SaldoDespues) > 0.02)
    BEGIN
        ROLLBACK TRANSACTION;
        RAISERROR('VERIFICACION FALLO: alguna cuenta no quedo en lo previsto. Se deshizo todo, no quedo nada escrito.', 16, 1); RETURN;
    END

    COMMIT TRANSACTION;
    PRINT CONCAT('Aplicado: ', @NA, ' cobros corregidos + ', @NB, ' sueltos anulados. Cada cuenta quedo en lo previsto.');
END
ELSE
    PRINT 'SOLO VISTA: no se escribio nada. Revisar y volver a correr con @SoloVista = 0.';

/* ── DESPUÉS: cómo quedan los Común restantes (la lista para revisar de a uno) ── */
SELECT CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END AS Momento,
       cc.CliIdCliente, RTRIM(cl.IDCliente) AS Cliente, RTRIM(cl.Nombre) AS Nombre, cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END AS Moneda,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                        AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1 AND ABS(s.Saldo) > 1
ORDER BY cl.IDCliente, cc.CueIdCuenta;
