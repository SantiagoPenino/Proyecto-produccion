/* ============================================================================
   fix_cheques_duplicados.sql
   ----------------------------------------------------------------------------
   Da de baja los cheques cargados dos veces en cartera.

   EL PROBLEMA
   Nada impedía cargar el mismo cheque N veces: no hay UNIQUE sobre
   (NumeroCheque, IdBanco) ni validación en `recibirCheque`. Y cada alta genera su
   propio asiento:

       Debe  1.1.5  Valores a Depositar (Cheques)
       Haber 1.2.1  Deudores por Ventas (Clientes)   ← le baja la deuda al cliente

   Un cheque repetido infla la cartera y le cancela al cliente una deuda que no pagó.

   El código ya no los deja entrar (aviso al recibir + confirmación explícita), así que
   esto es una sola pasada sobre lo que ya está cargado.

   ⚠️ ESTE SCRIPT **NO REVIERTE EL ASIENTO** del cheque que da de baja — así se pidió,
   para desbloquear la pantalla ya. Consecuencia a tener presente: el asiento duplicado
   queda vivo, así que 1.1.5 sigue inflado y la deuda del cliente sigue cancelada de más
   por el importe del cheque fantasma. La sección 3 deja lista la reversa para cuando
   la quieras correr. De acá en adelante, anular un cheque desde la pantalla SÍ revierte
   el asiento solo (endpoint DELETE /tesoreria/cheques/:id).

   CRITERIO: se conserva el cheque de MENOR IdCheque (el que se cargó primero); los
   demás con mismo (NumeroCheque, IdBanco, Tipo, Monto) pasan a ANULADO.
   Nunca se toca uno vinculado a un cobro (Pagos.PagIdCheque) — ese hay que resolverlo
   anulando el cobro, no el cheque.
   ============================================================================ */

SET NOCOUNT ON;
GO

-- ── 1. PREVIEW — correr esto primero ────────────────────────────────────────

-- Cheques que están vinculados a un cobro; esos NO se tocan.
-- El vínculo vive en Pagos.PagIdCheque, que es una columna NUEVA (add_PagIdCheque.sql).
-- Si todavía no se migró, la columna no existe y no hay ningún vínculo posible: la tabla
-- queda vacía y el script funciona igual. Va por EXEC porque SQL Server no compila una
-- consulta contra una columna inexistente, aunque esté dentro de un IF.
IF OBJECT_ID('tempdb..#conCobro') IS NOT NULL DROP TABLE #conCobro;
CREATE TABLE #conCobro (IdCheque INT PRIMARY KEY);

