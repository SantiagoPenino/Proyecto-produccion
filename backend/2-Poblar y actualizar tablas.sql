-- ============================================================================
-- SCRIPT DE MERGE: SecureAppDB2205 (Fuente) → SecureAppDB (Producción)
-- ============================================================================
-- Fecha:    2026-05-22
-- Objetivo: Poblar y actualizar las tablas de CONFIGURACIÓN y CATÁLOGO
--           en producción (SecureAppDB) tomando datos de SecureAppDB2205.
-- ============================================================================
--
-- ⚠️ ANÁLISIS DE IMPACTO:
-- ────────────────────────────────────────────────────────────────────────────
-- ✅ TABLAS SEGURAS (Solo config/catálogo, sin datos transaccionales):
--    - SecuenciaDocumentos, SINCRO-ARTICULOS, ConfiguracionPrecios
--    - TesoreriaBancos, Config_TiposDocumento, Config_CuentasEgreso
--    - CondicionesPago, TiposMovimiento
--    - Cont_PlanCuentas, Cont_TiposTransaccion, Cont_EventosContables
--    - Cont_ReglasEventos, Cont_ReglasContables, Cont_ReglasAsiento
--    - ConfigEstados, Modulos
--
-- ⚠️ TABLAS CON FK (Cuidado con dependencias):
--    - Articulos            → Referenciada por Ordenes, PreciosBase, etc.
--    - PreciosBase          → Depende de Articulos
--    - PerfilesPrecios      → Referenciada por PreciosEspeciales
--    - PreciosEspeciales    → Depende de PerfilesPrecios + Clientes
--    - PreciosEspecialesItems → Depende de PreciosEspeciales + Articulos
--
-- 🟢 NO se eliminan registros que existan solo en producción (no hay DELETE).
-- 🟢 Se usan TRANSACCIONES por bloque para rollback seguro.
-- 🟢 Se maneja IDENTITY_INSERT donde corresponde.
-- ============================================================================

USE [SecureAppDB];
GO

SET NOCOUNT ON;
PRINT '════════════════════════════════════════════════════════════════';
PRINT ' MERGE: SecureAppDB2205 → SecureAppDB';
PRINT ' Inicio: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '════════════════════════════════════════════════════════════════';
GO

-- ============================================================================
-- 1. SecuenciaDocumentos  (PK: SecIdSecuencia, IDENTITY)
-- ============================================================================
PRINT '>>> [1/21] SecuenciaDocumentos';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[SecuenciaDocumentos] ON;

    MERGE INTO [SecureAppDB].[dbo].[SecuenciaDocumentos] AS DEST
    USING (
        SELECT SecIdSecuencia, SecTipoDoc, SecSerie, SecPrefijo, 
               SecDigitos, SecUltimoNumero, SecActivo, SecObservaciones
        FROM [SecureAppDB2205].[dbo].[SecuenciaDocumentos]
    ) AS SRC ON DEST.SecIdSecuencia = SRC.SecIdSecuencia

    WHEN MATCHED THEN UPDATE SET
        DEST.SecTipoDoc        = SRC.SecTipoDoc,
        DEST.SecSerie          = SRC.SecSerie,
        DEST.SecPrefijo        = SRC.SecPrefijo,
        DEST.SecDigitos        = SRC.SecDigitos,
        DEST.SecUltimoNumero   = SRC.SecUltimoNumero,
        DEST.SecActivo         = SRC.SecActivo,
        DEST.SecObservaciones  = SRC.SecObservaciones

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (SecIdSecuencia, SecTipoDoc, SecSerie, SecPrefijo, SecDigitos, SecUltimoNumero, SecActivo, SecObservaciones)
    VALUES 
        (SRC.SecIdSecuencia, SRC.SecTipoDoc, SRC.SecSerie, SRC.SecPrefijo, SRC.SecDigitos, SRC.SecUltimoNumero, SRC.SecActivo, SRC.SecObservaciones);

    SET IDENTITY_INSERT [dbo].[SecuenciaDocumentos] OFF;

    COMMIT TRAN;
    PRINT '    ✅ SecuenciaDocumentos OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[SecuenciaDocumentos] OFF;
    PRINT '    ❌ ERROR SecuenciaDocumentos: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 2. SINCRO-ARTICULOS  (Sin PK formal - match por PRODUCTO+AREA+VARIANTE)
