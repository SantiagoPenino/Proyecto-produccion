/* ============================================================================
   elea (IDCliente 'ELEA', CodCliente 126101) - DOS PREGUNTAS SUELTAS
   SOLO LECTURA. No escribe nada.

   Salieron del diagnostico del 09-09-2026 contra produccion:

   1) La orden SUB-18170 ($ 362,25) ya no aparece entre las pendientes, pero el
      ciclo 210 sigue contandola: su CicTotalOrdenes dice 2.540,25 y las ordenes
      reales del ciclo son 2.178,00. La diferencia es exactamente 362,25. Hay que
      ver donde quedo ese movimiento: si se facturo, en que documento; si esta
      anulado; o si cambio de ciclo.

   2) El saldo guardado de la cuenta de dolares dice +17.473,93 y el libro dice
      -3.419,83. Son casi 21.000 dolares de diferencia. Esa columna
      (CueSaldoActual) es la que lee el motor de cruce automatico que todavia
      esta desplegado, y un positivo grande ahi es plata que el motor puede
      gastar. Este bloque muestra de que esta hecho el numero.

   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   ============================================================================ */

SET NOCOUNT ON;

SELECT Servidor = @@SERVERNAME, Base = DB_NAME();

DECLARE @Cli INT;
SELECT @Cli = MIN(c.CliIdCliente)
FROM dbo.Clientes c
WHERE RTRIM(ISNULL(c.IDCliente,'')) = 'ELEA'
  AND RTRIM(ISNULL(CAST(c.CodCliente AS varchar(30)),'')) = '126101';

IF @Cli IS NULL BEGIN RAISERROR('No se encontro el cliente.',16,1); RETURN; END

/* -- A . Donde quedo la orden SUB-18170 ----------------------------------- */
SELECT Bloque = 'A - SUB-18170',
       m.MovIdMovimiento, m.CueIdCuenta, cc.CueTipo, m.MovTipo,
       Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       Fecha   = CONVERT(varchar(16), m.MovFecha, 120),
       m.CicIdCiclo, m.DocIdDocumento,
       Doc = RTRIM(ISNULL(d.DocSerie,'')) + '-' + RTRIM(ISNULL(d.DocNumero,'')),
       DocTotal = CAST(d.DocTotal AS DECIMAL(18,2)),
       MonedaDoc = d.MonIdMoneda,
       m.MovAnulado,
       Concepto = RTRIM(ISNULL(m.MovConcepto,'')),
       Obs      = LEFT(RTRIM(ISNULL(m.MovObservaciones,'')), 200)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE cc.CliIdCliente = @Cli AND m.MovConcepto LIKE '%SUB-18170%'
ORDER BY m.MovIdMovimiento;

/* -- B . El ciclo 210, movimiento por movimiento --------------------------
        Para ver que esta contando de mas.                                    */
SELECT Bloque = 'B - CICLO 210',
       m.MovIdMovimiento, m.CueIdCuenta, cc.CueTipo, m.MovTipo,
       Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       Fecha   = CONVERT(varchar(16), m.MovFecha, 120),
       m.DocIdDocumento, m.MovAnulado,
       Concepto = LEFT(RTRIM(ISNULL(m.MovConcepto,'')), 70)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND m.CicIdCiclo = 210
ORDER BY m.MovFecha, m.MovIdMovimiento;

/* -- C . De que esta hecho el saldo guardado ------------------------------
        Guardado tendria que ser igual a "LibroConOrden": esa es la formula de
        recomputarSaldoCuenta (contabilidadController ~1574), que suma TODOS los
        movimientos vivos. "LibroSinOrden" es lo que muestra la pantalla.
        Si Guardado no coincide con ninguno de los dos, la columna esta podrida. */
SELECT Bloque = 'C - SALDO GUARDADO',
       cc.CueIdCuenta, cc.CueTipo,
       Guardado      = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       LibroSinOrden = CAST(sinOrd.S AS DECIMAL(18,2)),
       LibroConOrden = CAST(conOrd.S AS DECIMAL(18,2)),
       SoloOrdenes   = CAST(conOrd.S - sinOrd.S AS DECIMAL(18,2)),
       DesvioVsFormula = CAST(cc.CueSaldoActual - conOrd.S AS DECIMAL(18,2)),
       Veredicto = CASE
            WHEN ABS(cc.CueSaldoActual - conOrd.S) <= 0.02 THEN 'OK - es la formula del backend'
            WHEN ABS(cc.CueSaldoActual - sinOrd.S) <= 0.02 THEN 'OK - es el saldo que muestra la pantalla'
            ELSE '>>> NO ES NI UNO NI EL OTRO: la columna esta podrida <<<' END,
       PuedeSerOrigenDeCruce = CASE WHEN cc.CueSaldoActual > 0.01 AND sinOrd.S <= 0.01
                                    THEN '>>> SI, Y NO DEBERIA: el motor le puede sacar plata que no tiene <<<'
                                    ELSE '' END
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT S = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) sinOrd
CROSS APPLY (SELECT S = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)) conOrd
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

/* -- D . Lo mismo para TODOS los clientes: cuantas cuentas tienen un positivo
        guardado que el libro no respalda. Es el combustible del cruce.
        Ordenado por el tamano del positivo falso.                            */
SELECT TOP 40 Bloque = 'D - BARRIDO: positivos falsos en todo el sistema',
       cc.CueIdCuenta, cc.CliIdCliente, Cliente = RTRIM(cl.Nombre), cc.CueTipo,
       Guardado      = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       LibroSinOrden = CAST(sinOrd.S AS DECIMAL(18,2)),
       PositivoFalso = CAST(cc.CueSaldoActual - sinOrd.S AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT S = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) sinOrd
WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1 AND cc.CueEsPrincipal = 1
  AND cc.CueSaldoActual > 0.01          -- el motor solo mira los positivos
  AND sinOrd.S <= 0.01                  -- y el libro dice que no tiene nada
ORDER BY cc.CueSaldoActual DESC;

/* -- E . El total del barrido D ------------------------------------------- */
SELECT Bloque = 'E - TOTAL DEL BARRIDO',
       Cuentas = COUNT(*),
       PlataFalsaDisponibleParaElCruce = CAST(SUM(cc.CueSaldoActual) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT S = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) sinOrd
WHERE cc.CueTipo LIKE 'DINERO%' AND cc.CueActiva = 1 AND cc.CueEsPrincipal = 1
  AND cc.CueSaldoActual > 0.01 AND sinOrd.S <= 0.01;
