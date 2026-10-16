/* ============================================================================
   LOTE C — 213 clientes Común que quedan en 0,00 anulando SOLO el "cobro doble
   de julio": PAGO suelto a nivel orden ("Pago: DTF-4033 (...)", sin documento,
   sin transacción de caja, a lo sumo imputado a una deuda de ORDEN ya cobrada)
   escrito el 3/7–17/7 ADEMÁS del cobro del documento contado.
   Es la misma parte B del lote 31-B, aplicada a todos los Común restantes que
   con eso quedan en 0. Ninguno de estos tiene el bug de pesos-en-US$.

   CANDADO POR DOCUMENTO: un suelto se anula SOLO si TODAS las órdenes que
   nombra están facturadas y el documento de cada una ya tiene cobro propio por
   el total de su cargo (verificado 22-sep en Ele23, Franco castro, Seba
   Rodriguez, Rdssport). Si el documento no tiene cobro, el suelto es el cobro
   real y NO se toca — esos clientes quedan fuera de esta lista.

   QUÉ HACE
     MovAnulado = 1 en el PAGO suelto duplicado (no se borra; queda anulado con
     la explicación en la observación). Fecha original intacta.
     Recalcula MovSaldoPosterior y CueSaldoActual de las cuentas tocadas y
     VERIFICA dentro de la transacción que TODAS las cuentas de dinero de los
     213 quedaron en 0 (±1). Si una sola no → ROLLBACK de todo.
     NO toca Pagos/TransaccionesCaja, documentos, deudas ni otros clientes.

   ESPERADO: 287 sueltos anulados (US$ 9.433,57 + $ 3.780,00)
   · 213 clientes · después 0 cuentas fuera de cero (864 cuentas de dinero).
   Si en prod algún cliente de la lista ya no quedara en 0 (movimientos nuevos
   desde que se armó), el script LO SACA del lote, lo lista aparte y sigue con
   el resto: los conteos pueden ser menores a los esperados, nunca mayores.

   Correr en PRODUCCIÓN, en SSMS, entero (F5). @SoloVista = 1 (default) solo
   muestra; @SoloVista = 0 aplica. No deja transacciones abiertas.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar
DECLARE @EsperadoB INT = 287, @EsperadoCli INT = 213;

DECLARE @Clientes TABLE (CliIdCliente INT PRIMARY KEY);
INSERT INTO @Clientes VALUES
(15),(70),(74),(82),(84),(107),(129),(144),(148),(149),(166),(181),(189),(261),(266),(273),(276),(277),(288),(325),(348),(364),(372),(377),(397),(399),(401),(417),(436),(451),
(507),(513),(571),(589),(595),(616),(619),(621),(643),(645),(656),(680),(739),(746),(771),(784),(805),(870),(882),(894),(921),(976),(1003),(1082),(1097),(1149),(1210),(1213),(1228),(1230),
(1254),(1257),(1281),(1291),(1309),(1315),(1336),(1343),(1377),(1426),(1443),(1449),(1481),(1591),(1605),(1608),(1651),(1662),(1681),(1682),(1706),(1711),(1713),(1727),(1806),(1809),(1814),(1860),(1902),(1907),
(1920),(1933),(1973),(1984),(2036),(2076),(2081),(2130),(2143),(2214),(2249),(2286),(2312),(2340),(2360),(2381),(2455),(2458),(2468),(2513),(2536),(2569),(2633),(2642),(2646),(2656),(2718),(2768),(2855),(2962),
(2999),(3027),(3039),(3045),(3067),(3069),(3115),(3119),(3132),(5160),(5163),(5190),(5192),(5202),(5214),(5242),(5275),(5348),(5356),(5413),(5518),(5611),(5635),(5646),(5665),(5671),(5684),(5701),(5756),(5776),
(5836),(5870),(5884),(5916),(5956),(5958),(5962),(5979),(6339),(6660),(6815),(6849),(6851),(6855),(6900),(6924),(6935),(6940),(6942),(6970),(6972),(6978),(6985),(6986),(6988),(6989),(7037),(7052),(7067),(7079),
(7100),(7132),(7184),(7202),(7222),(7225),(7241),(7250),(7261),(8306),(8413),(8422),(8441),(8456),(8457),(8503),(8533),(8579),(8581),(8591),(8592),(8598),(8609),(8616),(8619),(8620),(8623),(8624),(8634),(8636),
(8643),(8644),(8723);

/* ── candado de tipo: todos tienen que ser Común ──────────────────────────── */
IF EXISTS (SELECT 1 FROM @Clientes k JOIN dbo.Clientes cl ON cl.CliIdCliente = k.CliIdCliente WHERE ISNULL(cl.TClIdTipoCliente, 0) <> 1)
BEGIN RAISERROR('CANDADO: hay un cliente de la lista que no es Comun. No se toca nada.', 16, 1); RETURN; END

