-- =====================================================================
-- Capacidad de Planta — Estándar vs Real (25-ago-2026)
-- =====================================================================
-- Contexto: ConfigEquipos.Cabezales / VelocidadValor / VelocidadUnidad /
-- MinutosPreparacion (agregadas en consolidar_capacidad_planta.sql) se
-- cargaron con estimaciones de ficha técnica del fabricante — NO son
-- medidas de estas máquinas específicas trabajando en planta. La UI ya
-- las etiquetaba "real", lo cual era engañoso.
--
-- Administración pidió un campo aparte, editable, con la capacidad REAL
-- a la que se está trabajando cada máquina — y que el cálculo de
-- capacidad de planta (planificacionController.calcularSituacion) use
-- ese valor cuando esté cargado, cayendo al estándar si no.
--
-- Aditivo, 100% NULL-able. Sin ninguna columna real cargada, el cálculo
-- de capacidad sigue dando EXACTAMENTE el mismo número que hoy (fallback
-- automático a VelocidadValor en el backend).
-- =====================================================================

IF COL_LENGTH('dbo.ConfigEquipos', 'CabezalesReal') IS NULL
    ALTER TABLE dbo.ConfigEquipos ADD CabezalesReal INT NULL;

IF COL_LENGTH('dbo.ConfigEquipos', 'VelocidadValorReal') IS NULL
    ALTER TABLE dbo.ConfigEquipos ADD VelocidadValorReal DECIMAL(10,2) NULL;

IF COL_LENGTH('dbo.ConfigEquipos', 'MinutosPreparacionReal') IS NULL
    ALTER TABLE dbo.ConfigEquipos ADD MinutosPreparacionReal INT NULL;
GO
-- El GO de arriba es obligatorio: sin él, SQL Server compila TODO el batch
-- de una sola vez, y los SELECT de abajo fallan con "Invalid column name"
-- porque en el momento de resolver los nombres las columnas todavía no
-- existían para el compilador — aunque el ALTER ya se haya ejecutado bien.

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'ConfigEquipos'
  AND COLUMN_NAME IN ('CabezalesReal', 'VelocidadValorReal', 'MinutosPreparacionReal');
GO

SELECT EquipoID, AreaID, Nombre,
       Cabezales, VelocidadValor, VelocidadUnidad, MinutosPreparacion,
       CabezalesReal, VelocidadValorReal, MinutosPreparacionReal
FROM dbo.ConfigEquipos
ORDER BY AreaID, Nombre;