-- ============================================================================
PRINT '>>> [2/21] SINCRO-ARTICULOS';
BEGIN TRY
    BEGIN TRAN;

    MERGE INTO [SecureAppDB].[dbo].[SINCRO-ARTICULOS] AS DEST
    USING (
        SELECT PRODUCTO, codStock, VARIANTE, PROIDPRODUCTO, 
               Material, codArticulo, IDREACT, AREA
        FROM [SecureAppDB2205].[dbo].[SINCRO-ARTICULOS]
    ) AS SRC ON ISNULL(DEST.PRODUCTO,'') = ISNULL(SRC.PRODUCTO,'') 
           AND ISNULL(DEST.AREA,'') = ISNULL(SRC.AREA,'') 
           AND ISNULL(DEST.VARIANTE,'') = ISNULL(SRC.VARIANTE,'')

    WHEN MATCHED THEN UPDATE SET
        DEST.codStock      = SRC.codStock,
        DEST.PROIDPRODUCTO = SRC.PROIDPRODUCTO,
        DEST.Material      = SRC.Material,
        DEST.codArticulo   = SRC.codArticulo,
        DEST.IDREACT       = SRC.IDREACT

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (PRODUCTO, codStock, VARIANTE, PROIDPRODUCTO, Material, codArticulo, IDREACT, AREA)
    VALUES 
        (SRC.PRODUCTO, SRC.codStock, SRC.VARIANTE, SRC.PROIDPRODUCTO, SRC.Material, SRC.codArticulo, SRC.IDREACT, SRC.AREA);

    COMMIT TRAN;
    PRINT '    ✅ SINCRO-ARTICULOS OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ❌ ERROR SINCRO-ARTICULOS: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 3. ConfiguracionPrecios  (PK lógica: Clave + AreaID)
-- ============================================================================
PRINT '>>> [3/21] ConfiguracionPrecios';
BEGIN TRY
    BEGIN TRAN;

    MERGE INTO [SecureAppDB].[dbo].[ConfiguracionPrecios] AS DEST
    USING (
        SELECT Clave, Valor, AreaID, Descripcion
        FROM [SecureAppDB2205].[dbo].[ConfiguracionPrecios]
    ) AS SRC ON DEST.Clave = SRC.Clave AND ISNULL(DEST.AreaID,'') = ISNULL(SRC.AreaID,'')

    WHEN MATCHED THEN UPDATE SET
        DEST.Valor       = SRC.Valor,
        DEST.Descripcion = SRC.Descripcion

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (Clave, Valor, AreaID, Descripcion)
    VALUES 
        (SRC.Clave, SRC.Valor, SRC.AreaID, SRC.Descripcion);

    COMMIT TRAN;
    PRINT '    ✅ ConfiguracionPrecios OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ❌ ERROR ConfiguracionPrecios: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 4. TesoreriaBancos  (PK: IdBanco, IDENTITY)
-- ============================================================================
PRINT '>>> [4/21] TesoreriaBancos';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[TesoreriaBancos] ON;

    MERGE INTO [SecureAppDB].[dbo].[TesoreriaBancos] AS DEST
    USING (
        SELECT IdBanco, NombreBanco, Activo
        FROM [SecureAppDB2205].[dbo].[TesoreriaBancos]
    ) AS SRC ON DEST.IdBanco = SRC.IdBanco

    WHEN MATCHED THEN UPDATE SET
        DEST.NombreBanco = SRC.NombreBanco,
        DEST.Activo      = SRC.Activo

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (IdBanco, NombreBanco, Activo)
    VALUES 
        (SRC.IdBanco, SRC.NombreBanco, SRC.Activo);

    SET IDENTITY_INSERT [dbo].[TesoreriaBancos] OFF;

    COMMIT TRAN;
    PRINT '    ✅ TesoreriaBancos OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[TesoreriaBancos] OFF;
    PRINT '    ❌ ERROR TesoreriaBancos: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 5. Config_TiposDocumento  (PK: CodDocumento, NO identity)
-- ============================================================================
PRINT '>>> [5/21] Config_TiposDocumento';
BEGIN TRY
    BEGIN TRAN;

    MERGE INTO [SecureAppDB].[dbo].[Config_TiposDocumento] AS DEST
    USING (
        SELECT CodDocumento, Detalle, Codigo_Efact, RutObligatorio, 
               AfectaCtaCte, Referenciado, NroCaja, EvtCodigo, SecIdSecuencia
        FROM [SecureAppDB2205].[dbo].[Config_TiposDocumento]
    ) AS SRC ON DEST.CodDocumento = SRC.CodDocumento

    WHEN MATCHED THEN UPDATE SET
        DEST.Detalle         = SRC.Detalle,
        DEST.Codigo_Efact    = SRC.Codigo_Efact,
        DEST.RutObligatorio  = SRC.RutObligatorio,
        DEST.AfectaCtaCte    = SRC.AfectaCtaCte,
        DEST.Referenciado    = SRC.Referenciado,
        DEST.NroCaja         = SRC.NroCaja,
        DEST.EvtCodigo       = SRC.EvtCodigo,
        DEST.SecIdSecuencia  = SRC.SecIdSecuencia

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (CodDocumento, Detalle, Codigo_Efact, RutObligatorio, AfectaCtaCte, Referenciado, NroCaja, EvtCodigo, SecIdSecuencia)
    VALUES 
        (SRC.CodDocumento, SRC.Detalle, SRC.Codigo_Efact, SRC.RutObligatorio, SRC.AfectaCtaCte, SRC.Referenciado, SRC.NroCaja, SRC.EvtCodigo, SRC.SecIdSecuencia);

    COMMIT TRAN;
    PRINT '    ✅ Config_TiposDocumento OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ❌ ERROR Config_TiposDocumento: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 6. Config_CuentasEgreso  (PK: CegId, IDENTITY)
