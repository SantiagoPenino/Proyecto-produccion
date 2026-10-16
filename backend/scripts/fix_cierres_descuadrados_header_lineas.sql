/*
  fix_cierres_descuadrados_header_lineas.sql
  ─────────────────────────────────────────────────────────────────────────
  Repara los documentos de cierre de ciclo cuyo TOTAL del cabezal (que sale
  de MovimientosCuenta) no coincide con la suma de las LÍNEAS (que sale de
  la pre-factura / PedidosCobranzaDetalle). El importe correcto es el de las
  LÍNEAS: es lo que muestra el PDF y lo que se declara/declaró a DGI
  (sisnetService arma el CFE solo con las líneas).

  Causas raíz (ya corregidas en código en este mismo commit):
    1. El ajuste manual de precios del cierre actualizaba PedidosCobranza-
       Detalle pero el UPDATE a MovimientosCuenta joineaba
       pc.NoDocERP ('9669') = Ordenes.CodigoOrden ('SUB-9669') → 0 filas.
       Casos: TDH ET-3815 (852,71 USD), Favio Curbelo FA-448 (236,10 USD).
    2. El total del cierre sumaba TODO débito sin documento (PAGO_CRUZADO
       negativos, reversas ENTREGA), que no aparecen en las líneas ni se
       vinculan al doc. Caso: CAPA ET-3719 (402,17 USD × cot 40 = 16.086,74 $).

  QUÉ HACE:
    CASO 1  TDH ET-3815  (doc 6587)  → cabezal/deuda/movs a 2.589,87 USD
    CASO 2  CAPA ET-3719 (doc 6455)  → cabezal/deuda/mov cierre a 54.708,00 $
    CASO 3  Favio FA-448 (doc 6576)  → cabezal/deuda/movs a 934,78 USD y
                                       deuda saldada (ya pagó 934,78; los
                                       236,10 pendientes eran fantasma)
    CASO 5  Ciclos ABIERTOS 324/374/380 → realinear movs ORDEN al precio
                                       vigente para que su cierre nazca cuadrado
    En cada mov corregido se ajusta CueSaldoActual por el delta.

  QUÉ NO TOCA:
    - FA-360 (Gustavo Casas): cobraron 297,72 USD pero a DGI fueron 234,80
      (2 órdenes entraron al ciclo después de armar la pre-factura). Decisión
      de negocio pendiente: NC/saldo a favor de 62,92 o regularizar con el
      contador. NO se toca acá.
    - De Zuasnabar SUB-10342/-R1 (dif 5,68): movimientos partidos y repo -R1
      compartiendo pedido; revisar a ojo, monto chico.

  CÓMO CORRERLO EN PRODUCCIÓN:
    1. Ejecutar tal cual. Queda la transacción ABIERTA.
    2. Revisar los PRINT y el SELECT de verificación final.
    3. Si cuadra: ejecutar "COMMIT TRAN;". Si no: "ROLLBACK TRAN;".
  ─────────────────────────────────────────────────────────────────────────
*/

SET NOCOUNT ON;
-- Si CUALQUIER cosa falla a mitad de camino (incluido un corte de conexión),
-- aborta el batch entero y revierte TODO: imposible quedar a medias.
SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @t DECIMAL(18,4), @s DECIMAL(18,4), @i DECIMAL(18,4);
DECLARE @delta DECIMAL(18,4), @msg VARCHAR(500);

-- Tabla de deltas por cuenta para ajustar CueSaldoActual al final
DECLARE @ajustes TABLE (CueIdCuenta INT, Delta DECIMAL(18,4));

/* ══════════ CASO 1: TDH ET-3815 (doc 6587, cta 72, ciclo 352, USD) ══════════ */

SELECT @t = SUM(DcdTotal) FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = 6587;
SET @s = ROUND(@t / 1.22, 2);
SET @i = @t - @s;
PRINT 'CASO 1 TDH ET-3815: total por lineas = ' + CAST(@t AS VARCHAR);  -- esperado 2589.87

