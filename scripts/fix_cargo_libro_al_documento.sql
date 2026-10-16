/* ============================================================================
   ALINEA EL CARGO DEL LIBRO MAYOR CON EL TOTAL DEL DOCUMENTO — UN documento.
   Correr en PRODUCCIÓN. Modifica dbo.MovimientosCuenta (MovImporte del cargo),
   MovSaldoPosterior y CuentasCliente.CueSaldoActual. NO toca DeudaDocumento.

   REGLA (definida por el usuario, 04-09-2026): MANDA EL DOCUMENTO.
   Lo que se emitió, se imprimió y se declaró a DGI es la verdad; si el cargo del
   libro dice otra cosa, el libro está desactualizado y hay que corregirlo junto
   con el saldo y todo lo que cuelga de él.

   POR QUÉ PASA — dos caminos, los dos ya corregidos en código (sin deployar):
     1. Ajuste de precio en el cierre de ciclo: el UPDATE a MovimientosCuenta
        joineaba PedidosCobranza.NoDocERP ('8262') contra Ordenes.CodigoOrden
        ('SUB-8262') → 0 filas. Ahora matchea por PedidosCobranzaDetalle.OrdenID.
     2. editarFactura (cfeController): el WHERE terminaba en
        AND NOT (MovObservaciones LIKE 'Cross-moneda:%') y NOT (NULL LIKE 'x%')
        da UNKNOWN → el 88% de los cargos (los que tienen la obs en NULL) nunca
        se actualizaban.

   CASO TESTIGO: ELISA RAMOS (PODIUM2024), FA-386 ACEPTADO_DGI.
     El cierre del 30/07 cargó -462,30 (suma de sus 3 órdenes: 26,80 + 72,70 +
     362,80). La factura salió por 429,23 y eso fue a DGI. La deuda se creó por
     429,23 y se pagó entera el 07/08. En el libro quedaron 33,07 que nunca se
     le facturaron a nadie.
     Después de correrlo: libro -244,77 = deudas vivas 244,77 (cuadra exacto).

   MONEDA: el cargo vive en la cuenta y puede estar en otra moneda que el
   documento. El total se lleva a la moneda de la CUENTA con DocCotizacion, la
   misma fórmula de diag_cargos_desfasados_vs_doctotal.sql.

   CANDADOS (si alguno falla no toca NADA y explica por qué):
     - el documento tiene que existir para ese RUC/CI
     - el cargo tiene que estar en UNA sola cuenta
     - tiene que haber UN solo movimiento de cargo (con cargos partidos no se
       puede repartir el total sin inventar el reparto)
     - monedas distintas exigen DocCotizacion > 0
   Es idempotente: si la diferencia ya es menor a la tolerancia, no hace nada.

   Con @SoloVista = 1 (default) NO ESCRIBE NADA: muestra lo que haría.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;   -- << 1 = solo mirar | 0 = aplicar

-- PARAMETROS: el documento a alinear ----------------------------------------
DECLARE @Serie      VARCHAR(10)   = 'FA';
DECLARE @Numero     VARCHAR(20)   = '386';
DECLARE @Ruc        VARCHAR(20)   = '218978560014';   -- RUC/CI (control cruzado)
DECLARE @Tolerancia DECIMAL(18,4) = 0.02;

DECLARE @Doc INT, @Cli INT, @Cue INT, @Mov INT, @N INT, @NCta INT,
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
    RAISERROR('No se encontro el documento %s-%s para el RUC/CI %s. Revisar los parametros.', 16, 1, @Serie, @Numero, @Ruc);
    RETURN;
END

-- Los movimientos de cargo del documento ------------------------------------
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
    RAISERROR('El documento no tiene ningun cargo vivo en el libro mayor. Eso es OTRO problema (documento sin asiento) y no se resuelve aca.', 16, 1);
    RETURN;
END

IF @N > 1 OR @NCta > 1
BEGIN
    SELECT 'CANDADO - cargo partido' AS Aviso, * FROM #cargos;
    RAISERROR('El cargo esta partido en %d movimiento(s) sobre %d cuenta(s) (listados arriba). Repartir el total sin inventar el reparto no es posible: se resuelve a mano.', 16, 1, @N, @NCta);
    RETURN;
END

SELECT TOP 1 @Mov = MovIdMovimiento, @Cue = CueIdCuenta, @CargoViejo = ABS(MovImporte) FROM #cargos;

-- El total del documento llevado a la moneda de la CUENTA --------------------
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
    RAISERROR('El documento y la cuenta estan en monedas distintas y el documento no tiene DocCotizacion: no se puede convertir. No se toca nada.', 16, 1);
    RETURN;
END

IF ABS(@Esperado - @CargoViejo) <= @Tolerancia
BEGIN
    PRINT CONCAT('El cargo ya coincide con el documento (cargo ', CONVERT(varchar(20), CAST(@CargoViejo AS decimal(18,2))),
                 ' contra ', CONVERT(varchar(20), CAST(@Esperado AS decimal(18,2))), '). No se toco nada.');
    RETURN;
END

-- ANTES ---------------------------------------------------------------------
SELECT Momento = 'ANTES',
       Documento = RTRIM(d.DocSerie) + '-' + CAST(d.DocNumero AS VARCHAR),
       Cliente = RTRIM(cl.Nombre), d.CfeEstado,
       MonedaDoc = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       DocTotal = CAST(d.DocTotal AS DECIMAL(18,2)),
       SumaLineas = CAST((SELECT SUM(dd.DcdTotal) FROM dbo.DocumentosContablesDetalle dd
                          WHERE dd.DocIdDocumento = d.DocIdDocumento) AS DECIMAL(18,2)),
       CueIdCuenta = @Cue,
       MonedaCuenta = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       CargoLibro = CAST(@CargoViejo AS DECIMAL(18,2)),
       Esperado = CAST(@Esperado AS DECIMAL(18,2)),
       Diferencia = CAST(@Esperado - @CargoViejo AS DECIMAL(18,2)),
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                        WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                          AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       DeudasVivas = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                        WHERE dd.CueIdCuenta = @Cue
                          AND dd.DDeEstado NOT IN ('CANCELADA','PAGADO','COBRADO')), 0) AS DECIMAL(18,2))
FROM dbo.DocumentosContables d
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = @Cue
WHERE d.DocIdDocumento = @Doc;

SELECT 'MOVIMIENTO A CORREGIR' AS Paso, * FROM #cargos;

-- EL ARREGLO ----------------------------------------------------------------
IF @SoloVista = 0
BEGIN
    BEGIN TRANSACTION;

        UPDATE m
        SET m.MovImporte = -@Esperado,
            m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
                ' FIX_CARGO_AL_DOCUMENTO_2026-09-04: el cargo decia ' +
                CONVERT(varchar(20), CAST(@CargoViejo AS decimal(18,2))) +
                ' y el documento (lo que se emitio y fue a DGI) dice ' +
                CONVERT(varchar(20), CAST(@Esperado AS decimal(18,2))) +
                '. Manda el documento.'), 500)
        FROM dbo.MovimientosCuenta m
        WHERE m.MovIdMovimiento = @Mov;

        -- Recalcular el saldo corrido y el guardado, con la misma formula del
        -- backend (recomputarSaldoCuenta). Esto es "todo lo que le cuelga".
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
    PRINT 'Cargo alineado al documento y saldos recalculados.';
END
ELSE
    PRINT 'SOLO VISTA: no se escribio nada. Revisar los SELECT y volver a correr con @SoloVista = 0.';

-- DESPUES: lo que importa es que el libro y las deudas digan lo mismo --------
-- Regla: deuda viva = MAX(0, -saldo del libro). Cuadre = 0.
SELECT Momento = CASE WHEN @SoloVista = 1 THEN 'SIN CAMBIOS (vista previa)' ELSE 'DESPUES' END,
       Cliente = RTRIM(cl.Nombre),
       cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudasVivas = CAST(dv.Viva AS DECIMAL(18,2)),
       Cuadre = CAST(dv.Viva - CASE WHEN s.Saldo < 0 THEN -s.Saldo ELSE 0 END AS DECIMAL(18,2)),
       ColumnaGuardada = CAST(cc.CueSaldoActual AS DECIMAL(18,2))
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
