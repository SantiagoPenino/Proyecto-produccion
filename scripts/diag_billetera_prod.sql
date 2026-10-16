-- ============================================================================
-- DIAGNOSTICO BILLETERA EN PRODUCCION (01-09-2026) - SOLO LECTURA
-- Chequea TODO lo que el proyecto billetera necesita en la base y dice que
-- script falta correr. No modifica nada. Correr en SecureAppDB (prod).
-- Orden de los scripts si algo falta:
--   1) add_billetera_cuentas.sql   2) add_tipo_pago_saldo.sql
--   3) crear_billeteras_clientes.sql   4) migrar_billeteras_prepago.sql
--   5) add_billetera_portal.sql   (+ opcional: ConfiguracionGlobal VALOR_UI)
-- (archivo en ASCII puro a proposito: abre igual en SSMS con cualquier encoding)
-- ============================================================================
SET NOCOUNT ON;
DECLARE @res TABLE (Orden INT, Componente NVARCHAR(120), Script NVARCHAR(60), Estado NVARCHAR(10), Detalle NVARCHAR(300));

-- ---- Script 1: add_billetera_cuentas.sql -----------------------------------
INSERT @res SELECT 1, 'Columna CuentasCliente.CueNombre', 'add_billetera_cuentas',
    CASE WHEN COL_LENGTH('dbo.CuentasCliente','CueNombre') IS NULL THEN 'FALTA' ELSE 'OK' END, '';
INSERT @res SELECT 2, 'Columna CuentasCliente.CueEsPrincipal', 'add_billetera_cuentas',
    CASE WHEN COL_LENGTH('dbo.CuentasCliente','CueEsPrincipal') IS NULL THEN 'FALTA' ELSE 'OK' END, '';
INSERT @res SELECT 3, 'Columna CuentasCliente.CueRestringida', 'add_billetera_cuentas',
    CASE WHEN COL_LENGTH('dbo.CuentasCliente','CueRestringida') IS NULL THEN 'FALTA' ELSE 'OK' END, '';
INSERT @res SELECT 4, 'Columna CuentasCliente.CueAutoConsumo', 'add_billetera_cuentas',
    CASE WHEN COL_LENGTH('dbo.CuentasCliente','CueAutoConsumo') IS NULL THEN 'FALTA' ELSE 'OK' END, '';
INSERT @res SELECT 5, 'Columna CuentasCliente.CueModalidadFiscal', 'add_billetera_cuentas',
    CASE WHEN COL_LENGTH('dbo.CuentasCliente','CueModalidadFiscal') IS NULL THEN 'FALTA' ELSE 'OK' END, '';
INSERT @res SELECT 6, 'Indice unico UX_CuentasCliente_PrincipalPorTipo', 'add_billetera_cuentas',
    CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_CuentasCliente_PrincipalPorTipo'
                        AND object_id=OBJECT_ID('dbo.CuentasCliente')) THEN 'OK' ELSE 'FALTA' END, '';
INSERT @res SELECT 7, 'Tabla CuentasClienteArticulosPermitidos', 'add_billetera_cuentas',
    CASE WHEN OBJECT_ID('dbo.CuentasClienteArticulosPermitidos','U') IS NULL THEN 'FALTA' ELSE 'OK' END, '';
INSERT @res SELECT 8, 'TipoMovimiento TRANSFERENCIA_SALIDA', 'add_billetera_cuentas',
    CASE WHEN EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId='TRANSFERENCIA_SALIDA') THEN 'OK' ELSE 'FALTA' END, '';
INSERT @res SELECT 9, 'TipoMovimiento TRANSFERENCIA_ENTRADA', 'add_billetera_cuentas',
    CASE WHEN EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId='TRANSFERENCIA_ENTRADA') THEN 'OK' ELSE 'FALTA' END, '';
INSERT @res SELECT 10, 'TipoMovimiento CONSUMO_CUENTA', 'add_billetera_cuentas',
    CASE WHEN EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId='CONSUMO_CUENTA') THEN 'OK' ELSE 'FALTA' END, '';
INSERT @res SELECT 11, 'TipoMovimiento CARGA_PREPAGO', 'add_billetera_cuentas',
    CASE WHEN EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId='CARGA_PREPAGO') THEN 'OK' ELSE 'FALTA' END, '';
INSERT @res SELECT 12, 'Medio de pago "Saldo de cuenta" (AfectaCaja=0)', 'add_billetera_cuentas',
    CASE WHEN EXISTS (SELECT 1 FROM dbo.MetodosPagos WHERE MPaDescripcionMetodo='Saldo de cuenta') THEN 'OK' ELSE 'FALTA' END,
    ISNULL((SELECT TOP 1 'id ' + CAST(MPaIdMetodoPago AS VARCHAR(10)) + ' - AfectaCaja=' + CAST(ISNULL(MPaAfectaCaja,0) AS VARCHAR(5))
            FROM dbo.MetodosPagos WHERE MPaDescripcionMetodo='Saldo de cuenta'), '');