-- ============================================================================
PRINT '>>> [6/21] Config_CuentasEgreso';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[Config_CuentasEgreso] ON;

    MERGE INTO [SecureAppDB].[dbo].[Config_CuentasEgreso] AS DEST
    USING (
        SELECT CegId, CegTipoEgreso, CegNombreTipo, CegCueCodigo, CegCueNombre,
               CegEmoji, CegOrden, CegActivo, CegFechaAlta, CegUsuarioAlta
        FROM [SecureAppDB2205].[dbo].[Config_CuentasEgreso]
    ) AS SRC ON DEST.CegId = SRC.CegId

    WHEN MATCHED THEN UPDATE SET
        DEST.CegTipoEgreso  = SRC.CegTipoEgreso,
        DEST.CegNombreTipo  = SRC.CegNombreTipo,
        DEST.CegCueCodigo   = SRC.CegCueCodigo,
        DEST.CegCueNombre   = SRC.CegCueNombre,
        DEST.CegEmoji       = SRC.CegEmoji,
        DEST.CegOrden       = SRC.CegOrden,
        DEST.CegActivo      = SRC.CegActivo,
        DEST.CegFechaAlta   = SRC.CegFechaAlta,
        DEST.CegUsuarioAlta = SRC.CegUsuarioAlta

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (CegId, CegTipoEgreso, CegNombreTipo, CegCueCodigo, CegCueNombre, CegEmoji, CegOrden, CegActivo, CegFechaAlta, CegUsuarioAlta)
    VALUES 
        (SRC.CegId, SRC.CegTipoEgreso, SRC.CegNombreTipo, SRC.CegCueCodigo, SRC.CegCueNombre, SRC.CegEmoji, SRC.CegOrden, SRC.CegActivo, SRC.CegFechaAlta, SRC.CegUsuarioAlta);

    SET IDENTITY_INSERT [dbo].[Config_CuentasEgreso] OFF;

    COMMIT TRAN;
    PRINT '    ✅ Config_CuentasEgreso OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Config_CuentasEgreso] OFF;
    PRINT '    ❌ ERROR Config_CuentasEgreso: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 7. CondicionesPago  (PK: CPaIdCondicion, IDENTITY)
-- ============================================================================
PRINT '>>> [7/21] CondicionesPago';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[CondicionesPago] ON;

    MERGE INTO [SecureAppDB].[dbo].[CondicionesPago] AS DEST
    USING (
        SELECT CPaIdCondicion, CPaNombre, CPaDiasVencimiento, CPaPermiteCuotas,
               CPaCantidadCuotas, CPaDiasEntreCuotas, CPaActiva
        FROM [SecureAppDB2205].[dbo].[CondicionesPago]
    ) AS SRC ON DEST.CPaIdCondicion = SRC.CPaIdCondicion

    WHEN MATCHED THEN UPDATE SET
        DEST.CPaNombre           = SRC.CPaNombre,
        DEST.CPaDiasVencimiento  = SRC.CPaDiasVencimiento,
        DEST.CPaPermiteCuotas    = SRC.CPaPermiteCuotas,
        DEST.CPaCantidadCuotas   = SRC.CPaCantidadCuotas,
        DEST.CPaDiasEntreCuotas  = SRC.CPaDiasEntreCuotas,
        DEST.CPaActiva           = SRC.CPaActiva

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (CPaIdCondicion, CPaNombre, CPaDiasVencimiento, CPaPermiteCuotas, CPaCantidadCuotas, CPaDiasEntreCuotas, CPaActiva)
    VALUES 
        (SRC.CPaIdCondicion, SRC.CPaNombre, SRC.CPaDiasVencimiento, SRC.CPaPermiteCuotas, SRC.CPaCantidadCuotas, SRC.CPaDiasEntreCuotas, SRC.CPaActiva);

    SET IDENTITY_INSERT [dbo].[CondicionesPago] OFF;

    COMMIT TRAN;
    PRINT '    ✅ CondicionesPago OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[CondicionesPago] OFF;
    PRINT '    ❌ ERROR CondicionesPago: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 8. TiposMovimiento  (PK: TmoId, varchar - NO identity)
