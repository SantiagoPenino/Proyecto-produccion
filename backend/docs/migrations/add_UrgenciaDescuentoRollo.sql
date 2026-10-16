-- ============================================================
-- MIGRACIÓN: Recargo de metros (rollo por adelantado) para órdenes
--            Urgentes cuyo recargo de urgencia NO se cobra en $.
--            El cliente paga ese costo en metros: la orden consume
--            los metros normales MÁS un % adicional del rollo.
-- Fecha: 2026-07-22
-- IMPACTO: Ninguno en tablas existentes. Agrega 2 claves de
--          ConfiguracionGlobal + 1 tabla nueva. Todo con guardas
--          IF NOT EXISTS, re-ejecutable sin efecto secundario.
-- NOTA: los nombres de clave/tabla quedaron con el prefijo histórico
--       "DESCUENTO" (por cómo se llamó primero la feature), pero el
--       comportamiento real es un RECARGO — ver urgenciaDescuentoRolloService.js.
-- ============================================================

-- 1. Flag general (apagado por defecto) + porcentaje de recargo
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_ACTIVO')
BEGIN
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('URGENCIA_DESCUENTO_ROLLO_ACTIVO', 'ADMIN', '0');
    PRINT 'URGENCIA_DESCUENTO_ROLLO_ACTIVO insertado (apagado por defecto).';
END
ELSE
    PRINT 'URGENCIA_DESCUENTO_ROLLO_ACTIVO ya existe — sin cambios.';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_PORCENTAJE')
BEGIN
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('URGENCIA_DESCUENTO_ROLLO_PORCENTAJE', 'ADMIN', '25');
    PRINT 'URGENCIA_DESCUENTO_ROLLO_PORCENTAJE insertado (25%).';
END
ELSE
    PRINT 'URGENCIA_DESCUENTO_ROLLO_PORCENTAJE ya existe — sin cambios.';
GO

-- Modo de rollout: PILOTO (lista blanca — el recargo SOLO aplica a los clientes
-- de la tabla de abajo) o TODOS (lista negra — aplica a todos MENOS los de la
-- tabla). Arranca en PILOTO para poder habilitar cliente por cliente antes de
-- pasar a "Todos".
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'URGENCIA_DESCUENTO_ROLLO_MODO')
BEGIN
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('URGENCIA_DESCUENTO_ROLLO_MODO', 'ADMIN', 'PILOTO');
    PRINT 'URGENCIA_DESCUENTO_ROLLO_MODO insertado (PILOTO por defecto).';
END
ELSE
    PRINT 'URGENCIA_DESCUENTO_ROLLO_MODO ya existe — sin cambios.';
GO

-- 2. Tabla de clientes — su significado depende del modo de arriba:
--    en PILOTO es lista blanca (solo estos reciben el recargo), en TODOS
--    es lista negra (excluidos del recargo, independiente de UrgenciaExcepciones).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UrgenciaDescuentoRolloExcepciones')
BEGIN
    CREATE TABLE dbo.UrgenciaDescuentoRolloExcepciones (
        ID            INT IDENTITY(1,1) PRIMARY KEY,
        CliIdCliente  INT NOT NULL,
        Activo        BIT NOT NULL DEFAULT 1,
        Motivo        NVARCHAR(200) NULL,
        FechaAlta     DATETIME NOT NULL DEFAULT GETDATE(),
        UsuarioAlta   INT NULL,
        CONSTRAINT UQ_UrgDescRolloExc UNIQUE (CliIdCliente)
    );
    PRINT 'Tabla UrgenciaDescuentoRolloExcepciones creada.';
END
ELSE
    PRINT 'Tabla UrgenciaDescuentoRolloExcepciones ya existe — sin cambios.';
GO

PRINT 'Migración completada sin errores.';
GO
