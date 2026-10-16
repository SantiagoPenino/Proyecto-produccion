-- =============================================================================
-- Fix: sp_CalcularFechaEntrega no revisaba día hábil/feriado cuando el tiempo
-- de entrega del área es "mismo día" (solo Texto, sin Horas ni Días numéricos
-- en ConfiguracionTiemposEntrega) — la revisión de fin de semana y feriados
-- solo corría DENTRO del bucle que suma días completos, y ese bucle no se
-- ejecuta ni una vez cuando no hay ningún día entero para sumar.
--
-- Ejemplo real (DTF-20881, verificado antes de aplicar este script):
--   Ingresó viernes 4/9 12:09, Urgente "En el día" (corte 12:00 -> empuja a
--   sábado 5/9). Antes: quedaba prometida el sábado 5/9. Con este fix: lunes 7/9.
--
-- Alcance: solo agrega una revisión final de día hábil/feriado sobre la fecha
-- ya calculada. No cambia parámetros, no toca otras tablas, no reprocesa
-- órdenes existentes — rige desde la próxima vez que se calcule una fecha.
--
-- Antes de correr en PROD: guardar la definición actual por si hay que volver
-- atrás:
--   SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_CalcularFechaEntrega'));
-- =============================================================================
ALTER PROCEDURE [dbo].[sp_CalcularFechaEntrega] @OrdenID INT AS
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

    -- FIX previo: normalizar NULL antes de comparar. "NULL = 0" nunca es TRUE.
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

    -- ── NUEVO: ajuste final, corra o no el bucle de arriba ──────────────────────
    -- Cuando @DiasASumar = 0 (tiempo de entrega "mismo día", cargado solo como Texto
    -- en ConfiguracionTiemposEntrega, sin Horas ni Días numéricos) el WHILE de arriba
    -- nunca se ejecuta, así que @FechaCalculada nunca pasaba por la revisión de
    -- feriado/día hábil. Esta revisión corre siempre, al final, sobre la fecha que
    -- haya quedado calculada — si ya era hábil (caso normal con @DiasASumar >= 1,
    -- que el bucle de arriba ya validó), no hace nada.
    DECLARE @DiaSemanaISOFinal INT = ((DATEPART(WEEKDAY, @FechaCalculada) + @@DATEFIRST - 2) % 7) + 1;
    DECLARE @EsFeriadoFinal BIT, @EsLaborableFinal BIT, @IntentosFinal INT = 0;
    SET @EsFeriadoFinal = CASE WHEN EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = CAST(@FechaCalculada AS DATE)) THEN 1 ELSE 0 END;
    SET @EsLaborableFinal = CASE
        WHEN @TieneHorario = 1 THEN CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfigHorarioLaboral WHERE AreaID = @AreaID AND DiaSemana = @DiaSemanaISOFinal AND Activo = 1) THEN 1 ELSE 0 END
        ELSE CASE WHEN @DiaSemanaISOFinal IN (6, 7) THEN 0 ELSE 1 END
    END;
    WHILE (@EsFeriadoFinal = 1 OR @EsLaborableFinal = 0) AND @IntentosFinal < 60 BEGIN
        SET @FechaCalculada = DATEADD(DAY, 1, @FechaCalculada);
        SET @DiaSemanaISOFinal = ((DATEPART(WEEKDAY, @FechaCalculada) + @@DATEFIRST - 2) % 7) + 1;
        SET @EsFeriadoFinal = CASE WHEN EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = CAST(@FechaCalculada AS DATE)) THEN 1 ELSE 0 END;
        SET @EsLaborableFinal = CASE
            WHEN @TieneHorario = 1 THEN CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfigHorarioLaboral WHERE AreaID = @AreaID AND DiaSemana = @DiaSemanaISOFinal AND Activo = 1) THEN 1 ELSE 0 END
            ELSE CASE WHEN @DiaSemanaISOFinal IN (6, 7) THEN 0 ELSE 1 END
        END;
        SET @IntentosFinal = @IntentosFinal + 1;
    END

    UPDATE dbo.Ordenes SET FechaEstimadaEntrega = @FechaCalculada WHERE OrdenID = @OrdenID;
    SELECT @FechaCalculada AS NuevaFechaEntrega;
END