-- ============================================================================
PRINT '>>> [8/21] TiposMovimiento';
BEGIN TRY
    BEGIN TRAN;

    MERGE INTO [SecureAppDB].[dbo].[TiposMovimiento] AS DEST
    USING (
        SELECT TmoId, TmoNombre, TmoDescripcion, TmoPrefijo, TmoSecuencia,
               TmoAfectaSaldo, TmoGeneraDeuda, TmoAplicaRecurso, TmoRequiereDoc,
               TmoActivo, TmoOrden, TmoFechaAlta
        FROM [SecureAppDB2205].[dbo].[TiposMovimiento]
    ) AS SRC ON DEST.TmoId = SRC.TmoId

    WHEN MATCHED THEN UPDATE SET
        DEST.TmoNombre        = SRC.TmoNombre,
        DEST.TmoDescripcion   = SRC.TmoDescripcion,
        DEST.TmoPrefijo       = SRC.TmoPrefijo,
        DEST.TmoSecuencia     = SRC.TmoSecuencia,
        DEST.TmoAfectaSaldo   = SRC.TmoAfectaSaldo,
        DEST.TmoGeneraDeuda   = SRC.TmoGeneraDeuda,
        DEST.TmoAplicaRecurso = SRC.TmoAplicaRecurso,
        DEST.TmoRequiereDoc   = SRC.TmoRequiereDoc,
        DEST.TmoActivo        = SRC.TmoActivo,
        DEST.TmoOrden         = SRC.TmoOrden,
        DEST.TmoFechaAlta     = SRC.TmoFechaAlta

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (TmoId, TmoNombre, TmoDescripcion, TmoPrefijo, TmoSecuencia, TmoAfectaSaldo, TmoGeneraDeuda, TmoAplicaRecurso, TmoRequiereDoc, TmoActivo, TmoOrden, TmoFechaAlta)
    VALUES 
        (SRC.TmoId, SRC.TmoNombre, SRC.TmoDescripcion, SRC.TmoPrefijo, SRC.TmoSecuencia, SRC.TmoAfectaSaldo, SRC.TmoGeneraDeuda, SRC.TmoAplicaRecurso, SRC.TmoRequiereDoc, SRC.TmoActivo, SRC.TmoOrden, SRC.TmoFechaAlta);

    COMMIT TRAN;
    PRINT '    ✅ TiposMovimiento OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ❌ ERROR TiposMovimiento: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 9. Cont_PlanCuentas  (PK: CueId, IDENTITY)
-- ============================================================================
PRINT '>>> [9/21] Cont_PlanCuentas';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[Cont_PlanCuentas] ON;

    MERGE INTO [SecureAppDB].[dbo].[Cont_PlanCuentas] AS DEST
    USING (
        SELECT CueId, CueCodigo, CueNombre, CueNivel, CueTipoBase, 
               CueMoneda, CueImputable, CueActiva
        FROM [SecureAppDB2205].[dbo].[Cont_PlanCuentas]
    ) AS SRC ON DEST.CueId = SRC.CueId

    WHEN MATCHED THEN UPDATE SET
        DEST.CueCodigo    = SRC.CueCodigo,
        DEST.CueNombre    = SRC.CueNombre,
        DEST.CueNivel     = SRC.CueNivel,
        DEST.CueTipoBase  = SRC.CueTipoBase,
        DEST.CueMoneda    = SRC.CueMoneda,
        DEST.CueImputable = SRC.CueImputable,
        DEST.CueActiva    = SRC.CueActiva

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (CueId, CueCodigo, CueNombre, CueNivel, CueTipoBase, CueMoneda, CueImputable, CueActiva)
    VALUES 
        (SRC.CueId, SRC.CueCodigo, SRC.CueNombre, SRC.CueNivel, SRC.CueTipoBase, SRC.CueMoneda, SRC.CueImputable, SRC.CueActiva);

    SET IDENTITY_INSERT [dbo].[Cont_PlanCuentas] OFF;

    COMMIT TRAN;
    PRINT '    ✅ Cont_PlanCuentas OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Cont_PlanCuentas] OFF;
    PRINT '    ❌ ERROR Cont_PlanCuentas: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 10. Cont_TiposTransaccion  (PK: TrtCodigo, varchar - NO identity)
-- ============================================================================
PRINT '>>> [10/21] Cont_TiposTransaccion';
BEGIN TRY
    BEGIN TRAN;

    MERGE INTO [SecureAppDB].[dbo].[Cont_TiposTransaccion] AS DEST
    USING (
        SELECT TrtCodigo, TrtNombre, TrtDescripcion, TrtUsaEntidad, TrtEstado
        FROM [SecureAppDB2205].[dbo].[Cont_TiposTransaccion]
    ) AS SRC ON DEST.TrtCodigo = SRC.TrtCodigo

    WHEN MATCHED THEN UPDATE SET
        DEST.TrtNombre      = SRC.TrtNombre,
        DEST.TrtDescripcion = SRC.TrtDescripcion,
        DEST.TrtUsaEntidad  = SRC.TrtUsaEntidad,
        DEST.TrtEstado      = SRC.TrtEstado

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (TrtCodigo, TrtNombre, TrtDescripcion, TrtUsaEntidad, TrtEstado)
    VALUES 
        (SRC.TrtCodigo, SRC.TrtNombre, SRC.TrtDescripcion, SRC.TrtUsaEntidad, SRC.TrtEstado);

    COMMIT TRAN;
    PRINT '    ✅ Cont_TiposTransaccion OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ❌ ERROR Cont_TiposTransaccion: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 11. Cont_EventosContables  (PK: EvtCodigo, varchar - NO identity)
