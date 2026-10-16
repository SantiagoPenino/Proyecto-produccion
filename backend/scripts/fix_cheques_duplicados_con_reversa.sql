/* ============================================================================
   fix_cheques_duplicados_con_reversa.sql
   ----------------------------------------------------------------------------
   Da de baja los cheques cargados dos veces Y REVIERTE su asiento contable, en
   una sola pasada. Deja la cartera y la contabilidad cuadradas.

   Es la versión "limpia" de fix_cheques_duplicados.sql: aquel solo marcaba
   ANULADO y dejaba el asiento fantasma vivo. Este además lo neutraliza.

   EL PROBLEMA
   Nada impedía cargar el mismo cheque N veces (no hay UNIQUE, ni validación en
   recibirCheque). Cada alta genera su propio asiento:
       Debe  1.1.5  Valores a Depositar
       Haber 1.2.1  Deudores por Ventas
   Un cheque repetido infla 1.1.5 y sobre-acredita Deudores por su importe.

   QUÉ HACE, por cada grupo de duplicados (mismo Nº+banco+tipo+monto, no anulado):
     · conserva el de MENOR IdCheque (el primero cargado);
     · marca ANULADO cada duplicado extra (no se borra: el papel existió);
     · por cada duplicado anulado, revierte UN asiento de ese cheque (el más
       reciente sin revertir) generando su contrapartida (debe/haber invertidos).
       El asiento original NO se toca: la contabilidad se corrige con un asiento
       que la neutraliza, no borrando.

   NO TOCA un cheque vinculado a un cobro (Pagos.PagIdCheque): ese se resuelve
   anulando el cobro. (La columna es nueva; si no está migrada, no hay vínculo
   posible y no hay nada que proteger.)

   Los asientos duplicados y su cheque comparten el número en el concepto pero no
   hay FK entre ellos; como las cargas del mismo cheque generan asientos idénticos,
   revertir cualquiera de ellos da el mismo neto. Se revierte el más reciente y se
   conserva el más viejo (queda emparejado con el cheque que se conserva).
   ============================================================================ */

SET NOCOUNT ON;
GO

-- ── 0. Armar el set de trabajo ──────────────────────────────────────────────
IF OBJECT_ID('tempdb..#conCobro') IS NOT NULL DROP TABLE #conCobro;
CREATE TABLE #conCobro (IdCheque INT PRIMARY KEY);
IF COL_LENGTH('dbo.Pagos','PagIdCheque') IS NOT NULL
    EXEC('INSERT INTO #conCobro SELECT DISTINCT PagIdCheque FROM dbo.Pagos WHERE PagIdCheque IS NOT NULL');