/* ── los cobros sueltos de julio a nivel orden ─────────────────────────────── */
DECLARE @Sueltos TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, CliIdCliente INT, MovFecha DATETIME, MovImporte DECIMAL(18,4), MovConcepto NVARCHAR(500), PagIdPago INT);
INSERT INTO @Sueltos
SELECT m.MovIdMovimiento, m.CueIdCuenta, cc.CliIdCliente, m.MovFecha, m.MovImporte, m.MovConcepto, m.PagIdPago
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
WHERE cc.CueTipo LIKE 'DINERO%' AND ISNULL(m.MovAnulado, 0) = 0 AND m.DocIdDocumento IS NULL
  AND m.MovTipo IN ('PAGO','COBRO') AND m.MovImporte > 0 AND m.MovConcepto LIKE 'Pago:%'
  -- si tiene imputación, solo puede ser a una deuda de ORDEN (nunca a un documento)
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

DECLARE @Fix TABLE (MovIdMovimiento INT PRIMARY KEY, CueIdCuenta INT, CliIdCliente INT, MovFecha DATETIME, MovImporte DECIMAL(18,4), Concepto NVARCHAR(200), Docs NVARCHAR(200));
INSERT INTO @Fix
SELECT s.MovIdMovimiento, s.CueIdCuenta, s.CliIdCliente, s.MovFecha, s.MovImporte, LEFT(s.MovConcepto, 200),
       (SELECT STRING_AGG(CAST(RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero) AS NVARCHAR(MAX)), ', ') FROM (SELECT DISTINCT e.DocIdDocumento FROM @Estado e WHERE e.MovIdMovimiento = s.MovIdMovimiento) q JOIN dbo.DocumentosContables d ON d.DocIdDocumento = q.DocIdDocumento)
FROM @Sueltos s
WHERE EXISTS (SELECT 1 FROM @Ords o WHERE o.MovIdMovimiento = s.MovIdMovimiento)                          -- nombra al menos una orden
  AND NOT EXISTS (SELECT 1 FROM @Estado e WHERE e.MovIdMovimiento = s.MovIdMovimiento AND e.DocOK = 0);   -- y TODAS están facturadas con cobro propio completo

/* ── CANDADOS ─────────────────────────────────────────────────────────────── */
DECLARE @NB INT = (SELECT COUNT(*) FROM @Fix), @NCli INT = (SELECT COUNT(DISTINCT CliIdCliente) FROM @Fix);
IF @NB = 0 OR @NB > @EsperadoB OR @NCli > @EsperadoCli
BEGIN
    SELECT 'CANDADO' AS Aviso, @NB AS SueltosDetectados, @EsperadoB AS SueltosEsperados, @NCli AS Clientes, @EsperadoCli AS ClientesEsperados;
    RAISERROR('CANDADO: se detectaron MAS sueltos/clientes que los esperados (o ninguno). No se toca nada — revisar antes.', 16, 1); RETURN;
END

DECLARE @Prev TABLE (CliIdCliente INT, CueIdCuenta INT, Moneda VARCHAR(3), SaldoHoy DECIMAL(18,2), Correccion DECIMAL(18,2), SaldoDespues DECIMAL(18,2));
INSERT INTO @Prev
SELECT cc.CliIdCliente, cc.CueIdCuenta, CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END, s.Saldo, ISNULL(b.C, 0), s.Saldo - ISNULL(b.C, 0)
FROM dbo.CuentasCliente cc JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                        AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))) s
OUTER APPLY (SELECT C = CAST(SUM(f.MovImporte) AS DECIMAL(18,2)) FROM @Fix f WHERE f.CueIdCuenta = cc.CueIdCuenta) b
WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1;

-- Prod es una base viva: un cliente de la lista puede haber tenido movimientos nuevos desde que se armó
-- (o tener algo mas). Esos NO se tocan: se sacan del lote y se listan para mirarlos aparte.
DECLARE @Afuera TABLE (CliIdCliente INT PRIMARY KEY);
INSERT INTO @Afuera SELECT DISTINCT CliIdCliente FROM @Prev WHERE ABS(SaldoDespues) > 1;
IF EXISTS (SELECT 1 FROM @Afuera)
    SELECT 'QUEDAN AFUERA (hoy no quedarian en 0 — revisar aparte)' AS Aviso, p.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, p.CueIdCuenta, p.Moneda, p.SaldoHoy, p.Correccion, p.SaldoDespues
    FROM @Prev p JOIN dbo.Clientes c ON c.CliIdCliente = p.CliIdCliente WHERE p.CliIdCliente IN (SELECT CliIdCliente FROM @Afuera) ORDER BY p.CliIdCliente, p.CueIdCuenta;
