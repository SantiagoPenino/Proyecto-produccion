-- ============================================================================
-- diag_ciclo_descuadrado.sql        SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- Para cuando el cierre de ciclo se frena con:
--    "El total del ciclo (X) no coincide con la suma de las lineas de la
--     pre-factura (Y). Cerra y volve a abrir la pre-factura..."
--
-- Ese guard compara DOS numeros que salen de lugares distintos:
--    · el TOTAL DEL CICLO  = suma de los movimientos ORDEN marcados con ese
--      CicIdCiclo, en MovimientosCuenta
--    · las LINEAS          = lo que la pantalla arma desde el pedido congelado
--
-- Cuando no coinciden es porque el ciclo tiene marcados movimientos que NO
-- son de este ciclo. El caso testigo (CR SPORT, 7-sep-2026) fue un movimiento
-- de $ 3.300 en la cuenta de PESOS, sin orden asociada, arrastrado de un ciclo
-- viejo: el cierre lo sumaba porque la query filtra por CicIdCiclo y NO verifica
-- que el movimiento pertenezca a la cuenta del ciclo.
--
-- El panel 3 marca cada movimiento sospechoso y por que.
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Nombre VARCHAR(60) = 'CR SPORT';   -- nombre o codigo del cliente
DECLARE @Cli INT, @Cic INT, @CueCiclo INT, @MonCiclo INT;

SELECT TOP 1 @Cli = cl.CliIdCliente
FROM dbo.Clientes cl
WHERE RTRIM(cl.Nombre) = @Nombre OR RTRIM(cl.IDCliente) = @Nombre
ORDER BY CASE WHEN RTRIM(cl.Nombre) = @Nombre THEN 0 ELSE 1 END;

IF @Cli IS NULL
BEGIN
    SELECT Coincidencias = RTRIM(cl.Nombre), Codigo = RTRIM(cl.IDCliente), cl.CliIdCliente
    FROM dbo.Clientes cl WHERE RTRIM(cl.Nombre) LIKE '%' + @Nombre + '%';
    RAISERROR('No hay cliente exacto con ese nombre. Arriba las coincidencias.', 16, 1);
    RETURN;
END

-- El ciclo ABIERTO del cliente (el que se esta intentando cerrar)
SELECT TOP 1 @Cic = c.CicIdCiclo, @CueCiclo = c.CueIdCuenta
FROM dbo.CiclosCredito c
WHERE c.CliIdCliente = @Cli AND c.CicEstado = 'ABIERTO'
ORDER BY c.CicIdCiclo DESC;

IF @Cic IS NULL
BEGIN
    RAISERROR('Ese cliente no tiene ningun ciclo ABIERTO.', 16, 1);
    RETURN;
END

SELECT @MonCiclo = ISNULL(cc.MonIdMoneda, 1) FROM dbo.CuentasCliente cc WHERE cc.CueIdCuenta = @CueCiclo;

-- ── 1 · El ciclo ───────────────────────────────────────────────────────────
SELECT Panel = '1 - CICLO', Cliente = RTRIM(cl.Nombre), c.CicIdCiclo, c.CicEstado,
       c.CicFechaInicio, CuentaDelCiclo = c.CueIdCuenta,
       MonedaDelCiclo = CASE WHEN @MonCiclo = 2 THEN 'US$' ELSE '$' END
FROM dbo.CiclosCredito c JOIN dbo.Clientes cl ON cl.CliIdCliente = c.CliIdCliente
WHERE c.CicIdCiclo = @Cic;

-- ── 2 · Los dos totales que compara el guard ───────────────────────────────
-- "TotalQueSumaElCierre" es EXACTAMENTE la query del cierre (cerrarCicloCompleto).
-- "TotalSoloDeLaCuentaDelCiclo" es lo que deberia ser.
SELECT Panel = '2 - TOTALES',
       TotalQueSumaElCierre = CAST(ISNULL(SUM(ABS(m.MovImporte)), 0) AS DECIMAL(18,2)),
       TotalSoloDeLaCuentaDelCiclo = CAST(ISNULL(SUM(CASE WHEN m.CueIdCuenta = @CueCiclo
                                                          THEN ABS(m.MovImporte) ELSE 0 END), 0) AS DECIMAL(18,2)),
       DeMas = CAST(ISNULL(SUM(CASE WHEN m.CueIdCuenta <> @CueCiclo
                                    THEN ABS(m.MovImporte) ELSE 0 END), 0) AS DECIMAL(18,2)),
       Movimientos = COUNT(*)
FROM dbo.MovimientosCuenta m
WHERE m.CicIdCiclo = @Cic
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.MovImporte < 0
  AND m.DocIdDocumento IS NULL
  AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%');

-- ── 3 · Movimiento por movimiento, con el motivo de cada sospechoso ────────
SELECT Panel = '3 - DETALLE', m.MovIdMovimiento,
       Orden = ISNULL(o.CodigoOrden, '(sin orden)'),
       Importe = CAST(ABS(m.MovImporte) AS DECIMAL(18,2)),
       m.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       EsLaCuentaDelCiclo = CASE WHEN m.CueIdCuenta = @CueCiclo THEN 'si' ELSE 'NO' END,
       PedidoCongelado = pc.MontoTotal, PedMoneda = pc.Moneda,
       DifConElPedido = CAST(ABS(m.MovImporte) - ISNULL(pc.MontoTotal, 0) AS DECIMAL(18,2)),
       Fecha = m.MovFecha,
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 40),
       Veredicto = CASE
         WHEN m.CueIdCuenta <> @CueCiclo
              THEN 'SOBRA - es de OTRA CUENTA (' +
                   CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END +
                   '), no de la del ciclo. El cierre lo suma igual: por esto no cuadra.'
         WHEN o.CodigoOrden IS NULL
              THEN 'SOSPECHOSO - sin orden asociada; no puede tener linea en la pre-factura'
         WHEN pc.ID IS NULL
              THEN 'SOSPECHOSO - la orden no tiene pedido congelado, la pre-factura no lo puede cotizar'
         WHEN ABS(ABS(m.MovImporte) - pc.MontoTotal) > 0.011
              THEN 'REVISAR - el importe del movimiento no coincide con el pedido congelado'
         ELSE 'ok' END
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.Ordenes o ON o.OrdenID = m.OrdIdOrden
LEFT JOIN dbo.PedidosCobranza pc
       ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
WHERE m.CicIdCiclo = @Cic
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.MovImporte < 0
  AND m.DocIdDocumento IS NULL
  AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')
ORDER BY CASE WHEN m.CueIdCuenta <> @CueCiclo THEN 0 ELSE 1 END, ABS(m.MovImporte) DESC;

-- ── 4 · Los MovId a sacar del ciclo (para pasarle al fix) ──────────────────
SELECT Panel = '4 - A SACAR DEL CICLO', m.MovIdMovimiento,
       Importe = CAST(ABS(m.MovImporte) AS DECIMAL(18,2)),
       m.CueIdCuenta, Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 50), m.MovFecha
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.CicIdCiclo = @Cic
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.MovImporte < 0
  AND m.DocIdDocumento IS NULL
  AND m.CueIdCuenta <> @CueCiclo
ORDER BY ABS(m.MovImporte) DESC;
