/* ============================================================================
   PRODUCCIÓN — B) DESPUÉS DEL DEPLOY del backend/frontend (02-oct-2026)
   Correr recién cuando el backend nuevo ya esté arriba.
     2f  requisito PRO / ACCESORIOS. Con el backend viejo aparecería "Pendiente" en TODAS las
         órdenes PRO (el nuevo lo oculta cuando el pedido no lleva accesorios).
     2g  requisito EST / TPU ("TPU a Estampar"). Con el backend viejo los Estampados de TPU
         quedarían trabados (trataba el TPU como DTF).
   Idempotentes.
   No hacen falta (el diagnóstico dio 0 casos): limpiar_linea_fantasma_directa_ecouv.sql y
   reparar_estampado_hermana_sin_bulto.sql.
   ============================================================================ */
USE [SecureAppDB];
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 2f — docs/migrations/requisito_accesorios_pro.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 2f: docs/migrations/requisito_accesorios_pro.sql ===';
GO
-- =====================================================================================
-- Requisito "Accesorios de stock recibidos" en Producción (PRO) — 30-sep-2026
-- Un producto fabricado con accesorios de stock (mástil, base…) no se aprueba en PRO ni entra a
-- Depósito hasta que Producción reciba el remito de cada accesorio. El requisito queda visible en
-- la pestaña Requisitos de la orden madre PRO y se cumple solo al recibir el último accesorio
-- (logisticsController.receiveDispatch). El bloqueo real lo hacen aprobarControlPRO y el gate de
-- Depósito (validarAccesoriosRecibidos), por eso EsBloqueante = 0: así no aparece como
-- "esperando requisitos" en las órdenes PRO que no llevan accesorios (anclas de venta, prendas…).
-- Idempotente.
-- =====================================================================================
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.ConfigRequisitosProduccion WHERE AreaID = 'PRO' AND CodigoRequisito = 'ACCESORIOS')
BEGIN
    INSERT INTO dbo.ConfigRequisitosProduccion (AreaID, CodigoRequisito, Descripcion, EsBloqueante)
    VALUES ('PRO', 'ACCESORIOS', 'Accesorios de stock recibidos en Producción (mástil, base…)', 0);
    PRINT 'Requisito PRO/ACCESORIOS creado.';
END
ELSE PRINT 'Requisito PRO/ACCESORIOS ya existía.';

-- Reparación: pedidos cuyos accesorios ya están todos en PRO (bulto EN_STOCK en PRO) → CUMPLIDO en la madre
DECLARE @Req INT = (SELECT TOP 1 RequisitoID FROM dbo.ConfigRequisitosProduccion WHERE AreaID = 'PRO' AND CodigoRequisito = 'ACCESORIOS');

MERGE dbo.OrdenCumplimientoRequisitos AS target
USING (
    SELECT m.OrdenID, 'PRO' AS AreaID, @Req AS RequisitoID,
           'Accesorios de stock recibidos en PRO (reparación requisito_accesorios_pro.sql)' AS Obs
    FROM dbo.Ordenes m
    WHERE m.AreaID = 'PRO' AND ISNULL(m.EstadoDependencia, '') <> 'VENTA_DIRECTA'
      AND m.Estado NOT IN ('CANCELADO')
      AND EXISTS (SELECT 1 FROM dbo.Ordenes a WHERE a.AreaID = 'PRO' AND a.EstadoDependencia = 'VENTA_DIRECTA'
                    AND a.DescripcionTrabajo LIKE 'RETIRO ACCESORIO%' AND LTRIM(RTRIM(a.ComboPedidoNoDocERP)) = LTRIM(RTRIM(m.NoDocERP)))
      AND NOT EXISTS (SELECT 1 FROM dbo.Ordenes a
                      LEFT JOIN dbo.PedidosCobranza pc ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(a.NoDocERP))
                      WHERE a.AreaID = 'PRO' AND a.EstadoDependencia = 'VENTA_DIRECTA'
                        AND a.DescripcionTrabajo LIKE 'RETIRO ACCESORIO%' AND LTRIM(RTRIM(a.ComboPedidoNoDocERP)) = LTRIM(RTRIM(m.NoDocERP))
                        AND ISNULL(pc.EstadoCobro, '') <> 'CANCELADO'
                        AND NOT EXISTS (SELECT 1 FROM dbo.Logistica_Bultos b WHERE b.OrdenID = a.OrdenID AND b.Estado = 'EN_STOCK' AND b.UbicacionActual = 'PRO'))
) AS source
ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
WHEN MATCHED AND target.Estado <> 'CUMPLIDO' THEN
    UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE(), Observaciones = source.Obs
WHEN NOT MATCHED THEN
    INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
    VALUES (source.OrdenID, source.AreaID, source.RequisitoID, 'CUMPLIDO', GETDATE(), source.Obs);
PRINT CONCAT('Requisito ACCESORIOS cumplido en: ', @@ROWCOUNT, ' orden(es) PRO');
GO