IF COL_LENGTH('dbo.Pagos', 'PagIdCheque') IS NOT NULL
BEGIN
    EXEC('INSERT INTO #conCobro (IdCheque)
          SELECT DISTINCT PagIdCheque FROM dbo.Pagos WHERE PagIdCheque IS NOT NULL');
    PRINT '[INFO] Pagos.PagIdCheque existe: se respetan los cheques vinculados a un cobro.';
END
ELSE
    PRINT '[INFO] Pagos.PagIdCheque todavía no existe en esta base (falta add_PagIdCheque.sql): '
        + 'ningún cheque puede estar vinculado a un cobro, no hay nada que proteger.';
GO

IF OBJECT_ID('tempdb..#dupch') IS NOT NULL DROP TABLE #dupch;

SELECT
    ch.IdCheque, ch.NumeroCheque, ch.IdBanco, b.NombreBanco, ch.Tipo, ch.Monto, ch.Estado,
    Emision = CONVERT(varchar(10), ch.FechaEmision, 23),
    Vto     = CONVERT(varchar(10), ch.FechaVencimiento, 23),
    TieneCobro = CASE WHEN EXISTS (SELECT 1 FROM #conCobro c WHERE c.IdCheque = ch.IdCheque) THEN 1 ELSE 0 END,
    rn = ROW_NUMBER() OVER (
           PARTITION BY ch.NumeroCheque, ch.IdBanco, ch.Tipo, ch.Monto
           ORDER BY ch.IdCheque)          -- el primero que se cargó es el que queda
INTO #dupch
FROM dbo.TesoreriaCheques ch
LEFT JOIN dbo.TesoreriaBancos b ON b.IdBanco = ch.IdBanco
WHERE ch.Estado <> 'ANULADO'
  AND EXISTS (
      SELECT 1 FROM dbo.TesoreriaCheques d
      WHERE d.NumeroCheque = ch.NumeroCheque AND d.IdBanco = ch.IdBanco
        AND d.Tipo = ch.Tipo AND d.Monto = ch.Monto AND d.Estado <> 'ANULADO'
      GROUP BY d.NumeroCheque, d.IdBanco, d.Tipo, d.Monto
      HAVING COUNT(*) > 1
  );

SELECT
    NumeroCheque, NombreBanco, Monto, Estado, Emision, Vto, IdCheque, TieneCobro,
    Accion = CASE WHEN rn = 1 THEN 'CONSERVA'
                  WHEN TieneCobro > 0 THEN '>>> NO SE TOCA (vinculado a un cobro)'
                  ELSE '>>> ANULAR' END
FROM #dupch
ORDER BY NumeroCheque, rn;

SELECT ACancelar = COUNT(*), ImporteFantasma = SUM(Monto)
FROM #dupch WHERE rn > 1 AND TieneCobro = 0;
GO

-- ── 2. LA BAJA — descomentar tras revisar el preview ─────────────────────────
/*
BEGIN TRANSACTION;

UPDATE ch
SET ch.Estado = 'ANULADO',
    ch.Notas  = LEFT(ISNULL(ch.Notas + ' | ', '')
                + 'ANULADO por duplicado (fix_cheques_duplicados.sql): ya está cargado como cheque #'
                + CAST(k.IdCheque AS VARCHAR(20)), 500)
FROM dbo.TesoreriaCheques ch
JOIN #dupch x ON x.IdCheque = ch.IdCheque AND x.rn > 1 AND x.TieneCobro = 0
JOIN #dupch k ON k.NumeroCheque = x.NumeroCheque AND k.IdBanco = x.IdBanco
             AND k.Tipo = x.Tipo AND k.Monto = x.Monto AND k.rn = 1;

PRINT '[OK] Cheques duplicados anulados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- Verificar que no queda ningún cheque repetido vivo:
SELECT NumeroCheque, IdBanco, Monto, COUNT(*) AS Veces
FROM dbo.TesoreriaCheques WHERE Estado <> 'ANULADO'
GROUP BY NumeroCheque, IdBanco, Tipo, Monto HAVING COUNT(*) > 1;

--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
GO

-- ── 3. LA REVERSA CONTABLE (opcional, NO pedida) ────────────────────────────
-- Mientras esto no se corra, la contabilidad queda con el asiento del cheque fantasma:
-- 1.1.5 inflado y deuda del cliente cancelada de más. Esto lista los asientos que
-- habría que revertir. Conviene hacerlo desde la app (anular el cheque revierte solo),
-- o pedir el script de reversa cuando lo quieras.
SELECT
    a.AsiId, CONVERT(varchar(19), a.AsiFecha, 120) AS Fecha, LEFT(a.AsiConcepto, 60) AS Concepto,
    pc.CueCodigo, pc.CueNombre, d.DetDebeUYU AS Debe, d.DetHaberUYU AS Haber
FROM #dupch x
JOIN dbo.Cont_AsientosCabecera a
  ON a.SysOrigen = 'TESORERIA' AND a.AsiConcepto LIKE '%#' + x.NumeroCheque + '%'
JOIN dbo.Cont_AsientosDetalle d ON d.AsiId = a.AsiId
LEFT JOIN dbo.Cont_PlanCuentas pc ON pc.CueId = d.CueId
WHERE x.rn > 1 AND x.TieneCobro = 0
ORDER BY a.AsiId, pc.CueCodigo;
GO

DROP TABLE #dupch;
DROP TABLE #conCobro;
GO