IF OBJECT_ID('tempdb..#dupch') IS NOT NULL DROP TABLE #dupch;
SELECT
    ch.IdCheque, ch.NumeroCheque, ch.IdBanco, ch.Tipo, ch.Monto, ch.Estado,
    TieneCobro = CASE WHEN EXISTS (SELECT 1 FROM #conCobro c WHERE c.IdCheque = ch.IdCheque) THEN 1 ELSE 0 END,
    rn = ROW_NUMBER() OVER (PARTITION BY ch.NumeroCheque, ch.IdBanco, ch.Tipo, ch.Monto ORDER BY ch.IdCheque)
INTO #dupch
FROM dbo.TesoreriaCheques ch
WHERE ch.Estado <> 'ANULADO'
  AND EXISTS (
      SELECT 1 FROM dbo.TesoreriaCheques d
      WHERE d.NumeroCheque = ch.NumeroCheque AND d.IdBanco = ch.IdBanco
        AND d.Tipo = ch.Tipo AND d.Monto = ch.Monto AND d.Estado <> 'ANULADO'
      GROUP BY d.NumeroCheque, d.IdBanco, d.Tipo, d.Monto HAVING COUNT(*) > 1
  );
GO

-- ── 1. PREVIEW ──────────────────────────────────────────────────────────────
SELECT
    x.NumeroCheque, x.Monto, x.IdCheque, x.TieneCobro,
    Accion = CASE WHEN x.rn = 1 THEN 'CONSERVA'
                  WHEN x.TieneCobro > 0 THEN 'NO SE TOCA (vinculado a un cobro)'
                  ELSE '>>> ANULAR + revertir asiento' END
FROM #dupch x ORDER BY x.NumeroCheque, x.rn;

-- Impacto contable que se va a revertir
SELECT
    a.AsiId, x.NumeroCheque, pc.CueCodigo, pc.CueNombre, d.DetDebeUYU AS Debe, d.DetHaberUYU AS Haber
FROM #dupch x
CROSS APPLY (
    SELECT TOP 1 a.AsiId
    FROM dbo.Cont_AsientosCabecera a
    WHERE a.SysOrigen = 'TESORERIA' AND a.AsiConcepto LIKE '%#' + x.NumeroCheque + '%'
      AND a.AsiConcepto NOT LIKE '%ANULACI%'
    ORDER BY a.AsiId DESC
) a
JOIN dbo.Cont_AsientosDetalle d ON d.AsiId = a.AsiId
LEFT JOIN dbo.Cont_PlanCuentas pc ON pc.CueId = d.CueId
WHERE x.rn > 1 AND x.TieneCobro = 0
ORDER BY x.NumeroCheque, a.AsiId, pc.CueCodigo;
GO

-- ── 2. EL FIX — descomentar tras revisar el preview ─────────────────────────
/*
BEGIN TRANSACTION;

-- 2a. Reservar UN asiento por cada duplicado a anular (el más reciente sin revertir).
--     Se elige por número; si un grupo tuviera 3 cargas, se reservan las 2 más nuevas.
IF OBJECT_ID('tempdb..#aRevertir') IS NOT NULL DROP TABLE #aRevertir;
SELECT AsiId INTO #aRevertir FROM (
    SELECT a.AsiId,
           ROW_NUMBER() OVER (PARTITION BY x.NumeroCheque, x.IdBanco, x.Monto ORDER BY a.AsiId DESC) AS rnAsi,
           ExtraAAnular = (SELECT COUNT(*) FROM #dupch y
                           WHERE y.NumeroCheque = x.NumeroCheque AND y.IdBanco = x.IdBanco
                             AND y.Monto = x.Monto AND y.rn > 1 AND y.TieneCobro = 0)
    FROM #dupch x
    JOIN dbo.Cont_AsientosCabecera a
      ON a.SysOrigen = 'TESORERIA' AND a.AsiConcepto LIKE '%#' + x.NumeroCheque + '%'
         AND a.AsiConcepto NOT LIKE '%ANULACI%'
    WHERE x.rn = 1   -- una vez por grupo
) t
WHERE t.rnAsi <= t.ExtraAAnular;   -- tantos asientos como duplicados se anulan

-- 2b. Anular los cheques duplicados
UPDATE ch
SET ch.Estado = 'ANULADO',
    ch.Notas  = LEFT(ISNULL(ch.Notas + ' | ', '')
                + 'ANULADO por duplicado (fix_cheques_duplicados_con_reversa.sql): ya está cargado como cheque #'
                + CAST(k.IdCheque AS VARCHAR(20)), 500)
FROM dbo.TesoreriaCheques ch
JOIN #dupch x ON x.IdCheque = ch.IdCheque AND x.rn > 1 AND x.TieneCobro = 0
JOIN #dupch k ON k.NumeroCheque = x.NumeroCheque AND k.IdBanco = x.IdBanco
             AND k.Tipo = x.Tipo AND k.Monto = x.Monto AND k.rn = 1;
PRINT '[OK] Cheques anulados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- 2c. Generar la reversa de cada asiento reservado (debe/haber invertidos)
DECLARE @AsiId INT, @Concepto NVARCHAR(200), @NuevoAsi INT;
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT r.AsiId, a.AsiConcepto FROM #aRevertir r
    JOIN dbo.Cont_AsientosCabecera a ON a.AsiId = r.AsiId;
OPEN cur;
FETCH NEXT FROM cur INTO @AsiId, @Concepto;
WHILE @@FETCH_STATUS = 0
BEGIN
    INSERT INTO dbo.Cont_AsientosCabecera (AsiFecha, AsiConcepto, AsiEstado, UsuarioId, TcaIdTransaccion, SysOrigen)
    VALUES (GETDATE(),
            LEFT('ANULACION duplicado (reversa asiento ' + CAST(@AsiId AS VARCHAR(20)) + '): ' + @Concepto, 200),
            'REGISTRADO', 1, NULL, 'TESORERIA');
    SET @NuevoAsi = SCOPE_IDENTITY();

    INSERT INTO dbo.Cont_AsientosDetalle
        (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
    SELECT @NuevoAsi, d.CueId,
           d.DetHaberUYU,          -- debe  <- haber
           d.DetDebeUYU,           -- haber <- debe
           d.DetImporteOriginal, d.DetCotizacion, d.DetMonedaId, d.DetEntidadId, d.DetEntidadTipo
    FROM dbo.Cont_AsientosDetalle d WHERE d.AsiId = @AsiId;

    FETCH NEXT FROM cur INTO @AsiId, @Concepto;
END
CLOSE cur; DEALLOCATE cur;
PRINT '[OK] Asientos revertidos.';

-- 2d. Verificación: no debe quedar ningún duplicado vivo.
SELECT NumeroCheque, IdBanco, Monto, Veces = COUNT(*)
FROM dbo.TesoreriaCheques WHERE Estado <> 'ANULADO'
GROUP BY NumeroCheque, IdBanco, Tipo, Monto HAVING COUNT(*) > 1;

--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
GO

DROP TABLE #dupch;
DROP TABLE #conCobro;
GO
