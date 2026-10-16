/* ============================================================================
   PRODUCCIÓN — ELISA RAMOS (PODIUM2024, RUC 218978560014)
   Alinea el cargo del libro mayor del FA-386 con el documento que fue a DGI.

   QUÉ PASÓ: el cierre de ciclo del 30/07 asentó -462,30 (la suma de las 3 órdenes
   del ciclo: 26,80 + 72,70 + 362,80), pero la factura se emitió por 429,23 y ESO
   es lo que fue a DGI (ACEPTADO_DGI, y sus líneas suman 429,23). La deuda nació
   por 429,23 y se pagó entera el 07/08. En el libro quedaron 33,07 que nunca se
   le facturaron a nadie.

   REGLA: manda el documento. Se corrige el cargo y con él el saldo corrido y el
   saldo guardado de la cuenta.

   RESULTADO ESPERADO (medido en la réplica local):
       cargo   -462,30  ->  -429,23
       libro   -277,84  ->  -244,77   = sus deudas vivas (244,77)  ->  Cuadre 0

   NO TOCA: DeudaDocumento (ya está en 429,23 y cobrada), ni la cuenta en pesos
   (ya cuadra: -70,91 contra 70,91).

   NO ARREGLA la nota de crédito NC-000019: ese es un bug de PANTALLA (la fila del
   documento se armaba como cargo en vez de abono) y se corrige con el DEPLOY del
   código, no con datos.

   Todo se resuelve por RUC + serie + número: no hay ningún ID de la réplica local.
   Es idempotente: si el cargo ya está en 429,23 avisa y no toca nada.
   ABRIR DESDE EL DISCO en SSMS (File -> Open) y correr TODO.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* ── 0 · DÓNDE ESTOY ─────────────────────────────────────────────────────── */
SELECT Servidor = @@SERVERNAME,
       Base     = DB_NAME(),
       Archivo  = (SELECT TOP 1 physical_name FROM sys.database_files WHERE type = 0);

/* ── 1 · Resolver cliente, documento, cuenta y movimiento ─────────────────── */
DECLARE @Ruc    VARCHAR(20) = '218978560014';
DECLARE @Serie  VARCHAR(10) = 'FA';
DECLARE @Numero VARCHAR(20) = '386';

DECLARE @Cli INT, @Doc INT, @Cue INT, @Mov INT, @N INT, @NCta INT,
        @CargoViejo DECIMAL(18,4), @Esperado DECIMAL(18,4);

SELECT TOP 1 @Doc = d.DocIdDocumento, @Cli = d.CliIdCliente
FROM dbo.DocumentosContables d
JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
WHERE RTRIM(d.DocSerie) = @Serie
  AND RTRIM(d.DocNumero) = @Numero
  AND RTRIM(ISNULL(c.CioRuc, '')) = @Ruc
ORDER BY d.DocIdDocumento DESC;

IF @Doc IS NULL
BEGIN
    RAISERROR('No se encontró %s-%s para el RUC %s en esta base. No se tocó nada.', 16, 1, @Serie, @Numero, @Ruc);
    RETURN;
END

IF OBJECT_ID('tempdb..#cargos') IS NOT NULL DROP TABLE #cargos;
SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte, m.MovFecha, m.MovConcepto
INTO #cargos
FROM dbo.MovimientosCuenta m
WHERE m.DocIdDocumento = @Doc
  AND m.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO')
  AND m.MovImporte < 0
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

SELECT @N = COUNT(*), @NCta = COUNT(DISTINCT CueIdCuenta) FROM #cargos;

IF @N = 0
BEGIN
    RAISERROR('El documento no tiene cargo vivo en el libro mayor. Eso es otro problema (documento sin asiento). No se tocó nada.', 16, 1);
    RETURN;
END

IF @N > 1 OR @NCta > 1
BEGIN
    SELECT 'FRENO - cargo partido' AS Aviso, * FROM #cargos;
    RAISERROR('El cargo está partido en %d movimiento(s) sobre %d cuenta(s). Se resuelve a mano. No se tocó nada.', 16, 1, @N, @NCta);
    RETURN;
END

SELECT TOP 1 @Mov = MovIdMovimiento, @Cue = CueIdCuenta, @CargoViejo = ABS(MovImporte) FROM #cargos;

