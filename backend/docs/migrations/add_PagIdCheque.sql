/* ============================================================================
   add_PagIdCheque.sql
   ----------------------------------------------------------------------------
   Vincula el pago con el cheque recibido.

   POR QUÉ: dbo.Pagos no tenía ninguna columna de cheque. El modal de caja
   (ChequeRecibirModal) daba de alta el cheque en dbo.TesoreriaCheques y devolvía
   su IdCheque, pero al armar el payload del cobro ese id se descartaba: el cheque
   quedaba como una isla, sin forma de saber a qué cobro correspondía. Por eso el
   Panel 360 no podía mostrar el número de cheque de un pago.

   Idempotente: se puede correr más de una vez sin efecto.

   Verificación posterior sugerida:
     SELECT p.PagIdPago, p.PagIdCheque, ch.NumeroCheque, ch.Monto
     FROM dbo.Pagos p
     JOIN dbo.TesoreriaCheques ch ON ch.IdCheque = p.PagIdCheque;
   ============================================================================ */

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Pagos') AND name = 'PagIdCheque'
)
BEGIN
    ALTER TABLE dbo.Pagos ADD PagIdCheque INT NULL;
    PRINT '[OK] dbo.Pagos.PagIdCheque agregada.';
END
ELSE
    PRINT '[SKIP] dbo.Pagos.PagIdCheque ya existe.';
GO

-- FK a TesoreriaCheques. Sin cascada: anular un pago no debe borrar el cheque
-- físico (el cheque sigue existiendo en cartera con su propio estado).
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Pagos_TesoreriaCheques'
)
AND EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TesoreriaCheques')
BEGIN
    ALTER TABLE dbo.Pagos WITH NOCHECK
        ADD CONSTRAINT FK_Pagos_TesoreriaCheques
        FOREIGN KEY (PagIdCheque) REFERENCES dbo.TesoreriaCheques (IdCheque);
    PRINT '[OK] FK_Pagos_TesoreriaCheques creada.';
END
ELSE
    PRINT '[SKIP] FK_Pagos_TesoreriaCheques ya existe (o falta TesoreriaCheques).';
GO

-- Índice filtrado: las consultas del 360 buscan el cheque solo cuando lo hay,
-- y los pagos con cheque son una minoría del total.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Pagos_PagIdCheque' AND object_id = OBJECT_ID('dbo.Pagos')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Pagos_PagIdCheque
        ON dbo.Pagos (PagIdCheque)
        WHERE PagIdCheque IS NOT NULL;
    PRINT '[OK] IX_Pagos_PagIdCheque creado.';
END
ELSE
    PRINT '[SKIP] IX_Pagos_PagIdCheque ya existe.';
GO
