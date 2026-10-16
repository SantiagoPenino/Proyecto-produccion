/* =====================================================================
   Consolidación: Capacidad de Planta / Fecha de Entrega
   ---------------------------------------------------------------------
   Ver docs/capacidad-planta-plan.md para el diagnóstico completo.
   Este script junta varios cambios independientes, todos idempotentes
   (se puede correr más de una vez sin romper nada):

   1) Tabla NUEVA ConfigHorarioLaboral (Fase 2 del plan, "calendario de
      trabajo"): días/turno/horario por área. Se siembra Lunes a Viernes
      08:00-17:00 para las 9 áreas productivas — mismo comportamiento que
      había antes, editable por área desde Configuración → Horario Laboral.
      AreaID='EMB' es solo un DATO en esta tabla, no se tocó ningún
      archivo de bordado (embBoardController.js, EmbBandeja.jsx, etc).

   2) FIX de bug real en sp_CalcularFechaEntrega: comparaba "NULL = 0"
      (nunca es TRUE en SQL), así que para casi todas las filas de
      ConfiguracionTiemposEntrega (Dias venía NULL, no 0) el loop de
      días hábiles nunca corría y la fecha calculada quedaba en el
      mismo día de ingreso en vez de sumar 24/48/72h.
      CONFIRMADO ejecutando el SP contra una orden real (12809, SB/Normal)
      en una transacción de prueba en LOCAL: con el bug daba "mismo día",
      con el fix da +2 días hábiles (~48h), como corresponde.
      Incluye TAMBIÉN el Horario Laboral del punto (1): el SP ya no asume
      Lunes-Viernes fijo para todas las áreas, consulta ConfigHorarioLaboral
      — y si un área no tiene nada cargado, cae al viejo comportamiento fijo
      (cero regresión). Validado con transacción de prueba: mismo resultado
      que antes con el horario Lun-Vie sembrado, respeta un día extra si se
      habilita, y no rompe si un área queda sin horario configurado.

   3) Dato faltante: ConfiguracionTiemposEntrega, fila ECOUV/Normal, tenía
      Texto='48 a 72 horas' pero Horas y Dias en NULL (nunca se cargó el
      valor numérico). Sin esto el SP no tiene de dónde calcular aunque
      el bug de (2) esté arreglado. Se fija en Dias=3 (extremo superior
      del rango prometido, conservador).

   4) Columnas nuevas en ConfigEquipos para poder cargar la capacidad real
      de cada máquina (Fase 1 del plan): Cabezales, VelocidadValor,
      VelocidadUnidad, MinutosPreparacion. Aditivas y NULL-able — no
      rompen nada de lo que ya lee/escribe Capacidad/Velocidad.

   5) CalendarioFeriados solo tenía 3 filas, todas de 2024. Se cargan los
      9 feriados NO LABORABLES oficiales de Uruguay 2026 (fijos + Carnaval
      + Semana Santa). NO se cargan los feriados LABORABLES (6/1, 19/4,
      18/5, 19/6, 12/10, 2/11) porque esos son día normal de trabajo por
      ley — si la planta de hecho cierra en alguno, agregarlo a mano
      desde acá o por SQL.

   6) Valores INICIALES de capacidad real por máquina (típicos de
      industria, ver detalle en el bloque 6 más abajo).

   7) Ítem de menú "Planificación" (/produccion/planificacion) — agenda
      visual por área: qué días son laborables y qué órdenes tienen
      FechaEstimadaEntrega cada día. Cuelga de "Producción" (IdModulo 3).

   8) Tabla NUEVA HistoricoCapacidadDiaria: una fila por (área, fecha) con la
      foto del día — capacidad, pendiente total, pendiente urgente/normal.
      La llena un job nuevo (backend/jobs/capacidadDiaria.job.js, 06:00 hs
      diarios) + de forma oportunista cada vez que alguien mira Planificación
      hoy. Requiere reiniciar el proceso de Node para que el cron arranque.

   Ejecutar en PRODUCCIÓN. No requiere downtime ni bloquea tablas grandes.
   ===================================================================== */