/* Total del documento llevado a la moneda de la CUENTA donde vive el cargo */
SELECT @Esperado = CASE
        WHEN d.MonIdMoneda = cc.MonIdMoneda THEN d.DocTotal
        WHEN d.MonIdMoneda = 1 AND cc.MonIdMoneda = 2 AND ISNULL(d.DocCotizacion, 0) > 0 THEN d.DocTotal / d.DocCotizacion
        WHEN d.MonIdMoneda = 2 AND cc.MonIdMoneda = 1 AND ISNULL(d.DocCotizacion, 0) > 0 THEN d.DocTotal * d.DocCotizacion
        ELSE NULL END
FROM dbo.DocumentosContables d
CROSS JOIN dbo.CuentasCliente cc
WHERE d.DocIdDocumento = @Doc AND cc.CueIdCuenta = @Cue;

IF @Esperado IS NULL
BEGIN
    RAISERROR('Documento y cuenta en monedas distintas y sin DocCotizacion: no se puede convertir. No se tocó nada.', 16, 1);
    RETURN;
END

IF ABS(@Esperado - @CargoViejo) <= 0.02
BEGIN
    PRINT CONCAT('El cargo ya coincide con el documento (', CONVERT(varchar(20), CAST(@CargoViejo AS decimal(18,2))),
                 ' contra ', CONVERT(varchar(20), CAST(@Esperado AS decimal(18,2))), '). No se tocó nada.');
    RETURN;
END

/* ── 2 · ANTES ───────────────────────────────────────────────────────────── */
SELECT Momento     = 'ANTES',
       Documento   = RTRIM(d.DocSerie) + '-' + CAST(d.DocNumero AS VARCHAR),
       Cliente     = RTRIM(cl.Nombre),
       d.CfeEstado,
       DocTotal    = CAST(d.DocTotal AS DECIMAL(18,2)),
       SumaLineas  = CAST((SELECT SUM(dd.DcdTotal) FROM dbo.DocumentosContablesDetalle dd
                           WHERE dd.DocIdDocumento = d.DocIdDocumento) AS DECIMAL(18,2)),
       CueIdCuenta = @Cue,
       CargoLibro  = CAST(@CargoViejo AS DECIMAL(18,2)),
       Esperado    = CAST(@Esperado AS DECIMAL(18,2)),
       Diferencia  = CAST(@Esperado - @CargoViejo AS DECIMAL(18,2)),
       SaldoLibro  = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                        WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                          AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.DocumentosContables d
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
WHERE d.DocIdDocumento = @Doc;

SELECT 'MOVIMIENTO A CORREGIR' AS Paso, * FROM #cargos;

/* ── 3 · APLICAR ─────────────────────────────────────────────────────────── */
BEGIN TRANSACTION;

    UPDATE m
    SET m.MovImporte = -@Esperado,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_CARGO_AL_DOCUMENTO_2026-09-04: el cargo decía ' +
            CONVERT(varchar(20), CAST(@CargoViejo AS decimal(18,2))) +
            ' y el documento (lo que se emitió y fue a DGI) dice ' +
            CONVERT(varchar(20), CAST(@Esperado AS decimal(18,2))) +
            '. Manda el documento.'), 500)
    FROM dbo.MovimientosCuenta m
    WHERE m.MovIdMovimiento = @Mov;

    PRINT CONCAT('Cargos corregidos: ', @@ROWCOUNT);

    /* Saldo corrido y saldo guardado de la cuenta, con la misma fórmula del backend */
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta = @Cue;

COMMIT TRANSACTION;

/* ── 4 · DESPUÉS: Cuadre tiene que dar 0 en las dos monedas ──────────────── */
SELECT Momento     = 'DESPUES',
       Cliente     = RTRIM(cl.Nombre),
       cc.CueIdCuenta,
       Moneda      = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro  = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudasVivas = CAST(dv.Viva AS DECIMAL(18,2)),
       Cuadre      = CAST(dv.Viva - CASE WHEN s.Saldo < 0 THEN -s.Saldo ELSE 0 END AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                WHERE dd.CueIdCuenta = cc.CueIdCuenta
                  AND dd.DDeEstado NOT IN ('CANCELADA','PAGADO','COBRADO')), 0)) dv
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

DROP TABLE #cargos;
