/* ============================================================================
   PRODUCCIÓN — LA CAUSA MADRE: SP_RegistrarMovimiento y CueSaldoActual
   ----------------------------------------------------------------------------
   QUÉ PASABA: el SP sumaba a CuentasCliente.CueSaldoActual TODO movimiento,
   incluidas las ORDEN / ORDEN_ANTICIPO. Pero el resto del sistema (cierre de
   ciclo, Estado de Cuenta, resumen del 360) asume que las órdenes NO tocan ese
   saldo — se cobran cuando se facturan (VTA_CAJA / CIERRE_CICLO). Resultado:
   cada ciclo facturado restaba la deuda DOS veces del saldo guardado. Medido el
   05-09-2026: la columna estaba mal en 2.158 de 2.479 cuentas (87%), con 53
   "falsos positivos" (la columna decía "tiene plata" y el libro decía que no) —
   justo las que el motor de cruce de monedas podía vaciar. Y la gente la
   "corregía" a mano metiendo plata inventada (CR SPORT US$ 9.620,62, etc.).

   QUÉ HACE ESTE SCRIPT (en este orden, y los dos pasos van JUNTOS):
     PASO 1  ALTER del SP: las ORDEN / ORDEN_ANTICIPO ya NO tocan CueSaldoActual.
             El movimiento se inserta igual (queda en la libreta como detalle del
             trabajo). @SaldoResultante sigue devolviendo lo que los llamadores
             esperan: para una ORDEN, el saldo "CON esta orden" (calculado, sin
             persistirlo). Por eso ESTE SCRIPT SE PUEDE CORRER ANTES DEL DEPLOY:
             el código viejo y el nuevo reciben el mismo número que antes.
     PASO 2  Recalcula CueSaldoActual de TODAS las cuentas de dinero a partir del
             libro, con la misma fórmula: SUM(MovImporte) sin ORDEN/ORDEN_ANTICIPO
             y sin anulados. Recalcula también MovSaldoPosterior (saldo corrido)
             con esa misma regla para que el detalle y el total digan lo mismo.
             Deja el ANTES/DESPUÉS por cuenta en la tabla de auditoría
             dbo.AuditRecalculoSaldo_20260905 (no se borra).

   SIN el PASO 1, el PASO 2 se vuelve a pudrir con la próxima orden.
   SIN el PASO 2, el PASO 1 deja la columna congelada con el valor viejo.

   Compatibilidad: los scripts por cliente que ya se corrieron (Elisa, Posse,
   Gerardo, CR SPORT, Martina) recalculaban CueSaldoActual sumando TODO; este
   paso los pisa con la fórmula correcta. Es idempotente: correrlo de nuevo deja
   los mismos números.

   Correr con el backend YA DESPLEGADO con los cambios del 05-09 (cruce con
   guarda de ciclo y lectura por libro). ABRIR DESDE EL DISCO en SSMS.
   Para mirar sin escribir: seleccionar hasta "FIN DE LA VISTA PREVIA".
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
    PRINT 'PASO 1: SP_RegistrarMovimiento actualizado (las ORDEN ya no tocan CueSaldoActual).';
ELSE
BEGIN
    RAISERROR('PASO 1 NO se aplicó: el SP no tiene la regla nueva. Revisá la base (USE SecureAppDB) y los errores de arriba. NO seguir con el PASO 2.', 16, 1);
    SET NOEXEC ON;
END

/* ── PASO 2 · recalcular TODAS las cuentas de dinero desde el libro ──────── */
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AuditRecalculoSaldo_20260905') IS NULL
BEGIN
    CREATE TABLE dbo.AuditRecalculoSaldo_20260905 (
        CueIdCuenta INT NOT NULL,
        CliIdCliente INT NULL,
        CueTipo VARCHAR(20) NULL,
        SaldoGuardadoAntes DECIMAL(18,4) NULL,
        SaldoLibro DECIMAL(18,4) NULL,
        Diferencia DECIMAL(18,4) NULL,
        Corrida DATETIME NOT NULL DEFAULT GETDATE()
    );
END

BEGIN TRANSACTION;

    INSERT INTO dbo.AuditRecalculoSaldo_20260905 (CueIdCuenta, CliIdCliente, CueTipo, SaldoGuardadoAntes, SaldoLibro, Diferencia)
    SELECT cc.CueIdCuenta, cc.CliIdCliente, cc.CueTipo, cc.CueSaldoActual, s.Saldo, s.Saldo - cc.CueSaldoActual
    FROM dbo.CuentasCliente cc
    CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                   WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                     AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
    WHERE cc.CueTipo LIKE 'DINERO%'
      AND ABS(cc.CueSaldoActual - s.Saldo) > 0.005;
    PRINT CONCAT('PASO 2a: cuentas con diferencia auditadas: ', @@ROWCOUNT);

    -- Saldo corrido: misma regla (las ORDEN no acumulan; conservan el corrido anterior)
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(CASE WHEN m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') THEN 0 ELSE m.MovImporte END)
                     OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
        WHERE cc.CueTipo LIKE 'DINERO%' AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento
    WHERE ABS(ISNULL(m.MovSaldoPosterior, 0) - ord.run) > 0.005;
    PRINT CONCAT('PASO 2b: saldos corridos corregidos: ', @@ROWCOUNT);

    UPDATE cc
    SET cc.CueSaldoActual = s.Saldo
    FROM dbo.CuentasCliente cc
    CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                   WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                     AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
    WHERE cc.CueTipo LIKE 'DINERO%'
      AND ABS(cc.CueSaldoActual - s.Saldo) > 0.005;
    PRINT CONCAT('PASO 2c: CueSaldoActual corregidos: ', @@ROWCOUNT);

COMMIT TRANSACTION;

/* ── DESPUÉS: tiene que dar ACorregir = 0 y FalsosPositivos = 0 ──────────── */
SELECT Vista = 'DESPUES',
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Cuentas = COUNT(*),
       YaCoinciden = SUM(CASE WHEN ABS(cc.CueSaldoActual - s.Saldo) <= 1 THEN 1 ELSE 0 END),
       ACorregir   = SUM(CASE WHEN ABS(cc.CueSaldoActual - s.Saldo) >  1 THEN 1 ELSE 0 END),
       FalsosPositivos = SUM(CASE WHEN cc.CueSaldoActual > 0.01 AND s.Saldo <= 0.01 THEN 1 ELSE 0 END)
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueTipo LIKE 'DINERO%'
GROUP BY cc.MonIdMoneda;

SELECT Auditoria = 'las 15 que más cambiaron', a.CueIdCuenta, Cliente = RTRIM(c.Nombre), a.CueTipo,
       Antes = CAST(a.SaldoGuardadoAntes AS DECIMAL(18,2)), Libro = CAST(a.SaldoLibro AS DECIMAL(18,2)),
       Dif = CAST(a.Diferencia AS DECIMAL(18,2))
FROM (SELECT TOP 15 * FROM dbo.AuditRecalculoSaldo_20260905 ORDER BY ABS(Diferencia) DESC) a
LEFT JOIN dbo.Clientes c ON c.CliIdCliente = a.CliIdCliente
ORDER BY ABS(a.Diferencia) DESC;