-- ============================================================================
PRINT '>>> [11/21] Cont_EventosContables';
BEGIN TRY
    BEGIN TRAN;

    MERGE INTO [SecureAppDB].[dbo].[Cont_EventosContables] AS DEST
    USING (
        SELECT EvtCodigo, EvtNombre, EvtDescripcion, EvtPrefijo, EvtSubtipo,
               EvtAfectaSaldo, EvtGeneraDeuda, EvtAplicaRecurso, EvtUsaEntidad,
               EvtRequiereDoc, EvtActivo, EvtOrden, EvtFechaAlta
        FROM [SecureAppDB2205].[dbo].[Cont_EventosContables]
    ) AS SRC ON DEST.EvtCodigo = SRC.EvtCodigo

    WHEN MATCHED THEN UPDATE SET
        DEST.EvtNombre        = SRC.EvtNombre,
        DEST.EvtDescripcion   = SRC.EvtDescripcion,
        DEST.EvtPrefijo       = SRC.EvtPrefijo,
        DEST.EvtSubtipo       = SRC.EvtSubtipo,
        DEST.EvtAfectaSaldo   = SRC.EvtAfectaSaldo,
        DEST.EvtGeneraDeuda   = SRC.EvtGeneraDeuda,
        DEST.EvtAplicaRecurso = SRC.EvtAplicaRecurso,
        DEST.EvtUsaEntidad    = SRC.EvtUsaEntidad,
        DEST.EvtRequiereDoc   = SRC.EvtRequiereDoc,
        DEST.EvtActivo        = SRC.EvtActivo,
        DEST.EvtOrden         = SRC.EvtOrden,
        DEST.EvtFechaAlta     = SRC.EvtFechaAlta

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (EvtCodigo, EvtNombre, EvtDescripcion, EvtPrefijo, EvtSubtipo, EvtAfectaSaldo, EvtGeneraDeuda, EvtAplicaRecurso, EvtUsaEntidad, EvtRequiereDoc, EvtActivo, EvtOrden, EvtFechaAlta)
    VALUES 
        (SRC.EvtCodigo, SRC.EvtNombre, SRC.EvtDescripcion, SRC.EvtPrefijo, SRC.EvtSubtipo, SRC.EvtAfectaSaldo, SRC.EvtGeneraDeuda, SRC.EvtAplicaRecurso, SRC.EvtUsaEntidad, SRC.EvtRequiereDoc, SRC.EvtActivo, SRC.EvtOrden, SRC.EvtFechaAlta);

    COMMIT TRAN;
    PRINT '    ✅ Cont_EventosContables OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ❌ ERROR Cont_EventosContables: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 12. Cont_ReglasEventos  (PK: RegId, IDENTITY)
-- ============================================================================
PRINT '>>> [12/21] Cont_ReglasEventos';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[Cont_ReglasEventos] ON;

    MERGE INTO [SecureAppDB].[dbo].[Cont_ReglasEventos] AS DEST
    USING (
        SELECT RegId, RegCodigo, RegNombre, RegCuentaDebe, RegCuentaHaber, RegObservacion
        FROM [SecureAppDB2205].[dbo].[Cont_ReglasEventos]
    ) AS SRC ON DEST.RegId = SRC.RegId

    WHEN MATCHED THEN UPDATE SET
        DEST.RegCodigo       = SRC.RegCodigo,
        DEST.RegNombre       = SRC.RegNombre,
        DEST.RegCuentaDebe   = SRC.RegCuentaDebe,
        DEST.RegCuentaHaber  = SRC.RegCuentaHaber,
        DEST.RegObservacion  = SRC.RegObservacion

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (RegId, RegCodigo, RegNombre, RegCuentaDebe, RegCuentaHaber, RegObservacion)
    VALUES 
        (SRC.RegId, SRC.RegCodigo, SRC.RegNombre, SRC.RegCuentaDebe, SRC.RegCuentaHaber, SRC.RegObservacion);

    SET IDENTITY_INSERT [dbo].[Cont_ReglasEventos] OFF;

    COMMIT TRAN;
    PRINT '    ✅ Cont_ReglasEventos OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Cont_ReglasEventos] OFF;
    PRINT '    ❌ ERROR Cont_ReglasEventos: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 13. Cont_ReglasContables  (PK: RgcId, IDENTITY)
-- ============================================================================
PRINT '>>> [13/21] Cont_ReglasContables';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[Cont_ReglasContables] ON;

    MERGE INTO [SecureAppDB].[dbo].[Cont_ReglasContables] AS DEST
    USING (
        SELECT RgcId, TrtCodigo, CueCodigo, RgcNaturaleza, RgcFilaFormula, RgcOrden
        FROM [SecureAppDB2205].[dbo].[Cont_ReglasContables]
    ) AS SRC ON DEST.RgcId = SRC.RgcId

    WHEN MATCHED THEN UPDATE SET
        DEST.TrtCodigo      = SRC.TrtCodigo,
        DEST.CueCodigo      = SRC.CueCodigo,
        DEST.RgcNaturaleza  = SRC.RgcNaturaleza,
        DEST.RgcFilaFormula = SRC.RgcFilaFormula,
        DEST.RgcOrden       = SRC.RgcOrden

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (RgcId, TrtCodigo, CueCodigo, RgcNaturaleza, RgcFilaFormula, RgcOrden)
    VALUES 
        (SRC.RgcId, SRC.TrtCodigo, SRC.CueCodigo, SRC.RgcNaturaleza, SRC.RgcFilaFormula, SRC.RgcOrden);

    SET IDENTITY_INSERT [dbo].[Cont_ReglasContables] OFF;

    COMMIT TRAN;
    PRINT '    ✅ Cont_ReglasContables OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Cont_ReglasContables] OFF;
    PRINT '    ❌ ERROR Cont_ReglasContables: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 14. Cont_ReglasAsiento  (PK: RasId, IDENTITY)
