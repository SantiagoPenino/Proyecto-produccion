/* ============================================================================
   PRODUCCIÓN — Encabezados de documentos con la cuenta de OTRO cliente
   ----------------------------------------------------------------------------
   El código traía fijo `MonIdMoneda = 2 ? 119 : 118` para DocumentosContables.CueIdCuenta
   al crear y editar documentos. 119 y 118 son cuentas reales de los clientes 417 y 2889,
   así que miles de documentos quedaron con una cuenta ajena en el encabezado (28-09-2026:
   en la copia local, 12.842 documentos desde abril). Deudas, movimientos y cobros SÍ
   están en la cuenta correcta; hoy ningún reporte lee esta columna, pero es una mina.

   QUÉ HACE: para cada documento cuya cuenta del encabezado pertenece a otro cliente,
   la re-apunta, en este orden de preferencia:
     1. la cuenta de la DEUDA del documento (si es del cliente del documento);
     2. la cuenta de los MOVIMIENTOS del documento (ídem);
     3. la cuenta principal de DINERO del cliente en la moneda del documento;
     4. si no hay ninguna, se deja como está y se lista.
   No toca importes, estados, deudas, movimientos ni nada fiscal. Solo el encabezado.

   @SoloVista = 1 (default): muestra qué haría y hace ROLLBACK. Poner 0 para aplicar.
   Idempotente: la segunda corrida no encuentra nada. ABRIR DESDE EL DISCO en SSMS.
   ============================================================================ */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SoloVista BIT = 1;

IF @@TRANCOUNT > 0 OR (@@OPTIONS & 2) = 2 BEGIN RAISERROR('Esta ventana ya tiene una transacción abierta o IMPLICIT_TRANSACTIONS activado. Ejecutá:  ROLLBACK TRANSACTION;  SET IMPLICIT_TRANSACTIONS OFF;  y volvé a correr el script completo. No se hizo nada.', 16, 1); RETURN; END

BEGIN TRANSACTION;

/* Documentos con cuenta ajena y su cuenta correcta */
IF OBJECT_ID('tempdb..#Fix') IS NOT NULL DROP TABLE #Fix;
SELECT d.DocIdDocumento, d.CliIdCliente, d.MonIdMoneda, CuentaActual = d.CueIdCuenta, ClienteDeLaCuenta = c.CliIdCliente,
       CuentaNueva = COALESCE(
           (SELECT TOP 1 dd.CueIdCuenta FROM dbo.DeudaDocumento dd JOIN dbo.CuentasCliente c2 ON c2.CueIdCuenta = dd.CueIdCuenta
             WHERE dd.DocIdDocumento = d.DocIdDocumento AND c2.CliIdCliente = d.CliIdCliente ORDER BY dd.DDeIdDocumento DESC),
           (SELECT TOP 1 m.CueIdCuenta FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente c3 ON c3.CueIdCuenta = m.CueIdCuenta
             WHERE m.DocIdDocumento = d.DocIdDocumento AND c3.CliIdCliente = d.CliIdCliente ORDER BY m.MovIdMovimiento DESC),
           (SELECT TOP 1 c4.CueIdCuenta FROM dbo.CuentasCliente c4
             WHERE c4.CliIdCliente = d.CliIdCliente AND c4.CueActiva = 1
               AND c4.CueTipo = CASE WHEN d.MonIdMoneda = 2 THEN 'DINERO_USD' ELSE 'DINERO_UYU' END
             ORDER BY c4.CueEsPrincipal DESC, c4.CueIdCuenta ASC)
       ),
       Origen = CASE
           WHEN EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd JOIN dbo.CuentasCliente c2 ON c2.CueIdCuenta = dd.CueIdCuenta WHERE dd.DocIdDocumento = d.DocIdDocumento AND c2.CliIdCliente = d.CliIdCliente) THEN 'deuda'
           WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente c3 ON c3.CueIdCuenta = m.CueIdCuenta WHERE m.DocIdDocumento = d.DocIdDocumento AND c3.CliIdCliente = d.CliIdCliente) THEN 'movimiento'
           WHEN EXISTS (SELECT 1 FROM dbo.CuentasCliente c4 WHERE c4.CliIdCliente = d.CliIdCliente AND c4.CueActiva = 1 AND c4.CueTipo = CASE WHEN d.MonIdMoneda = 2 THEN 'DINERO_USD' ELSE 'DINERO_UYU' END) THEN 'principal'
           ELSE 'sin cuenta' END
INTO #Fix
FROM dbo.DocumentosContables d
JOIN dbo.CuentasCliente c ON c.CueIdCuenta = d.CueIdCuenta
WHERE c.CliIdCliente <> d.CliIdCliente;

PRINT '-- ANTES --';
SELECT Que = 'Resumen', Documentos = COUNT(*),
       PorDeuda = SUM(CASE WHEN Origen = 'deuda' THEN 1 ELSE 0 END),
       PorMovimiento = SUM(CASE WHEN Origen = 'movimiento' THEN 1 ELSE 0 END),
       PorPrincipal = SUM(CASE WHEN Origen = 'principal' THEN 1 ELSE 0 END),
       SinCuenta = SUM(CASE WHEN Origen = 'sin cuenta' THEN 1 ELSE 0 END),
       Con118o119 = SUM(CASE WHEN CuentaActual IN (118, 119) THEN 1 ELSE 0 END)
FROM #Fix;

SELECT Que = 'Sin cuenta (quedan como están)', f.DocIdDocumento, d.DocSerie, d.DocNumero, d.DocTipo, f.CliIdCliente, f.MonIdMoneda, f.CuentaActual
FROM #Fix f JOIN dbo.DocumentosContables d ON d.DocIdDocumento = f.DocIdDocumento
WHERE f.Origen = 'sin cuenta';

SELECT TOP 20 Que = 'Ejemplos', f.DocIdDocumento, d.DocSerie, d.DocNumero, d.DocTipo, f.CliIdCliente, f.CuentaActual, f.ClienteDeLaCuenta, f.CuentaNueva, f.Origen
FROM #Fix f JOIN dbo.DocumentosContables d ON d.DocIdDocumento = f.DocIdDocumento
WHERE f.CuentaNueva IS NOT NULL ORDER BY f.DocIdDocumento DESC;

/* Cambio */
UPDATE d SET d.CueIdCuenta = f.CuentaNueva
FROM dbo.DocumentosContables d JOIN #Fix f ON f.DocIdDocumento = d.DocIdDocumento
WHERE f.CuentaNueva IS NOT NULL AND f.CuentaNueva <> d.CueIdCuenta;
PRINT 'Encabezados re-apuntados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

PRINT '-- DESPUES --';
SELECT Que = 'Documentos que siguen con cuenta ajena (esperado: solo los "sin cuenta")', Cantidad = COUNT(*)
FROM dbo.DocumentosContables d JOIN dbo.CuentasCliente c ON c.CueIdCuenta = d.CueIdCuenta
WHERE c.CliIdCliente <> d.CliIdCliente;

IF @SoloVista = 1
BEGIN
    ROLLBACK TRANSACTION;
    PRINT '*** VISTA PREVIA: no se guardó nada. Poné @SoloVista = 0 para aplicar. ***';
END
ELSE
BEGIN
    COMMIT TRANSACTION;
    PRINT '*** APLICADO. ***';
END
