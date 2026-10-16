/* =====================================================================================
   CORRECCIÓN — Los 3 cheques de PODIUM (249726/249727/249728) quedaron cargados en
   PESOS y sin cliente. Base: SecureAppDB (PRODUCCIÓN).

   Escribe y hace COMMIT solo: no se queda esperando confirmación, así que no deja
   nada bloqueado. Si algo no cuadra, revierte solo y te dice por qué.
   Correr una sola vez: la segunda aborta sola.

   Qué corrige:
     · IdMoneda 1 (pesos) → 2 (dólares).
     · IdClienteOrigen NULL → el cliente que los entregó (PODIUM / ELISA RAMOS).

   Qué NO corrige:
     · El ASIENTO del alta de cada cheque se hizo leyendo el importe como PESOS. Cambiar
       la moneda acá no lo reescribe. Con el contador: o se anulan los 3 cheques (el botón
       Anular ya revierte el asiento) y se recargan, o va un asiento de ajuste.
   ===================================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Cli INT = (SELECT TOP 1 CliIdCliente FROM dbo.Clientes WHERE CioRuc LIKE '218978560014%');
DECLARE @N   INT = (SELECT COUNT(*) FROM dbo.TesoreriaCheques
                    WHERE NumeroCheque IN ('249726','249727','249728')
                      AND Tipo = 'TERCERO' AND Estado = 'EN_CARTERA' AND IdMoneda = 1);
DECLARE @Err NVARCHAR(400) = NULL;

IF @Cli IS NULL      SET @Err = 'No se encontró el cliente por RUC 218978560014 (PODIUM / ELISA RAMOS).';
ELSE IF @N = 0       SET @Err = 'Ninguno de los 3 cheques está en cartera y en pesos: probablemente ya se corrigió.';
ELSE IF @N <> 3      SET @Err = CONCAT('Solo ', @N, ' de los 3 cheques están en cartera y en pesos. Revisá antes de seguir.');

IF @Err IS NOT NULL
BEGIN
  RAISERROR('ABORTADO — %s', 16, 1, @Err);
  RETURN;
END

-- Estado antes (queda en la salida como respaldo de lo que había)
SELECT 'ANTES' AS Momento, IdCheque, NumeroCheque, Monto, IdMoneda, IdClienteOrigen, Estado
FROM   dbo.TesoreriaCheques WHERE NumeroCheque IN ('249726','249727','249728');

BEGIN TRY
  BEGIN TRAN;

    UPDATE dbo.TesoreriaCheques
    SET    IdMoneda        = 2,          -- 2 = US$ (dbo.Monedas: 1 = $, 2 = US$)
           IdClienteOrigen = @Cli
    WHERE  NumeroCheque IN ('249726','249727','249728')
      AND  Tipo   = 'TERCERO'
      AND  Estado = 'EN_CARTERA';        -- no tocar cheques ya depositados/anulados

    IF (SELECT COUNT(*) FROM dbo.TesoreriaCheques
        WHERE NumeroCheque IN ('249726','249727','249728') AND IdMoneda = 2 AND IdClienteOrigen = @Cli) <> 3
    BEGIN
      ROLLBACK TRAN;
      RAISERROR('ABORTADO Y REVERTIDO — los 3 cheques no quedaron en US$ con el cliente.', 16, 1);
      RETURN;
    END

  COMMIT TRAN;
  PRINT CONCAT('OK. 3 cheques pasados a US$ y asignados al cliente ', @Cli, '.');
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRAN;
  DECLARE @M NVARCHAR(2000) = ERROR_MESSAGE();
  RAISERROR('ERROR — no se aplicó nada: %s', 16, 1, @M);
  RETURN;
END CATCH
GO

-- Control posterior (ya con el COMMIT hecho, no bloquea)
SELECT 'DESPUES' AS Momento, IdCheque, NumeroCheque, Monto, IdMoneda, IdClienteOrigen, Estado
FROM   dbo.TesoreriaCheques WHERE NumeroCheque IN ('249726','249727','249728');
