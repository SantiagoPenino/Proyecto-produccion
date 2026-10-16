-- =====================================================================================
-- PROD_migrar_cheques_asiento_alta.sql  (14-oct-2026)
--
-- 1. Agrega TesoreriaCheques.AsiIdAlta (INT NULL): el asiento que generó el alta del cheque
--    (recibirCheque / emitirCheque). anularCheque va a revertir ESE asiento y no buscarlo
--    por LIKE sobre el número.
-- 2. Lo completa para los cheques ya cargados, con el mismo emparejamiento que muestra
--    PROD_verificar_cheques_asiento_alta.sql (correrlo antes y ver todo en OK).
--
-- Valida TODO antes de abrir la transacción: si un par no cierra (cheque o asiento que no
-- existe, concepto o importe distinto, asiento repetido, cheque que ya tiene otro asiento),
-- no toca nada y lo muestra. Después de escribir se autochequea y commitea o revierte solo.
-- Idempotente: solo completa cheques con AsiIdAlta en NULL; una segunda corrida no cambia nada.
--
-- ⚠️ ORDEN: esto va ANTES del deploy del código que escribe AsiIdAlta. Si el código sale
-- sin la columna, falla la carga de cheques en Tesorería.
-- =====================================================================================
SET NOCOUNT ON;

-- ── 1. Columna ─────────────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.TesoreriaCheques', 'AsiIdAlta') IS NULL
BEGIN
    ALTER TABLE dbo.TesoreriaCheques ADD AsiIdAlta INT NULL;
    PRINT '[OK] Columna AsiIdAlta creada.';
END
ELSE PRINT '[SKIP] La columna AsiIdAlta ya existe.';
GO

-- ── 2. Completar los cheques ya cargados ───────────────────────────────────────────
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Fijos TABLE (IdCheque INT PRIMARY KEY, AsiId INT NOT NULL);
INSERT @Fijos VALUES (2, 14363), (3, 14364), (5, 15287), (6, 15744);   -- ver el script de verificación

IF OBJECT_ID('tempdb..#Pares') IS NOT NULL DROP TABLE #Pares;
CREATE TABLE #Pares (IdCheque INT PRIMARY KEY, AsiId INT NOT NULL, Origen VARCHAR(12) NOT NULL, Control NVARCHAR(100) NULL);

;WITH Chq AS (
    SELECT c.IdCheque,
           ConceptoAlta = CASE c.Tipo WHEN 'TERCERO' THEN N'Recepción Cheque Tercero #'
                                      WHEN 'PROPIO'  THEN N'Emisión Cheque Propio #' END + c.NumeroCheque
    FROM dbo.TesoreriaCheques c
), Cand AS (
    SELECT c.IdCheque, a.AsiId,
           CntAsi = COUNT(*) OVER (PARTITION BY c.IdCheque),
           CntChq = COUNT(*) OVER (PARTITION BY a.AsiId)
    FROM Chq c
    JOIN dbo.Cont_AsientosCabecera a ON a.SysOrigen = 'TESORERIA' AND a.AsiConcepto = c.ConceptoAlta
)
INSERT INTO #Pares (IdCheque, AsiId, Origen)
SELECT IdCheque, AsiId, 'AUTOMATICO' FROM Cand
WHERE CntAsi = 1 AND CntChq = 1 AND IdCheque NOT IN (SELECT IdCheque FROM @Fijos)
UNION ALL
SELECT IdCheque, AsiId, 'FIJADO' FROM @Fijos;

UPDATE p SET Control = CASE
        WHEN c.IdCheque IS NULL                                   THEN 'el cheque no existe'
        WHEN a.AsiId IS NULL                                      THEN 'el asiento no existe'
        WHEN a.SysOrigen <> 'TESORERIA'                           THEN 'el asiento no es de TESORERIA'
        WHEN a.AsiConcepto <> k.ConceptoAlta                      THEN 'el concepto no es el de este cheque'
        WHEN c.IdMoneda = 1 AND ISNULL(t.Debe, -1) <> c.Monto     THEN 'el importe del asiento no coincide'
        WHEN (SELECT COUNT(*) FROM #Pares x WHERE x.AsiId = p.AsiId) > 1 THEN 'asiento asignado a dos cheques'
        WHEN c.AsiIdAlta IS NOT NULL AND c.AsiIdAlta <> p.AsiId   THEN 'el cheque ya tiene otro AsiIdAlta'
        ELSE 'OK' END
FROM #Pares p
LEFT JOIN dbo.TesoreriaCheques c ON c.IdCheque = p.IdCheque
OUTER APPLY (SELECT ConceptoAlta = CASE c.Tipo WHEN 'TERCERO' THEN N'Recepción Cheque Tercero #'
                                               WHEN 'PROPIO'  THEN N'Emisión Cheque Propio #' END + c.NumeroCheque) k
LEFT JOIN dbo.Cont_AsientosCabecera a ON a.AsiId = p.AsiId
OUTER APPLY (SELECT Debe = SUM(d.DetDebeUYU) FROM dbo.Cont_AsientosDetalle d WHERE d.AsiId = p.AsiId) t;

IF EXISTS (SELECT 1 FROM #Pares WHERE Control <> 'OK')
BEGIN
    PRINT '[ABORTADO] Hay pares que no cierran. No se modificó nada.';
    SELECT * FROM #Pares WHERE Control <> 'OK';
    DROP TABLE #Pares;
    RETURN;
END

DECLARE @Pend INT, @Hechos INT;
SELECT @Pend = COUNT(*)
FROM dbo.TesoreriaCheques c JOIN #Pares p ON p.IdCheque = c.IdCheque
WHERE c.AsiIdAlta IS NULL;

IF @Pend = 0
    PRINT '[SKIP] Nada que completar: todos los cheques emparejados ya tienen AsiIdAlta.';
ELSE
BEGIN
    BEGIN TRAN;

    UPDATE c SET c.AsiIdAlta = p.AsiId
    FROM dbo.TesoreriaCheques c JOIN #Pares p ON p.IdCheque = c.IdCheque
    WHERE c.AsiIdAlta IS NULL;
    SET @Hechos = @@ROWCOUNT;

    -- Autochequeo: cada cheque emparejado tiene que quedar con SU asiento.
    IF @Hechos <> @Pend
       OR EXISTS (SELECT 1 FROM #Pares p JOIN dbo.TesoreriaCheques c ON c.IdCheque = p.IdCheque
                  WHERE ISNULL(c.AsiIdAlta, -1) <> p.AsiId)
    BEGIN
        ROLLBACK;
        PRINT '[REVERTIDO] El autochequeo no cerró (' + CAST(@Hechos AS VARCHAR(10)) + ' de '
            + CAST(@Pend AS VARCHAR(10)) + '). No se modificó nada.';
    END
    ELSE
    BEGIN
        COMMIT;
        PRINT '[OK] AsiIdAlta completado en ' + CAST(@Hechos AS VARCHAR(10)) + ' cheques.';
    END
END

SELECT c.IdCheque, c.NumeroCheque, c.Tipo, c.Estado, c.Monto, c.AsiIdAlta, p.Origen
FROM dbo.TesoreriaCheques c
LEFT JOIN #Pares p ON p.IdCheque = c.IdCheque
ORDER BY CASE WHEN c.AsiIdAlta IS NULL THEN 1 ELSE 0 END, c.NumeroCheque, c.IdCheque;

DROP TABLE #Pares;
GO