/* ████████████████████████████████████████████████████████████████████████████
   PASO 2g — docs/migrations/requisito_tpu_estampado.sql
   ████████████████████████████████████████████████████████████████████████████ */
PRINT '';
PRINT '=== PASO 2g: docs/migrations/requisito_tpu_estampado.sql ===';
GO
-- =====================================================================================
-- Requisito "TPU a Estampar" en Estampado (EST) — 01-oct-2026
-- Estampado tenía solo dos requisitos: PRENDA ("Prendas a Estampar") y DTF ("DTF a Estampar").
-- Un Estampado que estampa TPU mostraba "DTF a Estampar — No aplica" y nada que dijera TPU
-- (EST-26025 (2/2)). El código ya contemplaba el código de requisito 'TPU' (al crear el pedido
-- marca "no aplica" los canales que no corresponden y la recepción del remito cumple el requisito
-- cuyo código coincide con Areas.Entrega del área de origen: TPU -> 'TPU'); faltaba la fila.
--
-- Reparación: el requisito es bloqueante, así que a las órdenes de Estampado que YA existen se les
-- deja resuelto, salvo al único caso que de verdad lo espera: Estampado ABIERTO, encadenado a una
-- orden TPU cuyo transfer todavía no se recibió en Estampado.
-- De paso corrige el texto "Prendas a Etampar".
--
-- ¡ORDEN DE DEPLOY! Correr este script DESPUÉS de desplegar el backend. Con el backend viejo la
-- llegada del TPU cumple "DTF a Estampar" (lo trataba como DTF) y este requisito nuevo no lo cumpliría
-- nadie: los Estampados de TPU quedarían trabados. El backend nuevo cumple "TPU a Estampar" cuando el
-- requisito existe y, mientras no exista, sigue comportándose como antes.
-- Idempotente.
-- =====================================================================================
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.ConfigRequisitosProduccion WHERE AreaID = 'EST' AND CodigoRequisito = 'TPU')
BEGIN
    INSERT INTO dbo.ConfigRequisitosProduccion (AreaID, CodigoRequisito, Descripcion, EsBloqueante)
    VALUES ('EST', 'TPU', 'TPU a Estampar', 1);
    PRINT 'Requisito EST/TPU creado.';
END
ELSE PRINT 'Requisito EST/TPU ya existía.';

UPDATE dbo.ConfigRequisitosProduccion SET Descripcion = 'Prendas a Estampar'
WHERE AreaID = 'EST' AND CodigoRequisito = 'PRENDA' AND Descripcion = 'Prendas a Etampar';
PRINT CONCAT('Texto "Prendas a Estampar" corregido en: ', @@ROWCOUNT, ' fila(s)');

DECLARE @Req INT = (SELECT TOP 1 RequisitoID FROM dbo.ConfigRequisitosProduccion WHERE AreaID = 'EST' AND CodigoRequisito = 'TPU');

INSERT INTO dbo.OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
SELECT o.OrdenID, 'EST', @Req, 'CUMPLIDO', GETDATE(),
       CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(f.AreaID, '')))) = 'TPU'
                THEN 'TPU ya recibido u orden ya cerrada (reparación requisito_tpu_estampado.sql)'
            WHEN UPPER(LTRIM(RTRIM(ISNULL(f.AreaID, '')))) IN ('DF', 'DTF')
                THEN 'No aplica — el canal real de este Estampado es DTF'
            ELSE 'Orden anterior al requisito TPU (reparación requisito_tpu_estampado.sql)' END
FROM dbo.Ordenes o
LEFT JOIN dbo.Ordenes f ON f.OrdenID = o.LiberaCuandoOrdenID
WHERE LTRIM(RTRIM(o.AreaID)) = 'EST'
  AND NOT EXISTS (SELECT 1 FROM dbo.OrdenCumplimientoRequisitos c WHERE c.OrdenID = o.OrdenID AND c.RequisitoID = @Req)
  -- queda PENDIENTE solo el Estampado abierto cuyo transfer TPU todavía no llegó a Estampado
  AND NOT (
        UPPER(LTRIM(RTRIM(ISNULL(f.AreaID, '')))) = 'TPU'
        AND ISNULL(o.Estado, '') NOT IN ('Cancelado', 'CANCELADO', 'Finalizado', 'Entregado', 'Pronto')
        AND ISNULL(o.EstadoenArea, '') NOT IN ('Pronto', 'Recibido en Destino', 'En transito')
        AND NOT EXISTS (SELECT 1 FROM dbo.Logistica_Bultos lb
                        WHERE lb.OrdenID = f.OrdenID AND lb.UbicacionActual = 'EST' AND lb.Estado = 'EN_STOCK')
  );
PRINT CONCAT('Requisito TPU resuelto en: ', @@ROWCOUNT, ' orden(es) de Estampado ya existentes');
GO
