-- ============================================================================
-- SCRIPT DE CORRECCIONES PARA BASE DE DATOS DE PRODUCCIÓN (SecureAppDB)
-- Fecha:    2026-05-22
-- Objetivo: Actualizar procedimientos almacenados para corregir:
--           1. Error de sintaxis en sp_GenerarCRUD_Faltantes_PROFIX2.
--           2. Inserción con valor NULL en MovAnulado en SP_RegistrarMovimiento.
-- ============================================================================

USE [SecureAppDB];
GO

SET NOCOUNT ON;

PRINT '================================================================';
PRINT ' Aplicando correcciones en SecureAppDB';
PRINT '================================================================';
GO

-- ============================================================================
-- 1. sp_GenerarCRUD_Faltantes_PROFIX2
-- ============================================================================
PRINT '>>> Actualizando [dbo].[sp_GenerarCRUD_Faltantes_PROFIX2]...';
GO

IF OBJECT_ID('dbo.[sp_GenerarCRUD_Faltantes_PROFIX2]', 'P') IS NOT NULL 
    DROP PROCEDURE dbo.[sp_GenerarCRUD_Faltantes_PROFIX2];
GO

CREATE PROCEDURE dbo.sp_GenerarCRUD_Faltantes_PROFIX2
    @SchemaName sysname = N'dbo',
    @Prefix     sysname = N'sp'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @HasAuditTable bit = CASE WHEN OBJECT_ID(QUOTENAME(@SchemaName)+'.[Auditoria]', 'U') IS NOT NULL THEN 1 ELSE 0 END;
    DECLARE @HasAuditSP    bit = CASE WHEN OBJECT_ID(QUOTENAME(@SchemaName)+'.[sp_RegistrarAccion]', 'P') IS NOT NULL THEN 1 ELSE 0 END;

    DECLARE @ObjId int, @TableName sysname, @FullTable nvarchar(300), @ProcName nvarchar(300), @Sql nvarchar(max);

    DECLARE tbl CURSOR FAST_FORWARD FOR
        SELECT t.object_id, t.name
        FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = @SchemaName AND t.is_ms_shipped = 0
        ORDER BY t.name;

    OPEN tbl;
    FETCH NEXT FROM tbl INTO @ObjId, @TableName;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @FullTable = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName);

        /* =========================
           PK columns (por object_id)
           ========================= */
        DECLARE @PkCols TABLE (
            Ord int NOT NULL,
            ColName sysname NOT NULL,
            TypeName sysname NOT NULL,
            MaxLen smallint NULL,
            Precision tinyint NULL,
            Scale tinyint NULL,
            IsNullable bit NOT NULL
        );

        INSERT INTO @PkCols (Ord, ColName, TypeName, MaxLen, Precision, Scale, IsNullable)
        SELECT
            ic.key_ordinal,
            c.name,
            ty.name,
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable
        FROM sys.key_constraints kc
        JOIN sys.index_columns ic
            ON ic.object_id = kc.parent_object_id
           AND ic.index_id  = kc.unique_index_id
        JOIN sys.columns c
            ON c.object_id = ic.object_id
           AND c.column_id = ic.column_id
        JOIN sys.types ty
            ON ty.user_type_id = c.user_type_id
        WHERE kc.parent_object_id = @ObjId
          AND kc.[type] = 'PK'
        ORDER BY ic.key_ordinal;

        IF NOT EXISTS (SELECT 1 FROM @PkCols)
        BEGIN
            FETCH NEXT FROM tbl INTO @ObjId, @TableName;
            CONTINUE;
        END

        /* =========================
           All columns
           ========================= */
        DECLARE @Cols TABLE(
            ColId int NOT NULL,
            ColName sysname NOT NULL,
            TypeName sysname NOT NULL,
            MaxLen smallint NULL,
            Precision tinyint NULL,
            Scale tinyint NULL,
            IsNullable bit NOT NULL,
            IsIdentity bit NOT NULL,
            IsComputed bit NOT NULL,
            IsPk bit NOT NULL
        );

        INSERT INTO @Cols
        SELECT
            c.column_id,
            c.name,
            ty.name,
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable,
            c.is_identity,
            c.is_computed,
            CASE WHEN EXISTS (SELECT 1 FROM @PkCols pk WHERE pk.ColName = c.name) THEN 1 ELSE 0 END
        FROM sys.columns c
        JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE c.object_id = @ObjId
        ORDER BY c.column_id;

        /* Soft delete */
        DECLARE @SoftDeleteCol sysname = NULL;
        SELECT TOP 1 @SoftDeleteCol = ColName
        FROM @Cols
        WHERE TypeName='bit' AND ColName IN (N'IsDeleted', N'Eliminado', N'Anulado', N'Deleted', N'Activo')
        ORDER BY CASE ColName
            WHEN N'IsDeleted' THEN 1 WHEN N'Eliminado' THEN 2 WHEN N'Anulado' THEN 3 WHEN N'Deleted' THEN 4 WHEN N'Activo' THEN 5 ELSE 99 END;

        /* =========================
           Helpers builders
           ========================= */
        DECLARE @AuditParamsCreate nvarchar(max) = N'@UserID int = NULL, @IPAddress nvarchar(50) = NULL';
        DECLARE @AuditParamsAppend nvarchar(max) = N', @UserID int = NULL, @IPAddress nvarchar(50) = NULL';

        DECLARE @PkParams nvarchar(max) = N'';
        SELECT @PkParams =
            STUFF((
                SELECT
                    N', @' + p.ColName + N' ' +
                    CASE
                        WHEN p.TypeName IN ('varchar','char','nvarchar','nchar','binary','varbinary') THEN
                            p.TypeName + N'(' +
                            CASE
                                WHEN p.MaxLen = -1 THEN N'max'
                                WHEN p.TypeName IN ('nvarchar','nchar') THEN CAST(p.MaxLen/2 AS nvarchar(10))
                                ELSE CAST(p.MaxLen AS nvarchar(10))
                            END + N')'
                        WHEN p.TypeName IN ('decimal','numeric') THEN
                            p.TypeName + N'(' + CAST(p.Precision AS nvarchar(10)) + N',' + CAST(p.Scale AS nvarchar(10)) + N')'
                        WHEN p.TypeName IN ('datetime2','time','datetimeoffset') THEN
                            p.TypeName + N'(' + CAST(p.Scale AS nvarchar(10)) + N')'
                        ELSE p.TypeName
                    END
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @PkWhere nvarchar(max) = N'';
        SELECT @PkWhere =
            STUFF((
                SELECT N' AND ' + QUOTENAME(p.ColName) + N' = @' + p.ColName
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 5, N'');

        DECLARE @PkOrderBy nvarchar(max) = N'';
        SELECT @PkOrderBy =
            STUFF((
                SELECT N', ' + QUOTENAME(p.ColName) + N' ASC'
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @PkReturnSelect nvarchar(max) = N'';
        SELECT @PkReturnSelect =
            STUFF((
                SELECT N', ' + QUOTENAME(p.ColName) + N' AS ' + QUOTENAME(p.ColName)
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        /* PK detail con CONCAT (robusto) - CORREGIDO: quitada la comilla de escape extra al final de N''; '' */
        DECLARE @PkDetailArgs nvarchar(max) = N'';
        SELECT @PkDetailArgs =
            STUFF((
                SELECT
                    N', N''' + p.ColName + N'='', CONVERT(nvarchar(4000), @' + p.ColName + N'), N''; '
                FROM @PkCols p
                ORDER BY p.Ord
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @PkDetailExpr nvarchar(max) =
            N'CONCAT(N''' + REPLACE(@TableName,'''','''''') + N' PK: '', ' + @PkDetailArgs + N')';

        /* Params de todas las cols */
        DECLARE @AllParams nvarchar(max) = N'';
        SELECT @AllParams =
            STUFF((
                SELECT
                    N', @' + ColName + N' ' +
                    CASE
                        WHEN TypeName IN ('varchar','char','nvarchar','nchar','binary','varbinary') THEN
                            TypeName + N'(' +
                            CASE
                                WHEN MaxLen = -1 THEN N'max'
                                WHEN TypeName IN ('nvarchar','nchar') THEN CAST(MaxLen/2 AS nvarchar(10))
                                ELSE CAST(MaxLen AS nvarchar(10))
                            END + N')'
                        WHEN TypeName IN ('decimal','numeric') THEN
                            TypeName + N'(' + CAST([Precision] AS nvarchar(10)) + N',' + CAST([Scale] AS nvarchar(10)) + N')'
                        WHEN TypeName IN ('datetime2','time','datetimeoffset') THEN
                            TypeName + N'(' + CAST([Scale] AS nvarchar(10)) + N')'
                        ELSE TypeName
                    END +
                    CASE WHEN IsNullable = 1 THEN N' = NULL' ELSE N'' END
                FROM @Cols
                WHERE IsComputed = 0
                ORDER BY ColId
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @InsertCols nvarchar(max) = N'';
        DECLARE @InsertVals nvarchar(max) = N'';
        DECLARE @UpdateSet  nvarchar(max) = N'';
        DECLARE @PatchSet   nvarchar(max) = N'';

        SELECT
            @InsertCols =
                STUFF((
                    SELECT N', ' + QUOTENAME(ColName)
                    FROM @Cols
                    WHERE IsComputed=0 AND IsIdentity=0
                    ORDER BY ColId
                    FOR XML PATH(''), TYPE
                ).value('.', 'nvarchar(max)'), 1, 2, N''),
            @InsertVals =
                STUFF((
                    SELECT N', @' + ColName
                    FROM @Cols
                    WHERE IsComputed=0 AND IsIdentity=0
                    ORDER BY ColId
                    FOR XML PATH(''), TYPE
                ).value('.', 'nvarchar(max)'), 1, 2, N'');

        SELECT @UpdateSet =
            STUFF((
                SELECT N', ' + QUOTENAME(ColName) + N' = @' + ColName
                FROM @Cols
                WHERE IsComputed=0 AND IsIdentity=0 AND IsPk=0
                ORDER BY ColId
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        SELECT @PatchSet =
            STUFF((
                SELECT N', ' + QUOTENAME(ColName) + N' = COALESCE(@' + ColName + N', ' + QUOTENAME(ColName) + N')'
                FROM @Cols
                WHERE IsComputed=0 AND IsIdentity=0 AND IsPk=0
                ORDER BY ColId
                FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');

        DECLARE @HasIdentity bit = CASE WHEN EXISTS (SELECT 1 FROM @Cols WHERE IsIdentity=1) THEN 1 ELSE 0 END;
        DECLARE @IdentityCol sysname = (SELECT TOP 1 ColName FROM @Cols WHERE IsIdentity=1 ORDER BY ColId);

        DECLARE @ListWhere nvarchar(max) = N'';
        IF @SoftDeleteCol IS NOT NULL
        BEGIN
            IF @SoftDeleteCol = N'Activo' SET @ListWhere = N'WHERE [Activo] = 1';
            ELSE SET @ListWhere = N'WHERE ' + QUOTENAME(@SoftDeleteCol) + N' = 0';
        END

        /* Audit snippets */
        DECLARE @AuditCreate nvarchar(max) = N'';
        DECLARE @AuditUpdate nvarchar(max) = N'';
        DECLARE @AuditDelete nvarchar(max) = N'';

        IF @HasAuditSP = 1
        BEGIN
            SET @AuditCreate = N'
        EXEC ' + QUOTENAME(@SchemaName) + N'.[sp_RegistrarAccion]
            @UserID=@UserID,
            @Action=N''CREATE_' + @TableName + N''',
            @Details=' + @PkDetailExpr + N',
            @IPAddress=@IPAddress;';
            SET @AuditUpdate = N'
        EXEC ' + QUOTENAME(@SchemaName) + N'.[sp_RegistrarAccion]
            @UserID=@UserID,
            @Action=N''UPDATE_' + @TableName + N''',
            @Details=' + @PkDetailExpr + N',
            @IPAddress=@IPAddress;';
            SET @AuditDelete = N'
        EXEC ' + QUOTENAME(@SchemaName) + N'.[sp_RegistrarAccion]
            @UserID=@UserID,
            @Action=N''DELETE_' + @TableName + N''',
            @Details=' + @PkDetailExpr + N',
            @IPAddress=@IPAddress;';
        END
        ELSE IF @HasAuditTable = 1
        BEGIN
            SET @AuditCreate = N'
        INSERT INTO ' + QUOTENAME(@SchemaName) + N'.[Auditoria](IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
        VALUES (@UserID, N''CREATE_' + @TableName + N''', ' + @PkDetailExpr + N', @IPAddress, GETDATE());';
            SET @AuditUpdate = N'
        INSERT INTO ' + QUOTENAME(@SchemaName) + N'.[Auditoria](IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
        VALUES (@UserID, N''UPDATE_' + @TableName + N''', ' + @PkDetailExpr + N', @IPAddress, GETDATE());';
            SET @AuditDelete = N'
        INSERT INTO ' + QUOTENAME(@SchemaName) + N'.[Auditoria](IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
        VALUES (@UserID, N''DELETE_' + @TableName + N''', ' + @PkDetailExpr + N', @IPAddress, GETDATE());';
        END

        /* Error pattern seguro */
        DECLARE @CatchBlock nvarchar(max) = N'
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @Err nvarchar(4000) = ERROR_MESSAGE();
        RAISERROR(@Err, 16, 1);
        RETURN;
    END CATCH';

        /* =========================
           CREAR
           ========================= */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Crear');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO ' + @FullTable + N' (' + @InsertCols + N')
        VALUES (' + @InsertVals + N');

        DECLARE @NewIdentity bigint = NULL;
        ' + CASE WHEN @HasIdentity=1 THEN N'SET @NewIdentity = CAST(SCOPE_IDENTITY() AS bigint);' ELSE N'' END + N'

        IF @NewIdentity IS NOT NULL
        BEGIN
            SELECT ' + @PkReturnSelect + N'
            FROM ' + @FullTable + N'
            WHERE ' + QUOTENAME(@IdentityCol) + N' = @NewIdentity;
        END
        ELSE
        BEGIN
            SELECT ' + @PkReturnSelect + N';
        END
' + @AuditCreate + N'
        COMMIT TRAN;
    END TRY' + @CatchBlock + N'
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* OBTENER */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Obtener');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @PkParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM ' + @FullTable + N' WHERE ' + @PkWhere + N';
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* LISTAR */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Listar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
    @Page int = 1,
    @PageSize int = 50
,   @UserID int = NULL,
    @IPAddress nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @Page < 1 SET @Page = 1;
    IF @PageSize < 1 SET @PageSize = 50;

    DECLARE @Offset int = (@Page - 1) * @PageSize;

    SELECT *
    FROM ' + @FullTable + N'
    ' + @ListWhere + N'
    ORDER BY ' + @PkOrderBy + N'
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT COUNT(1) AS TotalRows
    FROM ' + @FullTable + N'
    ' + @ListWhere + N';
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* ACTUALIZAR */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Actualizar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        UPDATE ' + @FullTable + N'
        SET ' + @UpdateSet + N'
        WHERE ' + @PkWhere + N';

        DECLARE @Rows int = @@ROWCOUNT;
        IF @Rows > 0 BEGIN ' + @AuditUpdate + N' END

        COMMIT TRAN;
        SELECT @Rows AS RowsAffected;
    END TRY' + @CatchBlock + N'
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* PATCH */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Patch');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AllParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        UPDATE ' + @FullTable + N'
        SET ' + @PatchSet + N'
        WHERE ' + @PkWhere + N';

        DECLARE @Rows int = @@ROWCOUNT;
        IF @Rows > 0 BEGIN ' + @AuditUpdate + N' END

        COMMIT TRAN;
        SELECT @Rows AS RowsAffected;
    END TRY' + @CatchBlock + N'
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* ELIMINAR */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Eliminar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            DECLARE @DeleteBody nvarchar(max);
            IF @SoftDeleteCol IS NOT NULL
            BEGIN
                IF @SoftDeleteCol = N'Activo'
                    SET @DeleteBody = N'UPDATE ' + @FullTable + N' SET [Activo] = 0 WHERE ' + @PkWhere + N';';
                ELSE
                    SET @DeleteBody = N'UPDATE ' + @FullTable + N' SET ' + QUOTENAME(@SoftDeleteCol) + N' = 1 WHERE ' + @PkWhere + N';';
            END
            ELSE
                SET @DeleteBody = N'DELETE FROM ' + @FullTable + N' WHERE ' + @PkWhere + N';';

            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @PkParams + @AuditParamsAppend + N'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;

        ' + @DeleteBody + N'

        DECLARE @Rows int = @@ROWCOUNT;
        IF @Rows > 0 BEGIN ' + @AuditDelete + N' END

        COMMIT TRAN;
        SELECT @Rows AS RowsAffected;
    END TRY' + @CatchBlock + N'
END
';
            EXEC sys.sp_executesql @Sql;
        END

        /* CONTAR (sin coma inicial) */
        SET @ProcName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@Prefix + N'_' + @TableName + N'_Contar');
        IF OBJECT_ID(@ProcName, 'P') IS NULL
        BEGIN
            SET @Sql = N'
CREATE PROCEDURE ' + @ProcName + N'
' + @AuditParamsCreate + N'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS TotalRows
    FROM ' + @FullTable + N'
    ' + @ListWhere + N';
END
';
            EXEC sys.sp_executesql @Sql;
        END

        FETCH NEXT FROM tbl INTO @ObjId, @TableName;
    END

    CLOSE tbl;
    DEALLOCATE tbl;

    SELECT 'OK' AS Result, 'CRUD PROFIX2 generado sin errores.' AS Message;
END
GO

PRINT '    ✅ sp_GenerarCRUD_Faltantes_PROFIX2 actualizado correctamente.';
GO

-- ============================================================================
-- 2. SP_RegistrarMovimiento
-- ============================================================================
PRINT '>>> Actualizando [dbo].[SP_RegistrarMovimiento]...';
GO

IF OBJECT_ID('dbo.[SP_RegistrarMovimiento]', 'P') IS NOT NULL 
    DROP PROCEDURE dbo.[SP_RegistrarMovimiento];
GO

CREATE PROCEDURE [dbo].[SP_RegistrarMovimiento]
    @CueIdCuenta        INT,
    @MovTipo            VARCHAR(30),
    @MovConcepto        NVARCHAR(500),
    @MovImporte         DECIMAL(18,4),
    @MovUsuarioAlta     INT,
    @OrdIdOrden         INT          = NULL,
    @OReIdOrdenRetiro   INT          = NULL,
    @PagIdPago          INT          = NULL,
    @DocIdDocumento     INT          = NULL,
    @MovRefExterna      VARCHAR(100) = NULL,
    @MovObservaciones   NVARCHAR(500)= NULL,
    @CicIdCiclo         INT          = NULL,
    @MovIdGenerado      INT          = NULL OUTPUT,
    @SaldoResultante    DECIMAL(18,4)= NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NuevoSaldo DECIMAL(18,4);
    BEGIN TRY
        BEGIN TRANSACTION;
            UPDATE [dbo].[CuentasCliente] WITH (UPDLOCK)
            SET    CueSaldoActual = CueSaldoActual + @MovImporte
            WHERE  CueIdCuenta = @CueIdCuenta;

            SELECT @NuevoSaldo = CueSaldoActual
            FROM   [dbo].[CuentasCliente]
            WHERE  CueIdCuenta = @CueIdCuenta;

            -- CORREGIDO: Se especifica explícitamente la columna MovAnulado con valor 0
            INSERT INTO [dbo].[MovimientosCuenta] (
                CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
                OrdIdOrden, OReIdOrdenRetiro, PagIdPago, DocIdDocumento,
                MovRefExterna, MovFecha, MovUsuarioAlta, MovObservaciones, CicIdCiclo, MovAnulado
            )
            VALUES (
                @CueIdCuenta, @MovTipo, @MovConcepto, @MovImporte, @NuevoSaldo,
                @OrdIdOrden, @OReIdOrdenRetiro, @PagIdPago, @DocIdDocumento,
                @MovRefExterna, GETDATE(), @MovUsuarioAlta, @MovObservaciones, @CicIdCiclo, 0
            );

            SET @MovIdGenerado   = SCOPE_IDENTITY();
            SET @SaldoResultante = @NuevoSaldo;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

PRINT '    ✅ SP_RegistrarMovimiento actualizado correctamente.';
GO

PRINT '================================================================';
PRINT ' ¡Todas las correcciones se aplicaron con éxito!';
PRINT '================================================================';
GO
