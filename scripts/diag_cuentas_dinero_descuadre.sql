/* ============================================================================
   DIAGNÓSTICO — CUENTAS DE DINERO: el chip de saldos no juega con el libro.
   SOLO LECTURA. No modifica nada. Correr en PRODUCCIÓN.

   Nada que ver con los metros (eso va en scripts/diag_metros_plan_vs_cuenta.sql).
   Acá el problema es que hay TRES fuentes distintas para el mismo saldo:
     - Chip "SALDOS" del panel 360  → CuentasCliente.CueSaldoActual (denormalizada)
     - Libro / movimientos          → SUM(MovimientosCuenta.MovImporte)
     - Tab "Estado de cuenta"       → documentos + pagos (DeudaDocumento)
   Si 'Dif' no es 0, las pantallas nunca van a coincidir: hay movimientos
   insertados, editados o borrados sin recomputar el saldo de la cuenta.

   El recálculo correcto ya existe en código: recomputarSaldoCuenta()
   (backend/controllers/contabilidadController.js) rehace MovSaldoPosterior de
   toda la cuenta y CueSaldoActual = SUM(MovImporte). Antes de correrlo sobre
   nada, mirar acá el alcance.
   ============================================================================ */

DECLARE @Cli INT;
SELECT @Cli = CliIdCliente FROM dbo.Clientes WHERE RTRIM(IDCliente) = 'TF SPORT';
SELECT @Cli AS CliIdCliente;   -- si sale NULL, ajustar el IDCliente de arriba

/* ── 1) Las cuentas de dinero de ESE cliente ──────────────────────────────
   Ojo con las cuentas RESTRINGIDAS: son plata atada a un fin concreto pero
   suman igual al chip de saldo a favor del encabezado.                      */
SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueNombre, cc.CueEsPrincipal, cc.CueRestringida,
       cc.CueSaldoActual                                   AS SaldoChip,
       x.SumaMovs                                          AS SaldoLibro,
       ROUND(cc.CueSaldoActual - ISNULL(x.SumaMovs, 0), 2) AS Dif,
       x.NMovs, x.UltMovFecha
FROM dbo.CuentasCliente cc
OUTER APPLY (
    SELECT COUNT(*) AS NMovs,
           SUM(CASE WHEN ISNULL(m.MovAnulado,0) = 0 THEN m.MovImporte ELSE 0 END) AS SumaMovs,
           MAX(m.MovFecha) AS UltMovFecha
    FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
) x
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueTipo, cc.CueIdCuenta;

/* ── 2) Desglose por tipo de movimiento de esas cuentas ───────────────────
   Para ver de qué lado viene el desfasaje (ORDEN, CIERRE_CICLO, PAGO…).    */
SELECT m.CueIdCuenta, cc.CueTipo, m.MovTipo,
       COUNT(*) AS N, SUM(m.MovImporte) AS Suma
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
  AND ISNULL(m.MovAnulado,0) = 0
GROUP BY m.CueIdCuenta, cc.CueTipo, m.MovTipo
ORDER BY m.CueIdCuenta, m.MovTipo;

/* ── 3) ALCANCE: las 100 cuentas de dinero más descuadradas de la base ────
   Este bloque barre TODA la base, no un cliente. Es el que dice cuán grande
   es el problema antes de decidir si se recalculan saldos masivamente.      */
SELECT TOP 100
       cc.CliIdCliente, RTRIM(c.Nombre) AS Cliente, RTRIM(c.IDCliente) AS Codigo,
       cc.CueIdCuenta, cc.CueTipo, cc.CueNombre,
       cc.CueSaldoActual AS SaldoChip, x.SumaMovs AS SaldoLibro,
       ROUND(cc.CueSaldoActual - ISNULL(x.SumaMovs,0), 2) AS Dif, x.NMovs
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
CROSS APPLY (
    SELECT COUNT(*) AS NMovs,
           SUM(CASE WHEN ISNULL(m.MovAnulado,0)=0 THEN m.MovImporte ELSE 0 END) AS SumaMovs
    FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
) x
WHERE cc.CueTipo LIKE 'DINERO%'
  AND ABS(cc.CueSaldoActual - ISNULL(x.SumaMovs,0)) > 0.5
ORDER BY ABS(cc.CueSaldoActual - ISNULL(x.SumaMovs,0)) DESC;

/* ── 4) Cuánto suma el descuadre, por moneda ──────────────────────────────
   Un total para dimensionar sin leer las 100 filas de arriba.              */
SELECT cc.CueTipo,
       COUNT(*)                                                  AS CuentasDescuadradas,
       SUM(ROUND(cc.CueSaldoActual - ISNULL(x.SumaMovs,0), 2))   AS DifTotal,
       MIN(ROUND(cc.CueSaldoActual - ISNULL(x.SumaMovs,0), 2))   AS PeorNegativa,
       MAX(ROUND(cc.CueSaldoActual - ISNULL(x.SumaMovs,0), 2))   AS PeorPositiva
FROM dbo.CuentasCliente cc
CROSS APPLY (
    SELECT SUM(CASE WHEN ISNULL(m.MovAnulado,0)=0 THEN m.MovImporte ELSE 0 END) AS SumaMovs
    FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
) x
WHERE cc.CueTipo LIKE 'DINERO%'
  AND ABS(cc.CueSaldoActual - ISNULL(x.SumaMovs,0)) > 0.5
GROUP BY cc.CueTipo;
