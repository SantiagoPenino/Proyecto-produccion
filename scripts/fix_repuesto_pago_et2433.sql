/* ============================================================================
   fix_repuesto_pago_et2433.sql
   ----------------------------------------------------------------------------
   ET-2433 (documento 3820, andrea silva CliIdCliente 2564, cuenta 1526 $):
   se emitio como Contado (Transferencia) y quedo Aceptado DGI, pero el
   cobro nunca escribio su movimiento en la cuenta (mismo bug ya reparado a
   mano por el equipo en esta misma cuenta para PC-1804, PC-1890 y PC-2518,
   con la leyenda "repuesto: el cobro contado no habia escrito el
   movimiento" — ver historial). Este script agrega el mismo tipo de
   reparo para ET-2433.

   MODO DE USO: @Aplicar=0 primero para confirmar el estado actual,
   @Aplicar=1 para aplicar.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar     BIT = 0;
DECLARE @UsuarioAlta INT = 1;
DECLARE @CueIdCuenta INT = 1526;
DECLARE @DocIdDocumento INT = 3820;
DECLARE @Importe DECIMAL(18,4) = 8865.98;

-- Guarda: confirmar que sigue sin pago (nadie lo reparo mientras tanto)
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WITH(NOLOCK)
           WHERE DocIdDocumento = @DocIdDocumento AND MovTipo IN ('PAGO','ANTICIPO')
             AND (MovAnulado IS NULL OR MovAnulado = 0))
BEGIN
    PRINT 'Ya existe un pago para este documento. No se toca nada — revisar a mano.';
    RETURN;
END

SELECT 'ANTES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta = @CueIdCuenta;

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Cambiar a @Aplicar=1 para aplicar.';
    RETURN;
END

DECLARE @MovId INT, @SaldoRes DECIMAL(18,4);
EXEC dbo.SP_RegistrarMovimiento
     @CueIdCuenta = @CueIdCuenta, @MovTipo = 'PAGO',
     @MovConcepto = N'Pago (E-Ticket Contado): ET-2433 (repuesto: el cobro contado no habia escrito el movimiento)',
     @MovImporte = @Importe, @MovUsuarioAlta = @UsuarioAlta, @DocIdDocumento = @DocIdDocumento,
     @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @SaldoRes OUTPUT;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta = @CueIdCuenta;
