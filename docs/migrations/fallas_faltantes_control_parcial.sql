/* =====================================================================
   FALLAS, FALTANTES Y PARCIALES — Aprobar Control por tandas (extensión, 10-sep-2026)
   ---------------------------------------------------------------------
   Pedido del usuario al probar Corte Láser: quiere controlar y mandar 10 de 30 prendas
   ya hechas a Costura sin terminar de cortar las otras 20. Hoy "Aprobar Control" exige
   controlar el 100% antes de generar ningún bulto (embBoardController.aprobarControl).
   Esto agrega la posibilidad de aprobar POR TANDAS en las áreas donde ya está habilitado
   el envío parcial (ConfiguracionGlobal.AREAS_DESPACHO_PARCIAL): cada tanda genera sus
   bultos y la orden vuelve a poder trabajarse/controlarse para el resto. La aprobación
   final (100% controlado) sigue funcionando exactamente igual que hoy.
   Idempotente.
   ===================================================================== */
SET NOCOUNT ON;

IF COL_LENGTH('dbo.Ordenes', 'CantidadAprobadaBultos') IS NULL
BEGIN
    ALTER TABLE dbo.Ordenes ADD CantidadAprobadaBultos DECIMAL(12,2) NULL;
    PRINT 'Columna Ordenes.CantidadAprobadaBultos agregada.';
END
ELSE PRINT 'Ordenes.CantidadAprobadaBultos ya existía.';
