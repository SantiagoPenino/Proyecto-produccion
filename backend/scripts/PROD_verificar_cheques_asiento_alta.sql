-- =====================================================================================
-- PROD_verificar_cheques_asiento_alta.sql  (14-oct-2026)  — SOLO LECTURA
--
-- Correr ANTES de PROD_migrar_cheques_asiento_alta.sql. Muestra con qué asiento de alta
-- se va a completar cada cheque en la columna nueva TesoreriaCheques.AsiIdAlta.
--
-- POR QUÉ: anularCheque buscaba el asiento a revertir con LIKE '%#<número>%' y tomaba el
-- más nuevo: anular el cheque 12 podía revertir el del 123, el de otro banco con el mismo
-- número o un "Cambio Estado". Con AsiIdAlta revierte exactamente el asiento de ese cheque.
--
-- EMPAREJAMIENTO:
--   AUTOMATICO : el concepto exacto ("Recepción Cheque Tercero #N" / "Emisión Cheque Propio #N")
--                está en un solo asiento de TESORERIA y ese asiento corresponde a un solo cheque.
--   FIJADO     : los dos números cargados dos veces, emparejados por orden de carga (revisado
--                el 14-oct): 668805 -> 2↔14363, 3↔14364 (revertido por 15097);
--                629303 -> 5↔15287, 6↔15744 (revertido por 51856).
--   Los cheques que no aparecen no tienen asiento de alta propio (entraron por caja: el
--   asiento lo hizo el cobro) y quedan con AsiIdAlta en NULL.
--
-- Control: OK, o el motivo por el que el par no cierra. En US$ el importe no se compara
-- (el asiento está en pesos). Esperado al 14-oct: 12 pares (8 automáticos + 4 fijados), todos OK.
-- =====================================================================================
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

PRINT 'Columna AsiIdAlta: ' + CASE WHEN COL_LENGTH('dbo.TesoreriaCheques', 'AsiIdAlta') IS NULL
                                   THEN 'todavía no existe' ELSE 'ya existe' END;

DECLARE @Fijos TABLE (IdCheque INT PRIMARY KEY, AsiId INT NOT NULL);
INSERT @Fijos VALUES (2, 14363), (3, 14364), (5, 15287), (6, 15744);

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
        ELSE 'OK' END
FROM #Pares p
LEFT JOIN dbo.TesoreriaCheques c ON c.IdCheque = p.IdCheque
OUTER APPLY (SELECT ConceptoAlta = CASE c.Tipo WHEN 'TERCERO' THEN N'Recepción Cheque Tercero #'
                                               WHEN 'PROPIO'  THEN N'Emisión Cheque Propio #' END + c.NumeroCheque) k
LEFT JOIN dbo.Cont_AsientosCabecera a ON a.AsiId = p.AsiId
OUTER APPLY (SELECT Debe = SUM(d.DetDebeUYU) FROM dbo.Cont_AsientosDetalle d WHERE d.AsiId = p.AsiId) t;

DECLARE @Tot INT, @Mal INT;
SELECT @Tot = COUNT(*), @Mal = ISNULL(SUM(CASE WHEN Control <> 'OK' THEN 1 ELSE 0 END), 0) FROM #Pares;
PRINT '=== Cheques y su asiento de alta (' + CAST(@Tot AS VARCHAR(10)) + ' pares, '
    + CAST(@Mal AS VARCHAR(10)) + ' con problemas) ===';
SELECT p.Control, p.Origen, c.IdCheque, c.NumeroCheque, c.Tipo, c.Estado, c.Monto, c.IdMoneda,
       p.AsiId, a.AsiFecha, a.AsiConcepto,
       TotalAsiento = (SELECT SUM(d.DetDebeUYU) FROM dbo.Cont_AsientosDetalle d WHERE d.AsiId = p.AsiId)
FROM #Pares p
LEFT JOIN dbo.TesoreriaCheques c ON c.IdCheque = p.IdCheque
LEFT JOIN dbo.Cont_AsientosCabecera a ON a.AsiId = p.AsiId
ORDER BY CASE WHEN p.Control = 'OK' THEN 1 ELSE 0 END, p.Origen, c.NumeroCheque, c.IdCheque;

DROP TABLE #Pares;