-- ============================================================================
PRINT '>>> [14/21] Cont_ReglasAsiento';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[Cont_ReglasAsiento] ON;

    MERGE INTO [SecureAppDB].[dbo].[Cont_ReglasAsiento] AS DEST
    USING (
        SELECT RasId, EvtCodigo, CueCodigo, RasNaturaleza, RasFormula, RasOrden
        FROM [SecureAppDB2205].[dbo].[Cont_ReglasAsiento]
    ) AS SRC ON DEST.RasId = SRC.RasId

    WHEN MATCHED THEN UPDATE SET
        DEST.EvtCodigo      = SRC.EvtCodigo,
        DEST.CueCodigo      = SRC.CueCodigo,
        DEST.RasNaturaleza  = SRC.RasNaturaleza,
        DEST.RasFormula     = SRC.RasFormula,
        DEST.RasOrden       = SRC.RasOrden

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (RasId, EvtCodigo, CueCodigo, RasNaturaleza, RasFormula, RasOrden)
    VALUES 
        (SRC.RasId, SRC.EvtCodigo, SRC.CueCodigo, SRC.RasNaturaleza, SRC.RasFormula, SRC.RasOrden);

    SET IDENTITY_INSERT [dbo].[Cont_ReglasAsiento] OFF;

    COMMIT TRAN;
    PRINT '    ✅ Cont_ReglasAsiento OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Cont_ReglasAsiento] OFF;
    PRINT '    ❌ ERROR Cont_ReglasAsiento: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 15. Articulos  (PK: ProIdProducto, IDENTITY)
--     ⚠️ Referenciada por Ordenes, PreciosBase, PlanesMetros
-- ============================================================================
PRINT '>>> [15/21] Articulos';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[Articulos] ON;

    MERGE INTO [SecureAppDB].[dbo].[Articulos] AS DEST
    USING (
        SELECT ProIdProducto, CodArticulo, IDProdReact, SupFlia, Grupo, CodStock,
               Descripcion, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda,
               ProCodigoOdooProducto, UniIdUnidad, borrar
        FROM [SecureAppDB2205].[dbo].[Articulos]
    ) AS SRC ON DEST.ProIdProducto = SRC.ProIdProducto

    WHEN MATCHED THEN UPDATE SET
        DEST.CodArticulo          = SRC.CodArticulo,
        DEST.IDProdReact          = SRC.IDProdReact,
        DEST.SupFlia              = SRC.SupFlia,
        DEST.Grupo                = SRC.Grupo,
        DEST.CodStock             = SRC.CodStock,
        DEST.Descripcion          = SRC.Descripcion,
        DEST.Mostrar              = SRC.Mostrar,
        DEST.anchoimprimible      = SRC.anchoimprimible,
        DEST.LLEVAPAPEL           = SRC.LLEVAPAPEL,
        DEST.MonIdMoneda          = SRC.MonIdMoneda,
        DEST.ProCodigoOdooProducto = SRC.ProCodigoOdooProducto,
        DEST.UniIdUnidad          = SRC.UniIdUnidad,
        DEST.borrar               = SRC.borrar

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (ProIdProducto, CodArticulo, IDProdReact, SupFlia, Grupo, CodStock, Descripcion, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda, ProCodigoOdooProducto, UniIdUnidad, borrar)
    VALUES 
        (SRC.ProIdProducto, SRC.CodArticulo, SRC.IDProdReact, SRC.SupFlia, SRC.Grupo, SRC.CodStock, SRC.Descripcion, SRC.Mostrar, SRC.anchoimprimible, SRC.LLEVAPAPEL, SRC.MonIdMoneda, SRC.ProCodigoOdooProducto, SRC.UniIdUnidad, SRC.borrar);

    SET IDENTITY_INSERT [dbo].[Articulos] OFF;

    COMMIT TRAN;
    PRINT '    ✅ Articulos OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Articulos] OFF;
    PRINT '    ❌ ERROR Articulos: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 16. PreciosBase  (PK: ProIdProducto - NO identity, FK → Articulos)
