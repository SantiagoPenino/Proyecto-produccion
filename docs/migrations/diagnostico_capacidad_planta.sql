-- =====================================================================
-- DIAGNÓSTICO DE SOLO LECTURA — Capacidad de Planta / Fecha de Entrega
-- Correr contra PRODUCCIÓN. No modifica nada.
-- =====================================================================

SELECT '1. Tabla ConfigHorarioLaboral' AS Item,
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ConfigHorarioLaboral') THEN 'EXISTE' ELSE 'FALTA' END AS Estado
UNION ALL
SELECT '2. Tabla HistoricoCapacidadDiaria',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='HistoricoCapacidadDiaria') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '3. ConfigEquipos.Cabezales',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigEquipos' AND COLUMN_NAME='Cabezales') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '4. ConfigEquipos.VelocidadValor',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigEquipos' AND COLUMN_NAME='VelocidadValor') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '5. ConfigEquipos.VelocidadUnidad',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigEquipos' AND COLUMN_NAME='VelocidadUnidad') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '6. ConfigEquipos.MinutosPreparacion',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigEquipos' AND COLUMN_NAME='MinutosPreparacion') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
-- El fix real del bug (NULL=0 en la comparación) vive DENTRO del cuerpo del SP —
-- si el SP ya consulta ConfigHorarioLaboral, es la versión NUEVA (con el fix).
-- Si no la consulta, es la versión VIEJA (con el bug de "mismo día" todavía activo).
SELECT '7. sp_CalcularFechaEntrega YA tiene el fix (consulta ConfigHorarioLaboral)',
    CASE WHEN EXISTS (
        SELECT 1 FROM sys.sql_modules m
        JOIN sys.procedures p ON m.object_id = p.object_id
        WHERE p.name = 'sp_CalcularFechaEntrega' AND m.definition LIKE '%ConfigHorarioLaboral%'
    ) THEN 'SI (fix aplicado)'
      WHEN EXISTS (SELECT 1 FROM sys.procedures WHERE name = 'sp_CalcularFechaEntrega')
      THEN 'NO (el SP existe pero sigue con el bug viejo)'
      ELSE 'El SP no existe' END
UNION ALL
-- Dato faltante que el fix también corrige: ECOUV/Normal sin Dias cargado.
SELECT '8. ConfiguracionTiemposEntrega ECOUV/Normal tiene Dias cargado',
    CASE WHEN EXISTS (
        SELECT 1 FROM ConfiguracionTiemposEntrega
        WHERE AreaID = 'ECOUV' AND Prioridad = 'Normal' AND Dias IS NOT NULL
    ) THEN 'SI' ELSE 'NO (o la tabla/columnas tienen otro nombre — revisar a mano)' END

ORDER BY Item;
