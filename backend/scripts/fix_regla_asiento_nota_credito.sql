/* =====================================================================
   FIX - La Nota de Crédito nunca generó asiento contable
   ---------------------------------------------------------------------
   Diagnóstico:
     Cont_ReglasAsiento para EvtCodigo='NOTA_CREDITO' tiene DOS errores:

     1) Apunta a la cuenta '4.1.1.01', que NO EXISTE en Cont_PlanCuentas
        (la cuenta de ventas real es '4.1.1' - Ventas Servicios / Mostrador).
        getCuentaId lanza "La cuenta contable 4.1.1.01 no existe o no es
        imputable", cajaController#generarNotaCredito lo atrapa en un
        try/catch que solo hace logger.warn, y la NC se guarda SIN asiento.
        Resultado: 0 asientos de nota de crédito en toda la base.

     2) Las naturalezas están invertidas: hoy dice META_CLIENTE=DEBE y
        ventas=HABER, que es el asiento de una VENTA. Una nota de crédito
        es al revés: DEBE ventas (baja el ingreso), HABER cliente (baja el
        saldo a cobrar).

   Este script corrige ambas cosas. Ejecutar en PRODUCCIÓN.
   ===================================================================== */

SET NOCOUNT ON;

-- ── ANTES ────────────────────────────────────────────────────────────
SELECT 'ANTES' AS Momento, RasId, EvtCodigo, CueCodigo, RasNaturaleza, RasFormula, RasOrden
FROM dbo.Cont_ReglasAsiento
WHERE EvtCodigo = 'NOTA_CREDITO'
ORDER BY RasOrden;

-- Verificación previa: la cuenta de ventas destino tiene que existir e imputar
IF NOT EXISTS (SELECT 1 FROM dbo.Cont_PlanCuentas WHERE CueCodigo = '4.1.1' AND CueImputable = 1)
BEGIN
    RAISERROR('La cuenta 4.1.1 no existe o no es imputable. Revisar el plan de cuentas antes de aplicar este fix.', 16, 1);
    RETURN;
END

BEGIN TRANSACTION;

-- 1) Línea del CLIENTE: en una NC va al HABER (baja lo que el cliente debe)
UPDATE dbo.Cont_ReglasAsiento
   SET RasNaturaleza = 'HABER'
 WHERE EvtCodigo = 'NOTA_CREDITO'
   AND CueCodigo  = 'META_CLIENTE';

-- 2) Línea de VENTAS: corregir la cuenta inexistente y ponerla en el DEBE
UPDATE dbo.Cont_ReglasAsiento
   SET CueCodigo     = '4.1.1',
       RasNaturaleza = 'DEBE'
 WHERE EvtCodigo = 'NOTA_CREDITO'
   AND CueCodigo  = '4.1.1.01';

COMMIT TRANSACTION;

-- ── DESPUÉS ──────────────────────────────────────────────────────────
SELECT 'DESPUES' AS Momento, RasId, EvtCodigo, CueCodigo, RasNaturaleza, RasFormula, RasOrden
FROM dbo.Cont_ReglasAsiento
WHERE EvtCodigo = 'NOTA_CREDITO'
ORDER BY RasOrden;

/* Debe quedar:
     META_CLIENTE  HABER  TOTAL
     4.1.1         DEBE   TOTAL

   OJO: esto arregla las NC de acá en adelante. Las notas de crédito ya
   emitidas siguen SIN asiento; su regularización contable se define con
   el contador (ver backend/scripts/auditar_movimientos_nc.js para el listado).
*/