-- 1a. Movimientos ORDEN al precio vigente del pedido (match por OrdenID del detalle)
UPDATE m
SET m.MovImporte = -pc.MontoTotal
OUTPUT inserted.CueIdCuenta, deleted.MovImporte - inserted.MovImporte INTO @ajustes (CueIdCuenta, Delta)
FROM dbo.MovimientosCuenta m
JOIN dbo.Ordenes o        ON o.OrdenID = m.OrdIdOrden
JOIN (SELECT DISTINCT PedidoCobranzaID, OrdenID FROM dbo.PedidosCobranzaDetalle) pcd
                          ON pcd.OrdenID = o.OrdenID
JOIN dbo.PedidosCobranza pc ON pc.ID = pcd.PedidoCobranzaID
WHERE m.DocIdDocumento = 6587 AND m.MovTipo = 'ORDEN'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND ABS(ABS(m.MovImporte) - pc.MontoTotal) > 0.01;
PRINT '  movs ORDEN corregidos: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' (esperado 20)';

-- 1b. Movimiento de facturacion VTA_CAJA
UPDATE m SET m.MovImporte = -@t
OUTPUT inserted.CueIdCuenta, deleted.MovImporte - inserted.MovImporte INTO @ajustes (CueIdCuenta, Delta)
FROM dbo.MovimientosCuenta m
WHERE m.MovIdMovimiento = 28708 AND m.DocIdDocumento = 6587 AND m.MovTipo = 'VTA_CAJA';

-- 1c. Cabezal + flag pagado real (no se cobró nada todavía)
UPDATE dbo.DocumentosContables
SET DocTotal = @t, DocSubtotal = @s, DocImpuestos = @i, DocPagado = 0
WHERE DocIdDocumento = 6587;

-- 1d. Deuda
UPDATE dbo.DeudaDocumento
SET DDeImporteOriginal = @t, DDeImportePendiente = @t
WHERE DDeIdDocumento = 8879 AND DocIdDocumento = 6587;

-- 1e. Ciclo
UPDATE dbo.CiclosCredito SET CicTotalOrdenes = @t, CicSaldoFacturar = @t WHERE CicIdCiclo = 352;


/* ══════════ CASO 2: CAPA ET-3719 (doc 6455, deuda en cta 452 UYU, ciclo 297) ══════════ */

SELECT @t = SUM(DcdTotal) FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = 6455;
SET @s = ROUND(@t / 1.22, 2);
SET @i = @t - @s;
PRINT 'CASO 2 CAPA ET-3719: total por lineas = ' + CAST(@t AS VARCHAR);  -- esperado 54708.00

-- 2a. Movimiento CIERRE_CICLO en la cuenta destino UYU (los movs ORDEN de este doc ya estan bien)
UPDATE m SET m.MovImporte = -@t
OUTPUT inserted.CueIdCuenta, deleted.MovImporte - inserted.MovImporte INTO @ajustes (CueIdCuenta, Delta)
FROM dbo.MovimientosCuenta m
WHERE m.MovIdMovimiento = 28167 AND m.DocIdDocumento = 6455 AND m.MovTipo = 'CIERRE_CICLO';

-- 2b. Cabezal
UPDATE dbo.DocumentosContables
SET DocTotal = @t, DocSubtotal = @s, DocImpuestos = @i, DocPagado = 0
WHERE DocIdDocumento = 6455;

-- 2c. Deuda
UPDATE dbo.DeudaDocumento
SET DDeImporteOriginal = @t, DDeImportePendiente = @t
WHERE DDeIdDocumento = 8746 AND DocIdDocumento = 6455;

-- 2d. Ciclo (en USD de la cuenta origen: 54708 / 40 = 1367.70)
UPDATE dbo.CiclosCredito SET CicTotalOrdenes = 1367.70, CicSaldoFacturar = 1367.70 WHERE CicIdCiclo = 297;
-- Los debitos PAGO_CRUZADO/ENTREGA del ciclo 297 quedan como debitos de cuenta
-- (correcto); con el fix de codigo ya no se van a facturar en el proximo cierre.


/* ══════════ CASO 3: Favio Curbelo FA-448 (doc 6576, USD, ACEPTADO_DGI con 934,78) ══════════ */

