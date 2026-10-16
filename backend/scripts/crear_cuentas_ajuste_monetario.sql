/* ============================================================================
   Cuentas contables para AJUSTES MONETARIOS de cobro (redondeo / pago cerrado)
   ----------------------------------------------------------------------------
   Usadas por procesarCobro (backend/services/cajaService.js) cuando el importe
   a cobrar difiere del valor real de las órdenes/factura:
     - Cobra de MENOS -> Descuento concedido -> 5.2.03 (DEBE)
     - Cobra de MÁS   -> Recargo / recupero  -> 4.2.2  (HABER)

   Idempotente: solo inserta si el código no existe. Seguro para producción.
   CueId es IDENTITY (no se especifica).
   ============================================================================ */

SET NOCOUNT ON;

-- 5.2.03  Descuentos y Bonificaciones Concedidos  (PERDIDA)
IF NOT EXISTS (SELECT 1 FROM dbo.Cont_PlanCuentas WHERE CueCodigo = '5.2.03')
BEGIN
    INSERT INTO dbo.Cont_PlanCuentas
        (CueCodigo, CueNombre, CueNivel, CueTipoBase, CueMoneda, CueImputable, CueActiva)
    VALUES
        ('5.2.03', 'Descuentos y Bonificaciones Concedidos', 3, 'PERDIDA', 'AMBAS', 1, 1);
    PRINT 'Cuenta 5.2.03 creada.';
END
ELSE
    PRINT 'Cuenta 5.2.03 ya existe, se omite.';

-- 4.2.2  Recargos y Recuperos  (GANANCIA)
IF NOT EXISTS (SELECT 1 FROM dbo.Cont_PlanCuentas WHERE CueCodigo = '4.2.2')
BEGIN
    INSERT INTO dbo.Cont_PlanCuentas
        (CueCodigo, CueNombre, CueNivel, CueTipoBase, CueMoneda, CueImputable, CueActiva)
    VALUES
        ('4.2.2', 'Recargos y Recuperos', 3, 'GANANCIA', 'AMBAS', 1, 1);
    PRINT 'Cuenta 4.2.2 creada.';
END
ELSE
    PRINT 'Cuenta 4.2.2 ya existe, se omite.';

-- Verificación
SELECT CueId, CueCodigo, CueNombre, CueTipoBase, CueMoneda, CueImputable, CueActiva
FROM   dbo.Cont_PlanCuentas
WHERE  CueCodigo IN ('5.2.03', '4.2.2')
ORDER  BY CueCodigo;
