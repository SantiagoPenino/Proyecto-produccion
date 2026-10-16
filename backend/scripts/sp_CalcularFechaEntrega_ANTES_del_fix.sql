ALTER PROCEDURE -- 2) Fix del bug NULL + Horario Laboral en sp_CalcularFechaEntrega
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

    -- FIX: normalizar NULL antes de comparar. "NULL = 0" nunca es TRUE.
    SET @DiasASumar = ISNULL(@DiasASumar, 0);
    SET @HorasASumar = ISNULL(@HorasASumar, 0);

    IF @DiasASumar = 0 AND @HorasASumar > 0 SET @DiasASumar = CEILING(@HorasASumar / 24.0);

    -- Horario laboral real por área (ConfigHorarioLaboral). Si el área no tiene ninguna fila
    -- activa cargada, cae al comportamiento viejo (Lunes a Viernes fijo) para no romper nada.
    DECLARE @TieneHorario BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfigHorarioLaboral WHERE AreaID = @AreaID AND Activo = 1) THEN 1 ELSE 0 END;

    SET @FechaCalculada = @FechaInicioCalculo;
    WHILE @DiasContados < @DiasASumar BEGIN
        SET @FechaCalculada = DATEADD(DAY, 1, @FechaCalculada);
        DECLARE @DiaSemanaISO INT = ((DATEPART(WEEKDAY, @FechaCalculada) + @@DATEFIRST - 2) % 7) + 1; -- 1=Lunes..7=Domingo, independiente de @@DATEFIRST
        DECLARE @EsFeriado BIT, @EsLaborable BIT, @Intentos INT = 0;
        SET @EsFeriado = CASE WHEN EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = CAST(@FechaCalculada AS DATE)) THEN 1 ELSE 0 END;
        SET @EsLaborable = CASE
            WHEN @TieneHorario = 1 THEN CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfigHorarioLaboral WHERE AreaID = @AreaID AND DiaSemana = @DiaSemanaISO AND Activo = 1) THEN 1 ELSE 0 END
            ELSE CASE WHEN @DiaSemanaISO IN (6, 7) THEN 0 ELSE 1 END
        END;
        WHILE (@EsFeriado = 1 OR @EsLaborable = 0) AND @Intentos < 60 BEGIN
             SET @FechaCalculada = DATEADD(DAY, 1, @FechaCalculada);
             SET @DiaSemanaISO = ((DATEPART(WEEKDAY, @FechaCalculada) + @@DATEFIRST - 2) % 7) + 1;
             SET @EsFeriado = CASE WHEN EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = CAST(@FechaCalculada AS DATE)) THEN 1 ELSE 0 END;
             SET @EsLaborable = CASE
                 WHEN @TieneHorario = 1 THEN CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfigHorarioLaboral WHERE AreaID = @AreaID AND DiaSemana = @DiaSemanaISO AND Activo = 1) THEN 1 ELSE 0 END
                 ELSE CASE WHEN @DiaSemanaISO IN (6, 7) THEN 0 ELSE 1 END
             END;
             SET @Intentos = @Intentos + 1;
        END
        SET @DiasContados = @DiasContados + 1;
    END

    UPDATE dbo.Ordenes SET FechaEstimadaEntrega = @FechaCalculada WHERE OrdenID = @OrdenID;
    SELECT @FechaCalculada AS NuevaFechaEntrega;
END