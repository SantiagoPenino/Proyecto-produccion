-- ════════════════════════════════════════════════════════════════════
--  Cuenta con CueIdCuenta = 0 (08-oct-2026)
-- ════════════════════════════════════════════════════════════════════
--  La cuenta en dólares de Mariana Cabrera (cliente 2340) tiene el id 0:
--  fue la primera fila de CuentasCliente (10/06). El sistema trata el 0
--  como "falta la cuenta" y, desde el deploy del 07/10 (el documento de
--  caja lleva la cuenta real del cliente en vez de la 119 fija), la caja
--  no le puede cobrar nada en dólares:
--    [crearDocumentoContable] Faltan parámetros obligatorios: cueIdCuenta.
--
--  Qué hace: le da a esa cuenta un id normal (el siguiente de la tabla) y
--  pasa todo lo que apunta a la cuenta 0 al id nuevo, en todas las tablas
--  que tienen una columna CueIdCuenta. No cambia saldos ni importes.
--
--  Correr en SSMS, el bloque entero de una vez. Si algo falla, no queda
--  nada hecho (XACT_ABORT + una sola transacción). Se puede volver a
--  correr: si ya no hay cuenta 0, avisa y no toca nada.
-- ════════════════════════════════════════════════════════════════════
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente WHERE CueIdCuenta = 0)
BEGIN
    PRINT 'No hay ninguna cuenta con id 0: no se hizo nada.';
    RETURN;
END

BEGIN TRAN;

-- 1) Antes
SELECT 'ANTES' AS Momento, CueIdCuenta, CliIdCliente, CueTipo, MonIdMoneda, CueEsPrincipal, CueActiva, CueSaldoActual
FROM dbo.CuentasCliente WHERE CueIdCuenta = 0;

-- 2) Copia de la cuenta con id nuevo. Nace NO principal: hay un índice único de "una principal
--    activa por cliente y tipo" y la cuenta 0 todavía existe. Se le devuelve el valor al final.
DECLARE @Principal BIT = (SELECT CueEsPrincipal FROM dbo.CuentasCliente WHERE CueIdCuenta = 0);
DECLARE @Cols NVARCHAR(MAX), @Vals NVARCHAR(MAX), @Sql NVARCHAR(MAX), @Nuevo INT;

SELECT @Cols = STRING_AGG(CAST(QUOTENAME(c.name) AS NVARCHAR(MAX)), ', ') WITHIN GROUP (ORDER BY c.column_id),
       @Vals = STRING_AGG(CAST(CASE WHEN c.name = 'CueEsPrincipal' THEN '0' ELSE QUOTENAME(c.name) END AS NVARCHAR(MAX)), ', ') WITHIN GROUP (ORDER BY c.column_id)
FROM sys.columns c
WHERE c.object_id = OBJECT_ID('dbo.CuentasCliente') AND c.is_identity = 0 AND c.is_computed = 0;

SET @Sql = N'INSERT INTO dbo.CuentasCliente (' + @Cols + N') SELECT ' + @Vals +
           N' FROM dbo.CuentasCliente WHERE CueIdCuenta = 0; SET @Id = SCOPE_IDENTITY();';
EXEC sp_executesql @Sql, N'@Id INT OUTPUT', @Id = @Nuevo OUTPUT;

IF @Nuevo IS NULL OR @Nuevo <= 0
BEGIN
    RAISERROR('No se pudo crear la copia de la cuenta.', 16, 1);
    ROLLBACK;
    RETURN;
END

-- 3) Todo lo que apuntaba a la cuenta 0 pasa a la nueva. Lista EXPLÍCITA de tablas del sistema:
--    la 1ª versión recorría toda tabla con columna CueIdCuenta y en producción chocó con una donde
--    esa columna es IDENTITY (una copia de CuentasCliente hecha con SELECT INTO, inferido). Las
--    tablas que quedan afuera se listan al final, solo para mirar.
DECLARE @Movidas TABLE (Tabla SYSNAME, Filas INT);
DECLARE @Tabla SYSNAME, @Filas INT;
DECLARE tablas CURSOR LOCAL FAST_FORWARD FOR
    SELECT t.name FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
    WHERE c.name = 'CueIdCuenta' AND c.is_identity = 0 AND c.is_computed = 0 AND t.schema_id = SCHEMA_ID('dbo')
      AND t.name IN ('MovimientosCuenta', 'DeudaDocumento', 'ImputacionPago', 'ColaEstadosCuenta', 'CiclosCredito',
                     'DocumentosContables', 'PlanesMetros', 'BeneficiosCliente', 'CuentasClienteArticulosPermitidos');
OPEN tablas;
FETCH NEXT FROM tablas INTO @Tabla;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @Sql = N'UPDATE dbo.' + QUOTENAME(@Tabla) + N' SET CueIdCuenta = @N WHERE CueIdCuenta = 0; SET @F = @@ROWCOUNT;';
    EXEC sp_executesql @Sql, N'@N INT, @F INT OUTPUT', @N = @Nuevo, @F = @Filas OUTPUT;
    IF @Filas > 0 INSERT INTO @Movidas VALUES (@Tabla, @Filas);
    FETCH NEXT FROM tablas INTO @Tabla;
END
CLOSE tablas; DEALLOCATE tablas;

-- 4) Se borra la cuenta 0 y la nueva recupera el "principal"
DELETE FROM dbo.CuentasCliente WHERE CueIdCuenta = 0;
UPDATE dbo.CuentasCliente SET CueEsPrincipal = @Principal WHERE CueIdCuenta = @Nuevo;

-- 5) Después
SELECT 'DESPUÉS' AS Momento, CueIdCuenta, CliIdCliente, CueTipo, MonIdMoneda, CueEsPrincipal, CueActiva, CueSaldoActual
FROM dbo.CuentasCliente WHERE CueIdCuenta = @Nuevo;
SELECT Tabla, Filas AS FilasPasadasALaCuentaNueva FROM @Movidas ORDER BY Tabla;

-- Solo para mirar: otras tablas con columna CueIdCuenta que este script NO toca (copias, respaldos)
SELECT t.name AS TablaNoTocada, CASE WHEN c.is_identity = 1 THEN 'sí' ELSE 'no' END AS EsIdentity
FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
WHERE c.name = 'CueIdCuenta' AND t.name NOT IN ('CuentasCliente', 'MovimientosCuenta', 'DeudaDocumento', 'ImputacionPago',
      'ColaEstadosCuenta', 'CiclosCredito', 'DocumentosContables', 'PlanesMetros', 'BeneficiosCliente', 'CuentasClienteArticulosPermitidos');

COMMIT;
PRINT CONCAT('Listo: la cuenta 0 ahora es la ', @Nuevo, '.');