-- 1) Tabla ConfigHorarioLaboral + seed Lunes-Viernes 08:00-17:00
IF OBJECT_ID('dbo.ConfigHorarioLaboral', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ConfigHorarioLaboral (
        HorarioID INT IDENTITY(1,1) PRIMARY KEY,
        AreaID VARCHAR(20) NOT NULL,
        DiaSemana TINYINT NOT NULL,  -- ISO: 1=Lunes ... 7=Domingo
        Turno VARCHAR(20) NULL,
        HoraInicio TIME NOT NULL,
        HoraFin TIME NOT NULL,
        Activo BIT NOT NULL DEFAULT 1
    );
END
GO

DECLARE @Areas TABLE (AreaID VARCHAR(20));
INSERT INTO @Areas VALUES ('DF'),('SB'),('EMB'),('ECOUV'),('TPU'),('DIRECTA'),('EST'),('TWC'),('TWT');

DECLARE @Dias TABLE (Dia TINYINT);
INSERT INTO @Dias VALUES (1),(2),(3),(4),(5);

INSERT INTO dbo.ConfigHorarioLaboral (AreaID, DiaSemana, Turno, HoraInicio, HoraFin, Activo)
SELECT a.AreaID, d.Dia, NULL, '08:00', '17:00', 1
FROM @Areas a CROSS JOIN @Dias d
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.ConfigHorarioLaboral h WHERE h.AreaID = a.AreaID AND h.DiaSemana = d.Dia
);
GO

-- 2) Fix del bug NULL + Horario Laboral en sp_CalcularFechaEntrega
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
GO

-- 3) Dato faltante: ECOUV/Normal sin Horas/Dias numéricos
UPDATE dbo.ConfiguracionTiemposEntrega SET Dias = 3 WHERE AreaID = 'ECOUV' AND Prioridad = 'Normal' AND Dias IS NULL;
PRINT 'ConfiguracionTiemposEntrega: ECOUV/Normal actualizado (filas afectadas arriba).';
GO

-- 4) Columnas de capacidad real en ConfigEquipos
IF COL_LENGTH('dbo.ConfigEquipos', 'Cabezales') IS NULL
    ALTER TABLE dbo.ConfigEquipos ADD Cabezales INT NULL;
GO
IF COL_LENGTH('dbo.ConfigEquipos', 'VelocidadValor') IS NULL
    ALTER TABLE dbo.ConfigEquipos ADD VelocidadValor DECIMAL(10,2) NULL;
GO
IF COL_LENGTH('dbo.ConfigEquipos', 'VelocidadUnidad') IS NULL
    ALTER TABLE dbo.ConfigEquipos ADD VelocidadUnidad VARCHAR(30) NULL;
GO
IF COL_LENGTH('dbo.ConfigEquipos', 'MinutosPreparacion') IS NULL
    ALTER TABLE dbo.ConfigEquipos ADD MinutosPreparacion INT NULL;
GO

-- 5) Feriados NO laborables Uruguay 2026
IF NOT EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = '2026-01-01')
    INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES ('2026-01-01', 'Año Nuevo');
IF NOT EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = '2026-02-16')
    INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES ('2026-02-16', 'Carnaval (Lunes)');
IF NOT EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = '2026-02-17')
    INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES ('2026-02-17', 'Carnaval (Martes)');
IF NOT EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = '2026-04-02')
    INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES ('2026-04-02', 'Jueves Santo');
IF NOT EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = '2026-04-03')
    INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES ('2026-04-03', 'Viernes Santo');
IF NOT EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = '2026-05-01')
    INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES ('2026-05-01', 'Día del Trabajador');
IF NOT EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = '2026-07-18')
    INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES ('2026-07-18', 'Jura de la Constitución');
IF NOT EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = '2026-08-25')
    INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES ('2026-08-25', 'Declaratoria de la Independencia');
IF NOT EXISTS (SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = '2026-12-25')
    INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES ('2026-12-25', 'Navidad');
