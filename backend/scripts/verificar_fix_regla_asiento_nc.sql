/* ============================================================================
   VERIFICAR (SOLO LECTURA) si ya se aplicó fix_regla_asiento_nota_credito.sql
   ----------------------------------------------------------------------------
   No modifica nada. Corré en la base que quieras chequear (ej. PRODUCCIÓN).

   APLICADO      -> debe verse:  META_CLIENTE = HABER  y  4.1.1 = DEBE
   SIN APLICAR   -> se ve:       META_CLIENTE = DEBE   y  4.1.1.01 = HABER
                                 (4.1.1.01 es la cuenta inexistente del bug)
   ============================================================================ */

SET NOCOUNT ON;

-- Detalle de la regla
SELECT RasId, EvtCodigo, CueCodigo, RasNaturaleza, RasFormula, RasOrden
FROM dbo.Cont_ReglasAsiento
WHERE EvtCodigo = 'NOTA_CREDITO'
ORDER BY RasOrden;

-- Veredicto
SELECT CASE
        WHEN EXISTS (SELECT 1 FROM dbo.Cont_ReglasAsiento
                     WHERE EvtCodigo='NOTA_CREDITO' AND CueCodigo='META_CLIENTE' AND RasNaturaleza='HABER')
         AND EXISTS (SELECT 1 FROM dbo.Cont_ReglasAsiento
                     WHERE EvtCodigo='NOTA_CREDITO' AND CueCodigo='4.1.1' AND RasNaturaleza='DEBE')
         AND NOT EXISTS (SELECT 1 FROM dbo.Cont_ReglasAsiento
                     WHERE EvtCodigo='NOTA_CREDITO' AND CueCodigo='4.1.1.01')
        THEN 'FIX APLICADO (META_CLIENTE=HABER y 4.1.1=DEBE)'
        ELSE 'FIX NO APLICADO todavia — hay que correr fix_regla_asiento_nota_credito.sql'
       END AS Veredicto;
