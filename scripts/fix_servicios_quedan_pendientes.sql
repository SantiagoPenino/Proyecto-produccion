-- =============================================================================
-- BUG: Al consumir metros en órdenes XSB, el corte y costura desaparecían
--      de la lista de pendientes de facturar.
-- =============================================================================

-- ============================================================
-- PASO 0 — VER QUÉ MOVIMIENTOS ESTÁN MARCADOS COMO CUBIERTO
-- Correr esto primero para confirmar que la orden afectada está ahí.
-- ============================================================
SELECT
  m.MovIdMovimiento,
  cli.Nombre          AS Cliente,
  m.MovObservaciones,
  m.MovImporte,
  m.OrdIdOrden,
  COALESCE(od.OrdCodigoOrden, erp.CodigoOrden) AS Orden,
  m.DocIdDocumento,
  m.MovAnulado
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN  dbo.CuentasCliente cc  WITH(NOLOCK) ON cc.CueIdCuenta  = m.CueIdCuenta
JOIN  dbo.Clientes cli       WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Ordenes erp    WITH(NOLOCK) ON erp.OrdenID = m.OrdIdOrden
LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = m.OrdIdOrden
                                              OR (erp.CodigoOrden IS NOT NULL AND od.OrdCodigoOrden = erp.CodigoOrden)
WHERE m.MovObservaciones LIKE 'CUBIERTO_POR_PLAN%'
  AND m.DocIdDocumento IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY m.MovIdMovimiento DESC;

-- ============================================================
-- PASO 1 — DIAGNÓSTICO COMPLETO
-- Usa los materiales del PLAN (PlanesMetrosArticulosPermitidos)
-- para detectar servicios, no el ProIdProducto de la orden.
-- ============================================================
SELECT
  m.MovIdMovimiento,
  cli.Nombre                                             AS Cliente,
  COALESCE(od.OrdCodigoOrden, erp.CodigoOrden, '?')    AS Orden,
  m.MovObservaciones,
  ABS(m.MovImporte)                                     AS ImporteActual,
  planData.PlanId,
  ROUND(svc.TotalServicios, 2)                          AS ServiciosPendientes,
  ROUND(ABS(m.MovImporte) - svc.TotalServicios, 2)     AS MaterialCubierto,
  dd.DDeEstado                                          AS EstadoDeuda,
  dd.DDeImportePendiente                                AS DeudaActual
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN  dbo.CuentasCliente cc  WITH(NOLOCK) ON cc.CueIdCuenta  = m.CueIdCuenta
JOIN  dbo.Clientes cli       WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Ordenes erp    WITH(NOLOCK) ON erp.OrdenID = m.OrdIdOrden
LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = m.OrdIdOrden
                                              OR (erp.CodigoOrden IS NOT NULL AND od.OrdCodigoOrden = erp.CodigoOrden)
CROSS APPLY (
  -- Extraer el ID del plan de la observación (ej: 'CUBIERTO_POR_PLAN_7' → 7)
  SELECT TRY_CAST(
    SUBSTRING(m.MovObservaciones, LEN('CUBIERTO_POR_PLAN_') + 1, 20)
    AS INT) AS PlanId
) planData
OUTER APPLY (
  -- Servicios = líneas de PedidosCobranzaDetalle cuyo ProId NO está en los materiales del plan
  SELECT ISNULL(SUM(CAST(d.Subtotal AS DECIMAL(18,4))), 0) AS TotalServicios
  FROM dbo.PedidosCobranza pc WITH(NOLOCK)
  JOIN dbo.PedidosCobranzaDetalle d WITH(NOLOCK) ON pc.ID = d.PedidoCobranzaID
  WHERE (d.OrdenID = m.OrdIdOrden
      OR LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(COALESCE(od.OrdCodigoOrden, erp.CodigoOrden))))
    AND d.Subtotal > 0
    AND NOT EXISTS (
      SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
      WHERE pap.PlaIdPlan = planData.PlanId
        AND pap.ProIdProducto = d.ProIdProducto
    )
) svc
OUTER APPLY (
  SELECT TOP 1 DDeEstado, DDeImportePendiente
  FROM dbo.DeudaDocumento WITH(NOLOCK)
  WHERE OrdIdOrden = m.OrdIdOrden AND CueIdCuenta = m.CueIdCuenta
  ORDER BY DDeIdDocumento DESC
) dd
WHERE m.MovObservaciones LIKE 'CUBIERTO_POR_PLAN%'
  AND m.DocIdDocumento IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND svc.TotalServicios > 0