--     ⚠️ Requiere que Articulos ya esté poblada (paso 15)
-- ============================================================================
PRINT '>>> [16/21] PreciosBase';
BEGIN TRY
    BEGIN TRAN;

    -- Match por clave única natural (CodArticulo + Moneda)
    -- en vez de ID, para evitar violar UQ_PreciosBase_Cod_Moneda
    MERGE INTO [SecureAppDB].[dbo].[PreciosBase] AS DEST
    USING (
        SELECT ProIdProducto, CodArticulo, Precio, Moneda, 
               MonIdMoneda, UltimaActualizacion
        FROM [SecureAppDB2205].[dbo].[PreciosBase]
    ) AS SRC ON DEST.CodArticulo = SRC.CodArticulo 
            AND ISNULL(DEST.Moneda,'') = ISNULL(SRC.Moneda,'')

    WHEN MATCHED THEN UPDATE SET
        DEST.ProIdProducto       = SRC.ProIdProducto,
        DEST.Precio              = SRC.Precio,
        DEST.MonIdMoneda         = SRC.MonIdMoneda,
        DEST.UltimaActualizacion = SRC.UltimaActualizacion

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (ProIdProducto, CodArticulo, Precio, Moneda, MonIdMoneda, UltimaActualizacion)
    VALUES 
        (SRC.ProIdProducto, SRC.CodArticulo, SRC.Precio, SRC.Moneda, SRC.MonIdMoneda, SRC.UltimaActualizacion);

    COMMIT TRAN;
    PRINT '    ✅ PreciosBase OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ❌ ERROR PreciosBase: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 17. PerfilesPrecios  (PK: PerfilId, probable IDENTITY)
-- ============================================================================
PRINT '>>> [17/21] PerfilesPrecios';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[PerfilesPrecios] ON;

    MERGE INTO [SecureAppDB].[dbo].[PerfilesPrecios] AS DEST
    USING (
        SELECT ID, Nombre, Descripcion, Activo, EsGlobal, Categoria
        FROM [SecureAppDB2205].[dbo].[PerfilesPrecios]
    ) AS SRC ON DEST.ID = SRC.ID

    WHEN MATCHED THEN UPDATE SET
        DEST.Nombre       = SRC.Nombre,
        DEST.Descripcion  = SRC.Descripcion,
        DEST.Activo       = SRC.Activo,
        DEST.EsGlobal     = SRC.EsGlobal,
        DEST.Categoria    = SRC.Categoria

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (ID, Nombre, Descripcion, Activo, EsGlobal, Categoria)
    VALUES 
        (SRC.ID, SRC.Nombre, SRC.Descripcion, SRC.Activo, SRC.EsGlobal, SRC.Categoria);

    SET IDENTITY_INSERT [dbo].[PerfilesPrecios] OFF;

    COMMIT TRAN;
    PRINT '    ✅ PerfilesPrecios OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[PerfilesPrecios] OFF;
    PRINT '    ❌ ERROR PerfilesPrecios: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 18. PreciosEspeciales  (PK: PrecioEspId, probable IDENTITY)
--     ⚠️ FK → PerfilesPrecios, Clientes
-- ============================================================================
PRINT '>>> [18/21] PreciosEspeciales';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[PreciosEspeciales] ON;

    MERGE INTO [SecureAppDB].[dbo].[PreciosEspeciales] AS DEST
    USING (
        SELECT ID, FechaCreacion, UltimaActualizacion, PerfilID, PerfilesIDs,
               CliIdCliente, ClienteID, NombreCliente
        FROM [SecureAppDB2205].[dbo].[PreciosEspeciales]
    ) AS SRC ON DEST.ID = SRC.ID

    WHEN MATCHED THEN UPDATE SET
        DEST.FechaCreacion        = SRC.FechaCreacion,
        DEST.UltimaActualizacion  = SRC.UltimaActualizacion,
        DEST.PerfilID             = SRC.PerfilID,
        DEST.PerfilesIDs          = SRC.PerfilesIDs,
        DEST.CliIdCliente         = SRC.CliIdCliente,
        DEST.ClienteID            = SRC.ClienteID,
        DEST.NombreCliente        = SRC.NombreCliente

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (ID, FechaCreacion, UltimaActualizacion, PerfilID, PerfilesIDs, CliIdCliente, ClienteID, NombreCliente)
    VALUES 
        (SRC.ID, SRC.FechaCreacion, SRC.UltimaActualizacion, SRC.PerfilID, SRC.PerfilesIDs, SRC.CliIdCliente, SRC.ClienteID, SRC.NombreCliente);

    SET IDENTITY_INSERT [dbo].[PreciosEspeciales] OFF;

    COMMIT TRAN;
    PRINT '    ✅ PreciosEspeciales OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[PreciosEspeciales] OFF;
    PRINT '    ❌ ERROR PreciosEspeciales: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 19. PreciosEspecialesItems  (PK: ItemId, probable IDENTITY)
