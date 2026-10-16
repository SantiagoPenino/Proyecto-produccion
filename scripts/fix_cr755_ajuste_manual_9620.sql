/* ============================================================================
   ANULA EL AJUSTE MANUAL DE CR SPORT (CR-755) — US$ 9.620,62
   Correr en PRODUCCIÓN. Modifica dbo.MovimientosCuenta (MovAnulado = 1, NO borra),
   MovSaldoPosterior y CuentasCliente.CueSaldoActual. No toca DeudaDocumento.

   QUÉ ES: el 3-ago-2026 se cargó a mano un AJUSTE_POS de US$ 9.620,62 en la cuenta
   de dólares de CR SPORT, con fecha retroactiva al 15-jun-2026 y este concepto:
       "el saldo no reflejaba lo real, aparecía en negativo cuando el cliente
        tenía plata a favor"
   O sea: se creó plata para tapar el número que mostraba la columna CueSaldoActual
   (que está contaminada porque SP_RegistrarMovimiento le resta también las ORDEN).
   El libro real de ese día decía -6.156,22, así que los 9.620,62 no corresponden a
   ningún cobro ni documento: no existen.

   SE IDENTIFICA POR FORMA, NO POR ID: el MovIdMovimiento de producción no es el
   mismo que el de la réplica local. Se busca por cliente + tipo + importe + concepto.

   CANDADOS (si alguno falla no toca NADA y explica por qué):
     · el cliente tiene que existir
     · tiene que haber EXACTAMENTE UN movimiento que cumpla la forma
   Es idempotente: si ya está anulado, la segunda corrida encuentra 0 y avisa.

   Con @SoloVista = 1 (default) NO ESCRIBE NADA: muestra lo que haría.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar

-- ── PARÁMETROS ──────────────────────────────────────────────────────────────
DECLARE @IDCliente    VARCHAR(60)   = 'CR-755';
DECLARE @Ruc          VARCHAR(20)   = '87454323';        -- control cruzado
DECLARE @Importe      DECIMAL(18,4) = 9620.62;
DECLARE @ConceptoLike VARCHAR(200)  = 'el saldo no reflejaba lo real%';

DECLARE @Cli INT, @N INT, @Mov INT, @Cue INT;

SELECT TOP 1 @Cli = c.CliIdCliente
FROM dbo.Clientes c
WHERE RTRIM(c.IDCliente) = @IDCliente AND RTRIM(ISNULL(c.CioRuc,'')) = @Ruc;

IF @Cli IS NULL
BEGIN
    RAISERROR('No hay un cliente con IDCliente %s y RUC/CI %s. Revisar los parámetros.', 16, 1, @IDCliente, @Ruc);
    RETURN;
END

-- ── El movimiento a anular ──────────────────────────────────────────────────
IF OBJECT_ID('tempdb..#objetivo') IS NOT NULL DROP TABLE #objetivo;

SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte, m.MovFecha, m.MovConcepto, m.MovUsuarioAlta
INTO #objetivo
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli
  AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo = 'AJUSTE_POS'
  AND ABS(m.MovImporte - @Importe) < 0.005
  AND m.MovConcepto LIKE @ConceptoLike
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

SELECT @N = COUNT(*) FROM #objetivo;

IF @N = 0
BEGIN
    PRINT 'No hay ningún movimiento vivo que cumpla la forma. O ya se anuló (idempotente) o los parámetros no coinciden con producción. No se tocó nada.';
    RETURN;
END

IF @N > 1
BEGIN
    SELECT 'CANDADO — más de un candidato' AS Aviso, * FROM #objetivo;
    RAISERROR('Se esperaba UN movimiento y hay %d (listados arriba). No se toca nada.', 16, 1, @N);
    RETURN;
END

SELECT TOP 1 @Mov = MovIdMovimiento, @Cue = CueIdCuenta FROM #objetivo;

-- ── ANTES ───────────────────────────────────────────────────────────────────
SELECT Momento = 'ANTES',
       Cliente = RTRIM(cl.Nombre),
       cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
       ColumnaGuardada = cc.CueSaldoActual,
       AjusteAAnular = (SELECT MovImporte FROM #objetivo)
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta = @Cue;

SELECT 'MOVIMIENTO A ANULAR' AS Paso, o.*, Usuario = RTRIM(ISNULL(u.Usuario,'?'))
FROM #objetivo o LEFT JOIN dbo.Usuarios u ON u.IdUsuario = o.MovUsuarioAlta;

-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

        UPDATE m
        SET m.MovAnulado = 1,
            m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
                ' FIX_AJUSTE_MANUAL_2026-09-04: ajuste cargado a mano para tapar el saldo que' +
                ' mostraba la columna CueSaldoActual (contaminada por las ORDEN). No corresponde' +
                ' a ningún cobro ni documento: el libro de esa fecha decía -6156.22.'), 500)
        FROM dbo.MovimientosCuenta m
        WHERE m.MovIdMovimiento = @Mov;

        -- Recalcular el saldo corrido y el guardado, con la misma fórmula del backend
        -- (recomputarSaldoCuenta). El ajuste tenía fecha retroactiva, así que arrastra.
        ;WITH ord AS (
            SELECT m.MovIdMovimiento,
                   run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
            FROM dbo.MovimientosCuenta m
            WHERE m.CueIdCuenta = @Cue
              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
        )
        UPDATE m SET m.MovSaldoPosterior = ord.run
        FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

        UPDATE cc
        SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                        WHERE m.CueIdCuenta = cc.CueIdCuenta
                                          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
        FROM dbo.CuentasCliente cc
        WHERE cc.CueIdCuenta = @Cue;

    COMMIT TRANSACTION;
    PRINT 'Ajuste anulado y saldos recalculados.';
END
ELSE
    PRINT 'SOLO VISTA: no se escribió nada. Revisar los SELECT y volver a correr con @SoloVista = 0.';

-- ── DESPUÉS ─────────────────────────────────────────────────────────────────
-- Esperado (según la réplica local del 4-9-2026):
--   SaldoLibro de la cuenta 222 (US$): 25.302,09  ->  15.681,47
--   La deuda viva de PC-3830 (1.814,50) NO se toca acá: la aplica después
--   fix_aplicar_saldo_afavor_a_deuda.sql, y el saldo queda igual en 15.681,47.
SELECT Momento = 'DESPUES',
       Cliente = RTRIM(cl.Nombre),
       cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
       ColumnaGuardada = cc.CueSaldoActual
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta = @Cue;

DROP TABLE #objetivo;