ORDER BY m.MovIdMovimiento DESC;

-- ============================================================
-- PASO 2 — CORRECCIÓN (correr solo si PASO 1 devolvió filas)
-- ============================================================
BEGIN TRANSACTION;

DECLARE
  @movId            INT,
  @cueId            INT,
  @ordId            INT,
  @codOrden         NVARCHAR(50),
  @importeActual    DECIMAL(18,4),
  @totalServicios   DECIMAL(18,4),
  @importeMaterial  DECIMAL(18,4),
  @saldoActual      DECIMAL(18,4),
  @nuevoSaldo       DECIMAL(18,4),
  @ddeId            INT,
  @planId           VARCHAR(20),
  @obsActual        NVARCHAR(300),
  @nuevaObs         NVARCHAR(300);

DECLARE fix_cur CURSOR LOCAL FAST_FORWARD FOR
  SELECT
    m.MovIdMovimiento,
    m.CueIdCuenta,
    m.OrdIdOrden,
    COALESCE(od.OrdCodigoOrden, erp.CodigoOrden, ''),
    ABS(m.MovImporte),
    svc.TotalServicios,
    m.MovObservaciones
  FROM dbo.MovimientosCuenta m
  JOIN  dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
  LEFT JOIN dbo.Ordenes erp   ON erp.OrdenID = m.OrdIdOrden
  LEFT JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = m.OrdIdOrden
                                   OR (erp.CodigoOrden IS NOT NULL AND od.OrdCodigoOrden = erp.CodigoOrden)
  CROSS APPLY (
    SELECT TRY_CAST(
      SUBSTRING(m.MovObservaciones, LEN('CUBIERTO_POR_PLAN_') + 1, 20)
      AS INT) AS PlanId
  ) planData
  OUTER APPLY (
    SELECT ISNULL(SUM(CAST(d.Subtotal AS DECIMAL(18,4))), 0) AS TotalServicios
    FROM dbo.PedidosCobranza pc
    JOIN dbo.PedidosCobranzaDetalle d ON pc.ID = d.PedidoCobranzaID
    WHERE (d.OrdenID = m.OrdIdOrden
        OR LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(COALESCE(od.OrdCodigoOrden, erp.CodigoOrden))))
      AND d.Subtotal > 0
      AND NOT EXISTS (
        SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
        WHERE pap.PlaIdPlan = planData.PlanId
          AND pap.ProIdProducto = d.ProIdProducto
      )
  ) svc
  WHERE m.MovObservaciones LIKE 'CUBIERTO_POR_PLAN%'
    AND m.DocIdDocumento IS NULL
    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND svc.TotalServicios > 0;

OPEN fix_cur;
FETCH NEXT FROM fix_cur INTO @movId, @cueId, @ordId, @codOrden,
                              @importeActual, @totalServicios, @obsActual;

