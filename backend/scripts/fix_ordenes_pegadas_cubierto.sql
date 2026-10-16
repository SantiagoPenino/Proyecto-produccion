/* ============================================================================
   FIX ÓRDENES "PEGADAS" EN CUBIERTO
   ----------------------------------------------------------------------------
   Cuando se revirtió un consumo con el backend viejo (sin reiniciar), se
   devolvieron los metros pero la ORDEN quedó marcada CUBIERTO → no aparece en
   la bandeja de "Órdenes Pendientes de Facturar" (getOrdenesAnticipo la excluye
   por MovObservaciones LIKE 'CUBIERTO%').

   Este script busca órdenes marcadas CUBIERTO / MATERIAL_CUBIERTO cuya ENTREGA
   de cobertura YA NO existe (fue borrada) — o sea quedaron a medio revertir —,
   y las desengancha: revierte servicios (CREDITO_PLAN), restaura el importe
   original, la deuda a PENDIENTE y limpia la marca. La orden vuelve a la bandeja.

   NO toca órdenes que SÍ tienen su cobertura viva (esas están bien).
   Por defecto ROLLBACK. Revisá CONTROL + VERIFICACIÓN y cambiá a COMMIT.
   ============================================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

/* ---- 1) Órdenes CUBIERTO cuya ENTREGA de cobertura ya no existe (pegadas) ---- */
IF OBJECT_ID('tempdb..#pegadas') IS NOT NULL DROP TABLE #pegadas;

SELECT
    o.MovIdMovimiento, o.OrdIdOrden, o.CicIdCiclo,
    CAST(o.MovImporte AS decimal(18,4)) AS MovImporte,
    RTRIM(o.MovObservaciones) AS Obs,
    -- servicios que habían quedado como CREDITO_PLAN vivo para esta orden
    ISNULL((SELECT SUM(c.MovImporte) FROM dbo.MovimientosCuenta c
            WHERE c.OrdIdOrden = o.OrdIdOrden AND c.MovTipo = 'CREDITO_PLAN'
              AND (c.MovAnulado IS NULL OR c.MovAnulado = 0)), 0) AS CreditoVivo
INTO #pegadas
FROM dbo.MovimientosCuenta o
WHERE o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND o.DocIdDocumento IS NULL
  AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
  AND (o.MovObservaciones LIKE 'CUBIERTO%' OR o.MovObservaciones LIKE 'MATERIAL_CUBIERTO%')
  AND o.OrdIdOrden IS NOT NULL
  -- NO existe una ENTREGA de cobertura viva para esta orden (Ref# = su propio MovId)
  AND NOT EXISTS (
      SELECT 1 FROM dbo.MovimientosCuenta e
      WHERE e.OrdIdOrden = o.OrdIdOrden AND e.MovTipo = 'ENTREGA'
        AND (e.MovAnulado IS NULL OR e.MovAnulado = 0)
        AND e.MovObservaciones LIKE '%Ref#' + CAST(o.MovIdMovimiento AS VARCHAR(20)) + '%'
  );

/* ---- 2) CONTROL — qué se va a desenganchar ---- */
SELECT
    RTRIM(ISNULL(od.OrdCodigoOrden, '')) AS Orden,
    RTRIM(ISNULL(od.OrdNombreTrabajo, '')) AS Trabajo,
    p.MovIdMovimiento,
    CAST(ABS(p.MovImporte) AS decimal(18,2)) AS ImporteActual,
    CAST(p.CreditoVivo AS decimal(18,2)) AS ServiciosARevertir,
    CAST(ABS(p.MovImporte) + p.CreditoVivo AS decimal(18,2)) AS ImporteOriginal,
    p.Obs
FROM #pegadas p
LEFT JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = p.OrdIdOrden
ORDER BY Orden;

DECLARE @nPeg INT = (SELECT COUNT(*) FROM #pegadas);
PRINT CONCAT('Órdenes pegadas a desenganchar: ', @nPeg);

/* ---- 3a) Revertir servicios (CREDITO_PLAN) que hayan quedado vivos ---- */
UPDATE cc SET cc.CueSaldoActual = cc.CueSaldoActual - c.MovImporte
FROM dbo.CuentasCliente cc
JOIN dbo.MovimientosCuenta c ON c.CueIdCuenta = cc.CueIdCuenta
JOIN #pegadas p ON p.OrdIdOrden = c.OrdIdOrden
WHERE c.MovTipo = 'CREDITO_PLAN' AND (c.MovAnulado IS NULL OR c.MovAnulado = 0);

UPDATE c SET c.MovAnulado = 1,
       c.MovObservaciones = CONCAT(ISNULL(c.MovObservaciones,''), ' [REVERTIDO]')
FROM dbo.MovimientosCuenta c
JOIN #pegadas p ON p.OrdIdOrden = c.OrdIdOrden
WHERE c.MovTipo = 'CREDITO_PLAN' AND (c.MovAnulado IS NULL OR c.MovAnulado = 0);

/* ---- 3b) Restaurar la ORDEN: importe original + limpiar la marca CUBIERTO ---- */
UPDATE o
SET o.MovImporte       = -(ABS(p.MovImporte) + p.CreditoVivo),
    o.MovObservaciones = NULL
FROM dbo.MovimientosCuenta o
JOIN #pegadas p ON p.MovIdMovimiento = o.MovIdMovimiento;

/* ---- 3c) Restaurar la deuda de la orden → PENDIENTE ---- */
UPDATE dd
SET dd.DDeImportePendiente = ABS(p.MovImporte) + p.CreditoVivo,
    dd.DDeEstado = 'PENDIENTE'
FROM dbo.DeudaDocumento dd
JOIN #pegadas p ON p.OrdIdOrden = dd.OrdIdOrden
WHERE dd.DDeEstado IN ('CANCELADO','CANCELADA','PARCIAL');

/* ---- 3d) Revertir el ciclo (si estaban en uno) ---- */
UPDATE ci
SET ci.CicTotalPagos    = ci.CicTotalPagos - (ABS(p.MovImporte) + p.CreditoVivo),
    ci.CicSaldoFacturar = ci.CicSaldoFacturar + (ABS(p.MovImporte) + p.CreditoVivo)
FROM dbo.CiclosCredito ci
JOIN #pegadas p ON p.CicIdCiclo = ci.CicIdCiclo;

/* ---- 4) VERIFICACIÓN — deben quedar sin marca CUBIERTO y deuda PENDIENTE ---- */
SELECT
    RTRIM(ISNULL(od.OrdCodigoOrden,'')) AS Orden,
    RTRIM(ISNULL(o.MovObservaciones,'(limpio)')) AS ObsAhora,
    (SELECT TOP 1 RTRIM(DDeEstado) FROM dbo.DeudaDocumento WHERE OrdIdOrden = p.OrdIdOrden ORDER BY DDeIdDocumento DESC) AS DeudaAhora
FROM #pegadas p
JOIN dbo.MovimientosCuenta o ON o.MovIdMovimiento = p.MovIdMovimiento
LEFT JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = p.OrdIdOrden
ORDER BY Orden;

DROP TABLE #pegadas;

/* Revisá CONTROL + VERIFICACIÓN. Si está OK, cambiá abajo a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
