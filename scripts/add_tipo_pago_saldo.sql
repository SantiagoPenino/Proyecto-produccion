-- ============================================================================
-- TIPO DE MOVIMIENTO "PAGO_SALDO" (28-08-2026)
-- Debito de una cuenta de la billetera cuando su saldo se usa como MEDIO DE PAGO
-- ("Saldo de cuenta"): pago de deudas, cobro de retiro, venta directa.
-- Antes se registraba como TRANSFERENCIA_SALIDA (la mecanica es la misma: plata
-- que sale del bolsillo, TmoAfectaSaldo = -1), pero el nombre confundia: esto ES
-- un pago, y ahora el tipo lo dice. Las transferencias reales entre cuentas
-- siguen usando TRANSFERENCIA_SALIDA/ENTRADA.
-- Idempotente. Correr en PROD junto con el resto de los scripts de billetera.
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM dbo.TiposMovimiento WHERE TmoId = 'PAGO_SALDO')
INSERT INTO dbo.TiposMovimiento (TmoId, TmoNombre, TmoDescripcion, TmoPrefijo, TmoSecuencia, TmoAfectaSaldo, TmoGeneraDeuda, TmoAplicaRecurso, TmoRequiereDoc, TmoActivo, TmoOrden, TmoFechaAlta)
VALUES ('PAGO_SALDO', N'Pago con saldo de cuenta', N'La plata de una cuenta de la billetera usada como medio de pago (deudas, retiros, ventas). No es plata nueva: consume el saldo a favor.', '', '', -1, 0, 0, 0, 1, 999, GETDATE());
PRINT 'PAGO_SALDO listo.';