WHILE @@FETCH_STATUS = 0
BEGIN
  SET @importeMaterial = ROUND(@importeActual - @totalServicios, 2);
  SET @planId     = SUBSTRING(@obsActual, LEN('CUBIERTO_POR_PLAN_') + 1, 20);
  SET @nuevaObs   = 'MATERIAL_CUBIERTO_PLAN_' + @planId;

  PRINT 'Corrigiendo MovId=' + CAST(@movId AS VARCHAR) +
        ' Orden=' + @codOrden +
        ' Material=' + CAST(@importeMaterial AS VARCHAR) +
        ' Servicios=' + CAST(@totalServicios AS VARCHAR);

  -- a) Ajustar MovImporte al costo de servicios y cambiar observación
  UPDATE dbo.MovimientosCuenta
  SET MovImporte       = -@totalServicios,
      MovObservaciones = @nuevaObs
  WHERE MovIdMovimiento = @movId;

  -- b) Acreditar el material en CueSaldoActual
  SELECT @saldoActual = CueSaldoActual
  FROM dbo.CuentasCliente WITH(UPDLOCK)
  WHERE CueIdCuenta = @cueId;

  SET @nuevoSaldo = ROUND(@saldoActual + @importeMaterial, 2);

  UPDATE dbo.CuentasCliente
  SET CueSaldoActual = @nuevoSaldo
  WHERE CueIdCuenta = @cueId;

  -- c) Insertar CREDITO_PLAN como constancia del material cubierto
  INSERT INTO dbo.MovimientosCuenta
    (CueIdCuenta, MovTipo, MovImporte, MovConcepto, MovSaldoPosterior,
     MovFecha, MovUsuarioAlta, OrdIdOrden, MovObservaciones)
  VALUES
    (@cueId, 'CREDITO_PLAN', @importeMaterial,
     'Corrección retroactiva: material cubierto Plan #' + @planId + ' — ' + @codOrden,
     @nuevoSaldo, GETDATE(), 1, @ordId,
     'Material cubierto Plan #' + @planId + ' — servicios pendientes');

  -- d) Reactivar DeudaDocumento al importe de servicios
  SELECT TOP 1 @ddeId = DDeIdDocumento
  FROM dbo.DeudaDocumento
  WHERE OrdIdOrden = @ordId AND CueIdCuenta = @cueId
  ORDER BY DDeIdDocumento DESC;

  IF @ddeId IS NOT NULL
  BEGIN
    UPDATE dbo.DeudaDocumento
    SET DDeImportePendiente = @totalServicios,
        DDeImporteOriginal  = @totalServicios,
        DDeEstado           = 'PENDIENTE',
        DDeFechaCobro       = NULL
    WHERE DDeIdDocumento = @ddeId;
  END
  ELSE
  BEGIN
    INSERT INTO dbo.DeudaDocumento
      (CueIdCuenta, OrdIdOrden, DDeImporteOriginal, DDeImportePendiente,
       DDeFechaEmision, DDeFechaVencimiento, DDeCuotaNumero, DDeCuotaTotal, DDeEstado)
    VALUES
      (@cueId, @ordId, @totalServicios, @totalServicios,
       CAST(GETDATE() AS DATE), CAST(GETDATE() AS DATE), 1, 1, 'PENDIENTE');
  END

  FETCH NEXT FROM fix_cur INTO @movId, @cueId, @ordId, @codOrden,
                                @importeActual, @totalServicios, @obsActual;
END

CLOSE fix_cur;
DEALLOCATE fix_cur;

-- ============================================================
-- PASO 3 — VERIFICACIÓN (antes de commitear)
-- ============================================================
SELECT
  m.MovIdMovimiento,
  cli.Nombre AS Cliente,
  COALESCE(od.OrdCodigoOrden, erp.CodigoOrden, '?') AS Orden,
  m.MovObservaciones,
  ABS(m.MovImporte)          AS ImporteServicios,
  dd.DDeImportePendiente     AS DeudaPendiente,
  dd.DDeEstado
FROM dbo.MovimientosCuenta m
JOIN  dbo.CuentasCliente cc  ON cc.CueIdCuenta  = m.CueIdCuenta
JOIN  dbo.Clientes cli       ON cli.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Ordenes erp    ON erp.OrdenID = m.OrdIdOrden
LEFT JOIN dbo.OrdenesDeposito od ON od.OrdIdOrden = m.OrdIdOrden
OUTER APPLY (
  SELECT TOP 1 DDeImportePendiente, DDeEstado
  FROM dbo.DeudaDocumento
  WHERE OrdIdOrden = m.OrdIdOrden AND CueIdCuenta = m.CueIdCuenta
  ORDER BY DDeIdDocumento DESC
) dd
WHERE m.MovObservaciones LIKE 'MATERIAL_CUBIERTO_PLAN%'
  AND m.DocIdDocumento IS NULL
ORDER BY m.MovIdMovimiento;

-- Si la verificación es correcta → COMMIT TRANSACTION
-- Si algo está mal             → ROLLBACK TRANSACTION

-- COMMIT TRANSACTION;
-- ROLLBACK TRANSACTION;
