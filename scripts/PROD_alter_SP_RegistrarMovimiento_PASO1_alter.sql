/* ============================================================================
   PASO 1 SOLO — ALTER de SP_RegistrarMovimiento (sin recálculo de saldos)
   ----------------------------------------------------------------------------
   Partido el 17-sep-2026 desde PROD_alter_SP_RegistrarMovimiento_y_recalculo.sql
   para poder correr el ALTER ahora y el recálculo (PASO 2) más adelante, a mano.

   Qué hace: las ORDEN / ORDEN_ANTICIPO se siguen insertando en el libro pero
   dejan de tocar CuentasCliente.CueSaldoActual. @SaldoResultante devuelve lo
   mismo que antes, así que el código desplegado no cambia de comportamiento.
   Se puede correr ANTES del deploy. Idempotente.

   Después de esto la columna CueSaldoActual sigue con el valor viejo hasta
   correr PROD_alter_SP_RegistrarMovimiento_PASO2_recalculo.sql.

   Antes de correr, guardar la definición actual por si hay que volver atrás:
     SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.SP_RegistrarMovimiento'));
   ============================================================================ */

-- La base se llama igual en local y en producción. Con esto el script no depende
-- del desplegable de SSMS (07-09-2026: corrió parado en otra base y falló todo).
USE SecureAppDB;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

SELECT Servidor = @@SERVERNAME, Base = DB_NAME(),
       Archivo = (SELECT TOP 1 physical_name FROM sys.database_files WHERE type = 0);

/* ── VISTA PREVIA: cuánto va a cambiar ───────────────────────────────────── */
SELECT Vista = 'ANTES',
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Cuentas = COUNT(*),
       YaCoinciden = SUM(CASE WHEN ABS(cc.CueSaldoActual - s.Saldo) <= 1 THEN 1 ELSE 0 END),
       ACorregir   = SUM(CASE WHEN ABS(cc.CueSaldoActual - s.Saldo) >  1 THEN 1 ELSE 0 END),
       PeorDiferencia = CAST(MAX(ABS(cc.CueSaldoActual - s.Saldo)) AS DECIMAL(18,2)),
       FalsosPositivos = SUM(CASE WHEN cc.CueSaldoActual > 0.01 AND s.Saldo <= 0.01 THEN 1 ELSE 0 END)
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueTipo LIKE 'DINERO%'
GROUP BY cc.MonIdMoneda;

/* ==================== FIN DE LA VISTA PREVIA ==============================
   Hasta acá no se escribió NADA.
   ========================================================================= */

/* ── PASO 1 · el SP deja de contar las órdenes ───────────────────────────── */
GO
ALTER PROCEDURE dbo.SP_RegistrarMovimiento
    @CueIdCuenta INT,
    @MovTipo VARCHAR(30),
    @MovConcepto NVARCHAR(500),
    @MovImporte DECIMAL(18,4),
    @MovUsuarioAlta INT,
    @OrdIdOrden INT = NULL,
    @OReIdOrdenRetiro INT = NULL,
    @PagIdPago INT = NULL,
    @DocIdDocumento INT = NULL,
    @MovRefExterna VARCHAR(100) = NULL,
    @MovObservaciones NVARCHAR(500) = NULL,
    @CicIdCiclo INT = NULL,
    @MovFecha DATETIME = NULL,            -- fecha del movimiento (retrofecha). NULL => GETDATE()
    @MovIdGenerado INT = NULL OUTPUT,
    @SaldoResultante DECIMAL(18,4) = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON; DECLARE @NuevoSaldo DECIMAL(18,4);
    BEGIN TRY
        BEGIN TRANSACTION;
            -- 05-09-2026: las ORDEN / ORDEN_ANTICIPO son el detalle del trabajo en curso;
            -- se cobran al facturar (VTA_CAJA / CIERRE_CICLO). NO mueven el saldo guardado.
            -- Antes se restaban acá Y otra vez al facturar → deuda contada dos veces.
            IF @MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')
                UPDATE dbo.CuentasCliente WITH (UPDLOCK) SET CueSaldoActual = CueSaldoActual + @MovImporte WHERE CueIdCuenta = @CueIdCuenta;

            SELECT @NuevoSaldo = CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueIdCuenta;

            INSERT INTO dbo.MovimientosCuenta (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, OrdIdOrden, OReIdOrdenRetiro, PagIdPago, DocIdDocumento, MovRefExterna, MovFecha, MovUsuarioAlta, MovObservaciones, CicIdCiclo)
            VALUES (@CueIdCuenta, @MovTipo, @MovConcepto, @MovImporte, @NuevoSaldo, @OrdIdOrden, @OReIdOrdenRetiro, @PagIdPago, @DocIdDocumento, @MovRefExterna, ISNULL(@MovFecha, GETDATE()), @MovUsuarioAlta, @MovObservaciones, @CicIdCiclo);

            SET @MovIdGenerado = SCOPE_IDENTITY();

            -- COMPATIBILIDAD: quienes llaman al SP con una ORDEN esperan recibir el saldo
            -- "CON esta orden" (así decidían si al cliente le nace deuda). Se les devuelve
            -- eso mismo, calculado, aunque la columna ya no la sume. Así el SP se puede
            -- cambiar ANTES de subir el código nuevo sin que un Común en 0 quede con la
            -- orden marcada como paga sin pagar.
            SET @SaldoResultante = CASE WHEN @MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
                                        THEN @NuevoSaldo + @MovImporte
                                        ELSE @NuevoSaldo END;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW;
    END CATCH;
END;
GO
IF OBJECT_DEFINITION(OBJECT_ID('dbo.SP_RegistrarMovimiento')) LIKE '%IF @MovTipo NOT IN (''ORDEN'', ''ORDEN_ANTICIPO'')%'
    PRINT 'PASO 1: SP_RegistrarMovimiento actualizado (las ORDEN ya no tocan CueSaldoActual). PASO 2 pendiente.';
ELSE
    RAISERROR('PASO 1 NO se aplicó: el SP no tiene la regla nueva. Revisá la base (USE SecureAppDB) y los errores de arriba.', 16, 1);