SELECT @t = SUM(DcdTotal) FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = 6576;
SET @s = ROUND(@t / 1.22, 2);
SET @i = @t - @s;
PRINT 'CASO 3 Favio FA-448: total por lineas = ' + CAST(@t AS VARCHAR);  -- esperado 934.78

-- 3a. Movs ORDEN al precio vigente (SUB-9762, SUB-10041, SUB-10941)
UPDATE m
SET m.MovImporte = -pc.MontoTotal
OUTPUT inserted.CueIdCuenta, deleted.MovImporte - inserted.MovImporte INTO @ajustes (CueIdCuenta, Delta)
FROM dbo.MovimientosCuenta m
JOIN dbo.Ordenes o        ON o.OrdenID = m.OrdIdOrden
JOIN (SELECT DISTINCT PedidoCobranzaID, OrdenID FROM dbo.PedidosCobranzaDetalle) pcd
                          ON pcd.OrdenID = o.OrdenID
JOIN dbo.PedidosCobranza pc ON pc.ID = pcd.PedidoCobranzaID
WHERE m.DocIdDocumento = 6576 AND m.MovTipo = 'ORDEN'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND ABS(ABS(m.MovImporte) - pc.MontoTotal) > 0.01;
PRINT '  movs ORDEN corregidos: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' (esperado 3)';

-- 3b. Movimiento CIERRE_CICLO
UPDATE m SET m.MovImporte = -@t
OUTPUT inserted.CueIdCuenta, deleted.MovImporte - inserted.MovImporte INTO @ajustes (CueIdCuenta, Delta)
FROM dbo.MovimientosCuenta m
WHERE m.MovIdMovimiento = 28688 AND m.DocIdDocumento = 6576 AND m.MovTipo = 'CIERRE_CICLO';

-- 3c. Cabezal: total real + pagado (ya pago 934,78, el pendiente 236,10 era fantasma)
UPDATE dbo.DocumentosContables
SET DocTotal = @t, DocSubtotal = @s, DocImpuestos = @i, DocPagado = 1
WHERE DocIdDocumento = 6576;

-- 3d. Deuda saldada
UPDATE dbo.DeudaDocumento
SET DDeImporteOriginal = @t,
    DDeImportePendiente = 0,
    DDeEstado = 'COBRADO',
    DDeFechaCobro = ISNULL((SELECT MAX(MovFecha) FROM dbo.MovimientosCuenta
                            WHERE MovTipo = 'PAGO' AND MovObservaciones LIKE '%DeudaDoc #8878%'), GETDATE()),
    DDeObservaciones = CASE WHEN ISNULL(DDeObservaciones,'') LIKE '%fix_cierres_descuadrados%' THEN DDeObservaciones
                            ELSE ISNULL(DDeObservaciones,'') + ' | Original corregido de 1170.88 a 934.78 (ajuste manual cierre no propagado a movs). fix_cierres_descuadrados_header_lineas.sql' END
WHERE DDeIdDocumento = 8878 AND DocIdDocumento = 6576;

-- 3e. Ciclo del doc
UPDATE cc SET cc.CicTotalOrdenes = @t, cc.CicSaldoFacturar = @t
FROM dbo.CiclosCredito cc
JOIN dbo.DocumentosContables dc ON dc.CicIdCiclo = cc.CicIdCiclo
WHERE dc.DocIdDocumento = 6576;

-- ⚠️ Favio: su CueSaldoActual ya fue corregido a mano antes (decision de negocio,
-- fix_favio_curbelo_*.sql). El ajuste automatico de saldo de abajo le suma el
-- delta de ESTOS movs (+472,20). Si no corresponde por la correccion anterior,
-- borrar su cuenta de @ajustes aca:
-- DELETE FROM @ajustes WHERE CueIdCuenta IN (SELECT CueIdCuenta FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 8878);


/* ══════════ CASO 5: ciclos ABIERTOS con movs desalineados del precio vigente ══════════ */
-- Tamara Flores (ciclo 374), Fernando Gandini (380), Rdssport (324).
-- ⚠️ Rdssport va al ALZA (el precio se subio despues de contabilizar):
--    SUB-4730 143,50 → 257,50 y SUB-10536 883,68 → 1023,54. Si esos precios
--    nuevos no son los que corresponde cobrar, sacar el ciclo 324 de la lista.

