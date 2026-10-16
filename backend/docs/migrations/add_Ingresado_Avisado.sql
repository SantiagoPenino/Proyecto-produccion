-- ============================================================
-- Migración: Agregar estados 'Ingresado' y 'Avisado' en dbo.ConfigEstados
-- Fecha:     2026-06-29
-- Propósito: Separar el flujo de depósito en dos sub-estados:
--            * Ingresado → la orden llegó físicamente al depósito
--            * Avisado   → el cliente fue notificado por WhatsApp
--            Ambos mapean al Estado general 'Finalizado'.
-- Instrucción: Ejecutar ANTES de desplegar los cambios de código.
-- ============================================================

-- Verificar que 'Finalizado' existe como estado padre
IF NOT EXISTS (SELECT 1 FROM dbo.ConfigEstados WHERE Nombre = 'Finalizado')
BEGIN
    PRINT 'ERROR: No se encontró el estado Finalizado en ConfigEstados. Verificar la tabla antes de continuar.';
    RETURN;
END

DECLARE @FinalizadoID INT;
-- Tomar el Finalizado raíz (sin padre) si existe; si todos tienen padre, tomar el primero
SELECT TOP 1 @FinalizadoID = EstadoID
FROM dbo.ConfigEstados
WHERE Nombre = 'Finalizado'
ORDER BY CASE WHEN EstadoPadreID IS NULL THEN 0 ELSE 1 END, EstadoID ASC;

-- ── Ingresado ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.ConfigEstados WHERE Nombre = 'Ingresado')
BEGIN
    INSERT INTO dbo.ConfigEstados (Nombre, TipoEstado, EstadoPadreID, Activo)
    VALUES ('Ingresado', 'ESTADOLOGISTICA', @FinalizadoID, 1);

    PRINT 'OK: Estado Ingresado agregado con padre Finalizado (ID=' + CAST(@FinalizadoID AS VARCHAR) + ')';
END
ELSE
BEGIN
    PRINT 'INFO: Estado Ingresado ya existe, no se realizaron cambios.';
END

-- ── Avisado ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.ConfigEstados WHERE Nombre = 'Avisado')
BEGIN
    INSERT INTO dbo.ConfigEstados (Nombre, TipoEstado, EstadoPadreID, Activo)
    VALUES ('Avisado', 'ESTADOLOGISTICA', @FinalizadoID, 1);

    PRINT 'OK: Estado Avisado agregado con padre Finalizado (ID=' + CAST(@FinalizadoID AS VARCHAR) + ')';
END
ELSE
BEGIN
    PRINT 'INFO: Estado Avisado ya existe, no se realizaron cambios.';
END