GO

-- 6) Valores INICIALES de capacidad real, por tipo de máquina.
--    Son valores TÍPICOS DE INDUSTRIA (investigados: fichas técnicas FEDAR, Mimaki TS-series,
--    Tajima, rangos de DTF/DTG/UV/eco-solvente/serigrafía), NO medidos en esta planta en
--    particular — el modelo exacto de cada equipo (FEDAR 1/2, Gensy 1/2, etc.) no está
--    identificado en la base. Sirven como punto de partida razonable; se ajustan desde
--    Configuración → [área] → Equipos en cualquier momento.
--    CORTE 1 (TWC) y COSTURA 1 (TWT) quedan sin cargar a propósito: no hay una cifra de
--    industria útil sin saber tizada/prenda — dependen demasiado del trabajo concreto.
UPDATE dbo.ConfigEquipos SET Cabezales=NULL, VelocidadValor=30,  VelocidadUnidad='m lineales/h', MinutosPreparacion=10 WHERE Nombre IN ('DTF-1','DTF-2','DTF-3','DTF-4');
UPDATE dbo.ConfigEquipos SET Cabezales=NULL, VelocidadValor=35,  VelocidadUnidad='m lineales/h', MinutosPreparacion=10 WHERE Nombre = 'DTF-UV-1';
UPDATE dbo.ConfigEquipos SET Cabezales=NULL, VelocidadValor=63,  VelocidadUnidad='m lineales/h', MinutosPreparacion=10 WHERE AreaID='SB' AND Nombre LIKE 'FEDAR%';
UPDATE dbo.ConfigEquipos SET Cabezales=NULL, VelocidadValor=50,  VelocidadUnidad='m lineales/h', MinutosPreparacion=10 WHERE AreaID='SB' AND Nombre = 'MIMAKI';
UPDATE dbo.ConfigEquipos SET Cabezales=NULL, VelocidadValor=300, VelocidadUnidad='m lineales/h', MinutosPreparacion=5 WHERE AreaID='SB' AND Nombre LIKE 'CALANDRA%';
-- EMB: cargado originalmente en puntadas/MINUTO (1000, 850) — el motor de capacidad asume que
-- TODO VelocidadValor es por HORA (multiplica por horas laborables directo), así que quedaba
-- 60x por debajo de la real. Convertido a puntadas/h (x60) para que sea consistente con el resto
-- de las áreas (todas en "algo/h").
UPDATE dbo.ConfigEquipos SET Cabezales=1,    VelocidadValor=60000, VelocidadUnidad='puntadas/h', MinutosPreparacion=15 WHERE AreaID='EMB' AND Nombre = 'Tajima 6';
UPDATE dbo.ConfigEquipos SET Cabezales=6,    VelocidadValor=60000, VelocidadUnidad='puntadas/h', MinutosPreparacion=15 WHERE AreaID='EMB' AND Nombre = 'Tajima 6 Cabezales';
UPDATE dbo.ConfigEquipos SET Cabezales=6,    VelocidadValor=51000, VelocidadUnidad='puntadas/h', MinutosPreparacion=15 WHERE AreaID='EMB' AND Nombre LIKE 'Gensy%';
UPDATE dbo.ConfigEquipos SET Cabezales=NULL, VelocidadValor=35,  VelocidadUnidad='m²/h', MinutosPreparacion=10 WHERE AreaID='ECOUV' AND Nombre LIKE 'ECOSOLVENTE%';
UPDATE dbo.ConfigEquipos SET Cabezales=NULL, VelocidadValor=80,  VelocidadUnidad='m²/h', MinutosPreparacion=10 WHERE AreaID='ECOUV' AND Nombre = 'UV';
-- TPU se mide en unidades (Ordenes.UM = 'u'), no en prendas — corregido 9-oct-2026 (antes 'prendas/h').
UPDATE dbo.ConfigEquipos SET Cabezales=1,    VelocidadValor=150, VelocidadUnidad='u/h', MinutosPreparacion=5 WHERE AreaID='TPU';
UPDATE dbo.ConfigEquipos SET Cabezales=1,    VelocidadValor=150, VelocidadUnidad='prendas/h', MinutosPreparacion=20 WHERE AreaID='EST';
-- DIRECTA: la Magnitud real se registra en metros (UM='M'), no en prendas — la estimación
-- original de "15 prendas/h" quedaba mal etiquetada, se saca hasta tener un dato real.
UPDATE dbo.ConfigEquipos SET Cabezales=NULL, VelocidadValor=NULL, VelocidadUnidad=NULL WHERE AreaID='DIRECTA';
GO