--     ⚠️ FK → PreciosEspeciales, Articulos
-- ============================================================================
PRINT '>>> [19/21] PreciosEspecialesItems';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[PreciosEspecialesItems] ON;

    MERGE INTO [SecureAppDB].[dbo].[PreciosEspecialesItems] AS DEST
    USING (
        SELECT ItemID, TipoRegla, Valor, MonIdMoneda, MinCantidad,
               ProIdProducto, CliIdCliente, CodGrupo, ClienteID, CodArticulo
        FROM [SecureAppDB2205].[dbo].[PreciosEspecialesItems]
    ) AS SRC ON DEST.ItemID = SRC.ItemID

    WHEN MATCHED THEN UPDATE SET
        DEST.TipoRegla     = SRC.TipoRegla,
        DEST.Valor         = SRC.Valor,
        DEST.MonIdMoneda   = SRC.MonIdMoneda,
        DEST.MinCantidad   = SRC.MinCantidad,
        DEST.ProIdProducto = SRC.ProIdProducto,
        DEST.CliIdCliente  = SRC.CliIdCliente,
        DEST.CodGrupo      = SRC.CodGrupo,
        DEST.ClienteID     = SRC.ClienteID,
        DEST.CodArticulo   = SRC.CodArticulo

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (ItemID, TipoRegla, Valor, MonIdMoneda, MinCantidad, ProIdProducto, CliIdCliente, CodGrupo, ClienteID, CodArticulo)
    VALUES 
        (SRC.ItemID, SRC.TipoRegla, SRC.Valor, SRC.MonIdMoneda, SRC.MinCantidad, SRC.ProIdProducto, SRC.CliIdCliente, SRC.CodGrupo, SRC.ClienteID, SRC.CodArticulo);

    SET IDENTITY_INSERT [dbo].[PreciosEspecialesItems] OFF;

    COMMIT TRAN;
    PRINT '    ✅ PreciosEspecialesItems OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[PreciosEspecialesItems] OFF;
    PRINT '    ❌ ERROR PreciosEspecialesItems: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 20. ConfigEstados  (PK: EstadoID - manejo dinámico de IDENTITY)
-- ============================================================================
PRINT '>>> [20/21] ConfigEstados';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECTPROPERTY(OBJECT_ID('dbo.ConfigEstados'), 'TableHasIdentity') = 1
    BEGIN
        EXEC('SET IDENTITY_INSERT [dbo].[ConfigEstados] ON');
    END

    MERGE INTO [SecureAppDB].[dbo].[ConfigEstados] AS DEST
    USING (
        SELECT EstadoID, AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado
        FROM [SecureAppDB2205].[dbo].[ConfigEstados]
    ) AS SRC ON DEST.EstadoID = SRC.EstadoID

    WHEN MATCHED THEN UPDATE SET
        DEST.AreaID      = SRC.AreaID,
        DEST.Nombre      = SRC.Nombre,
        DEST.ColorHex    = SRC.ColorHex,
        DEST.Orden       = SRC.Orden,
        DEST.EsFinal     = SRC.EsFinal,
        DEST.TipoEstado  = SRC.TipoEstado

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (EstadoID, AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado)
    VALUES 
        (SRC.EstadoID, SRC.AreaID, SRC.Nombre, SRC.ColorHex, SRC.Orden, SRC.EsFinal, SRC.TipoEstado);

    IF OBJECTPROPERTY(OBJECT_ID('dbo.ConfigEstados'), 'TableHasIdentity') = 1
    BEGIN
        EXEC('SET IDENTITY_INSERT [dbo].[ConfigEstados] OFF');
    END

    COMMIT TRAN;
    PRINT '    ✅ ConfigEstados OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ❌ ERROR ConfigEstados: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- 21. Modulos  (PK: IdModulo, IDENTITY)
-- ============================================================================
PRINT '>>> [21/21] Modulos';
BEGIN TRY
    BEGIN TRAN;

    SET IDENTITY_INSERT [dbo].[Modulos] ON;

    MERGE INTO [SecureAppDB].[dbo].[Modulos] AS DEST
    USING (
        SELECT IdModulo, Titulo, IdPadre, Ruta, Icono, IndiceOrden
        FROM [SecureAppDB2205].[dbo].[Modulos]
    ) AS SRC ON DEST.IdModulo = SRC.IdModulo

    WHEN MATCHED THEN UPDATE SET
        DEST.Titulo       = SRC.Titulo,
        DEST.IdPadre      = SRC.IdPadre,
        DEST.Ruta         = SRC.Ruta,
        DEST.Icono        = SRC.Icono,
        DEST.IndiceOrden  = SRC.IndiceOrden

    WHEN NOT MATCHED BY TARGET THEN INSERT 
        (IdModulo, Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES 
        (SRC.IdModulo, SRC.Titulo, SRC.IdPadre, SRC.Ruta, SRC.Icono, SRC.IndiceOrden);

    SET IDENTITY_INSERT [dbo].[Modulos] OFF;

    COMMIT TRAN;
    PRINT '    ✅ Modulos OK';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Modulos] OFF;
    PRINT '    ❌ ERROR Modulos: ' + ERROR_MESSAGE();
END CATCH
GO

-- ============================================================================
-- RESUMEN FINAL
-- ============================================================================
PRINT '';
PRINT '════════════════════════════════════════════════════════════════';
PRINT ' MERGE COMPLETADO';
PRINT ' Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '════════════════════════════════════════════════════════════════';
PRINT '';
PRINT ' Tablas procesadas: 21';
PRINT ' Fuente:  SecureAppDB2205';
PRINT ' Destino: SecureAppDB';
PRINT '';
PRINT ' ⚠️ Revise los mensajes anteriores para detectar errores.';
PRINT ' ⚠️ Para tablas de precios (16-19): si alguna no existe aún';
PRINT '    en producción, debe crearlas antes de ejecutar.';
PRINT '════════════════════════════════════════════════════════════════';
GO