DELETE FROM @Fix  WHERE CliIdCliente IN (SELECT CliIdCliente FROM @Afuera);
DELETE FROM @Prev WHERE CliIdCliente IN (SELECT CliIdCliente FROM @Afuera);
DELETE FROM @Clientes WHERE CliIdCliente IN (SELECT CliIdCliente FROM @Afuera);
SET @NB = (SELECT COUNT(*) FROM @Fix); SET @NCli = (SELECT COUNT(DISTINCT CliIdCliente) FROM @Fix);
IF @NB = 0 BEGIN RAISERROR('No quedo ningun cliente para procesar. No se toca nada.', 16, 1); RETURN; END

/* ── ANTES ────────────────────────────────────────────────────────────────── */
SELECT 'RESUMEN' AS Paso, @NB AS SueltosAAnular, @NCli AS Clientes, (SELECT COUNT(DISTINCT CueIdCuenta) FROM @Fix) AS Cuentas,
       CAST((SELECT SUM(f.MovImporte) FROM @Fix f JOIN dbo.CuentasCliente c ON c.CueIdCuenta = f.CueIdCuenta WHERE COALESCE(c.MonIdMoneda, CASE WHEN c.CueTipo = 'DINERO_USD' THEN 2 ELSE 1 END) = 2) AS DECIMAL(18,2)) AS ImporteUSD,
       CAST((SELECT SUM(f.MovImporte) FROM @Fix f JOIN dbo.CuentasCliente c ON c.CueIdCuenta = f.CueIdCuenta WHERE COALESCE(c.MonIdMoneda, CASE WHEN c.CueTipo = 'DINERO_USD' THEN 2 ELSE 1 END) <> 2) AS DECIMAL(18,2)) AS ImporteUYU,
       (SELECT COUNT(*) FROM @Prev) AS CuentasDeDineroProcesadas, (SELECT COUNT(*) FROM @Afuera) AS ClientesQueQuedanAfuera;

SELECT 'A ANULAR' AS Paso, f.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, f.CueIdCuenta, f.MovIdMovimiento, CONVERT(VARCHAR(16), f.MovFecha, 120) AS Fecha,
       CAST(f.MovImporte AS DECIMAL(18,2)) AS Importe, f.Concepto, f.Docs AS DocumentoQueYaLoCobro
FROM @Fix f JOIN dbo.Clientes c ON c.CliIdCliente = f.CliIdCliente ORDER BY f.CliIdCliente, f.MovFecha;

SELECT 'VISTA PREVIA POR CUENTA' AS Paso, p.CliIdCliente, RTRIM(c.IDCliente) AS Cliente, p.CueIdCuenta, p.Moneda, p.SaldoHoy, p.Correccion, p.SaldoDespues
FROM @Prev p JOIN dbo.Clientes c ON c.CliIdCliente = p.CliIdCliente WHERE p.Correccion <> 0 OR ABS(p.SaldoHoy) > 1 ORDER BY p.CliIdCliente, p.CueIdCuenta;

/* ── APLICAR ──────────────────────────────────────────────────────────────── */
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') + ' ANULADO 22-sep-2026 (FIX_COBRO_DOBLE_JULIO): cobro a nivel orden duplicado — '
            + 'la(s) orden(es) ya estan facturadas y cobradas en ' + ISNULL(f.Docs, '?') + '. fix_lote_c'), 500)
    FROM dbo.MovimientosCuenta m JOIN @Fix f ON f.MovIdMovimiento = m.MovIdMovimiento;

    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Fix) AND ISNULL(m.MovAnulado, 0) = 0
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado, 0) = 0), 0)
    FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Fix);

    IF EXISTS (SELECT 1 FROM dbo.CuentasCliente cc JOIN @Clientes k ON k.CliIdCliente = cc.CliIdCliente
               WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1
                 AND ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
                                 AND ISNULL(m.MovAnulado, 0) = 0 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) > 1)
    BEGIN
        ROLLBACK TRANSACTION;
        RAISERROR('VERIFICACION FALLO: alguna cuenta no quedo en 0. Se deshizo todo, no quedo nada escrito.', 16, 1); RETURN;
    END

    COMMIT TRANSACTION;
    PRINT CONCAT('Aplicado: ', @NB, ' sueltos anulados en ', @NCli, ' clientes; sus cuentas quedaron en 0.');
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
