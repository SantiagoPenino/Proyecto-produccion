/* ============================================================================
   ELISA RAMOS (PODIUM2024) - FA-386: baja el cargo de 462,30 a 429,23.
   El CFE aceptado por DGI dice 429,23 y sus lineas suman 429,23. Manda el documento.
   Idempotente: si ya esta en 429,23 no hace nada.
   ABRIR DESDE EL DISCO en SSMS (File -> Open) y correr TODO.
   ============================================================================ */
SET NOCOUNT ON;

-- 1. MIRA ESTO: donde se esta corriendo
SELECT Servidor = @@SERVERNAME, Base = DB_NAME();

BEGIN TRANSACTION;

-- 2. El cargo
UPDATE m
SET m.MovImporte = -429.23,
    m.MovObservaciones = 'FIX_CARGO_AL_DOCUMENTO 04-09-2026: decia -462.30 (suma de las 3 ordenes del ciclo); el CFE ACEPTADO_DGI dice 429.23.'
FROM dbo.MovimientosCuenta m
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
JOIN dbo.Clientes c           ON c.CliIdCliente   = d.CliIdCliente
WHERE RTRIM(d.DocSerie) = 'FA' AND RTRIM(d.DocNumero) = '386'
  AND RTRIM(ISNULL(c.CioRuc,'')) = '218978560014'
  AND m.MovTipo = 'CIERRE_CICLO'
  AND ABS(m.MovImporte + 462.30) < 0.005
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

PRINT CONCAT('Cargos corregidos: ', @@ROWCOUNT, ' (0 = ya estaba bien)');

-- 3. Recalcular saldo corrido y CueSaldoActual de la cuenta 148
;WITH ord AS (
    SELECT m.MovIdMovimiento,
           run = SUM(m.MovImporte) OVER (ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
    FROM dbo.MovimientosCuenta m
    WHERE m.CueIdCuenta = 148 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
)
UPDATE m SET m.MovSaldoPosterior = ord.run
FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

UPDATE cc
SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                WHERE m.CueIdCuenta = 148 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta = 148;

COMMIT TRANSACTION;

-- 4. Tiene que dar SaldoLibro -244.77 y Cuadre 0
SELECT cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro  = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudasVivas = CAST(dv.Viva AS DECIMAL(18,2)),
       Cuadre      = CAST(dv.Viva - CASE WHEN s.Saldo < 0 THEN -s.Saldo ELSE 0 END AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
               WHERE dd.CueIdCuenta = cc.CueIdCuenta
                 AND dd.DDeEstado NOT IN ('CANCELADA','PAGADO','COBRADO')), 0)) dv
WHERE cc.CliIdCliente = 1041 AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;
