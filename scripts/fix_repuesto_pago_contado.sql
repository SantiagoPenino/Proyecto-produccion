/* ============================================================================
   fix_repuesto_pago_contado.sql
   ----------------------------------------------------------------------------
   Repara un "cobro contado que no escribio el movimiento" — mismo patron
   que el propio equipo ya uso varias veces en esta base (buscar
   "repuesto: el cobro contado no habia escrito el movimiento" en
   MovimientosCuenta): un VTA_CAJA quedo sin su PAGO correspondiente,
   aunque el documento este Aceptado DGI / cobrado de verdad.

   Agrega el PAGO faltante, exactamente por el mismo importe del VTA_CAJA
   (la guarda lo exige), con la misma leyenda que uso el equipo.

   MODO DE USO: @Aplicar=0 primero, @Aplicar=1 para aplicar.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar        BIT = 0;
DECLARE @UsuarioAlta    INT = 1;
DECLARE @CueIdCuenta    INT = 1526;                 -- <<< editar: andrea silva $
DECLARE @DocIdDocumento INT = 3447;                 -- <<< editar: PC-2279
DECLARE @Concepto       NVARCHAR(300) = N'Pago (Pedidos Caja): PC-2279 (repuesto: el cobro contado no habia escrito el movimiento)';  -- <<< editar texto/doc

-- El importe se toma del propio VTA_CAJA del documento, no se escribe a mano.
DECLARE @Importe DECIMAL(18,4);
SELECT @Importe = -SUM(MovImporte) FROM dbo.MovimientosCuenta WITH(NOLOCK)
WHERE DocIdDocumento = @DocIdDocumento AND CueIdCuenta = @CueIdCuenta AND MovTipo = 'VTA_CAJA'
  AND (MovAnulado IS NULL OR MovAnulado = 0);

IF @Importe IS NULL OR @Importe <= 0
BEGIN
    PRINT 'No se encontro VTA_CAJA activo para este documento/cuenta. No se hace nada.';
    RETURN;
END

-- Guarda: confirmar que sigue sin pago
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WITH(NOLOCK)
           WHERE DocIdDocumento = @DocIdDocumento AND CueIdCuenta = @CueIdCuenta
             AND MovTipo IN ('PAGO','ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado = 0))
BEGIN
    PRINT 'Ya existe un pago para este documento en esta cuenta. No se toca nada — revisar a mano.';
    RETURN;
END

SELECT 'Importe a reponer (del propio VTA_CAJA)' AS etapa, Importe = CAST(@Importe AS DECIMAL(18,2));

SELECT 'ANTES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta = @CueIdCuenta;

IF @Aplicar = 0
BEGIN
    PRINT 'MODO SOLO LECTURA (@Aplicar=0): no se escribio nada. Revisar el importe de arriba antes de aplicar.';
    RETURN;
END

DECLARE @MovId INT, @SaldoRes DECIMAL(18,4);
EXEC dbo.SP_RegistrarMovimiento
     @CueIdCuenta = @CueIdCuenta, @MovTipo = 'PAGO',
     @MovConcepto = @Concepto,
     @MovImporte = @Importe, @MovUsuarioAlta = @UsuarioAlta, @DocIdDocumento = @DocIdDocumento,
     @MovIdGenerado = @MovId OUTPUT, @SaldoResultante = @SaldoRes OUTPUT;

SELECT 'DESPUES' AS etapa, cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
       SaldoLibro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc WITH(NOLOCK)
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta = @CueIdCuenta;
