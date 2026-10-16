/* ============================================================================
   PASO 2 SOLO — recálculo de CueSaldoActual y MovSaldoPosterior desde el libro
   ----------------------------------------------------------------------------
   Partido el 17-sep-2026 desde PROD_alter_SP_RegistrarMovimiento_y_recalculo.sql.
   Requiere que PROD_alter_SP_RegistrarMovimiento_PASO1_alter.sql ya haya corrido
   (lo verifica y se frena si no).

   Qué hace, en UNA transacción: guarda antes/después por cuenta en
   dbo.AuditRecalculoSaldo_20260905, recalcula el saldo corrido de cada
   movimiento (las ORDEN no acumulan) y pone CueSaldoActual = libro sin órdenes
   en TODAS las cuentas de dinero. Idempotente: correrlo de nuevo no cambia nada.

   Para mirar sin escribir: ejecutar solo hasta "FIN DE LA VISTA PREVIA".
   Correr fuera de hora: bloquea MovimientosCuenta mientras dura.
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
