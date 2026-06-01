const fs = require('fs');
const path = require('path');

const filePath = 'c:\\Integracion\\User-Macrosoft\\Proyecto-produccion\\backend\\Para Migrar\\04-POBLAR_TABLAS.sql';
let content = fs.readFileSync(filePath, 'utf-8');

const missingMerge = `
-- ============================================================================
-- 22. Config_CFE  (PK: CfeCfgId, IDENTITY)
-- ============================================================================
PRINT '>>> [22/23] Config_CFE';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[Config_CFE] ON;

    MERGE INTO [SecureAppDB].[dbo].[Config_CFE] AS DEST
    USING (
        SELECT CfeCfgId, CfeCfgClave, CfeCfgValor, CfeCfgDescripcion, CfeCfgActivo
        FROM [SecureAppDB2205].[dbo].[Config_CFE]
    ) AS SRC ON DEST.CfeCfgId = SRC.CfeCfgId

    WHEN MATCHED THEN UPDATE SET
        DEST.CfeCfgClave = SRC.CfeCfgClave,
        DEST.CfeCfgValor = SRC.CfeCfgValor,
        DEST.CfeCfgDescripcion = SRC.CfeCfgDescripcion,
        DEST.CfeCfgActivo = SRC.CfeCfgActivo

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (CfeCfgId, CfeCfgClave, CfeCfgValor, CfeCfgDescripcion, CfeCfgActivo)
    VALUES 
        (SRC.CfeCfgId, SRC.CfeCfgClave, SRC.CfeCfgValor, SRC.CfeCfgDescripcion, SRC.CfeCfgActivo);

    SET IDENTITY_INSERT [dbo].[Config_CFE] OFF;

    COMMIT TRAN;
    PRINT '    ✅ Config_CFE OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Config_CFE] OFF;
    PRINT '    ❌ ERROR Config_CFE: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 23. PlanesMetrosArticulosPermitidos  (PK: PlaIdPlan, ProIdProducto)
-- ============================================================================
PRINT '>>> [23/23] PlanesMetrosArticulosPermitidos';
BEGIN TRY
    BEGIN TRAN;

    MERGE INTO [SecureAppDB].[dbo].[PlanesMetrosArticulosPermitidos] AS DEST
    USING (
        SELECT PlaIdPlan, ProIdProducto
        FROM [SecureAppDB2205].[dbo].[PlanesMetrosArticulosPermitidos]
    ) AS SRC ON DEST.PlaIdPlan = SRC.PlaIdPlan AND DEST.ProIdProducto = SRC.ProIdProducto

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (PlaIdPlan, ProIdProducto)
    VALUES 
        (SRC.PlaIdPlan, SRC.ProIdProducto);

    COMMIT TRAN;
    PRINT '    ✅ PlanesMetrosArticulosPermitidos OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ❌ ERROR PlanesMetrosArticulosPermitidos: ' + ERROR_MESSAGE();
END CATCH
GO
`;

// Reemplazar la sección del resumen final agregando antes las nuevas tablas
content = content.replace('-- ============================================================================\r\n-- RESUMEN FINAL', missingMerge + '\r\n-- ============================================================================\r\n-- RESUMEN FINAL');

content = content.replace('Tablas procesadas: 21', 'Tablas procesadas: 23');

fs.writeFileSync(filePath, content);
console.log('Script POBLAR actualizado con las 2 tablas faltantes.');
