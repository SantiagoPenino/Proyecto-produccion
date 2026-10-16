USE [SecureAppDB2205];
GO

-- ============================================================================

-- 4. CREACIÓN Y ACTUALIZACIÓN DE STORED PROCEDURES
-- ============================================================================


IF OBJECT_ID('dbo.[sp_GetDetalleOrdenControl]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetDetalleOrdenControl];
GO
CREATE PROCEDURE [dbo].[sp_GetDetalleOrdenControl] @OrdenID INT AS
BEGIN
    SET NOCOUNT ON;
    SELECT ArchivoID, OrdenID, NombreArchivo, EstadoArchivo AS EstadoControl, Observaciones, CodigoArticulo AS SKU, UsuarioControl, Ancho, Alto, Copias FROM [dbo].[ArchivosOrden] WHERE OrdenID = @OrdenID;
END
GO

IF OBJECT_ID('dbo.[sp_GetProductionBoard]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GetProductionBoard];
GO
CREATE PROCEDURE dbo.sp_GetProductionBoard @Area VARCHAR(50) AS
BEGIN
    SET NOCOUNT ON;
    SELECT EquipoID AS id, Nombre AS name, EstadoProceso AS status FROM dbo.ConfigEquipos WHERE AreaID = @Area AND Activo = 1;
    SELECT RolloID AS id, RolloID AS rollCode, Nombre AS name, Estado AS status, MaquinaID AS machineId, ISNULL(MetrosTotales, 0) AS usage, ISNULL(CapacidadMaxima, 0) AS capacity, ColorHex AS color, ISNULL(TotalOrdenes, 0) AS ordersCount FROM dbo.Rollos WHERE AreaID = @Area AND Estado NOT IN ('Cerrado', 'Finalizado');
END;
GO

IF OBJECT_ID('dbo.[sp_GenerarCRUD_Faltantes_ULTRA]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GenerarCRUD_Faltantes_ULTRA];
GO
CREATE PROCEDURE dbo.sp_GenerarCRUD_Faltantes_ULTRA @SchemaName sysname = N'dbo', @Prefix sysname = N'sp' AS
BEGIN
    SET NOCOUNT ON;
    SELECT 'OK' AS Result, 'CRUD ULTRA Generador.' AS Message;
END
GO

IF OBJECT_ID('dbo.[sp_GenerarCRUD_Faltantes_PROFIX]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GenerarCRUD_Faltantes_PROFIX];
GO
CREATE PROCEDURE dbo.sp_GenerarCRUD_Faltantes_PROFIX @SchemaName sysname = N'dbo', @Prefix sysname = N'sp' AS
BEGIN
    SET NOCOUNT ON;
    SELECT 'OK' AS Result, 'CRUD PROFIX Generador.' AS Message;
END;
GO

IF OBJECT_ID('dbo.[sp_CalcularFechaEntrega]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_CalcularFechaEntrega];
GO
CREATE PROCEDURE [dbo].[sp_CalcularFechaEntrega] @OrdenID INT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @AreaID VARCHAR(20), @Prioridad VARCHAR(20), @FechaBase DATETIME, @FechaInicioCalculo DATETIME;
    DECLARE @DiasASumar INT = 0, @HorasASumar INT = 0, @HoraCorteStr VARCHAR(50), @HoraCorteInt INT, @FechaCalculada DATETIME, @DiasContados INT = 0;

    SELECT @AreaID = AreaID, @Prioridad = Prioridad, @FechaBase = ISNULL(FechaIngreso, GETDATE()) FROM dbo.Ordenes WHERE OrdenID = @OrdenID;

    SELECT TOP 1 @HoraCorteStr = Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'CORTEURGENTE' AND (AreaID = @AreaID OR AreaID = 'ADMIN') ORDER BY CASE WHEN AreaID = @AreaID THEN 1 ELSE 2 END ASC;

    SET @HoraCorteStr = ISNULL(@HoraCorteStr, '12:00');
    IF CHARINDEX(':', @HoraCorteStr) > 0 SET @HoraCorteInt = CAST(SUBSTRING(@HoraCorteStr, 1, CHARINDEX(':', @HoraCorteStr) - 1) AS INT); ELSE SET @HoraCorteInt = TRY_CAST(@HoraCorteStr AS INT);
    SET @HoraCorteInt = ISNULL(@HoraCorteInt, 12);

    IF DATEPART(HOUR, @FechaBase) >= @HoraCorteInt SET @FechaInicioCalculo = CAST(DATEADD(DAY, 1, @FechaBase) AS DATE); ELSE SET @FechaInicioCalculo = CAST(@FechaBase AS DATE);

    SELECT TOP 1 @DiasASumar = Dias, @HorasASumar = Horas FROM dbo.ConfiguracionTiemposEntrega WHERE AreaID = @AreaID AND Prioridad = @Prioridad;
    IF @@ROWCOUNT = 0 BEGIN IF @Prioridad = 'Urgente' SET @HorasASumar = 24; ELSE SET @DiasASumar = 3; END
    IF @DiasASumar = 0 AND @HorasASumar > 0 SET @DiasASumar = CEILING(@HorasASumar / 24.0);

    SET @FechaCalculada = @FechaInicioCalculo;
    WHILE @DiasContados < @DiasASumar BEGIN
        SET @FechaCalculada = DATEADD(DAY, 1, @FechaCalculada);
        DECLARE @DiaSemana INT = (DATEPART(dw, @FechaCalculada) + @@DATEFIRST - 1) % 7 + 1;
        WHILE @DiaSemana IN (1, 7) OR EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = CAST(@FechaCalculada AS DATE)) BEGIN
             SET @FechaCalculada = DATEADD(DAY, 1, @FechaCalculada);
             SET @DiaSemana = (DATEPART(dw, @FechaCalculada) + @@DATEFIRST - 1) % 7 + 1;
        END
        SET @DiasContados = @DiasContados + 1;
    END

    UPDATE dbo.Ordenes SET FechaEstimadaEntrega = @FechaCalculada WHERE OrdenID = @OrdenID;
    SELECT @FechaCalculada AS NuevaFechaEntrega;
END
GO

IF OBJECT_ID('dbo.[sp_PredecirProximoServicio]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_PredecirProximoServicio];
GO
CREATE PROCEDURE [dbo].[sp_PredecirProximoServicio] @OrdenID INT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NoDocERP VARCHAR(50), @CodigoOrden VARCHAR(100), @SecuenciaActual INT, @TotalPasos INT, @ProximoServicio VARCHAR(100);
    SELECT @NoDocERP = NoDocERP, @CodigoOrden = CodigoOrden FROM dbo.Ordenes WHERE OrdenID = @OrdenID;

    BEGIN TRY
        IF CHARINDEX('(', @CodigoOrden) > 0 AND CHARINDEX(')', @CodigoOrden) > 0 BEGIN
            DECLARE @ParentesisContent VARCHAR(20) = SUBSTRING(@CodigoOrden, CHARINDEX('(', @CodigoOrden) + 1, CHARINDEX(')', @CodigoOrden) - CHARINDEX('(', @CodigoOrden) - 1);
            SET @SecuenciaActual = CAST(LEFT(@ParentesisContent, CHARINDEX('/', @ParentesisContent) - 1) AS INT);
            SET @TotalPasos = CAST(SUBSTRING(@ParentesisContent, CHARINDEX('/', @ParentesisContent) + 1, LEN(@ParentesisContent)) AS INT);
        END
    END TRY
    BEGIN CATCH SET @SecuenciaActual = 1; SET @TotalPasos = 1; END CATCH

    IF @SecuenciaActual < @TotalPasos BEGIN
        DECLARE @SiguienteSecuencia INT = @SecuenciaActual + 1;
        DECLARE @SufijoBuscado VARCHAR(20) = '(' + CAST(@SiguienteSecuencia AS VARCHAR) + '/' + CAST(@TotalPasos AS VARCHAR) + ')';
        SELECT TOP 1 @ProximoServicio = AreaID FROM dbo.Ordenes WHERE NoDocERP = @NoDocERP AND CodigoOrden LIKE '%' + @SufijoBuscado AND OrdenID <> @OrdenID;
    END

    IF @ProximoServicio IS NULL OR @ProximoServicio = '' SET @ProximoServicio = 'DEPOSITO';
    UPDATE dbo.Ordenes SET ProximoServicio = @ProximoServicio WHERE OrdenID = @OrdenID;
    SELECT @ProximoServicio AS Prediccion;
END
GO

IF OBJECT_ID('dbo.[sp_GenerarCRUD_Faltantes_PROFIX2]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_GenerarCRUD_Faltantes_PROFIX2];
GO
CREATE PROCEDURE dbo.sp_GenerarCRUD_Faltantes_PROFIX2 @SchemaName sysname = N'dbo', @Prefix sysname = N'sp' AS
BEGIN
    SET NOCOUNT ON; SELECT 'OK' AS Result, 'CRUD PROFIX2 generado.' AS Message;
END;
GO

IF OBJECT_ID('dbo.[sp_ArchivosOrden_Obtener]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ArchivosOrden_Obtener];
GO
CREATE PROCEDURE [dbo].[sp_ArchivosOrden_Obtener] @ArchivoID int, @UserID int = NULL, @IPAddress nvarchar(50) = NULL AS
BEGIN
    SET NOCOUNT ON; SELECT * FROM [dbo].[ArchivosOrden] WHERE [ArchivoID] = @ArchivoID;
END
GO

IF OBJECT_ID('dbo.[sp_ArchivosOrden_Listar]', 'P') IS NOT NULL DROP PROCEDURE dbo.[sp_ArchivosOrden_Listar];
GO
CREATE PROCEDURE [dbo].[sp_ArchivosOrden_Listar] @Page int = 1, @PageSize int = 50, @UserID int = NULL, @IPAddress nvarchar(50) = NULL AS
BEGIN
    SET NOCOUNT ON; IF @Page < 1 SET @Page = 1; IF @PageSize < 1 SET @PageSize = 50;
    DECLARE @Offset int = (@Page - 1) * @PageSize;
    SELECT * FROM [dbo].[ArchivosOrden] ORDER BY [ArchivoID] ASC OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
    SELECT COUNT(1) AS TotalRows FROM [dbo].[ArchivosOrden];
END
GO

IF OBJECT_ID('dbo.SP_AbrirSesionCaja', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_AbrirSesionCaja;
GO
CREATE PROCEDURE dbo.SP_AbrirSesionCaja @UsuarioId INT, @MontoInicial DECIMAL(18,2) = 0 AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.SesionesTurno WITH(NOLOCK) WHERE StuEstado = 'ABIERTA' AND CAST(StuFechaApertura AS DATE) = CAST(GETDATE() AS DATE)) BEGIN
        RAISERROR('Ya existe una sesion de caja ABIERTA hoy. Cierrela antes de abrir una nueva.', 16, 1); RETURN;
    END
    INSERT INTO dbo.SesionesTurno (StuUsuarioAbre, StuMontoInicial, StuEstado) VALUES (@UsuarioId, @MontoInicial, 'ABIERTA');
    SELECT SCOPE_IDENTITY() AS StuIdSesion, GETDATE() AS FechaApertura;
END
GO

IF OBJECT_ID('dbo.SP_CerrarSesionCaja', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_CerrarSesionCaja;
GO
CREATE PROCEDURE dbo.SP_CerrarSesionCaja @StuIdSesion INT, @UsuarioId INT, @MontoFinal DECIMAL(18,2), @Observaciones NVARCHAR(500) = NULL AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalCobros DECIMAL(18,2), @TotalEgresos DECIMAL(18,2), @MontoSistema DECIMAL(18,2), @Diferencia DECIMAL(18,2);
    SELECT @TotalCobros = ISNULL(SUM(TcaTotalNeto), 0) FROM dbo.TransaccionesCaja WHERE StuIdSesion = @StuIdSesion AND TcaEstado = 'COMPLETADO';
    SELECT @TotalEgresos = ISNULL(SUM(EgrMonto), 0) FROM dbo.EgresosCaja WHERE StuIdSesion = @StuIdSesion AND EgrEstado = 'REGISTRADO';

    SET @MontoSistema = (SELECT ISNULL(StuMontoInicial,0) FROM dbo.SesionesTurno WHERE StuIdSesion = @StuIdSesion) + @TotalCobros - @TotalEgresos;
    SET @Diferencia   = @MontoFinal - @MontoSistema;

    DECLARE @NuevoEstado VARCHAR(30) = CASE WHEN ABS(@Diferencia) < 1 THEN 'CERRADA' ELSE 'CERRADA_CON_DIFERENCIA' END;
    UPDATE dbo.SesionesTurno SET StuFechaCierre = GETDATE(), StuUsuarioCierra = @UsuarioId, StuMontoFinal = @MontoFinal, StuMontoSistema = @MontoSistema, StuDiferencia = @Diferencia, StuEstado = @NuevoEstado, StuObservaciones = @Observaciones WHERE StuIdSesion = @StuIdSesion AND StuEstado = 'ABIERTA';

    IF @@ROWCOUNT = 0 BEGIN RAISERROR('No se encontro sesion ABIERTA con ID %d.', 16, 1, @StuIdSesion); RETURN; END
    SELECT @StuIdSesion AS StuIdSesion, @TotalCobros AS TotalCobros, @TotalEgresos AS TotalEgresos, @MontoSistema AS MontoSistema, @MontoFinal AS MontoFinal, @Diferencia AS Diferencia, @NuevoEstado AS EstadoFinal;
END
GO

IF OBJECT_ID('dbo.SP_ImputarPagoPEPS', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_ImputarPagoPEPS;
GO
CREATE PROCEDURE dbo.SP_ImputarPagoPEPS @PagIdPago INT, @MontoDisponible DECIMAL(18,4), @CueIdCuenta INT, @UsuarioAlta INT, @MontoExcedente DECIMAL(18,4) = NULL OUTPUT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @DDeIdDocumento INT, @DDeImportePendiente DECIMAL(18,4), @Aplicar DECIMAL(18,4), @Restante DECIMAL(18,4) = @MontoDisponible;

    BEGIN TRY
        BEGIN TRANSACTION;
            DECLARE cur_deudas CURSOR FOR SELECT DDeIdDocumento, DDeImportePendiente FROM dbo.DeudaDocumento WHERE CueIdCuenta = @CueIdCuenta AND DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL') ORDER BY DDeFechaVencimiento ASC, DDeIdDocumento ASC;
            OPEN cur_deudas; FETCH NEXT FROM cur_deudas INTO @DDeIdDocumento, @DDeImportePendiente;
            WHILE @@FETCH_STATUS = 0 AND @Restante > 0 BEGIN
                SET @Aplicar = CASE WHEN @Restante >= @DDeImportePendiente THEN @DDeImportePendiente ELSE @Restante END;
                INSERT INTO dbo.ImputacionPago (PagIdPago, DDeIdDocumento, CueIdCuenta, ImpImporte, ImpFecha, ImpUsuarioAlta) VALUES (@PagIdPago, @DDeIdDocumento, @CueIdCuenta, @Aplicar, GETDATE(), @UsuarioAlta);
                UPDATE dbo.DeudaDocumento SET DDeImportePendiente = DDeImportePendiente - @Aplicar, DDeEstado = CASE WHEN DDeImportePendiente - @Aplicar = 0 THEN 'COBRADO' ELSE 'PARCIAL' END, DDeFechaCobro = CASE WHEN DDeImportePendiente - @Aplicar = 0 THEN GETDATE() ELSE NULL END WHERE DDeIdDocumento = @DDeIdDocumento;
                SET @Restante = @Restante - @Aplicar;
                FETCH NEXT FROM cur_deudas INTO @DDeIdDocumento, @DDeImportePendiente;
            END;
            CLOSE cur_deudas; DEALLOCATE cur_deudas;
            SET @MontoExcedente = @Restante;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        IF CURSOR_STATUS('global','cur_deudas') >= -1 OR CURSOR_STATUS('local','cur_deudas') >= -1 BEGIN CLOSE cur_deudas; DEALLOCATE cur_deudas; END;
        THROW;
    END CATCH;
END;
GO

IF OBJECT_ID('dbo.SP_RegistrarMovimiento', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_RegistrarMovimiento;
GO
CREATE PROCEDURE dbo.SP_RegistrarMovimiento @CueIdCuenta INT, @MovTipo VARCHAR(30), @MovConcepto NVARCHAR(500), @MovImporte DECIMAL(18,4), @MovUsuarioAlta INT, @OrdIdOrden INT = NULL, @OReIdOrdenRetiro INT = NULL, @PagIdPago INT = NULL, @DocIdDocumento INT = NULL, @MovRefExterna VARCHAR(100) = NULL, @MovObservaciones NVARCHAR(500) = NULL, @CicIdCiclo INT = NULL, @MovFecha DATETIME = NULL, @MovIdGenerado INT = NULL OUTPUT, @SaldoResultante DECIMAL(18,4) = NULL OUTPUT AS
BEGIN
    SET NOCOUNT ON; DECLARE @NuevoSaldo DECIMAL(18,4);
    BEGIN TRY
        BEGIN TRANSACTION;
            UPDATE dbo.CuentasCliente WITH (UPDLOCK) SET CueSaldoActual = CueSaldoActual + @MovImporte WHERE CueIdCuenta = @CueIdCuenta;
            SELECT @NuevoSaldo = CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueIdCuenta;
            INSERT INTO dbo.MovimientosCuenta (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, OrdIdOrden, OReIdOrdenRetiro, PagIdPago, DocIdDocumento, MovRefExterna, MovFecha, MovUsuarioAlta, MovObservaciones, CicIdCiclo) VALUES (@CueIdCuenta, @MovTipo, @MovConcepto, @MovImporte, @NuevoSaldo, @OrdIdOrden, @OReIdOrdenRetiro, @PagIdPago, @DocIdDocumento, @MovRefExterna, ISNULL(@MovFecha, GETDATE()), @MovUsuarioAlta, @MovObservaciones, @CicIdCiclo);
            SET @MovIdGenerado = SCOPE_IDENTITY(); SET @SaldoResultante = @NuevoSaldo;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW;
    END CATCH;
END;
GO

IF OBJECT_ID('dbo.SP_SiguienteNumeroDoc', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_SiguienteNumeroDoc;
GO
CREATE PROCEDURE dbo.SP_SiguienteNumeroDoc @TipoDoc VARCHAR(20), @Serie VARCHAR(5) = 'A' AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @SecIdSecuencia INT, @SecDigitos INT, @SecPrefijo VARCHAR(10), @SecActivo BIT, @NuevoNumero INT, @NumFormato VARCHAR(30);

    SELECT @SecIdSecuencia = SecIdSecuencia, @SecDigitos = SecDigitos, @SecPrefijo = SecPrefijo, @SecActivo = SecActivo FROM dbo.SecuenciaDocumentos WITH(NOLOCK) WHERE SecTipoDoc = @TipoDoc AND SecSerie = @Serie;
    IF @SecIdSecuencia IS NULL BEGIN RAISERROR('No existe secuencia para TipoDoc="%s" Serie="%s".', 16, 1, @TipoDoc, @Serie); RETURN; END
    IF @SecActivo = 0 BEGIN RAISERROR('La secuencia TipoDoc="%s" Serie="%s" esta inactiva.', 16, 1, @TipoDoc, @Serie); RETURN; END

    UPDATE dbo.SecuenciaDocumentos WITH(UPDLOCK, ROWLOCK) SET SecUltimoNumero = SecUltimoNumero + 1 WHERE SecIdSecuencia  = @SecIdSecuencia;
    SELECT @NuevoNumero = SecUltimoNumero FROM dbo.SecuenciaDocumentos WITH(NOLOCK) WHERE SecIdSecuencia = @SecIdSecuencia;
    SET @NumFormato = ISNULL(@SecPrefijo, '') + RIGHT(REPLICATE('0', @SecDigitos) + CAST(@NuevoNumero AS VARCHAR(10)), @SecDigitos);
    SELECT @NuevoNumero AS NumeroEntero, @NumFormato AS NumeroFormato, @TipoDoc AS TipoDoc, @Serie AS Serie, ISNULL(@SecPrefijo, '') AS Prefijo;
END
GO

PRINT '=========================================================';
PRINT '== MIGRACION ESTRUCTURAL Y SPs COMPLETADA CON EXITO    ==';
PRINT '=========================================================';
GO