-- NOTA: el motor de Planificación (/produccion/planificacion) usa SIEMPRE estos valores de
-- ficha técnica (Capacidad Instalada) — NO calibra contra el historial de FechaPronto (se
-- probó calibrar y se sacó a pedido del usuario 13-ago-2026: usar el Horario Laboral vigente
-- para reconstruir horas trabajadas en el pasado da un número retroactivo poco confiable en
-- cuanto se edita el horario — "esto empieza ahora"). Todos los VelocidadValor tienen que estar
-- en la misma base de tiempo (por HORA) — ver el fix de EMB arriba (venía en puntadas/minuto).
GO

-- 7) Ítem de menú "Planificación", cuelga de Producción (IdModulo 3)
DECLARE @RutaPlan NVARCHAR(255) = '/produccion/planificacion';
DECLARE @IdModPlan INT;
SELECT @IdModPlan = IdModulo FROM dbo.Modulos WHERE Ruta = @RutaPlan;
IF @IdModPlan IS NULL
BEGIN
    INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES ('Planificación', 3, @RutaPlan, NULL, 50);
    SET @IdModPlan = SCOPE_IDENTITY();
END
DECLARE @RolesPlan TABLE (IdRol INT);
INSERT INTO @RolesPlan (IdRol) VALUES (1), (2), (3), (8), (11), (12); -- Admin, User, DTF, Administracion, Coordinador, Atención al Cliente
INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT r.IdRol, @IdModPlan FROM @RolesPlan r
WHERE NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles pr WHERE pr.IdRol = r.IdRol AND pr.IdModulo = @IdModPlan);
GO

-- 8) Tabla HistoricoCapacidadDiaria
IF OBJECT_ID('dbo.HistoricoCapacidadDiaria', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.HistoricoCapacidadDiaria (
        AreaID VARCHAR(20) NOT NULL,
        Fecha DATE NOT NULL,
        CapacidadDia DECIMAL(18,2) NULL,
        Unidad VARCHAR(30) NULL,
        FuenteCapacidad VARCHAR(20) NULL,
        MetrosPendientesTotal DECIMAL(18,2) NULL,
        MetrosPendientesUrgente DECIMAL(18,2) NULL,
        MetrosPendientesNormal DECIMAL(18,2) NULL,
        CantidadOrdenesPendientes INT NULL,
        CantidadOrdenesPendientesUrgente INT NULL,
        RegistradoEn DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_HistoricoCapacidadDiaria PRIMARY KEY (AreaID, Fecha)
    );
END
GO

/* Verificación */
SELECT AreaID, COUNT(*) AS DiasCargados FROM dbo.ConfigHorarioLaboral GROUP BY AreaID ORDER BY AreaID;

SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'ConfigEquipos' AND COLUMN_NAME IN ('Cabezales','VelocidadValor','VelocidadUnidad','MinutosPreparacion');

SELECT EquipoID, AreaID, Nombre, Cabezales, VelocidadValor, VelocidadUnidad, MinutosPreparacion FROM dbo.ConfigEquipos ORDER BY AreaID, Nombre;

SELECT * FROM dbo.ConfiguracionTiemposEntrega WHERE AreaID = 'ECOUV';

SELECT * FROM dbo.CalendarioFeriados ORDER BY Fecha;

SELECT IdModulo, Titulo, Ruta FROM dbo.Modulos WHERE Ruta = '/produccion/planificacion';
