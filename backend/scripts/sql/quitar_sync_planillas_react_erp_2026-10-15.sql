/* ─────────────────────────────────────────────────────────────────────────
   Baja de "Procesos Automáticos" (Configuración → Procesos Automáticos):
   sincronización de pedidos desde Google Sheets (DTF y Sublimación) y envío
   de pedidos a React (OrdenesDeposito) y al ERP Macrosoft.

   El código que los usaba ya se borró (cron/planillaSync.js,
   configuracionesController/Routes, ConfigSyncModal y el envío a React/ERP de
   erpSyncService). Los 4 procesos estaban apagados (Activo = 0).

   Borra:
     - la tabla ConfiguracionesSync (los 4 procesos);
     - de PedidosCobranza, las columnas EstadoSyncReact, EstadoSyncERP,
       ObsReact y ObsERP. Nadie las escribía: valen 'Pendiente' / NULL en
       todas las filas.

   Correrlo DESPUÉS de subir el backend nuevo: el viejo lee estas columnas y
   la tabla. Es idempotente: lo que ya no existe se saltea.
   Los nombres de los DEFAULT cambian entre local y producción, por eso se
   buscan por columna.
   ───────────────────────────────────────────────────────────────────────── */

SET XACT_ABORT ON;
BEGIN TRAN;

IF OBJECT_ID('dbo.ConfiguracionesSync', 'U') IS NOT NULL
    DROP TABLE dbo.ConfiguracionesSync;

DECLARE @col SYSNAME, @df SYSNAME, @sql NVARCHAR(MAX);
DECLARE cols CURSOR LOCAL FAST_FORWARD FOR
    SELECT c.name, dc.name
    FROM sys.columns c
    LEFT JOIN sys.default_constraints dc
           ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
    WHERE c.object_id = OBJECT_ID('dbo.PedidosCobranza')
      AND c.name IN ('EstadoSyncReact', 'EstadoSyncERP', 'ObsReact', 'ObsERP');
OPEN cols;
FETCH NEXT FROM cols INTO @col, @df;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF @df IS NOT NULL
    BEGIN
        SET @sql = N'ALTER TABLE dbo.PedidosCobranza DROP CONSTRAINT ' + QUOTENAME(@df) + N';';
        EXEC sp_executesql @sql;
    END
    SET @sql = N'ALTER TABLE dbo.PedidosCobranza DROP COLUMN ' + QUOTENAME(@col) + N';';
    EXEC sp_executesql @sql;
    FETCH NEXT FROM cols INTO @col, @df;
END
CLOSE cols;
DEALLOCATE cols;

COMMIT;

-- Resultado: las dos consultas tienen que salir vacías
SELECT name FROM sys.tables WHERE name = 'ConfiguracionesSync';
SELECT name FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.PedidosCobranza')
  AND name IN ('EstadoSyncReact', 'EstadoSyncERP', 'ObsReact', 'ObsERP');
