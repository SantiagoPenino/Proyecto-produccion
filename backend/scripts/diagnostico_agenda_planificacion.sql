/* =====================================================================
   DIAGNÓSTICO — Agenda / Planificación (/produccion/planificacion)
   ---------------------------------------------------------------------
   Solo LECTURA. No modifica nada. Corré esto contra PRODUCCIÓN para ver
   qué scripts de la feature "Agenda de Planificación" (capacidad de
   planta, fecha de entrega, fecha compromiso, requisitos por orden)
   todavía faltan aplicar — cada fila dice qué falta y en qué script
   está, para que sea directo de resolver.

   Corrido en LOCAL (réplica de trabajo) el 31-ago-2026 da 100% OK en
   todo — así se validó que el diagnóstico mismo funciona antes de
   pasártelo. Si algo da FALTA acá, es que no se corrió ese script en
   ESTA base.
   ===================================================================== */

SELECT * FROM (

    -- 1) consolidar_capacidad_planta.sql -----------------------------------
    SELECT 'consolidar_capacidad_planta.sql' AS Script, 'Tabla ConfigHorarioLaboral' AS Item,
        CASE WHEN OBJECT_ID('dbo.ConfigHorarioLaboral', 'U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS Estado,
        CASE WHEN OBJECT_ID('dbo.ConfigHorarioLaboral', 'U') IS NOT NULL
            THEN CAST((SELECT COUNT(*) FROM dbo.ConfigHorarioLaboral) AS VARCHAR(10)) + ' filas cargadas (esperado: 45, 9 áreas x 5 días)'
            ELSE 'la tabla no existe' END AS Detalle

    UNION ALL
    SELECT 'consolidar_capacidad_planta.sql', 'Fix sp_CalcularFechaEntrega (ISNULL en @DiasASumar)',
        CASE WHEN OBJECT_ID('dbo.sp_CalcularFechaEntrega', 'P') IS NULL THEN 'FALTA'
             WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.sp_CalcularFechaEntrega')) LIKE '%ISNULL(@DiasASumar%' THEN 'OK'
             ELSE 'FALTA' END,
        CASE WHEN OBJECT_ID('dbo.sp_CalcularFechaEntrega', 'P') IS NULL THEN 'el procedimiento no existe'
             ELSE 'sin el fix, el bug NULL=0 sigue activo: la fecha de entrega no suma días/horas para casi ninguna orden' END

    UNION ALL
    SELECT 'consolidar_capacidad_planta.sql', 'sp_CalcularFechaEntrega usa ConfigHorarioLaboral (no Lun-Vie fijo)',
        CASE WHEN OBJECT_ID('dbo.sp_CalcularFechaEntrega', 'P') IS NULL THEN 'FALTA'
             WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.sp_CalcularFechaEntrega')) LIKE '%ConfigHorarioLaboral%' THEN 'OK'
             ELSE 'FALTA' END,
        'si falta, cae al fallback viejo Lunes-Viernes fijo (no rompe, pero ignora el horario configurado)'

    UNION ALL
    SELECT 'consolidar_capacidad_planta.sql', 'ConfiguracionTiemposEntrega ECOUV/Normal con Dias',
        CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfiguracionTiemposEntrega WHERE AreaID='ECOUV' AND Prioridad='Normal' AND Dias IS NOT NULL) THEN 'OK' ELSE 'FALTA' END,
        ISNULL((SELECT 'Dias=' + CAST(Dias AS VARCHAR(10)) FROM dbo.ConfiguracionTiemposEntrega WHERE AreaID='ECOUV' AND Prioridad='Normal'), 'sin fila ECOUV/Normal')

    UNION ALL
    SELECT 'consolidar_capacidad_planta.sql', 'ConfigEquipos.Cabezales/VelocidadValor/VelocidadUnidad/MinutosPreparacion',
        CASE WHEN COL_LENGTH('dbo.ConfigEquipos','Cabezales') IS NOT NULL
              AND COL_LENGTH('dbo.ConfigEquipos','VelocidadValor') IS NOT NULL
              AND COL_LENGTH('dbo.ConfigEquipos','VelocidadUnidad') IS NOT NULL
              AND COL_LENGTH('dbo.ConfigEquipos','MinutosPreparacion') IS NOT NULL THEN 'OK' ELSE 'FALTA' END,
        'columnas de capacidad ESTÁNDAR (ficha técnica) — sin esto el motor de Planificación no puede calcular nada'

    UNION ALL
    SELECT 'consolidar_capacidad_planta.sql', 'VelocidadValor cargado en al menos 1 máquina por área con motor',
        CASE WHEN COL_LENGTH('dbo.ConfigEquipos','VelocidadValor') IS NULL THEN 'FALTA'
             WHEN (SELECT COUNT(DISTINCT AreaID) FROM dbo.ConfigEquipos WHERE VelocidadValor IS NOT NULL) >= 5 THEN 'OK'
             ELSE 'REVISAR' END,
        ISNULL((SELECT CAST(COUNT(*) AS VARCHAR(10)) + ' equipos con VelocidadValor, en ' + CAST(COUNT(DISTINCT AreaID) AS VARCHAR(10)) + ' áreas (esperado: DF/SB/EMB/ECOUV/TPU/EST, ~21 equipos)'
                       FROM dbo.ConfigEquipos WHERE VelocidadValor IS NOT NULL), 'columna no existe')

    UNION ALL
    SELECT 'consolidar_capacidad_planta.sql', 'CalendarioFeriados 2026 (9 feriados no laborables)',
        CASE WHEN (SELECT COUNT(*) FROM dbo.CalendarioFeriados WHERE YEAR(Fecha) = 2026) >= 9 THEN 'OK' ELSE 'FALTA' END,
        CAST((SELECT COUNT(*) FROM dbo.CalendarioFeriados WHERE YEAR(Fecha) = 2026) AS VARCHAR(10)) + ' feriados de 2026 cargados (esperado: 9)'

    UNION ALL
    SELECT 'consolidar_capacidad_planta.sql (o menu_planificacion.sql)', 'Ítem de menú /produccion/planificacion',
        CASE WHEN EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta = '/produccion/planificacion') THEN 'OK' ELSE 'FALTA' END,
        'sin esto la pantalla existe por URL directa pero no aparece en el menú'

    UNION ALL
    SELECT 'consolidar_capacidad_planta.sql', 'Tabla HistoricoCapacidadDiaria',
        CASE WHEN OBJECT_ID('dbo.HistoricoCapacidadDiaria', 'U') IS NOT NULL THEN 'OK' ELSE 'FALTA' END,
        'la llena el job diario 06:00hs — si falta la tabla, el job falla silenciosamente (no bloquea la pantalla, solo no guarda histórico)'

    -- 2) capacidad_planta_velocidad_real.sql -------------------------------
    UNION ALL
    SELECT 'capacidad_planta_velocidad_real.sql', 'ConfigEquipos.CabezalesReal/VelocidadValorReal/MinutosPreparacionReal',
        CASE WHEN COL_LENGTH('dbo.ConfigEquipos','CabezalesReal') IS NOT NULL
              AND COL_LENGTH('dbo.ConfigEquipos','VelocidadValorReal') IS NOT NULL
              AND COL_LENGTH('dbo.ConfigEquipos','MinutosPreparacionReal') IS NOT NULL THEN 'OK' ELSE 'FALTA' END,
        'columnas de capacidad REAL editable — sin esto el modal de Config > Equipos no puede guardar el valor "real" (distinto del estándar de ficha técnica)'

    -- 3) agregar_fecha_compromiso_emb.sql -----------------------------------
    UNION ALL
    SELECT 'agregar_fecha_compromiso_emb.sql', 'Ordenes.MagnitudCapacidad',
        CASE WHEN COL_LENGTH('dbo.Ordenes','MagnitudCapacidad') IS NOT NULL THEN 'OK' ELSE 'FALTA' END,
        'puntadas totales del diseño (solo EMB) — sin esto la Fecha Compromiso de Bordado no se puede calcular'

    UNION ALL
    SELECT 'agregar_fecha_compromiso_emb.sql', 'Ordenes.FechaCompromiso',
        CASE WHEN COL_LENGTH('dbo.Ordenes','FechaCompromiso') IS NOT NULL THEN 'OK' ELSE 'FALTA' END,
        'fecha prometida real (capacidad+cola), congelada al vender — sin esto Bordado usa la fecha fija genérica del SP'

    UNION ALL
    SELECT 'agregar_fecha_compromiso_emb.sql', 'ConfiguracionGlobal EMB_DIAS_PREPARACION_MATRIZ',
        CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'EMB_DIAS_PREPARACION_MATRIZ') THEN 'OK' ELSE 'FALTA' END,
        ISNULL((SELECT 'Valor=' + Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'EMB_DIAS_PREPARACION_MATRIZ'), 'sin esta fila, colchón de matriz = 0 días')

    -- 4) Requisitos por orden (SB/TWC/EST/TWT) — sin script propio, se cargó
    --    directo en algún momento anterior; se verifica igual porque el
    --    código nuevo de webOrdersController/prendasOrdersController/
    --    logisticsController depende de que esto ya exista. --------------
    UNION ALL
    SELECT '(sin script — verificar directo)', 'Ordenes.LiberaCuandoOrdenID',
        CASE WHEN COL_LENGTH('dbo.Ordenes','LiberaCuandoOrdenID') IS NOT NULL THEN 'OK' ELSE 'FALTA' END,
        'si falta, el INSERT de órdenes con encadenamiento (Corte<-Sublimación, Costura<-Corte, Estampado<-DTF/TPU) va a fallar directo'

    UNION ALL
    SELECT '(sin script — verificar directo)', 'Ordenes.EstadoDependencia',
        CASE WHEN COL_LENGTH('dbo.Ordenes','EstadoDependencia') IS NOT NULL THEN 'OK' ELSE 'FALTA' END,
        'gate de "Comprar y Personalizar" (espera retiro WMS) y de Estampado esperando su transfer'

    UNION ALL
    SELECT '(sin script — verificar directo)', 'ConfigRequisitosProduccion TWC/TELA',
        CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfigRequisitosProduccion WHERE AreaID='TWC' AND CodigoRequisito='TELA') THEN 'OK' ELSE 'FALTA' END,
        'sin esta fila, Corte nunca queda "esperando requisitos" — pasa directo a la bandeja sin verificar que llegó la tela'

    UNION ALL
    SELECT '(sin script — verificar directo)', 'ConfigRequisitosProduccion TWT/CORTES',
        CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfigRequisitosProduccion WHERE AreaID='TWT' AND CodigoRequisito='CORTES') THEN 'OK' ELSE 'FALTA' END,
        'sin esta fila, Costura nunca queda "esperando requisitos" — pasa directo a la bandeja sin verificar que llegó la tela cortada'

    UNION ALL
    SELECT 'docs/migrations/agregar_requisito_tpu_estampado.sql (PENDIENTE, ni siquiera en LOCAL)', 'ConfigRequisitosProduccion EST/TPU',
        CASE WHEN EXISTS (SELECT 1 FROM dbo.ConfigRequisitosProduccion WHERE AreaID='EST' AND CodigoRequisito='TPU') THEN 'OK' ELSE 'FALTA (esperado — ver nota abajo)' END,
        'esta migración existe en el repo pero NUNCA se corrió ni siquiera en LOCAL — no es parte de este diagnóstico de "qué falta llevar a prod", es un pendiente aparte'

) AS Diagnostico
ORDER BY
    CASE Estado WHEN 'FALTA' THEN 0 WHEN 'REVISAR' THEN 1 ELSE 2 END,
    Script, Item;