-- Backfill de principales (solo si las columnas existen).
-- OJO: un par (cliente, moneda) cuya UNICA cuenta es la BILLETERA esta BIEN sin
-- principal: obtenerOCrearCuenta la crea al primer uso (fix 01/09: DINERO = solo
-- principal). Lo que delata backfill faltante es una cuenta COMUN sin principal.
IF COL_LENGTH('dbo.CuentasCliente','CueEsPrincipal') IS NOT NULL
BEGIN
    DECLARE @sinPrincipal INT, @principales INT;
    EXEC sp_executesql N'
        SELECT @p = (SELECT COUNT(*) FROM dbo.CuentasCliente WHERE CueEsPrincipal = 1),
               @s = (SELECT COUNT(*) FROM (
                        SELECT CliIdCliente, CueTipo FROM dbo.CuentasCliente
                        WHERE CueTipo IN (''DINERO_UYU'',''DINERO_USD'') AND CueActiva = 1
                          AND LTRIM(RTRIM(ISNULL(CueNombre,''''))) NOT IN (''BILLETERA USD'',''BILLETERA UY'')
                        GROUP BY CliIdCliente, CueTipo
                        HAVING SUM(CASE WHEN CueEsPrincipal = 1 THEN 1 ELSE 0 END) = 0) x)',
        N'@p INT OUTPUT, @s INT OUTPUT', @p = @principales OUTPUT, @s = @sinPrincipal OUTPUT;
    INSERT @res SELECT 13, 'Backfill: cuentas DINERO comunes SIN principal', 'add_billetera_cuentas',
        CASE WHEN @sinPrincipal = 0 THEN 'OK' ELSE 'FALTA' END,
        CAST(@principales AS VARCHAR(10)) + ' principales marcadas - ' + CAST(@sinPrincipal AS VARCHAR(10)) + ' pares (cliente,moneda) con cuentas comunes sin principal (debe ser 0; las que solo tienen BILLETERA no cuentan)';
END
ELSE INSERT @res SELECT 13, 'Backfill: cuentas DINERO comunes SIN principal', 'add_billetera_cuentas', 'FALTA', 'la columna no existe todavia';

-- ---- Script 2: add_tipo_pago_saldo.sql -------------------------------------
INSERT @res SELECT 20, 'TipoMovimiento PAGO_SALDO', 'add_tipo_pago_saldo',
    CASE WHEN EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId='PAGO_SALDO') THEN 'OK' ELSE 'FALTA' END, '';

-- ---- Script 3: crear_billeteras_clientes.sql -------------------------------
-- Regla 01-09-2026: se siembran SOLO los clientes con alguna principal ACTIVA
-- (= los que operaron). El resto recibe sus billeteras AUTOMATICAMENTE al
-- prenderles el switch "Billetera visible en el portal" del 360.
IF COL_LENGTH('dbo.CuentasCliente','CueNombre') IS NOT NULL
BEGIN
    DECLARE @cliOperan INT, @bUSD INT, @bUY INT, @habSinBill INT;
    EXEC sp_executesql N'
        SELECT @o = (SELECT COUNT(DISTINCT cc.CliIdCliente) FROM dbo.CuentasCliente cc
                     JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
                     WHERE cc.CueEsPrincipal = 1 AND cc.CueActiva = 1),
               @u = (SELECT COUNT(*) FROM dbo.CuentasCliente WHERE LTRIM(RTRIM(ISNULL(CueNombre,''''))) = ''BILLETERA USD''),
               @y = (SELECT COUNT(*) FROM dbo.CuentasCliente WHERE LTRIM(RTRIM(ISNULL(CueNombre,''''))) = ''BILLETERA UY'')',
        N'@o INT OUTPUT, @u INT OUTPUT, @y INT OUTPUT', @o = @cliOperan OUTPUT, @u = @bUSD OUTPUT, @y = @bUY OUTPUT;
    INSERT @res SELECT 30, 'BILLETERA USD para los clientes que operan', 'crear_billeteras_clientes',
        CASE WHEN @bUSD >= @cliOperan THEN 'OK' ELSE 'FALTA' END,
        CAST(@bUSD AS VARCHAR(10)) + ' billeteras vs ' + CAST(@cliOperan AS VARCHAR(10)) + ' clientes con principal activa';
    INSERT @res SELECT 31, 'BILLETERA UY para los clientes que operan', 'crear_billeteras_clientes',
        CASE WHEN @bUY >= @cliOperan THEN 'OK' ELSE 'FALTA' END,
        CAST(@bUY AS VARCHAR(10)) + ' billeteras vs ' + CAST(@cliOperan AS VARCHAR(10)) + ' clientes con principal activa';
    -- Invariante del switch: todo cliente HABILITADO en el portal tiene sus 2 billeteras
    IF COL_LENGTH('dbo.Clientes','CliBilleteraPortal') IS NOT NULL
    BEGIN
        EXEC sp_executesql N'
            SELECT @h = COUNT(*) FROM dbo.Clientes c
            WHERE c.CliBilleteraPortal = 1
              AND 2 > (SELECT COUNT(*) FROM dbo.CuentasCliente cc
                       WHERE cc.CliIdCliente = c.CliIdCliente
                         AND LTRIM(RTRIM(ISNULL(cc.CueNombre,''''))) IN (''BILLETERA USD'',''BILLETERA UY''))',
            N'@h INT OUTPUT', @h = @habSinBill OUTPUT;
        INSERT @res SELECT 32, 'Clientes habilitados en portal SIN sus 2 billeteras', 'crear_billeteras_clientes',
            CASE WHEN @habSinBill = 0 THEN 'OK' ELSE 'REVISAR' END,
            CAST(@habSinBill AS VARCHAR(10)) + ' (debe ser 0: el switch las crea solas al habilitar)';
    END
END
ELSE INSERT @res SELECT 30, 'BILLETERAs creadas', 'crear_billeteras_clientes', 'FALTA', 'requiere add_billetera_cuentas antes';

-- ---- (Obsoleto) migrar_billeteras_prepago.sql ------------------------------
-- Ya no se corre: las billeteras nacen PREPAGO+automatico. Este check solo avisa
-- si aparece alguna billetera en otra modalidad (no deberia).
IF COL_LENGTH('dbo.CuentasCliente','CueModalidadFiscal') IS NOT NULL
BEGIN
    DECLARE @noMigradas INT;
    EXEC sp_executesql N'
        SELECT @n = (SELECT COUNT(*) FROM dbo.CuentasCliente
                     WHERE LTRIM(RTRIM(ISNULL(CueNombre,''''))) IN (''BILLETERA USD'',''BILLETERA UY'')
                       AND (ISNULL(CueModalidadFiscal,''ANTICIPO_A_FACTURAR'') <> ''PREPAGO_FACTURADO'' OR CueAutoConsumo = 0))',
        N'@n INT OUTPUT', @n = @noMigradas OUTPUT;
    INSERT @res SELECT 40, 'BILLETERAs que NO son prepago+automatico', '(obsoleto: nacen migradas)',
        CASE WHEN @noMigradas = 0 THEN 'OK' ELSE 'REVISAR' END,
        CAST(@noMigradas AS VARCHAR(10)) + ' (debe ser 0; si hay, revisar a mano su modalidad)';
END

-- ---- Script 5: add_billetera_portal.sql ------------------------------------
INSERT @res SELECT 50, 'Columna Clientes.CliBilleteraPortal', 'add_billetera_portal',
    CASE WHEN COL_LENGTH('dbo.Clientes','CliBilleteraPortal') IS NULL THEN 'FALTA' ELSE 'OK' END, '';
IF COL_LENGTH('dbo.Clientes','CliBilleteraPortal') IS NOT NULL
BEGIN
    DECLARE @hab INT;
    EXEC sp_executesql N'SELECT @h = COUNT(*) FROM dbo.Clientes WHERE CliBilleteraPortal = 1',
        N'@h INT OUTPUT', @h = @hab OUTPUT;
    INSERT @res SELECT 51, 'Clientes con billetera visible en el portal', 'add_billetera_portal', 'INFO',
        CAST(@hab AS VARCHAR(10)) + ' habilitados (0 al arrancar: se prende por cliente desde el 360 -> Cuentas)';
END

-- ---- Opcional: umbral DGI del e-Ticket de la recarga web -------------------
INSERT @res SELECT 60, 'ConfiguracionGlobal clave VALOR_UI (opcional)', '(config manual)',
    CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave='VALOR_UI') THEN 'OK' ELSE 'INFO' END,
    ISNULL((SELECT TOP 1 'valor: ' + CAST(Valor AS NVARCHAR(20)) FROM dbo.ConfiguracionGlobal WHERE Clave='VALOR_UI'),
           'no existe: el sistema usa 6,5 por defecto (umbral e-Ticket aprox $65.000)');

-- ---- RESULTADO -------------------------------------------------------------
SELECT Componente, Script, Estado, Detalle FROM @res ORDER BY Orden;

SELECT CASE WHEN EXISTS (SELECT 1 FROM @res WHERE Estado = 'FALTA')
            THEN 'FALTAN SCRIPTS - correr los marcados FALTA en el orden 1 a 5 y volver a correr este diagnostico'
            ELSE 'TODO LO NECESARIO ESTA EN LA BASE - se puede deployar el codigo'
       END AS Veredicto;