UPDATE m
SET m.MovImporte = -pc.MontoTotal
OUTPUT inserted.CueIdCuenta, deleted.MovImporte - inserted.MovImporte INTO @ajustes (CueIdCuenta, Delta)
FROM dbo.MovimientosCuenta m
JOIN dbo.Ordenes o        ON o.OrdenID = m.OrdIdOrden
JOIN (SELECT DISTINCT PedidoCobranzaID, OrdenID FROM dbo.PedidosCobranzaDetalle) pcd
                          ON pcd.OrdenID = o.OrdenID
JOIN dbo.PedidosCobranza pc ON pc.ID = pcd.PedidoCobranzaID
WHERE m.CicIdCiclo IN (324, 374, 380)
  AND m.MovTipo = 'ORDEN'
  AND m.DocIdDocumento IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND ABS(ABS(m.MovImporte) - pc.MontoTotal) > 0.5
  -- solo ordenes con UN unico mov vivo en el ciclo (particiones no se tocan)
  AND 1 = (SELECT COUNT(*) FROM dbo.MovimientosCuenta m2
           WHERE m2.OrdIdOrden = m.OrdIdOrden AND m2.CicIdCiclo = m.CicIdCiclo
             AND m2.MovTipo = 'ORDEN' AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0));
PRINT 'CASO 5 ciclos abiertos: movs realineados = ' + CAST(@@ROWCOUNT AS VARCHAR) + ' (esperado 6)';


/* ══════════ Ajuste de CueSaldoActual por los deltas de todos los movs tocados ══════════ */
-- delta = importe_viejo - importe_nuevo; el mov nuevo es MENOS negativo (o mas),
-- el saldo guardado debe moverse por (nuevo - viejo) = -delta.

UPDATE cc
SET cc.CueSaldoActual = cc.CueSaldoActual - a.TotalDelta
FROM dbo.CuentasCliente cc
JOIN (SELECT CueIdCuenta, SUM(Delta) AS TotalDelta FROM @ajustes GROUP BY CueIdCuenta) a
  ON a.CueIdCuenta = cc.CueIdCuenta;

SELECT a.CueIdCuenta, SUM(a.Delta) AS DeltaAplicadoAlSaldo_conSignoInvertido
FROM @ajustes a GROUP BY a.CueIdCuenta;


/* ══════════ VERIFICACIÓN ══════════ */
SELECT dc.DocIdDocumento, dc.DocSerie + '-' + dc.DocNumero AS Doc, dc.DocTotal,
       x.SumLineas, ROUND(dc.DocTotal - x.SumLineas, 2) AS DiffCabezalLineas,
       dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado, dc.DocPagado,
       mo.SumMovsOrden, mc.MovCierre
FROM dbo.DocumentosContables dc
CROSS APPLY (SELECT SUM(DcdTotal) SumLineas FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = dc.DocIdDocumento) x
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = dc.DocIdDocumento
OUTER APPLY (SELECT SUM(MovImporte) SumMovsOrden FROM dbo.MovimientosCuenta WHERE DocIdDocumento = dc.DocIdDocumento AND MovTipo = 'ORDEN' AND (MovAnulado IS NULL OR MovAnulado = 0)) mo
OUTER APPLY (SELECT SUM(MovImporte) MovCierre   FROM dbo.MovimientosCuenta WHERE DocIdDocumento = dc.DocIdDocumento AND MovTipo IN ('VTA_CAJA','CIERRE_CICLO') AND (MovAnulado IS NULL OR MovAnulado = 0)) mc
WHERE dc.DocIdDocumento IN (6587, 6455, 6576);

PRINT '── Revisar la verificacion: DiffCabezalLineas debe ser 0.00 en los 3 docs. ──';
PRINT '── Luego ejecutar COMMIT TRAN;  (o ROLLBACK TRAN; si algo no cuadra) ──';
-- COMMIT TRAN;
-- ROLLBACK TRAN;
