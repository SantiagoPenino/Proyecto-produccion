-- ============================================================================
-- VENTAS HISTÓRICAS PARA EL RESUMEN MENSUAL (28-09-2026)
-- Maqueta "Resumen Mensual – Evolución y Comparación": la comparación 2026 vs
-- 2025 necesita las ventas del año anterior, que no están en este sistema
-- (arrancó en junio 2026). Administración las carga a mano desde la pantalla
-- Resumen Mensual (tabla editable / pegar desde Excel).
--   VhiAmbito: '' = total de la empresa; 'S:<SecId>' = un sector comercial;
--              'A:<área>' = un área productiva (misma clave que usa la pantalla).
--   VhiMoneda: 'USD' o 'UYU' (la pantalla carga en USD).
-- También sirve para meses de 2026 anteriores al arranque del sistema: si un mes
-- no tiene documentos, el reporte usa la fila histórica y lo marca "cargado a mano".
-- Idempotente. Correr en PROD antes del deploy que trae las visuales nuevas.
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VentasHistoricas')
BEGIN
    CREATE TABLE dbo.VentasHistoricas (
        VhiAnio       SMALLINT      NOT NULL,
        VhiMes        TINYINT       NOT NULL,
        VhiAmbito     NVARCHAR(60)  NOT NULL CONSTRAINT DF_VentasHistoricas_Ambito DEFAULT (''),
        VhiMoneda     CHAR(3)       NOT NULL,
        VhiMonto      DECIMAL(18,2) NOT NULL,
        VhiUsuario    NVARCHAR(100) NULL,
        VhiFechaCarga DATETIME      NOT NULL CONSTRAINT DF_VentasHistoricas_Fecha DEFAULT (GETDATE()),
        CONSTRAINT PK_VentasHistoricas PRIMARY KEY (VhiAnio, VhiMes, VhiAmbito, VhiMoneda),
        CONSTRAINT CK_VentasHistoricas_Mes CHECK (VhiMes BETWEEN 1 AND 12),
        CONSTRAINT CK_VentasHistoricas_Moneda CHECK (VhiMoneda IN ('USD', 'UYU'))
    );
    PRINT 'Tabla dbo.VentasHistoricas creada.';
END
ELSE
    PRINT 'dbo.VentasHistoricas ya existía: sin cambios.';
